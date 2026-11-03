import {
  isAppearance,
  isCharacterPresentation,
  isInterfaceZoom,
  type Appearance,
  type CharacterPresentation,
  type InterfaceZoom,
  type FoundationPort,
  type Outcome,
  type PresentationRecord,
  type PresentationSnapshot,
  type PresentationReceipt,
  type SavedPresentationRecord,
  type Subscription,
  type ZoomIntent,
  type ZoomBoundaryError,
  isZoomBoundaryError,
} from "@ohtia/contracts";

export interface SettingsValues {
  appearance: Appearance;
  character: CharacterPresentation;
  zoom: InterfaceZoom;
}
export type SettingFeature = keyof SettingsValues;
export type SettingValue = SettingsValues[SettingFeature];
export interface SettingState {
  readonly draft: SettingValue;
  readonly phase: "idle" | "submitting" | "confirmed" | "rejected" | "conflict" | "uncertain";
  readonly displayFailed: boolean;
  readonly changedFromWindow: boolean;
  readonly canChoose: boolean;
}
export interface SettingsState {
  readonly current?: PresentationSnapshot;
  readonly settings: Readonly<Record<SettingFeature, SettingState>>;
  readonly readFailed: boolean;
  readonly effectiveZoom: InterfaceZoom;
  readonly zoomBusy: boolean;
  readonly zoomReason: ZoomBoundaryError | undefined;
}
interface Pending {
  readonly id: string;
  readonly generation: string;
  readonly revision: number;
  readonly value: SettingValue;
  readonly intent?: ZoomIntent;
}
const features = ["appearance", "character", "zoom"] as const;
function initial(draft: SettingValue): SettingState {
  return { draft, phase: "idle", displayFailed: false, changedFromWindow: false, canChoose: false };
}
/** Window-owned preference lifetime; opening or closing a dialog never cancels an admitted write. */
export class SettingsController {
  private state: SettingsState = {
    settings: { appearance: initial("system"), character: initial("static"), zoom: initial(100) },
    readFailed: false,
    effectiveZoom: 100,
    zoomBusy: false,
    zoomReason: undefined,
  };
  private listeners = new Set<() => void>();
  private pending = new Map<SettingFeature, Pending>();
  private checking = new Set<SettingFeature>();
  private last = new Map<
    SettingFeature,
    { id: string; value: SettingValue; intent?: ZoomIntent }
  >();
  private stream: Subscription | undefined;
  private disposed = false;
  private viewOpen = false;
  private epoch = 0;
  private refreshing: Promise<void> | undefined;
  private recovering = false;
  private subscriptionFailed = false;
  private readonly retiredGenerations = new Set<string>();
  private applied = new Map<
    SettingFeature,
    { generation: string; revision: number; source: string; value: SettingValue }
  >();
  private applicationEpoch = new Map<SettingFeature, number>();
  constructor(
    private readonly port: FoundationPort,
    private readonly apply: (
      feature: SettingFeature,
      record: PresentationRecord<SettingValue>,
    ) => void | Promise<void>,
    private readonly nextId: () => string,
  ) {}
  private isDisposed(): boolean {
    return this.disposed;
  }
  readonly snapshot = (): SettingsState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<SettingsState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setViewOpen(open: boolean): void {
    if (this.disposed) return;
    this.viewOpen = open;
    if (!open) for (const feature of features) this.setting(feature, { changedFromWindow: false });
  }
  private setting(feature: SettingFeature, patch: Partial<SettingState>): void {
    this.update({
      settings: {
        ...this.state.settings,
        [feature]: { ...this.state.settings[feature], ...patch },
      },
    });
  }
  private applyRecord(
    feature: SettingFeature,
    snapshot: PresentationSnapshot,
    force = false,
  ): void {
    const record = snapshot[feature];
    const previous = this.applied.get(feature);
    if (
      !force &&
      previous &&
      previous.generation === snapshot.serviceGeneration &&
      previous.revision === record.revision &&
      previous.value === record.value &&
      previous.source === record.source
    )
      return;
    const epoch = (this.applicationEpoch.get(feature) ?? 0) + 1;
    this.applicationEpoch.set(feature, epoch);
    // Capture before starting an asynchronous rendering application; passive duplicates do not repeat it.
    this.applied.set(feature, {
      generation: snapshot.serviceGeneration,
      revision: record.revision,
      value: record.value,
      source: record.source,
    });
    void Promise.resolve()
      .then(() => {
        if (this.disposed || this.applicationEpoch.get(feature) !== epoch) return;
        return this.apply(feature, record);
      })
      .then(
        () => {
          if (!this.disposed && this.applicationEpoch.get(feature) === epoch) {
            this.setting(feature, { displayFailed: false });
            if (feature === "zoom" && isInterfaceZoom(record.value))
              this.update({ effectiveZoom: record.value });
          }
        },
        () => {
          if (!this.disposed && this.applicationEpoch.get(feature) === epoch)
            this.setting(feature, { displayFailed: true });
        },
      );
  }
  private accept(snapshot: PresentationSnapshot, passive = false): void {
    if (this.disposed || this.retiredGenerations.has(snapshot.serviceGeneration)) return;
    const current = this.state.current;
    const sameGeneration = !!current && current.serviceGeneration === snapshot.serviceGeneration;
    if (current && !sameGeneration) this.retiredGenerations.add(current.serviceGeneration);
    const next = { ...snapshot };
    for (const feature of features) {
      const record = snapshot[feature];
      if (sameGeneration && record.revision < current[feature].revision) {
        // Preserve newer records independently when a snapshot was captured before another receipt.
        Object.assign(next, { [feature]: current[feature] });
        if (!this.pending.has(feature)) this.setting(feature, { draft: current[feature].value });
        continue;
      }
      const pending = this.pending.get(feature);
      const changed =
        sameGeneration &&
        record.revision > current[feature].revision &&
        record.value !== current[feature].value;
      const own =
        pending &&
        pending.generation === snapshot.serviceGeneration &&
        record.revision === pending.revision + 1 &&
        (feature === "zoom" && pending.intent ? true : pending.value === record.value);
      this.setting(feature, {
        ...(!pending ? { draft: record.value } : {}),
        ...(passive && changed && !own && !pending
          ? { changedFromWindow: this.viewOpen, phase: "idle" }
          : {}),
      });
    }
    this.update({
      ...(this.state.zoomReason &&
      ((!sameGeneration && current) ||
        next.zoom.value !==
          {
            zoom_minimum: 75,
            zoom_maximum: 400,
            actual_size: 100,
          }[this.state.zoomReason])
        ? { zoomReason: undefined }
        : {}),
      current: next,
      ...(current && next.zoom.revision > current.zoom.revision ? { zoomBusy: false } : {}),
    });
    for (const feature of features) this.applyRecord(feature, next);
  }
  private async read(epoch = this.epoch): Promise<void> {
    const result = await this.port.readPresentation().result;
    if (this.disposed || epoch !== this.epoch) return;
    if (result.ok) {
      this.accept(result.value);
      this.update({ readFailed: this.subscriptionFailed, zoomBusy: false });
    } else this.update({ readFailed: true });
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshOnce().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async refreshOnce(): Promise<void> {
    this.recovering = true;
    this.subscriptionFailed = false;
    const epoch = ++this.epoch;
    this.stream?.dispose();
    this.stream = this.port.subscribePresentation((result) => {
      if (this.disposed || epoch !== this.epoch) return;
      if (result.ok) this.accept(result.value, true);
      else {
        this.subscriptionFailed = true;
        this.update({ readFailed: true });
        if (!this.recovering) void this.refresh();
      }
    });
    const [ready] = await Promise.all([this.stream.ready, this.read(epoch)]);
    if (this.disposed || epoch !== this.epoch) return;
    this.recovering = false;
    if (!ready.ok) this.subscriptionFailed = true;
    if (this.subscriptionFailed) this.update({ readFailed: true });
    for (const feature of features)
      if (this.state.settings[feature].phase === "uncertain") await this.check(feature);
  }
  async choose<K extends SettingFeature>(
    feature: K,
    value: SettingsValues[K],
    intent?: ZoomIntent,
  ): Promise<boolean> {
    const current = this.state.current;
    const state = this.state.settings[feature];
    if (
      this.disposed ||
      !current ||
      this.checking.has(feature) ||
      (this.pending.has(feature) && !state.canChoose) ||
      !(feature === "appearance"
        ? isAppearance(value)
        : feature === "character"
          ? isCharacterPresentation(value)
          : isInterfaceZoom(value))
    )
      return false;
    const command: Pending = {
      id: this.nextId(),
      generation: current.serviceGeneration,
      revision: current[feature].revision,
      value,
      ...(intent ? { intent } : {}),
    };
    this.pending.set(feature, command);
    this.last.set(feature, { id: command.id, value, ...(intent ? { intent } : {}) });
    this.setting(feature, {
      draft: value,
      phase: "submitting",
      changedFromWindow: false,
      canChoose: false,
    });
    if (feature === "zoom") this.update({ zoomBusy: false, zoomReason: undefined });
    const change = { operationId: command.id, expectedRevision: command.revision };
    const result =
      feature === "appearance"
        ? await this.port.replaceAppearance(
            { ...change, value: value as Appearance },
            command.generation,
          ).result
        : feature === "character"
          ? await this.port.replaceCharacter(
              { ...change, value: value as CharacterPresentation },
              command.generation,
            ).result
          : intent
            ? await this.port.adjustZoom(command.id, intent, command.generation).result
            : await this.port.replaceZoom(
                { ...change, value: value as InterfaceZoom },
                command.generation,
              ).result;
    await this.outcome(feature, command, result);
    return result.ok;
  }
  private async outcome(
    feature: SettingFeature,
    command: Pending,
    result: Outcome<SavedPresentationRecord<SettingValue>>,
  ): Promise<void> {
    if (this.isDisposed() || this.pending.get(feature) !== command) return;
    if (!result.ok && result.error.code === "uncertain") {
      this.setting(feature, { phase: "uncertain" });
      await this.check(feature);
      return;
    }
    this.pending.delete(feature);
    if (feature === "zoom" && !result.ok && isZoomBoundaryError(result.error.code)) {
      this.setting(feature, { phase: "idle", draft: this.state.current?.zoom.value ?? 100 });
      const reason = result.error.code;
      const atBoundary = () =>
        this.state.current?.zoom.value ===
        {
          zoom_minimum: 75,
          zoom_maximum: 400,
          actual_size: 100,
        }[reason];
      this.update({ zoomBusy: false, zoomReason: atBoundary() ? reason : undefined });
      await this.read();
      if (!this.isDisposed() && this.last.get(feature)?.id === command.id)
        this.update({ zoomReason: atBoundary() ? reason : undefined });
      return;
    }
    if (feature === "zoom" && !result.ok && result.error.code === "busy") {
      this.setting(feature, { phase: "idle", draft: this.state.current?.zoom.value ?? 100 });
      this.update({ zoomBusy: true });
      return;
    }
    this.setting(feature, {
      phase: result.ok
        ? "confirmed"
        : result.error.code === "stale_revision"
          ? "conflict"
          : "rejected",
      canChoose: false,
      ...(result.ok &&
      this.state.current &&
      (this.state.current.serviceGeneration !== command.generation ||
        this.state.current[feature].revision > result.value.revision) &&
      this.state.current[feature].value !== result.value.value
        ? { changedFromWindow: this.viewOpen }
        : {}),
    });
    if (result.ok && this.state.current?.serviceGeneration === command.generation)
      this.accept({ ...this.state.current, [feature]: result.value });
    else this.setting(feature, { draft: this.state.current?.[feature].value ?? command.value });
    // A refresh failure never resubmits the accepted mutation or erases saved success.
    await this.read();
  }
  async check(feature: SettingFeature): Promise<void> {
    const command = this.pending.get(feature);
    if (
      this.disposed ||
      !command ||
      this.checking.has(feature) ||
      this.state.settings[feature].phase !== "uncertain"
    )
      return;
    this.checking.add(feature);
    try {
      const receipt: Outcome<PresentationReceipt<SettingValue>> = await (
        feature === "appearance"
          ? this.port.readAppearanceReceipt(command.id)
          : feature === "character"
            ? this.port.readCharacterReceipt(command.id)
            : this.port.readZoomReceipt(command.id)
      ).result;
      if (this.isDisposed() || this.pending.get(feature) !== command) return;
      if (receipt.ok && receipt.value.state === "recorded")
        await this.outcome(feature, command, receipt.value.outcome);
      else if (
        receipt.ok &&
        receipt.value.state === "not_found" &&
        this.state.current &&
        this.state.current.serviceGeneration !== command.generation
      )
        this.setting(feature, { canChoose: true });
    } finally {
      this.checking.delete(feature);
    }
  }
  async retry(feature: SettingFeature): Promise<boolean> {
    const last = this.last.get(feature);
    return last &&
      (this.state.settings[feature].phase === "rejected" || this.state.settings[feature].canChoose)
      ? this.choose(feature, last.value, last.intent)
      : false;
  }
  applyAgain(feature: SettingFeature): void {
    if (this.state.current && !this.disposed) this.applyRecord(feature, this.state.current, true);
  }
  dispose(): void {
    this.disposed = true;
    this.epoch++;
    this.stream?.dispose();
    this.listeners.clear();
  }
}
