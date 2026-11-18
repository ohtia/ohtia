import { sql } from "kysely";
import { objects as previous } from "./0016_task_notices.mjs";

export const columns = {
  opened: "last_opened_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z' CHECK (typeof(last_opened_at)='text' AND length(last_opened_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',last_opened_at,'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',last_opened_at,'+0 seconds')=last_opened_at)",
  error: "error_code TEXT CHECK (error_code IS NULL OR (command='project.open' AND error_code='record_not_found'))",
};
export const objects = {
  receipts_commands: previous.receipts_commands.replace("'project.create'", "'project.create','project.open'"),
  projects_open_order: "CREATE INDEX projects_open_order ON projects(last_opened_at DESC,id DESC)",
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(`ALTER TABLE projects ADD COLUMN ${columns.opened}`).execute(database);
  await sql`UPDATE projects SET last_opened_at=created_at`.execute(database);
  await sql.raw(`ALTER TABLE command_receipts ADD COLUMN ${columns.error}`).execute(database);
  await sql.raw("DROP TRIGGER receipts_commands").execute(database);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(database);
}
