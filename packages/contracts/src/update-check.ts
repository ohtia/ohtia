import { portLimits } from "./generated/resource-policy.js";

/** SPEC-001-040: the startup check preference; a missing record means enabled. */
export interface UpdateCheckRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly value: boolean;
  readonly source: "saved" | "default" | "invalid_fallback";
}
export type SavedUpdateCheckRecord = UpdateCheckRecord & { readonly source: "saved" };
export interface UpdateCheckChange {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: boolean;
}
/** An unreadable saved record never starts a request the researcher may have turned off. */
export const updateCheckFallback = false;

export const updateCheckStates = ["unavailable", "idle", "checking", "checked", "failed"] as const;
export type UpdateCheckState = (typeof updateCheckStates)[number];
export const updateCheckFailures = ["timeout", "network", "invalid_response", "too_large"] as const;
export type UpdateCheckFailure = (typeof updateCheckFailures)[number];
export interface AvailableUpdate {
  /** Final SemVer version without the tag's leading `v`. */
  readonly version: string;
  /** Release notes as inert text, split at code points into port-sized parts. */
  readonly notes: readonly string[];
  readonly notesTruncated: boolean;
}
/**
 * Main's current knowledge. `checked` means the last check completed; `available` then says
 * whether it found a newer version. `failed` reports only a manual check; a failed startup check
 * returns to `idle`. A failure keeps the `available` of the last completed check.
 */
export interface UpdateState {
  readonly installedVersion: string;
  readonly check: UpdateCheckState;
  readonly failure: UpdateCheckFailure | null;
  readonly available: AvailableUpdate | null;
}
export interface UpdateStateNotice {
  readonly sequence: number;
  readonly state: UpdateState;
}

const finalVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionText = /^[0-9A-Za-z.+-]{1,64}$/;
/** A final `MAJOR.MINOR.PATCH` version whose parts are safe integers. */
export function isFinalVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    finalVersion.test(value) &&
    value.split(".").every((part) => Number.isSafeInteger(Number(part)))
  );
}
function plain(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function utf8Bytes(text: string): number {
  let size = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) return Infinity;
    size += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return size;
}
function isNotes(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    value.every(
      (part) =>
        typeof part === "string" && part.length > 0 && utf8Bytes(part) <= portLimits.string_bytes,
    ) &&
    utf8Bytes(JSON.stringify(value)) <= portLimits.update_notes_bytes
  );
}
export function isAvailableUpdate(value: unknown): value is AvailableUpdate {
  return (
    plain(value, ["version", "notes", "notesTruncated"]) &&
    isFinalVersion(value.version) &&
    isNotes(value.notes) &&
    typeof value.notesTruncated === "boolean"
  );
}
export function isUpdateState(value: unknown): value is UpdateState {
  if (!plain(value, ["installedVersion", "check", "failure", "available"])) return false;
  const check = value.check;
  return (
    typeof value.installedVersion === "string" &&
    versionText.test(value.installedVersion) &&
    updateCheckStates.some((state) => state === check) &&
    (check === "failed"
      ? updateCheckFailures.some((failure) => failure === value.failure)
      : value.failure === null) &&
    (value.available === null || (check !== "unavailable" && isAvailableUpdate(value.available)))
  );
}
/** The broker numbers every state; a read, a check result and a push compare by `sequence`. */
export function isUpdateStateNotice(value: unknown): value is UpdateStateNotice {
  return (
    plain(value, ["sequence", "state"]) &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    isUpdateState(value.state)
  );
}
export function decodeUpdateStateNotice(value: unknown): UpdateStateNotice | undefined {
  if (!isUpdateStateNotice(value)) return;
  return { sequence: value.sequence, state: value.state };
}
export function isUpdateCheckRecord(value: unknown): value is UpdateCheckRecord {
  return (
    plain(value, ["schemaVersion", "revision", "value", "source"]) &&
    value.schemaVersion === 1 &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    typeof value.value === "boolean" &&
    (value.source === "saved"
      ? (value.revision as number) > 0
      : value.source === "default"
        ? value.revision === 0 && value.value
        : value.source === "invalid_fallback" && value.value === updateCheckFallback)
  );
}
export function isSavedUpdateCheckRecord(value: unknown): value is SavedUpdateCheckRecord {
  return isUpdateCheckRecord(value) && value.source === "saved";
}
