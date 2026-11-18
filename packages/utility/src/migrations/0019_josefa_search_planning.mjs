import { sql } from "kysely";
import { objects as previous } from "./0017_project_opening.mjs";

export const objects = {
  receipts_commands: previous.receipts_commands.replace("'development.createProject'", "'development.createProject','development.sendToJosefa'"),
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw("DROP TRIGGER receipts_commands").execute(database);
  await sql.raw(objects.receipts_commands).execute(database);
}
