export interface PreloadEnvironment {
  readonly contextIsolated: boolean;
  readonly sandboxed: boolean;
}

/** Check the runtime before a future named bridge is installed. */
export function assertPreloadIsolation(environment: PreloadEnvironment): void {
  if (!environment.contextIsolated || !environment.sandboxed) {
    throw new Error("Preload requires context isolation and the process sandbox.");
  }
}
