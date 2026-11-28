// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogs,
  failure,
  message,
  projectWorkflows,
  researchStages,
  stageAction,
  type Outcome,
  type ProfileFields,
  type ResearchStageId,
  type StageDecision,
  type StageSnapshot,
} from "@ohtia/contracts";
import {
  NavigatorController,
  navigatorSurfaceCommitted,
} from "../packages/renderer/src/navigator-controller.js";
import {
  NavigatorView,
  upcomingMilestones,
  type NavigatorViewProps,
} from "../packages/renderer/src/navigator-view.js";
import { call, deferred } from "./fixtures/settings.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const thesis = projectWorkflows.thesis;
const origin = { kind: "researcher_statement" } as const;
const text = (key: Parameters<typeof message>[1]) => message("en-US", key as never);
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

function snapshot(
  projectId: string,
  stageId: ResearchStageId,
  revision = 0,
  latestEntry: StageSnapshot["latestEntry"] = null,
): StageSnapshot {
  const state = revision ? "in-progress" : "not-started";
  return {
    projectId,
    stageId,
    state,
    revision,
    decisionId: revision ? `decision-${stageId}-${String(revision)}` : null,
    profileRevisionId: null,
    enter: stageAction(stageId, state, "not-started"),
    reopen: stageAction(stageId, state, "done"),
    latestEntry,
  };
}
function record(projectId: string, stageId: ResearchStageId, revision: number): StageDecision {
  return {
    stageId,
    decisionId: `decision-${stageId}-${String(revision)}`,
    revision,
    projectId,
    operationId: "operation-1",
    expectedRevision: revision - 1,
    observedAt: "2026-11-12T15:00:00.000Z",
    actor: "researcher",
    profileRevisionId: null,
    reason: "Start recording the thesis context.",
    artifacts: [],
    remainingConditions: ["Confirm the deadline with the supervisor."],
    kind: "enter",
    precedingState: "not-started",
    state: "in-progress",
  };
}

function stagePort(started: ResearchStageId | null = "onboarding") {
  const entry = started
    ? { stageId: started, decisionId: `decision-${started}-1`, revision: 1 }
    : null;
  return {
    readResearchStage: vi.fn(
      ({ projectId, stageId }: { projectId: string; stageId: ResearchStageId }) =>
        call(ok(snapshot(projectId, stageId, stageId === started ? 1 : 0, entry))),
    ),
    readStageDecision: vi.fn(
      ({
        projectId,
        stageId,
        revision,
      }: {
        projectId: string;
        stageId: ResearchStageId;
        revision: number;
      }) => call(ok(record(projectId, stageId, revision))),
    ),
    transitionResearchStage: vi.fn(),
  };
}
const lease = (projectId: string, current = () => true) => ({ projectId, isCurrent: current });
const settle = () => act(async () => {});

describe("project workflows", () => {
  it("orders the thesis stages before the Delivery and defense milestone with unique identifiers", () => {
    expect(thesis.filter((step) => step.kind === "stage").map((step) => step.id)).toEqual([
      ...researchStages,
    ]);
    expect(thesis.at(-1)).toEqual({ kind: "milestone", id: "delivery" });
    expect(new Set(thesis.map((step) => step.id)).size).toBe(thesis.length);
    for (const catalog of Object.values(catalogs))
      for (const step of thesis) {
        expect(catalog.messages).toHaveProperty(`workflow.thesis.${step.id}.name`);
        if (step.kind === "stage") {
          expect(catalog.messages).toHaveProperty(`workflow.thesis.${step.id}.purpose`);
          expect(catalog.messages).toHaveProperty(`workflow.thesis.${step.id}.output`);
        }
      }
  });
});

describe("NavigatorController", () => {
  it("reads every stage of the project type and the latest stage record without starting work", async () => {
    const port = stagePort();
    const controller = new NavigatorController(port);
    controller.attach(lease("project-a"), thesis);
    expect(port.readResearchStage).not.toHaveBeenCalled();
    controller.setSubscription("subscription-a");
    await settle();
    const { stages, reading, readFailed } = controller.snapshot();
    expect([reading, readFailed]).toEqual([false, false]);
    expect([...(stages?.keys() ?? [])]).toEqual([...researchStages]);
    expect(port.readResearchStage).toHaveBeenCalledTimes(researchStages.length);
    expect(port.readStageDecision).toHaveBeenCalledOnce();
    expect(port.readStageDecision).toHaveBeenCalledWith({
      projectId: "project-a",
      subscriptionId: "subscription-a",
      stageId: "onboarding",
      revision: 1,
    });
    expect(stages?.get("onboarding")?.latest?.remainingConditions).toEqual([
      "Confirm the deadline with the supervisor.",
    ]);
    expect(port.transitionResearchStage).not.toHaveBeenCalled();
  });

  it("discards an old project's delayed reply after the selection changes", async () => {
    const port = stagePort(null);
    const delayed = deferred<Outcome<StageSnapshot>>();
    port.readResearchStage.mockImplementationOnce(() => ({ result: delayed.promise, cancel() {} }));
    const controller = new NavigatorController(port);
    let selectedA = true;
    const detach = controller.attach(
      lease("project-a", () => selectedA),
      thesis,
    );
    controller.setSubscription("subscription-a");
    await settle();
    selectedA = false;
    detach();
    controller.attach(lease("project-b"), thesis);
    controller.setSubscription("subscription-b");
    await settle();
    await act(async () => {
      delayed.resolve(ok(snapshot("project-a", "onboarding", 3)));
    });
    const state = controller.snapshot();
    expect(state.projectId).toBe("project-b");
    expect(state.stages?.get("onboarding")?.snapshot.projectId).toBe("project-b");
    expect(state.stages?.get("onboarding")?.snapshot.revision).toBe(0);
  });

  it("rereads after a committed stage record, including one announced during a read", async () => {
    const port = stagePort(null);
    const controller = new NavigatorController(port);
    controller.attach(lease("project-a"), thesis);
    controller.setSubscription("subscription-a");
    controller.changed("project-a", 1);
    await settle();
    expect(port.readResearchStage).toHaveBeenCalledTimes(researchStages.length * 2);
    controller.changed("project-a", 1);
    controller.changed("project-b", 9);
    await settle();
    expect(port.readResearchStage).toHaveBeenCalledTimes(researchStages.length * 2);
    controller.changed("project-a", 2);
    await settle();
    expect(port.readResearchStage).toHaveBeenCalledTimes(researchStages.length * 3);
  });

  it("reports a failed read and retries on request", async () => {
    const port = stagePort(null);
    port.readResearchStage.mockImplementationOnce(() => call(failure("storage_failed")));
    const controller = new NavigatorController(port);
    controller.attach(lease("project-a"), thesis);
    controller.setSubscription("subscription-a");
    await settle();
    expect(controller.snapshot()).toMatchObject({ readFailed: true, stages: undefined });
    controller.retry();
    await settle();
    expect(controller.snapshot().readFailed).toBe(false);
    expect(controller.snapshot().stages?.size).toBe(researchStages.length);
  });

  it("reports a failed reread after a successful read instead of keeping it silent", async () => {
    const port = stagePort(null);
    const controller = new NavigatorController(port);
    controller.attach(lease("project-a"), thesis);
    controller.setSubscription("subscription-a");
    await settle();
    expect(controller.snapshot().readFailed).toBe(false);
    port.readResearchStage.mockImplementationOnce(() => call(failure("storage_failed")));
    controller.changed("project-a", 1);
    await settle();
    expect(controller.snapshot().readFailed).toBe(true);
    controller.retry();
    await settle();
    expect(controller.snapshot().readFailed).toBe(false);
  });

  it("treats the surface as committed only while stages render in a visible panel", () => {
    const loaded = { projectId: "project-a", stages: new Map(), reading: false, readFailed: false };
    expect(navigatorSurfaceCommitted(true, true, loaded)).toBe(true);
    expect(navigatorSurfaceCommitted(false, true, loaded)).toBe(false);
    expect(navigatorSurfaceCommitted(true, false, loaded)).toBe(false);
    expect(navigatorSurfaceCommitted(true, true, { ...loaded, stages: undefined })).toBe(false);
    // A failed reread keeps the earlier map but shows the failure instead of the stages.
    expect(navigatorSurfaceCommitted(true, true, { ...loaded, readFailed: true })).toBe(false);
  });

  it("announces the committed and selected surface only for the current selection", () => {
    const controller = new NavigatorController(stagePort());
    const events: unknown[] = [];
    controller.observeSurface((event) => events.push(event));
    const current = lease("project-a");
    controller.attach(current, thesis);
    controller.committed(current);
    controller.selected(current);
    controller.committed(lease("project-a"));
    expect(events).toEqual([
      { kind: "committed", projectId: "project-a" },
      { kind: "selected", projectId: "project-a" },
    ]);
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});
const render = async (element: ReactElement) => {
  await act(async () => {
    root.render(element);
  });
};
const milestone = (title: string, date: string | undefined, done = false) => ({
  state: "known" as const,
  value: { title, ...(date ? { date } : {}), done },
  origin,
});
function stagesState(started = true): NavigatorViewProps["stages"] {
  const entry = started
    ? { stageId: "onboarding" as const, decisionId: "decision-onboarding-1", revision: 1 }
    : null;
  return {
    projectId: "project-a",
    reading: false,
    readFailed: false,
    stages: new Map(
      researchStages.map((stageId) => [
        stageId,
        {
          snapshot: snapshot(
            "project-a",
            stageId,
            started && stageId === "onboarding" ? 1 : 0,
            entry,
          ),
          latest: started && stageId === "onboarding" ? record("project-a", stageId, 1) : null,
        },
      ]),
    ),
  };
}
function props(overrides: Partial<NavigatorViewProps> = {}): NavigatorViewProps {
  return {
    locale: "en-US",
    title: "First-generation university students",
    subtitle: "A qualitative study",
    projectType: "thesis",
    steps: thesis,
    stages: stagesState(),
    retryStages: vi.fn(),
    profile: { saved: { fields: {} }, readFailed: false, retry: vi.fn() },
    openProfile: vi.fn(),
    today: "2026-11-28",
    ...overrides,
  };
}
const deadline = () => container.querySelector(".navigator-deadline")?.textContent;
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent === label);

describe("NavigatorView", () => {
  it("shows the saved deadline as the same calendar date in two time zones", async () => {
    const zone = process.env.TZ;
    const fields: ProfileFields = { deadline: { state: "known", value: "2027-06-30", origin } };
    try {
      for (const tz of ["America/Argentina/Buenos_Aires", "Asia/Seoul"]) {
        process.env.TZ = tz;
        await render(
          h(
            NavigatorView,
            props({ profile: { saved: { fields }, readFailed: false, retry: vi.fn() } }),
          ),
        );
        expect(deadline()).toContain("June 30, 2027");
      }
    } finally {
      process.env.TZ = zone;
    }
  });

  it("distinguishes pending, unknown, inapplicable and unavailable deadlines", async () => {
    const cases: [ProfileFields["deadline"], string][] = [
      [undefined, text("navigator.deadline.pending")],
      [{ state: "unknown" }, text("navigator.deadline.unknown")],
      [{ state: "inapplicable" }, text("navigator.deadline.inapplicable")],
    ];
    for (const [fact, label] of cases) {
      const fields: ProfileFields = fact ? { deadline: fact } : {};
      await render(
        h(
          NavigatorView,
          props({ profile: { saved: { fields }, readFailed: false, retry: vi.fn() } }),
        ),
      );
      expect(deadline()).toContain(label);
    }
    const retry = vi.fn();
    await render(
      h(NavigatorView, props({ profile: { saved: undefined, readFailed: true, retry } })),
    );
    expect(deadline()).toBeUndefined();
    expect(container.textContent).toContain(text("navigator.scheduleFailed"));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".navigator-schedule .navigator-failure button")
        ?.click();
    });
    expect(retry).toHaveBeenCalledOnce();
    await render(
      h(NavigatorView, props({ profile: { saved: undefined, readFailed: false, retry } })),
    );
    expect(container.querySelector(".navigator-schedule")?.textContent).toContain(
      text("profile.loading"),
    );
  });

  it("lists up to three pending milestones by date, then undated ones in profile order", async () => {
    const fields: ProfileFields = {
      milestones: {
        state: "known",
        items: [
          milestone("Present to the committee", undefined),
          milestone("Draft chapter 2", "2027-02-28"),
          milestone("Submit the plan", "2026-09-15", true),
          milestone("Finish pilot interviews", "2026-11-10"),
          milestone("Ask for the corpus", undefined),
        ],
      },
    };
    expect(upcomingMilestones(fields).pending.map((item) => item.title)).toEqual([
      "Finish pilot interviews",
      "Draft chapter 2",
      "Present to the committee",
      "Ask for the corpus",
    ]);
    await render(
      h(
        NavigatorView,
        props({ profile: { saved: { fields }, readFailed: false, retry: vi.fn() } }),
      ),
    );
    const rows = [...container.querySelectorAll(".navigator-milestones li")];
    expect(rows.map((row) => row.querySelector("bdi")?.textContent)).toEqual([
      "Finish pilot interviews",
      "Draft chapter 2",
      "Present to the committee",
    ]);
    expect(rows[0]?.textContent).toContain(text("profile.datePassed"));
    expect(rows[1]?.textContent).not.toContain(text("profile.datePassed"));
    expect(container.textContent).toContain(
      message("en-US", "navigator.moreMilestones", { count: 1 }),
    );
  });

  it("tells no recorded milestones apart from milestones that are all done", async () => {
    await render(h(NavigatorView, props()));
    expect(container.textContent).toContain(text("navigator.noMilestones"));
    const fields: ProfileFields = {
      milestones: { state: "known", items: [milestone("Submit", undefined, true)] },
    };
    await render(
      h(
        NavigatorView,
        props({ profile: { saved: { fields }, readFailed: false, retry: vi.fn() } }),
      ),
    );
    expect(container.textContent).toContain(text("navigator.noPendingMilestones"));
    expect(container.textContent).not.toContain(text("navigator.noMilestones"));
  });

  it("selects the latest started stage and shows its record date, conditions and profile links", async () => {
    const openProfile = vi.fn();
    const fields: ProfileFields = {
      questions: {
        state: "known",
        items: [{ state: "known", value: "Which support do they use?", origin }],
      },
    };
    await render(
      h(
        NavigatorView,
        props({ openProfile, profile: { saved: { fields }, readFailed: false, retry: vi.fn() } }),
      ),
    );
    const pressed = container.querySelector('.research-stage-select[aria-pressed="true"]');
    expect(pressed?.textContent).toContain(text("workflow.thesis.onboarding.name"));
    const detail = container.querySelector(".navigator-stage")!;
    expect(detail.textContent).toContain(text("workflow.thesis.onboarding.purpose"));
    expect(detail.textContent).toContain("In progress since Nov 12, 2026");
    expect(detail.textContent).toContain("Confirm the deadline with the supervisor.");
    expect(detail.textContent).not.toContain("Start recording the thesis context.");
    expect(detail.textContent).toContain(text("navigator.searchUnavailable"));
    expect(detail.textContent).toContain("Which support do they use?");
    await act(async () => {
      button(text("profile.section.requirements"))?.click();
    });
    await act(async () => {
      button(text("navigator.openQuestions"))?.click();
    });
    await act(async () => {
      button(text("profile.openSchedule"))?.click();
    });
    expect(openProfile.mock.calls).toEqual([["requirements"], ["research"], ["schedule"]]);
  });

  it("shows a later stage's unavailable workflow and the pending Delivery and defense milestone", async () => {
    await render(h(NavigatorView, props({ stages: stagesState(false) })));
    expect(
      container.querySelector('.research-stage-select[aria-pressed="true"]')?.textContent,
    ).toContain(text("workflow.thesis.onboarding.name"));
    expect(container.querySelector(".navigator-stage")?.textContent).toContain(
      text("navigator.notStarted"),
    );
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".research-stage-select")[3]?.click();
    });
    expect(container.querySelector(".navigator-stage")?.textContent).toContain(
      text("navigator.laterStage"),
    );
    const delivery = container.querySelector('.research-stage[data-kind="milestone"]')!;
    expect(delivery.textContent).toContain(text("navigator.milestone.pending"));
    expect(
      delivery.querySelector('.research-milestone-mark[data-state="pending"] svg'),
    ).not.toBeNull();
    await act(async () => {
      delivery.querySelector("button")?.click();
    });
    expect(container.querySelector(".navigator-stage")?.textContent).toContain(
      text("navigator.milestone.notReached"),
    );
  });

  it("replaces earlier data with the failure and Retry when a later read fails", async () => {
    const fields: ProfileFields = {
      deadline: { state: "known", value: "2027-06-30", origin },
      questions: { state: "known", items: [{ state: "known", value: "Earlier question", origin }] },
    };
    const retry = vi.fn();
    const retryStages = vi.fn();
    await render(
      h(
        NavigatorView,
        props({
          retryStages,
          stages: { ...stagesState(), readFailed: true },
          profile: { saved: { fields }, readFailed: true, retry },
        }),
      ),
    );
    expect(deadline()).toBeUndefined();
    expect(container.querySelector(".research-stages")).toBeNull();
    expect(container.textContent).not.toContain("Earlier question");
    expect(container.textContent).toContain(text("navigator.scheduleFailed"));
    expect(container.textContent).toContain(text("navigator.stagesFailed"));
    const retries = container.querySelectorAll<HTMLButtonElement>(".navigator-failure button");
    expect(retries).toHaveLength(2);
    await act(async () => {
      retries.forEach((node) => {
        node.click();
      });
    });
    expect([retry.mock.calls.length, retryStages.mock.calls.length]).toEqual([1, 1]);
  });

  it("shows loading and failed stage reads and renders eligible stage actions in the slot", async () => {
    const retryStages = vi.fn();
    await render(
      h(
        NavigatorView,
        props({
          stages: { projectId: "project-a", stages: undefined, reading: true, readFailed: false },
        }),
      ),
    );
    expect(container.textContent).toContain(text("navigator.stagesLoading"));
    await render(
      h(
        NavigatorView,
        props({
          retryStages,
          stages: { projectId: "project-a", stages: undefined, reading: false, readFailed: true },
        }),
      ),
    );
    expect(container.textContent).toContain(text("navigator.stagesFailed"));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".navigator-failure:not(.navigator-schedule *) button")
        ?.click();
    });
    expect(retryStages).toHaveBeenCalledOnce();
    await render(h(NavigatorView, props()));
    expect(container.querySelector(".navigator-stage-actions")).toBeNull();
    await render(h(NavigatorView, props({ stageActions: () => [] })));
    expect(container.querySelector(".navigator-stage-actions")).toBeNull();
    await render(
      h(
        NavigatorView,
        props({
          stageActions: (step) =>
            step.id === "onboarding" ? h("button", { type: "button" }, "Eligible") : null,
        }),
      ),
    );
    const action = container.querySelector<HTMLButtonElement>(".navigator-stage-actions button")!;
    action.focus();
    expect(document.activeElement).toBe(action);
  });
});
