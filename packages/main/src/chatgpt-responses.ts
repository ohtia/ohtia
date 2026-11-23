import { createHash } from "node:crypto";
import {
  isProviderEffort,
  isProviderModelSlug,
  conversationTitlePolicy,
  type ProviderFailureReason,
  type ProviderRequestData,
  type ProviderTool,
  type ProviderUsage,
} from "@ohtia/contracts";
import {
  nodeProviderTransport,
  type TransportRequest as ProviderTransportRequest,
} from "./provider-https.js";
import type { ProviderRequestControl } from "./provider-adapter.js";
import { object } from "./chatgpt-sign-in.js";

export const responsesEndpoint = "https://api.openai.com/v1/responses";
// This endpoint accepts a narrower effort vocabulary than some account catalogs advertise.
const responsesEfforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export function isResponsesEffort(effort: string): boolean {
  return responsesEfforts.has(effort);
}
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
/** Serialize Ohtia's request, including an explicit reasoning effort when chosen. */
export function responsesBody(
  request: ProviderRequestData,
  route: "tools" | "additional_tools" | "api_key" = "tools",
): Record<string, unknown> {
  const tools =
    route === "api_key"
      ? request.tools.map((tool) => ({ ...tool, namespace: "ohtia" }))
      : request.tools;
  const namespaces = [...new Set(tools.map((tool) => tool.namespace))].map((name) => ({
    type: "namespace",
    name,
    description:
      name === conversationTitlePolicy.namespace
        ? "Optional metadata for the current reply."
        : tools.some((tool) => tool.namespace === name && tool.name === "update_memory")
          ? "Research action proposals and reversible project memory updates."
          : "Actions that Ohtia shows to the researcher for confirmation.",
    tools: tools
      .filter((tool) => tool.namespace === name)
      .map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        strict: tool.strict,
        parameters: tool.parameters,
      })),
  }));
  return {
    model: request.model,
    ...(request.effort === undefined ? {} : { reasoning: { effort: request.effort } }),
    instructions: request.instructions,
    input: [
      ...(route === "additional_tools" && namespaces.length
        ? [{ type: "additional_tools", role: "developer", tools: namespaces }]
        : []),
      ...request.input.map((item) => ({ role: item.role, content: item.text })),
    ],
    ...(route !== "additional_tools" && namespaces.length ? { tools: namespaces } : {}),
    ...(route === "api_key" ? { tool_choice: "auto" } : {}),
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
export { closeResponseTransport, isTransportFailure, transportFailure } from "./provider-https.js";
export type TransportRequest = ProviderTransportRequest & { readonly body: string };
export type ResponsesTransport = (
  request: TransportRequest,
  release: () => boolean,
) => Promise<Response>;
export const nodeResponsesTransport: (
  ...args: Parameters<typeof nodeProviderTransport>
) => ResponsesTransport = nodeProviderTransport;

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
const argumentsDigest = (text: string) =>
  createHash("sha256").update(text, "utf16le").digest("hex");

function* completedAssistantText(output: unknown): Iterable<string> {
  if (!Array.isArray(output)) return;
  for (const item of output) {
    if (
      !object(item) ||
      item.type !== "message" ||
      item.role !== "assistant" ||
      !Array.isArray(item.content)
    )
      continue;
    for (const part of item.content) {
      if (object(part) && part.type === "output_text" && typeof part.text === "string" && part.text)
        yield part.text;
    }
  }
}
function validResponseOutput(
  output: unknown,
  validCall: (item: Record<string, unknown>) => boolean,
): boolean {
  return (
    Array.isArray(output) &&
    (output as unknown[]).every((item) => {
      if (!object(item) || typeof item.type !== "string") return false;
      if (item.type === "function_call") return validCall(item);
      if (item.type !== "message") return true;
      return (
        item.role === "assistant" &&
        Array.isArray(item.content) &&
        (item.content as unknown[]).every(
          (part) =>
            object(part) &&
            typeof part.type === "string" &&
            (part.type !== "output_text" || typeof part.text === "string"),
        )
      );
    })
  );
}
/**
 * Read a Responses stream. Success requires `response.completed`; an end without a final event is
 * uncertain; an event Ohtia cannot parse fails as invalid output, keeping the text already sent.
 */
export async function readResponseStream(
  response: Response,
  control: ProviderRequestControl,
  hooks:
    | { readonly classified: (classified: Classified) => void | Promise<void> }
    | { readonly apiTools: readonly ProviderTool[] },
): Promise<void> {
  const requestId = response.headers.get("x-request-id");
  const apiTools = "apiTools" in hooks ? hooks.apiTools : undefined;
  // The wire has one namespace. An omitted namespace can only resolve to a tool we sent.
  const requestedTool = (name: unknown, namespace: unknown) =>
    namespace === "ohtia" || namespace === undefined || namespace === null
      ? apiTools?.find((tool) => tool.name === name)
      : undefined;
  let started = false;
  let observedEffort: string | undefined;
  let streamedText = false;
  const isAborted = () => control.signal.aborted;
  const calls = new Map<
    string,
    {
      readonly name: string;
      readonly callId: string | undefined;
      digest?: string;
    }
  >();
  const ended = new Set<string>();
  const start = (metadata?: Record<string, unknown>) => {
    const reasoning = metadata?.reasoning;
    const effort =
      object(reasoning) && isProviderEffort(reasoning.effort) ? reasoning.effort : undefined;
    if (started && (effort === undefined || effort === observedEffort)) return;
    started = true;
    observedEffort = effort;
    const model = metadata?.model;
    control.emit({
      type: "started",
      provider_request_id:
        requestId && /^[A-Za-z0-9_.:-]{1,256}$/.test(requestId) ? requestId : null,
      model: isProviderModelSlug(model) ? model : null,
      ...(effort === undefined ? {} : { effort }),
    });
  };
  const fail = async (code: unknown, fallback: "provider_error" | "max_output_reached") => {
    if (apiTools && isAborted()) return;
    const classified = "classified" in hooks ? classifyCode(code) : undefined;
    if (classified && "classified" in hooks) await hooks.classified(classified);
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
    if (isAborted()) return true;
    if (apiTools && Buffer.byteLength(block, "utf8") > eventBytes) return "invalid";
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
    const completed = value.type === "response.completed";
    const terminal =
      completed || value.type === "response.failed" || value.type === "response.incomplete";
    start(
      value.type === "response.created" || value.type === "response.in_progress" || terminal
        ? body
        : undefined,
    );
    if (terminal) {
      // Usage is independently reported even when the terminal output cannot be accepted.
      const reported = reportedUsage(body?.usage);
      if (reported) control.emit({ type: "usage", usage: reported });
      if (apiTools) {
        const confirmed = new Set<string>();
        const validCall = (item: Record<string, unknown>) => {
          if (
            typeof item.arguments !== "string" ||
            !requestedTool(item.name, item.namespace) ||
            (item.id != null && typeof item.id !== "string") ||
            (item.call_id != null && typeof item.call_id !== "string") ||
            (item.id == null && item.call_id == null)
          )
            return false;
          if (!completed) return true;
          // A terminal item can omit the stream item id. Its call id still identifies the call.
          const id =
            typeof item.id === "string"
              ? item.id
              : [...calls].find(([, call]) => call.callId === item.call_id)?.[0];
          const call = id === undefined ? undefined : calls.get(id);
          if (
            id === undefined ||
            !call ||
            call.name !== item.name ||
            (item.call_id != null && call.callId !== undefined && item.call_id !== call.callId) ||
            call.digest !== argumentsDigest(item.arguments) ||
            confirmed.has(id)
          )
            return false;
          confirmed.add(id);
          return true;
        };
        if (
          !body ||
          (body.output !== undefined && !validResponseOutput(body.output, validCall)) ||
          (completed && confirmed.size !== calls.size)
        )
          return "invalid";
      }
    }
    const terminalText = () => {
      // The final response can carry text even when no text deltas arrived.
      if (!streamedText) {
        for (const text of completedAssistantText(body?.output)) {
          control.emit({ type: "text", text });
          if (isAborted()) break;
        }
      }
    };
    switch (value.type) {
      case "response.output_text.delta":
        if (typeof value.delta !== "string") return "invalid";
        if (value.delta) {
          streamedText = true;
          control.emit({ type: "text", text: value.delta });
        }
        return false;
      case "response.output_item.added": {
        const item = value.item;
        if (apiTools && (!object(item) || typeof item.type !== "string")) return "invalid";
        if (!object(item) || item.type !== "function_call") {
          control.emit({ type: "activity" });
          return false;
        }
        if (
          typeof item.id !== "string" ||
          (item.namespace !== undefined &&
            item.namespace !== null &&
            typeof item.namespace !== "string") ||
          typeof item.name !== "string" ||
          calls.has(item.id) ||
          (apiTools && item.arguments !== undefined && typeof item.arguments !== "string")
        )
          return "invalid";
        const namespace = typeof item.namespace === "string" ? item.namespace : null;
        const apiTool = requestedTool(item.name, item.namespace);
        if (apiTools && !apiTool) return "invalid";
        calls.set(item.id, {
          name: item.name,
          callId: typeof item.call_id === "string" ? item.call_id : undefined,
        });
        control.emit({
          type: "tool_start",
          id: item.id,
          namespace: apiTool?.namespace ?? namespace,
          name: item.name,
        });
        if (typeof item.arguments === "string" && item.arguments)
          control.emit({ type: "tool_arguments", id: item.id, text: item.arguments });
        return false;
      }
      case "response.function_call_arguments.delta":
        if (
          typeof value.item_id !== "string" ||
          !calls.has(value.item_id) ||
          ended.has(value.item_id) ||
          typeof value.delta !== "string"
        )
          return "invalid";
        control.emit({ type: "tool_arguments", id: value.item_id, text: value.delta });
        return false;
      case "response.function_call_arguments.done": {
        const id = value.item_id;
        if (typeof id !== "string" || ended.has(id)) return "invalid";
        const call = calls.get(id);
        const args = typeof value.arguments === "string" ? value.arguments : undefined;
        if (!call || (apiTools && args === undefined)) return "invalid";
        ended.add(id);
        control.emit({
          type: "tool_end",
          id,
          ...(args === undefined ? {} : { arguments: args }),
        });
        // Main owns the bounded argument buffer. Keep only a digest for terminal reconciliation.
        if (apiTools && args !== undefined && !isAborted()) call.digest = argumentsDigest(args);
        return false;
      }
      case "response.completed":
        if (!body) return "invalid";
        terminalText();
        if (!isAborted()) control.emit({ type: "result", result: { status: "completed" } });
        return true;
      case "response.failed":
        if (apiTools) terminalText();
        await fail(object(body?.error) ? body.error.code : undefined, "provider_error");
        return true;
      case "response.incomplete": {
        if (apiTools) terminalText();
        const details = body?.incomplete_details;
        await fail(
          undefined,
          apiTools && object(details) && details.reason === "max_output_tokens"
            ? "max_output_reached"
            : "provider_error",
        );
        return true;
      }
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
