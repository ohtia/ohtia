import type { StorageNotice } from "@ohtia/contracts";
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
): Promise<void> {
  publish(JSON.stringify({ kind: "ready", generation }));
  if (!store) return;
  let state: StorageNotice["state"] = "storage_failed";
  let savedLocale: StorageNotice["savedLocale"];
  let localeFallback = false;
  try {
    if (mode === "restore") {
      await store.restorePending();
      state = "checkpoint_restored";
    } else {
      if (mode === "retry") await store.retry();
      else await store.open();
      const saved = await store.savedLocale();
      savedLocale = saved.choice;
      localeFallback = saved.invalid;
      state = "storage_ready";
    }
  } catch {
    state = store.recoveryState();
  }
  if (!isStopping())
    publish(
      JSON.stringify({
        kind: "storage",
        generation,
        state,
        ...(savedLocale ? { savedLocale } : {}),
        ...(localeFallback ? { localeFallback: true } : {}),
      }),
    );
}
