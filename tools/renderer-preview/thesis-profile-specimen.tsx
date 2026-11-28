import { useLayoutEffect, useState } from "react";
import {
  encodeProfileContent,
  failure,
  type Outcome,
  type PortCall,
} from "../../packages/contracts/dist/index.js";
import { ThesisProfileController } from "../../packages/renderer/src/thesis-profile-controller.js";
import { ThesisProfileView } from "../../packages/renderer/src/thesis-profile-view.js";

const lease = { projectId: "catalog-project", isCurrent: () => true };
const content = encodeProfileContent({
  schemaVersion: 2,
  fields: {
    deadline: { state: "unknown" },
    milestones: {
      state: "known",
      items: [
        {
          state: "known",
          value: { title: "Ethics form", date: "2026-01-15", done: false },
          origin: { kind: "researcher_statement" },
        },
        {
          state: "known",
          value: { title: "Pilot interview", done: true },
          origin: { kind: "researcher_statement" },
        },
      ],
    },
    weekly_availability_minutes: {
      state: "known",
      value: 0,
      origin: { kind: "researcher_statement" },
    },
    questions: {
      state: "known",
      items: [
        {
          state: "known",
          value: "한글 연구 질문 · ملاحظات",
          origin: { kind: "described_material", description: "Draft discussion notes" },
        },
      ],
    },
  },
});
function result<T>(value: Outcome<T>): PortCall<T> {
  return { result: Promise.resolve(value), cancel() {} };
}

export function ThesisProfileSpecimen() {
  const query = new URLSearchParams(location.search);
  const locale = query.get("locale") === "ko-KR" ? "ko-KR" : "en-US";
  const appearance = query.get("appearance") === "dark" ? "dark" : "light";
  const [controller] = useState(
    () =>
      new ThesisProfileController({
        readThesisProfile: () =>
          result({
            ok: true,
            value: {
              projectId: lease.projectId,
              profile: {
                revision: 1,
                revisionId: "catalog-version",
                previousRevisionId: null,
                changedFields: ["deadline", "weekly_availability_minutes", "questions"],
                content,
              },
            },
          }),
        readThesisProfilePart: () => result(failure("storage_failed")),
        saveThesisProfile: () => result(failure("storage_failed")),
        stageThesisProfilePart: () => result(failure("storage_failed")),
        readThesisProfileReceipt: () => result(failure("storage_failed")),
      }),
  );
  useLayoutEffect(() => {
    const detach = controller.attach(lease);
    controller.setSubscription("catalog-subscription");
    return detach;
  }, [controller]);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.appearance = appearance;
  }, [appearance, locale]);
  return (
    <main>
      <ThesisProfileView
        controller={controller}
        lease={lease}
        subscriptionId="catalog-subscription"
        language="ko-KR"
        locale={locale}
        title="연구 제목이 길어도 문서 영역의 전체 너비를 사용합니다 · A long working title wraps across the full document width"
        subtitle={query.get("subtitle") === "none" ? null : "부제 · Optional subtitle"}
        rename={() => {}}
        target={undefined}
        unavailable={false}
        retryConnection={() => {}}
      />
    </main>
  );
}
