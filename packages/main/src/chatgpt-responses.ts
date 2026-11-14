import {
  isProviderModelSlug,
  type ProviderFailureReason,
  type ProviderRequestData,
  type ProviderUsage,
} from "@ohtia/contracts";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { ProviderRequestControl } from "./provider-adapter.js";
import { object } from "./chatgpt-sign-in.js";

export const responsesEndpoint = "https://api.openai.com/v1/responses";
/**
 * Fields a request never carries: those Sign in with ChatGPT rejects, and those that would bring in
 * conversation state or prompts the provider keeps. The conformance suite checks every request.
 */
export const forbiddenResponseFields = Object.freeze([
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "previous_response_id",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
]);
/** Only what Ohtia builds: instructions, input and, from STORY-003-014, Ohtia's own tools. */
export function responsesBody(request: ProviderRequestData): Record<string, unknown> {
  return {
    model: request.model,
    instructions: request.instructions,
    input: request.input.map((item) => ({ role: item.role, content: item.text })),
    store: false,
    stream: true,
  };
}
type Classified = {
  readonly reason: Exclude<ProviderFailureReason, "connection_lost" | "permit_expired">;
  /** A rejected credential: renew the session once, without sending the request again. */
  readonly renew?: true;
  /** A rejected grant: the connection becomes `error` with `sign_in_rejected`. */
  readonly rejectGrant?: true;
};
/** OpenAI's documented `error.code` values, wherever they arrive. */
export function classifyCode(code: unknown): Classified | undefined {
  switch (code) {
    case "subscription_sharing_user_not_eligible":
      return { reason: "not_eligible" };
    case "subscription_sharing_usage_limit_exceeded":
      return { reason: "usage_limit_reached" };
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return { reason: "provider_unavailable" };
    case "subscription_sharing_unsupported_capability":
    case "subscription_sharing_route_not_supported":
      return { reason: "request_rejected" };
    case "subscription_sharing_invalid_user":
      return { reason: "connection_expired", renew: true };
    case "chatpass_v2_scope_not_authorized":
    case "chatpass_v2_invalid_authorization_context":
      return { reason: "request_rejected", rejectGrant: true };
    default:
      return;
  }
}
/** A failure before the stream opens; a `{"detail": "..."}` text is never read as a code. */
export function classifyStatus(status: number, code: unknown): Classified {
  const known = classifyCode(code);
  if (known) return known;
  if (status === 401) return { reason: "connection_expired", renew: true };
  if (status === 403) return { reason: "not_eligible" };
  if (status === 429 || status >= 500) return { reason: "provider_unavailable" };
  return { reason: "request_rejected" };
}
/** A transport failure, and whether any request byte had left when it happened. */
export type TransportFailure = Error & { readonly sent: boolean };
export function transportFailure(sent: boolean, cause?: unknown): TransportFailure {
  return Object.assign(new Error("Provider transport failed.", { cause }), { sent });
}
export function isTransportFailure(value: unknown): value is TransportFailure {
  return value instanceof Error && typeof (value as { sent?: unknown }).sent === "boolean";
}
export interface TransportRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}
/**
 * Send one request. `release` is the last guard: the transport calls it once the connection, TLS
 * included, is established and before any request byte leaves; false sends nothing.
 */
export type ResponsesTransport = (
  request: TransportRequest,
  release: () => boolean,
) => Promise<Response>;
const nullBodyStatuses = new Set([204, 205, 304]);
const transportClosures = new WeakMap<Response, () => Promise<void>>();
/** A real transport waits for its unpooled socket to close; injected test Responses have no socket. */
export async function closeResponseTransport(response: Response): Promise<void> {
  await transportClosures.get(response)?.();
}
/**
 * `fetch` reads a request body before its connection opens, so it cannot hold the body back for a
 * guard. Node's client writes nothing, not even headers, until `end()`, which follows the guard on
 * an established, unpooled connection.
 */
export function nodeResponsesTransport(
  open: (url: URL, options: https.RequestOptions) => http.ClientRequest = (url, options) =>
    https.request(url, options),
): ResponsesTransport {
  return (request, release) =>
    new Promise((resolve, reject) => {
      let sent = false;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(transportFailure(sent, error));
      };
      const body = Buffer.from(request.body, "utf8");
      const outgoing = open(new URL(request.url), {
        method: "POST",
        agent: false,
        signal: request.signal,
        headers: { ...request.headers, "Content-Length": String(body.byteLength) },
      });
      let socketClosed: Promise<void> = Promise.resolve();
      outgoing.once("response", (incoming) => {
        if (settled) return;
        settled = true;
        const status = incoming.statusCode ?? 0;
        const empty = nullBodyStatuses.has(status);
        if (empty) incoming.resume();
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (typeof value === "string") headers.set(name, value);
          const response = new Response(
            empty ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
            { status, headers },
          );
          transportClosures.set(response, async () => {
            incoming.destroy();
            outgoing.destroy();
            await socketClosed;
          });
          resolve(response);
        } catch (error) {
          // A status the Fetch API cannot represent: the request had left.
          incoming.destroy();
          outgoing.destroy();
          void socketClosed.then(() => {
            reject(transportFailure(true, error));
          });
        }
      });
      outgoing.on("error", (error) => {
        // Before headers there is no Response to carry the receipt. Reject only after closure.
        outgoing.destroy();
        void socketClosed.then(() => {
          fail(error);
        });
      });
      outgoing.once("socket", (socket) => {
        socketClosed = new Promise<void>((resolve) => {
          socket.once("close", () => {
            resolve();
          });
        });
        const ready = () => {
          if (settled) return;
          if (!release()) {
            outgoing.destroy();
            void socketClosed.then(() => {
              fail(undefined);
            });
            return;
          }
          sent = true;
          outgoing.end(body);
        };
        if ((socket as { encrypted?: boolean }).encrypted === true)
          socket.once("secureConnect", ready);
        else if (socket.connecting) socket.once("connect", ready);
        else ready();
      });
    });
}
/** Read at most `limit` bytes of an error body for its `error.code`; nothing else is kept. */
export async function errorCode(response: Response, limit = 64 * 1024): Promise<unknown> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) return;
      chunks.push(next.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return object(value) && object(value.error) ? value.error.code : undefined;
  } catch {
    return;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function tokens(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}
/** Reported usage only; a missing count stays unknown. */
export function reportedUsage(value: unknown): ProviderUsage | undefined {
  if (!object(value)) return;
  return {
    input_tokens: tokens(value.input_tokens),
    cached_input_tokens: object(value.input_tokens_details)
      ? tokens(value.input_tokens_details.cached_tokens)
      : null,
    output_tokens: tokens(value.output_tokens),
    reasoning_tokens: object(value.output_tokens_details)
      ? tokens(value.output_tokens_details.reasoning_tokens)
      : null,
  };
}
const eventBytes = 4 * 1024 * 1024;
/**
 * Read a Responses stream. Success requires `response.completed`; an end without a final event is
 * uncertain; an event Ohtia cannot parse fails as invalid output, keeping the text already sent.
 */
export async function readResponseStream(
  response: Response,
  control: ProviderRequestControl,
  hooks: {
    readonly classified: (classified: Classified) => void | Promise<void>;
  },
): Promise<void> {
  const requestId = response.headers.get("x-request-id");
  let started = false;
  const start = (model: unknown) => {
    if (started) return;
    started = true;
    control.emit({
      type: "started",
      provider_request_id:
        requestId && /^[A-Za-z0-9_.:-]{1,256}$/.test(requestId) ? requestId : null,
      model: isProviderModelSlug(model) ? model : null,
    });
  };
  const fail = async (code: unknown, fallback: "provider_error") => {
    const classified = classifyCode(code);
    if (classified) await hooks.classified(classified);
    control.emit({
      type: "result",
      result: { status: "failed", reason: classified?.reason ?? fallback, dispatched: true },
    });
  };
  const invalid = () => {
    control.emit({
      type: "result",
      result: { status: "failed", reason: "invalid_output", dispatched: true },
    });
  };
  /** Returns true once the stream has reached its final event. */
  const handle = async (block: string): Promise<boolean | "invalid"> => {
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
      else if (line && !line.startsWith(":") && !/^(?:event|id|retry):/.test(line))
        return "invalid";
    }
    if (!data.length) return false;
    let value: unknown;
    try {
      value = JSON.parse(data.join("\n"));
    } catch {
      return "invalid";
    }
    if (!object(value) || typeof value.type !== "string") return "invalid";
    const body = object(value.response) ? value.response : undefined;
    start(
      value.type === "response.created" || value.type === "response.in_progress"
        ? body?.model
        : undefined,
    );
    const usage = () => {
      const reported = reportedUsage(body?.usage);
      if (reported) control.emit({ type: "usage", usage: reported });
    };
    switch (value.type) {
      case "response.output_text.delta":
        if (typeof value.delta !== "string") return "invalid";
        if (value.delta) control.emit({ type: "text", text: value.delta });
        return false;
      case "response.completed":
        if (!body) return "invalid";
        usage();
        control.emit({ type: "result", result: { status: "completed" } });
        return true;
      case "response.failed":
        usage();
        await fail(object(body?.error) ? body.error.code : undefined, "provider_error");
        return true;
      case "response.incomplete":
        usage();
        await fail(undefined, "provider_error");
        return true;
      case "error":
        await fail(
          value.code ?? (object(value.error) ? value.error.code : undefined),
          "provider_error",
        );
        return true;
      default:
        control.emit({ type: "activity" });
        return false;
    }
  };
  if (!response.body) {
    control.emit({ type: "result", result: { status: "uncertain", reason: "connection_lost" } });
    return;
  }
  const reader = response.body.getReader();
  // An interrupt, the end of the generation or a final result closes the response.
  const close = () => {
    void reader.cancel().catch(() => {});
  };
  control.signal.addEventListener("abort", close, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        if (!control.signal.aborted)
          control.emit({
            type: "result",
            result: { status: "uncertain", reason: "connection_lost" },
          });
        return;
      }
      try {
        buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      } catch {
        invalid();
        return;
      }
      buffer = buffer.replaceAll("\r\n", "\n");
      for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const handled = await handle(block);
        if (handled === "invalid") {
          invalid();
          return;
        }
        if (handled) return;
      }
      if (buffer.length > eventBytes) {
        invalid();
        return;
      }
      if (next.done) {
        if (buffer.trim()) {
          const handled = await handle(buffer.trim());
          if (handled === "invalid") invalid();
          if (handled) return;
        }
        control.emit({
          type: "result",
          result: { status: "uncertain", reason: "connection_lost" },
        });
        return;
      }
    }
  } finally {
    control.signal.removeEventListener("abort", close);
    await reader.cancel().catch(() => {});
  }
}
