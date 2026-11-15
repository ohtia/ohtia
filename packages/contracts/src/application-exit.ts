import { isIdentifier } from "./port.js";

/** Private broker/data-service lifecycle messages; no research content crosses this boundary. */
export interface ApplicationExitControl {
  readonly kind: "application_exit";
  readonly generation: string;
  readonly operationId: string;
  readonly action: "hold" | "resume" | "cancel";
}
export interface ApplicationExitState {
  readonly kind: "application_exit_state";
  readonly generation: string;
  readonly operationId: string;
  readonly running: number;
  readonly held: boolean;
  readonly cancelled: boolean;
  readonly failed: boolean;
}
export interface ExitDialogState {
  readonly operationId: string;
  readonly running: number;
  readonly phase: "confirm" | "waiting" | "cancelling";
  readonly failed: boolean;
}
export type ExitChoice = "close" | "wait" | "cancel";
export function isExitChoice(value: unknown): value is ExitChoice {
  return value === "close" || value === "wait" || value === "cancel";
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isExitDialogState(value: unknown): value is ExitDialogState {
  return (
    record(value) &&
    Object.keys(value).sort().join(",") === "failed,operationId,phase,running" &&
    isIdentifier(value.operationId) &&
    Number.isSafeInteger(value.running) &&
    Number(value.running) >= 0 &&
    (value.phase === "confirm" || value.phase === "waiting" || value.phase === "cancelling") &&
    typeof value.failed === "boolean"
  );
}
export function decodeApplicationExit(
  input: unknown,
): ApplicationExitControl | ApplicationExitState | undefined {
  if (typeof input !== "string" || input.length > 1024) return;
  try {
    const value: unknown = JSON.parse(input);
    if (!record(value) || !isIdentifier(value.generation) || !isIdentifier(value.operationId))
      return;
    const keys = Object.keys(value).sort().join(",");
    if (
      value.kind === "application_exit" &&
      keys === "action,generation,kind,operationId" &&
      (value.action === "hold" || value.action === "resume" || value.action === "cancel")
    )
      return value as unknown as ApplicationExitControl;
    if (
      value.kind === "application_exit_state" &&
      keys === "cancelled,failed,generation,held,kind,operationId,running" &&
      Number.isSafeInteger(value.running) &&
      Number(value.running) >= 0 &&
      typeof value.held === "boolean" &&
      typeof value.cancelled === "boolean" &&
      typeof value.failed === "boolean"
    )
      return value as unknown as ApplicationExitState;
  } catch {
    /* Invalid private messages have no lifecycle authority. */
  }
  return;
}
