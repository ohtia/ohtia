// Non-shipping component checks execute the actual packaged module and binding in Electron's utility runtime.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  loadRuntimeProfile,
  verifyStableSentinels,
  containsPath,
} from "../packages/main/dist/index.js";

const [profileFile, app, output, mode = "cases"] = process.argv.slice(2);
const parent = process.parentPort;
if (!parent || !profileFile || !app || !output || !process.versions.electron)
  throw new Error("A native utility test context is required.");
const profile = loadRuntimeProfile(profileFile);
verifyStableSentinels(profile);
assert(containsPath(profile.scratch_root, output) && output !== profile.scratch_root);
assert.equal(fs.realpathSync.native(path.dirname(output)), path.dirname(output));
const schemaRevision = JSON.parse(
  fs.readFileSync(path.join(app, "migrations/manifest.json")),
).length;
const metadata = JSON.parse(fs.readFileSync(path.join(app, "storage.json")));
assert.equal(metadata.target, `${process.platform}-${process.arch}`);
for (const [key, value] of Object.entries(metadata.runtime))
  assert.equal(process.versions[key], value);
const binding = path.join(app, "native/binding.node");
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(sha256(binding), metadata.bindingSha256);
const require = createRequire(path.join(app, "package.json"));
const Database = require("better-sqlite3");
const { Migrator } = await import(
  pathToFileURL(path.join(app, "node_modules/kysely/dist/migration/index.js"))
);
const { DurableStore } = await import(pathToFileURL(path.join(app, "storage.js")));
const windowsRoot = process.env.SystemRoot;
if (process.platform === "win32") assert(windowsRoot && path.isAbsolute(windowsRoot));
const icacls = path.join(windowsRoot ?? "/", "System32", "icacls.exe");
const results = [];
function options(root, migrationDirectory = path.join(app, "migrations")) {
  return {
    root,
    migrationDirectory,
    binding,
    bindingSha256: metadata.bindingSha256,
    engine: metadata.engine,
    release: "0.0.0",
    allowCreate: true,
    assertAdmission: () => {
      loadRuntimeProfile(profileFile);
      verifyStableSentinels(profile);
      assert(containsPath(output, root));
    },
  };
}
function raw(root) {
  return new Database(path.join(root, "ohtia.db3"), { nativeBinding: binding });
}
function checkpoint(root) {
  return fs
    .readdirSync(path.join(root, "recovery/migrations"))
    .find((name) => /^[0-9a-f-]{36}$/.test(name));
}
function send(value) {
  parent.postMessage(JSON.stringify(value));
}
async function finish(value) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The native result was not acknowledged.")),
      5000,
    );
    parent.on("message", (event) => {
      if (event.data === "ack") {
        clearTimeout(timer);
        resolve();
      }
    });
    send(value);
  });
}
function pause() {
  send({ kind: "paused", mode });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  throw new Error("Interruption control was not terminated.");
}
async function test(id, action) {
  const root = path.join(output, id);
  fs.mkdirSync(root);
  try {
    const observed = await action(root);
    results.push({ id, result: "pass", observed });
  } catch (error) {
    results.push({ id, result: "fail", error: String(error) });
  }
  fs.writeFileSync(
    path.join(output, "component-cases.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
function equalSaved(value, appearance, revision) {
  assert.equal(value.ok, true);
  assert.equal(value.value.value, appearance);
  assert.equal(value.value.revision, revision);
}
async function run() {
  if (mode.startsWith("interrupt-")) {
    fs.mkdirSync(output);
    const root = path.join(output, "database");
    fs.mkdirSync(root);
    const store = new DurableStore(options(root));
    if (["interrupt-intent-before", "interrupt-intent-after"].includes(mode)) {
      const original = fs.linkSync;
      fs.linkSync = function (...args) {
        if (String(args[1]).endsWith("migration-pending.json")) {
          if (mode === "interrupt-intent-before") pause();
          const result = original.apply(this, args);
          pause();
          return result;
        }
        return original.apply(this, args);
      };
    } else if (mode === "interrupt-checkpoint") {
      await store.open();
      await store.replaceAppearance({
        operationId: "before-checkpoint",
        expectedRevision: 0,
        value: "dark",
      });
      await store.close();
      const db = raw(root);
      db.exec(
        "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; DROP TABLE locale_receipts; DELETE FROM kysely_migration WHERE name='0003_locale_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0003_locale_receipts'; DROP TABLE appearance_receipts; DELETE FROM kysely_migration WHERE name='0002_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0002_receipts'",
      );
      db.pragma("user_version=1");
      db.close();
      const backup = Database.prototype.backup;
      Database.prototype.backup = async function (...args) {
        await backup.apply(this, args);
        pause();
      };
    } else if (mode === "interrupt-before") {
      const original = Migrator.prototype.migrateTo;
      Migrator.prototype.migrateTo = async function (name) {
        const result = await original.call(this, name);
        assert.equal(result.error, undefined);
        pause();
      };
    } else {
      const original = Database.prototype.prepare;
      Database.prototype.prepare = function (text) {
        const statement = original.call(this, text);
        if (text === "COMMIT") {
          const run = statement.run;
          statement.run = function (...args) {
            const result = run.apply(this, args);
            pause();
            return result;
          };
        }
        return statement;
      };
    }
    await store.open();
    throw new Error("Expected actual process interruption.");
  }
  if (mode.startsWith("inspect-")) {
    const root = path.join(output, "database");
    const store = new DurableStore(options(root));
    const unpublished = mode === "inspect-intent-before";
    assert.equal(fs.existsSync(path.join(root, "migration-pending.json")), !unpublished);
    if (!unpublished) await assert.rejects(store.open());
    const db = raw(root);
    const revision = db.pragma("user_version", { simple: true });
    assert.equal(
      revision,
      ["inspect-before", "inspect-intent-before", "inspect-intent-after"].includes(mode)
        ? 0
        : mode === "inspect-checkpoint"
          ? 1
          : schemaRevision,
    );
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all();
    if (revision === 0) assert.deepEqual(tables, []);
    else {
      assert.equal(db.prepare("SELECT count(*) FROM kysely_migration").pluck().get(), revision);
      assert.equal(
        db.prepare("SELECT count(*) FROM ohtia_migration_artifacts").pluck().get(),
        revision,
      );
    }
    db.close();
    await store.retry();
    assert.equal(store.ready, true);
    await store.close();
    await finish({
      kind: "complete",
      mode,
      results: [{ id: mode, result: "pass", observed: { revision, tables } }],
    });
    return;
  }
  assert.equal(mode, "cases");
  fs.mkdirSync(output);
  const engine = new Database(":memory:", { nativeBinding: binding });
  const identity = {
    versions: process.versions,
    platform: process.platform,
    architecture: process.arch,
    bindingSha256: sha256(binding),
    sqliteVersion: engine.prepare("SELECT sqlite_version()").pluck().get(),
    sqliteSourceId: engine.prepare("SELECT sqlite_source_id()").pluck().get(),
    compileOptions: engine.pragma("compile_options"),
  };
  engine.close();
  fs.writeFileSync(path.join(output, "engine.json"), JSON.stringify(identity, null, 2) + "\n");
  await test("populated-revision-two-upgrade", async (root) => {
    const store = new DurableStore(options(root));
    try {
      await store.open();
      const saved = await store.replaceAppearance({
        operationId: "schema-two-appearance",
        expectedRevision: 0,
        value: "dark",
      });
      await store.close();
      const db = raw(root);
      db.exec(
        "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; DROP TABLE locale_receipts; DELETE FROM kysely_migration WHERE name='0003_locale_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0003_locale_receipts'",
      );
      db.pragma("user_version=2");
      db.close();
      await store.open();
      assert.deepEqual(await store.readAppearance(), saved);
      assert.deepEqual((await store.readReceipt("schema-two-appearance")).value.outcome, saved);
      const language = await store.replaceLocale({
        operationId: "schema-three-locale",
        expectedRevision: 0,
        value: "ko-KR",
      });
      assert.equal(language.ok, true);
      assert.equal(store.native.pragma("user_version", { simple: true }), schemaRevision);
      return {
        sourceRevision: 2,
        targetRevision: schemaRevision,
        appearanceReceiptPreserved: true,
        language,
      };
    } finally {
      await store.close();
    }
  });
  await test("roundtrip-replay-current", async (root) => {
    const store = new DurableStore(options(root));
    try {
      await store.open();
      assert.equal(store.native.pragma("foreign_keys", { simple: true }), 1);
      const command = { operationId: "native-save", expectedRevision: 0, value: "dark" };
      const result = await store.replaceAppearance(command);
      equalSaved(result, "dark", 1);
      await store.close();
      await store.open();
      assert.deepEqual(await store.readAppearance(), result);
      assert.deepEqual(await store.replaceAppearance(command), result);
      assert.equal(
        (await store.replaceAppearance({ ...command, value: "light" })).error.code,
        "operation_conflict",
      );
      assert.equal(
        (await store.replaceAppearance({ ...command, operationId: "stale" })).error.code,
        "stale_revision",
      );
      assert.deepEqual((await store.readReceipt("native-save")).value, {
        state: "recorded",
        outcome: result,
      });
      assert.equal(
        fs
          .readdirSync(path.join(root, "recovery/migrations"))
          .filter((name) => /^[0-9a-f-]{36}$/.test(name)).length,
        1,
      );
      return { persistedRevision: 1, foreignKeys: 1 };
    } finally {
      await store.close();
    }
  });
  await test("populated-upgrade-limits", async (root) => {
    const store = new DurableStore(options(root));
    try {
      await store.open();
      await store.replaceAppearance({
        operationId: "populated",
        expectedRevision: 0,
        value: "light",
      });
      await store.close();
      const db = raw(root);
      db.exec(
        "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; DROP TABLE locale_receipts; DELETE FROM kysely_migration WHERE name='0003_locale_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0003_locale_receipts'; DROP TABLE appearance_receipts; DELETE FROM kysely_migration WHERE name='0002_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0002_receipts'; UPDATE application_preferences SET value='{\"max_concurrent_inference\":4,\"max_concurrent_local_processing\":2}' WHERE key='execution_limits'",
      );
      db.pragma("user_version=1");
      db.close();
      await store.open();
      equalSaved(await store.readAppearance(), "light", 1);
      const current = raw(root);
      assert.equal(
        JSON.parse(
          current
            .prepare("SELECT value FROM application_preferences WHERE key='execution_limits'")
            .pluck()
            .get(),
        ).max_concurrent_inference,
        4,
      );
      current.close();
      return { sourceRevision: 1, targetRevision: schemaRevision, preservedLimit: 4 };
    } finally {
      await store.close();
    }
  });
  for (const invalid of [
    "missing",
    "invalid",
    "unsupported",
    "newer",
    "artifacts",
    "unknown-column",
    "history-column",
  ])
    await test(`reject-${invalid}`, async (root) => {
      const store = new DurableStore(options(root));
      try {
        await store.open();
        await store.close();
        const db = raw(root);
        if (invalid === "missing")
          db.exec("DELETE FROM application_preferences WHERE key='execution_limits'");
        if (invalid === "invalid")
          db.exec("UPDATE application_preferences SET value='{}' WHERE key='execution_limits'");
        if (invalid === "unsupported")
          db.exec(
            "UPDATE application_preferences SET schema_version=2 WHERE key='execution_limits'",
          );
        if (invalid === "newer") db.pragma(`user_version=${schemaRevision + 1}`);
        if (invalid === "artifacts")
          db.exec("UPDATE ohtia_migration_artifacts SET sha256='" + "a".repeat(64) + "'");
        if (invalid === "history-column")
          db.exec("ALTER TABLE kysely_migration DROP COLUMN timestamp");
        if (invalid === "unknown-column")
          db.exec("ALTER TABLE application_preferences ADD COLUMN extra TEXT");
        db.close();
        await assert.rejects(store.open());
        assert.equal(store.ready, false);
        assert.equal(fs.existsSync(path.join(root, "migration-pending.json")), false);
        return { rejectedBeforeCheckpoint: true };
      } finally {
        await store.close();
      }
    });
  await test("changed-module", async (root) => {
    const modules = path.join(root, "modules");
    fs.cpSync(path.join(app, "migrations"), modules, { recursive: true });
    fs.appendFileSync(path.join(modules, "0001_initial.mjs"), "\n// changed historical module\n");
    assert.throws(() => new DurableStore(options(root, modules)));
    assert.equal(fs.existsSync(path.join(root, "ohtia.db3")), false);
    return { rejectedBeforeOpen: true };
  });
  await test("binding-and-engine-mismatch", async (root) => {
    const wrong = new DurableStore({ ...options(root), bindingSha256: "a".repeat(64) });
    await assert.rejects(wrong.open());
    await wrong.close();
    const engine = new DurableStore({
      ...options(root),
      engine: { ...metadata.engine, sourceId: "unexpected-source" },
    });
    await assert.rejects(engine.open());
    await engine.close();
    return { noFallback: true };
  });
  for (const failure of ["returned-error", "foreign-key", "lost-commit-ack"])
    await test(failure, async (root) => {
      const store = new DurableStore(options(root));
      const original = Migrator.prototype.migrateTo;
      const prepare = Database.prototype.prepare;
      if (failure === "lost-commit-ack") {
        let injected = false;
        Database.prototype.prepare = function (text) {
          const statement = prepare.call(this, text);
          if (text === "COMMIT" && !injected) {
            const run = statement.run;
            statement.run = function (...args) {
              const result = run.apply(this, args);
              injected = true;
              throw new Error("Lost native commit acknowledgement.");
            };
          }
          return statement;
        };
      } else
        Migrator.prototype.migrateTo = async function (name) {
          const result = await original.call(this, name);
          assert.equal(result.error, undefined);
          if (failure === "returned-error")
            return { ...result, error: new Error("Returned migration failure.") };
          store.native.exec(
            "PRAGMA defer_foreign_keys=ON; CREATE TABLE probe_parent(id INTEGER PRIMARY KEY); CREATE TABLE probe_child(parent INTEGER REFERENCES probe_parent(id)); INSERT INTO probe_child VALUES(99)",
          );
          return result;
        };
      try {
        await assert.rejects(store.open());
        assert.equal(store.ready, false);
        const db = raw(root);
        const revision = db.pragma("user_version", { simple: true });
        assert.equal(revision, failure === "lost-commit-ack" ? schemaRevision : 0);
        db.close();
        Migrator.prototype.migrateTo = original;
        Database.prototype.prepare = prepare;
        await store.retry();
        assert.equal(store.ready, true);
        return { revisionAfterFailure: revision, retryVerified: true };
      } finally {
        Migrator.prototype.migrateTo = original;
        Database.prototype.prepare = prepare;
        await store.close();
      }
    });
  await test("retry-intent-preserved", async (root) => {
    const store = new DurableStore(options(root));
    let retry;
    const migrate = Migrator.prototype.migrateTo;
    const rename = fs.renameSync;
    try {
      Migrator.prototype.migrateTo = async function (name) {
        return {
          ...(await migrate.call(this, name)),
          error: new Error("Synthetic source retained"),
        };
      };
      await assert.rejects(store.open());
      Migrator.prototype.migrateTo = migrate;
      const gate = path.join(root, "migration-pending.json");
      const bytes = fs.readFileSync(gate);
      fs.renameSync = function (source, target) {
        if (target === gate) throw new Error("Synthetic intent replacement denied");
        return rename(source, target);
      };
      retry = new DurableStore({ ...options(root), allowCreate: false });
      await assert.rejects(retry.retry(), /intent replacement denied/);
      fs.renameSync = rename;
      assert.deepEqual(fs.readFileSync(gate), bytes);
      assert(fs.readdirSync(root).some((name) => name.startsWith(".intent-")));
      assert.equal(retry.ready, false);
      await retry.retry();
      assert.equal(retry.ready, true);
      assert.deepEqual(
        fs.readdirSync(root).filter((name) => name.startsWith(".intent-")),
        [],
      );
      return { originalIntentSurvivedFailure: true, explicitRetryVerified: true };
    } finally {
      Migrator.prototype.migrateTo = migrate;
      fs.renameSync = rename;
      await retry?.close();
      await store.close();
    }
  });
  await test("sqlite-full-atomic-command", async (root) => {
    const store = new DurableStore(options(root));
    try {
      await store.open();
      const db = store.native;
      const pages = db.pragma("page_count", { simple: true });
      db.pragma(`max_page_count=${pages}`);
      const original = db.prepare;
      let full = false;
      db.prepare = function (...args) {
        const statement = original.apply(this, args);
        const run = statement.run;
        statement.run = function (...parameters) {
          try {
            return run.apply(this, parameters);
          } catch (error) {
            if (error.code === "SQLITE_FULL") full = true;
            throw error;
          }
        };
        return statement;
      };
      let revision = 0;
      let rejected;
      for (let i = 0; i < 256; i++) {
        const result = await store.replaceAppearance({
          operationId: `full-${i}-${"x".repeat(110)}`,
          expectedRevision: revision,
          value: "dark",
        });
        if (!result.ok) {
          rejected = result;
          break;
        }
        revision = result.value.revision;
      }
      assert.equal(full, true);
      assert(rejected);
      equalSaved(await store.readAppearance(), "dark", revision);
      return {
        sqliteFullObserved: full,
        lastConfirmedRevision: revision,
        controlledCode: rejected.error.code,
      };
    } finally {
      await store.close();
    }
  });
  await test("denied-io", async (root) => {
    const store = new DurableStore(options(root));
    try {
      if (process.platform === "win32")
        execFileSync(icacls, [root, "/deny", `${os.userInfo().username}:(OI)(CI)(W)`], {
          stdio: "ignore",
        });
      else fs.chmodSync(root, 0o500);
      await assert.rejects(store.open());
      assert.equal(store.ready, false);
      return { deniedBeforeAdmission: true };
    } finally {
      if (process.platform === "win32")
        execFileSync(icacls, [root, "/remove:d", os.userInfo().username], {
          stdio: "ignore",
        });
      else fs.chmodSync(root, 0o700);
      await store.close();
    }
  });
  await test("competing-initializers-and-sqlite-lock", async (root) => {
    const first = new DurableStore(options(root));
    const second = new DurableStore(options(root));
    try {
      const results = await Promise.allSettled([first.open(), second.open()]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const a = raw(root);
      const b = raw(root);
      try {
        a.exec("BEGIN EXCLUSIVE");
        assert.throws(() => b.exec("BEGIN IMMEDIATE"), /locked/);
        a.exec("ROLLBACK");
      } finally {
        a.close();
        b.close();
      }
      return { sameProcessInitializersAdmitted: 1, independentSqliteConnectionLocked: true };
    } finally {
      await first.close();
      await second.close();
    }
  });
  await test("corrupt-and-interrupted-restore", async (root) => {
    const store = new DurableStore(options(root));
    const rename = fs.renameSync;
    try {
      await store.open();
      await store.replaceAppearance({
        operationId: "restore-test",
        expectedRevision: 0,
        value: "dark",
      });
      await store.close();
      const operation = checkpoint(root);
      const snapshot = path.join(root, "recovery/migrations", operation, "ohtia.db3");
      const bytes = fs.readFileSync(snapshot);
      fs.appendFileSync(snapshot, "corrupt");
      await assert.rejects(store.restore(operation));
      fs.writeFileSync(snapshot, bytes);
      fs.writeFileSync(path.join(root, "ohtia.db3-journal"), "synthetic retained journal marker");
      fs.renameSync = function (source, target) {
        if (String(source).endsWith("-journal")) throw new Error("Interrupted journal move.");
        return rename(source, target);
      };
      await assert.rejects(store.restore(operation));
      fs.renameSync = rename;
      await assert.rejects(store.retry());
      await store.restorePending();
      assert.equal(fs.existsSync(path.join(root, "ohtia.db3-journal")), false);
      const failed = fs
        .readdirSync(path.join(root, "recovery/migrations"))
        .find((name) => name.includes(".failed-"));
      assert(failed);
      assert.deepEqual(fs.readdirSync(path.join(root, "recovery/migrations", failed)).sort(), [
        "ohtia.db3",
        "ohtia.db3-journal",
      ]);
      await store.retry();
      assert.equal(store.ready, true);
      assert.equal(fs.existsSync(path.join(root, "recovery/migrations", failed)), false);
      return {
        corruptSnapshotRejected: true,
        interruptedMovesResumed: true,
        failedSetTogether: true,
        resolvedCopiesRemoved: true,
      };
    } finally {
      fs.renameSync = rename;
      await store.close();
    }
  });
  await test("checkpoint-denied", async (root) => {
    const store = new DurableStore(options(root));
    const recovery = path.join(root, "recovery/migrations");
    try {
      await store.open();
      await store.replaceAppearance({
        operationId: "checkpoint-source",
        expectedRevision: 0,
        value: "dark",
      });
      await store.close();
      const oldCheckpoint = path.join(recovery, checkpoint(root), "ohtia.db3");
      const oldDigest = sha256(oldCheckpoint);
      const db = raw(root);
      db.exec(
        "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; DROP TABLE locale_receipts; DELETE FROM kysely_migration WHERE name='0003_locale_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0003_locale_receipts'; DROP TABLE appearance_receipts; DELETE FROM kysely_migration WHERE name='0002_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0002_receipts'",
      );
      db.pragma("user_version=1");
      db.close();
      if (process.platform === "win32")
        execFileSync(icacls, [recovery, "/deny", `${os.userInfo().username}:(OI)(CI)(W)`], {
          stdio: "ignore",
        });
      else fs.chmodSync(recovery, 0o500);
      try {
        await assert.rejects(store.open());
        assert.equal(store.ready, false);
      } finally {
        if (process.platform === "win32")
          execFileSync(icacls, [recovery, "/remove:d", os.userInfo().username], {
            stdio: "ignore",
          });
        else fs.chmodSync(recovery, 0o700);
      }
      const source = raw(root);
      assert.equal(source.pragma("user_version", { simple: true }), 1);
      assert.equal(source.prepare("SELECT count(*) FROM kysely_migration").pluck().get(), 1);
      source.close();
      assert.equal(sha256(oldCheckpoint), oldDigest);
      await store.retry();
      equalSaved(await store.readAppearance(), "dark", 1);
      return {
        checkpointDeniedBeforeSql: true,
        sourceRevisionPreserved: 1,
        oldCheckpointUnchanged: true,
      };
    } finally {
      await store.close();
    }
  });
  await test("uuid-reference-constraints", async (root) => {
    // An isolated engine fixture verifies ADR-0008 representation without adding a research entity to the product schema.
    const file = path.join(root, "identifiers.db3");
    const snapshot = path.join(root, "identifiers-checkpoint.db3");
    const db = new Database(file, { nativeBinding: binding });
    const check =
      "typeof(id)='blob' AND length(id)=16 AND substr(hex(id),13,1)='7' AND substr(hex(id),17,1) IN ('8','9','A','B')";
    const valid = Buffer.from("01890f1e6b007cc898c4dc0c0c07398f", "hex");
    try {
      db.pragma("foreign_keys=ON");
      assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
      db.exec(
        `CREATE TABLE identities(id BLOB PRIMARY KEY NOT NULL CHECK(${check})); CREATE TABLE identity_refs(id BLOB NOT NULL CHECK(${check}) REFERENCES identities(id))`,
      );
      db.prepare("INSERT INTO identities VALUES (?)").run(valid);
      db.prepare("INSERT INTO identity_refs VALUES (?)").run(valid);
      for (const value of [
        null,
        valid.toString("hex"),
        Buffer.alloc(15),
        Buffer.from("01890f1e6b004cc898c4dc0c0c07398f", "hex"),
        Buffer.from("01890f1e6b007cc818c4dc0c0c07398f", "hex"),
      ])
        assert.throws(() => db.prepare("INSERT INTO identities VALUES (?)").run(value));
      assert.throws(() => db.prepare("INSERT INTO identities VALUES (?)").run(valid));
      const absent = Buffer.from(valid);
      absent[15] ^= 1;
      assert.throws(() => db.prepare("INSERT INTO identity_refs VALUES (?)").run(absent));
      await db.backup(snapshot);
    } finally {
      db.close();
    }
    const restored = path.join(root, "restored-identifiers.db3");
    fs.copyFileSync(snapshot, restored, fs.constants.COPYFILE_EXCL);
    const verify = new Database(restored, { nativeBinding: binding });
    try {
      assert.deepEqual(verify.prepare("SELECT id FROM identities").pluck().get(), valid);
      assert.deepEqual(verify.pragma("foreign_key_check"), []);
      assert.equal(verify.prepare("SELECT count(*) FROM identity_refs").pluck().get(), 1);
    } finally {
      verify.close();
    }
    return {
      fixtureScope: "binding representation; no product entity introduced",
      canonicalHex: valid.toString("hex"),
      invalidPhysicalFormsRejected: true,
      referenceAndSnapshotBytesPreserved: true,
    };
  });
  verifyStableSentinels(profile);
  await finish({ kind: "complete", mode, results, identity });
}
void run()
  .then(() => process.exit(results.some((row) => row.result !== "pass") ? 1 : 0))
  .catch(async (error) => {
    await finish({ kind: "failed", mode, error: String(error), results }).catch(() => {});
    process.exit(1);
  });
