import { expect } from "@playwright/test";
import { otherTitle, selectProject } from "./project-rename-acceptance.mjs";

/** Exercise the shipped renderer bridge and privileged utility with a synthetic document. */
export async function verifyPackagedManuscripts(page, input) {
  const result = await page.evaluate(async ({ projectId, otherProjectId, subscriptionId }) => {
    const port = window.ohtia.foundation;
    const scope = { projectId, subscriptionId };
    const title = "Manuscript workspace label";
    const createId = crypto.randomUUID();
    const created = await port.createManuscript(createId, { ...scope, title }).result;
    if (!created.ok) return { created };
    const { draftId, revisionId: first } = created.value.manuscriptChange.revision;
    const reference = { ...scope, draftId };
    const initial = await port.readManuscript({ ...reference, revisionId: first }).result;
    if (!initial.ok || typeof initial.value.markdown !== "string") return { created, initial };

    const markdown =
      initial.value.markdown +
      "\n# Manuscript heading {#sec_packaged-heading}\n\n::: {#blk_packaged-body .ohtia-block}\n" +
      "a".repeat(6000) +
      "\n:::\n";
    const buffer = new TextEncoder().encode(markdown);
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const operationId = crypto.randomUUID();
    const parts = [markdown.slice(0, 4096), markdown.slice(4096)];
    for (const [index, text] of parts.entries()) {
      const uploaded = await port.stageManuscriptPart(operationId, {
        ...scope,
        text,
        index: index + 1,
        count: parts.length,
        bytes: buffer.length,
        sha256,
      }).result;
      if (!uploaded.ok) return { created, initial, uploaded };
    }
    const save = { ...reference, expectedRevisionId: first, saveReason: "manual" };
    const payload = { ...save, markdown: { parts: parts.length, bytes: buffer.length, sha256 } };
    const [saved, raced] = await Promise.all([
      port.saveManuscript(operationId, payload).result,
      port.saveManuscript(crypto.randomUUID(), {
        ...save,
        markdown: initial.value.markdown + "\n# Alternate heading {#sec_packaged-stale}\n",
      }).result,
    ]);
    if (!saved.ok || !raced.ok || saved.value.manuscriptChange.kind !== "committed")
      return { created, initial, saved, raced };
    const revisionId = saved.value.resultId;
    const read = await port.readManuscript({ ...reference, revisionId: null }).result;
    const returned = [];
    for (const index of [1, 2]) {
      const part = await port.readManuscriptPart({ ...reference, revisionId, index }).result;
      if (!part.ok) return { created, initial, saved, read, part };
      returned.push(part.value.text);
    }
    const receipt = await port.readManuscriptReceipt({
      ...scope,
      operationId,
      intent: {
        kind: "save",
        draftId,
        expectedRevisionId: first,
        saveReason: "manual",
        contentSha256: sha256,
      },
    }).result;
    const replay = await port.saveManuscript(operationId, payload).result;
    const cross = await port.readManuscript({ ...reference, projectId: otherProjectId, revisionId })
      .result;
    const listing = await port.listManuscripts({ ...scope, after: null }).result;
    return {
      created,
      initial,
      saved,
      raced,
      read,
      receipt,
      replay,
      cross,
      listing,
      title,
      revisionId,
      draftId,
      roundTrip: returned.join("") === markdown,
    };
  }, input);
  expect(result.created).toMatchObject({
    ok: true,
    value: {
      manuscriptChange: {
        kind: "committed",
        revision: { saveReason: "initial", language: "en", parentRevisionId: null },
      },
    },
  });
  expect(result.initial).toMatchObject({
    ok: true,
    value: { markdown: expect.stringMatching(/\nohtia_draft_id: draft_[0-9a-f-]+\n---\n$/u) },
  });
  expect(result.saved).toMatchObject({
    ok: true,
    value: {
      manuscriptChange: { kind: "committed", revision: { saveReason: "manual", language: "en" } },
    },
  });
  expect(result.raced).toEqual({
    ok: true,
    value: {
      resultId: result.revisionId,
      manuscriptChange: {
        kind: "conflict",
        revision: result.saved.value.manuscriptChange.revision,
      },
    },
  });
  expect(result.read).toMatchObject({
    ok: true,
    value: {
      revision: { revisionId: result.revisionId },
      markdown: { source: result.revisionId, parts: 2 },
    },
  });
  expect(result.roundTrip).toBe(true);
  expect(result.receipt).toMatchObject({ ok: true, value: { receipt: result.saved.value } });
  expect(result.replay).toEqual(result.saved);
  expect(result.cross).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  expect(result.listing).toMatchObject({
    ok: true,
    value: {
      manuscripts: [
        {
          draftId: result.draftId,
          currentRevisionId: result.revisionId,
          title: result.title,
        },
      ],
    },
  });
  await selectProject(page, otherTitle);
  await expect
    .poll(() =>
      page.evaluate(
        async ({ projectId, subscriptionId }) =>
          (
            await window.ohtia.foundation.listManuscripts({
              projectId,
              subscriptionId,
              after: null,
            }).result
          ).ok,
        input,
      ),
    )
    .toBe(false);
  return {
    exactContent: true,
    scopedRead: true,
    chunkedTransport: true,
    concurrentConflict: true,
    durableReceipt: true,
  };
}
