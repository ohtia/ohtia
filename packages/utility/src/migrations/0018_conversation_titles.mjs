import { sql } from "kysely";

export const columns = {
  eligible: "automatic_title_eligible INTEGER NOT NULL DEFAULT 0 CHECK (automatic_title_eligible IN (0,1))",
  origin: "title_attempt_id BLOB REFERENCES attempts(id) CHECK (title_attempt_id IS NULL OR (automatic_title_eligible=1 AND title IS NOT NULL))",
  policy: "conversation_title_policy INTEGER CHECK (conversation_title_policy=1)",
};
export const objects = {
  conversations_changes: `CREATE TRIGGER conversations_changes BEFORE UPDATE ON conversations
    WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.created_at<>OLD.created_at OR
      NEW.revision<>OLD.revision+1 OR NEW.automatic_title_eligible<>OLD.automatic_title_eligible OR
      (NEW.updated_at<>OLD.updated_at AND (NEW.title IS NULL OR NEW.updated_at<=OLD.updated_at OR NEW.title_attempt_id IS NOT NULL)) OR
      (NEW.updated_at=OLD.updated_at AND (NEW.title IS NOT OLD.title OR NEW.title_attempt_id IS NOT OLD.title_attempt_id) AND NOT (
        OLD.title IS NULL AND NEW.title IS NOT NULL AND NEW.title_attempt_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
          WHERE a.id=NEW.title_attempt_id AND a.state='completed' AND a.conversation_title_policy=1 AND t.conversation_id=OLD.id
        )
      ))
    BEGIN SELECT RAISE(ABORT,'Invalid conversation change'); END`,
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(`ALTER TABLE conversations ADD COLUMN ${columns.eligible}`).execute(database);
  await sql.raw(`ALTER TABLE conversations ADD COLUMN ${columns.origin}`).execute(database);
  await sql.raw(`ALTER TABLE attempts ADD COLUMN ${columns.policy}`).execute(database);
  await sql.raw("DROP TRIGGER conversations_changes").execute(database);
  await sql.raw(objects.conversations_changes).execute(database);
}
