import { sql } from "kysely";
import { objects as replyObjects } from "./0010_reply_control.mjs";

export const objects = {
  receipts_commands: replyObjects.receipts_commands.replace("'task.continueAll'", "'task.continueAll','task.cancelAll'"),
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw("DROP TRIGGER receipts_commands").execute(database);
  await sql.raw(objects.receipts_commands).execute(database);
}
