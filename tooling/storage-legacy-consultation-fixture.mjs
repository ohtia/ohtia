import { objects as thesisProfile } from "../packages/utility/src/migrations/0039_thesis_profile.mjs";
import { objects as projectTitle } from "../packages/utility/src/migrations/0038_project_title_revision.mjs";
import { objects as beforeProjectTitle } from "../packages/utility/src/migrations/0034_agent_preferences.mjs";
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
import {
  tables as limitTables,
  objects as limits,
} from "../packages/utility/src/migrations/0023_shared_work_limits.mjs";
import { objects as josefaObjects } from "../packages/utility/src/migrations/0019_josefa_search_planning.mjs";

import {
  coordinationTables,
  objects as coordination,
} from "../packages/utility/src/migrations/0024_plan_coordination.mjs";
import {
  tables as graphTables,
  objects as graph,
} from "../packages/utility/src/migrations/0022_contribution_graphs.mjs";

import { objects as conversationAgents } from "../packages/utility/src/migrations/0020_conversation_agents.mjs";
import { objects as research } from "../packages/utility/src/migrations/0007_research_records.mjs";
import {
  interventions as planInterventions,
  objects as proposals,
} from "../packages/utility/src/migrations/0026_plan_proposals.mjs";
import { priorInterventionFields } from "../packages/utility/src/migrations/0026_plan_proposals.mjs";

import { objects as handoffs } from "../packages/utility/src/migrations/0027_handoffs.mjs";
import {
  tables as redirectionTables,
  objects as redirection,
} from "../packages/utility/src/migrations/0028_plan_redirection.mjs";
import {
  synthesisTables,
  objects as synthesis,
} from "../packages/utility/src/migrations/0025_contribution_synthesis.mjs";

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

const priorRedirectionTables = {
  interventions: [planInterventions, priorInterventionFields + ",approved_during_attempt_id"],
  contributions: [
    limitTables.contributions,
    "id,intervention_id,agent_id,operation,request,reason,task_id,created_at,plan_key,required,state,blocked_by_contribution_id,failure_reason,result_message_id,ready_inputs,restart_held,policy_version,dedupe_key,added_in_graph_version",
  ],
  graph_changes: [
    graphTables.graph_changes,
    "id,intervention_id,graph_version,kind,applied_by_operation_id,proposed_by_attempt_id,summary,created_at",
  ],
  continuations: [
    synthesisTables.continuations,
    "id,intervention_id,graph_version,through_sequence,reason,policy_version,admission,restart_held,task_id,ready_key,created_at,stopped",
  ],
};
const priorRedirectionObjects = {
  ...graph,
  ...limits,
  ...coordination,
  ...synthesis,
  ...proposals,
  ...handoffs,
};
import {
  tables as memoryTables,
  objects as memory,
} from "../packages/utility/src/migrations/0029_project_memory.mjs";
import { objects as researcherMemory } from "../packages/utility/src/migrations/0030_researcher_memory.mjs";
import {
  objects as agentPreferences,
  taskColumns,
  effortColumns,
} from "../packages/utility/src/migrations/0034_agent_preferences.mjs";

import {
  attempts as usageAttempts,
  objects as replyUsageObjects,
} from "../packages/utility/src/migrations/0031_reply_usage.mjs";
import {
  tables as usagePauseTables,
  objects as usagePauseObjects,
} from "../packages/utility/src/migrations/0009_usage_limit_pauses.mjs";
import { addColumns } from "../packages/utility/src/migrations/0034_agent_preferences.mjs";
import { preferencesSchema as entryTextPreferencesSchema } from "../packages/utility/src/migrations/0033_entry_text_preference.mjs";

const preferenceAttemptFields =
  attemptFields + ",usage_report_deadline_at,account_fingerprint,requested_effort,observed_effort";
export const preResearchStageSql = `
  DROP TRIGGER research_stage_receipt_scope;
  DROP TABLE research_stage_artifacts;
  DROP TABLE research_stage_decisions;
  DROP TRIGGER receipts_commands;
  ${thesisProfile.receipts_commands};
  DELETE FROM kysely_migration WHERE name='0040_research_stages';
  DELETE FROM ohtia_migration_artifacts WHERE name='0040_research_stages';
  PRAGMA user_version=39;
`;

export const preThesisProfileSql = `
  ${preResearchStageSql}
  DROP TRIGGER thesis_profile_receipt_scope;
  DROP TABLE thesis_profile_proposals;
  DROP TABLE thesis_profile_heads;
  DROP TABLE thesis_profile_revisions;
  DROP TRIGGER receipts_commands;
  ${projectTitle.receipts_commands};
  DELETE FROM kysely_migration WHERE name='0039_thesis_profile';
  DELETE FROM ohtia_migration_artifacts WHERE name='0039_thesis_profile';
  PRAGMA user_version=38;
`;

export const preProjectTitleSql = `
  ${preThesisProfileSql}
  DROP TRIGGER projects_title_revision;
  DROP TABLE project_title_history;
  ALTER TABLE projects DROP COLUMN title_revision;
  DROP TRIGGER receipts_commands;
  ${beforeProjectTitle.receipts_commands};
  DELETE FROM kysely_migration WHERE name='0038_project_title_revision';
  DELETE FROM ohtia_migration_artifacts WHERE name='0038_project_title_revision';
  PRAGMA user_version=37;
`;

export const preUpdateCheckSql = `
  ${preProjectTitleSql}
  DROP TABLE update_check_receipts;
  ALTER TABLE application_preferences RENAME TO application_preferences_with_update_check;
  ${entryTextPreferencesSchema};
  INSERT INTO application_preferences SELECT * FROM application_preferences_with_update_check WHERE key<>'update_check';
  DROP TABLE application_preferences_with_update_check;
  DELETE FROM kysely_migration WHERE name='0037_update_check_preference';
  DELETE FROM ohtia_migration_artifacts WHERE name='0037_update_check_preference';
  PRAGMA user_version=36;
`;

export const preAnthropicOutcomesSql = `
  ${preUpdateCheckSql}
  PRAGMA legacy_alter_table=ON;
  ALTER TABLE attempts RENAME TO attempts_with_anthropic_outcomes;
  ${addColumns(usageAttempts, effortColumns, ",\n    UNIQUE (task_id,attempt_number)")};
  INSERT INTO attempts (rowid,${preferenceAttemptFields})
    SELECT rowid,${preferenceAttemptFields} FROM attempts_with_anthropic_outcomes ORDER BY rowid;
  DROP TABLE attempts_with_anthropic_outcomes;
  ${durableTaskObjects.attempts_one_active};
  ${durableTaskObjects.attempts_initial};
  ${replyUsageObjects.attempts_changes};
  ${durableTaskObjects.attempts_delete};
  ALTER TABLE usage_limit_pauses RENAME TO usage_limit_pauses_with_anthropic;
  ${usagePauseTables.usage_limit_pauses};
  INSERT INTO usage_limit_pauses SELECT * FROM usage_limit_pauses_with_anthropic;
  DROP TABLE usage_limit_pauses_with_anthropic;
  ${Object.values(usagePauseObjects).join(";\n")};
  ALTER TABLE provider_models DROP COLUMN max_input;
  DELETE FROM kysely_migration WHERE name='0036_openai_usage_pauses';
  DELETE FROM ohtia_migration_artifacts WHERE name='0036_openai_usage_pauses';
  DELETE FROM kysely_migration WHERE name='0035_anthropic_outcomes';
  DELETE FROM ohtia_migration_artifacts WHERE name='0035_anthropic_outcomes';
  PRAGMA legacy_alter_table=OFF;
  PRAGMA user_version=34;
`;

export const preAgentPreferencesSql = `
  ${preAnthropicOutcomesSql}
  PRAGMA legacy_alter_table=ON;
  ${Object.keys(agentPreferences)
    .filter((name) => !name.startsWith("contributions_"))
    .map((name) => "DROP TRIGGER " + name + ";")
    .join("\n")}
  ALTER TABLE contributions RENAME TO contributions_with_agent_preferences;
  ${memoryTables.contributions};
  INSERT INTO contributions(rowid,${["id", "intervention_id", "agent_id", "operation", "request", "reason", "task_id", "created_at", "plan_key", "required", "state", "blocked_by_contribution_id", "failure_reason", "result_message_id", "ready_inputs", "restart_held", "policy_version", "dedupe_key", "added_in_graph_version", "superseded_by_contribution_id", "cancellation_reason", "context_proposal_id", "purpose_proposal_id"].join(",")})
    SELECT rowid,* FROM contributions_with_agent_preferences ORDER BY rowid;
  DROP TABLE contributions_with_agent_preferences;
  ${Object.keys(taskColumns)
    .map((name) => "ALTER TABLE tasks DROP COLUMN " + name + ";")
    .join("\n")}
  ${Object.keys(effortColumns)
    .map((name) => "ALTER TABLE attempts DROP COLUMN " + name + ";")
    .join("\n")}
  ALTER TABLE continuations DROP COLUMN failure_reason;
  ${Object.keys(agentPreferences)
    .filter((name) => name.startsWith("contributions_"))
    .map((name) => memory[name] + ";")
    .join("\n")}
  ${memory.tasks_initial};
  ${synthesis.tasks_changes};
  ${memory.continuations_changes};
  ${researcherMemory.receipts_commands};
  DROP TABLE provider_models;
  DROP TABLE provider_model_lists;
  DROP TABLE agent_inference_preferences;
  DELETE FROM kysely_migration WHERE name='0034_agent_preferences';
  DELETE FROM ohtia_migration_artifacts WHERE name='0034_agent_preferences';
  PRAGMA legacy_alter_table=OFF;
  PRAGMA user_version=33;
`;

import { schema as applicationPreferencesSchema } from "../packages/utility/src/migrations/0001_initial.mjs";
import { schema as presentationReceiptSchema } from "../packages/utility/src/migrations/0005_presentation_receipts.mjs";

import {
  preferencesSchema as quotePreferencesSchema,
  receiptsSchema as quoteReceiptsSchema,
} from "../packages/utility/src/migrations/0032_source_quote_preference.mjs";

export const preEntryTextSql = `
  ${preAgentPreferencesSql}
  ALTER TABLE presentation_receipts RENAME TO presentation_receipts_with_entry_text;
  ${quoteReceiptsSchema};
  INSERT INTO presentation_receipts SELECT * FROM presentation_receipts_with_entry_text WHERE feature<>'entryText';
  DROP TABLE presentation_receipts_with_entry_text;
  ALTER TABLE application_preferences RENAME TO application_preferences_with_entry_text;
  ${quotePreferencesSchema};
  INSERT INTO application_preferences SELECT * FROM application_preferences_with_entry_text WHERE key<>'project_memory_entry_text_length';
  DROP TABLE application_preferences_with_entry_text;
  DELETE FROM kysely_migration WHERE name='0033_entry_text_preference';
  DELETE FROM ohtia_migration_artifacts WHERE name='0033_entry_text_preference';
  PRAGMA user_version=32;
`;

export const preSourceQuoteSql = `
  ${preEntryTextSql}
  ALTER TABLE presentation_receipts RENAME TO presentation_receipts_with_source_quote;
  ${presentationReceiptSchema};
  INSERT INTO presentation_receipts SELECT * FROM presentation_receipts_with_source_quote WHERE feature<>'sourceQuote';
  DROP TABLE presentation_receipts_with_source_quote;
  ALTER TABLE application_preferences RENAME TO application_preferences_with_source_quote;
  ${applicationPreferencesSchema};
  INSERT INTO application_preferences SELECT * FROM application_preferences_with_source_quote WHERE key<>'project_memory_source_quote_length';
  DROP TABLE application_preferences_with_source_quote;
  DELETE FROM kysely_migration WHERE name='0032_source_quote_preference';
  DELETE FROM ohtia_migration_artifacts WHERE name='0032_source_quote_preference';
  PRAGMA user_version=31;
`;

export const preReplyUsageSql = `
  ${preSourceQuoteSql}
  DROP TRIGGER usage_reports_changes;
  DROP TRIGGER usage_reports_delete;
  DROP TABLE usage_reports;
  DROP TRIGGER attempts_changes;
  ALTER TABLE attempts DROP COLUMN account_fingerprint;
  ALTER TABLE attempts DROP COLUMN usage_report_deadline_at;
  ${limits.attempts_changes};
  DELETE FROM kysely_migration WHERE name='0031_reply_usage';
  DELETE FROM ohtia_migration_artifacts WHERE name='0031_reply_usage';
  PRAGMA user_version=30;
`;

export const preMemorySql = `
  ${preReplyUsageSql}
  PRAGMA legacy_alter_table=ON;
  DROP TRIGGER receipts_commands;
  DROP TRIGGER tasks_initial;
  ${Object.keys(memoryTables)
    .filter((name) => name.startsWith("memory_"))
    .reverse()
    .map((name) => `DROP TABLE ${name};`)
    .join("\n")}
  ${["contributions", "continuations"]
    .map((name) => {
      const columns = memoryTables[name].includes("policy_version")
        ? name === "contributions"
          ? "id,intervention_id,agent_id,operation,request,reason,task_id,created_at,plan_key,required,state,blocked_by_contribution_id,failure_reason,result_message_id,ready_inputs,restart_held,policy_version,dedupe_key,added_in_graph_version,superseded_by_contribution_id,cancellation_reason,context_proposal_id,purpose_proposal_id"
          : "id,intervention_id,graph_version,through_sequence,reason,policy_version,admission,restart_held,task_id,ready_key,created_at,stopped"
        : "";
      return `
      ALTER TABLE ${name} RENAME TO ${name}_with_memory;
      ${redirectionTables[name]};
      INSERT INTO ${name}(rowid,${columns}) SELECT rowid,
        ${columns.replace("policy_version", "CASE policy_version WHEN " + (name === "contributions" ? "4 THEN 2" : "3 THEN 2") + " ELSE policy_version END")}
        FROM ${name}_with_memory ORDER BY rowid;
      DROP TABLE ${name}_with_memory;
    `;
    })
    .join("")}
  ${Object.entries(redirection)
    .filter(
      ([name]) =>
        name === "receipts_commands" ||
        name === "tasks_initial" ||
        name.startsWith("contributions_") ||
        name.startsWith("continuations_"),
    )
    .map(([, definition]) => definition)
    .join(";\n")};
  DELETE FROM kysely_migration WHERE name='0030_researcher_memory';
  DELETE FROM ohtia_migration_artifacts WHERE name='0030_researcher_memory';
  DELETE FROM kysely_migration WHERE name='0029_project_memory';
  DELETE FROM ohtia_migration_artifacts WHERE name='0029_project_memory';
  PRAGMA user_version=28;
  PRAGMA legacy_alter_table=OFF;
`;

export const preRedirectionSql = `
  ${preMemorySql}
  PRAGMA legacy_alter_table=ON;
  DROP TRIGGER receipts_commands;
  DROP TRIGGER tasks_initial;
  ${Object.entries(priorRedirectionTables)
    .map(
      ([name, [definition, fields]]) => `
    ALTER TABLE ${name} RENAME TO ${name}_with_redirection;
    ${definition};
    INSERT INTO ${name}(rowid,${fields})
      SELECT rowid,${name === "continuations" ? fields.replace("policy_version", "1") : fields} FROM ${name}_with_redirection ORDER BY rowid;
    DROP TABLE ${name}_with_redirection;
  `,
    )
    .join("")}
  DROP TABLE graph_change_proposals;
  ${Object.keys(redirection)
    .flatMap((name) => priorRedirectionObjects[name] ?? [])
    .join(";\n")};
  DELETE FROM kysely_migration WHERE name='0028_plan_redirection';
  DELETE FROM ohtia_migration_artifacts WHERE name='0028_plan_redirection';
  PRAGMA user_version=27;
  PRAGMA legacy_alter_table=OFF;
`;

export const preHandoffSql = `
  ${preRedirectionSql}
  PRAGMA legacy_alter_table=ON;
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
