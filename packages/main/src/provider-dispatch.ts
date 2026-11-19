import {
  dispatchPermitPolicy,
  isProviderEvent,
  isProviderToolLabel,
  isConsultationTool,
  requestsConversationTitle,
  conversationTitlePolicy,
  conversationTitleInstructionSuffix,
  isConversationTitleTool,
  validConversationTitle,
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
  type ServiceWakeMessage,
} from "@ohtia/contracts";
import type {
  ProviderAdapter,
  ProviderRequestControl,
  AdapterEvent,
  BufferedToolCall,
} from "./provider-adapter.js";

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
  outputBytes: number;
  conversationTitle: boolean;
  consultationEnabled: boolean;
  readonly calls: Map<string | symbol, BufferedToolCall>;
  sampledWall: number;
  sampledMono: number;
  suspendedElapsed?: number;
  elapsed: number;
  lastEvent: number;
  readonly closed: Promise<void>;
  readonly acknowledgeClosed: () => void;
}
/** An optional title is only metadata of one successfully completed, bounded reply. */
function titleSuggestion(calls: Iterable<BufferedToolCall>): string | undefined {
  const matching = [...calls].filter(isConversationTitleTool);
  const call = matching[0];
  if (
    matching.length !== 1 ||
    !call?.complete ||
    Buffer.byteLength(call.arguments, "utf8") > conversationTitlePolicy.max_argument_bytes
  )
    return;
  try {
    const value: unknown = JSON.parse(call.arguments);
    if (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 1 &&
      "title" in value &&
      validConversationTitle(value.title)
    )
      return value.title;
  } catch {
    // Invalid optional arguments leave the reply usable.
  }
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
 * again just before the body leaves. It streams text and buffers bounded tool calls until completion.
 */
export class ProviderDispatch {
  private active: string | undefined;
  private resumedAt = -Infinity;
  private pendingWake: ServiceWakeMessage | undefined;
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
  suspend(): void {
    for (const record of this.records.values()) record.suspendedElapsed = this.elapsed(record);
  }
  wake(message: ServiceWakeMessage): void {
    if (message.generation !== this.active) return;
    this.resumedAt = Date.parse(message.resumedAt);
    this.pendingWake = message;
    for (const record of this.records.values()) {
      const suspended = record.suspendedElapsed;
      const elapsed = this.elapsed(record);
      // A request admitted after suspend has no snapshot. Its sampled clocks may
      // already include sleep; do not add that interval to the observed elapsed time twice.
      record.elapsed = Math.max(elapsed, (suspended ?? 0) + message.asleepMs);
      delete record.suspendedElapsed;
      // Every pending request here predates this wake, even if the wall clock went backwards.
      if (!record.released)
        this.finish(record, { status: "failed", reason: "permit_expired", dispatched: false });
      else if (!this.expired(record)) this.arm(record);
    }
  }
  /** The ordered peer echoes the exact observation after review and before fresh permits. */
  wakeReviewed(message: ServiceWakeMessage): void {
    const pending = this.pendingWake;
    if (
      pending &&
      message.generation === this.active &&
      message.suspendedAt === pending.suspendedAt &&
      message.resumedAt === pending.resumedAt &&
      message.asleepMs === pending.asleepMs
    )
      this.pendingWake = undefined;
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
    this.pendingWake = undefined;
    this.resumedAt = -Infinity;
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
      outputBytes: 0,
      conversationTitle: requestsConversationTitle(request),
      consultationEnabled: request.tools.some(isConsultationTool),
      calls: new Map(),
      sampledWall: this.wall(),
      sampledMono: this.monotonic(),
      elapsed: Math.max(0, this.wall() - permit.issued_at),
      lastEvent: 0,
    };
    this.records.set(request.attempt, record);
    this.arm(record);
    try {
      // The permit's age counts wall time, which includes suspension, and never less than the
      // monotonic time main itself has held it; a permit from the future is refused.
      const receivedAge = this.wall() - permit.issued_at;
      const received = this.monotonic();
      const fresh = () => {
        const age = this.wall() - permit.issued_at;
        return (
          !this.pendingWake &&
          permit.attempt === request.attempt &&
          permit.issued_at >= this.resumedAt &&
          receivedAge >= 0 &&
          age >= 0 &&
          Math.max(age, receivedAge + this.monotonic() - received) <
            dispatchPermitPolicy.validity_ms
        );
      };
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
        const providerRequest =
          (record.conversationTitle || record.consultationEnabled) &&
          !adapter.declaration.capabilities.tools
            ? {
                ...request,
                tools: [],
                instructions: request.instructions.endsWith(conversationTitleInstructionSuffix)
                  ? request.instructions.slice(0, -conversationTitleInstructionSuffix.length)
                  : request.instructions,
              }
            : request;
        if (providerRequest !== request) {
          record.conversationTitle = false;
          record.consultationEnabled = false;
        }
        await adapter.requests.send(providerRequest, control);
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
    const wall = this.wall();
    const mono = this.monotonic();
    record.elapsed += Math.max(0, wall - record.sampledWall, mono - record.sampledMono);
    record.sampledWall = wall;
    record.sampledMono = mono;
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
    this.finish(
      record,
      record.released
        ? { status: "failed", reason, dispatched: true }
        : { status: "failed", reason: "permit_expired", dispatched: false },
    );
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
    if (result.status === "completed" && record.conversationTitle) {
      const title = titleSuggestion(record.calls.values());
      if (title !== undefined) result = { status: "completed", conversation_title: title };
      for (const [id, call] of record.calls)
        if (isConversationTitleTool(call)) record.calls.delete(id);
    }
    if (
      result.status === "completed" &&
      [...record.calls.values()].some(
        (call) =>
          !call.complete ||
          !isProviderEvent({
            type: "tool_call",
            sequence: 1,
            namespace: call.namespace,
            name: call.name,
            arguments: call.arguments,
          }),
      )
    )
      result = { status: "failed", reason: "invalid_output", dispatched: true };
    if (result.status !== "completed") record.calls.clear();
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
    if (record.closing.status === "completed") {
      for (const call of record.calls.values()) {
        this.options.send(
          record.generation,
          JSON.stringify({
            kind: "provider_event",
            version: providerMessageVersion,
            generation: record.generation,
            attempt: record.attempt,
            event: {
              type: "tool_call",
              sequence: ++record.sequence,
              namespace: call.namespace,
              name: call.name,
              arguments: call.arguments,
            },
          }),
        );
      }
    }
    record.calls.clear();
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
  private emit(record: Dispatched, body: AdapterEvent): void {
    if (this.expired(record)) return;
    const invalid = () => {
      this.finish(record, { status: "failed", reason: "invalid_output", dispatched: true });
    };
    const account = (text: string): string | undefined => {
      const remaining = record.limits.max_output_bytes - record.outputBytes;
      const size = Buffer.byteLength(text, "utf8");
      if (size <= remaining) {
        record.outputBytes += size;
        return text;
      }
      // Count monotonically, retaining no overflowing argument bytes.
      record.outputBytes = record.limits.max_output_bytes;
      return undefined;
    };
    // Only main can issue a title in a result, after counting the actual tool argument bytes.
    if (
      body.type === "result" &&
      body.result.status === "completed" &&
      Object.hasOwn(body.result, "conversation_title")
    )
      body = { type: "result", result: { status: "completed" } };
    if (body.type === "tool_start") {
      if (
        !body.id ||
        body.id.length > 256 ||
        record.calls.has(body.id) ||
        record.calls.size >= record.limits.max_output_bytes ||
        (body.namespace !== null && !isProviderToolLabel(body.namespace)) ||
        !isProviderToolLabel(body.name)
      ) {
        invalid();
        return;
      }
      record.calls.set(body.id, {
        namespace: body.namespace,
        name: body.name,
        arguments: "",
        complete: false,
      });
    } else if (body.type === "tool_arguments") {
      const call = record.calls.get(body.id);
      if (!call || call.complete) {
        invalid();
        return;
      }
      if (account(body.text) === undefined) {
        this.finish(record, {
          status: "failed",
          reason: "output_limit_exceeded",
          dispatched: true,
        });
        return;
      }
      record.calls.set(body.id, { ...call, arguments: call.arguments + body.text });
    } else if (body.type === "tool_end") {
      const call = record.calls.get(body.id);
      if (!call || call.complete) {
        invalid();
        return;
      }
      const finalized = body.arguments ?? call.arguments;
      const matches = finalized.startsWith(call.arguments);
      if (!matches && (!record.conversationTitle || !isConversationTitleTool(call))) {
        invalid();
        return;
      }
      // Count a repeated prefix once and charge conflicting metadata before discarding it.
      if (account(matches ? finalized.slice(call.arguments.length) : finalized) === undefined) {
        this.finish(record, {
          status: "failed",
          reason: "output_limit_exceeded",
          dispatched: true,
        });
        return;
      }
      record.calls.set(body.id, { ...call, arguments: matches ? finalized : "", complete: true });
    } else if (body.type === "tool_call") {
      // Atomic calls from adapters follow exactly the same cumulative accounting.
      if (record.calls.size >= record.limits.max_output_bytes) {
        invalid();
        return;
      }
      if (account(body.arguments) === undefined) {
        this.finish(record, {
          status: "failed",
          reason: "output_limit_exceeded",
          dispatched: true,
        });
        return;
      }
      if (!isProviderEvent({ ...body, sequence: 1 })) {
        invalid();
        return;
      }
      record.calls.set(Symbol("atomic"), { ...body, complete: true });
    } else if (body.type === "text") {
      const remaining = record.limits.max_output_bytes - record.outputBytes;
      if (account(body.text) !== undefined) {
        this.forward(record, body);
        return;
      }
      let prefix = "";
      let bytes = 0;
      for (const point of body.text) {
        const size = Buffer.byteLength(point, "utf8");
        if (bytes + size > remaining) break;
        prefix += point;
        bytes += size;
      }
      if (prefix) this.forward(record, { type: "text", text: prefix });
      this.finish(record, { status: "failed", reason: "output_limit_exceeded", dispatched: true });
      return;
    } else {
      this.forward(record, body);
      return;
    }
    // Arguments are withheld as research effects, but their receipt is still provider activity.
    this.forward(record, { type: "activity" });
  }
  private forward(record: Dispatched, body: ProviderEventBody): void {
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
