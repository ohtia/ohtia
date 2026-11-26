import type { StorageNotice, VerifiedCheckpoint } from "@ohtia/contracts";
import type { DurableStore } from "./storage.js";

export type AdmissionStore = Pick<
  DurableStore,
  "open" | "retry" | "restorePending" | "savedLocale" | "recoveryState"
>;
/** Authenticate the live peer before storage work; admission is a separate, gated outcome. */
export async function initializeStorage(
  store: AdmissionStore | undefined,
  mode: string,
  generation: string,
  publish: (text: string) => void,
  isStopping: () => boolean,
  verified?: Pick<VerifiedCheckpoint, "operation" | "sha256">,
): Promise<void> {
  publish(JSON.stringify({ kind: "ready", generation }));
  if (!store) return;
  let recovery: ReturnType<AdmissionStore["recoveryState"]> = { state: "storage_failed" };
  let restoreFailure: StorageNotice["restoreFailure"];
  let savedLocale: StorageNotice["savedLocale"];
  let localeFallback = false;
  try {
    if (mode === "restore") {
      if (!verified) throw new Error("Missing broker checkpoint verification.");
      await store.restorePending(verified);
      recovery = { state: "checkpoint_restored" };
    } else {
      if (mode === "retry") await store.retry();
      else await store.open();
      const saved = await store.savedLocale();
      savedLocale = saved.choice;
      localeFallback = saved.invalid;
      recovery = { state: "storage_ready" };
    }
  } catch (error) {
    recovery = store.recoveryState();
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (mode === "restore")
      restoreFailure = code === "recovery_stale" ? "recovery_stale" : "recovery_failed";
    if (
      mode === "retry" &&
      code === "checkpoint_incompatible" &&
      recovery.state === "retry_required"
    )
      recovery = { state: "retry_required", checkpointProblem: "checkpoint_incompatible" };
  }
  if (!isStopping())
    publish(
      JSON.stringify({
        kind: "storage",
        generation,
        ...recovery,
        ...(restoreFailure ? { restoreFailure } : {}),
        ...(savedLocale ? { savedLocale } : {}),
        ...(localeFallback ? { localeFallback: true } : {}),
      }),
    );
}
