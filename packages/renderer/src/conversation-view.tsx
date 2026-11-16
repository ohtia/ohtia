import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { message, type CommandBridge, type InterfaceLocale } from "@ohtia/contracts";
import { MessageMarkdown } from "./research-presentation.js";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { Tooltip } from "./layers.js";
import type { ConversationController, ConversationState } from "./conversation-controller.js";
import "./conversation.css";

export function ConversationView({
  state,
  controller,
  locale,
  commands,
}: {
  readonly state: ConversationState;
  readonly controller: Pick<ConversationController, "reload" | "loadEarlier">;
  readonly locale: InterfaceLocale;
  readonly commands: Pick<CommandBridge, "copyMessage" | "openExternalLink">;
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
                    <MessageMarkdown
                      text={
                        item.kind === "message"
                          ? (state.texts.get(item.id) ?? "")
                          : (state.replies.get(item.id)?.text ?? "")
                      }
                      locale={locale}
                      language={item.language ?? undefined}
                      openExternalLink={commands.openExternalLink}
                    />
                  </div>
                  {streaming ? (
                    <div className="conversation-writing" aria-hidden="true">
                      <LucideGlyph name="pen-line" size={16} />
                      {message(locale, "conversation.writing", { agent: "Virgilio" })}
                    </div>
                  ) : (
                    <SavedMessageActions
                      key={`${id ?? ""}/${item.id}`}
                      messageId={item.id}
                      locale={locale}
                      commands={commands}
                    />
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

function SavedMessageActions({
  messageId,
  locale,
  commands,
}: {
  readonly messageId: string;
  readonly locale: InterfaceLocale;
  readonly commands: Pick<CommandBridge, "copyMessage">;
}) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const pending = useRef(false);
  const alive = useRef(true);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (feedbackTimer.current !== undefined) clearTimeout(feedbackTimer.current);
    };
  }, []);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    if (feedbackTimer.current !== undefined) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = undefined;
    setStatus("copying");
    let copied = false;
    try {
      copied = await commands.copyMessage(messageId);
    } catch {
      /* The failure notice offers manual copying. */
    }
    pending.current = false;
    if (!alive.current) return;
    setStatus(copied ? "copied" : "failed");
    if (copied)
      feedbackTimer.current = setTimeout(() => {
        feedbackTimer.current = undefined;
        setStatus("idle");
      }, 5000);
  }
  return (
    <div className="conversation-saved-actions" lang={locale} dir="auto">
      <div className="conversation-actions">
        <Tooltip label={message(locale, "conversation.copyMessage")}>
          <button
            type="button"
            className="primitive-button primitive-quiet"
            aria-label={message(locale, "conversation.copyMessage")}
            aria-disabled={status === "copying" || undefined}
            onClick={() => {
              void copy();
            }}
          >
            <LucideGlyph name="copy" size={16} />
          </button>
        </Tooltip>
        <span className="conversation-copy-status" role="status" aria-atomic="true">
          {status === "copied" && (
            <>
              <LucideGlyph name="clipboard-check" size={16} />
              {message(locale, "conversation.copied")}
            </>
          )}
        </span>
      </div>
      {status === "failed" && (
        <div className="conversation-notice danger" role="alert">
          <LucideGlyph name="octagon-alert" size={16} />
          <span>{message(locale, "conversation.copyFailed")}</span>
        </div>
      )}
    </div>
  );
}
