import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

const execute = promisify(execFile);
// Mutter can report activation late; another input during this wait would undo the last one.
const settleMs = 5000;

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
      // The acceptance journey has at most two app windows. Input completion alone
      // never qualifies activation; retain attempted input even if the helper fails.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await focused()) break;
        const helper = fileURLToPath(
          new URL("../scripts/quality_wayland_input.py", import.meta.url),
        );
        observation.strategy = "headless GNOME compositor Alt+Escape input";
        observation.compositorInputAttempts++;
        await execute("/usr/bin/python3", [helper], { timeout: 10000, maxBuffer: 4096 });
        const sent = performance.now();
        let settled = false;
        try {
          await expect.poll(focused, { timeout: settleMs }).toBe(true);
          settled = true;
        } catch {
          // Polling stops before its deadline, so finish the wait before another input.
          for (
            let remaining = settleMs - (performance.now() - sent);
            remaining > 0;
            remaining = settleMs - (performance.now() - sent)
          )
            await delay(Math.ceil(remaining));
          try {
            await expect.poll(focused, { timeout: 250 }).toBe(true);
            settled = true;
          } catch {
            // Another window can receive the first cycle; the final guard is mandatory.
          }
        }
        (observation.inputs ??= []).push({
          elapsedMs: Math.round(performance.now() - sent),
          focused: settled,
        });
        if (settled) break;
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
