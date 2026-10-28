import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadRuntimeProfile, verifyStableSentinels } from "../packages/main/dist/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
/** Shared by the dev and native acceptance entry, before Electron is spawned. */
export function admittedLaunch(profileFile, preparedDirectory) {
  const profile = loadRuntimeProfile(profileFile);
  verifyStableSentinels(profile);
  const prepared = JSON.parse(
    fs.readFileSync(path.join(preparedDirectory, "prepared.json"), "utf8"),
  );
  if (
    prepared.version !== 1 ||
    prepared.target !== `${process.platform}-${process.arch}` ||
    prepared.target !== profile.target
  )
    throw new Error("Use an assembled runtime for this native target.");
  for (const [name, expected] of Object.entries(prepared.files)) {
    const file = path.resolve(preparedDirectory, name);
    if (
      !file.startsWith(path.resolve(preparedDirectory) + path.sep) ||
      fs.realpathSync.native(file) !== file ||
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expected
    )
      throw new Error("Native runtime bytes changed. Rebuild and assemble a fresh attempt.");
  }
  for (const [name, expected] of Object.entries(prepared.links)) {
    const file = path.resolve(preparedDirectory, name);
    if (
      !file.startsWith(path.resolve(preparedDirectory) + path.sep) ||
      fs.readlinkSync(file) !== expected ||
      !fs.realpathSync.native(file).startsWith(path.resolve(preparedDirectory) + path.sep)
    )
      throw new Error("Native framework links changed.");
  }
  const home = profile.home;
  const env = {
    HOME: home,
    USER: profile.username,
    LOGNAME: profile.username,
    USERPROFILE: home,
    OHTIA_RUNTIME_PROFILE: profileFile,
    TMPDIR: profile.scratch_root,
    TEMP: profile.scratch_root,
    TMP: profile.scratch_root,
    ...(process.platform === "win32"
      ? {
          APPDATA: profile.configuration_root,
          LOCALAPPDATA: path.join(home, "AppData", "Local"),
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
        }
      : {}),
  };
  // Only native session identity is inherited; no provider, runtime-injection or update environment.
  for (const key of [
    "DISPLAY",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "DBUS_SESSION_BUS_ADDRESS",
    "LANG",
    "LC_ALL",
    "LANGUAGE",
    "LC_MESSAGES",
  ])
    if (process.env[key]) env[key] = process.env[key];
  const targets = JSON.parse(
    fs.readFileSync(path.join(root, "config/desktop/targets.json"), "utf8"),
  );
  const target = targets.targets.find((item) => item.id === prepared.target);
  if (!target) throw new Error("Undeclared native target.");
  return {
    profile,
    env,
    executable: path.join(preparedDirectory, prepared.executable),
    app: path.join(preparedDirectory, prepared.app),
    args: target.runtime_arguments ?? [],
  };
}
export async function launchDesktop(profileFile, preparedDirectory) {
  const launch = admittedLaunch(profileFile, preparedDirectory);
  const child = spawn(launch.executable, [launch.app, ...launch.args], {
    env: launch.env,
    cwd: launch.profile.scratch_root,
    stdio: "ignore",
  });
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  verifyStableSentinels(launch.profile);
  if (exit !== 0)
    throw new Error(
      "Desktop exited unsuccessfully. Preserve the isolated attempt and inspect native startup evidence.",
    );
}
