export type RuntimeError = "startup_failed" | "shutdown_uncertain" | "resource_failure";

/** Deduplicate notices while keeping every pending acknowledgement ahead of fatal quit. */
export class RuntimeNotices {
  private readonly pending = new Map<RuntimeError, Promise<void>>();
  private quitting: Promise<void> | undefined;
  constructor(
    private readonly show: (key: RuntimeError) => Promise<void>,
    private readonly quit: () => void,
  ) {}
  report(key: RuntimeError): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const shown = Promise.resolve()
      .then(() => this.show(key))
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, shown);
    return shown;
  }
  quitAfter(key: RuntimeError): Promise<void> {
    void this.report(key);
    if (this.quitting) return this.quitting;
    const drain = async () => {
      while (this.pending.size) await Promise.all(this.pending.values());
      this.quit();
    };
    this.quitting = drain().finally(() => {
      this.quitting = undefined;
    });
    return this.quitting;
  }
}
