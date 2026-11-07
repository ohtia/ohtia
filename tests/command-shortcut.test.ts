import { EventEmitter } from "node:events";
import { afterEach, describe, it, expect, vi } from "vitest";
import { sendNativeHelpShortcut } from "../tooling/command-shortcut.mjs";

type Mode = "deliver" | "unhandled" | "consumed" | "uncancelled" | "throw" | "missing";
afterEach(() => {
  vi.unstubAllGlobals();
});
function fixture(platform: "linux" | "win32" | "darwin", mode: Mode = "deliver") {
  const linux = platform === "linux";
  const contents = new EventEmitter() as EventEmitter & {
    focus(): void;
    sendInputEvent(value: { type: string; keyCode: string; modifiers: string[] }): void;
  };
  // A controlled renderer window: only the observer's capture listener is modelled.
  const listeners = new Set<(event: unknown) => void>();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: unknown) => void, capture: boolean) => {
      if (type === "keydown" && capture) listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: unknown) => void) => {
      listeners.delete(listener);
    },
  });
  const sent: { type: string; keyCode: string; modifiers: string[] }[] = [];
  contents.focus = () => {};
  contents.sendInputEvent = (value) => {
    sent.push(value);
    if (mode === "throw") throw new Error("synthetic input refusal");
    if (mode === "missing" || value.type !== "keyDown") return;
    const key = platform === "darwin" ? "?" : "F1";
    const code = platform === "darwin" ? "Slash" : "F1";
    // This is a controlled adapter input, not Electron's native key conversion.
    contents.emit(
      "before-input-event",
      { defaultPrevented: mode === "consumed" || (!linux && mode !== "unhandled") },
      {
        type: "keyDown",
        key,
        code,
        control: false,
        alt: false,
        meta: platform === "darwin",
        shift: platform === "darwin",
        isComposing: false,
      },
    );
    for (const listener of [...listeners])
      listener({ key, code, isTrusted: true, defaultPrevented: mode !== "uncancelled" });
  };
  let focused = false;
  const window = {
    webContents: contents,
    focus: () => {
      focused = true;
    },
    isFocused: () => focused,
  };
  const state = {
    contents,
    sent,
    listeners,
    handle: {
      evaluate: async (
        callback: (value: typeof window, argument?: unknown) => unknown,
        argument?: unknown,
      ) => callback(window, argument),
    },
    released: { handles: 0 },
    page: {
      failRelease: false,
      evaluateHandle: async (callback: (argument: string) => unknown, argument: string) => {
        const value = callback(argument);
        return {
          evaluate: async (read: (value: unknown) => unknown) => {
            // A navigated page cannot run the observer's own cleanup.
            if (state.page.failRelease && read.toString().includes("dispose"))
              throw new Error("synthetic page navigation");
            return read(value);
          },
          dispose: async () => {
            state.released.handles++;
          },
        };
      },
    },
  };
  return state;
}
describe("Electron Help shortcut acceptance adapter", () => {
  for (const platform of ["linux", "win32", "darwin"] as const)
    it(`uses browser-side key down/up with the declared ${platform} modifiers`, async () => {
      const value = fixture(platform);
      const result = await sendNativeHelpShortcut(value.handle, platform, value.page);
      const keyCode = platform === "darwin" ? "/" : "F1";
      const modifiers = platform === "darwin" ? ["meta", "shift"] : [];
      expect(value.sent).toEqual([
        { type: "keyDown", keyCode, modifiers },
        { type: "keyUp", keyCode, modifiers },
      ]);
      expect(result.source).toBe("Electron webContents.sendInputEvent");
      // Linux main leaves the key to the renderer, which must cancel it (issue 181).
      expect(result.input.prevented).toBe(platform !== "linux");
      expect(result.renderer).toEqual(
        platform === "linux"
          ? { key: "F1", code: "F1", trusted: true, prevented: true }
          : undefined,
      );
      expect(result.focus.focused).toBe(true);
      expect(value.contents.listenerCount("before-input-event")).toBe(0);
      expect(value.listeners.size).toBe(0);
    });
  it("keeps the renderer outcome and releases its handle when page cleanup fails", async () => {
    const value = fixture("linux");
    value.page.failRelease = true;
    const result = await sendNativeHelpShortcut(value.handle, "linux", value.page);
    expect(result.renderer).toEqual({ key: "F1", code: "F1", trusted: true, prevented: true });
    expect(value.released.handles).toBe(1);
    const rejected = fixture("linux", "uncancelled");
    rejected.page.failRelease = true;
    await expect(sendNativeHelpShortcut(rejected.handle, "linux", rejected.page)).rejects.toThrow(
      "did not cancel",
    );
    expect(rejected.released.handles).toBe(1);
  });
  it("rejects an unhandled key and removes its observer", async () => {
    const value = fixture("win32", "unhandled");
    await expect(sendNativeHelpShortcut(value.handle, "win32", value.page)).rejects.toThrow(
      "not intercepted",
    );
    expect(value.contents.listenerCount("before-input-event")).toBe(0);
  });
  it("rejects a Linux key consumed in main or left uncancelled by the renderer", async () => {
    for (const [mode, message] of [
      ["consumed", "not intercepted"],
      ["uncancelled", "did not cancel"],
    ] as const) {
      const value = fixture("linux", mode);
      await expect(sendNativeHelpShortcut(value.handle, "linux", value.page)).rejects.toThrow(
        message,
      );
      expect(value.contents.listenerCount("before-input-event")).toBe(0);
      expect(value.listeners.size).toBe(0);
    }
  });
  it("retains API refusal and removes its observer", async () => {
    const value = fixture("linux", "throw");
    await expect(sendNativeHelpShortcut(value.handle, "linux", value.page)).rejects.toThrow(
      "synthetic input refusal",
    );
    expect(value.contents.listenerCount("before-input-event")).toBe(0);
    expect(value.listeners.size).toBe(0);
  });
  it("requires an actually observed main-process event", async () => {
    const value = fixture("linux", "missing");
    await expect(sendNativeHelpShortcut(value.handle, "linux", value.page)).rejects.toThrow(
      "not observed",
    );
    expect(value.contents.listenerCount("before-input-event")).toBe(0);
    expect(value.listeners.size).toBe(0);
  }, 8000);
});
