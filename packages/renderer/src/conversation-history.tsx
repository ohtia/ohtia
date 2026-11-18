import { useLayoutEffect, useMemo, useRef } from "react";
import { message, type ConversationSummary, type InterfaceLocale } from "@ohtia/contracts";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph, type LucideName } from "./iconography.js";
import { Tooltip } from "./layers.js";
import { conversationPreview } from "./message-markdown.js";
import type { ConversationController, ConversationState } from "./conversation-controller.js";
import type { ConversationHistoryController } from "./conversation-history-controller.js";
import "./conversation-history.css";

export function conversationName(row: ConversationSummary, locale: InterfaceLocale): string {
  return (
    row.title ??
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(row.createdAt))
  );
}

function fullTime(value: string, locale: InterfaceLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function historyTime(value: string, locale: InterfaceLocale, now = new Date()): string {
  const date = new Date(value);
  const sameYear = date.getFullYear() === now.getFullYear();
  const today = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(
    locale,
    today
      ? { timeStyle: "short" }
      : { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) },
  ).format(date);
}

const statusIcons = {
  attention: "triangle-alert",
  replying: "pen-line",
  waiting: "circle-dashed",
} as const;

function HistoryRow({
  row,
  locale,
  current,
  select,
}: {
  row: ConversationSummary;
  locale: InterfaceLocale;
  current: boolean;
  select: (id: string) => void;
}) {
  const preview = useMemo(
    () => conversationPreview(row.latestPrefix, row.latestTruncated),
    [row.latestPrefix, row.latestTruncated],
  );
  return (
    <li>
      <button
        type="button"
        className="chat-history-row"
        aria-current={current || undefined}
        onClick={() => {
          select(row.id);
        }}
      >
        {current && <span className="chat-history-selection" aria-hidden="true" />}
        <span className="chat-history-row-meta">
          <VoiceLabel
            identity={{ kind: "ai", contributor: row.agentId, definitionVersion: "" }}
            locale={locale}
            compact
          />
          <time dateTime={row.latestAt} title={fullTime(row.latestAt, locale)}>
            {historyTime(row.latestAt, locale)}
          </time>
        </span>
        <bdi className="chat-history-title" lang={row.title ? "" : locale}>
          {conversationName(row, locale)}
        </bdi>
        {preview && (
          <bdi className="chat-history-preview" lang={row.latestLanguage ?? ""}>
            {preview}
          </bdi>
        )}
        {row.status && (
          <span className="chat-history-status" data-status={row.status}>
            <LucideGlyph name={statusIcons[row.status]} size={16} />
            {message(locale, `history.${row.status}`)}
          </span>
        )}
      </button>
    </li>
  );
}

export function ConversationHistory({
  state,
  controller,
  select,
  current,
  locale,
}: {
  state: ReturnType<ConversationHistoryController["snapshot"]>;
  controller: ConversationHistoryController;
  select: (id: string) => void;
  current: string | null;
  locale: InterfaceLocale;
}) {
  const pending = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (state.status === "loading" || state.loadingOlder || !pending.current) return;
    const button = pending.current;
    pending.current = null;
    const target =
      state.next && button === more.current ? more.current : (list.current ?? more.current);
    if (
      target &&
      !target.closest("[hidden], [inert]") &&
      (document.activeElement === button || document.activeElement === document.body)
    )
      target.focus({ preventScroll: true });
  }, [state.status, state.next, state.loadingOlder]);

  if (state.status === "loading")
    return (
      <div className="conversation-state" aria-busy="true">
        <p aria-hidden="true">{message(locale, "history.loading")}</p>
      </div>
    );
  if (state.status === "unavailable")
    return (
      <div className="conversation-state">
        <div className="conversation-notice attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          {message(locale, "conversation.unavailable")}
        </div>
      </div>
    );
  const failed = state.status === "failed";
  return (
    <>
      {!failed && (
        <ul role="list" className="chat-history-list" ref={list} tabIndex={-1}>
          {state.items.map((row) => (
            <HistoryRow
              key={row.id}
              row={row}
              locale={locale}
              current={row.id === current}
              select={select}
            />
          ))}
        </ul>
      )}
      {(failed || state.next) && (
        <div className="conversation-state chat-history-actions">
          {(failed || state.failedOlder) && (
            <div className="conversation-notice danger" role="alert">
              <LucideGlyph name="octagon-alert" size={16} />
              {message(locale, failed ? "history.failed" : "history.olderFailed")}
            </div>
          )}
          <button
            type="button"
            className="primitive-button"
            ref={more}
            disabled={state.loadingOlder}
            onClick={(event) => {
              pending.current = event.currentTarget;
              if (failed) controller.reload();
              else controller.loadOlder();
            }}
          >
            {message(locale, failed ? "history.reload" : "history.loadOlder")}
          </button>
          <span role="status">
            {state.loadingOlder ? message(locale, "history.olderLoading") : ""}
          </span>
        </div>
      )}
    </>
  );
}

export function ConversationHeaderButton({
  buttonRef,
  icon,
  label,
  action,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  icon: LucideName;
  label: string;
  action: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="workspace-control"
        ref={buttonRef}
        aria-label={label}
        onClick={action}
      >
        <LucideGlyph name={icon} size={icon === "pencil" ? 16 : 20} />
      </button>
    </Tooltip>
  );
}

export function ConversationNameField({
  controller,
  rename,
  noticeId,
  locale,
}: {
  controller: ConversationController;
  rename: NonNullable<ConversationState["rename"]>;
  noticeId: string;
  locale: InterfaceLocale;
}) {
  const field = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    if (!field.current?.closest("[hidden], [inert]")) {
      field.current?.focus();
      field.current?.select();
    }
  }, []);
  return (
    <input
      className="chat-rename-field"
      ref={field}
      type="text"
      dir="auto"
      lang=""
      value={rename.text}
      readOnly={rename.busy}
      aria-busy={rename.busy || undefined}
      aria-label={message(locale, "history.name")}
      aria-describedby={rename.notice ? noticeId : undefined}
      aria-invalid={["empty", "spaces", "long"].includes(rename.notice ?? "") || undefined}
      onChange={(event) => {
        controller.editRename(event.currentTarget.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(event) => {
        if (
          composing.current ||
          event.nativeEvent.isComposing ||
          // Chromium can finish native IME composition before delivering this keydown.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          event.keyCode === 229
        )
          return;
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Enter") void controller.saveRename();
        else controller.cancelRename();
      }}
    />
  );
}

export function ConversationRenameNotice({
  rename,
  renamed,
  noticeId,
  locale,
}: {
  rename: ConversationState["rename"];
  renamed: ConversationState["renamed"];
  noticeId: string;
  locale: InterfaceLocale;
}) {
  const notice = rename?.notice;
  const danger = notice === "failed";
  return (
    <>
      {notice && (
        <div className="chat-rename-notice">
          <div
            id={noticeId}
            className={`conversation-notice ${danger ? "danger" : "attention"}`}
            role={danger ? "alert" : "status"}
          >
            <LucideGlyph
              name={
                danger ? "octagon-alert" : notice === "stale" ? "git-compare" : "triangle-alert"
              }
              size={16}
            />
            {notice === "long"
              ? message(locale, "history.rename.long", {
                  excess: Array.from(rename.text).length - 200,
                })
              : message(locale, `history.rename.${notice}`)}
          </div>
        </div>
      )}
      <span className="primitive-announcement" role="status">
        {renamed && <span key={renamed}>{message(locale, "history.renamed")}</span>}
      </span>
    </>
  );
}
