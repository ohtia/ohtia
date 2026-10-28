import { isDeepStrictEqual } from "node:util";
import { requireGate, sameSet } from "./quality-core.mjs";

const requiredCases = {
  "native-smoke": ["packaged-startup", "packaged-csp", "bounded-shutdown"],
  "native-storage": [
    "durable-command-restart",
    "migration-checkpoint-recovery",
    "concurrent-saves",
  ],
  "native-runtime": ["actual-ipc", "utility-crash-recovery", "sandbox-and-profile-isolation"],
  "native-assistive": [
    "bootstrap-keyboard-and-screen-reader",
    "storage-recovery-keyboard-and-screen-reader",
  ],
};
const kinds = Object.keys(requiredCases);
/** Every manifest profile remains a distinct cell; optional targets are opt-in as whole targets. */
export function nativeInventory(manifest, includedOptional = []) {
  requireGate(
    manifest?.schema_version === 1 && Array.isArray(manifest.targets),
    "invalid native target manifest",
  );
  sameSet(
    manifest.targets.map((t) => t.id),
    ["linux-x64", "linux-arm64", "win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64"],
    "declared desktop targets",
  );
  sameSet(includedOptional, [...new Set(includedOptional)], "included optional targets");
  for (const id of includedOptional)
    requireGate(
      manifest.targets.some((t) => t.id === id && t.native_required === false),
      `unknown/nonoptional target: ${id}`,
    );
  const cells = [];
  for (const target of manifest.targets) {
    requireGate(
      typeof target.native_required === "boolean",
      `${target.id}: missing requirement classification`,
    );
    requireGate(
      target.native_required ===
        ["linux-x64", "linux-arm64", "win32-x64", "darwin-arm64"].includes(target.id),
      `${target.id}: misclassified native requirement`,
    );
    if (!target.native_required && !includedOptional.includes(target.id)) continue;
    requireGate(
      target.id === `${target.os}-${target.arch}`,
      `${target.id}: mismatched OS/CPU metadata`,
    );
    sameSet(target.filesystems, [...new Set(target.filesystems)], `${target.id}: filesystems`);
    sameSet(
      target.quality_packages,
      [...new Set(target.quality_packages)],
      `${target.id}: quality packages`,
    );
    requireGate(
      target.filesystems.length > 0 && target.quality_packages.length > 0,
      `${target.id}: empty native dimensions`,
    );
    let profiles;
    if (target.os === "linux") {
      profiles = target.distribution_profiles.flatMap((p) =>
        p.display_backends.flatMap((display) =>
          p.filesystems.map((fs) => ({ profile: `${p.id}/${display}/${fs}`, package: p.package })),
        ),
      );
      sameSet(
        [...new Set(profiles.map((p) => p.package))],
        target.quality_packages,
        `${target.id}: represented package formats`,
      );
      sameSet(
        [...new Set(target.distribution_profiles.flatMap((p) => p.filesystems))],
        target.filesystems,
        `${target.id}: represented filesystems`,
      );
    } else {
      let releases;
      if (target.os === "darwin")
        releases = (
          target.native_required ? target.required_os_majors : target.admitted_os_majors
        ).map((major) => `macos-${major}`);
      else {
        requireGate(
          target.baseline === "Windows 11 25H2 (build 26200) or later supported Windows 11 release",
          `${target.id}: unsupported Windows baseline; model its profiles before admission`,
        );
        releases = ["windows-11-25h2"];
      }
      profiles = releases.flatMap((release) =>
        target.filesystems.flatMap((filesystem) =>
          target.quality_packages.map((format) => ({
            profile: `${release}/${filesystem}`,
            package: format,
          })),
        ),
      );
    }
    requireGate(profiles.length > 0, `${target.id}: missing profiles`);
    for (const profile of profiles)
      for (const kind of kinds)
        cells.push({
          id: `${kind}/${target.id}/${profile.profile}/${profile.package}`,
          kind,
          target: target.id,
          os: target.os,
          arch: target.arch,
          cases: requiredCases[kind],
          ...profile,
        });
  }
  sameSet(
    cells.map((c) => c.id),
    [...new Set(cells.map((c) => c.id))],
    "native cells",
  );
  return cells;
}
export function accountNative(cells, reports, identity) {
  requireGate(
    identity &&
      typeof identity.run === "string" &&
      identity.run.length > 0 &&
      /^[a-f0-9]{40}$/.test(identity.base ?? "") &&
      /^[a-f0-9]{40}$/.test(identity.head ?? "") &&
      /^[a-f0-9]{64}$/.test(identity.sourceSha256 ?? "") &&
      /^[a-f0-9]{64}$/.test(identity.workflowSha256 ?? ""),
    "invalid native source/run identity",
  );
  requireGate(Array.isArray(reports), "missing native reports");
  sameSet(
    reports.map((r) => r.id),
    cells.map((c) => c.id),
    "native result partitions",
  );
  for (const cell of cells) {
    const report = reports.find((r) => r.id === cell.id);
    for (const key of ["kind", "target", "os", "arch", "profile", "package"])
      requireGate(report[key] === cell[key], `${cell.id}: misclassified ${key}`);
    requireGate(
      report.version === 1 && report.status === "passed" && report.preparation === "passed",
      `${cell.id}: incomplete native result`,
    );
    requireGate(isDeepStrictEqual(report.identity, identity), `${cell.id}: stale identity`);
    requireGate(
      report.execution === "native" &&
        report.hostArch === cell.arch &&
        report.processArch === cell.arch &&
        report.emulated === false,
      `${cell.id}: emulation/CPU mismatch`,
    );
    requireGate(
      /^[a-f0-9]{64}$/.test(report.artifactSha256 ?? ""),
      `${cell.id}: missing artifact digest`,
    );
    requireGate(
      Array.isArray(report.cases) && report.cases.length > 0,
      `${cell.id}: no native cases`,
    );
    sameSet(
      report.cases.map((c) => c.id),
      cell.cases,
      `${cell.id}: native cases`,
    );
    requireGate(
      report.cases.every(
        (c) => c.status === "passed" && c.attempts === 1 && c.expectedFailure !== true,
      ),
      `${cell.id}: unsuccessful native case`,
    );
    if (cell.kind === "native-assistive")
      requireGate(
        typeof report.operator === "string" &&
          report.operator.length > 0 &&
          typeof report.tool === "string" &&
          report.tool.length > 0,
        `${cell.id}: missing actual operator/tool`,
      );
  }
  return { status: "passed", cells: cells.length };
}
