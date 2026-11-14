import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ServiceConnections,
  decodeDevelopmentAction,
  decodeDevelopmentReport,
  decodeDiagnosticEvent,
  makeDiagnosticRecord,
  type ConnectionState,
  type Outcome,
  type ProviderDispatchMessage,
  type ProviderResult,
  type DiagnosticEvent,
} from "../packages/contracts/src/index.js";
import { TaskTransaction } from "../packages/utility/src/tasks.js";
import { createStatusService } from "../packages/utility/dist/index.js";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { parseDevelopmentSwitches } from "../packages/main/src/development-command.js";
import { Migrator } from "../packages/utility/node_modules/kysely/dist/migration/index.js";
import { Database, storageFixture } from "./fixtures/storage.js";

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return outcome.value;
}
async function setup() {
  const fixture = storageFixture();
  await fixture.store.open();
  const generation = "blocked-task-generation";
  const connections = new ServiceConnections();
  const state = (next: ConnectionState) => {
    connections.receive({
      kind: "connection_state",
      generation,
      snapshot: {
        connection: "chatgpt",
        state: next,
        reason: null,
        probing: false,
        probe_id: null,
        model_list_revision: 1,
        model_count: 1,
      },
    });
  };
  state("connected");
  connections.receive({
    kind: "connection_models",
    generation,
    page: {
      connection: "chatgpt",
      model_list_revision: 1,
      models: [{ id: "test-model", name: "Test model" }],
      nextCursor: 1,
      hasMore: false,
    },
  });
  const context = { generation, connections, mode: "development" as const };
  fixture.store.setTaskContext(context);
  let sequence = 0;
  const project = () =>
    fixture.store.executeResearchCommand({
      command: "development.createProject",
      operationId: `project-${++sequence}`,
      payload: {},
    });
  const projectId = value(await project()).resultId;
  const start = async (id = projectId) =>
    value(
      await fixture.store.executeResearchCommand({
        command: "conversation.start",
        operationId: `start-${++sequence}`,
        payload: { projectId: id, content: `Synthetic question ${sequence}` },
      }),
    ).resultId;
  const append = (id: string) =>
    fixture.store.executeResearchCommand({
      command: "message.append",
      operationId: `append-${++sequence}`,
      payload: { conversationId: id, content: `Synthetic follow-up ${sequence}` },
    });
  const prepare = async () => value(await fixture.store.prepareTask())?.dispatch ?? null;
  const result = (dispatch: ProviderDispatchMessage, outcome: ProviderResult) =>
    fixture.store.recordTaskEvent(
      dispatch.request.attempt,
      { type: "result", sequence: 1, result: outcome },
      "",
    );
  const resume = (operationId = `resume-${++sequence}`) =>
    fixture.store.executeResearchCommand({
      command: "usagePause.resume",
      operationId,
      payload: { connection: "chatgpt" },
    });
  const continueAll = (operationId = `continue-${++sequence}`) =>
    fixture.store.executeResearchCommand({ command: "task.continueAll", operationId, payload: {} });
  const rows = () => {
    const db = fixture.raw();
    try {
      return db
        .prepare(
          "SELECT state,blocking_reason,conversation_id,state_revision,reply_position FROM tasks ORDER BY created_at,id",
        )
        .all() as {
        state: string;
        blocking_reason: string | null;
        conversation_id: Buffer;
        state_revision: number;
        reply_position: number | null;
      }[];
    } finally {
      db.close();
    }
  };
  return {
    ...fixture,
    generation,
    connections,
    state,
    context,
    project,
    start,
    append,
    prepare,
    result,
    resume,
    continueAll,
    rows,
  };
}
const exhausted: ProviderResult = {
  status: "failed",
  reason: "usage_limit_reached",
  dispatched: true,
};

describe("blocked work and connection usage pauses", () => {
  it.each(["disconnected", "connecting", "expired", "error"] as const)(
    "blocks queued and new tasks while %s and requeues in order",
    async (unavailable) => {
      const f = await setup();
      await f.start();
      const running = (await f.prepare())!;
      await f.start();
      f.state(unavailable);
      value(await f.store.reconcileTaskConnections());
      await f.start();
      expect(f.rows().map((t) => [t.state, t.blocking_reason])).toEqual([
        ["running", null],
        ["blocked", "connection_disabled"],
        ["blocked", "connection_disabled"],
      ]);
      expect(await f.prepare()).toBeNull();
      f.state("connected");
      // Observe committed revision deltas on the actual SQLite transaction boundary.
      const original = Database.prototype.prepare;
      let baseline = new Map<string, number>();
      const deltas: number[] = [];
      const snapshot = (db: InstanceType<typeof Database>) =>
        new Map(
          (
            original.call(db, "SELECT hex(id) AS id,state_revision FROM tasks").all() as {
              id: string;
              state_revision: number;
            }[]
          ).map((row) => [row.id, row.state_revision]),
        );
      const statements = vi
        .spyOn(Database.prototype, "prepare")
        .mockImplementation(function (query) {
          const statement = original.call(this, query);
          if (query === "BEGIN IMMEDIATE" || query === "COMMIT") {
            const run = statement.run.bind(statement);
            statement.run = (...parameters: unknown[]) => {
              if (query === "COMMIT") {
                const current = snapshot(this);
                deltas.push(
                  Math.max(
                    ...[...current].map(
                      ([id, revision]) => revision - (baseline.get(id) ?? revision),
                    ),
                  ),
                );
              }
              const result = run(...parameters);
              if (query === "BEGIN IMMEDIATE") baseline = snapshot(this);
              return result;
            };
          }
          return statement;
        });
      const next = (await f.prepare())!;
      statements.mockRestore();
      expect(deltas).toEqual([1, 1]);
      expect(next.request.project).toBe(running.request.project);
      expect(next.request.input[0]!.text).toBe("Synthetic question 3");
      expect(f.rows().map((t) => t.state)).toEqual(["running", "running", "queued"]);
    },
  );
  it("opens one pause atomically, holds every project, coalesces and resumes through stable receipts", async () => {
    const f = await setup();
    const firstConversation = await f.start();
    const first = (await f.prepare())!;
    const otherProject = value(await f.project()).resultId;
    await f.start(otherProject);
    value(await f.result(first, exhausted));
    const waitingConversation = await f.start();
    value(await f.append(waitingConversation));
    expect(f.rows().map((t) => [t.state, t.blocking_reason])).toEqual([
      ["failed", null],
      ["blocked", "usage_limit_reached"],
      ["cancelled", null],
      ["blocked", "usage_limit_reached"],
    ]);
    expect(await f.prepare()).toBeNull();
    const before = f.rows();
    const db = f.raw();
    // Failure recording and queue holds must be one transaction, not separate writes.
    expect(
      db.prepare("SELECT count(*) FROM usage_limit_pauses WHERE resumed_at IS NULL").pluck().get(),
    ).toBe(1);
    const pause = db.prepare("SELECT * FROM usage_limit_pauses").get() as {
      source_attempt_id: Buffer;
    };
    expect(pause.source_attempt_id.toString("hex")).toBe(first.request.attempt.replaceAll("-", ""));
    const receipt = value(await f.resume("resume-once"));
    expect(value(await f.resume("resume-once"))).toEqual(receipt);
    const noChange = f.rows();
    expect(value(await f.resume("resume-after-close"))).not.toEqual(receipt);
    expect(f.rows()).toEqual(noChange);
    expect(db.prepare("SELECT resumed_by_operation_id FROM usage_limit_pauses").pluck().get()).toBe(
      "resume-once",
    );
    expect(
      db
        .prepare("SELECT count(*) FROM command_receipts WHERE command='usagePause.resume'")
        .pluck()
        .get(),
    ).toBe(2);
    expect(
      f
        .rows()
        .filter((t) => t.state === "queued")
        .map((t) => t.conversation_id),
    ).toEqual(before.filter((t) => t.state === "blocked").map((t) => t.conversation_id));
    expect((await f.prepare())!.request.project).toBe(otherProject);
    expect((await f.prepare())!.request.input.at(-1)!.text).toContain("Synthetic follow-up");
    expect(firstConversation).toBeTruthy();
    db.close();
  });
  it("atomically preserves partial replies, pause holds and one revision per task when a usage failure coalesces waiting work", async () => {
    const f = await setup();
    const id = await f.start();
    const dispatch = (await f.prepare())!;
    value(await f.append(id));
    const before = f.rows();
    const db = f.raw();
    const conversationRevision = db
      .prepare(
        "SELECT revision FROM conversations WHERE id=(SELECT conversation_id FROM tasks LIMIT 1)",
      )
      .pluck()
      .get() as number;
    db.exec(
      "CREATE TRIGGER reject_failure BEFORE UPDATE ON tasks WHEN NEW.state='failed' BEGIN SELECT RAISE(ABORT,'Synthetic finalization failure'); END",
    );
    const result = () =>
      f.store.recordTaskEvent(
        dispatch.request.attempt,
        { type: "result", sequence: 1, result: exhausted },
        "Synthetic partial reply",
      );
    expect(await result()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(f.rows()).toEqual(before);
    expect(db.prepare("SELECT count(*) FROM usage_limit_pauses").pluck().get()).toBe(0);
    expect(
      db.prepare("SELECT count(*) FROM messages WHERE author_kind='agent'").pluck().get(),
    ).toBe(0);
    db.exec("DROP TRIGGER reject_failure");
    value(await result());
    expect(f.rows().map((t) => [t.state, t.blocking_reason, t.state_revision])).toEqual([
      ["failed", null, before[0]!.state_revision + 1],
      ["cancelled", null, before[1]!.state_revision + 1],
      ["blocked", "usage_limit_reached", 1],
    ]);
    expect(
      db
        .prepare(
          "SELECT revision FROM conversations WHERE id=(SELECT conversation_id FROM tasks LIMIT 1)",
        )
        .pluck()
        .get(),
    ).toBe(conversationRevision + 1);
    expect(db.prepare("SELECT content FROM messages WHERE author_kind='agent'").pluck().get()).toBe(
      "Synthetic partial reply",
    );
    db.close();
  });
  it("serializes transient connection reports with the task transactions before a later reconnect", async () => {
    const f = await setup();
    await f.start();
    await f.prepare();
    await f.start();
    const db = f.raw();
    db.exec(
      "UPDATE application_preferences SET value=json_set(value,'$.max_concurrent_inference',1),revision=revision+1 WHERE key='execution_limits'",
    );
    db.close();
    const observed: (string | null)[] = [];
    const reconcile = f.store.reconcileTaskConnections.bind(f.store);
    vi.spyOn(f.store, "reconcileTaskConnections").mockImplementation(async () => {
      const result = await reconcile();
      observed.push(f.rows().at(-1)!.blocking_reason);
      return result;
    });
    const service = createStatusService(
      f.generation,
      "en-US",
      () => {},
      f.store,
      undefined,
      "development",
    );
    service.activate("en-US");
    for (const state of ["connected", "connecting", "connected"])
      service.receive(
        JSON.stringify({
          kind: "connection_state",
          generation: f.generation,
          snapshot: {
            connection: "chatgpt",
            state,
            reason: null,
            probing: false,
            probe_id: null,
            model_list_revision: null,
            model_count: 0,
          },
        }),
      );
    await service.drain();
    expect(observed).toContain("connection_disabled");
    expect(observed.at(-1)).toBeNull();
    expect(f.rows().at(-1)!.state).toBe("queued");
    service.dispose();
  });
  it("requires explicit resumption again when the plan is still exhausted and never retries dispatched work", async () => {
    const f = await setup();
    for (let n = 0; n < 5; n++) await f.start();
    const a = (await f.prepare())!;
    const b = (await f.prepare())!;
    value(await f.result(a, exhausted));
    value(await f.result(b, exhausted));
    value(await f.resume());
    const c = (await f.prepare())!;
    const d = (await f.prepare())!;
    value(await f.result(c, exhausted));
    value(await f.result(d, exhausted));
    expect(await f.prepare()).toBeNull();
    const db = f.raw();
    expect(db.prepare("SELECT count(*) FROM usage_limit_pauses").pluck().get()).toBe(2);
    expect(
      db.prepare("SELECT count(*) FROM usage_limit_pauses WHERE resumed_at IS NULL").pluck().get(),
    ).toBe(1);
    expect(db.prepare("SELECT max(attempt_number) FROM attempts").pluck().get()).toBe(1);
    expect(f.rows().at(-1)).toMatchObject({
      state: "blocked",
      blocking_reason: "usage_limit_reached",
    });
    db.close();
  });
  it("preserves an open plan pause across disconnect, reconnect, command replay and process restart", async () => {
    const f = await setup();
    await f.start();
    const a = (await f.prepare())!;
    await f.start();
    value(await f.result(a, exhausted));
    f.state("disconnected");
    value(await f.store.reconcileTaskConnections());
    expect(f.rows().at(-1)!.blocking_reason).toBe("connection_disabled");
    await f.store.close();
    await f.store.open();
    f.state("connected");
    value(await f.store.reconcileTaskConnections());
    expect(f.rows().at(-1)!.blocking_reason).toBe("usage_limit_reached");
    expect(await f.prepare()).toBeNull();
    value(await f.resume("old-resume"));
    const b = (await f.prepare())!;
    await f.start();
    value(await f.result(b, exhausted));
    value(await f.resume("old-resume"));
    expect(await f.prepare()).toBeNull();
  });
  it.each([false, true])(
    "records a refused renewal without dispatch and retains a later waiting task: %s",
    async (later) => {
      const f = await setup();
      const id = await f.start();
      const a = (await f.prepare())!;
      f.state("expired");
      if (later) value(await f.append(id));
      value(
        await f.result(a, { status: "failed", reason: "connection_expired", dispatched: false }),
      );
      expect(f.rows()[0]!.state).toBe(later ? "cancelled" : "blocked");
      const db = f.raw();
      expect(
        db.prepare("SELECT state,outcome_reason,dispatch_permitted_at FROM attempts").get(),
      ).toEqual({
        state: "cancelled",
        outcome_reason: "connection_expired",
        dispatch_permitted_at: null,
      });
      f.state("connected");
      const b = (await f.prepare())!;
      expect(b.request.attempt).not.toBe(a.request.attempt);
      expect(db.prepare("SELECT max(attempt_number) FROM attempts").pluck().get()).toBe(
        later ? 1 : 2,
      );
      db.close();
    },
  );
  it("fails a temporary renewal alone, keeps the connection and clears dispatch evidence", async () => {
    const f = await setup();
    await f.start();
    const a = (await f.prepare())!;
    await f.start();
    value(
      await f.result(a, { status: "failed", reason: "provider_unavailable", dispatched: false }),
    );
    expect(f.connections.available("chatgpt")).toBe(true);
    expect(f.rows().map((t) => t.state)).toEqual(["failed", "queued"]);
    const db = f.raw();
    expect(db.prepare("SELECT state,dispatch_permitted_at FROM attempts").get()).toEqual({
      state: "failed",
      dispatch_permitted_at: null,
    });
    db.close();
    expect(await f.prepare()).not.toBeNull();
  });
  it("enforces pause identity, source, timestamp, one-open rule and immutable history in SQLite", async () => {
    const f = await setup();
    await f.start();
    const a = (await f.prepare())!;
    value(await f.result(a, exhausted));
    const db = f.raw();
    const copy =
      "INSERT INTO usage_limit_pauses SELECT source_attempt_id,connection,source_attempt_id,paused_at,resumed_at,resumed_by_operation_id FROM usage_limit_pauses";
    expect(() => db.exec(copy)).toThrow();
    expect(() => db.exec("UPDATE usage_limit_pauses SET resumed_at='invalid'")).toThrow();
    expect(() => db.exec("DELETE FROM usage_limit_pauses")).toThrow();
    value(await f.resume());
    expect(() =>
      db.exec("UPDATE usage_limit_pauses SET resumed_by_operation_id='other'"),
    ).toThrow();
    db.close();
    expect(
      await f.store.executeResearchCommand({
        command: "usagePause.resume",
        operationId: "bad",
        payload: { connection: "fake" as "chatgpt" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_message" } });
    expect(
      await f.store.executeResearchCommand({
        command: "task.continueAll",
        operationId: "bad",
        payload: { extra: true } as Record<string, never>,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_message" } });
    value(await f.resume("conflict"));
    expect(await f.continueAll("conflict")).toMatchObject({
      ok: false,
      error: { code: "operation_conflict" },
    });
  });
  it("retains a failed revalidation and unrelated holds without enlarging authorization", async () => {
    const f = await setup();
    await f.start();
    f.state("disconnected");
    value(await f.store.reconcileTaskConnections());
    f.store.setTaskContext({ ...f.context, mode: "installed" });
    f.state("connected");
    value(await f.store.reconcileTaskConnections());
    expect(f.rows()[0]!.blocking_reason).toBe("connection_disabled");
    f.store.setTaskContext(f.context);
    const db = f.raw();
    db.exec(
      "UPDATE tasks SET blocking_reason='permission_required',state_revision=state_revision+1",
    );
    db.close();
    value(await f.store.reconcileTaskConnections());
    expect(await f.prepare()).toBeNull();
  });
});

describe("migration recovery task handoff", () => {
  async function source() {
    const f = await setup();
    await f.start();
    const dispatched = (await f.prepare())!;
    const unsent = await f.start();
    const db = f.raw();
    // Synthetic accepted preparation interrupted before a dispatch transaction.
    db.exec(`INSERT INTO attempts (id,task_id,attempt_number,service_generation,state,created_at)
      SELECT id,id,1,'old-orderly-generation','prepared',created_at FROM tasks WHERE state='queued';
      UPDATE tasks SET state='running',reply_position=input_through_position+1,state_revision=state_revision+1 WHERE state='queued';`);
    db.close();
    await f.start();
    await f.store.close();
    const old = f.raw();
    old.exec(
      "DROP TABLE usage_limit_pauses; DELETE FROM kysely_migration WHERE name='0009_usage_limit_pauses'; DELETE FROM ohtia_migration_artifacts WHERE name='0009_usage_limit_pauses'; PRAGMA user_version=8",
    );
    old.close();
    return { ...f, dispatched, unsent };
  }
  it("does not treat a healthy upgrade's new gate as migration recovery", async () => {
    const f = await source();
    await f.store.open();
    expect(f.rows().map((t) => t.state)).toEqual(["running", "running", "queued"]);
    expect(fs.existsSync(path.join(f.root, "migration-pending.json"))).toBe(false);
  });
  it.each(["rollback", "restoration", "committed-target", "hold-rollback", "hold-committed"])(
    "holds pending and unfinished work across %s and later ordinary startup until explicit continuation",
    async (mode) => {
      const f = await source();
      const gate = path.join(f.root, "migration-pending.json");
      if (mode === "committed-target" || mode === "hold-committed") {
        const unlink = fs.unlinkSync;
        const spy = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
          if (file === gate) throw new Error("Synthetic gate removal crash");
          return unlink(file);
        });
        await expect(f.store.open()).rejects.toThrow();
        spy.mockRestore();
      } else {
        const migrate = Migrator.prototype.migrateTo;
        const spy = vi
          .spyOn(Migrator.prototype, "migrateTo")
          .mockImplementation(async function (name) {
            return {
              ...(await migrate.call(this, name)),
              error: new Error("Synthetic migration rollback"),
            };
          });
        await expect(f.store.open()).rejects.toThrow();
        spy.mockRestore();
      }
      expect(fs.existsSync(gate)).toBe(true);
      if (mode === "restoration") {
        await f.store.restorePending();
        await f.store.close();
        await expect(f.store.open()).rejects.toThrow(/recovery/);
      }
      if (mode === "hold-rollback") {
        const recover = TaskTransaction.prototype.recoverMigration;
        const failure = vi
          .spyOn(TaskTransaction.prototype, "recoverMigration")
          .mockImplementation(async function () {
            await recover.call(this);
            throw new Error("Synthetic crash before recovery commit");
          });
        await expect(f.store.retry()).rejects.toThrow();
        failure.mockRestore();
        expect(fs.existsSync(gate)).toBe(true);
      }
      if (mode === "hold-committed") {
        const unlink = fs.unlinkSync;
        const spy = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
          if (file === gate) throw new Error("Synthetic post-hold crash");
          return unlink(file);
        });
        await expect(f.store.retry()).rejects.toThrow();
        spy.mockRestore();
        expect(f.rows().at(-1)!.blocking_reason).toBe("restart_paused");
      }
      await f.store.retry();
      const limits = f.raw();
      limits.exec(
        "UPDATE application_preferences SET value=json_set(value,'$.max_concurrent_inference',1),revision=revision+1 WHERE key='execution_limits'",
      );
      limits.close();
      expect(f.rows().map((t) => [t.state, t.blocking_reason])).toEqual([
        ["uncertain", null],
        ["blocked", "restart_paused"],
        ["blocked", "restart_paused"],
      ]);
      expect(await f.prepare()).toBeNull();
      await f.store.close();
      await f.store.open();
      f.state("disconnected");
      value(await f.store.reconcileTaskConnections());
      f.state("connected");
      value(await f.store.reconcileTaskConnections());
      expect(await f.prepare()).toBeNull();
      const receipt = value(await f.continueAll("continue-once"));
      expect(value(await f.continueAll("continue-once"))).toEqual(receipt);
      expect(await f.prepare()).not.toBeNull();
      const db = f.raw();
      expect(
        db
          .prepare(
            "SELECT state,outcome_reason,dispatch_permitted_at FROM attempts WHERE service_generation='old-orderly-generation'",
          )
          .get(),
      ).toMatchObject({
        state: "cancelled",
        outcome_reason: "service_restarted",
        dispatch_permitted_at: null,
      });
      db.close();
    },
  );
  it("cancels returning replies behind later work, fails exhausted preparations and honors cancellation during recovery", async () => {
    const f = await source();
    await f.store.open();
    // A returning unsent reply must not collide with the newer waiting reply in its conversation.
    value(await f.append(f.unsent));
    const db = f.raw();
    db.exec(
      "UPDATE tasks SET state='cancelling',state_revision=state_revision+1 WHERE id=(SELECT task_id FROM attempts WHERE dispatch_permitted_at IS NOT NULL)",
    );
    db.close();
    await f.store.close();
    fs.writeFileSync(
      path.join(f.root, "migration-pending.json"),
      JSON.stringify({ version: 1, operation: "edge-recovery", source: 8, target: 9 }),
    );
    await f.store.retry();
    expect(f.rows().map((t) => t.state)).toEqual(["cancelled", "cancelled", "blocked", "blocked"]);
    const after = f.raw();
    expect(
      after
        .prepare("SELECT outcome_reason FROM attempts WHERE dispatch_permitted_at IS NOT NULL")
        .pluck()
        .get(),
    ).toBe("cancelled_by_researcher");
    after.close();

    const exhausted = await source();
    const raw = exhausted.raw();
    raw.exec(
      "UPDATE attempts SET state='cancelled',outcome_reason='permit_expired',finished_at=created_at WHERE service_generation='old-orderly-generation'",
    );
    // A second prepared attempt has no remaining readmission budget.
    const id = raw
      .prepare("SELECT task_id FROM attempts WHERE service_generation='old-orderly-generation'")
      .pluck()
      .get() as Buffer;
    const attemptId = Buffer.from(id);
    attemptId[15] = attemptId[15]! ^ 1;
    raw
      .prepare(
        "INSERT INTO attempts (id,task_id,attempt_number,service_generation,state,created_at) SELECT ?,task_id,2,service_generation,'prepared',created_at FROM attempts WHERE service_generation='old-orderly-generation'",
      )
      .run(attemptId);
    raw.close();
    fs.writeFileSync(
      path.join(exhausted.root, "migration-pending.json"),
      JSON.stringify({ version: 1, operation: "exhausted-recovery", source: 8, target: 9 }),
    );
    await exhausted.store.retry();
    expect(exhausted.rows()[1]!.state).toBe("failed");
  });
  it("keeps usage and connection prerequisites when continuing recovery and preserves restart holds during coalescing", async () => {
    const f = await setup();
    await f.start();
    const a = (await f.prepare())!;
    value(await f.result(a, exhausted));
    const id = await f.start();
    await f.store.close();
    fs.writeFileSync(
      path.join(f.root, "migration-pending.json"),
      JSON.stringify({ version: 1, operation: "synthetic-recovery", source: 8, target: 9 }),
    );
    await f.store.retry();
    value(await f.append(id));
    expect(f.rows().at(-1)!.blocking_reason).toBe("restart_paused");
    f.state("disconnected");
    value(await f.continueAll());
    expect(f.rows().at(-1)!.blocking_reason).toBe("usage_limit_reached");
    value(await f.resume());
    expect(f.rows().at(-1)!.blocking_reason).toBe("connection_disabled");
    f.state("connected");
    expect(await f.prepare()).not.toBeNull();
    value(await f.continueAll("empty-continue"));
    const before = f.rows();
    value(await f.continueAll("another-empty-continue"));
    expect(f.rows()).toEqual(before);
  });
});

describe("pause development commands and diagnostics", () => {
  it("validates and runs both commands through the durable receipt boundary with no content in diagnostics", async () => {
    const f = await setup();
    const output: string[] = [];
    const provider = new DurableProvider({
      storage: f.store,
      context: f.context,
      send: (text) => output.push(text),
    });
    for (const action of ["resume-requests", "continue-all"]) {
      const switches = [
        `--ohtia-dev-command=${action}`,
        ...(action === "resume-requests" ? ["--ohtia-dev-connection=chatgpt"] : []),
      ];
      const invocation = parseDevelopmentSwitches(switches, action);
      expect(invocation?.ok).toBe(true);
      if (!invocation?.ok) throw new Error("Invalid invocation");
      const wire = {
        kind: "development_action",
        version: 1,
        generation: f.generation,
        action: invocation.action,
      };
      const decoded = decodeDevelopmentAction(JSON.stringify(wire), f.generation)!;
      expect(decoded).toEqual(wire);
      await provider.developmentAction(decoded);
      const report = decodeDevelopmentReport(output.at(-1), f.generation);
      expect(report?.report.type).toBe("record");
      expect(
        decodeDevelopmentAction(
          JSON.stringify({ ...wire, action: { ...wire.action, extra: true } }),
          f.generation,
        ),
      ).toBeUndefined();
    }
    for (const switches of [
      ["--ohtia-dev-command=resume-requests"],
      ["--ohtia-dev-command=resume-requests", "--ohtia-dev-connection=fake"],
      ["--ohtia-dev-command=continue-all", "--ohtia-dev-connection=chatgpt"],
    ])
      expect(parseDevelopmentSwitches(switches)?.ok).toBe(false);
    const events: DiagnosticEvent[] = [
      { event_name: "ohtia.task.blocked" },
      { event_name: "ohtia.task.recovery_paused" },
      { event_name: "ohtia.task.continued" },
      { event_name: "ohtia.usage_pause.opened" },
      { event_name: "ohtia.usage_pause.resumed" },
    ];
    for (const event of events) {
      const record = makeDiagnosticRecord(event, "0.0.0", "2026-11-14T00:00:00.000Z");
      expect(record).toBeDefined();
      expect(decodeDiagnosticEvent(event)).toEqual(event);
      expect(decodeDiagnosticEvent({ ...event, prompt: "private" })).toBeUndefined();
    }
  });
});
