import {
  tables as durableTaskTables,
  objects as durableTaskObjects,
} from "../packages/utility/src/migrations/0008_durable_ai_tasks.mjs";
import {
  columns as replyColumns,
  objects as replyObjects,
} from "../packages/utility/src/migrations/0010_reply_control.mjs";
import { objects as noticeObjects } from "../packages/utility/src/migrations/0016_task_notices.mjs";
import { objects as josefaObjects } from "../packages/utility/src/migrations/0019_josefa_search_planning.mjs";

const priorTaskTable = durableTaskTables.tasks.replace(
  ",\n    CHECK ((state=",
  `, ${replyColumns.charge},\n    CHECK ((state=`,
);
const priorTaskObjects = {
  ...Object.fromEntries(
    Object.entries(durableTaskObjects).filter(([name]) => name.startsWith("tasks_")),
  ),
  tasks_initial: noticeObjects.tasks_initial,
  tasks_charge_initial: replyObjects.tasks_charge_initial,
  tasks_charge_changes: replyObjects.tasks_charge_changes,
  receipts_commands: josefaObjects.receipts_commands,
};

export const dropWorkLimitsSql = `
  DROP TABLE work_allocations;
  DROP TABLE intervention_operations;
  DROP TABLE intervention_limits;
  DROP TRIGGER attempts_changes;
  ${durableTaskObjects.attempts_changes};
  DELETE FROM kysely_migration WHERE name='0023_shared_work_limits';
  DELETE FROM ohtia_migration_artifacts WHERE name='0023_shared_work_limits';
`;

// Build a revision-20 fixture with only reply tasks while retaining historical rowids.
export const preConsultationSql = `
  PRAGMA foreign_keys=OFF;
  PRAGMA legacy_alter_table=ON;
  ${dropWorkLimitsSql}
  DROP TRIGGER receipts_commands;
  ALTER TABLE tasks RENAME TO tasks_with_consultations;
  ${priorTaskTable};
  INSERT INTO tasks (rowid,id,project_id,conversation_id,input_through_position,reply_position,operation,policy_version,
    instruction_version,connection,document_language,accepted_by_operation_id,replaces_task_id,state,blocking_reason,
    state_revision,created_at,updated_at,charge_warning_accepted_at)
    SELECT rowid,id,project_id,conversation_id,input_through_position,reply_position,operation,policy_version,instruction_version,
      connection,document_language,accepted_by_operation_id,replaces_task_id,state,blocking_reason,state_revision,
      created_at,updated_at,charge_warning_accepted_at FROM tasks_with_consultations ORDER BY rowid;
  DROP TABLE tasks_with_consultations;
  DROP TABLE contribution_dependencies;
  DROP TABLE graph_changes;
  DROP TABLE contributions;
  DROP TABLE interventions;
  ${Object.values(priorTaskObjects).join(";\n")};
  DELETE FROM kysely_migration WHERE name='0021_consultations';
  DELETE FROM ohtia_migration_artifacts WHERE name='0021_consultations';
  DELETE FROM kysely_migration WHERE name='0022_contribution_graphs';
  DELETE FROM ohtia_migration_artifacts WHERE name='0022_contribution_graphs';
  PRAGMA user_version=20;
  PRAGMA legacy_alter_table=OFF;
`;
