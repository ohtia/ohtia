import { describe, it, expect, vi } from "vitest";
import { failure, staleRevision, type Outcome } from "@ohtia/contracts";
import { harness, call, deferred, snapshot } from "./fixtures/settings.js";
describe("Settings preference ordering", () => {
  it("confirms each named setting once and suppresses passive duplicates", async () => {
    const h = harness();
    await h.controller.refresh();
    expect(h.controller.snapshot().current?.character.value).toBe("animated");
    await h.controller.choose("appearance", "dark");
    await h.controller.choose("character", "hidden");
    await h.controller.choose("zoom", 125);
    expect(h.port.replaceAppearance).toHaveBeenCalledWith(
      {
        operationId: "operation-1",
        expectedRevision: 0,
        value: "dark",
      },
      "service-1",
    );
    expect(h.controller.snapshot().settings.zoom.phase).toBe("confirmed");
    const count = h.apply.mock.calls.length;
    h.notify({ ok: true, value: h.current });
    await Promise.resolve();
    expect(h.apply).toHaveBeenCalledTimes(count);
    expect(h.controller.snapshot().settings.zoom.changedFromWindow).toBe(false);
    h.controller.dispose();
    expect(h.stop).toHaveBeenCalled();
  });
  it("keeps an uncertain operation and queries only its original receipt", async () => {
    const h = harness();
    await h.controller.refresh();
    h.port.replaceCharacter.mockReturnValueOnce(call(failure("uncertain")) as never);
    await h.controller.choose("character", "static");
    expect(h.controller.snapshot().settings.character.phase).toBe("uncertain");
    expect(await h.controller.choose("character", "hidden")).toBe(false);
    await h.controller.check("character");
    expect(h.port.readCharacterReceipt).toHaveBeenCalledWith("operation-1");
    expect(h.controller.snapshot().settings.character.canChoose).toBe(false);
    const saved = {
      schemaVersion: 1 as const,
      source: "saved" as const,
      revision: 1,
      value: "static",
    };
    h.port.readCharacterReceipt.mockReturnValueOnce(
      call({
        ok: true,
        value: { state: "recorded", outcome: { ok: true, value: saved } },
      }) as never,
    );
    await h.controller.check("character");
    expect(h.controller.snapshot().settings.character.phase).toBe("confirmed");
    expect(h.port.replaceCharacter).toHaveBeenCalledTimes(1);
  });
  it("allows a new explicit intent after ceased-generation durable absence without replay", async () => {
    const h = harness();
    await h.controller.refresh();
    h.port.adjustZoom.mockReturnValueOnce(call(failure("uncertain")) as never);
    await h.controller.choose("zoom", 110, "increase");
    h.notify({ ok: true, value: { ...h.current, serviceGeneration: "service-2" } });
    await h.controller.check("zoom");
    expect(h.controller.snapshot().settings.zoom.canChoose).toBe(true);
    await h.controller.retry("zoom");
    expect(h.port.adjustZoom).toHaveBeenNthCalledWith(2, "operation-2", "increase", "service-2");
    h.notify({
      ok: true,
      value: {
        ...snapshot(),
        zoom: { schemaVersion: 1, source: "saved", revision: 8, value: 400 },
      },
    });
    expect(h.controller.snapshot().current?.serviceGeneration).toBe("service-2");
  });
  it("retains save success when refresh or display application fails, and retries only application", async () => {
    const h = harness();
    await h.controller.refresh();
    h.apply.mockRejectedValueOnce(new Error("render"));
    h.port.readPresentation.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await h.controller.choose("appearance", "dark");
    await Promise.resolve();
    expect(h.controller.snapshot().settings.appearance).toMatchObject({
      phase: "confirmed",
      displayFailed: true,
    });
    expect(h.controller.snapshot().readFailed).toBe(true);
    h.controller.applyAgain("appearance");
    await Promise.resolve();
    await Promise.resolve();
    expect(h.port.replaceAppearance).toHaveBeenCalledTimes(1);
    await h.controller.refresh();
    expect(h.controller.snapshot().readFailed).toBe(false);
  });
  it("keeps rejection/conflict inspectable and uses a fresh ID only for explicit retry", async () => {
    const h = harness();
    await h.controller.refresh();
    h.port.replaceAppearance.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await h.controller.choose("appearance", "light");
    expect(h.controller.snapshot().settings.appearance).toMatchObject({
      phase: "rejected",
      draft: "system",
    });
    await h.controller.retry("appearance");
    expect(h.port.replaceAppearance).toHaveBeenLastCalledWith(
      {
        operationId: "operation-2",
        expectedRevision: 0,
        value: "light",
      },
      "service-1",
    );
    h.port.replaceZoom.mockReturnValueOnce(call(staleRevision(3)) as never);
    await h.controller.choose("zoom", 200);
    expect(h.controller.snapshot().settings.zoom.phase).toBe("conflict");
    expect(await h.controller.retry("zoom")).toBe(false);
  });
  it("rejects stale revisions and recovers a stream gap with one bounded reread", async () => {
    const h = harness();
    await h.controller.refresh();
    h.notify({
      ok: true,
      value: { ...h.current, zoom: { schemaVersion: 1, revision: 3, value: 200, source: "saved" } },
    });
    h.notify({ ok: true, value: snapshot() });
    expect(h.controller.snapshot().current?.zoom.value).toBe(200);
    h.notify(failure("sequence_gap"));
    await h.controller.refresh();
    expect(h.port.subscribePresentation).toHaveBeenCalledTimes(2);
    expect(h.stop).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a new controller or run late display callbacks after disposal", async () => {
    const h = harness();
    await h.controller.refresh();
    const result = deferred<Outcome<never>>();
    h.port.replaceAppearance.mockReturnValueOnce({
      result: result.promise,
      cancel: vi.fn(),
    } as never);
    const pending = h.controller.choose("appearance", "dark");
    const count = h.apply.mock.calls.length;
    h.controller.dispose();
    result.resolve(failure("uncertain"));
    await pending;
    h.controller.applyAgain("appearance");
    await h.controller.refresh();
    expect(h.apply).toHaveBeenCalledTimes(count);
    expect(h.controller.snapshot().settings.appearance.phase).toBe("submitting");
  });
  it("ignores invalid choices, concurrent checks and unavailable actions", async () => {
    const h = harness();
    expect(await h.controller.choose("appearance", "dark")).toBe(false);
    await h.controller.refresh();
    expect(await h.controller.choose("character", "other" as never)).toBe(false);
    h.port.replaceZoom.mockReturnValueOnce(call(failure("uncertain")) as never);
    await h.controller.choose("zoom", 125);
    h.port.readZoomReceipt.mockClear();
    const pending = deferred<Outcome<never>>();
    h.port.readZoomReceipt.mockReturnValueOnce({
      result: pending.promise,
      cancel: vi.fn(),
    } as never);
    const check = h.controller.check("zoom");
    await h.controller.check("zoom");
    expect(await h.controller.choose("zoom", 150)).toBe(false);
    pending.resolve(failure("service_unavailable"));
    await check;
    expect(h.port.readZoomReceipt).toHaveBeenCalledTimes(1);
  });
});

it("reports refusal by another window's zoom admission as unavailable rather than a failed save", async () => {
  const h = harness();
  await h.controller.refresh();
  h.port.adjustZoom.mockReturnValueOnce(call(failure("busy")) as never);
  expect(await h.controller.choose("zoom", 110, "increase")).toBe(false);
  expect(h.controller.snapshot()).toMatchObject({
    zoomBusy: true,
    settings: { zoom: { phase: "idle", draft: 100 } },
  });
  await h.controller.refresh();
  expect(h.controller.snapshot().zoomBusy).toBe(false);
});

it("retains a failed recovery stream even when its concurrent reread succeeds", async () => {
  const h = harness();
  await h.controller.refresh();
  const reading = deferred<Outcome<ReturnType<typeof snapshot>>>();
  h.port.readPresentation.mockReturnValueOnce({ result: reading.promise, cancel: vi.fn() });
  const refresh = h.controller.refresh();
  h.notify(failure("sequence_gap"));
  reading.resolve({ ok: true, value: h.current });
  await refresh;
  expect(h.controller.snapshot().readFailed).toBe(true);
  expect(h.port.subscribePresentation).toHaveBeenCalledTimes(2);
  await h.controller.refresh();
  expect(h.controller.snapshot().readFailed).toBe(false);
});

it("explains an endpoint reached in another window before a relative intent is admitted", async () => {
  const h = harness();
  await h.controller.refresh();
  h.port.adjustZoom.mockReturnValueOnce(call(failure("zoom_maximum")) as never);
  h.port.readPresentation.mockReturnValueOnce(
    call({
      ok: true,
      value: { ...h.current, zoom: { schemaVersion: 1, revision: 1, value: 400, source: "saved" } },
    }) as never,
  );
  expect(await h.controller.choose("zoom", 110, "increase")).toBe(false);
  expect(h.controller.snapshot()).toMatchObject({
    zoomBusy: false,
    zoomReason: "zoom_maximum",
    settings: { zoom: { phase: "idle" } },
  });
});

it("keeps the last verified factor separate from a saved zoom that this window cannot apply", async () => {
  const h = harness();
  await h.controller.refresh();
  h.apply.mockRejectedValueOnce(new Error("factor readback failed"));
  await h.controller.choose("zoom", 125);
  expect(h.controller.snapshot()).toMatchObject({
    effectiveZoom: 100,
    current: { zoom: { value: 125 } },
    settings: { zoom: { phase: "confirmed", displayFailed: true } },
  });
  h.controller.applyAgain("zoom");
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.port.replaceZoom).toHaveBeenCalledTimes(1);
});
it.each([
  { intent: "reset", code: "actual_size", start: 125 },
  { intent: "increase", code: "zoom_maximum", start: 300 },
  { intent: "decrease", code: "zoom_minimum", start: 90 },
] as const)(
  "does not retain $code after the current authoritative zoom has changed",
  async ({ intent, code, start }) => {
    const h = harness();
    await h.controller.refresh();
    h.notify({
      ok: true,
      value: {
        ...h.current,
        zoom: { schemaVersion: 1, revision: 1, source: "saved", value: start },
      },
    });
    h.port.adjustZoom.mockReturnValueOnce(call(failure(code)) as never);
    h.port.readPresentation.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          ...h.current,
          zoom: { schemaVersion: 1, revision: 3, source: "saved", value: 125 },
        },
      }) as never,
    );
    await h.controller.choose("zoom", start, intent);
    expect(h.controller.snapshot().current?.zoom.value).toBe(125);
    expect(h.controller.snapshot().zoomReason).toBeUndefined();
  },
);
it("scopes remote-change notices to the open view and retains them across unrelated snapshots", async () => {
  const h = harness();
  await h.controller.refresh();
  h.notify({
    ok: true,
    value: {
      ...h.current,
      appearance: { schemaVersion: 1, revision: 1, value: "dark", source: "saved" },
    },
  });
  expect(h.controller.snapshot().settings.appearance.changedFromWindow).toBe(false);
  h.controller.setViewOpen(true);
  expect(h.controller.snapshot().settings.appearance.changedFromWindow).toBe(false);
  h.notify({
    ok: true,
    value: {
      ...h.current,
      appearance: { schemaVersion: 1, revision: 2, value: "light", source: "saved" },
    },
  });
  expect(h.controller.snapshot().settings.appearance.changedFromWindow).toBe(true);
  h.notify({
    ok: true,
    value: {
      ...h.current,
      character: { schemaVersion: 1, revision: 1, value: "hidden", source: "saved" },
    },
  });
  expect(h.controller.snapshot().settings.appearance.changedFromWindow).toBe(true);
  h.controller.setViewOpen(false);
  expect(h.controller.snapshot().settings.appearance.changedFromWindow).toBe(false);
  h.controller.dispose();
  h.controller.setViewOpen(true);
});
it.each([
  { intent: "reset", code: "actual_size", start: 125 },
  { intent: "increase", code: "zoom_maximum", start: 300 },
  { intent: "decrease", code: "zoom_minimum", start: 90 },
] as const)(
  "does not restore $code from a delayed receipt when the reread fails",
  async ({ intent, code, start }) => {
    const h = harness();
    await h.controller.refresh();
    h.notify({
      ok: true,
      value: {
        ...h.current,
        zoom: { schemaVersion: 1, revision: 1, value: start, source: "saved" },
      },
    });
    const receipt = deferred<Outcome<never>>();
    h.port.adjustZoom.mockReturnValueOnce(call(failure("uncertain")) as never);
    h.port.readZoomReceipt.mockReturnValueOnce({
      result: receipt.promise,
      cancel: vi.fn(),
    } as never);
    const chosen = h.controller.choose("zoom", start, intent);
    await Promise.resolve();
    await Promise.resolve();
    h.notify({
      ok: true,
      value: { ...h.current, zoom: { schemaVersion: 1, revision: 3, value: 125, source: "saved" } },
    });
    h.port.readPresentation.mockReturnValueOnce(call(failure("storage_failed")) as never);
    receipt.resolve({ ok: true, value: { state: "recorded", outcome: failure(code) } } as never);
    await chosen;
    expect(h.controller.snapshot()).toMatchObject({
      readFailed: true,
      zoomReason: undefined,
      current: { zoom: { value: 125, revision: 3 } },
    });
    expect(h.port.readZoomReceipt).toHaveBeenCalledWith("operation-1");
  },
);

it.each(
  ["service-1", "service-2"].flatMap((generation) =>
    (
      [
        {
          feature: "appearance",
          attempted: "dark",
          newer: "light",
          replace: "replaceAppearance",
          receipt: "readAppearanceReceipt",
        },
        {
          feature: "character",
          attempted: "static",
          newer: "hidden",
          replace: "replaceCharacter",
          receipt: "readCharacterReceipt",
        },
        {
          feature: "zoom",
          attempted: 125,
          newer: 150,
          replace: "replaceZoom",
          receipt: "readZoomReceipt",
        },
      ] as const
    ).map((entry) => ({ ...entry, generation })),
  ),
)(
  "keeps the newer $feature selection in $generation after an older success and a failed reread",
  async ({ feature, attempted, newer, replace, receipt, generation }) => {
    const h = harness();
    await h.controller.refresh();
    h.controller.setViewOpen(true);
    const recorded = deferred<Outcome<never>>();
    h.port[replace].mockReturnValueOnce(call(failure("uncertain")) as never);
    h.port[receipt].mockReturnValueOnce({ result: recorded.promise, cancel: vi.fn() } as never);
    const chosen = h.controller.choose(feature, attempted);
    await Promise.resolve();
    await Promise.resolve();
    h.notify({
      ok: true,
      value: {
        ...h.current,
        serviceGeneration: generation,
        [feature]: {
          schemaVersion: 1,
          revision: 2,
          value: newer,
          source: "saved",
        },
      },
    });
    h.port.readPresentation.mockReturnValueOnce(call(failure("storage_failed")) as never);
    recorded.resolve({
      ok: true,
      value: {
        state: "recorded",
        outcome: {
          ok: true,
          value: {
            schemaVersion: 1,
            revision: 1,
            value: attempted,
            source: "saved",
          },
        },
      },
    } as never);
    await chosen;
    expect(h.controller.snapshot().settings[feature]).toMatchObject({
      phase: "confirmed",
      draft: newer,
      changedFromWindow: true,
    });
    expect(h.controller.snapshot().current?.[feature]).toMatchObject({ revision: 2, value: newer });
    expect(h.controller.snapshot().readFailed).toBe(true);
    expect(h.port[replace]).toHaveBeenCalledTimes(1);
    expect(h.port[receipt]).toHaveBeenCalledWith("operation-1");
    expect(
      h.apply.mock.calls.filter(
        ([appliedFeature, record]) => appliedFeature === feature && record.value === attempted,
      ),
    ).toHaveLength(0);
  },
);
