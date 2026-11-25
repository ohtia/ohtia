import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { message, type InterfaceLocale, type ProjectRecord } from "@ohtia/contracts";
import type { ProjectController, ProjectState } from "./project-controller.js";
import { ActivityBadge } from "./activity-badge.js";
import { LucideGlyph } from "./iconography.js";
import { Tooltip } from "./layers.js";
import "./project-selector.css";

export function ProjectSelector({
  buttonRef,
  controller,
  state,
  current,
  currentId,
  currentFailed = false,
  locale,
  attentionProjects,
}: {
  readonly buttonRef?: RefObject<HTMLButtonElement | null>;
  readonly controller: ProjectController;
  readonly state: ProjectState;
  readonly current: ProjectRecord | undefined;
  readonly currentId: string | null;
  readonly currentFailed?: boolean;
  readonly locale: InterfaceLocale;
  readonly attentionProjects?: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [dismissedRevision, setDismissedRevision] = useState<number>();
  const error = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const localButton = useRef<HTMLButtonElement>(null);
  const button = buttonRef ?? localButton;
  const pendingMore = useRef<number | null>(null);
  const initialHighlight = useRef(true);
  const firstPageRevision = useRef(state.firstPageRevision);
  const openingTarget = useRef<"current" | "first" | "last">("current");
  const typeahead = useRef({ text: "", at: 0 });
  const id = useId();
  const title = (project: ProjectRecord) =>
    project.setupConfirmedAt ? (project.title ?? "") : message(locale, "project.newThesis");
  const value = currentId
    ? !current
      ? message(locale, state.failed || currentFailed ? "project.loadFailed" : "project.loading")
      : current.setupConfirmedAt
        ? (current.title ?? "")
        : message(locale, "setup.context")
    : message(locale, "workspace.noProject");
  const marked =
    !!attentionProjects && [...attentionProjects].some((project) => project !== currentId);
  const count = state.items.length + (state.next || state.failed ? 1 : 0);
  const closedListFailure = !open && state.failed;
  const noticeVisible =
    !open && (state.failed || !!state.openingFailed) && dismissedRevision !== state.failureRevision;
  const failureText = state.failed
    ? message(locale, "project.loadFailed")
    : state.openingFailed
      ? message(locale, "project.openExistingFailed")
      : "";
  const close = () => {
    setDismissedRevision(state.failureRevision);
    setOpen(false);
  };
  const status = state.loading
    ? message(locale, "project.loading")
    : open && state.loadingMore
      ? message(locale, "project.loadingMore")
      : open && state.items.length === 0 && !state.failed
        ? message(locale, "project.none")
        : "";
  const show = (target: "current" | "first" | "last" = "current") => {
    setDismissedRevision(state.failureRevision);
    firstPageRevision.current = state.firstPageRevision + 1;
    openingTarget.current = target;
    initialHighlight.current = true;
    pendingMore.current = null;
    typeahead.current = { text: "", at: 0 };
    setActive(0);
    setOpen(true);
    void controller.load();
  };
  const choose = (index: number) => {
    if (state.loading) return;
    const project = state.items[index];
    if (project) {
      close();
      void controller.open(project.id);
    } else if (index !== state.items.length || state.loadingMore) return;
    else if (state.failed) {
      initialHighlight.current = true;
      openingTarget.current = "current";
      typeahead.current = { text: "", at: 0 };
      void controller.load();
    } else if (state.next) {
      pendingMore.current = state.items.length;
      void controller.load(true);
    }
  };
  useEffect(() => {
    if (!open && !noticeVisible) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, noticeVisible, state.failureRevision]);
  useLayoutEffect(() => {
    if (!open && !noticeVisible) return;
    const position = () => {
      const rect = button.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          top: rect.bottom,
          left: Math.max(0, Math.min(rect.left, window.innerWidth - 360)),
        });
    };
    position();
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("resize", position);
    };
  }, [open, noticeVisible, state.failureRevision]);
  useLayoutEffect(() => {
    if (!noticeVisible) return;
    const dismissCoveredFocus = () => {
      const focused = document.activeElement;
      const box = error.current?.getBoundingClientRect();
      const anchor = button.current?.getBoundingClientRect();
      if (
        !(focused instanceof HTMLElement) ||
        focused === document.body ||
        focused === document.documentElement ||
        !box ||
        !anchor ||
        root.current?.contains(focused) ||
        Math.abs(box.top - anchor.bottom) > 1
      )
        return;
      const rect = focused.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top
      )
        setDismissedRevision(state.failureRevision);
    };
    const dismissOutsideFocus = () => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        focused !== document.body &&
        !root.current?.contains(focused)
      )
        setDismissedRevision(state.failureRevision);
    };
    dismissCoveredFocus();
    document.addEventListener("focusin", dismissOutsideFocus, true);
    window.addEventListener("resize", dismissOutsideFocus);
    return () => {
      document.removeEventListener("focusin", dismissOutsideFocus, true);
      window.removeEventListener("resize", dismissOutsideFocus);
    };
  }, [noticeVisible, position.top, position.left, state.failureRevision]);
  useLayoutEffect(() => {
    if (!open) return;
    if (firstPageRevision.current !== state.firstPageRevision) {
      firstPageRevision.current = state.firstPageRevision;
      pendingMore.current = null;
      initialHighlight.current = true;
      openingTarget.current = "current";
      typeahead.current = { text: "", at: 0 };
      setActive(0);
    }
    if (state.loading) return;
    if (pendingMore.current !== null && !state.loadingMore) {
      if (!state.failedMore) setActive(pendingMore.current);
      pendingMore.current = null;
    } else if (initialHighlight.current && count > 0) {
      initialHighlight.current = false;
      const query = typeahead.current.text;
      const matching = query
        ? state.items.findIndex((row) => title(row).toLocaleLowerCase(locale).startsWith(query))
        : -1;
      setActive(
        openingTarget.current === "last"
          ? count - 1
          : openingTarget.current === "first"
            ? 0
            : Math.max(
                0,
                matching >= 0 ? matching : state.items.findIndex((row) => row.id === currentId),
              ),
      );
    }
  }, [state, open, currentId]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${String(active)}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  const notice = (more: boolean) => (
    <div className="project-selector-notice" role="alert">
      <LucideGlyph name="octagon-alert" size={16} />
      <span>{message(locale, more ? "project.loadMoreFailed" : "project.loadFailed")}</span>
    </div>
  );
  return (
    <div ref={root} className="project-selector-control">
      <span
        id={`${id}-status`}
        className="primitive-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status}
      </span>
      <span id={`${id}-failure`} className="primitive-announcement">
        {failureText}
      </span>
      <Tooltip
        disabled={open || noticeVisible}
        className="workspace-context-tooltip"
        label={value}
        language={current?.documentLanguage ?? locale}
      >
        <button
          ref={button}
          type="button"
          role="combobox"
          className={`project-selector-button${marked ? " activity-badge-control" : ""}`}
          aria-label={message(locale, "project.current")}
          aria-expanded={open}
          aria-busy={state.loading}
          aria-describedby={
            [status ? `${id}-status` : undefined, failureText ? `${id}-failure` : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-haspopup="listbox"
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={
            open && active >= 0 && active < count && !state.loading
              ? `${id}-option-${String(active)}`
              : undefined
          }
          onClick={() => {
            if (open) close();
            else show();
          }}
          onBlur={(event) => {
            if (
              open &&
              (!(event.relatedTarget instanceof Node) ||
                !popup.current?.contains(event.relatedTarget))
            )
              close();
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
            const key = event.key;
            if (key === "Escape" && !open) return;
            if (event.altKey && key === "ArrowUp" && open) {
              event.preventDefault();
              if (state.items[active]) choose(active);
              close();
              return;
            }
            const searchingSpace =
              key === " " &&
              open &&
              typeahead.current.text.length > 0 &&
              performance.now() - typeahead.current.at < 700;
            if (
              !searchingSpace &&
              ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape", "Tab"].includes(key)
            ) {
              if (key !== "Tab") event.preventDefault();
              event.stopPropagation();
              typeahead.current = { text: "", at: 0 };
              if (key === "Escape") close();
              else if (key === "Tab") {
                if (open) {
                  if (state.items[active]) choose(active);
                  close();
                }
              } else if (!open)
                show(
                  key === "End"
                    ? "last"
                    : key === "Home" || key === "ArrowUp"
                      ? "first"
                      : "current",
                );
              else if (key === "Enter" || key === " ") choose(active);
              else if (key === "Home") setActive(0);
              else if (key === "End") setActive(Math.max(0, count - 1));
              else
                setActive((index) =>
                  Math.max(0, Math.min(count - 1, index + (key === "ArrowDown" ? 1 : -1))),
                );
            } else if (key.length === 1 && !event.altKey) {
              event.preventDefault();
              if (!open) show();
              const now = performance.now();
              const previous = now - typeahead.current.at < 700 ? typeahead.current.text : "";
              const text = previous + key.toLocaleLowerCase(locale);
              typeahead.current = { text, at: now };
              const repeated = Array.from(text).every((char) => char === text[0]);
              const prefix = repeated ? key.toLocaleLowerCase(locale) : text;
              const rows = state.items;
              const start = previous && !repeated ? 0 : 1;
              for (let offset = start; offset < rows.length + start; offset++) {
                const index = (active + offset) % rows.length;
                const row = rows[index];
                if (row && title(row).toLocaleLowerCase(locale).startsWith(prefix)) {
                  setActive(index);
                  break;
                }
              }
            }
          }}
        >
          {currentId && <LucideGlyph name="graduation-cap" size={16} />}
          <bdi lang={current?.setupConfirmedAt ? (current.documentLanguage ?? locale) : locale}>
            {value}
          </bdi>
          <LucideGlyph name="arrow-down" size={16} />
          {marked && (
            <>
              <span className="primitive-announcement">
                {message(locale, "activity.otherProject")}
              </span>
              <ActivityBadge variant="attention" />
            </>
          )}
        </button>
      </Tooltip>
      {noticeVisible && (
        <div
          ref={error}
          className="project-selector-open-error"
          style={{ top: position.top, left: position.left }}
        >
          <div className="project-selector-notice" role="alert">
            <LucideGlyph name="octagon-alert" size={16} />
            <span>
              {message(
                locale,
                closedListFailure ? "project.loadFailed" : "project.openExistingFailed",
              )}
            </span>
          </div>
          <div className="project-selector-error-actions">
            <button
              type="button"
              onClick={(event) => {
                if (document.activeElement === event.currentTarget) button.current?.focus();
                if (closedListFailure) void controller.load();
                else if (state.openingFailed) void controller.open(state.openingFailed);
              }}
            >
              {message(locale, closedListFailure ? "project.reload" : "taskNotice.tryAgain")}
            </button>
            <button
              type="button"
              onClick={() => {
                button.current?.focus();
                setDismissedRevision(state.failureRevision);
              }}
            >
              {message(locale, "workspace.dismiss")}
            </button>
          </div>
        </div>
      )}
      {open &&
        createPortal(
          <div
            ref={popup}
            className="project-selector-popup"
            style={{ top: position.top, left: position.left }}
            lang={locale}
            onPointerDown={(event) => {
              event.preventDefault();
            }}
          >
            {state.failed && notice(false)}
            {state.loading && <div aria-hidden="true">{message(locale, "project.loading")}</div>}
            {!state.loading && state.items.length === 0 && !state.failed && (
              <div aria-hidden="true">{message(locale, "project.none")}</div>
            )}
            <div
              role="listbox"
              id={`${id}-list`}
              aria-label={message(locale, "project.current")}
              aria-describedby={status ? `${id}-status` : undefined}
              aria-busy={state.loading || state.loadingMore}
              aria-owns={
                !state.loading && (state.next || state.failed)
                  ? `${id}-option-${String(state.items.length)}`
                  : undefined
              }
            >
              {!state.loading &&
                state.items.map((project, index) => (
                  <div
                    key={project.id}
                    id={`${id}-option-${String(index)}`}
                    role="option"
                    aria-selected={active === index}
                    aria-current={project.id === currentId ? "true" : undefined}
                    title={title(project)}
                    className="project-selector-option"
                    onPointerMove={() => {
                      setActive(index);
                    }}
                    onClick={() => {
                      choose(index);
                    }}
                  >
                    <LucideGlyph name="graduation-cap" size={16} />
                    <span className="project-selector-lines">
                      <bdi
                        lang={
                          project.setupConfirmedAt ? (project.documentLanguage ?? locale) : locale
                        }
                      >
                        {title(project)}
                      </bdi>
                      <span>
                        {project.setupConfirmedAt
                          ? message(locale, "project.type.thesis")
                          : message(locale, "project.settingUp", {
                              created: new Intl.DateTimeFormat(locale, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(project.createdAt)),
                            })}
                        {attentionProjects?.has(project.id) && (
                          <span className="project-selector-attention">
                            <LucideGlyph name="triangle-alert" size={16} />
                            {message(locale, "history.attention")}
                          </span>
                        )}
                      </span>
                    </span>
                    {project.id === currentId && <LucideGlyph name="check" size={16} />}
                  </div>
                ))}
            </div>
            {state.failedMore && notice(true)}
            {!state.loading && (state.next || state.failed) && (
              <div
                role="option"
                id={`${id}-option-${String(state.items.length)}`}
                aria-selected={active === state.items.length}
                aria-disabled={state.loadingMore}
                className="project-selector-option project-selector-more"
                onPointerMove={() => {
                  setActive(state.items.length);
                }}
                onClick={() => {
                  choose(state.items.length);
                }}
              >
                {message(locale, state.failed ? "project.reload" : "project.more")}
              </div>
            )}
            <div aria-hidden="true">
              {state.loadingMore ? message(locale, "project.loadingMore") : ""}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
