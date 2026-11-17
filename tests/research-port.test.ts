import { proposeSetup } from "./fixtures/project-setup.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
  type DiagnosticEvent,
} from "../packages/contracts/src/index.js";
import { TextStaging, digest } from "../packages/utility/src/research-text.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import { parseDevelopmentSwitches } from "../packages/main/src/development-command.js";
import { storageFixture } from "./fixtures/storage.js";

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
  let receive: (text: unknown) => void = () => {};
  let id = 0;
  const sent: string[] = [];
  const lost = vi.fn();
  const service = createStatusService(
    "service",
    "en-US",
    (text) => {
      sent.push(text);
      if (decodeText(text).ok) receive(text);
    },
    fixture.store,
    lost,
    "development",
  );
  service.activate("en-US");
  const client = createFoundationPort(
    { contextIsolated: true, sandboxed: true },
    {
      send: (text) => service.receive(text),
      listen: (listener) => {
        receive = listener;
        return () => {
          receive = () => {};
        };
      },
    },
    {
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
    },
    { windowGeneration: "window", serviceGeneration: "service", nextId: () => `request-${++id}` },
  );
  controls.push(() => {
    client.dispose();
    service.dispose();
  });
  const project = value(await client.port.createProject("create-project").result);
  // These transport cases use a confirmed project without introducing setup tasks.
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
      const reference = page.items[0]?.kind === "message" && page.items[0].content;
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
  it("paginates 120 items in explicit batches and rechecks rename revisions through the real port", async () => {
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
    do {
      const items: ResearchOutputs["timeline.listBefore"] = value(
        await h.port.listTimelineBefore({ conversationId: h.conversationId, cursor, count: 50 })
          .result,
      );
      ids.push(...items.items.map((item) => item.id));
      count += items.items.length;
      cursor = items.next;
      // Small whole-item fragments compose into the requested page of 50.
      if (cursor) expect(items.items.length).toBeGreaterThan(0);
    } while (cursor);
    expect(count).toBe(120);
    expect(new Set(ids).size).toBe(120);
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
    value(await h.port.listProjects({ cursor: null, count: 50 }).result);
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
    event({ type: "result", sequence, result: { status: "completed" } });
    const last = value(
      await h.port.listTimelineBefore({ conversationId: conversation.id, cursor: null, count: 1 })
        .result,
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
  value(await h.port.listProjects({ cursor: null, count: 50 }).result);
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
    h.port.listProjects({ cursor: missing, count: 50 }),
    h.port.listConversations({ projectId: missing, cursor: null, count: 50 }),
    h.port.listConversations({ projectId: h.projectId, cursor: missing, count: 50 }),
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
  value(await h.port.listProjects({ cursor: null, count: 50 }).result);
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
  ).toEqual({ destination: null });
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
  const notices: unknown[] = [];
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
  value(await h.port.rejectProjectSetup("reject-proposal", { proposalId: first }).result);
  await h.service.drain();
  expect(
    value(await h.port.readTimeline({ conversationId: conversation, ids: [first] }).result)
      .items[0],
  ).toMatchObject({ state: "rejected", revision: 2 });
  await vi.waitFor(
    () =>
      expect(notices).toContainEqual({
        ok: true,
        value: { kind: "changed", record: "timeline", id: first, revision: 2 },
      }),
    { timeout: 3000 },
  );
  expect(
    await h.port.confirmProjectSetup("stale-proposal", { proposalId: first }).result,
  ).toMatchObject({ error: { code: "proposal_not_waiting" } });
  subscription.dispose();
});
