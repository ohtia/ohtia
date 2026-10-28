import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { Migrator } from "kysely/migration";
import {
  failure,
  isAppearance,
  isIdentifier,
  isInterfaceLocale,
  staleRevision,
  type Appearance,
  type AppearanceRecord,
  type AppearanceReceipt,
  type InterfaceLocale,
  type Outcome,
  type SavedAppearanceRecord,
} from "@ohtia/contracts";
import {
  applyAppearanceCommand,
  type AppearanceCommand,
  type RecordedAppearanceCommand,
} from "@ohtia/domain";
import { up as initial, schema as preferencesSchema } from "./migrations/0001_initial.mjs";
import { up as receipts, schema as receiptsSchema } from "./migrations/0002_receipts.mjs";

interface Preferences {
  key: string;
  schema_version: number;
  revision: number;
  value: string;
}
interface Receipt {
  operation_id: string;
  expected_revision: number;
  value: Appearance;
  accepted: number;
  result_revision: number;
}
interface Schema {
  application_preferences: Preferences;
  appearance_receipts: Receipt;
  kysely_migration: { name: string; timestamp: string };
  ohtia_migration_artifacts: { name: string; sha256: string };
}
export interface EngineIdentity {
  readonly version: string;
  readonly sourceId: string;
  readonly compileOptions: readonly string[];
}
export interface StorageOptions {
  /** Supplied only by the independently admitted utility context, never by a port request. */
  readonly root: string;
  readonly binding: string;
  readonly bindingSha256: string;
  readonly engine: {
    readonly version: string;
    readonly sourceId: string;
    readonly requiredOptions: readonly string[];
  };
  readonly migrationDirectory: string;
  readonly release: string;
  readonly allowCreate?: boolean;
  readonly assertAdmission: () => void;
}
interface Artifact {
  readonly name: string;
  readonly sha256: string;
}
interface Checkpoint {
  readonly version: 1;
  readonly operation: string;
  readonly sourceRevision: number;
  readonly targetRevision: number;
  readonly sourceMigration: string | null;
  readonly targetMigration: string;
  readonly pending: readonly Artifact[];
  readonly release: string;
  readonly engine: EngineIdentity;
  readonly sha256: string;
  readonly bytes: number;
  readonly retainedObjects: readonly string[];
}
const names = ["0001_initial", "0002_receipts"] as const;
const target = names.length;
const targetName = names[1];
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function regular(file: string): void {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || fs.realpathSync.native(file) !== file)
    throw new Error("Unsafe storage file.");
}
function fileIdentity(file: string): { bytes: number; sha256: string } {
  regular(file);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW),
  );
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      bytes += read;
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}
function syncDirectory(directory: string): void {
  const fd = fs.openSync(directory, process.platform === "win32" ? "r+" : "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function writeSynced(file: string, value: unknown, replaceIntent = false): void {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.intent-${randomUUID()}.partial`);
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Atomic no-clobber publication preserves another owner's complete intent.
  if (replaceIntent) fs.renameSync(temporary, file);
  else fs.linkSync(temporary, file);
  syncDirectory(directory);
  if (!replaceIntent) fs.unlinkSync(temporary);
  syncDirectory(directory);
}
/** A crash may leave the one known publication link alongside a complete intent. */
function readIntent(file: string): unknown {
  const stat = fs.lstatSync(file, { bigint: true });
  if (stat.nlink !== 1n) {
    if (!stat.isFile() || stat.nlink !== 2n || fs.realpathSync.native(file) !== file)
      throw new Error("Invalid intent identity.");
    const directory = path.dirname(file);
    const links = fs.readdirSync(directory).filter((name) => {
      if (!/^\.intent-[0-9a-f-]{36}\.partial$/.test(name)) return false;
      const candidate = path.join(directory, name);
      const other = fs.lstatSync(candidate, { bigint: true });
      return (
        other.isFile() &&
        other.dev === stat.dev &&
        other.ino === stat.ino &&
        other.nlink === 2n &&
        fs.realpathSync.native(candidate) === candidate
      );
    });
    if (links.length !== 1) throw new Error("Unrecognized intent publication link.");
    fs.unlinkSync(path.join(directory, links[0] ?? ""));
    syncDirectory(directory);
  }
  return readJson(file);
}
function readJson(file: string): unknown {
  regular(file);
  if (fs.statSync(file).size > 65536) throw new Error("Oversized storage metadata.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
}
function manifest(options: StorageOptions): Artifact[] {
  const value = readJson(path.join(options.migrationDirectory, "manifest.json"));
  if (!Array.isArray(value) || value.length !== names.length)
    throw new Error("Invalid migration registry.");
  return names.map((name, i) => {
    const row: unknown = value[i];
    if (!row || typeof row !== "object" || Object.keys(row).sort().join(",") !== "name,sha256")
      throw new Error("Invalid migration identity.");
    const entry = row as Record<string, unknown>;
    const file = path.join(options.migrationDirectory, `${name}.mjs`);
    regular(file);
    const sha256 = digest(fs.readFileSync(file));
    if (entry.name !== name || entry.sha256 !== sha256)
      throw new Error("Changed migration module.");
    return { name, sha256 };
  });
}
function connect(options: StorageOptions, file: string, readonly = false): Database.Database {
  regular(options.binding);
  if (digest(fs.readFileSync(options.binding)) !== options.bindingSha256)
    throw new Error("Native binding identity mismatch.");
  const db = new Database(file, {
    nativeBinding: options.binding,
    readonly,
    fileMustExist: true,
    timeout: 0,
  });
  try {
    const version: unknown = db.prepare("SELECT sqlite_version() AS version").get();
    const source: unknown = db.prepare("SELECT sqlite_source_id() AS source").get();
    const compile = (db.pragma("compile_options") as { compile_options: string }[])
      .map((row) => row.compile_options)
      .sort();
    if (
      (version as { version: string }).version !== options.engine.version ||
      (source as { source: string }).source !== options.engine.sourceId ||
      !options.engine.requiredOptions.every((option) => compile.includes(option))
    )
      throw new Error("SQLite engine identity mismatch.");
    db.pragma("foreign_keys = ON");
    if (db.pragma("foreign_keys", { simple: true }) !== 1)
      throw new Error("Foreign keys unavailable.");
    if (!readonly) {
      db.pragma("synchronous = FULL");
      if (db.pragma("synchronous", { simple: true }) !== 2)
        throw new Error("Unsafe synchronization.");
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function integrity(db: Database.Database): void {
  const rows = db.pragma("integrity_check") as { integrity_check: string }[];
  if (
    rows.length !== 1 ||
    rows[0]?.integrity_check !== "ok" ||
    (db.pragma("foreign_key_check") as unknown[]).length
  )
    throw new Error("Storage integrity check failed.");
}
function limits(db: Database.Database): void {
  const row = db
    .prepare("SELECT * FROM application_preferences WHERE key = 'execution_limits'")
    .get() as Preferences | undefined;
  if (!row || row.schema_version !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1)
    throw new Error("Execution limits unavailable.");
  if (typeof row.value !== "string" || row.value.length > 1024)
    throw new Error("Invalid execution-limit encoding.");
  const value: unknown = JSON.parse(row.value);
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !==
      "max_concurrent_inference,max_concurrent_local_processing" ||
    !Object.values(value).every(
      (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item > 0,
    )
  )
    throw new Error("Invalid execution limits.");
}
function compatibility(db: Database.Database, artifacts: readonly Artifact[]): number {
  integrity(db);
  const revision: unknown = db.pragma("user_version", { simple: true });
  if (typeof revision !== "number" || revision < 0 || revision > target)
    throw new Error("Unsupported schema revision.");
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  if (revision === 0) {
    if (
      tables.length ||
      (db.prepare("SELECT count(*) AS count FROM sqlite_schema").get() as { count: number }).count
    )
      throw new Error("Unexpected revision-zero schema.");
    return 0;
  }
  const expected = [
    "application_preferences",
    "kysely_migration",
    "kysely_migration_lock",
    "ohtia_migration_artifacts",
    ...(revision === 2 ? ["appearance_receipts"] : []),
  ].sort();
  if (JSON.stringify(tables.map((row) => row.name)) !== JSON.stringify(expected))
    throw new Error("Unexpected source schema.");
  const history = db
    .prepare("SELECT name FROM kysely_migration ORDER BY timestamp, name")
    .all() as {
    name: string;
  }[];
  const stored = db
    .prepare("SELECT name,sha256 FROM ohtia_migration_artifacts ORDER BY name")
    .all();
  if (
    JSON.stringify(history.map((row) => row.name)) !== JSON.stringify(names.slice(0, revision)) ||
    JSON.stringify(stored) !== JSON.stringify(artifacts.slice(0, revision))
  )
    throw new Error("Migration history identity mismatch.");
  // Reject altered columns instead of letting a future table rebuild discard unknown content.
  for (const [table, columns] of Object.entries({
    application_preferences: ["key", "schema_version", "revision", "value"],
    kysely_migration: ["name", "timestamp"],
    kysely_migration_lock: ["id", "is_locked"],
    ohtia_migration_artifacts: ["name", "sha256"],
    ...(revision === 2
      ? {
          appearance_receipts: [
            "operation_id",
            "expected_revision",
            "value",
            "accepted",
            "result_revision",
          ],
        }
      : {}),
  })) {
    const actual = db.pragma(`table_info(${table})`) as { name: string }[];
    if (JSON.stringify(actual.map((row) => row.name)) !== JSON.stringify(columns))
      throw new Error("Unexpected source columns.");
  }
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  for (const [table, expectedSql] of [
    ["application_preferences", preferencesSchema],
    ...(revision === 2 ? [["appearance_receipts", receiptsSchema]] : []),
  ]) {
    const row = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name=? AND type='table'")
      .get(table) as { sql: string } | undefined;
    if (!row || !expectedSql || normalize(row.sql) !== normalize(expectedSql))
      throw new Error("Altered source constraints.");
  }
  if (
    (
      db
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE type IN ('trigger','view') OR (type='index' AND sql IS NOT NULL)",
        )
        .get() as { count: number }
    ).count !== 0
  )
    throw new Error("Unexpected source objects.");
  limits(db);
  return revision;
}

/** One utility owner; normal commands cannot interleave with schema/recovery admission. */
export class DurableStore {
  private database: Kysely<Schema> | undefined;
  private native: Database.Database | undefined;
  private active = false;
  private admitted = false;
  private creationAllowed: boolean;
  private initializationAllowed: boolean;
  private readonly rootIdentity: { readonly dev: bigint; readonly ino: bigint };
  private openedFile: { readonly dev: bigint; readonly ino: bigint } | undefined;
  private readonly artifacts: Artifact[];
  private readonly file: string;
  private readonly recovery: string;
  private readonly gate: string;
  private readonly restoration: string;
  constructor(private readonly options: StorageOptions) {
    options.assertAdmission();
    if (
      !path.isAbsolute(options.root) ||
      fs.realpathSync.native(options.root) !== options.root ||
      !fs.statSync(options.root).isDirectory()
    )
      throw new Error("Unsafe storage root.");
    this.rootIdentity = fs.statSync(options.root, { bigint: true });
    this.file = path.join(options.root, "ohtia.db3");
    this.creationAllowed = options.allowCreate === true && !exists(this.file);
    this.recovery = path.join(options.root, "recovery", "migrations");
    this.gate = path.join(options.root, "migration-pending.json");
    this.restoration = path.join(options.root, "restore-pending.json");
    this.initializationAllowed = options.allowCreate === true && !exists(this.recovery);
    this.artifacts = manifest(options);
  }
  get admissionReady(): boolean {
    return this.admitted;
  }
  get ready(): boolean {
    return this.admitted && !this.active;
  }
  private assert(): void {
    this.options.assertAdmission();
    if (fs.realpathSync.native(this.options.root) !== this.options.root)
      throw new Error("Storage root changed.");
    const root = fs.statSync(this.options.root, { bigint: true });
    if (root.dev !== this.rootIdentity.dev || root.ino !== this.rootIdentity.ino)
      throw new Error("Storage root identity changed.");
    if (this.openedFile) {
      const file = fs.statSync(this.file, { bigint: true });
      if (file.dev !== this.openedFile.dev || file.ino !== this.openedFile.ino)
        throw new Error("Open database identity changed.");
    }
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const file = this.file + suffix;
      try {
        fs.lstatSync(file);
        regular(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  private openConnection(): Database.Database {
    this.assert();
    if (!exists(this.file)) {
      if (!this.creationAllowed || exists(this.recovery))
        throw new Error("An initialized or retained store cannot be replaced by a fresh database.");
      this.creationAllowed = false;
      const fd = fs.openSync(this.file, "wx", 0o600);
      fs.closeSync(fd);
      syncDirectory(this.options.root);
    }
    this.openedFile = fs.statSync(this.file, { bigint: true });
    const db = connect(this.options, this.file);
    this.native = db;
    this.database = new Kysely<Schema>({ dialect: new SqliteDialect({ database: db }) });
    this.assert();
    return db;
  }
  async close(): Promise<void> {
    this.admitted = false;
    const db = this.database;
    this.database = undefined;
    this.native = undefined;
    this.openedFile = undefined;
    if (db) await db.destroy();
  }
  async open(): Promise<void> {
    return this.openDatabase(false);
  }
  private async openDatabase(retrySource: boolean): Promise<void> {
    if (this.active || this.database) throw new Error("Storage already active.");
    this.active = true;
    try {
      this.assert();
      if (exists(this.gate) && !retrySource)
        throw new Error("Explicit migration recovery required.");
      const db = this.openConnection();
      const revision = compatibility(db, this.artifacts);
      if (revision === 0 && !this.initializationAllowed)
        throw new Error("An initialized locator cannot silently initialize an empty database.");
      if (revision < target) await this.upgrade(db, revision, retrySource);
      else this.cleanupResolved();
      if (
        compatibility(db, this.artifacts) !== target ||
        db.pragma("foreign_keys", { simple: true }) !== 1
      )
        throw new Error("Storage admission failed.");
      this.initializationAllowed = false;
      this.admitted = true;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      this.active = false;
    }
  }
  private async checkpoint(
    db: Database.Database,
    source: number,
    operation: string,
  ): Promise<string> {
    for (const directory of [path.dirname(this.recovery), this.recovery]) {
      try {
        fs.mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (fs.realpathSync.native(directory) !== directory || !fs.lstatSync(directory).isDirectory())
        throw new Error("Unsafe recovery root.");
    }
    if (fs.realpathSync.native(this.recovery) !== this.recovery)
      throw new Error("Aliased recovery root.");
    const partial = path.join(this.recovery, `${operation}.partial`);
    const published = path.join(this.recovery, operation);
    fs.mkdirSync(partial, { mode: 0o700 });
    syncDirectory(path.dirname(this.recovery));
    syncDirectory(this.options.root);
    syncDirectory(this.recovery);
    await db.backup(path.join(partial, "ohtia.db3"));
    this.assert();
    const snapshot = fileIdentity(path.join(partial, "ohtia.db3"));
    const record: Checkpoint = {
      version: 1,
      operation,
      sourceRevision: source,
      targetRevision: target,
      sourceMigration: names[source - 1] ?? null,
      targetMigration: targetName,
      pending: this.artifacts.slice(source),
      release: this.options.release,
      engine: {
        version: this.options.engine.version,
        sourceId: this.options.engine.sourceId,
        compileOptions: (db.pragma("compile_options") as { compile_options: string }[])
          .map((row) => row.compile_options)
          .sort(),
      },
      sha256: snapshot.sha256,
      bytes: snapshot.bytes,
      retainedObjects: [],
    };
    writeSynced(path.join(partial, "manifest.json"), record);
    this.verifyCheckpoint(partial);
    const fd = fs.openSync(path.join(partial, "ohtia.db3"), "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    syncDirectory(partial);
    fs.renameSync(partial, published);
    syncDirectory(this.recovery);
    return operation;
  }
  private verifyCheckpoint(directory: string): Checkpoint {
    if (fs.realpathSync.native(directory) !== directory) throw new Error("Aliased checkpoint.");
    const value = readJson(path.join(directory, "manifest.json"));
    if (!value || typeof value !== "object") throw new Error("Invalid checkpoint manifest.");
    const record = value as Checkpoint;
    const file = path.join(directory, "ohtia.db3");
    regular(file);
    const snapshot = fileIdentity(file);
    if (
      Object.keys(record).sort().join(",") !==
        "bytes,engine,operation,pending,release,retainedObjects,sha256,sourceMigration,sourceRevision,targetMigration,targetRevision,version" ||
      (value as Record<string, unknown>).version !== 1 ||
      !Number.isInteger(record.sourceRevision) ||
      record.sourceRevision < 0 ||
      record.sourceRevision >= target ||
      record.targetRevision !== target ||
      record.targetMigration !== names[target - 1] ||
      record.sourceMigration !== (names[record.sourceRevision - 1] ?? null) ||
      record.release !== this.options.release ||
      !isIdentifier(record.operation) ||
      record.engine.version !== this.options.engine.version ||
      record.engine.sourceId !== this.options.engine.sourceId ||
      !Array.isArray(record.engine.compileOptions) ||
      !this.options.engine.requiredOptions.every((item) =>
        record.engine.compileOptions.includes(item),
      ) ||
      JSON.stringify(record.pending) !==
        JSON.stringify(this.artifacts.slice(record.sourceRevision)) ||
      JSON.stringify(record.retainedObjects) !== "[]" ||
      record.bytes !== snapshot.bytes ||
      record.sha256 !== snapshot.sha256
    )
      throw new Error("Checkpoint identity mismatch.");
    const check = connect(this.options, file, true);
    try {
      if (
        JSON.stringify(
          (check.pragma("compile_options") as { compile_options: string }[])
            .map((row) => row.compile_options)
            .sort(),
        ) !== JSON.stringify(record.engine.compileOptions)
      )
        throw new Error("Checkpoint engine mismatch.");
      if (compatibility(check, this.artifacts) !== record.sourceRevision)
        throw new Error("Checkpoint source mismatch.");
    } finally {
      check.close();
    }
    return record;
  }
  private async upgrade(
    db: Database.Database,
    source: number,
    retrySource: boolean,
  ): Promise<void> {
    // Durable intent precedes any transition; an interrupted intent requires inspection, never auto-retry.
    const operation = randomUUID();
    writeSynced(this.gate, { version: 1, operation, source, target }, retrySource);
    await this.checkpoint(db, source, operation);
    const selected = this.database;
    if (!selected) throw new Error("Missing migration connection.");
    await selected.connection().execute(async (connection) => {
      let begun = false;
      let committed = false;
      try {
        this.assert();
        await sql`BEGIN EXCLUSIVE`.execute(connection);
        begun = true;
        await sql`CREATE TABLE IF NOT EXISTS ohtia_migration_artifacts (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'))`.execute(
          connection,
        );
        const migrator = new Migrator({
          db: connection,
          disableTransactions: true,
          allowUnorderedMigrations: false,
          provider: {
            getMigrations: () =>
              Promise.resolve({
                "0001_initial": { up: initial },
                "0002_receipts": { up: receipts },
              }),
          },
        });
        const result = await migrator.migrateTo(targetName);
        const expected = this.artifacts.slice(source).map((row) => row.name);
        if (
          result.error ||
          !result.results ||
          JSON.stringify(result.results.map((row) => row.migrationName)) !==
            JSON.stringify(expected) ||
          result.results.some((row) => row.status !== "Success" || row.direction !== "Up")
        )
          throw new Error("Incomplete migration result.");
        for (const artifact of this.artifacts.slice(source))
          await connection.insertInto("ohtia_migration_artifacts").values(artifact).execute();
        db.pragma(`user_version = ${String(target)}`);
        if (compatibility(db, this.artifacts) !== target) throw new Error("Invalid target schema.");
        this.assert();
        await sql`COMMIT`.execute(connection);
        committed = true;
        this.assert();
        if (db.inTransaction || compatibility(db, this.artifacts) !== target)
          throw new Error("Commit not confirmed.");
        this.cleanupResolved();
        fs.unlinkSync(this.gate);
        syncDirectory(this.options.root);
      } catch (error) {
        if (begun && !committed && db.inTransaction) {
          await sql`ROLLBACK`.execute(connection);
          if (compatibility(db, this.artifacts) !== source)
            throw new Error("Unverified migration rollback.");
        }
        // Keep intent and checkpoint on every failure, including a successful commit with a lost acknowledgement.
        throw new Error(`Migration requires explicit recovery (${operation}).`, { cause: error });
      }
    });
  }
  private cleanupResolved(): void {
    if (exists(this.restoration)) throw new Error("Recovery materialization remains pending.");
    for (const name of fs.readdirSync(this.options.root)) {
      if (
        !/^\.restore-[0-9a-f-]{36}\.db3(?:-wal|-shm|-journal)?$/.test(name) &&
        !/^\.intent-[0-9a-f-]{36}\.partial$/.test(name)
      )
        continue;
      const file = path.join(this.options.root, name);
      regular(file);
      fs.unlinkSync(file);
      if (exists(file)) throw new Error("Recovery temporary cleanup incomplete.");
      syncDirectory(this.options.root);
    }
    if (!exists(this.recovery)) return;
    if (fs.realpathSync.native(this.recovery) !== this.recovery)
      throw new Error("Unsafe recovery cleanup root.");
    for (const name of fs.readdirSync(this.recovery)) {
      if (!/^[0-9a-f-]{36}(?:\.partial|\.failed-[0-9a-f-]{36})$/.test(name)) continue;
      const directory = path.join(this.recovery, name);
      if (fs.realpathSync.native(directory) !== directory || !fs.lstatSync(directory).isDirectory())
        throw new Error("Unsafe recovery cleanup entry.");
      fs.rmSync(directory, { recursive: true });
      if (exists(directory)) throw new Error("Recovery cleanup incomplete.");
      syncDirectory(this.recovery);
    }
  }
  /** Explicit action: inspect a complete source/target after an interruption, then retry only a proven source. */
  async retry(): Promise<void> {
    if (this.active) throw new Error("Storage busy.");
    await this.close();
    this.assert();
    if (exists(this.restoration))
      throw new Error("Complete the pending checkpoint restoration first.");
    if (!exists(this.gate)) return this.open();
    const gate = readIntent(this.gate) as {
      version?: unknown;
      source?: unknown;
      target?: unknown;
      operation?: unknown;
    };
    if (
      Object.keys(gate).sort().join(",") !== "operation,source,target,version" ||
      gate.version !== 1 ||
      !isIdentifier(gate.operation) ||
      typeof gate.source !== "number" ||
      !Number.isInteger(gate.source) ||
      gate.source < 0 ||
      gate.source >= target ||
      gate.target !== target
    )
      throw new Error("Invalid recovery intent.");
    regular(this.file);
    const db = connect(this.options, this.file);
    let revision: number;
    try {
      revision = compatibility(db, this.artifacts);
      if (revision !== gate.source && revision !== target)
        throw new Error("Unresolved migration outcome.");
    } finally {
      db.close();
    }
    if (revision === target) {
      this.cleanupResolved();
      fs.unlinkSync(this.gate);
      syncDirectory(this.options.root);
      await this.open();
    } else {
      if (revision === 0) this.initializationAllowed = true;
      // The verified prior intent remains until upgrade atomically publishes the next complete intent.
      await this.openDatabase(true);
    }
  }
  recoveryState(): "storage_failed" | "recovery_required" | "retry_required" {
    this.assert();
    if (!exists(this.gate)) return "storage_failed";
    try {
      const gate = readIntent(this.gate) as { operation?: unknown };
      if (!isIdentifier(gate.operation)) return "retry_required";
      this.verifyCheckpoint(path.join(this.recovery, gate.operation));
      return "recovery_required";
    } catch {
      return "retry_required";
    }
  }
  async restorePending(): Promise<void> {
    this.assert();
    const gate = readIntent(this.gate) as { operation?: unknown };
    if (!isIdentifier(gate.operation)) throw new Error("No verified pending checkpoint.");
    await this.restore(gate.operation);
  }
  /** Restore only an explicitly selected verified whole snapshot, with failed journals kept away from activation. */
  async restore(operation: string): Promise<void> {
    if (this.active || !isIdentifier(operation)) throw new Error("Invalid recovery action.");
    this.active = true;
    try {
      await this.close();
      this.assert();
      const directory = path.join(this.recovery, operation);
      const record = this.verifyCheckpoint(directory);
      if (record.operation !== operation) throw new Error("Checkpoint operation mismatch.");
      let plan: { operation: string; temporary: string; failed: string };
      if (exists(this.restoration)) {
        const input = readIntent(this.restoration);
        if (!input || typeof input !== "object") throw new Error("Invalid restoration intent.");
        const value = input as Record<string, unknown>;
        if (
          Object.keys(value).sort().join(",") !== "failed,operation,temporary" ||
          value.operation !== operation ||
          typeof value.temporary !== "string" ||
          !/^\.restore-[0-9a-f-]{36}\.db3$/.test(value.temporary) ||
          typeof value.failed !== "string" ||
          !value.failed.startsWith(operation + ".failed-") ||
          !/^[0-9a-f-]{36}\.failed-[0-9a-f-]{36}$/.test(value.failed)
        )
          throw new Error("Invalid restoration intent.");
        plan = { operation, temporary: value.temporary, failed: value.failed };
      } else {
        plan = {
          operation,
          temporary: `.restore-${randomUUID()}.db3`,
          failed: `${operation}.failed-${randomUUID()}`,
        };
        const temporary = path.join(this.options.root, plan.temporary);
        fs.copyFileSync(path.join(directory, "ohtia.db3"), temporary, fs.constants.COPYFILE_EXCL);
        const materialized = connect(this.options, temporary, true);
        try {
          if (compatibility(materialized, this.artifacts) !== record.sourceRevision)
            throw new Error("Invalid recovery materialization.");
        } finally {
          materialized.close();
        }
        const fd = fs.openSync(temporary, "r+");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        if (!exists(this.gate))
          writeSynced(this.gate, { version: 1, operation, source: record.sourceRevision, target });
        fs.mkdirSync(path.join(this.recovery, plan.failed), { mode: 0o700 });
        syncDirectory(this.recovery);
        // The durable plan predates every move. A restart uses these same two destinations.
        writeSynced(this.restoration, plan);
      }
      const temporary = path.join(this.options.root, plan.temporary);
      const failed = path.join(this.recovery, plan.failed);
      if (fs.realpathSync.native(failed) !== failed || !fs.lstatSync(failed).isDirectory())
        throw new Error("Unsafe failed-state destination.");
      if (exists(temporary)) {
        const identity = fileIdentity(temporary);
        if (identity.sha256 !== record.sha256 || identity.bytes !== record.bytes)
          throw new Error("Restoration materialization changed.");
        for (const suffix of ["", "-wal", "-shm", "-journal"]) {
          const file = this.file + suffix;
          const retained = path.join(failed, "ohtia.db3" + suffix);
          if (exists(file)) {
            regular(file);
            if (exists(retained)) throw new Error("Ambiguous failed database identity.");
            fs.renameSync(file, retained);
            syncDirectory(failed);
            syncDirectory(this.options.root);
          }
        }
        fs.renameSync(temporary, this.file);
        syncDirectory(this.options.root);
      }
      // An absent temporary may mean the activation rename completed before interruption.
      const restored = fileIdentity(this.file);
      if (
        restored.sha256 !== record.sha256 ||
        restored.bytes !== record.bytes ||
        ["-wal", "-shm", "-journal"].some((suffix) => exists(this.file + suffix))
      )
        throw new Error("Restoration activation is unconfirmed.");
      const check = connect(this.options, this.file, true);
      try {
        if (compatibility(check, this.artifacts) !== record.sourceRevision)
          throw new Error("Restored source is invalid.");
      } finally {
        check.close();
      }
      fs.unlinkSync(this.restoration);
      syncDirectory(this.options.root);
      // The old schema remains gated until explicit retry establishes the compatible path.
    } finally {
      this.active = false;
    }
  }
  async readAppearance(): Promise<Outcome<AppearanceRecord>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    try {
      this.assert();
      return this.appearance(
        await this.database
          .selectFrom("application_preferences")
          .selectAll()
          .where("key", "=", "appearance")
          .executeTakeFirst(),
      );
    } catch {
      this.admitted = false;
      return failure("storage_failed");
    }
  }
  private appearance(row: Preferences | undefined): Outcome<AppearanceRecord> {
    if (!row)
      return {
        ok: true,
        value: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
      };
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      return failure("preference_invalid");
    let value: unknown;
    try {
      if (typeof row.value === "string" && row.value.length <= 128) value = JSON.parse(row.value);
    } catch {
      /* controlled fallback without overwriting retained bytes */
    }
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        revision: row.revision,
        value: row.schema_version === 1 && isAppearance(value) ? value : "system",
        source: row.schema_version === 1 && isAppearance(value) ? "saved" : "invalid_fallback",
      },
    };
  }
  private receipt(row: Receipt | undefined): RecordedAppearanceCommand | undefined {
    if (!row) return;
    if (
      !isIdentifier(row.operation_id) ||
      !isAppearance(row.value) ||
      ![0, 1].includes(row.accepted) ||
      !Number.isSafeInteger(row.expected_revision) ||
      row.expected_revision < 0 ||
      !Number.isSafeInteger(row.result_revision) ||
      row.result_revision < (row.accepted ? 1 : 0) ||
      (row.accepted === 1
        ? row.result_revision !== row.expected_revision + 1
        : row.result_revision === row.expected_revision)
    )
      throw new Error("Invalid command receipt.");
    return {
      expectedRevision: row.expected_revision,
      value: row.value,
      outcome: row.accepted
        ? {
            ok: true,
            value: {
              schemaVersion: 1,
              revision: row.result_revision,
              value: row.value,
              source: "saved",
            },
          }
        : staleRevision(row.result_revision),
    };
  }
  async readReceipt(operation: string): Promise<Outcome<AppearanceReceipt>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    if (!isIdentifier(operation)) return failure("invalid_message");
    try {
      this.assert();
      const result = this.receipt(
        await this.database
          .selectFrom("appearance_receipts")
          .selectAll()
          .where("operation_id", "=", operation)
          .executeTakeFirst(),
      );
      return {
        ok: true,
        value: result ? { state: "recorded", outcome: result.outcome } : { state: "not_found" },
      };
    } catch {
      this.admitted = false;
      return failure("storage_failed");
    }
  }
  async replaceAppearance(command: AppearanceCommand): Promise<Outcome<SavedAppearanceRecord>> {
    if (!this.ready || !this.database) return failure(this.active ? "busy" : "service_unavailable");
    if (
      !isIdentifier(command.operationId) ||
      !isAppearance(command.value) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0
    )
      return failure("invalid_message");
    this.active = true;
    let commitAttempted = false;
    const attempted = () => commitAttempted;
    try {
      this.assert();
      return await this.database.connection().execute(async (transaction) => {
        await sql`BEGIN IMMEDIATE`.execute(transaction);
        try {
          const receipt = this.receipt(
            await transaction
              .selectFrom("appearance_receipts")
              .selectAll()
              .where("operation_id", "=", command.operationId)
              .executeTakeFirst(),
          );
          const appearance = this.appearance(
            await transaction
              .selectFrom("application_preferences")
              .selectAll()
              .where("key", "=", "appearance")
              .executeTakeFirst(),
          );
          let replaced: SavedAppearanceRecord | undefined;
          let recorded: RecordedAppearanceCommand | undefined;
          const result = applyAppearanceCommand(
            {
              readReceipt: () => receipt,
              readAppearance: () => appearance,
              replaceAppearance: (value) => {
                if (!appearance.ok || appearance.value.revision >= Number.MAX_SAFE_INTEGER)
                  throw new Error("Revision exhausted.");
                replaced = {
                  schemaVersion: 1,
                  revision: appearance.value.revision + 1,
                  value,
                  source: "saved",
                };
                return replaced;
              },
              recordReceipt: (_operation, value) => {
                recorded = value;
              },
            },
            command,
          );
          const saved = replaced;
          if (saved)
            await transaction
              .insertInto("application_preferences")
              .values({
                key: "appearance",
                schema_version: 1,
                revision: saved.revision,
                value: JSON.stringify(saved.value),
              })
              .onConflict((conflict) =>
                conflict.column("key").doUpdateSet({
                  schema_version: 1,
                  revision: saved.revision,
                  value: JSON.stringify(saved.value),
                }),
              )
              .execute();
          if (recorded)
            await transaction
              .insertInto("appearance_receipts")
              .values({
                operation_id: command.operationId,
                expected_revision: command.expectedRevision,
                value: command.value,
                accepted: recorded.outcome.ok ? 1 : 0,
                result_revision: recorded.outcome.ok
                  ? recorded.outcome.value.revision
                  : recorded.outcome.error.parameters.currentRevision,
              })
              .execute();
          this.assert();
          commitAttempted = true;
          await sql`COMMIT`.execute(transaction);
          return result;
        } catch (error) {
          if (this.native?.inTransaction) {
            try {
              await sql`ROLLBACK`.execute(transaction);
            } catch {
              this.admitted = false;
            }
          }
          throw error;
        }
      });
    } catch {
      try {
        this.assert();
      } catch {
        this.admitted = false;
      }
      return failure(attempted() ? "uncertain" : "storage_failed");
    } finally {
      this.active = false;
    }
  }
  async savedLocale(): Promise<{ readonly choice?: InterfaceLocale; readonly invalid: boolean }> {
    if (!this.ready || !this.database) throw new Error("Locale read requires storage admission.");
    this.assert();
    const row = await this.database
      .selectFrom("application_preferences")
      .selectAll()
      .where("key", "=", "interface_locale")
      .executeTakeFirst();
    if (!row) return { invalid: false };
    if (row.schema_version !== 1 || typeof row.value !== "string" || row.value.length > 128)
      return { invalid: true };
    try {
      const value: unknown = JSON.parse(row.value);
      return isInterfaceLocale(value) ? { choice: value, invalid: false } : { invalid: true };
    } catch {
      return { invalid: true };
    }
  }
}
