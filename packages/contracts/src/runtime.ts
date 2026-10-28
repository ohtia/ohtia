import { isInterfaceLocale } from "./locale.js";
import type { FoundationPort, InterfaceLocale } from "./port.js";

export const desktopDocument = "ohtia://app/index.html";
/** Private fixed channels; these are never exposed as bridge arguments. */
export const desktopChannels = {
  session: "ohtia:session",
  ended: "ohtia:service-ended",
  port: "ohtia:foundation",
  reply: "ohtia:foundation-result",
  bootstrap: "ohtia:bootstrap",
} as const;
export const bootstrapStates = [
  "missing",
  "located",
  "pending_create",
  "locator_invalid",
  "locator_newer",
  "locator_unreadable",
  "path_rejected",
] as const;
export type BootstrapState = (typeof bootstrapStates)[number];
export type BootstrapNotice = "shutdown_uncertain" | "resource_failure";
export interface BootstrapSnapshot {
  readonly version: 1;
  readonly locale: InterfaceLocale;
  readonly state: BootstrapState;
  readonly notice?: BootstrapNotice;
}
export type BootstrapAction = "read" | "retry_service" | "exit" | "new_window";
export const bootstrapActions: readonly BootstrapAction[] = [
  "read",
  "retry_service",
  "exit",
  "new_window",
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
      record.notice !== "resource_failure") ||
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
  readonly foundation: FoundationPort;
  readonly bootstrap: {
    read(): Promise<BootstrapSnapshot>;
    retryService(): Promise<BootstrapSnapshot>;
    newWindow(): Promise<BootstrapSnapshot>;
    exit(): Promise<BootstrapSnapshot>;
  };
}
