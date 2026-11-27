import {
  portLimits,
  type ApplicationExitControl,
  type ApplicationExitState,
  type ExitDialogState,
  type ExitChoice,
} from "@ohtia/contracts";

/** Wait precedes broker shutdown. This controller owns no timer for the running replies. */
export class ApplicationExit {
  private current: { generation: string; dialog: ExitDialogState; checking: boolean } | undefined;
  private finished: { generation: string; operationId: string } | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly host: {
      identity(): string;
      send(control: ApplicationExitControl): boolean;
      changed(state: ExitDialogState | undefined): void;
      finish(): void;
      failed(): void;
    },
  ) {}
  get state(): ExitDialogState | undefined {
    return this.current?.checking ? undefined : this.current?.dialog;
  }
  get pending(): boolean {
    return !!this.current;
  }
  request(generation: string): void {
    if (this.current) {
      this.host.changed(this.state);
      return;
    }
    const operationId = this.host.identity();
    this.finished = undefined;
    this.current = {
      generation,
      checking: true,
      dialog: { operationId, running: 0, phase: "confirm", failed: false },
    };
    this.deadline = setTimeout(() => {
      this.abort();
    }, portLimits.request_deadline_ms);
    if (!this.send("hold")) this.abort();
  }
  private send(action: ApplicationExitControl["action"]): boolean {
    const current = this.current;
    return (
      !!current &&
      this.host.send({
        kind: "application_exit",
        generation: current.generation,
        operationId: current.dialog.operationId,
        action,
      })
    );
  }
  receive(state: ApplicationExitState): void {
    const current = this.current;
    if (
      !current ||
      state.generation !== current.generation ||
      state.operationId !== current.dialog.operationId ||
      !state.held
    )
      return;
    if (current.checking && state.failed) {
      this.abort();
      return;
    }
    // Count pushes do not acknowledge task.cancelAll; keep its receipt deadline active.
    if (
      current.checking ||
      current.dialog.phase !== "cancelling" ||
      state.cancelled ||
      state.failed
    )
      clearTimeout(this.deadline);
    current.checking = false;
    current.dialog = { ...current.dialog, running: state.running, failed: state.failed };
    if (
      !state.failed &&
      state.running === 0 &&
      (current.dialog.phase !== "cancelling" || state.cancelled)
    ) {
      this.finish();
      return;
    }
    this.host.changed(current.dialog);
  }
  choose(operationId: string, choice: ExitChoice): boolean {
    const current = this.current;
    if (!current || current.checking || current.dialog.operationId !== operationId) return false;
    if (current.dialog.phase === "cancelling" && !current.dialog.failed) return choice === "cancel";
    if (choice === "close") {
      this.send("resume");
      this.clear();
    } else if (choice === "wait") {
      current.dialog = { ...current.dialog, phase: "waiting" };
      this.host.changed(current.dialog);
      if (!current.dialog.failed && current.dialog.running === 0) this.finish();
    } else {
      current.dialog = { ...current.dialog, phase: "cancelling", failed: false };
      this.host.changed(current.dialog);
      this.deadline = setTimeout(() => {
        this.abort();
      }, portLimits.request_deadline_ms);
      if (!this.send("cancel")) this.abort();
    }
    return true;
  }
  abort(reportFailure = true): void {
    if (!this.current) return;
    this.send("resume");
    this.clear();
    if (reportFailure) this.host.failed();
  }
  systemShutdown(): void {
    this.clear();
    this.host.finish();
  }
  /** A later step held the approved quit; let the service dispatch work again. */
  resumeHeld(): void {
    const finished = this.finished;
    this.finished = undefined;
    if (finished)
      this.host.send({
        kind: "application_exit",
        generation: finished.generation,
        operationId: finished.operationId,
        action: "resume",
      });
  }
  private finish(): void {
    const current = this.current;
    if (current)
      this.finished = { generation: current.generation, operationId: current.dialog.operationId };
    this.clear();
    this.host.finish();
  }
  private clear(): void {
    clearTimeout(this.deadline);
    this.current = undefined;
    this.host.changed(undefined);
  }
}
