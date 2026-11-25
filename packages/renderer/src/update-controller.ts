import type {
  CommandBridge,
  FoundationPort,
  UpdateBridge,
  UpdateRoute,
  UpdateStateNotice,
} from "@ohtia/contracts";

export interface UpdateSnapshot {
  /** Main's latest numbered state; absent until the first read or push arrives. */
  readonly notice?: UpdateStateNotice;
  readonly route?: UpdateRoute;
  /** Set when opening the route last failed; cleared by the next attempt or a new surface. */
  readonly openFailed: boolean;
  /** Set when main refused the last manual check request; cleared by the next request. */
  readonly checkRefused: boolean;
}

/**
 * SPEC-001-040 in one window: keeps main's update state with the highest sequence, asks main
 * for a manual check and opens the route main chooses. It never downloads or installs.
 */
export class UpdateController {
  private state: UpdateSnapshot = { openFailed: false, checkRefused: false };
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | undefined;
  private disposed = false;
  constructor(
    private readonly source: UpdateBridge,
    private readonly port: FoundationPort,
    private readonly commands: CommandBridge,
  ) {}
  snapshot = (): UpdateSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Subscribes before reading, so a push that races the read is never lost. */
  start(): void {
    if (this.stop || this.disposed) return;
    this.stop = this.source.subscribeState(this.accept);
    void this.port
      .readUpdate()
      .result.then((result) => {
        if (result.ok) this.accept(result.value);
      })
      .catch(() => {});
    void this.commands
      .updateRoute()
      .then((route) => {
        this.update({ route });
      })
      .catch(() => {});
  }
  /** Starts or joins a manual check; its result arrives as a later notice. */
  check = async (): Promise<boolean> => {
    if (this.disposed) return false;
    this.update({ checkRefused: false });
    let accepted = false;
    try {
      const result = await this.port.checkForUpdate().result;
      if (result.ok) this.accept(result.value);
      accepted = result.ok;
    } catch {
      accepted = false;
    }
    this.update({ checkRefused: !accepted });
    return accepted;
  };
  /** A newly opened surface starts without an earlier surface's failure. */
  clearFailures = (): void => {
    this.update({ openFailed: false, checkRefused: false });
  };
  openRoute = async (): Promise<boolean> => {
    if (this.disposed) return false;
    this.update({ openFailed: false });
    let opened = false;
    try {
      opened = await this.commands.openUpdateRoute();
    } catch {
      opened = false;
    }
    this.update({ openFailed: !opened });
    return opened;
  };
  private accept = (notice: UpdateStateNotice): void => {
    const current = this.state.notice;
    if (current && current.sequence >= notice.sequence) return;
    // A newer state from main replaces the report of an earlier refused request.
    this.update({ notice, checkRefused: false });
  };
  private update(patch: Partial<UpdateSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
  dispose(): void {
    this.disposed = true;
    this.stop?.();
    this.stop = undefined;
    this.listeners.clear();
  }
}
