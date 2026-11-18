import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ServiceConnections,
  decodeProviderEvent,
  decodeDiagnosticEvent,
  makeDiagnosticRecord,
  type DiagnosticEvent,
  decodeDevelopmentReport,
  decodeProviderDispatch,
  utf8Size,
  providerMessageBytes,
  type ProviderEvent,
  type ProviderToolCall,
  type ProviderResult,
} from "../packages/contracts/src/index.js";
import {
  setupTool,
  setupInstructions,
  setupInstructionsV2,
  setupInvalidReason,
  setupNote,
  setupRevision,
} from "../packages/utility/src/project-setup.js";
import {
  directGuidanceInstructions,
  guidanceInstructions,
} from "../packages/utility/src/direct-guidance.js";
import { operationPolicy, buildInput } from "../packages/utility/src/operations.js";
import { TaskTransaction } from "../packages/utility/src/tasks.js";
import {
  LanguageRegistry,
  bytes,
  identifier,
  canonicalJson,
} from "../packages/utility/src/research.js";
import { DurableStore } from "../packages/utility/src/storage.js";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import type {
  AdapterEvent,
  ProviderRequestControl,
} from "../packages/main/src/provider-adapter.js";
import { responsesBody } from "../packages/main/src/chatgpt-responses.js";
import { parseDevelopmentSwitches } from "../packages/main/src/development-command.js";
import { storageFixture, stores, preTaskNoticeSql } from "./fixtures/storage.js";
import { setupConnections, successful as value, proposeSetup } from "./fixtures/project-setup.js";
import { conformanceRequest, dispatchThrough } from "./fixtures/provider-conformance.js";
import { fakeChatGPT, sse, streamResponse } from "./fixtures/chatgpt.js";

const call = (title = "Synthetic title", document_language = "en"): ProviderToolCall => ({
  namespace: "ohtia",
  name: "propose_project_setup",
  arguments: JSON.stringify({ title, document_language }),
});
const registry = () =>
  new LanguageRegistry(path.resolve("config/localization/iana-language-subtag-registry.txt"));
async function setup(development = false, emitDiagnostic?: (event: DiagnosticEvent) => void) {
  const f = storageFixture();
  if (emitDiagnostic) {
    f.store = new DurableStore({ ...f.options, emitDiagnostic });
    stores.push(f.store);
  }
  await f.store.open();
  const context = {
    generation: "setup-tests",
    mode: "development" as const,
    connections: setupConnections(),
  };
  f.store.setTaskContext(context);
  const projectId = value(
    await f.store.executeResearchCommand({
      command: development ? "development.createProject" : "project.create",
      operationId: "project",
      payload: {},
    }),
  ).resultId;
  const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
  let n = 0;
  const append = (content = "Synthetic setup request") =>
    f.store.executeResearchCommand({
      command: "message.append",
      operationId: `append-${++n}`,
      payload: { conversationId, content },
    });
  const prepare = async () => {
    const task = value(await f.store.prepareTask());
    if (!task) throw new Error("No prepared setup task.");
    return task;
  };
  const proposals = () => {
    const db = f.raw();
    try {
      return (
        db.prepare("SELECT * FROM project_setup_proposals ORDER BY rowid").all() as {
          id: Uint8Array;
          task_id: Uint8Array;
          attempt_id: Uint8Array;
          title: string;
          document_language: string;
          state: string;
          invalid_reason: string | null;
        }[]
      ).map((row) => ({ ...row, id: identifier(row.id) }));
    } finally {
      db.close();
    }
  };
  const complete = async (
    calls: readonly ProviderToolCall[],
    text = "",
    result: ProviderResult = { status: "completed" },
  ) => {
    value(await append());
    const task = await prepare();
    const saved = value(
      await f.store.recordTaskEvent(
        task.dispatch.request.attempt,
        { type: "result", sequence: 1, result },
        text,
        calls,
      ),
    );
    return { task, saved };
  };
  return { ...f, context, projectId, conversationId, append, prepare, proposals, complete };
}

describe("project setup task transactions", () => {
  it("uses version 2 when a new message replaces a queued version 1 setup reply", async () => {
    const f = await setup();
    const routing = vi.spyOn(TaskTransaction.prototype, "destination").mockResolvedValue({
      policy: operationPolicy("project_setup", 1, "development")!,
      connection: "chatgpt",
    });
    value(await f.append());
    routing.mockRestore();
    value(await f.append("Use American English and agree on the English title."));
    const task = await f.prepare();
    expect(task.dispatch.request).toMatchObject({
      policy_version: 2,
      instruction_version: 2,
      instructions: setupInstructionsV2,
    });
    const db = f.raw();
    const rows = db
      .prepare(
        "SELECT id, state, policy_version, instruction_version, replaces_task_id FROM tasks ORDER BY rowid",
      )
      .all();
    db.close();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      state: "cancelled",
      policy_version: 1,
      instruction_version: 1,
    });
    expect(rows[1]).toMatchObject({
      state: "running",
      policy_version: 2,
      instruction_version: 2,
      replaces_task_id: (rows[0] as { id: Uint8Array }).id,
    });
  });

  it("retains version 1 for recorded setup tasks and retries while new messages use version 2", async () => {
    const f = await setup();
    // Accept through the previous policy before restoring the current routing.
    const routing = vi.spyOn(TaskTransaction.prototype, "destination").mockResolvedValue({
      policy: operationPolicy("project_setup", 1, "development")!,
      connection: "chatgpt",
    });
    value(await f.append());
    routing.mockRestore();
    const original = await f.prepare();
    expect(original.dispatch.request).toMatchObject({
      policy_version: 1,
      instruction_version: 1,
      instructions: setupInstructions,
    });
    value(
      await f.store.recordTaskEvent(original.dispatch.request.attempt, {
        type: "result",
        sequence: 1,
        result: { status: "failed", reason: "inactivity_timeout", dispatched: true },
      }),
    );
    value(
      await f.store.executeResearchCommand({
        command: "task.tryAgain",
        operationId: "retry-legacy-setup",
        payload: { taskId: original.taskId },
      }),
    );
    const retry = await f.prepare();
    expect(retry.dispatch.request).toMatchObject({
      policy_version: 1,
      instruction_version: 1,
      instructions: setupInstructions,
    });
    value(
      await f.store.recordTaskEvent(
        retry.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "",
        [call("Synthetic English working title", "en-US")],
      ),
    );
    value(await f.append("Use Spanish for Chile for the document instead."));
    const next = await f.prepare();
    expect(next.dispatch.request).toMatchObject({
      policy_version: 2,
      instruction_version: 2,
      instructions: setupInstructionsV2,
    });
  });

  it("proposes from a completed tool-only reply, replaces only with valid content and confirms exactly once", async () => {
    const f = await setup();
    const first = await f.complete([call("First", "ES-ar")]);
    expect(first.task.dispatch.request).toMatchObject({
      operation: "project_setup",
      policy_version: 2,
      instruction_version: 2,
      instructions: setupInstructionsV2,
      tools: [setupTool],
      model: "first",
      document_language: null,
    });
    expect(first.saved.result).toEqual({ status: "completed" });
    expect(value(await f.store.readMessages(f.conversationId))).toHaveLength(1);
    expect(f.proposals()[0]).toMatchObject({
      task_id: bytes(first.task.taskId),
      attempt_id: bytes(first.task.dispatch.request.attempt),
      document_language: "ES-ar",
      state: "proposed",
    });
    await f.complete([call(" ", "qzz")]);
    expect(f.proposals().map((p) => p.state)).toEqual(["proposed", "invalid"]);
    await f.complete([call("Second", "es-AR")], "A summary");
    const rows = f.proposals();
    expect(rows.map((p) => p.state)).toEqual(["replaced", "invalid", "proposed"]);
    const stale = await f.store.executeResearchCommand({
      command: "project.confirmSetup",
      operationId: "stale",
      payload: { proposalId: rows[0]!.id },
    });
    expect(stale).toMatchObject({
      error: { code: "proposal_not_waiting", nextAction: "refresh_record" },
    });
    const command = {
      command: "project.confirmSetup" as const,
      operationId: "confirm",
      payload: { proposalId: rows[2]!.id },
    };
    const confirmed = value(await f.store.executeResearchCommand(command));
    expect(confirmed.resultId).toBe(f.projectId);
    expect(await f.store.executeResearchCommand(command)).toEqual({ ok: true, value: confirmed });
    expect(
      await f.store.executeResearchCommand({ ...command, operationId: "confirm-again" }),
    ).toMatchObject({ error: { code: "proposal_not_waiting" } });
    expect(value(await f.store.readProjects())[0]).toMatchObject({
      title: "Second",
      documentLanguage: "es-AR",
    });
    value(await f.append("A message after confirmation"));
    expect(value(await f.store.prepareTask())?.dispatch.request.operation).toBe("direct_guidance");
    expect(f.proposals()[2]!.state).toBe("confirmed");
  });

  it("rejects decisions after a reply and permits rejection of a fresh proposal", async () => {
    const f = await setup();
    await f.complete([call()]);
    const old = f.proposals()[0]!;
    value(await f.append());
    for (const command of ["project.confirmSetup", "project.rejectSetup"] as const) {
      expect(
        await f.store.executeResearchCommand({
          command,
          operationId: command.replaceAll(".", "-"),
          payload: { proposalId: old.id },
        }),
      ).toMatchObject({
        error: { code: "proposal_not_waiting", nextAction: "refresh_record" },
      });
    }
    const task = await f.prepare();
    value(
      await f.store.recordTaskEvent(
        task.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "Updated proposal",
        [call()],
      ),
    );
    const fresh = f.proposals().at(-1)!;
    const reject = {
      command: "project.rejectSetup" as const,
      operationId: "reject-current",
      payload: { proposalId: fresh.id },
    };
    const rejected = await f.store.executeResearchCommand(reject);
    expect(rejected.ok).toBe(true);
    expect(await f.store.executeResearchCommand(reject)).toEqual(rejected);
    expect(
      await f.store.executeResearchCommand({ ...reject, operationId: "reject-again" }),
    ).toMatchObject({ error: { code: "proposal_not_waiting" } });
    value(await f.append());
    expect(
      (await f.prepare()).dispatch.request.input.some(
        (item) =>
          item.text ===
          setupNote({
            state: "rejected",
            title: "Synthetic title",
            document_language: "en",
            invalid_reason: null,
          }),
      ),
    ).toBe(true);
  });

  it.each([
    { name: "text-only", result: { status: "completed" } as ProviderResult, calls: [] },
    {
      name: "failed",
      result: { status: "failed", reason: "provider_error", dispatched: true } as ProviderResult,
      calls: [],
    },
    {
      name: "uncertain",
      result: { status: "uncertain", reason: "connection_lost" } as ProviderResult,
      calls: [],
    },
    {
      name: "invalid",
      result: { status: "completed" } as ProviderResult,
      calls: [call(" ", "en")],
    },
  ])(
    "keeps the old proposal inactive after a $name follow-up until a new valid proposal",
    async ({ result, calls }) => {
      const f = await setup();
      await f.complete([call()]);
      const old = f.proposals()[0]!;
      const followup = await f.complete(
        calls,
        "Agree on revised wording before a new proposal.",
        result,
      );
      expect(followup.saved.result.status).toBe(result.status);
      expect(f.proposals()[0]).toEqual(old);
      for (const command of ["project.confirmSetup", "project.rejectSetup"] as const) {
        expect(
          await f.store.executeResearchCommand({
            command,
            operationId: `stale-${command.replaceAll(".", "-")}`,
            payload: { proposalId: old.id },
          }),
        ).toMatchObject({ error: { code: "proposal_not_waiting" } });
      }
      expect(value(await f.store.readProjects())[0]).toMatchObject({
        title: null,
        documentLanguage: null,
        setupConfirmedAt: null,
      });
      await f.complete([call("Updated English title", "en-US")]);
      const fresh = f.proposals().at(-1)!;
      expect(f.proposals()[0]!.state).toBe("replaced");
      expect(
        (
          await f.store.executeResearchCommand({
            command: "project.confirmSetup",
            operationId: "confirm-fresh",
            payload: { proposalId: fresh.id },
          })
        ).ok,
      ).toBe(true);
    },
  );

  it("keeps a proposal actionable after a failed save or an old message receipt replay", async () => {
    const f = await setup();
    await f.complete([call()]);
    const proposal = f.proposals()[0]!;
    const before = value(await f.store.readMessages(f.conversationId));
    expect(
      (
        await f.store.executeResearchCommand({
          command: "message.append",
          operationId: "append-1",
          payload: { conversationId: f.conversationId, content: "Synthetic setup request" },
        })
      ).ok,
    ).toBe(true);
    expect(await f.append("😀".repeat(20000))).toMatchObject({
      error: { code: "input_too_large" },
    });
    expect(value(await f.store.readMessages(f.conversationId))).toEqual(before);
    expect(
      (
        await f.store.executeResearchCommand({
          command: "project.confirmSetup",
          operationId: "confirm-unanswered",
          payload: { proposalId: proposal.id },
        })
      ).ok,
    ).toBe(true);
  });

  it.each([true, false])(
    "serializes confirmation and a researcher reply with confirm-first=%s",
    async (confirmFirst) => {
      const f = await setup();
      await f.complete([call()]);
      const proposal = f.proposals()[0]!;
      const confirm = {
        command: "project.confirmSetup" as const,
        operationId: "ordered-confirm",
        payload: { proposalId: proposal.id },
      };
      if (confirmFirst) {
        const result = await f.store.executeResearchCommand(confirm);
        expect(result.ok).toBe(true);
        value(await f.append());
        expect(await f.store.executeResearchCommand(confirm)).toEqual(result);
        expect(f.proposals()[0]!.state).toBe("confirmed");
      } else {
        value(await f.append());
        expect(await f.store.executeResearchCommand(confirm)).toMatchObject({
          error: { code: "proposal_not_waiting" },
        });
        expect(f.proposals()[0]!.state).toBe("proposed");
      }
    },
  );

  it.each([
    ["", "qzz", "title_empty"],
    ["\u0085title", "qzz", "title_whitespace"],
    ["x".repeat(201), "qzz", "title_too_long"],
    ["Valid", "en_US", "language_malformed"],
    ["Valid", "qzz", "language_unknown"],
    ["Valid", "iw", "language_unknown"],
  ])("keeps the first validation reason for %j and %s", async (title, language, reason) => {
    const f = await setup();
    await f.complete([call(title, language)]);
    const p = f.proposals()[0]!;
    expect(p).toMatchObject({
      state: "invalid",
      title,
      document_language: language,
      invalid_reason: reason,
    });
    value(await f.append());
    const next = await f.prepare();
    expect(next.dispatch.request.input.at(-2)?.text).toBe(
      setupNote({
        state: "invalid",
        title,
        document_language: language,
        invalid_reason: reason as Parameters<typeof setupNote>[0]["invalid_reason"],
      }),
    );
  });

  it.each(["Title\0end", "Title\ud800end"])(
    "keeps exact invalid title arguments for %j",
    async (title) => {
      const f = await setup();
      const proposed = call(title);
      await f.complete([proposed]);
      expect(f.proposals()[0]).toMatchObject({ state: "invalid", invalid_reason: "title_invalid" });
      const db = f.raw();
      expect(
        (
          db.prepare("SELECT arguments_json FROM project_setup_proposals").get() as {
            arguments_json: string;
          }
        ).arguments_json,
      ).toBe(proposed.arguments);
      db.close();
      value(await f.append());
      expect(
        (await f.prepare()).dispatch.request.input.some(
          (item) =>
            item.text ===
            "Note from Ohtia: at this point Ohtia did not accept your proposal because its title contained U+0000 or invalid Unicode. The researcher was told.",
        ),
      ).toBe(true);
    },
  );

  it("keeps first-call values on multiple accepted calls and ignores calls outside the strict schema", async () => {
    const f = await setup();
    await f.complete([call("First"), call("Second")]);
    expect(f.proposals()[0]).toMatchObject({ title: "First", invalid_reason: "multiple_calls" });
    for (const bad of [
      { ...call(), namespace: null },
      { ...call(), namespace: "other" },
      { ...call(), name: "confirm_project_setup" },
      { ...call(), arguments: '{"title":"X"}' },
      { ...call(), arguments: '{"title":"X","document_language":"en","extra":true}' },
      { ...call(), arguments: "{" },
    ]) {
      const done = await f.complete([bad]);
      expect(done.saved.result).toMatchObject({ status: "failed", reason: "empty_reply" });
    }
    expect(f.proposals()).toHaveLength(1);
  });

  it.each<ProviderResult>([
    { status: "cancelled" },
    { status: "uncertain", reason: "connection_lost" },
    { status: "failed", reason: "deadline_exceeded", dispatched: true },
    { status: "failed", reason: "inactivity_timeout", dispatched: true },
    { status: "failed", reason: "output_limit_exceeded", dispatched: true },
  ])("discards complete calls when the attempt ends %j", async (result) => {
    const f = await setup();
    await f.complete([call()], "Partial summary", result);
    expect(f.proposals()).toEqual([]);
    expect(value(await f.store.readMessages(f.conversationId)).at(-1)).toMatchObject({
      content: "Partial summary",
      ending: "partial",
    });
  });

  it("lets a committed Stop win over an already completed provider response", async () => {
    const f = await setup();
    value(await f.append());
    const prepared = await f.prepare();
    value(
      await f.store.executeResearchCommand({
        command: "task.stop",
        operationId: "stop",
        payload: { taskId: prepared.taskId },
      }),
    );
    expect(
      value(
        await f.store.recordTaskEvent(
          prepared.dispatch.request.attempt,
          { type: "result", sequence: 1, result: { status: "completed" } },
          "Summary",
          [call()],
        ),
      ).result,
    ).toEqual({ status: "cancelled" });
    expect(f.proposals()).toHaveLength(0);
  });

  it("survives restart and preserves the development-only routing", async () => {
    const f = await setup();
    await f.complete([call("Restart title", "es-AR")]);
    const id = f.proposals()[0]!.id;
    await f.store.close();
    const reopened = new DurableStore(f.options);
    stores.push(reopened);
    await reopened.open();
    value(
      await reopened.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "confirm-restart",
        payload: { proposalId: id },
      }),
    );
    expect(value(await reopened.readProjects())[0]?.title).toBe("Restart title");
    const development = await setup(true);
    value(await development.append());
    expect((await development.prepare()).dispatch.request).toMatchObject({
      operation: "development_test",
      tools: [],
    });
  });

  it("rejects an oversized newest setup message before acceptance", async () => {
    const f = await setup();
    expect(await f.append("😀".repeat(20000))).toMatchObject({
      error: { code: "input_too_large" },
    });
    expect(value(await f.store.readMessages(f.conversationId))).toHaveLength(0);
  });

  it("rolls back replacement and completion together when proposal insertion fails", async () => {
    const f = await setup();
    await f.complete([call("First")]);
    value(await f.append());
    const task = await f.prepare();
    const db = f.raw();
    db.exec(
      "CREATE TRIGGER synthetic_setup_failure BEFORE INSERT ON project_setup_proposals BEGIN SELECT RAISE(ABORT,'Synthetic proposal failure'); END",
    );
    expect(
      await f.store.recordTaskEvent(
        task.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "Summary",
        [call("Second")],
      ),
    ).toMatchObject({ error: { code: "storage_failed" } });
    expect(f.proposals().map((p) => p.state)).toEqual(["proposed"]);
    expect(
      value(await f.store.readMessages(f.conversationId)).some(
        (message) => message.content === "Summary",
      ),
    ).toBe(false);
    db.exec("DROP TRIGGER synthetic_setup_failure");
    db.close();
    value(
      await f.store.recordTaskEvent(
        task.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "Summary",
        [call("Second")],
      ),
    );
    expect(f.proposals().map((p) => p.state)).toEqual(["replaced", "proposed"]);
  });

  it("rejects new pending work before saving its message or receipt", async () => {
    const f = await setup();
    for (let n = 0; n < 20; n++) {
      const project = value(
        await f.store.executeResearchCommand({
          command: "project.create",
          operationId: `pending-project-${n}`,
          payload: {},
        }),
      );
      const conversation = value(await f.store.readConversations(project.resultId))[0]!;
      value(
        await f.store.executeResearchCommand({
          command: "message.append",
          operationId: `pending-message-${n}`,
          payload: { conversationId: conversation.id, content: "Pending" },
        }),
      );
    }
    expect(await f.append()).toMatchObject({ error: { code: "pending_limit_reached" } });
    expect(value(await f.store.readMessages(f.conversationId))).toHaveLength(0);
    const db = f.raw();
    expect(
      db
        .prepare("SELECT count(*) FROM command_receipts WHERE operation_id='append-1'")
        .pluck()
        .get(),
    ).toBe(0);
    db.close();
  });
});

describe("setup input and proposal notes", () => {
  it("pins all policy values and preserves the normative instructions", () => {
    const policy = operationPolicy("project_setup", 1, "installed")!;
    expect(policy).toMatchObject({
      max_pending_tasks: 20,
      max_input_bytes: 65536,
      max_input_items: 200,
      max_output_bytes: 32768,
      max_work_units: 1,
      max_attempt_duration_ms: 300000,
      max_inactivity_ms: 120000,
      stop_grace_ms: 5000,
      max_attempts: 2,
      max_auto_retries: 0,
      retry_backoff_ms: 0,
    });
    const text = fs
      .readFileSync("docs/epics/EPIC-003-research-agents/epic.md", "utf8")
      .split("### SPEC-003-019:")[1]!
      .split("### SPEC-003-020:")[0]!;
    const normative = /```text\n([\s\S]*?)\n  ```/
      .exec(text)![1]!
      .split("\n")
      .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
      .join("\n")
      .replace("{project_type_name}", "Thesis")
      .replace(
        "{project_type_description}",
        "The document a student writes and defends to obtain an academic degree.",
      );
    expect(policy.instructions).toBe(normative);
    const amendment = /```text\n([\s\S]*?)\n  ```/
      .exec(
        fs
          .readFileSync("docs/epics/EPIC-003-research-agents/epic.md", "utf8")
          .split("### SPEC-003-020:")[1]!,
      )![1]!
      .split("\n")
      .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
      .join("\n");
    const latest = operationPolicy("project_setup", 2, "installed")!;
    expect(latest.instructions).toBe(
      normative.replace(
        "- Express the language as a BCP 47 tag",
        `${amendment}\n- Express the language as a BCP 47 tag`,
      ),
    );
    expect({
      ...latest,
      version: 1,
      instruction_version: 1,
      instructions: policy.instructions,
    }).toEqual(policy);
    const namespace = JSON.parse(/```json\n([\s\S]*?)\n  ```/.exec(text)![1]!);
    const request = {
      ...conformanceRequest("chatgpt"),
      operation: "project_setup" as const,
      tools: [setupTool],
    };
    expect(responsesBody(request).tools).toEqual([namespace]);
    const alternative = responsesBody(request, "additional_tools");
    expect(alternative).not.toHaveProperty("tools");
    expect((alternative.input as unknown[])[0]).toEqual({
      type: "additional_tools",
      role: "developer",
      tools: [namespace],
    });
    expect(
      setupInvalidReason({ title: "😀".repeat(200), document_language: "sr-Latn" }, registry()),
    ).toBeNull();
  });
  it("includes each note at its reply position and excludes notes among omitted messages", () => {
    const policy = { ...operationPolicy("project_setup", 1, "installed")!, max_input_items: 2 };
    const messages = [
      { reference: "a", position: 1, role: "user" as const, text: "Old" },
      {
        reference: "b",
        position: 3,
        role: "assistant" as const,
        text: "Summary",
        partial: { agent: "Virgilio", reason: "provider_error" },
      },
      { reference: "c", position: 6, role: "user" as const, text: "New" },
    ];
    const notes = [
      { reference: "omitted", position: 2, revision: 2, text: "Omitted proposal" },
      { reference: "same-reply", position: 3, revision: 2, text: "Rejected proposal" },
      { reference: "tool-only", position: 4, revision: 1, text: "Tool-only proposal" },
    ];
    const built = buildInput(policy, messages, { reference: "conversation", revision: 1 }, notes)!;
    expect(built.input.map((i) => i.text)).toEqual([
      "Earlier messages in this conversation are not included.",
      "Summary",
      "Note from Ohtia: Virgilio's reply above is incomplete. It was cut off because the service reported an error.",
      "Rejected proposal",
      "Tool-only proposal",
      "New",
    ]);
    expect(built.transfer.filter((i) => i.kind === "note" && i.note === "setup_proposal")).toEqual([
      { kind: "note", note: "setup_proposal", reference: "same-reply", revision: 2 },
      { kind: "note", note: "setup_proposal", reference: "tool-only", revision: 1 },
    ]);
  });
  it.each(["proposed", "replaced", "rejected", "confirmed", "invalid"] as const)(
    "has an exact note and timeline revision for %s",
    (state) => {
      const p = {
        state,
        title: "Title",
        document_language: "en",
        invalid_reason: state === "invalid" ? ("title_empty" as const) : null,
      };
      const note = setupNote(p);
      expect(setupRevision(p)).toBe(state === "proposed" || state === "invalid" ? 1 : 2);
      if (state === "confirmed") expect(note).toBeUndefined();
      else if (state === "invalid")
        expect(note).toBe(
          "Note from Ohtia: at this point Ohtia did not accept your proposal because its title was empty. The researcher was told.",
        );
      else
        expect(note).toBe(
          `Note from Ohtia: at this point you proposed ${state === "proposed" ? "a setup that is waiting for the researcher to confirm or reject it." : state === "replaced" ? "a setup that a later proposal of yours replaced." : "a setup that the researcher rejected; nothing was saved."}\nWorking title: Title\nDocument language: en`,
        );
    },
  );
});

const adapters: { dispose(): void }[] = [];
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
});
/** Shared raw scenarios run against the fake adapter and ChatGPT's SSE adapter. */
describe.each(["fake", "chatgpt"] as const)("%s tool/output conformance", (provider) => {
  async function run(events: readonly AdapterEvent[], budget = 32768) {
    const request = {
      ...conformanceRequest(provider),
      operation: "project_setup" as const,
      tools: [setupTool],
      limits: { ...conformanceRequest(provider).limits, max_output_bytes: budget },
    };
    if (provider === "fake") {
      const adapter = createFakeProvider({
        send: async (_request, control) => {
          if (!control.release()) return;
          for (const event of events) {
            if (control.signal.aborted) break;
            control.emit(event);
          }
        },
      });
      const manager = { snapshot: () => ({ state: "connected" }) };
      return {
        request,
        events: await dispatchThrough(
          manager as Parameters<typeof dispatchThrough>[0],
          adapter,
          request,
        ),
      };
    }
    const f = fakeChatGPT();
    adapters.push(f.manager);
    expect(await f.login()).toMatchObject({ state: "connected" });
    f.responses = (transport) => {
      const stream = events.map((event) => {
        switch (event.type) {
          case "tool_start":
            return {
              type: "response.output_item.added",
              item: {
                type: "function_call",
                id: event.id,
                namespace: event.namespace,
                name: event.name,
                arguments: "",
              },
            };
          case "tool_arguments":
            return {
              type: "response.function_call_arguments.delta",
              item_id: event.id,
              delta: event.text,
            };
          case "tool_end":
            return { type: "response.function_call_arguments.done", item_id: event.id };
          case "text":
            return { type: "response.output_text.delta", delta: event.text };
          case "result":
            return event.result.status === "completed"
              ? { type: "response.completed", response: {} }
              : { type: "response.failed", response: {} };
          default:
            return { type: "response.in_progress", response: {} };
        }
      });
      return streamResponse(
        stream.map((event) => sse(event)),
        { signal: transport.signal },
      );
    };
    const received = await dispatchThrough(f.manager, f.adapter, {
      ...request,
      connection: "chatgpt",
    });
    expect(f.responseRequests[0]!.body).toEqual(responsesBody(request));
    return { request, events: received };
  }
  const start = (id = "c1"): AdapterEvent => ({
    type: "tool_start",
    id,
    namespace: "ohtia",
    name: "propose_project_setup",
  });
  const args = (text: string, id = "c1"): AdapterEvent => ({ type: "tool_arguments", id, text });
  const end = (id = "c1"): AdapterEvent => ({ type: "tool_end", id });
  const done: AdapterEvent = { type: "result", result: { status: "completed" } };
  it("sends exactly the permitted namespaced tool and emits ordered complete calls only after all text", async () => {
    const result = await run([
      start(),
      args(call().arguments),
      end(),
      { type: "text", text: "After the complete call" },
      start("c2"),
      args(call("Second").arguments, "c2"),
      end("c2"),
      done,
    ]);
    const effects = result.events.filter((event) =>
      ["text", "tool_call", "result"].includes(event.type),
    );
    expect(effects.map((event) => event.type)).toEqual([
      "text",
      "tool_call",
      "tool_call",
      "result",
    ]);
    expect(effects[1]).toMatchObject({ ...call(), type: "tool_call" });
    expect(effects[2]).toMatchObject({ ...call("Second"), type: "tool_call" });
    expect(result.events.every((event, i) => event.sequence === i + 1)).toBe(true);
  });
  it.each(["foreign-name", "foreign-namespace"])(
    "ignores a %s with opaque labels without making its text partial",
    async (scenario) => {
      const foreign: AdapterEvent = {
        ...start(),
        ...(scenario === "foreign-name" ? { name: "web.search" } : { namespace: "_other.tools" }),
      };
      const result = await run([
        { type: "text", text: "A complete reply" },
        foreign,
        args(call().arguments),
        end(),
        done,
      ]);
      const calls = result.events.filter((event) => event.type === "tool_call");
      expect(calls).toHaveLength(1);
      expect(result.events.at(-1)).toMatchObject({
        type: "result",
        result: { status: "completed" },
      });
      const f = await setup();
      const saved = await f.complete(calls, "A complete reply");
      expect(saved.saved.result).toMatchObject({ status: "completed" });
      expect(f.proposals()).toEqual([]);
      expect(value(await f.store.readMessages(f.conversationId)).at(-1)).toMatchObject({
        content: "A complete reply",
        ending: "complete",
      });
    },
  );
  it("fails malformed Unicode arguments without forwarding an invalid private-channel event", async () => {
    const result = await run([start(), args("\ud800"), end(), done]);
    expect(result.events.some((event) => event.type === "tool_call")).toBe(false);
    expect(result.events.at(-1)).toMatchObject({
      type: "result",
      result: { status: "failed", reason: "invalid_output" },
    });
  });
  it.each(["duplicate-start", "orphan-arguments", "orphan-end", "late-arguments", "duplicate-end"])(
    "fails a %s stream without publishing a partial call",
    async (scenario) => {
      const events: AdapterEvent[] =
        scenario === "duplicate-start"
          ? [start(), start()]
          : scenario === "orphan-arguments"
            ? [args("{}")]
            : scenario === "orphan-end"
              ? [end()]
              : scenario === "late-arguments"
                ? [start(), args(call().arguments), end(), args("{}")]
                : [start(), args(call().arguments), end(), end()];
      const result = await run([...events, done]);
      expect(result.events.some((event) => event.type === "tool_call")).toBe(false);
      expect(result.events.at(-1)).toMatchObject({
        type: "result",
        result: { status: "failed", reason: "invalid_output" },
      });
    },
  );
  it("never publishes incomplete arguments", async () => {
    const result = await run([start(), args('{"title":'), done]);
    expect(result.events.some((event) => event.type === "tool_call")).toBe(false);
    expect(result.events.at(-1)).toMatchObject({ type: "result", result: { status: "failed" } });
  });
  it.each(["arguments-only", "call-then-text", "call-then-arguments"])(
    "fails %s with one cumulative budget and no tool event",
    async (scenario) => {
      const events: AdapterEvent[] =
        scenario === "arguments-only"
          ? [start(), args("😀".repeat(33))]
          : scenario === "call-then-text"
            ? [start(), args("x".repeat(100)), end(), { type: "text", text: "😀".repeat(10) }]
            : [start(), args("x".repeat(100)), end(), start("c2"), args("x".repeat(29), "c2")];
      const result = await run([...events, done], 128);
      expect(result.events.some((event) => event.type === "tool_call")).toBe(false);
      expect(result.events.at(-1)).toMatchObject({
        type: "result",
        result: { status: "failed", reason: "output_limit_exceeded" },
      });
      if (scenario === "call-then-text")
        expect(
          result.events
            .filter((event) => event.type === "text")
            .map((event) => event.text)
            .join(""),
        ).toBe("😀".repeat(7));
    },
  );
});

it("exercises create-project, send and human decisions through development actions", async () => {
  const f = storageFixture();
  await f.store.open();
  const sent: string[] = [];
  const provider = new DurableProvider({
    storage: f.store,
    context: { generation: "setup-tests", mode: "development", connections: setupConnections() },
    send: (text) => sent.push(text),
  });
  await provider.developmentAction({
    kind: "development_action",
    version: 1,
    generation: "setup-tests",
    action: { name: "create-project", operation_id: "create" },
  });
  const project = value(await f.store.readProjects())[0]!;
  const conversation = value(await f.store.readConversations(project.id))[0]!;
  expect(sent.some((text) => text.includes(conversation.id))).toBe(true);
  await provider.developmentAction({
    kind: "development_action",
    version: 1,
    generation: "setup-tests",
    action: {
      name: "send",
      operation_id: "send",
      conversation: conversation.id,
      text: "Synthetic title, in English.",
    },
  });
  const dispatch = sent.map((text) => decodeProviderDispatch(text, "setup-tests")).find(Boolean)!;
  expect(dispatch.request.operation).toBe("project_setup");
  for (const [index, event] of [
    { type: "tool_call" as const, ...call() },
    { type: "result" as const, result: { status: "completed" as const } },
  ].entries())
    await provider.receive({
      kind: "provider_event",
      version: 1,
      generation: "setup-tests",
      attempt: dispatch.request.attempt,
      event: { ...event, sequence: index + 1 },
    });
  const db = f.raw();
  const p = db.prepare("SELECT id FROM project_setup_proposals").get() as { id: Uint8Array };
  db.close();
  const proposal = identifier(p.id);
  expect(
    parseDevelopmentSwitches(
      ["--ohtia-dev-command=confirm-setup", `--ohtia-dev-proposal=${proposal}`],
      "confirm",
    ),
  ).toMatchObject({ ok: true, action: { name: "confirm-setup", proposal } });
  await provider.developmentAction({
    kind: "development_action",
    version: 1,
    generation: "setup-tests",
    action: { name: "confirm-setup", operation_id: "confirm", proposal },
  });
  expect(value(await f.store.readProjects())[0]?.setupConfirmedAt).not.toBeNull();
  provider.dispose();
});

it("publishes no buffered call while the response remains open and discards it on interruption", async () => {
  for (const interrupt of [false, true]) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let buffered!: () => void;
    const ready = new Promise<void>((resolve) => {
      buffered = resolve;
    });
    const events: ProviderEvent[] = [];
    const adapter = createFakeProvider({
      send: async (_request, control) => {
        if (!control.release()) return;
        control.emit({
          type: "tool_start",
          id: "raw",
          namespace: "ohtia",
          name: "propose_project_setup",
        });
        control.emit({ type: "tool_arguments", id: "raw", text: call().arguments });
        control.emit({ type: "tool_end", id: "raw" });
        control.emit({ type: "text", text: "Summary" });
        buffered();
        control.signal.addEventListener("abort", release, { once: true });
        await gate;
        if (!control.signal.aborted)
          control.emit({ type: "result", result: { status: "completed" } });
      },
    });
    const dispatch = new ProviderDispatch([adapter], {
      state: () => "connected",
      send: (generation, text) => events.push(decodeProviderEvent(text, generation)!.event),
    });
    dispatch.begin("buffer-test");
    const request = { ...conformanceRequest("fake"), tools: [setupTool] };
    const running = dispatch.receive({
      kind: "provider_dispatch",
      version: 1,
      generation: "buffer-test",
      request,
      permit: { id: "permit", attempt: request.attempt, issued_at: Date.now() },
    });
    await ready;
    expect(events.filter((event) => event.type === "activity")).toHaveLength(3);
    expect(events.filter((event) => event.type !== "activity").map((event) => event.type)).toEqual([
      "text",
    ]);
    if (interrupt)
      dispatch.interrupt({
        kind: "provider_interrupt",
        version: 1,
        generation: "buffer-test",
        attempt: request.attempt,
      });
    else release();
    await running;
    expect(events.filter((event) => event.type !== "activity").map((event) => event.type)).toEqual(
      interrupt ? ["text", "result"] : ["text", "tool_call", "result"],
    );
    dispatch.dispose();
  }
});

it("keeps active streamed arguments alive through the data service's wake review", async () => {
  const f = await setup();
  value(await f.append());
  let clock = 0;
  let wall = Date.now();
  const serviceMessages: string[] = [];
  const provider = new DurableProvider({
    storage: f.store,
    context: f.context,
    send: (text) => serviceMessages.push(text),
    monotonic: () => clock,
    wallClock: () => wall + clock,
  });
  await provider.pump();
  const message = serviceMessages
    .map((text) => decodeProviderDispatch(text, f.context.generation))
    .find(Boolean)!;
  wall = message.permit.issued_at;
  let control!: ProviderRequestControl;
  let signalReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  let release!: () => void;
  const ceased = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fake = createFakeProvider({
    send: async (_request, requestControl) => {
      control = requestControl;
      if (!control.release()) throw new Error("Unexpected dispatch refusal");
      control.emit({ type: "started", provider_request_id: null, model: "first" });
      control.emit({
        type: "tool_start",
        id: "wake-call",
        namespace: "ohtia",
        name: "propose_project_setup",
      });
      control.emit({ type: "tool_arguments", id: "wake-call", text: '{"title":"Synthetic' });
      signalReady();
      await ceased;
    },
  });
  const adapter = {
    ...fake,
    declaration: {
      ...fake.declaration,
      connection: { ...fake.declaration.connection, id: "chatgpt" },
    },
  };
  const mainMessages: string[] = [];
  const dispatch = new ProviderDispatch([adapter], {
    state: () => "connected",
    send: (_generation, text) => mainMessages.push(text),
    wallClock: () => wall + clock,
    monotonic: () => clock,
  });
  dispatch.begin(f.context.generation);
  const pending = dispatch.receive(message);
  const forward = async () => {
    for (const text of mainMessages.splice(0)) {
      const decoded = decodeProviderEvent(text, f.context.generation)!;
      await provider.receive(decoded);
    }
  };
  try {
    await ready;
    await forward();
    clock = 110000;
    control.emit({
      type: "tool_arguments",
      id: "wake-call",
      text: ' title","document_language":"',
    });
    await forward();
    clock = 190000;
    control.emit({ type: "tool_arguments", id: "wake-call", text: 'en"}' });
    await forward();
    const stamp = new Date(wall + clock).toISOString();
    provider.wake({
      kind: "service_wake",
      version: 1,
      generation: f.context.generation,
      suspendedAt: stamp,
      resumedAt: stamp,
      asleepMs: 0,
    });
    expect(serviceMessages.some((text) => JSON.parse(text).kind === "provider_interrupt")).toBe(
      false,
    );
    control.emit({ type: "tool_end", id: "wake-call" });
    control.emit({ type: "result", result: { status: "completed" } });
    release();
    await pending;
    await forward();
    expect(f.proposals()[0]).toMatchObject({ state: "proposed", title: "Synthetic title" });
  } finally {
    release();
    dispatch.dispose();
    provider.dispose();
  }
});

it("carries the full setup history and proposal notes even under worst-case JSON escaping", () => {
  const policy = operationPolicy("project_setup", 1, "development")!;
  const messages = Array.from({ length: 200 }, (_, i) => ({
    reference: `message-${i}`,
    position: 2 * i + 1,
    role: "user" as const,
    text: "\u0001".repeat(327),
  }));
  const notes = Array.from({ length: 199 }, (_, i) => ({
    reference: `proposal-${i}`,
    position: 2 * i + 2,
    revision: 2,
    text: setupNote({
      state: "replaced",
      title: "\u0001".repeat(200),
      document_language: "en",
      invalid_reason: null,
    })!,
  }));
  const built = buildInput(policy, messages, { reference: "conversation", revision: 1 }, notes)!;
  const request = {
    ...conformanceRequest("chatgpt"),
    operation: "project_setup" as const,
    instructions: policy.instructions,
    input: built.input,
    tools: [setupTool],
  };
  const dispatch = {
    kind: "provider_dispatch",
    version: 1,
    generation: "history",
    request,
    permit: { id: "permit", attempt: request.attempt, issued_at: 1 },
  };
  const text = JSON.stringify(dispatch);
  expect(utf8Size(text)).toBeGreaterThan(512 * 1024);
  expect(utf8Size(text)).toBeLessThanOrEqual(providerMessageBytes);
  expect(decodeProviderDispatch(text, "history")).toEqual(dispatch);
});

it.each(["complete", "overflow", "invalid-name", "invalid-unicode"])(
  "applies the dispatch contract to %s atomic adapter calls",
  async (scenario) => {
    const atomic: AdapterEvent = {
      type: "tool_call",
      ...call(),
      ...(scenario === "overflow" ? { arguments: "😀".repeat(33) } : {}),
      ...(scenario === "invalid-name" ? { name: "" } : {}),
      ...(scenario === "invalid-unicode" ? { arguments: "\ud800" } : {}),
    };
    const adapter = createFakeProvider({
      send: async (_request, control) => {
        if (!control.release()) return;
        control.emit(atomic);
        if (!control.signal.aborted)
          control.emit({ type: "result", result: { status: "completed" } });
      },
    });
    const request = {
      ...conformanceRequest("fake"),
      operation: "project_setup" as const,
      tools: [setupTool],
      limits: { ...conformanceRequest("fake").limits, max_output_bytes: 128 },
    };
    const events = await dispatchThrough(
      { snapshot: () => ({ state: "connected" }) } as Parameters<typeof dispatchThrough>[0],
      adapter,
      request,
    );
    expect(events.filter((event) => event.type === "tool_call")).toEqual(
      scenario === "complete" ? [expect.objectContaining(atomic)] : [],
    );
    expect(events.at(-1)).toMatchObject({
      type: "result",
      result:
        scenario === "complete"
          ? { status: "completed" }
          : {
              status: "failed",
              reason: scenario === "overflow" ? "output_limit_exceeded" : "invalid_output",
            },
    });
  },
);

it("accepts complete initial SSE arguments while treating message items as activity", async () => {
  const f = fakeChatGPT();
  adapters.push(f.manager);
  await f.login();
  f.responses = (transport) =>
    streamResponse(
      [
        sse({ type: "response.output_item.added", item: { type: "message", id: "message" } }),
        sse({
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "initial",
            namespace: "ohtia",
            name: "propose_project_setup",
            arguments: call().arguments,
          },
        }),
        sse({ type: "response.function_call_arguments.done", item_id: "initial" }),
        sse({ type: "response.completed", response: {} }),
      ],
      { signal: transport.signal },
    );
  const events = await dispatchThrough(f.manager, f.adapter, {
    ...conformanceRequest("chatgpt"),
    operation: "project_setup",
    tools: [setupTool],
  });
  expect(events.filter((event) => event.type === "tool_call")).toEqual([
    expect.objectContaining({ type: "tool_call", ...call() }),
  ]);
  expect(events.at(-1)).toMatchObject({ type: "result", result: { status: "completed" } });
});

it("retains the accepted repeat-charge warning when an answered proposal cannot be rejected before a retry", async () => {
  const f = await setup();
  await f.complete([call()]);
  const proposal = f.proposals()[0]!;
  const uncertain = await f.complete([], "", { status: "uncertain", reason: "connection_lost" });
  const retry = value(
    await f.store.executeResearchCommand({
      command: "task.startAgain",
      operationId: "retry-uncertain",
      payload: { taskId: uncertain.task.taskId },
    }),
  ).resultId;
  const db = f.raw();
  const before = db
    .prepare("SELECT charge_warning_accepted_at FROM tasks WHERE id=?")
    .get(bytes(retry)) as { charge_warning_accepted_at: string };
  expect(before.charge_warning_accepted_at).toEqual(expect.any(String));
  expect(
    await f.store.executeResearchCommand({
      command: "project.rejectSetup",
      operationId: "reject-before-retry",
      payload: { proposalId: proposal.id },
    }),
  ).toMatchObject({ error: { code: "proposal_not_waiting" } });
  const waiting = db
    .prepare("SELECT id,charge_warning_accepted_at FROM tasks WHERE state IN ('queued','blocked')")
    .all() as { id: Uint8Array; charge_warning_accepted_at: string }[];
  expect(waiting.map((row) => identifier(row.id))).toEqual([retry]);
  expect(waiting[0]?.charge_warning_accepted_at).toBe(before.charge_warning_accepted_at);
  db.close();
  const prepared = await f.prepare();
  expect(prepared.taskId).toBe(retry);
  expect(
    prepared.dispatch.request.input.some(
      (item) =>
        item.text ===
        setupNote({
          state: "proposed",
          title: "Synthetic title",
          document_language: "en",
          invalid_reason: null,
        }),
    ),
  ).toBe(true);
});

it("rolls back setup finalization when its registry cannot be read and retries without lost effects", async () => {
  const f = storageFixture();
  const file = path.join(f.root, "unavailable-registry.txt");
  const store = new DurableStore({ ...f.options, languageRegistry: file });
  stores.push(store);
  await store.open();
  store.setTaskContext({
    generation: "setup-tests",
    mode: "development",
    connections: setupConnections(),
  });
  const project = value(
    await store.executeResearchCommand({
      command: "project.create",
      operationId: "create-with-missing-registry",
      payload: {},
    }),
  ).resultId;
  const conversation = value(await store.readConversations(project))[0]!;
  value(
    await store.executeResearchCommand({
      command: "message.append",
      operationId: "append-with-missing-registry",
      payload: { conversationId: conversation.id, content: "Synthetic request" },
    }),
  );
  const task = value(await store.prepareTask())!;
  const result: ProviderEvent = { type: "result", sequence: 1, result: { status: "completed" } };
  expect(
    await store.recordTaskEvent(task.dispatch.request.attempt, result, "Complete summary", [
      call(),
    ]),
  ).toMatchObject({ error: { code: "storage_failed" } });
  const db = f.raw();
  expect(db.prepare("SELECT count(*) FROM project_setup_proposals").pluck().get()).toBe(0);
  expect(db.prepare("SELECT count(*) FROM messages WHERE author_kind='agent'").pluck().get()).toBe(
    0,
  );
  expect(db.prepare("SELECT state FROM tasks WHERE id=?").pluck().get(bytes(task.taskId))).toBe(
    "running",
  );
  expect(
    db
      .prepare("SELECT state FROM attempts WHERE id=?")
      .pluck()
      .get(bytes(task.dispatch.request.attempt)),
  ).toBe("running");
  db.close();
  fs.copyFileSync("config/localization/iana-language-subtag-registry.txt", file);
  expect(
    value(
      await store.recordTaskEvent(task.dispatch.request.attempt, result, "Complete summary", [
        call(),
      ]),
    ).result,
  ).toMatchObject({ status: "completed" });
  expect(
    value(await store.readMessages(conversation.id)).filter(
      (message) => message.authorKind === "agent",
    ),
  ).toHaveLength(1);
  const saved = f.raw();
  expect(saved.prepare("SELECT count(*) FROM project_setup_proposals").pluck().get()).toBe(1);
  saved.close();
});

it("upgrades a schema-15 setup proposal without losing decisions or notice retry receipts", async () => {
  const f = await setup();
  await f.complete([call("Preserved setup", "es-AR")]);
  const proposal = f.proposals()[0]!;
  await f.store.close();
  const source = f.raw();
  source.exec(preTaskNoticeSql);
  expect(source.pragma("user_version", { simple: true })).toBe(15);
  source.close();
  const reopened = new DurableStore(f.options);
  stores.push(reopened);
  await reopened.open();
  reopened.setTaskContext(f.context);
  expect(f.proposals()).toContainEqual(proposal);
  value(
    await reopened.executeResearchCommand({
      command: "project.rejectSetup",
      operationId: "reject-upgraded-setup",
      payload: { proposalId: proposal.id },
    }),
  );
  value(
    await reopened.executeResearchCommand({
      command: "message.append",
      operationId: "append-after-upgrade",
      payload: { conversationId: f.conversationId, content: "Revise the setup" },
    }),
  );
  const prepared = value(await reopened.prepareTask())!;
  value(
    await reopened.recordTaskEvent(
      prepared.dispatch.request.attempt,
      {
        type: "result",
        sequence: 1,
        result: { status: "failed", reason: "provider_error", dispatched: true },
      },
      "",
    ),
  );
  const retry = value(
    await reopened.executeResearchCommand({
      command: "task.tryAgain",
      operationId: "retry-upgraded-setup",
      payload: { taskId: prepared.taskId },
    }),
  );
  const db = f.raw();
  expect(db.pragma("user_version", { simple: true })).toBe(17);
  expect(
    db
      .prepare("SELECT state FROM project_setup_proposals WHERE id=?")
      .pluck()
      .get(bytes(proposal.id)),
  ).toBe("rejected");
  expect(
    db
      .prepare("SELECT charge_warning_accepted_at FROM tasks WHERE id=?")
      .pluck()
      .get(bytes(retry.resultId)),
  ).toBeNull();
  expect(
    db
      .prepare("SELECT command FROM command_receipts WHERE operation_id=?")
      .pluck()
      .get("reject-upgraded-setup"),
  ).toBe("project.rejectSetup");
  expect(
    db
      .prepare("SELECT command FROM command_receipts WHERE operation_id=?")
      .pluck()
      .get("retry-upgraded-setup"),
  ).toBe("task.tryAgain");
  db.close();
});

it.each([
  {
    command: "task.tryAgain" as const,
    result: { status: "failed", reason: "provider_error", dispatched: true } as ProviderResult,
  },
  {
    command: "task.startAgain" as const,
    result: { status: "uncertain", reason: "connection_lost" } as ProviderResult,
  },
])(
  "keeps $command from reviving setup after the researcher confirms its proposal",
  async ({ command, result }) => {
    const f = await setup();
    await f.complete([call()]);
    const proposal = f.proposals()[0]!;
    const failed = await f.complete([], "Interrupted setup reply", result);
    // A previous build allowed confirmation after this reply; preserve its historical finality.
    const db = f.raw(),
      stamp = new Date().toISOString();
    db.exec("BEGIN");
    db.prepare(
      "UPDATE projects SET title=?, document_language=?, setup_confirmed_at=?, updated_at=? WHERE id=?",
    ).run(proposal.title, proposal.document_language, stamp, stamp, bytes(f.projectId));
    db.prepare(
      "UPDATE project_setup_proposals SET state='confirmed', decided_at=?, decided_by_operation_id=? WHERE id=?",
    ).run(stamp, "confirm-before-recovery", bytes(proposal.id));
    db.prepare(
      "INSERT INTO command_receipts(operation_id,command,payload_sha256,result_id,created_at) VALUES (?,?,?,?,?)",
    ).run(
      "confirm-before-recovery",
      "project.confirmSetup",
      createHash("sha256")
        .update(canonicalJson({ proposalId: proposal.id }))
        .digest(),
      bytes(f.projectId),
      stamp,
    );
    db.exec("COMMIT");
    db.close();
    expect(
      await f.store.executeResearchCommand({
        command,
        operationId: "recover-confirmed-setup",
        payload: { taskId: failed.task.taskId },
      }),
    ).toMatchObject({ error: { code: "task_not_retryable" } });
  },
);

describe("confirmed project direct guidance", () => {
  const specification = fs.readFileSync("docs/epics/EPIC-003-research-agents/epic.md", "utf8");

  function specifiedInstructions(block: string, indentation: number): string {
    const text = specification.split(`### ${block}:`)[1]!.split("\n### SPEC-")[0]!;
    return /```text\n([\s\S]*?)\n *```/
      .exec(text)![1]!
      .split("\n")
      .map((line) => line.slice(indentation))
      .join("\n");
  }

  const roleInstructions = specifiedInstructions("SPEC-003-022", 2);
  const thesisRoute = specifiedInstructions("SPEC-003-044", 0);
  const normative = `${roleInstructions}\n\n${thesisRoute}`;

  async function confirmed(emitDiagnostic?: (event: DiagnosticEvent) => void) {
    const f = await setup(false, emitDiagnostic);
    const setupReply = await f.complete([call("Redes de cuidado", "es-AR")]);
    expect(setupReply.task.dispatch.request.operation).toBe("project_setup");
    value(
      await f.store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "confirm-guidance",
        payload: { proposalId: f.proposals()[0]!.id },
      }),
    );
    return f;
  }

  it("pins guidance policy and the normative instruction with literal confirmed context", () => {
    const policy = operationPolicy("direct_guidance", 1, "installed")!;
    expect(policy).toMatchObject({
      operation: "direct_guidance",
      version: 1,
      instruction_version: 1,
      max_pending_tasks: 100,
      max_input_bytes: 262144,
      max_input_items: 500,
      max_output_bytes: 65536,
      max_work_units: 1,
      max_attempt_duration_ms: 600000,
      max_inactivity_ms: 120000,
      stop_grace_ms: 5000,
      max_attempts: 2,
      max_auto_retries: 0,
      retry_backoff_ms: 0,
    });
    for (const mode of ["development", "qualification"] as const)
      expect(operationPolicy("direct_guidance", 1, mode)).toBe(policy);
    expect(operationPolicy("direct_guidance", 2, "installed")).toBeUndefined();
    expect(directGuidanceInstructions).toBe(normative);
    expect(policy.instructions.split(thesisRoute)).toEqual([`${roleInstructions}\n\n`, ""]);
    const instructions = guidanceInstructions({
      project_type: "thesis",
      title: "$& {document_language}",
      document_language: "es-AR",
    });
    expect(instructions).toContain(
      "Project type: Thesis. The document a student writes and defends to obtain an academic degree.",
    );
    expect(instructions).toContain("Working title: $& {document_language}");
    expect(instructions).toContain("Document language: Spanish (Argentina) (es-AR)");
  });

  it.each([
    [
      "a broad new interest",
      "Me interesa el apoyo entre estudiantes. Todavía no tengo una pregunta.",
    ],
    [
      "advanced existing work",
      "Ya elegí comparar dos tutorías de primer año y tengo resultados descriptivos de un semestre.",
    ],
    [
      "an unchosen interview technique",
      "Estoy considerando entrevistas, pero todavía no elegí un diseño ni formulé la pregunta.",
    ],
    [
      "a missing prerequisite",
      "Quiero recoger testimonios, pero aún no tengo acceso a participantes ni confirmación de los permisos aplicables.",
    ],
  ])("sends the complete thesis route with %s", async (_scenario, context) => {
    const f = await confirmed();
    const contextId = value(await f.append(context)).resultId;
    const question = "¿Qué paso tendría sentido ahora?";
    const questionId = value(await f.append(question)).resultId;
    const task = await f.prepare();
    const decoded = decodeProviderDispatch(JSON.stringify(task.dispatch), task.dispatch.generation);
    const expectedRole = roleInstructions
      .replace("{project_type_name}", "Thesis")
      .replace(
        "{project_type_description}",
        "The document a student writes and defends to obtain an academic degree.",
      )
      .replace("{title}", "Redes de cuidado")
      .replace("{document_language_name}", "Spanish (Argentina)")
      .replace("{document_language}", "es-AR");
    expect(decoded?.request).toMatchObject({
      operation: "direct_guidance",
      instruction_version: 1,
      instructions: `${expectedRole}\n\n${thesisRoute}`,
      tools: [],
      input: [
        { role: "user", text: "Synthetic setup request" },
        { role: "user", text: context },
        { role: "user", text: question },
      ],
    });
    expect(task.transfer.slice(-2)).toEqual([
      { kind: "message", reference: contextId },
      { kind: "message", reference: questionId },
    ]);
  });

  it("routes confirmed messages through the fake provider without tools and records exact transfer identities", async () => {
    const diagnostics: DiagnosticEvent[] = [];
    const f = await confirmed((event) => diagnostics.push(event));
    value(await f.append("Please help me clarify the question."));
    const task = await f.prepare();
    const request = task.dispatch.request;
    expect(request).toMatchObject({
      operation: "direct_guidance",
      model: "first",
      policy_version: 1,
      instruction_version: 1,
      document_language: "es-AR",
      tools: [],
      limits: {
        max_output_bytes: 65536,
        max_attempt_duration_ms: 600000,
        max_inactivity_ms: 120000,
      },
    });
    expect(request.instructions).toContain("Working title: Redes de cuidado");
    expect(request.instructions).toContain("Document language: Spanish (Argentina) (es-AR)");
    const fake = createFakeProvider();
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
        send: (_generation, text) => {
          const event = decodeProviderEvent(text, "setup-tests");
          expect(event).toBeDefined();
          events.push(event!.event);
        },
      },
    );
    const events: ProviderEvent[] = [];
    dispatch.begin("setup-tests");
    // The task fixture uses a fixed clock; authorize this synthetic dispatch at the current clock.
    await dispatch.receive({
      ...task.dispatch,
      permit: { ...task.dispatch.permit, issued_at: Date.now() },
    });
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe("result"));
    expect(events.at(-1)).toMatchObject({ type: "result", result: { status: "completed" } });
    let reply = "";
    for (const event of events) {
      if (event.type === "text") reply += event.text;
      value(await f.store.recordTaskEvent(request.attempt, event, reply));
    }
    dispatch.dispose();
    expect(value(await f.store.readMessages(f.conversationId)).at(-1)).toMatchObject({
      content: "Synthetic reply.",
      ending: "complete",
    });
    const db = f.raw();
    const attempt = db
      .prepare("SELECT transfer_manifest, requested_model FROM attempts WHERE id=?")
      .get(bytes(request.attempt)) as { transfer_manifest: string; requested_model: string };
    db.close();
    const sent = value(await f.store.readMessages(f.conversationId))
      .filter((m) => m.taskId !== task.taskId)
      .map((m) => m.id);
    expect(
      JSON.parse(attempt.transfer_manifest)
        .filter((entry: { kind: string }) => entry.kind === "message")
        .map((entry: { reference: string }) => entry.reference),
    ).toEqual(sent);
    expect(attempt.requested_model).toBe("first");
    expect(f.proposals()).toHaveLength(1);
    expect(diagnostics.map((event) => event.event_name)).toEqual(
      expect.arrayContaining([
        "ohtia.task.accepted",
        "ohtia.task.dispatch_permitted",
        "ohtia.task.completed",
      ]),
    );
    for (const event of diagnostics) {
      expect(decodeDiagnosticEvent(event)).toEqual(event);
      expect(makeDiagnosticRecord(event, "0.0.0", "2026-11-17T00:00:00.000Z")).toBeDefined();
    }
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /Redes|Spanish|Synthetic reply|clarify the question|first|es-AR|You are Virgilio/,
    );
  });

  it.each(["setup", "confirmed"] as const)(
    "keeps a misrouted %s project task blocked when its connection returns",
    async (stage) => {
      const f = stage === "setup" ? await setup() : await confirmed();
      f.store.setTaskContext({ ...f.context, connections: new ServiceConnections() });
      const routing = vi.spyOn(TaskTransaction.prototype, "destination").mockResolvedValue({
        policy: operationPolicy(
          stage === "setup" ? "direct_guidance" : "project_setup",
          1,
          "development",
        )!,
        connection: "chatgpt",
      });
      try {
        value(await f.append("Synthetic request with an incompatible routed operation"));
      } finally {
        routing.mockRestore();
      }
      f.store.setTaskContext(f.context);
      value(await f.store.reconcileTaskConnections());
      expect(value(await f.store.prepareTask())).toBeNull();
      const db = f.raw();
      const task = db
        .prepare("SELECT id,state,blocking_reason FROM tasks ORDER BY rowid DESC LIMIT 1")
        .get() as { id: Uint8Array; state: string; blocking_reason: string };
      expect(task).toMatchObject({ state: "blocked", blocking_reason: "connection_disabled" });
      expect(db.prepare("SELECT count(*) FROM attempts WHERE task_id=?").pluck().get(task.id)).toBe(
        0,
      );
      db.close();
    },
  );

  it("bounds recent whole messages by bytes and records omissions and partial replies", async () => {
    const f = await confirmed();
    const ids: string[] = [];
    for (let n = 0; n < 4; n++) ids.push(value(await f.append("😀".repeat(20000))).resultId);
    const task = await f.prepare();
    expect(decodeProviderDispatch(JSON.stringify(task.dispatch), task.dispatch.generation)).toEqual(
      task.dispatch,
    );
    expect(task.dispatch.request.input).toEqual([
      { role: "user", text: "Earlier messages in this conversation are not included." },
      ...Array.from({ length: 3 }, () => ({ role: "user", text: "😀".repeat(20000) })),
    ]);
    expect(
      task.transfer.filter((entry) => entry.kind === "message").map((entry) => entry.reference),
    ).toEqual(ids.slice(1));
    expect(task.transfer).toContainEqual({
      kind: "note",
      note: "earlier_messages_omitted",
      reference: f.conversationId,
      revision: expect.any(Number),
    });
    value(
      await f.store.recordTaskEvent(
        task.dispatch.request.attempt,
        {
          type: "result",
          sequence: 1,
          result: { status: "failed", reason: "inactivity_timeout", dispatched: true },
        },
        "Incomplete guidance",
      ),
    );
    value(await f.append("Propose the next action."));
    const next = await f.prepare();
    expect(next.dispatch.request.input).toContainEqual({
      role: "user",
      text: "Note from Ohtia: Virgilio's reply above is incomplete. It was cut off because the service sent nothing for too long.",
    });
    expect(
      next.transfer.some((entry) => entry.kind === "note" && entry.note === "partial_reply"),
    ).toBe(true);
  });

  it("rejects the 101st waiting guidance reply atomically while coalescing an existing reply at the cap", async () => {
    const f = await confirmed();
    const waitingConversations: string[] = [f.conversationId];
    for (let n = 0; n < 99; n++) {
      const projectId = value(
        await f.store.executeResearchCommand({
          command: "project.create",
          operationId: `guidance-project-${n}`,
          payload: {},
        }),
      ).resultId;
      const proposalId = await proposeSetup(f.store, f.raw, projectId, {
        title: "Synthetic confirmed title",
        document_language: "es-AR",
      });
      value(
        await f.store.executeResearchCommand({
          command: "project.confirmSetup",
          operationId: `guidance-confirm-${n}`,
          payload: { proposalId },
        }),
      );
      const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
      waitingConversations.push(conversationId);
    }
    const projectId = value(
      await f.store.executeResearchCommand({
        command: "project.create",
        operationId: "guidance-overflow-project",
        payload: {},
      }),
    ).resultId;
    const proposalId = await proposeSetup(f.store, f.raw, projectId);
    value(
      await f.store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "guidance-overflow-confirm",
        payload: { proposalId },
      }),
    );
    const conversationId = value(await f.store.readConversations(projectId))[0]!.id;
    for (const [n, waitingId] of waitingConversations.entries())
      value(
        await f.store.executeResearchCommand({
          command: "message.append",
          operationId: `guidance-pending-${n}`,
          payload: { conversationId: waitingId, content: "Waiting guidance" },
        }),
      );
    const before = value(await f.store.readMessages(conversationId));
    expect(
      await f.store.executeResearchCommand({
        command: "message.append",
        operationId: "guidance-overflow-message",
        payload: { conversationId, content: "Must stay in composer" },
      }),
    ).toMatchObject({ error: { code: "pending_limit_reached" } });
    expect(value(await f.store.readMessages(conversationId))).toEqual(before);
    value(await f.append("Replace my waiting guidance"));
    const db = f.raw();
    expect(
      db
        .prepare(
          "SELECT count(*) FROM tasks WHERE operation='direct_guidance' AND state IN ('queued','blocked')",
        )
        .pluck()
        .get(),
    ).toBe(100);
    expect(
      db
        .prepare(
          "SELECT count(*) FROM command_receipts WHERE operation_id='guidance-overflow-message'",
        )
        .pluck()
        .get(),
    ).toBe(0);
    db.close();
  }, 60000);

  it("carries 500 recent messages and cut notes through both private decoders with worst-case escaping", () => {
    const policy = operationPolicy("direct_guidance", 1, "development")!;
    const messages = Array.from({ length: 501 }, (_, i) => ({
      reference: `message-${i}`,
      position: i,
      role: "assistant" as const,
      text: "\u0001".repeat(524),
      partial: { agent: "Virgilio", reason: "inactivity_timeout" },
    }));
    const built = buildInput(policy, messages, { reference: "conversation", revision: 1 })!;
    expect(built.input).toHaveLength(1001);
    expect(built.transfer.filter((entry) => entry.kind === "message")).toHaveLength(500);
    expect(built.transfer).not.toContainEqual({ kind: "message", reference: "message-0" });
    const dispatch = {
      kind: "provider_dispatch",
      version: 1,
      generation: "bounded-guidance",
      request: {
        ...conformanceRequest("chatgpt"),
        operation: "direct_guidance",
        input: built.input,
        instructions: guidanceInstructions({
          project_type: "thesis",
          title: "Synthetic title",
          document_language: "es-AR",
        }),
      },
      permit: { id: "permit", attempt: "attempt-1", issued_at: 1 },
    };
    const encoded = JSON.stringify(dispatch);
    expect(utf8Size(encoded)).toBeGreaterThan(1024 * 1024);
    expect(utf8Size(encoded)).toBeLessThanOrEqual(providerMessageBytes);
    expect(decodeProviderDispatch(encoded, dispatch.generation)).toEqual(dispatch);
    for (const [instructions, admitted] of [
      ["é".repeat(4096), true],
      ["é".repeat(4096) + "a", false],
    ] as const) {
      const withInstructions = {
        ...dispatch,
        request: { ...dispatch.request, instructions },
      };
      expect(decodeProviderDispatch(JSON.stringify(withInstructions), dispatch.generation)).toEqual(
        admitted ? withInstructions : undefined,
      );
    }
    const report = {
      kind: "development_report",
      version: 1,
      generation: "bounded-guidance",
      operation_id: "guidance-report",
      report: {
        type: "finished",
        attempt: "attempt-1",
        result: { status: "completed" },
        usage: {
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
        },
        transfer: built.transfer,
        events: 2,
        duration_ms: 10,
        longest_silence_ms: 5,
      },
    };
    expect(built.transfer).toHaveLength(1002);
    expect(decodeDevelopmentReport(JSON.stringify(report), report.generation)).toEqual(report);
  });
});
