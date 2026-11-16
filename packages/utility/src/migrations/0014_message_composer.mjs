import { sql } from "kysely";
import { objects as exitObjects } from "./0012_application_exit.mjs";

export const objects = {
  receipts_commands: exitObjects.receipts_commands.replace("'conversation.rename'", "'conversation.rename','conversation.stop'"),
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw("DROP TRIGGER receipts_commands").execute(database);
  await sql.raw(objects.receipts_commands).execute(database);
}
