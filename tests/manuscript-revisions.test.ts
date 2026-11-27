import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  decodeText,
  encodeEnvelope,
  failure,
  manuscriptFormat,
  policyId,
  researchResultMatches,
  splitText,
  type Outcome,
  type Envelope,
  type ResearchOperation,
  type Request,
  type ResearchInputs,
  type ResearchOutputs,
} from "@ohtia/contracts";
import { serializeManuscript } from "../packages/utility/src/manuscript.js";
import { ResearchService } from "../packages/utility/src/research-service.js";
import type { DurableProvider } from "../packages/utility/src/durable-provider.js";
import { bytes } from "../packages/utility/src/research.js";
import { objects } from "../packages/utility/src/migrations/0041_manuscript_revisions.mjs";
import { preManuscriptSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { proposeSetup, successful } from "./fixtures/project-setup.js";
import { storageFixture } from "./fixtures/storage.js";

type Fixture = ReturnType<typeof storageFixture>;
const subscriptionId = "selected-project";
const authority = {
  protocol: 1,
  policy: policyId,
  kind: "request",
  requestId: "read",
  operationId: "query",
  windowGeneration: "window",
  serviceGeneration: "service",
} as const;
type ReadOperation =
  "manuscript.list" | "manuscript.read" | "manuscript.readPart" | "manuscript.receipt";
function read<K extends ReadOperation>(
  f: Fixture,
  operation: K,
  input: Omit<ResearchInputs[K], "subscriptionId">,
) {
  const request = { ...authority, operation, payload: { ...input, subscriptionId } } as Extract<
    Request,
    { operation: K }
  >;
  return f.store.readResearch(request) as Promise<Outcome<ResearchOutputs[K]>>;
}

async function project(f: Fixture, name: string, language?: string) {
  const { resultId: projectId } = successful(
    await f.store.executeResearchCommand({
      command: "project.create",
      operationId: `project-${name}`,
      payload: {},
    }),
  );
  if (language) {
    const proposalId = await proposeSetup(f.store, f.raw, projectId, {
      title: "Synthetic research",
      document_language: language,
    });
    successful(
      await f.store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: `confirm-${name}`,
        payload: { proposalId },
      }),
    );
  }
  return projectId;
}
function create(projectId: string, operationId: string, title = "Working label") {
  return { command: "manuscript.create", operationId, payload: { projectId, title } } as const;
}
async function initial(f: Fixture, input: ReturnType<typeof create>) {
  const outcome = successful(await f.store.executeResearchCommand(input));
  return outcome.manuscriptChange!.revision;
}
function text(draftId: string, ids: string[] = ["blk_first"], paragraph = "Ñandú 📝") {
  const outcome = serializeManuscript(
    {
      format: manuscriptFormat,
      draftId,
      title: { id: "sec_heading", text: "Thesis heading" },
      paragraphs: ids.map((id) => ({ id, lines: [{ text: paragraph, breakAfter: null }] })),
    },
    { draftId },
  );
  if (!outcome.ok) throw new Error(outcome.diagnostic.code);
  return outcome.value;
}
function save(
  projectId: string,
  draftId: string,
  expectedRevisionId: string,
  markdown: string,
  operationId: string,
) {
  return {
    command: "manuscript.save",
    operationId,
    payload: { projectId, draftId, expectedRevisionId, markdown, saveReason: "manual" },
  } as const;
}
async function receipt(f: Fixture, input: ReturnType<typeof save>) {
  const { projectId, markdown, ...intent } = input.payload;
  return read(f, "manuscript.receipt", {
    projectId,
    operationId: input.operationId,
    intent: {
      kind: "save",
      ...intent,
      contentSha256: createHash("sha256").update(markdown).digest("hex"),
    },
  });
}

describe("file-backed manuscript revisions", () => {
  it("upgrades revision 40 and retains exact content, language and receipts across reopening", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await project(f, "legacy", "es-AR");
    await f.store.close();
    const prior = f.raw();
    prior.exec(preManuscriptSql);
    expect(prior.pragma("user_version", { simple: true })).toBe(40);
    prior.close();
    await f.store.open();
    const opening = create(projectId, "new-draft", "  Workspace name  ");
    const first = await initial(f, opening);
    const { draftId } = first;
    expect(first).toMatchObject({
      language: "es-AR",
      parentRevisionId: null,
      saveReason: "initial",
      authorKind: "researcher",
      recordingActor: "utility",
      restorationOriginId: null,
    });
    const header = successful(
      await read(f, "manuscript.read", { projectId, draftId, revisionId: null }),
    );
    expect(header.markdown).toBe(
      `---\nohtia_draft_format: ohtia-markdown-v1\nohtia_draft_id: draft_${draftId}\n---\n`,
    );
    const markdown = text(draftId, ["blk_long"], "é".repeat(3000));
    const command = save(projectId, draftId, first.revisionId, markdown, "text-save");
    const saved = successful(await f.store.executeResearchCommand(command));
    const currentRevisionId = saved.resultId;
    await f.store.close();
    const upgraded = f.raw();
    expect(upgraded.pragma("user_version", { simple: true })).toBe(41);
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    upgraded.close();
    await f.store.open();
    expect(await initial(f, opening)).toEqual(first);
    expect(successful(await receipt(f, command)).receipt).toEqual(saved);
    expect(await f.store.executeResearchCommand(command)).toEqual({ ok: true, value: saved });
    expect(
      await f.store.executeResearchCommand({
        ...command,
        payload: { ...command.payload, saveReason: "autosave" },
      }),
    ).toEqual(failure("operation_conflict"));
    expect(successful(await read(f, "manuscript.list", { projectId, after: null }))).toEqual({
      projectId,
      manuscripts: [{ draftId, title: "Workspace name", currentRevisionId }],
      next: null,
    });
    expect(
      successful(
        await read(f, "manuscript.read", { projectId, draftId, revisionId: first.revisionId }),
      ),
    ).toEqual(header);
    const current = successful(
      await read(f, "manuscript.read", { projectId, draftId, revisionId: null }),
    );
    expect(current.revision).toMatchObject({
      language: "es-AR",
      revisionId: currentRevisionId,
      parentRevisionId: first.revisionId,
      saveReason: "manual",
    });
    const parts = splitText(markdown);
    expect(current.markdown).toEqual({
      source: currentRevisionId,
      parts: parts.length,
      bytes: Buffer.byteLength(markdown),
      sha256: createHash("sha256").update(markdown).digest("hex"),
    });
    for (const [offset, expected] of parts.entries()) {
      const part = successful(
        await read(f, "manuscript.readPart", {
          projectId,
          draftId,
          revisionId: currentRevisionId,
          index: offset + 1,
        }),
      );
      expect(part.text).toBe(expected);
    }
    expect(
      await read(f, "manuscript.readPart", {
        projectId,
        draftId,
        revisionId: currentRevisionId,
        index: parts.length + 1,
      }),
    ).toEqual(failure("record_not_found"));
  });

  it("serializes competing writers and reconciles a conflict against its originally observed head", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await project(f, "race", "ca-AD");
    const first = await initial(f, create(projectId, "race-create"));
    const { draftId, revisionId } = first;
    const winner = save(projectId, draftId, revisionId, text(draftId), "winner");
    const other = save(projectId, draftId, revisionId, text(draftId, ["blk_second"]), "other");
    const [accepted, busy] = await Promise.all([
      f.store.executeResearchCommand(winner),
      f.store.executeResearchCommand(other),
    ]);
    const head = successful(accepted);
    expect(busy).toEqual(failure("busy"));
    const conflict = successful(await f.store.executeResearchCommand(other));
    expect(conflict).toEqual({
      resultId: head.resultId,
      manuscriptChange: { kind: "conflict", revision: head.manuscriptChange!.revision },
    });
    const next = save(
      projectId,
      draftId,
      head.resultId,
      text(draftId, ["blk_first"], "Next"),
      "next-save",
    );
    expect(successful(await f.store.executeResearchCommand(next)).resultId).not.toBe(head.resultId);
    await f.store.close();
    await f.store.open();
    expect(successful(await receipt(f, other)).receipt).toEqual(conflict);
    expect(successful(await f.store.executeResearchCommand(other))).toEqual(conflict);
    expect(
      await receipt(f, {
        ...other,
        payload: { ...other.payload, markdown: text(draftId, ["blk_changed"]) },
      }),
    ).toEqual(failure("operation_conflict"));
  });

  it("refuses out-of-scope, corrupt and reused content and rolls failed receipt writes back", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await project(f, "one", "en");
    const secondProject = await project(f, "two", "de");
    const pending = await project(f, "pending");
    expect(await f.store.executeResearchCommand(create(pending, "before-setup"))).toEqual(
      failure("project_in_setup"),
    );
    for (const invalid of ["   ", "😀".repeat(201), "null\0byte"]) {
      expect(
        await f.store.executeResearchCommand(create(projectId, "invalid-title", invalid)),
      ).toEqual(failure("name_invalid"));
    }
    const one = await initial(f, create(projectId, "one-draft", "😀".repeat(200)));
    const other = await initial(f, create(secondProject, "other-draft"));
    const { draftId, revisionId } = one;
    const valid = save(projectId, draftId, revisionId, text(draftId), "valid");
    expect(
      await read(f, "manuscript.read", { projectId: secondProject, draftId, revisionId: null }),
    ).toEqual(failure("record_not_found"));
    expect(
      await read(f, "manuscript.read", { projectId, draftId, revisionId: other.revisionId }),
    ).toEqual(failure("record_not_found"));
    expect(
      await f.store.executeResearchCommand({
        ...valid,
        payload: { ...valid.payload, expectedRevisionId: other.revisionId },
      }),
    ).toEqual(failure("record_not_found"));
    for (const markdown of [
      text(other.draftId),
      text(draftId).replace("Thesis", "\\Thesis"),
      text(draftId).replace("Thesis heading", "*emphasis*"),
    ]) {
      expect(
        await f.store.executeResearchCommand({ ...valid, payload: { ...valid.payload, markdown } }),
      ).toEqual(failure("invalid_message"));
    }
    const sql = f.raw();
    try {
      sql.exec(
        "CREATE TRIGGER fail_manuscript_receipt BEFORE INSERT ON command_receipts WHEN NEW.command LIKE 'manuscript.%' BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END",
      );
      expect(await f.store.executeResearchCommand(create(projectId, "failed-create"))).toEqual(
        failure("storage_failed"),
      );
      expect(await f.store.executeResearchCommand(valid)).toEqual(failure("storage_failed"));
      expect(sql.prepare("SELECT count(*) FROM drafts").pluck().get()).toBe(2);
      expect(sql.prepare("SELECT count(*) FROM draft_revisions").pluck().get()).toBe(2);
      expect(sql.prepare("SELECT count(*) FROM draft_unit_ids").pluck().get()).toBe(0);
      expect(successful(await receipt(f, valid)).receipt).toBeNull();
      expect(
        successful(await read(f, "manuscript.read", { projectId, draftId, revisionId: null }))
          .revision.revisionId,
      ).toBe(revisionId);
      sql.exec("DROP TRIGGER fail_manuscript_receipt");
      sql.exec(`
        CREATE TABLE synthetic_failed_commit (
          draft_id BLOB NOT NULL REFERENCES drafts(id) DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TRIGGER fail_manuscript_commit AFTER INSERT ON command_receipts
          WHEN NEW.operation_id='valid'
        BEGIN INSERT INTO synthetic_failed_commit VALUES (X'00'); END;
      `);
      expect(await f.store.executeResearchCommand(valid)).toEqual(failure("uncertain"));
      expect(successful(await receipt(f, valid)).receipt).toBeNull();
      expect(
        successful(await read(f, "manuscript.read", { projectId, draftId, revisionId: null }))
          .revision.revisionId,
      ).toBe(revisionId);
      expect(sql.prepare("SELECT count(*) FROM draft_revisions").pluck().get()).toBe(2);
      expect(sql.prepare("SELECT count(*) FROM draft_unit_ids").pluck().get()).toBe(0);
      sql.exec("DROP TRIGGER fail_manuscript_commit; DROP TABLE synthetic_failed_commit");
      const written = successful(await f.store.executeResearchCommand(valid));
      expect(() =>
        sql
          .prepare("UPDATE drafts SET current_revision_id=? WHERE id=?")
          .run(bytes(other.revisionId), bytes(draftId)),
      ).toThrow();
      expect(() =>
        sql
          .prepare("UPDATE draft_revisions SET markdown='changed' WHERE id=?")
          .run(bytes(written.resultId)),
      ).toThrow();
      const separate = successful(
        await f.store.executeResearchCommand(
          save(
            secondProject,
            other.draftId,
            other.revisionId,
            text(other.draftId),
            "separate-block",
          ),
        ),
      );
      expect(separate.manuscriptChange!.revision).toMatchObject({
        projectId: secondProject,
        draftId: other.draftId,
      });
      const retired = successful(
        await f.store.executeResearchCommand(
          save(projectId, draftId, written.resultId, text(draftId, []), "retire"),
        ),
      );
      expect(
        await f.store.executeResearchCommand(
          save(projectId, draftId, retired.resultId, text(draftId), "reuse"),
        ),
      ).toEqual(failure("invalid_message"));
      expect(
        successful(
          await read(f, "manuscript.read", { projectId, draftId, revisionId: written.resultId }),
        ).markdown,
      ).toBe(valid.payload.markdown);
      // Damage only the retained hash so an exact read or checked save cannot trust the row.
      sql.exec("DROP TRIGGER draft_revision_update");
      sql
        .prepare("UPDATE draft_revisions SET content_sha256=zeroblob(32) WHERE id=?")
        .run(bytes(retired.resultId));
      sql.exec(objects.draft_revision_update);
      expect(await read(f, "manuscript.read", { projectId, draftId, revisionId: null })).toEqual(
        failure("storage_failed"),
      );
      expect(
        await f.store.executeResearchCommand(
          save(projectId, draftId, retired.resultId, text(draftId, []), "corrupt-base"),
        ),
      ).toEqual(failure("storage_failed"));
    } finally {
      sql.close();
    }
  });

  it("paginates an owned collection and correlates exact revision messages at the port", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await project(f, "pages", "en");
    const revisions = [];
    for (let index = 0; index < 21; index++)
      revisions.push(await initial(f, create(projectId, `new-${index}`, `Title ${index}`)));
    const list = successful(await read(f, "manuscript.list", { projectId, after: null }));
    expect(list.manuscripts).toHaveLength(20);
    expect(list.next).toBe(list.manuscripts.at(-1)?.draftId);
    const last = successful(await read(f, "manuscript.list", { projectId, after: list.next }));
    expect(last.manuscripts).toHaveLength(1);
    expect(last.next).toBeNull();
    expect([...list.manuscripts, ...last.manuscripts].map(({ draftId }) => draftId)).toEqual(
      revisions.map(({ draftId }) => draftId).sort(),
    );
    const [first, second] = revisions;
    const input = {
      projectId,
      subscriptionId,
      draftId: first.draftId,
      revisionId: first.revisionId,
    };
    const request = { ...authority, operation: "manuscript.read", payload: input } as const;
    expect(decodeText(successful(encodeEnvelope(request)))).toEqual({ ok: true, value: request });
    const result = successful(await read(f, "manuscript.read", input));
    const encoded = successful(
      encodeEnvelope({ ...request, kind: "result", payload: { ok: true, value: result } }),
    );
    expect(decodeText(encoded).ok).toBe(true);
    expect(researchResultMatches(request.operation, input, result, authority.operationId)).toBe(
      true,
    );
    expect(
      researchResultMatches(
        request.operation,
        input,
        { ...result, revision: second },
        authority.operationId,
      ),
    ).toBe(false);
  });
});

it("publishes committed manuscript revisions only to the owning project after the receipt", async () => {
  const f = storageFixture();
  await f.store.open();
  const projectId = await project(f, "viewing", "ko-KR");
  const foreign = await project(f, "foreign", "es-AR");
  const wire: Envelope[] = [];
  const pump = vi.fn();
  const failed = vi.fn();
  const service = new ResearchService(
    f.store,
    "service",
    (envelope) => {
      wire.push(successful(decodeText(successful(encodeEnvelope(envelope)))));
    },
    { pump } as unknown as DurableProvider,
    failed,
  );
  async function send<K extends ResearchOperation>(
    operation: K,
    payload: ResearchInputs[K],
    operationId: string,
    windowGeneration = "window",
  ) {
    const request = {
      ...authority,
      operation,
      requestId: `req-${operationId}`,
      windowGeneration,
      operationId,
      payload,
    } as Extract<Request, { operation: K }>;
    await service.dispatch(request);
    const response = wire.findLast(
      (event) => event.kind === "result" && event.requestId === request.requestId,
    );
    if (!response || response.kind !== "result") throw new Error("Missing research response.");
    return response.payload as Outcome<ResearchOutputs[K]>;
  }
  const scope = { projectId, subscriptionId };
  const changes = () =>
    wire.filter(
      (event) =>
        event.kind === "event" &&
        event.topic === "research" &&
        event.payload.kind === "changed" &&
        event.payload.record === "manuscript",
    );
  try {
    successful(await send("research.subscribe", { ...scope, conversationId: null }, "observing"));
    successful(
      await send(
        "research.subscribe",
        { ...scope, projectId: foreign, conversationId: null },
        "foreign",
        "foreign-window",
      ),
    );
    const before = wire.length;
    const open = { ...scope, title: "Workspace title" };
    const first = successful(await send("manuscript.create", open, "create-view")).manuscriptChange
      .revision;
    expect(wire[before]).toMatchObject({ kind: "result", operation: "manuscript.create" });
    expect(changes()).toMatchObject([
      {
        subscriptionId,
        windowGeneration: "window",
        payload: { id: projectId, revision: 1 },
      },
    ]);
    await send("manuscript.create", open, "create-view");
    const { draftId, revisionId } = first;
    const edit = {
      ...scope,
      draftId,
      expectedRevisionId: revisionId,
      markdown: text(draftId),
      saveReason: "manual",
    } as const;
    const saved = successful(await send("manuscript.save", edit, "save-view")).manuscriptChange
      .revision;
    expect(changes()).toMatchObject([
      { windowGeneration: "window", payload: { id: projectId, revision: 1 } },
      { windowGeneration: "window", payload: { id: projectId, revision: 2 } },
    ]);
    successful(await send("manuscript.save", edit, "conflict-view"));
    expect(changes()).toHaveLength(2);
    const current = successful(
      await send("manuscript.read", { ...scope, draftId, revisionId: null }, "read-view"),
    );
    expect(current).toMatchObject({ revision: saved, markdown: edit.markdown });
    expect(
      await send(
        "manuscript.read",
        { ...scope, draftId, revisionId: null },
        "foreign-attempt",
        "foreign-window",
      ),
    ).toEqual(failure("unauthorized"));
    expect(pump).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  } finally {
    service.dispose();
  }
});
