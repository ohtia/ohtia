import { EventEmitter } from "node:events";
import https from "node:https";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeEnvelope,
  encodeEnvelope,
  policyId,
  portLimits,
  type ConnectionEvent,
  type ProviderRequestData,
  type ProviderResult,
} from "../packages/contracts/src/index.js";
import { anthropicConnection, AnthropicProvider } from "../packages/main/src/anthropic-provider.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { CredentialStore } from "../packages/main/src/credential-store.js";
import type { AdapterEvent } from "../packages/main/src/provider-adapter.js";
import { conformanceRequest, dispatchThrough } from "./fixtures/provider-conformance.js";

const key = "synthetic-test-api-key";
const replacement = "synthetic-replacement-api-key";
const workspaceMessage =
  "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.";
const model = {
  id: "first",
  display_name: "Claude fixture",
  lifecycle: "active",
  max_tokens: 8192,
  max_input_tokens: 200_000,
  capabilities: {
    effort: {
      supported: true,
      low: { supported: false },
      high: { supported: true },
      xhigh: null,
    },
  },
};
const modelPage = (data: unknown[] = [model], has_more = false, last_id: string | null = null) =>
  Response.json({ data, has_more, last_id });
const APIError = (
  status: number,
  type: string,
  message: string,
  details?: object,
  headers?: HeadersInit,
) => Response.json({ type: "error", error: { type, message, details } }, { status, headers });
function sse(...events: Record<string, unknown>[]): Response {
  return new Response(
    events
      .map((event) => "event: " + String(event.type) + "\ndata: " + JSON.stringify(event) + "\n\n")
      .join(""),
    { headers: { "content-type": "text/event-stream", "request-id": "req-1" } },
  );
}
const start = {
  type: "message_start",
  message: {
    model: "first",
    usage: { input_tokens: 3, cache_read_input_tokens: 2, output_tokens: 1 },
  },
};
const ping = { type: "ping" };
const text = {
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text: "Reply" },
};
const stop = { type: "message_stop" };
const delta = (stop_reason: string, category?: string) => ({
  type: "message_delta",
  delta: {
    stop_reason,
    stop_details: category === undefined ? null : { category, explanation: "PRIVATE_REFUSAL" },
  },
  usage: { output_tokens: 8 },
});

function setup(fetch?: typeof globalThis.fetch) {
  const entries = new Map<string, string>();
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
  let manager: ConnectionManager;
  const refresh = vi.fn();
  const provider = new AnthropicProvider({
    store,
    ...(fetch ? { fetch } : {}),
    refresh,
    model: (id) => manager.model(anthropicConnection, id),
  });
  manager = new ConnectionManager([provider]);
  const events: ConnectionEvent[] = [];
  manager.subscribe((event) => {
    events.push(event);
  });
  return { manager, store, provider, entries, events, refresh };
}
async function connected(harness: ReturnType<typeof setup>) {
  expect(harness.manager.connect(anthropicConnection, { key })).toMatchObject({
    ok: true,
    value: { state: "connecting", checking_key: true },
  });
  await vi.waitFor(() =>
    expect(harness.manager.snapshot(anthropicConnection)?.state).toBe("connected"),
  );
}
function replyResult(events: readonly AdapterEvent[]): ProviderResult | undefined {
  const end = events.at(-1);
  return end?.type === "result" ? end.result : undefined;
}
const listOr =
  (reply: () => Response): typeof fetch =>
  async (url) =>
    new URL(String(url)).pathname.endsWith("/models") ? modelPage() : reply();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Anthropic API-key connection and Messages adapter", () => {
  it("uses only the stored key and fixed SDK headers, opts out of telemetry, and joins text history", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "other-key");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "other-token");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://untrusted.invalid");
    vi.stubEnv("ANTHROPIC_PROFILE", "other-profile");
    vi.stubEnv("ANTHROPIC_WEBHOOK_SIGNING_KEY", "other-webhook");
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    vi.stubEnv(
      "ANTHROPIC_CUSTOM_HEADERS",
      "Authorization: Bearer other-key\nUser-Agent: other-agent\nAccept: text/plain\nContent-Type: text/plain\nanthropic-version: legacy\nanthropic-workspace-id: ignored\nX-Example: ignored",
    );
    vi.stubEnv("ANTHROPIC_OPEN_TELEMETRY", "true");
    vi.stubEnv("ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE", "content");
    const sdkRequire = createRequire(
      createRequire(new URL("../packages/main/package.json", import.meta.url)).resolve(
        "@anthropic-ai/sdk",
      ),
    );
    const { trace } = sdkRequire("@opentelemetry/api") as {
      trace: { setGlobalTracerProvider(provider: object): boolean; disable(): void };
    };
    const startSpan = vi.fn();
    trace.setGlobalTracerProvider({ getTracer: () => ({ startSpan, startActiveSpan: startSpan }) });
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const post = url.pathname.endsWith("/messages");
        expect(url.origin).toBe("https://api.anthropic.com");
        expect(url.pathname).toBe(post ? "/v1/messages" : "/v1/models");
        expect(init?.redirect).toBe("error");
        expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
          accept: "application/json",
          "anthropic-version": "2026-10-21",
          authorization: "Bearer " + key,
          "user-agent": "Anthropic/JS 1.8.0",
          ...(post ? { "content-type": "application/json" } : {}),
        });
        if (!post) return modelPage();
        expect(init?.body).toBeTypeOf("string");
        expect(JSON.parse(init?.body as string)).toEqual({
          model: "first",
          max_tokens: 8192,
          system: "Synthetic conformance instructions.",
          messages: [
            { role: "user", content: "First\n\nSecond" },
            {
              role: "assistant",
              content: "Earlier answer\n\nThe researcher accepted the proposal.",
            },
          ],
          output_config: { effort: "high" },
          stream: true,
        });
        return sse(start, ping, text, delta("end_turn"), stop);
      });
      const h = setup(fetch);
      await connected(h);
      const request = {
        ...conformanceRequest(anthropicConnection),
        effort: "high",
        input: [
          { role: "user", text: "First" },
          { role: "user", text: "Second" },
          { role: "assistant", text: "Earlier answer" },
          { role: "assistant", text: "The researcher accepted the proposal." },
        ],
      } satisfies ProviderRequestData;
      const events = await dispatchThrough(h.manager, h.provider, request);
      expect(events.filter((event) => event.type === "activity")).toHaveLength(5);
      expect(events.filter((event) => event.type === "usage").at(-1)).toMatchObject({
        usage: {
          input_tokens: 5,
          cached_input_tokens: 2,
          reasoning_tokens: null,
          output_tokens: 8,
        },
      });
      expect(replyResult(events)).toEqual({ status: "completed" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(startSpan).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toContain(key);
      expect(JSON.stringify(h.events)).not.toContain(key);
      h.manager.dispose();
    } finally {
      debug.mockRestore();
      trace.disable();
    }
  });

  it("reads and pages 1,500 models in provider order, preserving the catalog after a later page fails", async () => {
    const rows = Array.from({ length: 1500 }, (_, n) => ({
      ...model,
      id: "model-" + n,
      display_name: "Claude " + n,
    }));
    let fail = false;
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("limit")).toBe("1000");
      if (!url.searchParams.has("after_id"))
        return modelPage(rows.slice(0, 1000), true, "model-999");
      expect(url.searchParams.get("after_id")).toBe("model-999");
      return fail
        ? APIError(529, "overloaded_error", "PRIVATE")
        : modelPage([
            ...rows.slice(1000),
            { ...model, lifecycle: "deprecated" },
            { ...model, lifecycle: "retired" },
            { ...model, max_tokens: null },
          ]);
    });
    const h = setup(transport);
    await connected(h);
    expect(h.manager.snapshot(anthropicConnection)?.model_count).toBe(1500);
    const listed: string[] = [];
    let cursor = 0;
    do {
      const page = h.manager.listModels({
        connection: anthropicConnection,
        model_list_revision: 1,
        cursor,
        count: 128,
      });
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error("Model page was rejected.");
      cursor = page.value.nextCursor;
      listed.push(...page.value.models.map((entry) => entry.id));
      expect(page.value.hasMore).toBe(cursor !== 1500);
    } while (cursor < 1500);
    expect(listed).toEqual(rows.map((entry) => entry.id));
    expect(h.manager.model(anthropicConnection, "model-0")).toMatchObject({
      maxInput: 200_000,
      maxOutput: 8192,
      effortSupport: "supported",
      effortLevels: [
        { name: "low", supported: false },
        { name: "high", supported: true },
      ],
    });
    fail = true;
    h.manager.probe(anthropicConnection);
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toMatchObject({ kind: "probe_result", outcome: "unreachable" }),
    );
    expect(h.manager.snapshot(anthropicConnection)).toMatchObject({
      model_count: 1500,
      model_list_revision: 1,
    });
    expect(transport).toHaveBeenCalledTimes(4);
    h.manager.dispose();
  });

  it.each([
    [400, "invalid_request_error", workspaceMessage, "key_needs_workspace"],
    [400, "invalid_request_error", "Other", "key_check_unavailable"],
    [400, "other", workspaceMessage, "key_check_unavailable"],
    [401, "authentication_error", "PRIVATE", "key_rejected"],
    [402, "billing_error", "PRIVATE", "key_check_unavailable"],
    [403, "permission_error", "PRIVATE", "key_not_permitted"],
    [429, "rate_limit_error", "PRIVATE", "key_check_unavailable"],
    [529, "overloaded_error", "PRIVATE", "key_check_unavailable"],
  ])(
    "publishes a bounded failed check for HTTP %i (%s) before writing a key",
    async (status, type, message, reason) => {
      const h = setup(async () => APIError(status, type, message));
      expect(h.manager.connect(anthropicConnection, { key })).toMatchObject({ ok: true });
      await vi.waitFor(() =>
        expect(h.events.at(-1)).toMatchObject({ state: "disconnected", reason }),
      );
      expect(h.entries.size).toBe(0);
      expect(JSON.stringify(h.events)).not.toContain("PRIVATE");
      h.manager.dispose();
    },
  );

  it("reports a keyring read timeout without contacting Anthropic or saving the key", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => modelPage());
    const h = setup(fetch);
    vi.spyOn(h.provider.credentials, "read").mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    expect(h.manager.connect(anthropicConnection, { key })).toMatchObject({
      value: { state: "connecting", checking_key: true },
    });
    await vi.advanceTimersByTimeAsync(portLimits.connection_probe_ms);
    expect(h.events.at(-1)).toMatchObject({ state: "error", reason: "store_unavailable" });
    expect(h.manager.snapshot(anthropicConnection)?.checking_key).toBeUndefined();
    expect(h.entries.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    h.manager.dispose();
  });

  it("times out a replacement and preserves the old key, state, catalog and account identity", async () => {
    let hanging = false;
    const h = setup(async (_input, init) => {
      if (!hanging) return modelPage();
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    await connected(h);
    const old = h.manager.account(anthropicConnection);
    hanging = true;
    vi.useFakeTimers();
    expect(h.manager.replaceKey(anthropicConnection, replacement)).toMatchObject({
      value: { state: "connected", checking_key: true },
    });
    await vi.advanceTimersByTimeAsync(portLimits.connection_probe_ms);
    expect(h.events.at(-1)).toMatchObject({ state: "connected", reason: "key_check_unreachable" });
    expect(h.manager.account(anthropicConnection)).toEqual(old);
    expect(h.entries.get("anthropic-api-key")).toContain(key);
    expect(h.entries.get("anthropic-api-key")).not.toContain(replacement);
    hanging = false;
    h.manager.replaceKey(anthropicConnection, replacement);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.manager.account(anthropicConnection).fingerprint).not.toBe(old.fingerprint);
    expect(h.events.at(-1)).toMatchObject({
      state: "connected",
      reason: null,
      model_list_revision: 2,
    });
    expect(JSON.parse(h.entries.get("anthropic-api-key")!)).toEqual({
      key: replacement,
      instance: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect((await h.store.readApiKey("anthropic-api-key")).status).toBe("stored");
    await h.manager.disconnect(anthropicConnection);
    expect(h.entries.size).toBe(0);
    h.manager.dispose();
  });

  it.each([
    ["tool_use", { status: "completed" }],
    ["end_turn", { status: "completed" }],
    ["max_tokens", { status: "failed", reason: "max_output_reached" }],
    ["model_context_window_exceeded", { status: "failed", reason: "max_output_reached" }],
    ["refusal", { status: "failed", reason: "refused", refusal_category: "policy_test" }],
    ["stop_sequence", { status: "failed", reason: "invalid_output" }],
    ["pause_turn", { status: "failed", reason: "invalid_output" }],
  ] as const)(
    "maps %s without carrying thinking or refusal explanations",
    async (reason, expected) => {
      const h = setup(
        listOr(() =>
          sse(
            start,
            text,
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "thinking_delta", thinking: "PRIVATE_REASONING" },
            },
            delta(reason, "policy_test"),
            stop,
          ),
        ),
      );
      await connected(h);
      const events = await dispatchThrough(
        h.manager,
        h.provider,
        conformanceRequest(anthropicConnection),
      );
      expect(replyResult(events)).toMatchObject(expected);
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE_REASONING|PRIVATE_REFUSAL/);
      h.manager.dispose();
    },
  );

  it.each([
    [400, "invalid_request_error", workspaceMessage, undefined, "connection_expired"],
    [401, "authentication_error", "PRIVATE", undefined, "connection_expired"],
    [
      400,
      "invalid_request_error",
      "You have reached your specified workspace API usage limits",
      undefined,
      "billing_limit_reached",
    ],
    [
      400,
      "invalid_request_error",
      "You have reached your specified API usage limits",
      undefined,
      "billing_limit_reached",
    ],
    [402, "billing_error", "PRIVATE", undefined, "billing_limit_reached"],
    [403, "permission_error", "PRIVATE", undefined, "not_eligible"],
    [404, "not_found_error", "PRIVATE", undefined, "model_unavailable"],
    [409, "invalid_request_error", "Visible provider line", undefined, "request_rejected"],
    [413, "request_too_large", "Visible provider line", undefined, "request_rejected"],
    [
      429,
      "rate_limit_error",
      "PRIVATE",
      { error_code: "enforced_spend_limit_reached" },
      "billing_limit_reached",
    ],
    [429, "rate_limit_error", "PRIVATE", undefined, "rate_limited"],
    [500, "api_error", "PRIVATE", undefined, "provider_unavailable"],
    [504, "timeout_error", "PRIVATE", undefined, "provider_unavailable"],
    [529, "overloaded_error", "PRIVATE", undefined, "provider_unavailable"],
  ])(
    "maps HTTP %i (%s) through the actual provider event envelope",
    async (status, type, message, details, reason) => {
      const h = setup(
        listOr(() => APIError(status, type, message, details, { "retry-after": "30" })),
      );
      await connected(h);
      const events = await dispatchThrough(
        h.manager,
        h.provider,
        conformanceRequest(anthropicConnection),
      );
      const result = replyResult(events);
      expect(result).toMatchObject({ status: "failed", reason, dispatched: true });
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|not scoped to a workspace/);
      if (reason === "rate_limited") expect(result).toHaveProperty("retry_not_before_at");
      if (reason === "request_rejected") expect(result).toHaveProperty("provider_message", message);
      if (reason === "model_unavailable") expect(h.refresh).toHaveBeenCalledOnce();
      if (reason === "connection_expired")
        expect(h.manager.snapshot(anthropicConnection)).toMatchObject({
          state: "expired",
          reason: message === workspaceMessage ? "key_needs_workspace" : null,
        });
      h.manager.dispose();
    },
  );

  it("maps in-stream errors and unfinished streams separately and refuses a withdrawn permit", async () => {
    let response = () => sse(start, text, { type: "error", error: { message: "PRIVATE" } });
    const transport = vi.fn(listOr(() => response()));
    const h = setup(transport);
    await connected(h);
    const request = conformanceRequest(anthropicConnection);
    const events = await dispatchThrough(h.manager, h.provider, request);
    expect(replyResult(events)).toMatchObject({ status: "failed", reason: "provider_unavailable" });
    expect(events).toContainEqual(expect.objectContaining({ type: "text", text: "Reply" }));
    response = () => sse(start, text);
    expect(replyResult(await dispatchThrough(h.manager, h.provider, request))).toEqual({
      status: "uncertain",
      reason: "connection_lost",
    });
    const release = vi.fn(() => false);
    await h.provider.requests.send(request, {
      release,
      emit: vi.fn(),
      signal: new AbortController().signal,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(3);
    h.manager.dispose();
  });

  it("validates the key inputs only on the two main-only operations", () => {
    const frame = {
      protocol: 1,
      policy: policyId,
      kind: "request",
      requestId: "request",
      operationId: "operation",
      windowGeneration: "window",
      serviceGeneration: "service",
    };
    const valid = encodeEnvelope({
      ...frame,
      operation: "connection.replaceKey",
      payload: { connection: anthropicConnection, key },
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("Key replacement was rejected.");
    expect(decodeEnvelope(JSON.parse(valid.value))).toMatchObject({ ok: true });
    expect(
      encodeEnvelope({
        ...frame,
        operation: "connection.probe",
        payload: { connection: anthropicConnection, key },
      }).ok,
    ).toBe(false);
    expect(
      encodeEnvelope({
        ...frame,
        operation: "connection.connect",
        payload: { connection: anthropicConnection, key: "line\nbreak" },
      }).ok,
    ).toBe(false);
  });
  it("streams only application tools and preserves their original namespace and name", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/models?limit=1000")) return modelPage();
      expect(JSON.parse(init?.body as string)).toMatchObject({
        tool_choice: { type: "auto" },
        tools: [
          {
            name: "ohtia_propose_plan",
            strict: true,
            eager_input_streaming: true,
            input_schema: {
              type: "object",
              additionalProperties: false,
              required: ["fixture"],
            },
          },
        ],
        messages: [{ role: "user", content: "Synthetic conformance message." }],
      });
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      for (const absent of [
        "thinking",
        "fallbacks",
        "mcp_servers",
        "container",
        "tool_result",
        "files",
      ])
        expect(body).not.toHaveProperty(absent);
      return sse(
        start,
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "tool-1", name: "ohtia_propose_plan", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"fixture":' },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '"proposal"}' },
        },
        { type: "content_block_stop", index: 1 },
        delta("tool_use"),
        stop,
      );
    });
    const h = setup(send);
    await connected(h);
    const events: AdapterEvent[] = [];
    await h.provider.requests.send(
      {
        ...conformanceRequest(anthropicConnection),
        tools: [
          {
            namespace: "ohtia",
            name: "propose_plan",
            description: "Synthetic tool",
            strict: true,
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["fixture"],
              properties: { fixture: { type: "string", description: "Fixture" } },
            },
          },
        ],
      },
      {
        signal: new AbortController().signal,
        release: () => true,
        emit: (event) => {
          events.push(event);
        },
      },
    );
    expect(events.filter((event) => event.type.startsWith("tool_"))).toEqual([
      { type: "tool_start", id: "tool-1", namespace: "ohtia", name: "propose_plan" },
      { type: "tool_arguments", id: "tool-1", text: '{"fixture":' },
      { type: "tool_arguments", id: "tool-1", text: '"proposal"}' },
      { type: "tool_end", id: "tool-1" },
    ]);
    expect(replyResult(events)).toEqual({ status: "completed" });
    h.manager.dispose();
  });

  it("does not dispatch without a stored key or supported model", async () => {
    const fetch = vi.fn(listOr(() => sse(start, text, delta("end_turn"), stop)));
    const h = setup(fetch);
    const events: AdapterEvent[] = [];
    const release = vi.fn(() => true);
    const control = {
      signal: new AbortController().signal,
      release,
      emit: (event: AdapterEvent) => {
        events.push(event);
      },
    };
    await h.provider.requests.send(conformanceRequest(anthropicConnection), control);
    expect(replyResult(events)).toEqual({
      status: "failed",
      dispatched: false,
      reason: "connection_expired",
    });
    await connected(h);
    const model = vi.spyOn(h.manager, "model").mockReturnValueOnce(undefined);
    await h.provider.requests.send(conformanceRequest(anthropicConnection), control);
    expect(replyResult(events)).toEqual({
      status: "failed",
      dispatched: false,
      reason: "provider_unavailable",
    });
    expect(release).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    model.mockRestore();
    h.manager.dispose();
  });

  it("keeps a replayed connect idempotent and exposes a native write failure without a stored key", async () => {
    const fetch = vi.fn(listOr(() => sse(start, text, delta("end_turn"), stop)));
    const h = setup(fetch);
    const write = vi.spyOn(h.store, "writeApiKey").mockResolvedValueOnce({ status: "unavailable" });
    expect(h.manager.connect(anthropicConnection, { key })).toMatchObject({
      value: { checking_key: true },
    });
    expect(h.manager.connect(anthropicConnection, { key })).toMatchObject({
      value: { checking_key: true },
    });
    await vi.waitFor(() =>
      expect(h.manager.snapshot(anthropicConnection)).toMatchObject({
        state: "error",
        reason: "store_unavailable",
      }),
    );
    expect(write).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.entries.size).toBe(0);
    expect(
      h.manager.connect(anthropicConnection, { key: "invalid key with whitespace" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_message" } });
    h.manager.dispose();
  });

  it("admits the Messages body after TLS and distinguishes a dropped request from a refused dispatch", async () => {
    let disconnect: "before" | "after" | undefined;
    const order: string[] = [];
    const wire = vi.spyOn(https, "request").mockImplementation(((
      url: URL,
      options: https.RequestOptions,
    ) => {
      const isList = url.pathname === "/v1/models";
      const socket = Object.assign(new EventEmitter(), { encrypted: true, connecting: true });
      const outgoing = Object.assign(new EventEmitter(), {
        destroy: () => queueMicrotask(() => socket.emit("close")),
        end: (body?: Buffer) => {
          if (!isList) {
            order.push("body");
            expect(options.method).toBe("POST");
            expect(options.headers).toMatchObject({ "content-type": "application/json" });
            expect(JSON.parse(body!.toString())).toHaveProperty("messages");
            if (disconnect === "after") {
              outgoing.emit("error", new Error("Synthetic socket closed after sending"));
              return;
            }
          } else {
            expect(options.method).toBe("GET");
            expect(body).toBeUndefined();
          }
          const json = JSON.stringify({ data: [model], has_more: false, last_id: null });
          const incoming = Object.assign(Readable.from([Buffer.from(json)]), {
            statusCode: 200,
            headers: { "content-type": "application/json" },
          });
          outgoing.emit("response", incoming);
        },
      });
      queueMicrotask(() => {
        outgoing.emit("socket", socket);
        if (!isList && disconnect === "before") {
          outgoing.emit("error", new Error("Synthetic socket closed before TLS"));
          return;
        }
        if (!isList) order.push("TLS");
        socket.emit("secureConnect");
      });
      return outgoing;
    }) as unknown as typeof https.request);
    const h = setup();
    try {
      await connected(h);
      const events: AdapterEvent[] = [];
      const request = async () =>
        h.provider.requests.send(conformanceRequest(anthropicConnection), {
          signal: new AbortController().signal,
          release: () => {
            order.push("permit");
            return true;
          },
          emit: (event) => {
            events.push(event);
          },
        });
      disconnect = "before";
      await request();
      expect(replyResult(events)).toEqual({
        status: "failed",
        dispatched: false,
        reason: "provider_unavailable",
      });
      expect(order).toEqual([]);
      disconnect = "after";
      await request();
      expect(order).toEqual(["TLS", "permit", "body"]);
      expect(replyResult(events)).toEqual({ status: "uncertain", reason: "connection_lost" });
    } finally {
      h.manager.dispose();
      wire.mockRestore();
    }
  });

  it("normalizes visible text and cached usage from block starts and rejects malformed stream events", async () => {
    let response: () => Response = () =>
      sse(
        {
          ...start,
          message: {
            ...start.message,
            usage: { input_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "Visible" } },
        { type: "content_block_stop", index: 0 },
        delta("end_turn"),
        stop,
      );
    const h = setup(listOr(() => response()));
    await connected(h);
    const run = async () => {
      const events: AdapterEvent[] = [];
      await h.provider.requests.send(conformanceRequest(anthropicConnection), {
        signal: new AbortController().signal,
        release: () => true,
        emit: (event) => {
          events.push(event);
        },
      });
      return events;
    };
    const completed = await run();
    expect(completed).toContainEqual({ type: "text", text: "Visible" });
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "usage",
        usage: expect.objectContaining({ input_tokens: 12, cached_input_tokens: 4 }),
      }),
    );
    expect(replyResult(completed)).toEqual({ status: "completed" });
    for (const malformed of [
      () => new Response("event: message_start\ndata: not-json\n\n"),
      () => new Response('event: message_start\ndata: {"type":"message_delta"}\n\n'),
      () => sse({ type: "message_start", message: {} }),
      () => sse(start, { type: "message_delta", delta: null }),
      () =>
        sse(start, {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-1", name: "unlisted" },
        }),
      () =>
        sse(start, {
          type: "content_block_delta",
          index: 4,
          delta: { type: "input_json_delta", partial_json: "{}" },
        }),
    ]) {
      response = malformed;
      expect(replyResult(await run())).toEqual({
        status: "failed",
        dispatched: true,
        reason: "invalid_output",
      });
    }
    h.manager.dispose();
  });

  it("keeps error bodies containing the key and unrecognized refusal categories private", async () => {
    let reply = () => APIError(400, "invalid_request_error", "Synthetic error mentions " + key);
    const h = setup(listOr(() => reply()));
    await connected(h);
    const run = async () => {
      const events: AdapterEvent[] = [];
      await h.provider.requests.send(conformanceRequest(anthropicConnection), {
        signal: new AbortController().signal,
        release: () => true,
        emit: (event) => {
          events.push(event);
        },
      });
      return replyResult(events);
    };
    expect(await run()).toEqual({ status: "failed", dispatched: true, reason: "request_rejected" });
    reply = () =>
      APIError(429, "rate_limit_error", "Synthetic rate limit without a valid deadline");
    expect(await run()).toEqual({ status: "failed", dispatched: true, reason: "rate_limited" });
    reply = () => sse(start, delta("refusal", "Not a stable category!"), stop);
    expect(await run()).toEqual({ status: "failed", dispatched: true, reason: "refused" });
    h.manager.dispose();
  });

  it("does not store a key when its listing connection fails", async () => {
    const h = setup(async () => {
      throw new TypeError("Synthetic network failure.");
    });
    h.manager.connect(anthropicConnection, { key });
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toMatchObject({
        state: "disconnected",
        reason: "key_check_unreachable",
      }),
    );
    expect(h.entries.size).toBe(0);
    h.manager.dispose();
  });

  it("marks unknown and unsupported effort without listing absent levels", async () => {
    const h = setup(async () =>
      modelPage([
        { ...model, capabilities: null },
        {
          ...model,
          id: "second",
          capabilities: { effort: { supported: false } },
          max_input_tokens: null,
        },
      ]),
    );
    await connected(h);
    expect(h.manager.model(anthropicConnection, "first")).toMatchObject({
      effortSupport: "unknown",
    });
    const unsupported = h.manager.model(anthropicConnection, "second");
    expect(unsupported).toMatchObject({ effortSupport: "unsupported" });
    expect(unsupported).not.toHaveProperty("effortLevels");
    expect(unsupported).not.toHaveProperty("maxInput");
    h.manager.dispose();
  });

  it.each([
    [{ data: [model], has_more: true, last_id: null }],
    [{ data: [model, model], has_more: false }],
    [{ data: [{ ...model, display_name: "x".repeat(5000) }], has_more: false }],
  ])("rejects malformed or unpageable catalogs before persisting a key", async (page) => {
    const h = setup(async () => Response.json(page));
    h.manager.connect(anthropicConnection, { key });
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toMatchObject({
        state: "disconnected",
        reason: "key_check_unavailable",
      }),
    );
    expect(h.entries.size).toBe(0);
    h.manager.dispose();
  });
});
