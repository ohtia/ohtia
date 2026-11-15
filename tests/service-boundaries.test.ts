import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopBrokerServices } from "../packages/main/src/shutdown.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import {
  encodeEnvelope,
  policyId,
  portLimits,
  type Envelope,
  type LocaleSnapshot,
  type PresentationSnapshot,
} from "../packages/contracts/src/index.js";
import type { DurableStore } from "../packages/utility/src/storage.js";
import {
  request,
  status,
  appearance,
  presentationSnapshot,
  localeSnapshot,
} from "./fixtures/port-corpus.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
function wire(value: unknown) {
  const encoded = encodeEnvelope(value);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded));
  return encoded.value;
}
function supervisor(
  localeChanged?: (snapshot: LocaleSnapshot) => void,
  presentationChanged?: (snapshot: PresentationSnapshot) => void,
) {
  vi.useFakeTimers();
  let receive: (value: unknown) => void = () => {};
  let exited: () => void = () => {};
  const child = {
    send: vi.fn(),
    kill: vi.fn(),
    messages: (listener: typeof receive) => {
      receive = listener;
    },
    exited: (listener: typeof exited) => {
      exited = listener;
    },
  };
  const state = vi.fn();
  const storage = vi.fn();
  const service = new ServiceSupervisor(
    child,
    "service-1",
    state,
    storage,
    false,
    undefined,
    localeChanged,
    presentationChanged,
  );
  receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
  return {
    child,
    state,
    storage,
    service,
    receive: (value: unknown) => receive(value),
    exited: () => exited(),
  };
}
function work(overrides = {}) {
  return {
    request: request(overrides),
    deliver: vi.fn(),
    release: vi.fn(),
    releaseSubscription: vi.fn(),
  };
}
function event(topic: "status" | "appearance" = "status", subscriptionId = "subscription-1") {
  return {
    protocol: 1,
    policy: policyId,
    kind: "event",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    subscriptionId,
    sequence: 1,
    topic,
    payload: topic === "status" ? status : appearance,
  };
}

describe("supervised stream authority and cessation", () => {
  it("routes both stream topics and keeps disposal capacity until the service acknowledgement", () => {
    const h = supervisor();
    for (const topic of ["status", "appearance"] as const) {
      const pending = work({
        operation: `${topic}.subscribe`,
        requestId: `request-${topic}`,
        payload: { subscriptionId: `subscription-${topic}` },
      });
      h.service.dispatch(pending);
      h.receive(
        wire({
          ...pending.request,
          kind: "result",
          payload: { ok: true, value: pending.request.payload },
        }),
      );
      h.receive(wire(event(topic, `subscription-${topic}`)));
      expect(pending.deliver).toHaveBeenCalledTimes(2);
      h.service.disposeWindow("other-window");
      expect(pending.releaseSubscription).not.toHaveBeenCalled();
      h.service.disposeWindow("window-1");
      expect(JSON.parse(h.child.send.mock.calls.at(-1)![0]).kind).toBe("unsubscribe");
      expect(pending.releaseSubscription).not.toHaveBeenCalled();
      h.receive(
        JSON.stringify({
          kind: "stream_disposed",
          generation: "service-1",
          windowGeneration: "window-1",
          subscriptionId: `subscription-${topic}`,
        }),
      );
      expect(pending.releaseSubscription).toHaveBeenCalledOnce();
    }
    h.exited();
    h.exited();
    expect(h.service.ceased).toBe(true);
  });
  it("forwards only matching cancellation and active unsubscribe authority", () => {
    const h = supervisor();
    const pending = work();
    h.service.dispatch(pending);
    const cancel = { ...pending.request, kind: "cancel" };
    delete cancel.payload;
    h.service.control({ ...cancel, serviceGeneration: "other" } as Envelope);
    h.service.control({ ...cancel, operationId: "other" } as Envelope);
    h.service.control({ ...cancel, requestId: "unknown" } as Envelope);
    h.service.control(pending.request);
    expect(h.child.send).toHaveBeenCalledOnce();
    h.service.control(cancel as Envelope);
    expect(h.child.send).toHaveBeenCalledTimes(2);
    h.service.disposeWindow("window-1");
    expect(h.child.send).toHaveBeenCalledTimes(3);
    h.service.control({
      protocol: 1,
      policy: policyId,
      kind: "unsubscribe",
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
      subscriptionId: "absent",
    });
    expect(h.child.send).toHaveBeenCalledTimes(3);
  });
  it.each(["wrong-result", "wrong-topic", "missing-stream", "duplicate-ready", "malformed"])(
    "quarantines %s without releasing accepted work until exit",
    (kind) => {
      const h = supervisor();
      const pending = work({
        operation: "status.subscribe",
        payload: { subscriptionId: "subscription-1" },
      });
      h.service.dispatch(pending);
      if (kind === "wrong-result")
        h.receive(
          wire({
            ...pending.request,
            operationId: "different",
            kind: "result",
            payload: { ok: true, value: pending.request.payload },
          }),
        );
      else if (kind === "wrong-topic") h.receive(wire(event("appearance")));
      else if (kind === "missing-stream") h.receive(wire(event("status", "unknown")));
      else if (kind === "duplicate-ready")
        h.receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
      else h.receive("not-json");
      expect(h.service.recoveryRequired).toBe(true);
      expect(h.child.kill).toHaveBeenCalledOnce();
      expect(pending.release).not.toHaveBeenCalled();
      h.exited();
      expect(pending.release).toHaveBeenCalledOnce();
      expect(pending.releaseSubscription).toHaveBeenCalled();
      h.receive(wire(event()));
      expect(h.child.kill).toHaveBeenCalledOnce();
    },
  );
  it("ignores stale generations and unknown results, and releases a rejected subscription", () => {
    const h = supervisor();
    const pending = work({
      operation: "appearance.subscribe",
      payload: { subscriptionId: "subscription-1" },
    });
    h.service.dispatch(pending);
    // Use the canonical failure constructor through a real encoded service response.
    const failed = createStatusService("service-1", "en-US", (text) => h.receive(text));
    h.receive(
      wire({
        ...pending.request,
        requestId: "unknown",
        kind: "result",
        payload: { ok: true, value: pending.request.payload },
      }),
    );
    h.receive(
      wire({
        ...pending.request,
        serviceGeneration: "stale",
        kind: "result",
        payload: { ok: true, value: pending.request.payload },
      }),
    );
    expect(h.child.kill).not.toHaveBeenCalled();
    failed.receive(wire(pending.request));
    expect(pending.releaseSubscription).toHaveBeenCalledOnce();
    expect(pending.release).toHaveBeenCalledOnce();
  });
  it("keeps an activation send failure quarantined and does not reauthorize a dead child", () => {
    const h = supervisor();
    expect(h.service.activateStorage("en-US")).toBe(false);
    h.receive(JSON.stringify({ kind: "storage", generation: "service-1", state: "storage_ready" }));
    h.child.send.mockImplementation(() => {
      throw new Error("Synthetic transport failure");
    });
    expect(h.service.activateStorage("en-US")).toBe(false);
    expect(h.service.recoveryRequired).toBe(true);
    const pending = work();
    h.service.dispatch(pending);
    expect(pending.release).toHaveBeenCalledOnce();
    h.exited();
  });
});

function serviceFixture(mode: "installed" | "development" = "installed") {
  const sent: unknown[] = [];
  let value = appearance;
  const store = {
    ready: true,
    admissionReady: true,
    setTaskContext: vi.fn(),
    stoppingAttempts: vi.fn(async () => ({ ok: true, value: [] })),
    prepareTask: vi.fn(async () => ({ ok: true, value: null })),
    readAppearance: vi.fn(async () => ({ ok: true, value })),
    replaceAppearance: vi.fn(async () => ({ ok: true, value })),
    readReceipt: vi.fn(async () => ({ ok: true, value: { state: "absent" } })),
  };
  const lost = vi.fn();
  const service = createStatusService(
    "service-1",
    "en-US",
    (text) => {
      sent.push(JSON.parse(text));
    },
    store as unknown as DurableStore,
    lost,
    mode,
  );
  return {
    service,
    store,
    lost,
    sent,
    value: (next: typeof appearance) => {
      value = next;
    },
    receive: (overrides = {}) => service.receive(wire(request(overrides))),
  };
}
function unsub(id = "subscription-1") {
  return wire({
    protocol: 1,
    policy: policyId,
    kind: "unsubscribe",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    subscriptionId: id,
  });
}
describe("service admission and queued subscription failures", () => {
  it("rejects unsupported locale, malformed broker direction and activation without admitted storage", () => {
    expect(() => createStatusService("service-1", "xx-XX" as never, () => {})).toThrow();
    const h = serviceFixture();
    expect(() => h.service.receive("bad")).toThrow(/broker/);
    expect(() => h.service.receive(wire(event()))).toThrow(/direction/);
    h.store.ready = false;
    expect(() => h.service.activate("en-US")).toThrow(/activation/);
    h.store.ready = true;
    h.service.dispose();
    expect(() => h.service.activate("en-US")).toThrow();
    h.receive();
    expect(h.sent).toEqual([]);
  });
  it("updates status subscriptions on activation and reports lost admission", () => {
    const h = serviceFixture();
    h.receive({ operation: "status.subscribe", payload: { subscriptionId: "status-1" } });
    h.service.activate("ko-KR");
    expect(h.sent.at(-1)).toMatchObject({
      kind: "event",
      topic: "status",
      sequence: 2,
      payload: { interfaceLocale: "ko-KR", engine: "verified" },
    });
    h.store.admissionReady = false;
    h.receive();
    expect(h.lost).toHaveBeenCalledOnce();
    expect(h.sent.at(-1)).toMatchObject({ payload: { value: { engine: "unavailable" } } });
  });
  it("enforces per-window subscription capacity and rejects duplicates", () => {
    const h = serviceFixture();
    for (let i = 0; i < portLimits.subscriptions_per_window; i++)
      h.receive({
        operation: "status.subscribe",
        requestId: `request-${i}`,
        payload: { subscriptionId: `subscription-${i}` },
      });
    h.receive({ operation: "status.subscribe", payload: { subscriptionId: "overflow" } });
    expect(h.sent.at(-1)).toMatchObject({ payload: { ok: false, error: { code: "busy" } } });
    h.receive({ operation: "status.subscribe", payload: { subscriptionId: "subscription-0" } });
    expect(h.sent.at(-1)).toMatchObject({ payload: { ok: false, error: { code: "busy" } } });
    h.service.receive(unsub("subscription-0"));
    expect(h.sent.at(-1)).toMatchObject({ kind: "stream_disposed" });
  });
  it("cancels a queued subscription before storage work and rejects duplicate queued identities", async () => {
    const h = serviceFixture();
    h.service.activate("en-US");
    h.receive({ operation: "appearance.subscribe", payload: { subscriptionId: "subscription-1" } });
    h.receive({
      operation: "appearance.subscribe",
      requestId: "duplicate",
      payload: { subscriptionId: "subscription-1" },
    });
    expect(h.sent.at(-1)).toMatchObject({ payload: { error: { code: "busy" } } });
    h.service.receive(unsub());
    await h.service.drain();
    expect(h.store.readAppearance).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatchObject({ payload: { error: { code: "cancelled" } } });
  });
  it.each(["cancel", "dispose", "read-failure"])(
    "handles %s while the initial appearance read is pending",
    async (kind) => {
      const h = serviceFixture();
      h.service.activate("en-US");
      await h.service.drain();
      let resolve: (value: unknown) => void = () => {};
      h.store.readAppearance.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }) as never,
      );
      h.receive({
        operation: "appearance.subscribe",
        payload: { subscriptionId: "subscription-1" },
      });
      await Promise.resolve();
      if (kind === "cancel") h.service.receive(unsub());
      if (kind === "dispose") h.service.dispose();
      const before = h.sent.length;
      resolve(
        kind === "read-failure"
          ? {
              ok: false,
              error: { code: "storage_failed", retryable: false, message: "storage_failed" },
            }
          : { ok: true, value: appearance },
      );
      await h.service.drain();
      if (kind === "dispose") expect(h.sent).toHaveLength(before);
      else
        expect(h.sent.at(-1)).toMatchObject({
          payload: {
            ok: false,
            error: { code: kind === "cancel" ? "cancelled" : "storage_failed" },
          },
        });
    },
  );
  it.each(["appearance.read", "appearance.replace"])(
    "turns an asynchronous %s failure into a controlled result",
    async (operation) => {
      const h = serviceFixture();
      h.service.activate("en-US");
      h.store.readAppearance.mockRejectedValueOnce(new Error("Synthetic storage failure"));
      h.store.replaceAppearance.mockRejectedValueOnce(new Error("Synthetic commit failure"));
      h.receive({
        operation,
        payload: operation === "appearance.replace" ? { expectedRevision: 2, value: "light" } : {},
      });
      await h.service.drain();
      expect(h.sent.at(-1)).toMatchObject({
        payload: {
          ok: false,
          error: { code: operation === "appearance.replace" ? "uncertain" : "storage_failed" },
        },
      });
    },
  );
  it("bounds pending work independently of a successful process and restores admission after draining", async () => {
    const h = serviceFixture();
    h.service.activate("en-US");
    for (let i = 0; i <= portLimits.pending_global; i++)
      h.receive({ requestId: `queued-${i}`, operation: "appearance.read" });
    expect(h.sent.at(-1)).toMatchObject({ payload: { error: { code: "busy" } } });
    await h.service.drain();
    expect(h.store.readAppearance).toHaveBeenCalledTimes(portLimits.pending_global);
    h.store.ready = false;
    h.receive({ operation: "appearance.read" });
    await h.service.drain();
    expect(h.sent.at(-1)).toMatchObject({ payload: { error: { code: "service_unavailable" } } });
  });
});

describe("trusted locale authority wiring", () => {
  const snapshot: LocaleSnapshot = {
    serviceGeneration: "service-1",
    record: { schemaVersion: 1, revision: 1, value: "ko-KR", source: "saved" },
    systemLocale: "en-US",
    effectiveLocale: "ko-KR",
  };
  it("publishes locale state independently of a view subscription and rechecks system-locale controls", () => {
    const changed = vi.fn();
    const h = supervisor(changed);
    expect(h.service.setSystemLocale("en-GB")).toBe(true);
    expect(h.child.send).toHaveBeenLastCalledWith(
      JSON.stringify({ kind: "system_locale", generation: "service-1", locale: "en-GB" }),
    );
    expect(h.service.setSystemLocale("nn-NO" as never)).toBe(false);
    h.receive(JSON.stringify({ kind: "locale_changed", generation: "service-1", snapshot }));
    expect(changed).toHaveBeenCalledWith(snapshot);
    const read = work({ operation: "locale.read" });
    h.service.dispatch(read);
    h.receive(wire({ ...read.request, kind: "result", payload: { ok: true, value: snapshot } }));
    const stream = work({ operation: "locale.subscribe", payload: { subscriptionId: "language" } });
    h.service.dispatch(stream);
    h.receive(
      wire({
        ...stream.request,
        kind: "result",
        payload: { ok: true, value: { subscriptionId: "language" } },
      }),
    );
    h.receive(wire({ ...event(), topic: "locale", subscriptionId: "language", payload: snapshot }));
    expect(stream.deliver).toHaveBeenCalledTimes(2);
    h.service.disposeWindow("window-1");
    h.exited();
    expect(stream.releaseSubscription).toHaveBeenCalled();
  });
  it("quarantines malformed locale snapshots and retains uncertain locale commands until exit", () => {
    const h = supervisor();
    const pending = work({
      operation: "locale.replace",
      payload: { expectedRevision: 0, value: "system" },
    });
    h.service.dispatch(pending);
    h.receive(
      JSON.stringify({
        kind: "locale_changed",
        generation: "service-1",
        snapshot: { ...snapshot, effectiveLocale: "nn-NO" },
      }),
    );
    expect(h.child.kill).toHaveBeenCalled();
    h.exited();
    expect(JSON.parse(pending.deliver.mock.calls[0][0])).toMatchObject({
      payload: { error: { code: "uncertain" } },
    });
    expect(h.service.setSystemLocale("en-US")).toBe(false);
    const sendFailure = supervisor();
    sendFailure.child.send.mockImplementation(() => {
      throw new Error("Synthetic transport failure");
    });
    expect(sendFailure.service.setSystemLocale("en-US")).toBe(false);
    sendFailure.exited();
  });
});

describe("trusted presentation publication", () => {
  it("validates a private snapshot independently of view subscriptions and quarantines a forged generation", () => {
    const changed = vi.fn();
    const h = supervisor(undefined, changed);
    h.receive(
      JSON.stringify({
        kind: "presentation_changed",
        generation: "service-1",
        snapshot: presentationSnapshot,
      }),
    );
    expect(changed).toHaveBeenCalledWith(presentationSnapshot);
    h.receive(
      JSON.stringify({
        kind: "presentation_changed",
        generation: "service-1",
        snapshot: { ...presentationSnapshot, serviceGeneration: "old-service" },
      }),
    );
    expect(h.service.recoveryRequired).toBe(true);
    h.exited();
  });
  it("routes the bounded presentation stream and releases it on producer disposal", () => {
    const changed = vi.fn();
    const h = supervisor(undefined, changed);
    const stream = work({
      operation: "presentation.subscribe",
      payload: { subscriptionId: "presentation" },
    });
    h.service.dispatch(stream);
    h.receive(
      wire({
        ...stream.request,
        kind: "result",
        payload: { ok: true, value: { subscriptionId: "presentation" } },
      }),
    );
    h.receive(
      wire({
        protocol: 1,
        policy: policyId,
        kind: "event",
        windowGeneration: "window-1",
        serviceGeneration: "service-1",
        subscriptionId: "presentation",
        sequence: 1,
        topic: "presentation",
        payload: presentationSnapshot,
      }),
    );
    expect(stream.deliver).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledWith(presentationSnapshot);
    h.service.disposeWindow("window-1");
    h.receive(
      JSON.stringify({
        kind: "stream_disposed",
        generation: "service-1",
        windowGeneration: "window-1",
        subscriptionId: "presentation",
      }),
    );
    expect(stream.releaseSubscription).toHaveBeenCalledOnce();
    h.exited();
  });
});

it("quarantines a locale event delivered on a presentation subscription", () => {
  const h = supervisor();
  const stream = work({
    operation: "presentation.subscribe",
    payload: { subscriptionId: "presentation" },
  });
  h.service.dispatch(stream);
  h.receive(
    wire({
      ...stream.request,
      kind: "result",
      payload: { ok: true, value: { subscriptionId: "presentation" } },
    }),
  );
  h.receive(
    wire({ ...event(), topic: "locale", subscriptionId: "presentation", payload: localeSnapshot }),
  );
  expect(h.service.recoveryRequired).toBe(true);
  expect(h.child.kill).toHaveBeenCalledOnce();
  expect(stream.releaseSubscription).not.toHaveBeenCalled();
  h.exited();
  expect(stream.releaseSubscription).toHaveBeenCalled();
});

it.each(["provider_event", "connection_state", "development_action"] as const)(
  "owns an asynchronous %s fault before any queued window command can consume it",
  async (kind) => {
    const h = serviceFixture("development");
    h.service.activate("en-US");
    const method =
      kind === "provider_event"
        ? "receive"
        : kind === "connection_state"
          ? "pump"
          : "developmentAction";
    const fault = vi
      .spyOn(DurableProvider.prototype, method)
      .mockRejectedValueOnce(new Error("Synthetic provider peer failure."));
    try {
      const message =
        kind === "provider_event"
          ? {
              kind,
              version: 1,
              generation: "service-1",
              attempt: "attempt-1",
              event: { type: "result", sequence: 1, result: { status: "completed" } },
            }
          : kind === "connection_state"
            ? {
                kind,
                generation: "service-1",
                snapshot: {
                  connection: "chatgpt",
                  state: "connected",
                  reason: null,
                  probing: false,
                  probe_id: null,
                  model_list_revision: null,
                  model_count: 0,
                },
              }
            : {
                kind,
                version: 1,
                generation: "service-1",
                action: { name: "create-development-project", operation_id: "create" },
              };
      h.service.receive(JSON.stringify(message));
      h.receive({
        operation: "appearance.replace",
        payload: { expectedRevision: 0, value: "dark" },
      });
      await h.service.drain();
      expect(h.lost).toHaveBeenCalledOnce();
      expect(h.store.replaceAppearance).not.toHaveBeenCalled();
      expect(h.sent.at(-1)).toMatchObject({
        kind: "result",
        payload: { ok: false, error: { code: "service_unavailable" } },
      });
      h.receive({ operation: "appearance.read", payload: {}, requestId: "later-read" });
      await h.service.drain();
      expect(h.store.readAppearance).not.toHaveBeenCalled();
      expect(h.sent.at(-1)).toMatchObject({ payload: { error: { code: "service_unavailable" } } });
      expect(() => h.service.activate("en-US")).toThrow();
    } finally {
      fault.mockRestore();
      h.service.dispose();
    }
  },
);

it("owns a provider fault without a queued window command and keeps a throwing observer unavailable", async () => {
  const h = serviceFixture();
  h.service.activate("en-US");
  h.lost.mockImplementation(() => {
    throw new Error("Synthetic observer failure.");
  });
  const failed = vi
    .spyOn(DurableProvider.prototype, "receive")
    .mockRejectedValueOnce(new Error("Synthetic storage failure."));
  try {
    h.service.receive(
      JSON.stringify({
        kind: "provider_event",
        version: 1,
        generation: "service-1",
        attempt: "a",
        event: { type: "result", sequence: 1, result: { status: "completed" } },
      }),
    );
    await expect(h.service.drain()).resolves.toBeUndefined();
    expect(h.lost).toHaveBeenCalledOnce();
    h.receive();
    expect(h.sent.at(-1)).toMatchObject({
      payload: { ok: true, value: { service: "unavailable", engine: "unavailable" } },
    });
    h.receive({ operation: "appearance.read", payload: {} });
    await h.service.drain();
    expect(h.store.readAppearance).not.toHaveBeenCalled();
  } finally {
    failed.mockRestore();
    h.service.dispose();
  }
});

it("does not announce a late asynchronous provider fault after the service was disposed", async () => {
  const h = serviceFixture();
  h.service.activate("en-US");
  await h.service.drain();
  let reject!: (error: Error) => void;
  const pending = vi.spyOn(DurableProvider.prototype, "receive").mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  try {
    h.service.receive(
      JSON.stringify({
        kind: "provider_event",
        version: 1,
        generation: "service-1",
        attempt: "a",
        event: { type: "result", sequence: 1, result: { status: "completed" } },
      }),
    );
    await Promise.resolve();
    h.service.dispose();
    reject(new Error("Synthetic late storage failure."));
    await expect(h.service.drain()).resolves.toBeUndefined();
    expect(h.lost).not.toHaveBeenCalled();
  } finally {
    pending.mockRestore();
    h.service.dispose();
  }
});

it("queues wake reviews before ready and releases only after every ordered echo", () => {
  let receive!: (text: unknown) => void;
  let exit!: () => void;
  const child = {
    send: vi.fn(),
    kill: vi.fn(),
    messages: (listener: typeof receive) => {
      receive = listener;
    },
    exited: (listener: typeof exit) => {
      exit = listener;
    },
  };
  const changed = vi.fn();
  const service = new ServiceSupervisor(child, "service-1", changed);
  const reviewed = vi.fn();
  service.connectProvider({ dispatch: vi.fn(), interrupt: vi.fn(), wakeReviewed: reviewed });
  const wake = {
    kind: "service_wake",
    version: 1,
    generation: "service-1",
    suspendedAt: "2026-11-14T20:00:00.000Z",
    resumedAt: "2026-11-14T20:01:00.000Z",
    asleepMs: 60000,
  };
  expect(service.postWake(JSON.stringify({ ...wake, generation: "old" }))).toBe(false);
  expect(service.postWake(JSON.stringify({ ...wake, credential: "synthetic" }))).toBe(false);
  expect(service.postWake(JSON.stringify(wake))).toBe(true);
  const latest = { ...wake, resumedAt: "2026-11-14T20:02:00.000Z", asleepMs: 120000 };
  expect(service.postWake(JSON.stringify(latest))).toBe(true);
  expect(child.send).not.toHaveBeenCalled();
  receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
  expect(child.send).toHaveBeenNthCalledWith(1, JSON.stringify(wake));
  expect(child.send).toHaveBeenNthCalledWith(2, JSON.stringify(latest));
  receive(JSON.stringify({ ...latest, generation: "old" }));
  expect(reviewed).not.toHaveBeenCalled();
  receive(JSON.stringify(wake));
  expect(reviewed).not.toHaveBeenCalled();
  receive(JSON.stringify(latest));
  expect(reviewed).toHaveBeenCalledExactlyOnceWith(latest);
  expect(service.postWake(JSON.stringify(wake))).toBe(true);
  expect(service.postWake(JSON.stringify(wake))).toBe(true);
  receive(JSON.stringify(wake));
  expect(reviewed).toHaveBeenCalledTimes(1);
  receive(JSON.stringify(wake));
  expect(reviewed).toHaveBeenCalledTimes(2);
  exit();
  expect(service.postWake(JSON.stringify(latest))).toBe(false);
});

it("bounds outstanding native wake reviews with the existing channel pending limit", () => {
  const h = supervisor();
  const text = JSON.stringify({
    kind: "service_wake",
    version: 1,
    generation: "service-1",
    suspendedAt: "2026-11-14T20:00:00.000Z",
    resumedAt: "2026-11-14T20:01:00.000Z",
    asleepMs: 60000,
  });
  for (let i = 0; i < portLimits.pending_global; i++) expect(h.service.postWake(text)).toBe(true);
  expect(h.service.postWake(text)).toBe(false);
  expect(h.service.recoveryRequired).toBe(true);
  h.exited();
});

it.each([
  "normal",
  "slow-provider",
  "slow-provider-total",
  "parent-expired",
  "parent-retry",
  "early-child-exit",
  "unproven-closure",
  "live-unproven-closure",
])("gates the orderly shutdown on provider closure: %s", async (ending) => {
  vi.useFakeTimers();
  let receive!: (text: unknown) => void;
  let exit!: () => void;
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const child = {
    send: vi.fn(),
    kill: vi.fn(),
    messages: (listener: typeof receive) => {
      receive = listener;
    },
    exited: (listener: typeof exit) => {
      exit = listener;
    },
  };
  const changed = vi.fn();
  const drain = vi.fn(() => closed);
  const service = new ServiceSupervisor(
    child,
    "service-1",
    changed,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    drain,
  );
  receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
  changed.mockClear();
  const stopped = ending.startsWith("parent-")
    ? stopBrokerServices(
        service,
        undefined,
        () => new Promise<void>((resolve) => setTimeout(resolve, 6000)),
      )
    : service.stop();
  if (ending.startsWith("parent-")) await vi.advanceTimersByTimeAsync(6000);
  if (ending === "normal") expect(service.stop()).toBe(stopped);
  let settled = false;
  void stopped.then(() => {
    settled = true;
  });
  expect(service.available).toBe(false);
  expect(changed).toHaveBeenCalledWith("unavailable", true);
  await vi.advanceTimersByTimeAsync(0);
  expect(drain).toHaveBeenCalledOnce();
  expect(child.send).not.toHaveBeenCalled();
  if (ending === "early-child-exit" || ending === "unproven-closure") exit();
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  if (ending.startsWith("parent-")) {
    await vi.advanceTimersByTimeAsync(4000);
    expect(await stopped).toBe(false);
    expect(child.send).not.toHaveBeenCalled();
    if (ending === "parent-retry") {
      await vi.advanceTimersByTimeAsync(1000);
      const retry = stopBrokerServices(service);
      await vi.advanceTimersByTimeAsync(1000);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(drain).toHaveBeenCalledOnce();
      expect(child.send).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: true }),
      );
      exit();
      expect(await retry).toBe(true);
    } else {
      await vi.advanceTimersByTimeAsync(500);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(child.send).not.toHaveBeenCalled();
      exit();
    }
  } else if (ending === "unproven-closure" || ending === "live-unproven-closure") {
    await vi.advanceTimersByTimeAsync(portLimits.shutdown_total_ms);
    expect(await stopped).toBe(false);
    expect(child.send).not.toHaveBeenCalled();
    if (ending === "live-unproven-closure") {
      expect(child.kill).toHaveBeenCalledOnce();
      exit();
    }
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(child.send).not.toHaveBeenCalled();
    expect(await service.stop()).toBe(true);
  } else {
    if (ending === "slow-provider" || ending === "slow-provider-total") {
      await vi.advanceTimersByTimeAsync(6000);
      expect(child.kill).not.toHaveBeenCalled();
    }
    release();
    await vi.advanceTimersByTimeAsync(0);
    if (ending === "normal" || ending === "slow-provider" || ending === "slow-provider-total") {
      expect(child.send).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: true }),
      );
      if (ending === "slow-provider-total") {
        await vi.advanceTimersByTimeAsync(4000);
        expect(await stopped).toBe(false);
        expect(child.kill).toHaveBeenCalledOnce();
        exit();
        return;
      }
      if (ending === "slow-provider") {
        await vi.advanceTimersByTimeAsync(500);
        expect(child.kill).not.toHaveBeenCalled();
      }
      exit();
    } else expect(child.send).not.toHaveBeenCalled();
    expect(await stopped).toBe(true);
  }
});

it("does not start a shutdown whose parent has already cancelled admission", async () => {
  const h = supervisor();
  expect(await h.service.stop(() => false)).toBe(false);
  expect(h.service.available).toBe(true);
  expect(h.child.send).not.toHaveBeenCalled();
  h.exited();
});

it.each(["requested", "unexpected"])(
  "bounds the closing diagnostic after %s service termination",
  async (termination) => {
    vi.useFakeTimers();
    let receive!: (text: unknown) => void;
    let exit!: () => void;
    let release!: () => void;
    const closed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const child = {
      send: vi.fn(),
      kill: vi.fn(),
      messages: (listener: typeof receive) => {
        receive = listener;
      },
      exited: (listener: typeof exit) => {
        exit = listener;
      },
    };
    const diagnostic = vi.fn();
    const service = new ServiceSupervisor(
      child,
      "service-1",
      vi.fn(),
      undefined,
      false,
      diagnostic,
      undefined,
      undefined,
      undefined,
      undefined,
      () => closed,
    );
    receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    const stopEvent = {
      kind: "diagnostic",
      generation: "service-1",
      event: { event_name: "ohtia.service.stopped" },
    };
    if (termination === "unexpected") {
      receive("invalid peer input");
      receive(JSON.stringify(stopEvent));
      expect(diagnostic).not.toHaveBeenCalled();
      exit();
      return;
    }
    const stopping = service.stop();
    receive(JSON.stringify(stopEvent));
    expect(diagnostic).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(child.send).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: true }),
    );
    receive(JSON.stringify({ ...stopEvent, generation: "old" }));
    receive(JSON.stringify({ ...stopEvent, event: { event_name: "ohtia.service.started" } }));
    receive(
      JSON.stringify({
        ...stopEvent,
        event: { ...stopEvent.event, content: "must not be admitted" },
      }),
    );
    receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    expect(diagnostic).not.toHaveBeenCalled();
    receive(JSON.stringify(stopEvent));
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(stopEvent.event);
    receive(JSON.stringify(stopEvent));
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    exit();
    expect(await stopping).toBe(true);
    receive(JSON.stringify(stopEvent));
    expect(diagnostic).toHaveBeenCalledOnce();
  },
);
