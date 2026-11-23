import { createHash, webcrypto } from "node:crypto";
import { deferred } from "./fixtures/settings.js";
// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HandoffDivider,
  HandoffProposal,
  HandoffReturnControl,
} from "../packages/renderer/src/handoff.js";
import { PlanChangeProposal } from "../packages/renderer/src/plan-change-proposal.js";
import { TaskNotice, taskNoticeContent } from "../packages/renderer/src/task-notice.js";
import {
  ConversationHistory,
  ConversationRenameNotice,
  historyTime,
} from "../packages/renderer/src/conversation-history.js";
import { conversationPreview } from "../packages/renderer/src/message-markdown.js";
import { ConversationHistoryController } from "../packages/renderer/src/conversation-history-controller.js";
import {
  ProjectMemoryDrafts,
  ProjectMemoryView,
} from "../packages/renderer/src/project-memory-view.js";
import { MemoryChangeLine, MemoryReviewLine } from "../packages/renderer/src/project-memory.js";
import { ConversationView } from "../packages/renderer/src/conversation-view.js";
import {
  ConversationController,
  type ConversationState,
  type ReadPlanCard,
  type PlanProgressAction,
} from "../packages/renderer/src/conversation-controller.js";
import {
  failure,
  invalidPlan,
  invalidPlanChange,
  planInvalidReasons,
  staleRevision,
  compareConversations,
  chatgptConnection,
  type TimelineTask,
  type TimelineConsultation,
  type TimelineHandoffProposal,
  type InterfaceLocale,
  portLimits,
  type FoundationPort,
  type ReplyDetails,
  type Outcome,
  type ResearchEvent,
  type ResearchInputs,
  type ResearchOutputs,
  type ResearchResult,
  type PlanChangePreview,
  type PlanChangeRow,
  type PlanTaskProgress,
  type TimelinePlanChangeProposal,
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
  ownerRevision: 1,
  ownerPosition: null,
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
async function render(
  next: ConversationState,
  controller = {} as ConversationController,
  locale: InterfaceLocale = "en-US",
  onOpenConnections?: () => void,
  detailsPort?: import("../packages/renderer/src/reply-details.js").ReplyDetailsPort,
  onOpenAgents?: () => void,
) {
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
        locale,
        ...(onOpenConnections ? { onOpenConnections } : {}),
        ...(onOpenAgents ? { onOpenAgents } : {}),
        ...(detailsPort ? { detailsPort } : {}),
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
    listProjectAttention: () => ok({ items: [], next: null, hasMore: false, revision: 1 }),
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
          key: t.id,
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
  it("updates model-blocked notices with account evidence and opens Agents", async () => {
    const onOpenAgents = vi.fn();
    const onOpenConnections = vi.fn();
    const missing = task({
      state: "blocked",
      outcomeReason: null,
      blockingReason: "configuration_unavailable",
    });
    await show(missing, { onOpenAgents, onOpenConnections });
    expect(container.textContent).toContain("Waiting to start.");
    await show({ ...missing, modelUnavailable: true }, { onOpenAgents });
    expect(container.textContent).toContain("Virgilio has no model chosen.");
    await show({ ...missing, modelUnavailable: true, modelName: "Stored model" }, { onOpenAgents });
    expect(container.textContent).toContain(
      "Virgilio’s model “Stored model” isn’t available in your account now.",
    );
    const open = buttonNamed("Open Agents settings");
    expect(open?.closest(".conversation-notice")).toBeNull();
    await act(async () => open.click());
    expect(onOpenAgents).toHaveBeenCalledOnce();

    const disconnected = { ...missing, blockingReason: "connection_disabled" };
    await show(disconnected, { onOpenAgents, onOpenConnections });
    expect(container.textContent).toContain("Choose another model in Settings › Agents.");
    expect(buttonNamed("Open Agents settings")).toBeDefined();
    await show(
      { ...disconnected, id: id(992), synthesis: true },
      { onOpenAgents, onOpenConnections },
    );
    expect(container.textContent).not.toContain("Choose another model in Settings › Agents.");
    expect(buttonNamed("Open Agents settings")).toBeUndefined();

    const retry = await show(
      task({ outcomeReason: "model_unavailable", modelName: "Stored model" }),
      { onOpenAgents },
    );
    expect(buttonNamed("Open Agents settings")).toBeDefined();
    await act(async () => buttonNamed("Try again").click());
    expect(retry).toHaveBeenCalledWith(
      expect.any(String),
      "retry",
      expect.objectContaining({ id: id(991) }),
    );
  });

  it("sets an unknown language only on the provider's plain text in both copies of a rejection", async () => {
    const text = "Réponse <strong>refusée</strong>";
    await show(task({ outcomeReason: "request_rejected", providerMessage: text }), {
      locale: "de-DE",
    });
    const alert = container.querySelector('[role="alert"]')!;
    const notice = container.querySelector(".conversation-notice")!;
    expect(alert.getAttribute("lang")).toBe("de-DE");
    for (const element of [alert, notice]) {
      const provider = element.querySelector('bdi[lang=""][dir="auto"]')!;
      expect(provider.textContent).toBe(text);
      expect(provider.previousSibling?.textContent).toBe("Meldung von Synthetic service: ");
      expect(provider.querySelector("strong")).toBeNull();
    }
  });

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
  it("shows Anthropic-specific limits and the live countdown without automatically retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00.000Z"));
    try {
      const showReason = (outcomeReason: TimelineTask["outcomeReason"], hasText = false) =>
        show(task({ outcomeReason, connection: "anthropic_api_key" }), { hasText });
      await showReason("max_output_reached");
      expect(container.textContent).toContain(
        "The reply reached the maximum length Synthetic service allows for this model.",
      );
      await showReason("max_output_reached", true);
      expect(container.textContent).toContain(
        "Incomplete — maximum length Synthetic service allows",
      );
      await showReason("refused");
      expect(container.textContent).toContain("Synthetic service declined to answer this request.");
      await showReason("rate_limited");
      expect(container.textContent).toContain(
        "Synthetic service limited how many requests this key can send right now.",
      );
      expect(buttonNamed("Try again")).toBeDefined();
      await showReason("model_unavailable");
      expect(container.textContent).toContain("Synthetic service couldn’t find Virgilio’s model");
      const retry = await show(
        task({
          state: "queued",
          connection: "anthropic_api_key",
          outcomeReason: null,
          retryNotBeforeAt: "2026-11-22T12:00:02.000Z",
        }),
      );
      expect(container.textContent).toContain("Synthetic service asked Ohtia to wait 2 sec");
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(container.textContent).toContain("Synthetic service asked Ohtia to wait 1 sec");
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(container.textContent).not.toContain("Synthetic service asked Ohtia to wait");
      expect(retry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

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
it("announces a failed task once when the window already received its shared alert", async () => {
  const h = controllerHarness(false);
  const task = reviewTask({ state: "running" });
  h.items.push(task);
  h.controller.open(scope);
  await settle();
  const failed = {
    ...task,
    revision: task.revision + 1,
    state: "failed",
    outcomeReason: "provider_error",
  } as const;
  h.items[h.items.indexOf(task)] = failed;
  h.emit({
    ok: true,
    value: {
      kind: "attentionRaised",
      source: "conversation",
      task: { id: failed.id, revision: failed.revision },
    },
  });
  h.emit({
    ok: true,
    value: { kind: "changed", record: "timeline", id: failed.id, revision: failed.revision },
  });
  await settle();
  await render(h.controller.snapshot(), h.controller);
  expect(h.controller.activity.snapshot().alerts).toMatchObject([{ source: "conversation" }]);
  const item = container.querySelector(`[data-timeline-id="${failed.id}"]`)!;
  expect(item.querySelector(".conversation-notice")?.textContent).toBeTruthy();
  expect(item.querySelector(".conversation-notice")?.getAttribute("aria-hidden")).toBeNull();
  expect(
    [...item.querySelectorAll("[data-task-notice-announcement]")].map((node) => node.textContent),
  ).toEqual(["", ""]);
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
          unreadReplies: new Map([[row.id, 2]]),
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
    expect(button?.querySelector('[data-status="attention"]')?.textContent).toBe(
      "Erfordert Ihre Aufmerksamkeit",
    );
    const unread = button?.querySelector('[data-status="unread"]');
    expect(unread?.textContent).toBe("Neue Antworten");
    expect(unread?.querySelector(".chat-history-unread-dot")?.getAttribute("aria-hidden")).toBe(
      "true",
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
      consultationRetryFits: true,
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

describe("plan synthesis presentation", () => {
  it("loads a result across earlier timeline pages and can retry the same reveal after a read failure", async () => {
    const h = controllerHarness();
    try {
      await settle();
      const previous = h.controller.snapshot().next;
      const source = h.items[0]!;
      expect(h.controller.snapshot().items).not.toContainEqual(source);
      vi.mocked(h.port.listTimelineBefore).mockReturnValueOnce(call(failure("storage_failed")));
      expect(await h.controller.revealMessage(source.id)).toBe(false);
      expect(h.controller.snapshot()).toMatchObject({
        failedEarlier: true,
        loadingEarlier: false,
        next: previous,
      });
      expect(await h.controller.revealMessage(source.id)).toBe(true);
      expect(h.controller.snapshot().items).toContainEqual(source);
      expect(h.controller.snapshot()).toMatchObject({
        failedEarlier: false,
        loadingEarlier: false,
        next: null,
      });
      const calls = vi.mocked(h.port.listTimelineBefore).mock.calls.length;
      expect(await h.controller.revealMessage(source.id)).toBe(true);
      expect(h.port.listTimelineBefore).toHaveBeenCalledTimes(calls);
    } finally {
      h.controller.dispose();
    }
  });

  it("links only completed results, labels the synthesis and focuses the linked message", async () => {
    const contribution: TimelineItem = {
      kind: "message",
      id: id(810),
      position: 2,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "josefa",
      taskId: id(811),
      content: "Examine the first catalog.",
      language: "en",
      ending: "complete",
    };
    const synthesis: TimelineItem = {
      kind: "message",
      id: id(812),
      position: 4,
      rank: 1,
      revision: 1,
      authorKind: "agent",
      agentId: "virgilio",
      taskId: id(813),
      content: "No sources were examined.",
      language: "en",
      ending: "complete",
      synthesisSources: [
        { key: "objective-1", agentId: "josefa", state: "completed", messageId: contribution.id },
        { key: "objective-2", agentId: "josefa", state: "failed", messageId: null },
        { key: "objective-3", agentId: "josefa", state: "blocked", messageId: null },
        { key: "objective-4", agentId: "josefa", state: "cancelled", messageId: null },
        { key: "objective-5", agentId: "josefa", state: "uncertain", messageId: null },
      ],
    };
    const revealMessage = vi.fn(async () => true);
    const controller = { revealMessage } as unknown as ConversationController;
    await render(state([contribution, synthesis]), controller);
    const message = container.querySelector(`[data-timeline-id="${synthesis.id}"]`);
    expect(message?.querySelector(".voice-label + .consultation-caption")?.textContent).toBe(
      "Plan synthesis",
    );
    const sources = message?.querySelector(".synthesis-references");
    expect(sources?.textContent).toBe(
      "Based on: objective-1 · Josefa, objective-2 · Josefa (failed), objective-3 · Josefa (blocked), objective-4 · Josefa (cancelled), and objective-5 · Josefa (uncertain)",
    );
    expect(sources?.querySelectorAll("a")).toHaveLength(1);
    const link = sources?.querySelector("a");
    const contributionElement = document.getElementById("message-" + contribution.id);
    const scrollIntoView = vi.fn();
    if (contributionElement) contributionElement.scrollIntoView = scrollIntoView;
    expect(link?.getAttribute("href")).toBe(`#message-${contribution.id}`);
    await act(async () => link?.click());
    expect(revealMessage).toHaveBeenCalledWith(contribution.id);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(document.activeElement?.id).toBe(`message-${contribution.id}`);
  });

  it("routes synthesis recovery through one command with acknowledgement and hides retries for terminal refusals", async () => {
    const h = controllerHarness();
    const tryAgainSynthesis = vi.fn(() => call(failure("limit_reached")));
    Object.assign(h.port, { tryAgainSynthesis });
    const task = reviewTask({
      id: id(814),
      synthesis: true,
      synthesisStopped: false,
      state: "uncertain",
    });
    const controller = consultationController({
      performTaskAction: h.controller.performTaskAction.bind(h.controller),
    });
    await render(state([task]), controller);
    await act(async () => buttonNamed("Start reply again").click());
    expect(tryAgainSynthesis).not.toHaveBeenCalled();
    const dialog = document.querySelector("dialog[open]");
    expect(dialog).toBeTruthy();
    const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Start reply again",
    );
    await act(async () => confirm?.click());
    expect(tryAgainSynthesis).toHaveBeenCalledWith(expect.any(String), { taskId: task.id });
    expect(container.textContent).toContain("The plan has reached its work limit.");
    await render(state([{ ...task, synthesisStopped: true }]), controller);
    expect(buttonNamed("Start reply again")).toBeUndefined();
    await render(
      state([{ ...task, state: "failed", outcomeReason: "input_too_large" }]),
      controller,
    );
    expect(container.textContent).toContain(
      "The plan’s results were longer than Ohtia can send for a synthesis.",
    );
    expect(buttonNamed("Try again")).toBeUndefined();
    await render(state([{ ...task, state: "failed", outcomeReason: "not_eligible" }]), controller);
    expect(buttonNamed("Try again")).toBeUndefined();
    h.controller.dispose();
  });
});

describe("plan decision card", () => {
  const proposal = {
    id: id(2029),
    kind: "plan",
    rank: 2,
    position: 1,
    revision: 1,
    taskId: id(2030),
    language: "en",
    state: "proposed",
    invalidReason: null,
  } as const;
  const first = {
    id: id(2031),
    key: "vocabulary",
    agentId: "josefa",
    request: "**List** candidate terms.",
    reason: "**This stays plain text.**",
    required: true,
    prerequisites: [],
    state: "waiting",
    taskId: null,
    task: null,
    resultMessageId: null,
    failureReason: null,
    blockedBy: null,
    restartHeld: false,
  } as const;
  const open = {
    planId: proposal.id,
    ...scope,
    revision: 1,
    graphVersion: 0,
    outcome: null,
    throughSequence: 0,
    needsAttention: false,
    state: "proposed" as const,
    connections: {},
    maxRequests: 24,
    requestsUsed: 0,
    purpose: "**Compare search strategies.**",
    sharedContext: "**Open catalogs** are available.",
    contributions: [first, { ...first, id: id(2032), key: "second", prerequisites: [first.id] }],
    continuation: null,
  };
  const connection = {
    id: "openai",
    displayName: "OpenAI",
    kind: "api_key" as const,
    usageUrl: null,
  };

  it("renders the approved content and displayed destinations, keeping the operation ID on retry", async () => {
    const readPlanDestinations = vi.fn(async () => ({ josefa: "openai", virgilio: "chatgpt" }));
    const readPlanCard = vi.fn(async (): Promise<ReadPlanCard> => open);
    const performPlanAction = vi.fn(async (): Promise<Outcome<ResearchResult>> =>
      failure("storage_failed"),
    );
    const controller = {
      readPlanCard,
      readPlanDestinations,
      performPlanAction,
      observePlanDestinations: vi.fn(() => () => {}),
      connections: [connection, chatgptConnection],
    } as unknown as ConversationController;
    await render(state([proposal]), controller);
    expect(container.querySelector("h3")?.textContent).toBe("Virgilio proposes a plan");
    expect(container.textContent).toContain("Waiting for your answer");
    expect(container.textContent).toContain("2 requests to OpenAI and 1 request to ChatGPT");
    expect(container.querySelector(".plan-row strong")?.textContent).toBe("List");
    expect(container.textContent).toContain("Request:");
    expect(container.textContent).toContain("Reason:");
    expect(container.textContent).toContain("**This stays plain text.**");
    expect(container.textContent).toContain("**Compare search strategies.**");
    const run = [...container.querySelectorAll("button")].find(
      ({ textContent }) => textContent === "Run plan",
    )!;
    await act(async () => {
      run.click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Ohtia couldn’t run the plan.",
    );
    await act(async () => {
      run.click();
    });
    expect(performPlanAction).toHaveBeenCalledTimes(2);
    expect(performPlanAction.mock.calls[0]).toEqual(performPlanAction.mock.calls[1]);
    expect(performPlanAction).toHaveBeenCalledWith(expect.any(String), proposal, {
      josefa: "openai",
      virgilio: "chatgpt",
    });

    const accepted = {
      ...open,
      state: "accepted" as const,
      graphVersion: 1,
      revision: 2,
      connections: { josefa: "openai", virgilio: "chatgpt" },
    };
    readPlanCard.mockResolvedValueOnce(accepted);
    performPlanAction.mockResolvedValueOnce({ ok: true, value: { resultId: proposal.id } });
    const callsBeforeAcceptance = readPlanDestinations.mock.calls.length;
    await act(async () => run.click());
    expect(container.textContent).toContain("Running · 0 of 2 done");
    expect(container.textContent).toContain("OpenAI");
    expect(container.textContent).not.toContain("**This stays plain text.**");
    expect(container.textContent).toContain("Used 0 of up to 24 requests.");
    const toggle = [...container.querySelectorAll("button")].find(
      ({ textContent }) => textContent === "Show request",
    )!;
    expect(toggle.hasAttribute("aria-expanded")).toBe(false);
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe("Hide request");
    expect(container.querySelector(".plan-row strong")?.textContent).toBe("List");
    expect(container.textContent).toContain("Request:");
    expect(container.textContent).toContain("Reason:");
    expect(container.textContent).toContain("**This stays plain text.**");
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe("Show request");
    expect(container.querySelector(".plan-row strong")).toBeNull();
    expect(readPlanDestinations.mock.calls).toHaveLength(callsBeforeAcceptance);
  });

  it("shows a busy state and reloads a saved plan after a failed read", async () => {
    const pending = deferred<Error>();
    const readPlanCard = vi.fn((): Promise<ReadPlanCard> =>
      pending.promise.then((error) => {
        throw error;
      }),
    );
    const accepted = { ...open, state: "accepted" as const, graphVersion: 1 };
    await render(state([{ ...proposal, state: "accepted" }]), {
      readPlanCard,
      readPlanDestinations: vi.fn(async () => ({})),
      observePlanDestinations: vi.fn(() => () => {}),
      performPlanAction: vi.fn(),
    } as unknown as ConversationController);
    expect(container.querySelector('[aria-busy="true"]')?.textContent).toContain("Loading…");
    await act(async () => {
      pending.resolve(new Error("read failed"));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("It’s still saved.");
    const reload = [...container.querySelectorAll("button")].find(
      ({ textContent }) => textContent === "Reload plan",
    )!;
    readPlanCard.mockImplementationOnce(async () => {
      return accepted;
    });
    await act(async () => {
      reload.click();
    });
    expect(container.textContent).toContain("Running · 0 of 2 done");
  });
  it("renders every invalid-plan reason without requesting plan contents", async () => {
    const readPlanCard = vi.fn();
    const controller = {
      readPlanCard,
      readPlanDestinations: vi.fn(),
      observePlanDestinations: vi.fn(),
      performPlanAction: vi.fn(),
    } as unknown as ConversationController;
    for (const reason of planInvalidReasons) {
      await render(state([{ ...proposal, state: "invalid", invalidReason: reason }]), controller);
      const notice = container.querySelector(".setup-invalid [role=status]");
      expect(notice?.textContent).toContain("Virgilio proposed a plan Ohtia can’t use.");
      expect(notice?.textContent).toContain("You can ask him again.");
      expect(notice?.textContent).not.toContain("{");
      expect(buttonNamed("Run plan")).toBeUndefined();
    }
    expect(readPlanCard).not.toHaveBeenCalled();
  });

  it("rechecks services after a refusal and reads the decided card after a window race", async () => {
    const replacement = { ...open, state: "replaced" as const, revision: 2 };
    const readPlanCard = vi.fn(async (): Promise<ReadPlanCard> => open);
    const readPlanDestinations = vi.fn(async () => ({ josefa: "openai", virgilio: "chatgpt" }));
    const performPlanAction = vi.fn(async () => failure("destination_changed"));
    const controller = {
      readPlanCard,
      readPlanDestinations,
      performPlanAction,
      observePlanDestinations: vi.fn(() => () => {}),
      connections: [connection, chatgptConnection],
    } as unknown as ConversationController;
    await render(state([proposal]), controller);
    readPlanDestinations.mockResolvedValue({ josefa: "chatgpt", virgilio: "chatgpt" });
    await act(async () => buttonNamed("Run plan").click());
    expect(container.textContent).toContain("An agent’s service changed");
    expect(container.textContent).toContain(
      "If everything goes well: 3 requests to ChatGPT. Plan limit: 24.",
    );
    performPlanAction.mockResolvedValueOnce(
      invalidPlan("reason_empty") as ReturnType<typeof failure>,
    );
    await act(async () => buttonNamed("Run plan").click());
    expect(container.textContent).toContain(
      "Ohtia can’t run this plan now. A contribution had no reason.",
    );
    performPlanAction.mockResolvedValueOnce(failure("plan_unfinished"));
    await act(async () => buttonNamed("Run plan").click());
    expect(container.textContent).toContain(
      "Another plan in this conversation hasn’t finished. Wait for it to end, or stop or finish it on its card.",
    );
    performPlanAction.mockRejectedValueOnce(new Error("restart while declining"));
    await act(async () => buttonNamed("Decline plan").click());
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Ohtia couldn’t decline the plan.",
    );
    readPlanCard.mockResolvedValue(replacement);
    performPlanAction.mockResolvedValueOnce(failure("proposal_not_waiting"));
    await act(async () => {
      buttonNamed("Decline plan").focus();
      buttonNamed("Decline plan").click();
    });
    expect(container.textContent).toContain("Replaced by a newer proposal.");
    expect(container.textContent).not.toContain("If everything goes well");
    expect(container.textContent).not.toContain("ChatGPT");
    expect(container.textContent).toContain("**This stays plain text.**");
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(buttonNamed("Run plan")).toBeUndefined();
    expect(document.activeElement?.id).toBe(`message-${proposal.id}`);
  });

  const second = open.contributions[1]!;
  const third = { ...first, id: id(2033), key: "third", prerequisites: [first.id, second.id] };
  const accepted: ReadPlanCard = {
    ...open,
    state: "accepted",
    graphVersion: 1,
    revision: 2,
    connections: { josefa: "chatgpt", virgilio: "chatgpt" },
    contributions: [first, second, third],
  };
  const work = (part: Partial<PlanTaskProgress>): PlanTaskProgress => ({
    agentId: "josefa",
    state: "queued",
    connection: "chatgpt",
    blockingReason: null,
    outcomeReason: null,
    replyMessageId: null,
    maxAttemptDurationMs: 600000,
    maxInactivityMs: 120000,
    ...part,
  });
  const continuation = (
    task: PlanTaskProgress | null,
  ): NonNullable<ReadPlanCard["continuation"]> => ({
    id: id(2100),
    reason: "finished_partial",
    graphVersion: 1,
    throughSequence: 1,
    policyVersion: 1,
    admission: task ? "admitted" : "waiting",
    restartHeld: false,
    stopped: false,
    taskState: task?.state ?? null,
    taskId: task ? id(2101) : null,
    task,
  });
  const saved = {
    ...message(2040, "The research question remains unresolved."),
    authorKind: "agent",
    agentId: "josefa",
    taskId: id(2041),
    ending: "complete",
    language: "en",
  } as const;
  const status = (index: number, icon: string, label: string) => {
    const labelNode = container.querySelectorAll(".plan-row-state")[index];
    expect(labelNode?.getAttribute("data-icon")).toBe(icon);
    expect(labelNode?.querySelector("svg[aria-hidden=true]")).toBeTruthy();
    expect(labelNode?.lastElementChild?.textContent?.split(": ").slice(1).join(": ")).toBe(label);
  };

  function progressHarness() {
    let displayed = accepted;
    let revision = accepted.revision;
    const readPlanCard = vi.fn(async () => displayed);
    const performPlanProgressAction = vi.fn<
      (operationId: string, action: PlanProgressAction) => Promise<Outcome<ResearchResult>>
    >(async () => ({ ok: true, value: { resultId: accepted.planId } }));
    const revealMessage = vi.fn(async () => true);
    const onOpenConnections = vi.fn();
    const onOpenAgents = vi.fn();
    let refreshDestination: (() => void) | undefined;
    const observePlanDestinations = (refresh: () => void) => {
      refreshDestination = refresh;
      return () => {
        refreshDestination = undefined;
      };
    };
    const hasSharedPlanAttention = vi.fn((_planId: string, _revision: number) => false);
    const controller = {
      connections: [
        chatgptConnection,
        { id: "anthropic_api_key", displayName: "Anthropic", kind: "api_key" },
      ],
      readPlanCard,
      hasSharedPlanAttention,
      readPlanDestinations: vi.fn(async () => ({})),
      observePlanDestinations,
      performPlanAction: vi.fn(),
      performPlanProgressAction,
      revealMessage,
    } as unknown as ConversationController;
    return {
      readPlanCard,
      hasSharedPlanAttention,
      performPlanProgressAction,
      revealMessage,
      onOpenConnections,
      onOpenAgents,
      refresh: (patch: Partial<ReadPlanCard>) => {
        displayed = { ...displayed, ...patch };
        refreshDestination?.();
      },
      update: (patch: Partial<ReadPlanCard>) => {
        displayed = { ...accepted, ...patch, revision: ++revision };
        return revision;
      },
      show: (
        locale: InterfaceLocale = "en-US",
        pauses: ConversationState["pauses"] = {
          revision: 1,
          restart: 3,
          usage: [{ connection: "chatgpt", count: 2 }],
        },
      ) =>
        render(
          {
            ...state([{ ...proposal, revision: displayed.revision, state: "accepted" }, saved]),
            pauses,
          },
          controller,
          locale,
          onOpenConnections,
          undefined,
          onOpenAgents,
        ),
    };
  }

  it("announces plan attention locally when the matching shared alert was not received", async () => {
    const h = progressHarness();
    const announcement = () =>
      container.querySelector("[data-plan-state-announcement]")?.textContent;
    await h.show();
    h.update({ needsAttention: true });
    await h.show();
    expect(announcement()).toBe("Needs your attention");

    h.update({ needsAttention: false });
    await h.show();
    const matchingRevision = h.update({ needsAttention: true });
    h.hasSharedPlanAttention.mockImplementation(
      (planId, revision) => planId === accepted.planId && revision === matchingRevision,
    );
    await h.show();
    expect(announcement()).toBe("");
    h.update({ needsAttention: true });
    await h.show();
    expect(announcement()).toBe("");
  });

  it("updates each live state in place, folds requests and follows the result without conferring academic completion", async () => {
    const h = progressHarness();
    await h.show();
    const header = container.querySelector(".action-proposal-state");
    expect(header?.getAttribute("data-icon")).toBe("circle-ellipsis");
    expect(header?.textContent).toBe("Running · 0 of 3 done");
    const announcements = () =>
      [...container.querySelectorAll('[data-plan-state-announcement][aria-live="polite"]')]
        .map((region) => region.textContent)
        .filter(Boolean);
    expect(announcements()).toEqual([]);
    status(0, "circle-dashed", "Waiting to start");
    status(2, "circle-dashed", "Waiting for vocabulary and second");
    status(3, "circle-dashed", "Waiting for the contributions");
    const waiting = container.querySelectorAll(".plan-row-state")[2];
    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(waiting!.textContent!));
    observer.observe(waiting!, { characterData: true, childList: true, subtree: true });
    const completed = { ...first, state: "completed" as const, resultMessageId: saved.id };
    h.update({
      requestsUsed: 2,
      contributions: [
        completed,
        { ...second, state: "active", taskId: id(2080), task: work({ state: "running" }) },
        third,
      ],
    });
    await h.show();
    expect(container.querySelector(".action-proposal-state")).toBe(header);
    expect(header?.textContent).toBe("Running · 1 of 3 done");
    expect(container.querySelectorAll(".plan-row-state")[2]).toBe(waiting);
    expect(waiting?.querySelector("code")?.textContent).toBe("second");
    expect(changes).toEqual(["third: Waiting for second"]);
    expect(announcements()).toEqual([
      "Running · 1 of 3 done",
      "vocabulary: Done",
      "second: Working…",
      "third: Waiting for second",
    ]);
    await act(async () => buttonNamed("Stop plan").click());
    expect(announcements()).toEqual([]);
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(announcements()).toEqual([]);
    await h.show();
    expect(changes).toHaveLength(1);
    observer.disconnect();
    status(0, "check-check", "Done");
    status(1, "pen-line", "Working…");
    expect(container.textContent).toContain("Used 2 of up to 24 requests.");
    const link = container.querySelector<HTMLAnchorElement>(
      `.plan-row a[href="#message-${saved.id}"]`,
    )!;
    document.getElementById(`message-${saved.id}`)!.scrollIntoView = vi.fn();
    await act(async () => link.click());
    expect(h.revealMessage).toHaveBeenCalledWith(saved.id);
    expect(document.activeElement?.id).toBe(`message-${saved.id}`);
    expect(container.textContent).toContain("The research question remains unresolved.");
    for (const [outcome, label, icon] of [
      ["complete", "Complete", "check-check"],
      ["partial", "Partial", "chart-pie"],
      ["failed", "Failed", "octagon-alert"],
      ["cancelled", "Cancelled", "circle-stop"],
    ] as const) {
      h.update({
        outcome,
        contributions: [
          completed,
          { ...second, state: "cancelled" },
          { ...third, state: "cancelled" },
        ],
      });
      await h.show();
      expect(header?.textContent).toBe(label);
      expect(header?.getAttribute("data-icon")).toBe(icon);
      status(1, "circle-stop", "Cancelled");
      status(
        3,
        outcome === "complete" || outcome === "partial" ? "circle-dashed" : "circle-minus",
        outcome === "complete" || outcome === "partial" ? "Waiting to start" : "Not written",
      );
      expect(buttonNamed("Finish plan")).toBeUndefined();
    }
    h.update({ needsAttention: true });
    await h.show("de-DE");
    expect(header?.textContent).toBe("Erfordert deine Aufmerksamkeit");
    expect(container.textContent).toContain("Wartet auf vocabulary und second");
    await h.show("ko-KR");
    expect(header?.textContent).toBe("확인이 필요함");
    expect(container.textContent).toContain("vocabulary 및 second");
  });

  it("handles blocked, paused, cancelling and uncertain contribution tasks through their existing commands", async () => {
    const h = progressHarness();
    const taskId = id(2090);
    const change = async (
      task: PlanTaskProgress,
      nodeState: ReadPlanCard["contributions"][number]["state"] = "active",
    ) => {
      h.update({ contributions: [{ ...first, state: nodeState, taskId, task }, second, third] });
      await h.show();
    };
    await change(work({ state: "queued" }));
    status(0, "circle-dashed", "Waiting to start");
    await change(
      work({
        state: "queued",
        connection: "anthropic_api_key",
        retryNotBeforeAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const waiting = container.querySelector(".plan-row-state");
    expect(waiting?.getAttribute("data-icon")).toBe("circle-pause");
    expect(waiting?.textContent).toContain("Waiting: Anthropic asked Ohtia to wait");
    await change(work({ state: "blocked", blockingReason: "connection_disabled" }));
    status(0, "unplug", "Waiting: ChatGPT isn’t connected");
    await act(async () => buttonNamed("Open Connections").click());
    expect(h.onOpenConnections).toHaveBeenCalledOnce();
    await change(work({ state: "blocked", blockingReason: "usage_limit_reached" }));
    status(0, "circle-pause", "Paused: ChatGPT requests are paused");
    await act(async () => buttonNamed("Resume ChatGPT requests (2)").click());
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "resume",
      connection: "chatgpt",
    });
    await change(work({ state: "blocked", blockingReason: "restart_paused" }));
    status(0, "circle-pause", "Paused: Ohtia stopped before it started");
    await act(async () => buttonNamed("Continue all (3)").click());
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "continue",
    });
    h.update({ contributions: [{ ...first, restartHeld: true }, second, third] });
    await h.show();
    status(0, "circle-pause", "Paused: Ohtia stopped before it started");
    await change(work({ state: "cancelling" }));
    status(0, "circle-stop", "Stopping…");
    await change(work({ state: "uncertain", outcomeReason: "connection_lost" }), "uncertain");
    status(0, "triangle-alert", "Uncertain");
    await act(async () => buttonNamed("Start reply again").click());
    const dialog = container.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain(
      "Starting again may count this reply against your plan twice.",
    );
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((b) => b.textContent === "Start reply again")
        ?.click(),
    );
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "restartTask",
      taskId,
    });
    await change(work({ state: "failed", outcomeReason: "deadline_exceeded" }), "failed");
    status(0, "octagon-alert", "Failed");
    expect(container.querySelector(".plan-failure-reason")?.textContent).toBe(
      "The reply took longer than 10 min.",
    );
    const retry = buttonNamed("Try again");
    h.update({
      contributions: [{ ...first, state: "active", taskId, task: work({}) }, second, third],
    });
    await act(async () => {
      retry.focus();
      retry.click();
    });
    expect(buttonNamed("Try again")).toBeUndefined();
    expect(document.activeElement?.id).toBe(`message-${proposal.id}`);
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "retryTask",
      taskId,
    });
    await change(work({ state: "failed", outcomeReason: "model_unavailable" }), "failed");
    expect(buttonNamed("Open Agents settings")).toBeDefined();
    await act(async () => buttonNamed("Try again").click());
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "retryTask",
      taskId,
    });
    await change(
      work({ state: "failed", outcomeReason: "request_rejected", providerMessage: "Refusée" }),
      "failed",
    );
    expect(
      container.querySelector('.plan-failure-reason bdi[lang=""][dir="auto"]')?.textContent,
    ).toBe("Refusée");
    await change(work({ state: "failed", outcomeReason: "not_eligible" }), "failed");
    expect(buttonNamed("Try again")).toBeUndefined();
    h.update({
      outcome: "failed",
      contributions: [
        { ...first, state: "uncertain", taskId, task: work({ state: "uncertain" }) },
        second,
        third,
      ],
    });
    await h.show();
    expect(buttonNamed("Start reply again")).toBeUndefined();
  });

  it("shows activation failures and retry refusals with the approved service and the dependency key", async () => {
    const h = progressHarness();
    h.update({
      needsAttention: true,
      contributions: [
        { ...first, state: "failed", failureReason: "destination_changed" },
        { ...second, state: "blocked", blockedBy: first.id },
        { ...third, state: "failed", failureReason: "input_changed" },
      ],
    });
    await h.show();
    status(0, "octagon-alert", "Failed");
    expect(container.textContent).toContain(
      "Not sent: Josefa now uses a different service than the one you approved. Choose ChatGPT for Josefa again in Settings › Agents, then try again.",
    );
    expect(container.textContent).toContain("Not sent: a result it depends on changed.");
    status(1, "link-2-off", "Blocked by vocabulary");
    expect(
      [...container.querySelectorAll("button")].filter((b) => b.textContent === "Try again"),
    ).toHaveLength(1);
    const results = [
      [
        "limit_reached",
        "This plan has no work left for another attempt. Finish it with what there is.",
      ],
      [
        "destination_changed",
        "Nothing was sent: Josefa now uses a different service than the one you approved. Choose ChatGPT for Josefa again in Settings › Agents, then try again.",
      ],
      ["input_changed", "Nothing was sent: a result this contribution depends on changed."],
      [
        "event_limit_reached",
        "This plan reached the most changes Ohtia records. Finish or stop it.",
      ],
    ] as const;
    for (const [code, notice] of results) {
      h.performPlanProgressAction.mockResolvedValueOnce(failure(code));
      await act(async () => buttonNamed("Try again").click());
      expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
        kind: "retryContribution",
        contributionId: first.id,
      });
      expect(container.querySelector(".action-proposal [role=status]")?.textContent).toBe(notice);
    }
    h.performPlanProgressAction.mockResolvedValueOnce(failure("uncertain"));
    await act(async () => buttonNamed("Try again").click());
    expect(container.querySelector(".action-proposal [role=status]")?.textContent).toContain(
      "Ohtia couldn’t confirm",
    );
    h.performPlanProgressAction.mockResolvedValueOnce(failure("pending_limit_reached"));
    await act(async () => buttonNamed("Try again").click());
    expect(container.querySelector(".action-proposal [role=status]")?.textContent).toContain(
      "Too many replies are waiting.",
    );
    h.update({
      contributions: [
        { ...first, state: "failed", failureReason: "input_too_large" },
        second,
        third,
      ],
    });
    await h.show();
    expect(container.textContent).toContain(
      "Not sent: its request and the results it depends on are longer than Ohtia allows.",
    );
    expect(buttonNamed("Try again")).toBeUndefined();

    h.update({
      contributions: [
        {
          ...first,
          state: "failed",
          taskId: id(2090),
          task: work({ state: "failed", outcomeReason: "input_too_large" }),
        },
        second,
        third,
      ],
    });
    await h.show();
    expect(container.textContent).toContain(
      "Not sent: its request and the results it depends on are longer than Ohtia allows.",
    );
    expect(container.textContent).not.toContain("ChatGPT reported an error.");
    expect(buttonNamed("Try again")).toBeUndefined();
  });

  it("refreshes model-blocked plan work and retries a synthesis on its approved destination", async () => {
    const f = progressHarness();
    const taskId = id(2131);
    const unavailable = work({ state: "blocked", blockingReason: "configuration_unavailable" });
    const active = { ...first, state: "active" as const, taskId, task: unavailable };
    f.update({ contributions: [active, second, third] });
    await f.show();
    expect(container.textContent).toContain("Waiting to start");
    await act(async () =>
      f.refresh({
        contributions: [
          { ...active, task: { ...unavailable, modelUnavailable: true } },
          second,
          third,
        ],
      }),
    );
    expect(container.textContent).toContain("Waiting: Josefa has no usable model");
    await act(async () => buttonNamed("Open Agents settings").click());
    expect(f.onOpenAgents).toHaveBeenCalledOnce();

    const synthesis = work({ ...unavailable, agentId: "virgilio", modelUnavailable: true });
    f.update({ outcome: "partial", continuation: continuation(synthesis) });
    await f.show();
    expect(container.textContent).toContain("Waiting: Virgilio has no usable model");
    await act(async () => buttonNamed("Open Agents settings").click());
    expect(f.onOpenAgents).toHaveBeenCalledTimes(2);
    f.update({
      outcome: "partial",
      continuation: continuation(
        work({
          agentId: "virgilio",
          state: "cancelled",
          outcomeReason: "destination_changed",
        }),
      ),
    });
    await f.show();
    expect(container.textContent).toContain("Not sent: Virgilio now uses a different service");
    f.performPlanProgressAction.mockResolvedValueOnce(failure("destination_changed"));
    await act(async () => buttonNamed("Try again").click());
    expect(f.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "retrySynthesis",
      taskId: id(2101),
    });
    expect(container.querySelector(".action-proposal [role=status]")?.textContent).toContain(
      "Nothing was sent: Virgilio now uses a different service than the one you approved. Choose ChatGPT for Virgilio",
    );
  });

  it("shows synthesis admission, restart holds, failures, recovery and durable stops after the plan outcome", async () => {
    const h = progressHarness();
    const show = async (synthesis = continuation(null)) => {
      h.update({ outcome: "partial", continuation: synthesis });
      await h.show();
    };
    await show();
    status(3, "circle-dashed", "Waiting to start");
    await show({ ...continuation(null), restartHeld: true });
    status(3, "circle-pause", "Paused: Ohtia stopped before it started");
    expect(buttonNamed("Continue all (3)")).toBeTruthy();
    const synthesisWork = (part: Partial<PlanTaskProgress>) =>
      continuation(work({ agentId: "virgilio", ...part }));
    for (const [part, icon, label] of [
      [{ state: "queued" }, "circle-dashed", "Waiting to start"],
      [{ state: "running" }, "pen-line", "Working…"],
      [{ state: "cancelling" }, "circle-stop", "Stopping…"],
      [
        { state: "blocked", blockingReason: "connection_disabled" },
        "unplug",
        "Waiting: ChatGPT isn’t connected",
      ],
      [
        { state: "blocked", blockingReason: "usage_limit_reached" },
        "circle-pause",
        "Paused: ChatGPT requests are paused",
      ],
      [{ state: "cancelled" }, "circle-stop", "Stopped"],
      [{ state: "completed", replyMessageId: saved.id }, "check-check", "Done"],
      [{ state: "failed", outcomeReason: "not_eligible" }, "octagon-alert", "Failed"],
      [{ state: "failed", outcomeReason: "input_too_large" }, "octagon-alert", "Failed"],
    ] as const) {
      await show(synthesisWork(part));
      status(3, icon, label);
      expect(buttonNamed("Try again")).toBeUndefined();
    }
    expect(container.textContent).toContain(
      "The plan’s results were longer than Ohtia can send for a synthesis.",
    );
    h.update({
      outcome: "partial",
      continuation: synthesisWork({
        connection: "anthropic_api_key",
        state: "failed",
        outcomeReason: "billing_limit_reached",
      }),
    });
    await h.show("en-US", {
      revision: 1,
      restart: 3,
      usage: [{ connection: "anthropic_api_key", count: 1 }],
    });
    await act(async () => buttonNamed("Resume Anthropic requests (1)").click());
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "resume",
      connection: "anthropic_api_key",
    });
    await h.show("en-US", { revision: 2, restart: 3, usage: [] });
    expect(buttonNamed("Resume Anthropic requests (1)")).toBeUndefined();
    await act(async () => buttonNamed("Try again").click());
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "retrySynthesis",
      taskId: id(2101),
    });
    await show(synthesisWork({ state: "failed", outcomeReason: "provider_unavailable" }));
    h.performPlanProgressAction.mockResolvedValueOnce(failure("plan_unfinished"));
    await act(async () => buttonNamed("Try again").click());
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "retrySynthesis",
      taskId: id(2101),
    });
    expect(container.querySelector(".action-proposal [role=status]")?.textContent).toBe(
      "Another plan in this conversation hasn’t finished. Wait for it to end, or stop or finish it on its card.",
    );
    await show(synthesisWork({ state: "uncertain" }));
    status(3, "triangle-alert", "Uncertain");
    await act(async () => buttonNamed("Start reply again").click());
    const dialog = container.querySelector("dialog[open]")!;
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((b) => b.textContent === "Start reply again")
        ?.click(),
    );
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "retrySynthesis",
      taskId: id(2101),
    });
    await show({ ...synthesisWork({ state: "uncertain" }), stopped: true });
    status(3, "circle-stop", "Stopped");
    expect(buttonNamed("Start reply again")).toBeUndefined();
    await show({ ...continuation(null), admission: "withdrawn" });
    status(3, "circle-stop", "Stopped");
    expect(buttonNamed("Stop plan")).toBeUndefined();
  });

  it("confirms ending with safe focus, preserves failed operation IDs and silently refreshes a stale finish", async () => {
    const h = progressHarness();
    await h.show();
    async function dialog(label: string, text: string) {
      const trigger = buttonNamed(label);
      expect(trigger.classList.contains("primitive-primary")).toBe(false);
      await act(async () => {
        trigger.focus();
        trigger.click();
      });
      const active = container.querySelector("dialog[open]")!;
      expect(active.textContent).toContain(text);
      expect(document.activeElement?.textContent).toBe("Close dialog");
      return [...active.querySelectorAll("button")].find((b) => b.textContent === label)!;
    }
    await dialog(
      "Stop plan",
      "Finished results stay. Work in progress stops and no synthesis is written.",
    );
    const focusedOnClose: EventTarget[] = [];
    const captureFocus = (event: FocusEvent) => {
      if (event.target) focusedOnClose.push(event.target);
    };
    document.addEventListener("focusin", captureFocus);
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    document.removeEventListener("focusin", captureFocus);
    expect(focusedOnClose).toEqual([buttonNamed("Stop plan")]);
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(buttonNamed("Stop plan"));
    expect(h.performPlanProgressAction).not.toHaveBeenCalled();
    h.performPlanProgressAction.mockRejectedValueOnce(new Error("storage unavailable"));
    const stop = await dialog("Stop plan", "Stop this plan?");
    await act(async () => stop.click());
    expect(container.querySelector(".action-proposal [role=alert]")?.textContent).toBe(
      "Ohtia couldn’t stop the plan. Nothing was saved; you can try again.",
    );
    const stopAgain = await dialog("Stop plan", "Stop this plan?");
    h.update({ outcome: "cancelled" });
    await act(async () => stopAgain.click());
    expect(buttonNamed("Stop plan")).toBeUndefined();
    expect(document.activeElement?.id).toBe(`message-${proposal.id}`);
    expect(h.performPlanProgressAction.mock.calls[0]).toEqual(
      h.performPlanProgressAction.mock.calls[1],
    );
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "cancel",
      planId: accepted.planId,
    });

    h.update({ needsAttention: true });
    await h.show();
    h.performPlanProgressAction.mockResolvedValueOnce(failure("storage_failed"));
    const finishEmpty = await dialog(
      "Finish plan",
      "It ends as failed, without a synthesis, because no contribution completed.",
    );
    await act(async () => finishEmpty.click());
    expect(container.querySelector(".action-proposal [role=alert]")?.textContent).toBe(
      "Ohtia couldn’t finish the plan. Nothing was saved; you can try again.",
    );
    h.update({
      needsAttention: true,
      contributions: [{ ...first, state: "completed", resultMessageId: saved.id }, second, third],
    });
    await h.show();
    const finish = await dialog(
      "Finish plan",
      "Virgilio will write the synthesis with the completed results.",
    );
    const reads = h.readPlanCard.mock.calls.length;
    h.performPlanProgressAction.mockResolvedValueOnce(failure("plan_state_changed"));
    h.update({
      outcome: "complete",
      continuation: continuation(work({ agentId: "virgilio", state: "running" })),
    });
    await act(async () => finish.click());
    expect(h.performPlanProgressAction.mock.calls[2]).toEqual(
      h.performPlanProgressAction.mock.calls[3],
    );
    expect(h.performPlanProgressAction).toHaveBeenLastCalledWith(expect.any(String), {
      kind: "finish",
      planId: accepted.planId,
    });
    expect(h.readPlanCard.mock.calls.length).toBeGreaterThan(reads);
    expect(container.querySelector(".action-proposal [role=alert]")).toBeNull();
    expect(container.querySelector(".action-proposal-state")?.textContent).toBe("Complete");
    expect(buttonNamed("Finish plan")).toBeUndefined();
    await dialog(
      "Stop plan",
      "Finished results and the plan’s outcome stay. The synthesis stops; any text it already wrote stays, marked as incomplete.",
    );
  });

  it("routes plan actions through the research port and refreshes visible plan revisions", async () => {
    const h = controllerHarness(false);
    h.items.splice(0, h.items.length, {
      ...proposal,
      state: "accepted",
      revision: accepted.revision,
    });
    const succeed = () => ok({ resultId: proposal.id });
    const ports = {
      cancelPlan: vi.fn(succeed),
      finishPlan: vi.fn(succeed),
      tryAgainContribution: vi.fn(succeed),
      startAgainContribution: vi.fn(succeed),
      tryAgainSynthesis: vi.fn(succeed),
      resumeUsagePause: vi.fn(succeed),
      continueAllTasks: vi.fn(succeed),
    };
    Object.assign(h.port, ports);
    try {
      h.controller.open(scope);
      await settle();
      const taskId = id(2220);
      const cases = [
        [{ kind: "cancel", planId: proposal.id }, ports.cancelPlan, { planId: proposal.id }],
        [{ kind: "finish", planId: proposal.id }, ports.finishPlan, { planId: proposal.id }],
        [
          { kind: "retryContribution", contributionId: first.id },
          ports.tryAgainContribution,
          { contributionId: first.id },
        ],
        [{ kind: "retryTask", taskId }, ports.tryAgainContribution, { taskId }],
        [{ kind: "restartTask", taskId }, ports.startAgainContribution, { taskId }],
        [{ kind: "retrySynthesis", taskId }, ports.tryAgainSynthesis, { taskId }],
        [
          { kind: "resume", connection: "chatgpt" },
          ports.resumeUsagePause,
          { connection: "chatgpt" },
        ],
        [{ kind: "continue" }, ports.continueAllTasks, undefined],
      ] as const;
      for (const [action, command, payload] of cases) {
        expect(await h.controller.performPlanProgressAction("operation", action)).toEqual({
          ok: true,
          value: { resultId: proposal.id },
        });
        if (payload) expect(command).toHaveBeenLastCalledWith("operation", payload);
        else expect(command).toHaveBeenLastCalledWith("operation");
      }
      expect(vi.mocked(h.port.readPauses).mock.calls.length).toBeGreaterThanOrEqual(2);
      const newer = { ...proposal, state: "accepted", revision: accepted.revision + 1 } as const;
      h.items[0] = newer;
      h.emit({
        ok: true,
        value: {
          kind: "planChanged",
          planId: proposal.id,
          revision: newer.revision,
          throughSequence: 4,
        },
      });
      await settle();
      expect(h.controller.snapshot().items).toContainEqual(newer);
      const reads = vi.mocked(h.port.readTimeline).mock.calls.length;
      h.emit({
        ok: true,
        value: {
          kind: "planChanged",
          planId: proposal.id,
          revision: newer.revision,
          throughSequence: 4,
        },
      });
      h.emit({
        ok: true,
        value: {
          kind: "planChanged",
          planId: id(2301),
          revision: newer.revision,
          throughSequence: 4,
        },
      });
      await settle();
      expect(h.port.readTimeline).toHaveBeenCalledTimes(reads);
    } finally {
      h.controller.dispose();
    }
  });

  it("preserves the timeline notice and the plan state for incomplete synthesis results", async () => {
    const task = reviewTask({
      id: id(2230),
      synthesis: true,
      synthesisStopped: true,
      synthesisPlanId: proposal.id,
      state: "cancelled",
      replyMessageId: saved.id,
      dispatched: true,
    });
    const readPlanCard = vi.fn(async () => ({
      ...accepted,
      outcome: "complete" as const,
      continuation: continuation(work({ agentId: "virgilio", state: "cancelled" })),
    }));
    const view = {
      readPlanCard,
      readPlanDestinations: vi.fn(async () => ({})),
      observePlanDestinations: vi.fn(() => () => {}),
      performPlanAction: vi.fn(),
      claimTaskNotice: vi.fn(() => true),
      performPlanProgressAction: vi.fn(),
    } as unknown as ConversationController;
    const incompleteReply = {
      ...saved,
      taskId: task.id,
      agentId: "virgilio",
      ending: "partial",
    } as const;
    await render(
      state([
        { ...proposal, state: "accepted", revision: accepted.revision },
        incompleteReply,
        task,
      ]),
      view,
    );
    status(3, "circle-stop", "Stopped");
    const notice = container.querySelector(`[data-timeline-id="${task.id}"] .conversation-notice`);
    expect(notice?.textContent).toContain("Incomplete — stopped by you");
    expect(notice?.hasAttribute("role")).toBe(false);
    expect(container.querySelector("[data-task-notice-announcement]")?.textContent).toBe("");
    expect(container.textContent).toContain("The research question remains unresolved.");
    expect(buttonNamed("Try again")).toBeUndefined();
    expect(buttonNamed("Start reply again")).toBeUndefined();
  });

  it("reads ordered plan text parts and reconciles a stale decision through the conversation controller", async () => {
    const h = controllerHarness(false);
    vi.stubGlobal("crypto", webcrypto);
    let connectionChanged: Parameters<FoundationPort["subscribeConnection"]>[1] | undefined;
    const dispose = vi.fn();
    const request = "한글".repeat(700);
    const reference = {
      source: `plan_request_${first.id}`,
      parts: 2,
      bytes: Buffer.byteLength(request),
      sha256: createHash("sha256").update(request).digest("hex"),
    };
    const readPlan = vi.fn(() =>
      ok({ ...open, contributions: [{ ...first, request: reference }] }),
    );
    const readTextPart = vi.fn(({ index }) =>
      ok({ text: index === 1 ? request.slice(0, 1000) : request.slice(1000) }),
    );
    const acceptPlan = vi.fn(() => call(failure("proposal_not_waiting")));
    const declinePlan = vi.fn(() => ok({ resultId: proposal.id }));
    Object.assign(h.port, {
      readPlan,
      readTextPart,
      acceptPlan,
      declinePlan,
      readDestination: vi.fn(({ agentId }) =>
        agentId === "virgilio"
          ? ok({ destination: { connection: "chatgpt" } })
          : call(failure("storage_failed")),
      ),
      subscribeConnection: vi.fn((_id, notify) => {
        connectionChanged = notify;
        return {
          ready: Promise.resolve({ ok: true, value: { subscriptionId: "plan-connection" } }),
          dispose,
        };
      }),
    });
    const refresh = vi.fn();
    try {
      h.controller.open(scope);
      const reload = vi.spyOn(h.controller, "reload").mockImplementation(() => {});
      await settle();
      h.items.push(proposal);
      expect(
        await h.controller.readPlanDestinations(scope.projectId, ["josefa", "virgilio"]),
      ).toEqual({ virgilio: "chatgpt" });
      const stop = h.controller.observePlanDestinations(refresh);
      connectionChanged?.({
        ok: true,
        value: { kind: "state", connection: "chatgpt" },
      } as unknown as Parameters<NonNullable<typeof connectionChanged>>[0]);
      h.emit({ ok: true, value: { kind: "destinationChanged", connection: "chatgpt" } });
      await settle();
      expect(refresh).toHaveBeenCalledTimes(2);
      stop();
      expect(dispose).toHaveBeenCalled();
      expect((await h.controller.readPlanCard(proposal.id)).contributions[0]?.request).toBe(
        request,
      );
      expect(readTextPart.mock.calls.map(([part]) => part.index)).toEqual([1, 2]);
      const controller = new AbortController();
      controller.abort();
      await expect(h.controller.readPlanCard(proposal.id, controller.signal)).rejects.toThrow(
        /abandoned/,
      );
      readPlan.mockImplementationOnce(
        () => call(failure("storage_failed")) as ReturnType<typeof readPlan>,
      );
      await expect(h.controller.readPlanCard(proposal.id)).rejects.toThrow(/unavailable/);
      readPlan.mockImplementationOnce(() =>
        ok({ ...open, conversationId: id(3333), contributions: [] }),
      );
      await expect(h.controller.readPlanCard(proposal.id)).rejects.toThrow(/scope/);
      expect(
        await h.controller.performPlanAction("show-again", proposal, {
          josefa: "openai",
          virgilio: "chatgpt",
        }),
      ).toEqual(failure("proposal_not_waiting"));
      expect(h.port.readTimeline).toHaveBeenCalledWith({
        conversationId: scope.conversationId,
        ids: [proposal.id],
      });
      expect(reload).not.toHaveBeenCalled();
      expect(await h.controller.performPlanAction("decline", proposal)).toEqual({
        ok: true,
        value: { resultId: proposal.id },
      });
      expect(declinePlan).toHaveBeenCalledWith("decline", { planId: proposal.id });
    } finally {
      h.controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("links a contribution back to the plan card", async () => {
    const revealMessage = vi.fn(async () => true);
    const result = {
      ...message(2181, "Candidate search terms."),
      authorKind: "agent",
      agentId: "josefa",
      taskId: id(6000),
      language: "en",
      ending: "complete",
      planContribution: { planId: proposal.id, key: first.key },
    } as TimelineItem;
    await render(state([result]), { revealMessage } as unknown as ConversationController);
    const link = container.querySelector<HTMLAnchorElement>(`a[href="#message-${proposal.id}"]`);
    expect(link?.textContent).toBe("Plan · vocabulary");
    await act(async () => link?.click());
    expect(revealMessage).toHaveBeenCalledWith(proposal.id);
  });
});

it("opens the return dialog on Close, preselects the latest Josefa reply, and retries an empty selection", async () => {
  const conversation: ConversationSummary = {
    ...summary,
    agentId: "josefa",
    ownerPosition: 11,
    ownerRevision: 2,
  };
  const listHandoffMessages = vi.fn(async () => ({
    ok: true as const,
    value: {
      priorReply: true,
      messages: [
        { position: 12, agentId: null, prefix: "**Search** in public catalogs.", truncated: false },
        {
          position: 13,
          agentId: "josefa" as const,
          prefix: "These terms are unverified.",
          truncated: false,
        },
      ],
    },
  }));
  const returnHandoff = vi.fn(async () => ({
    ok: false as const,
    error: {
      code: "conversation_busy",
      nextAction: "retry_later",
      parameters: { reason: "reply_active" },
    } as const,
  }));
  await act(async () =>
    root.render(
      h(HandoffReturnControl, {
        conversation,
        locale: "en-US",
        controller: { listHandoffMessages, returnHandoff },
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = container.querySelector("dialog")!;
  expect(document.activeElement?.textContent).toBe("Close dialog");
  expect(dialog.textContent).toContain("Virgilio will see his earlier part of this conversation");
  const [all, researcher, specialist] = Array.from(
    dialog.querySelectorAll<HTMLInputElement>("input"),
  );
  expect(all?.getAttribute("aria-checked")).toBe("mixed");
  expect(all?.indeterminate).toBe(true);
  expect(researcher?.labels?.[0]?.textContent).toBe("You: Search in public catalogs.");
  expect(specialist?.labels?.[0]?.textContent).toBe("Josefa: These terms are unverified.");
  expect(specialist?.checked).toBe(true);
  await act(async () => all!.click());
  expect(all?.getAttribute("aria-checked")).toBe("true");
  await act(async () => all!.click());
  expect(all?.getAttribute("aria-checked")).toBe("false");
  const proceed = dialog.querySelector<HTMLButtonElement>(".primitive-primary")!;
  await act(async () => proceed.click());
  expect(dialog.querySelector(".handoff-feedback")?.getAttribute("role")).toBe("status");
  expect(dialog.textContent).toContain("Wait until the current reply finishes, or stop it.");
  await act(async () => proceed.click());
  expect(returnHandoff).toHaveBeenNthCalledWith(1, expect.any(String), conversation.id, 2, "");
  expect(returnHandoff.mock.calls[0]).toEqual(returnHandoff.mock.calls[1]);
  await act(async () =>
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("refreshes an invalid return selection and keeps the attention notice and default specialist reply", async () => {
  const conversation: ConversationSummary = { ...summary, agentId: "josefa" };
  const listHandoffMessages = vi.fn(async () => ({
    ok: true as const,
    value: {
      priorReply: false,
      messages: [
        { position: 1, agentId: null, prefix: "Question", truncated: false },
        { position: 2, agentId: "josefa" as const, prefix: "Reply", truncated: false },
      ],
    },
  }));
  const returnHandoff = vi.fn(async () => failure("selection_invalid"));
  await act(async () =>
    root.render(
      h(HandoffReturnControl, {
        conversation,
        locale: "en-US",
        controller: { listHandoffMessages, returnHandoff },
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  const dialog = container.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Virgilio will see the messages you select:");
  await act(async () => dialog.querySelectorAll("input")[2]!.click());
  await act(async () => dialog.querySelector<HTMLButtonElement>(".primitive-primary")!.click());
  expect(listHandoffMessages).toHaveBeenCalledTimes(2);
  expect(dialog.querySelector(".handoff-feedback")?.getAttribute("role")).toBe("status");
  expect(dialog.textContent).toContain(
    "Ohtia couldn’t use this selection. Choose the messages again.",
  );
  expect(dialog.querySelectorAll("input")[2]?.checked).toBe(true);
});

it("shows and retries a handoff proposal with attributed note, destination, decision and feedback", async () => {
  const proposal: TimelineHandoffProposal = {
    id: id(8100),
    kind: "handoffProposal",
    rank: 2,
    revision: 1,
    position: 12,
    taskId: id(8101),
    expectedOwnerRevision: 1,
    state: "proposed",
    invalidReason: null,
    note: "The researcher chose public schools.",
    reason: "Refine a search strategy.",
  };
  const performHandoffAction = vi
    .fn<ConversationController["performHandoffAction"]>()
    .mockResolvedValueOnce({
      ok: false,
      error: {
        code: "conversation_busy",
        nextAction: "retry_later",
        parameters: { reason: "plan_unfinished" },
      },
    })
    .mockResolvedValueOnce(failure("storage_failed"))
    .mockResolvedValueOnce(failure("owner_changed"))
    .mockResolvedValue({ ok: true, value: { resultId: proposal.id } });
  const render = async (next: TimelineHandoffProposal, service: string | undefined = "ChatGPT") => {
    await act(async () =>
      root.render(
        h(HandoffProposal, {
          proposal: next,
          note: (next.note as string) ?? "",
          locale: "en-US",
          hasText: false,
          documentLanguage: "en",
          controller: { performHandoffAction },
          service,
        }),
      ),
    );
  };
  await render(proposal);
  expect(container.textContent).toContain("Virgilio proposes continuing with Josefa");
  expect(container.textContent).toContain("Waiting for your answer");
  expect(container.textContent).toContain("Josefa · ChatGPT");
  expect(container.textContent).toContain("Note for Josefa:The researcher chose public schools.");
  const accept = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Continue with Josefa",
  )!;
  await act(async () => accept.click());
  expect(container.querySelector(".handoff-feedback")?.getAttribute("role")).toBe("status");
  expect(container.textContent).toContain("Wait until the plan ends, or stop or finish it.");
  await act(async () => accept.click());
  expect(container.querySelector(".handoff-feedback")?.getAttribute("role")).toBe("alert");
  expect(container.textContent).toContain("Ohtia couldn’t continue with Josefa.");
  await act(async () => accept.click());
  expect(container.textContent).toContain("The conversation changed. Review the proposal again.");
  expect(performHandoffAction.mock.calls[0]).toEqual(performHandoffAction.mock.calls[1]);
  await render({ ...proposal, state: "accepted", revision: 2 });
  expect(container.textContent).toContain("Accepted. Josefa continues from here.");
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await render({
    ...proposal,
    state: "invalid",
    invalidReason: "reason_too_long",
    note: null,
    reason: null,
  });
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "longer than 500 characters",
  );
  expect(container.textContent).toContain("Virgilio will see this in his next reply.");
  await act(async () => root.render(h(HandoffDivider, { agent: "josefa", locale: "en-US" })));
  expect(container.querySelector(".handoff-divider > svg")?.getAttribute("width")).toBe("16");
  expect(container.textContent).toBe("Josefa continues from here");
});

it("refreshes ownership and timeline after decisions and reads paged return previews", async () => {
  const harness = controllerHarness(false);
  vi.stubGlobal("crypto", webcrypto);
  const proposal: TimelineHandoffProposal = {
    id: id(9600),
    kind: "handoffProposal",
    taskId: id(9601),
    position: 121,
    expectedOwnerRevision: 1,
    rank: 2,
    revision: 1,
    state: "proposed",
    note: "Only this context may be shared.",
    reason: "Review search terms.",
    invalidReason: null,
  };
  harness.items.push(proposal);
  harness.port.readDestination = vi.fn(() =>
    ok({
      destination: {
        connection: "chatgpt",
        operation: "search_strategy_planning",
        maxAttemptDurationMs: 600000,
      },
    }),
  );
  let owner = summary;
  harness.port.readConversations = vi.fn(() => ok({ items: [owner], remaining: [] }));
  harness.port.acceptHandoff = vi.fn((_operation, input) => {
    expect(input).toMatchObject({ proposalId: proposal.id, expectedOwnerRevision: 1 });
    owner = { ...summary, agentId: "josefa", ownerRevision: 2, ownerPosition: 122, revision: 2 };
    const row = harness.items.findIndex(({ id }) => id === proposal.id);
    harness.items[row] = { ...proposal, state: "accepted", revision: 2 };
    harness.items.push({
      kind: "handoffDivider",
      id: id(9602),
      position: 122,
      rank: 1,
      revision: 1,
      agentId: "josefa",
    });
    return ok({ resultId: proposal.id });
  });
  harness.port.declineHandoff = vi.fn(() => call(failure("proposal_not_waiting")));
  harness.port.listHandoffSelection = vi.fn(({ after }) => {
    const position = after + 1;
    return ok({
      priorReply: true,
      next: after === 0 ? position : null,
      messages: [{ position, agentId: "josefa" as const, prefix: "Reply", truncated: false }],
    });
  });
  harness.port.returnHandoff = vi.fn(() => {
    owner = { ...summary, ownerRevision: 3, ownerPosition: 123, revision: 3 };
    return ok({ resultId: id(9603) });
  });
  try {
    harness.controller.open(scope);
    await settle();
    await harness.controller.refreshConsultationDestination();
    const open = harness.controller.snapshot();
    expect(open.texts.get(proposal.id)).toBe(proposal.note);
    expect(open.consultationDestination).toBe("chatgpt");
    await render(open, harness.controller);
    expect(container.textContent).toContain("Josefa · ChatGPT");
    await act(async () => {
      expect(await harness.controller.performHandoffAction("accept", proposal, "accept")).toEqual({
        ok: true,
        value: { resultId: proposal.id },
      });
    });
    expect(harness.controller.snapshot().conversation?.agentId).toBe("josefa");
    await act(async () => {
      expect(
        await harness.controller.performHandoffAction("stale-decline", proposal, "decline"),
      ).toEqual(failure("proposal_not_waiting"));
    });
    expect(
      await harness.controller.listHandoffMessages(
        scope.conversationId,
        2,
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: true, value: { messages: [{ position: 1 }, { position: 2 }] } });
    expect(
      await harness.controller.listHandoffMessages(scope.conversationId, 2, AbortSignal.abort()),
    ).toEqual(failure("cancelled"));
    const switched = harness.controller.snapshot();
    const failed = reviewTask({
      id: id(9605),
      position: 120,
      agentId: "virgilio",
      state: "failed",
      outcomeReason: "provider_error",
    });
    await render({ ...switched, items: [...switched.items, failed] }, harness.controller);
    expect(container.textContent).toContain("Josefa continues from here");
    expect(container.textContent).toContain(
      "This reply was from Virgilio, before the conversation moved to Josefa.",
    );
    expect(
      await harness.controller.returnHandoff("return", scope.conversationId, 2, "1,2"),
    ).toEqual({ ok: true, value: { resultId: id(9603) } });
    expect(harness.port.returnHandoff).toHaveBeenCalledWith("return", {
      conversationId: scope.conversationId,
      expectedOwnerRevision: 2,
      selection: "1,2",
    });
    expect(harness.controller.snapshot().conversation?.agentId).toBe("virgilio");
  } finally {
    harness.controller.dispose();
    vi.unstubAllGlobals();
  }
});

it("shows the approved replacement fields and repeats Apply with its original operation ID", async () => {
  const decide = vi
    .fn()
    .mockResolvedValueOnce(failure("storage_failed"))
    .mockResolvedValueOnce(invalidPlanChange("plan_moved_on"));
  const item = {
    kind: "planChangeProposal",
    id: id(700),
    taskId: id(701),
    position: 20,
    rank: 2,
    revision: 1,
    state: "proposed",
    invalidReason: null,
  } as const;
  const before = {
    key: "comparison",
    state: "active",
    taskState: "running",
    blockingReason: null,
    blockedBy: null,
    waitingFor: [],
    restartHeld: false,
    connection: "chatgpt",
  } as const;
  await act(async () =>
    root.render(
      h(PlanChangeProposal, {
        proposal: item,
        locale: "en-US",
        language: "en",
        hasText: true,
        texts: new Map(),
        connectionName: () => "ChatGPT",
        decide,
        preview: {
          removed: [],
          added: [],
          unchanged: [],
          purpose: "Revised question",
          context: null,
          additionalRequests: 2,
          remainingRequests: 21,
          maxRequests: 24,
          replaced: [
            {
              before,
              after: {
                agentId: "josefa",
                connection: "chatgpt",
                key: "comparison",
                required: false,
                prerequisites: [],
                changed: ["request", "required", "prerequisites"],
                request: "Compare the terms from open catalogs.",
                reason: "A focused comparison.",
              },
            },
          ],
        },
      }),
    ),
  );
  expect(container.textContent).toContain("Waiting for your answer");
  expect(container.textContent).toContain("Stops when you apply this change.");
  expect(container.textContent).toContain("Optional (changed)");
  expect(container.textContent).toContain("After: none (changed)");
  expect(container.textContent).toContain("Request (changed):");
  expect(container.textContent).toContain("Reason:");
  const apply = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Apply change",
  );
  expect(apply).toBeDefined();
  await act(async () => apply?.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Ohtia couldn’t apply");
  await act(async () => apply?.click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "The plan has moved on since Virgilio proposed this. Ask him again.",
  );
  expect(decide).toHaveBeenCalledTimes(2);
  expect(decide.mock.calls[0]).toEqual(decide.mock.calls[1]);
});

describe("plan change timeline", () => {
  const proposal: TimelinePlanChangeProposal = {
    kind: "planChangeProposal",
    id: id(9700),
    taskId: id(9701),
    position: 20,
    rank: 2,
    revision: 1,
    state: "proposed",
    invalidReason: null,
  };
  const baseRow: PlanChangeRow = {
    key: "background",
    connection: "chatgpt",
    state: "waiting",
    taskState: null,
    blockingReason: null,
    waitingFor: [],
    blockedBy: null,
    restartHeld: false,
  };
  const emptyPreview: PlanChangePreview = {
    removed: [],
    replaced: [],
    added: [],
    unchanged: [],
    purpose: null,
    context: null,
    additionalRequests: 2,
    remainingRequests: 21,
    maxRequests: 24,
  };

  it("renders invalid proposals as notices without approval controls", async () => {
    const controller = { performPlanChange: vi.fn() } as unknown as ConversationController;
    for (const [reason, detail] of [
      ["too_many_changes", "The proposal had more than 8 changes."],
      ["dependency_removed", "A waiting contribution still depended on one it removed."],
      ["cycle", "Some contributions depended on each other in a loop."],
      ["plan_moved_on", "The plan has moved on since Virgilio proposed this. Ask him again."],
    ] as const) {
      await render(state([{ ...proposal, state: "invalid", invalidReason: reason }]), controller);
      const status = container.querySelector('[role="status"]');
      expect(status?.textContent).toContain(detail);
      if (reason !== "plan_moved_on")
        expect(status?.textContent).toContain("You can ask him again.");
      expect(container.querySelector(".action-proposal")).toBeNull();
    }
  });

  it("discloses stopped, added and unchanged work and restores focus after declining", async () => {
    const decide = vi
      .fn()
      .mockRejectedValueOnce(new Error("Synthetic transport failure"))
      .mockResolvedValueOnce(failure("event_limit_reached"))
      .mockResolvedValueOnce({ ok: true, value: { resultId: proposal.id } });
    const preview: PlanChangePreview = {
      ...emptyPreview,
      removed: [{ ...baseRow, state: "active", taskState: "running" }],
      replaced: [
        {
          before: { ...baseRow, key: "screening", state: "failed" },
          after: {
            key: "screening",
            agentId: "josefa",
            connection: "chatgpt",
            required: true,
            prerequisites: ["keywords"],
            request: "Use the screening criteria.",
            reason: "New scope.",
            changed: ["required", "prerequisites", "reason"],
          },
        },
      ],
      added: [
        {
          key: "terminology",
          agentId: "josefa",
          connection: "chatgpt",
          required: true,
          prerequisites: ["keywords"],
          request: "Compare terminology.",
          reason: "Vocabulary matters.",
          changed: [],
        },
        {
          key: "optional",
          agentId: "josefa",
          connection: "chatgpt",
          required: false,
          prerequisites: [],
          request: "List optional indexes.",
          reason: "For later use.",
          changed: [],
        },
      ],
      unchanged: [
        { ...baseRow, key: "keywords", state: "completed" },
        { ...baseRow, key: "waiting", waitingFor: ["screening"] },
        { ...baseRow, key: "blocked", state: "blocked", blockedBy: "screening" },
        { ...baseRow, key: "uncertain", state: "uncertain" },
        { ...baseRow, key: "cancelled", state: "cancelled" },
        { ...baseRow, key: "restart", restartHeld: true },
      ],
      purpose: "Focus on terminology.",
      context: "Use the synthetic case.",
    };
    const controller = { performPlanChange: decide } as unknown as ConversationController;
    const show = (item: TimelinePlanChangeProposal, changePreview = preview) =>
      render({ ...state([item]), planChanges: new Map([[item.id, changePreview]]) }, controller);
    await show(proposal);
    const card = container.querySelector(".action-proposal");
    for (const text of [
      "Removed:",
      "Stops when you apply this change.",
      "screening · Failed",
      "Added:",
      "Required (changed)",
      "After: keywords (changed)",
      "After: keywords",
      "Reason (changed):",
      "Request:Compare terminology.",
      "optional · Optional",
      "Unchanged:",
      "keywords · Done",
      "waiting · Waiting for screening",
      "blocked · Blocked by screening",
      "uncertain · Uncertain",
      "cancelled · Cancelled",
      "restart · Paused: Ohtia stopped before it started",
      "Focus on terminology.",
      "Use the synthetic case.",
    ])
      expect(card?.textContent).toContain(text);

    const decline = buttonNamed("Decline change");
    decline.focus();
    await act(async () => {
      decline.click();
      decline.click();
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(card?.querySelector('[role="alert"]')?.textContent).toContain("Ohtia couldn’t decline");
    await act(async () => decline.click());
    expect(card?.querySelector('[role="status"]')?.textContent).toContain(
      "most changes Ohtia records",
    );
    await act(async () => decline.click());
    expect(decide.mock.calls[0]).toEqual(decide.mock.calls[2]);
    await show({ ...proposal, state: "declined", revision: 2 });
    expect(container.textContent).toContain("You declined this change.");
    expect(document.activeElement).toBe(container.querySelector(".action-proposal")?.parentElement);
    expect(container.querySelector(".action-proposal button")).toBeNull();

    await show(
      { ...proposal, state: "replaced", revision: 2 },
      {
        ...emptyPreview,
        unchanged: [
          { ...baseRow, key: "stopping", state: "active", taskState: "cancelling" },
          {
            ...baseRow,
            key: "offline",
            state: "active",
            taskState: "blocked",
            blockingReason: "connection_disabled",
          },
          {
            ...baseRow,
            key: "paused",
            state: "active",
            taskState: "blocked",
            blockingReason: "usage_limit_reached",
          },
          { ...baseRow, key: "ready" },
        ],
      },
    );
    for (const text of [
      "Replaced by a newer proposal.",
      "Stopping",
      "Waiting: ChatGPT isn’t connected",
      "Paused: ChatGPT requests are paused",
      "Waiting to start",
    ])
      expect(container.querySelector(".action-proposal")?.textContent).toContain(text);
  });

  it("hydrates multipart plan changes and synthesis references and refreshes decisions", async () => {
    const harness = controllerHarness(false);
    const context = "The synthetic project uses local catalogs. ".repeat(140);
    const reference = (source: string, text: string) => ({
      source,
      parts: text.length > 4096 ? 2 : 1,
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    const contextPart = reference("plan_change_context", context);
    const sources = JSON.stringify([
      { key: "background", agentId: "josefa", state: "removed", messageId: null },
      { key: "screening", agentId: "josefa", state: "replaced", messageId: null },
    ]);
    const synthesisPart = reference("synthesis_sources", sources);
    const guidance: TimelineItem = {
      ...message(proposal.position, "Here is the updated plan."),
      authorKind: "agent",
      agentId: "virgilio",
      taskId: proposal.taskId,
      language: "en",
      ending: "complete",
    } as TimelineItem;
    const synthesis: TimelineItem = {
      ...guidance,
      id: id(9720),
      position: 21,
      taskId: id(9721),
      content: "This is the synthesis.",
      synthesisSources: synthesisPart,
    } as TimelineItem;
    const preview = { ...emptyPreview, proposalId: proposal.id, context: contextPart };
    const previewRead = vi.fn(() => ok(preview));
    const apply = vi.fn(() => {
      harness.items[1] = { ...proposal, state: "applied", revision: 2 };
      return ok({ resultId: proposal.id });
    });
    const decline = vi.fn(() => {
      harness.items[1] = { ...proposal, state: "replaced", revision: 3 };
      return call(failure("proposal_not_waiting"));
    });
    const readTextPart = vi.fn(({ source, index }: { source: string; index: number }) => {
      const text = source === contextPart.source ? context : sources;
      return ok({ text: text.slice((index - 1) * 4096, index * 4096) });
    });
    harness.items.splice(0, harness.items.length, guidance, proposal, synthesis);
    Object.assign(harness.port, {
      readTextPart,
      readPlanChange: previewRead,
      applyPlanChange: apply,
      declinePlanChange: decline,
    });
    try {
      harness.controller.open(scope);
      await vi.waitFor(() =>
        expect(harness.controller.snapshot().texts.get(contextPart.source)).toBe(context),
      );
      const snapshot = harness.controller.snapshot();
      expect(previewRead).toHaveBeenCalledWith({
        conversationId: scope.conversationId,
        proposalId: proposal.id,
      });
      expect(readTextPart).toHaveBeenCalledWith({ source: contextPart.source, index: 2 });
      expect(readTextPart).toHaveBeenCalledWith({ source: synthesisPart.source, index: 1 });
      await render(snapshot, harness.controller);
      expect(container.querySelector(".action-proposal")?.textContent).toContain(context);
      expect(container.querySelector(".synthesis-references")?.textContent).toBe(
        "Based on: background · Josefa (removed) and screening · Josefa (replaced)",
      );
      await act(async () => buttonNamed("Apply change").click());
      expect(apply).toHaveBeenCalledWith(expect.any(String), { proposalId: proposal.id });
      await render(harness.controller.snapshot(), harness.controller);
      expect(container.textContent).toContain("Applied to the plan.");
      await act(async () => {
        await expect(
          harness.controller.performPlanChange("stale-decline", proposal.id, false),
        ).resolves.toEqual(failure("proposal_not_waiting"));
      });
      expect(decline).toHaveBeenCalledWith("stale-decline", { proposalId: proposal.id });
      expect(harness.controller.snapshot().items).toContainEqual({
        ...proposal,
        state: "replaced",
        revision: 3,
      });

      const reload = vi.spyOn(harness.controller, "reload").mockImplementation(() => {});
      vi.mocked(harness.port.readTimeline).mockReturnValueOnce(call(failure("storage_failed")));
      await act(async () => {
        await harness.controller.performPlanChange("refresh-failed", proposal.id, true);
      });
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      await act(async () => harness.controller.dispose());
    }
  });
});

it("renders the localized memory summary and restores keyboard focus after undo", async () => {
  const item = {
    id: id(88),
    taskId: id(89),
    kind: "memoryChange",
    rank: 3,
    revision: 1,
    position: 8,
    added: 1,
    edited: 0,
    merged: 2,
    withdrawn: 0,
    rejected: 1,
    canUndo: true,
  } as const;
  const harness = controllerHarness(false);
  const reply = {
    ...message(7, "An earlier reply used the former project memory."),
    kind: "message",
    authorKind: "agent",
    agentId: "virgilio",
    taskId: id(94),
    language: "en",
    ending: "complete",
  } as const;
  const review = {
    id: id(95),
    taskId: reply.taskId,
    kind: "memoryReview",
    rank: 4,
    revision: 1,
    position: reply.position,
  } as const;
  harness.items.splice(0, harness.items.length, reply, review, item);
  const undo = vi.fn(() => {
    harness.items[2] = { ...item, revision: 2, canUndo: false };
    return ok({ resultId: item.taskId });
  });
  harness.port.undoMemory = undo;
  try {
    harness.controller.open(scope);
    await vi.waitFor(() => expect(harness.controller.snapshot().items).toHaveLength(3));
    await render(harness.controller.snapshot(), harness.controller);
    expect(container.textContent).toContain("Memory updated: 1 added and 2 merged");
    expect(container.textContent).toContain(
      "Memory not updated: 1 change didn’t fit Ohtia’s rules.",
    );
    expect(container.textContent).toContain(
      "Based on project memory that has changed since this reply.",
    );
    const memory = container.querySelector(".memory-reply")!;
    const button = memory.querySelector("button")!;
    expect(button.textContent).toBe("Undo memory changes");
    button.focus();
    await act(async () => button.click());
    expect(undo).toHaveBeenCalledWith(expect.any(String), { taskId: item.taskId });
    expect(harness.controller.snapshot().items).toContainEqual({
      ...item,
      revision: 2,
      canUndo: false,
    });
    expect(memory.querySelector("button")).toBeNull();
    expect(memory.querySelector('[role="status"]')?.textContent).toBe("Memory changes undone.");
    expect(document.activeElement).toBe(memory.querySelector(".memory-caption"));

    const reload = vi.spyOn(harness.controller, "reload").mockImplementation(() => {});
    vi.mocked(harness.port.readTimeline).mockReturnValueOnce(call(failure("storage_failed")));
    await act(async () => {
      await harness.controller.performMemoryUndo("refresh-failed", item.taskId, item.id);
    });
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => harness.controller.dispose());
  }
});

it("shows memory undo conflicts and stale reply captions with their accessible status", async () => {
  const item = {
    id: id(90),
    taskId: id(91),
    kind: "memoryChange",
    rank: 3,
    revision: 1,
    position: 8,
    added: 0,
    edited: 1,
    merged: 0,
    withdrawn: 0,
    rejected: 3,
    canUndo: true,
  } as const;
  const render = (undo: Parameters<typeof MemoryChangeLine>[0]["undo"]) =>
    root.render(
      h(
        "div",
        null,
        h(MemoryChangeLine, { item, locale: "en-US", undo, showVoice: false }),
        h(MemoryReviewLine, {
          locale: "en-US",
          item: {
            id: id(92),
            taskId: id(91),
            position: 8,
            rank: 4,
            revision: 1,
            kind: "memoryReview",
          },
        }),
      ),
    );
  await act(async () => render(async () => failure("undo_unavailable")));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('.conversation-notice[role="status"]')?.textContent).toBe(
    "Ohtia can’t undo these changes because an entry has changed since. Edit it in the project memory instead.",
  );
  expect(container.textContent).toContain(
    "Memory not updated: 3 changes didn’t fit Ohtia’s rules.",
  );
  expect(container.textContent).toContain(
    "Based on project memory that has changed since this reply.",
  );
  await act(async () => render(async () => failure("memory_full")));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('.conversation-notice[role="status"]')?.textContent).toBe(
    "The project memory is full. Shorten or withdraw entries, then undo these changes.",
  );
});

it("preserves a sourced memory draft through a second window revision and recovers history after a sequence gap", async () => {
  const projectId = scope.projectId;
  const entryId = id(1);
  const messageId = id(2);
  const version = {
    number: 1,
    kind: "decision",
    text: "Use municipal registers.",
    state: "active",
    change: "added",
    author: "virgilio",
    date: "2026-11-03T12:00:00.000Z",
  } as const;
  let revision = 1;
  let currentText: string = version.text;
  const port = {
    listMemory: vi.fn(() =>
      ok({
        projectId,
        revision,
        entries: [
          {
            ...version,
            text: currentText,
            id: entryId,
            number: revision,
            originalAuthor: "virgilio",
            source: {
              messageId,
              conversationId: scope.conversationId,
              prefix: "Use **municipal registers**.",
              truncated: false,
            },
          },
        ],
        next: null,
        bytes: 100,
        active: 1,
      } satisfies ResearchOutputs["memory.list"]),
    ),
    readMemoryHistory: vi.fn(() => ok({ entryId, versions: [version], next: null })),
    readTextPart: vi.fn(),
    sendTextPart: vi.fn(),
    addMemory: vi.fn(() => ok({ resultId: entryId })),
    editMemory: vi
      .fn()
      .mockImplementationOnce(() => call(staleRevision(3)))
      .mockImplementation(() => ok({ resultId: entryId })),
    withdrawMemory: vi
      .fn()
      .mockImplementationOnce(() => call(staleRevision(4)))
      .mockImplementationOnce(() => call(failure("uncertain")))
      .mockImplementationOnce(() => call(failure("storage_failed")))
      .mockImplementation(() => ok({ resultId: entryId })),
  };
  let observe: ((notice: Outcome<ResearchEvent> | "ready") => void) | undefined;
  const goToMessage = vi.fn();
  const props = {
    projectId,
    port,
    locale: "en-US" as const,
    goToMessage,
    observe: (listener: NonNullable<typeof observe>) => {
      observe = listener;
      return () => {
        observe = undefined;
      };
    },
    draftRequest: undefined,
    drafts: new ProjectMemoryDrafts(),
  };
  await act(async () => root.render(h(ProjectMemoryView, props)));
  const button = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent?.trim() === label,
    )!;
  expect(container.textContent).toContain("From your message · worded by Virgilio");
  expect(container.querySelector("q")?.textContent).toBe("Use municipal registers.");
  await act(async () => container.querySelector<HTMLAnchorElement>("q + a")!.click());
  expect(goToMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId }));
  await act(async () => button("Show entry history").click());
  expect(button("Hide entry history").hasAttribute("aria-expanded")).toBe(false);
  expect(container.textContent).toContain("Added · Recorded by Virgilio");
  await act(async () => button("Edit entry").click());
  expect(container.querySelector("textarea")?.value).toBe("Use municipal registers.");
  await act(async () => button("Add memory entry…").click());
  currentText = "Use the municipal archive.";
  await act(async () =>
    observe!({
      ok: true,
      value: { kind: "changed", record: "memory", id: projectId, revision: ++revision },
    }),
  );
  await act(async () => button("Edit entry").click());
  expect(container.querySelector("textarea")?.value).toBe(currentText);
  const text = container.querySelector("textarea")!;
  expect(document.activeElement).toBe(text);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      text,
      "Retain this draft.",
    );
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
  revision = 3;
  await act(async () =>
    observe!({ ok: true, value: { kind: "changed", record: "memory", id: projectId, revision } }),
  );
  expect(port.listMemory).toHaveBeenCalledTimes(3);
  expect(port.readMemoryHistory).toHaveBeenCalledTimes(3);
  await act(async () => button("Save entry").click());
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "This entry changed in another window.",
  );
  expect(container.querySelector("textarea")?.value).toBe("Retain this draft.");
  await act(async () => button("Save entry").click());
  expect(
    port.editMemory.mock.calls.map(([, payload]) => [payload.expectedVersion, payload.text]),
  ).toEqual([
    [2, "Retain this draft."],
    [3, "Retain this draft."],
  ]);
  expect(container.querySelector("textarea")).toBeNull();
  await act(async () => observe!(failure("sequence_gap")));
  expect(port.readMemoryHistory).toHaveBeenCalledTimes(6);
  await act(async () =>
    root.render(
      h(ProjectMemoryView, {
        ...props,
        draftRequest: { sequence: 1, source: { messageId, researcherText: "My words." } },
      }),
    ),
  );
  expect(container.querySelector("select")?.value).toBe("decision");
  expect(container.querySelector("textarea")?.value).toBe("My words.");
  await act(async () => button("Save entry").click());
  expect(port.addMemory).toHaveBeenCalledWith(expect.any(String), {
    projectId,
    sourceMessageId: messageId,
    kind: "decision",
    text: "My words.",
  });
  await act(async () => button("Withdraw entry").click());
  expect(document.activeElement).toBe(container.querySelector("dialog [data-close]"));
  expect(port.withdrawMemory).not.toHaveBeenCalled();
  const dialog = container.querySelector("dialog")!;
  const confirm = [...dialog.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === "Withdraw entry",
  )!;
  await act(async () => confirm.click());
  expect(port.withdrawMemory).toHaveBeenCalledWith(expect.any(String), {
    entryId,
    expectedVersion: 3,
  });
  expect(dialog.textContent).toContain("Confirm again to withdraw that version.");
  await act(async () => confirm.click());
  expect(port.withdrawMemory.mock.calls[1]?.[1]).toEqual({ entryId, expectedVersion: 4 });
  expect(dialog.textContent).toContain("couldn’t confirm that this entry was withdrawn");
  await act(async () => confirm.click());
  expect(port.withdrawMemory.mock.calls[2]).toEqual(port.withdrawMemory.mock.calls[1]);
  expect(dialog.textContent).toContain("couldn’t withdraw this entry.");
  await act(async () => confirm.click());
  expect(port.withdrawMemory.mock.calls[3]?.[0]).not.toBe(port.withdrawMemory.mock.calls[2]?.[0]);
  expect(container.querySelector("dialog[open]")).toBeNull();
});

it("retains project memory drafts and their exact source through navigation and an uncertain save", async () => {
  const projectId = scope.projectId;
  const drafts = new ProjectMemoryDrafts();
  const port = {
    listMemory: vi.fn(({ projectId: current }: ResearchInputs["memory.list"]) =>
      ok({ projectId: current, revision: 0, entries: [], next: null, bytes: 0, active: 0 }),
    ),
    readMemoryHistory: vi.fn(),
    readTextPart: vi.fn(),
    sendTextPart: vi.fn(),
    addMemory: vi.fn(),
    editMemory: vi.fn(),
    withdrawMemory: vi.fn(),
  };
  const props = {
    drafts,
    port,
    locale: "en-US" as const,
    observe: () => () => {},
    goToMessage() {},
  };
  const first = { sequence: 1, source: { messageId: id(901), researcherText: "My own decision." } };
  const second = { sequence: 2, source: { messageId: id(902) } };
  const select = (request: typeof first | typeof second | undefined, current = projectId) =>
    act(async () =>
      root.render(
        h(ProjectMemoryView, { ...props, key: current, projectId: current, draftRequest: request }),
      ),
    );
  const form = () => container.querySelector("textarea")!;
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label,
    )!;
  function type(text: string) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      form(),
      text,
    );
    form().dispatchEvent(new Event("input", { bubbles: true }));
  }
  await select(first);
  expect(form().value).toBe("My own decision.");
  await act(async () => type("A preserved draft."));
  await select(second);
  expect(container.querySelector("select")?.value).toBe("note");
  expect(form().value).toBe("");
  await act(async () => button("Save entry").click());
  expect(container.querySelector("[role=status]")?.textContent).toContain("Enter the entry text");
  await act(async () => type("x".repeat(2001)));
  expect(container.querySelector("[role=status]")?.textContent).toContain("Remove 1 character");
  await act(async () => type("Sourced from the agent."));
  let resolve!: (result: Outcome<ResearchResult>) => void;
  port.addMemory
    .mockImplementationOnce(() => ({
      result: new Promise<Outcome<ResearchResult>>((done) => {
        resolve = done;
      }),
      cancel() {},
    }))
    .mockImplementationOnce(() => call(failure("memory_full")))
    .mockImplementationOnce(() => ok({ resultId: id(903) }));
  await act(async () => button("Save entry").click());
  await select(undefined, id(1002));
  expect(form()).toBeNull();
  await act(async () => resolve(failure("uncertain")));
  await select(second);
  expect(form().value).toBe("Sourced from the agent.");
  expect(container.textContent).toContain("couldn’t confirm that this entry was saved");
  await act(async () => button("Save entry").click());
  expect(port.addMemory.mock.calls[1]).toEqual(port.addMemory.mock.calls[0]);
  expect(port.addMemory.mock.calls[1]?.[1]).toMatchObject({
    sourceMessageId: second.source.messageId,
  });
  expect(container.textContent).toContain("The project memory is full.");
  await act(async () => button("Save entry").click());
  expect(port.addMemory.mock.calls[2]?.[0]).not.toBe(port.addMemory.mock.calls[1]?.[0]);
  await select(undefined, id(1002));
  await select(second);
  expect(form()).toBeNull();
  await select({ ...first, sequence: 3 });
  expect(form().value).toBe("A preserved draft.");
  await select({ sequence: 4, source: { messageId: id(904), researcherText: "x".repeat(2001) } });
  expect(container.querySelector("select")?.value).toBe("note");
  expect(form().value).toBe("");
  await act(async () => button("Discard changes").click());
  expect(form()).toBeNull();
});

it("recovers memory and history failures and keeps withdrawn entries inspectable", async () => {
  const entryId = id(601);
  const projectId = scope.projectId;
  const date = "2026-11-09T12:00:00.000Z";
  const stored = "🧪".repeat(1200);
  const parts = ["🧪".repeat(1024), "🧪".repeat(176)];
  const body = {
    source: "memory_body",
    bytes: 4800,
    parts: 2,
    sha256: createHash("sha256").update(stored).digest("hex"),
  };
  const added = {
    number: 1,
    kind: "note",
    text: "The original.",
    state: "active",
    change: "added",
    author: "virgilio",
    date,
  } as const;
  const entry = {
    ...added,
    id: entryId,
    originalAuthor: "virgilio",
    source: null,
    number: 4,
    state: "withdrawn",
    change: "undone",
    author: "researcher",
    text: body,
  } as const;
  const one = deferred<Outcome<ResearchOutputs["memory.list"]>>();
  const two = deferred<Outcome<ResearchOutputs["memory.history"]>>();
  const port = {
    listMemory: vi
      .fn()
      .mockImplementationOnce(() => ({ result: one.promise, cancel() {} }))
      .mockImplementation(() =>
        ok({ projectId, revision: 4, entries: [entry], next: null, bytes: 0, active: 0 }),
      ),
    readTextPart: vi.fn(({ index }: ResearchInputs["text.readPart"]) =>
      ok({ text: parts[index - 1]! }),
    ),
    readMemoryHistory: vi
      .fn()
      .mockImplementationOnce(() => ({ result: two.promise, cancel() {} }))
      .mockImplementation(() =>
        ok({
          entryId,
          versions: [
            { ...entry, text: body },
            { ...added, number: 3, change: "undone", author: "researcher" },
            { ...added, number: 2, change: "merged_into", state: "withdrawn" },
            added,
          ],
          next: null,
        }),
      ),
    sendTextPart: vi.fn(),
    addMemory: vi.fn(),
    editMemory: vi.fn(),
    withdrawMemory: vi.fn(),
  };
  vi.stubGlobal("crypto", {
    subtle: {
      digest: (_algorithm: string, bytes: Uint8Array) =>
        Promise.resolve(Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer),
    },
  });
  try {
    await act(async () =>
      root.render(
        h(ProjectMemoryView, {
          projectId,
          port,
          locale: "en-US",
          drafts: new ProjectMemoryDrafts(),
          observe: () => () => {},
          goToMessage() {},
          draftRequest: undefined,
        }),
      ),
    );
    function button(label: string) {
      return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.textContent?.trim() === label,
      )!;
    }
    expect(container.querySelector("[aria-busy=true]")?.textContent).toContain("Loading…");
    await act(async () => one.resolve(failure("storage_failed")));
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "couldn’t load the project memory",
    );
    expect(container.querySelector("[role=alert] button")).toBeNull();
    await act(async () => button("Reload project memory").click());
    await vi.waitFor(() => {
      expect(container.textContent).toContain("0% of the memory’s space used · 0 of 100 entries");
    });
    expect(container.textContent).toContain("Nothing saved yet.");
    await act(async () => button("Show withdrawn entries (1)").click());
    expect(button("Hide withdrawn entries (1)").hasAttribute("aria-expanded")).toBe(false);
    expect(button("Edit entry")).toBeUndefined();
    expect(button("Withdraw entry")).toBeUndefined();
    expect(container.textContent).toContain(stored);
    expect(container.textContent).toContain("Recorded by Virgilio · edited by you");
    await act(async () => button("Show entry history").click());
    expect(container.querySelector("[aria-busy=true]")?.textContent).toBe("Loading…");
    await act(async () => two.resolve(failure("storage_failed")));
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "couldn’t load the entry history",
    );
    await act(async () => button("Reload entry history").click());
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".memory-history li")).toHaveLength(4);
    });
    const heads = [...container.querySelectorAll(".memory-history .memory-attribution")].map(
      (label) => label.textContent,
    );
    expect(heads).toEqual([
      "Withdrawn by Undo · Written by you · Nov 9, 2026",
      "Restored by Undo · Written by you · Nov 9, 2026",
      "Merged into another entry · Recorded by Virgilio · Nov 9, 2026",
      "Added · Recorded by Virgilio · Nov 9, 2026",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("shows add-to-memory last on saved project messages and omits it during setup", async () => {
  const f = controllerHarness();
  await settle();
  const onAddMemory = vi.fn();
  const onOpenMemory = vi.fn();
  const researcher = message(1, "A human decision.");
  const agent = {
    ...message(2, "A reply."),
    authorKind: "agent",
    agentId: "virgilio",
    taskId: id(3),
  } as TimelineItem;
  const change = {
    kind: "memoryChange",
    rank: 3,
    id: id(4),
    position: 2,
    revision: 1,
    taskId: id(3),
    added: 1,
    edited: 0,
    merged: 0,
    withdrawn: 0,
    rejected: 0,
    canUndo: true,
  } as const;
  const project = {
    id: scope.projectId,
    projectType: "thesis",
    title: "Synthetic thesis",
    documentLanguage: "en",
    isDevelopment: false,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    lastOpenedAt: summary.updatedAt,
  } as const;
  const select = (setupConfirmedAt: string | null) =>
    act(async () =>
      root.render(
        h(ConversationView, {
          state: {
            ...state([researcher, agent, change]),
            conversation: summary,
            project: { ...project, setupConfirmedAt },
          },
          controller: f.controller,
          locale: "en-US",
          onAddMemory,
          onOpenMemory,
          commands: { copyMessage: async () => true, openExternalLink: async () => true },
        }),
      ),
    );
  const actionRows = () =>
    [...container.querySelectorAll(".conversation-actions")].map((row) =>
      [...row.querySelectorAll("button")].map((action) => action.getAttribute("aria-label")),
    );
  try {
    await select(null);
    expect(actionRows().flat()).not.toContain("Add memory entry…");
    await select(summary.createdAt);
    expect(actionRows()).toEqual([
      ["Copy message", "Reuse message", "Add memory entry…"],
      ["Copy message", "Add memory entry…"],
    ]);
    const add = container.querySelectorAll<HTMLButtonElement>("[aria-label='Add memory entry…']");
    await act(async () => add[0]!.click());
    await act(async () => add[1]!.click());
    expect(onAddMemory.mock.calls).toEqual([
      [{ messageId: researcher.id, researcherText: "A human decision." }],
      [{ messageId: agent.id }],
    ]);
    await act(async () => container.querySelector<HTMLAnchorElement>(".memory-reply a")!.click());
    expect(onOpenMemory).toHaveBeenCalledOnce();
  } finally {
    f.controller.dispose();
  }
});

it("discloses saved and unsaved reply details with loading, recovery and localized unknowns", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const savedId = id(400);
  const savedTask = id(401);
  const agent = {
    ...message(400, "Saved reply"),
    id: savedId,
    authorKind: "agent",
    agentId: "virgilio",
    taskId: savedTask,
  } as TimelineItem;
  const pending = deferred<Outcome<ReplyDetails>>();
  const details: ReplyDetails = {
    agentId: "virgilio",
    operation: "direct_guidance",
    instructionVersion: 6,
    connectionId: "chatgpt",
    connectionKind: "subscription",
    account: "same",
    accountRevision: "019a8000-0000-4000-8000-000000000049",
    requestedModel: "Model",
    observedModel: null,
    requestedEffort: "high",
    observedEffort: "low",
    attempts: 1,
    startedAt: "2026-11-15T10:12:00.000Z",
    endedAt: "2026-11-15T10:12:45.000Z",
    durationMs: 45000,
    tokens: {
      input_tokens: 14,
      cached_input_tokens: 0,
      output_tokens: null,
      reasoning_tokens: null,
    },
    usage: "incomplete",
    refusalCategory: "fixture_policy",
    memory: [],
  };
  const readReplyDetails = vi
    .fn(() => ok(details))
    .mockReturnValueOnce({ result: pending.promise, cancel() {} })
    .mockReturnValueOnce(ok(details))
    .mockReturnValueOnce(ok({ ...details, requestedEffort: null, observedEffort: null }));
  const port = {
    readReplyDetails,
    readConnection: vi.fn(() =>
      ok({
        state: "connected",
        account_email: "reader@example.org",
        account_revision: details.accountRevision,
        display_name: "ChatGPT",
      }),
    ),
    readMemoryHistory: vi.fn(),
    readTextPart: vi.fn(),
  } as unknown as import("../packages/renderer/src/reply-details.js").ReplyDetailsPort;
  const items = [
    agent,
    reviewTask({ id: savedTask, replyMessageId: savedId }),
    reviewTask({ id: id(601), state: "queued", dispatched: false }),
    reviewTask({ id: id(602), state: "running" }),
    reviewTask({
      id: id(603),
      state: "cancelled",
      outcomeReason: "cancelled_by_researcher",
      dispatched: false,
    }),
    reviewTask({ id: id(604), state: "failed", consultation: true }),
    reviewTask({ id: id(605), state: "uncertain", synthesis: true }),
  ];
  await render(state(items), {} as ConversationController, "en-US", undefined, port);
  const show = () => [
    ...container.querySelectorAll<HTMLButtonElement>('[aria-label="Show details"]'),
  ];
  expect(show()).toHaveLength(4);
  const button = show()[0]!;
  expect(
    button.parentElement?.previousElementSibling
      ?.querySelector("button")
      ?.getAttribute("aria-label"),
  ).toBe("Copy message");
  expect(button.hasAttribute("aria-expanded")).toBe(false);
  await act(async () => {
    button.focus();
    button.click();
  });
  expect(container.querySelector(".reply-details")?.getAttribute("aria-busy")).toBe("true");
  expect(container.querySelector(".reply-details")?.textContent).toContain("Loading…");
  await act(async () => pending.resolve(failure("storage_failed")));
  expect(container.querySelector(".reply-details [role=alert]")?.textContent).toContain(
    "The reply is still saved.",
  );
  const reload = container.querySelector<HTMLButtonElement>(".reply-details-reload")!;
  await act(async () => {
    reload.focus();
    reload.click();
  });
  expect(document.activeElement).toBe(button);
  expect(readReplyDetails).toHaveBeenLastCalledWith({
    projectId: scope.projectId,
    taskId: savedTask,
  });
  const values = () =>
    [...container.querySelectorAll(".reply-details dd")].map((dd) => dd.textContent);
  const detailTerms = () =>
    Object.fromEntries(
      [...container.querySelectorAll(".reply-details dt")].map((term) => [
        term.textContent,
        term.nextElementSibling?.textContent,
      ]),
    );
  expect(detailTerms()).toMatchObject({
    "Requested effort": "high",
    "Observed effort": "low",
    "Refusal category": "fixture_policy",
  });
  expect(values()).toEqual(
    expect.arrayContaining([
      "Direct guidance · version 6",
      "Sent with the account connected now (reader@example.org).",
      "45 sec",
      "Unknown",
      "0",
      "Incomplete: ChatGPT reported usage only up to the interruption.",
      "0 entries",
    ]),
  );
  await act(async () => button.click());
  for (const [index, notice] of show().slice(1).entries()) {
    expect(notice.parentElement?.parentElement?.lastElementChild).toBe(notice.parentElement);
    await act(async () => notice.click());
    expect(container.querySelector(".task-notice .reply-details")).toBeTruthy();
    if (index === 0) {
      expect(detailTerms()).toMatchObject({
        "Requested effort": "Model default",
        "Observed effort": "Unknown",
      });
    }
    await act(async () => notice.click());
  }
  for (const [locale, label, unknown] of [
    ["de-DE", "Details anzeigen", "Unbekannt"],
    ["ko-KR", "세부 정보 표시", "알 수 없음"],
  ] as const) {
    await render(state([agent]), {} as ConversationController, locale, undefined, port);
    const trigger = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    await act(async () => trigger.click());
    expect(values()).toContain(unknown);
    await act(async () => trigger.click());
  }
  await render(state([agent]), {} as ConversationController, "en-US", undefined, port);
  port.readConnection = (() =>
    ok({
      state: "connected",
      display_name: "ChatGPT",
      account_revision: "019a8000-0000-4000-8000-000000000050",
      account_email: "new@example.org",
    })) as typeof port.readConnection;
  readReplyDetails.mockReturnValueOnce(ok(details)).mockReturnValueOnce(
    ok({
      ...details,
      account: "different",
      accountRevision: "019a8000-0000-4000-8000-000000000050",
    }),
  );
  const accountTrigger = show()[0]!;
  await act(async () => accountTrigger.click());
  expect(values()).toContain("Sent with a different ChatGPT account than the one connected now.");
  expect(values().join("\n")).not.toContain("new@example.org");
  await act(async () => accountTrigger.click());
  port.readConnection = (() =>
    ok({
      state: "connected",
      display_name: "ChatGPT",
      account_revision: details.accountRevision,
      account_email: "reader@example.org",
    })) as typeof port.readConnection;
  const registered = deferred<Outcome<{ subscriptionId: string }>>();
  port.subscribeConnection = () => ({ ready: registered.promise, dispose() {} });
  readReplyDetails
    .mockReturnValueOnce(ok(details))
    .mockReturnValueOnce(ok({ ...details, account: "disconnected", accountRevision: null }));
  await act(async () => accountTrigger.click());
  expect(container.querySelector(".reply-details")?.getAttribute("aria-busy")).toBe("true");
  await act(async () =>
    registered.resolve({ ok: true, value: { subscriptionId: "shown-account" } }),
  );
  expect(values()).toContain("Sent with a ChatGPT account that is no longer connected.");
  expect(values().join("\n")).not.toContain("reader@example.org");
  await act(async () => accountTrigger.click());
  delete port.subscribeConnection;
  for (const [account, accountLine] of [
    ["same", "Sent with the key connected now."],
    ["different", "Sent with your Fake API key that has since been replaced."],
    ["disconnected", "Sent with your Fake API key that is no longer connected."],
  ] as const) {
    readReplyDetails.mockReturnValueOnce(
      ok({ ...details, account, connectionId: "fake", connectionKind: "api_key", usage: "late" }),
    );
    const trigger = show()[0]!;
    await act(async () => trigger.click());
    expect(values()).toEqual(
      expect.arrayContaining([
        "Fake · API key",
        accountLine,
        "Reported by Fake after the reply ended",
      ]),
    );
    await act(async () => trigger.click());
  }

  const entryId = id(610);
  const memoryVersion = {
    number: 3,
    kind: "note",
    text: "Exact memory version used by the reply.",
    state: "active",
    change: "edited",
    author: "researcher",
    date: details.endedAt,
  } as const;
  const history = vi.mocked(port.readMemoryHistory);
  const cancel = vi.fn();
  history.mockReturnValueOnce({
    result: Promise.resolve({
      ok: true,
      value: {
        entryId,
        versions: [{ ...memoryVersion, number: 2, text: "An older memory version." }],
        next: null,
      },
    }),
    cancel,
  });
  history.mockReturnValueOnce(
    ok({
      entryId,
      versions: [memoryVersion, { ...memoryVersion, number: 2, text: "An older memory version." }],
      next: null,
    }),
  );
  readReplyDetails.mockReturnValueOnce(
    ok({
      ...details,
      connectionId: "fake",
      account: null,
      accountRevision: null,
      operation: "development_test_synthesis",
      requestedModel: null,
      startedAt: null,
      durationMs: null,
      memory: [{ entryId, version: 3, versionId: id(613) }],
    }),
  );
  const memoryTrigger = show()[0]!;
  await act(async () => memoryTrigger.click());
  expect(values()).toContain("Development test · version 6");
  const memory = container.querySelector<HTMLDetailsElement>(".reply-details-memory")!;
  expect(memory.querySelector("summary")?.textContent).toBe("1 entry");
  const version = memory.querySelector<HTMLDetailsElement>("li details")!;
  expect(version.querySelector("summary")?.textContent).toBe("Entry 1 · version 3");
  expect(history).not.toHaveBeenCalled();
  async function toggleVersion(open: boolean) {
    await act(async () => {
      const toggled = new Promise<void>((resolve) =>
        version.addEventListener("toggle", () => resolve(), { once: true }),
      );
      version.open = open;
      await toggled;
    });
  }
  await toggleVersion(true);
  expect(history).toHaveBeenLastCalledWith({ projectId: scope.projectId, entryId, before: 4 });
  expect(version.querySelector("[role=alert]")?.textContent).toContain("It’s still saved.");
  expect(version.textContent).not.toContain("An older memory version.");
  await toggleVersion(false);
  expect(cancel).toHaveBeenCalledOnce();
  await toggleVersion(true);
  expect(version.textContent).toContain(memoryVersion.text);
  expect(version.textContent).not.toContain("An older memory version.");
  await act(async () => memoryTrigger.click());
  vi.unstubAllGlobals();
});
