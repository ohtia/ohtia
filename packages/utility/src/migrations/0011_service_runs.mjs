import { sql } from "kysely";

// Published migration bytes are immutable; the history survives every service generation.
/** @param {string} field */
const time = (field) =>
  `typeof(${field})='text' AND length(${field})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds')=${field}`;
export const tables = {
  service_runs: `CREATE TABLE service_runs (
    generation TEXT PRIMARY KEY NOT NULL CHECK (length(generation) BETWEEN 1 AND 128 AND generation GLOB '[A-Za-z0-9]*' AND generation NOT GLOB '*[^A-Za-z0-9_-]*'),
    started_at TEXT NOT NULL CHECK (${time("started_at")}),
    clean_stop_at TEXT CHECK (clean_stop_at IS NULL OR (${time("clean_stop_at")}))
  )`,
};
export const objects = {
  service_runs_initial: `CREATE TRIGGER service_runs_initial BEFORE INSERT ON service_runs
    WHEN NEW.clean_stop_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'A service starts without a clean stop'); END`,
  service_runs_changes: `CREATE TRIGGER service_runs_changes BEFORE UPDATE ON service_runs
    WHEN NEW.generation<>OLD.generation OR NEW.started_at<>OLD.started_at
      OR OLD.clean_stop_at IS NOT NULL OR NEW.clean_stop_at IS NULL
    BEGIN SELECT RAISE(ABORT,'Immutable service run'); END`,
  service_runs_delete: `CREATE TRIGGER service_runs_delete BEFORE DELETE ON service_runs
    BEGIN SELECT RAISE(ABORT,'Immutable service run'); END`,
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  for (const statement of [...Object.values(tables), ...Object.values(objects)])
    await sql.raw(statement).execute(database);
}
