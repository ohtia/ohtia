import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { message, type InterfaceLocale, type ProjectRecord } from "@ohtia/contracts";
import { conversationName } from "./conversation-history.js";
import { LucideGlyph } from "./iconography.js";
import type { ProjectCollections } from "./project-controller.js";

type Group = "conversations" | "materials";
const initialGroups = { conversations: false, materials: true };

export function ProjectExplorer({
  collections,
  project,
  locale,
  memoryAvailable,
  memorySelected,
  openMemory,
  revealChat,
}: {
  readonly collections: ProjectCollections;
  readonly project: ProjectRecord | undefined;
  readonly locale: InterfaceLocale;
  readonly memoryAvailable: boolean;
  readonly memorySelected: boolean;
  readonly openMemory: () => void;
  readonly revealChat: () => void;
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
    <div className="project-explorer">
      {project?.id === projectId && (
        <p className="project-explorer-title">
          <bdi lang={confirmed ? (project.documentLanguage ?? "") : locale}>
            {confirmed ? project.title : message(locale, "setup.context")}
          </bdi>
        </p>
      )}
      <ul className="project-explorer-list" role="list">
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
              <span aria-hidden="true">{groups.conversations ? "▾" : "▸"}</span>
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
            <span aria-hidden="true">{groups.materials ? "▾" : "▸"}</span>
            {message(locale, "workspace.materials")}
          </button>
          <div className="project-explorer-group" id={`${id}-materials`} hidden={!groups.materials}>
            <p className="project-explorer-status">{message(locale, "setup.explorer")}</p>
          </div>
        </li>
      </ul>
    </div>
  );
}
