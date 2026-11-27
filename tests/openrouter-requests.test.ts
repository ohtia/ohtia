import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DiagnosticEvent,
  ProviderEvent,
  ProviderRequestData,
  ProviderTool,
} from "../packages/contracts/src/index.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { CredentialStore } from "../packages/main/src/credential-store.js";
import {
  OpenRouterProvider,
  openrouterConnectionId as openrouter,
} from "../packages/main/src/openrouter-provider.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import {
  transportFailure,
  type ProviderTransport,
  type TransportRequest,
} from "../packages/main/src/provider-https.js";
import { conformanceRequest, dispatchThrough } from "./fixtures/provider-conformance.js";
import {
  chunk,
  errorBodies,
  generation,
  textReply,
  toolReplyOneFragment,
  toolReplyThreeFragments,
  usage,
} from "./fixtures/openrouter-streams.js";

const key = "sk-or-v1-synthetic-openrouter-key";
const replacement = "sk-or-v1-synthetic-replacement";
const kimi = "moonshotai/kimi-k3.1-pro";
const listed = (id: string, efforts = ["max", "high", "low", "none"]) => ({
  id,
  name: `Synthetic ${id}`,
  context_length: 1_048_576,
  architecture: { output_modalities: ["text"], tokenizer: "Other" },
  top_provider: { max_completion_tokens: 65_536 },
  supported_parameters: ["tools", "reasoning"],
  reasoning: { mandatory: false, supported_efforts: efforts, default_effort: efforts[0] },
  expiration_date: null,
  endpoints: ["/api/v1/chat/completions"],
});
const noteTool: ProviderTool = {
  namespace: "ohtia",
  name: "record_note",
  description: "Record a note.",
  strict: true,
  parameters: {
    type: "object",
    properties: { note: { type: "string", description: "The note." } },
    required: ["note"],
    additionalProperties: false,
  },
};
/** Every field Ohtia may send; the conformance check refuses anything else. */
const allowedFields = [
  "model",
  "stream",
  "messages",
  "tools",
  "tool_choice",
  "reasoning",
  "provider",
];
const forbiddenFields = [
  "models",
  "route",
  "plugins",
  "transforms",
  "user",
  "session_id",
  "max_tokens",
  "max_completion_tokens",
  "stream_options",
  "usage",
  "prompt",
  "cache_control",
];

type Item = Record<string, unknown> | string;
/** A server-sent event body; `end` says how the transport ends after the listed items. */
function stream(
  items: readonly Item[],
  signal: AbortSignal,
  end: "close" | "drop" | "hold" = "close",
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of items) {
        const text =
          typeof item !== "string"
            ? `data: ${JSON.stringify(item)}\n\n`
            : item.startsWith(":")
              ? `${item}\n\n`
              : `data: ${item}\n\n`;
        controller.enqueue(encoder.encode(text));
      }
      if (end === "close") controller.close();
      // Erroring at once would discard the queued chunks, which a real socket has delivered.
      else if (end === "drop")
        setTimeout(() => {
          controller.error(new Error("Synthetic connection drop."));
        }, 10);
      else
        signal.addEventListener("abort", () => {
          controller.error(new Error("Synthetic abort."));
        });
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-generation-id": generation },
  });
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
});

function harness(models: readonly Record<string, unknown>[] = [listed(kimi)]) {
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
  const sent: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const state = {
    models: [...models],
    chat: (request: TransportRequest): Response => stream(textReply, request.signal),
  };
  const transport = vi.fn<ProviderTransport>(async (outgoing, release) => {
    const url = new URL(outgoing.url);
    expect(url.origin).toBe("https://openrouter.ai");
    if (!release()) throw transportFailure(false);
    if (url.pathname === "/api/v1/key") return json(200, { data: { expires_at: null } });
    if (url.pathname === "/api/v1/models/user")
      return json(200, { data: state.models, total_count: state.models.length });
    expect(url.pathname).toBe("/api/v1/chat/completions");
    sent.push({
      headers: { ...outgoing.headers },
      body: JSON.parse(outgoing.body!) as Record<string, unknown>,
    });
    return state.chat(outgoing);
  });
  const refresh = vi.fn();
  // eslint-disable-next-line prefer-const -- the adapter reads the manager it is registered in.
  let manager: ConnectionManager;
  const provider = new OpenRouterProvider({
    store,
    transport,
    model: (id) => manager.model(openrouter, id),
    refresh: () => {
      refresh();
      manager.refreshModels(openrouter, true);
    },
  });
  manager = new ConnectionManager([provider]);
  cleanup.push(() => manager.dispose());
  const diagnostics: DiagnosticEvent[] = [];
  return {
    state,
    sent,
    transport,
    refresh,
    provider,
    manager,
    diagnostics,
    async connect(value = key) {
      manager.connect(openrouter, { key: value });
      await vi.waitFor(() => {
        expect(manager.snapshot(openrouter)?.state).toBe("connected");
        expect(manager.snapshot(openrouter)?.checking_key).toBeUndefined();
      });
    },
    async replace(value: string) {
      const before = manager.account(openrouter).fingerprint;
      manager.replaceKey(openrouter, value);
      await vi.waitFor(() => {
        expect(manager.snapshot(openrouter)?.checking_key).toBeUndefined();
        expect(manager.account(openrouter).fingerprint).not.toBe(before);
      });
    },
    request(overrides: Partial<ProviderRequestData> = {}): ProviderRequestData {
      return {
        ...conformanceRequest(openrouter, overrides.attempt ?? "attempt-openrouter"),
        model: kimi,
        tools: [noteTool],
        ...overrides,
      };
    },
    dispatch(
      request: ProviderRequestData,
      interrupt?: (dispatch: ProviderDispatch, events: readonly ProviderEvent[]) => void,
    ) {
      return dispatchThrough(manager, provider, request, {
        checkModel: true,
        diagnostic: (event) => diagnostics.push(event),
        ...(interrupt ? { interrupt } : {}),
      });
    },
  };
}
const result = (events: readonly ProviderEvent[]) => events.find((e) => e.type === "result");
const text = (events: readonly ProviderEvent[]) =>
  events
    .filter((event) => event.type === "text")
    .map((event) => event.text)
    .join("");
const usages = (events: readonly ProviderEvent[]) => events.filter((e) => e.type === "usage");
const stop = (dispatch: ProviderDispatch, attempt: string) => {
  dispatch.interrupt({
    kind: "provider_interrupt",
    version: 1,
    generation: "conformance",
    attempt,
  });
};

describe("OpenRouter request", () => {
  it("sends exactly the five headers and the allowed body, with effort and tools", async () => {
    const h = harness();
    await h.connect();
    const events = await h.dispatch(
      h.request({
        effort: "high",
        input: [
          { role: "user", text: "First question." },
          { role: "assistant", text: "Earlier reply." },
          { role: "user", text: "Follow-up." },
        ],
      }),
    );
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
    expect(h.sent).toHaveLength(1);
    const [{ headers, body }] = h.sent as [(typeof h.sent)[number]];
    expect(headers).toEqual({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "HTTP-Referer": "https://ohtia.com",
      "X-OpenRouter-Title": "Ohtia",
    });
    expect(body).toEqual({
      model: kimi,
      stream: true,
      messages: [
        { role: "system", content: "Synthetic conformance instructions." },
        { role: "user", content: "First question." },
        { role: "assistant", content: "Earlier reply." },
        { role: "user", content: "Follow-up." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "ohtia_record_note",
            description: "Record a note.",
            parameters: noteTool.parameters,
            strict: true,
          },
        },
      ],
      tool_choice: "auto",
      reasoning: { effort: "high" },
      provider: { require_parameters: true },
    });
    expect(JSON.stringify(events)).not.toContain(key);
  });

  it("sends no reasoning without a chosen effort and never a field outside the allowed list", async () => {
    const h = harness();
    await h.connect();
    await h.dispatch(h.request());
    await h.dispatch(h.request({ attempt: "attempt-no-tools", tools: [] }));
    expect(h.sent).toHaveLength(2);
    for (const { body } of h.sent) {
      expect(Object.keys(body).every((field) => allowedFields.includes(field))).toBe(true);
      for (const field of forbiddenFields) expect(body).not.toHaveProperty(field);
      expect(body).not.toHaveProperty("reasoning");
      expect(body.provider).toEqual({ require_parameters: true });
    }
    expect(h.sent[1]?.body).not.toHaveProperty("tools");
    expect(h.sent[1]?.body).not.toHaveProperty("tool_choice");
  });

  it("sends nothing for a model outside the current list or a foreign tool", async () => {
    const h = harness();
    await h.connect();
    const withdrawn = await h.dispatch(h.request({ model: "vendor/unlisted" }));
    const foreign = await h.dispatch(
      h.request({ attempt: "attempt-foreign", tools: [{ ...noteTool, namespace: "other" }] }),
    );
    for (const events of [withdrawn, foreign])
      expect(result(events)).toMatchObject({
        result: { status: "failed", reason: "permit_expired", dispatched: false },
      });
    expect(h.sent).toHaveLength(0);
  });

  it("checks the permit before any byte leaves and refuses a second request under one permit", async () => {
    const h = harness();
    await h.connect();
    const request = h.request();
    const dispatch = new ProviderDispatch([h.provider], {
      state: (id) => h.manager.snapshot(id)?.state,
      diagnostic: (event) => h.diagnostics.push(event),
      send: () => {},
    });
    dispatch.begin("conformance");
    const message = {
      kind: "provider_dispatch",
      version: 1,
      generation: "conformance",
      request,
      permit: { id: "permit-once", attempt: request.attempt, issued_at: Date.now() },
    } as const;
    await dispatch.receive(message);
    await dispatch.receive({ ...message, request: { ...request, attempt: "attempt-second" } });
    dispatch.dispose();
    expect(h.sent).toHaveLength(1);
    expect(h.diagnostics.map(({ event_name }) => event_name)).toContain("ohtia.provider.discarded");
    // An expired permit releases nothing: the transport's guard returns false before the body.
    const expired = harness();
    await expired.connect();
    const late = new ProviderDispatch([expired.provider], {
      state: (id) => expired.manager.snapshot(id)?.state,
      send: () => {},
    });
    late.begin("conformance");
    await late.receive({
      ...message,
      permit: { id: "permit-expired", attempt: request.attempt, issued_at: Date.now() - 60_000 },
    });
    late.dispose();
    expect(expired.sent).toHaveLength(0);
  });
});

describe("OpenRouter stream", () => {
  it("reads text, keep-alive comments, reasoning, the usage chunk and [DONE]", async () => {
    const h = harness();
    await h.connect();
    const events = await h.dispatch(h.request());
    expect(events[0]).toMatchObject({ type: "started", model: null });
    expect(events.find((event) => event.type === "started" && event.model)).toMatchObject({
      model: kimi,
      provider_request_id: generation,
    });
    expect(text(events)).toBe("Synthetic reply.");
    expect(JSON.stringify(events)).not.toContain("answer briefly");
    expect(usages(events).at(-1)).toMatchObject({
      usage: {
        input_tokens: 217,
        cached_input_tokens: 12,
        output_tokens: 78,
        reasoning_tokens: 33,
      },
    });
    expect(JSON.stringify(events)).not.toContain("cost");
    expect(result(events)).toEqual({
      type: "result",
      sequence: events.length,
      result: { status: "completed" },
      served_by: "InferenceNet",
    });
  });

  it.each([
    ["one fragment after an empty one", toolReplyOneFragment, "call_synthetic0000000000000001"],
    ["three fragments", toolReplyThreeFragments, "chatcmpl-tool-synthetic00000002"],
  ])("joins tool-call arguments sent in %s", async (_name, items, id) => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) => stream(items, request.signal);
    const events = await h.dispatch(h.request());
    expect(events.filter((event) => event.type === "tool_call")).toEqual([
      expect.objectContaining({
        namespace: "ohtia",
        name: "record_note",
        arguments: '{"note": "probe ok"}',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(id);
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
  });

  it("names the first company that delivered the reply and drops an invalid name", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [
          chunk({ content: "A" }, null, { provider: "" }),
          chunk({ content: "B" }, null, { provider: "First Company" }),
          chunk({ content: "C" }, "stop", { provider: "Second Company" }),
          "[DONE]",
        ],
        request.signal,
      );
    expect(result(await h.dispatch(h.request()))).toMatchObject({ served_by: "First Company" });
    for (const [attempt, name] of [
      ["attempt-long", "x".repeat(129)],
      ["attempt-control", "Bad\u0007Name"],
    ] as const) {
      h.state.chat = (request) =>
        stream([chunk({ content: "A" }, "stop", { provider: name }), "[DONE]"], request.signal);
      const events = await h.dispatch(h.request({ attempt }));
      expect(result(events)).not.toHaveProperty("served_by");
    }
    h.state.chat = (request) =>
      stream(
        [{ ...chunk({ content: "A" }, "stop"), provider: undefined }, "[DONE]"],
        request.signal,
      );
    expect(result(await h.dispatch(h.request({ attempt: "attempt-none" })))).not.toHaveProperty(
      "served_by",
    );
  });
});

describe("how an OpenRouter reply ends", () => {
  async function ending(items: readonly Item[], end: "close" | "drop" = "close") {
    const h = harness();
    await h.connect();
    h.state.chat = (request) => stream(items, request.signal, end);
    return await h.dispatch(h.request());
  }
  it("fails length with max_output_reached, keeping text and the usage that followed", async () => {
    const events = await ending([
      chunk({ content: "Partial" }),
      chunk({ content: "" }, "length"),
      usage("length", { completion_tokens: 65_536 }),
      "[DONE]",
    ]);
    expect(text(events)).toBe("Partial");
    expect(usages(events).at(-1)).toMatchObject({ usage: { output_tokens: 65_536 } });
    expect(result(events)).toMatchObject({
      result: { status: "failed", reason: "max_output_reached", dispatched: true },
    });
  });
  it("completes stop without [DONE] and leaves usage unknown", async () => {
    const events = await ending([chunk({ content: "Done" }), chunk({ content: "" }, "stop")]);
    expect(usages(events)).toEqual([]);
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
  });
  it("completes a finish read before the connection dropped", async () => {
    const events = await ending([chunk({ content: "Done" }, "stop")], "drop");
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
  });
  it.each([
    ["[DONE] without a finish", [chunk({ content: "Text" }), "[DONE]"], "close"],
    ["a dropped connection without a finish", [chunk({ content: "Text" })], "drop"],
    ["an empty stream", [], "close"],
  ] as const)("is uncertain after %s", async (_name, items, end) => {
    const events = await ending(items, end);
    expect(result(events)).toMatchObject({
      result: { status: "uncertain", reason: "connection_lost" },
    });
  });
  it("fails content_filter with provider_error, keeping the text", async () => {
    const events = await ending([
      chunk({ content: "Kept" }),
      chunk({}, "content_filter"),
      "[DONE]",
    ]);
    expect(text(events)).toBe("Kept");
    expect(result(events)).toMatchObject({ result: { reason: "provider_error" } });
  });
  it.each([
    ["after text", [chunk({ content: "Kept" })]],
    ["without text", []],
  ])("fails an error chunk %s with provider_error", async (_name, before) => {
    const events = await ending([
      ...before,
      { error: { message: "Provider failed.", code: 502 }, user_id: "user_synthetic" },
      "[DONE]",
    ]);
    expect(text(events)).toBe(before.length ? "Kept" : "");
    expect(result(events)).toMatchObject({ result: { reason: "provider_error" } });
    expect(JSON.stringify(events)).not.toContain("user_synthetic");
    expect(JSON.stringify(events)).not.toContain("Provider failed.");
  });
  it("fails finish_reason error with provider_error even after an earlier finish", async () => {
    const events = await ending([chunk({ content: "A" }, "stop"), chunk({}, "error"), "[DONE]"]);
    expect(result(events)).toMatchObject({ result: { reason: "provider_error" } });
  });
  it("fails an event larger than its bound with invalid_output", async () => {
    const events = await ending([chunk({ content: "A".repeat(1_200_000) }), "[DONE]"]);
    expect(text(events)).toBe("");
    expect(result(events)).toMatchObject({ result: { reason: "invalid_output" } });
  });
  it("fails a chunk it cannot parse with invalid_output", async () => {
    const events = await ending([chunk({ content: "A" }), "{not json", "[DONE]"]);
    expect(result(events)).toMatchObject({ result: { reason: "invalid_output" } });
  });
  it("discards tool-call fragments of a reply that does not complete with tool_calls", async () => {
    const items = toolReplyThreeFragments
      .filter((item) => item !== "[DONE]")
      .slice(0, -2)
      .concat([chunk({ content: "" }, "length"), "[DONE]"]);
    const events = await ending(items);
    expect(events.some((event) => event.type === "tool_call")).toBe(false);
    expect(result(events)).toMatchObject({ result: { reason: "max_output_reached" } });
    const stopped = await ending([
      ...toolReplyOneFragment.slice(1, 4),
      chunk({ content: "Answer." }, "stop"),
      "[DONE]",
    ]);
    expect(stopped.some((event) => event.type === "tool_call")).toBe(false);
    expect(result(stopped)).toMatchObject({ result: { status: "completed" } });
  });
  it("ends keep-alive comments alone with the total time limit, not inactivity", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) => {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setInterval>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          timer = setInterval(() => {
            controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
          }, 20);
          request.signal.addEventListener("abort", () => {
            clearInterval(timer);
            controller.error(new Error("Synthetic abort."));
          });
        },
        cancel() {
          clearInterval(timer);
        },
      });
      return new Response(body, { status: 200 });
    };
    const events = await h.dispatch(
      h.request({
        limits: { max_output_bytes: 16_384, max_attempt_duration_ms: 400, max_inactivity_ms: 120 },
      }),
    );
    expect(result(events)).toMatchObject({
      result: { status: "failed", reason: "deadline_exceeded", dispatched: true },
    });
  });
});

describe("malformed OpenRouter streams", () => {
  async function outcome(items: readonly Item[]) {
    const h = harness();
    await h.connect();
    h.state.chat = (request) => stream(items, request.signal);
    return result(await h.dispatch(h.request()));
  }
  const call = (fields: Record<string, unknown>) => chunk({ tool_calls: [fields] });
  const first = { index: 0, id: "call_synthetic", function: { name: "ohtia_record_note" } };
  it.each([
    ["a chunk that is not an object", ["[1]"]],
    ["choices that are not a list", [{ ...chunk({}), choices: {} }]],
    ["a choice that is not an object", [{ ...chunk({}), choices: [1] }]],
    ["a second choice", [{ ...chunk({}), choices: [{ index: 1, delta: {} }] }]],
    [
      "a choice without a delta and an unknown finish",
      [{ ...chunk({}), choices: [{ index: 0, finish_reason: "odd" }] }],
    ],
    [
      "a later fragment without its function and an unknown tool",
      [
        call({ ...first, function: { name: "ohtia_other" } }),
        call({ index: 0 }),
        chunk({}, "tool_calls"),
        "[DONE]",
      ],
    ],
    ["a delta that is not an object", [{ ...chunk({}), choices: [{ index: 0, delta: "x" }] }]],
    ["tool calls that are not a list", [chunk({ tool_calls: {} })]],
    ["a tool call that is not an object", [chunk({ tool_calls: [1] })]],
    [
      "a tool call without an index",
      [call({ id: "call", function: { name: "ohtia_record_note" } })],
    ],
    ["a function that is not an object", [call({ ...first, function: "x" })]],
    [
      "a first fragment without an id",
      [call({ index: 0, function: { name: "ohtia_record_note" } })],
    ],
    [
      "arguments that are not text",
      [call({ ...first, function: { ...first.function, arguments: 1 } })],
    ],
    ["a finish reason that is not text", [chunk({}, 1 as unknown as string)]],
    ["an unknown finish reason", [chunk({ content: "A" }, "surprise"), "[DONE]"]],
    [
      "a tool Ohtia did not offer",
      [
        call({ ...first, function: { name: "ohtia_other", arguments: "{}" } }),
        chunk({}, "tool_calls"),
        "[DONE]",
      ],
    ],
  ] as const)("fails %s with invalid_output", async (_name, items) => {
    expect(await outcome(items)).toMatchObject({ result: { reason: "invalid_output" } });
  });
  it("bounds tool-call ids and names with the arguments", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        Array.from({ length: 40 }, (_, index) =>
          call({ index, id: "call_" + "x".repeat(500), function: { name: "ohtia_record_note" } }),
        ),
        request.signal,
      );
    expect(result(await h.dispatch(h.request()))).toMatchObject({
      result: { reason: "output_limit_exceeded" },
    });
  });
  it("leaves an unusual model or id unknown and reads explicit nulls as absent", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [
          { ...chunk({ content: "A" }), model: "vendor/model with spaces", id: 7, error: null },
          { ...chunk({}), choices: null },
          { ...chunk({}), choices: [{ index: 0, delta: null }] },
          chunk({ content: null, tool_calls: null }),
          call({ ...first, function: { name: "ohtia_record_note", arguments: null } }),
          call({ index: 0, function: null }),
          call({ index: 0, function: { arguments: '{"note":"n"}' } }),
          chunk({}, "tool_calls"),
          "[DONE]",
        ],
        request.signal,
      );
    const events = await h.dispatch(h.request());
    expect(events.filter((event) => event.type === "started").at(-1)).toMatchObject({
      model: null,
      provider_request_id: null,
    });
    expect(events.filter((event) => event.type === "tool_call")).toEqual([
      expect.objectContaining({ arguments: '{"note":"n"}' }),
    ]);
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
  });
  it("leaves a lone-surrogate id unknown and fails lone surrogates in a tool call", async () => {
    const lone = "\ud800";
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [
          { ...chunk({ content: "A" }), id: "gen-" + lone, provider: "Company " + lone },
          chunk({}, "stop"),
          "[DONE]",
        ],
        request.signal,
      );
    const events = await h.dispatch(h.request());
    expect(events.filter((event) => event.type === "started").at(-1)).toMatchObject({
      provider_request_id: null,
    });
    expect(text(events)).toBe("A");
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
    expect(result(events)).not.toHaveProperty("served_by");
    for (const [attempt, fields] of [
      ["attempt-lone-id", { ...first, id: "call_" + lone }],
      ["attempt-lone-name", { ...first, function: { name: "ohtia_" + lone } }],
      ["attempt-lone-arguments", { ...first, function: { ...first.function, arguments: lone } }],
    ] as const) {
      h.state.chat = (request) => stream([call(fields)], request.signal);
      expect(result(await h.dispatch(h.request({ attempt })))).toMatchObject({
        result: { reason: "invalid_output" },
      });
    }
  });
  it("fails tool arguments beyond the output limit with output_limit_exceeded", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [call({ ...first, function: { ...first.function, arguments: "x".repeat(20_000) } })],
        request.signal,
      );
    expect(result(await h.dispatch(h.request()))).toMatchObject({
      result: { reason: "output_limit_exceeded" },
    });
  });
  it("joins two tool calls in index order", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [
          call({
            index: 1,
            id: "call_b",
            function: { name: "ohtia_record_note", arguments: '{"note":"b"}' },
          }),
          call({
            index: 0,
            id: "call_a",
            function: { name: "ohtia_record_note", arguments: '{"note":"a"}' },
          }),
          chunk({}, "tool_calls"),
          "[DONE]",
        ],
        request.signal,
      );
    const events = await h.dispatch(h.request());
    expect(
      events.filter((event) => event.type === "tool_call").map((event) => event.arguments),
    ).toEqual(['{"note":"a"}', '{"note":"b"}']);
  });
  it("reads CRLF lines, data without a space, multi-line data and drops a last event the transport ends early", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = () => {
      const lines =
        `: OPENROUTER PROCESSING\r\n\r\n` +
        `event: message\r\nid: 1\r\n` +
        `data:${JSON.stringify(chunk({ content: "A" }))}\r\n\r\n` +
        `data: {"id":"${generation}","model":"${kimi}","provider":"InferenceNet",\n` +
        `data: "choices":[{"index":0,"delta":{"content":"B"},"finish_reason":"stop"}]}\n\n` +
        `data: [DONE]`;
      const encoder = new TextEncoder();
      // Split inside a CRLF pair to check a line end that spans two reads.
      const cut = lines.indexOf("\r\n\r\nevent") + 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines.slice(0, cut)));
          controller.enqueue(encoder.encode(lines.slice(cut)));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    };
    const events = await h.dispatch(h.request());
    expect(text(events)).toBe("AB");
    expect(result(events)).toMatchObject({ result: { status: "completed" } });
  });
  it("fails an event split over many data lines beyond its bound", async () => {
    const line = new TextEncoder().encode(`data: ${"x".repeat(100_000)}\n`);
    const h = harness();
    await h.connect();
    h.state.chat = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 12; i++) controller.enqueue(line);
            controller.close();
          },
        }),
        { status: 200 },
      );
    expect(result(await h.dispatch(h.request()))).toMatchObject({
      result: { reason: "invalid_output" },
    });
  });
  it("is uncertain for a successful answer without a body", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = () => new Response(null, { status: 200 });
    expect(result(await h.dispatch(h.request()))).toMatchObject({
      result: { status: "uncertain", reason: "connection_lost" },
    });
  });
  it("reports no request id for a chunk without a usable id and unknown counts as null", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [
          { ...chunk({ content: "A" }), id: "x".repeat(300) },
          {
            ...chunk({}, "stop"),
            usage: { prompt_tokens: -1, completion_tokens: 1.5, prompt_tokens_details: null },
          },
          { ...chunk({}), choices: undefined },
          "[DONE]",
        ],
        request.signal,
      );
    const events = await h.dispatch(h.request());
    expect(events.find((event) => event.type === "started" && event.model)).toMatchObject({
      provider_request_id: null,
    });
    expect(usages(events).at(-1)).toMatchObject({
      usage: {
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
      },
    });
  });
});

describe("OpenRouter dispatch guards", () => {
  it("sends nothing without a stored key", async () => {
    const h = harness();
    await h.connect();
    await h.manager.disconnect(openrouter);
    const events: ProviderEvent[] = [];
    await h.provider.requests.send(h.request(), {
      release: () => true,
      emit: (event) => events.push(event as ProviderEvent),
      signal: new AbortController().signal,
    });
    expect(events).toEqual([
      {
        type: "result",
        result: { status: "failed", reason: "connection_expired", dispatched: false },
      },
    ]);
    expect(h.sent).toHaveLength(0);
  });
  it("withdraws a request whose key was replaced before it left", async () => {
    const h = harness();
    await h.connect();
    const events: ProviderEvent[] = [];
    const release = vi.fn(() => true);
    h.transport.mockImplementationOnce(async (_outgoing, guard) => {
      await h.replace(replacement);
      expect(guard()).toBe(false);
      throw transportFailure(false);
    });
    await h.provider.requests.send(h.request(), {
      release,
      emit: (event) => events.push(event as ProviderEvent),
      signal: new AbortController().signal,
    });
    expect(release).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "result", result: { status: "failed", reason: "permit_expired", dispatched: false } },
    ]);
  });
  it("releases nothing after Stop and reports nothing once stopped", async () => {
    const h = harness();
    await h.connect();
    const events: ProviderEvent[] = [];
    const abort = new AbortController();
    h.transport.mockImplementationOnce(async (_outgoing, guard) => {
      abort.abort();
      expect(guard()).toBe(false);
      throw transportFailure(false);
    });
    await h.provider.requests.send(h.request(), {
      release: () => true,
      emit: (event) => events.push(event as ProviderEvent),
      signal: abort.signal,
    });
    expect(events).toEqual([]);
    // Stop while an error answer is read: no result follows.
    const stopped = new AbortController();
    h.state.chat = () => {
      stopped.abort();
      return json(400, { error: { message: "Rejected." } });
    };
    const after: ProviderEvent[] = [];
    await h.provider.requests.send(h.request(), {
      release: () => true,
      emit: (event) => after.push(event as ProviderEvent),
      signal: stopped.signal,
    });
    expect(after).toEqual([]);
  });
  it.each([
    ["a transport failure", () => transportFailure(true)],
    ["another error", () => new Error("Synthetic failure.")],
  ])("is uncertain after %s once the request left", async (_name, error) => {
    const h = harness();
    await h.connect();
    h.transport.mockImplementationOnce(async (_outgoing, guard) => {
      expect(guard()).toBe(true);
      throw error();
    });
    const events = await h.dispatch(h.request());
    expect(result(events)).toMatchObject({
      result: { status: "uncertain", reason: "connection_lost" },
    });
  });
  it("waits until an HTTP date in Retry-After", async () => {
    const h = harness();
    await h.connect();
    const at = new Date(Date.now() + 120_000);
    at.setUTCMilliseconds(0);
    h.state.chat = () => json(429, {}, { "retry-after": at.toUTCString() });
    expect(result(await h.dispatch(h.request()))).toMatchObject({
      result: { reason: "rate_limited", retry_not_before_at: at.toISOString() },
    });
    h.state.chat = () => json(429, {}, { "retry-after": "soon" });
    expect(result(await h.dispatch(h.request({ attempt: "attempt-word" })))).not.toMatchObject({
      result: { retry_not_before_at: expect.anything() },
    });
  });
});

describe("Stop during an OpenRouter reply", () => {
  it("keeps text and unknown usage when pressed before a finish", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) => stream([chunk({ content: "Partial" })], request.signal, "hold");
    const request = h.request();
    const events = await h.dispatch(request, (dispatch, seen) => {
      void vi
        .waitFor(() => expect(seen.some((event) => event.type === "text")).toBe(true))
        .then(() => stop(dispatch, request.attempt));
    });
    expect(text(events)).toBe("Partial");
    expect(usages(events)).toEqual([]);
    expect(events.filter((event) => event.type === "result")).toEqual([
      expect.objectContaining({ result: { status: "cancelled" }, served_by: "InferenceNet" }),
    ]);
  });
  it("is stopped after the usage chunk was read, keeping that usage", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream([chunk({ content: "All" }, "stop"), usage("stop")], request.signal, "hold");
    const request = h.request();
    const events = await h.dispatch(request, (dispatch, seen) => {
      void vi
        .waitFor(() => expect(seen.some((event) => event.type === "usage")).toBe(true))
        .then(() => stop(dispatch, request.attempt));
    });
    expect(usages(events).at(-1)).toMatchObject({ usage: { output_tokens: 78 } });
    expect(events.filter((event) => event.type === "result")).toEqual([
      expect.objectContaining({ result: { status: "cancelled" } }),
    ]);
  });
  it("gives one result when the stream closes as Stop is pressed", async () => {
    const h = harness();
    await h.connect();
    let close!: () => void;
    h.state.chat = () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk({ content: "A" }))}\n\n`),
          );
          close = () => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`));
            controller.close();
          };
        },
      });
      return new Response(body, { status: 200 });
    };
    const request = h.request();
    const events = await h.dispatch(request, (dispatch, seen) => {
      void vi
        .waitFor(() => expect(seen.some((event) => event.type === "text")).toBe(true))
        .then(() => {
          close();
          stop(dispatch, request.attempt);
        });
    });
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
    expect(["cancelled", "completed"]).toContain(
      result(events)?.type === "result" && result(events)!.result.status,
    );
  });
});

describe("OpenRouter errors before the stream", () => {
  async function failure(response: () => Response) {
    const h = harness();
    await h.connect();
    h.state.chat = response;
    const events = await h.dispatch(h.request());
    return { h, events, outcome: result(events) };
  }
  it.each([
    [
      400,
      errorBodies.context,
      { reason: "request_rejected", provider_message: errorBodies.context.error.message },
    ],
    [
      409,
      { error: { message: "Conflict." } },
      { reason: "request_rejected", provider_message: "Conflict." },
    ],
    [
      402,
      { error: { message: "Out", metadata: { limit_source: "openrouter_credits" } } },
      { reason: "billing_limit_reached" },
    ],
    [
      402,
      { error: { message: "Key", metadata: { limit_source: "openrouter_key_limit" } } },
      { reason: "billing_limit_reached" },
    ],
    [402, { error: { message: "Other" } }, { reason: "billing_limit_reached" }],
    [
      403,
      { error: { message: "B", metadata: { limit_source: "openrouter_guardrail_budget" } } },
      { reason: "billing_limit_reached" },
    ],
    [
      403,
      { error: { message: "W", metadata: { limit_source: "openrouter_workspace_budget" } } },
      { reason: "billing_limit_reached" },
    ],
    [
      403,
      { error: { message: "K", metadata: { limit_source: "openrouter_key_limit" } } },
      { reason: "billing_limit_reached" },
    ],
    [403, errorBodies.terms, { reason: "not_eligible" }],
    [408, {}, { reason: "provider_unavailable" }],
    [500, {}, { reason: "provider_unavailable" }],
    [502, {}, { reason: "provider_unavailable" }],
    [503, {}, { reason: "provider_unavailable" }],
  ] as const)("maps %i to its reason", async (status, body, expected) => {
    const { outcome, events, h } = await failure(() => json(status, body));
    expect(outcome).toMatchObject({ result: { status: "failed", dispatched: true, ...expected } });
    if (!("provider_message" in expected))
      expect(outcome?.type === "result" && outcome.result).not.toHaveProperty("provider_message");
    expect(JSON.stringify(events)).not.toContain("user_synthetic");
    expect(JSON.stringify(h.diagnostics)).not.toContain("user_synthetic");
    expect(JSON.stringify(h.diagnostics)).not.toMatch(/limit_source|metadata|Terms Of Service/);
  });
  it("waits for a 402 in-flight budget and a 429 as Retry-After says", async () => {
    const before = Date.now();
    const flight = await failure(() =>
      json(
        402,
        { error: { metadata: { limit_source: "openrouter_in_flight_budget" } } },
        { "retry-after": "30" },
      ),
    );
    const limited = await failure(() =>
      json(429, { error: { message: "Slow down" } }, { "retry-after": "5" }),
    );
    const plain = await failure(() => json(429, {}));
    for (const [{ outcome }, seconds] of [
      [flight, 30],
      [limited, 5],
    ] as const) {
      expect(outcome).toMatchObject({ result: { reason: "rate_limited" } });
      const at =
        outcome?.type === "result" &&
        outcome.result.status === "failed" &&
        outcome.result.dispatched
          ? outcome.result.retry_not_before_at
          : undefined;
      expect(Date.parse(at!)).toBeGreaterThanOrEqual(before + seconds * 1000);
    }
    expect(plain.outcome).toMatchObject({ result: { reason: "rate_limited" } });
    expect(plain.outcome?.type === "result" && plain.outcome.result).not.toHaveProperty(
      "retry_not_before_at",
    );
  });
  it("omits a provider message that contains the key, exceeds 4,096 bytes or is not well-formed text", async () => {
    for (const message of [`Bad key ${key}`, "x".repeat(4097), "Bad \ud800 text"]) {
      const { outcome } = await failure(() => json(400, { error: { message } }));
      expect(outcome).toMatchObject({ result: { reason: "request_rejected" } });
      expect(outcome?.type === "result" && outcome.result).not.toHaveProperty("provider_message");
    }
  });
  it("expires the key on 401", async () => {
    const { h, outcome } = await failure(() => json(401, errorBodies.rejectedKey));
    expect(outcome).toMatchObject({ result: { reason: "connection_expired", dispatched: true } });
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.state).toBe("expired"));
  });
  it("reads the list again on 404 and keeps a model that is still listed", async () => {
    const { h, outcome } = await failure(() => json(404, errorBodies.guardrail));
    expect(outcome).toMatchObject({ result: { reason: "model_unavailable" } });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.manager.snapshot(openrouter)?.probing).toBe(false));
    expect(h.manager.model(openrouter, kimi)).toBeDefined();
    // A model withdrawn from the list is gone after the next read.
    h.state.models = [listed("vendor/other")];
    h.state.chat = () => json(404, { error: { message: "No endpoints found." } });
    await h.dispatch(h.request({ attempt: "attempt-withdrawn" }));
    await vi.waitFor(() => expect(h.manager.model(openrouter, kimi)).toBeUndefined());
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });
  it("ends a long reply at the highest effort with max_output_reached", async () => {
    const h = harness();
    await h.connect();
    h.state.chat = (request) =>
      stream(
        [
          ...Array.from({ length: 50 }, () =>
            chunk({ content: "", reasoning: "Thinking at length. " }),
          ),
          chunk({ content: "Long answer" }),
          chunk({ content: "" }, "length"),
          usage("length", {
            completion_tokens: 65_536,
            completion_tokens_details: { reasoning_tokens: 64_000 },
          }),
          "[DONE]",
        ],
        request.signal,
      );
    const events = await h.dispatch(h.request({ effort: "max" }));
    expect(h.sent[0]?.body.reasoning).toEqual({ effort: "max" });
    expect(result(events)).toMatchObject({ result: { reason: "max_output_reached" } });
    expect(usages(events).at(-1)).toMatchObject({ usage: { reasoning_tokens: 64_000 } });
  });
  it("is unavailable without sending when OpenRouter cannot be reached", async () => {
    const h = harness();
    await h.connect();
    h.transport.mockImplementationOnce(async () => {
      throw transportFailure(false);
    });
    const events = await h.dispatch(h.request());
    expect(result(events)).toMatchObject({
      result: { status: "failed", reason: "provider_unavailable", dispatched: false },
    });
  });
});

describe("OpenRouter key replacement", () => {
  it("never lets an answer for the earlier key expire its replacement or reread the new list", async () => {
    const h = harness();
    await h.connect();
    let answer!: (response: Response) => void;
    h.state.chat = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }) as unknown as Response;
    const pending = h.dispatch(h.request());
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    await h.replace(replacement);
    const fingerprint = h.manager.account(openrouter).fingerprint;
    answer(json(401, errorBodies.rejectedKey));
    expect(result(await pending)).toMatchObject({ result: { reason: "connection_expired" } });
    expect(h.manager.snapshot(openrouter)?.state).toBe("connected");
    expect(h.manager.account(openrouter).fingerprint).toBe(fingerprint);
    h.state.chat = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }) as unknown as Response;
    const second = h.dispatch(h.request({ attempt: "attempt-404" }));
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    await h.replace(key);
    answer(json(404, errorBodies.guardrail));
    expect(result(await second)).toMatchObject({ result: { reason: "model_unavailable" } });
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it("dispatches a request admitted during a replacement with exactly one key", async () => {
    const h = harness();
    await h.connect();
    const replacing = h.replace(replacement);
    const events = await h.dispatch(h.request());
    await replacing;
    const sent = h.sent.map(({ headers }) => headers.Authorization);
    expect(sent.length).toBeLessThanOrEqual(1);
    if (sent.length) {
      expect([`Bearer ${key}`, `Bearer ${replacement}`]).toContain(sent[0]);
      const started = events.find((event) => event.type === "started" && event.account_fingerprint);
      expect(started).toBeDefined();
    } else
      expect(result(events)).toMatchObject({ result: { status: "failed", dispatched: false } });
  });
});
