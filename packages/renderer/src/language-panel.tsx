import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  localeAutonyms,
  message,
  supportedLocales,
  type InterfaceLocale,
  type LocaleSnapshot,
  type FoundationPort,
  type SimpleMessageKey,
} from "@ohtia/contracts";
import { LanguageController } from "./language-controller.js";
import { LucideGlyph as Icon } from "./iconography.js";

export function LanguagePanel({
  port,
  locale,
  available,
  onLocale,
}: {
  readonly port: FoundationPort;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly onLocale: (snapshot: LocaleSnapshot) => void;
}) {
  const apply = useRef(onLocale);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    apply.current = onLocale;
  }, [onLocale]);
  const controller = useMemo(
    () =>
      new LanguageController(
        port,
        (snapshot) => {
          apply.current(snapshot);
        },
        () => crypto.randomUUID(),
      ),
    [port],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(
    () => () => {
      controller.dispose();
    },
    [controller],
  );
  useEffect(() => {
    if (available) void controller.refresh();
  }, [controller, available]);
  const text = (key: SimpleMessageKey) => message(locale, key);
  const choice = state.current?.record.value ?? "system";
  const label =
    choice === "system"
      ? message(locale, "settings.language.useSystem", {
          locale: localeAutonyms[state.current?.systemLocale ?? locale].label,
        })
      : localeAutonyms[choice].label;
  const conflictReady =
    !!state.current &&
    state.conflictRevision !== undefined &&
    state.current.record.revision >= state.conflictRevision;
  const pending = state.phase === "submitting" || (state.phase === "uncertain" && !state.canChoose);
  const icon =
    state.phase === "submitting"
      ? "circle-dashed"
      : state.phase === "confirmed"
        ? "check"
        : undefined;
  return (
    <section aria-labelledby="language-title" aria-busy={state.phase === "submitting"}>
      <h2>
        <span id="language-title">{text("settings.language.title")}</span>{" "}
        <span className="language-save-state" role="status">
          {icon && <Icon name={icon} />}
          {state.phase === "submitting"
            ? text("saving")
            : state.phase === "confirmed"
              ? text("saved")
              : ""}
        </span>
      </h2>
      <select
        ref={select}
        aria-labelledby="language-title"
        aria-describedby="language-help"
        value={state.draft}
        aria-disabled={
          !available ||
          !state.current ||
          pending ||
          (state.phase === "conflict" && (state.readFailed || !conflictReady))
        }
        onChange={(event) => {
          if (
            !available ||
            !state.current ||
            pending ||
            (state.phase === "conflict" && (state.readFailed || !conflictReady))
          )
            return;
          void controller.choose(event.currentTarget.value);
        }}
      >
        <option value="system">
          {message(locale, "settings.language.useSystem", {
            locale: localeAutonyms[state.current?.systemLocale ?? locale].label,
          })}
        </option>
        {supportedLocales.map((value) => (
          <option key={value} value={value} lang={value}>
            {localeAutonyms[value].label}
          </option>
        ))}
      </select>
      <p id="language-help">{text("settings.language.help")}</p>
      {state.current?.record.source === "invalid_fallback" && (
        <p className="language-danger" role="alert">
          {text("locale_fallback")}{" "}
          <button
            type="button"
            aria-disabled={!available || pending}
            onClick={() => {
              if (!available || pending) return;
              select.current?.focus();
              void controller.choose("system");
            }}
          >
            {message(locale, "settings.language.useSystem", {
              locale: localeAutonyms[state.current.systemLocale].label,
            })}
          </button>
        </p>
      )}
      {state.phase === "rejected" && (
        <p className="language-danger" role="alert">
          <Icon name="octagon-alert" />
          {message(locale, "settings.language.rejected", { value: label })}{" "}
          <button
            type="button"
            onClick={() => {
              select.current?.focus();
              void controller.retry();
            }}
          >
            {text("settings.language.tryAgain")}
          </button>
        </p>
      )}
      {state.phase === "uncertain" && (
        <p className="language-attention" role="status">
          <Icon name="triangle-alert" />
          {text(
            state.canChoose ? "settings.language.recovered" : "settings.language.uncertain",
          )}{" "}
          <button
            type="button"
            onClick={() => {
              select.current?.focus();
              void controller.check();
            }}
          >
            {text("settings.language.check")}
          </button>
          {state.canChoose && (
            <button
              type="button"
              onClick={() => {
                select.current?.focus();
                void controller.retry();
              }}
            >
              {text("settings.language.tryAgain")}
            </button>
          )}
        </p>
      )}
      {state.phase === "conflict" && !state.readFailed && conflictReady && (
        <p className="language-attention" role="status">
          <Icon name="git-compare" />
          {text("settings.language.conflict")}{" "}
          <button
            type="button"
            onClick={() => {
              select.current?.focus();
            }}
          >
            {text("settings.language.chooseAgain")}
          </button>
        </p>
      )}
      {state.displayFailed && (
        <p className="language-attention" role="status">
          <Icon name="triangle-alert" />
          {text("settings.language.applyFailed")}{" "}
          <button
            type="button"
            onClick={() => {
              select.current?.focus();
              controller.applyAgain();
            }}
          >
            {text("settings.language.applyAgain")}
          </button>
        </p>
      )}
      {state.readFailed && (
        <p className="language-danger" role="alert">
          {text("settings.language.readFailed")}{" "}
          <button
            type="button"
            onClick={() => {
              select.current?.focus();
              void controller.refresh();
            }}
          >
            {text("refresh")}
          </button>
        </p>
      )}
      {state.changedFromWindow && (
        <p role="status">
          <Icon name="info" />
          {message(locale, "settings.language.changed", { value: label })}
        </p>
      )}
    </section>
  );
}
