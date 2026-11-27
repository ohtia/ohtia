import { sql } from "kysely";
import { tables as previous } from "./0035_anthropic_outcomes.mjs";
import { usageTable as previousUsage, usageObjects as previousObjects } from "./0036_openai_usage_pauses.mjs";
import { addColumns } from "./0034_agent_preferences.mjs";

// Published migration bytes are immutable; keep the schema self-contained.
// SQLite's text functions stop at NUL, so the bytes are checked for it before any of them.
const finished = "state IN ('completed','failed','cancelled','uncertain')";
/** The company OpenRouter names as having delivered a dispatched attempt's reply. */
export const servedByColumn = {
  served_by:
    "TEXT CHECK (served_by IS NULL OR (typeof(served_by)='text' AND instr(CAST(served_by AS BLOB), x'00')=0 AND length(served_by) BETWEEN 1 AND 128 AND served_by NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || '-' || char(159) || ']*') AND dispatch_permitted_at IS NOT NULL AND " +
    finished +
    "))",
};
export const attempts = addColumns(previous.attempts, servedByColumn, ",\n    UNIQUE (task_id,attempt_number)");
export const usageTable = previousUsage.replace(
  "('chatgpt','anthropic_api_key','openai_api_key')",
  "('chatgpt','anthropic_api_key','openai_api_key','openrouter')",
);
export const objects = {
  ...previousObjects,
  usage_initial: previousObjects.usage_initial.replace(
    "NEW.connection IN ('anthropic_api_key','openai_api_key')",
    "NEW.connection IN ('anthropic_api_key','openai_api_key','openrouter')",
  ),
  // An OpenRouter pause belongs to the key that caused it: a replacement key can have its own.
  usage_one_open:
    "CREATE UNIQUE INDEX usage_one_open ON usage_limit_pauses(connection) WHERE resumed_at IS NULL AND connection<>'openrouter'",
  usage_one_open_key: `CREATE TRIGGER usage_one_open_key BEFORE INSERT ON usage_limit_pauses
    WHEN NEW.connection='openrouter' AND EXISTS (SELECT 1 FROM usage_limit_pauses p
      JOIN attempts pa ON pa.id=p.source_attempt_id JOIN attempts na ON na.id=NEW.source_attempt_id
      WHERE p.connection='openrouter' AND p.resumed_at IS NULL AND pa.account_fingerprint IS na.account_fingerprint)
    BEGIN SELECT RAISE(ABORT,'Invalid usage pause'); END`,
  attempts_served_by: `CREATE TRIGGER attempts_served_by BEFORE UPDATE OF served_by ON attempts
    WHEN NEW.served_by IS NOT OLD.served_by AND (OLD.served_by IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.connection='openrouter'))
    BEGIN SELECT RAISE(ABORT,'Immutable attempt'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("ALTER TABLE usage_limit_pauses RENAME TO usage_limit_pauses_before_openrouter").execute(db);
  await sql.raw(usageTable).execute(db);
  await sql.raw("INSERT INTO usage_limit_pauses SELECT * FROM usage_limit_pauses_before_openrouter").execute(db);
  await sql.raw("DROP TABLE usage_limit_pauses_before_openrouter").execute(db);
  for (const [name, type] of Object.entries(servedByColumn))
    await sql.raw("ALTER TABLE attempts ADD COLUMN " + name + " " + type).execute(db);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
}
