import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { message, type BootstrapSnapshot, type SimpleMessageKey } from "@ohtia/contracts";

export function checkpointStatus(snapshot: BootstrapSnapshot): SimpleMessageKey {
  return snapshot.checkpointProblem ?? snapshot.state;
}

/** Startup and Settings confirm the same broker-projected checkpoint. */
export function CheckpointRecovery({
  snapshot,
  busy,
  notice,
  onRestore,
  onRetry,
  startupNotice,
}: {
  readonly snapshot: BootstrapSnapshot;
  readonly busy: boolean;
  readonly notice?: SimpleMessageKey | undefined;
  readonly onRestore: (verification: string) => void;
  readonly onRetry: () => void;
  readonly startupNotice?: RefObject<HTMLParagraphElement | null>;
}) {
  const [confirmation, setConfirmation] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focusNotice = startupNotice ?? status;
  const checkpoint = snapshot.checkpoint;
  const confirming = checkpoint !== undefined && confirmation === checkpoint.verification;
  const retryAvailable = ["recovery_required", "retry_required", "checkpoint_restored"].includes(
    snapshot.state,
  );
  const opening = snapshot.state === "storage_opening";
  const text = (key: SimpleMessageKey) => message(snapshot.locale, key);
  useLayoutEffect(() => {
    if (confirming) {
      cancel.current?.focus();
    } else if (confirmation) {
      setConfirmation(undefined);
      focusNotice.current?.focus();
    }
  }, [confirming, confirmation, focusNotice]);
  function cancelConfirmation(event?: KeyboardEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    setConfirmation(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <div className="checkpoint-recovery" aria-busy={busy || opening}>
      {!startupNotice && (
        <>
          <p ref={status} tabIndex={-1} role={notice ? "alert" : "status"}>
            {text(
              notice ??
                (retryAvailable || opening ? checkpointStatus(snapshot) : "recovery_unavailable"),
            )}
          </p>
          {notice && snapshot.checkpointProblem && <p>{text(snapshot.checkpointProblem)}</p>}
        </>
      )}
      {checkpoint && (
        <>
          {!confirming ? (
            <button
              type="button"
              ref={trigger}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) setConfirmation(checkpoint.verification);
              }}
            >
              {text("restore_checkpoint")}
            </button>
          ) : (
            <div
              role="group"
              aria-label={text("checkpoint_confirmation")}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing)
                  cancelConfirmation(event);
              }}
            >
              <p>
                {message(snapshot.locale, "checkpoint_identifier", { id: checkpoint.operation })}
              </p>
              <p>
                {message(snapshot.locale, "checkpoint_details", {
                  release: checkpoint.release,
                  source: checkpoint.sourceRevision,
                  target: checkpoint.targetRevision,
                  bytes: checkpoint.bytes,
                })}
              </p>
              <p>{text("checkpoint_rollback")}</p>
              <div className="actions">
                <button
                  type="button"
                  ref={cancel}
                  onClick={() => {
                    cancelConfirmation();
                  }}
                >
                  {text("checkpoint_cancel")}
                </button>
                <button
                  type="button"
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    focusNotice.current?.focus();
                    setConfirmation(undefined);
                    onRestore(checkpoint.verification);
                  }}
                >
                  {text("checkpoint_confirmation")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {(startupNotice || retryAvailable) && (
        <div className="actions checkpoint-retry">
          <button
            type="button"
            aria-disabled={busy || confirming || opening}
            onClick={() => {
              if (busy || confirming || opening) return;
              focusNotice.current?.focus();
              onRetry();
            }}
          >
            {text("retry")}
          </button>
        </div>
      )}
    </div>
  );
}
