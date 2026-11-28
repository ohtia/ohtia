import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultProviderConnections,
  isConnectionSnapshot,
  isUsagePauseConnection,
  usagePauseConnections,
  type ConnectionEvent,
  type DiagnosticEvent,
} from "../packages/contracts/src/index.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { CredentialStore } from "../packages/main/src/credential-store.js";
import {
  OpenRouterProvider,
  openrouterConnectionId as openrouter,
} from "../packages/main/src/openrouter-provider.js";
import { transportFailure, type ProviderTransport } from "../packages/main/src/provider-https.js";

const key = "sk-or-v1-synthetic-openrouter-key";
const replacement = "sk-or-v1-synthetic-replacement";
const expiry = "2026-12-03T10:00:00.000Z";
const later = "2026-12-10T10:00:00.000Z";

type Model = Record<string, unknown>;
/** A concrete chat model with tools, as `/models/user` lists one. */
function model(id: string, overrides: Model = {}): Model {
  return {
    id,
    canonical_slug: id,
    name: `Synthetic ${id}`,
    context_length: 1_048_576,
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
      tokenizer: "Other",
    },
    top_provider: { context_length: 1_048_576, max_completion_tokens: 65_536 },
    supported_parameters: ["max_tokens", "tools", "tool_choice"],
    expiration_date: null,
    endpoints: ["/api/v1/chat/completions", "/api/v1/responses"],
    ...overrides,
  };
}
function list(data: Model[], extra: Model = {}) {
  return Response.json({
    data,
    total_count: data.length,
    links: { self: "/api/v1/models/user", next: null },
    ...extra,
  });
}
function keyInfo(expires_at: string | null = expiry) {
  // `label` carries part of the key; Ohtia must never read or forward it.
  return Response.json({
    data: {
      label: "sk-or-v1-syn…key",
      limit: null,
      usage: 0,
      expires_at,
      user_id: "user_synthetic",
    },
  });
}
const kimi = model("moonshotai/kimi-k3.1-pro", {
  supported_parameters: ["tools", "reasoning", "include_reasoning"],
  reasoning: {
    mandatory: false,
    default_enabled: true,
    supported_efforts: ["max", "high", "low", "none"],
    default_effort: "max",
  },
});
const argon = model("google/gemini-4-argon", {
  supported_parameters: ["tools", "reasoning"],
  reasoning: {
    mandatory: true,
    supported_efforts: ["high", "medium", "low", "none"],
    default_effort: "medium",
  },
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
});

function harness({
  keyResponse = () => keyInfo(),
  models = () => list([kimi, argon]),
}: { keyResponse?: () => Response; models?: () => Response } = {}) {
  const entries = new Map<string, string>();
  const diagnostics: DiagnosticEvent[] = [];
  const events: ConnectionEvent[] = [];
  const store = new CredentialStore({
    service: "Synthetic",
    userData: "/unused",
    platform: "linux",
    entry: (_service, account) => ({
      getPassword: async () => entries.get(account) ?? null,
      setPassword: async (value) => {
        entries.set(account, value);
      },
      deleteCredential: async () => entries.delete(account),
    }),
  });
  const responses = { key: keyResponse, models };
  const send = vi.fn<ProviderTransport>(async (outgoing, release) => {
    expect(outgoing.body).toBeUndefined();
    expect(Object.keys(outgoing.headers)).toEqual(["Authorization"]);
    if (!release()) throw transportFailure(false);
    const url = new URL(outgoing.url);
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.search).toBe("");
    if (url.pathname === "/api/v1/key") return responses.key();
    expect(url.pathname).toBe("/api/v1/models/user");
    return responses.models();
  });
  const provider = new OpenRouterProvider({
    store,
    transport: send,
    model: () => undefined,
    refresh: () => {},
  });
  const manager = new ConnectionManager([provider], (event) => diagnostics.push(event));
  manager.subscribe((event) => events.push(event));
  cleanup.push(() => manager.dispose());
  return {
    provider,
    manager,
    send,
    entries,
    responses,
    events,
    diagnostics,
    async connect(value = key) {
      expect(manager.connect(openrouter, { key: value })).toMatchObject({
        value: { state: "connecting", checking_key: true },
      });
      await vi.waitFor(() => expect(manager.snapshot(openrouter)?.checking_key).toBeUndefined());
      return manager.snapshot(openrouter)!;
    },
    async models() {
      const page = manager.listModels({
        connection: openrouter,
        model_list_revision: manager.snapshot(openrouter)!.model_list_revision!,
        cursor: 0,
        count: 128,
      });
      if (!page.ok) throw new Error("No model page.");
      return page.value.models;
    },
  };
}

describe("OpenRouter declaration", () => {
  it("connects with a pasted key or a sign-in and declares requests with text, streaming, tools and Stop", () => {
    const { provider } = harness();
    expect(provider.declaration).toEqual({
      id: "openrouter",
      version: "1.0.0",
      connection: {
        id: "openrouter",
        displayName: "OpenRouter",
        kind: "api_key",
        usageUrl: "https://openrouter.ai/settings/credits",
      },
      signInModes: ["api_key", "provider_login"],
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
    });
    expect(provider.requests).toBeDefined();
    expect(defaultProviderConnections.at(-1)).toEqual(provider.declaration.connection);
  });

  it("pauses OpenRouter requests like the other API-key connections", () => {
    expect(usagePauseConnections).toEqual([
      "chatgpt",
      "anthropic_api_key",
      "openai_api_key",
      "openrouter",
    ]);
    expect(isUsagePauseConnection(openrouter)).toBe(true);
  });
});

describe("OpenRouter key check", () => {
  it("checks the key, reads the full list once and stores the key with its expiry", async () => {
    const h = harness();
    const snapshot = await h.connect();
    expect(snapshot).toMatchObject({ state: "connected", reason: null, expires_at: expiry });
    expect(isConnectionSnapshot(snapshot)).toBe(true);
    expect(h.send.mock.calls.map(([outgoing]) => outgoing.url)).toEqual([
      "https://openrouter.ai/api/v1/key",
      "https://openrouter.ai/api/v1/models/user",
    ]);
    for (const [outgoing] of h.send.mock.calls)
      expect(outgoing.headers).toEqual({ Authorization: `Bearer ${key}` });
    const stored = JSON.parse(h.entries.get("openrouter-api-key")!) as Record<string, string>;
    expect(stored).toEqual({ key, instance: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(JSON.parse(h.entries.get("openrouter-api-key-dates")!)).toEqual({
      [stored.instance!]: { connected: snapshot.connected_at, expires: expiry },
    });
    const text = JSON.stringify([...h.events, ...h.diagnostics, await h.models()]);
    for (const secret of [key, "sk-or-v1-syn…key", "user_synthetic"])
      expect(text).not.toContain(secret);
  });

  it("shows no expiry for a key without one", async () => {
    const h = harness({ keyResponse: () => keyInfo(null) });
    const snapshot = await h.connect();
    expect(snapshot.state).toBe("connected");
    expect(snapshot).not.toHaveProperty("expires_at");
    const stored = JSON.parse(h.entries.get("openrouter-api-key")!) as { instance: string };
    expect(JSON.parse(h.entries.get("openrouter-api-key-dates")!)).toEqual({
      [stored.instance]: snapshot.connected_at,
    });
  });

  it.each([
    ["a rejected key", () => new Response("{}", { status: 401 }), "key_rejected"],
    ["a key without permission", () => new Response("{}", { status: 403 }), "key_not_permitted"],
    ["a service failure", () => new Response("{}", { status: 503 }), "key_check_unavailable"],
    ["an unparseable answer", () => new Response("not json"), "key_check_unavailable"],
  ] as const)("stores nothing for %s", async (_name, keyResponse, reason) => {
    const h = harness({ keyResponse });
    expect(await h.connect()).toMatchObject({ state: "disconnected", reason });
    expect(h.entries.size).toBe(0);
    expect(h.send).toHaveBeenCalledOnce();
  });

  it("stores nothing when OpenRouter cannot be reached", async () => {
    const h = harness({
      keyResponse: () => {
        throw transportFailure(false);
      },
    });
    expect(await h.connect()).toMatchObject({
      state: "disconnected",
      reason: "key_check_unreachable",
    });
    expect(h.entries.size).toBe(0);
  });

  it("treats a check without an answer as unreachable", async () => {
    vi.useFakeTimers();
    cleanup.push(() => vi.useRealTimers());
    const h = harness({ keyResponse: () => new Promise<Response>(() => {}) as never });
    h.manager.connect(openrouter, { key });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.manager.snapshot(openrouter)).toMatchObject({
      state: "disconnected",
      reason: "key_check_unreachable",
    });
    expect(h.entries.size).toBe(0);
  });

  it.each([
    ["a failed read", () => new Response("{}", { status: 500 })],
    ["a rejected read", () => new Response("{}", { status: 401 })],
    ["a short count", () => list([kimi], { total_count: 2 })],
    ["a next page", () => list([kimi], { links: { next: "/api/v1/models/user?offset=1" } })],
    ["a repeated identifier", () => list([kimi, kimi])],
    ["a list that is not one", () => Response.json({ data: {}, total_count: 0 })],
  ] as const)("stores nothing after %s of the model list", async (_name, models) => {
    const h = harness({ models });
    expect(await h.connect()).toMatchObject({
      state: "disconnected",
      reason: "key_check_unavailable",
    });
    expect(h.entries.size).toBe(0);
  });

  it("connects with an empty list when no model can be offered", async () => {
    const h = harness({
      models: () =>
        list([
          model("openrouter/free", {
            architecture: { output_modalities: ["text"], tokenizer: "Router" },
          }),
        ]),
    });
    expect(await h.connect()).toMatchObject({ state: "connected", model_count: 0 });
  });
});

describe("OpenRouter model list", () => {
  it("offers only concrete chat models with tools and maps their limits", async () => {
    const h = harness({
      models: () =>
        list([
          model("openrouter/auto", {
            architecture: { output_modalities: ["text"], tokenizer: "Router" },
          }),
          model("~moonshotai/kimi-latest", {
            architecture: { output_modalities: ["text"], tokenizer: "Router" },
            alias_target: { name: "Kimi", slug: "moonshotai/kimi-k3.1-pro" },
          }),
          model("some/alias", { alias_target: { slug: "some/model" } }),
          model("moonshotai/kimi-k3.1-pro:batch", { endpoints: ["/api/v1/batches"] }),
          model("image/only", {
            architecture: { output_modalities: ["image"], tokenizer: "Other" },
          }),
          model("no/tools", { supported_parameters: ["max_tokens"] }),
          model("old/model", { expiration_date: "2026-12-31" }),
          model("bad id/with space"),
          model("liquid/lfm-3-1.7b:free", { context_length: 0, top_provider: {} }),
          kimi,
        ]),
    });
    await h.connect();
    expect(await h.models()).toEqual([
      {
        id: "liquid/lfm-3-1.7b:free",
        name: "Synthetic liquid/lfm-3-1.7b:free",
        origin: "service",
        effortSupport: "unsupported",
      },
      {
        id: "moonshotai/kimi-k3.1-pro",
        name: "Synthetic moonshotai/kimi-k3.1-pro",
        origin: "service",
        effortSupport: "supported",
        effortLevels: ["none", "low", "high", "max"].map((name) => ({ name, supported: true })),
        defaultEffort: "max",
        maxInput: 1_048_576,
        maxOutput: 65_536,
      },
    ]);
  });

  it("derives effort from the declared levels and hides none when reasoning is mandatory", async () => {
    const h = harness({
      models: () =>
        list([
          argon,
          model("reasoning/object-missing", { supported_parameters: ["tools", "reasoning"] }),
          model("reasoning/not-supported", {
            reasoning: { supported_efforts: ["high"], default_effort: "high" },
          }),
          model("reasoning/unknown-default", {
            supported_parameters: ["tools", "reasoning"],
            reasoning: { supported_efforts: ["high", "turbo"], default_effort: "turbo" },
          }),
        ]),
    });
    await h.connect();
    const models = await h.models();
    expect(
      models.map(({ id, effortSupport, effortLevels, defaultEffort }) => ({
        id,
        effortSupport,
        effortLevels,
        defaultEffort,
      })),
    ).toEqual([
      {
        id: "google/gemini-4-argon",
        effortSupport: "supported",
        effortLevels: ["low", "medium", "high"].map((name) => ({ name, supported: true })),
        defaultEffort: "medium",
      },
      {
        id: "reasoning/object-missing",
        effortSupport: "unsupported",
        effortLevels: undefined,
        defaultEffort: undefined,
      },
      {
        id: "reasoning/not-supported",
        effortSupport: "unsupported",
        effortLevels: undefined,
        defaultEffort: undefined,
      },
      {
        id: "reasoning/unknown-default",
        effortSupport: "supported",
        effortLevels: [{ name: "high", supported: true }],
        defaultEffort: undefined,
      },
    ]);
  });
});

describe("OpenRouter key replacement and Test connection", () => {
  it("replaces the key with a new instance and fingerprint", async () => {
    const h = harness();
    await h.connect();
    const first = h.manager.account(openrouter).fingerprint;
    h.responses.key = () => keyInfo(later);
    h.manager.replaceKey(openrouter, replacement);
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.checking_key).toBeUndefined());
    expect(h.manager.snapshot(openrouter)).toMatchObject({ state: "connected", expires_at: later });
    expect(h.manager.account(openrouter).fingerprint).not.toBe(first);
    expect(JSON.parse(h.entries.get("openrouter-api-key")!)).toMatchObject({ key: replacement });
  });

  it("rereads the expiry on Test connection", async () => {
    const h = harness();
    await h.connect();
    h.responses.key = () => keyInfo(later);
    h.manager.probe(openrouter);
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.probing).toBe(false));
    expect(h.manager.snapshot(openrouter)?.expires_at).toBe(later);
    const stored = JSON.parse(h.entries.get("openrouter-api-key")!) as { instance: string };
    expect(JSON.parse(h.entries.get("openrouter-api-key-dates")!)[stored.instance]).toMatchObject({
      expires: later,
    });
  });

  it("discards a Test connection still running when the key is replaced", async () => {
    const h = harness();
    await h.connect();
    const firstList = h.manager.snapshot(openrouter)!.model_list_revision;
    let answer!: (response: Response) => void;
    h.responses.key = () => new Promise<Response>((resolve) => (answer = resolve)) as never;
    h.manager.probe(openrouter);
    await vi.waitFor(() => expect(answer).toBeDefined());
    const pending = answer;
    h.responses.key = () => keyInfo(later);
    h.manager.replaceKey(openrouter, replacement);
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.checking_key).toBeUndefined());
    const replaced = h.manager.snapshot(openrouter)!;
    pending(keyInfo("2027-01-01T00:00:00.000Z"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.manager.snapshot(openrouter)).toMatchObject({
      expires_at: later,
      model_list_revision: replaced.model_list_revision,
    });
    expect(replaced.model_list_revision).not.toBe(firstList);
  });

  it("disconnects by deleting only the local key and its dates", async () => {
    const h = harness();
    await h.connect();
    await h.manager.disconnect(openrouter);
    expect(h.manager.snapshot(openrouter)?.state).toBe("disconnected");
    expect(h.entries.size).toBe(0);
    expect(h.send).toHaveBeenCalledTimes(2);
  });
});

describe("OpenRouter key dates in the credential store", () => {
  function store() {
    const entries = new Map<string, string>();
    const writes: string[] = [];
    return {
      entries,
      writes,
      store: new CredentialStore({
        service: "Synthetic",
        userData: "/unused",
        platform: "linux",
        entry: (_service, account) => ({
          getPassword: async () => entries.get(account) ?? null,
          setPassword: async (value) => {
            writes.push(account);
            entries.set(account, value);
          },
          deleteCredential: async () => entries.delete(account),
        }),
      }),
    };
  }
  const instance = "a".repeat(32);
  it("reads both date forms and ignores damaged entries", async () => {
    const s = store();
    s.entries.set("openrouter-api-key", JSON.stringify({ key, instance }));
    s.entries.set(
      "openrouter-api-key-dates",
      JSON.stringify({
        [instance]: { connected: "2026-11-26T10:00:00.000Z", expires: "never" },
        bad: "2026-01-01",
      }),
    );
    expect(await s.store.readApiKey("openrouter-api-key")).toEqual({
      status: "stored",
      value: { key, instance, connectedAt: "2026-11-26T10:00:00.000Z" },
    });
    s.entries.set("openrouter-api-key-dates", JSON.stringify({ [instance]: { expires: expiry } }));
    expect(await s.store.readApiKey("openrouter-api-key")).toEqual({
      status: "stored",
      value: { key, instance },
    });
  });

  it("updates an expiry only for the stored key and its dates", async () => {
    const s = store();
    expect(await s.store.updateApiKeyExpiry("openrouter-api-key", instance, expiry)).toEqual({
      status: "unavailable",
    });
    s.entries.set("openrouter-api-key", JSON.stringify({ key, instance: "b".repeat(32) }));
    expect(await s.store.updateApiKeyExpiry("openrouter-api-key", instance, expiry)).toEqual({
      status: "unavailable",
    });
    s.entries.set("openrouter-api-key", JSON.stringify({ key, instance }));
    expect(await s.store.updateApiKeyExpiry("openrouter-api-key", instance, expiry)).toEqual({
      status: "unavailable",
    });
    s.entries.set(
      "openrouter-api-key-dates",
      JSON.stringify({ [instance]: "2026-11-26T10:00:00.000Z" }),
    );
    expect(await s.store.updateApiKeyExpiry("openrouter-api-key", instance, undefined)).toEqual({
      status: "stored",
    });
    expect(s.writes).toEqual([]);
    expect(await s.store.updateApiKeyExpiry("openrouter-api-key", instance, expiry)).toEqual({
      status: "stored",
    });
    expect(JSON.parse(s.entries.get("openrouter-api-key-dates")!)).toEqual({
      [instance]: { connected: "2026-11-26T10:00:00.000Z", expires: expiry },
    });
  });

  it("keeps the expiry of a replaced key out of the session", async () => {
    const h = harness();
    await h.connect();
    h.responses.key = () => keyInfo(later);
    const pending = h.provider.probe(
      { credential: key, reason: null },
      new AbortController().signal,
    );
    h.manager.replaceKey(openrouter, replacement);
    await pending;
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.checking_key).toBeUndefined());
    expect(h.provider.apiKey.expiresAt()).toBe(later);
    expect(JSON.parse(h.entries.get("openrouter-api-key")!)).toMatchObject({ key: replacement });
  });
});

describe("OpenRouter adapter details", () => {
  it("offers no effort when none of the declared levels is Ohtia's", async () => {
    const h = harness({
      models: () =>
        list([
          model("reasoning/other-levels", {
            supported_parameters: ["tools", "reasoning"],
            reasoning: { supported_efforts: ["turbo"] },
          }),
        ]),
    });
    await h.connect();
    expect((await h.models())[0]?.effortSupport).toBe("unsupported");
  });

  it("does not sign in through the browser", async () => {
    const { provider } = harness();
    expect(await provider.connect(new AbortController().signal)).toEqual({
      state: "error",
      reason: null,
    });
  });

  it("shows the expiry OpenRouter reports even when the store cannot keep it", async () => {
    const h = harness();
    await h.connect();
    const dates = h.entries.get("openrouter-api-key-dates")!;
    h.entries.delete("openrouter-api-key-dates");
    h.responses.key = () => keyInfo(later);
    h.manager.probe(openrouter);
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.probing).toBe(false));
    expect(h.manager.snapshot(openrouter)?.expires_at).toBe(later);
    expect(h.entries.has("openrouter-api-key-dates")).toBe(false);
    expect(dates).toContain(expiry);
  });
});
