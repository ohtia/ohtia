/* global clearTimeout */
import { focusNative, captureNativeFocus } from "./command-native-focus.mjs";

/** Exercise Electron's browser-side shortcut path; DevTools keyboard input skips it. */
export async function sendNativeHelpShortcut(nativeWindow, platform) {
  if (!["linux", "win32", "darwin"].includes(platform))
    throw new Error("Undeclared native shortcut platform.");
  const focus = await focusNative(nativeWindow, "Help shortcut");
  try {
    const input = await nativeWindow.evaluate((window, platform) => {
      const contents = window.webContents;
      const mac = platform === "darwin";
      const keyCode = mac ? "/" : "F1";
      const modifiers = mac ? ["meta", "shift"] : [];
      return new Promise((resolve, reject) => {
        let timer,
          observed,
          sent = false,
          finished = false;
        const finish = (error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          contents.removeListener("before-input-event", observe);
          if (error) reject(error);
          else resolve(observed);
        };
        const observe = (event, value) => {
          if (value.type !== "keyDown") return;
          observed = {
            key: value.key,
            code: value.code,
            control: value.control,
            meta: value.meta,
            alt: value.alt,
            shift: value.shift,
            composing: value.isComposing,
            prevented: event.defaultPrevented,
          };
          if (
            observed.key !== (mac ? "?" : "F1") ||
            observed.code !== (mac ? "Slash" : "F1") ||
            observed.control ||
            observed.alt ||
            observed.composing ||
            observed.meta !== mac ||
            observed.shift !== mac ||
            !observed.prevented
          )
            finish(
              new Error(`Electron Help shortcut was not intercepted: ${JSON.stringify(observed)}`),
            );
          else if (sent) finish();
        };
        try {
          contents.on("before-input-event", observe);
          timer = setTimeout(
            () => finish(new Error("Electron Help shortcut input was not observed.")),
            5000,
          );
          contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
          contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
          sent = true;
          if (observed) finish();
        } catch (error) {
          finish(error);
        }
      });
    }, platform);
    return { source: "Electron webContents.sendInputEvent", focus, input };
  } catch (error) {
    throw captureNativeFocus(error, focus);
  }
}
