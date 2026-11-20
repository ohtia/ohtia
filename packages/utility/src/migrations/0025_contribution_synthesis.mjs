import { sql } from "kysely";
import { objects as durable, tables as durableTables } from "./0008_durable_ai_tasks.mjs";
import { columns as title } from "./0018_conversation_titles.mjs";
import { objects as limits } from "./0023_shared_work_limits.mjs";
import { coordinationTables, objects as coordination } from "./0024_plan_coordination.mjs";

const stopped = "stopped INTEGER NOT NULL DEFAULT 0 CHECK (stopped IN (0,1) AND (stopped=0 OR admission='admitted'))";

export const synthesisTables = {
  attempts: durableTables.attempts
    .replace("'service_restarted'))", "'service_restarted','input_too_large'))")
    .replace(",\n    UNIQUE (task_id,attempt_number)", `, ${title.policy},\n    UNIQUE (task_id,attempt_number)`),
  continuations: coordinationTables.continuations.replace("      FOREIGN KEY (intervention_id,through_sequence)", `      ${stopped},\n      FOREIGN KEY (intervention_id,through_sequence)`),
};

export const objects = {
  tasks_initial: coordination.tasks_initial.replace("WHERE c.task_id=NEW.id AND c.admission", "WHERE (c.task_id=NEW.id OR c.task_id=NEW.replaces_task_id) AND c.admission")
    .replace("AND NEW.accepted_by_operation_id=CASE c.reason WHEN 'finished_partial'\n            THEN i.finished_by_operation_id ELSE i.decided_by_operation_id END",
      `AND ((c.task_id=NEW.id AND NEW.replaces_task_id IS NULL
            AND NEW.accepted_by_operation_id=CASE c.reason WHEN 'finished_partial'
              THEN i.finished_by_operation_id ELSE i.decided_by_operation_id END)
          OR (c.task_id=NEW.replaces_task_id AND c.stopped=0 AND EXISTS (
            SELECT 1 FROM tasks t WHERE t.id=c.task_id AND t.kind='synthesis'
              AND t.operation=NEW.operation AND t.policy_version=NEW.policy_version
              AND t.instruction_version=NEW.instruction_version AND t.connection=NEW.connection
              AND t.state IN ('uncertain','failed'))))`),
  tasks_changes: coordination.tasks_changes
    .replace("WHEN OLD.state IN ('completed','failed','cancelled')",
      `WHEN (OLD.state IN ('completed','failed','cancelled') AND NOT (
        OLD.kind='synthesis' AND OLD.state='failed' AND NEW.state='failed' AND EXISTS (
          SELECT 1 FROM tasks WHERE kind='synthesis' AND replaces_task_id=OLD.id
        )
      ))`)
    .replace("AND NEW.state<>'running')",
    "AND NEW.state<>'running' AND NOT (NEW.kind='synthesis' AND NEW.state='failed'))"),
  continuations_changes: coordination.continuations_changes.replace("OLD.admission<>'waiting' OR NEW.id<>OLD.id",
    `(OLD.admission='withdrawn' OR (OLD.admission='admitted' AND NOT (
        NEW.admission='admitted' AND NEW.restart_held=0 AND OLD.stopped=0 AND (
          (NEW.stopped=1 AND NEW.task_id=OLD.task_id) OR
          (NEW.stopped=0 AND EXISTS (SELECT 1 FROM tasks
            WHERE id=NEW.task_id AND kind='synthesis' AND replaces_task_id=OLD.task_id))
        )
      ))) OR NEW.id<>OLD.id`),
  receipts_commands: coordination.receipts_commands
    .replace("'plan.finish','plan.cancel'", "'plan.finish','plan.cancel','synthesis.tryAgain','development.runPlan'")
    .replace("NEW.command NOT IN ('task.startAgain','contribution.startAgain')",
      "NEW.command NOT IN ('task.startAgain','contribution.startAgain','synthesis.tryAgain')")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command='synthesis.tryAgain' AND NOT EXISTS (
        SELECT 1 FROM tasks t JOIN tasks old ON old.id=t.replaces_task_id
        JOIN continuations c ON c.task_id=t.id
        WHERE t.id=NEW.result_id AND t.accepted_by_operation_id=NEW.operation_id
          AND t.kind='synthesis' AND old.state IN ('failed','uncertain')
          AND (old.state='uncertain')=(t.charge_warning_accepted_at IS NOT NULL)))
      OR (NEW.command='development.runPlan' AND NOT EXISTS (
        SELECT 1 FROM interventions i JOIN projects p ON p.id=i.project_id
        JOIN graph_changes g ON g.intervention_id=i.id AND g.graph_version=1
        WHERE i.id=NEW.result_id AND i.kind='plan' AND i.state='accepted'
          AND i.decided_by_operation_id=NEW.operation_id AND g.applied_by_operation_id=NEW.operation_id
          AND p.is_development=0 AND p.setup_confirmed_at IS NOT NULL))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    await sql.raw("ALTER TABLE attempts RENAME TO attempts_before_synthesis").execute(db);
    await sql.raw(synthesisTables.attempts).execute(db);
    const fields = "id,task_id,attempt_number,service_generation,state,outcome_reason,requested_model,observed_model,dispatch_permitted_at,transfer_manifest,provider_request_id,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,created_at,started_at,finished_at,conversation_title_policy";
    await sql.raw(`INSERT INTO attempts (rowid,${fields})
      SELECT rowid,${fields} FROM attempts_before_synthesis ORDER BY rowid`).execute(db);
    await sql.raw("DROP TABLE attempts_before_synthesis").execute(db);
    const attempts = { ...durable, attempts_changes: limits.attempts_changes };
    for (const [name, definition] of Object.entries(attempts))
      if (name.startsWith("attempts_")) await sql.raw(definition).execute(db);

    await sql.raw("ALTER TABLE continuations RENAME TO continuations_before_synthesis").execute(db);
    await sql.raw(synthesisTables.continuations).execute(db);
    const continuationFields = "id,intervention_id,graph_version,through_sequence,reason,policy_version,admission,restart_held,task_id,ready_key,created_at";
    await sql.raw(`INSERT INTO continuations (rowid,${continuationFields})
      SELECT rowid,${continuationFields} FROM continuations_before_synthesis ORDER BY rowid`).execute(db);
    await sql.raw("DROP TABLE continuations_before_synthesis").execute(db);
    await sql.raw(coordination.continuations_waiting).execute(db);
    await sql.raw(coordination.continuations_delete).execute(db);
    for (const [name, definition] of Object.entries(objects)) {
      if (name !== "continuations_changes") await sql.raw(`DROP TRIGGER ${name}`).execute(db);
      await sql.raw(definition).execute(db);
    }
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
