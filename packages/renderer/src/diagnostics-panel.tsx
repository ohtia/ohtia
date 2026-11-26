import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  diagnosticLimits,
  message,
  type DiagnosticDeleteResult,
  type DiagnosticReadFailure,
  type DiagnosticReadRequest,
  type DiagnosticReadResult,
  type DiagnosticsBridge,
  type InterfaceLocale,
  type SimpleMessageKey,
} from "@ohtia/contracts";

type Page = Extract<DiagnosticReadResult, { status: "ready" }>;

/** Keep the outcome across visits to Diagnostics within the same window. */
export function useDiagnosticDeletion() {
  const inFlight = useRef(false);
  const [deletion, setDeletion] = useState<DiagnosticDeleteResult | { status: "deleting" }>();
  const deleteLogs = async (bridge: DiagnosticsBridge) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeletion({ status: "deleting" });
    try {
      setDeletion(await bridge.deleteLogs({ confirmed: true }));
    } catch {
      setDeletion({ status: "uncertain" });
    } finally {
      inFlight.current = false;
    }
  };
  return { deletion, deleteLogs };
}

export function DiagnosticsPanel({
  bridge,
  locale,
  deletionControl: { deletion, deleteLogs },
}: {
  readonly bridge: DiagnosticsBridge;
  readonly locale: InterfaceLocale;
  readonly deletionControl: ReturnType<typeof useDiagnosticDeletion>;
}) {
  const id = useId();
  const remove = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const observedDeletion = useRef(deletion);
  const [confirming, setConfirming] = useState(false);
  const deleting = deletion?.status === "deleting";
  const pending = useRef<DiagnosticReadRequest | undefined>(undefined);
  const refresh = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [slot, setSlot] = useState(0);
  const [page, setPage] = useState<Page>();
  const [pageNumber, setPageNumber] = useState(1);
  const [problem, setProblem] = useState<DiagnosticReadFailure>();
  const [loading, setLoading] = useState(true);
  const text = (key: SimpleMessageKey) => message(locale, key);

  const read = useCallback(
    async (request: DiagnosticReadRequest) => {
      if (pending.current) return;
      pending.current = request;
      setLoading(true);
      setProblem(undefined);
      if (!request.continuation) {
        setSlot(request.slot);
        setPage(undefined);
        setPageNumber(1);
      }
      let result: DiagnosticReadResult;
      try {
        result = await bridge.readPage(request);
      } catch {
        result = { status: "unavailable" };
      }
      if (pending.current !== request) return;
      pending.current = undefined;
      setLoading(false);
      if (result.status === "ready") {
        setPage(result);
        if (request.continuation) setPageNumber((number) => number + 1);
      } else {
        setProblem(result.status);
        if (result.status !== "busy") setPage(undefined);
        if (result.status === "stale" && document.activeElement === next.current)
          refresh.current?.focus();
      }
    },
    [bridge],
  );

  useEffect(() => {
    void read({ slot: 0 });
    return () => {
      pending.current = undefined;
    };
  }, [read]);

  useEffect(() => {
    if (observedDeletion.current === deletion) return;
    observedDeletion.current = deletion;
    if (deletion && deletion.status !== "deleting") void read({ slot });
  }, [deletion, read, slot]);

  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  const dismissConfirmation = () => {
    setConfirming(false);
    remove.current?.focus();
  };
  const controlsBusy = loading || deleting || confirming;

  return (
    <div
      className="diagnostics-panel"
      onKeyDown={(event) => {
        if (!confirming || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        dismissConfirmation();
      }}
    >
      <label>
        {text("diagnostics.file")}
        <select
          value={slot}
          aria-disabled={controlsBusy}
          onChange={(event) => {
            if (!controlsBusy) void read({ slot: Number(event.currentTarget.value) });
          }}
        >
          {Array.from({ length: diagnosticLimits.files }, (_, slot) => {
            const label =
              slot === 0
                ? "diagnostics.mostRecentArchive"
                : slot === diagnosticLimits.files - 1
                  ? "diagnostics.oldestArchive"
                  : "diagnostics.archive";
            return (
              <option key={slot} value={slot}>
                {message(locale, label, { slot: slot + 1 })}
              </option>
            );
          })}
        </select>
      </label>
      <div className="diagnostics-actions">
        <button
          type="button"
          ref={refresh}
          aria-disabled={controlsBusy}
          onClick={() => {
            if (!controlsBusy) void read({ slot });
          }}
        >
          {text("diagnostics.refresh")}
        </button>
        <button
          type="button"
          ref={next}
          aria-disabled={controlsBusy || !page?.continuation}
          onClick={() => {
            if (!controlsBusy && page?.continuation)
              void read({ slot, continuation: page.continuation });
          }}
        >
          {text("diagnostics.next")}
        </button>
        <button
          type="button"
          ref={remove}
          aria-expanded={confirming}
          aria-disabled={controlsBusy}
          onClick={() => {
            if (!controlsBusy) setConfirming(true);
          }}
        >
          {text("diagnostics.delete")}
        </button>
      </div>
      {confirming && (
        <div role="group" aria-label={text("diagnostics.delete")} aria-describedby={id}>
          <p id={id}>{text("diagnostics.deleteScope")}</p>
          <div className="diagnostics-actions">
            <button type="button" ref={cancel} onClick={dismissConfirmation}>
              {text("checkpoint_cancel")}
            </button>
            <button
              type="button"
              className="primitive-destructive"
              onClick={() => {
                dismissConfirmation();
                void deleteLogs(bridge);
              }}
            >
              {text("diagnostics.delete")}
            </button>
          </div>
        </div>
      )}
      <div role="status" aria-atomic="true">
        {deletion && deletion.status !== "ready" && (
          <p>{text(`diagnostics.deleteResult.${deletion.status}`)}</p>
        )}
        {deletion && "deleted" in deletion && (
          <p>{message(locale, "diagnostics.deleteCount", { count: deletion.deleted })}</p>
        )}
      </div>
      <div role="status" aria-atomic="true">
        {loading && <p>{text("diagnostics.loading")}</p>}
        {problem && <p>{text(`diagnostics.${problem}`)}</p>}
        {!loading && !problem && page && (
          <>
            <p>{message(locale, "diagnostics.page", { page: pageNumber })}</p>
            {!page.entries.length && <p>{text("diagnostics.empty")}</p>}
          </>
        )}
        {page && page.invalid > 0 && (
          <p>{message(locale, "diagnostics.invalid", { count: page.invalid })}</p>
        )}
        {page && page.unsupported > 0 && (
          <p>{message(locale, "diagnostics.unsupported", { count: page.unsupported })}</p>
        )}
      </div>
      {!!page?.entries.length && (
        <ol className="diagnostic-entries" aria-label={text("diagnostics.events")}>
          {page.entries.map((entry, index) => (
            <li key={index}>
              <time dateTime={entry.time}>{entry.time}</time>
              <span>{entry.severity}</span>
              <code>{entry.event}</code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
