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
  motion: unknown = { sequence: 0, value: "unknown" },
) {
  vi.resetModules();
  vi.useFakeTimers();
  flag("contextIsolated", true);
  flag("sandboxed", true);
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  const ipcRenderer = Object.assign(new EventEmitter(), {
    sendSync: vi.fn((channel: string) =>
      channel === desktopChannels.systemMotion ? motion : session,
    ),
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

it.each(["locale", "presentation"] as const)(
  "keeps %s owners observable after a seamless private service replacement",
  async (topic) => {
    const h = await load();
    const notices = vi.fn();
    let stream =
      topic === "locale"
        ? h.bridge.foundation.subscribeLocale(notices)
        : h.bridge.foundation.subscribePresentation(notices);
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
    const broken = () => {
      throw new Error("Consumer failed");
    };
    stream =
      topic === "locale"
        ? h.bridge.foundation.subscribeLocale(broken)
        : h.bridge.foundation.subscribePresentation(broken);
    h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
    stream.dispose();
    const count = notices.mock.calls.length;
    h.window.dispatchEvent(new Event("unload"));
    h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
    expect(notices).toHaveBeenCalledTimes(count);
    expect(h.ipcRenderer.listenerCount(desktopChannels.preferencesReady)).toBe(0);
  },
);

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

it("exposes only sequenced, valid native motion and bounds and releases its listeners", async () => {
  const h = await load(undefined, { sequence: 2, value: "reduce" });
  expect(h.ipcRenderer.sendSync).toHaveBeenCalledWith(desktopChannels.systemMotion);
  expect(Object.keys(h.bridge.system).sort()).toEqual(["readMotion", "subscribeMotion"]);
  expect(h.bridge.system.readMotion()).toBe("reduce");
  const seen: string[] = [];
  const stop = h.bridge.system.subscribeMotion((value) => seen.push(value));
  for (const stale of [
    { sequence: 1, value: "no_preference" },
    { sequence: 2, value: "no_preference" },
    { sequence: 3, value: "maybe" },
    { sequence: 3, value: "no_preference", extra: true },
    { sequence: -1, value: "no_preference" },
    "reduce",
  ])
    h.ipcRenderer.emit(desktopChannels.systemMotion, {}, stale);
  expect(h.bridge.system.readMotion()).toBe("reduce");
  h.ipcRenderer.emit(desktopChannels.systemMotion, {}, { sequence: 4, value: "reduce" });
  expect(seen).toEqual([]);
  h.ipcRenderer.emit(desktopChannels.systemMotion, {}, { sequence: 5, value: "no_preference" });
  expect(h.bridge.system.readMotion()).toBe("no_preference");
  expect(seen).toEqual(["no_preference"]);
  stop();
  h.ipcRenderer.emit(desktopChannels.systemMotion, {}, { sequence: 6, value: "reduce" });
  expect(seen).toEqual(["no_preference"]);
  const failing = vi.fn(() => {
    throw new Error("renderer listener failure");
  });
  h.bridge.system.subscribeMotion(failing);
  h.ipcRenderer.emit(desktopChannels.systemMotion, {}, { sequence: 7, value: "unknown" });
  h.ipcRenderer.emit(desktopChannels.systemMotion, {}, { sequence: 8, value: "reduce" });
  expect(failing).toHaveBeenCalledOnce();
  expect(() => h.bridge.system.subscribeMotion("listener" as never)).toThrow(TypeError);
  for (let index = 0; index < portLimits.subscriptions_per_window; index++)
    h.bridge.system.subscribeMotion(() => {});
  expect(() => h.bridge.system.subscribeMotion(() => {})).toThrow(/limit/);
  h.window.dispatchEvent(new Event("unload"));
  expect(h.ipcRenderer.listenerCount(desktopChannels.systemMotion)).toBe(0);
});
it("treats a refused or malformed initial motion read as unknown", async () => {
  for (const motion of [null, { sequence: 0, value: "reduce", extra: 1 }, { value: "reduce" }]) {
    const h = await load(undefined, motion);
    expect(h.error).toBeUndefined();
    expect(h.bridge.system.readMotion()).toBe("unknown");
  }
});
it("keeps named command bridge inputs/results bounded and strips native event authority", async () => {
  const h = await load();
  const context = { windowGeneration: "command-window", platform: "linux" };
  h.ipcRenderer.invoke.mockResolvedValueOnce(context as never);
  expect(await h.bridge.commands.context()).toEqual(context);
  h.ipcRenderer.invoke.mockResolvedValueOnce({ injected: true } as never);
  await expect(h.bridge.commands.context()).rejects.toThrow(/command context/);
  const native = vi.fn();
  const dispose = h.bridge.commands.onIntent(native);
  const intent = {
    windowGeneration: context.windowGeneration,
    source: "native",
    sequence: 1,
    command: "help.open",
  };
  h.ipcRenderer.emit(desktopChannels.commandIntent, { secret: "not exposed" }, intent);
  expect(native).toHaveBeenCalledWith(intent);
  h.ipcRenderer.emit(desktopChannels.commandIntent, {}, { ...intent, source: "renderer" });
  h.ipcRenderer.emit(desktopChannels.commandIntent, {}, { ...intent, windowGeneration: "old" });
  h.ipcRenderer.emit(desktopChannels.commandIntent, {}, { ...intent, sequence: 0 });
  expect(native).toHaveBeenCalledOnce();
  dispose();
  h.bridge.commands.onIntent(() => {
    throw new Error("disposed consumer");
  });
  h.ipcRenderer.emit(desktopChannels.commandIntent, {}, intent);
  h.ipcRenderer.emit(desktopChannels.commandIntent, {}, intent);
  const count = h.ipcRenderer.invoke.mock.calls.length;
  expect(await h.bridge.commands.perform("research.confirm" as never)).toBe(false);
  expect(await h.bridge.commands.openLink("https://example.invalid" as never)).toBe(false);
  expect(await h.bridge.commands.copyVersionInformation("xx-XX" as never)).toBe(false);
  expect(await h.bridge.commands.publish({} as never)).toBe(false);
  expect(h.ipcRenderer.invoke).toHaveBeenCalledTimes(count);
  const { CommandController } = await import("../packages/renderer/src/command-controller.js");
  const registry = new CommandController(context as never, "en-US");
  h.ipcRenderer.invoke.mockResolvedValue(true as never);
  expect(await h.bridge.commands.publish(registry.snapshot())).toBe(true);
  expect(await h.bridge.commands.perform("edit.copy")).toBe(true);
  expect(await h.bridge.commands.copyVersionInformation("ko-KR")).toBe(true);
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    desktopChannels.commands,
    "copy_version",
    "ko-KR",
  );
  expect(await h.bridge.commands.openLink("repository")).toBe(true);
  h.ipcRenderer.invoke.mockResolvedValueOnce({} as never);
  await expect(h.bridge.commands.about()).rejects.toThrow(/About information/);
  const about = {
    product: "Ohtia",
    version: "0.0.0",
    build: "sha256:synthetic",
    platform: "linux",
    architecture: "x86-64",
    copyright: "Synthetic copyright",
    license: "MIT",
    notices: [],
  };
  h.ipcRenderer.invoke.mockResolvedValueOnce(about as never);
  expect(await h.bridge.commands.about()).toEqual(about);
  const owners = Array.from({ length: portLimits.subscriptions_per_window }, () =>
    h.bridge.commands.onIntent(() => {}),
  );
  expect(() => h.bridge.commands.onIntent(() => {})).toThrow(/listener limit/);
  owners.forEach((dispose) => dispose());
  h.window.dispatchEvent(new Event("unload"));
  expect(h.ipcRenderer.listenerCount(desktopChannels.commandIntent)).toBe(0);
});

it("validates the native window request lease and closed results before crossing preload", async () => {
  const h = await load();
  h.ipcRenderer.invoke.mockResolvedValueOnce({
    windowGeneration: "lease-1",
    platform: "linux",
  } as never);
  await h.bridge.commands.context();
  const request = {
    intent: {
      windowGeneration: "lease-1",
      source: "renderer" as const,
      sequence: 1,
      command: "window.new" as const,
    },
  };
  h.ipcRenderer.invoke.mockResolvedValueOnce({
    status: "unavailable",
    reason: "window_limit",
  } as never);
  expect(await h.bridge.commands.windowAction(request)).toEqual({
    status: "unavailable",
    reason: "window_limit",
  });
  h.ipcRenderer.invoke.mockResolvedValueOnce({ status: "completed", menuDismissed: true } as never);
  expect(
    await h.bridge.commands.windowAction({
      ...request,
      intent: { ...request.intent, command: "menu.open" },
      anchor: { x: 0, y: 48 },
      input: "keyboard",
    }),
  ).toEqual({ status: "completed", menuDismissed: true });
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    expect.any(String),
    "window_action",
    expect.objectContaining({ anchor: { x: 0, y: 48 }, input: "keyboard" }),
  );
  h.ipcRenderer.invoke.mockResolvedValueOnce({
    status: "completed",
    menuDismissed: "private",
  } as never);
  expect(await h.bridge.commands.windowAction(request)).toEqual({ status: "failed" });
  h.ipcRenderer.invoke.mockResolvedValueOnce({ status: "completed", private: true } as never);
  expect(await h.bridge.commands.windowAction(request)).toEqual({ status: "failed" });
  for (const status of [["failed"], ["completed"], ["revoked"]]) {
    h.ipcRenderer.invoke.mockResolvedValueOnce({ status } as never);
    expect(await h.bridge.commands.windowAction(request)).toEqual({ status: "failed" });
  }
  const count = h.ipcRenderer.invoke.mock.calls.length;
  expect(
    await h.bridge.commands.windowAction({
      intent: { ...request.intent, windowGeneration: "old" },
    }),
  ).toEqual({ status: "stale_context" });
  expect(
    await h.bridge.commands.windowAction({ ...request, anchor: { x: 1, y: 1 } } as never),
  ).toEqual({ status: "stale_context" });
  expect(
    await h.bridge.commands.windowAction({
      intent: { ...request.intent, command: "menu.open" },
      anchor: { x: 0, y: 48 },
    }),
  ).toEqual({ status: "stale_context" });
  expect(h.ipcRenderer.invoke).toHaveBeenCalledTimes(count);
});

it("exposes the named presentation methods and preserves mutation uncertainty across service cessation", async () => {
  const h = await load();
  const calls = [
    h.bridge.foundation.readPresentation(),
    h.bridge.foundation.replaceCharacter({
      operationId: "character",
      expectedRevision: 0,
      value: "hidden",
    }),
    h.bridge.foundation.readCharacterReceipt("character"),
    h.bridge.foundation.replaceZoom({ operationId: "zoom", expectedRevision: 0, value: 125 }),
    h.bridge.foundation.adjustZoom("relative", "increase"),
    h.bridge.foundation.readZoomReceipt("zoom"),
    h.bridge.foundation.applyZoom(),
  ];
  expect(h.ipcRenderer.send.mock.calls.map(([, text]) => JSON.parse(text).operation)).toEqual([
    "presentation.read",
    "character.replace",
    "character.receipt",
    "zoom.replace",
    "zoom.adjust",
    "zoom.receipt",
    "zoom.apply",
  ]);
  h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
  for (const [index, call] of calls.entries())
    expect(await call.result).toMatchObject({
      error: { code: [1, 3, 4].includes(index) ? "uncertain" : "disposed" },
    });
  h.window.dispatchEvent(new Event("unload"));
  expect(h.ipcRenderer.listenerCount(desktopChannels.reply)).toBe(0);
});

it("exposes connection calls and revokes bounded logical subscriptions on reconnect and unload", async () => {
  const h = await load();
  const snapshot = {
    connection: "fake",
    state: "disconnected",
    reason: null,
    probing: false,
    probe_id: null,
    model_list_revision: null,
    model_count: 0,
  };
  h.ipcRenderer.send.mockImplementation((_channel: string, text: string) => {
    const request = JSON.parse(text);
    if (request.kind !== "request") return;
    const value =
      request.operation === "connection.subscribe"
        ? { subscriptionId: request.payload.subscriptionId }
        : request.operation === "connection.listModels"
          ? {
              connection: "fake",
              model_list_revision: 1,
              models: [],
              nextCursor: 0,
              hasMore: false,
            }
          : snapshot;
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({ ...request, kind: "result", payload: { ok: true, value } }),
    );
  });
  for (const call of [
    h.bridge.foundation.readConnection("fake"),
    h.bridge.foundation.connectConnection("fake"),
    h.bridge.foundation.disconnectConnection("fake"),
    h.bridge.foundation.probeConnection("fake"),
    h.bridge.foundation.listConnectionModels({
      connection: "fake",
      model_list_revision: 1,
      cursor: 0,
      count: 128,
    }),
  ])
    expect((await call.result).ok).toBe(true);
  const listener = vi.fn();
  const first = h.bridge.foundation.subscribeConnection("fake", listener);
  expect((await first.ready).ok).toBe(true);
  first.dispose();
  const subscriptions = Array.from({ length: portLimits.subscriptions_per_window }, (_, n) =>
    h.bridge.foundation.subscribeConnection(
      "fake",
      n === 0
        ? listener
        : () => {
            throw new Error("consumer-error");
          },
    ),
  );
  for (const subscription of subscriptions) expect((await subscription.ready).ok).toBe(true);
  expect(await h.bridge.foundation.subscribeConnection("fake", listener).ready).toMatchObject({
    error: { code: "busy" },
  });
  h.ipcRenderer.emit(desktopChannels.reconnect, {});
  expect(listener).toHaveBeenCalledWith(failure("sequence_gap"));
  const current = h.bridge.foundation.subscribeConnection("fake", listener);
  expect((await current.ready).ok).toBe(true);
  h.window.dispatchEvent(new Event("unload"));
  expect(h.ipcRenderer.listenerCount(desktopChannels.reply)).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("reclaims connection capacity after rejected openings, sequence gaps and consumer failures", async () => {
  const h = await load();
  let reject = true;
  let wrongAcknowledgement = false;
  let request: any;
  const snapshot = {
    connection: "fake",
    state: "disconnected",
    reason: null,
    probing: false,
    probe_id: null,
    model_list_revision: null,
    model_count: 0,
    kind: "state",
  };
  h.ipcRenderer.send.mockImplementation((_channel: string, text: string) => {
    const value = JSON.parse(text);
    if (value.kind !== "request") return;
    request = value;
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({
        ...request,
        kind: "result",
        payload: reject
          ? failure("service_unavailable")
          : {
              ok: true,
              value: {
                subscriptionId: wrongAcknowledgement ? "wrong" : request.payload.subscriptionId,
              },
            },
      }),
    );
  });
  const listener = vi.fn();
  for (let n = 0; n < 5; n++)
    expect(await h.bridge.foundation.subscribeConnection("fake", listener).ready).toMatchObject({
      error: { code: "service_unavailable" },
    });
  reject = false;
  for (let n = 0; n < 5; n++) {
    expect((await h.bridge.foundation.subscribeConnection("fake", listener).ready).ok).toBe(true);
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({
        protocol: 1,
        policy: request.policy,
        kind: "event",
        windowGeneration: request.windowGeneration,
        serviceGeneration: request.serviceGeneration,
        subscriptionId: request.payload.subscriptionId,
        sequence: 2,
        topic: "connection",
        payload: snapshot,
      }),
    );
  }
  expect(listener).toHaveBeenCalledWith(failure("sequence_gap"));
  for (let n = 0; n < 5; n++) {
    expect(
      (
        await h.bridge.foundation.subscribeConnection("fake", () => {
          throw new Error("consumer-error");
        }).ready
      ).ok,
    ).toBe(true);
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({
        protocol: 1,
        policy: request.policy,
        kind: "event",
        windowGeneration: request.windowGeneration,
        serviceGeneration: request.serviceGeneration,
        subscriptionId: request.payload.subscriptionId,
        sequence: 1,
        topic: "connection",
        payload: snapshot,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
  }
  wrongAcknowledgement = true;
  expect(await h.bridge.foundation.subscribeConnection("fake", listener).ready).toMatchObject({
    error: { code: "invalid_service_result" },
  });
  wrongAcknowledgement = false;
  expect((await h.bridge.foundation.subscribeConnection("fake", listener).ready).ok).toBe(true);
  h.window.dispatchEvent(new Event("unload"));
  expect(vi.getTimerCount()).toBe(0);
});
