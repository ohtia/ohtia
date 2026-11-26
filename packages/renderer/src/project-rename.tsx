import { useCallback, useId, useRef, type RefObject } from "react";
import { message, type InterfaceLocale } from "@ohtia/contracts";
import type { ProjectController, ProjectRenameDraft, ProjectState } from "./project-controller.js";
import { Dialog } from "./layers.js";

export function ProjectRename({
  available,
  controller,
  draft,
  language,
  locale,
  returnFocusRef,
}: {
  available: boolean;
  controller: ProjectController;
  draft: ProjectRenameDraft | null;
  language?: string | null | undefined;
  locale: InterfaceLocale;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const field = useId();
  const notice = useId();
  const text = draft?.notice;
  const described = !available || !!text;
  const action = draft?.intent
    ? "workspace.check"
    : draft?.needsRevision
      ? "project.reload"
      : "project.rename.save";
  return (
    <Dialog
      open={draft !== null}
      title={message(locale, "command.project.rename")}
      closeLabel={message(locale, "dialog.close")}
      closePlacement="footer"
      closeDisabled={draft?.busy ?? false}
      initialFocus="safe"
      onClose={controller.closeRename}
      returnFocusRef={returnFocusRef}
      footer={
        <button
          type="button"
          className="primitive-button primitive-primary"
          aria-disabled={!available || (draft?.busy ?? false)}
          onClick={() => {
            if (available) void controller.saveRename();
          }}
        >
          {message(locale, action)}
        </button>
      }
    >
      {draft && (
        <form
          className="primitive-field project-rename-form"
          aria-busy={draft.busy || undefined}
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label htmlFor={field}>{message(locale, "project.rename.title")}</label>
          <RenameField
            key={draft.projectId}
            id={field}
            describedBy={described ? notice : undefined}
            draft={draft}
            available={available}
            language={language ?? locale}
            controller={controller}
          />
          {described && (
            <div id={notice} role="status">
              {!available && <p>{message(locale, "project.rename.unavailable")}</p>}
              {text && (
                <p>
                  {message(
                    locale,
                    text === "readFailed" ? "project.loadFailed" : `project.rename.${text}`,
                  )}
                </p>
              )}
              {draft.confirmedTitle && (
                <p>
                  <bdi lang={language ?? locale}>{draft.confirmedTitle}</bdi>
                </p>
              )}
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}

function RenameField({
  available,
  id,
  describedBy,
  draft,
  language,
  controller,
}: {
  available: boolean;
  id: string;
  describedBy: string | undefined;
  draft: ProjectRenameDraft;
  language: string;
  controller: ProjectController;
}) {
  const composition = useRef<"idle" | "active" | "ended">("idle");
  const confirming = useRef(false);
  const selected = useRef(false);
  return (
    <input
      required
      data-safe
      id={id}
      dir="auto"
      lang={language}
      value={draft.text}
      readOnly={draft.busy || !!draft.intent}
      aria-invalid={draft.notice === "invalid" || undefined}
      aria-describedby={describedBy}
      onFocus={(event) => {
        if (selected.current) return;
        selected.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        controller.editRename(event.currentTarget.value);
      }}
      onCompositionStart={() => {
        composition.current = "active";
        confirming.current = false;
      }}
      onCompositionEnd={() => {
        composition.current = "ended";
      }}
      onBlur={() => {
        composition.current = "idle";
        confirming.current = false;
      }}
      onKeyUp={() => {
        if (composition.current === "ended") composition.current = "idle";
        confirming.current = false;
      }}
      onKeyDown={(event) => {
        const phase = composition.current;
        const action = event.key === "Enter" || event.key === "Escape";
        if (
          phase === "active" ||
          event.nativeEvent.isComposing ||
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- IME confirmation can report 229.
          event.keyCode === 229
        ) {
          if (action || event.code === "Enter") confirming.current = true;
          event.stopPropagation();
          return;
        }
        if (phase === "ended") composition.current = "idle";
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        // IBus can send the keydown after compositionend. Process and Enter may share a keyup.
        if (phase === "ended" || confirming.current || event.repeat) return;
        if (event.key === "Escape") controller.closeRename();
        else if (available) void controller.saveRename();
      }}
    />
  );
}

export function ProjectRenameStatus({
  controller,
  state,
  locale,
  returnFocusRef,
}: {
  controller: ProjectController;
  state: ProjectState;
  locale: InterfaceLocale;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const reloadFocus = useCallback(
    (button: HTMLButtonElement | null) => {
      if (!button) return;
      return () => {
        if (button.ownerDocument.activeElement === button) returnFocusRef.current?.focus();
      };
    },
    [returnFocusRef],
  );
  return (
    <>
      <span role="status" className="primitive-announcement">
        {state.renameSaved > 0 && (
          <span key={state.renameSaved}>{message(locale, "project.rename.saved")}</span>
        )}
      </span>
      {state.renameRefreshFailed && (
        <div className="workspace-notice workspace-attention project-rename-refresh">
          <span role="status">
            <span key={state.renameRefreshFailures}>
              {message(locale, "project.rename.refreshFailed")}
            </span>
          </span>
          <button
            type="button"
            className="primitive-button"
            ref={reloadFocus}
            onClick={() => {
              void controller.refreshTitle();
            }}
          >
            {message(locale, "project.reload")}
          </button>
        </div>
      )}
    </>
  );
}
