import { sql } from "kysely";
import { objects as composerObjects } from "./0014_message_composer.mjs";

/** @param {string} field */
const uuid = (field) => `typeof(${field})='blob' AND length(${field})=16 AND substr(hex(${field}),13,1)='7' AND substr(hex(${field}),17,1) IN ('8','9','A','B')`;
/** @param {string} field */
const time = (field) => `typeof(${field})='text' AND length(${field})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds')=${field}`;
export const tables = {
  project_setup_proposals: `CREATE TABLE project_setup_proposals (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id) CHECK (${uuid("project_id")}),
    task_id BLOB NOT NULL UNIQUE REFERENCES tasks(id) CHECK (${uuid("task_id")}),
    attempt_id BLOB NOT NULL UNIQUE REFERENCES attempts(id) CHECK (${uuid("attempt_id")}),
    arguments_json TEXT NOT NULL CHECK (typeof(arguments_json)='text' AND json_valid(arguments_json) AND json_type(arguments_json)='object'),
    title TEXT NOT NULL CHECK (typeof(title)='text'),
    document_language TEXT NOT NULL CHECK (typeof(document_language)='text'),
    state TEXT NOT NULL CHECK (state IN ('proposed','replaced','rejected','confirmed','invalid')),
    invalid_reason TEXT CHECK (invalid_reason IN ('title_empty','title_whitespace','title_too_long','title_invalid','language_malformed','language_unknown','multiple_calls')),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    decided_at TEXT CHECK (decided_at IS NULL OR (${time("decided_at")})),
    decided_by_operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((state='invalid' AND invalid_reason IS NOT NULL) OR (state<>'invalid' AND invalid_reason IS NULL)),
    CHECK ((state IN ('proposed','invalid') AND decided_at IS NULL AND decided_by_operation_id IS NULL)
      OR (state='replaced' AND decided_at IS NOT NULL AND decided_by_operation_id IS NULL)
      OR (state IN ('rejected','confirmed') AND decided_at IS NOT NULL AND decided_by_operation_id IS NOT NULL))
  )`,
};
export const objects = {
  receipts_commands: composerObjects.receipts_commands.replace("'project.confirmSetup'", "'project.confirmSetup','project.rejectSetup'"),
  setup_one_waiting: "CREATE UNIQUE INDEX setup_one_waiting ON project_setup_proposals(project_id) WHERE state='proposed'",
  setup_one_confirmed: "CREATE UNIQUE INDEX setup_one_confirmed ON project_setup_proposals(project_id) WHERE state='confirmed'",
  setup_initial: `CREATE TRIGGER setup_initial BEFORE INSERT ON project_setup_proposals
    WHEN NEW.state NOT IN ('proposed','invalid') OR
      NOT EXISTS (SELECT 1 FROM tasks t JOIN attempts a ON a.task_id=t.id JOIN projects p ON p.id=t.project_id
        WHERE t.id=NEW.task_id AND a.id=NEW.attempt_id AND t.project_id=NEW.project_id
          AND t.operation='project_setup' AND t.state='running' AND a.state='completed' AND p.setup_confirmed_at IS NULL)
    BEGIN SELECT RAISE(ABORT,'Invalid initial setup proposal'); END`,
  setup_changes: `CREATE TRIGGER setup_changes BEFORE UPDATE ON project_setup_proposals
    WHEN OLD.state<>'proposed' OR NEW.state NOT IN ('replaced','rejected','confirmed')
      OR NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.task_id<>OLD.task_id OR NEW.attempt_id<>OLD.attempt_id
      OR NEW.arguments_json<>OLD.arguments_json OR NEW.title<>OLD.title OR NEW.document_language<>OLD.document_language OR NEW.invalid_reason IS NOT OLD.invalid_reason OR NEW.created_at<>OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Invalid setup proposal change'); END`,
  setup_delete: `CREATE TRIGGER setup_delete BEFORE DELETE ON project_setup_proposals
    BEGIN SELECT RAISE(ABORT,'Immutable setup proposal'); END`,
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw("DROP TRIGGER receipts_commands").execute(database);
  for (const statement of [...Object.values(tables), ...Object.values(objects)]) await sql.raw(statement).execute(database);
}
