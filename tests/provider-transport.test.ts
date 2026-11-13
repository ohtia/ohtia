import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { DevelopmentCommand } from "../packages/main/src/development-command.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { developmentTest } from "@ohtia/domain";
import type { DevelopmentMessage, ProviderRequestData } from "@ohtia/contracts";
const request: ProviderRequestData = {
  attempt: "attempt",
  operation: "development_test",
  connection: "fake",
  model: "model",
  instructions: { reference: "instructions", text: developmentTest.instructions },
  input: [{ reference: "input", role: "user", content: "question" }],
  limits: { max_input_bytes: 16384, max_input_items: 20, max_output_bytes: 16384 },
};
afterEach(() => {
  vi.doUnmock("node:https");
  vi.useRealTimers();
});

it.each([302, 204, 205, 304])(
  "holds all application bytes until the verified TLS body hook and safely receives HTTPS %s without redirect or retry",
  async (status) => {
    vi.resetModules();
    let onResponse!: (response: unknown) => void;
    const connection = new EventEmitter();
    const socket = new EventEmitter();
    const headers: Record<string, unknown> = {};
    const end = vi.fn();
    const destroy = vi.fn((error: Error) => {
      connection.emit("error", error);
    });
    const native = vi.fn((_url, _options, callback) => {
      onResponse = callback;
      return Object.assign(connection, {
        setHeader: (name: string, value: unknown) => {
          headers[name] = value;
        },
        end,
        destroy,
      });
    });
    vi.doMock("node:https", () => ({ request: native }));
    const { responsesTransport } = await import("../packages/main/src/chatgpt-requests.js");
    const release = vi.fn(() => "secret");
    const result = responsesTransport({
      body: "{}",
      signal: new AbortController().signal,
      release,
    });
    connection.emit("socket", socket);
    expect(release).not.toHaveBeenCalled();
    expect(headers).toEqual({});
    expect(end).not.toHaveBeenCalled();
    socket.emit("secureConnect");
    expect(release).toHaveBeenCalledOnce();
    expect(headers.Authorization).toBe("Bearer secret");
    expect(end).toHaveBeenCalledWith("{}");
    const response = {
      statusCode: status,
      headers: { "content-type": "text/plain" },
      destroy: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("not followed");
      },
    };
    onResponse(response);
    const output = await result;
    expect(output.status).toBe(status);
    expect(await output.text()).toBe(status === 302 ? "not followed" : "");
    expect(native).toHaveBeenCalledOnce();
    expect(native.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(native.mock.calls[0]?.[1]).toMatchObject({ agent: false, method: "POST" });
  },
);

it("destroys a TLS connection on failed body admission before attaching a credential or sending bytes", async () => {
  vi.resetModules();
  const connection = new EventEmitter();
  const socket = new EventEmitter();
  const setHeader = vi.fn();
  const end = vi.fn();
  const destroy = vi.fn((error) => {
    connection.emit("error", error);
  });
  vi.doMock("node:https", () => ({
    request: () => Object.assign(connection, { setHeader, end, destroy }),
  }));
  const { responsesTransport } = await import("../packages/main/src/chatgpt-requests.js");
  const rejected = responsesTransport({
    body: "{}",
    signal: new AbortController().signal,
    release: () => {
      throw new Error("refused");
    },
  });
  const check = expect(rejected).rejects.toThrow("refused");
  connection.emit("socket", socket);
  socket.emit("secureConnect");
  await check;
  expect(setHeader).not.toHaveBeenCalled();
  expect(end).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
});

it("routes queued initial commands and second launches to one running service with escaped terminal output", async () => {
  let available = false;
  let observer!: (message: DevelopmentMessage) => void;
  const development = vi.fn(() => true);
  const service = {
    get available() {
      return available;
    },
    development,
    observeDevelopment: (value: typeof observer) => {
      observer = value;
    },
  } as unknown as ServiceSupervisor;
  const lines: string[] = [];
  const prepare = vi.fn(async () => {});
  const command = new DevelopmentCommand(
    () => service,
    (text) => {
      lines.push(text);
    },
    prepare,
  );
  command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=gpt-6.1-sol"]);
  expect(development).not.toHaveBeenCalled();
  available = true;
  command.attach(service);
  await vi.waitFor(() => expect(development).toHaveBeenCalledOnce());
  expect(prepare).toHaveBeenCalledOnce();
  command.run(["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=attempt"]);
  await vi.waitFor(() => expect(development).toHaveBeenCalledTimes(2));
  expect(prepare).toHaveBeenCalledOnce();
  const id = development.mock.calls[0]?.[1];
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  observer({
    version: 1,
    kind: "development_event",
    generation: "generation",
    operation_id: "operation",
    attempt: "attempt",
    event: { kind: "text", sequence: 1, text: "\u001b[31mprovider\ntext" },
    transfer_manifest: ["reference"],
    duration_ms: 1,
    longest_silence_ms: 1,
  });
  expect(lines.at(-1)).not.toContain("\u001b");
  expect(JSON.parse(lines.at(-1)!).event.text).toBe("\u001b[31mprovider\ntext");
});

it("forwards validated provider requests and closes them on a supervised generation fault before restart", async () => {
  let receive!: (text: unknown) => void;
  let exit!: () => void;
  const sent: any[] = [];
  const killed = vi.fn();
  const supervisor = new ServiceSupervisor(
    {
      send: (text) => {
        sent.push(JSON.parse(text));
      },
      kill: killed,
      messages: (listener) => {
        receive = listener;
      },
      exited: (listener) => {
        exit = listener;
      },
    },
    "generation",
    () => {},
  );
  const base = createFakeProvider();
  let closed = false;
  const adapter = {
    ...base,
    requests: {
      ...base.requests!,
      prepare: async () => "ready" as const,
      start: (_request, context) => ({
        done: new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => {
            closed = true;
            resolve();
          });
        }),
        inspect: () => "running" as const,
        interrupt: () => {
          closed = true;
        },
      }),
    },
  };
  const manager = new ConnectionManager([adapter]);
  manager.connect("fake");
  await vi.waitFor(() => expect(manager.snapshot("fake")?.state).toBe("connected"));
  supervisor.attachProviders(manager, [adapter]);
  receive(JSON.stringify({ kind: "ready", generation: "generation" }));
  receive(
    JSON.stringify({
      version: 1,
      kind: "provider_dispatch",
      generation: "old",
      request,
      permit: { id: "old", attempt: "attempt", issued_at_ms: Date.now(), policy_version: 1 },
    }),
  );
  expect(killed).not.toHaveBeenCalled();
  receive(
    JSON.stringify({
      version: 1,
      kind: "provider_dispatch",
      generation: "generation",
      request,
      permit: { id: "permit", attempt: "attempt", issued_at_ms: Date.now(), policy_version: 1 },
    }),
  );
  await vi.waitFor(() => expect(manager.snapshot("fake")?.state).toBe("connected"));
  await Promise.resolve();
  receive("invalid");
  expect(closed).toBe(true);
  expect(killed).toHaveBeenCalledOnce();
  exit();
  expect(supervisor.ceased).toBe(true);
  expect(sent.filter((s) => s.kind === "provider_event")).toHaveLength(0);
  manager.dispose();
});

it("keeps interrupt available during credential preparation and handles bounded command errors", async () => {
  const lines: string[] = [];
  let release!: () => void;
  const development = vi.fn(() => true);
  const service = {
    available: true,
    development,
    observeDevelopment() {},
  } as unknown as ServiceSupervisor;
  const command = new DevelopmentCommand(
    () => service,
    (value) => {
      lines.push(value);
    },
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=model"]);
  command.run(["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=attempt"]);
  expect(development).toHaveBeenCalledWith(
    { action: "interrupt", attempt: "attempt" },
    expect.any(String),
  );
  release();
  await vi.waitFor(() => expect(development).toHaveBeenCalledTimes(2));
  command.run(["--ohtia-dev-command=unsupported"]);
  expect(JSON.parse(lines.at(-1)!)).toMatchObject({ error: "invalid_development_command" });
  const pending = new DevelopmentCommand(
    () => undefined,
    (value) => {
      lines.push(value);
    },
  );
  for (let i = 0; i < 21; i++)
    pending.run(["--ohtia-dev-command=request", "--ohtia-dev-model=model"]);
  expect(JSON.parse(lines.at(-1)!)).toMatchObject({ error: "busy" });
});
it("reports failed or obsolete development dispatch without failing the application when the terminal closes", async () => {
  for (const failure of ["prepare", "dispatch", "replaced"]) {
    const output: string[] = [];
    const service = { available: true, development: () => false } as unknown as ServiceSupervisor;
    let current: ServiceSupervisor | undefined = service;
    const command = new DevelopmentCommand(
      () => current,
      (text) => {
        output.push(text);
      },
      async () => {
        if (failure === "prepare") throw new Error("private");
        if (failure === "replaced") current = undefined;
      },
    );
    command.run(["--ohtia-dev-command=request", "--ohtia-dev-model=model"]);
    await vi.waitFor(() =>
      expect(output.some((s) => s.includes("service_unavailable"))).toBe(true),
    );
    expect(output.join("")).not.toContain("private");
  }
  const closed = new DevelopmentCommand(
    () => undefined,
    () => {
      throw new Error("terminal closed");
    },
  );
  expect(() => closed.run(["--ohtia-dev-command=unknown"])).not.toThrow();
});

it("faults the service and closes provider work when the IPC channel disappears during an event", async () => {
  let receive!: (text: unknown) => void;
  let exited!: () => void;
  let closed = false;
  const killed = vi.fn();
  const base = createFakeProvider();
  const adapter = {
    ...base,
    requests: {
      ...base.requests!,
      start(_request, context) {
        context.signal.addEventListener("abort", () => {
          closed = true;
        });
        return {
          done: Promise.resolve().then(() => {
            context.emit({ kind: "started" });
          }),
          interrupt() {
            closed = true;
          },
          inspect: () => "running" as const,
        };
      },
    },
  };
  const manager = new ConnectionManager([adapter]);
  manager.connect("fake");
  await vi.waitFor(() => expect(manager.snapshot("fake")?.state).toBe("connected"));
  const supervisor = new ServiceSupervisor(
    {
      send(text) {
        if (JSON.parse(text).kind === "provider_event")
          throw new Error("Synthetic closed IPC channel.");
      },
      messages(listener) {
        receive = listener;
      },
      exited(listener) {
        exited = listener;
      },
      kill: killed,
    },
    "generation",
    () => {},
  );
  supervisor.attachProviders(manager, [adapter]);
  receive(JSON.stringify({ kind: "ready", generation: "generation" }));
  receive(
    JSON.stringify({
      version: 1,
      kind: "provider_dispatch",
      generation: "generation",
      request,
      permit: { id: "permit", attempt: "attempt", issued_at_ms: Date.now(), policy_version: 1 },
    }),
  );
  await vi.waitFor(() => expect(killed).toHaveBeenCalledOnce());
  expect(closed).toBe(true);
  expect(supervisor.available).toBe(false);
  exited();
  manager.dispose();
});
it("validates development actions through the real supervisor and emits only catalog diagnostics", () => {
  let receive!: (text: unknown) => void;
  let exited!: () => void;
  const sent: string[] = [];
  const diagnostics: unknown[] = [];
  const noticed: unknown[] = [];
  const supervisor = new ServiceSupervisor(
    {
      send(text) {
        sent.push(text);
      },
      messages(listener) {
        receive = listener;
      },
      exited(listener) {
        exited = listener;
      },
      kill() {},
    },
    "generation",
    () => {},
    undefined,
    false,
    (event) => {
      diagnostics.push(event);
    },
  );
  expect(supervisor.development({ action: "request", model: "private-model" }, "operation")).toBe(
    false,
  );
  supervisor.observeDevelopment((message) => {
    noticed.push(message);
  });
  receive(JSON.stringify({ kind: "ready", generation: "generation" }));
  expect(supervisor.development({ action: "request", model: "private-model" }, "operation")).toBe(
    true,
  );
  expect(
    supervisor.development({ action: "interrupt", attempt: "private-attempt" }, "interrupt"),
  ).toBe(true);
  const result = {
    version: 1,
    kind: "development_result",
    generation: "generation",
    operation_id: "operation",
    attempt: null,
    error: "unavailable",
  };
  receive(JSON.stringify(result));
  expect(noticed).toEqual([result]);
  expect(diagnostics).toEqual([
    { event_name: "ohtia.development.requested" },
    { event_name: "ohtia.development.interrupted" },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("private");
  expect(sent).toHaveLength(2);
  exited();
});
