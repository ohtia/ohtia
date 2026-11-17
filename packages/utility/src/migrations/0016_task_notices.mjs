import { sql } from "kysely";
import { objects as setupObjects } from "./0015_project_setup.mjs";
import { objects as taskObjects } from "./0008_durable_ai_tasks.mjs";

export const objects = {
  tasks_initial: taskObjects.tasks_initial.replace("state IN ('cancelled','uncertain')", "state IN ('cancelled','uncertain','failed')"),
  receipts_commands: setupObjects.receipts_commands.replace("'task.stop'", "'task.stop','task.tryAgain'").replace("    BEGIN SELECT RAISE", `      OR (NEW.command='task.tryAgain' AND NOT EXISTS (SELECT 1 FROM tasks AS replacement
        JOIN tasks AS original ON original.id=replacement.replaces_task_id
        WHERE replacement.id=NEW.result_id AND replacement.accepted_by_operation_id=NEW.operation_id
          AND replacement.charge_warning_accepted_at IS NULL AND original.state='failed'))
    BEGIN SELECT RAISE`),
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  for (const [name, statement] of Object.entries(objects)) {
    await sql.raw(`DROP TRIGGER ${name}`).execute(database);
    await sql.raw(statement).execute(database);
  }
}
