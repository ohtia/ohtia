import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  message,
  type BootstrapSnapshot,
  type DesktopBridge,
  type FoundationStatus,
  type PortCall,
} from "@ohtia/contracts";
import "./foundation.css";
import { OhtiaBrand } from "./branding.js";
import { AppearancePanel } from "./appearance-panel.js";

declare global {
  interface Window {
    readonly ohtia: DesktopBridge;
  }
}
function bootstrapFailure(state: string | undefined): boolean {
  return (
    !!state &&
    (state.startsWith("locator_") ||
      [
        "path_rejected",
        "storage_failed",
        "recovery_required",
        "retry_required",
        "publication_uncertain",
      ].includes(state))
  );
}
function FoundationWindow() {
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot>();
  const [status, setStatus] = useState<FoundationStatus["service"]>("starting");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState(0);
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let disposed = false;
    const isDisposed = () => disposed;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let call: PortCall<FoundationStatus> | undefined;
    async function poll() {
      call = window.ohtia.foundation.readStatus();
      const result = await call.result;
      if (isDisposed()) return;
      const next = await window.ohtia.bootstrap.read();
      setStatus(
        next.state === "storage_opening"
          ? "starting"
          : result.ok
            ? result.value.service
            : "unavailable",
      );
      if (isDisposed()) return;
      document.documentElement.lang = next.locale;
      document.title = message(next.locale, "title");
      setBootstrap(next);
      timer = setTimeout(() => {
        void poll();
      }, 1000);
    }
    void window.ohtia.bootstrap.read().then((value) => {
      if (isDisposed()) return;
      document.documentElement.lang = value.locale;
      document.title = message(value.locale, "title");
      setBootstrap(value);
      void poll();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      call?.cancel();
    };
  }, []);
  useEffect(() => {
    if (failed || bootstrapFailure(bootstrap?.state) || bootstrap?.notice) notice.current?.focus();
  }, [failed, bootstrap?.state, bootstrap?.notice, announcement]);
  if (!bootstrap) return null;
  const text = (key: Parameters<typeof message>[1]) => message(bootstrap.locale, key);
  async function action(method: keyof DesktopBridge["bootstrap"], trigger: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const focusOutcome =
      method === "openStorage" || method === "restoreCheckpoint" || method === "retryService";
    try {
      const value = await window.ohtia.bootstrap[method]();
      flushSync(() => {
        setBootstrap(value);
      });
      if (bootstrapFailure(value.state) || value.notice) setAnnouncement((value) => value + 1);
      else if (focusOutcome) notice.current?.focus();
      else trigger.focus();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main aria-labelledby="title">
      <h1 id="title">
        <OhtiaBrand />
      </h1>
      <p>{text("intro")}</p>
      <p role="status" aria-live="polite" aria-atomic="true">
        {text(
          status === "ready"
            ? "status_ready"
            : status === "starting"
              ? "status_starting"
              : "status_unavailable",
        )}
      </p>
      <section aria-labelledby="location-title" aria-busy={busy}>
        <h2 id="location-title">{text("location")}</h2>
        <p
          key={announcement}
          id="location-state"
          ref={notice}
          tabIndex={-1}
          role={
            failed || bootstrap.notice || bootstrapFailure(bootstrap.state) ? "alert" : "status"
          }
        >
          {text(failed ? "startup_failed" : (bootstrap.notice ?? bootstrap.state))}
        </p>
        {bootstrap.state !== "storage_ready" && <p>{text("storage_disclosure")}</p>}
        {["pending_create", "located"].includes(bootstrap.state) && (
          <button
            type="button"
            aria-disabled={busy}
            onClick={(event) => {
              void action("openStorage", event.currentTarget);
            }}
          >
            {text("open_storage")}
          </button>
        )}
        {bootstrap.state === "recovery_required" && (
          <button
            type="button"
            aria-disabled={busy}
            onClick={(event) => {
              void action("restoreCheckpoint", event.currentTarget);
            }}
          >
            {text("restore_checkpoint")}
          </button>
        )}
      </section>
      <AppearancePanel
        port={window.ohtia.foundation}
        locale={bootstrap.locale}
        available={bootstrap.state === "storage_ready"}
      />
      <div className="actions">
        <button
          type="button"
          aria-disabled={busy || bootstrap.state === "storage_opening"}
          onClick={(event) => {
            if (bootstrap.state === "storage_opening") return;
            void action("retryService", event.currentTarget);
          }}
        >
          {text("retry")}
        </button>
        <button
          type="button"
          aria-disabled={busy}
          onClick={(event) => {
            void action("newWindow", event.currentTarget);
          }}
        >
          {text("new_window")}
        </button>
        <button
          type="button"
          onClick={(event) => {
            void action("exit", event.currentTarget);
          }}
        >
          {text("exit")}
        </button>
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing foundation root.");
createRoot(root).render(<FoundationWindow />);
