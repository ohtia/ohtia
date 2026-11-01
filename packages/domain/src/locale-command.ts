import {
  failure,
  staleRevision,
  type LocaleChoice,
  type LocaleRecord,
  type SavedLocaleRecord,
  type RecordedLocaleOutcome,
  type Outcome,
} from "@ohtia/contracts";

export interface LocaleCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: LocaleChoice;
}
export interface RecordedLocaleCommand {
  readonly expectedRevision: number;
  readonly value: LocaleChoice;
  readonly outcome: RecordedLocaleOutcome;
}
/** The storage owner supplies one serialized, atomic transaction for state and receipt. */
export interface LocaleTransaction {
  readReceipt(operationId: string): RecordedLocaleCommand | undefined;
  readLocale(): Outcome<LocaleRecord>;
  replaceLocale(value: LocaleChoice): SavedLocaleRecord;
  recordReceipt(operationId: string, receipt: RecordedLocaleCommand): void;
}
/** Called only with a decoded request in an admitted data-service transaction. */
export function applyLocaleCommand(
  transaction: LocaleTransaction,
  command: LocaleCommand,
): Outcome<SavedLocaleRecord> {
  const recorded = transaction.readReceipt(command.operationId);
  if (recorded) {
    return recorded.expectedRevision === command.expectedRevision &&
      recorded.value === command.value
      ? recorded.outcome
      : failure("operation_conflict");
  }
  const current = transaction.readLocale();
  // A rejected stored presentation value needs an explicit replacement path owned by storage.
  // Its revision must still be known; this port never overwrites an unknown revision.
  if (!current.ok) return current;
  const outcome: RecordedLocaleOutcome =
    current.value.revision === command.expectedRevision
      ? { ok: true, value: transaction.replaceLocale(command.value) }
      : staleRevision(current.value.revision);
  transaction.recordReceipt(command.operationId, {
    expectedRevision: command.expectedRevision,
    value: command.value,
    outcome,
  });
  return outcome;
}
