import { portLimits, type DiagnosticEvent } from "@ohtia/contracts";

interface StoppableService {
  stop(): Promise<boolean>;
}
interface DiagnosticDrain {
  append(event: DiagnosticEvent): Promise<unknown>;
  close(): Promise<void>;
}
/** One deadline includes service cessation and diagnostic-helper exit; never renew it. */
export async function stopBrokerServices(
  service?: StoppableService,
  diagnostics?: DiagnosticDrain,
  drain?: () => Promise<void>,
): Promise<boolean> {
  let active = true;
  const isActive = () => active;
  let total: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    total = setTimeout(() => {
      active = false;
      resolve(false);
    }, portLimits.shutdown_total_ms);
  });
  const grace = setTimeout(() => {
    void diagnostics?.close().catch(() => {});
  }, portLimits.shutdown_grace_ms);
  const finish = (async () => {
    await drain?.();
    if (!isActive()) return false;
    if (service && !(await service.stop())) return false;
    if (!isActive()) return false;
    if (diagnostics) {
      await diagnostics.append({
        event_name: "ohtia.application.stopped",
        timestamp: new Date().toISOString(),
      });
      await diagnostics.close();
    }
    return true;
  })().catch(() => false);
  try {
    return await Promise.race([finish, expired]);
  } finally {
    active = false;
    clearTimeout(grace);
    if (total) clearTimeout(total);
  }
}

/** Reopen only after the previous writer/helper has actually ceased and the caller still admits it. */
export async function recoverDiagnosticsAfterShutdown(
  previous: Pick<DiagnosticDrain, "close">,
  admitted: () => boolean,
  reopen: () => void,
): Promise<void> {
  try {
    await previous.close();
    if (admitted()) reopen();
  } catch {
    /* Keep diagnostics unavailable without allowing overlapping writers. */
  }
}
