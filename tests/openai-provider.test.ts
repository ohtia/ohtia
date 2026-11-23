import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationTitlePolicy,
  type ConnectionEvent,
  type DiagnosticEvent,
  type ProviderEvent,
} from "../packages/contracts/src/index.js";
import { forbiddenResponseFields } from "../packages/main/src/chatgpt-responses.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { CredentialStore } from "../packages/main/src/credential-store.js";
import { OpenAIProvider, openaiConnection } from "../packages/main/src/openai-provider.js";
import {
  nodeProviderTransport,
  transportFailure,
  type ProviderTransport,
} from "../packages/main/src/provider-https.js";
import { conformanceRequest, dispatchThrough } from "./fixtures/provider-conformance.js";

const key = "synthetic-openai-api-key";
const replacement = "synthetic-openai-replacement";
const astra = "gpt-6-astra";
const sol = "gpt-6.1-sol";
const terra = "gpt-6.1-terra";
const luna = "gpt-6-luna";
const standard = ["low", "medium", "high", "xhigh", "max"];
const allModels = () =>
  modelList({ id: luna }, { id: sol }, { id: "gpt-6-image" }, { id: terra }, { id: astra });
function modelList(...data: { id: string; shutdown_date?: string | null }[]) {
  return Response.json({ object: "list", data });
}
const httpError = (
  status: number,
  code?: string,
  message = "Synthetic provider message",
  headers?: HeadersInit,
) => Response.json({ error: { code, message } }, { status, headers });
const partial = { type: "response.output_text.delta", delta: "Partial research reply." };
const usage = {
  input_tokens: 14,
  input_tokens_details: { cached_tokens: 3 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 7 },
};
function stream(...events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-request" },
  });
}
const request = (overrides = {}) => ({
  ...conformanceRequest(openaiConnection),
  model: astra,
  ...overrides,
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
});

function harness({
  models = allModels,
  reply = () => stream(partial, { type: "response.completed", response: { model: astra, usage } }),
  transport,
}: {
  models?: () => Response;
  reply?: () => Response;
  transport?: ProviderTransport;
} = {}) {
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
  const send = vi.fn<ProviderTransport>(
    transport ??
      (async (outgoing, release) => {
        expect(new URL(outgoing.url).origin).toBe("https://api.openai.com");
        expect(outgoing.headers.Authorization).toBe("Bearer " + key);
        if (!release()) throw transportFailure(false);
        return outgoing.body === undefined ? models() : reply();
      }),
  );
  const provider = new OpenAIProvider({
    store,
    transport: send,
    refresh: () => manager.refreshModels(openaiConnection, true),
  });
  const manager = new ConnectionManager([provider], (event) => diagnostics.push(event));
  manager.subscribe((event) => events.push(event));
  cleanup.push(() => manager.dispose());
  return {
    provider,
    manager,
    send,
    entries,
    store,
    events,
    diagnostics,
    async connect() {
      expect(manager.connect(openaiConnection, { key })).toMatchObject({
        value: { state: "connecting", checking_key: true },
      });
      await vi.waitFor(() => expect(manager.snapshot(openaiConnection)?.state).toBe("connected"));
    },
    async dispatch(data = request()): Promise<ProviderEvent[]> {
      return dispatchThrough(manager, provider, data, {
        diagnostic: (event) => diagnostics.push(event),
        checkModel: true,
      });
    },
  };
}

describe("OpenAI API-key connection and Responses adapter", () => {
  it("intersects the complete account list, retains catalog order and excludes models marked for shutdown", async () => {
    let catalog = allModels;
    const h = harness({ models: () => catalog() });
    await h.connect();
    const models = [astra, sol, terra, luna].map((id) => h.manager.model(openaiConnection, id));
    expect(models.map((entry) => entry?.name)).toEqual([
      "GPT-6 Astra",
      "GPT-6.1 Sol",
      "GPT-6.1 Terra",
      "GPT-6 Luna",
    ]);
    expect(models.map((entry) => entry?.defaultEffort)).toEqual([
      undefined,
      "medium",
      "medium",
      "medium",
    ]);
    expect(models.map((entry) => entry?.effortLevels?.map(({ name }) => name))).toEqual([
      standard,
      standard,
      ["none", ...standard],
      ["none", ...standard],
    ]);
    expect(models.every((entry) => entry?.origin === "catalog")).toBe(true);
    catalog = () =>
      modelList(
        { id: sol, shutdown_date: "2026-12-01" },
        { id: "gpt-6-image" },
        { id: astra, shutdown_date: null },
      );
    h.manager.probe(openaiConnection);
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toMatchObject({
        kind: "probe_result",
        outcome: "listed",
        model_count: 1,
      }),
    );
    expect(h.manager.model(openaiConnection, sol)).toBeUndefined();
    expect(h.manager.model(openaiConnection, "gpt-6-image")).toBeUndefined();
    expect(h.manager.snapshot(openaiConnection)?.connected_at).toBeTypeOf("string");
    const stored = JSON.parse(h.entries.get("openai-api-key")!);
    expect(stored).toEqual({ key, instance: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(h.manager.account(openaiConnection).fingerprint).not.toContain(stored.instance);
    expect(JSON.stringify(h.events)).not.toContain(key);
    await h.manager.disconnect(openaiConnection);
    expect(h.entries.size).toBe(0);
  });

  it.each([
    [401, "key_rejected"],
    [403, "key_not_permitted"],
    [400, "key_check_unavailable"],
    [429, "key_check_unavailable"],
    [503, "key_check_unavailable"],
    [0, "key_check_unreachable"],
  ])("reports key-check status %i as %s and discards provider text", async (status, reason) => {
    const marker = "provider echo: " + key;
    const h = harness({
      models: () => {
        if (status === 0) throw transportFailure(false);
        return httpError(status, undefined, marker);
      },
    });
    h.manager.connect(openaiConnection, { key });
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toMatchObject({ state: "disconnected", reason }),
    );
    expect(h.entries.size).toBe(0);
    expect(JSON.stringify([h.events, h.diagnostics])).not.toContain(key);
  });

  it("preserves the previous key and account when replacement fails, then changes the instance on success", async () => {
    let allow = false;
    const h = harness({
      transport: async (outgoing, release) => {
        expect(release()).toBe(true);
        return outgoing.headers.Authorization === "Bearer " + key || allow
          ? allModels()
          : httpError(401, undefined, replacement);
      },
    });
    await h.connect();
    const before = h.manager.account(openaiConnection);
    const old = h.entries.get("openai-api-key");
    h.manager.replaceKey(openaiConnection, replacement);
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toMatchObject({ state: "connected", reason: "key_rejected" }),
    );
    expect(h.entries.get("openai-api-key")).toBe(old);
    expect(h.manager.account(openaiConnection)).toEqual(before);
    allow = true;
    h.manager.replaceKey(openaiConnection, replacement);
    await vi.waitFor(() =>
      expect(h.manager.account(openaiConnection).fingerprint).not.toBe(before.fingerprint),
    );
    expect(h.entries.get("openai-api-key")).toContain(replacement);
    expect(JSON.stringify(h.events)).not.toContain(replacement);
  });

  it("uses the shared guarded wire shape and translates application metadata tools within the Ohtia namespace", async () => {
    const { name, namespace } = conversationTitlePolicy;
    const call = {
      call_id: "wire-call-1",
      type: "function_call",
      namespace: "ohtia",
      name,
      arguments: '{"title":"Synthetic title"}',
    };
    const h = harness({
      reply: () =>
        stream(
          partial,
          {
            type: "response.output_item.added",
            item: { id: "call-1", call_id: call.call_id, type: "function_call", name },
          },
          {
            type: "response.function_call_arguments.done",
            item_id: "call-1",
            arguments: call.arguments,
          },
          {
            type: "response.completed",
            response: { model: astra, reasoning: { effort: "max" }, usage, output: [call] },
          },
        ),
    });
    await h.connect();
    const events = await h.dispatch(
      request({
        operation: "direct_guidance",
        effort: "max",
        tools: [
          {
            name,
            namespace,
            description: "Record a title",
            strict: true,
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: { title: { type: "string" } },
              required: ["title"],
            },
          },
        ],
      }),
    );
    const outgoing = h.send.mock.calls.at(-1)?.[0];
    expect(outgoing?.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(outgoing!.body!);
    expect(body).toMatchObject({
      model: astra,
      instructions: "Synthetic conformance instructions.",
      input: [{ role: "user", content: "Synthetic conformance message." }],
      store: false,
      stream: true,
      tool_choice: "auto",
      reasoning: { effort: "max" },
      tools: [
        { type: "namespace", name: "ohtia", tools: [{ type: "function", name, strict: true }] },
      ],
    });
    expect(body.tools).toHaveLength(1);
    for (const field of forbiddenResponseFields) expect(body).not.toHaveProperty(field);
    expect(outgoing?.body).not.toContain(key);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "usage",
        usage: { input_tokens: 14, cached_input_tokens: 3, output_tokens: 20, reasoning_tokens: 7 },
      }),
    );
    expect(events.at(-1)).toMatchObject({
      result: { status: "completed", conversation_title: "Synthetic title" },
    });
    expect(JSON.stringify(events)).not.toContain(key);
  });

  it("admits the account-bound cached choice after restarting before a fresh catalog is available", async () => {
    const h = harness({ models: () => modelList({ id: astra }) });
    await h.connect();
    const fingerprint = h.manager.account(openaiConnection).fingerprint;
    expect(fingerprint).toBeTypeOf("string");
    const restarted = new OpenAIProvider({ store: h.store, transport: h.send, refresh: () => {} });
    const manager = new ConnectionManager([restarted]);
    cleanup.push(() => manager.dispose());
    await manager.read(openaiConnection);
    expect(manager.model(openaiConnection, astra)).toBeUndefined();
    const emit = (catalog_account_fingerprint?: string) =>
      dispatchThrough(
        manager,
        restarted,
        request(catalog_account_fingerprint ? { catalog_account_fingerprint } : {}),
        { checkModel: true },
      );
    expect((await emit()).at(-1)).toMatchObject({
      result: { status: "failed", dispatched: false, reason: "permit_expired" },
    });
    expect((await emit(fingerprint)).at(-1)).toMatchObject({ result: { status: "completed" } });
  });

  it("withholds requests for absent models, unsupported effort and tools outside Ohtia", async () => {
    const h = harness();
    await h.connect();
    for (const data of [
      request({ model: "retired-model" }),
      request({ effort: "none" }),
      request({
        tools: [
          {
            namespace: "external",
            name: "unapproved_tool",
            description: "External",
            strict: true,
            parameters: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        ],
      }),
    ]) {
      expect((await h.dispatch(data)).at(-1)).toMatchObject({
        result: { status: "failed", reason: "permit_expired", dispatched: false },
      });
    }
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: "message", role: "assistant", content: [{ type: "output_text", text: 42 }] },
    { type: "function_call", arguments: 42 },
  ])("retains all four counters when terminal output is invalid", async (item) => {
    const h = harness({
      reply: () =>
        stream(partial, {
          type: "response.completed",
          response: { usage, output: [item] },
        }),
    });
    await h.connect();
    const events = await h.dispatch();
    expect(events).toContainEqual(expect.objectContaining({ type: "text", text: partial.delta }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "usage",
        usage: { input_tokens: 14, cached_input_tokens: 3, output_tokens: 20, reasoning_tokens: 7 },
      }),
    );
    expect(events.at(-1)).toMatchObject({ result: { status: "failed", reason: "invalid_output" } });
  });

  describe("terminal tool reconciliation", () => {
    const tool = {
      name: conversationTitlePolicy.name,
      namespace: conversationTitlePolicy.namespace,
      description: "Record a title",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    };
    const call = {
      id: "item-1",
      call_id: "wire-call-1",
      type: "function_call",
      namespace: "ohtia",
      name: tool.name,
      arguments: '{"title":"Synthetic title"}',
    };
    const added = {
      type: "response.output_item.added",
      item: { ...call, arguments: "" },
    };
    const done = {
      type: "response.function_call_arguments.done",
      item_id: call.id,
      arguments: call.arguments,
    };
    const completed = (...output: unknown[]) => ({
      type: "response.completed",
      response: { output, usage },
    });
    const cases: readonly (readonly [string, readonly unknown[]])[] = [
      ["absent done arguments", [added, { ...done, arguments: undefined }, completed(call)]],
      ["non-string done arguments", [added, { ...done, arguments: 42 }, completed(call)]],
      ["non-string initial arguments", [{ ...added, item: { ...call, arguments: 42 } }]],
      ["foreign namespace", [{ ...added, item: { ...call, namespace: "foreign" } }]],
      ["unfinished call", [added, completed(call)]],
      ["unknown item id", [added, done, completed({ ...call, id: "item-2" })]],
      [
        "contradictory arguments",
        [added, done, completed({ ...call, arguments: '{"title":"Changed"}' })],
      ],
      ["non-string final arguments", [added, done, completed({ ...call, arguments: 42 })]],
      ["missing final call", [added, done, completed()]],
      ["duplicate final call", [added, done, completed(call, call)]],
    ];
    it.each(cases)(
      "rejects %s while preserving text and withholding the tool",
      async (_label, reply) => {
        const h = harness({ reply: () => stream(partial, ...reply) });
        await h.connect();
        const events = await h.dispatch(request({ operation: "direct_guidance", tools: [tool] }));
        expect(events).toContainEqual(
          expect.objectContaining({ type: "text", text: partial.delta }),
        );
        expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_call" }));
        expect(events.at(-1)).toMatchObject({
          result: { status: "failed", reason: "invalid_output" },
        });
      },
    );
  });

  it.each([
    [
      "max output",
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      },
      "max_output_reached",
    ],
    [
      "content filter",
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "content_filter" } },
      },
      "provider_error",
    ],
    [
      "failed response",
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_user_not_eligible" } },
      },
      "provider_error",
    ],
    [
      "error event",
      { type: "error", code: "subscription_sharing_usage_limit_exceeded" },
      "provider_error",
    ],
    ["malformed event", { type: "response.output_text.delta", delta: 42 }, "invalid_output"],
    [
      "malformed final output",
      {
        type: "response.completed",
        response: {
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text: 42 }] },
          ],
        },
      },
      "invalid_output",
    ],
    ["missing terminal event", null, "connection_lost"],
  ])("maps %s and keeps previously streamed text", async (_name, event, reason) => {
    const h = harness({ reply: () => stream(partial, ...(event ? [event] : [])) });
    await h.connect();
    const events = await h.dispatch();
    expect(events).toContainEqual(expect.objectContaining({ type: "text", text: partial.delta }));
    expect(events.at(-1)).toMatchObject({
      result: { status: reason === "connection_lost" ? "uncertain" : "failed", reason },
    });
    expect(JSON.parse(h.send.mock.calls.at(-1)![0].body!)).not.toHaveProperty("reasoning");
  });

  it.each([
    [400, "invalid_request_error", "request_rejected"],
    [409, "invalid_request_error", "request_rejected"],
    [401, "invalid_api_key", "connection_expired"],
    [403, "unsupported_country_region_territory", "not_eligible"],
    [404, "model_not_found", "model_unavailable"],
    [429, "credit_balance_exhausted", "billing_limit_reached"],
    [429, "organization_spend_limit_exceeded", "billing_limit_reached"],
    [429, "project_spend_limit_exceeded", "billing_limit_reached"],
    [429, "organization_usage_limit_exceeded", "billing_limit_reached"],
    [429, "rate_limit_exceeded", "rate_limited"],
    [500, "server_error", "provider_unavailable"],
    [503, "server_is_overloaded", "provider_unavailable"],
  ])("maps HTTP %i (%s) to %s", async (status, code, reason) => {
    const marker = status === 401 ? "Echo of key " + key : "Private synthetic provider message";
    const h = harness({ reply: () => httpError(status, code, marker, { "retry-after": "15" }) });
    await h.connect();
    const start = Date.now();
    const result = (await h.dispatch()).at(-1)!;
    expect(result).toMatchObject({ result: { status: "failed", dispatched: true, reason } });
    if (reason === "rate_limited") {
      if (result.type !== "result" || result.result.status !== "failed")
        throw new Error("Missing failure.");
      const deadline = Date.parse(result.result.retry_not_before_at!);
      expect(deadline).toBeGreaterThanOrEqual(start + 15_000);
      expect(deadline).toBeLessThanOrEqual(Date.now() + 15_000);
    } else expect(result).not.toHaveProperty("result.retry_not_before_at");
    if (reason === "request_rejected")
      expect(result).toHaveProperty("result.provider_message", marker);
    else expect(result).not.toHaveProperty("result.provider_message");
    if (reason === "connection_expired") {
      expect(h.manager.snapshot(openaiConnection)?.state).toBe("expired");
      await h.manager.read(openaiConnection);
      expect(h.manager.snapshot(openaiConnection)?.state).toBe("expired");
    }
    if (reason === "model_unavailable")
      await vi.waitFor(() =>
        expect(h.send.mock.calls.filter(([outgoing]) => !outgoing.body)).toHaveLength(2),
      );
    expect(JSON.stringify([h.diagnostics, h.events])).not.toContain(marker);
  });

  it("uses an HTTP-date Retry-After and keeps malformed or missing deadlines unset", async () => {
    const retry = new Date(Date.now() + 60_000).toUTCString();
    let next: string | undefined = retry;
    const h = harness({
      reply: () =>
        httpError(429, "rate_limit_exceeded", "Rate limited", next ? { "Retry-After": next } : {}),
    });
    await h.connect();
    expect((await h.dispatch()).at(-1)).toHaveProperty(
      "result.retry_not_before_at",
      new Date(retry).toISOString(),
    );
    for (next of [undefined, "120 seconds", "9".repeat(35), "Wed, 21 Oct 2015 07:28:00 GMT"]) {
      const event = (await h.dispatch()).at(-1);
      expect(event).toHaveProperty("result.reason", "rate_limited");
      expect(event).not.toHaveProperty("result.retry_not_before_at");
    }
  });

  it("withdraws a request when its key is replaced before the shared transport releases it", async () => {
    const beforeRelease = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const serverReceived = vi.fn();
    const h = harness({
      transport: async (outgoing, release) => {
        if (!outgoing.body) return allModels();
        beforeRelease.resolve();
        await resume.promise;
        if (!release()) throw transportFailure(false);
        serverReceived(outgoing.body);
        throw transportFailure(true);
      },
    });
    await h.connect();
    const pending = h.dispatch();
    await beforeRelease.promise;
    const old = h.manager.account(openaiConnection).fingerprint;
    h.manager.replaceKey(openaiConnection, replacement);
    try {
      await vi.waitFor(() => expect(h.manager.account(openaiConnection).fingerprint).not.toBe(old));
    } finally {
      resume.resolve();
    }
    expect((await pending).at(-1)).toMatchObject({
      result: { status: "failed", reason: "permit_expired", dispatched: false },
    });
    expect(serverReceived).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "distinguishes a dropped connection with bytes sent = %s",
    async (sent) => {
      const h = harness({
        transport: async (outgoing, release) => {
          if (!outgoing.body) return allModels();
          if (sent) expect(release()).toBe(true);
          throw transportFailure(sent);
        },
      });
      await h.connect();
      expect((await h.dispatch()).at(-1)).toMatchObject({
        result: sent
          ? { status: "uncertain", reason: "connection_lost" }
          : { status: "failed", reason: "provider_unavailable", dispatched: false },
      });
    },
  );

  it.each([false, true])(
    "Stop closes the foreground socket with text streamed = %s",
    async (hasText) => {
      let researchSocketClosed: Promise<unknown> | undefined;
      const server = createServer((incoming, outgoing) => {
        if (incoming.url === "/v1/models") {
          outgoing.end(JSON.stringify({ data: [{ id: astra }] }));
          return;
        }
        researchSocketClosed = once(incoming.socket, "close");
        outgoing.writeHead(200, { "Content-Type": "text/event-stream" });
        outgoing.write(hasText ? `data: ${JSON.stringify(partial)}\n\n` : ": open\n\n");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture address.");
      try {
        const h = harness({
          transport: nodeProviderTransport((url, options) =>
            httpRequest(new URL(url.pathname, `http://127.0.0.1:${address.port}`), options),
          ),
        });
        await h.connect();
        const controller = new AbortController();
        const emit = vi.fn();
        const work = h.provider.requests.send(request(), {
          signal: controller.signal,
          release: () => true,
          emit,
        });
        await vi
          .waitFor(() => {
            expect(researchSocketClosed).toBeDefined();
            if (hasText)
              expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "text" }));
          })
          .catch((error: unknown) => {
            controller.abort();
            throw error;
          });
        controller.abort();
        await work;
        await researchSocketClosed;
        expect(emit.mock.calls.map(([event]) => event)).not.toContainEqual(
          expect.objectContaining({ type: "usage" }),
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    },
  );
});
