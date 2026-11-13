import { refuseDevelopmentCommand } from "./quality-startup-refusal.mjs";
// Open the ordinary installed and development modes, which run without a qualification profile.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron, expect } from "@playwright/test";
import {
  developmentLaunch,
  nativeEnvironment,
  shortTemporaryDirectory,
  verifyPrepared,
} from "./desktop-launch.mjs";
import { developmentInstanceRunning } from "./development-instance.mjs";
import { setNativeViewport } from "./design-viewport.mjs";
import { withCommandCleanup } from "./command-native-focus.mjs";
import { openWorkspaceSettings } from "./command-workspace.mjs";
import { recordReadyNativeProcesses } from "./desktop-native-observation.mjs";
import {
  loadRuntimeProfile,
  verifyStableSentinels,
  windowPlacement,
} from "../packages/main/dist/index.js";
import { message, portLimits, windowTokens } from "../packages/contracts/dist/index.js";

const DEVELOPMENT_ONLY = "--development-only";
const developmentOnly = process.argv[2] === DEVELOPMENT_ONLY;
const [profileFile, prepared, output, development, ...unexpected] = process.argv.slice(
  developmentOnly ? 3 : 2,
);
// The development-only selection serves unpackaged runtimes, which cannot open the installed mode.
if (!profileFile || !prepared || !output || unexpected.length || (developmentOnly && !development))
  throw new Error(
    `Use startup-acceptance.mjs <profile> <prepared> <new-evidence> [<dev-runtime>], or ${DEVELOPMENT_ONLY} <profile> <prepared> <new-evidence> <dev-runtime>.`,
  );
// The profile identifies this disposable fixture account. The application never receives it.
const profile = loadRuntimeProfile(profileFile);
verifyStableSentinels(profile);
if (!path.isAbsolute(output) || !output.startsWith(profile.scratch_root + path.sep))
  throw new Error("Evidence must stay inside the fixture scratch root.");
if (fs.existsSync(output)) throw new Error("A new evidence directory is required.");
fs.mkdirSync(output);
const installedRuntime = verifyPrepared(prepared, profile.target);
const receipt = {
  version: 1,
  artifact: createHash("sha256")
    .update(fs.readFileSync(path.join(prepared, "prepared.json")))
    .digest("hex"),
  cases: [],
  limitations: [
    "Development cases use synthetic roots, not a checkout's .ohtia-dev directory.",
    ...(developmentOnly
      ? ["Installed-mode cases need packaged bytes and were not run on this unpackaged runtime."]
      : []),
  ],
};
function record(id, observed) {
  receipt.cases.push({ id, result: "pass", observed });
  fs.writeFileSync(path.join(output, "startup-receipt.json"), JSON.stringify(receipt, null, 2));
}
const applicationRoot = path.join(profile.configuration_root, "Ohtia");
/** Windows keeps handles open briefly after a process exits, so a rename can be refused at first. */
async function renameWhenReleased(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      if (attempt === 50 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await delay(200);
    }
  }
}
async function retain(label) {
  const retained = path.join(profile.scratch_root, `startup-${label}-${randomUUID()}`);
  fs.mkdirSync(retained, { mode: 0o700 });
  for (const [source, name] of [
    [profile.research_root, "data"],
    [applicationRoot, "configuration"],
  ])
    if (fs.existsSync(source)) await renameWhenReleased(source, path.join(retained, name));
}
function inventory() {
  const rows = {};
  for (const base of [profile.research_root, applicationRoot])
    if (fs.existsSync(base))
      for (const name of fs.readdirSync(base, { recursive: true })) {
        const file = path.join(base, name);
        const stat = fs.lstatSync(file);
        rows[file] = `${stat.mode}:${stat.size}:${stat.mtimeMs}`;
      }
  return rows;
}
const open = new Set();
async function start(runtime, env) {
  const application = await _electron.launch({
    executablePath: runtime.executable,
    args: [runtime.app, ...runtime.args],
    env: { ...env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    chromiumSandbox: true,
    bypassCSP: false,
    // Observe the native theme without Playwright's default light emulation.
    colorScheme: null,
    timeout: 20000,
    artifactsDir: output,
  });
  open.add(application);
  const page = await application.firstWindow();
  await expect(page.locator(".workspace-window")).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok, {
      timeout: portLimits.service_start_ms,
    })
    .toBe(true);
  return { application, page };
}
async function stop(application) {
  const pid = application.process().pid;
  await application.close();
  open.delete(application);
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
}
async function openStorage(page) {
  const { locale } = await page.evaluate(() => window.ohtia.bootstrap.read());
  await page.getByRole("button", { name: message(locale, "open_storage"), exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: portLimits.application_start_ms,
    })
    .toBe("storage_ready");
  return locale;
}
async function readSavedAppearance(page) {
  await expect
    .poll(
      async () => (await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).ok,
      {
        timeout: portLimits.service_start_ms,
      },
    )
    .toBe(true);
  return page.evaluate(() => window.ohtia.foundation.readAppearance().result);
}
async function saveAppearance(page, locale) {
  const text = (key) => message(locale, key);
  await openWorkspaceSettings(page);
  const dialog = page.getByRole("dialog", { name: text("settings.title"), exact: true });
  const control = dialog.getByRole("radio", { name: text("command.theme.dark"), exact: true });
  await expect(control).toBeEnabled();
  await control.check();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).value?.value,
    )
    .toBe("dark");
  const darkPage = windowTokens.dark["surface.page"];
  const red = Number.parseInt(darkPage.slice(1, 3), 16);
  const green = Number.parseInt(darkPage.slice(3, 5), 16);
  const blue = Number.parseInt(darkPage.slice(5, 7), 16);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        background: getComputedStyle(document.documentElement).backgroundColor,
        dark: matchMedia("(prefers-color-scheme: dark)").matches,
      })),
    )
    .toEqual({ background: `rgb(${red}, ${green}, ${blue})`, dark: true });
  await dialog.getByRole("button", { name: text("dialog.close"), exact: true }).click();
}
async function boundaries(application, page) {
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const value = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: value.sandbox,
      contextIsolation: value.contextIsolation,
      nodeIntegration: value.nodeIntegration,
    };
  });
  expect(preferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  const violation = await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.addEventListener(
          "securitypolicyviolation",
          (event) => resolve(event.effectiveDirective),
          { once: true },
        );
        void fetch("https://example.invalid/ohtia-startup").catch(() => {});
      }),
  );
  expect(violation).toBe("connect-src");
  return { preferences, violation };
}
async function installedCases() {
  const scratch = shortTemporaryDirectory("ohtia-st-");
  try {
    await installedJourney(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
async function installedJourney(scratch) {
  const env = nativeEnvironment({
    home: profile.home,
    username: profile.username,
    configurationRoot: profile.configuration_root,
    scratch,
  });
  // Execute the packaged startup admission itself, before any single-instance owner can hide it.
  const beforeRefusal = inventory();
  const refusal = await refuseDevelopmentCommand(
    installedRuntime,
    env,
    scratch,
    message("en-US", "title"),
  );
  expect(inventory()).toEqual(beforeRefusal);
  record("installed-refuses-development-command", refusal);
  await retain("before");
  let { application, page } = await start(installedRuntime, env);
  await recordReadyNativeProcesses(application, output);
  expect(fs.existsSync(profile.research_root)).toBe(false);
  const first = await page.evaluate(() => window.ohtia.bootstrap.read());
  expect(first.state).toBe("pending_create");
  record("installed-first-launch-without-profile", { state: first.state });
  record("installed-sandbox-and-csp", await boundaries(application, page));
  const locale = await openStorage(page);
  expect(fs.lstatSync(profile.research_root).isDirectory()).toBe(true);
  record("installed-explicit-opening-creates-research-root", {});
  await saveAppearance(page, locale);
  const positional = await application.evaluate(
    ({ app }) =>
      process.platform !== "linux" ||
      app.commandLine.getSwitchValue("ozone-platform") !== "wayland",
  );
  const requestedViewport = await application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    return {
      width: Math.min(960, area.width),
      height: Math.min(600, area.height),
      zoomFactor: window.webContents.getZoomFactor(),
    };
  });
  const native = await application.browserWindow(page);
  const normalized = await withCommandCleanup(
    () => setNativeViewport(page, native, requestedViewport),
    () => native.dispose(),
  );
  await expect
    .poll(
      () =>
        application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      { message: "Normal window state before saving" },
    )
    .toBe(false);
  if (positional) {
    const requestedPosition = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const bounds = window.getNormalBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return {
        x: area.x + Math.min(24, Math.max(0, area.width - bounds.width)),
        y: area.y + Math.min(24, Math.max(0, area.height - bounds.height)),
      };
    });
    await application.evaluate(
      ({ BrowserWindow }, position) =>
        BrowserWindow.getAllWindows()[0].setPosition(position.x, position.y, false),
      requestedPosition,
    );
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) => {
          const { x, y } = BrowserWindow.getAllWindows()[0].getNormalBounds();
          return { x, y };
        }),
      )
      .toEqual(requestedPosition);
  }
  const saved = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
  });
  await stop(application);
  ({ application, page } = await start(installedRuntime, env));
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    )
    .toBe(true);
  const displays = await application.evaluate(({ screen }) => ({
    areas: screen.getAllDisplays().map((display) => display.workArea),
    primary: screen.getPrimaryDisplay().workArea,
  }));
  const expectedPlacement = windowPlacement(
    { version: 1, ...saved.bounds, maximized: saved.maximized },
    displays.areas,
    displays.primary,
    undefined,
    positional ? "positioned" : "wayland",
  );
  const { maximized: expectedMaximized, ...expectedNormalBounds } = expectedPlacement;
  const nativeAfterRestart = await application.browserWindow(page);
  let restored;
  try {
    // Observe the actual instance without replacing the preference authority or its effects.
    await nativeAfterRestart.evaluate((window) => {
      window.__ohtiaBoundsRequests = [];
      window.__ohtiaBoundsMethods = {};
      for (const method of ["setBounds", "maximize", "unmaximize"]) {
        const original = window[method];
        window.__ohtiaBoundsMethods[method] = original;
        window[method] = function (...args) {
          this.__ohtiaBoundsRequests.push({ method, args });
          return original.apply(this, args);
        };
      }
    });
    await openStorage(page);
    restored = await nativeAfterRestart.evaluate((window) => ({
      requests: window.__ohtiaBoundsRequests,
      accepted: {
        bounds: window.getBounds(),
        normalBounds: window.getNormalBounds(),
        contentBounds: window.getContentBounds(),
        maximized: window.isMaximized(),
      },
    }));
  } finally {
    await withCommandCleanup(
      () =>
        nativeAfterRestart.evaluate((window) => {
          for (const [method, original] of Object.entries(window.__ohtiaBoundsMethods ?? {}))
            window[method] = original;
          delete window.__ohtiaBoundsRequests;
          delete window.__ohtiaBoundsMethods;
        }),
      () => nativeAfterRestart.dispose(),
    );
  }
  // The fresh process obtains these requests only by reading the close-time durable record.
  // Wayland's compositor may restrict acceptance; it does not relax this request contract.
  const boundsObservation = {
    requestedViewport,
    normalizedNative: normalized.native,
    saved,
    displays,
    expectedPlacement,
    ...restored,
    position: positional ? "exact restoration required" : "compositor-owned",
  };
  fs.writeFileSync(
    path.join(output, "window-bounds-observation.json"),
    JSON.stringify(boundsObservation, null, 2) + "\n",
  );
  const requestedBounds = positional
    ? expectedNormalBounds
    : { width: expectedNormalBounds.width, height: expectedNormalBounds.height };
  expect(restored.requests).toEqual([
    { method: "unmaximize", args: [] },
    { method: "setBounds", args: [requestedBounds] },
    ...(expectedMaximized ? [{ method: "maximize", args: [] }] : []),
  ]);
  if (positional) {
    await expect
      .poll(
        () =>
          application.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            return { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
          }),
        { message: "Normal window bounds and state restored after ordinary restart" },
      )
      .toEqual({ bounds: expectedNormalBounds, maximized: expectedMaximized });
  }
  record("installed-window-bounds-survive-restart", boundsObservation);
  const reopened = await readSavedAppearance(page);
  expect(reopened.value.value).toBe("dark");
  await stop(application);
  record("installed-saved-value-survives-restart", { revision: reopened.value.revision });
  await retain("after");
  if (process.platform !== "win32") {
    const target = path.join(profile.scratch_root, `startup-alias-${randomUUID()}`);
    fs.mkdirSync(target, { mode: 0o700 });
    fs.symlinkSync(target, profile.research_root);
    ({ application, page } = await start(installedRuntime, env));
    const { locale: aliased } = await page.evaluate(() => window.ohtia.bootstrap.read());
    await page.getByRole("button", { name: message(aliased, "open_storage"), exact: true }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state)
      .toBe("path_rejected");
    await stop(application);
    expect(fs.lstatSync(profile.research_root).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
    fs.rmSync(profile.research_root);
    await retain("alias");
    record("installed-rejects-aliased-research-root", {});
  }
  fs.mkdirSync(profile.research_root, { mode: 0o700 });
}
function developmentRoot() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(profile.scratch_root, "dev-")));
  fs.mkdirSync(path.join(root, "configuration"), { mode: 0o700 });
  fs.writeFileSync(path.join(root, "instance.json"), JSON.stringify({ version: 1 }));
  return root;
}
async function developmentCases() {
  const before = inventory();
  const scratch = shortTemporaryDirectory("ohtia-dev-");
  try {
    const firstRoot = developmentRoot();
    const secondRoot = developmentRoot();
    const first = developmentLaunch(firstRoot, development, scratch);
    const second = developmentLaunch(secondRoot, development, scratch);
    let { application, page } = await start(first, first.env);
    record("development-sandbox-and-csp", await boundaries(application, page));
    const locale = await openStorage(page);
    await saveAppearance(page, locale);
    expect(developmentInstanceRunning(firstRoot)).toBe(true);
    expect(developmentInstanceRunning(secondRoot)).toBe(false);
    const again = spawn(first.executable, [first.app, ...first.args], {
      env: first.env,
      stdio: "ignore",
      timeout: portLimits.application_start_ms,
    });
    const code = await new Promise((resolve, reject) => {
      again.once("error", reject);
      again.once("exit", (value, signal) => resolve(signal ? signal : value));
    });
    expect(code).toBe(0);
    expect(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);
    record("development-second-launch-attaches", {});
    const other = await start(second, second.env);
    await openStorage(other.page);
    await stop(other.application);
    record("development-roots-run-together", {});
    await stop(application);
    ({ application, page } = await start(first, first.env));
    await openStorage(page);
    const reopened = await readSavedAppearance(page);
    expect(reopened.value.value).toBe("dark");
    await stop(application);
    await expect.poll(() => developmentInstanceRunning(firstRoot)).toBe(false);
    expect(fs.existsSync(path.join(firstRoot, "research", "ohtia.db3"))).toBe(true);
    expect(fs.existsSync(path.join(secondRoot, "research", "ohtia.db3"))).toBe(true);
    record("development-round-trip", { revision: reopened.value.revision });
    expect(inventory()).toEqual(before);
    record("development-leaves-native-state-unchanged", {});
    const unsafe = developmentRoot();
    fs.rmSync(path.join(unsafe, "instance.json"));
    expect(() => developmentLaunch(unsafe, development, scratch)).toThrow("instance.json");
    const researchExisted = fs.existsSync(profile.research_root);
    const overlapping = path.join(profile.research_root, "startup-overlap");
    fs.mkdirSync(overlapping, { recursive: true });
    fs.writeFileSync(path.join(overlapping, "instance.json"), JSON.stringify({ version: 1 }));
    expect(() => developmentLaunch(overlapping, development, scratch)).toThrow("overlaps");
    fs.rmSync(overlapping, { recursive: true });
    if (!researchExisted) fs.rmdirSync(profile.research_root);
    record("development-refuses-unsafe-root", {});
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
try {
  const nativeState = () => ({
    research: fs.existsSync(profile.research_root),
    files: inventory(),
  });
  const found = developmentOnly && nativeState();
  if (development) await developmentCases();
  // The installed cases retain and recreate the native roots; without them nothing may change.
  if (developmentOnly) expect(nativeState()).toEqual(found);
  else await installedCases();
} catch (error) {
  receipt.cases.push({ id: "run", result: "fail", error: String(error) });
  console.error(`Startup acceptance failed: ${String(error).slice(0, 8192)}`);
  process.exitCode = 1;
} finally {
  for (const application of open) await application.close().catch(() => {});
  verifyStableSentinels(profile);
  fs.writeFileSync(path.join(output, "startup-receipt.json"), JSON.stringify(receipt, null, 2));
}
