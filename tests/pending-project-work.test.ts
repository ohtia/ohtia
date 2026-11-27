import { expect, it, vi } from "vitest";
import { failure, type ResearchScope } from "@ohtia/contracts";
import {
  type PendingWorkDecision,
  type PendingWorkScope,
} from "../packages/renderer/src/pending-project-work.js";
import { ProjectController } from "../packages/renderer/src/project-controller.js";
import { call, deferred } from "./fixtures/settings.js";

const a = { projectId: "project-a", conversationId: null };
const b = { projectId: "project-b", conversationId: null };
const empty = { projectId: null, conversationId: null };
const safe = { status: "safe_to_detach" } as const;
const keep = { status: "keep_open" } as const;
const pending = { status: "pending_confirmation" } as const;

function windowController() {
  const select = vi.fn<(scope: ResearchScope) => void>();
  const port = {
    openProject: vi.fn(() => call({ ok: true as const, value: { resultId: a.projectId } })),
    listConversations: vi.fn(() => call(failure("storage_failed"))),
    listProjects: vi.fn(),
    readProject: vi.fn(),
    renameProject: vi.fn(),
  };
  const projects = new ProjectController(port, select);
  return { projects, work: projects.pendingWork, select, port };
}

it("exposes a read-only window lease that cannot revive after A to B to A", async () => {
  const { projects, work, select } = windowController();
  const other = windowController();
  expect(projects.selectionLease()).toBeUndefined();
  projects.adopt(a);
  other.projects.adopt(a);
  const first = projects.selectionLease()!;
  expect(Object.isFrozen(first)).toBe(true);
  expect(first.projectId).toBe(a.projectId);
  expect(projects.selectionLease()).toBe(first);
  expect(first.isCurrent()).toBe(true);
  const foreign = vi.fn(() => keep);
  const ignore = other.work.register(first, foreign);
  ignore();
  expect(await other.work.evaluate(first)).toEqual(keep);
  expect(await other.work.evaluate(other.projects.selectionLease()!)).toMatchObject(safe);
  expect(foreign).not.toHaveBeenCalled();

  const decision = await work.evaluate(first);
  if (decision.status !== "safe_to_detach") throw new Error("Expected a clean decision.");
  expect(decision.isCurrent()).toBe(true);
  projects.adopt(b);
  const middle = projects.selectionLease()!;
  projects.adopt(a);
  const current = projects.selectionLease()!;
  expect(current.projectId).toBe(first.projectId);
  expect(first.isCurrent()).toBe(false);
  expect(middle.isCurrent()).toBe(false);
  expect(decision.isCurrent()).toBe(false);
  expect(await work.evaluate(first)).toEqual(keep);
  expect(current.isCurrent()).toBe(true);
  expect(other.projects.selectionLease()?.isCurrent()).toBe(true);
  expect(select.mock.calls).toEqual([[a], [b], [a]]);

  projects.adopt(empty);
  expect(projects.selectionLease()).toBeUndefined();
  expect(current.isCurrent()).toBe(false);
  projects.dispose();
  other.projects.dispose();
  expect(other.projects.selectionLease()).toBeUndefined();
});

it("revokes on a superseding opening intent and issues a fresh lease if the read fails", async () => {
  const { projects, select } = windowController();
  projects.adopt(a);
  const initial = projects.selectionLease()!;
  await projects.open(b.projectId);
  const retained = projects.selectionLease()!;
  expect(initial.isCurrent()).toBe(false);
  expect(retained.projectId).toBe(a.projectId);
  expect(select.mock.calls).toEqual([[a]]);
  expect(projects.snapshot().openingFailed).toBe(b.projectId);
  projects.beginCreation();
  expect(retained.isCurrent()).toBe(false);
  const afterCreation = projects.selectionLease()!;
  projects.forgetProjectRecords();
  expect(afterCreation.isCurrent()).toBe(false);
  const afterRecovery = projects.selectionLease()!;
  projects.dispose();
  expect(afterRecovery.isCurrent()).toBe(false);
});

it("serializes editor decisions and preserves the buffer on decline, rejection and failed save", async () => {
  const { projects, work } = windowController();
  projects.adopt(a);
  const lease = projects.selectionLease()!;
  let text = "Researcher-authored draft";
  let choice = deferred<"keep" | "save" | "discard">();
  let save = vi.fn(async () => false);
  const edit = vi.fn(async (scope: PendingWorkScope): Promise<PendingWorkDecision> => {
    const action = await choice.promise;
    if (action === "keep" || !scope.isCurrent()) return keep;
    if (action === "save" && !(await save())) return keep;
    if (!scope.isCurrent()) return keep;
    text = "";
    return { ...safe, isCurrent: () => text === "" };
  });
  work.register(lease, edit);
  const otherEditor = vi.fn(() => safe);
  work.register(lease, otherEditor);

  const declined = work.evaluate(lease);
  expect(await work.evaluate(lease)).toEqual(pending);
  expect(edit).toHaveBeenCalledOnce();
  expect(otherEditor).not.toHaveBeenCalled();
  choice.resolve("keep");
  expect(await declined).toEqual(keep);
  expect(save).not.toHaveBeenCalled();
  expect(text).toBe("Researcher-authored draft");

  choice = deferred();
  const failed = work.evaluate(lease);
  choice.resolve("save");
  expect(await failed).toEqual(keep);
  expect(save).toHaveBeenCalledOnce();
  expect(text).toBe("Researcher-authored draft");

  save = vi.fn(async () => {
    throw new Error("Save unavailable.");
  });
  expect(await work.evaluate(lease)).toEqual(keep);
  expect(text).toBe("Researcher-authored draft");
  expect(otherEditor).not.toHaveBeenCalled();

  choice = deferred();
  const discarded = work.evaluate(lease);
  choice.resolve("discard");
  const decision = await discarded;
  expect(decision.status).toBe("safe_to_detach");
  expect(text).toBe("");
  expect(otherEditor).toHaveBeenCalledOnce();
  if (decision.status !== "safe_to_detach") throw new Error("Expected a deliberate discard.");
  expect(decision.isCurrent()).toBe(true);
  text = "New edits";
  expect(decision.isCurrent()).toBe(false);
  save = vi.fn(async () => true);
  choice = deferred();
  const saved = work.evaluate(lease);
  choice.resolve("save");
  expect(await saved).toMatchObject(safe);
  expect(save).toHaveBeenCalledOnce();
  expect(text).toBe("");
  projects.dispose();
});

it("rejects a decision when earlier guarded work changes while another editor is waiting", async () => {
  const { projects, work } = windowController();
  projects.adopt(a);
  const lease = projects.selectionLease()!;
  let current = true;
  const waiting = deferred<PendingWorkDecision>();
  work.register(lease, () => ({ ...safe, isCurrent: () => current }));
  const second = vi.fn(() => waiting.promise);
  work.register(lease, second);
  const result = work.evaluate(lease);
  await Promise.resolve();
  expect(second).toHaveBeenCalledOnce();
  current = false;
  waiting.resolve(safe);
  expect(await result).toEqual(keep);
  projects.dispose();
});

it("revokes in-flight work on disposal and permits a fresh decision before the old guard answers", async () => {
  const { projects, work } = windowController();
  projects.adopt(a);
  const lease = projects.selectionLease()!;
  const delayed = deferred<PendingWorkDecision>();
  const guard = vi.fn((_scope: PendingWorkScope) => delayed.promise);
  const dispose = work.register(lease, guard);
  const checking = work.evaluate(lease);
  const scope = guard.mock.calls[0]![0];
  expect(scope.isCurrent()).toBe(true);
  dispose();
  dispose();
  expect(scope.signal.aborted).toBe(true);
  expect(await checking).toEqual(keep);
  const replacement = await work.evaluate(lease);
  expect(replacement).toMatchObject(safe);
  delayed.resolve(safe);
  await delayed.promise;
  if (replacement.status !== "safe_to_detach") throw new Error("Expected the new decision.");
  expect(replacement.isCurrent()).toBe(true);
  const withdraw = work.register(lease, () => pending);
  expect(replacement.isCurrent()).toBe(false);
  expect(await work.evaluate(lease)).toEqual(pending);
  withdraw();
  expect(await work.evaluate(lease)).toMatchObject(safe);
  projects.dispose();
});

it("ignores an approved editor decision after its project was replaced and reselected", async () => {
  const { projects, work, select } = windowController();
  projects.adopt(a);
  const first = projects.selectionLease()!;
  const allow = deferred<void>();
  const discard = vi.fn();
  const remove = work.register(first, async (scope) => {
    await allow.promise;
    if (scope.isCurrent()) discard();
    return safe;
  });
  const attempted = work.evaluate(first).then((decision) => {
    if (decision.status === "safe_to_detach" && decision.isCurrent()) projects.adopt(empty);
  });
  projects.adopt(b);
  expect(await work.evaluate(projects.selectionLease()!)).toMatchObject(safe);
  projects.adopt(a);
  const current = projects.selectionLease()!;
  const blocker = vi.fn(() => keep);
  work.register(current, blocker);
  remove();
  await attempted;
  allow.resolve();
  await allow.promise;
  expect(discard).not.toHaveBeenCalled();
  expect(select.mock.calls).toEqual([[a], [b], [a]]);
  expect(await work.evaluate(current)).toEqual(keep);
  expect(blocker).toHaveBeenCalledOnce();
  projects.dispose();
});

it("fails closed when a guard throws synchronously or a freshness check fails", async () => {
  const { projects, work } = windowController();
  projects.adopt(a);
  const lease = projects.selectionLease()!;
  const track = work.register(lease, () => {
    throw new Error("Editor unavailable.");
  });
  expect(await work.evaluate(lease)).toEqual(keep);
  track();
  work.register(lease, () => ({
    ...safe,
    isCurrent: () => {
      throw new Error("Editor state unavailable.");
    },
  }));
  expect(await work.evaluate(lease)).toEqual(keep);
  projects.dispose();
});
