import { describe, expect, it, vi } from "vitest";
import {
  CharacterController,
  effectiveCharacterMode,
  characterDurations,
  type CharacterEvent,
  type CharacterClock,
} from "../packages/renderer/src/character-controller.js";
const event = (patch: Partial<CharacterEvent> = {}): CharacterEvent => ({
  id: "event-1",
  project: "project-1",
  action: "action-1",
  result: "result-1",
  producer: "unknown",
  batch: "batch-1",
  text: "Synthetic comparison; coverage is incomplete.",
  language: "en-US",
  pose: "disagreement",
  relevant: true,
  deferToNavigator: true,
  ...patch,
});
function fixture(mode: "animated" | "static" | "hidden" = "animated") {
  const callbacks: (() => void)[] = [];
  const cancel = vi.fn();
  const timer: CharacterClock = {
    after(callback) {
      callbacks.push(callback);
      return cancel;
    },
  };
  const controller = new CharacterController("project-1", mode, timer);
  controller.setSurfaceAvailable(true);
  return { controller, callbacks, cancel };
}
describe("workspace character event lifetime", () => {
  it("resolves every mode with OS precedence and never turns hidden into static", () => {
    for (const mode of ["animated", "static", "hidden"] as const) {
      expect(effectiveCharacterMode(mode, false)).toBe(mode);
      expect(effectiveCharacterMode(mode, true)).toBe(mode === "animated" ? "static" : mode);
    }
    expect(new CharacterController("p").snapshot().mode).toBe("static");
  });
  it("captures attribution and rejects duplicates even when a caller changes the batch or result", () => {
    const { controller, callbacks } = fixture();
    const input = { ...event() };
    controller.receive(input);
    input.text = "changed after delivery";
    input.producer = "Virgilio";
    controller.receive(event({ batch: "new-batch", result: "other-result" }));
    expect(callbacks).toHaveLength(1);
    expect(controller.snapshot().notice?.text).toContain("Synthetic comparison");
    expect(controller.snapshot().notice?.producer).toBe("unknown");
    callbacks[0]!();
    controller.receive(event());
    expect(controller.snapshot().playing).toBeUndefined();
    controller.receive(event({ id: "next", batch: "next" }));
    expect(controller.snapshot().playing?.id).toBe("next");
  });
  it("coalesces one batch and never queues coincident or busy-workspace events", () => {
    const { controller, callbacks } = fixture();
    controller.receive(event());
    controller.receive(event({ id: "coincident" }));
    controller.receive(event({ id: "busy", batch: "busy" }));
    expect(callbacks).toHaveLength(1);
    callbacks[0]!();
    controller.receive(event({ id: "busy-result", batch: "busy" }));
    controller.receive(event({ id: "batch-result" }));
    expect(controller.snapshot().playing).toBeUndefined();
    controller.receive(event({ id: "new", batch: "new" }));
    expect(callbacks).toHaveLength(2);
    callbacks[0]!();
    expect(controller.snapshot().playing?.id).toBe("new");
    callbacks[1]!();
    expect(controller.snapshot().notice?.id).toBe("new");
  });
  it("consumes one deferred finding only on a relevant explicit Navigator opening", () => {
    const { controller, callbacks } = fixture();
    controller.setManuscriptVisible(true);
    controller.receive(event());
    expect(controller.snapshot().deferred?.batch).toBe("batch-1");
    expect(callbacks).toHaveLength(0);
    controller.openNavigator(false, true);
    expect(controller.snapshot().deferred).toBeDefined();
    controller.setManuscriptVisible(false);
    controller.openNavigator(true, true);
    expect(controller.snapshot().playing?.id).toBe("event-1");
    controller.openNavigator(true, true);
    callbacks[0]!();
    controller.receive(event({ id: "result-2" }));
    expect(callbacks).toHaveLength(1);
  });
  it("discards irrelevant or obstructed deferred events and permits no backlog", () => {
    const { controller, callbacks } = fixture();
    controller.setManuscriptVisible(true);
    controller.receive(event({ deferToNavigator: false }));
    expect(controller.snapshot().deferred).toBeUndefined();
    controller.receive(event({ id: "deferred", batch: "second" }));
    controller.receive(event({ id: "extra", batch: "third" }));
    expect(controller.snapshot().deferred?.id).toBe("deferred");
    controller.openNavigator(true, true);
    expect(controller.snapshot().deferred).toBeUndefined();
    controller.setManuscriptVisible(false);
    controller.openNavigator(true, true);
    controller.receive(event({ id: "extra-2", batch: "third" }));
    expect(callbacks).toHaveLength(1);
    expect(controller.snapshot().playing?.id).toBe("extra-2");
    controller.setManuscriptVisible(true);
    controller.receive(event({ id: "resolved", batch: "fourth" }));
    controller.setManuscriptVisible(false);
    controller.openNavigator(true, false);
    expect(callbacks).toHaveLength(1);
  });
  it("cancels motion synchronously for Static, Hidden and reduced motion without replay", () => {
    for (const mode of ["static", "hidden"] as const) {
      const { controller, callbacks, cancel } = fixture();
      const motion = vi.fn();
      controller.receive(event());
      const unregister = controller.registerMotion(motion);
      controller.setMode(mode);
      expect(cancel).toHaveBeenCalledOnce();
      expect(motion).toHaveBeenCalledOnce();
      callbacks[0]!();
      controller.setMode("animated");
      controller.receive(event());
      expect(controller.snapshot().playing).toBeUndefined();
      expect(controller.snapshot().notice?.text).toContain("Synthetic");
      unregister();
      controller.setManuscriptVisible(true);
      controller.receive(event({ id: "pending", batch: "pending" }));
      controller.setMode(mode);
      controller.setMode("animated");
      controller.setManuscriptVisible(false);
      controller.openNavigator(true, true);
      controller.receive(event({ id: "pending-result", batch: "pending" }));
      expect(controller.snapshot().playing).toBeUndefined();
    }
  });
  it("does not animate passive recovery or events from another project", () => {
    const { controller, callbacks } = fixture();
    controller.receive(event({ project: "other" }));
    controller.receive(event(), true);
    controller.receive(event({ id: "restored-result" }));
    expect(callbacks).toHaveLength(0);
    expect(controller.snapshot().notice?.id).toBe("event-1");
    const restarted = fixture("static");
    restarted.controller.receive(event(), true);
    restarted.controller.setMode("animated");
    restarted.controller.receive(event());
    expect(restarted.callbacks).toHaveLength(0);
  });
  it("invalidates dismissal, resolution and renderer replacement with event/batch fences", () => {
    const { controller, callbacks } = fixture();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.receive(event());
    controller.invalidate("unrelated");
    expect(controller.snapshot().playing).toBeDefined();
    controller.receive(event({ relevant: false }));
    callbacks[0]!();
    expect(controller.snapshot().notice).toBeUndefined();
    controller.receive(event({ id: "new", batch: "new" }));
    controller.cancelPresentation();
    callbacks[1]!();
    expect(controller.snapshot().notice?.id).toBe("new");
    expect(controller.snapshot().playing).toBeUndefined();
    controller.setManuscriptVisible(true);
    controller.receive(event({ id: "pending", batch: "pending" }));
    controller.invalidate("pending");
    controller.setManuscriptVisible(false);
    controller.openNavigator(true, true);
    expect(controller.snapshot().playing).toBeUndefined();
    unsubscribe();
    controller.invalidate();
    controller.receive(event({ id: "end", batch: "end" }));
    controller.dispose();
    controller.dispose();
    const count = listener.mock.calls.length;
    for (const callback of callbacks) callback();
    controller.receive(event({ id: "late", batch: "late" }));
    controller.setMode("hidden");
    controller.setManuscriptVisible(true);
    controller.invalidate();
    controller.cancelPresentation();
    controller.openNavigator(true, true);
    const late = vi.fn();
    controller.registerMotion(late)();
    controller.subscribe(listener)();
    expect(late).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledTimes(count);
    expect(controller.snapshot().playing).toBeUndefined();
  });
  it("never replays events suppressed by a compact or detached surface", () => {
    const { controller, callbacks } = fixture();
    controller.receive(event());
    controller.setSurfaceAvailable(false);
    callbacks[0]!();
    controller.receive(event({ id: "compact", batch: "compact" }));
    controller.setSurfaceAvailable(true);
    controller.receive(event({ id: "compact-result", batch: "compact" }));
    expect(controller.snapshot().playing).toBeUndefined();
    controller.receive(event({ id: "available", batch: "available" }));
    expect(controller.snapshot().playing?.id).toBe("available");
    controller.dispose();
    controller.setSurfaceAvailable(false);
  });
  it("expires still poses without motion, keeps milestone at rest and cancels obsolete static timers", () => {
    const { controller, callbacks, cancel } = fixture("static");
    controller.receive(event());
    expect(controller.snapshot().pose).toBe("disagreement");
    expect(controller.snapshot().playing).toBeUndefined();
    controller.receive(event({ id: "new", batch: "new", pose: "milestone" }));
    expect(controller.snapshot().pose).toBeUndefined();
    callbacks[0]!();
    expect(controller.snapshot().notice?.id).toBe("new");
    callbacks[1]!();
    expect(controller.snapshot().pose).toBeUndefined();
    expect(cancel).toHaveBeenCalled();
    controller.receive(event({ id: "passive", batch: "passive" }), true);
    expect(controller.snapshot().pose).toBeUndefined();
  });
  it("does not leave timers when a synchronous presentation subscriber disposes the workspace", () => {
    vi.useFakeTimers();
    try {
      for (const mode of ["animated", "static"] as const) {
        const controller = new CharacterController("project-1", mode);
        controller.setSurfaceAvailable(true);
        controller.subscribe(() => {
          controller.dispose();
        });
        controller.receive(event());
        expect(vi.getTimerCount()).toBe(0);
        expect(controller.snapshot().playing).toBeUndefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it("settles active motion on passive restoration without stranding a busy event", () => {
    for (const duplicate of [false, true]) {
      const { controller, callbacks, cancel } = fixture();
      controller.receive(event({ id: "active" }));
      controller.receive(
        event({ id: duplicate ? "active" : "passive", batch: duplicate ? "batch-1" : "passive" }),
        true,
      );
      expect(controller.snapshot().playing).toBeUndefined();
      expect(controller.snapshot().presenting).toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      controller.invalidate(duplicate ? "active" : "passive");
      callbacks[0]!();
      controller.receive(event({ id: "new", batch: "new" }));
      expect(controller.snapshot().playing?.id).toBe("new");
    }
  });
  it("keeps one unused deferred allowance for either order of coincident manuscript receipts", () => {
    for (const eligibleFirst of [false, true])
      for (const passiveFirst of [false, true]) {
        const { controller, callbacks } = fixture();
        controller.setManuscriptVisible(true);
        const eligible = event({ id: "eligible" });
        const plain = event({ id: "plain", deferToNavigator: false });
        const passive = event({ id: "passive-same-batch", deferToNavigator: false });
        if (passiveFirst) controller.receive(passive, true);
        for (const input of eligibleFirst ? [eligible, plain] : [plain, eligible])
          controller.receive(input);
        if (!passiveFirst) controller.receive(passive, true);
        expect(controller.snapshot().deferred?.id).toBe("eligible");
        controller.setManuscriptVisible(false);
        controller.openNavigator(true, true);
        expect(controller.snapshot().playing?.id).toBe("eligible");
        expect(callbacks).toHaveLength(1);
        controller.openNavigator(true, true);
        expect(callbacks).toHaveLength(1);
      }
  });
  it("fences every reentrant deferred cancellation before scheduling motion", () => {
    for (const action of [
      "cancel",
      "invalidate",
      "dispose",
      "unavailable",
      "hidden",
      "manuscript",
    ] as const) {
      const { controller, callbacks } = fixture();
      controller.setManuscriptVisible(true);
      controller.receive(event({ id: "eligible" }));
      controller.receive(event({ id: "other-notice", deferToNavigator: false }));
      controller.setManuscriptVisible(false);
      let once = true;
      controller.subscribe(() => {
        if (!once || controller.snapshot().deferred) return;
        once = false;
        if (action === "cancel") controller.cancelPresentation();
        if (action === "invalidate") controller.invalidate("eligible");
        if (action === "dispose") controller.dispose();
        if (action === "unavailable") controller.setSurfaceAvailable(false);
        if (action === "hidden") controller.setMode("hidden");
        if (action === "manuscript") controller.setManuscriptVisible(true);
      });
      controller.openNavigator(true, true);
      expect(controller.snapshot().playing, action).toBeUndefined();
      expect(controller.snapshot().presenting, action).toBeUndefined();
      expect(callbacks, action).toHaveLength(0);
    }
  });
  it("does not revive an event whose dismissal or resolution arrived first", () => {
    for (const irrelevant of [false, true]) {
      const { controller, callbacks } = fixture();
      if (irrelevant) controller.receive(event({ relevant: false }));
      else controller.invalidate("event-1");
      controller.receive(event());
      expect(controller.snapshot().playing).toBeUndefined();
      expect(controller.snapshot().notice).toBeUndefined();
      expect(callbacks).toHaveLength(0);
      controller.receive(event({ id: "valid", batch: "valid" }));
      expect(controller.snapshot().playing?.id).toBe("valid");
    }
  });
  it("keeps Static manuscript arrivals compact when the manuscript later closes", () => {
    for (const pose of ["thinking", "disagreement", "milestone"] as const) {
      const { controller, callbacks } = fixture("static");
      controller.setManuscriptVisible(true);
      controller.receive(event({ pose }));
      expect(controller.snapshot().notice?.id).toBe("event-1");
      expect(controller.snapshot().presenting).toBeUndefined();
      expect(controller.snapshot().deferred).toBeUndefined();
      controller.setManuscriptVisible(false);
      controller.openNavigator(false, true);
      expect(controller.snapshot().presenting).toBeUndefined();
      controller.setMode("animated");
      controller.receive(event({ id: "same-batch" }));
      expect(callbacks).toHaveLength(0);
    }
  });
  it("consumes unavailable arrivals before the first renderer attaches without starting a timer", () => {
    const after = vi.fn(() => vi.fn());
    const controller = new CharacterController("project-1", "animated", { after });
    controller.receive(event());
    expect(controller.snapshot().playing).toBeUndefined();
    expect(controller.snapshot().presenting).toBeUndefined();
    expect(controller.snapshot().notice?.id).toBe("event-1");
    expect(after).not.toHaveBeenCalled();
    controller.setSurfaceAvailable(true);
    controller.receive(event());
    controller.receive(event({ id: "same-batch" }));
    expect(after).not.toHaveBeenCalled();
    controller.receive(event({ id: "new", batch: "new" }));
    expect(after).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it("reserves restored history batches regardless of manuscript visibility or initial attachment", () => {
    const active = fixture();
    active.controller.receive(event({ id: "active", batch: "active" }));
    active.controller.restore(event());
    expect(active.controller.snapshot().playing).toBeUndefined();
    expect(active.controller.snapshot().notice?.id).toBe("event-1");
    active.callbacks[0]!();
    expect(active.controller.snapshot().notice?.id).toBe("event-1");
    active.controller.receive(event({ id: "resumed" }));
    expect(active.callbacks).toHaveLength(1);
    active.controller.dispose();
    const pending = fixture();
    pending.controller.setManuscriptVisible(true);
    pending.controller.receive(event({ id: "pending", batch: "pending" }));
    pending.controller.restore(event());
    expect(pending.controller.snapshot().deferred).toBeUndefined();
    pending.controller.setManuscriptVisible(false);
    pending.controller.openNavigator(true, true);
    pending.controller.receive(event({ id: "pending-result", batch: "pending" }));
    expect(pending.callbacks).toHaveLength(0);
    pending.controller.dispose();
    for (const manuscript of [false, true]) {
      for (const attached of [false, true]) {
        const controller = new CharacterController("project-1", "animated");
        controller.setSurfaceAvailable(attached);
        controller.setManuscriptVisible(manuscript);
        controller.restore(event({ project: "other" }));
        controller.restore(event());
        expect(controller.snapshot().notice?.id).toBe("event-1");
        expect(controller.snapshot().presenting).toBeUndefined();
        controller.setSurfaceAvailable(true);
        controller.receive(event({ id: "resumed", deferToNavigator: true }));
        controller.setManuscriptVisible(false);
        controller.openNavigator(true, true);
        expect(controller.snapshot().playing).toBeUndefined();
        expect(controller.snapshot().deferred).toBeUndefined();
        controller.receive(event({ id: "new-action", batch: "new-action" }));
        expect(controller.snapshot().playing?.id).toBe("new-action");
        controller.dispose();
        controller.restore(event());
      }
    }
  });
  it("reserves restored batches before synchronous coincident receipts can animate", () => {
    for (const mode of ["animated", "static", "hidden"] as const)
      for (const pose of ["thinking", "disagreement", "milestone"] as const)
        for (const seen of [false, true])
          for (const manuscript of [false, true]) {
            const { controller, callbacks } = fixture(mode);
            controller.setManuscriptVisible(true);
            if (seen) controller.receive(event({ pose, deferToNavigator: false }), true);
            controller.setManuscriptVisible(manuscript);
            let once = true;
            controller.subscribe(() => {
              if (!once) return;
              once = false;
              controller.receive(event({ id: "coincident-live", pose }));
            });
            controller.restore(event({ pose }));
            expect(controller.snapshot().playing, mode).toBeUndefined();
            expect(controller.snapshot().presenting, mode).toBeUndefined();
            expect(callbacks, mode).toHaveLength(0);
            controller.setManuscriptVisible(false);
            controller.receive(event({ id: "new-action", batch: "new-action", pose }));
            expect(callbacks, mode).toHaveLength(mode === "hidden" ? 0 : 1);
            controller.dispose();
          }
  });
  it("retains a bounded Static presentation when later consumed-batch receipts stay compact", () => {
    for (const fallback of [false, true])
      for (const sameBatch of [false, true])
        for (const pose of ["thinking", "disagreement", "milestone"] as const) {
          const { controller, callbacks, cancel } = fixture(fallback ? "animated" : "static");
          controller.receive(event({ id: "old", batch: "old" }), true);
          controller.receive(event({ pose }));
          if (fallback) controller.setMode("static");
          const presenting = controller.snapshot().presenting;
          const notice = controller.snapshot().notice;
          const scheduled = callbacks.length;
          const canceled = cancel.mock.calls.length;
          expect(presenting?.id).toBe("event-1");
          controller.receive(
            event({ id: "coincident", batch: sameBatch ? "batch-1" : "old", pose }),
          );
          expect(controller.snapshot().presenting).toBe(presenting);
          expect(controller.snapshot().notice).toBe(notice);
          expect(callbacks).toHaveLength(scheduled);
          expect(cancel).toHaveBeenCalledTimes(canceled);
          callbacks.at(-1)!();
          expect(controller.snapshot().presenting).toBeUndefined();
          controller.receive(event({ id: "later-static", pose }));
          expect(controller.snapshot().presenting).toBeUndefined();
          expect(callbacks).toHaveLength(scheduled);
          controller.receive(event({ id: "new-action", batch: "new-action", pose }));
          expect(controller.snapshot().presenting?.id).toBe("new-action");
          expect(callbacks).toHaveLength(scheduled + 1);
          controller.dispose();
        }
  });
  it("does not bypass a pending batch on live receipt after passive manuscript hiding", () => {
    const { controller, callbacks } = fixture();
    controller.setManuscriptVisible(true);
    controller.receive(event());
    controller.setManuscriptVisible(false);
    controller.openNavigator(false, true);
    controller.receive(event({ id: "coincident-result" }));
    expect(controller.snapshot().playing).toBeUndefined();
    expect(controller.snapshot().deferred?.id).toBe("event-1");
    expect(callbacks).toHaveLength(0);
    controller.openNavigator(true, true);
    expect(controller.snapshot().playing?.id).toBe("event-1");
    expect(callbacks).toHaveLength(1);
    controller.dispose();
  });
  it("consumes a deferred batch superseded by a new action rather than reviving it later", () => {
    const { controller, callbacks } = fixture();
    controller.setManuscriptVisible(true);
    controller.receive(event());
    controller.setManuscriptVisible(false);
    controller.receive(event({ id: "new-action", batch: "new-action" }));
    expect(controller.snapshot().deferred).toBeUndefined();
    callbacks[0]!();
    controller.receive(event({ id: "old-result" }));
    expect(controller.snapshot().playing).toBeUndefined();
    controller.openNavigator(true, true);
    expect(callbacks).toHaveLength(1);
    controller.dispose();
  });
  it("treats an empty event identity as specific rather than clearing unrelated presentation", () => {
    const { controller } = fixture();
    controller.receive(event());
    controller.invalidate("");
    expect(controller.snapshot().playing?.id).toBe("event-1");
    expect(controller.snapshot().notice?.id).toBe("event-1");
    controller.receive(event({ id: "", batch: "empty" }));
    expect(controller.snapshot().notice?.id).toBe("event-1");
    controller.invalidate();
    expect(controller.snapshot().notice).toBeUndefined();
  });
  it("bounds all delivered poses and removes real clock timers on disposal", () => {
    vi.useFakeTimers();
    try {
      for (const pose of Object.keys(characterDurations) as (keyof typeof characterDurations)[]) {
        const controller = new CharacterController("project-1", "animated");
        controller.setSurfaceAvailable(true);
        controller.receive(event({ pose }));
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(characterDurations[pose]);
        expect(controller.snapshot().playing).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
        controller.receive(event({ id: "new", batch: "new", pose }));
        controller.dispose();
        expect(vi.getTimerCount()).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
