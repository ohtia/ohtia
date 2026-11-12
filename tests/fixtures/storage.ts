import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, vi } from "vitest";
import { DurableStore, type StorageOptions } from "../../packages/utility/dist/index.js";

const require = createRequire(new URL("../../packages/utility/package.json", import.meta.url));
export const Database = require("better-sqlite3") as typeof import("better-sqlite3");
export const roots: string[] = [];
export const stores: DurableStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
export function storageFixture() {
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
    languageRegistry: path.resolve("config/localization/iana-language-subtag-registry.txt"),
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
