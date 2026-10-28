import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  admitRuntimeProfile,
  portLimits,
  type RuntimeProfile,
  type ProfileHost,
} from "@ohtia/contracts";

export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}
export function nativeProfileHost(): ProfileHost {
  const user = os.userInfo();
  const home = fs.realpathSync.native(user.homedir);
  const configurationRoot = path.join(
    home,
    ...(process.platform === "win32"
      ? ["AppData", "Roaming"]
      : process.platform === "darwin"
        ? ["Library", "Application Support"]
        : [".config"]),
  );
  return {
    username: user.username,
    home,
    configurationRoot,
    researchRoot: path.join(home, "ohtia"),
    target: `${process.platform}-${process.arch}`,
    canonical: (value) => {
      if (!path.isAbsolute(value)) throw new Error("Absolute native roots required.");
      return fs.realpathSync.native(value);
    },
    contains: containsPath,
    owned: (value) => process.platform === "win32" || fs.statSync(value).uid === user.uid,
  };
}
export function readBoundedFile(file: string, maximum = portLimits.locator_bytes): Buffer {
  const initial = fs.lstatSync(file, { bigint: true });
  if (!initial.isFile() || initial.nlink !== 1n)
    throw new Error("A single-link regular file is required.");
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY |
      (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
  );
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.dev !== initial.dev || stat.ino !== initial.ino)
      throw new Error("Invalid bounded file identity.");
    if (stat.size > BigInt(maximum)) throw new RangeError("Bounded file exceeds its limit.");
    const bytes = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count <= maximum) {
      const read = fs.readSync(descriptor, bytes, count, maximum + 1 - count, null);
      if (read === 0) break;
      count += read;
    }
    if (count > maximum) throw new RangeError("Bounded file exceeds its limit.");
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(descriptor);
  }
}
/** Admission precedes any sentinel, locator or Electron execution. */
export function loadRuntimeProfile(file: string): RuntimeProfile {
  try {
    const host = nativeProfileHost();
    if (
      !path.isAbsolute(file) ||
      path.basename(file) !== "runtime-profile.json" ||
      !containsPath(host.home, file) ||
      fs.realpathSync.native(file) !== file ||
      fs.lstatSync(file).nlink !== 1
    )
      throw new Error("Invalid profile location.");
    const bytes = readBoundedFile(file);
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return admitRuntimeProfile(input, host);
  } catch {
    throw new Error(
      "Isolation admission refused. Use runtime-profile.json from the inspected native account and setup procedure.",
    );
  }
}
export function verifyStableSentinels(profile: RuntimeProfile): void {
  for (const stable of Object.values(profile.stable_roots)) {
    const file = path.join(stable.root, stable.sentinel_filename ?? ".ohtia-runtime-sentinel");
    if (
      fs.realpathSync.native(file) !== file ||
      createHash("sha256").update(readBoundedFile(file)).digest("hex") !== stable.sentinel_sha256
    )
      throw new Error(
        "Stable fixture changed. Preserve the evidence and inspect isolation before retrying.",
      );
  }
}

/** The default runtime admits no command-line feature overrides. */
export function admitRuntimeSwitches(
  argv: readonly string[],
  execArgv: readonly string[],
  instrumented: boolean,
): void {
  const allowed = new Set(instrumented ? ["--inspect=0", "--remote-debugging-port=0"] : []);
  if ([...argv, ...execArgv].some((arg) => arg.startsWith("-") && !allowed.has(arg)))
    throw new Error("Runtime command-line overrides are not admitted.");
}
