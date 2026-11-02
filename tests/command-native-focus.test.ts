import { afterEach, describe, expect, it, vi } from "vitest";
const input = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string) => void;
    try {
      input.execute(...args.slice(0, -1));
      callback(null, "");
    } catch (error) {
      callback(error as Error, "");
    }
  },
}));
import {
  focusNative,
  nativeFocusFailure,
  NativeFocusError,
  captureNativeFocus,
  withCommandCleanup,
} from "../tooling/command-native-focus.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  input.execute.mockReset();
});
function fixture() {
  let focused = false;
  const window = {
    focus: vi.fn(),
    webContents: { focus: vi.fn() },
    isFocused: () => focused,
  };
  return {
    window,
    handle: { evaluate: async (callback: (value: typeof window) => unknown) => callback(window) },
    activate: () => {
      focused = true;
    },
  };
}
function ownedWayland() {
  vi.stubEnv("OHTIA_NATIVE_COMPOSITOR_PID", "42");
  vi.stubEnv("XDG_SESSION_TYPE", "wayland");
}
describe("actual focus gate with controlled native and input adapters", () => {
  it("preserves successful focus, initiating failure and later cleanup history together", async () => {
    const first = {
      target: "original",
      strategy: "native focus request",
      compositorInputAttempts: 0,
      focused: true,
    };
    const history = [first];
    const primary = new Error("synthetic command assertion");
    const cleanup = new Error("synthetic cleanup refusal");
    try {
      await withCommandCleanup(
        async () => {
          throw primary;
        },
        async () => {
          history.push({ ...first, target: "cleanup" });
          throw cleanup;
        },
        (error) => captureNativeFocus(error, first, history),
      );
      expect.unreachable("Both failures must remain failures.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map((value: Error) => value.message)).toEqual([
        primary.message,
        cleanup.message,
      ]);
      expect(nativeFocusFailure(error)?.history).toHaveLength(2);
      expect(nativeFocusFailure(error)?.focused).toBe(true);
      expect((error as Error).cause).toBe((error as AggregateError).errors[0]);
    }
  });
  it("retains cleanup-only errors and locates focus evidence in aggregate members", async () => {
    const cleanup = new Error("synthetic cleanup-only refusal");
    await expect(
      withCommandCleanup(
        async () => true,
        async () => {
          throw cleanup;
        },
      ),
    ).rejects.toBe(cleanup);
    const observation = {
      target: "peer",
      strategy: "native focus request",
      compositorInputAttempts: 0,
      focused: false,
    };
    expect(
      nativeFocusFailure(
        new AggregateError([new Error("unrelated"), new NativeFocusError(cleanup, observation)]),
      ),
    ).toEqual({ ...observation, history: [] });
  });

  it("retains failed target and history through phase wrappers without relying on message length", () => {
    const observation = {
      target: "peer",
      strategy: "native focus request",
      compositorInputAttempts: 0,
      focused: false,
    };
    const failure = new NativeFocusError(new Error("synthetic failure"), observation);
    failure.history = [{ target: "original", focused: true }];
    const wrapped = new Error("synthetic phase " + "x".repeat(2000), { cause: failure });
    expect(nativeFocusFailure(wrapped)).toEqual({ ...observation, history: failure.history });
    expect(nativeFocusFailure(new Error("unrelated"))).toBeUndefined();
  });
  it.runIf(process.platform === "linux")(
    "rejects after three completed inputs without actual focus and retains the attempts",
    async () => {
      ownedWayland();
      const target = fixture();
      try {
        await focusNative(target.handle, "peer");
        expect.unreachable("Input success must not qualify OS focus.");
      } catch (error) {
        expect(nativeFocusFailure(error)).toEqual({
          target: "peer",
          strategy: "headless GNOME compositor Alt+Escape input",
          compositorInputAttempts: 3,
          focused: false,
          history: [],
        });
      }
      expect(input.execute).toHaveBeenCalledTimes(3);
    },
    15000,
  );

  it("does not invoke compositor input for an X11 session with an inherited PID", async () => {
    ownedWayland();
    vi.stubEnv("XDG_SESSION_TYPE", "x11");
    const target = fixture();
    target.window.focus.mockImplementation(target.activate);
    expect(await focusNative(target.handle)).toEqual({
      target: "window",
      strategy: "native focus request",
      compositorInputAttempts: 0,
      focused: true,
    });
    expect(input.execute).not.toHaveBeenCalled();
  });

  it("uses the native request without compositor input when focus succeeds", async () => {
    vi.stubEnv("OHTIA_NATIVE_COMPOSITOR_PID", "");
    const target = fixture();
    target.window.focus.mockImplementation(target.activate);
    expect(await focusNative(target.handle)).toEqual({
      target: "window",
      strategy: "native focus request",
      compositorInputAttempts: 0,
      focused: true,
    });
    expect(target.window.webContents.focus).toHaveBeenCalledOnce();
    expect(input.execute).not.toHaveBeenCalled();
  });
  it.runIf(process.platform === "linux")(
    "requires actual focus after compositor input",
    async () => {
      ownedWayland();
      const target = fixture();
      input.execute.mockImplementation(target.activate);
      expect(await focusNative(target.handle)).toEqual({
        target: "window",
        strategy: "headless GNOME compositor Alt+Escape input",
        compositorInputAttempts: 1,
        focused: true,
      });
      expect(input.execute).toHaveBeenCalledWith(
        "/usr/bin/python3",
        [expect.stringMatching(/quality_wayland_input\.py$/)],
        { timeout: 10000, maxBuffer: 4096 },
      );
    },
  );
  it.runIf(process.platform === "linux")(
    "does not equate a successful cycle of another window with target focus",
    async () => {
      ownedWayland();
      const target = fixture();
      input.execute.mockImplementationOnce(() => {}).mockImplementationOnce(target.activate);
      await focusNative(target.handle);
      expect(input.execute).toHaveBeenCalledTimes(2);
    },
  );
  it.runIf(process.platform === "linux")(
    "propagates helper refusal without weakening the focus requirement",
    async () => {
      ownedWayland();
      const target = fixture();
      input.execute.mockImplementation(() => {
        throw new Error("synthetic compositor refusal");
      });
      await expect(focusNative(target.handle)).rejects.toThrow("synthetic compositor refusal");
      expect(target.window.isFocused()).toBe(false);
    },
  );
});
