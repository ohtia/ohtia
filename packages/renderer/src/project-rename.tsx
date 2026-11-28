import { useCallback, useId, useRef, type RefObject } from "react";
import { message, projectTitleError, type InterfaceLocale } from "@ohtia/contracts";
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
  const subtitleField = useId();
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
            field="title"
            available={available}
            language={language ?? locale}
            controller={controller}
          />
          <label htmlFor={subtitleField}>{message(locale, "project.rename.subtitle")}</label>
          <RenameField
            key={`${draft.projectId}:subtitle`}
            id={subtitleField}
            describedBy={described ? notice : undefined}
            draft={draft}
            field="subtitle"
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
              {draft.confirmedSubtitle && (
                <p>
                  <bdi lang={language ?? locale}>{draft.confirmedSubtitle}</bdi>
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
  field,
  language,
  controller,
}: {
  available: boolean;
  id: string;
  describedBy: string | undefined;
  draft: ProjectRenameDraft;
  field: "title" | "subtitle";
  language: string;
  controller: ProjectController;
}) {
  const composition = useRef<"idle" | "active" | "ended">("idle");
  const confirming = useRef(false);
  const selected = useRef(false);
  const value = field === "title" ? draft.text : draft.subtitle;
  // The subtitle is optional: only a non-empty invalid value marks it. Otherwise the title does.
  const subtitleInvalid = draft.subtitle !== "" && !!projectTitleError(draft.subtitle);
  const invalid =
    draft.notice === "invalid" &&
    (field === "subtitle" ? subtitleInvalid : !!projectTitleError(draft.text) || !subtitleInvalid);
  return (
    <input
      required={field === "title"}
      data-safe={(field === "subtitle") === (draft.focus === "subtitle") || undefined}
      id={id}
      dir="auto"
      lang={language}
      value={value}
      readOnly={draft.busy || !!draft.intent}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onFocus={(event) => {
        if (selected.current) return;
        selected.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        controller.editRename(event.currentTarget.value, field);
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
