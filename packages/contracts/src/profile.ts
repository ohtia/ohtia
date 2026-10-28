/** Native adapters supply facts from the OS, not environment overrides or renderer data. */
export interface ProfileHost {
  readonly username: string;
  readonly home: string;
  readonly configurationRoot: string;
  readonly researchRoot: string;
  readonly target: string;
  canonical(path: string): string;
  contains(parent: string, child: string): boolean;
  owned(path: string): boolean;
}
export interface RuntimeProfile {
  readonly schema_version: 1;
  readonly kind: "independent-native-profile";
  readonly inspected_by: string;
  readonly username: string;
  readonly target: string;
  readonly home: string;
  readonly configuration_root: string;
  readonly research_root: string;
  readonly scratch_root: string;
  readonly stable_roots: Readonly<
    Record<
      "configuration" | "store" | "recovery",
      {
        readonly root: string;
        readonly sentinel_sha256: string;
        readonly sentinel_filename?: ".ohtia-runtime-sentinel" | ".ohtia-native-probe-sentinel";
      }
    >
  >;
  readonly manual_checks: Readonly<
    Record<
      | "independent_account_or_vm"
      | "no_emulation"
      | "local_owned_unsynchronized_volumes"
      | "no_credentials"
      | "stable_roots_complete"
      | "native_security_and_display",
      true
    >
  >;
}
function record(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  return (
    !!input &&
    typeof input === "object" &&
    Object.getPrototypeOf(input) === Object.prototype &&
    Object.keys(input).length === keys.length &&
    keys.every((key) => Object.hasOwn(input, key))
  );
}
/** A manually inspected profile is an accident-prevention contract, not protection from an OS peer. */
export function admitRuntimeProfile(input: unknown, host: ProfileHost): RuntimeProfile {
  const reject = (): never => {
    throw new Error(
      "Isolation admission refused. Log into the inspected independent native account or VM and check the runtime profile.",
    );
  };
  if (
    !record(input, [
      "schema_version",
      "kind",
      "inspected_by",
      "username",
      "target",
      "home",
      "configuration_root",
      "research_root",
      "scratch_root",
      "stable_roots",
      "manual_checks",
    ])
  )
    return reject();
  if (
    input.schema_version !== 1 ||
    input.kind !== "independent-native-profile" ||
    typeof input.inspected_by !== "string" ||
    !/^(human|agent):[A-Za-z0-9-]+$/.test(input.inspected_by) ||
    input.username !== host.username ||
    input.target !== host.target
  )
    return reject();
  const checks = [
    "independent_account_or_vm",
    "no_emulation",
    "local_owned_unsynchronized_volumes",
    "no_credentials",
    "stable_roots_complete",
    "native_security_and_display",
  ];
  const manual = input.manual_checks;
  if (!record(manual, checks) || !checks.every((key) => manual[key] === true)) return reject();
  const rootKeys = ["home", "configuration_root", "research_root", "scratch_root"] as const;
  for (const key of rootKeys) {
    const root = input[key];
    if (
      typeof root !== "string" ||
      !root ||
      root.length > 4096 ||
      host.canonical(root) !== root ||
      !host.owned(root)
    )
      return reject();
  }
  const profile = input as unknown as RuntimeProfile;
  if (
    profile.home !== host.home ||
    profile.configuration_root !== host.configurationRoot ||
    profile.research_root !== host.researchRoot
  )
    return reject();
  const roots = [profile.configuration_root, profile.research_root, profile.scratch_root];
  if (!roots.every((root) => root !== host.home && host.contains(host.home, root))) return reject();
  const overlaps = (a: string, b: string) => host.contains(a, b) || host.contains(b, a);
  if (roots.some((a, i) => roots.some((b, j) => i !== j && overlaps(a, b)))) return reject();
  if (!record(input.stable_roots, ["configuration", "store", "recovery"])) return reject();
  for (const stable of Object.values(input.stable_roots)) {
    if (
      !(
        record(stable, ["root", "sentinel_sha256"]) ||
        record(stable, ["root", "sentinel_sha256", "sentinel_filename"])
      ) ||
      typeof stable.root !== "string" ||
      typeof stable.sentinel_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(stable.sentinel_sha256)
    )
      return reject();
    if (
      Object.hasOwn(stable, "sentinel_filename") &&
      stable.sentinel_filename !== ".ohtia-runtime-sentinel" &&
      stable.sentinel_filename !== ".ohtia-native-probe-sentinel"
    )
      return reject();
    const stableRoot = stable.root;
    if (
      host.canonical(stableRoot) !== stableRoot ||
      overlaps(host.home, stableRoot) ||
      roots.some((root) => overlaps(root, stableRoot))
    )
      return reject();
  }
  return profile;
}
