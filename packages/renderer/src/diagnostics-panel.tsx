import { useCallback, useEffect, useRef, useState } from "react";
import {
  diagnosticLimits,
  message,
  type DiagnosticReadFailure,
  type DiagnosticReadRequest,
  type DiagnosticReadResult,
  type DiagnosticsBridge,
  type InterfaceLocale,
  type SimpleMessageKey,
} from "@ohtia/contracts";

type Page = Extract<DiagnosticReadResult, { status: "ready" }>;

export function DiagnosticsPanel({
  bridge,
  locale,
}: {
  readonly bridge: DiagnosticsBridge;
  readonly locale: InterfaceLocale;
}) {
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

  return (
    <div className="diagnostics-panel">
      <label>
        {text("diagnostics.file")}
        <select
          value={slot}
          aria-disabled={loading}
          onChange={(event) => {
            if (!pending.current) void read({ slot: Number(event.currentTarget.value) });
          }}
        >
          <option value={0}>{text("diagnostics.active")}</option>
          {Array.from({ length: diagnosticLimits.files - 1 }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {message(locale, "diagnostics.archive", { slot: index + 1 })}
            </option>
          ))}
        </select>
      </label>
      <div className="diagnostics-actions">
        <button
          type="button"
          ref={refresh}
          aria-disabled={loading}
          onClick={() => void read({ slot })}
        >
          {text("diagnostics.refresh")}
        </button>
        <button
          type="button"
          ref={next}
          aria-disabled={loading || !page?.continuation}
          onClick={() => {
            if (page?.continuation) void read({ slot, continuation: page.continuation });
          }}
        >
          {text("diagnostics.next")}
        </button>
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
