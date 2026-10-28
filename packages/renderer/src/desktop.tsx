import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  message,
  type BootstrapSnapshot,
  type DesktopBridge,
  type FoundationStatus,
  type PortCall,
} from "@ohtia/contracts";
import "./foundation.css";

declare global {
  interface Window {
    readonly ohtia: DesktopBridge;
  }
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let call: PortCall<FoundationStatus> | undefined;
    async function poll() {
      call = window.ohtia.foundation.readStatus();
      const result = await call.result;
      if (disposed) return;
      setStatus(result.ok ? result.value.service : "unavailable");
      timer = setTimeout(() => {
        void poll();
      }, 1000);
    }
    void window.ohtia.bootstrap.read().then((value) => {
      if (disposed) return;
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
    if (failed || bootstrap?.state === "path_rejected" || bootstrap?.notice)
      notice.current?.focus();
  }, [failed, bootstrap?.state, bootstrap?.notice, announcement]);
  if (!bootstrap) return null;
  const text = (key: Parameters<typeof message>[1]) => message(bootstrap.locale, key);
  async function action(method: keyof DesktopBridge["bootstrap"], trigger: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const value = await window.ohtia.bootstrap[method]();
      setBootstrap(value);
      if (value.state === "path_rejected" || value.notice) setAnnouncement((value) => value + 1);
      else trigger.focus();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main aria-labelledby="title">
      <h1 id="title">{text("title")}</h1>
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
            failed ||
            bootstrap.notice ||
            bootstrap.state.startsWith("locator_") ||
            bootstrap.state === "path_rejected"
              ? "alert"
              : "status"
          }
        >
          {text(failed ? "startup_failed" : (bootstrap.notice ?? bootstrap.state))}
        </p>
      </section>
      <div className="actions">
        <button
          type="button"
          aria-disabled={busy}
          onClick={(event) => {
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
