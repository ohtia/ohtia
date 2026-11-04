import {
  failure,
  staleRevision,
  sameWindowBounds,
  type WindowBoundsChange,
  type WindowBoundsRecord,
  type SavedWindowBoundsRecord,
  type RecordedWindowBoundsOutcome,
  type Outcome,
} from "@ohtia/contracts";
export interface RecordedWindowBoundsCommand {
  readonly expectedRevision: number;
  readonly value: WindowBoundsChange["value"];
  readonly outcome: RecordedWindowBoundsOutcome;
}
/** Storage supplies one atomic transaction for the named preference and its receipt. */
export interface WindowBoundsTransaction {
  readReceipt(operationId: string): RecordedWindowBoundsCommand | undefined;
  readWindowBounds(): Outcome<WindowBoundsRecord>;
  replaceWindowBounds(value: WindowBoundsChange["value"]): SavedWindowBoundsRecord;
  recordReceipt(operationId: string, receipt: RecordedWindowBoundsCommand): void;
}
export function applyWindowBoundsCommand(
  transaction: WindowBoundsTransaction,
  command: WindowBoundsChange,
): Outcome<SavedWindowBoundsRecord> {
  const recorded = transaction.readReceipt(command.operationId);
  if (recorded)
    return recorded.expectedRevision === command.expectedRevision &&
      sameWindowBounds(recorded.value, command.value)
      ? recorded.outcome
      : failure("operation_conflict");
  const current = transaction.readWindowBounds();
  if (!current.ok) return current;
  const outcome: RecordedWindowBoundsOutcome =
    current.value.revision === command.expectedRevision
      ? { ok: true, value: transaction.replaceWindowBounds(command.value) }
      : staleRevision(current.value.revision);
  transaction.recordReceipt(command.operationId, {
    expectedRevision: command.expectedRevision,
    value: command.value,
    outcome,
  });
  return outcome;
}
