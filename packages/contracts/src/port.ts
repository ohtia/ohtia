import {
  conversationBusyReasons,
  planInvalidReasons,
  type ConversationBusyReason,
  type PlanInvalidReason,
  type PlanChangeInvalidReason,
  planChangeInvalidReasons,
} from "./research.js";
import {
  researchOperations,
  isResearchOperation,
  researchInput,
  researchOutput,
  isResearchEvent,
  type ResearchInputs,
  type ResearchOutputs,
  type ResearchEvent,
  type ResearchPort,
} from "./research-port.js";
import {
  isConnectionId,
  isConnectionSnapshot,
  isConnectionEvent,
  isModelPage,
  type ConnectionSnapshot,
  type ConnectionEvent,
  type ModelPage,
  type ModelPageInput,
} from "./connections.js";
import { isWindowBounds, type WindowBounds } from "./window-bounds.js";
import {
  defaultEntryTextLength,
  defaultSourceQuoteLength,
  isCharacterPresentation,
  isMemoryDisplayLength,
  isInterfaceZoom,
  zoomBoundaryErrors,
  type CharacterPresentation,
  type InterfaceZoom,
  type PresentationChange,
  type SavedPresentationRecord,
  type PresentationReceipt,
  type PresentationSnapshot,
  type PresentationValues,
  type PresentationFeature,
  type ZoomIntent,
} from "./presentation.js";
import { isWorkspaceLayout, type WorkspaceLayout } from "./layout.js";
import { isAppearance, type Appearance } from "./appearance.js";
import { policyId, portLimits } from "./generated/resource-policy.js";
import {
  isSavedUpdateCheckRecord,
  isUpdateCheckRecord,
  isUpdateStateNotice,
  type SavedUpdateCheckRecord,
  type UpdateCheckChange,
  type UpdateCheckRecord,
  type UpdateStateNotice,
} from "./update-check.js";
export { policyId, portLimits } from "./generated/resource-policy.js";

export const protocolVersion = 1;
export const supportedLocales = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-CA",
  "es-ES",
  "es-MX",
  "es-AR",
  "pt-BR",
  "pt-PT",
  "fr-FR",
  "fr-CA",
  "fr-BE",
  "de-DE",
  "de-AT",
  "de-CH",
  "it-IT",
  "nl-NL",
  "nl-BE",
  "sv-SE",
  "da-DK",
  "nb-NO",
  "fi-FI",
  "ca-AD",
  "ca-ES",
  "ko-KR",
] as const;
export type InterfaceLocale = (typeof supportedLocales)[number];
export interface FoundationStatus {
  readonly artifact: "development" | "quality" | "release";
  readonly service: "starting" | "ready" | "unavailable";
  readonly engine: "unavailable" | "verified";
  readonly interfaceLocale: InterfaceLocale;
}
export interface AppearanceRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly value: Appearance;
  readonly source: "saved" | "default" | "invalid_fallback";
}
export type SavedAppearanceRecord = AppearanceRecord & { readonly source: "saved" };
export interface AppearanceChange {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: Appearance;
}
export type LocaleChoice = "system" | InterfaceLocale;
export interface LocaleRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly value: LocaleChoice;
  readonly source: "saved" | "default" | "invalid_fallback";
}
export type SavedLocaleRecord = LocaleRecord & { readonly source: "saved" };
export interface LocaleSnapshot {
  readonly serviceGeneration: string;
  readonly record: LocaleRecord;
  readonly effectiveLocale: InterfaceLocale;
  readonly systemLocale: InterfaceLocale;
}
export interface LocaleChange {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: LocaleChoice;
}
export type RecordedLocaleOutcome =
  | { readonly ok: true; readonly value: SavedLocaleRecord }
  | { readonly ok: false; readonly error: Extract<PortError, { readonly code: "stale_revision" }> };
export type LocaleReceipt =
  | { readonly state: "not_found" | "pending" }
  | { readonly state: "recorded"; readonly outcome: RecordedLocaleOutcome };
export interface LayoutRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly value: WorkspaceLayout | null;
  readonly source: "saved" | "default" | "invalid_fallback";
}
export type SavedLayoutRecord = LayoutRecord & {
  readonly source: "saved";
  readonly value: WorkspaceLayout;
};
export interface LayoutChange {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: WorkspaceLayout;
}
export type RecordedLayoutOutcome =
  | { readonly ok: true; readonly value: SavedLayoutRecord }
  | { readonly ok: false; readonly error: Extract<PortError, { readonly code: "stale_revision" }> };
export type LayoutReceipt =
  | { readonly state: "not_found" | "pending" }
  | { readonly state: "recorded"; readonly outcome: RecordedLayoutOutcome };
export interface WindowBoundsRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly value: WindowBounds | null;
  readonly source: "saved" | "default" | "invalid_fallback";
}
export type SavedWindowBoundsRecord = WindowBoundsRecord & {
  readonly source: "saved";
  readonly value: WindowBounds;
};
export interface WindowBoundsChange {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: WindowBounds;
}
export type RecordedWindowBoundsOutcome =
  | { readonly ok: true; readonly value: SavedWindowBoundsRecord }
  | { readonly ok: false; readonly error: Extract<PortError, { readonly code: "stale_revision" }> };
export type WindowBoundsReceipt =
  | { readonly state: "not_found" | "pending" }
  | { readonly state: "recorded"; readonly outcome: RecordedWindowBoundsOutcome };
export const errorActions = {
  entry_invalid: "check_request",
  memory_full: "check_request",
  undo_unavailable: "refresh_record",
  selection_invalid: "check_request",
  owner_changed: "refresh_record",
  conversation_busy: "retry_later",
  parts_incomplete: "resend_parts",
  project_not_in_setup: "refresh_record",
  proposal_not_waiting: "refresh_record",
  setup_reply_active: "retry_later",
  destination_changed: "refresh_record",
  consultation_unfinished: "retry_later",
  plan_unfinished: "retry_later",
  plan_invalid: "check_request",
  plan_change_invalid: "check_request",
  too_few_contributions: "check_request",
  reason_empty: "check_request",
  reason_too_long: "check_request",
  graph_version_conflict: "refresh_record",
  unknown_prerequisite: "check_request",
  self_dependency: "check_request",
  cycle: "check_request",
  duplicate_contribution: "check_request",
  plan_key_invalid: "check_request",
  plan_key_duplicate: "check_request",
  empty_plan: "check_request",
  request_empty: "check_request",
  request_too_large: "check_request",
  purpose_empty: "check_request",
  purpose_too_long: "check_request",
  shared_context_too_large: "check_request",
  event_limit_reached: "check_request",
  plan_state_changed: "refresh_record",
  task_not_stoppable: "check_request",
  project_in_setup: "refresh_record",
  record_not_found: "refresh_record",
  name_invalid: "check_request",
  input_too_large: "check_request",
  input_changed: "check_request",
  plan_too_large: "check_request",
  agent_not_authorized: "check_request",
  limit_reached: "check_request",
  pending_limit_reached: "retry_later",
  newer_task_exists: "refresh_record",
  task_not_retryable: "check_request",
  message_invalid: "check_request",
  invalid_message: "check_request",
  unsupported_version: "upgrade_application",
  policy_mismatch: "upgrade_application",
  unauthorized: "reopen_window",
  stale_generation: "reopen_window",
  duplicate_request: "check_request",
  busy: "retry_later",
  zoom_minimum: "check_request",
  zoom_maximum: "check_request",
  actual_size: "check_request",
  window_limit: "retry_later",
  service_unavailable: "retry_later",
  agent_unavailable: "check_request",
  timeout: "retry_read",
  cancelled: "retry_read",
  uncertain: "reconcile_operation",
  stale_revision: "refresh_preference",
  operation_conflict: "reconcile_operation",
  invalid_service_result: "reconnect_service",
  preference_invalid: "replace_preference",
  storage_failed: "retry_later",
  disposed: "reopen_window",
  sequence_gap: "resubscribe",
} as const;
export type ErrorCode = keyof typeof errorActions;
export type PortError = {
  [K in ErrorCode]: {
    readonly code: K;
    readonly nextAction: (typeof errorActions)[K];
    readonly parameters: K extends "stale_revision"
      ? { readonly currentRevision: number }
      : K extends "plan_invalid"
        ? { readonly reason: PlanInvalidReason }
        : K extends "plan_change_invalid"
          ? { readonly reason: PlanChangeInvalidReason }
          : K extends "conversation_busy"
            ? { readonly reason: ConversationBusyReason }
            : Record<string, never>;
  };
}[ErrorCode];
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PortError };
export function failure(code: Exclude<ErrorCode, "stale_revision" | "conversation_busy">): {
  readonly ok: false;
  readonly error: PortError;
} {
  return {
    ok: false,
    error: { code, nextAction: errorActions[code], parameters: {} } as PortError,
  };
}
export function invalidPlan(reason: PlanInvalidReason): Outcome<never> {
  return {
    ok: false,
    error: { code: "plan_invalid", nextAction: "check_request", parameters: { reason } },
  };
}
export function invalidPlanChange(reason: PlanChangeInvalidReason): Outcome<never> {
  return {
    ok: false,
    error: { code: "plan_change_invalid", nextAction: "check_request", parameters: { reason } },
  };
}
export function staleRevision(currentRevision: number): {
  readonly ok: false;
  readonly error: Extract<PortError, { readonly code: "stale_revision" }>;
} {
  return {
    ok: false,
    error: {
      code: "stale_revision",
      nextAction: "refresh_preference",
      parameters: { currentRevision },
    },
  };
}
export type RecordedAppearanceOutcome =
  | { readonly ok: true; readonly value: SavedAppearanceRecord }
  | { readonly ok: false; readonly error: Extract<PortError, { readonly code: "stale_revision" }> };
export type AppearanceReceipt =
  | { readonly state: "not_found" | "pending" }
  | { readonly state: "recorded"; readonly outcome: RecordedAppearanceOutcome };
/** Application-wide inference preference; running is live and is never stored in a receipt. */
export interface ExecutionLimitsRecord {
  readonly serviceGeneration: string;
  readonly revision: number;
  readonly max_concurrent_inference: number;
  readonly running: number;
}
export interface ExecutionLimitsChange {
  readonly operationId: string;
  readonly value: number;
}
export type ExecutionLimitsReceipt =
  | { readonly state: "not_found" | "pending" }
  | {
      readonly state: "recorded";
      readonly outcome: { readonly ok: true; readonly value: ExecutionLimitsRecord };
    };
export type RecordedUpdateCheckOutcome =
  | { readonly ok: true; readonly value: SavedUpdateCheckRecord }
  | { readonly ok: false; readonly error: Extract<PortError, { readonly code: "stale_revision" }> };
export type UpdateCheckReceipt =
  | { readonly state: "not_found" | "pending" }
  | { readonly state: "recorded"; readonly outcome: RecordedUpdateCheckOutcome };
export function isInferenceLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 50;
}
export interface OperationInputs extends ResearchInputs {
  "updateCheck.read": Record<string, never>;
  "updateCheck.replace": { readonly expectedRevision: number; readonly value: boolean };
  "updateCheck.receipt": { readonly targetOperationId: string };
  /** Main answers these from its own state; they never reach the data service. */
  "update.read": Record<string, never>;
  "update.check": Record<string, never>;
  "limits.read": Record<string, never>;
  "limits.replace": { readonly value: number };
  "limits.receipt": { readonly targetOperationId: string };
  "connection.read": { readonly connection: string };
  "connection.subscribe": { readonly connection: string; readonly subscriptionId: string };
  "connection.probe": { readonly connection: string };
  "connection.listModels": ModelPageInput;
  "connection.connect": {
    readonly connection: string;
    readonly new_registration?: boolean;
    readonly key?: string;
  };
  "connection.replaceKey": { readonly connection: string; readonly key: string };
  "connection.disconnect": { readonly connection: string };

  "bounds.read": Record<string, never>;
  "bounds.replace": { readonly expectedRevision: number; readonly value: WindowBounds };
  "bounds.receipt": { readonly targetOperationId: string };
  "presentation.read": Record<string, never>;
  "presentation.subscribe": { readonly subscriptionId: string };
  "sourceQuote.replace": { readonly expectedRevision: number; readonly value: number };
  "entryText.replace": { readonly expectedRevision: number; readonly value: number };
  "sourceQuote.receipt": { readonly targetOperationId: string };
  "entryText.receipt": { readonly targetOperationId: string };
  "character.replace": { readonly expectedRevision: number; readonly value: CharacterPresentation };
  "character.receipt": { readonly targetOperationId: string };
  "zoom.replace": { readonly expectedRevision: number; readonly value: InterfaceZoom };
  "zoom.adjust": { readonly intent: ZoomIntent };
  /** Broker-to-service only; renderer admission rejects this operation. */
  "zoom.commit": {
    readonly expectedRevision: number;
    readonly value: InterfaceZoom;
    readonly intent: ZoomIntent;
  };
  "zoom.receipt": { readonly targetOperationId: string };
  "zoom.apply": Record<string, never>;
  "locale.read": Record<string, never>;
  "locale.replace": { readonly expectedRevision: number; readonly value: LocaleChoice };
  "locale.receipt": { readonly targetOperationId: string };
  "locale.subscribe": { readonly subscriptionId: string };
  "layout.failureNotice": Record<string, never>;
  "layout.read": Record<string, never>;
  "layout.replace": { readonly expectedRevision: number; readonly value: WorkspaceLayout };
  "layout.receipt": { readonly targetOperationId: string };
  "status.read": Record<string, never>;
  "appearance.read": Record<string, never>;
  "appearance.replace": { readonly expectedRevision: number; readonly value: Appearance };
  "appearance.receipt": { readonly targetOperationId: string };
  "status.subscribe": { readonly subscriptionId: string };
  "appearance.subscribe": { readonly subscriptionId: string };
}
export interface OperationOutputs extends ResearchOutputs {
  "updateCheck.read": UpdateCheckRecord;
  "updateCheck.replace": SavedUpdateCheckRecord;
  "updateCheck.receipt": UpdateCheckReceipt;
  "update.read": UpdateStateNotice;
  "update.check": UpdateStateNotice;
  "limits.read": ExecutionLimitsRecord;
  "limits.replace": ExecutionLimitsRecord;
  "limits.receipt": ExecutionLimitsReceipt;
  "connection.read": ConnectionSnapshot;
  "connection.subscribe": { readonly subscriptionId: string };
  "connection.probe": ConnectionSnapshot;
  "connection.listModels": ModelPage;
  "connection.connect": ConnectionSnapshot;
  "connection.replaceKey": ConnectionSnapshot;
  "connection.disconnect": ConnectionSnapshot;

  "bounds.read": WindowBoundsRecord;
  "bounds.replace": SavedWindowBoundsRecord;
  "bounds.receipt": WindowBoundsReceipt;
  "presentation.read": PresentationSnapshot;
  "presentation.subscribe": { readonly subscriptionId: string };
  "sourceQuote.replace": SavedPresentationRecord<number>;
  "entryText.replace": SavedPresentationRecord<number>;
  "sourceQuote.receipt": PresentationReceipt<number>;
  "entryText.receipt": PresentationReceipt<number>;
  "character.replace": SavedPresentationRecord<CharacterPresentation>;
  "character.receipt": PresentationReceipt<CharacterPresentation>;
  "zoom.replace": SavedPresentationRecord<InterfaceZoom>;
  "zoom.adjust": SavedPresentationRecord<InterfaceZoom>;
  "zoom.commit": SavedPresentationRecord<InterfaceZoom>;
  "zoom.receipt": PresentationReceipt<InterfaceZoom>;
  "zoom.apply": {
    readonly revision: number;
    readonly percent: InterfaceZoom;
    readonly applied: boolean;
  };
  "locale.read": LocaleSnapshot;
  "locale.replace": SavedLocaleRecord;
  "locale.receipt": LocaleReceipt;
  "locale.subscribe": { readonly subscriptionId: string };
  "layout.failureNotice": { readonly announce: boolean };
  "layout.read": LayoutRecord;
  "layout.replace": SavedLayoutRecord;
  "layout.receipt": LayoutReceipt;
  "status.read": FoundationStatus;
  "appearance.read": AppearanceRecord;
  "appearance.replace": SavedAppearanceRecord;
  "appearance.receipt": AppearanceReceipt;
  "status.subscribe": { readonly subscriptionId: string };
  "appearance.subscribe": { readonly subscriptionId: string };
}
export type Operation = keyof OperationInputs;
export interface Identity {
  readonly protocol: 1;
  readonly policy: typeof policyId;
  readonly requestId: string;
  readonly operationId: string;
  readonly windowGeneration: string;
  readonly serviceGeneration: string;
  readonly operation: Operation;
}
export type Request = {
  [K in Operation]: Identity & {
    readonly kind: "request";
    readonly operation: K;
    readonly payload: OperationInputs[K];
  };
}[Operation];
export type OperationOutcome<K extends Operation> =
  | { readonly ok: true; readonly value: OperationOutputs[K] }
  | {
      readonly ok: false;
      readonly error: Extract<
        PortError,
        { readonly code: (typeof operationErrorCodes)[K][number] }
      >;
    };
export type Result = {
  [K in Operation]: Identity & {
    readonly kind: "result";
    readonly operation: K;
    readonly payload: OperationOutcome<K>;
  };
}[Operation];
export interface Cancel extends Identity {
  readonly kind: "cancel";
}
export interface Unsubscribe {
  readonly protocol: 1;
  readonly policy: typeof policyId;
  readonly kind: "unsubscribe";
  readonly windowGeneration: string;
  readonly serviceGeneration: string;
  readonly subscriptionId: string;
}
export type PortEvent = {
  readonly protocol: 1;
  readonly policy: typeof policyId;
  readonly kind: "event";
  readonly windowGeneration: string;
  readonly serviceGeneration: string;
  readonly subscriptionId: string;
  readonly sequence: number;
} & (
  | { readonly topic: "research"; readonly payload: ResearchEvent }
  | { readonly topic: "connection"; readonly payload: ConnectionEvent }
  | { readonly topic: "presentation"; readonly payload: PresentationSnapshot }
  | { readonly topic: "status"; readonly payload: FoundationStatus }
  | { readonly topic: "appearance"; readonly payload: AppearanceRecord }
  | { readonly topic: "locale"; readonly payload: LocaleSnapshot }
);
export type Envelope = Request | Result | Cancel | Unsubscribe | PortEvent;
export interface PortCall<T> {
  readonly result: Promise<Outcome<T>>;
  cancel(): void;
}
export interface Subscription {
  readonly ready: Promise<Outcome<{ readonly subscriptionId: string }>>;
  dispose(): void;
}
export interface FoundationPort extends ResearchPort {
  readUpdateCheck(): PortCall<UpdateCheckRecord>;
  replaceUpdateCheck(
    change: UpdateCheckChange,
    expectedServiceGeneration?: string,
  ): PortCall<SavedUpdateCheckRecord>;
  readUpdateCheckReceipt(operationId: string): PortCall<UpdateCheckReceipt>;
  readUpdate(): PortCall<UpdateStateNotice>;
  /**
   * Starts or joins a manual check and returns the numbered state, `checking` unless the build
   * cannot check; the result arrives as a later update notice.
   */
  checkForUpdate(): PortCall<UpdateStateNotice>;
  readExecutionLimits(): PortCall<ExecutionLimitsRecord>;
  replaceExecutionLimits(
    change: ExecutionLimitsChange,
    expectedServiceGeneration?: string,
  ): PortCall<ExecutionLimitsRecord>;
  readExecutionLimitsReceipt(operationId: string): PortCall<ExecutionLimitsReceipt>;
  readConnection(connection: string): PortCall<ConnectionSnapshot>;
  connectConnection(
    connection: string,
    options?: { readonly new_registration?: boolean; readonly key?: string },
  ): PortCall<ConnectionSnapshot>;
  replaceConnectionKey(connection: string, key: string): PortCall<ConnectionSnapshot>;
  disconnectConnection(connection: string): PortCall<ConnectionSnapshot>;
  probeConnection(connection: string): PortCall<ConnectionSnapshot>;
  listConnectionModels(input: ModelPageInput): PortCall<ModelPage>;
  subscribeConnection(
    connection: string,
    listener: (notice: Outcome<ConnectionEvent>) => void,
  ): Subscription;
  readPresentation(): PortCall<PresentationSnapshot>;
  subscribePresentation(listener: (notice: Outcome<PresentationSnapshot>) => void): Subscription;
  replaceSourceQuote(
    change: PresentationChange<number>,
    expectedServiceGeneration?: string,
  ): PortCall<SavedPresentationRecord<number>>;
  readSourceQuoteReceipt(operationId: string): PortCall<PresentationReceipt<number>>;
  replaceEntryText(
    change: PresentationChange<number>,
    expectedServiceGeneration?: string,
  ): PortCall<SavedPresentationRecord<number>>;
  readEntryTextReceipt(operationId: string): PortCall<PresentationReceipt<number>>;
  replaceCharacter(
    change: PresentationChange<CharacterPresentation>,
    expectedServiceGeneration?: string,
  ): PortCall<SavedPresentationRecord<CharacterPresentation>>;
  readCharacterReceipt(operationId: string): PortCall<PresentationReceipt<CharacterPresentation>>;
  replaceZoom(
    change: PresentationChange<InterfaceZoom>,
    expectedServiceGeneration?: string,
  ): PortCall<SavedPresentationRecord<InterfaceZoom>>;
  adjustZoom(
    operationId: string,
    intent: ZoomIntent,
    expectedServiceGeneration?: string,
  ): PortCall<SavedPresentationRecord<InterfaceZoom>>;
  readZoomReceipt(operationId: string): PortCall<PresentationReceipt<InterfaceZoom>>;
  applyZoom(): PortCall<OperationOutputs["zoom.apply"]>;
  readLocale(): PortCall<LocaleSnapshot>;
  replaceLocale(
    change: LocaleChange,
    expectedServiceGeneration?: string,
  ): PortCall<SavedLocaleRecord>;
  readLocaleReceipt(operationId: string): PortCall<LocaleReceipt>;
  subscribeLocale(listener: (notice: Outcome<LocaleSnapshot>) => void): Subscription;
  claimLayoutFailureNotice(): PortCall<{ readonly announce: boolean }>;
  readLayout(): PortCall<LayoutRecord>;
  replaceLayout(change: LayoutChange): PortCall<SavedLayoutRecord>;
  readLayoutReceipt(operationId: string): PortCall<LayoutReceipt>;
  readStatus(): PortCall<FoundationStatus>;
  readAppearance(): PortCall<AppearanceRecord>;
  replaceAppearance(
    change: AppearanceChange,
    expectedServiceGeneration?: string,
  ): PortCall<SavedAppearanceRecord>;
  readAppearanceReceipt(operationId: string): PortCall<AppearanceReceipt>;
  subscribeStatus(listener: (notice: Outcome<FoundationStatus>) => void): Subscription;
  subscribeAppearance(listener: (notice: Outcome<AppearanceRecord>) => void): Subscription;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
function object(value: Json | undefined): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Json | undefined, keys: readonly string[]): value is ObjectValue {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function oneOf<T extends string>(value: Json | undefined, values: readonly T[]): value is T {
  return typeof value === "string" && values.some((item) => item === value);
}
export function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= portLimits.identifier_bytes &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}
function revision(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function status(value: Json | undefined): boolean {
  return (
    exact(value, ["artifact", "service", "engine", "interfaceLocale"]) &&
    oneOf(value.artifact, ["development", "quality", "release"]) &&
    oneOf(value.service, ["starting", "ready", "unavailable"]) &&
    oneOf(value.engine, ["unavailable", "verified"]) &&
    oneOf(value.interfaceLocale, supportedLocales) &&
    (value.engine !== "verified" || value.service === "ready")
  );
}
function appearance(value: Json | undefined): boolean {
  return (
    exact(value, ["schemaVersion", "revision", "value", "source"]) &&
    value.schemaVersion === 1 &&
    revision(value.revision) &&
    isAppearance(value.value) &&
    oneOf(value.source, ["saved", "default", "invalid_fallback"]) &&
    (value.source === "saved" ? value.revision > 0 : value.value === "system") &&
    (value.source !== "default" || value.revision === 0)
  );
}
function localeRecord(value: Json | undefined): boolean {
  return (
    exact(value, ["schemaVersion", "revision", "value", "source"]) &&
    value.schemaVersion === 1 &&
    revision(value.revision) &&
    (value.value === "system" || oneOf(value.value, supportedLocales)) &&
    oneOf(value.source, ["saved", "default", "invalid_fallback"]) &&
    (value.source === "saved" ? value.revision > 0 : value.value === "system") &&
    (value.source !== "default" || value.revision === 0)
  );
}
function savedLocale(value: Json | undefined): boolean {
  return localeRecord(value) && object(value) && value.source === "saved";
}
function localeSnapshot(value: Json | undefined): boolean {
  return (
    exact(value, ["serviceGeneration", "record", "effectiveLocale", "systemLocale"]) &&
    isIdentifier(value.serviceGeneration) &&
    localeRecord(value.record) &&
    oneOf(value.effectiveLocale, supportedLocales) &&
    oneOf(value.systemLocale, supportedLocales) &&
    object(value.record) &&
    value.effectiveLocale ===
      (value.record.value === "system" ? value.systemLocale : value.record.value)
  );
}
function presentationRecord(
  value: Json | undefined,
  valid: (value: unknown) => boolean,
  initial: Json,
  fallback: Json,
): boolean {
  return (
    exact(value, ["schemaVersion", "revision", "value", "source"]) &&
    value.schemaVersion === 1 &&
    revision(value.revision) &&
    valid(value.value) &&
    (value.source === "saved"
      ? value.revision > 0
      : value.source === "default"
        ? value.revision === 0 && value.value === initial
        : value.source === "invalid_fallback" && value.value === fallback)
  );
}
function characterRecord(value: Json | undefined): boolean {
  return presentationRecord(value, isCharacterPresentation, "animated", "static");
}
function zoomRecord(value: Json | undefined): boolean {
  return presentationRecord(value, isInterfaceZoom, 100, 100);
}
function memoryLengthRecord(value: Json | undefined, fallback: number): boolean {
  return presentationRecord(value, isMemoryDisplayLength, fallback, fallback);
}
function savedMemoryLength(value: Json | undefined, fallback: number): boolean {
  return memoryLengthRecord(value, fallback) && object(value) && value.source === "saved";
}
function savedCharacter(value: Json | undefined): boolean {
  return characterRecord(value) && object(value) && value.source === "saved";
}
function savedZoom(value: Json | undefined): boolean {
  return zoomRecord(value) && object(value) && value.source === "saved";
}
function presentationSnapshot(value: Json | undefined): boolean {
  return (
    exact(value, [
      "serviceGeneration",
      "appearance",
      "character",
      "zoom",
      "sourceQuote",
      "entryText",
    ]) &&
    isIdentifier(value.serviceGeneration) &&
    appearance(value.appearance) &&
    characterRecord(value.character) &&
    zoomRecord(value.zoom) &&
    memoryLengthRecord(value.sourceQuote, defaultSourceQuoteLength) &&
    memoryLengthRecord(value.entryText, defaultEntryTextLength)
  );
}
function savedAppearance(value: Json | undefined): boolean {
  return appearance(value) && object(value) && value.source === "saved";
}

function layoutRecord(value: Json | undefined): boolean {
  return (
    exact(value, ["schemaVersion", "revision", "value", "source"]) &&
    value.schemaVersion === 1 &&
    revision(value.revision) &&
    (value.source === "saved"
      ? value.revision > 0 && isWorkspaceLayout(value.value)
      : value.value === null &&
        (value.source === "invalid_fallback" ||
          (value.source === "default" && value.revision === 0)))
  );
}
function savedLayout(value: Json | undefined): boolean {
  return layoutRecord(value) && object(value) && value.source === "saved";
}
function boundsRecord(value: Json | undefined): boolean {
  return (
    exact(value, ["schemaVersion", "revision", "value", "source"]) &&
    value.schemaVersion === 1 &&
    revision(value.revision) &&
    (value.source === "saved"
      ? value.revision > 0 && isWindowBounds(value.value)
      : value.value === null &&
        (value.source === "invalid_fallback" ||
          (value.source === "default" && value.revision === 0)))
  );
}
function savedBounds(value: Json | undefined): boolean {
  return boundsRecord(value) && object(value) && value.source === "saved";
}
function error(value: Json | undefined): boolean {
  if (
    !exact(value, ["code", "nextAction", "parameters"]) ||
    typeof value.code !== "string" ||
    !Object.hasOwn(errorActions, value.code)
  )
    return false;
  const code = value.code as ErrorCode;
  return (
    value.nextAction === errorActions[code] &&
    (code === "stale_revision"
      ? exact(value.parameters, ["currentRevision"]) && revision(value.parameters.currentRevision)
      : code === "plan_invalid"
        ? exact(value.parameters, ["reason"]) &&
          planInvalidReasons.includes(value.parameters.reason as PlanInvalidReason)
        : code === "plan_change_invalid"
          ? exact(value.parameters, ["reason"]) &&
            planChangeInvalidReasons.includes(value.parameters.reason as PlanChangeInvalidReason)
          : code === "conversation_busy"
            ? exact(value.parameters, ["reason"]) &&
              conversationBusyReasons.includes(value.parameters.reason as ConversationBusyReason)
            : exact(value.parameters, []))
  );
}
function outcome(value: Json | undefined, valid: (value: Json | undefined) => boolean): boolean {
  if (!object(value)) return false;
  return value.ok === true
    ? exact(value, ["ok", "value"]) && valid(value.value)
    : value.ok === false && exact(value, ["ok", "error"]) && error(value.error);
}
function receipt(
  value: Json | undefined,
  saved = savedAppearance,
  codes: readonly string[] = ["stale_revision"],
): boolean {
  return (
    object(value) &&
    (value.state === "recorded"
      ? exact(value, ["state", "outcome"]) &&
        outcome(value.outcome, saved) &&
        object(value.outcome) &&
        (value.outcome.ok === true ||
          (object(value.outcome.error) &&
            typeof value.outcome.error.code === "string" &&
            codes.includes(value.outcome.error.code)))
      : exact(value, ["state"]) && oneOf(value.state, ["not_found", "pending"]))
  );
}

const readErrors = [
  "invalid_message",
  "unsupported_version",
  "policy_mismatch",
  "unauthorized",
  "stale_generation",
  "duplicate_request",
  "busy",
  "service_unavailable",
  "timeout",
  "cancelled",
  "invalid_service_result",
  "storage_failed",
  "disposed",
] as const;
const replaceErrors = [
  "invalid_message",
  "unsupported_version",
  "policy_mismatch",
  "unauthorized",
  "stale_generation",
  "duplicate_request",
  "busy",
  "service_unavailable",
  "uncertain",
  "stale_revision",
  "operation_conflict",
  "preference_invalid",
  "storage_failed",
] as const;
const researchMutationErrors = readErrors.filter(
  (code) => !["timeout", "cancelled", "disposed", "invalid_service_result"].includes(code),
);
const memoryWriteErrors = [
  ...researchMutationErrors,
  "uncertain",
  "operation_conflict",
  "record_not_found",
] as const;
const memoryTextErrors = ["memory_full", "entry_invalid", "parts_incomplete"] as const;
export const operationErrorCodes = Object.freeze({
  "updateCheck.read": [...readErrors, "preference_invalid"],
  "updateCheck.replace": replaceErrors,
  "updateCheck.receipt": readErrors,
  "update.read": readErrors,
  "update.check": readErrors,
  "limits.read": [...readErrors, "preference_invalid"],
  "limits.replace": replaceErrors.filter((code) => code !== "stale_revision"),
  "limits.receipt": readErrors,
  "conversation.stop": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
  ],
  "handoff.selection": [...readErrors, "record_not_found", "owner_changed"],
  "handoff.accept": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
    "proposal_not_waiting",
    "owner_changed",
    "conversation_busy",
  ],
  "handoff.decline": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
    "proposal_not_waiting",
  ],
  "handoff.return": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
    "owner_changed",
    "conversation_busy",
    "selection_invalid",
    "parts_incomplete",
  ],
  "plan.read": [...readErrors, "record_not_found"],
  "plan.accept": [
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "proposal_not_waiting",
    "destination_changed",
    "plan_unfinished",
    "plan_invalid",
    "pending_limit_reached",
  ],
  "plan.decline": [
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "proposal_not_waiting",
  ],
  "memory.add": [...memoryWriteErrors, ...memoryTextErrors],
  "memory.edit": [...memoryWriteErrors, ...memoryTextErrors, "stale_revision"],
  "memory.withdraw": [...memoryWriteErrors, "stale_revision"],
  "memory.list": [...readErrors, "record_not_found"],
  "memory.history": [...readErrors, "record_not_found"],
  "memory.undo": [
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "memory_full",
    "undo_unavailable",
  ],
  "planChange.read": [...readErrors, "record_not_found"],
  "planChange.apply": [
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "proposal_not_waiting",
    "plan_change_invalid",
    "event_limit_reached",
  ],
  "planChange.decline": [
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "proposal_not_waiting",
  ],
  "planEvent.list": [...readErrors, "record_not_found"],
  "plan.cancel": [...researchMutationErrors, "record_not_found", "uncertain", "operation_conflict"],
  "plan.finish": [
    ...researchMutationErrors,
    "record_not_found",
    "plan_state_changed",
    "uncertain",
    "operation_conflict",
  ],
  "task.stop": [
    ...researchMutationErrors,
    "record_not_found",
    "task_not_stoppable",
    "uncertain",
    "operation_conflict",
  ],
  "synthesis.tryAgain": [
    "plan_unfinished",
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
    "task_not_retryable",
    "newer_task_exists",
    "pending_limit_reached",
    "limit_reached",
  ],
  "task.tryAgain": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
    "task_not_retryable",
    "newer_task_exists",
    "pending_limit_reached",
  ],
  "task.startAgain": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
    "task_not_retryable",
    "newer_task_exists",
    "pending_limit_reached",
  ],
  "consultation.accept": [
    "plan_unfinished",
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "proposal_not_waiting",
    "destination_changed",
    "consultation_unfinished",
    "pending_limit_reached",
    "limit_reached",
  ],
  "consultation.decline": [
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "proposal_not_waiting",
  ],
  "contribution.tryAgain": [
    "event_limit_reached",
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "task_not_retryable",
    "newer_task_exists",
    "pending_limit_reached",
    "consultation_unfinished",
    "destination_changed",
    "input_changed",
    "input_too_large",
    "limit_reached",
  ],
  "contribution.startAgain": [
    "event_limit_reached",
    ...researchMutationErrors,
    "uncertain",
    "operation_conflict",
    "record_not_found",
    "task_not_retryable",
    "newer_task_exists",
    "pending_limit_reached",
    "consultation_unfinished",
    "destination_changed",
    "input_changed",
    "limit_reached",
  ],
  "usagePause.resume": [...researchMutationErrors, "uncertain", "operation_conflict"],
  "task.continueAll": [...researchMutationErrors, "uncertain", "operation_conflict"],
  "pause.read": readErrors,
  "destination.read": [...readErrors, "record_not_found"],
  "project.create": [...researchMutationErrors, "uncertain", "operation_conflict"],
  "project.open": [
    ...researchMutationErrors,
    "record_not_found",
    "uncertain",
    "operation_conflict",
  ],
  "project.confirmSetup": [
    ...researchMutationErrors,
    "record_not_found",
    "proposal_not_waiting",
    "setup_reply_active",
    "uncertain",
    "operation_conflict",
  ],
  "project.rejectSetup": [
    ...researchMutationErrors,
    "record_not_found",
    "proposal_not_waiting",
    "uncertain",
    "operation_conflict",
  ],
  "conversation.start": [
    ...researchMutationErrors,
    "record_not_found",
    "project_in_setup",
    "agent_unavailable",
    "parts_incomplete",
    "message_invalid",
    "input_too_large",
    "pending_limit_reached",
    "uncertain",
    "operation_conflict",
  ],
  "conversation.rename": [
    ...researchMutationErrors,
    "record_not_found",
    "name_invalid",
    "stale_revision",
    "uncertain",
    "operation_conflict",
  ],
  "message.append": [
    ...researchMutationErrors,
    "record_not_found",
    "parts_incomplete",
    "message_invalid",
    "input_too_large",
    "pending_limit_reached",
    "uncertain",
    "operation_conflict",
  ],
  "projectAttention.list": readErrors,
  "project.list": [...readErrors, "record_not_found"],
  "conversation.list": [...readErrors, "record_not_found"],
  "conversation.read": [...readErrors, "record_not_found"],
  "timeline.listBefore": [...readErrors, "record_not_found"],
  "timeline.read": [...readErrors, "record_not_found"],
  "research.subscribe": [...readErrors, "record_not_found", "sequence_gap"],
  "text.part": [...readErrors],
  "text.readPart": [...readErrors, "record_not_found"],
  "agentPreference.list": readErrors,
  "agentPreference.replace": [
    ...readErrors,
    "uncertain",
    "operation_conflict",
    "stale_revision",
    "record_not_found",
  ],
  "providerModel.list": [...readErrors, "stale_revision", "record_not_found"],
  "reply.details": [...readErrors, "record_not_found"],
  "reply.readParts": [...readErrors, "record_not_found"],

  "connection.read": readErrors,
  "connection.subscribe": [...readErrors, "sequence_gap"],
  "connection.probe": readErrors,
  "connection.listModels": [...readErrors, "stale_revision"],
  "connection.connect": readErrors,
  "connection.replaceKey": readErrors,
  "connection.disconnect": readErrors,

  "bounds.read": [...readErrors, "preference_invalid"],
  "bounds.replace": replaceErrors,
  "bounds.receipt": readErrors,
  "presentation.read": [...readErrors, "preference_invalid"],
  "presentation.subscribe": [...readErrors, "sequence_gap", "preference_invalid"],
  "sourceQuote.replace": replaceErrors,
  "entryText.replace": replaceErrors,
  "sourceQuote.receipt": readErrors,
  "entryText.receipt": readErrors,
  "character.replace": replaceErrors,
  "character.receipt": readErrors,
  "zoom.replace": replaceErrors,
  "zoom.adjust": [...replaceErrors, "zoom_minimum", "zoom_maximum", "actual_size"],
  "zoom.commit": [...replaceErrors, "zoom_minimum", "zoom_maximum", "actual_size"],
  "zoom.receipt": readErrors,
  "zoom.apply": [...readErrors, "preference_invalid"],
  "locale.read": [...readErrors, "preference_invalid"],
  "locale.replace": replaceErrors,
  "locale.receipt": readErrors,
  "locale.subscribe": [...readErrors, "sequence_gap", "preference_invalid"],
  "status.read": readErrors,
  "appearance.read": [...readErrors, "preference_invalid"],
  "appearance.replace": replaceErrors,
  "layout.failureNotice": readErrors,
  "layout.read": readErrors,
  "layout.replace": replaceErrors,
  "layout.receipt": readErrors,
  "appearance.receipt": readErrors,
  "status.subscribe": [...readErrors, "sequence_gap"],
  "appearance.subscribe": [...readErrors, "sequence_gap", "preference_invalid"],
} as const satisfies Record<Operation, readonly ErrorCode[]>);
function operationOutcome(operation: Operation, value: Json | undefined): boolean {
  if (!outcome(value, (item) => output(operation, item)) || !object(value)) return false;
  if (value.ok === true) return true;
  const code = object(value.error) ? value.error.code : undefined;
  return (
    typeof code === "string" && operationErrorCodes[operation].some((allowed) => allowed === code)
  );
}

function executionLimits(value: Json | undefined): boolean {
  return (
    exact(value, ["serviceGeneration", "revision", "max_concurrent_inference", "running"]) &&
    isIdentifier(value.serviceGeneration) &&
    revision(value.revision) &&
    value.revision > 0 &&
    isInferenceLimit(value.max_concurrent_inference) &&
    revision(value.running)
  );
}
export function isProviderApiKey(value: unknown): value is string {
  return typeof value === "string" && /^[!-~]{1,1024}$/.test(value);
}
function input(operation: Operation, value: Json | undefined): boolean {
  if (isResearchOperation(operation)) return researchInput(operation, value);
  switch (operation) {
    case "connection.replaceKey":
      return (
        exact(value, ["connection", "key"]) &&
        isConnectionId(value.connection) &&
        isProviderApiKey(value.key)
      );
    case "connection.connect":
      return (
        (exact(value, ["connection"]) ||
          (exact(value, ["connection", "key"]) && isProviderApiKey(value.key)) ||
          (exact(value, ["connection", "new_registration"]) &&
            typeof value.new_registration === "boolean")) &&
        isConnectionId(value.connection)
      );
    case "connection.read":
    case "connection.disconnect":
    case "connection.probe":
      return exact(value, ["connection"]) && isConnectionId(value.connection);
    case "connection.subscribe":
      return (
        exact(value, ["connection", "subscriptionId"]) &&
        (value.connection === "*" || isConnectionId(value.connection)) &&
        isIdentifier(value.subscriptionId)
      );
    case "connection.listModels":
      return (
        exact(value, ["connection", "model_list_revision", "cursor", "count"]) &&
        isConnectionId(value.connection) &&
        revision(value.model_list_revision) &&
        value.model_list_revision > 0 &&
        revision(value.cursor) &&
        revision(value.count) &&
        value.count > 0 &&
        value.count <= 128
      );
    case "updateCheck.read":
    case "update.read":
    case "update.check":
    case "limits.read":
    case "presentation.read":
    case "zoom.apply":
    case "status.read":
    case "appearance.read":
    case "locale.read":
    case "layout.read":
    case "bounds.read":
    case "layout.failureNotice":
      return exact(value, []);
    case "limits.replace":
      return exact(value, ["value"]) && isInferenceLimit(value.value);
    case "updateCheck.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        typeof value.value === "boolean"
      );
    case "entryText.replace":
    case "sourceQuote.replace":
    case "character.replace":
    case "zoom.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        (operation === "character.replace"
          ? isCharacterPresentation(value.value)
          : operation === "zoom.replace"
            ? isInterfaceZoom(value.value)
            : isMemoryDisplayLength(value.value))
      );
    case "zoom.commit":
      return (
        exact(value, ["expectedRevision", "value", "intent"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        isInterfaceZoom(value.value) &&
        oneOf(value.intent, ["increase", "decrease", "reset"])
      );
    case "zoom.adjust":
      return exact(value, ["intent"]) && oneOf(value.intent, ["increase", "decrease", "reset"]);
    case "layout.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        isWorkspaceLayout(value.value)
      );
    case "bounds.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        isWindowBounds(value.value)
      );
    case "appearance.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        isAppearance(value.value)
      );
    case "locale.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        (value.value === "system" || oneOf(value.value, supportedLocales))
      );
    case "updateCheck.receipt":
    case "limits.receipt":
    case "entryText.receipt":
    case "sourceQuote.receipt":
    case "character.receipt":
    case "zoom.receipt":
    case "locale.receipt":
    case "layout.receipt":
    case "bounds.receipt":
    case "appearance.receipt":
      return exact(value, ["targetOperationId"]) && isIdentifier(value.targetOperationId);
    case "presentation.subscribe":
    case "status.subscribe":
    case "appearance.subscribe":
    case "locale.subscribe":
      return exact(value, ["subscriptionId"]) && isIdentifier(value.subscriptionId);
  }
}
function output(operation: Operation, value: Json | undefined): boolean {
  if (operation === "limits.read" || operation === "limits.replace") return executionLimits(value);
  if (operation === "limits.receipt") return receipt(value, executionLimits, []);
  if (operation === "updateCheck.read") return isUpdateCheckRecord(value);
  if (operation === "updateCheck.replace") return isSavedUpdateCheckRecord(value);
  if (operation === "updateCheck.receipt") return receipt(value, isSavedUpdateCheckRecord);
  if (operation === "update.read" || operation === "update.check")
    return isUpdateStateNotice(value);
  if (isResearchOperation(operation)) return researchOutput(operation, value);
  switch (operation) {
    case "connection.read":
    case "connection.connect":
    case "connection.replaceKey":
    case "connection.disconnect":
    case "connection.probe":
      return isConnectionSnapshot(value);
    case "connection.listModels":
      return isModelPage(value);
    case "connection.subscribe":
      return exact(value, ["subscriptionId"]) && isIdentifier(value.subscriptionId);
    case "bounds.read":
      return boundsRecord(value);
    case "bounds.replace":
      return savedBounds(value);
    case "bounds.receipt":
      return receipt(value, savedBounds);
    case "presentation.read":
      return presentationSnapshot(value);
    case "sourceQuote.replace":
      return savedMemoryLength(value, defaultSourceQuoteLength);
    case "entryText.replace":
      return savedMemoryLength(value, defaultEntryTextLength);
    case "sourceQuote.receipt":
      return receipt(value, (record) => savedMemoryLength(record, defaultSourceQuoteLength));
    case "entryText.receipt":
      return receipt(value, (record) => savedMemoryLength(record, defaultEntryTextLength));
    case "character.replace":
      return savedCharacter(value);
    case "character.receipt":
      return receipt(value, savedCharacter);
    case "zoom.replace":
    case "zoom.adjust":
    case "zoom.commit":
      return savedZoom(value);
    case "zoom.receipt":
      return receipt(value, savedZoom, ["stale_revision", ...zoomBoundaryErrors]);
    case "zoom.apply":
      return (
        exact(value, ["revision", "percent", "applied"]) &&
        revision(value.revision) &&
        isInterfaceZoom(value.percent) &&
        typeof value.applied === "boolean"
      );
    case "locale.read":
      return localeSnapshot(value);
    case "locale.replace":
      return savedLocale(value);
    case "locale.receipt":
      return receipt(value, savedLocale);
    case "layout.failureNotice":
      return exact(value, ["announce"]) && typeof value.announce === "boolean";
    case "layout.read":
      return layoutRecord(value);
    case "layout.replace":
      return savedLayout(value);
    case "layout.receipt":
      return receipt(value, savedLayout);
    case "status.read":
      return status(value);
    case "appearance.read":
      return appearance(value);
    case "appearance.replace":
      return savedAppearance(value);
    case "appearance.receipt":
      return receipt(value);
    case "presentation.subscribe":
    case "status.subscribe":
    case "appearance.subscribe":
    case "locale.subscribe":
      return exact(value, ["subscriptionId"]) && isIdentifier(value.subscriptionId);
  }
}

/** Measure strict Unicode scalar text without DOM or Node dependencies. */
export function utf8Size(text: string): number {
  let size = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Error("Invalid Unicode scalar.");
    size += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return size;
}
/** Copy only finite JSON data; never evaluate getters or toJSON. Root depth is one. */
function boundedJson(value: unknown, fractionalWidths = false): Json {
  let nodes = 0;
  function copy(item: unknown, depth: number): Json {
    if (++nodes > portLimits.message_nodes || depth > portLimits.message_depth)
      throw new Error("Message complexity exceeded.");
    if (item === null || typeof item === "boolean") return item;
    if (
      typeof item === "number" &&
      Number.isFinite(item) &&
      (fractionalWidths || Number.isSafeInteger(item)) &&
      Math.abs(item) <= Number.MAX_SAFE_INTEGER &&
      !Object.is(item, -0)
    )
      return item;
    if (
      typeof item === "string" &&
      item.length <= portLimits.string_bytes &&
      utf8Size(item) <= portLimits.string_bytes
    )
      return item;
    if (typeof item !== "object") throw new Error("Invalid JSON value.");
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype))
      throw new Error("Invalid prototype.");
    const keys = Reflect.ownKeys(item);
    if (keys.length > portLimits.container_items + (array ? 1 : 0))
      throw new Error("Container exceeded.");
    if (array && item.length > portLimits.container_items) throw new Error("Array exceeded.");
    const result: Json[] | ObjectValue = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (
        typeof key !== "string" ||
        ["__proto__", "prototype", "constructor"].includes(key) ||
        key.length > portLimits.string_bytes ||
        utf8Size(key) > portLimits.string_bytes
      )
        throw new Error("Invalid field.");
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
        throw new Error("Invalid descriptor.");
      if (array) {
        if (key !== String((result as Json[]).length)) throw new Error("Non-dense array.");
        (result as Json[]).push(copy(descriptor.value, depth + 1));
      } else (result as ObjectValue)[key] = copy(descriptor.value, depth + 1);
    }
    if (array && (result as Json[]).length !== item.length) throw new Error("Sparse array.");
    return result;
  }
  const result = copy(value, 1);
  if (utf8Size(JSON.stringify(result)) > portLimits.message_bytes)
    throw new Error("Message exceeded.");
  return result;
}
export function validateJsonBounds(value: unknown): Outcome<unknown> {
  try {
    return { ok: true, value: boundedJson(value) };
  } catch {
    return failure("invalid_message");
  }
}
const identityKeys = [
  "protocol",
  "policy",
  "kind",
  "requestId",
  "operationId",
  "windowGeneration",
  "serviceGeneration",
  "operation",
];
const operations: readonly Operation[] = [
  "updateCheck.read",
  "updateCheck.replace",
  "updateCheck.receipt",
  "update.read",
  "update.check",
  "limits.read",
  "limits.replace",
  "limits.receipt",
  ...researchOperations,
  "connection.read",
  "connection.subscribe",
  "connection.probe",
  "connection.listModels",
  "connection.connect",
  "connection.replaceKey",
  "connection.disconnect",

  "presentation.read",
  "presentation.subscribe",
  "sourceQuote.replace",
  "entryText.replace",
  "sourceQuote.receipt",
  "entryText.receipt",
  "character.replace",
  "character.receipt",
  "zoom.replace",
  "zoom.adjust",
  "zoom.commit",
  "zoom.receipt",
  "zoom.apply",
  "locale.read",
  "locale.replace",
  "locale.receipt",
  "locale.subscribe",
  "bounds.read",
  "bounds.replace",
  "bounds.receipt",
  "layout.failureNotice",
  "layout.read",
  "layout.replace",
  "layout.receipt",
  "status.read",
  "appearance.read",
  "appearance.replace",
  "appearance.receipt",
  "status.subscribe",
  "appearance.subscribe",
];
/** Validate every inbound/outbound envelope and return a detached JSON copy. */
export function decodeEnvelope(raw: unknown): Outcome<Envelope> {
  let value: Json;
  try {
    value = boundedJson(raw, true);
  } catch {
    return failure("invalid_message");
  }
  if (!object(value)) return failure("invalid_message");
  if (
    typeof value.protocol !== "number" ||
    !Number.isSafeInteger(value.protocol) ||
    value.protocol <= 0
  )
    return failure("invalid_message");
  if (value.protocol !== protocolVersion) return failure("unsupported_version");
  if (typeof value.policy !== "string") return failure("invalid_message");
  if (value.policy !== policyId) return failure("policy_mismatch");
  if (!isIdentifier(value.windowGeneration) || !isIdentifier(value.serviceGeneration))
    return failure("invalid_message");
  let valid = false;
  if (value.kind === "event") {
    valid =
      exact(value, [
        "protocol",
        "policy",
        "kind",
        "windowGeneration",
        "serviceGeneration",
        "subscriptionId",
        "sequence",
        "topic",
        "payload",
      ]) &&
      isIdentifier(value.subscriptionId) &&
      revision(value.sequence) &&
      value.sequence > 0 &&
      (value.topic === "research"
        ? isResearchEvent(value.payload)
        : value.topic === "connection"
          ? isConnectionEvent(value.payload)
          : value.topic === "presentation"
            ? presentationSnapshot(value.payload)
            : value.topic === "status"
              ? status(value.payload)
              : value.topic === "locale"
                ? localeSnapshot(value.payload)
                : value.topic === "appearance" && appearance(value.payload));
  } else if (value.kind === "unsubscribe") {
    valid =
      exact(value, [
        "protocol",
        "policy",
        "kind",
        "windowGeneration",
        "serviceGeneration",
        "subscriptionId",
      ]) && isIdentifier(value.subscriptionId);
  } else if (
    isIdentifier(value.requestId) &&
    isIdentifier(value.operationId) &&
    oneOf(value.operation, operations)
  ) {
    const op = value.operation;
    if (value.kind === "cancel") valid = exact(value, identityKeys);
    else if (exact(value, [...identityKeys, "payload"])) {
      if (value.kind === "request")
        valid =
          input(op, value.payload) &&
          utf8Size(JSON.stringify(value.payload)) <=
            (isResearchOperation(op)
              ? portLimits.research_input_bytes
              : portLimits.initial_input_bytes) &&
          object(value.payload) &&
          Object.keys(value.payload).length <= portLimits.initial_input_items;
      else if (value.kind === "result") valid = operationOutcome(op, value.payload);
    }
  }
  if (
    valid &&
    (value.kind === "result" || value.kind === "event") &&
    utf8Size(JSON.stringify(value.payload)) > portLimits.initial_output_bytes
  )
    valid = false;
  if (
    valid &&
    value.kind === "event" &&
    (value.topic === "locale" || value.topic === "presentation") &&
    object(value.payload) &&
    value.payload.serviceGeneration !== value.serviceGeneration
  )
    valid = false;
  if (
    valid &&
    value.kind === "result" &&
    (value.operation === "locale.read" ||
      value.operation === "presentation.read" ||
      value.operation === "limits.read" ||
      value.operation === "limits.replace") &&
    object(value.payload) &&
    value.payload.ok === true &&
    object(value.payload.value) &&
    value.payload.value.serviceGeneration !== value.serviceGeneration
  )
    valid = false;
  if (
    valid &&
    value.kind === "result" &&
    value.operation === "limits.receipt" &&
    object(value.payload) &&
    value.payload.ok === true &&
    object(value.payload.value) &&
    value.payload.value.state === "recorded" &&
    object(value.payload.value.outcome) &&
    object(value.payload.value.outcome.value) &&
    value.payload.value.outcome.value.serviceGeneration !== value.serviceGeneration
  )
    valid = false;
  // Shape validation above is the runtime proof of this discriminated union.
  return valid ? { ok: true, value: value as unknown as Envelope } : failure("invalid_message");
}
export function encodeEnvelope(value: unknown): Outcome<string> {
  const result = decodeEnvelope(value);
  return result.ok ? { ok: true, value: JSON.stringify(result.value) } : result;
}
/** Compact JSON only: re-encoding also rejects duplicate keys and ambiguous spellings. */
export function decodeText(text: unknown): Outcome<Envelope> {
  if (typeof text !== "string" || text.length > portLimits.message_bytes)
    return failure("invalid_message");
  try {
    if (utf8Size(text) > portLimits.message_bytes) return failure("invalid_message");
    const parsed: unknown = JSON.parse(text);
    if (JSON.stringify(parsed) !== text) return failure("invalid_message");
    return decodeEnvelope(parsed);
  } catch {
    return failure("invalid_message");
  }
}
/** Fatal UTF-8, including overlong sequences, surrogate encodings and BOM. */
export function decodeUtf8(bytes: Uint8Array): Outcome<Envelope> {
  if (bytes.byteLength > portLimits.message_bytes) return failure("invalid_message");
  let text = "";
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    if (first === undefined) return failure("invalid_message");
    if (first < 0x80) {
      text += String.fromCodePoint(first);
      continue;
    }
    const count =
      first >= 0xc2 && first <= 0xdf
        ? 1
        : first >= 0xe0 && first <= 0xef
          ? 2
          : first >= 0xf0 && first <= 0xf4
            ? 3
            : -1;
    if (count < 0 || i + count > bytes.length) return failure("invalid_message");
    let cp = first & (0x7f >> (count + 1));
    for (let n = 0; n < count; n++) {
      const next = bytes[i++];
      if (next === undefined) return failure("invalid_message");
      if ((next & 0xc0) !== 0x80) return failure("invalid_message");
      cp = cp * 64 + (next & 0x3f);
    }
    if (
      cp < ([0, 0x80, 0x800, 0x10000][count] ?? Infinity) ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    )
      return failure("invalid_message");
    text += String.fromCodePoint(cp);
  }
  return decodeText(text);
}

export function decodeAppearanceChange(raw: unknown): Outcome<AppearanceChange> {
  try {
    const value = boundedJson(raw, true);
    if (
      exact(value, ["operationId", "expectedRevision", "value"]) &&
      isIdentifier(value.operationId) &&
      revision(value.expectedRevision) &&
      value.expectedRevision < Number.MAX_SAFE_INTEGER &&
      isAppearance(value.value)
    )
      return {
        ok: true,
        value: {
          operationId: value.operationId,
          expectedRevision: value.expectedRevision,
          value: value.value,
        },
      };
  } catch {
    /* Reject without exposing caller data. */
  }
  return failure("invalid_message");
}

export function decodeLocaleChange(raw: unknown): Outcome<LocaleChange> {
  try {
    const value = boundedJson(raw);
    if (exact(value, ["operationId", "expectedRevision", "value"])) {
      const { operationId, ...payload } = value;
      if (isIdentifier(operationId) && input("locale.replace", payload))
        return { ok: true, value: value as unknown as LocaleChange };
    }
  } catch {
    /* Controlled rejection without caller data. */
  }
  return failure("invalid_message");
}

/** Trusted peers use the same detached runtime schema as port snapshots. */
export function decodeLocaleSnapshot(raw: unknown): LocaleSnapshot | undefined {
  try {
    const value = boundedJson(raw);
    if (localeSnapshot(value)) return value as unknown as LocaleSnapshot;
  } catch {
    /* Reject without diagnostic data. */
  }
  return undefined;
}
export function decodeLayoutChange(raw: unknown): Outcome<LayoutChange> {
  try {
    const value = boundedJson(raw, true);
    if (
      exact(value, ["operationId", "expectedRevision", "value"]) &&
      isIdentifier(value.operationId) &&
      revision(value.expectedRevision) &&
      value.expectedRevision < Number.MAX_SAFE_INTEGER &&
      isWorkspaceLayout(value.value)
    )
      return { ok: true, value: value as unknown as LayoutChange };
  } catch {
    /* Reject without exposing caller data. */
  }
  return failure("invalid_message");
}

export function decodeWindowBoundsChange(raw: unknown): Outcome<WindowBoundsChange> {
  try {
    const value = boundedJson(raw, true);
    if (
      exact(value, ["operationId", "expectedRevision", "value"]) &&
      isIdentifier(value.operationId) &&
      revision(value.expectedRevision) &&
      value.expectedRevision < Number.MAX_SAFE_INTEGER &&
      isWindowBounds(value.value)
    )
      return { ok: true, value: value as unknown as WindowBoundsChange };
  } catch {
    /* Reject without exposing caller data. */
  }
  return failure("invalid_message");
}
export function decodePresentationChange<K extends PresentationFeature>(
  feature: K,
  raw: unknown,
): Outcome<PresentationChange<PresentationValues[K]>> {
  try {
    const value = boundedJson(raw);
    if (exact(value, ["operationId", "expectedRevision", "value"])) {
      const { operationId, ...payload } = value;
      if (isIdentifier(operationId) && input(`${feature}.replace`, payload))
        return {
          ok: true,
          value: value as unknown as PresentationChange<PresentationValues[K]>,
        };
    }
  } catch {
    /* Controlled rejection without caller data. */
  }
  return failure("invalid_message");
}
export function decodePresentationSnapshot(raw: unknown): PresentationSnapshot | undefined {
  try {
    const value = boundedJson(raw);
    if (presentationSnapshot(value)) return value as unknown as PresentationSnapshot;
  } catch {
    /* Controlled rejection. */
  }
  return undefined;
}

export function decodeExecutionLimitsChange(raw: unknown): Outcome<ExecutionLimitsChange> {
  try {
    const value = boundedJson(raw);
    if (
      exact(value, ["operationId", "value"]) &&
      isIdentifier(value.operationId) &&
      isInferenceLimit(value.value)
    )
      return { ok: true, value: value as unknown as ExecutionLimitsChange };
  } catch {
    /* Reject without exposing caller data. */
  }
  return failure("invalid_message");
}

export function decodeUpdateCheckChange(raw: unknown): Outcome<UpdateCheckChange> {
  try {
    const value = boundedJson(raw);
    if (
      exact(value, ["operationId", "expectedRevision", "value"]) &&
      isIdentifier(value.operationId) &&
      revision(value.expectedRevision) &&
      value.expectedRevision < Number.MAX_SAFE_INTEGER &&
      typeof value.value === "boolean"
    )
      return {
        ok: true,
        value: {
          operationId: value.operationId,
          expectedRevision: value.expectedRevision,
          value: value.value,
        },
      };
  } catch {
    /* Reject without exposing caller data. */
  }
  return failure("invalid_message");
}
