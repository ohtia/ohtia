import { describe, it, expect, vi } from "vitest";
import {
  encodeEnvelope,
  decodeText,
  failure,
  type Request,
  type PresentationSnapshot,
} from "@ohtia/contracts";
import { PresentationBroker } from "../packages/main/src/presentation-broker.js";
import type { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { request as baseRequest } from "./fixtures/port-corpus.js";
function request(
  operation: Request["operation"],
  payload: unknown,
  overrides: Partial<Request> = {},
): Request {
  return baseRequest({ ...overrides, operation, payload } as Partial<Request>);
}
type Work = Parameters<ServiceSupervisor["dispatch"]>[0];
function snapshot(revision = 0, percent = 100): PresentationSnapshot {
  return {
    serviceGeneration: "service-1",
    appearance: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
    character: { schemaVersion: 1, revision: 0, value: "animated", source: "default" },
    zoom: {
      schemaVersion: 1,
      revision,
      value: percent as never,
      source: revision ? "saved" : "default",
    },
  };
}
function harness() {
  let factor = 1;
  const target = {
    setZoomFactor: vi.fn((next: number) => {
      factor = next;
    }),
    getZoomFactor: vi.fn(() => factor),
  };
  const broker = new PresentationBroker(() => [target]);
  const queue: Work[] = [];
  const service = {
    generation: "service-1",
    dispatch: (work: Work) => {
      queue.push(work);
    },
  };
  function submit(value: Request) {
    const work = {
      request: value,
      deliver: vi.fn(),
      release: vi.fn(),
      releaseSubscription: vi.fn(),
    };
    const handled = broker.handle(work, service as unknown as ServiceSupervisor, target);
    return { work, handled };
  }
  async function respond(operation: string, payload: unknown) {
    const next = queue.shift()!;
    expect(next.request.operation).toBe(operation);
    const encoded = encodeEnvelope({ ...next.request, kind: "result", payload });
    expect(encoded.ok).toBe(true);
    if (encoded.ok) next.deliver(encoded.value);
    await Promise.resolve();
    await Promise.resolve();
    return next.request;
  }
  return { broker, target, submit, respond, queue, service };
}
describe("trusted presentation broker", () => {
  it("serializes relative zoom intents against the latest committed record and applies only confirmed factors", async () => {
    const h = harness();
    h.broker.accept(snapshot());
    const first = h.submit(request("zoom.adjust", { intent: "increase" }));
    expect(h.target.setZoomFactor).not.toHaveBeenCalled();
    const busy = h.submit(
      request("zoom.adjust", { intent: "increase" }, { operationId: "second" }),
    );
    expect(busy.work.deliver.mock.calls[0]?.[0]).toContain('"code":"busy"');
    await h.respond("presentation.read", { ok: true, value: snapshot() });
    const commit = await h.respond("zoom.commit", {
      ok: true,
      value: { schemaVersion: 1, revision: 1, value: 110, source: "saved" },
    });
    expect(commit.payload).toEqual({ expectedRevision: 0, value: 110, intent: "increase" });
    expect(h.target.setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(first.work.release).toHaveBeenCalledOnce();
    h.submit(request("zoom.adjust", { intent: "increase" }, { operationId: "third" }));
    await h.respond("presentation.read", { ok: true, value: snapshot(1, 110) });
    const second = await h.respond("zoom.commit", {
      ok: true,
      value: { schemaVersion: 1, revision: 2, value: 125, source: "saved" },
    });
    expect(second.payload).toMatchObject({ expectedRevision: 1, value: 125 });
    h.broker.accept(snapshot(1, 110));
    expect(h.target.getZoomFactor()).toBe(1.25);
  });
  it("retains uncertain admission across view closure until the original durable receipt settles", async () => {
    const h = harness();
    h.submit(request("zoom.replace", { expectedRevision: 0, value: 200 }));
    await h.respond("zoom.replace", failure("uncertain"));
    expect(
      h.submit(request("zoom.adjust", { intent: "reset" })).work.deliver.mock.calls[0]?.[0],
    ).toContain('"code":"busy"');
    await h.respond("zoom.receipt", { ok: true, value: { state: "not_found" } });
    expect(
      h.submit(request("zoom.adjust", { intent: "reset" })).work.deliver.mock.calls[0]?.[0],
    ).toContain('"code":"busy"');
    await h.respond("zoom.receipt", { ok: true, value: { state: "pending" } });
    h.submit(request("zoom.receipt", { targetOperationId: "operation-1" }));
    await h.respond("zoom.receipt", {
      ok: true,
      value: {
        state: "recorded",
        outcome: {
          ok: true,
          value: { schemaVersion: 1, revision: 1, value: 200, source: "saved" },
        },
      },
    });
    h.submit(request("zoom.adjust", { intent: "reset" }));
    expect(h.queue[0]?.request.operation).toBe("presentation.read");
  });
  it("separates saved success from rendering failures and retries no mutation", async () => {
    const h = harness();
    h.target.setZoomFactor.mockImplementationOnce(() => {
      throw new Error("render");
    });
    h.broker.accept(snapshot(1, 200));
    const apply = h.submit(request("zoom.apply", {}));
    await h.respond("presentation.read", { ok: true, value: snapshot(1, 200) });
    const text = apply.work.deliver.mock.calls[0]?.[0];
    const result = decodeText(text);
    expect(result.ok && result.value.kind === "result" && result.value.payload).toMatchObject({
      ok: true,
      value: { applied: true, percent: 200 },
    });
    expect(h.queue).toHaveLength(0);
    expect(h.submit(request("appearance.read", {})).handled).toBe(false);
  });
  it("releases pre-dispatch read failure and reports a failed application read separately", async () => {
    const h = harness();
    const first = h.submit(request("zoom.adjust", { intent: "decrease" }));
    await h.respond("presentation.read", failure("service_unavailable"));
    expect(first.work.release).toHaveBeenCalledOnce();
    const second = h.submit(request("zoom.apply", {}));
    await h.respond("presentation.read", failure("storage_failed"));
    expect(second.work.deliver.mock.calls[0]?.[0]).toContain('"code":"storage_failed"');
    const next = h.submit(request("zoom.replace", { expectedRevision: 0, value: 90 }));
    await h.respond("zoom.replace", {
      ok: true,
      value: { schemaVersion: 1, revision: 1, value: 90, source: "saved" },
    });
    expect(next.work.release).toHaveBeenCalledOnce();
  });
});

it("releases durable absence only after the old service generation has ceased", async () => {
  const h = harness();
  h.submit(request("zoom.replace", { expectedRevision: 0, value: 125 }));
  await h.respond("zoom.replace", failure("uncertain"));
  h.service.generation = "service-2";
  h.submit(
    request(
      "zoom.receipt",
      { targetOperationId: "operation-1" },
      { serviceGeneration: "service-2" },
    ),
  );
  await h.respond("zoom.receipt", { ok: true, value: { state: "not_found" } });
  h.submit(request("zoom.adjust", { intent: "increase" }, { serviceGeneration: "service-2" }));
  expect(h.queue[0]?.request.operation).toBe("presentation.read");
});
it("initializes later windows from the trusted snapshot and preserves the record when a target cannot apply it", async () => {
  const h = harness();
  h.broker.initialize(h.service as unknown as ServiceSupervisor);
  await h.respond("presentation.read", { ok: true, value: snapshot(2, 150) });
  let factor = 1;
  const later = {
    getZoomFactor: () => factor,
    setZoomFactor: (value: number) => {
      factor = value;
    },
  };
  expect(h.broker.apply(later)).toEqual({ revision: 2, percent: 150, applied: true });
  expect(
    h.broker.apply({
      getZoomFactor: () => 1,
      setZoomFactor() {
        throw new Error("target unavailable");
      },
    }),
  ).toEqual({ revision: 2, percent: 150, applied: false });
});
it("normalizes a pre-dispatch read timeout without leaving the caller in mutation uncertainty", async () => {
  const h = harness();
  const pending = h.submit(request("zoom.adjust", { intent: "increase" }));
  await h.respond("presentation.read", failure("timeout"));
  expect(pending.work.deliver.mock.calls[0]?.[0]).toContain('"code":"service_unavailable"');
  h.submit(request("zoom.replace", { expectedRevision: 0, value: 125 }));
  expect(h.queue[0]?.request.operation).toBe("zoom.replace");
});
it("retains uncertainty after an invalid mutation acknowledgement and a definitive stale version leaves factors unchanged", async () => {
  const h = harness();
  h.broker.accept(snapshot(2, 125));
  const stale = h.submit(request("zoom.replace", { expectedRevision: 0, value: 150 }));
  await h.respond("zoom.replace", {
    ok: false,
    error: {
      code: "stale_revision",
      nextAction: "refresh_preference",
      parameters: { currentRevision: 2 },
    },
  });
  expect(stale.work.deliver.mock.calls[0]?.[0]).toContain('"code":"stale_revision"');
  expect(h.target.getZoomFactor()).toBe(1.25);
  const unknown = h.submit(request("zoom.replace", { expectedRevision: 2, value: 150 }));
  h.queue.shift()!.deliver("invalid");
  await Promise.resolve();
  await Promise.resolve();
  expect(unknown.work.deliver.mock.calls[0]?.[0]).toContain('"code":"uncertain"');
  expect(
    h.submit(request("zoom.adjust", { intent: "reset" })).work.deliver.mock.calls[0]?.[0],
  ).toContain('"code":"busy"');
});

it("reconciles a closed view's original zoom identity when a new service initializes", async () => {
  const h = harness();
  h.submit(request("zoom.replace", { expectedRevision: 0, value: 125 }));
  await h.respond("zoom.replace", failure("uncertain"));
  h.service.generation = "service-2";
  h.broker.initialize(h.service as unknown as ServiceSupervisor);
  await h.respond("presentation.read", {
    ok: true,
    value: { ...snapshot(), serviceGeneration: "service-2" },
  });
  const lookup = await h.respond("zoom.receipt", { ok: true, value: { state: "not_found" } });
  expect(lookup.payload).toEqual({ targetOperationId: "operation-1" });
  h.submit(
    request(
      "zoom.adjust",
      { intent: "increase" },
      { serviceGeneration: "service-2", operationId: "new-intent" },
    ),
  );
  expect(h.queue[0]?.request.operation).toBe("presentation.read");
});
it("reconciles a closed view's committed zoom from another window without replaying its write", async () => {
  const h = harness();
  h.submit(request("zoom.replace", { expectedRevision: 0, value: 125 }));
  await h.respond("zoom.replace", failure("uncertain"));
  h.submit(
    request(
      "zoom.apply",
      {},
      { windowGeneration: "other-window", operationId: "read-only-application" },
    ),
  );
  const lookup = await h.respond("zoom.receipt", {
    ok: true,
    value: {
      state: "recorded",
      outcome: { ok: true, value: { schemaVersion: 1, revision: 1, value: 125, source: "saved" } },
    },
  });
  expect(lookup.payload).toEqual({ targetOperationId: "operation-1" });
  await h.respond("presentation.read", { ok: true, value: snapshot(1, 125) });
  expect(h.target.getZoomFactor()).toBe(1.25);
  h.submit(request("zoom.adjust", { intent: "increase" }, { operationId: "new-intent" }));
  expect(h.queue.map((work) => work.request.operation)).toEqual(["presentation.read"]);
});
it("ignores a reconciliation from a retired service while the current generation owns its receipt query", async () => {
  const h = harness();
  h.submit(request("zoom.replace", { expectedRevision: 0, value: 125 }));
  await h.respond("zoom.replace", failure("uncertain"));
  h.submit(request("zoom.adjust", { intent: "increase" }, { operationId: "blocked-old" }));
  const old = h.queue.shift()!;
  expect(old.request.operation).toBe("zoom.receipt");
  h.service.generation = "service-2";
  h.broker.initialize(h.service as unknown as ServiceSupervisor);
  const encoded = encodeEnvelope({
    ...old.request,
    kind: "result",
    payload: {
      ok: true,
      value: {
        state: "recorded",
        outcome: {
          ok: true,
          value: { schemaVersion: 1, revision: 1, value: 125, source: "saved" },
        },
      },
    },
  });
  if (!encoded.ok) throw new Error("Fixture encoding failed");
  old.deliver(encoded.value);
  await Promise.resolve();
  const blocked = h.submit(
    request(
      "zoom.adjust",
      { intent: "increase" },
      { serviceGeneration: "service-2", operationId: "blocked-new" },
    ),
  );
  expect(blocked.work.deliver.mock.calls[0]?.[0]).toContain('"code":"busy"');
  expect(h.queue.map((work) => work.request.operation)).toEqual([
    "presentation.read",
    "zoom.receipt",
  ]);
  await h.respond("presentation.read", {
    ok: true,
    value: { ...snapshot(), serviceGeneration: "service-2" },
  });
  await h.respond("zoom.receipt", { ok: true, value: { state: "not_found" } });
  h.submit(
    request(
      "zoom.adjust",
      { intent: "increase" },
      { serviceGeneration: "service-2", operationId: "fresh" },
    ),
  );
  expect(h.queue[0]?.request.operation).toBe("presentation.read");
});
it.each([
  { revision: 1, value: 200 },
  { revision: 2, value: 125 },
])("keeps a schema-valid mismatched replacement uncertain: %j", async (record) => {
  const h = harness();
  h.broker.accept(snapshot());
  const submitted = h.submit(request("zoom.replace", { expectedRevision: 0, value: 125 }));
  await h.respond("zoom.replace", {
    ok: true,
    value: { schemaVersion: 1, source: "saved", ...record },
  });
  expect(submitted.work.deliver.mock.calls[0]?.[0]).toContain('"code":"uncertain"');
  expect(h.target.getZoomFactor()).toBe(1);
  expect(h.target.setZoomFactor).not.toHaveBeenCalled();
  const next = h.submit(request("zoom.adjust", { intent: "increase" }, { operationId: "next" }));
  expect(next.work.deliver.mock.calls[0]?.[0]).toContain('"code":"busy"');
  const lookup = await h.respond("zoom.receipt", { ok: true, value: { state: "pending" } });
  expect(lookup.payload).toEqual({ targetOperationId: "operation-1" });
});
it("returns an immediate declared error when zoom application cannot read a valid preference", async () => {
  const h = harness();
  const submitted = h.submit(request("zoom.apply", {}));
  await h.respond("presentation.read", failure("preference_invalid"));
  expect(submitted.work.deliver).toHaveBeenCalledOnce();
  expect(submitted.work.deliver.mock.calls[0]?.[0]).toContain('"code":"preference_invalid"');
  expect(submitted.work.release).toHaveBeenCalledOnce();
});
it.each([
  { revision: 1, value: 200 },
  { revision: 2, value: 110 },
])("does not apply a mismatched fresh relative acknowledgement: %j", async (record) => {
  const h = harness();
  h.broker.accept(snapshot());
  const submitted = h.submit(request("zoom.adjust", { intent: "increase" }));
  await h.respond("presentation.read", { ok: true, value: snapshot() });
  await h.respond("zoom.commit", {
    ok: true,
    value: { schemaVersion: 1, source: "saved", ...record },
  });
  expect(h.target.getZoomFactor()).toBe(1);
  expect(submitted.work.deliver.mock.calls[0]?.[0]).toContain('"code":"uncertain"');
  expect(
    h.submit(request("zoom.adjust", { intent: "increase" }, { operationId: "new" })).work.deliver
      .mock.calls[0]?.[0],
  ).toContain('"code":"busy"');
});
it("returns a relative duplicate's original receipt without rewinding the current factor", async () => {
  const h = harness();
  h.broker.accept(snapshot(2, 125));
  const submitted = h.submit(request("zoom.adjust", { intent: "increase" }));
  await h.respond("presentation.read", { ok: true, value: snapshot(2, 125) });
  const committed = await h.respond("zoom.commit", {
    ok: true,
    value: { schemaVersion: 1, revision: 1, value: 110, source: "saved" },
  });
  expect(committed.payload).toMatchObject({ expectedRevision: 2, value: 150 });
  expect(submitted.work.deliver).not.toHaveBeenCalled();
  const lookup = await h.respond("zoom.receipt", {
    ok: true,
    value: {
      state: "recorded",
      outcome: { ok: true, value: { schemaVersion: 1, revision: 1, value: 110, source: "saved" } },
    },
  });
  expect(lookup.payload).toEqual({ targetOperationId: "operation-1" });
  expect(submitted.work.deliver.mock.calls[0]?.[0]).toContain('"revision":1');
  expect(h.target.getZoomFactor()).toBe(1.25);
  h.submit(request("zoom.adjust", { intent: "increase" }, { operationId: "distinct" }));
  expect(h.queue[0]?.request.operation).toBe("presentation.read");
});
it.each(["pending", "different", "read-failed"])(
  "does not trust an older relative acknowledgement without a matching durable receipt: %s",
  async (state) => {
    const h = harness();
    h.broker.accept(snapshot(2, 125));
    const submitted = h.submit(request("zoom.adjust", { intent: "increase" }));
    await h.respond("presentation.read", { ok: true, value: snapshot(2, 125) });
    await h.respond("zoom.commit", {
      ok: true,
      value: { schemaVersion: 1, revision: 1, value: 110, source: "saved" },
    });
    await h.respond(
      "zoom.receipt",
      state === "read-failed"
        ? failure("storage_failed")
        : state === "pending"
          ? { ok: true, value: { state: "pending" } }
          : {
              ok: true,
              value: {
                state: "recorded",
                outcome: {
                  ok: true,
                  value: { schemaVersion: 1, revision: 1, value: 150, source: "saved" },
                },
              },
            },
    );
    expect(submitted.work.deliver.mock.calls[0]?.[0]).toContain('"code":"uncertain"');
    expect(h.target.getZoomFactor()).toBe(1.25);
  },
);
