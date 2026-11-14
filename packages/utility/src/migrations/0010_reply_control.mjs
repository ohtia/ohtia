import { sql } from "kysely";

// Published migration modules are immutable and include their complete SQL contract.
export const columns = {
  ending: "ending TEXT CHECK (ending IS NULL OR ending IN ('complete','partial'))",
  charge: "charge_warning_accepted_at TEXT CHECK (charge_warning_accepted_at IS NULL OR (typeof(charge_warning_accepted_at)='text' AND length(charge_warning_accepted_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',charge_warning_accepted_at,'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',charge_warning_accepted_at,'+0 seconds')=charge_warning_accepted_at))",
};
export const objects = {
  messages_ending: `CREATE TRIGGER messages_ending BEFORE INSERT ON messages
    WHEN (NEW.author_kind='researcher' AND NEW.ending IS NOT NULL)
      OR (NEW.author_kind='agent' AND (NEW.ending IS NULL OR NEW.ending NOT IN ('complete','partial')))
    BEGIN SELECT RAISE(ABORT,'Message ending must match its author'); END`,
  tasks_charge_initial: `CREATE TRIGGER tasks_charge_initial BEFORE INSERT ON tasks
    WHEN NEW.charge_warning_accepted_at IS NOT NULL AND (
      NEW.charge_warning_accepted_at<>NEW.created_at
      OR NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.replaces_task_id AND state='uncertain')
      OR EXISTS (SELECT 1 FROM command_receipts WHERE operation_id=NEW.accepted_by_operation_id))
    BEGIN SELECT RAISE(ABORT,'Charge warning belongs to a newly accepted replacement'); END`,
  tasks_charge_changes: `CREATE TRIGGER tasks_charge_changes BEFORE UPDATE ON tasks
    WHEN NEW.charge_warning_accepted_at IS NOT OLD.charge_warning_accepted_at
    BEGIN SELECT RAISE(ABORT,'Immutable charge warning'); END`,
  receipts_commands: `CREATE TRIGGER receipts_commands BEFORE INSERT ON command_receipts
    WHEN NEW.command NOT IN ('development.createProject','project.create','project.confirmSetup','conversation.start','conversation.rename','message.append','task.stop','task.startAgain','task.continueAll','usagePause.resume')
      OR (NEW.command='task.startAgain' AND NOT EXISTS (SELECT 1 FROM tasks
        WHERE id=NEW.result_id AND accepted_by_operation_id=NEW.operation_id AND charge_warning_accepted_at=created_at))
      OR (NEW.command<>'task.startAgain' AND EXISTS (SELECT 1 FROM tasks
        WHERE accepted_by_operation_id=NEW.operation_id AND charge_warning_accepted_at IS NOT NULL))
    BEGIN SELECT RAISE(ABORT,'Invalid command receipt'); END`,
};

/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(`ALTER TABLE messages ADD COLUMN ${columns.ending}`).execute(database);
  await sql.raw(`ALTER TABLE tasks ADD COLUMN ${columns.charge}`).execute(database);
  await sql.raw("DROP TRIGGER messages_update").execute(database);
  await sql`UPDATE messages SET ending=CASE
    WHEN (SELECT state FROM tasks WHERE id=messages.task_id)='completed' THEN 'complete'
    ELSE 'partial' END WHERE author_kind='agent'`.execute(database);
  await sql.raw(`CREATE TRIGGER messages_update BEFORE UPDATE ON messages
    BEGIN SELECT RAISE(ABORT,'Immutable message'); END`).execute(database);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(database);
}
