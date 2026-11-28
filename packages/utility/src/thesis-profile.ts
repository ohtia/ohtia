import {
  canonicalJson,
  decodeProfileContent,
  decodeStoredProfileContent,
  profileSchemaVersion,
  failure,
  isProfileField,
  isResearchId,
  profileRevisionBytes,
  splitText,
  staleRevision,
  utf8Size,
  type Outcome,
  type ProfileContent,
  type ProfileField,
  type ProfileFields,
  type ProfileReadResult,
  type ProfileReceiptResult,
  type ProfileRevision,
  type ProfileSaveResult,
  type ResearchInputs,
  type ResearchPayloads,
} from "@ohtia/contracts";
import type { Kysely } from "kysely";
import { bytes, identifier, newId, type ResearchSchema } from "./research.js";
import { digest, storedText } from "./research-text.js";

export interface ThesisProfileRevisionRow {
  id: Uint8Array;
  project_id: Uint8Array;
  revision: number;
  previous_revision_id: Uint8Array | null;
  content: string;
  changed_fields: string;
  operation_id: string;
}
export interface ThesisProfileSchema {
  thesis_profile_revisions: ThesisProfileRevisionRow;
  thesis_profile_heads: { project_id: Uint8Array; revision_id: Uint8Array };
  thesis_profile_proposals: {
    id: Uint8Array;
    project_id: Uint8Array;
    attempt_id: Uint8Array;
    base_revision_id: Uint8Array | null;
    field: ProfileField;
    proposed_value: string;
  };
}

type Save = ResearchPayloads["profile.save"];
export function profileSaveHash(input: Pick<ResearchInputs["profile.save"], keyof Save>): string {
  return digest(
    canonicalJson({
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      patchHash: typeof input.patch === "string" ? digest(input.patch) : input.patch.sha256,
    }),
  );
}

export async function confirmedThesis(
  db: Kysely<ResearchSchema>,
  projectId: string,
): Promise<Outcome<Buffer>> {
  if (!isResearchId(projectId)) return failure("invalid_message");
  const id = bytes(projectId);
  const project = await db
    .selectFrom("projects")
    .select("setup_confirmed_at")
    .where("id", "=", id)
    .where("project_type", "=", "thesis")
    .executeTakeFirst();
  if (!project) return failure("record_not_found");
  return project.setup_confirmed_at ? { ok: true, value: id } : failure("project_in_setup");
}

async function currentRevision(db: Kysely<ResearchSchema>, project: Uint8Array) {
  return db
    .selectFrom("thesis_profile_heads as h")
    .innerJoin("thesis_profile_revisions as r", "r.id", "h.revision_id")
    .selectAll("r")
    .where("h.project_id", "=", project)
    .executeTakeFirst();
}

export async function currentProfileIdentity(db: Kysely<ResearchSchema>, project: Uint8Array) {
  const row = await db
    .selectFrom("thesis_profile_heads")
    .select("revision_id")
    .where("project_id", "=", project)
    .executeTakeFirst();
  return row ? identifier(row.revision_id) : null;
}

export async function currentProfileNumber(db: Kysely<ResearchSchema>, project: Uint8Array) {
  return (
    await db
      .selectFrom("thesis_profile_heads as h")
      .innerJoin("thesis_profile_revisions as r", "r.id", "h.revision_id")
      .select("r.revision")
      .where("h.project_id", "=", project)
      .executeTakeFirst()
  )?.revision;
}

function metadata(row: ThesisProfileRevisionRow): ProfileRevision {
  const changed: unknown = JSON.parse(row.changed_fields);
  if (!Array.isArray(changed) || !changed.every(isProfileField))
    throw new Error("Invalid stored thesis profile change set.");
  return {
    revisionId: identifier(row.id),
    revision: row.revision,
    previousRevisionId: row.previous_revision_id && identifier(row.previous_revision_id),
    changedFields: changed,
  };
}

function storedProfile(encoded: string): ProfileContent {
  const decoded = decodeStoredProfileContent(encoded);
  if (!decoded) throw new Error("Invalid stored thesis profile content.");
  return decoded;
}

export async function messageArtifactExists(
  db: Kysely<ResearchSchema>,
  project: Uint8Array,
  messageId: string,
): Promise<boolean> {
  const message = await db
    .selectFrom("messages as m")
    .innerJoin("conversations as c", "c.id", "m.conversation_id")
    .select("m.id")
    .where("m.id", "=", bytes(messageId))
    .where("c.project_id", "=", project)
    .where((eb) => eb.or([eb("m.author_kind", "=", "researcher"), eb("m.ending", "=", "complete")]))
    .executeTakeFirst();
  return !!message;
}

async function verifyOrigins(
  db: Kysely<ResearchSchema>,
  project: Uint8Array,
  previous: ThesisProfileRevisionRow | undefined,
  existing: ProfileFields,
  patch: ProfileContent,
): Promise<boolean> {
  for (const field of Object.keys(patch.fields).filter(isProfileField)) {
    const fact = patch.fields[field];
    if (fact?.state !== "known") continue;
    for (const item of "items" in fact ? fact.items : [fact]) {
      const origin = item.origin;
      if (
        origin.kind === "artifact_version" &&
        !(await messageArtifactExists(db, project, origin.id))
      )
        return false;
      if (origin.kind === "adopted_proposal") {
        const proposal = await db
          .selectFrom("thesis_profile_proposals")
          .select(["base_revision_id", "proposed_value"])
          .where("id", "=", bytes(origin.proposalId))
          .where("project_id", "=", project)
          .where("attempt_id", "=", bytes(origin.attemptId))
          .where("field", "=", field)
          .executeTakeFirst();
        // An unchanged item may retain its historical adoption when another list item is edited.
        const prior = existing[field];
        const priorItems =
          prior?.state === "known" ? ("items" in prior ? prior.items : [prior]) : [];
        if (
          !proposal ||
          !adoptedValue(field, proposal.proposed_value, item.value) ||
          ((proposal.base_revision_id && identifier(proposal.base_revision_id)) !==
            (previous ? identifier(previous.id) : null) &&
            !priorItems.some((old) => canonicalJson(old) === canonicalJson(item)))
        )
          return false;
      }
    }
  }
  return true;
}

/**
 * A proposed milestone stored before schema version 2 has no done mark; it matches the same
 * milestone read as not done. The stored proposal stays unchanged.
 */
function adoptedValue(field: string, proposed: string, value: unknown): boolean {
  if (proposed === canonicalJson(value)) return true;
  if (field !== "milestones") return false;
  const legacy: unknown = JSON.parse(proposed);
  return (
    legacy !== null &&
    typeof legacy === "object" &&
    !Array.isArray(legacy) &&
    !Object.hasOwn(legacy, "done") &&
    canonicalJson({ ...legacy, done: false }) === canonicalJson(value)
  );
}

/** Runs inside the same writer transaction that inserts the command receipt. */
export async function saveProfile(
  db: Kysely<ResearchSchema>,
  input: Save,
  operationId: string,
): Promise<Outcome<Uint8Array>> {
  if (
    typeof input.patch !== "string" ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    return failure("invalid_message");
  const patch = decodeProfileContent(input.patch);
  if (!patch) return failure("invalid_message");
  const project = await confirmedThesis(db, input.projectId);
  if (!project.ok) return project;
  const previous = await currentRevision(db, project.value);
  const version = previous?.revision ?? 0;
  if (input.expectedRevision !== version) return staleRevision(version);
  if (version === Number.MAX_SAFE_INTEGER) return failure("limit_reached");
  const existing = previous ? storedProfile(previous.content).fields : {};
  const next = canonicalJson({
    schemaVersion: profileSchemaVersion,
    fields: { ...existing, ...patch.fields },
  });
  if (utf8Size(next) > profileRevisionBytes) return failure("limit_reached");
  if (!(await verifyOrigins(db, project.value, previous, existing, patch)))
    return failure("record_not_found");
  const changed = Object.keys(patch.fields)
    .filter((key) => {
      if (!isProfileField(key)) return false;
      const old = existing[key];
      return old === undefined || canonicalJson(old) !== canonicalJson(patch.fields[key]);
    })
    .sort();
  const id = newId();
  await db
    .insertInto("thesis_profile_revisions")
    .values({
      id,
      project_id: project.value,
      revision: version + 1,
      previous_revision_id: previous?.id ?? null,
      content: next,
      changed_fields: canonicalJson(changed),
      operation_id: operationId,
    })
    .execute();
  if (previous) {
    await db
      .updateTable("thesis_profile_heads")
      .set({ revision_id: id })
      .where("project_id", "=", project.value)
      .execute();
  } else {
    await db
      .insertInto("thesis_profile_heads")
      .values({ project_id: project.value, revision_id: id })
      .execute();
  }
  return { ok: true, value: id };
}

async function exactRevision(db: Kysely<ResearchSchema>, project: Uint8Array, revision: string) {
  return db
    .selectFrom("thesis_profile_revisions")
    .selectAll()
    .where("project_id", "=", project)
    .where("id", "=", bytes(revision))
    .executeTakeFirst();
}

export async function readProfile(
  db: Kysely<ResearchSchema>,
  input: ResearchInputs["profile.read"],
): Promise<Outcome<ProfileReadResult>> {
  const { projectId, revisionId } = input;
  const project = await confirmedThesis(db, projectId);
  if (!project.ok) return project;
  const row =
    revisionId === null
      ? await currentRevision(db, project.value)
      : await exactRevision(db, project.value, revisionId);
  if (!row)
    return revisionId === null
      ? { ok: true, value: { projectId, profile: null } }
      : failure("record_not_found");
  storedProfile(row.content);
  const revision = metadata(row);
  return {
    ok: true,
    value: {
      projectId,
      profile: { ...revision, content: storedText(row.content, revision.revisionId) },
    },
  };
}

export async function readProfilePart(
  db: Kysely<ResearchSchema>,
  input: ResearchInputs["profile.readPart"],
) {
  const { projectId, revisionId, index } = input;
  const project = await confirmedThesis(db, projectId);
  if (!project.ok) return project;
  const row = await exactRevision(db, project.value, revisionId);
  if (!row) return failure("record_not_found");
  storedProfile(row.content);
  const text = splitText(row.content)[index - 1];
  return text === undefined
    ? failure("record_not_found")
    : { ok: true as const, value: { projectId, revisionId, index, text } };
}

export async function profileReceiptResult(
  db: Kysely<ResearchSchema>,
  operationId: string,
  revisionId: Uint8Array,
): Promise<ProfileSaveResult> {
  const row = await db
    .selectFrom("thesis_profile_revisions")
    .selectAll()
    .where("operation_id", "=", operationId)
    .where("id", "=", revisionId)
    .executeTakeFirstOrThrow();
  return {
    resultId: identifier(row.id),
    profileChange: { projectId: identifier(row.project_id), revision: metadata(row) },
  };
}

export async function readProfileReceipt(
  db: Kysely<ResearchSchema>,
  input: ResearchInputs["profile.receipt"],
): Promise<Outcome<ProfileReceiptResult>> {
  const { projectId, operationId } = input;
  const project = await confirmedThesis(db, projectId);
  if (!project.ok) return project;
  const row = await db
    .selectFrom("command_receipts")
    .selectAll()
    .where("operation_id", "=", operationId)
    .executeTakeFirst();
  if (!row) return { ok: true, value: { projectId, operationId, receipt: null } };
  if (
    row.command !== "profile.save" ||
    Buffer.from(row.payload_sha256).toString("hex") !== profileSaveHash(input)
  )
    return failure("operation_conflict");
  const receipt = await profileReceiptResult(db, operationId, row.result_id);
  if (receipt.profileChange.projectId !== projectId) return failure("operation_conflict");
  return { ok: true, value: { projectId, operationId, receipt } };
}
