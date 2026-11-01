import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Migrator } from "../packages/utility/node_modules/kysely/dist/migration/index.js";
import { Kysely } from "../packages/utility/node_modules/kysely/dist/index.js";
import { failure } from "../packages/contracts/src/index.js";
import { defaultWorkspaceLayout } from "../packages/renderer/src/workspace-geometry.js";
import { request } from "./fixtures/port-corpus.js";
import {
  createStatusService,
  DurableStore,
  initializeStorage,
  type StorageOptions,
} from "../packages/utility/dist/index.js";

// These file-backed tests use the pinned addon under developer Node, not native Electron qualification.
const require = createRequire(new URL("../packages/utility/package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof import("better-sqlite3");
const roots: string[] = [];
const stores: DurableStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ohtia storage ñ ")));
  roots.push(root);
  const sourceBinding = fs.realpathSync.native(
    path.join(
      path.dirname(require.resolve("better-sqlite3/package.json")),
      `prebuilds/${process.platform}-${process.arch}.node`,
    ),
  );
  // Windows maps the addon until worker exit. Keep one verified, single-link copy
  // in the checkout cache instead of pinning every disposable database directory.
  const sourceHash = createHash("sha256").update(fs.readFileSync(sourceBinding)).digest("hex");
  const cache = path.resolve(".cache", "storage-test-bindings");
  fs.mkdirSync(cache, { recursive: true });
  if (fs.realpathSync.native(cache) !== cache) throw new Error("Aliased native fixture cache.");
  const binding = path.join(cache, `${sourceHash}.node`);
  if (!fs.existsSync(binding)) {
    const temporary = fs.mkdtempSync(path.join(cache, "pending-"));
    try {
      const copied = path.join(temporary, "binding.node");
      fs.copyFileSync(sourceBinding, copied, fs.constants.COPYFILE_EXCL);
      if (createHash("sha256").update(fs.readFileSync(copied)).digest("hex") !== sourceHash)
        throw new Error("Native fixture copy changed before publication.");
      try {
        fs.renameSync(copied, binding);
      } catch (error) {
        // Another worker may already have published and loaded the same bytes.
        if (!fs.existsSync(binding)) throw error;
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const stat = fs.lstatSync(binding);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    fs.realpathSync.native(binding) !== binding ||
    createHash("sha256").update(fs.readFileSync(binding)).digest("hex") !== sourceHash
  )
    throw new Error(
      "Unsafe native fixture binding; stop Vitest workers, remove only .cache/storage-test-bindings/" +
        sourceHash +
        ".node and retry.",
    );
  const db = new Database(":memory:", { nativeBinding: binding });
  const engine = {
    version: db.prepare("SELECT sqlite_version()").pluck().get() as string,
    sourceId: db.prepare("SELECT sqlite_source_id()").pluck().get() as string,
    requiredOptions: (db.pragma("compile_options") as { compile_options: string }[])
      .map((r) => r.compile_options)
      .sort(),
  };
  db.close();
  const migrationDirectory = path.join(root, "modules");
  fs.cpSync("packages/utility/src/migrations", migrationDirectory, { recursive: true });
  const options: StorageOptions = {
    root,
    binding,
    bindingSha256: createHash("sha256").update(fs.readFileSync(binding)).digest("hex"),
    engine,
    migrationDirectory,
    release: "synthetic-0",
    allowCreate: true,
    assertAdmission: () => {},
  };
  const store = new DurableStore(options);
  stores.push(store);
  const raw = () => new Database(path.join(root, "ohtia.db3"), { nativeBinding: binding });
  return { root, options, store, raw };
}
function checkpoints(root: string) {
  return fs.readdirSync(path.join(root, "recovery/migrations")).filter((s) => !s.includes("."));
}
describe("durable preference and migration recovery", () => {
  it("closes native connections before Kysely initializes and when its destroy rejects", async () => {
    const { store, raw } = fixture();
    await store.open();
    await store.close();
    const close = vi.spyOn(Database.prototype, "close");
    const expectClosed = () => {
      expect(close).toHaveBeenCalledOnce();
      expect((close.mock.contexts[0] as InstanceType<typeof Database>).open).toBe(false);
      close.mockClear();
    };
    await store.open();
    await store.close();
    expectClosed();
    const newer = raw();
    newer.pragma("user_version=5");
    newer.close();
    close.mockClear();
    await expect(store.open()).rejects.toThrow(/Unsupported/);
    expectClosed();
    const current = raw();
    current.pragma("user_version=4");
    current.close();
    close.mockClear();
    await store.open();
    vi.spyOn(Kysely.prototype, "destroy").mockRejectedValueOnce(
      new Error("Synthetic driver teardown failure"),
    );
    await expect(store.close()).rejects.toThrow(/Synthetic driver teardown failure/);
    expectClosed();
  });

  it("requires explicit retry for a retained empty source even without a locator", async () => {
    const { root, options } = fixture();
    fs.writeFileSync(path.join(root, "ohtia.db3"), "");
    fs.mkdirSync(path.join(root, "recovery/migrations"), { recursive: true });
    const opened = new DurableStore(options);
    stores.push(opened);
    await expect(opened.open()).rejects.toThrow(/cannot silently initialize/);
    expect(fs.existsSync(path.join(root, "migration-pending.json"))).toBe(false);
  });
  it("preserves the old retry intent until atomic replacement and retries revision zero with creation disabled", async () => {
    const { store, root, options } = fixture();
    const original = Migrator.prototype.migrateTo;
    const migration = vi
      .spyOn(Migrator.prototype, "migrateTo")
      .mockImplementation(async function (name) {
        return {
          ...(await original.call(this, name)),
          error: new Error("Synthetic returned failure"),
        };
      });
    await expect(store.open()).rejects.toThrow(/recovery/);
    migration.mockRestore();
    const gate = path.join(root, "migration-pending.json");
    const bytes = fs.readFileSync(gate);
    const rename = fs.renameSync;
    const publication = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (target === gate) throw new Error("Synthetic replacement denied");
      rename(source, target);
    });
    const retry = new DurableStore({ ...options, allowCreate: false });
    stores.push(retry);
    await expect(retry.retry()).rejects.toThrow(/replacement denied/);
    publication.mockRestore();
    expect(fs.readFileSync(gate)).toEqual(bytes);
    expect(fs.readdirSync(root).some((name) => name.startsWith(".intent-"))).toBe(true);
    expect(retry.ready).toBe(false);
    await retry.retry();
    expect(retry.ready).toBe(true);
    expect(fs.readdirSync(root).filter((name) => name.startsWith(".intent-"))).toEqual([]);
  });
  it("does not initialize an empty database behind an initialized locator", async () => {
    const { root, options } = fixture();
    fs.writeFileSync(path.join(root, "ohtia.db3"), "");
    const opened = new DurableStore({ ...options, allowCreate: false });
    stores.push(opened);
    await expect(opened.open()).rejects.toThrow(/cannot silently initialize/);
    expect(fs.statSync(path.join(root, "ohtia.db3")).size).toBe(0);
    expect(fs.existsSync(path.join(root, "migration-pending.json"))).toBe(false);
  });
  it("does not replace a missing initialized database or a retained recovery store", async () => {
    const { store, root, options } = fixture();
    await store.open();
    await store.close();
    const file = path.join(root, "ohtia.db3");
    fs.renameSync(file, file + ".retained");
    const opened = new DurableStore({ ...options, allowCreate: false });
    stores.push(opened);
    await expect(opened.open()).rejects.toThrow(/cannot be replaced/);
    expect(fs.existsSync(file)).toBe(false);
    const fresh = new DurableStore(options);
    stores.push(fresh);
    await expect(fresh.open()).rejects.toThrow(/cannot be replaced/);
    expect(fs.existsSync(file)).toBe(false);
  });
  it("rejects history reordered by timestamps before current admission", async () => {
    const { store, raw, root } = fixture();
    await store.open();
    await store.close();
    const db = raw();
    db.exec("UPDATE kysely_migration SET timestamp='0000' WHERE name='0002_receipts'");
    db.close();
    await expect(store.open()).rejects.toThrow(/history/);
    expect(checkpoints(root)).toHaveLength(1);
  });
  it("leaves no published partial intent when its write fails, and permits explicit retry", async () => {
    const { store, root } = fixture();
    const original = fs.writeFileSync;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementationOnce((file, data, options) => {
      original(file, "{", options);
      throw Object.assign(new Error("Synthetic ENOSPC"), { code: "ENOSPC" });
    });
    await expect(store.open()).rejects.toThrow(/ENOSPC/);
    spy.mockRestore();
    expect(fs.existsSync(path.join(root, "migration-pending.json"))).toBe(false);
    expect(store.recoveryState()).toBe("storage_failed");
    await store.retry();
    expect(store.ready).toBe(true);
    expect(fs.readdirSync(root).filter((name) => name.startsWith(".intent-"))).toEqual([]);
  });
  it("normalizes a complete intent published before an interrupted link cleanup", async () => {
    const { store, root } = fixture();
    const original = fs.unlinkSync;
    const spy = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (String(file).includes(".intent-")) throw new Error("Synthetic intent interruption");
      original(file);
    });
    await expect(store.open()).rejects.toThrow(/intent interruption/);
    spy.mockRestore();
    expect(fs.statSync(path.join(root, "migration-pending.json")).nlink).toBe(2);
    expect(store.recoveryState()).toBe("retry_required");
    expect(fs.statSync(path.join(root, "migration-pending.json")).nlink).toBe(1);
    await store.retry();
    expect(store.ready).toBe(true);
  });
  it("retains failed database and journals when migration fails again after restoring", async () => {
    const { store, root } = fixture();
    await store.open();
    await store.close();
    await store.restore(checkpoints(root)[0]!);
    const recovery = path.join(root, "recovery/migrations");
    const retained = fs.readdirSync(recovery).find((name) => name.includes(".failed-"))!;
    const failed = path.join(recovery, retained, "ohtia.db3");
    const bytes = fs.readFileSync(failed);
    const original = Migrator.prototype.migrateTo;
    const spy = vi.spyOn(Migrator.prototype, "migrateTo").mockImplementation(async function (name) {
      return { ...(await original.call(this, name)), error: new Error("Synthetic repeat failure") };
    });
    await expect(store.retry()).rejects.toThrow(/recovery/);
    spy.mockRestore();
    expect(fs.readFileSync(failed)).toEqual(bytes);
    expect(store.ready).toBe(false);
    await store.retry();
    expect(store.ready).toBe(true);
    expect(fs.existsSync(failed)).toBe(false);
  });
  it("does not repeat a committed revision on an appearance subscription when its command is replayed", async () => {
    const { store } = fixture();
    await store.open();
    const messages: Record<string, any>[] = [];
    const peer = createStatusService(
      "service-1",
      "en-US",
      (text) => messages.push(JSON.parse(text)),
      store,
    );
    peer.activate("en-US");
    peer.receive(
      JSON.stringify(
        request({
          operation: "appearance.subscribe",
          payload: { subscriptionId: "revision-stream" },
        }),
      ),
    );
    await peer.drain();
    const command = request({
      requestId: "save-first",
      operationId: "same-effect",
      operation: "appearance.replace",
      payload: { expectedRevision: 0, value: "dark" },
    });
    peer.receive(JSON.stringify(command));
    await peer.drain();
    peer.receive(JSON.stringify({ ...command, requestId: "save-replay" }));
    await peer.drain();
    expect(
      messages.filter((value) => value.kind === "event").map((value) => value.payload.revision),
    ).toEqual([0, 1]);
    expect(
      messages.filter(
        (value) => value.kind === "result" && value.operation === "appearance.replace",
      ),
    ).toHaveLength(2);
    peer.dispose();
  });

  it("rejects altered sequencer metadata before creating a checkpoint or admitting the current schema", async () => {
    const { store, raw, root } = fixture();
    await store.open();
    await store.close();
    const db = raw();
    db.exec("ALTER TABLE kysely_migration DROP COLUMN timestamp");
    db.close();
    await expect(store.open()).rejects.toThrow(/column/);
    expect(checkpoints(root)).toHaveLength(1);
    expect(store.ready).toBe(false);
  });

  it("refuses a replaced native root instead of continuing to write through the old open handle", async () => {
    const { store, root } = fixture();
    await store.open();
    const moved = root + "-retained";
    roots.push(moved);
    const identity = fs.statSync(root, { bigint: true });
    const prior = await store.readAppearance();
    try {
      fs.renameSync(root, moved);
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")
      )
        throw error;
      // Windows can prevent moving a directory containing the open SQLite file.
      expect(fs.existsSync(moved)).toBe(false);
      expect(fs.statSync(root, { bigint: true }).ino).toBe(identity.ino);
      expect(await store.readAppearance()).toEqual(prior);
      // Exercise the application identity guard without claiming an OS replacement.
      const changedRoot = vi.spyOn(fs, "statSync").mockReturnValueOnce(
        Object.assign(Object.create(Object.getPrototypeOf(identity)), identity, {
          ino: identity.ino + 1n,
        }) as fs.BigIntStats,
      );
      expect(await store.readAppearance()).toMatchObject({ error: { code: "storage_failed" } });
      expect(changedRoot).toHaveBeenCalledExactlyOnceWith(root, { bigint: true });
      expect(store.admissionReady).toBe(false);
      return;
    }
    fs.mkdirSync(root);
    expect(await store.readAppearance()).toMatchObject({ error: { code: "storage_failed" } });
    expect(store.admissionReady).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("keeps the engine verified while a serialized command is busy and cancels a disposed pending subscription", async () => {
    const { store } = fixture();
    await store.open();
    const messages: Record<string, any>[] = [];
    const peer = createStatusService(
      "service-1",
      "en-US",
      (text) => messages.push(JSON.parse(text)),
      store,
    );
    peer.activate("en-US");
    const saving = store.replaceAppearance({
      operationId: "busy-command",
      expectedRevision: 0,
      value: "dark",
    });
    expect(store.ready).toBe(false);
    expect(store.admissionReady).toBe(true);
    peer.receive(JSON.stringify(request()));
    expect(messages.at(-1)).toMatchObject({ payload: { value: { engine: "verified" } } });
    await saving;
    let release: (() => void) | undefined;
    const original = store.readAppearance.bind(store);
    vi.spyOn(store, "readAppearance").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            void original().then(resolve);
          };
        }),
    );
    peer.receive(
      JSON.stringify(
        request({
          operation: "appearance.subscribe",
          payload: { subscriptionId: "cancelled-subscription" },
        }),
      ),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    peer.receive(
      JSON.stringify({
        protocol: 1,
        policy: request().policy,
        kind: "unsubscribe",
        windowGeneration: "window-1",
        serviceGeneration: "service-1",
        subscriptionId: "cancelled-subscription",
      }),
    );
    release?.();
    await peer.drain();
    expect(
      messages.some(
        (value) => value.kind === "result" && value.payload?.error?.code === "cancelled",
      ),
    ).toBe(true);
    expect(messages.filter((value) => value.kind === "event")).toHaveLength(0);
    peer.dispose();
  });
  it("reads saved locale only after admission and preserves a rejected encoding", async () => {
    const { store, raw } = fixture();
    await expect(store.savedLocale()).rejects.toThrow(/admission/);
    await store.open();
    expect(await store.savedLocale()).toEqual({ invalid: false });
    const db = raw();
    db.prepare("INSERT INTO application_preferences VALUES ('interface_locale',1,1,?)").run(
      '"ko-KR"',
    );
    expect(await store.savedLocale()).toEqual({ choice: "ko-KR", invalid: false });
    db.exec("UPDATE application_preferences SET schema_version=2 WHERE key='interface_locale'");
    expect(await store.savedLocale()).toEqual({ invalid: true });
    expect(
      db
        .prepare("SELECT value FROM application_preferences WHERE key='interface_locale'")
        .pluck()
        .get(),
    ).toBe('"ko-KR"');
    db.close();
  });
  it("enforces physical integer and text classes independently of port validation", async () => {
    const { store, raw } = fixture();
    await store.open();
    await store.close();
    const db = raw();
    expect(() =>
      db.exec("UPDATE application_preferences SET revision=1.5 WHERE key='execution_limits'"),
    ).toThrow();
    expect(() =>
      db.exec("UPDATE application_preferences SET value=x'7B7D' WHERE key='execution_limits'"),
    ).toThrow();
    db.close();
  });

  it("upgrades a populated compatible source without resetting nondefault execution policy", async () => {
    const { store, raw, root } = fixture();
    await store.open();
    await store.replaceAppearance({
      operationId: "before-upgrade",
      expectedRevision: 0,
      value: "dark",
    });
    await store.close();
    const db = raw();
    db.exec(
      "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; DROP TABLE locale_receipts; DELETE FROM kysely_migration WHERE name='0003_locale_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0003_locale_receipts'; DROP TABLE appearance_receipts; DELETE FROM kysely_migration WHERE name='0002_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0002_receipts'; UPDATE application_preferences SET value='{\"max_concurrent_inference\":4,\"max_concurrent_local_processing\":2}' WHERE key='execution_limits'",
    );
    db.pragma("user_version=1");
    db.close();
    await store.open();
    expect(await store.readAppearance()).toMatchObject({
      ok: true,
      value: { value: "dark", revision: 1 },
    });
    const current = raw();
    expect(
      JSON.parse(
        current
          .prepare("SELECT value FROM application_preferences WHERE key='execution_limits'")
          .pluck()
          .get() as string,
      ).max_concurrent_inference,
    ).toBe(4);
    current.close();
    expect(checkpoints(root)).toHaveLength(2);
  });
  it("rolls back real schema, history and artifacts when the migrator returns an error after executing", async () => {
    const { store, raw } = fixture();
    const original = Migrator.prototype.migrateTo;
    const spy = vi.spyOn(Migrator.prototype, "migrateTo").mockImplementation(async function (name) {
      const result = await original.call(this, name);
      return { ...result, error: new Error("Synthetic migrator returned error.") };
    });
    await expect(store.open()).rejects.toThrow(/recovery/);
    const db = raw();
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    expect(db.prepare("SELECT count(*) FROM sqlite_schema").pluck().get()).toBe(0);
    db.close();
    spy.mockRestore();
    await store.retry();
    expect(store.ready).toBe(true);
  });
  it.skipIf(process.platform === "win32")(
    "does not follow a recovery alias or a broken database alias into another root",
    async () => {
      const { store, root } = fixture();
      const other = path.join(root, "outside");
      fs.mkdirSync(other);
      fs.symlinkSync(other, path.join(root, "recovery"), "dir");
      await expect(store.open()).rejects.toThrow();
      expect(fs.readdirSync(other)).toEqual([]);
    },
  );

  it("initializes execution limits atomically, persists commands and receipts, and creates no checkpoint for current reopening", async () => {
    const { store, root, raw } = fixture();
    await store.open();
    expect(store.ready).toBe(true);
    const db = raw();
    expect(
      JSON.parse(
        db
          .prepare("SELECT value FROM application_preferences WHERE key='execution_limits'")
          .pluck()
          .get() as string,
      ),
    ).toEqual({ max_concurrent_inference: 1, max_concurrent_local_processing: 1 });
    db.prepare("UPDATE application_preferences SET value=? WHERE key='execution_limits'").run(
      '{"max_concurrent_inference":3,"max_concurrent_local_processing":2}',
    );
    db.close();
    const command = { operationId: "save-1", expectedRevision: 0, value: "dark" as const };
    const saved = await store.replaceAppearance(command);
    expect(saved).toMatchObject({
      ok: true,
      value: { revision: 1, value: "dark", source: "saved" },
    });
    await store.close();
    await store.open();
    expect(await store.readAppearance()).toEqual(saved);
    expect(await store.replaceAppearance(command)).toEqual(saved);
    expect(await store.replaceAppearance({ ...command, value: "light" })).toMatchObject({
      error: { code: "operation_conflict" },
    });
    expect(await store.replaceAppearance({ ...command, operationId: "stale-1" })).toMatchObject({
      error: { code: "stale_revision", parameters: { currentRevision: 1 } },
    });
    expect(await store.readReceipt("save-1")).toEqual({
      ok: true,
      value: { state: "recorded", outcome: saved },
    });
    expect(checkpoints(root)).toHaveLength(1);
    const again = raw();
    expect(
      JSON.parse(
        again
          .prepare("SELECT value FROM application_preferences WHERE key='execution_limits'")
          .pluck()
          .get() as string,
      ).max_concurrent_inference,
    ).toBe(3);
    again.close();
  });
  it.each(["missing", "invalid", "unsupported"])(
    "blocks initialized %s limits without silently repairing policy",
    async (mode) => {
      const { store, raw } = fixture();
      await store.open();
      await store.close();
      const db = raw();
      if (mode === "missing")
        db.exec("DELETE FROM application_preferences WHERE key='execution_limits'");
      else if (mode === "invalid")
        db.exec("UPDATE application_preferences SET value='{}' WHERE key='execution_limits'");
      else
        db.exec("UPDATE application_preferences SET schema_version=2 WHERE key='execution_limits'");
      db.close();
      await expect(store.open()).rejects.toThrow();
      expect(store.ready).toBe(false);
    },
  );
  it("rejects newer schema and altered history before making a checkpoint", async () => {
    const { store, raw, root } = fixture();
    await store.open();
    await store.close();
    const db = raw();
    db.pragma("user_version=5");
    db.close();
    await expect(store.open()).rejects.toThrow(/Unsupported/);
    expect(checkpoints(root)).toHaveLength(1);
    const again = raw();
    again.pragma("user_version=4");
    again.exec("UPDATE ohtia_migration_artifacts SET sha256='" + "a".repeat(64) + "'");
    again.close();
    await expect(store.open()).rejects.toThrow(/identity/);
    expect(checkpoints(root)).toHaveLength(1);
  });
  it("rejects edited executable migration bytes and a mismatching native binding before opening data", () => {
    const { root, options } = fixture();
    fs.appendFileSync(path.join(options.migrationDirectory, "0001_initial.mjs"), "\n// changed\n");
    expect(() => new DurableStore(options)).toThrow(/Changed migration/);
    expect(fs.existsSync(path.join(root, "ohtia.db3"))).toBe(false);
  });
  it("preserves checkpoint and gate after a committed transition loses its final filesystem acknowledgement; explicit inspection admits the target", async () => {
    const { store, root } = fixture();
    const original = fs.unlinkSync;
    const spy = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (String(file).endsWith("migration-pending.json"))
        throw new Error("Synthetic denied publication acknowledgement.");
      original(file);
    });
    await expect(store.open()).rejects.toThrow(/recovery/);
    expect(store.ready).toBe(false);
    expect(checkpoints(root)).toHaveLength(1);
    spy.mockRestore();
    await expect(store.open()).rejects.toThrow(/recovery/);
    await store.retry();
    expect(store.ready).toBe(true);
    expect(checkpoints(root)).toHaveLength(1);
  });
  it("refuses a corrupt snapshot and restores a complete revision-zero database without reattaching failed journals", async () => {
    const { store, root, raw } = fixture();
    await store.open();
    await store.replaceAppearance({ operationId: "save-2", expectedRevision: 0, value: "light" });
    const operation = checkpoints(root)[0]!;
    const snapshot = path.join(root, "recovery/migrations", operation, "ohtia.db3");
    const bytes = fs.readFileSync(snapshot);
    fs.appendFileSync(snapshot, "broken");
    await expect(store.restore(operation)).rejects.toThrow(/identity/);
    fs.writeFileSync(snapshot, bytes);
    await store.restore(operation);
    expect(store.ready).toBe(false);
    const db = raw();
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    expect(db.prepare("SELECT count(*) FROM sqlite_schema").pluck().get()).toBe(0);
    db.close();
    expect(
      fs
        .readdirSync(path.join(root, "recovery/migrations"))
        .some((name) => name.includes(".failed-")),
    ).toBe(true);
    await store.retry();
    expect(await store.readAppearance()).toMatchObject({
      ok: true,
      value: { value: "system", revision: 0, source: "default" },
    });
  });
  it("refuses storage authority before touching the database", () => {
    const { options, root } = fixture();
    expect(
      () =>
        new DurableStore({
          ...options,
          assertAdmission: () => {
            throw new Error("Unverified profile.");
          },
        }),
    ).toThrow(/Unverified/);
    expect(fs.existsSync(path.join(root, "ohtia.db3"))).toBe(false);
  });
});

describe("file-backed locale preference receipts", () => {
  it("commits once, rejects reused identity and stale windows, preserves unrelated preferences and survives restart", async () => {
    const { store, raw } = fixture();
    await store.open();
    const before = raw();
    const unrelated = before
      .prepare("SELECT * FROM application_preferences WHERE key<>'interface_locale' ORDER BY key")
      .all();
    before.close();
    const command = { operationId: "language-op", expectedRevision: 0, value: "es-AR" as const };
    const saved = await store.replaceLocale(command);
    expect(saved).toMatchObject({ ok: true, value: { value: "es-AR", revision: 1 } });
    expect(await store.replaceLocale(command)).toEqual(saved);
    expect(await store.replaceLocale({ ...command, value: "ko-KR" })).toMatchObject({
      ok: false,
      error: { code: "operation_conflict" },
    });
    expect(await store.replaceLocale({ ...command, operationId: "other-window" })).toMatchObject({
      ok: false,
      error: { code: "stale_revision" },
    });
    expect(await store.readLocaleReceipt("other-window")).toMatchObject({
      ok: true,
      value: { state: "recorded", outcome: { ok: false } },
    });
    expect(await store.readLocaleReceipt("missing")).toEqual({
      ok: true,
      value: { state: "not_found" },
    });
    expect(
      await store.replaceLocale({
        ...command,
        operationId: "invalid",
        value: "unsupported" as never,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_message" } });
    expect(await store.readLocaleReceipt("bad id")).toMatchObject({
      ok: false,
      error: { code: "invalid_message" },
    });
    await store.close();
    await store.open();
    expect(await store.readLocale()).toMatchObject({
      ok: true,
      value: { value: "es-AR", revision: 1 },
    });
    expect(await store.readLocaleReceipt("language-op")).toMatchObject({
      ok: true,
      value: { state: "recorded", outcome: saved },
    });
    const after = raw();
    expect(
      after
        .prepare("SELECT * FROM application_preferences WHERE key<>'interface_locale' ORDER BY key")
        .all(),
    ).toEqual(unrelated);
    after.close();
    expect(
      await store.replaceLocale({ operationId: "system-op", expectedRevision: 1, value: "system" }),
    ).toMatchObject({ ok: true, value: { value: "system", revision: 2 } });
    expect(await store.savedLocale()).toEqual({ invalid: false });
  });
  it("preserves invalid stored bytes and permits explicit revision-checked replacement", async () => {
    const { store, raw } = fixture();
    expect(await store.readLocale()).toMatchObject({ ok: false });
    expect(await store.readLocaleReceipt("operation")).toMatchObject({ ok: false });
    expect(
      await store.replaceLocale({ operationId: "operation", expectedRevision: 0, value: "system" }),
    ).toMatchObject({ ok: false });
    await store.open();
    const db = raw();
    db.prepare("INSERT INTO application_preferences VALUES ('interface_locale',2,4,?)").run(
      '"nn-NO"',
    );
    expect(await store.readLocale()).toMatchObject({
      ok: true,
      value: { source: "invalid_fallback", value: "system", revision: 4 },
    });
    expect(
      db
        .prepare("SELECT value FROM application_preferences WHERE key='interface_locale'")
        .pluck()
        .get(),
    ).toBe('"nn-NO"');
    expect(
      await store.replaceLocale({
        operationId: "replacement",
        expectedRevision: 4,
        value: "ko-KR",
      }),
    ).toMatchObject({ ok: true, value: { value: "ko-KR", revision: 5 } });
    db.close();
  });
  it("publishes ordered locale snapshots to two windows without duplicate replay events", async () => {
    const { store } = fixture();
    await store.open();
    const messages: any[] = [];
    const peer = createStatusService(
      "service-1",
      "en-GB",
      (text) => messages.push(JSON.parse(text)),
      store,
    );
    peer.activate("en-GB");
    for (const windowGeneration of ["window-1", "window-2"])
      peer.receive(
        JSON.stringify(
          request({
            operation: "locale.subscribe",
            windowGeneration,
            payload: { subscriptionId: "language" },
          }),
        ),
      );
    await peer.drain();
    peer.receive(
      JSON.stringify(
        request({ operation: "locale.replace", payload: { value: "ko-KR", expectedRevision: 0 } }),
      ),
    );
    await peer.drain();
    peer.receive(
      JSON.stringify(
        request({ operation: "locale.replace", payload: { value: "ko-KR", expectedRevision: 0 } }),
      ),
    );
    await peer.drain();
    expect(
      messages.filter((m) => m.kind === "event").map((m) => m.payload.record.revision),
    ).toEqual([0, 0, 1, 1]);
    peer.receive(
      JSON.stringify(
        request({
          operation: "status.subscribe",
          windowGeneration: "window-status",
          payload: { subscriptionId: "status-language" },
        }),
      ),
    );
    await peer.drain();
    peer.setSystemLocale("ca-ES");
    peer.receive(
      JSON.stringify(
        request({
          operation: "locale.replace",
          operationId: "system",
          payload: { value: "system", expectedRevision: 1 },
        }),
      ),
    );
    await peer.drain();
    expect(
      messages
        .filter((m) => m.kind === "event" && m.topic === "locale")
        .slice(-2)
        .map((m) => m.payload.effectiveLocale),
    ).toEqual(["ca-ES", "ca-ES"]);
    peer.receive(JSON.stringify(request({ operation: "locale.read" })));
    await peer.drain();
    peer.receive(
      JSON.stringify(
        request({ operation: "locale.receipt", payload: { targetOperationId: "system" } }),
      ),
    );
    await peer.drain();
    expect(messages.some((m) => m.kind === "locale_changed")).toBe(true);
    peer.dispose();
  });
});

describe("locale storage failure boundaries", () => {
  it.each(["malformed", "unsupported", "oversized", "revision"])(
    "preserves a %s saved value without implicit repair",
    async (mode) => {
      const { store, raw } = fixture();
      await store.open();
      const db = raw();
      db.pragma("ignore_check_constraints=ON");
      db.prepare("INSERT INTO application_preferences VALUES ('interface_locale',1,?,?)").run(
        mode === "revision" ? 0 : 1,
        mode === "malformed" ? "{" : mode === "oversized" ? "x".repeat(129) : '"nn-NO"',
      );
      if (mode === "revision") {
        expect(await store.readLocale()).toMatchObject({
          ok: false,
          error: { code: "preference_invalid" },
        });
        expect(
          await store.replaceLocale({
            operationId: "invalid-revision",
            expectedRevision: 0,
            value: "ko-KR",
          }),
        ).toMatchObject({ ok: false, error: { code: "preference_invalid" } });
        expect(await store.savedLocale()).toEqual({ invalid: true });
      } else
        expect(await store.readLocale()).toMatchObject({
          ok: true,
          value: { source: "invalid_fallback" },
        });
      db.close();
    },
  );
  it.each(["read", "receipt", "write"])(
    "fails controlled %s admission without exposing diagnostics",
    async (mode) => {
      const { store, options } = fixture();
      await store.open();
      vi.spyOn(options, "assertAdmission").mockImplementation(() => {
        throw new Error("Synthetic private path");
      });
      const result =
        mode === "read"
          ? await store.readLocale()
          : mode === "receipt"
            ? await store.readLocaleReceipt("operation")
            : await store.replaceLocale({
                operationId: "operation",
                expectedRevision: 0,
                value: "ko-KR",
              });
      expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
      expect(JSON.stringify(result)).not.toContain("private");
    },
  );
  it("rolls back both locale and receipt on an actual SQLite write rejection", async () => {
    const { store, raw } = fixture();
    await store.open();
    const db = raw();
    db.exec(
      "CREATE TRIGGER deny_locale BEFORE INSERT ON locale_receipts BEGIN SELECT RAISE(ABORT, 'Synthetic write denial'); END",
    );
    expect(
      await store.replaceLocale({
        operationId: "rejected-by-sqlite",
        expectedRevision: 0,
        value: "ko-KR",
      }),
    ).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(
      db
        .prepare("SELECT count(*) FROM application_preferences WHERE key='interface_locale'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(db.prepare("SELECT count(*) FROM locale_receipts").pluck().get()).toBe(0);
    db.close();
  });
  it("retains uncertainty after a committed write loses its acknowledgement, then reconciles the durable receipt", async () => {
    const { store } = fixture();
    await store.open();
    const prepare = Database.prototype.prepare;
    const intercepted = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
      query,
      ...args
    ) {
      const statement = prepare.call(this, query, ...args);
      if (query === "COMMIT") {
        const run = statement.run.bind(statement);
        statement.run = (...bindings: unknown[]) => {
          run(...bindings);
          throw new Error("Synthetic lost commit acknowledgement");
        };
      }
      return statement;
    });
    expect(
      await store.replaceLocale({ operationId: "lost-ack", expectedRevision: 0, value: "ko-KR" }),
    ).toMatchObject({ ok: false, error: { code: "uncertain" } });
    intercepted.mockRestore();
    expect(await store.readLocaleReceipt("lost-ack")).toMatchObject({
      ok: true,
      value: { state: "recorded", outcome: { ok: true, value: { revision: 1, value: "ko-KR" } } },
    });
    expect(await store.readLocale()).toMatchObject({
      ok: true,
      value: { revision: 1, value: "ko-KR" },
    });
  });
  it("rejects a corrupt recorded locale receipt without overwriting its evidence", async () => {
    const { store, raw } = fixture();
    await store.open();
    const db = raw();
    db.prepare("INSERT INTO locale_receipts VALUES ('corrupt',0,'nn-NO',1,1)").run();
    expect(await store.readLocaleReceipt("corrupt")).toMatchObject({
      ok: false,
      error: { code: "storage_failed" },
    });
    expect(
      db.prepare("SELECT value FROM locale_receipts WHERE operation_id='corrupt'").pluck().get(),
    ).toBe("nn-NO");
    db.close();
  });
});

it("does not publish storage readiness after its startup locale read loses admission", async () => {
  const { store, options } = fixture();
  const open = store.open.bind(store);
  vi.spyOn(store, "open").mockImplementation(async () => {
    await open();
    vi.spyOn(options, "assertAdmission").mockImplementation(() => {
      throw new Error("Synthetic root replacement");
    });
  });
  const sent: string[] = [];
  await expect(
    initializeStorage(
      store,
      "create",
      "generation-1",
      (message) => sent.push(message),
      () => false,
    ),
  ).rejects.toThrow(/root replacement/);
  expect(sent.some((message) => JSON.parse(message).state === "storage_ready")).toBe(false);
  expect(store.admissionReady).toBe(false);
});
it("upgrades a populated revision-two store while preserving appearance receipts and locale bytes", async () => {
  const { store, raw } = fixture();
  await store.open();
  const appearance = await store.replaceAppearance({
    operationId: "before-upgrade",
    expectedRevision: 0,
    value: "dark",
  });
  await store.close();
  const db = raw();
  db.exec(
    "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; DROP TABLE locale_receipts; DELETE FROM kysely_migration WHERE name='0003_locale_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0003_locale_receipts'; INSERT INTO application_preferences VALUES ('interface_locale',1,7,'\"ko-KR\"')",
  );
  db.pragma("user_version=2");
  db.close();
  await store.open();
  expect(await store.readAppearance()).toEqual(appearance);
  expect(await store.readReceipt("before-upgrade")).toEqual({
    ok: true,
    value: { state: "recorded", outcome: appearance },
  });
  expect(await store.readLocale()).toMatchObject({
    ok: true,
    value: { revision: 7, value: "ko-KR", source: "saved" },
  });
  expect(
    await store.replaceLocale({
      operationId: "after-upgrade",
      expectedRevision: 7,
      value: "es-AR",
    }),
  ).toMatchObject({ ok: true, value: { revision: 8 } });
});

describe("real commit uncertainty composed with global locale publication", () => {
  it.each(["before-commit", "after-commit"])(
    "publishes only authoritative effects after %s acknowledgement loss",
    async (boundary) => {
      const { store, raw } = fixture();
      await store.open();
      const messages: any[] = [];
      const peer = createStatusService(
        "service-1",
        "en-GB",
        (text) => messages.push(JSON.parse(text)),
        store,
      );
      peer.activate("en-GB");
      for (const windowGeneration of ["window-a", "window-b"])
        peer.receive(
          JSON.stringify(
            request({
              operation: "locale.subscribe",
              windowGeneration,
              payload: { subscriptionId: "language" },
            }),
          ),
        );
      await peer.drain();
      const replace = vi.spyOn(store, "replaceLocale");
      const prepare = Database.prototype.prepare;
      const intercepted = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
        query,
        ...args
      ) {
        if (query === "COMMIT" && boundary === "before-commit")
          throw new Error("Synthetic pre-commit acknowledgement failure");
        const statement = prepare.call(this, query, ...args);
        if (query === "COMMIT" && boundary === "after-commit") {
          const run = statement.run.bind(statement);
          statement.run = (...bindings: unknown[]) => {
            run(...bindings);
            throw new Error("Synthetic lost committed acknowledgement");
          };
        }
        return statement;
      });
      peer.receive(
        JSON.stringify(
          request({
            operation: "locale.replace",
            operationId: "uncertain-language",
            payload: { expectedRevision: 0, value: "ko-KR" },
          }),
        ),
      );
      await peer.drain();
      intercepted.mockRestore();
      expect(
        messages.find(
          (message) => message.kind === "result" && message.operation === "locale.replace",
        ),
      ).toMatchObject({ payload: { ok: false, error: { code: "uncertain" } } });
      peer.receive(
        JSON.stringify(
          request({
            operation: "locale.receipt",
            payload: { targetOperationId: "uncertain-language" },
          }),
        ),
      );
      await peer.drain();
      peer.receive(JSON.stringify(request({ operation: "status.read" })));
      await peer.drain();
      expect(replace).toHaveBeenCalledOnce();
      const events = messages.filter(
        (message) => message.kind === "event" && message.topic === "locale",
      );
      expect(events.map((message) => message.payload.record.revision)).toEqual(
        boundary === "after-commit" ? [0, 0, 1, 1] : [0, 0],
      );
      expect(messages.at(-1)).toMatchObject({
        payload: {
          ok: true,
          value: { interfaceLocale: boundary === "after-commit" ? "ko-KR" : "en-GB" },
        },
      });
      const db = raw();
      expect(db.prepare("SELECT count(*) FROM locale_receipts").pluck().get()).toBe(
        boundary === "after-commit" ? 1 : 0,
      );
      db.close();
      peer.dispose();
    },
  );
});

describe("file-backed workspace preferences", () => {
  it("commits exact layout and receipt once, survives restart and preserves unrelated records", async () => {
    const { store, raw } = fixture();
    await store.open();
    expect(await store.readLayout()).toEqual({
      ok: true,
      value: { schemaVersion: 1, revision: 0, source: "default", value: null },
    });
    await store.replaceAppearance({ operationId: "theme", expectedRevision: 0, value: "dark" });
    const value = defaultWorkspaceLayout(1440);
    const command = { operationId: "layout-1", expectedRevision: 0, value };
    const first = await store.replaceLayout(command);
    expect(first).toMatchObject({ ok: true, value: { revision: 1, value } });
    expect(await store.replaceLayout(command)).toEqual(first);
    expect(
      await store.replaceLayout({
        ...command,
        value: { ...value, visible: { explorer: true, documents: false, chat: true } },
      }),
    ).toEqual(failure("operation_conflict"));
    expect(await store.replaceLayout({ ...command, operationId: "stale" })).toMatchObject({
      ok: false,
      error: { code: "stale_revision", parameters: { currentRevision: 1 } },
    });
    await store.close();
    await store.open();
    expect(await store.readLayoutReceipt("layout-1")).toEqual({
      ok: true,
      value: { state: "recorded", outcome: first },
    });
    expect(await store.readLayoutReceipt("unknown")).toEqual({
      ok: true,
      value: { state: "not_found" },
    });
    expect(await store.readLayoutReceipt("!bad")).toEqual(failure("invalid_message"));
    expect(await store.readAppearance()).toMatchObject({
      ok: true,
      value: { value: "dark", revision: 1 },
    });
    const db = raw();
    expect(db.prepare("SELECT count(*) FROM application_preferences").pluck().get()).toBe(3);
    db.close();
  });
  it("uses corrupt and unsupported layout fallbacks without rewriting evidence or disabling research storage", async () => {
    const { store, raw } = fixture();
    await store.open();
    const db = raw();
    for (const value of [
      "{",
      JSON.stringify({
        ...defaultWorkspaceLayout(1280),
        visible: { explorer: false, documents: false, chat: false },
      }),
      JSON.stringify({ private: "must stay local" }),
    ]) {
      db.prepare(
        "INSERT OR REPLACE INTO application_preferences VALUES ('workspace_layout',1,7,?)",
      ).run(value);
      expect(await store.readLayout()).toMatchObject({
        ok: true,
        value: { revision: 7, source: "invalid_fallback", value: null },
      });
      expect(store.ready).toBe(true);
      expect(
        db
          .prepare("SELECT value FROM application_preferences WHERE key='workspace_layout'")
          .pluck()
          .get(),
      ).toBe(value);
    }
    db.prepare(
      "UPDATE application_preferences SET schema_version=2,value=? WHERE key='workspace_layout'",
    ).run(JSON.stringify(defaultWorkspaceLayout(1280)));
    expect(await store.readLayout()).toMatchObject({
      ok: true,
      value: { source: "invalid_fallback" },
    });
    db.close();
    expect(
      await store.replaceLayout({
        operationId: "repair",
        expectedRevision: 7,
        value: defaultWorkspaceLayout(1280),
      }),
    ).toMatchObject({ ok: true, value: { revision: 8 } });
  });
  it("rolls back denied writes and retains admission after a layout-only read failure", async () => {
    const { store, raw } = fixture();
    await store.open();
    const db = raw();
    db.exec("BEGIN EXCLUSIVE");
    expect(await store.readLayout()).toEqual(failure("storage_failed"));
    expect(store.ready).toBe(true);
    expect(
      await store.replaceLayout({
        operationId: "blocked",
        expectedRevision: 0,
        value: defaultWorkspaceLayout(1280),
      }),
    ).toEqual(failure("storage_failed"));
    db.exec("ROLLBACK");
    db.close();
    expect(await store.readLayoutReceipt("blocked")).toMatchObject({
      ok: true,
      value: { state: "not_found" },
    });
    expect(
      await store.replaceLayout({
        operationId: "explicit-new",
        expectedRevision: 0,
        value: defaultWorkspaceLayout(1280),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await store.replaceLayout({
        operationId: "private",
        expectedRevision: 1,
        value: { ...defaultWorkspaceLayout(1280), path: "private" },
      } as never),
    ).toEqual(failure("invalid_message"));
    await store.close();
    expect(await store.readLayout()).toEqual(failure("service_unavailable"));
    expect(await store.readLayoutReceipt("op")).toEqual(failure("service_unavailable"));
    expect(
      await store.replaceLayout({
        operationId: "op",
        expectedRevision: 1,
        value: defaultWorkspaceLayout(1280),
      }),
    ).toEqual(failure("service_unavailable"));
  });
  it("serializes complete records through the real service and retains stale-window conflict receipts", async () => {
    const { store } = fixture();
    await store.open();
    const output: any[] = [];
    const service = createStatusService(
      "service-1",
      "en-US",
      (text) => output.push(JSON.parse(text)),
      store,
    );
    service.activate("en-US");
    const send = (
      operation: string,
      payload: any,
      operationId: string,
      windowGeneration = "window-1",
    ) =>
      service.receive(
        JSON.stringify(
          request({
            operation,
            payload,
            operationId,
            requestId: operationId,
            windowGeneration,
          } as never),
        ),
      );
    send("layout.replace", { expectedRevision: 0, value: defaultWorkspaceLayout(1440) }, "first");
    send(
      "layout.replace",
      { expectedRevision: 0, value: defaultWorkspaceLayout(1280) },
      "second",
      "window-2",
    );
    await service.drain();
    expect(output[0].payload).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(output[1].payload).toMatchObject({ ok: false, error: { code: "stale_revision" } });
    send("layout.read", {}, "later", "window-3");
    send("layout.receipt", { targetOperationId: "second" }, "receipt", "window-2");
    await service.drain();
    expect(output[2].payload).toMatchObject({
      ok: true,
      value: { value: defaultWorkspaceLayout(1440) },
    });
    expect(output[3].payload).toMatchObject({
      ok: true,
      value: { state: "recorded", outcome: { ok: false } },
    });
    service.dispose();
  });
});

describe("layout migration and uncertain commit boundary", () => {
  it("upgrades revision three with a verified checkpoint and preserves its existing layout, locale and appearance receipts", async () => {
    const { store, raw, root } = fixture();
    await store.open();
    await store.replaceAppearance({
      operationId: "before-layout-migration",
      expectedRevision: 0,
      value: "dark",
    });
    const locale = await store.replaceLocale({
      operationId: "locale-before-layout",
      expectedRevision: 0,
      value: "ko-KR",
    });
    await store.close();
    const db = raw();
    db.exec(
      "DROP TABLE layout_receipts; DELETE FROM kysely_migration WHERE name='0004_layout_receipts'; DELETE FROM ohtia_migration_artifacts WHERE name='0004_layout_receipts'; PRAGMA user_version=3",
    );
    const value = defaultWorkspaceLayout(1440);
    db.prepare("INSERT INTO application_preferences VALUES ('workspace_layout',1,8,?)").run(
      JSON.stringify(value),
    );
    db.close();
    await store.open();
    expect(await store.readLayout()).toMatchObject({ ok: true, value: { revision: 8, value } });
    expect(await store.readReceipt("before-layout-migration")).toMatchObject({
      ok: true,
      value: { state: "recorded" },
    });
    expect(await store.readLocale()).toEqual(locale);
    expect(await store.readLocaleReceipt("locale-before-layout")).toEqual({
      ok: true,
      value: { state: "recorded", outcome: locale },
    });
    const entries = checkpoints(root).map((name) =>
      JSON.parse(
        fs.readFileSync(path.join(root, "recovery/migrations", name, "manifest.json"), "utf8"),
      ),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ sourceRevision: 3, targetRevision: 4 }),
    );
  });
  it("rolls back both rows before commit and reconciles a lost acknowledgement after a real commit", async () => {
    const { store } = fixture();
    await store.open();
    const original = Database.prototype.prepare;
    let phase = "before";
    const spy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
      text,
      ...args
    ) {
      if (phase === "before" && String(text).startsWith('insert into "layout_receipts"'))
        throw new Error("Injected receipt failure");
      const statement = original.call(this, text, ...args);
      if (phase === "after" && String(text) === "COMMIT") {
        const run = statement.run.bind(statement);
        statement.run = (...parameters: any[]) => {
          run(...parameters);
          throw new Error("Lost commit acknowledgement");
        };
      }
      return statement;
    });
    const command = {
      operationId: "uncertain-layout",
      expectedRevision: 0,
      value: defaultWorkspaceLayout(1280),
    };
    expect(await store.replaceLayout({ ...command, operationId: "failed-before" })).toEqual(
      failure("storage_failed"),
    );
    expect(await store.readLayout()).toMatchObject({ ok: true, value: { source: "default" } });
    expect(await store.readLayoutReceipt("failed-before")).toMatchObject({
      ok: true,
      value: { state: "not_found" },
    });
    phase = "after";
    expect(await store.replaceLayout(command)).toEqual(failure("uncertain"));
    spy.mockRestore();
    expect(await store.readLayoutReceipt(command.operationId)).toMatchObject({
      ok: true,
      value: { state: "recorded", outcome: { ok: true, value: { revision: 1 } } },
    });
    expect(await store.replaceLayout(command)).toMatchObject({ ok: true, value: { revision: 1 } });
  });
});
