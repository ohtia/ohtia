import { isResearchId, type ResearchScope } from "./research-port.js";
import { isArtifactVersion, isCanonicalUuid, type DiagnosticsBridge } from "./diagnostics.js";
import type { CommandBridge } from "./commands.js";
import { isInterfaceLocale } from "./locale.js";
import { isIdentifier, type FoundationPort, type InterfaceLocale } from "./port.js";
import type { UpdateStateNotice } from "./update-check.js";

export const desktopDocument = "ohtia://app/index.html";
/** Private fixed channels; these are never exposed as bridge arguments. */
export const desktopChannels = {
  session: "ohtia:session",
  ended: "ohtia:service-ended",
  reconnect: "ohtia:reconnect",
  preferencesReady: "ohtia:preferences-ready",
  port: "ohtia:foundation",
  reply: "ohtia:foundation-result",
  diagnosticsRead: "ohtia:diagnostics-read",
  diagnosticsDelete: "ohtia:diagnostics-delete",
  diagnosticsBundle: "ohtia:diagnostics-bundle",
  bootstrap: "ohtia:bootstrap",
  commands: "ohtia:commands",
  commandIntent: "ohtia:command-intent",
  exitState: "ohtia:exit-state",
  manuscriptClose: "ohtia:manuscript-close",
  systemMotion: "ohtia:system-motion",
  updateState: "ohtia:update-state",
} as const;
/** ADR-0047: a native reduced-motion observation beside Chromium's own media query. */
export const systemMotions = ["reduce", "no_preference", "unknown"] as const;
export type SystemMotion = (typeof systemMotions)[number];
export interface SystemMotionNotice {
  readonly sequence: number;
  readonly value: SystemMotion;
}
export function decodeSystemMotionNotice(value: unknown): SystemMotionNotice | undefined {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "sequence,value" ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 0 ||
    !systemMotions.some((motion) => motion === record.value)
  )
    return;
  return { sequence: record.sequence as number, value: record.value as SystemMotion };
}
/** Read-only renderer view of the native observation; listeners receive each later value. */
export interface SystemMotionBridge {
  readMotion(): SystemMotion;
  subscribeMotion(listener: (value: SystemMotion) => void): () => void;
}
/**
 * SPEC-001-040: each later numbered update state main publishes. The first comes from
 * `update.read`; a consumer keeps the state with the highest `sequence`.
 */
export interface UpdateBridge {
  subscribeState(listener: (notice: UpdateStateNotice) => void): () => void;
}
export const bootstrapStates = [
  "missing",
  "located",
  "pending_create",
  "locator_invalid",
  "locator_newer",
  "locator_unreadable",
  "path_rejected",
  "storage_ready",
  "storage_opening",
  "storage_failed",
  "recovery_required",
  "retry_required",
  "checkpoint_restored",
  "publication_uncertain",
] as const;
export type BootstrapState = (typeof bootstrapStates)[number];
const bootstrapNotices = [
  "shutdown_uncertain",
  "resource_failure",
  "locale_fallback",
  "recovery_busy",
  "recovery_stale",
  "recovery_failed",
  "recovery_uncertain",
  "recovery_unavailable",
] as const;
export type BootstrapNotice = (typeof bootstrapNotices)[number];

export interface CheckpointDetails {
  readonly operation: string;
  readonly sourceRevision: number;
  readonly targetRevision: number;
  readonly release: string;
  readonly bytes: number;
}
export interface VerifiedCheckpoint extends CheckpointDetails {
  readonly sha256: string;
}
export interface BootstrapCheckpoint extends CheckpointDetails {
  readonly verification: string;
}
export const checkpointProblems = [
  "checkpoint_missing",
  "checkpoint_invalid",
  "checkpoint_incompatible",
  "checkpoint_unreadable",
] as const;
export type CheckpointProblem = (typeof checkpointProblems)[number];

export function isCheckpointDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function isCheckpointProjection(
  value: unknown,
  identity: "sha256" | "verification",
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  const record = value as Record<string, unknown>;
  const { bytes, operation, release, sourceRevision, targetRevision } = record;
  return (
    Object.keys(record).sort().join(",") ===
      (identity === "sha256"
        ? "bytes,operation,release,sha256,sourceRevision,targetRevision"
        : "bytes,operation,release,sourceRevision,targetRevision,verification") &&
    isCanonicalUuid(operation) &&
    isArtifactVersion(release) &&
    typeof bytes === "number" &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    typeof sourceRevision === "number" &&
    Number.isSafeInteger(sourceRevision) &&
    sourceRevision >= 0 &&
    typeof targetRevision === "number" &&
    Number.isSafeInteger(targetRevision) &&
    targetRevision > sourceRevision &&
    (identity === "sha256"
      ? isCheckpointDigest(record.sha256)
      : isCanonicalUuid(record.verification))
  );
}
function isCheckpointProblem(value: unknown): value is CheckpointProblem {
  return checkpointProblems.some((problem) => problem === value);
}
export interface BootstrapSnapshot {
  readonly openConversation?: ResearchScope;
  readonly navigateConversation?: ResearchScope & { readonly revision: number };
  readonly restoreLastProject?: boolean;
  readonly serviceGeneration?: string;
  readonly version: 1;
  readonly locale: InterfaceLocale;
  readonly state: BootstrapState;
  readonly notice?: BootstrapNotice;
  readonly checkpoint?: BootstrapCheckpoint;
  readonly checkpointProblem?: CheckpointProblem;
}
export type BootstrapAction =
  "read" | "retry_service" | "exit" | "new_window" | "restore_checkpoint" | "open_storage";
export const bootstrapActions: readonly BootstrapAction[] = [
  "read",
  "retry_service",
  "exit",
  "new_window",
  "restore_checkpoint",
  "open_storage",
];
export function isBootstrapAction(value: unknown): value is BootstrapAction {
  return typeof value === "string" && bootstrapActions.some((action) => action === value);
}
export function decodeBootstrapSnapshot(value: unknown): BootstrapSnapshot | undefined {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const record = value as Record<string, unknown>;
  if (
    ![
      "locale,state,version",
      "locale,notice,state,version",
      "locale,openConversation,state,version",
      "locale,notice,openConversation,state,version",
    ].includes(
      Object.keys(record)
        .filter(
          (key) =>
            key !== "checkpoint" &&
            key !== "checkpointProblem" &&
            key !== "restoreLastProject" &&
            key !== "navigateConversation" &&
            key !== "serviceGeneration",
        )
        .sort()
        .join(","),
    ) ||
    ("restoreLastProject" in record && typeof record.restoreLastProject !== "boolean") ||
    ("serviceGeneration" in record &&
      (record.state !== "storage_ready" || !isIdentifier(record.serviceGeneration))) ||
    ("navigateConversation" in record &&
      (!record.navigateConversation ||
        typeof record.navigateConversation !== "object" ||
        Object.keys(record.navigateConversation).sort().join(",") !==
          "conversationId,projectId,revision" ||
        !isResearchId((record.navigateConversation as ResearchScope).projectId) ||
        !isResearchId((record.navigateConversation as ResearchScope).conversationId) ||
        !Number.isSafeInteger((record.navigateConversation as { revision: number }).revision) ||
        (record.navigateConversation as { revision: number }).revision < 1)) ||
    ("notice" in record && !bootstrapNotices.some((notice) => notice === record.notice)) ||
    ("checkpoint" in record &&
      (record.state !== "recovery_required" ||
        !isCheckpointProjection(record.checkpoint, "verification"))) ||
    ("checkpointProblem" in record &&
      (record.state !== "retry_required" || !isCheckpointProblem(record.checkpointProblem))) ||
    ("openConversation" in record &&
      (!record.openConversation ||
        typeof record.openConversation !== "object" ||
        Object.keys(record.openConversation).sort().join(",") !== "conversationId,projectId" ||
        !isResearchId((record.openConversation as ResearchScope).projectId) ||
        !isResearchId((record.openConversation as ResearchScope).conversationId))) ||
    record.version !== 1 ||
    !isInterfaceLocale(record.locale) ||
    !bootstrapStates.some((state) => state === record.state)
  )
    return;
  return {
    ...(record.navigateConversation
      ? {
          navigateConversation: record.navigateConversation as NonNullable<
            BootstrapSnapshot["navigateConversation"]
          >,
        }
      : {}),
    ...("restoreLastProject" in record
      ? { restoreLastProject: record.restoreLastProject as boolean }
      : {}),
    ...(record.openConversation
      ? { openConversation: record.openConversation as ResearchScope }
      : {}),
    ...(typeof record.serviceGeneration === "string"
      ? { serviceGeneration: record.serviceGeneration }
      : {}),
    version: 1,
    locale: record.locale,
    state: record.state as BootstrapState,
    ...(record.notice ? { notice: record.notice as BootstrapNotice } : {}),
    ...(record.checkpoint ? { checkpoint: record.checkpoint as BootstrapCheckpoint } : {}),
    ...(record.checkpointProblem
      ? { checkpointProblem: record.checkpointProblem as CheckpointProblem }
      : {}),
  };
}
export interface DesktopBridge {
  readonly commands: CommandBridge;
  readonly system: SystemMotionBridge;
  readonly update: UpdateBridge;
  readonly diagnostics: DiagnosticsBridge;
  readonly foundation: FoundationPort;
  readonly bootstrap: {
    read(): Promise<BootstrapSnapshot>;
    retryService(): Promise<BootstrapSnapshot>;
    newWindow(): Promise<BootstrapSnapshot>;
    exit(): Promise<BootstrapSnapshot>;
    restoreCheckpoint(verification: string): Promise<BootstrapSnapshot>;
    openStorage(): Promise<BootstrapSnapshot>;
  };
}

/** Private utility-to-broker lifecycle acknowledgement; never carries a path or diagnostic string. */
export interface StorageNotice {
  readonly kind: "storage";
  readonly generation: string;
  readonly state:
    | "storage_ready"
    | "storage_failed"
    | "recovery_required"
    | "retry_required"
    | "checkpoint_restored";
  readonly savedLocale?: InterfaceLocale;
  readonly localeFallback?: true;
  readonly checkpoint?: VerifiedCheckpoint;
  readonly checkpointProblem?: CheckpointProblem;
  readonly restoreFailure?: "recovery_failed" | "recovery_stale";
}
export function decodeStorageNotice(value: unknown): StorageNotice | undefined {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(
    (key) => key !== "checkpoint" && key !== "checkpointProblem" && key !== "restoreFailure",
  );
  if (
    ![
      "generation,kind,state",
      "generation,kind,savedLocale,state",
      "generation,kind,localeFallback,state",
    ].includes(keys.sort().join(",")) ||
    (record.state === "recovery_required"
      ? !isCheckpointProjection(record.checkpoint, "sha256")
      : "checkpoint" in record) ||
    (record.state === "retry_required"
      ? !isCheckpointProblem(record.checkpointProblem)
      : "checkpointProblem" in record) ||
    ("restoreFailure" in record &&
      (record.state === "storage_ready" ||
        record.state === "checkpoint_restored" ||
        (record.restoreFailure !== "recovery_failed" &&
          record.restoreFailure !== "recovery_stale"))) ||
    ("localeFallback" in record &&
      (record.localeFallback !== true || record.state !== "storage_ready")) ||
    record.kind !== "storage" ||
    typeof record.generation !== "string" ||
    ![
      "storage_ready",
      "storage_failed",
      "recovery_required",
      "retry_required",
      "checkpoint_restored",
    ].includes(String(record.state)) ||
    ("savedLocale" in record &&
      (record.state !== "storage_ready" || !isInterfaceLocale(record.savedLocale)))
  )
    return;
  return record as unknown as StorageNotice;
}
