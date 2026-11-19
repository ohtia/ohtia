import { createHash, webcrypto } from "node:crypto";
import { deferred } from "./fixtures/settings.js";
// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskNotice, taskNoticeContent } from "../packages/renderer/src/task-notice.js";
import {
  ConversationHistory,
  ConversationRenameNotice,
  historyTime,
} from "../packages/renderer/src/conversation-history.js";
import { conversationPreview } from "../packages/renderer/src/message-markdown.js";
import { ConversationHistoryController } from "../packages/renderer/src/conversation-history-controller.js";
import { ConversationView } from "../packages/renderer/src/conversation-view.js";
import {
  ConversationController,
  type ConversationState,
} from "../packages/renderer/src/conversation-controller.js";
import {
  failure,
  staleRevision,
  compareConversations,
  chatgptConnection,
  type TimelineTask,
  type TimelineConsultation,
  type InterfaceLocale,
  portLimits,
  type FoundationPort,
  type Outcome,
  type ResearchEvent,
  type ResearchOutputs,
  type TimelineItem,
  type ConversationSummary,
} from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1000), conversationId: id(2000) };
const message = (n: number, text = `Message ${n}`): TimelineItem => ({
  kind: "message",
  id: id(n),
  position: n,
  rank: 1,
  revision: 1,
  authorKind: "researcher",
  agentId: null,
  taskId: null,
  content: text,
  language: null,
  ending: null,
});
const summary: ConversationSummary = {
  id: scope.conversationId,
  projectId: scope.projectId,
  title: null,
  createdAt: "2026-11-15T10:12:00.000Z",
  updatedAt: "2026-11-15T10:12:00.000Z",
  revision: 1,
  agentId: "virgilio",
  latestAt: "2026-11-15T10:12:00.000Z",
  latestPrefix: "",
  latestTruncated: false,
  latestLanguage: null,
  status: null,
  latestReplyTaskId: null,
  runningTask: null,
};
const call = <T>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
const ok = <T>(value: T) => call({ ok: true as const, value });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
function state(items: readonly TimelineItem[] = []): ConversationState {
  return {
    scope,
    status: "ready",
    items,
    texts: new Map(
      items
        .filter((x) => x.kind === "message")
        .map((x) => [x.id, typeof x.content === "string" ? x.content : ""]),
    ),
    replies: new Map(),
    next: null,
    loadingEarlier: false,
    failedEarlier: false,
    completed: 0,
  };
}
async function render(next: ConversationState, controller = {} as ConversationController) {
  await act(async () =>
    root.render(
      h(ConversationView, {
        state: next,
        controller: {
          connections: [chatgptConnection],
          ...controller,
          claimTaskNotice: controller.claimTaskNotice?.bind(controller),
          performTaskAction: controller.performTaskAction?.bind(controller),
        },
        locale: "en-US",
        commands: { copyMessage: async () => true, openExternalLink: async () => true },
      }),
    ),
  );
}

describe("conversation presentation", () => {
  it("shows the consultation request as Markdown and retries a failed decision with the same intent", async () => {
    const proposal = {
      kind: "consultation",
      id: id(12),
      position: 3,
      rank: 2,
      revision: 1,
      state: "proposed",
      invalidReason: null,
      taskId: id(900),
      language: "en",
      agentId: "josefa",
      request: "**Exact request**",
      reason: "**Plain reason**",
      connection: null,
    } as const;
    const proposingReply = {
      kind: "message",
      id: id(11),
      position: 3,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "virgilio",
      taskId: id(900),
      language: "en",
      content: "We could ask.",
      ending: "complete",
    } as const;
    const performConsultationAction = vi.fn(async () => failure("storage_failed"));
    const observeConsultationDestination = vi.fn(() => () => {});
    const controller = {
      performConsultationAction,
      observeConsultationDestination,
    } as unknown as ConversationController;
    await render(
      { ...state([proposingReply, proposal]), consultationDestination: "chatgpt" },
      controller,
    );
    const card = container.querySelector(".action-proposal")!;
    expect(card.querySelector("strong")?.textContent).toBe("Exact request");
    expect(card.textContent).toContain("**Plain reason**");
    expect(card.textContent).toContain("Waiting for your answer");
    expect(card.textContent).toContain("Josefa · ChatGPT");
    expect(card.querySelectorAll(".voice-label")).toHaveLength(1);
    expect(observeConsultationDestination).toHaveBeenCalledOnce();
    const accept = [...card.querySelectorAll("button")].find(
      (element) => element.textContent === "Ask Josefa",
    )!;
    await act(async () => accept.click());
    expect(card.querySelector('[role="alert"]')?.textContent).toContain(
      "Ohtia couldn’t ask Josefa.",
    );
    await act(async () => accept.click());
    expect(performConsultationAction.mock.calls[0]).toEqual(
      performConsultationAction.mock.calls[1],
    );
  });

  it("renders hostile markup literally and marks researcher and agent languages", async () => {
    const text = '<script>alert("unsafe")</script>\n<img src=x onerror=alert(1)> javascript:evil()';
    const agent: TimelineItem = {
      kind: "message",
      id: id(3),
      position: 3,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "virgilio",
      taskId: id(300),
      language: "ko",
      content: "한국어 mixed Latin",
      ending: "complete",
    };
    await render(state([message(1, text), agent]));
    expect(container.querySelector("script,img,a")).toBeNull();
    for (const line of text.split("\n"))
      expect(container.querySelector(".conversation-text")?.textContent).toContain(line);
    expect(
      container.querySelector('article[aria-label="You"] .conversation-text')?.getAttribute("lang"),
    ).toBe("");
    expect(
      container
        .querySelector('article[aria-label="Virgilio"] .conversation-text')
        ?.getAttribute("lang"),
    ).toBe("ko");
    expect(container.querySelectorAll(".conversation-actions")).toHaveLength(2);
    expect(container.querySelector(".contributor-symbol")).not.toBeNull();
  });
  it("keeps streaming parts out of live announcements and withholds the actions row", async () => {
    const task: TimelineItem = {
      kind: "task",
      connection: "chatgpt",
      blockingReason: null,
      outcomeReason: null,
      replyMessageId: null,
      waitingForModels: false,
      waitingLimit: 3,
      dispatched: true,
      superseded: false,
      maxAttemptDurationMs: 600_000,
      maxInactivityMs: 120_000,
      id: id(300),
      position: 2,
      rank: 3,
      revision: 2,
      agentId: "virgilio",
      language: "en",
      state: "running",
    };
    await render({
      ...state([message(1), task]),
      replies: new Map([[task.id, { sequence: 1, text: "Live text" }]]),
    });
    expect(container.querySelector('[aria-busy="true"]')?.textContent).toContain("Live text");
    expect(container.querySelector('[aria-busy="true"] .conversation-actions')).toBeNull();
    expect(container.querySelector(".conversation-writing")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(container.querySelector("[aria-live]")?.textContent).toBe("");
  });
  it("distinguishes loading, empty, failed, unavailable and earlier-page failures with buttons outside notices", async () => {
    const controller = {
      reload: vi.fn(),
      loadEarlier: vi.fn(),
    } as unknown as ConversationController;
    await render({ ...state(), status: "loading" }, controller);
    expect(container.textContent).toContain("Loading conversation…");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await render(state(), controller);
    expect(container.textContent).toContain("This conversation has no messages yet.");
    await render({ ...state(), status: "failed" }, controller);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("still saved");
    expect(container.querySelector('[role="alert"] button')).toBeNull();
    await render({ ...state(), status: "unavailable" }, controller);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("until local data");
    await render(
      { ...state([message(1)]), next: { position: 1, rank: 1, id: id(1) }, failedEarlier: true },
      controller,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("earlier messages");
    expect(container.querySelector('[role="alert"] button')).toBeNull();
  });
  it("does not read earlier pages on scroll and preserves the reader while output grows", async () => {
    const controller = {
      reload: vi.fn(),
      loadEarlier: vi.fn(),
    } as unknown as ConversationController;
    await render(state([message(1), message(2)]), controller);
    const viewport = container.querySelector<HTMLElement>(".conversation-timeline")!;
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 400 },
    });
    viewport.scrollTop = 300;
    await act(async () => viewport.dispatchEvent(new Event("scroll", { bubbles: true })));
    await render(state([message(1), message(2), message(3, "x".repeat(10000))]), controller);
    expect(viewport.scrollTop).toBe(300);
    expect(controller.loadEarlier).not.toHaveBeenCalled();
    expect(container.querySelector('button[aria-label="Jump to latest message"]')).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Jump to latest message"]')!
        .click(),
    );
    expect(viewport.scrollTop).toBe(2000);
  });
});

function controllerHarness(start = true) {
  let listener: (event: Outcome<ResearchEvent>) => void = () => {};
  let subscriptions = 0;
  const items = Array.from({ length: 120 }, (_, n) => message(n + 1));
  let failedEarlier = false;
  const port = {
    readPauses: vi.fn(() => ok({ revision: 1, restart: 0, usage: [] })),
    readExecutionLimits: () =>
      ok({ serviceGeneration: "service", revision: 1, max_concurrent_inference: 10, running: 0 }),
    subscribeConnection: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "connection" } }),
      dispose() {},
    }),
    readDestination: vi.fn(() => ok({ destination: null })),
    readConnection: vi.fn(() =>
      ok({ account_email: "researcher@example.org", last_account_email: null }),
    ),
    appendMessage: vi.fn(() => ok({ resultId: id(300) })),
    subscribeResearch: vi.fn((_scope, receive) => {
      listener = receive;
      subscriptions++;
      return {
        ready: Promise.resolve({
          ok: true as const,
          value: { subscriptionId: `sub-${subscriptions}` },
        }),
        dispose() {},
      };
    }),
    listProjects: vi.fn(() => ok({ items: [], next: null, hasMore: false })),
    readConversations: vi.fn(() => ok({ items: [summary], remaining: [] })),
    listTimelineBefore: vi.fn((p) => {
      if (p.cursor && failedEarlier) return call(failure("storage_failed"));
      const before = items
        .filter((item) => !p.cursor || item.position < p.cursor.position)
        .reverse();
      const page = before.slice(0, p.count);
      const last = page.at(-1);
      return ok({
        items: page,
        next:
          before.length > page.length && last
            ? { position: last.position, rank: last.rank, id: last.id }
            : null,
        hasMore: before.length > page.length,
      });
    }),
    readTimeline: vi.fn((p) =>
      ok({
        items: p.ids.map((id: string) => items.find((item) => item.id === id)).filter(Boolean),
        remaining: [],
      }),
    ),
    readReplyParts: vi.fn(() =>
      ok({
        parts: [
          { sequence: 1, text: "A" },
          { sequence: 2, text: "B" },
          { sequence: 3, text: "C" },
        ],
        latestSequence: 3,
      }),
    ),
  } as unknown as FoundationPort;
  const controller = new ConversationController(port);
  if (start) controller.open(scope);
  return {
    controller,
    port,
    items,
    emit: (event: Outcome<ResearchEvent>) => listener(event),
    failEarlier: () => {
      failedEarlier = true;
    },
  };
}
async function settle() {
  for (let n = 0; n < 25; n++) await Promise.resolve();
}
describe("conversation synchronization", () => {
  it("loads exactly 50, then 50, then 20; failed reads retain the same cursor for retry", async () => {
    const h = controllerHarness();
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(50);
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(100);
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(120);
    expect(h.controller.snapshot().next).toBeNull();
    h.controller.dispose();
    const retry = controllerHarness();
    await settle();
    const cursor = retry.controller.snapshot().next;
    retry.failEarlier();
    retry.controller.loadEarlier();
    await settle();
    expect(retry.controller.snapshot().failedEarlier).toBe(true);
    expect(retry.controller.snapshot().next).toEqual(cursor);
    retry.controller.dispose();
  });
  it("recovers missing text from sequence one and limits streaming redraws to ten per second", async () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    await settle();
    let redraws = 0;
    h.controller.subscribe(() => redraws++);
    for (let sequence = 1; sequence <= 2; sequence++)
      h.emit({ ok: true, value: { kind: "reply", taskId: id(900), sequence, text: "x" } });
    await settle();
    expect(redraws).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(redraws).toBe(1);
    h.emit({ ok: true, value: { kind: "reply", taskId: id(900), sequence: 4, text: "gap" } });
    await settle();
    expect(h.port.readReplyParts).toHaveBeenCalledWith({ taskId: id(900), fromSequence: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.controller.snapshot().replies.get(id(900))?.text).toBe("ABC");
    h.controller.dispose();
  });
  it("replaces the subscription and rereads the visible records after a sequence gap", async () => {
    const h = controllerHarness();
    await settle();
    h.emit(failure("sequence_gap"));
    await settle();
    expect(h.port.subscribeResearch).toHaveBeenCalledTimes(2);
    expect(h.port.listProjects).toHaveBeenCalledTimes(2);
    expect(h.port.readConversations).toHaveBeenCalledTimes(2);
    expect(h.port.listTimelineBefore).toHaveBeenCalledTimes(2);
    expect(h.port.readTimeline).toHaveBeenCalled();
    expect(h.controller.snapshot().items).toHaveLength(50);
    h.controller.dispose();
  });
});

describe("conversation read and event recovery", () => {
  it.each(["projects", "header", "timeline", "subscription"])(
    "retains a failed %s read as an explicit panel state and reloads it",
    async (stage) => {
      const h = controllerHarness(false);
      if (stage === "projects")
        vi.mocked(h.port.listProjects).mockImplementationOnce(() =>
          call(failure("service_unavailable")),
        );
      if (stage === "header")
        vi.mocked(h.port.readConversations).mockImplementationOnce(() =>
          call(failure("storage_failed")),
        );
      if (stage === "timeline")
        vi.mocked(h.port.listTimelineBefore).mockImplementationOnce(() =>
          call(failure("storage_failed")),
        );
      if (stage === "subscription")
        vi.mocked(h.port.subscribeResearch).mockImplementationOnce(() => ({
          ready: Promise.resolve(failure("service_unavailable")),
          dispose() {},
        }));
      h.controller.open(scope);
      await settle();
      expect(h.controller.snapshot().status).toBe(
        stage === "projects" || stage === "subscription" ? "unavailable" : "failed",
      );
      expect(h.controller.composer.snapshot().destinationStatus).toBe(
        stage === "projects" || stage === "subscription" ? "failed" : "ready",
      );
      h.controller.reload();
      expect(h.controller.snapshot().status).toBe("loading");
      await settle();
      expect(h.controller.snapshot().status).toBe("ready");
      expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
      h.controller.dispose();
    },
  );
  it("announces a saved reply once and ignores older revisions and late streamed parts", async () => {
    vi.useFakeTimers();
    const h = controllerHarness();
    await settle();
    const taskId = id(900);
    h.emit({ ok: true, value: { kind: "reply", taskId, sequence: 1, text: "live" } });
    await settle();
    const saved: TimelineItem = {
      kind: "message",
      id: id(500),
      position: 121,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "virgilio",
      taskId,
      content: "Final",
      language: "ko",
      ending: "complete",
    };
    vi.mocked(h.port.readTimeline).mockImplementation(() => ok({ items: [saved], remaining: [] }));
    h.emit({ ok: true, value: { kind: "changed", record: "timeline", id: saved.id, revision: 1 } });
    await settle();
    h.emit({ ok: true, value: { kind: "changed", record: "timeline", id: saved.id, revision: 1 } });
    h.emit({ ok: true, value: { kind: "reply", taskId, sequence: 2, text: "late" } });
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.controller.snapshot().completed).toBe(1);
    expect(h.controller.snapshot().replies.has(taskId)).toBe(false);
    expect(h.port.readTimeline).toHaveBeenCalledTimes(1);
    h.controller.dispose();
  });
  it("loads shared records without an open project and follows only bounded project fragments", async () => {
    const h = controllerHarness(false);
    vi.mocked(h.port.listProjects).mockImplementationOnce(() =>
      ok({ items: [], next: id(1010), hasMore: true }),
    );
    h.controller.open({ projectId: null, conversationId: null });
    await settle();
    expect(h.controller.snapshot().status).toBe("ready");
    expect(h.port.listProjects).toHaveBeenCalledTimes(2);
    expect(h.port.readConversations).not.toHaveBeenCalled();
    h.emit({ ok: true, value: { kind: "changed", record: "project", id: id(11), revision: 1 } });
    await settle();
    expect(h.port.listProjects).toHaveBeenCalledTimes(3);
    h.controller.dispose();
    h.controller.open(scope);
    expect(h.port.subscribeResearch).toHaveBeenCalledTimes(1);
  });
  it("refreshes a renamed conversation while retaining all previously loaded pages", async () => {
    const h = controllerHarness();
    await settle();
    h.controller.loadEarlier();
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(100);
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().next).toBeNull();
    vi.mocked(h.port.readConversations).mockImplementation(() =>
      ok({ items: [{ ...summary, title: "Renamed", revision: 2 }], remaining: [] }),
    );
    h.emit({
      ok: true,
      value: { kind: "changed", record: "conversation", id: scope.conversationId, revision: 2 },
    });
    await settle();
    expect(h.controller.snapshot().conversation?.title).toBe("Renamed");
    h.controller.open({ ...scope, conversationId: id(3000) });
    h.controller.open(scope);
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(120);
    expect(h.controller.snapshot().next).toBeNull();
    h.controller.dispose();
  });
  it("ignores a late scoped read after navigation and disposal", async () => {
    const h = controllerHarness(false);
    let release: (
      result: Outcome<{ items: ConversationSummary[]; remaining: string[] }>,
    ) => void = () => {};
    vi.mocked(h.port.readConversations).mockImplementationOnce(() => ({
      result: new Promise((resolve) => {
        release = resolve;
      }),
      cancel() {},
    }));
    h.controller.open(scope);
    await settle();
    h.controller.open({ projectId: null, conversationId: null });
    release({ ok: true, value: { items: [summary], remaining: [] } });
    await settle();
    expect(h.controller.snapshot().scope.conversationId).toBeNull();
    expect(h.controller.snapshot().conversation).toBeUndefined();
    h.controller.dispose();
  });
});

it("restores each conversation’s reading position and keeps its anchor through paging and hidden panels", async () => {
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches("article")
      ? [...this.parentElement!.querySelectorAll("article")].indexOf(this) * 100
      : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches("article") ? 100 : 0;
  });
  const controller = { reload: vi.fn(), loadEarlier: vi.fn() } as unknown as ConversationController;
  const original = {
    ...state([message(2), message(3)]),
    next: { position: 2, rank: 1, id: id(2) },
  };
  await render(original, controller);
  const viewport = container.querySelector<HTMLElement>(".conversation-timeline")!;
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 400 },
  });
  viewport.scrollTop = 50;
  await act(async () => viewport.dispatchEvent(new Event("scroll", { bubbles: true })));
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".conversation-earlier button")!.click(),
  );
  expect(controller.loadEarlier).toHaveBeenCalledOnce();
  await render(
    {
      ...original,
      items: [message(1), ...original.items],
      texts: new Map([[id(1), "earlier"], ...original.texts]),
    },
    controller,
  );
  expect(viewport.scrollTop).toBe(150);
  container.hidden = true;
  await render(
    { ...original, items: [message(1), ...original.items], texts: original.texts },
    controller,
  );
  expect(viewport.scrollTop).toBe(150);
  container.hidden = false;
  await act(async () => resize());
  expect(viewport.scrollTop).toBe(150);
  const other = {
    ...state([message(10)]),
    scope: { projectId: id(1001), conversationId: id(3000) },
  };
  await render(other, controller);
  expect(viewport.scrollTop).toBe(2000);
  viewport.scrollTop = 80;
  await act(async () => viewport.dispatchEvent(new Event("scroll", { bubbles: true })));
  await render({ ...original, items: [message(1), ...original.items] }, controller);
  expect(viewport.scrollTop).toBe(150);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("recovers an active reply over bounded part pages and rejects incomplete part sequences", async () => {
  const task: TimelineItem = {
    kind: "task",
    connection: "chatgpt",
    blockingReason: null,
    outcomeReason: null,
    replyMessageId: null,
    waitingForModels: false,
    waitingLimit: 3,
    dispatched: true,
    superseded: false,
    maxAttemptDurationMs: 600_000,
    maxInactivityMs: 120_000,
    id: id(900),
    position: 121,
    rank: 3,
    revision: 2,
    agentId: "virgilio",
    language: "en",
    state: "running",
  };
  const h = controllerHarness(false);
  vi.mocked(h.port.listTimelineBefore).mockImplementation(() =>
    ok({ items: [task], next: null, hasMore: false }),
  );
  vi.mocked(h.port.readReplyParts)
    .mockImplementationOnce(() => ok({ parts: [{ sequence: 1, text: "A" }], latestSequence: 3 }))
    .mockImplementationOnce(() =>
      ok({
        parts: [
          { sequence: 2, text: "B" },
          { sequence: 3, text: "C" },
        ],
        latestSequence: 3,
      }),
    );
  h.controller.open(scope);
  await settle();
  expect(h.port.readReplyParts).toHaveBeenNthCalledWith(2, { taskId: task.id, fromSequence: 2 });
  expect(h.controller.snapshot().replies.get(task.id)?.text).toBe("ABC");
  h.controller.dispose();
});

it.each([
  "header-missing",
  "header-wrong-project",
  "timeline-empty-fragment",
  "timeline-id-no-progress",
  "reply-gap",
  "reply-no-progress",
  "reply-failed",
])("keeps %s inconsistent reads out of the conversation", async (problem) => {
  const h = controllerHarness(false);
  if (problem === "header-missing")
    vi.mocked(h.port.readConversations).mockImplementation(() => ok({ items: [], remaining: [] }));
  if (problem === "header-wrong-project")
    vi.mocked(h.port.readConversations).mockImplementation(() =>
      ok({ items: [{ ...summary, projectId: id(77) }], remaining: [] }),
    );
  if (problem === "timeline-empty-fragment")
    vi.mocked(h.port.listTimelineBefore).mockImplementation(() =>
      ok({ items: [], next: { id: id(77), position: 77, rank: 1 }, hasMore: true }),
    );
  h.controller.open(scope);
  await settle();
  if (problem === "timeline-id-no-progress") {
    vi.mocked(h.port.readTimeline).mockImplementation((input) =>
      ok({ items: [], remaining: input.ids }),
    );
    h.emit({ ok: true, value: { kind: "changed", record: "timeline", id: id(50), revision: 1 } });
  }
  if (problem.startsWith("reply-")) {
    vi.mocked(h.port.readReplyParts).mockImplementation(() =>
      problem === "reply-failed"
        ? call(failure("storage_failed"))
        : ok({
            parts: problem === "reply-gap" ? [{ sequence: 2, text: "missing first part" }] : [],
            latestSequence: 2,
          }),
    );
    h.emit({ ok: true, value: { kind: "reply", taskId: id(900), sequence: 3, text: "gap" } });
  }
  await settle();
  expect(h.controller.snapshot().status).toBe("failed");
  h.controller.dispose();
});

it("announces each newly finished reply and does not replay that notice on navigation", async () => {
  const initial = state([message(1)]);
  await render(initial);
  expect(container.querySelector("[aria-live]")?.textContent).toBe("");
  await render({ ...initial, completed: 1, completedAgent: "virgilio" });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("Virgilio replied");
  await render({ ...initial, scope: { ...scope, conversationId: id(4000) }, completed: 0 });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("");
  await render({ ...initial, completed: 1 });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("");
  const josefa = state([
    ...initial.items,
    {
      ...message(2),
      authorKind: "agent",
      agentId: "josefa",
      taskId: id(900),
      language: "es-AR",
      ending: "complete",
      content: "Plan de búsqueda",
    },
  ]);
  await render({ ...josefa, completed: 2, completedAgent: "josefa" });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("Josefa replied");
  expect(
    container.querySelector('article[aria-label="Josefa"] .conversation-text')?.textContent,
  ).toBe("Plan de búsqueda");
});

it("retains the earlier-page continuation when reloading an initially interrupted page", async () => {
  const h = controllerHarness(false);
  const list = h.port.listTimelineBefore;
  vi.mocked(list)
    .mockImplementationOnce(() =>
      ok({
        items: Array.from({ length: 10 }, (_, n) => message(120 - n)),
        next: { position: 111, rank: 1, id: id(111) },
        hasMore: true,
      }),
    )
    .mockImplementationOnce(() => call(failure("storage_failed")));
  h.controller.open(scope);
  await settle();
  expect(h.controller.snapshot().status).toBe("failed");
  expect(h.controller.snapshot().items).toHaveLength(10);
  h.controller.reload();
  await settle();
  expect(h.controller.snapshot().status).toBe("ready");
  expect(h.controller.snapshot().items).toHaveLength(50);
  expect(h.controller.snapshot().next).not.toBeNull();
  h.controller.loadEarlier();
  await settle();
  h.controller.loadEarlier();
  await settle();
  expect(h.controller.snapshot().items).toHaveLength(120);
  expect(h.controller.snapshot().next).toBeNull();
  h.controller.dispose();
});

it("clears an obsolete earlier-page loading flag when returning to its conversation", async () => {
  const h = controllerHarness();
  await settle();
  let release: (
    value: Outcome<{ items: TimelineItem[]; next: null; hasMore: false }>,
  ) => void = () => {};
  vi.mocked(h.port.listTimelineBefore).mockImplementationOnce(() => ({
    result: new Promise((resolve) => {
      release = resolve;
    }),
    cancel() {},
  }));
  h.controller.loadEarlier();
  await settle();
  expect(h.controller.snapshot().loadingEarlier).toBe(true);
  h.controller.open({ projectId: null, conversationId: null });
  h.controller.open(scope);
  release({ ok: true, value: { items: [], next: null, hasMore: false } });
  await settle();
  expect(h.controller.snapshot().status).toBe("ready");
  expect(h.controller.snapshot().loadingEarlier).toBe(false);
  expect(h.controller.snapshot().next).not.toBeNull();
  h.controller.loadEarlier();
  await settle();
  expect(h.controller.snapshot().items).toHaveLength(100);
  h.controller.dispose();
});

it("keeps keyboard focus in the timeline when the last earlier-page button disappears", async () => {
  const controller = { reload: vi.fn(), loadEarlier: vi.fn() } as unknown as ConversationController;
  const pending = { ...state([message(2)]), next: { position: 2, rank: 1, id: id(2) } };
  await render(pending, controller);
  const button = container.querySelector<HTMLButtonElement>(".conversation-earlier button")!;
  await act(async () => {
    button.focus();
    button.click();
  });
  await render({ ...pending, loadingEarlier: true }, controller);
  await render({ ...state([message(1), message(2)]), next: null }, controller);
  expect(document.activeElement).toBe(container.querySelector(".conversation-timeline"));
});

it("clears obsolete paging state when a sequence gap interrupts an earlier-page request", async () => {
  const h = controllerHarness();
  await settle();
  let release!: (value: Outcome<{ items: TimelineItem[]; next: null; hasMore: false }>) => void;
  vi.mocked(h.port.listTimelineBefore).mockImplementationOnce(() => ({
    result: new Promise((resolve) => {
      release = resolve;
    }),
    cancel() {},
  }));
  const cursor = h.controller.snapshot().next;
  h.controller.loadEarlier();
  await settle();
  expect(h.controller.snapshot().loadingEarlier).toBe(true);
  h.emit(failure("sequence_gap"));
  expect(h.controller.snapshot().loadingEarlier).toBe(false);
  release({ ok: true, value: { items: [], next: null, hasMore: false } });
  await settle();
  expect(h.controller.snapshot()).toMatchObject({
    status: "ready",
    loadingEarlier: false,
    next: cursor,
  });
  h.controller.loadEarlier();
  await settle();
  expect(h.controller.snapshot().items).toHaveLength(100);
  h.controller.dispose();
});

it.each(["navigation", "gap"] as const)(
  "bridges more than 50 new items into cached history after %s",
  async (mode) => {
    const h = controllerHarness();
    await settle();
    if (mode === "navigation") h.controller.open({ projectId: null, conversationId: null });
    h.items.push(...Array.from({ length: 130 }, (_, n) => message(n + 121)));
    if (mode === "navigation") h.controller.open(scope);
    else h.emit(failure("sequence_gap"));
    await settle();
    await settle();
    expect(h.controller.snapshot().items.map((item) => item.position)).toEqual(
      Array.from({ length: 180 }, (_, n) => n + 71),
    );
    h.controller.loadEarlier();
    await settle();
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(250);
    expect(h.controller.snapshot().next).toBeNull();
    h.controller.dispose();
  },
);
it("retries a rejected replacement subscription until the retiring producer releases capacity", async () => {
  const h = controllerHarness();
  await settle();
  vi.useFakeTimers();
  vi.mocked(h.port.subscribeResearch).mockImplementationOnce(() => ({
    ready: Promise.resolve(failure("busy")),
    dispose() {},
  }));
  h.controller.open(scope);
  await settle();
  expect(h.controller.snapshot().status).toBe("ready");
  await vi.advanceTimersByTimeAsync(10);
  await settle();
  expect(h.port.subscribeResearch).toHaveBeenCalledTimes(3);
  expect(h.controller.snapshot().status).toBe("ready");
  h.controller.dispose();
});
it("bounds subscription replacement retries and cancels them at disposal", async () => {
  const h = controllerHarness();
  await settle();
  vi.useFakeTimers();
  vi.mocked(h.port.subscribeResearch).mockImplementation(() => ({
    ready: Promise.resolve(failure("busy")),
    dispose() {},
  }));
  h.controller.open(scope);
  await settle();
  await vi.advanceTimersByTimeAsync(portLimits.request_deadline_ms + 250);
  expect(h.controller.snapshot().status).toBe("failed");
  h.controller.open(scope);
  await settle();
  h.controller.dispose();
  const calls = vi.mocked(h.port.subscribeResearch).mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.port.subscribeResearch).toHaveBeenCalledTimes(calls);
});
it("announces a newly saved live reply even when no text event was observed", async () => {
  const h = controllerHarness();
  await settle();
  const item = {
    ...message(121),
    authorKind: "agent",
    agentId: "virgilio",
    taskId: id(900),
    ending: "complete",
    language: "en",
  } as TimelineItem;
  h.items.push(item);
  h.emit({ ok: true, value: { kind: "changed", record: "timeline", id: item.id, revision: 1 } });
  await settle();
  expect(h.controller.snapshot().completed).toBe(1);
  h.emit({ ok: true, value: { kind: "changed", record: "timeline", id: item.id, revision: 1 } });
  await settle();
  expect(h.controller.snapshot().completed).toBe(1);
  h.controller.dispose();
});

it.each(["navigation", "gap"] as const)(
  "retains paging after an established empty conversation gains history during %s",
  async (mode) => {
    const h = controllerHarness(false);
    h.items.length = 0;
    h.controller.open(scope);
    await settle();
    if (mode === "navigation") h.controller.open({ projectId: null, conversationId: null });
    h.items.push(...Array.from({ length: 120 }, (_, n) => message(n + 1)));
    if (mode === "navigation") h.controller.open(scope);
    else h.emit(failure("sequence_gap"));
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(50);
    expect(h.controller.snapshot().next).not.toBeNull();
    h.controller.loadEarlier();
    await settle();
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().items).toHaveLength(120);
    expect(h.controller.snapshot().next).toBeNull();
    h.controller.dispose();
  },
);
it.each(["navigation", "gap"] as const)(
  "reloads an interrupted range bridge after %s without accepting a disconnected range",
  async (mode) => {
    const h = controllerHarness();
    await settle();
    const read = vi.mocked(h.port.listTimelineBefore).getMockImplementation()!;
    if (mode === "navigation") h.controller.open({ projectId: null, conversationId: null });
    h.items.push(...Array.from({ length: 130 }, (_, n) => message(n + 121)));
    vi.mocked(h.port.listTimelineBefore)
      .mockImplementationOnce(read)
      .mockImplementationOnce(() => call(failure("storage_failed")));
    if (mode === "navigation") h.controller.open(scope);
    else h.emit(failure("sequence_gap"));
    await settle();
    await settle();
    expect(h.controller.snapshot().status).toBe("failed");
    h.controller.reload();
    await settle();
    await settle();
    expect(h.controller.snapshot().status).toBe("ready");
    h.controller.loadEarlier();
    await settle();
    h.controller.loadEarlier();
    await settle();
    expect(h.controller.snapshot().items.map((item) => item.position)).toEqual(
      Array.from({ length: 250 }, (_, n) => n + 1),
    );
    expect(h.controller.snapshot().next).toBeNull();
    h.controller.dispose();
  },
);

it("wires the second researcher action to reuse exact saved text in the composer", async () => {
  const f = controllerHarness();
  await settle();
  await render(
    { ...state([message(1, "  reused\n한글 text  ")]), conversation: summary },
    f.controller,
  );
  const buttons = container.querySelectorAll<HTMLButtonElement>(".conversation-actions button");
  expect(buttons[1]?.getAttribute("aria-label")).toBe("Reuse message");
  await act(async () => buttons[1]!.click());
  expect(container.querySelector("textarea")?.value).toBe("  reused\n한글 text  ");
  f.controller.dispose();
});

it("keeps Josefa in the composer while the saved conversation is loading", async () => {
  const h = controllerHarness(false);
  const project = {
    id: scope.projectId,
    projectType: "thesis" as const,
    title: "Synthetic thesis",
    documentLanguage: "en",
    isDevelopment: false,
    setupConfirmedAt: summary.createdAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    lastOpenedAt: summary.updatedAt,
  };
  vi.mocked(h.port.listProjects).mockReturnValue(
    ok({ items: [project], next: null, hasMore: false }),
  );
  vi.mocked(h.port.readConversations).mockReturnValue({
    result: new Promise(() => {}),
    cancel() {},
  });
  h.port.startConversation = vi.fn(() => ok({ resultId: scope.conversationId }));
  h.controller.open({ projectId: scope.projectId, conversationId: null });
  await settle();
  h.controller.composer.selectAgent("josefa");
  await settle();
  await render(h.controller.snapshot(), h.controller);
  expect(container.querySelector(".conversation-empty")?.textContent).toBe(
    "Ask Josefa about your search.",
  );
  await act(async () => {
    h.controller.composer.edit("Search for tutoring studies.");
    h.controller.composer.send();
    await settle();
  });
  expect(h.controller.snapshot()).toMatchObject({
    scope,
    status: "loading",
    agentHint: "josefa",
  });
  expect(h.controller.snapshot().conversation).toBeUndefined();
  await render(h.controller.snapshot(), h.controller);
  expect(container.querySelector("textarea")?.placeholder).toBe("Message Josefa");
  h.controller.dispose();
});

it("loads the timeline and processes replies independently of a stalled destination read", async () => {
  vi.useFakeTimers();
  const h = controllerHarness(false);
  const cancel = vi.fn();
  vi.mocked(h.port.readDestination).mockReturnValue({ result: new Promise(() => {}), cancel });
  h.controller.open(scope);
  await settle();
  expect(h.controller.snapshot().status).toBe("ready");
  expect(h.controller.snapshot().items).toHaveLength(50);
  expect(h.controller.composer.snapshot().destinationStatus).toBe("loading");
  h.emit({
    ok: true,
    value: { kind: "reply", taskId: id(900), sequence: 1, text: "Independent reply" },
  });
  await settle();
  await vi.advanceTimersByTimeAsync(100);
  expect(h.controller.snapshot().replies.get(id(900))?.text).toBe("Independent reply");
  h.controller.dispose();
  expect(cancel).toHaveBeenCalledOnce();
});

it("retains confirmed destination disclosure across an independent timeline-event failure", async () => {
  const h = controllerHarness();
  await settle();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  vi.mocked(h.port.readTimeline).mockReturnValueOnce(call(failure("storage_failed")) as never);
  h.emit({ ok: true, value: { kind: "changed", record: "timeline", id: id(50), revision: 2 } });
  await settle();
  expect(h.controller.snapshot().status).toBe("failed");
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  h.controller.dispose();
});
it("rereads the project destination even when a subsequent project-list refresh fails", async () => {
  const h = controllerHarness();
  await settle();
  vi.mocked(h.port.readDestination).mockClear();
  vi.mocked(h.port.listProjects).mockReturnValueOnce(call(failure("storage_failed")) as never);
  h.emit({
    ok: true,
    value: { kind: "changed", record: "project", id: scope.projectId, revision: 2 },
  });
  await settle();
  expect(h.port.readDestination).toHaveBeenCalledOnce();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  expect(h.controller.snapshot().status).toBe("failed");
  h.controller.dispose();
});

it.each(["subscription", "projects"])(
  "blocks stale disclosure after a gap when recovery fails at %s",
  async (stage) => {
    const h = controllerHarness();
    await settle();
    h.controller.composer.edit("Retain through gap");
    expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
    if (stage === "subscription")
      vi.mocked(h.port.subscribeResearch).mockImplementationOnce(() => ({
        ready: Promise.resolve(failure("service_unavailable")),
        dispose() {},
      }));
    else
      vi.mocked(h.port.listProjects).mockReturnValueOnce(call(failure("storage_failed")) as never);
    h.emit(failure("sequence_gap"));
    expect(h.controller.composer.snapshot().destinationStatus).toBe("loading");
    h.controller.composer.send();
    expect(h.port.appendMessage).not.toHaveBeenCalled();
    await settle();
    expect(h.controller.composer.snapshot().destinationStatus).toBe("failed");
    h.controller.composer.send();
    expect(h.port.appendMessage).not.toHaveBeenCalled();
    expect(h.controller.composer.snapshot().text).toBe("Retain through gap");
    await h.controller.composer.refreshDestination();
    await settle();
    expect(h.port.subscribeResearch).toHaveBeenCalledTimes(stage === "subscription" ? 3 : 2);
    expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
    h.controller.composer.send();
    await settle();
    expect(h.port.appendMessage).toHaveBeenCalledOnce();
    h.controller.dispose();
  },
);
it("reconnects lost observation before a destination refresh can authorize another send", async () => {
  const h = controllerHarness();
  await settle();
  h.controller.composer.edit("Retained after subscription loss");
  h.emit(failure("service_unavailable"));
  await settle();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("failed");
  h.controller.composer.send();
  expect(h.port.appendMessage).not.toHaveBeenCalled();
  vi.mocked(h.port.readDestination).mockClear();
  await h.controller.composer.refreshDestination();
  expect(h.port.subscribeResearch).toHaveBeenCalledTimes(2);
  expect(h.controller.composer.snapshot().destinationStatus).toBe("loading");
  expect(h.port.readDestination).not.toHaveBeenCalled();
  h.controller.composer.send();
  expect(h.port.appendMessage).not.toHaveBeenCalled();
  await settle();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  expect(h.controller.composer.snapshot().text).toBe("Retained after subscription loss");
  h.controller.composer.send();
  await settle();
  expect(h.port.appendMessage).toHaveBeenCalledOnce();
  h.controller.dispose();
});
it("keeps a non-null destination unresolved when project failure interrupts its delayed account read", async () => {
  const h = controllerHarness();
  await settle();
  let resolve!: (value: Outcome<never>) => void;
  const cancel = vi.fn();
  vi.mocked(h.port.readDestination).mockReturnValueOnce(
    ok({
      destination: {
        operation: "development_test",
        maxAttemptDurationMs: 600_000,
        connection: "chatgpt",
      },
    }) as never,
  );
  vi.mocked(h.port.readConnection).mockReturnValueOnce({
    result: new Promise<Outcome<never>>((done) => {
      resolve = done;
    }),
    cancel,
  });
  vi.mocked(h.port.listProjects).mockReturnValueOnce(call(failure("storage_failed")) as never);
  h.controller.composer.edit("Draft with unresolved identity");
  h.emit({
    ok: true,
    value: { kind: "changed", record: "project", id: scope.projectId, revision: 2 },
  });
  await settle();
  expect(h.port.readConnection).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("failed");
  h.controller.composer.send();
  expect(h.port.appendMessage).not.toHaveBeenCalled();
  resolve({
    ok: true,
    value: { account_email: "late@example.org", last_account_email: null },
  } as never);
  await settle();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("failed");
  expect(h.controller.composer.snapshot().destination).toBeNull();
  await h.controller.composer.refreshDestination();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  expect(h.port.subscribeResearch).toHaveBeenCalledOnce();
  expect(h.controller.composer.snapshot().text).toBe("Draft with unresolved identity");
  h.controller.dispose();
});

it("does not accept a late ready result after the subscription has reported failure", async () => {
  const h = controllerHarness(false);
  let receive!: (notice: Outcome<ResearchEvent>) => void;
  let resolve!: (notice: Outcome<{ subscriptionId: string }>) => void;
  const dispose = vi.fn();
  vi.mocked(h.port.subscribeResearch).mockImplementationOnce((_scope, listener) => {
    receive = listener;
    return {
      ready: new Promise((done) => {
        resolve = done;
      }),
      dispose,
    };
  });
  h.controller.open(scope);
  receive(failure("service_unavailable"));
  expect(dispose).toHaveBeenCalledOnce();
  resolve({ ok: true, value: { subscriptionId: "late-retired-subscription" } });
  await settle();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("failed");
  expect(h.port.readDestination).not.toHaveBeenCalled();
  await h.controller.composer.refreshDestination();
  await settle();
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  h.controller.dispose();
});
it("does not let a retiring observer failure invalidate a reentrantly reopened scope", async () => {
  const h = controllerHarness();
  await settle();
  let reopened = false;
  const release = h.controller.observe((notice) => {
    if (notice !== "ready" && !notice.ok && !reopened) {
      reopened = true;
      h.controller.reload();
    }
  });
  h.emit(failure("service_unavailable"));
  await settle();
  expect(reopened).toBe(true);
  expect(h.controller.snapshot().status).toBe("ready");
  expect(h.controller.composer.snapshot().destinationStatus).toBe("ready");
  release();
  h.controller.dispose();
});

describe("task notices", () => {
  const task = (change: Partial<TimelineTask> = {}): TimelineTask => ({
    kind: "task",
    id: id(991),
    position: 2,
    rank: 3,
    revision: 1,
    agentId: "virgilio",
    language: "en",
    state: "failed",
    connection: "chatgpt",
    blockingReason: null,
    outcomeReason: "empty_reply",
    replyMessageId: null,
    waitingForModels: false,
    waitingLimit: 3,
    dispatched: true,
    superseded: false,
    maxAttemptDurationMs: 600_000,
    maxInactivityMs: 120_000,
    ...change,
  });
  const connection = {
    ...chatgptConnection,
    id: "fake",
    displayName: "Synthetic service",
    kind: "api_key" as const,
  };
  async function show(
    t: TimelineTask,
    extra = {},
    perform = vi.fn(async () => ({ ok: true as const, value: { resultId: id(999) } })),
  ) {
    await act(async () =>
      root.render(
        h(TaskNotice, {
          task: t,
          locale: "en-US",
          connection,
          hasText: false,
          latest: true,

          pauses: { revision: 1, restart: 7, usage: [{ connection: "chatgpt", count: 12 }] },
          controller: { performTaskAction: perform },
          commands: { openLink: async () => true },
          ...extra,
        }),
      ),
    );
    return perform;
  }
  it.each([
    ["provider_unavailable", "Synthetic service isn’t available right now."],
    ["provider_error", "Synthetic service reported an error."],
    ["request_rejected", "Synthetic service rejected the request."],
    ["invalid_output", "Ohtia couldn’t read Synthetic service’s reply."],
    ["empty_reply", "Virgilio sent an empty reply."],
    ["output_limit_exceeded", "The reply was longer than Ohtia allows."],
    ["deadline_exceeded", "The reply took longer than 10 min."],
    ["inactivity_timeout", "Synthetic service stopped sending text for 2 min."],
    ["service_restarted", "This reply couldn’t start: both attempts ended before it was sent."],
    ["permit_expired", "This reply couldn’t start: both attempts ended before it was sent."],
  ])("renders controlled failure %s with its icon and external actions", async (reason, text) => {
    await show(task({ outcomeReason: reason }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(text);
    expect(container.querySelector(".conversation-notice.danger svg")).not.toBeNull();
    expect(container.querySelector('[role="alert"] button')).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Try again");
  });
  it.each(["de-DE", "ko-KR", "en-US"] as InterfaceLocale[])(
    "renders every terminal reason and connection kind in %s",
    (locale) => {
      for (const kind of ["subscription", "api_key"] as const)
        for (const reason of [
          "usage_limit_reached",
          "not_eligible",
          "connection_expired",
          "provider_unavailable",
          "provider_error",
          "request_rejected",
          "invalid_output",
          "empty_reply",
          "output_limit_exceeded",
          "deadline_exceeded",
          "inactivity_timeout",
          "service_restarted",
          "permit_expired",
        ]) {
          expect(
            taskNoticeContent(
              task({ outcomeReason: reason }),
              locale,
              { ...connection, kind },
              false,
              undefined,
            )?.text.length,
          ).toBeGreaterThan(5);
        }
    },
  );
  it("keeps stopped partial text's single notice, hides coalesced tasks and labels before-dispatch cancellation", async () => {
    await show(task({ state: "cancelled", outcomeReason: "cancelled_by_researcher" }), {
      hasText: true,
    });
    expect(container.querySelectorAll(".conversation-notice")).toHaveLength(1);
    expect(container.querySelector(".conversation-notice")?.textContent).toContain(
      "Incomplete — stopped by you",
    );
    expect(container.querySelector(".voice-label")).toBeNull();
    expect(container.querySelector(".task-usage")?.textContent).toContain("full usage is unknown");
    await show(task({ state: "cancelled", dispatched: false }));
    expect(container.textContent).toContain("Stopped before it was sent.");
    expect(container.querySelector(".task-usage")).toBeNull();
    await show(task({ state: "cancelled", superseded: true }));
    expect(container.textContent).toBe("");
  });
  it("reports invalid partial output and the general or connection waiting limit", () => {
    expect(
      taskNoticeContent(
        task({ outcomeReason: "invalid_output" }),
        "en-US",
        connection,
        true,
        undefined,
      )?.text,
    ).toBe("Incomplete — Ohtia couldn’t read the rest of the reply");
    expect(
      taskNoticeContent(
        task({ state: "queued", waitingLimit: 10 }),
        "en-US",
        chatgptConnection,
        false,
        undefined,
      )?.text,
    ).toContain("10 replies");
    expect(
      taskNoticeContent(task({ state: "queued" }), "en-US", chatgptConnection, false, undefined)
        ?.text,
    ).toContain("3 replies");
    expect(
      taskNoticeContent(task({ state: "queued" }), "en-US", connection, false, "Josefa")?.text,
    ).toContain("Josefa");
  });
  it("shows buttons only for the latest usage failure and keeps Check usage outside", async () => {
    await show(task({ outcomeReason: "usage_limit_reached" }));
    expect(
      [...container.querySelectorAll(".task-notice-actions button")].map((b) => b.textContent),
    ).toEqual(["Resume Synthetic service requests (12)", "Try again"]);
    expect(container.querySelector('a [role="img"]')?.getAttribute("aria-label")).toBe(
      "opens in your browser",
    );
    await show(task({ outcomeReason: "usage_limit_reached" }), { latest: false });
    expect(container.querySelectorAll(".task-notice-actions button")).toHaveLength(0);
    expect(container.querySelector("a")).not.toBeNull();
    expect(container.querySelector(".conversation-notice a")).toBeNull();
  });
  it.each(["resume", "continue", "retry", "restart"] as const)(
    "replays an unconfirmed %s with the same identity and guards double clicks",
    async (action) => {
      let resolve!: (value: Outcome<{ resultId: string }>) => void;
      const perform = vi.fn(
        () =>
          new Promise<Outcome<{ resultId: string }>>((r) => {
            resolve = r;
          }),
      );
      const t =
        action === "resume"
          ? task({ state: "blocked", blockingReason: "usage_limit_reached" })
          : action === "continue"
            ? task({ state: "blocked", blockingReason: "restart_paused" })
            : action === "restart"
              ? task({ state: "uncertain" })
              : task();
      await show(t, {}, perform);
      let button = container.querySelector<HTMLButtonElement>(".task-notice-actions button")!;
      await act(async () => {
        button.click();
        button.click();
      });
      if (action === "restart") {
        expect(container.querySelector("dialog [data-close]")).toBe(document.activeElement);
        await act(async () =>
          container.querySelector<HTMLButtonElement>("dialog .primitive-primary")!.click(),
        );
      }
      expect(perform).toHaveBeenCalledTimes(1);
      expect(container.querySelector(".conversation-notice")).not.toBeNull();
      await act(async () => resolve(failure("uncertain")));
      expect(container.textContent).toContain("Use the button again to check");
      button = container.querySelector<HTMLButtonElement>(".task-notice-actions button")!;
      await act(async () => button.click());
      expect(perform).toHaveBeenCalledTimes(2);
      expect(perform.mock.calls[1]?.[0]).toBe(perform.mock.calls[0]?.[0]);
      await act(async () => resolve({ ok: true, value: { resultId: id(999) } }));
    },
  );
  it.each([
    "newer_task_exists",
    "pending_limit_reached",
    "storage_failed",
    "timeout",
    "cancelled",
    "disposed",
    "invalid_service_result",
  ] as const)("announces the %s action result", async (code) => {
    const perform = vi.fn(async () => failure(code));
    await show(task(), {}, perform);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(
      container.querySelectorAll(code === "storage_failed" ? '[role="alert"]' : '[role="status"]'),
    ).not.toHaveLength(0);
    expect(container.textContent).toContain(
      code === "newer_task_exists"
        ? "A newer reply"
        : code === "pending_limit_reached"
          ? "Too many replies"
          : code === "storage_failed"
            ? "Nothing changed"
            : "won’t run twice",
    );
  });
  it("positions a textless failed task before messages written while it ran", async () => {
    const t = task();
    await render({
      ...state([message(1), t, message(3)]),
      conversation: { ...summary, latestReplyTaskId: t.id },
    });
    const entries = [...container.querySelectorAll("[data-timeline-id]")];
    expect(entries.map((e) => e.getAttribute("data-timeline-id"))).toEqual([id(1), t.id, id(3)]);
    expect(entries[1]?.textContent).toContain("Virgilio sent an empty reply");
  });
});

it("rereads global pause counts on a new revision and after a sequence gap", async () => {
  const h = controllerHarness();
  await settle();
  expect(h.port.readPauses).toHaveBeenCalledTimes(1);
  h.emit({ ok: true, value: { kind: "pauseCounts", revision: 1 } });
  await settle();
  expect(h.port.readPauses).toHaveBeenCalledTimes(1);
  vi.mocked(h.port.readPauses).mockReturnValueOnce(ok({ revision: 2, restart: 4, usage: [] }));
  h.emit({ ok: true, value: { kind: "pauseCounts", revision: 2 } });
  await settle();
  expect(h.controller.snapshot().pauses?.restart).toBe(4);
  h.emit({ ok: true, value: { kind: "pauseCounts", revision: 1 } });
  await settle();
  expect(h.port.readPauses).toHaveBeenCalledTimes(2);
  h.emit(failure("sequence_gap"));
  await settle();
  expect(h.port.readPauses).toHaveBeenCalledTimes(3);
  h.controller.dispose();
});
it("recovers a held task's saved partial reply above the latest page after a gap", async () => {
  const h = controllerHarness(false);
  const t: TimelineTask = {
    id: id(500),
    kind: "task",
    position: 120,
    rank: 3,
    revision: 1,
    agentId: "virgilio",
    language: "en",
    state: "running",
    connection: "chatgpt",
    blockingReason: null,
    outcomeReason: null,
    replyMessageId: null,
    waitingForModels: false,
    waitingLimit: 3,
    dispatched: true,
    superseded: false,
    maxAttemptDurationMs: 600_000,
    maxInactivityMs: 120_000,
  };
  h.items.push(t);
  h.controller.open(scope);
  await settle();
  expect(h.controller.snapshot().items.some((item) => item.id === t.id)).toBe(true);
  const saved: TimelineItem = {
    ...message(600, "Saved partial after a gap"),
    position: 120,
    authorKind: "agent",
    agentId: "virgilio",
    taskId: t.id,
    ending: "partial",
  };
  h.items[h.items.indexOf(t)] = {
    ...t,
    state: "failed",
    revision: 2,
    outcomeReason: "provider_error",
    replyMessageId: saved.id,
  };
  h.items.push(saved, ...Array.from({ length: 80 }, (_, n) => message(n + 121)));
  h.emit(failure("sequence_gap"));
  await settle();
  await settle();
  expect(h.controller.snapshot().texts.get(saved.id)).toBe("Saved partial after a gap");
  expect(h.controller.snapshot().items.find((item) => item.id === t.id)).toMatchObject({
    state: "failed",
  });
  h.controller.dispose();
});

it("renders status and partial notices without relying on color", async () => {
  const base: TimelineTask = {
    id: id(900),
    kind: "task",
    position: 2,
    rank: 3,
    revision: 1,
    agentId: "virgilio",
    language: "en",
    connection: "chatgpt",
    state: "running",
    blockingReason: null,
    outcomeReason: null,
    replyMessageId: null,
    waitingForModels: false,
    waitingLimit: 3,
    dispatched: true,
    superseded: false,
    maxAttemptDurationMs: 600_000,
    maxInactivityMs: 120_000,
  };
  for (const [change, text] of [
    [{ state: "running" }, "Sent to ChatGPT. Waiting for the reply."],
    [
      { state: "blocked", blockingReason: "connection_disabled" },
      "ChatGPT isn’t connected. Virgilio will reply when you connect.",
    ],
    [
      { state: "blocked", blockingReason: "restart_paused" },
      "Ohtia stopped before this reply started.",
    ],
    [{ state: "cancelling" }, "Stopping…"],
    [{ state: "cancelled" }, "Stopped."],
    [{ state: "failed", outcomeReason: "deadline_exceeded" }, "Incomplete — time limit reached"],
    [
      { state: "failed", outcomeReason: "inactivity_timeout" },
      "Incomplete — no activity for 2 min",
    ],
    [
      { state: "failed", outcomeReason: "output_limit_exceeded" },
      "Incomplete — longer than Ohtia allows",
    ],
    [
      { state: "failed", outcomeReason: "provider_unavailable" },
      "Incomplete — ChatGPT reported an error",
    ],
    [{ state: "failed", outcomeReason: "connection_lost" }, "Incomplete — connection lost"],
  ] as const) {
    const task = { ...base, ...change };
    const hasText = task.state === "failed";
    await act(async () =>
      root.render(
        h(TaskNotice, {
          task,
          locale: "en-US",
          connection: chatgptConnection,
          hasText,
          latest: false,

          controller: { performTaskAction: async () => failure("storage_failed") },
          commands: { openLink: async () => true },
        }),
      ),
    );
    expect(container.querySelector(".conversation-notice.status")?.textContent).toContain(text);
    expect(container.querySelector(".conversation-notice.status svg")).not.toBeNull();
    if (hasText) expect(container.querySelector(".voice-label")).toBeNull();
  }
  expect(
    taskNoticeContent(
      { ...base, state: "completed" },
      "en-US",
      chatgptConnection,
      false,
      undefined,
    ),
  ).toBeNull();
  expect(taskNoticeContent(base, "en-US", chatgptConnection, true, undefined)).toBeNull();
});

it.each(["resume", "continue", "retry", "restart"] as const)(
  "binds %s to its port command and reconciles a confirmed action without replaying it",
  async (action) => {
    const h = controllerHarness();
    await settle();
    const run = vi.fn(() => ok({ resultId: id(700) }));
    Object.assign(h.port, {
      resumeUsagePause: run,
      continueAllTasks: run,
      tryAgainTask: run,
      startAgainTask: run,
    });
    const reload = vi.spyOn(h.controller, "reload").mockImplementation(() => {});
    vi.mocked(h.port.readPauses).mockClear();
    const task = { id: id(701), connection: "chatgpt" } as TimelineTask;
    expect(await h.controller.performTaskAction("stable-operation", action, task)).toEqual({
      ok: true,
      value: { resultId: id(700) },
    });
    expect(run).toHaveBeenCalledWith(
      "stable-operation",
      ...(action === "continue"
        ? []
        : [action === "resume" ? { connection: "chatgpt" } : { taskId: task.id }]),
    );
    expect(h.port.readPauses).toHaveBeenCalledTimes(
      action === "resume" || action === "continue" ? 1 : 0,
    );
    expect(reload).toHaveBeenCalledOnce();
    run.mockImplementationOnce(() => {
      throw new Error("Synthetic transport closure");
    });
    expect(await h.controller.performTaskAction("same-operation", action, task)).toEqual(
      failure("invalid_service_result"),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    h.controller.dispose();
  },
);
it("preserves a saved action when its independent pause reread fails", async () => {
  const h = controllerHarness();
  await settle();
  const resume = vi.fn(() => ok({ resultId: id(700) }));
  Object.assign(h.port, { resumeUsagePause: resume });
  vi.mocked(h.port.readPauses).mockReturnValueOnce(call(failure("storage_failed")));
  vi.spyOn(h.controller, "reload").mockImplementation(() => {});
  expect(
    await h.controller.performTaskAction("saved-resume", "resume", {
      id: id(701),
      connection: "chatgpt",
    } as TimelineTask),
  ).toEqual({ ok: true, value: { resultId: id(700) } });
  expect(resume).toHaveBeenCalledOnce();
  expect(h.controller.snapshot().status).toBe("failed");
  h.controller.dispose();
});
it("rereads queued model readiness after a connection event even at the same durable task revision", async () => {
  const h = controllerHarness(false);
  const t: TimelineTask = {
    id: id(700),
    kind: "task",
    position: 120,
    rank: 3,
    revision: 1,
    state: "queued",
    agentId: "virgilio",
    language: "en",
    connection: "chatgpt",
    blockingReason: null,
    outcomeReason: null,
    replyMessageId: null,
    waitingForModels: true,
    waitingLimit: null,
    dispatched: false,
    superseded: false,
    maxAttemptDurationMs: 600_000,
    maxInactivityMs: 120_000,
  };
  h.items.push(t);
  h.controller.open(scope);
  await settle();
  expect(taskNoticeContent(t, "en-US", chatgptConnection, false, undefined)?.text).toBe(
    "Updating ChatGPT’s model list before starting the reply.",
  );
  h.items[h.items.indexOf(t)] = { ...t, waitingForModels: false };
  h.emit({ ok: true, value: { kind: "destinationChanged", connection: "chatgpt" } });
  await settle();
  expect(h.controller.snapshot().items.find((item) => item.id === t.id)).toMatchObject({
    revision: 1,
    state: "queued",
    waitingForModels: false,
    waitingLimit: null,
  });
  h.controller.dispose();
});

function reviewTask(change: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: id(700),
    kind: "task",
    rank: 3,
    position: 120,
    revision: 1,
    agentId: "virgilio",
    language: "en",
    state: "failed",
    connection: "chatgpt",
    blockingReason: null,
    outcomeReason: "provider_error",
    replyMessageId: null,
    waitingForModels: false,
    waitingLimit: null,
    dispatched: true,
    superseded: false,
    maxAttemptDurationMs: 600_000,
    maxInactivityMs: 120_000,
    ...change,
  };
}
it.each(["not_eligible", "connection_expired", "request_rejected"])(
  "preserves the actual %s explanation after partial output",
  async (outcomeReason) => {
    const t = reviewTask({ outcomeReason });
    const content = taskNoticeContent(t, "en-US", chatgptConnection, true, undefined)!;
    expect(content).toMatchObject({ role: "alert", tone: "danger" });
    expect(content.text).not.toContain("connection lost");
    await act(async () =>
      root.render(
        h(TaskNotice, {
          task: t,
          locale: "en-US",
          connection: chatgptConnection,
          hasText: true,
          latest: true,

          controller: { performTaskAction: async () => failure("storage_failed") },
          commands: { openLink: async () => true },
        }),
      ),
    );
    expect(container.querySelector(".voice-label")).toBeNull();
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    if (outcomeReason !== "request_rejected") expect(buttons).toContain("Open Connections");
    expect(buttons.includes("Try again")).toBe(outcomeReason !== "not_eligible");
  },
);
it("uses a confirmed saturated limit and a generic status while queued with capacity", () => {
  expect(
    taskNoticeContent(
      reviewTask({ state: "queued", waitingLimit: null }),
      "en-US",
      chatgptConnection,
      false,
      undefined,
    )?.text,
  ).toBe("Waiting to start.");
  expect(
    taskNoticeContent(
      reviewTask({ state: "queued", waitingLimit: 3 }),
      "en-US",
      chatgptConnection,
      false,
      undefined,
    )?.text,
  ).toContain("3 replies");
});
it("ignores an older pause read that resolves after a newer one, and accepts a new observation epoch", async () => {
  const h = controllerHarness();
  await settle();
  let older!: (x: any) => void, newer!: (x: any) => void;
  vi.mocked(h.port.readPauses)
    .mockReturnValueOnce({ result: new Promise((resolve) => (older = resolve)), cancel() {} })
    .mockReturnValueOnce({ result: new Promise((resolve) => (newer = resolve)), cancel() {} });
  const a = h.controller.refreshPauses(),
    b = h.controller.refreshPauses();
  newer({
    ok: true,
    value: { revision: 3, restart: 2, usage: [{ connection: "chatgpt", count: 4 }] },
  });
  await b;
  older({ ok: true, value: { revision: 2, restart: 0, usage: [] } });
  await a;
  expect(h.controller.snapshot().pauses).toMatchObject({ revision: 3, restart: 2 });
  vi.mocked(h.port.readPauses).mockReturnValue(ok({ revision: 1, restart: 0, usage: [] }));
  h.controller.open(scope);
  await settle();
  expect(h.controller.snapshot().pauses?.revision).toBe(1);
  h.controller.dispose();
});
it("knows the conversation's running task even when its reserved position is outside the loaded history", async () => {
  const h = controllerHarness(false);
  const active = reviewTask({ id: id(701), state: "running", position: 1 }),
    queued = reviewTask({ id: id(702), state: "queued", outcomeReason: null });
  h.items.push(active, queued);
  h.items.sort((a, b) => a.position - b.position || a.rank - b.rank);
  vi.mocked(h.port.readConversations).mockReturnValue(
    ok({
      items: [
        {
          ...summary,
          latestReplyTaskId: queued.id,
          runningTask: { id: active.id, agentId: "virgilio", state: "running" },
        },
      ],
      remaining: [],
    }),
  );
  h.controller.open(scope);
  await settle();
  expect(h.controller.snapshot().items.some((t) => t.id === active.id)).toBe(false);
  await render(h.controller.snapshot(), h.controller);
  expect(container.querySelector(".conversation-notice")?.textContent).toBe(
    "Waiting for Virgilio to finish the current reply.",
  );
  vi.mocked(h.port.readConversations).mockReturnValue(
    ok({
      items: [
        {
          ...summary,
          revision: 2,
          latestReplyTaskId: queued.id,
          runningTask: { id: active.id, agentId: "virgilio", state: "cancelling" },
        },
      ],
      remaining: [],
    }),
  );
  await act(async () => {
    h.emit({
      ok: true,
      value: { kind: "changed", record: "conversation", id: scope.conversationId, revision: 2 },
    });
    await settle();
  });
  expect(h.controller.composer.snapshot().cancelling).toBe(true);
  h.controller.dispose();
});
it("announces a live notice transition once and stays silent for historical reads, navigation and locale changes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const harness = controllerHarness(false);
  const initial = reviewTask();
  harness.items.push(initial);
  harness.controller.open(scope);
  await settle();
  await render(harness.controller.snapshot(), harness.controller);
  const announced = () =>
    [...container.querySelectorAll("[data-task-notice-announcement]")]
      .map((n) => n.textContent)
      .filter(Boolean);
  expect(announced()).toEqual([]);
  harness.items[harness.items.indexOf(initial)] = {
    ...initial,
    revision: 2,
    outcomeReason: "connection_expired",
  };
  await act(async () => {
    harness.emit({
      ok: true,
      value: { kind: "changed", record: "timeline", id: initial.id, revision: 2 },
    });
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  expect(announced()).toEqual([
    "Your ChatGPT session expired. Sign in again in Settings › Connections.",
  ]);
  harness.items[harness.items.findIndex((item) => item.id === initial.id)] = {
    ...initial,
    revision: 3,
    outcomeReason: "provider_error",
  };
  harness.items.push(
    reviewTask({ id: id(701), position: 121, state: "queued", outcomeReason: null }),
  );
  await act(async () => {
    harness.emit(failure("sequence_gap"));
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  expect(announced()).toEqual(["ChatGPT reported an error.", "Waiting to start."]);
  await act(async () =>
    root.render(
      h(ConversationView, {
        state: harness.controller.snapshot(),
        controller: harness.controller,
        locale: "de-DE",
        commands: { copyMessage: async () => true, openExternalLink: async () => true },
      }),
    ),
  );
  expect(announced()).toEqual([]);
  await act(async () => {
    harness.controller.open({ projectId: null, conversationId: null });
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  await act(async () => {
    harness.controller.open(scope);
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  expect(announced()).toEqual([]);
  harness.controller.dispose();
});
it.each(["ready", "loading"] as const)(
  "returns focus to the persistent chat reading region when an action disappears in %s state",
  async (status) => {
    const t = reviewTask();
    const initial = { ...state([t]), conversation: { ...summary, latestReplyTaskId: t.id } };
    await render(initial);
    const button = container.querySelector<HTMLButtonElement>(".task-notice-actions button")!;
    await act(async () => button.focus());
    await render({ ...initial, status, conversation: { ...summary, latestReplyTaskId: id(701) } });
    expect(document.activeElement).toBe(
      container.querySelector(
        status === "ready" ? ".conversation-timeline" : ".conversation-status-scroll",
      ),
    );
  },
);
it("requires a new duplicate-charge confirmation after a definitive pending-limit rejection", async () => {
  const perform = vi.fn(async () => failure("pending_limit_reached"));
  await act(async () =>
    root.render(
      h(TaskNotice, {
        task: reviewTask({ state: "uncertain" }),
        locale: "en-US",
        connection: chatgptConnection,
        hasText: false,
        latest: true,

        controller: { performTaskAction: perform },
        commands: { openLink: async () => true },
      }),
    ),
  );
  const press = async () =>
    act(async () =>
      container.querySelector<HTMLButtonElement>(".task-notice-actions button")!.click(),
    );
  await press();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("dialog .primitive-primary")!.click(),
  );
  expect(perform).toHaveBeenCalledOnce();
  const first = perform.mock.calls[0]?.[0];
  await press();
  expect(container.querySelector("dialog[open]")).not.toBeNull();
  expect(perform).toHaveBeenCalledOnce();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("dialog .primitive-primary")!.click(),
  );
  expect(perform).toHaveBeenCalledTimes(2);
  expect(perform.mock.calls[1]?.[0]).not.toBe(first);
});

it.each(["retry", "restart"] as const)(
  "announces the %s replacement first discovered in the acting window's new baseline",
  async (action) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const harness = controllerHarness(false);
    const original = reviewTask({ state: action === "retry" ? "failed" : "uncertain" });
    harness.items.push(original);
    let latest = original.id;
    vi.mocked(harness.port.readConversations).mockImplementation(() =>
      ok({ items: [{ ...summary, latestReplyTaskId: latest }], remaining: [] }),
    );
    vi.mocked(harness.port.readReplyParts).mockImplementation(() =>
      ok({ parts: [], latestSequence: 0 }),
    );
    const invoke = vi.fn(() => {
      const replacement = reviewTask({
        id: id(701),
        position: 121,
        revision: 2,
        state: "running",
        outcomeReason: null,
      });
      harness.items.push(replacement);
      latest = replacement.id;
      return ok({ resultId: replacement.id });
    });
    Object.assign(harness.port, { tryAgainTask: invoke, startAgainTask: invoke });
    harness.controller.open(scope);
    await settle();
    await render(harness.controller.snapshot(), harness.controller);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".task-notice-actions button")!.click(),
    );
    if (action === "restart")
      await act(async () =>
        container.querySelector<HTMLButtonElement>("dialog .primitive-primary")!.click(),
      );
    await settle();
    await render(harness.controller.snapshot(), harness.controller);
    expect(invoke).toHaveBeenCalledOnce();
    expect(
      [...container.querySelectorAll("[data-task-notice-announcement]")]
        .map((e) => e.textContent)
        .filter(Boolean),
    ).toEqual(["Sent to ChatGPT. Waiting for the reply."]);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(
      [...container.querySelectorAll("[data-task-notice-announcement]")].some((e) => e.textContent),
    ).toBe(false);
    harness.controller.dispose();
  },
);
it("expires announcement copies despite rerenders and clears stale-language text while retaining the visible notice", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const t = reviewTask();
  const show = async (task: TimelineTask, locale: InterfaceLocale) =>
    act(async () =>
      root.render(
        h(TaskNotice, {
          task,
          locale,
          connection: chatgptConnection,
          hasText: false,
          latest: false,
          announce: () => true,
          controller: { performTaskAction: async () => failure("storage_failed") },
          commands: { openLink: async () => true },
        }),
      ),
    );
  const spoken = () =>
    [...container.querySelectorAll<HTMLElement>("[data-task-notice-announcement]")].filter(
      (e) => e.textContent,
    );
  await show(t, "en-US");
  expect(spoken()).toHaveLength(1);
  expect(spoken()[0]?.lang).toBe("en-US");
  expect(container.querySelector(".conversation-notice")?.getAttribute("aria-hidden")).toBe("true");
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await show(t, "en-US");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(spoken()).toHaveLength(0);
  expect(container.querySelector(".conversation-notice")?.hasAttribute("aria-hidden")).toBe(false);
  expect(container.querySelector(".conversation-notice")?.textContent).toBe(
    "ChatGPT reported an error.",
  );
  const expired = { ...t, revision: 2, outcomeReason: "connection_expired" };
  await show(expired, "en-US");
  expect(spoken()).toHaveLength(1);
  await show(expired, "de-DE");
  expect(spoken()).toHaveLength(0);
  expect(container.querySelector(".conversation-notice")?.hasAttribute("aria-hidden")).toBe(false);
  await show({ ...expired, revision: 3, outcomeReason: "invalid_output" }, "de-DE");
  expect(spoken()[0]?.lang).toBe("de-DE");
  await act(async () => root.render(h("div")));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["outside the newest page", "already completed"] as const)(
  "recovers the explicitly introduced retry when it is %s",
  async (phase) => {
    const harness = controllerHarness(false);
    const original = reviewTask();
    harness.items.push(original);
    harness.controller.open(scope);
    await settle();
    const replacement = reviewTask({
      id: id(701),
      position: phase === "outside the newest page" ? 1 : 121,
      state: phase === "already completed" ? "completed" : "queued",
      outcomeReason: null,
      replyMessageId: phase === "already completed" ? id(702) : null,
    });
    Object.assign(harness.port, {
      tryAgainTask: () => {
        harness.items.push(replacement);
        if (phase === "already completed")
          harness.items.push({
            ...message(702, "Finished before the new baseline"),
            position: 121,
            authorKind: "agent",
            agentId: "virgilio",
            taskId: replacement.id,
            ending: "complete",
          } as TimelineItem);
        harness.items.sort((a, b) => a.position - b.position || a.rank - b.rank);
        return ok({ resultId: replacement.id });
      },
    });
    await harness.controller.performTaskAction("retry-introduction", "retry", original);
    await settle();
    expect(harness.controller.snapshot().items).toContainEqual(replacement);
    if (phase === "already completed") {
      expect(harness.controller.snapshot().completed).toBe(1);
      expect(harness.controller.snapshot().texts.get(id(702))).toBe(
        "Finished before the new baseline",
      );
    } else {
      expect(harness.port.readTimeline).toHaveBeenCalledWith({
        conversationId: scope.conversationId,
        ids: [replacement.id],
      });
      expect(
        harness.controller.claimTaskNotice(replacement.id, replacement.revision, "queued"),
      ).toBe(true);
      expect(
        harness.controller.claimTaskNotice(replacement.id, replacement.revision, "queued"),
      ).toBe(false);
    }
    harness.controller.reload();
    await settle();
    expect(harness.controller.snapshot().completed).toBe(phase === "already completed" ? 1 : 0);
    harness.controller.dispose();
  },
);

it("keeps history silent when a gap interrupts the baseline on return, then announces a later established gap", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const harness = controllerHarness(false);
  harness.controller.open(scope);
  await settle();
  await render(harness.controller.snapshot(), harness.controller);
  await act(async () => {
    harness.controller.open({ projectId: null, conversationId: null });
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  harness.items.push(
    reviewTask({ id: id(701), position: 121, state: "queued", outcomeReason: null }),
  );
  harness.items.push({
    ...message(702, "Finished while this conversation was closed"),
    position: 122,
    authorKind: "agent",
    agentId: "virgilio",
    taskId: id(703),
    ending: "complete",
  } as TimelineItem);
  let release!: (value: unknown) => void;
  vi.mocked(harness.port.readConversations).mockReturnValueOnce({
    result: new Promise((resolve) => {
      release = resolve;
    }),
    cancel() {},
  } as any);
  await act(async () => {
    harness.controller.open(scope);
    await settle();
  });
  expect(release).toBeTypeOf("function");
  await act(async () => {
    harness.emit(failure("sequence_gap"));
    release({ ok: true, value: { items: [summary], remaining: [] } });
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  const spoken = () =>
    [...container.querySelectorAll("[data-task-notice-announcement]")]
      .map((n) => n.textContent)
      .filter(Boolean);
  expect(harness.controller.snapshot().status).toBe("ready");
  expect(harness.controller.snapshot().completed).toBe(0);
  expect(spoken()).toEqual([]);
  harness.items.push(
    reviewTask({ id: id(704), position: 123, state: "queued", outcomeReason: null }),
  );
  await act(async () => {
    harness.emit(failure("sequence_gap"));
    await settle();
  });
  await render(harness.controller.snapshot(), harness.controller);
  expect(spoken()).toEqual(["Waiting to start."]);
  harness.controller.dispose();
});

it("does not misattribute setup proposals as agent messages before the setup-card flow", async () => {
  const proposal: TimelineItem = {
    kind: "setupProposal",
    id: id(90),
    position: 2,
    rank: 2,
    revision: 1,
    taskId: id(91),
    title: "Synthetic proposal",
    documentLanguage: "en",
    state: "proposed",
    invalidReason: null,
  };
  await render(state([message(1, "Researcher's setup request"), proposal]));
  expect(container.querySelectorAll(".conversation-message")).toHaveLength(1);
  expect(container.querySelector('.conversation-message[aria-label="Virgilio"]')).toBeNull();
  expect(container.textContent).not.toContain("Synthetic proposal");
});

it.each([
  ["historical failed setup", null, "failed", null],
  ["historical uncertain setup", null, "uncertain", null],
  ["failed guidance", "en", "failed", "Try again"],
  ["uncertain guidance", "en", "uncertain", "Start reply again"],
] as const)(
  "shows the appropriate recovery for the %s reply after confirmation",
  async (_scenario, language, phase, action) => {
    const task = reviewTask({ state: phase, language });
    const performTaskAction = vi.fn(async () => ({
      ok: true as const,
      value: { resultId: id(999) },
    }));
    await render(
      {
        ...state([task]),
        project: {
          id: scope.projectId,
          projectType: "thesis",
          title: "Synthetic confirmed thesis",
          documentLanguage: "en",
          isDevelopment: false,
          setupConfirmedAt: "2026-11-17T10:00:00Z",
          lastOpenedAt: "2026-11-17T10:00:00.000Z",
          createdAt: "2026-11-17T10:00:00Z",
          updatedAt: "2026-11-17T10:00:00Z",
        },
        conversation: { ...summary, latestReplyTaskId: task.id },
      },
      { performTaskAction } as unknown as ConversationController,
    );
    expect(container.textContent).toContain(
      phase === "failed" ? "reported an error" : "lost contact",
    );
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(".task-notice-actions button"),
    ];
    expect(buttons.map((button) => button.textContent)).toEqual(action ? [action] : []);
    if (action === null) return;

    await act(async () => buttons[0]!.click());
    if (phase === "uncertain") {
      expect(performTaskAction).not.toHaveBeenCalled();
      expect(container.querySelector("dialog[open]")).not.toBeNull();
      await act(async () =>
        container.querySelector<HTMLButtonElement>("dialog .primitive-primary")!.click(),
      );
    }
    expect(performTaskAction).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      phase === "failed" ? "retry" : "restart",
      task,
    );
  },
);

it.each([true, false])(
  "retains global usage resumption after confirmation only on the latest failed setup notice (latest: %s)",
  async (latest) => {
    const task = reviewTask({ outcomeReason: "usage_limit_reached" }),
      perform = vi.fn(async () => ({ ok: true as const, value: { resultId: id(999) } }));
    await act(async () =>
      root.render(
        h(TaskNotice, {
          task,
          locale: "en-US",
          connection: chatgptConnection,
          hasText: false,
          latest,
          setupFinal: true,
          pauses: { revision: 1, restart: 0, usage: [{ connection: "chatgpt", count: 2 }] },
          controller: { performTaskAction: perform },
          commands: { openLink: async () => true },
        }),
      ),
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(
      latest ? ["Resume ChatGPT requests (2)"] : [],
    );
    expect(container.textContent).not.toContain("Try again");
    if (latest) {
      await act(async () => buttons[0]!.click());
      expect(perform).toHaveBeenCalledWith(expect.any(String), "resume", task);
    }
  },
);

it("preserves origin drafts across project A to B to A with delayed reads", async () => {
  const h = controllerHarness();
  await settle();
  h.controller.composer.edit("Unsent A 연구");
  const aItems = h.controller.snapshot().items.map((item) => item.id);
  const pending = deferred<Outcome<ResearchOutputs["conversation.read"]>>();
  vi.mocked(h.port.readConversations).mockImplementationOnce(() => ({
    result: pending.promise,
    cancel: vi.fn(),
  }));
  h.controller.open({ projectId: id(1001), conversationId: id(3000) });
  await settle();
  h.controller.composer.edit("Unsent B");
  h.controller.open(scope);
  await settle();
  expect(h.controller.composer.snapshot().text).toBe("Unsent A 연구");
  pending.resolve({
    ok: true,
    value: { items: [{ ...summary, projectId: id(1001), id: id(3000) }], remaining: [] },
  });
  await settle();
  expect(h.controller.snapshot().scope).toEqual(scope);
  expect(h.controller.snapshot().items.map((item) => item.id)).toEqual(aItems);
  expect(h.controller.composer.snapshot().text).toBe("Unsent A 연구");
  vi.mocked(h.port.readConversations).mockImplementation(() =>
    ok({ items: [{ ...summary, projectId: id(1001), id: id(3000) }], remaining: [] }),
  );
  h.controller.open({ projectId: id(1001), conversationId: id(3000) });
  await settle();
  expect(h.controller.composer.snapshot().text).toBe("Unsent B");
  h.controller.dispose();
});

describe("conversation history", () => {
  it("merges project events into the loaded range and recovers rows after a sequence gap", async () => {
    const h = controllerHarness();
    const rows = Array.from({ length: 106 }, (_, n) => ({
      ...summary,
      id: id(3000 + n),
      title: `Conversation ${n}`,
    }));
    const sorted = () => [...rows].sort((a, b) => compareConversations(b, a));
    const page = vi.fn<FoundationPort["listConversations"]>(({ cursor, count }) => {
      const eligible = sorted().filter((row) => !cursor || compareConversations(row, cursor) < 0);
      const items = eligible.slice(0, count);
      const last = items.at(-1);
      const next =
        eligible.length > items.length && last ? { latestAt: last.latestAt, id: last.id } : null;
      return ok({ items, next, hasMore: !!next });
    });
    h.port.listConversations = page;
    vi.mocked(h.port.readConversations).mockImplementation(({ ids }) =>
      ok({
        items: ids.flatMap((id) =>
          id === summary.id ? [summary] : rows.filter((row) => row.id === id),
        ),
        remaining: [],
      }),
    );
    await settle();
    expect(page).not.toHaveBeenCalled();
    h.controller.history.show();
    expect(h.controller.history.snapshot().status).toBe("loading");
    await settle();
    const snapshot = h.controller.history.snapshot;
    expect(snapshot().items).toHaveLength(50);
    const cursor = snapshot().next;
    const moved = rows[0]!;
    moved.latestAt = "2026-11-16T15:13:08.000Z";
    moved.revision++;
    h.emit({
      ok: true,
      value: { kind: "changed", record: "conversation", id: moved.id, revision: moved.revision },
    });
    await settle();
    expect(snapshot().items[0]?.id).toBe(moved.id);
    expect(snapshot().next).toEqual(cursor);
    page.mockReturnValueOnce(call(failure("storage_failed")));
    h.controller.history.loadOlder();
    await settle();
    expect(snapshot().failedOlder).toBe(true);
    expect(snapshot().next).toEqual(cursor);
    h.controller.history.loadOlder();
    await settle();
    h.controller.history.loadOlder();
    await settle();
    expect(snapshot().next).toBeNull();
    expect(snapshot().items.map((row) => row.id)).toEqual(sorted().map((row) => row.id));

    const unseen = { ...moved, id: id(3999), title: "Created elsewhere" };
    rows.push(unseen);
    vi.mocked(h.port.readConversations).mockClear();
    h.emit(failure("sequence_gap"));
    await vi.waitFor(() => expect(snapshot().items[0]?.id).toBe(unseen.id));
    expect(snapshot().items).toHaveLength(107);
    expect(page).toHaveBeenCalledWith({ projectId: scope.projectId, cursor: null, count: 50 });
    expect(h.port.readConversations).toHaveBeenCalledWith({
      projectId: scope.projectId,
      ids: expect.arrayContaining([moved.id]),
    });
    h.controller.dispose();
  });

  it("renders full accessible preview text, localized status and time at a selected row", async () => {
    const harness = controllerHarness();
    const history = harness.controller.history;
    const row = {
      ...summary,
      title: "Interviews",
      agentId: "josefa" as const,
      latestPrefix: "**Evidence** " + "한".repeat(123),
      latestTruncated: true,
      latestLanguage: "ko-KR",
      status: "attention" as const,
    };
    await act(async () =>
      root.render(
        h(ConversationHistory, {
          state: {
            projectId: scope.projectId,
            visible: true,
            status: "ready",
            items: [row],
            next: null,
            loadingOlder: false,
            failedOlder: false,
          },
          controller: history,
          current: row.id,
          locale: "de-DE",
          select: harness.controller.switchConversation,
        }),
      ),
    );
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-current")).toBe("true");
    expect(button?.querySelector(".chat-history-selection")).not.toBeNull();
    expect(button?.querySelector("[data-compact]")?.textContent).toBe("Josefa");
    expect(button?.querySelector("time")?.dateTime).toBe(row.latestAt);
    expect(button?.querySelector(".chat-history-preview")?.textContent).toBe(
      "Evidence " + "한".repeat(111) + "…",
    );
    expect(button?.querySelector(".chat-history-preview")?.getAttribute("lang")).toBe("ko-KR");
    expect(button?.querySelector(".chat-history-status")?.textContent).toBe(
      "Erfordert Ihre Aufmerksamkeit",
    );
    const now = new Date(2026, 10, 18, 14, 3);
    expect(historyTime(now.toISOString(), "en-US", now)).toBe("2:03 PM");
    expect(historyTime(new Date(2026, 10, 3).toISOString(), "en-US", now)).toBe("Nov 3");
    expect(historyTime(new Date(2025, 10, 3).toISOString(), "en-US", now)).toBe("Nov 3, 2025");
    harness.controller.dispose();
  });
});

it("retains the original version and typed name through a rename conflict and an uncertain retry", async () => {
  const h = controllerHarness();
  const rename = vi.fn<FoundationPort["renameConversation"]>();
  h.port.renameConversation = rename;
  await settle();
  h.controller.beginRename("Original");
  for (const [text, notice] of [
    ["", "empty"],
    [" name ", "spaces"],
    ["😀".repeat(201), "long"],
  ] as const) {
    h.controller.editRename(text);
    await h.controller.saveRename();
    expect(h.controller.snapshot().rename).toMatchObject({ text, notice });
  }
  expect(rename).not.toHaveBeenCalled();
  h.controller.editRename("Field text");
  const other = {
    ...summary,
    title: "Other window",
    updatedAt: "2026-11-15T10:12:00.001Z",
    revision: 2,
  };
  vi.mocked(h.port.readConversations).mockReturnValue(ok({ items: [other], remaining: [] }));
  rename.mockReturnValueOnce(call(staleRevision(2)));
  await h.controller.saveRename();
  expect(rename.mock.calls[0]?.[1].expectedUpdatedAt).toBe(summary.updatedAt);
  expect(h.controller.snapshot().rename).toMatchObject({ text: "Field text", notice: "stale" });
  rename.mockReturnValueOnce(call(failure("uncertain")));
  await h.controller.saveRename();
  expect(h.controller.snapshot().rename?.notice).toBe("uncertain");
  expect(rename.mock.calls[1]?.[1].expectedUpdatedAt).toBe(other.updatedAt);
  expect(rename.mock.calls[1]?.[0]).not.toBe(rename.mock.calls[0]?.[0]);
  rename.mockReturnValueOnce(ok({ resultId: summary.id }));
  vi.mocked(h.port.readConversations).mockReturnValue(
    ok({
      items: [{ ...other, title: "Field text", revision: 3 }],
      remaining: [],
    }),
  );
  await h.controller.saveRename();
  expect(rename.mock.calls[2]).toEqual(rename.mock.calls[1]);
  expect(h.controller.snapshot().rename).toBeUndefined();
  expect(h.controller.snapshot().conversation?.title).toBe("Field text");
  expect(h.controller.snapshot().renamed).toBe(1);
  h.controller.dispose();
});

it("shows first-page and older-page problems with explicit retry and restores focus after paging", async () => {
  const latest = { ...summary, latestPrefix: "Latest" };
  const firstRows = Array.from({ length: 50 }, (_, index) => ({ ...latest, id: id(2000 - index) }));
  const next = { latestAt: latest.latestAt, id: firstRows[49]!.id };
  const older = { ...summary, id: id(1900), latestPrefix: "", status: "waiting" as const };
  const page = vi.fn<FoundationPort["listConversations"]>();
  const select = vi.fn();
  const controller = new ConversationHistoryController(
    { listConversations: page } as unknown as FoundationPort,
    vi.fn(),
  );
  function Fixture() {
    const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
    return h(ConversationHistory, {
      controller,
      state,
      current: latest.id,
      select,
      locale: "en-US",
    });
  }
  controller.show();
  controller.scope(scope.projectId);
  controller.disconnected("service_unavailable");
  controller.show();
  controller.loadOlder();
  await act(async () => root.render(h(Fixture)));
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "Conversations are unavailable",
  );

  const first = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  page.mockReturnValueOnce({ result: first.promise, cancel() {} });
  await act(async () => {
    controller.connected();
    controller.show();
    controller.reload();
  });
  expect(container.querySelector("[aria-busy=true] p")?.textContent).toBe("Loading conversations…");
  await act(async () => first.resolve(failure("storage_failed")));
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "Ohtia couldn’t load the conversations.",
  );
  expect(container.querySelector("[role=alert] button")).toBeNull();
  const button = () => container.querySelector<HTMLButtonElement>(".chat-history-actions button")!;
  expect(button().textContent).toBe("Reload conversations");

  page.mockReturnValueOnce(ok({ items: firstRows, next, hasMore: true }));
  await act(async () => button().click());
  expect(button().textContent).toBe("Load older conversations");
  expect(container.querySelector(".chat-history-list")?.children).toHaveLength(50);
  container.querySelector(".chat-history-list")?.dispatchEvent(new Event("scroll"));
  expect(page).toHaveBeenCalledTimes(2);
  const loading = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  page.mockReturnValueOnce({ result: loading.promise, cancel() {} });
  await act(async () => {
    button().focus();
    button().click();
    controller.loadOlder();
  });
  expect(button().disabled).toBe(true);
  expect(container.querySelector("[role=status]")?.textContent).toBe(
    "Loading older conversations…",
  );
  await act(async () => loading.resolve(failure("storage_failed")));
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "Ohtia couldn’t load older conversations.",
  );
  expect(container.querySelector(".chat-history-list")?.children).toHaveLength(50);
  page.mockReturnValueOnce(ok({ items: [older], next: null, hasMore: false }));
  await act(async () => {
    button().focus();
    button().click();
  });
  expect(button()).toBeNull();
  expect(document.activeElement).toBe(container.querySelector(".chat-history-list"));
  expect(container.querySelector("[data-status=waiting]")?.textContent).toBe("Waiting");
  await act(async () => container.querySelector<HTMLButtonElement>(".chat-history-row")!.click());
  expect(select).toHaveBeenCalledWith(latest.id);
  await act(async () => controller.disconnected("service_unavailable"));
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "Conversations are unavailable",
  );
  controller.dispose();
});

it("ignores an old project page and keeps rows inside the established history range after reconnecting", async () => {
  const previous = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  const page = vi
    .fn<FoundationPort["listConversations"]>()
    .mockReturnValueOnce({ result: previous.promise, cancel() {} });
  const oldest = { ...summary, id: id(15), latestAt: "2026-11-04T09:00:00.000Z" };
  const newer = { ...summary, id: id(16), latestAt: "2026-11-05T09:00:00.000Z" };
  const frontier = { latestAt: newer.latestAt, id: newer.id };
  const read = vi.fn<FoundationPort["readConversations"]>();
  const controller = new ConversationHistoryController(
    {
      listConversations: page,
      readConversations: read,
    } as unknown as FoundationPort,
    () => {},
  );
  controller.scope(id(90));
  controller.connected();
  controller.show();
  await settle();
  controller.scope(scope.projectId);
  controller.connected();
  page
    .mockReturnValueOnce(ok({ items: [newer], next: frontier, hasMore: true }))
    .mockReturnValueOnce(ok({ items: [], next: null, hasMore: false }));
  controller.show();
  await settle();
  previous.resolve({ ok: true, value: { items: [summary], next: null, hasMore: false } });
  await settle();
  expect(controller.snapshot().items).toEqual([newer]);
  expect(page).toHaveBeenLastCalledWith({
    projectId: scope.projectId,
    cursor: frontier,
    count: 49,
  });
  // An interrupted older page should keep the previous cursor on return.
  controller.scope(id(90));
  controller.connected();
  const first = Array.from({ length: 50 }, (_, index) => ({
    ...newer,
    id: id(99 - index),
    projectId: id(90),
  }));
  const last = first[49]!;
  const cursor = { latestAt: last.latestAt, id: last.id };
  const interrupted = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  page
    .mockReturnValueOnce(ok({ items: first, next: cursor, hasMore: true }))
    .mockReturnValueOnce({ result: interrupted.promise, cancel() {} });
  controller.show();
  await settle();
  controller.loadOlder();
  await settle();
  controller.scope(id(90));
  expect(controller.snapshot().loadingOlder).toBe(false);
  page.mockReturnValueOnce(
    ok({
      items: [...first.slice(0, 49), { ...oldest, projectId: id(90) }],
      next: null,
      hasMore: false,
    }),
  );
  read.mockReturnValueOnce(ok({ items: first, remaining: [] }));
  controller.connected();
  await settle();
  interrupted.resolve({ ok: true, value: { items: [summary], next: null, hasMore: false } });
  await settle();
  expect(controller.snapshot().items).toEqual(first);
  expect(controller.snapshot().next).toEqual(cursor);
  controller.dispose();
});

it("renders rename validation and recovery notices with their own semantics and format", async () => {
  const base = { text: "한".repeat(202), expectedUpdatedAt: summary.updatedAt, busy: false };
  for (const [notice, text] of [
    ["long", "Remove 2 characters to save this name."],
    ["stale", "This conversation was renamed in another window."],
    ["uncertain", "Ohtia couldn’t confirm that the name was saved."],
  ] as const) {
    await act(async () =>
      root.render(
        h(ConversationRenameNotice, {
          rename: { ...base, notice },
          renamed: undefined,
          noticeId: "name-notice",
          locale: "en-US",
        }),
      ),
    );
    expect(container.querySelector("#name-notice[role=status]")?.textContent).toContain(text);
    expect(container.querySelector("#name-notice svg")).not.toBeNull();
  }
  await act(async () =>
    root.render(
      h(ConversationRenameNotice, {
        rename: undefined,
        renamed: 1,
        noticeId: "name-notice",
        locale: "en-US",
      }),
    ),
  );
  expect(container.querySelector("[role=status]")?.textContent).toBe("Conversation renamed.");
});

it("preserves the typed name if the conflict reread fails and fetches a fresh version before retrying", async () => {
  const h = controllerHarness();
  h.port.renameConversation = vi
    .fn()
    .mockReturnValueOnce(call(staleRevision(2)))
    .mockReturnValueOnce(ok({ resultId: summary.id }));
  await settle();
  expect(h.controller.startNew()).toBe(false);
  h.controller.beginRename("Original");
  h.controller.beginRename("Second edit request");
  h.controller.editRename("Original");
  h.controller.editRename("New name");
  vi.mocked(h.port.readConversations)
    .mockReturnValueOnce(call(failure("storage_failed")))
    .mockReturnValueOnce(
      ok({
        items: [
          { ...summary, title: "Other window", revision: 2, updatedAt: "2026-11-16T11:13:00.000Z" },
        ],
        remaining: [],
      }),
    )
    .mockImplementationOnce(() => {
      throw new Error("Read unavailable");
    });
  await h.controller.saveRename();
  expect(h.controller.snapshot().rename).toMatchObject({
    text: "New name",
    notice: "failed",
    needsRefresh: true,
  });
  await h.controller.saveRename();
  expect(h.port.renameConversation).toHaveBeenCalledOnce();
  expect(h.controller.snapshot().rename).toMatchObject({
    text: "New name",
    notice: "stale",
    needsRefresh: false,
  });
  await h.controller.saveRename();
  expect(h.controller.snapshot().conversation?.title).toBe("New name");
  h.controller.dispose();
  await h.controller.saveRename();
});

it("extracts preview node text across Markdown blocks, breaks and references", () => {
  expect(
    conversationPreview(
      "# Heading\n\nOne  \ntwo\n\n***\n\n- **Three**\n- `four`\n\n[Five][link]\n\n[link]: https://example.org",
      false,
    ),
  ).toBe("Heading One two Three four Five");
  expect(conversationPreview("😀".repeat(120), true)).toBe("😀".repeat(120) + "…");
  expect(conversationPreview(" \n\n ", false)).toBe("");
  expect(conversationPreview("> ".repeat(14) + "readable", false)).toContain("readable");
});

it("retains a focused row while a sequence gap is repaired and reconnects from the history retry", async () => {
  const fixture = controllerHarness();
  const controller = fixture.controller.history;
  const page = vi.fn<FoundationPort["listConversations"]>(() =>
    ok({
      items: [summary],
      next: null,
      hasMore: false,
    }),
  );
  fixture.port.listConversations = page;
  function Fixture() {
    const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
    return h(ConversationHistory, {
      controller,
      state,
      current: summary.id,
      locale: "en-US",
      select: fixture.controller.switchConversation,
    });
  }
  await settle();
  await act(async () => {
    root.render(h(Fixture));
    controller.show();
  });
  const row = container.querySelector<HTMLButtonElement>(".chat-history-row")!;
  row.focus();
  const pending = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  page.mockReturnValueOnce({ result: pending.promise, cancel() {} });
  await act(async () => fixture.emit(failure("sequence_gap")));
  expect(container.querySelector(".chat-history-row")).toBe(row);
  expect(document.activeElement).toBe(row);
  expect(container.querySelector("[aria-busy=true]")).toBeNull();
  await act(async () =>
    pending.resolve({
      ok: true,
      value: { items: [summary], next: null, hasMore: false },
    }),
  );
  expect(document.activeElement).toBe(row);

  await act(async () => fixture.emit(failure("storage_failed")));
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "couldn’t load the conversations",
  );
  const retry = () => container.querySelector<HTMLButtonElement>(".chat-history-actions button")!;
  expect(retry().textContent).toBe("Reload conversations");
  const repeatedFailure = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  page.mockReturnValueOnce({ result: repeatedFailure.promise, cancel() {} });
  await act(async () => {
    retry().focus();
    retry().click();
  });
  expect(fixture.port.subscribeResearch).toHaveBeenCalledTimes(3);
  await act(async () => repeatedFailure.resolve(failure("storage_failed")));
  expect(document.activeElement).toBe(retry());

  const successfulRetry = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  page.mockReturnValueOnce({ result: successfulRetry.promise, cancel() {} });
  await act(async () => retry().click());
  await act(async () =>
    successfulRetry.resolve({
      ok: true,
      value: { items: [summary], next: null, hasMore: false },
    }),
  );
  expect(container.querySelector(".chat-history-row")).not.toBeNull();
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(document.activeElement).toBe(container.querySelector(".chat-history-list"));
  fixture.controller.dispose();
});

const consultation = (change: Partial<TimelineConsultation> = {}): TimelineConsultation => ({
  kind: "consultation",
  id: id(800),
  position: 130,
  rank: 2,
  revision: 1,
  agentId: "josefa",
  taskId: id(799),
  state: "proposed",
  invalidReason: null,
  language: "en",
  request: "**Self-contained request**",
  reason: "Support the choice of search terms.",
  connection: null,
  ...change,
});
const consultationController = (methods: Partial<ConversationController>) =>
  methods as ConversationController;
const buttonNamed = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === name,
  )!;

describe("consultation states and synchronization", () => {
  it("shows invalid consultations with singularly attributed notices and translated count formatting", async () => {
    const controller = consultationController({
      performConsultationAction: vi.fn(async () => failure("storage_failed")),
      observeConsultationDestination: vi.fn(() => () => {}),
    });
    const invalid = (invalidReason: TimelineConsultation["invalidReason"]) =>
      consultation({
        state: "invalid",
        invalidReason,
        request: null,
        reason: null,
        agentId: null,
      });
    await render(state([invalid("request_empty")]), controller);
    expect(container.querySelector(".setup-invalid .voice-label")?.textContent).toContain(
      "Virgilio",
    );
    expect(container.querySelector(".setup-invalid [role=status]")?.textContent).toContain(
      "The request was empty.",
    );
    expect(container.querySelector(".action-proposal")).toBeNull();
    await render(state([invalid("reason_too_long")]), controller);
    expect(container.querySelector(".setup-invalid [role=status]")?.textContent).toContain(
      "The consultation’s reason was longer than 500 characters.",
    );
    expect(controller.observeConsultationDestination).not.toHaveBeenCalled();
  });

  it("refreshes the displayed destination on rejection, leaves failed decisions available, and restores focus on acceptance", async () => {
    const performConsultationAction = vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(failure("destination_changed")))
      .mockReturnValueOnce(Promise.resolve(failure("consultation_unfinished")))
      .mockRejectedValueOnce(new Error("Synthetic IPC failure"))
      .mockReturnValueOnce(Promise.resolve(failure("storage_failed")))
      .mockReturnValueOnce(Promise.resolve({ ok: true, value: { resultId: id(800) } }));
    const stop = vi.fn();
    const observer = vi.fn(() => stop);
    const controller = consultationController({
      performConsultationAction,
      observeConsultationDestination: observer,
    });
    const open = consultation();
    await render(state([open]), controller);
    expect(buttonNamed("Ask Josefa").getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).not.toContain("Josefa’s service could not be read.");
    await render({ ...state([open]), consultationDestination: null }, controller);
    expect(buttonNamed("Ask Josefa").getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Josefa’s service could not be read.");
    await render({ ...state([open]), consultationDestination: "chatgpt" }, controller);
    const ask = buttonNamed("Ask Josefa");
    ask.focus();
    await act(async () => ask.click());
    expect(container.querySelector(".action-proposal [role=status]")?.textContent).toContain(
      "Josefa’s service changed",
    );
    await act(async () => ask.click());
    expect(container.querySelector(".action-proposal [role=status]")?.textContent).toContain(
      "Another consultation",
    );
    await act(async () => buttonNamed("Decline consultation").click());
    expect(container.querySelector(".action-proposal [role=alert]")?.textContent).toContain(
      "Ohtia couldn’t decline the consultation.",
    );
    await act(async () => buttonNamed("Decline consultation").click());
    expect(performConsultationAction.mock.calls[2]).toEqual(
      performConsultationAction.mock.calls[3],
    );
    await act(async () => ask.click());
    await render(
      {
        ...state([consultation({ state: "accepted", connection: "chatgpt", revision: 2 })]),
        consultationDestination: null,
      },
      controller,
    );
    expect(container.querySelector(".action-proposal")?.textContent).toContain(
      "You accepted this consultation.",
    );
    expect(container.querySelector(".conversation-notice")).toBeNull();
    expect(container.querySelector(".consultation-recipient")?.textContent).toContain("ChatGPT");
    expect(document.activeElement).toBe(container.querySelector(".consultation-proposal"));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("reads the exact request parts and the shown connection, and reconciles window races against the receipt", async () => {
    const h = controllerHarness(false);
    const request = "Research purpose and scope. " + "x".repeat(4500);
    const reference = {
      source: "consultation_" + id(800),
      parts: 2,
      bytes: request.length,
      sha256: createHash("sha256").update(request).digest("hex"),
    };
    const record = consultation({ request: reference });
    h.items.push(record);
    const part = vi.fn(({ index }: { index: number }) =>
      ok({ text: index === 1 ? request.slice(0, 4096) : request.slice(4096) }),
    );
    const destination = {
      destination: {
        connection: "chatgpt",
        operation: "search_strategy_planning",
        maxAttemptDurationMs: 600_000,
      },
    };
    const updates: Parameters<FoundationPort["subscribeConnection"]>[1][] = [];
    const dispose = vi.fn();
    const accept = vi.fn(() => call(failure("destination_changed")));
    const decline = vi.fn(() => call(failure("proposal_not_waiting")));
    Object.assign(h.port, {
      readTextPart: part,
      acceptConsultation: accept,
      declineConsultation: decline,
      subscribeConnection: vi.fn((_id, receive) => {
        updates.push(receive);
        return { ready: Promise.resolve({ ok: true, value: { subscriptionId: "seen" } }), dispose };
      }),
    });
    vi.stubGlobal("crypto", webcrypto);
    try {
      h.controller.open(scope);
      await vi.waitFor(() => expect(h.controller.snapshot().texts.get(record.id)).toBe(request));
      expect(part).toHaveBeenCalledWith({ source: reference.source, index: 2 });
      vi.mocked(h.port.readDestination).mockReturnValue(ok(destination as never));
      const end = h.controller.observeConsultationDestination();
      await settle();
      expect(h.controller.snapshot().consultationDestination).toBe("chatgpt");
      const update = updates.at(-1)!;
      const event = { ok: true, value: { connection: "chatgpt" } } as Parameters<typeof update>[0];
      vi.mocked(h.port.readDestination).mockReturnValueOnce(ok({ destination: null }));
      update(event);
      await settle();
      expect(h.controller.snapshot().consultationDestination).toBeNull();
      vi.mocked(h.port.readDestination).mockReturnValueOnce(call(failure("storage_failed")));
      update(event);
      await settle();
      expect(h.controller.snapshot().consultationDestination).toBeNull();
      vi.mocked(h.port.readDestination).mockImplementationOnce(() => ({
        result: Promise.reject(new Error("Synthetic disconnect")),
        cancel() {},
      }));
      update(event);
      await settle();
      expect(await h.controller.performConsultationAction("missing", record, "accept")).toEqual(
        failure("service_unavailable"),
      );
      expect(
        await h.controller.performConsultationAction("accept", record, "accept", "chatgpt"),
      ).toEqual(failure("destination_changed"));
      expect(accept).toHaveBeenCalledWith("accept", {
        proposalId: record.id,
        connection: "chatgpt",
      });
      expect(h.controller.snapshot().consultationDestination).toBe("chatgpt");
      h.items[h.items.indexOf(record)] = consultation({ state: "declined", revision: 2 });
      expect(await h.controller.performConsultationAction("decline", record, "decline")).toEqual(
        failure("proposal_not_waiting"),
      );
      expect(decline).toHaveBeenCalledWith("decline", { proposalId: record.id });
      expect(h.controller.snapshot().items).toContainEqual(
        expect.objectContaining({ id: record.id, state: "declined" }),
      );
      vi.mocked(h.port.readDestination).mockClear();
      update(event);
      update(failure("disposed"));
      end();
      update(event);
      await settle();
      expect(dispose).toHaveBeenCalled();
      expect(h.port.readDestination).not.toHaveBeenCalled();
    } finally {
      h.controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("routes contribution retries and exposes Josefa’s starting notice, streaming reply and saved attribution", async () => {
    const h = controllerHarness();
    const tryAgainContribution = vi.fn(() => call(failure("consultation_unfinished")));
    const startAgainContribution = vi.fn(() => call(failure("newer_task_exists")));
    Object.assign(h.port, { tryAgainContribution, startAgainContribution });
    await settle();
    const reload = vi.spyOn(h.controller, "reload").mockImplementation(() => {});
    const task = reviewTask({
      id: id(799),
      agentId: "josefa",
      consultation: true,
      replacesTaskId: null,
    });
    expect(await h.controller.performTaskAction("retry", "retry", task)).toEqual(
      failure("consultation_unfinished"),
    );
    expect(await h.controller.performTaskAction("restart", "restart", task)).toEqual(
      failure("newer_task_exists"),
    );
    expect(tryAgainContribution).toHaveBeenCalledWith("retry", { taskId: task.id });
    expect(startAgainContribution).toHaveBeenCalledWith("restart", { taskId: task.id });
    expect(reload).toHaveBeenCalledOnce();
    const performTaskAction = h.controller.performTaskAction.bind(h.controller);
    await render(state([task]), consultationController({ performTaskAction }));
    await act(async () => buttonNamed("Try again").click());
    expect(container.textContent).toContain(
      "Another consultation in this conversation hasn’t finished. Try again when it ends.",
    );
    expect(container.querySelector(".voice-label")?.textContent).toContain("Josefa");
    await render({
      ...state([{ ...task, state: "running" }]),
      replies: new Map([[task.id, { sequence: 1, text: "**Beginning**" }]]),
    });
    expect(container.querySelector(".consultation-caption")?.textContent).toBe(
      "Consulted by Virgilio",
    );
    expect(container.querySelector(".conversation-text strong")?.textContent).toBe("Beginning");
    const result: TimelineItem = {
      kind: "message",
      id: id(801),
      position: 5,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "josefa",
      taskId: task.id,
      content: "Saved plan.",
      language: "en",
      consultation: true,
      ending: "complete",
    };
    await render(state([result]));
    expect(container.querySelector(".consultation-caption")?.textContent).toBe(
      "Consulted by Virgilio",
    );
    expect(container.textContent).toContain("Saved plan.");
    await render(state([{ ...task, outcomeReason: "not_eligible" }]));
    expect(buttonNamed("Try again")).toBeUndefined();
    h.controller.dispose();
  });
});
