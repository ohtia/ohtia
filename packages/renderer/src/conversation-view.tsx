import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { message, type InterfaceLocale } from "@ohtia/contracts";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { Tooltip } from "./layers.js";
import type { ConversationController, ConversationState } from "./conversation-controller.js";
import "./conversation.css";

export function ConversationView({
  state,
  controller,
  locale,
}: {
  readonly state: ConversationState;
  readonly controller: ConversationController;
  readonly locale: InterfaceLocale;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchors = useRef(new Map<string, { top: number; follow: boolean }>());
  const anchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const previous = useRef<string | null>(null);
  const earlierTrigger = useRef<
    { button: HTMLButtonElement; conversation: string | null } | undefined
  >(undefined);
  const [jump, setJump] = useState(false);
  const id = state.scope.conversationId;
  const completion = useRef({ id, count: state.completed });
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  useEffect(() => {
    const previous = completion.current;
    if (previous.id !== id) setAnnouncement({ text: "", count: 0 });
    else if (state.completed > previous.count)
      setAnnouncement({
        text: message(locale, "conversation.replied", { agent: "Virgilio" }),
        count: state.completed,
      });
    completion.current = { id, count: state.completed };
  }, [id, state.completed, locale]);
  const remember = () => {
    const element = viewport.current;
    if (!element || !id) return;
    anchors.current.set(id, { top: element.scrollTop, follow: follow.current });
    const first = [...element.querySelectorAll<HTMLElement>("[data-timeline-id]")].find(
      (item) => item.offsetTop + item.offsetHeight > element.scrollTop,
    );
    anchor.current = first
      ? { id: first.dataset.timelineId ?? "", offset: first.offsetTop - element.scrollTop }
      : undefined;
  };
  const restoreReading = () => {
    const element = viewport.current;
    if (!element || state.status !== "ready" || element.closest("[hidden], [inert]")) return;
    if (previous.current !== id) {
      previous.current = id;
      anchor.current = undefined;
      const saved = id ? anchors.current.get(id) : undefined;
      follow.current = saved?.follow ?? true;
      element.scrollTop = saved?.top ?? element.scrollHeight;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
    else if (anchor.current) {
      const item = [...element.querySelectorAll<HTMLElement>("[data-timeline-id]")].find(
        (item) => item.dataset.timelineId === anchor.current?.id,
      );
      if (item) element.scrollTop = item.offsetTop - anchor.current.offset;
    }
    setJump(!follow.current);
    remember();
  };
  const restore = useRef(restoreReading);
  restore.current = restoreReading;
  useLayoutEffect(() => {
    restore.current();
    const trigger = earlierTrigger.current;
    if (!trigger || state.loadingEarlier) return;
    earlierTrigger.current = undefined;
    const active = document.activeElement;
    if (
      trigger.conversation === id &&
      state.next === null &&
      state.status === "ready" &&
      (active === trigger.button || active === document.body) &&
      !viewport.current?.closest("[hidden], [inert]")
    )
      viewport.current?.focus({ preventScroll: true });
  });
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      restore.current();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [state.status]);
  const notice = (text: string, danger = false) => (
    <div
      className={`conversation-notice ${danger ? "danger" : "attention"}`}
      role={danger ? "alert" : "status"}
    >
      <LucideGlyph name={danger ? "octagon-alert" : "triangle-alert"} size={16} />
      <span>{text}</span>
    </div>
  );
  return (
    <div className="conversation-view">
      {state.status === "unavailable" ? (
        notice(message(locale, "conversation.unavailable"))
      ) : state.status === "failed" ? (
        <div className="conversation-state">
          {notice(message(locale, "conversation.failed"), true)}
          <button type="button" className="primitive-button" onClick={controller.reload}>
            {message(locale, "conversation.reload")}
          </button>
        </div>
      ) : state.status === "loading" ? (
        <div className="conversation-state" aria-busy="true">
          <p role="status">{message(locale, "conversation.loading")}</p>
          <div className="conversation-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : (
        <>
          <div
            className="conversation-timeline"
            ref={viewport}
            tabIndex={0}
            role="region"
            aria-label={message(locale, "command.panels.chat")}
            onScroll={() => {
              const element = viewport.current;
              if (!element) return;
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 2;
              setJump(!follow.current);
              remember();
            }}
          >
            {state.next && (
              <div className="conversation-earlier">
                {state.failedEarlier && notice(message(locale, "conversation.earlierFailed"), true)}
                <button
                  type="button"
                  className="primitive-button"
                  disabled={state.loadingEarlier}
                  onClick={(event) => {
                    earlierTrigger.current = { button: event.currentTarget, conversation: id };
                    remember();
                    controller.loadEarlier();
                  }}
                >
                  {message(locale, "conversation.earlier")}
                </button>
                <p role="status">
                  {state.loadingEarlier ? message(locale, "conversation.earlierLoading") : ""}
                </p>
              </div>
            )}
            {!state.items.some((item) => item.kind === "message") && state.replies.size === 0 && (
              <p className="conversation-empty">{message(locale, "conversation.empty")}</p>
            )}
            {state.items.map((item) => {
              const streaming =
                item.kind === "task" &&
                (item.state === "running" || item.state === "cancelling") &&
                !state.items.some((saved) => saved.kind === "message" && saved.taskId === item.id);
              if (item.kind === "task" && !streaming) return null;
              const researcher = item.kind === "message" && item.authorKind === "researcher";
              return (
                <article
                  key={item.id}
                  data-timeline-id={item.id}
                  className={`conversation-message ${researcher ? "researcher" : "agent"}`}
                  aria-label={researcher ? message(locale, "conversation.you") : "Virgilio"}
                  aria-busy={streaming || undefined}
                >
                  {!researcher && (
                    <VoiceLabel
                      identity={{ kind: "ai", contributor: "virgilio", definitionVersion: "1" }}
                      locale={locale}
                    />
                  )}
                  <div className="conversation-text" lang={item.language ?? ""} dir="auto">
                    {item.kind === "message"
                      ? (state.texts.get(item.id) ?? "")
                      : (state.replies.get(item.id)?.text ?? "")}
                  </div>
                  {streaming ? (
                    <div className="conversation-writing" aria-hidden="true">
                      <LucideGlyph name="pen-line" size={16} />
                      {message(locale, "conversation.writing", { agent: "Virgilio" })}
                    </div>
                  ) : (
                    <div className="conversation-actions" />
                  )}
                </article>
              );
            })}
          </div>
          <div className="conversation-jump-place">
            {jump && (
              <Tooltip label={message(locale, "conversation.latest")}>
                <button
                  type="button"
                  className="conversation-jump"
                  aria-label={message(locale, "conversation.latest")}
                  onClick={() => {
                    follow.current = true;
                    if (viewport.current)
                      viewport.current.scrollTop = viewport.current.scrollHeight;
                    setJump(false);
                    remember();
                  }}
                >
                  <LucideGlyph name="arrow-down" size={20} />
                </button>
              </Tooltip>
            )}
          </div>
        </>
      )}
      <p className="primitive-announcement" role="status" aria-live="polite" aria-atomic="true">
        <span key={announcement.count}>{announcement.text}</span>
      </p>
    </div>
  );
}
