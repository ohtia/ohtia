import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nativeFailureObservations,
  recordNativeFailure,
  observeNativeFailure,
  withNativeFailureObservation,
} from "../tooling/native-failure-observation.mjs";
import { withCommandCleanup } from "../tooling/command-native-focus.mjs";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  const privateValue = "PRIVATE_DRAFT_PASSWORD_FILENAME";
  const privateRead = vi.fn(() => {
    throw new Error(privateValue);
  });
  const element = {
    tagName: "BUTTON",
    disabled: false,
    isConnected: true,
    closest: () => null,
    getAttribute: () => "false",
    getBoundingClientRect: () => ({ x: 831, y: 45, width: 32, height: 32 }),
    get value() {
      return privateRead();
    },
    get textContent() {
      return privateRead();
    },
  };
  vi.stubGlobal("document", {
    visibilityState: "visible",
    hidden: false,
    hasFocus: () => true,
    documentElement: { lang: "ko-KR" },
    activeElement: element,
    querySelector: () => element,
    get body() {
      return privateRead();
    },
  });
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 752,
    devicePixelRatio: 1,
    performance: { now: () => Date.now() },
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  });
  const native = {
    id: 7,
    webContents: { id: 9, isFocused: () => true, getBackgroundThrottling: () => true },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 752 }),
    getContentBounds: () => ({ x: 0, y: 0, width: 1280, height: 752 }),
    isVisible: () => true,
    isFocused: () => true,
    isMinimized: () => false,
    getTitle: privateRead,
  };
  const handle = {
    evaluate: vi.fn(async (callback: (value: typeof native) => unknown) => callback(native)),
    dispose: vi.fn(async () => {}),
  };
  const page = {
    evaluate: vi.fn(async (callback: (argument: unknown) => unknown, argument: unknown) =>
      callback(argument),
    ),
  };
  const application = { windows: () => [page], browserWindow: vi.fn(async () => handle) };
  return { application, handle, page, privateRead, privateValue };
}

describe("bounded native failure observations", () => {
  it("records absent frame callbacks separately from visible, enabled controls without private content", async () => {
    vi.useFakeTimers();
    const input = fixture();
    const pending = observeNativeFailure(input.application, {
      phase: "second-window-about-close",
      selector: ".about-dialog[open] [data-close]",
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.capture_status).toBe("complete");
    expect(result.windows[0]).toMatchObject({
      native: { window_id: 7, web_contents_id: 9, focused: true, visible: true },
      renderer: {
        visibility: "visible",
        focused: true,
        target: { disabled: false, rect: { x: 831, y: 45, width: 32, height: 32 } },
        frames: { count: 0 },
      },
    });
    expect(input.privateRead).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(input.privateValue);
    expect(input.handle.dispose).toHaveBeenCalledOnce();
  });

  it("bounds a stalled observation and keeps the returned snapshot fixed when the peer later responds", async () => {
    vi.useFakeTimers();
    const input = fixture();
    let resume!: () => void;
    input.handle.evaluate.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resume = resolve)),
    );
    const pending = observeNativeFailure(input.application, { phase: "stalled-window" });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.capture_status).toBe("timed-out");
    const frozen = JSON.stringify(result);
    resume();
    await vi.runAllTimersAsync();
    expect(JSON.stringify(result)).toBe(frozen);
    expect(input.handle.dispose).toHaveBeenCalledOnce();
  });

  it("retains successful observations when handle disposal fails and excludes diagnostic error messages", async () => {
    vi.useFakeTimers();
    const input = fixture();
    input.handle.dispose.mockRejectedValueOnce(new Error(input.privateValue));
    const pending = observeNativeFailure(input.application, { phase: "cleanup" });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.capture_status).toBe("partial");
    expect(result.windows[0]).toMatchObject({ status: "observed", disposal_error_type: "Error" });
    expect(JSON.stringify(result)).not.toContain(input.privateValue);
  });

  it("retains the initiating error and its phase before cleanup records its own failure", async () => {
    const primary = new Error("synthetic interaction refusal");
    const cleanup = new Error("synthetic cleanup refusal");
    let phase = "interaction";
    try {
      await withCommandCleanup(
        () =>
          withNativeFailureObservation(
            null,
            () => ({ phase }),
            async () => {
              throw primary;
            },
          ),
        () =>
          withNativeFailureObservation(
            null,
            () => ({ phase }),
            async () => {
              phase = "cleanup";
              throw cleanup;
            },
          ),
      );
      expect.unreachable("Both failures must remain failures.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(nativeFailureObservations(error).map((value) => value.phase)).toEqual([
        "interaction",
        "cleanup",
      ]);
      const failures = (error as AggregateError).errors;
      expect(failures[0].cause).toBe(primary);
      expect(failures[1].cause).toBe(cleanup);
    }
  });

  it("keeps the original failure when observation metadata itself fails", async () => {
    const primary = new Error("synthetic original failure");
    try {
      await withNativeFailureObservation(
        null,
        () => {
          throw new Error("PRIVATE_METADATA_CONTENT");
        },
        async () => {
          throw primary;
        },
      );
      expect.unreachable("The original operation must remain a failure.");
    } catch (error) {
      expect((error as Error).cause).toBe(primary);
      expect(nativeFailureObservations(error)).toEqual([
        {
          version: 1,
          capture_status: "unavailable",
          reason: "observation-metadata-unavailable",
          error_type: "Error",
        },
      ]);
    }
  });

  it("keeps the closest failure observation when an outer phase also catches it", async () => {
    const primary = new Error("synthetic original failure");
    const outerMetadata = vi.fn(() => ({ phase: "after-cleanup" }));
    try {
      await withNativeFailureObservation(null, outerMetadata, () =>
        withNativeFailureObservation(
          null,
          () => ({ phase: "interaction" }),
          async () => {
            throw primary;
          },
        ),
      );
      expect.unreachable("The operation must remain a failure.");
    } catch (error) {
      expect((error as Error).cause).toBe(primary);
      expect(nativeFailureObservations(error).map((value) => value.phase)).toEqual(["interaction"]);
      expect(outerMetadata).not.toHaveBeenCalled();
    }
  });

  it("durably retains a completed capture while application shutdown remains pending", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-failure-receipt-"));
    let finish!: () => void;
    let cleanupStarted!: () => void;
    const started = new Promise<void>((resolve) => (cleanupStarted = resolve));
    const receipt = { cases: [{ id: "synthetic-completed-case", result: "pass" }] };
    const primary = new Error("synthetic initiating failure");
    const file = path.join(root, "receipt.json");
    const pending = withCommandCleanup(
      () =>
        recordNativeFailure(receipt, primary, null, { phase: "interaction" }, () => {
          fs.writeFileSync(file, JSON.stringify(receipt));
        }),
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          cleanupStarted();
        }),
    );
    try {
      await started;
      expect(JSON.parse(fs.readFileSync(file, "utf8")).cases.at(-1)).toMatchObject({
        result: "fail",
        error: String(primary),
        phase: "interaction",
        last_completed_case: "synthetic-completed-case",
        native_observations: [{ capture_status: "unavailable", phase: "interaction" }],
      });
    } finally {
      finish();
      await pending;
      fs.rmSync(root, { recursive: true });
    }
  });

  it("persists the closest retained observation without querying a changed cleanup context", async () => {
    let failure;
    try {
      await withNativeFailureObservation(
        null,
        () => ({ phase: "original-interaction" }),
        async () => {
          throw new Error("synthetic interaction");
        },
      );
    } catch (error) {
      failure = error;
    }
    const windows = vi.fn(() => {
      throw new Error("Must not inspect the later cleanup context");
    });
    const receipt = { cases: [] };
    const persist = vi.fn();
    const result = await recordNativeFailure(
      receipt,
      failure,
      { windows },
      { phase: "later-cleanup" },
      persist,
    );
    expect(result.native_observations.map((item) => item.phase)).toEqual(["original-interaction"]);
    expect(result.last_completed_case).toBeNull();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(windows).not.toHaveBeenCalled();
  });

  it("preserves a non-Error initiating value as the original cause and message", async () => {
    await expect(
      withNativeFailureObservation(
        null,
        () => ({ phase: "interaction" }),
        async () => {
          throw "synthetic thrown value";
        },
      ),
    ).rejects.toMatchObject({ message: "synthetic thrown value", cause: "synthetic thrown value" });
  });

  it("keeps the initiating error when publishing its observation also fails", async () => {
    const primary = new Error("synthetic initiating failure");
    const publication = new Error("synthetic publication failure");
    const error = await withNativeFailureObservation(
      null,
      () => ({ phase: "interaction" }),
      async () => {
        throw primary;
      },
      async () => {
        throw publication;
      },
    ).catch((error) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0].cause).toBe(primary);
    expect(error.errors[1]).toBe(publication);
    expect(nativeFailureObservations(error).map((item) => item.phase)).toEqual(["interaction"]);
  });

  it("keeps the initiating cause when receipt publication is unavailable", async () => {
    const primary = new Error("synthetic initiating failure");
    const publication = new Error("synthetic receipt failure");
    const error = await recordNativeFailure(
      { cases: [] },
      primary,
      null,
      { phase: "interaction" },
      () => {
        throw publication;
      },
    ).catch((error) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(primary);
    expect(error.errors).toEqual([primary, publication]);
  });

  it("does not observe successful operations and handles errors without native context", async () => {
    const metadata = vi.fn();
    await expect(withNativeFailureObservation(null, metadata, async () => 42)).resolves.toBe(42);
    expect(metadata).not.toHaveBeenCalled();
    const error = new Error("synthetic unrelated failure");
    error.cause = error;
    expect(nativeFailureObservations(error)).toEqual([]);
    expect((await observeNativeFailure({ windows: () => [] }, { phase: "startup" })).reason).toBe(
      "no-renderer-pages",
    );
  });
});
