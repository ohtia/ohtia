import {
  copyWorkspaceLayout,
  failure,
  sameWorkspaceLayout,
  staleRevision,
  type FoundationPort,
  type LayoutChange,
  type LayoutRecord,
  type Outcome,
  type PortError,
  type SavedLayoutRecord,
  type WorkspaceLayout,
} from "@ohtia/contracts";
export type LayoutSaveState =
  | { readonly state: "idle" }
  | { readonly state: "submitting" | "uncertain"; readonly operationId: string }
  | { readonly state: "confirmed"; readonly operationId: string; readonly revision: number }
  | {
      readonly state: "rejected" | "conflicting";
      readonly operationId?: string;
      readonly error: PortError;
    };
export interface LayoutPreferenceState {
  readonly save: LayoutSaveState;
  readonly refreshError?: PortError;
}
/** Window-owned command lifetime, independent of the mounted layout controller.
 * No subscription rearranges a live window. An uncertain operation is queried, never resent.
 */
interface LayoutRead {
  writeEpoch: number;
  modelEpoch: number;
  readonly barrier: Promise<void> | undefined;
  readonly recoverConflict: boolean;
  pending: boolean;
  readonly result: Promise<Outcome<LayoutRecord>>;
}
function copyRecord(record: LayoutRecord): LayoutRecord {
  return { ...record, value: record.value ? copyWorkspaceLayout(record.value) : null };
}
export class LayoutPreferences {
  private revision: number | undefined;
  private pending: LayoutChange | undefined;
  private admitting = false;
  private reading: LayoutRead | undefined;
  private writeEpoch = 0;
  private modelEpoch = 0;
  private model: LayoutRecord | undefined;
  private settlement: Promise<void> | undefined;
  private listener: ((state: LayoutPreferenceState) => void) | undefined;
  private state: LayoutPreferenceState = { save: { state: "idle" } };
  constructor(
    private readonly port: Pick<
      FoundationPort,
      "readLayout" | "replaceLayout" | "readLayoutReceipt" | "claimLayoutFailureNotice"
    >,
    private readonly nextId: () => string,
    private readonly announceFailure: () => void,
  ) {}
  observe(listener: (state: LayoutPreferenceState) => void): () => void {
    this.listener = listener;
    listener(this.snapshot);
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }
  get snapshot(): LayoutPreferenceState {
    return this.state;
  }
  private publish(state: LayoutPreferenceState): void {
    this.state = state;
    this.listener?.(state);
  }
  get readModel(): LayoutRecord | undefined {
    return this.model && this.model.revision === this.revision ? copyRecord(this.model) : undefined;
  }
  load(fresh = false): Promise<Outcome<LayoutRecord>> {
    return this.startRead(fresh, true);
  }
  private startRead(fresh: boolean, recoverConflict: boolean): Promise<Outcome<LayoutRecord>> {
    const existing = this.reading;
    if (
      existing &&
      existing.pending &&
      !fresh &&
      existing.writeEpoch === this.writeEpoch &&
      existing.barrier === this.settlement
    )
      return existing.result;
    let resolve!: (outcome: Outcome<LayoutRecord>) => void;
    const result = new Promise<Outcome<LayoutRecord>>((done) => {
      resolve = done;
    });
    const entry: LayoutRead = {
      writeEpoch: this.writeEpoch,
      modelEpoch: this.modelEpoch,
      barrier: this.settlement,
      recoverConflict,
      pending: true,
      result,
    };
    this.reading = entry;
    const complete = (outcome: Outcome<LayoutRecord>) => {
      entry.pending = false;
      const latest = this.reading;
      if (latest && latest !== entry) void latest.result.then(resolve);
      else resolve(outcome);
    };
    void this.read(entry).then(complete, () => {
      complete(failure("invalid_service_result"));
    });
    return result;
  }
  private async read(entry: LayoutRead): Promise<Outcome<LayoutRecord>> {
    if (entry.barrier) await entry.barrier;
    const newer = this.reading;
    if (newer && newer !== entry) return newer.result;
    entry.writeEpoch = this.writeEpoch;
    entry.modelEpoch = this.modelEpoch;
    let result: Outcome<LayoutRecord>;
    try {
      result = await this.port.readLayout().result;
    } catch {
      result = failure("service_unavailable");
    }
    const latest = this.reading;
    if (latest && latest !== entry) return latest.result;
    if (result.ok && this.revision !== undefined && result.value.revision < this.revision) {
      const current = this.readModel;
      if (this.modelEpoch > entry.modelEpoch && current) return { ok: true, value: current };
      if (this.writeEpoch > entry.writeEpoch) {
        if (entry.recoverConflict) return this.startRead(true, false);
        result = staleRevision(this.revision);
      } else result = failure("invalid_service_result");
    }
    if (result.ok) {
      this.revision = result.value.revision;
      this.model = copyRecord(result.value);
      this.modelEpoch++;
      this.publish({ save: this.state.save });
    } else this.publish({ save: this.state.save, refreshError: result.error });
    return result;
  }
  private async failed(): Promise<void> {
    try {
      const claim = await this.port.claimLayoutFailureNotice().result;
      if (claim.ok && claim.value.announce) this.announceFailure();
    } catch {
      /* Keep failure inspectable if the notice owner is unavailable. */
    }
  }
  get busy(): boolean {
    return this.admitting || !!this.pending;
  }
  async save(value: WorkspaceLayout): Promise<boolean> {
    if (this.busy) return false;
    const snapshot = copyWorkspaceLayout(value);
    this.admitting = true;
    if (this.revision === undefined) await this.load();
    this.admitting = false;
    if (this.revision === undefined) {
      this.publish({ save: { state: "rejected", error: failure("service_unavailable").error } });
      await this.failed();
      return false;
    }
    const change: LayoutChange = {
      operationId: this.nextId(),
      expectedRevision: this.revision,
      value: snapshot,
    };
    this.pending = change;
    let settle!: () => void;
    const barrier = new Promise<void>((done) => {
      settle = done;
    });
    this.settlement = barrier;
    let completion: Promise<boolean>;
    try {
      this.publish({ save: { state: "submitting", operationId: change.operationId } });
      let result: Outcome<SavedLayoutRecord>;
      try {
        result = await this.port.replaceLayout(change).result;
      } catch {
        result = failure("uncertain");
      }
      completion = this.finish(change, result);
    } finally {
      if (this.settlement === barrier) this.settlement = undefined;
      settle();
    }
    return completion;
  }
  private async finish(change: LayoutChange, result: Outcome<SavedLayoutRecord>): Promise<boolean> {
    if (
      result.ok &&
      (result.value.revision !== change.expectedRevision + 1 ||
        !sameWorkspaceLayout(result.value.value, change.value))
    )
      result = failure("uncertain");
    if (result.ok) {
      this.writeEpoch++;
      this.revision = Math.max(this.revision ?? 0, result.value.revision);
      if (result.value.revision === this.revision) {
        this.model = copyRecord(result.value);
        this.modelEpoch++;
      }
      this.pending = undefined;
      this.publish({
        save: {
          state: "confirmed",
          operationId: change.operationId,
          revision: result.value.revision,
        },
      });
      return true;
    } else if (result.error.code === "uncertain" || result.error.code === "operation_conflict") {
      this.publish({ save: { state: "uncertain", operationId: change.operationId } });
    } else {
      this.pending = undefined;
      if (result.error.code === "stale_revision") {
        this.writeEpoch++;
        this.revision = Math.max(this.revision ?? 0, result.error.parameters.currentRevision);
      }
      this.publish({
        save: {
          state: result.error.code === "stale_revision" ? "conflicting" : "rejected",
          operationId: change.operationId,
          error: result.error,
        },
      });
      await this.failed();
    }
    return false;
  }
  async reconcile(): Promise<void> {
    const change = this.pending;
    if (!change || this.state.save.state !== "uncertain") return;
    try {
      const receipt = await this.port.readLayoutReceipt(change.operationId).result;
      // not_found is not evidence of exclusion/rollback. Keep the exact unresolved command.
      if (this.pending === change && receipt.ok && receipt.value.state === "recorded")
        await this.finish(change, receipt.value.outcome);
    } catch {
      /* Preserve uncertainty without allocating a replacement write. */
    }
  }
}
