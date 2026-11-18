import { useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  formatNumber,
  message,
  researcherMessageLimit,
  type InterfaceLocale,
} from "@ohtia/contracts";
import { Dialog, Tooltip } from "./layers.js";
import { LucideGlyph } from "./iconography.js";
import type { ComposerController } from "./composer-controller.js";
import "./message-composer.css";

export function MessageComposer({
  controller,
  locale,
  agent = "Virgilio",
}: {
  readonly controller: ComposerController;
  readonly locale: InterfaceLocale;
  readonly agent?: string;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const id = useId();
  const count = Array.from(state.text).length;
  const over = count > researcherMessageLimit;
  const counter = count >= 18_000;
  const hasText = state.text.trim().length > 0;
  const stopping = state.stopping || state.cancelling;
  const stop = !state.starting && (state.saving || stopping || (!hasText && state.running));
  const destinationUnavailable = state.destinationStatus !== "ready";
  const disabled =
    !!state.starting || stopping || (!stop && (!hasText || over || destinationUnavailable));
  const destinationReason = !stop && hasText && !over && destinationUnavailable;
  const reason = stopping
    ? message(locale, "composer.stopping")
    : !hasText && !stop
      ? message(locale, "composer.empty")
      : destinationReason
        ? message(
            locale,
            state.destinationStatus === "failed"
              ? "composer.destinationFailed"
              : "composer.destinationLoading",
          )
        : "";
  const name = message(locale, stop ? "composer.stop" : "composer.send");
  const notice = over
    ? message(locale, "composer.remove", { excess: count - researcherMessageLimit })
    : state.notice === "inputTooLarge"
      ? message(locale, "composer.inputTooLarge", { agent })
      : state.notice
        ? message(locale, `composer.${state.notice}`)
        : "";
  const danger = !over && state.notice === "failed";
  const described =
    [
      counter && `${id}-count`,
      notice && `${id}-notice`,
      state.stopFailed && `${id}-stop-error`,
      state.destinationStatus === "failed" && `${id}-destination-error`,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  useLayoutEffect(() => {
    const textarea = input.current;
    const panel = textarea?.closest<HTMLElement>(".conversation-view");
    if (!textarea) return;
    const resize = () => {
      const style = getComputedStyle(textarea);
      const line = Number.parseFloat(style.lineHeight) || 24;
      const padding =
        (Number.parseFloat(style.paddingTop) || 4) + (Number.parseFloat(style.paddingBottom) || 4);
      const panelLimit = panel?.clientHeight ? panel.clientHeight * 0.4 - 10 : Infinity;
      const maximum = Math.max(line + padding, Math.min(line * 8 + padding, panelLimit));
      const scroll = textarea.scrollTop;
      textarea.style.height = "0px";
      textarea.style.height = `${String(Math.min(Math.max(line + padding, textarea.scrollHeight), maximum))}px`;
      textarea.scrollTop = scroll;
      // Reset the native selection to make Chromium reveal the caret inside a shrunken viewport.
      if (document.activeElement === textarea)
        textarea.setSelectionRange(
          textarea.selectionStart,
          textarea.selectionEnd,
          textarea.selectionDirection,
        );
    };
    resize();
    if (typeof ResizeObserver === "undefined" || !panel) return;
    const observer = new ResizeObserver(resize);
    observer.observe(panel);
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    return () => {
      observer.disconnect();
    };
  }, [state.text]);
  useLayoutEffect(() => {
    if (!state.focusRequest) return;
    const apply = (): boolean => {
      const textarea = input.current;
      if (!textarea) return false;
      if (textarea.disabled) return true;
      if (textarea.closest("[hidden], [inert]") || document.querySelector("dialog[open]"))
        return false;
      textarea.focus();
      return document.activeElement === textarea;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["open", "hidden", "inert"],
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
    };
  }, [state.focusRequest]);
  const placeholder = state.correction
    ? message(locale, "setup.correctPlaceholder")
    : message(locale, "composer.placeholder", { agent });
  function focusInput() {
    requestAnimationFrame(() => input.current?.focus());
  }
  return (
    <section
      className="message-composer"
      aria-label={message(locale, "composer.placeholder", { agent })}
    >
      {state.correction && !state.setupFinal && (
        <label className="composer-correction" htmlFor={`${id}-input`}>
          {message(locale, "setup.correctPlaceholder")}
        </label>
      )}
      <div className="composer-box">
        <textarea
          id={`${id}-input`}
          ref={input}
          rows={1}
          value={state.text}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-describedby={described}
          aria-invalid={over || undefined}
          onChange={(event) => {
            controller.edit(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              composing.current ||
              event.nativeEvent.isComposing ||
              // Chromium can finish native IME composition before delivering this keydown.
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              event.keyCode === 229
            )
              return;
            event.preventDefault();
            controller.send();
          }}
          onPaste={(event) => {
            event.preventDefault();
            const textarea = event.currentTarget;
            const start = textarea.selectionStart;
            const pasted = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
            if (!pasted) return;
            controller.edit(
              state.text.slice(0, start) + pasted + state.text.slice(textarea.selectionEnd),
            );
            requestAnimationFrame(() => {
              textarea.setSelectionRange(start + pasted.length, start + pasted.length);
            });
          }}
        />
        <Tooltip label={disabled && reason ? reason : name}>
          <button
            type="button"
            className="composer-action"
            aria-label={name}
            aria-disabled={disabled}
            aria-describedby={
              stopping || (!hasText && !stop)
                ? `${id}-reason`
                : !stop && over
                  ? `${id}-notice`
                  : destinationReason && state.destinationStatus === "failed"
                    ? `${id}-destination-error`
                    : reason
                      ? `${id}-reason`
                      : undefined
            }
            onClick={() => {
              if (!disabled) {
                if (stop) controller.requestStop();
                else controller.send();
              }
            }}
          >
            <LucideGlyph name={stop ? "square" : "arrow-up"} size={16} />
          </button>
        </Tooltip>
      </div>
      {counter && (
        <div className="composer-counter" id={`${id}-count`}>
          <span aria-hidden="true">
            {formatNumber(locale, count)} / {formatNumber(locale, researcherMessageLimit)}
          </span>
          <span className="primitive-announcement">
            {message(locale, "composer.counter", { used: count, max: researcherMessageLimit })}
          </span>
        </div>
      )}
      {notice && (
        <div
          className={`conversation-notice ${danger ? "danger" : "attention"}`}
          role={danger ? "alert" : "status"}
          id={`${id}-notice`}
        >
          <LucideGlyph name={danger ? "octagon-alert" : "triangle-alert"} size={16} />
          <span>{notice}</span>
        </div>
      )}
      {state.stopFailed && (
        <div className="composer-stop-error">
          <div className="conversation-notice attention" role="status" id={`${id}-stop-error`}>
            <LucideGlyph name="triangle-alert" size={16} />
            <span>{message(locale, "composer.stopFailed")}</span>
          </div>
          <button type="button" className="primitive-button" onClick={controller.retryStop}>
            {message(locale, "composer.retryStop")}
          </button>
        </div>
      )}
      {state.destinationStatus === "failed" && (
        <div className="composer-destination-error">
          <div
            className="conversation-notice attention"
            role="status"
            id={`${id}-destination-error`}
          >
            <LucideGlyph name="triangle-alert" size={16} />
            <span>{message(locale, "composer.destinationFailed")}</span>
          </div>
          <button
            type="button"
            className="primitive-button"
            onClick={() => {
              void controller.refreshDestination();
            }}
          >
            {message(locale, "composer.refreshDestination")}
          </button>
        </div>
      )}
      {reason && !(destinationReason && state.destinationStatus === "failed") && (
        <p
          id={`${id}-reason`}
          className={stopping || destinationReason ? "composer-reason" : "primitive-announcement"}
        >
          {reason}
        </p>
      )}
      {state.destination && (
        <p className="composer-destination">
          {message(
            locale,
            state.connectionState !== "connected"
              ? "taskNotice.destinationDisconnected"
              : state.usagePaused
                ? state.destination.declaration.kind === "subscription"
                  ? "taskNotice.destinationPaused.subscription"
                  : "taskNotice.destinationPaused.apiKey"
                : state.destination.declaration.kind === "subscription"
                  ? "composer.subscription"
                  : "composer.apiKey",
            {
              service: state.destination.declaration.displayName,
              ...(state.connectionState === "connected" &&
              !state.usagePaused &&
              state.destination.declaration.kind === "subscription"
                ? { email: state.destination.email || message(locale, "identity.unknown") }
                : {}),
            },
          )}
        </p>
      )}
      <p className="primitive-announcement" role="status" aria-live="polite" aria-atomic="true">
        <span key={state.announcement}>
          {state.announcement ? message(locale, "composer.sending") : ""}
        </span>
      </p>
      <Dialog
        open={state.reuse !== null}
        title={message(locale, "composer.replaceTitle")}
        closeLabel={message(locale, "dialog.close")}
        closePlacement="footer"
        onClose={controller.closeReuse}
        returnFocusRef={input}
        footer={
          <button
            type="button"
            className="primitive-button primitive-primary"
            onClick={() => {
              controller.replaceReuse();
              focusInput();
            }}
          >
            {message(locale, "composer.replace")}
          </button>
        }
      >
        <p>{message(locale, "composer.replaceBody")}</p>
      </Dialog>
    </section>
  );
}
