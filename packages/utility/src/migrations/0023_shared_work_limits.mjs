import { randomUUIDv7 } from "node:crypto";
import { sql } from "kysely";
import { objects as taskObjects } from "./0008_durable_ai_tasks.mjs";
import { objects as graphObjects, tables as graphTables } from "./0022_contribution_graphs.mjs";

export const tables = {
  contributions: graphTables.contributions
    .replace("failure_reason='input_too_large'", "failure_reason IN ('input_too_large','destination_changed','input_changed')")
    .replace("    restart_held INTEGER", "    ready_inputs TEXT CHECK (ready_inputs IS NULL OR (plan_key IS NOT NULL AND json_valid(ready_inputs) AND json_type(ready_inputs)='array')),\n    restart_held INTEGER"),
  intervention_limits: `CREATE TABLE intervention_limits (
    intervention_id BLOB PRIMARY KEY NOT NULL REFERENCES interventions(id),
    policy TEXT NOT NULL CHECK (policy IN ('plan','consultation')),
    policy_version INTEGER NOT NULL CHECK (policy_version>0),
    max_contributions INTEGER NOT NULL CHECK (max_contributions>0),
    max_dependencies INTEGER NOT NULL CHECK (max_dependencies>=0),
    max_levels INTEGER NOT NULL CHECK (max_levels>0),
    max_coordinator_turns INTEGER NOT NULL CHECK (max_coordinator_turns>=0),
    max_requests INTEGER NOT NULL CHECK (max_requests>0),
    max_input_bytes INTEGER NOT NULL CHECK (max_input_bytes>0),
    max_output_bytes INTEGER NOT NULL CHECK (max_output_bytes>0),
    max_work_ms INTEGER NOT NULL CHECK (max_work_ms>0),
    created_at TEXT NOT NULL
  ) STRICT`,
  intervention_operations: `CREATE TABLE intervention_operations (
    intervention_id BLOB NOT NULL REFERENCES intervention_limits(intervention_id),
    agent_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    connection TEXT NOT NULL,
    PRIMARY KEY (intervention_id,agent_id,operation)
  ) STRICT`,
  work_allocations: `CREATE TABLE work_allocations (
    id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
    intervention_id BLOB NOT NULL REFERENCES intervention_limits(intervention_id),
    contribution_id BLOB,
    share TEXT NOT NULL CHECK (share IN ('contribution','synthesis')),
    task_id BLOB REFERENCES tasks(id),
    attempt_number INTEGER NOT NULL CHECK (attempt_number IN (1,2)),
    reserved_requests INTEGER NOT NULL CHECK (reserved_requests=1),
    reserved_input_bytes INTEGER NOT NULL CHECK (reserved_input_bytes>0),
    reserved_output_bytes INTEGER NOT NULL CHECK (reserved_output_bytes>0),
    reserved_work_ms INTEGER NOT NULL CHECK (reserved_work_ms>0),
    state TEXT NOT NULL CHECK (state IN ('held','settled','released')),
    attempt_id BLOB UNIQUE REFERENCES attempts(id),
    used_requests INTEGER,
    used_input_bytes INTEGER,
    used_output_bytes INTEGER,
    used_work_ms INTEGER,
    created_at TEXT NOT NULL,
    settled_at TEXT,
    FOREIGN KEY (intervention_id,contribution_id) REFERENCES contributions(intervention_id,id),
    UNIQUE (task_id,attempt_number),
    CHECK ((share='synthesis')=(contribution_id IS NULL)),
    CHECK ((state='held')=(settled_at IS NULL)),
    CHECK ((state='settled')=(attempt_id IS NOT NULL)),
    CHECK ((state='settled' AND
      used_requests IS NOT NULL AND used_requests=reserved_requests AND
      used_input_bytes IS NOT NULL AND used_input_bytes BETWEEN 0 AND reserved_input_bytes AND
      used_output_bytes IS NOT NULL AND used_output_bytes BETWEEN 0 AND reserved_output_bytes AND
      used_work_ms IS NOT NULL AND used_work_ms BETWEEN 0 AND reserved_work_ms)
      OR (state<>'settled' AND used_requests IS NULL AND used_input_bytes IS NULL
        AND used_output_bytes IS NULL AND used_work_ms IS NULL))
  ) STRICT`,
};

export const objects = {
  attempts_changes: taskObjects.attempts_changes.replace(
    "AND NEW.state IN ('cancelled','failed')))",
    "AND NEW.state IN ('cancelled','failed')) AND NOT (NEW.dispatch_permitted_at IS NULL AND NEW.outcome_reason='cancelled_by_researcher' AND NEW.state='cancelled'))",
  ),
  receipts_commands: graphObjects.receipts_commands.replace(
    "JOIN tasks AS original ON original.id=replacement.replaces_task_id",
    "LEFT JOIN tasks AS original ON original.id=replacement.replaces_task_id",
  ).replace(
    "AND replacement.charge_warning_accepted_at IS NULL AND original.state='failed'",
    `AND replacement.charge_warning_accepted_at IS NULL AND (original.state='failed'
      OR (NEW.command='contribution.tryAgain' AND replacement.kind='contribution'
        AND replacement.replaces_task_id IS NULL AND EXISTS (
          SELECT 1 FROM work_allocations WHERE task_id=replacement.id AND state='held')))`,
  ),
  contributions_initial: graphObjects.contributions_initial.replace(
    "NEW.state<>'waiting'", "NEW.ready_inputs IS NOT NULL OR NEW.state<>'waiting'",
  ),
  contributions_changes: graphObjects.contributions_changes.replace(
    "OR EXISTS (SELECT 1 FROM interventions",
    "OR (OLD.ready_inputs IS NOT NULL AND NEW.ready_inputs IS NOT OLD.ready_inputs) OR EXISTS (SELECT 1 FROM interventions",
  ),
  intervention_limits_changes: "CREATE TRIGGER intervention_limits_changes BEFORE UPDATE ON intervention_limits BEGIN SELECT RAISE(ABORT,'Immutable intervention limits'); END",
  intervention_limits_delete: "CREATE TRIGGER intervention_limits_delete BEFORE DELETE ON intervention_limits BEGIN SELECT RAISE(ABORT,'Immutable intervention limits'); END",
  intervention_operations_changes: "CREATE TRIGGER intervention_operations_changes BEFORE UPDATE ON intervention_operations BEGIN SELECT RAISE(ABORT,'Immutable intervention operation'); END",
  intervention_operations_delete: "CREATE TRIGGER intervention_operations_delete BEFORE DELETE ON intervention_operations BEGIN SELECT RAISE(ABORT,'Immutable intervention operation'); END",
  work_allocations_intervention: "CREATE INDEX work_allocations_intervention ON work_allocations(intervention_id)",
  work_allocations_pending_contribution: "CREATE UNIQUE INDEX work_allocations_pending_contribution ON work_allocations(contribution_id,attempt_number) WHERE task_id IS NULL AND state='held' AND share='contribution'",
  work_allocations_pending_synthesis: "CREATE UNIQUE INDEX work_allocations_pending_synthesis ON work_allocations(intervention_id,attempt_number) WHERE task_id IS NULL AND state='held' AND share='synthesis'",
  work_allocations_changes: `CREATE TRIGGER work_allocations_changes BEFORE UPDATE ON work_allocations
    WHEN OLD.state<>'held' OR NEW.id<>OLD.id OR NEW.intervention_id<>OLD.intervention_id
      OR NEW.contribution_id IS NOT OLD.contribution_id OR NEW.share<>OLD.share
      OR (OLD.task_id IS NOT NULL AND NEW.task_id IS NOT OLD.task_id)
      OR NEW.attempt_number<>OLD.attempt_number OR NEW.reserved_requests<>OLD.reserved_requests
      OR NEW.reserved_input_bytes<>OLD.reserved_input_bytes OR NEW.reserved_output_bytes<>OLD.reserved_output_bytes
      OR NEW.reserved_work_ms<>OLD.reserved_work_ms OR NEW.created_at<>OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Invalid work allocation change'); END`,
  work_allocations_delete: "CREATE TRIGGER work_allocations_delete BEFORE DELETE ON work_allocations BEGIN SELECT RAISE(ABORT,'Immutable work allocation'); END",
};

// These are the historical operation and intervention policy values at revision 23.
/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    await sql.raw("DROP TRIGGER receipts_commands").execute(db);
    await sql.raw("DROP TRIGGER attempts_changes").execute(db);
    for (const name of Object.keys(graphObjects).filter((name) => name.startsWith("contributions_"))) {
      const kind = name === "contributions_one_consultation" ? "INDEX" : "TRIGGER";
      await sql.raw(`DROP ${kind} ${name}`).execute(db);
    }
    await sql.raw("ALTER TABLE contributions RENAME TO contributions_before_limits").execute(db);
    for (const table of Object.values(tables)) await sql.raw(table).execute(db);
    const fields = "id,intervention_id,agent_id,operation,request,reason,task_id,created_at,plan_key,required,state,blocked_by_contribution_id,failure_reason,result_message_id,restart_held,policy_version,dedupe_key,added_in_graph_version";
    await sql.raw(`INSERT INTO contributions (rowid,${fields}) SELECT rowid,${fields} FROM contributions_before_limits ORDER BY rowid`).execute(db);
    await sql.raw("DROP TABLE contributions_before_limits").execute(db);
    for (const [name, definition] of Object.entries(graphObjects))
      if (name.startsWith("contributions_") && !Object.hasOwn(objects, name))
        await sql.raw(definition).execute(db);
    for (const statement of Object.values(objects)) await sql.raw(statement).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
  await sql.raw(`INSERT INTO intervention_limits
    SELECT id,'consultation',1,1,0,1,0,4,1048576,262144,2400000,decided_at
    FROM interventions WHERE kind='consultation' AND state='accepted'`).execute(db);
  await sql.raw(`INSERT INTO intervention_operations
    SELECT c.intervention_id,c.agent_id,c.operation,
      (SELECT connection FROM tasks WHERE contribution_id=c.id ORDER BY rowid LIMIT 1)
    FROM contributions c JOIN intervention_limits i ON i.intervention_id=c.intervention_id`).execute(db);
  const attempts = await sql.raw(`SELECT c.intervention_id,c.id AS contribution_id,t.id AS task_id,
      n.number, t.created_at, a.id AS attempt_id, a.finished_at,
      CASE WHEN a.finished_at IS NOT NULL AND a.dispatch_permitted_at IS NOT NULL THEN 'settled'
           WHEN a.finished_at IS NOT NULL OR t.state IN ('completed','failed','cancelled','uncertain')
             THEN 'released' ELSE 'held' END AS state,
      t.updated_at
    FROM intervention_limits i JOIN contributions c ON c.intervention_id=i.intervention_id
    JOIN tasks t ON t.contribution_id=c.id CROSS JOIN (SELECT 1 AS number UNION ALL SELECT 2) n
    LEFT JOIN attempts a ON a.task_id=t.id AND a.attempt_number=n.number`).execute(db);
  for (const value of attempts.rows) {
    const row = /** @type {{intervention_id: Uint8Array, contribution_id: Uint8Array, task_id: Uint8Array, number: number,
      created_at: string, attempt_id: Uint8Array|null, finished_at: string|null, updated_at: string, state: string}} */ (value);
    const used = row.state === "settled";
    const id = Buffer.from(randomUUIDv7().replaceAll("-", ""), "hex");
    await sql`INSERT INTO work_allocations VALUES (
      ${id},${row.intervention_id},${row.contribution_id},'contribution',${row.task_id},${row.number},
      1,262144,65536,600000,${row.state},${used ? row.attempt_id : null},
      ${used ? 1 : null},${used ? 262144 : null},${used ? 65536 : null},${used ? 600000 : null},
      ${row.created_at},${row.state === "held" ? null : row.finished_at ?? row.updated_at})`.execute(db);
  }
}
