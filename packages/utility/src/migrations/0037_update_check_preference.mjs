import { sql } from "kysely";
import { preferencesSchema as previousPreferencesSchema } from "./0033_entry_text_preference.mjs";

export const preferencesSchema = previousPreferencesSchema.replace(
  "'project_memory_entry_text_length')",
  "'project_memory_entry_text_length','update_check')",
);
export const receiptsSchema = `CREATE TABLE update_check_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    expected_revision INTEGER NOT NULL CHECK (typeof(expected_revision)='integer' AND expected_revision >= 0 AND expected_revision <= 9007199254740991),
    value INTEGER NOT NULL CHECK (typeof(value)='integer' AND value IN (0,1)),
    accepted INTEGER NOT NULL CHECK (typeof(accepted)='integer' AND accepted IN (0,1)),
    result_revision INTEGER NOT NULL CHECK (typeof(result_revision)='integer' AND result_revision >= 0 AND result_revision <= 9007199254740991),
    CHECK ((accepted=1 AND result_revision=expected_revision+1) OR (accepted=0 AND result_revision<>expected_revision))
  )`;

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("ALTER TABLE application_preferences RENAME TO previous_application_preferences").execute(db);
  await sql.raw(preferencesSchema).execute(db);
  await sql.raw("INSERT INTO application_preferences SELECT * FROM previous_application_preferences").execute(db);
  await sql.raw("DROP TABLE previous_application_preferences").execute(db);
  await sql.raw(receiptsSchema).execute(db);
}
