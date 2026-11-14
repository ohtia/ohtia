import {
  dispatchPermitPolicy,
  isProviderEvent,
  providerMessageVersion,
  providerTextPieces,
  type ConnectionState,
  type DiagnosticEvent,
  type NotDispatchedReason,
  type ProviderDispatchMessage,
  type ProviderEventBody,
  type ProviderInterruptMessage,
  type ProviderResult,
  type ProviderRequestLimits,
} from "@ohtia/contracts";
import type { ProviderAdapter, ProviderRequestControl } from "./provider-adapter.js";

interface Dispatched {
  readonly generation: string;
  readonly attempt: string;
  readonly abort: AbortController;
  sequence: number;
  released: boolean;
  done: boolean;
  closing?: ProviderResult;
  timer?: ReturnType<typeof setTimeout>;
  readonly limits: ProviderRequestLimits;
  readonly startedWall: number;
  readonly startedMono: number;
  elapsed: number;
  lastEvent: number;
  readonly closed: Promise<void>;
  readonly acknowledgeClosed: () => void;
}
function resultDiagnostic(result: ProviderResult): DiagnosticEvent {
  switch (result.status) {
    case "completed":
      return { event_name: "ohtia.provider.completed" };
    case "cancelled":
      return { event_name: "ohtia.provider.cancelled" };
    case "uncertain":
      return { event_name: "ohtia.provider.uncertain", error_code: "connection_lost" };
    case "failed":
      return result.dispatched
        ? { event_name: "ohtia.provider.failed", error_code: result.reason }
        : { event_name: "ohtia.provider.not_dispatched", error_code: result.reason };
  }
}

/**
 * Main's half of ADR-0028. Main holds the credential and sends the request only after its guards:
 * the permit's age, one renewal of an expired session, the connection state, and the permit's age
 * again just before the body leaves. It forwards every event without keeping a copy.
 */
export class ProviderDispatch {
  private active: string | undefined;
  private readonly closingRequests = new Set<Promise<void>>();
  get ceased(): boolean {
    return this.closingRequests.size === 0;
  }
  async drain(): Promise<void> {
    await Promise.all(this.closingRequests);
  }
  private readonly used = new Set<string>();
  private readonly records = new Map<string, Dispatched>();
  private readonly adapters = new Map<string, ProviderAdapter>();
  constructor(
    adapters: readonly ProviderAdapter[],
    private readonly options: {
      readonly state: (connection: string) => ConnectionState | undefined;
      /** Post one message to the data service of that generation. */
      readonly send: (generation: string, text: string) => void;
      readonly diagnostic?: (event: DiagnosticEvent) => void;
      readonly wallClock?: () => number;
      readonly monotonic?: () => number;
    },
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.declaration.connection.id, adapter);
  }
  private wall(): number {
    return (this.options.wallClock ?? Date.now)();
  }
  private monotonic(): number {
    return (this.options.monotonic ?? (() => performance.now()))();
  }
  /** A new data service takes over; nothing of an earlier generation is sent or forwarded again. */
  begin(generation: string): void {
    this.end();
    this.active = generation;
  }
  /** Close every request the ending generation dispatched and drop their later events. */
  end(generation?: string): void {
    if (generation !== undefined && generation !== this.active) return;
    for (const record of this.records.values()) {
      record.done = true;
      clearTimeout(record.timer);
      record.abort.abort();
    }
    this.records.clear();
    this.used.clear();
    this.active = undefined;
  }
  /** The architecture's `inspect`: whether main still has this attempt's request open. */
  query(attempt: string): "running" | "unknown" {
    return this.records.has(attempt) ? "running" : "unknown";
  }
  interrupt(message: ProviderInterruptMessage): void {
    if (message.generation !== this.active) return;
    const record = this.records.get(message.attempt);
    if (!record) return;
    this.finish(record, { status: "cancelled" });
  }
  async receive(message: ProviderDispatchMessage): Promise<void> {
    const { request, permit } = message;
    // Discarded without a result: an ended generation, a used permit or an attempt already open.
    if (
      message.generation !== this.active ||
      this.used.has(permit.id) ||
      this.records.has(request.attempt)
    ) {
      this.options.diagnostic?.({ event_name: "ohtia.provider.discarded" });
      return;
    }
    this.used.add(permit.id);
    let acknowledgeClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      acknowledgeClosed = resolve;
    });
    this.closingRequests.add(closed);
    const record: Dispatched = {
      closed,
      acknowledgeClosed,
      generation: message.generation,
      attempt: request.attempt,
      abort: new AbortController(),
      sequence: 0,
      released: false,
      done: false,
      limits: request.limits,
      startedWall: Math.min(this.wall(), permit.issued_at),
      startedMono: this.monotonic(),
      elapsed: 0,
      lastEvent: 0,
    };
    this.records.set(request.attempt, record);
    this.arm(record);
    try {
      // The permit's age counts wall time, which includes suspension, and never less than the
      // monotonic time main itself has held it; a permit from the future is refused.
      const receivedAge = this.wall() - permit.issued_at;
      const received = this.monotonic();
      const fresh = () =>
        permit.attempt === request.attempt &&
        receivedAge >= 0 &&
        Math.max(this.wall() - permit.issued_at, receivedAge + this.monotonic() - received) <
          dispatchPermitPolicy.validity_ms;
      const refuse = (reason: NotDispatchedReason) => {
        // Proven zero-dispatch refusals keep their reason, even if this old permit's age
        // also exceeds a response limit. No provider request began under that permit.
        this.finish(record, { status: "failed", reason, dispatched: false });
      };
      if (!fresh()) {
        refuse("permit_expired");
        return;
      }
      const adapter = this.adapters.get(request.connection);
      if (!adapter?.requests || !adapter.declaration.capabilities.text) {
        refuse("connection_expired");
        return;
      }
      let prepared: "ready" | "rejected" | "temporary";
      try {
        prepared = await adapter.requests.prepare(record.abort.signal);
      } catch {
        prepared = "temporary";
      }
      if (record.done || record.closing) return;
      if (prepared !== "ready") {
        refuse(prepared === "rejected" ? "connection_expired" : "provider_unavailable");
        return;
      }
      if (this.options.state(request.connection) !== "connected") {
        refuse("connection_expired");
        return;
      }
      // The renewal's own outcome decides its reason. From here on, once the permit can no longer
      // pass, close a connection that is still being set up instead of leaving it open.
      const expiry = setTimeout(
        () => {
          if (!record.released) refuse("permit_expired");
        },
        Math.max(
          0,
          dispatchPermitPolicy.validity_ms -
            Math.max(this.wall() - permit.issued_at, receivedAge + this.monotonic() - received),
        ),
      );
      record.abort.signal.addEventListener("abort", () => {
        clearTimeout(expiry);
      });
      const control: ProviderRequestControl = {
        signal: record.abort.signal,
        emit: (event) => {
          // Before the body leaves, only a not-dispatched failure can describe this attempt.
          if (
            !record.released &&
            !(
              event.type === "result" &&
              event.result.status === "failed" &&
              !event.result.dispatched
            )
          )
            return;
          this.emit(record, event);
        },
        release: () => {
          if (record.done || record.closing || this.expired(record) || record.released)
            return false;
          if (!fresh()) {
            refuse("permit_expired");
            return false;
          }
          // The connection can end while the transport connects, as when the researcher signs out.
          if (this.options.state(request.connection) !== "connected") {
            refuse("connection_expired");
            return false;
          }
          clearTimeout(expiry);
          record.released = true;
          this.options.diagnostic?.({ event_name: "ohtia.provider.dispatched" });
          return true;
        },
      };
      try {
        await adapter.requests.send(request, control);
      } catch {
        /* The result below states what main can still know. */
      }
      // Still open when the adapter ended without its own result.
      if (this.records.get(record.attempt) === record)
        this.emit(record, {
          type: "result",
          result: record.released
            ? { status: "uncertain", reason: "connection_lost" }
            : { status: "failed", reason: "provider_unavailable", dispatched: false },
        });
    } finally {
      // send() resolves only after its transport has closed. A cancellation request alone
      // cannot release the data service's capacity claim.
      try {
        this.closed(record);
      } finally {
        record.acknowledgeClosed();
        this.closingRequests.delete(record.closed);
      }
    }
  }
  private elapsed(record: Dispatched): number {
    record.elapsed = Math.max(
      record.elapsed,
      this.wall() - record.startedWall,
      this.monotonic() - record.startedMono,
    );
    return record.elapsed;
  }
  private expired(record: Dispatched): boolean {
    if (record.done || record.closing) return true;
    const elapsed = this.elapsed(record);
    const reason =
      elapsed >= record.limits.max_attempt_duration_ms
        ? "deadline_exceeded"
        : elapsed - record.lastEvent >= record.limits.max_inactivity_ms
          ? "inactivity_timeout"
          : null;
    if (!reason) return false;
    this.finish(record, { status: "failed", reason, dispatched: true });
    return true;
  }
  private arm(record: Dispatched): void {
    clearTimeout(record.timer);
    if (record.done || record.closing) return;
    const elapsed = this.elapsed(record);
    const remaining = Math.min(
      record.limits.max_attempt_duration_ms - elapsed,
      record.limits.max_inactivity_ms - (elapsed - record.lastEvent),
    );
    record.timer = setTimeout(
      () => {
        if (!this.expired(record)) this.arm(record);
      },
      Math.max(0, Math.min(remaining, 2_147_483_647)),
    );
    record.timer.unref();
  }
  private finish(record: Dispatched, result: ProviderResult): void {
    if (record.done || record.closing) return;
    record.closing = result;
    clearTimeout(record.timer);
    record.abort.abort();
  }
  private closed(record: Dispatched): void {
    if (record.done || !record.closing) return;
    record.done = true;
    clearTimeout(record.timer);
    this.records.delete(record.attempt);
    this.options.diagnostic?.(resultDiagnostic(record.closing));
    this.options.send(
      record.generation,
      JSON.stringify({
        kind: "provider_event",
        version: providerMessageVersion,
        generation: record.generation,
        attempt: record.attempt,
        event: { type: "result", sequence: ++record.sequence, result: record.closing },
      }),
    );
  }
  private emit(record: Dispatched, body: ProviderEventBody): void {
    if (this.expired(record)) return;
    const bodies: readonly ProviderEventBody[] =
      body.type === "text"
        ? providerTextPieces(body.text).map((text) => ({ type: "text" as const, text }))
        : [body];
    for (const piece of bodies) {
      const sequenced = { ...piece, sequence: record.sequence + 1 };
      if (!isProviderEvent(sequenced)) {
        // An adapter defect must not forge a malformed event or leave the attempt open.
        this.emit(record, {
          type: "result",
          result: record.released
            ? { status: "failed", reason: "invalid_output", dispatched: true }
            : { status: "failed", reason: "provider_unavailable", dispatched: false },
        });
        return;
      }
      record.sequence++;
      if (sequenced.type === "result") {
        record.sequence--; // The terminal sequence is assigned after confirmed transport closure.
        this.finish(record, sequenced.result);
        return;
      }
      record.lastEvent = this.elapsed(record);
      this.arm(record);
      this.options.send(
        record.generation,
        JSON.stringify({
          kind: "provider_event",
          version: providerMessageVersion,
          generation: record.generation,
          attempt: record.attempt,
          event: sequenced,
        }),
      );
    }
  }
  dispose(): void {
    this.end();
  }
}
