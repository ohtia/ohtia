import { sql } from "kysely";
import { coordinationTables, objects as coordination } from "./0024_plan_coordination.mjs";
import { objects as graph } from "./0022_contribution_graphs.mjs";
import { objects as limits } from "./0023_shared_work_limits.mjs";
import { objects as synthesis } from "./0025_contribution_synthesis.mjs";

const proposalInterventions = coordinationTables.interventions
  .replace("'agent_unavailable','multiple_calls'", "'agent_unavailable','multiple_calls','plan_unfinished','empty_plan','too_few_contributions','plan_too_large','limit_reached','purpose_empty','purpose_too_long','shared_context_too_large','request_too_large','plan_key_invalid','plan_key_duplicate','duplicate_contribution','unknown_prerequisite','self_dependency','cycle'")
  .replace("OR (kind='plan' AND typeof(purpose)", "OR (kind='plan' AND (state='invalid' AND purpose IS NULL AND shared_context IS NULL OR typeof(purpose)")
  .replace("length(CAST(shared_context AS BLOB))<=32768", "length(CAST(shared_context AS BLOB))<=32768)")
  .replace("AND (state='accepted')=(graph_version>0)", "AND (state='accepted')=(graph_version>0) AND (state='accepted' OR proposed_by_attempt_id IS NOT NULL)");

export const priorInterventionFields = "id,project_id,conversation_id,kind,state,invalid_reason,proposed_by_attempt_id,created_at,decided_at,decided_by_operation_id,revision,purpose,shared_context,graph_version,outcome,finished_at,finished_by_operation_id";
export const interventions = proposalInterventions.replace(
  "    CHECK ((kind=",
  `    approved_during_attempt_id BLOB REFERENCES attempts(id),
    CHECK (approved_during_attempt_id IS NULL OR (kind='plan' AND state='accepted')),
    CHECK ((kind=`,
);

export const objects = {
  ...Object.fromEntries(Object.entries(coordination).filter(([name]) => name.startsWith("interventions_"))),
  interventions_one_proposed: "CREATE UNIQUE INDEX interventions_one_proposed ON interventions(conversation_id) WHERE state='proposed'",
  interventions_initial: graph.interventions_initial.replace(
    "AND t.instruction_version>=2",
    "AND t.instruction_version>=CASE NEW.kind WHEN 'plan' THEN 3 ELSE 2 END",
  ),
  interventions_changes: graph.interventions_changes.replace(
    "OR NEW.revision",
    "OR (NEW.approved_during_attempt_id IS NOT OLD.approved_during_attempt_id AND NOT (OLD.state='proposed' AND NEW.state='accepted')) OR NEW.revision",
  ),
  contributions_initial: limits.contributions_initial.replace(
    "NEW.added_in_graph_version=i.graph_version",
    "((i.state='accepted' AND NEW.added_in_graph_version=i.graph_version) OR (i.state='proposed' AND NEW.added_in_graph_version=1))",
  ),
  contribution_dependencies_initial: graph.contribution_dependencies_initial.replace(
    "graph_version=NEW.added_in_graph_version",
    "((state='accepted' AND graph_version=NEW.added_in_graph_version) OR (state='proposed' AND NEW.added_in_graph_version=1))",
  ),
  receipts_commands: synthesis.receipts_commands
    .replace("'plan.finish','plan.cancel'", "'plan.accept','plan.decline','plan.finish','plan.cancel'")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command IN ('plan.accept','plan.decline') AND NOT EXISTS (
        SELECT 1 FROM interventions i WHERE i.id=NEW.result_id AND i.kind='plan'
          AND i.decided_by_operation_id=NEW.operation_id AND i.proposed_by_attempt_id IS NOT NULL
          AND i.state=CASE NEW.command WHEN 'plan.accept' THEN 'accepted' ELSE 'declined' END
          AND (NEW.command='plan.decline' OR EXISTS (SELECT 1 FROM graph_changes g
            WHERE g.intervention_id=i.id AND g.graph_version=1 AND g.applied_by_operation_id=NEW.operation_id
              AND g.proposed_by_attempt_id=i.proposed_by_attempt_id))))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    for (const trigger of ["receipts_commands", "contributions_initial", "contribution_dependencies_initial"])
      await sql.raw(`DROP TRIGGER ${trigger}`).execute(db);
    await sql.raw("ALTER TABLE interventions RENAME TO interventions_before_proposals").execute(db);
    await sql.raw(interventions).execute(db);
    await sql.raw(`INSERT INTO interventions(rowid,${priorInterventionFields})
      SELECT rowid,${priorInterventionFields} FROM interventions_before_proposals ORDER BY rowid`).execute(db);
    await sql.raw("DROP TABLE interventions_before_proposals").execute(db);
    for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
