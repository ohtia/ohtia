/* global clearTimeout, window */
import { focusNative, captureNativeFocus } from "./command-native-focus.mjs";
import { rendererCancelsCommandKeys } from "../packages/contracts/dist/index.js";

/**
 * Where main leaves an application key unconsumed, observe the trusted renderer keydown after the
 * application's window capture listener and require its cancellation. The caller disposes it.
 */
export async function observeRendererCommandKey(page, code) {
  return page.evaluateHandle((code) => {
    let timer;
    let observe;
    const dispose = () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", observe, true);
    };
    const promise = new Promise((resolve, reject) => {
      observe = (event) => {
        if (event.code !== code) return;
        dispose();
        const value = {
          key: event.key,
          code: event.code,
          trusted: event.isTrusted,
          prevented: event.defaultPrevented,
        };
        if (!value.trusted || !value.prevented)
          reject(
            new Error(`Renderer did not cancel the application key: ${JSON.stringify(value)}`),
          );
        else resolve(value);
      };
      window.addEventListener("keydown", observe, true);
      timer = setTimeout(() => {
        dispose();
        reject(new Error("Renderer application key was not observed."));
      }, 5000);
    });
    // Preserve the rejection for the consumer even if native injection itself fails.
    promise.catch(() => {});
    return { promise, dispose };
  }, code);
}
/** Release a renderer observation without awaiting its result; the handle is always released. */
export async function releaseRendererCommandKey(observation) {
  try {
    await observation.evaluate((value) => value.dispose());
  } finally {
    await observation.dispose();
  }
}
/** Await a renderer observation and release it; a cleanup failure never replaces the outcome. */
export async function settleRendererCommandKey(observation) {
  let result;
  try {
    result = await observation.evaluate((value) => value.promise);
  } catch (error) {
    await releaseRendererCommandKey(observation).catch(() => {});
    throw error;
  }
  await releaseRendererCommandKey(observation).catch(() => {});
  return result;
}

/** Exercise Electron's browser-side shortcut path; DevTools keyboard input skips it. */
export async function sendNativeHelpShortcut(nativeWindow, platform, page) {
  if (!["linux", "win32", "darwin"].includes(platform))
    throw new Error("Undeclared native shortcut platform.");
  const rendererCancels = rendererCancelsCommandKeys(platform);
  const focus = await focusNative(nativeWindow, "Help shortcut");
  let renderer;
  try {
    if (rendererCancels)
      renderer = await observeRendererCommandKey(page, platform === "darwin" ? "Slash" : "F1");
    const input = await nativeWindow.evaluate(
      (window, { platform, rendererCancels }) => {
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
              // Main consumes the key unless the renderer cancels it on this platform.
              observed.prevented === rendererCancels
            )
              finish(
                new Error(
                  `Electron Help shortcut was not intercepted: ${JSON.stringify(observed)}`,
                ),
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
      },
      { platform, rendererCancels },
    );
    const observation = renderer;
    renderer = undefined;
    return {
      source: "Electron webContents.sendInputEvent",
      focus,
      input,
      ...(observation ? { renderer: await settleRendererCommandKey(observation) } : {}),
    };
  } catch (error) {
    if (renderer) await releaseRendererCommandKey(renderer).catch(() => {});
    throw captureNativeFocus(error, focus);
  }
}
