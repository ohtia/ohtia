import type { DiagnosticEvent } from "@ohtia/contracts";
import { conformanceRequest } from "./fixtures/provider-conformance.js";
import { fixturePath } from "./fixtures/platform.js";
import { EventEmitter } from "node:events";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("electron");
  vi.doUnmock("../packages/main/src/native-credentials.js");
  vi.doUnmock("node:fs");
  vi.doUnmock("../packages/main/src/profile.js");
  vi.doUnmock("../packages/main/src/locator.js");
  vi.doUnmock("../packages/main/src/service-supervisor.js");
  vi.doUnmock("../packages/main/src/diagnostic-writer.js");
  vi.doUnmock("../packages/main/src/system-motion.js");
  vi.doUnmock("../packages/main/src/update-check.js");
});
async function launch(
  options: {
    kdeWayland?: boolean;
    ozonePlatform?: string;
    locator?: string;
    ownsBroker?: boolean;
    admission?: boolean;
    asset?: string;
    ready?: boolean;
    loadFailure?: boolean;
    loadPending?: boolean;
    requireLiveZoomFrame?: boolean;
    deferZoomPolicy?: boolean;
    rejectZoomPolicy?: boolean;
    instrumented?: boolean;
    deferDocument?: boolean;
    languagesUnavailable?: boolean;
    assetNames?: string[];
    mode?: "qualification" | "development" | "installed";
    developmentBuild?: boolean;
    credentialReadPending?: boolean;
    exitRunning?: number;
    /** Holds main's startup at the credential store until it settles. */
    credentialGate?: Promise<void>;
    researchRootRefused?: boolean;
    nodeOptions?: string;
    platform?: NodeJS.Platform;
    version?: string;
    /** Leave manuscript lock requests unanswered instead of confirming them like a preload with no manuscript. */
    manualManuscriptLock?: boolean;
  } = {},
) {
  vi.resetModules();
  let confirmManuscriptLock: (window: unknown, id: string) => Promise<unknown> = async () => {};
  vi.stubGlobal("__OHTIA_DEVELOPMENT_BUILD__", options.developmentBuild ?? false);
  vi.doMock("../packages/main/src/native-credentials.js", () => ({
    nativeCredentialStore: async () => {
      await options.credentialGate;
      return {
        drain: () => Promise.resolve(),
        read: () =>
          options.credentialReadPending
            ? new Promise(() => {})
            : Promise.resolve({ status: "absent" }),
        readSession: () => Promise.resolve({ status: "absent" }),
        readApiKey: () => Promise.resolve({ status: "absent" }),
        write: () => Promise.resolve({ status: "stored" }),
        writeSession: () => Promise.resolve({ status: "stored" }),
        deleteSession: () => Promise.resolve({ status: "stored" }),
      };
    },
  }));
  if (options.platform) {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: options.platform });
    cleanups.push(() => {
      Object.defineProperty(process, "platform", platform);
    });
  }
  vi.stubEnv("XDG_SESSION_TYPE", options.kdeWayland ? "wayland" : "");
  vi.stubEnv("XDG_CURRENT_DESKTOP", options.kdeWayland ? "KDE" : "");
  vi.stubEnv("WAYLAND_DISPLAY", options.kdeWayland ? "wayland-1" : "");
  vi.useFakeTimers();
  vi.stubEnv("NODE_OPTIONS", options.nodeOptions ?? "");
  vi.stubEnv("OHTIA_RUNTIME_ACCEPTANCE", options.instrumented ? "1" : "0");
  vi.stubEnv("OHTIA_RUNTIME_DEFER_DOCUMENT", options.deferDocument ? "1" : "0");
  cleanups.push(() => {
    Reflect.deleteProperty(globalThis, "__ohtiaLoadInitialDocument");
    Reflect.deleteProperty(globalThis, "__ohtiaAcceptance");
    Reflect.deleteProperty(globalThis, "__ohtiaBootstrapPlacement");
    Reflect.deleteProperty(globalThis, "__ohtiaCredentialAcceptance");
  });
  const constants = await import("../packages/contracts/src/index.js");
  const nativeFs = await import("node:fs");
  const profile = {
    home: "/synthetic/home",
    configuration_root: "/synthetic/home/.config",
    research_root: "/synthetic/home/ohtia",
    scratch_root: "/synthetic/home/scratch",
    stable_roots: {},
  };
  const state = {
    locator: options.locator ?? "missing",
    stop: true,
    recover: "ready",
    publish: "confirmed",
    metrics: 2,
    verify: true,
    notice: false,
    ready: options.ready ?? true,
    admission: options.admission ?? true,
    throwRecover: false,
  };
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(),
    setAppUserModelId: vi.fn(),
    enableSandbox: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
      getSwitchValue: vi.fn((name: string) =>
        name === "ozone-platform"
          ? (options.ozonePlatform ?? (options.kdeWayland ? "wayland" : "x11"))
          : "ExistingFeature",
      ),
    },
    getVersion: () => options.version ?? "0.0.0-test",
    getPreferredSystemLanguages: () => {
      if (options.languagesUnavailable) throw new Error("Unavailable OS preferences");
      return ["es-CL", "en-GB"];
    },
    getPath: (key: string) =>
      key === "home"
        ? profile.home
        : key === "appData"
          ? profile.configuration_root
          : path.join(profile.configuration_root, "Ohtia"),
    setPath: vi.fn(),
    isPackaged: options.mode === "installed",
    exit: vi.fn(),
    quit: vi.fn(),
    isReady: () => state.ready,
    whenReady: vi.fn(() => (state.ready ? Promise.resolve() : new Promise<void>(() => {}))),
    getAppMetrics: () => Array.from({ length: state.metrics }, () => ({})),
    requestSingleInstanceLock: vi.fn(() => options.ownsBroker !== false),
  });
  const nativeTheme = new (class extends EventEmitter {
    private source: "system" | "light" | "dark" = "system";
    systemDark = false;
    get themeSource() {
      return this.source;
    }
    set themeSource(value: "system" | "light" | "dark") {
      this.source = value;
      this.emit("updated");
    }
    get shouldUseDarkColors() {
      return this.source === "dark" || (this.source === "system" && this.systemDark);
    }
  })();
  let nextId = 0;
  let acknowledgeZoom!: () => void;
  const zoomAcknowledgement = new Promise<void>((resolve) => {
    acknowledgeZoom = resolve;
  });
  class Window extends EventEmitter {
    static all: Window[] = [];
    static getFocusedWindow() {
      return Window.all.find((window) => !window.destroyed);
    }
    static getAllWindows() {
      return Window.all.filter((window) => !window.destroyed);
    }
    static fromWebContents(contents: unknown) {
      return Window.all.find((window) => window.webContents === contents);
    }
    destroyed = false;
    documentReady = false;
    minimized = false;
    visible = true;
    webContents = Object.assign(new EventEmitter(), {
      id: ++nextId,
      mainFrame: { url: constants.desktopDocument, send: vi.fn() },
      send: vi.fn((channel: string, payload?: unknown) => {
        const request = payload as { locked?: boolean; id?: string } | undefined;
        if (
          channel === constants.desktopChannels.manuscriptLock &&
          request?.locked &&
          request.id &&
          !options.manualManuscriptLock
        ) {
          const id = request.id;
          queueMicrotask(() => {
            void confirmManuscriptLock(this, id);
          });
        }
      }),
      stop: vi.fn(),
      isDestroyed: () => this.destroyed,
      setWindowOpenHandler: vi.fn(),
      setVisualZoomLevelLimits: vi.fn(async () => {
        if (options.requireLiveZoomFrame && !this.documentReady)
          throw new Error("Render frame was disposed before WebFrameMain could be accessed");
        if (options.deferZoomPolicy) await zoomAcknowledgement;
        if (options.rejectZoomPolicy) throw new Error("Synthetic visual zoom policy refusal");
      }),
      getZoomFactor: vi.fn(() => 1),
      setZoomFactor: vi.fn(),
    });
    isFocused = () => true;
    close = vi.fn();
    isFullScreen = () => false;
    setFullScreen = vi.fn();
    removeMenu = vi.fn();
    setTitle = vi.fn();
    setMenuBarVisibility = vi.fn();
    setBackgroundColor = vi.fn();
    setTitleBarOverlay = vi.fn();
    setBounds = vi.fn();
    setMinimumSize = vi.fn();
    getBounds = () => ({ x: 0, y: 0, width: 1280, height: 800 });
    getContentBounds = () => ({ x: 0, y: 0, width: 1278, height: 798 });
    maximize = vi.fn(() => {
      this.visible = true;
    });
    isMaximized = () => false;
    getNormalBounds = () => ({ x: 0, y: 0, width: 1280, height: 800 });
    show = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    restore = vi.fn(() => {
      this.visible = true;
    });
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    isVisible() {
      return this.visible;
    }
    completeLoad: () => void = () => {};
    loadURL = vi.fn(async () => {
      if (options.loadFailure) throw new Error("Synthetic load failure");
      if (options.loadPending)
        await new Promise<void>((resolve) => {
          this.completeLoad = resolve;
        });
      await Promise.resolve();
      this.documentReady = true;
    });
    themeAtCreation = nativeTheme.themeSource;
    constructor(readonly settings: unknown) {
      super();
      this.visible = (settings as { show?: boolean }).show ?? true;
      Window.all.push(this);
    }
  }
  const ipcMain = Object.assign(new EventEmitter(), { handle: vi.fn() });
  const nativeSession = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
    protocol: { handle: vi.fn() },
  };
  const session = { fromPartition: vi.fn(() => nativeSession) };
  const dialog = {
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn(async () => ({})),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  };
  const protocol = { registerSchemesAsPrivileged: vi.fn() };
  const children: ReturnType<typeof child>[] = [];
  const diagnosticWriters: { readonly version: string }[] = [];
  const diagnosticRead = vi.fn();
  const diagnosticPrepare = vi.fn();
  const diagnosticDelete = vi.fn();
  const diagnosticAppend = vi.fn<(event: DiagnosticEvent, correlation?: string) => Promise<void>>(
    async () => {},
  );
  function child() {
    return Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() });
  }
  const utilityProcess = {
    fork: vi.fn(() => {
      const instance = child();
      children.push(instance);
      return instance;
    }),
  };
  const supervisors: Supervisor[] = [];
  class Supervisor {
    available = true;
    ceased = false;
    dispatch = vi.fn();
    reportConnections = vi.fn((manager: { ids(): readonly string[] }) => manager.ids());
    connectProvider = vi.fn();
    postProvider = vi.fn((text: string) => {
      const control = JSON.parse(text);
      if (control.kind === "application_exit" && control.action === "hold") {
        queueMicrotask(() => {
          const channel = this.connectProvider.mock.calls[0]?.[0];
          channel?.exitState?.({
            kind: "application_exit_state",
            generation: this.generation,
            operationId: control.operationId,
            running: options.exitRunning ?? 0,
            held: true,
            cancelled: false,
            failed: false,
          });
          if (!options.exitRunning) app.emit("before-quit", { preventDefault: vi.fn() });
        });
      }
      return true;
    });
    postWake = vi.fn(() => true);
    markSystemShutdown = vi.fn();
    control = vi.fn();
    disposeWindow = vi.fn();
    activateStorage = vi.fn(() => true);
    setSystemLocale = vi.fn(() => true);
    stop = vi.fn(async () => {
      await this.beforeShutdown?.();
      this.ceased = state.stop;
      return state.stop;
    });
    request = vi.fn(async (operation: string): Promise<unknown> => {
      if (operation === "bounds.read")
        return {
          ok: true,
          value: { schemaVersion: 1, revision: 0, value: null, source: "default" },
        };
      if (operation === "appearance.read")
        return {
          ok: true,
          value: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
        };
      return { ok: false, error: { code: "service_unavailable" } };
    });
    constructor(
      readonly childPort: {
        send(text: string): void;
        kill(): void;
        messages(listener: () => void): void;
        exited(listener: () => void): void;
      },
      readonly generation: string,
      readonly stateChanged: (state: string) => void,
      readonly storageChanged: (notice: object) => void,
      _storageAdmitting?: boolean,
      readonly diagnostic?: (event: DiagnosticEvent, correlation?: string) => void,
      readonly localeChanged?: (snapshot: import("@ohtia/contracts").LocaleSnapshot) => void,
      readonly presentationChanged?: (
        snapshot: import("@ohtia/contracts").PresentationSnapshot,
      ) => void,
      readonly appearanceChanged?: (record: import("@ohtia/contracts").AppearanceRecord) => void,
      _requestBudget?: unknown,
      readonly beforeShutdown?: () => Promise<void>,
    ) {
      supervisors.push(this);
      childPort.messages(() => {});
      childPort.exited(() => {});
    }
  }
  const recoverService = vi.fn(async (_service, admitted, restart) => {
    if (state.throwRecover) throw new Error("Synthetic recovery failure");
    if (!admitted()) return "cancelled";
    if (state.recover === "ready") restart();
    return state.recover;
  });
  const publish = vi.fn(async () => state.publish);
  const powerMonitor = new EventEmitter();
  vi.doMock("electron", () => ({
    app,
    powerMonitor,
    nativeTheme,
    screen: {
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    BrowserWindow: Window,
    ipcMain,
    session,
    dialog,
    protocol,
    utilityProcess,
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((value) => value) },
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
    shell: { openExternal: vi.fn() },
  }));
  vi.doMock("../packages/main/src/profile.js", () => ({
    resolveRuntimeContext: () => {
      if (!state.admission) throw new Error("Synthetic admission failure");
      return { ...profile, mode: options.mode ?? "qualification" };
    },
    ensureResearchRoot: () => {
      if (options.researchRootRefused) throw new Error("Synthetic aliased research root");
    },
    canonicalProspective: (value: string) => value,
    admitRuntimeSwitches: vi.fn(),
    isDevelopmentSwitch: (value: string) => value.startsWith("--ohtia-dev-"),
    verifyStableSentinels: () => {
      if (!state.verify) throw new Error("Synthetic changed sentinel");
    },
  }));
  const actualLocator = await import("../packages/main/src/locator.js");
  vi.doMock("../packages/main/src/locator.js", () => ({
    ...actualLocator,
    canonicalProspective: (value: string) => value,
    readLocator: () => ({ state: state.locator }),
    LocatorPublisher: class {
      publish = publish;
    },
  }));
  vi.doMock("../packages/main/src/service-supervisor.js", () => ({
    ServiceSupervisor: Supervisor,
    recoverService,
  }));
  const bytes = Buffer.from("<!doctype html><title>Synthetic</title>");
  const assets =
    options.asset === "invalid-root"
      ? []
      : options.asset === "invalid-name"
        ? { "../escape.html": {} }
        : options.asset === "missing-document"
          ? {}
          : {
              "index.html": {
                type: "text/html",
                sha256:
                  options.asset === "bad-digest"
                    ? "0".repeat(64)
                    : createHash("sha256").update(bytes).digest("hex"),
              },
            };
  if (options.assetNames && !Array.isArray(assets)) {
    for (const name of options.assetNames)
      Object.assign(assets, {
        [name]: {
          type: name.endsWith("png") ? "image/png" : "image/svg+xml",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
  }
  const readFileSync = (file: unknown, ...args: unknown[]) => {
    if (fixturePath(file).endsWith("/licenses/Ohtia-LICENSE"))
      return "MIT License\n\nCopyright (c) 2026 Adrian Mastronardi & Mónica Pené\n";
    if (fixturePath(file).endsWith("/notices.json"))
      return JSON.stringify([
        { component: "React", license: "MIT", url: "https://github.com/react/react" },
      ]);
    if (fixturePath(file).endsWith("/inventory.json"))
      return JSON.stringify({ version: 1, files: {} });
    if (fixturePath(file).endsWith("/assets.json")) return JSON.stringify(assets);
    if (fixturePath(file).includes("/renderer/")) return bytes;
    return nativeFs.default.readFileSync(file as never, ...(args as []));
  };
  const realpathSync = Object.assign((file: unknown) => String(file), {
    native: (file: unknown) =>
      options.asset === "aliased" ? String(file) + "-alias" : String(file),
  });
  vi.doMock("node:fs", () => ({
    ...nativeFs,
    default: { ...nativeFs.default, readFileSync, realpathSync },
    readFileSync,
    realpathSync,
  }));
  vi.doMock("../packages/main/src/diagnostic-writer.js", () => ({
    DiagnosticWriter: class {
      constructor(options: { readonly version: string }) {
        diagnosticWriters.push(options);
      }
      reservedPermissionProcesses = 0;
      read = diagnosticRead;
      prepareBundle = diagnosticPrepare;
      deleteLogs = diagnosticDelete;
      append = diagnosticAppend;
      close = vi.fn(async () => undefined);
    },
  }));
  // The broker never reaches a real session bus from a unit test.
  const motion = {
    started: 0,
    disposed: 0,
    changed: undefined as ((value: string) => void) | undefined,
  };
  vi.doMock("../packages/main/src/system-motion.js", () => ({
    nativeSystemMotionHost: () => ({}),
    SystemMotionObserver: class {
      constructor(_host: unknown, changed: (value: string) => void) {
        motion.changed = changed;
      }
      start() {
        motion.started++;
      }
      dispose() {
        motion.disposed++;
      }
    },
  }));
  const stdout = process.stdout.write,
    stderr = process.stderr.write;
  const listeners = new Map(
    ["uncaughtException", "unhandledRejection", "SIGTERM"].map((name) => [
      name,
      process.listeners(name),
    ]),
  );
  let failure: unknown;
  let mainSigterm: (() => void) | undefined;
  try {
    await import("../packages/main/src/entry.js");
  } catch (error) {
    failure = error;
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    const added = [...listeners].flatMap(([name, before]) =>
      process
        .listeners(name)
        .filter((listener) => !before.includes(listener))
        .map((listener) => ({ name, listener })),
    );
    mainSigterm = added.find(({ name }) => name === "SIGTERM")?.listener;
    cleanups.push(() => {
      for (const { name, listener } of added) process.removeListener(name, listener);
    });
  }
  if (options.developmentBuild && options.mode === "development") await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
  cleanups.push(() => {
    vi.clearAllTimers();
  });
  const window = Window.all[0];
  const event = (selected = window) => ({
    sender: selected?.webContents,
    senderFrame: selected?.webContents.mainFrame,
  });
  const bootstrap = ipcMain.handle.mock.calls.find(
    ([channel]) => channel === constants.desktopChannels.bootstrap,
  )?.[1];
  const action = async (value: string, selected = window, ...args: unknown[]) =>
    bootstrap(event(selected), value, ...args);
  const command = async (action: string, payload?: unknown, selected = window) =>
    ipcMain.handle.mock.calls.find(
      ([channel]) => channel === constants.desktopChannels.commands,
    )![1](event(selected), action, payload);
  confirmManuscriptLock = (selected, id) =>
    command("manuscript_locked", { id, pending: false }, selected as typeof window);
  return {
    acknowledgeZoom,
    powerMonitor,
    signalMain: () => {
      if (!mainSigterm) throw new Error("Main did not install its SIGTERM listener.");
      mainSigterm();
    },
    constants,
    state,
    app,
    Window,
    window,
    ipcMain,
    nativeSession,
    session,
    dialog,
    protocol,
    utilityProcess,
    children,
    diagnosticWriters,
    diagnosticRead,
    diagnosticPrepare,
    diagnosticDelete,
    diagnosticAppend,
    supervisors,
    publish,
    failure,
    event,
    action,
    command,
    recoverService,
    motion,
  };
}

describe("broker composition with synthetic Electron adapters", () => {
  it("waits for provider transport closure before confirming an orderly quit", async () => {
    const h = await launch();
    const { ProviderDispatch } = await import("../packages/main/src/provider-dispatch.js");
    let release!: () => void;
    const closed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const drain = vi.spyOn(ProviderDispatch.prototype, "drain").mockReturnValueOnce(closed);
    try {
      h.app.emit("before-quit", { preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(0);
      expect(drain).toHaveBeenCalledOnce();
      expect(h.supervisors[0]!.stop).toHaveBeenCalledOnce();
      expect(h.app.quit).not.toHaveBeenCalled();
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.supervisors[0]!.stop).toHaveBeenCalledOnce();
      expect(h.app.quit).toHaveBeenCalledOnce();
    } finally {
      release();
      drain.mockRestore();
    }
  });

  it("posts the current service generation's versioned wake after Electron resumes", async () => {
    const h = await launch();
    vi.setSystemTime(new Date("2026-11-14T20:00:00.000Z"));
    h.powerMonitor.emit("suspend");
    vi.setSystemTime(new Date("2026-11-14T20:02:00.000Z"));
    h.powerMonitor.emit("resume");
    const service = h.supervisors[0]!;
    const wake = service.postWake.mock.calls
      .map(([text]: [string]) => JSON.parse(text))
      .find((message) => message.kind === "service_wake");
    expect(wake).toEqual({
      kind: "service_wake",
      version: 1,
      generation: service.generation,
      suspendedAt: "2026-11-14T20:00:00.000Z",
      resumedAt: "2026-11-14T20:02:00.000Z",
      asleepMs: 120000,
    });
  });

  it("claims the layout failure announcement once across windows in the same application", async () => {
    const h = await launch();
    const claim = (window: any, id: string) => {
      const event = { ...h.event(window), returnValue: undefined as any };
      h.ipcMain.emit(h.constants.desktopChannels.session, event);
      const encoded = h.constants.encodeEnvelope({
        protocol: 1,
        policy: h.constants.policyId,
        kind: "request",
        operation: "layout.failureNotice",
        operationId: id,
        requestId: id,
        ...event.returnValue,
        payload: {},
      });
      if (!encoded.ok) throw new Error("Invalid fixture");
      h.ipcMain.emit(h.constants.desktopChannels.port, event, encoded.value);
      return JSON.parse(window.webContents.mainFrame.send.mock.calls.at(-1)[1]).payload;
    };
    expect(claim(h.window, "notice-1")).toEqual({ ok: true, value: { announce: true } });
    expect(claim(h.window, "notice-2")).toEqual({ ok: true, value: { announce: false } });
    await h.action("new_window");
    const second = h.Window.all.at(-1)!;
    expect(claim(second, "notice-3")).toEqual({ ok: true, value: { announce: false } });
    expect(h.supervisors[0].dispatch).not.toHaveBeenCalled();
  });
  it("keeps larger-than-screen resizing disabled for ordinary windows", async () => {
    const h = await launch();
    expect(h.failure).toBeUndefined();
    expect(h.window.settings).toMatchObject({ enableLargerThanScreen: false });
  });
  it("permits larger-than-screen geometry under explicit acceptance instrumentation", async () => {
    const h = await launch({ instrumented: true });
    expect(h.failure).toBeUndefined();
    expect(h.window.settings).toMatchObject({ enableLargerThanScreen: true });
  });

  it("records startup before loading the initial document only under explicit acceptance instrumentation", async () => {
    const h = await launch({ instrumented: true, deferDocument: true });
    expect(h.window.loadURL).toHaveBeenCalledExactlyOnceWith("about:blank");
    const release = Reflect.get(globalThis, "__ohtiaLoadInitialDocument") as () => void;
    expect(typeof release).toBe("function");
    release();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.window.loadURL).toHaveBeenNthCalledWith(2, h.constants.desktopDocument);
    expect(h.window.loadURL).toHaveBeenCalledTimes(2);
    expect(Reflect.get(globalThis, "__ohtiaLoadInitialDocument")).toBeUndefined();
    const ordinary = await launch({ deferDocument: true });
    expect(ordinary.window.loadURL).toHaveBeenCalledExactlyOnceWith(
      ordinary.constants.desktopDocument,
    );
  });

  it("bounds and disposes an unreleased initial-document acceptance barrier", async () => {
    const h = await launch({ instrumented: true, deferDocument: true });
    const expiredRelease = Reflect.get(globalThis, "__ohtiaLoadInitialDocument") as () => void;
    await vi.advanceTimersByTimeAsync(h.constants.portLimits.application_start_ms);
    expiredRelease();
    expect(h.window.loadURL).toHaveBeenCalledExactlyOnceWith("about:blank");
    expect(Reflect.get(globalThis, "__ohtiaLoadInitialDocument")).toBeUndefined();
    expect(h.app.quit).toHaveBeenCalled();
    const closed = await launch({ instrumented: true, deferDocument: true });
    const closedRelease = Reflect.get(globalThis, "__ohtiaLoadInitialDocument") as () => void;
    closed.window.emit("closed");
    closedRelease();
    expect(closed.window.loadURL).toHaveBeenCalledExactlyOnceWith("about:blank");
    expect(Reflect.get(globalThis, "__ohtiaLoadInitialDocument")).toBeUndefined();
  });

  it("redirects a development instance before taking its single-instance lock", async () => {
    vi.stubEnv("OHTIA_DEVELOPMENT_ROOT", "/checkout/.ohtia-dev");
    const h = await launch({ mode: "development" });
    expect(h.failure).toBeUndefined();
    expect(h.app.setPath.mock.calls.map(([name]: string[]) => name)).toEqual([
      "appData",
      "userData",
    ]);
    expect(h.utilityProcess.fork.mock.calls[0][1][0]).toBe("development:/checkout/.ohtia-dev");
  });
  it("runs installed bytes without a profile or any redirection", async () => {
    const h = await launch({ mode: "installed" });
    expect(h.failure).toBeUndefined();
    expect(h.app.setPath).not.toHaveBeenCalled();
    expect(h.utilityProcess.fork.mock.calls[0][1][0]).toBe("installed");
    expect((await h.action("open_storage")).state).toBe("storage_opening");
  });
  it("gives About, diagnostics and the data service the same packaged version", async () => {
    const h = await launch({ mode: "installed", version: "0.3.0-dev.7.2" });
    expect(h.failure).toBeUndefined();
    expect((await h.action("open_storage")).state).toBe("storage_opening");
    expect(h.utilityProcess.fork).toHaveBeenCalled();
    for (const call of h.utilityProcess.fork.mock.calls) expect(call[1][4]).toBe("0.3.0-dev.7.2");
    expect(h.diagnosticWriters.map((options) => options.version)).toEqual(["0.3.0-dev.7.2"]);
    expect(await h.command("about")).toMatchObject({ version: "0.3.0-dev.7.2" });
  });
  it("admits bounded diagnostic reads independently of storage and revokes late frame results", async () => {
    const h = await launch({ mode: "installed" });
    const handle = h.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === h.constants.desktopChannels.diagnosticsRead,
    )![1];
    const request = { slot: 0 };
    expect(await handle(h.event(), request)).toEqual({ status: "unavailable" });
    expect((await h.action("open_storage")).state).toBe("storage_opening");
    expect(
      await handle({ ...h.event(), senderFrame: { url: h.constants.desktopDocument } }, request),
    ).toEqual({ status: "unavailable" });
    expect(await handle(h.event(), { ...request, path: "/synthetic/private" })).toEqual({
      status: "invalid_request",
    });
    expect(await handle(h.event(), request, "extra")).toEqual({ status: "invalid_request" });
    expect(h.diagnosticRead).not.toHaveBeenCalled();

    const time = "2026-01-01T00:00:00.000Z";
    const observed = "2026-01-01T00:00:01.000Z";
    const event = "ohtia.application.started";
    const continuation = { token: "a".repeat(64), offset: 100 };
    const record = h.constants.makeDiagnosticRecord(
      { event_name: event, timestamp: time },
      "0.0.0-test",
      observed,
    )!;
    const first = {
      ok: true,
      records: [record, { ...record, timestamp: undefined }],
      invalid: 60,
      unsupported: 2,
      continuation,
    };
    h.diagnosticRead.mockResolvedValueOnce(first);
    expect(await handle(h.event(), { slot: 1, continuation })).toEqual({
      status: "ready",
      entries: [
        { time, severity: "INFO", event },
        { time: observed, severity: "INFO", event },
      ],
      invalid: 60,
      unsupported: 2,
      continuation,
    });
    expect(h.diagnosticRead).toHaveBeenLastCalledWith(1, continuation);
    h.diagnosticRead.mockResolvedValueOnce({ ...first, continuation: undefined });
    expect(await handle(h.event(), request)).not.toHaveProperty("continuation");

    for (const [status, expected] of [
      ["busy", "busy"],
      ["stale", "stale"],
      ["invalid_record", "invalid_file"],
      ["closed", "unavailable"],
    ]) {
      h.diagnosticRead.mockResolvedValueOnce({ ok: false, status });
      expect(await handle(h.event(), request)).toEqual({ status: expected });
    }

    let release!: (value: typeof first) => void;
    const pending = new Promise<typeof first>((resolve) => {
      release = resolve;
    });
    h.diagnosticRead.mockReturnValue(pending);
    const reads = Array.from({ length: h.constants.portLimits.pending_per_window }, () =>
      handle(h.event(), request),
    );
    expect(await handle(h.event(), request)).toEqual({ status: "busy" });
    const oldFrame = h.window.webContents.mainFrame;
    h.window.webContents.mainFrame = { ...oldFrame };
    release(first);
    for (const result of await Promise.all(reads))
      expect(result).toEqual({ status: "unavailable" });
    expect(await handle(h.event(), request)).toMatchObject({ status: "ready" });
  });
  it("requires a trusted confirmed deletion and preserves known and uncertain outcomes", async () => {
    const h = await launch({ mode: "installed" });
    const handle = h.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === h.constants.desktopChannels.diagnosticsDelete,
    )![1];
    const request = { confirmed: true };
    expect(await handle(h.event(), request)).toEqual({ status: "unavailable" });
    expect((await h.action("open_storage")).state).toBe("storage_opening");
    expect(
      await handle({ ...h.event(), senderFrame: { url: h.constants.desktopDocument } }, request),
    ).toEqual({ status: "unavailable" });
    expect(await handle(h.event(), { confirmed: false })).toEqual({ status: "invalid_request" });
    expect(await handle(h.event(), { ...request, path: "/synthetic/private" })).toEqual({
      status: "invalid_request",
    });
    expect(await handle(h.event(), request, "extra")).toEqual({ status: "invalid_request" });
    expect(h.diagnosticDelete).not.toHaveBeenCalled();

    for (const [result, expected] of [
      [
        { ok: true, status: "ready", deleted: 3 },
        { status: "ready", deleted: 3 },
      ],
      [
        { ok: false, status: "unavailable", deleted: 2 },
        { status: "incomplete", deleted: 2 },
      ],
      [{ ok: false, status: "unavailable", deleted: 0 }, { status: "unavailable" }],
      [{ ok: false, status: "busy", deleted: 0 }, { status: "busy" }],
      [{ ok: false, status: "closed", deleted: 0 }, { status: "unavailable" }],
    ]) {
      h.diagnosticDelete.mockResolvedValueOnce(result);
      expect(await handle(h.event(), request)).toEqual(expected);
      expect(h.diagnosticDelete).toHaveBeenLastCalledWith(true);
    }
    h.diagnosticDelete.mockRejectedValueOnce(new Error("synthetic failure"));
    expect(await handle(h.event(), request)).toEqual({ status: "uncertain" });

    const ready = { ok: true, status: "ready", deleted: 1 };
    let release!: (value: typeof ready) => void;
    h.diagnosticDelete.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = Array.from({ length: h.constants.portLimits.pending_per_window }, () =>
      handle(h.event(), request),
    );
    expect(await handle(h.event(), request)).toEqual({ status: "busy" });
    h.window.webContents.mainFrame = { ...h.window.webContents.mainFrame };
    release(ready);
    for (const result of await Promise.all(pending))
      expect(result).toEqual({ status: "uncertain" });
    expect(await handle(h.event(), request)).toEqual({ status: "ready", deleted: 1 });
  });
  it("gates the diagnostic picker by trusted window and revokes a disposed owner's preview", async () => {
    const h = await launch({ mode: "installed" });
    const handle = h.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === h.constants.desktopChannels.diagnosticsBundle,
    )![1];
    const id = "00000000-0000-4000-8000-000000000009";
    const from = "2000-01-01T00:00:00.000Z";
    const prepare = { action: "prepare", id, slots: 31, from, through: from };
    const save = { action: "save", token: id };
    expect(await handle(h.event(), prepare)).toEqual({ status: "unavailable" });
    expect((await h.action("open_storage")).state).toBe("storage_opening");
    expect(
      await handle({ ...h.event(), senderFrame: { url: h.constants.desktopDocument } }, prepare),
    ).toEqual({ status: "unavailable" });
    expect(await handle(h.event(), { ...save, path: "/synthetic/private" })).toEqual({
      status: "invalid_request",
    });
    expect(await handle(h.event(), prepare, "extra")).toEqual({ status: "invalid_request" });
    expect(h.diagnosticPrepare).not.toHaveBeenCalled();
    const preview = { status: "preview", json: "...", invalid: 0, unsupported: 0 };
    h.diagnosticPrepare.mockResolvedValue(preview);
    const prepared = await handle(h.event(), prepare);
    expect(prepared).toMatchObject(preview);
    expect(h.constants.isCanonicalUuid(prepared.token)).toBe(true);
    save.token = prepared.token;
    await h.action("new_window");
    const other = h.Window.all.at(-1)!;
    expect(other).not.toBe(h.window);
    expect(await handle(h.event(other), save)).toEqual({ status: "stale" });
    expect(await handle(h.event(other), { action: "discard", id })).toEqual({
      status: "stale",
    });
    expect(h.dialog.showSaveDialog).not.toHaveBeenCalled();
    let cancel!: (value: { canceled: boolean }) => void;
    h.dialog.showSaveDialog.mockReturnValueOnce(
      new Promise((resolve) => {
        cancel = resolve;
      }),
    );
    const saving = handle(h.event(), save);
    expect(h.dialog.showSaveDialog).toHaveBeenCalledExactlyOnceWith(
      h.window,
      expect.objectContaining({ defaultPath: "ohtia-diagnostics.json" }),
    );
    h.window.emit("closed");
    cancel({ canceled: true });
    expect(await saving).toEqual({ status: "stale" });
    const next = await handle(h.event(other), prepare);
    expect(next).toMatchObject(preview);
    expect(next.token).not.toBe(prepared.token);
    expect(await handle(h.event(other), save)).toEqual({ status: "stale" });
    save.token = next.token;
    expect(await handle(h.event(other), save)).toEqual({ status: "cancelled" });
    expect(await handle(h.event(other), save)).toEqual({ status: "stale" });
  });
  it("correlates service and provider diagnostics to the current generation", async () => {
    const h = await launch({ mode: "installed" });
    expect((await h.action("open_storage")).state).toBe("storage_opening");
    const service = h.supervisors.at(-1)!;
    service.stateChanged("ready");
    service.diagnostic?.({ event_name: "ohtia.storage.opened" });
    const requestCorrelation = "019a8000-0000-7000-8000-000000000510";
    const event = { event_name: "ohtia.service.faulted", error_code: "request_timeout" } as const;
    service.diagnostic?.(event, requestCorrelation);
    const request = conformanceRequest("chatgpt");
    service.connectProvider.mock.calls[0][0].dispatch({
      kind: "provider_dispatch",
      version: 1,
      generation: service.generation,
      request,
      permit: { id: "expired-permit", attempt: request.attempt, issued_at: Date.now() + 1 },
    });
    service.stateChanged("unavailable");
    service.stateChanged("unavailable");
    const events = h.diagnosticAppend.mock.calls.filter(([entry]) =>
      /ohtia\.(service|storage|provider)\./.test(entry.event_name),
    );
    expect(events).toEqual([
      [{ event_name: "ohtia.service.ready" }, service.generation],
      [{ event_name: "ohtia.storage.opened" }, service.generation],
      [event, requestCorrelation],
      [
        { event_name: "ohtia.provider.not_dispatched", error_code: "permit_expired" },
        service.generation,
      ],
      [
        { event_name: "ohtia.service.unavailable", error_code: "service_unavailable" },
        service.generation,
      ],
    ]);
  });
  it("reports an aliased research root without starting the store", async () => {
    const h = await launch({ mode: "installed", researchRootRefused: true });
    const forks = h.utilityProcess.fork.mock.calls.length;
    expect((await h.action("open_storage")).state).toBe("path_rejected");
    expect(h.utilityProcess.fork).toHaveBeenCalledTimes(forks);
  });
  it("refuses Node runtime injection in every mode", async () => {
    for (const mode of ["qualification", "development", "installed"] as const) {
      const h = await launch({ mode, nodeOptions: "--require=/synthetic.js" });
      expect(h.failure).toBeInstanceOf(Error);
      expect(h.app.exit).toHaveBeenCalledWith(1);
      expect(h.utilityProcess.fork).not.toHaveBeenCalled();
    }
  });
  it("refuses isolation admission and a second broker before starting a child", async () => {
    const refused = await launch({ admission: false });
    expect(refused.failure).toBeInstanceOf(Error);
    expect(refused.app.exit).toHaveBeenCalledWith(1);
    expect(refused.utilityProcess.fork).not.toHaveBeenCalled();
    const second = await launch({ ownsBroker: false });
    expect(second.app.exit).toHaveBeenCalledWith(0);
    expect(second.utilityProcess.fork).not.toHaveBeenCalled();
  });
  it.each(["invalid-root", "invalid-name", "missing-document", "bad-digest", "aliased"])(
    "refuses %s asset inventories before creating a renderer",
    async (asset) => {
      const h = await launch({ asset });
      expect(h.Window.all).toHaveLength(0);
      expect(h.dialog.showErrorBox).toHaveBeenCalled();
    },
  );
  it("serves only validated assets with CSP and denies requests, permissions and navigation", async () => {
    const h = await launch();
    expect(h.failure).toBeUndefined();
    expect(h.window.settings).toMatchObject({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const handler = h.nativeSession.protocol.handle.mock.calls[0][1];
    const response = handler({ url: h.constants.desktopDocument, method: "GET" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(await response.text()).toContain("Synthetic");
    expect(handler({ url: h.constants.desktopDocument, method: "POST" }).status).toBe(403);
    expect(handler({ url: "https://example.invalid", method: "GET" }).status).toBe(403);
    const callback = vi.fn();
    h.nativeSession.setPermissionRequestHandler.mock.calls[0][0](null, "camera", callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(h.nativeSession.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const beforeRequest = h.nativeSession.webRequest.onBeforeRequest.mock.calls[0][0];
    beforeRequest({ url: h.constants.desktopDocument, resourceType: "script" }, callback);
    expect(callback).toHaveBeenLastCalledWith({ cancel: false });
    beforeRequest(
      {
        url: "https://example.invalid",
        resourceType: "mainFrame",
        webContentsId: h.window.webContents.id,
      },
      callback,
    );
    await Promise.resolve();
    expect(callback).toHaveBeenLastCalledWith({ cancel: true });
    expect(h.window.webContents.stop).toHaveBeenCalledOnce();
    for (const [name, input, blocked] of [
      ["will-navigate", { url: h.constants.desktopDocument }, false],
      ["will-navigate", { url: "https://example.invalid" }, true],
      ["will-frame-navigate", { url: h.constants.desktopDocument, isMainFrame: true }, false],
      ["will-frame-navigate", { url: h.constants.desktopDocument, isMainFrame: false }, true],
      ["will-attach-webview", {}, true],
    ] as const) {
      const preventDefault = vi.fn();
      h.window.webContents.emit(name, { ...input, preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(blocked ? 1 : 0);
    }
    expect(h.window.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({
      action: "deny",
    });
    h.window.emit("ready-to-show");
    expect(h.window.show).toHaveBeenCalled();
  });
  it("serves managed location availability in main and releases each request slot", async () => {
    const h = await launch({ locator: "locator_invalid" });
    const { desktopChannels, encodeEnvelope, decodeText, policyId, portLimits } = h.constants;
    const event = h.event();
    h.ipcMain.emit(desktopChannels.session, event);
    for (let index = 0; index <= portLimits.pending_per_window; index++) {
      const id = `managed-location-${String(index)}`;
      const encoded = encodeEnvelope({
        protocol: 1,
        policy: policyId,
        kind: "request",
        ...event.returnValue,
        requestId: id,
        operationId: id,
        operation: "managedStore.readLocation",
        payload: {},
      });
      if (!encoded.ok) throw new Error("Invalid test request");
      h.ipcMain.emit(desktopChannels.port, event, encoded.value);
      const sent = h.window.webContents.mainFrame.send.mock.calls.at(-1);
      expect(sent[0]).toBe(desktopChannels.reply);
      expect(decodeText(sent[1])).toMatchObject({
        ok: true,
        value: {
          requestId: id,
          payload: { ok: true, value: { state: "unavailable", reason: "locator_invalid" } },
        },
      });
    }
    expect(h.supervisors[0].dispatch).not.toHaveBeenCalled();
  });

  it("binds actual session generations and rejects untrusted frames before dispatch", async () => {
    const h = await launch();
    const session = h.event();
    h.ipcMain.emit(h.constants.desktopChannels.session, session);
    expect(session.returnValue).toMatchObject({
      windowGeneration: expect.any(String),
      serviceGeneration: expect.any(String),
    });
    const bad = { sender: h.window.webContents, senderFrame: { url: h.constants.desktopDocument } };
    h.ipcMain.emit(h.constants.desktopChannels.session, bad);
    expect(bad.returnValue).toBeNull();
    const unknown = { sender: {}, senderFrame: {} };
    h.ipcMain.emit(h.constants.desktopChannels.port, unknown, "bad");
    h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), "bad");
    expect(h.supervisors[0].dispatch).not.toHaveBeenCalled();
    const envelope = {
      protocol: 1,
      policy: h.constants.policyId,
      operationId: "operation-read-1",
      windowGeneration: session.returnValue.windowGeneration,
      serviceGeneration: session.returnValue.serviceGeneration,
      kind: "request",
      requestId: "read-1",
      operation: "status.read",
      payload: {},
    };
    const encoded = h.constants.encodeEnvelope(envelope as never);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), encoded.value);
    expect(h.supervisors[0].dispatch).toHaveBeenCalledOnce();
    const accepted = h.supervisors[0].dispatch.mock.calls[0][0];
    accepted.deliver("reply");
    expect(h.window.webContents.mainFrame.send).toHaveBeenCalledWith(
      h.constants.desktopChannels.reply,
      "reply",
    );
    h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), encoded.value);
    expect(h.supervisors[0].dispatch).toHaveBeenCalledOnce();
    expect(h.window.webContents.mainFrame.send).toHaveBeenCalledTimes(2);
    h.window.webContents.emit("did-start-navigation", {}, h.constants.desktopDocument, false, true);
    accepted.deliver("stale");
    expect(h.window.webContents.mainFrame.send).toHaveBeenCalledTimes(2);
    h.window.webContents.emit("render-process-gone");
    expect(h.supervisors[0].disposeWindow).toHaveBeenCalled();
    await expect(h.action("not-a-bootstrap-action")).rejects.toThrow(/admission/);
  });
  const enabled = {
    ok: true,
    value: { schemaVersion: 1, revision: 0, value: true, source: "default" },
  };
  it.each([
    ["installed", enabled, 1],
    [
      "installed",
      { ok: true, value: { schemaVersion: 1, revision: 1, value: false, source: "saved" } },
      0,
    ],
    ["installed", { ok: false, error: { code: "busy" } }, 0],
    ["development", enabled, 0],
    ["qualification", enabled, 0],
  ] as const)(
    "checks for a newer version only after a successful enabled read (%s build)",
    async (mode, saved, requests) => {
      const signals: AbortSignal[] = [];
      vi.doMock("../packages/main/src/update-check.js", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../packages/main/src/update-check.js")>()),
        requestLatestRelease: () => (signal: AbortSignal) => {
          signals.push(signal);
          return new Promise(() => {});
        },
      }));
      const h = await launch({ mode, locator: "located", version: "0.2.0" });
      const supervisor = h.supervisors[0]!;
      const original = supervisor.request.getMockImplementation()!;
      supervisor.request.mockImplementation(async (operation: string, ...rest: unknown[]) =>
        operation === "updateCheck.read" ? saved : original(operation, ...(rest as [])),
      );
      supervisor.storageChanged({ generation: supervisor.generation, state: "storage_ready" });
      for (let i = 0; i < 32; i++) await Promise.resolve();
      expect(supervisor.request).toHaveBeenCalledWith("updateCheck.read", {});
      expect(signals).toHaveLength(requests);
      const pushes = h.window.webContents.send.mock.calls.filter(
        ([channel]: [string]) => channel === h.constants.desktopChannels.updateState,
      );
      expect(pushes).toEqual(
        requests
          ? [
              [
                h.constants.desktopChannels.updateState,
                {
                  sequence: 1,
                  state: {
                    installedVersion: "0.2.0",
                    check: "checking",
                    failure: null,
                    available: null,
                  },
                },
              ],
            ]
          : [],
      );
      h.app.emit("before-quit", { preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(0);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    },
  );
  it("serves sequenced Linux portal motion to trusted windows and stops observing at a clean exit", async () => {
    const h = await launch({ platform: "linux" });
    expect(h.motion.started).toBe(1);
    const initial = h.event();
    h.ipcMain.emit(h.constants.desktopChannels.systemMotion, initial);
    expect(initial.returnValue).toEqual({ sequence: 0, value: "unknown" });
    const forged = { sender: h.window.webContents, senderFrame: { url: "https://example.test/" } };
    h.ipcMain.emit(h.constants.desktopChannels.systemMotion, forged);
    expect(forged.returnValue).toBeNull();
    h.motion.changed?.("reduce");
    expect(h.window.webContents.send).toHaveBeenCalledWith(
      h.constants.desktopChannels.systemMotion,
      { sequence: 1, value: "reduce" },
    );
    const later = h.event();
    h.ipcMain.emit(h.constants.desktopChannels.systemMotion, later);
    expect(later.returnValue).toEqual({ sequence: 1, value: "reduce" });
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.motion.disposed).toBe(1);
  });
  it("shares the installer shortcut identity only in a packaged Windows application", async () => {
    for (const [platform, mode, expected] of [
      ["win32", "installed", 1],
      ["win32", "development", 0],
      ["linux", "installed", 0],
      ["darwin", "installed", 0],
    ] as const) {
      const h = await launch({ platform, mode });
      expect(h.app.setAppUserModelId).toHaveBeenCalledTimes(expected);
      if (expected) expect(h.app.setAppUserModelId).toHaveBeenCalledWith("org.ohtia.Ohtia");
      cleanups.splice(0).forEach((cleanup) => cleanup());
    }
  });
  it("leaves Windows and macOS reduced motion to Chromium without a portal observer", async () => {
    for (const platform of ["win32", "darwin"] as const) {
      const h = await launch({ platform });
      expect(h.motion.started).toBe(0);
      const read = h.event();
      h.ipcMain.emit(h.constants.desktopChannels.systemMotion, read);
      expect(read.returnValue).toEqual({ sequence: 0, value: "unknown" });
      cleanups.splice(0).forEach((cleanup) => cleanup());
    }
  });
  it("opens a missing store only after explicit action, publishes admission and adopts the saved locale", async () => {
    const h = await launch();
    expect(h.utilityProcess.fork.mock.calls[0][1][3]).toBe("blocked");
    expect((await h.action("read")).state).toBe("pending_create");
    expect((await h.action("open_storage")).state).toBe("storage_opening");
    expect(h.utilityProcess.fork.mock.calls[1][1][3]).toBe("create");
    const current = h.supervisors.at(-1)!;
    current.storageChanged({
      generation: current.generation,
      state: "storage_ready",
      savedLocale: "ko-KR",
      localeFallback: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.publish).toHaveBeenCalledOnce();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(await h.action("read")).toMatchObject({
      locale: "ko-KR",
      state: "storage_ready",
      notice: "locale_fallback",
    });
    const publishAdmission = h.publish.mock.calls[0][3];
    expect(await publishAdmission()).toBe(true);
    current.stateChanged("unavailable");
    expect((await h.action("read")).state).toBe("storage_failed");
    expect(h.window.webContents.send).toHaveBeenCalledWith(
      h.constants.desktopChannels.ended,
      current.generation,
    );
  });
  it.each(["uncertain", "cancelled", "throw", "stop-failed"])(
    "preserves the previous bootstrap state after %s recovery",
    async (failure) => {
      const h = await launch({ locator: "located" });
      h.state.recover = failure;
      h.state.throwRecover = failure === "throw";
      h.state.stop = failure !== "stop-failed";
      const snapshot = await h.action("open_storage");
      expect(snapshot.state).toBe(failure === "throw" ? "storage_failed" : "located");
      if (failure === "uncertain" || failure === "stop-failed")
        expect(snapshot.notice).toBe("shutdown_uncertain");
    },
  );
  it("retains recovery gates and refuses a second pending storage action", async () => {
    const h = await launch();
    const checkpoint = {
      operation: "19dfd574-ee10-4aef-935c-c66afbf0cb6a",
      sourceRevision: 0,
      targetRevision: 40,
      release: "0.0.0-test",
      bytes: 4096,
      sha256: "0".repeat(64),
    };
    await expect(h.action("restore_checkpoint")).rejects.toThrow(/admission refused/);
    await expect(h.action("read", undefined, checkpoint.operation)).rejects.toThrow(
      /admission refused/,
    );
    h.supervisors[0].storageChanged({
      generation: h.supervisors[0].generation,
      state: "recovery_required",
      checkpoint,
    });
    const snapshot = await h.action("read");
    expect(snapshot.checkpoint).toMatchObject({
      operation: checkpoint.operation,
      release: checkpoint.release,
      bytes: checkpoint.bytes,
      sourceRevision: checkpoint.sourceRevision,
      targetRevision: checkpoint.targetRevision,
    });
    expect(snapshot.checkpoint).not.toHaveProperty("sha256");
    await h.action("open_storage");
    expect(await h.action("restore_checkpoint", undefined, checkpoint.operation)).toMatchObject({
      state: "recovery_required",
      notice: "recovery_stale",
    });
    expect(h.utilityProcess.fork).toHaveBeenCalledOnce();

    h.state.throwRecover = true;
    expect(
      await h.action("restore_checkpoint", undefined, snapshot.checkpoint.verification),
    ).toMatchObject({ state: "recovery_required", notice: "recovery_uncertain" });
    h.state.throwRecover = false;
    await h.action("restore_checkpoint", undefined, snapshot.checkpoint.verification);
    expect(h.utilityProcess.fork.mock.calls[1][1].slice(3)).toEqual([
      "restore",
      checkpoint.release,
      checkpoint.operation,
      checkpoint.sha256,
    ]);
    expect(
      await h.action("restore_checkpoint", undefined, snapshot.checkpoint.verification),
    ).toMatchObject({ state: "storage_opening", notice: "recovery_busy" });
    await h.action("retry_service");
    expect(h.utilityProcess.fork).toHaveBeenCalledTimes(2);

    const current = h.supervisors.at(-1)!;
    current.stateChanged("unavailable");
    expect(await h.action("read")).toMatchObject({
      state: "recovery_required",
      notice: "recovery_uncertain",
    });
    current.storageChanged({
      generation: current.generation,
      state: "retry_required",
      checkpointProblem: "checkpoint_missing",
      restoreFailure: "recovery_failed",
    });
    expect(await h.action("read")).toMatchObject({
      state: "retry_required",
      checkpointProblem: "checkpoint_missing",
      notice: "recovery_failed",
    });
    expect((await h.action("read")).checkpoint).toBeUndefined();
    await h.action("retry_service");
    expect(h.utilityProcess.fork.mock.calls[2][1][3]).toBe("retry");
  });
  it("keeps invalid locator phases closed while allowing later repair", async () => {
    const h = await launch({ locator: "locator_invalid" });
    expect((await h.action("read")).state).toBe("locator_invalid");
    expect(
      await h.action("restore_checkpoint", undefined, "19dfd574-ee10-4aef-935c-c66afbf0cb6a"),
    ).toMatchObject({ state: "locator_invalid", notice: "recovery_unavailable" });
    expect(h.utilityProcess.fork).toHaveBeenCalledOnce();
    h.state.locator = "located";
    await h.action("retry_service");
    expect(h.utilityProcess.fork.mock.calls[1][1][3]).toBe("blocked");
    const current = h.supervisors.at(-1)!;
    h.state.locator = "path_rejected";
    current.storageChanged({ generation: current.generation, state: "storage_ready" });
    expect((await h.action("read")).state).toBe("path_rejected");
  });
  it("limits windows and defers second-instance activation until the native frame is ready", async () => {
    const h = await launch();
    h.window.minimized = true;
    h.app.emit("second-instance");
    expect(h.window.restore).not.toHaveBeenCalled();
    h.window.emit("ready-to-show");
    expect(h.window.restore).toHaveBeenCalledOnce();
    expect(h.window.focus).toHaveBeenCalled();
    for (let i = 1; i < h.constants.portLimits.windows; i++) await h.action("new_window");
    expect(h.Window.all).toHaveLength(h.constants.portLimits.windows);
    expect((await h.action("new_window")).notice).toBe("resource_failure");
    for (const window of h.Window.all) {
      window.destroyed = true;
      window.emit("closed");
    }
    h.app.emit("second-instance");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.dialog.showErrorBox).not.toHaveBeenCalled();
    h.app.emit("window-all-closed");
    expect(h.app.quit).toHaveBeenCalled();
  });
  it.each(["stop-failed", "changed-sentinel", "clean"])(
    "handles %s shutdown without losing the live broker",
    async (outcome) => {
      const h = await launch();
      await h.action("read");
      h.window.emit("ready-to-show");
      h.state.stop = outcome !== "stop-failed";
      h.state.verify = outcome !== "changed-sentinel";
      const preventDefault = vi.fn();
      h.window.emit("close", { preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      h.app.quit.mockClear();
      h.app.emit("before-quit", { preventDefault });
      await vi.advanceTimersByTimeAsync(0);
      if (outcome === "clean") {
        expect(h.app.quit).toHaveBeenCalledOnce();
        h.app.emit("before-quit", { preventDefault });
      } else {
        expect(h.app.quit).not.toHaveBeenCalled();
        expect(h.dialog.showMessageBox).toHaveBeenCalled();
      }
    },
  );
  it("reports a resource overflow once and makes exit an explicit broker action", async () => {
    const h = await launch();
    await h.action("read");
    h.window.emit("ready-to-show");
    h.state.metrics = h.constants.portLimits.process_tree_count + 1;
    await vi.advanceTimersByTimeAsync(500);
    expect(h.dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalled();
    const beforeExit = h.app.quit.mock.calls.length;
    await h.action("exit");
    expect(h.app.quit.mock.calls.length).toBe(beforeExit + 1);
  });
  it("uses a bounded startup timeout before native readiness", async () => {
    const h = await launch({ ready: false });
    await vi.advanceTimersByTimeAsync(h.constants.portLimits.application_start_ms);
    expect(h.dialog.showErrorBox).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalled();
  });
});

it("starts the broker and serves admitted packaged branding and icon paths", async () => {
  const result = await launch({
    assetNames: [
      "icons/menu.svg",
      "branding/illustration.png",
      "branding/illustration.svg",
      "branding/symbol.svg",
    ],
  });
  expect(result.failure).toBeUndefined();
  expect(result.Window.all).toHaveLength(1);
  expect(result.dialog.showErrorBox).not.toHaveBeenCalled();
  const handler = result.nativeSession.protocol.handle.mock.calls[0][1];
  for (const name of [
    "icons/menu.svg",
    "branding/illustration.png",
    "branding/illustration.svg",
    "branding/symbol.svg",
  ]) {
    const response = handler({ url: `ohtia://app/${name}`, method: "GET" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      name.endsWith("png") ? "image/png" : "image/svg+xml",
    );
  }
  expect(handler({ url: "ohtia://app/icons/menu.js", method: "GET" }).status).toBe(403);
});

it("resolves an unavailable OS language list and propagates admitted locale changes through the broker", async () => {
  const h = await launch({ languagesUnavailable: true, locator: "located" });
  expect((await h.action("read")).locale).toBe("en-US");
  const supervisor = h.supervisors[0];
  supervisor.storageChanged({ generation: supervisor.generation, state: "storage_ready" });
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(await h.action("read")).toMatchObject({ state: "storage_ready" });
  supervisor.localeChanged?.({
    serviceGeneration: "service-1",
    record: { schemaVersion: 1, revision: 1, value: "ko-KR", source: "saved" },
    systemLocale: "en-US",
    effectiveLocale: "ko-KR",
  });
  expect((await h.action("read")).locale).toBe("ko-KR");
  expect(h.window.setTitle).toHaveBeenCalledWith("Ohtia");
  const sessionEvent = h.event();
  h.ipcMain.emit(h.constants.desktopChannels.session, sessionEvent);
  const session = sessionEvent.returnValue;
  const encoded = h.constants.encodeEnvelope({
    ...session,
    protocol: 1,
    policy: h.constants.policyId,
    kind: "request",
    requestId: "locale-request",
    operationId: "locale-intent",
    operation: "locale.replace",
    payload: { expectedRevision: 1, value: "system" },
  });
  expect(encoded.ok).toBe(true);
  if (encoded.ok) h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), encoded.value);
  expect(supervisor.setSystemLocale).toHaveBeenCalledWith("en-US");
});

it("admits the closed command broker on the actual sender, confirms localized copy and denies arbitrary links/effects", async () => {
  const h = await launch();
  const electron = await import("electron");
  const context = await h.command("context");
  expect(context.platform).toBe(process.platform);
  expect(await h.command("perform", "research.confirm")).toBe(false);
  expect(await h.command("open_link", "https://example.invalid")).toBe(false);
  expect(await h.command("about", "extra")).toBe(false);
  expect(await h.command("copy_version", "xx-XX")).toBe(false);
  expect(await h.command("publish", {})).toBe(false);
  const info = await h.command("about");
  expect(info).toMatchObject({ product: "Ohtia", version: "0.0.0-test" });
  let copied = "";
  vi.mocked(electron.clipboard.writeText).mockImplementation(async (text) => {
    copied = text;
  });
  vi.mocked(electron.clipboard.readText).mockImplementation(async () => copied);
  expect(await h.command("copy_version", "ko-KR")).toBe(true);
  expect(copied).toContain("시스템: ");
  vi.mocked(electron.clipboard.readText).mockRejectedValueOnce(new Error("Clipboard unavailable"));
  expect(await h.command("copy_version", "en-US")).toBe(false);
  expect(await h.command("open_link", "repository")).toBe(true);
  expect(electron.shell.openExternal).toHaveBeenLastCalledWith(h.constants.projectLinks.repository);
  expect(await h.command("open_link", "chatgptUsage")).toBe(true);
  expect(electron.shell.openExternal).toHaveBeenLastCalledWith(
    "https://chatgpt.com/settings/usage",
  );
  for (const id of [
    "https://example.invalid",
    "javascript:alert(1)",
    "file:///tmp/usage",
    "__proto__",
  ])
    expect(await h.command("open_link", id)).toBe(false);
  for (const id of ["link.documentation", "link.report"] as const)
    expect(await h.command("perform", id)).toBe(true);
  expect(await h.command("open_notice_link", "React")).toBe(true);
  expect(electron.shell.openExternal).toHaveBeenLastCalledWith("https://github.com/react/react");
  const opened = vi.mocked(electron.shell.openExternal).mock.calls.length;
  for (const component of [
    "https://example.invalid",
    "react",
    "Lucide",
    "__proto__",
    "",
    undefined,
    { component: "React" },
  ])
    expect(await h.command("open_notice_link", component)).toBe(false);
  expect(electron.shell.openExternal).toHaveBeenCalledTimes(opened);
  vi.mocked(electron.shell.openExternal).mockRejectedValueOnce(new Error("Browser unavailable"));
  expect(await h.command("open_notice_link", "React")).toBe(false);
  vi.mocked(electron.shell.openExternal).mockRejectedValueOnce(new Error("Browser unavailable"));
  expect(await h.command("open_link", "report")).toBe(false);
  // SPEC-001-040: without a known desktop, Linux only explains the system update.
  const launched = vi.mocked(electron.shell.openExternal).mock.calls.length;
  expect(await h.command("update_route")).toBe("system");
  expect(await h.command("open_update_route")).toBe(false);
  expect(await h.command("update_route", "download_page")).toBe(false);
  expect(await h.command("open_update_route", "https://example.invalid")).toBe(false);
  expect(electron.shell.openExternal).toHaveBeenCalledTimes(launched);
  expect(await h.command("perform", "window.fullscreen")).toBe(true);
  expect(h.window.setFullScreen).toHaveBeenCalledWith(true);
  const edits = {
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
  };
  Object.assign(h.window.webContents, edits);
  for (const id of Object.keys(edits) as (keyof typeof edits)[]) {
    expect(await h.command("perform", `edit.${id}`)).toBe(true);
    expect(edits[id]).toHaveBeenCalledOnce();
  }
  await h.command("perform", "window.close");
  expect(h.window.close).toHaveBeenCalledOnce();
  await h.command("perform", "application.quit");
  expect(h.app.quit).toHaveBeenCalled();
  const handler = h.ipcMain.handle.mock.calls.find(
    ([channel]) => channel === h.constants.desktopChannels.commands,
  )![1];
  await expect(
    handler({ ...h.event(), senderFrame: { url: h.constants.desktopDocument } }, "about"),
  ).rejects.toThrow(/sender admission/);
});

it("routes message effects through the admitted window and revokes a pending copy on navigation", async () => {
  const h = await launch({ mode: "development", developmentBuild: true, locator: "located" });
  const electron = await import("electron");
  expect(await h.command("copy_message", "019a8000-0000-7000-8000-000000000503")).toBe(false);
  expect(await h.command("open_external_link", "https://example.org/research")).toBe(true);
  expect(electron.shell.openExternal).toHaveBeenLastCalledWith("https://example.org/research");
  expect(await h.command("open_external_link", "javascript:alert(1)")).toBe(false);
  const supervisor = h.supervisors[0];
  supervisor.stateChanged("ready");
  supervisor.storageChanged({ generation: supervisor.generation, state: "storage_ready" });
  await vi.advanceTimersByTimeAsync(0);
  const channel = supervisor.connectProvider.mock.calls[0][0];
  const projectId = "019a8000-0000-7000-8000-000000000501";
  const conversationId = "019a8000-0000-7000-8000-000000000502";
  const id = "019a8000-0000-7000-8000-000000000503";
  const open = () =>
    channel.report({
      kind: "development_report",
      version: 1,
      generation: supervisor.generation,
      operation_id: "synthetic-message-check",
      report: { type: "conversation_opened", projectId, conversationId },
    });
  open();
  h.ipcMain.emit(h.constants.desktopChannels.session, h.event());
  const result = {
    ok: true,
    value: {
      items: [{ kind: "message", id, content: "Original **Markdown**" }],
      remaining: [],
    },
  };
  supervisor.request.mockResolvedValueOnce(result);
  vi.mocked(electron.clipboard.readText).mockResolvedValueOnce("Original **Markdown**");
  expect(await h.command("copy_message", id)).toBe(true);
  expect(supervisor.request).toHaveBeenLastCalledWith("timeline.read", {
    conversationId,
    ids: [id],
  });
  expect(electron.clipboard.writeText).toHaveBeenLastCalledWith("Original **Markdown**");
  await h.action("new_window");
  expect(await h.command("copy_message", id, h.Window.all.at(-1))).toBe(false);
  let release!: (value: unknown) => void;
  supervisor.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = h.command("copy_message", id);
  await Promise.resolve();
  open();
  release(result);
  expect(await pending).toBe(false);
  expect(electron.clipboard.writeText).toHaveBeenCalledOnce();
  const handler = h.ipcMain.handle.mock.calls.find(
    ([name]) => name === h.constants.desktopChannels.commands,
  )![1];
  await expect(
    handler({ ...h.event(), senderFrame: { url: "https://example.org" } }, "copy_message", id),
  ).rejects.toThrow(/sender admission/);
});

it("shares one admission budget between named broker requests and the service port", async () => {
  const h = await launch();
  const electron = await import("electron");
  const sessionEvent = h.event();
  h.ipcMain.emit(h.constants.desktopChannels.session, sessionEvent);
  let serial = 0;
  const send = () => {
    const encoded = h.constants.encodeEnvelope({
      ...sessionEvent.returnValue,
      protocol: 1,
      policy: h.constants.policyId,
      kind: "request",
      requestId: `shared-${++serial}`,
      operationId: `operation-${serial}`,
      operation: "status.read",
      payload: {},
    });
    expect(encoded.ok).toBe(true);
    if (encoded.ok) h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), encoded.value);
  };
  const supervisor = h.supervisors[0];
  for (let i = 0; i < h.constants.portLimits.pending_per_window; i++) send();
  expect(supervisor.dispatch).toHaveBeenCalledTimes(h.constants.portLimits.pending_per_window);
  expect(await h.command("about")).toBe(false);
  // Control handshakes cannot deadlock behind effect-bearing requests.
  expect(await h.command("context")).toHaveProperty("windowGeneration");
  expect(await h.command("perform", "application.quit")).toBe(true);
  expect(await h.command("perform", "window.close")).toBe(true);
  for (const [accepted] of supervisor.dispatch.mock.calls) accepted.release();
  supervisor.dispatch.mockClear();
  expect(await h.command("about")).toHaveProperty("product", "Ohtia");
  const finish: (() => void)[] = [];
  vi.mocked(electron.clipboard.writeText).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish.push(resolve);
      }),
  );
  const copying = Array.from({ length: h.constants.portLimits.pending_per_window }, () =>
    h.command("copy_version", "en-US"),
  );
  send();
  expect(supervisor.dispatch).not.toHaveBeenCalled();
  finish.forEach((resolve) => resolve());
  await Promise.all(copying);
  send();
  expect(supervisor.dispatch).toHaveBeenCalledOnce();
  supervisor.dispatch.mock.calls[0][0].release();
});

it("configures KDE Wayland graphics before native readiness in every runtime mode", async () => {
  for (const mode of ["development", "installed", "qualification"] as const) {
    const { app, failure } = await launch({ mode, kdeWayland: true, ready: false });
    expect(failure).toBeUndefined();
    if (process.platform === "linux") {
      expect(app.commandLine.appendSwitch.mock.calls).toEqual([
        ["disable-features", "ExistingFeature,WaylandWpColorManagerV1"],
      ]);
      expect(app.commandLine.appendSwitch.mock.invocationCallOrder[0]).toBeLessThan(
        app.whenReady.mock.invocationCallOrder[0]!,
      );
    } else expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(app.enableSandbox).toHaveBeenCalledOnce();
  }
});

it("creates at most one native window per admitted command intent and reports the live limit", async () => {
  const h = await launch();
  const context = await h.command("context");
  const request = {
    intent: {
      windowGeneration: context.windowGeneration,
      source: "renderer",
      sequence: 1,
      command: "window.new",
    },
  };
  const results = await Promise.all([
    h.command("window_action", request),
    h.command("window_action", request),
  ]);
  expect(results).toEqual([{ status: "completed" }, { status: "completed" }]);
  expect(h.Window.all).toHaveLength(2);
  for (let sequence = 2; h.Window.all.length < h.constants.portLimits.windows; sequence++)
    await h.command("window_action", { intent: { ...request.intent, sequence } });
  expect(
    await h.command("window_action", { intent: { ...request.intent, sequence: 100 } }),
  ).toEqual({ status: "unavailable", reason: "window_limit" });
  expect(h.Window.all).toHaveLength(h.constants.portLimits.windows);
  expect(
    await h.command("window_action", {
      intent: { ...request.intent, sequence: 101, windowGeneration: "obsolete" },
    }),
  ).toEqual({ status: "stale_context" });
  expect(await h.command("window_action", { ...request, private: true })).toBe(false);
});
it("keeps native backgrounds ordered and drains a close-time write before stopping the service", async () => {
  const h = await launch({ locator: "located" });
  const supervisor = h.supervisors[0];
  const bounds = { version: 1, x: 50, y: 60, width: 900, height: 700, maximized: true };
  let revision = 3;
  const outcomes: string[] = [];
  supervisor.request.mockImplementation(async (operation: string) => {
    outcomes.push(operation);
    if (operation === "presentation.read")
      return { ok: false, error: { code: "service_unavailable" } } as never;
    if (operation === "bounds.read")
      return {
        ok: true,
        value: { schemaVersion: 1, revision, value: bounds, source: "saved" },
      } as never;
    if (operation === "appearance.read") {
      supervisor.appearanceChanged?.({
        schemaVersion: 1,
        revision: 2,
        value: "dark",
        source: "saved",
      });
      return {
        ok: true,
        value: { schemaVersion: 1, revision: 2, value: "dark", source: "saved" },
      } as never;
    }
    return {
      ok: true,
      value: { schemaVersion: 1, revision: ++revision, value: bounds, source: "saved" },
    } as never;
  });
  supervisor.storageChanged({ generation: supervisor.generation, state: "storage_ready" });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(await h.action("read")).toMatchObject({ state: "storage_ready" });
  expect(h.window.setBounds).toHaveBeenCalledWith({
    x: 50,
    y: 60,
    width: 900,
    height: 700,
  });
  expect(h.window.maximize).not.toHaveBeenCalled();
  h.window.emit("ready-to-show");
  expect(h.window.maximize).toHaveBeenCalledOnce();
  expect(h.window.setBackgroundColor).toHaveBeenLastCalledWith(
    h.constants.windowTokens.dark["surface.page"],
  );
  supervisor.appearanceChanged?.({
    schemaVersion: 1,
    revision: 1,
    value: "light",
    source: "saved",
  });
  expect(h.window.setBackgroundColor).toHaveBeenLastCalledWith(
    h.constants.windowTokens.dark["surface.page"],
  );
  await h.action("new_window");
  h.window.emit("close", { preventDefault: vi.fn() });
  expect(supervisor.stop).not.toHaveBeenCalled();
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(outcomes).toContain("bounds.replace");
  expect(supervisor.stop).toHaveBeenCalledOnce();
  expect(outcomes.filter((operation) => operation === "bounds.replace")).toHaveLength(2);
});
it("refuses renderer window preference operations before dispatch and paints only on ready-to-show", async () => {
  const h = await launch();
  expect(h.window.show).not.toHaveBeenCalled();
  expect(h.window.setMinimumSize).toHaveBeenCalledWith(322, 402);
  expect(h.window.settings).toMatchObject({
    show: false,
    minWidth: 320,
    minHeight: 400,
    backgroundColor: h.constants.windowTokens.light["surface.page"],
  });
  const sessionEvent = h.event();
  h.ipcMain.emit(h.constants.desktopChannels.session, sessionEvent);
  const encoded = h.constants.encodeEnvelope({
    ...sessionEvent.returnValue,
    protocol: 1,
    policy: h.constants.policyId,
    kind: "request",
    requestId: "bounds-spoof",
    operationId: "bounds-spoof",
    operation: "bounds.read",
    payload: {},
  });
  expect(encoded.ok).toBe(true);
  if (encoded.ok) h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), encoded.value);
  expect(h.supervisors[0].dispatch).not.toHaveBeenCalled();
  expect(h.window.webContents.mainFrame.send).toHaveBeenCalledWith(
    h.constants.desktopChannels.reply,
    expect.stringContaining('"unauthorized"'),
  );
  h.window.emit("ready-to-show");
  expect(h.window.show).toHaveBeenCalledOnce();
});

it("opens the validated native application menu on the admitted originating window", async () => {
  const h = await launch();
  const electron = await import("electron");
  const context = await h.command("context");
  expect(
    await h.command("publish", {
      windowGeneration: context.windowGeneration,
      revision: 1,
      locale: "en-US",
      entries: h.constants.commandIds.map((id) => ({ id })),
    }),
  ).toBe(true);
  const popup = vi.fn((options) => options.callback());
  vi.mocked(electron.Menu.buildFromTemplate).mockReturnValueOnce({
    popup,
    closePopup: vi.fn(),
  } as never);
  const result = await h.command("window_action", {
    intent: {
      windowGeneration: context.windowGeneration,
      source: "renderer",
      sequence: 1,
      command: "menu.open",
    },
    anchor: { x: 8, y: 48 },
    input: "keyboard",
  });
  expect(result).toEqual(
    process.platform === "darwin"
      ? { status: "failed" }
      : { status: "completed", menuDismissed: true },
  );
  if (process.platform !== "darwin")
    expect(popup).toHaveBeenCalledWith(
      expect.objectContaining({ window: h.window, x: 8, y: 48, sourceType: "keyboard" }),
    );
});

it("saves the latest bounds on a second quit after shutdown was refused", async () => {
  const h = await launch({ locator: "located" });
  const supervisor = h.supervisors[0];
  const values: unknown[] = [];
  let revision = 0;
  supervisor.request.mockImplementation(async (operation: string, payload?: { value: unknown }) => {
    if (operation === "appearance.read")
      return {
        ok: true,
        value: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
      };
    if (operation === "bounds.read")
      return {
        ok: true,
        value: {
          schemaVersion: 1,
          revision,
          value: revision ? values.at(-1) : null,
          source: revision ? "saved" : "default",
        },
      } as never;
    if (operation === "bounds.replace") {
      values.push(payload?.value);
      return {
        ok: true,
        value: { schemaVersion: 1, revision: ++revision, source: "saved", value: payload?.value },
      } as never;
    }
    return { ok: false, error: { code: "service_unavailable" } } as never;
  });
  supervisor.storageChanged({ generation: supervisor.generation, state: "storage_ready" });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  h.window.getNormalBounds = vi.fn(() => ({ x: 50, y: 60, width: 900, height: 700 }));
  h.state.stop = false;
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(values).toHaveLength(1);
  h.window.getNormalBounds = vi.fn(() => ({ x: 90, y: 60, width: 900, height: 700 }));
  h.state.stop = true;
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(values).toMatchObject([{ x: 50 }, { x: 90 }]);
});

it("uses system native colors during storage recovery and skips outage-time bounds writes", async () => {
  const h = await launch({ locator: "located" });
  await h.action("open_storage");
  const peer = h.supervisors.at(-1)!;
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  peer.appearanceChanged?.({ schemaVersion: 1, revision: 5, value: "dark", source: "saved" });
  expect(h.window.setBackgroundColor).toHaveBeenLastCalledWith(
    h.constants.windowTokens.dark["surface.page"],
  );
  const { nativeTheme } = await import("electron");
  expect(nativeTheme.themeSource).toBe("dark");
  const updates = vi.fn();
  nativeTheme.on("updated", updates);
  nativeTheme.emit("updated");
  expect(updates).toHaveBeenCalledOnce();
  await h.action("new_window");
  expect(h.Window.all.at(-1)!.themeAtCreation).toBe("dark");
  peer.request.mockClear();
  peer.stateChanged("unavailable");
  expect(nativeTheme.themeSource).toBe("system");
  const system = nativeTheme as typeof nativeTheme & { systemDark: boolean };
  system.systemDark = true;
  nativeTheme.emit("updated");
  expect(h.window.setBackgroundColor).toHaveBeenLastCalledWith(
    h.constants.windowTokens.dark["surface.page"],
  );
  system.systemDark = false;
  nativeTheme.emit("updated");
  expect(h.window.setBackgroundColor).toHaveBeenLastCalledWith(
    h.constants.windowTokens.light["surface.page"],
  );
  h.window.emit("close", { preventDefault: vi.fn() });
  expect(peer.request).not.toHaveBeenCalled();
});

it("reports process capacity as busy rather than the active-window limit", async () => {
  const h = await launch();
  const context = await h.command("context");
  h.state.metrics = h.constants.portLimits.process_tree_count;
  expect(
    await h.command("window_action", {
      intent: {
        windowGeneration: context.windowGeneration,
        command: "window.new",
        source: "renderer",
        sequence: 1,
      },
    }),
  ).toEqual({ status: "unavailable", reason: "busy" });
  expect(h.Window.all).toHaveLength(1);
});

it("keeps restored maximized windows hidden until ready, including New window", async () => {
  const h = await launch({ locator: "located" });
  const peer = h.supervisors[0];
  peer.request.mockImplementation(async (operation: string) =>
    operation === "bounds.read"
      ? ({
          ok: true,
          value: {
            schemaVersion: 1,
            revision: 1,
            source: "saved",
            value: { version: 1, x: 0, y: 0, width: 900, height: 650, maximized: true },
          },
        } as never)
      : operation === "appearance.read"
        ? { ok: true, value: { schemaVersion: 1, revision: 0, value: "system", source: "default" } }
        : ({ ok: false, error: { code: "service_unavailable" } } as never),
  );
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  h.app.emit("second-instance");
  expect(h.window.visible).toBe(false);
  expect(h.window.maximize).not.toHaveBeenCalled();
  expect(h.window.focus).not.toHaveBeenCalled();
  h.window.emit("ready-to-show");
  expect(h.window.visible).toBe(true);
  expect(h.window.focus).toHaveBeenCalledOnce();
  await h.action("new_window");
  const next = h.Window.all[1]!;
  expect(next.visible).toBe(false);
  expect(next.maximize).not.toHaveBeenCalled();
  next.emit("ready-to-show");
  expect(next.maximize).toHaveBeenCalledOnce();
  expect(next.visible).toBe(true);
});

it.each(["service", "sentinel"])(
  "presents a frame that became ready during a refused %s shutdown",
  async (failure) => {
    const h = await launch();
    if (failure === "service") h.state.stop = false;
    else h.state.verify = false;
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    h.window.emit("ready-to-show");
    expect(h.window.visible).toBe(false);
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(h.window.visible).toBe(true);
    expect(h.window.show).toHaveBeenCalledOnce();
  },
);

it("retains the application startup bound until first paint even after bootstrap IPC succeeds", async () => {
  const h = await launch();
  await h.action("read");
  await vi.advanceTimersByTimeAsync(h.constants.portLimits.application_start_ms);
  expect(h.window.show).not.toHaveBeenCalled();
  expect(h.dialog.showErrorBox).toHaveBeenCalled();
  expect(h.app.quit).toHaveBeenCalled();
});

it("does not publish workspace readiness when the admitted writer dies during preference reads", async () => {
  const h = await launch({ locator: "located" });
  let finishRecovery!: () => void;
  const recovery = new Promise<void>((resolve) => {
    finishRecovery = resolve;
  });
  h.recoverService.mockImplementationOnce(async (_service, admitted, restart) => {
    if (!admitted()) return "cancelled";
    restart();
    await recovery;
    return "ready";
  });
  const opening = h.action("open_storage");
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const peer = h.supervisors.at(-1)!;
  let finishAppearance!: () => void;
  peer.request.mockImplementation(async (operation: string) =>
    operation === "appearance.read"
      ? new Promise((resolve) => {
          finishAppearance = () =>
            resolve({ ok: false, error: { code: "service_unavailable" } } as never);
        })
      : ({ ok: false, error: { code: "service_unavailable" } } as never),
  );
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  expect(finishAppearance).toBeTypeOf("function");
  peer.available = false;
  peer.stateChanged("unavailable");
  finishAppearance();
  for (let i = 0; i < 16; i++) await Promise.resolve();
  finishRecovery();
  expect(await opening).toMatchObject({ state: "storage_failed" });
  expect(await h.action("read")).toMatchObject({ state: "storage_failed" });
});

it("permits Wayland reveal after admitted local load without requiring a hidden first frame", async () => {
  const h = await launch({ kdeWayland: true, loadPending: true });
  expect(h.window.show).not.toHaveBeenCalled();
  h.app.emit("second-instance");
  expect(h.window.focus).not.toHaveBeenCalled();
  h.window.completeLoad();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  if (process.platform === "linux") {
    expect(h.window.show).toHaveBeenCalledOnce();
    expect(h.window.focus).toHaveBeenCalledOnce();
  } else {
    expect(h.window.show).not.toHaveBeenCalled();
    expect(h.window.focus).not.toHaveBeenCalled();
  }
  h.window.emit("ready-to-show");
  expect(h.window.show).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(h.constants.portLimits.application_start_ms);
  expect(h.app.exit).not.toHaveBeenCalled();
  const ordinary = await launch({ loadPending: true });
  ordinary.window.completeLoad();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  expect(ordinary.window.show).not.toHaveBeenCalled();
  ordinary.window.emit("ready-to-show");
  expect(ordinary.window.show).toHaveBeenCalledOnce();
});
it("does not reveal a failed, disposed, quitting or unadmitted Wayland document", async () => {
  const failed = await launch({ kdeWayland: true, loadFailure: true });
  expect(failed.window.show).not.toHaveBeenCalled();
  for (const condition of ["disposed", "quitting", "other-document"] as const) {
    const h = await launch({ kdeWayland: true, loadPending: true });
    if (condition === "disposed") {
      h.window.destroyed = true;
      Object.defineProperty(h.window.webContents, "mainFrame", {
        get: () => {
          throw new Error("Destroyed native frame must not be inspected");
        },
      });
    } else if (condition === "quitting") h.app.emit("before-quit", { preventDefault: vi.fn() });
    else h.window.webContents.mainFrame.url = "about:blank";
    h.window.completeLoad();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(h.window.show).not.toHaveBeenCalled();
    if (condition === "disposed") expect(h.app.exit).not.toHaveBeenCalled();
  }
});
it("waits for document configuration when a Wayland ready frame precedes load completion", async () => {
  const h = await launch({ kdeWayland: true, loadPending: true });
  h.window.emit("ready-to-show");
  expect(h.window.show).not.toHaveBeenCalled();
  h.window.completeLoad();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  expect(h.window.show).toHaveBeenCalledOnce();
});

it("uses the resolved Ozone backend instead of session hints for Wayland exceptions", async () => {
  const x11 = await launch({ kdeWayland: true, ozonePlatform: "x11", loadPending: true });
  expect(x11.window.settings).toHaveProperty("x");
  x11.window.completeLoad();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  expect(x11.window.show).not.toHaveBeenCalled();
  x11.window.emit("ready-to-show");
  expect(x11.window.show).toHaveBeenCalledOnce();
  const wayland = await launch({ ozonePlatform: "wayland", loadPending: true });
  expect("x" in (wayland.window.settings as object)).toBe(process.platform !== "linux");
  wayland.window.completeLoad();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  expect(wayland.window.show).toHaveBeenCalledTimes(process.platform === "linux" ? 1 : 0);
});

it.each(["bounds.read", "appearance.read"])(
  "refuses New window when its %s read is busy",
  async (busy) => {
    const h = await launch({ locator: "located" });
    await h.action("open_storage");
    const peer = h.supervisors.at(-1)!;
    peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
    for (let i = 0; i < 16; i++) await Promise.resolve();
    peer.request.mockImplementation(async (operation: string) =>
      operation === busy
        ? ({ ok: false, error: { code: "busy" } } as never)
        : ({
            ok: true,
            value: { schemaVersion: 1, revision: 0, value: null, source: "default" },
          } as never),
    );
    const context = await h.command("context");
    expect(
      await h.command("window_action", {
        intent: {
          windowGeneration: context.windowGeneration,
          source: "renderer",
          sequence: 1,
          command: "window.new",
        },
      }),
    ).toEqual({ status: "unavailable", reason: "busy" });
    expect(h.Window.all).toHaveLength(1);
  },
);
it("preserves popup revocation as a silent command outcome in the broker reply", async () => {
  const h = await launch();
  const { CommandMenus } = await import("../packages/main/src/command-menus.js");
  const popup = vi.spyOn(CommandMenus.prototype, "popup").mockResolvedValueOnce("revoked");
  try {
    const context = await h.command("context");
    expect(
      await h.command("window_action", {
        intent: {
          windowGeneration: context.windowGeneration,
          source: "renderer",
          sequence: 1,
          command: "menu.open",
        },
        anchor: { x: 0, y: 48 },
        input: "pointer",
      }),
    ).toEqual({ status: "revoked" });
  } finally {
    popup.mockRestore();
  }
});

it("returns the closed busy result when native broker work exhausts a window's request quota", async () => {
  const h = await launch();
  const { shell } = await import("electron");
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.mocked(shell.openExternal).mockImplementation(() => held);
  const pending = Array.from({ length: h.constants.portLimits.pending_per_window }, () =>
    h.command("open_link", "documentation"),
  );
  const context = await h.command("context");
  const request = {
    intent: {
      windowGeneration: context.windowGeneration,
      source: "renderer",
      sequence: 1,
      command: "window.new",
    },
  };
  try {
    expect(await h.command("window_action", request)).toEqual({
      status: "unavailable",
      reason: "busy",
    });
    expect(h.Window.all).toHaveLength(1);
  } finally {
    finish();
    await Promise.all(pending);
  }
  expect(await h.command("window_action", { intent: { ...request.intent, sequence: 2 } })).toEqual({
    status: "completed",
  });
  expect(h.Window.all).toHaveLength(2);
});
it.each(["qualification", "development", "installed"] as const)(
  "configures visual zoom only after a live document exists in %s mode",
  async (mode) => {
    const h = await launch({ mode, requireLiveZoomFrame: true });
    expect(h.window.documentReady).toBe(true);
    expect(h.window.webContents.setVisualZoomLevelLimits).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(h.app.quit).not.toHaveBeenCalled();
    expect(h.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
    h.window.emit("ready-to-show");
    expect(h.window.show).toHaveBeenCalled();
  },
);
it("keeps a loaded window hidden until its visual zoom policy is acknowledged", async () => {
  const h = await launch({ requireLiveZoomFrame: true, deferZoomPolicy: true });
  h.window.emit("ready-to-show");
  expect(h.window.show).not.toHaveBeenCalled();
  h.acknowledgeZoom();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.window.show).toHaveBeenCalledOnce();
});
it("preserves a failed visual zoom policy as a startup failure without showing the window", async () => {
  const h = await launch({ requireLiveZoomFrame: true, rejectZoomPolicy: true });
  h.window.emit("ready-to-show");
  expect(h.window.show).not.toHaveBeenCalled();
  expect(h.app.quit).toHaveBeenCalled();
});
it.each([false, true])(
  "does not show or report a destroyed window after its pending zoom policy settles (reject=%s)",
  async (rejectZoomPolicy) => {
    const h = await launch({
      requireLiveZoomFrame: true,
      deferZoomPolicy: true,
      rejectZoomPolicy,
    });
    h.window.destroyed = true;
    h.acknowledgeZoom();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.window.show).not.toHaveBeenCalled();
    expect(h.app.quit).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "gates second-instance activation on the pending zoom policy (reject=%s)",
  async (rejectZoomPolicy) => {
    const h = await launch({ requireLiveZoomFrame: true, deferZoomPolicy: true, rejectZoomPolicy });
    h.window.minimized = true;
    h.app.emit("second-instance");
    h.window.emit("ready-to-show");
    expect(h.window.restore).not.toHaveBeenCalled();
    expect(h.window.show).not.toHaveBeenCalled();
    expect(h.window.focus).not.toHaveBeenCalled();
    h.acknowledgeZoom();
    await vi.advanceTimersByTimeAsync(0);
    if (rejectZoomPolicy) {
      expect(h.window.show).not.toHaveBeenCalled();
      expect(h.window.focus).not.toHaveBeenCalled();
      expect(h.app.quit).toHaveBeenCalled();
    } else {
      expect(h.window.restore).toHaveBeenCalledOnce();
      expect(h.window.show).toHaveBeenCalledOnce();
      expect(h.window.focus).toHaveBeenCalledOnce();
      expect(h.app.quit).not.toHaveBeenCalled();
    }
  },
);

it.each(["throwing", "ineffective"] as const)(
  "refuses every reveal effect after %s confirmed zoom application",
  async (failureMode) => {
    const h = await launch({ requireLiveZoomFrame: true, deferZoomPolicy: true });
    if (failureMode === "throwing")
      h.window.webContents.setZoomFactor.mockImplementation(() => {
        throw new Error("Synthetic zoom application failure");
      });
    const peer = h.supervisors[0];
    peer.presentationChanged?.({
      serviceGeneration: peer.generation,
      appearance: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
      character: { schemaVersion: 1, revision: 0, value: "animated", source: "default" },
      sourceQuote: { schemaVersion: 1, revision: 0, value: 144, source: "default" },
      entryText: { schemaVersion: 1, revision: 0, value: 288, source: "default" },
      zoom: { schemaVersion: 1, revision: 1, value: 125, source: "saved" },
    });
    h.window.minimized = true;
    h.app.emit("second-instance");
    h.window.emit("ready-to-show");
    h.acknowledgeZoom();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.window.show).not.toHaveBeenCalled();
    expect(h.window.restore).not.toHaveBeenCalled();
    expect(h.window.maximize).not.toHaveBeenCalled();
    expect(h.window.focus).not.toHaveBeenCalled();
    expect(h.app.quit).toHaveBeenCalled();
  },
);
it.each(["bounds.read", "appearance.read"] as const)(
  "refuses storage activation when %s is busy or fails",
  async (operation) => {
    for (const code of ["busy", "storage_failed"] as const) {
      const h = await launch({ locator: "located" });
      const peer = h.supervisors[0];
      peer.request.mockImplementation(async (current) =>
        current === operation
          ? { ok: false, error: { code } }
          : current === "bounds.read"
            ? {
                ok: true,
                value: {
                  schemaVersion: 1,
                  revision: 2,
                  value: { version: 1, x: 50, y: 60, width: 900, height: 700, maximized: false },
                  source: "saved",
                },
              }
            : current === "appearance.read"
              ? {
                  ok: true,
                  value: { schemaVersion: 1, revision: 2, value: "dark", source: "saved" },
                }
              : { ok: false, error: { code: "service_unavailable" } },
      );
      peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
      for (let i = 0; i < 24; i++) await Promise.resolve();
      expect(await h.action("read")).toMatchObject({ state: "storage_failed" });
      expect(h.window.setBounds).not.toHaveBeenCalled();
      expect(h.window.setBackgroundColor).not.toHaveBeenCalledWith(
        h.constants.windowTokens.dark["surface.page"],
      );
    }
  },
);

it.each([
  ["appearance.replace", { expectedRevision: 0, value: "dark" }],
  ["locale.replace", { expectedRevision: 0, value: "es-ES" }],
  [
    "layout.replace",
    {
      expectedRevision: 0,
      value: {
        version: 1,
        visible: { explorer: true, documents: true, chat: true },
        preferredWidths: { explorer: 256, documents: 652, chat: 360 },
      },
    },
  ],
  ["character.replace", { expectedRevision: 0, value: "hidden" }],
  ["zoom.replace", { expectedRevision: 0, value: 125 }],
  ["zoom.adjust", { intent: "increase" }],
] as const)(
  "refuses %s while broker preference readiness is withheld without retaining a request slot",
  async (operation, payload) => {
    const h = await launch({ locator: "located" });
    const peer = h.supervisors[0];
    peer.request.mockResolvedValue({ ok: false, error: { code: "busy" } });
    peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
    for (let i = 0; i < 24; i++) await Promise.resolve();
    expect(await h.action("read")).toMatchObject({ state: "storage_failed" });
    const event = h.event();
    h.ipcMain.emit(h.constants.desktopChannels.session, event);
    const send = (id: number, op: string, data: unknown) => {
      const request = h.constants.encodeEnvelope({
        ...event.returnValue,
        protocol: 1,
        policy: h.constants.policyId,
        kind: "request",
        requestId: `readiness-request-${id}`,
        operationId: `readiness-operation-${id}`,
        operation: op,
        payload: data,
      });
      expect(request.ok).toBe(true);
      if (request.ok) h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), request.value);
    };
    for (let id = 0; id <= h.constants.portLimits.pending_per_window; id++) {
      send(id, operation, payload);
      expect(peer.dispatch).not.toHaveBeenCalled();
      expect(h.window.webContents.mainFrame.send).toHaveBeenLastCalledWith(
        h.constants.desktopChannels.reply,
        expect.stringContaining('"code":"service_unavailable"'),
      );
    }
    send(100, "appearance.read", {});
    expect(peer.dispatch).toHaveBeenCalledOnce();
    expect(peer.dispatch.mock.calls[0]![0].request.operation).toBe("appearance.read");
    const ready = await launch({ locator: "located" });
    const active = ready.supervisors[0];
    active.storageChanged({ generation: active.generation, state: "storage_ready" });
    for (let i = 0; i < 24; i++) await Promise.resolve();
    expect(await ready.action("read")).toMatchObject({ state: "storage_ready" });
    const readyEvent = ready.event();
    ready.ipcMain.emit(ready.constants.desktopChannels.session, readyEvent);
    const encoded = ready.constants.encodeEnvelope({
      ...readyEvent.returnValue,
      protocol: 1,
      policy: ready.constants.policyId,
      kind: "request",
      requestId: "ready-request",
      operationId: "ready-operation",
      operation,
      payload,
    });
    expect(encoded.ok).toBe(true);
    if (encoded.ok)
      ready.ipcMain.emit(ready.constants.desktopChannels.port, ready.event(), encoded.value);
    expect(active.dispatch).toHaveBeenCalledOnce();
  },
);

it.each(["installed", "qualification"] as const)(
  "does not declare a fake connection in %s mode even in development-built bytes",
  async (mode) => {
    const h = await launch({ mode, developmentBuild: true, instrumented: true });
    expect(h.failure).toBeUndefined();
    expect(Reflect.has(globalThis, "__ohtiaCredentialAcceptance")).toBe(false);
    h.supervisors[0].stateChanged("ready");
    expect(h.supervisors[0].reportConnections.mock.results.at(-1)?.value).toEqual([
      "chatgpt",
      "anthropic_api_key",
      "openai_api_key",
      "openrouter",
    ]);
    const event = h.event();
    h.ipcMain.emit(h.constants.desktopChannels.session, event);
    const encoded = h.constants.encodeEnvelope({
      protocol: 1,
      policy: h.constants.policyId,
      kind: "request",
      ...event.returnValue,
      requestId: "connection-read",
      operationId: "connection-read",
      operation: "connection.read",
      payload: { connection: "fake" },
    });
    if (!encoded.ok) throw new Error("Invalid test request");
    h.ipcMain.emit(h.constants.desktopChannels.port, event, encoded.value);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      JSON.parse(h.window.webContents.mainFrame.send.mock.calls.at(-1)[1]).payload,
    ).toMatchObject({ error: { code: "invalid_message" } });
    expect(h.supervisors[0].dispatch).not.toHaveBeenCalled();
  },
);

it("routes development connection calls and controls in main and reports every state to the service", async () => {
  const h = await launch({ mode: "development", developmentBuild: true, instrumented: true });
  expect(h.failure).toBeUndefined();
  expect(typeof Reflect.get(globalThis, "__ohtiaCredentialAcceptance")).toBe("function");
  h.supervisors[0].stateChanged("ready");
  expect(h.supervisors[0].reportConnections.mock.results.at(-1)?.value).toEqual([
    "chatgpt",
    "anthropic_api_key",
    "openai_api_key",
    "openrouter",
    "fake",
  ]);
  const event = h.event();
  h.ipcMain.emit(h.constants.desktopChannels.session, event);
  const send = (operation: string, payload: object, id: string) => {
    const encoded = h.constants.encodeEnvelope({
      protocol: 1,
      policy: h.constants.policyId,
      kind: "request",
      ...event.returnValue,
      requestId: id,
      operationId: id,
      operation,
      payload,
    });
    if (!encoded.ok) throw new Error("Invalid test request");
    h.ipcMain.emit(h.constants.desktopChannels.port, event, encoded.value);
  };
  send("connection.subscribe", { connection: "fake", subscriptionId: "conn-stream" }, "subscribe");
  const before = h.supervisors[0].reportConnections.mock.calls.length;
  send("connection.connect", { connection: "fake" }, "connect");
  const apiKeys = ["anthropic_api_key", "openai_api_key"];
  for (const connection of apiKeys)
    send(
      "connection.replaceKey",
      { connection, key: "synthetic-replacement" },
      "replace-" + connection,
    );
  await vi.advanceTimersByTimeAsync(0);
  expect(h.supervisors[0].reportConnections.mock.calls.length).toBeGreaterThan(before);
  const replies = h.window.webContents.mainFrame.send.mock.calls.map(([, text]: [string, string]) =>
    JSON.parse(text),
  );
  expect(replies).toContainEqual(
    expect.objectContaining({
      kind: "result",
      requestId: "connect",
      payload: expect.objectContaining({ value: expect.objectContaining({ state: "connecting" }) }),
    }),
  );
  expect(replies).toContainEqual(
    expect.objectContaining({
      kind: "event",
      topic: "connection",
      payload: expect.objectContaining({ state: "connected" }),
    }),
  );
  for (const connection of apiKeys)
    expect(replies).toContainEqual(
      expect.objectContaining({
        kind: "result",
        requestId: "replace-" + connection,
        payload: {
          ok: true,
          value: expect.objectContaining({ connection, state: "disconnected" }),
        },
      }),
    );
  const encoded = h.constants.encodeEnvelope({
    protocol: 1,
    policy: h.constants.policyId,
    kind: "unsubscribe",
    ...event.returnValue,
    subscriptionId: "conn-stream",
  });
  if (!encoded.ok) throw new Error("Invalid test control");
  h.ipcMain.emit(h.constants.desktopChannels.port, event, encoded.value);
  expect(h.supervisors[0].control).not.toHaveBeenCalled();
  expect(h.supervisors[0].dispatch).not.toHaveBeenCalled();
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
});

it("opens the local workspace while a native credential unlock is still pending", async () => {
  const h = await launch({ credentialReadPending: true });
  expect(h.failure).toBeUndefined();
  expect(h.window).toBeDefined();
  expect(h.window.webContents.mainFrame).toBeDefined();
});

it("hands development switches to the open development instance and runs them on its data service", async () => {
  const argv = process.argv;
  const switches = ["--ohtia-dev-command=request", "--ohtia-dev-model=first"];
  process.argv = [...argv, ...switches];
  const written: string[] = [];
  const fs = (await import("node:fs")).default;
  const write = vi.spyOn(fs, "writeSync").mockImplementation((_fd, text) => {
    written.push(String(text));
    return String(text).length;
  });
  try {
    const h = await launch({ mode: "development", developmentBuild: true, instrumented: true });
    expect(h.failure).toBeUndefined();
    expect(h.app.requestSingleInstanceLock).toHaveBeenCalledWith({
      development_switches: switches,
    });
    const supervisor = h.supervisors[0];
    expect(supervisor.connectProvider).toHaveBeenCalledOnce();
    supervisor.stateChanged("ready");
    await vi.advanceTimersByTimeAsync(0);
    expect(supervisor.postProvider).not.toHaveBeenCalled();
    supervisor.storageChanged({ generation: supervisor.generation, state: "storage_ready" });
    await vi.waitFor(() => {
      expect(supervisor.postProvider).toHaveBeenCalled();
    });
    const posted = JSON.parse(supervisor.postProvider.mock.calls[0][0] as string);
    expect(posted).toMatchObject({
      kind: "development_action",
      generation: supervisor.generation,
      action: { name: "request", model: "first" },
    });
    const channel = supervisor.connectProvider.mock.calls[0][0];
    channel.refreshModels({
      kind: "model_list_refresh",
      refresh_id: "refresh-1",
      version: 1,
      generation: supervisor.generation,
      connection: "chatgpt",
    });
    const reportedBeforeRefresh = supervisor.reportConnections.mock.calls.length;
    expect(reportedBeforeRefresh).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60_000);
    h.app.emit("will-quit");
    channel.report({
      kind: "development_report",
      version: 1,
      generation: supervisor.generation,
      operation_id: posted.action.operation_id,
      report: { type: "attempt", attempt: "development-1" },
    });
    expect(written.join("")).toContain("attempt development-1");
    const projectId = "019a8000-0000-7000-8000-000000000501";
    const conversationId = "019a8000-0000-7000-8000-000000000502";
    channel.report({
      kind: "development_report",
      version: 1,
      generation: supervisor.generation,
      operation_id: posted.action.operation_id,
      report: { type: "conversation_opened", projectId, conversationId },
    });
    expect(await h.action("read")).toMatchObject({
      openConversation: { projectId, conversationId },
      navigateConversation: { projectId, conversationId, revision: 1 },
    });
    expect(written.join("")).toContain(`opened conversation ${conversationId}`);
    await h.action("new_window");
    expect(await h.action("read", h.Window.all.at(-1))).not.toHaveProperty("openConversation");

    // A later launch's switches reach this instance without presenting its window.
    const focus = h.window.focus.mock.calls.length;
    h.app.emit("second-instance", {}, [], "", {
      development_switches: ["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=development-1"],
    });
    expect(JSON.parse(supervisor.postProvider.mock.calls.at(-1)[0] as string)).toMatchObject({
      action: { name: "interrupt", attempt: "development-1" },
    });
    expect(h.window.focus.mock.calls.length).toBe(focus);
    // Provider dispatches from the data service reach main's dispatcher and its guards.
    channel.dispatch({
      kind: "provider_dispatch",
      version: 1,
      generation: supervisor.generation,
      request: {
        attempt: "development-2",
        operation: "development_test",
        project: "019a8000-0000-7000-8000-000000000501",
        policy_version: 1,
        instruction_version: 1,
        document_language: null,
        tools: [],
        connection: "chatgpt",
        model: "first",
        instructions: "Synthetic.",
        input: [{ role: "user", text: "Synthetic." }],
        limits: { max_output_bytes: 1, max_attempt_duration_ms: 1, max_inactivity_ms: 1 },
      },
      permit: { id: "permit-2", attempt: "development-2", issued_at: 0 },
    });
    await vi.waitFor(() => {
      expect(
        supervisor.postProvider.mock.calls.some(([text]: [string]) =>
          text.includes('"permit_expired"'),
        ),
      ).toBe(true);
    });
    channel.interrupt({
      kind: "provider_interrupt",
      version: 1,
      generation: supervisor.generation,
      attempt: "development-2",
    });
  } finally {
    process.argv = argv;
    write.mockRestore();
  }
});

it("offers no development switches to the single-instance lock in the installed mode", async () => {
  const h = await launch({ mode: "installed" });
  expect(h.failure).toBeUndefined();
  expect(h.app.requestSingleInstanceLock).toHaveBeenCalledWith(undefined);
});

it("keeps a development command handed over while the instance is still starting", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const h = await launch({
    mode: "development",
    developmentBuild: true,
    instrumented: true,
    credentialGate: gate,
  });
  expect(h.failure).toBeUndefined();
  h.app.emit("second-instance", {}, [], "", {
    development_switches: ["--ohtia-dev-command=interrupt", "--ohtia-dev-attempt=development-9"],
  });
  open();
  await vi.dynamicImportSettled();
  await vi.waitFor(async () => {
    await vi.advanceTimersByTimeAsync(0);
    expect(h.supervisors[0]).toBeDefined();
  });
  h.supervisors[0].stateChanged("ready");
  expect(h.supervisors[0].postProvider).not.toHaveBeenCalled();
  h.supervisors[0].storageChanged({
    generation: h.supervisors[0].generation,
    state: "storage_ready",
  });
  await vi.waitFor(async () => {
    await vi.advanceTimersByTimeAsync(0);
    expect(
      h.supervisors[0].postProvider.mock.calls.map(([text]: [string]) => JSON.parse(text).action),
    ).toContainEqual(expect.objectContaining({ name: "interrupt", attempt: "development-9" }));
  });
});

it.each([
  ["win32", "session-end"],
  ["win32", "query-session-end"],
  ["darwin", "shutdown"],
  ["linux", "shutdown"],
  ["linux", "SIGTERM"],
] as const)(
  "bypasses exit confirmation for %s %s and passes non-orderly shutdown",
  async (platform, event) => {
    const h = await launch({ locator: "located", platform, exitRunning: 2 });
    const peer = h.supervisors[0];
    peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(await h.command("exit_state")).toMatchObject({ running: 2 });
    if (event === "SIGTERM") h.signalMain();
    else if (platform === "win32") h.window.emit(event);
    else h.powerMonitor.emit(event);
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(peer.stop).toHaveBeenCalledOnce();
    const orderly = peer.stop.mock.calls[0][1];
    expect(orderly()).toBe(false);
    expect(
      h.window.webContents.send.mock.calls
        .filter(([channel]: [string]) => channel === h.constants.desktopChannels.exitState)
        .at(-1)?.[1],
    ).toBeNull();
  },
);
it("uses the most recently focused window for a Dock quit even when no window has focus", async () => {
  const h = await launch({ locator: "located", platform: "darwin", exitRunning: 2 });
  const peer = h.supervisors[0];
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await h.action("new_window");
  const second = h.Window.all.at(-1)!;
  h.app.emit("browser-window-focus", {}, second);
  second.isFocused = () => false;
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(await h.command("exit_state", undefined, second)).toMatchObject({ running: 2 });
  expect(await h.command("exit_state", undefined, h.window)).toBeNull();
  expect(peer.stop).not.toHaveBeenCalled();
});

it("binds exit choices to the intercepted window and current main-owned operation", async () => {
  const h = await launch({ locator: "located", exitRunning: 2 });
  const peer = h.supervisors[0];
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  h.window.emit("close", { preventDefault: vi.fn() });
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const state = await h.command("exit_state");
  expect(await h.command("exit_choice", { operationId: "foreign", choice: "cancel" })).toBe(false);
  expect(
    await h.command("exit_choice", { operationId: state.operationId, choice: "invalid" }),
  ).toBe(false);
  expect(await h.command("exit_choice", { operationId: state.operationId, choice: "wait" })).toBe(
    true,
  );
  expect(await h.command("exit_state")).toMatchObject({ phase: "waiting" });
  expect(await h.command("exit_choice", { operationId: state.operationId, choice: "close" })).toBe(
    true,
  );
  expect(await h.command("exit_state")).toBeNull();
  expect(peer.stop).not.toHaveBeenCalled();
  expect(JSON.parse(peer.postProvider.mock.calls.at(-1)![0])).toMatchObject({ action: "resume" });
});

it("lets OS shutdown proceed without an error dialog when broker cessation cannot be confirmed", async () => {
  const h = await launch({ locator: "located", platform: "linux" });
  h.state.stop = false;
  h.powerMonitor.emit("shutdown");
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(h.app.exit).toHaveBeenCalledWith(0);
  expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
});

it("moves an open exit confirmation to a surviving window without losing its count", async () => {
  const h = await launch({ locator: "located", exitRunning: 2 });
  const peer = h.supervisors[0];
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await h.action("new_window");
  const second = h.Window.all.at(-1)!;
  h.app.emit("browser-window-focus", {}, second);
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(await h.command("exit_state", undefined, second)).toMatchObject({ running: 2 });
  second.destroyed = true;
  second.emit("closed");
  expect(await h.command("exit_state", undefined, h.window)).toMatchObject({ running: 2 });
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  expect(peer.stop).not.toHaveBeenCalled();
});

it("retargets an explicit repeated Quit to the most recently focused window", async () => {
  const h = await launch({ locator: "located", exitRunning: 2 });
  const peer = h.supervisors[0];
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await h.action("new_window");
  const second = h.Window.all.at(-1)!;
  h.app.emit("browser-window-focus", {}, h.window);
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(await h.command("exit_state", undefined, h.window)).toMatchObject({ running: 2 });
  h.app.emit("browser-window-focus", {}, second);
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  expect(await h.command("exit_state", undefined, second)).toMatchObject({ running: 2 });
  expect(await h.command("exit_state", undefined, h.window)).toBeNull();
  expect(h.window.webContents.send).toHaveBeenCalledWith(
    h.constants.desktopChannels.exitState,
    null,
  );
  expect(
    peer.postProvider.mock.calls.filter(
      ([text]: [string]) => JSON.parse(text).kind === "application_exit",
    ),
  ).toHaveLength(1);
});
it.each([false, true])(
  "keeps fatal resource shutdown mandatory with running replies and a pending exit %s",
  async (pending) => {
    const h = await launch({ locator: "located", exitRunning: 2 });
    const peer = h.supervisors[0];
    peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    h.window.emit("ready-to-show");
    if (pending) {
      h.app.emit("before-quit", { preventDefault: vi.fn() });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(await h.command("exit_state")).toMatchObject({ running: 2 });
    }
    const holds = peer.postProvider.mock.calls.length;
    h.state.metrics = h.constants.portLimits.process_tree_count + 1;
    await vi.advanceTimersByTimeAsync(500);
    expect(h.dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalled();
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(peer.postProvider.mock.calls).toHaveLength(holds);
  },
);
it("reports a failed exit handshake as an action failure without claiming unproven cessation", async () => {
  const h = await launch({ locator: "located", exitRunning: 2 });
  const peer = h.supervisors[0];
  peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  h.window.emit("ready-to-show");
  peer.postProvider.mockReturnValueOnce(false);
  h.app.emit("before-quit", { preventDefault: vi.fn() });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const locale = (await h.action("read")).locale;
  expect(h.dialog.showMessageBox).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ message: h.constants.message(locale, "command.failed") }),
  );
  expect(peer.stop).not.toHaveBeenCalled();
});

it("binds message-copy scope only to the latest service-admitted research subscription", async () => {
  const h = await launch({ locator: "located" });
  const service = h.supervisors[0];
  service.stateChanged("ready");
  service.storageChanged({ generation: service.generation, state: "storage_ready" });
  await vi.advanceTimersByTimeAsync(0);
  const projectId = "019a8000-0000-7000-8000-000000000501",
    conversationId = "019a8000-0000-7000-8000-000000000502";
  const subscribe = (
    requestId: string,
    scope: { projectId: string | null; conversationId: string | null },
  ) => {
    const event = { ...h.event(), returnValue: undefined as any };
    h.ipcMain.emit(h.constants.desktopChannels.session, event);
    const encoded = h.constants.encodeEnvelope({
      protocol: 1,
      policy: h.constants.policyId,
      kind: "request",
      operation: "research.subscribe",
      requestId,
      operationId: requestId,
      ...event.returnValue,
      payload: { ...scope, subscriptionId: requestId },
    });
    if (!encoded.ok) throw new Error("Invalid fixture");
    h.ipcMain.emit(h.constants.desktopChannels.port, event, encoded.value);
    return service.dispatch.mock.calls.at(-1)[0];
  };
  const request = (
    operation: "project.rename" | "project.read" | "profile.read" | "stage.transition",
    requestId: string,
    target: string,
    allowed = false,
    subscriptionId = "scope-1",
  ) => {
    const event = { ...h.event(), returnValue: undefined as any };
    h.ipcMain.emit(h.constants.desktopChannels.session, event);
    const envelope = h.constants.encodeEnvelope({
      protocol: 1,
      policy: h.constants.policyId,
      kind: "request",
      operation,
      requestId,
      operationId: requestId,
      ...event.returnValue,
      payload:
        operation === "project.read"
          ? { projectId: target }
          : operation === "profile.read"
            ? { projectId: target, subscriptionId, revisionId: null }
            : operation === "stage.transition"
              ? {
                  projectId: target,
                  subscriptionId,
                  stageId: "onboarding",
                  expectedRevision: 0,
                  decision: {
                    profileRevisionId: null,
                    reason: "Confirmed entry.",
                    artifacts: [],
                    remainingConditions: [],
                    transition: { kind: "enter" },
                  },
                }
              : { projectId: target, title: "Working title", expectedTitleRevision: 1 },
    });
    if (!envelope.ok) throw new Error("Invalid project fixture");
    const before = service.dispatch.mock.calls.length;
    h.ipcMain.emit(h.constants.desktopChannels.port, event, envelope.value);
    expect(service.dispatch).toHaveBeenCalledTimes(before + Number(allowed));
    if (allowed) {
      const accepted = service.dispatch.mock.calls.at(-1)[0];
      expect(accepted.request).toMatchObject({ operation, operationId: requestId });
      accepted.release();
      return;
    }
    const sent = h.window.webContents.mainFrame.send.mock.calls.at(-1)?.[1];
    expect(h.constants.decodeText(sent)).toMatchObject({
      ok: true,
      value: { requestId, payload: { ok: false, error: { code: "unauthorized" } } },
    });
  };
  const first = subscribe("scope-1", { projectId, conversationId });
  request("project.rename", "no-project", projectId);
  expect(await h.action("read")).not.toHaveProperty("openConversation");
  const reply = (accepted: any, ok = true) => {
    const envelope = h.constants.encodeEnvelope({
      ...accepted.request,
      kind: "result",
      payload: ok
        ? { ok: true, value: { subscriptionId: accepted.request.requestId } }
        : h.constants.failure("record_not_found"),
    });
    if (!envelope.ok) throw new Error("Invalid reply");
    accepted.deliver(envelope.value);
    accepted.release();
    accepted.releaseSubscription();
  };
  reply(first);
  request("profile.read", "on-first-selection", projectId, true);
  request("project.rename", "active-project", projectId, true);
  request("project.read", "wrong-project", conversationId);
  expect(await h.action("read")).toMatchObject({ openConversation: { projectId, conversationId } });
  const second = subscribe("scope-2", { projectId: null, conversationId: null });
  reply(second, false);
  expect(await h.action("read")).toHaveProperty("openConversation");
  const older = subscribe("scope-3", { projectId, conversationId });
  const latest = subscribe("scope-4", { projectId: null, conversationId: null });
  reply(latest);
  reply(older);
  request("project.rename", "old-project", projectId);
  expect(await h.action("read")).not.toHaveProperty("openConversation");
  const current = subscribe("scope-5", { projectId, conversationId: null });
  reply(current);
  request("profile.read", "stale-profile-selection", projectId);
  request("stage.transition", "stale-stage-selection", projectId);
  request("stage.transition", "current-stage-selection", projectId, true, "scope-5");
  request("stage.transition", "wrong-stage-project", conversationId, false, "scope-5");
  request("profile.read", "renewed-profile-selection", projectId, true, "scope-5");
  request("project.read", "project-only-scope", projectId, true);
  const unsubscribe = h.constants.encodeEnvelope({
    protocol: 1,
    policy: h.constants.policyId,
    kind: "unsubscribe",
    windowGeneration: current.request.windowGeneration,
    serviceGeneration: current.request.serviceGeneration,
    subscriptionId: current.request.payload.subscriptionId,
  });
  if (!unsubscribe.ok) throw new Error("Invalid unsubscribe fixture");
  h.ipcMain.emit(h.constants.desktopChannels.port, h.event(), unsubscribe.value);
  request("project.rename", "revoked-project", projectId);
  request("profile.read", "revoked-profile-selection", projectId, false, "scope-5");
  request("stage.transition", "revoked-stage-selection", projectId, false, "scope-5");
});

it("restores a project only in the application's first window and keeps new windows project-free", async () => {
  const h = await launch();
  expect((await h.action("read")).restoreLastProject).toBe(true);
  await h.action("new_window");
  const second = h.Window.all.at(-1)!;
  expect(second).not.toBe(h.window);
  const snapshot = await h.action("read", second);
  expect(snapshot.restoreLastProject).toBe(false);
  expect(snapshot.openConversation).toBeUndefined();
  expect((await h.action("read")).restoreLastProject).toBe(true);
  const pending = h.action("new_window");
  h.window.emit("closed");
  expect((await pending).restoreLastProject).toBeUndefined();
  expect((await h.action("read", h.Window.all.at(-1)!)).restoreLastProject).toBe(false);
});

it.each(["development", "installed"] as const)(
  "automatically admits a configured store on %s startup before restoring the first project",
  async (mode) => {
    const h = await launch({
      mode,
      developmentBuild: mode === "development",
      locator: "located",
      instrumented: mode === "installed",
    });
    expect(h.utilityProcess.fork.mock.calls[0][1][3]).toBe("open");
    expect(await h.action("read")).toMatchObject({
      state: "storage_opening",
      restoreLastProject: true,
    });
    const current = h.supervisors[0];
    current.stateChanged("ready");
    current.storageChanged({ generation: current.generation, state: "storage_ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await h.action("read")).toMatchObject({
      state: "storage_ready",
      restoreLastProject: true,
      serviceGeneration: current.generation,
    });
    const observe = Reflect.get(globalThis, "__ohtiaBootstrapPlacement");
    if (mode === "installed")
      expect(observe(h.window)).toEqual({
        bounds: h.window.setBounds.mock.calls[0][0],
        maximized: false,
      });
    else expect(observe).toBeUndefined();
    expect(h.utilityProcess.fork).toHaveBeenCalledOnce();
    await h.action("new_window");
    expect(await h.action("read", h.Window.all.at(-1))).toMatchObject({
      state: "storage_ready",
      restoreLastProject: false,
    });
  },
);
it("keeps missing and rejected ordinary locators and qualification admission behind their existing explicit controls", async () => {
  for (const [mode, locator] of [
    ["installed", "missing"],
    ["development", "missing"],
    ["installed", "path_rejected"],
    ["installed", "locator_invalid"],
    ["qualification", "located"],
  ] as const) {
    const h = await launch({ mode, locator });
    expect(h.utilityProcess.fork.mock.calls[0][1][3]).toBe("blocked");
    expect((await h.action("read")).state).not.toBe("storage_opening");
    cleanups.splice(0).forEach((cleanup) => cleanup());
  }
});
it("preserves migration recovery gates when automatic configured-store admission fails", async () => {
  const h = await launch({ mode: "installed", locator: "located" });
  const current = h.supervisors[0];
  current.stateChanged("ready");
  current.storageChanged({ generation: current.generation, state: "recovery_required" });
  expect((await h.action("read")).state).toBe("recovery_required");
  await h.action("open_storage");
  expect(h.utilityProcess.fork).toHaveBeenCalledOnce();
  await h.action("retry_service");
  expect(h.utilityProcess.fork.mock.calls[1][1][3]).toBe("retry");
});

describe("manuscript close guard", () => {
  const closeSends = (
    window: { webContents: { send: ReturnType<typeof vi.fn> } },
    channel: string,
  ) =>
    window.webContents.send.mock.calls
      .filter(([sent]) => sent === channel)
      .map(([, value]) => value);

  it("records boolean manuscript pending reports for the sender and holds its close until cleared", async () => {
    const h = await launch();
    const channel = h.constants.desktopChannels.manuscriptClose;
    expect(await h.command("manuscript_pending", "true")).toBe(false);
    const ignored = { preventDefault: vi.fn() };
    h.window.emit("close", ignored);
    expect(closeSends(h.window, channel)).toEqual([]);
    expect(h.app.quit).toHaveBeenCalledOnce();
    h.app.quit.mockClear();
    expect(await h.command("manuscript_pending", true)).toBe(true);
    const held = { preventDefault: vi.fn() };
    h.window.emit("close", held);
    expect(held.preventDefault).toHaveBeenCalledOnce();
    expect(closeSends(h.window, channel)).toEqual(["window.close"]);
    expect(h.app.quit).not.toHaveBeenCalled();
    expect(await h.command("manuscript_pending", false)).toBe(true);
    h.window.emit("close", { preventDefault: vi.fn() });
    expect(closeSends(h.window, channel)).toEqual(["window.close"]);
    expect(h.app.quit).toHaveBeenCalledOnce();
  });

  it.each(["linux", "win32"] as const)(
    "lets a %s operating-system shutdown close a window with pending manuscript text",
    async (platform) => {
      const h = await launch({ platform });
      const channel = h.constants.desktopChannels.manuscriptClose;
      expect(await h.command("manuscript_pending", true)).toBe(true);
      if (platform === "win32") h.window.emit("session-end");
      else h.powerMonitor.emit("shutdown");
      h.app.quit.mockClear();
      h.window.emit("close", { preventDefault: vi.fn() });
      expect(closeSends(h.window, channel)).toEqual([]);
      expect(h.app.quit).toHaveBeenCalledOnce();
      const unload = { preventDefault: vi.fn() };
      h.window.webContents.emit("will-prevent-unload", unload);
      expect(unload.preventDefault).toHaveBeenCalledOnce();
      expect(closeSends(h.window, channel)).toEqual([]);
    },
  );

  it("forgets pending manuscript text when the renderer process is gone", async () => {
    const h = await launch();
    expect(await h.command("manuscript_pending", true)).toBe(true);
    h.window.webContents.emit("render-process-gone");
    h.window.emit("close", { preventDefault: vi.fn() });
    expect(closeSends(h.window, h.constants.desktopChannels.manuscriptClose)).toEqual([]);
    expect(h.app.quit).toHaveBeenCalledOnce();
  });

  it("asks the renderer about a cancelled unload and holds the next close as pending", async () => {
    const h = await launch();
    const channel = h.constants.desktopChannels.manuscriptClose;
    const unload = { preventDefault: vi.fn() };
    h.window.webContents.emit("will-prevent-unload", unload);
    expect(unload.preventDefault).not.toHaveBeenCalled();
    expect(closeSends(h.window, channel)).toEqual(["window.close"]);
    const held = { preventDefault: vi.fn() };
    h.window.emit("close", held);
    expect(held.preventDefault).toHaveBeenCalledOnce();
    expect(closeSends(h.window, channel)).toEqual(["window.close", "window.close"]);
    expect(h.app.quit).not.toHaveBeenCalled();
  });

  it("routes a quit to the window with pending manuscript text and runs the exit flow once cleared", async () => {
    const h = await launch();
    const channel = h.constants.desktopChannels.manuscriptClose;
    const supervisor = h.supervisors[0];
    h.window.emit("ready-to-show");
    await h.action("new_window");
    const second = h.Window.all[1]!;
    second.emit("ready-to-show");
    second.focus.mockClear();
    second.minimized = true;
    expect(await h.command("manuscript_pending", true, second)).toBe(true);
    const quit = { preventDefault: vi.fn() };
    h.app.emit("before-quit", quit);
    expect(quit.preventDefault).toHaveBeenCalledOnce();
    expect(closeSends(second, channel)).toEqual(["application.quit"]);
    expect(closeSends(h.window, channel)).toEqual([]);
    expect(second.restore).toHaveBeenCalledOnce();
    expect(second.focus).toHaveBeenCalledOnce();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(supervisor.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_pending", false, second)).toBe(true);
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(closeSends(second, channel)).toEqual(["application.quit"]);
    expect(supervisor.stop).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalled();
    const unload = { preventDefault: vi.fn() };
    h.window.webContents.emit("will-prevent-unload", unload);
    expect(unload.preventDefault).toHaveBeenCalledOnce();
    expect(closeSends(h.window, channel)).toEqual([]);
  });

  it("skips the pending manuscript quit prompt during operating-system shutdown", async () => {
    const h = await launch({ platform: "linux" });
    const channel = h.constants.desktopChannels.manuscriptClose;
    expect(await h.command("manuscript_pending", true)).toBe(true);
    h.powerMonitor.emit("shutdown");
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(closeSends(h.window, channel)).toEqual([]);
    expect(h.supervisors[0].stop).toHaveBeenCalledOnce();
  });

  it("ignores pending manuscript text in a destroyed window when quitting", async () => {
    const h = await launch();
    await h.action("new_window");
    const second = h.Window.all[1]!;
    expect(await h.command("manuscript_pending", true, second)).toBe(true);
    second.destroyed = true;
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(closeSends(second, h.constants.desktopChannels.manuscriptClose)).toEqual([]);
    expect(h.supervisors[0].stop).toHaveBeenCalledOnce();
  });
});

describe("manuscript lock before an ordinary quit", () => {
  const sends = (window: { webContents: { send: ReturnType<typeof vi.fn> } }, channel: string) =>
    window.webContents.send.mock.calls
      .filter(([sent]) => sent === channel)
      .map(([, value]) => value);
  async function workspace(windows = 1, platform?: NodeJS.Platform) {
    const h = await launch({ locator: "located", manualManuscriptLock: true, platform });
    const peer = h.supervisors[0]!;
    peer.storageChanged({ generation: peer.generation, state: "storage_ready" });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    for (let i = 1; i < windows; i++) await h.action("new_window");
    const all = h.Window.all.slice(0, windows);
    for (const window of all) {
      window.emit("ready-to-show");
      // A window joins the lock once its document has attached its session.
      h.ipcMain.emit(h.constants.desktopChannels.session, h.event(window));
    }
    const lock = h.constants.desktopChannels.manuscriptLock;
    const close = h.constants.desktopChannels.manuscriptClose;
    const requests = (window: (typeof all)[number]) =>
      sends(window, lock) as { locked: boolean; id?: string }[];
    const lockId = (window: (typeof all)[number]) => requests(window).at(-1)?.id;
    const quit = async () => {
      h.app.emit("before-quit", { preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(0);
      h.app.quit.mockClear();
    };
    return { h, peer, all, lock, close, requests, lockId, quit };
  }

  it("locks every workspace window and stops services only after all of them confirm", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(2);
    await quit();
    const id = lockId(all[0]!);
    expect(id).toEqual(expect.any(String));
    for (const window of all) expect(requests(window)).toEqual([{ locked: true, id }]);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(h.app.quit).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: false }, all[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: false }, all[1])).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalledOnce();
    for (const window of all) expect(requests(window)).toEqual([{ locked: true, id }]);
  });

  it("holds the quit at a window that still has manuscript text and releases every window", async () => {
    const { h, peer, all, close, requests, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    await quit();
    const id = lockId(first)!;
    first.focus.mockClear();
    first.minimized = true;
    expect(await h.command("manuscript_locked", { id, pending: true }, first)).toBe(true);
    expect(await h.command("manuscript_locked", { id, pending: false }, second)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(h.app.quit).not.toHaveBeenCalled();
    for (const window of all)
      expect(requests(window)).toEqual([{ locked: true, id }, { locked: false }]);
    expect(sends(first, close)).toEqual(["application.quit"]);
    expect(sends(second, close)).toEqual([]);
    expect(first.restore).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    const held = { preventDefault: vi.fn() };
    first.emit("close", held);
    expect(held.preventDefault).toHaveBeenCalledOnce();
    expect(sends(first, close)).toEqual(["application.quit", "window.close"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(peer.stop).not.toHaveBeenCalled();
  });

  it("holds the quit at a window that does not answer the lock in time without marking it pending", async () => {
    const { h, peer, all, close, requests, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    await quit();
    const id = lockId(first)!;
    second.focus.mockClear();
    expect(await h.command("manuscript_locked", { id, pending: false }, first)).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(requests(second)).toEqual([{ locked: true, id }]);
    expect(peer.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(h.app.quit).not.toHaveBeenCalled();
    for (const window of all)
      expect(requests(window)).toEqual([{ locked: true, id }, { locked: false }]);
    expect(sends(second, close)).toEqual(["application.quit"]);
    expect(sends(first, close)).toEqual([]);
    expect(second.focus).toHaveBeenCalledOnce();
    expect(await h.command("manuscript_locked", { id, pending: false }, second)).toBe(false);
    second.emit("close", { preventDefault: vi.fn() });
    expect(sends(second, close)).toEqual(["application.quit"]);
  });

  it("refuses lock replies before a round, with a foreign id or malformed payload or as duplicates, and opens no window during the lock", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    expect(await h.command("manuscript_locked", { id: "early", pending: false })).toBe(false);
    await quit();
    const id = lockId(first)!;
    for (const payload of [
      { id: "foreign-round", pending: true },
      { id, pending: "true" },
      { id, pending: false, extra: true },
      { id },
      { pending: false },
      { id: "-invalid", pending: false },
      [id, false],
      id,
      null,
      undefined,
    ])
      expect(await h.command("manuscript_locked", payload, first)).toBe(false);
    // No window opens while the lock decides the quit, so none can escape it.
    const windowsBefore = h.Window.all.length;
    await h.action("new_window");
    expect(h.Window.all).toHaveLength(windowsBefore);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: false }, first)).toBe(true);
    expect(await h.command("manuscript_locked", { id, pending: true }, first)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: false }, second)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    for (const window of all) expect(requests(window)).toEqual([{ locked: true, id }]);
  });

  it("stops waiting for a window that closes during the lock", async () => {
    const { h, peer, all, close, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    await quit();
    const id = lockId(first)!;
    expect(await h.command("manuscript_locked", { id, pending: false }, first)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    second.destroyed = true;
    second.emit("closed");
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalledOnce();
    expect(sends(second, close)).toEqual([]);
  });

  it("does not start a second lock for a repeated quit while one is running", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(2);
    await quit();
    const id = lockId(all[0]!)!;
    await quit();
    for (const window of all) expect(requests(window)).toEqual([{ locked: true, id }]);
    for (const window of all)
      expect(await h.command("manuscript_locked", { id, pending: false }, window)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
  });

  it("neither locks nor waits for manuscripts during operating-system shutdown", async () => {
    const { h, peer, all, requests } = await workspace(2, "linux");
    h.powerMonitor.emit("shutdown");
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    for (const window of all) expect(requests(window)).toEqual([]);
    expect(peer.stop).toHaveBeenCalledOnce();
  });

  it("ends a running lock without presenting anything when operating-system shutdown begins", async () => {
    const { h, peer, all, close, requests, lockId, quit } = await workspace(2, "linux");
    await quit();
    const id = lockId(all[0]!)!;
    expect(await h.command("manuscript_locked", { id, pending: true }, all[0])).toBe(true);
    h.powerMonitor.emit("shutdown");
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(peer.stop).toHaveBeenCalledOnce();
    for (const window of all) {
      expect(requests(window)).toEqual([{ locked: true, id }]);
      expect(sends(window, close)).toEqual([]);
    }
  });

  it("ends a lock without stopping services and releases the editor when shutdown begins before the timeout", async () => {
    const { h, peer, all, close, requests, lockId, quit } = await workspace(1, "linux");
    await quit();
    const id = lockId(all[0]!)!;
    h.powerMonitor.emit("shutdown");
    await vi.advanceTimersByTimeAsync(2000);
    expect(peer.stop).not.toHaveBeenCalled();
    // A cancelled session end must not leave the manuscript locked.
    expect(requests(all[0]!)).toEqual([{ locked: true, id }, { locked: false }]);
    expect(sends(all[0]!, close)).toEqual([]);
  });

  it.each(["stop-failed", "changed-sentinel"])(
    "releases every manuscript lock after a %s shutdown",
    async (outcome) => {
      const { h, peer, all, requests, lockId, quit } = await workspace(2);
      h.state.stop = outcome !== "stop-failed";
      h.state.verify = outcome !== "changed-sentinel";
      await quit();
      const id = lockId(all[0]!)!;
      for (const window of all)
        expect(await h.command("manuscript_locked", { id, pending: false }, window)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.stop).toHaveBeenCalledOnce();
      expect(h.app.quit).not.toHaveBeenCalled();
      expect(h.dialog.showMessageBox).toHaveBeenCalled();
      for (const window of all)
        expect(requests(window)).toEqual([{ locked: true, id }, { locked: false }]);
    },
  );

  const exitControls = (peer: { postProvider: ReturnType<typeof vi.fn> }) =>
    peer.postProvider.mock.calls
      .map(([text]) => JSON.parse(text as string) as { kind: string; action?: string })
      .filter((control) => control.kind === "application_exit");

  it.each(["pending text", "a missing reply"])(
    "lets the service dispatch work again when %s holds the approved quit",
    async (cause) => {
      const { h, peer, all, lockId, quit } = await workspace(1);
      await quit();
      const [hold] = exitControls(peer);
      expect(hold).toMatchObject({ action: "hold", generation: peer.generation });
      const id = lockId(all[0]!)!;
      if (cause === "pending text")
        expect(await h.command("manuscript_locked", { id, pending: true }, all[0])).toBe(true);
      else await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.stop).not.toHaveBeenCalled();
      expect(exitControls(peer)).toEqual([hold, { ...hold, action: "resume" }]);
    },
  );

  it("sends no resume when every window confirms the lock", async () => {
    const { h, peer, all, lockId, quit } = await workspace(1);
    await quit();
    const id = lockId(all[0]!)!;
    expect(await h.command("manuscript_locked", { id, pending: false }, all[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(exitControls(peer).map((control) => control.action)).toEqual(["hold"]);
  });

  it("does not build a window whose preference read finishes during the lock", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(1);
    const original = peer.request.getMockImplementation()!;
    let finishAppearance!: () => void;
    peer.request.mockImplementation(async (operation: string, ...rest: unknown[]) =>
      operation === "appearance.read"
        ? new Promise((resolve) => {
            finishAppearance = () => {
              resolve(original(operation, ...(rest as [])));
            };
          })
        : original(operation, ...(rest as [])),
    );
    const opening = h.action("new_window");
    for (let i = 0; i < 16; i++) await Promise.resolve();
    expect(finishAppearance).toBeTypeOf("function");
    await quit();
    const id = lockId(all[0]!)!;
    finishAppearance();
    expect(await opening).toMatchObject({ notice: "resource_failure" });
    expect(h.Window.all).toHaveLength(1);
    expect(requests(all[0]!)).toEqual([{ locked: true, id }]);
    expect(await h.command("manuscript_locked", { id, pending: false }, all[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalledOnce();
  });

  it("neither locks nor waits for a window whose document never attached", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(1);
    await h.action("new_window");
    const detached = h.Window.all[1]!;
    detached.emit("ready-to-show");
    await quit();
    const id = lockId(all[0]!)!;
    expect(requests(detached)).toEqual([]);
    expect(await h.command("manuscript_locked", { id, pending: false }, detached)).toBe(false);
    expect(await h.command("manuscript_locked", { id, pending: false }, all[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(h.app.quit).toHaveBeenCalledOnce();
  });

  it("locks the new document of a window that navigates and attaches again during the lock", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    await quit();
    const id = lockId(first)!;
    second.webContents.emit("did-start-navigation", {}, h.constants.desktopDocument, false, true);
    h.ipcMain.emit(h.constants.desktopChannels.session, h.event(second));
    expect(requests(second)).toEqual([
      { locked: true, id },
      { locked: true, id },
    ]);
    expect(await h.command("manuscript_locked", { id, pending: false }, first)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: false }, second)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
  });

  it("locks and awaits a window whose document attaches during the lock", async () => {
    const { h, peer, all, close, requests, lockId, quit } = await workspace(1);
    await h.action("new_window");
    const late = h.Window.all[1]!;
    late.emit("ready-to-show");
    await quit();
    const id = lockId(all[0]!)!;
    expect(requests(late)).toEqual([]);
    h.ipcMain.emit(h.constants.desktopChannels.session, h.event(late));
    expect(requests(late)).toEqual([{ locked: true, id }]);
    // A repeated attachment does not lock it twice.
    h.ipcMain.emit(h.constants.desktopChannels.session, h.event(late));
    expect(requests(late)).toEqual([{ locked: true, id }]);
    expect(await h.command("manuscript_locked", { id, pending: false }, all[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: true }, late)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(sends(late, close)).toEqual(["application.quit"]);
  });

  it.each([
    ["crashes", (contents: EventEmitter) => contents.emit("render-process-gone")],
    [
      "navigates its main frame away",
      (contents: EventEmitter) =>
        contents.emit("did-start-navigation", {}, "https://example.invalid/", false, true),
    ],
  ] as const)(
    "stops waiting for a window whose renderer %s during the lock",
    async (_name, lose) => {
      const { h, peer, all, close, lockId, quit } = await workspace(2);
      const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
      await quit();
      const id = lockId(first)!;
      expect(await h.command("manuscript_locked", { id, pending: false }, first)).toBe(true);
      // A subframe or in-place navigation keeps the document, so the lock still waits.
      second.webContents.emit("did-start-navigation", {}, h.constants.desktopDocument, true, true);
      second.webContents.emit("did-start-navigation", {}, "https://example.invalid/", false, false);
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.stop).not.toHaveBeenCalled();
      lose(second.webContents);
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.stop).toHaveBeenCalledOnce();
      expect(h.app.quit).toHaveBeenCalledOnce();
      expect(sends(second, close)).toEqual([]);
    },
  );

  it("does not hold the quit for a pending reply from a renderer that crashed during the lock", async () => {
    const { h, peer, all, close, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    await quit();
    const id = lockId(first)!;
    expect(await h.command("manuscript_locked", { id, pending: true }, first)).toBe(true);
    first.webContents.emit("render-process-gone");
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).not.toHaveBeenCalled();
    expect(await h.command("manuscript_locked", { id, pending: false }, second)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    expect(sends(first, close)).toEqual([]);
  });

  it("locks every editor again on a second quit after a failed stop", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(2);
    h.state.stop = false;
    await quit();
    const first = lockId(all[0]!)!;
    for (const window of all)
      expect(await h.command("manuscript_locked", { id: first, pending: false }, window)).toBe(
        true,
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
    // The failed stop detached every document; the next quit still locks them all.
    h.state.stop = true;
    await quit();
    const second = lockId(all[0]!)!;
    expect(second).not.toBe(first);
    for (const window of all)
      expect(requests(window)).toEqual([
        { locked: true, id: first },
        { locked: false },
        { locked: true, id: second },
      ]);
    expect(peer.stop).toHaveBeenCalledOnce();
  });

  it("does not lock a window whose renderer crashed before the quit", async () => {
    const { h, peer, all, requests, lockId, quit } = await workspace(2);
    const [first, second] = all as [(typeof all)[0], (typeof all)[0]];
    second.webContents.emit("render-process-gone");
    await quit();
    const id = lockId(first)!;
    expect(requests(second)).toEqual([]);
    expect(await h.command("manuscript_locked", { id, pending: false }, first)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.stop).toHaveBeenCalledOnce();
  });
});
