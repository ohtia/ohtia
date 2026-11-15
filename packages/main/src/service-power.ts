import { providerMessageVersion, type ServiceWakeMessage } from "@ohtia/contracts";

/** Electron events are observed once in main; listeners never retain a service generation. */
export function observeServicePower(
  monitor: { on(event: "suspend" | "resume", listener: () => void): unknown },
  target: {
    generation(): string;
    suspend(): void;
    wake(message: ServiceWakeMessage): void;
    post(text: string): void;
    wallClock?: () => number;
  },
): void {
  let suspendedAt: number | undefined;
  const wall = target.wallClock ?? Date.now;
  monitor.on("suspend", () => {
    if (suspendedAt !== undefined) return;
    suspendedAt = wall();
    target.suspend();
  });
  monitor.on("resume", () => {
    if (suspendedAt === undefined) return;
    const resumedAt = wall();
    const message: ServiceWakeMessage = {
      kind: "service_wake",
      version: providerMessageVersion,
      generation: target.generation(),
      suspendedAt: new Date(suspendedAt).toISOString(),
      resumedAt: new Date(resumedAt).toISOString(),
      asleepMs: Math.max(0, resumedAt - suspendedAt),
    };
    suspendedAt = undefined;
    // The service reviews wake before processing the terminal receipts from main's recheck.
    target.post(JSON.stringify(message));
    target.wake(message);
  });
}
