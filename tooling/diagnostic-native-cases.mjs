// Non-shipping tests of the exact broker-writer module under the prepared Electron runtime.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import childProcess, { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadRuntimeProfile, verifyStableSentinels } from "../packages/main/dist/index.js";
import {
  diagnosticLimits,
  decodeDiagnosticLine,
  makeDiagnosticRecord,
  suppressDiagnosticCapture,
} from "../packages/contracts/dist/index.js";
const [profileFile, appDirectory, output, mode] = process.argv.slice(2);
const profile = loadRuntimeProfile(profileFile);
verifyStableSentinels(profile);
assert.equal(process.versions.electron, "45.0.0");
assert.equal(process.versions.node, "24.22.0");
assert.ok(path.isAbsolute(output) && output.startsWith(profile.scratch_root + path.sep));
const { DiagnosticWriter } = await import(
  pathToFileURL(path.join(appDirectory, "diagnostic-writer.js")).href
);
const version = JSON.parse(fs.readFileSync(path.join(appDirectory, "package.json"))).version;
const store = path.join(output, "diagnostic-fixture");
const marker = "PRIVATE_研究_query_password_SQL_prompt_filename";
const started = { event_name: "ohtia.application.started" };
const now = new Date().toISOString();
const record = (duration_ms = 0) =>
  Buffer.from(
    JSON.stringify(makeDiagnosticRecord({ ...started, duration_ms }, version, now)) + "\n",
  );
const active = path.join(store, "logs/ohtia.jsonl");
const writer = () =>
  new DiagnosticWriter({
    root: store,
    version,
    assertAdmission: () => {
      loadRuntimeProfile(profileFile);
      verifyStableSentinels(profile);
    },
  });
if (mode) {
  const w = writer();
  await w.initializeLogs();
  if (mode === "interrupt-append") {
    const write = fs.writeSync;
    fs.writeSync = (fd, bytes, offset, length) => {
      write(fd, bytes, offset, 10);
      write(1, "ohtia-interruption-ready\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return length;
    };
  } else {
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      rename(source, target);
      fs.writeSync(1, "ohtia-interruption-ready\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
  }
  await w.append(started);
  process.exit(2);
}
fs.mkdirSync(store);
const results = [];
const receipt = {
  version: 1,
  host: { platform: os.platform(), arch: os.arch(), release: os.release() },
  runtime: process.versions,
  artifactVersion: version,
  writerSha256: createHash("sha256")
    .update(fs.readFileSync(path.join(appDirectory, "diagnostic-writer.js")))
    .digest("hex"),
  cases: results,
};
const save = () =>
  fs.writeFileSync(
    path.join(output, "diagnostic-components.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
async function test(id, run) {
  try {
    await run();
    results.push({ id, result: "pass" });
    save();
  } catch {
    results.push({ id, result: "fail" });
    save();
    throw new Error("Controlled native diagnostic case failed: " + id);
  }
}
function exact(target) {
  const a = record(0),
    b = record(10);
  for (let count = 0; count <= target / a.length; count++) {
    const rest = target - count * a.length;
    if (rest % b.length === 0) {
      fs.writeFileSync(
        active,
        Buffer.concat([
          Buffer.from(a.toString().repeat(count)),
          Buffer.from(b.toString().repeat(rest / b.length)),
        ]),
      );
      return;
    }
  }
  throw new Error("Exact boundary fixture unavailable.");
}
async function interrupt(kind) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), profileFile, appDirectory, output, kind],
    { env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  let acknowledge;
  const acknowledged = new Promise((resolve) => {
    acknowledge = resolve;
  });
  let outputText = "";
  child.stdout.on("data", (bytes) => {
    outputText += bytes.toString();
    if (outputText.includes("ohtia-interruption-ready\n")) acknowledge({ ready: true });
  });
  child.stderr.on("data", (bytes) => {
    outputText += bytes.toString();
  });
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const ready = await Promise.race([
    acknowledged,
    exited.then(() => ({ failed: true })),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ failed: true }), 60000);
      timer.unref();
    }),
  ]);
  child.kill("SIGKILL");
  const result = await exited;
  assert.equal(ready.ready, true);
  assert.ok(result.signal || result.code !== 0);
  assert.ok(!outputText.includes(marker));
}
let w = writer();
await test("native-account-access", async () => {
  const originalSpawn = childProcess.spawn;
  receipt.permissionHelpers = [];
  receipt.initialWriterStatus = w.status;
  receipt.fixtureRoot = {
    canonicalMatches: fs.realpathSync.native(store) === store,
    directory: fs.lstatSync(store).isDirectory(),
  };
  childProcess.spawn = function (command, args, options) {
    if (!command.endsWith("powershell.exe")) return originalSpawn(command, args, options);
    const helperStarted = performance.now();
    const observation = {
      exitCode: null,
      signal: null,
      errorCode: null,
      killed: false,
      elapsed_ms: null,
      stdout: "",
      stderr: "",
      truncated: false,
    };
    receipt.permissionHelpers.push(observation);
    const child = originalSpawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const name of ["stdout", "stderr"]) {
      child[name].on("data", (bytes) => {
        const text = bytes.toString();
        const available = 32768 - observation[name].length;
        observation[name] += text.slice(0, available);
        if (text.length > available) observation.truncated = true;
      });
    }
    child.once("error", (error) => {
      observation.errorCode = typeof error.code === "string" ? error.code : "unknown";
    });
    child.once("close", (code, signal) => {
      observation.exitCode = code;
      observation.signal = signal;
      observation.killed = child.killed;
      observation.elapsed_ms = Math.round(performance.now() - helperStarted);
    });
    return child;
  };
  try {
    receipt.initialAppend = await w.append(started);
  } finally {
    childProcess.spawn = originalSpawn;
  }
  if (process.platform === "win32") {
    if (!receipt.initialAppend.ok) {
      const probeStarted = performance.now();
      const boundedText = (value) =>
        (typeof value === "string"
          ? value
          : Buffer.isBuffer(value)
            ? value.toString("utf8")
            : ""
        ).slice(0, 32768);
      const probe = [
        '$ErrorActionPreference="Stop";',
        '[System.Console]::WriteLine("shell-ready");',
        '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; [System.Console]::WriteLine("identity-ready");',
        '$acl=[System.IO.Directory]::GetAccessControl($env:OHTIA_DIAGNOSTIC_ACL_PATH); [System.Console]::WriteLine("acl-ready");',
        '$null=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); [System.Console]::WriteLine("rules-ready");',
      ].join(" ");
      try {
        const stdout = execFileSync(
          path.join(
            process.env.SystemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          ["-NoProfile", "-NonInteractive", "-Command", probe],
          {
            env: { ...process.env, OHTIA_DIAGNOSTIC_ACL_PATH: path.dirname(active) },
            windowsHide: true,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15000,
            maxBuffer: 32768,
          },
        );
        receipt.permissionShellProbe = { status: 0, stdout: boundedText(stdout) };
      } catch (error) {
        receipt.permissionShellProbe = {
          status: error.status ?? null,
          signal: error.signal ?? null,
          errorCode: typeof error.code === "string" ? error.code : null,
          stdout: boundedText(error.stdout),
          stderr: boundedText(error.stderr),
        };
      }
      receipt.permissionShellProbe.elapsed_ms = Math.round(performance.now() - probeStarted);
    }
    receipt.initialAcls = {};
    receipt.initialAclTruncated = {};
    for (const [name, file] of Object.entries({
      root: store,
      directory: path.dirname(active),
      file: active,
    })) {
      try {
        const acl = execFileSync(
          path.join(process.env.SystemRoot, "System32", "icacls.exe"),
          [file],
          { encoding: "utf8", timeout: 10000 },
        );
        receipt.initialAcls[name] = acl.slice(0, 32768);
        receipt.initialAclTruncated[name] = acl.length > 32768;
      } catch (error) {
        receipt.initialAcls[name] = {
          errorCode: typeof error.code === "string" ? error.code : null,
          status: error.status ?? null,
        };
      }
    }
  }
  assert.equal(receipt.initialAppend.ok, true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.dirname(active)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(active).mode & 0o777, 0o600);
  } else {
    const acl = receipt.initialAcls.file;
    assert.equal(typeof acl, "string");
    assert.equal(receipt.initialAclTruncated.file, false);
    receipt.fileAcl = acl;
    assert.ok(!/Everyone|BUILTIN\\Users|Authenticated Users/i.test(acl));
  }
});
await test("catalog-private-markers", async () => {
  for (const key of [
    "message",
    "exception",
    "stack",
    "metadata",
    "filename",
    "query",
    "prompt",
    "response",
    "sql",
    "token",
    "resource",
    "timestamp",
    "duration_ms",
    "error_code",
  ]) {
    assert.equal((await w.append({ ...started, [key]: marker })).ok, false);
  }
  assert.ok(!fs.readFileSync(active, "utf8").includes(marker));
});
await test("actual-artifact-version", async () => {
  assert.equal((await w.read(0)).records[0].resource["service.version"], version);
});
await test("exact-boundary-rotation", async () => {
  const bytes = Buffer.byteLength(
    JSON.stringify(makeDiagnosticRecord(started, version, new Date().toISOString())) + "\n",
  );
  exact(diagnosticLimits.fileBytes - bytes);
  assert.equal((await w.append(started)).ok, true);
  assert.equal(fs.statSync(active).size, diagnosticLimits.fileBytes);
  assert.equal((await w.append(started)).ok, true);
  assert.equal(
    fs.statSync(path.join(store, "logs/ohtia.1.jsonl")).size,
    diagnosticLimits.fileBytes,
  );
});
await test("five-file-retention", async () => {
  for (let i = 0; i < 5; i++) {
    exact(diagnosticLimits.fileBytes);
    assert.equal((await w.append(started)).ok, true);
  }
  const names = fs.readdirSync(path.dirname(active));
  assert.equal(names.length, 5);
  assert.ok(
    names.every(
      (name) =>
        fs.statSync(path.join(path.dirname(active), name)).size <= diagnosticLimits.fileBytes,
    ),
  );
});
await test("multibyte-rejected-bound", async () => {
  assert.equal((await w.append({ ...started, message: marker.repeat(10000) })).ok, false);
  assert.equal(decodeDiagnosticLine(Buffer.from(marker.repeat(10000))).code, "oversized_record");
});
await test("serialized-delete-save", async () => {
  const research = path.join(store, "ohtia.db3");
  fs.writeFileSync(research, "synthetic durable record");
  const results = await Promise.all([w.append(started), w.deleteLogs(true), w.append(started)]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(fs.readFileSync(research, "utf8"), "synthetic durable record");
});
await test("bounded-queue", async () => {
  const results = await Promise.all(Array.from({ length: 65 }, () => w.append(started)));
  assert.equal(results.filter((r) => r.status === "busy").length, 1);
});
await w.close();
await test("interrupted-append-process", async () => {
  fs.writeFileSync(active, "");
  await interrupt("interrupt-append");
  w = writer();
  assert.equal((await w.append(started)).ok, true);
  assert.equal((await w.read(0)).records.length, 1);
  await w.close();
});
await test("interrupted-rotation-process", async () => {
  exact(diagnosticLimits.fileBytes);
  await interrupt("interrupt-rotation");
  w = writer();
  assert.equal((await w.append(started)).ok, true);
  assert.ok(fs.readdirSync(path.dirname(active)).length <= 5);
});
await test("version-aware-reader", async () => {
  fs.writeFileSync(
    active,
    JSON.stringify({ ...makeDiagnosticRecord(started, version, now), schema_version: 2 }) +
      "\n" +
      JSON.stringify({ message: marker }) +
      "\n",
  );
  const page = await w.read(0);
  assert.equal(page.unsupported, 1);
  assert.equal(page.invalid, 1);
  assert.ok(!JSON.stringify(page).includes(marker));
});
await w.close();
await test("native-denied-io", async () => {
  const logs = path.dirname(active);
  const windows = process.platform === "win32";
  const user = os.userInfo().username;
  const icacls = windows ? path.join(process.env.SystemRoot, "System32", "icacls.exe") : "";
  fs.renameSync(logs, logs + "-retained");
  try {
    if (windows) execFileSync(icacls, [store, "/deny", `${user}:(OI)(CI)(W)`], { stdio: "ignore" });
    else fs.chmodSync(store, 0o500);
    w = writer();
    assert.equal((await w.append(started)).ok, false);
    await w.close();
  } finally {
    if (windows) execFileSync(icacls, [store, "/remove:d", user], { stdio: "ignore" });
    else fs.chmodSync(store, 0o700);
    fs.renameSync(logs + "-retained", logs);
  }
});
await test("automatic-capture-stderr-errors", async () => {
  suppressDiagnosticCapture((discard) => {
    process.stdout.write = discard;
    process.stderr.write = discard;
  });
  console.error(new Error(marker));
  console.log({ sdk: { prompt: marker, response: marker } });
  process.stderr.write(marker);
  process.stdout.write(marker);
});
verifyStableSentinels(profile);
save();
