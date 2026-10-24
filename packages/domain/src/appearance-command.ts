import {
  failure,
  staleRevision,
  type Appearance,
  type AppearanceRecord,
  type SavedAppearanceRecord,
  type RecordedAppearanceOutcome,
  type Outcome,
} from "@ohtia/contracts";

export interface AppearanceCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: Appearance;
}
export interface RecordedAppearanceCommand {
  readonly expectedRevision: number;
  readonly value: Appearance;
  readonly outcome: RecordedAppearanceOutcome;
}
/** The storage owner supplies one serialized, atomic transaction for state and receipt. */
export interface AppearanceTransaction {
  readReceipt(operationId: string): RecordedAppearanceCommand | undefined;
  readAppearance(): Outcome<AppearanceRecord>;
  replaceAppearance(value: Appearance): SavedAppearanceRecord;
  recordReceipt(operationId: string, receipt: RecordedAppearanceCommand): void;
}
/** Called only with a decoded request in an admitted data-service transaction. */
export function applyAppearanceCommand(
  transaction: AppearanceTransaction,
  command: AppearanceCommand,
): Outcome<SavedAppearanceRecord> {
  const recorded = transaction.readReceipt(command.operationId);
  if (recorded) {
    return recorded.expectedRevision === command.expectedRevision &&
      recorded.value === command.value
      ? recorded.outcome
      : failure("operation_conflict");
  }
  const current = transaction.readAppearance();
  // A rejected stored presentation value needs an explicit replacement path owned by storage.
  // Its revision must still be known; this port never overwrites an unknown revision.
  if (!current.ok) return current;
  const outcome: RecordedAppearanceOutcome =
    current.value.revision === command.expectedRevision
      ? { ok: true, value: transaction.replaceAppearance(command.value) }
      : staleRevision(current.value.revision);
  transaction.recordReceipt(command.operationId, {
    expectedRevision: command.expectedRevision,
    value: command.value,
    outcome,
  });
  return outcome;
}
