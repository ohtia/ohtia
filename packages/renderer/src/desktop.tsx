import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  message,
  type SimpleMessageKey,
  type LocaleSnapshot,
  type BootstrapSnapshot,
  type DesktopBridge,
  type FoundationStatus,
  type PortCall,
} from "@ohtia/contracts";
import "./foundation.css";
import { CommandSurfaces } from "./command-surfaces.js";
import { OhtiaBrand } from "./branding.js";
import { LanguagePanel } from "./language-panel.js";
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
  const appliedLocale = useRef<LocaleSnapshot | undefined>(undefined);
  const applyLocale = useRef((snapshot: LocaleSnapshot) => {
    if (
      appliedLocale.current?.serviceGeneration === snapshot.serviceGeneration &&
      snapshot.record.revision < appliedLocale.current.record.revision
    )
      return;
    appliedLocale.current = snapshot;
    document.documentElement.lang = snapshot.effectiveLocale;
    document.title = message(snapshot.effectiveLocale, "title");
    setBootstrap((current) =>
      current ? { ...current, locale: snapshot.effectiveLocale } : current,
    );
  });
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
      if (!appliedLocale.current) {
        document.documentElement.lang = next.locale;
        document.title = message(next.locale, "title");
      }
      setBootstrap((current) =>
        !appliedLocale.current || !current ? next : { ...next, locale: current.locale },
      );
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
  const locationNotice = bootstrap?.notice === "locale_fallback" ? undefined : bootstrap?.notice;
  useEffect(() => {
    if (failed || bootstrapFailure(bootstrap?.state) || locationNotice) notice.current?.focus();
  }, [failed, bootstrap?.state, locationNotice, announcement]);
  if (!bootstrap) return null;
  const text = (key: SimpleMessageKey) => message(bootstrap.locale, key);
  async function action(method: keyof DesktopBridge["bootstrap"], trigger: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const focusOutcome =
      method === "openStorage" || method === "restoreCheckpoint" || method === "retryService";
    try {
      const value = await window.ohtia.bootstrap[method]();
      flushSync(() => {
        if (!appliedLocale.current) {
          document.documentElement.lang = value.locale;
          document.title = message(value.locale, "title");
        }
        setBootstrap((current) =>
          appliedLocale.current && current ? { ...value, locale: current.locale } : value,
        );
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
      <CommandSurfaces bridge={window.ohtia.commands} locale={bootstrap.locale} />
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
          role={failed || locationNotice || bootstrapFailure(bootstrap.state) ? "alert" : "status"}
        >
          {text(failed ? "startup_failed" : (locationNotice ?? bootstrap.state))}
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
      <LanguagePanel
        port={window.ohtia.foundation}
        locale={bootstrap.locale}
        available={bootstrap.state === "storage_ready"}
        onLocale={applyLocale.current}
      />
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
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing foundation root.");
createRoot(root).render(<FoundationWindow />);
