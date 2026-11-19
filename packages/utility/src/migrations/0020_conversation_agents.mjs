import { sql } from "kysely";
import { objects as previous } from "./0018_conversation_titles.mjs";

export const agentColumn = "agent_id TEXT NOT NULL DEFAULT 'virgilio' CHECK (agent_id IN ('virgilio','josefa'))";
export const objects = {
  conversations_changes: previous.conversations_changes.replace(
    "WHEN NEW.id<>OLD.id",
    "WHEN NEW.agent_id<>OLD.agent_id OR NEW.id<>OLD.id",
  ),
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw("ALTER TABLE conversations ADD COLUMN " + agentColumn).execute(database);
  await sql.raw("DROP TRIGGER conversations_changes").execute(database);
  await sql.raw(objects.conversations_changes).execute(database);
}
