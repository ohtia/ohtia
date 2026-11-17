// @vitest-environment jsdom
import { act, useSyncExternalStore, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  failure,
  message,
  supportedLocales,
  type FoundationPort,
  type TimelineSetupProposal,
  type ConnectionState,
  type Outcome,
  type ResearchEvent,
  type TimelineItem,
  type TimelineMessage,
} from "@ohtia/contracts";
import { NewProjectController } from "../packages/renderer/src/new-project-controller.js";
import {
  ConversationController,
  type ConversationState,
} from "../packages/renderer/src/conversation-controller.js";
import { ConversationView } from "../packages/renderer/src/conversation-view.js";
import { SetupProposal } from "../packages/renderer/src/setup-proposal.js";
import { ActionProposalCard } from "../packages/renderer/src/research-presentation.js";
import { MessageComposer } from "../packages/renderer/src/message-composer.js";
import { call, deferred } from "./fixtures/settings.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const projectId = "019a8000-0000-7000-8000-000000000001";
const conversationId = "019a8000-0000-7000-8000-000000000002";
const proposal: TimelineSetupProposal = {
  kind: "setupProposal",
  id: "019a8000-0000-7000-8000-000000000003",
  taskId: "019a8000-0000-7000-8000-000000000004",
  position: 2,
  rank: 2,
  revision: 1,
  title: "Redes de cuidado",
  documentLanguage: "es-AR",
  state: "proposed",
  invalidReason: null,
};
const project = {
  id: projectId,
  projectType: "thesis" as const,
  title: null,
  documentLanguage: null,
  isDevelopment: false,
  setupConfirmedAt: null,
  createdAt: "2026-11-17T10:00:00Z",
  updatedAt: "2026-11-17T10:00:00Z",
};
function fixture(connection: ConnectionState = "connected") {
  const listeners = new Set<(notice: Outcome<ResearchEvent>) => void>();
  const port = {
    readConnection: vi.fn(() => call({ ok: true, value: { state: connection } })),
    createProject: vi.fn(() => call({ ok: true, value: { resultId: projectId } })),
    listConversations: vi.fn(() =>
      call({ ok: true, value: { items: [{ id: conversationId }], next: null, hasMore: false } }),
    ),
    listProjects: vi.fn(() =>
      call({ ok: true, value: { items: [project], next: null, hasMore: false } }),
    ),
    readPauses: vi.fn(() => call({ ok: true, value: { revision: 1, restart: 0, usage: [] } })),
    readConversations: vi.fn(() =>
      call({
        ok: true,
        value: {
          items: [
            {
              id: conversationId,
              projectId,
              revision: 1,
              title: null,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              agentId: "virgilio",
              latestReplyTaskId: null,
              runningTask: null,
            },
          ],
          remaining: [],
        },
      }),
    ),
    listTimelineBefore: vi.fn(() =>
      call({ ok: true, value: { items: [proposal], next: null, hasMore: false } }),
    ),
    readTimeline: vi.fn(() => call({ ok: true, value: { items: [proposal], remaining: [] } })),
    readDestination: vi.fn(() => call({ ok: true, value: { destination: null } })),
    subscribeResearch: vi.fn(
      (_scope: unknown, listener: (notice: Outcome<ResearchEvent>) => void) => {
        listeners.add(listener);
        return {
          ready: Promise.resolve({ ok: true as const, value: { subscriptionId: "research-1" } }),
          dispose() {
            listeners.delete(listener);
          },
        };
      },
    ),
    confirmProjectSetup: vi.fn(() => call(failure("timeout"))),
    rejectProjectSetup: vi.fn(() => call(failure("storage_failed"))),
    appendMessage: vi.fn(() => call({ ok: true, value: { resultId: proposal.id } })),
  };
  return {
    port,
    bridge: port as unknown as FoundationPort,
    emit(notice: Outcome<ResearchEvent>) {
      for (const listener of [...listeners]) listener(notice);
    },
  };
}
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const state = (includeProject = true): ConversationState => ({
  scope: { projectId, conversationId },
  ...(includeProject ? { project } : {}),
  status: "ready",
  items: [proposal],
  texts: new Map(),
  replies: new Map(),
  next: null,
  loadingEarlier: false,
  failedEarlier: false,
  completed: 0,
});

describe("new project creation intent", () => {
  it.each(["disconnected", "expired", "connecting", "error"] as const)(
    "creates nothing for %s and uses the neutral connection dialog",
    async (connection) => {
      const f = fixture(connection),
        opened = vi.fn(),
        c = new NewProjectController(f.bridge, opened);
      expect(await c.start()).toBe(false);
      expect(c.snapshot().dialog).toBe("connection");
      expect(f.port.createProject).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      c.close();
      expect(c.snapshot().dialog).toBeNull();
      c.dispose();
      expect(await c.start()).toBe(false);
    },
  );
  it("coalesces double activation and opens exactly the created project's setup conversation", async () => {
    const f = fixture(),
      opened = vi.fn(),
      pending = deferred<{ ok: true; value: { resultId: string } }>();
    f.port.createProject.mockReturnValueOnce({ result: pending.promise, cancel: vi.fn() });
    const c = new NewProjectController(f.bridge, opened, () => "creation-1");
    const first = c.start();
    await flush();
    expect(c.snapshot().busy).toBe(true);
    c.close();
    expect(await c.start()).toBe(false);
    pending.resolve({ ok: true, value: { resultId: projectId } });
    expect(await first).toBe(true);
    expect(f.port.createProject).toHaveBeenCalledExactlyOnceWith("creation-1");
    expect(opened).toHaveBeenCalledExactlyOnceWith({ projectId, conversationId });
    c.dispose();
  });
  it("keeps the operation identifier across failure, dialog dismissal and retry", async () => {
    const f = fixture(),
      opened = vi.fn();
    f.port.createProject.mockReturnValueOnce(call(failure("storage_failed")) as never);
    const c = new NewProjectController(f.bridge, opened, () => "same-id");
    expect(await c.start()).toBe(false);
    expect(c.snapshot().dialog).toBe("failed");
    expect(opened).not.toHaveBeenCalled();
    c.close();
    expect(await c.start()).toBe(true);
    expect(f.port.createProject.mock.calls).toEqual([["same-id"], ["same-id"]]);
    c.dispose();
  });
  it("retries opening without creating again after a confirmed receipt", async () => {
    const f = fixture(),
      opened = vi.fn();
    f.port.listConversations.mockReturnValueOnce(call(failure("service_unavailable")) as never);
    const c = new NewProjectController(f.bridge, opened);
    expect(await c.start()).toBe(false);
    expect(c.snapshot().dialog).toBe("openingFailed");
    expect(await c.start()).toBe(true);
    expect(f.port.createProject).toHaveBeenCalledOnce();
    c.dispose();
  });
  it("fails closed when connection reads fail and does not apply late results after disposal", async () => {
    const f = fixture();
    f.port.readConnection.mockReturnValueOnce(call(failure("service_unavailable")) as never);
    const c = new NewProjectController(f.bridge, vi.fn());
    expect(await c.start()).toBe(false);
    expect(f.port.createProject).not.toHaveBeenCalled();
    c.dispose();
    const g = fixture(),
      opened = vi.fn(),
      d = deferred<{ ok: true; value: { resultId: string } }>();
    g.port.createProject.mockReturnValueOnce({ result: d.promise, cancel: vi.fn() });
    const other = new NewProjectController(g.bridge, opened);
    const start = other.start();
    await flush();
    other.dispose();
    d.resolve({ ok: true, value: { resultId: projectId } });
    await start;
    expect(opened).not.toHaveBeenCalled();
  });
});

describe("setup cards and decisions", () => {
  it.each(["proposed", "confirmed", "rejected", "replaced"] as const)(
    "renders %s with state immediately below title and correct voice suppression",
    async (status) => {
      const f = fixture(),
        c = new ConversationController(f.bridge),
        s = state();
      await act(async () =>
        root.render(
          h(SetupProposal, {
            proposal: { ...proposal, state: status },
            state: s,
            controller: c,
            locale: "en-US",
            hasText: false,
          }),
        ),
      );
      expect(container.querySelector(".action-proposal-title")?.nextElementSibling?.className).toBe(
        "action-proposal-state",
      );
      expect(container.querySelector('[lang="es-AR"]')?.textContent).toBe("Redes de cuidado");
      expect(container.textContent).toContain("Spanish (Argentina) · es-AR");
      expect(container.querySelectorAll("button").length).toBe(status === "proposed" ? 3 : 0);
      expect(container.querySelector(".voice-label")).not.toBeNull();
      await act(async () =>
        root.render(
          h(SetupProposal, {
            proposal: { ...proposal, state: status },
            state: s,
            controller: c,
            locale: "en-US",
            hasText: true,
          }),
        ),
      );
      expect(container.querySelector(".voice-label")).toBeNull();
      c.dispose();
    },
  );
  it.each([
    "title_empty",
    "title_whitespace",
    "title_too_long",
    "title_invalid",
    "language_malformed",
    "language_unknown",
    "multiple_calls",
  ] as const)(
    "renders invalid reason %s as a text-only status without repeating the voice",
    async (invalidReason) => {
      const f = fixture(),
        c = new ConversationController(f.bridge);
      await act(async () =>
        root.render(
          h(SetupProposal, {
            proposal: { ...proposal, state: "invalid", invalidReason },
            state: state(),
            controller: c,
            locale: "en-US",
            hasText: true,
          }),
        ),
      );
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "Virgilio will see this in his next reply.",
      );
      expect(container.querySelector(".voice-label")).toBeNull();
      expect(container.querySelector(".action-proposal")).toBeNull();
      expect(container.querySelector("button")).toBeNull();
      if (invalidReason === "title_too_long")
        expect(container.textContent).toContain("200 characters");
      c.dispose();
    },
  );
  it.each(["confirm", "reject"] as const)(
    "retains %s's identifier after an unknown result and rereads proposal_not_waiting",
    async (action) => {
      const f = fixture(),
        c = new ConversationController(f.bridge);
      c.open({ projectId, conversationId });
      await flush();
      const command = action === "confirm" ? f.port.confirmProjectSetup : f.port.rejectProjectSetup;
      command.mockReturnValueOnce(call(failure("timeout")));
      await c.performSetupAction(proposal, action);
      const operation = command.mock.calls.at(-1)![0];
      command.mockReturnValueOnce(call(failure("proposal_not_waiting")));
      await c.performSetupAction(proposal, action);
      expect(command.mock.calls.at(-1)![0]).toBe(operation);
      expect(f.port.readTimeline).toHaveBeenCalledWith({ conversationId, ids: [proposal.id] });
      c.dispose();
    },
  );
  it.each(["confirm", "reject"] as const)(
    "shows each %s error with the required role and clears it for concurrent decided state",
    async (action) => {
      const f = fixture(),
        c = new ConversationController(f.bridge);
      for (const error of [
        "timeout",
        "uncertain",
        "cancelled",
        "disposed",
        "invalid_service_result",
        "storage_failed",
        "setup_reply_active",
        "proposal_not_waiting",
      ]) {
        const s = {
          ...state(),
          setupActions: new Map([[proposal.id, { busy: false, action, error }]]),
        };
        const item = {
          ...proposal,
          state: error === "proposal_not_waiting" ? ("replaced" as const) : ("proposed" as const),
        };
        await act(async () =>
          root.render(
            h(SetupProposal, {
              proposal: item,
              state: s,
              controller: c,
              locale: "en-US",
              hasText: true,
            }),
          ),
        );
        const notice = container.querySelector(".conversation-notice")!;
        expect(notice.getAttribute("role")).toBe(
          ["timeout", "uncertain", "cancelled", "disposed", "invalid_service_result"].includes(
            error,
          )
            ? "status"
            : "alert",
        );
        expect(notice.querySelector("button,a")).toBeNull();
        await act(async () =>
          root.render(
            h(SetupProposal, {
              proposal: { ...proposal, state: "confirmed", revision: 2 },
              state: s,
              controller: c,
              locale: "en-US",
              hasText: true,
            }),
          ),
        );
        expect(container.querySelector(".conversation-notice")).toBeNull();
      }
      c.dispose();
    },
  );
  it("disables confirmation while a reply runs and restores the composer name after send", async () => {
    const f = fixture(),
      c = new ConversationController(f.bridge);
    c.open({ projectId, conversationId });
    await flush();
    const s = state();
    const running = {
      ...s,
      conversation: {
        id: conversationId,
        projectId,
        title: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        revision: 1,
        agentId: "virgilio" as const,
        latestReplyTaskId: null,
        runningTask: {
          id: proposal.taskId,
          agentId: "virgilio" as const,
          state: "running" as const,
        },
      },
    };
    await act(async () =>
      root.render(
        h(
          "div",
          null,
          h(SetupProposal, {
            proposal,
            state: running,
            controller: c,
            locale: "en-US",
            hasText: true,
          }),
          h(MessageComposer, { controller: c.composer, locale: "en-US" }),
        ),
      ),
    );
    expect(container.querySelector(".primitive-primary")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(container.textContent).toContain("Wait for Virgilio to finish replying.");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Correct setup")!
        .click(),
    );
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe(
      "Tell Virgilio what to change",
    );
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    const setupButtons = [...container.querySelectorAll(".action-proposal .actions button")];
    expect(setupButtons[0]?.classList.contains("primitive-primary")).toBe(false);
    expect(setupButtons[1]?.classList.contains("primitive-primary")).toBe(true);
    expect(container.querySelector(".composer-correction")?.textContent).toBe(
      "Tell Virgilio what to change",
    );
    await act(async () => {
      c.composer.edit("Please change the title");
      c.composer.send();
      await flush();
    });
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe(
      "Message Virgilio",
    );
    expect(container.querySelector(".composer-correction")).toBeNull();
    expect(setupButtons[0]?.classList.contains("primitive-primary")).toBe(true);
    expect(setupButtons[1]?.classList.contains("primitive-primary")).toBe(false);
    await act(async () => {
      c.composer.setup(true, []);
    });
    expect(container.querySelector("textarea")?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Virgilio can’t reply here yet.");
    c.dispose();
  });
  it.each(["en-US", "de-DE", "ko-KR"] as const)(
    "renders all action-card states and progress without deciding through recorded text in %s",
    async (locale) => {
      const accepted = vi.fn();
      for (const status of ["open", "accepted", "declined", "replaced"] as const) {
        await act(async () =>
          root.render(
            h(ActionProposalCard, {
              locale,
              proposer: { kind: "ai", contributor: "virgilio", definitionVersion: "1" },
              title: message(locale, "setup.title"),
              state: status,
              stateLabel: message(locale, "setup.waiting"),
              sections: [
                {
                  label: "Title",
                  value: { text: "<script>confirm()</script>", language: undefined },
                },
              ],
              actions: [
                { label: "Confirm", onPress: accepted, primary: true },
                { label: "Reject", onPress: vi.fn() },
              ],
              progress: [
                {
                  id: "one",
                  label: "Synthetic work",
                  stateLabel: "Complete",
                  action: { label: "Inspect", onPress: vi.fn() },
                },
              ],
            }),
          ),
        );
        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector(".action-proposal-progress")).not.toBeNull();
      }
      expect(accepted).not.toHaveBeenCalled();
    },
  );
});

it.each(["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"] as const)(
  "reconciles %s creation without claiming that nothing was created",
  async (code) => {
    const f = fixture(),
      opened = vi.fn();
    f.port.createProject.mockReturnValueOnce(call(failure(code)) as never);
    const c = new NewProjectController(f.bridge, opened, () => "uncertain-creation");
    expect(await c.start()).toBe(false);
    expect(c.snapshot().dialog).toBe("uncertain");
    expect(await c.start()).toBe(true);
    expect(f.port.createProject.mock.calls).toEqual([
      ["uncertain-creation"],
      ["uncertain-creation"],
    ]);
    c.dispose();
  },
);
it("keeps a saved project's opening separate when its conversation page is empty", async () => {
  const f = fixture();
  f.port.listConversations.mockReturnValueOnce(
    call({ ok: true, value: { items: [], next: null, hasMore: false } }),
  );
  const c = new NewProjectController(f.bridge, vi.fn());
  expect(await c.start()).toBe(false);
  expect(c.snapshot().dialog).toBe("openingFailed");
  c.dispose();
});
it("reads a confirmed decision and keeps its original receipt identity when activated twice", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  c.open({ projectId, conversationId });
  await flush();
  const result = deferred<{ ok: true; value: { resultId: string } }>();
  f.port.confirmProjectSetup.mockReturnValueOnce({
    result: result.promise,
    cancel: vi.fn(),
  } as never);
  const first = c.performSetupAction(proposal, "confirm");
  await c.performSetupAction(proposal, "confirm");
  expect(f.port.confirmProjectSetup).toHaveBeenCalledOnce();
  f.port.readTimeline.mockReturnValueOnce(
    call({
      ok: true,
      value: { items: [{ ...proposal, state: "confirmed", revision: 2 }], remaining: [] },
    }) as never,
  );
  f.port.listProjects.mockReturnValueOnce(
    call({
      ok: true,
      value: {
        items: [
          {
            ...project,
            title: "Redes de cuidado",
            documentLanguage: "es-AR",
            setupConfirmedAt: project.createdAt,
          },
        ],
        next: null,
        hasMore: false,
      },
    }) as never,
  );
  result.resolve({ ok: true, value: { resultId: projectId } });
  await first;
  expect(c.snapshot().project?.title).toBe("Redes de cuidado");
  expect(c.composer.snapshot().setupFinal).toBe(true);
  await flush();
  c.composer.edit("Please help me clarify my research question.");
  c.composer.send();
  await flush();
  expect(f.port.appendMessage).toHaveBeenCalledOnce();
  expect(c.composer.snapshot().text).toBe("");
  expect(f.port.readDestination.mock.calls.length).toBeGreaterThan(1);
  expect(c.snapshot().setupActions?.get(proposal.id)?.error).toBeUndefined();
  c.dispose();
});
it("retains a pending decision through a same-conversation reload without leaving its buttons busy", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  c.open({ projectId, conversationId });
  await flush();
  const d = deferred<ReturnType<typeof failure>>();
  f.port.rejectProjectSetup.mockReturnValueOnce({ result: d.promise, cancel: vi.fn() });
  const saving = c.performSetupAction(proposal, "reject");
  c.reload();
  await flush();
  d.resolve(failure("timeout"));
  await saving;
  expect(c.snapshot().setupActions?.get(proposal.id)).toMatchObject({
    busy: false,
    error: "timeout",
  });
  c.dispose();
});
it("keeps old-scope decisions out of a newly opened conversation and preserves their retry identity", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  c.open({ projectId, conversationId });
  await flush();
  const d = deferred<ReturnType<typeof failure>>();
  f.port.rejectProjectSetup.mockReturnValueOnce({ result: d.promise, cancel: vi.fn() });
  const saving = c.performSetupAction(proposal, "reject"),
    operation = f.port.rejectProjectSetup.mock.calls[0]![0];
  c.open({ projectId: null, conversationId: null });
  await flush();
  d.resolve(failure("timeout"));
  await saving;
  expect(c.snapshot().scope.conversationId).toBeNull();
  c.open({ projectId, conversationId });
  await flush();
  await c.performSetupAction(proposal, "reject");
  expect(f.port.rejectProjectSetup.mock.calls.at(-1)![0]).toBe(operation);
  c.dispose();
});
it("keeps development test conversations writable despite their synthetic confirmed project", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  f.port.listProjects.mockReturnValue(
    call({
      ok: true,
      value: {
        items: [{ ...project, isDevelopment: true, setupConfirmedAt: project.createdAt }],
        next: null,
        hasMore: false,
      },
    }) as never,
  );
  c.open({ projectId, conversationId });
  await flush();
  expect(c.composer.snapshot().setupFinal).toBe(false);
  c.dispose();
});
it.each(["confirm", "reject"] as const)(
  "runs %s from the card and reads a decision made in another window without an error notice",
  async (action) => {
    const f = fixture(),
      c = new ConversationController(f.bridge);
    c.open({ projectId, conversationId });
    await flush();
    const command = action === "confirm" ? f.port.confirmProjectSetup : f.port.rejectProjectSetup;
    command.mockReturnValue(call(failure("proposal_not_waiting")));
    f.port.readTimeline.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          items: [
            { ...proposal, revision: 2, state: action === "confirm" ? "confirmed" : "rejected" },
          ],
          remaining: [],
        },
      }) as never,
    );
    await act(async () =>
      root.render(
        h(SetupProposal, {
          proposal,
          state: c.snapshot(),
          controller: c,
          locale: "en-US",
          hasText: false,
        }),
      ),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === (action === "confirm" ? "Confirm setup" : "Reject setup"))!
        .click();
      await flush();
    });
    const saved = c
      .snapshot()
      .items.find((item) => item.id === proposal.id) as TimelineSetupProposal;
    await act(async () =>
      root.render(
        h(SetupProposal, {
          proposal: saved,
          state: c.snapshot(),
          controller: c,
          locale: "en-US",
          hasText: false,
        }),
      ),
    );
    expect(container.querySelector(".conversation-notice")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    c.dispose();
  },
);

it("rechecks the connection after a failed creation while retaining the same creation identity", async () => {
  const f = fixture(),
    opened = vi.fn();
  f.port.createProject.mockReturnValueOnce(call(failure("storage_failed")) as never);
  const c = new NewProjectController(f.bridge, opened, () => "same-creation");
  expect(await c.start()).toBe(false);
  c.close();
  f.port.readConnection.mockReturnValueOnce(call({ ok: true, value: { state: "disconnected" } }));
  expect(await c.start()).toBe(false);
  expect(c.snapshot().dialog).toBe("connection");
  expect(f.port.createProject).toHaveBeenCalledOnce();
  expect(await c.start()).toBe(true);
  expect(f.port.createProject.mock.calls).toEqual([["same-creation"], ["same-creation"]]);
  c.dispose();
});

it("places a proposal-only reply at its saved reply position without the empty conversation text", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  c.open({ projectId, conversationId });
  await flush();
  await act(async () =>
    root.render(
      h(ConversationView, {
        state: c.snapshot(),
        controller: c,
        locale: "en-US",
        commands: { copyMessage: async () => false, openExternalLink: async () => false },
      }),
    ),
  );
  expect(
    container.querySelector(`[data-timeline-id="${proposal.id}"] .action-proposal`),
  ).not.toBeNull();
  expect(container.querySelectorAll(".action-proposal .voice-label")).toHaveLength(1);
  expect(container.querySelector(".conversation-empty")).toBeNull();
  c.dispose();
});

it.each(["confirm", "reject"] as const)(
  "removes obsolete %s instructions when another reply replaces a proposal",
  async (action) => {
    const f = fixture(),
      c = new ConversationController(f.bridge);
    for (const error of [
      "setup_reply_active",
      "storage_failed",
      "timeout",
      "uncertain",
      "cancelled",
      "disposed",
      "invalid_service_result",
    ]) {
      const model = {
        ...state(),
        setupActions: new Map([[proposal.id, { busy: false, action, error }]]),
      };
      await act(async () =>
        root.render(
          h(SetupProposal, {
            proposal,
            state: model,
            controller: c,
            locale: "en-US",
            hasText: true,
          }),
        ),
      );
      expect(container.querySelector(".conversation-notice")).not.toBeNull();
      await act(async () =>
        root.render(
          h(SetupProposal, {
            proposal: { ...proposal, state: "replaced", revision: 2 },
            state: model,
            controller: c,
            locale: "en-US",
            hasText: true,
          }),
        ),
      );
      expect(container.querySelector(".conversation-notice")).toBeNull();
      expect(container.querySelectorAll("button")).toHaveLength(0);
      expect(container.textContent).toContain("Replaced by a newer proposal.");
    }
    c.dispose();
  },
);
it.each(["", "Retained unsent text"])(
  "keeps the confirmed composer editable and preserves the send prerequisite with draft %s",
  async (text) => {
    const f = fixture(),
      c = new ConversationController(f.bridge);
    c.composer.edit(text);
    c.composer.setup(true, []);
    await act(async () =>
      root.render(h(MessageComposer, { controller: c.composer, locale: "en-US" })),
    );
    const button = container.querySelector<HTMLButtonElement>(".composer-action")!,
      input = container.querySelector("textarea")!,
      id = button.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toBe(
      text ? "Reading the message destination…" : "Write a message to send it.",
    );
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(input.disabled).toBe(false);
    expect(input.value).toBe(text);
    c.dispose();
  },
);
it.each([false, true])(
  "does not announce a historical confirmed project on initial load (development: %s)",
  async (isDevelopment) => {
    const f = fixture(),
      c = new ConversationController(f.bridge);
    const model = { ...state(false), items: [] };
    const view = async (next: ConversationState) =>
      act(async () =>
        root.render(
          h(ConversationView, {
            state: next,
            controller: c,
            locale: "en-US",
            commands: { copyMessage: async () => false, openExternalLink: async () => false },
          }),
        ),
      );
    await view(model);
    await view({
      ...model,
      project: {
        ...project,
        isDevelopment,
        title: "Historical title",
        documentLanguage: "en",
        setupConfirmedAt: project.createdAt,
      },
    });
    expect(container.querySelector(".setup-confirmation")?.textContent).toBe("");
    await view({
      ...model,
      project: {
        ...project,
        isDevelopment,
        title: "Historical title",
        documentLanguage: "en",
        setupConfirmedAt: project.createdAt,
      },
      completed: 1,
    });
    expect(container.querySelector(".setup-confirmation")?.textContent).toBe("");
    c.dispose();
  },
);
it.each(supportedLocales)(
  "announces a newly confirmed title once in its recorded language, retaining %s catalog word order",
  async (locale) => {
    vi.useFakeTimers();
    const f = fixture(),
      c = new ConversationController(f.bridge),
      title = "Redes de cuidado en Rosario";
    const unconfirmed = { ...state(), items: [] };
    const confirmed = {
      ...unconfirmed,
      project: {
        ...project,
        title,
        documentLanguage: "es-AR",
        setupConfirmedAt: project.createdAt,
      },
    };
    const view = async (next: ConversationState) =>
      act(async () =>
        root.render(
          h(ConversationView, {
            state: next,
            controller: c,
            locale,
            commands: { copyMessage: async () => false, openExternalLink: async () => false },
          }),
        ),
      );
    await view(unconfirmed);
    expect(container.querySelector(".setup-confirmation")?.textContent).toBe("");
    await view(confirmed);
    const announcement = container.querySelector(".setup-confirmation")!;
    expect(announcement.textContent).toBe(message(locale, "setup.announcement", { title }));
    expect(announcement.querySelector("bdi")?.getAttribute("lang")).toBe("es-AR");
    expect(announcement.getAttribute("lang")).toBe(locale);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(announcement.textContent).toBe("");
    await view({ ...confirmed, completed: 1 });
    expect(announcement.textContent).toBe("");
    c.dispose();
  },
);
it("does not replay a confirmation announcement when the interface locale changes away and back", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge),
    base = { ...state(), items: [] };
  const confirmed = {
    ...base,
    project: {
      ...project,
      title: "Redes de cuidado",
      documentLanguage: "es-AR",
      setupConfirmedAt: project.createdAt,
    },
  };
  const view = async (
    next: ConversationState,
    locale: import("@ohtia/contracts").InterfaceLocale,
  ) =>
    act(async () =>
      root.render(
        h(ConversationView, {
          state: next,
          controller: c,
          locale,
          commands: { copyMessage: async () => false, openExternalLink: async () => false },
        }),
      ),
    );
  await view(base, "en-US");
  await view(confirmed, "en-US");
  expect(container.querySelector(".setup-confirmation")?.textContent).toContain("Redes de cuidado");
  await view(confirmed, "de-DE");
  expect(container.querySelector(".setup-confirmation")?.textContent).toBe("");
  await view(confirmed, "en-US");
  expect(container.querySelector(".setup-confirmation")?.textContent).toBe("");
  c.dispose();
});

it("keeps a genuine confirmation announced when the shared interface locale changes in the same update", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge),
    base = { ...state(), items: [] };
  const view = async (
    next: ConversationState,
    locale: import("@ohtia/contracts").InterfaceLocale,
  ) =>
    act(async () =>
      root.render(
        h(ConversationView, {
          state: next,
          controller: c,
          locale,
          commands: { copyMessage: async () => false, openExternalLink: async () => false },
        }),
      ),
    );
  await view(base, "en-US");
  const title = "Redes de cuidado";
  await view(
    {
      ...base,
      project: {
        ...project,
        title,
        documentLanguage: "es-AR",
        setupConfirmedAt: project.createdAt,
      },
    },
    "de-DE",
  );
  expect(container.querySelector(".setup-confirmation")?.textContent).toBe(
    message("de-DE", "setup.announcement", { title }),
  );
  c.dispose();
});

it("keeps a requested composer focus pending behind a modal and consumes it after that modal closes", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  await act(async () =>
    root.render(h(MessageComposer, { controller: c.composer, locale: "en-US" })),
  );
  const dialog = document.createElement("dialog"),
    close = document.createElement("button");
  close.textContent = "Close synthetic modal";
  dialog.append(close);
  document.body.append(dialog);
  dialog.open = true;
  close.focus();
  await act(async () => {
    c.composer.focus();
  });
  expect(document.activeElement).toBe(close);
  await act(async () => {
    dialog.open = false;
    await flush();
  });
  expect(document.activeElement).toBe(container.querySelector("textarea"));
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  await act(async () => {
    document.body.append(document.createElement("span"));
    await flush();
  });
  expect(document.activeElement).toBe(other);
  other.remove();
  dialog.remove();
  c.dispose();
});

it("shows the active correction path with retained text without sending or deciding", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  c.open({ projectId, conversationId });
  await flush();
  c.composer.edit("Unsent researcher corrections");
  await act(async () =>
    root.render(
      h(
        "div",
        null,
        h(SetupProposal, {
          proposal,
          state: state(),
          controller: c,
          locale: "en-US",
          hasText: true,
        }),
        h(MessageComposer, { controller: c.composer, locale: "en-US" }),
      ),
    ),
  );
  const correct = [
    ...container.querySelectorAll<HTMLButtonElement>(".action-proposal button"),
  ].find((button) => button.textContent === "Correct setup")!;
  for (let i = 0; i < 2; i++) {
    await act(async () => correct.click());
    const input = container.querySelector("textarea")!;
    const label = container.querySelector<HTMLLabelElement>(".composer-correction")!;
    expect(input.value).toBe("Unsent researcher corrections");
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toBe("Tell Virgilio what to change");
    expect(document.activeElement).toBe(input);
    expect(correct.classList.contains("primitive-primary")).toBe(true);
  }
  expect(f.port.appendMessage).not.toHaveBeenCalled();
  expect(f.port.confirmProjectSetup).not.toHaveBeenCalled();
  expect(f.port.rejectProjectSetup).not.toHaveBeenCalled();
  await act(async () => c.composer.setup(false, []));
  expect(container.querySelector(".composer-correction")).toBeNull();
  expect(correct.classList.contains("primitive-primary")).toBe(false);
  expect(container.querySelector("textarea")?.value).toBe("Unsent researcher corrections");
  c.dispose();
});

const researcherReply: TimelineMessage = {
  kind: "message",
  rank: 1,
  revision: 1,
  position: 3,
  id: "019a8000-0000-7000-8000-000000000020",
  authorKind: "researcher",
  agentId: null,
  taskId: null,
  content: "Use American English and revise the working title.",
  language: null,
  ending: null,
};

it("withdraws old setup actions after a sent reply and waits for a fresh explicit proposal", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  let items: TimelineItem[] = [proposal];
  f.port.readTimeline.mockImplementation(((request: { ids: string[] }) =>
    call({
      ok: true,
      value: { items: items.filter((item) => request.ids.includes(item.id)), remaining: [] },
    })) as never);
  f.port.appendMessage.mockImplementation(() => {
    items = [...items, researcherReply];
    queueMicrotask(() =>
      f.emit({
        ok: true,
        value: { kind: "changed", record: "timeline", id: researcherReply.id, revision: 1 },
      }),
    );
    return call({ ok: true, value: { resultId: researcherReply.id } });
  });
  c.open({ projectId, conversationId });
  await flush();
  function Harness() {
    const current = useSyncExternalStore(c.subscribe, c.snapshot);
    return h(ConversationView, {
      state: current,
      controller: c,
      locale: "en-US",
      commands: { copyMessage: async () => false, openExternalLink: async () => false },
    });
  }
  await act(async () => root.render(h(Harness)));
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>(".action-proposal button")]
      .find((button) => button.textContent === "Correct setup")!
      .click(),
  );
  await act(async () => c.composer.edit(researcherReply.content as string));
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click();
    await flush();
  });
  expect(f.port.appendMessage).toHaveBeenCalledOnce();
  expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
  expect(container.textContent).toContain(
    "You replied in chat. This proposal can no longer be confirmed.",
  );
  expect(container.textContent).toContain(proposal.title);
  expect(c.composer.snapshot().correction).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("textarea"));
  const followup: TimelineMessage = {
    ...researcherReply,
    id: "019a8000-0000-7000-8000-000000000021",
    position: 4,
    authorKind: "agent",
    agentId: "virgilio",
    taskId: proposal.taskId,
    content: "Do you agree to the revised working title?",
    ending: "complete",
  };
  items = [...items, followup];
  await act(async () => {
    f.emit({
      ok: true,
      value: { kind: "changed", record: "timeline", id: followup.id, revision: 1 },
    });
    await flush();
  });
  expect(container.textContent).toContain(followup.content);
  expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
  await c.performSetupAction(proposal, "confirm");
  await c.performSetupAction(proposal, "reject");
  expect(f.port.confirmProjectSetup).not.toHaveBeenCalled();
  expect(f.port.rejectProjectSetup).not.toHaveBeenCalled();
  const fresh: TimelineSetupProposal = {
    ...proposal,
    id: "019a8000-0000-7000-8000-000000000022",
    taskId: "019a8000-0000-7000-8000-000000000023",
    position: 5,
    title: "Updated English working title",
    documentLanguage: "en-US",
  };
  items = [...items, fresh];
  await act(async () => {
    f.emit({ ok: true, value: { kind: "changed", record: "timeline", id: fresh.id, revision: 1 } });
    await flush();
  });
  const cards = container.querySelectorAll(".action-proposal");
  expect(cards).toHaveLength(2);
  expect(cards[0]!.querySelectorAll("button")).toHaveLength(0);
  expect(cards[1]!.querySelectorAll("button")).toHaveLength(3);
  expect(cards[1]!.querySelector(".primitive-primary")?.textContent).toBe("Confirm setup");
  c.dispose();
});

it("keeps setup actions and correction text when a reply fails to save", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  f.port.appendMessage.mockReturnValue(call(failure("pending_limit_reached")) as never);
  c.open({ projectId, conversationId });
  await flush();
  c.composer.correct(proposal.id);
  c.composer.edit("Unsent correction");
  c.composer.send();
  await flush();
  await act(async () =>
    root.render(
      h(SetupProposal, {
        proposal,
        state: c.snapshot(),
        controller: c,
        locale: "en-US",
        hasText: false,
      }),
    ),
  );
  expect(container.querySelectorAll(".action-proposal button")).toHaveLength(3);
  expect(c.composer.snapshot()).toMatchObject({
    correction: proposal.id,
    text: "Unsent correction",
    notice: "pendingLimit",
  });
  c.dispose();
});

it("refreshes the latest timeline after a stale decision learns of a reply from another window", async () => {
  const f = fixture(),
    c = new ConversationController(f.bridge);
  c.open({ projectId, conversationId });
  await flush();
  c.composer.edit("Retained draft");
  f.port.confirmProjectSetup.mockReturnValue(call(failure("proposal_not_waiting")) as never);
  f.port.listTimelineBefore.mockReturnValue(
    call({
      ok: true,
      value: { items: [researcherReply, proposal], next: null, hasMore: false },
    }) as never,
  );
  await c.performSetupAction(proposal, "confirm");
  await flush();
  await act(async () =>
    root.render(
      h(SetupProposal, {
        proposal,
        state: c.snapshot(),
        controller: c,
        locale: "en-US",
        hasText: false,
      }),
    ),
  );
  expect(f.port.listTimelineBefore).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
  expect(c.composer.snapshot().text).toBe("Retained draft");
  c.dispose();
});

it.each(["confirm", "reject"] as const)(
  "keeps an obsolete %s card unavailable while its reread is pending or fails",
  async (action) => {
    const f = fixture(),
      c = new ConversationController(f.bridge);
    c.open({ projectId, conversationId });
    await flush();
    c.composer.correct(proposal.id);
    c.composer.edit("Retained correction draft");
    const reread = deferred<ReturnType<typeof failure>>();
    const command = action === "confirm" ? f.port.confirmProjectSetup : f.port.rejectProjectSetup;
    command.mockReturnValue(call(failure("proposal_not_waiting")) as never);
    f.port.readTimeline.mockReturnValueOnce({ result: reread.promise, cancel() {} } as never);
    function Harness() {
      const current = useSyncExternalStore(c.subscribe, c.snapshot);
      return h(SetupProposal, {
        proposal,
        state: current,
        controller: c,
        locale: "en-US",
        hasText: false,
      });
    }
    await act(async () => root.render(h(Harness)));
    let pending: Promise<void>;
    await act(async () => {
      pending = c.performSetupAction(proposal, action);
      await flush();
    });
    expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
    expect(container.textContent).toContain("This proposal is no longer awaiting a decision.");
    expect(container.querySelector('.action-proposal [role="alert"]')).toBeNull();
    await act(async () => {
      reread.resolve(failure("storage_failed"));
      await pending;
      await flush();
    });
    expect(c.snapshot().status).toBe("failed");
    expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
    expect(container.querySelector('.action-proposal [role="alert"]')).toBeNull();
    expect(c.composer.snapshot()).toMatchObject({
      text: "Retained correction draft",
      correction: null,
    });
    c.dispose();
  },
);

it.each(["confirm", "reject"] as const)(
  "keeps the refusal reason tied to the initial reread for %s",
  async (action) => {
    for (const initiallyReplaced of [false, true]) {
      const f = fixture(),
        c = new ConversationController(f.bridge);
      c.open({ projectId, conversationId });
      await flush();
      let observed: TimelineSetupProposal = initiallyReplaced
        ? { ...proposal, state: "replaced", revision: 2 }
        : proposal;
      f.port.readTimeline.mockImplementation(() =>
        call({ ok: true, value: { items: [observed], remaining: [] } }),
      );
      f.port.listTimelineBefore.mockImplementation(
        () =>
          call({
            ok: true,
            value: { items: [observed, researcherReply], next: null, hasMore: false },
          }) as never,
      );
      const command = action === "confirm" ? f.port.confirmProjectSetup : f.port.rejectProjectSetup;
      command.mockReturnValue(call(failure("proposal_not_waiting")) as never);
      function Harness() {
        const current = useSyncExternalStore(c.subscribe, c.snapshot);
        const currentProposal = current.items.find(
          (item) => item.id === proposal.id,
        ) as TimelineSetupProposal;
        return h(SetupProposal, {
          proposal: currentProposal,
          state: current,
          controller: c,
          locale: "en-US",
          hasText: false,
        });
      }
      await act(async () => root.render(h(Harness)));
      await act(async () => {
        await c.performSetupAction(proposal, action);
        await flush();
      });
      expect(container.querySelectorAll('.action-proposal [role="alert"]')).toHaveLength(
        initiallyReplaced ? 1 : 0,
      );
      observed = { ...proposal, state: "replaced", revision: 2 };
      await act(async () => {
        f.emit({
          ok: true,
          value: { kind: "changed", record: "timeline", id: proposal.id, revision: 2 },
        });
        await flush();
      });
      expect(container.querySelectorAll('.action-proposal [role="alert"]')).toHaveLength(
        initiallyReplaced ? 1 : 0,
      );
      expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
      if (initiallyReplaced)
        expect(container.textContent).toContain(
          message("en-US", action === "confirm" ? "setup.confirmReplaced" : "setup.rejectReplaced"),
        );
      c.dispose();
    }
  },
);

it.each(["confirm", "reject"] as const)(
  "ignores an obsolete proposal reread after %s recovery",
  async (action) => {
    for (const recovery of ["reload", "sequenceGap"] as const) {
      for (const fails of [false, true]) {
        const f = fixture(),
          c = new ConversationController(f.bridge);
        c.open({ projectId, conversationId });
        await flush();
        c.composer.correct(proposal.id);
        c.composer.edit("Draft retained through recovery");
        const reread =
          deferred<Outcome<{ items: readonly TimelineItem[]; remaining: readonly string[] }>>();
        f.port.readTimeline.mockReturnValueOnce({ result: reread.promise, cancel() {} } as never);
        const command =
          action === "confirm" ? f.port.confirmProjectSetup : f.port.rejectProjectSetup;
        command.mockReturnValue(call(failure("proposal_not_waiting")) as never);
        function Harness() {
          const current = useSyncExternalStore(c.subscribe, c.snapshot);
          const currentProposal = current.items.find(
            (item) => item.id === proposal.id,
          ) as TimelineSetupProposal;
          return h(SetupProposal, {
            proposal: currentProposal,
            state: current,
            controller: c,
            locale: "en-US",
            hasText: false,
          });
        }
        await act(async () => root.render(h(Harness)));
        let pending: Promise<void>;
        await act(async () => {
          pending = c.performSetupAction(proposal, action);
          await flush();
        });
        expect(container.querySelectorAll(".action-proposal button")).toHaveLength(0);
        expect(container.querySelectorAll('.action-proposal [role="alert"]')).toHaveLength(0);
        const replacement: TimelineSetupProposal = { ...proposal, state: "replaced", revision: 2 };
        f.port.listTimelineBefore.mockReturnValue(
          call({
            ok: true,
            value: { items: [replacement, researcherReply], next: null, hasMore: false },
          }) as never,
        );
        await act(async () => {
          if (recovery === "reload") c.reload();
          else f.emit(failure("sequence_gap"));
          await flush();
        });
        expect(c.snapshot().items.find((item) => item.id === proposal.id)).toMatchObject({
          state: "replaced",
        });
        expect(container.querySelectorAll('.action-proposal [role="alert"]')).toHaveLength(0);
        await act(async () => {
          reread.resolve(
            fails
              ? failure("storage_failed")
              : { ok: true, value: { items: [proposal], remaining: [] } },
          );
          await pending;
          await flush();
        });
        expect(c.snapshot().status).toBe("ready");
        expect(container.querySelectorAll('.action-proposal [role="alert"]')).toHaveLength(0);
        expect(c.snapshot().setupActions?.get(proposal.id)).toMatchObject({ unavailable: true });
        expect(c.snapshot().setupActions?.get(proposal.id)?.error).toBeUndefined();
        expect(c.composer.snapshot()).toMatchObject({
          text: "Draft retained through recovery",
          correction: null,
        });
        c.dispose();
      }
    }
  },
);
