import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeEnvelope,
  decodeText,
  decodeUtf8,
  encodeEnvelope,
  errorActions,
  failure,
  policyId,
  operationErrorCodes,
  portLimits,
  staleRevision,
  supportedLocales,
  utf8Size,
  validateJsonBounds,
  type AppearanceRecord,
} from "../packages/contracts/dist/index.js";
import {
  applyAppearanceCommand,
  type AppearanceTransaction,
  type RecordedAppearanceCommand,
} from "../packages/domain/dist/index.js";
import { PortAdmission } from "../packages/main/dist/index.js";
import {
  createFoundationPort,
  type PortClock,
  type PortTransport,
} from "../packages/preload/dist/index.js";
import { generatePortPolicy } from "../tooling/port-policy.mjs";
import {
  acceptedEnvelopes,
  appearance,
  localeSnapshot,
  rejectedEnvelopes,
  rejectedResultPayloads,
  request,
  status,
} from "./fixtures/port-corpus.js";

const stringify = JSON.stringify;
afterEach(() => {
  vi.useRealTimers();
});

describe("P3 shared producer/consumer conformance corpus", () => {
  it.each(acceptedEnvelopes.map((value, index) => [index, value]))(
    "accepts and roundtrips envelope %s",
    (_, value) => {
      const encoded = encodeEnvelope(value);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) return;
      expect(decodeText(encoded.value)).toEqual({ ok: true, value });
      expect(decodeUtf8(new TextEncoder().encode(encoded.value))).toEqual({ ok: true, value });
    },
  );
  it.each(rejectedEnvelopes)("ipc-invalid: $name", ({ value, code }) => {
    expect(decodeEnvelope(value)).toMatchObject({ ok: false, error: { code } });
    expect(decodeText(stringify(value))).toMatchObject({ ok: false, error: { code } });
  });
  it("accepts only the controlled error codes and parameters declared for each operation", () => {
    for (const [operation, allowed] of Object.entries(operationErrorCodes)) {
      for (const code of Object.keys(errorActions)) {
        const payload =
          code === "stale_revision"
            ? staleRevision(42)
            : failure(code as Exclude<keyof typeof errorActions, "stale_revision">);
        expect(decodeEnvelope({ ...request(), operation, kind: "result", payload }).ok).toBe(
          allowed.includes(code as never),
        );
        expect(
          decodeEnvelope({
            ...request(),
            operation,
            kind: "result",
            payload: { ...payload, error: { ...payload.error, nextAction: "invented" } },
          }).ok,
        ).toBe(false);
      }
    }
  });
  it.each(rejectedResultPayloads)(
    "rejects contradictory appearance or receipt payload %#",
    ({ operation, value }) => {
      expect(
        decodeEnvelope({ ...request(), operation, kind: "result", payload: { ok: true, value } })
          .ok,
      ).toBe(false);
    },
  );
  it.each(supportedLocales)(
    "carries only supported broker-resolved locale %s",
    (interfaceLocale) => {
      expect(
        decodeEnvelope({
          ...request(),
          kind: "result",
          payload: { ok: true, value: { ...status, interfaceLocale } },
        }).ok,
      ).toBe(true);
    },
  );
  it("ipc-unknown-prototype: rejects inherited/symbol/getter/non-JSON authority without invoking accessors", () => {
    const getter = vi.fn(() => "secret");
    const values = [
      Object.assign(Object.create({ sender: "forged" }), request()),
      { ...request(), [Symbol("scope")]: true },
      Object.defineProperty(request(), "secret", { get: getter }),
      { ...request(), payload: new Date() },
      { ...request(), payload: undefined },
      JSON.parse('{"__proto__":{},"protocol":1}'),
    ];
    for (const value of values) expect(decodeEnvelope(value).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("ipc-utf8-boundary: counts encoded bytes, rejecting invalid Unicode and ambiguous JSON", () => {
    expect(utf8Size("aé한😀")).toBe(10);
    expect(validateJsonBounds("한".repeat(Math.floor(portLimits.string_bytes / 3))).ok).toBe(true);
    expect(validateJsonBounds("한".repeat(Math.floor(portLimits.string_bytes / 3) + 1)).ok).toBe(
      false,
    );
    expect(validateJsonBounds("a".repeat(portLimits.string_bytes)).ok).toBe(true);
    expect(validateJsonBounds("a".repeat(portLimits.string_bytes + 1)).ok).toBe(false);
    expect(validateJsonBounds("\ud800").ok).toBe(false);
    expect(
      decodeText(stringify(request()).replace('"protocol":1', '"protocol":2,"protocol":1')).ok,
    ).toBe(false);
    for (const bytes of [
      [0xc0, 0xaf],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xe2, 0x82],
      [0x80],
      [0xef, 0xbb, 0xbf, 0x7b, 0x7d],
    ])
      expect(decodeUtf8(new Uint8Array(bytes)).ok).toBe(false);
    expect(decodeUtf8(new Uint8Array(portLimits.message_bytes + 1)).ok).toBe(false);
  });
  it("ipc-depth-width: enforces exact depth, width, node and encoded-envelope byte limits", () => {
    let deep: unknown = 0;
    for (let i = 1; i < portLimits.message_depth; i++) deep = [deep];
    expect(validateJsonBounds(deep).ok).toBe(true);
    expect(validateJsonBounds([deep]).ok).toBe(false);
    expect(validateJsonBounds(Array(portLimits.container_items).fill(0)).ok).toBe(true);
    expect(validateJsonBounds(Array(portLimits.container_items + 1).fill(0)).ok).toBe(false);
    expect(validateJsonBounds(Array(4).fill(Array(127).fill(0))).ok).toBe(false);
    const wide = Object.fromEntries(
      Array.from({ length: portLimits.container_items }, (_, i) => [`key${i}`, 0]),
    );
    expect(validateJsonBounds(wide).ok).toBe(true);
    expect(validateJsonBounds({ ...wide, extra: 0 }).ok).toBe(false);
    expect(validateJsonBounds(Array(16).fill("a".repeat(portLimits.string_bytes))).ok).toBe(false);
    expect(
      validateJsonBounds([
        Array(127).fill(0),
        Array(127).fill(0),
        Array(127).fill(0),
        Array(126).fill(0),
      ]).ok,
    ).toBe(true);
    const exactBytes = Array(16).fill("a".repeat(portLimits.string_bytes));
    exactBytes[15] = "a".repeat(portLimits.string_bytes - 49);
    expect(utf8Size(stringify(exactBytes))).toBe(portLimits.message_bytes);
    expect(validateJsonBounds(exactBytes).ok).toBe(true);
    exactBytes[15] += "a";
    expect(validateJsonBounds(exactBytes).ok).toBe(false);
    const sparse = Array(2);
    sparse[1] = 0;
    expect(validateJsonBounds(sparse).ok).toBe(false);
    expect(
      decodeEnvelope({ ...request(), requestId: "a".repeat(portLimits.identifier_bytes) }).ok,
    ).toBe(true);
    expect(
      decodeEnvelope({ ...request(), requestId: "a".repeat(portLimits.identifier_bytes + 1) }).ok,
    ).toBe(false);
  });
  it("projects the canonical numeric record and refuses unsupported/malformed policy before compilation", () => {
    const policy = JSON.parse(fs.readFileSync("config/desktop/resource-policy.json", "utf8"));
    for (const [name, value] of Object.entries(portLimits))
      expect(value).toBe(policy.budgets[name].value);
    expect(policyId).toBe(policy.policy_id);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-port-policy-"));
    try {
      fs.mkdirSync(path.join(root, "config/desktop"), { recursive: true });
      const write = () =>
        fs.writeFileSync(path.join(root, "config/desktop/resource-policy.json"), stringify(policy));
      policy.policy_id = "other";
      write();
      expect(() => generatePortPolicy(root)).toThrow(/Unsupported/);
      policy.policy_id = policyId;
      policy.budgets.message_bytes.value = 1;
      write();
      expect(() => generatePortPolicy(root)).toThrow(/Invalid/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function client() {
  vi.useFakeTimers();
  let receive: (value: unknown) => void = () => {};
  let id = 0;
  const sent: any[] = [];
  const cleanup = vi.fn();
  const transport: PortTransport = {
    send: (text) => {
      sent.push(JSON.parse(text));
    },
    listen: (callback) => {
      receive = callback;
      return cleanup;
    },
  };
  const clock: PortClock = {
    after: (ms, callback) => {
      const timer = setTimeout(callback, ms);
      return () => {
        clearTimeout(timer);
      };
    },
  };
  const bridge = createFoundationPort(
    { contextIsolated: true, sandboxed: true },
    transport,
    clock,
    { windowGeneration: "window-1", serviceGeneration: "service-1", nextId: () => `id-${++id}` },
  );
  function respond(value: unknown, index = sent.length - 1, overrides = {}) {
    receive(
      stringify({ ...sent[index], kind: "result", payload: { ok: true, value }, ...overrides }),
    );
  }
  return {
    ...bridge,
    transport,
    sent,
    receive: (value: unknown) => receive(value),
    respond,
    cleanup,
  };
}

describe("P3 bounded named bridge with deterministic transport peers", () => {
  it("exposes only named operations and checks input before dispatch", async () => {
    const c = client();
    expect(Object.keys(c.port).sort()).toEqual(
      [
        "claimLayoutFailureNotice",
        "readLayout",
        "replaceLayout",
        "readLayoutReceipt",
        "readLocale",
        "replaceLocale",
        "readLocaleReceipt",
        "subscribeLocale",
        "readStatus",
        "readAppearance",
        "replaceAppearance",
        "readAppearanceReceipt",
        "subscribeStatus",
        "subscribeAppearance",
      ].sort(),
    );
    for (const invalid of [
      null,
      {},
      { operationId: "op", expectedRevision: 1, value: "dark", path: "secret" },
    ])
      expect(await c.port.replaceAppearance(invalid as never).result).toEqual(
        failure("invalid_message"),
      );
    expect(c.sent).toHaveLength(0);
    const read = c.port.readStatus();
    c.respond(status);
    expect(await read.result).toEqual({ ok: true, value: status });
    c.dispose();
  });
  it("ipc-saturation: bounds pending calls before sending and frees completed slots", async () => {
    const c = client();
    const calls = Array.from({ length: portLimits.pending_per_window }, () => c.port.readStatus());
    expect(await c.port.readStatus().result).toEqual(failure("busy"));
    expect(c.sent).toHaveLength(portLimits.pending_per_window);
    c.respond(status, 0);
    expect((await calls[0].result).ok).toBe(true);
    c.port.readStatus();
    expect(c.sent).toHaveLength(portLimits.pending_per_window + 1);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ipc-old-generation: ignores late generations and rejects mismatched identity and worker results", async () => {
    const c = client();
    const read = c.port.readStatus();
    c.respond(status, 0, { serviceGeneration: "old-service" });
    c.respond(status, 0, { windowGeneration: "old-window" });
    expect(vi.getTimerCount()).toBe(1);
    c.respond(status, 0, { operationId: "forged" });
    expect(await read.result).toEqual(failure("invalid_service_result"));
    const change = c.port.replaceAppearance({
      operationId: "op",
      expectedRevision: 1,
      value: "dark",
    });
    c.respond({ ...appearance, revision: 5 });
    expect(await change.result).toEqual(failure("uncertain"));
    const next = c.port.readStatus();
    c.receive('{"broken":true}');
    expect(await next.result).toEqual(failure("invalid_service_result"));
    const versioned = c.port.readStatus();
    c.respond(status, c.sent.length - 1, { protocol: 2 });
    expect(await versioned.result).toEqual(failure("unsupported_version"));
    c.dispose();
  });
  it("times out at the canonical deadline and cancellation never claims rollback", async () => {
    const c = client();
    const read = c.port.readStatus();
    vi.advanceTimersByTime(portLimits.request_deadline_ms - 1);
    expect(c.sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(await read.result).toEqual(failure("timeout"));
    expect(c.sent[1].kind).toBe("cancel");
    expect(decodeEnvelope(c.sent[1]).ok).toBe(true);
    const change = c.port.replaceAppearance({
      operationId: "op",
      expectedRevision: 1,
      value: "dark",
    });
    change.cancel();
    expect(await change.result).toEqual(failure("uncertain"));
    c.respond(appearance, 2);
    expect(await change.result).toEqual(failure("uncertain"));
    const another = c.port.readAppearance();
    another.cancel();
    expect(await another.result).toEqual(failure("cancelled"));
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds subscriptions, detects sequence gaps/queue saturation, and disposes all listeners", async () => {
    const c = client();
    const notices = vi.fn();
    const subscriptions = Array.from({ length: portLimits.subscriptions_per_window }, () =>
      c.port.subscribeStatus(notices),
    );
    expect(await c.port.subscribeStatus(notices).ready).toEqual(failure("busy"));
    for (let i = 0; i < subscriptions.length; i++)
      c.respond({ subscriptionId: c.sent[i].payload.subscriptionId }, i);
    expect((await subscriptions[0].ready).ok).toBe(true);
    const base = {
      protocol: 1,
      policy: policyId,
      kind: "event",
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
      subscriptionId: c.sent[0].payload.subscriptionId,
      topic: "status",
      payload: status,
    };
    c.receive(stringify({ ...base, sequence: 1 }));
    vi.advanceTimersByTime(0);
    expect(notices).toHaveBeenCalledWith({ ok: true, value: status });
    c.receive(stringify({ ...base, sequence: 3 }));
    expect(notices).toHaveBeenLastCalledWith(failure("sequence_gap"));
    const other = { ...base, subscriptionId: c.sent[1].payload.subscriptionId };
    for (let sequence = 1; sequence <= portLimits.event_queue_items + 1; sequence++)
      c.receive(stringify({ ...other, sequence }));
    expect(notices).toHaveBeenLastCalledWith(failure("sequence_gap"));
    c.dispose();
    c.dispose();
    expect(c.cleanup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    c.receive(stringify({ ...base, sequence: 4 }));
    expect(await c.port.readStatus().result).toEqual(failure("disposed"));
  });
  it("disposes a pending subscription and cannot activate it with a late acknowledgement", async () => {
    const c = client();
    const notice = vi.fn();
    const stream = c.port.subscribeStatus(notice);
    stream.dispose();
    expect(await stream.ready).toEqual(failure("cancelled"));
    c.respond({ subscriptionId: c.sent[0].payload.subscriptionId }, 0);
    expect(notice).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    c.dispose();
  });
});

describe("P3 transport failures and stream lifecycle races", () => {
  it("invalid inbound message cannot repeatedly invalidate a synchronously resubscribing listener", async () => {
    const c = client();
    let notices = 0;
    const listener = () => {
      notices++;
      if (notices < 4) c.port.subscribeStatus(listener);
    };
    const first = c.port.subscribeStatus(listener);
    c.respond({ subscriptionId: c.sent[0].payload.subscriptionId }, 0);
    expect((await first.ready).ok).toBe(true);
    c.receive('{"broken":true}');
    expect(notices).toBe(1);
    expect(
      c.sent.filter((item) => item.kind === "request" && item.operation === "status.subscribe"),
    ).toHaveLength(2);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("turns every nondefinitive replacement reply into uncertainty", async () => {
    const c = client();
    for (const code of [
      "invalid_service_result",
      "timeout",
      "cancelled",
      "disposed",
      "sequence_gap",
    ] as const) {
      const call = c.port.replaceAppearance({
        operationId: "op",
        expectedRevision: 1,
        value: "dark",
      });
      c.respond(undefined, c.sent.length - 1, { payload: failure(code) });
      expect(await call.result).toEqual(failure("uncertain"));
    }
    c.dispose();
  });

  it("keeps replacement outcomes uncertain when send throws after possible delivery", async () => {
    const c = client();
    c.transport.send = () => {
      throw new Error("private transport trace");
    };
    const read = c.port.readStatus();
    expect(await read.result).toEqual(failure("service_unavailable"));
    const change = c.port.replaceAppearance({
      operationId: "op",
      expectedRevision: 1,
      value: "dark",
    });
    expect(await change.result).toEqual(failure("uncertain"));
    expect(vi.getTimerCount()).toBe(0);
    c.dispose();
  });
  it("closes a stream when an event races ahead of its acknowledgement", async () => {
    const c = client();
    const notices = vi.fn();
    const stream = c.port.subscribeStatus(notices);
    c.receive(
      stringify({
        protocol: 1,
        policy: policyId,
        kind: "event",
        windowGeneration: "window-1",
        serviceGeneration: "service-1",
        subscriptionId: c.sent[0].payload.subscriptionId,
        sequence: 1,
        topic: "status",
        payload: status,
      }),
    );
    expect(await stream.ready).toEqual(failure("sequence_gap"));
    c.respond({ subscriptionId: c.sent[0].payload.subscriptionId }, 0);
    expect(notices).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    c.dispose();
  });
  it("rejects invalid child results, mismatched subscription IDs and revision regressions", async () => {
    const c = client();
    const notices = vi.fn();
    const stream = c.port.subscribeAppearance(notices);
    c.respond({ subscriptionId: "wrong" }, 0);
    expect(await stream.ready).toEqual(failure("invalid_service_result"));
    const next = c.port.subscribeAppearance(notices);
    const index = c.sent.length - 1;
    c.respond({ subscriptionId: c.sent[index].payload.subscriptionId }, index);
    expect((await next.ready).ok).toBe(true);
    const base = {
      protocol: 1,
      policy: policyId,
      kind: "event",
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
      subscriptionId: c.sent[index].payload.subscriptionId,
      topic: "appearance",
      payload: appearance,
    };
    c.receive(stringify({ ...base, sequence: 1 }));
    vi.advanceTimersByTime(0);
    c.receive(stringify({ ...base, sequence: 2 }));
    expect(notices).toHaveBeenLastCalledWith(failure("sequence_gap"));
    const change = c.port.replaceAppearance({
      operationId: "op",
      expectedRevision: 1,
      value: "dark",
    });
    c.respond({ ...appearance, path: "secret" });
    expect(await change.result).toEqual(failure("uncertain"));
    c.dispose();
  });
  it("revokes callbacks on disposal and distinguishes committed success before cancellation", async () => {
    const c = client();
    const change = c.port.replaceAppearance({
      operationId: "op",
      expectedRevision: 1,
      value: "dark",
    });
    c.respond(appearance);
    change.cancel();
    expect(await change.result).toEqual({ ok: true, value: appearance });
    const pending = c.port.replaceAppearance({
      operationId: "op2",
      expectedRevision: 2,
      value: "light",
    });
    c.dispose();
    expect(await pending.result).toEqual(failure("uncertain"));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("P3 broker admission with synthetic frame identities", () => {
  it("ipc-spoofed-frame / ipc-wrong-scope: admits only the registered live frame/origin/generations", () => {
    const pool = new PortAdmission();
    const frame = {};
    const sender = { frame, url: "ohtia://app" };
    const attached = pool.attach({
      ...sender,
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
    });
    expect(attached.ok).toBe(true);
    expect(pool.admit({ ...sender, frame: {} }, stringify(request()))).toEqual(
      failure("unauthorized"),
    );
    expect(pool.admit({ ...sender, url: "https://hostile" }, stringify(request()))).toEqual(
      failure("unauthorized"),
    );
    expect(pool.admit(sender, stringify(request({ windowGeneration: "other" })))).toEqual(
      failure("stale_generation"),
    );
    expect(
      pool.authorize(
        sender,
        stringify({ ...request(), kind: "result", payload: { ok: true, value: status } }),
      ),
    ).toEqual(failure("unauthorized"));
    const accepted = pool.admit(sender, stringify(request()));
    expect(accepted.ok).toBe(true);
    expect(pool.admit(sender, stringify(request()))).toEqual(failure("duplicate_request"));
    if (attached.ok) attached.value();
    expect(pool.admit(sender, stringify(request()))).toEqual(failure("unauthorized"));
    if (accepted.ok) {
      accepted.value.release();
      accepted.value.release();
    }
  });
  it("ipc-saturation: retains service slots after frame disposal until terminal receipts", () => {
    const pool = new PortAdmission();
    const releases: (() => void)[] = [];
    for (let window = 0; window < portLimits.windows; window++) {
      const sender = { frame: {}, url: "ohtia://app" };
      const generations = { windowGeneration: `window-${window}`, serviceGeneration: "service-1" };
      const attached = pool.attach({ ...sender, ...generations });
      expect(attached.ok).toBe(true);
      for (let i = 0; i < portLimits.pending_per_window; i++) {
        const result = pool.admit(
          sender,
          stringify(request({ ...generations, requestId: `req-${i}` })),
        );
        expect(result.ok).toBe(true);
        if (result.ok) releases.push(result.value.release);
      }
      expect(
        pool.admit(sender, stringify(request({ ...generations, requestId: "extra" }))),
      ).toEqual(failure("busy"));
      if (attached.ok) attached.value();
    }
    const sender = { frame: {}, url: "ohtia://app" };
    pool.attach({ ...sender, windowGeneration: "window-1", serviceGeneration: "service-1" });
    expect(pool.admit(sender, stringify(request()))).toEqual(failure("busy"));
    releases.forEach((release) => release());
    expect(pool.admit(sender, stringify(request())).ok).toBe(true);
  });
});

function transactionPeer() {
  let current: AppearanceRecord = {
    schemaVersion: 1,
    revision: 1,
    value: "system",
    source: "saved",
  };
  const receipts = new Map<string, RecordedAppearanceCommand>();
  const transaction: AppearanceTransaction = {
    readReceipt: (id) => receipts.get(id),
    readAppearance: () => ({ ok: true, value: current }),
    replaceAppearance: (value) => {
      current = { ...current, revision: current.revision + 1, value, source: "saved" };
      return current;
    },
    recordReceipt: (id, receipt) => {
      receipts.set(id, receipt);
    },
  };
  return { transaction, receipts, read: () => current };
}

describe("P3 transaction/idempotency contract with deterministic non-durable peer", () => {
  it("idempotency-conflicting-payload / preference-stale-revision: identical replay returns the original receipt before revision checks", () => {
    const peer = transactionPeer();
    const command = { operationId: "op", expectedRevision: 1, value: "dark" as const };
    const first = applyAppearanceCommand(peer.transaction, command);
    expect(first).toEqual({ ok: true, value: appearance });
    expect(applyAppearanceCommand(peer.transaction, command)).toEqual(first);
    expect(peer.read().revision).toBe(2);
    expect(applyAppearanceCommand(peer.transaction, { ...command, value: "light" })).toEqual(
      failure("operation_conflict"),
    );
    const stale = { ...command, operationId: "new" };
    expect(applyAppearanceCommand(peer.transaction, stale)).toEqual(staleRevision(2));
    expect(applyAppearanceCommand(peer.transaction, stale)).toEqual(staleRevision(2));
  });
  it("lost-ack-reconcile: a committed effect survives a lost reply, cancellation and receipt lookup without another mutation", async () => {
    const peer = transactionPeer();
    const c = client();
    const change = c.port.replaceAppearance({
      operationId: "op",
      expectedRevision: 1,
      value: "dark",
    });
    const outcome = applyAppearanceCommand(peer.transaction, {
      operationId: c.sent[0].operationId,
      ...c.sent[0].payload,
    });
    expect(outcome.ok).toBe(true);
    vi.advanceTimersByTime(portLimits.request_deadline_ms);
    expect(await change.result).toEqual(failure("uncertain"));
    const lookup = c.port.readAppearanceReceipt("op");
    c.respond({ state: "recorded", outcome: peer.receipts.get("op")!.outcome });
    expect(await lookup.result).toEqual({ ok: true, value: { state: "recorded", outcome } });
    expect(peer.read().revision).toBe(2);
    c.dispose();
  });
});

describe("P3 serialized duplicate transaction claims", () => {
  it("records one effect for concurrent callers of the same admitted command", async () => {
    const peer = transactionPeer();
    const command = { operationId: "op", expectedRevision: 1, value: "dark" as const };
    // A serialized synchronous transaction peer; not evidence of multi-process SQLite exclusion.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() => applyAppearanceCommand(peer.transaction, command)),
      ),
    );
    expect(results.every((result) => stringify(result) === stringify(results[0]))).toBe(true);
    expect(peer.read().revision).toBe(2);
    expect(peer.receipts.size).toBe(1);
  });
});

describe("P3 direct policy CLI and broker subscription reservations", () => {
  it("generates current policy even when the direct CLI checkout path is an alias", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-port-cli-"));
    try {
      fs.mkdirSync(path.join(root, "tooling"));
      fs.mkdirSync(path.join(root, "config/desktop"), { recursive: true });
      for (const file of [
        "tooling/generate-port-policy.mjs",
        "tooling/port-policy.mjs",
        "config/desktop/resource-policy.json",
      ])
        fs.copyFileSync(file, path.join(root, file));
      const alias = path.join(root, "alias");
      fs.symlinkSync(root, alias, "junction");
      const result = spawnSync(
        process.execPath,
        [path.join(alias, "tooling/generate-port-policy.mjs")],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(
        fs.readFileSync(
          path.join(root, "packages/contracts/src/generated/resource-policy.ts"),
          "utf8",
        ),
      ).toContain(`export const policyId = "${policyId}"`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("reserves producer streams before acceptance and keeps them counted after request acknowledgement", () => {
    const pool = new PortAdmission();
    const sender = { frame: {}, url: "ohtia://app" };
    pool.attach({ ...sender, windowGeneration: "window-1", serviceGeneration: "service-1" });
    const releases: (() => void)[] = [];
    for (let i = 0; i < portLimits.subscriptions_per_window; i++) {
      const admitted = pool.admit(
        sender,
        stringify(
          request({
            requestId: `request-${i}`,
            operation: "status.subscribe",
            payload: { subscriptionId: `stream-${i}` },
          }),
        ),
      );
      expect(admitted.ok).toBe(true);
      if (admitted.ok) {
        admitted.value.release();
        releases.push(admitted.value.releaseSubscription);
      }
    }
    expect(
      pool.admit(
        sender,
        stringify(
          request({
            requestId: "extra",
            operation: "appearance.subscribe",
            payload: { subscriptionId: "extra" },
          }),
        ),
      ),
    ).toEqual(failure("busy"));
    expect(
      pool.admit(
        sender,
        stringify(
          request({
            requestId: "duplicate",
            operation: "appearance.subscribe",
            payload: { subscriptionId: "stream-0" },
          }),
        ),
      ),
    ).toEqual(failure("duplicate_request"));
    releases[0]();
    releases[0]();
    expect(
      pool.admit(
        sender,
        stringify(
          request({
            requestId: "retry",
            operation: "appearance.subscribe",
            payload: { subscriptionId: "retry" },
          }),
        ),
      ).ok,
    ).toBe(true);
  });
  it("retains a derived aggregate bound for subscriptions from detached frames", () => {
    const pool = new PortAdmission();
    const releaseStreams: (() => void)[] = [];
    for (let w = 0; w < portLimits.windows; w++) {
      const sender = { frame: {}, url: "ohtia://app" };
      const attached = pool.attach({
        ...sender,
        windowGeneration: "window-1",
        serviceGeneration: "service-1",
      });
      for (let i = 0; i < portLimits.subscriptions_per_window; i++) {
        const admitted = pool.admit(
          sender,
          stringify(
            request({
              requestId: `req-${i}`,
              operation: "status.subscribe",
              payload: { subscriptionId: `stream-${i}` },
            }),
          ),
        );
        expect(admitted.ok).toBe(true);
        if (admitted.ok) {
          admitted.value.release();
          releaseStreams.push(admitted.value.releaseSubscription);
        }
      }
      if (attached.ok) attached.value();
    }
    const sender = { frame: {}, url: "ohtia://app" };
    pool.attach({ ...sender, windowGeneration: "window-1", serviceGeneration: "service-1" });
    const pending = request({ operation: "status.subscribe", payload: { subscriptionId: "last" } });
    expect(pool.admit(sender, stringify(pending))).toEqual(failure("busy"));
    releaseStreams[0]();
    expect(pool.admit(sender, stringify(pending)).ok).toBe(true);
  });
  it("reports the canonical window-limit outcome", () => {
    const pool = new PortAdmission();
    for (let i = 0; i < portLimits.windows; i++)
      expect(
        pool.attach({
          frame: {},
          url: "ohtia://app",
          windowGeneration: `window-${i}`,
          serviceGeneration: "service-1",
        }).ok,
      ).toBe(true);
    expect(
      pool.attach({
        frame: {},
        url: "ohtia://app",
        windowGeneration: "extra",
        serviceGeneration: "service-1",
      }),
    ).toEqual(failure("window_limit"));
  });
});

describe("locale producer/consumer bridge", () => {
  it("dispatches only named locale calls and validates mutation receipts", async () => {
    const c = client();
    const read = c.port.readLocale();
    c.respond(localeSnapshot);
    expect(await read.result).toEqual({ ok: true, value: localeSnapshot });
    const receipt = c.port.readLocaleReceipt("saved-op");
    c.respond({ state: "not_found" });
    expect(await receipt.result).toMatchObject({ ok: true });
    const rejected = c.port.replaceLocale({
      operationId: "invalid",
      expectedRevision: 0,
      value: "nn-NO" as never,
    });
    expect(await rejected.result).toMatchObject({ ok: false });
    const save = c.port.replaceLocale({
      operationId: "language-op",
      expectedRevision: 1,
      value: "ko-KR",
    });
    c.respond(localeSnapshot.record);
    expect(await save.result).toMatchObject({ ok: true });
    const wrong = c.port.replaceLocale({
      operationId: "wrong-result",
      expectedRevision: 1,
      value: "fr-CA",
    });
    c.respond(localeSnapshot.record);
    expect(await wrong.result).toMatchObject({ error: { code: "uncertain" } });
    c.dispose();
  });
  it("bounds locale subscriptions, rejects obsolete revisions and disposes pending commands", async () => {
    const c = client();
    const notices = vi.fn();
    const stream = c.port.subscribeLocale(notices);
    const id = c.sent.at(-1).payload.subscriptionId;
    c.respond({ subscriptionId: id });
    await stream.ready;
    const event = {
      protocol: 1,
      policy: policyId,
      kind: "event",
      windowGeneration: "window-1",
      serviceGeneration: "service-1",
      subscriptionId: id,
      sequence: 1,
      topic: "locale",
      payload: localeSnapshot,
    };
    c.receive(JSON.stringify(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toHaveBeenCalledWith({ ok: true, value: localeSnapshot });
    c.receive(JSON.stringify({ ...event, sequence: 2 }));
    expect(notices).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "sequence_gap" }) }),
    );
    const command = c.port.replaceLocale({
      operationId: "unresolved",
      expectedRevision: 2,
      value: "system",
    });
    c.dispose();
    expect(await command.result).toMatchObject({ error: { code: "uncertain" } });
    stream.dispose();
  });
});

describe("named layout transport", () => {
  const layout = {
    version: 1 as const,
    visible: { explorer: true, documents: true, chat: true },
    preferredWidths: { explorer: 256.5, documents: 656, chat: 360 },
  };
  it("matches exact saved payload and queries its original receipt", async () => {
    const c = client();
    const change = c.port.replaceLayout({
      operationId: "layout",
      expectedRevision: 0,
      value: layout,
    });
    const record = { schemaVersion: 1, revision: 1, source: "saved", value: layout };
    c.respond(record);
    expect(await change.result).toEqual({ ok: true, value: record });
    const receipt = c.port.readLayoutReceipt("layout");
    c.respond({ state: "recorded", outcome: { ok: true, value: record } });
    expect(await receipt.result).toMatchObject({ ok: true, value: { state: "recorded" } });
    const read = c.port.readLayout();
    c.respond(record);
    expect(await read.result).toEqual({ ok: true, value: record });
    const notice = c.port.claimLayoutFailureNotice();
    c.respond({ announce: false });
    expect(await notice.result).toEqual({ ok: true, value: { announce: false } });
    c.dispose();
  });
  it("rejects private fields and preserves uncertainty on mismatched values and cancellation", async () => {
    const c = client();
    expect(
      await c.port.replaceLayout({
        operationId: "layout",
        expectedRevision: 0,
        value: { ...layout, path: "private" },
      } as never).result,
    ).toEqual(failure("invalid_message"));
    const changed = c.port.replaceLayout({
      operationId: "layout",
      expectedRevision: 0,
      value: layout,
    });
    c.respond({
      schemaVersion: 1,
      revision: 1,
      source: "saved",
      value: { ...layout, preferredWidths: { ...layout.preferredWidths, chat: 500 } },
    });
    expect(await changed.result).toEqual(failure("uncertain"));
    const cancelled = c.port.replaceLayout({
      operationId: "layout-2",
      expectedRevision: 0,
      value: layout,
    });
    cancelled.cancel();
    expect(await cancelled.result).toEqual(failure("uncertain"));
    c.dispose();
  });
});
