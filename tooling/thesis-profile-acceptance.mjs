// Non-shipping verification using Electron's actual isolated preload and utility process.
import { expect } from "@playwright/test";
import { desktopChannels, encodeProfileContent } from "../packages/contracts/dist/index.js";
import { verifyPackagedManuscripts } from "./manuscript-revision-acceptance.mjs";
import { verifyPackagedResearchStage } from "./research-stage-acceptance.mjs";
import { originalTitle, otherTitle, selectProject } from "./project-rename-acceptance.mjs";

export async function verifyPackagedThesisProfile(application, page, projects) {
  const [projectId, otherProjectId] = projects;
  const native = await application.browserWindow(page);
  const patch = encodeProfileContent({
    schemaVersion: 2,
    fields: {
      deadline: { state: "unknown" },
      topic: {
        state: "known",
        value: "Synthetic thesis topic 📝",
        origin: { kind: "researcher_statement" },
      },
    },
  });
  try {
    await selectProject(page, otherTitle);
    await native.evaluate((window, replyChannel) => {
      const frame = window.webContents.mainFrame;
      const send = frame.send;
      window.thesisProfileEvidence = { restore: () => (frame.send = send) };
      frame.send = function (channel, payload) {
        if (channel === replyChannel && typeof payload === "string") {
          const answer = JSON.parse(payload);
          if (
            answer.kind === "result" &&
            answer.operation === "research.subscribe" &&
            answer.payload.ok
          )
            window.thesisProfileEvidence.subscriptionId = answer.payload.value.subscriptionId;
        }
        return send.call(this, channel, payload);
      };
    }, desktopChannels.reply);
    await selectProject(page, originalTitle);
    await expect
      .poll(async () => {
        const subscriptionId = await native.evaluate(
          (window) => window.thesisProfileEvidence.subscriptionId ?? null,
        );
        if (!subscriptionId) return false;
        return page.evaluate(
          async (input) => {
            const read = await window.ohtia.foundation.readThesisProfile(input).result;
            return read.ok;
          },
          { projectId, subscriptionId, revisionId: null },
        );
      })
      .toBe(true);
    const subscriptionId = await native.evaluate(
      (window) => window.thesisProfileEvidence.subscriptionId,
    );
    const result = await page.evaluate(
      async ({ projectId, otherProjectId, subscriptionId, patch }) => {
        const port = window.ohtia.foundation;
        const input = { projectId, subscriptionId };
        const wrongProject = await port.readThesisProfile({
          ...input,
          projectId: otherProjectId,
          revisionId: null,
        }).result;
        const unset = await port.readThesisProfile({ ...input, revisionId: null }).result;
        const operationId = crypto.randomUUID();
        const payload = { ...input, expectedRevision: 0, patch };
        const saved = await port.saveThesisProfile(operationId, payload).result;
        if (!saved.ok) return { wrongProject, unset, saved };
        const exact = await port.readThesisProfile({ ...input, revisionId: saved.value.resultId })
          .result;
        const receipt = await port.readThesisProfileReceipt({ ...payload, operationId }).result;
        return { wrongProject, unset, saved, exact, receipt };
      },
      { projectId, otherProjectId, subscriptionId, patch },
    );
    expect(result.wrongProject).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(result.unset).toEqual({ ok: true, value: { projectId, profile: null } });
    expect(result.saved).toMatchObject({
      ok: true,
      value: {
        profileChange: {
          projectId,
          revision: { revision: 1, previousRevisionId: null, changedFields: ["deadline", "topic"] },
        },
      },
    });
    expect(result.exact).toEqual({
      ok: true,
      value: {
        projectId,
        profile: {
          ...result.saved.value.profileChange.revision,
          content: patch,
        },
      },
    });
    expect(result.receipt).toMatchObject({
      ok: true,
      value: { projectId, receipt: result.saved.value },
    });
    const stage = await verifyPackagedResearchStage(page, {
      projectId,
      otherProjectId,
      subscriptionId,
      profileRevisionId: result.saved.value.resultId,
    });
    const manuscripts = await verifyPackagedManuscripts(page, {
      projectId,
      otherProjectId,
      subscriptionId,
    });
    return {
      manuscripts,
      profile: { unsetProfile: true, scopedRead: true, exactRevision: true, durableReceipt: true },
      stage,
    };
  } finally {
    await native.evaluate((window) => {
      window.thesisProfileEvidence?.restore();
      delete window.thesisProfileEvidence;
    });
    await native.dispose();
  }
}
