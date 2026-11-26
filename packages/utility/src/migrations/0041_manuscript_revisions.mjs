import { sql } from "kysely";
import { objects as previous } from "./0040_research_stages.mjs";

/** @param {string} name */
const uuid = (name) =>
  `typeof(${name})='blob' AND length(${name})=16 AND substr(hex(${name}),13,1)='7' AND substr(hex(${name}),17,1) IN ('8','9','A','B')`;

export const tables = {
  drafts: `CREATE TABLE drafts (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL CHECK (typeof(title)='text' AND length(title) BETWEEN 1 AND 200 AND instr(title,char(0))=0),
    current_revision_id BLOB NOT NULL,
    FOREIGN KEY(id,current_revision_id) REFERENCES draft_revisions(draft_id,id) DEFERRABLE INITIALLY DEFERRED
  )`,
  draft_revisions: `CREATE TABLE draft_revisions (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    draft_id BLOB NOT NULL REFERENCES drafts(id),
    parent_revision_id BLOB,
    restoration_origin_id BLOB,
    markdown TEXT NOT NULL CHECK (typeof(markdown)='text' AND length(CAST(markdown AS BLOB)) BETWEEN 1 AND 131072 AND instr(markdown,char(0))=0),
    language TEXT CHECK (language IS NULL OR (typeof(language)='text' AND length(language) BETWEEN 1 AND 255 AND language NOT GLOB '*[^a-zA-Z0-9-]*')),
    created_at TEXT NOT NULL CHECK (typeof(created_at)='text' AND length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+0 seconds') IS created_at),
    save_reason TEXT NOT NULL CHECK (save_reason IN ('initial','manual','autosave','restoration')),
    content_sha256 BLOB NOT NULL CHECK (typeof(content_sha256)='blob' AND length(content_sha256)=32),
    author_kind TEXT NOT NULL CHECK (author_kind='researcher'),
    recording_actor TEXT NOT NULL CHECK (recording_actor='utility'),
    operation_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE(draft_id,id),
    UNIQUE(draft_id,parent_revision_id),
    FOREIGN KEY(draft_id,parent_revision_id) REFERENCES draft_revisions(draft_id,id),
    FOREIGN KEY(draft_id,restoration_origin_id) REFERENCES draft_revisions(draft_id,id),
    CHECK ((save_reason='initial')=(parent_revision_id IS NULL)),
    CHECK ((save_reason='restoration')=(restoration_origin_id IS NOT NULL)),
    CHECK (parent_revision_id IS NOT id AND restoration_origin_id IS NOT id)
  )`,
  draft_unit_ids: `CREATE TABLE draft_unit_ids (
    unit_id TEXT NOT NULL CHECK (typeof(unit_id)='text' AND length(unit_id) BETWEEN 5 AND 131072
      AND substr(unit_id,1,4) IN ('sec_','blk_') AND substr(unit_id,5) NOT GLOB '*[^a-z0-9-]*' AND instr(unit_id,char(0))=0),
    draft_id BLOB NOT NULL,
    first_revision_id BLOB NOT NULL,
    PRIMARY KEY(draft_id,unit_id),
    FOREIGN KEY(draft_id,first_revision_id) REFERENCES draft_revisions(draft_id,id)
  )`,
};

export const objects = {
  receipts_commands: previous.receipts_commands.replace("'stage.complete'", "'stage.complete','manuscript.create','manuscript.save'"),
  drafts_project: "CREATE INDEX drafts_project ON drafts(project_id,id)",
  draft_initial: `CREATE TRIGGER draft_initial BEFORE INSERT ON drafts
    WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND project_type='thesis' AND setup_confirmed_at IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Manuscript requires a confirmed thesis'); END`,
  draft_advance: `CREATE TRIGGER draft_advance BEFORE UPDATE ON drafts
    WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.title<>OLD.title
      OR NOT EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id=OLD.id AND id=NEW.current_revision_id AND parent_revision_id=OLD.current_revision_id)
    BEGIN SELECT RAISE(ABORT,'Invalid manuscript pointer advancement'); END`,
  draft_revision_append: `CREATE TRIGGER draft_revision_append BEFORE INSERT ON draft_revisions
    WHEN EXISTS (SELECT 1 FROM command_receipts WHERE operation_id=NEW.operation_id)
      OR NOT EXISTS (SELECT 1 FROM drafts d JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.draft_id
        AND ((NEW.parent_revision_id IS NULL AND d.current_revision_id=NEW.id AND NOT EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id=d.id))
          OR NEW.parent_revision_id=d.current_revision_id)
        AND (NEW.save_reason='restoration' OR NEW.language=p.document_language))
    BEGIN SELECT RAISE(ABORT,'Invalid manuscript revision predecessor or language'); END`,
  draft_revision_advance: `CREATE TRIGGER draft_revision_advance AFTER INSERT ON draft_revisions
    WHEN NEW.parent_revision_id IS NOT NULL
    BEGIN UPDATE drafts SET current_revision_id=NEW.id WHERE id=NEW.draft_id; END`,
  draft_receipt_scope: `CREATE TRIGGER draft_receipt_scope BEFORE INSERT ON command_receipts
    WHEN (NEW.command='manuscript.create' AND NOT EXISTS (SELECT 1 FROM draft_revisions
      WHERE id=NEW.result_id AND operation_id=NEW.operation_id AND save_reason='initial'))
      OR (NEW.command='manuscript.save' AND NOT EXISTS (SELECT 1 FROM draft_revisions r JOIN drafts d ON d.id=r.draft_id
        WHERE r.id=NEW.result_id AND d.current_revision_id=r.id
          AND (r.operation_id<>NEW.operation_id OR r.save_reason IN ('manual','autosave'))))
      OR EXISTS (SELECT 1 FROM draft_revisions r WHERE r.operation_id=NEW.operation_id AND
        (NEW.command NOT IN ('manuscript.create','manuscript.save') OR r.id<>NEW.result_id))
    BEGIN SELECT RAISE(ABORT,'Invalid manuscript receipt'); END`,
  draft_unit_claim: `CREATE TRIGGER draft_unit_claim BEFORE INSERT ON draft_unit_ids
    WHEN EXISTS (SELECT 1 FROM draft_revisions r JOIN command_receipts c ON c.operation_id=r.operation_id WHERE r.id=NEW.first_revision_id)
    BEGIN SELECT RAISE(ABORT,'Manuscript unit claim requires a pending revision'); END`,
  draft_revision_update: `CREATE TRIGGER draft_revision_update BEFORE UPDATE ON draft_revisions
    BEGIN SELECT RAISE(ABORT,'Immutable manuscript revision'); END`,
  draft_revision_delete: `CREATE TRIGGER draft_revision_delete BEFORE DELETE ON draft_revisions
    BEGIN SELECT RAISE(ABORT,'Immutable manuscript revision'); END`,
  draft_unit_update: `CREATE TRIGGER draft_unit_update BEFORE UPDATE ON draft_unit_ids
    BEGIN SELECT RAISE(ABORT,'Immutable manuscript unit identity'); END`,
  draft_unit_delete: `CREATE TRIGGER draft_unit_delete BEFORE DELETE ON draft_unit_ids
    BEGIN SELECT RAISE(ABORT,'Immutable manuscript unit identity'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  for (const statement of Object.values(tables)) await sql.raw(statement).execute(db);
  await sql.raw("DROP TRIGGER receipts_commands").execute(db);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
}
