import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { message, formatNumber, isInferenceLimit, type InterfaceLocale } from "@ohtia/contracts";
import { LucideGlyph as Icon } from "./iconography.js";
import { RecoveryFocusBoundary } from "./settings-notices.js";
import { type LimitsState, LimitsController } from "./limits-controller.js";

export interface LimitConnection {
  readonly id: string;
  readonly name: string;
  readonly kind: "subscription" | "api_key";
  readonly limit?: number | undefined;
}
export function LimitsPanel({
  controller,
  locale,
  available,
  connections = [],
}: {
  readonly controller: LimitsController;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly connections?: readonly LimitConnection[];
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState(String(state.draft));
  const [invalid, setInvalid] = useState(false);
  const record = state.current;
  const saved = record?.max_concurrent_inference ?? 10;
  const submitting = state.phase === "submitting";
  const blocked =
    !available || !record || submitting || (state.phase === "uncertain" && !state.canChoose);
  useEffect(() => {
    setDraft(
      String(state.phase === "submitting" || state.phase === "uncertain" ? state.draft : saved),
    );
    setInvalid(false);
  }, [record?.serviceGeneration, record?.revision, saved, state.draft, state.phase]);
  useEffect(() => {
    controller.setViewOpen(true);
    return () => {
      controller.setViewOpen(false);
    };
  }, [controller]);
  useEffect(() => {
    if (available) void controller.refresh();
  }, [controller, available]);
  const name = message(locale, "limits.field");
  const recover = () => field.current?.focus();
  const commit = (text = draft) => {
    if (blocked || composing.current) return;
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!isInferenceLimit(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (value !== saved) void controller.choose(value);
  };
  const shown = /^\d+$/.test(draft) && isInferenceLimit(Number(draft)) ? Number(draft) : saved;
  return (
    <section className="limits-panel" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{message(locale, "limits.section")}</h3>
      <div className="settings-group-heading">
        <label htmlFor={`${id}-field`}>{name}</label>
        <span className="settings-save-state" role="status">
          {(submitting ||
            (state.phase === "confirmed" &&
              !invalid &&
              /^\d+$/.test(draft) &&
              Number(draft) === saved)) && (
            <>
              <Icon name={submitting ? "circle-dashed" : "check"} />
              {message(locale, submitting ? "saving" : "saved")}
            </>
          )}
        </span>
      </div>
      <input
        ref={field}
        id={`${id}-field`}
        className="settings-number-input"
        type="number"
        min={1}
        max={50}
        step={1}
        inputMode="numeric"
        value={draft}
        disabled={!available || !record}
        readOnly={submitting || (state.phase === "uncertain" && !state.canChoose)}
        aria-disabled={blocked}
        aria-invalid={invalid}
        aria-describedby={`${id}-help${invalid ? ` ${id}-range` : ""}`}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onBlur={() => {
          commit();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setDraft(event.currentTarget.value);
          if (document.activeElement !== event.currentTarget) commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && !composing.current) {
            event.preventDefault();
            commit();
          }
        }}
      />
      {invalid && (
        <p id={`${id}-range`} className="language-attention" role="alert">
          <Icon name="triangle-alert" />
          {message(locale, "limits.range", {
            min: formatNumber(locale, 1),
            max: formatNumber(locale, 50),
            value: formatNumber(locale, saved),
          })}
        </p>
      )}
      <div id={`${id}-help`}>
        {connections.map((connection) => (
          <div key={connection.id}>
            <p>
              {message(
                locale,
                connection.kind === "subscription" ? "limits.subscription" : "limits.apiKey",
                { service: connection.name },
              )}
            </p>
            {connection.limit !== undefined && connection.limit < shown && (
              <p>
                {message(locale, "limits.connectionLimit", {
                  service: connection.name,
                  connection_limit: connection.limit,
                })}
              </p>
            )}
          </div>
        ))}
        {record && record.running > saved && (
          <p role="status">
            {message(locale, "limits.running", { running: record.running, value: saved })}
          </p>
        )}
      </div>
      <LimitsNotices
        controller={controller}
        state={state}
        locale={locale}
        available={available}
        onRecover={recover}
        showChanged
      />
    </section>
  );
}

function LimitsNotices({
  controller,
  state,
  locale,
  available,
  onRecover,
  showChanged = false,
}: {
  readonly controller: LimitsController;
  readonly state: LimitsState;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly onRecover: () => void;
  readonly showChanged?: boolean;
}) {
  const name = message(locale, "limits.field");
  const saved = state.current?.max_concurrent_inference ?? 10;
  return (
    <RecoveryFocusBoundary onRecover={onRecover}>
      {state.phase === "rejected" && (
        <>
          <p className="language-danger" role="alert" data-settings-attention="octagon-alert">
            <Icon name="octagon-alert" />
            {message(locale, "settings.rejected", {
              setting: name,
              value: formatNumber(locale, saved),
            })}
          </p>
          <div className="limits-notice-actions">
            <button
              type="button"
              onClick={() => {
                onRecover();
                void controller.retry();
              }}
            >
              {message(locale, "settings.language.tryAgain")}
            </button>
          </div>
        </>
      )}
      {state.phase === "uncertain" && (
        <>
          <p className="language-attention" role="status" data-settings-attention="triangle-alert">
            <Icon name="triangle-alert" />
            {state.canChoose
              ? message(locale, "settings.language.recovered")
              : message(locale, "settings.uncertain", { setting: name })}
          </p>
          <div className="limits-notice-actions">
            <button
              type="button"
              onClick={() => {
                onRecover();
                void controller.check();
              }}
            >
              {message(locale, "settings.language.check")}
            </button>
            {state.canChoose && (
              <button
                type="button"
                onClick={() => {
                  onRecover();
                  void controller.retry();
                }}
              >
                {message(locale, "settings.language.tryAgain")}
              </button>
            )}
          </div>
        </>
      )}
      {available && state.readFailed && (
        <>
          <p className="language-danger" role="alert" data-settings-attention="octagon-alert">
            <Icon name="octagon-alert" />
            {message(locale, "settings.readFailed")}
          </p>
          <div className="limits-notice-actions">
            <button
              type="button"
              onClick={() => {
                onRecover();
                void controller.refresh();
              }}
            >
              {message(locale, "refresh")}
            </button>
          </div>
        </>
      )}
      {showChanged && state.changedFromWindow && (
        <p role="status">
          <Icon name="info" />
          {message(locale, "settings.changed", {
            setting: name,
            value: formatNumber(locale, saved),
          })}
        </p>
      )}
    </RecoveryFocusBoundary>
  );
}

/** Retains command recovery after the Settings field unmounts. */
export function LimitsFeedback({
  controller,
  locale,
  available,
  inDialog,
  onOpenSettings,
  returnFocusRef,
}: {
  readonly controller: LimitsController;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly inDialog: boolean;
  readonly onOpenSettings: () => void;
  readonly returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const anchor = useRef<HTMLButtonElement>(null);
  const [retainFocus, setRetainFocus] = useState(false);
  const hasNotices =
    state.phase === "rejected" || state.phase === "uncertain" || (available && state.readFailed);
  const recover = () => {
    if (inDialog) {
      if (anchor.current?.closest("dialog[open]")) anchor.current.focus();
    } else if (!document.querySelector("dialog[open]"))
      (
        returnFocusRef?.current ??
        document.querySelector<HTMLButtonElement>(".command-entry-actions button")
      )?.focus();
  };
  return (
    <RecoveryFocusBoundary
      onRecover={recover}
      className="settings-feedback limits-feedback"
      hidden={!hasNotices && !retainFocus}
      onFocusWithin={() => {
        if (inDialog) setRetainFocus(true);
      }}
      onBlurOutside={() => {
        setRetainFocus(false);
      }}
    >
      {inDialog && (hasNotices || retainFocus) && (
        <button ref={anchor} type="button" onClick={onOpenSettings}>
          {message(locale, "command.settings.open")}
        </button>
      )}
      <LimitsNotices
        controller={controller}
        state={state}
        locale={locale}
        available={available}
        onRecover={recover}
      />
    </RecoveryFocusBoundary>
  );
}
