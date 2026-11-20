import { sql } from "kysely";
import { objects as durable } from "./0008_durable_ai_tasks.mjs";
import { objects as reply } from "./0010_reply_control.mjs";
import { graphTasks, objects as graph, tables } from "./0022_contribution_graphs.mjs";
import { objects as limits } from "./0023_shared_work_limits.mjs";

export const coordinationTables = {
  interventions: tables.interventions.replace("'complete','partial','failed'", "'complete','partial','failed','cancelled'")
    .replace("'partial','failed') AND", "'partial','failed','cancelled') AND"),
  tasks: graphTasks.replace("'reply','consultation','contribution'", "'reply','consultation','contribution','synthesis'")
    .replace("kind<>'reply'", "kind IN ('consultation','contribution')")
    .replace("'running','cancelling','completed'", "'running','cancelling','waiting_capacity','completed'")
    .replace("CHECK ((state='blocked' AND blocking_reason IS NOT NULL)", "CHECK (state<>'waiting_capacity' OR kind='synthesis'),\n    CHECK ((state='waiting_capacity') OR (state='blocked' AND blocking_reason IS NOT NULL)"),
  intervention_events: `CREATE TABLE intervention_events (
      id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
      intervention_id BLOB NOT NULL REFERENCES interventions(id),
      sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
      kind TEXT NOT NULL CHECK (kind IN ('contribution_started','contribution_completed','contribution_failed',
        'contribution_uncertain','contribution_blocked','contribution_waiting','contribution_cancelled',
        'graph_changed','continuation_created','plan_ended')),
      contribution_id BLOB,
      task_id BLOB REFERENCES tasks(id),
      payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB))<=2048 AND json_valid(payload) AND json_type(payload)='object'),
      payload_sha256 BLOB NOT NULL CHECK (length(payload_sha256)=32),
      created_at TEXT NOT NULL,
      UNIQUE (intervention_id,sequence),
      FOREIGN KEY (intervention_id,contribution_id) REFERENCES contributions(intervention_id,id),
      CHECK ((kind GLOB 'contribution_*')=(contribution_id IS NOT NULL)),
      CHECK (task_id IS NULL OR contribution_id IS NOT NULL),
      CHECK (kind NOT IN ('contribution_started','contribution_completed','contribution_uncertain') OR task_id IS NOT NULL)
    ) STRICT`,
  continuations: `CREATE TABLE continuations (
      id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
      intervention_id BLOB NOT NULL REFERENCES interventions(id),
      graph_version INTEGER NOT NULL CHECK (graph_version BETWEEN 1 AND 9007199254740991),
      through_sequence INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('required_set_complete','finished_partial')),
      policy_version INTEGER NOT NULL CHECK (policy_version=1),
      admission TEXT NOT NULL CHECK (admission IN ('waiting','admitted','withdrawn')),
      restart_held INTEGER NOT NULL CHECK (restart_held IN (0,1) AND (restart_held=0 OR admission='waiting')),
      task_id BLOB UNIQUE REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
      ready_key BLOB NOT NULL UNIQUE CHECK (length(ready_key)=32),
      created_at TEXT NOT NULL,
      FOREIGN KEY (intervention_id,through_sequence) REFERENCES intervention_events(intervention_id,sequence),
      CHECK ((admission='admitted')=(task_id IS NOT NULL))
    ) STRICT`,
};

export const objects = {
  ...Object.fromEntries(Object.entries(durable).filter(([name]) => name.startsWith("tasks_"))),
  tasks_charge_initial: reply.tasks_charge_initial,
  tasks_charge_changes: reply.tasks_charge_changes,
  ...Object.fromEntries(Object.entries(graph).filter(([name]) => /^(tasks|interventions)_/.test(name))),
  tasks_one_running: graph.tasks_one_running.replace("kind<>'contribution'", "kind IN ('reply','consultation')"),
  // An admitted synthesis proven unsent keeps its task when all pending slots are occupied.
  tasks_changes: graph.tasks_changes
    .replace("OLD.state='running' AND NEW.state IN ('queued','blocked'", "OLD.state='running' AND NEW.state IN ('queued','blocked','waiting_capacity'")
    .replace("OR (OLD.state='cancelling'", "OR (OLD.state='waiting_capacity' AND NEW.state IN ('queued','blocked','cancelled'))\n        OR (OLD.state='cancelling'"),
  tasks_initial: graph.tasks_initial
    .replace("NEW.kind<>'reply' AND NOT EXISTS", "NEW.kind IN ('consultation','contribution') AND NOT EXISTS")
    .replace("    BEGIN SELECT", `      OR (NEW.kind='synthesis' AND NOT EXISTS (
        SELECT 1 FROM continuations c JOIN interventions i ON i.id=c.intervention_id
        JOIN intervention_operations o ON o.intervention_id=i.id
        WHERE c.task_id=NEW.id AND c.admission='admitted' AND i.state='accepted'
          AND i.conversation_id=NEW.conversation_id AND i.project_id=NEW.project_id
          AND o.agent_id='virgilio' AND o.operation=NEW.operation AND o.connection=NEW.connection
          AND NEW.accepted_by_operation_id=CASE c.reason WHEN 'finished_partial'
            THEN i.finished_by_operation_id ELSE i.decided_by_operation_id END))
    BEGIN SELECT`),
  contributions_changes: limits.contributions_changes.replace(
    "state<>'accepted' OR outcome IS NOT NULL",
    "state<>'accepted' OR (outcome IS NOT NULL AND (outcome<>'cancelled' OR OLD.state<>'active' OR NEW.state NOT IN ('cancelled','uncertain')))",
  ),
  receipts_commands: limits.receipts_commands
    .replace("'plan.finish'", "'plan.finish','plan.cancel'")
    .replace("NEW.command='plan.finish'", "NEW.command IN ('plan.finish','plan.cancel')"),
  intervention_events_update: "CREATE TRIGGER intervention_events_update BEFORE UPDATE ON intervention_events BEGIN SELECT RAISE(ABORT,'Immutable intervention event'); END",
  intervention_events_delete: "CREATE TRIGGER intervention_events_delete BEFORE DELETE ON intervention_events BEGIN SELECT RAISE(ABORT,'Immutable intervention event'); END",
  intervention_events_initial: `CREATE TRIGGER intervention_events_initial BEFORE INSERT ON intervention_events
    WHEN NOT EXISTS (SELECT 1 FROM interventions WHERE id=NEW.intervention_id AND kind='plan' AND state='accepted')
      OR NEW.sequence<>(SELECT coalesce(max(sequence),0)+1 FROM intervention_events WHERE intervention_id=NEW.intervention_id)
      OR (NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND contribution_id=NEW.contribution_id))
    BEGIN SELECT RAISE(ABORT,'Invalid intervention event'); END`,
  continuations_waiting: "CREATE INDEX continuations_waiting ON continuations(created_at,id) WHERE admission='waiting'",
  continuations_delete: "CREATE TRIGGER continuations_delete BEFORE DELETE ON continuations BEGIN SELECT RAISE(ABORT,'Immutable continuation'); END",
  continuations_changes: `CREATE TRIGGER continuations_changes BEFORE UPDATE ON continuations
    WHEN OLD.admission<>'waiting' OR NEW.id<>OLD.id OR NEW.intervention_id<>OLD.intervention_id
      OR NEW.graph_version<>OLD.graph_version OR NEW.through_sequence<>OLD.through_sequence OR NEW.reason<>OLD.reason
      OR NEW.policy_version<>OLD.policy_version OR NEW.ready_key<>OLD.ready_key OR NEW.created_at<>OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Invalid continuation change'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    await sql.raw("DROP TRIGGER receipts_commands").execute(db);
    await sql.raw("DROP TRIGGER contributions_changes").execute(db);
    for (const table of ["tasks", "interventions"])
      await sql.raw(`ALTER TABLE ${table} RENAME TO ${table}_before_coordination`).execute(db);
    await sql.raw(coordinationTables.interventions).execute(db);
    await sql.raw(coordinationTables.tasks).execute(db);
    for (const table of ["interventions", "tasks"]) {
      const columns = table === "tasks"
        ? "input_through_position,reply_position,operation,policy_version,instruction_version,connection,document_language,accepted_by_operation_id,replaces_task_id,state,blocking_reason,state_revision,created_at,updated_at,charge_warning_accepted_at,kind,contribution_id"
        : "kind,state,invalid_reason,proposed_by_attempt_id,created_at,decided_at,decided_by_operation_id,revision,purpose,shared_context,graph_version,outcome,finished_at,finished_by_operation_id";
      await sql.raw(`INSERT INTO ${table} (rowid,id,project_id,conversation_id,${columns})
        SELECT rowid,* FROM ${table}_before_coordination ORDER BY rowid`).execute(db);
      await sql.raw(`DROP TABLE ${table}_before_coordination`).execute(db);
    }
    for (const [name, definition] of Object.entries(coordinationTables))
      if (name !== "interventions" && name !== "tasks") await sql.raw(definition).execute(db);
    for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
