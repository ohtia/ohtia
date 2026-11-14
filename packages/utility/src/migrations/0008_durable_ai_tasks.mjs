import { sql } from "kysely";

// Published migration bytes are immutable; this module carries its complete SQL contract.
/** @param {string} field */
const uuid = (field) =>
  `typeof(${field})='blob' AND length(${field})=16 AND substr(hex(${field}),13,1)='7' AND substr(hex(${field}),17,1) IN ('8','9','A','B')`;
/** @param {string} field */
const positive = (field) =>
  `typeof(${field})='integer' AND ${field} BETWEEN 1 AND 9007199254740991`;
/** @param {string} field */
const time = (field) =>
  `typeof(${field})='text' AND length(${field})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds')=${field}`;
/** @param {string} field */
const tokens = (field) =>
  `${field} IS NULL OR (typeof(${field})='integer' AND ${field} BETWEEN 0 AND 9007199254740991)`;

export const tables = {
  tasks: `CREATE TABLE tasks (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id) CHECK (${uuid("project_id")}),
    conversation_id BLOB NOT NULL REFERENCES conversations(id) CHECK (${uuid("conversation_id")}),
    input_through_position INTEGER NOT NULL CHECK (${positive("input_through_position")}),
    reply_position INTEGER CHECK (reply_position IS NULL OR (${positive("reply_position")})),
    operation TEXT NOT NULL CHECK (typeof(operation)='text' AND length(operation)>0),
    policy_version INTEGER NOT NULL CHECK (${positive("policy_version")}),
    instruction_version INTEGER NOT NULL CHECK (${positive("instruction_version")}),
    connection TEXT NOT NULL CHECK (typeof(connection)='text' AND length(connection)>0),
    document_language TEXT CHECK (document_language IS NULL OR (typeof(document_language)='text' AND length(document_language)>0)),
    accepted_by_operation_id TEXT NOT NULL REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    replaces_task_id BLOB REFERENCES tasks(id) CHECK (replaces_task_id IS NULL OR (${uuid("replaces_task_id")})),
    state TEXT NOT NULL CHECK (state IN ('queued','blocked','running','cancelling','completed','failed','cancelled','uncertain')),
    blocking_reason TEXT CHECK (blocking_reason IN ('connection_disabled','permission_required','input_changed','configuration_unavailable','restart_paused','usage_limit_reached')),
    state_revision INTEGER NOT NULL CHECK (${positive("state_revision")}),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    updated_at TEXT NOT NULL CHECK (${time("updated_at")}),
    CHECK ((state='blocked' AND blocking_reason IS NOT NULL) OR (state<>'blocked' AND blocking_reason IS NULL)),
    CHECK (state NOT IN ('running','cancelling','completed','uncertain') OR reply_position IS NOT NULL),
    CHECK (reply_position IS NULL OR reply_position>input_through_position)
  )`,
  attempts: `CREATE TABLE attempts (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    task_id BLOB NOT NULL REFERENCES tasks(id) CHECK (${uuid("task_id")}),
    attempt_number INTEGER NOT NULL CHECK (${positive("attempt_number")}),
    service_generation TEXT NOT NULL CHECK (typeof(service_generation)='text' AND length(service_generation) BETWEEN 1 AND 128),
    state TEXT NOT NULL CHECK (state IN ('prepared','running','waiting_user','stopping','completed','failed','cancelled','uncertain')),
    outcome_reason TEXT CHECK (outcome_reason IN ('usage_limit_reached','not_eligible','connection_expired','provider_unavailable','request_rejected','provider_error','invalid_output','output_limit_exceeded','connection_lost','empty_reply','permit_expired','inactivity_timeout','deadline_exceeded','cancelled_by_researcher','service_restarted')),
    requested_model TEXT,
    observed_model TEXT,
    dispatch_permitted_at TEXT CHECK (dispatch_permitted_at IS NULL OR (${time("dispatch_permitted_at")})),
    transfer_manifest TEXT CHECK (transfer_manifest IS NULL OR (json_valid(transfer_manifest) AND json_type(transfer_manifest)='array')),
    provider_request_id TEXT,
    input_tokens INTEGER CHECK (${tokens("input_tokens")}),
    cached_input_tokens INTEGER CHECK (${tokens("cached_input_tokens")}),
    output_tokens INTEGER CHECK (${tokens("output_tokens")}),
    reasoning_tokens INTEGER CHECK (${tokens("reasoning_tokens")}),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    started_at TEXT CHECK (started_at IS NULL OR (${time("started_at")})),
    finished_at TEXT CHECK (finished_at IS NULL OR (${time("finished_at")})),
    UNIQUE (task_id,attempt_number),
    CHECK ((state IN ('failed','cancelled','uncertain') AND outcome_reason IS NOT NULL) OR (state NOT IN ('failed','cancelled','uncertain') AND outcome_reason IS NULL)),
    CHECK ((state IN ('completed','failed','cancelled','uncertain') AND finished_at IS NOT NULL) OR (state NOT IN ('completed','failed','cancelled','uncertain') AND finished_at IS NULL)),
    CHECK (dispatch_permitted_at IS NULL OR (requested_model IS NOT NULL AND transfer_manifest IS NOT NULL))
  )`,
};

export const objects = {
  tasks_queue: "CREATE INDEX tasks_queue ON tasks(state,created_at,id)",
  tasks_pending_operation: "CREATE INDEX tasks_pending_operation ON tasks(operation) WHERE state IN ('queued','blocked')",
  tasks_one_running: "CREATE UNIQUE INDEX tasks_one_running ON tasks(conversation_id) WHERE state IN ('running','cancelling')",
  tasks_one_waiting: "CREATE UNIQUE INDEX tasks_one_waiting ON tasks(conversation_id) WHERE state IN ('queued','blocked')",
  tasks_reply_position: "CREATE UNIQUE INDEX tasks_reply_position ON tasks(conversation_id,reply_position) WHERE reply_position IS NOT NULL",
  attempts_one_active: "CREATE UNIQUE INDEX attempts_one_active ON attempts(task_id) WHERE state IN ('prepared','running','waiting_user','stopping')",
  messages_task: "CREATE UNIQUE INDEX messages_task ON messages(task_id) WHERE task_id IS NOT NULL",
  tasks_initial: `CREATE TRIGGER tasks_initial BEFORE INSERT ON tasks
    WHEN NEW.state_revision<>1 OR NEW.state NOT IN ('queued','blocked') OR NEW.reply_position IS NOT NULL OR NEW.updated_at<>NEW.created_at
      OR NOT EXISTS (SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id)
      OR NEW.document_language IS NOT (SELECT document_language FROM projects WHERE id=NEW.project_id)
      OR NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id=NEW.conversation_id AND position=NEW.input_through_position)
      OR (NEW.replaces_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.replaces_task_id AND conversation_id=NEW.conversation_id AND state IN ('cancelled','uncertain')))
    BEGIN SELECT RAISE(ABORT,'Invalid initial task'); END`,
  tasks_changes: `CREATE TRIGGER tasks_changes BEFORE UPDATE ON tasks
    WHEN OLD.state IN ('completed','failed','cancelled')
      OR NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.conversation_id<>OLD.conversation_id
      OR NEW.input_through_position<>OLD.input_through_position OR NEW.operation<>OLD.operation
      OR NEW.policy_version<>OLD.policy_version OR NEW.instruction_version<>OLD.instruction_version
      OR NEW.connection<>OLD.connection OR NEW.document_language IS NOT OLD.document_language
      OR NEW.accepted_by_operation_id<>OLD.accepted_by_operation_id OR NEW.replaces_task_id IS NOT OLD.replaces_task_id
      OR NEW.created_at<>OLD.created_at OR NEW.state_revision<>OLD.state_revision+1
      OR (OLD.reply_position IS NOT NULL AND NEW.reply_position IS NOT OLD.reply_position)
      OR (OLD.reply_position IS NULL AND NEW.reply_position IS NOT NULL AND NEW.state<>'running')
      OR NOT (NEW.state=OLD.state
        OR (OLD.state='queued' AND NEW.state IN ('blocked','running','failed','cancelled'))
        OR (OLD.state='blocked' AND NEW.state IN ('queued','cancelled'))
        OR (OLD.state='running' AND NEW.state IN ('queued','blocked','cancelling','completed','failed','cancelled','uncertain'))
        OR (OLD.state='cancelling' AND NEW.state IN ('cancelled','failed','uncertain'))
        OR (OLD.state='uncertain' AND NEW.state IN ('failed','cancelled')))
    BEGIN SELECT RAISE(ABORT,'Invalid task change'); END`,
  tasks_reservation: `CREATE TRIGGER tasks_reservation BEFORE UPDATE OF reply_position ON tasks
    WHEN OLD.reply_position IS NULL AND NEW.reply_position IS NOT NULL AND NEW.reply_position<>(
      SELECT max(coalesce((SELECT max(position) FROM messages WHERE conversation_id=NEW.conversation_id),0),
        coalesce((SELECT max(reply_position) FROM tasks WHERE conversation_id=NEW.conversation_id),0))+1)
    BEGIN SELECT RAISE(ABORT,'Reply position must follow messages and reservations'); END`,
  tasks_delete: `CREATE TRIGGER tasks_delete BEFORE DELETE ON tasks
    BEGIN SELECT RAISE(ABORT,'Immutable task receipt'); END`,
  attempts_initial: `CREATE TRIGGER attempts_initial BEFORE INSERT ON attempts
    WHEN NEW.state<>'prepared' OR NEW.dispatch_permitted_at IS NOT NULL OR NEW.transfer_manifest IS NOT NULL
      OR NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL
      OR NEW.attempt_number<>(SELECT coalesce(max(attempt_number),0)+1 FROM attempts WHERE task_id=NEW.task_id)
      OR NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND state IN ('queued','running'))
    BEGIN SELECT RAISE(ABORT,'Invalid initial attempt'); END`,
  attempts_changes: `CREATE TRIGGER attempts_changes BEFORE UPDATE ON attempts
    WHEN NEW.id<>OLD.id OR NEW.task_id<>OLD.task_id OR NEW.attempt_number<>OLD.attempt_number
      OR NEW.service_generation<>OLD.service_generation OR NEW.created_at<>OLD.created_at
      OR (OLD.state IN ('completed','failed','cancelled','uncertain') AND (
        NEW.state<>OLD.state OR NEW.outcome_reason IS NOT OLD.outcome_reason
        OR NEW.requested_model IS NOT OLD.requested_model OR NEW.observed_model IS NOT OLD.observed_model
        OR NEW.dispatch_permitted_at IS NOT OLD.dispatch_permitted_at OR NEW.transfer_manifest IS NOT OLD.transfer_manifest
        OR NEW.provider_request_id IS NOT OLD.provider_request_id OR NEW.started_at IS NOT OLD.started_at OR NEW.finished_at IS NOT OLD.finished_at))
      OR (OLD.transfer_manifest IS NOT NULL AND NEW.transfer_manifest IS NOT OLD.transfer_manifest)
      OR (OLD.requested_model IS NOT NULL AND NEW.requested_model IS NOT OLD.requested_model)
      OR (OLD.dispatch_permitted_at IS NOT NULL AND NEW.dispatch_permitted_at IS NOT OLD.dispatch_permitted_at
        AND NOT (NEW.dispatch_permitted_at IS NULL AND NEW.outcome_reason IN ('permit_expired','connection_expired','provider_unavailable') AND NEW.state IN ('cancelled','failed')))
      OR NOT (NEW.state=OLD.state
        OR (OLD.state='prepared' AND NEW.state IN ('running','stopping','failed','cancelled','uncertain'))
        OR (OLD.state='running' AND NEW.state IN ('waiting_user','stopping','completed','failed','cancelled','uncertain'))
        OR (OLD.state='waiting_user' AND NEW.state IN ('running','stopping','failed','cancelled','uncertain'))
        OR (OLD.state='stopping' AND NEW.state IN ('failed','cancelled','uncertain')))
    BEGIN SELECT RAISE(ABORT,'Invalid attempt change'); END`,
  attempts_delete: `CREATE TRIGGER attempts_delete BEFORE DELETE ON attempts
    BEGIN SELECT RAISE(ABORT,'Immutable attempt receipt'); END`,
  messages_position: `CREATE TRIGGER messages_position BEFORE INSERT ON messages
    WHEN NEW.author_kind='researcher' AND NEW.position<=(
      SELECT max(coalesce((SELECT max(position) FROM messages WHERE conversation_id=NEW.conversation_id),0),
        coalesce((SELECT max(reply_position) FROM tasks WHERE conversation_id=NEW.conversation_id),0)))
    BEGIN SELECT RAISE(ABORT,'Message position must advance'); END`,
  messages_reservation: `CREATE TRIGGER messages_reservation BEFORE INSERT ON messages
    WHEN (NEW.author_kind='researcher' AND NEW.task_id IS NOT NULL)
      OR (NEW.author_kind='agent' AND (NEW.task_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM tasks WHERE id=NEW.task_id AND conversation_id=NEW.conversation_id
          AND reply_position=NEW.position AND state IN ('running','cancelling'))))
      OR EXISTS (SELECT 1 FROM tasks WHERE conversation_id=NEW.conversation_id AND reply_position=NEW.position AND id IS NOT NEW.task_id)
    BEGIN SELECT RAISE(ABORT,'Message must use its own task reservation'); END`,
};

/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  for (const statement of Object.values(tables)) await sql.raw(statement).execute(database);
  await sql.raw("ALTER TABLE messages ADD COLUMN task_id BLOB REFERENCES tasks(id)").execute(database);
  await sql.raw("DROP TRIGGER messages_position").execute(database);
  // Conversation revision is advanced once by the transaction owner, including coalescing writes.
  await sql.raw("DROP TRIGGER messages_revision").execute(database);
  for (const statement of Object.values(objects)) await sql.raw(statement).execute(database);
  await sql`UPDATE application_preferences
    SET value=json_set(value,'$.max_concurrent_inference',10), revision=revision+1
    WHERE key='execution_limits' AND schema_version=1 AND revision=1
      AND json_extract(value,'$.max_concurrent_inference')=1`.execute(database);
}
