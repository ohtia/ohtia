import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";

/** Inspect a disposable in-memory engine without opening research or preference data. */
export async function inspectSqliteEngine(): Promise<string> {
  const database = new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({ database: new Database(":memory:") }),
  });
  try {
    const result = await sql<{ version: string }>`select sqlite_version() as version`.execute(
      database,
    );
    const row = result.rows[0];
    if (!row || typeof row.version !== "string")
      throw new Error("SQLite engine identity is unavailable.");
    return row.version;
  } finally {
    await database.destroy();
  }
}
