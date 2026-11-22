import { objects as exitReceiptObjects } from "../packages/utility/src/migrations/0012_application_exit.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ServiceConnections,
  encodeEnvelope,
  decodeEnvelope,
  decodeText,
  failure,
  message,
  catalogs,
  supportedLocales,
  portLimits,
  type Outcome,
  type ExecutionLimitsRecord,
  type FoundationPort,
  type DiagnosticEvent,
  decodeDiagnosticEvent,
} from "@ohtia/contracts";
import { legacyTaskInitialSql, Database, storageFixture, stores } from "./fixtures/storage.js";
import { request } from "./fixtures/port-corpus.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { DurableStore } from "../packages/utility/src/storage.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import { LimitsController } from "../packages/renderer/src/limits-controller.js";
import { ConversationController } from "../packages/renderer/src/conversation-controller.js";
import { call, deferred } from "./fixtures/settings.js";

const value = <T>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.value;
};
const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});
async function tasks() {
  const f = storageFixture();
  await f.store.open();
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
      models: [{ id: "model", name: "Model" }],
      nextCursor: 1,
      hasMore: false,
    },
  });
  f.store.setTaskContext({ generation: "run", mode: "development", connections });
  const project = value(
    await f.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "project",
      payload: {},
    }),
  ).resultId;
  let n = 0;
  const start = () =>
    f.store.executeResearchCommand({
      command: "conversation.start",
      operationId: `start-${++n}`,
      payload: { projectId: project, content: "Synthetic question" },
    });
  const prepare = async () => value(await f.store.prepareTask());
  return { ...f, start, prepare };
}
async function windowPair() {
  const f = storageFixture();
  await f.store.open();
  const receivers = new Map<string, (text: unknown) => void>();
  const messages: Record<string, any>[] = [];
  const service = createStatusService(
    "service-1",
    "en-US",
    (text) => {
      messages.push(JSON.parse(text));
      const decoded = decodeText(text);
      if (decoded.ok) receivers.get(decoded.value.windowGeneration)?.(text);
    },
    f.store,
    undefined,
    "development",
  );
  service.activate("en-US");
  const client = (window: string) => {
    let n = 0;
    const c = createFoundationPort(
      { contextIsolated: true, sandboxed: true },
      {
        send: (text) => service.receive(text),
        listen: (listener) => {
          receivers.set(window, listener);
          return () => receivers.delete(window);
        },
      },
      {
        after: (ms, callback) => {
          const t = setTimeout(callback, ms);
          return () => clearTimeout(t);
        },
      },
      {
        windowGeneration: window,
        serviceGeneration: "service-1",
        nextId: () => `${window}-${++n}`,
      },
    );
    disposals.push(() => c.dispose());
    return c.port;
  };
  disposals.push(() => service.dispose());
  return { ...f, service, messages, first: client("first"), second: client("second") };
}
describe("execution limit contract and storage", () => {
  it.each([0, 51, 1.5, "2", "text", null])(
    "rejects invalid value %j without a receipt",
    async (invalid) => {
      const f = storageFixture();
      await f.store.open();
      const before = value(await f.store.readExecutionLimits());
      expect(
        decodeEnvelope(
          request({ operation: "limits.replace", payload: { value: invalid } } as never),
        ).ok,
      ).toBe(false);
      expect(
        await f.store.replaceExecutionLimits({ operationId: "invalid", value: invalid } as never),
      ).toMatchObject({ ok: false, error: { code: "invalid_message" } });
      expect(value(await f.store.readExecutionLimits())).toEqual(before);
      expect(value(await f.store.readExecutionLimitsReceipt("invalid"))).toEqual({
        state: "not_found",
      });
    },
  );
  it("rejects extra fields and mismatched result generations at the strict port boundary", () => {
    expect(
      decodeEnvelope(
        request({ operation: "limits.read", payload: { key: "execution_limits" } } as never),
      ).ok,
    ).toBe(false);
    expect(
      decodeEnvelope(
        request({
          operation: "limits.replace",
          payload: { value: 2, expectedRevision: 2 },
        } as never),
      ).ok,
    ).toBe(false);
    expect(
      decodeEnvelope({
        ...request({ operation: "limits.read" }),
        kind: "result",
        payload: {
          ok: true,
          value: {
            serviceGeneration: "foreign",
            revision: 2,
            max_concurrent_inference: 2,
            running: 0,
          },
        },
      }).ok,
    ).toBe(false);
  });
  it("keeps calls bounded and potentially dispatched limit writes uncertain without replay", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    let receive: (text: unknown) => void = () => {};
    let n = 0;
    const client = createFoundationPort(
      { contextIsolated: true, sandboxed: true },
      {
        send: (text) => sent.push(text),
        listen: (listener) => {
          receive = listener;
          return () => {};
        },
      },
      {
        after: (ms, fn) => {
          const t = setTimeout(fn, ms);
          return () => clearTimeout(t);
        },
      },
      { windowGeneration: "window-1", serviceGeneration: "service-1", nextId: () => `wire-${++n}` },
    );
    disposals.push(() => client.dispose());
    expect(
      (
        await client.port.replaceExecutionLimits(
          { operationId: "wrong-generation", value: 2 },
          "foreign",
        ).result
      ).ok,
    ).toBe(false);
    expect(
      (await client.port.replaceExecutionLimits({ operationId: "bad", value: 51 }).result).ok,
    ).toBe(false);
    expect(sent).toHaveLength(0);
    const cancelled = client.port.replaceExecutionLimits({ operationId: "cancel", value: 2 });
    cancelled.cancel();
    expect(await cancelled.result).toEqual(failure("uncertain"));
    const timed = client.port.replaceExecutionLimits({ operationId: "deadline", value: 2 });
    await vi.advanceTimersByTimeAsync(portLimits.request_deadline_ms);
    expect(await timed.result).toEqual(failure("uncertain"));
    const wrong = client.port.replaceExecutionLimits({ operationId: "mismatch", value: 2 });
    const original = JSON.parse(sent.at(-1)!);
    receive(
      value(
        encodeEnvelope({
          ...original,
          kind: "result",
          payload: {
            ok: true,
            value: {
              serviceGeneration: "service-1",
              revision: 3,
              max_concurrent_inference: 3,
              running: 0,
            },
          },
        }),
      ),
    );
    expect(await wrong.result).toEqual(failure("uncertain"));
    const invalid = client.port.replaceExecutionLimits({ operationId: "invalid-result", value: 2 });
    receive("invalid");
    expect(await invalid.result).toEqual(failure("uncertain"));
    const disposed = client.port.replaceExecutionLimits({ operationId: "disposed", value: 2 });
    client.dispose();
    expect(await disposed.result).toEqual(failure("uncertain"));
  });
  it.each(["before", "after"])(
    "reconciles %s-COMMIT acknowledgement loss only after fresh storage admission",
    async (phase) => {
      const f = storageFixture();
      await f.store.open();
      const prepare = Database.prototype.prepare;
      const spy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
        text,
        ...args
      ) {
        const statement = prepare.call(this, text, ...args);
        if (String(text) === "COMMIT") {
          const run = statement.run.bind(statement);
          statement.run = (...parameters: unknown[]) => {
            if (phase === "after") run(...parameters);
            throw new Error("Synthetic lost acknowledgement");
          };
        }
        return statement;
      });
      expect(await f.store.replaceExecutionLimits({ operationId: "lost", value: 2 })).toEqual(
        failure("uncertain"),
      );
      spy.mockRestore();
      await f.store.close();
      await f.store.open();
      const receipt = value(await f.store.readExecutionLimitsReceipt("lost"));
      expect(receipt.state).toBe(phase === "after" ? "recorded" : "not_found");
      expect(value(await f.store.readExecutionLimits()).max_concurrent_inference).toBe(
        phase === "after" ? 2 : 10,
      );
    },
  );
  it("upgrades a healthy revision-twelve queue without adding a recovery pause", async () => {
    const f = await tasks();
    value(await f.start());
    await f.store.close(true);
    const source = f.raw();
    source.exec(
      "DROP TABLE execution_limits_receipts; " +
        legacyTaskInitialSql +
        "DELETE FROM kysely_migration WHERE name='0016_task_notices'; DELETE FROM ohtia_migration_artifacts WHERE name='0016_task_notices'; DROP TABLE project_setup_proposals; DELETE FROM kysely_migration WHERE name='0015_project_setup'; DELETE FROM ohtia_migration_artifacts WHERE name='0015_project_setup'; DELETE FROM kysely_migration WHERE name='0014_message_composer'; DELETE FROM ohtia_migration_artifacts WHERE name='0014_message_composer'; DELETE FROM kysely_migration WHERE name='0013_execution_limits_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0013_execution_limits_receipts'; PRAGMA user_version=12",
    );
    source.exec("DROP TRIGGER receipts_commands");
    source.exec(exitReceiptObjects.receipts_commands);
    source.close();
    await f.store.open();
    const db = f.raw();
    expect(db.pragma("user_version", { simple: true })).toBe(30);
    expect(db.prepare("SELECT state,blocking_reason FROM tasks").all()).toEqual([
      { state: "queued", blocking_reason: null },
    ]);
    db.close();
    expect(await f.prepare()).not.toBeNull();
  });
  it("refuses unavailable storage and revision overflow without a receipt", async () => {
    const f = storageFixture();
    expect((await f.store.readExecutionLimits()).ok).toBe(false);
    expect((await f.store.readExecutionLimitsReceipt("receipt")).ok).toBe(false);
    expect(
      (await f.store.replaceExecutionLimits({ operationId: "unavailable", value: 2 })).ok,
    ).toBe(false);
    await f.store.open();
    expect((await f.store.readExecutionLimitsReceipt("!")).ok).toBe(false);
    const db = f.raw();
    db.exec(
      "UPDATE application_preferences SET revision=9007199254740991 WHERE key='execution_limits'",
    );
    db.close();
    expect(
      await f.store.replaceExecutionLimits({ operationId: "overflow", value: 2 }),
    ).toMatchObject({ error: { code: "preference_invalid" } });
    expect(value(await f.store.readExecutionLimitsReceipt("overflow"))).toEqual({
      state: "not_found",
    });
  });
  it("keeps the later write, immutable receipts, live counts and the local-processing value", async () => {
    const f = await tasks();
    const first = value(await f.store.replaceExecutionLimits({ operationId: "first", value: 1 }));
    await f.start();
    const running = (await f.prepare())!;
    const second = value(await f.store.replaceExecutionLimits({ operationId: "second", value: 2 }));
    expect(second.revision).toBe(first.revision + 1);
    expect(value(await f.store.replaceExecutionLimits({ operationId: "first", value: 1 }))).toEqual(
      { ...first, running: 1 },
    );
    expect(value(await f.store.readExecutionLimitsReceipt("first"))).toEqual({
      state: "recorded",
      outcome: { ok: true, value: { ...first, running: 1 } },
    });
    expect(await f.store.replaceExecutionLimits({ operationId: "first", value: 3 })).toMatchObject({
      ok: false,
      error: { code: "operation_conflict" },
    });
    value(
      await f.store.recordTaskEvent(
        running.dispatch.request.attempt,
        { type: "result", result: { status: "completed" }, sequence: 1 },
        "Synthetic reply",
      ),
    );
    expect(value(await f.store.readExecutionLimitsReceipt("first"))).toMatchObject({
      outcome: { value: { running: 0, revision: first.revision } },
    });
    const db = f.raw();
    expect(
      JSON.parse(
        db
          .prepare("SELECT value FROM application_preferences WHERE key='execution_limits'")
          .pluck()
          .get() as string,
      ),
    ).toEqual({ max_concurrent_inference: 2, max_concurrent_local_processing: 1 });
    expect(
      db.prepare("SELECT * FROM execution_limits_receipts ORDER BY result_revision").all(),
    ).toEqual([
      { operation_id: "first", value: 1, result_revision: first.revision },
      { operation_id: "second", value: 2, result_revision: second.revision },
    ]);
    db.close();
  });
  it("rolls back both preference and receipt when the insert fails", async () => {
    const f = storageFixture();
    await f.store.open();
    const before = value(await f.store.readExecutionLimits());
    const db = f.raw();
    db.exec(
      "CREATE TRIGGER fail_limits BEFORE INSERT ON execution_limits_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    db.close();
    expect(
      await f.store.replaceExecutionLimits({ operationId: "rollback", value: 2 }),
    ).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(value(await f.store.readExecutionLimits())).toEqual(before);
    expect(value(await f.store.readExecutionLimitsReceipt("rollback"))).toEqual({
      state: "not_found",
    });
  });
  it("keeps running tasks on lowering and admits queued work within both limits on raising", async () => {
    const f = await tasks();
    for (let i = 0; i < 5; i++) value(await f.start());
    const first = (await f.prepare())!;
    const second = (await f.prepare())!;
    value(await f.store.replaceExecutionLimits({ operationId: "lower", value: 1 }));
    expect(await f.prepare()).toBeNull();
    expect(value(await f.store.runningTaskCount())).toBe(2);
    value(await f.store.replaceExecutionLimits({ operationId: "raise", value: 50 }));
    expect(await f.prepare()).not.toBeNull();
    expect(await f.prepare()).toBeNull();
    expect(value(await f.store.runningTaskCount())).toBe(3);
    value(
      await f.store.recordTaskEvent(
        first.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "uncertain", reason: "connection_lost" } },
        "",
      ),
    );
    expect(await f.prepare()).not.toBeNull();
    expect(value(await f.store.runningTaskCount())).toBe(3);
    expect(second.dispatch.request.attempt).toBeTruthy();
  });
  it("never resumes restart or plan pauses or uncertain work when raised", async () => {
    const f = await tasks();
    value(await f.start());
    const running = (await f.prepare())!;
    value(await f.start());
    const uncertain = (await f.prepare())!;
    value(
      await f.store.recordTaskEvent(
        uncertain.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "uncertain", reason: "connection_lost" } },
        "",
      ),
    );
    value(
      await f.store.recordTaskEvent(
        running.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", reason: "usage_limit_reached", dispatched: true },
        },
        "",
      ),
    );
    value(await f.start());
    value(await f.start());
    const db = f.raw();
    db.exec(
      "UPDATE tasks SET blocking_reason='restart_paused',state_revision=state_revision+1 WHERE id=(SELECT id FROM tasks WHERE state='blocked' LIMIT 1)",
    );
    const before = db
      .prepare("SELECT id,state,blocking_reason,state_revision FROM tasks ORDER BY id")
      .all();
    db.close();
    value(await f.store.replaceExecutionLimits({ operationId: "raise-paused", value: 50 }));
    expect(await f.prepare()).toBeNull();
    const after = f.raw();
    expect(
      after.prepare("SELECT id,state,blocking_reason,state_revision FROM tasks ORDER BY id").all(),
    ).toEqual(before);
    after.close();
  });
  it("publishes globally and converges two Settings-only windows through their one research stream", async () => {
    const f = await windowPair();
    const first = new LimitsController(f.first, () => "save-first");
    const second = new LimitsController(f.second, () => "save-second");
    const r1 = new ConversationController(f.first);
    const r2 = new ConversationController(f.second);
    r1.observe(first.observed);
    r2.observe(second.observed);
    disposals.push(() => {
      first.dispose();
      second.dispose();
      r1.dispose();
      r2.dispose();
    });
    r1.open({ projectId: null, conversationId: null });
    r2.open({ projectId: null, conversationId: null });
    await vi.waitFor(() => expect(second.snapshot().current?.max_concurrent_inference).toBe(10));
    await first.choose(2);
    await vi.waitFor(() => expect(second.snapshot().current?.max_concurrent_inference).toBe(2));
    await second.choose(3);
    await vi.waitFor(() => expect(first.snapshot().current?.max_concurrent_inference).toBe(3));
    expect(value(await f.first.readExecutionLimitsReceipt("save-first").result)).toMatchObject({
      outcome: { value: { max_concurrent_inference: 2 } },
    });
  });
  it("refreshes live running help in a project-free window when provider work finishes", async () => {
    const f = await windowPair();
    const limits = new LimitsController(f.second, () => "lower-live");
    const research = new ConversationController(f.second);
    research.observe(limits.observed);
    disposals.push(() => {
      limits.dispose();
      research.dispose();
    });
    research.open({ projectId: null, conversationId: null });
    await vi.waitFor(() => expect(limits.snapshot().current).toBeDefined());
    f.service.receive(
      JSON.stringify({
        kind: "connection_state",
        generation: "service-1",
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
    f.service.receive(
      JSON.stringify({
        kind: "connection_models",
        generation: "service-1",
        page: {
          connection: "chatgpt",
          model_list_revision: 1,
          models: [{ id: "model", name: "Model" }],
          nextCursor: 1,
          hasMore: false,
        },
      }),
    );
    await f.service.drain();
    const project = value(
      await f.store.executeResearchCommand({
        command: "development.createProject",
        operationId: "live-project",
        payload: {},
      }),
    ).resultId;
    value(
      await f.first.startConversation("live-first", {
        projectId: project,
        content: "Synthetic first",
      }).result,
    );
    value(
      await f.first.startConversation("live-second", {
        projectId: project,
        content: "Synthetic second",
      }).result,
    );
    await limits.choose(1);
    await vi.waitFor(() => expect(limits.snapshot().current?.running).toBe(2));
    const dispatch = f.messages.find((m) => m.kind === "provider_dispatch")!;
    for (const event of [
      { type: "started", sequence: 1, provider_request_id: null, model: null },
      { type: "text", sequence: 2, text: "Synthetic reply" },
      { type: "result", sequence: 3, result: { status: "completed" } },
    ])
      f.service.receive(
        JSON.stringify({
          kind: "provider_event",
          version: 1,
          generation: "service-1",
          attempt: dispatch.request.attempt,
          event,
        }),
      );
    await vi.waitFor(() => expect(limits.snapshot().current?.running).toBe(1));
    expect(limits.snapshot().current?.max_concurrent_inference).toBe(1);
  });
  it("serializes a saved limit ahead of competing admissions on the existing service queue", async () => {
    const f = await windowPair();
    await f.service.drain();
    const connections = f.service.connections;
    connections.receive({
      kind: "connection_state",
      generation: "service-1",
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
      generation: "service-1",
      page: {
        connection: "chatgpt",
        model_list_revision: 1,
        models: [{ id: "model", name: "Model" }],
        nextCursor: 1,
        hasMore: false,
      },
    });
    const project = value(
      await f.store.executeResearchCommand({
        command: "development.createProject",
        operationId: "create",
        payload: {},
      }),
    ).resultId;
    const lowered = f.first.replaceExecutionLimits({
      operationId: "lower-before-admission",
      value: 1,
    });
    const first = f.first.startConversation("start-1", {
      projectId: project,
      content: "Synthetic first",
    });
    const second = f.second.startConversation("start-2", {
      projectId: project,
      content: "Synthetic second",
    });
    expect(value(await lowered.result).max_concurrent_inference).toBe(1);
    expect((await first.result).ok).toBe(true);
    expect((await second.result).ok).toBe(true);
    await f.service.drain();
    expect(value(await f.store.runningTaskCount())).toBe(1);
    expect(value(await f.store.readExecutionLimits()).max_concurrent_inference).toBe(1);
  });
  it("emits catalog-only diagnostics without operation identities or input content", async () => {
    const events: DiagnosticEvent[] = [];
    const f = storageFixture();
    const store = new DurableStore({ ...f.options, emitDiagnostic: (event) => events.push(event) });
    stores.push(store);
    await store.open();
    value(await store.readExecutionLimits());
    value(await store.replaceExecutionLimits({ operationId: "PRIVATE-MARKER", value: 2 }));
    value(await store.readExecutionLimitsReceipt("PRIVATE-MARKER"));
    await store.replaceExecutionLimits({ operationId: "PRIVATE-MARKER-INVALID", value: 0 });
    const limits = events.filter((e) => e.event_name.startsWith("ohtia.limits."));
    expect(limits.map((e) => e.event_name)).toEqual([
      "ohtia.limits.read",
      "ohtia.limits.replaced",
      "ohtia.limits.receipt_read",
      "ohtia.limits.failed",
    ]);
    expect(limits.every((e) => decodeDiagnosticEvent(e) !== undefined)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("PRIVATE-MARKER");
  });
});

function controllerFixture() {
  let current: ExecutionLimitsRecord = {
    serviceGeneration: "first",
    revision: 2,
    max_concurrent_inference: 10,
    running: 0,
  };
  const port = {
    readExecutionLimits: vi.fn(() => call({ ok: true as const, value: current })),
    replaceExecutionLimits: vi.fn((change: { value: number }) => {
      current = {
        ...current,
        revision: current.revision + 1,
        max_concurrent_inference: change.value,
      };
      return call({ ok: true as const, value: current });
    }),
    readExecutionLimitsReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
  };
  let n = 0;
  const controller = new LimitsController(port as unknown as FoundationPort, () => `save-${++n}`);
  disposals.push(() => controller.dispose());
  return {
    controller,
    port,
    get current() {
      return current;
    },
    set current(next) {
      current = next;
    },
  };
}
describe("limits renderer state and plural contract", () => {
  it("keeps uncertain identity across view closure, checks without resending and accepts a recorded receipt", async () => {
    const f = controllerFixture();
    await f.controller.refresh();
    f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("uncertain")) as never);
    await f.controller.choose(2);
    f.controller.setViewOpen(false);
    f.controller.setViewOpen(true);
    expect(f.controller.snapshot().phase).toBe("uncertain");
    expect(f.controller.snapshot().draft).toBe(2);
    f.port.readExecutionLimitsReceipt.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          state: "recorded",
          outcome: {
            ok: true,
            value: { ...f.current, revision: 3, max_concurrent_inference: 2, running: 4 },
          },
        },
      }) as never,
    );
    f.current = { ...f.current, revision: 4, max_concurrent_inference: 3, running: 4 };
    await f.controller.check();
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledOnce();
    expect(f.port.readExecutionLimitsReceipt).toHaveBeenLastCalledWith("save-1");
    expect(f.controller.snapshot()).toMatchObject({
      phase: "idle",
      changedFromWindow: true,
      current: { revision: 4, max_concurrent_inference: 3, running: 4 },
    });
  });
  it("permits a fresh explicit choice only after a new generation proves the old receipt absent", async () => {
    const f = controllerFixture();
    await f.controller.refresh();
    f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("uncertain")) as never);
    await f.controller.choose(2);
    expect(await f.controller.choose(3)).toBe(false);
    f.current = { ...f.current, serviceGeneration: "second", revision: 1 };
    await f.controller.refresh();
    expect(f.controller.snapshot().canChoose).toBe(true);
    expect(await f.controller.retry()).toBe(true);
    expect(f.port.replaceExecutionLimits.mock.calls[1]?.[0]).toMatchObject({
      operationId: "save-2",
      value: 2,
    });
  });
  it("preserves saved success on failed refresh and retries only a rejected explicit intent", async () => {
    const f = controllerFixture();
    await f.controller.refresh();
    f.port.readExecutionLimits.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await f.controller.choose(2);
    expect(f.controller.snapshot()).toMatchObject({ phase: "confirmed", readFailed: true });
    f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await f.controller.choose(3);
    expect(f.controller.snapshot().phase).toBe("rejected");
    expect(await f.controller.retry()).toBe(true);
  });
  it("coalesces rereads, ignores older revisions and retired generations and ignores disposed replies", async () => {
    const f = controllerFixture();
    await f.controller.refresh();
    const late = deferred<Outcome<ExecutionLimitsRecord>>();
    f.port.readExecutionLimits.mockReturnValueOnce({ result: late.promise, cancel() {} } as never);
    const reading = f.controller.refresh();
    void f.controller.refresh();
    f.current = { ...f.current, revision: 3, max_concurrent_inference: 2 };
    late.resolve({ ok: true, value: { ...f.current, revision: 1 } });
    await reading;
    expect(f.controller.snapshot().current?.revision).toBe(3);
    f.current = { ...f.current, serviceGeneration: "second", revision: 1 };
    await f.controller.refresh();
    f.current = { ...f.current, serviceGeneration: "first", revision: 99 };
    await f.controller.refresh();
    expect(f.controller.snapshot().current?.serviceGeneration).toBe("second");
    f.controller.dispose();
    const before = f.controller.snapshot();
    await f.controller.refresh();
    expect(f.controller.snapshot()).toBe(before);
  });
  it("does not rewind live activity with a read captured before a successful save", async () => {
    const f = controllerFixture();
    await f.controller.refresh();
    const late = deferred<Outcome<ExecutionLimitsRecord>>();
    f.port.readExecutionLimits.mockReturnValueOnce({ result: late.promise, cancel() {} } as never);
    const reading = f.controller.refresh();
    const old = { ...f.current };
    f.current = { ...f.current, running: 4 };
    const saving = f.controller.choose(2);
    await Promise.resolve();
    late.resolve({ ok: true, value: old });
    await Promise.all([reading, saving]);
    expect(f.controller.snapshot().current).toMatchObject({
      max_concurrent_inference: 2,
      running: 4,
    });
    f.controller.observed({ ok: true, value: { kind: "inferenceActivity" } });
    f.controller.observed(failure("sequence_gap"));
    await f.controller.refresh();
  });
  it("rejects invalid plural grammar and preserves literal service names", () => {
    const messages = catalogs["en-US"].messages;
    const original = messages["limits.connectionLimit"];
    try {
      for (const template of [
        "{missing, plural, other {# replies}}",
        "{connection_limit, plural, other {# replies} other {duplicate}}",
        "{connection_limit, plural, one {# reply}}",
        "{connection_limit, plural, offset:1 other {# replies}}",
        "{connection_limit, plural, other {{nested}}}",
        "{unknown} {connection_limit, plural, one {# reply} other {# replies}}",
      ]) {
        messages["limits.connectionLimit"] = template;
        expect(() =>
          message("en-US", "limits.connectionLimit", { service: "Service", connection_limit: 2 }),
        ).toThrow();
      }
      messages["limits.connectionLimit"] =
        "{service}: {connection_limit} {connection_limit, plural, one {reply} other {replies}}";
      expect(
        message("en-US", "limits.connectionLimit", {
          service: "Service {raw} #",
          connection_limit: 2,
        }),
      ).toBe("Service {raw} #: 2 replies");
    } finally {
      messages["limits.connectionLimit"] = original;
    }
  });
  it.each(supportedLocales)(
    "renders every count independently in %s without leaking ICU syntax",
    (locale) => {
      for (const count of [1, 2, 4, 10]) {
        expect(
          message(locale, "limits.connectionLimit", {
            service: "ChatGPT",
            connection_limit: count,
          }),
        ).toContain("ChatGPT");
        expect(message(locale, "limits.running", { running: 4, value: count })).not.toMatch(
          /[{}#]/,
        );
      }
      expect(message("en-US", "limits.running", { running: 4, value: 1 })).toBe(
        "4 replies are running. New ones will wait until none are running.",
      );
      expect(message("en-US", "limits.running", { running: 4, value: 2 })).toBe(
        "4 replies are running. New ones will wait until fewer than 2 replies are running.",
      );
      expect(() => message(locale, "limits.running", { running: 4, value: 1.2 })).toThrow();
    },
  );
});
