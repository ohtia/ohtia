import { afterEach, describe, expect, it, vi } from "vitest";
import { providerConformance } from "./fixtures/provider-conformance.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { ConnectionBroker } from "../packages/main/src/connection-broker.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { createStatusService } from "../packages/utility/src/status-service.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import {
  decodeEnvelope,
  decodeText,
  decodeConnectionReport,
  isConnectionSnapshot,
  isProviderDeclaration,
  policyId,
  portLimits,
  type ProviderModel,
  type ConnectionEvent,
  type Request,
  type ModelPage,
  type Outcome,
} from "../packages/contracts/src/index.js";
import type { CredentialRead, StoredSession } from "../packages/main/src/credential-store.js";
import type { SignInResult } from "../packages/main/src/provider-adapter.js";
providerConformance("fake", createFakeProvider);
afterEach(() => {
  vi.useRealTimers();
});
const flush = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
function peer(manager: ConnectionManager) {
  const broker = new ConnectionBroker(manager, () => {});
  let receive!: (text: unknown) => void;
  let number = 0;
  const messages: string[] = [];
  let releases = 0;
  let subscriptions = 0;
  const client = createFoundationPort(
    { contextIsolated: true, sandboxed: true },
    {
      listen: (listener) => {
        receive = listener;
        return () => {};
      },
      send: (text) => {
        messages.push(text);
        const decoded = decodeText(text);
        if (!decoded.ok) throw new Error("Bad test input");
        if (decoded.value.kind !== "request") {
          broker.control(decoded.value);
          return;
        }
        broker.handle({
          request: decoded.value,
          deliver: receive,
          release: () => {
            releases++;
          },
          releaseSubscription: () => {
            subscriptions++;
          },
        });
      },
    },
    {
      after: (ms, callback) => {
        const timer = setTimeout(callback, ms);
        return () => {
          clearTimeout(timer);
        };
      },
    },
    { windowGeneration: "window", serviceGeneration: "service", nextId: () => `id-${++number}` },
  );
  return {
    ...client,
    broker,
    messages,
    releases: () => releases,
    subscriptions: () => subscriptions,
  };
}
describe("main-only connection operations", () => {
  it("crosses the actual named client and broker without data-service work or receipts", async () => {
    vi.useFakeTimers();
    const adapter = createFakeProvider();
    const deleted = vi.spyOn(adapter.credentials, "delete");
    const manager = new ConnectionManager([adapter]);
    const p = peer(manager);
    const events: Outcome<ConnectionEvent>[] = [];
    const subscription = p.port.subscribeConnection("fake", (event) => {
      events.push(event);
    });
    expect((await subscription.ready).ok).toBe(true);
    expect(await p.port.readConnection("fake").result).toMatchObject({
      value: { state: "disconnected" },
    });
    expect(await p.port.connectConnection("fake").result).toMatchObject({
      value: { state: "connecting" },
    });
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual(
      expect.objectContaining({ value: expect.objectContaining({ state: "connected" }) }),
    );
    expect(await p.port.probeConnection("fake").result).toMatchObject({ value: { probing: true } });
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      await p.port.listConnectionModels({
        connection: "fake",
        model_list_revision: 1,
        cursor: 0,
        count: 128,
      }).result,
    ).toMatchObject({
      value: { models: [{ id: "fake-model", name: "Fake model" }], hasMore: false },
    });
    expect(await p.port.disconnectConnection("fake").result).toMatchObject({
      value: { state: "disconnected" },
    });
    expect(await p.port.disconnectConnection("fake").result).toMatchObject({
      value: { state: "disconnected" },
    });
    expect(deleted).toHaveBeenCalledOnce();
    subscription.dispose();
    expect(p.subscriptions()).toBeGreaterThan(0);
    expect(JSON.stringify(p.messages)).not.toContain("synthetic-session");
    p.dispose();
    p.broker.dispose();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pages 1500 long models within every actual wire limit and detects stale revisions", () => {
    const manager = new ConnectionManager([createFakeProvider()]);
    const models = Array.from({ length: 1500 }, (_, n) => ({
      id: `${n}`.padEnd(256, "i"),
      name: "n".repeat(256),
    }));
    expect(manager.storeModels("fake", models)).toBe(true);
    const received: ProviderModel[] = [];
    let cursor = 0;
    do {
      const outcome = manager.listModels({
        connection: "fake",
        model_list_revision: 1,
        cursor,
        count: 128,
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) break;
      const page = outcome.value;
      const wire = {
        protocol: 1,
        policy: policyId,
        kind: "result",
        requestId: "r",
        operationId: "o",
        windowGeneration: "w",
        serviceGeneration: "s",
        operation: "connection.listModels",
        payload: outcome,
      };
      expect(decodeEnvelope(wire).ok).toBe(true);
      received.push(...page.models);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (true);
    expect(received).toEqual(models);
    expect(manager.storeModels("fake", [])).toBe(true);
    expect(
      manager.listModels({ connection: "fake", model_list_revision: 1, cursor: 0, count: 128 }),
    ).toMatchObject({ error: { code: "stale_revision", parameters: { currentRevision: 2 } } });
    expect(manager.storeModels("fake", [{ id: "oversize", name: "x".repeat(4097) }])).toBe(false);
    expect(manager.snapshot("fake")?.model_list_revision).toBe(2);
    expect(
      manager.listModels({ connection: "fake", model_list_revision: 2, cursor: 0, count: 128 }),
    ).toMatchObject({ value: { models: [], hasMore: false } });
    manager.dispose();
  });
  it("times out exactly once at the policy deadline and discards a late result", async () => {
    vi.useFakeTimers();
    let answer!: (models: readonly ProviderModel[]) => void;
    const manager = new ConnectionManager([
      createFakeProvider({
        probe: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }),
    ]);
    manager.connect("fake");
    await flush();
    const events: ConnectionEvent[] = [];
    manager.subscribe((event) => {
      events.push(event);
    });
    manager.probe("fake");
    await flush();
    await vi.advanceTimersByTimeAsync(portLimits.connection_probe_ms - 1);
    expect(manager.snapshot("fake")?.probing).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.filter((event) => event.kind === "probe_result")).toMatchObject([
      { outcome: "unreachable", model_list_revision: null },
    ]);
    answer([{ id: "late", name: "Late" }]);
    await flush();
    expect(manager.snapshot("fake")?.model_list_revision).toBeNull();
    manager.dispose();
  });
  it("revokes late sign-in and probe completions after disconnect", async () => {
    let answer!: (result: SignInResult) => void;
    const manager = new ConnectionManager([
      createFakeProvider({
        connect: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }),
    ]);
    manager.connect("fake");
    await flush();
    await manager.disconnect("fake");
    answer({ state: "connected", session: { credential: "late-session", reason: null } });
    await flush();
    expect(await manager.read("fake")).toMatchObject({ value: { state: "disconnected" } });
    manager.dispose();
  });
  it("rediscovers store failure and restores persisted reasons across restart", async () => {
    let unavailable = false;
    const session = { credential: "synthetic-private", reason: "plan_use_not_allowed" as const };
    const adapter = createFakeProvider({
      credentials: {
        read: () =>
          Promise.resolve(
            unavailable ? { status: "unavailable" } : { status: "stored", value: session },
          ),
        write: () => Promise.resolve({ status: "unavailable" }),
        delete: () => Promise.resolve({ status: "unavailable" }),
      },
    });
    const manager = new ConnectionManager([adapter]);
    expect(await manager.read("fake")).toMatchObject({
      value: { state: "error", reason: "plan_use_not_allowed" },
    });
    unavailable = true;
    expect(await manager.read("fake")).toMatchObject({
      value: { state: "error", reason: "store_unavailable" },
    });
    unavailable = false;
    expect(await manager.read("fake")).toMatchObject({ value: { reason: "plan_use_not_allowed" } });
    const restarted = new ConnectionManager([adapter]);
    expect(await restarted.read("fake")).toMatchObject({
      value: { reason: "plan_use_not_allowed" },
    });
    manager.dispose();
    restarted.dispose();
  });
  it("rejects unknown connections and malformed state, reason and model requests", async () => {
    const manager = new ConnectionManager([createFakeProvider()]);
    expect((await manager.read("unknown")).ok).toBe(false);
    expect(manager.connect("unknown").ok).toBe(false);
    expect(manager.probe("unknown").ok).toBe(false);
    expect((await manager.disconnect("unknown")).ok).toBe(false);
    for (const [state, reason] of [
      ["connected", "store_unavailable"],
      ["expired", "sign_in_rejected"],
      ["error", "sign_in_timeout"],
      ["error", "arbitrary"],
    ])
      expect(isConnectionSnapshot({ ...manager.snapshot("fake"), state, reason })).toBe(false);
    expect(
      isProviderDeclaration({ ...createFakeProvider().declaration, signInModes: ["public"] }),
    ).toBe(false);
    for (const count of [0, 129, -1, 1.5])
      expect(
        manager.listModels({ connection: "fake", model_list_revision: 1, cursor: 0, count }).ok,
      ).toBe(false);
    expect(manager.declarations()).toEqual([]);
    manager.dispose();
  });
  it("reports only states and complete model pages on the supervised channel", async () => {
    vi.useFakeTimers();
    const manager = new ConnectionManager([createFakeProvider()]);
    manager.connect("fake");
    await flush();
    expect(
      manager.storeModels(
        "fake",
        Array.from({ length: 1500 }, (_, n) => ({ id: `model-${n}`, name: `Model ${n}` })),
      ),
    ).toBe(true);
    let incoming!: (text: unknown) => void;
    const sent: string[] = [];
    const supervisor = new ServiceSupervisor(
      {
        send: (text) => {
          sent.push(text);
        },
        kill() {},
        messages: (listener) => {
          incoming = listener;
        },
        exited() {},
      },
      "service",
      () => {},
    );
    incoming(JSON.stringify({ kind: "ready", generation: "service" }));
    expect(supervisor.reportConnections(manager)).toBe(true);
    const service = createStatusService("service", "en-US", () => {});
    for (const text of sent) {
      expect(decodeConnectionReport(text, "service")).toBeDefined();
      service.receive(text);
    }
    expect(service.connections.read("fake")?.models).toHaveLength(1500);
    expect(service.connections.available("fake")).toBe(true);
    expect(sent.join("")).not.toContain("credential");
    expect(sent.join("")).not.toContain("synthetic-session");
    const request = {
      protocol: 1,
      policy: policyId,
      kind: "request",
      requestId: "r",
      operationId: "o",
      windowGeneration: "w",
      serviceGeneration: "service",
      operation: "connection.connect",
      payload: { connection: "fake" },
    } as Request;
    const beforeDispatch = sent.length;
    supervisor.dispatch({ request, deliver() {}, release() {}, releaseSubscription() {} });
    expect(sent).toHaveLength(beforeDispatch);
    expect(sent.some((text) => text.includes("connection.connect"))).toBe(false);
    service.dispose();
    manager.dispose();
  });
});

describe("connection failure and ownership fences", () => {
  it("does not invent a service rejection for an unclassified adapter exception", async () => {
    const diagnostics: unknown[] = [];
    const manager = new ConnectionManager(
      [
        createFakeProvider({
          connect: () => Promise.reject(new Error("synthetic-provider-private-message")),
        }),
      ],
      (event) => {
        diagnostics.push(event);
      },
    );
    manager.connect("fake");
    await flush();
    expect(manager.snapshot("fake")).toMatchObject({ state: "error", reason: null });
    expect(JSON.stringify(diagnostics)).not.toContain("synthetic-provider-private-message");
    expect(diagnostics).toContainEqual({
      event_name: "ohtia.connection.failed",
      error_code: "connection_failed",
    });
    manager.dispose();
  });
  it("does not connect when persistence fails and rediscovers store unavailability before sign-in", async () => {
    const connect = vi.fn(() =>
      Promise.resolve({
        state: "connected" as const,
        session: { credential: "private-synthetic", reason: null },
      }),
    );
    let unavailable = true;
    const manager = new ConnectionManager([
      createFakeProvider({
        connect,
        credentials: {
          read: () =>
            Promise.resolve(unavailable ? { status: "unavailable" } : { status: "absent" }),
          write: () => Promise.resolve({ status: "unavailable" }),
          delete: () => Promise.resolve({ status: "unavailable" }),
        },
      }),
    ]);
    manager.connect("fake");
    await flush();
    expect(connect).not.toHaveBeenCalled();
    expect(manager.snapshot("fake")?.reason).toBe("store_unavailable");
    unavailable = false;
    manager.connect("fake");
    await flush();
    expect(connect).toHaveBeenCalledOnce();
    expect(manager.snapshot("fake")?.state).toBe("error");
    expect(await manager.disconnect("fake")).toMatchObject({
      value: { state: "error", reason: "store_unavailable" },
    });
    manager.dispose();
  });
  it("restores unusable sessions as expired and preserves only a kept session's classified reason", async () => {
    const credentials = {
      read: () => Promise.resolve({ status: "unusable" as const }),
      write: vi.fn(() => Promise.resolve({ status: "stored" as const })),
      delete: () => Promise.resolve({ status: "stored" as const }),
    };
    const manager = new ConnectionManager([
      createFakeProvider({
        credentials,
        connect: () =>
          Promise.resolve({
            state: "error",
            reason: "plan_use_not_allowed",
            session: { credential: "private-synthetic", reason: null },
          }),
      }),
    ]);
    expect(await manager.read("fake")).toMatchObject({ value: { state: "expired", reason: null } });
    manager.connect("fake");
    await flush();
    expect(credentials.write).toHaveBeenCalledWith({
      credential: "private-synthetic",
      reason: "plan_use_not_allowed",
    });
    manager.dispose();
  });
  it("ends a probe when disconnected and discards its late answer", async () => {
    let answer!: (models: readonly ProviderModel[]) => void;
    const manager = new ConnectionManager([
      createFakeProvider({
        probe: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }),
    ]);
    manager.connect("fake");
    await flush();
    const events: ConnectionEvent[] = [];
    manager.subscribe((event) => {
      events.push(event);
    });
    manager.probe("fake");
    await flush();
    await manager.disconnect("fake");
    answer([{ id: "late", name: "Late" }]);
    await flush();
    expect(events.filter((event) => event.kind === "probe_result")).toMatchObject([
      { outcome: "unreachable" },
    ]);
    expect(manager.snapshot("fake")?.model_list_revision).toBeNull();
    manager.dispose();
  });
  it("rejects malformed lists atomically and preserves a prior complete list after probe failure", async () => {
    const manager = new ConnectionManager([
      createFakeProvider({ probe: () => Promise.reject(new Error("private-error")) }),
    ]);
    expect(manager.storeModels("fake", [{ id: "original", name: "Original" }])).toBe(true);
    for (const models of [
      [
        { id: "valid", name: "Valid" },
        { id: "", name: "Invalid" },
      ],
      null,
      {},
    ])
      expect(manager.storeModels("fake", models as readonly ProviderModel[])).toBe(false);
    expect(manager.storeModels("unknown", [])).toBe(false);
    manager.connect("fake");
    await flush();
    manager.probe("fake");
    await flush();
    expect(manager.snapshot("fake")).toMatchObject({
      model_list_revision: 1,
      model_count: 1,
      probing: false,
    });
    expect(
      manager.listModels({ connection: "fake", model_list_revision: 1, cursor: 2, count: 1 }).ok,
    ).toBe(false);
    manager.dispose();
  });
  it("rejects invalid and duplicate declarations and disposes work without reviving it", async () => {
    const adapter = createFakeProvider();
    expect(() => new ConnectionManager([adapter, adapter])).toThrow("Duplicate");
    expect(() => new ConnectionManager([{ ...adapter, declaration: {} } as never])).toThrow(
      "Invalid",
    );
    const manager = new ConnectionManager([adapter]);
    const broker = new ConnectionBroker(manager);
    const release = vi.fn();
    const releaseSubscription = vi.fn();
    const deliver = vi.fn();
    const request = {
      protocol: 1,
      policy: policyId,
      kind: "request",
      requestId: "r",
      operationId: "o",
      windowGeneration: "w",
      serviceGeneration: "s",
      operation: "connection.subscribe",
      payload: { connection: "fake", subscriptionId: "stream" },
    } as Request;
    broker.handle({ request, release, releaseSubscription, deliver });
    broker.disposeWindow("w");
    expect(releaseSubscription).toHaveBeenCalledOnce();
    expect(
      broker.handle({
        request: { ...request, operation: "status.read", payload: {} } as Request,
        release,
        releaseSubscription,
        deliver,
      }),
    ).toBe(false);
    broker.dispose();
    expect(manager.connect("fake").ok).toBe(false);
    expect((await manager.read("fake")).ok).toBe(false);
  });
  it("cleans an active subscription and reports slow credential reads under the port deadline", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const adapter = createFakeProvider({
      credentials: {
        read: () =>
          new Promise((resolve) => {
            finish = () => {
              resolve({ status: "absent" });
            };
          }),
        write: () => Promise.resolve({ status: "stored" }),
        delete: () => Promise.resolve({ status: "stored" }),
      },
    });
    const manager = new ConnectionManager([adapter]);
    const p = peer(manager);
    const subscription = p.port.subscribeConnection("fake", () => {});
    await subscription.ready;
    const read = p.port.readConnection("fake");
    await vi.advanceTimersByTimeAsync(portLimits.request_deadline_ms);
    expect(await read.result).toMatchObject({ error: { code: "timeout" } });
    finish();
    await flush();
    subscription.dispose();
    p.dispose();
    p.broker.dispose();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("classifies both probe outcomes and store failures with closed diagnostic events", async () => {
  let unavailable = false;
  let rejectProbe = false;
  let session: { credential: string; reason: null } | undefined;
  const diagnostics: unknown[] = [];
  const adapter = createFakeProvider({
    credentials: {
      read: () =>
        Promise.resolve(
          unavailable
            ? { status: "unavailable" }
            : session
              ? { status: "stored", value: session }
              : { status: "absent" },
        ),
      write: (value) => {
        session = { credential: value.credential, reason: null };
        return Promise.resolve({ status: "stored" });
      },
      delete: () => {
        session = undefined;
        return Promise.resolve({ status: "stored" });
      },
    },
    probe: () =>
      rejectProbe
        ? Promise.reject(new Error("private-error"))
        : Promise.resolve([{ id: "model", name: "Model" }]),
  });
  const manager = new ConnectionManager([adapter], (event) => {
    diagnostics.push(event);
  });
  await manager.read("fake");
  manager.probe("fake");
  await flush();
  manager.connect("fake");
  await flush();
  manager.probe("fake");
  await flush();
  rejectProbe = true;
  manager.probe("fake");
  await flush();
  unavailable = true;
  manager.probe("fake");
  await flush();
  await manager.read("fake");
  unavailable = false;
  await manager.read("fake");
  await manager.disconnect("fake");
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      { event_name: "ohtia.connection.connected" },
      { event_name: "ohtia.connection.read" },
      { event_name: "ohtia.connection.probe_listed" },
      { event_name: "ohtia.connection.probe_unreachable", error_code: "probe_unreachable" },
      { event_name: "ohtia.connection.failed", error_code: "store_unavailable" },
      { event_name: "ohtia.connection.disconnect" },
    ]),
  );
  expect(JSON.stringify(diagnostics)).not.toContain("private-error");
  manager.dispose();
});

it("rejects model pages without the matching service snapshot and handles a failed reporting channel", () => {
  vi.useFakeTimers();
  const service = createStatusService("service", "en-US", () => {});
  expect(() =>
    service.receive(
      JSON.stringify({
        kind: "connection_models",
        generation: "service",
        page: {
          connection: "fake",
          model_list_revision: 1,
          models: [],
          nextCursor: 0,
          hasMore: false,
        },
      }),
    ),
  ).toThrow("Invalid connection report");
  expect(service.connections.read("fake")).toBeUndefined();
  service.dispose();
  let incoming!: (text: unknown) => void;
  let fail = false;
  const kill = vi.fn();
  const supervisor = new ServiceSupervisor(
    {
      send() {
        if (fail) throw new Error("channel-failure");
      },
      kill,
      messages: (listener) => {
        incoming = listener;
      },
      exited() {},
    },
    "service",
    () => {},
  );
  const manager = new ConnectionManager([createFakeProvider()]);
  expect(supervisor.reportConnections(manager)).toBe(false);
  incoming(JSON.stringify({ kind: "ready", generation: "service" }));
  expect(supervisor.reportConnections(manager)).toBe(true);
  fail = true;
  expect(supervisor.reportConnections(manager)).toBe(false);
  expect(kill).toHaveBeenCalledOnce();
  manager.dispose();
});

it("rejects model-page replies for another connection, revision, cursor or requested count", async () => {
  vi.useFakeTimers();
  let receive!: (text: unknown) => void;
  let current!: Request;
  let id = 0;
  const client = createFoundationPort(
    { contextIsolated: true, sandboxed: true },
    {
      listen: (listener) => {
        receive = listener;
        return () => {};
      },
      send: (text) => {
        const value = decodeText(text);
        if (value.ok && value.value.kind === "request") current = value.value;
      },
    },
    {
      after: (ms, callback) => {
        const timer = setTimeout(callback, ms);
        return () => {
          clearTimeout(timer);
        };
      },
    },
    { windowGeneration: "w", serviceGeneration: "s", nextId: () => `id-${++id}` },
  );
  const original = {
    connection: "fake",
    model_list_revision: 1,
    models: [{ id: "m", name: "Model" }],
    nextCursor: 1,
    hasMore: false,
  };
  for (const page of [
    { ...original, connection: "other" },
    { ...original, model_list_revision: 2 },
    { ...original, nextCursor: 2 },
    { ...original, models: [], nextCursor: 0, hasMore: true },
    { ...original, models: [original.models[0], original.models[0]], nextCursor: 2 },
  ]) {
    const call = client.port.listConnectionModels({
      connection: "fake",
      model_list_revision: 1,
      cursor: 0,
      count: 1,
    });
    receive(JSON.stringify({ ...current, kind: "result", payload: { ok: true, value: page } }));
    expect(await call.result).toMatchObject({ error: { code: "invalid_service_result" } });
  }
  client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("revokes service admission before delayed deletion and admits a new explicit connect", async () => {
  let session: { credential: string; reason: null } | undefined = {
    credential: "synthetic-original",
    reason: null,
  };
  let release!: () => void;
  let pending: Promise<void> | undefined;
  const deletion = vi.fn(() => {
    pending = new Promise<void>((resolve) => {
      release = () => {
        session = undefined;
        resolve();
      };
    });
    return pending.then(() => ({ status: "stored" as const }));
  });
  const adapter = createFakeProvider({
    credentials: {
      read: async () => {
        await pending;
        return session ? { status: "stored", value: session } : { status: "absent" };
      },
      write: (value) => {
        session = { credential: value.credential, reason: null };
        return Promise.resolve({ status: "stored" });
      },
      delete: deletion,
    },
  });
  const manager = new ConnectionManager([adapter]);
  const { ServiceConnections } = await import("../packages/contracts/src/index.js");
  const projection = new ServiceConnections();
  manager.subscribe(() => {
    const snapshot = manager.snapshot("fake");
    if (snapshot) projection.receive({ kind: "connection_state", generation: "s", snapshot });
  });
  await manager.read("fake");
  expect(projection.available("fake")).toBe(true);
  const signingOut = manager.disconnect("fake");
  expect(manager.snapshot("fake")?.state).toBe("disconnected");
  expect(projection.available("fake")).toBe(false);
  expect(await manager.disconnect("fake")).toMatchObject({ value: { state: "disconnected" } });
  expect(deletion).toHaveBeenCalledOnce();
  expect(manager.connect("fake")).toMatchObject({ value: { state: "connecting" } });
  release();
  await signingOut;
  await flush();
  expect(manager.snapshot("fake")?.state).toBe("connected");
  manager.dispose();
});

it("preserves every transient sign-in reason while store unavailability hides it", async () => {
  for (const reason of ["sign_in_timeout", "sign_in_rejected", "plan_use_not_allowed"] as const) {
    let unavailable = false;
    const credentials = {
      read: () =>
        Promise.resolve(
          unavailable ? { status: "unavailable" as const } : { status: "absent" as const },
        ),
      write: () => Promise.resolve({ status: "stored" as const }),
      delete: () => Promise.resolve({ status: "stored" as const }),
    };
    const adapter = createFakeProvider({
      credentials,
      connect: () =>
        Promise.resolve(
          reason === "sign_in_timeout"
            ? { state: "disconnected", reason }
            : { state: "error", reason },
        ),
    });
    const manager = new ConnectionManager([adapter]);
    manager.connect("fake");
    await flush();
    expect(manager.snapshot("fake")?.reason).toBe(reason);
    unavailable = true;
    expect(await manager.read("fake")).toMatchObject({
      value: { state: "error", reason: "store_unavailable" },
    });
    unavailable = false;
    expect(await manager.read("fake")).toMatchObject({
      value: { state: reason === "sign_in_timeout" ? "disconnected" : "error", reason },
    });
    const restarted = new ConnectionManager([adapter]);
    expect(await restarted.read("fake")).toMatchObject({ value: { reason: null } });
    await manager.disconnect("fake");
    expect(manager.snapshot("fake")?.reason).toBeNull();
    manager.dispose();
    restarted.dispose();
  }
});

it("reports one store failure per failed disconnect and bounds probes behind an unanswered store read", async () => {
  vi.useFakeTimers();
  let waiting = false;
  let complete!: () => void;
  const read = vi.fn(() =>
    waiting
      ? new Promise<{ status: "absent" }>((resolve) => {
          complete = () => {
            resolve({ status: "absent" });
          };
        })
      : Promise.resolve({
          status: "stored" as const,
          value: { credential: "synthetic-private", reason: null },
        }),
  );
  const events: unknown[] = [];
  const manager = new ConnectionManager(
    [
      createFakeProvider({
        credentials: {
          read,
          write: () => Promise.resolve({ status: "stored" }),
          delete: () => Promise.resolve({ status: "unavailable" }),
        },
      }),
    ],
    (event) => {
      events.push(event);
    },
  );
  await manager.read("fake");
  await manager.disconnect("fake");
  expect(events.filter((event: any) => event.event_name === "ohtia.connection.failed")).toEqual([
    { event_name: "ohtia.connection.failed", error_code: "store_unavailable" },
  ]);
  waiting = true;
  const before = read.mock.calls.length;
  manager.probe("fake");
  await flush();
  await vi.advanceTimersByTimeAsync(portLimits.connection_probe_ms);
  for (let n = 0; n < 4; n++) {
    manager.probe("fake");
    await flush();
  }
  expect(read).toHaveBeenCalledTimes(before + 1);
  expect(manager.snapshot("fake")?.probing).toBe(false);
  complete();
  await flush();
  manager.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps incomplete catalogues distinct from a complete empty list", async () => {
  const { ServiceConnections } = await import("../packages/contracts/src/index.js");
  const service = new ServiceConnections();
  const snapshot = {
    connection: "fake",
    state: "connected" as const,
    reason: null,
    probing: false,
    probe_id: null,
    model_list_revision: 1,
    model_count: 2,
  };
  service.receive({ kind: "connection_state", generation: "s", snapshot });
  expect(service.read("fake")?.models).toBeNull();
  service.receive({
    kind: "connection_models",
    generation: "s",
    page: {
      connection: "fake",
      model_list_revision: 1,
      models: [{ id: "a", name: "A" }],
      nextCursor: 1,
      hasMore: true,
    },
  });
  expect(service.read("fake")?.models).toBeNull();
  service.receive({
    kind: "connection_models",
    generation: "s",
    page: {
      connection: "fake",
      model_list_revision: 1,
      models: [{ id: "b", name: "B" }],
      nextCursor: 2,
      hasMore: false,
    },
  });
  expect(service.read("fake")?.models).toHaveLength(2);
  service.receive({
    kind: "connection_state",
    generation: "s",
    snapshot: { ...snapshot, model_list_revision: 2, model_count: 0 },
  });
  expect(service.read("fake")?.models).toBeNull();
  service.receive({
    kind: "connection_models",
    generation: "s",
    page: { connection: "fake", model_list_revision: 2, models: [], nextCursor: 0, hasMore: false },
  });
  expect(service.read("fake")?.models).toEqual([]);
});

it("publishes a newly persisted session reason and allows an admitted sign-in to persist after store recovery", async () => {
  let unavailable = false;
  let session: { credential: string; reason: "plan_use_not_allowed" | null } | undefined = {
    credential: "synthetic",
    reason: null,
  };
  let finish!: (result: SignInResult) => void;
  const manager = new ConnectionManager([
    createFakeProvider({
      credentials: {
        read: () =>
          Promise.resolve(
            unavailable
              ? { status: "unavailable" }
              : session
                ? { status: "stored", value: session }
                : { status: "absent" },
          ),
        write: (value) => {
          session = { credential: value.credential, reason: null };
          return Promise.resolve({ status: "stored" });
        },
        delete: () => {
          session = undefined;
          return Promise.resolve({ status: "stored" });
        },
      },
      connect: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  ]);
  await manager.read("fake");
  session.reason = "plan_use_not_allowed";
  expect(await manager.read("fake")).toMatchObject({
    value: { state: "error", reason: "plan_use_not_allowed" },
  });
  manager.connect("fake");
  await flush();
  unavailable = true;
  expect(await manager.read("fake")).toMatchObject({ value: { reason: "store_unavailable" } });
  unavailable = false;
  finish({ state: "connected", session: { credential: "synthetic-new", reason: null } });
  await flush();
  expect(manager.snapshot("fake")).toMatchObject({ state: "connected", reason: null });
  manager.dispose();
});

it("emits one unreachable result when a provider model cannot be parsed", async () => {
  const broken = {
    get id(): string {
      throw new Error("private-parser-error");
    },
    name: "Invalid",
  };
  const manager = new ConnectionManager([
    createFakeProvider({ probe: () => Promise.resolve([broken]) }),
  ]);
  manager.connect("fake");
  await flush();
  const events: ConnectionEvent[] = [];
  manager.subscribe((event) => {
    events.push(event);
  });
  manager.probe("fake");
  await flush();
  expect(events.filter((event) => event.kind === "probe_result")).toMatchObject([
    { outcome: "unreachable", model_list_revision: null },
  ]);
  expect(manager.snapshot("fake")?.probing).toBe(false);
  manager.dispose();
});

it("retries a failed sign-out after store recovery and removes the session across restart", async () => {
  const { ServiceConnections } = await import("../packages/contracts/src/index.js");
  const projection = new ServiceConnections();
  const events: ConnectionEvent[] = [];
  let session: StoredSession | undefined = { credential: "synthetic-private", reason: null };
  let fail = true;
  const deletion = vi.fn(() => {
    if (fail) return Promise.resolve({ status: "unavailable" as const });
    session = undefined;
    return Promise.resolve({ status: "stored" as const });
  });
  const adapter = createFakeProvider({
    credentials: {
      read: () =>
        Promise.resolve(session ? { status: "stored", value: session } : { status: "absent" }),
      write: (value) => {
        session = value;
        return Promise.resolve({ status: "stored" });
      },
      delete: deletion,
    },
  });
  const manager = new ConnectionManager([adapter]);
  manager.subscribe((snapshot) => {
    events.push(snapshot);
    projection.receive({ kind: "connection_state", generation: "s", snapshot });
  });
  await manager.read("fake");
  expect(projection.read("fake")?.state).toBe("connected");
  expect(await manager.disconnect("fake")).toMatchObject({
    value: { state: "error", reason: "store_unavailable" },
  });
  expect(projection.read("fake")?.state).toBe("error");
  fail = false;
  expect(await manager.read("fake")).toMatchObject({
    value: { state: "error", reason: "store_unavailable" },
  });
  expect(projection.read("fake")?.state).toBe("error");
  manager.probe("fake");
  await flush();
  expect(manager.snapshot("fake")).toMatchObject({ state: "error", reason: "store_unavailable" });
  expect(projection.read("fake")?.state).toBe("error");
  expect(await manager.disconnect("fake")).toMatchObject({
    value: { state: "disconnected", reason: null },
  });
  expect(events.at(-1)).toMatchObject({ state: "disconnected", reason: null });
  expect(projection.read("fake")?.state).toBe("disconnected");
  expect(deletion).toHaveBeenCalledTimes(2);
  await manager.disconnect("fake");
  expect(events.at(-1)).toMatchObject({ state: "disconnected", reason: null });
  expect(projection.read("fake")?.state).toBe("disconnected");
  expect(deletion).toHaveBeenCalledTimes(2);
  const restarted = new ConnectionManager([adapter]);
  expect(await restarted.read("fake")).toMatchObject({
    value: { state: "disconnected", reason: null },
  });
  manager.dispose();
  restarted.dispose();
});

it("keeps task admission revoked when a probe recovers storage without a usable session", async () => {
  const { ServiceConnections } = await import("../packages/contracts/src/index.js");
  const recoveries: CredentialRead<StoredSession>[] = [
    { status: "absent" },
    { status: "unusable" },
    { status: "stored", value: { credential: "synthetic", reason: "sign_in_rejected" } },
    { status: "stored", value: { credential: "synthetic", reason: "plan_use_not_allowed" } },
  ];
  for (const recovery of recoveries) {
    let stored: CredentialRead<StoredSession> = {
      status: "stored",
      value: { credential: "synthetic", reason: null },
    };
    const adapter = createFakeProvider({
      credentials: {
        read: () => Promise.resolve(stored),
        write: () => Promise.resolve({ status: "stored" }),
        delete: () => Promise.resolve({ status: "stored" }),
      },
    });
    const manager = new ConnectionManager([adapter]);
    const projection = new ServiceConnections();
    manager.subscribe((snapshot) => {
      projection.receive({ kind: "connection_state", generation: "s", snapshot });
    });
    await manager.read("fake");
    expect(projection.available("fake")).toBe(true);
    stored = { status: "unavailable" };
    await manager.read("fake");
    expect(projection.available("fake")).toBe(false);
    stored = recovery;
    const events: ConnectionEvent[] = [];
    manager.subscribe((event) => {
      events.push(event);
    });
    manager.probe("fake");
    await flush();
    expect(events.filter((event) => event.kind === "probe_result")).toMatchObject([
      { outcome: "unreachable" },
    ]);
    expect(projection.available("fake")).toBe(false);
    expect(manager.snapshot("fake")).toMatchObject(
      recovery.status === "stored"
        ? { state: "error", reason: recovery.value.reason }
        : { state: recovery.status === "unusable" ? "expired" : "disconnected", reason: null },
    );
    manager.dispose();
  }
});

it("rejects missing probe model lists and retains the last complete catalogue", async () => {
  for (const models of [null, undefined]) {
    const manager = new ConnectionManager([
      createFakeProvider({
        probe: () => Promise.resolve(models as unknown as readonly ProviderModel[]),
      }),
    ]);
    manager.connect("fake");
    await flush();
    manager.storeModels("fake", [{ id: "kept", name: "Kept" }]);
    const events: ConnectionEvent[] = [];
    manager.subscribe((event) => {
      events.push(event);
    });
    manager.probe("fake");
    await flush();
    expect(events.filter((event) => event.kind === "probe_result")).toMatchObject([
      { outcome: "unreachable", model_list_revision: 1, model_count: 1 },
    ]);
    expect(
      manager.listModels({ connection: "fake", model_list_revision: 1, cursor: 0, count: 1 }),
    ).toMatchObject({
      value: { models: [{ id: "kept", name: "Kept" }], hasMore: false },
    });
    manager.dispose();
  }
});
