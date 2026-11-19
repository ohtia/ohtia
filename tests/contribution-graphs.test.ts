import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { objects as limitsObjects } from "../packages/utility/src/migrations/0023_shared_work_limits.mjs";
import {
  failure,
  isResearchOperation,
  policyId,
  researchInput,
  researchOutput,
  type AddContributionsPayload,
  type PlanContributionRequest,
  type ProviderResult,
  type ResearchCommand,
} from "../packages/contracts/src/index.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { objects as taskObjects } from "../packages/utility/src/migrations/0008_durable_ai_tasks.mjs";
import { objects as replyObjects } from "../packages/utility/src/migrations/0010_reply_control.mjs";
import {
  consultationTasks,
  objects as consultationObjects,
  tables as consultationTables,
} from "../packages/utility/src/migrations/0021_consultations.mjs";
import { bytes, identifier } from "../packages/utility/src/research.js";
import type { PreparedTask } from "../packages/utility/src/tasks.js";
import { proposeSetup, setupConnections, successful as value } from "./fixtures/project-setup.js";
import { dispatchThrough } from "./fixtures/provider-conformance.js";
import { dropWorkLimitsSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { storageFixture } from "./fixtures/storage.js";

const unresolved = "The primary question remains unresolved because the sample is too small.";
const task = (
  planKey: string,
  options: Partial<PlanContributionRequest> = {},
): PlanContributionRequest => ({
  planKey,
  agent: "josefa",
  request: `Investigate ${planKey}.`,
  reason: "Separate work with a recorded purpose.",
  prerequisites: [],
  ...options,
});

async function fixture(limit = 3) {
  const f = storageFixture();
  await f.store.open();
  f.store.setTaskContext({
    generation: "setup-tests",
    mode: "development",
    connections: setupConnections(),
  });
  value(await f.store.replaceExecutionLimits({ operationId: "set-limit", value: limit }));
  const run = (command: ResearchCommand) => f.store.executeResearchCommand(command);
  const project = value(
    await run({ command: "development.createProject", operationId: "create", payload: {} }),
  );
  const [conversation] = value(await f.store.readConversations(project.resultId));
  const conversationId = conversation!.id;
  const newPlan = (contributions: readonly PlanContributionRequest[]) => ({
    conversationId,
    expectedGraphVersion: 0 as const,
    purpose: "Which questions remain open?",
    sharedContext: "Synthetic survey",
    contributions,
  });
  const add = (operationId: string, payload: AddContributionsPayload) =>
    run({ command: "plan.addContributions", operationId, payload });
  const finish = (planId: string, operationId = "finish") =>
    run({ command: "plan.finish", operationId, payload: { planId } });
  const query = (sql: string, id?: string) => {
    const db = f.raw();
    try {
      return db.prepare(sql).all(...(id ? [bytes(id)] : []));
    } finally {
      db.close();
    }
  };
  const states = (id: string) =>
    query(
      `SELECT c.plan_key AS key,c.state,c.failure_reason AS failure, root.plan_key AS blocker
    FROM contributions c LEFT JOIN contributions root ON root.id=c.blocked_by_contribution_id
    WHERE c.intervention_id=? ORDER BY c.rowid`,
      id,
    ).map(({ key, state, blocker, failure }) => [key, state, blocker, failure]);
  const prepare = () => f.store.prepareTask().then(value);
  const next = async (): Promise<PreparedTask> => {
    const prepared = await prepare();
    if (!prepared) throw new Error("Expected work to dispatch.");
    return prepared;
  };
  const settle = (
    prepared: PreparedTask,
    result: ProviderResult = { status: "completed" },
    text = "",
  ) =>
    f.store
      .recordTaskEvent(
        prepared.dispatch.request.attempt,
        { type: "result", sequence: 1, result },
        text,
      )
      .then(value);
  const resolve = (agent: "josefa" | "virgilio", connection: string) =>
    f.store.setTaskContext({
      generation: "setup-tests",
      mode: "development",
      connections: setupConnections(),
      resolveAgentConnection: (id) => (id === agent ? connection : "chatgpt"),
    });
  return {
    ...f,
    run,
    projectId: project.resultId,
    conversationId,
    newPlan,
    add,
    finish,
    query,
    states,
    prepare,
    next,
    settle,
    resolve,
  };
}

it("validates changes before creating rows, receipts or work and replays the accepted request", async () => {
  const f = await fixture();
  const parent = task("parent");
  const cases = [
    ["empty_plan", { contributions: [] }],
    ["purpose_empty", { purpose: "  " }],
    ["purpose_too_long", { purpose: "🌳".repeat(2001) }],
    ["shared_context_too_large", { sharedContext: "é".repeat(16385) }],
    ["plan_key_invalid", { contributions: [task("Invalid")] }],
    ["plan_key_duplicate", { contributions: [parent, parent] }],
    ["request_empty", { contributions: [task("root", { request: " " })] }],
    ["request_too_large", { contributions: [task("root", { request: "é".repeat(4097) })] }],
    ["self_dependency", { contributions: [task("root", { prerequisites: ["root"] })] }],
    ["unknown_prerequisite", { contributions: [task("root", { prerequisites: ["absent"] })] }],
    [
      "cycle",
      {
        contributions: [
          task("first", { prerequisites: ["second"] }),
          task("second", { prerequisites: ["first"] }),
        ],
      },
    ],
    ["agent_unavailable", { contributions: [task("root", { agent: "unsupported" })] }],
    [
      "duplicate_contribution",
      { contributions: [parent, task("duplicate", { request: parent.request })] },
    ],
  ] as const;
  for (const [code, fields] of cases)
    expect(await f.add(code, { ...f.newPlan([parent]), ...fields })).toEqual(failure(code));
  for (const table of [
    "interventions",
    "contributions",
    "contribution_dependencies",
    "graph_changes",
    "tasks",
  ])
    expect(f.query(`SELECT id FROM ${table}`)).toEqual([]);
  expect(
    f.query("SELECT command FROM command_receipts WHERE command='plan.addContributions'"),
  ).toEqual([]);

  const initial = f.newPlan([parent]);
  const accepted = value(await f.add("accept", initial));
  expect(value(await f.add("accept", initial))).toEqual(accepted);
  expect(await f.add("accept", { ...initial, purpose: "Changed" })).toEqual(
    failure("operation_conflict"),
  );
  expect(f.query("SELECT graph_version,decided_by_operation_id FROM interventions")).toEqual([
    { graph_version: 1, decided_by_operation_id: "accept" },
  ]);
  const digest = createHash("sha256")
    .update(
      '{"agent":"josefa","operation":"development_test","policyVersion":2,"prerequisites":[],"request":"Investigate parent."}',
    )
    .digest("hex")
    .toUpperCase();
  expect(f.query("SELECT hex(dedupe_key) AS hash FROM contributions")).toEqual([{ hash: digest }]);
  const change = {
    planId: accepted.resultId,
    expectedGraphVersion: 1,
    contributions: [task("child", { prerequisites: ["parent"] })],
  };
  const simultaneous = await Promise.all([
    f.add("change-one", change),
    f.add("change-two", change),
  ]);
  expect(simultaneous.filter(({ ok }) => ok)).toHaveLength(1);
  expect(await f.add("stale", change)).toEqual(failure("graph_version_conflict"));
  expect(
    await f.add("duplicate", {
      ...change,
      expectedGraphVersion: 2,
      contributions: [
        task("other", { request: change.contributions[0]!.request, prerequisites: ["parent"] }),
      ],
    }),
  ).toEqual(failure("duplicate_contribution"));
  expect(f.query("SELECT plan_key FROM contributions ORDER BY rowid")).toEqual([
    { plan_key: "parent" },
    { plan_key: "child" },
  ]);
  const parentTask = await f.next();
  await f.settle(parentTask, undefined, unresolved);
  const childTask = await f.next();
  expect(childTask.acceptedByOperationId).toBe("accept");
  expect(childTask.dispatch.request.input.at(-1)?.text).toContain(unresolved);
});

it.each([1, 3])(
  "applies concurrency limit %s, waits without tasks and preserves full prerequisite text",
  async (limit) => {
    const f = await fixture(limit);
    const { resultId } = value(
      await f.add(
        "parallel",
        f.newPlan([
          task("one"),
          task("two"),
          task("three", { required: false }),
          task("review", { agent: "virgilio", prerequisites: ["two", "one"] }),
        ]),
      ),
    );
    expect(f.states(resultId)).toEqual([
      ["one", "active", null, null],
      ["two", "active", null, null],
      ["three", "active", null, null],
      ["review", "waiting", null, null],
    ]);
    expect(await f.finish(resultId, "early")).toEqual(failure("plan_state_changed"));
    const first = await f.next();
    const second = limit === 3 ? await f.next() : null;
    const optional = limit === 3 ? await f.next() : null;
    expect(await f.prepare()).toBeNull();
    const fake = createFakeProvider({
      send: async (_request, control) => {
        expect(control.release()).toBe(true);
        control.emit({ type: "text", text: unresolved });
        control.emit({ type: "result", result: { status: "completed" } });
      },
    });
    const events = await dispatchThrough(
      { snapshot: () => ({ state: "connected" }) } as Parameters<typeof dispatchThrough>[0],
      {
        ...fake,
        declaration: {
          ...fake.declaration,
          connection: { ...fake.declaration.connection, id: "chatgpt" },
        },
      },
      first.dispatch.request,
    );
    const result = events.find((event) => event.type === "result");
    if (!result) throw new Error("Fake provider produced no result.");
    await f.settle(first, result.result, unresolved);
    await f.settle(second ?? (await f.next()), undefined, "The second source is still unverified.");
    const uncertain = { status: "uncertain", reason: "connection_lost" } as const;
    if (limit === 1) await f.settle(await f.next(), uncertain);
    const review = await f.next();
    expect(review.kind).toBe("contribution");
    expect(review.dispatch.request.instructions).toContain("Working title: Development project");
    expect(review.dispatch.request.input.map(({ text }) => text)).toEqual([
      "This request comes from a plan by Virgilio, the research guide. The researcher approved it and cannot answer questions in this reply.\n\nContext for every contribution of the plan:\nSynthetic survey\n\nYour contribution (review):\nInvestigate review.",
      `Result of contribution one by Josefa, the reference librarian:\n${unresolved}`,
      "Result of contribution two by Josefa, the reference librarian:\nThe second source is still unverified.",
    ]);
    await f.settle(review, undefined, unresolved);
    expect(
      f.query(
        "SELECT m.agent_id FROM messages m JOIN tasks t ON t.id=m.task_id WHERE t.kind='contribution' ORDER BY m.position",
      ),
    ).toEqual([{ agent_id: "josefa" }, { agent_id: "josefa" }, { agent_id: "virgilio" }]);
    if (optional) {
      expect(await f.finish(resultId, "still-running")).toEqual(failure("plan_state_changed"));
      await f.settle(optional, uncertain);
    }
    expect(value(await f.finish(resultId))).toEqual({ resultId, outcome: "complete" });
    expect(f.states(resultId)).toContainEqual(["three", "uncertain", null, null]);
    expect(f.query("SELECT finished_by_operation_id FROM interventions")).toEqual([
      { finished_by_operation_id: null },
    ]);
    expect(f.query("SELECT COUNT(*) AS count FROM project_setup_proposals")).toEqual([
      { count: 0 },
    ]);
  },
);

it("propagates optional failure, reopens the chain on retry and retains roots when finished", async () => {
  const f = await fixture();
  const { resultId } = value(
    await f.add(
      "chain",
      f.newPlan([
        task("root", { required: false }),
        task("child", { prerequisites: ["root"] }),
        task("leaf", { prerequisites: ["child"] }),
        task("separate"),
      ]),
    ),
  );
  const root = await f.next();
  const separate = await f.next();
  await f.settle(root, { status: "failed", dispatched: true, reason: "provider_error" });
  expect(f.states(resultId)).toContainEqual(["leaf", "blocked", "root", null]);
  await f.settle(separate, undefined, unresolved);
  const retry = {
    command: "contribution.tryAgain",
    operationId: "retry",
    payload: { taskId: root.taskId },
  } as const;
  const { resultId: replacement } = value(await f.run(retry));
  expect(f.states(resultId)).toContainEqual(["leaf", "waiting", null, null]);
  const again = await f.next();
  expect(again.taskId).toBe(replacement);
  expect(again.acceptedByOperationId).toBe("retry");
  await f.settle(again, { status: "failed", dispatched: true, reason: "not_eligible" });
  const blocked = f.states(resultId);
  expect(blocked).toContainEqual(["leaf", "blocked", "root", null]);
  const denied = { ...retry, operationId: "denied", payload: { taskId: replacement } };
  expect(await f.run(denied)).toEqual(failure("task_not_retryable"));
  expect(value(await f.finish(resultId))).toEqual({ resultId, outcome: "partial" });
  expect(value(await f.finish(resultId))).toEqual({ resultId, outcome: "partial" });
  expect(value(await f.finish(resultId, "finish-again"))).toEqual({ resultId, outcome: "partial" });
  expect(f.states(resultId)).toEqual(blocked);
  expect(await f.run({ ...retry, operationId: "after-finish" })).toEqual(
    failure("task_not_retryable"),
  );
});

it("blocks on cancellation and fails overlong dependent input before creating a task", async () => {
  const f = await fixture();
  const plan = value(
    await f.add(
      "cancel-plan",
      f.newPlan([task("root"), task("dependent", { prerequisites: ["root"] })]),
    ),
  );
  const root = await f.next();
  expect(
    await f.run({
      command: "task.stop",
      operationId: "stop-task",
      payload: { taskId: root.taskId },
    }),
  ).toEqual(failure("task_not_stoppable"));
  await f.settle(root, { status: "cancelled" });
  expect(f.states(plan.resultId)).toEqual([
    ["root", "cancelled", null, null],
    ["dependent", "blocked", "root", null],
  ]);
  expect(value(await f.finish(plan.resultId))).toEqual({
    resultId: plan.resultId,
    outcome: "failed",
  });
  const oversized = value(
    await f.add(
      "oversized",
      f.newPlan([
        task("source"),
        task("dependent", { agent: "virgilio", prerequisites: ["source"] }),
      ]),
    ),
  );
  await f.settle(await f.next(), undefined, "é".repeat(2100));
  expect(await f.prepare()).toBeNull();
  expect(f.states(oversized.resultId)).toContainEqual([
    "dependent",
    "failed",
    null,
    "input_too_large",
  ]);
  expect(f.query("SELECT task_id FROM contributions WHERE failure_reason IS NOT NULL")).toEqual([
    { task_id: null },
  ]);
});

it("admits only plan.finish on the port and checks its exact result shape", async () => {
  const f = await fixture();
  expect(isResearchOperation("plan.addContributions")).toBe(false);
  const id = f.conversationId;
  expect(researchInput("plan.finish", { planId: id })).toBe(true);
  expect(researchOutput("plan.finish", { resultId: id, outcome: "partial" })).toBe(true);
  expect(researchOutput("plan.finish", { resultId: id })).toBe(false);
  expect(await f.finish(id)).toEqual(failure("record_not_found"));
  expect(value(await f.store.readResearchReceipt("finish", "plan.finish", "unused"))).toBeNull();
  const conversation = value(
    await f.store.readResearch({
      kind: "request",
      protocol: 1,
      policy: policyId,
      requestId: "read",
      operationId: "read",
      windowGeneration: "window",
      serviceGeneration: "setup-tests",
      operation: "conversation.read",
      payload: { projectId: f.projectId, ids: [id] },
    }),
  );
  expect(conversation).toMatchObject({ items: [{ runningTask: null }] });
});

it("runs beside a reply and a consultation, and coalesces only the waiting reply when results arrive", async () => {
  const f = await fixture();
  const { resultId: projectId } = value(
    await f.run({ command: "project.create", operationId: "ordinary", payload: {} }),
  );
  const setupId = await proposeSetup(f.store, f.raw, projectId);
  value(
    await f.run({
      command: "project.confirmSetup",
      operationId: "confirm",
      payload: { proposalId: setupId },
    }),
  );
  const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
  const append = (operationId: string) =>
    f.run({
      command: "message.append",
      operationId,
      payload: { conversationId, content: "Find research terms." },
    });
  value(await append("proposal-request"));
  const proposer = await f.next();
  value(
    await f.store.recordTaskEvent(
      proposer.dispatch.request.attempt,
      { type: "result", sequence: 1, result: { status: "completed" } },
      "A search could help.",
      [
        {
          namespace: "ohtia",
          name: "propose_consultation",
          arguments: JSON.stringify({
            agent: "josefa",
            request: "Find index terms.",
            reason: "Compare catalogs.",
          }),
        },
      ],
    ),
  );
  const request = {
    kind: "request",
    protocol: 1,
    policy: policyId,
    requestId: "read",
    operationId: "read",
    windowGeneration: "window",
    serviceGeneration: "setup-tests",
  } as const;
  const read = () =>
    f.store
      .readResearch({
        ...request,
        operation: "conversation.read",
        payload: { projectId, ids: [conversationId] },
      })
      .then(value);
  const { items } = value(
    await f.store.readResearch({
      ...request,
      operation: "timeline.listBefore",
      payload: { conversationId, count: 20, cursor: null },
    }),
  ) as { items: { id: string; kind: string }[] };
  const proposalId = items.find(({ kind }) => kind === "consultation")!.id;
  value(await append("active-reply"));
  const reply = await f.next();
  value(
    await f.run({
      command: "consultation.accept",
      operationId: "consult",
      payload: { proposalId, connection: "chatgpt" },
    }),
  );
  value(await append("queued-reply"));
  value(
    await f.add("accept-plan", {
      ...f.newPlan([task("catalog", { agent: "josefa" })]),
      conversationId,
    }),
  );
  const contribution = await f.next();
  expect(contribution.kind).toBe("contribution");
  expect(contribution.dispatch.request.instructions).toContain("Synthetic investigation");
  expect(await f.prepare()).toBeNull();
  const before = f.query(
    "SELECT hex(id) AS id FROM tasks WHERE accepted_by_operation_id='queued-reply' AND state='queued'",
  );
  await f.settle(contribution, undefined, unresolved);
  const after = f.query(
    "SELECT input_through_position,hex(replaces_task_id) AS id FROM tasks WHERE accepted_by_operation_id='queued-reply' AND state='queued'",
  );
  expect(after).toEqual([
    { id: (before[0] as { id: string }).id, input_through_position: expect.any(Number) },
  ]);
  expect(after[0]).toMatchObject(
    f.query(
      "SELECT position AS input_through_position FROM messages WHERE content LIKE 'The primary question%'",
    )[0] as object,
  );
  expect(await read()).toMatchObject({ items: [{ runningTask: { id: reply.taskId } }] });
  await f.settle(reply, undefined, "Here is a possible search.");
  const consultation = await f.next();
  expect(consultation.kind).toBe("consultation");
  value(
    await f.add("next-plan", {
      ...f.newPlan([task("archive", { agent: "josefa" })]),
      conversationId,
    }),
  );
  const besideConsultation = await f.next();
  expect(besideConsultation.kind).toBe("contribution");
  value(
    await f.run({
      command: "task.stop",
      operationId: "stop-consultation",
      payload: { taskId: consultation.taskId },
    }),
  );
  value(
    await f.run({
      command: "conversation.stop",
      operationId: "stop-conversation",
      payload: { conversationId },
    }),
  );
  expect(f.query("SELECT state FROM tasks WHERE id=?", besideConsultation.taskId)).toEqual([
    { state: "running" },
  ]);
  expect(f.query("SELECT state FROM tasks WHERE id=?", consultation.taskId)).toEqual([
    { state: "cancelling" },
  ]);
  await f.settle(consultation);
  expect(await read()).toMatchObject({ items: [{ runningTask: null }] });
  const timeline = value(
    await f.store.readResearch({
      ...request,
      operation: "timeline.listBefore",
      payload: { conversationId, count: 40, cursor: null },
    }),
  ) as { items: { id: string }[] };
  expect(timeline.items.map(({ id }) => id)).not.toContain(besideConsultation.taskId);
});

it("migrates completed, failed, uncertain, cancelled, active and waiting consultations from revision 21", async () => {
  const f = await fixture();
  const { resultId: projectId } = value(
    await f.run({ command: "project.create", operationId: "ordinary-migration", payload: {} }),
  );
  const setupId = await proposeSetup(f.store, f.raw, projectId);
  value(
    await f.run({
      command: "project.confirmSetup",
      operationId: "migration-confirm",
      payload: { proposalId: setupId },
    }),
  );
  const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
  const results: readonly (ProviderResult | null)[] = [
    { status: "completed" },
    { status: "failed", reason: "provider_error", dispatched: true },
    { status: "uncertain", reason: "connection_lost" },
    { status: "cancelled" },
    null,
    null,
  ];
  for (const [index, result] of results.entries()) {
    const request =
      index === 5
        ? ({
            command: "conversation.start",
            payload: { projectId, content: "Delegate another search." },
          } as const)
        : ({
            command: "message.append",
            payload: { conversationId, content: "Delegate a search." },
          } as const);
    value(await f.run({ ...request, operationId: `propose-${index}` }));
    const reply = await f.next();
    value(
      await f.store.recordTaskEvent(
        reply.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "Search proposal.",
        [
          {
            namespace: "ohtia",
            name: "propose_consultation",
            arguments: JSON.stringify({
              agent: "josefa",
              request: "Find literature.",
              reason: "Search broadly.",
            }),
          },
        ],
      ),
    );
    const latest = f.query(
      "SELECT id FROM interventions WHERE state='proposed' ORDER BY rowid DESC LIMIT 1",
    )[0] as { id: Uint8Array };
    if (index !== 4) {
      value(
        await f.run({
          command: "consultation.accept",
          operationId: `accept-${index}`,
          payload: { proposalId: identifier(latest.id), connection: "chatgpt" },
        }),
      );
      if (result)
        await f.settle(await f.next(), result, result.status === "completed" ? unresolved : "");
    }
  }
  await f.store.close();
  // A new proposal follows the completed or cancelled consultation queue.
  const connection = f.raw();
  connection.exec(
    "PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; DROP TRIGGER receipts_commands;",
  );
  connection.exec(dropWorkLimitsSql);
  for (const table of ["tasks", "contributions", "interventions"])
    connection.exec(`ALTER TABLE ${table} RENAME TO ${table}_with_graphs`);
  for (const definition of [...Object.values(consultationTables), consultationTasks])
    connection.exec(definition);
  for (const table of ["tasks", "contributions", "interventions"]) {
    const columns = (connection.pragma(`table_info(${table})`) as { name: string }[])
      .map(({ name }) => name)
      .join(",");
    connection.exec(
      `INSERT INTO ${table}(rowid,${columns}) SELECT rowid,${columns} FROM ${table}_with_graphs ORDER BY rowid`,
    );
  }
  connection.exec("DROP TABLE graph_changes; DROP TABLE contribution_dependencies;");
  for (const table of ["tasks", "contributions", "interventions"])
    connection.exec(`DROP TABLE ${table}_with_graphs`);
  const retained = Object.fromEntries(
    Object.entries(taskObjects).filter(([name]) => name.startsWith("tasks_")),
  );
  for (const definition of Object.values({
    ...retained,
    tasks_charge_initial: replyObjects.tasks_charge_initial,
    tasks_charge_changes: replyObjects.tasks_charge_changes,
    ...consultationObjects,
  }))
    connection.exec(definition);
  connection.exec(
    "DELETE FROM kysely_migration WHERE name='0022_contribution_graphs'; DELETE FROM ohtia_migration_artifacts WHERE name='0022_contribution_graphs'; PRAGMA user_version=21;",
  );
  connection.close();
  await f.store.open();
  const migrated = f.query(
    "SELECT state,required,plan_key,added_in_graph_version,result_message_id IS NOT NULL AS has_result,length(dedupe_key) AS key_bytes FROM contributions ORDER BY rowid",
  );
  expect(migrated).toEqual(
    ["completed", "failed", "uncertain", "cancelled", "waiting", "active"].map((state) => ({
      state,
      required: 1,
      plan_key: null,
      added_in_graph_version: 0,
      has_result: state === "completed" ? 1 : 0,
      key_bytes: 32,
    })),
  );
  expect(
    f.query("SELECT policy,policy_version,max_requests FROM intervention_limits ORDER BY rowid"),
  ).toEqual(Array(5).fill({ policy: "consultation", policy_version: 1, max_requests: 4 }));
  expect(f.query("SELECT connection FROM intervention_operations ORDER BY rowid")).toEqual(
    Array(5).fill({ connection: "chatgpt" }),
  );
  const historical =
    f.query(`SELECT a.state,a.used_requests,a.used_input_bytes,a.used_output_bytes,a.used_work_ms
    FROM work_allocations a JOIN tasks t ON t.id=a.task_id ORDER BY t.rowid,a.attempt_number`);
  expect(historical.map(({ state }) => state)).toEqual([
    "settled",
    "released",
    "settled",
    "released",
    "settled",
    "released",
    "settled",
    "released",
    "held",
    "held",
  ]);
  for (const row of historical.filter(({ state }) => state === "settled"))
    expect(row).toEqual({
      state: "settled",
      used_requests: 1,
      used_input_bytes: 262144,
      used_output_bytes: 65536,
      used_work_ms: 600000,
    });
  expect(f.query("PRAGMA foreign_key_check")).toEqual([]);
});

async function saturatePlanQueue(f: Awaited<ReturnType<typeof fixture>>) {
  for (const [index, size] of [8, 8, 4].entries())
    value(
      await f.add(
        `fill-queue-${index}`,
        f.newPlan(Array.from({ length: size }, (_, i) => task(`root-${i}`))),
      ),
    );
}

it("holds accepted contributions without tasks after a crash until explicit continuation", async () => {
  const f = await fixture();
  await saturatePlanQueue(f);
  const { resultId } = value(await f.add("saturated", f.newPlan([task("root")])));
  await f.next();
  await f.store.close();
  await f.store.open();
  const paused = value(await f.store.readPauses());
  expect(paused.restart).toBe(20);
  expect(f.query("SELECT state,restart_held FROM contributions WHERE task_id IS NULL")).toEqual([
    { state: "waiting", restart_held: 1 },
  ]);
  expect(await f.prepare()).toBeNull();

  // An orderly stop after a crash cannot authorize the held work either.
  await f.store.close(true);
  await f.store.open();
  expect(await f.prepare()).toBeNull();
  expect(value(await f.store.readPauses()).restart).toBe(20);
  value(
    await f.run({ command: "task.continueAll", operationId: "continue-saturated", payload: {} }),
  );
  expect(value(await f.store.readPauses())).toMatchObject({ restart: 0 });
  expect(f.states(resultId).filter(([, state]) => state === "waiting")).toEqual([]);
  expect(await f.prepare()).toMatchObject({ kind: "contribution" });
});

it("cancels accepted taskless work before freeing capacity and keeps it stopped on reopen", async () => {
  const f = await fixture();
  await saturatePlanQueue(f);
  const { resultId } = value(
    await f.add(
      "saturated",
      f.newPlan([task("root"), task("dependent", { prerequisites: ["root"] })]),
    ),
  );
  await f.store.close();
  await f.store.open();
  expect(value(await f.store.readPauses()).restart).toBe(22);
  value(await f.run({ command: "task.cancelAll", operationId: "cancel-saturated", payload: {} }));
  expect(value(await f.store.readPauses()).restart).toBe(0);
  expect(f.states(resultId).map(([, state]) => state)).toEqual(["cancelled", "cancelled"]);
  expect(f.query("SELECT COUNT(*) AS count FROM tasks")).toEqual([{ count: 20 }]);
  expect(await f.prepare()).toBeNull();
  await f.store.close();
  await f.store.open();
  expect(await f.prepare()).toBeNull();
  expect(value(await f.finish(resultId))).toEqual({ resultId, outcome: "failed" });
});

it("enforces graph versions, state and receipt pairings and immutable graph history in SQLite", async () => {
  const f = await fixture();
  const { resultId } = value(
    await f.add("checks", f.newPlan([task("root"), task("child", { prerequisites: ["root"] })])),
  );
  const db = f.raw();
  try {
    db.pragma("foreign_keys=ON");
    const statements = [
      "UPDATE interventions SET purpose='', revision=revision+1",
      "UPDATE interventions SET graph_version=graph_version+2, revision=revision+1",
      "UPDATE interventions SET outcome='partial', revision=revision+1",
      "UPDATE interventions SET finished_by_operation_id='checks', revision=revision+1",
      "UPDATE contributions SET plan_key='Invalid!' WHERE plan_key='child'",
      "UPDATE contributions SET required=2 WHERE plan_key='child'",
      "UPDATE contributions SET state='blocked' WHERE plan_key='child'",
      "UPDATE contributions SET state='completed' WHERE plan_key='child'",
      "UPDATE contributions SET state='active' WHERE plan_key='child'",
      "UPDATE contributions SET failure_reason='input_too_large' WHERE plan_key='root'",
      "UPDATE contributions SET restart_held=1 WHERE plan_key='root'",
      "UPDATE contributions SET dedupe_key=x'00' WHERE plan_key='child'",
      "UPDATE contribution_dependencies SET removed_in_graph_version=1",
      "UPDATE graph_changes SET summary='{}'",
      "DELETE FROM contribution_dependencies",
      "DELETE FROM graph_changes",
    ];
    for (const statement of statements)
      expect(() => db.prepare(statement).run(), statement).toThrow();
    const edge = db
      .prepare(
        "SELECT id,intervention_id,contribution_id,prerequisite_id FROM contribution_dependencies",
      )
      .get() as Record<string, Uint8Array>;
    expect(() =>
      db
        .prepare(
          `INSERT INTO contribution_dependencies
      (id,intervention_id,contribution_id,prerequisite_id,added_in_graph_version) VALUES (?,?,?,?,1)`,
        )
        .run(
          bytes("019a8000-0000-7000-8000-000000000001"),
          edge.intervention_id,
          edge.contribution_id,
          edge.contribution_id,
        ),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO contribution_dependencies
      (id,intervention_id,contribution_id,prerequisite_id,added_in_graph_version) VALUES (?,?,?,?,1)`,
        )
        .run(
          bytes("019a8000-0000-7000-8000-000000000001"),
          edge.intervention_id,
          edge.contribution_id,
          edge.prerequisite_id,
        ),
    ).toThrow();
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(f.states(resultId)).toEqual([
      ["root", "active", null, null],
      ["child", "waiting", null, null],
    ]);
  } finally {
    db.close();
  }
});

it("records charge acknowledgement when starting an uncertain plan contribution again", async () => {
  const f = await fixture();
  const { resultId } = value(
    await f.add(
      "restart-plan",
      f.newPlan([task("source"), task("review", { prerequisites: ["source"] })]),
    ),
  );
  const first = await f.next();
  await f.store.close();
  await f.store.open();
  const initialPause = value(await f.store.readPauses());
  expect(initialPause.restart).toBe(0);
  expect(f.query("SELECT state FROM tasks WHERE id=?", first.taskId)).toEqual([
    { state: "uncertain" },
  ]);
  expect(f.states(resultId)).toContainEqual(["review", "blocked", "source", null]);
  const { resultId: nextTask } = value(
    await f.run({
      command: "contribution.startAgain",
      operationId: "acknowledge-charge",
      payload: { taskId: first.taskId },
    }),
  );
  expect(f.states(resultId)).toContainEqual(["review", "waiting", null, null]);
  const waitingPause = value(await f.store.readPauses());
  expect(waitingPause.restart).toBe(1);
  expect(waitingPause.revision).toBeGreaterThan(initialPause.revision);
  expect(
    f.query("SELECT replaces_task_id, charge_warning_accepted_at FROM tasks WHERE id=?", nextTask),
  ).toEqual([
    { replaces_task_id: bytes(first.taskId), charge_warning_accepted_at: expect.any(String) },
  ]);
  const restarted = await f.next();
  expect(restarted.acceptedByOperationId).toBe("acknowledge-charge");
  await f.settle(restarted, undefined, unresolved);
  expect(await f.prepare()).toBeNull();
  value(
    await f.run({ command: "task.continueAll", operationId: "continue-dependent", payload: {} }),
  );
  expect(value(await f.store.readPauses()).restart).toBe(0);
  const review = await f.next();
  expect(review.dispatch.request.input.at(-1)?.text).toContain(unresolved);
});

it("copies the plan envelope, reserves both shares and rejects oversized or unauthorized graph changes atomically", async () => {
  const f = await fixture();
  const oversized = Array.from({ length: 9 }, (_, index) => task(`root-${index}`));
  expect(await f.add("oversized", f.newPlan(oversized))).toEqual(failure("plan_too_large"));
  const dense: PlanContributionRequest[] = [];
  for (let index = 0; index < 7; index++)
    dense.push(task(`node-${index}`, { prerequisites: dense.map(({ planKey }) => planKey) }));
  expect(await f.add("dense", f.newPlan(dense))).toEqual(failure("plan_too_large"));
  expect(f.query("SELECT * FROM interventions")).toEqual([]);
  expect(f.query("SELECT * FROM intervention_limits")).toEqual([]);
  const plan = value(
    await f.add(
      "bounded-plan",
      f.newPlan([task("source"), task("use-source", { prerequisites: ["source"] })]),
    ),
  );
  expect(f.query("SELECT * FROM intervention_limits")).toEqual([
    expect.objectContaining({
      policy: "plan",
      policy_version: 1,
      max_contributions: 8,
      max_dependencies: 16,
      max_levels: 1,
      max_coordinator_turns: 3,
      max_requests: 24,
      max_input_bytes: 8388608,
      max_output_bytes: 2097152,
      max_work_ms: 14400000,
    }),
  ]);
  expect(
    f.query("SELECT agent_id,operation,connection FROM intervention_operations ORDER BY agent_id"),
  ).toEqual([
    { agent_id: "josefa", operation: "development_test", connection: "chatgpt" },
    { agent_id: "virgilio", operation: "development_test_synthesis", connection: "chatgpt" },
  ]);
  const allocations = f.query(
    "SELECT share,state,task_id IS NOT NULL AS linked FROM work_allocations ORDER BY rowid",
  );
  expect(allocations).toEqual([
    ...Array(2).fill({ share: "synthesis", state: "held", linked: 0 }),
    ...Array(2).fill({ share: "contribution", state: "held", linked: 1 }),
    ...Array(2).fill({ share: "contribution", state: "held", linked: 0 }),
  ]);
  expect(
    await f.add("unapproved-operation", {
      planId: plan.resultId,
      expectedGraphVersion: 1,
      contributions: [task("virgilio-task", { agent: "virgilio" })],
    }),
  ).toEqual(failure("agent_not_authorized"));

  const db = f.raw();
  try {
    expect(() => db.exec("UPDATE intervention_limits SET max_requests=7")).toThrow(/Immutable/);
    expect(() => db.exec("DELETE FROM intervention_operations")).toThrow(/Immutable/);
    // Make only one request share available to exercise aggregate admission without running a provider.
    db.exec(`DROP TRIGGER intervention_limits_changes;
      UPDATE intervention_limits SET max_requests=7;
      ${limitsObjects.intervention_limits_changes};`);
  } finally {
    db.close();
  }
  expect(
    await f.add("over-budget", {
      planId: plan.resultId,
      expectedGraphVersion: 1,
      contributions: [task("another")],
    }),
  ).toEqual(failure("limit_reached"));
  expect(f.query("SELECT graph_version FROM interventions")).toEqual([{ graph_version: 1 }]);
  expect(
    f.query(
      "SELECT share,state,task_id IS NOT NULL AS linked FROM work_allocations ORDER BY rowid",
    ),
  ).toEqual(allocations);
  expect(
    f.query("SELECT operation_id FROM command_receipts WHERE command='plan.addContributions'"),
  ).toEqual([{ operation_id: "bounded-plan" }]);
});

it("serializes replacement reservations when two contributions compete for the final share", async () => {
  const f = await fixture();
  const { resultId } = value(
    await f.add(
      "parallel-budget",
      f.newPlan(Array.from({ length: 8 }, (_, index) => task(`root-${index}`))),
    ),
  );
  const tasks = [];
  for (let index = 0; index < 8; index++) {
    const pending = await f.next();
    tasks.push(pending);
    await f.settle(pending, { status: "failed", reason: "provider_error", dispatched: true });
  }
  const retry = (index: number) =>
    ({
      command: "contribution.tryAgain",
      operationId: `replace-${index}`,
      payload: { taskId: tasks[index]!.taskId },
    }) as const;
  for (let index = 0; index < 6; index++) value(await f.run(retry(index)));
  const concurrent = await Promise.all([f.run(retry(6)), f.run(retry(7))]);
  expect(concurrent.filter(({ ok }) => ok)).toHaveLength(1);
  const loser = concurrent[0]?.ok ? 7 : 6;
  expect(await f.run(retry(loser))).toEqual(failure("limit_reached"));
  const sum = f.query(
    `SELECT SUM(CASE state WHEN 'held' THEN reserved_requests ELSE used_requests END) AS requests
    FROM work_allocations WHERE intervention_id=?`,
    resultId,
  );
  expect(sum).toEqual([{ requests: 24 }]);
  expect(f.query("SELECT count(*) AS count FROM tasks")).toEqual([{ count: 15 }]);
});

it("fails a taskless contribution when its destination changes and recovers only with the approved route", async () => {
  const f = await fixture();
  const plan = value(
    await f.add(
      "approved-route",
      f.newPlan([
        task("source"),
        task("review", { agent: "virgilio", prerequisites: ["source"] }),
        task("dependent", { prerequisites: ["review"] }),
      ]),
    ),
  );
  const source = await f.next();
  f.resolve("virgilio", "fake");
  await f.settle(source, undefined, "Approved result.");
  expect(f.states(plan.resultId)).toEqual([
    ["source", "completed", null, null],
    ["review", "failed", null, "destination_changed"],
    ["dependent", "blocked", "review", null],
  ]);
  expect(await f.prepare()).toBeNull();
  const row = f.query("SELECT id FROM contributions WHERE plan_key='review'")[0]!;
  const retry = {
    command: "contribution.tryAgain",
    operationId: "retry-route",
    payload: { contributionId: identifier(row.id as Uint8Array) },
  } as const;
  expect(researchInput(retry.command, retry.payload)).toBe(true);
  expect(await f.run(retry)).toEqual(failure("destination_changed"));
  expect(f.query("SELECT count(*) AS count FROM tasks")).toEqual([{ count: 1 }]);
  f.resolve("virgilio", "chatgpt");
  const replacement = value(await f.run(retry));
  expect(f.states(plan.resultId)).toEqual([
    ["source", "completed", null, null],
    ["review", "active", null, null],
    ["dependent", "waiting", null, null],
  ]);
  expect((await f.next()).taskId).toBe(replacement.resultId);
});

it("refuses oversized input before retrying a taskless contribution on its approved route", async () => {
  const f = await fixture();
  const { resultId } = value(
    await f.add(
      "oversized-retry",
      f.newPlan([task("source"), task("review", { agent: "virgilio", prerequisites: ["source"] })]),
    ),
  );
  const source = await f.next();
  f.resolve("virgilio", "fake");
  await f.settle(source, undefined, "é".repeat(2100));
  const states = f.states(resultId);
  expect(states).toContainEqual(["review", "failed", null, "destination_changed"]);
  const { id } = f.query("SELECT id FROM contributions WHERE plan_key='review'")[0]!;
  const contributionId = identifier(id as Uint8Array);
  const allocations = () =>
    f.query(
      "SELECT state FROM work_allocations WHERE contribution_id=? ORDER BY attempt_number",
      contributionId,
    );
  expect(allocations()).toEqual([{ state: "released" }, { state: "released" }]);

  f.resolve("virgilio", "chatgpt");
  expect(
    await f.run({
      command: "contribution.tryAgain",
      operationId: "retry-oversized",
      payload: { contributionId },
    }),
  ).toEqual(failure("input_too_large"));
  expect(f.states(resultId)).toEqual(states);
  expect(allocations()).toEqual([{ state: "released" }, { state: "released" }]);
  expect(f.query("SELECT count(*) AS count FROM tasks")).toEqual([{ count: 1 }]);
  expect(f.query("SELECT 1 FROM command_receipts WHERE operation_id='retry-oversized'")).toEqual(
    [],
  );
  expect(await f.prepare()).toBeNull();
});

it("refuses to activate a ready contribution when its prerequisite no longer holds its approved result", async () => {
  const f = await fixture();
  const plan = value(
    await f.add(
      "approved-input",
      f.newPlan([task("source"), task("dependent", { prerequisites: ["source"] })]),
    ),
  );
  const source = await f.next();
  await saturatePlanQueue(f);
  await f.settle(source, undefined, "Original approved result.");
  expect(
    f.query(
      "SELECT ready_inputs IS NOT NULL AS ready, task_id FROM contributions WHERE plan_key='dependent'",
    ),
  ).toEqual([{ ready: 1, task_id: null }]);
  const db = f.raw();
  try {
    // Simulate a stale readiness witness that production graph rules do not allow replacing.
    db.exec(`DROP TRIGGER contributions_changes;
      UPDATE contributions SET ready_inputs='[]' WHERE plan_key='dependent';
      ${limitsObjects.contributions_changes};`);
  } finally {
    db.close();
  }
  await f.next();
  expect(f.states(plan.resultId)).toEqual([
    ["source", "completed", null, null],
    ["dependent", "failed", null, "input_changed"],
  ]);
  expect(
    f.query(
      "SELECT count(*) AS count FROM tasks WHERE contribution_id=(SELECT id FROM contributions WHERE plan_key='dependent')",
    ),
  ).toEqual([{ count: 0 }]);
});

it.each(["contribution.tryAgain", "contribution.startAgain"] as const)(
  "preserves the task and ledger when %s sees a changed destination or prerequisite",
  async (command) => {
    const f = await fixture();
    const plan = value(
      await f.add(
        "explicit-activation",
        f.newPlan([
          task("source"),
          task("review", { agent: "virgilio", prerequisites: ["source"] }),
        ]),
      ),
    );
    await f.settle(await f.next(), undefined, "Original result.");
    const review = await f.next();
    const restarting = command === "contribution.startAgain";
    await f.settle(
      review,
      restarting
        ? { status: "uncertain", reason: "connection_lost" }
        : { status: "failed", reason: "provider_error", dispatched: true },
    );
    const retry = { command, operationId: "retry-explicit", payload: { taskId: review.taskId } };
    const read = () => ({
      tasks: f.query("SELECT * FROM tasks ORDER BY rowid"),
      allocations: f.query("SELECT * FROM work_allocations ORDER BY rowid"),
      states: f.states(plan.resultId),
      receipts: f.query("SELECT * FROM command_receipts WHERE operation_id='retry-explicit'"),
    });
    const before = read();
    f.resolve("virgilio", "fake");
    expect(await f.run(retry)).toEqual(failure("destination_changed"));
    expect(read()).toEqual(before);
    f.resolve("virgilio", "chatgpt");
    const db = f.raw();
    try {
      db.exec(`DROP TRIGGER contributions_changes;
        UPDATE contributions SET ready_inputs='[]' WHERE plan_key='review';
        ${limitsObjects.contributions_changes};`);
    } finally {
      db.close();
    }
    expect(await f.run(retry)).toEqual(failure("input_changed"));
    expect(read()).toEqual(before);
    expect(await f.prepare()).toBeNull();
  },
);
