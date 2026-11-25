import type { FoundationPort, UpdateCheckRecord } from "@ohtia/contracts";

export interface UpdateCheckSettingState {
  readonly current?: UpdateCheckRecord;
  readonly phase: "idle" | "submitting" | "confirmed" | "rejected" | "conflict" | "uncertain";
  readonly readFailed: boolean;
  /** The value shown while a change is pending; the saved value otherwise. */
  readonly draft: boolean;
}

/**
 * SPEC-001-040: the startup-check preference with revision and receipt. An uncertain save is only
 * reconciled through its receipt, never repeated blindly; a stale revision rereads the record.
 */
export class UpdateCheckController {
  private state: UpdateCheckSettingState = { phase: "idle", readFailed: false, draft: true };
  private readonly listeners = new Set<() => void>();
  private pending: { readonly operationId: string; readonly value: boolean } | undefined;
  /** Revision of this window's latest settled save; a newer record came from another window. */
  private ownRevision = 0;
  private disposed = false;
  constructor(
    private readonly port: FoundationPort,
    private readonly nextId: () => string,
  ) {}
  private isDisposed(): boolean {
    return this.disposed;
  }
  snapshot = (): UpdateCheckSettingState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<UpdateCheckSettingState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
  private accept(record: UpdateCheckRecord): void {
    const previous = this.state.current;
    if (previous && previous.source === "saved" && previous.revision > record.revision) return;
    this.update({ current: record, ...(!this.pending ? { draft: record.value } : {}) });
  }
  /**
   * A saved operation shows the newest known record: when another window saved after it, that
   * value stays and the conflict notice says so.
   */
  private settle(saved: UpdateCheckRecord): void {
    this.ownRevision = Math.max(this.ownRevision, saved.revision);
    this.accept(saved);
    const current = this.state.current ?? saved;
    this.update({
      phase: current.revision > saved.revision ? "conflict" : "confirmed",
      draft: current.value,
    });
  }
  refresh = async (): Promise<void> => {
    if (this.disposed) return;
    const result = await this.port.readUpdateCheck().result;
    if (this.isDisposed()) return;
    if (result.ok) this.accept(result.value);
    this.update({ readFailed: !result.ok });
  };
  choose = async (value: boolean): Promise<boolean> => {
    const current = this.state.current;
    if (this.disposed || !current || this.pending) return false;
    const command = { operationId: this.nextId(), value };
    this.pending = command;
    this.update({ phase: "submitting", draft: value });
    const result = await this.port.replaceUpdateCheck({
      operationId: command.operationId,
      expectedRevision: current.revision,
      value,
    }).result;
    if (this.isDisposed() || this.pending !== command) return result.ok;
    if (!result.ok && result.error.code === "uncertain") {
      this.update({ phase: "uncertain" });
      return false;
    }
    this.pending = undefined;
    if (result.ok) {
      this.settle(result.value);
      return true;
    }
    const conflict = result.error.code === "stale_revision";
    this.update({ phase: conflict ? "conflict" : "rejected", draft: current.value });
    await this.refresh();
    return false;
  };
  /** Reads the receipt of an uncertain save; a recorded outcome settles it, otherwise it stays. */
  check = async (): Promise<void> => {
    const command = this.pending;
    if (this.disposed || !command || this.state.phase !== "uncertain") return;
    const result = await this.port.readUpdateCheckReceipt(command.operationId).result;
    if (this.isDisposed() || this.pending !== command) return;
    if (!result.ok || result.value.state === "pending") return;
    this.pending = undefined;
    const saved =
      result.value.state === "recorded" && result.value.outcome.ok
        ? result.value.outcome.value
        : undefined;
    if (saved) {
      this.settle(saved);
    } else {
      // Not recorded, or refused for a newer revision: show the saved value again.
      this.update({
        phase: result.value.state === "recorded" ? "conflict" : "rejected",
        draft: this.state.current?.value ?? command.value,
      });
    }
    await this.refresh();
    // The read after a receipt can be the first to show another window's later save. A save
    // this window settled meanwhile raises its own revision, so only another window's is named.
    const current = this.state.current;
    if (
      saved &&
      this.snapshot().phase === "confirmed" &&
      current &&
      current.revision > this.ownRevision
    )
      this.update({ phase: "conflict", draft: current.value });
  };
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
