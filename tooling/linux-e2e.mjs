/* global window, document, fetch, performance, setTimeout */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import {
  descendants,
  sandboxEvidence,
  contentProcesses,
  assertCspReport,
  assertBrowserParity,
  assertArtifactTree,
  shutdownEvidence,
} from "./linux-e2e-core.mjs";
import { chromium, firefox, webkit, _electron, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".reports/linux-e2e");
const config = JSON.parse(fs.readFileSync(path.join(root, "config/desktop/linux-e2e.json")));
const require = createRequire(import.meta.url);
const core = path.dirname(
  require.resolve("playwright-core/package.json", {
    paths: [path.dirname(require.resolve("@playwright/test"))],
  }),
);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function write(name, value) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
}
function parity() {
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, "/ms-playwright");
  assertBrowserParity({
    config,
    metadata: read("/ms-playwright/.docker-info"),
    coreVersion: read(path.join(core, "package.json")).version,
    packageVersion: read(path.join(root, "package.json")).devDependencies["@playwright/test"],
    browsers: read(path.join(core, "browsers.json")).browsers.filter(
      (item) => item.installByDefault,
    ),
    browserRoot: "/ms-playwright",
    executables: [chromium, firefox, webkit].map((engine) => engine.executablePath()),
  });
  for (const key of [
    "MOZ_DISABLE_CONTENT_SANDBOX",
    "WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS",
    "ELECTRON_DISABLE_SANDBOX",
  ])
    assert.ok(!process.env[key], `Sandbox override: ${key}`);
  const recordFile = "/opt/ohtia-image/webkit.json";
  assert.equal(
    createHash("sha256").update(fs.readFileSync(recordFile)).digest("hex"),
    config.webkit_record_sha256,
    "WebKit build receipt differs",
  );
  const record = read(recordFile);
  assert.equal(record.version, 2);
  assert.equal(record.build_method, "canonical-recipe");
  assert.deepEqual(record.stages, ["prepare", "compile", "finalize"]);
  assert.equal(
    record.source_tree,
    read(path.join(root, "config/desktop/linux-e2e-build.json")).source.patched_tree,
  );
  assert.equal(
    createHash("sha256")
      .update(fs.readFileSync("/opt/ohtia-image/compile-receipt.json"))
      .digest("hex"),
    record.compile_receipt_sha256,
  );
  assert.equal(
    record.recipe_sha256,
    createHash("sha256")
      .update(fs.readFileSync(path.join(root, "scripts/linux_e2e_image.py")))
      .digest("hex"),
  );
  assert.equal(
    record.manifest_sha256,
    createHash("sha256")
      .update(fs.readFileSync(path.join(root, "config/desktop/linux-e2e-build.json")))
      .digest("hex"),
  );
  assertArtifactTree("/opt/installed", record.artifacts);
  assert.equal(
    createHash("sha256").update(fs.readFileSync(webkit.executablePath())).digest("hex"),
    record.launcher_sha256,
  );
  write("parity.json", {
    image: config.image,
    webkitBuildRecord: config.webkit_record_sha256,
    playwright: config.playwright,
    browsers: config.browsers,
    developerNode: process.versions,
    target: `${process.platform}-${process.arch}`,
  });
}
function processes() {
  const records = [];
  for (const id of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const status = fs.readFileSync(`/proc/${id}/status`, "utf8");
      const field = (name) => status.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1];
      records.push({
        pid: Number(id),
        parent: Number(field("PPid")),
        name: field("Name"),
        seccomp: Number(field("Seccomp")),
        filters: Number(field("Seccomp_filters")),
        noNewPrivileges: Number(field("NoNewPrivs")),
        namespacePids: field("NSpid")?.split(/\s+/).map(Number) ?? [],
        command: fs.readFileSync(`/proc/${id}/cmdline`, "utf8").split("\0").filter(Boolean),
      });
    } catch {
      /* A process may exit between listing and inspection. */
    }
  }
  return records;
}
async function shard(name, execute) {
  const report = {
    shard: name,
    identity: read(path.join(root, "linux-e2e-input.json")),
    status: "failed",
    preparation: "passed",
    cases: [],
  };
  const passed = (id, observed = {}) => {
    assert.ok(config.shards[name].includes(id), `Undeclared case: ${id}`);
    report.cases.push({ id, status: "passed", attempts: 1, observed });
    write(`${name}.json`, report);
  };
  write(`${name}.json`, report);
  try {
    await execute(passed);
    assert.deepEqual(report.cases.map((item) => item.id).sort(), [...config.shards[name]].sort());
    report.status = "passed";
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    write(`${name}.json`, report);
  }
}
async function browserTests() {
  await shard("browsers", async (passed) => {
    const baseline = processes().find((item) => item.pid === process.pid);
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
      const server = await engine.launchServer({
        headless: false,
        ...(name === "chromium" ? { chromiumSandbox: true } : {}),
        ...(name === "webkit" ? { env: { ...process.env, WEBKIT_FORCE_SANDBOX: "1" } } : {}),
      });
      let stderr = "";
      server.process().stderr?.on("data", (data) => {
        stderr = (stderr + data.toString()).slice(-16384);
      });
      let browser;
      try {
        browser = await engine.connect(server.wsEndpoint());
        const page = await browser.newPage();
        await page.setContent(
          '<label for="input">Synthetic text</label><input id="input"><output aria-live="polite"></output>',
        );
        await page.getByLabel("Synthetic text").fill("Permitted synthetic fixture");
        await expect(page.getByLabel("Synthetic text")).toHaveValue("Permitted synthetic fixture");
        const records = descendants(processes(), server.process().pid);
        write(`processes-${name}.json`, records);
        const observed = sandboxEvidence(contentProcesses(name, records), baseline);
        if (name !== "firefox")
          assert.ok(
            observed.sandboxed.every(
              (item) => item.namespacePids.length > baseline.namespacePids.length,
            ),
            "Content PID namespace isolation is absent",
          );
        passed(`${name}-sandbox`, { version: browser.version(), ...observed });
      } catch (error) {
        write(`diagnostics-${name}.json`, { stderr, error: String(error) });
        throw error;
      } finally {
        if (browser) await browser.close();
        await server.close();
      }
    }
  });
}
async function electronTests(profileFile, prepared) {
  const { admittedLaunch } = await import("./desktop-launch.mjs");
  const { verifyStableSentinels } = await import("../packages/main/dist/index.js");
  const { policyId, portLimits } = await import("../packages/contracts/dist/index.js");
  const launch = admittedLaunch(profileFile, prepared);
  await shard("electron", async (passed) => {
    let app;
    let child;
    try {
      app = await _electron.launch({
        chromiumSandbox: true,
        bypassCSP: false,
        executablePath: launch.executable,
        args: [launch.app, ...launch.args],
        env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1", OHTIA_RUNTIME_DEFER_DOCUMENT: "1" },
        timeout: 20000,
      });
      child = app.process();
      const context = app.context();
      const consoleErrors = [];
      context.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const page = await app.firstWindow();
      const violations = [];
      let cspPhase = "startup";
      await page.exposeBinding("__ohtiaReportCsp", (_source, violation) =>
        violations.push({ ...violation, phase: cspPhase }),
      );
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          void window.__ohtiaReportCsp({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
            disposition: event.disposition,
          });
        });
      });
      await app.evaluate(() => {
        const release = Reflect.get(globalThis, "__ohtiaLoadInitialDocument");
        if (typeof release !== "function")
          throw new Error("Initial document acceptance barrier is absent.");
        release();
      });
      await page.waitForURL("ohtia://app/index.html", { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
      const runtime = await app.evaluate(() => ({
        platform: process.platform,
        architecture: process.arch,
        versions: process.versions,
      }));
      assert.equal(runtime.platform, "linux");
      assert.equal(runtime.architecture, "x64");
      const expected = read(path.join(root, "config/desktop/toolchain.json")).tools.electron;
      assert.equal(runtime.versions.electron, expected.version);
      for (const [key, value] of Object.entries(expected.embedded_runtime_metadata))
        assert.equal(runtime.versions[key], value);
      passed("packaged-startup", runtime);
      const renderer = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
      );
      const records = processes();
      const main = records.find((item) => item.pid === child.pid);
      const rendererProcess = records.find((item) => item.pid === renderer);
      const evidence = sandboxEvidence([rendererProcess], main);
      assert.ok(
        rendererProcess.namespacePids.length > main.namespacePids.length,
        "Renderer PID namespace isolation is absent",
      );
      passed("renderer-os-sandbox", evidence);
      await expect
        .poll(
          async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok,
        )
        .toBe(true);
      const initial = await page.evaluate(async () => ({
        status: await window.ohtia.foundation.readStatus().result,
        node: typeof window.process,
        require: typeof window.require,
      }));
      assert.equal(initial.node, "undefined");
      assert.equal(initial.require, "undefined");
      assert.equal(initial.status.value.service, "ready");
      passed("status-ipc", initial);
      const rejected = await app.evaluate(
        ({ BrowserWindow, ipcMain }, { policy, bytes }) => {
          const sender = BrowserWindow.getAllWindows()[0].webContents;
          const senderFrame = sender.mainFrame;
          const event = { sender, senderFrame, returnValue: undefined };
          ipcMain.emit("ohtia:session", event);
          if (!event.returnValue) throw new Error("Native broker session was not admitted.");
          const request = {
            protocol: 1,
            policy,
            kind: "request",
            requestId: "container-invalid",
            operationId: "container-invalid",
            ...event.returnValue,
            operation: "status.read",
            payload: {},
          };
          const before = globalThis.__ohtiaAcceptance();
          ipcMain.emit(
            "ohtia:foundation",
            { sender, senderFrame: { url: "ohtia://app/index.html" } },
            JSON.stringify(request),
          );
          ipcMain.emit("ohtia:foundation", { sender, senderFrame }, "x".repeat(bytes));
          ipcMain.emit(
            "ohtia:foundation",
            { sender, senderFrame },
            JSON.stringify({ ...request, operation: "unregistered.operation" }),
          );
          return {
            ...Object.fromEntries(
              Object.entries(globalThis.__ohtiaAcceptance()).map(([key, value]) => [
                key,
                value - before[key],
              ]),
            ),
            injectedAtActualBroker: true,
            limits:
              "Synthetic main-process events exercise broker guards; renderer has no raw IPC authority.",
          };
        },
        { policy: policyId, bytes: portLimits.message_bytes + 1 },
      );
      assert.equal(rejected.received, 3);
      assert.equal(rejected.rejectedFrame, 1);
      assert.equal(rejected.rejectedEnvelope, 2);
      assert.equal(rejected.dispatched, 0);
      await expect
        .poll(
          async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok,
        )
        .toBe(true);
      passed("ipc-denials", rejected);
      assert.deepEqual(violations, [], "Unexpected startup/journey CSP violation");
      assert.deepEqual(consoleErrors, [], "Unexpected document errors before the negative case");
      cspPhase = "negative";
      const csp = await page.evaluate(async () => {
        window.__containerInjected = false;
        const script = document.createElement("script");
        script.textContent = "window.__containerInjected=true";
        document.head.append(script);
        await fetch("https://example.invalid/ohtia-csp-test").catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { injected: window.__containerInjected };
      });
      assert.equal(csp.injected, false);
      await expect.poll(() => violations.length).toBe(2);
      assertCspReport(violations);
      cspPhase = "shutdown";
      passed("packaged-csp", { ...csp, violations });
      const children = descendants(processes(), child.pid);
      const started = performance.now();
      const closed = app.waitForEvent("close", { timeout: portLimits.shutdown_total_ms });
      await app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
        .catch(() => {});
      await closed;
      const remaining = () =>
        processes().filter((item) => children.some((known) => known.pid === item.pid));
      try {
        await expect
          .poll(
            () => ({
              remaining: remaining(),
              exited: child.exitCode !== null || child.signalCode !== null,
            }),
            {
              timeout: Math.max(1, portLimits.shutdown_total_ms - (performance.now() - started)),
            },
          )
          .toEqual({ remaining: [], exited: true });
      } finally {
        write("shutdown-processes.json", {
          before: children,
          remaining: remaining(),
          exitCode: child.exitCode,
          signalCode: child.signalCode,
        });
      }
      const elapsed = performance.now() - started;
      const shutdown = shutdownEvidence({
        elapsedMs: elapsed,
        limitMs: portLimits.shutdown_total_ms,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        remaining: remaining(),
      });
      assertCspReport(violations);
      passed("bounded-shutdown", shutdown);
      app = undefined;
    } finally {
      if (app) await app.close().catch(() => child?.kill("SIGKILL"));
      verifyStableSentinels(launch.profile);
    }
  });
}
parity();
if (process.argv[2] === "test") {
  for (const execute of [browserTests, () => electronTests(process.argv[3], process.argv[4])]) {
    try {
      await execute();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
} else assert.equal(process.argv[2], "parity");
