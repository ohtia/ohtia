import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  decodeDevelopmentAction,
  decodeDevelopmentReport,
  decodeProviderDispatch,
  decodeProviderEvent,
  makeDiagnosticRecord,
  policyId,
  researchOutput,
  ServiceConnections,
  type DiagnosticEvent,
  type ProviderEventMessage,
  type ResearchCommand,
} from "../packages/contracts/src/index.js";
import { parseDevelopmentSwitches } from "../packages/main/src/development-command.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import {
  buildInput,
  omittedMessagesNote,
  operationPolicy,
} from "../packages/utility/src/operations.js";
import { setupTool } from "../packages/utility/src/project-setup.js";
import { bytes } from "../packages/utility/src/research.js";
import { DurableStore } from "../packages/utility/src/storage.js";
import { setupConnections, successful as value, proposeSetup } from "./fixtures/project-setup.js";
import {
  preConversationAgentsSql,
  preJosefaSql,
  storageFixture,
  stores,
} from "./fixtures/storage.js";

const title = "Redes de cuidado $& {document_language}";
const generation = "setup-tests";
const context = () => ({
  generation,
  mode: "development" as const,
  connections: setupConnections(),
});

async function fixture(
  options: {
    readonly confirm?: boolean;
    readonly log?: DiagnosticEvent[];
    readonly title?: string;
  } = {},
) {
  const f = storageFixture();
  if (options.log) {
    f.store = new DurableStore({
      ...f.options,
      emitDiagnostic: (event) => options.log?.push(event),
    });
    stores.push(f.store);
  }
  await f.store.open();
  f.store.setTaskContext(context());
  const projectId = value(
    await f.store.executeResearchCommand({
      command: "project.create",
      operationId: "create-thesis",
      payload: {},
    }),
  ).resultId;
  const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
  if (options.confirm !== false) {
    const proposalId = await proposeSetup(f.store, f.raw, projectId, {
      title: options.title ?? title,
      document_language: "es-AR",
    });
    value(
      await f.store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "confirm-thesis",
        payload: { proposalId },
      }),
    );
  }
  return { ...f, projectId, conversationId };
}

const sendToJosefa = (conversationId: string, content: string, operationId: string) =>
  ({
    command: "development.sendToJosefa",
    operationId,
    payload: { conversationId, content },
  }) as const satisfies ResearchCommand;

const identity = {
  kind: "request",
  protocol: 1,
  policy: policyId,
  requestId: "read-josefa",
  operationId: "read-josefa",
  windowGeneration: "window",
  serviceGeneration: generation,
} as const;

function specifiedInstructions(block: string, indentation: number): string {
  const epic = fs.readFileSync("docs/epics/EPIC-003-research-agents/epic.md", "utf8");
  const section = epic.split("### " + block + ":")[1]!.split("\n### SPEC-")[0]!;
  return /```text\n([\s\S]*?)\n *```/
    .exec(section)![1]!
    .split("\n")
    .map((line) => line.slice(indentation))
    .join("\n");
}

describe("Josefa search strategy", () => {
  it.each([
    [
      "Quiero comparar la tutoría entre pares con los grupos de estudio antes de elegir un tema.",
      "𠀀".repeat(200),
    ],
    [
      "Ya formulé mi pregunta sobre tutorías de primer año y quiero desarrollar la bibliografía.",
      title,
    ],
  ])(
    "saves a text-only reply with the complete instructions for %s",
    async (content, projectTitle) => {
      const log: DiagnosticEvent[] = [];
      const f = await fixture({ log, title: projectTitle });
      const sent: string[] = [];
      const provider = new DurableProvider({
        storage: f.store,
        context: context(),
        send: (text) => sent.push(text),
      });
      const parsed = parseDevelopmentSwitches(
        [
          "--ohtia-dev-command=send-to-josefa",
          "--ohtia-dev-conversation=" + f.conversationId,
          "--ohtia-dev-text=" + content,
        ],
        "send-to-josefa",
      );
      if (!parsed?.ok) throw new Error("Expected a valid development invocation.");
      const envelope = {
        kind: "development_action",
        version: 1,
        generation,
        action: parsed.action,
      };
      const action = decodeDevelopmentAction(JSON.stringify(envelope), generation)!;
      expect(action).toEqual(envelope);
      await provider.developmentAction(action);
      await provider.developmentAction(action);
      const dispatches = sent
        .map((text) => decodeProviderDispatch(text, generation))
        .filter(Boolean);
      expect(dispatches).toHaveLength(1);
      const dispatch = dispatches[0]!;
      const withTool = { ...dispatch, request: { ...dispatch.request, tools: [setupTool] } };
      expect(decodeProviderDispatch(JSON.stringify(withTool), generation)).toBeUndefined();
      const epic = fs.readFileSync("docs/epics/EPIC-003-research-agents/epic.md", "utf8");
      const instructions = epic
        .split("**Josefa's instructions, version 2,**")[1]!
        .split("```text\n")[1]!
        .split("  ```")[0]!;
      const role = instructions
        .trimEnd()
        .split("\n")
        .map((line) => line.slice(2))
        .join("\n")
        .replace(
          "- Start by stating that this is a plan",
          "- When you propose a plan, start by stating that this is a plan",
        )
        .replace("{project_type_name}", "Thesis")
        .replace(
          "{project_type_description}",
          "The document a student writes and defends to obtain an academic degree.",
        )
        .replace("{document_language_name}", "Spanish (Argentina)")
        .replace("{document_language}", "es-AR")
        .replace("{queryable_locations}", "none in this version")
        .replace("{title}", () => projectTitle);
      const route = specifiedInstructions("SPEC-003-044", 0);
      expect(dispatch.request).toMatchObject({
        operation: "search_strategy_planning",
        document_language: "es-AR",
        policy_version: 2,
        instruction_version: 2,
        tools: [],
        model: "first",
        instructions: role + "\n\n" + route,
        input: [
          { role: "user", text: "Synthetic setup request" },
          { role: "user", text: content },
        ],
        limits: {
          max_output_bytes: 65_536,
          max_attempt_duration_ms: 600_000,
          max_inactivity_ms: 120_000,
        },
      });
      const running = value(
        await f.store.readResearch({
          ...identity,
          operation: "conversation.read",
          payload: { projectId: f.projectId, ids: [f.conversationId] },
        }),
      );
      expect(researchOutput("conversation.read", running)).toBe(true);
      expect(running).toMatchObject({
        items: [
          {
            agentId: "virgilio",
            runningTask: { agentId: "josefa", state: "running" },
          },
        ],
      });
      const fake = createFakeProvider();
      const events: ProviderEventMessage[] = [];
      const main = new ProviderDispatch(
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
          send: (_generation, text) => events.push(decodeProviderEvent(text, generation)!),
        },
      );
      main.begin(generation);
      await main.receive({ ...dispatch, permit: { ...dispatch.permit, issued_at: Date.now() } });
      await vi.waitFor(() => expect(events.at(-1)?.event.type).toBe("result"));
      main.dispose();
      for (const event of events) await provider.receive(event);
      const messages = value(await f.store.readMessages(f.conversationId));
      expect(messages).toHaveLength(3);
      expect(messages.at(-1)).toMatchObject({
        authorKind: "agent",
        agentId: "josefa",
        content: "Synthetic reply.",
        ending: "complete",
      });
      const timeline = value(
        await f.store.readResearch({
          ...identity,
          operation: "timeline.read",
          payload: {
            conversationId: f.conversationId,
            ids: [messages.at(-1)!.id, messages.at(-1)!.taskId!],
          },
        }),
      );
      expect(researchOutput("timeline.read", timeline)).toBe(true);
      expect(timeline).toMatchObject({
        items: [
          { kind: "message", agentId: "josefa", language: "es-AR" },
          { kind: "task", agentId: "josefa", state: "completed" },
        ],
      });
      expect(
        sent
          .map((text) => decodeDevelopmentReport(text, generation))
          .find((message) => message?.report.type === "finished")?.report,
      ).toMatchObject({
        result: { status: "completed" },
        transfer: [
          { kind: "instructions", operation: "search_strategy_planning", version: 2 },
          { kind: "message", reference: messages[0]!.id },
          { kind: "message", reference: messages[1]!.id },
        ],
      });
      const db = f.raw();
      try {
        expect(
          db
            .prepare("SELECT command, result_id FROM command_receipts WHERE operation_id=?")
            .get("send-to-josefa"),
        ).toEqual({ command: "development.sendToJosefa", result_id: bytes(messages[1]!.id) });
      } finally {
        db.close();
        provider.dispose();
      }
      const diagnostics = log.map((event) =>
        makeDiagnosticRecord(event, "0.0.0", "2026-11-18T00:00:00.000Z"),
      );
      expect(diagnostics.every(Boolean)).toBe(true);
      expect(log.map((event) => event.event_name)).toEqual(
        expect.arrayContaining([
          "ohtia.development.josefa_message_appended",
          "ohtia.task.accepted",
          "ohtia.task.dispatch_permitted",
          "ohtia.task.completed",
        ]),
      );
      expect(JSON.stringify(diagnostics)).not.toMatch(
        /Redes|tutorías|Synthetic reply|You are Josefa|es-AR|Spanish/,
      );
    },
  );

  it("admits the command only for a confirmed ordinary project in development", async () => {
    const f = await fixture({ confirm: false });
    const request = sendToJosefa(f.conversationId, "¿Cómo busco?", "josefa");
    expect(await f.store.executeResearchCommand(request)).toMatchObject({ ok: false });
    const development = value(
      await f.store.executeResearchCommand({
        command: "development.createProject",
        operationId: "development-fixture",
        payload: {},
      }),
    ).resultId;
    const devConversation = value(await f.store.readConversations(development))[0]!.id;
    expect(
      await f.store.executeResearchCommand(sendToJosefa(devConversation, "Plan", "dev-josefa")),
    ).toMatchObject({ ok: false });
    const proposalId = await proposeSetup(f.store, f.raw, f.projectId);
    value(
      await f.store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "confirm",
        payload: { proposalId },
      }),
    );
    f.store.setTaskContext({ ...context(), connections: new ServiceConnections() });
    const first = value(await f.store.executeResearchCommand(request));
    for (const mode of ["installed", "qualification"] as const) {
      f.store.setTaskContext({ ...context(), mode });
      // Even a valid saved receipt cannot be replayed through this command in another mode.
      expect(await f.store.executeResearchCommand(request)).toMatchObject({
        error: { code: "invalid_message" },
      });
      expect(await f.store.executeResearchCommand({ ...request, operationId: mode })).toMatchObject(
        {
          error: { code: "invalid_message" },
        },
      );
    }
    f.store.setTaskContext(context());
    expect(value(await f.store.executeResearchCommand(request))).toEqual(first);
    value(await f.store.reconcileTaskConnections());
    const plan = value(await f.store.prepareTask())!;
    expect(plan.dispatch.request.operation).toBe("search_strategy_planning");
    expect(value(await f.store.readMessages(f.conversationId))).toHaveLength(2);
    value(
      await f.store.recordTaskEvent(
        plan.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "completed" },
        },
        "Plan propuesto.",
      ),
    );
    value(
      await f.store.executeResearchCommand({
        command: "message.append",
        operationId: "ordinary-followup",
        payload: { conversationId: f.conversationId, content: "¿Cuál es la siguiente acción?" },
      }),
    );
    expect(value(await f.store.prepareTask())?.dispatch.request.operation).toBe("direct_guidance");
    expect(value(await f.store.readMessages(devConversation))).toEqual([]);
  });

  it("retains recent whole messages and attributes the cut-reply note to Josefa", async () => {
    const f = await fixture();
    const old = Array.from({ length: 4 }, (_, i) => String(i) + "😀".repeat(19_999));
    for (const [index, content] of old.entries())
      value(
        await f.store.executeResearchCommand(
          sendToJosefa(f.conversationId, content, "history-" + String(index)),
        ),
      );
    const first = value(await f.store.prepareTask())!;
    expect(first.dispatch.request.input).toEqual([
      { role: "user", text: omittedMessagesNote },
      ...old.slice(1).map((text) => ({ role: "user", text })),
    ]);
    const partial = "Plan provisional";
    value(
      await f.store.recordTaskEvent(
        first.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", dispatched: true, reason: "inactivity_timeout" },
        },
        partial,
      ),
    );
    expect(value(await f.store.prepareTask())).toBeNull();
    const followup = "¿Qué falta para ajustar el plan?";
    value(
      await f.store.executeResearchCommand(sendToJosefa(f.conversationId, followup, "followup")),
    );
    const second = value(await f.store.prepareTask())!;
    expect(second.dispatch.request.input).toEqual([
      { role: "user", text: omittedMessagesNote },
      ...old.slice(1).map((text) => ({ role: "user", text })),
      { role: "assistant", text: partial },
      {
        role: "user",
        text: "Note from Ohtia: Josefa's reply above is incomplete. It was cut off because the service sent nothing for too long.",
      },
      { role: "user", text: followup },
    ]);
    expect(decodeProviderDispatch(JSON.stringify(second.dispatch), generation)).toEqual(
      second.dispatch,
    );
  });

  it("enforces the per-operation pending cap before replacing another agent's task", async () => {
    const f = await fixture();
    const start = (index: number) =>
      f.store.executeResearchCommand({
        command: "conversation.start",
        operationId: "start-" + String(index),
        payload: { projectId: f.projectId, content: "Existing guidance request" },
      });
    for (let index = 0; index < 100; index++) {
      const id = value(await start(index)).resultId;
      value(
        await f.store.executeResearchCommand(
          sendToJosefa(id, "Draft search plan", "plan-" + String(index)),
        ),
      );
    }
    const other = value(await start(100)).resultId;
    expect(
      await f.store.executeResearchCommand(sendToJosefa(other, "Over cap", "over-cap")),
    ).toMatchObject({ error: { code: "pending_limit_reached" } });
    expect(value(await f.store.readMessages(other)).map((row) => row.content)).toEqual([
      "Existing guidance request",
    ]);
    const db = f.raw();
    try {
      expect(
        db.prepare("SELECT operation FROM tasks WHERE conversation_id=?").pluck().all(bytes(other)),
      ).toEqual(["direct_guidance"]);
      expect(
        db
          .prepare("SELECT count(*) FROM command_receipts WHERE operation_id='over-cap'")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      db.close();
    }
    const first = value(await start(0)).resultId;
    value(
      await f.store.executeResearchCommand(
        sendToJosefa(first, "Refine the plan", "coalesce-at-cap"),
      ),
    );
    value(
      await f.store.executeResearchCommand({
        command: "message.append",
        operationId: "ordinary-replacement",
        payload: { conversationId: first, content: "¿Cuál es la siguiente acción?" },
      }),
    );
    const pending = f.raw();
    try {
      expect(
        pending
          .prepare(
            "SELECT operation, state FROM tasks WHERE conversation_id=? ORDER BY rowid DESC LIMIT 2",
          )
          .all(bytes(first)),
      ).toEqual([
        { operation: "direct_guidance", state: "queued" },
        { operation: "search_strategy_planning", state: "cancelled" },
      ]);
    } finally {
      pending.close();
    }
  }, 60_000);

  it("pins policy 1, bounds input items and stops after two undispatched permits", async () => {
    const policy = operationPolicy("search_strategy_planning", 1, "development")!;
    expect(policy).toMatchObject({
      version: 1,
      instruction_version: 1,
      max_pending_tasks: 100,
      max_input_bytes: 262_144,
      max_input_items: 500,
      max_output_bytes: 65_536,
      max_work_units: 1,
      max_attempt_duration_ms: 600_000,
      max_inactivity_ms: 120_000,
      stop_grace_ms: 5_000,
      max_attempts: 2,
      max_auto_retries: 0,
      retry_backoff_ms: 0,
    });
    const items = Array.from({ length: 501 }, (_, i) => ({
      reference: "message-" + String(i),
      role: "user" as const,
      text: String(i),
    }));
    expect(buildInput(policy, items, { reference: "conversation", revision: 1 })?.input).toEqual([
      { role: "user", text: omittedMessagesNote },
      ...items.slice(1).map(({ role, text }) => ({ role, text })),
    ]);
    const f = await fixture();
    value(await f.store.executeResearchCommand(sendToJosefa(f.conversationId, "Plan", "permits")));
    const first = value(await f.store.prepareTask())!;
    const expire = (attempt: string) =>
      f.store.recordTaskEvent(
        attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", dispatched: false, reason: "permit_expired" },
        },
        "",
      );
    value(await expire(first.dispatch.request.attempt));
    const second = value(await f.store.prepareTask())!;
    expect(second.taskId).toBe(first.taskId);
    value(await expire(second.dispatch.request.attempt));
    expect(value(await f.store.prepareTask())).toBeNull();
    const db = f.raw();
    try {
      expect(
        db.prepare("SELECT state FROM tasks WHERE id=?").pluck().get(bytes(first.taskId)),
      ).toBe("failed");
      expect(
        db
          .prepare("SELECT attempt_number FROM attempts WHERE task_id=? ORDER BY attempt_number")
          .pluck()
          .all(bytes(first.taskId)),
      ).toEqual([1, 2]);
    } finally {
      db.close();
    }
  });

  it("upgrades schema 18 while preserving an existing waiting task and its receipt", async () => {
    const f = await fixture();
    const original = value(
      await f.store.executeResearchCommand({
        command: "message.append",
        operationId: "original-guidance",
        payload: { conversationId: f.conversationId, content: "Before migration" },
      }),
    );
    await f.store.close();
    const legacy = f.raw();
    legacy.exec(preJosefaSql + "PRAGMA user_version=18;");
    legacy.close();
    await f.store.open();
    f.store.setTaskContext(context());
    value(
      await f.store.executeResearchCommand({
        command: "task.continueAll",
        operationId: "resume-migrated-work",
        payload: {},
      }),
    );
    const guidance = value(await f.store.prepareTask())!;
    expect(guidance.dispatch.request.operation).toBe("direct_guidance");
    expect(value(await f.store.readMessages(f.conversationId)).at(-1)?.id).toBe(original.resultId);
    value(
      await f.store.recordTaskEvent(
        guidance.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "completed" },
        },
        "A guidance reply.",
      ),
    );
    value(
      await f.store.executeResearchCommand(
        sendToJosefa(f.conversationId, "Plan a search", "after-upgrade"),
      ),
    );
    expect(value(await f.store.prepareTask())?.dispatch.request.operation).toBe(
      "search_strategy_planning",
    );
  });
});

it("backfills a revision 19 conversation and keeps the selected Josefa's direct reply and transfer record", async () => {
  const log: DiagnosticEvent[] = [];
  const f = await fixture({ log });
  await f.store.close();
  const legacy = f.raw();
  try {
    legacy.exec(preConversationAgentsSql + "PRAGMA user_version=19;");
  } finally {
    legacy.close();
  }
  await f.store.open();
  const installed = { ...context(), mode: "installed" as const };
  f.store.setTaskContext(installed);
  const sent: string[] = [];
  const provider = new DurableProvider({
    storage: f.store,
    context: installed,
    send: (text) => sent.push(text),
  });
  try {
    expect(
      await f.store.executeResearchCommand({
        command: "conversation.start",
        operationId: "reject-unavailable-agent",
        payload: { projectId: f.projectId, agentId: "erasmus", content: "Synthetic question" },
      }),
    ).toMatchObject({ ok: false, error: { code: "agent_unavailable" } });
    expect(log).toContainEqual(
      expect.objectContaining({
        event_name: "ohtia.research.failed",
        error_code: "agent_unavailable",
      }),
    );
    const old = value(await f.store.readConversations(f.projectId));
    expect(old).toEqual([expect.objectContaining({ id: f.conversationId, agentId: "virgilio" })]);
    const { resultId } = value(
      await f.store.executeResearchCommand({
        command: "conversation.start",
        operationId: "direct-josefa",
        payload: {
          projectId: f.projectId,
          agentId: "josefa",
          content: "Plan a search for peer tutoring",
        },
      }),
    );
    await provider.pump();
    const dispatches = sent.map((wire) => decodeProviderDispatch(wire, generation)).filter(Boolean);
    expect(dispatches).toHaveLength(1);
    const dispatch = dispatches[0]!;
    expect(dispatch.request).toMatchObject({
      operation: "search_strategy_planning",
      policy_version: 2,
      instruction_version: 2,
      input: [{ role: "user", text: "Plan a search for peer tutoring" }],
      tools: [],
    });
    const fake = createFakeProvider();
    const events: ProviderEventMessage[] = [];
    const main = new ProviderDispatch(
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
        send: (_generation, wire) => events.push(decodeProviderEvent(wire, generation)!),
      },
    );
    try {
      main.begin(generation);
      await main.receive({ ...dispatch, permit: { ...dispatch.permit, issued_at: Date.now() } });
      await vi.waitFor(() => expect(events.at(-1)?.event.type).toBe("result"));
      for (const event of events) await provider.receive(event);
    } finally {
      main.dispose();
    }
    const messages = value(await f.store.readMessages(resultId));
    expect(messages).toMatchObject([
      { authorKind: "researcher", agentId: null },
      { authorKind: "agent", agentId: "josefa", ending: "complete" },
    ]);
    const migrated = f.raw();
    try {
      expect(migrated.pragma("user_version", { simple: true })).toBe(25);
      const transfer = migrated
        .prepare("SELECT transfer_manifest FROM attempts WHERE id=?")
        .pluck()
        .get(bytes(dispatch.request.attempt)) as string;
      expect(JSON.parse(transfer)).toEqual([
        { kind: "instructions", operation: "search_strategy_planning", version: 2 },
        { kind: "message", reference: messages[0]!.id },
      ]);
      expect(() =>
        migrated
          .prepare("UPDATE conversations SET agent_id='virgilio',revision=revision+1 WHERE id=?")
          .run(bytes(resultId)),
      ).toThrow("Invalid conversation change");
    } finally {
      migrated.close();
    }
  } finally {
    provider.dispose();
  }
});
