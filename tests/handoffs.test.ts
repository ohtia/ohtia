import { describe, expect, it } from "vitest";
import {
  decodeProviderDispatch,
  failure,
  policyId,
  researchOutput,
  type DiagnosticEvent,
  type ProviderToolCall,
  type ResearchCommand,
  type ResearchOutputs,
} from "../packages/contracts/src/index.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { bytes } from "../packages/utility/src/research.js";
import {
  handoffProposalNote,
  handoffTool,
  readHandoffProposal,
} from "../packages/utility/src/handoffs.js";
import { dispatchThrough } from "./fixtures/provider-conformance.js";
import { proposeSetup, setupConnections, successful as value } from "./fixtures/project-setup.js";
import { storageFixture } from "./fixtures/storage.js";
import { preHandoffSql } from "../tooling/storage-legacy-consultation-fixture.mjs";

const generation = "setup-tests";
const identity = {
  kind: "request",
  protocol: 1,
  policy: policyId,
  requestId: "handoff-test",
  operationId: "handoff-test",
  windowGeneration: "window",
  serviceGeneration: generation,
} as const;
const propose = (
  note = "The researcher chose public schools. Database access is unknown.",
  reason = "Work with Josefa over several turns.",
  agent = "josefa",
): ProviderToolCall => ({
  namespace: handoffTool.namespace,
  name: handoffTool.name,
  arguments: JSON.stringify({ agent, note, reason }),
});
const completed = { type: "result", sequence: 1, result: { status: "completed" } } as const;
const section = "Ohtia\'s thesis research route";

async function fixture(log: DiagnosticEvent[] = []) {
  const f = storageFixture((event) => log.push(event));
  await f.store.open();
  const run = (command: ResearchCommand) => f.store.executeResearchCommand(command);
  const projectId = value(
    await run({ command: "project.create", operationId: "new-project", payload: {} }),
  ).resultId;
  const setup = await proposeSetup(f.store, f.raw, projectId);
  value(
    await run({
      command: "project.confirmSetup",
      operationId: "confirm",
      payload: { proposalId: setup },
    }),
  );
  const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
  let next = 0;
  const append = async (content: string, conversation = conversationId) =>
    value(
      await run({
        command: "message.append",
        operationId: `message-${++next}`,
        payload: { conversationId: conversation, content },
      }),
    );
  const prepare = async () => {
    const task = value(await f.store.prepareTask());
    if (!task) throw new Error("Expected a reply.");
    expect(decodeProviderDispatch(JSON.stringify(task.dispatch), generation)).toEqual(
      task.dispatch,
    );
    return task;
  };
  const settle = async (
    task: Awaited<ReturnType<typeof prepare>>,
    text: string,
    calls: readonly ProviderToolCall[] = [],
  ) => value(await f.store.recordTaskEvent(task.dispatch.request.attempt, completed, text, calls));
  const timeline = async (conversation = conversationId) => {
    const page = value(
      await f.store.readResearch({
        ...identity,
        operation: "timeline.listBefore",
        payload: { conversationId: conversation, cursor: null, count: 50 },
      }),
    ) as ResearchOutputs["timeline.listBefore"];
    expect(researchOutput("timeline.listBefore", page)).toBe(true);
    return page.items;
  };
  const proposal = async () => (await timeline()).find((item) => item.kind === "handoffProposal");
  const selection = async (expectedOwnerRevision: number, conversation = conversationId) =>
    value(
      await f.store.readResearch({
        ...identity,
        operation: "handoff.selection",
        payload: { conversationId: conversation, expectedOwnerRevision, after: 0 },
      }),
    ) as ResearchOutputs["handoff.selection"];
  return {
    ...f,
    run,
    append,
    prepare,
    settle,
    timeline,
    proposal,
    selection,
    projectId,
    conversationId,
  };
}

describe("conversation handoffs", () => {
  it("validates decoded note bytes and reason code points for every supported invalid proposal", () => {
    expect(
      readHandoffProposal([propose("é".repeat(16384), "𠀀".repeat(500))], true),
    ).toHaveProperty("note");
    const cases = [
      [propose(" "), true, "note_empty", "its note was empty"],
      [propose("é".repeat(16385)), true, "note_too_large", "its note was longer than 32,768 bytes"],
      [propose("Handoff", " "), true, "reason_empty", "it had no reason"],
      [
        propose("Handoff", "𠀀".repeat(501)),
        true,
        "reason_too_long",
        "its reason was longer than 500 characters",
      ],
      [
        propose("Handoff", "Reason", "virgilio"),
        true,
        "agent_unavailable",
        "it named an agent that isn't available",
      ],
      [propose(), false, "agent_unavailable", "it named an agent that isn't available"],
    ] as const;
    for (const [tool, available, reason, explanation] of cases) {
      expect(readHandoffProposal([tool], available)).toEqual({ invalid: reason });
      expect(handoffProposalNote({ state: "invalid", invalid_reason: reason })).toBe(
        "Note from Ohtia: at this point Ohtia did not accept your handoff proposal because " +
          explanation +
          ". The researcher was told.",
      );
    }
  });

  it("ignores a handoff the reply was never authorized to propose", async () => {
    const f = await fixture();
    await f.append("First question");
    const task = await f.prepare();
    const fake = createFakeProvider({
      send: async (_request, control) => {
        expect(control.release()).toBe(true);
        control.emit({ type: "tool_call", ...propose() });
        control.emit({ type: "text", text: "Task response." });
        control.emit({ type: "result", result: { status: "completed" } });
      },
    });
    const request = {
      ...task.dispatch.request,
      tools: task.dispatch.request.tools.filter(({ name }) => name !== handoffTool.name),
    };
    const events = await dispatchThrough(
      { snapshot: () => ({ state: "connected" }) } as Parameters<typeof dispatchThrough>[0],
      {
        ...fake,
        declaration: {
          ...fake.declaration,
          connection: { ...fake.declaration.connection, id: "chatgpt" },
        },
      },
      request,
    );
    expect(events.some((event) => event.type === "tool_call")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "result", result: { status: "completed" } });
  });

  it("commits one owner change, waits for the researcher, then transfers only the note and selected context", async () => {
    const log: DiagnosticEvent[] = [];
    const f = await fixture(log);
    await f.append("PRIVATE_BEFORE researcher chose public schools");
    const first = await f.prepare();
    expect(first.dispatch.request).toMatchObject({ policy_version: 6, instruction_version: 6 });
    expect(first.dispatch.request.tools).toContainEqual(handoffTool);
    expect(first.dispatch.request.instructions.split(section)).toHaveLength(2);
    const note =
      "APPROVED_NOTE: researcher chose public schools. Database access is unknown. " +
      "한".repeat(1600);
    const fake = createFakeProvider({
      send: async (request, control) => {
        expect(request.tools).toContainEqual(handoffTool);
        expect(control.release()).toBe(true);
        control.emit({ type: "text", text: "Virgilio can continue with a specialist." });
        control.emit({ type: "tool_call", ...propose(note) });
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
    const calls = events.filter((event) => event.type === "tool_call");
    expect(calls).toHaveLength(1);
    await f.settle(first, "Virgilio can continue with a specialist.", calls);
    const proposal = (await f.proposal())!;
    expect(proposal).toMatchObject({
      state: "proposed",
      rank: 2,
      revision: 1,
      expectedOwnerRevision: 1,
      note: { parts: 2 },
    });
    expect(value(await f.store.readConversations(f.projectId))[0]).toMatchObject({
      agentId: "virgilio",
      ownerRevision: 1,
    });
    await f.append("PRIVATE_LATER supplied while the offer waited.");
    const later = await f.prepare();
    expect(later.dispatch.request.input).toContainEqual({
      role: "user",
      text: "Note from Ohtia: at this point you proposed continuing this conversation with Josefa; the proposal is waiting for the researcher to accept or decline it.",
    });
    const accept: ResearchCommand = {
      command: "handoff.accept",
      operationId: "approve-handoff",
      payload: { proposalId: proposal.id, expectedOwnerRevision: 1 },
    };
    expect(await f.run(accept)).toMatchObject({
      ok: false,
      error: {
        code: "conversation_busy",
        nextAction: "retry_later",
        parameters: { reason: "reply_active" },
      },
    });
    const failed = {
      type: "result",
      sequence: 1,
      result: { status: "failed", reason: "provider_error", dispatched: true },
    } as const;
    value(await f.store.recordTaskEvent(later.dispatch.request.attempt, failed, "", []));
    expect(
      await f.run({
        ...accept,
        operationId: "stale",
        payload: { ...accept.payload, expectedOwnerRevision: 2 },
      }),
    ).toEqual(failure("owner_changed"));
    const decided = value(await f.run(accept));
    expect(value(await f.run(accept))).toEqual(decided);
    expect(
      await f.run({
        command: "handoff.decline",
        operationId: "late-decline",
        payload: { proposalId: proposal.id },
      }),
    ).toEqual(failure("proposal_not_waiting"));
    expect(value(await f.store.prepareTask())).toBeNull();
    expect(value(await f.store.readConversations(f.projectId))[0]).toMatchObject({
      agentId: "josefa",
      ownerRevision: 2,
    });
    const after = await f.timeline();
    expect(after.find((item) => item.id === proposal.id)).toMatchObject({
      state: "accepted",
      revision: 2,
      rank: 2,
    });
    const divider = after.find((item) => item.kind === "handoffDivider")!;
    expect(divider).toMatchObject({ agentId: "josefa", revision: 1, rank: 1 });
    expect(divider.position).toBeGreaterThan(
      after.find((item) => item.id === later.taskId)!.position,
    );
    expect(
      await f.run({
        command: "task.tryAgain",
        operationId: "prior-task",
        payload: { taskId: later.taskId },
      }),
    ).toEqual(failure("task_not_retryable"));
    await f.append("PRIVATE_JOSEFA researcher message");
    const josefa = await f.prepare();
    expect(josefa.dispatch.request).toMatchObject({
      operation: "search_strategy_planning",
      instruction_version: 4,
      tools: [],
    });
    expect(josefa.dispatch.request.instructions.split(section)).toHaveLength(2);
    expect(josefa.dispatch.request.input).toEqual([
      { role: "user", text: "Project memory: no entries yet." },
      {
        role: "user",
        text: `Virgilio, the research guide, handed this conversation to you with this note. The researcher did not write it.\n\nNote:\n${note}`,
      },
      { role: "user", text: "PRIVATE_JOSEFA researcher message" },
    ]);
    expect(josefa.transfer).toContainEqual({
      kind: "note",
      note: "handoff_context",
      reference: proposal.id,
      revision: 1,
    });
    await f.settle(josefa, "SHARED_ANSWER: public-school terms remain unverified.");
    const offered = await f.selection(2);
    expect(offered.priorReply).toBe(true);
    expect(offered.messages.map((message) => message.agentId)).toEqual([null, "josefa"]);
    const shared = offered.messages[1]!;
    const returning: ResearchCommand = {
      command: "handoff.return",
      operationId: "return",
      payload: {
        conversationId: f.conversationId,
        expectedOwnerRevision: 2,
        selection: String(shared.position),
      },
    };
    for (const invalid of [
      `${shared.position},${shared.position}`,
      `${shared.position},1`,
      "1",
      "999999",
    ])
      expect(
        await f.run({
          ...returning,
          operationId: "rejected-selection",
          payload: { ...returning.payload, selection: invalid },
        }),
      ).toEqual(failure("selection_invalid"));
    const result = value(await f.run(returning));
    expect(value(await f.run(returning))).toEqual(result);
    expect(await f.run({ ...returning, operationId: "race-loser" })).toEqual(
      failure("owner_changed"),
    );
    expect(value(await f.store.prepareTask())).toBeNull();
    await f.append("What did Josefa suggest?");
    const back = await f.prepare();
    const input = back.dispatch.request.input.map(({ text }) => text).join("\n");
    expect(input).toContain("PRIVATE_BEFORE");
    expect(input).toContain("PRIVATE_LATER");
    expect(input).toContain(
      "Below are the messages from that part that the researcher chose to show you",
    );
    expect(input).toContain("Josefa, the reference librarian");
    expect(input).toContain("SHARED_ANSWER");
    expect(input).not.toMatch(/PRIVATE_JOSEFA|APPROVED_NOTE|proposal is waiting/);
    const selected = (await f.timeline()).find(
      (item) => item.kind === "message" && item.position === shared.position,
    )!;
    expect(back.transfer).toContainEqual({
      kind: "note",
      note: "handoff_context",
      reference: result.resultId,
      revision: 1,
    });
    expect(back.transfer).toContainEqual({ kind: "message", reference: selected.id });
    expect(JSON.stringify(log)).not.toMatch(/PRIVATE_|APPROVED_NOTE|SHARED_ANSWER/);
  });

  it("rejects cross-tool duplicates and checks for other work both before and after dispatch", async () => {
    const f = await fixture();
    await f.append("First question");
    const first = await f.prepare();
    await f.append("This reply arrived while the first was working.");
    await f.settle(first, "Here is my suggestion.", [propose()]);
    expect(await f.proposal()).toMatchObject({
      state: "invalid",
      invalidReason: "conversation_busy",
      revision: 1,
    });
    const second = await f.prepare();
    expect(second.dispatch.request.tools).toContainEqual(handoffTool);
    expect(
      second.dispatch.request.input.some(({ text }) =>
        text.includes("work in this conversation hadn't finished"),
      ),
    ).toBe(true);
    await f.settle(second, "One proposal per reply.", [
      {
        namespace: "ohtia",
        name: "propose_consultation",
        arguments: JSON.stringify({ agent: "josefa", request: "Find terms", reason: "Help" }),
      },
      propose(),
    ]);
    const items = await f.timeline();
    expect(items).not.toContainEqual(expect.objectContaining({ kind: "consultation" }));
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: "handoffProposal",
        state: "invalid",
        invalidReason: "multiple_calls",
      }),
    );
  });

  it("declines an open card without moving the conversation and replaces it on a later proposal", async () => {
    const f = await fixture();
    await f.append("First question");
    await f.settle(await f.prepare(), "First offer", [propose()]);
    const first = (await f.proposal())!;
    await f.append("An invalid proposal must leave the open card available.");
    await f.settle(await f.prepare(), "", [propose("")]);
    expect((await f.timeline()).find((item) => item.id === first.id)).toMatchObject({
      state: "proposed",
      revision: 1,
    });
    await f.append("Second question");
    await f.settle(await f.prepare(), "Second offer", [propose()]);
    const items = await f.timeline();
    expect(items.find((item) => item.id === first.id)).toMatchObject({
      state: "replaced",
      revision: 2,
    });
    const open = items.find(
      (item) => item.kind === "handoffProposal" && item.state === "proposed",
    )!;
    const decline: ResearchCommand = {
      command: "handoff.decline",
      operationId: "decline",
      payload: { proposalId: open.id },
    };
    expect(value(await f.run(decline))).toEqual(value(await f.run(decline)));
    await f.append("What now?");
    const next = await f.prepare();
    expect(next.dispatch.request.input.map(({ text }) => text).join("\n")).toMatch(
      /a later proposal of yours replaced it.[\s\S]*the researcher declined, so the conversation stayed with you/,
    );
    expect(value(await f.store.readConversations(f.projectId))[0]).toMatchObject({
      ownerRevision: 1,
      agentId: "virgilio",
    });
  });

  it("continues a Josefa-only conversation with no selection and preserves explicit unknowns", async () => {
    const f = await fixture();
    const { resultId: conversationId } = value(
      await f.run({
        command: "conversation.start",
        operationId: "open-josefa",
        payload: { projectId: f.projectId, agentId: "josefa", content: "UNSHARED design details" },
      }),
    );
    await f.settle(await f.prepare(), "UNSHARED reply");
    expect(await f.selection(1, conversationId)).toMatchObject({
      priorReply: false,
      messages: [{ agentId: null }, { agentId: "josefa" }],
    });
    value(
      await f.run({
        command: "handoff.return",
        operationId: "empty-return",
        payload: {
          conversationId,
          expectedOwnerRevision: 1,
          selection: "",
        },
      }),
    );
    expect(
      await f.run({
        command: "development.sendToJosefa",
        operationId: "send-to-former-owner",
        payload: { conversationId, content: "Do not route this message to a former owner." },
      }),
    ).toEqual(failure("owner_changed"));
    expect(value(await f.store.prepareTask())).toBeNull();
    await f.append("The design is still unknown.", conversationId);
    const request = (await f.prepare()).dispatch.request;
    expect(request.input).toEqual([
      { role: "user", text: "Project memory: no entries yet." },
      {
        role: "user",
        text: "The researcher asked you to continue this conversation, which started with Josefa, the reference librarian, and chose not to show you any of its messages.",
      },
      { role: "user", text: "[M1] The design is still unknown." },
    ]);
    value(await f.store.recordTaskEvent(request.attempt, completed, "", [propose()]));
    const proposed = (await f.timeline(conversationId)).find(
      (item) => item.kind === "handoffProposal",
    )!;
    value(
      await f.run({
        command: "handoff.accept",
        operationId: "tool-only-handoff",
        payload: { proposalId: proposed.id, expectedOwnerRevision: 2 },
      }),
    );
    expect((await f.selection(3, conversationId)).priorReply).toBe(true);
    value(
      await f.run({
        command: "handoff.return",
        operationId: "tool-only-return",
        payload: { conversationId, expectedOwnerRevision: 3, selection: "" },
      }),
    );
    await f.append("Continue exploring without a chosen design.", conversationId);
    const following = (await f.prepare()).dispatch.request.input;
    expect(following.map(({ text }) => text)).toContain(
      "The researcher brought you back to this conversation. While you were away, the researcher worked with Josefa, the reference librarian, and chose not to show you any of those messages.",
    );
  });

  it("upgrades a revision-26 database with existing conversations, then reserves a position after legacy messages", async () => {
    const f = await fixture();
    await f.append("Existing message");
    await f.settle(await f.prepare(), "Existing reply");
    await f.store.close();
    const legacy = f.raw();
    legacy.exec("PRAGMA foreign_keys=OFF; " + preHandoffSql);
    legacy.close();
    await f.store.open();
    expect(value(await f.store.readConversations(f.projectId))[0]).toMatchObject({
      id: f.conversationId,
      ownerRevision: 1,
    });
    const db = f.raw();
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(31);
      expect(
        db
          .prepare("SELECT count(*) FROM messages WHERE id IS NOT NULL AND conversation_id=?")
          .pluck()
          .get(bytes(f.conversationId)),
      ).toBeGreaterThan(1);
      expect(db.prepare("SELECT count(*) FROM handoffs").pluck().get()).toBe(0);
    } finally {
      db.close();
    }
  });
});

it("keeps attention across a handoff and attributes replies to the agent that produced them", async () => {
  const f = await fixture();
  const { resultId: conversationId } = value(
    await f.run({
      command: "conversation.start",
      operationId: "attention-josefa",
      payload: { projectId: f.projectId, agentId: "josefa", content: "Find synthetic examples" },
    }),
  );
  const readAttention = async () =>
    value(
      await f.store.readResearch({
        ...identity,
        operation: "projectAttention.list",
        payload: { cursor: null, count: 10 },
      }),
    ) as ResearchOutputs["projectAttention.list"];
  const replies: string[] = [];
  const stop = f.store.observeResearchActivity((event) => {
    if (event.kind === "replyFinished" && event.conversationId === conversationId)
      replies.push(event.agentId);
  });
  try {
    const josefa = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        josefa.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", dispatched: true, reason: "provider_error" },
        },
        "Synthetic partial reply.",
      ),
    );
    const attention = await readAttention();
    expect(attention.items).toEqual([f.projectId]);
    expect(replies).toEqual(["josefa"]);

    value(
      await f.run({
        command: "handoff.return",
        operationId: "return-with-attention",
        payload: { conversationId, expectedOwnerRevision: 1, selection: "" },
      }),
    );
    expect(await readAttention()).toEqual(attention);
    expect(replies).toEqual(["josefa"]);

    await f.append("Which research question remains open?", conversationId);
    await f.settle(await f.prepare(), "The synthetic research question is still open.", [
      propose(),
    ]);
    expect((await readAttention()).items).toEqual([]);
    expect(replies).toEqual(["josefa", "virgilio"]);

    await f.append("Can Josefa take another look?", conversationId);
    const proposing = await f.prepare();
    await f.settle(proposing, "", [propose("Consider another example.")]);
    expect(await f.timeline(conversationId)).toContainEqual(
      expect.objectContaining({
        kind: "handoffProposal",
        state: "proposed",
        note: "Consider another example.",
      }),
    );
    await f.settle(proposing, "", [propose("Consider another example.")]);
    expect(replies).toEqual(["josefa", "virgilio", "virgilio"]);

    await f.append("Could a handoff help here?", conversationId);
    await f.settle(await f.prepare(), "", [propose(" ")]);
    expect(await f.timeline(conversationId)).toContainEqual(
      expect.objectContaining({
        kind: "handoffProposal",
        state: "invalid",
        invalidReason: "note_empty",
      }),
    );
    expect(replies).toEqual(["josefa", "virgilio", "virgilio", "virgilio"]);
  } finally {
    stop();
  }
});
