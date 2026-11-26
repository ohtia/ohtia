import { sql } from "kysely";
import { objects as previous } from "./0038_project_title_revision.mjs";

/** @param {string} name */
const uuid = (name) =>
  `typeof(${name})='blob' AND length(${name})=16 AND substr(hex(${name}),13,1)='7' AND substr(hex(${name}),17,1) IN ('8','9','A','B')`;

export const tables = {
  thesis_profile_revisions: `CREATE TABLE thesis_profile_revisions (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id),
    revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
    previous_revision_id BLOB,
    operation_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    content TEXT NOT NULL CHECK (typeof(content)='text' AND length(CAST(content AS BLOB)) BETWEEN 1 AND 32768 AND json_valid(content) AND json_type(content)='object'),
    changed_fields TEXT NOT NULL CHECK (typeof(changed_fields)='text' AND json_valid(changed_fields) AND json_type(changed_fields)='array'),
    UNIQUE (project_id,id),
    UNIQUE (project_id,revision),
    FOREIGN KEY (project_id,previous_revision_id) REFERENCES thesis_profile_revisions(project_id,id),
    CHECK ((revision=1 AND previous_revision_id IS NULL) OR (revision>1 AND previous_revision_id IS NOT NULL))
  )`,
  thesis_profile_heads: `CREATE TABLE thesis_profile_heads (
    project_id BLOB PRIMARY KEY NOT NULL REFERENCES projects(id),
    revision_id BLOB NOT NULL,
    FOREIGN KEY (project_id,revision_id) REFERENCES thesis_profile_revisions(project_id,id)
  )`,
  thesis_profile_proposals: `CREATE TABLE thesis_profile_proposals (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id),
    attempt_id BLOB NOT NULL REFERENCES attempts(id),
    base_revision_id BLOB,
    field TEXT NOT NULL CHECK (typeof(field)='text' AND length(field) BETWEEN 1 AND 64),
    proposed_value TEXT NOT NULL CHECK (typeof(proposed_value)='text' AND length(CAST(proposed_value AS BLOB)) BETWEEN 1 AND 32768 AND json_valid(proposed_value)),
    FOREIGN KEY (project_id,base_revision_id) REFERENCES thesis_profile_revisions(project_id,id)
  )`,
};

export const objects = {
  receipts_commands: previous.receipts_commands.replace("'project.rename'", "'project.rename','profile.save'"),
  thesis_profile_revision_sequence: `CREATE TRIGGER thesis_profile_revision_sequence BEFORE INSERT ON thesis_profile_revisions
    WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.project_type='thesis' AND p.setup_confirmed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM command_receipts WHERE operation_id=NEW.operation_id)
      OR NEW.previous_revision_id IS NOT (SELECT revision_id FROM thesis_profile_heads WHERE project_id=NEW.project_id)
      OR NEW.revision<>coalesce((SELECT revision FROM thesis_profile_revisions WHERE id=NEW.previous_revision_id),0)+1
    BEGIN SELECT RAISE(ABORT,'Invalid thesis profile predecessor'); END`,
  thesis_profile_head_initial: `CREATE TRIGGER thesis_profile_head_initial BEFORE INSERT ON thesis_profile_heads
    WHEN NOT EXISTS (SELECT 1 FROM thesis_profile_revisions r WHERE r.project_id=NEW.project_id AND r.id=NEW.revision_id AND r.revision=1)
    BEGIN SELECT RAISE(ABORT,'Invalid initial thesis profile pointer'); END`,
  thesis_profile_head_advance: `CREATE TRIGGER thesis_profile_head_advance BEFORE UPDATE ON thesis_profile_heads
    WHEN NEW.project_id IS NOT OLD.project_id OR NOT EXISTS (SELECT 1 FROM thesis_profile_revisions r
      WHERE r.project_id=NEW.project_id AND r.id=NEW.revision_id AND r.previous_revision_id=OLD.revision_id)
    BEGIN SELECT RAISE(ABORT,'Invalid thesis profile pointer advance'); END`,
  thesis_profile_head_delete: `CREATE TRIGGER thesis_profile_head_delete BEFORE DELETE ON thesis_profile_heads
    BEGIN SELECT RAISE(ABORT,'Thesis profile pointer is required'); END`,
  thesis_profile_receipt_scope: `CREATE TRIGGER thesis_profile_receipt_scope BEFORE INSERT ON command_receipts
    WHEN (NEW.command='profile.save' AND NOT EXISTS (SELECT 1 FROM thesis_profile_revisions r
      JOIN thesis_profile_heads h ON h.project_id=r.project_id AND h.revision_id=r.id
      WHERE r.id=NEW.result_id AND r.operation_id=NEW.operation_id))
      OR (NEW.command<>'profile.save' AND EXISTS (SELECT 1 FROM thesis_profile_revisions WHERE operation_id=NEW.operation_id))
    BEGIN SELECT RAISE(ABORT,'Invalid thesis profile receipt'); END`,
  thesis_profile_revision_update: `CREATE TRIGGER thesis_profile_revision_update BEFORE UPDATE ON thesis_profile_revisions
    BEGIN SELECT RAISE(ABORT,'Immutable thesis profile revision'); END`,
  thesis_profile_revision_delete: `CREATE TRIGGER thesis_profile_revision_delete BEFORE DELETE ON thesis_profile_revisions
    BEGIN SELECT RAISE(ABORT,'Immutable thesis profile revision'); END`,
  thesis_profile_proposal_scope: `CREATE TRIGGER thesis_profile_proposal_scope BEFORE INSERT ON thesis_profile_proposals
    WHEN NOT EXISTS (SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
      WHERE a.id=NEW.attempt_id AND a.state='completed' AND t.project_id=NEW.project_id AND t.operation='direct_guidance')
    BEGIN SELECT RAISE(ABORT,'Invalid thesis profile proposal producer'); END`,
  thesis_profile_proposal_update: `CREATE TRIGGER thesis_profile_proposal_update BEFORE UPDATE ON thesis_profile_proposals
    BEGIN SELECT RAISE(ABORT,'Immutable thesis profile proposal'); END`,
  thesis_profile_proposal_delete: `CREATE TRIGGER thesis_profile_proposal_delete BEFORE DELETE ON thesis_profile_proposals
    BEGIN SELECT RAISE(ABORT,'Immutable thesis profile proposal'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  for (const statement of Object.values(tables)) await sql.raw(statement).execute(db);
  await sql.raw("DROP TRIGGER receipts_commands").execute(db);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
}
