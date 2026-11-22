import { sql } from "kysely";
import {
  preferencesSchema as previousPreferencesSchema,
  receiptsSchema as previousReceiptsSchema,
} from "./0032_source_quote_preference.mjs";

export const preferencesSchema = previousPreferencesSchema.replace(
  "'project_memory_source_quote_length')",
  "'project_memory_source_quote_length','project_memory_entry_text_length')",
);
export const receiptsSchema = previousReceiptsSchema.replace(
  "'sourceQuote')",
  "'sourceQuote','entryText')",
);

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
