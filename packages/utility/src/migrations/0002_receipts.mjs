import { sql } from "kysely";

export const schema = `CREATE TABLE appearance_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    expected_revision INTEGER NOT NULL CHECK (typeof(expected_revision)='integer' AND expected_revision >= 0 AND expected_revision <= 9007199254740991),
    value TEXT NOT NULL CHECK (value IN ('system','light','dark')),
    accepted INTEGER NOT NULL CHECK (typeof(accepted)='integer' AND accepted IN (0,1)),
    result_revision INTEGER NOT NULL CHECK (typeof(result_revision)='integer' AND result_revision >= 0 AND result_revision <= 9007199254740991),
    CHECK ((accepted=1 AND result_revision=expected_revision+1) OR (accepted=0 AND result_revision<>expected_revision))
  )`;

// Command identities follow the application port, independently of entity UUIDs.
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(schema).execute(database);
}
