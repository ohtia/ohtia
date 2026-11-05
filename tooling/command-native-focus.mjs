import { execFile } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

const execute = promisify(execFile);

class NativeFocusContextError extends Error {
  constructor(cause, observation, history = []) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.observation = observation;
    this.history = history;
  }
}

export class NativeFocusError extends NativeFocusContextError {
  constructor(cause, observation) {
    super(cause, observation);
    this.message = `Native focus failed: ${JSON.stringify(observation)}; ${this.message}`;
  }
}

/** Keep structured focus evidence through phase wrappers and simultaneous cleanup errors. */
export function nativeFocusFailure(error) {
  const pending = [error],
    visited = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (!(current instanceof Error) || visited.has(current)) continue;
    if (current instanceof NativeFocusContextError)
      return { ...current.observation, history: current.history };
    visited.add(current);
    if (current instanceof AggregateError) pending.unshift(...current.errors);
    if (current.cause) pending.unshift(current.cause);
  }
  return undefined;
}

/** Retain successful focus when a subsequent command assertion fails. */
export function captureNativeFocus(error, observation, history = []) {
  if (!observation || nativeFocusFailure(error)) return error;
  return new NativeFocusContextError(error, observation, history);
}

/** Preserve the initiating error if cleanup also fails, while always attempting cleanup. */
export async function withCommandCleanup(operation, cleanup, capture = (error) => error) {
  let primary,
    failed = false;
  try {
    return await operation();
  } catch (error) {
    failed = true;
    primary = capture(error);
    throw primary;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      const secondary = capture(error);
      if (failed)
        throw new AggregateError(
          [primary, secondary],
          `${String(primary?.message ?? primary)}; cleanup failed: ${String(secondary?.message ?? secondary)}`,
          { cause: primary },
        );
      throw secondary;
    }
  }
}

/** Require real OS focus; owned headless Wayland sessions use compositor keyboard input. */
export async function focusNative(nativeWindow, target = "window") {
  const observation = {
    target,
    strategy: "native focus request",
    compositorInputAttempts: 0,
    focused: false,
  };
  const focused = async () => {
    observation.focused = await nativeWindow.evaluate((window) => window.isFocused());
    return observation.focused;
  };
  try {
    await nativeWindow.evaluate((window) => {
      window.focus();
      window.webContents.focus();
    });
    if (
      process.platform === "linux" &&
      /^[1-9][0-9]*$/.test(process.env.OHTIA_NATIVE_COMPOSITOR_PID ?? "") &&
      process.env.XDG_SESSION_TYPE === "wayland"
    ) {
      // Plasma activates the application's window through a KWin script; GNOME cycles
      // windows through compositor keyboard input.
      const kde = process.env.XDG_CURRENT_DESKTOP === "KDE";
      const helper = fileURLToPath(
        new URL(
          kde ? "../scripts/quality_kwin_focus.py" : "../scripts/quality_wayland_input.py",
          import.meta.url,
        ),
      );
      const helperArguments = kde
        ? [helper, String(await nativeWindow.evaluate(() => process.pid))]
        : [helper];
      // The acceptance journey has at most two app windows. Input completion alone
      // never qualifies activation; retain attempted input even if the helper fails.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await focused()) break;
        observation.strategy = kde
          ? "headless KWin script activation"
          : "headless GNOME compositor Alt+Escape input";
        observation.compositorInputAttempts++;
        await execute("/usr/bin/python3", helperArguments, { timeout: 10000, maxBuffer: 4096 });
        try {
          await expect.poll(focused, { timeout: 1000 }).toBe(true);
          break;
        } catch {
          // Another window can receive the first cycle; the final guard is mandatory.
        }
      }
    }
    await expect
      .poll(focused, { message: "Native command target must have actual OS window focus." })
      .toBe(true);
    return observation;
  } catch (error) {
    throw new NativeFocusError(error, observation);
  }
}
