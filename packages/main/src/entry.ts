import { copyMessage, openExternalMessageLink } from "./message-actions.js";
import { AnthropicProvider, anthropicConnection } from "./anthropic-provider.js";
import { ChatGPTProvider } from "./chatgpt-provider.js";
import { OpenAIProvider, openaiConnection } from "./openai-provider.js";
import { ConnectionManager } from "./connection-manager.js";
import { ApplicationExit } from "./application-exit.js";
import { observeServicePower } from "./service-power.js";
import { ProviderDispatch } from "./provider-dispatch.js";
import type { DevelopmentCommand } from "./development-command.js";
import { ConnectionBroker } from "./connection-broker.js";
import { UpdateBroker } from "./update-broker.js";
import { requestLatestRelease } from "./update-check.js";
import { isExecutable, launchDetached, openUpdateRoute, updateRoute } from "./update-route.js";
import { nativeCredentialStore } from "./native-credentials.js";
declare const __OHTIA_DEVELOPMENT_BUILD__: boolean;
import {
  requestBootstrapPlacement,
  windowOptions,
  windowPlacement,
  WindowTheme,
  WindowPreferences,
} from "./window-state.js";
import { configureGraphicsCompatibility } from "./graphics-compatibility.js";
import { nativeSystemMotionHost, SystemMotionObserver } from "./system-motion.js";
import { CommandMenus } from "./command-menus.js";
import { readAboutInformation, copyVersionInformation } from "./about.js";
import { isRendererAssetPath } from "./asset-policy.js";
import {
  app,
  clipboard,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
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
  suppressDiagnosticCapture,
  type DiagnosticEventName,
  decodeDiagnosticBundleRequest,
  type DiagnosticBundleResult,
  decodeDiagnosticDeleteRequest,
  type DiagnosticDeleteResult,
  decodeDiagnosticReadRequest,
  type DiagnosticReadResult,
  diagnosticLimits,
  desktopChannels,
  desktopDocument,
  encodeEnvelope,
  decodeText,
  projectResearchScope,
  failure,
  isBootstrapAction,
  isCanonicalUuid,
  type BootstrapNotice,
  type CheckpointProblem,
  type VerifiedCheckpoint,
  message,
  portLimits,
  resolveInterfaceLocale,
  type DiagnosticEvent,
  type CommandResult,
  type BootstrapSnapshot,
  type BootstrapState,
  type RuntimeContext,
  type SystemMotionNotice,
  isNativeCommand,
  isExitChoice,
  isIdentifier,
  type ExitDialogState,
  isWindowCommandRequest,
  isInterfaceLocale,
  isCommandPlatform,
  projectLinks,
  windowMinimum,
} from "@ohtia/contracts";
import { rendererWebPreferences } from "./index.js";
import {
  admitRuntimeSwitches,
  isDevelopmentSwitch,
  ensureResearchRoot,
  resolveRuntimeContext,
  verifyStableSentinels,
} from "./profile.js";
import {
  canonicalProspective,
  readLocator,
  readManagedStoreLocation,
  managedStoreRootIdentity,
  validateDataDirectory,
  LocatorPublisher,
  posixLocatorIO,
} from "./locator.js";
import { PortAdmission, RequestBudget } from "./port-admission.js";
import { ServiceSupervisor, recoverService } from "./service-supervisor.js";
import {
  completeStorageActivation,
  refreshLocatorState,
  storageInterruptionState,
  restoreStoppedBootstrap,
} from "./storage-activation.js";
import { RuntimeNotices, type RuntimeError } from "./error-notices.js";

import { DiagnosticBundleFlow } from "./diagnostic-bundle.js";
import { DiagnosticWriter } from "./diagnostic-writer.js";
import { stopBrokerServices, recoverDiagnosticsAfterShutdown } from "./shutdown.js";

suppressDiagnosticCapture((discard) => {
  process.stdout.write = discard;
  process.stderr.write = discard;
});

const directory = path.dirname(fileURLToPath(import.meta.url));
app.setName("Ohtia");
// Windows groups the taskbar button with the installer shortcuts only when both share the appId;
// keep this value equal to the packaging appId in scripts/quality_native.py.
if (process.platform === "win32" && app.isPackaged) app.setAppUserModelId("org.ohtia.Ohtia");
app.enableSandbox();
import { PresentationBroker } from "./presentation-broker.js";
const presentationBroker = new PresentationBroker(() =>
  [...windows.keys()].filter((window) => !window.isDestroyed()).map((window) => window.webContents),
);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ohtia",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let locale = resolveInterfaceLocale(preferredSystemLanguages());
if (!isCommandPlatform(process.platform)) throw new Error("Unsupported command platform.");
const commandLifecycle = {
  quit: () => {
    if (!quitting) {
      if (!applicationExit.pending) exitWindow = undefined;
      app.quit();
    }
  },
  close: (window: BrowserWindow) => {
    if (!quitting && !window.isDestroyed()) window.close();
  },
};
const commandMenus = new CommandMenus(
  process.platform,
  () => locale,
  desktopDocument,
  commandLifecycle,
);
let context: RuntimeContext;
let serviceContext: string;
try {
  const profileFile = process.env.OHTIA_RUNTIME_PROFILE ?? "";
  const nativeAppData = canonicalProspective(app.getPath("appData"));
  context = resolveRuntimeContext({
    profileFile,
    developmentRoot: process.env.OHTIA_DEVELOPMENT_ROOT ?? "",
    packaged: app.isPackaged,
    appData: nativeAppData,
    temp: canonicalProspective(app.getPath("temp")),
  });
  if (context.mode === "qualification") {
    if (
      canonicalProspective(app.getPath("home")) !== context.home ||
      nativeAppData !== context.configuration_root ||
      canonicalProspective(app.getPath("userData")) !==
        path.join(context.configuration_root, "Ohtia")
    )
      throw new Error("Invalid native configuration boundary.");
    serviceContext = `qualification:${profileFile}`;
  } else if (context.mode === "development") {
    // This must precede the single-instance lock, so each checkout owns its own lock.
    app.setPath("appData", context.configuration_root);
    app.setPath("userData", path.join(context.configuration_root, "Ohtia"));
    serviceContext = `development:${process.env.OHTIA_DEVELOPMENT_ROOT ?? ""}`;
  } else serviceContext = "installed";
  if (process.env.NODE_OPTIONS) throw new Error("Node runtime injection is not admitted.");
  admitRuntimeSwitches(
    process.argv.slice(1),
    process.execArgv,
    process.env.OHTIA_RUNTIME_ACCEPTANCE === "1",
    context.mode === "development",
  );
  verifyStableSentinels(context);
} catch {
  dialog.showErrorBox(message(locale, "title"), message(locale, "startup_failed"));
  app.exit(1);
  throw new Error("Runtime admission refused.");
}

configureGraphicsCompatibility(app.commandLine, process.platform, process.env);

function preferredSystemLanguages(): readonly string[] {
  try {
    return app.getPreferredSystemLanguages();
  } catch {
    return [];
  }
}
const settings = path.join(context.configuration_root, "Ohtia", "settings");
const requestBudget = new RequestBudget();
const admission = new PortAdmission(requestBudget);
let layoutFailureAnnounced = false;
// SPEC-001-040: only an installed final release asks GitHub; development and qualification never do.
const updates = new UpdateBroker({
  installedVersion: app.getVersion(),
  permitted: context.mode === "installed",
  requester: requestLatestRelease(),
  publish: (notice) => {
    for (const window of windows.keys())
      if (!window.isDestroyed()) window.webContents.send(desktopChannels.updateState, notice);
  },
});
const updateHost = {
  platform: process.platform,
  desktop: process.env.XDG_CURRENT_DESKTOP,
  executable: isExecutable,
  launch: launchDetached,
  openBrowser: (url: string) => shell.openExternal(url),
};
const publisher = new LocatorPublisher();
const windows = new Map<
  BrowserWindow,
  {
    generation: string;
    openConversation?: { projectId: string; conversationId: string };
    navigateConversation?: NonNullable<BootstrapSnapshot["navigateConversation"]>;
    restoreLastProject: boolean;
    researchProjectId?: string | null;
    researchSelection?: string;
    researchSubscription?: string;
    workspace: boolean;
    boundsSaved: boolean;
    manuscriptPending?: boolean;
    presentable: boolean;
    documentPrepared: boolean;
    frameReady: boolean;
    firstShow: boolean;
    activate: boolean;
    maximizeOnShow: boolean;
    detach?: () => void;
    frame?: object;
  }
>();
let service: ServiceSupervisor | undefined;
let connections: ConnectionBroker | undefined;
let credentials: Awaited<ReturnType<typeof nativeCredentialStore>> | undefined;
let providerDispatch: ProviderDispatch | undefined;
let developmentCommand: DevelopmentCommand | undefined;
// Switches a later launch hands over before this instance has loaded its development command.
const earlyDevelopmentSwitches: unknown[] = [];
let connectionsRead = false;
// The development command's switches of this launch; only the development mode admits any.
const developmentSwitches = process.argv.slice(1).filter(isDevelopmentSwitch);
let pendingWindows = 0;
// ADR-0047: Linux windows also receive the desktop portal's reduced-motion setting.
let systemMotion: SystemMotionNotice = { sequence: 0, value: "unknown" };
const motionObserver =
  process.platform === "linux"
    ? new SystemMotionObserver(nativeSystemMotionHost(), (value) => {
        systemMotion = { sequence: systemMotion.sequence + 1, value };
        for (const window of windows.keys())
          if (!window.isDestroyed())
            window.webContents.send(desktopChannels.systemMotion, systemMotion);
      })
    : undefined;
// Electron resolves its automatic Ozone selection before loading the application module.
const nativeWayland =
  process.platform === "linux" && app.commandLine.getSwitchValue("ozone-platform") === "wayland";

const windowTheme = new WindowTheme(process.platform, () => nativeTheme.shouldUseDarkColors);
const windowPreferences = new WindowPreferences(
  () => (bootstrapState === "storage_ready" ? service : undefined),
  () => {
    void diagnostics?.append({
      event_name: "ohtia.window.bounds_failed",
      error_code: "storage_failed",
    });
  },
  portLimits.pending_global,
);
function updateWindowThemes(): void {
  // One confirmed source also sets Chromium's media query before a new renderer can paint.
  const source = windowTheme.source(bootstrapState === "storage_ready");
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  for (const [window, state] of windows)
    windowTheme.apply(window, state.workspace && bootstrapState === "storage_ready");
}
/** Native maximize/restore can reveal a window; every activation uses its permitted reveal gate. */
function presentWindow(window: BrowserWindow, activate = false): void {
  const state = windows.get(window);
  if (!state || window.isDestroyed()) return;
  state.activate ||= activate;
  if (!state.presentable || quitting) return;
  if (state.activate && window.isMinimized()) window.restore();
  if (state.firstShow) {
    state.firstShow = false;
    if (state.maximizeOnShow) window.maximize();
    window.show();
  } else if (state.activate) {
    window.show();
  }
  if (state.activate) {
    state.activate = false;
    window.focus();
  }
}
function saveWindowBounds(window: BrowserWindow): void {
  const state = windows.get(window);
  if (
    bootstrapState !== "storage_ready" ||
    !state?.workspace ||
    state.boundsSaved ||
    window.isDestroyed()
  )
    return;
  state.boundsSaved = true;
  void windowPreferences.save({
    version: 1,
    ...window.getNormalBounds(),
    maximized: window.isMaximized(),
  });
}

let diagnostics: DiagnosticWriter | undefined;
const diagnosticBundle = new DiagnosticBundleFlow<BrowserWindow>();
function openDiagnostics(): DiagnosticWriter {
  return new DiagnosticWriter({
    root: context.research_root,
    version: app.getVersion(),
    canStartPermissionHelper: () =>
      app.getAppMetrics().length +
        (diagnostics?.reservedPermissionProcesses ?? 0) +
        (service && !service.ceased ? 0 : 1) +
        diagnosticLimits.permissionProcesses <=
      portLimits.process_tree_count,
    assertAdmission: () => {
      verifyStableSentinels(context);
      validateDataDirectory(context.research_root, settings, context);
    },
  });
}
function resumeDiagnostics(event?: DiagnosticEvent): void {
  const previous = diagnostics;
  if (!previous) return;
  void recoverDiagnosticsAfterShutdown(
    previous,
    () => diagnostics === previous && !quitting,
    () => {
      diagnostics = openDiagnostics();
      if (event) void diagnostics.append(event);
    },
  );
}
let storageRequested = false;
let storageActionPending = false;
let verifiedCheckpoint:
  { readonly value: VerifiedCheckpoint; readonly verification: string } | undefined;
let checkpointProblem: CheckpointProblem | undefined;
let restoreOutcome: BootstrapNotice | undefined;
let admissionFallback: BootstrapState = "storage_failed";
let localeFallback = false;
let generation = randomUUID();
let bootstrapState: BootstrapState = "missing";
let admittedStoreRoot: string | undefined;
let quitting = false;
const isQuitting = () => quitting;
let cleanExit = false;
let exitApproved = false;
let systemShutdown = false;
let exitWindow: BrowserWindow | undefined;
let lastFocusedWindow: BrowserWindow | undefined;
let presentedExitOperation: string | undefined;
function publishExit(state: ExitDialogState | undefined): void {
  if (exitWindow?.isDestroyed()) exitWindow = undefined;
  if (!exitWindow)
    exitWindow =
      lastFocusedWindow && !lastFocusedWindow.isDestroyed()
        ? lastFocusedWindow
        : [...windows.keys()].find((window) => !window.isDestroyed());
  if (exitWindow) {
    exitWindow.webContents.send(desktopChannels.exitState, state ?? null);
    if (state && presentedExitOperation !== state.operationId) {
      presentedExitOperation = state.operationId;
      presentWindow(exitWindow, true);
    } else if (!state) {
      exitWindow = undefined;
      presentedExitOperation = undefined;
    }
  }
}
const applicationExit = new ApplicationExit({
  identity: randomUUID,
  send: (control) =>
    service?.generation === control.generation && service.postProvider(JSON.stringify(control)),
  changed: publishExit,
  finish: () => {
    exitApproved = true;
    app.quit();
  },
  failed: () => {
    void reportError("command.failed");
  },
});
function operatingSystemExit(): void {
  systemShutdown = true;
  service?.markSystemShutdown();
  if (!quitting && !cleanExit) applicationExit.systemShutdown();
}
app.on("browser-window-focus", (_event, window) => {
  if (windows.has(window)) lastFocusedWindow = window;
});
if (process.platform === "linux") process.on("SIGTERM", operatingSystemExit);
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
    // Fatal notices already require shutdown after acknowledgement.
    exitApproved = true;
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
  Object.defineProperty(globalThis, "__ohtiaAcceptance", {
    value: () => ({ ...acceptance }),
    configurable: true,
  });
const bootstrapPlacements = acceptance
  ? new WeakMap<
      BrowserWindow,
      { bounds: ReturnType<typeof requestBootstrapPlacement>; maximized: boolean }
    >()
  : undefined;
if (bootstrapPlacements)
  Object.defineProperty(globalThis, "__ohtiaBootstrapPlacement", {
    value: (window: BrowserWindow) => bootstrapPlacements.get(window),
    configurable: true,
  });
let metricTimer: ReturnType<typeof setInterval> | undefined;
const snapshot = (window: BrowserWindow): BootstrapSnapshot => {
  const windowState = windows.get(window);
  const openConversation = windowState?.openConversation;
  const checkpoint = bootstrapState === "recovery_required" ? verifiedCheckpoint : undefined;
  return {
    ...(openConversation ? { openConversation } : {}),
    ...(windowState?.navigateConversation
      ? { navigateConversation: windowState.navigateConversation }
      : {}),
    ...(windowState ? { restoreLastProject: windowState.restoreLastProject } : {}),
    ...(bootstrapState === "storage_ready" ? { serviceGeneration: generation } : {}),
    version: 1,
    locale,
    state: bootstrapState === "missing" ? "pending_create" : bootstrapState,
    ...(checkpoint
      ? {
          checkpoint: {
            operation: checkpoint.value.operation,
            sourceRevision: checkpoint.value.sourceRevision,
            targetRevision: checkpoint.value.targetRevision,
            release: checkpoint.value.release,
            bytes: checkpoint.value.bytes,
            verification: checkpoint.verification,
          },
        }
      : {}),
    ...(bootstrapState === "retry_required" && checkpointProblem ? { checkpointProblem } : {}),
    ...(localeFallback && bootstrapState === "storage_ready"
      ? { notice: "locale_fallback" }
      : restoreOutcome
        ? { notice: restoreOutcome }
        : {}),
  };
};
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
function attach(window: BrowserWindow) {
  const state = windows.get(window);
  if (!state) return false;
  const frame = window.webContents.mainFrame;
  if (frame.url !== desktopDocument) return false;
  if (state.frame === frame && state.detach) return state;
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
  return state;
}
function detach(window: BrowserWindow): void {
  diagnosticBundle.discard(window);
  const state = windows.get(window);
  if (!state) return;
  state.detach?.();
  delete state.detach;
  delete state.frame;
  delete state.researchSelection;
  delete state.researchProjectId;
  delete state.researchSubscription;
  service?.disposeWindow(state.generation);
  connections?.disposeWindow(state.generation);
}
async function createWindow(
  focused?: BrowserWindow,
  admitted: () => boolean = () => true,
): Promise<CommandResult> {
  if (quitting || !admitted()) return { status: "revoked" };
  if (windows.size + pendingWindows >= portLimits.windows)
    return { status: "unavailable", reason: "window_limit" };
  pendingWindows++;
  try {
    const workspace = bootstrapState === "storage_ready";
    const owner = service;
    const saved = workspace ? await windowPreferences.read() : undefined;
    if (saved && !saved.ok && saved.error.code === "busy")
      return { status: "unavailable", reason: "busy" };
    const appearance = workspace ? await owner?.request("appearance.read", {}) : undefined;
    if (appearance && !appearance.ok && appearance.error.code === "busy")
      return { status: "unavailable", reason: "busy" };
    if (
      isQuitting() ||
      !admitted() ||
      (workspace && (service !== owner || bootstrapState !== "storage_ready"))
    )
      return { status: "revoked" };
    const placement = windowPlacement(
      saved?.ok ? saved.value.value : null,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
      workspace && focused && !focused.isDestroyed() && focused.isFocused()
        ? focused.getNormalBounds()
        : undefined,
      nativeWayland ? "wayland" : "positioned",
    );
    return constructWindow(placement, workspace);
  } finally {
    pendingWindows--;
  }
}
let firstProjectWindow = true;
function constructWindow(
  placement: ReturnType<typeof windowPlacement>,
  workspace: boolean,
): CommandResult {
  if (quitting) return { status: "revoked" };
  if (windows.size >= portLimits.windows) return { status: "unavailable", reason: "window_limit" };
  if (
    app.getAppMetrics().length + (diagnostics?.reservedPermissionProcesses ?? 0) >=
    portLimits.process_tree_count
  ) {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) presentWindow(existing, true);
    return { status: "unavailable", reason: "busy" };
  }
  const window = new BrowserWindow({
    ...windowOptions(process.platform, windowTheme.scheme(workspace), placement, nativeWayland),
    enableLargerThanScreen: process.env.OHTIA_RUNTIME_ACCEPTANCE === "1",
    title: message(locale, "title"),
    webPreferences: {
      ...rendererWebPreferences(path.join(directory, "preload.cjs")),
      session: desktopSession,
    },
  });
  const outer = window.getBounds();
  const content = window.getContentBounds();
  window.setMinimumSize(
    windowMinimum.width + outer.width - content.width,
    windowMinimum.height + outer.height - content.height,
  );
  windows.set(window, {
    restoreLastProject: firstProjectWindow,
    generation: randomUUID(),
    workspace,
    boundsSaved: false,
    presentable: false,
    documentPrepared: false,
    frameReady: false,
    firstShow: true,
    activate: false,
    maximizeOnShow: placement.maximized,
  });
  firstProjectWindow = false;
  commandMenus.attach(window);
  window.webContents.on("zoom-changed", (_event, direction) => {
    commandMenus.dispatch(window, direction === "in" ? "zoom.increase" : "zoom.decrease", true);
  });
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
    const current = windows.get(window);
    if (current) current.manuscriptPending = false;
    detach(window);
  });
  window.webContents.on("will-prevent-unload", (event) => {
    // Shutdown and a completed exit proceed; otherwise ask the renderer about its pending manuscript text.
    if (systemShutdown || cleanExit) {
      event.preventDefault();
      return;
    }
    const current = windows.get(window);
    if (current) current.manuscriptPending = true;
    window.webContents.send(desktopChannels.manuscriptClose, "window.close");
  });
  window.on("close", (event) => {
    if (!systemShutdown && windows.get(window)?.manuscriptPending) {
      event.preventDefault();
      window.webContents.send(desktopChannels.manuscriptClose, "window.close");
      return;
    }
    saveWindowBounds(window);
    if (!cleanExit && windows.size === 1) {
      event.preventDefault();
      exitWindow = window;
      app.quit();
    }
  });
  if (process.platform === "win32") {
    window.on("query-session-end", operatingSystemExit);
    window.on("session-end", operatingSystemExit);
  }
  window.on("closed", () => {
    detach(window);
    windows.delete(window);
    if (exitWindow === window) {
      exitWindow = undefined;
      presentedExitOperation = undefined;
      publishExit(applicationExit.state);
    }
  });
  const permitPresentation = () => {
    const state = windows.get(window);
    if (!state || window.isDestroyed()) return;
    if (!state.documentPrepared || (!state.frameReady && !nativeWayland)) return;
    state.presentable = true;
    clearTimeout(startup);
    presentWindow(window);
  };
  window.once("ready-to-show", () => {
    const state = windows.get(window);
    if (state) state.frameReady = true;
    permitPresentation();
  });
  const loadDocument = () => {
    void window
      .loadURL(desktopDocument)
      .then(async () => {
        if (window.isDestroyed()) return;
        await window.webContents.setVisualZoomLevelLimits(1, 1);
        if (window.isDestroyed()) return;
        if (!presentationBroker.apply(window.webContents).applied)
          throw new Error("Confirmed interface zoom could not be applied before presentation.");
        const state = windows.get(window);
        if (!state) return;
        state.documentPrepared = true;
        // Some Wayland compositors defer hidden paint until mapping the loaded local document.
        if (
          (nativeWayland || state.frameReady) &&
          !window.isDestroyed() &&
          window.webContents.mainFrame.url === desktopDocument
        )
          permitPresentation();
      })
      .catch(() => {
        if (!window.isDestroyed()) quitAfterError("startup_failed");
      });
  };
  if (acceptance && process.env.OHTIA_RUNTIME_DEFER_DOCUMENT === "1" && windows.size === 1) {
    // An inert navigation lets automation attach before the first application document.
    void window.loadURL("about:blank").catch(() => {
      quitAfterError("startup_failed");
    });
    // Only the admitted main-process inspector may release this bounded acceptance barrier.
    let released = false;
    const clear = () => {
      released = true;
      clearTimeout(deadline);
      Reflect.deleteProperty(globalThis, "__ohtiaLoadInitialDocument");
    };
    const deadline = setTimeout(() => {
      clear();
      quitAfterError("startup_failed");
    }, portLimits.application_start_ms);
    Object.defineProperty(globalThis, "__ohtiaLoadInitialDocument", {
      configurable: true,
      value: () => {
        if (released) return;
        released = true;
        clear();
        loadDocument();
      },
    });
    window.once("closed", clear);
  } else loadDocument();
  return { status: "completed" };
}
function startService(
  mode?: "open" | "retry" | "restore" | "blocked",
  checkpoint?: VerifiedCheckpoint,
): void {
  if (quitting || (service && !service.ceased)) return;
  if (providerDispatch && !providerDispatch.ceased) {
    // Recovery classifies old attempts only after every ended-generation transport has closed.
    void providerDispatch.drain().then(() => {
      startService(mode, checkpoint);
    });
    return;
  }
  const locator = readLocator(settings, context);
  bootstrapState = refreshLocatorState(bootstrapState, locator.state);
  if (mode === undefined) {
    mode = context.mode !== "qualification" && locator.state === "located" ? "open" : "blocked";
    if (mode === "open") {
      storageRequested = true;
      admissionFallback = storageInterruptionState(bootstrapState);
      bootstrapState = "storage_opening";
    }
  }
  const storageMode = [
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
    ? mode === "open" && locator.state === "missing"
      ? "create"
      : mode
    : "blocked";
  admittedStoreRoot = undefined;
  const admitsStorage =
    storageMode !== "blocked" && (locator.state === "missing" || locator.state === "located");
  const openingRoot = admitsStorage ? managedStoreRootIdentity(context.research_root) : undefined;
  generation = randomUUID();
  windowTheme.reset();
  updateWindowThemes();
  const child = utilityProcess.fork(
    path.join(directory, "utility.mjs"),
    [
      serviceContext,
      generation,
      resolveInterfaceLocale(preferredSystemLanguages()),
      storageMode,
      app.getVersion(),
      ...(storageMode === "restore" && checkpoint ? [checkpoint.operation, checkpoint.sha256] : []),
    ],
    {
      serviceName: "Ohtia data service",
      stdio: "ignore",
      execArgv: [],
      cwd: context.scratch_root,
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
        HOME: context.home,
        USERPROFILE: context.home,
        TMPDIR: context.scratch_root,
        TEMP: context.scratch_root,
        TMP: context.scratch_root,
      },
    },
  );
  let failureReported = false;
  const serviceGeneration = generation;
  providerDispatch?.begin(serviceGeneration);
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
    (state, requestedStop = false) => {
      if (state === "ready") {
        void diagnostics?.append({ event_name: "ohtia.service.ready" }, serviceGeneration);
        if (connections && service) service.reportConnections(connections.manager);
        developmentCommand?.flush();
      } else if (!requestedStop && !failureReported) {
        applicationExit.abort(false);
        failureReported = true;
        void diagnostics?.append(
          { event_name: "ohtia.service.unavailable", error_code: "service_unavailable" },
          serviceGeneration,
        );
      }
      if (state === "unavailable") {
        // Close every provider request of the ending generation before another service starts.
        providerDispatch?.end(serviceGeneration);
        if (storageRequested && !requestedStop) {
          if (mode === "restore" && bootstrapState === "storage_opening")
            restoreOutcome = "recovery_uncertain";
          if (!storageActionPending || mode === "restore")
            bootstrapState = storageInterruptionState(
              bootstrapState === "storage_opening" ? admissionFallback : bootstrapState,
            );
        }
        updateWindowThemes();
        for (const window of windows.keys())
          if (!window.isDestroyed()) window.webContents.send(desktopChannels.ended, generation);
      }
    },
    (notice) => {
      const active = service;
      if (!active || notice.generation !== generation) return;
      admissionFallback = "storage_failed";
      bootstrapState = notice.state;
      verifiedCheckpoint = notice.checkpoint
        ? { value: notice.checkpoint, verification: randomUUID() }
        : undefined;
      checkpointProblem = notice.checkpointProblem;
      restoreOutcome = notice.restoreFailure;
      updateWindowThemes();
      if (notice.state !== "storage_ready") return;
      bootstrapState = "storage_opening";
      const locator = readLocator(settings, context);
      if (locator.state !== "missing" && locator.state !== "located") {
        bootstrapState = locator.state;
        return;
      }
      const publication =
        locator.state === "located"
          ? Promise.resolve("confirmed" as const)
          : publisher.publish(
              settings,
              context.research_root,
              context,
              () => Promise.resolve(!quitting && service === active && active.available),
              posixLocatorIO,
            );
      void publication.then(async (result) => {
        if (quitting || service !== active || generation !== notice.generation) return;
        const systemLocale = resolveInterfaceLocale(preferredSystemLanguages());
        const resolvedLocale = resolveInterfaceLocale([systemLocale], notice.savedLocale);
        active.setSystemLocale(systemLocale);
        const activated = completeStorageActivation(result, active, resolvedLocale);
        bootstrapState = activated === "storage_ready" ? "storage_opening" : activated;
        if (activated === "storage_ready") {
          locale = resolvedLocale;
          localeFallback = notice.localeFallback === true;
          const saved = await active.request("bounds.read", {});
          const appearance = await active.request("appearance.read", {});
          if (
            isQuitting() ||
            service !== active ||
            generation !== notice.generation ||
            bootstrapState !== "storage_opening"
          )
            return;
          if (!active.available || !saved.ok || !appearance.ok) {
            bootstrapState = storageInterruptionState(admissionFallback);
            updateWindowThemes();
            return;
          }
          presentationBroker.initialize(active);
          // Only a successful read decides; a passing failure leaves a later generation to retry.
          void active.request("updateCheck.read", {}).then((saved) => {
            if (saved.ok) updates.startup(saved.value.value);
          });
          const placement = windowPlacement(
            saved.value.value,
            screen.getAllDisplays().map((display) => display.workArea),
            screen.getPrimaryDisplay().workArea,
            undefined,
            nativeWayland ? "wayland" : "positioned",
          );
          for (const [existing, state] of windows)
            if (!existing.isDestroyed()) {
              if (!state.workspace) {
                const bounds = requestBootstrapPlacement(
                  existing,
                  placement,
                  state.presentable && !state.firstShow,
                  nativeWayland,
                );
                bootstrapPlacements?.set(existing, { bounds, maximized: placement.maximized });
                state.maximizeOnShow = placement.maximized;
              }
              state.workspace = true;
              state.boundsSaved = false;
            }
          admittedStoreRoot = openingRoot;
          bootstrapState = "storage_ready";
          developmentCommand?.flush();
          updateWindowThemes();
          void windowPreferences.reconcilePending();
          for (const existing of windows.keys())
            if (!existing.isDestroyed())
              existing.webContents.send(desktopChannels.preferencesReady, generation);
        }
      });
    },
    admitsStorage,
    (event, correlation) => {
      void diagnostics?.append(event, correlation ?? serviceGeneration);
    },
    (snapshot) => {
      locale = snapshot.effectiveLocale;
      localeFallback = snapshot.record.source === "invalid_fallback";
      for (const window of windows.keys())
        if (!window.isDestroyed()) window.setTitle(message(locale, "title"));
    },
    (snapshot) => {
      presentationBroker.accept(snapshot);
    },
    (record) => {
      if (windowTheme.confirm(record)) updateWindowThemes();
    },
    requestBudget,
    () => providerDispatch?.drain() ?? Promise.resolve(),
  );
  const active = service;
  active.connectProvider({
    exitState: (state) => {
      applicationExit.receive(state);
    },
    wakeReviewed: (message) => {
      providerDispatch?.wakeReviewed(message);
    },
    refreshModels: (message) => {
      connections?.manager.refreshModels(message.connection, true);
      if (connections && service) service.reportConnections(connections.manager);
    },
    dispatch: (message) => {
      void providerDispatch?.receive(message);
    },
    usageReceipt: (message) => providerDispatch?.usageReceipt(message),
    interrupt: (message) => {
      providerDispatch?.interrupt(message);
    },
    report: (message) => {
      developmentCommand?.report(message);
    },
  });
}
let desktopSession: Electron.Session;
// A later development launch hands its switches to this instance through `second-instance`.
const ownsBroker = app.requestSingleInstanceLock(
  context.mode === "development" ? { development_switches: developmentSwitches } : undefined,
);
if (!ownsBroker) {
  app.exit(0);
  throw new Error("The existing broker owns this native context.");
}
app.on("second-instance", (_event, _argv, _directory, data) => {
  const switches =
    data && typeof data === "object" && "development_switches" in data
      ? data.development_switches
      : undefined;
  if (Array.isArray(switches) && switches.length) {
    // A development command reaches the open instance without taking the researcher's focus.
    if (developmentCommand) developmentCommand.run(switches);
    else if (context.mode === "development" && earlyDevelopmentSwitches.length < 16)
      earlyDevelopmentSwitches.push(switches);
    return;
  }
  const window = BrowserWindow.getAllWindows()[0];
  if (window) presentWindow(window, true);
});
const startup = setTimeout(() => {
  quitAfterError("startup_failed");
}, portLimits.application_start_ms);
async function start(): Promise<void> {
  motionObserver?.start();
  await app.whenReady();
  if (process.platform !== "win32") powerMonitor.on("shutdown", operatingSystemExit);
  observeServicePower(powerMonitor, {
    generation: () => generation,
    suspend: () => providerDispatch?.suspend(),
    wake: (message) => providerDispatch?.wake(message),
    post: (text) => {
      service?.postWake(text);
    },
  });
  credentials = await nativeCredentialStore(context, app.getPath("userData"));
  const developmentProvider =
    typeof __OHTIA_DEVELOPMENT_BUILD__ !== "undefined" &&
    __OHTIA_DEVELOPMENT_BUILD__ &&
    context.mode === "development"
      ? await import("./fake-provider.js")
      : undefined;
  const connectionDiagnostic = (event: DiagnosticEvent) => {
    void diagnostics?.append(event);
  };
  const anthropic = new AnthropicProvider({
    store: credentials,
    model: (id) => connections?.manager.model(anthropicConnection, id),
    refresh: () => connections?.manager.refreshModels(anthropicConnection, true),
  });
  const adapters = [
    new ChatGPTProvider({
      store: credentials,
      openBrowser: (url) => shell.openExternal(url),
      completedText: () => message(locale, "connection.browserComplete"),
      diagnostic: connectionDiagnostic,
    }),
    anthropic,
    new OpenAIProvider({
      store: credentials,
      refresh: () => connections?.manager.refreshModels(openaiConnection, true),
    }),
    ...(developmentProvider ? [developmentProvider.createFakeProvider()] : []),
  ];
  if (acceptance && developmentProvider)
    Object.defineProperty(globalThis, "__ohtiaCredentialAcceptance", {
      configurable: true,
      value: developmentProvider.credentialAcceptance(credentials),
    });
  connections = new ConnectionBroker(
    new ConnectionManager(adapters, connectionDiagnostic),
    connectionDiagnostic,
  );
  const manager = connections.manager;
  providerDispatch = new ProviderDispatch(adapters, {
    state: (connection) => manager.snapshot(connection)?.state,
    mayDispatchModel: (connection, model, effort, expectedAccount) =>
      manager.mayDispatchModel(connection, model, effort, expectedAccount),
    send: (target, text) => {
      if (service?.generation === target) service.postProvider(text);
    },
    diagnostic: (event, target) => {
      void diagnostics?.append(event, target);
    },
  });
  if (
    typeof __OHTIA_DEVELOPMENT_BUILD__ !== "undefined" &&
    __OHTIA_DEVELOPMENT_BUILD__ &&
    context.mode === "development"
  ) {
    const development = await import("./development-command.js");
    developmentCommand = development.createDevelopmentCommand({
      openConversation: (projectId, conversationId) => {
        const window =
          BrowserWindow.getFocusedWindow() ??
          [...windows.keys()].find((window) => !window.isDestroyed());
        const state = window && windows.get(window);
        if (state) {
          state.openConversation = { projectId, conversationId };
          state.navigateConversation = {
            projectId,
            conversationId,
            revision: (state.navigateConversation?.revision ?? 0) + 1,
          };
        }
      },
      ready: () =>
        connectionsRead && service?.available && bootstrapState === "storage_ready"
          ? service.generation
          : undefined,
      post: (text, target) => (service?.generation === target ? service.postProvider(text) : false),
    });
    developmentCommand.run(developmentSwitches);
    for (const early of earlyDevelopmentSwitches.splice(0)) developmentCommand.run(early);
  }
  // Native unlock prompts must not delay the local research workspace or its startup deadline.
  void Promise.all(manager.ids().map((id) => manager.read(id)))
    .catch(() => {
      connectionDiagnostic({
        event_name: "ohtia.connection.failed",
        error_code: "store_unavailable",
      });
    })
    .finally(() => {
      connectionsRead = true;
      if (service?.available) service.reportConnections(manager);
      developmentCommand?.flush();
    });
  const connectionStates = new Map<string, { state: string; account: string | undefined }>();
  manager.subscribe((event) => {
    const before = connectionStates.get(event.connection);
    connectionStates.set(event.connection, { state: event.state, account: event.account_revision });
    if (
      event.state === "connected" &&
      (before?.state !== "connected" || before.account !== event.account_revision)
    )
      manager.refreshModels(event.connection, event.model_list_revision === null);
    if (service?.available) service.reportConnections(manager);
  });
  const refreshModels = setInterval(() => {
    for (const connection of manager.ids()) manager.refreshModels(connection);
  }, 60_000);
  refreshModels.unref();
  app.once("will-quit", () => {
    clearInterval(refreshModels);
  });
  nativeTheme.on("updated", updateWindowThemes);
  locale = resolveInterfaceLocale(preferredSystemLanguages());
  commandMenus.refresh();
  const locator = readLocator(settings, context);
  bootstrapState = locator.state;
  // Diagnostic failure never participates in storage readiness or save admission.
  // Before the first explicit opening, the research root may not exist yet.
  if (["missing", "located"].includes(locator.state) && fs.existsSync(context.research_root)) {
    diagnostics = openDiagnostics();
    void diagnostics.append({
      event_name: "ohtia.application.started",
      timestamp: new Date().toISOString(),
    });
  }
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
    if (!input || typeof input !== "object" || !isRendererAssetPath(name))
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
    const state = window && attach(window);
    event.returnValue = state
      ? { windowGeneration: state.generation, serviceGeneration: generation }
      : null;
  });
  ipcMain.on(desktopChannels.systemMotion, (event) => {
    event.returnValue = trusted(event) ? systemMotion : null;
  });
  ipcMain.on(desktopChannels.port, (event, text: unknown) => {
    if (acceptance) acceptance.received++;
    const window = trusted(event);
    const windowState = window && attach(window);
    if (!window || !windowState || !event.senderFrame) {
      void diagnostics?.append({ event_name: "ohtia.port.rejected", error_code: "frame_rejected" });
      if (acceptance) acceptance.rejectedFrame++;
      return;
    }
    const sender = { frame: event.senderFrame, url: event.senderFrame.url };
    const authority = admission.authorize(sender, text);
    if (!authority.ok) {
      void diagnostics?.append({
        event_name: "ohtia.port.rejected",
        error_code: "invalid_message",
      });
      if (acceptance) acceptance.rejectedEnvelope++;
      return;
    }
    if (authority.value.kind === "cancel" || authority.value.kind === "unsubscribe") {
      const control = authority.value;
      if (
        control.kind === "unsubscribe" &&
        windowState.researchSubscription === control.subscriptionId
      ) {
        delete windowState.researchSubscription;
        delete windowState.researchSelection;
        delete windowState.researchProjectId;
      }
      if (!connections?.control(authority.value)) service?.control(authority.value);
      return;
    }
    const accepted =
      authority.value.kind === "request" && authority.value.operation.startsWith("bounds.")
        ? {
            ok: false as const,
            error: {
              code: "unauthorized" as const,
              nextAction: "reopen_window" as const,
              parameters: {},
            },
          }
        : admission.admit(sender, text);
    const selection =
      accepted.ok && accepted.value.request.operation === "research.subscribe"
        ? accepted.value.request
        : undefined;
    if (selection) {
      windowState.researchSelection = selection.requestId;
      windowState.researchSubscription = selection.payload.subscriptionId;
      delete windowState.researchProjectId;
    }
    const frame = event.senderFrame;
    const deliver = (reply: string) => {
      if (
        !window.isDestroyed() &&
        frame === window.webContents.mainFrame &&
        frame.url === desktopDocument &&
        windows.get(window)?.frame === frame
      ) {
        if (selection && windowState.researchSelection === selection.requestId) {
          const decoded = decodeText(reply);
          if (
            decoded.ok &&
            decoded.value.kind === "result" &&
            decoded.value.requestId === selection.requestId &&
            decoded.value.payload.ok
          ) {
            const scope = selection.payload;
            windowState.researchProjectId = scope.projectId;
            if (scope.projectId && scope.conversationId)
              windowState.openConversation = {
                projectId: scope.projectId,
                conversationId: scope.conversationId,
              };
            else delete windowState.openConversation;
          }
        }
        frame.send(desktopChannels.reply, reply);
      }
    };
    if (!accepted.ok) {
      if (authority.value.kind === "request") {
        const reply = encodeEnvelope({ ...authority.value, kind: "result", payload: accepted });
        if (reply.ok) deliver(reply.value);
      }
      return;
    }
    const request = accepted.value.request;
    const projectScope = projectResearchScope(request);
    if (
      (projectScope &&
        (windowState.researchProjectId !== projectScope.projectId ||
          windowState.researchSubscription !== projectScope.subscriptionId)) ||
      ((request.operation === "project.rename" || request.operation === "project.read") &&
        windowState.researchProjectId !== request.payload.projectId)
    ) {
      const reply = encodeEnvelope({
        ...request,
        kind: "result",
        payload: failure("unauthorized"),
      });
      accepted.value.release();
      if (reply.ok) deliver(reply.value);
      return;
    }
    if (
      bootstrapState !== "storage_ready" &&
      (accepted.value.request.operation.endsWith(".replace") ||
        accepted.value.request.operation === "zoom.adjust")
    ) {
      const reply = encodeEnvelope({
        ...accepted.value.request,
        kind: "result",
        payload: failure("service_unavailable"),
      });
      accepted.value.release();
      accepted.value.releaseSubscription();
      if (reply.ok) deliver(reply.value);
      return;
    }
    if (accepted.value.request.operation === "layout.failureNotice") {
      const reply = encodeEnvelope({
        ...accepted.value.request,
        kind: "result",
        payload: { ok: true, value: { announce: !layoutFailureAnnounced } },
      });
      layoutFailureAnnounced = true;
      accepted.value.release();
      if (reply.ok) deliver(reply.value);
      return;
    }
    if (accepted.value.request.operation === "managedStore.readLocation") {
      const reply = encodeEnvelope({
        ...accepted.value.request,
        kind: "result",
        payload: {
          ok: true,
          value: readManagedStoreLocation(settings, context, bootstrapState, admittedStoreRoot),
        },
      });
      accepted.value.release();
      if (reply.ok) deliver(reply.value);
      return;
    }
    if (updates.handle({ ...accepted.value, deliver })) return;
    if (connections?.handle({ ...accepted.value, deliver })) return;
    if (!service) {
      accepted.value.release();
      accepted.value.releaseSubscription();
      return;
    }
    if (acceptance) acceptance.dispatched++;
    if (
      authority.value.kind === "request" &&
      authority.value.operation === "locale.replace" &&
      authority.value.payload.value === "system"
    )
      service.setSystemLocale(resolveInterfaceLocale(preferredSystemLanguages()));
    if (!presentationBroker.handle({ ...accepted.value, deliver }, service, window.webContents))
      service.dispatch({ ...accepted.value, deliver });
  });
  let about: ReturnType<typeof readAboutInformation> | undefined;
  const aboutInformation = () => {
    if (!isCommandPlatform(process.platform)) throw new Error("Unsupported command platform.");
    return (about ??= readAboutInformation(
      directory,
      app.getVersion(),
      process.platform,
      process.arch,
    ));
  };
  ipcMain.handle(desktopChannels.commands, async (event, action: unknown, payload: unknown) => {
    const window = trusted(event);
    if (!window) throw new Error("Command sender admission refused.");
    if (action === "manuscript_pending" && typeof payload === "boolean") {
      const state = windows.get(window);
      if (state) state.manuscriptPending = payload;
      return state !== undefined;
    }
    if (action === "exit_state" && payload === undefined)
      return window === exitWindow ? (applicationExit.state ?? null) : null;
    if (
      action === "exit_choice" &&
      payload &&
      typeof payload === "object" &&
      Object.keys(payload).sort().join(",") === "choice,operationId"
    ) {
      const request = payload as Record<string, unknown>;
      return window === exitWindow &&
        isIdentifier(request.operationId) &&
        isExitChoice(request.choice)
        ? applicationExit.choose(request.operationId, request.choice)
        : false;
    }
    // Session and snapshot controls complete synchronously, like the existing port handshake.
    if (action === "context" && payload === undefined) return commandMenus.connect(window);
    if (action === "publish") return commandMenus.publish(window, payload);
    if (action === "perform" && (payload === "window.close" || payload === "application.quit")) {
      if (payload === "window.close") commandLifecycle.close(window);
      else commandLifecycle.quit();
      return true;
    }
    const frame = event.senderFrame;
    if (!frame) throw new Error("Command sender admission refused.");
    const reservation = requestBudget.reserve(frame);
    if (!reservation.ok)
      return action === "window_action" && isWindowCommandRequest(payload)
        ? { status: "unavailable", reason: "busy" }
        : false;
    try {
      if (action === "window_action" && isWindowCommandRequest(payload)) {
        return await commandMenus.execute(window, payload, async (current) => {
          if (payload.intent.command === "menu.open") {
            const outcome = await commandMenus.popup(window, payload);
            return outcome === "revoked"
              ? { status: "revoked" }
              : outcome
                ? { status: "completed", menuDismissed: outcome === "dismissed" }
                : { status: "failed" };
          }
          const opened = await createWindow(window, current);
          return !current() ? { status: "revoked" } : opened;
        });
      }
      if (action === "about" && payload === undefined) return aboutInformation();
      if (action === "update_route" && payload === undefined) return updateRoute(updateHost);
      if (action === "open_update_route" && payload === undefined)
        return await openUpdateRoute(updateHost);
      const messageDiagnostic = (event_name: DiagnosticEventName) => {
        void diagnostics?.append({ event_name });
      };
      if (action === "open_external_link")
        return await openExternalMessageLink(
          payload,
          (url) => shell.openExternal(url),
          messageDiagnostic,
        );
      if (action === "copy_message") {
        const owner = service;
        const scope = windows.get(window)?.openConversation;
        if (!owner || bootstrapState !== "storage_ready" || !scope) {
          messageDiagnostic("ohtia.message.copy_failed");
          return false;
        }
        const generation = windows.get(window)?.generation;
        return await copyMessage(
          payload,
          scope.conversationId,
          owner,
          clipboard,
          () =>
            trusted(event) === window &&
            windows.get(window)?.frame === frame &&
            windows.get(window)?.generation === generation &&
            windows.get(window)?.openConversation === scope &&
            service === owner &&
            owner.available &&
            bootstrapState === "storage_ready",
          messageDiagnostic,
        );
      }
      if (
        action === "open_link" &&
        typeof payload === "string" &&
        Object.hasOwn(projectLinks, payload)
      ) {
        await shell.openExternal(projectLinks[payload as keyof typeof projectLinks]);
        return true;
      }
      if (action === "open_notice_link" && typeof payload === "string") {
        // The renderer names a component; only the URL in main's own bundled notices is opened.
        const notice = aboutInformation().notices.find((entry) => entry.component === payload);
        if (!notice) return false;
        await shell.openExternal(notice.url);
        return true;
      }
      if (action === "copy_version" && isInterfaceLocale(payload))
        return await copyVersionInformation(aboutInformation(), payload, clipboard);
      if (
        action !== "perform" ||
        !isNativeCommand(payload) ||
        payload === "window.close" ||
        payload === "application.quit"
      )
        return false;
      if (payload === "link.documentation" || payload === "link.report") {
        await shell.openExternal(
          projectLinks[payload === "link.report" ? "report" : "documentation"],
        );
        return true;
      }
      if (payload === "window.fullscreen") window.setFullScreen(!window.isFullScreen());
      else {
        const edit = {
          "edit.undo": "undo",
          "edit.redo": "redo",
          "edit.cut": "cut",
          "edit.copy": "copy",
          "edit.paste": "paste",
          "edit.selectAll": "selectAll",
        } as const;
        window.webContents[edit[payload]]();
      }
      return true;
    } catch {
      return false;
    } finally {
      reservation.value();
    }
  });
  ipcMain.handle(
    desktopChannels.diagnosticsRead,
    async (event, input: unknown, ...extra: unknown[]): Promise<DiagnosticReadResult> => {
      const window = trusted(event);
      const frame = event.senderFrame;
      const writer = diagnostics;
      if (!window || !frame || !writer) return { status: "unavailable" };
      const request = extra.length === 0 && decodeDiagnosticReadRequest(input);
      if (!request) return { status: "invalid_request" };
      const reservation = requestBudget.reserve(frame);
      if (!reservation.ok) return { status: "busy" };
      try {
        const page = await writer.read(request.slot, request.continuation);
        if (
          window.isDestroyed() ||
          frame !== event.senderFrame ||
          trusted(event) !== window ||
          diagnostics !== writer
        )
          return { status: "unavailable" };
        if (!page.ok) {
          switch (page.status) {
            case "busy":
            case "stale":
              return { status: page.status };
            case "invalid_record":
              return { status: "invalid_file" };
            default:
              return { status: "unavailable" };
          }
        }
        return {
          status: "ready",
          entries: page.records.map((record) => ({
            time: record.timestamp ?? record.observed_timestamp,
            severity: record.severity_text,
            event: record.event_name,
          })),
          invalid: page.invalid,
          unsupported: page.unsupported,
          ...(page.continuation ? { continuation: page.continuation } : {}),
        };
      } finally {
        reservation.value();
      }
    },
  );
  ipcMain.handle(
    desktopChannels.diagnosticsDelete,
    async (event, input: unknown, ...extra: unknown[]): Promise<DiagnosticDeleteResult> => {
      const window = trusted(event);
      const frame = event.senderFrame;
      const writer = diagnostics;
      if (!window || !frame || !writer) return { status: "unavailable" };
      const request = extra.length === 0 && decodeDiagnosticDeleteRequest(input);
      if (!request) return { status: "invalid_request" };
      const reservation = requestBudget.reserve(frame);
      if (!reservation.ok) return { status: "busy" };
      try {
        const result = await writer.deleteLogs(request.confirmed);
        if (
          window.isDestroyed() ||
          frame !== event.senderFrame ||
          trusted(event) !== window ||
          diagnostics !== writer
        )
          return { status: "uncertain" };
        if (result.ok) return { status: "ready", deleted: result.deleted };
        if (result.status === "busy") return { status: "busy" };
        return result.deleted === 0
          ? { status: "unavailable" }
          : { status: "incomplete", deleted: result.deleted };
      } catch {
        return { status: "uncertain" };
      } finally {
        reservation.value();
      }
    },
  );
  ipcMain.handle(
    desktopChannels.diagnosticsBundle,
    async (event, input: unknown, ...extra: unknown[]): Promise<DiagnosticBundleResult> => {
      const window = trusted(event);
      const frame = event.senderFrame;
      if (!window || !frame) return { status: "unavailable" };
      const request = extra.length === 0 && decodeDiagnosticBundleRequest(input);
      if (!request) return { status: "invalid_request" };
      if (request.action === "discard") return diagnosticBundle.discard(window, request.id);

      const writer = diagnostics;
      if (!writer) return { status: "unavailable" };
      const reservation = requestBudget.reserve(frame);
      if (!reservation.ok) return { status: "busy" };
      try {
        if (request.action === "prepare") {
          const admitted = () =>
            !window.isDestroyed() &&
            trusted(event) === window &&
            event.senderFrame === frame &&
            diagnostics === writer;
          return await diagnosticBundle.prepare(window, request.id, admitted, (current) =>
            writer.prepareBundle(request, current),
          );
        }
        return await diagnosticBundle.save(
          window,
          request.token,
          async () => {
            const picked = await dialog.showSaveDialog(window, {
              title: message(locale, "diagnostics.bundle.save"),
              defaultPath: "ohtia-diagnostics.json",
              filters: [{ name: "JSON", extensions: ["json"] }],
            });
            return picked.canceled ? undefined : picked.filePath;
          },
          {
            protectedRoots: [
              context.research_root,
              path.join(context.configuration_root, "Ohtia"),
              ...Object.values(context.stable_roots).map(({ root }) => root),
            ],
            createTemporary: (file) => writer.createBundleTemporary(file),
            verifyTemporary: (file) => writer.verifyBundleTemporary(file),
          },
        );
      } finally {
        reservation.value();
      }
    },
  );
  ipcMain.handle(
    desktopChannels.bootstrap,
    async (event, action: unknown, ...args: unknown[]): Promise<BootstrapSnapshot> => {
      const window = trusted(event);
      if (
        !window ||
        !isBootstrapAction(action) ||
        (action === "restore_checkpoint"
          ? args.length !== 1 || !isCanonicalUuid(args[0])
          : args.length !== 0)
      )
        throw new Error("Bootstrap admission refused.");
      if (action === "exit") {
        app.quit();
        return snapshot(window);
      }
      if (action === "new_window") {
        return (await createWindow(window)).status === "completed"
          ? snapshot(window)
          : { ...snapshot(window), notice: "resource_failure" };
      }
      if (
        action === "retry_service" ||
        action === "restore_checkpoint" ||
        action === "open_storage"
      ) {
        if (storageActionPending || bootstrapState === "storage_opening")
          return action === "restore_checkpoint"
            ? { ...snapshot(window), notice: "recovery_busy" }
            : snapshot(window);
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
          return snapshot(window);
        const checkpoint = action === "restore_checkpoint" ? verifiedCheckpoint : undefined;
        if (action === "restore_checkpoint") {
          if (bootstrapState !== "recovery_required" || !checkpoint)
            return { ...snapshot(window), notice: "recovery_unavailable" };
          if (args[0] !== checkpoint.verification)
            return { ...snapshot(window), notice: "recovery_stale" };
        }
        if (action === "open_storage" && context.mode !== "qualification") {
          try {
            ensureResearchRoot(context.research_root);
          } catch {
            bootstrapState = "path_rejected";
            return snapshot(window);
          }
          diagnostics ??= openDiagnostics();
        }
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
        restoreOutcome = undefined;
        try {
          if (mode !== "blocked") {
            admissionFallback = storageInterruptionState(previousState);
            bootstrapState = "storage_opening";
          }
          const current = service;
          if (current) {
            if (!current.ceased && !(await current.stop())) {
              bootstrapState = restoreStoppedBootstrap(previousState);
              return { ...snapshot(window), notice: "shutdown_uncertain" };
            }
            const outcome = await recoverService(
              current,
              () => !quitting && service === current,
              () => {
                for (const existing of windows.keys()) detach(existing);
                startService(mode, checkpoint?.value);
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
              return { ...snapshot(window), notice: "shutdown_uncertain" };
            }
            if (outcome === "cancelled") {
              bootstrapState = restoreStoppedBootstrap(previousState);
              return snapshot(window);
            }
          }
          if (quitting) return snapshot(window);
          return snapshot(window);
        } catch {
          bootstrapState =
            mode === "blocked"
              ? restoreStoppedBootstrap(previousState)
              : storageInterruptionState(previousState);
          if (mode === "restore") restoreOutcome = "recovery_uncertain";
          return snapshot(window);
        } finally {
          storageActionPending = false;
        }
      }
      return snapshot(window);
    },
  );
  startService();
  await createWindow();
  metricTimer = setInterval(() => {
    if (
      !quitting &&
      !resourceFailureReported &&
      app.getAppMetrics().length + (diagnostics?.reservedPermissionProcesses ?? 0) >
        portLimits.process_tree_count
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
  if (!systemShutdown) {
    const pending = [...windows].find(
      ([window, state]) => state.manuscriptPending && !window.isDestroyed(),
    );
    if (pending) {
      pending[0].webContents.send(desktopChannels.manuscriptClose, "application.quit");
      presentWindow(pending[0], true);
      return;
    }
  }
  if (
    !exitApproved &&
    !systemShutdown &&
    bootstrapState === "storage_ready" &&
    service?.available
  ) {
    if (!applicationExit.pending) {
      exitWindow ??=
        lastFocusedWindow && !lastFocusedWindow.isDestroyed() ? lastFocusedWindow : undefined;
      applicationExit.request(service.generation);
    } else {
      const focused = lastFocusedWindow;
      if (focused && windows.has(focused) && !focused.isDestroyed() && focused !== exitWindow) {
        if (exitWindow && !exitWindow.isDestroyed())
          exitWindow.webContents.send(desktopChannels.exitState, null);
        exitWindow = focused;
        presentedExitOperation = undefined;
      }
      publishExit(applicationExit.state);
      if (exitWindow && applicationExit.state) presentWindow(exitWindow, true);
    }
    return;
  }
  for (const window of windows.keys()) saveWindowBounds(window);
  quitting = true;
  clearTimeout(startup);
  for (const window of windows.keys()) detach(window);
  void (async () => {
    const ceased = await stopBrokerServices(
      service,
      diagnostics,
      async () => {
        await windowPreferences.drain();
        await credentials?.drain();
        await diagnosticBundle.drain();
      },
      () => !systemShutdown,
    );
    if (!ceased) {
      if (systemShutdown) {
        app.exit(0);
        return;
      }
      quitting = false;
      exitApproved = false;
      for (const [window, state] of windows) {
        state.boundsSaved = false;
        presentWindow(window);
      }
      resumeDiagnostics({
        event_name: "ohtia.application.stop_uncertain",
        error_code: "shutdown_uncertain",
      });
      void reportError("shutdown_uncertain");
      return;
    }
    try {
      verifyStableSentinels(context);
    } catch {
      if (systemShutdown) {
        app.exit(0);
        return;
      }
      quitting = false;
      exitApproved = false;
      for (const [window, state] of windows) {
        state.boundsSaved = false;
        presentWindow(window);
      }
      resumeDiagnostics();
      void reportError("startup_failed");
      return;
    }
    providerDispatch?.dispose();
    connections?.dispose();
    cleanExit = true;
    updates.dispose();
    motionObserver?.dispose();
    if (metricTimer) clearInterval(metricTimer);
    clearTimeout(startup);
    app.quit();
  })();
});
app.on("window-all-closed", () => {
  app.quit();
});
process.on("uncaughtException", () => {
  void diagnostics?.append({
    event_name: "ohtia.application.failed",
    error_code: "runtime_failed",
  });
  quitAfterError("startup_failed");
});
process.on("unhandledRejection", () => {
  void diagnostics?.append({
    event_name: "ohtia.application.failed",
    error_code: "runtime_failed",
  });
  quitAfterError("startup_failed");
});
// Do not await native readiness at ESM top level: Electron finishes loading the module before ready.
void start().catch(() => {
  quitAfterError("startup_failed");
});
