import { describe, expect, it } from "vitest";
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
import { storageFixture, stores } from "./fixtures/storage.js";
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

  it("runs three conversations while a fourth waits and an uncertain attempt retains its slot", async () => {
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
    expect(await prepare()).toBeNull();
    const db = raw();
    expect(db.prepare("SELECT count(*) FROM tasks WHERE state='running'").pluck().get()).toBe(2);
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

  it("interrupts output over the shared byte budget and saves only a whole-code-point prefix", async () => {
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
    const messages = value(await store.readMessages(conversation.id));
    expect(messages[1]!.content).toBe("x".repeat(16380) + "🐈");
    const db = raw();
    expect(db.prepare("SELECT state,outcome_reason FROM attempts").get()).toEqual({
      state: "failed",
      outcome_reason: "output_limit_exceeded",
    });
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
  });
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
    ).toBe(false);
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
        "DROP INDEX messages_task; DROP TRIGGER messages_reservation; DROP TRIGGER messages_position; DROP TABLE usage_limit_pauses; DELETE FROM kysely_migration WHERE name='0009_usage_limit_pauses'; DELETE FROM ohtia_migration_artifacts WHERE name='0009_usage_limit_pauses'; DROP TABLE attempts; DROP TABLE tasks; ALTER TABLE messages DROP COLUMN task_id",
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
      expect(upgraded.pragma("user_version", { simple: true })).toBe(9);
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
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 4,
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
