import { sql } from "kysely";
import { objects as previous } from "./0039_thesis_profile.mjs";

/** @param {string} name */
const uuid = (name) =>
  `typeof(${name})='blob' AND length(${name})=16 AND substr(hex(${name}),13,1)='7' AND substr(hex(${name}),17,1) IN ('8','9','A','B')`;

export const tables = {
  research_stage_decisions: `CREATE TABLE research_stage_decisions (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id),
    stage TEXT NOT NULL CHECK (stage IN ('onboarding','topic_problem','literature','methodology','investigate','describe','interpret')),
    revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
    project_order INTEGER NOT NULL CHECK (typeof(project_order)='integer' AND project_order BETWEEN 1 AND 9007199254740991),
    kind TEXT NOT NULL CHECK (kind IN ('enter','reopen','complete')),
    preceding_state TEXT NOT NULL CHECK (preceding_state IN ('not-started','in-progress','done')),
    previous_decision_id BLOB,
    profile_revision_id BLOB,
    operation_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    actor TEXT NOT NULL CHECK (actor='researcher'),
    observed_at TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason))>0 AND length(CAST(reason AS BLOB))<=1024),
    remaining_conditions TEXT NOT NULL CHECK (json_valid(remaining_conditions) AND json_type(remaining_conditions)='array' AND json_array_length(remaining_conditions)<=8 AND length(CAST(remaining_conditions AS BLOB))<=12313),
    next_review_condition TEXT CHECK (next_review_condition IS NULL OR (length(trim(next_review_condition))>0 AND length(CAST(next_review_condition AS BLOB))<=512)),
    UNIQUE(project_id,stage,id),
    UNIQUE(project_id,stage,revision),
    UNIQUE(project_id,project_order),
    FOREIGN KEY(project_id,stage,previous_decision_id) REFERENCES research_stage_decisions(project_id,stage,id),
    FOREIGN KEY(project_id,profile_revision_id) REFERENCES thesis_profile_revisions(project_id,id),
    CHECK ((kind='enter' AND revision=1 AND preceding_state='not-started' AND previous_decision_id IS NULL AND next_review_condition IS NULL)
      OR (kind='complete' AND revision>1 AND preceding_state='in-progress' AND previous_decision_id IS NOT NULL AND next_review_condition IS NULL)
      OR (kind='reopen' AND revision>2 AND preceding_state='done' AND previous_decision_id IS NOT NULL AND next_review_condition IS NOT NULL))
  )`,
  research_stage_artifacts: `CREATE TABLE research_stage_artifacts (
    decision_id BLOB NOT NULL REFERENCES research_stage_decisions(id),
    position INTEGER NOT NULL CHECK (typeof(position)='integer' AND position BETWEEN 1 AND 16),
    message_id BLOB NOT NULL REFERENCES messages(id),
    PRIMARY KEY(decision_id,position),
    UNIQUE(decision_id,message_id)
  )`,
};

export const objects = {
  receipts_commands: previous.receipts_commands.replace("'profile.save'", "'profile.save','stage.transition','stage.complete'"),
  research_stage_decision_append: `CREATE TRIGGER research_stage_decision_append BEFORE INSERT ON research_stage_decisions
    WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND project_type='thesis' AND setup_confirmed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM command_receipts WHERE operation_id=NEW.operation_id)
      OR NEW.project_order<>coalesce((SELECT max(project_order) FROM research_stage_decisions WHERE project_id=NEW.project_id),0)+1
      OR NEW.revision<>coalesce((SELECT max(revision) FROM research_stage_decisions WHERE project_id=NEW.project_id AND stage=NEW.stage),0)+1
      OR (NEW.kind<>'enter' AND NOT EXISTS (SELECT 1 FROM research_stage_decisions
        WHERE id=NEW.previous_decision_id AND project_id=NEW.project_id AND stage=NEW.stage AND revision=NEW.revision-1
          AND ((NEW.kind='reopen' AND kind='complete') OR (NEW.kind='complete' AND kind IN ('enter','reopen')))))
    BEGIN SELECT RAISE(ABORT,'Invalid research stage predecessor'); END`,
  research_stage_receipt_scope: `CREATE TRIGGER research_stage_receipt_scope BEFORE INSERT ON command_receipts
    WHEN (NEW.command IN ('stage.transition','stage.complete') AND NOT EXISTS (SELECT 1 FROM research_stage_decisions
      WHERE id=NEW.result_id AND operation_id=NEW.operation_id
        AND ((NEW.command='stage.complete' AND kind='complete') OR (NEW.command='stage.transition' AND kind IN ('enter','reopen')))))
      OR (NEW.command NOT IN ('stage.transition','stage.complete') AND EXISTS (SELECT 1 FROM research_stage_decisions WHERE operation_id=NEW.operation_id))
    BEGIN SELECT RAISE(ABORT,'Invalid research stage receipt'); END`,
  research_stage_artifact_scope: `CREATE TRIGGER research_stage_artifact_scope BEFORE INSERT ON research_stage_artifacts
    WHEN NOT EXISTS (SELECT 1 FROM research_stage_decisions d
      JOIN conversations c ON c.project_id=d.project_id
      JOIN messages m ON m.conversation_id=c.id
      WHERE d.id=NEW.decision_id AND m.id=NEW.message_id AND (m.author_kind='researcher' OR m.ending='complete')
        AND NOT EXISTS (SELECT 1 FROM command_receipts WHERE operation_id=d.operation_id))
    BEGIN SELECT RAISE(ABORT,'Invalid research stage artifact'); END`,
  research_stage_decision_update: `CREATE TRIGGER research_stage_decision_update BEFORE UPDATE ON research_stage_decisions
    BEGIN SELECT RAISE(ABORT,'Immutable research stage decision'); END`,
  research_stage_decision_delete: `CREATE TRIGGER research_stage_decision_delete BEFORE DELETE ON research_stage_decisions
    BEGIN SELECT RAISE(ABORT,'Immutable research stage decision'); END`,
  research_stage_artifact_update: `CREATE TRIGGER research_stage_artifact_update BEFORE UPDATE ON research_stage_artifacts
    BEGIN SELECT RAISE(ABORT,'Immutable research stage artifact'); END`,
  research_stage_artifact_delete: `CREATE TRIGGER research_stage_artifact_delete BEFORE DELETE ON research_stage_artifacts
    BEGIN SELECT RAISE(ABORT,'Immutable research stage artifact'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  for (const statement of Object.values(tables)) await sql.raw(statement).execute(db);
  await sql.raw("DROP TRIGGER receipts_commands").execute(db);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
}
