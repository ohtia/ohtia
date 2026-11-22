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
    readonly late_usage: "none" | "reported";
  };
  readonly signInModes: readonly ("provider_login" | "api_key")[];
  readonly connection: {
    readonly id: string;
    readonly displayName: string;
    readonly kind: "subscription" | "api_key";
    readonly usageUrl: string | null;
  };
}
export type EffortSupport = "supported" | "unsupported" | "unknown";
export interface ProviderModel {
  readonly id: string;
  readonly name: string;
  readonly effortSupport?: EffortSupport;
  readonly effortLevels?: readonly {
    readonly name: string;
    readonly supported: boolean;
  }[];
  readonly defaultEffort?: string;
  readonly maxOutput?: number;
  readonly origin?: "service" | "catalog";
  readonly retiring?: boolean;
}
export const agentPreferenceTargets = ["default", "virgilio", "josefa"] as const;
export type AgentPreferenceTarget = (typeof agentPreferenceTargets)[number];
export interface ReplaceAgentPreference {
  readonly target: AgentPreferenceTarget;
  readonly expectedRevision: number;
  readonly connection: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly inherit: boolean;
  readonly source: "researcher" | "first_connection";
}
export interface AgentPreference {
  readonly target: AgentPreferenceTarget;
  readonly revision: number;
  readonly connection: string | null;
  readonly model: string | null;
  readonly modelName: string | null;
  readonly effort: string | null;
  readonly inherit: boolean;
  readonly source: "researcher" | "first_connection" | "migration";
  readonly seedPending: boolean;
}
export interface ProviderModelListInfo {
  readonly connection: string;
  readonly kind: "subscription" | "api_key";
  readonly list_revision: number;
  readonly count: number;
  readonly updatedAt: string;
  readonly current?: boolean;
}
export interface AgentPreferences {
  readonly receipt?: "recorded" | "not_found";
  readonly preferences: readonly AgentPreference[];
  readonly lists: readonly ProviderModelListInfo[];
}
export interface ProviderModelPageInput {
  readonly connection: string;
  readonly list_revision: number;
  readonly cursor: number;
  readonly count: number;
}
export interface ProviderModelPage extends Omit<ModelPage, "model_list_revision"> {
  readonly list_revision: number;
}
export interface ConnectionSnapshot {
  readonly connection: string;
  readonly state: ConnectionState;
  readonly reason: ConnectionReason | null;
  readonly display_name: string;
  readonly account_email: string | null;
  /** Opaque version of the current account view, unrelated to the credential or fingerprint. */
  readonly account_revision?: string;
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
const modelDetails = [
  "effortSupport",
  "effortLevels",
  "defaultEffort",
  "maxOutput",
  "origin",
  "retiring",
];
function present(value: Record<string, unknown>, key: string, check: (value: unknown) => boolean) {
  return !Object.hasOwn(value, key) || check(value[key]);
}
function name(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function modelId(value: unknown): value is string {
  return name(value) && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
function choice(value: unknown): value is string {
  return name(value) && value.length <= 128;
}
type EffortLevel = NonNullable<ProviderModel["effortLevels"]>[number];
function isEffortLevel(value: unknown): value is EffortLevel {
  return (
    record(value) &&
    exact(value, ["name", "supported"]) &&
    choice(value.name) &&
    typeof value.supported === "boolean"
  );
}
function isEffortLevels(value: unknown): value is readonly EffortLevel[] {
  if (!Array.isArray(value) || value.length > 32) return false;
  const items: unknown[] = value;
  return items.every(isEffortLevel) && new Set(items.map(({ name }) => name)).size === items.length;
}
export function isProviderModel(value: unknown): value is ProviderModel {
  if (!record(value)) return false;
  const levels = isEffortLevels(value.effortLevels) ? value.effortLevels : undefined;
  return (
    exact(value, ["id", "name", ...modelDetails.filter((key) => Object.hasOwn(value, key))]) &&
    modelId(value.id) &&
    name(value.name) &&
    present(
      value,
      "effortSupport",
      (support) => support === "supported" || support === "unsupported" || support === "unknown",
    ) &&
    present(
      value,
      "effortLevels",
      () =>
        !!levels &&
        (value.effortSupport === "supported" || levels.every((level) => !level.supported)),
    ) &&
    present(
      value,
      "defaultEffort",
      (level) => choice(level) && !!levels?.some((item) => item.name === level && item.supported),
    ) &&
    present(value, "maxOutput", (maximum) => integer(maximum) && maximum !== 0) &&
    present(value, "origin", (origin) => origin === "service" || origin === "catalog") &&
    present(value, "retiring", (retiring) => typeof retiring === "boolean")
  );
}
function preferenceChoice(value: Record<string, unknown>): boolean {
  return (
    agentPreferenceTargets.includes(value.target as AgentPreferenceTarget) &&
    (value.connection === null || isConnectionId(value.connection)) &&
    (value.model === null || modelId(value.model)) &&
    (value.effort === null || choice(value.effort)) &&
    typeof value.inherit === "boolean" &&
    (value.inherit
      ? value.target !== "default" && value.connection === null && value.model === null
      : (value.connection === null) === (value.model === null))
  );
}
export function isReplaceAgentPreference(value: unknown): value is ReplaceAgentPreference {
  return (
    record(value) &&
    exact(value, [
      "target",
      "expectedRevision",
      "connection",
      "model",
      "effort",
      "inherit",
      "source",
    ]) &&
    preferenceChoice(value) &&
    integer(value.expectedRevision) &&
    (value.inherit || value.model !== null) &&
    (value.source === "researcher" ||
      (value.source === "first_connection" &&
        value.target === "default" &&
        value.expectedRevision === 0))
  );
}
export function isAgentPreferences(value: unknown): value is AgentPreferences {
  return (
    record(value) &&
    exact(value, [
      "preferences",
      "lists",
      ...(Object.hasOwn(value, "receipt") ? ["receipt"] : []),
    ]) &&
    (!Object.hasOwn(value, "receipt") ||
      value.receipt === "recorded" ||
      value.receipt === "not_found") &&
    Array.isArray(value.preferences) &&
    value.preferences.length <= agentPreferenceTargets.length &&
    value.preferences.every(
      (item) =>
        record(item) &&
        exact(item, [
          "target",
          "revision",
          "connection",
          "model",
          "modelName",
          "effort",
          "inherit",
          "source",
          "seedPending",
        ]) &&
        preferenceChoice(item) &&
        integer(item.revision) &&
        item.revision > 0 &&
        (item.modelName === null || name(item.modelName)) &&
        (item.source === "researcher" ||
          item.source === "first_connection" ||
          item.source === "migration") &&
        typeof item.seedPending === "boolean",
    ) &&
    Array.isArray(value.lists) &&
    value.lists.every(
      (item) =>
        record(item) &&
        exact(item, [
          "connection",
          "kind",
          "list_revision",
          "count",
          "updatedAt",
          ...(Object.hasOwn(item, "current") ? ["current"] : []),
        ]) &&
        (!Object.hasOwn(item, "current") || typeof item.current === "boolean") &&
        isConnectionId(item.connection) &&
        (item.kind === "subscription" || item.kind === "api_key") &&
        integer(item.list_revision) &&
        item.list_revision > 0 &&
        integer(item.count) &&
        typeof item.updatedAt === "string" &&
        Number.isFinite(Date.parse(item.updatedAt)),
    )
  );
}
export function isProviderModelPageInput(value: unknown): value is ProviderModelPageInput {
  return (
    record(value) &&
    exact(value, ["connection", "list_revision", "cursor", "count"]) &&
    isConnectionId(value.connection) &&
    integer(value.list_revision) &&
    value.list_revision > 0 &&
    integer(value.cursor) &&
    integer(value.count) &&
    value.count > 0 &&
    value.count <= 128
  );
}
export function isProviderModelPage(value: unknown): value is ProviderModelPage {
  if (!record(value)) return false;
  const { list_revision, ...rest } = value;
  return (
    isModelPage({ ...rest, model_list_revision: list_revision }) &&
    (rest.models as unknown[]).length <= 128
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
      ...(Object.hasOwn(value, "account_revision") ? ["account_revision"] : []),
      "last_account_email",
      "probing",
      "probe_id",
      "model_list_revision",
      "model_count",
    ]) &&
    snapshotFields(value)
  );
}
export function isAccountRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
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
    (!Object.hasOwn(value, "account_revision") ||
      (value.state === "connected" && isAccountRevision(value.account_revision))) &&
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
  ] as const;
  const caps = value.capabilities;
  return (
    isConnectionId(value.id) &&
    typeof value.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(value.version) &&
    record(caps) &&
    exact(caps, [...capabilities, "late_usage"]) &&
    capabilities.every((key) => typeof caps[key] === "boolean") &&
    (caps.late_usage === "none" || caps.late_usage === "reported") &&
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

/** Declared inference slots; undeclared connections retain ADR-0011's limit of one. */
export const connectionInferenceLimits: Readonly<Record<string, number>> = Object.freeze({
  chatgpt: 3,
  fake: 1,
});

/** Connection metadata shared by the adapter declaration and its destination presentation. */
export const chatgptConnection = Object.freeze({
  id: "chatgpt",
  displayName: "ChatGPT",
  kind: "subscription",
  usageUrl: "https://chatgpt.com/settings/usage",
} as const satisfies ProviderDeclaration["connection"]);
