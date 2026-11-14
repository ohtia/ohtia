import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ServiceConnections,
  type Outcome,
  type ProviderDispatchMessage,
  type DiagnosticEvent,
  decodeDiagnosticEvent,
  makeDiagnosticRecord,
} from "../packages/contracts/src/index.js";
import { DurableProvider, utf8Beginning } from "../packages/utility/src/durable-provider.js";
import { objects as researchObjects } from "../packages/utility/src/migrations/0007_research_records.mjs";
import { Database, storageFixture, stores } from "./fixtures/storage.js";
import { DurableStore } from "../packages/utility/dist/index.js";

function value<T>(outcome: Outcome<T>): T {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error("Expected a successful task transaction.");
  return outcome.value;
}
async function setup(
  models = [{ id: "first-model", name: "First model" }],
  emitDiagnostic?: (event: DiagnosticEvent) => void,
) {
  const fixture = storageFixture();
  if (emitDiagnostic) {
    fixture.store = new DurableStore({ ...fixture.options, emitDiagnostic });
    stores.push(fixture.store);
  }
  await fixture.store.open();
  const connections = new ServiceConnections();
  const generation = "task-generation";
  connections.receive({
    kind: "connection_state",
    generation,
    snapshot: {
      connection: "chatgpt",
      state: "connected",
      reason: null,
      probing: false,
      probe_id: null,
      model_list_revision: 1,
      model_count: models.length,
    },
  });
  connections.receive({
    kind: "connection_models",
    generation,
    page: {
      connection: "chatgpt",
      model_list_revision: 1,
      models,
      nextCursor: models.length,
      hasMore: false,
    },
  });
  fixture.store.setTaskContext({ generation, mode: "development", connections });
  const projectId = value(
    await fixture.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "development-project",
      payload: {},
    }),
  ).resultId;
  const conversation = value(await fixture.store.readConversations(projectId))[0]!;
  let command = 0;
  const append = (content: string, id = conversation.id) =>
    fixture.store.executeResearchCommand({
      command: "message.append",
      operationId: `append-${++command}`,
      payload: { conversationId: id, content },
    });
  const start = (content: string) =>
    fixture.store.executeResearchCommand({
      command: "conversation.start",
      operationId: `start-${++command}`,
      payload: { projectId, content },
    });
  const prepare = async () => value(await fixture.store.prepareTask())?.dispatch ?? null;
  const result = (request: ProviderDispatchMessage, text: string) =>
    fixture.store.recordTaskEvent(
      request.request.attempt,
      { type: "result", result: { status: "completed" }, sequence: 1 },
      text,
    );
  return {
    ...fixture,
    projectId,
    conversation,
    append,
    start,
    prepare,
    result,
    connections,
    generation,
  };
}

describe("durable provider tasks on real SQLite", () => {
  it("creates a confirmed development project and coalesces atomically with the researcher acceptance", async () => {
    const { store, append, raw, projectId, conversation } = await setup();
    expect(value(await store.readProjects())[0]).toMatchObject({
      id: projectId,
      title: "Development project",
      documentLanguage: "en",
      isDevelopment: true,
    });
    value(await append("First"));
    value(await append("Second"));
    const db = raw();
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY created_at,id").all() as {
      state: string;
      replaces_task_id: Buffer;
      id: Buffer;
      document_language: string;
      state_revision: number;
    }[];
    expect(tasks.map((t) => t.state)).toEqual(["cancelled", "queued"]);
    expect(tasks[1]!.replaces_task_id).toEqual(tasks[0]!.id);
    expect(tasks[0]!.state_revision).toBe(2);
    expect(tasks[1]!.document_language).toBe("en");
    expect(value(await store.readConversations(projectId))[0]).toMatchObject({
      id: conversation.id,
      revision: 3,
    });
    expect(db.prepare("SELECT count(*) FROM command_receipts").pluck().get()).toBe(3);
    db.close();
  });

  it("commits the selected model and immutable transfer manifest before returning the permit", async () => {
    const { append, prepare, raw, projectId } = await setup();
    value(await append("Question"));
    const dispatch = (await prepare())!;
    expect(dispatch.request).toMatchObject({
      project: projectId,
      model: "first-model",
      policy_version: 1,
      instruction_version: 1,
      document_language: "en",
      input: [{ role: "user", text: "Question" }],
    });
    const db = raw();
    const attempt = db.prepare("SELECT * FROM attempts").get() as {
      dispatch_permitted_at: string;
      transfer_manifest: string;
      requested_model: string;
    };
    expect(Date.parse(attempt.dispatch_permitted_at)).toBe(dispatch.permit.issued_at);
    expect(attempt.requested_model).toBe("first-model");
    expect(JSON.parse(attempt.transfer_manifest)).toHaveLength(2);
    expect(() => db.prepare("UPDATE attempts SET transfer_manifest='[]'").run()).toThrow();
    db.close();
  });

  it("reserves reply order and replaces waiting input when the reply commits, once per conversation transaction", async () => {
    const { store, append, prepare, result, conversation, projectId, raw } = await setup();
    value(await append("First"));
    const first = (await prepare())!;
    value(await append("Second"));
    value(await append("Third"));
    const db = raw();
    const waiting = db
      .prepare(
        "SELECT input_through_position,accepted_by_operation_id FROM tasks WHERE state='queued'",
      )
      .get();
    const before = value(await store.readConversations(projectId))[0]!.revision;
    value(await result(first, "First reply"));
    expect(value(await store.readConversations(projectId))[0]!.revision).toBe(before + 1);
    expect(
      value(await store.readMessages(conversation.id)).map((m) => [m.position, m.content]),
    ).toEqual([
      [1, "First"],
      [2, "First reply"],
      [3, "Second"],
      [4, "Third"],
    ]);
    expect(
      db
        .prepare(
          "SELECT input_through_position,accepted_by_operation_id FROM tasks WHERE state='queued'",
        )
        .get(),
    ).toEqual(waiting);
    const next = (await prepare())!;
    expect(next.request.input.map((item) => item.text)).toEqual([
      "First",
      "First reply",
      "Second",
      "Third",
    ]);
    db.close();
  });

  it("runs three conversations while a fourth waits and a closed uncertain attempt frees its slot", async () => {
    const { store, start, prepare, raw } = await setup();
    for (let n = 0; n < 4; n++) value(await start(`Question ${n}`));
    const first = (await prepare())!;
    expect(await prepare()).not.toBeNull();
    expect(await prepare()).not.toBeNull();
    expect(await prepare()).toBeNull();
    value(
      await store.recordTaskEvent(
        first.request.attempt,
        { type: "result", result: { status: "uncertain", reason: "connection_lost" }, sequence: 1 },
        "",
      ),
    );
    expect(await prepare()).not.toBeNull();
    const db = raw();
    expect(db.prepare("SELECT count(*) FROM tasks WHERE state='running'").pluck().get()).toBe(3);
    expect(db.prepare("SELECT count(*) FROM tasks WHERE state='uncertain'").pluck().get()).toBe(1);
    db.close();
  });

  it("retries only a proved refused permit and fails on the second refusal", async () => {
    const { store, append, prepare, raw } = await setup();
    value(await append("Question"));
    const first = (await prepare())!;
    const refuse = (dispatch: ProviderDispatchMessage) =>
      store.recordTaskEvent(
        dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", reason: "permit_expired", dispatched: false },
        },
        "",
      );
    value(await refuse(first));
    const second = (await prepare())!;
    expect(second.request.attempt).not.toBe(first.request.attempt);
    value(await refuse(second));
    expect(await prepare()).toBeNull();
    const db = raw();
    expect(db.prepare("SELECT state FROM tasks").pluck().get()).toBe("failed");
    expect(db.prepare("SELECT dispatch_permitted_at FROM attempts").all()).toEqual([
      { dispatch_permitted_at: null },
      { dispatch_permitted_at: null },
    ]);
    db.close();
  });

  it("cancels a refused task when a later task already waits in the conversation", async () => {
    const { store, append, prepare, raw } = await setup();
    value(await append("First"));
    const dispatch = (await prepare())!;
    value(await append("Later"));
    value(
      await store.recordTaskEvent(
        dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", reason: "permit_expired", dispatched: false },
        },
        "",
      ),
    );
    const db = raw();
    expect(db.prepare("SELECT state FROM tasks ORDER BY created_at,id").all()).toEqual([
      { state: "cancelled" },
      { state: "queued" },
    ]);
    expect((await prepare())!.request.input.map((item) => item.text)).toEqual(["First", "Later"]);
    db.close();
  });

  it("fails an empty reply without saving a message and protects terminal rows", async () => {
    const { append, prepare, result, raw } = await setup();
    value(await append("Question"));
    value(await result((await prepare())!, ""));
    const db = raw();
    expect(db.prepare("SELECT state,outcome_reason FROM attempts").get()).toEqual({
      state: "failed",
      outcome_reason: "empty_reply",
    });
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(1);
    expect(() => db.prepare("UPDATE attempts SET observed_model='rewritten'").run()).toThrow();
    expect(() => db.prepare("UPDATE tasks SET state_revision=state_revision+1").run()).toThrow();
    db.prepare("UPDATE attempts SET input_tokens=7").run();
    db.close();
  });

  it.each([{ models: [] }, { models: [{ id: "invalid model slug", name: "Invalid model" }] }])(
    "fails without dispatch or a work unit when no usable visible model is available: $models",
    async ({ models }) => {
      const { append, prepare, raw } = await setup(models);
      value(await append("Question"));
      expect(await prepare()).toBeNull();
      const db = raw();
      expect(
        db.prepare("SELECT state,outcome_reason,dispatch_permitted_at FROM attempts").get(),
      ).toEqual({
        state: "failed",
        outcome_reason: "provider_unavailable",
        dispatch_permitted_at: null,
      });
      expect(db.prepare("SELECT state,reply_position FROM tasks").get()).toEqual({
        state: "failed",
        reply_position: null,
      });
      db.close();
    },
  );

  it("rejects oversized UTF-8 input before saving either a message or receipt", async () => {
    const { append, raw } = await setup();
    expect(await append("🐈".repeat(4097))).toMatchObject({
      ok: false,
      error: { code: "input_too_large" },
    });
    const db = raw();
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM tasks").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM command_receipts").pluck().get()).toBe(1);
    db.close();
  });
});

describe("durable task admission and streaming limits", () => {
  it("keeps the seeded local limit and raises only the seeded inference preference", async () => {
    const { raw } = await setup();
    const db = raw();
    const record = db
      .prepare("SELECT revision,value FROM application_preferences WHERE key='execution_limits'")
      .get() as { revision: number; value: string };
    expect(record.revision).toBe(2);
    expect(JSON.parse(record.value)).toEqual({
      max_concurrent_inference: 10,
      max_concurrent_local_processing: 1,
    });
    db.close();
  });

  it("enforces the operation's pending cap globally and accepts coalescing at that cap", async () => {
    const { start, append, raw } = await setup();
    const first = value(await start("First pending question")).resultId;
    for (let n = 1; n < 20; n++) value(await start(`Pending question ${n}`));
    const db = raw();
    const before = db.prepare("SELECT count(*) FROM command_receipts").pluck().get();
    expect(await start("Rejected question")).toMatchObject({
      error: { code: "pending_limit_reached" },
    });
    expect(db.prepare("SELECT count(*) FROM command_receipts").pluck().get()).toBe(before);
    value(await append("Coalesced question", first));
    expect(db.prepare("SELECT count(*) FROM tasks WHERE state='queued'").pluck().get()).toBe(20);
    db.close();
  });

  it("sends newest whole messages oldest first with a revision-bound omission note", async () => {
    const { append, prepare, conversation } = await setup();
    for (let n = 0; n < 21; n++) value(await append(`Question ${n}`));
    const dispatch = (await prepare())!;
    expect(dispatch.request.input).toHaveLength(21);
    expect(dispatch.request.input[0]).toEqual({
      role: "user",
      text: "Earlier messages in this conversation are not included.",
    });
    expect(dispatch.request.input[1]!.text).toBe("Question 1");
    expect(dispatch.request.input[20]!.text).toBe("Question 20");
    expect(conversation.id).toBeTruthy();
  });

  it.each([false, true])(
    "interrupts output over the shared byte budget with researcher Stop=%s",
    async (researcherStop) => {
      const { store, append, raw, connections, generation, conversation } = await setup();
      value(await append("Question"));
      const sent: Record<string, unknown>[] = [];
      const provider = new DurableProvider({
        storage: store,
        context: { generation, mode: "development", connections },
        send: (text) => sent.push(JSON.parse(text) as Record<string, unknown>),
      });
      await provider.pump();
      const dispatch = sent.find(
        (message) => message.kind === "provider_dispatch",
      ) as unknown as ProviderDispatchMessage;
      for (let n = 1; n <= 4; n++)
        expect(
          await provider.receive({
            kind: "provider_event",
            version: 1,
            generation,
            attempt: dispatch.request.attempt,
            event: { type: "text", sequence: n, text: "x".repeat(4095) },
          }),
        ).toBe(true);
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation,
        attempt: dispatch.request.attempt,
        event: { type: "text", sequence: 5, text: "🐈🐈" },
      });
      expect(sent.some((message) => message.kind === "provider_interrupt")).toBe(true);
      if (researcherStop) {
        const db = raw();
        const task = taskId(db);
        db.close();
        await provider.developmentAction({
          kind: "development_action",
          version: 1,
          generation,
          action: { name: "stop", operation_id: "stop-after-output-limit", task },
        });
      }
      // The output budget requests closure, but does not release the slot before its receipt.
      expect(value(await store.readMessages(conversation.id))).toHaveLength(1);
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation,
        attempt: dispatch.request.attempt,
        event: { type: "result", sequence: 6, result: { status: "cancelled" } },
      });
      const messages = value(await store.readMessages(conversation.id));
      expect(messages[1]!.ending).toBe("partial");
      expect(messages[1]!.content).toBe("x".repeat(16380) + "🐈");
      const db = raw();
      expect(db.prepare("SELECT state,outcome_reason FROM attempts").get()).toEqual({
        state: researcherStop ? "cancelled" : "failed",
        outcome_reason: researcherStop ? "cancelled_by_researcher" : "output_limit_exceeded",
      });
      expect(sent).toContainEqual(
        expect.objectContaining({
          kind: "development_report",
          report: expect.objectContaining({
            type: "finished",
            result: researcherStop
              ? { status: "cancelled" }
              : { status: "failed", reason: "output_limit_exceeded", dispatched: true },
          }),
        }),
      );
      const before = db.prepare("SELECT state_revision FROM tasks").pluck().get();
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation,
        attempt: dispatch.request.attempt,
        event: { type: "result", sequence: 6, result: { status: "completed" } },
      });
      expect(db.prepare("SELECT state_revision FROM tasks").pluck().get()).toBe(before);
      expect(utf8Beginning("a🐈b", 4)).toBe("a");
      db.close();
      provider.dispose();
    },
  );
});

describe("database task and attempt invariants", () => {
  it("rejects closed-state, blocking, identity, reservation and revision violations", async () => {
    const { append, prepare, raw } = await setup();
    value(await append("Question"));
    const db = raw();
    db.pragma("foreign_keys=ON");
    for (const assignment of [
      "state='invented',state_revision=state_revision+1",
      "state='blocked',state_revision=state_revision+1",
      "state='blocked',blocking_reason='shutdown_paused',state_revision=state_revision+1",
      "blocking_reason='permission_required',state_revision=state_revision+1",
      "state_revision=state_revision+2",
      "input_through_position=input_through_position+1,state_revision=state_revision+1",
      "operation='another',state_revision=state_revision+1",
      "policy_version=2,state_revision=state_revision+1",
      "instruction_version=2,state_revision=state_revision+1",
      "connection='another',state_revision=state_revision+1",
      "document_language='es',state_revision=state_revision+1",
      "accepted_by_operation_id='missing',state_revision=state_revision+1",
      "created_at='2000-01-01T00:00:00.000Z',state_revision=state_revision+1",
      "reply_position=2,state_revision=state_revision+1",
      "state='running',reply_position=3,state_revision=state_revision+1",
    ])
      expect(() => db.exec(`UPDATE tasks SET ${assignment}`), assignment).toThrow();
    db.exec(
      "UPDATE tasks SET state='blocked',blocking_reason='permission_required',state_revision=state_revision+1",
    );
    db.exec("UPDATE tasks SET state='queued',blocking_reason=NULL,state_revision=state_revision+1");
    const dispatch = (await prepare())!;
    expect(dispatch).toBeDefined();
    for (const assignment of [
      "reply_position=3,state_revision=state_revision+1",
      "state='completed',state_revision=state_revision",
    ])
      expect(() => db.exec(`UPDATE tasks SET ${assignment}`)).toThrow();
    expect(() => db.exec("DELETE FROM tasks")).toThrow();
    expect(() => db.exec("DELETE FROM attempts")).toThrow();
    for (const assignment of [
      "state='invented'",
      "attempt_number=2",
      "service_generation='other'",
      "outcome_reason='provider_error'",
      "state='failed'",
      "state='completed'",
      "input_tokens=-1",
      "output_tokens=0.5",
      "dispatch_permitted_at=NULL",
      "transfer_manifest='[]'",
      "requested_model='changed'",
    ])
      expect(() => db.exec(`UPDATE attempts SET ${assignment}`), assignment).toThrow();
    db.close();
  });

  it("enforces the two per-conversation task slots and ownership of agent messages", async () => {
    const { store, append, prepare, raw, conversation } = await setup();
    value(await append("First"));
    const first = (await prepare())!;
    value(await append("Later"));
    const db = raw();
    expect(() =>
      db.exec(
        "UPDATE tasks SET state='running',reply_position=4,state_revision=state_revision+1 WHERE state='queued'",
      ),
    ).toThrow();
    expect(() =>
      db.exec(
        "UPDATE tasks SET state='queued',state_revision=state_revision+1 WHERE state='running'",
      ),
    ).toThrow();
    const insert = db.prepare(
      "INSERT INTO messages (id,conversation_id,position,author_kind,agent_id,content,created_at,task_id) VALUES (?,?,?,?,?,?,?,?)",
    );
    const id = Buffer.from("00000000000070008000000000000001", "hex");
    const conversationId = Buffer.from(conversation.id.replaceAll("-", ""), "hex");
    const now = new Date().toISOString();
    expect(() =>
      insert.run(id, conversationId, 2, "researcher", null, "Reserved", now, null),
    ).toThrow();
    expect(() =>
      insert.run(id, conversationId, 2, "agent", "virgilio", "No task", now, null),
    ).toThrow();
    const task = db.prepare("SELECT id FROM tasks WHERE state='running'").pluck().get() as Buffer;
    expect(() =>
      insert.run(id, conversationId, 3, "agent", "virgilio", "Wrong position", now, task),
    ).toThrow();
    value(
      await store.recordTaskEvent(
        first.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "Reply",
      ),
    );
    expect(() =>
      insert.run(id, conversationId, 2, "agent", "virgilio", "Duplicate", now, task),
    ).toThrow();
    db.close();
  });

  it("rejects events from old generations without changing a durable task or its conversation", async () => {
    const { store, append, prepare, raw, connections } = await setup();
    value(await append("Question"));
    const dispatch = (await prepare())!;
    const db = raw();
    const before = db.prepare("SELECT state_revision FROM tasks").pluck().get();
    store.setTaskContext({
      generation: "replacement-generation",
      mode: "development",
      connections,
    });
    expect(
      value(
        await store.recordTaskEvent(
          dispatch.request.attempt,
          { type: "result", sequence: 1, result: { status: "completed" } },
          "Stale result",
        ),
      ),
    ).toEqual({ recorded: false });
    expect(db.prepare("SELECT state_revision FROM tasks").pluck().get()).toBe(before);
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(1);
    expect(db.prepare("SELECT dispatch_permitted_at FROM attempts").pluck().get()).not.toBeNull();
    db.close();
  });
});

describe("durable task migration preservation", () => {
  it.each([
    { revision: 1, inference: 1, expectedRevision: 2, expectedInference: 10 },
    { revision: 2, inference: 1, expectedRevision: 2, expectedInference: 1 },
    { revision: 7, inference: 4, expectedRevision: 7, expectedInference: 4 },
  ])(
    "preserves a saved choice and updates only the seeded record: $revision/$inference",
    async ({ revision, inference, expectedRevision, expectedInference }) => {
      const fixture = storageFixture();
      await fixture.store.open();
      await fixture.store.close();
      const db = fixture.raw();
      db.pragma("foreign_keys=OFF");
      db.exec(
        "DROP TRIGGER messages_ending; DROP TRIGGER receipts_commands; DROP TRIGGER tasks_charge_initial; DROP TRIGGER tasks_charge_changes; ALTER TABLE messages DROP COLUMN ending; ALTER TABLE tasks DROP COLUMN charge_warning_accepted_at; DELETE FROM kysely_migration WHERE name='0010_reply_control'; DELETE FROM ohtia_migration_artifacts WHERE name='0010_reply_control'; DROP TABLE usage_limit_pauses; DELETE FROM kysely_migration WHERE name='0009_usage_limit_pauses'; DELETE FROM ohtia_migration_artifacts WHERE name='0009_usage_limit_pauses'; DROP INDEX messages_task; DROP TRIGGER messages_reservation; DROP TRIGGER messages_position; DROP TABLE attempts; DROP TABLE tasks; ALTER TABLE messages DROP COLUMN task_id",
      );
      db.exec(researchObjects.messages_position);
      db.exec(researchObjects.messages_revision);
      db.exec(
        "DELETE FROM kysely_migration WHERE name='0008_durable_ai_tasks'; DELETE FROM ohtia_migration_artifacts WHERE name='0008_durable_ai_tasks'; PRAGMA user_version=7",
      );
      db.prepare(
        "UPDATE application_preferences SET revision=?,value=? WHERE key='execution_limits'",
      ).run(
        revision,
        JSON.stringify({ max_concurrent_inference: inference, max_concurrent_local_processing: 1 }),
      );
      db.close();
      await fixture.store.open();
      const upgraded = fixture.raw();
      const record = upgraded
        .prepare("SELECT revision,value FROM application_preferences WHERE key='execution_limits'")
        .get() as { revision: number; value: string };
      expect(record.revision).toBe(expectedRevision);
      expect(JSON.parse(record.value)).toEqual({
        max_concurrent_inference: expectedInference,
        max_concurrent_local_processing: 1,
      });
      expect(upgraded.pragma("user_version", { simple: true })).toBe(10);
      upgraded.close();
    },
  );
});

it("checks every task and attempt state pair against the database transition contract", async () => {
  const { append, prepare, raw } = await setup();
  value(await append("Question"));
  await prepare();
  const db = raw();
  const taskTransitions: Record<string, readonly string[]> = {
    queued: ["queued", "blocked", "running", "failed", "cancelled"],
    blocked: ["blocked", "queued", "cancelled"],
    running: [
      "running",
      "queued",
      "blocked",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
      "uncertain",
    ],
    cancelling: ["cancelling", "cancelled", "failed", "uncertain"],
    completed: [],
    failed: [],
    cancelled: [],
    uncertain: ["uncertain", "failed", "cancelled"],
  };
  for (const from of Object.keys(taskTransitions))
    for (const to of Object.keys(taskTransitions)) {
      db.exec("SAVEPOINT task_pair");
      if (from !== "running")
        db.prepare(
          "UPDATE tasks SET state=?,blocking_reason=?,state_revision=state_revision+1",
        ).run(from, from === "blocked" ? "input_changed" : null);
      const transition = () =>
        db
          .prepare("UPDATE tasks SET state=?,blocking_reason=?,state_revision=state_revision+1")
          .run(to, to === "blocked" ? "input_changed" : null);
      if (taskTransitions[from]!.includes(to)) expect(transition, `${from} -> ${to}`).not.toThrow();
      else expect(transition, `${from} -> ${to}`).toThrow();
      db.exec("ROLLBACK TO task_pair; RELEASE task_pair");
    }
  db.exec(
    "UPDATE attempts SET state='cancelled',outcome_reason='permit_expired',finished_at=created_at",
  );
  db.exec(
    "INSERT INTO attempts (id,task_id,attempt_number,service_generation,state,created_at) SELECT x'00000000000070008000000000000001',task_id,2,service_generation,'prepared',created_at FROM attempts",
  );
  const attemptTransitions: Record<string, readonly string[]> = {
    prepared: ["prepared", "running", "stopping", "failed", "cancelled", "uncertain"],
    running: [
      "running",
      "waiting_user",
      "stopping",
      "completed",
      "failed",
      "cancelled",
      "uncertain",
    ],
    waiting_user: ["waiting_user", "running", "stopping", "failed", "cancelled", "uncertain"],
    stopping: ["stopping", "failed", "cancelled", "uncertain"],
    completed: ["completed"],
    failed: ["failed"],
    cancelled: ["cancelled"],
    uncertain: ["uncertain"],
  };
  const terminal = ["completed", "failed", "cancelled", "uncertain"];
  const reason = (state: string) =>
    state === "failed"
      ? "provider_error"
      : state === "cancelled"
        ? "cancelled_by_researcher"
        : state === "uncertain"
          ? "connection_lost"
          : null;
  const updateAttempt = (state: string) =>
    db
      .prepare(
        "UPDATE attempts SET state=?,outcome_reason=?,finished_at=CASE WHEN ? THEN created_at ELSE NULL END WHERE attempt_number=2",
      )
      .run(state, reason(state), Number(terminal.includes(state)));
  for (const from of Object.keys(attemptTransitions))
    for (const to of Object.keys(attemptTransitions)) {
      db.exec("SAVEPOINT attempt_pair");
      if (["waiting_user", "completed"].includes(from)) updateAttempt("running");
      if (from !== "prepared") updateAttempt(from);
      if (attemptTransitions[from]!.includes(to))
        expect(() => updateAttempt(to), `${from} -> ${to}`).not.toThrow();
      else expect(() => updateAttempt(to), `${from} -> ${to}`).toThrow();
      db.exec("ROLLBACK TO attempt_pair; RELEASE attempt_pair");
    }
  db.close();
});

it("retains committed dispatch evidence if posting the permit to main fails", async () => {
  const { store, append, raw, connections, generation } = await setup();
  value(await append("Question"));
  const provider = new DurableProvider({
    storage: store,
    context: { generation, mode: "development", connections },
    send: (text) => {
      if ((JSON.parse(text) as { kind: string }).kind === "provider_dispatch")
        throw new Error("Synthetic channel failure.");
    },
  });
  await expect(provider.pump()).rejects.toThrow("Synthetic channel failure.");
  const db = raw();
  expect(db.prepare("SELECT dispatch_permitted_at FROM attempts").pluck().get()).not.toBeNull();
  expect(db.prepare("SELECT state FROM tasks").pluck().get()).toBe("running");
  expect(value(await store.prepareTask())).toBeNull();
  db.close();
  provider.dispose();
});

it("emits only closed content-free task diagnostics after durable transactions", async () => {
  const events: DiagnosticEvent[] = [];
  const { append, prepare, result } = await setup(undefined, (event) => events.push(event));
  value(await append("PRIVATE-PROMPT-marker"));
  const dispatch = (await prepare())!;
  value(await result(dispatch, "PRIVATE-RESPONSE-marker"));
  for (const event of events) {
    const record = makeDiagnosticRecord(event, "0.0.0", "2026-11-14T00:00:00.000Z");
    expect(decodeDiagnosticEvent(event)).toEqual(event);
    expect(record).toBeDefined();
  }
  expect(events.map((event) => event.event_name)).toEqual(
    expect.arrayContaining([
      "ohtia.task.accepted",
      "ohtia.task.dispatch_permitted",
      "ohtia.task.completed",
    ]),
  );
  expect(JSON.stringify(events)).not.toMatch(
    /PRIVATE|first-model|virgilio|Development project|task-generation/,
  );
});

it("waits for catalog pages but fails an initial catalog read that ended without a model", async () => {
  const { store, append, prepare, connections, generation, raw } = await setup();
  value(await append("Question"));
  const report = (probing: boolean, revision: number | null, count = 0) =>
    connections.receive({
      kind: "connection_state",
      generation,
      snapshot: {
        connection: "chatgpt",
        state: "connected",
        reason: null,
        probing,
        probe_id: probing ? "probe" : null,
        model_list_revision: revision,
        model_count: count,
      },
    });
  report(true, null);
  expect(await prepare()).toBeNull();
  const db = raw();
  expect(db.prepare("SELECT count(*) FROM attempts").pluck().get()).toBe(0);
  report(false, 2, 1);
  expect(await prepare()).toBeNull();
  expect(db.prepare("SELECT count(*) FROM attempts").pluck().get()).toBe(0);
  report(false, null);
  expect(await prepare()).toBeNull();
  expect(
    db.prepare("SELECT state,outcome_reason,dispatch_permitted_at FROM attempts").get(),
  ).toEqual({
    state: "failed",
    outcome_reason: "provider_unavailable",
    dispatch_permitted_at: null,
  });
  expect(value(await store.readProjects())).toHaveLength(1);
  db.close();
});

it("stores observed identity and usage with the reply and handles main's output-limit result", async () => {
  const { store, append, raw, connections, generation, conversation } = await setup();
  value(await append("Question"));
  const sent: Record<string, unknown>[] = [];
  const provider = new DurableProvider({
    storage: store,
    context: { generation, mode: "development", connections },
    send: (text) => sent.push(JSON.parse(text) as Record<string, unknown>),
  });
  await provider.pump();
  const dispatch = sent.find(
    (message) => message.kind === "provider_dispatch",
  ) as unknown as ProviderDispatchMessage;
  const receive = (event: Parameters<DurableProvider["receive"]>[0]["event"]) =>
    provider.receive({
      kind: "provider_event",
      version: 1,
      generation,
      attempt: dispatch.request.attempt,
      event,
    });
  await receive({
    type: "started",
    sequence: 1,
    provider_request_id: "request-reported",
    model: "observed-model",
  });
  await receive({
    type: "usage",
    sequence: 2,
    usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 4, reasoning_tokens: null },
  });
  await receive({ type: "text", sequence: 3, text: "Kept reply" });
  await receive({
    type: "result",
    sequence: 4,
    result: { status: "failed", reason: "output_limit_exceeded", dispatched: true },
  });
  const db = raw();
  expect(
    db
      .prepare(
        "SELECT requested_model,observed_model,provider_request_id,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,state,outcome_reason FROM attempts",
      )
      .get(),
  ).toEqual({
    requested_model: "first-model",
    observed_model: "observed-model",
    provider_request_id: "request-reported",
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    state: "failed",
    outcome_reason: "output_limit_exceeded",
  });
  expect(value(await store.readMessages(conversation.id))[1]!.content).toBe("Kept reply");
  expect(db.prepare("SELECT state_revision FROM tasks").pluck().get()).toBe(5);
  db.close();
  provider.dispose();
});

it("records no document language when a task is accepted for a project still in setup", async () => {
  const { store, append, raw } = await setup();
  value(await append("Development question"));
  const project = value(
    await store.executeResearchCommand({
      command: "project.create",
      operationId: "setup-project",
      payload: {},
    }),
  ).resultId;
  const conversation = value(await store.readConversations(project))[0]!;
  value(
    await store.executeResearchCommand({
      command: "message.append",
      operationId: "setup-message",
      payload: { conversationId: conversation.id, content: "Setup question" },
    }),
  );
  const db = raw();
  const template = db.prepare("SELECT * FROM tasks").get() as Record<
    string,
    string | number | Buffer | null
  >;
  const row = {
    ...template,
    id: Buffer.from("00000000000070008000000000000001", "hex"),
    project_id: Buffer.from(project.replaceAll("-", ""), "hex"),
    conversation_id: Buffer.from(conversation.id.replaceAll("-", ""), "hex"),
    operation: "project_setup",
    document_language: null,
    accepted_by_operation_id: "setup-message",
  };
  const keys = Object.keys(row);
  const insert = db.prepare(
    `INSERT INTO tasks (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  );
  // The operation catalog grows with its owning story; SQLite enforces the fixed language rule.
  expect(() => insert.run(...Object.values({ ...row, document_language: "en" }))).toThrow();
  insert.run(...Object.values(row));
  expect(
    db.prepare("SELECT document_language FROM tasks WHERE operation='project_setup'").pluck().get(),
  ).toBeNull();
  db.close();
});

function taskId(db: ReturnType<ReturnType<typeof storageFixture>["raw"]>, state?: string): string {
  const row = db
    .prepare(`SELECT id FROM tasks ${state ? "WHERE state=?" : ""} ORDER BY rowid DESC LIMIT 1`)
    .get(...(state ? [state] : [])) as { id: Buffer };
  const h = row.id.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

describe("reply control and partial provenance", () => {
  it.each(["queued", "blocked"] as const)(
    "stops a %s task without creating an attempt and replays its receipt",
    async (state) => {
      const f = await setup();
      value(await f.append("Question"));
      const db = f.raw();
      if (state === "blocked")
        db.exec(
          "UPDATE tasks SET state='blocked',blocking_reason='restart_paused',state_revision=state_revision+1",
        );
      const id = taskId(db);
      const command = {
        command: "task.stop" as const,
        operationId: "stop",
        payload: { taskId: id },
      };
      expect(value(await f.store.executeResearchCommand(command)).resultId).toBe(id);
      const revision = db.prepare("SELECT state_revision FROM tasks").pluck().get();
      value(await f.store.executeResearchCommand(command));
      expect(
        db.prepare("SELECT state,state_revision,charge_warning_accepted_at FROM tasks").get(),
      ).toEqual({ state: "cancelled", state_revision: revision, charge_warning_accepted_at: null });
      expect(db.prepare("SELECT count(*) FROM attempts").pluck().get()).toBe(0);
      expect(await f.prepare()).toBeNull();
      db.close();
    },
  );
  it.each([true, false])(
    "serializes Stop and completion with completionFirst=%s",
    async (completionFirst) => {
      const f = await setup();
      value(await f.append("Question"));
      const dispatch = (await f.prepare())!;
      const db = f.raw();
      const id = taskId(db);
      const stop = () =>
        f.store.executeResearchCommand({
          command: "task.stop",
          operationId: "stop-race",
          payload: { taskId: id },
        });
      if (completionFirst) {
        value(await f.result(dispatch, "Reply"));
        value(await stop());
      } else {
        value(await stop());
        expect(db.prepare("SELECT state FROM tasks").pluck().get()).toBe("cancelling");
        expect(db.prepare("SELECT state FROM attempts").pluck().get()).toBe("stopping");
        value(await f.result(dispatch, "Reply"));
      }
      const messages = value(await f.store.readMessages(f.conversation.id));
      expect(messages).toHaveLength(2);
      expect(messages[1]!.ending).toBe(completionFirst ? "complete" : "partial");
      expect(db.prepare("SELECT state FROM tasks").pluck().get()).toBe(
        completionFirst ? "completed" : "cancelled",
      );
      expect(db.prepare("SELECT outcome_reason FROM attempts").pluck().get()).toBe(
        completionFirst ? null : "cancelled_by_researcher",
      );
      const before = db.prepare("SELECT state_revision FROM tasks").pluck().get();
      expect(value(await f.result(dispatch, "Late reply"))).toEqual({ recorded: false });
      expect(db.prepare("SELECT state_revision FROM tasks").pluck().get()).toBe(before);
      db.close();
    },
  );
  it("starts the latest uncertain reply again once, preserving its cutoff and accepted warning", async () => {
    const f = await setup();
    value(await f.append("Question"));
    const first = (await f.prepare())!;
    const db = f.raw();
    const old = taskId(db);
    value(
      await f.store.recordTaskEvent(
        first.request.attempt,
        { type: "result", sequence: 1, result: { status: "uncertain", reason: "connection_lost" } },
        "Partial",
      ),
    );
    const command = {
      command: "task.startAgain" as const,
      operationId: "again",
      payload: { taskId: old },
    };
    const replacement = value(await f.store.executeResearchCommand(command));
    expect(value(await f.store.executeResearchCommand(command))).toEqual(replacement);
    const records = db
      .prepare(
        "SELECT state,input_through_position,charge_warning_accepted_at,created_at FROM tasks ORDER BY rowid",
      )
      .all() as {
      state: string;
      input_through_position: number;
      charge_warning_accepted_at: string | null;
      created_at: string;
    }[];
    expect(records.map((t) => t.state)).toEqual(["uncertain", "queued"]);
    expect(records[1]!.input_through_position).toBe(1);
    expect(records[1]!.charge_warning_accepted_at).toBe(records[1]!.created_at);
    expect(records[1]!.charge_warning_accepted_at).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );
    expect((await f.prepare())!.request.input).toEqual([{ role: "user", text: "Question" }]);
    expect(value(await f.store.readMessages(f.conversation.id))[1]!.ending).toBe("partial");
    db.close();
  });
  it("rejects non-retryable, superseded and over-cap replacements without changing any record", async () => {
    const f = await setup();
    value(await f.append("Question"));
    const db = f.raw();
    const old = taskId(db);
    const again = (op: string) =>
      f.store.executeResearchCommand({
        command: "task.startAgain",
        operationId: op,
        payload: { taskId: old },
      });
    const snapshot = () =>
      JSON.stringify([
        db.prepare("SELECT * FROM tasks").all(),
        db.prepare("SELECT * FROM attempts").all(),
        db.prepare("SELECT * FROM command_receipts").all(),
        db.prepare("SELECT revision FROM conversations").all(),
      ]);
    let before = snapshot();
    expect(await again("not-uncertain")).toMatchObject({
      error: { code: "task_not_retryable", nextAction: "check_request" },
    });
    expect(snapshot()).toBe(before);
    const first = (await f.prepare())!;
    value(
      await f.store.recordTaskEvent(
        first.request.attempt,
        { type: "result", sequence: 1, result: { status: "uncertain", reason: "connection_lost" } },
        "",
      ),
    );
    for (let n = 0; n < 20; n++) value(await f.start(`Pending ${n}`));
    before = snapshot();
    expect(await again("at-cap")).toMatchObject({ error: { code: "pending_limit_reached" } });
    expect(snapshot()).toBe(before);
    value(
      await f.store.executeResearchCommand({
        command: "task.stop",
        operationId: "free-pending",
        payload: { taskId: taskId(db, "queued") },
      }),
    );
    value(await f.append("Newer question"));
    before = snapshot();
    expect(await again("superseded")).toMatchObject({
      error: { code: "newer_task_exists", nextAction: "refresh_record" },
    });
    expect(snapshot()).toBe(before);
    db.close();
  });
  it.each([
    ["cancelled_by_researcher", "The researcher stopped it before it finished."],
    ["deadline_exceeded", "It was cut off because it took longer than Ohtia allows for one reply."],
    ["inactivity_timeout", "It was cut off because the service sent nothing for too long."],
    [
      "output_limit_exceeded",
      "It was cut off because it was longer than Ohtia allows for one reply.",
    ],
    ["provider_error", "It was cut off because the service reported an error."],
    ["provider_unavailable", "It was cut off because the service reported an error."],
    [
      "invalid_output",
      "It was cut off because Ohtia couldn't read the rest of the service's reply.",
    ],
    ["connection_lost", "It was cut off because the connection to the service was lost."],
    ["request_rejected", ""],
  ] as const)(
    "adds the exact %s note immediately after the immutable partial message",
    async (reason, ending) => {
      const f = await setup();
      value(await f.append("Question"));
      const first = (await f.prepare())!;
      const result =
        reason === "connection_lost"
          ? { status: "uncertain" as const, reason }
          : reason === "cancelled_by_researcher"
            ? { status: "cancelled" as const }
            : { status: "failed" as const, reason, dispatched: true as const };
      value(
        await f.store.recordTaskEvent(
          first.request.attempt,
          { type: "result", sequence: 1, result },
          "Partial",
        ),
      );
      value(await f.append("Continue"));
      const next = (await f.prepare())!;
      expect(next.request.input).toEqual([
        { role: "user", text: "Question" },
        { role: "assistant", text: "Partial" },
        {
          role: "user",
          text: `Note from Ohtia: Virgilio's reply above is incomplete.${ending ? ` ${ending}` : ""}`,
        },
        { role: "user", text: "Continue" },
      ]);
      const db = f.raw();
      const manifest = JSON.parse(
        db
          .prepare("SELECT transfer_manifest FROM attempts ORDER BY rowid DESC LIMIT 1")
          .pluck()
          .get() as string,
      ) as unknown[];
      expect(manifest).toContainEqual({
        kind: "note",
        note: "partial_reply",
        reference: value(await f.store.readMessages(f.conversation.id))[1]!.id,
        revision: 1,
      });
      expect(db.prepare("SELECT ending FROM messages ORDER BY position").all()).toEqual([
        { ending: null },
        { ending: "partial" },
        { ending: null },
      ]);
      db.close();
    },
  );
  it("keeps unknown usage after a cut and saves no empty partial", async () => {
    const f = await setup();
    value(await f.append("Question"));
    const first = (await f.prepare())!;
    value(
      await f.store.recordTaskEvent(
        first.request.attempt,
        {
          type: "usage",
          sequence: 1,
          usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 2, reasoning_tokens: 0 },
        },
        "",
      ),
    );
    value(
      await f.store.recordTaskEvent(
        first.request.attempt,
        { type: "result", sequence: 2, result: { status: "cancelled" } },
        "",
      ),
    );
    const db = f.raw();
    expect(db.prepare("SELECT input_tokens,output_tokens FROM attempts").get()).toEqual({
      input_tokens: null,
      output_tokens: null,
    });
    expect(value(await f.store.readMessages(f.conversation.id))).toHaveLength(1);
    db.close();
  });
});

/** Build the exact prior schema, retaining its task/attempt data, without altering published modules. */
async function sourceNine(f: Awaited<ReturnType<typeof setup>>): Promise<void> {
  await f.store.close();
  const db = f.raw();
  db.exec(
    "DROP TRIGGER messages_ending; DROP TRIGGER receipts_commands; DROP TRIGGER tasks_charge_initial; DROP TRIGGER tasks_charge_changes; ALTER TABLE messages DROP COLUMN ending; ALTER TABLE tasks DROP COLUMN charge_warning_accepted_at; DELETE FROM kysely_migration WHERE name='0010_reply_control'; DELETE FROM ohtia_migration_artifacts WHERE name='0010_reply_control'; PRAGMA user_version=9",
  );
  db.close();
}
function recoveryGate(f: Awaited<ReturnType<typeof setup>>): string {
  const gate = path.join(f.root, "migration-pending.json");
  fs.writeFileSync(
    gate,
    JSON.stringify({ version: 1, operation: "synthetic-recovery", source: 9, target: 10 }),
  );
  return gate;
}

describe("reply-control migration and shared recovery handoff", () => {
  it("backfills complete and partial agent endings and enforces the author contract", async () => {
    const f = await setup();
    value(await f.append("First"));
    const first = (await f.prepare())!;
    value(await f.result(first, "Complete"));
    value(await f.append("Second"));
    const second = (await f.prepare())!;
    value(
      await f.store.recordTaskEvent(
        second.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", reason: "provider_error", dispatched: true },
        },
        "Partial",
      ),
    );
    await sourceNine(f);
    await f.store.open();
    const db = f.raw();
    expect(db.prepare("SELECT ending FROM messages ORDER BY position").all()).toEqual([
      { ending: null },
      { ending: "complete" },
      { ending: null },
      { ending: "partial" },
    ]);
    // Endings are not an unconstrained presentation annotation.
    const insert = db.prepare(
      "INSERT INTO messages(id,conversation_id,position,author_kind,agent_id,task_id,content,created_at,ending) SELECT ?,conversation_id,position+10,author_kind,agent_id,task_id,content,created_at,? FROM messages WHERE author_kind='researcher' LIMIT 1",
    );
    expect(() =>
      insert.run(Buffer.from("0000000000007000800000000000000f", "hex"), "complete"),
    ).toThrow(/ending/);
    expect(() => db.exec("UPDATE messages SET ending=NULL WHERE author_kind='agent'")).toThrow();
    db.close();
  });
  it("does not pause eligible tasks for a healthy upgrade's fresh gate", async () => {
    const f = await setup();
    value(await f.append("Pending"));
    await sourceNine(f);
    await f.store.open();
    const db = f.raw();
    expect(db.prepare("SELECT state,blocking_reason FROM tasks").get()).toEqual({
      state: "queued",
      blocking_reason: null,
    });
    expect(await f.prepare()).not.toBeNull();
    db.close();
  });
  it.each(["source", "target"] as const)(
    "holds %s recovery work across startup, reconnection and coalescing until Continue all",
    async (kind) => {
      const f = await setup();
      value(await f.append("Pending"));
      if (kind === "source") await sourceNine(f);
      else await f.store.close();
      const gate = recoveryGate(f);
      await f.store.retry();
      expect(fs.existsSync(gate)).toBe(false);
      expect(await f.prepare()).toBeNull();
      await f.store.close();
      await f.store.open();
      expect(await f.prepare()).toBeNull();
      value(await f.append("Newer pending"));
      expect(await f.prepare()).toBeNull();
      const db = f.raw();
      expect(
        db.prepare("SELECT blocking_reason FROM tasks WHERE state='blocked'").pluck().get(),
      ).toBe("restart_paused");
      const command = {
        command: "task.continueAll" as const,
        operationId: "continue",
        payload: {},
      };
      value(await f.store.executeResearchCommand(command));
      value(await f.store.executeResearchCommand(command));
      expect(await f.prepare()).not.toBeNull();
      value(
        await f.store.executeResearchCommand({
          command: "task.continueAll",
          operationId: "continue-empty",
          payload: {},
        }),
      );
      expect(
        db
          .prepare("SELECT count(*) FROM command_receipts WHERE command='task.continueAll'")
          .pluck()
          .get(),
      ).toBe(2);
      db.close();
    },
  );
  it.each(["undispatched", "dispatched", "cancelling"] as const)(
    "classifies an unfinished %s attempt during migration recovery",
    async (kind) => {
      const f = await setup();
      value(await f.append("Pending"));
      await f.prepare();
      const db = f.raw();
      if (kind === "undispatched") {
        const trigger = (
          db.prepare("SELECT sql FROM sqlite_schema WHERE name='attempts_changes'").get() as {
            sql: string;
          }
        ).sql;
        db.exec(
          "DROP TRIGGER attempts_changes; UPDATE attempts SET state='prepared',dispatch_permitted_at=NULL,transfer_manifest=NULL,requested_model=NULL,started_at=NULL",
        );
        db.exec(trigger);
      }
      if (kind === "cancelling")
        value(
          await f.store.executeResearchCommand({
            command: "task.stop",
            operationId: "stop-before-recovery",
            payload: { taskId: taskId(db) },
          }),
        );
      db.close();
      await sourceNine(f);
      recoveryGate(f);
      await f.store.retry();
      const after = f.raw();
      expect(after.prepare("SELECT state FROM tasks").pluck().get()).toBe(
        kind === "dispatched" ? "uncertain" : kind === "cancelling" ? "cancelled" : "blocked",
      );
      expect(after.prepare("SELECT state,outcome_reason FROM attempts").get()).toEqual({
        state: kind === "dispatched" ? "uncertain" : "cancelled",
        outcome_reason: kind === "cancelling" ? "cancelled_by_researcher" : "service_restarted",
      });
      expect(await f.prepare()).toBeNull();
      if (kind === "undispatched") {
        value(
          await f.store.executeResearchCommand({
            command: "task.continueAll",
            operationId: "continue-unsent",
            payload: {},
          }),
        );
        expect(await f.prepare()).not.toBeNull();
        expect(after.prepare("SELECT count(*) FROM attempts").pluck().get()).toBe(2);
      }
      after.close();
    },
  );
  it("retains the gate on a pre-commit recovery failure and durable holds on a post-commit failure", async () => {
    const f = await setup();
    value(await f.append("Pending"));
    await sourceNine(f);
    const gate = recoveryGate(f);
    const review = vi
      .spyOn(
        f.store as unknown as { holdRecoveredTasks: () => Promise<void> },
        "holdRecoveredTasks",
      )
      .mockRejectedValueOnce(new Error("Synthetic crash before hold commit"));
    await expect(f.store.retry()).rejects.toThrow();
    expect(fs.existsSync(gate)).toBe(true);
    review.mockRestore();
    const unlink = fs.unlinkSync;
    const fail = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (String(file) === gate) throw new Error("Synthetic crash after hold commit");
      unlink(file);
    });
    await expect(f.store.retry()).rejects.toThrow();
    expect(fs.existsSync(gate)).toBe(true);
    const db = f.raw();
    expect(db.prepare("SELECT blocking_reason FROM tasks").pluck().get()).toBe("restart_paused");
    db.close();
    fail.mockRestore();
    await f.store.retry();
    expect(fs.existsSync(gate)).toBe(false);
    expect(await f.prepare()).toBeNull();
  });
  it("keeps restoration gated across exit and pauses the restored tasks only after Retry", async () => {
    const f = await setup();
    value(await f.append("Pending"));
    await sourceNine(f);
    const unlink = fs.unlinkSync;
    const fail = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (String(file).endsWith("migration-pending.json"))
        throw new Error("Synthetic lost acknowledgement");
      unlink(file);
    });
    await expect(f.store.open()).rejects.toThrow();
    fail.mockRestore();
    const operations = fs
      .readdirSync(path.join(f.root, "recovery/migrations"))
      .filter((name) => !name.includes("."));
    const operation = operations.find((name) => {
      const m = JSON.parse(
        fs.readFileSync(path.join(f.root, "recovery/migrations", name, "manifest.json"), "utf8"),
      ) as { sourceRevision: number };
      return m.sourceRevision === 9;
    })!;
    await f.store.restore(operation);
    await f.store.close();
    await expect(f.store.open()).rejects.toThrow(/recovery/);
    await f.store.retry();
    expect(await f.prepare()).toBeNull();
    value(
      await f.store.executeResearchCommand({
        command: "task.continueAll",
        operationId: "continue-restored",
        payload: {},
      }),
    );
    expect(await f.prepare()).not.toBeNull();
  });
});

it.each(["stop", "start-again", "continue-all"] as const)(
  "routes the development %s action through the same durable command boundary",
  async (name) => {
    const f = await setup();
    value(await f.append("Question"));
    const sent: Record<string, unknown>[] = [];
    const provider = new DurableProvider({
      storage: f.store,
      context: { generation: f.generation, mode: "development", connections: f.connections },
      send: (text) => sent.push(JSON.parse(text) as Record<string, unknown>),
    });
    const db = f.raw();
    const id = taskId(db);
    if (name === "continue-all")
      db.exec(
        "UPDATE tasks SET state='blocked',blocking_reason='restart_paused',state_revision=state_revision+1",
      );
    else {
      await provider.pump();
      const dispatch = sent.find(
        (m) => m.kind === "provider_dispatch",
      ) as unknown as ProviderDispatchMessage;
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation: f.generation,
        attempt: dispatch.request.attempt,
        event: { type: "text", sequence: 1, text: "Partial" },
      });
      if (name === "start-again")
        await provider.receive({
          kind: "provider_event",
          version: 1,
          generation: f.generation,
          attempt: dispatch.request.attempt,
          event: {
            type: "result",
            sequence: 2,
            result: { status: "uncertain", reason: "connection_lost" },
          },
        });
    }
    await provider.developmentAction({
      kind: "development_action",
      version: 1,
      generation: f.generation,
      action:
        name === "continue-all"
          ? { name, operation_id: "development-control" }
          : { name, operation_id: "development-control", task: id },
    });
    expect(
      db
        .prepare("SELECT command FROM command_receipts WHERE operation_id='development-control'")
        .pluck()
        .get(),
    ).toBe(
      name === "stop"
        ? "task.stop"
        : name === "start-again"
          ? "task.startAgain"
          : "task.continueAll",
    );
    if (name === "stop") {
      expect(sent.some((m) => m.kind === "provider_interrupt")).toBe(true);
      const first = sent.find(
        (m) => m.kind === "provider_dispatch",
      ) as unknown as ProviderDispatchMessage;
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation: f.generation,
        attempt: first.request.attempt,
        event: { type: "result", sequence: 2, result: { status: "cancelled" } },
      });
      expect(value(await f.store.readMessages(f.conversation.id))[1]!.ending).toBe("partial");
    } else
      expect(db.prepare("SELECT state FROM tasks ORDER BY rowid DESC LIMIT 1").pluck().get()).toBe(
        "running",
      );
    db.close();
    provider.dispose();
  },
);

it("interrupts a committed Stop even when its commit acknowledgement was lost", async () => {
  const f = await setup();
  value(await f.append("Question"));
  const sent: Record<string, unknown>[] = [];
  const provider = new DurableProvider({
    storage: f.store,
    context: { generation: f.generation, mode: "development", connections: f.connections },
    send: (text) => sent.push(JSON.parse(text) as Record<string, unknown>),
  });
  await provider.pump();
  const db = f.raw();
  const id = taskId(db);
  const original = Database.prototype.prepare;
  let fail = true;
  const spy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (query, ...args) {
    const statement = original.call(this, query, ...args);
    if (query === "COMMIT") {
      const run = statement.run.bind(statement);
      statement.run = (...bindings: unknown[]) => {
        const result = run(...bindings);
        if (fail) {
          fail = false;
          throw new Error("Synthetic lost Stop acknowledgement");
        }
        return result;
      };
    }
    return statement;
  });
  try {
    await provider.developmentAction({
      kind: "development_action",
      version: 1,
      generation: f.generation,
      action: { name: "stop", operation_id: "lost-stop", task: id },
    });
  } finally {
    spy.mockRestore();
  }
  expect(db.prepare("SELECT state FROM tasks").pluck().get()).toBe("cancelling");
  expect(sent.some((m) => m.kind === "provider_interrupt")).toBe(true);
  expect(sent).toContainEqual(
    expect.objectContaining({
      kind: "development_report",
      report: { type: "refused", reason: "uncertain" },
    }),
  );
  db.close();
  provider.dispose();
});

it.each(["running", "cancelling"] as const)(
  "stops a persisted %s task whose previous generation already closed its connection",
  async (state) => {
    const f = await setup();
    value(await f.append("Question"));
    await f.prepare();
    const db = f.raw();
    const id = taskId(db);
    if (state === "cancelling")
      value(
        await f.store.executeResearchCommand({
          command: "task.stop",
          operationId: "old-stop",
          payload: { taskId: id },
        }),
      );
    const before = db.prepare("SELECT state_revision FROM tasks").pluck().get() as number;
    f.store.setTaskContext({
      generation: "replacement-generation",
      mode: "development",
      connections: f.connections,
    });
    value(
      await f.store.executeResearchCommand({
        command: "task.stop",
        operationId: "stop-closed-generation",
        payload: { taskId: id },
      }),
    );
    expect(db.prepare("SELECT state,state_revision FROM tasks").get()).toEqual({
      state: "cancelled",
      state_revision: before + 1,
    });
    expect(db.prepare("SELECT state,outcome_reason FROM attempts").get()).toEqual({
      state: "cancelled",
      outcome_reason: "cancelled_by_researcher",
    });
    value(await f.append("New question"));
    expect(await f.prepare()).not.toBeNull();
    db.close();
  },
);

it("captures the project's current language when an uncertain reply is accepted again", async () => {
  const f = await setup();
  value(await f.append("Question"));
  const first = (await f.prepare())!;
  const db = f.raw();
  const id = taskId(db);
  value(
    await f.store.recordTaskEvent(
      first.request.attempt,
      { type: "result", sequence: 1, result: { status: "uncertain", reason: "connection_lost" } },
      "Partial",
    ),
  );
  db.exec("UPDATE projects SET document_language='es'");
  value(
    await f.store.executeResearchCommand({
      command: "task.startAgain",
      operationId: "again-language",
      payload: { taskId: id },
    }),
  );
  expect((await f.prepare())!.request.document_language).toBe("es");
  expect(db.prepare("SELECT document_language FROM tasks ORDER BY rowid").all()).toEqual([
    { document_language: "en" },
    { document_language: "es" },
  ]);
  db.close();
});
