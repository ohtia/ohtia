import { describe, expect, it, vi } from "vitest";
import { nativeCommandWheel, verifyNativePinch } from "../tooling/settings-acceptance.mjs";
import {
  nativeFailureObservations,
  withNativeFailureObservation,
} from "../tooling/native-failure-observation.mjs";

function fixture() {
  const cdp = {
    send: vi.fn(async () => ({ cssVisualViewport: { scale: 1 } })),
    detach: vi.fn(async () => {}),
  };
  const page = {
    context: () => ({ newCDPSession: vi.fn(async () => cdp) }),
    evaluate: vi.fn(async () => ({ ok: true, value: { zoom: { value: 100, revision: 1 } } })),
  };
  let phase = "initial";
  return {
    cdp,
    page,
    enterPhase: (name: string) => {
      phase = name;
    },
    observeFailure: (operation: () => Promise<unknown>) =>
      withNativeFailureObservation(null, () => ({ phase }), operation),
  };
}

describe("native Settings pinch failure boundaries", () => {
  it.each([
    ["baseline", "pinch-baseline"],
    ["gesture", "pinch-gesture"],
    ["metrics", "pinch-layout-metrics"],
  ])("retains %s failure before a simultaneous detach failure", async (boundary, expectedPhase) => {
    const input = fixture();
    const primary = new Error("synthetic initiating failure");
    const cleanup = new Error("synthetic detach failure");
    if (boundary === "baseline") input.page.evaluate.mockRejectedValueOnce(primary);
    else
      input.cdp.send.mockImplementation(async (method: string) => {
        if (
          method ===
          (boundary === "gesture" ? "Input.synthesizePinchGesture" : "Page.getLayoutMetrics")
        )
          throw primary;
        return { cssVisualViewport: { scale: 1 } };
      });
    input.cdp.detach.mockRejectedValueOnce(cleanup);
    try {
      await verifyNativePinch(input.page, input.enterPhase, input.observeFailure, vi.fn());
      expect.unreachable("Both operation and cleanup must remain failures.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(nativeFailureObservations(error).map((item) => item.phase)).toEqual([
        expectedPhase,
        "pinch-detach",
      ]);
      expect((error as AggregateError).errors.map((item) => item.cause)).toEqual([
        primary,
        cleanup,
      ]);
      expect(input.cdp.detach).toHaveBeenCalledOnce();
    }
  });

  it("keeps the required pinch metrics and unchanged interface zoom assertions on success", async () => {
    const input = fixture();
    const expectFactors = vi.fn(async () => {});
    await verifyNativePinch(input.page, input.enterPhase, input.observeFailure, expectFactors);
    expect(input.cdp.send.mock.calls.map((call) => call[0])).toEqual([
      "Input.synthesizePinchGesture",
      "Page.getLayoutMetrics",
    ]);
    expect(expectFactors).toHaveBeenCalledExactlyOnceWith(100);
    expect(input.page.evaluate).toHaveBeenCalledTimes(2);
    expect(input.cdp.detach).toHaveBeenCalledOnce();
  });
});

describe("native Settings Cmd-wheel failure publication", () => {
  it("keeps injection and listener-cleanup errors and always releases the observation handle", async () => {
    const primary = new Error("synthetic wheel injection failure");
    const cleanup = new Error("synthetic listener cleanup failure");
    const native = {
      evaluate: vi.fn(async (_callback: unknown, delta?: number) => {
        if (typeof delta === "number") throw primary;
        return true;
      }),
    };
    const handle = {
      evaluate: vi.fn(async () => {
        throw cleanup;
      }),
      dispose: vi.fn(async () => {}),
    };
    const page = { evaluateHandle: vi.fn(async () => handle) };
    const observe = (operation: () => Promise<unknown>, overrides = {}) =>
      withNativeFailureObservation(
        null,
        () => ({ phase: "native-wheel-positive", ...overrides }),
        operation,
      );
    const error = await nativeCommandWheel(page, native, 120, observe).catch((error) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((item: Error) => item.cause)).toEqual([primary, cleanup]);
    expect(nativeFailureObservations(error).map((item) => item.phase)).toEqual([
      "native-wheel-positive",
      "cleanup-native-command-wheel-listener",
    ]);
    expect(handle.dispose).toHaveBeenCalledOnce();
  });
});

it("publishes a Cmd-wheel listener failure before pending handle disposal after successful input", async () => {
  const cleanup = new Error("synthetic listener cleanup failure");
  const handle = {
    evaluate: vi.fn().mockResolvedValueOnce({ direction: "in" }).mockRejectedValueOnce(cleanup),
    dispose: vi.fn(),
  };
  let release!: () => void;
  let markDisposing!: () => void;
  const disposing = new Promise<void>((resolve) => (markDisposing = resolve));
  handle.dispose.mockImplementation(async () => {
    markDisposing();
    await new Promise<void>((resolve) => (release = resolve));
  });
  const publish = vi.fn(async (_error: Error) => {});
  const observe = (operation: () => Promise<unknown>, overrides = {}) =>
    withNativeFailureObservation(
      null,
      () => ({ phase: "wheel-input", ...overrides }),
      operation,
      publish,
    );
  const finished = nativeCommandWheel(
    { evaluateHandle: async () => handle },
    { evaluate: async () => true },
    120,
    observe,
  ).catch((error) => error);
  await disposing;
  try {
    expect(publish).toHaveBeenCalledOnce();
    const captured = publish.mock.calls[0][0];
    expect(captured.cause).toBe(cleanup);
    expect(nativeFailureObservations(captured).map((item) => item.phase)).toEqual([
      "cleanup-native-command-wheel-listener",
    ]);
  } finally {
    release();
  }
  expect((await finished).cause).toBe(cleanup);
});
