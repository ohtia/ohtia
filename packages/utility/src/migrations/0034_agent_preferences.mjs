import { sql } from "kysely";
import { objects as synthesis } from "./0025_contribution_synthesis.mjs";
import { objects as redirection } from "./0028_plan_redirection.mjs";
import { objects as memory, tables as previous } from "./0029_project_memory.mjs";
import { objects as researcherMemory } from "./0030_researcher_memory.mjs";

export const taskColumns = {
  resolved_model: "TEXT",
  resolved_model_name: "TEXT",
  resolved_effort: "TEXT",
  configuration_failure: "TEXT CHECK (configuration_failure IS NULL OR (configuration_failure='destination_changed' AND state='cancelled' AND kind<>'reply'))",
  resolution_source: "TEXT CHECK (resolution_source IN ('invocation','agent','default'))",
};
export const effortColumns = { requested_effort: "TEXT", observed_effort: "TEXT" };
export const continuationColumn = "failure_reason TEXT CHECK (failure_reason IS NULL OR (failure_reason='destination_changed' AND admission='admitted'))";
/** @param {string} definition @param {Record<string,string>} columns @param {string} before */
export const addColumns = (definition, columns, before) =>
  definition.replace(before, ", " + Object.entries(columns)
    .map(([name, type]) => name + " " + type).join(", ") + before);
export const contributions = previous.contributions
  .replace("CHECK ((state='failed' AND task_id IS NULL)=(failure_reason IS NOT NULL))",
    "CHECK (CASE WHEN state='failed' AND task_id IS NULL THEN failure_reason IS NOT NULL WHEN state='failed' AND task_id IS NOT NULL THEN failure_reason IS NULL OR failure_reason='destination_changed' ELSE failure_reason IS NULL END)")
  .replace("AND operation='search_strategy_planning' AND failure_reason IS NULL",
    "AND operation='search_strategy_planning' AND (failure_reason IS NULL OR failure_reason='destination_changed')");
export const tables = {
  agent_inference_preferences: `CREATE TABLE agent_inference_preferences (
    id BLOB NOT NULL UNIQUE CHECK (length(id)=16),
    target TEXT PRIMARY KEY CHECK (target IN ('default','virgilio','josefa')),
    connection TEXT,
    model TEXT,
    model_name TEXT,
    effort TEXT,
    inherit INTEGER NOT NULL CHECK (inherit IN (0,1)),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    source TEXT NOT NULL CHECK (source IN ('researcher','first_connection','migration')),
    seed_pending INTEGER NOT NULL CHECK (seed_pending IN (0,1)),
    CHECK ((connection IS NULL)=(model IS NULL) AND (model_name IS NULL)=(model IS NULL)),
    CHECK (inherit=0 OR (target<>'default' AND model IS NULL)),
    CHECK (seed_pending=0 OR (target='default' AND model IS NULL AND source='migration'))
  ) STRICT`,
  provider_model_lists: `CREATE TABLE provider_model_lists (
    connection TEXT PRIMARY KEY,
    list_revision INTEGER NOT NULL CHECK (list_revision BETWEEN 1 AND 9007199254740991),
    kind TEXT NOT NULL CHECK (kind IN ('subscription','api_key')),
    model_count INTEGER NOT NULL CHECK (model_count>=0),
    report_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    account_fingerprint BLOB CHECK (account_fingerprint IS NULL OR length(account_fingerprint)=32)
  ) STRICT`,
  provider_models: `CREATE TABLE provider_models (
    connection TEXT NOT NULL REFERENCES provider_model_lists(connection),
    position INTEGER NOT NULL CHECK (position>=0),
    model TEXT NOT NULL,
    name TEXT NOT NULL,
    effort_support TEXT NOT NULL CHECK (effort_support IN ('supported','unsupported','unknown')),
    effort_levels TEXT NOT NULL CHECK (json_valid(effort_levels) AND json_type(effort_levels)='array'),
    default_effort TEXT,
    max_output INTEGER CHECK (max_output>0),
    origin TEXT NOT NULL CHECK (origin IN ('service','catalog')),
    PRIMARY KEY (connection,position),
    UNIQUE (connection,model)
  ) STRICT`,
};

const retryable = "(t.state IN ('uncertain','failed') OR (t.state='cancelled' AND t.configuration_failure='destination_changed'))";
export const objects = {
  tasks_initial: memory.tasks_initial.replace("t.state IN ('uncertain','failed')", retryable),
  tasks_changes: synthesis.tasks_changes.replace("OR NEW.connection<>OLD.connection",
    `OR ((NEW.connection<>OLD.connection OR NEW.resolved_model IS NOT OLD.resolved_model
      OR NEW.resolved_model_name IS NOT OLD.resolved_model_name OR NEW.resolved_effort IS NOT OLD.resolved_effort
      OR NEW.resolution_source IS NOT OLD.resolution_source)
      AND NOT ((NEW.connection=OLD.connection AND OLD.resolution_source IS NULL AND OLD.state IN ('queued','blocked','waiting_capacity'))
        OR (OLD.state='blocked' AND OLD.blocking_reason IN ('configuration_unavailable','connection_disabled')
          AND (NEW.connection=OLD.connection OR OLD.kind='reply'))))
      OR (NEW.configuration_failure IS NOT OLD.configuration_failure AND NOT (
        ((OLD.state='blocked' AND OLD.blocking_reason IN ('configuration_unavailable','connection_disabled'))
          OR (OLD.kind='synthesis' AND OLD.state IN ('blocked','waiting_capacity') AND OLD.blocking_reason='restart_paused'))
        AND NEW.state='cancelled' AND NOT EXISTS (SELECT 1 FROM attempts WHERE task_id=OLD.id AND dispatch_permitted_at IS NOT NULL)))`),
  contributions_initial: redirection.contributions_initial,
  contributions_changes: redirection.contributions_changes.replace("OR NEW.state=CASE",
    "OR (NEW.state='failed' AND NEW.failure_reason='destination_changed' AND t.configuration_failure='destination_changed') OR NEW.state=CASE"),
  contributions_delete: redirection.contributions_delete,
  contributions_one_consultation: redirection.contributions_one_consultation,
  contributions_unique_plan_key: redirection.contributions_unique_plan_key,
  contributions_unique_dedupe_key: redirection.contributions_unique_dedupe_key,
  continuations_changes: memory.continuations_changes.replace("(NEW.stopped=1 AND NEW.task_id=OLD.task_id)",
    "(NEW.stopped=1 AND NEW.task_id=OLD.task_id) OR (NEW.failure_reason='destination_changed' AND OLD.failure_reason IS NULL AND NEW.task_id=OLD.task_id AND EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND state='cancelled'))"),
  receipts_commands: researcherMemory.receipts_commands
    .replace("original.state='failed'", "(original.state='failed' OR (NEW.command='contribution.tryAgain' AND original.configuration_failure='destination_changed'))")
    .replace("'planChange.apply','planChange.decline'", "'planChange.apply','planChange.decline','agentPreference.replace'")
    .replace("old.state IN ('failed','uncertain')",
      "(old.state IN ('failed','uncertain') OR (old.configuration_failure='destination_changed'))")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command='agentPreference.replace' AND NOT EXISTS (
        SELECT 1 FROM agent_inference_preferences p WHERE p.id=NEW.result_id))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  for (const definition of Object.values(tables)) await sql.raw(definition).execute(db);
  await sql`INSERT INTO agent_inference_preferences
    (id,target,inherit,revision,source,seed_pending)
    SELECT CAST(randomblob(6)||x'70'||randomblob(1)||x'80'||randomblob(7) AS BLOB),'default',0,1,'migration',1
    WHERE EXISTS (SELECT 1 FROM tasks)`.execute(db);
  for (const [name, type] of Object.entries(taskColumns))
    await sql.raw("ALTER TABLE tasks ADD COLUMN " + name + " " + type).execute(db);
  for (const [name, type] of Object.entries(effortColumns))
    await sql.raw("ALTER TABLE attempts ADD COLUMN " + name + " " + type).execute(db);
  await sql.raw("ALTER TABLE continuations ADD COLUMN " + continuationColumn).execute(db);
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    for (const name of Object.keys(objects))
      if (!name.startsWith("contributions_")) await sql.raw("DROP TRIGGER " + name).execute(db);
    await sql.raw("ALTER TABLE contributions RENAME TO contributions_before_agent_preferences").execute(db);
    await sql.raw(contributions).execute(db);
    await sql.raw("INSERT INTO contributions SELECT * FROM contributions_before_agent_preferences ORDER BY rowid").execute(db);
    await sql.raw("DROP TABLE contributions_before_agent_preferences").execute(db);
    for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
