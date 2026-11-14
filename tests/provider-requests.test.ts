import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeDevelopmentAction,
  decodeDevelopmentReport,
  decodeDiagnosticEvent,
  decodeProviderDispatch,
  decodeProviderEvent,
  decodeProviderInterrupt,
  dispatchPermitPolicy,
  isProviderResult,
  providerTextPieces,
  ServiceConnections,
  type DiagnosticEvent,
  type ProviderDispatchMessage,
  type ProviderEvent,
} from "../packages/contracts/src/index.js";
import {
  buildInput,
  omittedMessagesNote,
  operationPolicy,
} from "../packages/utility/src/operations.js";
import { ProviderAttempts } from "../packages/utility/src/provider-attempts.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { admitRuntimeSwitches, isDevelopmentSwitch } from "../packages/main/src/profile.js";
import {
  createDevelopmentCommand,
  developmentRequestText,
  parseDevelopmentSwitches,
} from "../packages/main/src/development-command.js";
import type { ProviderRequests } from "../packages/main/src/provider-adapter.js";
import { fakeChatGPT, sse, streamResponse } from "./fixtures/chatgpt.js";
import { conformanceRequest } from "./fixtures/provider-conformance.js";

const developmentInstructions =
  "You are Virgilio, the research guide in Ohtia, a desktop application where researchers write research documents with the help of AI agents.\n\nThis conversation is a development test of Ohtia's connection to the language-model service. It belongs to no research project, and nothing in it is research data.\n\nReply in English to the last message. Keep replies short unless the message asks for a particular length.";
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

describe("provider message contracts", () => {
  const request = conformanceRequest("chatgpt");
  const dispatch: ProviderDispatchMessage = {
    kind: "provider_dispatch",
    version: 1,
    generation: "service-1",
    request,
    permit: { id: "permit-1", attempt: request.attempt, issued_at: 1 },
  };
  it("decodes exactly the versioned fields and nothing that could carry a credential", () => {
    const text = JSON.stringify(dispatch);
    expect(decodeProviderDispatch(text, "service-1")).toEqual(dispatch);
    expect(decodeProviderDispatch(text, "service-2")).toBeUndefined();
    for (const changed of [
      { ...dispatch, credential: "synthetic" },
      { ...dispatch, version: 2 },
      { ...dispatch, request: { ...request, authorization: "Bearer synthetic" } },
      { ...dispatch, request: { ...request, model: "has spaces" } },
      { ...dispatch, request: { ...request, operation: "project_setup" } },
      { ...dispatch, request: { ...request, input: [] } },
      { ...dispatch, request: { ...request, limits: { ...request.limits, max_output_bytes: 0 } } },
      { ...dispatch, permit: { ...dispatch.permit, issued_at: -1 } },
    ])
      expect(decodeProviderDispatch(JSON.stringify(changed), "service-1")).toBeUndefined();
    expect(decodeProviderDispatch("x".repeat(70000), "service-1")).toBeUndefined();
    const interrupt = { kind: "provider_interrupt", version: 1, generation: "g", attempt: "a" };
    expect(decodeProviderInterrupt(JSON.stringify(interrupt), "g")).toEqual(interrupt);
    expect(decodeProviderInterrupt(JSON.stringify({ ...interrupt, x: 1 }), "g")).toBeUndefined();
  });
  it("admits only the specified results and sequenced events", () => {
    for (const result of [
      { status: "completed" },
      { status: "cancelled" },
      { status: "uncertain", reason: "connection_lost" },
      { status: "failed", reason: "provider_error", dispatched: true },
      { status: "failed", reason: "permit_expired", dispatched: false },
      { status: "failed", reason: "provider_unavailable", dispatched: false },
    ])
      expect(isProviderResult(result)).toBe(true);
    for (const result of [
      { status: "uncertain", reason: "provider_error" },
      { status: "failed", reason: "provider_error", dispatched: false },
      { status: "failed", reason: "permit_expired", dispatched: true },
      { status: "failed", reason: "connection_lost", dispatched: true },
      { status: "completed", reason: null },
      { status: "resumed" },
    ])
      expect(isProviderResult(result)).toBe(false);
    const event = (value: unknown) =>
      decodeProviderEvent(
        JSON.stringify({
          kind: "provider_event",
          version: 1,
          generation: "g",
          attempt: "a",
          event: value,
        }),
        "g",
      );
    expect(event({ sequence: 1, type: "text", text: "x" })).toBeDefined();
    expect(event({ sequence: 0, type: "text", text: "x" })).toBeUndefined();
    expect(event({ sequence: 1, type: "text", text: "" })).toBeUndefined();
    expect(event({ sequence: 1, type: "text", text: "é".repeat(2049) })).toBeUndefined();
    expect(
      event({
        sequence: 2,
        type: "usage",
        usage: {
          input_tokens: null,
          cached_input_tokens: 1,
          output_tokens: 2,
          reasoning_tokens: null,
        },
      }),
    ).toBeDefined();
    expect(event({ sequence: 2, type: "usage", usage: { input_tokens: 0 } })).toBeUndefined();
    expect(
      event({ sequence: 1, type: "started", provider_request_id: "", model: null }),
    ).toBeUndefined();
  });
  it("splits partial text into channel-sized pieces without breaking a code point", () => {
    const text = `${"a".repeat(1023)}😀${"b".repeat(1500)}`;
    const pieces = providerTextPieces(text);
    expect(pieces.join("")).toBe(text);
    expect(pieces.every((piece) => piece.length <= 1024)).toBe(true);
    expect(pieces[0]!.endsWith("a")).toBe(true);
    expect(providerTextPieces("")).toEqual([]);
  });
  it("decodes development actions and reports only in their closed shapes", () => {
    const action = {
      kind: "development_action",
      version: 1,
      generation: "g",
      action: { name: "request", operation_id: "op-1", model: "first", text: "Hello." },
    };
    expect(decodeDevelopmentAction(JSON.stringify(action), "g")).toEqual(action);
    for (const changed of [
      { ...action, action: { ...action.action, name: "delete" } },
      { ...action, action: { ...action.action, model: "" } },
      { ...action, action: { name: "interrupt", operation_id: "op-1" } },
    ])
      expect(decodeDevelopmentAction(JSON.stringify(changed), "g")).toBeUndefined();
    const report = (value: unknown) =>
      decodeDevelopmentReport(
        JSON.stringify({
          kind: "development_report",
          version: 1,
          generation: "g",
          operation_id: "op",
          report: value,
        }),
        "g",
      );
    expect(report({ type: "refused", reason: "busy" })).toBeDefined();
    expect(report({ type: "refused", reason: "other" })).toBeUndefined();
    expect(
      report({
        type: "finished",
        attempt: "a",
        result: { status: "completed" },
        usage: {
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
        },
        transfer: [
          { kind: "message", reference: "development_request" },
          { kind: "note", note: "earlier_messages_omitted" },
        ],
        events: 3,
        duration_ms: 10,
        longest_silence_ms: 5,
      }),
    ).toBeDefined();
    expect(report({ type: "text", attempt: "a", text: "" })).toBeUndefined();
  });
});

describe("development_test policy and input rule", () => {
  it("fixes version 1's values and instructions in the development mode only", () => {
    const policy = operationPolicy("development_test", 1, "development");
    expect(policy).toMatchObject({
      max_pending_tasks: 20,
      max_input_bytes: 16384,
      max_input_items: 20,
      max_output_bytes: 16384,
      max_work_units: 1,
      max_attempt_duration_ms: 600000,
      max_inactivity_ms: 120000,
      stop_grace_ms: 5000,
      max_attempts: 2,
      max_auto_retries: 0,
      retry_backoff_ms: 0,
      instructions: developmentInstructions,
    });
    expect(operationPolicy("development_test", 1, "installed")).toBeUndefined();
    expect(operationPolicy("development_test", 1, "qualification")).toBeUndefined();
    expect(operationPolicy("development_test", 2, "development")).toBeUndefined();
  });
  it("sends the newest whole messages oldest first, with the note when older ones are left out", () => {
    const policy = operationPolicy("development_test", 1, "development")!;
    const messages = Array.from({ length: 25 }, (_, index) => ({
      reference: `m${index}`,
      role: index % 2 ? ("assistant" as const) : ("user" as const),
      text: `Message ${index}`,
    }));
    const built = buildInput(policy, messages)!;
    expect(built.input).toHaveLength(21);
    expect(built.input[0]).toEqual({ role: "user", text: omittedMessagesNote });
    expect(built.input[1]!.text).toBe("Message 5");
    expect(built.input.at(-1)!.text).toBe("Message 24");
    expect(built.transfer.slice(0, 2)).toEqual([
      { kind: "instructions", operation: "development_test", version: 1 },
      { kind: "note", note: "earlier_messages_omitted" },
    ]);
    expect(JSON.stringify(built.transfer)).not.toContain("Message");
    const large = [
      { reference: "old", role: "user" as const, text: "x".repeat(10000) },
      { reference: "new", role: "user" as const, text: "y".repeat(10000) },
    ];
    expect(buildInput(policy, large)!.transfer).toEqual([
      { kind: "instructions", operation: "development_test", version: 1 },
      { kind: "note", note: "earlier_messages_omitted" },
      { kind: "message", reference: "new" },
    ]);
    expect(
      buildInput(policy, [{ reference: "one", role: "user", text: "z".repeat(16385) }]),
    ).toBeUndefined();
    expect(buildInput(policy, messages.slice(0, 2))!.input[0]).toEqual({
      role: "user",
      text: "Message 0",
    });
  });
});

function connectionsWith(state: "connected" | "disconnected") {
  const connections = new ServiceConnections();
  connections.receive({
    kind: "connection_state",
    generation: "g",
    snapshot: {
      connection: "chatgpt",
      state,
      reason: null,
      probing: false,
      probe_id: null,
      model_list_revision: null,
      model_count: 0,
    },
  });
  return connections;
}
describe("data-service dispatch control", () => {
  it("checks the connection, records the transfer list and issues a single-use permit", () => {
    const sent: string[] = [];
    let clock = 0;
    const attempts = new ProviderAttempts({
      generation: "g",
      mode: "development",
      connections: connectionsWith("connected"),
      send: (text) => sent.push(text),
      wallClock: () => 1000,
      monotonic: () => clock,
    });
    const started = attempts.start(
      "op-1",
      "first",
      [{ reference: "development_request", role: "user", text: developmentRequestText }],
      "chatgpt",
    );
    expect(started.ok).toBe(true);
    const dispatch = decodeProviderDispatch(sent[0], "g")!;
    expect(dispatch.request).toMatchObject({
      operation: "development_test",
      connection: "chatgpt",
      model: "first",
      instructions: developmentInstructions,
      input: [{ role: "user", text: developmentRequestText }],
    });
    expect(dispatch.permit).toMatchObject({ attempt: dispatch.request.attempt, issued_at: 1000 });
    const attempt = dispatch.request.attempt;
    const event = (value: ProviderEvent) => ({
      kind: "provider_event" as const,
      version: 1 as const,
      generation: "g",
      attempt,
      event: value,
    });
    clock = 100;
    expect(
      attempts.receive(
        event({ sequence: 1, type: "started", provider_request_id: null, model: null }),
      ),
    ).toBe(true);
    clock = 400;
    expect(attempts.receive(event({ sequence: 2, type: "text", text: "Reply" }))).toBe(true);
    // A gap in the sequence is a peer fault.
    expect(attempts.receive(event({ sequence: 4, type: "text", text: "x" }))).toBe(false);
    clock = 450;
    expect(
      attempts.receive(event({ sequence: 3, type: "result", result: { status: "completed" } })),
    ).toBe(true);
    const finished = decodeDevelopmentReport(sent.at(-1), "g")!.report;
    expect(finished).toEqual({
      type: "finished",
      attempt,
      result: { status: "completed" },
      // No usage event arrived: every count stays unknown, never zero.
      usage: {
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
      },
      transfer: [
        { kind: "instructions", operation: "development_test", version: 1 },
        { kind: "message", reference: "development_request" },
      ],
      events: 3,
      duration_ms: 450,
      longest_silence_ms: 300,
    });
    // Events after the result, or for an unknown attempt, are discarded.
    expect(attempts.receive(event({ sequence: 4, type: "text", text: "late" }))).toBe(true);
    expect(attempts.running()).toEqual([]);
    expect(attempts.interrupt(attempt)).toBe(false);
  });
  it("refuses without dispatching when the connection is not connected or the limit is reached", () => {
    const sent: string[] = [];
    const refused = new ProviderAttempts({
      generation: "g",
      mode: "development",
      connections: connectionsWith("disconnected"),
      send: (text) => sent.push(text),
    });
    expect(
      refused.start("op", "first", [{ reference: "r", role: "user", text: "x" }], "chatgpt"),
    ).toEqual({
      ok: false,
      reason: "connection_unavailable",
    });
    expect(sent).toEqual([]);
    const busy = new ProviderAttempts({
      generation: "g",
      mode: "development",
      connections: connectionsWith("connected"),
      send: () => {},
    });
    for (let index = 0; index < 20; index++)
      expect(
        busy.start("op", "first", [{ reference: "r", role: "user", text: "x" }], "chatgpt").ok,
      ).toBe(true);
    expect(
      busy.start("op", "first", [{ reference: "r", role: "user", text: "x" }], "chatgpt"),
    ).toEqual({
      ok: false,
      reason: "busy",
    });
    busy.dispose();
    expect(
      busy.start("op", "first", [{ reference: "r", role: "user", text: "x" }], "chatgpt").ok,
    ).toBe(false);
  });
  it("accepts development actions only when the data service runs in the development mode", () => {
    const action = {
      kind: "development_action" as const,
      version: 1 as const,
      generation: "g",
      action: { name: "request" as const, operation_id: "op", model: "first", text: "x" },
    };
    for (const mode of ["installed", "qualification"] as const) {
      const attempts = new ProviderAttempts({
        generation: "g",
        mode,
        connections: connectionsWith("connected"),
        send: () => {},
      });
      expect(() => {
        attempts.developmentAction(action);
      }).toThrow();
      const service = createStatusService("g", "en-US", () => {}, undefined, undefined, mode);
      expect(() => {
        service.receive(JSON.stringify(action));
      }).toThrow();
    }
  });
});

function dispatcher(
  adapter = createFakeProvider(),
  options: {
    state?: "connected" | "disconnected" | (() => "connected" | "disconnected");
    wall?: () => number;
  } = {},
) {
  const sent: { generation: string; event: ProviderEvent }[] = [];
  const diagnostics: DiagnosticEvent[] = [];
  const dispatch = new ProviderDispatch([adapter], {
    state: () =>
      typeof options.state === "function" ? options.state() : (options.state ?? "connected"),
    send: (generation, text) => {
      const decoded = decodeProviderEvent(text, generation);
      expect(decoded).toBeDefined();
      sent.push({ generation, event: decoded!.event });
    },
    diagnostic: (event) => diagnostics.push(event),
    wallClock: options.wall,
  });
  dispatch.begin("g1");
  const message = (
    attempt = "a1",
    issued = (options.wall ?? Date.now)(),
  ): ProviderDispatchMessage => ({
    kind: "provider_dispatch",
    version: 1,
    generation: "g1",
    request: conformanceRequest("fake", attempt),
    permit: { id: `permit-${attempt}`, attempt, issued_at: issued },
  });
  const results = () =>
    sent.filter((item) => item.event.type === "result").map((item) => item.event);
  return { dispatch, sent, diagnostics, message, results };
}
describe("main's dispatch guards", () => {
  it("refuses a permit two seconds old or issued in the future, sending nothing", async () => {
    const send = vi.fn<ProviderRequests["send"]>();
    const h = dispatcher(createFakeProvider({ send }));
    await h.dispatch.receive(h.message("old", Date.now() - dispatchPermitPolicy.validity_ms));
    await h.dispatch.receive(h.message("future", Date.now() + 60000));
    expect(send).not.toHaveBeenCalled();
    expect(h.results()).toEqual([
      expect.objectContaining({
        result: { status: "failed", reason: "permit_expired", dispatched: false },
      }),
      expect.objectContaining({
        result: { status: "failed", reason: "permit_expired", dispatched: false },
      }),
    ]);
  });
  it("discards a reused permit, an open attempt and an ended generation without a result", async () => {
    const h = dispatcher();
    const first = h.message("a1");
    await h.dispatch.receive(first);
    expect(h.results()).toHaveLength(1);
    await h.dispatch.receive(first);
    await h.dispatch.receive({ ...first, request: { ...first.request, attempt: "a2" } });
    await h.dispatch.receive({ ...h.message("a3"), generation: "g0" });
    h.dispatch.end("g1");
    await h.dispatch.receive(h.message("a4"));
    expect(h.results()).toHaveLength(1);
    expect(
      h.diagnostics.filter((event) => event.event_name === "ohtia.provider.discarded"),
    ).toHaveLength(4);
  });
  it.each([
    ["rejected", "connection_expired"],
    ["temporary", "provider_unavailable"],
    ["throws", "provider_unavailable"],
  ] as const)("sends nothing when the renewal before dispatch is %s", async (outcome, reason) => {
    const send = vi.fn<ProviderRequests["send"]>();
    const h = dispatcher(
      createFakeProvider({
        send,
        prepare: () =>
          outcome === "throws" ? Promise.reject(new Error("x")) : Promise.resolve(outcome),
      }),
    );
    await h.dispatch.receive(h.message());
    expect(send).not.toHaveBeenCalled();
    expect(h.results()[0]).toMatchObject({
      result: { status: "failed", reason, dispatched: false },
    });
  });
  it("sends nothing when the connection is no longer connected at its check", async () => {
    const send = vi.fn<ProviderRequests["send"]>();
    const h = dispatcher(createFakeProvider({ send }), { state: "disconnected" });
    await h.dispatch.receive(h.message());
    expect(send).not.toHaveBeenCalled();
    expect(h.results()[0]).toMatchObject({
      result: { status: "failed", reason: "connection_expired", dispatched: false },
    });
  });
  it("re-checks the permit just before the body leaves", async () => {
    let now = 1_000_000;
    const h = dispatcher(
      createFakeProvider({
        prepare: () => {
          now += dispatchPermitPolicy.validity_ms;
          return Promise.resolve("ready");
        },
      }),
      { wall: () => now },
    );
    await h.dispatch.receive(h.message());
    expect(h.results()[0]).toMatchObject({
      result: { status: "failed", reason: "permit_expired", dispatched: false },
    });
    expect(h.diagnostics.map((event) => event.event_name)).not.toContain(
      "ohtia.provider.dispatched",
    );
  });
  it("keeps adapter defects inside the specified results", async () => {
    const cases: [ProviderRequests["send"], unknown][] = [
      [
        () => Promise.reject(new Error("before release")),
        { status: "failed", reason: "provider_unavailable", dispatched: false },
      ],
      [
        (_request, control) => {
          control.release();
          return Promise.reject(new Error("after release"));
        },
        { status: "uncertain", reason: "connection_lost" },
      ],
      [
        (_request, control) => {
          // Nothing but a not-dispatched failure can precede the release.
          control.emit({ type: "text", text: "too early" });
          control.emit({ type: "result", result: { status: "completed" } });
          control.release();
          control.emit({ type: "started", provider_request_id: null, model: "not a slug" });
          return Promise.resolve();
        },
        { status: "failed", reason: "invalid_output", dispatched: true },
      ],
      [
        (_request, control) => {
          control.emit({
            type: "result",
            result: { status: "failed", reason: "connection_expired", dispatched: false },
          });
          return Promise.resolve();
        },
        { status: "failed", reason: "connection_expired", dispatched: false },
      ],
    ];
    for (const [send, expected] of cases) {
      const h = dispatcher(createFakeProvider({ send }));
      await h.dispatch.receive(h.message());
      expect(h.sent.map((item) => item.event.type)).toEqual(["result"]);
      expect(h.results()[0]).toMatchObject({ result: expected });
    }
  });
  it("closes the requests of an ended generation and forwards none of their later events", async () => {
    let control!: Parameters<ProviderRequests["send"]>[1];
    const h = dispatcher(
      createFakeProvider({
        send: (_request, given) => {
          control = given;
          given.release();
          given.emit({ type: "started", provider_request_id: null, model: null });
          return new Promise(() => {});
        },
      }),
    );
    void h.dispatch.receive(h.message());
    await vi.waitFor(() => {
      expect(h.dispatch.query("a1")).toBe("running");
      expect(control).toBeDefined();
    });
    h.dispatch.end("g1");
    expect(control.signal.aborted).toBe(true);
    control.emit({ type: "text", text: "late" });
    control.emit({ type: "result", result: { status: "completed" } });
    expect(h.sent.map((item) => item.event.type)).toEqual(["started"]);
    expect(h.dispatch.query("a1")).toBe("unknown");
    h.dispatch.begin("g2");
    h.dispatch.interrupt({
      kind: "provider_interrupt",
      version: 1,
      generation: "g1",
      attempt: "a1",
    });
    expect(h.sent).toHaveLength(1);
  });
  it("records closed diagnostic events without identifiers, text or credentials", async () => {
    const h = dispatcher();
    await h.dispatch.receive(h.message());
    expect(h.diagnostics.map((event) => event.event_name)).toEqual([
      "ohtia.provider.dispatched",
      "ohtia.provider.completed",
    ]);
    for (const event of h.diagnostics) expect(decodeDiagnosticEvent(event)).toEqual(event);
    expect(JSON.stringify(h.diagnostics)).not.toMatch(/a1|permit|Synthetic|synthetic-session/);
  });
});

describe("the development command", () => {
  it("parses only the admitted actions with their own arguments", () => {
    expect(parseDevelopmentSwitches([])).toBeUndefined();
    expect(
      parseDevelopmentSwitches(
        ["--ohtia-dev-command=request", "--ohtia-dev-model=gpt-6.1-sol"],
        "op",
      ),
    ).toEqual({
      ok: true,
      action: {
        name: "request",
        operation_id: "op",
        model: "gpt-6.1-sol",
        text: developmentRequestText,
      },
    });
    expect(
      parseDevelopmentSwitches(
        ["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=development-1"],
        "op",
      ),
    ).toEqual({
      ok: true,
      action: { name: "interrupt", operation_id: "op", attempt: "development-1" },
    });
    for (const switches of [
      ["--ohtia-dev-model=first"],
      ["--ohtia-dev-command=delete"],
      ["--ohtia-dev-command=toString"],
      ["--ohtia-dev-command=request"],
      ["--ohtia-dev-command=request", "--ohtia-dev-model=bad model"],
      ["--ohtia-dev-command=request", "--ohtia-dev-model=first", "--ohtia-dev-attempt=a"],
      ["--ohtia-dev-command=request", "--ohtia-dev-command=interrupt"],
      ["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=../x"],
      ["--other=1"],
    ])
      expect(parseDevelopmentSwitches(switches)).toMatchObject({ ok: false });
  });
  it("admits its switches only in the development mode and only as application arguments", () => {
    const switches = ["/app", "--ohtia-dev-command=request", "--ohtia-dev-model=first"];
    expect(() => {
      admitRuntimeSwitches(switches, [], false, true);
    }).not.toThrow();
    expect(() => {
      admitRuntimeSwitches(switches, [], false, false);
    }).toThrow();
    expect(() => {
      admitRuntimeSwitches(switches, [], true, false);
    }).toThrow();
    expect(() => {
      admitRuntimeSwitches(["/app"], ["--ohtia-dev-command=request"], false, true);
    }).toThrow();
    for (const item of [
      "--ohtia-dev-command",
      "--ohtia-dev-=x",
      "--ohtia-devcommand=x",
      "--inspect=0",
    ])
      expect(isDevelopmentSwitch(item)).toBe(false);
    expect(isDevelopmentSwitch(`--ohtia-dev-text=${"x".repeat(9000)}`)).toBe(false);
  });
  it("queues an action until a data service is ready and prints refusals", () => {
    const lines: string[] = [];
    let generation: string | undefined;
    const posted: string[] = [];
    const command = createDevelopmentCommand(
      {
        ready: () => generation,
        post: (text) => {
          posted.push(text);
          return true;
        },
      },
      (text) => lines.push(text),
    );
    command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=first"]);
    command.run("not switches");
    command.run(["--ohtia-dev-command=nothing"]);
    expect(posted).toEqual([]);
    generation = "g";
    command.flush();
    expect(decodeDevelopmentAction(posted[0], "g")?.action).toMatchObject({
      name: "request",
      text: developmentRequestText,
    });
    command.report({
      kind: "development_report",
      version: 1,
      generation: "g",
      operation_id: "op",
      report: { type: "refused", reason: "connection_unavailable" },
    });
    expect(lines.join("")).toMatch(/\[ohtia dev\] request [0-9a-f-]+: accepted/);
    expect(lines.join("")).toContain("Ignored a development command");
    expect(lines.join("")).toContain("Use --ohtia-dev-command=<action>");
    expect(lines.join("")).toContain("[ohtia dev] op: refused (connection_unavailable)");
  });
});

describe("the development command through the data service and main", () => {
  async function running() {
    const f = fakeChatGPT();
    disposers.push(() => {
      f.manager.dispose();
    });
    const lines: string[] = [];
    const fromService: string[] = [];
    const toService: string[] = [];
    let receive: (value: unknown) => void = () => {};
    const service = createStatusService(
      "service-1",
      "en-US",
      (text) => {
        fromService.push(text);
        receive(text);
      },
      undefined,
      undefined,
      "development",
    );
    disposers.push(() => {
      service.dispose();
    });
    const supervisor = new ServiceSupervisor(
      {
        send: (text) => {
          toService.push(text);
          service.receive(text);
        },
        kill() {},
        messages: (listener) => {
          receive = listener;
        },
        exited() {},
      },
      "service-1",
      () => {},
    );
    receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    const dispatch = new ProviderDispatch([f.adapter], {
      state: (id) => f.manager.snapshot(id)?.state,
      send: (_generation, text) => supervisor.postProvider(text),
    });
    dispatch.begin("service-1");
    disposers.push(() => {
      dispatch.dispose();
    });
    const command = createDevelopmentCommand(
      {
        ready: () => (supervisor.available ? "service-1" : undefined),
        post: (text) => supervisor.postProvider(text),
      },
      (text) => lines.push(text),
    );
    supervisor.connectProvider({
      dispatch: (message) => {
        void dispatch.receive(message);
      },
      interrupt: (message) => {
        dispatch.interrupt(message);
      },
      report: (message) => {
        command.report(message);
      },
    });
    return { f, lines, fromService, toService, supervisor, command };
  }
  it("refuses a request while the connection is not connected", async () => {
    const h = await running();
    h.supervisor.reportConnections(h.f.manager);
    h.command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=first"]);
    await vi.waitFor(() => {
      expect(h.lines.join("")).toContain("refused (connection_unavailable)");
    });
    expect(h.f.responseRequests).toHaveLength(0);
  });
  it("sends the fixed request with the development instructions and prints the streamed reply", async () => {
    const h = await running();
    await h.f.login();
    h.supervisor.reportConnections(h.f.manager);
    h.command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=first"]);
    await vi.waitFor(() => {
      expect(h.lines.join("")).toMatch(/: completed; duration \d+ ms/);
    });
    const output = h.lines.join("");
    expect(output).toMatch(/: attempt development-[0-9a-f-]+\n/);
    expect(output).toContain("Synthetic reply.");
    expect(output).toContain("usage input 41, cached input 0, output 7, reasoning 3");
    expect(output).toContain("sent instructions development_test v1, message development_request");
    expect(h.f.responseRequests[0]!.body).toMatchObject({
      instructions: developmentInstructions,
      input: [{ role: "user", content: developmentRequestText }],
      model: "first",
    });
    // No message between the data service and main contains the credential.
    expect([...h.fromService, ...h.toService].join("\n")).not.toMatch(/access-one|refresh-one/);
  });
  it("interrupts a request mid-reply and reports it cancelled", async () => {
    const h = await running();
    await h.f.login();
    h.supervisor.reportConnections(h.f.manager);
    h.f.responses = (request) =>
      streamResponse([sse({ type: "response.output_text.delta", delta: "Half a reply" })], {
        open: true,
        signal: request.signal,
      });
    h.command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=first"]);
    await vi.waitFor(() => {
      expect(h.lines.join("")).toContain("Half a reply");
    });
    const attempt = /attempt (development-[0-9a-f-]+)\n/.exec(h.lines.join(""))![1]!;
    h.command.run(["--ohtia-dev-command=interrupt", `--ohtia-dev-attempt=${attempt}`]);
    await vi.waitFor(() => {
      expect(h.lines.join("")).toContain(`attempt ${attempt}: cancelled`);
    });
    expect(h.lines.join("")).toContain(`interrupt sent to attempt ${attempt}`);
    expect(h.f.responseRequests[0]!.signal?.aborted).toBe(true);
    h.command.run(["--ohtia-dev-command=interrupt", `--ohtia-dev-attempt=${attempt}`]);
    await vi.waitFor(() => {
      expect(h.lines.join("")).toContain("refused (unknown_attempt)");
    });
  });
  it("ends the generation on a malformed provider message", () => {
    const kill = vi.fn();
    let receive: (value: unknown) => void = () => {};
    const state = vi.fn();
    const supervisor = new ServiceSupervisor(
      { send() {}, kill, messages: (listener) => (receive = listener), exited() {} },
      "service-1",
      state,
    );
    receive(
      JSON.stringify({
        kind: "provider_interrupt",
        version: 1,
        generation: "service-1",
        attempt: "a",
      }),
    );
    expect(kill).toHaveBeenCalledOnce();
    const second = new ServiceSupervisor(
      { send() {}, kill, messages: (listener) => (receive = listener), exited() {} },
      "service-2",
      state,
    );
    receive(JSON.stringify({ kind: "ready", generation: "service-2" }));
    receive(
      JSON.stringify({
        kind: "provider_dispatch",
        version: 1,
        generation: "service-2",
        credential: "x",
      }),
    );
    expect(kill).toHaveBeenCalledTimes(2);
    expect(second.postProvider("{}")).toBe(false);
  });
});

it("reports connection state to a manager-backed dispatcher by snapshot", async () => {
  const adapter = createFakeProvider();
  const manager = new ConnectionManager([adapter]);
  disposers.push(() => {
    manager.dispose();
  });
  const h = dispatcher(adapter);
  manager.connect("fake");
  await vi.waitFor(() => {
    expect(manager.snapshot("fake")?.state).toBe("connected");
  });
  await h.dispatch.receive(h.message());
  expect(h.results()[0]).toMatchObject({ result: { status: "completed" } });
});

describe("dispatch edges", () => {
  it("refuses an adapter without requests and ignores an end for another generation", async () => {
    const adapter = createFakeProvider();
    const textless = { ...adapter, requests: undefined };
    const h = dispatcher(textless);
    h.dispatch.end("another");
    await h.dispatch.receive(h.message());
    expect(h.results()[0]).toMatchObject({
      result: { status: "failed", reason: "connection_expired", dispatched: false },
    });
  });
  it("cancels during renewal without sending, releases once and reports an adapter that ends silently", async () => {
    let finish!: () => void;
    const send = vi.fn<ProviderRequests["send"]>();
    const h = dispatcher(
      createFakeProvider({
        send,
        prepare: () =>
          new Promise((resolve) => {
            finish = () => resolve("ready");
          }),
      }),
    );
    const running = h.dispatch.receive(h.message());
    await vi.waitFor(() => {
      expect(finish).toBeTypeOf("function");
    });
    h.dispatch.interrupt({
      kind: "provider_interrupt",
      version: 1,
      generation: "g1",
      attempt: "a1",
    });
    finish();
    await running;
    expect(send).not.toHaveBeenCalled();
    expect(h.results()).toEqual([expect.objectContaining({ result: { status: "cancelled" } })]);
    expect(h.diagnostics.map((event) => event.event_name)).toContain("ohtia.provider.cancelled");
    const twice: boolean[] = [];
    const quiet = dispatcher(
      createFakeProvider({
        send: (_request, control) => {
          twice.push(control.release(), control.release());
          control.emit({ type: "result", result: { status: "completed" } });
          return Promise.resolve();
        },
      }),
    );
    await quiet.dispatch.receive(quiet.message());
    expect(twice).toEqual([true, false]);
    const silent = dispatcher(createFakeProvider({ send: () => Promise.resolve() }));
    await silent.dispatch.receive(silent.message());
    expect(silent.results()[0]).toMatchObject({
      result: { status: "failed", reason: "provider_unavailable", dispatched: false },
    });
  });
});

it("prints every result kind, notes and replies without streamed text", () => {
  const lines: string[] = [];
  const command = createDevelopmentCommand({ ready: () => undefined, post: () => false }, (text) =>
    lines.push(text),
  );
  const usage = {
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: 1,
    reasoning_tokens: null,
  };
  for (const result of [
    { status: "uncertain", reason: "connection_lost" },
    { status: "failed", reason: "provider_error", dispatched: true },
    { status: "failed", reason: "permit_expired", dispatched: false },
  ] as const)
    command.report({
      kind: "development_report",
      version: 1,
      generation: "g",
      operation_id: "op",
      report: {
        type: "finished",
        attempt: "a",
        result,
        usage,
        transfer: [{ kind: "note", note: "earlier_messages_omitted" }],
        events: 1,
        duration_ms: 2,
        longest_silence_ms: 1,
      },
    });
  const output = lines.join("");
  expect(output).toContain("uncertain (connection_lost)");
  expect(output).toContain("failed (provider_error)");
  expect(output).toContain("not dispatched (permit_expired)");
  expect(output).toContain("output 1");
  expect(output).toContain("sent note earlier_messages_omitted");
});

it("ends the generation when posting to the data service fails", () => {
  const kill = vi.fn();
  let receive: (value: unknown) => void = () => {};
  const supervisor = new ServiceSupervisor(
    {
      send() {
        throw new Error("synthetic channel failure");
      },
      kill,
      messages: (listener) => (receive = listener),
      exited() {},
    },
    "service-1",
    () => {},
  );
  receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
  // A report without a receiver for it is dropped, not a fault.
  supervisor.connectProvider({ dispatch() {}, interrupt() {} });
  receive(
    JSON.stringify({
      kind: "development_report",
      version: 1,
      generation: "service-1",
      operation_id: "op",
      report: { type: "refused", reason: "busy" },
    }),
  );
  expect(kill).not.toHaveBeenCalled();
  expect(supervisor.postProvider("{}")).toBe(false);
  expect(kill).toHaveBeenCalledOnce();
});

it("closes a request whose connection outlives its permit, sending nothing", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const h = dispatcher(
    createFakeProvider({
      send: (_request, control) => {
        signal = control.signal;
        return new Promise((resolve) => {
          control.signal.addEventListener("abort", () => {
            resolve();
          });
        });
      },
    }),
  );
  const running = h.dispatch.receive(h.message());
  await vi.advanceTimersByTimeAsync(dispatchPermitPolicy.validity_ms);
  await running;
  expect(signal.aborted).toBe(true);
  expect(h.results()).toEqual([
    expect.objectContaining({
      result: { status: "failed", reason: "permit_expired", dispatched: false },
    }),
  ]);
});

it("refuses the release when the connection ended while the transport connected", async () => {
  let state: "connected" | "disconnected" = "connected";
  const released: boolean[] = [];
  const h = dispatcher(
    createFakeProvider({
      send: (_request, control) => {
        state = "disconnected";
        released.push(control.release());
        return Promise.resolve();
      },
    }),
    { state: () => state },
  );
  await h.dispatch.receive(h.message());
  expect(released).toEqual([false]);
  expect(h.results()[0]).toMatchObject({
    result: { status: "failed", reason: "connection_expired", dispatched: false },
  });
});

it.each([
  ["temporary", "provider_unavailable"],
  ["rejected", "connection_expired"],
] as const)(
  "keeps a slow %s renewal's own reason instead of the permit's expiry",
  async (outcome, reason) => {
    vi.useFakeTimers();
    const send = vi.fn<ProviderRequests["send"]>();
    const h = dispatcher(
      createFakeProvider({
        send,
        prepare: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(outcome);
            }, 3 * dispatchPermitPolicy.validity_ms);
          }),
      }),
    );
    const running = h.dispatch.receive(h.message());
    await vi.advanceTimersByTimeAsync(3 * dispatchPermitPolicy.validity_ms);
    await running;
    expect(send).not.toHaveBeenCalled();
    expect(h.results()).toEqual([
      expect.objectContaining({ result: { status: "failed", reason, dispatched: false } }),
    ]);
  },
);
