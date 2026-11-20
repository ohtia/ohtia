import { validConversationTitle } from "./research.js";
import { isResearchId, researcherMessageLimit } from "./research-port.js";
import { portLimits, utf8Size, isIdentifier } from "./port.js";
import { isConnectionId } from "./connections.js";

/**
 * Provider requests between the data service, which decides and prepares them without credentials,
 * and main, which checks the dispatch permit, attaches the credential and sends them (ADR-0028).
 */
export const providerMessageVersion = 1;
/** Ordinary provider messages retain their existing envelope. */
export const providerMessageBytes = 2 * 1024 * 1024;
/** Synthesis can send 768 KiB of text with up to six JSON bytes per input byte. */
export const providerDispatchBytes = 5 * 1024 * 1024;
/** Fits the role and shared thesis route with the rendered context, including an 800-byte title. */
const providerInstructionBytes = 10 * 1024;
/** ADR-0028's versioned permit validity: not a response deadline. Real-account checks measure it. */
export const dispatchPermitPolicy = Object.freeze({ version: 1, validity_ms: 2000 });
export const providerOperations = [
  "development_test",
  "development_test_synthesis",
  "contribution_synthesis",
  "project_setup",
  "direct_guidance",
  "search_strategy_planning",
] as const;
export type ProviderOperation = (typeof providerOperations)[number];
export const providerFailureReasons = [
  "usage_limit_reached",
  "not_eligible",
  "connection_expired",
  "provider_unavailable",
  "request_rejected",
  "provider_error",
  "invalid_output",
  "output_limit_exceeded",
  "empty_reply",
  "connection_lost",
  "permit_expired",
  "deadline_exceeded",
  "inactivity_timeout",
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
  | { readonly status: "completed"; readonly conversation_title?: string }
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
  | { readonly type: "activity" }
  | { readonly type: "text"; readonly text: string }
  | ({ readonly type: "tool_call" } & ProviderToolCall)
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
/** Strict string-object schemas used by application-owned proposal tools. */
export interface ProviderTool {
  readonly namespace: string;
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Readonly<
      Record<
        string,
        { readonly type: "string"; readonly description: string; readonly enum?: readonly string[] }
      >
    >;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}
export function isConsultationTool(tool: { namespace: unknown; name: unknown }): boolean {
  return tool.namespace === "ohtia" && tool.name === "propose_consultation";
}

/** Version 1 of the optional title metadata returned alongside a Virgilio reply. */
export const conversationTitlePolicy = Object.freeze({
  version: 1,
  namespace: "ohtia_metadata",
  name: "suggest_conversation_title",
  max_argument_bytes: 4096,
});
export function conversationTitleInstructionSuffix(operation: ProviderOperation): string {
  const setup = operation === "project_setup";
  return (
    "\n\n" +
    [
      setup
        ? "Complete the setup turn first. Write the setup reply as visible assistant text or call propose_project_setup when the title and language are agreed."
        : "Write your ordinary research reply first.",
      setup
        ? `If the researcher's messages establish a topic, you may call ${conversationTitlePolicy.name} once after the setup reply or proposal in the same response. Omit this optional title call if it would be the only output.`
        : `If the researcher's messages establish a topic, then call ${conversationTitlePolicy.name} exactly once in the same response.`,
      `Use a short, plain-text title in ${setup ? "the conversation language" : "the document language"} that describes the earliest clear exchange. Base it on what the researcher is discussing and use your reply when it clarifies the topic.`,
      "A concrete research question or task qualifies even when the thesis is still being defined. Use the conversation's topic independently of the project's working title.",
      "If the conversation contains only a greeting, or the topic is still unclear, omit the call.",
      "Keep the title in the tool arguments and out of your ordinary reply.",
    ].join(" ")
  );
}

export function isConversationTitleTool(tool: { namespace: unknown; name: unknown }): boolean {
  return (
    tool.namespace === conversationTitlePolicy.namespace &&
    tool.name === conversationTitlePolicy.name
  );
}
export function requestsConversationTitle(
  request: Pick<ProviderRequestData, "operation" | "tools">,
): boolean {
  return (
    (request.operation === "direct_guidance" || request.operation === "project_setup") &&
    request.tools.some(isConversationTitleTool)
  );
}
export interface ProviderToolCall {
  /** Null is an unnamespaced provider call; it cannot match a namespaced permitted tool. */
  readonly namespace: string | null;
  readonly name: string;
  /** Complete JSON arguments, kept exactly as received. */
  readonly arguments: string;
}
export interface ProviderRequestData {
  readonly attempt: string;
  readonly operation: ProviderOperation;
  readonly project: string;
  readonly policy_version: number;
  readonly instruction_version: number;
  readonly document_language: string | null;
  readonly connection: string;
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly ProviderInputItem[];
  readonly tools: readonly ProviderTool[];
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
/** Main's measurements of the provider payload and elapsed dispatch time. */
export interface ProviderWorkUsage {
  readonly dispatched: boolean;
  readonly input_bytes: number;
  readonly output_bytes: number;
  readonly work_ms: number;
}
export interface ProviderEventMessage {
  readonly kind: "provider_event";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly attempt: string;
  readonly event: ProviderEvent;
  readonly work?: ProviderWorkUsage;
}
export interface ProviderInterruptMessage {
  readonly kind: "provider_interrupt";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly attempt: string;
}
/** Main's observation, echoed by the service after serialized review and before fresh permits. */
export interface ServiceWakeMessage {
  readonly kind: "service_wake";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly suspendedAt: string;
  readonly resumedAt: string;
  readonly asleepMs: number;
}
export interface ServiceShutdownMessage {
  readonly kind: "shutdown";
  readonly generation: string;
  readonly orderly: boolean;
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
/** Foreign provider labels stay opaque; only exact permitted-tool matches have effects. */
export function isProviderToolLabel(value: unknown): value is string {
  return boundedText(value, portLimits.identifier_bytes) && value.length > 0;
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
      return (
        exact(value, ["status"]) ||
        (exact(value, ["status", "conversation_title"]) &&
          validConversationTitle(value.conversation_title))
      );
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
    case "activity":
      return exact(value, ["sequence", "type"]);
    case "text":
      return (
        exact(value, ["sequence", "type", "text"]) &&
        typeof value.text === "string" &&
        value.text.length > 0 &&
        boundedText(value.text, portLimits.string_bytes)
      );
    case "tool_call":
      return (
        exact(value, ["sequence", "type", "namespace", "name", "arguments"]) &&
        (value.namespace === null || isProviderToolLabel(value.namespace)) &&
        isProviderToolLabel(value.name) &&
        boundedText(value.arguments, providerMessageBytes / 2)
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
    boundedText(value.text, researcherMessageLimit * 4)
  );
}
function isTool(value: unknown): value is ProviderTool {
  if (
    !record(value) ||
    !exact(value, ["namespace", "name", "description", "strict", "parameters"]) ||
    !isIdentifier(value.namespace) ||
    !isIdentifier(value.name) ||
    !boundedText(value.description, 4096) ||
    value.strict !== true
  )
    return false;
  const p = value.parameters;
  return (
    record(p) &&
    exact(p, ["type", "properties", "required", "additionalProperties"]) &&
    p.type === "object" &&
    p.additionalProperties === false &&
    record(p.properties) &&
    Object.keys(p.properties).length <= 32 &&
    Array.isArray(p.required) &&
    p.required.length === Object.keys(p.properties).length &&
    new Set(p.required).size === p.required.length &&
    p.required.every(
      (key) => typeof key === "string" && Object.hasOwn(p.properties as object, key),
    ) &&
    Object.entries(p.properties).every(
      ([key, field]) =>
        isIdentifier(key) &&
        record(field) &&
        (exact(field, ["type", "description"]) ||
          (exact(field, ["type", "description", "enum"]) &&
            Array.isArray(field.enum) &&
            field.enum.length > 0 &&
            field.enum.length <= 32 &&
            field.enum.every(isProviderToolLabel))) &&
        field.type === "string" &&
        boundedText(field.description, 4096),
    )
  );
}
export function isProviderRequestData(value: unknown): value is ProviderRequestData {
  return (
    record(value) &&
    exact(value, [
      "attempt",
      "operation",
      "project",
      "policy_version",
      "instruction_version",
      "document_language",
      "connection",
      "model",
      "instructions",
      "input",
      "tools",
      "limits",
    ]) &&
    isIdentifier(value.attempt) &&
    isIdentifier(value.project) &&
    count(value.policy_version) &&
    value.policy_version > 0 &&
    count(value.instruction_version) &&
    value.instruction_version > 0 &&
    (value.document_language === null || boundedText(value.document_language, 32)) &&
    providerOperations.includes(value.operation as ProviderOperation) &&
    isConnectionId(value.connection) &&
    isProviderModelSlug(value.model) &&
    typeof value.instructions === "string" &&
    value.instructions.length > 0 &&
    boundedText(value.instructions, providerInstructionBytes) &&
    Array.isArray(value.input) &&
    value.input.length > 0 &&
    value.input.length <=
      (value.operation === "direct_guidance" && value.instruction_version >= 2 ? 1501 : 1001) &&
    value.input.every(isInput) &&
    Array.isArray(value.tools) &&
    value.tools.length <= 32 &&
    (value.operation !== "contribution_synthesis" ||
      (value.input.length <= 50 &&
        value.input.every(({ role }) => role === "user") &&
        value.input.reduce((bytes, item) => bytes + utf8Size(item.text), 0) <= 768 * 1024 &&
        value.tools.length === 0)) &&
    (value.operation !== "search_strategy_planning" || value.tools.length === 0) &&
    (value.operation !== "development_test_synthesis" ||
      (value.connection === "fake" && value.tools.length === 0)) &&
    value.tools.every(isTool) &&
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
function parse(
  text: unknown,
  maxBytes = providerMessageBytes,
): Record<string, unknown> | undefined {
  if (typeof text !== "string" || text.length > maxBytes) return;
  try {
    if (utf8Size(text) > maxBytes) return;
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
  const value = parse(text, providerDispatchBytes);
  if (
    header(value, "provider_dispatch", generation) &&
    exact(value, ["kind", "version", "generation", "request", "permit"]) &&
    isProviderRequestData(value.request) &&
    (value.request.operation === "contribution_synthesis" ||
      (typeof text === "string" && utf8Size(text) <= providerMessageBytes)) &&
    isPermit(value.permit)
  )
    return value as unknown as ProviderDispatchMessage;
  return;
}
function isProviderWorkUsage(value: unknown, result: ProviderResult): value is ProviderWorkUsage {
  if (!record(value) || !exact(value, ["dispatched", "input_bytes", "output_bytes", "work_ms"]))
    return false;
  const counts = [value.input_bytes, value.output_bytes, value.work_ms];
  if (!counts.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0))
    return false;
  const expected =
    result.status === "cancelled"
      ? value.dispatched
      : result.status === "failed"
        ? result.dispatched
        : true;
  return (
    typeof value.dispatched === "boolean" &&
    value.dispatched === expected &&
    (value.dispatched || counts.every((n) => n === 0))
  );
}
export function decodeProviderEvent(
  text: unknown,
  generation: string,
): ProviderEventMessage | undefined {
  const value = parse(text);
  if (
    header(value, "provider_event", generation) &&
    exact(value, [
      "kind",
      "version",
      "generation",
      "attempt",
      "event",
      ...(Object.hasOwn(value, "work") ? ["work"] : []),
    ]) &&
    isIdentifier(value.attempt) &&
    isProviderEvent(value.event) &&
    (!Object.hasOwn(value, "work") ||
      (value.event.type === "result" && isProviderWorkUsage(value.work, value.event.result)))
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
/** Wake decoding validates another generation too, allowing the receiver to discard it. */
export function decodeServiceWake(text: unknown): ServiceWakeMessage | undefined {
  const value = parse(text);
  const utc = (time: unknown): time is string =>
    typeof time === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) &&
    Number.isFinite(Date.parse(time)) &&
    new Date(time).toISOString() === time;
  if (
    value &&
    header(value, "service_wake", value.generation as string) &&
    exact(value, ["kind", "version", "generation", "suspendedAt", "resumedAt", "asleepMs"]) &&
    utc(value.suspendedAt) &&
    utc(value.resumedAt) &&
    count(value.asleepMs) &&
    value.asleepMs === Math.max(0, Date.parse(value.resumedAt) - Date.parse(value.suspendedAt))
  )
    return value as unknown as ServiceWakeMessage;
  return;
}
export function decodeServiceShutdown(
  text: unknown,
  generation: string,
): ServiceShutdownMessage | undefined {
  const value = parse(text);
  if (
    value &&
    exact(value, ["kind", "generation", "orderly"]) &&
    value.kind === "shutdown" &&
    value.generation === generation &&
    isIdentifier(value.generation) &&
    typeof value.orderly === "boolean"
  )
    return value as unknown as ServiceShutdownMessage;
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
      readonly name: "open-conversation";
      readonly operation_id: string;
      readonly conversation: string;
    }
  | {
      readonly name: "resume-requests";
      readonly operation_id: string;
      readonly connection: "chatgpt";
    }
  | {
      readonly name: "request";
      readonly operation_id: string;
      readonly model: string;
      readonly text: string;
    }
  | { readonly name: "interrupt"; readonly operation_id: string; readonly attempt: string }
  | { readonly name: "create-development-project"; readonly operation_id: string }
  | { readonly name: "run-plan"; readonly operation_id: string; readonly project: string }
  | { readonly name: "create-project"; readonly operation_id: string }
  | { readonly name: "confirm-setup"; readonly operation_id: string; readonly proposal: string }
  | { readonly name: "reject-setup"; readonly operation_id: string; readonly proposal: string }
  | { readonly name: "continue-all"; readonly operation_id: string }
  | { readonly name: "stop"; readonly operation_id: string; readonly task: string }
  | { readonly name: "start-again"; readonly operation_id: string; readonly task: string }
  | {
      readonly name: "start-conversation";
      readonly operation_id: string;
      readonly project: string;
      readonly text: string;
    }
  | {
      readonly name: "send" | "send-to-josefa";
      readonly operation_id: string;
      readonly conversation: string;
      readonly text: string;
    };
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
  | {
      readonly kind:
        | "message"
        | "consultation_request"
        | "contribution_request"
        | "plan_context"
        | "contribution_state";
      readonly reference: string;
    }
  | {
      readonly kind: "note";
      readonly note:
        "earlier_messages_omitted" | "partial_reply" | "setup_proposal" | "consultation_proposal";
      readonly reference: string;
      readonly revision: number;
    };
export const developmentRefusals = [
  "connection_unavailable",
  "unknown_attempt",
  "uncertain",
  "busy",
  "invalid_action",
  "input_too_large",
  "pending_limit_reached",
  "record_not_found",
  "newer_task_exists",
  "task_not_retryable",
  "proposal_not_waiting",
  "setup_reply_active",
  "project_in_setup",
] as const;
export type DevelopmentReport =
  | {
      readonly type: "conversation_opened";
      readonly projectId: string;
      readonly conversationId: string;
    }
  | {
      readonly type: "record";
      readonly record:
        "project" | "conversation" | "message" | "task" | "receipt" | "proposal" | "plan";
      readonly id: string;
    }
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
  if (
    value.kind === "message" ||
    value.kind === "consultation_request" ||
    value.kind === "contribution_request" ||
    value.kind === "plan_context" ||
    value.kind === "contribution_state"
  )
    return exact(value, ["kind", "reference"]) && isIdentifier(value.reference);
  return (
    value.kind === "note" &&
    exact(value, ["kind", "note", "reference", "revision"]) &&
    isIdentifier(value.reference) &&
    count(value.revision) &&
    value.revision > 0 &&
    (value.note === "earlier_messages_omitted" ||
      value.note === "partial_reply" ||
      value.note === "setup_proposal" ||
      value.note === "consultation_proposal")
  );
}
function isDevelopmentReport(value: unknown): value is DevelopmentReport {
  if (!record(value)) return false;
  switch (value.type) {
    case "conversation_opened":
      return (
        exact(value, ["type", "projectId", "conversationId"]) &&
        isIdentifier(value.projectId) &&
        isIdentifier(value.conversationId)
      );

    case "record":
      return (
        exact(value, ["type", "record", "id"]) &&
        ["project", "conversation", "message", "task", "receipt", "proposal", "plan"].includes(
          value.record as string,
        ) &&
        isIdentifier(value.id)
      );
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
        value.transfer.length <= 1502 &&
        value.transfer.every(isTransferEntry) &&
        count(value.events) &&
        count(value.duration_ms) &&
        count(value.longest_silence_ms)
      );
    default:
      return false;
  }
}
/** Raw development text must fit its field bound before crossing the private channel. */
export function isDevelopmentText(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && boundedText(value, portLimits.message_bytes)
  );
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
  if (!isIdentifier(action.operation_id)) return;
  if (
    (action.name === "confirm-setup" || action.name === "reject-setup") &&
    exact(action, ["name", "operation_id", "proposal"]) &&
    isIdentifier(action.proposal)
  )
    return value as unknown as DevelopmentActionMessage;
  if (
    action.name === "open-conversation" &&
    exact(action, ["name", "operation_id", "conversation"]) &&
    isIdentifier(action.conversation)
  )
    return value as unknown as DevelopmentActionMessage;
  if (
    action.name === "resume-requests" &&
    exact(action, ["name", "operation_id", "connection"]) &&
    action.connection === "chatgpt"
  )
    return value as unknown as DevelopmentActionMessage;
  if (
    (action.name === "create-development-project" ||
      action.name === "create-project" ||
      action.name === "continue-all") &&
    exact(action, ["name", "operation_id"])
  )
    return value as unknown as DevelopmentActionMessage;
  if (
    action.name === "run-plan" &&
    exact(action, ["name", "operation_id", "project"]) &&
    isResearchId(action.project)
  )
    return value as unknown as DevelopmentActionMessage;
  if (
    action.name === "start-conversation" ||
    action.name === "send" ||
    action.name === "send-to-josefa"
  ) {
    const target = action.name === "start-conversation" ? "project" : "conversation";
    if (
      exact(action, ["name", "operation_id", target, "text"]) &&
      isIdentifier(action[target]) &&
      isDevelopmentText(action.text)
    )
      return value as unknown as DevelopmentActionMessage;
  }
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
    (action.name === "stop" || action.name === "start-again") &&
    exact(action, ["name", "operation_id", "task"]) &&
    isIdentifier(action.task)
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

/** Data service asks main to refresh an account catalog before a human-requested new task. */
export interface ModelListRefreshMessage {
  readonly kind: "model_list_refresh";
  readonly version: typeof providerMessageVersion;
  readonly generation: string;
  readonly connection: string;
  readonly refresh_id: string;
}
export function decodeModelListRefresh(
  text: unknown,
  generation: string,
): ModelListRefreshMessage | undefined {
  const value = parse(text);
  if (
    header(value, "model_list_refresh", generation) &&
    exact(value, ["kind", "version", "generation", "connection", "refresh_id"]) &&
    isConnectionId(value.connection) &&
    isIdentifier(value.refresh_id)
  )
    return value as unknown as ModelListRefreshMessage;
  return;
}
