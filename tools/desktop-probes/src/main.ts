import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  utilityProcess,
} from "electron";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedSender, parseRequest } from "./journey.js";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const requestedRoot = process.env.OHTIA_PROBE_RUN;
if (!requestedRoot || !path.isAbsolute(requestedRoot))
  throw new Error("Use the admitted probe launcher.");
const runRoot: string = requestedRoot;
const expected = JSON.parse(readFileSync(path.join(appRoot, "expected.json"), "utf8")) as {
  target: string;
  runtime: Record<string, string>;
  deadlineMs: number;
  scenario: "journey" | "ipc" | "utility-crash" | "playwright";
  messageBytes: number;
  stringBytes: number;
};
app.setName("Ohtia Native Qualification");
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  { scheme: "ohtia-probe", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const origin = "ohtia-probe://qualification";
const documentUrl = `${origin}/index.html`;
const csp =
  "default-src 'none'; script-src 'self'; style-src 'none'; img-src 'none'; " +
  "font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const observations: Record<string, unknown> = {
  target: expected.target,
  versions: process.versions,
};
let completed = false;
let utilityExited = false;
let stage = "startup";
const progress = openSync(path.join(runRoot, "progress.jsonl"), "wx", 0o600);
function enterStage(value: string) {
  if (completed) return;
  stage = value;
  writeFileSync(
    progress,
    JSON.stringify({ stage, monotonicNs: process.hrtime.bigint().toString() }) + "\n",
  );
}
function finish(ok: boolean) {
  if (completed) return;
  completed = true;
  writeFileSync(
    path.join(runRoot, "runtime.json"),
    JSON.stringify({ ok, ...observations, utilityExited }),
    { flag: "wx", mode: 0o600 },
  );
  closeSync(progress);
  app.exit(ok ? 0 : 1);
}
setTimeout(() => {
  observations.failedStage = stage;
  observations.failure = { name: "TimeoutError", message: "Native probe deadline expired." };
  finish(false);
}, expected.deadlineMs).unref();

async function probe() {
  try {
    enterStage("startup");
    if (!["journey", "ipc", "utility-crash", "playwright"].includes(expected.scenario))
      throw new Error("Unknown native qualification scenario.");
    if (
      !Number.isSafeInteger(expected.messageBytes) ||
      expected.messageBytes < 1 ||
      !Number.isSafeInteger(expected.stringBytes) ||
      expected.stringBytes < 1
    )
      throw new Error("Missing canonical IPC byte bounds.");
    observations.scenario = expected.scenario;
    if (`${process.platform}-${process.arch}` !== expected.target)
      throw new Error("Main target mismatch.");
    for (const [name, version] of Object.entries(expected.runtime)) {
      if (process.versions[name] !== version) throw new Error("Main runtime ABI mismatch.");
    }
    if (
      path.resolve(app.getAppPath()) !== path.resolve(appRoot) ||
      path.resolve(appRoot) !== path.join(process.resourcesPath, "app")
    )
      throw new Error("Probe must use its assembled runtime resources.");
    await app.whenReady();
    enterStage("renderer-setup");
    const isolated = session.fromPartition("ohtia-native-qualification");
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    isolated.setPermissionCheckHandler(() => false);
    const assets = new Map([
      [documentUrl, ["index.html", "text/html"]],
      [`${origin}/renderer.js`, ["renderer.js", "text/javascript"]],
    ]);
    isolated.protocol.handle("ohtia-probe", (request) => {
      const asset = assets.get(request.url);
      if (request.method !== "GET" || !asset?.[0] || !asset[1])
        return new Response(null, { status: 403 });
      return new Response(readFileSync(path.join(appRoot, "assets", asset[0])), {
        headers: { "Content-Type": asset[1], "Content-Security-Policy": csp },
      });
    });
    let resourceCancellations = 0;
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const cancel = !assets.has(details.url);
      if (cancel) resourceCancellations += 1;
      callback({ cancel });
    });
    const makeWindow = (show: boolean) => {
      const created = new BrowserWindow({
        show,
        webPreferences: {
          session: isolated,
          preload: path.join(appRoot, "dist/preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
        },
      });
      created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      created.webContents.on("will-navigate", (event) => {
        event.preventDefault();
      });
      created.webContents.on("will-redirect", (event) => {
        event.preventDefault();
      });
      return created;
    };
    // The instrumented fixture explicitly releases the journey after CDP attachment.
    const controllerReady =
      expected.scenario === "playwright"
        ? once(app, "ohtia-probe-control-ready").then(() => undefined)
        : undefined;
    const window = makeWindow(true);
    const requestCounts = { valid: 0, invalid: 0, untrusted: 0 };
    observations.requestBoundary = requestCounts;
    ipcMain.handle("probe-request", (event, value: unknown) => {
      if (!expectedSender(event, window.webContents, documentUrl)) {
        requestCounts.untrusted += 1;
        return { ok: false, code: "untrusted-sender" };
      }
      const request = parseRequest(value, expected);
      if (!request) {
        requestCounts.invalid += 1;
        return { ok: false, code: "invalid-request" };
      }
      requestCounts.valid += 1;
      if (request.operation === "status")
        return {
          ok: true,
          value: {
            ready: app.isReady(),
            target: expected.target,
            electron: process.versions.electron,
          },
        };
      if (request.operation === "appearance-write") nativeTheme.themeSource = request.value;
      return { ok: true, value: nativeTheme.themeSource };
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      observations.rendererFailure = { reason: details.reason, exitCode: details.exitCode };
      observations.failedStage = stage;
      finish(false);
    });
    window.webContents.on("preload-error", (_event, _preloadPath, error) => {
      observations.preloadFailure = { name: error.name, message: error.message };
      observations.failedStage = stage;
      finish(false);
    });
    const isolation = new Promise<void>((resolve, reject) => {
      ipcMain.once("probe-isolation", (event, value: unknown) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== documentUrl ||
          typeof value !== "object" ||
          value === null ||
          Object.keys(value).sort().join(",") !== "contextIsolated,sandboxed" ||
          !("sandboxed" in value) ||
          value.sandboxed !== true ||
          !("contextIsolated" in value) ||
          value.contextIsolated !== true
        ) {
          observations.rejectedIsolation = {
            expectedContents: event.sender === window.webContents,
            expectedFrame: event.senderFrame === window.webContents.mainFrame,
            frameUrl: event.senderFrame?.url,
          };
          reject(new Error("Unexpected isolation sender or result."));
          return;
        }
        observations.preloadIsolation = value;
        resolve();
      });
    });
    enterStage("renderer-load-and-isolation");
    await Promise.all([window.loadURL(documentUrl), isolation]);
    if (controllerReady) {
      enterStage("playwright-control-ready");
      await controllerReady;
      observations.playwrightControlReleased = true;
    }
    enterStage("renderer-globals");
    const privilegedGlobals: unknown = await window.webContents.executeJavaScript(
      "document.documentElement.dataset.privilegedGlobals",
    );
    if (privilegedGlobals !== "false") throw new Error("Privileged renderer globals present.");
    observations.privilegedGlobalsAbsent = true;
    enterStage("status-and-appearance-journey");
    const valueOf = (reply: unknown): unknown => {
      if (
        typeof reply !== "object" ||
        reply === null ||
        !("ok" in reply) ||
        reply.ok !== true ||
        !("value" in reply)
      )
        throw new Error("Private journey request failed.");
      return reply.value;
    };
    const status = valueOf(
      await window.webContents.executeJavaScript("window.ohtiaNativeProbe.status()"),
    );
    if (
      typeof status !== "object" ||
      status === null ||
      !("ready" in status) ||
      status.ready !== true ||
      !("target" in status) ||
      status.target !== expected.target ||
      !("electron" in status) ||
      status.electron !== expected.runtime.electron
    )
      throw new Error("Native status journey disagrees.");
    const before = valueOf(
      await window.webContents.executeJavaScript("window.ohtiaNativeProbe.appearance()"),
    );
    if (before !== nativeTheme.themeSource) throw new Error("Appearance read disagrees.");
    const nativeDarkBefore = nativeTheme.shouldUseDarkColors;
    const rendererDarkBefore: unknown = await window.webContents.executeJavaScript(
      "matchMedia('(prefers-color-scheme: dark)').matches",
    );
    if (rendererDarkBefore !== nativeDarkBefore)
      throw new Error("Initial native and renderer appearance disagree.");
    const replacement = nativeDarkBefore ? "light" : "dark";
    const changed = valueOf(
      await window.webContents.executeJavaScript(
        `window.ohtiaNativeProbe.setAppearance(${JSON.stringify(replacement)})`,
      ),
    );
    const rendererDark: unknown = await window.webContents
      .executeJavaScript(`new Promise(resolve => {
      const query = matchMedia('(prefers-color-scheme: dark)');
      if (query.matches === ${String(replacement === "dark")}) resolve(query.matches);
      else query.addEventListener('change', () => resolve(query.matches), { once: true });
    })`);
    if (changed !== replacement || rendererDark !== (replacement === "dark"))
      throw new Error("Native appearance replacement was not observed in the renderer.");
    observations.initialJourney = {
      status,
      appearanceBefore: before,
      appearanceAfter: changed,
      nativeDarkBefore,
      rendererDarkBefore,
      rendererDark,
      windows: BrowserWindow.getAllWindows().length,
    };
    if (BrowserWindow.getAllWindows().length !== 1)
      throw new Error("Resource journey requires one window.");
    enterStage("protocol-method");
    const deniedMethod = await isolated.fetch(documentUrl, { method: "POST" });
    if (deniedMethod.status !== 403) throw new Error("Protocol admitted an unexpected method.");
    observations.protocolMethodDenied = true;
    enterStage("resource-request");
    const beforeCancellation = resourceCancellations;
    let requestRejected = false;
    try {
      await isolated.fetch(`${origin}/not-allowed`);
    } catch {
      requestRejected = true;
    }
    if (!requestRejected || resourceCancellations !== beforeCancellation + 1)
      throw new Error("Resource rejection was not observed at the request boundary.");
    observations.resourceRequestCancelled = true;
    enterStage("renderer-csp");
    const cspDenied: unknown = await window.webContents.executeJavaScript(`
    new Promise(resolve => {
      const listener = event => {
        if (event.effectiveDirective === 'connect-src') {
          document.removeEventListener('securitypolicyviolation', listener);
          resolve({
            effectiveDirective: event.effectiveDirective,
            blockedURI: event.blockedURI,
            disposition: event.disposition,
            originalPolicy: event.originalPolicy
          });
        }
      };
      document.addEventListener('securitypolicyviolation', listener);
      fetch('/not-allowed').then(() => resolve(false)).catch(() => {});
    })
  `);
    observations.rendererCspViolation = cspDenied;
    if (
      typeof cspDenied !== "object" ||
      cspDenied === null ||
      !("effectiveDirective" in cspDenied) ||
      cspDenied.effectiveDirective !== "connect-src" ||
      !("blockedURI" in cspDenied) ||
      cspDenied.blockedURI !== new URL(origin).protocol.slice(0, -1) ||
      !("disposition" in cspDenied) ||
      cspDenied.disposition !== "enforce"
    )
      throw new Error("Expected renderer CSP denial was not observed.");
    observations.rendererCspConnectionDenied = true;
    if (expected.scenario === "ipc") {
      enterStage("ipc-negative-requests");
      const unchangedAppearance = nativeTheme.themeSource;
      const invalidBefore = requestCounts.invalid;
      const bridgeRejection: unknown = await window.webContents.executeJavaScript(
        `window.ohtiaNativeProbe.setAppearance('x'.repeat(${String(expected.messageBytes + 1)}))`,
      );
      if (
        typeof bridgeRejection !== "object" ||
        bridgeRejection === null ||
        !("ok" in bridgeRejection) ||
        bridgeRejection.ok !== false ||
        requestCounts.invalid !== invalidBefore ||
        nativeTheme.themeSource !== unchangedAppearance
      )
        throw new Error("Preload forwarded an invalid appearance to privileged IPC.");
      observations.preloadOversizeRejected = true;
      const invalidResults = new Promise<unknown>((resolve, reject) => {
        ipcMain.once("probe-invalid-results", (event, results: unknown) => {
          if (!expectedSender(event, window.webContents, documentUrl))
            reject(new Error("Unexpected negative-fixture reporter."));
          else resolve(results);
        });
      });
      window.webContents.send("probe-invalid-requests", expected.messageBytes);
      const invalid = await invalidResults;
      if (
        !Array.isArray(invalid) ||
        invalid.length !== 4 ||
        !invalid.every((entry: unknown) => {
          if (typeof entry !== "object" || entry === null || !("reply" in entry)) return false;
          const reply = entry.reply;
          return (
            typeof reply === "object" &&
            reply !== null &&
            "ok" in reply &&
            reply.ok === false &&
            "code" in reply &&
            reply.code === "invalid-request"
          );
        }) ||
        requestCounts.invalid !== invalidBefore + 4 ||
        nativeTheme.themeSource !== unchangedAppearance
      )
        throw new Error("Invalid/oversized IPC fixture was not refused without mutation.");
      observations.invalidRequests = invalid;
      const caseIds = invalid
        .map((entry: unknown) =>
          typeof entry === "object" && entry !== null && "caseId" in entry
            ? entry.caseId
            : undefined,
        )
        .sort();
      if (
        JSON.stringify(caseIds) !==
        JSON.stringify(["null", "oversized", "unexpected-frame-key", "unknown-operation"])
      )
        throw new Error("Native invalid IPC fixture omitted a required subcase.");
      enterStage("ipc-spoofed-sender-frame");
      const secondary = makeWindow(false);
      try {
        await secondary.loadURL(documentUrl);
        const untrustedBefore = requestCounts.untrusted;
        const spoofed = new Promise<unknown>((resolve, reject) => {
          ipcMain.once("probe-spoof-result", (event, reply: unknown) => {
            if (!expectedSender(event, secondary.webContents, documentUrl))
              reject(new Error("Unexpected spoof-fixture reporter."));
            else resolve(reply);
          });
        });
        secondary.webContents.send("probe-spoof-request");
        const reply = await spoofed;
        if (
          typeof reply !== "object" ||
          reply === null ||
          !("ok" in reply) ||
          reply.ok !== false ||
          !("code" in reply) ||
          reply.code !== "untrusted-sender" ||
          requestCounts.untrusted !== untrustedBefore + 1
        )
          throw new Error("Same-origin foreign contents/frame acquired IPC authority.");
        observations.spoofedSender = {
          expectedContentsId: window.webContents.id,
          actualContentsId: secondary.webContents.id,
          sameOrigin: secondary.webContents.getURL() === documentUrl,
          reply,
        };
      } finally {
        secondary.destroy();
      }
      enterStage("privileged-import");
      const imported: unknown = await window.webContents.executeJavaScript(
        "import('node:fs').then(() => ({ denied: false }), error => ({ denied: true, name: error.name }))",
      );
      if (
        typeof imported !== "object" ||
        imported === null ||
        !("denied" in imported) ||
        imported.denied !== true
      )
        throw new Error("Renderer acquired a privileged import.");
      observations.privilegedImport = imported;
      enterStage("navigation-denied");
      const navigation = new Promise<void>((resolve) => {
        window.webContents.once("will-navigate", () => {
          resolve();
        });
      });
      await Promise.all([
        navigation,
        window.webContents.executeJavaScript(`location.href = '${origin}/forbidden-navigation'`),
      ]);
      if (window.webContents.getURL() !== documentUrl)
        throw new Error("Unexpected navigation succeeded.");
      observations.navigationDenied = true;
    }
    enterStage("utility");
    const child = utilityProcess.fork(path.join(appRoot, "dist/utility.js"), [runRoot], {
      stdio: "inherit",
      serviceName: "Ohtia synthetic native probe",
    });
    const utility = await new Promise<unknown>((resolve, reject) => {
      let result: unknown;
      child.once("message", (message: unknown) => {
        result = message;
        observations.utility = message;
        child.postMessage("probe-result-received");
      });
      child.once("exit", (code) => {
        utilityExited = true;
        observations.utilityExitCode = code;
        if (code !== 0 || !result) reject(new Error("Utility failed or omitted its result."));
        else resolve(result);
      });
      if (expected.scenario === "utility-crash")
        child.once("spawn", () => {
          const killAccepted = child.kill();
          observations.utilityCrash = { pid: child.pid, killAccepted };
          if (!killAccepted) reject(new Error("Utility crash injection was not accepted."));
        });
    });
    if (expected.scenario === "utility-crash")
      throw new Error("Utility survived the crash fixture without a failing exit.");
    observations.utility = utility;
    if (
      typeof utility !== "object" ||
      utility === null ||
      !("ok" in utility) ||
      utility.ok !== true
    )
      throw new Error("Utility probe rejected.");
    window.destroy();
    finish(true);
  } catch (error) {
    observations.failedStage = stage;
    observations.failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError" };
    finish(false);
  }
}
void probe();
