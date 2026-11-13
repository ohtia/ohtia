import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  parseDevelopmentSwitches,
  admitDevelopmentRoot,
  admitRuntimeProfile,
  portLimits,
  type RuntimeContext,
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
export function verifyStableSentinels(profile: Pick<RuntimeProfile, "stable_roots">): void {
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
  mode: RuntimeContext["mode"] = "installed",
): void {
  if (mode === "development") parseDevelopmentSwitches(argv);
  const allowed = new Set(instrumented ? ["--inspect=0", "--remote-debugging-port=0"] : []);
  if (
    [...argv, ...execArgv].some(
      (arg) =>
        arg.startsWith("-") &&
        !allowed.has(arg) &&
        !(
          mode === "development" &&
          argv.includes(arg) &&
          !execArgv.includes(arg) &&
          arg.startsWith("--ohtia-dev-")
        ),
    )
  )
    throw new Error("Runtime command-line overrides are not admitted.");
}

/** Refuse a development root before any redirection of the native configuration location. */
export function admitDevelopmentInstance(
  root: string,
  nativeApplicationRoot: string,
  host: ProfileHost = nativeProfileHost(),
): void {
  let instance: unknown;
  try {
    instance = JSON.parse(readBoundedFile(path.join(root, "instance.json")).toString("utf8"));
  } catch {
    instance = undefined;
  }
  admitDevelopmentRoot(root, instance, { ...host, nativeApplicationRoot });
  for (const name of ["configuration", "research"]) {
    const component = path.join(root, name);
    if (fs.existsSync(component) && !fs.lstatSync(component).isDirectory())
      throw new Error(`Development root refused: ${name} is not a plain directory.`);
    if (fs.lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`Development root refused: ${name} is an alias.`);
  }
}

export interface RuntimeInputs {
  readonly profileFile: string;
  readonly developmentRoot: string;
  readonly packaged: boolean;
  readonly appData: string;
  readonly temp: string;
}
/** Select exactly one mode; a set profile can only add checks and never falls back. */
export function resolveRuntimeContext(
  inputs: RuntimeInputs,
  host: ProfileHost = nativeProfileHost(),
): RuntimeContext {
  if (inputs.profileFile)
    return { ...loadRuntimeProfile(inputs.profileFile), mode: "qualification" };
  if (!inputs.packaged) {
    if (!inputs.developmentRoot) throw new Error("A development root is required.");
    admitDevelopmentInstance(
      inputs.developmentRoot,
      path.join(host.configurationRoot, "Ohtia"),
      host,
    );
    return {
      mode: "development",
      home: host.home,
      configuration_root: path.join(inputs.developmentRoot, "configuration"),
      research_root: path.join(inputs.developmentRoot, "research"),
      scratch_root: inputs.temp,
      stable_roots: {},
    };
  }
  return {
    mode: "installed",
    home: host.home,
    configuration_root: inputs.appData,
    research_root: host.researchRoot,
    scratch_root: inputs.temp,
    stable_roots: {},
  };
}

/** Create the fixed research root on explicit opening; never adopt an alias or another type. */
export function ensureResearchRoot(researchRoot: string): void {
  try {
    fs.mkdirSync(researchRoot, { mode: 0o700 });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = fs.lstatSync(researchRoot);
  if (!existing.isDirectory() || fs.realpathSync.native(researchRoot) !== researchRoot)
    throw new Error("The research root is not a plain directory.");
}
