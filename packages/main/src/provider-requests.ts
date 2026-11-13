import {
  decodeProviderMessage,
  dispatchPolicy,
  type ProviderMessage,
  type ProviderEvent,
  type ProviderResult,
  type ProviderRequestData,
  type DiagnosticEvent,
} from "@ohtia/contracts";
import type { ConnectionManager } from "./connection-manager.js";
import type { ProviderAdapter } from "./provider-adapter.js";

export type RequestObservation = ProviderEvent extends infer E
  ? E extends ProviderEvent
    ? Omit<E, "sequence">
    : never
  : never;
export interface RequestContext {
  readonly signal: AbortSignal;
  /** Second guard: invoked by transport immediately before attaching credentials and releasing body. */
  readonly authorizeBody: () => "permit_expired" | "connection_expired" | undefined;
  readonly emit: (event: RequestObservation) => void;
}
export interface ProviderRequestHandle {
  readonly done: Promise<void>;
  interrupt(): void;
  inspect(): "running" | "finished";
}
export interface InferenceRequests {
  prepare(): Promise<"ready" | "connection_expired" | "provider_unavailable">;
  start(request: ProviderRequestData, context: RequestContext): ProviderRequestHandle;
  resume(
    request?: ProviderRequestData,
    context?: RequestContext,
  ): ProviderRequestHandle | "unsupported";
}
/** Main retains lifecycle handles and replay identities, never provider output. */
export class ProviderRequests {
  private readonly used = new Set<string>();
  private readonly attempts = new Set<string>();
  private readonly active = new Map<
    string,
    { abort: AbortController; handle?: ProviderRequestHandle }
  >();
  private ended = false;
  private suspendEpoch = 0;
  private validAfter = -1;
  constructor(
    readonly generation: string,
    private readonly manager: ConnectionManager,
    private readonly adapters: readonly ProviderAdapter[],
    private readonly send: (text: string) => void,
    private readonly now = Date.now,
    private readonly diagnostic?: (event: DiagnosticEvent) => void,
  ) {}
  receive(input: unknown): boolean {
    const message = decodeProviderMessage(input);
    if (!message || (message.kind !== "provider_dispatch" && message.kind !== "provider_interrupt"))
      return false;
    if (this.ended || message.generation !== this.generation) return true;
    if (message.kind === "provider_interrupt") {
      const work = this.active.get(message.attempt);
      work?.abort.abort();
      work?.handle?.interrupt();
      return true;
    }
    if (this.used.has(message.permit.id) || this.attempts.has(message.request.attempt)) return true;
    // Replay ledgers live until generation cessation. Bound memory without forgetting used permits.
    if (this.used.size >= 4096) return false;
    this.used.add(message.permit.id);
    this.attempts.add(message.request.attempt);
    const abort = new AbortController();
    this.active.set(message.request.attempt, { abort });
    void this.dispatch(message, abort);
    return true;
  }
  private isEnded(): boolean {
    return this.ended;
  }
  private async dispatch(
    message: Extract<ProviderMessage, { kind: "provider_dispatch" }>,
    abort: AbortController,
  ): Promise<void> {
    const { request, permit } = message;
    let sequence = 0;
    let final = false;
    const isFinal = () => final;
    const emit = (event: RequestObservation) => {
      if (this.isEnded() || isFinal()) return;
      if (event.kind === "started") this.diagnostic?.({ event_name: "ohtia.provider.started" });
      if (event.kind === "final") {
        final = true;
        const r = event.result;
        if (r.outcome === "uncertain")
          this.diagnostic?.({ event_name: "ohtia.provider.uncertain", error_code: r.reason });
        else if (r.outcome === "failed")
          this.diagnostic?.({ event_name: "ohtia.provider.failed", error_code: r.reason });
        else
          this.diagnostic?.({
            event_name: (
              {
                completed: "ohtia.provider.completed",
                cancelled: "ohtia.provider.cancelled",
                refused: "ohtia.provider.refused",
                content_filtered: "ohtia.provider.content_filtered",
              } as const
            )[r.outcome],
          });
      }
      this.send(
        JSON.stringify({
          version: 1,
          generation: this.generation,
          kind: "provider_event",
          attempt: request.attempt,
          event: { ...event, sequence: ++sequence },
        }),
      );
    };
    const fail = (reason: "permit_expired" | "connection_expired" | "provider_unavailable") => {
      emit({ kind: "final", result: { outcome: "failed", dispatched: false, reason } });
    };
    const epoch = this.suspendEpoch;
    const fresh = () => {
      const age = this.now() - permit.issued_at_ms;
      return (
        permit.issued_at_ms > this.validAfter &&
        epoch === this.suspendEpoch &&
        age >= 0 &&
        age < dispatchPolicy.validity_ms
      );
    };
    try {
      if (!fresh()) {
        fail("permit_expired");
        return;
      }
      const adapter = this.adapters.find((a) => a.declaration.connection.id === request.connection);
      if (!adapter?.requests) {
        fail("provider_unavailable");
        return;
      }
      // Read only the main-owned connection state. Credentials never leave the adapter.
      if (this.manager.snapshot(request.connection)?.state !== "connected") {
        fail("connection_expired");
        return;
      }
      const prepared = await adapter.requests.prepare();
      if (this.isEnded()) return;
      if (abort.signal.aborted) {
        emit({ kind: "final", result: { outcome: "cancelled", dispatched: false } });
        return;
      }
      if (prepared !== "ready") {
        fail(prepared);
        return;
      }
      if (this.manager.snapshot(request.connection)?.state !== "connected") {
        fail("connection_expired");
        return;
      }
      if (!fresh()) {
        fail("permit_expired");
        return;
      }
      const authorizeBody = () =>
        !fresh()
          ? ("permit_expired" as const)
          : this.manager.snapshot(request.connection)?.state !== "connected"
            ? ("connection_expired" as const)
            : undefined;
      const work = this.active.get(request.attempt);
      if (!work) return;
      work.handle = adapter.requests.start(request, { signal: abort.signal, authorizeBody, emit });
      await work.handle.done;
      if (!isFinal() && !this.isEnded())
        emit({
          kind: "final",
          result: { outcome: "uncertain", dispatched: true, reason: "connection_lost" },
        });
    } catch {
      if (!isFinal() && !this.isEnded()) {
        const result: ProviderResult = this.active.get(request.attempt)?.handle
          ? { outcome: "uncertain", dispatched: true, reason: "connection_lost" }
          : { outcome: "failed", dispatched: false, reason: "provider_unavailable" };
        emit({ kind: "final", result });
      }
    } finally {
      this.active.delete(request.attempt);
    }
  }
  /** Invalidate permits on both sides of suspension; wall time also accounts for elapsed sleep. */
  invalidatePermits(): void {
    this.suspendEpoch++;
    this.validAfter = this.now();
  }
  end(): void {
    this.ended = true;
    for (const { abort, handle } of this.active.values()) {
      abort.abort();
      handle?.interrupt();
    }
    this.active.clear();
    this.used.clear();
    this.attempts.clear();
  }
}
