import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import {
  encodeEnvelope,
  policyId,
  portLimits,
  type Envelope,
} from "../packages/contracts/src/index.js";
import type { DurableStore } from "../packages/utility/src/storage.js";
import { request, status, appearance } from "./fixtures/port-corpus.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
function wire(value: unknown) {
  const encoded = encodeEnvelope(value);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded));
  return encoded.value;
}
function supervisor() {
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
  const service = new ServiceSupervisor(child, "service-1", state, storage);
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

function serviceFixture() {
  const sent: unknown[] = [];
  let value = appearance;
  const store = {
    ready: true,
    admissionReady: true,
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
