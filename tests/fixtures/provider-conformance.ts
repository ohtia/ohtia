import type { ResponseTransport } from "../../packages/main/src/chatgpt-requests.js";
import type { RequestObservation } from "../../packages/main/src/provider-requests.js";
import { developmentTest } from "../../packages/domain/src/development-policy.js";
import { describe, it, expect, vi } from "vitest";
import {
  isProviderDeclaration,
  connectionReasonMatches,
} from "../../packages/contracts/src/index.js";
import { ConnectionManager } from "../../packages/main/src/connection-manager.js";
import type { ProviderAdapter, SignInResult } from "../../packages/main/src/provider-adapter.js";
import type { ProviderModel, ConnectionEvent } from "../../packages/contracts/src/index.js";
export interface ConformanceOptions {
  readonly transport?: ResponseTransport;
  readonly requestOutcome?: "completed" | "refused" | "content_filtered";
  readonly connect?: (signal: AbortSignal) => Promise<SignInResult>;
  readonly probe?: (signal: AbortSignal) => Promise<readonly ProviderModel[]>;
  readonly credentials?: ProviderAdapter["credentials"];
}
/** Each adapter supplies a synthetic harness; no paid access or personal credentials are used. */
export function providerConformance(
  name: string,
  create: (options?: ConformanceOptions) => ProviderAdapter,
): void {
  describe(`${name} adapter conformance`, () => {
    it("starts, inspects and completes a self-contained text request while declaring resume unsupported", async () => {
      const adapter = create({
        transport: async (options) => {
          const body = JSON.parse(options.body);
          expect(Object.keys(body).sort()).toEqual([
            "input",
            "instructions",
            "model",
            "store",
            "stream",
          ]);
          expect(body.instructions).toBe(developmentTest.instructions);
          expect(body).toMatchObject({ store: false, stream: true });
          options.release();
          return new Response(
            'data: {"type":"response.output_text.delta","delta":"Synthetic reply."}\n\ndata: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Synthetic reply."}]}]}}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
      const manager = new ConnectionManager([adapter]);
      try {
        const id = adapter.declaration.connection.id;
        manager.connect(id);
        await vi.waitFor(() => expect(manager.snapshot(id)?.state).toBe("connected"));
        expect(adapter.requests).toBeDefined();
        expect(await adapter.requests!.prepare()).toBe("ready");
        expect(adapter.requests!.resume()).toBe("unsupported");
        const events: RequestObservation[] = [];
        const handle = adapter.requests!.start(
          {
            attempt: "conformance-attempt",
            operation: "development_test",
            connection: id,
            model: "synthetic-model",
            instructions: { reference: "instructions", text: developmentTest.instructions },
            input: [{ reference: "message", role: "user", content: "Synthetic question." }],
            limits: { max_input_bytes: 16384, max_input_items: 20, max_output_bytes: 16384 },
          },
          {
            signal: new AbortController().signal,
            authorizeBody: () => undefined,
            emit: (event) => {
              events.push(event);
            },
          },
        );
        await handle.done;
        expect(handle.inspect()).toBe("finished");
        expect(events[0]).toEqual({ kind: "started" });
        expect(events).toContainEqual({ kind: "text", text: "Synthetic reply." });
        expect(events.at(-1)).toEqual({
          kind: "final",
          result: { outcome: "completed", dispatched: true },
        });
        handle.interrupt();
        expect(events.filter((e) => e.kind === "final")).toHaveLength(1);
      } finally {
        manager.dispose();
      }
    });
    it.each(["refused", "content_filtered"] as const)(
      "preserves %s as a non-error outcome with classified refusal content",
      async (outcome) => {
        const refusal = "Synthetic refusal.";
        const output = [
          { type: "message", role: "assistant", content: [{ type: "refusal", refusal }] },
        ];
        const adapter = create({
          requestOutcome: outcome,
          transport: async (options) => {
            options.release();
            const terminal =
              outcome === "refused"
                ? { type: "response.completed", response: { output } }
                : {
                    type: "response.incomplete",
                    response: { output, incomplete_details: { reason: "content_filter" } },
                  };
            return new Response(
              "data: " +
                JSON.stringify({ type: "response.refusal.delta", delta: refusal }) +
                "\n\n" +
                "data: " +
                JSON.stringify(terminal) +
                "\n\n",
              { headers: { "content-type": "text/event-stream" } },
            );
          },
        });
        const manager = new ConnectionManager([adapter]);
        try {
          const connection = adapter.declaration.connection.id;
          manager.connect(connection);
          await vi.waitFor(() => expect(manager.snapshot(connection)?.state).toBe("connected"));
          expect(await adapter.requests!.prepare()).toBe("ready");
          const events: RequestObservation[] = [];
          const handle = adapter.requests!.start(
            {
              attempt: "conformance-attempt",
              operation: "development_test",
              connection,
              model: "synthetic-model",
              instructions: { reference: "instructions", text: developmentTest.instructions },
              input: [{ reference: "message", role: "user", content: "Synthetic question." }],
              limits: { max_input_bytes: 16384, max_input_items: 20, max_output_bytes: 16384 },
            },
            {
              signal: new AbortController().signal,
              authorizeBody: () => undefined,
              emit: (event) => {
                events.push(event);
              },
            },
          );
          await handle.done;
          expect(events[0]).toEqual({ kind: "started" });
          expect(events.filter((event) => event.kind === "refusal")).toEqual([
            { kind: "refusal", text: refusal },
          ]);
          expect(events.some((event) => event.kind === "text")).toBe(false);
          expect(events.at(-1)).toEqual({ kind: "final", result: { outcome, dispatched: true } });
          expect(manager.snapshot(connection)).toMatchObject({ state: "connected", reason: null });
        } finally {
          manager.dispose();
        }
      },
    );
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
