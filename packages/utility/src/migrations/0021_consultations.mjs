import { sql } from "kysely";
import { tables as taskTables, objects as taskObjects } from "./0008_durable_ai_tasks.mjs";
import { columns, objects as replyObjects } from "./0010_reply_control.mjs";
import { objects as notices } from "./0016_task_notices.mjs";
import { objects as previous } from "./0019_josefa_search_planning.mjs";

/** @param {string} field */
const uuid = (field) =>
  `typeof(${field})='blob' AND length(${field})=16 AND substr(hex(${field}),13,1)='7' AND substr(hex(${field}),17,1) IN ('8','9','A','B')`;
/** @param {string} field */
const time = (field) =>
  `typeof(${field})='text' AND length(${field})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds') IS ${field}`;

export const tables = {
  interventions: `CREATE TABLE interventions (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id),
    conversation_id BLOB NOT NULL REFERENCES conversations(id),
    kind TEXT NOT NULL CHECK (kind='consultation'),
    state TEXT NOT NULL CHECK (state IN ('proposed','accepted','declined','replaced','invalid')),
    invalid_reason TEXT CHECK (invalid_reason IN ('request_empty','request_too_long','reason_empty','reason_too_long','agent_unavailable','multiple_calls')),
    proposed_by_attempt_id BLOB NOT NULL UNIQUE REFERENCES attempts(id),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    decided_at TEXT CHECK (decided_at IS NULL OR (${time("decided_at")})),
    decided_by_operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
    CHECK ((state='invalid')=(invalid_reason IS NOT NULL)),
    CHECK ((state='proposed')=(decided_at IS NULL)),
    CHECK ((state IN ('accepted','declined'))=(decided_by_operation_id IS NOT NULL))
  )`,
  contributions: `CREATE TABLE contributions (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    intervention_id BLOB NOT NULL UNIQUE REFERENCES interventions(id),
    agent_id TEXT NOT NULL CHECK (agent_id='josefa'),
    operation TEXT NOT NULL CHECK (operation='search_strategy_planning'),
    request TEXT NOT NULL CHECK (length(CAST(request AS BLOB)) BETWEEN 1 AND 32768),
    reason TEXT NOT NULL CHECK (length(CAST(reason AS BLOB)) BETWEEN 1 AND 2000 AND (length(reason) BETWEEN 1 AND 500 OR instr(reason,char(0))>0)),
    task_id BLOB REFERENCES tasks(id),
    created_at TEXT NOT NULL CHECK (${time("created_at")})
  )`,
};

export const consultationTasks = taskTables.tasks
  .replace("input_through_position INTEGER NOT NULL CHECK (", "input_through_position INTEGER CHECK (input_through_position IS NULL OR (")
  .replace("input_through_position BETWEEN 1 AND 9007199254740991),","input_through_position BETWEEN 1 AND 9007199254740991)),")
  .replace("CHECK ((state=", `${columns.charge},
    kind TEXT NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply','consultation')),
    contribution_id BLOB REFERENCES contributions(id),
    CHECK ((kind='reply')=(input_through_position IS NOT NULL)),
    CHECK ((kind='consultation')=(contribution_id IS NOT NULL)),
    CHECK ((state=`);

const taskTriggers = {
  tasks_initial: notices.tasks_initial
    .replace("OR NOT EXISTS (SELECT 1 FROM messages", "OR (NEW.kind='reply' AND NOT EXISTS (SELECT 1 FROM messages")
    .replace("position=NEW.input_through_position)", "position=NEW.input_through_position))")
    .replace("AND state IN", "AND kind=NEW.kind AND contribution_id IS NEW.contribution_id AND state IN")
    .replace("    BEGIN SELECT", `      OR (NEW.kind='consultation' AND NOT EXISTS (
        SELECT 1 FROM contributions c JOIN interventions i ON i.id=c.intervention_id
        WHERE c.id=NEW.contribution_id AND c.operation=NEW.operation AND i.state='accepted'
          AND i.conversation_id=NEW.conversation_id AND i.project_id=NEW.project_id))
    BEGIN SELECT`),
  tasks_changes: taskObjects.tasks_changes.replace(
    "NEW.input_through_position<>OLD.input_through_position",
    "NEW.kind<>OLD.kind OR NEW.contribution_id IS NOT OLD.contribution_id OR NEW.input_through_position IS NOT OLD.input_through_position",
  ),
  tasks_one_waiting: taskObjects.tasks_one_waiting.replace("WHERE state", "WHERE kind='reply' AND state"),
  tasks_one_consultation: "CREATE UNIQUE INDEX tasks_one_consultation ON tasks(conversation_id) WHERE kind='consultation' AND state IN ('queued','blocked','running','cancelling')",
};
export const objects = {
  ...taskTriggers,
  interventions_one_proposed: "CREATE UNIQUE INDEX interventions_one_proposed ON interventions(conversation_id) WHERE kind='consultation' AND state='proposed'",
  interventions_initial: `CREATE TRIGGER interventions_initial BEFORE INSERT ON interventions
    WHEN NEW.revision<>1 OR NEW.state NOT IN ('proposed','invalid')
      OR NOT EXISTS (SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
        WHERE a.id=NEW.proposed_by_attempt_id AND a.state='completed'
          AND t.operation='direct_guidance' AND t.instruction_version>=2
          AND t.project_id=NEW.project_id AND t.conversation_id=NEW.conversation_id)
    BEGIN SELECT RAISE(ABORT,'Invalid consultation proposal'); END`,
  interventions_changes: `CREATE TRIGGER interventions_changes BEFORE UPDATE ON interventions
    WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.conversation_id<>OLD.conversation_id
      OR NEW.kind<>OLD.kind OR NEW.proposed_by_attempt_id<>OLD.proposed_by_attempt_id
      OR NEW.invalid_reason IS NOT OLD.invalid_reason OR NEW.created_at<>OLD.created_at
      OR NEW.revision<>OLD.revision+1 OR (OLD.state<>'proposed' AND (
        NEW.state<>OLD.state OR NEW.decided_at IS NOT OLD.decided_at
        OR NEW.decided_by_operation_id IS NOT OLD.decided_by_operation_id))
    BEGIN SELECT RAISE(ABORT,'Invalid intervention change'); END`,
  interventions_delete: "CREATE TRIGGER interventions_delete BEFORE DELETE ON interventions BEGIN SELECT RAISE(ABORT,'Immutable intervention'); END",
  contributions_initial: `CREATE TRIGGER contributions_initial BEFORE INSERT ON contributions
    WHEN NEW.task_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM interventions WHERE id=NEW.intervention_id AND state='proposed')
    BEGIN SELECT RAISE(ABORT,'Invalid contribution'); END`,
  contributions_changes: `CREATE TRIGGER contributions_changes BEFORE UPDATE ON contributions
    WHEN NEW.id<>OLD.id OR NEW.intervention_id<>OLD.intervention_id OR NEW.agent_id<>OLD.agent_id
      OR NEW.operation<>OLD.operation OR NEW.request<>OLD.request OR NEW.reason<>OLD.reason
      OR NEW.created_at<>OLD.created_at OR NEW.task_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND contribution_id=OLD.id
        AND replaces_task_id IS OLD.task_id)
    BEGIN SELECT RAISE(ABORT,'Invalid contribution change'); END`,
  contributions_delete: "CREATE TRIGGER contributions_delete BEFORE DELETE ON contributions BEGIN SELECT RAISE(ABORT,'Immutable contribution'); END",
  receipts_commands: previous.receipts_commands
    .replace("'task.stop'", "'consultation.accept','consultation.decline','contribution.tryAgain','contribution.startAgain','task.stop'")
    .replace("NEW.command='task.startAgain'", "NEW.command IN ('task.startAgain','contribution.startAgain')")
    .replace("NEW.command<>'task.startAgain'", "NEW.command NOT IN ('task.startAgain','contribution.startAgain')")
    .replace("NEW.command='task.tryAgain'", "NEW.command IN ('task.tryAgain','contribution.tryAgain')")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command IN ('consultation.accept','consultation.decline') AND NOT EXISTS (
        SELECT 1 FROM interventions WHERE id=NEW.result_id AND decided_by_operation_id=NEW.operation_id
          AND state=CASE NEW.command WHEN 'consultation.accept' THEN 'accepted' ELSE 'declined' END))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  // The storage owner suspends FK enforcement for this rebuild and checks every FK before commit.
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(database);
  try {
    await sql.raw("ALTER TABLE tasks RENAME TO tasks_before_consultations").execute(database);
    for (const definition of Object.values(tables)) await sql.raw(definition).execute(database);
    await sql.raw(consultationTasks).execute(database);
    await sql.raw(`INSERT INTO tasks (rowid,id,project_id,conversation_id,input_through_position,reply_position,operation,
      policy_version,instruction_version,connection,document_language,accepted_by_operation_id,replaces_task_id,state,
      blocking_reason,state_revision,created_at,updated_at,charge_warning_accepted_at,kind,contribution_id)
      SELECT rowid, tasks_before_consultations.*, 'reply', NULL FROM tasks_before_consultations ORDER BY rowid`).execute(database);
    await sql.raw("DROP TABLE tasks_before_consultations").execute(database);
    await sql.raw("DROP TRIGGER receipts_commands").execute(database);
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
