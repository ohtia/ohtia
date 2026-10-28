import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function descendants(records, parent) {
  const ids = new Set([parent]);
  for (let i = 0; i < records.length; i++)
    for (const item of records) if (ids.has(item.parent)) ids.add(item.pid);
  return records.filter((item) => item.pid !== parent && ids.has(item.pid));
}
export function sandboxEvidence(records, baseline) {
  const sandboxed = records.filter(
    (item) => item.seccomp === 2 && item.filters > baseline.filters && item.noNewPrivileges === 1,
  );
  assert.ok(
    records.length > 0 && sandboxed.length === records.length,
    "Every content process must have an additional active OS seccomp sandbox",
  );
  for (const item of records)
    assert.ok(
      !/(?:^|\s)--(?:no-sandbox|disable-[^\s=]*sandbox)(?:=|\s|$)/.test(item.command.join(" ")),
      "A process disabled its sandbox",
    );
  return { baseline, sandboxed, processes: records };
}

export function contentProcesses(engine, records) {
  return records.filter((item) => {
    const command = item.command.join(" ");
    if (engine === "chromium") return /(?:^|\s)--type=renderer(?:\s|$)/.test(command);
    if (engine === "firefox")
      return /(?:^|\s)-contentproc(?:\s|$)/.test(command) && /(?:^|\s)tab(?:\s|$)/.test(command);
    if (engine === "webkit") return /(?:^|\/)WebKitWebProcess(?:\s|$)/.test(item.command[0] ?? "");
    throw new Error("Undeclared browser engine");
  });
}

export function assertCspReport(violations) {
  const expected = [
    ["connect-src", "https://example.invalid/ohtia-csp-test", "enforce"],
    ["script-src-elem", "inline", "enforce"],
  ];
  assert.ok(
    violations.every((item) => item.phase === "negative"),
    "Unexpected CSP violation outside the deliberate negative case",
  );
  assert.deepEqual(
    violations.map((item) => [item.directive, item.blocked, item.disposition]).sort(),
    expected,
  );
}

export function assertBrowserParity({
  config,
  metadata,
  coreVersion,
  packageVersion,
  browsers,
  browserRoot,
  executables,
}) {
  assert.equal(metadata.driverVersion, config.playwright);
  assert.equal(metadata.dockerImageName, config.playwrightImage ?? config.image.split("@")[0]);
  assert.equal(coreVersion, config.playwright);
  assert.equal(packageVersion, config.playwright);
  assert.deepEqual(
    Object.fromEntries(browsers.map((item) => [item.name, item.revision])),
    config.browsers,
  );
  for (const item of browsers) {
    const directory = path.join(browserRoot, `${item.name.replaceAll("-", "_")}-${item.revision}`);
    assert.ok(fs.statSync(directory).isDirectory(), `Missing pinned browser: ${item.name}`);
    assert.ok(
      fs.existsSync(path.join(directory, "INSTALLATION_COMPLETE")),
      `Incomplete browser: ${item.name}`,
    );
  }
  for (const executable of executables)
    assert.ok(fs.statSync(executable).isFile(), `Missing browser executable: ${executable}`);
}

export function assertArtifactTree(prefix, artifacts) {
  assert.ok(artifacts && Object.keys(artifacts).length > 0, "Empty native artifact inventory");
  const actual = fs
    .readdirSync(prefix, { recursive: true })
    .filter((name) => !fs.lstatSync(path.join(prefix, name)).isDirectory())
    .map((name) => name.replaceAll(path.sep, "/"))
    .sort();
  assert.deepEqual(actual, Object.keys(artifacts).sort(), "Native artifact inventory differs");
  for (const [name, expected] of Object.entries(artifacts)) {
    const file = path.resolve(prefix, name);
    assert.ok(
      file.startsWith(path.resolve(prefix) + path.sep),
      "Native artifact escaped its prefix",
    );
    const stat = fs.lstatSync(file);
    if (Object.hasOwn(expected, "link")) {
      assert.ok(stat.isSymbolicLink());
      assert.equal(fs.readlinkSync(file), expected.link);
      assert.ok(
        fs.realpathSync(file).startsWith(path.resolve(prefix) + path.sep),
        "Native artifact link escaped its prefix",
      );
    } else {
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      assert.equal(fs.realpathSync(file), file);
      assert.equal(
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        expected.sha256,
        `Native artifact changed: ${name}`,
      );
      assert.equal(stat.mode & 0o7777, expected.mode);
    }
  }
}

export function shutdownEvidence({ elapsedMs, limitMs, exitCode, signalCode, remaining }) {
  assert.ok(elapsedMs <= limitMs, "Shutdown exceeded its total deadline");
  assert.equal(exitCode, 0, "Electron did not exit normally with code zero");
  assert.equal(signalCode, null, "Electron was terminated by a signal");
  assert.deepEqual(remaining, [], "Known Electron descendants survived shutdown");
  return {
    elapsed_ms: elapsedMs,
    exit_code: exitCode,
    signal: signalCode,
    scope: "container-visible descendants",
  };
}
