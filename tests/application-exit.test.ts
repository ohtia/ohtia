import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeApplicationExit,
  isExitDialogState,
  isExitChoice,
  message,
  catalogs,
  messageContracts,
  supportedLocales,
  ServiceConnections,
  portLimits,
  type ApplicationExitState,
  type ApplicationExitControl,
  type Outcome,
  type ProviderEventMessage,
} from "../packages/contracts/src/index.js";
import { ApplicationExit } from "../packages/main/src/application-exit.js";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { DurableStore } from "../packages/utility/src/storage.js";
import { storageFixture, stores } from "./fixtures/storage.js";
import { catalogGate } from "../tooling/quality-catalogs.mjs";

const state = (
  running: number,
  other: Partial<ApplicationExitState> = {},
): ApplicationExitState => ({
  kind: "application_exit_state",
  generation: "run",
  operationId: "exit-1",
  running,
  held: true,
  cancelled: false,
  failed: false,
  ...other,
});
function host() {
  const sent: ApplicationExitControl[] = [];
  const finish = vi.fn();
  const changed = vi.fn();
  const failed = vi.fn();
  const exit = new ApplicationExit({
    identity: () => "exit-1",
    send: (control) => {
      sent.push(control);
      return true;
    },
    finish,
    changed,
    failed,
  });
  return { sent, finish, changed, failed, exit };
}
afterEach(() => vi.useRealTimers());
describe("application exit authority", () => {
  it("closes without a dialog for a zero running count and rejects foreign state", () => {
    const h = host();
    h.exit.request("run");
    h.exit.receive(state(0, { generation: "old" }));
    expect(h.finish).not.toHaveBeenCalled();
    h.exit.receive(state(0, { operationId: "old" }));
    expect(h.finish).not.toHaveBeenCalled();
    h.exit.receive(state(0));
    expect(h.finish).toHaveBeenCalledOnce();
    expect(h.changed).toHaveBeenLastCalledWith(undefined);
  });
  it("holds once, closes the dialog with resume, and ignores stale choices", () => {
    const h = host();
    h.exit.request("run");
    h.exit.request("run");
    expect(h.sent).toHaveLength(1);
    h.exit.receive(state(3));
    expect(h.exit.choose("foreign", "cancel")).toBe(false);
    expect(h.exit.choose("exit-1", "close")).toBe(true);
    expect(h.sent.map((c) => c.action)).toEqual(["hold", "resume"]);
    h.exit.receive(state(0));
    expect(h.finish).not.toHaveBeenCalled();
  });
  it("waits outside the shutdown deadline, keeps the other choices and uses live saved counts", () => {
    vi.useFakeTimers();
    const h = host();
    h.exit.request("run");
    h.exit.receive(state(2));
    h.exit.choose("exit-1", "wait");
    vi.advanceTimersByTime(600_000);
    expect(h.finish).not.toHaveBeenCalled();
    h.exit.receive(state(1));
    expect(h.exit.state).toMatchObject({ phase: "waiting", running: 1 });
    h.exit.choose("exit-1", "close");
    expect(h.sent.at(-1)?.action).toBe("resume");
    const next = host();
    next.exit.request("run");
    next.exit.receive(state(1));
    next.exit.choose("exit-1", "wait");
    next.exit.receive(state(0));
    expect(next.finish).toHaveBeenCalledOnce();
  });
  it("requires a committed cancel receipt and saved terminal replies before finishing", () => {
    const h = host();
    h.exit.request("run");
    h.exit.receive(state(2));
    h.exit.choose("exit-1", "cancel");
    expect(h.sent.at(-1)?.action).toBe("cancel");
    h.exit.choose("exit-1", "cancel");
    expect(h.sent.filter((control) => control.action === "cancel")).toHaveLength(1);
    expect(h.exit.choose("exit-1", "close")).toBe(false);
    h.exit.receive(state(0));
    expect(h.finish).not.toHaveBeenCalled();
    h.exit.receive(state(0, { cancelled: true, failed: true }));
    expect(h.finish).not.toHaveBeenCalled();
    h.exit.receive(state(0, { cancelled: true }));
    expect(h.finish).toHaveBeenCalledOnce();
  });
  it("keeps the cancellation deadline through ordinary count updates until its receipt arrives", () => {
    vi.useFakeTimers();
    const h = host();
    h.exit.request("run");
    h.exit.receive(state(2));
    h.exit.choose("exit-1", "cancel");
    vi.advanceTimersByTime(portLimits.request_deadline_ms - 1);
    h.exit.receive(state(0));
    expect(h.finish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.failed).toHaveBeenCalledOnce();
    expect(h.sent.at(-1)?.action).toBe("resume");
    expect(h.exit.pending).toBe(false);
  });
  it.each(["cancelled", "failed"] as const)(
    "clears the cancellation deadline after its %s acknowledgement",
    (acknowledgement) => {
      vi.useFakeTimers();
      const h = host();
      h.exit.request("run");
      h.exit.receive(state(2));
      h.exit.choose("exit-1", "cancel");
      h.exit.receive(state(1, { [acknowledgement]: true }));
      vi.advanceTimersByTime(portLimits.request_deadline_ms * 2);
      expect(h.failed).not.toHaveBeenCalled();
      expect(h.exit.pending).toBe(true);
      expect(h.exit.state).toMatchObject({ phase: "cancelling", running: 1 });
    },
  );
  it("bypasses a pending dialog for system shutdown and bounds only the initial service handshake", () => {
    vi.useFakeTimers();
    const h = host();
    h.exit.request("run");
    vi.advanceTimersByTime(10_000);
    expect(h.failed).toHaveBeenCalledOnce();
    expect(h.sent.at(-1)?.action).toBe("resume");
    h.exit.request("run");
    h.exit.receive(state(2));
    h.exit.systemShutdown();
    expect(h.finish).toHaveBeenCalledOnce();
    expect(h.exit.state).toBeUndefined();
  });
  it("rejects malformed lifecycle inputs and renders own ICU selectors for every locale", () => {
    expect(isExitChoice("quit")).toBe(false);
    expect(
      isExitDialogState({ operationId: "exit-1", phase: "waiting", running: 1, failed: false }),
    ).toBe(true);
    expect(decodeApplicationExit(JSON.stringify(state(-1)))).toBeUndefined();
    expect(
      decodeApplicationExit(JSON.stringify({ ...state(1), content: "private" })),
    ).toBeUndefined();
    expect(decodeApplicationExit("bad")).toBeUndefined();
    expect(catalogGate(supportedLocales, messageContracts, catalogs).status).toBe("passed");
    for (const locale of supportedLocales)
      for (const running of [0, 1, 2, 1_000_000]) {
        const text = message(locale, "exit.body", { running });
        expect(text).not.toContain("{running");
        expect(text).toContain(new Intl.NumberFormat(locale).format(running));
        expect(message(locale, "exit.waiting", { running })).not.toContain("plural");
      }
    expect(message("en-US", "exit.body", { running: 1 })).toContain("1 reply is");
    expect(message("en-US", "exit.body", { running: 2 })).toContain("2 replies are");
    for (const running of [-1, 1.5, NaN, Infinity])
      expect(() => message("en-US", "exit.body", { running })).toThrow();
  });
});
function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return outcome.value;
}
async function fixture() {
  const f = storageFixture();
  const connections = new ServiceConnections();
  connections.receive({
    kind: "connection_state",
    generation: "run",
    snapshot: {
      connection: "chatgpt",
      state: "connected",
      reason: null,
      probing: false,
      probe_id: null,
      model_list_revision: 1,
      model_count: 1,
    },
  });
  connections.receive({
    kind: "connection_models",
    generation: "run",
    page: {
      connection: "chatgpt",
      model_list_revision: 1,
      models: [{ id: "first", name: "First" }],
      nextCursor: 1,
      hasMore: false,
    },
  });
  const context = { generation: "run", mode: "development" as const, connections };
  f.store.setTaskContext(context);
  await f.store.open();
  let n = 0;
  const project = value(
    await f.store.executeResearchCommand({
      command: "development.createProject",
      operationId: `p-${++n}`,
      payload: {},
    }),
  ).resultId;
  const start = async () =>
    value(
      await f.store.executeResearchCommand({
        command: "conversation.start",
        operationId: `c-${++n}`,
        payload: { projectId: project, content: "Synthetic question" },
      }),
    ).resultId;
  const sent: string[] = [];
  const provider = new DurableProvider({
    storage: f.store,
    context,
    send: (text) => sent.push(text),
  });
  const rows = (table = "tasks") => {
    const db = f.raw();
    try {
      return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  };
  const control = (action: ApplicationExitControl["action"]): ApplicationExitControl => ({
    kind: "application_exit",
    generation: "run",
    operationId: "exit-1",
    action,
  });
  const dispatches = () =>
    sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((s) => s.kind === "provider_dispatch");
  const event = async (sequence: number, body: Record<string, unknown>) => {
    const attempt = rows("attempts")[0]!.id as Uint8Array;
    const hex = Buffer.from(attempt).toString("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    await provider.receive({
      kind: "provider_event",
      version: 1,
      generation: "run",
      attempt: id,
      event: { sequence, ...body },
    } as ProviderEventMessage);
  };
  const exitControl = async (control: ApplicationExitControl) => {
    provider.holdExit(control);
    await provider.applicationExit(control);
  };
  return { ...f, provider, start, sent, rows, control, dispatches, event, exitControl };
}
describe("durable exit and partial replies", () => {
  it("holds pending work only in memory, resumes it after closing the dialog and keeps uncertain work out of the count", async () => {
    const f = await fixture();
    await f.start();
    f.provider.holdExit(f.control("hold"));
    await f.exitControl(f.control("hold"));
    expect(f.rows()[0]!.state).toBe("queued");
    expect(f.dispatches()).toHaveLength(0);
    expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({ running: 0, held: true });
    await f.exitControl(f.control("resume"));
    expect(f.rows()[0]!.state).toBe("running");
    await f.event(1, {
      type: "result",
      result: { status: "uncertain", reason: "connection_lost" },
    });
    await f.exitControl(f.control("hold"));
    expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({ running: 0 });
  });
  it("cancels all pending work once, waits for connection closure and saves partial text", async () => {
    const f = await fixture();
    await f.start();
    await f.provider.pump();
    await f.event(1, { type: "text", text: "Synthetic partial reply" });
    await f.start();
    f.provider.holdExit(f.control("hold"));
    await f.exitControl(f.control("cancel"));
    expect(f.rows().map((r) => r.state)).toEqual(["cancelling", "cancelled"]);
    expect(f.sent.some((s) => JSON.parse(s).kind === "provider_interrupt")).toBe(true);
    expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({ running: 1, cancelled: true });
    await f.exitControl(f.control("cancel"));
    expect(f.rows("command_receipts").filter((r) => r.command === "task.cancelAll")).toHaveLength(
      1,
    );
    await f.event(2, { type: "result", result: { status: "cancelled" } });
    expect(f.rows().map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
    expect(f.rows("messages").at(-1)).toMatchObject({
      content: "Synthetic partial reply",
      ending: "partial",
    });
    expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({ running: 0, cancelled: true });
  });
  it("saves the last reply before publishing zero and leaves queued tasks eligible on an orderly restart", async () => {
    const f = await fixture();
    await f.start();
    await f.provider.pump();
    await f.start();
    await f.exitControl(f.control("hold"));
    await f.event(1, { type: "text", text: "Synthetic complete reply" });
    await f.event(2, { type: "result", result: { status: "completed" } });
    expect(f.rows().map((r) => r.state)).toEqual(["completed", "queued"]);
    expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({ running: 0 });
    expect(f.rows("messages").at(-1)).toMatchObject({ ending: "complete" });
    await f.store.close(true);
    const next = new DurableStore({ ...f.options, serviceGeneration: "next" });
    stores.push(next);
    await next.open();
    expect(f.rows().map((r) => r.state)).toEqual(["completed", "queued"]);
  });
  it("applies crash holds on restart when the process dies while exit holds pending work", async () => {
    const f = await fixture();
    await f.start();
    await f.provider.pump();
    await f.start();
    await f.exitControl(f.control("hold"));
    await f.store.close(false);
    const next = new DurableStore({ ...f.options, serviceGeneration: "next" });
    stores.push(next);
    await next.open();
    expect(f.rows().map((r) => [r.state, r.blocking_reason])).toEqual([
      ["uncertain", null],
      ["blocked", "restart_paused"],
    ]);
  });
});

describe("exit through the fake provider and serialized data-service channel", () => {
  it.each(["close", "wait", "cancel"] as const)(
    "performs %s without dispatching queued work during the exit hold",
    async (choice) => {
      const { createStatusService } = await import("../packages/utility/src/status-service.js");
      const { ProviderDispatch } = await import("../packages/main/src/provider-dispatch.js");
      const { createFakeProvider } = await import("../packages/main/src/fake-provider.js");
      const { decodeProviderDispatch, decodeProviderInterrupt } =
        await import("../packages/contracts/src/index.js");
      const f = await fixture();
      await f.start();
      const completions: (() => void)[] = [];
      const complete = () => completions[0]?.();
      const fake = createFakeProvider({
        send: async (_request, control) => {
          if (!control.release()) return;
          control.emit({ type: "started", provider_request_id: null, model: null });
          control.emit({ type: "text", text: "Synthetic fake reply." });
          await new Promise<void>((resolve) => {
            completions.push(resolve);
            control.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (!control.signal.aborted)
            control.emit({ type: "result", result: { status: "completed" } });
        },
      });
      const finished = vi.fn();
      const exit = new ApplicationExit({
        identity: () => "exit-fake",
        send: (control) => {
          service.receive(JSON.stringify(control));
          return true;
        },
        changed: () => {},
        finish: finished,
        failed: () => {
          throw new Error("Unexpected exit failure");
        },
      });
      const service = createStatusService(
        "run",
        "en-US",
        (text) => {
          const dispatchMessage = decodeProviderDispatch(text, "run");
          if (dispatchMessage) {
            void dispatch.receive(dispatchMessage);
            return;
          }
          const interrupt = decodeProviderInterrupt(text, "run");
          if (interrupt) {
            dispatch.interrupt(interrupt);
            return;
          }
          const state = decodeApplicationExit(text);
          if (state?.kind === "application_exit_state") exit.receive(state);
        },
        f.store,
        () => {
          throw new Error("Service admission lost");
        },
        "development",
      );
      const dispatch = new ProviderDispatch(
        [
          {
            ...fake,
            declaration: {
              ...fake.declaration,
              connection: { ...fake.declaration.connection, id: "chatgpt" },
            },
          },
        ],
        {
          state: () => "connected",
          send: (_generation, text) => service.receive(text),
        },
      );
      dispatch.begin("run");
      service.receive(
        JSON.stringify({
          kind: "connection_state",
          generation: "run",
          snapshot: {
            connection: "chatgpt",
            state: "connected",
            reason: null,
            probing: false,
            probe_id: null,
            model_list_revision: 1,
            model_count: 1,
          },
        }),
      );
      service.receive(
        JSON.stringify({
          kind: "connection_models",
          generation: "run",
          page: {
            connection: "chatgpt",
            model_list_revision: 1,
            models: [{ id: "first", name: "First" }],
            nextCursor: 1,
            hasMore: false,
          },
        }),
      );
      service.activate("en-US");
      const settle = async () => {
        for (let i = 0; i < 10; i++) {
          await service.drain();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      };
      try {
        await settle();
        expect(f.rows()[0]!.state).toBe("running");
        await f.start();
        exit.request("run");
        await settle();
        expect(exit.state).toMatchObject({ phase: "confirm", running: 1 });
        expect(f.rows()[1]!.state).toBe("queued");
        exit.choose("exit-fake", choice);
        await settle();
        if (choice === "close") {
          complete();
          await settle();
          expect(f.rows().map((r) => r.state)).toEqual(["completed", "running"]);
          expect(finished).not.toHaveBeenCalled();
        } else if (choice === "wait") {
          expect(finished).not.toHaveBeenCalled();
          complete();
          await settle();
          expect(finished).toHaveBeenCalledOnce();
          expect(f.rows().map((r) => r.state)).toEqual(["completed", "queued"]);
        } else {
          expect(finished).toHaveBeenCalledOnce();
          expect(f.rows().map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
          expect(f.rows("messages").find((r) => r.author_kind === "agent")).toMatchObject({
            content: "Synthetic fake reply.",
            ending: "partial",
          });
        }
      } finally {
        dispatch.end("run");
        await dispatch.drain();
        await service.drain();
        service.dispose();
      }
    },
  );
});

it("restores dispatch after a rejected exit handshake or a cancellation acknowledgement timeout", () => {
  vi.useFakeTimers();
  const unavailable = vi.fn();
  const rejected = new ApplicationExit({
    identity: () => "rejected",
    send: () => false,
    changed: () => {},
    finish: () => {
      throw new Error("Unexpected quit");
    },
    failed: unavailable,
  });
  rejected.request("run");
  expect(unavailable).toHaveBeenCalledOnce();
  expect(rejected.pending).toBe(false);
  const h = host();
  h.exit.request("run");
  h.exit.receive(state(0, { failed: true }));
  expect(h.failed).toHaveBeenCalledOnce();
  expect(h.changed).toHaveBeenLastCalledWith(undefined);
  const cancelling = host();
  cancelling.exit.request("run");
  cancelling.exit.receive(state(1));
  cancelling.exit.choose("exit-1", "cancel");
  vi.advanceTimersByTime(5000);
  expect(cancelling.failed).toHaveBeenCalledOnce();
  expect(cancelling.sent.at(-1)?.action).toBe("resume");
});
it("reports unavailable task authority without pretending there are zero running replies", async () => {
  const { createStatusService } = await import("../packages/utility/src/status-service.js");
  const sent: string[] = [];
  const service = createStatusService("run", "en-US", (text) => sent.push(text));
  const control = {
    kind: "application_exit",
    generation: "run",
    operationId: "exit-1",
    action: "hold",
  };
  service.receive(JSON.stringify({ ...control, generation: "old" }));
  expect(sent).toHaveLength(0);
  service.receive(JSON.stringify(control));
  expect(decodeApplicationExit(sent.at(-1))).toMatchObject({ running: 0, failed: false });
  service.dispose();
  const f = storageFixture();
  const blocked = createStatusService("run", "en-US", (text) => sent.push(text), f.store);
  blocked.receive(JSON.stringify(control));
  expect(decodeApplicationExit(sent.at(-1))).toMatchObject({ failed: true });
  blocked.dispose();
});

it("binds a cancel receipt to its own quit operation across a timed-out resume and a new hold", async () => {
  const f = await fixture();
  await f.start();
  await f.provider.pump();
  await f.exitControl(f.control("hold"));
  await f.exitControl(f.control("cancel"));
  await f.start();
  const next = (action: ApplicationExitControl["action"]): ApplicationExitControl => ({
    ...f.control(action),
    operationId: "exit-2",
  });
  f.provider.holdExit(next("hold"));
  await f.provider.applicationExit(f.control("resume"));
  await f.provider.applicationExit(next("hold"));
  expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({
    operationId: "exit-2",
    cancelled: false,
    running: 1,
  });
  f.provider.holdExit(next("cancel"));
  // A's terminal event is ahead of B's cancel transaction in the service queue.
  await f.event(1, { type: "result", result: { status: "cancelled" } });
  expect(f.rows().map((r) => r.state)).toEqual(["cancelled", "queued"]);
  expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({
    operationId: "exit-2",
    cancelled: false,
    running: 0,
  });
  await f.provider.applicationExit(next("cancel"));
  expect(f.rows().map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
  expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({
    operationId: "exit-2",
    cancelled: true,
    running: 0,
  });
  expect(f.rows("command_receipts").filter((r) => r.command === "task.cancelAll")).toHaveLength(2);
});
it("keeps the latest synchronous hold while older queued controls are processed", async () => {
  const f = await fixture();
  await f.start();
  const old = f.control("hold");
  const next = { ...old, operationId: "exit-2" };
  f.provider.holdExit(old);
  f.provider.holdExit(next);
  await f.provider.applicationExit(old);
  await f.provider.applicationExit(f.control("resume"));
  expect(f.dispatches()).toHaveLength(0);
  expect(f.rows()[0]!.state).toBe("queued");
  await f.provider.applicationExit(next);
  expect(JSON.parse(f.sent.at(-1)!)).toMatchObject({ operationId: "exit-2", cancelled: false });
});
it("does not repeat the exit failure notice when the service itself has failed", () => {
  const h = host();
  h.exit.request("run");
  h.exit.receive(state(1));
  h.exit.abort(false);
  expect(h.exit.pending).toBe(false);
  expect(h.failed).not.toHaveBeenCalled();
  expect(h.sent.at(-1)?.action).toBe("resume");
});
