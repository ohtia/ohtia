import {
  encodeEnvelope,
  isFinalVersion,
  type Request,
  type UpdateState,
  type UpdateStateNotice,
} from "@ohtia/contracts";
import { newerFinal, noteParts, type ReleaseRequester } from "./update-check.js";

interface Work {
  readonly request: Request;
  deliver(text: string): void;
  release(): void;
}
export interface UpdateBrokerOptions {
  /** The running application's version from its packaged metadata. */
  readonly installedVersion: string;
  /** False in development and qualification runtimes; they never make a request. */
  readonly permitted: boolean;
  readonly requester: ReleaseRequester;
  readonly publish: (notice: UpdateStateNotice) => void;
}
/**
 * SPEC-001-040 in the trusted main process: one startup check when the saved preference allows it
 * and a manual check on request. Port requests answer at once; results arrive as notices.
 */
export class UpdateBroker {
  private current: UpdateState;
  private sequence = 0;
  private started = false;
  private manual = false;
  private running: AbortController | undefined;
  private disposed = false;
  constructor(private readonly options: UpdateBrokerOptions) {
    const available = options.permitted && isFinalVersion(options.installedVersion);
    this.current = {
      installedVersion: options.installedVersion,
      check: available ? "idle" : "unavailable",
      failure: null,
      available: null,
    };
  }
  get state(): UpdateState {
    return this.current;
  }
  get notice(): UpdateStateNotice {
    return { sequence: this.sequence, state: this.current };
  }
  /** Called once per launch after the saved preference is read; later calls do nothing. */
  startup(enabled: boolean): void {
    if (this.started || this.disposed) return;
    this.started = true;
    if (enabled && this.current.check === "idle") this.run(false);
  }
  /** Starts, or joins, a check whose failure is reported; returns the resulting state. */
  check(): UpdateState {
    if (this.current.check === "unavailable" || this.disposed) return this.current;
    this.manual = true;
    if (!this.running) this.run(true);
    return this.current;
  }
  handle(work: Work): boolean {
    const request = work.request;
    if (request.operation !== "update.read" && request.operation !== "update.check") return false;
    if (request.operation === "update.check") this.check();
    const reply = encodeEnvelope({
      ...request,
      kind: "result",
      payload: { ok: true, value: this.notice },
    });
    work.release();
    if (reply.ok) work.deliver(reply.value);
    return true;
  }
  dispose(): void {
    this.disposed = true;
    this.running?.abort();
    this.running = undefined;
  }
  private run(manual: boolean): void {
    const controller = new AbortController();
    this.running = controller;
    this.manual = manual;
    this.set({ ...this.current, check: "checking", failure: null });
    void this.options.requester(controller.signal).then(
      (result) => {
        if (this.running !== controller || this.disposed) return;
        this.running = undefined;
        if (!result.ok) {
          this.set(
            this.manual
              ? { ...this.current, check: "failed", failure: result.failure }
              : { ...this.current, check: "idle", failure: null },
          );
          return;
        }
        const newer =
          result.version !== null && newerFinal(result.version, this.current.installedVersion)
            ? result.version
            : null;
        this.set({
          ...this.current,
          check: "checked",
          failure: null,
          available: newer === null ? null : { version: newer, ...noteParts(result.notes) },
        });
      },
      () => {
        if (this.running !== controller || this.disposed) return;
        this.running = undefined;
        this.set(
          this.manual
            ? { ...this.current, check: "failed", failure: "network" }
            : { ...this.current, check: "idle", failure: null },
        );
      },
    );
  }
  private set(state: UpdateState): void {
    this.current = state;
    this.sequence++;
    this.options.publish(this.notice);
  }
}
