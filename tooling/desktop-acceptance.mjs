import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { _electron, expect } from "@playwright/test";
import { admittedLaunch } from "./desktop-launch.mjs";
import { recordReadyNativeProcesses } from "./desktop-native-observation.mjs";
import { verifyStableSentinels, readBoundedFile } from "../packages/main/dist/index.js";
import { message, portLimits, policyId } from "../packages/contracts/dist/index.js";

const [profileFile, prepared, output, fixtureMode] = process.argv.slice(2);
if (fixtureMode && fixtureMode !== "--rejected-locator")
  throw new Error("Unknown acceptance fixture mode.");
if (!profileFile || !prepared || !output)
  throw new Error(
    "Use desktop:test <absolute-profile.json> <absolute-prepared-runtime> <new-absolute-evidence-directory>.",
  );
const launch = admittedLaunch(profileFile, prepared);
if (
  !path.isAbsolute(output) ||
  !output.startsWith(launch.profile.scratch_root + path.sep) ||
  fs.existsSync(output)
)
  throw new Error("Use a new evidence directory inside the admitted scratch root.");
fs.mkdirSync(output);
const locatorFile = path.join(
  launch.profile.configuration_root,
  "Ohtia/settings/data-location.json",
);
let ownedLocator;
if (fixtureMode) {
  if (fs.existsSync(locatorFile))
    throw new Error(
      "The rejected-locator fixture requires an absent locator; existing records are preserved.",
    );
  const rejected = path.join(launch.profile.scratch_root, "Rejected location ñ 연구");
  fs.mkdirSync(rejected, { recursive: true });
  ownedLocator = JSON.stringify({ version: 1, data_directory: rejected });
  fs.mkdirSync(path.dirname(locatorFile), { recursive: true });
  fs.writeFileSync(locatorFile, ownedLocator, { flag: "wx", mode: 0o600 });
}
const receipt = {
  version: 1,
  host: { platform: process.platform, architecture: os.arch(), release: os.release() },
  artifact: createHash("sha256")
    .update(fs.readFileSync(path.join(prepared, "prepared.json")))
    .digest("hex"),
  fixture: fixtureMode ?? "missing-locator",
  cases: [],
  limitations: [
    "Native process/sandbox and complete-tree observations require separate records.",
    "Portable catalogs do not establish human linguistic or assistive acceptance.",
  ],
};
let application;
function passed(id, observed) {
  receipt.cases.push({ id, result: "pass", observed });
  fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
}
let controlledFatalNotice = false;
try {
  application = await _electron.launch({
    chromiumSandbox: true,
    bypassCSP: false,
    colorScheme: null,
    artifactsDir: output,
    executablePath: launch.executable,
    args: [launch.app, ...launch.args],
    env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    timeout: 20000,
  });
  const page = await application.firstWindow();
  await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok, {
      timeout: portLimits.service_start_ms,
    })
    .toBe(true);
  await recordReadyNativeProcesses(application, output);
  const initial = await page.evaluate(async () => ({
    snapshot: await window.ohtia.bootstrap.read(),
    status: await window.ohtia.foundation.readStatus().result,
    node: typeof window.process,
    require: typeof window.require,
    bridge: Object.keys(window.ohtia),
  }));
  expect(initial.node).toBe("undefined");
  expect(initial.require).toBe("undefined");
  expect(initial.bridge.sort()).toEqual(["bootstrap", "foundation"]);
  expect(initial.status).toMatchObject({
    ok: true,
    value: { service: "ready", engine: "unavailable", interfaceLocale: initial.snapshot.locale },
  });
  expect(await page.locator("html").getAttribute("lang")).toBe(initial.snapshot.locale);
  expect(initial.snapshot.state).toBe(fixtureMode ? "path_rejected" : "pending_create");
  passed("real-status-ipc", initial);
  passed(
    "native-executable-identities",
    await application.evaluate(() => ({
      platform: process.platform,
      architecture: process.arch,
      argv: process.argv,
      execArgv: process.execArgv,
    })),
  );
  const brokerRefusals = await application.evaluate(
    ({ BrowserWindow, ipcMain }, { policy, bytes }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const sender = window.webContents;
      const senderFrame = sender.mainFrame;
      const event = { sender, senderFrame, returnValue: undefined };
      ipcMain.emit("ohtia:session", event);
      const generations = event.returnValue;
      if (!generations) throw new Error("Native broker session was not admitted.");
      const request = {
        protocol: 1,
        policy,
        kind: "request",
        requestId: "native-spoofed-request",
        operationId: "native-spoofed-operation",
        ...generations,
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
        JSON.stringify({
          ...request,
          operation: "unregistered.operation",
        }),
      );
      return {
        injectedAtActualBroker: true,
        malformedBytes: bytes,
        ...Object.fromEntries(
          Object.entries(globalThis.__ohtiaAcceptance()).map(([key, count]) => [
            key,
            count - before[key],
          ]),
        ),
        spoofedFrame: true,
        limits:
          "Synthetic main-process events exercise broker guards; renderer has no raw IPC authority.",
      };
    },
    { policy: policyId, bytes: portLimits.message_bytes + 1 },
  );
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok)
    .toBe(true);
  expect(brokerRefusals).toMatchObject({
    received: 3,
    rejectedFrame: 1,
    rejectedEnvelope: 2,
    dispatched: 0,
  });
  passed("real-broker-rejects-invalid-and-spoofed-ipc", brokerRefusals);
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => {
      const { sandbox, contextIsolation, nodeIntegration, webSecurity } =
        window.webContents.getLastWebPreferences();
      return { sandbox, contextIsolation, nodeIntegration, webSecurity };
    }),
  );
  expect(
    preferences.every(
      (value) =>
        value.sandbox && value.contextIsolation && !value.nodeIntegration && value.webSecurity,
    ),
  ).toBe(true);
  passed("renderer-preferences", preferences);
  const csp = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      violations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        disposition: event.disposition,
      }),
    );
    window.__injected = false;
    const script = document.createElement("script");
    script.textContent = "window.__injected=true";
    document.head.append(script);
    await fetch("https://example.invalid/ohtia-csp-test").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { violations, injected: window.__injected };
  });
  expect(csp.injected).toBe(false);
  for (const directive of ["script-src-elem", "connect-src"])
    expect(
      csp.violations.some((item) => item.directive === directive && item.disposition === "enforce"),
    ).toBe(true);
  passed("packaged-csp", csp);
  const denied = await page.evaluate(async () =>
    Promise.all(
      [
        "file:///etc/passwd",
        "ohtia://app/../package.json",
        "ohtia://app/index.html?fixture=1",
        "ohtia://foreign/index.html",
      ].map(async (url) => {
        try {
          return !(await fetch(url)).ok;
        } catch {
          return true;
        }
      }),
    ),
  );
  expect(denied.every(Boolean)).toBe(true);
  passed("resources-denied", denied);
  await application.evaluate(({ BrowserWindow }) => {
    globalThis.__ohtiaNavigation = [];
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    for (const name of [
      "will-navigate",
      "will-frame-navigate",
      "did-start-navigation",
      "did-navigate",
      "did-fail-load",
      "render-process-gone",
    ])
      contents.on(name, (...args) => {
        globalThis.__ohtiaNavigation.push({
          name,
          details: args.filter(
            (value) =>
              typeof value === "string" || typeof value === "number" || typeof value === "boolean",
          ),
        });
      });
  });
  const original = page.url();
  await page.evaluate(() => {
    window.open("https://example.invalid");
    const link = document.createElement("a");
    link.href = "https://example.invalid";
    document.body.append(link);
    link.click();
    link.remove();
  });
  receipt.cases.push({
    id: "navigation-observation",
    result: "observed",
    observed: await application.evaluate(({ BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        loading: window.webContents.isLoadingMainFrame(),
      })),
      events: globalThis.__ohtiaNavigation,
    })),
  });
  // A prevented custom-protocol navigation can leave Chromium's load signal pending.
  // Check both actual locations and the live port instead of waiting for a nonexistent commit.
  expect(await page.evaluate(() => window.location.href)).toBe(original);
  expect(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getURL(),
    ),
  ).toBe(original);
  expect((await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok).toBe(true);
  expect(application.windows()).toHaveLength(1);
  passed("navigation-denied");
  // Start the independent accessibility phase in a fresh admitted document generation.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok)
    .toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  const reflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(reflow.document).toBeLessThanOrEqual(reflow.viewport);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.tagName)).toBe("BUTTON");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const nativeTree = await cdp.send("Accessibility.getFullAXTree");
  for (const role of ["button", "heading"])
    expect(nativeTree.nodes.some((node) => node.role?.value === role && !node.ignored)).toBe(true);
  fs.writeFileSync(
    path.join(output, "packaged-accessibility.json"),
    JSON.stringify(nativeTree, null, 2),
  );
  const tree = await page.locator("body").ariaSnapshot();
  expect(tree).toContain("button");
  expect(tree).toContain("heading");
  passed("keyboard-reflow-accessibility-tree", { reflow, tree });
  const captureStarted = performance.now();
  try {
    await page.screenshot({
      path: path.join(output, "foundation-320.png"),
      fullPage: true,
      timeout: 30000,
    });
    passed("graphical-capture", { elapsed_ms: Math.round(performance.now() - captureStarted) });
  } catch (error) {
    receipt.cases.push({
      id: "graphical-capture",
      result: "fail",
      elapsed_ms: Math.round(performance.now() - captureStarted),
      controlledMessage: error instanceof Error ? error.message.slice(0, 1024) : "Capture failed",
    });
    process.exitCode = 1;
  }
  await page.evaluate(() => {
    const fixture = document.createElement("p");
    fixture.id = "glyph-fixture";
    fixture.lang = "ko";
    fixture.textContent = "연구 자료의 출처와 근거를 확인하세요.";
    document.querySelector("main").append(fixture);
  });
  await page.evaluate(() => document.fonts.ready);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#glyph-fixture",
  });
  const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(
    fonts.fonts.some(
      (font) =>
        font.isCustomFont &&
        /(?:plex.*kr|noto.*kr)/i.test(font.familyName + font.postScriptName) &&
        font.glyphCount >= 16,
    ),
  ).toBe(true);
  passed("packaged-korean-glyphs", fonts);
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode())
      if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.textContent;
      node.textContent = "[" + text + "à".repeat(Math.ceil([...text].length * 0.4)) + "]";
    }
    document.documentElement.style.fontSize = "200%";
    document.body.style.lineHeight = "1.5";
    document.body.style.letterSpacing = "0.12em";
    document.body.style.wordSpacing = "0.16em";
    for (const paragraph of document.querySelectorAll("p")) paragraph.style.marginBottom = "2em";
  });
  const expandedReflow = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(expandedReflow.document).toBeLessThanOrEqual(expandedReflow.viewport);
  passed("pseudolocalization-spacing-zoom-reflow", expandedReflow);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () =>
        matchMedia("(forced-colors: active)").matches &&
        matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(output, "foundation-expanded-forced-colors.png"),
    fullPage: true,
    timeout: 5000,
  });
  passed("forced-colors-reduced-motion");
  await cdp.detach();
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
  expect(launch.profile.research_root).toBe(path.join(launch.profile.home, "ohtia"));
  expect(await page.evaluate(() => Object.keys(window.ohtia.bootstrap).sort())).toEqual([
    "exit",
    "newWindow",
    "openStorage",
    "read",
    "restoreCheckpoint",
    "retryService",
  ]);
  expect(fs.existsSync(path.join(launch.profile.research_root, "ohtia.db3"))).toBe(false);
  if (ownedLocator) expect(fs.readFileSync(locatorFile, "utf8")).toBe(ownedLocator);
  else expect(fs.existsSync(locatorFile)).toBe(false);
  passed("fixed-native-home-data-root-without-selector");
  if (fixtureMode) {
    const retry = page
      .getByRole("button", {
        name: message(initial.snapshot.locale, "retry"),
        exact: true,
      })
      .last();
    for (let repeat = 0; repeat < 2; repeat++) {
      await retry.click();
      await expect(page.locator("#location-state")).toBeFocused();
      expect((await page.evaluate(() => window.ohtia.bootstrap.read())).state).toBe(
        "path_rejected",
      );
    }
    passed("repeated-locator-error-focus-and-preserved-record");
  }
  await page.evaluate(() => window.ohtia.bootstrap.newWindow());
  await expect.poll(() => application.windows().length).toBe(2);
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
  const matchingUtilities = metrics.filter(
    (metric) => metric.type === "Utility" && metric.name === "Ohtia data service",
  );
  receipt.cases.push({ id: "native-process-metrics", result: "observed", observed: metrics });
  expect(matchingUtilities).toHaveLength(1);
  const utility = matchingUtilities[0];
  expect(utility).toBeDefined();
  passed(
    "two-windows-one-utility",
    metrics.map(({ pid, type, name, serviceName }) => ({ pid, type, name, serviceName })),
  );
  const second = spawn(launch.executable, [launch.app, ...launch.args], {
    env: launch.env,
    cwd: launch.profile.scratch_root,
    stdio: "ignore",
  });
  const secondExit = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      second.kill("SIGKILL");
      reject(new Error("Second launch did not exit within the application startup budget."));
    }, 15000);
    second.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    second.once("exit", (code) => {
      clearTimeout(deadline);
      resolve(code);
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 750));
  expect(
    await application.evaluate(
      ({ app }) =>
        app
          .getAppMetrics()
          .filter((metric) => metric.type === "Utility" && metric.name === "Ohtia data service")
          .length,
    ),
  ).toBe(1);
  expect(await secondExit).toBe(0);
  passed("second-launch-one-service", {
    completeNativeBrokerCount: "requires independent observation",
  });
  process.kill(utility.pid, "SIGKILL");
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok)
    .toBe(false);
  expect((await page.evaluate(() => window.ohtia.bootstrap.read())).state).toBe(
    fixtureMode ? "path_rejected" : "pending_create",
  );
  passed("utility-crash-responsive");
  await page.evaluate(() => window.ohtia.bootstrap.retryService()).catch(() => {});
  await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok)
    .toBe(true);
  expect((await page.evaluate(() => window.ohtia.bootstrap.read())).state).toBe(
    fixtureMode ? "path_rejected" : "pending_create",
  );
  passed("explicit-retry-preserves-fixed-root-state");
  if (fixtureMode) {
    await application.evaluate(({ app, dialog }, maximum) => {
      const metrics = app.getAppMetrics.bind(app);
      const originalDialog = dialog.showMessageBox;
      const probe = {
        observed: undefined,
        release: undefined,
        restore: () => {
          app.getAppMetrics = metrics;
          dialog.showMessageBox = originalDialog;
        },
      };
      globalThis.__ohtiaFatalProbe = probe;
      dialog.showMessageBox = (parent, options) =>
        new Promise((resolve) => {
          probe.observed = { message: options.message, visibleParent: parent.isVisible() };
          probe.release = () => {
            app.getAppMetrics = metrics;
            dialog.showMessageBox = originalDialog;
            resolve({ response: 0, checkboxChecked: false });
          };
        });
      app.getAppMetrics = () => Array(maximum + 1).fill(metrics()[0]);
    }, portLimits.process_tree_count);
    controlledFatalNotice = true;
    await expect
      .poll(() => application.evaluate(() => !!globalThis.__ohtiaFatalProbe.observed))
      .toBe(true);
    await page.waitForTimeout(350);
    await expect
      .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok)
      .toBe(true);
    const fatalNotice = await application.evaluate(() => globalThis.__ohtiaFatalProbe.observed);
    expect(fatalNotice).toEqual({
      message: message(initial.snapshot.locale, "resource_failure"),
      visibleParent: true,
    });
    passed("fatal-notice-awaits-acknowledgement-with-responsive-ipc", {
      ...fatalNotice,
      injected:
        "resource-count and native-dialog test peers; no real excess or OS-dialog acceptance claim",
    });
  }
} catch (error) {
  receipt.cases.push({
    id: "acceptance-failure",
    result: "fail",
    controlledMessage: error instanceof Error ? error.message.slice(0, 1024) : "Acceptance failed",
  });
  process.exitCode = 1;
} finally {
  const started = performance.now();
  let clean = false;
  try {
    if (application) {
      if (controlledFatalNotice) {
        const closed = application.waitForEvent("close", {
          timeout: portLimits.shutdown_total_ms + 1000,
        });
        await application
          .evaluate(() => {
            globalThis.__ohtiaFatalProbe.release?.();
          })
          .catch(() => {});
        await closed;
      } else {
        // Page.close can leave a native window alive. Await each extra native closure
        // so the final close reaches the product's last-window shutdown handler.
        const remaining = await application.evaluate(async ({ BrowserWindow }, budget) => {
          const deadline = Date.now() + budget;
          for (const window of BrowserWindow.getAllWindows().slice(1)) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  reject(
                    new Error("Extra native window did not close within the shutdown budget."),
                  ),
                Math.max(1, deadline - Date.now()),
              );
              window.once("closed", () => {
                clearTimeout(timer);
                resolve();
              });
              window.close();
            });
          }
          return BrowserWindow.getAllWindows().length;
        }, portLimits.shutdown_total_ms);
        expect(remaining).toBe(1);
        const closed = application.waitForEvent("close", {
          timeout: portLimits.shutdown_total_ms + 1000,
        });
        await application
          .evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0]?.close();
          })
          .catch(() => {});
        await closed;
      }
      clean = performance.now() - started <= portLimits.shutdown_total_ms;
    }
  } catch (error) {
    receipt.cases.push({
      id: "shutdown-observation-failure",
      result: "fail",
      controlledMessage:
        error instanceof Error ? error.message.slice(0, 1024) : "Shutdown observation failed",
    });
    if (application) {
      await application
        .evaluate(() => {
          globalThis.__ohtiaFatalProbe?.restore?.();
          globalThis.__ohtiaFatalProbe?.release?.();
        })
        .catch(() => {});
      try {
        let timer;
        try {
          await Promise.race([
            application.close(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Cleanup timed out")),
                portLimits.shutdown_total_ms,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        application.process().kill("SIGKILL");
      }
    }
  }
  receipt.shutdown = {
    elapsed_ms: performance.now() - started,
    entry: controlledFatalNotice ? "acknowledged-fatal-quit" : "ordinary-last-window-close",
    completeTreeExit: "requires native observation",
  };
  receipt.cases.push({ id: "bounded-shutdown", result: clean ? "pass" : "fail" });
  if (!clean) process.exitCode = 1;
  let stable = false;
  try {
    verifyStableSentinels(launch.profile);
    stable = true;
  } catch {
    receipt.cases.push({ id: "stable-fixture-after-run", result: "fail" });
    process.exitCode = 1;
  }
  if (ownedLocator && stable) {
    try {
      expect(readBoundedFile(locatorFile).toString("utf8")).toBe(ownedLocator);
      fs.writeFileSync(path.join(output, "rejected-locator-preserved.json"), ownedLocator);
      fs.unlinkSync(locatorFile);
    } catch {
      receipt.cases.push({ id: "owned-locator-cleanup", result: "fail" });
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
}
