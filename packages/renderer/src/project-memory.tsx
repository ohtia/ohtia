import { useLayoutEffect, useRef, useState } from "react";
import {
  message,
  type InterfaceLocale,
  type TimelineMemoryChange,
  type TimelineMemoryReview,
} from "@ohtia/contracts";
import type { ConversationController } from "./conversation-controller.js";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";

type Undo = ConversationController["performMemoryUndo"];
type Feedback = "memory.undoUnavailable" | "memory.full" | "memory.undoFailed" | "memory.undone";

export function MemoryChangeLine({
  item,
  locale,
  undo,
  showVoice,
}: {
  readonly item: TimelineMemoryChange;
  readonly locale: InterfaceLocale;
  readonly undo: Undo | undefined;
  readonly showVoice: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const intent = useRef<string | null>(null);
  const restoreFocus = useRef(false);
  const line = useRef<HTMLParagraphElement>(null);
  const counts = (["added", "edited", "merged", "withdrawn"] as const)
    .filter((action) => item[action] > 0)
    .map((action) => message(locale, `memory.${action}`, { count: item[action] }));
  const canUndo = item.canUndo && feedback !== "memory.undone";
  useLayoutEffect(() => {
    if (!canUndo && restoreFocus.current && document.activeElement === document.body) {
      line.current?.focus();
      restoreFocus.current = false;
    }
  }, [canUndo]);

  async function performUndo() {
    if (busy || !undo) return;
    const operationId = intent.current ?? crypto.randomUUID();
    intent.current = operationId;
    setBusy(true);
    setFeedback(null);
    const result = await undo(operationId, item.taskId, item.id);
    setBusy(false);
    if (result.ok) {
      setFeedback("memory.undone");
      return;
    }
    if (result.error.code !== "uncertain") intent.current = null;
    setFeedback(
      result.error.code === "undo_unavailable"
        ? "memory.undoUnavailable"
        : result.error.code === "memory_full"
          ? "memory.full"
          : "memory.undoFailed",
    );
  }
  return (
    <div className="memory-reply" data-timeline-id={item.id}>
      {showVoice && (
        <VoiceLabel
          identity={{ kind: "ai", contributor: "virgilio", definitionVersion: "1" }}
          locale={locale}
        />
      )}
      {counts.length > 0 && (
        <p className="memory-caption" data-type="type.ui.caption" ref={line} tabIndex={-1}>
          <LucideGlyph name="notebook-pen" size={16} />
          <span>
            {message(locale, "memory.updated", {
              changes: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
                counts,
              ),
            })}
          </span>
        </p>
      )}
      {item.rejected > 0 && (
        <p className="memory-caption memory-rejection" data-type="type.ui.caption">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>{message(locale, "memory.rejected", { count: item.rejected })}</span>
        </p>
      )}
      {feedback && feedback !== "memory.undone" && (
        <div className="conversation-notice attention" role="status">
          <LucideGlyph
            name={feedback === "memory.undoUnavailable" ? "git-compare" : "triangle-alert"}
            size={16}
          />
          <span>{message(locale, feedback)}</span>
        </div>
      )}
      {canUndo && undo && (
        <button
          className="primitive-button memory-undo"
          type="button"
          aria-disabled={busy}
          onClick={(event) => {
            restoreFocus.current = document.activeElement === event.currentTarget;
            void performUndo();
          }}
        >
          {message(locale, "memory.undo")}
        </button>
      )}
      <span className="primitive-announcement" role="status">
        {feedback === "memory.undone" ? message(locale, feedback) : ""}
      </span>
    </div>
  );
}

export function MemoryReviewLine({
  item,
  locale,
}: {
  readonly item: TimelineMemoryReview;
  readonly locale: InterfaceLocale;
}) {
  return (
    <p className="memory-caption" data-type="type.ui.caption" data-timeline-id={item.id}>
      <LucideGlyph name="refresh-cw" size={16} />
      <span>{message(locale, "memory.review")}</span>
    </p>
  );
}
