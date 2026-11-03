import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  admitDevelopmentInstance,
  containsPath,
  loadRuntimeProfile,
  nativeProfileHost,
  verifyStableSentinels,
} from "../packages/main/dist/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
/** Check the prepared runtime's recorded bytes and resolve its native paths. */
export function verifyPrepared(preparedDirectory, expectedTarget) {
  const prepared = JSON.parse(
    fs.readFileSync(path.join(preparedDirectory, "prepared.json"), "utf8"),
  );
  if (
    prepared.version !== 1 ||
    prepared.target !== `${process.platform}-${process.arch}` ||
    prepared.target !== expectedTarget
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
  if (process.platform === "win32" && !/^[A-Za-z]:$/.test(process.env.SystemDrive ?? ""))
    throw new Error("Native Windows system-drive identity is unavailable.");
  const targets = JSON.parse(
    fs.readFileSync(path.join(root, "config/desktop/targets.json"), "utf8"),
  );
  const target = targets.targets.find((item) => item.id === prepared.target);
  if (!target) throw new Error("Undeclared native target.");
  return {
    executable: path.join(preparedDirectory, prepared.executable),
    app: path.join(preparedDirectory, prepared.app),
    args: target.runtime_arguments ?? [],
  };
}

/** Inherit only native session identity; no provider, runtime-injection or update environment. */
export function nativeEnvironment({ home, username, configurationRoot, scratch }) {
  const env = {
    HOME: home,
    USER: username,
    LOGNAME: username,
    USERPROFILE: home,
    TMPDIR: scratch,
    TEMP: scratch,
    TMP: scratch,
    ...(process.platform === "win32"
      ? {
          APPDATA: configurationRoot,
          LOCALAPPDATA: path.join(home, "AppData", "Local"),
          SystemRoot: process.env.SystemRoot,
          SystemDrive: process.env.SystemDrive,
          WINDIR: process.env.WINDIR,
        }
      : {}),
  };
  for (const key of [
    "DISPLAY",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "DBUS_SESSION_BUS_ADDRESS",
    "LANG",
    "LC_ALL",
    "LANGUAGE",
    "LC_MESSAGES",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}

/** Shared by the qualification launch and native acceptance entries, before Electron is spawned. */
export function admittedLaunch(profileFile, preparedDirectory) {
  const profile = loadRuntimeProfile(profileFile);
  verifyStableSentinels(profile);
  const runtime = verifyPrepared(preparedDirectory, profile.target);
  return {
    profile,
    env: {
      ...nativeEnvironment({
        home: profile.home,
        username: profile.username,
        configurationRoot: profile.configuration_root,
        scratch: profile.scratch_root,
      }),
      OHTIA_RUNTIME_PROFILE: profileFile,
    },
    ...runtime,
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

/** Keep the temporary root short: the singleton socket path below it has a low OS limit. */
export function shortTemporaryDirectory(prefix) {
  const parent = process.platform === "win32" ? os.tmpdir() : "/tmp";
  return fs.realpathSync.native(fs.mkdtempSync(path.join(parent, prefix)));
}

/** Refuse before writing anything: the location, an alias and native overlap are checked first. */
export function developmentRootLocation(checkout = root, host = nativeProfileHost()) {
  const directory = path.join(fs.realpathSync.native(checkout), ".ohtia-dev");
  for (const native of [host.researchRoot, path.join(host.configurationRoot, "Ohtia")])
    if (containsPath(native, directory) || containsPath(directory, native))
      throw new Error(
        `Development root refused: it overlaps ${native}; move the checkout outside it.`,
      );
  for (const entry of [directory, path.join(directory, "runtime")])
    if (fs.lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`Development root refused: ${entry} is an alias.`);
  return directory;
}

/** Create the checkout's persistent development layout; the runtime directory is replaced apart. */
export function prepareDevelopmentRoot(checkout = root) {
  const directory = developmentRootLocation(checkout);
  fs.mkdirSync(path.join(directory, "configuration"), { recursive: true, mode: 0o700 });
  const instance = path.join(directory, "instance.json");
  try {
    // An exclusive write never follows a link that an existing entry may be.
    fs.writeFileSync(instance, JSON.stringify({ version: 1 }) + "\n", { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const host = nativeProfileHost();
  admitDevelopmentInstance(directory, path.join(host.configurationRoot, "Ohtia"), host);
  return directory;
}

/** Admit a development root and describe its launch without starting a process. */
export function developmentLaunch(directory, preparedDirectory, scratch) {
  const host = nativeProfileHost();
  admitDevelopmentInstance(directory, path.join(host.configurationRoot, "Ohtia"), host);
  return {
    env: {
      ...nativeEnvironment({
        home: host.home,
        username: host.username,
        configurationRoot: host.configurationRoot,
        scratch,
      }),
      ...(process.env.KDE_SESSION_VERSION
        ? { KDE_SESSION_VERSION: process.env.KDE_SESSION_VERSION }
        : {}),
      OHTIA_DEVELOPMENT_ROOT: directory,
    },
    ...verifyPrepared(preparedDirectory, host.target),
  };
}

/**
 * Wait for the desktop while keeping the launcher alive, so its cleanup runs. On POSIX the desktop
 * has its own process group, so it receives one forwarded signal: Electron's graceful shutdown
 * takes only the first. Windows has no such signal, and Node would end the broker abruptly, so the
 * window stays open until it is closed. Any other end, including a crash signal, is a failure.
 */
export async function waitForDesktop(child, directory, platform = process.platform) {
  let interrupted = false;
  const windows = platform === "win32";
  const forwarders = (windows ? ["SIGINT"] : ["SIGINT", "SIGTERM", "SIGHUP"]).map((name) => {
    const forward = () => {
      if (windows) console.log("Close the application window to stop it.");
      else if (!interrupted) child.kill(name);
      interrupted = !windows;
    };
    process.on(name, forward);
    return [name, forward];
  });
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (!interrupted && code !== 0)
      throw new Error(
        `Desktop exited with ${signal ?? `code ${code}`}. Diagnostics are under ${path.join(directory, "research")}. On Ubuntu, a sandbox failure needs: python3 scripts/linux_contributor.py sandbox-policy --development.`,
      );
  } finally {
    for (const [name, forward] of forwarders) process.off(name, forward);
  }
}

export async function launchDevelopment(directory, preparedDirectory) {
  const scratch = shortTemporaryDirectory("ohtia-dev-");
  try {
    const launch = developmentLaunch(directory, preparedDirectory, scratch);
    const child = spawn(launch.executable, [launch.app, ...launch.args], {
      env: launch.env,
      cwd: scratch,
      detached: process.platform !== "win32",
      stdio: ["ignore", "inherit", "inherit"],
    });
    await waitForDesktop(child, directory);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
