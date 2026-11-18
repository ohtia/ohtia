import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  type InterfaceLocale,
  type ProjectRecord,
  failure,
} from "../../packages/contracts/dist/index.js";
import { ProjectController } from "../../packages/renderer/src/project-controller.js";
import { ProjectSelector } from "../../packages/renderer/src/project-selector.js";
import { WorkspaceSpecimen } from "./workspace-specimen.js";

/** Synthetic project pages exercise the actual window controller without research authority. */
export function ProjectSelectorSpecimen() {
  const params = new URLSearchParams(location.search);
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  const projects = useMemo(
    () =>
      Array.from({ length: params.has("empty") ? 0 : 95 }, (_, index): ProjectRecord => ({
        id: `019a8000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
        projectType: "thesis",
        title:
          index < 2
            ? null
            : index === 2
              ? "Redes de cuidado en Rosario 연구 ".repeat(5)
              : `Thesis ${String(index + 1)}`,
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
      projectSelector={
        <ProjectSelector
          controller={controller}
          state={state}
          current={selected}
          currentId={selected?.id ?? null}
          locale={locale}
        />
      }
    />
  );
}
