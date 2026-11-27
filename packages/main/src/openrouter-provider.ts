import { isProviderModel, openrouterConnection, type ProviderModel } from "@ohtia/contracts";
import { ApiKeySession } from "./api-key-session.js";
import { object, providerJSON } from "./chatgpt-sign-in.js";
import type { CredentialStore, StoredSession } from "./credential-store.js";
import type { ApiKeyCheck, ProviderAdapter } from "./provider-adapter.js";
import {
  closeResponseTransport,
  nodeProviderTransport,
  type ProviderTransport,
} from "./provider-https.js";

export const openrouterConnectionId = openrouterConnection.id;
const keyEndpoint = "https://openrouter.ai/api/v1/key";
/** Without `limit` and `offset`, OpenRouter documents the full list filtered by the workspace. */
const modelsEndpoint = "https://openrouter.ai/api/v1/models/user";
const chatEndpoint = "/api/v1/chat/completions";
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

/**
 * Connects OpenRouter with a pasted key and reads its model list. It sends no research request:
 * the declaration has no `text` capability, and main reports no model list for it.
 */
export class OpenRouterProvider implements ProviderAdapter {
  readonly declaration = {
    id: "openrouter",
    version: "1.0.0",
    connection: openrouterConnection,
    signInModes: ["api_key"],
    capabilities: {
      text: false,
      attachments: false,
      structuredOutput: false,
      streaming: false,
      tools: false,
      interruption: false,
      resumption: false,
      modelSelection: true,
      effortSelection: true,
      usageReporting: false,
      late_usage: "none",
    },
  } as const;

  private readonly session: ApiKeySession;
  private readonly transport: ProviderTransport;
  readonly credentials: ProviderAdapter["credentials"];
  constructor(options: {
    readonly store: CredentialStore;
    readonly transport?: ProviderTransport;
  }) {
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
}
