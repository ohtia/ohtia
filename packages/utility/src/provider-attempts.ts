import { randomUUID } from "node:crypto";
import {
  providerMessageVersion,
  type DevelopmentActionMessage,
  type DevelopmentReport,
  type ProviderDispatchMessage,
  type ProviderEventMessage,
  type ProviderEvent,
  type ProviderResult,
  type ProviderUsage,
  type ServiceConnections,
  type TransferEntry,
} from "@ohtia/contracts";
import { buildInput, operationPolicy, type InputMessage } from "./operations.js";

export type RuntimeMode = "development" | "installed" | "qualification";
interface Attempt {
  readonly id: string;
  readonly operationId: string;
  readonly transfer: readonly TransferEntry[];
  readonly started: number;
  last: number;
  longestSilence: number;
  sequence: number;
  usage: ProviderUsage;
  readonly events: ProviderEvent[];
}
const unknownUsage: ProviderUsage = Object.freeze({
  input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
});
/** The fixed request text lives in main's development command; this is only its reference. */
const developmentRequestReference = "development_request";
/** The development operation's pending limit bounds the attempts this story keeps in memory. */
const developmentPolicy = { operation: "development_test", version: 1 } as const;

/**
 * The data service's half of ADR-0028: it decides and prepares each request without credentials,
 * checks the connection just before sending, records what it sends and issues a single-use permit.
 * Ohtia never retries an attempt by itself. Attempts stay in memory until STORY-003-005 stores them.
 */
export class ProviderAttempts {
  private readonly attempts = new Map<string, Attempt>();
  private disposed = false;
  constructor(
    private readonly options: {
      readonly generation: string;
      readonly mode: RuntimeMode;
      readonly connections: ServiceConnections;
      readonly send: (text: string) => void;
      /** Wall clock for permits; it keeps counting through suspension. */
      readonly wallClock?: () => number;
      /** Monotonic clock for the measured duration and silences. */
      readonly monotonic?: () => number;
    },
  ) {}
  private now(): number {
    return (this.options.monotonic ?? (() => performance.now()))();
  }
  private report(operationId: string, report: DevelopmentReport): void {
    if (this.disposed) return;
    this.options.send(
      JSON.stringify({
        kind: "development_report",
        version: providerMessageVersion,
        generation: this.options.generation,
        operation_id: operationId,
        report,
      }),
    );
  }
  /** Development actions exist only when this service, too, runs in the development mode. */
  developmentAction(message: DevelopmentActionMessage): void {
    if (this.options.mode !== "development")
      throw new Error("Development actions require the development mode.");
    const action = message.action;
    if (action.name === "interrupt") {
      this.report(
        action.operation_id,
        this.interrupt(action.attempt)
          ? { type: "interrupt_sent", attempt: action.attempt }
          : { type: "refused", reason: "unknown_attempt" },
      );
      return;
    }
    const started = this.start(
      action.operation_id,
      action.model,
      [{ reference: developmentRequestReference, role: "user", text: action.text }],
      "chatgpt",
    );
    this.report(
      action.operation_id,
      started.ok
        ? { type: "attempt", attempt: started.attempt }
        : { type: "refused", reason: started.reason },
    );
  }
  start(
    operationId: string,
    model: string,
    messages: readonly InputMessage[],
    connection: string,
  ):
    | { readonly ok: true; readonly attempt: string }
    | {
        readonly ok: false;
        readonly reason: "connection_unavailable" | "busy" | "invalid_action";
      } {
    const policy = operationPolicy(
      developmentPolicy.operation,
      developmentPolicy.version,
      this.options.mode,
    );
    if (!policy || this.disposed) return { ok: false, reason: "invalid_action" };
    if (this.attempts.size >= policy.max_pending_tasks) return { ok: false, reason: "busy" };
    const built = buildInput(policy, messages);
    if (!built) return { ok: false, reason: "invalid_action" };
    // Just before sending: the connection must still be active by main's latest report.
    if (!this.options.connections.available(connection))
      return { ok: false, reason: "connection_unavailable" };
    const id = `development-${randomUUID()}`;
    const started = this.now();
    this.attempts.set(id, {
      id,
      operationId,
      transfer: built.transfer,
      started,
      last: started,
      longestSilence: 0,
      sequence: 0,
      usage: unknownUsage,
      events: [],
    });
    const dispatch: ProviderDispatchMessage = {
      kind: "provider_dispatch",
      version: providerMessageVersion,
      generation: this.options.generation,
      request: {
        attempt: id,
        operation: policy.operation,
        connection,
        model,
        instructions: policy.instructions,
        input: built.input,
        limits: {
          max_output_bytes: policy.max_output_bytes,
          max_attempt_duration_ms: policy.max_attempt_duration_ms,
          max_inactivity_ms: policy.max_inactivity_ms,
        },
      },
      permit: {
        id: randomUUID(),
        attempt: id,
        issued_at: (this.options.wallClock ?? Date.now)(),
      },
    };
    this.options.send(JSON.stringify(dispatch));
    return { ok: true, attempt: id };
  }
  interrupt(attempt: string): boolean {
    if (this.disposed || !this.attempts.has(attempt)) return false;
    this.options.send(
      JSON.stringify({
        kind: "provider_interrupt",
        version: providerMessageVersion,
        generation: this.options.generation,
        attempt,
      }),
    );
    return true;
  }
  /** Store one forwarded event. Events of an ended or unknown attempt are discarded. */
  receive(message: ProviderEventMessage): boolean {
    const attempt = this.attempts.get(message.attempt);
    if (this.disposed || !attempt) return true;
    const event = message.event;
    if (event.sequence !== attempt.sequence + 1) return false;
    attempt.sequence = event.sequence;
    const now = this.now();
    attempt.longestSilence = Math.max(attempt.longestSilence, now - attempt.last);
    attempt.last = now;
    attempt.events.push(event);
    if (event.type === "usage") attempt.usage = event.usage;
    if (event.type === "text")
      this.report(attempt.operationId, { type: "text", attempt: attempt.id, text: event.text });
    if (event.type === "result") this.finish(attempt, event.result, now);
    return true;
  }
  private finish(attempt: Attempt, result: ProviderResult, now: number): void {
    this.attempts.delete(attempt.id);
    this.report(attempt.operationId, {
      type: "finished",
      attempt: attempt.id,
      result,
      usage: attempt.usage,
      transfer: attempt.transfer,
      events: attempt.events.length,
      duration_ms: Math.round(now - attempt.started),
      longest_silence_ms: Math.round(attempt.longestSilence),
    });
  }
  running(): readonly string[] {
    return [...this.attempts.keys()];
  }
  dispose(): void {
    this.disposed = true;
    this.attempts.clear();
  }
}
