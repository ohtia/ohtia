import {
  tables as durableTaskTables,
  objects as durableTaskObjects,
} from "../packages/utility/src/migrations/0008_durable_ai_tasks.mjs";
import {
  columns as replyColumns,
  objects as replyObjects,
} from "../packages/utility/src/migrations/0010_reply_control.mjs";
import { objects as noticeObjects } from "../packages/utility/src/migrations/0016_task_notices.mjs";
import { columns as titleColumns } from "../packages/utility/src/migrations/0018_conversation_titles.mjs";
import { objects as limits } from "../packages/utility/src/migrations/0023_shared_work_limits.mjs";
import { objects as josefaObjects } from "../packages/utility/src/migrations/0019_josefa_search_planning.mjs";

import {
  coordinationTables,
  objects as coordination,
} from "../packages/utility/src/migrations/0024_plan_coordination.mjs";
import { objects as graph } from "../packages/utility/src/migrations/0022_contribution_graphs.mjs";

import { objects as conversationAgents } from "../packages/utility/src/migrations/0020_conversation_agents.mjs";
import { objects as research } from "../packages/utility/src/migrations/0007_research_records.mjs";
import { objects as proposals } from "../packages/utility/src/migrations/0026_plan_proposals.mjs";
import { priorInterventionFields } from "../packages/utility/src/migrations/0026_plan_proposals.mjs";

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

const priorAttempts = durableTaskTables.attempts.replace(
  ",\n    UNIQUE (task_id,attempt_number)",
  `, ${titleColumns.policy},\n    UNIQUE (task_id,attempt_number)`,
);
const attemptFields =
  "id,task_id,attempt_number,service_generation,state,outcome_reason,requested_model,observed_model,dispatch_permitted_at,transfer_manifest,provider_request_id,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,created_at,started_at,finished_at,conversation_title_policy";
const attemptObjects = Object.entries({
  ...durableTaskObjects,
  attempts_changes: limits.attempts_changes,
})
  .filter(([name]) => name.startsWith("attempts_"))
  .map(([, definition]) => definition);

export const preHandoffSql = `
  DROP TRIGGER conversations_initial;
  DROP TRIGGER conversations_changes;
  DROP TRIGGER tasks_reservation;
  DROP TRIGGER messages_position;
  DROP TRIGGER IF EXISTS receipts_commands;
  DROP TABLE handoff_selected_messages;
  DROP TABLE handoffs;
  ALTER TABLE conversations DROP COLUMN owner_revision;
  ${research.conversations_initial};
  ${conversationAgents.conversations_changes};
  ${durableTaskObjects.tasks_reservation};
  ${durableTaskObjects.messages_position};
  ${proposals.receipts_commands};
  DELETE FROM kysely_migration WHERE name='0027_handoffs';
  DELETE FROM ohtia_migration_artifacts WHERE name='0027_handoffs';
  PRAGMA user_version=26;
`;

export const dropPlanProposalSql = `
  ${preHandoffSql}
  ALTER TABLE interventions RENAME TO interventions_with_plans;
  ${coordinationTables.interventions};
  INSERT INTO interventions(rowid,${priorInterventionFields})
    SELECT rowid,${priorInterventionFields} FROM interventions_with_plans ORDER BY rowid;
  DROP TABLE interventions_with_plans;
  ${Object.entries(coordination)
    .filter(([name]) => name.startsWith("interventions_"))
    .map(([, definition]) => definition)
    .join(";\n")};
  DROP TRIGGER contributions_initial;
  ${limits.contributions_initial};
  DROP TRIGGER contribution_dependencies_initial;
  ${graph.contribution_dependencies_initial};
  DELETE FROM kysely_migration WHERE name='0026_plan_proposals';
  DELETE FROM ohtia_migration_artifacts WHERE name='0026_plan_proposals';
`;

export const dropSynthesisAttemptSql = `
  ${dropPlanProposalSql}
  ALTER TABLE attempts RENAME TO attempts_with_synthesis;
  ${priorAttempts};
  INSERT INTO attempts(rowid,${attemptFields})
    SELECT rowid,${attemptFields} FROM attempts_with_synthesis ORDER BY rowid;
  DROP TABLE attempts_with_synthesis;
  ${attemptObjects.join(";\n")};
  DELETE FROM kysely_migration WHERE name='0025_contribution_synthesis';
  DELETE FROM ohtia_migration_artifacts WHERE name='0025_contribution_synthesis';
`;

export const dropCoordinationSql = `
  ${dropSynthesisAttemptSql}
  DROP TABLE continuations;
  DROP TABLE intervention_events;
  DELETE FROM kysely_migration WHERE name='0024_plan_coordination';
  DELETE FROM ohtia_migration_artifacts WHERE name='0024_plan_coordination';
`;

export const dropWorkLimitsSql = `
  ${dropCoordinationSql}
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
