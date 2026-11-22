import { sql } from "kysely";
import { objects as previousObjects } from "./0029_project_memory.mjs";

export const objects = {
  receipts_commands: previousObjects.receipts_commands
    .replace("'memory.undo'", "'memory.undo','memory.add','memory.edit','memory.withdraw'")
    .replace("    BEGIN SELECT RAISE", `      OR (NEW.command IN ('memory.add','memory.edit','memory.withdraw') AND NOT EXISTS (
        SELECT 1 FROM memory_entry_versions v JOIN memory_entries e ON e.current_version_id=v.id
        WHERE e.id=NEW.result_id AND v.operation_id=NEW.operation_id AND v.author='researcher'
          AND v.change=CASE NEW.command WHEN 'memory.add' THEN 'added' WHEN 'memory.edit' THEN 'edited' ELSE 'withdrawn' END))
    BEGIN SELECT RAISE`),
};

/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  await sql.raw("DROP TRIGGER receipts_commands").execute(db);
  await sql.raw(objects.receipts_commands).execute(db);
}
