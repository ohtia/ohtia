import { sql } from "kysely";
import { objects as pauses } from "./0009_usage_limit_pauses.mjs";
import { objects as previous, tables } from "./0035_anthropic_outcomes.mjs";

export const usageTable = tables.usage_limit_pauses.replace(
  "('chatgpt','anthropic_api_key')",
  "('chatgpt','anthropic_api_key','openai_api_key')",
);
export const usageObjects = {
  ...pauses,
  usage_initial: previous.usage_initial.replace(
    "NEW.connection='anthropic_api_key'",
    "NEW.connection IN ('anthropic_api_key','openai_api_key')",
  ),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("ALTER TABLE usage_limit_pauses RENAME TO usage_limit_pauses_before_openai").execute(db);
  await sql.raw(usageTable).execute(db);
  await sql.raw("INSERT INTO usage_limit_pauses SELECT * FROM usage_limit_pauses_before_openai").execute(db);
  await sql.raw("DROP TABLE usage_limit_pauses_before_openai").execute(db);
  for (const statement of Object.values(usageObjects)) await sql.raw(statement).execute(db);
}
