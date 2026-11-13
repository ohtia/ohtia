import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeProviderMessage,
  isProviderModel,
  makeDiagnosticRecord,
  portLimits,
  isProviderRequest,
  inputOmission,
  parseDevelopmentSwitches,
  unknownUsage,
  ServiceConnections,
  type ProviderRequestData,
  type ProviderEvent,
  type ProviderMessage,
} from "@ohtia/contracts";
import { developmentInput, developmentTest, omittedMessages, operationPolicy } from "@ohtia/domain";
import { ServiceRequests } from "../packages/utility/src/provider-requests.js";
import {
  ProviderRequests,
  type RequestObservation,
} from "../packages/main/src/provider-requests.js";
import {
  startChatGPTRequest,
  responseBody,
  type ResponseTransport,
} from "../packages/main/src/chatgpt-requests.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { admitRuntimeSwitches } from "../packages/main/src/profile.js";
import { fakeChatGPT } from "./fixtures/chatgpt.js";
import { ChatGPTProvider } from "../packages/main/src/chatgpt-provider.js";

const data: ProviderRequestData = {
  attempt: "attempt",
  operation: "development_test",
  connection: "chatgpt",
  model: "gpt-6.1-sol",
  instructions: { reference: "instructions-v1", text: developmentTest.instructions },
  input: [{ reference: "message-one", role: "user", content: "synthetic-private-prompt" }],
  limits: { max_input_bytes: 16384, max_input_items: 20, max_output_bytes: 16384 },
};
const packet = (
  now = 10000,
  generation = "generation",
): Extract<ProviderMessage, { kind: "provider_dispatch" }> => ({
  version: 1,
  generation,
  kind: "provider_dispatch",
  request: data,
  permit: { id: "permit", attempt: data.attempt, issued_at_ms: now, policy_version: 1 },
});
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const completed = {
  type: "response.completed",
  response: {
    output: [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    ],
  },
};
function stream(text: string, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunk));
        offset = Math.min(bytes.length, offset + chunk);
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function run(
  transport: ResponseTransport,
  extra: Partial<Parameters<typeof startChatGPTRequest>[2]> = {},
  signal = new AbortController().signal,
) {
  const events: RequestObservation[] = [];
  const renew = vi.fn(async () => {});
  const rejectPermission = vi.fn(async () => {});
  const handle = startChatGPTRequest(
    data,
    {
      signal,
      authorizeBody: () => undefined,
      emit: (e) => {
        events.push(e);
      },
    },
    { token: () => "synthetic-main-secret", renew, rejectPermission, transport, ...extra },
  );
  await handle.done;
  return { events, renew, rejectPermission, handle, final: events.at(-1) };
}
const respond =
  (response: Response): ResponseTransport =>
  async (options) => {
    options.release();
    return response;
  };
const managers: ConnectionManager[] = [];
afterEach(() => {
  managers.splice(0).forEach((m) => m.dispose());
  vi.useRealTimers();
});

describe("credential-free request contracts and development policy", () => {
  it("preserves opaque model identifiers admitted by the provider catalog within the shared string bound", () => {
    for (const model of [
      "m".repeat(256),
      "provider/model:edition+1",
      "é".repeat(portLimits.string_bytes / 2),
    ]) {
      expect(isProviderModel({ id: model, name: "Synthetic model" })).toBe(true);
      expect(isProviderRequest({ ...data, model })).toBe(true);
      expect(
        parseDevelopmentSwitches(["--ohtia-dev-command=request", "--ohtia-dev-model=" + model]),
      ).toEqual({ action: "request", model });
      expect(responseBody({ ...data, model }).model).toBe(model);
    }
    for (const model of [
      "",
      "m".repeat(portLimits.string_bytes + 1),
      "é".repeat(portLimits.string_bytes / 2 + 1),
    ]) {
      expect(isProviderRequest({ ...data, model })).toBe(false);
      expect(() =>
        parseDevelopmentSwitches(["--ohtia-dev-command=request", "--ohtia-dev-model=" + model]),
      ).toThrow();
    }
  });

  it("validates closed versioned messages, byte limits and matching permit identity", () => {
    expect(isProviderRequest(data)).toBe(true);
    expect(decodeProviderMessage(JSON.stringify(packet()))).toEqual(packet());
    for (const mutation of [
      { ...packet(), credential: "secret" },
      { ...packet(), version: 2 },
      { ...packet(), request: { ...data, credential: "secret" } },
      { ...packet(), permit: { ...packet().permit, attempt: "other" } },
      { ...packet(), request: { ...data, input: [{ ...data.input[0], role: "system" }] } },
      {
        ...packet(),
        request: { ...data, input: [{ ...data.input[0], content: "é".repeat(8193) }] },
      },
    ])
      expect(decodeProviderMessage(JSON.stringify(mutation))).toBeUndefined();
    expect(decodeProviderMessage("{")).toBeUndefined();
    expect(decodeProviderMessage(" ".repeat(65537))).toBeUndefined();
    for (const result of [
      { outcome: "failed", dispatched: false, reason: "provider_error" },
      { outcome: "completed", dispatched: false },
      { outcome: "refused", dispatched: false },
      { outcome: "content_filtered", dispatched: false },
      { outcome: "refused", dispatched: true, reason: "provider_error" },
      { outcome: "uncertain", dispatched: false, reason: "connection_lost" },
    ])
      expect(
        decodeProviderMessage(
          JSON.stringify({
            version: 1,
            generation: "generation",
            kind: "provider_event",
            attempt: "attempt",
            event: { kind: "final", sequence: 1, result },
          }),
        ),
      ).toBeUndefined();
  });
  it.each(["two_messages", "unicode", "twenty_items"])(
    "keeps the complete fitting history without reserving an unnecessary omission note: %s",
    (scenario) => {
      const messages =
        scenario === "two_messages"
          ? [
              { reference: "first", role: "user" as const, content: "a" },
              { reference: "last", role: "user" as const, content: "x".repeat(16383) },
            ]
          : scenario === "unicode"
            ? [
                { reference: "first", role: "user" as const, content: "é" },
                { reference: "last", role: "user" as const, content: "é".repeat(8191) },
              ]
            : Array.from({ length: 20 }, (_, i) => ({
                reference: "message-" + i,
                role: "user" as const,
                content: i === 19 ? "x".repeat(16365) : "a",
              }));
      expect(developmentInput(messages)).toEqual(messages);
      expect(messages.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0)).toBe(16384);
    },
  );
  it("serializes each introduced diagnostic with its code-owned outcome and rejects content fields", () => {
    const cases = [
      ["ohtia.development.requested", "accepted", null],
      ["ohtia.development.interrupted", "accepted", null],
      ["ohtia.provider.started", "started", null],
      ["ohtia.provider.completed", "completed", null],
      ["ohtia.provider.refused", "refused", null],
      ["ohtia.provider.content_filtered", "content_filtered", null],
      ["ohtia.provider.cancelled", "cancelled", null],
      ["ohtia.provider.uncertain", "uncertain", "connection_lost"],
      ["ohtia.provider.failed", "failure", "provider_error"],
      ["ohtia.provider.output_rejected", "failure", "invalid_json"],
    ] as const;
    for (const [event_name, outcome, error] of cases) {
      const event = { event_name, ...(error ? { error_code: error } : {}) };
      expect(makeDiagnosticRecord(event, "1.0.0", "2026-11-12T00:00:00.000Z")).toMatchObject({
        event_name,
        attributes: { "ohtia.outcome": outcome },
      });
      expect(
        makeDiagnosticRecord(
          { ...event, text: "synthetic-private-content" },
          "1.0.0",
          "2026-11-12T00:00:00.000Z",
        ),
      ).toBeUndefined();
    }
  });
  it.each(["ascii_boundary", "ascii_ceiling", "unicode_ceiling"])(
    "keeps the newest fitting message when older history is omitted: %s",
    (scenario) => {
      const newest = {
        reference: "newest",
        role: "user" as const,
        content:
          scenario === "ascii_boundary"
            ? "x".repeat(16330)
            : scenario === "ascii_ceiling"
              ? "x".repeat(16384)
              : "é".repeat(8192),
      };
      const input = developmentInput([
        { reference: "older", role: "assistant", content: "a".repeat(1000) },
        newest,
      ]);
      expect(input).toEqual([inputOmission, newest]);
      const request = { ...data, input };
      expect(isProviderRequest(request)).toBe(true);
      expect(decodeProviderMessage(JSON.stringify({ ...packet(), request }))).toMatchObject({
        request: { input },
      });
      expect(responseBody(request).input).toEqual([
        { role: "user", content: omittedMessages },
        { role: "user", content: newest.content },
      ]);
    },
  );
  it.each([false, true])(
    "rejects an oversized newest message instead of returning an omission-only prompt with history=%s",
    (history) => {
      const newest = { reference: "newest", role: "user" as const, content: "x".repeat(16385) };
      expect(() =>
        developmentInput(
          history ? [{ reference: "older", role: "assistant", content: "a" }, newest] : [newest],
        ),
      ).toThrow(RangeError);
      expect(isProviderRequest({ ...data, input: [inputOmission] })).toBe(false);
    },
  );
  it("admits only the one exact leading Ohtia note outside ordinary-message counters", () => {
    const message = { reference: "message", role: "user" as const, content: "a" };
    const request = {
      ...data,
      limits: { ...data.limits, max_input_bytes: 1, max_input_items: 1 },
      input: [inputOmission, message],
    };
    expect(isProviderRequest(request)).toBe(true);
    expect(decodeProviderMessage(JSON.stringify({ ...packet(), request }))).toBeDefined();
    expect(
      isProviderRequest({ ...request, input: [inputOmission, { ...message, content: "aa" }] }),
    ).toBe(false);
    expect(
      isProviderRequest({
        ...request,
        input: [inputOmission, message, { ...message, reference: "other" }],
      }),
    ).toBe(false);
    expect(isProviderRequest({ ...data, input: [inputOmission, inputOmission, message] })).toBe(
      false,
    );
    expect(isProviderRequest({ ...request, input: [message, inputOmission] })).toBe(false);
    for (const note of [
      { ...inputOmission, content: inputOmission.content + "x" },
      { ...inputOmission, role: "assistant" },
      { ...inputOmission, reference: "lookalike-note" },
      { ...inputOmission, note: true },
    ])
      expect(isProviderRequest({ ...request, input: [note, message] })).toBe(false);
    expect(
      isProviderRequest({
        ...data,
        limits: { ...data.limits, max_input_bytes: 54 },
        input: [{ reference: "ordinary", role: "user", content: omittedMessages }],
      }),
    ).toBe(false);
  });
  it("keeps the 20-message ceiling and physical channel bound when the fixed note is present", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      reference: "message-" + i,
      role: "user" as const,
      content: "a",
    }));
    expect(isProviderRequest({ ...data, input: [inputOmission, ...messages] })).toBe(true);
    expect(
      isProviderRequest({
        ...data,
        input: [inputOmission, ...messages, { reference: "extra", role: "user", content: "a" }],
      }),
    ).toBe(false);
    expect(
      isProviderRequest({
        ...data,
        input: [...messages, { reference: "extra", role: "user", content: "a" }],
      }),
    ).toBe(false);
    const oversizedFrame = {
      ...packet(),
      request: {
        ...data,
        input: [
          inputOmission,
          { reference: "newest", role: "user", content: String.fromCharCode(1).repeat(16384) },
        ],
      },
    };
    expect(Buffer.byteLength(JSON.stringify(oversizedFrame))).toBeGreaterThan(
      portLimits.message_bytes,
    );
    expect(decodeProviderMessage(JSON.stringify(oversizedFrame))).toBeUndefined();
  });
  it("admits the references-only manifest for instructions, the fixed note and 20 ordinary messages", () => {
    const references = [
      data.instructions.reference,
      inputOmission.reference,
      ...Array.from({ length: 20 }, (_, i) => "message-" + i),
    ];
    const message = {
      version: 1,
      generation: "generation",
      kind: "development_event",
      operation_id: "operation",
      attempt: "attempt",
      event: { kind: "final", sequence: 1, result: { outcome: "completed", dispatched: true } },
      transfer_manifest: references,
      duration_ms: 1,
      longest_silence_ms: 1,
    };
    expect(references).toHaveLength(22);
    expect(decodeProviderMessage(JSON.stringify(message))).toBeDefined();
    expect(
      decodeProviderMessage(
        JSON.stringify({ ...message, transfer_manifest: [...references, "extra"] }),
      ),
    ).toBeUndefined();
  });
  it("uses whole newest messages in order, excluding the fixed Ohtia note from message policy counters", () => {
    const input = Array.from({ length: 21 }, (_, i) => ({
      reference: `message-${i}`,
      role: "user" as const,
      content: `text-${i}`,
    }));
    const result = developmentInput(input);
    expect(result).toHaveLength(21);
    expect(result[0]?.content).toBe(omittedMessages);
    expect(result.slice(1)).toEqual(input.slice(1));
    expect(isProviderRequest({ ...data, input: result })).toBe(true);
    expect(
      developmentInput([{ reference: "large", role: "user", content: "é".repeat(8192) }]),
    ).toHaveLength(1);
    expect(operationPolicy("development_test", "installed")).toBeUndefined();
    expect(operationPolicy("development_test", "qualification")).toBeUndefined();
    expect(operationPolicy("development_test", "development")).toBe(developmentTest);
  });
  it("admits exact development switches only in development and refuses injection/duplicates", () => {
    const args = ["--ohtia-dev-command=request", "--ohtia-dev-model=gpt-6.1-sol"];
    expect(parseDevelopmentSwitches(args)).toEqual({ action: "request", model: "gpt-6.1-sol" });
    expect(() => admitRuntimeSwitches(args, [], false, "development")).not.toThrow();
    for (const mode of ["installed", "qualification"] as const)
      expect(() => admitRuntimeSwitches(args, [], true, mode)).toThrow();
    for (const invalid of [
      [...args, args[1]!],
      ["--ohtia-dev-command=request"],
      [...args, "--ohtia-dev-root=/home"],
      ["--ohtia-dev-attempt=id"],
      [...args, "--no-sandbox"],
    ])
      expect(() => admitRuntimeSwitches(invalid, [], false, "development")).toThrow();
    expect(
      parseDevelopmentSwitches(["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=attempt"]),
    ).toEqual({ action: "interrupt", attempt: "attempt" });
    expect(() =>
      admitRuntimeSwitches([], ["--ohtia-dev-command=request"], false, "development"),
    ).toThrow();
  });
});

describe("Responses transport conformance", () => {
  it("projects every request without state, hosted tools or unsupported fields", async () => {
    const request = {
      ...data,
      previous_response_id: "forbidden",
      conversation: "forbidden",
      prompt: "forbidden",
      tools: [{ type: "web_search" }],
      temperature: 1,
    };
    const body = responseBody(request);
    expect(Object.keys(body).sort()).toEqual(["input", "instructions", "model", "store", "stream"]);
    expect(body).toMatchObject({
      store: false,
      stream: true,
      instructions: developmentTest.instructions,
    });
    expect(body.input).toEqual([{ role: "user", content: "synthetic-private-prompt" }]);
    const out = await run(
      respond(stream(sse({ type: "response.output_text.delta", delta: "hello" }) + sse(completed))),
    );
    expect(out.events).toEqual([
      { kind: "started" },
      { kind: "text", text: "hello" },
      { kind: "usage", usage: unknownUsage },
      { kind: "final", result: { outcome: "completed", dispatched: true } },
    ]);
    expect(out.handle.inspect()).toBe("finished");
    expect(out.renew).not.toHaveBeenCalled();
  });
  it.each([
    [401, undefined, "connection_expired"],
    [403, undefined, "not_eligible"],
    [503, undefined, "provider_unavailable"],
    [403, "subscription_sharing_user_not_eligible", "not_eligible"],
    [429, "subscription_sharing_usage_limit_exceeded", "usage_limit_reached"],
    [503, "subscription_sharing_usage_unavailable", "provider_unavailable"],
    [503, "subscription_sharing_user_unavailable", "provider_unavailable"],
    [400, "subscription_sharing_unsupported_capability", "request_rejected"],
    [403, "subscription_sharing_route_not_supported", "request_rejected"],
    [401, "subscription_sharing_invalid_user", "connection_expired"],
    [403, "chatpass_v2_scope_not_authorized", "request_rejected"],
    [403, "chatpass_v2_invalid_authorization_context", "request_rejected"],
    [400, "other", "request_rejected"],
    [404, "other", "request_rejected"],
    [429, "other", "provider_unavailable"],
    [500, "other", "provider_unavailable"],
  ])(
    "maps HTTP %s / %s to %s once and never leaks provider messages",
    async (status, code, reason) => {
      const transport = vi.fn(
        respond(
          Response.json(
            code
              ? { error: { code, message: "private-provider-detail" } }
              : { detail: "private-provider-detail" },
            { status },
          ),
        ),
      );
      const out = await run(transport);
      expect(out.final).toEqual({
        kind: "final",
        result: { outcome: "failed", dispatched: true, reason },
      });
      expect(transport).toHaveBeenCalledOnce();
      expect(out.renew).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(out.rejectPermission).toHaveBeenCalledTimes(
        String(code).startsWith("chatpass_") ? 1 : 0,
      );
      expect(JSON.stringify(out.events)).not.toMatch(
        /private-provider-detail|synthetic-main-secret/,
      );
    },
  );
  it.each(["response.failed", "response.incomplete", "error"])(
    "keeps partial text and maps %s to provider_error",
    async (type) => {
      const out = await run(
        respond(
          stream(
            sse({ type: "response.output_text.delta", delta: "partial" }) +
              sse({
                type,
                response: {
                  error: { code: "subscription_sharing_usage_limit_exceeded", message: "private" },
                },
              }),
          ),
        ),
      );
      expect(out.events).toContainEqual({ kind: "text", text: "partial" });
      expect(out.final).toMatchObject({ result: { outcome: "failed", reason: "provider_error" } });
    },
  );
  it("classifies rejected output without exposing parser messages or provider fields", async () => {
    const outputRejected = vi.fn();
    await run(respond(stream("data: private-provider-text\n\n")), { outputRejected });
    expect(outputRejected).toHaveBeenLastCalledWith("invalid_json");
    await run(respond(stream(sse({ type: 42, private_detail: "private-provider-event" }))), {
      outputRejected,
    });
    expect(outputRejected).toHaveBeenLastCalledWith("invalid_event");
    expect(JSON.stringify(outputRejected.mock.calls)).not.toContain("private-provider");
  });
  it.each([
    "data: invalid\n\n",
    sse({ type: "response.output_text.delta", delta: 3 }),
    sse({ type: "" }),
    sse({ type: "response.completed", response: { output: [{ type: "function_call" }] } }),
  ])("closes invalid output without erasing partial text", async (bad) => {
    const out = await run(
      respond(stream(sse({ type: "response.output_text.delta", delta: "partial" }) + bad)),
    );
    expect(out.events).toContainEqual({ kind: "text", text: "partial" });
    expect(out.final).toMatchObject({ result: { outcome: "failed", reason: "invalid_output" } });
  });
  it.each(["", "data: [DONE]\n\n", sse({ type: "response.created" }), sse(completed).slice(0, -1)])(
    "keeps an incomplete stream uncertain",
    async (text) => {
      expect((await run(respond(stream(text)))).final).toMatchObject({
        result: { outcome: "uncertain", dispatched: true, reason: "connection_lost" },
      });
    },
  );
  it("distinguishes zero dispatch from a dropped connection after body release", async () => {
    for (const sent of [false, true]) {
      const out = await run(async (options) => {
        if (sent) options.release();
        throw new Error("private-network-error");
      });
      expect(out.final).toMatchObject({
        result: sent
          ? { outcome: "uncertain", dispatched: true, reason: "connection_lost" }
          : { outcome: "failed", dispatched: false, reason: "provider_unavailable" },
      });
    }
    const response = new Response(
      new ReadableStream({
        pull(c) {
          c.error(new TypeError("network failure"));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    expect((await run(respond(response))).final).toMatchObject({
      result: { outcome: "uncertain", reason: "connection_lost" },
    });
  });
  it("enforces output bounds and validates reported usage without replacing unknown values with zero", async () => {
    const out = await run(
      respond(stream(sse({ type: "response.output_text.delta", delta: "é".repeat(8193) }), 65536)),
    );
    expect(out.final).toMatchObject({ result: { reason: "invalid_output" } });
    const done = {
      ...completed,
      response: { ...completed.response, usage: { input_tokens: 0, output_tokens: 3 } },
    };
    expect((await run(respond(stream(sse(done))))).events).toContainEqual({
      kind: "usage",
      usage: { input_tokens: 0, output_tokens: 3, total_tokens: null },
    });
    const invalid = {
      ...completed,
      response: { ...completed.response, usage: { input_tokens: -1 } },
    };
    expect((await run(respond(stream(sse(invalid))))).final).toMatchObject({
      result: { reason: "invalid_output" },
    });
  });
  it("accepts CR-only SSE framing and a completed response that carries its text only in the terminal event", async () => {
    const out = await run(respond(stream(sse(completed).replaceAll("\n", "\r"), 1)));
    expect(out.events).toContainEqual({ kind: "text", text: "hello" });
    expect(out.final).toMatchObject({ result: { outcome: "completed" } });
  });
  it("records reported usage on failed responses while preserving the failure outcome", async () => {
    const out = await run(
      respond(stream(sse({ type: "response.failed", response: { usage: { input_tokens: 12 } } }))),
    );
    expect(out.events).toContainEqual({
      kind: "usage",
      usage: { input_tokens: 12, output_tokens: null, total_tokens: null },
    });
    expect(out.final).toMatchObject({ result: { reason: "provider_error" } });
  });
  it.each([
    new Response(null),
    new Response("plain response"),
    stream('event: response.failed\ndata: {"type":"response.completed"}\n\n'),
    stream("data: ".repeat(1) + "x".repeat(131073)),
    stream("data:\n".repeat(1025)),
    stream(
      sse({ ...completed, response: { ...completed.response, usage: { input_tokens: 1.5 } } }),
    ),
    new Response(new Uint8Array([255, 255]), { headers: { "content-type": "text/event-stream" } }),
  ])(
    "rejects invalid framing, encoding, content types and unbounded event fragments",
    async (response) => {
      expect((await run(respond(response))).final).toMatchObject({
        result: { reason: "invalid_output" },
      });
    },
  );
  it("bounds unstructured HTTP errors and still maps empty or broken bodies without retaining their text", async () => {
    for (const response of [
      new Response(null, { status: 403 }),
      new Response("x".repeat(65537), { status: 503 }),
      new Response(
        new ReadableStream({
          pull(c) {
            c.error(new Error("private"));
          },
        }),
        { status: 503 },
      ),
    ]) {
      const out = await run(respond(response));
      expect(out.final).toMatchObject({
        result: { reason: response.status === 403 ? "not_eligible" : "provider_unavailable" },
      });
      expect(JSON.stringify(out.events)).not.toContain("private");
    }
  });
  it("interrupts a streaming response, closes its reader and emits one cancelled final", async () => {
    let cancelled = false;
    const events: RequestObservation[] = [];
    const handle = startChatGPTRequest(
      data,
      {
        signal: new AbortController().signal,
        authorizeBody: () => undefined,
        emit: (e) => {
          events.push(e);
        },
      },
      {
        token: () => "secret",
        renew: async () => {},
        rejectPermission: async () => {},
        transport: async (options) => {
          options.release();
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    sse({ type: "response.output_text.delta", delta: "partial" }),
                  ),
                );
                options.signal.addEventListener("abort", () => {
                  cancelled = true;
                  controller.error(new Error("aborted"));
                });
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      },
    );
    await vi.waitFor(() => {
      expect(events.some((e) => e.kind === "text")).toBe(true);
    });
    expect(handle.inspect()).toBe("running");
    handle.interrupt();
    await handle.done;
    expect(cancelled).toBe(true);
    expect(events.filter((e) => e.kind === "final")).toEqual([
      { kind: "final", result: { outcome: "cancelled", dispatched: true } },
    ]);
  });
});

async function brokerFixture(onMessage?: (text: string) => void) {
  let now = 10000;
  let state: "connected" | "disconnected" = "connected";
  let prepare: () => Promise<"ready" | "connection_expired" | "provider_unavailable"> = async () =>
    "ready";
  let transport: ResponseTransport = respond(stream(sse(completed)));
  const base = createFakeProvider();
  const start = vi.fn(
    (request: ProviderRequestData, context: Parameters<typeof startChatGPTRequest>[1]) =>
      startChatGPTRequest(request, context, {
        token: () => "secret",
        renew: async () => {},
        rejectPermission: async () => {},
        transport,
      }),
  );
  const adapter = {
    ...base,
    declaration: {
      ...base.declaration,
      connection: { ...base.declaration.connection, id: "chatgpt" },
    },
    requests: { prepare: () => prepare(), start, resume: () => "unsupported" as const },
  };
  const manager = new ConnectionManager([adapter]);
  managers.push(manager);
  vi.spyOn(manager, "snapshot").mockImplementation(
    () => ({ state }) as ReturnType<ConnectionManager["snapshot"]>,
  );
  const output: ProviderMessage[] = [];
  const diagnostics: unknown[] = [];
  const broker = new ProviderRequests(
    "generation",
    manager,
    [adapter],
    (text) => {
      output.push(JSON.parse(text));
      onMessage?.(text);
    },
    () => now,
    (event) => {
      diagnostics.push(event);
    },
  );
  const dispatch = (message = packet()) => broker.receive(JSON.stringify(message));
  const final = () =>
    output
      .filter((m) => m.kind === "provider_event")
      .map((m) => m.event)
      .find((e) => e.kind === "final");
  return {
    broker,
    output,
    start,
    diagnostics,
    dispatch,
    final,
    set now(value: number) {
      now = value;
    },
    set state(value: "connected" | "disconnected") {
      state = value;
    },
    set prepare(value: typeof prepare) {
      prepare = value;
    },
    set transport(value: ResponseTransport) {
      transport = value;
    },
  };
}
describe("dispatch admission", () => {
  it.each([2000, 2001, -1])("refuses a permit age of %s without transport", async (age) => {
    const f = await brokerFixture();
    f.now = 10000 + age;
    f.dispatch();
    await vi.waitFor(() => expect(f.final()).toBeDefined());
    expect(f.final()).toMatchObject({ result: { dispatched: false, reason: "permit_expired" } });
    expect(f.start).not.toHaveBeenCalled();
    f.broker.end();
  });
  it("checks again after a slow renewal and at body release after a delayed TLS connection", async () => {
    for (const delay of ["renewal", "TLS"]) {
      const f = await brokerFixture();
      if (delay === "renewal")
        f.prepare = async () => {
          f.now = 12000;
          return "ready";
        };
      else
        f.transport = async (options) => {
          f.now = 12000;
          options.release();
          return stream(sse(completed));
        };
      f.dispatch();
      await vi.waitFor(() => expect(f.final()).toBeDefined());
      expect(f.final()).toMatchObject({ result: { dispatched: false, reason: "permit_expired" } });
      f.broker.end();
    }
  });
  it("discards ended generations, replays and duplicate attempts without another result", async () => {
    const f = await brokerFixture();
    f.dispatch(packet(10000, "old"));
    expect(f.output).toHaveLength(0);
    f.dispatch();
    await vi.waitFor(() => expect(f.final()).toBeDefined());
    const count = f.output.length;
    f.dispatch();
    f.dispatch({ ...packet(), permit: { ...packet().permit, id: "other" } });
    expect(f.output).toHaveLength(count);
    expect(f.start).toHaveBeenCalledOnce();
    expect(
      f.output.filter((m) => m.kind === "provider_event").map((m) => m.event.sequence),
    ).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(f.diagnostics)).not.toMatch(/secret|private-prompt|hello/);
    f.broker.end();
    f.dispatch({
      ...packet(),
      request: { ...data, attempt: "new" },
      permit: { ...packet().permit, id: "new", attempt: "new" },
    });
    expect(f.output).toHaveLength(count);
  });
  it.each(["connection_expired", "provider_unavailable"] as const)(
    "returns a rejected renewal as %s without sending",
    async (reason) => {
      const f = await brokerFixture();
      f.prepare = async () => reason;
      f.dispatch();
      await vi.waitFor(() => expect(f.final()).toBeDefined());
      expect(f.final()).toMatchObject({ result: { dispatched: false, reason } });
      expect(f.start).not.toHaveBeenCalled();
      f.broker.end();
    },
  );
  it("rechecks connection state after renewal and invalidates permits across suspension", async () => {
    for (const suspend of [false, true]) {
      const f = await brokerFixture();
      f.prepare = async () => {
        if (suspend) f.broker.invalidatePermits();
        else f.state = "disconnected";
        return "ready";
      };
      f.dispatch();
      await vi.waitFor(() => expect(f.final()).toBeDefined());
      expect(f.final()).toMatchObject({
        result: { dispatched: false, reason: suspend ? "permit_expired" : "connection_expired" },
      });
      f.broker.end();
    }
  });
  it("refuses disconnected or unsupported connections before preparing transport", async () => {
    for (const missing of [false, true]) {
      const f = await brokerFixture();
      if (!missing) f.state = "disconnected";
      f.dispatch({
        ...packet(),
        request: { ...data, connection: missing ? "unknown" : "chatgpt" },
      });
      await vi.waitFor(() => expect(f.final()).toBeDefined());
      expect(f.final()).toMatchObject({
        result: {
          dispatched: false,
          reason: missing ? "provider_unavailable" : "connection_expired",
        },
      });
      expect(f.start).not.toHaveBeenCalled();
      f.broker.end();
    }
  });
  it("honors interruption or generation cessation while credential preparation is still pending", async () => {
    for (const end of [true, false]) {
      const f = await brokerFixture();
      let release!: () => void;
      f.prepare = () =>
        new Promise((resolve) => {
          release = () => resolve("ready");
        });
      f.dispatch();
      if (end) f.broker.end();
      else
        f.broker.receive(
          JSON.stringify({
            version: 1,
            generation: "generation",
            kind: "provider_interrupt",
            attempt: "attempt",
          }),
        );
      release();
      await Promise.resolve();
      await Promise.resolve();
      if (end) expect(f.output).toHaveLength(0);
      else expect(f.final()).toMatchObject({ result: { outcome: "cancelled", dispatched: false } });
      expect(f.start).not.toHaveBeenCalled();
      f.broker.end();
    }
  });
  it("reports preparation failures as zero dispatch and missing adapter completion as uncertain", async () => {
    for (const failure of ["prepare", "throw", "missing-final"]) {
      const f = await brokerFixture();
      if (failure === "prepare")
        f.prepare = async () => {
          throw new Error("private");
        };
      else
        f.start.mockImplementation(() => ({
          done: failure === "throw" ? Promise.reject(new Error("private")) : Promise.resolve(),
          interrupt() {},
          inspect: () => "finished",
        }));
      f.dispatch();
      await vi.waitFor(() => expect(f.final()).toBeDefined());
      expect(f.final()).toMatchObject({
        result:
          failure === "prepare"
            ? { dispatched: false, reason: "provider_unavailable" }
            : { outcome: "uncertain", reason: "connection_lost" },
      });
      f.broker.end();
    }
  });
  it("cancels on interrupt and closes old streams without forwarding later events on generation end", async () => {
    for (const end of [true, false]) {
      const f = await brokerFixture();
      let closed = false;
      f.transport = async (options) => {
        options.release();
        return new Response(
          new ReadableStream({
            start(c) {
              options.signal.addEventListener("abort", () => {
                closed = true;
                c.error(new Error("closed"));
              });
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      };
      f.dispatch();
      await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
      if (end) f.broker.end();
      else
        f.broker.receive(
          JSON.stringify({
            version: 1,
            generation: "generation",
            kind: "provider_interrupt",
            attempt: data.attempt,
          }),
        );
      await vi.waitFor(() => expect(closed).toBe(true));
      if (end) expect(f.final()).toBeUndefined();
      else
        await vi.waitFor(() =>
          expect(f.final()).toMatchObject({ result: { outcome: "cancelled" } }),
        );
      f.broker.end();
    }
  });
});

describe("stream boundary regressions", () => {
  it.each(["error_body", "renewal", "permission"])(
    "preserves cancellation during %s handling and avoids an unnecessary renewal after cancellation",
    async (phase) => {
      const abort = new AbortController();
      const renew = vi.fn(async () => {
        abort.abort();
      });
      const rejectPermission = vi.fn(async () => {
        abort.abort();
      });
      const transport: ResponseTransport = async (options) => {
        options.release();
        if (phase === "permission")
          return Response.json(
            { error: { code: "chatpass_v2_scope_not_authorized" } },
            { status: 403 },
          );
        if (phase === "renewal") return new Response(null, { status: 401 });
        return new Response(
          new ReadableStream({
            start(controller) {
              queueMicrotask(() => {
                abort.abort();
                controller.error(new Error("Synthetic cancelled error body."));
              });
            },
          }),
          { status: 401 },
        );
      };
      const out = await run(transport, { renew, rejectPermission }, abort.signal);
      expect(out.final).toEqual({
        kind: "final",
        result: { outcome: "cancelled", dispatched: true },
      });
      expect(renew).toHaveBeenCalledTimes(phase === "renewal" ? 1 : 0);
      expect(rejectPermission).toHaveBeenCalledTimes(phase === "permission" ? 1 : 0);
    },
  );

  it("omits future event types without exposing their data, executing tools or accepting an unknown terminal", async () => {
    const future =
      sse({ type: "response.future_metadata", private_detail: "private-provider-detail" }) +
      sse({ type: "future.event", arguments: "private-tool-arguments" });
    const outputRejected = vi.fn();
    const out = await run(respond(stream(future + sse(completed))), { outputRejected });
    expect(out.final).toMatchObject({ result: { outcome: "completed", dispatched: true } });
    expect(out.events.filter((e) => e.kind === "text")).toEqual([{ kind: "text", text: "hello" }]);
    expect(JSON.stringify(out.events)).not.toMatch(
      /private-provider-detail|private-tool-arguments/,
    );
    expect(outputRejected).not.toHaveBeenCalled();
    expect(
      (await run(respond(stream(future + sse({ type: "response.future_done" }))))).final,
    ).toMatchObject({ result: { outcome: "uncertain", reason: "connection_lost" } });
    const toolOutput = {
      type: "response.completed",
      response: { output: [{ type: "function_call", arguments: "private-tool-arguments" }] },
    };
    expect((await run(respond(stream(future + sse(toolOutput))))).final).toMatchObject({
      result: { reason: "invalid_output" },
    });
  });

  it("validates streamed events when a successful HTTPS response omits its media header", async () => {
    for (const header of [undefined, "", " TEXT/EVENT-STREAM; charset=UTF-8"]) {
      const response = stream(sse(completed));
      if (header === undefined) response.headers.delete("content-type");
      else response.headers.set("content-type", header);
      const out = await run(respond(response));
      expect(out.events).toContainEqual({ kind: "text", text: "hello" });
      expect(out.final).toMatchObject({ result: { outcome: "completed", dispatched: true } });
    }
    const malformed = stream("data: private-malformed-data\n\n");
    malformed.headers.delete("content-type");
    const out = await run(respond(malformed));
    expect(out.final).toMatchObject({ result: { reason: "invalid_output" } });
    expect(JSON.stringify(out.events)).not.toContain("private-malformed-data");
    const misleading = stream(sse(completed));
    misleading.headers.set("content-type", "text/event-stream-bogus");
    expect((await run(respond(misleading))).final).toMatchObject({
      result: { reason: "invalid_output" },
    });
  });

  it.each([
    { type: "response.completed" },
    { type: "response.completed", response: { output: null } },
    { type: "response.completed", response: { output: [null] } },
    {
      type: "response.completed",
      response: {
        output: [
          { type: "message", role: "assistant", content: [{ type: "refusal", refusal: null }] },
        ],
      },
    },
    { type: "response.failed", response: { usage: "private-detail" } },
  ])("rejects malformed terminal data and retains already streamed text", async (terminal) => {
    const out = await run(
      respond(
        stream(sse({ type: "response.output_text.delta", delta: "partial" }) + sse(terminal)),
      ),
    );
    expect(out.events).toContainEqual({ kind: "text", text: "partial" });
    expect(out.final).toMatchObject({
      result: { outcome: "failed", dispatched: true, reason: "invalid_output" },
    });
    expect(JSON.stringify(out.events)).not.toContain("private-detail");
  });
  it("accepts stream comments, metadata fields and reasoning while projecting only assistant text", async () => {
    const terminal = {
      ...completed,
      response: {
        ...completed.response,
        output: [{ type: "reasoning", summary: [] }, ...completed.response.output],
      },
    };
    const out = await run(
      respond(stream(": keepalive\nid: event-one\nretry: 1000\nmetadata\n\n" + sse(terminal))),
    );
    expect(out.events.filter((e) => e.kind === "text")).toEqual([{ kind: "text", text: "hello" }]);
    expect(out.final).toMatchObject({ result: { outcome: "completed", dispatched: true } });
  });
  it("reports cancellation before opening a connection and refuses an absent credential before body release", async () => {
    const abort = new AbortController();
    abort.abort();
    const transport = vi.fn(respond(stream(sse(completed))));
    expect((await run(transport, {}, abort.signal)).final).toMatchObject({
      result: { outcome: "cancelled", dispatched: false },
    });
    expect(transport).not.toHaveBeenCalled();
    expect((await run(transport, { token: () => undefined })).final).toMatchObject({
      result: { outcome: "failed", dispatched: false, reason: "connection_expired" },
    });
  });
  it("rejects a truncated UTF-8 character at stream EOF as invalid output", async () => {
    const response = new Response(new Uint8Array([0xe2, 0x82]), {
      headers: { "content-type": "text/event-stream" },
    });
    expect((await run(respond(response))).final).toMatchObject({
      result: { reason: "invalid_output" },
    });
  });
  it("keeps the synthetic adapter's preflight, refusal and cancellation lifecycle consistent with the contract", async () => {
    const fake = createFakeProvider();
    expect(await fake.requests!.prepare()).toBe("connection_expired");
    await fake.credentials.write({ credential: "synthetic-session", reason: null });
    expect(await fake.requests!.prepare()).toBe("ready");
    for (const cancelled of [true, false]) {
      const controller = new AbortController();
      if (cancelled) controller.abort();
      const events: RequestObservation[] = [];
      const handle = fake.requests!.start(data, {
        signal: controller.signal,
        authorizeBody: () => "permit_expired",
        emit: (e) => {
          events.push(e);
        },
      });
      expect(handle.inspect()).toBe("running");
      await handle.done;
      expect(handle.inspect()).toBe("finished");
      expect(events).toEqual([
        {
          kind: "final",
          result: cancelled
            ? { outcome: "cancelled", dispatched: false }
            : { outcome: "failed", dispatched: false, reason: "permit_expired" },
        },
      ]);
    }
  });
});

describe("structured refusal and content-filter results", () => {
  const explanation = "Synthetic refusal " + String.fromCodePoint(0x1f642);
  const output = (refusal = explanation, text = "") => [
    {
      type: "message",
      role: "assistant",
      content: [...(text ? [{ type: "output_text", text }] : []), { type: "refusal", refusal }],
    },
  ];
  const refused = (refusal = explanation, text = "") => ({
    type: "response.completed",
    response: { output: output(refusal, text) },
  });
  const filtered = {
    type: "response.incomplete",
    response: {
      output: output(),
      incomplete_details: { reason: "content_filter" },
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    },
  };
  it.each([false, true])(
    "preserves a structured refusal with streamed=%s without duplicating it",
    async (streamed) => {
      const prefix = streamed
        ? sse({ type: "response.refusal.delta", delta: explanation }) +
          sse({ type: "response.refusal.done", refusal: explanation })
        : "";
      const out = await run(respond(stream(prefix + sse(refused()))));
      expect(out.events).toEqual([
        { kind: "started" },
        { kind: "refusal", text: explanation },
        { kind: "usage", usage: unknownUsage },
        { kind: "final", result: { outcome: "refused", dispatched: true } },
      ]);
      expect(out.renew).not.toHaveBeenCalled();
      expect(out.rejectPermission).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "lets an explicit filter ending prevail over refusal content with streamed=%s",
    async (streamed) => {
      const prefix = streamed
        ? sse({ type: "response.output_text.delta", delta: "partial" }) +
          sse({ type: "response.refusal.delta", delta: explanation })
        : "";
      const out = await run(respond(stream(prefix + sse(filtered))));
      expect(out.final).toEqual({
        kind: "final",
        result: { outcome: "content_filtered", dispatched: true },
      });
      expect(out.events.filter((e) => e.kind === "refusal")).toEqual([
        { kind: "refusal", text: explanation },
      ]);
      expect(out.events.filter((e) => e.kind === "text")).toEqual(
        streamed ? [{ kind: "text", text: "partial" }] : [],
      );
      expect(out.events).toContainEqual({
        kind: "usage",
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      });
      expect(out.renew).not.toHaveBeenCalled();
      expect(out.rejectPermission).not.toHaveBeenCalled();
    },
  );
  it("preserves both ordinary text and a refusal while the structured terminal part determines the result", async () => {
    const out = await run(respond(stream(sse(refused(explanation, "Safe alternative.")))));
    expect(out.events.filter((e) => e.kind === "text")).toEqual([
      { kind: "text", text: "Safe alternative." },
    ]);
    expect(out.events.filter((e) => e.kind === "refusal")).toEqual([
      { kind: "refusal", text: explanation },
    ]);
    expect(out.final).toMatchObject({ result: { outcome: "refused" } });
    const empty = await run(respond(stream(sse(refused("")))));
    expect(empty.final).toMatchObject({ result: { outcome: "refused" } });
  });
  it("uses no text heuristic and treats only the explicit incomplete content_filter reason as filtering", async () => {
    const plain = "I cannot help with that content_filter request.";
    const out = await run(
      respond(
        stream(
          sse({
            ...completed,
            response: {
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: plain }],
                },
              ],
            },
          }),
        ),
      ),
    );
    expect(out.final).toMatchObject({ result: { outcome: "completed" } });
    for (const terminal of [
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      },
      { type: "response.failed", response: { incomplete_details: { reason: "content_filter" } } },
      { type: "error", code: "content_filter" },
    ]) {
      const failed = await run(respond(stream(sse(terminal))));
      expect(failed.final).toMatchObject({
        result: { outcome: "failed", reason: "provider_error" },
      });
    }
  });
  it.each([false, true])(
    "does not finish on refusal delta or done and retains partial explanation with done=%s",
    async (done) => {
      const out = await run(
        respond(
          stream(
            sse({ type: "response.refusal.delta", delta: explanation }) +
              (done ? sse({ type: "response.refusal.done", refusal: explanation }) : ""),
          ),
        ),
      );
      expect(out.events).toContainEqual({ kind: "refusal", text: explanation });
      expect(out.final).toMatchObject({
        result: { outcome: "uncertain", reason: "connection_lost" },
      });
    },
  );
  it("closes a request interrupted during a refusal without reporting a terminal refusal", async () => {
    let handle: ReturnType<typeof startChatGPTRequest>;
    const events: RequestObservation[] = [];
    handle = startChatGPTRequest(
      data,
      {
        signal: new AbortController().signal,
        authorizeBody: () => undefined,
        emit: (event) => {
          events.push(event);
          if (event.kind === "refusal") handle.interrupt();
        },
      },
      {
        token: () => "synthetic-secret",
        renew: async () => {},
        rejectPermission: async () => {},
        transport: respond(
          stream(sse({ type: "response.refusal.delta", delta: explanation }) + sse(refused())),
        ),
      },
    );
    await handle.done;
    expect(events.at(-1)).toEqual({
      kind: "final",
      result: { outcome: "cancelled", dispatched: true },
    });
    expect(events.filter((e) => e.kind === "final")).toHaveLength(1);
  });
  it.each([
    "bad_delta",
    "bad_terminal",
    "mismatched_terminal",
    "combined_delta_limit",
    "combined_terminal_limit",
    "unpaired_delta",
    "unpaired_terminal",
  ])("rejects malformed or oversized refusal output: %s", async (scenario) => {
    const unpaired = String.fromCharCode(0xd800);
    const content =
      scenario === "bad_delta"
        ? sse({ type: "response.refusal.delta", delta: 1 })
        : scenario === "bad_terminal"
          ? sse({
              ...refused(),
              response: { output: [{ type: "message", role: "assistant", content: [null] }] },
            })
          : scenario === "mismatched_terminal"
            ? sse({ type: "response.refusal.delta", delta: explanation }) +
              sse(refused("different"))
            : scenario === "combined_delta_limit"
              ? sse({ type: "response.output_text.delta", delta: "x".repeat(8192) }) +
                sse({ type: "response.refusal.delta", delta: "é".repeat(4097) })
              : scenario === "combined_terminal_limit"
                ? sse(refused("é".repeat(4097), "x".repeat(8192)))
                : scenario === "unpaired_delta"
                  ? sse({ type: "response.refusal.delta", delta: unpaired })
                  : sse(refused(unpaired));
    const out = await run(respond(stream(content, 10000)));
    expect(out.final).toMatchObject({ result: { outcome: "failed", reason: "invalid_output" } });
    expect(out.events.filter((e) => e.kind === "refusal")).toEqual(
      scenario === "mismatched_terminal" ? [{ kind: "refusal", text: explanation }] : [],
    );
  });
});

describe("reviewed request boundaries", () => {
  it.each(["delta", "completed_only", "paired_unicode"])(
    "keeps the data-service protocol valid for %s output and preserves valid partial text",
    async (scenario) => {
      let service!: ServiceRequests;
      const f = await brokerFixture((text) => {
        expect(service.receive(text)).toBe(true);
      });
      const connections = new ServiceConnections();
      connections.receive({
        kind: "connection_state",
        generation: "generation",
        snapshot: {
          connection: "chatgpt",
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: null,
          model_count: 0,
        },
      });
      const bad = "a" + String.fromCharCode(0xd800);
      const valid = "safe " + String.fromCodePoint(0x1f642);
      const terminal = (text: string) => ({
        ...completed,
        response: {
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
          ],
        },
      });
      f.transport = respond(
        stream(
          scenario === "delta"
            ? sse({ type: "response.output_text.delta", delta: "safe" }) +
                sse({ type: "response.output_text.delta", delta: bad })
            : scenario === "completed_only"
              ? sse(terminal(bad))
              : sse({ type: "response.output_text.delta", delta: valid }) + sse(terminal(valid)),
        ),
      );
      const output: any[] = [];
      let attempt = "";
      service = new ServiceRequests(
        "generation",
        "development",
        connections,
        (text) => {
          const message = decodeProviderMessage(text)!;
          output.push(message);
          if (message.kind === "provider_dispatch") {
            attempt = message.request.attempt;
            expect(f.broker.receive(text)).toBe(true);
          }
        },
        () => 10000,
      );
      try {
        service.receive(
          JSON.stringify({
            version: 1,
            generation: "generation",
            kind: "development_command",
            operation_id: "operation",
            command: { action: "request", model: data.model },
          }),
        );
        await vi.waitFor(() => expect(service.inspect(attempt)?.result).not.toBeNull());
        expect(service.inspect(attempt)?.text).toBe(
          scenario === "delta" ? "safe" : scenario === "completed_only" ? "" : valid,
        );
        expect(service.inspect(attempt)?.result).toEqual(
          scenario === "paired_unicode"
            ? { outcome: "completed", dispatched: true }
            : { outcome: "failed", dispatched: true, reason: "invalid_output" },
        );
        expect(
          f.output.every((message) => decodeProviderMessage(JSON.stringify(message)) !== undefined),
        ).toBe(true);
        expect(
          output.some(
            (message) => message.kind === "development_event" && message.event.kind === "final",
          ),
        ).toBe(true);
      } finally {
        f.broker.end();
        service.dispose();
      }
    },
  );
  it.each(["refused", "content_filtered"] as const)(
    "forwards and retains %s without putting its explanation into diagnostics",
    async (outcome) => {
      const connections = new ServiceConnections();
      connections.receive({
        kind: "connection_state",
        generation: "generation",
        snapshot: {
          connection: "chatgpt",
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: null,
          model_count: 0,
        },
      });
      let service: ServiceRequests | undefined;
      const f = await brokerFixture((text) => {
        expect(service!.receive(text)).toBe(true);
      });
      const refusal = "synthetic-private-refusal";
      const output = [
        { type: "message", role: "assistant", content: [{ type: "refusal", refusal }] },
      ];
      const terminal =
        outcome === "refused"
          ? { type: "response.completed", response: { output } }
          : {
              type: "response.incomplete",
              response: { incomplete_details: { reason: "content_filter" }, output },
            };
      f.transport = respond(
        stream(sse({ type: "response.refusal.delta", delta: refusal }) + sse(terminal)),
      );
      let attempt = "";
      const forwarded: unknown[] = [];
      service = new ServiceRequests(
        "generation",
        "development",
        connections,
        (text) => {
          const message = decodeProviderMessage(text)!;
          forwarded.push(message);
          if (message.kind === "provider_dispatch") {
            attempt = message.request.attempt;
            expect(f.broker.receive(text)).toBe(true);
          }
        },
        () => 10000,
      );
      try {
        service.receive(
          JSON.stringify({
            version: 1,
            generation: "generation",
            kind: "development_command",
            operation_id: "operation",
            command: { action: "request", model: data.model },
          }),
        );
        await vi.waitFor(() =>
          expect(service!.inspect(attempt)?.result).toEqual({ outcome, dispatched: true }),
        );
        expect(service.inspect(attempt)).toMatchObject({ text: "", refusal, usage: unknownUsage });
        expect(JSON.stringify(forwarded)).toContain(refusal);
        const record = makeDiagnosticRecord(
          f.diagnostics.at(-1),
          "1.0.0",
          "2026-11-12T00:00:00.000Z",
        );
        expect(record).toMatchObject({
          event_name: "ohtia.provider." + outcome,
          attributes: { "ohtia.outcome": outcome },
        });
        expect(record?.attributes).not.toHaveProperty("ohtia.error.code");
        expect(JSON.stringify(f.diagnostics)).not.toContain(refusal);
        expect(JSON.stringify(record)).not.toContain(refusal);
      } finally {
        f.broker.end();
        service.dispose();
      }
    },
  );
  it.each(["rejected", "missing_final"])(
    "retains an adapter's defensive uncertain result as the first event: %s",
    async (failure) => {
      const connections = new ServiceConnections();
      connections.receive({
        kind: "connection_state",
        generation: "generation",
        snapshot: {
          connection: "chatgpt",
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: null,
          model_count: 0,
        },
      });
      let service: ServiceRequests | undefined;
      const f = await brokerFixture((text) => {
        expect(service!.receive(text)).toBe(true);
      });
      f.start.mockImplementation(() => ({
        done:
          failure === "rejected"
            ? Promise.reject(new Error("synthetic adapter failure"))
            : Promise.resolve(),
        interrupt() {},
        inspect: () => "finished",
      }));
      let attempt = "";
      service = new ServiceRequests(
        "generation",
        "development",
        connections,
        (text) => {
          const message = decodeProviderMessage(text)!;
          if (message.kind === "provider_dispatch") {
            attempt = message.request.attempt;
            f.broker.receive(text);
          }
        },
        () => 10000,
      );
      try {
        service.receive(
          JSON.stringify({
            version: 1,
            generation: "generation",
            kind: "development_command",
            operation_id: "operation",
            command: { action: "request", model: data.model },
          }),
        );
        await vi.waitFor(() =>
          expect(service!.inspect(attempt)?.result).toEqual({
            outcome: "uncertain",
            dispatched: true,
            reason: "connection_lost",
          }),
        );
        expect(f.output).toHaveLength(1);
        expect(f.output[0]).toMatchObject({
          kind: "provider_event",
          event: { kind: "final", sequence: 1, result: { outcome: "uncertain" } },
        });
        expect(service.inspect(attempt)).toMatchObject({
          text: "",
          refusal: "",
          usage: unknownUsage,
        });
        const firstAttempt = attempt;
        expect(
          service.receive(
            JSON.stringify({
              version: 1,
              generation: "generation",
              kind: "development_command",
              operation_id: "next-operation",
              command: { action: "request", model: data.model },
            }),
          ),
        ).toBe(true);
        expect(attempt).not.toBe(firstAttempt);
        await vi.waitFor(() =>
          expect(service!.inspect(attempt)?.result).toEqual({
            outcome: "uncertain",
            dispatched: true,
            reason: "connection_lost",
          }),
        );
        expect(f.start).toHaveBeenCalledTimes(2);
      } finally {
        f.broker.end();
        service.dispose();
      }
    },
  );
  it("preserves uncertain provider outcomes in the serialized diagnostic record", async () => {
    const f = await brokerFixture();
    f.transport = respond(stream(sse({ type: "response.output_text.delta", delta: "partial" })));
    f.dispatch();
    await vi.waitFor(() =>
      expect(f.final()).toMatchObject({
        result: { outcome: "uncertain", reason: "connection_lost" },
      }),
    );
    const record = makeDiagnosticRecord(f.diagnostics.at(-1), "1.0.0", "2026-11-12T00:00:00.000Z");
    expect(record).toMatchObject({
      event_name: "ohtia.provider.uncertain",
      attributes: { "ohtia.outcome": "uncertain", "ohtia.error.code": "connection_lost" },
    });
    expect(
      decodeProviderMessage(
        JSON.stringify({
          version: 1,
          generation: "generation",
          kind: "provider_event",
          attempt: "attempt",
          event: {
            kind: "final",
            sequence: 1,
            result: { outcome: "failed", dispatched: true, reason: "connection_lost" },
          },
        }),
      ),
    ).toBeUndefined();
    f.broker.end();
  });
  it("refuses an already retired connection without opening the transport", async () => {
    const connection = new AbortController();
    connection.abort();
    const transport = vi.fn(respond(stream(sse(completed))));
    const out = await run(transport, { connectionSignal: connection.signal });
    expect(transport).not.toHaveBeenCalled();
    expect(out.final).toMatchObject({
      result: { outcome: "failed", dispatched: false, reason: "connection_expired" },
    });
  });
});

describe("ChatGPT account changes during requests", () => {
  async function connected(transport: ResponseTransport) {
    const f = fakeChatGPT({ transport });
    managers.push(f.manager);
    await f.login();
    expect(await f.adapter.requests.prepare()).toBe("ready");
    return f;
  }
  it("lets an already dispatched response finish after sign-out while the connection blocks new work", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let aborted = false;
    const f = await connected(async (options) => {
      options.release();
      return new Response(
        new ReadableStream({
          start(value) {
            controller = value;
            value.enqueue(
              new TextEncoder().encode(sse({ type: "response.output_text.delta", delta: "hello" })),
            );
            options.signal.addEventListener("abort", () => {
              aborted = true;
              value.error(new Error("Synthetic response closed."));
            });
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const events: RequestObservation[] = [];
    const abort = new AbortController();
    const handle = f.adapter.requests.start(data, {
      signal: abort.signal,
      authorizeBody: () => undefined,
      emit: (event) => {
        events.push(event);
      },
    });
    try {
      await vi.waitFor(() => expect(events).toContainEqual({ kind: "text", text: "hello" }));
      await f.manager.disconnect("chatgpt");
      expect(f.manager.snapshot("chatgpt")?.state).toBe("disconnected");
      expect(aborted).toBe(false);
      expect(handle.inspect()).toBe("running");
      controller.enqueue(new TextEncoder().encode(sse(completed)));
      controller.close();
      await handle.done;
      expect(events.at(-1)).toEqual({
        kind: "final",
        result: { outcome: "completed", dispatched: true },
      });
    } finally {
      abort.abort();
      await handle.done;
    }
  });
  it("refuses body release under a replacement account instead of treating sign-out as interruption", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await connected(async (options) => {
      await gate;
      options.release();
      return stream(sse(completed));
    });
    const events: RequestObservation[] = [];
    const abort = new AbortController();
    const handle = f.adapter.requests.start(data, {
      signal: abort.signal,
      authorizeBody: () =>
        f.manager.snapshot("chatgpt")?.state === "connected" ? undefined : "connection_expired",
      emit: (event) => {
        events.push(event);
      },
    });
    try {
      await f.manager.disconnect("chatgpt");
      f.account = "two";
      await f.login(true);
      release();
      await handle.done;
      expect(events).toEqual([
        {
          kind: "final",
          result: { outcome: "failed", dispatched: false, reason: "connection_expired" },
        },
      ]);
      expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
    } finally {
      release();
      abort.abort();
      await handle.done;
    }
  });
  it.each([401, 403])(
    "keeps late HTTPS %s responses from changing a replacement account",
    async (status) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const f = await connected(async (options) => {
        options.release();
        await gate;
        return Response.json(
          {
            error: {
              code:
                status === 401
                  ? "subscription_sharing_invalid_user"
                  : "chatpass_v2_scope_not_authorized",
            },
          },
          { status },
        );
      });
      const events: RequestObservation[] = [];
      const abort = new AbortController();
      const handle = f.adapter.requests.start(data, {
        signal: abort.signal,
        authorizeBody: () => undefined,
        emit: (event) => {
          events.push(event);
        },
      });
      try {
        await vi.waitFor(() => expect(events).toContainEqual({ kind: "started" }));
        await f.manager.disconnect("chatgpt");
        f.account = "two";
        await f.login(true);
        release();
        await handle.done;
        expect(events.at(-1)).toEqual({
          kind: "final",
          result: {
            outcome: "failed",
            dispatched: true,
            reason: status === 401 ? "connection_expired" : "request_rejected",
          },
        });
        expect(f.manager.snapshot("chatgpt")).toMatchObject({ state: "connected", reason: null });
        expect(await f.store.readSession()).toMatchObject({
          status: "stored",
          value: { reason: null },
        });
        expect(
          f.requests.filter((request) => request.body?.get("grant_type") === "refresh_token"),
        ).toHaveLength(0);
      } finally {
        release();
        abort.abort();
        await handle.done;
      }
    },
  );
  it("still closes a dispatched response when the adapter is disposed", async () => {
    const f = await connected(async (options) => {
      options.release();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                sse({ type: "response.output_text.delta", delta: "partial" }),
              ),
            );
            options.signal.addEventListener("abort", () =>
              controller.error(new Error("Synthetic disposal.")),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const events: RequestObservation[] = [];
    const handle = f.adapter.requests.start(data, {
      signal: new AbortController().signal,
      authorizeBody: () => undefined,
      emit: (event) => {
        events.push(event);
      },
    });
    await vi.waitFor(() => expect(events).toContainEqual({ kind: "text", text: "partial" }));
    f.adapter.dispose();
    await handle.done;
    expect(events.at(-1)).toEqual({
      kind: "final",
      result: { outcome: "cancelled", dispatched: true },
    });
  });
});

describe("service-owned development attempts", () => {
  function fixture(mode = "development") {
    const connections = new ServiceConnections();
    connections.receive({
      kind: "connection_state",
      generation: "generation",
      snapshot: {
        connection: "chatgpt",
        state: "connected",
        reason: null,
        probing: false,
        probe_id: null,
        model_list_revision: null,
        model_count: 0,
      },
    });
    const output: any[] = [];
    const service = new ServiceRequests(
      "generation",
      mode,
      connections,
      (text) => {
        output.push(JSON.parse(text));
      },
      () => 10000,
    );
    const command = (
      action: unknown = { action: "request", model: "gpt-6.1-sol" },
      operation_id = "operation",
    ) =>
      service.receive(
        JSON.stringify({
          version: 1,
          kind: "development_command",
          generation: "generation",
          operation_id,
          command: action,
        }),
      );
    return { service, output, command, connections };
  }
  it("returns a private references-only manifest, instructions, sequenced partial output and unknown usage", () => {
    const f = fixture();
    f.command();
    const dispatch = f.output.find((m) => m.kind === "provider_dispatch");
    expect(dispatch.request.instructions.text).toBe(developmentTest.instructions);
    expect(dispatch.request.input[0].content).toBe(
      "Describe the usual parts of a thesis in about 300 words.",
    );
    const id = dispatch.request.attempt;
    const receive = (event: ProviderEvent) =>
      f.service.receive(
        JSON.stringify({
          version: 1,
          generation: "generation",
          kind: "provider_event",
          attempt: id,
          event,
        }),
      );
    receive({ kind: "started", sequence: 1 });
    receive({ kind: "text", sequence: 2, text: "partial" });
    receive({
      kind: "final",
      sequence: 3,
      result: { outcome: "failed", dispatched: true, reason: "invalid_output" },
    });
    expect(f.service.inspect(id)).toEqual({
      text: "partial",
      refusal: "",
      usage: unknownUsage,
      result: { outcome: "failed", dispatched: true, reason: "invalid_output" },
      transfer_manifest: ["development-test-instructions-v1", `${id}-input`],
    });
    expect(JSON.stringify(f.output)).not.toContain("credential");
    const count = f.output.filter((m) => m.kind === "provider_dispatch").length;
    f.command();
    expect(f.output.filter((m) => m.kind === "provider_dispatch")).toHaveLength(count);
    f.service.dispose();
    expect(f.service.inspect(id)).toBeUndefined();
  });
  it("applies one UTF-8 output budget across text and refusal parts", () => {
    const f = fixture();
    f.command();
    const attempt = f.output.find((message) => message.kind === "provider_dispatch").request
      .attempt;
    const receive = (event: ProviderEvent) =>
      f.service.receive(
        JSON.stringify({
          version: 1,
          generation: "generation",
          kind: "provider_event",
          attempt,
          event,
        }),
      );
    receive({ kind: "started", sequence: 1 });
    for (let i = 0; i < 3; i++) receive({ kind: "text", sequence: i + 2, text: "x".repeat(4096) });
    receive({ kind: "refusal", sequence: 5, text: "é".repeat(2048) });
    expect(() => receive({ kind: "refusal", sequence: 6, text: "é" })).toThrow("bound");
    expect(f.service.inspect(attempt)).toMatchObject({
      text: "x".repeat(12288),
      refusal: "é".repeat(2048),
    });
    f.service.dispose();
  });
  it("refuses development requests independently in installed and qualification modes", () => {
    for (const mode of ["installed", "qualification"]) {
      const f = fixture(mode);
      expect(() => f.command()).toThrow("runtime");
      expect(f.output).toHaveLength(0);
    }
  });
  it("checks connection admission, bounds its inventory and routes interrupt without another dispatch", () => {
    const f = fixture();
    f.command();
    const id = f.output[0].attempt;
    f.command({ action: "interrupt", attempt: id }, "interrupt");
    expect(f.output).toContainEqual({
      version: 1,
      generation: "generation",
      kind: "provider_interrupt",
      attempt: id,
    });
    f.command({ action: "interrupt", attempt: "unknown" }, "other");
    expect(f.output.at(-1).error).toBe("unknown_attempt");
    for (let i = 1; i <= 20; i++) f.command(undefined, `operation-${i}`);
    expect(f.output.at(-1).error).toBe("busy");
  });
  it("rejects sequence gaps and unavailable admission, and ignores terminal or old-generation events", () => {
    const f = fixture();
    expect(f.service.receive("ordinary-message")).toBe(false);
    f.command();
    const id = f.output[0].attempt;
    const event = (sequence: number) => ({
      version: 1,
      kind: "provider_event",
      generation: "generation",
      attempt: id,
      event: { kind: "text", text: "partial", sequence },
    });
    expect(() => f.service.receive(JSON.stringify(event(2)))).toThrow("sequence");
    const done = {
      ...event(1),
      event: { kind: "final", sequence: 1, result: { outcome: "cancelled", dispatched: false } },
    };
    f.service.receive(JSON.stringify(done));
    const count = f.output.length;
    f.service.receive(JSON.stringify(event(2)));
    f.service.receive(JSON.stringify({ ...done, generation: "old" }));
    expect(f.output).toHaveLength(count);
    f.connections.receive({
      kind: "connection_state",
      generation: "generation",
      snapshot: {
        connection: "chatgpt",
        state: "disconnected",
        reason: null,
        probing: false,
        probe_id: null,
        model_list_revision: null,
        model_count: 0,
      },
    });
    f.command(undefined, "disconnected");
    expect(f.output.at(-1).error).toBe("unavailable");
    f.service.dispose();
    f.command(undefined, "disposed");
    expect(f.output.at(-1).error).toBe("unavailable");
  });
});

describe("ChatGPT session integration", () => {
  it.each(["invalid_grant", "invalid_client", "temporary"])(
    "prepares one expired-session renewal with %s",
    async (code) => {
      const f = fakeChatGPT();
      managers.push(f.manager);
      await f.login();
      const current = await f.store.readSession();
      expect(current.status).toBe("stored");
      if (current.status !== "stored") return;
      const value = JSON.parse(current.value.credential);
      value.expires = Date.now() - 1;
      await f.adapter.credentials.write({ ...current.value, credential: JSON.stringify(value) });
      f.refreshError = code;
      f.refreshStatus = code === "temporary" ? 503 : 400;
      expect(await f.adapter.requests.prepare()).toBe(
        code === "temporary" ? "provider_unavailable" : "connection_expired",
      );
      expect(f.manager.snapshot("chatgpt")?.state).toBe(
        code === "temporary" ? "connected" : code === "invalid_client" ? "error" : "expired",
      );
      expect(f.requests.filter((r) => r.body?.get("grant_type") === "refresh_token")).toHaveLength(
        1,
      );
    },
  );
  it("persists rejected permission with the kept session and restores error after restart", async () => {
    const f = fakeChatGPT();
    managers.push(f.manager);
    await f.login();
    f.adapter.dispose();
    const adapter = new ChatGPTProvider({
      store: f.store,
      openBrowser: async () => {},
      completedText: () => "complete",
      request: f.request,
      transport: respond(
        Response.json(
          { error: { code: "chatpass_v2_scope_not_authorized", message: "private" } },
          { status: 403 },
        ),
      ),
    });
    const manager = new ConnectionManager([adapter]);
    managers.push(manager);
    await manager.read("chatgpt");
    expect(await adapter.requests.prepare()).toBe("ready");
    const events: RequestObservation[] = [];
    await adapter.requests.start(data, {
      signal: new AbortController().signal,
      authorizeBody: () => undefined,
      emit: (e) => {
        events.push(e);
      },
    }).done;
    expect(events.at(-1)).toMatchObject({ result: { reason: "request_rejected" } });
    expect(manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "sign_in_rejected",
    });
    manager.dispose();
    const restored = new ChatGPTProvider({
      store: f.store,
      openBrowser: async () => {},
      completedText: () => "complete",
      request: f.request,
    });
    const after = new ConnectionManager([restored]);
    managers.push(after);
    expect(await after.read("chatgpt")).toMatchObject({
      value: { state: "error", reason: "sign_in_rejected" },
    });
    expect(restored.requests.resume()).toBe("unsupported");
  });
});
