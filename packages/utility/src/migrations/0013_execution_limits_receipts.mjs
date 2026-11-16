import { sql } from "kysely";

export const schema = `CREATE TABLE execution_limits_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    value INTEGER NOT NULL CHECK (typeof(value)='integer' AND value BETWEEN 1 AND 50),
    result_revision INTEGER NOT NULL CHECK (typeof(result_revision)='integer' AND result_revision > 0 AND result_revision <= 9007199254740991)
  )`;

/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(schema).execute(database);
}
