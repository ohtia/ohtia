import { request as httpsRequest } from "node:https";
import {
  diagnosticCatalog,
  isProviderUsage,
  utf8Size,
  unknownUsage,
  type ProviderRequestData,
  type ProviderUsage,
  type RequestFailureReason,
  type ProviderResult,
} from "@ohtia/contracts";
import type { RequestContext, ProviderRequestHandle } from "./provider-requests.js";
import { object } from "./chatgpt-sign-in.js";

const BodyRefused = class extends Error {
  readonly reason: "permit_expired" | "connection_expired";
  constructor(reason: "permit_expired" | "connection_expired") {
    super("Provider body refused.");
    this.reason = reason;
  }
};
type OutputFailure = (typeof diagnosticCatalog)["ohtia.provider.output_rejected"]["errors"][number];
const OutputRejected = class extends SyntaxError {
  constructor(readonly code: OutputFailure) {
    super("Invalid provider output.");
  }
};
export interface ResponseTransportOptions {
  readonly body: string;
  readonly signal: AbortSignal;
  /** Only this hook may attach a credential or release a request byte. */
  readonly release: () => string;
}
export type ResponseTransport = (options: ResponseTransportOptions) => Promise<Response>;
/** New verified TLS connection per request, no redirects, retries, ambient proxy or provider memory. */
export const responsesTransport: ResponseTransport = ({ body, signal, release }) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      "https://api.openai.com/v1/responses",
      { method: "POST", agent: false, signal, minVersion: "TLSv1.2", rejectUnauthorized: true },
      (response) => {
        const status = response.statusCode ?? 502;
        const headers = { "content-type": response.headers["content-type"] ?? "" };
        // These response statuses cannot carry a Fetch body, including an unfollowed 304 response.
        if ([204, 205, 304].includes(status)) {
          response.destroy();
          resolve(new Response(null, { status, headers }));
          return;
        }
        const iterator = response[Symbol.asyncIterator]();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await iterator.next();
              if (next.done) controller.close();
              else controller.enqueue(new Uint8Array(next.value as Buffer));
            } catch {
              controller.error(new Error("Provider connection lost."));
            }
          },
          cancel() {
            response.destroy();
          },
        });
        resolve(
          new Response(stream, {
            status,
            headers,
          }),
        );
      },
    );
    request.once("error", reject);
    request.once("socket", (socket) => {
      socket.once("secureConnect", () => {
        try {
          if (signal.aborted) throw new Error("Provider connection cancelled.");
          const credential = release();
          request.setHeader("Authorization", `Bearer ${credential}`);
          request.setHeader("Content-Type", "application/json");
          request.setHeader("Accept", "text/event-stream");
          request.setHeader("Content-Length", Buffer.byteLength(body));
          request.end(body);
        } catch (error) {
          request.destroy(error instanceof Error ? error : new Error("Provider body refused."));
        }
      });
    });
  });

export function responseBody(request: ProviderRequestData) {
  // Explicit projection: no provider conversation, stored prompt, unsupported fields or hosted tools.
  return {
    model: request.model,
    instructions: request.instructions.text,
    input: request.input.map(({ role, content }) => ({ role, content })),
    store: false,
    stream: true,
  };
}
export function responseFailure(status: number, code: unknown): RequestFailureReason {
  if (code === "subscription_sharing_usage_limit_exceeded") return "usage_limit_reached";
  if (
    code === "subscription_sharing_unsupported_capability" ||
    code === "subscription_sharing_route_not_supported" ||
    code === "chatpass_v2_scope_not_authorized" ||
    code === "chatpass_v2_invalid_authorization_context"
  )
    return "request_rejected";
  if (status === 401) return "connection_expired";
  if (status === 429 || status >= 500) return "provider_unavailable";
  if (status === 403) return "not_eligible";
  return "request_rejected";
}
async function errorCode(response: Response): Promise<unknown> {
  if (!response.body) return;
  const reader = response.body.getReader();
  let value = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (value.length + next.value.length > 65536) return;
      value += decoder.decode(next.value, { stream: true });
    }
    value += decoder.decode();
    const body: unknown = JSON.parse(value);
    return object(body) && object(body.error) && typeof body.error.code === "string"
      ? body.error.code
      : undefined;
  } catch {
    return;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function outputBytes(value: string, code: "invalid_text" | "invalid_completed_output"): number {
  try {
    return utf8Size(value);
  } catch {
    throw new OutputRejected(code);
  }
}
interface ResponseOutput {
  readonly text: string;
  readonly refusal: string;
  readonly hasRefusal: boolean;
}
function responseOutput(value: unknown): ResponseOutput | undefined {
  if (!Array.isArray(value)) return;
  const texts: string[] = [];
  const refusals: string[] = [];
  for (const item of value as unknown[]) {
    if (!object(item)) return;
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content))
      return;
    for (const part of item.content as unknown[]) {
      if (!object(part)) return;
      if (part.type === "output_text" && typeof part.text === "string") {
        outputBytes(part.text, "invalid_completed_output");
        texts.push(part.text);
      } else if (part.type === "refusal" && typeof part.refusal === "string") {
        outputBytes(part.refusal, "invalid_completed_output");
        refusals.push(part.refusal);
      } else return;
    }
  }
  return { text: texts.join(""), refusal: refusals.join(""), hasRefusal: refusals.length > 0 };
}
function usage(value: unknown): ProviderUsage | undefined {
  if (value === undefined || value === null) return unknownUsage;
  if (!object(value)) return;
  const result = {
    input_tokens: value.input_tokens ?? null,
    output_tokens: value.output_tokens ?? null,
    total_tokens: value.total_tokens ?? null,
  };
  return isProviderUsage(result) ? result : undefined;
}
export function startChatGPTRequest(
  request: ProviderRequestData,
  context: RequestContext,
  options: {
    readonly token: () => string | undefined;
    readonly renew: () => Promise<void>;
    readonly rejectPermission: () => Promise<void>;
    readonly transport?: ResponseTransport;
    readonly outputRejected?: (reason: OutputFailure) => void;
    readonly connectionSignal?: AbortSignal;
  },
): ProviderRequestHandle {
  const abort = new AbortController();
  const admission = new AbortController();
  let dispatched = false;
  const wasDispatched = () => dispatched;
  const endAdmission = () => {
    if (!wasDispatched()) admission.abort();
  };
  options.connectionSignal?.addEventListener("abort", endAdmission, { once: true });
  if (options.connectionSignal?.aborted) endAdmission();
  const signal = AbortSignal.any([abort.signal, context.signal, admission.signal]);
  const isCancelled = () => abort.signal.aborted || context.signal.aborted;
  const admissionEnded = () => admission.signal.aborted;
  let finished = false;
  let final = false;
  const isFinal = () => final;
  const done = (async () => {
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const finish = (result: ProviderResult) => {
      if (isFinal()) return;
      final = true;
      context.emit({
        kind: "final",
        result: isCancelled() ? { outcome: "cancelled", dispatched } : result,
      });
    };
    try {
      if (isCancelled()) {
        finish({ outcome: "cancelled", dispatched: false });
        return;
      }
      if (admissionEnded()) {
        finish({ outcome: "failed", dispatched: false, reason: "connection_expired" });
        return;
      }
      response = await (options.transport ?? responsesTransport)({
        body: JSON.stringify(responseBody(request)),
        signal,
        release: () => {
          const refusal = context.authorizeBody();
          if (refusal) throw new BodyRefused(refusal);
          if (admissionEnded()) throw new BodyRefused("connection_expired");
          const token = options.token();
          if (!token) throw new BodyRefused("connection_expired");
          if (isCancelled()) throw new Error("Request cancelled.");
          dispatched = true;
          // Account changes prevent new dispatches; a sent response retains its own connection.
          options.connectionSignal?.removeEventListener("abort", endAdmission);
          context.emit({ kind: "started" });
          return token;
        },
      });
      if (!response.ok) {
        const code = await errorCode(response);
        if (isCancelled()) {
          finish({ outcome: "cancelled", dispatched });
          return;
        }
        const reason = responseFailure(response.status, code);
        if (response.status === 401) await options.renew();
        if (
          code === "chatpass_v2_scope_not_authorized" ||
          code === "chatpass_v2_invalid_authorization_context"
        )
          await options.rejectPermission();
        finish({ outcome: "failed", dispatched: true, reason });
        return;
      }
      const media = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      // A missing media header does not establish invalid output; the bounded event decoder does.
      if (!response.body || (media.length > 0 && media !== "text/event-stream"))
        throw new OutputRejected("invalid_media_type");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let pending = "";
      let data: string[] = [];
      let eventName = "";
      const output = { text: 0, refusal: 0 };
      const forward = (kind: "text" | "refusal", text: string) => {
        output[kind] += outputBytes(text, "invalid_text");
        if (output.text + output.refusal > request.limits.max_output_bytes)
          throw new OutputRejected("output_limit");
        // Each event respects the shared port bound, including multibyte text.
        const points = Array.from(text);
        for (let i = 0; i < points.length; i += 512)
          context.emit({ kind, text: points.slice(i, i + 512).join("") });
      };
      const terminalOutput = (value: unknown, complete: boolean): ResponseOutput => {
        const parsed = responseOutput(value);
        if (
          !parsed ||
          Buffer.byteLength(parsed.text) + Buffer.byteLength(parsed.refusal) >
            request.limits.max_output_bytes
        )
          throw new OutputRejected("invalid_completed_output");
        for (const kind of ["text", "refusal"] as const) {
          if (complete && output[kind] > 0 && Buffer.byteLength(parsed[kind]) !== output[kind])
            throw new OutputRejected("invalid_completed_output");
        }
        for (const kind of ["text", "refusal"] as const)
          if (output[kind] === 0) forward(kind, parsed[kind]);
        return parsed;
      };
      const parse = () => {
        if (data.length === 0) {
          eventName = "";
          return;
        }
        const raw = data.join("\n");
        data = [];
        if (raw === "[DONE]") {
          eventName = "";
          return;
        }
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          typeof value.type !== "string" ||
          value.type.length === 0 ||
          value.type.length > 128 ||
          (eventName && eventName !== value.type)
        )
          throw new OutputRejected("invalid_event");
        eventName = "";
        if (
          value.type === "response.output_text.delta" ||
          value.type === "response.refusal.delta"
        ) {
          if (typeof value.delta !== "string") throw new OutputRejected("invalid_text");
          forward(value.type === "response.refusal.delta" ? "refusal" : "text", value.delta);
        } else if (value.type === "response.completed") {
          if (!object(value.response)) throw new OutputRejected("invalid_completed_output");
          const parsed = terminalOutput(value.response.output, true);
          const reported = usage(value.response.usage);
          if (!reported) throw new OutputRejected("invalid_usage");
          context.emit({ kind: "usage", usage: reported });
          finish({ outcome: parsed.hasRefusal ? "refused" : "completed", dispatched: true });
        } else if (["response.failed", "response.incomplete", "error"].includes(value.type)) {
          const filtered =
            value.type === "response.incomplete" &&
            object(value.response) &&
            object(value.response.incomplete_details) &&
            value.response.incomplete_details.reason === "content_filter";
          if (filtered && object(value.response) && value.response.output !== undefined)
            terminalOutput(value.response.output, false);
          if (object(value.response) && value.response.usage !== undefined) {
            const reported = usage(value.response.usage);
            if (!reported) throw new OutputRejected("invalid_usage");
            context.emit({ kind: "usage", usage: reported });
          }
          finish(
            filtered
              ? { outcome: "content_filtered", dispatched: true }
              : { outcome: "failed", dispatched: true, reason: "provider_error" },
          );
        }
        // Responses v1 permits new event types. Unknown events have no display, execution or
        // completion effects; only supported text/refusal parts and a validated terminal event affect the result.
      };
      const line = (value: string) => {
        if (value === "") {
          parse();
          return;
        }
        if (value.startsWith(":")) return;
        const colon = value.indexOf(":");
        const key = colon < 0 ? value : value.slice(0, colon);
        const content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");
        if (key === "data") data.push(content);
        if (key === "event") eventName = content;
        if (data.length > 1024 || data.reduce((sum, item) => sum + item.length, 0) > 128 * 1024)
          throw new OutputRejected("event_limit");
      };
      while (!isFinal()) {
        const next = await reader.read();
        if (next.done) {
          try {
            pending += decoder.decode();
          } catch {
            throw new OutputRejected("invalid_encoding");
          }
          // A held CR is a complete line ending at EOF; an unterminated data event stays uncertain.
          if (pending.endsWith("\r")) line(pending.slice(0, -1));
          break;
        }
        try {
          pending += decoder.decode(next.value, { stream: true });
        } catch {
          throw new OutputRejected("invalid_encoding");
        }
        for (;;) {
          const match = /\r\n|\r|\n/.exec(pending);
          if (!match || (match[0] === "\r" && match.index === pending.length - 1)) break;
          const value = pending.slice(0, match.index);
          pending = pending.slice(match.index + match[0].length);
          line(value);
          if (isFinal()) break;
        }
        if (pending.length > 128 * 1024) throw new OutputRejected("line_limit");
      }
      if (!isFinal()) finish({ outcome: "uncertain", dispatched: true, reason: "connection_lost" });
    } catch (error) {
      if (isCancelled()) finish({ outcome: "cancelled", dispatched });
      else if (error instanceof BodyRefused)
        finish({ outcome: "failed", dispatched: false, reason: error.reason });
      else if (!wasDispatched() && admissionEnded())
        finish({ outcome: "failed", dispatched: false, reason: "connection_expired" });
      else if (error instanceof SyntaxError) {
        // JSON.parse errors can contain provider text; diagnostics receive only this closed code.
        options.outputRejected?.(error instanceof OutputRejected ? error.code : "invalid_json");
        finish({ outcome: "failed", dispatched: true, reason: "invalid_output" });
      } else if (!wasDispatched())
        finish({ outcome: "failed", dispatched: false, reason: "provider_unavailable" });
      else finish({ outcome: "uncertain", dispatched: true, reason: "connection_lost" });
    } finally {
      finished = true;
      options.connectionSignal?.removeEventListener("abort", endAdmission);
      abort.abort();
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      } else await response?.body?.cancel().catch(() => {});
    }
  })();
  return {
    done,
    interrupt: () => {
      abort.abort();
    },
    inspect: () => (finished ? "finished" : "running"),
  };
}
