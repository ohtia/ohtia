import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopChannels, type DesktopBridge } from "../packages/contracts/src/index.js";

const descriptors = new Map<string, PropertyDescriptor | undefined>();
function flag(key: string, value: boolean) {
  if (!descriptors.has(key)) descriptors.set(key, Object.getOwnPropertyDescriptor(process, key));
  Object.defineProperty(process, key, { configurable: true, value });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(process, key, descriptor);
    else Reflect.deleteProperty(process, key);
  }
  descriptors.clear();
  vi.doUnmock("electron");
});
async function load(
  session: unknown = { serviceGeneration: "service-1", windowGeneration: "window-1" },
) {
  vi.resetModules();
  vi.useFakeTimers();
  flag("contextIsolated", true);
  flag("sandboxed", true);
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  const ipcRenderer = Object.assign(new EventEmitter(), {
    sendSync: vi.fn(() => session),
    send: vi.fn(),
    invoke: vi.fn(async () => ({ version: 1, locale: "en-US", state: "pending_create" })),
  });
  const contextBridge = { exposeInMainWorld: vi.fn() };
  vi.doMock("electron", () => ({ ipcRenderer, contextBridge }));
  let error: unknown;
  try {
    await import("../packages/preload/src/entry.js");
  } catch (caught) {
    error = caught;
  }
  return {
    ipcRenderer,
    contextBridge,
    window,
    error,
    bridge: contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DesktopBridge,
  };
}
describe("sandbox preload composition", () => {
  it.each([
    null,
    "not-a-session",
    {},
    { serviceGeneration: "service-1", windowGeneration: "window-1", extra: true },
    { serviceGeneration: "bad space", windowGeneration: "window-1" },
    { serviceGeneration: "service-1", windowGeneration: false },
  ])("rejects malformed session authority %j before exposure", async (session) => {
    const h = await load(session);
    expect(h.error).toBeInstanceOf(Error);
    expect(h.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
  });
  it("exposes only named operations, forwards them on fixed channels and validates bootstrap snapshots", async () => {
    const h = await load();
    expect(h.error).toBeUndefined();
    expect(h.contextBridge.exposeInMainWorld).toHaveBeenCalledWith("ohtia", h.bridge);
    for (const [method, action] of [
      ["read", "read"],
      ["retryService", "retry_service"],
      ["newWindow", "new_window"],
      ["exit", "exit"],
      ["restoreCheckpoint", "restore_checkpoint"],
      ["openStorage", "open_storage"],
    ] as const) {
      expect(await h.bridge.bootstrap[method]()).toMatchObject({ state: "pending_create" });
      expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(desktopChannels.bootstrap, action);
    }
    h.ipcRenderer.invoke.mockResolvedValueOnce({ injected: true } as never);
    await expect(h.bridge.bootstrap.read()).rejects.toThrow(/bootstrap response/);
    const calls = [
      h.bridge.foundation.readStatus(),
      h.bridge.foundation.readAppearance(),
      h.bridge.foundation.readAppearanceReceipt("operation-1"),
      h.bridge.foundation.replaceAppearance({
        operationId: "operation-2",
        expectedRevision: 0,
        value: "dark",
      }),
    ];
    expect(
      h.ipcRenderer.send.mock.calls.slice(0, 4).map(([, text]) => JSON.parse(text).operation),
    ).toEqual(["status.read", "appearance.read", "appearance.receipt", "appearance.replace"]);
    const subscription = h.bridge.foundation.subscribeStatus(() => {});
    const appearance = h.bridge.foundation.subscribeAppearance(() => {});
    calls[0].cancel();
    expect(await calls[0].result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    subscription.dispose();
    appearance.dispose();
    await subscription.ready;
    await appearance.ready;
    h.ipcRenderer.emit(desktopChannels.ended, {}, "other-generation");
    h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
    expect(await calls[1].result).toMatchObject({ ok: false, error: { code: "disposed" } });
    expect(await calls[3].result).toMatchObject({ ok: false, error: { code: "uncertain" } });
    h.ipcRenderer.sendSync.mockReturnValue({
      serviceGeneration: "service-2",
      windowGeneration: "window-2",
    });
    h.ipcRenderer.emit(desktopChannels.reconnect);
    const fresh = h.bridge.foundation.readStatus();
    expect(JSON.parse(h.ipcRenderer.send.mock.calls.at(-1)![1]).serviceGeneration).toBe(
      "service-2",
    );
    h.window.dispatchEvent(new Event("unload"));
    expect(await fresh.result).toMatchObject({ ok: false, error: { code: "disposed" } });
    expect(h.ipcRenderer.listenerCount(desktopChannels.ended)).toBe(0);
    expect(h.ipcRenderer.listenerCount(desktopChannels.reconnect)).toBe(0);
    expect(h.ipcRenderer.listenerCount(desktopChannels.reply)).toBe(0);
  });
  it("times out a live request and removes the transport listener at unload", async () => {
    const h = await load();
    const call = h.bridge.foundation.readStatus();
    await vi.runAllTimersAsync();
    expect((await call.result).ok).toBe(false);
    h.window.dispatchEvent(new Event("unload"));
    expect(h.ipcRenderer.listenerCount(desktopChannels.reply)).toBe(0);
  });
});
