import { useEffect, useRef, useState } from "react";
import {
  isAppearance,
  message,
  type Appearance,
  type AppearanceRecord,
  type FoundationPort,
  type InterfaceLocale,
  type MessageKey,
} from "@ohtia/contracts";
import { AppearanceControl } from "./index.js";

/** Retain unsaved input and uncertain operation identity across service replacement. */
export function AppearancePanel({
  port,
  locale,
  available,
}: {
  readonly port: FoundationPort;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
}) {
  const [record, setRecord] = useState<AppearanceRecord>();
  const [draft, setDraft] = useState<Appearance>("system");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<MessageKey>();
  const [unresolved, setUnresolved] = useState<string>();
  const dirtyRef = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const text = (key: MessageKey) => message(locale, key);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    async function poll() {
      const call = port.readAppearance();
      cancel = () => {
        call.cancel();
      };
      const result = await call.result;
      if (disposed) return;
      if (result.ok) {
        document.documentElement.dataset.appearance = result.value.value;
        if (!dirtyRef.current) {
          setRecord(result.value);
          setDraft(result.value.value);
          document.documentElement.dataset.appearance = result.value.value;
        }
      }
      timer = setTimeout(() => {
        void poll();
      }, 1000);
    }
    void poll();
    return () => {
      disposed = true;
      mounted.current = false;
      if (timer) clearTimeout(timer);
      cancel?.();
    };
  }, [port]);
  useEffect(() => {
    if (notice === "save_failed" || notice === "save_uncertain" || notice === "refresh_preference")
      alert.current?.focus();
  }, [notice]);
  async function save() {
    if (busy || !available || !record || unresolved) return;
    setBusy(true);
    setNotice("saving");
    const operationId = crypto.randomUUID();
    // Record identity before dispatch, so an uncertain response can only be reconciled, never blindly repeated.
    setUnresolved(operationId);
    const result = await port.replaceAppearance({
      operationId,
      expectedRevision: record.revision,
      value: draft,
    }).result;
    if (!mounted.current) return;
    if (result.ok) {
      setRecord(result.value);
      setDraft(result.value.value);
      dirtyRef.current = false;
      setDirty(false);
      setUnresolved(undefined);
      setNotice("saved");
      document.documentElement.dataset.appearance = result.value.value;
    } else if (result.error.code === "uncertain") setNotice("save_uncertain");
    else {
      setUnresolved(undefined);
      setNotice(result.error.code === "stale_revision" ? "refresh_preference" : "save_failed");
    }
    setBusy(false);
  }
  async function reconcile() {
    if (busy || !available) return;
    setBusy(true);
    if (unresolved) {
      const receipt = await port.readAppearanceReceipt(unresolved).result;
      if (!mounted.current) return;
      if (!receipt.ok || receipt.value.state === "pending") {
        setBusy(false);
        setNotice("save_uncertain");
        return;
      }
      if (receipt.value.state === "recorded") {
        if (receipt.value.outcome.ok) {
          setRecord(receipt.value.outcome.value);
          if (draft === receipt.value.outcome.value.value) {
            dirtyRef.current = false;
            setDirty(false);
            setNotice("saved");
          } else setNotice("unsaved");
        } else setNotice("refresh_preference");
      } else setNotice("unsaved");
      setUnresolved(undefined);
    }
    const current = await port.readAppearance().result;
    if (!mounted.current) return;
    if (current.ok) {
      setRecord(current.value);
      // Keep the user's draft while refreshing the revision used by a subsequent explicit save.
      document.documentElement.dataset.appearance = current.value.value;
    } else setNotice("save_failed");
    setBusy(false);
  }
  return (
    <section aria-labelledby="appearance-title" aria-busy={busy}>
      <h2 id="appearance-title">{text("appearance")}</h2>
      <AppearanceControl
        disabled={!record || busy || !!unresolved}
        value={draft}
        label={text("appearance")}
        labels={{ system: text("system"), light: text("light"), dark: text("dark") }}
        onChange={(value) => {
          if (busy || unresolved || !record || !isAppearance(value)) return;
          setDraft(value);
          dirtyRef.current = true;
          setDirty(true);
          setNotice("unsaved");
        }}
      />
      <p
        ref={alert}
        tabIndex={-1}
        role={
          notice === "save_failed" || notice === "save_uncertain" || notice === "refresh_preference"
            ? "alert"
            : "status"
        }
        aria-live={
          notice === "save_failed" || notice === "save_uncertain" || notice === "refresh_preference"
            ? "assertive"
            : "polite"
        }
      >
        {text(
          (!available ? "status_unavailable" : notice) ??
            (!record
              ? "status_starting"
              : dirty || record.source !== "saved"
                ? "unsaved"
                : "saved"),
        )}
      </p>
      <div className="actions">
        <button
          type="button"
          aria-disabled={busy || !available || !record || !dirty || !!unresolved}
          onClick={() => {
            if (dirty) void save();
          }}
        >
          {text("save")}
        </button>
        <button
          type="button"
          aria-disabled={busy || !available}
          onClick={() => {
            void reconcile();
          }}
        >
          {text(unresolved ? "check_save" : "refresh")}
        </button>
      </div>
    </section>
  );
}
