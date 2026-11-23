import {
  isConversationTitleTool,
  openaiApiKeyConnection,
  utf8Size,
  type ProviderModel,
  type ProviderResult,
} from "@ohtia/contracts";
import { accountFingerprint } from "./account-fingerprint.js";
import { ApiKeySession } from "./api-key-session.js";
import { readResponseStream, responsesBody, responsesEndpoint } from "./chatgpt-responses.js";
import { object, providerJSON } from "./chatgpt-sign-in.js";
import type { CredentialStore, StoredSession } from "./credential-store.js";
import type { ApiKeyCheck, ProviderAdapter, ProviderRequests } from "./provider-adapter.js";
import {
  closeResponseTransport,
  isTransportFailure,
  nodeProviderTransport,
  type ProviderTransport,
} from "./provider-https.js";

export const openaiConnection = openaiApiKeyConnection.id;
const modelsEndpoint = "https://api.openai.com/v1/models";
const nativeTransport = nodeProviderTransport();
const reasoningEfforts = ["low", "medium", "high", "xhigh", "max"];
const optionalReasoning = ["none", ...reasoningEfforts];

const catalog: readonly ProviderModel[] = [
  catalogModel("gpt-6-astra", "GPT-6 Astra", reasoningEfforts),
  catalogModel("gpt-6.1-sol", "GPT-6.1 Sol", reasoningEfforts, "medium"),
  catalogModel("gpt-6.1-terra", "GPT-6.1 Terra", optionalReasoning, "medium"),
  catalogModel("gpt-6-luna", "GPT-6 Luna", optionalReasoning, "medium"),
];
function catalogModel(
  id: string,
  name: string,
  efforts: readonly string[],
  defaultEffort?: string,
): ProviderModel {
  return {
    id,
    name,
    origin: "catalog",
    effortSupport: "supported",
    effortLevels: efforts.map((name) => ({ name, supported: true })),
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
  };
}
function eligibleModels(body: unknown): readonly ProviderModel[] {
  if (!object(body) || !Array.isArray(body.data) || body.has_more === true)
    throw new Error("Incomplete OpenAI model list.");
  const available = new Map<string, boolean>();
  for (const model of body.data as unknown[]) {
    if (!object(model) || typeof model.id !== "string" || !model.id || available.has(model.id))
      throw new Error("Invalid OpenAI model list.");
    available.set(model.id, model.shutdown_date == null);
  }
  return catalog.filter((model) => available.get(model.id) === true);
}

const billingCodes = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);
function failed(reason: Extract<ProviderResult, { dispatched: true }>["reason"]) {
  return { status: "failed", dispatched: true, reason } as const;
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
async function readError(response: Response) {
  try {
    const body = await providerJSON(response, 64 * 1024);
    if (object(body) && object(body.error)) return body.error;
  } catch {
    // Status-based handling remains available when the error body is malformed.
  }
  return;
}
async function requestFailure(
  response: Response,
  key: string,
  received: number,
): Promise<ProviderResult> {
  const { status } = response;
  if (status === 401) return failed("connection_expired");
  if (status === 403) return failed("not_eligible");
  if (status === 404) return failed("model_unavailable");
  if (status === 429) {
    const code = (await readError(response))?.code;
    if (typeof code === "string" && billingCodes.has(code)) return failed("billing_limit_reached");
    const retry_not_before_at = retryDate(response.headers.get("retry-after"), received);
    return {
      ...failed("rate_limited"),
      ...(retry_not_before_at ? { retry_not_before_at } : {}),
    };
  }
  if (status >= 400 && status < 500) {
    const message = (await readError(response))?.message;
    return {
      ...failed("request_rejected"),
      ...(typeof message === "string" &&
      message &&
      utf8Size(message) <= 4096 &&
      !message.includes(key)
        ? { provider_message: message }
        : {}),
    };
  }
  return failed("provider_unavailable");
}

export class OpenAIProvider implements ProviderAdapter {
  readonly declaration = {
    id: "openai",
    version: "1.0.0",
    connection: openaiApiKeyConnection,
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
      readonly refresh: () => void;
      readonly transport?: ProviderTransport;
    },
  ) {
    this.session = new ApiKeySession(options.store, "openai-api-key", openaiConnection);
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
    check: (key: string, signal: AbortSignal) => this.listModels(key, signal),
    save: (key: string) => this.session.save(key),
  };
  private async listModels(key: string, signal: AbortSignal): Promise<ApiKeyCheck> {
    let response: Response;
    try {
      response = await this.transport(
        { url: modelsEndpoint, headers: { Authorization: `Bearer ${key}` }, signal },
        () => !signal.aborted,
      );
    } catch {
      return { reason: "key_check_unreachable" };
    }
    try {
      if (response.status === 401) return { reason: "key_rejected" };
      if (response.status === 403) return { reason: "key_not_permitted" };
      if (!response.ok) return { reason: "key_check_unavailable" };
      return { models: eligibleModels(await providerJSON(response)) };
    } catch {
      return { reason: "key_check_unavailable" };
    } finally {
      await closeResponseTransport(response);
    }
  }
  async probe(stored: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]> {
    const result = await this.listModels(stored.credential, signal);
    if ("reason" in result) throw new Error("OpenAI models unavailable.");
    return result.models;
  }
  readonly requests: ProviderRequests = {
    prepare: () => Promise.resolve("ready"),
    send: async (request, control) => {
      const stored = this.session.current();
      if (!stored) {
        control.emit({
          type: "result",
          result: { status: "failed", reason: "connection_expired", dispatched: false },
        });
        return;
      }
      // The data service can use a cached complete list for the same account after a failed
      // refresh. The shared dispatch guard checks that account and any newer list before release.
      const model = catalog.find(({ id }) => id === request.model);
      if (
        !model ||
        request.tools.some(
          (tool) => tool.namespace !== "ohtia" && !isConversationTitleTool(tool),
        ) ||
        (request.effort !== undefined &&
          !model.effortLevels?.some(({ name, supported }) => supported && name === request.effort))
      ) {
        control.emit({
          type: "result",
          result: { status: "failed", reason: "permit_expired", dispatched: false },
        });
        return;
      }
      const dispatch = { released: false, withdrawn: false };
      let response: Response;
      try {
        response = await this.transport(
          {
            url: responsesEndpoint,
            signal: control.signal,
            headers: {
              Authorization: `Bearer ${stored.key}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(responsesBody(request, "api_key")),
          },
          () => {
            if (control.signal.aborted) return false;
            if (this.session.isCurrent(stored)) {
              dispatch.released = control.release(
                accountFingerprint(openaiConnection, stored.instance),
              );
              dispatch.withdrawn = !dispatch.released;
              return dispatch.released;
            }
            dispatch.withdrawn = true;
            control.emit({
              type: "result",
              result: { status: "failed", reason: "permit_expired", dispatched: false },
            });
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
            : { status: "failed", reason: "provider_unavailable", dispatched: false },
        });
        return;
      }
      try {
        if (response.ok) {
          await readResponseStream(response, control, { apiTools: request.tools });
          return;
        }
        const result = await requestFailure(response, stored.key, Date.now());
        if (control.signal.aborted) return;
        if (response.status === 401) this.session.expire(stored, null);
        if (response.status === 404 && this.session.isCurrent(stored)) this.options.refresh();
        control.emit({ type: "result", result });
      } finally {
        await closeResponseTransport(response);
      }
    },
  };
}
