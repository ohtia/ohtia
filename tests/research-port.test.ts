import diagnosticCases from "../config/desktop/diagnostic-cases.json" with { type: "json" };
import fs from "node:fs";
import path from "node:path";
import { DiagnosticWriter } from "../packages/main/src/diagnostic-writer.js";
import { forbiddenResponseFields, responsesBody } from "../packages/main/src/chatgpt-responses.js";
import { ActivityController } from "../packages/renderer/src/activity-controller.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { ProviderDispatch } from "../packages/main/src/provider-dispatch.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { ProjectController } from "../packages/renderer/src/project-controller.js";
import { bytes, identifier, newId } from "../packages/utility/src/research.js";
import { stagedCommand } from "../packages/renderer/src/staged-command.js";
import { proposeSetup } from "./fixtures/project-setup.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeProviderDispatch,
  decodeLateUsageReceipt,
  decodeText,
  encodeEnvelope,
  failure,
  policyId,
  splitText,
  utf8Size,
  mergeTimeline,
  type Outcome,
  type TimelineItem,
  type ResearchOutputs,
  type ResearchEvent,
  type ProviderEvent,
  type ConversationCursor,
  type DiagnosticEvent,
  type LateUsageReport,
  type LateUsageDecision,
  type ProviderRequestData,
  type ProviderResult,
  type TransferEntry,
} from "../packages/contracts/src/index.js";
import { TextStaging, digest } from "../packages/utility/src/research-text.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import { parseDevelopmentSwitches } from "../packages/main/src/development-command.js";
import { storageFixture } from "./fixtures/storage.js";
import { preReplyUsageSql } from "../tooling/storage-legacy-consultation-fixture.mjs";

const entity = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const value = <T>(result: Outcome<T>): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const controls: (() => void)[] = [];
afterEach(() => {
  for (const dispose of controls.splice(0)) dispose();
  vi.useRealTimers();
});
async function harness() {
  const fixture = storageFixture();
  await fixture.store.open();
  const listeners = new Map<string, (text: unknown) => void>();
  let id = 0;
  const sent: string[] = [];
  const lost = vi.fn();
  const service = createStatusService(
    "service",
    "en-US",
    (text) => {
      sent.push(text);
      const envelope = decodeText(text);
      if (envelope.ok) listeners.get(envelope.value.windowGeneration)?.(text);
    },
    fixture.store,
    lost,
    "development",
  );
  service.activate("en-US");
  const openWindow = (windowGeneration: string) => {
    const client = createFoundationPort(
      { contextIsolated: true, sandboxed: true },
      {
        send: (text) => service.receive(text),
        listen: (listener) => {
          listeners.set(windowGeneration, listener);
          return () => {
            listeners.delete(windowGeneration);
          };
        },
      },
      {
        after: (ms, fn) => {
          const timer = setTimeout(fn, ms);
          return () => clearTimeout(timer);
        },
      },
      { windowGeneration, serviceGeneration: "service", nextId: () => `request-${++id}` },
    );
    controls.push(() => client.dispose());
    return client;
  };
  const client = openWindow("window");
  controls.push(() => service.dispose());
  const project = value(await client.port.createProject("create-project").result);
  // Confirmed-project messages exercise guidance task notices alongside research transport.
  const fixtureDb = fixture.raw();
  fixtureDb
    .prepare(
      "UPDATE projects SET title='Research',document_language='en',setup_confirmed_at=created_at WHERE id=?",
    )
    .run(Buffer.from(project.resultId.replaceAll("-", ""), "hex"));
  fixtureDb.close();
  const conversations = value(
    await client.port.listConversations({ projectId: project.resultId, cursor: null, count: 50 })
      .result,
  ).items;
  return {
    ...fixture,
    lost,
    service,
    client,
    openWindow,
    port: client.port,
    sent,
    projectId: project.resultId,
    conversationId: conversations[0]!.id,
  };
}

describe("research text transport", () => {
  it.each(["한".repeat(20_000), "😀".repeat(20_000), "x".repeat(192 * 1024), "\0".repeat(5000)])(
    "preserves long Unicode text across strict port strings %#",
    (text) => {
      const parts = splitText(text);
      expect(parts.join("")).toBe(text);
      expect(parts.every((part) => utf8Size(part) <= 4096)).toBe(true);
      const descriptor = { parts: parts.length, bytes: utf8Size(text), sha256: digest(text) };
      const staging = new TextStaging();
      controls.push(() => staging.dispose());
      parts.forEach((text, index) =>
        expect(
          staging.part("window", "operation", {
            index: index + 1,
            count: parts.length,
            bytes: descriptor.bytes,
            sha256: descriptor.sha256,
            text,
          }).ok,
        ).toBe(true),
      );
      expect(staging.take("window", "operation", descriptor)).toEqual({ ok: true, value: text });
      expect(staging.take("window", "operation", descriptor)).toEqual(failure("parts_incomplete"));
    },
  );
  it("discards conflicting indexes, inconsistent metadata, expired uploads and closed windows", () => {
    vi.useFakeTimers();
    const staging = new TextStaging();
    controls.push(() => staging.dispose());
    const text = "a".repeat(5000);
    const parts = splitText(text);
    const descriptor = { parts: 2, bytes: 5000, sha256: digest(text) };
    const first = { index: 1, count: 2, bytes: 5000, sha256: descriptor.sha256, text: parts[0]! };
    expect(staging.part("one", "id", first).ok).toBe(true);
    expect(staging.part("one", "id", { ...first, text: "changed" })).toEqual(
      failure("invalid_message"),
    );
    expect(staging.take("one", "id", descriptor)).toEqual(failure("parts_incomplete"));
    staging.part("one", "id", first);
    expect(staging.part("one", "id", { ...first, count: 3 })).toEqual(failure("invalid_message"));
    staging.part("one", "id", first);
    expect(staging.part("one", "id", { ...first, index: 3 })).toEqual(failure("invalid_message"));
    staging.part("one", "id", first);
    vi.advanceTimersByTime(60_000);
    expect(staging.take("one", "id", descriptor)).toEqual(failure("parts_incomplete"));
    staging.part("one", "id", first);
    staging.closeWindow("one");
    expect(staging.take("one", "id", descriptor)).toEqual(failure("parts_incomplete"));
    for (let n = 0; n < 4; n++) expect(staging.part("two", `id-${n}`, first).ok).toBe(true);
    expect(staging.part("two", "fifth", first)).toEqual(failure("busy"));
    expect(staging.part("three", "independent", first).ok).toBe(true);
  });
  it.each(["😀".repeat(20_000), "x".repeat(20_000)])(
    "uses one durable receipt for a resend and replays without uploading parts again %#",
    async (text) => {
      const h = await harness();
      const parts = splitText(text);
      const content = { parts: parts.length, bytes: utf8Size(text), sha256: digest(text) };
      const input = { conversationId: h.conversationId, content };
      expect(await h.port.appendMessage("append", input).result).toEqual(
        failure("parts_incomplete"),
      );
      for (let index = 0; index < parts.length; index++)
        value(
          await h.port.sendTextPart("append", {
            index: index + 1,
            count: parts.length,
            bytes: content.bytes,
            sha256: content.sha256,
            text: parts[index]!,
          }).result,
        );
      const saved = value(await h.port.appendMessage("append", input).result);
      expect(value(await h.port.appendMessage("append", input).result)).toEqual(saved);
      expect(
        await h.port.appendMessage("append", {
          ...input,
          content: { ...content, sha256: digest("other") },
        }).result,
      ).toEqual(failure("operation_conflict"));
      const messages = value(await h.store.readMessages(h.conversationId));
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe(text);
      const page = value(
        await h.port.listTimelineBefore({
          conversationId: h.conversationId,
          cursor: null,
          count: 50,
        }).result,
      );
      const message = page.items.find(
        (item) => item.kind === "message" && item.id === saved.resultId,
      );
      expect(page.items.some((item) => item.kind === "task")).toBe(true);
      const reference = message?.kind === "message" && message.content;
      expect(reference && typeof reference !== "string").toBe(true);
      if (!reference || typeof reference === "string") throw new Error("Expected text reference.");
      let read = "";
      for (let index = 1; index <= reference.parts; index++)
        read += value(await h.port.readTextPart({ source: reference.source, index }).result).text;
      expect(read).toBe(text);
      expect(digest(read)).toBe(reference.sha256);
    },
  );
});

describe("research timeline and bounded reads", () => {
  it("paginates 120 messages with reply tasks in explicit batches and rechecks rename revisions through the real port", async () => {
    const h = await harness();
    for (let n = 0; n < 120; n++)
      value(
        await h.port.appendMessage(`append-${n}`, {
          conversationId: h.conversationId,
          content: `message ${n}`,
        }).result,
      );
    const ids: string[] = [];
    let cursor = null;
    let count = 0;
    let messageCount = 0;
    let taskCount = 0;
    do {
      const items: ResearchOutputs["timeline.listBefore"] = value(
        await h.port.listTimelineBefore({ conversationId: h.conversationId, cursor, count: 50 })
          .result,
      );
      ids.push(...items.items.map((item) => item.id));
      count += items.items.length;
      messageCount += items.items.filter((item) => item.kind === "message").length;
      taskCount += items.items.filter((item) => item.kind === "task").length;
      cursor = items.next;
      // Small whole-item fragments compose into the requested page of 50.
      if (cursor) expect(items.items.length).toBeGreaterThan(0);
    } while (cursor);
    expect(count).toBe(240);
    expect(messageCount).toBe(120);
    expect(taskCount).toBe(120);
    expect(new Set(ids).size).toBe(240);
    const original = value(
      await h.port.readConversations({ projectId: h.projectId, ids: [h.conversationId] }).result,
    ).items[0]!;
    value(
      await h.port.renameConversation("rename", {
        conversationId: h.conversationId,
        title: "First",
        expectedUpdatedAt: original.updatedAt,
      }).result,
    );
    expect(
      await h.port.renameConversation("rename-other", {
        conversationId: h.conversationId,
        title: "Second",
        expectedUpdatedAt: original.updatedAt,
      }).result,
    ).toMatchObject({
      ok: false,
      error: {
        code: "stale_revision",
        nextAction: "refresh_preference",
        parameters: { currentRevision: original.revision + 1 },
      },
    });
    expect(h.sent.every((text) => !text.startsWith('{"protocol"') || decodeText(text).ok)).toBe(
      true,
    );
  });
  it("returns whole conversations in requested order and remaining identifiers within the envelope bounds", async () => {
    const h = await harness();
    value(await h.port.listProjects({ cursor: null, count: 40 }).result);
    const db = h.raw();
    for (let n = 1; n <= 128; n++)
      db.prepare(
        "INSERT INTO conversations (id,project_id,title,created_at,updated_at,revision) VALUES(?,?,?,?,?,1)",
      ).run(
        Buffer.from(entity(n).replaceAll("-", ""), "hex"),
        Buffer.from(h.projectId.replaceAll("-", ""), "hex"),
        "한".repeat(200),
        "2026-11-15T12:00:00.000Z",
        "2026-11-15T12:00:00.000Z",
      );
    db.close();
    let remaining = Array.from({ length: 128 }, (_, i) => entity(128 - i));
    const received: string[] = [];
    let pages = 0;
    while (remaining.length) {
      const result = value(
        await h.port.readConversations({ projectId: h.projectId, ids: remaining }).result,
      );
      expect(result.items.length).toBeGreaterThan(0);
      received.push(...result.items.map((row) => row.id));
      remaining = [...result.remaining];
      pages++;
    }
    expect(received).toEqual(Array.from({ length: 128 }, (_, i) => entity(128 - i)));
    expect(pages).toBeGreaterThan(1);
  });
  it("orders same-position ranks and ignores old revisions without duplicating identities", () => {
    const task: TimelineItem = {
      kind: "task",
      id: entity(3),
      position: 8,
      rank: 3,
      revision: 2,
      state: "running",
      agentId: "virgilio",
      language: "ko",
    };
    const message: TimelineItem = {
      kind: "message",
      id: entity(1),
      position: 8,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "virgilio",
      taskId: entity(3),
      content: "reply",
      language: "ko",
      ending: "complete",
    };
    expect(
      mergeTimeline([task], [message, task, { ...task, revision: 1, state: "queued" }]),
    ).toEqual([message, task]);

    const consultation = {
      ...task,
      agentId: "josefa",
      consultation: true,
      replacesTaskId: null,
      consultationRetryFits: true,
      state: "failed",
      connection: "chatgpt",
      replyMessageId: null,
      blockingReason: null,
      outcomeReason: "provider_error",
      dispatched: true,
      superseded: false,
      waitingForModels: false,
      waitingLimit: null,
      maxAttemptDurationMs: 600000,
      maxInactivityMs: 120000,
    } as const;
    const budgetSpent = { ...consultation, consultationRetryFits: false };
    expect(mergeTimeline([consultation], [budgetSpent])).toEqual([budgetSpent]);
    const superseded = { ...budgetSpent, superseded: true };
    expect(mergeTimeline([consultation], [superseded])).toEqual([superseded]);
    const replacement = {
      ...consultation,
      id: entity(4),
      replacesTaskId: consultation.id,
      state: "queued",
    } as const;
    expect(mergeTimeline([consultation], [replacement])).toEqual([superseded, replacement]);
  });
  it("a window without an open project receives only shared record events", async () => {
    const h = await harness();
    const events: unknown[] = [];
    const subscription = h.port.subscribeResearch(
      { projectId: null, conversationId: null },
      (event) => events.push(event),
    );
    value(await subscription.ready);
    value(await h.port.createProject("second-project").result);
    await h.service.drain();
    await vi.waitFor(
      () =>
        expect(events).toContainEqual(
          expect.objectContaining({
            ok: true,
            value: expect.objectContaining({ record: "project", revision: 1 }),
          }),
        ),
      { timeout: 3000 },
    );
    expect(
      events.every(
        (event: any) =>
          event.value?.record !== "timeline" && event.value?.record !== "conversation",
      ),
    ).toBe(true);
  });
  it("admits exactly four subscriptions and never exposes development-only commands", async () => {
    const h = await harness();
    const listeners = () => {};
    value(await h.port.subscribePresentation(listeners).ready);
    value(await h.port.subscribeLocale(listeners).ready);
    value(await h.port.subscribeAppearance(listeners).ready);
    value(
      await h.port.subscribeResearch({ projectId: null, conversationId: null }, listeners).ready,
    );
    expect(await h.port.subscribeStatus(listeners).ready).toEqual(failure("busy"));
    for (const operation of ["development.createProject", "task.cancelAll"])
      expect(
        encodeEnvelope({
          protocol: 1,
          policy: policyId,
          kind: "request",
          requestId: "x",
          operationId: "y",
          windowGeneration: "window",
          serviceGeneration: "service",
          operation,
          payload: {},
        }).ok,
      ).toBe(false);
  });
  it("streams a real task through the research subscription and reads equal-position items without loss", async () => {
    const h = await harness();
    const project = value(
      await h.store.executeResearchCommand({
        command: "development.createProject",
        operationId: "dev-project",
        payload: {},
      }),
    );
    const conversation = value(await h.store.readConversations(project.resultId))[0]!;
    const events: unknown[] = [];
    const subscription = h.port.subscribeResearch(
      { projectId: project.resultId, conversationId: conversation.id },
      (event) => events.push(event),
    );
    value(await subscription.ready);
    h.service.receive(
      JSON.stringify({
        kind: "connection_state",
        generation: "service",
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
    h.service.receive(
      JSON.stringify({
        kind: "connection_models",
        generation: "service",
        page: {
          connection: "chatgpt",
          model_list_revision: 1,
          models: [{ id: "first-model", name: "First model" }],
          nextCursor: 1,
          hasMore: false,
        },
      }),
    );
    value(
      await h.port.appendMessage("task-message", {
        conversationId: conversation.id,
        content: "Synthetic question",
      }).result,
    );
    const initial = value(
      await h.port.listTimelineBefore({ conversationId: conversation.id, cursor: null, count: 50 })
        .result,
    );
    const task = initial.items.find((item) => item.kind === "task")!;
    const dispatch = h.sent
      .map((text) => JSON.parse(text))
      .find((item) => item.kind === "provider_dispatch");
    expect(dispatch).toBeDefined();
    const event = (event: unknown) =>
      h.service.receive(
        JSON.stringify({
          kind: "provider_event",
          version: 1,
          generation: "service",
          attempt: dispatch.request.attempt,
          event,
        }),
      );
    event({ type: "started", sequence: 1, provider_request_id: null, model: null });
    let sequence = 2;
    for (const text of splitText("한".repeat(2000)))
      event({ type: "text", sequence: sequence++, text });
    const parts = value(await h.port.readReplyParts({ taskId: task.id, fromSequence: 1 }).result);
    expect(parts.parts.map((part) => part.text).join("")).toBe("한".repeat(2000));
    expect(parts.parts.every((part) => utf8Size(part.text) <= 4096)).toBe(true);
    h.service.receive(
      JSON.stringify({
        kind: "application_exit",
        generation: "service",
        operationId: "research-exit",
        action: "hold",
      }),
    );
    await h.service.drain();
    expect(h.sent.map((text) => JSON.parse(text))).toContainEqual(
      expect.objectContaining({
        kind: "application_exit_state",
        operationId: "research-exit",
        running: 1,
        held: true,
        failed: false,
      }),
    );
    expect(value(await h.port.readReplyParts({ taskId: task.id, fromSequence: 1 }).result)).toEqual(
      parts,
    );
    h.service.receive(
      JSON.stringify({
        kind: "application_exit",
        generation: "service",
        operationId: "research-exit",
        action: "resume",
      }),
    );
    await h.service.drain();
    expect(h.lost).not.toHaveBeenCalled();
    await vi.waitFor(
      () =>
        expect(events).toContainEqual(
          expect.objectContaining({
            ok: true,
            value: expect.objectContaining({ kind: "reply", taskId: task.id, sequence: 1 }),
          }),
        ),
      { timeout: 3000 },
    );
    const summary = async () =>
      value(
        await h.port.readConversations({
          projectId: project.resultId,
          ids: [conversation.id],
        }).result,
      ).items[0]!;
    expect((await summary()).status).toBe("replying");
    const later = value(
      await h.port.appendMessage("later-researcher-message", {
        conversationId: conversation.id,
        content: "A later question",
      }).result,
    );
    const before = await summary();
    expect(before).toMatchObject({ latestPrefix: "A later question", status: "replying" });
    event({ type: "result", sequence, result: { status: "completed" } });
    expect(await summary()).toMatchObject({
      latestPrefix: before.latestPrefix,
      latestAt: before.latestAt,
    });
    const last = value(
      await h.port.listTimelineBefore({
        conversationId: conversation.id,
        cursor: { position: task.position + 1, rank: 1, id: later.resultId },
        count: 1,
      }).result,
    );
    expect(last.items[0]).toMatchObject({ kind: "task", state: "completed", rank: 3 });
    const preceding = value(
      await h.port.listTimelineBefore({
        conversationId: conversation.id,
        cursor: last.next,
        count: 1,
      }).result,
    );
    expect(preceding.items[0]).toMatchObject({
      kind: "message",
      authorKind: "agent",
      language: "en",
      rank: 1,
      position: last.items[0]!.position,
    });
    expect(preceding.items[0]!.id).not.toBe(last.items[0]!.id);
  });
  it("parses the explicit development-only conversation-opening action", () => {
    expect(
      parseDevelopmentSwitches(
        ["--ohtia-dev-command=open-conversation", "--ohtia-dev-conversation=invalid value"],
        "operation",
      ),
    ).toEqual({ ok: false, error: "Use a conversation identifier." });
    expect(
      parseDevelopmentSwitches(
        ["--ohtia-dev-command=open-conversation", `--ohtia-dev-conversation=${entity(1)}`],
        "operation",
      ),
    ).toEqual({
      ok: true,
      action: { name: "open-conversation", operation_id: "operation", conversation: entity(1) },
    });
  });
});

it("verifies long downloaded text and restarts at part one after a damaged read", async () => {
  const h = await harness();
  const text = "한😀".repeat(5000);
  const parts = splitText(text);
  const content = { parts: parts.length, bytes: utf8Size(text), sha256: digest(text) };
  for (let index = 0; index < parts.length; index++)
    value(
      await h.port.sendTextPart("long-controller", {
        index: index + 1,
        count: parts.length,
        bytes: content.bytes,
        sha256: content.sha256,
        text: parts[index]!,
      }).result,
    );
  value(
    await h.port.appendMessage("long-controller", { conversationId: h.conversationId, content })
      .result,
  );
  const { ConversationController } =
    await import("../packages/renderer/src/conversation-controller.js");
  let reads = 0;
  const port = {
    ...h.port,
    readTextPart: (input: { source: string; index: number }) => {
      reads++;
      return reads === 1
        ? {
            result: Promise.resolve({ ok: true as const, value: { text: "damaged" } }),
            cancel() {},
          }
        : h.port.readTextPart(input);
    },
  };
  const controller = new ConversationController(port);
  controller.open({ projectId: h.projectId, conversationId: h.conversationId });
  await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"), { timeout: 5000 });
  expect([...controller.snapshot().texts.values()]).toContain(text);
  expect(reads).toBe(parts.length * 2);
  const held = controller.snapshot().items.map((item) => item.id);
  const reread = value(
    await h.port.readTimeline({ conversationId: h.conversationId, ids: held }).result,
  );
  expect(reread.items.map((item) => item.id)).toEqual(held);
  expect(await h.port.readReplyParts({ taskId: entity(9999), fromSequence: 1 }).result).toEqual(
    failure("record_not_found"),
  );
  expect(await h.port.readTextPart({ source: "not-issued", index: 1 }).result).toEqual(
    failure("record_not_found"),
  );
  controller.dispose();
  const subscription = h.port.subscribeResearch(
    { projectId: h.projectId, conversationId: h.conversationId },
    () => {},
  );
  value(await subscription.ready);
  expect(
    await h.port.subscribeResearch({ projectId: null, conversationId: null }, () => {}).ready,
  ).toEqual(failure("busy"));
  subscription.dispose();
  value(await h.port.listProjects({ cursor: null, count: 40 }).result);
  const fresh = h.port.subscribeResearch({ projectId: null, conversationId: null }, () => {});
  value(await fresh.ready);
  fresh.dispose();
  value(
    await h.port.sendTextPart("window-close", {
      index: 1,
      count: 2,
      bytes: 5000,
      sha256: digest("a".repeat(5000)),
      text: "a".repeat(4096),
    }).result,
  );
  h.service.receive(
    JSON.stringify({
      kind: "research_window_closed",
      generation: "service",
      windowGeneration: "window",
    }),
  );
  expect(
    await h.port.appendMessage("window-close", {
      conversationId: h.conversationId,
      content: { parts: 2, bytes: 5000, sha256: digest("a".repeat(5000)) },
    }).result,
  ).toEqual(failure("parts_incomplete"));
});

it("rejects missing records and cross-project scopes with controlled errors and keeps empty identifier reads valid", async () => {
  const h = await harness();
  const missing = entity(9999);
  const calls = [
    h.port.readDestination({ projectId: missing, agentId: "virgilio" }),
    h.port.stopConversation("stop-missing-conversation", { conversationId: missing }),
    h.port.listConversations({ projectId: missing, cursor: null, count: 50 }),
    h.port.readConversations({ projectId: h.projectId, ids: [missing] }),
    h.port.listTimelineBefore({ conversationId: missing, cursor: null, count: 50 }),
    h.port.readTimeline({ conversationId: h.conversationId, ids: [missing] }),
    h.port.readTextPart({ source: `message_${missing}`, index: 1 }),
  ];
  for (const call of calls) expect(await call.result).toEqual(failure("record_not_found"));
  expect(
    value(await h.port.readTimeline({ conversationId: h.conversationId, ids: [] }).result),
  ).toEqual({ items: [], remaining: [] });
  expect(value(await h.port.readConversations({ projectId: h.projectId, ids: [] }).result)).toEqual(
    { items: [], remaining: [] },
  );
  expect(
    await h.port.subscribeResearch(
      { projectId: missing, conversationId: h.conversationId },
      () => {},
    ).ready,
  ).toEqual(failure("record_not_found"));
  const text = "a".repeat(5000),
    parts = splitText(text),
    sha256 = digest(text);
  value(
    await h.port.sendTextPart("invalid-index", {
      index: 1,
      count: 2,
      bytes: 5000,
      sha256,
      text: parts[0]!,
    }).result,
  );
  expect(
    await h.port.sendTextPart("invalid-index", {
      index: 0,
      count: 2,
      bytes: 5000,
      sha256,
      text: parts[0]!,
    }).result,
  ).toEqual(failure("invalid_message"));
  value(
    await h.port.sendTextPart("invalid-index", {
      index: 2,
      count: 2,
      bytes: 5000,
      sha256,
      text: parts[1]!,
    }).result,
  );
  expect(
    await h.port.appendMessage("invalid-index", {
      conversationId: h.conversationId,
      content: { parts: 2, bytes: 5000, sha256 },
    }).result,
  ).toEqual(failure("parts_incomplete"));
});

it("keeps one committed result and revokes provider admission when its post-commit pump fails", async () => {
  const h = await harness();
  const { DurableProvider } = await import("../packages/utility/src/durable-provider.js");
  const pump = vi
    .spyOn(DurableProvider.prototype, "pump")
    .mockRejectedValueOnce(new Error("Synthetic pump failure"));
  try {
    value(
      await h.port.appendMessage("commit-before-pump", {
        conversationId: h.conversationId,
        content: "Synthetic accepted text",
      }).result,
    );
    await h.service.drain();
    expect(h.lost).toHaveBeenCalledOnce();
    expect(
      h.sent
        .map((text) => JSON.parse(text))
        .filter((row) => row.kind === "result" && row.operationId === "commit-before-pump"),
    ).toHaveLength(1);
    expect(value(await h.store.readMessages(h.conversationId))[0]?.content).toBe(
      "Synthetic accepted text",
    );
  } finally {
    pump.mockRestore();
  }
});
it("keeps an unexpected research mutation exception uncertain before a terminal result", async () => {
  const h = await harness();
  vi.spyOn(h.store, "readResearchReceipt").mockRejectedValueOnce(
    new Error("Synthetic lost outcome"),
  );
  expect(
    await h.port.appendMessage("unknown-dispatch", {
      conversationId: h.conversationId,
      content: "Synthetic",
    }).result,
  ).toEqual(failure("uncertain"));
});
it("emits one correctly attributed public research diagnostic without content or internal-read noise", async () => {
  const h = await harness();
  const events: DiagnosticEvent[] = [];
  Object.assign(h.options, { emitDiagnostic: (event: DiagnosticEvent) => events.push(event) });
  value(await h.port.listProjects({ cursor: null, count: 40 }).result);
  expect(events.map((event) => event.event_name)).toEqual(["ohtia.project.listed"]);
  events.length = 0;
  value(
    await h.port.listTimelineBefore({ conversationId: h.conversationId, cursor: null, count: 50 })
      .result,
  );
  expect(events.map((event) => event.event_name)).toEqual(["ohtia.timeline.listed"]);
  events.length = 0;
  expect(
    (
      await h.port.renameConversation("bad-name", {
        conversationId: h.conversationId,
        title: "",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }).result
    ).ok,
  ).toBe(false);
  expect(events.filter((event) => event.event_name === "ohtia.research.failed")).toHaveLength(1);
  events.length = 0;
  const subscription = h.port.subscribeResearch(
    { projectId: h.projectId, conversationId: h.conversationId },
    () => {},
  );
  value(await subscription.ready);
  expect(events.map((event) => event.event_name)).toEqual(["ohtia.research.subscribed"]);
  subscription.dispose();
  await h.service.drain();
  expect(JSON.stringify(events)).not.toContain(h.conversationId);
  events.length = 0;
  const missing = h.port.subscribeResearch(
    { projectId: entity(999999), conversationId: null },
    () => {},
  );
  expect(await missing.ready).toEqual(failure("record_not_found"));
  expect(events.map((event) => event.event_name)).toEqual(["ohtia.research.failed"]);
});
it.each(["timeout", "cancelled", "disposed", "invalid_service_result"] as const)(
  "rejects a child's nondefinitive %s mutation outcome and preserves uncertainty",
  async (code) => {
    const { operationErrorCodes } = await import("../packages/contracts/src/index.js");
    for (const op of [
      "project.create",
      "project.confirmSetup",
      "conversation.start",
      "conversation.rename",
      "message.append",
    ] as const)
      expect(operationErrorCodes[op]).not.toContain(code);
    let receive: (raw: unknown) => void = () => {};
    const c = createFoundationPort(
      { contextIsolated: true, sandboxed: true },
      {
        listen: (fn) => {
          receive = fn;
          return () => {};
        },
        send: (text) => {
          const request = JSON.parse(text);
          if (request.kind === "request")
            receive(JSON.stringify({ ...request, kind: "result", payload: failure(code) }));
        },
      },
      {
        after: (ms, fn) => {
          const t = setTimeout(fn, ms);
          return () => clearTimeout(t);
        },
      },
      { windowGeneration: "window", serviceGeneration: "service", nextId: () => "nondef-request" },
    );
    try {
      expect(
        await c.port.appendMessage("nondef", { conversationId: entity(1), content: "Synthetic" })
          .result,
      ).toEqual(failure("uncertain"));
    } finally {
      c.dispose();
    }
  },
);

it("revokes admission when revision publication fails after a committed research command", async () => {
  const h = await harness();
  const stream = h.port.subscribeResearch(
    { projectId: h.projectId, conversationId: h.conversationId },
    () => {},
  );
  value(await stream.ready);
  vi.spyOn(h.store, "researchRevisions").mockResolvedValueOnce(failure("storage_failed"));
  value(
    await h.port.appendMessage("publication-failed", {
      conversationId: h.conversationId,
      content: "Synthetic committed message",
    }).result,
  );
  await h.service.drain();
  expect(h.lost).toHaveBeenCalledOnce();
  expect(value(await h.store.readMessages(h.conversationId))[0]?.content).toBe(
    "Synthetic committed message",
  );
  expect(
    h.sent
      .map((text) => JSON.parse(text))
      .filter((row) => row.kind === "result" && row.operationId === "publication-failed"),
  ).toHaveLength(1);
  stream.dispose();
});

it("copies a saved long message through real scoped reads and refuses another conversation", async () => {
  const { copyMessage } = await import("../packages/main/src/message-actions.js");
  const h = await harness();
  const text = "**original** 한🙂\n".repeat(800);
  const parts = splitText(text);
  const descriptor = { parts: parts.length, bytes: utf8Size(text), sha256: digest(text) };
  for (const [index, part] of parts.entries())
    value(
      await h.port.sendTextPart("copy-long", {
        index: index + 1,
        count: parts.length,
        bytes: descriptor.bytes,
        sha256: descriptor.sha256,
        text: part,
      }).result,
    );
  const saved = value(
    await h.port.appendMessage("copy-long", {
      conversationId: h.conversationId,
      content: descriptor,
    }).result,
  );
  const request = vi.fn((operation: string, input: never) =>
    operation === "timeline.read"
      ? h.port.readTimeline(input).result
      : h.port.readTextPart(input).result,
  );
  const service = { request } as unknown as Pick<
    import("../packages/main/src/service-supervisor.js").ServiceSupervisor,
    "request"
  >;
  const clipboard = { writeText: vi.fn(), readText: vi.fn(() => text) };
  expect(await copyMessage(saved.resultId, h.conversationId, service, clipboard, () => true)).toBe(
    true,
  );
  expect(clipboard.writeText).toHaveBeenCalledWith(text);
  expect(request.mock.calls.filter(([operation]) => operation === "text.readPart")).toHaveLength(
    parts.length,
  );
  clipboard.writeText.mockClear();
  const other = value(await h.port.createProject("copy-other-project").result);
  const otherConversation = value(
    await h.port.listConversations({ projectId: other.resultId, cursor: null, count: 50 }).result,
  ).items[0]!.id;
  expect(await copyMessage(saved.resultId, otherConversation, service, clipboard, () => true)).toBe(
    false,
  );
  expect(clipboard.writeText).not.toHaveBeenCalled();
});

it("routes destination reads through the service for existing and new conversations independently of connection state", async () => {
  const h = await harness();
  expect(
    value(
      await h.port.readDestination({ projectId: h.projectId, conversationId: h.conversationId })
        .result,
    ),
  ).toEqual({
    destination: {
      operation: "direct_guidance",
      maxAttemptDurationMs: 600_000,
      connection: "chatgpt",
    },
  });
  const projectId = value(
    await h.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "dev-project",
      payload: {},
    }),
  ).resultId;
  const conversationId = value(await h.store.readConversations(projectId))[0]!.id;
  for (const input of [
    { projectId, conversationId },
    { projectId, agentId: "virgilio" as const },
  ])
    expect(value(await h.port.readDestination(input).result)).toEqual({
      destination: {
        operation: "development_test",
        maxAttemptDurationMs: 600_000,
        connection: "chatgpt",
      },
    });
  expect(await h.port.readDestination({ projectId: h.projectId, conversationId }).result).toEqual(
    failure("record_not_found"),
  );
});
it("rechecks whitespace and Unicode limits in the data service without the composer", async () => {
  const h = await harness();
  await h.service.drain();
  for (const [index, content] of [
    "",
    " \t\n",
    "\u2003",
    "x".repeat(20_001),
    "😀".repeat(20_001),
  ].entries()) {
    expect(
      await h.store.executeResearchCommand({
        command: "message.append",
        operationId: `invalid-append-more-${index}`,
        payload: { conversationId: h.conversationId, content },
      }),
    ).toEqual(failure("message_invalid"));
    expect(
      await h.store.executeResearchCommand({
        command: "conversation.start",
        operationId: `invalid-start-more-${index}`,
        payload: { projectId: h.projectId, content },
      }),
    ).toEqual(failure("message_invalid"));
  }
  expect(value(await h.store.readMessages(h.conversationId))).toHaveLength(0);
});
it("stops every unfinished conversation task with one receipt, preserves messages and never stops later work on replay", async () => {
  const h = await harness();
  const projectId = value(
    await h.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "dev-project-stop",
      payload: {},
    }),
  ).resultId;
  const conversationId = value(await h.store.readConversations(projectId))[0]!.id;
  value(
    await h.port.appendMessage("blocked-message", { conversationId, content: "Kept message" })
      .result,
  );
  const db = h.raw();
  const before = db.prepare("SELECT id FROM tasks ORDER BY created_at").all() as {
    id: Uint8Array;
  }[];
  db.close();
  const stopped = value(
    await h.port.stopConversation("stop-conversation", { conversationId }).result,
  );
  expect(stopped.resultId).toBe(conversationId);
  await h.service.drain();
  expect(value(await h.store.readMessages(conversationId))[0]?.content).toBe("Kept message");
  const inspect = h.raw();
  expect(inspect.prepare("SELECT state FROM tasks").all()).toEqual([{ state: "cancelled" }]);
  expect(
    inspect
      .prepare("SELECT command FROM command_receipts WHERE operation_id='stop-conversation'")
      .get(),
  ).toEqual({ command: "conversation.stop" });
  inspect.close();
  value(
    await h.port.appendMessage("later-message", { conversationId, content: "Next message" }).result,
  );
  expect(
    value(await h.port.stopConversation("stop-conversation", { conversationId }).result),
  ).toEqual(stopped);
  const later = h.raw();
  const waiting = later.prepare("SELECT id FROM tasks WHERE state='blocked'").get() as {
    id: Uint8Array;
  };
  expect(waiting).toBeTruthy();
  later.close();
  const { identifier } = await import("../packages/utility/src/research.js");
  value(await h.port.stopTask("stop-one", { taskId: identifier(waiting.id) }).result);
  expect(await h.port.stopTask("missing-stop", { taskId: entity(99999) }).result).toEqual(
    failure("record_not_found"),
  );
  expect(before).toHaveLength(1);
});

it("carries pause reads, continuation, resume and guarded retry commands through the window port", async () => {
  const h = await harness();
  expect(value(await h.port.readPauses().result)).toEqual({ revision: 1, restart: 0, usage: [] });
  const continued = value(await h.port.continueAllTasks("continue-first").result);
  expect(value(await h.port.continueAllTasks("continue-first").result)).toEqual(continued);
  value(await h.port.continueAllTasks("continue-second-window").result);
  const resumed = value(
    await h.port.resumeUsagePause("resume-first", { connection: "chatgpt" }).result,
  );
  expect(
    value(await h.port.resumeUsagePause("resume-first", { connection: "chatgpt" }).result),
  ).toEqual(resumed);
  value(await h.port.resumeUsagePause("resume-second-window", { connection: "chatgpt" }).result);
  expect(await h.port.tryAgainTask("try-missing", { taskId: entity(999) }).result).toEqual(
    failure("record_not_found"),
  );
  expect(await h.port.startAgainTask("restart-missing", { taskId: entity(999) }).result).toEqual(
    failure("record_not_found"),
  );
});

it("refreshes an empty model catalog on Try again and holds the new task until main reports", async () => {
  const h = await harness();
  const projectId = value(
    await h.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "retry-model-project",
      payload: {},
    }),
  ).resultId;
  const conversation = value(await h.store.readConversations(projectId))[0]!;
  const events: any[] = [];
  value(
    await h.port.subscribeResearch({ projectId, conversationId: conversation.id }, (event) =>
      events.push(event),
    ).ready,
  );
  const report = (
    models: { id: string; name: string }[],
    revision: number,
    refresh_id?: string,
  ) => {
    h.service.receive(
      JSON.stringify({
        kind: "connection_state",
        ...(refresh_id ? { refresh_id } : {}),
        generation: "service",
        snapshot: {
          connection: "chatgpt",
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: revision,
          model_count: models.length,
        },
      }),
    );
    h.service.receive(
      JSON.stringify({
        kind: "connection_models",
        generation: "service",
        page: {
          connection: "chatgpt",
          model_list_revision: revision,
          models,
          nextCursor: models.length,
          hasMore: false,
        },
      }),
    );
  };
  report([], 1);
  value(
    await h.port.appendMessage("empty-model-message", {
      conversationId: conversation.id,
      content: "Synthetic input",
    }).result,
  );
  const timeline = () =>
    h.port.listTimelineBefore({ conversationId: conversation.id, cursor: null, count: 50 }).result;
  const failed = value(await timeline()).items.find((item) => item.kind === "task")!;
  expect(failed).toMatchObject({ state: "failed", outcomeReason: "provider_unavailable" });
  const retried = value(
    await h.port.tryAgainTask("retry-empty-model", { taskId: failed.id }).result,
  );
  expect(
    value(await h.port.tryAgainTask("retry-empty-model", { taskId: failed.id }).result),
  ).toEqual(retried);
  const refresh = h.sent
    .map((text) => JSON.parse(text))
    .find((message) => message.kind === "model_list_refresh");
  expect(refresh).toEqual({
    kind: "model_list_refresh",
    refresh_id: expect.any(String),
    version: 1,
    generation: "service",
    connection: "chatgpt",
  });
  expect(value(await timeline()).items.find((item) => item.id === retried.resultId)).toMatchObject({
    state: "queued",
  });
  // Old in-flight reports cannot acknowledge this specific human-requested refresh.
  report([], 1);
  await h.service.drain();
  expect(value(await timeline()).items.find((item) => item.id === retried.resultId)).toMatchObject({
    state: "queued",
    waitingForModels: true,
  });
  report([{ id: "new-model", name: "New model" }], 2, refresh.refresh_id);
  await h.service.drain();
  expect(value(await timeline()).items.find((item) => item.id === retried.resultId)).toMatchObject({
    state: "running",
  });
  expect(await h.port.tryAgainTask("stale-retry", { taskId: failed.id }).result).toEqual(
    failure("newer_task_exists"),
  );
  await vi.waitFor(() =>
    expect(events.some((event) => event.value?.kind === "destinationChanged")).toBe(true),
  );
});

it("notifies a window with another project when a usage pause holds and stops work", async () => {
  const h = await harness();
  const events: any[] = [];
  value(
    await h.port.subscribeResearch({ projectId: h.projectId, conversationId: null }, (event) =>
      events.push(event),
    ).ready,
  );
  const projectId = value(
    await h.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "cross-project",
      payload: {},
    }),
  ).resultId;
  const conversationId = value(await h.store.readConversations(projectId))[0]!.id;
  h.service.receive(
    JSON.stringify({
      kind: "connection_state",
      generation: "service",
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
  h.service.receive(
    JSON.stringify({
      kind: "connection_models",
      generation: "service",
      page: {
        connection: "chatgpt",
        model_list_revision: 1,
        models: [{ id: "first-model", name: "First model" }],
        nextCursor: 1,
        hasMore: false,
      },
    }),
  );
  value(
    await h.port.appendMessage("cross-first", { conversationId, content: "Synthetic question" })
      .result,
  );
  value(
    await h.port.appendMessage("cross-second", { conversationId, content: "Synthetic follow-up" })
      .result,
  );
  const dispatch = h.sent
    .map((text) => JSON.parse(text))
    .find((message) => message.kind === "provider_dispatch");
  h.service.receive(
    JSON.stringify({
      kind: "provider_event",
      version: 1,
      generation: "service",
      attempt: dispatch.request.attempt,
      event: { type: "started", sequence: 1, provider_request_id: null, model: null },
    }),
  );
  h.service.receive(
    JSON.stringify({
      kind: "provider_event",
      version: 1,
      generation: "service",
      attempt: dispatch.request.attempt,
      event: {
        type: "result",
        sequence: 2,
        result: { status: "failed", reason: "usage_limit_reached", dispatched: true },
      },
    }),
  );
  await h.service.drain();
  expect(value(await h.port.readPauses().result).usage).toEqual([
    { connection: "chatgpt", count: 1 },
  ]);
  await vi.waitFor(() =>
    expect(events.some((event) => event.value?.kind === "pauseCounts")).toBe(true),
  );
  const before = events.filter((event) => event.value?.kind === "pauseCounts").length;
  value(await h.port.stopConversation("cross-stop", { conversationId }).result);
  expect(value(await h.port.readPauses().result).usage).toEqual([
    { connection: "chatgpt", count: 0 },
  ]);
  await vi.waitFor(() =>
    expect(events.filter((event) => event.value?.kind === "pauseCounts").length).toBeGreaterThan(
      before,
    ),
  );
  expect(events.some((event) => event.value?.record === "timeline")).toBe(false);
});

it("projects conversation activity and the saturated general or connection limit independently of loaded history", async () => {
  const h = await harness();
  h.service.receive(
    JSON.stringify({
      kind: "connection_state",
      generation: "service",
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
  h.service.receive(
    JSON.stringify({
      kind: "connection_models",
      generation: "service",
      page: {
        connection: "chatgpt",
        model_list_revision: 1,
        models: [{ id: "model", name: "Model" }],
        nextCursor: 1,
        hasMore: false,
      },
    }),
  );
  const conversations = [];
  for (let n = 0; n < 4; n++) {
    await h.service.drain();
    const project = value(
      await h.store.executeResearchCommand({
        command: "development.createProject",
        operationId: `capacity-project-${n}`,
        payload: {},
      }),
    ).resultId;
    const conversation = value(await h.store.readConversations(project))[0]!;
    conversations.push({ project, conversation });
    value(
      await h.port.appendMessage(`capacity-message-${n}`, {
        conversationId: conversation.id,
        content: "Synthetic capacity input",
      }).result,
    );
  }
  const last = conversations[3]!;
  const queued = () =>
    h.port.listTimelineBefore({ conversationId: last.conversation.id, cursor: null, count: 50 })
      .result;
  expect(value(await queued()).items.find((item) => item.kind === "task")).toMatchObject({
    state: "queued",
    waitingLimit: 3,
  });
  const first = conversations[0]!;
  expect(
    value(
      await h.port.readConversations({ projectId: first.project, ids: [first.conversation.id] })
        .result,
    ).items[0]?.runningTask,
  ).toMatchObject({ state: "running", agentId: "virgilio" });
  value(
    await h.port.replaceExecutionLimits({ operationId: "capacity-limit-one", value: 1 }, "service")
      .result,
  );
  expect(value(await queued()).items.find((item) => item.kind === "task")).toMatchObject({
    state: "queued",
    waitingLimit: 1,
  });
});

it("reads proposal-only reply positions and publishes each decision revision through the public port", async () => {
  const h = await harness();
  const project = value(await h.port.createProject("proposal-project").result).resultId;
  await h.service.drain();
  const conversation = value(await h.store.readConversations(project))[0]!.id;
  const first = await proposeSetup(h.store, h.raw, project, {
    title: "First",
    document_language: "en",
  });
  await h.service.drain();
  const page = value(
    await h.port.listTimelineBefore({ conversationId: conversation, cursor: null, count: 50 })
      .result,
  );
  const proposal = page.items.find((item) => item.id === first)!;
  expect(proposal).toMatchObject({
    kind: "setupProposal",
    rank: 2,
    revision: 1,
    title: "First",
    documentLanguage: "en",
    state: "proposed",
  });
  const tasks = page.items.filter((item) => item.kind === "task");
  expect(proposal.position).toBe(tasks[0]!.position);
  const notices: Outcome<ResearchEvent>[] = [];
  const subscription = h.port.subscribeResearch(
    { projectId: project, conversationId: conversation },
    (notice) => notices.push(notice),
  );
  value(await subscription.ready);
  await h.service.drain();
  const second = await proposeSetup(h.store, h.raw, project, {
    title: "😀".repeat(1500),
    document_language: "en",
  });
  await h.service.drain();
  const invalid = value(
    await h.port.readTimeline({ conversationId: conversation, ids: [second] }).result,
  ).items[0]!;
  expect(invalid).toMatchObject({
    kind: "setupProposal",
    state: "invalid",
    invalidReason: "title_too_long",
    revision: 1,
  });
  if (invalid.kind !== "setupProposal" || typeof invalid.title === "string")
    throw new Error("Expected bounded proposal text.");
  expect(
    value(await h.port.readTextPart({ source: invalid.title.source, index: 1 }).result).text.length,
  ).toBeGreaterThan(0);
  expect(
    await h.port.rejectProjectSetup("answered-proposal", { proposalId: first }).result,
  ).toMatchObject({ error: { code: "proposal_not_waiting" } });
  await h.service.drain();
  const fresh = await proposeSetup(h.store, h.raw, project, {
    title: "Updated title",
    document_language: "en",
  });
  await h.service.drain();
  expect(
    value(await h.port.readTimeline({ conversationId: conversation, ids: [first] }).result)
      .items[0],
  ).toMatchObject({ state: "replaced", revision: 2 });
  value(await h.port.rejectProjectSetup("reject-proposal", { proposalId: fresh }).result);
  await h.service.drain();
  expect(
    value(await h.port.readTimeline({ conversationId: conversation, ids: [fresh] }).result)
      .items[0],
  ).toMatchObject({ state: "rejected", revision: 2 });
  await vi.waitFor(
    () =>
      expect(notices).toEqual(
        expect.arrayContaining([
          { ok: true, value: { kind: "changed", record: "timeline", id: first, revision: 2 } },
          { ok: true, value: { kind: "changed", record: "timeline", id: fresh, revision: 2 } },
        ]),
      ),
    { timeout: 3000 },
  );
  expect(
    await h.port.confirmProjectSetup("stale-proposal", { proposalId: first }).result,
  ).toMatchObject({ error: { code: "proposal_not_waiting" } });
  const finishedReply = {
    ok: true,
    value: {
      kind: "replyFinished",
      projectId: project,
      conversationId: conversation,
      agentId: "virgilio",
    },
  };
  expect(notices.filter((notice) => notice.ok && notice.value.kind === "replyFinished")).toEqual([
    finishedReply,
    finishedReply,
  ]);
  subscription.dispose();
});

it("carries project opening and tuple-cursor batches through the actual window port without losing equal-time rows", async () => {
  const h = await harness();
  for (let index = 0; index < 94; index++)
    value(await h.port.createProject(`selector-${String(index)}`).result);
  const db = h.raw();
  db.prepare(
    "UPDATE projects SET title=?,document_language='ko',setup_confirmed_at=created_at,last_opened_at='2026-11-17T00:00:00.000Z'",
  ).run("한".repeat(200));
  db.close();
  let fragmented = false;
  let cursor: import("@ohtia/contracts").ProjectCursor | null = null;
  const ids: string[] = [];
  const sizes: number[] = [];
  do {
    const batch: import("@ohtia/contracts").ProjectRecord[] = [];
    do {
      const requested = 40 - batch.length;
      const page = value(await h.port.listProjects({ cursor, count: requested }).result);
      if (page.hasMore && page.items.length < requested) fragmented = true;
      batch.push(...page.items);
      cursor = page.next;
    } while (cursor && batch.length < 40);
    sizes.push(batch.length);
    ids.push(...batch.map((row) => row.id));
  } while (cursor);
  expect(sizes).toEqual([40, 40, 15]);
  expect(new Set(ids).size).toBe(95);
  expect(fragmented).toBe(true);
  const selector = new ProjectController(h.port, () => {});
  await selector.load();
  expect(selector.snapshot().items.map((row) => row.id)).toEqual(ids.slice(0, 40));
  await selector.load(true);
  expect(selector.snapshot().items.map((row) => row.id)).toEqual(ids.slice(0, 80));
  await selector.load(true);
  expect(selector.snapshot().items.map((row) => row.id)).toEqual(ids);
  expect(selector.snapshot().next).toBeNull();
  selector.dispose();
  const events: DiagnosticEvent[] = [];
  Object.assign(h.options, { emitDiagnostic: (event: DiagnosticEvent) => events.push(event) });
  const target = ids.at(-1)!;
  expect(
    value(await h.port.openProject("selector-open", { projectId: target }).result).resultId,
  ).toBe(target);
  expect(events.map((event) => event.event_name)).toEqual(["ohtia.project.opened"]);
  expect(events[0]).toEqual({ event_name: "ohtia.project.opened" });
  const first = value(await h.port.listProjects({ cursor: null, count: 1 }).result);
  expect(first.items[0]?.id).toBe(target);
  const missing = entity(99999);
  const rejected = await h.port.openProject("selector-missing", { projectId: missing }).result;
  expect(rejected).toEqual(failure("record_not_found"));
  expect(await h.port.openProject("selector-missing", { projectId: missing }).result).toEqual(
    rejected,
  );
});

it("uses a stable conversation cursor and returns bounded, unparsed Unicode prefixes", async () => {
  const h = await harness();
  const time = "2026-11-17T10:00:00.000Z";
  const latestAt = "2026-11-17T11:00:00.000Z";
  const bytes = (id: string) => Buffer.from(id.replaceAll("-", ""), "hex");
  const prefix = "**" + "😀".repeat(1022);
  const db = h.raw();
  try {
    const add = db.prepare(
      "INSERT INTO conversations (id,project_id,title,created_at,updated_at,revision) VALUES (?,?,NULL,?,?,1)",
    );
    for (let n = 1; n <= 110; n++) add.run(bytes(entity(n)), bytes(h.projectId), time, time);
    db.prepare(
      "INSERT INTO messages (id,conversation_id,position,author_kind,content,created_at) VALUES (?,?,1,'researcher',?,?)",
    ).run(bytes(entity(900)), bytes(entity(5)), prefix + "😀", latestAt);
  } finally {
    db.close();
  }
  async function page(
    cursor: ConversationCursor | null,
  ): Promise<ResearchOutputs["conversation.list"]> {
    const items = [];
    do {
      const fragment = value(
        await h.port.listConversations({ projectId: h.projectId, cursor, count: 50 - items.length })
          .result,
      );
      items.push(...fragment.items);
      cursor = fragment.next;
    } while (cursor && items.length < 50);
    return { items, next: cursor, hasMore: !!cursor };
  }
  const first = await page(null);
  expect(first.items).toHaveLength(50);
  expect(first.items.find((row) => row.id === entity(5))).toMatchObject({
    latestAt,
    latestPrefix: prefix,
    latestTruncated: true,
    latestLanguage: null,
  });
  const oldCursor = first.next!;
  const mutation = h.raw();
  try {
    mutation
      .prepare(
        "INSERT INTO messages (id,conversation_id,position,author_kind,content,created_at) VALUES (?,?,1,'researcher',?,?)",
      )
      .run(bytes(entity(901)), bytes(oldCursor.id), "Cursor moved", "2026-11-17T12:00:00.000Z");
  } finally {
    mutation.close();
  }
  const second = await page(oldCursor);
  const third = await page(second.next);
  expect(second.items).toHaveLength(50);
  expect(third.items).toHaveLength(11);
  expect(third.next).toBeNull();
  expect(new Set([...first.items, ...second.items, ...third.items].map((row) => row.id)).size).toBe(
    111,
  );
  const reread = value(
    await h.port.readConversations({
      projectId: h.projectId,
      ids: [oldCursor.id, entity(5)],
    }).result,
  );
  expect(reread.items[0]).toMatchObject({ id: oldCursor.id, latestPrefix: "Cursor moved" });
  expect(reread.items[1]?.latestPrefix).toBe(prefix);
});

it("starts a conversation atomically and replays its confirmed receipt with the same identifier", async () => {
  const h = await harness();
  const before = value(await h.store.readConversations(h.projectId));
  const input = { projectId: h.projectId, content: "**First question**" };
  expect(await h.port.startConversation("empty-start", { ...input, content: " " }).result).toEqual(
    failure("message_invalid"),
  );
  await h.service.drain();
  expect(value(await h.store.readConversations(h.projectId))).toEqual(before);
  const saved = value(await h.port.startConversation("start-conversation", input).result);
  expect(value(await h.port.startConversation("start-conversation", input).result)).toEqual(saved);
  await h.service.drain();
  expect(value(await h.store.readConversations(h.projectId))).toHaveLength(before.length + 1);
  expect(value(await h.store.readMessages(saved.resultId))).toMatchObject([
    { position: 1, content: input.content },
  ]);
  expect(
    value(
      await h.port.readConversations({
        projectId: h.projectId,
        ids: [saved.resultId],
      }).result,
    ).items[0],
  ).toMatchObject({ latestPrefix: input.content, status: "waiting" });
});

it("uses the selected agent for destination reads, atomic starts and both history reads", async () => {
  const h = await harness();
  const projectId = h.projectId;
  const read = async (
    input: { agentId: "virgilio" | "josefa" | "jorge-luis" } | { conversationId: string },
  ) => value(await h.port.readDestination({ projectId, ...input }).result).destination;
  expect(await read({ agentId: "virgilio" })).toMatchObject({ operation: "direct_guidance" });
  expect(await read({ agentId: "josefa" })).toMatchObject({
    operation: "search_strategy_planning",
  });
  expect(await read({ agentId: "jorge-luis" })).toBeNull();

  const db = h.raw();
  try {
    const inventory = db.prepare(
      "SELECT (SELECT count(*) FROM conversations) AS conversations, (SELECT count(*) FROM messages) AS messages, (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM command_receipts) AS receipts",
    );
    const before = inventory.get();
    for (const agentId of ["jorge-luis", "erasmus", "boris", "maria"] as const) {
      expect(
        await h.port.startConversation("agent-unavailable", {
          projectId,
          agentId,
          content: "Plan a search",
        }).result,
      ).toEqual(failure("agent_unavailable"));
    }
    expect(inventory.get()).toEqual(before);

    const input = { projectId, agentId: "josefa", content: "Plan a search" } as const;
    const { resultId: conversationId } = value(
      await h.port.startConversation("agent-start", input).result,
    );
    expect(value(await h.port.startConversation("agent-start", input).result).resultId).toBe(
      conversationId,
    );
    expect(
      await h.port.startConversation("agent-start", { ...input, agentId: "virgilio" }).result,
    ).toEqual(failure("operation_conflict"));
    expect(await read({ conversationId })).toMatchObject({ operation: "search_strategy_planning" });
    const rows = value(
      await h.port.listConversations({ projectId, cursor: null, count: 50 }).result,
    ).items;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: h.conversationId, agentId: "virgilio" }),
        expect.objectContaining({ id: conversationId, agentId: "josefa" }),
      ]),
    );
    const summary = value(
      await h.port.readConversations({ projectId, ids: [conversationId] }).result,
    ).items[0];
    expect(summary).toMatchObject({ id: conversationId, agentId: "josefa" });
    value(
      await h.port.appendMessage("agent-append", {
        conversationId,
        content: "Include alternate terms",
      }).result,
    );
    expect(
      db
        .prepare("SELECT DISTINCT operation FROM tasks WHERE conversation_id=?")
        .pluck()
        .all(Buffer.from(conversationId.replaceAll("-", ""), "hex")),
    ).toEqual(["search_strategy_planning"]);
  } finally {
    db.close();
  }
});

it("transfers 300 selected positions as staged text through preload and the data service", async () => {
  const f = await harness();
  const started = value(
    await f.port.startConversation("specialist", {
      projectId: f.projectId,
      agentId: "josefa",
      content: "First message",
    }).result,
  );
  const conversationId = started.resultId;
  const db = f.raw();
  const positions = Array.from({ length: 300 }, (_, index) => 1_000_000_000_000_000 + index);
  try {
    const stopped = await f.port.stopConversation("no-dispatch", { conversationId }).result;
    expect(stopped.ok).toBe(true);
    const insert = db.prepare(
      "INSERT INTO messages(id,conversation_id,position,author_kind,content,created_at) VALUES(?,?,?,'researcher','Synthetic selection',?)",
    );
    db.transaction(() => {
      for (const position of positions)
        insert.run(newId(), bytes(conversationId), position, "2026-11-20T16:00:00.000Z");
    })();
  } finally {
    db.close();
  }
  const input = positions.join(",");
  expect(utf8Size(input)).toBeGreaterThan(4096);
  const send = (selection: Parameters<typeof f.port.returnHandoff>[1]["selection"]) =>
    f.port.returnHandoff("staged-selection", {
      conversationId,
      expectedOwnerRevision: 1,
      selection,
    });
  const returned = value(await stagedCommand(f.port, "staged-selection", input, send));
  const parts = splitText(input);
  expect(
    value(
      await send({ parts: parts.length, bytes: utf8Size(input), sha256: digest(input) }).result,
    ),
  ).toEqual(returned);
  const saved = f.raw();
  try {
    expect(saved.prepare("SELECT count(*) FROM handoff_selected_messages").pluck().get()).toBe(300);
  } finally {
    saved.close();
  }
});

it("counts finished fake-provider replies per conversation through the research port", async () => {
  const h = await harness();
  const scope = { projectId: h.projectId, conversationId: null };
  const activity = new ActivityController(h.port);
  activity.open(scope);
  controls.push(() => activity.dispose());
  const subscription = h.port.subscribeResearch(scope, (event) => {
    if (event.ok) activity.event(event.value);
  });
  controls.push(() => subscription.dispose());
  value(await subscription.ready);
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
    { state: () => "connected", send: (_generation, text) => h.service.receive(text) },
  );
  controls.push(() => dispatch.dispose());
  dispatch.begin("service");
  const send = (message: object) =>
    h.service.receive(JSON.stringify({ generation: "service", ...message }));
  send({
    kind: "connection_state",
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
  send({
    kind: "connection_models",
    page: {
      connection: "chatgpt",
      model_list_revision: 1,
      models: [{ id: "model", name: "Model" }],
      nextCursor: 1,
      hasMore: false,
    },
  });
  let dispatched = 0;
  const finishReply = async () => {
    await h.service.drain();
    const requests = h.sent.flatMap((text) => decodeProviderDispatch(text, "service") ?? []);
    expect(requests).toHaveLength(++dispatched);
    await dispatch.receive(requests.at(-1)!);
    await dispatch.drain();
    await h.service.drain();
  };

  const other = value(
    await h.port.startConversation("unread-other", {
      projectId: h.projectId,
      content: "Synthetic first question.",
    }).result,
  ).resultId;
  await finishReply();
  for (const [id, operation] of [
    [h.conversationId, "unread-original"],
    [other, "unread-other-again"],
  ]) {
    value(
      await h.port.appendMessage(operation!, {
        conversationId: id!,
        content: "Synthetic follow-up.",
      }).result,
    );
    await finishReply();
  }
  await vi.waitFor(() =>
    expect(activity.snapshot().unreadReplies).toEqual(
      new Map([
        [other, 2],
        [h.conversationId, 1],
      ]),
    ),
  );
  expect(activity.snapshot().history.replies).toBe(2);
  activity.open({ ...scope, conversationId: other });
  activity.presentation(true, true);
  expect(activity.snapshot().unreadReplies).toEqual(new Map([[h.conversationId, 1]]));
  expect(activity.snapshot().history.replies).toBe(1);
});

it("publishes durable project attention across windows and keeps finished replies scoped", async () => {
  const h = await harness();
  const send = (message: object) =>
    h.service.receive(JSON.stringify({ generation: "service", ...message }));
  send({
    kind: "connection_state",
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
  send({
    kind: "connection_models",
    page: {
      connection: "chatgpt",
      model_list_revision: 1,
      models: [{ id: "model", name: "Model" }],
      nextCursor: 1,
      hasMore: false,
    },
  });
  const projectId = value(
    await h.store.executeResearchCommand({
      command: "development.createProject",
      operationId: "attention-project",
      payload: {},
    }),
  ).resultId;
  const conversationId = value(await h.store.readConversations(projectId))[0]!.id;
  const activity: Outcome<ResearchEvent>[][] = [[], [], []];
  const scopes = [projectId, h.projectId, null] as const;
  const ports = [h.port, h.openWindow("other-project").port, h.openWindow("no-project").port];
  for (const [index, port] of ports.entries())
    value(
      await port.subscribeResearch(
        { projectId: scopes[index] ?? null, conversationId: index === 0 ? conversationId : null },
        (event) => {
          activity[index]?.push(event);
        },
      ).ready,
    );
  expect(value(await h.port.listProjectAttention({ cursor: null, count: 1 }).result)).toEqual({
    items: [],
    next: null,
    hasMore: false,
    revision: 1,
  });
  const question = async (operation: string) => {
    value(
      await h.port.appendMessage(operation, { conversationId, content: "Synthetic question" })
        .result,
    );
    await h.service.drain();
    return h.sent
      .map((text) => JSON.parse(text))
      .filter((message) => message.kind === "provider_dispatch")
      .at(-1).request.attempt;
  };
  const attempt = await question("attention-failed");
  const provider = (attempt: string, event: ProviderEvent) =>
    send({ kind: "provider_event", version: 1, attempt, event });
  provider(attempt, { type: "started", sequence: 1, provider_request_id: null, model: null });
  provider(attempt, { type: "text", sequence: 2, text: "Synthetic partial reply" });
  provider(attempt, {
    type: "result",
    sequence: 3,
    result: { status: "failed", reason: "provider_unavailable", dispatched: true },
  });
  await h.service.drain();

  const ids = async () =>
    value(await h.port.listProjectAttention({ cursor: null, count: 1 }).result);
  expect(await ids()).toEqual({ items: [projectId], next: null, hasMore: false, revision: 2 });
  expect(
    value(await h.port.listProjectAttention({ cursor: projectId, count: 1 }).result).items,
  ).toEqual([]);
  const conversation = async () =>
    value(await h.port.readConversations({ projectId, ids: [conversationId] }).result).items[0];
  const project = async () =>
    value(await h.port.listProjects({ cursor: null, count: 1 }).result).items[0];
  expect(await conversation()).toMatchObject({ status: "attention" });
  expect(await project()).toMatchObject({ id: projectId, needsAttention: true });
  await vi.waitFor(() => {
    for (const events of activity)
      expect(events).toContainEqual({ ok: true, value: { kind: "projectAttention", revision: 2 } });
  });
  const failed = value(
    await h.port.listTimelineBefore({ conversationId, cursor: null, count: 50 }).result,
  ).items.find((item) => item.kind === "task" && item.state === "failed");
  expect(failed).toBeDefined();
  expect(activity[0]).toContainEqual({
    ok: true,
    value: {
      kind: "attentionRaised",
      source: "conversation",
      task: { id: failed!.id, revision: failed!.revision },
    },
  });
  for (const events of activity.slice(1)) {
    expect(events).toContainEqual({
      ok: true,
      value: { kind: "attentionRaised", source: "conversation" },
    });
  }
  expect(activity[0]).toContainEqual({
    ok: true,
    value: { kind: "replyFinished", projectId, conversationId, agentId: "virgilio" },
  });
  for (const events of activity.slice(1))
    expect(
      events.some(
        (event) =>
          event.ok &&
          (event.value.kind === "replyFinished" ||
            (event.value.kind === "changed" &&
              event.value.record === "project" &&
              event.value.id === projectId)),
      ),
    ).toBe(false);

  const replacement = await question("attention-resolution");
  await h.service.drain();
  expect(await ids()).toEqual({ items: [], next: null, hasMore: false, revision: 3 });
  expect(await conversation()).toMatchObject({ status: "replying" });
  await vi.waitFor(() => {
    for (const events of activity)
      expect(events).toContainEqual({ ok: true, value: { kind: "projectAttention", revision: 3 } });
  });

  provider(replacement, { type: "started", sequence: 1, provider_request_id: null, model: null });
  provider(replacement, {
    type: "result",
    sequence: 2,
    result: { status: "failed", reason: "provider_unavailable", dispatched: true },
  });
  await h.service.drain();
  expect((await ids()).revision).toBe(4);
  h.service.dispose();
  await h.store.close();
  await h.store.open();
  expect(
    await h.store.readResearch({
      protocol: 1,
      kind: "request",
      policy: policyId,
      windowGeneration: "window",
      serviceGeneration: "service",
      requestId: "restart-attention",
      operationId: "restart-attention",
      operation: "projectAttention.list",
      payload: { cursor: null, count: 1 },
    }),
  ).toEqual({ ok: true, value: { items: [projectId], next: null, hasMore: false, revision: 1 } });
});

it(diagnosticCases.shared_cases[0]!, async () => {
  const h = await harness();
  const writer = new DiagnosticWriter({
    root: h.root,
    version: "0.0.0",
    threshold: "DEBUG",
    assertAdmission: () => {},
  });
  controls.push(() => {
    void writer.close();
  });
  const diag = (event: DiagnosticEvent) => {
    void writer.append(event);
  };
  Object.assign(h.options, { emitDiagnostic: diag });
  const markers = {
    credential: "MARK236_CREDENTIAL_SYNTHETIC",
    privateProject: "MARK236_OTHER_PROJECT",
    firstMessage: "MARK236_RESEARCH_MESSAGE",
    title: "MARK236_TITLE",
    memory: "MARK236_MEMORY_VERSION",
    handoff: "MARK236_HANDOFF_NOTE",
    selected: "MARK236_SELECTED_REPLY",
    hidden: "MARK236_UNSELECTED_JOSEFA_INPUT",
    failure: "MARK236_PROVIDER_PRIVATE_ERROR",
    tool: "MARK236_AGENT_MEMORY_TOOL",
  };
  const outputs: string[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    vi.spyOn(stream, "write").mockImplementation(((
      chunk: Uint8Array | string,
      ...args: unknown[]
    ) => {
      outputs.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return Reflect.apply(write, stream, [chunk, ...args]);
    }) as typeof stream.write);
  }
  const captured = new Map<string, ProviderRequestData>();
  let late: ((report: LateUsageReport) => Promise<LateUsageDecision>) | undefined;
  let planned:
    | "complete"
    | "memory"
    | "handoff"
    | "josefa"
    | "throw"
    | "empty"
    | Extract<ProviderResult, { status: "failed"; dispatched: true }> = "complete";
  const fake = createFakeProvider({
    kind: "api_key",
    connect: async () => ({
      state: "connected",
      session: { credential: markers.credential + "-reconnected", reason: null },
    }),
    send: async (request, control) => {
      if (!control.release()) throw new Error("Synthetic request was never dispatched.");
      captured.set(request.attempt, request);
      late = control.reportLateUsage;
      control.emit({ type: "started", provider_request_id: null, model: "synthetic-model" });
      if (planned === "throw") throw new Error(markers.failure);
      if (typeof planned === "object" || planned === "empty") {
        if (planned !== "empty") control.emit({ type: "text", text: "Synthetic partial reply." });
        control.emit({
          type: "usage",
          usage: {
            input_tokens: 11,
            cached_input_tokens: null,
            output_tokens: 3,
            reasoning_tokens: null,
          },
        });
        control.emit({
          type: "result",
          result: planned === "empty" ? { status: "completed" } : planned,
        });
        return;
      }
      if (planned === "memory") {
        control.emit({
          type: "tool_call",
          namespace: "ohtia",
          name: "update_memory",
          arguments: JSON.stringify({
            changes: [
              { action: "add", entries: [], kind: "note", text: markers.tool, sources: [] },
            ],
          }),
        });
      }
      if (planned === "handoff") {
        control.emit({
          type: "tool_call",
          namespace: "ohtia",
          name: "propose_handoff",
          arguments: JSON.stringify({
            agent: "josefa",
            note: markers.handoff,
            reason: "Examine wider scope.",
          }),
        });
      }
      control.emit({
        type: "text",
        text: planned === "josefa" ? markers.selected : "Synthetic reply.",
      });
      control.emit({ type: "result", result: { status: "completed" } });
    },
  });
  await fake.credentials.write({ credential: markers.credential, reason: null });
  const initialFingerprint = fake.accountFingerprint?.();
  const adapter = {
    ...fake,
    declaration: {
      ...fake.declaration,
      connection: { ...fake.declaration.connection, id: "chatgpt" },
    },
  };
  const manager = new ConnectionManager([adapter], diag);
  controls.push(() => manager.dispose());
  let readChild!: (text: unknown) => void;
  const supervisor = new ServiceSupervisor(
    {
      send: (text) => h.service.receive(text),
      kill: () => {},
      messages: (read) => {
        readChild = read;
      },
      exited: () => {},
    },
    "service",
    () => {},
  );
  readChild(JSON.stringify({ kind: "ready", generation: "service" }));
  await manager.read("chatgpt");
  expect(manager.storeModels("chatgpt", [{ id: "synthetic-model", name: "Synthetic model" }])).toBe(
    true,
  );
  const account = () => expect(supervisor.reportConnections(manager)).toBe(true);
  const dispatch = new ProviderDispatch([adapter], {
    state: (id) => manager.snapshot(id)?.state,
    send: (_generation, text) => h.service.receive(text),
    diagnostic: diag,
  });
  controls.push(() => dispatch.dispose());
  dispatch.begin("service");
  account();
  let attempts = 0;
  async function finish(phase: typeof planned = "complete") {
    planned = phase;
    await h.service.drain();
    const dispatches = h.sent.flatMap((text) => decodeProviderDispatch(text, "service") ?? []);
    expect(dispatches).toHaveLength(++attempts);
    await dispatch.receive(dispatches.at(-1)!);
    await h.service.drain();
    return dispatches.at(-1)!.request.attempt;
  }
  async function timeline(conversationId = h.conversationId) {
    return value(
      await h.port.listTimelineBefore({ conversationId, cursor: null, count: 50 }).result,
    ).items;
  }
  const otherProject = value(await h.port.createProject("other-project").result).resultId;
  const db = h.raw();
  try {
    db.prepare(
      "UPDATE projects SET title=?,document_language='en',setup_confirmed_at=created_at WHERE id=?",
    ).run("Other project", bytes(otherProject));
  } finally {
    db.close();
  }
  const other = value(
    await h.port.startConversation("other-conversation", {
      projectId: otherProject,
      content: markers.privateProject,
    }).result,
  ).resultId;
  await finish();
  const firstMessage = value(
    await h.port.appendMessage("first-marker", {
      conversationId: h.conversationId,
      content: markers.firstMessage,
    }).result,
  ).resultId;
  const firstAttempt = await finish("memory");
  const firstMessageTask = (await timeline()).find((item) => item.kind === "task")!;
  const input = { projectId: h.projectId, taskId: firstMessageTask.id };
  expect(value(await h.port.readReplyDetails(input).result)).toMatchObject({
    account: "same",
    connectionKind: "api_key",
    usage: "unreported",
    observedModel: "Synthetic model",
    instructionVersion: 6,
  });
  expect(await h.port.readReplyDetails({ ...input, projectId: otherProject }).result).toEqual(
    failure("record_not_found"),
  );
  const lateReport = {
    revision: 1,
    estimated: false,
    usage: {
      input_tokens: 37,
      cached_input_tokens: null,
      output_tokens: 5,
      reasoning_tokens: null,
    },
  };
  expect(late).toBeTypeOf("function");
  const settle = async (report = lateReport) => {
    const decision = late?.(report);
    await h.service.drain();
    const receipt = h.sent
      .map((text) => decodeLateUsageReceipt(text, "service"))
      .filter(Boolean)
      .at(-1);
    expect(receipt).toBeDefined();
    if (receipt) dispatch.usageReceipt(receipt);
    return decision;
  };
  const receipt = await settle();
  expect(receipt).toMatchObject({ accepted: true });
  expect(await settle()).toEqual(receipt);
  expect(value(await h.port.readReplyDetails(input).result)).toMatchObject({
    tokens: lateReport.usage,
    usage: "late",
  });
  await fake.credentials.write({ credential: markers.credential + "2", reason: null });
  expect(fake.accountFingerprint?.()).not.toBe(initialFingerprint);
  await manager.read("chatgpt");
  account();
  expect(value(await h.port.readReplyDetails(input).result).account).toBe("different");
  await manager.disconnect("chatgpt");
  account();
  expect(value(await h.port.readReplyDetails(input).result).account).toBe("disconnected");
  manager.connect("chatgpt");
  await vi.waitFor(() => expect(manager.snapshot("chatgpt")?.state).toBe("connected"));
  manager.storeModels("chatgpt", [{ id: "synthetic-model", name: "Synthetic model" }]);
  account();

  const memoryId = value(
    await h.port.addMemory("marker-memory", {
      projectId: h.projectId,
      sourceMessageId: firstMessage,
      kind: "decision",
      text: markers.memory,
    }).result,
  ).resultId;
  expect(
    await h.port.editMemory("stale-marker-edit", {
      entryId: memoryId,
      expectedVersion: 2,
      kind: "decision",
      text: "Stale change",
    }).result,
  ).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  const source = value(
    await h.port.readConversations({ ids: [h.conversationId], projectId: h.projectId }).result,
  ).items[0]!;
  value(
    await h.port.renameConversation("marker-title", {
      conversationId: h.conversationId,
      title: markers.title,
      expectedUpdatedAt: source.updatedAt,
    }).result,
  );

  const newConversation = value(
    await h.port.startConversation("marker-new-conversation", {
      projectId: h.projectId,
      content: "Independent conversation in this project.",
    }).result,
  ).resultId;
  await finish();
  await h.port.appendMessage("request-handoff", {
    conversationId: h.conversationId,
    content: "Delegate the search.",
  }).result;
  await finish("handoff");
  const proposal = (await timeline()).find((item) => item.kind === "handoffProposal")!;
  expect(proposal).toMatchObject({ state: "proposed" });
  expect(
    value(
      await h.port.readConversations({ ids: [h.conversationId], projectId: h.projectId }).result,
    ).items[0]?.agentId,
  ).toBe("virgilio");
  value(
    await h.port.acceptHandoff("accept-marker-handoff", {
      proposalId: proposal.id,
      expectedOwnerRevision: 1,
    }).result,
  );
  value(
    await h.port.appendMessage("josefa-marker", {
      conversationId: h.conversationId,
      content: markers.hidden,
    }).result,
  );
  await finish("josefa");
  const josefaItems = await timeline();
  const selected = josefaItems.find(
    (item) => item.kind === "message" && item.content === markers.selected,
  )!;
  const hidden = josefaItems.find(
    (item) => item.kind === "message" && item.content === markers.hidden,
  )!;
  value(
    await h.port.returnHandoff("marker-return", {
      conversationId: h.conversationId,
      expectedOwnerRevision: 2,
      selection: String(selected.position),
    }).result,
  );
  value(
    await h.port.appendMessage("after-return-marker", {
      conversationId: h.conversationId,
      content: "Review Josefa’s selection.",
    }).result,
  );
  await finish();
  value(
    await h.port.appendMessage("other-marker-again", {
      conversationId: other,
      content: "Search on a separate project.",
    }).result,
  );
  await finish();
  value(
    await h.port.appendMessage("provider-failure-marker", {
      conversationId: newConversation,
      content: "Run through a marked provider failure.",
    }).result,
  );
  await finish({ status: "failed", dispatched: true, reason: "provider_error" });
  const cut = (await timeline(newConversation)).find(
    (item) => item.kind === "task" && item.state === "failed",
  )!;
  expect(
    value(await h.port.readReplyDetails({ projectId: h.projectId, taskId: cut.id }).result).usage,
  ).toBe("incomplete");
  expect(await settle({ ...lateReport, revision: 2 })).toMatchObject({ accepted: true });
  expect(
    value(await h.port.readReplyDetails({ projectId: h.projectId, taskId: cut.id }).result).usage,
  ).toBe("incomplete");
  value(await h.port.listProjectAttention({ cursor: null, count: 10 }).result);
  value(
    await h.port.appendMessage("provider-thrown-marker", {
      conversationId: newConversation,
      content: "Run through an adapter failure.",
    }).result,
  );
  await finish("throw");
  value(
    await h.port.appendMessage("marked-empty", {
      conversationId: h.conversationId,
      content: "Complete a stream without message text.",
    }).result,
  );
  await finish("empty");
  const empty = (await timeline()).find(
    (item) => item.kind === "task" && item.outcomeReason === "empty_reply",
  )!;
  expect(
    value(await h.port.readReplyDetails({ projectId: h.projectId, taskId: empty.id }).result).usage,
  ).toBe("reported");
  for (const reason of [
    "not_eligible",
    "connection_expired",
    "request_rejected",
    "usage_limit_reached",
  ] as const) {
    value(
      await h.port.appendMessage(`marked-${reason}`, {
        conversationId: h.conversationId,
        content: "Stream a reply ending in a provider error.",
      }).result,
    );
    await finish({ status: "failed", dispatched: true, reason });
    const cut = (await timeline()).find(
      (item) => item.kind === "task" && item.outcomeReason === reason,
    )!;
    expect(
      value(await h.port.readReplyDetails({ projectId: h.projectId, taskId: cut.id }).result).usage,
    ).toBe("incomplete");
  }
  expect(h.lost).not.toHaveBeenCalled();

  const raw = h.raw();
  try {
    const rows = raw
      .prepare("SELECT id FROM messages WHERE content=?")
      .get(markers.privateProject) as { id: Uint8Array };
    const otherMessage = identifier(rows.id);
    const version = raw
      .prepare("SELECT id FROM memory_entry_versions WHERE entry_id=? AND number=1")
      .get(bytes(memoryId)) as { id: Uint8Array };
    const versionId = identifier(version.id);
    const toolVersion = raw
      .prepare("SELECT id FROM memory_entry_versions WHERE text=?")
      .get(markers.tool) as { id: Uint8Array };
    const toolVersionId = identifier(toolVersion.id);
    const manifests = raw.prepare("SELECT id,transfer_manifest FROM attempts").all() as {
      id: Uint8Array;
      transfer_manifest: string;
    }[];
    for (const row of manifests) {
      const attemptId = identifier(row.id);
      const request = captured.get(attemptId)!;
      const wire = responsesBody(request);
      for (const field of forbiddenResponseFields) expect(wire).not.toHaveProperty(field);
      expect(wire).toMatchObject({ store: false });
      const records = JSON.parse(row.transfer_manifest) as TransferEntry[];
      const content = JSON.stringify(wire);
      const accepts = (marker: string, reference: string, ...kinds: string[]) => {
        expect(content.includes(marker)).toBe(
          records.some(
            (entry) =>
              "reference" in entry && entry.reference === reference && kinds.includes(entry.kind),
          ),
        );
      };
      accepts(markers.privateProject, otherMessage, "message");
      accepts(markers.firstMessage, firstMessage, "message");
      accepts(markers.memory, versionId, "memory_version");
      accepts(markers.tool, toolVersionId, "memory_version");
      accepts(markers.handoff, proposal.id, "note");
      accepts(markers.selected, selected.id, "message");
      accepts(markers.hidden, hidden.id, "message");
      if (request.project === otherProject)
        expect(content).not.toMatch(
          /MARK236_(MEMORY_VERSION|HANDOFF_NOTE|SELECTED_REPLY|RESEARCH_MESSAGE)/,
        );
    }
    const fingerprint = raw
      .prepare("SELECT lower(hex(account_fingerprint)) AS fingerprint FROM attempts WHERE id=?")
      .get(bytes(firstAttempt));
    expect(fingerprint).toEqual({ fingerprint: initialFingerprint });
    expect(JSON.stringify(raw.prepare("SELECT * FROM command_receipts").all())).not.toContain(
      initialFingerprint,
    );
    for (const output of h.sent.filter((text) => decodeText(text).ok))
      expect(output).not.toContain(initialFingerprint);
  } finally {
    raw.close();
  }
  await writer.close();
  const logs = fs
    .readdirSync(path.join(h.root, "logs"))
    .map((name) => fs.readFileSync(path.join(h.root, "logs", name), "utf8"))
    .join("");
  expect(logs).toContain("ohtia.reply.details_read");
  expect(logs).toContain("ohtia.usage.late_accepted");
  for (const marker of [...Object.values(markers), initialFingerprint!]) {
    expect(logs).not.toContain(marker);
    expect(outputs.join("")).not.toContain(marker);
  }
  const inspectDatabases = () =>
    fs.readdirSync(h.root, { recursive: true }).flatMap((entry) => {
      const file = path.join(h.root, String(entry));
      if (!/ohtia\.db3(-wal)?$/.test(file)) return [];
      const bytes = fs.readFileSync(file);
      expect(bytes.includes(markers.credential)).toBe(false);
      return [{ file, bytes }];
    });
  expect(inspectDatabases().some(({ bytes }) => bytes.includes(markers.memory))).toBe(true);
  h.service.dispose();
  await h.store.close();
  const old = h.raw();
  try {
    old.exec(preReplyUsageSql);
  } finally {
    old.close();
  }
  await h.store.open();
  const recovery = path.join(h.root, "recovery", "migrations") + path.sep;
  expect(
    inspectDatabases().some(
      ({ file, bytes }) => file.startsWith(recovery) && bytes.includes(markers.memory),
    ),
  ).toBe(true);
});

it("settles usage from a quarantined dispatch only after storage admission", async () => {
  const h = await harness();
  let peer = h.service;
  let late: ((report: LateUsageReport) => Promise<LateUsageDecision>) | undefined;
  const fake = createFakeProvider({
    send: (_request, control) => {
      expect(control.release()).toBe(true);
      late = control.reportLateUsage;
      return new Promise<void>((resolve) => {
        control.signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    },
  });
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
    { state: () => "connected", send: (_g, text) => peer.receive(text) },
  );
  controls.push(() => dispatch.dispose());
  dispatch.begin("service");
  peer.receive(
    JSON.stringify({
      kind: "connection_state",
      generation: "service",
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
  peer.receive(
    JSON.stringify({
      kind: "connection_models",
      generation: "service",
      page: {
        connection: "chatgpt",
        model_list_revision: 1,
        models: [{ id: "model", name: "Model" }],
        nextCursor: 1,
        hasMore: false,
      },
    }),
  );
  value(
    await h.port.appendMessage("quarantined-reply", {
      conversationId: h.conversationId,
      content: "Synthetic restart.",
    }).result,
  );
  await peer.drain();
  const request = h.sent.flatMap((text) => decodeProviderDispatch(text, "service") ?? []).at(-1)!;
  const dispatched = dispatch.receive(request);
  await vi.waitFor(() => expect(late).toBeTypeOf("function"));
  const endedAt = Date.now();
  dispatch.end("service");
  vi.useFakeTimers({ toFake: ["Date"] });
  await dispatched;
  peer.dispose();
  await h.store.close();
  peer = createStatusService(
    "replacement",
    "en-US",
    (text) => {
      const receipt = decodeLateUsageReceipt(text, "replacement");
      if (receipt) dispatch.usageReceipt(receipt);
    },
    h.store,
    h.lost,
    "development",
  );
  controls.push(() => peer.dispose());
  dispatch.begin("replacement");
  const report = {
    revision: 1,
    estimated: false,
    usage: { input_tokens: 5, cached_input_tokens: null, output_tokens: 1, reasoning_tokens: null },
  };
  const missing = late!(report);
  await peer.drain();
  expect(await missing).toEqual({ accepted: false, code: "receipt_unavailable" });
  vi.setSystemTime(endedAt + 8 * 60_000);
  await h.store.open();
  // A ready store still awaits explicit activation from the broker.
  const waiting = late!(report);
  await peer.drain();
  expect(await waiting).toEqual({ accepted: false, code: "receipt_unavailable" });
  peer.activate("en-US");
  const settled = late!(report);
  await peer.drain();
  const accepted = await settled;
  expect(accepted).toMatchObject({ accepted: true });
  vi.setSystemTime(endedAt + 16 * 60_000);
  const expired = late!({ ...report, revision: 2 });
  await peer.drain();
  expect(await expired).toEqual({ accepted: false, code: "window_closed" });
  const replay = late!(report);
  await peer.drain();
  expect(await replay).toEqual(accepted);
  const db = h.raw();
  try {
    expect(
      db
        .prepare("SELECT state, finished_at, usage_report_deadline_at, input_tokens FROM attempts")
        .get(),
    ).toMatchObject({
      state: "uncertain",
      finished_at: expect.any(String),
      usage_report_deadline_at: expect.any(String),
      input_tokens: 5,
    });
  } finally {
    db.close();
  }
  expect(h.lost).not.toHaveBeenCalled();
});
