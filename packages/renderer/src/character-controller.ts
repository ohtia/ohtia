import type { CharacterPresentation } from "@ohtia/contracts";

export type CharacterPose = "thinking" | "disagreement" | "milestone";
export const characterDurations: Readonly<Record<CharacterPose, number>> = {
  thinking: 1600,
  disagreement: 1800,
  milestone: 520,
};
/** Controlled presentation input. Only a later event owner can establish committed relevance. */
export interface CharacterEvent {
  readonly id: string;
  readonly project: string;
  readonly action: string;
  readonly result: string;
  readonly producer: string | undefined;
  readonly batch: string;
  readonly text: string;
  readonly language: string;
  readonly pose: CharacterPose;
  readonly relevant: boolean;
  readonly deferToNavigator: boolean;
}
export interface CharacterState {
  readonly mode: CharacterPresentation;
  readonly notice: CharacterEvent | undefined;
  readonly pose: CharacterPose | undefined;
  readonly presenting: CharacterEvent | undefined;
  readonly playing: CharacterEvent | undefined;
  readonly deferred: CharacterEvent | undefined;
}
export interface CharacterClock {
  after(callback: () => void, milliseconds: number): () => void;
}
const clock: CharacterClock = {
  after(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
};
export function effectiveCharacterMode(
  confirmed: CharacterPresentation,
  reducedMotion: boolean,
): CharacterPresentation {
  return confirmed === "animated" && reducedMotion ? "static" : confirmed;
}

/** One instance per workspace session; no persistence, inference, queue or research-event binding. */
export class CharacterController {
  private state: CharacterState;
  private readonly listeners = new Set<() => void>();
  private readonly motions = new Set<() => void>();
  private readonly events = new Map<string, "seen" | "invalidated">();
  private readonly batches = new Set<string>();
  private cancelTimer: (() => void) | undefined;
  private epoch = 0;
  private disposed = false;
  private manuscript = false;
  private available = false;
  constructor(
    private readonly project: string,
    mode: CharacterPresentation = "static",
    private readonly timer: CharacterClock = clock,
  ) {
    this.state = {
      mode,
      notice: undefined,
      pose: undefined,
      presenting: undefined,
      playing: undefined,
      deferred: undefined,
    };
  }
  readonly snapshot = (): CharacterState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (!this.disposed) this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  registerMotion(cancel: () => void): () => void {
    if (this.disposed) cancel();
    else this.motions.add(cancel);
    return () => {
      this.motions.delete(cancel);
    };
  }
  private update(patch: Partial<CharacterState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private stop(): void {
    this.epoch++;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    for (const cancel of this.motions) cancel();
    this.motions.clear();
  }
  setMode(mode: CharacterPresentation): void {
    if (this.disposed || mode === this.state.mode) return;
    const event = this.state.playing;
    if (this.state.deferred) this.batches.add(this.state.deferred.batch);
    if (mode === "static" && event) {
      this.showStill(event, { mode, deferred: undefined });
      return;
    }
    this.stop();
    this.update({
      mode,
      playing: undefined,
      presenting: undefined,
      deferred: undefined,
      pose: undefined,
    });
  }
  setManuscriptVisible(visible: boolean): void {
    if (this.disposed || visible === this.manuscript) return;
    this.manuscript = visible;
    if (visible) {
      this.stop();
      this.update({ playing: undefined, presenting: undefined, pose: undefined });
    }
  }
  setSurfaceAvailable(available: boolean): void {
    if (this.disposed || available === this.available) return;
    this.available = available;
    if (!available) this.cancelPresentation();
  }
  receive(event: CharacterEvent, passive = false): void {
    if (this.disposed || event.project !== this.project) return;
    if (!event.relevant) {
      this.invalidate(event.id);
      return;
    }
    if (this.events.has(event.id)) {
      const presenting = this.state.presenting;
      if (passive && presenting && presenting.id === event.id) {
        this.stop();
        this.update({ playing: undefined, presenting: undefined, pose: undefined });
      }
      return;
    }
    this.events.set(event.id, "seen");
    const captured = Object.freeze({ ...event });
    const batchUsed = this.batches.has(event.batch);
    if (passive || !this.available || this.state.mode !== "animated") {
      // Current-session manuscript receipts preserve an unused allowance in either order.
      // History recovery uses restore(), which always consumes its original batch.
      const pending = this.state.deferred;
      if (!(passive && (this.manuscript || (pending && pending.batch === event.batch))))
        this.batches.add(event.batch);
      if (!passive && batchUsed && this.state.mode === "static" && this.state.presenting) return;
      if (
        !passive &&
        this.available &&
        !this.manuscript &&
        !batchUsed &&
        this.state.mode === "static"
      )
        this.showStill(captured);
      else {
        this.stop();
        this.update({
          notice: captured,
          playing: undefined,
          presenting: undefined,
          pose: undefined,
        });
      }
      return;
    }
    const pending = this.state.deferred;
    if (pending && pending.batch === event.batch) {
      this.update({ notice: captured });
      return;
    }
    if (batchUsed || this.state.playing) {
      this.batches.add(event.batch);
      return;
    }
    if (this.manuscript) {
      if (event.deferToNavigator && !this.state.deferred)
        this.update({ notice: captured, deferred: captured });
      else this.update({ notice: captured });
      return;
    }
    this.play(captured);
  }
  /** Restored history consumes its original batch even before a surface attaches. */
  restore(event: CharacterEvent): void {
    if (this.disposed || event.project !== this.project) return;
    this.batches.add(event.batch);
    this.cancelPresentation();
    this.receive(event, true);
  }
  private showStill(event: CharacterEvent, patch: Partial<CharacterState> = {}): void {
    if (this.disposed) return;
    this.stop();
    const epoch = this.epoch;
    this.update({
      ...patch,
      notice: event,
      presenting: event,
      playing: undefined,
      pose: event.pose === "milestone" ? undefined : event.pose,
    });
    if (epoch !== this.epoch) return;
    this.cancelTimer = this.timer.after(() => {
      if (this.disposed || epoch !== this.epoch) return;
      this.stop();
      this.update({ presenting: undefined, pose: undefined });
    }, characterDurations[event.pose]);
  }
  private play(event: CharacterEvent): void {
    if (this.state.deferred) this.batches.add(this.state.deferred.batch);
    this.batches.add(event.batch);
    const epoch = ++this.epoch;
    this.update({
      notice: event,
      presenting: event,
      playing: event,
      deferred: undefined,
      pose: event.pose,
    });
    if (epoch !== this.epoch) return;
    this.cancelTimer = this.timer.after(() => {
      if (this.disposed || epoch !== this.epoch || this.state.playing !== event) return;
      this.stop();
      this.update({ playing: undefined, presenting: undefined, pose: undefined });
    }, characterDurations[event.pose]);
  }
  openNavigator(explicit: boolean, stillRelevant: boolean): void {
    if (this.disposed) return;
    const event = this.state.deferred;
    if (!explicit || !event) return;
    const eligible = !this.batches.has(event.batch);
    const epoch = this.epoch;
    // Reserve before notifying subscribers; callbacks cannot consume this batch twice.
    this.batches.add(event.batch);
    this.update({ deferred: undefined });
    if (epoch !== this.epoch || !this.available || this.events.get(event.id) === "invalidated")
      return;
    if (
      eligible &&
      stillRelevant &&
      !this.manuscript &&
      this.state.mode === "animated" &&
      !this.state.playing
    )
      this.play(event);
  }
  invalidate(id?: string): void {
    if (this.disposed) return;
    if (id !== undefined) this.events.set(id, "invalidated");
    const { playing, presenting, deferred, notice } = this.state;
    const isPlaying = playing !== undefined && playing.id === id;
    const isPresenting = presenting !== undefined && presenting.id === id;
    const isDeferred = deferred !== undefined && deferred.id === id;
    const isNotice = notice !== undefined && notice.id === id;
    if (id === undefined || isPlaying || isPresenting || isNotice) this.stop();
    if (deferred && (id === undefined || isDeferred)) this.batches.add(deferred.batch);
    this.update({
      playing: id === undefined || isPlaying ? undefined : playing,
      presenting: id === undefined || isPresenting ? undefined : presenting,
      pose: id === undefined || isPresenting ? undefined : this.state.pose,
      deferred: id === undefined || isDeferred ? undefined : deferred,
      notice: id === undefined || isNotice ? undefined : notice,
    });
  }
  cancelPresentation(): void {
    if (this.disposed) return;
    if (this.state.deferred) this.batches.add(this.state.deferred.batch);
    this.stop();
    this.update({
      playing: undefined,
      presenting: undefined,
      deferred: undefined,
      pose: undefined,
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.state = {
      ...this.state,
      playing: undefined,
      presenting: undefined,
      deferred: undefined,
      pose: undefined,
    };
    this.listeners.clear();
  }
}
