import { sql } from "kysely";
import { schema as previousPreferencesSchema } from "./0001_initial.mjs";
import { schema as previousReceiptsSchema } from "./0005_presentation_receipts.mjs";

export const preferencesSchema = previousPreferencesSchema.replace("'window_bounds')", "'window_bounds','project_memory_source_quote_length')");
export const receiptsSchema = previousReceiptsSchema.replace("('character','zoom')", "('character','zoom','sourceQuote')");

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("ALTER TABLE application_preferences RENAME TO previous_application_preferences").execute(db);
  await sql.raw(preferencesSchema).execute(db);
  await sql.raw("INSERT INTO application_preferences SELECT * FROM previous_application_preferences").execute(db);
  await sql.raw("DROP TABLE previous_application_preferences").execute(db);

  await sql.raw("ALTER TABLE presentation_receipts RENAME TO previous_presentation_receipts").execute(db);
  await sql.raw(receiptsSchema).execute(db);
  await sql.raw("INSERT INTO presentation_receipts SELECT * FROM previous_presentation_receipts").execute(db);
  await sql.raw("DROP TABLE previous_presentation_receipts").execute(db);
}
