import { createHash } from "node:crypto";
import { sql } from "kysely";
import { objects as taskObjects } from "./0008_durable_ai_tasks.mjs";
import { objects as replyObjects } from "./0010_reply_control.mjs";
import { consultationTasks, objects as previous, tables as legacy } from "./0021_consultations.mjs";

/** @param {string} field */
const time = (field) =>
  `typeof(${field})='text' AND length(${field})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds') IS ${field}`;
/** @param {string} field */
const uuid = (field) =>
  `typeof(${field})='blob' AND length(${field})=16 AND substr(hex(${field}),13,1)='7' AND substr(hex(${field}),17,1) IN ('8','9','A','B')`;
/** @param {string} field */
const version = (field) =>
  `typeof(${field})='integer' AND ${field} BETWEEN 0 AND 9007199254740991`;

export const graphTasks = consultationTasks
  .replace("('reply','consultation')", "('reply','consultation','contribution')")
  .replace("(kind='consultation')=(contribution_id IS NOT NULL)", "(kind<>'reply')=(contribution_id IS NOT NULL)");

export const tables = {
  interventions: legacy.interventions
    .replace("kind='consultation'", "kind IN ('consultation','plan')")
    .replace("BLOB NOT NULL UNIQUE REFERENCES attempts", "BLOB UNIQUE REFERENCES attempts")
    .replace("    CHECK ((state='invalid')", `    purpose TEXT,
    shared_context TEXT,
    graph_version INTEGER NOT NULL DEFAULT 0 CHECK (${version("graph_version")}),
    outcome TEXT CHECK (outcome IN ('complete','partial','failed')),
    finished_at TEXT CHECK (finished_at IS NULL OR (${time("finished_at")})),
    finished_by_operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((kind='consultation' AND proposed_by_attempt_id IS NOT NULL AND purpose IS NULL AND shared_context IS NULL
      AND graph_version=0 AND outcome IS NULL)
      OR (kind='plan' AND typeof(purpose)='text' AND length(purpose) BETWEEN 1 AND 2000 AND instr(purpose,char(0))=0
        AND typeof(shared_context)='text' AND length(CAST(shared_context AS BLOB))<=32768
        AND (state='accepted')=(graph_version>0))),
    CHECK ((outcome IS NULL)=(finished_at IS NULL)),
    CHECK (outcome IS NULL OR state='accepted'),
    CHECK ((outcome IN ('partial','failed') AND outcome IS NOT NULL)=(finished_by_operation_id IS NOT NULL)),
    CHECK ((state='invalid')`),
  contributions: legacy.contributions
    .replace("NOT NULL UNIQUE REFERENCES interventions", "NOT NULL REFERENCES interventions")
    .replace("agent_id='josefa'", "agent_id IN ('josefa','virgilio')")
    .replace("operation='search_strategy_planning'", "operation IN ('search_strategy_planning','development_test')")
    .replace(/\n  \)$/, `,
    plan_key TEXT CHECK (plan_key IS NULL OR (typeof(plan_key)='text' AND length(plan_key) BETWEEN 1 AND 64 AND instr(plan_key,char(0))=0 AND plan_key NOT GLOB '*[^a-z0-9-]*')),
    required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
    state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','active','completed','failed','uncertain','blocked','cancelled')),
    blocked_by_contribution_id BLOB,
    failure_reason TEXT CHECK (failure_reason='input_too_large'),
    result_message_id BLOB REFERENCES messages(id),
    restart_held INTEGER NOT NULL DEFAULT 0 CHECK (restart_held IN (0,1)
      AND (restart_held=0 OR (plan_key IS NOT NULL AND state IN ('waiting','blocked')))),
    policy_version INTEGER NOT NULL DEFAULT 2 CHECK (policy_version IN (2,3)),
    dedupe_key BLOB NOT NULL CHECK (typeof(dedupe_key)='blob' AND length(dedupe_key)=32),
    added_in_graph_version INTEGER NOT NULL DEFAULT 0 CHECK (${version("added_in_graph_version")}),
    UNIQUE (intervention_id,id),
    UNIQUE (intervention_id,plan_key),
    UNIQUE (intervention_id,dedupe_key),
    FOREIGN KEY (intervention_id,blocked_by_contribution_id) REFERENCES contributions(intervention_id,id),
    CHECK ((state='blocked')=(blocked_by_contribution_id IS NOT NULL) AND blocked_by_contribution_id IS NOT id),
    CHECK ((state='completed')=(result_message_id IS NOT NULL)),
    CHECK ((state='failed' AND task_id IS NULL)=(failure_reason IS NOT NULL)),
    CHECK ((state IN ('active','completed','uncertain') AND task_id IS NOT NULL)
      OR state IN ('failed','cancelled') OR (state IN ('waiting','blocked') AND task_id IS NULL)),
    CHECK ((plan_key IS NULL AND required=1 AND added_in_graph_version=0 AND operation='search_strategy_planning' AND failure_reason IS NULL)
      OR (plan_key IS NOT NULL AND added_in_graph_version>0 AND length(CAST(request AS BLOB))<=8192)),
    CHECK ((agent_id='josefa' AND operation='search_strategy_planning' AND policy_version=2)
      OR (agent_id='josefa' AND operation='development_test' AND policy_version=2)
      OR (agent_id='virgilio' AND operation='development_test' AND policy_version=3))
  )`),
  contribution_dependencies: `CREATE TABLE contribution_dependencies (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    intervention_id BLOB NOT NULL REFERENCES interventions(id),
    contribution_id BLOB NOT NULL,
    prerequisite_id BLOB NOT NULL,
    added_in_graph_version INTEGER NOT NULL CHECK (${version("added_in_graph_version")} AND added_in_graph_version>0),
    removed_in_graph_version INTEGER CHECK (removed_in_graph_version IS NULL OR (${version("removed_in_graph_version")} AND removed_in_graph_version>added_in_graph_version)),
    FOREIGN KEY (intervention_id,contribution_id) REFERENCES contributions(intervention_id,id),
    FOREIGN KEY (intervention_id,prerequisite_id) REFERENCES contributions(intervention_id,id),
    CHECK (contribution_id<>prerequisite_id)
  )`,
  graph_changes: `CREATE TABLE graph_changes (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    intervention_id BLOB NOT NULL REFERENCES interventions(id),
    graph_version INTEGER NOT NULL CHECK (${version("graph_version")} AND graph_version>0),
    kind TEXT NOT NULL CHECK (kind IN ('accepted','contributions_added')),
    applied_by_operation_id TEXT NOT NULL REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    proposed_by_attempt_id BLOB REFERENCES attempts(id),
    summary TEXT NOT NULL CHECK (typeof(summary)='text' AND length(CAST(summary AS BLOB))<=16384 AND json_valid(summary)),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    UNIQUE (intervention_id,graph_version),
    CHECK ((kind='accepted')=(graph_version=1))
  )`,
};

export const objects = {
  ...previous,
  tasks_one_running: taskObjects.tasks_one_running.replace("WHERE state", "WHERE kind<>'contribution' AND state"),
  tasks_initial: previous.tasks_initial
    .replace("NEW.kind='consultation' AND NOT EXISTS", "NEW.kind<>'reply' AND NOT EXISTS")
    .replace("AND i.state='accepted'", "AND c.policy_version=NEW.policy_version AND i.state='accepted' AND i.outcome IS NULL AND i.kind=CASE NEW.kind WHEN 'consultation' THEN 'consultation' ELSE 'plan' END AND NEW.replaces_task_id IS c.task_id"),
  interventions_initial: previous.interventions_initial
    .replace("OR NEW.state NOT IN ('proposed','invalid')", `OR NEW.outcome IS NOT NULL OR NOT EXISTS
      (SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id)
      OR (NEW.kind='consultation' AND NEW.state NOT IN ('proposed','invalid'))
      OR (NEW.kind='plan' AND NEW.state='accepted' AND NEW.graph_version<>1)`)
    .replace("OR NOT EXISTS (SELECT 1 FROM attempts", "OR (NEW.proposed_by_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attempts")
    .replace("t.conversation_id=NEW.conversation_id)", "t.conversation_id=NEW.conversation_id))"),
  interventions_changes: previous.interventions_changes
    .replace("NEW.proposed_by_attempt_id<>OLD.proposed_by_attempt_id", "NEW.proposed_by_attempt_id IS NOT OLD.proposed_by_attempt_id")
    .replace("OR NEW.revision", `OR NEW.purpose IS NOT OLD.purpose OR NEW.shared_context IS NOT OLD.shared_context
      OR NEW.graph_version NOT IN (OLD.graph_version, OLD.graph_version+1)
      OR (OLD.outcome IS NOT NULL AND (NEW.outcome IS NOT OLD.outcome OR NEW.finished_at IS NOT OLD.finished_at
        OR NEW.finished_by_operation_id IS NOT OLD.finished_by_operation_id OR NEW.graph_version<>OLD.graph_version))
      OR NEW.revision`),
  contributions_one_consultation: "CREATE UNIQUE INDEX contributions_one_consultation ON contributions(intervention_id) WHERE plan_key IS NULL",
  contributions_initial: `CREATE TRIGGER contributions_initial BEFORE INSERT ON contributions
    WHEN NEW.state<>'waiting' OR NEW.restart_held<>0 OR NOT EXISTS (SELECT 1 FROM interventions i WHERE i.id=NEW.intervention_id
      AND ((i.kind='consultation' AND i.state='proposed' AND NEW.plan_key IS NULL)
        OR (i.kind='plan' AND i.outcome IS NULL AND NEW.plan_key IS NOT NULL
          AND NEW.added_in_graph_version=i.graph_version)))
    BEGIN SELECT RAISE(ABORT,'Invalid contribution'); END`,
  contributions_changes: `CREATE TRIGGER contributions_changes BEFORE UPDATE ON contributions
    WHEN NEW.id<>OLD.id OR NEW.intervention_id<>OLD.intervention_id OR NEW.agent_id<>OLD.agent_id
      OR NEW.operation<>OLD.operation OR NEW.request<>OLD.request OR NEW.reason<>OLD.reason
      OR NEW.created_at<>OLD.created_at OR NEW.plan_key IS NOT OLD.plan_key OR NEW.required<>OLD.required
      OR NEW.policy_version<>OLD.policy_version OR NEW.dedupe_key<>OLD.dedupe_key OR NEW.added_in_graph_version<>OLD.added_in_graph_version
      OR EXISTS (SELECT 1 FROM interventions WHERE id=OLD.intervention_id AND (state<>'accepted' OR outcome IS NOT NULL))
      OR (NEW.task_id IS NOT OLD.task_id AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id=NEW.task_id AND contribution_id=OLD.id AND replaces_task_id IS OLD.task_id))
      OR (NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=NEW.task_id
        AND NEW.state=CASE WHEN t.state IN ('queued','blocked','running','cancelling') THEN 'active' ELSE t.state END))
      OR (NEW.result_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM messages WHERE id=NEW.result_message_id AND task_id=NEW.task_id AND ending='complete'))
    BEGIN SELECT RAISE(ABORT,'Invalid contribution change'); END`,
  contribution_dependencies_active: "CREATE UNIQUE INDEX contribution_dependencies_active ON contribution_dependencies(contribution_id,prerequisite_id) WHERE removed_in_graph_version IS NULL",
  contribution_dependencies_initial: `CREATE TRIGGER contribution_dependencies_initial BEFORE INSERT ON contribution_dependencies
    WHEN NEW.removed_in_graph_version IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM interventions WHERE id=NEW.intervention_id AND kind='plan' AND outcome IS NULL AND graph_version=NEW.added_in_graph_version)
    BEGIN SELECT RAISE(ABORT,'Invalid contribution dependency'); END`,
  contribution_dependencies_changes: `CREATE TRIGGER contribution_dependencies_changes BEFORE UPDATE ON contribution_dependencies
    WHEN NEW.id<>OLD.id OR NEW.intervention_id<>OLD.intervention_id OR NEW.contribution_id<>OLD.contribution_id
      OR NEW.prerequisite_id<>OLD.prerequisite_id OR NEW.added_in_graph_version<>OLD.added_in_graph_version
      OR OLD.removed_in_graph_version IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM interventions WHERE id=NEW.intervention_id AND outcome IS NULL AND graph_version=NEW.removed_in_graph_version)
    BEGIN SELECT RAISE(ABORT,'Invalid contribution dependency change'); END`,
  contribution_dependencies_delete: "CREATE TRIGGER contribution_dependencies_delete BEFORE DELETE ON contribution_dependencies BEGIN SELECT RAISE(ABORT,'Immutable contribution dependency'); END",
  graph_changes_initial: `CREATE TRIGGER graph_changes_initial BEFORE INSERT ON graph_changes
    WHEN NOT EXISTS (SELECT 1 FROM interventions WHERE id=NEW.intervention_id AND kind='plan' AND graph_version=NEW.graph_version)
    BEGIN SELECT RAISE(ABORT,'Invalid graph version'); END`,
  graph_changes_changes: "CREATE TRIGGER graph_changes_changes BEFORE UPDATE ON graph_changes BEGIN SELECT RAISE(ABORT,'Immutable graph change'); END",
  graph_changes_delete: "CREATE TRIGGER graph_changes_delete BEFORE DELETE ON graph_changes BEGIN SELECT RAISE(ABORT,'Immutable graph change'); END",
  receipts_commands: previous.receipts_commands
    .replace("'task.stop'", "'plan.addContributions','plan.finish','task.stop'")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command='plan.addContributions' AND NOT EXISTS (
        SELECT 1 FROM graph_changes WHERE intervention_id=NEW.result_id AND applied_by_operation_id=NEW.operation_id))
      OR (NEW.command='plan.finish' AND NOT EXISTS (
        SELECT 1 FROM interventions WHERE id=NEW.result_id AND kind='plan' AND outcome IS NOT NULL))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(database);
  try {
    await sql.raw("DROP TRIGGER receipts_commands").execute(database);
    for (const table of ["tasks", "contributions", "interventions"])
      await sql.raw(`ALTER TABLE ${table} RENAME TO ${table}_before_graphs`).execute(database);
    for (const table of Object.values(tables)) await sql.raw(table).execute(database);
    await sql.raw(graphTasks).execute(database);
    await sql.raw(`INSERT INTO interventions
      (rowid,id,project_id,conversation_id,kind,state,invalid_reason,proposed_by_attempt_id,created_at,decided_at,decided_by_operation_id,revision)
      SELECT rowid,* FROM interventions_before_graphs ORDER BY rowid`).execute(database);
    await sql.raw(`INSERT INTO tasks (rowid,id,project_id,conversation_id,input_through_position,reply_position,operation,
      policy_version,instruction_version,connection,document_language,accepted_by_operation_id,replaces_task_id,state,
      blocking_reason,state_revision,created_at,updated_at,charge_warning_accepted_at,kind,contribution_id)
      SELECT rowid,* FROM tasks_before_graphs ORDER BY rowid`).execute(database);
    const existing = await sql.raw(`SELECT c.rowid,c.*,t.state AS task_state,m.id AS result_message_id
      FROM contributions_before_graphs c LEFT JOIN tasks t ON t.id=c.task_id
      LEFT JOIN messages m ON m.task_id=t.id AND m.ending='complete' ORDER BY c.rowid`).execute(database);
    for (const row of existing.rows) {
      const c = /** @type {{rowid:number,id:Uint8Array,intervention_id:Uint8Array,agent_id:string,operation:string,
        request:string,reason:string,task_id:Uint8Array|null,created_at:string,task_state:string|null,result_message_id:Uint8Array|null}} */ (row);
      const state = !c.task_state ? "waiting"
        : ["queued","blocked","running","cancelling"].includes(c.task_state) ? "active" : c.task_state;
      // Fixed RFC 8785 key order and scalar values of the consultation contract in revision 21.
      const key = createHash("sha256").update(JSON.stringify({
        agent: c.agent_id, operation: c.operation, policyVersion: 2, prerequisites: [], request: c.request,
      })).digest();
      await sql`INSERT INTO contributions
        (rowid,id,intervention_id,agent_id,operation,request,reason,task_id,created_at,state,result_message_id,dedupe_key)
        VALUES (${c.rowid},${c.id},${c.intervention_id},${c.agent_id},${c.operation},${c.request},${c.reason},${c.task_id},${c.created_at},${state},${c.result_message_id},${key})`.execute(database);
    }
    for (const table of ["tasks", "contributions", "interventions"])
      await sql.raw(`DROP TABLE ${table}_before_graphs`).execute(database);
    const retained = Object.fromEntries(
      Object.entries(taskObjects).filter(([name]) => name.startsWith("tasks_")),
    );
    for (const statement of Object.values({
      ...retained,
      tasks_charge_initial: replyObjects.tasks_charge_initial,
      tasks_charge_changes: replyObjects.tasks_charge_changes,
      ...objects,
    })) await sql.raw(statement).execute(database);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(database);
  }
}
