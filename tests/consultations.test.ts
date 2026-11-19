import { describe, expect, it } from "vitest";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { dispatchThrough } from "./fixtures/provider-conformance.js";
import {
  conversationTitlePolicy,
  decodeProviderDispatch,
  policyId,
  researchOutput,
  type ProviderToolCall,
  type ResearchCommand,
} from "../packages/contracts/src/index.js";
import { bytes } from "../packages/utility/src/research.js";
import { buildInput, operationPolicy } from "../packages/utility/src/operations.js";
import {
  consultationNote,
  decodeConsultationProposal,
} from "../packages/utility/src/consultations.js";
import { setupConnections, successful as value, proposeSetup } from "./fixtures/project-setup.js";
import { preConsultationSql, storageFixture } from "./fixtures/storage.js";

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
async function fixture(title = "Synthetic investigation") {
  const f = storageFixture();
  await f.store.open();
  f.store.setTaskContext({
    generation: "setup-tests",
    mode: "development",
    connections: setupConnections(),
  });
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
      policy_version: 2,
      tools: [{ name: "propose_consultation" }],
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
  return { ...f, run, append, prepare, timeline, propose, projectId, conversationId };
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
      policy_version: 2,
      tools: [],
      input: [
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
      text: "Message from Josefa, the reference librarian:\n\nCatalog access is unknown.",
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
    const first = await f.propose([call("Find terminology.")]);
    const invalid = await f.propose([call(""), call("Find catalogs.")]);
    expect(invalid).toMatchObject({
      state: "invalid",
      invalidReason: "multiple_calls",
      request: null,
    });
    expect((await f.timeline()).items).toContainEqual(first);
    const newer = await f.propose([call("Find catalogs.")]);
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
    expect(followup.dispatch.request.input.at(-1)?.text).toBe("Please explain the proposal.");
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
    expect(migrated.pragma("user_version", { simple: true })).toBe(21);
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
