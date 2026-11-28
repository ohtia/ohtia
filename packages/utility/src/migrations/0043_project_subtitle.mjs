import { sql } from "kysely";
import { objects as previous } from "./0038_project_title_revision.mjs";

// Keep this module self-contained apart from immutable earlier migrations: its exact bytes identify it.

const whitespace =
  "char(9,10,11,12,13,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
export const subtitleColumn = `subtitle TEXT CHECK (subtitle IS NULL OR (typeof(subtitle)='text' AND length(subtitle) BETWEEN 1 AND 200 AND instr(subtitle,char(0))=0 AND trim(subtitle,${whitespace})=subtitle))`;
/** @param {string} name */
const revision = (name) =>
  `${name} INTEGER NOT NULL CHECK (typeof(${name})='integer' AND ${name} BETWEEN 1 AND 9007199254740991)`;
export const historySchema = `CREATE TABLE project_title_history (
    operation_id TEXT PRIMARY KEY NOT NULL REFERENCES command_receipts(operation_id),
    project_id BLOB NOT NULL REFERENCES projects(id),
    previous_title TEXT NOT NULL,
    title TEXT NOT NULL,
    previous_subtitle TEXT,
    subtitle TEXT,
    ${revision("previous_revision")},
    ${revision("title_revision")},
    CHECK ((title=previous_title AND subtitle IS previous_subtitle AND title_revision=previous_revision) OR ((title<>previous_title OR subtitle IS NOT previous_subtitle) AND title_revision=previous_revision+1))
  )`;
export const objects = {
  projects_title_revision: `CREATE TRIGGER projects_title_revision BEFORE UPDATE ON projects
    WHEN NEW.title_revision<>OLD.title_revision+(
      OLD.setup_confirmed_at IS NOT NULL AND NEW.setup_confirmed_at IS NOT NULL AND (NEW.title IS NOT OLD.title OR NEW.subtitle IS NOT OLD.subtitle)
    )
    BEGIN SELECT RAISE(ABORT,'Invalid project title revision'); END`,
  projects_subtitle_setup: `CREATE TRIGGER projects_subtitle_setup BEFORE UPDATE OF subtitle ON projects
    WHEN NEW.subtitle IS NOT NULL AND NEW.setup_confirmed_at IS NULL
    BEGIN SELECT RAISE(ABORT,'Project subtitle requires a confirmed setup'); END`,
  project_title_history_scope: `CREATE TRIGGER project_title_history_scope BEFORE INSERT ON project_title_history
    WHEN NOT EXISTS (SELECT 1 FROM command_receipts r
      JOIN projects p ON p.id=r.result_id
      WHERE r.operation_id=NEW.operation_id AND r.command='project.rename'
        AND p.id=NEW.project_id AND p.title=NEW.title AND p.subtitle IS NEW.subtitle
        AND p.title_revision=NEW.title_revision)
    BEGIN SELECT RAISE(ABORT,'Invalid project title receipt'); END`,
  project_title_history_update: previous.project_title_history_update,
  project_title_history_delete: previous.project_title_history_delete,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw(`ALTER TABLE projects ADD COLUMN ${subtitleColumn}`).execute(db);
  await sql.raw("DROP TRIGGER projects_title_revision").execute(db);
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    await sql.raw("ALTER TABLE project_title_history RENAME TO project_title_history_before_subtitle").execute(db);
    await sql.raw(historySchema).execute(db);
    await sql.raw(`INSERT INTO project_title_history
      (operation_id,project_id,previous_title,title,previous_subtitle,subtitle,previous_revision,title_revision)
      SELECT operation_id,project_id,previous_title,title,NULL,NULL,previous_revision,title_revision
      FROM project_title_history_before_subtitle ORDER BY rowid`).execute(db);
    await sql.raw("DROP TABLE project_title_history_before_subtitle").execute(db);
    for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
