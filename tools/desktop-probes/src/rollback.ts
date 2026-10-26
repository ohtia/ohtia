import type Database from "better-sqlite3";

/** A begin/statement failure must never masquerade as a successful rollback probe. */
export function observeMigrationRollback(db: Database.Database): true {
  const interruption = new Error("Synthetic migration interruption.");
  const observation = { mutated: false, interrupted: false };
  try {
    db.transaction(() => {
      db.exec("CREATE TABLE rolled_back(id INTEGER); PRAGMA user_version = 1");
      observation.mutated =
        db.pragma("user_version", { simple: true }) === 1 &&
        db.prepare("SELECT name FROM sqlite_schema WHERE name = 'rolled_back'").get() !== undefined;
      throw interruption;
    })();
  } catch (error) {
    if (error !== interruption) throw error;
    observation.interrupted = true;
  }
  if (
    !observation.mutated ||
    !observation.interrupted ||
    db.pragma("user_version", { simple: true }) !== 0 ||
    db.prepare("SELECT name FROM sqlite_schema WHERE name = 'rolled_back'").get()
  )
    throw new Error("Migration rollback failed.");
  return true;
}
