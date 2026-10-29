// Native broker, filesystem and automatic-capture evidence; no research or telemetry exporter.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { _electron, expect } from "@playwright/test";
import { admittedLaunch } from "./desktop-launch.mjs";
import { recordReadyNativeProcesses } from "./desktop-native-observation.mjs";
import { decodeDiagnosticLine, message } from "../packages/contracts/dist/index.js";
import { verifyStableSentinels } from "../packages/main/dist/index.js";
const [profileFile, prepared, output] = process.argv.slice(2);
const launch = admittedLaunch(profileFile, prepared);
assert.ok(
  path.isAbsolute(output) &&
    output.startsWith(launch.profile.scratch_root + path.sep) &&
    !fs.existsSync(output),
);
fs.mkdirSync(output);
const inventory = JSON.parse(
  fs.readFileSync(new URL("../config/desktop/diagnostic-cases.json", import.meta.url)),
);
const receipt = {
  version: 1,
  host: { platform: os.platform(), arch: os.arch(), release: os.release() },
  preparedSha256: createHash("sha256")
    .update(fs.readFileSync(path.join(prepared, "prepared.json")))
    .digest("hex"),
  cases: [],
  limitations: [
    "Controlled interruption is distinct from physical power loss.",
    "Manual assistive and human linguistic acceptance remain separate.",
  ],
};
const saveReceipt = () =>
  fs.writeFileSync(
    path.join(output, "diagnostic-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
const record = (id, detail = {}) => {
  receipt.cases.push({ id, result: "pass", ...detail });
  saveReceipt();
};
function snapshot() {
  const result = {};
  for (const [key, stable] of Object.entries(launch.profile.stable_roots)) {
    const entries = {};
    for (const relative of [
      "",
      ...fs.readdirSync(stable.root, { recursive: true }).map(String).sort(),
    ]) {
      const file = path.join(stable.root, relative),
        stat = fs.lstatSync(file, { bigint: true });
      assert.ok(!stat.isSymbolicLink());
      entries[relative] = {
        size: String(stat.size),
        mode: String(stat.mode),
        ino: String(stat.ino),
        mtime: String(stat.mtimeNs),
        ...(stat.isFile()
          ? { sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") }
          : {}),
      };
    }
    result[key] = entries;
  }
  return result;
}
const before = snapshot();
const marker = "PRIVATE_研究_query_password_SQL_prompt_filename";
const components = spawn(
  launch.executable,
  [
    fileURLToPath(new URL("./diagnostic-native-cases.mjs", import.meta.url)),
    profileFile,
    launch.app,
    output,
  ],
  {
    cwd: launch.profile.scratch_root,
    env: { ...launch.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let capture = "";
components.stdout.on("data", (bytes) => {
  capture += bytes.toString();
});
components.stderr.on("data", (bytes) => {
  capture += bytes.toString();
});
const code = await new Promise((resolve, reject) => {
  components.once("error", reject);
  components.once("exit", resolve);
});
fs.writeFileSync(
  path.join(output, "component-process.json"),
  JSON.stringify({ code, privateMarkerAbsent: !capture.includes(marker), stdoutStderr: capture }),
);
assert.equal(code, 0);
assert.ok(!capture.includes(marker));
const componentReceipt = JSON.parse(
  fs.readFileSync(path.join(output, "diagnostic-components.json")),
);
assert.deepEqual(
  componentReceipt.cases.map((c) => c.id).sort(),
  inventory.component_cases.toSorted(),
);
assert.ok(componentReceipt.cases.every((c) => c.result === "pass"));
let application;
let originalWrite;
let mainOutput = "";
const logDirectory = path.join(launch.profile.research_root, "logs");
function logs() {
  const records = [];
  for (const name of [
    "ohtia.jsonl",
    "ohtia.1.jsonl",
    "ohtia.2.jsonl",
    "ohtia.3.jsonl",
    "ohtia.4.jsonl",
  ]) {
    const file = path.join(logDirectory, name);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    assert.ok(!bytes.includes(Buffer.from(marker)));
    let start = 0;
    for (let end; (end = bytes.indexOf(10, start)) >= 0; start = end + 1) {
      const decoded = decodeDiagnosticLine(bytes.subarray(start, end));
      assert.equal(decoded.ok, true);
      records.push(decoded.value);
    }
  }
  return records;
}
try {
  application = await _electron.launch({
    executablePath: launch.executable,
    args: [launch.app, ...launch.args],
    env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    chromiumSandbox: true,
    bypassCSP: false,
    timeout: 30000,
    artifactsDir: output,
  });
  const process = application.process();
  process.stdout?.on("data", (bytes) => {
    mainOutput += bytes.toString();
  });
  process.stderr?.on("data", (bytes) => {
    mainOutput += bytes.toString();
  });
  const page = await application.firstWindow();
  await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
  await recordReadyNativeProcesses(application, output);
  const state = await page.evaluate(() => window.ohtia.bootstrap.read());
  if (state.state !== "storage_ready") {
    assert.ok(["pending_create", "located"].includes(state.state));
    await page
      .getByRole("button", { name: message(state.locale, "open_storage"), exact: true })
      .click();
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: 30000,
    })
    .toBe("storage_ready");
  await expect.poll(() => logs().some((r) => r.event_name === "ohtia.storage.opened")).toBe(true);
  const identity = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    runtime: process.versions,
    metrics: app.getAppMetrics(),
  }));
  assert.ok(logs().every((r) => r.resource["service.version"] === identity.version));
  record("broker-startup-and-worker-events", identity);
  if (os.platform() === "win32") {
    try {
      // Seed complete valid records at the exact rotation boundary in this synthetic store.
      const first = logs()[0];
      const a =
        JSON.stringify({ ...first, attributes: { ...first.attributes, "ohtia.duration_ms": 0 } }) +
        "\n";
      const b =
        JSON.stringify({ ...first, attributes: { ...first.attributes, "ohtia.duration_ms": 10 } }) +
        "\n";
      let seeded = false;
      for (let count = 0; count <= (5 * 1024 * 1024) / Buffer.byteLength(a); count++) {
        const remaining = 5 * 1024 * 1024 - count * Buffer.byteLength(a);
        if (remaining % Buffer.byteLength(b) === 0) {
          fs.writeFileSync(
            path.join(logDirectory, "ohtia.jsonl"),
            a.repeat(count) + b.repeat(remaining / Buffer.byteLength(b)),
          );
          seeded = true;
          break;
        }
      }
      assert.ok(seeded);
      await application.evaluate(() => {
        const child = process.getBuiltinModule("node:child_process");
        globalThis.__diagnosticOriginalSpawn = child.spawn;
        globalThis.__diagnosticDelayedAcl = 0;
        globalThis.__diagnosticAclDelayFinished = 0;
        child.spawn = function (command, args, options) {
          if (command.endsWith("powershell.exe") && !globalThis.__diagnosticDelayedAcl) {
            globalThis.__diagnosticDelayedAcl++;
            const changed = [...args];
            changed[changed.length - 1] =
              "[System.Threading.Thread]::Sleep(6000); " + changed[changed.length - 1];
            const observed = {
              started_ms: performance.now(),
              timeout_ms: options.timeout,
              pid: null,
              exit: null,
              close: null,
              error_code: null,
            };
            globalThis.__diagnosticHelperObservation = observed;
            const observeError = (error) => {
              observed.error_code =
                typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
                  ? error.code
                  : "unknown";
            };
            let helper;
            try {
              helper = globalThis.__diagnosticOriginalSpawn(command, changed, options);
            } catch (error) {
              observeError(error);
              throw error;
            }
            globalThis.__diagnosticDelayedHelper = helper;
            observed.pid = Number.isSafeInteger(helper.pid) ? helper.pid : null;
            helper.once("error", observeError);
            for (const event of ["exit", "close"]) {
              helper.once(event, (code, signal) => {
                observed[event] = {
                  code,
                  signal,
                  elapsed_ms: Math.round(performance.now() - observed.started_ms),
                };
                if (event === "close") globalThis.__diagnosticAclDelayFinished++;
              });
            }
            return helper;
          }
          return globalThis.__diagnosticOriginalSpawn(command, args, options);
        };
      });
      const delayedSave = await page.evaluate(async () => {
        const read = await window.ohtia.foundation.readAppearance().result;
        if (!read.ok) return read;
        return window.ohtia.foundation.replaceAppearance({
          operationId: crypto.randomUUID(),
          expectedRevision: read.value.revision,
          value: read.value.value === "dark" ? "light" : "dark",
        }).result;
      });
      assert.equal(delayedSave.ok, true);
      await expect
        .poll(() => application.evaluate(() => globalThis.__diagnosticDelayedAcl))
        .toBe(1);
      const elapsed = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const status = await page.evaluate(() => window.ohtia.foundation.readStatus().result);
        assert.equal(status.ok, true);
        elapsed.push(performance.now() - start);
      }
      assert.ok(elapsed.every((ms) => ms < 5000));
      assert.equal(await application.evaluate(() => globalThis.__diagnosticAclDelayFinished), 0);
      await expect
        .poll(() => application.evaluate(() => globalThis.__diagnosticAclDelayFinished), {
          timeout: 15000,
        })
        .toBe(1);
      const completion = await application.evaluate(() => ({
        timeout_ms: globalThis.__diagnosticHelperObservation?.timeout_ms,
        exit: globalThis.__diagnosticHelperObservation?.exit,
        close: globalThis.__diagnosticHelperObservation?.close,
        error_code: globalThis.__diagnosticHelperObservation?.error_code,
        killed: globalThis.__diagnosticDelayedHelper?.killed,
      }));
      assert.equal(completion.timeout_ms, 15000);
      assert.equal(completion.exit?.code, 0);
      assert.equal(completion.close?.code, 0);
      assert.equal(completion.close?.signal, null);
      assert.equal(completion.error_code, null);
      assert.equal(completion.killed, false);
      assert.ok(completion.close.elapsed_ms > 5000);
      record("delayed-permissions-preserve-status", {
        statusElapsedMs: elapsed,
        helper: completion,
      });
    } finally {
      receipt.windowsHelperDelay = await application
        .evaluate(() => {
          const observed = globalThis.__diagnosticHelperObservation;
          const helper = globalThis.__diagnosticDelayedHelper;
          const snapshot = {
            launched: globalThis.__diagnosticDelayedAcl ?? 0,
            closed: globalThis.__diagnosticAclDelayFinished ?? 0,
            timeout_ms: observed?.timeout_ms ?? null,
            pid: observed?.pid ?? null,
            exit: observed?.exit ?? null,
            close: observed?.close ?? null,
            error_code: observed?.error_code ?? null,
            elapsed_ms: observed ? Math.round(performance.now() - observed.started_ms) : null,
            current: helper
              ? {
                  exit_code: helper.exitCode,
                  signal: helper.signalCode,
                  killed: helper.killed,
                }
              : null,
          };
          if (globalThis.__diagnosticOriginalSpawn) {
            process.getBuiltinModule("node:child_process").spawn =
              globalThis.__diagnosticOriginalSpawn;
            delete globalThis.__diagnosticOriginalSpawn;
          }
          delete globalThis.__diagnosticDelayedHelper;
          delete globalThis.__diagnosticHelperObservation;
          return snapshot;
        })
        .catch(() => ({ unavailable: true }));
      saveReceipt();
    }
  }
  await application.evaluate(async (_electron, marker) => {
    const fs = process.getBuiltinModule("node:fs");
    globalThis.__diagnosticOriginalWrite = fs.writeSync;
    globalThis.__diagnosticWriteFailures = 0;
    fs.writeSync = function (fd, ...args) {
      if (Buffer.isBuffer(args[0]) && args[0].toString().includes('"schema_version":1')) {
        globalThis.__diagnosticWriteFailures++;
        throw new Error(marker);
      }
      return globalThis.__diagnosticOriginalWrite(fd, ...args);
    };
  }, marker);
  originalWrite = true;
  const saved = await page.evaluate(async () => {
    const read = await window.ohtia.foundation.readAppearance().result;
    if (!read.ok) return read;
    return window.ohtia.foundation.replaceAppearance({
      operationId: crypto.randomUUID(),
      expectedRevision: read.value.revision,
      value: read.value.value === "dark" ? "light" : "dark",
    }).result;
  });
  assert.equal(saved.ok, true);
  await expect
    .poll(() => application.evaluate(() => globalThis.__diagnosticWriteFailures))
    .toBeGreaterThan(0);
  await application.evaluate(async () => {
    const fs = process.getBuiltinModule("node:fs");
    fs.writeSync = globalThis.__diagnosticOriginalWrite;
    delete globalThis.__diagnosticOriginalWrite;
  });
  originalWrite = false;
  const readback = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  assert.deepEqual(readback, saved);
  record("logging-failure-preserves-save");
  await application.evaluate((_electron, marker) => {
    console.error(new Error(marker));
    console.log({ sdk: { prompt: marker, response: marker } });
    process.stderr.write(marker);
    process.stdout.write(marker);
  }, marker);
  logs();
  assert.ok(!mainOutput.includes(marker));
  record("automatic-capture-private-markers");
  const quitOffsets = new Map();
  for (let slot = 0; slot < 5; slot++) {
    const file = path.join(logDirectory, slot === 0 ? "ohtia.jsonl" : `ohtia.${slot}.jsonl`);
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      quitOffsets.set(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, stat.size);
    }
  }
  await application.close();
  application = undefined;
  for (let slot = 0; slot < 5; slot++) {
    const file = path.join(logDirectory, slot === 0 ? "ohtia.jsonl" : `ohtia.${slot}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    const prior = quitOffsets.get(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`) ?? 0;
    const bytes = fs.readFileSync(file);
    let start = prior <= bytes.length ? prior : 0;
    for (let end; (end = bytes.indexOf(10, start)) >= 0; start = end + 1) {
      const event = decodeDiagnosticLine(bytes.subarray(start, end));
      assert.equal(event.ok, true);
      assert.notEqual(event.value.event_name, "ohtia.service.unavailable");
    }
  }
  assert.equal(process.exitCode, 0);
  record("owned-process-exit", { pid: process.pid, exit: process.exitCode });
  assert.deepEqual(snapshot(), before);
  verifyStableSentinels(launch.profile);
  record("stable-profile-preserved");
  assert.deepEqual(
    receipt.cases.map((c) => c.id).sort(),
    [
      ...inventory.graphical_cases,
      ...(os.platform() === "win32" ? inventory.windows_cases : []),
    ].toSorted(),
  );
  fs.writeFileSync(
    path.join(output, "main-process-output.json"),
    JSON.stringify({ privateMarkerAbsent: !mainOutput.includes(marker), stdoutStderr: mainOutput }),
  );
} finally {
  if (application) {
    await application
      .evaluate(() => {
        const child = process.getBuiltinModule("node:child_process");
        if (globalThis.__diagnosticOriginalSpawn)
          child.spawn = globalThis.__diagnosticOriginalSpawn;
      })
      .catch(() => {});
    if (originalWrite)
      await application
        .evaluate(async () => {
          const fs = process.getBuiltinModule("node:fs");
          fs.writeSync = globalThis.__diagnosticOriginalWrite;
        })
        .catch(() => {});
    await application.close();
  }
}
