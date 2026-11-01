import {
  failure,
  staleRevision,
  sameWorkspaceLayout,
  type LayoutChange,
  type LayoutRecord,
  type SavedLayoutRecord,
  type RecordedLayoutOutcome,
  type Outcome,
} from "@ohtia/contracts";
export interface RecordedLayoutCommand {
  readonly expectedRevision: number;
  readonly value: LayoutChange["value"];
  readonly outcome: RecordedLayoutOutcome;
}
/** Storage supplies one atomic transaction for the named preference and its receipt. */
export interface LayoutTransaction {
  readReceipt(operationId: string): RecordedLayoutCommand | undefined;
  readLayout(): Outcome<LayoutRecord>;
  replaceLayout(value: LayoutChange["value"]): SavedLayoutRecord;
  recordReceipt(operationId: string, receipt: RecordedLayoutCommand): void;
}
export function applyLayoutCommand(
  transaction: LayoutTransaction,
  command: LayoutChange,
): Outcome<SavedLayoutRecord> {
  const recorded = transaction.readReceipt(command.operationId);
  if (recorded)
    return recorded.expectedRevision === command.expectedRevision &&
      sameWorkspaceLayout(recorded.value, command.value)
      ? recorded.outcome
      : failure("operation_conflict");
  const current = transaction.readLayout();
  if (!current.ok) return current;
  const outcome: RecordedLayoutOutcome =
    current.value.revision === command.expectedRevision
      ? { ok: true, value: transaction.replaceLayout(command.value) }
      : staleRevision(current.value.revision);
  transaction.recordReceipt(command.operationId, {
    expectedRevision: command.expectedRevision,
    value: command.value,
    outcome,
  });
  return outcome;
}
