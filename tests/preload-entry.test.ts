import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageController } from "../packages/renderer/src/language-controller.js";
import {
  desktopChannels,
  portLimits,
  failure,
  type DesktopBridge,
} from "../packages/contracts/src/index.js";

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
    const localeCalls = [
      h.bridge.foundation.readLocale(),
      h.bridge.foundation.readLocaleReceipt("language-op"),
      h.bridge.foundation.replaceLocale({
        operationId: "language-op",
        expectedRevision: 0,
        value: "ko-KR",
      }),
    ];
    const language = h.bridge.foundation.subscribeLocale(() => {});
    const layout = {
      version: 1 as const,
      visible: { explorer: true, documents: true, chat: true },
      preferredWidths: { explorer: 256, documents: 656, chat: 360 },
    };
    calls.push(
      h.bridge.foundation.readLayout() as never,
      h.bridge.foundation.replaceLayout({
        operationId: "layout",
        expectedRevision: 0,
        value: layout,
      }) as never,
      h.bridge.foundation.readLayoutReceipt("layout") as never,
      h.bridge.foundation.claimLayoutFailureNotice() as never,
    );
    const subscription = h.bridge.foundation.subscribeStatus(() => {});
    const appearance = h.bridge.foundation.subscribeAppearance(() => {});
    calls[0].cancel();
    expect(await calls[0].result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    subscription.dispose();
    appearance.dispose();
    language.dispose();
    await subscription.ready;
    await appearance.ready;
    h.ipcRenderer.emit(desktopChannels.ended, {}, "other-generation");
    h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
    expect(await calls[1].result).toMatchObject({ ok: false, error: { code: "disposed" } });
    expect(await localeCalls[2].result).toMatchObject({ error: { code: "uncertain" } });
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

it("keeps locale owners observable after a seamless private service replacement", async () => {
  const h = await load();
  const notices = vi.fn();
  let stream = h.bridge.foundation.subscribeLocale(notices);
  h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
  h.ipcRenderer.sendSync.mockReturnValue({
    serviceGeneration: "service-2",
    windowGeneration: "window-2",
  });
  h.ipcRenderer.emit(desktopChannels.reconnect);
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-1");
  expect(notices).not.toHaveBeenCalled();
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
  expect(notices).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.objectContaining({ code: "sequence_gap" }) }),
  );
  stream.dispose();
  stream = h.bridge.foundation.subscribeLocale(() => {
    throw new Error("Consumer failed");
  });
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
  stream.dispose();
  const count = notices.mock.calls.length;
  h.window.dispatchEvent(new Event("unload"));
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
  expect(notices).toHaveBeenCalledTimes(count);
  expect(h.ipcRenderer.listenerCount(desktopChannels.preferencesReady)).toBe(0);
});

it("bounds logical locale owners across replacement and cleans every owner at unload", async () => {
  const h = await load();
  const streams = Array.from({ length: portLimits.subscriptions_per_window }, () =>
    h.bridge.foundation.subscribeLocale(() => {}),
  );
  const refused = h.bridge.foundation.subscribeLocale(() => {});
  expect(await refused.ready).toMatchObject({ error: { code: "busy" } });
  refused.dispose();
  h.window.dispatchEvent(new Event("unload"));
  for (const stream of streams) stream.dispose();
  expect(h.ipcRenderer.listenerCount(desktopChannels.preferencesReady)).toBe(0);
});
it("recovers the actual controller and named bridge without an availability sampling transition", async () => {
  const h = await load();
  let value = "ko-KR";
  let revision = 9;
  h.ipcRenderer.send.mockImplementation((_channel, text) => {
    const request = JSON.parse(text);
    if (request.kind !== "request") return;
    const snapshot = {
      serviceGeneration: request.serviceGeneration,
      record: { schemaVersion: 1, revision, value, source: revision ? "saved" : "default" },
      systemLocale: "en-US",
      effectiveLocale: value === "system" ? "en-US" : value,
    };
    if (request.operation === "locale.read")
      h.ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({ ...request, kind: "result", payload: { ok: true, value: snapshot } }),
      );
    if (request.operation === "locale.subscribe") {
      h.ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({
          ...request,
          kind: "result",
          payload: { ok: true, value: request.payload },
        }),
      );
      h.ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({
          protocol: request.protocol,
          policy: request.policy,
          kind: "event",
          windowGeneration: request.windowGeneration,
          serviceGeneration: request.serviceGeneration,
          subscriptionId: request.payload.subscriptionId,
          sequence: 1,
          topic: "locale",
          payload: snapshot,
        }),
      );
    }
  });
  const applied = vi.fn();
  const controller = new LanguageController(h.bridge.foundation, applied, () => "operation");
  await controller.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().current?.effectiveLocale).toBe("ko-KR");
  h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
  h.ipcRenderer.sendSync.mockReturnValue({
    serviceGeneration: "service-2",
    windowGeneration: "window-2",
  });
  h.ipcRenderer.emit(desktopChannels.reconnect);
  value = "system";
  revision = 0;
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
  await vi.advanceTimersByTimeAsync(0);
  expect(
    h.ipcRenderer.send.mock.calls.filter(([, text]) => {
      const request = JSON.parse(text);
      return request.kind === "request" && request.operation === "locale.subscribe";
    }),
  ).toHaveLength(2);
  expect(controller.snapshot().current).toMatchObject({
    serviceGeneration: "service-2",
    effectiveLocale: "en-US",
    record: { revision: 0 },
  });
  expect(controller.snapshot().readFailed).toBe(false);
  controller.dispose();
  h.window.dispatchEvent(new Event("unload"));
});

it("guards a choice made after reconnect but before its replacement snapshot and binds subsequent uncertainty to the actual generation", async () => {
  const h = await load();
  const writes: { operationId: string; serviceGeneration: string }[] = [];
  h.ipcRenderer.send.mockImplementation((_channel, text) => {
    const request = JSON.parse(text);
    if (request.kind !== "request") return;
    let payload: unknown;
    if (request.operation === "locale.read")
      payload = {
        ok: true,
        value: {
          serviceGeneration: request.serviceGeneration,
          record: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
          systemLocale: "en-US",
          effectiveLocale: "en-US",
        },
      };
    else if (request.operation === "locale.subscribe")
      payload = { ok: true, value: request.payload };
    else if (request.operation === "locale.replace") {
      writes.push(request);
      payload = failure("uncertain");
    } else if (request.operation === "locale.receipt")
      payload = { ok: true, value: { state: "not_found" } };
    else return;
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({ ...request, kind: "result", payload }),
    );
  });
  let identity = 0;
  const controller = new LanguageController(
    h.bridge.foundation,
    vi.fn(),
    () => "operation-" + ++identity,
  );
  await controller.refresh();
  const replace = (prior: string, next: string) => {
    h.ipcRenderer.emit(desktopChannels.ended, {}, prior);
    h.ipcRenderer.sendSync.mockReturnValue({
      serviceGeneration: next,
      windowGeneration: "window-1",
    });
    h.ipcRenderer.emit(desktopChannels.reconnect);
  };
  replace("service-1", "service-2");
  expect(controller.snapshot().current?.serviceGeneration).toBe("service-1");
  await controller.choose("ko-KR");
  expect(writes).toHaveLength(0);
  expect(controller.snapshot().current?.serviceGeneration).toBe("service-2");
  expect(controller.snapshot()).toMatchObject({ phase: "rejected", canChoose: false });
  await controller.choose("ko-KR");
  expect(writes).toMatchObject([{ operationId: "operation-2", serviceGeneration: "service-2" }]);
  expect(controller.snapshot()).toMatchObject({ phase: "uncertain", canChoose: false });
  await controller.refresh();
  await controller.retry();
  expect(writes).toHaveLength(1);
  expect(controller.snapshot().canChoose).toBe(false);
  replace("service-2", "service-3");
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-3");
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().current?.serviceGeneration).toBe("service-3");
  expect(controller.snapshot().canChoose).toBe(true);
  expect(writes).toHaveLength(1);
  await controller.retry();
  expect(writes).toMatchObject([
    { operationId: "operation-2", serviceGeneration: "service-2" },
    { operationId: "operation-3", serviceGeneration: "service-3" },
  ]);
  expect(controller.snapshot()).toMatchObject({ phase: "uncertain", canChoose: false });
  controller.dispose();
  h.window.dispatchEvent(new Event("unload"));
});
