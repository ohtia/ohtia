import { sql } from "kysely";
import { tables as graph, objects as graphObjects } from "./0022_contribution_graphs.mjs";
import { tables as limits } from "./0023_shared_work_limits.mjs";
import { objects as coordination } from "./0024_plan_coordination.mjs";
import { synthesisTables, objects as synthesis } from "./0025_contribution_synthesis.mjs";
import { interventions, objects as proposals } from "./0026_plan_proposals.mjs";
import { objects as handoffs } from "./0027_handoffs.mjs";

export const previousPlanColumn = "previous_plan_id BLOB REFERENCES interventions(id)";
export const tables = {
  contributions: limits.contributions
    .replace("    UNIQUE (intervention_id,id),\n    UNIQUE (intervention_id,plan_key),\n    UNIQUE (intervention_id,dedupe_key),", `    superseded_by_contribution_id BLOB,
    cancellation_reason TEXT CHECK (cancellation_reason IN ('removed_by_researcher','superseded','plan_cancelled','plan_finished','stopped_by_researcher')),
    context_proposal_id BLOB REFERENCES graph_change_proposals(id),
    purpose_proposal_id BLOB REFERENCES graph_change_proposals(id),
    UNIQUE (intervention_id,id),
    FOREIGN KEY (intervention_id,superseded_by_contribution_id) REFERENCES contributions(intervention_id,id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((state='cancelled')=(cancellation_reason IS NOT NULL)),
    CHECK ((superseded_by_contribution_id IS NOT NULL)=(cancellation_reason IS 'superseded') AND superseded_by_contribution_id IS NOT id),
    CHECK ((context_proposal_id IS NULL AND purpose_proposal_id IS NULL) OR (plan_key IS NOT NULL AND task_id IS NOT NULL)),`),
  graph_changes: graph.graph_changes
    .replace("'accepted','contributions_added'", "'accepted','contributions_added','plan_changed'")
    .replace("    UNIQUE (intervention_id,graph_version),", `    proposal_id BLOB UNIQUE REFERENCES graph_change_proposals(id),
    UNIQUE (intervention_id,graph_version),
    CHECK ((kind='plan_changed')=(proposal_id IS NOT NULL)),`),
  continuations: synthesisTables.continuations.replace("policy_version=1", "policy_version IN (1,2)"),
  interventions: interventions.replace(
    "    approved_during_attempt_id",
    "    " + previousPlanColumn + ",\n    approved_during_attempt_id",
  ),
  graph_change_proposals: `CREATE TABLE graph_change_proposals (
    id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
    intervention_id BLOB NOT NULL REFERENCES interventions(id),
    proposed_by_attempt_id BLOB NOT NULL UNIQUE REFERENCES attempts(id),
    change TEXT NOT NULL CHECK (json_valid(change) AND json_type(change)='object' AND length(CAST(change AS BLOB))<=163840),
    expected_graph_version INTEGER NOT NULL CHECK (expected_graph_version>0),
    expected_states TEXT NOT NULL CHECK (json_valid(expected_states) AND json_type(expected_states)='object'),
    preview_states TEXT NOT NULL CHECK (json_valid(preview_states) AND json_type(preview_states)='object'),
    state TEXT NOT NULL CHECK (state IN ('proposed','applied','declined','replaced','invalid')),
    invalid_reason TEXT CHECK (invalid_reason IN ('multiple_calls','too_many_changes','empty_change',
      'unknown_contribution','contribution_completed','dependency_removed','agent_not_authorized',
      'empty_plan','plan_too_large','limit_reached','unknown_prerequisite','self_dependency','cycle',
      'duplicate_contribution','plan_key_invalid','plan_key_duplicate','request_empty','request_too_large',
      'purpose_empty','purpose_too_long','shared_context_too_large','reason_empty','reason_too_long','plan_moved_on')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by_operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((state='invalid')=(invalid_reason IS NOT NULL)),
    CHECK ((state='proposed')=(decided_at IS NULL)),
    CHECK ((state IN ('applied','declined'))=(decided_by_operation_id IS NOT NULL))
  ) STRICT`,
};

export const objects = {
  contributions_one_consultation: graphObjects.contributions_one_consultation,
  contributions_unique_plan_key: "CREATE UNIQUE INDEX contributions_unique_plan_key ON contributions(intervention_id,plan_key) WHERE superseded_by_contribution_id IS NULL",
  contributions_unique_dedupe_key: "CREATE UNIQUE INDEX contributions_unique_dedupe_key ON contributions(intervention_id,dedupe_key) WHERE superseded_by_contribution_id IS NULL AND cancellation_reason IS NOT 'removed_by_researcher'",
  contributions_initial: proposals.contributions_initial.replace("WHEN NEW.", "WHEN NEW.context_proposal_id IS NOT NULL OR NEW.purpose_proposal_id IS NOT NULL OR NEW."),
  contributions_changes: coordination.contributions_changes
    .replace("OR EXISTS (SELECT 1 FROM interventions", `OR OLD.superseded_by_contribution_id IS NOT NULL
      OR (OLD.cancellation_reason IS 'removed_by_researcher' AND NEW.cancellation_reason IS NOT 'superseded')
      OR (NEW.context_proposal_id IS NOT OLD.context_proposal_id AND (OLD.task_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM graph_change_proposals p WHERE p.id=NEW.context_proposal_id
          AND p.intervention_id=NEW.intervention_id AND p.state='applied')))
      OR (NEW.purpose_proposal_id IS NOT OLD.purpose_proposal_id AND (OLD.task_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM graph_change_proposals p WHERE p.id=NEW.purpose_proposal_id
          AND p.intervention_id=NEW.intervention_id AND p.state='applied')))
      OR EXISTS (SELECT 1 FROM interventions`)
    .replace("AND NEW.state=CASE", "AND ((NEW.state='cancelled' AND NEW.cancellation_reason IN ('superseded','removed_by_researcher') AND t.state IN ('cancelled','cancelling','failed','uncertain')) OR NEW.state=CASE")
    .replace("THEN 'active' ELSE t.state END))", "THEN 'active' ELSE t.state END)))"),
  contributions_delete: graphObjects.contributions_delete,
  graph_changes_initial: graphObjects.graph_changes_initial.replace("    BEGIN SELECT", `      OR (NEW.proposal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM graph_change_proposals p WHERE p.id=NEW.proposal_id AND p.intervention_id=NEW.intervention_id
          AND p.state='applied' AND p.expected_graph_version+1=NEW.graph_version
          AND p.proposed_by_attempt_id=NEW.proposed_by_attempt_id AND p.decided_by_operation_id=NEW.applied_by_operation_id))
    BEGIN SELECT`),
  graph_changes_changes: graphObjects.graph_changes_changes,
  graph_changes_delete: graphObjects.graph_changes_delete,
  ...Object.fromEntries(Object.entries(coordination).filter(([name]) => name.startsWith("continuations_"))),
  continuations_changes: synthesis.continuations_changes.replace(
    "OR NEW.policy_version<>OLD.policy_version",
    "OR (NEW.policy_version<>OLD.policy_version AND NOT (OLD.policy_version=1 AND NEW.policy_version=2 AND NEW.admission='admitted'))",
  ),
  ...Object.fromEntries(Object.entries(proposals).filter(([name]) => name.startsWith("interventions_"))),
  interventions_initial: proposals.interventions_initial.replace("WHEN NEW.", `WHEN (NEW.previous_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM interventions p WHERE p.id=NEW.previous_plan_id AND NEW.kind='plan'
      AND p.conversation_id=NEW.conversation_id AND p.kind='plan' AND p.state='accepted' AND p.outcome IS NOT NULL))
    OR NEW.`),
  interventions_changes: proposals.interventions_changes.replace("OR NEW.revision", "OR NEW.previous_plan_id IS NOT OLD.previous_plan_id OR NEW.revision"),
  graph_change_proposals_open: "CREATE UNIQUE INDEX graph_change_proposals_open ON graph_change_proposals(intervention_id) WHERE state='proposed'",
  graph_change_proposals_initial: `CREATE TRIGGER graph_change_proposals_initial BEFORE INSERT ON graph_change_proposals
    WHEN NEW.state NOT IN ('proposed','invalid') OR NOT EXISTS (
      SELECT 1 FROM interventions i JOIN tasks t ON t.conversation_id=i.conversation_id
        JOIN attempts a ON a.task_id=t.id
      WHERE i.id=NEW.intervention_id AND i.kind='plan' AND i.state='accepted'
        AND a.id=NEW.proposed_by_attempt_id AND a.state='completed'
        AND t.operation='direct_guidance' AND t.instruction_version>=5
        AND (NEW.state='invalid' OR (i.graph_version=NEW.expected_graph_version AND i.outcome IS NULL)))
    BEGIN SELECT RAISE(ABORT,'Invalid plan change proposal'); END`,
  graph_change_proposals_changes: `CREATE TRIGGER graph_change_proposals_changes BEFORE UPDATE ON graph_change_proposals
    WHEN OLD.state<>'proposed' OR NEW.state NOT IN ('applied','declined','replaced')
      OR NEW.id<>OLD.id OR NEW.intervention_id<>OLD.intervention_id
      OR NEW.proposed_by_attempt_id<>OLD.proposed_by_attempt_id OR NEW.change<>OLD.change
      OR NEW.expected_graph_version<>OLD.expected_graph_version OR NEW.expected_states<>OLD.expected_states
      OR NEW.preview_states<>OLD.preview_states
      OR NEW.created_at<>OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Invalid plan change proposal decision'); END`,
  graph_change_proposals_delete: "CREATE TRIGGER graph_change_proposals_delete BEFORE DELETE ON graph_change_proposals BEGIN SELECT RAISE(ABORT,'Immutable plan change proposal'); END",
  tasks_initial: synthesis.tasks_initial
    .replace("AND t.operation=NEW.operation AND t.policy_version=NEW.policy_version\n              AND t.instruction_version=NEW.instruction_version", "AND t.operation=NEW.operation AND (t.policy_version=NEW.policy_version AND t.instruction_version=NEW.instruction_version OR (NEW.operation='contribution_synthesis' AND t.policy_version=1 AND NEW.policy_version=2 AND NEW.instruction_version=2))"),
  receipts_commands: handoffs.receipts_commands
    .replace("'plan.accept','plan.decline'", "'plan.accept','plan.decline','planChange.apply','planChange.decline'")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command IN ('planChange.apply','planChange.decline') AND NOT EXISTS (
        SELECT 1 FROM graph_change_proposals p WHERE p.id=NEW.result_id
          AND p.decided_by_operation_id=NEW.operation_id
          AND p.state=CASE NEW.command WHEN 'planChange.apply' THEN 'applied' ELSE 'declined' END
          AND (NEW.command='planChange.decline' OR EXISTS (
            SELECT 1 FROM graph_changes g WHERE g.proposal_id=p.id AND g.applied_by_operation_id=NEW.operation_id))))
    BEGIN SELECT RAISE`),
};

const interventionFields = "id,project_id,conversation_id,kind,state,invalid_reason,proposed_by_attempt_id,created_at,decided_at,decided_by_operation_id,revision,purpose,shared_context,graph_version,outcome,finished_at,finished_by_operation_id,approved_during_attempt_id";
const contributionFields = "id,intervention_id,agent_id,operation,request,reason,task_id,created_at,plan_key,required,state,blocked_by_contribution_id,failure_reason,result_message_id,ready_inputs,restart_held,policy_version,dedupe_key,added_in_graph_version";
const changeFields = "id,intervention_id,graph_version,kind,applied_by_operation_id,proposed_by_attempt_id,summary,created_at";
const continuationFields = "id,intervention_id,graph_version,through_sequence,reason,policy_version,admission,restart_held,task_id,ready_key,created_at,stopped";

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    for (const name of ["receipts_commands", "tasks_initial"])
      await sql.raw(`DROP TRIGGER ${name}`).execute(db);
    const rebuilt = ["interventions", "contributions", "graph_changes", "continuations"];
    for (const name of rebuilt)
      await sql.raw(`ALTER TABLE ${name} RENAME TO ${name}_before_redirection`).execute(db);
    for (const definition of Object.values(tables)) await sql.raw(definition).execute(db);

    await sql.raw(`INSERT INTO interventions(rowid,${interventionFields})
      SELECT rowid,${interventionFields} FROM interventions_before_redirection ORDER BY rowid`).execute(db);
    await sql.raw(`INSERT INTO contributions(rowid,${contributionFields},cancellation_reason)
      SELECT c.rowid,${contributionFields.split(",").map((field) => "c."+field).join(",")},
        CASE WHEN c.state='cancelled' THEN CASE WHEN i.outcome='cancelled' THEN 'plan_cancelled'
          WHEN c.task_id IS NULL AND i.outcome IN ('failed','partial') THEN 'plan_finished'
          ELSE 'stopped_by_researcher' END END
      FROM contributions_before_redirection c JOIN interventions i ON i.id=c.intervention_id ORDER BY c.rowid`).execute(db);
    await sql.raw(`INSERT INTO graph_changes(rowid,${changeFields})
      SELECT rowid,${changeFields} FROM graph_changes_before_redirection ORDER BY rowid`).execute(db);
    await sql.raw(`INSERT INTO continuations(rowid,${continuationFields})
      SELECT rowid,${continuationFields} FROM continuations_before_redirection ORDER BY rowid`).execute(db);
    for (const name of rebuilt)
      await sql.raw(`DROP TABLE ${name}_before_redirection`).execute(db);
    for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
