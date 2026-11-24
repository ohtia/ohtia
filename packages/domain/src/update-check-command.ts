import {
  failure,
  staleRevision,
  type UpdateCheckRecord,
  type SavedUpdateCheckRecord,
  type RecordedUpdateCheckOutcome,
  type Outcome,
} from "@ohtia/contracts";

export interface UpdateCheckCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: boolean;
}
export interface RecordedUpdateCheckCommand {
  readonly expectedRevision: number;
  readonly value: boolean;
  readonly outcome: RecordedUpdateCheckOutcome;
}
/** The storage owner supplies one serialized, atomic transaction for state and receipt. */
export interface UpdateCheckTransaction {
  readReceipt(operationId: string): RecordedUpdateCheckCommand | undefined;
  readUpdateCheck(): Outcome<UpdateCheckRecord>;
  replaceUpdateCheck(value: boolean): SavedUpdateCheckRecord;
  recordReceipt(operationId: string, receipt: RecordedUpdateCheckCommand): void;
}
/** Called only with a decoded request in an admitted data-service transaction. */
export function applyUpdateCheckCommand(
  transaction: UpdateCheckTransaction,
  command: UpdateCheckCommand,
): Outcome<SavedUpdateCheckRecord> {
  const recorded = transaction.readReceipt(command.operationId);
  if (recorded) {
    return recorded.expectedRevision === command.expectedRevision &&
      recorded.value === command.value
      ? recorded.outcome
      : failure("operation_conflict");
  }
  const current = transaction.readUpdateCheck();
  // An unreadable record keeps its revision, so a replacement can still name it.
  if (!current.ok) return current;
  const outcome: RecordedUpdateCheckOutcome =
    current.value.revision === command.expectedRevision
      ? { ok: true, value: transaction.replaceUpdateCheck(command.value) }
      : staleRevision(current.value.revision);
  transaction.recordReceipt(command.operationId, {
    expectedRevision: command.expectedRevision,
    value: command.value,
    outcome,
  });
  return outcome;
}
