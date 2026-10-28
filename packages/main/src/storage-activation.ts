import type { BootstrapState, InterfaceLocale } from "@ohtia/contracts";
import type { Publication } from "./locator.js";
import type { ServiceSupervisor } from "./service-supervisor.js";

/** Publication cannot revive a generation that ended during filesystem synchronization. */
export function completeStorageActivation(
  publication: Publication,
  service: Pick<ServiceSupervisor, "activateStorage">,
  locale: InterfaceLocale,
): BootstrapState {
  if (publication !== "confirmed")
    return publication === "uncertain" ? "publication_uncertain" : "storage_failed";
  return service.activateStorage(locale) ? "storage_ready" : "storage_failed";
}

/** A corrected locator releases only locator failures, never a storage recovery gate. */
export function refreshLocatorState(
  previous: BootstrapState,
  current: BootstrapState,
): BootstrapState {
  if (current !== "missing" && current !== "located") return current;
  return [
    "missing",
    "pending_create",
    "located",
    "locator_invalid",
    "locator_newer",
    "locator_unreadable",
    "path_rejected",
  ].includes(previous)
    ? current
    : previous;
}

/** Recovery authority survives a child that ends before reporting its next outcome. */
export function storageInterruptionState(previous: BootstrapState): BootstrapState {
  return [
    "recovery_required",
    "retry_required",
    "checkpoint_restored",
    "publication_uncertain",
  ].includes(previous)
    ? previous
    : "storage_failed";
}

/** Remembered recovery and locator phases survive a stop; active readiness does not. */
export function restoreStoppedBootstrap(previous: BootstrapState): BootstrapState {
  return previous === "storage_ready" || previous === "storage_opening"
    ? "storage_failed"
    : previous;
}
