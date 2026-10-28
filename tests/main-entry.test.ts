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
  vi.doUnmock("electron");
  vi.doUnmock("node:fs");
  vi.doUnmock("../packages/main/src/profile.js");
  vi.doUnmock("../packages/main/src/locator.js");
  vi.doUnmock("../packages/main/src/service-supervisor.js");
  vi.doUnmock("../packages/main/src/diagnostic-writer.js");
});
async function launch(
  options: {
    locator?: string;
    ownsBroker?: boolean;
    admission?: boolean;
    asset?: string;
    ready?: boolean;
    loadFailure?: boolean;
  } = {},
) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("NODE_OPTIONS", "");
  vi.stubEnv("OHTIA_RUNTIME_ACCEPTANCE", "0");
  const constants = await import("../packages/contracts/src/index.js");
  const nativeFs = await import("node:fs");
  const profile = {
    home: "/synthetic/home",
    configuration_root: "/synthetic/home/.config",
    research_root: "/synthetic/home/ohtia",
    scratch_root: "/synthetic/home/scratch",
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
    enableSandbox: vi.fn(),
    getVersion: () => "0.0.0-test",
    getPreferredSystemLanguages: () => ["es-CL", "en-GB"],
    getPath: (key: string) =>
      key === "home"
        ? profile.home
        : key === "appData"
          ? profile.configuration_root
          : path.join(profile.configuration_root, "Ohtia"),
    exit: vi.fn(),
    quit: vi.fn(),
    isReady: () => state.ready,
    whenReady: () => (state.ready ? Promise.resolve() : new Promise<void>(() => {})),
    getAppMetrics: () => Array.from({ length: state.metrics }, () => ({})),
    requestSingleInstanceLock: () => options.ownsBroker !== false,
  });
  let nextId = 0;
  class Window extends EventEmitter {
    static all: Window[] = [];
    static getAllWindows() {
      return Window.all.filter((window) => !window.destroyed);
    }
    static fromWebContents(contents: unknown) {
      return Window.all.find((window) => window.webContents === contents);
    }
    destroyed = false;
    minimized = false;
    visible = true;
    webContents = Object.assign(new EventEmitter(), {
      id: ++nextId,
      mainFrame: { url: constants.desktopDocument, send: vi.fn() },
      send: vi.fn(),
      stop: vi.fn(),
      isDestroyed: () => this.destroyed,
      setWindowOpenHandler: vi.fn(),
    });
    removeMenu = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    isVisible() {
      return this.visible;
    }
    loadURL = vi.fn(async () => {
      if (options.loadFailure) throw new Error("Synthetic load failure");
    });
    constructor(readonly settings: unknown) {
      super();
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
  const dialog = { showErrorBox: vi.fn(), showMessageBox: vi.fn(async () => ({})) };
  const protocol = { registerSchemesAsPrivileged: vi.fn() };
  const children: ReturnType<typeof child>[] = [];
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
    control = vi.fn();
    disposeWindow = vi.fn();
    activateStorage = vi.fn(() => true);
    stop = vi.fn(async () => {
      this.ceased = state.stop;
      return state.stop;
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
  vi.doMock("electron", () => ({
    app,
    BrowserWindow: Window,
    ipcMain,
    session,
    dialog,
    protocol,
    utilityProcess,
    Menu: { setApplicationMenu: vi.fn() },
  }));
  vi.doMock("../packages/main/src/profile.js", () => ({
    loadRuntimeProfile: () => {
      if (!state.admission) throw new Error("Synthetic admission failure");
      return profile;
    },
    canonicalProspective: (value: string) => value,
    admitRuntimeSwitches: vi.fn(),
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
  const readFileSync = (file: unknown, ...args: unknown[]) => {
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
      reservedPermissionProcesses = 0;
      append = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    },
  }));
  const stdout = process.stdout.write,
    stderr = process.stderr.write;
  const listeners = new Map(
    ["uncaughtException", "unhandledRejection"].map((name) => [name, process.listeners(name)]),
  );
  let failure: unknown;
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
    cleanups.push(() => {
      for (const { name, listener } of added) process.removeListener(name, listener);
    });
  }
  await vi.advanceTimersByTimeAsync(0);
  cleanups.push(() => {
    vi.clearAllTimers();
  });
  const window = Window.all[0];
  const event = (selected = window) => ({
    sender: selected?.webContents,
    senderFrame: selected?.webContents.mainFrame,
  });
  const bootstrap = ipcMain.handle.mock.calls[0]?.[1];
  const action = async (value: string, selected = window) => bootstrap(event(selected), value);
  return {
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
    supervisors,
    publish,
    failure,
    event,
    action,
    recoverService,
  };
}

describe("broker composition with synthetic Electron adapters", () => {
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
    h.supervisors[0].storageChanged({
      generation: h.supervisors[0].generation,
      state: "recovery_required",
    });
    await h.action("open_storage");
    expect(h.utilityProcess.fork).toHaveBeenCalledOnce();
    await h.action("restore_checkpoint");
    expect(h.utilityProcess.fork.mock.calls[1][1][3]).toBe("restore");
    await h.action("retry_service");
    expect(h.utilityProcess.fork).toHaveBeenCalledTimes(2);
    const current = h.supervisors.at(-1)!;
    current.storageChanged({ generation: current.generation, state: "retry_required" });
    await h.action("retry_service");
    expect(h.utilityProcess.fork.mock.calls[2][1][3]).toBe("retry");
  });
  it("keeps invalid locator phases closed while allowing later repair", async () => {
    const h = await launch({ locator: "locator_invalid" });
    expect((await h.action("read")).state).toBe("locator_invalid");
    await h.action("restore_checkpoint");
    expect(h.utilityProcess.fork).toHaveBeenCalledOnce();
    h.state.locator = "located";
    await h.action("retry_service");
    expect(h.utilityProcess.fork.mock.calls[1][1][3]).toBe("blocked");
    const current = h.supervisors.at(-1)!;
    h.state.locator = "path_rejected";
    current.storageChanged({ generation: current.generation, state: "storage_ready" });
    expect((await h.action("read")).state).toBe("path_rejected");
  });
  it("limits windows, restores a minimized existing window and reports missing-window errors", async () => {
    const h = await launch();
    h.window.minimized = true;
    h.app.emit("second-instance");
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
    expect(h.dialog.showErrorBox).toHaveBeenCalled();
    h.app.emit("window-all-closed");
    expect(h.app.quit).toHaveBeenCalled();
  });
  it.each(["stop-failed", "changed-sentinel", "clean"])(
    "handles %s shutdown without losing the live broker",
    async (outcome) => {
      const h = await launch();
      await h.action("read");
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
