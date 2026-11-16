// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationView } from "../packages/renderer/src/conversation-view.js";
import {
  ConversationController,
  type ConversationState,
} from "../packages/renderer/src/conversation-controller.js";
import {
  failure,
  portLimits,
  type FoundationPort,
  type Outcome,
  type ResearchEvent,
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
};
const call = <T>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
const ok = <T>(value: T) => call({ ok: true as const, value });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
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
        controller,
        locale: "en-US",
        commands: { copyMessage: async () => true, openExternalLink: async () => true },
      }),
    ),
  );
}

describe("conversation presentation", () => {
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
  const other = { ...state([message(10)]), scope: { ...scope, conversationId: id(3000) } };
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
  await render({ ...initial, completed: 1 });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("Virgilio replied");
  await render({ ...initial, scope: { ...scope, conversationId: id(4000) }, completed: 0 });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("");
  await render({ ...initial, completed: 1 });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("");
  await render({ ...initial, completed: 2 });
  expect(container.querySelector("[aria-live]")?.textContent).toBe("Virgilio replied");
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
  await render(state([message(1, "  reused\n한글 text  ")]), f.controller);
  const buttons = container.querySelectorAll<HTMLButtonElement>(".conversation-actions button");
  expect(buttons[1]?.getAttribute("aria-label")).toBe("Reuse message");
  await act(async () => buttons[1]!.click());
  expect(container.querySelector("textarea")?.value).toBe("  reused\n한글 text  ");
  f.controller.dispose();
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
