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
import { invokeNativeMenu } from "./command-acceptance.mjs";
import { focusNative, withCommandCleanup } from "./command-native-focus.mjs";
import { setNativeViewport } from "./design-viewport.mjs";
import { verifyDiagnosticBundle } from "./diagnostic-bundle-acceptance.mjs";
import {
  decodeDiagnosticLine,
  diagnosticLimits,
  message,
} from "../packages/contracts/dist/index.js";
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
    "Bundle publication uses a controlled save-picker reply; native chooser interaction is separate.",
  ],
};
const saveReceipt = () =>
  fs.writeFileSync(
    path.join(output, "diagnostic-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
async function verifySettingsViewer(application, page, locale, activeRecord, directory, marker) {
  const archive = path.join(directory, "ohtia.1.jsonl");
  const saved = path.join(directory, ".viewer-archive-fixture-backup");
  assert.ok(!fs.existsSync(saved));
  const hadArchive = fs.existsSync(archive);
  if (hadArchive) fs.renameSync(archive, saved);
  const text = (key, values = {}) => message(locale, key, values);
  const read = (slot) => page.evaluate((slot) => window.ohtia.diagnostics.readPage({ slot }), slot);
  const encode = (record) => JSON.stringify(record) + "\n";
  const times = Array.from({ length: 65 }, (_, index) =>
    new Date(Date.UTC(2000, 0, 1, 0, 0, index)).toISOString(),
  );
  const valid = times.map((timestamp) => encode({ ...activeRecord, timestamp })).join("");
  const privateLine = encode({ ...activeRecord, message: marker });
  const unsupported = encode({ schema_version: 2, message: marker });
  const oversized = marker.padEnd(diagnosticLimits.recordBytes + 1, "x") + "\n";
  const dialog = page.getByRole("dialog", { name: text("settings.title"), exact: true });
  try {
    fs.writeFileSync(archive, valid + privateLine + unsupported + oversized, {
      mode: 0o600,
      flag: "wx",
    });
    const first = await read(1);
    assert.equal(first.status, "ready");
    assert.equal(
      first.entries.length + first.invalid + first.unsupported,
      diagnosticLimits.readRecords,
    );
    assert.deepEqual([first.invalid, first.unsupported], [2, 1]);
    const firstPageTimes = times.slice(-first.entries.length).reverse();
    assert.deepEqual(
      first.entries.map(({ time }) => time),
      firstPageTimes,
    );
    assert.ok(first.continuation);
    assert.ok(!JSON.stringify(first).includes(marker));
    assert.ok(!JSON.stringify(first).includes(directory));
    assert.deepEqual(Object.keys(first.entries[0]).sort(), ["event", "severity", "time"]);
    assert.equal((await read(4)).status, "ready");

    const window = await application.browserWindow(page);
    await focusNative(window, "diagnostic Settings viewer");
    await invokeNativeMenu(application, "settings.open");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".diagnostics-panel")).toHaveCount(0);
    const category = dialog.getByRole("button", { name: text("diagnostics.title"), exact: true });
    await category.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();
    const source = dialog.getByRole("combobox", { name: text("diagnostics.file"), exact: true });
    const refresh = dialog.getByRole("button", { name: text("diagnostics.refresh"), exact: true });
    await expect(source).toHaveValue("0");
    await source.focus();
    await page.keyboard.press("Tab");
    await expect(refresh).toBeFocused();
    const log = dialog.getByRole("list", { name: text("diagnostics.events"), exact: true });
    await expect(log.locator("time").first()).toHaveText(/Z$/);
    await expect(log.locator("code").first()).toHaveText(/^ohtia\./);

    await source.selectOption("1");
    await expect(log.locator("time")).toHaveText(firstPageTimes);
    await expect(dialog.getByText(text("diagnostics.invalid", { count: 2 }))).toBeVisible();
    await expect(dialog.getByText(text("diagnostics.unsupported", { count: 1 }))).toBeVisible();
    await expect(dialog).not.toContainText(marker);
    const next = dialog.getByRole("button", { name: text("diagnostics.next"), exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText(text("diagnostics.page", { page: 2 }))).toBeVisible();
    await expect(log.locator("time")).toHaveText(times.slice(0, 4).reverse());
    await source.selectOption("0");
    await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();
    await source.selectOption("1");
    await expect(log.locator("li")).toHaveCount(first.entries.length);
    fs.unlinkSync(archive);
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText(text("diagnostics.stale"))).toBeVisible();
    await expect(refresh).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(source).toHaveValue("1");
    await expect(dialog.getByText(text("diagnostics.empty"))).toBeVisible();
    await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();

    await source.selectOption("0");
    await expect(log.locator("time").first()).toBeVisible();
    const original = await window.evaluate((window) => {
      const [width, height] = window.getContentSize();
      return {
        width,
        height,
        zoomFactor: window.webContents.getZoomFactor(),
        maximized: window.isMaximized(),
      };
    });
    await withCommandCleanup(
      async () => {
        const viewport = await setNativeViewport(page, window, {
          width: 1280,
          height: 800,
          zoomFactor: 4,
        });
        assert.equal(viewport.viewportWidth, 320);
        for (const media of [
          { colorScheme: "light", forcedColors: "none" },
          { colorScheme: "dark", forcedColors: "none" },
          { colorScheme: "dark", forcedColors: "active" },
        ]) {
          await page.emulateMedia(media);
          await expect(source).toBeVisible();
          await expect(log.locator("time").first()).toBeVisible();
          assert.equal(
            await dialog
              .locator(".settings-content")
              .evaluate((element) => element.scrollWidth <= element.clientWidth),
            true,
          );
        }
      },
      async () => {
        await page.emulateMedia({ colorScheme: null, forcedColors: null });
        await setNativeViewport(page, window, original);
        if (original.maximized) await window.evaluate((window) => window.maximize());
      },
    );

    fs.mkdirSync(archive, { mode: 0o700 });
    await source.selectOption("1");
    await expect(dialog.getByText(text("diagnostics.unavailable"))).toBeVisible();
    assert.deepEqual(await read(1), { status: "unavailable" });
    fs.rmdirSync(archive);
  } finally {
    if (fs.existsSync(archive)) {
      if (fs.lstatSync(archive).isDirectory()) fs.rmdirSync(archive);
      else fs.unlinkSync(archive);
    }
    if (hadArchive) fs.renameSync(saved, archive);
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
  }
}

async function verifySettingsDeletion(application, page, locale, activeRecord, directory) {
  const active = path.join(directory, "ohtia.jsonl");
  const archive = path.join(directory, "ohtia.1.jsonl");
  const unrelated = path.join(directory, "diagnostics-note.txt");
  fs.writeFileSync(unrelated, "synthetic unrelated file", { flag: "wx", mode: 0o600 });
  const store = await page.evaluate(async () => {
    const port = window.ohtia.foundation;
    const appearance = await port.readAppearance().result;
    const created = await port.createProject(crypto.randomUUID()).result;
    if (!appearance.ok || !created.ok) throw new Error("Could not read the synthetic store.");
    const operationId = crypto.randomUUID();
    const saved = await port.replaceAppearance({
      operationId,
      expectedRevision: appearance.value.revision,
      value: appearance.value.value === "dark" ? "light" : "dark",
    }).result;
    if (!saved.ok) throw new Error("Could not create a synthetic receipt.");
    return { operationId, projectId: created.value.resultId };
  });
  const readStore = () =>
    page.evaluate(async ({ operationId, projectId }) => {
      const port = window.ohtia.foundation;
      const projects = await port.listProjects({ cursor: null, count: 10 }).result;
      const project = projects.ok ? projects.value.items.find(({ id }) => id === projectId) : null;
      const receipt = await port.readAppearanceReceipt(operationId).result;
      if (!project || !receipt.ok) throw new Error("Could not read the synthetic records.");
      // The workspace can reopen the project and update its navigation timestamp.
      const { lastOpenedAt, ...record } = project;
      return { project: record, receipt };
    }, store);
  const before = await readStore();
  const text = (key, values = {}) => message(locale, key, values);
  const dialog = page.getByRole("dialog", { name: text("settings.title"), exact: true });
  const trigger = dialog
    .getByRole("button", { name: text("diagnostics.delete"), exact: true })
    .first();
  const group = dialog.getByRole("group", { name: text("diagnostics.delete"), exact: true });
  const cancel = group.getByRole("button", { name: text("checkpoint_cancel"), exact: true });
  const confirm = group.getByRole("button", { name: text("diagnostics.delete"), exact: true });
  const source = dialog.getByRole("combobox", { name: text("diagnostics.file"), exact: true });
  const refresh = dialog.getByRole("button", { name: text("diagnostics.refresh"), exact: true });
  const count = (count) =>
    dialog.getByText(text("diagnostics.deleteCount", { count }), { exact: true });
  const window = await application.browserWindow(page);
  await focusNative(window, "diagnostic deletion");
  await invokeNativeMenu(application, "settings.open");
  await dialog.getByRole("button", { name: text("diagnostics.title"), exact: true }).press("Enter");
  await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();

  const original = await window.evaluate((window) => {
    const [width, height] = window.getContentSize();
    return {
      width,
      height,
      zoomFactor: window.webContents.getZoomFactor(),
      maximized: window.isMaximized(),
    };
  });
  await withCommandCleanup(
    async () => {
      const viewport = await setNativeViewport(page, window, {
        width: 1280,
        height: 800,
        zoomFactor: 4,
      });
      assert.equal(viewport.viewportWidth, 320);
      await expect(dialog.locator(".settings-back")).toBeVisible();
      await trigger.press("Enter");
      await expect(cancel).toBeFocused();
      await expect(group).toContainText(text("diagnostics.deleteScope"));
      const html = page.locator("html");
      const appearance = await html.getAttribute("data-appearance");
      try {
        for (const [theme, forcedColors] of [
          ["light", "none"],
          ["dark", "none"],
          ["dark", "active"],
        ]) {
          // Exercise the authored theme selectors with the engine's forced-color mode.
          await html.evaluate((root, theme) => root.setAttribute("data-appearance", theme), theme);
          await page.emulateMedia({ forcedColors });
          await expect(cancel).toBeVisible();
          await expect(confirm).toBeVisible();
          assert.equal(
            await dialog
              .locator(".settings-content")
              .evaluate((element) => element.scrollWidth <= element.clientWidth),
            true,
          );
        }
      } finally {
        await html.evaluate((root, appearance) => {
          if (appearance === null) root.removeAttribute("data-appearance");
          else root.setAttribute("data-appearance", appearance);
        }, appearance);
      }
      await page.keyboard.press("Tab");
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(group).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(trigger).toBeFocused();
      assert.ok(fs.existsSync(active));
    },
    async () => {
      await page.emulateMedia({ forcedColors: null });
      await setNativeViewport(page, window, original);
      if (original.maximized) await window.evaluate((window) => window.maximize());
    },
  );

  const submit = async () => {
    await trigger.press("Enter");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(group).toHaveCount(0);
    await expect(trigger).toBeFocused();
  };
  await source.selectOption("1");
  await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();
  // A directory under a managed filename is refused after the active file is removed.
  const savedArchive = path.join(directory, "diagnostic-test-archive-backup");
  if (fs.existsSync(archive)) fs.renameSync(archive, savedArchive);
  fs.mkdirSync(archive, { mode: 0o700 });
  try {
    await submit();
    await expect(count(1)).toBeVisible();
    await expect(dialog.getByText(text("diagnostics.deleteResult.incomplete"))).toBeVisible();
    await expect(dialog.getByText(text("diagnostics.unavailable"))).toBeVisible();
    assert.ok(!fs.existsSync(active));
    assert.ok(fs.statSync(archive).isDirectory());
    assert.deepEqual(await readStore(), before);
  } finally {
    fs.rmdirSync(archive);
    if (fs.existsSync(savedArchive)) fs.renameSync(savedArchive, archive);
  }
  await refresh.press("Enter");
  await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();
  const seedArchive = () =>
    fs.writeFileSync(archive, JSON.stringify(activeRecord) + "\n", { mode: 0o600 });
  seedArchive();
  const presentBefore = fs
    .readdirSync(directory)
    .filter((name) => /^ohtia(?:\.[1-4])?\.jsonl$/.test(name)).length;
  await submit();
  await expect(count(presentBefore)).toBeVisible();
  await expect(dialog.getByText(text("diagnostics.empty"))).toBeVisible();
  assert.ok(!fs.existsSync(archive));
  assert.equal(fs.readFileSync(active).length, 0);
  assert.equal(fs.readFileSync(unrelated, "utf8"), "synthetic unrelated file");
  assert.deepEqual(await readStore(), before);

  await source.selectOption("0");
  await expect(dialog.getByText(text("diagnostics.page", { page: 1 }))).toBeVisible();
  seedArchive();
  const releaseReply = await application.evaluateHandle(({ app }) => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const path = process.getBuiltinModule("node:path");
    const directory = app.getAppPath();
    const require = createRequire(path.join(directory, "package.json"));
    const { DiagnosticWriter } = require(path.join(directory, "diagnostic-writer.js"));
    const original = DiagnosticWriter.prototype.deleteLogs;
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    DiagnosticWriter.prototype.deleteLogs = async function (confirmed) {
      const result = await original.call(this, confirmed);
      await wait;
      return result;
    };
    return () => {
      DiagnosticWriter.prototype.deleteLogs = original;
      release();
    };
  });
  try {
    await submit();
    const uncertain = dialog.getByText(text("diagnostics.deleteResult.uncertain"));
    await expect(uncertain).toBeVisible({ timeout: 15000 });
    assert.ok(!fs.existsSync(archive));
    const appended = await page.evaluate(
      () => window.ohtia.foundation.createProject(crypto.randomUUID()).result,
    );
    assert.equal(appended.ok, true);
    await expect
      .poll(async () => {
        const read = await page.evaluate(() => window.ohtia.diagnostics.readPage({ slot: 0 }));
        return (
          read.status === "ready" &&
          read.entries.some(({ event }) => event === "ohtia.project.created")
        );
      })
      .toBe(true);
    await expect(refresh).toBeEnabled();
    await refresh.press("Enter");
    await expect(dialog.getByText("ohtia.project.created", { exact: true })).toBeVisible();
    await expect(uncertain).toBeVisible();
    assert.equal(fs.readFileSync(unrelated, "utf8"), "synthetic unrelated file");
    assert.deepEqual(await readStore(), before);
  } finally {
    await releaseReply.evaluate((release) => release());
    await releaseReply.dispose();
    fs.unlinkSync(unrelated);
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
  }
}

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
  await expect(page.locator(".workspace-window")).toBeVisible();
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
  const language = await page.evaluate(() => window.ohtia.foundation.readLocale().result);
  assert.equal(language.ok, true);
  const locale = language.value.effectiveLocale;
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await verifySettingsViewer(application, page, locale, logs()[0], logDirectory, marker);
  record("settings-bounded-diagnostic-viewer");
  await verifySettingsDeletion(application, page, locale, logs()[0], logDirectory);
  record("settings-confirmed-diagnostic-deletion");
  await verifyDiagnosticBundle(application, page, locale, logs()[0], logDirectory, marker, output);
  record("settings-reviewed-diagnostic-bundle", { chooser: "controlled_response" });
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
