import {
  isConversationTitleTool,
  isProviderModel,
  isProviderModelSlug,
  openrouterConnection,
  providerTextPieces,
  utf8Size,
  type ProviderModel,
  type ProviderRequestData,
  type ProviderResult,
  type ProviderUsage,
} from "@ohtia/contracts";
import { accountFingerprint } from "./account-fingerprint.js";
import { ApiKeySession } from "./api-key-session.js";
import { object, providerJSON } from "./chatgpt-sign-in.js";
import type { CredentialStore, StoredSession } from "./credential-store.js";
import type {
  ApiKeyCheck,
  ProviderAdapter,
  ProviderRequestControl,
  ProviderRequests,
} from "./provider-adapter.js";
import {
  closeResponseTransport,
  isTransportFailure,
  nodeProviderTransport,
  type ProviderTransport,
} from "./provider-https.js";

export const openrouterConnectionId = openrouterConnection.id;
const keyEndpoint = "https://openrouter.ai/api/v1/key";
/** Without `limit` and `offset`, OpenRouter documents the full list filtered by the workspace. */
const modelsEndpoint = "https://openrouter.ai/api/v1/models/user";
const chatEndpoint = "/api/v1/chat/completions";
const completionsEndpoint = "https://openrouter.ai" + chatEndpoint;
/** OpenRouter's attribution headers, fixed by main. */
const referer = "https://ohtia.com";
const title = "Ohtia";
/** The public list of 477 models was 0.9 MB on 2026-11-26. */
const modelListBytes = 16 * 1024 * 1024;
const nativeTransport = nodeProviderTransport();
const effortVocabulary = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function positive(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}
/** The date when the key stops working, or undefined when it has none or OpenRouter sent none. */
function keyExpiry(body: unknown): string | undefined {
  // Only `expires_at` is read: `label` carries part of the key and nothing else is needed.
  const expires = object(body) && object(body.data) ? body.data.expires_at : undefined;
  if (typeof expires !== "string") return;
  const time = Date.parse(expires);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
function effort(model: Record<string, unknown>, parameters: readonly string[]) {
  const reasoning = model.reasoning;
  if (!parameters.includes("reasoning") || !object(reasoning))
    return { effortSupport: "unsupported" } as const;
  const declared = strings(reasoning.supported_efforts);
  const levels = effortVocabulary.filter(
    (level) => declared.includes(level) && !(level === "none" && reasoning.mandatory === true),
  );
  if (levels.length === 0) return { effortSupport: "unsupported" } as const;
  const fallback = reasoning.default_effort;
  return {
    effortSupport: "supported",
    effortLevels: levels.map((name) => ({ name, supported: true })),
    ...(typeof fallback === "string" && levels.some((level) => level === fallback)
      ? { defaultEffort: fallback }
      : {}),
  } as const;
}
/**
 * Concrete models that Chat Completions can call with tools. Routers choose the model themselves
 * (tokenizer `Router`), `~…-latest` aliases change it over time and `:batch` variants have no chat.
 */
function offered(model: Record<string, unknown>): ProviderModel | undefined {
  const { id, name } = model;
  const architecture = object(model.architecture) ? model.architecture : {};
  const parameters = strings(model.supported_parameters);
  if (
    typeof id !== "string" ||
    id.startsWith("~") ||
    typeof name !== "string" ||
    !name ||
    !strings(model.endpoints).includes(chatEndpoint) ||
    !strings(architecture.output_modalities).includes("text") ||
    !parameters.includes("tools") ||
    model.expiration_date != null ||
    architecture.tokenizer === "Router" ||
    model.alias_target != null
  )
    return;
  const maxInput = positive(model.context_length);
  const maxOutput = object(model.top_provider)
    ? positive(model.top_provider.max_completion_tokens)
    : undefined;
  return {
    id,
    name,
    origin: "service",
    ...effort(model, parameters),
    ...(maxInput ? { maxInput } : {}),
    ...(maxOutput ? { maxOutput } : {}),
  };
}
function offeredModels(body: unknown): readonly ProviderModel[] {
  if (!object(body) || !Array.isArray(body.data)) throw new Error("Invalid OpenRouter model list.");
  const data = body.data as unknown[];
  if (
    body.total_count !== data.length ||
    (body.links !== undefined && (!object(body.links) || body.links.next != null))
  )
    throw new Error("Incomplete OpenRouter model list.");
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const model of data) {
    if (!object(model) || typeof model.id !== "string" || !model.id || seen.has(model.id))
      throw new Error("Invalid OpenRouter model list.");
    seen.add(model.id);
    const entry = offered(model);
    // A model Ohtia's contract cannot carry, such as an identifier with a space, is not offered.
    if (entry && isProviderModel(entry)) models.push(entry);
  }
  return models;
}

function failed(reason: Extract<ProviderResult, { dispatched: true }>["reason"]) {
  return { status: "failed", dispatched: true, reason } as const;
}
function notSent(reason: "permit_expired" | "connection_expired" | "provider_unavailable") {
  return { status: "failed", dispatched: false, reason } as const;
}
function retryDate(header: string | null, received: number): string | undefined {
  if (!header) return;
  const deadline = /^\d+$/.test(header)
    ? received + Number(header) * 1000
    : /^[A-Z][a-z]{2}(?:,| )/.test(header) && header.includes(":")
      ? Date.parse(header)
      : NaN;
  if (
    Number.isSafeInteger(deadline) &&
    deadline >= received &&
    deadline <= Date.parse("9999-12-31T23:59:59.999Z")
  )
    return new Date(deadline).toISOString();
}
/** Spent budgets and key limits; OpenRouter documents them with 403 and the key limit also with 402. */
const spentLimits = new Set([
  "openrouter_credits",
  "openrouter_guardrail_budget",
  "openrouter_workspace_budget",
  "openrouter_key_limit",
]);
/**
 * Only `error.message` and `error.metadata.limit_source` are read. The rest of the body, including
 * `user_id` and the other metadata, is never kept, shown or logged.
 */
async function requestFailure(
  response: Response,
  key: string,
  received: number,
): Promise<ProviderResult> {
  const { status } = response;
  let message: unknown;
  let limitSource: unknown;
  if (status >= 400 && status < 500 && status !== 401 && status !== 404 && status !== 408)
    try {
      const body = await providerJSON(response, 64 * 1024);
      const error = object(body) && object(body.error) ? body.error : undefined;
      message = error?.message;
      limitSource = error && object(error.metadata) ? error.metadata.limit_source : undefined;
    } catch {
      // Status-based handling remains available when the error body is malformed.
    }
  const rateLimited = () => {
    const retry_not_before_at = retryDate(response.headers.get("retry-after"), received);
    return { ...failed("rate_limited"), ...(retry_not_before_at ? { retry_not_before_at } : {}) };
  };
  if (status === 401) return failed("connection_expired");
  if (status === 402)
    return limitSource === "openrouter_in_flight_budget"
      ? rateLimited()
      : failed("billing_limit_reached");
  if (status === 403)
    return typeof limitSource === "string" && spentLimits.has(limitSource)
      ? failed("billing_limit_reached")
      : failed("not_eligible");
  if (status === 404) return failed("model_unavailable");
  if (status === 429) return rateLimited();
  if (status >= 400 && status < 500 && status !== 408)
    return {
      ...failed("request_rejected"),
      ...(typeof message === "string" &&
      message &&
      wellFormed(message) &&
      utf8Size(message) <= 4096 &&
      !message.includes(key)
        ? { provider_message: message }
        : {}),
    };
  return failed("provider_unavailable");
}

/** Ohtia's tools under the names OpenRouter sees, as `ohtia_<tool>` like the Anthropic adapter. */
function toolsFor(request: ProviderRequestData) {
  return new Map(request.tools.map((tool) => [tool.namespace + "_" + tool.name, tool]));
}
/** The complete Chat Completions body; no other field is ever sent. */
function requestBody(
  request: ProviderRequestData,
  model: ProviderModel,
  tools: ReturnType<typeof toolsFor>,
) {
  const effort =
    request.effort !== undefined &&
    model.effortLevels?.some(({ name, supported }) => supported && name === request.effort)
      ? request.effort
      : undefined;
  return {
    model: request.model,
    stream: true,
    messages: [
      { role: "system", content: request.instructions },
      ...request.input.map(({ role, text }) => ({ role, content: text })),
    ],
    ...(tools.size
      ? {
          tools: [...tools].map(([name, tool]) => ({
            type: "function",
            function: {
              name,
              description: tool.description,
              parameters: tool.parameters,
              strict: true,
            },
          })),
          tool_choice: "auto",
        }
      : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    provider: { require_parameters: true },
  };
}
/** Text that UTF-8 can carry: a lone surrogate from a JSON escape cannot be measured or stored. */
function wellFormed(value: string): boolean {
  return !/\p{Cs}/u.test(value);
}
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function usageOf(raw: Record<string, unknown>): ProviderUsage {
  // `cost` and `cost_details` are not kept.
  const prompt = object(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const completion = object(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  return {
    input_tokens: tokenCount(raw.prompt_tokens),
    cached_input_tokens: tokenCount(prompt.cached_tokens),
    output_tokens: tokenCount(raw.completion_tokens),
    reasoning_tokens: tokenCount(completion.reasoning_tokens),
  };
}
function ending(reason: string): ProviderResult {
  switch (reason) {
    case "stop":
    case "tool_calls":
      return { status: "completed" };
    case "length":
      return failed("max_output_reached");
    case "content_filter":
    case "error":
      return failed("provider_error");
    default:
      return failed("invalid_output");
  }
}
/** Thrown when one event outgrows its bound; the reply then fails as invalid output. */
const oversizedEvent = new Error("OpenRouter event exceeded its bound.");
/** Server-sent events: `data:` lines joined until a blank line; lines starting with `:` are comments. */
async function* serverEvents(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let data: string[] = [];
  let size = 0;
  const lines = function* (final: boolean) {
    for (;;) {
      const end = buffer.search(/\r\n|\r|\n/);
      if (end < 0 || (!final && end === buffer.length - 1 && buffer.endsWith("\r"))) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + (buffer.startsWith("\r\n", end) ? 2 : 1));
      yield line;
    }
  };
  try {
    for (;;) {
      const next = await reader.read();
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      if (buffer.length > maxBytes) throw oversizedEvent;
      for (const line of lines(next.done)) {
        if (line === "") {
          if (data.length) yield { kind: "data", data: data.join("\n") } as const;
          data = [];
          size = 0;
        } else if (line.startsWith(":")) yield { kind: "comment" } as const;
        else if (line.startsWith("data:")) {
          const value = line.slice(line.startsWith("data: ") ? 6 : 5);
          size += value.length;
          if (size > maxBytes) throw oversizedEvent;
          data.push(value);
        }
        // Other fields (`event`, `id`, `retry`) carry nothing Ohtia reads.
      }
      // As for any event stream, an event the transport ends before its blank line is dropped.
      if (next.done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
interface ToolFragment {
  readonly id: string;
  readonly name: string;
  arguments: string;
}
/**
 * Read the stream until `[DONE]` or the end of the transport. The first `finish_reason` decides the
 * result; reading continues after it only to collect the usage chunk.
 */
async function receive(
  response: Response,
  control: ProviderRequestControl,
  request: ProviderRequestData,
  tools: ReturnType<typeof toolsFor>,
): Promise<ProviderResult | undefined> {
  if (!response.body) return { status: "uncertain", reason: "connection_lost" };
  let finish: string | undefined;
  let started = false;
  let served = false;
  let toolBytes = 0;
  const fragments = new Map<number, ToolFragment>();
  const maxEvent = Math.max(1024 * 1024, request.limits.max_output_bytes + 64 * 1024);
  try {
    for await (const event of serverEvents(response.body, maxEvent)) {
      if (control.signal.aborted) return;
      control.emit({ type: "activity" });
      if (event.kind === "comment") continue;
      if (event.data === "[DONE]") break;
      let chunk: unknown;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        return failed("invalid_output");
      }
      if (!object(chunk)) return failed("invalid_output");
      if (chunk.error != null) return failed("provider_error");
      if (!started && typeof chunk.model === "string" && chunk.model) {
        started = true;
        control.emit({
          type: "started",
          // Metadata the contract cannot carry is left unknown rather than failing the reply.
          provider_request_id:
            typeof chunk.id === "string" &&
            chunk.id &&
            wellFormed(chunk.id) &&
            utf8Size(chunk.id) <= 256
              ? chunk.id
              : null,
          model: isProviderModelSlug(chunk.model) ? chunk.model : null,
        });
      }
      // Only the company that delivered the reply is named; main checks its form.
      if (!served && typeof chunk.provider === "string" && chunk.provider) {
        served = true;
        control.emit({ type: "served_by", name: chunk.provider });
      }
      if (object(chunk.usage)) control.emit({ type: "usage", usage: usageOf(chunk.usage) });
      if (chunk.choices == null) continue;
      if (!Array.isArray(chunk.choices)) return failed("invalid_output");
      for (const raw of chunk.choices as unknown[]) {
        const choice = object(raw) ? raw : undefined;
        if (!choice || (choice.index !== undefined && choice.index !== 0))
          return failed("invalid_output");
        const delta = choice.delta == null ? {} : choice.delta;
        if (!object(delta)) return failed("invalid_output");
        // `delta.reasoning` and `delta.reasoning_details` are neither kept nor shown.
        if (typeof delta.content === "string" && delta.content && finish === undefined)
          for (const piece of providerTextPieces(delta.content))
            control.emit({ type: "text", text: piece });
        if (delta.tool_calls != null && finish === undefined) {
          if (!Array.isArray(delta.tool_calls)) return failed("invalid_output");
          for (const raw of delta.tool_calls as unknown[]) {
            const call = object(raw) ? raw : undefined;
            const index = call?.index;
            if (!call || !Number.isSafeInteger(index) || (index as number) < 0)
              return failed("invalid_output");
            const fn = call.function == null ? {} : call.function;
            if (!object(fn)) return failed("invalid_output");
            let fragment = fragments.get(index as number);
            if (!fragment) {
              if (
                typeof call.id !== "string" ||
                !call.id ||
                !wellFormed(call.id) ||
                typeof fn.name !== "string" ||
                !wellFormed(fn.name)
              )
                return failed("invalid_output");
              // Each call's id and name count with its arguments, so no stream can grow them unbounded.
              toolBytes += utf8Size(call.id) + utf8Size(fn.name);
              if (toolBytes > request.limits.max_output_bytes)
                return failed("output_limit_exceeded");
              fragment = { id: call.id, name: fn.name, arguments: "" };
              fragments.set(index as number, fragment);
            }
            if (fn.arguments != null) {
              if (typeof fn.arguments !== "string" || !wellFormed(fn.arguments))
                return failed("invalid_output");
              toolBytes += utf8Size(fn.arguments);
              if (toolBytes > request.limits.max_output_bytes)
                return failed("output_limit_exceeded");
              fragment.arguments += fn.arguments;
            }
          }
        }
        if (choice.finish_reason === "error") return failed("provider_error");
        if (choice.finish_reason != null && finish === undefined) {
          if (typeof choice.finish_reason !== "string") return failed("invalid_output");
          finish = choice.finish_reason;
        }
      }
    }
  } catch (error) {
    if (control.signal.aborted) return;
    if (error === oversizedEvent) return failed("invalid_output");
    // The connection dropped: a finish already read still decides the result.
    if (finish === undefined) return { status: "uncertain", reason: "connection_lost" };
  }
  if (finish === undefined) return { status: "uncertain", reason: "connection_lost" };
  const result = ending(finish);
  // Tool calls take effect only in a reply that completes with them; otherwise they are dropped.
  if (finish === "tool_calls")
    for (const fragment of [...fragments].sort(([a], [b]) => a - b).map(([, value]) => value)) {
      const tool = tools.get(fragment.name);
      if (!tool) return failed("invalid_output");
      control.emit({
        type: "tool_start",
        id: fragment.id,
        namespace: tool.namespace,
        name: tool.name,
      });
      if (fragment.arguments)
        control.emit({ type: "tool_arguments", id: fragment.id, text: fragment.arguments });
      control.emit({ type: "tool_end", id: fragment.id });
    }
  return result;
}

/**
 * Connects OpenRouter with a pasted key, reads its model list and sends research requests through
 * Chat Completions. OpenRouter chooses the serving company inside the workspace guardrails.
 */
export class OpenRouterProvider implements ProviderAdapter {
  readonly declaration = {
    id: "openrouter",
    version: "1.0.0",
    connection: openrouterConnection,
    signInModes: ["api_key"],
    capabilities: {
      text: true,
      attachments: false,
      structuredOutput: false,
      streaming: true,
      tools: true,
      interruption: true,
      resumption: false,
      modelSelection: true,
      effortSelection: true,
      usageReporting: true,
      late_usage: "none",
    },
  } as const;

  private readonly session: ApiKeySession;
  private readonly transport: ProviderTransport;
  readonly credentials: ProviderAdapter["credentials"];
  constructor(
    private readonly options: {
      readonly store: CredentialStore;
      /** The model as it appears in the connection's current offered list. */
      readonly model: (id: string) => ProviderModel | undefined;
      /** Read the model list again, after OpenRouter no longer serves a chosen model. */
      readonly refresh: () => void;
      readonly transport?: ProviderTransport;
    },
  ) {
    this.session = new ApiKeySession(options.store, "openrouter-api-key", openrouterConnectionId);
    this.credentials = this.session.credentials;
    this.transport = options.transport ?? nativeTransport;
  }
  accountFingerprint() {
    return this.session.accountFingerprint();
  }
  onStateChange(listener: Parameters<ApiKeySession["onStateChange"]>[0]) {
    return this.session.onStateChange(listener);
  }
  connect(signal: AbortSignal): ReturnType<ProviderAdapter["connect"]> {
    return this.session.connect(signal);
  }
  readonly apiKey = {
    connectedAt: () => this.session.connectedAt(),
    expiresAt: () => this.session.expiresAt(),
    check: (key: string, signal: AbortSignal) => this.check(key, signal),
    save: (key: string, checked?: { readonly expiresAt?: string }) =>
      this.session.save(key, checked?.expiresAt),
  };
  private async get(url: string, key: string, signal: AbortSignal): Promise<Response> {
    return await this.transport(
      { url, headers: { Authorization: `Bearer ${key}` }, signal },
      () => !signal.aborted,
    );
  }
  private async check(key: string, signal: AbortSignal): Promise<ApiKeyCheck> {
    let expiresAt: string | undefined;
    let response: Response;
    try {
      response = await this.get(keyEndpoint, key, signal);
    } catch {
      return { reason: "key_check_unreachable" };
    }
    try {
      if (response.status === 401) return { reason: "key_rejected" };
      if (response.status === 403) return { reason: "key_not_permitted" };
      if (!response.ok) return { reason: "key_check_unavailable" };
      expiresAt = keyExpiry(await providerJSON(response, 64 * 1024));
    } catch {
      return { reason: "key_check_unavailable" };
    } finally {
      await closeResponseTransport(response);
    }
    try {
      response = await this.get(modelsEndpoint, key, signal);
    } catch {
      return { reason: "key_check_unreachable" };
    }
    try {
      if (!response.ok) return { reason: "key_check_unavailable" };
      const models = offeredModels(await providerJSON(response, modelListBytes));
      return { models, ...(expiresAt ? { expiresAt } : {}) };
    } catch {
      return { reason: "key_check_unavailable" };
    } finally {
      await closeResponseTransport(response);
    }
  }
  async probe(stored: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]> {
    const current = this.session.current();
    const result = await this.check(stored.credential, signal);
    if ("reason" in result) throw new Error("OpenRouter models unavailable.");
    // "Test connection" rereads the expiry of the key it checked, never of a replacement.
    if (current?.key === stored.credential)
      await this.session.updateExpiry(current, result.expiresAt);
    return result.models;
  }
  readonly requests: ProviderRequests = {
    prepare: () => Promise.resolve("ready"),
    send: async (request, control) => {
      const stored = this.session.current();
      if (!stored) {
        control.emit({ type: "result", result: notSent("connection_expired") });
        return;
      }
      const model = this.options.model(request.model);
      if (
        !model ||
        request.tools.some((tool) => tool.namespace !== "ohtia" && !isConversationTitleTool(tool))
      ) {
        control.emit({ type: "result", result: notSent("permit_expired") });
        return;
      }
      const tools = toolsFor(request);
      const dispatch = { released: false, withdrawn: false };
      let response: Response;
      try {
        response = await this.transport(
          {
            url: completionsEndpoint,
            signal: control.signal,
            headers: {
              Authorization: `Bearer ${stored.key}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              "HTTP-Referer": referer,
              "X-OpenRouter-Title": title,
            },
            body: JSON.stringify(requestBody(request, model, tools)),
          },
          () => {
            if (control.signal.aborted) return false;
            if (this.session.isCurrent(stored)) {
              dispatch.released = control.release(
                accountFingerprint(openrouterConnectionId, stored.instance),
              );
              dispatch.withdrawn = !dispatch.released;
              return dispatch.released;
            }
            dispatch.withdrawn = true;
            control.emit({ type: "result", result: notSent("permit_expired") });
            return false;
          },
        );
      } catch (error) {
        if (control.signal.aborted || dispatch.withdrawn) return;
        const sent = isTransportFailure(error) ? error.sent : dispatch.released;
        control.emit({
          type: "result",
          result: sent
            ? { status: "uncertain", reason: "connection_lost" }
            : notSent("provider_unavailable"),
        });
        return;
      }
      const received = Date.now();
      try {
        if (response.ok) {
          const result = await receive(response, control, request, tools);
          if (result) control.emit({ type: "result", result });
          return;
        }
        const result = await requestFailure(response, stored.key, received);
        if (control.signal.aborted) return;
        // A result for an earlier key never expires its replacement or rereads the new list.
        if (response.status === 401) this.session.expire(stored, null);
        if (response.status === 404 && this.session.isCurrent(stored)) this.options.refresh();
        control.emit({ type: "result", result });
      } finally {
        await closeResponseTransport(response);
        if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    },
  };
}
