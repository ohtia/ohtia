import {
  isLocaleChoice,
  type FoundationPort,
  type LocaleChange,
  type LocaleChoice,
  type LocaleSnapshot,
  type SavedLocaleRecord,
  type Outcome,
  type PortCall,
  type Subscription,
} from "@ohtia/contracts";

export interface LanguageState {
  readonly current?: LocaleSnapshot;
  readonly draft: LocaleChoice;
  readonly phase:
    "loading" | "idle" | "submitting" | "confirmed" | "rejected" | "conflict" | "uncertain";
  readonly displayFailed: boolean;
  readonly readFailed: boolean;
  readonly changedFromWindow: boolean;
  readonly canChoose: boolean;
  readonly conflictRevision: number | undefined;
}
/** One view lifetime. Disposing callbacks never revokes a write admitted by the authority. */
export class LanguageController {
  private state: LanguageState = {
    draft: "system",
    phase: "loading",
    displayFailed: false,
    readFailed: false,
    changedFromWindow: false,
    canChoose: false,
    conflictRevision: undefined,
  };
  private readonly listeners = new Set<() => void>();
  private readonly reads = new Set<PortCall<unknown>>();
  private stream: Subscription | undefined;
  private pending: LocaleChange | undefined;
  private pendingGeneration: string | undefined;
  private lastChoice: LocaleChoice = "system";
  private disposed = false;
  private recovering = false;
  private subscriptionFailed = false;
  private accepted: SavedLocaleRecord | undefined;
  private checking = false;
  private applied: LocaleSnapshot | undefined;
  private refreshTask: Promise<void> | undefined;
  private streamEpoch = 0;
  constructor(
    private readonly port: FoundationPort,
    private readonly apply: (snapshot: LocaleSnapshot) => void,
    private readonly nextId: () => string,
  ) {}
  private isDisposed(): boolean {
    return this.disposed;
  }
  readonly snapshot = (): LanguageState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<LanguageState>): void {
    if (this.isDisposed()) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private accept(snapshot: LocaleSnapshot, passive = false): void {
    if (
      this.disposed ||
      (this.state.current &&
        this.state.current.serviceGeneration === snapshot.serviceGeneration &&
        snapshot.record.revision < this.state.current.record.revision)
    )
      return;
    const sameGeneration = this.state.current?.serviceGeneration === snapshot.serviceGeneration;
    const ownPublication =
      this.accepted?.revision === snapshot.record.revision &&
      this.accepted.value === snapshot.record.value;
    if (this.accepted && snapshot.record.revision >= this.accepted.revision)
      this.accepted = undefined;
    const changed =
      sameGeneration &&
      !!this.state.current &&
      snapshot.record.revision > this.state.current.record.revision &&
      snapshot.record.value !== this.state.current.record.value;
    this.update({
      current: snapshot,
      readFailed: this.subscriptionFailed,
      ...(!this.pending ? { draft: snapshot.record.value } : {}),
      changedFromWindow: passive && changed && !this.pending && !ownPublication,
      ...(!this.pending &&
      ((!sameGeneration && this.state.current && this.state.phase !== "rejected") ||
        (passive && changed && !ownPublication))
        ? { phase: "idle" as const }
        : {}),
    });
    if (
      this.applied &&
      this.applied.serviceGeneration === snapshot.serviceGeneration &&
      this.applied.record.revision === snapshot.record.revision &&
      this.applied.record.source === snapshot.record.source &&
      this.applied.effectiveLocale === snapshot.effectiveLocale &&
      this.applied.systemLocale === snapshot.systemLocale
    )
      return;
    try {
      this.apply(snapshot);
      this.applied = snapshot;
      this.update({ displayFailed: false });
    } catch {
      this.update({ displayFailed: true });
    }
  }
  private async read(): Promise<void> {
    const call = this.port.readLocale();
    this.reads.add(call);
    const result = await call.result;
    this.reads.delete(call);
    if (this.isDisposed()) return;
    if (result.ok) {
      this.accept(result.value);
      if (this.state.phase === "loading") this.update({ phase: "idle" });
    } else this.update({ readFailed: true });
  }
  /** One bounded reread/resubscribe after a gap; another failure stays inspectable for explicit refresh. */
  refresh(): Promise<void> {
    if (this.isDisposed()) return Promise.resolve();
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this.refreshOnce().finally(() => {
      this.refreshTask = undefined;
    });
    return this.refreshTask;
  }
  private async refreshOnce(): Promise<void> {
    this.recovering = true;
    this.subscriptionFailed = false;
    this.stream?.dispose();
    const epoch = ++this.streamEpoch;
    this.stream = this.port.subscribeLocale((result) => {
      if (this.isDisposed() || epoch !== this.streamEpoch) return;
      if (result.ok) this.accept(result.value, true);
      else {
        this.subscriptionFailed = true;
        // A gap starts bounded recovery; report a load failure only if that recovery fails.
        if (!this.recovering) void this.refresh();
      }
    });
    const [ready] = await Promise.all([this.stream.ready, this.read()]);
    if (!this.isDisposed() && epoch === this.streamEpoch) {
      if (!ready.ok) this.subscriptionFailed = true;
      if (this.subscriptionFailed) this.update({ readFailed: true });
      this.recovering = false;
      if (this.pending && this.state.phase === "uncertain") await this.check();
      // A receipt wait can outlive the stream. Its gap cannot restart refreshTask until
      // this task finishes, so preserve that failed recovery for an explicit refresh.
      if (this.subscriptionFailed && !this.state.readFailed) this.update({ readFailed: true });
    }
  }
  async choose(value: unknown): Promise<void> {
    if (
      this.isDisposed() ||
      (this.pending && (!this.state.canChoose || this.checking)) ||
      !this.state.current ||
      !isLocaleChoice(value)
    )
      return;
    const command: LocaleChange = {
      operationId: this.nextId(),
      expectedRevision: this.state.current.record.revision,
      value,
    };
    this.pending = command;
    this.pendingGeneration = this.state.current.serviceGeneration;
    this.lastChoice = value;
    this.update({ draft: value, phase: "submitting", changedFromWindow: false, canChoose: false });
    // Never cancel and resubmit a mutation as a read/refresh side effect.
    const result = await this.port.replaceLocale(command, this.pendingGeneration).result;
    await this.outcome(result);
  }
  private async outcome(result: Outcome<SavedLocaleRecord>): Promise<void> {
    if (this.isDisposed()) return;
    if (!result.ok && result.error.code === "uncertain") {
      this.update({ phase: "uncertain" });
      await this.check();
      return;
    }
    const saved = result.ok ? result.value : undefined;
    this.pending = undefined;
    this.update({ canChoose: false });
    if (saved) {
      this.accepted = saved;
      this.update({ phase: "confirmed" });
      if (this.state.current && saved.value !== "system")
        this.accept({ ...this.state.current, record: saved, effectiveLocale: saved.value });
    } else if (!result.ok)
      this.update({
        phase: result.error.code === "stale_revision" ? "conflict" : "rejected",
        conflictRevision:
          result.error.code === "stale_revision"
            ? result.error.parameters.currentRevision
            : undefined,
        draft: this.state.current?.record.value ?? "system",
      });
    // A failed refresh cannot turn a saved mutation into failure or allocate a new operation.
    await this.read();
  }
  async retry(): Promise<void> {
    if (this.state.phase === "rejected" || this.state.canChoose) await this.choose(this.lastChoice);
  }
  async check(): Promise<void> {
    if (this.isDisposed() || this.checking || !this.pending || this.state.phase !== "uncertain")
      return;
    this.checking = true;
    const target = this.pending;
    const call = this.port.readLocaleReceipt(target.operationId);
    this.reads.add(call);
    try {
      const receipt = await call.result;
      this.reads.delete(call);
      if (this.isDisposed() || this.pending !== target) return;
      if (receipt.ok && receipt.value.state === "recorded")
        await this.outcome(receipt.value.outcome);
      else if (
        receipt.ok &&
        receipt.value.state === "not_found" &&
        this.state.current &&
        this.pendingGeneration !== this.state.current.serviceGeneration
      ) {
        // Main starts this generation only after the prior service has ceased. The current
        // admitted store's durable lookup found no receipt. Permit a NEW explicit intent;
        // retain the original identity until that action and never replay it automatically.
        this.update({ canChoose: true });
      }
    } finally {
      this.checking = false;
    }
    // not_found alone never releases uncertainty or permits transport replay.
  }
  applyAgain(): void {
    if (this.isDisposed() || !this.state.current) return;
    try {
      this.apply(this.state.current);
      this.applied = this.state.current;
      this.update({ displayFailed: false });
    } catch {
      this.update({ displayFailed: true });
    }
  }
  dispose(): void {
    this.disposed = true;
    this.streamEpoch++;
    this.stream?.dispose();
    for (const call of this.reads) call.cancel();
    this.reads.clear();
    this.listeners.clear();
  }
}
