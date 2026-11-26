import { expect } from "@playwright/test";

export async function verifyPackagedResearchStage(page, input) {
  const outcome = await page.evaluate(
    async ({ projectId, otherProjectId, subscriptionId, profileRevisionId }) => {
      const port = window.ohtia.foundation;
      const scope = { projectId, subscriptionId, stageId: "onboarding" };
      const before = await port.readResearchStage(scope).result;
      const later = await port.readResearchStage({ ...scope, stageId: "literature" }).result;
      const payload = {
        ...scope,
        expectedRevision: 0,
        decision: {
          profileRevisionId,
          reason: "Confirm the stage with the recorded context.",
          artifacts: [],
          remainingConditions: ["Check the requirements."],
          transition: { kind: "enter" },
        },
      };
      const blocked = await port.transitionResearchStage(crypto.randomUUID(), {
        ...payload,
        projectId: otherProjectId,
      }).result;
      const operationId = crypto.randomUUID();
      const original = await port.transitionResearchStage(operationId, payload).result;
      const receipt = await port.readStageReceipt({ ...payload, operationId }).result;
      const replay = await port.transitionResearchStage(operationId, payload).result;
      const after = await port.readResearchStage(scope).result;
      const history = await port.readStageDecision({ ...scope, revision: 1 }).result;
      return { before, later, blocked, original, receipt, replay, after, history };
    },
    input,
  );
  expect(outcome.before).toMatchObject({
    ok: true,
    value: { state: "not-started", revision: 0, enter: "available" },
  });
  expect(outcome.later).toMatchObject({
    ok: true,
    value: { state: "not-started", enter: "workflow_unavailable" },
  });
  expect(outcome.blocked).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  expect(outcome.original).toMatchObject({
    ok: true,
    value: {
      stageDecision: {
        state: "in-progress",
        kind: "enter",
        revision: 1,
        actor: "researcher",
        profileRevisionId: input.profileRevisionId,
      },
    },
  });
  expect(outcome.receipt).toMatchObject({ ok: true, value: { receipt: outcome.original.value } });
  expect(outcome.replay).toEqual(outcome.original);
  expect(outcome.after).toMatchObject({
    ok: true,
    value: { state: "in-progress", revision: 1, decisionId: outcome.original.value.resultId },
  });
  expect(outcome.history).toEqual({ ok: true, value: outcome.original.value.stageDecision });
  return {
    entry: true,
    scopedCommand: true,
    unavailableLaterStage: true,
    exactHistory: true,
    operationReplay: true,
  };
}
