import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  desktopChannels,
  desktopDocument,
  encodeEnvelope,
  isBootstrapAction,
  message,
  portLimits,
  resolveInterfaceLocale,
  type BootstrapSnapshot,
  type BootstrapState,
  type RuntimeProfile,
} from "@ohtia/contracts";
import { rendererWebPreferences } from "./index.js";
import { admitRuntimeSwitches, loadRuntimeProfile, verifyStableSentinels } from "./profile.js";
import { canonicalProspective, readLocator, LocatorPublisher, posixLocatorIO } from "./locator.js";
import { PortAdmission } from "./port-admission.js";
import { ServiceSupervisor, recoverService } from "./service-supervisor.js";
import {
  completeStorageActivation,
  refreshLocatorState,
  storageInterruptionState,
  restoreStoppedBootstrap,
} from "./storage-activation.js";
import { RuntimeNotices, type RuntimeError } from "./error-notices.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
app.setName("Ohtia");
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ohtia",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let locale = resolveInterfaceLocale(app.getPreferredSystemLanguages());
let profile: RuntimeProfile;
let profileFile: string;
try {
  profileFile = process.env.OHTIA_RUNTIME_PROFILE ?? "";
  profile = loadRuntimeProfile(profileFile);
  if (
    canonicalProspective(app.getPath("home")) !== profile.home ||
    canonicalProspective(app.getPath("appData")) !== profile.configuration_root ||
    canonicalProspective(app.getPath("userData")) !==
      path.join(profile.configuration_root, "Ohtia") ||
    process.env.NODE_OPTIONS
  )
    throw new Error("Invalid native configuration boundary.");
  admitRuntimeSwitches(
    process.argv.slice(1),
    process.execArgv,
    process.env.OHTIA_RUNTIME_ACCEPTANCE === "1",
  );
  verifyStableSentinels(profile);
} catch {
  dialog.showErrorBox(message(locale, "title"), message(locale, "startup_failed"));
  app.exit(1);
  throw new Error("Runtime isolation admission refused.");
}

const settings = path.join(profile.configuration_root, "Ohtia", "settings");
const admission = new PortAdmission();
const publisher = new LocatorPublisher();
const windows = new Map<
  BrowserWindow,
  { generation: string; detach?: () => void; frame?: object }
>();
let service: ServiceSupervisor | undefined;
let storageRequested = false;
let storageActionPending = false;
let admissionFallback: BootstrapState = "storage_failed";
let localeFallback = false;
let generation = randomUUID();
let bootstrapState: BootstrapState = "missing";
let quitting = false;
let cleanExit = false;
let resourceFailureReported = false;
const notices = new RuntimeNotices(
  (key) => {
    const window = BrowserWindow.getAllWindows().find(
      (value) => !value.isDestroyed() && value.isVisible(),
    );
    if (!app.isReady() || !window) {
      dialog.showErrorBox(message(locale, "title"), message(locale, key));
      return Promise.resolve();
    }
    return dialog
      .showMessageBox(window, {
        type: "error",
        title: message(locale, "title"),
        message: message(locale, key),
      })
      .then(() => {});
  },
  () => {
    app.quit();
  },
);
function reportError(key: RuntimeError): Promise<void> {
  if (quitting) return Promise.resolve();
  return notices.report(key);
}
function quitAfterError(key: RuntimeError): void {
  if (quitting) return;
  void notices.quitAfter(key);
}
const acceptance =
  process.env.OHTIA_RUNTIME_ACCEPTANCE === "1"
    ? { received: 0, rejectedFrame: 0, rejectedEnvelope: 0, dispatched: 0 }
    : undefined;
if (acceptance)
  Object.defineProperty(globalThis, "__ohtiaAcceptance", { value: () => ({ ...acceptance }) });
let metricTimer: ReturnType<typeof setInterval> | undefined;
const snapshot = (): BootstrapSnapshot => ({
  version: 1,
  locale,
  state: bootstrapState === "missing" ? "pending_create" : bootstrapState,
  ...(localeFallback && bootstrapState === "storage_ready" ? { notice: "locale_fallback" } : {}),
});
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | undefined {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    !windows.has(window) ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== desktopDocument ||
    quitting
  )
    return;
  return window;
}
function attach(window: BrowserWindow): boolean {
  const state = windows.get(window);
  if (!state) return false;
  const frame = window.webContents.mainFrame;
  if (frame.url !== desktopDocument) return false;
  if (state.frame === frame && state.detach) return true;
  state.detach?.();
  const permit = admission.attach({
    frame,
    url: desktopDocument,
    windowGeneration: state.generation,
    serviceGeneration: generation,
  });
  if (!permit.ok) return false;
  state.frame = frame;
  state.detach = permit.value;
  return true;
}
function detach(window: BrowserWindow): void {
  const state = windows.get(window);
  if (!state) return;
  state.detach?.();
  delete state.detach;
  delete state.frame;
  service?.disposeWindow(state.generation);
}
function createWindow(): boolean {
  if (quitting) return false;
  if (
    windows.size >= portLimits.windows ||
    app.getAppMetrics().length >= portLimits.process_tree_count
  ) {
    BrowserWindow.getAllWindows()[0]?.focus();
    return false;
  }
  const window = new BrowserWindow({
    width: 800,
    height: 650,
    minWidth: 320,
    minHeight: 320,
    show: false,
    title: message(locale, "title"),
    webPreferences: {
      ...rendererWebPreferences(path.join(directory, "preload.cjs")),
      session: desktopSession,
    },
  });
  windows.set(window, { generation: randomUUID() });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    if (event.url !== desktopDocument) event.preventDefault();
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || event.url !== desktopDocument) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  window.webContents.on("did-start-navigation", (_event, url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) {
      detach(window);
      const state = windows.get(window);
      if (state && url === desktopDocument) state.generation = randomUUID();
    }
  });
  window.webContents.on("render-process-gone", () => {
    detach(window);
  });
  window.on("close", (event) => {
    if (!cleanExit && windows.size === 1) {
      event.preventDefault();
      app.quit();
    }
  });
  window.on("closed", () => {
    detach(window);
    windows.delete(window);
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  void window
    .loadURL(desktopDocument)
    .then(() => {
      // A compositor may defer first paint until mapping; completed content can be shown directly.
      if (!window.isDestroyed()) window.show();
    })
    .catch(() => {
      quitAfterError("startup_failed");
    });
  return true;
}
function startService(mode: "open" | "retry" | "restore" | "blocked" = "blocked"): void {
  if (quitting || (service && !service.ceased)) return;
  const locator = readLocator(settings, profile);
  bootstrapState = refreshLocatorState(bootstrapState, locator.state);
  const storageMode = mode === "open" && locator.state === "missing" ? "create" : mode;
  generation = randomUUID();
  const child = utilityProcess.fork(
    path.join(directory, "utility.mjs"),
    [
      profileFile,
      generation,
      locale,
      [
        "missing",
        "located",
        "pending_create",
        "storage_ready",
        "storage_opening",
        "storage_failed",
        "recovery_required",
        "retry_required",
        "checkpoint_restored",
        "publication_uncertain",
      ].includes(bootstrapState)
        ? storageMode
        : "blocked",
    ],
    {
      serviceName: "Ohtia data service",
      stdio: "ignore",
      execArgv: [],
      cwd: profile.scratch_root,
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
        HOME: profile.home,
        USERPROFILE: profile.home,
        TMPDIR: profile.scratch_root,
        TEMP: profile.scratch_root,
        TMP: profile.scratch_root,
      },
    },
  );
  service = new ServiceSupervisor(
    {
      send: (text) => {
        child.postMessage(text);
      },
      kill: () => {
        child.kill();
      },
      messages: (listener) => {
        child.on("message", listener);
      },
      exited: (listener) => {
        child.once("exit", listener);
      },
    },
    generation,
    (state) => {
      if (state === "unavailable") {
        if (storageRequested && !storageActionPending)
          bootstrapState = storageInterruptionState(
            bootstrapState === "storage_opening" ? admissionFallback : bootstrapState,
          );
        for (const window of windows.keys())
          if (!window.isDestroyed()) window.webContents.send(desktopChannels.ended, generation);
      }
    },
    (notice) => {
      const active = service;
      if (!active || notice.generation !== generation) return;
      admissionFallback = "storage_failed";
      bootstrapState = notice.state;
      if (notice.state !== "storage_ready") return;
      bootstrapState = "storage_opening";
      const locator = readLocator(settings, profile);
      if (locator.state !== "missing" && locator.state !== "located") {
        bootstrapState = locator.state;
        return;
      }
      const publication =
        locator.state === "located"
          ? Promise.resolve("confirmed" as const)
          : publisher.publish(
              settings,
              profile.research_root,
              profile,
              () => Promise.resolve(!quitting && service === active && active.available),
              posixLocatorIO,
            );
      void publication.then((result) => {
        if (quitting || service !== active || generation !== notice.generation) return;
        const resolvedLocale = resolveInterfaceLocale(
          app.getPreferredSystemLanguages(),
          notice.savedLocale,
        );
        bootstrapState = completeStorageActivation(result, active, resolvedLocale);
        if (bootstrapState === "storage_ready") {
          locale = resolvedLocale;
          localeFallback = notice.localeFallback === true;
        }
      });
    },
    mode !== "blocked" && ["missing", "located"].includes(locator.state),
  );
}
let desktopSession: Electron.Session;
const ownsBroker = app.requestSingleInstanceLock();
if (!ownsBroker) {
  app.exit(0);
  throw new Error("The existing broker owns this native profile.");
}
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
  if (!window) void reportError("startup_failed");
});
const startup = setTimeout(() => {
  quitAfterError("startup_failed");
}, portLimits.application_start_ms);
async function start(): Promise<void> {
  await app.whenReady();
  locale = resolveInterfaceLocale(app.getPreferredSystemLanguages());
  Menu.setApplicationMenu(null);
  const locator = readLocator(settings, profile);
  bootstrapState = locator.state;
  desktopSession = session.fromPartition(`ohtia-${randomUUID()}`, { cache: false });
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  desktopSession.setPermissionCheckHandler(() => false);
  const assets: unknown = JSON.parse(fs.readFileSync(path.join(directory, "assets.json"), "utf8"));
  if (!assets || typeof assets !== "object" || Array.isArray(assets))
    throw new Error("Invalid local asset inventory.");
  const allowed = new Map<string, { bytes: Buffer; type: string }>();
  for (const [name, input] of Object.entries(assets)) {
    if (
      !input ||
      typeof input !== "object" ||
      !/^(?:assets\/)?[A-Za-z0-9_.-]+\.(?:html|js|css|woff2?|ttf|otf)$/.test(name)
    )
      throw new Error("Invalid local asset.");
    const record = input as Record<string, unknown>;
    const assetPath = path.join(directory, "renderer", name);
    if (fs.realpathSync.native(assetPath) !== assetPath) throw new Error("Aliased local asset.");
    const bytes = fs.readFileSync(assetPath);
    if (
      bytes.length > 16 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== record.sha256 ||
      typeof record.type !== "string"
    )
      throw new Error("Local asset integrity failed.");
    allowed.set(`ohtia://app/${name}`, { bytes, type: record.type });
  }
  if (!allowed.has(desktopDocument)) throw new Error("Missing local document.");
  desktopSession.webRequest.onBeforeRequest((details, callback) => {
    const denied = !allowed.has(details.url);
    callback({ cancel: denied });
    // Explicitly finish a denied top-level load without replacing the admitted document.
    if (denied && details.resourceType === "mainFrame")
      queueMicrotask(() => {
        for (const window of windows.keys())
          if (!window.isDestroyed() && window.webContents.id === details.webContentsId)
            window.webContents.stop();
      });
  });
  desktopSession.protocol.handle("ohtia", (request) => {
    const asset = allowed.get(request.url);
    if (!asset || request.method !== "GET") return new Response(null, { status: 403 });
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Cache-Control": "no-store",
      },
    });
  });
  ipcMain.on(desktopChannels.session, (event) => {
    const window = trusted(event);
    const state = window ? windows.get(window) : undefined;
    event.returnValue =
      window && state && attach(window)
        ? { windowGeneration: state.generation, serviceGeneration: generation }
        : null;
  });
  ipcMain.on(desktopChannels.port, (event, text: unknown) => {
    if (acceptance) acceptance.received++;
    const window = trusted(event);
    if (!window || !attach(window) || !event.senderFrame) {
      if (acceptance) acceptance.rejectedFrame++;
      return;
    }
    const sender = { frame: event.senderFrame, url: event.senderFrame.url };
    const authority = admission.authorize(sender, text);
    if (!authority.ok) {
      if (acceptance) acceptance.rejectedEnvelope++;
      return;
    }
    if (authority.value.kind === "cancel" || authority.value.kind === "unsubscribe") {
      service?.control(authority.value);
      return;
    }
    const accepted = admission.admit(sender, text);
    const frame = event.senderFrame;
    const deliver = (reply: string) => {
      if (
        !window.isDestroyed() &&
        frame === window.webContents.mainFrame &&
        frame.url === desktopDocument &&
        windows.get(window)?.frame === frame
      )
        frame.send(desktopChannels.reply, reply);
    };
    if (!accepted.ok) {
      if (authority.value.kind === "request") {
        const reply = encodeEnvelope({ ...authority.value, kind: "result", payload: accepted });
        if (reply.ok) deliver(reply.value);
      }
      return;
    }
    if (!service) {
      accepted.value.release();
      accepted.value.releaseSubscription();
      return;
    }
    if (acceptance) acceptance.dispatched++;
    service.dispatch({ ...accepted.value, deliver });
  });
  ipcMain.handle(
    desktopChannels.bootstrap,
    async (event, action: unknown): Promise<BootstrapSnapshot> => {
      const window = trusted(event);
      if (!window || !isBootstrapAction(action)) throw new Error("Bootstrap admission refused.");
      if (action === "exit") {
        app.quit();
        return snapshot();
      }
      if (action === "new_window") {
        return createWindow() ? snapshot() : { ...snapshot(), notice: "resource_failure" };
      }
      if (
        action === "retry_service" ||
        action === "restore_checkpoint" ||
        action === "open_storage"
      ) {
        if (storageActionPending || bootstrapState === "storage_opening") return snapshot();
        if (
          action === "open_storage" &&
          ![
            "pending_create",
            "missing",
            "located",
            "storage_failed",
            "publication_uncertain",
          ].includes(bootstrapState)
        )
          return snapshot();
        if (action === "restore_checkpoint" && bootstrapState !== "recovery_required")
          return snapshot();
        if (action === "open_storage" || action === "restore_checkpoint") storageRequested = true;
        const mode =
          action === "restore_checkpoint"
            ? "restore"
            : ["recovery_required", "retry_required", "checkpoint_restored"].includes(
                  bootstrapState,
                )
              ? "retry"
              : storageRequested
                ? "open"
                : "blocked";
        const previousState = bootstrapState;
        storageActionPending = true;
        try {
          if (mode !== "blocked") {
            admissionFallback = storageInterruptionState(previousState);
            bootstrapState = "storage_opening";
          }
          const current = service;
          if (current) {
            if (!current.ceased && !(await current.stop())) {
              bootstrapState = restoreStoppedBootstrap(previousState);
              return { ...snapshot(), notice: "shutdown_uncertain" };
            }
            const outcome = await recoverService(
              current,
              () => !quitting && service === current,
              () => {
                for (const existing of windows.keys()) detach(existing);
                startService(mode);
                for (const [existing, state] of windows) {
                  if (existing.isDestroyed() || existing.webContents.isDestroyed()) continue;
                  state.generation = randomUUID();
                  try {
                    existing.webContents.send(desktopChannels.reconnect);
                  } catch {
                    detach(existing);
                  }
                }
              },
            );
            if (outcome === "uncertain") {
              bootstrapState = restoreStoppedBootstrap(previousState);
              return { ...snapshot(), notice: "shutdown_uncertain" };
            }
            if (outcome === "cancelled") {
              bootstrapState = restoreStoppedBootstrap(previousState);
              return snapshot();
            }
          }
          if (quitting) return snapshot();
          return snapshot();
        } catch {
          bootstrapState =
            mode === "blocked"
              ? restoreStoppedBootstrap(previousState)
              : storageInterruptionState(previousState);
          return snapshot();
        } finally {
          storageActionPending = false;
        }
      }
      clearTimeout(startup);
      return snapshot();
    },
  );
  startService();
  createWindow();
  metricTimer = setInterval(() => {
    if (
      !quitting &&
      !resourceFailureReported &&
      app.getAppMetrics().length > portLimits.process_tree_count
    ) {
      resourceFailureReported = true;
      quitAfterError("resource_failure");
    }
  }, 250);
}
app.on("before-quit", (event) => {
  if (cleanExit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  clearTimeout(startup);
  for (const window of windows.keys()) detach(window);
  void (async () => {
    const ceased = service ? await service.stop() : true;
    if (!ceased) {
      quitting = false;
      void reportError("shutdown_uncertain");
      return;
    }
    try {
      verifyStableSentinels(profile);
    } catch {
      quitting = false;
      void reportError("startup_failed");
      return;
    }
    cleanExit = true;
    if (metricTimer) clearInterval(metricTimer);
    clearTimeout(startup);
    app.quit();
  })();
});
app.on("window-all-closed", () => {
  app.quit();
});
// Do not await native readiness at ESM top level: Electron finishes loading the module before ready.
void start().catch(() => {
  quitAfterError("startup_failed");
});
