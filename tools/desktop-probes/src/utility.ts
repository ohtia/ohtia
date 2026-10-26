import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { observePublication, reserveProbeFile } from "./filesystem.js";
import { observeMigrationRollback } from "./rollback.js";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const expected = JSON.parse(readFileSync(path.join(appRoot, "expected.json"), "utf8")) as {
  target: string;
  addonSha256: string;
  sqliteVersion: string;
  sqliteSourceId: string;
  requiredOptions: string[];
  runtime: Record<string, string>;
  busyMs: number;
};
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function probe() {
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error("Missing admitted scratch root.");
  if (`${process.platform}-${process.arch}` !== expected.target)
    throw new Error("Utility target mismatch.");
  for (const [name, version] of Object.entries(expected.runtime)) {
    if (process.versions[name] !== version) throw new Error("Utility runtime ABI mismatch.");
  }
  const addon = path.join(appRoot, "native", "binding.node");
  if (digest(addon) !== expected.addonSha256) throw new Error("Native artifact replaced.");
  const databasePath = path.join(directory, "synthetic.db3");
  const open = (file: string) =>
    new Database(file, { nativeBinding: addon, timeout: expected.busyMs });
  reserveProbeFile(databasePath);
  let db = open(databasePath);
  try {
    const version = db.prepare("SELECT sqlite_version() AS value").pluck().get();
    const sourceId = db.prepare("SELECT sqlite_source_id() AS value").pluck().get();
    const options = (db.pragma("compile_options") as { compile_options: string }[])
      .map((item) => item.compile_options)
      .sort();
    if (version !== expected.sqliteVersion || sourceId !== expected.sqliteSourceId)
      throw new Error("SQLite source identity mismatch.");
    if (!expected.requiredOptions.every((option) => options.includes(option)))
      throw new Error("SQLite required compilation options missing.");
    db.pragma("foreign_keys = ON");
    if (db.pragma("foreign_keys", { simple: true }) !== 1)
      throw new Error("Foreign key admission failed.");
    db.exec(
      "CREATE TABLE parent(id INTEGER PRIMARY KEY);" +
        "CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));",
    );
    let constraintRejected = false;
    try {
      db.prepare("INSERT INTO child VALUES (1, 404)").run();
    } catch (error) {
      if (error instanceof Database.SqliteError && error.code === "SQLITE_CONSTRAINT_FOREIGNKEY")
        constraintRejected = true;
      else throw error;
    }
    if (!constraintRejected) throw new Error("Constraint was not enforced.");
    const competing = open(databasePath);
    let lockRejected = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        try {
          competing.exec("BEGIN IMMEDIATE");
        } catch (error) {
          if (error instanceof Database.SqliteError && error.code === "SQLITE_BUSY")
            lockRejected = true;
          else throw error;
        }
      } finally {
        db.exec("ROLLBACK");
      }
    } finally {
      competing.close();
    }
    if (!lockRejected) throw new Error("Competing writer was not excluded.");
    const migrationRollback = observeMigrationRollback(db);
    db.transaction(() => {
      db.exec("INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1, 1)");
      db.pragma("user_version = 1");
    })();
    const backupPath = path.join(directory, "backup.db3");
    reserveProbeFile(backupPath);
    await db.backup(backupPath);
    db.close();
    db = open(databasePath);
    const backup = open(backupPath);
    try {
      for (const connection of [db, backup]) {
        if (
          connection.prepare("SELECT parent_id FROM child WHERE id = 1").pluck().get() !== 1 ||
          connection.pragma("integrity_check", { simple: true }) !== "ok" ||
          connection.pragma("user_version", { simple: true }) !== 1
        )
          throw new Error("File-backed reopen or backup failed.");
      }
    } finally {
      backup.close();
    }
    return {
      versions: process.versions,
      arch: process.arch,
      addonSha256: digest(addon),
      sqliteVersion: version,
      sqliteSourceId: sourceId,
      compileOptions: options,
      foreignKeys: true,
      constraintRejected,
      migrationRollback,
      fileBackedReopen: true,
      backup: true,
      competingWriterRejected: lockRejected,
      filesystem: observePublication(directory),
    };
  } finally {
    db.close();
  }
}

async function run() {
  let exitCode = 0;
  process.parentPort.once("message", (event) => {
    process.exit(event.data === "probe-result-received" ? exitCode : 1);
  });
  try {
    process.parentPort.postMessage({ ok: true, result: await probe() });
  } catch (error) {
    exitCode = 1;
    process.parentPort.postMessage({
      ok: false,
      code: "utility-probe-failed",
      failure:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: "UnknownError" },
    });
  }
}
void run();
