import { proposeSetup } from "./fixtures/project-setup.js";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageController } from "../packages/renderer/src/language-controller.js";
import {
  desktopChannels,
  portLimits,
  failure,
  type DesktopBridge,
  type Envelope,
  type Request,
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
  it("correlates model pages and agent preference receipts on the fixed desktop port", async () => {
    const { ipcRenderer, bridge } = await load();
    const port = bridge.foundation;
    const reference = "019a8000-0000-7000-8000-000000000204";
    const model = {
      id: "model-a",
      name: "Model A",
      effortSupport: "supported",
      effortLevels: [{ name: "high", supported: true }],
      defaultEffort: "high",
      maxOutput: 5000,
      origin: "catalog",
      retiring: false,
    } as const;
    const row = {
      target: "default",
      revision: 1,
      connection: "chatgpt",
      model: model.id,
      modelName: model.name,
      effort: null,
      inherit: false,
      source: "first_connection",
      seedPending: false,
    };
    const saved = {
      preferences: [row],
      lists: [
        {
          connection: "chatgpt",
          kind: "subscription",
          list_revision: 1,
          count: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          current: true,
        },
      ],
    };
    const send = (operation: string, value: object) => {
      const [channel, text] = ipcRenderer.send.mock.calls.at(-1)!;
      expect(channel).toBe(desktopChannels.port);
      const request = JSON.parse(text);
      expect(request.operation).toBe(operation);
      ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({
          ...request,
          kind: "result",
          payload: { ok: true, value },
        }),
      );
      return request;
    };
    const read = port.listAgentPreferences();
    expect(send("agentPreference.list", saved).payload).toEqual({});
    expect(await read.result).toEqual({ ok: true, value: saved });
    const choice = {
      target: "default",
      expectedRevision: 0,
      connection: "chatgpt",
      model: model.id,
      effort: null,
      inherit: false,
      source: "first_connection",
    } as const;
    const write = port.replaceAgentPreference("first-model", choice);
    expect(send("agentPreference.replace", { resultId: reference })).toMatchObject({
      operationId: "first-model",
      payload: choice,
    });
    expect(await write.result).toEqual({ ok: true, value: { resultId: reference } });
    const checked = port.listAgentPreferences("first-model");
    expect(send("agentPreference.list", { ...saved, receipt: "recorded" }).payload).toEqual({
      operationId: "first-model",
    });
    expect(await checked.result).toMatchObject({ ok: true, value: { receipt: "recorded" } });
    const uncorrelated = port.listAgentPreferences("first-model");
    send("agentPreference.list", saved);
    expect(await uncorrelated.result).toEqual(failure("invalid_service_result"));

    const observed = vi.fn();
    const stream = port.subscribeResearch({ projectId: null, conversationId: null }, observed);
    const request = JSON.parse(ipcRenderer.send.mock.calls.at(-1)![1]);
    send("research.subscribe", { subscriptionId: request.payload.subscriptionId });
    expect(await stream.ready).toMatchObject({ ok: true });
    for (const [index, payload] of [
      { kind: "agentPreferenceChanged", target: "default", revision: 1, source: "replace" },
      { kind: "providerModelsChanged", connection: "chatgpt", list_revision: 1 },
      { kind: "destinationChanged", connection: "chatgpt" },
    ].entries()) {
      ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({
          protocol: request.protocol,
          policy: request.policy,
          kind: "event",
          windowGeneration: request.windowGeneration,
          serviceGeneration: request.serviceGeneration,
          subscriptionId: request.payload.subscriptionId,
          sequence: index + 1,
          topic: "research",
          payload,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(observed).toHaveBeenLastCalledWith({ ok: true, value: payload });
    }
    stream.dispose();

    const input = { connection: "chatgpt", list_revision: 1, cursor: 0, count: 1 };
    const response = {
      connection: input.connection,
      list_revision: 1,
      models: [model],
      nextCursor: 1,
      hasMore: false,
    };
    const page = port.listProviderModels(input);
    expect(send("providerModel.list", response).payload).toEqual(input);
    expect(await page.result).toEqual({ ok: true, value: response });
    for (const invalid of [
      { ...response, connection: "anthropic" },
      { ...response, list_revision: 2 },
      { ...response, nextCursor: 3 },
      { ...response, models: [model, { ...model, id: "model-b" }], nextCursor: 2 },
      { ...response, models: [], nextCursor: 0, hasMore: true },
    ]) {
      const page = port.listProviderModels(input);
      send("providerModel.list", invalid);
      expect(await page.result).toEqual(failure("invalid_service_result"));
    }
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
    const conversationId = "019a8000-0000-7000-8000-000000000202";
    const proposalId = "019a8000-0000-7000-8000-000000000203";
    const handoffs = [
      h.bridge.foundation.acceptHandoff("accept-handoff", { proposalId, expectedOwnerRevision: 1 }),
      h.bridge.foundation.declineHandoff("decline-handoff", { proposalId }),
      h.bridge.foundation.returnHandoff("return-handoff", {
        conversationId,
        expectedOwnerRevision: 2,
        selection: "",
      }),
      h.bridge.foundation.listHandoffSelection({
        conversationId,
        expectedOwnerRevision: 2,
        after: 0,
      }),
    ];
    expect(
      h.ipcRenderer.send.mock.calls.slice(-4).map(([, text]) => JSON.parse(text).operation),
    ).toEqual(["handoff.accept", "handoff.decline", "handoff.return", "handoff.selection"]);
    const sent = h.ipcRenderer.send.mock.calls.slice(-4).map(([, text]) => JSON.parse(text));
    sent.forEach((request, index) =>
      h.ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({
          ...request,
          kind: "result",
          payload: {
            ok: true,
            value:
              index === 3
                ? {
                    priorReply: true,
                    messages: [
                      { position: 4, agentId: "josefa", prefix: "Reply", truncated: false },
                    ],
                    next: 4,
                  }
                : { resultId: proposalId },
          },
        }),
      ),
    );
    for (const handoff of handoffs) expect(await handoff.result).toMatchObject({ ok: true });
    const projectId = "019a8000-0000-7000-8000-000000000204";
    const replyInput = { projectId, taskId: proposalId };
    const replyDetails = h.bridge.foundation.readReplyDetails(replyInput);
    const [replyChannel, replyText] = h.ipcRenderer.send.mock.calls.at(-1)!;
    expect(replyChannel).toBe(desktopChannels.port);
    const replyRequest = JSON.parse(replyText);
    expect(replyRequest).toMatchObject({ operation: "reply.details", payload: replyInput });
    const replyFailure = failure("storage_failed");
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({ ...replyRequest, kind: "result", payload: replyFailure }),
    );
    expect(await replyDetails.result).toEqual(replyFailure);
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
    const location = h.bridge.foundation.readManagedStoreLocation();
    const [locationChannel, locationText] = h.ipcRenderer.send.mock.calls.at(-1)!;
    expect(locationChannel).toBe(desktopChannels.port);
    const locationRequest = JSON.parse(locationText);
    expect(locationRequest).toMatchObject({
      operation: "managedStore.readLocation",
      payload: {},
      serviceGeneration: "service-2",
    });
    const locationReply = {
      ok: true,
      value: { state: "unavailable", reason: "locator_unreadable" },
    };
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({ ...locationRequest, kind: "result", payload: locationReply }),
    );
    expect(await location.result).toEqual(locationReply);
    const planId = "019a8000-0000-7000-8000-000000000227";
    const planCalls = [
      h.bridge.foundation.readPlan({ planId }),
      h.bridge.foundation.listPlanEvents({ planId, afterSequence: 0 }),
      h.bridge.foundation.cancelPlan("plan-cancel", { planId }),
      h.bridge.foundation.acceptPlan("plan-accept", {
        planId,
        connections: { josefa: "openai", virgilio: "chatgpt" },
      }),
      h.bridge.foundation.declinePlan("plan-decline", { planId }),
    ];
    expect(
      h.ipcRenderer.send.mock.calls.slice(-5).map(([, text]) => JSON.parse(text).operation),
    ).toEqual(["plan.read", "planEvent.list", "plan.cancel", "plan.accept", "plan.decline"]);
    expect(JSON.parse(h.ipcRenderer.send.mock.calls.at(-2)![1]).payload).toEqual({
      planId,
      connections: { josefa: "openai", virgilio: "chatgpt" },
    });
    const planChanges = [
      h.bridge.foundation.readPlanChange({ conversationId, proposalId }),
      h.bridge.foundation.applyPlanChange("apply-change", { proposalId }),
      h.bridge.foundation.declinePlanChange("decline-change", { proposalId }),
    ];
    const changeRequests = h.ipcRenderer.send.mock.calls.slice(-3).map(([channel, text]) => {
      expect(channel).toBe(desktopChannels.port);
      return JSON.parse(text);
    });
    expect(changeRequests).toMatchObject([
      {
        operation: "planChange.read",
        operationId: expect.any(String),
        payload: { conversationId, proposalId },
      },
      { operation: "planChange.apply", operationId: "apply-change", payload: { proposalId } },
      { operation: "planChange.decline", operationId: "decline-change", payload: { proposalId } },
    ]);
    const undoMemory = h.bridge.foundation.undoMemory("memory-undo", { taskId: proposalId });
    const undoRequest = JSON.parse(h.ipcRenderer.send.mock.calls.at(-1)![1]);
    expect(undoRequest).toMatchObject({
      operation: "memory.undo",
      operationId: "memory-undo",
      payload: { taskId: proposalId },
    });
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({
        ...undoRequest,
        kind: "result",
        payload: { ok: true, value: { resultId: proposalId } },
      }),
    );
    await expect(undoMemory.result).resolves.toEqual({ ok: true, value: { resultId: proposalId } });

    const otherUndo = h.bridge.foundation.undoMemory("memory-undo-mismatch", {
      taskId: proposalId,
    });
    const otherUndoRequest = JSON.parse(h.ipcRenderer.send.mock.calls.at(-1)![1]);
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({
        ...otherUndoRequest,
        kind: "result",
        payload: { ok: true, value: { resultId: conversationId } },
      }),
    );
    await expect(otherUndo.result).resolves.toMatchObject({
      error: { code: "invalid_service_result" },
    });

    const entryId = "019a8000-0000-7000-8000-000000000235";
    const memory = [
      [
        "memory.add",
        h.bridge.foundation.addMemory("memory-add", {
          projectId: conversationId,
          kind: "note",
          text: "Memory",
        }),
        { resultId: entryId },
      ],
      [
        "memory.edit",
        h.bridge.foundation.editMemory("memory-edit", {
          entryId,
          expectedVersion: 1,
          kind: "note",
          text: "Edited",
        }),
        { resultId: entryId },
      ],
      [
        "memory.withdraw",
        h.bridge.foundation.withdrawMemory("memory-withdraw", { entryId, expectedVersion: 2 }),
        { resultId: entryId },
      ],
      [
        "memory.list",
        h.bridge.foundation.listMemory({ projectId: conversationId, after: null }),
        {
          projectId: conversationId,
          revision: 3,
          entries: [],
          next: null,
          bytes: 0,
          active: 0,
        },
      ],
      [
        "memory.history",
        h.bridge.foundation.readMemoryHistory({ projectId: conversationId, entryId, before: null }),
        {
          entryId,
          versions: [3, 2, 1].map((number) => ({
            number,
            kind: "note",
            text: "Memory",
            state: number === 3 ? "withdrawn" : "active",
            change: number === 3 ? "withdrawn" : number === 2 ? "edited" : "added",
            author: "researcher",
            date: "2026-11-21T09:00:00.000Z",
          })),
          next: null,
        },
      ],
    ] as const;
    const memoryWires = h.ipcRenderer.send.mock.calls.slice(-memory.length);
    for (const [index, [operation, memoryCall, value]] of memory.entries()) {
      const [channel, wire] = memoryWires[index]!;
      expect(channel).toBe(desktopChannels.port);
      const request = JSON.parse(wire);
      expect(request.operation).toBe(operation);
      h.ipcRenderer.emit(
        desktopChannels.reply,
        {},
        JSON.stringify({
          ...request,
          kind: "result",
          payload: { ok: true, value },
        }),
      );
      await expect(memoryCall.result).resolves.toEqual({ ok: true, value });
    }

    const retrySynthesis = h.bridge.foundation.tryAgainSynthesis("try-synthesis", {
      taskId: "019a8000-0000-7000-8000-000000000501",
    });
    const retryWire = h.ipcRenderer.send.mock.calls.at(-1);
    expect(retryWire?.[0]).toBe(desktopChannels.port);
    expect(JSON.parse(retryWire?.[1] as string)).toMatchObject({
      operation: "synthesis.tryAgain",
      operationId: "try-synthesis",
      payload: { taskId: "019a8000-0000-7000-8000-000000000501" },
    });
    h.window.dispatchEvent(new Event("unload"));
    expect(await retrySynthesis.result).toMatchObject({ ok: false, error: { code: "uncertain" } });
    for (const call of planCalls) expect(await call.result).toMatchObject({ ok: false });
    await expect(planChanges[0].result).resolves.toMatchObject({ error: { code: "disposed" } });
    for (const call of planChanges.slice(1))
      await expect(call.result).resolves.toMatchObject({ error: { code: "uncertain" } });
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
it("recovers the controller and named bridge when readiness overlaps a locale refresh", async () => {
  const h = await load();
  let value = "ko-KR";
  let revision = 9;
  let waitingForStorage = false;
  const pending: Request[] = [];
  const subscriptions: Extract<Request, { operation: "locale.subscribe" }>[] = [];
  const reply = (request: Request, payload: unknown) => {
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({ ...request, kind: "result", payload }),
    );
  };
  const snapshot = (request: Request) => ({
    serviceGeneration: request.serviceGeneration,
    record: { schemaVersion: 1, revision, value, source: revision ? "saved" : "default" },
    systemLocale: "en-US",
    effectiveLocale: value === "system" ? "en-US" : value,
  });
  const publish = (request: (typeof subscriptions)[number], sequence: number) => {
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
        sequence,
        topic: "locale",
        payload: snapshot(request),
      }),
    );
  };
  h.ipcRenderer.send.mockImplementation((_channel, text) => {
    const request = JSON.parse(text) as Envelope;
    if (request.kind !== "request") return;
    if (waitingForStorage) {
      pending.push(request);
      return;
    }
    if (request.operation === "locale.read") reply(request, { ok: true, value: snapshot(request) });
    if (request.operation === "locale.subscribe") {
      subscriptions.push(request);
      reply(request, { ok: true, value: request.payload });
      publish(request, 1);
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
  waitingForStorage = true;
  const opening = controller.refresh();
  expect(pending.map(({ operation }) => operation)).toEqual(["locale.subscribe", "locale.read"]);
  h.ipcRenderer.emit(desktopChannels.preferencesReady, {}, "service-2");
  waitingForStorage = false;
  for (const request of pending) reply(request, failure("service_unavailable"));
  await opening;
  await vi.advanceTimersByTimeAsync(0);
  expect(subscriptions.map(({ serviceGeneration }) => serviceGeneration)).toEqual([
    "service-1",
    "service-2",
  ]);
  expect(controller.snapshot().current).toMatchObject({
    serviceGeneration: "service-2",
    effectiveLocale: "en-US",
    record: { revision: 0 },
  });
  expect(controller.snapshot().readFailed).toBe(false);
  value = "es-AR";
  revision = 1;
  publish(subscriptions[1]!, 2);
  await vi.advanceTimersByTimeAsync(0);
  expect(applied).toHaveBeenLastCalledWith(snapshot(subscriptions[1]!));
  expect(
    h.ipcRenderer.send.mock.calls.some(
      ([, text]) => JSON.parse(text).operation === "locale.replace",
    ),
  ).toBe(false);
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
it("delivers only sequenced, valid update states and releases its listeners", async () => {
  const h = await load();
  expect(Object.keys(h.bridge.update)).toEqual(["subscribeState"]);
  const before = h.ipcRenderer.send.mock.calls.length;
  void h.bridge.foundation.readUpdateCheck();
  void h.bridge.foundation.replaceUpdateCheck({
    operationId: "update-off",
    expectedRevision: 0,
    value: false,
  });
  void h.bridge.foundation.readUpdateCheckReceipt("update-off");
  void h.bridge.foundation.readUpdate();
  void h.bridge.foundation.checkForUpdate();
  expect(
    h.ipcRenderer.send.mock.calls.slice(before).map(([, text]) => JSON.parse(text).operation),
  ).toEqual([
    "updateCheck.read",
    "updateCheck.replace",
    "updateCheck.receipt",
    "update.read",
    "update.check",
  ]);
  const state = { installedVersion: "0.2.0", check: "checking", failure: null, available: null };
  const seen: unknown[] = [];
  const stop = h.bridge.update.subscribeState((value) => seen.push(value));
  h.ipcRenderer.emit(desktopChannels.updateState, {}, { sequence: 2, state });
  for (const stale of [
    { sequence: 2, state: { ...state, check: "idle" } },
    { sequence: 1, state: { ...state, check: "idle" } },
    { sequence: 3, state: { ...state, check: "failed" } },
    { sequence: 3, state, extra: true },
    {
      sequence: 3,
      state: { ...state, available: { version: "x", notes: [], notesTruncated: false } },
    },
    "checking",
  ])
    h.ipcRenderer.emit(desktopChannels.updateState, {}, stale);
  expect(seen).toEqual([{ sequence: 2, state }]);
  const checked = {
    ...state,
    check: "checked",
    available: { version: "0.3.0", notes: ["<b>Notes</b>"], notesTruncated: false },
  };
  h.ipcRenderer.emit(desktopChannels.updateState, {}, { sequence: 3, state: checked });
  expect(seen).toEqual([
    { sequence: 2, state },
    { sequence: 3, state: checked },
  ]);
  stop();
  h.ipcRenderer.emit(desktopChannels.updateState, {}, { sequence: 4, state });
  expect(seen).toHaveLength(2);
  const failing = vi.fn(() => {
    throw new Error("renderer listener failure");
  });
  h.bridge.update.subscribeState(failing);
  h.ipcRenderer.emit(desktopChannels.updateState, {}, { sequence: 5, state });
  h.ipcRenderer.emit(desktopChannels.updateState, {}, { sequence: 6, state });
  expect(failing).toHaveBeenCalledOnce();
  expect(() => h.bridge.update.subscribeState("listener" as never)).toThrow(TypeError);
  for (let index = 0; index < portLimits.subscriptions_per_window; index++)
    h.bridge.update.subscribeState(() => {});
  expect(() => h.bridge.update.subscribeState(() => {})).toThrow(/limit/);
  h.window.dispatchEvent(new Event("unload"));
  expect(h.ipcRenderer.listenerCount(desktopChannels.updateState)).toBe(0);
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
  for (const component of ["", "x".repeat(65537), 42, null])
    expect(await h.bridge.commands.openNoticeLink(component as never)).toBe(false);
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
  expect(await h.bridge.commands.openLink("chatgptUsage")).toBe(true);
  expect(await h.bridge.commands.openNoticeLink("React")).toBe(true);
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    desktopChannels.commands,
    "open_notice_link",
    "React",
  );
  expect(await h.bridge.commands.openUpdateRoute()).toBe(true);
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    desktopChannels.commands,
    "open_update_route",
    undefined,
  );
  h.ipcRenderer.invoke.mockResolvedValueOnce("software_centre" as never);
  expect(await h.bridge.commands.updateRoute()).toBe("software_centre");
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    desktopChannels.commands,
    "update_route",
    undefined,
  );
  h.ipcRenderer.invoke.mockResolvedValueOnce("https://example.invalid" as never);
  await expect(h.bridge.commands.updateRoute()).rejects.toThrow(/update route/);
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
  const quote = { operationId: "quote-length", expectedRevision: 0, value: 0 };
  expect(
    await h.bridge.foundation.replaceSourceQuote({ ...quote, value: -1 }).result,
  ).toMatchObject({
    error: { code: "invalid_message" },
  });
  expect(await h.bridge.foundation.replaceSourceQuote(quote, "old-service").result).toMatchObject({
    error: { code: "service_unavailable" },
  });
  expect(h.ipcRenderer.send).not.toHaveBeenCalled();
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
    h.bridge.foundation.replaceSourceQuote(quote),
    h.bridge.foundation.readSourceQuoteReceipt("quote-length"),
    h.bridge.foundation.replaceEntryText({
      operationId: "entry-length",
      expectedRevision: 0,
      value: 0,
    }),
    h.bridge.foundation.readEntryTextReceipt("entry-length"),
  ];
  expect(h.ipcRenderer.send.mock.calls.map(([, text]) => JSON.parse(text).operation)).toEqual([
    "presentation.read",
    "character.replace",
    "character.receipt",
    "zoom.replace",
    "zoom.adjust",
    "zoom.receipt",
    "zoom.apply",
    "sourceQuote.replace",
    "sourceQuote.receipt",
    "entryText.replace",
    "entryText.receipt",
  ]);
  h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
  for (const [index, call] of calls.entries())
    expect(await call.result).toMatchObject({
      error: { code: [1, 3, 4, 7, 9].includes(index) ? "uncertain" : "disposed" },
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
    display_name: "Fake",
    account_email: null,
    last_account_email: null,
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
          : {
              ...snapshot,
              connection: request.payload.connection,
              ...(request.operation === "connection.replaceKey"
                ? {
                    state: "connected",
                    checking_key: true,
                    connected_at: "2026-11-22T12:00:00.000Z",
                  }
                : {}),
            };
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({ ...request, kind: "result", payload: { ok: true, value } }),
    );
  });
  for (const call of [
    h.bridge.foundation.readConnection("fake"),
    h.bridge.foundation.connectConnection("fake"),
    h.bridge.foundation.replaceConnectionKey("anthropic_api_key", "synthetic-replacement"),
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
  expect(
    h.ipcRenderer.send.mock.calls.map(([, text]: [string, string]) => JSON.parse(text)),
  ).toContainEqual(
    expect.objectContaining({
      operation: "connection.replaceKey",
      payload: { connection: "anthropic_api_key", key: "synthetic-replacement" },
    }),
  );
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
    display_name: "Fake",
    account_email: null,
    last_account_email: null,
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

it("exposes only validated exit state and fixed choices on the command bridge", async () => {
  const h = await load();
  h.ipcRenderer.invoke.mockResolvedValue(null);
  expect(await h.bridge.commands.readExitState()).toBeNull();
  const state = { operationId: "exit-1", running: 2, phase: "waiting", failed: false };
  h.ipcRenderer.invoke.mockResolvedValue(state);
  expect(await h.bridge.commands.readExitState()).toEqual(state);
  h.ipcRenderer.invoke.mockResolvedValue({ ...state, content: "private" });
  await expect(h.bridge.commands.readExitState()).rejects.toThrow("Invalid exit state");
  const listener = vi.fn();
  const off = h.bridge.commands.onExitState(listener);
  h.ipcRenderer.emit(desktopChannels.exitState, {}, { ...state, running: -1 });
  expect(listener).not.toHaveBeenCalled();
  h.ipcRenderer.emit(desktopChannels.exitState, {}, state);
  expect(listener).toHaveBeenLastCalledWith(state);
  h.ipcRenderer.emit(desktopChannels.exitState, {}, null);
  expect(listener).toHaveBeenLastCalledWith(null);
  off();
  h.ipcRenderer.invoke.mockResolvedValue(true);
  expect(await h.bridge.commands.chooseExit("exit-1", "cancel")).toBe(true);
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(desktopChannels.commands, "exit_choice", {
    operationId: "exit-1",
    choice: "cancel",
  });
  expect(await h.bridge.commands.chooseExit("bad space", "cancel")).toBe(false);
});

it("carries persisted research through the sandbox entry and revokes scoped streams on reconnect", async () => {
  const h = await load();
  vi.useRealTimers();
  const { storageFixture } = await import("./fixtures/storage.js");
  const { createStatusService } = await import("../packages/utility/src/status-service.js");
  const { splitText } = await import("../packages/contracts/src/index.js");
  const { digest } = await import("../packages/utility/src/research-text.js");
  const fixture = storageFixture();
  await fixture.store.open();
  const service = createStatusService(
    "service-1",
    "en-US",
    (text) => h.ipcRenderer.emit(desktopChannels.reply, {}, text),
    fixture.store,
    undefined,
    "development",
  );
  service.activate("en-US");
  h.ipcRenderer.send.mockImplementation((channel: string, text: string) => {
    if (channel === desktopChannels.port) service.receive(text);
  });
  const port = h.bridge.foundation;
  const expectValue = async <T>(call: {
    result: Promise<import("../packages/contracts/src/index.js").Outcome<T>>;
  }): Promise<T> => {
    const result = await call.result;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };
  try {
    const project = await expectValue(port.createProject("entry-create"));
    const projectId = project.resultId;
    expect(await expectValue(port.openProject("entry-open", { projectId }))).toEqual({
      resultId: projectId,
    });
    expect(await expectValue(port.openProject("entry-open", { projectId }))).toEqual({
      resultId: projectId,
    });
    expect((await expectValue(port.listProjects({ cursor: null, count: 40 }))).items[0]?.id).toBe(
      projectId,
    );
    const initialAttention = { items: [], next: null, hasMore: false, revision: 1 };
    expect(await expectValue(port.listProjectAttention({ cursor: null, count: 40 }))).toEqual(
      initialAttention,
    );
    await expectValue(
      port.confirmProjectSetup("entry-confirm", {
        proposalId: await proposeSetup(fixture.store, fixture.raw, projectId),
      }),
    );
    const started = await expectValue(
      port.startConversation("entry-start", { projectId, content: "Synthetic question" }),
    );
    const conversationId = started.resultId;
    const listed = await expectValue(
      port.listConversations({ projectId, cursor: null, count: 50 }),
    );
    expect(listed.items.some((item) => item.id === conversationId)).toBe(true);
    const summary = (
      await expectValue(port.readConversations({ projectId, ids: [conversationId] }))
    ).items[0]!;
    await expectValue(
      port.renameConversation("entry-rename", {
        conversationId,
        title: "Synthetic title",
        expectedUpdatedAt: summary.updatedAt,
      }),
    );
    const text = "한".repeat(2000);
    const parts = splitText(text);
    const descriptor = { parts: parts.length, bytes: 6000, sha256: digest(text) };
    for (let index = 0; index < parts.length; index++)
      await expectValue(
        port.sendTextPart("entry-append", {
          index: index + 1,
          count: parts.length,
          bytes: 6000,
          sha256: descriptor.sha256,
          text: parts[index]!,
        }),
      );
    const appended = await expectValue(
      port.appendMessage("entry-append", { conversationId, content: descriptor }),
    );
    const timeline = await expectValue(
      port.listTimelineBefore({ conversationId, cursor: null, count: 50 }),
    );
    const saved = timeline.items.find((item) => item.id === appended.resultId)!;
    expect(
      (await expectValue(port.readTimeline({ conversationId, ids: [saved.id] }))).items[0],
    ).toEqual(saved);
    if (saved.kind !== "message" || typeof saved.content === "string")
      throw new Error("Expected text reference.");
    expect(
      (await expectValue(port.readTextPart({ source: saved.content.source, index: 1 }))).text,
    ).toBe(parts[0]);
    expect(await port.readReplyParts({ taskId: saved.id, fromSequence: 1 }).result).toEqual(
      failure("record_not_found"),
    );
    // Stop queued guidance before the fixture prepares another project's setup.
    await expectValue(port.stopConversation("entry-stop-guidance", { conversationId }));
    const setupProject = await expectValue(port.createProject("entry-proposal-project"));
    await service.drain();
    const proposalId = await proposeSetup(fixture.store, fixture.raw, setupProject.resultId);
    const setupConversation = await fixture.store.readConversations(setupProject.resultId);
    if (!setupConversation.ok) throw new Error(setupConversation.error.code);
    await expectValue(port.rejectProjectSetup("entry-reject", { proposalId }));
    const rejected = await expectValue(
      port.readTimeline({ conversationId: setupConversation.value[0]!.id, ids: [proposalId] }),
    );
    expect(rejected.items[0]).toMatchObject({
      kind: "setupProposal",
      state: "rejected",
      revision: 2,
    });
    const listener = vi.fn();
    const subscription = port.subscribeResearch({ projectId, conversationId }, listener);
    expect((await subscription.ready).ok).toBe(true);
    h.ipcRenderer.emit(desktopChannels.reconnect, {});
    expect(listener).toHaveBeenCalledWith(failure("sequence_gap"));
    const current = port.subscribeResearch({ projectId, conversationId }, () => {});
    expect((await current.ready).ok).toBe(true);
    expect(await expectValue(port.listProjectAttention({ cursor: projectId, count: 1 }))).toEqual(
      initialAttention,
    );
    h.window.dispatchEvent(new Event("unload"));
    expect(h.ipcRenderer.listenerCount(desktopChannels.reply)).toBe(0);
  } finally {
    h.window.dispatchEvent(new Event("unload"));
    service.dispose();
  }
});

it("admits message actions as named boolean commands without accepting message text or unsafe links", async () => {
  const h = await load();
  const id = "019a8000-0000-7000-8000-000000000001";
  h.ipcRenderer.invoke.mockResolvedValue(true as never);
  expect(await h.bridge.commands.copyMessage(id)).toBe(true);
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    desktopChannels.commands,
    "copy_message",
    id,
  );
  expect(await h.bridge.commands.openExternalLink("https://example.org")).toBe(true);
  expect(h.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    desktopChannels.commands,
    "open_external_link",
    "https://example.org",
  );
  const calls = h.ipcRenderer.invoke.mock.calls.length;
  expect(await h.bridge.commands.copyMessage("private message text")).toBe(false);
  for (const url of [
    "javascript:evil()",
    "file:///private",
    "https://example.org/" + "a".repeat(4096),
  ])
    expect(await h.bridge.commands.openExternalLink(url)).toBe(false);
  expect(h.ipcRenderer.invoke).toHaveBeenCalledTimes(calls);
  h.ipcRenderer.invoke.mockResolvedValue({ success: true } as never);
  expect(await h.bridge.commands.copyMessage(id)).toBe(false);
});

it("exposes execution-limit methods and preserves mutation uncertainty across service cessation", async () => {
  const h = await load();
  const calls = [
    h.bridge.foundation.readExecutionLimits(),
    h.bridge.foundation.replaceExecutionLimits(
      { operationId: "limit-change", value: 2 },
      "service-1",
    ),
    h.bridge.foundation.readExecutionLimitsReceipt("limit-change"),
  ];
  expect(h.ipcRenderer.send.mock.calls.map(([, text]) => JSON.parse(text).operation)).toEqual([
    "limits.read",
    "limits.replace",
    "limits.receipt",
  ]);
  h.ipcRenderer.emit(desktopChannels.ended, {}, "service-1");
  for (const [index, call] of calls.entries())
    expect(await call.result).toMatchObject({
      error: { code: index === 1 ? "uncertain" : "disposed" },
    });
  h.window.dispatchEvent(new Event("unload"));
  expect(h.ipcRenderer.listenerCount(desktopChannels.reply)).toBe(0);
});

it("forwards composer operations across the sandbox bridge and preserves uncertain Stops on unload", async () => {
  const h = await load();
  const projectId = "019a8000-0000-7000-8000-000000000001";
  const conversationId = "019a8000-0000-7000-8000-000000000002";
  const calls = [
    h.bridge.foundation.stopConversation("stop-conversation", { conversationId }),
    h.bridge.foundation.stopTask("stop-task", { taskId: conversationId }),
    h.bridge.foundation.readDestination({ projectId, conversationId }),
  ];
  expect(h.ipcRenderer.send.mock.calls.map(([, text]) => JSON.parse(text).operation)).toEqual([
    "conversation.stop",
    "task.stop",
    "destination.read",
  ]);
  h.window.dispatchEvent(new Event("unload"));
  expect(await calls[0]!.result).toMatchObject({ error: { code: "uncertain" } });
  expect(await calls[1]!.result).toMatchObject({ error: { code: "uncertain" } });
  expect(await calls[2]!.result).toMatchObject({ error: { code: "disposed" } });
});

it("carries the notice pause read and four idempotent actions through the sandbox entry", async () => {
  const h = await load();
  const taskId = "019a8000-0000-7000-8000-000000000001";
  const port = h.bridge.foundation;
  const calls = [
    port.readPauses(),
    port.tryAgainTask("try", { taskId }),
    port.startAgainTask("restart", { taskId }),
    port.resumeUsagePause("resume", { connection: "chatgpt" }),
    port.continueAllTasks("continue"),
  ];
  const requests = h.ipcRenderer.send.mock.calls.map(([, text]) => JSON.parse(text));
  expect(requests.map((request) => request.operation)).toEqual([
    "pause.read",
    "task.tryAgain",
    "task.startAgain",
    "usagePause.resume",
    "task.continueAll",
  ]);
  expect(requests.slice(1).map((request) => request.operationId)).toEqual([
    "try",
    "restart",
    "resume",
    "continue",
  ]);
  for (const [index, request] of requests.entries())
    h.ipcRenderer.emit(
      desktopChannels.reply,
      {},
      JSON.stringify({
        ...request,
        kind: "result",
        payload: {
          ok: true,
          value:
            index === 0
              ? { revision: 1, restart: 2, usage: [{ connection: "chatgpt", count: 3 }] }
              : { resultId: taskId },
        },
      }),
    );
  for (const call of calls) expect((await call.result).ok).toBe(true);
  h.window.dispatchEvent(new Event("unload"));
});

it("forwards consultation decisions and contribution retries with their original receipts", async () => {
  const h = await load();
  const taskId = "019a8000-0000-7000-8000-000000000001";
  const proposalId = "019a8000-0000-7000-8000-000000000002";
  const port = h.bridge.foundation;
  const calls = [
    port.acceptConsultation("accept", { proposalId, connection: "chatgpt" }),
    port.declineConsultation("decline", { proposalId }),
    port.tryAgainContribution("retry", { taskId }),
    port.startAgainContribution("restart", { taskId }),
  ];
  const finish = port.finishPlan("finish", { planId: proposalId });
  const requests = h.ipcRenderer.send.mock.calls.map(([, text]) => JSON.parse(text));
  expect(
    requests.map(({ operation, operationId, payload }) => [operation, operationId, payload]),
  ).toEqual([
    ["consultation.accept", "accept", { proposalId, connection: "chatgpt" }],
    ["consultation.decline", "decline", { proposalId }],
    ["contribution.tryAgain", "retry", { taskId }],
    ["contribution.startAgain", "restart", { taskId }],
    ["plan.finish", "finish", { planId: proposalId }],
  ]);
  h.ipcRenderer.emit(
    desktopChannels.reply,
    {},
    JSON.stringify({
      ...requests.at(-1),
      kind: "result",
      payload: { ok: true, value: { resultId: proposalId, outcome: "partial" } },
    }),
  );
  expect(await finish.result).toEqual({
    ok: true,
    value: { resultId: proposalId, outcome: "partial" },
  });
  h.window.dispatchEvent(new Event("unload"));
  for (const call of calls) expect(await call.result).toEqual(failure("uncertain"));
});
