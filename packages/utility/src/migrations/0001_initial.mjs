import { sql } from "kysely";

export const schema = `CREATE TABLE application_preferences (
    key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('appearance','interface_locale','execution_limits','workspace_layout','character_presentation','interface_zoom','window_bounds')),
    schema_version INTEGER NOT NULL CHECK (typeof(schema_version)='integer' AND schema_version > 0),
    revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision > 0 AND revision <= 9007199254740991),
    value TEXT NOT NULL CHECK (typeof(value)='text')
  )`;

// Published executable migration bytes are immutable. Add another module for changes.
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(schema).execute(database);
  await sql`INSERT INTO application_preferences (key,schema_version,revision,value)
    VALUES ('execution_limits',1,1,'{"max_concurrent_inference":1,"max_concurrent_local_processing":1}')`.execute(
    database,
  );
}
