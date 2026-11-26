import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import {
  diagnosticLimits,
  isDiagnosticTime,
  message,
  type DiagnosticBundleResult,
  type DiagnosticsBridge,
  type InterfaceLocale,
  type SimpleMessageKey,
} from "@ohtia/contracts";

type Result = DiagnosticBundleResult | { status: "preparing" | "saving" };

function utc(input: FormDataEntryValue | null): string | undefined {
  if (typeof input !== "string") return;
  const date = new Date(input + "Z");
  if (Number.isFinite(date.valueOf())) {
    const value = date.toISOString();
    if (isDiagnosticTime(value)) return value;
  }
}

export function DiagnosticBundlePanel({
  bridge,
  locale,
  blocked,
}: {
  readonly bridge: DiagnosticsBridge;
  readonly locale: InterfaceLocale;
  readonly blocked: boolean;
}) {
  const label = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const review = useRef<HTMLPreElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const active = useRef<string | undefined>(undefined);
  const focus = useRef<"form" | "review" | "feedback" | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [dates] = useState(() => {
    const now = Date.now();
    return {
      from: new Date(now - 86_400_000).toISOString().slice(0, -1),
      through: new Date(now).toISOString().slice(0, -1),
    };
  });
  const [result, setResult] = useState<Result>();
  const [saveBusy, setSaveBusy] = useState(false);
  const preview = result?.status === "preview" ? result : undefined;
  const preparing = result?.status === "preparing";
  const saving = result?.status === "saving";
  const formLocked = blocked || preparing || saving;

  useEffect(() => {
    const destination = focus.current;
    focus.current = undefined;
    if (destination === "form") form.current?.querySelector("input")?.focus();
    if (destination === "review") review.current?.focus();
    if (destination === "feedback") feedback.current?.focus();
  }, [open, result]);

  useEffect(
    () => () => {
      const id = active.current;
      active.current = undefined;
      if (id) void bridge.bundle({ action: "discard", id }).catch(() => {});
    },
    [bridge],
  );

  const discard = () => {
    const id = active.current;
    active.current = undefined;
    if (id) void bridge.bundle({ action: "discard", id }).catch(() => {});
    setSaveBusy(false);
    setResult(undefined);
  };

  const close = () => {
    discard();
    setOpen(false);
    trigger.current?.focus();
  };

  const prepare = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formLocked) return;
    const data = new FormData(event.currentTarget);
    const slots = data.getAll("slot").reduce((mask, slot) => mask | (1 << Number(slot)), 0);
    const from = utc(data.get("from"));
    const through = utc(data.get("through"));
    if (!slots || !from || !through || from > through) {
      focus.current = "feedback";
      setResult({ status: "invalid_request" });
      feedback.current?.focus();
      return;
    }
    const id = crypto.randomUUID();
    const previous = active.current;
    active.current = id;
    if (previous) void bridge.bundle({ action: "discard", id: previous }).catch(() => {});
    setResult({ status: "preparing" });
    let outcome: DiagnosticBundleResult;
    try {
      outcome = await bridge.bundle({ action: "prepare", id, slots, from, through });
    } catch {
      outcome = { status: "unavailable" };
    }
    if (active.current !== id) return;
    if (outcome.status !== "preview") {
      active.current = undefined;
      void bridge.bundle({ action: "discard", id }).catch(() => {});
    }
    if (document.activeElement === document.body || form.current?.contains(document.activeElement))
      focus.current = outcome.status === "preview" ? "review" : "feedback";
    setResult(outcome);
  };

  const save = async () => {
    const id = active.current;
    if (!id || !preview || blocked) return;
    setSaveBusy(false);
    setResult({ status: "saving" });
    let outcome: DiagnosticBundleResult;
    try {
      outcome = await bridge.bundle({ action: "save", token: preview.token });
    } catch {
      outcome = { status: "uncertain" };
    }
    if (active.current !== id) return;
    if (outcome.status === "busy") {
      setSaveBusy(true);
      if (document.activeElement === document.body) focus.current = "review";
      setResult(preview);
      return;
    }
    active.current = undefined;
    void bridge.bundle({ action: "discard", id }).catch(() => {});
    if (document.activeElement === document.body || form.current?.contains(document.activeElement))
      focus.current = "feedback";
    setResult(outcome);
  };

  const text = (key: Extract<SimpleMessageKey, `diagnostics.bundle.${string}`>) =>
    message(locale, key);
  const status = result?.status;
  const notice =
    status === "invalid_request"
      ? text("diagnostics.bundle.invalid")
      : status === "invalid_file"
        ? message(locale, "diagnostics.invalid_file")
        : status === "busy" || saveBusy
          ? message(locale, "diagnostics.busy")
          : status && status !== "preview"
            ? text(`diagnostics.bundle.${status}`)
            : undefined;

  return (
    <section
      className="diagnostic-bundle"
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <button
        type="button"
        ref={trigger}
        aria-expanded={open}
        aria-controls={open ? label : undefined}
        aria-disabled={blocked}
        onClick={() => {
          if (blocked) return;
          if (open) close();
          else {
            focus.current = "form";
            setOpen(true);
          }
        }}
      >
        {text("diagnostics.bundle.title")}
      </button>
      {open && (
        <form ref={form} id={label} onSubmit={(event) => void prepare(event)} onChange={discard}>
          <fieldset disabled={formLocked}>
            <legend>{text("diagnostics.bundle.files")}</legend>
            {Array.from({ length: diagnosticLimits.files }, (_, slot) => (
              <label key={slot} className="diagnostic-slot">
                <input type="checkbox" name="slot" value={slot} defaultChecked />
                {message(
                  locale,
                  slot === 0
                    ? "diagnostics.mostRecentArchive"
                    : slot === diagnosticLimits.files - 1
                      ? "diagnostics.oldestArchive"
                      : "diagnostics.archive",
                  { slot: slot + 1 },
                )}
              </label>
            ))}
          </fieldset>
          <label>
            {text("diagnostics.bundle.from")}
            <input
              name="from"
              type="datetime-local"
              step="0.001"
              disabled={formLocked}
              required
              defaultValue={dates.from}
            />
          </label>
          <label>
            {text("diagnostics.bundle.through")}
            <input
              name="through"
              type="datetime-local"
              step="0.001"
              disabled={formLocked}
              required
              defaultValue={dates.through}
            />
          </label>
          <div role="status" tabIndex={-1} ref={feedback} aria-atomic="true">
            {notice && <p>{notice}</p>}
            {result && "invalid" in result && (
              <>
                <p>{message(locale, "diagnostics.invalid", { count: result.invalid })}</p>
                <p>{message(locale, "diagnostics.unsupported", { count: result.unsupported })}</p>
              </>
            )}
          </div>
          {preview && (
            <pre
              role="region"
              ref={review}
              tabIndex={0}
              aria-label={text("diagnostics.bundle.preview")}
            >
              {preview.json}
            </pre>
          )}
          <div className="diagnostics-actions">
            {preview && (
              <button type="button" aria-disabled={blocked} onClick={() => void save()}>
                {text("diagnostics.bundle.save")}
              </button>
            )}
            <button type="submit" aria-disabled={formLocked}>
              {text("diagnostics.bundle.preview")}
            </button>
            <button type="button" onClick={close}>
              {message(locale, "checkpoint_cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
