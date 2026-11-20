import { sql } from "kysely";
import { objects as research } from "./0007_research_records.mjs";
import { objects as tasks } from "./0008_durable_ai_tasks.mjs";
import { objects as titles } from "./0018_conversation_titles.mjs";
import { objects as proposals } from "./0026_plan_proposals.mjs";

export const ownerColumn = "owner_revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(owner_revision)='integer' AND owner_revision BETWEEN 1 AND 9007199254740991)";
export const tables = {
  handoffs: `CREATE TABLE handoffs (
    id BLOB PRIMARY KEY NOT NULL CHECK (typeof(id)='blob' AND length(id)=16),
    conversation_id BLOB NOT NULL REFERENCES conversations(id),
    from_agent_id TEXT NOT NULL CHECK (from_agent_id IN ('virgilio','josefa')),
    to_agent_id TEXT CHECK (to_agent_id IS NULL OR to_agent_id IN ('virgilio','josefa')),
    to_operation TEXT,
    initiated_by TEXT NOT NULL CHECK (initiated_by IN ('agent','researcher')),
    state TEXT NOT NULL CHECK (state IN ('proposed','accepted','declined','replaced','invalid')),
    invalid_reason TEXT CHECK (invalid_reason IN ('note_empty','note_too_large','reason_empty','reason_too_long','agent_unavailable','conversation_busy','multiple_calls')),
    note TEXT NOT NULL,
    reason TEXT NOT NULL,
    proposed_by_attempt_id BLOB UNIQUE REFERENCES attempts(id),
    expected_owner_revision INTEGER NOT NULL CHECK (typeof(expected_owner_revision)='integer' AND expected_owner_revision BETWEEN 1 AND 9007199254740991),
    position INTEGER CHECK (position IS NULL OR typeof(position)='integer' AND position BETWEEN 1 AND 9007199254740991),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by_operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (conversation_id,position),
    CHECK ((initiated_by='agent' AND from_agent_id='virgilio' AND proposed_by_attempt_id IS NOT NULL
        AND (state='invalid' OR to_agent_id IS 'josefa') AND (to_agent_id IS NULL OR to_agent_id='josefa'))
      OR (initiated_by='researcher' AND from_agent_id='josefa' AND to_agent_id IS 'virgilio'
        AND state='accepted' AND proposed_by_attempt_id IS NULL AND note='' AND reason='')),
    CHECK ((to_agent_id IS 'josefa' AND to_operation IS 'search_strategy_planning')
      OR (to_agent_id IS 'virgilio' AND to_operation IS 'direct_guidance')
      OR (state='invalid' AND to_agent_id IS NULL AND to_operation IS NULL)),
    CHECK ((state='invalid')=(invalid_reason IS NOT NULL)),
    CHECK ((state='accepted')=(position IS NOT NULL)),
    CHECK ((state='proposed')=(decided_at IS NULL)),
    CHECK ((state IN ('accepted','declined'))=(decided_by_operation_id IS NOT NULL)),
    CHECK (state='invalid' OR initiated_by='researcher' OR
      (length(CAST(note AS BLOB)) BETWEEN 1 AND 32768 AND length(reason) BETWEEN 1 AND 500))
  )`,
  handoff_selected_messages: `CREATE TABLE handoff_selected_messages (
    handoff_id BLOB NOT NULL REFERENCES handoffs(id),
    message_id BLOB NOT NULL REFERENCES messages(id),
    PRIMARY KEY (handoff_id,message_id)
  )`,
};

const previousReservation = "coalesce((SELECT max(reply_position) FROM tasks WHERE conversation_id=NEW.conversation_id),0)";
const handoffReservation = "coalesce((SELECT max(position) FROM handoffs WHERE conversation_id=NEW.conversation_id),0)";
const latestPosition = `max(
  coalesce((SELECT max(position) FROM messages WHERE conversation_id=NEW.conversation_id),0),
  ${previousReservation}, ${handoffReservation})`;
export const objects = {
  conversations_initial: research.conversations_initial.replace("WHEN NEW.revision", "WHEN NEW.owner_revision<>1 OR NEW.revision"),
  conversations_changes: titles.conversations_changes.replace(
    "NEW.revision<>OLD.revision+1",
    `NEW.owner_revision<>OLD.owner_revision+(NEW.agent_id<>OLD.agent_id)
      OR (NEW.agent_id<>OLD.agent_id AND NOT EXISTS (
        SELECT 1 FROM handoffs h WHERE h.conversation_id=OLD.id AND h.state='accepted'
          AND h.expected_owner_revision=OLD.owner_revision AND h.from_agent_id=OLD.agent_id AND h.to_agent_id=NEW.agent_id))
      OR NEW.revision<>OLD.revision+1`,
  ),
  tasks_reservation: tasks.tasks_reservation.replace(previousReservation, previousReservation + ", " + handoffReservation),
  messages_position: tasks.messages_position.replace(previousReservation, previousReservation + ", " + handoffReservation),
  handoffs_open: "CREATE UNIQUE INDEX handoffs_open ON handoffs(conversation_id) WHERE state='proposed'",
  handoffs_revision: "CREATE UNIQUE INDEX handoffs_revision ON handoffs(conversation_id,expected_owner_revision) WHERE state='accepted'",
  handoffs_initial: `CREATE TRIGGER handoffs_initial BEFORE INSERT ON handoffs
    WHEN NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id=NEW.conversation_id
      AND c.agent_id=NEW.from_agent_id AND c.owner_revision=NEW.expected_owner_revision)
      OR (NEW.initiated_by='agent' AND (NEW.state NOT IN ('proposed','invalid') OR NOT EXISTS (
        SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
        WHERE a.id=NEW.proposed_by_attempt_id AND a.state='completed' AND t.kind='reply'
          AND t.operation='direct_guidance' AND t.instruction_version>=4 AND t.conversation_id=NEW.conversation_id)))
      OR (NEW.position IS NOT NULL AND NEW.position<>(SELECT ${latestPosition}+1))
    BEGIN SELECT RAISE(ABORT,'Invalid initial handoff'); END`,
  handoffs_changes: `CREATE TRIGGER handoffs_changes BEFORE UPDATE ON handoffs
    WHEN OLD.state<>'proposed' OR NEW.state NOT IN ('accepted','declined','replaced')
      OR NEW.id IS NOT OLD.id OR NEW.conversation_id IS NOT OLD.conversation_id
      OR NEW.from_agent_id IS NOT OLD.from_agent_id OR NEW.to_agent_id IS NOT OLD.to_agent_id
      OR NEW.to_operation IS NOT OLD.to_operation OR NEW.initiated_by IS NOT OLD.initiated_by
      OR NEW.note IS NOT OLD.note OR NEW.reason IS NOT OLD.reason
      OR NEW.proposed_by_attempt_id IS NOT OLD.proposed_by_attempt_id
      OR NEW.expected_owner_revision IS NOT OLD.expected_owner_revision OR NEW.created_at IS NOT OLD.created_at
      OR (NEW.position IS NOT NULL AND NEW.position<>(SELECT ${latestPosition}+1))
    BEGIN SELECT RAISE(ABORT,'Invalid handoff change'); END`,
  handoffs_delete: `CREATE TRIGGER handoffs_delete BEFORE DELETE ON handoffs
    BEGIN SELECT RAISE(ABORT,'Immutable handoff'); END`,
  handoff_selected_messages_initial: `CREATE TRIGGER handoff_selected_messages_initial BEFORE INSERT ON handoff_selected_messages
    WHEN NOT EXISTS (SELECT 1 FROM handoffs h JOIN messages m ON m.id=NEW.message_id
      WHERE h.id=NEW.handoff_id AND h.initiated_by='researcher' AND h.conversation_id=m.conversation_id
        AND m.position<h.position AND NOT EXISTS (SELECT 1 FROM command_receipts WHERE operation_id=h.decided_by_operation_id))
    BEGIN SELECT RAISE(ABORT,'Invalid handoff selection'); END`,
  handoff_selected_messages_update: `CREATE TRIGGER handoff_selected_messages_update BEFORE UPDATE ON handoff_selected_messages
    BEGIN SELECT RAISE(ABORT,'Immutable handoff selection'); END`,
  handoff_selected_messages_delete: `CREATE TRIGGER handoff_selected_messages_delete BEFORE DELETE ON handoff_selected_messages
    BEGIN SELECT RAISE(ABORT,'Immutable handoff selection'); END`,
  receipts_commands: proposals.receipts_commands
    .replace("'plan.accept','plan.decline'", "'handoff.accept','handoff.decline','handoff.return','plan.accept','plan.decline'")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command IN ('handoff.accept','handoff.decline','handoff.return') AND NOT EXISTS (
        SELECT 1 FROM handoffs h JOIN conversations c ON c.id=h.conversation_id
          WHERE h.id=NEW.result_id AND h.decided_by_operation_id=NEW.operation_id
          AND h.initiated_by=CASE NEW.command WHEN 'handoff.return' THEN 'researcher' ELSE 'agent' END
          AND (NEW.command='handoff.decline' AND h.state='declined'
            OR NEW.command<>'handoff.decline' AND h.state='accepted'
              AND c.agent_id=h.to_agent_id AND c.owner_revision=h.expected_owner_revision+1)))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("ALTER TABLE conversations ADD COLUMN " + ownerColumn).execute(db);
  for (const definition of Object.values(tables)) await sql.raw(definition).execute(db);
  for (const name of ["conversations_initial", "conversations_changes", "tasks_reservation", "messages_position", "receipts_commands"])
    await sql.raw("DROP TRIGGER " + name).execute(db);
  for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
}
