import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import { sendNativeHelpShortcut } from "../tooling/command-shortcut.mjs";

function fixture(platform: "linux" | "win32" | "darwin", mode = "deliver") {
  const contents = new EventEmitter() as EventEmitter & {
    focus(): void;
    sendInputEvent(value: { type: string; keyCode: string; modifiers: string[] }): void;
  };
  const sent: { type: string; keyCode: string; modifiers: string[] }[] = [];
  contents.focus = () => {};
  contents.sendInputEvent = (value) => {
    sent.push(value);
    if (mode === "throw") throw new Error("synthetic input refusal");
    if (mode === "missing" || value.type !== "keyDown") return;
    // This is a controlled adapter input, not Electron's native key conversion.
    contents.emit(
      "before-input-event",
      { defaultPrevented: mode !== "unhandled" },
      {
        type: "keyDown",
        key: platform === "darwin" ? "?" : "F1",
        code: platform === "darwin" ? "Slash" : "F1",
        control: false,
        alt: false,
        meta: platform === "darwin",
        shift: platform === "darwin",
        isComposing: false,
      },
    );
  };
  let focused = false;
  const window = {
    webContents: contents,
    focus: () => {
      focused = true;
    },
    isFocused: () => focused,
  };
  return {
    contents,
    sent,
    handle: {
      evaluate: async (
        callback: (value: typeof window, platform?: string) => unknown,
        argument?: string,
      ) => callback(window, argument),
    },
  };
}
describe("Electron Help shortcut acceptance adapter", () => {
  for (const platform of ["linux", "win32", "darwin"] as const)
    it(`uses browser-side key down/up with the declared ${platform} modifiers`, async () => {
      const value = fixture(platform);
      const result = await sendNativeHelpShortcut(value.handle, platform);
      const keyCode = platform === "darwin" ? "/" : "F1";
      const modifiers = platform === "darwin" ? ["meta", "shift"] : [];
      expect(value.sent).toEqual([
        { type: "keyDown", keyCode, modifiers },
        { type: "keyUp", keyCode, modifiers },
      ]);
      expect(result.source).toBe("Electron webContents.sendInputEvent");
      expect(result.input.prevented).toBe(true);
      expect(result.focus.focused).toBe(true);
      expect(value.contents.listenerCount("before-input-event")).toBe(0);
    });
  it("rejects an unhandled key and removes its observer", async () => {
    const value = fixture("linux", "unhandled");
    await expect(sendNativeHelpShortcut(value.handle, "linux")).rejects.toThrow("not intercepted");
    expect(value.contents.listenerCount("before-input-event")).toBe(0);
  });
  it("retains API refusal and removes its observer", async () => {
    const value = fixture("linux", "throw");
    await expect(sendNativeHelpShortcut(value.handle, "linux")).rejects.toThrow(
      "synthetic input refusal",
    );
    expect(value.contents.listenerCount("before-input-event")).toBe(0);
  });
  it("requires an actually observed main-process event", async () => {
    const value = fixture("linux", "missing");
    await expect(sendNativeHelpShortcut(value.handle, "linux")).rejects.toThrow("not observed");
    expect(value.contents.listenerCount("before-input-event")).toBe(0);
  }, 8000);
});
