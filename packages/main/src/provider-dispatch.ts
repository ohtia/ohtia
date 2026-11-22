import { randomUUID } from "node:crypto";
import {
  dispatchPermitPolicy,
  isProviderEvent,
  isAccountFingerprint,
  isProviderToolLabel,
  isCollaborationProposal,
  isHandoffTool,
  isPlanChangeTool,
  isMemoryTool,
  requestsConversationTitle,
  conversationTitlePolicy,
  conversationTitleInstructionSuffix,
  isConversationTitleTool,
  validConversationTitle,
  providerMessageVersion,
  portLimits,
  type LateUsageDecision,
  type LateUsageReceipt,
  type LateUsageReport,
  providerTextChunk,
  providerTextPieces,
  utf8Size,
  type ConnectionState,
  type DiagnosticEvent,
  type NotDispatchedReason,
  type ProviderDispatchMessage,
  type ProviderEventBody,
  type ProviderEvent,
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

// Give closely spaced provider deltas one bounded interval to share a channel message.
const textFlushMs = 16;

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
  inputBytes: number;
  outputBytes: number;
  pendingText: string;
  textTimer: ReturnType<typeof setTimeout> | undefined;
  releasedAt?: number;
  terminalClock?: { wall: number; monotonic: number };
  conversationTitle: boolean;
  proposalToolsEnabled: boolean;
  handoffToolEnabled: boolean;
  planChangeToolEnabled: boolean;
  memoryToolEnabled: boolean;
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
  private readonly pendingUsage = new Map<
    string,
    {
      attempt: string;
      complete: (decision: LateUsageDecision) => void;
    }
  >();
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
      readonly mayDispatchModel?: (
        connection: string,
        model: string,
        effort?: string,
        expectedAccount?: string,
      ) => boolean;
      readonly send: (generation: string, text: string) => void;
      readonly diagnostic?: (event: DiagnosticEvent, generation: string) => void;
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
  /** A new data service takes over; earlier generations lose all execution authority. */
  begin(generation: string): void {
    this.end();
    this.active = generation;
  }
  /** Close every request the ending generation dispatched and drop their later events. */
  end(generation?: string): void {
    if (generation !== undefined && generation !== this.active) return;
    for (const record of this.records.values()) {
      record.terminalClock ??= { wall: this.wall(), monotonic: this.monotonic() };
      record.done = true;
      clearTimeout(record.timer);
      clearTimeout(record.textTimer);
      record.abort.abort();
    }
    this.records.clear();
    for (const pending of this.pendingUsage.values())
      pending.complete({ accepted: false, code: "receipt_unavailable" });
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
      this.options.diagnostic?.({ event_name: "ohtia.provider.discarded" }, message.generation);
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
      inputBytes: 0,
      outputBytes: 0,
      pendingText: "",
      textTimer: undefined,
      conversationTitle: requestsConversationTitle(request),
      proposalToolsEnabled: request.tools.some(isCollaborationProposal),
      handoffToolEnabled: request.tools.some(isHandoffTool),
      planChangeToolEnabled: request.tools.some(isPlanChangeTool),
      memoryToolEnabled: request.tools.some(isMemoryTool),
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
        ...(adapter.declaration.capabilities.late_usage === "reported"
          ? {
              reportLateUsage: (report: LateUsageReport) => this.reportLateUsage(record, report),
            }
          : {}),
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
        release: (fingerprint) => {
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
          if (
            this.options.mayDispatchModel &&
            !this.options.mayDispatchModel(
              request.connection,
              request.model,
              request.effort,
              request.catalog_account_fingerprint,
            )
          ) {
            refuse("permit_expired");
            return false;
          }
          clearTimeout(expiry);
          record.released = true;
          record.releasedAt = this.elapsed(record);
          if (isAccountFingerprint(fingerprint))
            this.sendEvent(record, {
              type: "started",
              sequence: ++record.sequence,
              account_fingerprint: fingerprint,
              model: null,
              provider_request_id: null,
            });
          this.options.diagnostic?.({ event_name: "ohtia.provider.dispatched" }, record.generation);
          if (record.conversationTitle)
            this.options.diagnostic?.(
              { event_name: "ohtia.provider.title_requested" },
              record.generation,
            );
          return true;
        },
      };
      try {
        const titleInstructions = conversationTitleInstructionSuffix(request.operation);
        const providerRequest =
          (record.conversationTitle || record.proposalToolsEnabled || record.memoryToolEnabled) &&
          !adapter.declaration.capabilities.tools
            ? {
                ...request,
                tools: request.tools.filter(
                  (tool) =>
                    !isConversationTitleTool(tool) &&
                    !isCollaborationProposal(tool) &&
                    !isMemoryTool(tool),
                ),
                instructions: request.instructions.endsWith(titleInstructions)
                  ? request.instructions.slice(0, -titleInstructions.length)
                  : request.instructions,
              }
            : request;
        if (providerRequest !== request) {
          record.conversationTitle = false;
          record.proposalToolsEnabled = false;
          record.handoffToolEnabled = false;
          record.planChangeToolEnabled = false;
          record.memoryToolEnabled = false;
        }
        // Count the UTF-8 input items in the same units as the operation policy.
        record.inputBytes = providerRequest.input.reduce(
          (total, item) => total + utf8Size(item.text),
          0,
        );
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
    this.flushText(record);
    if (this.records.get(record.attempt) !== record) return;
    for (const [id, call] of record.calls)
      if (
        (!record.handoffToolEnabled && isHandoffTool(call)) ||
        (!record.planChangeToolEnabled && isPlanChangeTool(call)) ||
        (!record.memoryToolEnabled && isMemoryTool(call))
      )
        record.calls.delete(id);
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
    record.terminalClock ??= { wall: this.wall(), monotonic: this.monotonic() };
    clearTimeout(record.timer);
    record.abort.abort();
  }
  private closed(record: Dispatched): void {
    if (record.done || !record.closing) return;
    record.done = true;
    clearTimeout(record.timer);
    this.records.delete(record.attempt);
    this.options.diagnostic?.(resultDiagnostic(record.closing), record.generation);
    if (record.closing.status === "completed") {
      if (record.conversationTitle)
        this.options.diagnostic?.(
          {
            event_name:
              record.closing.conversation_title === undefined
                ? "ohtia.provider.title_omitted"
                : "ohtia.provider.title_suggested",
          },
          record.generation,
        );
      for (const call of record.calls.values())
        this.sendEvent(record, {
          type: "tool_call",
          sequence: ++record.sequence,
          namespace: call.namespace,
          name: call.name,
          arguments: call.arguments,
        });
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
        work:
          record.releasedAt === undefined ||
          (record.closing.status === "failed" && !record.closing.dispatched)
            ? { dispatched: false, input_bytes: 0, output_bytes: 0, work_ms: 0 }
            : {
                dispatched: true,
                input_bytes: record.inputBytes,
                output_bytes: record.outputBytes,
                work_ms: Math.ceil(
                  Math.min(
                    record.limits.max_attempt_duration_ms,
                    this.elapsed(record) - record.releasedAt,
                  ),
                ),
              },
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
        this.bufferText(record, body.text);
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
      if (prefix) this.bufferText(record, prefix);
      this.finish(record, { status: "failed", reason: "output_limit_exceeded", dispatched: true });
      return;
    } else {
      this.forward(record, body);
      return;
    }
    // Arguments are withheld as research effects, but their receipt is still provider activity.
    this.forward(record, { type: "activity" });
  }
  private bufferText(record: Dispatched, text: string): void {
    if (!text) return;
    for (const piece of providerTextPieces(text)) {
      if (!isProviderEvent({ type: "text", sequence: 1, text: piece })) {
        this.finish(record, { status: "failed", reason: "invalid_output", dispatched: true });
        return;
      }
      if (record.pendingText.length + piece.length > providerTextChunk) this.flushText(record);
      if (record.done) return;
      record.pendingText += piece;
    }
    if (!record.pendingText) return;
    record.lastEvent = this.elapsed(record);
    this.arm(record);
    if (!record.textTimer) {
      record.textTimer = setTimeout(() => {
        this.flushText(record);
      }, textFlushMs);
      record.textTimer.unref();
    }
  }
  private flushText(record: Dispatched): void {
    clearTimeout(record.textTimer);
    record.textTimer = undefined;
    const text = record.pendingText;
    record.pendingText = "";
    if (text && !record.done)
      this.sendEvent(record, { type: "text", sequence: ++record.sequence, text });
  }
  private forward(record: Dispatched, body: ProviderEventBody): void {
    if (this.expired(record)) return;
    // Account metadata is attached by the dispatch guard. Usage after closure is a separate path.
    if (body.type === "late_usage") return;
    const sequenced =
      body.type === "started"
        ? {
            type: body.type,
            model: body.model,
            ...(body.effort === undefined ? {} : { effort: body.effort }),
            provider_request_id: body.provider_request_id,
            sequence: 1,
          }
        : { ...body, sequence: 1 };
    if (!isProviderEvent(sequenced)) {
      // An adapter defect must not forge a malformed event or leave the attempt open.
      this.finish(
        record,
        record.released
          ? { status: "failed", reason: "invalid_output", dispatched: true }
          : { status: "failed", reason: "provider_unavailable", dispatched: false },
      );
      return;
    }
    if (sequenced.type === "result") {
      this.finish(record, sequenced.result);
      return;
    }
    this.flushText(record);
    if (record.done) return;
    record.lastEvent = this.elapsed(record);
    this.arm(record);
    this.sendEvent(record, { ...sequenced, sequence: ++record.sequence });
  }
  usageReceipt(receipt: LateUsageReceipt): void {
    const pending = this.pendingUsage.get(receipt.report_id);
    if (receipt.generation === this.active && pending?.attempt === receipt.attempt)
      pending.complete(receipt.decision);
  }
  private reportLateUsage(record: Dispatched, report: LateUsageReport): Promise<LateUsageDecision> {
    const unavailable = { accepted: false, code: "attempt_unavailable" } as const;
    const generation = this.active;
    if (
      !generation ||
      !record.done ||
      !record.released ||
      (record.closing?.status === "failed" && !record.closing.dispatched) ||
      this.pendingUsage.size >= portLimits.pending_global
    )
      return Promise.resolve(unavailable);
    const ended = record.terminalClock;
    if (!ended) return Promise.resolve(unavailable);
    const wall = this.wall();
    // Wall time covers sleep. The monotonic sample also detects a wall-clock setback.
    const unreliable =
      wall < ended.wall || this.monotonic() - ended.monotonic > wall - ended.wall + 1000;
    const reportId = randomUUID();
    const event = {
      ...report,
      type: "late_usage",
      report_id: reportId,
      terminal_at: new Date(ended.wall).toISOString(),
      sequence: record.sequence + 1,
      ...(unreliable ? { clock_unreliable: true } : {}),
    } as const;
    if (!isProviderEvent(event)) return Promise.resolve(unavailable);
    const missingReceipt = { accepted: false, code: "receipt_unavailable" } as const;
    return new Promise((resolve) => {
      const complete = (decision: LateUsageDecision) => {
        clearTimeout(timer);
        this.pendingUsage.delete(reportId);
        resolve(decision);
      };
      const timer = setTimeout(() => {
        complete(missingReceipt);
      }, portLimits.request_deadline_ms);
      timer.unref();
      this.pendingUsage.set(reportId, { attempt: record.attempt, complete });
      try {
        // Settlement can cross a data-service restart. Only the original attempt is addressed.
        this.sendEvent(record, event, generation);
      } catch {
        complete(missingReceipt);
      }
    });
  }
  private sendEvent(
    record: Dispatched,
    event: ProviderEvent,
    generation = record.generation,
  ): void {
    this.options.send(
      generation,
      JSON.stringify({
        kind: "provider_event",
        version: providerMessageVersion,
        generation,
        attempt: record.attempt,
        event,
      }),
    );
  }
  dispose(): void {
    this.end();
  }
}
