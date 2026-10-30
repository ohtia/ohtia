// Read-only preflight through the installed Electron and exact packaged binding after quiescence.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [preparedDirectory, research, output, descriptorFile] = process.argv.slice(2);
if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE !== "1")
  throw new Error("The installed Electron runtime is required.");
if (!descriptorFile) throw new Error("A freshly derived payload descriptor is required.");
const prepared = JSON.parse(fs.readFileSync(descriptorFile));
const app = path.resolve(preparedDirectory, prepared.app);
if (!app.startsWith(preparedDirectory + path.sep) || fs.realpathSync(app) !== app)
  throw new Error("Invalid packaged application path.");
const descriptor = JSON.parse(fs.readFileSync(path.join(app, "storage.json")));
const binding = path.join(app, "native/binding.node");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (
  sha(binding) !== descriptor.bindingSha256 ||
  `${process.platform}-${process.arch}` !== descriptor.target
)
  throw new Error("Installed binding or runtime mismatch.");
const databaseFile = path.join(research, "ohtia.db3");
const info = fs.lstatSync(databaseFile);
if (!info.isFile() || info.nlink !== 1 || fs.realpathSync(databaseFile) !== databaseFile)
  throw new Error("An existing unaliased synthetic store is required.");
const migrations = JSON.parse(fs.readFileSync(path.join(app, "migrations/manifest.json")));
if (
  !Array.isArray(migrations) ||
  !migrations.length ||
  migrations.some(
    (entry) => sha(path.join(app, "migrations", entry.name + ".mjs")) !== entry.sha256,
  )
)
  throw new Error("Packaged migration module identity mismatch.");
const Database = require(path.join(app, "node_modules/better-sqlite3"));
const database = new Database(databaseFile, {
  readonly: true,
  fileMustExist: true,
  nativeBinding: binding,
});
let result;
try {
  database.pragma("foreign_keys=ON");
  const schema = database.pragma("user_version", { simple: true });
  const engine = database
    .prepare("SELECT sqlite_version() AS version,sqlite_source_id() AS source_id")
    .get();
  const history = database
    .prepare("SELECT name FROM kysely_migration ORDER BY timestamp,name")
    .all()
    .map((entry) => entry.name);
  const artifacts = database
    .prepare("SELECT name,sha256 FROM ohtia_migration_artifacts ORDER BY name")
    .all();
  if (
    schema !== migrations.length ||
    JSON.stringify(history) !== JSON.stringify(migrations.map((entry) => entry.name)) ||
    JSON.stringify(artifacts) !== JSON.stringify(migrations) ||
    database.pragma("foreign_keys", { simple: true }) !== 1 ||
    database.pragma("integrity_check", { simple: true }) !== "ok" ||
    database.pragma("foreign_key_check").length ||
    engine.version !== descriptor.engine.version ||
    engine.source_id !== descriptor.engine.sourceId
  )
    throw new Error("Incompatible, corrupt or inconsistent native store.");
  const row = database
    .prepare(
      "SELECT schema_version,revision,value FROM application_preferences WHERE key='appearance'",
    )
    .get();
  let appearance = { schemaVersion: 1, revision: 0, value: "system", source: "default" };
  if (row) {
    if (
      row.schema_version !== 1 ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      typeof row.value !== "string" ||
      row.value.length > 128
    )
      throw new Error("Unsupported baseline appearance record.");
    const value = JSON.parse(row.value);
    if (!["system", "dark", "light"].includes(value))
      throw new Error("Invalid baseline appearance.");
    appearance = { schemaVersion: 1, revision: row.revision, value, source: "saved" };
  }
  result = {
    schema,
    appearance,
    engine,
    history,
    artifacts,
    runtime: process.versions,
    target: descriptor.target,
    installed_version: JSON.parse(fs.readFileSync(path.join(app, "package.json"))).version,
  };
} finally {
  database.close();
}
fs.writeFileSync(output, JSON.stringify(result) + "\n", { flag: "wx", mode: 0o600 });
