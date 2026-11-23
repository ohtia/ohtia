import { seedDefaultModel, setSyntheticAgentModel } from "./fixtures/storage.js";
import { readFileSync } from "node:fs";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import { describe, expect, it, vi } from "vitest";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { dispatchThrough } from "./fixtures/provider-conformance.js";
import {
  conversationTitlePolicy,
  decodeProviderDispatch,
  decodeProviderEvent,
  encodeEnvelope,
  failure,
  type ProviderEventMessage,
  type DiagnosticEvent,
  policyId,
  researchOutput,
  type ProviderToolCall,
  type ResearchCommand,
  type ResearchOutputs,
} from "../packages/contracts/src/index.js";
import { bytes } from "../packages/utility/src/research.js";
import { buildInput, operationPolicy } from "../packages/utility/src/operations.js";
import {
  consultationNote,
  decodeConsultationProposal,
} from "../packages/utility/src/consultations.js";
import { setupConnections, successful as value, proposeSetup } from "./fixtures/project-setup.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { preRedirectionSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { Database, preConsultationSql, storageFixture } from "./fixtures/storage.js";

const identity = {
  kind: "request",
  protocol: 1,
  policy: policyId,
  requestId: "read-consultations",
  operationId: "read-consultations",
  windowGeneration: "window",
  serviceGeneration: "setup-tests",
} as const;
const completed = { type: "result", sequence: 1, result: { status: "completed" } } as const;
const call = (
  request: string,
  reason = "Review possible search terms.",
  agent = "josefa",
): ProviderToolCall => ({
  namespace: "ohtia",
  name: "propose_consultation",
  arguments: JSON.stringify({ agent, reason, request }),
});
async function fixture(
  title = "Synthetic investigation",
  emitDiagnostic?: (event: DiagnosticEvent) => void,
) {
  const f = storageFixture(emitDiagnostic);
  await f.store.open();
  f.store.setTaskContext({
    generation: "setup-tests",
    mode: "development",
    connections: setupConnections(),
  });
  seedDefaultModel(f.raw, "first", "First");
  const run = (command: ResearchCommand) => f.store.executeResearchCommand(command);
  const projectId = value(
    await run({ command: "project.create", operationId: "create-thesis", payload: {} }),
  ).resultId;
  const setupId = await proposeSetup(f.store, f.raw, projectId, { title, document_language: "en" });
  value(
    await run({
      command: "project.confirmSetup",
      operationId: "confirm-thesis",
      payload: { proposalId: setupId },
    }),
  );
  const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
  let appendNumber = 0;
  const append = async (content: string, operationId = `append-${++appendNumber}`) =>
    value(
      await run({
        command: "message.append",
        operationId,
        payload: { conversationId, content },
      }),
    );
  const prepare = async () => {
    const task = value(await f.store.prepareTask());
    if (!task) throw new Error("Expected a dispatchable task.");
    return task;
  };
  const timeline = async () => {
    const result = value(
      await f.store.readResearch({
        ...identity,
        operation: "timeline.listBefore",
        payload: { conversationId, cursor: null, count: 48 },
      }),
    );
    expect(researchOutput("timeline.listBefore", result)).toBe(true);
    return result as import("../packages/contracts/src/index.js").ResearchOutputs["timeline.listBefore"];
  };
  const propose = async (calls: readonly ProviderToolCall[], text = "") => {
    await append("The researcher chose a candidate question.");
    const task = await prepare();
    expect(
      decodeProviderDispatch(JSON.stringify(task.dispatch), "setup-tests")?.request,
    ).toMatchObject({
      operation: "direct_guidance",
      policy_version: 6,
      tools: [
        { name: "propose_consultation" },
        { name: "propose_plan" },
        { name: "propose_handoff" },
        { name: "update_memory" },
      ],
    });
    expect(task.dispatch.request.instructions).toContain("open dependencies");
    expect(task.dispatch.request.instructions).toContain(
      "It does not count as a consultation proposal.",
    );
    value(await f.store.recordTaskEvent(task.dispatch.request.attempt, completed, text, calls));
    const proposal = (await timeline()).items.find(
      (item) => item.kind === "consultation" && item.taskId === task.taskId,
    );
    if (!proposal || proposal.kind !== "consultation") throw new Error("Expected a consultation.");
    return proposal;
  };
  const destination = (connection: string) => {
    f.store.setTaskContext({
      mode: "development",
      generation: "setup-tests",
      connections: setupConnections(),
    });
    setSyntheticAgentModel(
      f.raw,
      "josefa",
      connection,
      connection === "chatgpt" ? "first" : "fake-model",
    );
  };
  return { ...f, run, append, prepare, timeline, propose, projectId, conversationId, destination };
}

describe("consultations", () => {
  it("dispatches only the exact approved request and includes Josefa’s answer in the waiting reply", async () => {
    const f = await fixture();
    const request =
      "Purpose: compare two possible thesis topics. The researcher chose public schools. Access to catalogs is unknown.\n\n" +
      "한".repeat(2000);
    const opened = await f.propose([call(request)], "We could ask Josefa.");
    expect(opened).toMatchObject({
      state: "proposed",
      rank: 2,
      revision: 1,
      request: { parts: 2 },
    });
    expect(value(await f.store.prepareTask())).toBeNull();
    const accept = {
      command: "consultation.accept",
      operationId: "ask-josefa",
      payload: { proposalId: opened.id, connection: "chatgpt" },
    } as const;
    expect(value(await f.run(accept))).toEqual({ resultId: opened.id });
    expect(value(await f.run(accept))).toEqual({ resultId: opened.id });
    const queued = (await f.timeline()).items;
    expect(queued).toContainEqual(
      expect.objectContaining({
        kind: "consultation",
        state: "accepted",
        revision: 2,
        connection: "chatgpt",
      }),
    );
    expect(queued).toContainEqual(
      expect.objectContaining({
        kind: "task",
        consultation: true,
        rank: 3,
        position: opened.position,
      }),
    );
    await f.append("Can you explain her plan?", "followup");
    const josefa = await f.prepare();
    expect(josefa.acceptedByOperationId).toBe("ask-josefa");
    expect(josefa.dispatch.request).toMatchObject({
      operation: "search_strategy_planning",
      policy_version: 4,
      tools: [],
      input: [
        { role: "user", text: "Project memory: no entries yet." },
        {
          role: "user",
          text:
            "This request comes from a consultation by Virgilio, the research guide. The researcher approved it and cannot answer questions in this reply.\n\nRequest:\n" +
            request,
        },
      ],
    });
    expect(josefa.dispatch.request.instructions).toContain("Ohtia's thesis research route");
    expect(josefa.dispatch.request.instructions).not.toContain("Review possible search terms.");
    expect(value(await f.store.prepareTask())).toBeNull();
    value(
      await f.store.recordTaskEvent(
        josefa.dispatch.request.attempt,
        completed,
        "Catalog access is unknown.",
      ),
    );
    const next = await f.prepare();
    expect(next.acceptedByOperationId).toBe("followup");
    expect(next.dispatch.request.input.at(-1)).toEqual({
      role: "user",
      text: expect.stringMatching(
        /^\[M[1-9][0-9]*\] Message from Josefa, the reference librarian:\n\nCatalog access is unknown\.$/,
      ),
    });
    expect(next.dispatch.request.input).toContainEqual({
      role: "user",
      text: expect.stringContaining("the researcher accepted it"),
    });
    const db = f.raw();
    try {
      expect(
        db
          .prepare(
            "SELECT kind, input_through_position, accepted_by_operation_id FROM tasks WHERE id=?",
          )
          .get(bytes(josefa.taskId)),
      ).toEqual({
        kind: "consultation",
        input_through_position: null,
        accepted_by_operation_id: "ask-josefa",
      });
      expect(
        db
          .prepare(
            "SELECT state, input_through_position FROM tasks WHERE accepted_by_operation_id='followup' ORDER BY rowid",
          )
          .all(),
      ).toMatchObject([{ state: "cancelled" }, { state: "running" }]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("keeps a valid open proposal when the next proposal is invalid and rejects a replaced decision", async () => {
    const f = await fixture();
    const replies: string[] = [];
    const stop = f.store.observeResearchActivity((event) => {
      if (event.kind === "replyFinished") replies.push(event.agentId);
    });
    const first = await f.propose([call("Find terminology.")]);
    const invalid = await f.propose([call(""), call("Find catalogs.")]);
    expect(invalid).toMatchObject({
      state: "invalid",
      invalidReason: "multiple_calls",
      request: null,
    });
    expect((await f.timeline()).items).toContainEqual(first);
    const newer = await f.propose([call("Find catalogs.")]);
    stop();
    expect(replies).toEqual(["virgilio", "virgilio", "virgilio"]);
    const decided = await f.run({
      command: "consultation.decline",
      operationId: "stale",
      payload: { proposalId: first.id },
    });
    expect(decided).toMatchObject({
      ok: false,
      error: { code: "proposal_not_waiting", nextAction: "refresh_record" },
    });
    value(
      await f.run({
        command: "consultation.decline",
        operationId: "decline",
        payload: { proposalId: newer.id },
      }),
    );
    expect(value(await f.store.prepareTask())).toBeNull();
  });

  it("rejects changed destinations and retries only the latest contribution with the original input", async () => {
    const f = await fixture();
    const first = await f.propose([call("Find open catalogs.")]);
    const second = await f.propose([call("Find subscription catalogs.")]);
    const accept = (proposalId: string, operationId: string, connection = "chatgpt") =>
      f.run({ command: "consultation.accept", operationId, payload: { proposalId, connection } });
    expect(await accept(second.id, "stale-destination", "other")).toMatchObject({
      ok: false,
      error: { code: "destination_changed", nextAction: "refresh_record" },
    });
    value(await accept(second.id, "accept-second"));
    const initial = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        initial.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "uncertain", reason: "connection_lost" },
        },
        "",
      ),
    );
    const third = await f.propose([call("Find regional catalogs.")]);
    value(await accept(third.id, "accept-third"));
    const restart = {
      command: "contribution.startAgain",
      operationId: "restart-second",
      payload: { taskId: initial.taskId },
    } as const;
    expect(await f.run(restart)).toMatchObject({
      ok: false,
      error: { code: "consultation_unfinished" },
    });
    const thirdTask = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        thirdTask.dispatch.request.attempt,
        completed,
        "Possible catalog.",
      ),
    );
    const { resultId } = value(await f.run(restart));
    const retried = await f.prepare();
    expect(retried.taskId).toBe(resultId);
    expect(retried.dispatch.request.input).toEqual(initial.dispatch.request.input);
    expect(await f.run({ ...restart, operationId: "stale-task" })).toMatchObject({
      ok: false,
      error: { code: "newer_task_exists" },
    });
    expect(await accept(first.id, "replaced-first")).toMatchObject({
      ok: false,
      error: { code: "proposal_not_waiting" },
    });
    const db = f.raw();
    try {
      expect(
        db
          .prepare("SELECT charge_warning_accepted_at FROM tasks WHERE id=?")
          .pluck()
          .get(bytes(resultId)),
      ).toEqual(expect.any(String));
    } finally {
      db.close();
    }
  });

  it("keeps a consultation call when the same reply supplies automatic title metadata", async () => {
    const f = await fixture("𠀀".repeat(200));
    const { resultId } = value(
      await f.run({
        command: "conversation.start",
        operationId: "start-new",
        payload: { projectId: f.projectId, content: "Find search terms." },
      }),
    );
    const task = await f.prepare();
    expect(decodeProviderDispatch(JSON.stringify(task.dispatch), "setup-tests")).toEqual(
      task.dispatch,
    );
    const fake = createFakeProvider({
      send: async (_request, control) => {
        expect(control.release()).toBe(true);
        control.emit({ type: "text", text: "We can ask Josefa." });
        control.emit({ type: "tool_call", ...call("Find search terms for the candidate topic.") });
        control.emit({
          type: "tool_call",
          namespace: conversationTitlePolicy.namespace,
          name: conversationTitlePolicy.name,
          arguments: JSON.stringify({ title: "Search terms" }),
        });
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
      task.dispatch.request,
    );
    expect(events.filter((event) => event.type === "tool_call")).toEqual([
      expect.objectContaining(call("Find search terms for the candidate topic.")),
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      result: { status: "completed", conversation_title: "Search terms" },
    });
    expect(resultId).not.toBe(f.conversationId);
  });

  it("ignores malformed scalar arguments instead of calling them empty", () => {
    expect(decodeConsultationProposal([call("\ud800")], "development")).toBeUndefined();
    expect(decodeConsultationProposal([call("Terms", "\udc00")], "development")).toBeUndefined();
    expect(decodeConsultationProposal([call("")], "development")).toEqual({
      invalid: "request_empty",
    });
    expect(decodeConsultationProposal([call("Terms", "")], "development")).toEqual({
      invalid: "reason_empty",
    });
  });

  it("measures decoded UTF-8 bytes and Unicode code points", () => {
    expect(
      decodeConsultationProposal([call("é".repeat(16384), "𠀀".repeat(500))], "development"),
    ).toHaveProperty("values");
    expect(decodeConsultationProposal([call("é".repeat(16385))], "development")).toEqual({
      invalid: "request_too_long",
    });
    expect(decodeConsultationProposal([call("Terms", "𠀀".repeat(501))], "development")).toEqual({
      invalid: "reason_too_long",
    });
    expect(decodeConsultationProposal([call("Terms", "Reason", "thomas")], "development")).toEqual({
      invalid: "agent_unavailable",
    });
  });
});

describe("consultation recovery and context", () => {
  it("keeps the original acceptance position through permit refusal and makes Stop release the single inference slot", async () => {
    const f = await fixture();
    const db = f.raw();
    try {
      db.exec(
        "UPDATE application_preferences SET value=json_set(value,'$.max_concurrent_inference',1),revision=revision+1 WHERE key='execution_limits'",
      );
    } finally {
      db.close();
    }
    const proposal = await f.propose([call("Find open catalogs.")]);
    value(
      await f.run({
        command: "consultation.accept",
        operationId: "approve",
        payload: { proposalId: proposal.id, connection: "chatgpt" },
      }),
    );
    const first = await f.prepare();
    await f.append("Please explain the proposal.", "followup");
    value(
      await f.store.recordTaskEvent(
        first.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", dispatched: false, reason: "permit_expired" },
        },
        "",
      ),
    );
    const readmitted = await f.prepare();
    expect(readmitted.taskId).toBe(first.taskId);
    expect(readmitted.dispatch.request.input).toEqual(first.dispatch.request.input);
    expect(value(await f.store.prepareTask())).toBeNull();
    value(
      await f.run({
        command: "task.stop",
        operationId: "stop-josefa",
        payload: { taskId: first.taskId },
      }),
    );
    expect(value(await f.store.prepareTask())).toBeNull();
    expect((await f.timeline()).items).toContainEqual(
      expect.objectContaining({ id: first.taskId, state: "cancelling" }),
    );
    const afterStop = f.raw();
    try {
      expect(
        afterStop
          .prepare("SELECT state FROM attempts WHERE id=?")
          .pluck()
          .get(bytes(readmitted.dispatch.request.attempt)),
      ).toBe("stopping");
    } finally {
      afterStop.close();
    }
    const stopped = value(
      await f.store.recordTaskEvent(readmitted.dispatch.request.attempt, completed, ""),
    );
    expect(stopped).toMatchObject({ recorded: true, result: { status: "cancelled" } });
    expect((await f.timeline()).items).toContainEqual(
      expect.objectContaining({
        id: first.taskId,
        state: "cancelled",
        outcomeReason: "cancelled_by_researcher",
      }),
    );
    const followup = await f.prepare();
    expect(followup.acceptedByOperationId).toBe("followup");
    expect(followup.dispatch.request.operation).toBe("direct_guidance");
    expect(followup.dispatch.request.input.at(-1)?.text).toBe("[M3] Please explain the proposal.");
    value(
      await f.run({
        command: "task.stop",
        operationId: "stop-virgilio",
        payload: { taskId: followup.taskId },
      }),
    );
    const stoppedFollowup = value(
      await f.store.recordTaskEvent(followup.dispatch.request.attempt, completed, ""),
    );
    expect(stoppedFollowup).toMatchObject({ recorded: true, result: { status: "cancelled" } });
    expect(value(await f.store.prepareTask())).toBeNull();
  });

  it("retries a failed consultation unchanged and declines retry after a provider entitlement refusal", async () => {
    const f = await fixture();
    const card = await f.propose([call("Find open catalogs.")]);
    value(
      await f.run({
        command: "consultation.accept",
        operationId: "approve",
        payload: { proposalId: card.id, connection: "chatgpt" },
      }),
    );
    const failed = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        failed.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", dispatched: true, reason: "provider_error" },
        },
        "",
      ),
    );
    const { resultId } = value(
      await f.run({
        command: "contribution.tryAgain",
        operationId: "retry",
        payload: { taskId: failed.taskId },
      }),
    );
    const timeline = (await f.timeline()).items;
    expect(timeline).toContainEqual(
      expect.objectContaining({ id: failed.taskId, superseded: true }),
    );
    expect(timeline).toContainEqual(
      expect.objectContaining({
        id: resultId,
        replacesTaskId: failed.taskId,
        position: timeline.find(({ id }) => id === failed.taskId)?.position,
      }),
    );
    const retried = await f.prepare();
    expect(retried.dispatch.request.input).toEqual(failed.dispatch.request.input);
    expect(retried.dispatch.request.instructions).toBe(failed.dispatch.request.instructions);
    value(
      await f.store.recordTaskEvent(
        retried.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", dispatched: true, reason: "not_eligible" },
        },
        "",
      ),
    );
    expect(
      await f.run({
        command: "contribution.tryAgain",
        operationId: "retry-again",
        payload: { taskId: retried.taskId },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "task_not_retryable" },
    });
  });

  it("uses the exact proposal notes in position and omits notes outside the retained message range", () => {
    const prefix = "Note from Ohtia: at this point you proposed asking Josefa for a contribution";
    const invalid =
      "Note from Ohtia: at this point Ohtia did not accept your consultation proposal because ";
    const endings = {
      request_empty: "its request was empty.",
      request_too_long: "its request was longer than 32,768 bytes.",
      reason_empty: "it had no reason.",
      reason_too_long: "its reason was longer than 500 characters.",
      agent_unavailable: "it named an agent that isn't available.",
    } as const;
    const notes = [
      ...(
        [
          [
            "proposed",
            prefix + "; the proposal is waiting for the researcher to accept or decline it.",
          ],
          [
            "accepted",
            prefix +
              ", and the researcher accepted it; Josefa's result appears in this conversation as a message from Josefa once it is saved.",
          ],
          ["declined", prefix + "; the researcher declined, so nothing was sent."],
          ["replaced", prefix + "; a later proposal of yours replaced it."],
        ] as const
      ).map(([state, text]) => [{ state, invalid_reason: null }, text] as const),
      ...Object.entries(endings).map(
        ([reason, text]) =>
          [
            { state: "invalid" as const, invalid_reason: reason as keyof typeof endings },
            invalid + text + " The researcher was told.",
          ] as const,
      ),
      [
        { state: "invalid", invalid_reason: "multiple_calls" },
        "Note from Ohtia: at this point you made more than one proposal in one reply, so Ohtia accepted none of them. The researcher was told.",
      ] as const,
    ];
    const policy = { ...operationPolicy("direct_guidance", 2, "installed")!, max_input_items: 2 };
    const chosen = buildInput(
      policy,
      [
        { position: 1, reference: "omitted", role: "user", text: "Omitted message" },
        { position: 3, reference: "reply", role: "assistant", text: "Latest reply" },
        { position: 20, reference: "latest", role: "user", text: "Latest question" },
      ],
      { reference: "conversation", revision: 1 },
      [
        {
          kind: "consultation_proposal",
          position: 2,
          reference: "omitted-note",
          revision: 1,
          text: "Omitted note",
        },
        ...notes.map(([record], index) => ({
          kind: "consultation_proposal" as const,
          position: index + 3,
          reference: `proposal-${String(index)}`,
          revision: 1,
          text: consultationNote(record, "Josefa"),
        })),
      ],
    )!;
    expect(chosen.input.slice(1, -1)).toEqual([
      { role: "assistant", text: "Latest reply" },
      ...notes.map(([, text]) => ({ role: "user", text })),
    ]);
    expect(chosen.transfer).not.toContainEqual(
      expect.objectContaining({ reference: "omitted-note" }),
    );
    expect(chosen.transfer).toContainEqual({
      kind: "note",
      note: "consultation_proposal",
      reference: "proposal-0",
      revision: 1,
    });
  });
});

it("migrates populated revision 20 while preserving task acceptance order, charge warnings and references", async () => {
  const f = await fixture();
  await f.append("Consider sources about school attendance.");
  const existing = await f.prepare();
  value(
    await f.store.recordTaskEvent(
      existing.dispatch.request.attempt,
      { type: "result", sequence: 1, result: { status: "uncertain", reason: "connection_lost" } },
      "Partial research guidance.",
    ),
  );
  const { resultId } = value(
    await f.run({
      command: "task.startAgain",
      operationId: "accept-repeat-charge",
      payload: { taskId: existing.taskId },
    }),
  );
  const read = (db: ReturnType<typeof f.raw>) => ({
    tasks: db
      .prepare(
        "SELECT rowid,hex(id) AS id,input_through_position,charge_warning_accepted_at FROM tasks ORDER BY rowid",
      )
      .all(),
    attempts: db
      .prepare("SELECT hex(id) AS id,hex(task_id) AS task,state FROM attempts ORDER BY rowid")
      .all(),
    messages: db
      .prepare("SELECT hex(id) AS id,hex(task_id) AS task,ending FROM messages ORDER BY rowid")
      .all(),
  });
  await f.store.close();
  const legacy = f.raw();
  legacy.exec(preConsultationSql);
  const before = read(legacy);
  expect(legacy.pragma("user_version", { simple: true })).toBe(20);
  expect(
    legacy
      .prepare("SELECT charge_warning_accepted_at FROM tasks WHERE id=?")
      .pluck()
      .get(bytes(resultId)),
  ).toEqual(expect.any(String));
  legacy.close();
  await f.store.open();
  const migrated = f.raw();
  try {
    expect(migrated.pragma("user_version", { simple: true })).toBe(36);
    expect(read(migrated)).toEqual(before);
    expect(
      migrated.prepare("SELECT state,blocking_reason FROM tasks WHERE id=?").get(bytes(resultId)),
    ).toEqual({ state: "blocked", blocking_reason: "restart_paused" });
    expect(migrated.prepare("SELECT DISTINCT kind FROM tasks").pluck().all()).toEqual(["reply"]);
    expect(migrated.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      migrated.prepare("UPDATE tasks SET kind='consultation' WHERE id=?").run(bytes(resultId)),
    ).toThrow();
  } finally {
    migrated.close();
  }
});

it("reports and enforces the consultation budget across attempts, with the destination fixed at acceptance", async () => {
  const f = await fixture();
  const proposal = await f.propose([call("Compare research sources.")], "Ask Josefa.");
  value(
    await f.run({
      command: "consultation.accept",
      operationId: "bounded-consultation",
      payload: { proposalId: proposal.id, connection: "chatgpt" },
    }),
  );
  const rows = (sql: string) => {
    const db = f.raw();
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };
  expect(rows("SELECT * FROM intervention_limits")).toEqual([
    expect.objectContaining({
      policy: "consultation",
      policy_version: 1,
      max_contributions: 1,
      max_dependencies: 0,
      max_levels: 1,
      max_coordinator_turns: 0,
      max_requests: 4,
      max_input_bytes: 1048576,
      max_output_bytes: 262144,
      max_work_ms: 2400000,
    }),
  ]);
  expect(rows("SELECT agent_id, operation, connection FROM intervention_operations")).toEqual([
    { agent_id: "josefa", operation: "search_strategy_planning", connection: "chatgpt" },
  ]);
  const first = await f.prepare();
  const attempts = () =>
    rows(`SELECT state,used_requests,used_input_bytes,used_output_bytes,used_work_ms
    FROM work_allocations ORDER BY rowid`);
  expect(attempts()).toHaveLength(2);
  expect(attempts().map((row) => row.state)).toEqual(["held", "held"]);
  const event = {
    type: "result",
    sequence: 1,
    result: { status: "uncertain", reason: "connection_lost" },
  } as const;
  value(
    await f.store.recordTaskEvent(first.dispatch.request.attempt, event, "Partial", [], {
      dispatched: true,
      input_bytes: 400,
      output_bytes: 7,
      work_ms: 10,
    }),
  );
  expect(attempts()[0]).toEqual({
    state: "settled",
    used_requests: 1,
    used_input_bytes: 262144,
    used_output_bytes: 65536,
    used_work_ms: 600000,
  });
  expect(attempts()[1]).toMatchObject({ state: "released", used_requests: null });
  const startAgain = {
    command: "contribution.startAgain",
    operationId: "recover-consultation",
    payload: { taskId: first.taskId },
  } as const;
  f.destination("fake");
  expect(await f.run(startAgain)).toEqual(failure("destination_changed"));
  expect(attempts()).toHaveLength(2);
  f.destination("chatgpt");
  value(await f.run(startAgain));
  const second = await f.prepare();
  value(await f.store.recordTaskEvent(second.dispatch.request.attempt, event, "Another partial"));
  const third = {
    ...startAgain,
    operationId: "another-consultation",
    payload: { taskId: second.taskId },
  };
  value(await f.run(third));
  const latest = await f.prepare();
  value(await f.store.recordTaskEvent(latest.dispatch.request.attempt, event, "Latest partial"));
  expect(
    await f.run({
      ...startAgain,
      operationId: "over-budget",
      payload: { taskId: latest.taskId },
    }),
  ).toEqual(failure("limit_reached"));
  expect(attempts().map((row) => row.state)).toEqual([
    "settled",
    "released",
    "settled",
    "released",
    "settled",
    "released",
  ]);
  expect((await f.timeline()).items).toContainEqual(
    expect.objectContaining({
      id: latest.taskId,
      kind: "task",
      consultation: true,
      consultationRetryFits: false,
      state: "uncertain",
    }),
  );
});

it.each([true, false])(
  "releases the first attempt and accounts for Stop after dispatch = %s",
  async (dispatched) => {
    const diagnostics: DiagnosticEvent[] = [];
    const f = await fixture(undefined, (event) => diagnostics.push(event));
    const proposal = await f.propose([call("Compare two approved bibliographies.")], "Ask Josefa.");
    value(
      await f.run({
        command: "consultation.accept",
        operationId: "stop-consultation",
        payload: { proposalId: proposal.id, connection: "chatgpt" },
      }),
    );
    const refused = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        refused.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", reason: "permit_expired", dispatched: false },
        },
        "",
      ),
    );
    const second = await f.prepare();
    expect(second.taskId).toBe(refused.taskId);

    const events: ProviderEventMessage[] = [];
    let observed!: () => void;
    const started = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const adapter = createFakeProvider({
      holdReply: true,
      ...(dispatched
        ? {}
        : {
            prepare: (signal: AbortSignal) =>
              new Promise<"temporary">((resolve) => {
                signal.addEventListener("abort", () => resolve("temporary"), { once: true });
                observed();
              }),
          }),
    });
    let now = second.dispatch.permit.issued_at;
    const broker = new ProviderDispatch(
      [
        {
          ...adapter,
          declaration: {
            ...adapter.declaration,
            connection: { ...adapter.declaration.connection, id: "chatgpt" },
          },
        },
      ],
      {
        state: () => "connected",
        wallClock: () => now,
        monotonic: () => now,
        send(generation, text) {
          const event = decodeProviderEvent(text, generation);
          if (!event) throw new Error("Expected a valid broker measurement.");
          events.push(event);
          if (event.event.type === "text") observed();
        },
      },
    );
    broker.begin(second.dispatch.generation);
    const dispatch = broker.receive(second.dispatch);
    await started;
    now += 43;
    if (dispatched)
      value(
        await f.store.recordTaskEvent(
          second.dispatch.request.attempt,
          {
            type: "usage",
            sequence: events.length + 1,
            usage: {
              input_tokens: 13,
              output_tokens: null,
              cached_input_tokens: null,
              reasoning_tokens: null,
            },
          },
          "",
        ),
      );
    value(
      await f.run({
        command: "task.stop",
        operationId: "stop-attempt",
        payload: { taskId: second.taskId },
      }),
    );
    broker.interrupt({
      kind: "provider_interrupt",
      version: 1,
      generation: second.dispatch.generation,
      attempt: second.dispatch.request.attempt,
    });
    await dispatch;
    broker.dispose();
    const terminal = events.at(-1)!;
    const text = events
      .flatMap(({ event }) => (event.type === "text" ? [event.text] : []))
      .join("");
    expect(terminal.event).toMatchObject({ type: "result", result: { status: "cancelled" } });
    expect(terminal.work).toEqual({
      dispatched,
      input_bytes: dispatched
        ? second.dispatch.request.input.reduce(
            (bytes, { text }) => bytes + Buffer.byteLength(text),
            0,
          )
        : 0,
      output_bytes: Buffer.byteLength(text),
      work_ms: dispatched ? 43 : 0,
    });
    value(await f.store.recordTaskEvent(terminal.attempt, terminal.event, text, [], terminal.work));
    const db = f.raw();
    try {
      expect(
        db
          .prepare(
            `SELECT attempt_number, state, used_requests, used_input_bytes, used_output_bytes, used_work_ms
      FROM work_allocations ORDER BY attempt_number`,
          )
          .all(),
      ).toEqual([
        {
          attempt_number: 1,
          state: "released",
          used_requests: null,
          used_input_bytes: null,
          used_output_bytes: null,
          used_work_ms: null,
        },
        {
          attempt_number: 2,
          state: dispatched ? "settled" : "released",
          used_requests: dispatched ? 1 : null,
          used_input_bytes: dispatched ? terminal.work?.input_bytes : null,
          used_output_bytes: dispatched ? terminal.work?.output_bytes : null,
          used_work_ms: dispatched ? 43 : null,
        },
      ]);
      expect(
        db
          .prepare("SELECT input_tokens, output_tokens FROM attempts WHERE id=?")
          .get(bytes(terminal.attempt)),
      ).toEqual({ input_tokens: dispatched ? 13 : null, output_tokens: null });
    } finally {
      db.close();
    }
    const ledger = diagnostics.filter(({ event_name }) => event_name.startsWith("ohtia.work."));
    expect(ledger).toEqual([
      { event_name: "ohtia.work.reserved" },
      { event_name: "ohtia.work.released" },
      { event_name: dispatched ? "ohtia.work.settled" : "ohtia.work.released" },
    ]);
  },
);

it("keeps proof of zero dispatch when Stop follows a data-service clock cut", async () => {
  for (const researcherStopped of [true, false]) {
    const f = await fixture();
    const proposal = await f.propose([call("Compare bibliographies.")], "Ask Josefa.");
    value(
      await f.run({
        command: "consultation.accept",
        operationId: "accept-cut-race",
        payload: { proposalId: proposal.id, connection: "chatgpt" },
      }),
    );
    const notice = (await f.timeline()).items.find(
      (item) => item.kind === "task" && item.consultation,
    );
    expect(notice).toBeDefined();
    const messages: unknown[] = [];
    const generation = "setup-tests";
    let time = Date.UTC(2026, 10, 19);
    const provider = new DurableProvider({
      storage: f.store,
      context: { generation, mode: "development", connections: setupConnections() },
      send: (message) => messages.push(JSON.parse(message)),
      wallClock: () => time,
      monotonic: () => time,
    });
    await provider.pump();
    const attempt = messages.flatMap((message) => {
      const dispatch = decodeProviderDispatch(JSON.stringify(message), generation);
      return dispatch ? [dispatch.request.attempt] : [];
    })[0]!;
    const suspendedAt = new Date(time).toISOString();
    time += 700000;
    provider.wake({
      kind: "service_wake",
      version: 1,
      generation,
      suspendedAt,
      resumedAt: new Date(time).toISOString(),
      asleepMs: 700000,
    });
    expect(messages).toContainEqual(
      expect.objectContaining({ kind: "provider_interrupt", attempt }),
    );
    if (researcherStopped)
      value(
        await f.run({
          command: "task.stop",
          operationId: "stop-after-cut",
          payload: { taskId: notice!.id },
        }),
      );
    expect(
      await provider.receive({
        kind: "provider_event",
        version: 1,
        generation,
        attempt,
        event: { type: "result", sequence: 1, result: { status: "cancelled" } },
        work: { dispatched: false, input_bytes: 0, output_bytes: 0, work_ms: 0 },
      }),
    ).toBe(true);
    const db = f.raw();
    try {
      expect(
        db
          .prepare("SELECT state,dispatch_permitted_at,outcome_reason FROM attempts WHERE id=?")
          .get(bytes(attempt)),
      ).toEqual({
        state: "cancelled",
        dispatch_permitted_at: null,
        outcome_reason: researcherStopped ? "cancelled_by_researcher" : "permit_expired",
      });
      expect(
        db.prepare("SELECT state FROM work_allocations ORDER BY attempt_number").pluck().all(),
      ).toEqual(["released", researcherStopped ? "released" : "held"]);
    } finally {
      db.close();
    }
  }
});

describe("Virgilio plan proposals", () => {
  const purpose = "Compare search strategies for two possible thesis questions.";
  const sharedContext = "The researcher chose open catalogs. Institutional access is unknown.";
  const first = {
    key: "vocabulary",
    agent: "josefa",
    request: "**Prepare** vocabulary for the first question.",
    reason: "The researcher needs a starting vocabulary.",
    required: true,
    depends_on: [],
  };
  const second = {
    ...first,
    key: "comparison",
    request: "Compare the vocabulary with terms for the candidate second question.",
    reason: "The plans must make their coverage comparable.",
    depends_on: ["vocabulary"],
  };
  const planCall = (
    contributions: readonly unknown[] = [first, second],
    fields: Record<string, unknown> = {},
  ): ProviderToolCall => ({
    namespace: "ohtia",
    name: "propose_plan",
    arguments: JSON.stringify({ purpose, shared_context: sharedContext, contributions, ...fields }),
  });
  const record = async (
    f: Awaited<ReturnType<typeof fixture>>,
    calls: readonly ProviderToolCall[],
  ) => {
    await f.append("PRIVATE conversation detail that Josefa must not receive.");
    const task = await f.prepare();
    value(await f.store.recordTaskEvent(task.dispatch.request.attempt, completed, "", calls));
    const proposal = (await f.timeline()).items.find(
      (item) => item.kind === "plan" && item.taskId === task.taskId,
    );
    if (!proposal || proposal.kind !== "plan") throw new Error("Expected a plan timeline item.");
    return { task, proposal };
  };
  async function read(f: Awaited<ReturnType<typeof fixture>>, planId: string) {
    const result = value(
      await f.store.readResearch({
        ...identity,
        operation: "plan.read",
        payload: { planId },
      }),
    );
    expect(researchOutput("plan.read", result)).toBe(true);
    return result as import("../packages/contracts/src/index.js").PlanSnapshot;
  }
  async function planService(f: Awaited<ReturnType<typeof fixture>>) {
    const generation = identity.serviceGeneration;
    const sent: string[] = [];
    const lost = vi.fn();
    const service = createStatusService(
      generation,
      "en-US",
      (text) => sent.push(text),
      f.store,
      lost,
      "development",
    );
    service.receive(
      JSON.stringify({
        kind: "connection_state",
        generation,
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
        generation,
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
    return {
      service,
      sent,
      lost,
      dispatches: () =>
        sent.flatMap((message) => decodeProviderDispatch(message, generation)?.request ?? []),
      receiveEvent(attempt: string, event: ProviderEventMessage["event"]) {
        service.receive(
          JSON.stringify({ kind: "provider_event", version: 1, generation, attempt, event }),
        );
      },
    };
  }

  const planConnections = { josefa: "chatgpt", virgilio: "chatgpt" } as const;

  const changeToolSpec = JSON.parse(
    readFileSync("docs/epics/EPIC-003-research-agents/epic.md", "utf8")
      .split("### SPEC-003-035: Plan redirection")[1]!
      .split("```json")[1]!
      .split("```")[0]!,
  ) as Record<string, unknown>;

  const redirect = (fields: Record<string, unknown>): ProviderToolCall => ({
    namespace: "ohtia",
    name: "propose_plan_change",
    arguments: JSON.stringify({
      new_purpose: "",
      replace_shared_context: false,
      shared_context: "",
      remove: [],
      replace: [],
      add: [],
      ...fields,
    }),
  });

  async function recordChange(f: Awaited<ReturnType<typeof fixture>>, calls: ProviderToolCall[]) {
    await f.append("Change the plan to use only what serves the revised research question.");
    const guidance = await f.prepare();
    expect(guidance.dispatch.request.operation).toBe("direct_guidance");
    const tools = decodeProviderDispatch(JSON.stringify(guidance.dispatch), "setup-tests")?.request
      .tools;
    expect(tools?.map(({ name }) => name)).toEqual(["propose_plan_change", "update_memory"]);
    expect(tools?.[0]).toEqual({
      ...Object.fromEntries(Object.entries(changeToolSpec).filter(([key]) => key !== "type")),
      namespace: "ohtia",
    });
    value(await f.store.recordTaskEvent(guidance.dispatch.request.attempt, completed, "", calls));
    const change = (await f.timeline()).items.find(
      (item) => item.kind === "planChangeProposal" && item.taskId === guidance.taskId,
    );
    if (!change || change.kind !== "planChangeProposal") throw new Error("Expected a plan change.");
    return change;
  }

  it("stops replaced work first and synthesizes the changed question with immutable results", async () => {
    const f = await fixture();
    const third = {
      ...second,
      key: "appendix",
      request: "Prepare an appendix.",
      depends_on: ["comparison"],
    };
    const { proposal } = await record(f, [planCall([first, second, third])]);
    const accept = (planId: string) =>
      f.run({
        command: "plan.accept",
        operationId: "approve-redirection-plan",
        payload: { planId, connections: planConnections },
      });
    value(await accept(proposal.id));
    const vocabulary = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        vocabulary.dispatch.request.attempt,
        completed,
        "Vocabulary for the first question.",
      ),
    );
    const priorComparison = await f.prepare();
    expect(priorComparison.dispatch.request.input[1]?.text).toContain(second.request);
    const request = "Prepare a new comparison under the revised question. " + "한".repeat(1500);
    const revisedPurpose = "Compare terms for the revised thesis question.";
    const revisedContext = "The researcher confirmed use of open catalogs only.";
    const change = await recordChange(f, [
      redirect({
        new_purpose: revisedPurpose,
        replace_shared_context: true,
        shared_context: revisedContext,
        remove: ["appendix"],
        replace: [
          {
            key: "comparison",
            request,
            reason: "Use the revised question.",
            required: false,
            depends_on: [],
          },
        ],
      }),
    ]);
    expect(change).toMatchObject({ rank: 2, revision: 1, state: "proposed" });
    const previewInput = {
      ...identity,
      operation: "planChange.read",
      payload: { conversationId: f.conversationId, proposalId: change.id },
    } as const;
    const preview = value(await f.store.readResearch(previewInput));
    expect(researchOutput("planChange.read", preview)).toBe(true);
    const previewData = preview as ResearchOutputs["planChange.read"];
    const replacementRow = previewData.replaced[0]!;
    for (const key of ["comparison!", "comparison\ntrailing", "a".repeat(65)]) {
      expect(
        researchOutput("planChange.read", {
          ...previewData,
          replaced: [{ ...replacementRow, after: { ...replacementRow.after, key } }],
        }),
      ).toBe(false);
    }
    expect(
      encodeEnvelope({ ...previewInput, kind: "result", payload: { ok: true, value: preview } }).ok,
    ).toBe(true);
    expect(preview).toMatchObject({
      replaced: [
        {
          before: { key: "comparison", taskState: "running" },
          after: {
            request: { bytes: Buffer.byteLength(request), parts: 2 },
            changed: ["request", "reason", "required", "prerequisites"],
          },
        },
      ],
      removed: [{ key: "appendix" }],
      unchanged: [{ key: "vocabulary", state: "completed" }],
    });
    const apply = {
      command: "planChange.apply",
      operationId: "apply-redirection",
      payload: { proposalId: change.id },
    } as const;
    expect(value(await f.run(apply))).toEqual({ resultId: change.id });
    expect(value(await f.run(apply))).toEqual({ resultId: change.id });
    expect(await read(f, proposal.id)).toMatchObject({
      purpose: revisedPurpose,
      sharedContext: revisedContext,
      graphVersion: 2,
      contributions: [
        { key: "vocabulary", state: "completed" },
        { key: "comparison", state: "waiting" },
      ],
    });
    expect(value(await f.store.prepareTask())).toBeNull();
    const db = f.raw();
    try {
      expect(
        db
          .prepare("SELECT purpose,shared_context FROM interventions WHERE id=?")
          .get(bytes(proposal.id)),
      ).toEqual({ purpose, shared_context: sharedContext });
      expect(
        db
          .prepare(
            "SELECT plan_key,cancellation_reason FROM contributions WHERE intervention_id=? ORDER BY rowid",
          )
          .all(bytes(proposal.id)),
      ).toEqual([
        { plan_key: "vocabulary", cancellation_reason: null },
        { plan_key: "comparison", cancellation_reason: "superseded" },
        { plan_key: "appendix", cancellation_reason: "removed_by_researcher" },
        { plan_key: "comparison", cancellation_reason: null },
      ]);
    } finally {
      db.close();
    }
    value(
      await f.store.recordTaskEvent(
        priorComparison.dispatch.request.attempt,
        {
          type: "result",
          sequence: 2,
          result: { status: "cancelled" },
        },
        "",
      ),
    );
    const replacement = await f.prepare();
    expect(replacement.acceptedByOperationId).toBe("apply-redirection");
    expect(replacement.dispatch.request.input[1]?.text).toContain(revisedContext);
    expect(replacement.dispatch.request.input[1]?.text).toContain(request);
    expect(replacement.transfer).toContainEqual({ kind: "plan_context", reference: change.id });
    value(
      await f.store.recordTaskEvent(
        replacement.dispatch.request.attempt,
        completed,
        "Comparison for the revised question.",
      ),
    );
    const synthesis = await f.prepare();
    expect(synthesis.dispatch.request).toMatchObject({
      operation: "contribution_synthesis",
      policy_version: 3,
      instruction_version: 3,
    });
    const input = synthesis.dispatch.request.input.map(({ text }) => text).join("\n");
    expect(input).toContain(revisedPurpose);
    expect(input).toContain(purpose);
    expect(input).toContain(first.request);
    expect(input).toContain("Vocabulary for the first question.");
    expect(input).toContain("removed by the researcher in a plan change; it has no result.");
    expect(input).toContain(
      "replaced in a plan change by the later contribution with the same key; it has no result.",
    );
    expect(input).not.toContain(third.request);
    value(
      await f.store.recordTaskEvent(
        synthesis.dispatch.request.attempt,
        completed,
        "The original vocabulary has limited relevance.",
      ),
    );
    const timeline = (await f.timeline()).items;
    expect(timeline.find(({ id }) => id === change.id)).toMatchObject({
      state: "applied",
      revision: 2,
    });
    expect(
      timeline.find((item) => item.kind === "message" && item.taskId === synthesis.taskId),
    ).toMatchObject({
      synthesisSources: [
        { key: "vocabulary", state: "completed" },
        { key: "comparison", state: "replaced" },
        { key: "appendix", state: "removed" },
        { key: "comparison", state: "completed" },
      ],
    });
    const next = await record(f, [planCall()]);
    const after = f.raw();
    try {
      const row = after
        .prepare("SELECT previous_plan_id FROM interventions WHERE id=?")
        .get(bytes(next.proposal.id)) as { previous_plan_id: Uint8Array };
      expect(Buffer.from(row.previous_plan_id)).toEqual(bytes(proposal.id));
    } finally {
      after.close();
    }
    expect(
      next.task.dispatch.request.input.some(
        ({ text }) =>
          text ===
          "Note from Ohtia: at this point you proposed a plan change that the researcher applied.",
      ),
    ).toBe(true);
  });

  it("keeps a stale proposal open and rejects incomplete graph repairs without writing", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    value(
      await f.run({
        command: "plan.accept",
        operationId: "stale-plan",
        payload: { planId: proposal.id, connections: planConnections },
      }),
    );
    const vocabulary = await f.prepare();
    const invalid = await recordChange(f, [redirect({ remove: ["vocabulary"] })]);
    expect(invalid).toMatchObject({
      rank: 2,
      revision: 1,
      state: "invalid",
      invalidReason: "dependency_removed",
    });
    const valid = await recordChange(f, [
      redirect({
        replace: [
          {
            key: "vocabulary",
            request: "Revisit candidate terms.",
            reason: first.reason,
            required: true,
            depends_on: [],
          },
        ],
      }),
    ]);
    value(
      await f.store.recordTaskEvent(
        vocabulary.dispatch.request.attempt,
        completed,
        "Candidate terms.",
      ),
    );
    const apply = {
      command: "planChange.apply",
      operationId: "stale-apply",
      payload: { proposalId: valid.id },
    } as const;
    expect(await f.run(apply)).toEqual({
      ok: false,
      error: {
        code: "plan_change_invalid",
        nextAction: "check_request",
        parameters: { reason: "plan_moved_on" },
      },
    });
    expect((await f.timeline()).items.find(({ id }) => id === valid.id)).toMatchObject({
      state: "proposed",
      revision: 1,
    });
    expect((await read(f, proposal.id)).graphVersion).toBe(1);
    const db = f.raw();
    try {
      expect(
        db
          .prepare("SELECT result_id FROM command_receipts WHERE operation_id=?")
          .get("stale-apply"),
      ).toBeUndefined();
    } finally {
      db.close();
    }
    const decline = {
      command: "planChange.decline",
      operationId: "stale-decline",
      payload: { proposalId: valid.id },
    } as const;
    expect(value(await f.run(decline))).toEqual({ resultId: valid.id });
    expect((await f.timeline()).items.find(({ id }) => id === valid.id)).toMatchObject({
      state: "declined",
      revision: 2,
    });
  });

  it("persists validation reasons with the first arguments while a valid proposal remains open", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    value(
      await f.run({
        command: "plan.accept",
        operationId: "validation-plan",
        payload: { planId: proposal.id, connections: planConnections },
      }),
    );
    const active = await f.prepare();
    const available = await recordChange(f, [redirect({ new_purpose: "A revised purpose." })]);
    const candidate = { ...first, key: "new-work", request: "Prepare another comparison." };
    const cases: [string, Record<string, unknown>][] = [
      ["too_many_changes", { remove: Array.from({ length: 9 }, (_, index) => String(index)) }],
      ["empty_change", {}],
      ["empty_change", { new_purpose: purpose }],
      ["empty_change", { replace_shared_context: true, shared_context: sharedContext }],
      ["unknown_contribution", { remove: ["missing"] }],
      ["agent_not_authorized", { add: [{ ...candidate, agent: "virgilio" }] }],
      [
        "plan_too_large",
        {
          add: Array.from({ length: 7 }, (_, index) => ({
            ...candidate,
            key: "new-" + String(index),
            request: "Request " + String(index),
          })),
        },
      ],
      ["unknown_prerequisite", { add: [{ ...candidate, depends_on: ["missing"] }] }],
      ["self_dependency", { add: [{ ...candidate, depends_on: ["new-work"] }] }],
      [
        "cycle",
        {
          replace: [
            {
              key: first.key,
              request: first.request,
              reason: first.reason,
              required: true,
              depends_on: ["comparison"],
            },
          ],
        },
      ],
      ["duplicate_contribution", { add: [{ ...first, key: "new-work" }] }],
      ["plan_key_invalid", { add: [{ ...candidate, key: "new!" }] }],
      ["plan_key_duplicate", { add: [{ ...candidate, key: first.key }] }],
      ["plan_key_duplicate", { remove: [first.key], add: [{ ...candidate, key: first.key }] }],
      ["request_empty", { add: [{ ...candidate, request: " " }] }],
      ["request_too_large", { add: [{ ...candidate, request: "x".repeat(8193) }] }],
      ["purpose_empty", { new_purpose: " " }],
      ["purpose_too_long", { new_purpose: "x".repeat(2001) }],
      [
        "shared_context_too_large",
        { replace_shared_context: true, shared_context: "x".repeat(32769) },
      ],
      ["reason_empty", { add: [{ ...candidate, reason: " " }] }],
      ["reason_too_long", { add: [{ ...candidate, reason: "x".repeat(501) }] }],
    ];
    for (const [invalidReason, args] of cases)
      expect(await recordChange(f, [redirect(args)])).toMatchObject({
        state: "invalid",
        rank: 2,
        revision: 1,
        invalidReason,
      });
    const duplicate = await recordChange(f, [
      redirect({ new_purpose: "First" }),
      redirect({ new_purpose: "Second" }),
    ]);
    expect(duplicate).toMatchObject({ state: "invalid", invalidReason: "multiple_calls" });
    const db = f.raw();
    try {
      const row = db
        .prepare("SELECT change FROM graph_change_proposals WHERE id=?")
        .get(bytes(duplicate.id)) as { change: string };
      expect(JSON.parse(row.change)).toMatchObject({ new_purpose: "First" });
    } finally {
      db.close();
    }
    const newer = await recordChange(f, [redirect({ new_purpose: "Newer purpose." })]);
    expect(
      value(
        await f.store.readResearch({
          ...identity,
          operation: "timeline.read",
          payload: { conversationId: f.conversationId, ids: [available.id] },
        }),
      ),
    ).toMatchObject({ items: [{ state: "replaced", rank: 2, revision: 2 }] });
    expect(newer.state).toBe("proposed");
    value(
      await f.store.recordTaskEvent(active.dispatch.request.attempt, completed, "Original result."),
    );
    expect(await recordChange(f, [redirect({ remove: [first.key] })])).toMatchObject({
      state: "invalid",
      invalidReason: "contribution_completed",
    });
  });

  it("records a continuation on removal and delays synthesis until the provider stops", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    value(
      await f.run({
        command: "plan.accept",
        operationId: "ready-by-removal",
        payload: { planId: proposal.id, connections: planConnections },
      }),
    );
    const vocabulary = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        vocabulary.dispatch.request.attempt,
        completed,
        "Original result.",
      ),
    );
    const comparison = await f.prepare();
    const change = await recordChange(f, [redirect({ remove: ["comparison"] })]);
    value(
      await f.run({
        command: "planChange.apply",
        operationId: "remove-running",
        payload: { proposalId: change.id },
      }),
    );
    expect(await read(f, proposal.id)).toMatchObject({
      outcome: "complete",
      continuation: { admission: "waiting" },
      contributions: [{ key: "vocabulary", state: "completed" }],
    });
    expect(value(await f.store.prepareTask())).toBeNull();
    value(
      await f.store.recordTaskEvent(
        comparison.dispatch.request.attempt,
        {
          type: "result",
          sequence: 2,
          result: { status: "cancelled" },
        },
        "",
      ),
    );
    const synthesis = await f.prepare();
    expect(synthesis.kind).toBe("synthesis");
  });

  it("cancels work from a closed provider generation with one event", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    value(
      await f.run({
        command: "plan.accept",
        operationId: "previous-generation",
        payload: { planId: proposal.id, connections: planConnections },
      }),
    );
    const previous = await f.prepare();
    const change = await recordChange(f, [
      redirect({
        replace: [
          {
            key: first.key,
            request: "Revisit the candidate terms.",
            reason: first.reason,
            required: true,
            depends_on: [],
          },
        ],
      }),
    ]);
    f.store.setTaskContext({
      generation: "replacement-generation",
      mode: "development",
      connections: setupConnections(),
    });
    value(
      await f.run({
        command: "planChange.apply",
        operationId: "previous-generation-stop",
        payload: { proposalId: change.id },
      }),
    );
    const db = f.raw();
    try {
      expect(
        db
          .prepare(
            "SELECT kind FROM intervention_events WHERE task_id=? AND kind='contribution_cancelled'",
          )
          .all(bytes(previous.taskId)),
      ).toEqual([{ kind: "contribution_cancelled" }]);
    } finally {
      db.close();
    }
    const replacement = await f.prepare();
    expect(replacement.dispatch.request.input[1]?.text).toContain("Revisit the candidate terms.");
  });

  it("replaces a previously removed key and keeps a later over-cap decision open", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    value(
      await f.run({
        command: "plan.accept",
        operationId: "keep-plan-open",
        payload: { planId: proposal.id, connections: planConnections },
      }),
    );
    await f.prepare();
    const removal = await recordChange(f, [redirect({ remove: [second.key] })]);
    value(
      await f.run({
        command: "planChange.apply",
        operationId: "remove-waiting",
        payload: { proposalId: removal.id },
      }),
    );
    expect((await read(f, proposal.id)).contributions.map(({ key }) => key)).toEqual([first.key]);
    const readPreview = (proposalId: string) =>
      f.store.readResearch({
        ...identity,
        operation: "planChange.read",
        payload: { conversationId: f.conversationId, proposalId },
      });
    const sameDependencies = await recordChange(f, [
      redirect({
        replace: [
          {
            key: second.key,
            request: "Compare the revised questions.",
            reason: second.reason,
            required: second.required,
            depends_on: second.depends_on,
          },
        ],
      }),
    ]);
    expect(value(await readPreview(sameDependencies.id))).toMatchObject({
      replaced: [
        { before: { state: "cancelled", key: second.key }, after: { changed: ["request"] } },
      ],
    });
    const replacement = await recordChange(f, [
      redirect({
        replace: [
          {
            key: second.key,
            request: second.request,
            reason: second.reason,
            required: second.required,
            depends_on: [],
          },
        ],
      }),
    ]);
    expect(value(await readPreview(replacement.id))).toMatchObject({
      replaced: [
        { before: { state: "cancelled", key: second.key }, after: { changed: ["prerequisites"] } },
      ],
    });
    value(
      await f.run({
        command: "planChange.apply",
        operationId: "replace-removed",
        payload: { proposalId: replacement.id },
      }),
    );
    expect(value(await readPreview(replacement.id))).toMatchObject({
      replaced: [
        { before: { state: "cancelled", key: second.key }, after: { changed: ["prerequisites"] } },
      ],
    });
    expect(
      (await read(f, proposal.id)).contributions.map(({ key, state }) => ({ key, state })),
    ).toEqual([
      { key: first.key, state: "active" },
      { key: second.key, state: "active" },
    ]);
    const capped = await recordChange(f, [
      redirect({ new_purpose: "A revised purpose after the cap." }),
    ]);
    const db = f.raw();
    try {
      db.exec(
        "WITH RECURSIVE events(n) AS (SELECT max(sequence)+1 FROM intervention_events UNION ALL SELECT n+1 FROM events WHERE n<512) " +
          "INSERT INTO intervention_events SELECT randomblob(16),intervention_id,n,kind,NULL,NULL,payload,payload_sha256,created_at " +
          "FROM events JOIN intervention_events ON sequence=1",
      );
      expect(
        db
          .prepare(
            "SELECT summary FROM graph_changes WHERE kind='plan_changed' ORDER BY graph_version DESC LIMIT 1",
          )
          .pluck()
          .get(),
      ).toContain('"previousCancellationReason":"removed_by_researcher"');
    } finally {
      db.close();
    }
    expect(
      await f.run({
        command: "planChange.apply",
        operationId: "event-limit",
        payload: { proposalId: capped.id },
      }),
    ).toEqual(failure("event_limit_reached"));
    expect((await f.timeline()).items.find(({ id }) => id === capped.id)).toMatchObject({
      state: "proposed",
      revision: 1,
    });
  });

  it("migrates a populated revision 27 through the checkpoint path with cancellation reasons", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    value(
      await f.run({
        command: "plan.accept",
        operationId: "accept-old-plan",
        payload: { planId: proposal.id, connections: planConnections },
      }),
    );
    value(
      await f.run({
        command: "plan.cancel",
        operationId: "stop-old-plan",
        payload: { planId: proposal.id },
      }),
    );
    await f.store.close(true);
    const old = f.raw();
    try {
      old.exec("PRAGMA foreign_keys=OFF; " + preRedirectionSql);
      expect(old.pragma("user_version", { simple: true })).toBe(27);
      expect(old.pragma("foreign_key_check")).toEqual([]);
    } finally {
      old.close();
    }
    await f.store.open();
    const upgraded = f.raw();
    try {
      expect(upgraded.pragma("user_version", { simple: true })).toBe(36);
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
      expect(
        upgraded.prepare("SELECT cancellation_reason FROM contributions ORDER BY rowid").all(),
      ).toEqual([
        { cancellation_reason: "plan_cancelled" },
        { cancellation_reason: "plan_cancelled" },
      ]);
    } finally {
      upgraded.close();
    }
    expect(await read(f, proposal.id)).toMatchObject({ outcome: "cancelled", graphVersion: 1 });
  });

  it.each(["plan.accept", "plan.decline"] as const)(
    "returns a receipt through IPC and applies the decision when running %s",
    async (operation) => {
      const f = await fixture();
      const { proposal } = await record(f, [planCall()]);
      const h = await planService(f);
      try {
        const accept = operation === "plan.accept";
        const requestId = "plan-decision";
        const request = {
          ...identity,
          requestId,
          operationId: requestId,
          operation,
          payload: accept
            ? { planId: proposal.id, connections: planConnections }
            : { planId: proposal.id },
        };
        for (const id of [requestId, "repeat-plan-decision"]) {
          h.service.receive(value(encodeEnvelope({ ...request, requestId: id })));
          await h.service.drain();
          expect(h.sent.map((message) => JSON.parse(message))).toContainEqual({
            ...request,
            requestId: id,
            kind: "result",
            payload: { ok: true, value: { resultId: proposal.id } },
          });
        }
        expect((await read(f, proposal.id)).state).toBe(accept ? "accepted" : "declined");
        expect(h.dispatches().map(({ operation }) => operation)).toEqual(
          accept ? ["search_strategy_planning"] : [],
        );
        expect(h.lost).not.toHaveBeenCalled();
      } finally {
        h.service.dispose();
      }
    },
  );

  it.each(["usage", "result"] as const)(
    "keeps a plan running when a short SQLite read overlaps a provider %s commit",
    async (eventType) => {
      const f = await fixture();
      const { proposal } = await record(f, [planCall()]);
      value(
        await f.run({
          command: "plan.accept",
          operationId: "accept-before-reader",
          payload: { planId: proposal.id, connections: planConnections },
        }),
      );
      const h = await planService(f);
      const reader = f.raw();
      try {
        const [contribution] = h.dispatches();
        expect(contribution?.operation).toBe("search_strategy_planning");
        const attempt = contribution!.attempt;
        h.receiveEvent(attempt, { type: "text", sequence: 1, text: "Candidate search terms." });
        await h.service.drain();
        reader.exec("BEGIN");
        reader.prepare("SELECT count(*) FROM tasks").get();
        const prepare = Database.prototype.prepare;
        const busyCodes: string[] = [];
        const commit = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
          query,
          ...args
        ) {
          const statement = prepare.call(this, query, ...args);
          if (query === "COMMIT") {
            const run = statement.run.bind(statement);
            statement.run = (...bindings: unknown[]) => {
              try {
                return run(...bindings);
              } catch (error) {
                if (error instanceof Database.SqliteError) busyCodes.push(error.code);
                if (reader.inTransaction) reader.exec("ROLLBACK");
                throw error;
              }
            };
          }
          return statement;
        });
        try {
          h.receiveEvent(
            attempt,
            eventType === "usage"
              ? {
                  type: "usage",
                  sequence: 2,
                  usage: {
                    input_tokens: 100,
                    cached_input_tokens: 0,
                    output_tokens: 20,
                    reasoning_tokens: 0,
                  },
                }
              : { ...completed, sequence: 2 },
          );
          await h.service.drain();
        } finally {
          commit.mockRestore();
        }
        expect(busyCodes).toEqual(["SQLITE_BUSY"]);
        expect(h.lost).not.toHaveBeenCalled();
        if (eventType === "usage") {
          expect(
            reader
              .prepare("SELECT output_tokens FROM attempts WHERE id = ?")
              .pluck()
              .get(bytes(attempt)),
          ).toBe(20);
          h.receiveEvent(attempt, { ...completed, sequence: 3 });
          await h.service.drain();
        }
        const dependent = h.dispatches()[1];
        expect(dependent?.operation).toBe("search_strategy_planning");
        h.receiveEvent(dependent!.attempt, {
          type: "text",
          sequence: 1,
          text: "Compare the terms.",
        });
        h.receiveEvent(dependent!.attempt, { ...completed, sequence: 2 });
        await h.service.drain();
        const synthesis = h.dispatches()[2];
        expect(synthesis?.operation).toBe("contribution_synthesis");
        h.receiveEvent(synthesis!.attempt, {
          type: "text",
          sequence: 1,
          text: "Both results are available.",
        });
        h.receiveEvent(synthesis!.attempt, { ...completed, sequence: 2 });
        await h.service.drain();
        expect(h.dispatches()).toHaveLength(3);
        const plan = await read(f, proposal.id);
        expect(plan.outcome).toBe("complete");
        expect(plan.continuation?.taskState).toBe("completed");
        expect(h.lost).not.toHaveBeenCalled();
      } finally {
        if (reader.inTransaction) reader.exec("ROLLBACK");
        reader.close();
        h.service.dispose();
      }
    },
  );

  it("keeps invalid tool-only plans and their notes without replacing a valid proposal", async () => {
    const f = await fixture();
    const replies: string[] = [];
    const stop = f.store.observeResearchActivity((event) => {
      if (event.kind === "replyFinished") replies.push(event.agentId);
    });
    const { proposal: open } = await record(f, [planCall()]);
    expect(open).toMatchObject({ state: "proposed", rank: 2, revision: 1 });
    expect(replies.splice(0)).toEqual(["virgilio"]);
    for (const [calls, reason] of [
      [[planCall([])], "empty_plan"],
      [[planCall([first])], "too_few_contributions"],
      [[planCall([first, { ...second, reason: undefined }])], "reason_empty"],
      [[planCall([first, { ...second, reason: "한".repeat(501) }])], "reason_too_long"],
      [[planCall(), call("One consultation")], "multiple_calls"],
      [[planCall([first, { ...second, depends_on: ["missing"] }])], "unknown_prerequisite"],
      [[planCall([], { contributions: Array(9).fill(first) })], "plan_too_large"],
      [[planCall(undefined, { purpose: " " })], "purpose_empty"],
      [[planCall(undefined, { purpose: "한".repeat(2001) })], "purpose_too_long"],
      [[planCall(undefined, { shared_context: "한".repeat(11000) })], "shared_context_too_large"],
      [[planCall([first, { ...second, request: " " }])], "request_empty"],
      [[planCall([first, { ...second, request: "한".repeat(2731) }])], "request_too_large"],
      [[planCall([first, { ...second, key: "bad\n" }])], "plan_key_invalid"],
      [[planCall([first, { ...second, key: first.key, depends_on: [] }])], "plan_key_duplicate"],
      [[planCall([first, { ...first, key: second.key }])], "duplicate_contribution"],
      [[planCall([first, { ...second, depends_on: [second.key] }])], "self_dependency"],
      [[planCall([{ ...first, depends_on: [second.key] }, second])], "cycle"],
      [[planCall([first, { ...second, agent: "virgilio" }])], "agent_unavailable"],
    ] as const) {
      const { proposal } = await record(f, calls);
      expect(proposal).toMatchObject({
        state: "invalid",
        invalidReason: reason,
        rank: 2,
        revision: 1,
      });
      expect((await read(f, open.id)).state).toBe("proposed");
      expect(replies.splice(0)).toEqual(["virgilio"]);
    }
    const { task, proposal: newer } = await record(f, [planCall()]);
    stop();
    expect(replies).toEqual(["virgilio"]);
    expect(
      task.dispatch.request.input.some(({ text }) =>
        text.includes("failed the check reason_empty"),
      ),
    ).toBe(true);
    expect((await read(f, open.id)).state).toBe("replaced");
    expect(
      await f.run({
        command: "plan.decline",
        operationId: "stale-decline",
        payload: { planId: open.id },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "proposal_not_waiting", nextAction: "refresh_record" },
    });
    const decline = {
      command: "plan.decline",
      operationId: "decline-plan",
      payload: { planId: newer.id },
    } as const;
    expect(value(await f.run(decline))).toEqual({ resultId: newer.id });
    expect(value(await f.run(decline))).toEqual({ resultId: newer.id });
    expect((await read(f, newer.id)).state).toBe("declined");
    expect(value(await f.store.prepareTask())).toBeNull();
  });

  it("checks displayed connections, authorizes only the approved graph and withholds tools during it", async () => {
    const f = await fixture();
    const { task, proposal } = await record(f, [planCall([second, first])]);
    const request = decodeProviderDispatch(JSON.stringify(task.dispatch), "setup-tests")?.request;
    expect(request).toMatchObject({
      policy_version: 6,
      instruction_version: 6,
      limits: { max_output_bytes: 192 * 1024 },
      tools: [
        { name: "propose_consultation" },
        {
          name: "propose_plan",
          strict: true,
          parameters: {
            required: ["purpose", "shared_context", "contributions"],
            properties: {
              contributions: {
                type: "array",
                items: {
                  additionalProperties: false,
                  properties: { agent: { enum: ["josefa"] } },
                  required: ["key", "agent", "request", "reason", "required", "depends_on"],
                },
              },
            },
          },
        },
        { name: "propose_handoff" },
        { name: "update_memory" },
      ],
    });
    expect((await read(f, proposal.id)).contributions.map(({ key }) => key)).toEqual([
      "vocabulary",
      "comparison",
    ]);
    expect(value(await f.store.prepareTask())).toBeNull();
    const accept = {
      command: "plan.accept",
      operationId: "accept-plan",
      payload: { planId: proposal.id, connections: { josefa: "chatgpt", virgilio: "chatgpt" } },
    } as const;
    f.destination("fake");
    expect(await f.run(accept)).toMatchObject({
      ok: false,
      error: { code: "destination_changed" },
    });
    expect((await read(f, proposal.id)).state).toBe("proposed");
    f.destination("chatgpt");
    expect(value(await f.run(accept))).toEqual({ resultId: proposal.id });
    expect(value(await f.run(accept))).toEqual({ resultId: proposal.id });
    const db = f.raw();
    try {
      expect(
        db
          .prepare("SELECT decided_at, decided_by_operation_id FROM interventions WHERE id = ?")
          .get(bytes(proposal.id)),
      ).toMatchObject({ decided_at: expect.any(String), decided_by_operation_id: "accept-plan" });
    } finally {
      db.close();
    }
    expect(await read(f, proposal.id)).toMatchObject({
      state: "accepted",
      revision: 2,
      connections: { josefa: "chatgpt", virgilio: "chatgpt" },
      maxRequests: 24,
      contributions: [{ request: first.request }, { request: second.request }],
    });
    await f.append("What can I prepare independently?");
    const next = await f.prepare();
    const specialist = next.kind === "contribution" ? next : null;
    const guidance = specialist ? await f.prepare() : next;
    expect(
      guidance.dispatch.request.tools.some(
        ({ name }) => name === "propose_plan" || name === "propose_consultation",
      ),
    ).toBe(false);
    expect(
      guidance.dispatch.request.input.filter(({ text }) =>
        text.includes("and the researcher ran it"),
      ),
    ).toHaveLength(1);
    expect(guidance.dispatch.request.input.at(-1)?.text).toContain(
      "Plan state: running.\nContributions:\n- vocabulary (Josefa, required): working\n- comparison (Josefa, required, after vocabulary): waiting",
    );
    value(
      await f.store.recordTaskEvent(
        guidance.dispatch.request.attempt,
        completed,
        "Clarify the comparison criteria.",
      ),
    );
    const vocabulary = specialist ?? (await f.prepare());
    expect(vocabulary.dispatch.request.input).toEqual([
      { role: "user", text: "Project memory: no entries yet." },
      { role: "user", text: expect.stringContaining(sharedContext) },
    ]);
    expect(vocabulary.dispatch.request.input[1]?.text).toContain(first.request);
    expect(vocabulary.dispatch.request.input[1]?.text).not.toContain("PRIVATE");
    value(
      await f.store.recordTaskEvent(
        vocabulary.dispatch.request.attempt,
        completed,
        "Candidate vocabulary.",
      ),
    );
    const comparison = await f.prepare();
    expect(comparison.dispatch.request.input).toEqual([
      { role: "user", text: "Project memory: no entries yet." },
      { role: "user", text: expect.stringContaining(second.request) },
      { role: "user", text: expect.stringContaining("Candidate vocabulary.") },
    ]);
    value(
      await f.store.recordTaskEvent(
        comparison.dispatch.request.attempt,
        completed,
        "Access to catalogs remains unknown.",
      ),
    );
    await f.append("Is the comparison ready?");
    const whileSynthesizing = await f.prepare();
    expect(whileSynthesizing.dispatch.request.input.at(-1)?.text).toContain(
      "its contributions have ended and the synthesis is being written",
    );
    value(
      await f.store.recordTaskEvent(
        whileSynthesizing.dispatch.request.attempt,
        completed,
        "The synthesis is a separate reply.",
      ),
    );
    const synthesis = await f.prepare();
    expect(synthesis.dispatch.request.operation).toBe("contribution_synthesis");
    expect(JSON.stringify(synthesis.dispatch.request.input)).toContain(
      "Access to catalogs remains unknown.",
    );
    value(
      await f.store.recordTaskEvent(
        synthesis.dispatch.request.attempt,
        completed,
        "Compare access before committing to a design.",
      ),
    );
    f.destination("fake");
    expect((await read(f, proposal.id)).connections).toEqual(accept.payload.connections);
    expect((await f.timeline()).items).toContainEqual(
      expect.objectContaining({
        kind: "message",
        rank: 1,
        planContribution: { planId: proposal.id, key: first.key },
      }),
    );
  });
  it("refuses a reply’s stale proposal after an intervening approved plan has already finished", async () => {
    const f = await fixture();
    const { proposal } = await record(f, [planCall()]);
    await f.append("Keep clarifying the comparison while I review the plan.");
    const olderReply = await f.prepare();
    expect(olderReply.dispatch.request.tools).toContainEqual(
      expect.objectContaining({ name: "propose_plan" }),
    );
    value(
      await f.run({
        command: "plan.accept",
        operationId: "approve-during-reply",
        payload: { planId: proposal.id, connections: { josefa: "chatgpt", virgilio: "chatgpt" } },
      }),
    );
    for (const result of ["Candidate terms.", "Access remains unknown.", "Compare access first."]) {
      const work = await f.prepare();
      value(await f.store.recordTaskEvent(work.dispatch.request.attempt, completed, result));
    }
    expect((await read(f, proposal.id)).continuation?.taskState).toBe("completed");
    value(
      await f.store.recordTaskEvent(olderReply.dispatch.request.attempt, completed, "", [
        planCall(),
      ]),
    );
    expect((await f.timeline()).items).toContainEqual(
      expect.objectContaining({
        kind: "plan",
        taskId: olderReply.taskId,
        state: "invalid",
        invalidReason: "plan_unfinished",
      }),
    );
    const { proposal: later } = await record(f, [planCall()]);
    expect(later.state).toBe("proposed");
  });
});
