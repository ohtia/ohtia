import { TextStaging, digest } from "../packages/utility/src/research-text.js";
import { ConversationController } from "../packages/renderer/src/conversation-controller.js";
import { PortAdmission } from "../packages/main/src/port-admission.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import { storageFixture } from "./fixtures/storage.js";
import { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopBrokerServices } from "../packages/main/src/shutdown.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import {
  encodeEnvelope,
  splitText,
  failure,
  desktopDocument,
  type Outcome,
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
    expect(h.child.send).toHaveBeenCalledTimes(4);
    expect(
      h.child.send.mock.calls.some(([text]) => JSON.parse(text).kind === "research_window_closed"),
    ).toBe(true);
    h.service.control({
      protocol: 1,
      policy: policyId,
      kind: "unsubscribe",
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
      subscriptionId: "absent",
    });
    expect(h.child.send).toHaveBeenCalledTimes(4);
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
    observePauseCounts: vi.fn(() => () => {}),
    readExecutionLimits: vi.fn(async () => ({
      ok: true,
      value: {
        serviceGeneration: "service-1",
        revision: 2,
        max_concurrent_inference: 10,
        running: 0,
      },
    })),
    replaceExecutionLimits: vi.fn(async () => ({
      ok: true,
      value: {
        serviceGeneration: "service-1",
        revision: 3,
        max_concurrent_inference: 2,
        running: 0,
      },
    })),
    readExecutionLimitsReceipt: vi.fn(async () => ({ ok: true, value: { state: "not_found" } })),
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
  it.each([
    "appearance.read",
    "appearance.replace",
    "limits.read",
    "limits.replace",
    "limits.receipt",
  ])("turns an asynchronous %s failure into a controlled result", async (operation) => {
    const h = serviceFixture();
    h.service.activate("en-US");
    h.store.readAppearance.mockRejectedValueOnce(new Error("Synthetic storage failure"));
    h.store.replaceAppearance.mockRejectedValueOnce(new Error("Synthetic commit failure"));
    h.store.readExecutionLimits.mockRejectedValueOnce(new Error("Synthetic read failure"));
    h.store.replaceExecutionLimits.mockRejectedValueOnce(new Error("Synthetic commit failure"));
    h.store.readExecutionLimitsReceipt.mockRejectedValueOnce(
      new Error("Synthetic receipt failure"),
    );
    h.receive({
      operation,
      payload:
        operation === "appearance.replace"
          ? { expectedRevision: 2, value: "light" }
          : operation === "limits.replace"
            ? { value: 2 }
            : operation === "limits.receipt"
              ? { targetOperationId: "limit-change" }
              : {},
    });
    await h.service.drain();
    expect(h.sent.at(-1)).toMatchObject({
      payload: {
        ok: false,
        error: { code: operation.endsWith(".replace") ? "uncertain" : "storage_failed" },
      },
    });
  });
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

it("sends a non-orderly shutdown through the existing broker stop boundary", async () => {
  const h = supervisor();
  const stopped = stopBrokerServices(h.service, undefined, undefined, () => false);
  await Promise.resolve();
  expect(h.child.send).toHaveBeenCalledWith(
    JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: false }),
  );
  h.exited();
  expect(await stopped).toBe(true);
});

it("downgrades an already sent orderly shutdown when the operating system starts shutdown", async () => {
  const h = supervisor();
  const stopped = h.service.stop();
  expect(h.child.send).toHaveBeenLastCalledWith(
    JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: true }),
  );
  h.service.markSystemShutdown();
  expect(h.child.send).toHaveBeenLastCalledWith(
    JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: false }),
  );
  h.exited();
  expect(await stopped).toBe(true);
});

it("admits only this generation's content-free exit counts on the private provider channel", async () => {
  const h = supervisor();
  const exitState = vi.fn();
  h.service.connectProvider({ dispatch: vi.fn(), interrupt: vi.fn(), exitState });
  const state = {
    kind: "application_exit_state",
    generation: "service-1",
    operationId: "exit-1",
    running: 2,
    held: true,
    cancelled: false,
    failed: false,
  };
  h.receive(JSON.stringify(state));
  expect(exitState).toHaveBeenCalledExactlyOnceWith(state);
  h.receive(JSON.stringify({ ...state, generation: "old" }));
  expect(exitState).toHaveBeenCalledExactlyOnceWith(state);
  h.service.markSystemShutdown();
  const stopped = h.service.stop();
  expect(h.child.send).toHaveBeenLastCalledWith(
    JSON.stringify({ kind: "shutdown", generation: "service-1", orderly: false }),
  );
  h.exited();
  expect(await stopped).toBe(true);
  h.service.markSystemShutdown();
});

async function integratedResearch() {
  const fixture = storageFixture();
  await fixture.store.open();
  const h = supervisor();
  vi.useRealTimers();
  const pool = new PortAdmission();
  const sender = { frame: {}, url: desktopDocument };
  expect(
    pool.attach({ ...sender, windowGeneration: "window-1", serviceGeneration: "service-1" }).ok,
  ).toBe(true);
  let receive: (text: unknown) => void = () => {};
  let counter = 0;
  const held: string[] = [];
  let hold = false;
  const peer = createStatusService(
    "service-1",
    "en-US",
    (text) => h.receive(text),
    fixture.store,
    undefined,
    "development",
  );
  peer.activate("en-US");
  h.child.send.mockImplementation((text: string) => {
    if (hold && JSON.parse(text).kind === "unsubscribe") held.push(text);
    else peer.receive(text);
  });
  const client = createFoundationPort(
    { contextIsolated: true, sandboxed: true },
    {
      listen: (fn) => {
        receive = fn;
        return () => {};
      },
      send: (text) => {
        const authority = pool.authorize(sender, text);
        if (!authority.ok) throw new Error(authority.error.code);
        if (authority.value.kind !== "request") {
          h.service.control(authority.value);
          return;
        }
        const admitted = pool.admit(sender, text);
        if (!admitted.ok) {
          receive(wire({ ...authority.value, kind: "result", payload: admitted }));
          return;
        }
        h.service.dispatch({ ...admitted.value, deliver: (raw) => receive(raw) });
      },
    },
    {
      after: (ms, fn) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
    },
    {
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
      nextId: () => `integration-${++counter}`,
    },
  );
  const unwrap = <T>(r: Outcome<T>): T => {
    if (!r.ok) throw new Error(r.error.code);
    return r.value;
  };
  const project = unwrap(await client.port.createProject("integration-project").result);
  const conversation = unwrap(
    await client.port.listConversations({ projectId: project.resultId, cursor: null, count: 50 })
      .result,
  ).items[0]!;
  return {
    ...h,
    ...fixture,
    peer,
    port: client.port,
    scope: { projectId: project.resultId, conversationId: conversation.id },
    conversation,
    unwrap,
    holdDisposal() {
      hold = true;
    },
    heldDisposals() {
      return held.length;
    },
    releaseDisposal() {
      hold = false;
      for (const text of held.splice(0)) peer.receive(text);
    },
    dispose() {
      client.dispose();
      peer.dispose();
      h.exited();
    },
  };
}
it.each(["unsubscribe", "window-close"] as const)(
  "fences in-flight research publication before %s acknowledges disposal to main",
  async (mode) => {
    const h = await integratedResearch();
    try {
      const stream = h.port.subscribeResearch(h.scope, () => {});
      h.unwrap(await stream.ready);
      const original = h.store.researchRevisions.bind(h.store);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const revisions = vi
        .spyOn(h.store, "researchRevisions")
        .mockImplementationOnce(async (scope) => {
          await gate;
          return original(scope);
        });
      h.unwrap(
        await h.port.renameConversation("integration-rename", {
          conversationId: h.conversation.id,
          title: "Synthetic updated title",
          expectedUpdatedAt: h.conversation.updatedAt,
        }).result,
      );
      await vi.waitFor(() => expect(revisions).toHaveBeenCalled());
      if (mode === "unsubscribe") stream.dispose();
      else h.service.disposeWindow("window-1");
      release();
      await h.peer.drain();
      expect(h.child.kill).not.toHaveBeenCalled();
      if (mode === "unsubscribe") expect((await h.port.readStatus().result).ok).toBe(true);
    } finally {
      h.dispose();
    }
  },
);
it("keeps all four main subscription reservations until disposal and then admits the fresh research identity", async () => {
  const h = await integratedResearch();
  try {
    const research = h.port.subscribeResearch(h.scope, () => {});
    h.unwrap(await research.ready);
    const others = Array.from({ length: 3 }, () => h.port.subscribeStatus(() => {}));
    for (const stream of others) h.unwrap(await stream.ready);
    h.holdDisposal();
    research.dispose();
    const rejected = h.port.subscribeResearch(h.scope, () => {});
    expect(await rejected.ready).toEqual(failure("busy"));
    h.releaseDisposal();
    const next = h.port.subscribeResearch(h.scope, () => {});
    expect((await next.ready).ok).toBe(true);
    expect(h.child.kill).not.toHaveBeenCalled();
    next.dispose();
    for (const stream of others) stream.dispose();
  } finally {
    h.dispose();
  }
});
it("returns timeout for a slow research read while retaining accepted capacity until generation cessation", async () => {
  const h = supervisor();
  const pending = work({ operation: "project.list", payload: { cursor: null, count: 40 } });
  h.service.dispatch(pending);
  await vi.advanceTimersByTimeAsync(portLimits.request_deadline_ms);
  expect(pending.deliver).toHaveBeenCalledWith(expect.stringContaining('"code":"timeout"'));
  expect(pending.release).not.toHaveBeenCalled();
  expect(h.child.kill).toHaveBeenCalledOnce();
  h.exited();
  expect(pending.release).toHaveBeenCalledOnce();
});

it("recovers a conversation replacement through main while all four subscription slots are occupied", async () => {
  const h = await integratedResearch();
  const controller = new ConversationController(h.port);
  try {
    const others = Array.from({ length: 3 }, () => h.port.subscribeStatus(() => {}));
    for (const stream of others) h.unwrap(await stream.ready);
    const reads = vi.spyOn(h.store, "readResearch");
    controller.open(h.scope);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    const pages = () =>
      reads.mock.calls.filter(([request]) => request.operation === "timeline.listBefore").length;
    expect(pages()).toBe(1);
    h.holdDisposal();
    controller.reload();
    await vi.waitFor(() => expect(h.heldDisposals()).toBe(1));
    expect(pages()).toBe(1);
    expect(controller.snapshot().status).toBe("ready");
    h.releaseDisposal();
    await vi.waitFor(() => expect(pages()).toBe(2));
    expect(controller.snapshot().status).toBe("ready");
    expect(h.child.kill).not.toHaveBeenCalled();
    controller.dispose();
    for (const stream of others) stream.dispose();
  } finally {
    controller.dispose();
    h.dispose();
  }
});

async function suspendResearchRead(h: Awaited<ReturnType<typeof integratedResearch>>) {
  const original = h.store.readResearch.bind(h.store);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.spyOn(h.store, "readResearch").mockImplementationOnce(async (request) => {
    await gate;
    return original(request);
  });
  const call = h.port.listProjects({ cursor: null, count: 40 });
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  return { release, call };
}
it("discards queued parts after window closure without recreating an abandoned upload", async () => {
  const h = await integratedResearch();
  const part = vi.spyOn(TextStaging.prototype, "part");
  try {
    const blocked = await suspendResearchRead(h);
    const text = "x".repeat(5000);
    const parts = splitText(text);
    const descriptor = { parts: parts.length, bytes: 5000, sha256: digest(text) };
    const upload = h.port.sendTextPart("queued-upload", {
      index: 1,
      count: parts.length,
      bytes: 5000,
      sha256: descriptor.sha256,
      text: parts[0]!,
    });
    h.service.disposeWindow("window-1");
    blocked.release();
    await blocked.call.result;
    await upload.result;
    await h.peer.drain();
    const staging = part.mock.contexts[0] as TextStaging;
    expect(
      staging.part("window-1", "queued-upload", {
        index: 2,
        count: parts.length,
        bytes: 5000,
        sha256: descriptor.sha256,
        text: parts[1]!,
      }).ok,
    ).toBe(true);
    expect(staging.take("window-1", "queued-upload", descriptor)).toEqual(
      failure("parts_incomplete"),
    );
    expect(h.child.kill).not.toHaveBeenCalled();
  } finally {
    part.mockRestore();
    h.dispose();
  }
});
it("preserves parts for an already-accepted multipart command before cleaning the closed window", async () => {
  const h = await integratedResearch();
  try {
    const text = "한".repeat(2000);
    const parts = splitText(text);
    const descriptor = { parts: parts.length, bytes: 6000, sha256: digest(text) };
    for (let index = 0; index < parts.length; index++)
      h.unwrap(
        await h.port.sendTextPart("closing-append", {
          index: index + 1,
          count: parts.length,
          bytes: 6000,
          sha256: descriptor.sha256,
          text: parts[index]!,
        }).result,
      );
    const blocked = await suspendResearchRead(h);
    const append = h.port.appendMessage("closing-append", {
      conversationId: h.conversation.id,
      content: descriptor,
    });
    h.service.disposeWindow("window-1");
    blocked.release();
    await blocked.call.result;
    h.unwrap(await append.result);
    await h.peer.drain();
    expect(h.unwrap(await h.store.readMessages(h.conversation.id))[0]?.content).toBe(text);
    expect(h.child.kill).not.toHaveBeenCalled();
  } finally {
    h.dispose();
  }
});

it("retains an admitted execution-limit mutation as uncertain until its service exits", () => {
  const h = supervisor();
  const pending = work({ operation: "limits.replace", payload: { value: 2 } });
  h.service.dispatch(pending);
  expect(pending.deliver).not.toHaveBeenCalled();
  h.exited();
  expect(pending.deliver).toHaveBeenCalledOnce();
  expect(JSON.parse(pending.deliver.mock.calls[0]![0])).toMatchObject({
    payload: { ok: false, error: { code: "uncertain" } },
  });
  expect(pending.release).toHaveBeenCalledOnce();
  h.exited();
  expect(pending.release).toHaveBeenCalledOnce();
});
