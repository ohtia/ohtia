/** Provider-neutral connection metadata. Credentials never cross this boundary. */
export const connectionStates = [
  "disconnected",
  "connecting",
  "connected",
  "expired",
  "error",
] as const;
export type ConnectionState = (typeof connectionStates)[number];
export const connectionReasons = [
  "store_unavailable",
  "sign_in_timeout",
  "plan_use_not_allowed",
  "sign_in_rejected",
] as const;
export type ConnectionReason = (typeof connectionReasons)[number];
export interface ProviderDeclaration {
  readonly id: string;
  readonly version: string;
  readonly capabilities: {
    readonly text: boolean;
    readonly attachments: boolean;
    readonly structuredOutput: boolean;
    readonly streaming: boolean;
    readonly tools: boolean;
    readonly interruption: boolean;
    readonly resumption: boolean;
    readonly modelSelection: boolean;
    readonly effortSelection: boolean;
    readonly usageReporting: boolean;
  };
  readonly signInModes: readonly ("provider_login" | "api_key")[];
  readonly connection: {
    readonly id: string;
    readonly displayName: string;
    readonly kind: "subscription" | "api_key";
    readonly usageUrl: string | null;
  };
}
export interface ProviderModel {
  readonly id: string;
  readonly name: string;
}
export interface ConnectionSnapshot {
  readonly connection: string;
  readonly state: ConnectionState;
  readonly reason: ConnectionReason | null;
  readonly display_name: string;
  readonly account_email: string | null;
  readonly last_account_email: string | null;
  readonly probing: boolean;
  readonly probe_id: string | null;
  readonly model_list_revision: number | null;
  readonly model_count: number;
}
export type ConnectionEvent = ConnectionSnapshot &
  (
    | { readonly kind: "state" }
    | { readonly kind: "probe_result"; readonly outcome: "listed" | "unreachable" }
  );
export interface ModelPageInput {
  readonly connection: string;
  readonly model_list_revision: number;
  readonly cursor: number;
  readonly count: number;
}
export interface ModelPage {
  readonly connection: string;
  readonly model_list_revision: number;
  readonly models: readonly ProviderModel[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
}
export function isConnectionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z_]+$/.test(value) && value.length <= 128;
}
export function connectionReasonMatches(
  state: ConnectionState,
  reason: ConnectionReason | null,
): boolean {
  return (
    reason === null || (reason === "sign_in_timeout" ? state === "disconnected" : state === "error")
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function isProviderModel(value: unknown): value is ProviderModel {
  return (
    record(value) &&
    exact(value, ["id", "name"]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0
  );
}
export function isConnectionSnapshot(value: unknown): value is ConnectionSnapshot {
  return (
    record(value) &&
    exact(value, [
      "connection",
      "state",
      "reason",
      "display_name",
      "account_email",
      "last_account_email",
      "probing",
      "probe_id",
      "model_list_revision",
      "model_count",
    ]) &&
    snapshotFields(value)
  );
}
function snapshotFields(value: Record<string, unknown>): boolean {
  return (
    isConnectionId(value.connection) &&
    connectionStates.includes(value.state as ConnectionState) &&
    (value.reason === null || connectionReasons.includes(value.reason as ConnectionReason)) &&
    connectionReasonMatches(
      value.state as ConnectionState,
      value.reason as ConnectionReason | null,
    ) &&
    typeof value.display_name === "string" &&
    value.display_name.length > 0 &&
    (value.account_email === null ||
      (typeof value.account_email === "string" && value.account_email.length > 0)) &&
    (value.last_account_email === null ||
      (typeof value.last_account_email === "string" && value.last_account_email.length > 0)) &&
    typeof value.probing === "boolean" &&
    (value.probe_id === null ||
      (typeof value.probe_id === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.probe_id))) &&
    (!value.probing || value.probe_id !== null) &&
    (value.model_list_revision === null ||
      (integer(value.model_list_revision) && value.model_list_revision > 0)) &&
    integer(value.model_count) &&
    (value.model_list_revision !== null || value.model_count === 0)
  );
}
export function isConnectionEvent(value: unknown): value is ConnectionEvent {
  if (!record(value)) return false;
  const { kind, outcome, ...snapshot } = value;
  if (kind === "state") return !Object.hasOwn(value, "outcome") && isConnectionSnapshot(snapshot);
  return (
    kind === "probe_result" &&
    (outcome === "listed" || outcome === "unreachable") &&
    isConnectionSnapshot(snapshot) &&
    !snapshot.probing &&
    snapshot.probe_id !== null
  );
}
export function isModelPage(value: unknown): value is ModelPage {
  return (
    record(value) &&
    exact(value, ["connection", "model_list_revision", "models", "nextCursor", "hasMore"]) &&
    isConnectionId(value.connection) &&
    integer(value.model_list_revision) &&
    value.model_list_revision > 0 &&
    Array.isArray(value.models) &&
    value.models.every(isProviderModel) &&
    integer(value.nextCursor) &&
    typeof value.hasMore === "boolean"
  );
}
export function isProviderDeclaration(value: unknown): value is ProviderDeclaration {
  if (
    !record(value) ||
    !exact(value, ["id", "version", "capabilities", "signInModes", "connection"])
  )
    return false;
  const c = value.connection;
  const capabilities = [
    "text",
    "attachments",
    "structuredOutput",
    "streaming",
    "tools",
    "interruption",
    "resumption",
    "modelSelection",
    "effortSelection",
    "usageReporting",
  ];
  return (
    isConnectionId(value.id) &&
    typeof value.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(value.version) &&
    record(value.capabilities) &&
    exact(value.capabilities, capabilities) &&
    Object.values(value.capabilities).every((v) => typeof v === "boolean") &&
    Array.isArray(value.signInModes) &&
    value.signInModes.length > 0 &&
    new Set(value.signInModes).size === value.signInModes.length &&
    value.signInModes.every((v) => v === "api_key" || v === "provider_login") &&
    record(c) &&
    exact(c, ["id", "displayName", "kind", "usageUrl"]) &&
    isConnectionId(c.id) &&
    typeof c.displayName === "string" &&
    c.displayName.length > 0 &&
    (c.kind === "subscription" || c.kind === "api_key") &&
    value.signInModes.includes(c.kind === "api_key" ? "api_key" : "provider_login") &&
    (c.usageUrl === null ||
      (typeof c.usageUrl === "string" && /^https:\/\/[^\s]+$/.test(c.usageUrl)))
  );
}
