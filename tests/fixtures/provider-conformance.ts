import { describe, it, expect, vi } from "vitest";
import {
  isProviderDeclaration,
  connectionReasonMatches,
} from "../../packages/contracts/src/index.js";
import { ConnectionManager } from "../../packages/main/src/connection-manager.js";
import type { ProviderAdapter, SignInResult } from "../../packages/main/src/provider-adapter.js";
import type { ProviderModel, ConnectionEvent } from "../../packages/contracts/src/index.js";
import {
  decodeProviderEvent,
  isProviderEvent,
  type ProviderEvent,
  type ProviderRequestData,
} from "../../packages/contracts/src/index.js";
import { ProviderDispatch } from "../../packages/main/src/provider-dispatch.js";
import { forbiddenResponseFields } from "../../packages/main/src/chatgpt-responses.js";

/** A request of the extended suite, with the synthetic credential it must never carry. */
export function conformanceRequest(connection: string, attempt = "attempt-1"): ProviderRequestData {
  return {
    attempt,
    operation: "development_test",
    connection,
    model: "first",
    instructions: "Synthetic conformance instructions.",
    input: [{ role: "user", text: "Synthetic conformance message." }],
    limits: { max_output_bytes: 16384, max_attempt_duration_ms: 600000, max_inactivity_ms: 120000 },
  };
}
/** Run one dispatch through main's guards and collect what reaches the data service. */
export async function dispatchThrough(
  manager: ConnectionManager,
  adapter: ProviderAdapter,
  request: ProviderRequestData,
  options: {
    readonly interrupt?: (dispatch: ProviderDispatch, events: readonly ProviderEvent[]) => void;
  } = {},
): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  const dispatch = new ProviderDispatch([adapter], {
    state: (id) => manager.snapshot(id)?.state,
    send: (generation, text) => {
      const decoded = decodeProviderEvent(text, generation);
      expect(decoded).toBeDefined();
      events.push(decoded!.event);
    },
  });
  dispatch.begin("conformance");
  const running = dispatch.receive({
    kind: "provider_dispatch",
    version: 1,
    generation: "conformance",
    request,
    permit: { id: `permit-${request.attempt}`, attempt: request.attempt, issued_at: Date.now() },
  });
  options.interrupt?.(dispatch, events);
  await running;
  await vi.waitFor(() => {
    expect(events.at(-1)?.type).toBe("result");
  });
  dispatch.dispose();
  return events;
}
export interface ConformanceOptions {
  readonly connect?: (signal: AbortSignal) => Promise<SignInResult>;
  readonly probe?: (signal: AbortSignal) => Promise<readonly ProviderModel[]>;
  readonly credentials?: ProviderAdapter["credentials"];
  /** Send a reply's first text and hold it open until the request's signal aborts. */
  readonly holdReply?: boolean;
}
/** Each adapter supplies a synthetic harness; no paid access or personal credentials are used. */
export function providerConformance(
  name: string,
  create: (options?: ConformanceOptions) => ProviderAdapter,
  inspect: {
    /** Every HTTP body the adapter sent, for the checks no adapter may fail. */
    readonly bodies?: () => readonly Record<string, unknown>[];
  } = {},
): void {
  describe(`${name} adapter conformance`, () => {
    it("declares explicit capabilities and access, connects immediately and disconnects idempotently", async () => {
      let complete!: (result: SignInResult) => void;
      const adapter = create({
        connect: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      });
      const manager = new ConnectionManager([adapter]);
      const id = adapter.declaration.connection.id;
      const events: ConnectionEvent[] = [];
      manager.subscribe((event) => {
        events.push(event);
      });
      expect(isProviderDeclaration(adapter.declaration)).toBe(true);
      expect(await manager.read(id)).toMatchObject({ ok: true, value: { state: "disconnected" } });
      expect(manager.connect(id)).toMatchObject({ ok: true, value: { state: "connecting" } });
      expect(manager.connect(id)).toMatchObject({ ok: true, value: { state: "connecting" } });
      await vi.waitFor(() => {
        expect(complete).toBeTypeOf("function");
      });
      complete({
        state: "connected",
        session: { credential: "synthetic-conformance-session", reason: null },
      });
      await vi.waitFor(() => {
        expect(manager.snapshot(id)?.state).toBe("connected");
      });
      expect(manager.connect(id)).toMatchObject({ value: { state: "connected" } });
      expect(await manager.disconnect(id)).toMatchObject({ value: { state: "disconnected" } });
      expect(await manager.disconnect(id)).toMatchObject({ value: { state: "disconnected" } });
      expect(events.every((event) => connectionReasonMatches(event.state, event.reason))).toBe(
        true,
      );
      expect(JSON.stringify(events)).not.toContain("synthetic-conformance-session");
      manager.dispose();
    });
    it("probes asynchronously, shares running probes and delivers one result without models", async () => {
      let complete!: (models: readonly ProviderModel[]) => void;
      const adapter = create({
        probe: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      });
      const manager = new ConnectionManager([adapter]);
      const id = adapter.declaration.connection.id;
      manager.connect(id);
      await vi.waitFor(() => {
        expect(manager.snapshot(id)?.state).toBe("connected");
      });
      const events: ConnectionEvent[] = [];
      manager.subscribe((event) => {
        events.push(event);
      });
      const first = manager.probe(id);
      expect(first).toMatchObject({ value: { probing: true } });
      expect(manager.probe(id)).toEqual(first);
      await vi.waitFor(() => {
        expect(complete).toBeTypeOf("function");
      });
      complete([{ id: "synthetic-model", name: "Synthetic model" }]);
      await vi.waitFor(() => {
        expect(manager.snapshot(id)?.probing).toBe(false);
      });
      const results = events.filter((event) => event.kind === "probe_result");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        outcome: "listed",
        model_list_revision: 1,
        model_count: 1,
      });
      expect(JSON.stringify(results)).not.toContain("synthetic-model");
      manager.dispose();
    });
    it("streams a request through main's guards as sequenced events ending in one result", async () => {
      const adapter = create();
      const manager = new ConnectionManager([adapter]);
      const id = adapter.declaration.connection.id;
      expect(adapter.declaration.capabilities.text).toBe(adapter.requests !== undefined);
      // Resume is declared, never emulated: no adapter here can resume a request.
      expect(adapter.declaration.capabilities.resumption).toBe(false);
      manager.connect(id);
      await vi.waitFor(() => {
        expect(manager.snapshot(id)?.state).toBe("connected");
      });
      const events = await dispatchThrough(manager, adapter, conformanceRequest(id));
      expect(events.every(isProviderEvent)).toBe(true);
      expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
      expect(events[0]?.type).toBe("started");
      expect(events.filter((event) => event.type === "result")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: "result", result: { status: "completed" } });
      expect(
        events
          .filter((event) => event.type === "text")
          .map((event) => event.text)
          .join(""),
      ).toBe("Synthetic reply.");
      for (const body of inspect.bodies?.() ?? []) {
        for (const field of forbiddenResponseFields) expect(body).not.toHaveProperty(field);
        // Only Ohtia's own tools may ever be sent; this story's requests carry none.
        expect(body).not.toHaveProperty("tools");
        expect(body).toMatchObject({ store: false, stream: true });
      }
      manager.dispose();
    });
    it("interrupts a request mid-reply as cancelled, with one result", async () => {
      const adapter = create({ holdReply: true });
      const manager = new ConnectionManager([adapter]);
      const id = adapter.declaration.connection.id;
      manager.connect(id);
      await vi.waitFor(() => {
        expect(manager.snapshot(id)?.state).toBe("connected");
      });
      const request = conformanceRequest(id, "attempt-interrupted");
      const events = await dispatchThrough(manager, adapter, request, {
        interrupt: (dispatch, seen) => {
          // Mid-reply: after the first text has been forwarded.
          void vi
            .waitFor(() => {
              expect(dispatch.query(request.attempt)).toBe("running");
              expect(seen.some((event) => event.type === "text")).toBe(true);
            })
            .then(() => {
              dispatch.interrupt({
                kind: "provider_interrupt",
                version: 1,
                generation: "conformance",
                attempt: request.attempt,
              });
            });
        },
      });
      expect(events.filter((event) => event.type === "result")).toEqual([
        expect.objectContaining({ result: { status: "cancelled" } }),
      ]);
      manager.dispose();
    });
    it.each(["sign_in_timeout", "plan_use_not_allowed", "sign_in_rejected"] as const)(
      "classifies %s without leaking provider errors",
      async (reason) => {
        const adapter = create({
          connect: () =>
            Promise.resolve(
              reason === "sign_in_timeout"
                ? { state: "disconnected", reason }
                : { state: "error", reason },
            ),
        });
        const manager = new ConnectionManager([adapter]);
        const id = adapter.declaration.connection.id;
        manager.connect(id);
        await vi.waitFor(() => {
          expect(manager.snapshot(id)?.reason).toBe(reason);
        });
        expect(manager.snapshot(id)?.state).toBe(
          reason === "sign_in_timeout" ? "disconnected" : "error",
        );
        await manager.disconnect(id);
        expect(manager.snapshot(id)?.reason).toBeNull();
        manager.dispose();
      },
    );
  });
}
