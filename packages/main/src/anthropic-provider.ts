import { APIConnectionError, APIError } from "@anthropic-ai/sdk/core/error";
import { BaseAnthropic } from "@anthropic-ai/sdk/client";
import {
  Messages,
  type MessageParam,
  type MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import { Models } from "@anthropic-ai/sdk/resources/models";
import { Stream } from "@anthropic-ai/sdk/core/streaming";
import { VERSION } from "@anthropic-ai/sdk/version";
import {
  anthropicApiKeyConnection,
  isProviderModel,
  providerTextPieces,
  utf8Size,
  type KeyCheckReason,
  type ProviderModel,
  type ProviderRequestData,
  type ProviderResult,
  type ProviderUsage,
} from "@ohtia/contracts";
import {
  closeResponseTransport,
  isTransportFailure,
  nodeProviderTransport,
} from "./provider-https.js";
import { accountFingerprint } from "./account-fingerprint.js";
import type { CredentialStore, StoredApiKey, StoredSession } from "./credential-store.js";
import type { ApiKeyCheck, ProviderAdapter, ProviderRequestControl } from "./provider-adapter.js";

export const anthropicConnection = anthropicApiKeyConnection.id;
const credentialAccount = "anthropic-api-key";
const baseURL = "https://api.anthropic.com";
const apiVersion = "2026-10-21";
const nativeTransport = nodeProviderTransport();
const effortLevels = ["low", "medium", "high", "xhigh", "max"] as const;

function client(
  key: string,
  resource: "models" | "messages",
  fetch: typeof globalThis.fetch | undefined,
  release?: () => boolean,
  received?: (at: number) => void,
) {
  let used = false;
  let response: Response | undefined;
  const sdk = new BaseAnthropic({
    apiKey: key,
    baseURL,
    webhookKey: null,
    maxRetries: 0,
    logLevel: "off",
    openTelemetry: { propagation: false, traces: false },
    defaultHeaders: { "anthropic-version": apiVersion },
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const method = resource === "messages" ? "POST" : "GET";
      const body = init?.body;
      if (
        !init ||
        init.method !== method ||
        url.origin !== baseURL ||
        url.pathname !== "/v1/" + resource ||
        url.username ||
        url.password ||
        url.hash ||
        (resource === "messages"
          ? url.search || typeof body !== "string"
          : body != null ||
            [...url.searchParams.keys()].some((name) => name !== "limit" && name !== "after_id"))
      )
        throw new Error("Invalid Anthropic endpoint.");
      const headers: Record<string, string> = {
        accept: "application/json",
        "anthropic-version": apiVersion,
        authorization: "Bearer " + key,
        "user-agent": "Anthropic/JS " + VERSION,
        ...(body == null ? {} : { "content-type": "application/json" }),
      };
      const maySend = () => {
        if (!release) return true;
        if (used || !release()) return false;
        used = true;
        return true;
      };
      const signal = init.signal ?? new AbortController().signal;
      const payload = typeof body === "string" ? { body } : {};
      if (fetch) {
        if (!maySend()) throw new Error("Provider dispatch was withdrawn.");
        response = await fetch(url, { method, headers, ...payload, signal, redirect: "error" });
      } else {
        response = await nativeTransport({ url: url.href, headers, signal, ...payload }, maySend);
      }
      received?.(Date.now());
      return response;
    },
  });
  return {
    models: new Models(sdk),
    messages: new Messages(sdk),
    async close() {
      if (!response) return;
      const current = response;
      response = undefined;
      await closeResponseTransport(current);
      if (current.body && !current.body.locked) await current.body.cancel().catch(() => {});
    },
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function modelEntry(raw: unknown): ProviderModel | undefined {
  const model = object(raw);
  if (!model) throw new Error("Invalid Anthropic model.");
  if (model.lifecycle !== "active" || model.max_tokens == null) return;
  const effort = object(object(model.capabilities)?.effort);
  const candidate = {
    id: model.id,
    name: model.display_name,
    maxOutput: model.max_tokens,
    ...(model.max_input_tokens == null ? {} : { maxInput: model.max_input_tokens }),
    origin: "service",
    effortSupport:
      effort?.supported === true
        ? "supported"
        : effort?.supported === false
          ? "unsupported"
          : "unknown",
    ...(effort?.supported === true
      ? {
          effortLevels: effortLevels.flatMap((name) => {
            const supported = object(effort[name])?.supported;
            return typeof supported === "boolean" ? [{ name, supported }] : [];
          }),
        }
      : {}),
  };
  if (!isProviderModel(candidate)) throw new Error("Invalid Anthropic model metadata.");
  return candidate;
}
async function listModels(
  key: string,
  signal: AbortSignal,
  fetch: typeof globalThis.fetch | undefined,
): Promise<ProviderModel[]> {
  const listing = client(key, "models", fetch);
  const models: ProviderModel[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let after_id: string | undefined;
  do {
    let page: Record<string, unknown> | undefined;
    try {
      const response = await listing.models
        .list(
          {
            limit: 1000,
            ...(after_id === undefined ? {} : { after_id }),
          },
          { signal },
        )
        .asResponse();
      page = object(await response.json());
    } finally {
      await listing.close();
    }
    if (!Array.isArray(page?.data) || page.data.length > 1000 || typeof page.has_more !== "boolean")
      throw new Error("Invalid Anthropic model page.");
    for (const raw of page.data as unknown[]) {
      const model = modelEntry(raw);
      if (!model) continue;
      if (ids.has(model.id)) throw new Error("Repeated Anthropic model.");
      ids.add(model.id);
      models.push(model);
    }
    if (!page.has_more) return models;
    if (
      page.data.length === 0 ||
      typeof page.last_id !== "string" ||
      !page.last_id ||
      cursors.has(page.last_id)
    )
      throw new Error("Missing Anthropic model page.");
    after_id = page.last_id;
    cursors.add(after_id);
  } while (!signal.aborted);
  throw new Error("Anthropic model listing was interrupted.");
}

function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}
function workspaceRequired(error: APIError) {
  return (
    error.status === 400 &&
    error.type === "invalid_request_error" &&
    typeof error.apiMessage === "string" &&
    error.apiMessage.startsWith("This API key is not scoped to a workspace")
  );
}
function checkReason(error: unknown): KeyCheckReason {
  if (error instanceof APIConnectionError) return "key_check_unreachable";
  if (isApiError(error)) {
    if (workspaceRequired(error)) return "key_needs_workspace";
    if (error.status === 401) return "key_rejected";
    if (error.status === 403) return "key_not_permitted";
  }
  return "key_check_unavailable";
}
function failed(reason: Extract<ProviderResult, { dispatched: true }>["reason"]): ProviderResult {
  return { status: "failed", dispatched: true, reason };
}
function retryDate(header: string | null | undefined, received: number): string | undefined {
  if (!header || !/^\d+$/.test(header)) return;
  const milliseconds = received + Number(header) * 1000;
  if (Number.isSafeInteger(milliseconds) && milliseconds <= Date.parse("9999-12-31T23:59:59.999Z"))
    return new Date(milliseconds).toISOString();
}
function requestError(error: APIError, key: string, received: number): ProviderResult {
  const message = typeof error.apiMessage === "string" ? error.apiMessage : "";
  if (error.status === 401 || workspaceRequired(error)) return failed("connection_expired");
  if (
    error.status === 402 ||
    (error.status === 429 &&
      error.type === "rate_limit_error" &&
      error.errorCode === "enforced_spend_limit_reached") ||
    (error.status === 400 &&
      error.type === "invalid_request_error" &&
      (message.startsWith("You have reached your specified API usage limits") ||
        message.startsWith("You have reached your specified workspace API usage limits")))
  )
    return failed("billing_limit_reached");
  if (error.status === 403) return failed("not_eligible");
  if (error.status === 404) return failed("model_unavailable");
  if (error.status === 429) {
    const retry_not_before_at = retryDate(error.headers?.get("retry-after"), received);
    return {
      status: "failed",
      dispatched: true,
      reason: "rate_limited",
      ...(retry_not_before_at ? { retry_not_before_at } : {}),
    };
  }
  if (error.status === 400 || error.status === 409 || error.status === 413) {
    return {
      status: "failed",
      dispatched: true,
      reason: "request_rejected",
      ...(message && utf8Size(message) <= 4096 && !message.includes(key)
        ? { provider_message: message }
        : {}),
    };
  }
  return failed("provider_unavailable");
}

function joinedInput(input: ProviderRequestData["input"]): MessageParam[] {
  const messages: MessageParam[] = [];
  for (const item of input) {
    const previous = messages.at(-1);
    if (previous?.role === item.role && typeof previous.content === "string")
      previous.content += "\n\n" + item.text;
    else messages.push({ role: item.role, content: item.text });
  }
  return messages;
}
function toolsFor(request: ProviderRequestData) {
  return new Map(request.tools.map((tool) => [tool.namespace + "_" + tool.name, tool]));
}
function requestBody(
  request: ProviderRequestData,
  max_tokens: number,
  tools: ReturnType<typeof toolsFor>,
): MessageCreateParamsStreaming {
  const effort = effortLevels.find((level) => level === request.effort);
  return {
    model: request.model,
    max_tokens,
    system: request.instructions,
    messages: joinedInput(request.input),
    ...(tools.size
      ? {
          tools: [...tools].map(([name, tool]) => ({
            name,
            description: tool.description,
            strict: true,
            eager_input_streaming: true,
            input_schema: { ...tool.parameters, required: [...tool.parameters.required] },
          })),
          tool_choice: { type: "auto" },
        }
      : {}),
    ...(effort ? { output_config: { effort } } : {}),
    stream: true,
  };
}

function usageAccumulator() {
  let uncached: number | null = null;
  let read: number | null = null;
  let created: number | null = null;
  let output: number | null = null;
  return (raw: unknown): ProviderUsage => {
    const usage = object(raw);
    uncached = tokenCount(usage?.input_tokens) ?? uncached;
    read = tokenCount(usage?.cache_read_input_tokens) ?? read;
    created = tokenCount(usage?.cache_creation_input_tokens) ?? created;
    output = tokenCount(usage?.output_tokens) ?? output;
    return {
      input_tokens: uncached === null ? null : tokenCount(uncached + (read ?? 0) + (created ?? 0)),
      cached_input_tokens: read,
      output_tokens: output,
      reasoning_tokens: null,
    };
  };
}
function stopped(reason: unknown, category: unknown): ProviderResult {
  switch (reason) {
    case "end_turn":
    case "tool_use":
      return { status: "completed" };
    case "max_tokens":
    case "model_context_window_exceeded":
      return failed("max_output_reached");
    case "refusal":
      return {
        status: "failed",
        dispatched: true,
        reason: "refused",
        ...(typeof category === "string" && /^[a-z0-9_]{1,64}$/.test(category)
          ? { refusal_category: category }
          : {}),
      };
    default:
      return failed("invalid_output");
  }
}
async function receive(
  response: Response,
  control: ProviderRequestControl,
  tools: ReturnType<typeof toolsFor>,
): Promise<ProviderResult> {
  let reason: unknown;
  let category: unknown;
  const usage = usageAccumulator();
  const toolBlocks = new Map<unknown, { id: string; initial?: string; streamed: boolean }>();
  const reportUsage = (raw: unknown) => {
    control.emit({ type: "usage", usage: usage(raw) });
  };
  const text = (value: string) => {
    for (const piece of providerTextPieces(value)) control.emit({ type: "text", text: piece });
  };
  for await (const sse of Stream.rawEvents(response)) {
    if (control.signal.aborted) return { status: "cancelled" };
    control.emit({ type: "activity" });
    if (sse.event === "ping") continue;
    if (sse.event === "error") return failed("provider_unavailable");
    let event: Record<string, unknown> | undefined;
    try {
      event = object(JSON.parse(sse.data));
    } catch {
      return failed("invalid_output");
    }
    if (!event || event.type !== sse.event) return failed("invalid_output");
    switch (event.type) {
      case "message_start": {
        const message = object(event.message);
        if (!message || typeof message.model !== "string") return failed("invalid_output");
        control.emit({
          type: "started",
          provider_request_id: response.headers.get("request-id"),
          model: message.model,
        });
        reportUsage(message.usage);
        break;
      }
      case "message_delta": {
        const delta = object(event.delta);
        if (!delta) return failed("invalid_output");
        reason = delta.stop_reason;
        category = object(delta.stop_details)?.category;
        reportUsage(event.usage);
        break;
      }
      case "content_block_start": {
        const block = object(event.content_block);
        if (block?.type === "text" && typeof block.text === "string") text(block.text);
        if (block?.type !== "tool_use") break;
        const tool = typeof block.name === "string" ? tools.get(block.name) : undefined;
        if (!tool || typeof block.id !== "string" || toolBlocks.has(event.index))
          return failed("invalid_output");
        const input = object(block.input);
        toolBlocks.set(event.index, {
          id: block.id,
          streamed: false,
          ...(input ? { initial: JSON.stringify(input) } : {}),
        });
        control.emit({
          type: "tool_start",
          id: block.id,
          namespace: tool.namespace,
          name: tool.name,
        });
        break;
      }
      case "content_block_delta": {
        const delta = object(event.delta);
        if (delta?.type === "text_delta" && typeof delta.text === "string") text(delta.text);
        if (delta?.type !== "input_json_delta") break;
        const block = toolBlocks.get(event.index);
        if (!block || typeof delta.partial_json !== "string") return failed("invalid_output");
        block.streamed = true;
        control.emit({ type: "tool_arguments", id: block.id, text: delta.partial_json });
        break;
      }
      case "content_block_stop": {
        const block = toolBlocks.get(event.index);
        if (!block) break;
        control.emit({
          type: "tool_end",
          id: block.id,
          ...(!block.streamed && block.initial ? { arguments: block.initial } : {}),
        });
        toolBlocks.delete(event.index);
        break;
      }
      case "message_stop":
        return stopped(reason, category);
    }
  }
  return { status: "uncertain", reason: "connection_lost" };
}

function session(value: StoredApiKey): StoredSession {
  return { credential: value.key, reason: null };
}
export class AnthropicProvider implements ProviderAdapter {
  readonly declaration = {
    id: "anthropic",
    version: "1.0.0",
    connection: anthropicApiKeyConnection,
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

  private current: StoredApiKey | undefined;
  private expired: string | undefined;
  private onExpired: ((state: "expired", reason: "key_needs_workspace" | null) => void) | undefined;
  constructor(
    private readonly options: {
      readonly store: CredentialStore;
      readonly model: (id: string) => ProviderModel | undefined;
      readonly refresh: () => void;
      readonly fetch?: typeof globalThis.fetch;
    },
  ) {}

  accountFingerprint(): string | undefined {
    return this.current && accountFingerprint(anthropicConnection, this.current.instance);
  }
  onStateChange(listener: NonNullable<AnthropicProvider["onExpired"]>) {
    this.onExpired = listener;
    return () => {
      this.onExpired = undefined;
    };
  }
  readonly credentials = {
    read: async () => {
      const stored = await this.options.store.readApiKey(credentialAccount);
      if (stored.status !== "stored") {
        this.current = undefined;
        return stored;
      }
      this.current = stored.value;
      return { status: "stored", value: session(stored.value) } as const;
    },
    write: () => Promise.resolve({ status: "unavailable" } as const),
    delete: async () => {
      const result = await this.options.store.deleteApiKey(credentialAccount);
      if (result.status === "stored") this.current = undefined;
      return result;
    },
  };
  connect(): ReturnType<ProviderAdapter["connect"]> {
    return Promise.resolve({ state: "error", reason: null });
  }
  readonly apiKey = {
    connectedAt: () => this.current?.connectedAt,
    check: async (key: string, signal: AbortSignal): Promise<ApiKeyCheck> => {
      try {
        return { models: await listModels(key, signal, this.options.fetch) };
      } catch (error) {
        return { reason: checkReason(error) };
      }
    },
    save: async (key: string) => {
      const result = await this.options.store.writeApiKey(credentialAccount, key);
      if (result.status !== "stored") return { status: "unavailable" } as const;
      this.current = result.value;
      this.expired = undefined;
      return { status: "stored" } as const;
    },
  };
  probe(stored: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]> {
    return listModels(stored.credential, signal, this.options.fetch);
  }
  readonly requests = {
    prepare: () => Promise.resolve("ready" as const),
    send: async (request: ProviderRequestData, control: ProviderRequestControl) => {
      const stored = this.current;
      if (!stored || stored.instance === this.expired) {
        control.emit({
          type: "result",
          result: { status: "failed", reason: "connection_expired", dispatched: false },
        });
        return;
      }
      const maximum = this.options.model(request.model)?.maxOutput;
      if (!maximum || (request.effort && !effortLevels.some((level) => level === request.effort))) {
        control.emit({
          type: "result",
          result: { status: "failed", reason: "provider_unavailable", dispatched: false },
        });
        return;
      }
      const dispatch = { released: false, superseded: false };
      let received = Date.now();
      let response: Response | undefined;
      let active: ReturnType<typeof client> | undefined;
      let result: ProviderResult;
      try {
        active = client(
          stored.key,
          "messages",
          this.options.fetch,
          () => {
            if (
              stored.instance !== this.current?.instance ||
              stored.instance === this.expired ||
              control.signal.aborted
            ) {
              dispatch.superseded = true;
              return false;
            }
            dispatch.released = control.release(
              accountFingerprint(anthropicConnection, stored.instance),
            );
            return dispatch.released;
          },
          (at) => {
            received = at;
          },
        );
        const tools = toolsFor(request);
        response = await active.messages
          .create(requestBody(request, maximum, tools), { signal: control.signal })
          .asResponse();
        result = await receive(response, control, tools);
      } catch (error) {
        if (control.signal.aborted) return;
        if (response) result = { status: "uncertain", reason: "connection_lost" };
        else if (!dispatch.released)
          result = {
            status: "failed",
            reason: dispatch.superseded ? "permit_expired" : "provider_unavailable",
            dispatched: false,
          };
        else if (isApiError(error) && typeof error.status === "number") {
          result = requestError(error, stored.key, received);
          if (
            result.status === "failed" &&
            result.reason === "connection_expired" &&
            stored.instance === this.current?.instance
          ) {
            this.expired = stored.instance;
            this.onExpired?.("expired", workspaceRequired(error) ? "key_needs_workspace" : null);
          }
          if (
            result.status === "failed" &&
            result.reason === "model_unavailable" &&
            stored.instance === this.current?.instance
          )
            this.options.refresh();
        } else if (error instanceof APIConnectionError && isTransportFailure(error.cause))
          result = error.cause.sent
            ? { status: "uncertain", reason: "connection_lost" }
            : failed("provider_unavailable");
        else result = failed("provider_unavailable");
      } finally {
        await active?.close();
      }
      control.emit({ type: "result", result });
    },
  };
}
