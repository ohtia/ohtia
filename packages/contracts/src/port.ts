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
  isCharacterPresentation,
  isInterfaceZoom,
  zoomBoundaryErrors,
  type CharacterPresentation,
  type InterfaceZoom,
  type PresentationChange,
  type SavedPresentationRecord,
  type PresentationReceipt,
  type PresentationSnapshot,
  type ZoomIntent,
} from "./presentation.js";
import { isWorkspaceLayout, type WorkspaceLayout } from "./layout.js";
import { isAppearance, type Appearance } from "./appearance.js";
import { policyId, portLimits } from "./generated/resource-policy.js";
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
  project_not_in_setup: "refresh_record",
  project_in_setup: "refresh_record",
  record_not_found: "refresh_record",
  name_invalid: "check_request",
  input_too_large: "check_request",
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
      : Record<string, never>;
  };
}[ErrorCode];
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PortError };
export function failure(code: Exclude<ErrorCode, "stale_revision">): {
  readonly ok: false;
  readonly error: PortError;
} {
  return {
    ok: false,
    error: { code, nextAction: errorActions[code], parameters: {} } as PortError,
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
export interface OperationInputs {
  "connection.read": { readonly connection: string };
  "connection.subscribe": { readonly connection: string; readonly subscriptionId: string };
  "connection.probe": { readonly connection: string };
  "connection.listModels": ModelPageInput;
  "connection.connect": { readonly connection: string; readonly new_registration?: boolean };
  "connection.disconnect": { readonly connection: string };

  "bounds.read": Record<string, never>;
  "bounds.replace": { readonly expectedRevision: number; readonly value: WindowBounds };
  "bounds.receipt": { readonly targetOperationId: string };
  "presentation.read": Record<string, never>;
  "presentation.subscribe": { readonly subscriptionId: string };
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
export interface OperationOutputs {
  "connection.read": ConnectionSnapshot;
  "connection.subscribe": { readonly subscriptionId: string };
  "connection.probe": ConnectionSnapshot;
  "connection.listModels": ModelPage;
  "connection.connect": ConnectionSnapshot;
  "connection.disconnect": ConnectionSnapshot;

  "bounds.read": WindowBoundsRecord;
  "bounds.replace": SavedWindowBoundsRecord;
  "bounds.receipt": WindowBoundsReceipt;
  "presentation.read": PresentationSnapshot;
  "presentation.subscribe": { readonly subscriptionId: string };
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
export interface FoundationPort {
  readConnection(connection: string): PortCall<ConnectionSnapshot>;
  connectConnection(
    connection: string,
    options?: { readonly new_registration?: boolean },
  ): PortCall<ConnectionSnapshot>;
  disconnectConnection(connection: string): PortCall<ConnectionSnapshot>;
  probeConnection(connection: string): PortCall<ConnectionSnapshot>;
  listConnectionModels(input: ModelPageInput): PortCall<ModelPage>;
  subscribeConnection(
    connection: string,
    listener: (notice: Outcome<ConnectionEvent>) => void,
  ): Subscription;
  readPresentation(): PortCall<PresentationSnapshot>;
  subscribePresentation(listener: (notice: Outcome<PresentationSnapshot>) => void): Subscription;
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
function savedCharacter(value: Json | undefined): boolean {
  return characterRecord(value) && object(value) && value.source === "saved";
}
function savedZoom(value: Json | undefined): boolean {
  return zoomRecord(value) && object(value) && value.source === "saved";
}
function presentationSnapshot(value: Json | undefined): boolean {
  return (
    exact(value, ["serviceGeneration", "appearance", "character", "zoom"]) &&
    isIdentifier(value.serviceGeneration) &&
    appearance(value.appearance) &&
    characterRecord(value.character) &&
    zoomRecord(value.zoom)
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
export const operationErrorCodes = Object.freeze({
  "connection.read": readErrors,
  "connection.subscribe": [...readErrors, "sequence_gap"],
  "connection.probe": readErrors,
  "connection.listModels": [...readErrors, "stale_revision"],
  "connection.connect": readErrors,
  "connection.disconnect": readErrors,

  "bounds.read": [...readErrors, "preference_invalid"],
  "bounds.replace": replaceErrors,
  "bounds.receipt": readErrors,
  "presentation.read": [...readErrors, "preference_invalid"],
  "presentation.subscribe": [...readErrors, "sequence_gap", "preference_invalid"],
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

function input(operation: Operation, value: Json | undefined): boolean {
  switch (operation) {
    case "connection.connect":
      return (
        (exact(value, ["connection"]) ||
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
        isConnectionId(value.connection) &&
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
    case "presentation.read":
    case "zoom.apply":
    case "status.read":
    case "appearance.read":
    case "locale.read":
    case "layout.read":
    case "bounds.read":
    case "layout.failureNotice":
      return exact(value, []);
    case "character.replace":
    case "zoom.replace":
      return (
        exact(value, ["expectedRevision", "value"]) &&
        revision(value.expectedRevision) &&
        value.expectedRevision < Number.MAX_SAFE_INTEGER &&
        (operation === "character.replace"
          ? isCharacterPresentation(value.value)
          : isInterfaceZoom(value.value))
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
  switch (operation) {
    case "connection.read":
    case "connection.connect":
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
  "connection.read",
  "connection.subscribe",
  "connection.probe",
  "connection.listModels",
  "connection.connect",
  "connection.disconnect",

  "presentation.read",
  "presentation.subscribe",
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
      (value.topic === "connection"
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
          utf8Size(JSON.stringify(value.payload)) <= portLimits.initial_input_bytes &&
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
    (value.operation === "locale.read" || value.operation === "presentation.read") &&
    object(value.payload) &&
    value.payload.ok === true &&
    object(value.payload.value) &&
    value.payload.value.serviceGeneration !== value.serviceGeneration
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
export function decodePresentationChange<K extends "character" | "zoom">(
  feature: K,
  raw: unknown,
): Outcome<PresentationChange<K extends "character" ? CharacterPresentation : InterfaceZoom>> {
  try {
    const value = boundedJson(raw);
    if (exact(value, ["operationId", "expectedRevision", "value"])) {
      const { operationId, ...payload } = value;
      if (
        isIdentifier(operationId) &&
        input(feature === "character" ? "character.replace" : "zoom.replace", payload)
      )
        return {
          ok: true,
          value: value as unknown as PresentationChange<
            K extends "character" ? CharacterPresentation : InterfaceZoom
          >,
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
