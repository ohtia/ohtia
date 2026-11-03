import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Read a ps result for one PID: its name, or nothing for a process that is gone, which is status 1
 * with no output or diagnostic. Anything else leaves the holder unknown, and assuming it has ended
 * could replace the runtime under an open window.
 */
export function holderName(result, pid) {
  const name = result.stdout?.trim();
  if (result.status === 0 && name) return path.basename(name).toLowerCase();
  if (result.status === 1 && !name && !result.stderr?.trim()) return "";
  const cause = result.stderr?.trim() || result.signal || result.error?.message || result.status;
  throw new Error(
    `ps cannot identify the process holding this checkout's lock (PID ${pid}): ${cause}.`,
  );
}

function processName(pid) {
  return holderName(spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }), pid);
}

/**
 * Whether Electron's single-instance lock is held for a development root. The lock lasts as long
 * as the broker, however it was started, and needs no build output. Windows deletes the file when
 * its holder ends; POSIX leaves a link naming a PID after a crash, and that PID can be reused.
 */
export function developmentInstanceRunning(directory, nameOf = processName) {
  const profile = path.join(directory, "configuration", "Ohtia");
  if (process.platform === "win32") return fs.existsSync(path.join(profile, "lockfile"));
  let holder;
  try {
    holder = fs.readlinkSync(path.join(profile, "SingletonLock"));
  } catch {
    return false;
  }
  const pid = Number(/-(\d+)$/.exec(holder)?.[1]);
  return Boolean(pid) && nameOf(pid) === "electron";
}
