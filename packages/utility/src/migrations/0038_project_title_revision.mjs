import { sql } from "kysely";
import { objects as previous } from "./0034_agent_preferences.mjs";

export const titleRevision =
  "title_revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(title_revision)='integer' AND title_revision BETWEEN 1 AND 9007199254740991)";
export const historySchema = `CREATE TABLE project_title_history (
    operation_id TEXT PRIMARY KEY NOT NULL REFERENCES command_receipts(operation_id),
    project_id BLOB NOT NULL REFERENCES projects(id),
    previous_title TEXT NOT NULL,
    title TEXT NOT NULL,
    previous_revision INTEGER NOT NULL CHECK (typeof(previous_revision)='integer' AND previous_revision BETWEEN 1 AND 9007199254740991),
    title_revision INTEGER NOT NULL CHECK (typeof(title_revision)='integer' AND title_revision BETWEEN 1 AND 9007199254740991),
    CHECK ((title=previous_title AND title_revision=previous_revision) OR (title<>previous_title AND title_revision=previous_revision+1))
  )`;
export const objects = {
  receipts_commands: previous.receipts_commands.replace("'project.open'", "'project.open','project.rename'"),
  projects_title_revision: `CREATE TRIGGER projects_title_revision BEFORE UPDATE ON projects
    WHEN NEW.title_revision<>OLD.title_revision+(
      OLD.setup_confirmed_at IS NOT NULL AND NEW.setup_confirmed_at IS NOT NULL AND NEW.title IS NOT OLD.title
    )
    BEGIN SELECT RAISE(ABORT,'Invalid project title revision'); END`,
  project_title_history_scope: `CREATE TRIGGER project_title_history_scope BEFORE INSERT ON project_title_history
    WHEN NOT EXISTS (SELECT 1 FROM command_receipts r
      JOIN projects p ON p.id=r.result_id
      WHERE r.operation_id=NEW.operation_id AND r.command='project.rename'
        AND p.id=NEW.project_id AND p.title=NEW.title AND p.title_revision=NEW.title_revision)
    BEGIN SELECT RAISE(ABORT,'Invalid project title receipt'); END`,
  project_title_history_update: `CREATE TRIGGER project_title_history_update BEFORE UPDATE ON project_title_history
    BEGIN SELECT RAISE(ABORT,'Immutable project title history'); END`,
  project_title_history_delete: `CREATE TRIGGER project_title_history_delete BEFORE DELETE ON project_title_history
    BEGIN SELECT RAISE(ABORT,'Immutable project title history'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw(`ALTER TABLE projects ADD COLUMN ${titleRevision}`).execute(db);
  await sql.raw(historySchema).execute(db);
  await sql.raw("DROP TRIGGER receipts_commands").execute(db);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
}
