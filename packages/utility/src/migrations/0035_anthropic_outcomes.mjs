import { sql } from "kysely";
import { objects as durable } from "./0008_durable_ai_tasks.mjs";
import { objects as pauses, tables as pauseTables } from "./0009_usage_limit_pauses.mjs";
import { attempts as previousAttempts, objects as usage } from "./0031_reply_usage.mjs";
import { addColumns, effortColumns } from "./0034_agent_preferences.mjs";

const time = "strftime('%Y-%m-%dT%H:%M:%fZ',retry_not_before_at,'+0 seconds')";
export const maxInput = "max_input INTEGER CHECK (max_input>0)";
export const tables = {
  attempts: addColumns(
    previousAttempts.replace(
      "'input_too_large'))",
      "'input_too_large','refused','rate_limited','max_output_reached','model_unavailable','billing_limit_reached'))",
    ),
    {
      ...effortColumns,
      refusal_category: "TEXT CHECK (refusal_category IS NULL OR (outcome_reason IS 'refused' AND state='failed' AND typeof(refusal_category)='text' AND length(refusal_category) BETWEEN 1 AND 64 AND refusal_category NOT GLOB '*[^a-z0-9_]*'))",
      retry_not_before_at: "TEXT CHECK (retry_not_before_at IS NULL OR (outcome_reason IS 'rate_limited' AND state='failed' AND typeof(retry_not_before_at)='text' AND length(retry_not_before_at)=24 AND " + time + " IS NOT NULL AND " + time + "=retry_not_before_at))",
    },
    ",\n    UNIQUE (task_id,attempt_number)",
  ),
  usage_limit_pauses: pauseTables.usage_limit_pauses.replace(
    "connection='chatgpt'",
    "connection IN ('chatgpt','anthropic_api_key')",
  ),
};
export const objects = {
  attempts_one_active: durable.attempts_one_active,
  attempts_initial: durable.attempts_initial,
  attempts_changes: usage.attempts_changes.replace(
    "OR NEW.requested_model IS NOT OLD.requested_model",
    "OR NEW.refusal_category IS NOT OLD.refusal_category OR NEW.retry_not_before_at IS NOT OLD.retry_not_before_at\n        OR NEW.requested_model IS NOT OLD.requested_model",
  ),
  attempts_delete: durable.attempts_delete,
  attempts_retry_wait:
    "CREATE INDEX attempts_retry_wait ON attempts(retry_not_before_at) WHERE retry_not_before_at IS NOT NULL",
  ...pauses,
  usage_initial: pauses.usage_initial.replace(
    "a.outcome_reason='usage_limit_reached'",
    "((NEW.connection='chatgpt' AND a.outcome_reason='usage_limit_reached') OR (NEW.connection='anthropic_api_key' AND a.outcome_reason='billing_limit_reached'))",
  ),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    await sql.raw("ALTER TABLE attempts RENAME TO attempts_before_anthropic").execute(db);
    await sql.raw(tables.attempts).execute(db);
    const fields = "id,task_id,attempt_number,service_generation,state,outcome_reason,requested_model,observed_model,dispatch_permitted_at,transfer_manifest,provider_request_id,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,created_at,started_at,finished_at,conversation_title_policy,usage_report_deadline_at,account_fingerprint,requested_effort,observed_effort";
    await sql.raw("INSERT INTO attempts (rowid," + fields + ") SELECT rowid," + fields +
      " FROM attempts_before_anthropic ORDER BY rowid").execute(db);
    await sql.raw("DROP TABLE attempts_before_anthropic").execute(db);
    await sql.raw("ALTER TABLE usage_limit_pauses RENAME TO usage_limit_pauses_before_anthropic").execute(db);
    await sql.raw(tables.usage_limit_pauses).execute(db);
    await sql.raw("INSERT INTO usage_limit_pauses SELECT * FROM usage_limit_pauses_before_anthropic").execute(db);
    await sql.raw("DROP TABLE usage_limit_pauses_before_anthropic").execute(db);
    await sql.raw("ALTER TABLE provider_models ADD COLUMN " + maxInput).execute(db);
    for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
