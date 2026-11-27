import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { message, type InterfaceLocale, type ProjectRecord } from "@ohtia/contracts";
import { conversationName } from "./conversation-history.js";
import { LucideGlyph } from "./iconography.js";
import { Tooltip } from "./layers.js";
import type { ProjectCollections } from "./project-controller.js";
import {
  foldableBranches,
  manuscriptBranches,
  manuscriptPath,
  type ManuscriptBranch,
  type ManuscriptOutline,
} from "./manuscript-outline.js";
import type { useManuscripts } from "./manuscript-view.js";

type Group = "conversations" | "materials";
const initialGroups = { conversations: false, materials: true };

interface OutlineControls {
  readonly collapsed: ReadonlySet<string> | undefined;
  readonly current: string | undefined;
  /** Ancestors of the reading heading, drawn as the path to the current location. */
  readonly path: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
  readonly locale: InterfaceLocale;
  readonly language: string | undefined;
  readonly prefix: string;
}

function OutlineDisclosure({
  branch,
  title,
  controls,
}: {
  readonly branch: string;
  readonly title: string;
  readonly controls: OutlineControls;
}) {
  const expanded = !controls.collapsed?.has(branch);
  const label = message(controls.locale, "manuscript.toggleOutline", { title });
  return (
    <Tooltip label={label} className="manuscript-outline-control">
      <button
        type="button"
        className="primitive-button primitive-quiet manuscript-outline-disclosure"
        aria-expanded={expanded}
        aria-controls={`${controls.prefix}-${branch}`}
        aria-label={label}
        onClick={() => {
          controls.toggle(branch);
        }}
      >
        <LucideGlyph name={expanded ? "chevron-down" : "chevron-right"} size={16} />
      </button>
    </Tooltip>
  );
}

function ChapterLinks({
  entries,
  disabled,
  open,
  controls,
}: {
  readonly entries: readonly ManuscriptBranch[];
  readonly disabled: boolean;
  readonly open: ((headingId?: string) => void) | undefined;
  readonly controls: OutlineControls;
}) {
  return (
    <ul className="project-explorer-list manuscript-chapters" role="list">
      {entries.map(({ heading, children }) => {
        const current = controls.current === heading.id;
        return (
          <li key={heading.id} data-level={heading.level}>
            <div
              className="manuscript-outline-row"
              data-current={current ? "true" : undefined}
              data-path={!current && controls.path.has(heading.id) ? "true" : undefined}
            >
              <button
                type="button"
                className="manuscript-outline-heading primitive-button primitive-quiet"
                data-heading={heading.id}
                data-emphasis={
                  heading.level === 2 || current || controls.path.has(heading.id) || undefined
                }
                aria-current={current ? "location" : undefined}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (!disabled) open?.(heading.id);
                }}
              >
                <bdi lang={controls.language ?? ""}>{heading.text}</bdi>
              </button>
              {children.length > 0 && (
                <OutlineDisclosure branch={heading.id} title={heading.text} controls={controls} />
              )}
            </div>
            {children.length > 0 && (
              <div
                id={`${controls.prefix}-${heading.id}`}
                hidden={controls.collapsed?.has(heading.id)}
              >
                <ChapterLinks
                  entries={children}
                  disabled={disabled}
                  open={open}
                  controls={controls}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OutlineTool({
  label,
  icon,
  onPress,
}: {
  readonly label: string;
  readonly icon: "locate-fixed" | "chevrons-down-up";
  readonly onPress: () => void;
}) {
  return (
    <Tooltip label={label} className="manuscript-outline-control">
      <button
        type="button"
        className="primitive-button primitive-quiet manuscript-outline-tool"
        aria-label={label}
        onClick={onPress}
      >
        <LucideGlyph name={icon} size={16} />
      </button>
    </Tooltip>
  );
}

function GroupDisclosureGlyph({ expanded }: { readonly expanded: boolean }) {
  return (
    <span className="project-explorer-chevron">
      <LucideGlyph name={expanded ? "chevron-down" : "chevron-right"} size={16} />
    </span>
  );
}

export function ProjectExplorer({
  collections,
  project,
  locale,
  memoryAvailable,
  memorySelected,
  openMemory,
  revealChat,
  manuscripts,
  manuscriptSelected,
  headings,
  activeHeading,
  headingLanguage,
  openManuscript,
}: {
  readonly collections: ProjectCollections;
  readonly project: ProjectRecord | undefined;
  readonly locale: InterfaceLocale;
  readonly memoryAvailable: boolean;
  readonly memorySelected: boolean;
  readonly openMemory: () => void;
  readonly revealChat: () => void;
  readonly manuscripts?: ReturnType<typeof useManuscripts> | undefined;
  readonly manuscriptSelected?: boolean | undefined;
  readonly headings?: ManuscriptOutline | undefined;
  readonly activeHeading?: string | undefined;
  /** Writing language of the manuscript revision that supplied the headings. */
  readonly headingLanguage?: string | undefined;
  readonly openManuscript?: (headingId?: string) => void;
}) {
  const { scope, conversations } = useSyncExternalStore(
    collections.subscribe,
    collections.snapshot,
  );
  const { projectId, conversationId } = scope;
  const confirmed = project?.id === projectId && !!project.setupConfirmedAt;
  const [expanded, setExpanded] = useState<ReadonlyMap<string, typeof initialGroups>>(
    () => new Map(),
  );
  const groups = (projectId && expanded.get(projectId)) || initialGroups;
  const id = useId();
  const outlineId = manuscripts?.rows[0]?.draftId;
  const [foldedOutline, setFoldedOutline] = useState<ReadonlyMap<string, ReadonlySet<string>>>(
    () => new Map(),
  );
  const collapsed = outlineId ? foldedOutline.get(outlineId) : undefined;
  const branches = headings ? manuscriptBranches(headings) : [];
  const path = activeHeading ? manuscriptPath(branches, activeHeading) : [];
  const visibleHeading = collapsed?.has("root")
    ? "root"
    : ((path.find(({ heading }) => collapsed?.has(heading.id)) ?? path.at(-1))?.heading.id ??
      "root");
  function fold(update: (previous: ReadonlySet<string>) => ReadonlySet<string>) {
    if (!outlineId) return;
    setFoldedOutline((previous) =>
      new Map(previous).set(outlineId, update(previous.get(outlineId) ?? new Set())),
    );
  }
  const ancestors = path.slice(0, -1).map(({ heading }) => heading.id);
  const outlineControls: OutlineControls = {
    collapsed,
    current: manuscriptSelected ? visibleHeading : undefined,
    path: new Set(manuscriptSelected ? ancestors : []),
    prefix: `${id}-manuscript-outline`,
    locale,
    language: headingLanguage,
    toggle(branch) {
      fold((previous) => {
        const next = new Set(previous);
        if (next.has(branch)) next.delete(branch);
        else next.add(branch);
        return next;
      });
    },
  };
  const explorerRoot = useRef<HTMLDivElement>(null);
  const reveal = useRef(false);
  function showCurrent() {
    fold((previous) => {
      const next = new Set(previous);
      next.delete("root");
      for (const ancestor of ancestors) next.delete(ancestor);
      return next;
    });
    reveal.current = true;
  }
  function foldAll() {
    fold(() => new Set(foldableBranches(branches)));
  }
  useLayoutEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    const target = activeHeading ?? "root";
    [...(explorerRoot.current?.querySelectorAll<HTMLElement>("[data-heading]") ?? [])]
      .find((element) => element.dataset.heading === target)
      ?.scrollIntoView({ block: "nearest" });
  });

  const manuscriptDisclosure = useRef<HTMLButtonElement>(null);
  const disclosure = useRef<HTMLButtonElement>(null);
  const pageTrigger = useRef<HTMLButtonElement>(null);
  const pageFocus = useRef<{ readonly projectId: string; readonly trigger: HTMLButtonElement }>(
    null,
  );

  useEffect(() => {
    if (projectId && confirmed && groups.conversations)
      collections.loadConversations(projectId, "initial");
  }, [collections, confirmed, conversations?.projectId, groups.conversations, projectId]);

  useLayoutEffect(() => {
    const intent = pageFocus.current;
    if (!intent) return;
    if (intent.projectId === projectId && conversations?.loadingOlder && groups.conversations)
      return;
    pageFocus.current = null;
    if (
      intent.projectId === projectId &&
      !intent.trigger.isConnected &&
      document.activeElement === document.body
    )
      disclosure.current?.focus();
  }, [conversations, groups.conversations, projectId]);

  if (!projectId)
    return <p className="workspace-empty">{message(locale, "workspace.explorerEmpty")}</p>;

  function toggle(group: Group) {
    if (!projectId) return;
    setExpanded((previous) => {
      const current = previous.get(projectId) ?? initialGroups;
      return new Map(previous).set(projectId, { ...current, [group]: !current[group] });
    });
  }

  const status = conversations?.status ?? "loading";
  const failed = status === "failed";
  const failedMore = status === "ready" && conversations?.failedOlder;
  const loadingMore = conversations?.loadingOlder === true;
  const rows = status === "ready" ? (conversations?.items ?? []) : [];
  return (
    <div className="project-explorer" ref={explorerRoot}>
      {project?.id === projectId && (
        <p className="project-explorer-title">
          <bdi lang={confirmed ? (project.documentLanguage ?? "") : locale}>
            {confirmed ? project.title : message(locale, "setup.context")}
          </bdi>
        </p>
      )}
      <ul className="project-explorer-list" role="list">
        {manuscripts && (
          <li>
            <div
              className="manuscript-outline-row manuscript-outline-root"
              data-current={outlineControls.current === "root" ? "true" : undefined}
            >
              <button
                type="button"
                ref={manuscriptDisclosure}
                className="manuscript-outline-heading primitive-button primitive-quiet"
                data-heading="root"
                aria-current={outlineControls.current === "root" ? "location" : undefined}
                aria-disabled={!manuscripts.verifiedScope || undefined}
                onClick={() => openManuscript?.()}
              >
                <LucideGlyph name="file-text" size={16} />
                {message(locale, "manuscript.collection")}
              </button>
              {headings && headings.length > 0 && (
                <>
                  <OutlineTool
                    label={message(locale, "manuscript.showCurrent")}
                    icon="locate-fixed"
                    onPress={showCurrent}
                  />
                  <OutlineTool
                    label={message(locale, "manuscript.foldAll")}
                    icon="chevrons-down-up"
                    onPress={foldAll}
                  />
                  <OutlineDisclosure
                    branch="root"
                    title={message(locale, "manuscript.collection")}
                    controls={outlineControls}
                  />
                </>
              )}
            </div>
            <div className="project-explorer-group manuscript-outline-group">
              <p className="project-explorer-status" role="status">
                {manuscripts.status === "loading" && message(locale, "project.loading")}
                {manuscripts.status === "failed" && message(locale, "manuscript.listFailed")}
                {manuscripts.status === "unavailable" && message(locale, "manuscript.unavailable")}
                {manuscripts.status === "ready" &&
                  manuscripts.rows.length === 0 &&
                  message(locale, "manuscript.none")}
              </p>
              {manuscripts.scope &&
                (manuscripts.status === "failed" || manuscripts.status === "unavailable") && (
                  <button
                    type="button"
                    className="primitive-button"
                    onClick={() => {
                      manuscriptDisclosure.current?.focus();
                      manuscripts.retry();
                    }}
                  >
                    {message(locale, "taskNotice.tryAgain")}
                  </button>
                )}
              {headings && headings.length > 0 && (
                <div
                  className="manuscript-outline"
                  id={`${outlineControls.prefix}-root`}
                  hidden={outlineControls.collapsed?.has("root")}
                >
                  <ChapterLinks
                    entries={branches}
                    disabled={!manuscripts.verifiedScope}
                    open={openManuscript}
                    controls={outlineControls}
                  />
                </div>
              )}
            </div>
          </li>
        )}
        {memoryAvailable && (
          <li>
            <button
              type="button"
              className="project-explorer-control primitive-button primitive-quiet"
              aria-current={memorySelected || undefined}
              onClick={openMemory}
            >
              <LucideGlyph name="notebook-text" size={16} />
              {message(locale, "memory.title")}
              {memorySelected && <LucideGlyph name="check" size={16} />}
            </button>
          </li>
        )}
      </ul>
      <ul className="project-explorer-list project-explorer-materials" role="list">
        <li>
          <button
            type="button"
            className="project-explorer-control primitive-button primitive-quiet"
            aria-expanded={groups.materials}
            aria-controls={`${id}-materials`}
            onClick={() => {
              toggle("materials");
            }}
          >
            <GroupDisclosureGlyph expanded={groups.materials} />
            <LucideGlyph name="folder" size={16} />
            {message(locale, "workspace.materials")}
          </button>
          <div className="project-explorer-group" id={`${id}-materials`} hidden={!groups.materials}>
            <p className="project-explorer-status">{message(locale, "setup.explorer")}</p>
          </div>
        </li>
        {confirmed && (
          <li>
            <button
              type="button"
              className="project-explorer-control primitive-button primitive-quiet"
              aria-expanded={groups.conversations}
              aria-controls={`${id}-conversations`}
              ref={disclosure}
              onClick={() => {
                toggle("conversations");
              }}
            >
              <GroupDisclosureGlyph expanded={groups.conversations} />
              <LucideGlyph name="messages-square" size={16} />
              {message(locale, "history.title")}
            </button>
            <div
              className="project-explorer-group"
              id={`${id}-conversations`}
              hidden={!groups.conversations}
            >
              {groups.conversations && (
                <>
                  <p role="status" className="project-explorer-status">
                    {status === "loading"
                      ? message(locale, "history.loading")
                      : status === "unavailable"
                        ? message(locale, "conversation.unavailable")
                        : loadingMore
                          ? message(locale, "history.olderLoading")
                          : status === "ready" && rows.length === 0
                            ? message(locale, "history.noConversations")
                            : null}
                  </p>
                  {!!rows.length && (
                    <ul
                      className="project-explorer-list"
                      aria-busy={loadingMore || undefined}
                      role="list"
                    >
                      {rows.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="project-explorer-control primitive-button primitive-quiet"
                            aria-current={row.id === conversationId || undefined}
                            onClick={() => {
                              if (collections.openConversation(projectId, row.id)) revealChat();
                            }}
                          >
                            <bdi lang={row.title ? "" : locale}>
                              {conversationName(row, locale)}
                            </bdi>
                            {row.id === conversationId && <LucideGlyph name="check" size={16} />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(failed || failedMore) && (
                    <p className="conversation-notice danger" role="alert">
                      <LucideGlyph name="octagon-alert" size={16} />
                      {message(locale, failed ? "history.failed" : "history.olderFailed")}
                    </p>
                  )}
                  {failed && (
                    <button
                      type="button"
                      className="primitive-button"
                      onClick={() => {
                        disclosure.current?.focus();
                        collections.loadConversations(projectId, "retry");
                      }}
                    >
                      {message(locale, "history.reload")}
                    </button>
                  )}
                  {status === "ready" && conversations?.next && (
                    <button
                      type="button"
                      className="primitive-button"
                      ref={pageTrigger}
                      aria-disabled={loadingMore || undefined}
                      onClick={() => {
                        if (loadingMore) return;
                        const trigger = pageTrigger.current;
                        if (trigger && document.activeElement === trigger)
                          pageFocus.current = { projectId, trigger };
                        collections.loadConversations(projectId, "older");
                      }}
                    >
                      {message(locale, "history.loadOlder")}
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
