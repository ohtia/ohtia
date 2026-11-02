import type { CommandBridge } from "./commands.js";
import { isInterfaceLocale } from "./locale.js";
import type { FoundationPort, InterfaceLocale } from "./port.js";

export const desktopDocument = "ohtia://app/index.html";
/** Private fixed channels; these are never exposed as bridge arguments. */
export const desktopChannels = {
  session: "ohtia:session",
  ended: "ohtia:service-ended",
  reconnect: "ohtia:reconnect",
  preferencesReady: "ohtia:preferences-ready",
  port: "ohtia:foundation",
  reply: "ohtia:foundation-result",
  bootstrap: "ohtia:bootstrap",
  commands: "ohtia:commands",
  commandIntent: "ohtia:command-intent",
} as const;
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
export type BootstrapNotice = "shutdown_uncertain" | "resource_failure" | "locale_fallback";
export interface BootstrapSnapshot {
  readonly version: 1;
  readonly locale: InterfaceLocale;
  readonly state: BootstrapState;
  readonly notice?: BootstrapNotice;
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
    !["locale,state,version", "locale,notice,state,version"].includes(
      Object.keys(record).sort().join(","),
    ) ||
    ("notice" in record &&
      record.notice !== "shutdown_uncertain" &&
      record.notice !== "resource_failure" &&
      record.notice !== "locale_fallback") ||
    record.version !== 1 ||
    !isInterfaceLocale(record.locale) ||
    !bootstrapStates.some((state) => state === record.state)
  )
    return;
  return {
    version: 1,
    locale: record.locale,
    state: record.state as BootstrapState,
    ...(record.notice ? { notice: record.notice as BootstrapNotice } : {}),
  };
}
export interface DesktopBridge {
  readonly commands: CommandBridge;
  readonly foundation: FoundationPort;
  readonly bootstrap: {
    read(): Promise<BootstrapSnapshot>;
    retryService(): Promise<BootstrapSnapshot>;
    newWindow(): Promise<BootstrapSnapshot>;
    exit(): Promise<BootstrapSnapshot>;
    restoreCheckpoint(): Promise<BootstrapSnapshot>;
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
}
export function decodeStorageNotice(value: unknown): StorageNotice | undefined {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const record = value as Record<string, unknown>;
  if (
    ![
      "generation,kind,state",
      "generation,kind,savedLocale,state",
      "generation,kind,localeFallback,state",
    ].includes(Object.keys(record).sort().join(",")) ||
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
