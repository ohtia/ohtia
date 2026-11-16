import {
  isInferenceLimit,
  type ExecutionLimitsRecord,
  type ExecutionLimitsChange,
  type FoundationPort,
  type Outcome,
  type ResearchEvent,
} from "@ohtia/contracts";

export interface LimitsState {
  readonly current?: ExecutionLimitsRecord;
  readonly phase: "idle" | "submitting" | "confirmed" | "rejected" | "uncertain";
  readonly readFailed: boolean;
  readonly draft: number;
  readonly changedFromWindow: boolean;
  readonly canChoose: boolean;
}
/** Window-owned save/receipt lifetime, observing the window's existing research subscription. */
export class LimitsController {
  private state: LimitsState = {
    phase: "idle",
    readFailed: false,
    draft: 10,
    changedFromWindow: false,
    canChoose: false,
  };
  private readonly listeners = new Set<() => void>();
  private pending: (ExecutionLimitsChange & { generation: string }) | undefined;
  private lastValue: number | undefined;
  private disposed = false;
  private viewOpen = false;
  private reading: Promise<void> | undefined;
  private readAgain = false;
  private checking = false;
  private mutationEpoch = 0;
  private readonly retired = new Set<string>();
  constructor(
    private readonly port: FoundationPort,
    private readonly nextId: () => string,
  ) {}
  private isDisposed(): boolean {
    return this.disposed;
  }
  snapshot = (): LimitsState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<LimitsState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setViewOpen(open: boolean): void {
    this.viewOpen = open;
    if (!open) this.update({ changedFromWindow: false });
  }
  observed = (notice: Outcome<ResearchEvent> | "ready"): void => {
    if (
      notice === "ready" ||
      !notice.ok ||
      notice.value.kind === "inferenceActivity" ||
      (notice.value.kind === "changed" && notice.value.record === "executionLimits")
    )
      void this.refresh();
  };
  private accept(record: ExecutionLimitsRecord, passive = false): void {
    if (this.disposed || this.retired.has(record.serviceGeneration)) return;
    const previous = this.state.current;
    const same = previous !== undefined && previous.serviceGeneration === record.serviceGeneration;
    if (previous && !same) this.retired.add(previous.serviceGeneration);
    const next =
      same && previous.revision > record.revision
        ? { ...previous, running: record.running }
        : record;
    this.update({
      current: next,
      ...(!this.pending ? { draft: next.max_concurrent_inference } : {}),
      ...(passive && same && previous.revision < record.revision && !this.pending
        ? { changedFromWindow: this.viewOpen, phase: "idle" }
        : {}),
    });
  }
  refresh = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    if (this.reading) {
      this.readAgain = true;
      return this.reading;
    }
    this.reading = (async () => {
      do {
        this.readAgain = false;
        const epoch = this.mutationEpoch;
        const result = await this.port.readExecutionLimits().result;
        if (this.disposed) return;
        if (epoch !== this.mutationEpoch) {
          this.readAgain = true;
          continue;
        }
        if (result.ok) this.accept(result.value, true);
        this.update({ readFailed: !result.ok });
        if (this.state.phase === "uncertain") await this.check();
      } while (this.readAgain && !this.isDisposed());
    })().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  };
  async choose(value: number): Promise<boolean> {
    const current = this.state.current;
    if (
      this.disposed ||
      !current ||
      !isInferenceLimit(value) ||
      this.checking ||
      (this.pending && !this.state.canChoose)
    )
      return false;
    const command = { operationId: this.nextId(), value, generation: current.serviceGeneration };
    this.mutationEpoch++;
    this.pending = command;
    this.lastValue = value;
    this.update({ phase: "submitting", draft: value, canChoose: false, changedFromWindow: false });
    const result = await this.port.replaceExecutionLimits(
      { operationId: command.operationId, value },
      command.generation,
    ).result;
    if (this.isDisposed() || this.pending !== command) return result.ok;
    if (!result.ok && result.error.code === "uncertain") {
      this.update({ phase: "uncertain" });
      await this.check();
      return false;
    }
    this.mutationEpoch++;
    this.pending = undefined;
    if (result.ok) this.accept(result.value);
    this.update({
      phase: result.ok ? "confirmed" : "rejected",
      draft: this.state.current?.max_concurrent_inference ?? value,
      changedFromWindow:
        result.ok && this.viewOpen && this.state.current?.max_concurrent_inference !== value,
    });
    await this.refresh();
    return result.ok;
  }
  check = async (): Promise<void> => {
    const command = this.pending;
    if (this.disposed || !command || this.checking || this.state.phase !== "uncertain") return;
    this.checking = true;
    let refreshCurrent = false;
    try {
      const result = await this.port.readExecutionLimitsReceipt(command.operationId).result;
      if (this.isDisposed() || this.pending !== command) return;
      if (result.ok && result.value.state === "recorded") {
        this.mutationEpoch++;
        this.pending = undefined;
        this.accept(result.value.outcome.value);
        this.update({
          phase: "confirmed",
          canChoose: false,
          changedFromWindow:
            this.viewOpen &&
            this.state.current?.max_concurrent_inference !==
              result.value.outcome.value.max_concurrent_inference,
        });
        // The receipt may precede another window's write. Read current state without replaying it.
        this.readAgain = true;
        refreshCurrent = true;
      } else if (
        result.ok &&
        result.value.state === "not_found" &&
        this.state.current &&
        this.state.current.serviceGeneration !== command.generation
      )
        this.update({ canChoose: true });
    } finally {
      this.checking = false;
    }
    if (refreshCurrent && !this.reading) await this.refresh();
  };
  retry = (): Promise<boolean> =>
    this.lastValue !== undefined && (this.state.phase === "rejected" || this.state.canChoose)
      ? this.choose(this.lastValue)
      : Promise.resolve(false);
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
