import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type InterfaceLocale,
  message,
  type ProjectRecord,
  type ProjectSummary,
  failure,
} from "../../packages/contracts/dist/index.js";
import { ConversationHeaderButton } from "../../packages/renderer/src/conversation-history.js";
import { ProjectController } from "../../packages/renderer/src/project-controller.js";
import { ProjectSelector } from "../../packages/renderer/src/project-selector.js";
import { WorkspaceSpecimen } from "./workspace-specimen.js";

/** Synthetic project pages exercise the actual window controller without research authority. */
export function ProjectSelectorSpecimen() {
  const params = new URLSearchParams(location.search);
  const historyButton = useRef<HTMLButtonElement>(null);
  const showActivity = params.has("activity");
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  const projects = useMemo(
    () =>
      Array.from({ length: params.has("empty") ? 0 : 95 }, (_, index): ProjectSummary => ({
        needsAttention: showActivity && index === 3,
        id: `019a8000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
        projectType: "thesis",
        title:
          index < 2
            ? null
            : index === 2
              ? "Redes de cuidado en Rosario 연구 ".repeat(5)
              : `Thesis ${String(index + 1)}`,
        subtitle: null,
        titleRevision: 1,
        documentLanguage: index < 2 ? null : "es-AR",
        isDevelopment: false,
        setupConfirmedAt: index < 2 ? null : "2026-11-17T10:00:00.000Z",
        createdAt: `2026-11-17T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
        updatedAt: "2026-11-17T10:00:00.000Z",
        lastOpenedAt: "2026-11-17T10:00:00.000Z",
      })),
    [],
  );
  const [selected, setSelected] = useState<ProjectRecord>();
  const controller = useMemo(
    () =>
      new ProjectController(
        {
          listProjects: ({ cursor, count }) => ({
            cancel() {},
            result: new Promise((resolve) => {
              const start = cursor ? projects.findIndex((row) => row.id === cursor.id) + 1 : 0;
              setTimeout(
                () => {
                  if (params.has("failed") || (cursor && params.has("failedMore"))) {
                    resolve(failure("storage_failed"));
                    return;
                  }
                  const items = projects.slice(start, start + count);
                  const last = items.at(-1);
                  const hasMore = start + items.length < projects.length;
                  resolve({
                    ok: true,
                    value: {
                      items,
                      next:
                        hasMore && last ? { lastOpenedAt: last.lastOpenedAt, id: last.id } : null,
                      hasMore,
                    },
                  });
                },
                params.has("slow") ? 2000 : 0,
              );
            }),
          }),
          listConversations: ({ projectId }) => ({
            cancel() {},
            result: Promise.resolve(
              params.has("openingFailed")
                ? failure("storage_failed")
                : {
                    ok: true,
                    value: {
                      items: [
                        {
                          id: projectId,
                          projectId,
                          title: null,
                          createdAt: "2026-11-17T10:00:00.000Z",
                          updatedAt: "2026-11-17T10:00:00.000Z",
                          revision: 1,
                          agentId: "virgilio",
                          latestAt: "2026-11-17T10:00:00.000Z",
                          ownerRevision: 1,
                          ownerPosition: null,
                          latestPrefix: "",
                          latestTruncated: false,
                          latestLanguage: null,
                          status: null,
                          latestReplyTaskId: null,
                          runningTask: null,
                        },
                      ],
                      next: null,
                      hasMore: false,
                    },
                  },
            ),
          }),
          readProject: () => ({
            cancel() {},
            result: Promise.resolve(failure("unauthorized")),
          }),
          renameProject: () => ({
            cancel() {},
            result: Promise.resolve(failure("unauthorized")),
          }),
          openProject: (_operationId, { projectId }) => ({
            cancel() {},
            result: Promise.resolve({ ok: true, value: { resultId: projectId } }),
          }),
        },
        (scope) => setSelected(projects.find((row) => row.id === scope.projectId)),
      ),
    [projects],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    void controller.initialize(params.has("restore"));
    return () => controller.dispose();
  }, [controller]);
  return (
    <WorkspaceSpecimen
      hasProjects={state.hasProjects}
      project={selected}
      projectScope={selected?.id}
      {...(showActivity
        ? {
            chatActivity: { replies: 12, attention: 1 },
            chatHeadingActions: (
              <ConversationHeaderButton
                buttonRef={historyButton}
                icon="list"
                label={message(locale, "history.show")}
                action={() => {}}
                activity={{ counts: { replies: 2, attention: 1 }, locale }}
              />
            ),
          }
        : {})}
      projectSelector={
        <ProjectSelector
          controller={controller}
          state={state}
          current={selected}
          currentId={selected?.id ?? null}
          locale={locale}
          {...(showActivity
            ? {
                attentionProjects: new Set(
                  projects.filter((row) => row.needsAttention).map((row) => row.id),
                ),
              }
            : {})}
        />
      }
    />
  );
}
