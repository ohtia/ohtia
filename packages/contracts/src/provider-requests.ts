import { portLimits, utf8Size, isIdentifier } from "./port.js";
import { isConnectionId } from "./connections.js";

/**
 * Provider requests between the data service, which decides and prepares them without credentials,
 * and main, which checks the dispatch permit, attaches the credential and sends them (ADR-0028).
 */
export const providerMessageVersion = 1;
/** ADR-0028's versioned permit validity: not a response deadline. Real-account checks measure it. */
export const dispatchPermitPolicy = Object.freeze({ version: 1, validity_ms: 2000 });
export const providerOperations = ["development_test"] as const;
export type ProviderOperation = (typeof providerOperations)[number];
export const providerFailureReasons = [
  "usage_limit_reached",
  "not_eligible",
  "connection_expired",
  "provider_unavailable",
  "request_rejected",
  "provider_error",
  "invalid_output",
  "connection_lost",
  "permit_expired",
] as const;
export type ProviderFailureReason = (typeof providerFailureReasons)[number];
/** Only these reasons mark an attempt that main never sent. */
export const notDispatchedReasons = [
  "connection_expired",
  "provider_unavailable",
  "permit_expired",
] as const;
export type NotDispatchedReason = (typeof notDispatchedReasons)[number];
export type ProviderResult =
  | { readonly status: "completed" }
  | {
      readonly status: "failed";
      readonly reason: Exclude<ProviderFailureReason, "connection_lost" | "permit_expired">;
      readonly dispatched: true;
    }
  | { readonly status: "failed"; readonly reason: NotDispatchedReason; readonly dispatched: false }
  | { readonly status: "cancelled" }
  | { readonly status: "uncertain"; readonly reason: "connection_lost" };
/** Reported token counts; null is unknown, never zero. */
export interface ProviderUsage {
  readonly input_tokens: number | null;
  readonly cached_input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly reasoning_tokens: number | null;
}
export type ProviderEventBody =
  | {
      readonly type: "started";
      readonly provider_request_id: string | null;
      readonly model: string | null;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "usage"; readonly usage: ProviderUsage }
  | { readonly type: "result"; readonly result: ProviderResult };
export type ProviderEvent = ProviderEventBody & { readonly sequence: number };
export interface ProviderInputItem {
  readonly role: "user" | "assistant";
  readonly text: string;
}
export interface ProviderRequestLimits {
  readonly max_output_bytes: number;
  readonly max_attempt_duration_ms: number;
  readonly max_inactivity_ms: number;
}
/** Everything main needs to send one attempt, never a credential. */
export interface ProviderRequestData {
  readonly attempt: string;
  readonly operation: ProviderOperation;
  readonly connection: string;
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly ProviderInputItem[];
  readonly limits: ProviderRequestLimits;
}
export interface DispatchPermit {
  readonly id: string;
  readonly attempt: string;
  /** Wall-clock milliseconds, which keep counting through suspension on every platform. */
  readonly issued_at: number;
}
export interface ProviderDispatchMessage {
  readonly kind: "provider_dispatch";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly request: ProviderRequestData;
  readonly permit: DispatchPermit;
}
export interface ProviderEventMessage {
  readonly kind: "provider_event";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly attempt: string;
  readonly event: ProviderEvent;
}
export interface ProviderInterruptMessage {
  readonly kind: "provider_interrupt";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly attempt: string;
}
/** Partial text crosses the channel in pieces that each fit the port's string bound. */
export const providerTextChunk = 1024;
export const providerModelBytes = 256;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function boundedText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string" || value.length > maximum) return false;
  try {
    return utf8Size(value) <= maximum;
  } catch {
    return false;
  }
}
export function isProviderModelSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= providerModelBytes &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}
function isUsage(value: unknown): value is ProviderUsage {
  return (
    record(value) &&
    exact(value, ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens"]) &&
    Object.values(value).every((item) => item === null || count(item))
  );
}
export function isProviderResult(value: unknown): value is ProviderResult {
  if (!record(value)) return false;
  switch (value.status) {
    case "completed":
    case "cancelled":
      return exact(value, ["status"]);
    case "uncertain":
      return exact(value, ["status", "reason"]) && value.reason === "connection_lost";
    case "failed":
      return (
        exact(value, ["status", "reason", "dispatched"]) &&
        (value.dispatched === false
          ? notDispatchedReasons.includes(value.reason as NotDispatchedReason)
          : value.dispatched === true &&
            providerFailureReasons.includes(value.reason as ProviderFailureReason) &&
            value.reason !== "connection_lost" &&
            value.reason !== "permit_expired")
      );
    default:
      return false;
  }
}
export function isProviderEvent(value: unknown): value is ProviderEvent {
  if (!record(value) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1)
    return false;
  switch (value.type) {
    case "started":
      return (
        exact(value, ["sequence", "type", "provider_request_id", "model"]) &&
        (value.provider_request_id === null ||
          (boundedText(value.provider_request_id, 256) && value.provider_request_id.length > 0)) &&
        (value.model === null || isProviderModelSlug(value.model))
      );
    case "text":
      return (
        exact(value, ["sequence", "type", "text"]) &&
        typeof value.text === "string" &&
        value.text.length > 0 &&
        boundedText(value.text, portLimits.string_bytes)
      );
    case "usage":
      return exact(value, ["sequence", "type", "usage"]) && isUsage(value.usage);
    case "result":
      return exact(value, ["sequence", "type", "result"]) && isProviderResult(value.result);
    default:
      return false;
  }
}
function isInput(value: unknown): value is ProviderInputItem {
  return (
    record(value) &&
    exact(value, ["role", "text"]) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    boundedText(value.text, portLimits.message_bytes)
  );
}
export function isProviderRequestData(value: unknown): value is ProviderRequestData {
  return (
    record(value) &&
    exact(value, [
      "attempt",
      "operation",
      "connection",
      "model",
      "instructions",
      "input",
      "limits",
    ]) &&
    isIdentifier(value.attempt) &&
    providerOperations.includes(value.operation as ProviderOperation) &&
    isConnectionId(value.connection) &&
    isProviderModelSlug(value.model) &&
    typeof value.instructions === "string" &&
    value.instructions.length > 0 &&
    boundedText(value.instructions, portLimits.string_bytes) &&
    Array.isArray(value.input) &&
    value.input.length > 0 &&
    value.input.length <= portLimits.container_items &&
    value.input.every(isInput) &&
    record(value.limits) &&
    exact(value.limits, ["max_output_bytes", "max_attempt_duration_ms", "max_inactivity_ms"]) &&
    Object.values(value.limits).every((item) => count(item) && item > 0)
  );
}
function isPermit(value: unknown): value is DispatchPermit {
  return (
    record(value) &&
    exact(value, ["id", "attempt", "issued_at"]) &&
    isIdentifier(value.id) &&
    isIdentifier(value.attempt) &&
    count(value.issued_at)
  );
}
function parse(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== "string" || text.length > portLimits.message_bytes) return;
  try {
    if (utf8Size(text) > portLimits.message_bytes) return;
    const value: unknown = JSON.parse(text);
    return record(value) ? value : undefined;
  } catch {
    return;
  }
}
function header(
  value: Record<string, unknown> | undefined,
  kind: string,
  generation: string,
): value is Record<string, unknown> {
  return (
    !!value &&
    value.kind === kind &&
    value.version === providerMessageVersion &&
    isIdentifier(value.generation) &&
    value.generation === generation
  );
}
/** Runtime-validated decoders; a message for another generation decodes as nothing. */
export function decodeProviderDispatch(
  text: unknown,
  generation: string,
): ProviderDispatchMessage | undefined {
  const value = parse(text);
  if (
    header(value, "provider_dispatch", generation) &&
    exact(value, ["kind", "version", "generation", "request", "permit"]) &&
    isProviderRequestData(value.request) &&
    isPermit(value.permit)
  )
    return value as unknown as ProviderDispatchMessage;
  return;
}
export function decodeProviderEvent(
  text: unknown,
  generation: string,
): ProviderEventMessage | undefined {
  const value = parse(text);
  if (
    header(value, "provider_event", generation) &&
    exact(value, ["kind", "version", "generation", "attempt", "event"]) &&
    isIdentifier(value.attempt) &&
    isProviderEvent(value.event)
  )
    return value as unknown as ProviderEventMessage;
  return;
}
export function decodeProviderInterrupt(
  text: unknown,
  generation: string,
): ProviderInterruptMessage | undefined {
  const value = parse(text);
  if (
    header(value, "provider_interrupt", generation) &&
    exact(value, ["kind", "version", "generation", "attempt"]) &&
    isIdentifier(value.attempt)
  )
    return value as unknown as ProviderInterruptMessage;
  return;
}
/** Split partial text into channel-sized pieces without breaking a code point. */
export function providerTextPieces(text: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of text) {
    if (current.length + char.length > providerTextChunk) {
      pieces.push(current);
      current = "";
    }
    current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** The development command's actions and the data service's reports, development mode only. */
export type DevelopmentAction =
  | {
      readonly name: "request";
      readonly operation_id: string;
      readonly model: string;
      readonly text: string;
    }
  | { readonly name: "interrupt"; readonly operation_id: string; readonly attempt: string };
export interface DevelopmentActionMessage {
  readonly kind: "development_action";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly action: DevelopmentAction;
}
export type TransferEntry =
  | {
      readonly kind: "instructions";
      readonly operation: ProviderOperation;
      readonly version: number;
    }
  | { readonly kind: "message"; readonly reference: string }
  | { readonly kind: "note"; readonly note: "earlier_messages_omitted" };
export const developmentRefusals = [
  "connection_unavailable",
  "unknown_attempt",
  "busy",
  "invalid_action",
] as const;
export type DevelopmentReport =
  | { readonly type: "refused"; readonly reason: (typeof developmentRefusals)[number] }
  | { readonly type: "attempt"; readonly attempt: string }
  | { readonly type: "text"; readonly attempt: string; readonly text: string }
  | { readonly type: "interrupt_sent"; readonly attempt: string }
  | {
      readonly type: "finished";
      readonly attempt: string;
      readonly result: ProviderResult;
      readonly usage: ProviderUsage;
      readonly transfer: readonly TransferEntry[];
      readonly events: number;
      readonly duration_ms: number;
      readonly longest_silence_ms: number;
    };
export interface DevelopmentReportMessage {
  readonly kind: "development_report";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly operation_id: string;
  readonly report: DevelopmentReport;
}
function isTransferEntry(value: unknown): value is TransferEntry {
  if (!record(value)) return false;
  if (value.kind === "instructions")
    return (
      exact(value, ["kind", "operation", "version"]) &&
      providerOperations.includes(value.operation as ProviderOperation) &&
      Number.isSafeInteger(value.version) &&
      (value.version as number) > 0
    );
  if (value.kind === "message")
    return exact(value, ["kind", "reference"]) && isIdentifier(value.reference);
  return (
    value.kind === "note" &&
    exact(value, ["kind", "note"]) &&
    value.note === "earlier_messages_omitted"
  );
}
function isDevelopmentReport(value: unknown): value is DevelopmentReport {
  if (!record(value)) return false;
  switch (value.type) {
    case "refused":
      return (
        exact(value, ["type", "reason"]) &&
        developmentRefusals.includes(value.reason as (typeof developmentRefusals)[number])
      );
    case "attempt":
    case "interrupt_sent":
      return exact(value, ["type", "attempt"]) && isIdentifier(value.attempt);
    case "text":
      return (
        exact(value, ["type", "attempt", "text"]) &&
        isIdentifier(value.attempt) &&
        typeof value.text === "string" &&
        value.text.length > 0 &&
        boundedText(value.text, portLimits.string_bytes)
      );
    case "finished":
      return (
        exact(value, [
          "type",
          "attempt",
          "result",
          "usage",
          "transfer",
          "events",
          "duration_ms",
          "longest_silence_ms",
        ]) &&
        isIdentifier(value.attempt) &&
        isProviderResult(value.result) &&
        isUsage(value.usage) &&
        Array.isArray(value.transfer) &&
        value.transfer.length <= portLimits.container_items &&
        value.transfer.every(isTransferEntry) &&
        count(value.events) &&
        count(value.duration_ms) &&
        count(value.longest_silence_ms)
      );
    default:
      return false;
  }
}
export function decodeDevelopmentAction(
  text: unknown,
  generation: string,
): DevelopmentActionMessage | undefined {
  const value = parse(text);
  if (
    !header(value, "development_action", generation) ||
    !exact(value, ["kind", "version", "generation", "action"]) ||
    !record(value.action)
  )
    return;
  const action = value.action;
  if (
    action.name === "request" &&
    exact(action, ["name", "operation_id", "model", "text"]) &&
    isIdentifier(action.operation_id) &&
    isProviderModelSlug(action.model) &&
    typeof action.text === "string" &&
    action.text.length > 0 &&
    boundedText(action.text, portLimits.string_bytes)
  )
    return value as unknown as DevelopmentActionMessage;
  if (
    action.name === "interrupt" &&
    exact(action, ["name", "operation_id", "attempt"]) &&
    isIdentifier(action.operation_id) &&
    isIdentifier(action.attempt)
  )
    return value as unknown as DevelopmentActionMessage;
  return;
}
export function decodeDevelopmentReport(
  text: unknown,
  generation: string,
): DevelopmentReportMessage | undefined {
  const value = parse(text);
  if (
    header(value, "development_report", generation) &&
    exact(value, ["kind", "version", "generation", "operation_id", "report"]) &&
    isIdentifier(value.operation_id) &&
    isDevelopmentReport(value.report)
  )
    return value as unknown as DevelopmentReportMessage;
  return;
}
