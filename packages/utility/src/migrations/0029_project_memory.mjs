import { sql } from "kysely";
import { tables as previousTables, objects as previousObjects } from "./0028_plan_redirection.mjs";

export const tables = {
  contributions: previousTables.contributions
    .replace("policy_version IN (2,3)", "policy_version IN (2,3,4)")
    .replace("operation='search_strategy_planning' AND policy_version=2", "operation='search_strategy_planning' AND policy_version IN (2,4)"),
  continuations: previousTables.continuations.replace("policy_version IN (1,2)", "policy_version IN (1,2,3)"),
  memory_entries: `CREATE TABLE memory_entries (
    id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
    project_id BLOB NOT NULL REFERENCES projects(id),
    author TEXT NOT NULL CHECK (author IN ('researcher','virgilio')),
    current_version_id BLOB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active','withdrawn')),
    FOREIGN KEY (id,current_version_id,state) REFERENCES memory_entry_versions(entry_id,id,state)
      DEFERRABLE INITIALLY DEFERRED
  ) STRICT`,
  memory_entry_versions: `CREATE TABLE memory_entry_versions (
    id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
    entry_id BLOB NOT NULL REFERENCES memory_entries(id),
    number INTEGER NOT NULL CHECK (number>0),
    kind TEXT NOT NULL CHECK (kind IN ('goal','decision','focus','open_question','note')),
    text TEXT NOT NULL CHECK (length(CAST(text AS BLOB)) BETWEEN 1 AND 8000),
    state TEXT NOT NULL CHECK (state IN ('active','withdrawn')),
    change TEXT NOT NULL CHECK (change IN ('added','edited','merged','merged_into','withdrawn','undone')),
    merged_into_entry_id BLOB REFERENCES memory_entries(id),
    author TEXT NOT NULL CHECK (author IN ('researcher','virgilio')),
    attempt_id BLOB REFERENCES attempts(id),
    operation_id TEXT REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (entry_id,number),
    UNIQUE (entry_id,id,state),
    CHECK ((change='added')=(number=1)),
    CHECK ((change='merged_into')=(merged_into_entry_id IS NOT NULL) AND merged_into_entry_id IS NOT entry_id),
    CHECK (change='undone' OR (state='withdrawn')=(change IN ('withdrawn','merged_into'))),
    CHECK ((author='virgilio')=(attempt_id IS NOT NULL) AND (author='researcher')=(operation_id IS NOT NULL)),
    CHECK (change<>'undone' OR author='researcher')
  ) STRICT`,
  memory_version_sources: `CREATE TABLE memory_version_sources (
    version_id BLOB NOT NULL REFERENCES memory_entry_versions(id),
    message_id BLOB NOT NULL REFERENCES messages(id),
    PRIMARY KEY (version_id,message_id)
  ) STRICT`,
  memory_change_rejections: `CREATE TABLE memory_change_rejections (
    attempt_id BLOB NOT NULL REFERENCES attempts(id),
    change_index INTEGER NOT NULL CHECK (change_index>0),
    code TEXT NOT NULL CHECK (code IN ('multiple_calls','too_many_changes','wrong_entry_count',
      'unknown_label','entry_changed','researcher_entry','goal_or_decision_merge','text_empty',
      'text_too_long','too_many_sources','researcher_source_missing','memory_full')),
    PRIMARY KEY (attempt_id,change_index)
  ) STRICT`,
  memory_reply_changes: `CREATE TABLE memory_reply_changes (
    id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
    task_id BLOB NOT NULL UNIQUE REFERENCES tasks(id),
    attempt_id BLOB NOT NULL UNIQUE REFERENCES attempts(id),
    added INTEGER NOT NULL CHECK (added>=0),
    edited INTEGER NOT NULL CHECK (edited>=0),
    merged INTEGER NOT NULL CHECK (merged>=0),
    withdrawn INTEGER NOT NULL CHECK (withdrawn>=0),
    rejected INTEGER NOT NULL CHECK (rejected>=0),
    undo_operation_id TEXT UNIQUE REFERENCES command_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (added+edited+merged+withdrawn BETWEEN 0 AND 3),
    CHECK (added+edited+merged+withdrawn+rejected>0),
    CHECK (undo_operation_id IS NULL OR added+edited+merged+withdrawn>0)
  ) STRICT`,
  memory_reply_reviews: `CREATE TABLE memory_reply_reviews (
    id BLOB PRIMARY KEY NOT NULL CHECK (length(id)=16),
    task_id BLOB NOT NULL UNIQUE REFERENCES tasks(id)
  ) STRICT`,
};
const memoryTables = Object.entries(tables).filter(([name]) => name.startsWith("memory_"));
/** @type {Record<string, string>} */
const immutable = Object.fromEntries(memoryTables.flatMap(([name]) => [
  [`${name}_delete`, `CREATE TRIGGER ${name}_delete BEFORE DELETE ON ${name}
    BEGIN SELECT RAISE(ABORT,'Immutable memory history'); END`],
  ...(["memory_entries", "memory_reply_changes"].includes(name) ? [] : [
    [`${name}_update`, `CREATE TRIGGER ${name}_update BEFORE UPDATE ON ${name}
      BEGIN SELECT RAISE(ABORT,'Immutable memory history'); END`],
  ]),
]));

export const objects = {
  ...Object.fromEntries(Object.entries(previousObjects).filter(([name]) => name.startsWith("contributions_") || name.startsWith("continuations_"))),
  continuations_changes: previousObjects.continuations_changes.replace(
    "OLD.policy_version=1 AND NEW.policy_version=2 AND NEW.admission='admitted'",
    "OLD.policy_version<NEW.policy_version AND NEW.admission='admitted'",
  ),
  tasks_initial: previousObjects.tasks_initial.replace(
    "(NEW.operation='contribution_synthesis' AND t.policy_version=1 AND NEW.policy_version=2 AND NEW.instruction_version=2)",
    "(NEW.operation='contribution_synthesis' AND t.policy_version<NEW.policy_version AND NEW.instruction_version=NEW.policy_version)",
  ),
  receipts_commands: previousObjects.receipts_commands
    .replace("'planChange.apply','planChange.decline'", "'planChange.apply','planChange.decline','memory.undo'")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command='memory.undo' AND NOT EXISTS (
        SELECT 1 FROM memory_reply_changes c WHERE c.task_id=NEW.result_id AND c.undo_operation_id=NEW.operation_id))
    BEGIN SELECT RAISE`),
  ...immutable,
  memory_entries_project: "CREATE INDEX memory_entries_project ON memory_entries(project_id,state)",
  memory_entry_versions_attempt: "CREATE INDEX memory_entry_versions_attempt ON memory_entry_versions(attempt_id)",
  memory_entries_update: `CREATE TRIGGER memory_entries_update BEFORE UPDATE ON memory_entries
    WHEN OLD.id<>NEW.id OR OLD.project_id<>NEW.project_id OR OLD.author<>NEW.author
      OR NOT EXISTS (SELECT 1 FROM memory_entry_versions before JOIN memory_entry_versions after
        ON after.entry_id=before.entry_id AND after.number=before.number+1
        WHERE before.id=OLD.current_version_id AND after.id=NEW.current_version_id AND after.state=NEW.state)
    BEGIN SELECT RAISE(ABORT,'Invalid memory entry revision'); END`,
  memory_entry_versions_insert: `CREATE TRIGGER memory_entry_versions_insert BEFORE INSERT ON memory_entry_versions
    WHEN (NEW.number=1 AND NOT EXISTS (SELECT 1 FROM memory_entries e
      WHERE e.id=NEW.entry_id AND e.current_version_id=NEW.id AND e.author=NEW.author))
      OR (NEW.number>1 AND NOT EXISTS (SELECT 1 FROM memory_entries e JOIN memory_entry_versions v
        ON v.id=e.current_version_id WHERE e.id=NEW.entry_id AND v.number=NEW.number-1))
      OR (NEW.attempt_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id JOIN memory_entries e ON e.project_id=t.project_id
        WHERE a.id=NEW.attempt_id AND a.state='completed' AND t.operation='direct_guidance'
          AND t.instruction_version>=6 AND e.id=NEW.entry_id))
      OR (NEW.merged_into_entry_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM memory_entries source JOIN memory_entries target ON target.project_id=source.project_id
        WHERE source.id=NEW.entry_id AND target.id=NEW.merged_into_entry_id))
    BEGIN SELECT RAISE(ABORT,'Invalid memory version provenance'); END`,
  memory_version_sources_insert: `CREATE TRIGGER memory_version_sources_insert BEFORE INSERT ON memory_version_sources
    WHEN NOT EXISTS (SELECT 1 FROM memory_entry_versions v JOIN memory_entries e ON e.id=v.entry_id
      JOIN conversations c ON c.project_id=e.project_id JOIN messages m ON m.conversation_id=c.id
      WHERE v.id=NEW.version_id AND m.id=NEW.message_id)
    BEGIN SELECT RAISE(ABORT,'Memory source belongs to another project'); END`,
  memory_reply_changes_insert: `CREATE TRIGGER memory_reply_changes_insert BEFORE INSERT ON memory_reply_changes
    WHEN NEW.undo_operation_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
      WHERE a.id=NEW.attempt_id AND a.task_id=NEW.task_id AND a.state='completed'
        AND t.operation='direct_guidance' AND t.instruction_version>=6)
    BEGIN SELECT RAISE(ABORT,'Invalid memory reply'); END`,
  memory_reply_changes_update: `CREATE TRIGGER memory_reply_changes_update BEFORE UPDATE ON memory_reply_changes
    WHEN OLD.id<>NEW.id OR OLD.task_id<>NEW.task_id OR OLD.attempt_id<>NEW.attempt_id
      OR OLD.added<>NEW.added OR OLD.edited<>NEW.edited OR OLD.merged<>NEW.merged
      OR OLD.withdrawn<>NEW.withdrawn OR OLD.rejected<>NEW.rejected
      OR OLD.undo_operation_id IS NOT NULL OR NEW.undo_operation_id IS NULL
    BEGIN SELECT RAISE(ABORT,'Invalid memory undo'); END`,
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("PRAGMA legacy_alter_table=ON").execute(db);
  try {
    for (const name of ["receipts_commands", "tasks_initial"])
      await sql.raw(`DROP TRIGGER ${name}`).execute(db);
    for (const name of /** @type {const} */ (["contributions", "continuations"])) {
      await sql.raw(`ALTER TABLE ${name} RENAME TO ${name}_before_memory`).execute(db);
      await sql.raw(tables[name]).execute(db);
      await sql.raw(`INSERT INTO ${name} SELECT * FROM ${name}_before_memory ORDER BY rowid`).execute(db);
      await sql.raw(`DROP TABLE ${name}_before_memory`).execute(db);
    }
    for (const [, definition] of memoryTables) await sql.raw(definition).execute(db);
    for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
  } finally {
    await sql.raw("PRAGMA legacy_alter_table=OFF").execute(db);
  }
}
