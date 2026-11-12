import { describe, it, expect, vi } from "vitest";
import {
  isProviderDeclaration,
  connectionReasonMatches,
} from "../../packages/contracts/src/index.js";
import { ConnectionManager } from "../../packages/main/src/connection-manager.js";
import type { ProviderAdapter, SignInResult } from "../../packages/main/src/provider-adapter.js";
import type { ProviderModel, ConnectionEvent } from "../../packages/contracts/src/index.js";
export interface ConformanceOptions {
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
