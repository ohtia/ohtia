import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ServiceConnections,
  decodeServiceWake,
  decodeServiceShutdown,
  decodeProviderDispatch,
  type ServiceWakeMessage,
  type Outcome,
  type ProviderEvent,
  type ProviderEventBody,
} from "../packages/contracts/src/index.js";
import { DurableStore } from "../packages/utility/src/storage.js";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { identifier } from "../packages/utility/src/research.js";
import { TaskTransaction } from "../packages/utility/src/tasks.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { observeServicePower } from "../packages/main/src/service-power.js";
import { conformanceRequest } from "./fixtures/provider-conformance.js";
import { storageFixture, stores } from "./fixtures/storage.js";

afterEach(() => vi.useRealTimers());

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return outcome.value;
}
function wake(generation = "run", start = 1000, end = 121000): ServiceWakeMessage {
  return {
    kind: "service_wake",
    version: 1,
    generation,
    suspendedAt: new Date(start).toISOString(),
    resumedAt: new Date(end).toISOString(),
    asleepMs: Math.max(0, end - start),
  };
}
async function setup() {
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
  let sequence = 0;
  const context = { generation: "run", mode: "development" as const, connections };
  f.store.setTaskContext(context);
  await f.store.open();
  const command = async (projectId?: string, conversationId?: string) =>
    value(
      await f.store.executeResearchCommand(
        conversationId
          ? {
              command: "message.append",
              operationId: `accept-${++sequence}`,
              payload: { conversationId, content: "Synthetic question" },
            }
          : projectId
            ? {
                command: "conversation.start",
                operationId: `accept-${++sequence}`,
                payload: { projectId, content: "Synthetic question" },
              }
            : {
                command: "development.createProject",
                operationId: `accept-${++sequence}`,
                payload: {},
              },
      ),
    ).resultId;
  const project = await command();
  const prepare = async () => value(await f.store.prepareTask())?.dispatch ?? null;
  const continueAll = (operationId = `continue-${++sequence}`) =>
    f.store.executeResearchCommand({ command: "task.continueAll", operationId, payload: {} });
  const rows = (table = "tasks") => {
    const db = f.raw();
    try {
      return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  };
  const undispatched = () => {
    const db = f.raw();
    const trigger = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name='attempts_changes'")
      .pluck()
      .get() as string;
    db.exec(
      "DROP TRIGGER attempts_changes; UPDATE attempts SET state='prepared', dispatch_permitted_at=NULL, transfer_manifest=NULL, requested_model=NULL WHERE finished_at IS NULL",
    );
    db.exec(trigger);
    db.close();
  };
  return { ...f, context, project, command, prepare, continueAll, rows, undispatched };
}

describe("restart admission and durable service runs", () => {
  it.each(["complete", "cut-again"])(
    "recovers a crash after a fake provider zero-dispatch receipt: %s",
    async (ending) => {
      const f = await setup();
      await f.command(f.project);
      const first = (await f.prepare())!;
      let wall = first.permit.issued_at + 2001;
      const events: ProviderEvent[] = [];
      const fake = createFakeProvider();
      const send = vi.fn(fake.requests!.send);
      const dispatch = new ProviderDispatch(
        [
          {
            ...fake,
            declaration: {
              ...fake.declaration,
              connection: { ...fake.declaration.connection, id: "chatgpt" },
            },
            requests: { ...fake.requests!, send },
          },
        ],
        {
          state: () => "connected",
          wallClock: () => wall,
          monotonic: () => 0,
          send: (_generation, text) => events.push(JSON.parse(text).event as ProviderEvent),
        },
      );
      dispatch.begin("run");
      await dispatch.receive(first);
      expect(send).not.toHaveBeenCalled();
      const proof = events.shift()!;
      expect(proof).toMatchObject({
        type: "result",
        result: { status: "failed", reason: "permit_expired", dispatched: false },
      });
      value(await f.store.recordTaskEvent(first.request.attempt, proof, ""));
      // Crash after the non-dispatch receipt commits, before the next scheduler pump.
      dispatch.end("run");
      await dispatch.drain();
      await f.store.close();
      const restarted = new DurableStore({ ...f.options, serviceGeneration: "restart" });
      stores.push(restarted);
      restarted.setTaskContext({ ...f.context, generation: "restart" });
      await restarted.open();
      expect(f.rows()[0]).toMatchObject({ state: "blocked", blocking_reason: "restart_paused" });
      expect(value(await restarted.prepareTask())).toBeNull();
      value(
        await restarted.executeResearchCommand({
          command: "task.continueAll",
          operationId: "continue-after-receipt",
          payload: {},
        }),
      );
      const second = value(await restarted.prepareTask())!.dispatch;
      wall = second.permit.issued_at + (ending === "cut-again" ? 2001 : 0);
      dispatch.begin("restart");
      await dispatch.receive(second);
      let text = "";
      for (const event of events) {
        if (event.type === "text") text += event.text;
        value(await restarted.recordTaskEvent(second.request.attempt, event, text));
      }
      expect(f.rows()[0]!.state).toBe(ending === "complete" ? "completed" : "failed");
      expect(f.rows("attempts")).toHaveLength(2);
      expect(send).toHaveBeenCalledTimes(ending === "complete" ? 1 : 0);
      expect(value(await restarted.prepareTask())).toBeNull();
      dispatch.dispose();
    },
  );

  it("coalesces a restart-paused task into one new paused task without an attempt", async () => {
    const f = await setup();
    const conversation = await f.command(f.project);
    const accepted = f.rows()[0]!;
    await f.store.close();
    await f.store.open();
    await f.command(undefined, conversation);
    const rows = f.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: accepted.id, state: "cancelled", blocking_reason: null });
    expect(rows[1]).toMatchObject({
      replaces_task_id: accepted.id,
      state: "blocked",
      blocking_reason: "restart_paused",
    });
    expect(rows[1]!.id).not.toEqual(accepted.id);
    expect(f.rows("attempts")).toHaveLength(0);
    expect(await f.prepare()).toBeNull();
  });
  it("emits one recovery-paused event for a migration recovery review", async () => {
    const f = await setup();
    await f.command(f.project);
    await f.store.close(true);
    fs.writeFileSync(
      path.join(f.root, "migration-pending.json"),
      JSON.stringify({ version: 1, operation: "diagnostic-recovery", source: 10, target: 27 }),
    );
    const events: string[] = [];
    const recovered = new DurableStore({
      ...f.options,
      emitDiagnostic: (event) => events.push(event.event_name),
    });
    stores.push(recovered);
    recovered.setTaskContext(f.context);
    await recovered.retry();
    expect(f.rows()[0]!.blocking_reason).toBe("restart_paused");
    expect(events.filter((name) => name === "ohtia.task.recovery_paused")).toHaveLength(1);
  });

  it("dispatches orderly queued work automatically only after storage activation", async () => {
    const f = await setup();
    await f.command(f.project);
    await f.store.close(true);
    const next = new DurableStore({ ...f.options, serviceGeneration: "next-run" });
    stores.push(next);
    const sent: string[] = [];
    const service = createStatusService(
      "next-run",
      "en-US",
      (text) => sent.push(text),
      next,
      undefined,
      "development",
    );
    await next.open();
    service.receive(
      JSON.stringify({
        kind: "connection_state",
        generation: "next-run",
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
        generation: "next-run",
        page: {
          connection: "chatgpt",
          model_list_revision: 1,
          models: [{ id: "first", name: "First" }],
          nextCursor: 1,
          hasMore: false,
        },
      }),
    );
    await service.drain();
    expect(sent.some((text) => decodeProviderDispatch(text, "next-run"))).toBe(false);
    service.activate("en-US");
    await service.drain();
    expect(sent.filter((text) => decodeProviderDispatch(text, "next-run"))).toHaveLength(1);
    expect(f.rows("attempts")[0]!.service_generation).toBe("next-run");
    expect(f.rows("service_runs").at(-1)!.generation).toBe("next-run");
    service.dispose();
  });

  it.each([true, false])(
    "records every start and records a clean stop only for orderly=%s",
    async (orderly) => {
      const f = await setup();
      await f.store.close(orderly);
      expect(f.rows("service_runs")[0]!.clean_stop_at !== null).toBe(orderly);
      await f.store.open();
      expect(f.rows("service_runs")).toHaveLength(2);
      const db = f.raw();
      for (const sql of [
        "DELETE FROM service_runs",
        "UPDATE service_runs SET generation='changed'",
        "UPDATE service_runs SET started_at='bad'",
        "UPDATE service_runs SET clean_stop_at=NULL",
      ])
        expect(() => db.exec(sql)).toThrow();
      db.close();
    },
  );
  it("resumes orderly queued tasks in order and retains existing blocking reasons", async () => {
    const f = await setup();
    for (let i = 0; i < 3; i++) await f.command(f.project);
    const db = f.raw();
    db.exec(
      "UPDATE tasks SET state='blocked',blocking_reason='permission_required',state_revision=state_revision+1 WHERE rowid=(SELECT max(rowid) FROM tasks)",
    );
    db.close();
    await f.store.close(true);
    await f.store.open();
    expect(f.rows().map((r) => r.state)).toEqual(["queued", "queued", "blocked"]);
    expect(f.rows()[2]!.blocking_reason).toBe("permission_required");
    const first = (await f.prepare())!;
    const second = (await f.prepare())!;
    const ids = f.rows().map((r) => Buffer.from(r.conversation_id as Uint8Array).toString("hex"));
    expect([first, second].map((d) => d.request.input[0]!.text)).toEqual([
      "Synthetic question",
      "Synthetic question",
    ]);
    expect(
      f
        .rows()
        .slice(0, 2)
        .every((r) => r.state === "running"),
    ).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
  it("pauses every project after a crash, preserves coalesced holds, and receipts no-op continuation", async () => {
    const f = await setup();
    const conversation = await f.command(f.project);
    await f.command(await f.command());
    await f.store.close();
    await f.store.open();
    expect(f.rows().every((r) => r.blocking_reason === "restart_paused")).toBe(true);
    await f.command(undefined, conversation);
    expect(
      f
        .rows()
        .filter((r) => r.state === "blocked")
        .every((r) => r.blocking_reason === "restart_paused"),
    ).toBe(true);
    expect(await f.prepare()).toBeNull();
    value(await f.continueAll("continue-all"));
    expect(await f.prepare()).not.toBeNull();
    expect(await f.prepare()).not.toBeNull();
    const before = f.rows();
    const noop = value(await f.continueAll("nothing-left"));
    expect(value(await f.continueAll("nothing-left"))).toEqual(noop);
    expect(f.rows()).toEqual(before);
    expect(f.rows("command_receipts").some((r) => r.operation_id === "nothing-left")).toBe(true);
  });
  it.each([true, false])(
    "finalizes an unfinished committed permit as uncertain after orderly=%s",
    async (orderly) => {
      const f = await setup();
      await f.command(f.project);
      const dispatched = (await f.prepare())!;
      value(
        await f.store.recordTaskEvent(
          dispatched.request.attempt,
          { type: "text", sequence: 1, text: "Lost partial" },
          "",
        ),
      );
      await f.store.close(orderly);
      await f.store.open();
      expect(f.rows()[0]!.state).toBe("uncertain");
      expect(f.rows("attempts")[0]).toMatchObject({
        state: "uncertain",
        outcome_reason: "service_restarted",
        input_tokens: null,
      });
      expect(
        value(
          await f.store.readMessages(identifier(f.rows()[0]!.conversation_id as Uint8Array)),
        ).filter((m) => m.authorKind === "agent").length,
      ).toBe(0);
      await f.command(f.project);
      value(await f.continueAll());
      expect(await f.prepare()).not.toBeNull();
      expect(
        f
          .rows("attempts")
          .filter((r) =>
            Buffer.from(r.task_id as Uint8Array).equals(Buffer.from(f.rows()[0]!.id as Uint8Array)),
          ),
      ).toHaveLength(1);
    },
  );
  it.each([true, false])(
    "retries a proven undispatched attempt after orderly=%s only within its budget",
    async (orderly) => {
      const f = await setup();
      await f.command(f.project);
      await f.prepare();
      f.undispatched();
      await f.store.close(orderly);
      await f.store.open();
      expect(f.rows()[0]).toMatchObject({
        state: orderly ? "queued" : "blocked",
        blocking_reason: orderly ? null : "restart_paused",
      });
      if (!orderly) {
        expect(await f.prepare()).toBeNull();
        value(await f.continueAll());
      }
      expect(await f.prepare()).not.toBeNull();
      f.undispatched();
      await f.store.close(orderly);
      await f.store.open();
      expect(f.rows()[0]!.state).toBe("failed");
      expect(f.rows("attempts").map((r) => [r.state, r.outcome_reason])).toEqual([
        ["cancelled", "service_restarted"],
        ["cancelled", "service_restarted"],
      ]);
      value(await f.continueAll());
      expect(await f.prepare()).toBeNull();
    },
  );
  it.each([true, false])(
    "cancels a returning undispatched reply with waiting input, orderly=%s",
    async (orderly) => {
      const f = await setup();
      const conversation = await f.command(f.project);
      await f.prepare();
      f.undispatched();
      await f.command(undefined, conversation);
      await f.store.close(orderly);
      await f.store.open();
      expect(f.rows().map((r) => r.state)).toEqual(["cancelled", orderly ? "queued" : "blocked"]);
    },
  );
  it("finalizes a cancelling task at a crash using the old generation's closed connection", async () => {
    const f = await setup();
    await f.command(f.project);
    await f.prepare();
    const id = identifier(f.rows()[0]!.id as Uint8Array);
    value(
      await f.store.executeResearchCommand({
        command: "task.stop",
        operationId: "stop",
        payload: { taskId: id },
      }),
    );
    await f.store.close();
    await f.store.open();
    expect(f.rows()[0]!.state).toBe("cancelled");
    expect(f.rows("attempts")[0]!.outcome_reason).toBe("cancelled_by_researcher");
  });
  it.each(["before-commit", "after-commit"])(
    "keeps recovery holds with an old clean marker and a crash %s",
    async (failure) => {
      const f = await setup();
      await f.command(f.project);
      await f.prepare();
      f.undispatched();
      await f.store.close(true);
      const gate = path.join(f.root, "migration-pending.json");
      fs.writeFileSync(
        gate,
        JSON.stringify({ version: 1, operation: "recovery", source: 10, target: 27 }),
      );
      await expect(f.store.open()).rejects.toThrow(/recovery/);
      if (failure === "before-commit") {
        const recover = TaskTransaction.prototype.recoverMigration;
        vi.spyOn(TaskTransaction.prototype, "recoverMigration").mockImplementationOnce(
          async function () {
            await recover.call(this);
            throw new Error("Synthetic interruption");
          },
        );
      } else {
        const unlink = fs.unlinkSync;
        vi.spyOn(fs, "unlinkSync").mockImplementationOnce((file) => {
          if (file === gate) throw new Error("Synthetic interruption");
          unlink(file);
        });
      }
      await expect(f.store.retry()).rejects.toThrow();
      vi.restoreAllMocks();
      expect(fs.existsSync(gate)).toBe(true);
      await f.store.retry();
      expect(f.rows()[0]).toMatchObject({ state: "blocked", blocking_reason: "restart_paused" });
      await f.store.close(true);
      await f.store.open();
      expect(await f.prepare()).toBeNull();
      value(await f.continueAll());
      expect(await f.prepare()).not.toBeNull();
    },
  );
});

describe("suspension boundaries", () => {
  it("echoes serialized wake review before posting fresh dispatch permits", async () => {
    const f = await setup();
    const sent: string[] = [];
    const service = createStatusService(
      "run",
      "en-US",
      (text) => sent.push(text),
      f.store,
      undefined,
      "development",
    );
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
    await service.drain();
    const observed = wake();
    service.receive(JSON.stringify(observed));
    service.receive(
      JSON.stringify({
        kind: "development_action",
        version: 1,
        generation: "run",
        action: {
          name: "start-conversation",
          operation_id: "fresh-after-wake",
          project: f.project,
          text: "Synthetic question",
        },
      }),
    );
    await service.drain();
    const ack = sent.findIndex((text) => JSON.parse(text).kind === "service_wake");
    const permit = sent.findIndex((text) => decodeProviderDispatch(text, "run"));
    expect(ack).toBeGreaterThanOrEqual(0);
    expect(permit).toBeGreaterThan(ack);
    expect(JSON.parse(sent[ack]!)).toEqual(observed);
    service.dispose();
  });

  it("refuses a late pre-sleep permit until the service acknowledges wake review", async () => {
    let wall = 1000;
    const fake = createFakeProvider();
    const send = vi.fn(fake.requests!.send);
    const dispatch = new ProviderDispatch([{ ...fake, requests: { ...fake.requests!, send } }], {
      state: () => "connected",
      send: () => {},
      wallClock: () => wall,
      monotonic: () => 0,
    });
    dispatch.begin("run");
    dispatch.suspend();
    const observed = wake("run", 1000, 500);
    dispatch.wake(observed);
    wall = 1001;
    const request = conformanceRequest("fake");
    await dispatch.receive({
      kind: "provider_dispatch",
      version: 1,
      generation: "run",
      request,
      permit: { id: "old-queued-permit", attempt: request.attempt, issued_at: 1000 },
    });
    expect(send).not.toHaveBeenCalled();
    dispatch.wakeReviewed({ ...observed, generation: "old" });
    dispatch.wakeReviewed(wake("run", 1000, 600));
    await dispatch.receive({
      kind: "provider_dispatch",
      version: 1,
      generation: "run",
      request: { ...request, attempt: "still-fenced" },
      permit: { id: "still-fenced", attempt: "still-fenced", issued_at: wall },
    });
    expect(send).not.toHaveBeenCalled();
    dispatch.wakeReviewed(observed);
    await dispatch.receive({
      kind: "provider_dispatch",
      version: 1,
      generation: "run",
      request: { ...request, attempt: "fresh" },
      permit: { id: "fresh", attempt: "fresh", issued_at: wall },
    });
    expect(send).toHaveBeenCalledOnce();
    dispatch.dispose();
  });

  it.each(["queued-event", "new-stream"])(
    "does not recount sleep already sampled before wake: %s",
    async (ordering) => {
      const f = await setup();
      await f.command(f.project);
      let wall = 1000000;
      let mono = 0;
      let sequence = 0;
      const sent: string[] = [];
      const provider = new DurableProvider({
        storage: f.store,
        context: f.context,
        send: (text) => sent.push(text),
        wallClock: () => wall,
        monotonic: () => mono,
      });
      await provider.pump();
      const request = sent.map((text) => decodeProviderDispatch(text, "run")).find(Boolean)!;
      const receive = (event: ProviderEventBody) =>
        provider.receive({
          kind: "provider_event",
          version: 1,
          generation: "run",
          attempt: request.request.attempt,
          event: { ...event, sequence: ++sequence } as ProviderEvent,
        });
      await receive({ type: "started", model: null, provider_request_id: null });
      let suspendedAt: number;
      if (ordering === "queued-event") {
        for (let i = 0; i < 5; i++) {
          wall += 100000;
          mono += 100000;
          await receive({ type: "activity" });
        }
        suspendedAt = wall;
        wall += 60000;
        await receive({ type: "activity" });
      } else suspendedAt = wall - request.request.limits.max_inactivity_ms;
      provider.wake(wake("run", suspendedAt, wall));
      expect(sent.some((text) => JSON.parse(text).kind === "provider_interrupt")).toBe(false);
      await receive({ type: "text", text: "Synthetic reply" });
      await receive({ type: "result", result: { status: "completed" } });
      expect(f.rows()[0]!.state).toBe("completed");
      const finished = sent
        .map((text) => JSON.parse(text))
        .find((message) => message.report?.type === "finished");
      expect(finished.report.duration_ms).toBe(ordering === "queued-event" ? 560000 : 0);
      provider.dispose();
    },
  );

  it("validates exact wake and shutdown messages, including a backwards wall clock", () => {
    const message = wake();
    expect(decodeServiceWake(JSON.stringify(message))).toEqual(message);
    const backwards = wake("run", 2000, 1000);
    expect(decodeServiceWake(JSON.stringify(backwards))).toEqual(backwards);
    for (const changed of [
      { ...message, asleepMs: -1 },
      { ...message, asleepMs: 2 },
      { ...message, resumedAt: "2026-02-30T00:00:00.000Z" },
      { ...message, version: 2 },
      { ...message, credential: "private" },
    ])
      expect(decodeServiceWake(JSON.stringify(changed))).toBeUndefined();
    for (const orderly of [true, false])
      expect(
        decodeServiceShutdown(
          JSON.stringify({ kind: "shutdown", generation: "run", orderly }),
          "run",
        )?.orderly,
      ).toBe(orderly);
    expect(
      decodeServiceShutdown(JSON.stringify({ kind: "shutdown", generation: "run" }), "run"),
    ).toBeUndefined();
    expect(
      decodeServiceShutdown(
        JSON.stringify({ kind: "shutdown", generation: "old", orderly: true }),
        "run",
      ),
    ).toBeUndefined();
  });
  it.each([2000, 500])(
    "observes Electron suspend/resume and sends the measured wall interval ending at %s",
    (resumed) => {
      const monitor = new EventEmitter();
      let wall = 1000;
      const post = vi.fn();
      const dispatch = vi.fn();
      const suspend = vi.fn();
      observeServicePower(monitor, {
        generation: () => "run",
        suspend,
        wake: dispatch,
        post,
        wallClock: () => wall,
      });
      monitor.emit("resume");
      expect(post).not.toHaveBeenCalled();
      monitor.emit("suspend");
      monitor.emit("suspend");
      wall = resumed;
      monitor.emit("resume");
      monitor.emit("resume");
      expect(suspend).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(decodeServiceWake(post.mock.calls[0]![0])).toEqual(wake("run", 1000, resumed));
    },
  );
  it.each(["inactivity_timeout", "deadline_exceeded"] as const)(
    "rechecks %s in the service and waits for confirmed closure",
    async (reason) => {
      const f = await setup();
      let mono = 0;
      let wall = 1000;
      const sent: string[] = [];
      await f.command(f.project);
      const provider = new DurableProvider({
        storage: f.store,
        context: f.context,
        send: (text) => sent.push(text),
        monotonic: () => mono,
        wallClock: () => wall,
      });
      await provider.pump();
      const dispatch = sent.map((text) => decodeProviderDispatch(text, "run")).find(Boolean)!;
      const duration =
        reason === "deadline_exceeded"
          ? dispatch.request.limits.max_attempt_duration_ms
          : dispatch.request.limits.max_inactivity_ms;
      provider.wake(wake("old", 1000, 1000 + duration));
      expect(sent.some((s) => s.includes("provider_interrupt"))).toBe(false);
      wall += duration;
      provider.wake(wake("run", 1000, wall));
      expect(sent.some((s) => s.includes("provider_interrupt"))).toBe(true);
      expect(f.rows()[0]!.state).toBe("running");
      mono = 10;
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation: "run",
        attempt: dispatch.request.attempt,
        event: { type: "result", sequence: 1, result: { status: "cancelled" } },
      });
      expect(f.rows()[0]!.state).toBe("failed");
      expect(f.rows("attempts")[0]!.outcome_reason).toBe(reason);
      provider.dispose();
    },
  );
  it("discards an ended generation's service_wake without losing admission", async () => {
    const f = await setup();
    await f.command(f.project);
    const service = createStatusService(
      "run",
      "en-US",
      () => {},
      f.store,
      undefined,
      "development",
    );
    service.receive(JSON.stringify(wake("run")));
    await service.drain();
    expect(f.rows()[0]!.state).toBe("queued");
    service.activate("en-US");
    service.receive(JSON.stringify(wake("old")));
    await service.drain();
    expect(f.store.ready).toBe(true);
    service.dispose();
  });
  it.each([1100, 500])(
    "refuses a pending permit at resume wall time %s and accepts fresh readmission",
    async (resumedAt) => {
      let clock = 1000;
      let resolve!: (value: "ready") => void;
      const send = vi.fn();
      const events: string[] = [];
      const fake = createFakeProvider({
        prepare: () =>
          new Promise((done) => {
            resolve = done;
          }),
        send: async (_request, control) => {
          send();
          control.release();
        },
      });
      const dispatch = new ProviderDispatch([fake], {
        state: () => "connected",
        send: (_generation, text) => events.push(text),
        wallClock: () => clock,
        monotonic: () => 0,
      });
      dispatch.begin("run");
      const request = conformanceRequest("fake");
      const running = dispatch.receive({
        kind: "provider_dispatch",
        version: 1,
        generation: "run",
        request,
        permit: { id: "permit", attempt: request.attempt, issued_at: clock },
      });
      dispatch.suspend();
      clock = resumedAt;
      dispatch.wake(wake("run", 1000, clock));
      resolve("ready");
      await running;
      expect(send).not.toHaveBeenCalled();
      expect(JSON.parse(events[0]!).event.result).toEqual({
        status: "failed",
        reason: "permit_expired",
        dispatched: false,
      });
      dispatch.wakeReviewed(wake("run", 1000, clock));
      const next = dispatch.receive({
        kind: "provider_dispatch",
        version: 1,
        generation: "run",
        request: { ...request, attempt: "second" },
        permit: { id: "fresh", attempt: "second", issued_at: clock },
      });
      resolve("ready");
      await next;
      expect(send).toHaveBeenCalledOnce();
      dispatch.dispose();
    },
  );

  it.each([1000, 2000])(
    "counts %s ms asleep once for requests admitted after suspend",
    async (asleep) => {
      let wall = 1000;
      const events: string[] = [];
      const fake = createFakeProvider({
        send: (_request, control) => {
          expect(control.release()).toBe(true);
          return new Promise((resolve) =>
            control.signal.addEventListener("abort", () => resolve()),
          );
        },
      });
      const dispatch = new ProviderDispatch([fake], {
        state: () => "connected",
        send: (_generation, text) => events.push(text),
        wallClock: () => wall,
        monotonic: () => 0,
      });
      dispatch.begin("run");
      dispatch.suspend();
      const request = {
        ...conformanceRequest("fake"),
        limits: { max_output_bytes: 1000, max_attempt_duration_ms: 1500, max_inactivity_ms: 1200 },
      };
      const pending = dispatch.receive({
        kind: "provider_dispatch",
        version: 1,
        generation: "run",
        request,
        permit: { id: "permit", attempt: request.attempt, issued_at: wall },
      });
      await Promise.resolve();
      wall += asleep;
      dispatch.wake(wake("old", 1000, wall));
      expect(events).toHaveLength(0);
      dispatch.wake(wake("run", 1000, wall));
      if (asleep === 1000) {
        expect(events).toHaveLength(0);
        expect(dispatch.query(request.attempt)).toBe("running");
        dispatch.interrupt({
          kind: "provider_interrupt",
          version: 1,
          generation: "run",
          attempt: request.attempt,
        });
      }
      await pending;
      expect(JSON.parse(events[0]!).event.result).toEqual(
        asleep === 1000
          ? { status: "cancelled" }
          : { status: "failed", reason: "deadline_exceeded", dispatched: true },
      );
      dispatch.dispose();
    },
  );
  it("keeps timed-out preparations proven undispatched before a wake callback", async () => {
    vi.useFakeTimers();
    let wall = 1000;
    const events: string[] = [];
    const send = vi.fn();
    const fake = createFakeProvider({
      prepare: (signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve("temporary"))),
      send,
    });
    const dispatch = new ProviderDispatch([fake], {
      state: () => "connected",
      send: (_generation, text) => events.push(text),
      wallClock: () => wall,
      monotonic: () => 0,
    });
    dispatch.begin("run");
    const request = {
      ...conformanceRequest("fake"),
      limits: { max_output_bytes: 1000, max_attempt_duration_ms: 200, max_inactivity_ms: 100 },
    };
    const pending = dispatch.receive({
      kind: "provider_dispatch",
      version: 1,
      generation: "run",
      request,
      permit: { id: "permit", attempt: request.attempt, issued_at: wall },
    });
    dispatch.suspend();
    wall += 100;
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(send).not.toHaveBeenCalled();
    expect(JSON.parse(events[0]!).event.result).toEqual({
      status: "failed",
      reason: "permit_expired",
      dispatched: false,
    });
    dispatch.dispose();
  });
  it("closes a crashed service generation's held fake request before replacement review", async () => {
    const f = await setup();
    await f.command(f.project);
    const prepared = (await f.prepare())!;
    const fake = createFakeProvider({ holdReply: true });
    const events: string[] = [];
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
        send: (_generation, text) => events.push(text),
      },
    );
    dispatch.begin("run");
    const pending = dispatch.receive(prepared);
    await Promise.resolve();
    expect(dispatch.ceased).toBe(false);
    dispatch.end("run");
    await dispatch.drain();
    await pending;
    const before = events.length;
    await f.store.close();
    await f.store.open();
    dispatch.begin("replacement");
    expect(dispatch.ceased).toBe(true);
    expect(f.rows()[0]!.state).toBe("uncertain");
    expect(events).toHaveLength(before);
    dispatch.dispose();
  });
});

it.each([100, 120000])(
  "requeues the committed task for attempt two after %s ms asleep before dispatch",
  async (asleep) => {
    const f = await setup();
    await f.command(f.project);
    let clock = 1000;
    let renew!: () => void;
    let preparations = 0;
    const pending: Promise<void>[] = [];
    let queue = Promise.resolve();
    const fake = createFakeProvider({
      prepare: () =>
        ++preparations === 1
          ? new Promise((resolve) => {
              renew = () => resolve("ready");
            })
          : Promise.resolve("ready"),
    });
    let provider!: DurableProvider;
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
        wallClock: () => clock,
        monotonic: () => clock,
        send: (_generation, text) => {
          const message = JSON.parse(text) as {
            kind: "provider_event";
            version: 1;
            generation: string;
            attempt: string;
            event: ProviderEvent;
          };
          queue = queue.then(async () => {
            expect(await provider.receive(message)).toBe(true);
          });
        },
      },
    );
    dispatch.begin("run");
    provider = new DurableProvider({
      storage: f.store,
      context: f.context,
      wallClock: () => clock,
      monotonic: () => clock,
      send: (text) => {
        const message = decodeProviderDispatch(text, "run");
        if (message) pending.push(dispatch.receive(message));
      },
    });
    // The permit has been committed by SQLite before main begins its delayed renewal.
    // Keep both clocks aligned with that permit's actual wall time.
    clock = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    await provider.pump();
    dispatch.suspend();
    const suspendedAt = clock;
    clock += asleep;
    vi.setSystemTime(clock);
    const message = wake("run", suspendedAt, clock);
    provider.wake(message);
    dispatch.wake(message);
    dispatch.wakeReviewed(message);
    renew();
    await pending[0];
    await queue;
    await Promise.all(pending);
    await queue;
    expect(f.rows("attempts").map((r) => [r.attempt_number, r.state, r.outcome_reason])).toEqual([
      [1, "cancelled", "permit_expired"],
      [2, "completed", null],
    ]);
    expect(f.rows()[0]!.state).toBe("completed");
    provider.dispose();
    dispatch.dispose();
  },
);
