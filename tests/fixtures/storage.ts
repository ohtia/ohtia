import { newId } from "../../packages/utility/src/research.js";
import { preConsultationSql } from "../../tooling/storage-legacy-consultation-fixture.mjs";
export { preConsultationSql };
import { objects as initialResearchObjects } from "../../packages/utility/src/migrations/0007_research_records.mjs";
import { objects as titleObjects } from "../../packages/utility/src/migrations/0018_conversation_titles.mjs";
import { objects as openingObjects } from "../../packages/utility/src/migrations/0017_project_opening.mjs";
import { objects as setupObjects } from "../../packages/utility/src/migrations/0015_project_setup.mjs";
import { objects as initialTaskObjects } from "../../packages/utility/src/migrations/0008_durable_ai_tasks.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, vi } from "vitest";
import { DurableStore, type StorageOptions } from "../../packages/utility/dist/index.js";

const require = createRequire(new URL("../../packages/utility/package.json", import.meta.url));
export const Database = require("better-sqlite3") as typeof import("better-sqlite3");
const preConversationAgentsFrom20Sql = `DROP TRIGGER conversations_changes; ${titleObjects.conversations_changes}; ALTER TABLE conversations DROP COLUMN agent_id; DELETE FROM kysely_migration WHERE name='0020_conversation_agents'; DELETE FROM ohtia_migration_artifacts WHERE name='0020_conversation_agents'; `;
export const preConversationAgentsSql = preConsultationSql + preConversationAgentsFrom20Sql;
const josefaLedgerSql =
  preConversationAgentsFrom20Sql +
  "DELETE FROM kysely_migration WHERE name='0019_josefa_search_planning'; DELETE FROM ohtia_migration_artifacts WHERE name='0019_josefa_search_planning'; ";
export const preJosefaReceiptsSql = `DROP TRIGGER receipts_commands; ${openingObjects.receipts_commands}; `;
export const preJosefaSql = preConsultationSql + preJosefaReceiptsSql + josefaLedgerSql;
const preConversationTitlesFrom20Sql = `${josefaLedgerSql}DROP TRIGGER conversations_changes; ${initialResearchObjects.conversations_changes}; ALTER TABLE conversations DROP COLUMN title_attempt_id; ALTER TABLE conversations DROP COLUMN automatic_title_eligible; ALTER TABLE attempts DROP COLUMN conversation_title_policy; DELETE FROM kysely_migration WHERE name='0018_conversation_titles'; DELETE FROM ohtia_migration_artifacts WHERE name='0018_conversation_titles'; `;
export const preConversationTitlesSql = preConsultationSql + preConversationTitlesFrom20Sql;
const preProjectOpeningFrom20Sql =
  preConversationTitlesFrom20Sql +
  "DROP INDEX projects_open_order; ALTER TABLE projects DROP COLUMN last_opened_at; ALTER TABLE command_receipts DROP COLUMN error_code; DELETE FROM kysely_migration WHERE name='0017_project_opening'; DELETE FROM ohtia_migration_artifacts WHERE name='0017_project_opening'; ";
export const preProjectOpeningSql = preConsultationSql + preProjectOpeningFrom20Sql;
export const legacyTaskInitialFrom20Sql = `${preProjectOpeningFrom20Sql}DROP TRIGGER tasks_initial; ${initialTaskObjects.tasks_initial}; `;
export const legacyTaskInitialSql = preConsultationSql + legacyTaskInitialFrom20Sql;
export const preTaskNoticeSql = `${legacyTaskInitialSql} DROP TRIGGER receipts_commands; ${setupObjects.receipts_commands}; DELETE FROM kysely_migration WHERE name='0016_task_notices'; DELETE FROM ohtia_migration_artifacts WHERE name='0016_task_notices'; PRAGMA user_version=15;`;
export const roots: string[] = [];
export const stores: DurableStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
export function storageFixture(emitDiagnostic?: StorageOptions["emitDiagnostic"]) {
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
    ...(emitDiagnostic ? { emitDiagnostic } : {}),
  };
  const store = new DurableStore(options);
  stores.push(store);
  const raw = () => new Database(path.join(root, "ohtia.db3"), { nativeBinding: binding });
  return { root, options, store, raw };
}

export function seedDefaultModel(
  raw: ReturnType<typeof storageFixture>["raw"],
  model: string,
  name = model,
  connection = "chatgpt",
): void {
  const db = raw();
  try {
    db.prepare(
      `INSERT INTO agent_inference_preferences
      (id,target,connection,model,model_name,inherit,revision,source,seed_pending)
      VALUES (?,'default',?,?,?,0,1,'researcher',0)
      ON CONFLICT(target) DO UPDATE SET connection=excluded.connection, model=excluded.model,
      model_name=excluded.model_name, seed_pending=0, revision=revision+1 WHERE seed_pending=1`,
    ).run(Buffer.from(newId()), connection, model, name);
  } finally {
    db.close();
  }
}

export function setSyntheticAgentModel(
  raw: ReturnType<typeof storageFixture>["raw"],
  agent: "virgilio" | "josefa",
  connection: string,
  model: string,
): void {
  const db = raw();
  try {
    db.prepare(
      `INSERT INTO agent_inference_preferences
      (id,target,connection,model,model_name,inherit,revision,source,seed_pending)
      VALUES (?,?,?,?,?,0,1,'researcher',0)
      ON CONFLICT(target) DO UPDATE SET connection=excluded.connection,model=excluded.model,
      model_name=excluded.model_name,revision=revision+1`,
    ).run(Buffer.from(newId()), agent, connection, model, model);
  } finally {
    db.close();
  }
}
