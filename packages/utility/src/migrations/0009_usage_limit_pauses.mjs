import { sql } from "kysely";

// Published migration bytes are immutable; keep the schema self-contained.
/** @param {string} field */
const uuid = (field) =>
  `typeof(${field})='blob' AND length(${field})=16 AND substr(hex(${field}),13,1)='7' AND substr(hex(${field}),17,1) IN ('8','9','A','B')`;
/** @param {string} field */
const time = (field) =>
  `typeof(${field})='text' AND length(${field})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${field},'+0 seconds')=${field}`;
export const tables = {
  usage_limit_pauses: `CREATE TABLE usage_limit_pauses (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    connection TEXT NOT NULL CHECK (connection='chatgpt'),
    source_attempt_id BLOB NOT NULL REFERENCES attempts(id) CHECK (${uuid("source_attempt_id")}),
    paused_at TEXT NOT NULL CHECK (${time("paused_at")}),
    resumed_at TEXT CHECK (resumed_at IS NULL OR (${time("resumed_at")})),
    resumed_by_operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((resumed_at IS NULL) = (resumed_by_operation_id IS NULL))
  )`,
};
export const objects = {
  usage_one_open: "CREATE UNIQUE INDEX usage_one_open ON usage_limit_pauses(connection) WHERE resumed_at IS NULL",
  usage_initial: `CREATE TRIGGER usage_initial BEFORE INSERT ON usage_limit_pauses
    WHEN NEW.resumed_at IS NOT NULL OR NEW.resumed_by_operation_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
        WHERE a.id=NEW.source_attempt_id AND a.state='failed' AND a.outcome_reason='usage_limit_reached' AND t.connection=NEW.connection)
    BEGIN SELECT RAISE(ABORT,'Invalid usage pause'); END`,
  usage_changes: `CREATE TRIGGER usage_changes BEFORE UPDATE ON usage_limit_pauses
    WHEN OLD.resumed_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.connection<>OLD.connection
      OR NEW.source_attempt_id<>OLD.source_attempt_id OR NEW.paused_at<>OLD.paused_at
      OR NEW.resumed_at IS NULL OR NEW.resumed_by_operation_id IS NULL
    BEGIN SELECT RAISE(ABORT,'Immutable usage pause'); END`,
  usage_delete: `CREATE TRIGGER usage_delete BEFORE DELETE ON usage_limit_pauses
    BEGIN SELECT RAISE(ABORT,'Immutable usage pause'); END`,
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  for (const statement of [...Object.values(tables), ...Object.values(objects)])
    await sql.raw(statement).execute(database);
}
