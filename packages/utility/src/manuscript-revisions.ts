import type { Kysely } from "kysely";
import {
  canonicalJson,
  failure,
  isManuscriptLanguage,
  isUnicodeText,
  manuscriptFormat,
  manuscriptLimits,
  manuscriptPageSize,
  projectTitleError,
  splitText,
  type CanonicalManuscript,
  type ManuscriptIntent,
  type ManuscriptRevision,
  type ManuscriptWriteResult,
  type Outcome,
  type ResearchInputs,
  type ResearchOutputs,
} from "@ohtia/contracts";
import { parseManuscript, serializeManuscript } from "./manuscript.js";
import { bytes, identifier, isEntityId, newId, type ResearchSchema } from "./research.js";
import { digest, storedText } from "./research-text.js";

export interface DraftRow {
  id: Uint8Array;
  project_id: Uint8Array;
  title: string;
  current_revision_id: Uint8Array;
}

export interface RevisionRow {
  id: Uint8Array;
  draft_id: Uint8Array;
  parent_revision_id: Uint8Array | null;
  restoration_origin_id: Uint8Array | null;
  markdown: string;
  language: string | null;
  created_at: string;
  save_reason: ManuscriptRevision["saveReason"];
  content_sha256: Uint8Array;
  author_kind: ManuscriptRevision["authorKind"];
  recording_actor: ManuscriptRevision["recordingActor"];
  operation_id: string;
}

export interface ManuscriptSchema {
  drafts: DraftRow;
  draft_revisions: RevisionRow;
  draft_unit_ids: {
    unit_id: string;
    draft_id: Uint8Array;
    first_revision_id: Uint8Array;
  };
}

type Database = Kysely<ResearchSchema>;
type ManuscriptCommand = "manuscript.create" | "manuscript.save";

export function manuscriptCommand(kind: ManuscriptIntent["kind"]): ManuscriptCommand {
  return kind === "create" ? "manuscript.create" : "manuscript.save";
}

export function manuscriptIntentHash(projectId: string, intent: ManuscriptIntent): string {
  return digest(canonicalJson({ projectId, intent }));
}

export function manuscriptSaveIntent(
  input: Omit<ResearchInputs["manuscript.save"], "subscriptionId">,
): Extract<ManuscriptIntent, { kind: "save" }> {
  const { draftId, expectedRevisionId, saveReason, markdown } = input;
  if (
    typeof markdown === "string" &&
    (markdown.length > manuscriptLimits.documentBytes ||
      Buffer.byteLength(markdown) > manuscriptLimits.documentBytes ||
      !isUnicodeText(markdown))
  )
    throw new Error("Invalid manuscript text bounds.");
  return {
    kind: "save",
    draftId,
    expectedRevisionId,
    saveReason,
    contentSha256: typeof markdown === "string" ? digest(markdown) : markdown.sha256,
  };
}

async function confirmedProject(db: Database, projectId: string) {
  if (!isEntityId(projectId)) return failure("invalid_message");
  const project = await db
    .selectFrom("projects")
    .select(["id", "setup_confirmed_at", "document_language"])
    .where("id", "=", bytes(projectId))
    .where("project_type", "=", "thesis")
    .executeTakeFirst();
  if (!project) return failure("record_not_found");
  if (project.setup_confirmed_at === null) return failure("project_in_setup");
  if (project.document_language === null || !isManuscriptLanguage(project.document_language))
    throw new Error("Confirmed thesis lacks a valid document language.");
  return { ok: true as const, value: { id: project.id, language: project.document_language } };
}

function revisionQuery(db: Database, projectId: Uint8Array, draftId: string) {
  return db
    .selectFrom("draft_revisions as r")
    .innerJoin("drafts as d", "d.id", "r.draft_id")
    .selectAll("r")
    .where("d.project_id", "=", projectId)
    .where("d.id", "=", bytes(draftId));
}

function metadata(projectId: string, row: RevisionRow): ManuscriptRevision {
  const contentSha256 = Buffer.from(row.content_sha256).toString("hex");
  if (!isManuscriptLanguage(row.language) || contentSha256.length !== 64)
    throw new Error("Invalid stored manuscript metadata.");
  return {
    projectId,
    draftId: identifier(row.draft_id),
    revisionId: identifier(row.id),
    parentRevisionId: row.parent_revision_id && identifier(row.parent_revision_id),
    restorationOriginId: row.restoration_origin_id && identifier(row.restoration_origin_id),
    language: row.language,
    createdAt: row.created_at,
    saveReason: row.save_reason,
    contentSha256,
    authorKind: row.author_kind,
    recordingActor: row.recording_actor,
  };
}

function canonicalDocument(markdown: string, draftId: string): CanonicalManuscript | null {
  const identity = { draftId };
  const parsed = parseManuscript(markdown, identity);
  if (!parsed.ok) return null;
  const serialized = serializeManuscript(parsed.value, identity);
  if (!serialized.ok || serialized.value !== markdown) return null;
  const roundTrip = parseManuscript(serialized.value, identity);
  return roundTrip.ok && JSON.stringify(roundTrip.value) === JSON.stringify(parsed.value)
    ? parsed.value
    : null;
}

function retainedDocument(row: RevisionRow): CanonicalManuscript {
  const document = canonicalDocument(row.markdown, identifier(row.draft_id));
  if (
    !document ||
    digest(row.markdown) !== Buffer.from(row.content_sha256).toString("hex") ||
    (row.save_reason === "initial" &&
      (document.title !== null || document.paragraphs.length > 0 || !!document.sections?.length))
  )
    throw new Error("Invalid retained manuscript revision.");
  return document;
}

function unitIds(document: CanonicalManuscript): string[] {
  return [
    ...(document.title ? [document.title.id] : []),
    ...document.paragraphs.map(({ id }) => id),
    ...(document.sections ?? []).map(({ id }) => id),
  ];
}

export async function applyManuscriptCommand(
  db: Database,
  input: {
    [K in ManuscriptCommand]: {
      command: K;
      operationId: string;
      payload: import("@ohtia/contracts").ResearchPayloads[K];
    };
  }[ManuscriptCommand],
  now: string,
): Promise<Outcome<Uint8Array>> {
  const project = await confirmedProject(db, input.payload.projectId);
  if (!project.ok) return project;
  const id = newId();
  let draftId: Uint8Array;
  let markdown: string;
  let saveReason: RevisionRow["save_reason"];
  let parent: Uint8Array | null = null;
  let claims: string[] = [];
  if (input.command === "manuscript.create") {
    const title = input.payload.title.trim();
    if (!title || projectTitleError(title)) return failure("name_invalid");
    draftId = newId();
    const serialized = serializeManuscript(
      { format: manuscriptFormat, draftId: identifier(draftId), title: null, paragraphs: [] },
      { draftId: identifier(draftId) },
    );
    if (!serialized.ok || !canonicalDocument(serialized.value, identifier(draftId)))
      throw new Error("Cannot create a canonical manuscript header.");
    markdown = serialized.value;
    saveReason = "initial";
    await db
      .insertInto("drafts")
      .values({
        id: draftId,
        project_id: project.value.id,
        title,
        current_revision_id: id,
      })
      .execute();
  } else {
    const p = input.payload;
    const revision = revisionQuery(db, project.value.id, p.draftId);
    const previous = await revision
      .select("d.current_revision_id")
      .where("r.id", "=", bytes(p.expectedRevisionId))
      .executeTakeFirst();
    if (!previous) return failure("record_not_found");
    const priorIds = new Set(unitIds(retainedDocument(previous)));
    const document = canonicalDocument(p.markdown, p.draftId);
    if (!document) return failure("invalid_message");
    if (identifier(previous.current_revision_id) !== p.expectedRevisionId) {
      const current = await revision
        .where("r.id", "=", previous.current_revision_id)
        .executeTakeFirstOrThrow();
      retainedDocument(current);
      return { ok: true, value: current.id };
    }
    claims = unitIds(document).filter((unitId) => !priorIds.has(unitId));
    if (
      claims.length &&
      (await db
        .selectFrom("draft_unit_ids")
        .select("unit_id")
        .where("draft_id", "=", previous.draft_id)
        .where("unit_id", "in", claims)
        .executeTakeFirst())
    )
      return failure("invalid_message");
    draftId = previous.draft_id;
    parent = previous.id;
    markdown = p.markdown;
    saveReason = p.saveReason;
  }
  await db
    .insertInto("draft_revisions")
    .values({
      id,
      draft_id: draftId,
      parent_revision_id: parent,
      restoration_origin_id: null,
      markdown,
      language: project.value.language,
      created_at: now,
      save_reason: saveReason,
      content_sha256: Buffer.from(digest(markdown), "hex"),
      author_kind: "researcher",
      recording_actor: "utility",
      operation_id: input.operationId,
    })
    .execute();
  if (claims.length)
    await db
      .insertInto("draft_unit_ids")
      .values(claims.map((unit_id) => ({ unit_id, draft_id: draftId, first_revision_id: id })))
      .execute();
  return { ok: true, value: id };
}

export async function manuscriptReceiptResult(
  db: Database,
  command: ManuscriptCommand,
  operationId: string,
  id: Uint8Array,
): Promise<ManuscriptWriteResult> {
  const row = await db
    .selectFrom("draft_revisions as r")
    .innerJoin("drafts as d", "d.id", "r.draft_id")
    .selectAll("r")
    .select("d.project_id")
    .where("r.id", "=", id)
    .executeTakeFirstOrThrow();
  const revision = metadata(identifier(row.project_id), row);
  const kind = row.operation_id === operationId ? "committed" : "conflict";
  if (
    command === "manuscript.create" &&
    (kind !== "committed" || revision.saveReason !== "initial")
  )
    throw new Error("Invalid manuscript creation receipt.");
  return { resultId: revision.revisionId, manuscriptChange: { kind, revision } };
}

export async function readManuscriptReceipt(
  db: Database,
  { projectId, operationId, intent }: ResearchInputs["manuscript.receipt"],
): Promise<Outcome<ResearchOutputs["manuscript.receipt"]>> {
  const project = await confirmedProject(db, projectId);
  if (!project.ok) return project;
  const row = await db
    .selectFrom("command_receipts")
    .selectAll()
    .where("operation_id", "=", operationId)
    .executeTakeFirst();
  if (!row) return { ok: true, value: { projectId, operationId, receipt: null } };
  const command = manuscriptCommand(intent.kind);
  if (
    row.command !== command ||
    Buffer.from(row.payload_sha256).toString("hex") !== manuscriptIntentHash(projectId, intent)
  )
    return failure("operation_conflict");
  const receipt = await manuscriptReceiptResult(db, command, operationId, row.result_id);
  const revision = receipt.manuscriptChange.revision;
  if (
    revision.projectId !== projectId ||
    (intent.kind === "save" && revision.draftId !== intent.draftId)
  )
    return failure("operation_conflict");
  return { ok: true, value: { projectId, operationId, receipt } };
}

export async function listManuscripts(
  db: Database,
  { projectId, after }: ResearchInputs["manuscript.list"],
): Promise<Outcome<ResearchOutputs["manuscript.list"]>> {
  const project = await confirmedProject(db, projectId);
  if (!project.ok) return project;
  let query = db
    .selectFrom("drafts")
    .select(["id", "title", "current_revision_id"])
    .where("project_id", "=", project.value.id);
  if (after) query = query.where("id", ">", bytes(after));
  const rows = await query
    .orderBy("id")
    .limit(manuscriptPageSize + 1)
    .execute();
  const manuscripts = rows.slice(0, manuscriptPageSize).map((row) => ({
    draftId: identifier(row.id),
    title: row.title,
    currentRevisionId: identifier(row.current_revision_id),
  }));
  return {
    ok: true,
    value: {
      projectId,
      manuscripts,
      next: rows.length > manuscriptPageSize ? (manuscripts.at(-1)?.draftId ?? null) : null,
    },
  };
}

export async function readManuscript(
  db: Database,
  { projectId, draftId, revisionId }: ResearchInputs["manuscript.read"],
): Promise<Outcome<ResearchOutputs["manuscript.read"]>> {
  const project = await confirmedProject(db, projectId);
  if (!project.ok) return project;
  const query = revisionQuery(db, project.value.id, draftId);
  const row = await (
    revisionId === null
      ? query.whereRef("r.id", "=", "d.current_revision_id")
      : query.where("r.id", "=", bytes(revisionId))
  ).executeTakeFirst();
  if (!row) return failure("record_not_found");
  retainedDocument(row);
  const revision = metadata(projectId, row);
  return { ok: true, value: { revision, markdown: storedText(row.markdown, revision.revisionId) } };
}

export async function readManuscriptPart(
  db: Database,
  { projectId, draftId, revisionId, index }: ResearchInputs["manuscript.readPart"],
): Promise<Outcome<ResearchOutputs["manuscript.readPart"]>> {
  const project = await confirmedProject(db, projectId);
  if (!project.ok) return project;
  const row = await revisionQuery(db, project.value.id, draftId)
    .where("r.id", "=", bytes(revisionId))
    .executeTakeFirst();
  if (!row) return failure("record_not_found");
  retainedDocument(row);
  const text = splitText(row.markdown)[index - 1];
  return text
    ? { ok: true, value: { projectId, draftId, revisionId, index, text } }
    : failure("record_not_found");
}
