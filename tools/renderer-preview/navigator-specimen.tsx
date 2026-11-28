import { useLayoutEffect, useState } from "react";
import {
  projectWorkflows,
  researchStages,
  stageAction,
  type ResearchStageId,
} from "../../packages/contracts/dist/index.js";
import { NavigatorView } from "../../packages/renderer/src/navigator-view.js";
import type { NavigatorState } from "../../packages/renderer/src/navigator-controller.js";

const origin = { kind: "researcher_statement" } as const;
const projectId = "catalog-project";
const entry = { stageId: "onboarding" as const, decisionId: "catalog-record", revision: 1 };
const stages: NavigatorState = {
  projectId,
  reading: false,
  readFailed: false,
  stages: new Map(
    researchStages.map((stageId: ResearchStageId) => {
      const started = stageId === "onboarding";
      const state = started ? "in-progress" : "not-started";
      return [
        stageId,
        {
          snapshot: {
            projectId,
            stageId,
            state,
            revision: started ? 1 : 0,
            decisionId: started ? "catalog-record" : null,
            profileRevisionId: null,
            enter: stageAction(stageId, state, "not-started"),
            reopen: stageAction(stageId, state, "done"),
            latestEntry: entry,
          },
          latest: started
            ? {
                ...entry,
                projectId,
                operationId: "catalog-operation",
                expectedRevision: 0,
                observedAt: "2026-11-12T15:00:00.000Z",
                actor: "researcher" as const,
                profileRevisionId: null,
                reason: "Synthetic catalog reason.",
                artifacts: [],
                remainingConditions: ["지도교수와 마감일 확인 · Confirm the deadline"],
                kind: "enter" as const,
                precedingState: "not-started" as const,
                state: "in-progress" as const,
              }
            : null,
        },
      ];
    }),
  ),
};

export function NavigatorSpecimen() {
  const query = new URLSearchParams(location.search);
  const locale = query.get("locale") === "ko-KR" ? "ko-KR" : "en-US";
  const appearance = query.get("appearance") === "dark" ? "dark" : "light";
  const [opened, open] = useState<string>("none");
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.appearance = appearance;
  }, [appearance, locale]);
  return (
    <main data-opened={opened}>
      <NavigatorView
        locale={locale}
        title="연구 제목이 길어도 문서 영역의 전체 너비를 사용합니다 · A long working title wraps across the full document width"
        subtitle="부제 · Optional subtitle"
        projectType="thesis"
        steps={projectWorkflows.thesis}
        stages={stages}
        retryStages={() => {}}
        profile={{
          saved: {
            fields: {
              deadline: { state: "known", value: "2027-06-30", origin },
              milestones: {
                state: "known",
                items: [
                  {
                    state: "known",
                    value: { title: "Ethics form", date: "2025-06-15", done: false },
                    origin,
                  },
                  { state: "known", value: { title: "Pilot interview", done: true }, origin },
                  {
                    state: "known",
                    value: { title: "Draft chapter 2", date: "2027-02-28", done: false },
                    origin,
                  },
                ],
              },
              questions: {
                state: "known",
                items: [{ state: "known", value: "한글 연구 질문 · ملاحظات", origin }],
              },
            },
          },
          readFailed: false,
          retry: () => {},
        }}
        openProfile={(section) => {
          open(section ?? "profile");
        }}
        today="2026-11-28"
      />
    </main>
  );
}
