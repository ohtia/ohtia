import {
  up as executionLimitsReceipts,
  schema as executionLimitsReceiptsSchema,
} from "./migrations/0013_execution_limits_receipts.mjs";
import {
  decodeExecutionLimitsChange,
  isInferenceLimit,
  type ExecutionLimitsChange,
  type ExecutionLimitsRecord,
  type ExecutionLimitsReceipt,
} from "@ohtia/contracts";
import {
  up as setup,
  tables as setupTables,
  objects as setupObjects,
} from "./migrations/0015_project_setup.mjs";
import { up as composer, objects as composerObjects } from "./migrations/0014_message_composer.mjs";
import {
  up as taskNotices,
  objects as taskNoticeObjects,
} from "./migrations/0016_task_notices.mjs";
import {
  up as projectOpening,
  columns as openingColumns,
  objects as openingObjects,
} from "./migrations/0017_project_opening.mjs";
import {
  up as conversationTitles,
  columns as titleColumns,
  objects as titleObjects,
} from "./migrations/0018_conversation_titles.mjs";
import {
  up as josefaSearchPlanning,
  objects as josefaObjects,
} from "./migrations/0019_josefa_search_planning.mjs";
import {
  up as conversationAgents,
  agentColumn,
  objects as agentObjects,
} from "./migrations/0020_conversation_agents.mjs";
import {
  up as consultations,
  consultationTasks,
  tables as consultationTables,
  objects as consultationObjects,
} from "./migrations/0021_consultations.mjs";
import {
  up as contributionGraphs,
  graphTasks,
  tables as graphTables,
  objects as graphObjects,
} from "./migrations/0022_contribution_graphs.mjs";
import {
  objects as workLimitObjects,
  tables as workLimitTables,
  up as sharedWorkLimits,
} from "./migrations/0023_shared_work_limits.mjs";
import {
  coordinationTables,
  objects as coordinationObjects,
  up as planCoordination,
} from "./migrations/0024_plan_coordination.mjs";
import {
  synthesisTables,
  objects as synthesisObjects,
  up as contributionSynthesis,
} from "./migrations/0025_contribution_synthesis.mjs";
import {
  interventions as planProposalInterventions,
  objects as planProposalObjects,
  up as planProposals,
} from "./migrations/0026_plan_proposals.mjs";
import { readResearch, researchRevisions, readPauseCounts } from "./research-reads.js";
import type { Request, ResearchScope, ResearchEvent, ResearchOperation } from "@ohtia/contracts";
import {
  up as applicationExit,
  objects as exitObjects,
} from "./migrations/0012_application_exit.mjs";
import {
  up as serviceRuns,
  tables as runTables,
  objects as runObjects,
} from "./migrations/0011_service_runs.mjs";
import {
  up as usagePauses,
  tables as usageTables,
  objects as usageObjects,
} from "./migrations/0009_usage_limit_pauses.mjs";
import {
  up as replyControl,
  columns as replyColumns,
  objects as replyObjects,
} from "./migrations/0010_reply_control.mjs";
import {
  TaskTransaction,
  type TaskContext,
  type PreparedTask,
  type RecordedTaskEvent,
} from "./tasks.js";
import { ServiceConnections, type ProviderEvent } from "@ohtia/contracts";
import {
  up as durableTasks,
  tables as taskTables,
  objects as taskObjects,
} from "./migrations/0008_durable_ai_tasks.mjs";
import {
  applyResearchCommand,
  researchReceiptResult,
  LanguageRegistry,
  listProjects,
  identifier,
  bytes,
  listConversations,
  listMessages,
  type ResearchSchema,
} from "./research.js";
import {
  type ResearchCommand,
  type ResearchResult,
  type ProjectRecord,
  type ConversationRecord,
  type MessageRecord,
  type DiagnosticEvent,
  type ErrorCode,
  diagnosticCatalog,
} from "@ohtia/contracts";
import {
  up as researchRecords,
  tables as researchTables,
  objects as researchObjects,
} from "./migrations/0007_research_records.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { Migrator } from "kysely/migration";
import {
  decodePresentationChange,
  isCharacterPresentation,
  isInterfaceZoom,
  nextInterfaceZoom,
  isZoomBoundaryError,
  type ZoomBoundaryError,
  type ZoomIntent,
  type InterfaceZoom,
  type PresentationValues,
  type PresentationFeature,
  type PresentationRecord,
  type SavedPresentationRecord,
  type PresentationChange,
  type PresentationReceipt,
  failure,
  decodeWindowBoundsChange,
  isWindowBounds,
  type WindowBoundsChange,
  type WindowBoundsRecord,
  type WindowBoundsReceipt,
  type SavedWindowBoundsRecord,
  decodeLayoutChange,
  isWorkspaceLayout,
  type LayoutChange,
  type LayoutRecord,
  type LayoutReceipt,
  type SavedLayoutRecord,
  isAppearance,
  isLocaleChoice,
  type LocaleRecord,
  type LocaleReceipt,
  type LocaleChoice,
  type SavedLocaleRecord,
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
  applyLocaleCommand,
  type LocaleCommand,
  type RecordedLocaleCommand,
  applyWindowBoundsCommand,
  type RecordedWindowBoundsCommand,
  applyLayoutCommand,
  type RecordedLayoutCommand,
  type AppearanceCommand,
  type RecordedAppearanceCommand,
} from "@ohtia/domain";
import { up as initial, schema as preferencesSchema } from "./migrations/0001_initial.mjs";
import { up as receipts, schema as receiptsSchema } from "./migrations/0002_receipts.mjs";
import {
  up as localeReceipts,
  schema as localeReceiptsSchema,
} from "./migrations/0003_locale_receipts.mjs";
import {
  up as layoutReceipts,
  schema as layoutReceiptsSchema,
} from "./migrations/0004_layout_receipts.mjs";

import {
  up as boundsReceipts,
  schema as boundsReceiptsSchema,
} from "./migrations/0006_window_bounds_receipts.mjs";

import {
  up as presentationReceipts,
  schema as presentationReceiptsSchema,
} from "./migrations/0005_presentation_receipts.mjs";

interface PresentationReceiptRow extends Omit<Receipt, "value"> {
  feature: PresentationFeature;
  intent: ZoomIntent | null;
  error_code: ZoomBoundaryError | null;
  value: string;
}
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
interface LocaleReceiptRow extends Omit<Receipt, "value"> {
  value: LocaleChoice;
}
interface LayoutReceiptRow extends Omit<Receipt, "value"> {
  value: string;
}
interface Schema extends ResearchSchema {
  execution_limits_receipts: { operation_id: string; value: number; result_revision: number };
  presentation_receipts: PresentationReceiptRow;
  locale_receipts: LocaleReceiptRow;
  layout_receipts: LayoutReceiptRow;
  window_bounds_receipts: LayoutReceiptRow;
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
  /** Main supplies the data-service generation; standalone store admissions get fresh identities. */
  readonly serviceGeneration?: string;
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
  /** Trusted packaged resource; never supplied by a research command. */
  readonly languageRegistry?: string;
  readonly emitDiagnostic?: (event: DiagnosticEvent) => void;
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
const names = [
  "0001_initial",
  "0002_receipts",
  "0003_locale_receipts",
  "0004_layout_receipts",
  "0005_presentation_receipts",
  "0006_window_bounds_receipts",
  "0007_research_records",
  "0008_durable_ai_tasks",
  "0009_usage_limit_pauses",
  "0010_reply_control",
  "0011_service_runs",
  "0012_application_exit",
  "0013_execution_limits_receipts",
  "0014_message_composer",
  "0015_project_setup",
  "0016_task_notices",
  "0017_project_opening",
  "0018_conversation_titles",
  "0019_josefa_search_planning",
  "0020_conversation_agents",
  "0021_consultations",
  "0022_contribution_graphs",
  "0023_shared_work_limits",
  "0024_plan_coordination",
  "0025_contribution_synthesis",
  "0026_plan_proposals",
] as const;
const target = names.length;
const targetName = migrationTarget();
function migrationTarget(): string {
  const name = names.at(-1);
  if (!name) throw new Error("A target migration is required.");
  return name;
}
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
    ...(revision >= 2 ? ["appearance_receipts"] : []),
    ...(revision >= 3 ? ["locale_receipts"] : []),
    ...(revision >= 4 ? ["layout_receipts"] : []),
    ...(revision >= 5 ? ["presentation_receipts"] : []),
    ...(revision >= 6 ? ["window_bounds_receipts"] : []),
    ...(revision >= 7 ? Object.keys(researchTables) : []),
    ...(revision >= 8 ? Object.keys(taskTables) : []),
    ...(revision >= 9 ? Object.keys(usageTables) : []),
    ...(revision >= 11 ? Object.keys(runTables) : []),
    ...(revision >= 13 ? ["execution_limits_receipts"] : []),
    ...(revision >= 15 ? Object.keys(setupTables) : []),
    ...(revision >= 22
      ? Object.keys(graphTables)
      : revision >= 21
        ? Object.keys(consultationTables)
        : []),
    ...(revision >= 23
      ? Object.keys(workLimitTables).filter((name) => name !== "contributions")
      : []),
    ...(revision >= 24 ? ["intervention_events", "continuations"] : []),
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
    ...(revision >= 5
      ? {
          presentation_receipts: [
            "feature",
            "operation_id",
            "intent",
            "error_code",
            "expected_revision",
            "value",
            "accepted",
            "result_revision",
          ],
        }
      : {}),
    ...(revision >= 13
      ? { execution_limits_receipts: ["operation_id", "value", "result_revision"] }
      : {}),
    application_preferences: ["key", "schema_version", "revision", "value"],
    kysely_migration: ["name", "timestamp"],
    kysely_migration_lock: ["id", "is_locked"],
    ohtia_migration_artifacts: ["name", "sha256"],
    ...(revision >= 3
      ? {
          locale_receipts: [
            "operation_id",
            "expected_revision",
            "value",
            "accepted",
            "result_revision",
          ],
        }
      : {}),
    ...(revision >= 2
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
    ...(revision >= 4
      ? {
          layout_receipts: [
            "operation_id",
            "expected_revision",
            "value",
            "accepted",
            "result_revision",
          ],
        }
      : {}),
    ...(revision >= 6
      ? {
          window_bounds_receipts: [
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
    ...(revision >= 2 ? [["appearance_receipts", receiptsSchema]] : []),
    ...(revision >= 3 ? [["locale_receipts", localeReceiptsSchema]] : []),
    ...(revision >= 4 ? [["layout_receipts", layoutReceiptsSchema]] : []),
    ...(revision >= 5 ? [["presentation_receipts", presentationReceiptsSchema]] : []),
    ...(revision >= 6 ? [["window_bounds_receipts", boundsReceiptsSchema]] : []),
    ...(revision >= 7
      ? Object.entries(researchTables).map(([name, definition]) => [
          name,
          revision >= 8 && name === "messages"
            ? definition.replace(
                ",\n    UNIQUE (conversation_id,position)",
                `, task_id BLOB REFERENCES tasks(id)${revision >= 10 ? `, ${replyColumns.ending}` : ""},\n    UNIQUE (conversation_id,position)`,
              )
            : revision >= 17 && (name === "projects" || name === "command_receipts")
              ? name === "projects"
                ? definition.replace(
                    ",\n    CHECK ((title",
                    ", " + openingColumns.opened + ",\n    CHECK ((title",
                  )
                : definition.slice(0, -1) + ", " + openingColumns.error + ")"
              : revision >= 18 && name === "conversations"
                ? definition.slice(0, -1) +
                  ", " +
                  titleColumns.eligible +
                  ", " +
                  titleColumns.origin +
                  (revision >= 20 ? ", " + agentColumn : "") +
                  ")"
                : definition,
        ])
      : []),
    ...(revision >= 8
      ? Object.entries(taskTables).map(([name, definition]) => [
          name,
          revision >= 21 && name === "tasks"
            ? revision >= 24
              ? coordinationTables.tasks
              : revision >= 22
                ? graphTasks
                : consultationTasks
            : revision >= 25 && name === "attempts"
              ? synthesisTables.attempts
              : revision >= 10 && name === "tasks"
                ? definition.replace(
                    ",\n    CHECK ((state=",
                    `, ${replyColumns.charge},\n    CHECK ((state=`,
                  )
                : revision >= 18 && name === "attempts"
                  ? definition.replace(
                      ",\n    UNIQUE (task_id,attempt_number)",
                      `, ${titleColumns.policy},\n    UNIQUE (task_id,attempt_number)`,
                    )
                  : definition,
        ])
      : []),
    ...(revision >= 15 ? Object.entries(setupTables) : []),
    ...(revision >= 22
      ? Object.entries(
          revision >= 24
            ? {
                ...graphTables,
                ...workLimitTables,
                interventions:
                  revision >= 26 ? planProposalInterventions : coordinationTables.interventions,
                intervention_events: coordinationTables.intervention_events,
                continuations:
                  revision >= 25 ? synthesisTables.continuations : coordinationTables.continuations,
              }
            : revision >= 23
              ? { ...graphTables, ...workLimitTables }
              : graphTables,
        )
      : revision >= 21
        ? Object.entries(consultationTables)
        : []),
    ...(revision >= 9 ? Object.entries(usageTables) : []),
    ...(revision >= 11 ? Object.entries(runTables) : []),
    ...(revision >= 13 ? [["execution_limits_receipts", executionLimitsReceiptsSchema]] : []),
  ]) {
    const row = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name=? AND type='table'")
      .get(table) as { sql: string } | undefined;
    if (!row || !expectedSql || normalize(row.sql) !== normalize(expectedSql))
      throw new Error("Altered source constraints.");
  }
  const objects = db
    .prepare(
      "SELECT name,sql FROM sqlite_schema WHERE type IN ('trigger','view') OR (type='index' AND sql IS NOT NULL) ORDER BY name",
    )
    .all() as { name: string; sql: string }[];
  const expectedObjects =
    revision >= 7
      ? Object.entries(
          revision >= 8
            ? {
                ...Object.fromEntries(
                  Object.entries(researchObjects).filter(([name]) => name !== "messages_revision"),
                ),
                ...taskObjects,
                ...(revision >= 9 ? usageObjects : {}),
                ...(revision >= 10 ? replyObjects : {}),
                ...(revision >= 11 ? runObjects : {}),
                ...(revision >= 12 ? exitObjects : {}),
                ...(revision >= 14 ? composerObjects : {}),
                ...(revision >= 15 ? setupObjects : {}),
                ...(revision >= 16 ? taskNoticeObjects : {}),
                ...(revision >= 17 ? openingObjects : {}),
                ...(revision >= 18 ? titleObjects : {}),
                ...(revision >= 19 ? josefaObjects : {}),
                ...(revision >= 20 ? agentObjects : {}),
                ...(revision >= 22 ? graphObjects : revision >= 21 ? consultationObjects : {}),
                ...(revision >= 23 ? workLimitObjects : {}),
                ...(revision >= 24 ? coordinationObjects : {}),
                ...(revision >= 25 ? synthesisObjects : {}),
                ...(revision >= 26 ? planProposalObjects : {}),
              }
            : researchObjects,
        ).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : [];
  if (
    objects.length !== expectedObjects.length ||
    objects.some((row, i) => {
      const expected = expectedObjects.at(i);
      return !expected || row.name !== expected[0] || normalize(row.sql) !== normalize(expected[1]);
    })
  )
    throw new Error("Unexpected or altered source objects.");
  limits(db);
  return revision;
}

/** One utility owner; normal commands cannot interleave with schema/recovery admission. */
export class DurableStore {
  private database: Kysely<Schema> | undefined;
  private native: Database.Database | undefined;
  private active = false;
  private taskContext: TaskContext = {
    mode: "installed",
    generation: randomUUID(),
    connections: new ServiceConnections(),
  };
  setTaskContext(context: TaskContext): void {
    this.taskContext = context;
  }
  private continuationAdmissionStopped = false;
  private runGeneration: string | undefined;
  private languageRegistry: LanguageRegistry | undefined;
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
  async close(orderly = false): Promise<void> {
    // Called only after the service queue drains. This is the last write before store closure.
    // Capture admission first: a failed migration/review can never manufacture a clean stop.
    const clean = orderly && this.ready && this.runGeneration !== undefined;
    this.admitted = false;
    const db = this.database;
    const native = this.native;
    const generation = this.runGeneration;
    this.runGeneration = undefined;
    this.continuationAdmissionStopped = false;
    try {
      if (clean && db && generation) {
        this.assert();
        const result = await db
          .updateTable("service_runs")
          .set({ clean_stop_at: new Date().toISOString() })
          .where("generation", "=", generation)
          .where("clean_stop_at", "is", null)
          .execute();
        if (result[0]?.numUpdatedRows !== 1n) throw new Error("Service run stop was not recorded.");
        this.researchDiagnostic({ event_name: "ohtia.service.stopped" });
      }
    } finally {
      this.database = undefined;
      this.native = undefined;
      this.openedFile = undefined;
      try {
        if (db) await db.destroy();
      } finally {
        // Kysely does not destroy a driver that never initialized through a query.
        if (native?.open) native.close();
      }
    }
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
      // Both recovery retry branches and ordinary admission use the same reserved review.
      // The old gate is retained until this transaction commits; healthy new upgrade intents
      // do not change the classification captured by retrySource.
      if (retrySource) await this.holdRecoveredTasks();
      else await this.reviewServiceRun(false);
      if (exists(this.gate)) {
        try {
          fs.unlinkSync(this.gate);
          syncDirectory(this.options.root);
        } catch (error) {
          throw new Error("Migration requires explicit recovery.", { cause: error });
        }
      }
      // Connection-local invalidation state starts at one. TEMP triggers participate in
      // the same transactions as task/pause changes, including rollback and coalescing.
      this.pauseRevision = 1;
      db.exec(`CREATE TEMP TABLE pause_counts_revision (revision INTEGER NOT NULL);
        INSERT INTO pause_counts_revision VALUES (1);
        CREATE TEMP TRIGGER pause_task_insert AFTER INSERT ON main.tasks
        WHEN NEW.state='blocked' AND NEW.blocking_reason IN ('usage_limit_reached','restart_paused')
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;
        CREATE TEMP TRIGGER pause_task_update AFTER UPDATE ON main.tasks
        WHEN (OLD.state='blocked' AND OLD.blocking_reason IN ('usage_limit_reached','restart_paused'))
          OR (NEW.state='blocked' AND NEW.blocking_reason IN ('usage_limit_reached','restart_paused'))
          OR (OLD.state='waiting_capacity' AND OLD.blocking_reason='restart_paused')
          OR (NEW.state='waiting_capacity' AND NEW.blocking_reason='restart_paused')
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;
        CREATE TEMP TRIGGER pause_contribution_update AFTER UPDATE OF restart_held,state ON main.contributions
        WHEN (OLD.restart_held=1 AND OLD.state='waiting')<>(NEW.restart_held=1 AND NEW.state='waiting')
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;
        CREATE TEMP TRIGGER pause_continuation_insert AFTER INSERT ON main.continuations WHEN NEW.restart_held=1
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;
        CREATE TEMP TRIGGER pause_continuation_update AFTER UPDATE OF restart_held ON main.continuations
        WHEN OLD.restart_held<>NEW.restart_held
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;
        CREATE TEMP TRIGGER pause_open AFTER INSERT ON main.usage_limit_pauses
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;
        CREATE TEMP TRIGGER pause_close AFTER UPDATE ON main.usage_limit_pauses
        BEGIN UPDATE pause_counts_revision SET revision=revision+1; END;`);
      this.initializationAllowed = false;
      this.admitted = true;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      this.active = false;
    }
  }
  private async holdRecoveredTasks(): Promise<void> {
    await this.reviewServiceRun(true);
  }
  private async reviewServiceRun(recovery: boolean): Promise<void> {
    if (!this.database) throw new Error("Missing recovery connection.");
    const generation = this.options.serviceGeneration ?? randomUUID();
    const diagnostics: DiagnosticEvent[] = [];
    await this.database.connection().execute(async (transaction) => {
      await sql`BEGIN IMMEDIATE`.execute(transaction);
      try {
        this.assert();
        const tasks = new TaskTransaction(transaction, this.taskContext);
        const previous = await transaction
          .selectFrom("service_runs")
          .selectAll()
          .orderBy(sql`rowid`, "desc")
          .executeTakeFirst();
        if (recovery) await tasks.recoverMigration();
        // Missing history cannot prove an orderly stop. This is distinct from the
        // fresh migration intent, which is not itself a pre-existing recovery gate.
        else await tasks.recoverRestart(!!previous?.clean_stop_at);
        await transaction
          .insertInto("service_runs")
          .values({
            generation,
            started_at: new Date().toISOString(),
            clean_stop_at: null,
          })
          .execute();
        await tasks.flush();
        diagnostics.push(...tasks.diagnostics);
        this.assert();
        await sql`COMMIT`.execute(transaction);
      } catch (error) {
        if (this.native?.inTransaction) await sql`ROLLBACK`.execute(transaction);
        throw error;
      }
    });
    this.runGeneration = generation;
    for (const event of diagnostics) this.researchDiagnostic(event);
    this.researchDiagnostic({ event_name: "ohtia.service.started" });
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
    const rebuildsTables = source < 24;
    const selected = this.database;
    if (!selected) throw new Error("Missing migration connection.");
    await selected.connection().execute(async (connection) => {
      let begun = false;
      let committed = false;
      try {
        this.assert();
        if (rebuildsTables) db.pragma("foreign_keys = OFF");
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
                "0003_locale_receipts": { up: localeReceipts },
                "0004_layout_receipts": { up: layoutReceipts },
                "0005_presentation_receipts": { up: presentationReceipts },
                "0006_window_bounds_receipts": { up: boundsReceipts },
                "0007_research_records": { up: researchRecords },
                "0008_durable_ai_tasks": { up: durableTasks },
                "0009_usage_limit_pauses": { up: usagePauses },
                "0010_reply_control": { up: replyControl },
                "0011_service_runs": { up: serviceRuns },
                "0012_application_exit": { up: applicationExit },
                "0013_execution_limits_receipts": { up: executionLimitsReceipts },
                "0014_message_composer": { up: composer },
                "0015_project_setup": { up: setup },
                "0016_task_notices": { up: taskNotices },
                "0017_project_opening": { up: projectOpening },
                "0018_conversation_titles": { up: conversationTitles },
                "0019_josefa_search_planning": { up: josefaSearchPlanning },
                "0020_conversation_agents": { up: conversationAgents },
                "0021_consultations": { up: consultations },
                "0022_contribution_graphs": { up: contributionGraphs },
                "0023_shared_work_limits": { up: sharedWorkLimits },
                "0024_plan_coordination": { up: planCoordination },
                "0025_contribution_synthesis": { up: contributionSynthesis },
                "0026_plan_proposals": { up: planProposals },
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
      } catch (error) {
        if (begun && !committed && db.inTransaction) {
          await sql`ROLLBACK`.execute(connection);
          if (compatibility(db, this.artifacts) !== source)
            throw new Error("Unverified migration rollback.");
        }
        // Keep intent and checkpoint on every failure, including a successful commit with a lost acknowledgement.
        throw new Error(`Migration requires explicit recovery (${operation}).`, { cause: error });
      } finally {
        if (rebuildsTables) db.pragma("foreign_keys = ON");
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
    if (revision === 0) this.initializationAllowed = true;
    // The validated pre-existing gate remains durable until the recovery holds commit.
    await this.openDatabase(true);
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
  private async limitsRecord(db: Kysely<Schema>): Promise<ExecutionLimitsRecord> {
    const row = await db
      .selectFrom("application_preferences")
      .selectAll()
      .where("key", "=", "execution_limits")
      .executeTakeFirstOrThrow();
    const value = JSON.parse(row.value) as { max_concurrent_inference?: unknown };
    if (
      row.schema_version !== 1 ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !isInferenceLimit(value.max_concurrent_inference)
    )
      throw new Error("Invalid execution limits preference.");
    const running = await new TaskTransaction(db, this.taskContext).runningCount();
    return {
      serviceGeneration: this.taskContext.generation,
      revision: row.revision,
      max_concurrent_inference: value.max_concurrent_inference,
      running,
    };
  }
  private limitsDiagnostic(
    operation: "read" | "replace" | "receipt",
    outcome: Outcome<unknown>,
  ): void {
    this.researchDiagnostic(
      outcome.ok
        ? {
            event_name:
              operation === "read"
                ? "ohtia.limits.read"
                : operation === "replace"
                  ? "ohtia.limits.replaced"
                  : "ohtia.limits.receipt_read",
          }
        : {
            event_name: "ohtia.limits.failed",
            error_code:
              diagnosticCatalog["ohtia.limits.failed"].errors.find(
                (code) => code === outcome.error.code,
              ) ?? "storage_failed",
          },
    );
  }
  async readExecutionLimits(): Promise<Outcome<ExecutionLimitsRecord>> {
    const result = await this.researchRead(
      async (db) => ({ ok: true, value: await this.limitsRecord(db) }),
      undefined,
      false,
    );
    this.limitsDiagnostic("read", result);
    return result;
  }
  async readExecutionLimitsReceipt(operationId: string): Promise<Outcome<ExecutionLimitsReceipt>> {
    const result = !isIdentifier(operationId)
      ? failure("invalid_message")
      : await this.researchRead<ExecutionLimitsReceipt>(
          async (db) => {
            const row = await db
              .selectFrom("execution_limits_receipts")
              .selectAll()
              .where("operation_id", "=", operationId)
              .executeTakeFirst();
            if (!row) return { ok: true, value: { state: "not_found" } };
            const current = await this.limitsRecord(db);
            return {
              ok: true,
              value: {
                state: "recorded",
                outcome: {
                  ok: true,
                  value: {
                    ...current,
                    revision: row.result_revision,
                    max_concurrent_inference: row.value,
                  },
                },
              },
            };
          },
          undefined,
          false,
        );
    this.limitsDiagnostic("receipt", result);
    return result;
  }
  async replaceExecutionLimits(
    raw: ExecutionLimitsChange,
  ): Promise<Outcome<ExecutionLimitsRecord>> {
    const decoded = decodeExecutionLimitsChange(raw);
    if (!decoded.ok) {
      this.limitsDiagnostic("replace", decoded);
      return decoded;
    }
    if (!this.ready || !this.database) {
      const result = failure(this.active ? "busy" : "service_unavailable");
      this.limitsDiagnostic("replace", result);
      return result;
    }
    this.active = true;
    let commitAttempted = false;
    const attempted = () => commitAttempted;
    let outcome: Outcome<ExecutionLimitsRecord>;
    try {
      this.assert();
      const value = await this.database.connection().execute(async (db) => {
        await sql`BEGIN IMMEDIATE`.execute(db);
        try {
          const command = decoded.value;
          const receipt = await db
            .selectFrom("execution_limits_receipts")
            .selectAll()
            .where("operation_id", "=", command.operationId)
            .executeTakeFirst();
          const current = await this.limitsRecord(db);
          if (receipt) {
            await sql`ROLLBACK`.execute(db);
            return receipt.value === command.value
              ? {
                  ok: true as const,
                  value: {
                    ...current,
                    revision: receipt.result_revision,
                    max_concurrent_inference: receipt.value,
                  },
                }
              : failure("operation_conflict");
          }
          if (current.revision >= Number.MAX_SAFE_INTEGER) {
            await sql`ROLLBACK`.execute(db);
            return failure("preference_invalid");
          }
          const next = {
            ...current,
            revision: current.revision + 1,
            max_concurrent_inference: command.value,
          };
          // Update only inference; preserve the local-processing value and all other preference records.
          await sql`UPDATE application_preferences SET value=json_set(value,'$.max_concurrent_inference',${command.value}), revision=${next.revision} WHERE key='execution_limits'`.execute(
            db,
          );
          await db
            .insertInto("execution_limits_receipts")
            .values({
              operation_id: command.operationId,
              value: command.value,
              result_revision: next.revision,
            })
            .execute();
          this.assert();
          commitAttempted = true;
          await sql`COMMIT`.execute(db);
          return { ok: true as const, value: next };
        } catch (error) {
          if (this.native?.inTransaction) {
            try {
              await sql`ROLLBACK`.execute(db);
            } catch {
              this.admitted = false;
            }
          }
          throw error;
        }
      });
      outcome = value;
    } catch {
      try {
        this.assert();
      } catch {
        this.admitted = false;
      }
      if (attempted()) this.admitted = false;
      outcome = failure(attempted() ? "uncertain" : "storage_failed");
    } finally {
      this.active = false;
    }
    this.limitsDiagnostic("replace", outcome);
    return outcome;
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
      command.expectedRevision < 0 ||
      command.expectedRevision >= Number.MAX_SAFE_INTEGER
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
  async readLocale(): Promise<Outcome<LocaleRecord>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    try {
      this.assert();
      return this.locale(
        await this.database
          .selectFrom("application_preferences")
          .selectAll()
          .where("key", "=", "interface_locale")
          .executeTakeFirst(),
      );
    } catch {
      this.admitted = false;
      return failure("storage_failed");
    }
  }
  private locale(row: Preferences | undefined): Outcome<LocaleRecord> {
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
        value: row.schema_version === 1 && isLocaleChoice(value) ? value : "system",
        source: row.schema_version === 1 && isLocaleChoice(value) ? "saved" : "invalid_fallback",
      },
    };
  }
  private localeReceipt(row: LocaleReceiptRow | undefined): RecordedLocaleCommand | undefined {
    if (!row) return;
    if (
      !isIdentifier(row.operation_id) ||
      !isLocaleChoice(row.value) ||
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
  async readLocaleReceipt(operation: string): Promise<Outcome<LocaleReceipt>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    if (!isIdentifier(operation)) return failure("invalid_message");
    try {
      this.assert();
      const result = this.localeReceipt(
        await this.database
          .selectFrom("locale_receipts")
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
  async replaceLocale(command: LocaleCommand): Promise<Outcome<SavedLocaleRecord>> {
    if (!this.ready || !this.database) return failure(this.active ? "busy" : "service_unavailable");
    if (
      !isIdentifier(command.operationId) ||
      !isLocaleChoice(command.value) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0 ||
      command.expectedRevision >= Number.MAX_SAFE_INTEGER
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
          const receipt = this.localeReceipt(
            await transaction
              .selectFrom("locale_receipts")
              .selectAll()
              .where("operation_id", "=", command.operationId)
              .executeTakeFirst(),
          );
          const locale = this.locale(
            await transaction
              .selectFrom("application_preferences")
              .selectAll()
              .where("key", "=", "interface_locale")
              .executeTakeFirst(),
          );
          let replaced: SavedLocaleRecord | undefined;
          let recorded: RecordedLocaleCommand | undefined;
          const result = applyLocaleCommand(
            {
              readReceipt: () => receipt,
              readLocale: () => locale,
              replaceLocale: (value) => {
                replaced = {
                  schemaVersion: 1,
                  revision: command.expectedRevision + 1,
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
                key: "interface_locale",
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
              .insertInto("locale_receipts")
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
    const current = await this.readLocale();
    if (!current.ok) {
      if (current.error.code === "preference_invalid") return { invalid: true };
      throw new Error("Locale read lost storage admission.");
    }
    const { value, source } = current.value;
    return {
      ...(isInterfaceLocale(value) ? { choice: value } : {}),
      invalid: source === "invalid_fallback",
    };
  }
  private layout(row: Preferences | undefined): Outcome<LayoutRecord> {
    if (!row)
      return { ok: true, value: { schemaVersion: 1, revision: 0, value: null, source: "default" } };
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      return failure("preference_invalid");
    let value: unknown;
    try {
      if (row.value.length <= 1024) value = JSON.parse(row.value);
    } catch {
      /* Preserve rejected bytes. */
    }
    const valid = row.schema_version === 1 && isWorkspaceLayout(value);
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        revision: row.revision,
        value: row.schema_version === 1 && isWorkspaceLayout(value) ? value : null,
        source: valid ? "saved" : "invalid_fallback",
      },
    };
  }
  async readLayout(): Promise<Outcome<LayoutRecord>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    try {
      this.assert();
      return this.layout(
        await this.database
          .selectFrom("application_preferences")
          .selectAll()
          .where("key", "=", "workspace_layout")
          .executeTakeFirst(),
      );
    } catch {
      return failure("storage_failed");
    }
  }
  private layoutReceipt(row: LayoutReceiptRow | undefined): RecordedLayoutCommand | undefined {
    if (!row) return;
    const value: unknown = JSON.parse(row.value);
    if (
      !isWorkspaceLayout(value) ||
      !isIdentifier(row.operation_id) ||
      ![0, 1].includes(row.accepted) ||
      !Number.isSafeInteger(row.expected_revision) ||
      row.expected_revision < 0 ||
      !Number.isSafeInteger(row.result_revision) ||
      row.result_revision < 0 ||
      (row.accepted
        ? row.result_revision !== row.expected_revision + 1
        : row.result_revision === row.expected_revision)
    )
      throw new Error("Invalid layout receipt.");
    return {
      expectedRevision: row.expected_revision,
      value,
      outcome: row.accepted
        ? {
            ok: true,
            value: { schemaVersion: 1, revision: row.result_revision, value, source: "saved" },
          }
        : staleRevision(row.result_revision),
    };
  }
  async readLayoutReceipt(operation: string): Promise<Outcome<LayoutReceipt>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    if (!isIdentifier(operation)) return failure("invalid_message");
    try {
      this.assert();
      const result = this.layoutReceipt(
        await this.database
          .selectFrom("layout_receipts")
          .selectAll()
          .where("operation_id", "=", operation)
          .executeTakeFirst(),
      );
      return {
        ok: true,
        value: result ? { state: "recorded", outcome: result.outcome } : { state: "not_found" },
      };
    } catch {
      return failure("storage_failed");
    }
  }
  async replaceLayout(command: LayoutChange): Promise<Outcome<SavedLayoutRecord>> {
    if (!this.ready || !this.database) return failure(this.active ? "busy" : "service_unavailable");
    const decoded = decodeLayoutChange(command);
    if (!decoded.ok) return decoded;
    command = decoded.value;
    this.active = true;
    let commitAttempted = false;
    const attempted = () => commitAttempted;
    try {
      this.assert();
      return await this.database.connection().execute(async (transaction) => {
        await sql`BEGIN IMMEDIATE`.execute(transaction);
        try {
          const receipt = this.layoutReceipt(
            await transaction
              .selectFrom("layout_receipts")
              .selectAll()
              .where("operation_id", "=", command.operationId)
              .executeTakeFirst(),
          );
          const layout = this.layout(
            await transaction
              .selectFrom("application_preferences")
              .selectAll()
              .where("key", "=", "workspace_layout")
              .executeTakeFirst(),
          );
          let replaced: SavedLayoutRecord | undefined;
          let recorded: RecordedLayoutCommand | undefined;
          const result = applyLayoutCommand(
            {
              readReceipt: () => receipt,
              readLayout: () => layout,
              replaceLayout: (value) => {
                if (!layout.ok || layout.value.revision >= Number.MAX_SAFE_INTEGER)
                  throw new Error("Revision exhausted.");
                replaced = {
                  schemaVersion: 1,
                  revision: layout.value.revision + 1,
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
                key: "workspace_layout",
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
              .insertInto("layout_receipts")
              .values({
                operation_id: command.operationId,
                expected_revision: command.expectedRevision,
                value: JSON.stringify(command.value),
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
  private presentationRecord<K extends PresentationFeature>(
    feature: K,
    row: Preferences | undefined,
  ): Outcome<PresentationRecord<PresentationValues[K]>> {
    const initial = (feature === "character" ? "animated" : 100) as PresentationValues[K];
    const fallback = (feature === "character" ? "static" : 100) as PresentationValues[K];
    if (!row)
      return {
        ok: true,
        value: { schemaVersion: 1, revision: 0, value: initial, source: "default" },
      };
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      return failure("preference_invalid");
    let value: unknown;
    try {
      if (row.value.length <= 128) value = JSON.parse(row.value);
    } catch {
      /* Retain rejected evidence. */
    }
    const valid =
      row.schema_version === 1 &&
      (feature === "character" ? isCharacterPresentation(value) : isInterfaceZoom(value));
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        revision: row.revision,
        value: valid ? (value as PresentationValues[K]) : fallback,
        source: valid ? "saved" : "invalid_fallback",
      },
    };
  }
  async readPresentationPreference<K extends PresentationFeature>(
    feature: K,
  ): Promise<Outcome<PresentationRecord<PresentationValues[K]>>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    try {
      this.assert();
      return this.presentationRecord(
        feature,
        await this.database
          .selectFrom("application_preferences")
          .selectAll()
          .where("key", "=", feature === "character" ? "character_presentation" : "interface_zoom")
          .executeTakeFirst(),
      );
    } catch {
      return failure("storage_failed");
    }
  }
  private presentationReceipt<K extends PresentationFeature>(
    feature: K,
    row: PresentationReceiptRow | undefined,
  ):
    | {
        expectedRevision: number;
        value: PresentationValues[K];
        intent: ZoomIntent | null;
        outcome: Extract<
          PresentationReceipt<PresentationValues[K]>,
          { state: "recorded" }
        >["outcome"];
      }
    | undefined {
    if (!row) return;
    const value: unknown = JSON.parse(row.value);
    const boundary = row.error_code !== null;
    if (
      row.feature !== feature ||
      !(feature === "character" ? isCharacterPresentation(value) : isInterfaceZoom(value)) ||
      !isIdentifier(row.operation_id) ||
      ![0, 1].includes(row.accepted) ||
      !Number.isSafeInteger(row.expected_revision) ||
      row.expected_revision < 0 ||
      row.expected_revision >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(row.result_revision) ||
      row.result_revision < 0 ||
      (boundary &&
        (feature !== "zoom" || !isZoomBoundaryError(row.error_code) || row.intent === null)) ||
      (row.accepted
        ? boundary || row.result_revision !== row.expected_revision + 1
        : boundary
          ? row.result_revision !== row.expected_revision
          : row.result_revision === row.expected_revision)
    )
      throw new Error("Invalid presentation receipt.");
    const outcome = row.accepted
      ? {
          ok: true as const,
          value: {
            schemaVersion: 1 as const,
            revision: row.result_revision,
            value: value as PresentationValues[K],
            source: "saved" as const,
          },
        }
      : row.error_code
        ? failure(row.error_code)
        : staleRevision(row.result_revision);
    // The row checks above prove the feature-specific persisted outcome, including terminal zoom refusals.
    return {
      expectedRevision: row.expected_revision,
      value: value as PresentationValues[K],
      intent: row.intent,
      outcome: outcome as Extract<
        PresentationReceipt<PresentationValues[K]>,
        { state: "recorded" }
      >["outcome"],
    };
  }

  async readPresentationReceipt<K extends PresentationFeature>(
    feature: K,
    operation: string,
  ): Promise<Outcome<PresentationReceipt<PresentationValues[K]>>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    if (!isIdentifier(operation)) return failure("invalid_message");
    try {
      this.assert();
      const receipt = this.presentationReceipt(
        feature,
        await this.database
          .selectFrom("presentation_receipts")
          .selectAll()
          .where("feature", "=", feature)
          .where("operation_id", "=", operation)
          .executeTakeFirst(),
      );
      return {
        ok: true,
        value: receipt ? { state: "recorded", outcome: receipt.outcome } : { state: "not_found" },
      };
    } catch {
      return failure("storage_failed");
    }
  }
  async replacePresentationPreference<K extends PresentationFeature>(
    feature: K,
    command: PresentationChange<PresentationValues[K]>,
    intent: ZoomIntent | null = null,
  ): Promise<Outcome<SavedPresentationRecord<PresentationValues[K]>>> {
    if (!this.ready || !this.database) return failure(this.active ? "busy" : "service_unavailable");
    if (
      (feature !== "character" && feature !== "zoom") ||
      (intent !== null &&
        (feature !== "zoom" || !["increase", "decrease", "reset"].includes(intent)))
    )
      return failure("invalid_message");
    const decoded = decodePresentationChange(feature, command);
    if (!decoded.ok) return decoded;
    command = decoded.value as PresentationChange<PresentationValues[K]>;
    this.active = true;
    let commitAttempted = false;
    const attempted = () => commitAttempted;
    try {
      this.assert();
      return await this.database.connection().execute(async (transaction) => {
        await sql`BEGIN IMMEDIATE`.execute(transaction);
        try {
          const receipt = this.presentationReceipt(
            feature,
            await transaction
              .selectFrom("presentation_receipts")
              .selectAll()
              .where("feature", "=", feature)
              .where("operation_id", "=", command.operationId)
              .executeTakeFirst(),
          );
          const key = feature === "character" ? "character_presentation" : "interface_zoom";
          const current = this.presentationRecord(
            feature,
            await transaction
              .selectFrom("application_preferences")
              .selectAll()
              .where("key", "=", key)
              .executeTakeFirst(),
          );
          let outcome: Outcome<SavedPresentationRecord<PresentationValues[K]>>;
          if (receipt)
            outcome = (
              intent !== null
                ? receipt.intent === intent
                : receipt.intent === null &&
                  receipt.expectedRevision === command.expectedRevision &&
                  receipt.value === command.value
            )
              ? receipt.outcome
              : failure("operation_conflict");
          else if (!current.ok) outcome = current;
          else if (current.value.revision !== command.expectedRevision)
            outcome = staleRevision(current.value.revision);
          else if (
            intent !== null &&
            command.value !== nextInterfaceZoom(current.value.value as InterfaceZoom, intent)
          )
            outcome = failure("invalid_message");
          else if (intent !== null && current.value.value === command.value)
            outcome = failure(
              intent === "reset"
                ? "actual_size"
                : intent === "increase"
                  ? "zoom_maximum"
                  : "zoom_minimum",
            );
          else
            outcome = {
              ok: true,
              value: {
                schemaVersion: 1,
                revision: command.expectedRevision + 1,
                value: command.value,
                source: "saved",
              },
            };
          if (
            !receipt &&
            current.ok &&
            (outcome.ok ||
              outcome.error.code === "stale_revision" ||
              isZoomBoundaryError(outcome.error.code))
          ) {
            if (outcome.ok) {
              const row = {
                key,
                schema_version: 1,
                revision: outcome.value.revision,
                value: JSON.stringify(command.value),
              };
              await transaction
                .insertInto("application_preferences")
                .values(row)
                .onConflict((conflict) => conflict.column("key").doUpdateSet(row))
                .execute();
            }
            await transaction
              .insertInto("presentation_receipts")
              .values({
                feature,
                intent,
                error_code:
                  !outcome.ok && isZoomBoundaryError(outcome.error.code)
                    ? outcome.error.code
                    : null,
                operation_id: command.operationId,
                expected_revision: command.expectedRevision,
                value: JSON.stringify(command.value),
                accepted: outcome.ok ? 1 : 0,
                result_revision: outcome.ok ? outcome.value.revision : current.value.revision,
              })
              .execute();
          }
          this.assert();
          commitAttempted = true;
          await sql`COMMIT`.execute(transaction);
          return outcome;
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

  emitWakeDiagnostic(): void {
    this.researchDiagnostic({ event_name: "ohtia.service.woke" });
  }
  private researchDiagnostic(event: DiagnosticEvent): void {
    try {
      this.options.emitDiagnostic?.(event);
    } catch {
      /* Diagnostic delivery cannot change a durable outcome. */
    }
  }
  reportResearchPort(
    operation: ResearchOperation,
    outcome: Outcome<unknown>,
    failureRecorded = false,
  ): void {
    if (!outcome.ok) {
      if (!failureRecorded) this.researchFailure(outcome.error.code);
      return;
    }
    const events = {
      "project.list": "ohtia.project.listed",
      "conversation.list": "ohtia.conversation.listed",
      "research.subscribe": "ohtia.research.subscribed",
      "text.part": "ohtia.text.staged",
      "text.readPart": "ohtia.text.read",
      "reply.readParts": "ohtia.reply.read",
      "timeline.listBefore": "ohtia.timeline.listed",
      "timeline.read": "ohtia.timeline.read",
      "conversation.read": "ohtia.conversation.read",
      "destination.read": "ohtia.destination.read",
      "pause.read": "ohtia.pause.read",
      "plan.read": "ohtia.plan.read",
      "planEvent.list": "ohtia.plan.events_listed",
    } as const;
    if (Object.hasOwn(events, operation))
      this.researchDiagnostic({ event_name: events[operation as keyof typeof events] });
  }
  private researchFailure(code: ErrorCode): void {
    if (code === "uncertain") {
      this.researchDiagnostic({ event_name: "ohtia.research.uncertain", error_code: code });
      return;
    }
    const error =
      diagnosticCatalog["ohtia.research.failed"].errors.find((item) => item === code) ??
      "storage_failed";
    this.researchDiagnostic({ event_name: "ohtia.research.failed", error_code: error });
  }
  /** Retry a locked COMMIT on the same transaction while SQLite confirms it is still active. */
  private async commitResearch(transaction: Kysely<Schema>): Promise<void> {
    const deadline = performance.now() + 250;
    for (;;) {
      try {
        await sql`COMMIT`.execute(transaction);
        return;
      } catch (error) {
        const remaining = deadline - performance.now();
        if (
          !(error instanceof Database.SqliteError) ||
          error.code !== "SQLITE_BUSY" ||
          !this.native?.inTransaction ||
          remaining <= 0
        )
          throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10, remaining)));
        if (performance.now() >= deadline) throw error;
        this.assert();
      }
    }
  }
  async executeResearchCommand(
    command: ResearchCommand,
    payloadHash?: string,
  ): Promise<Outcome<ResearchResult>> {
    if (!this.ready || !this.database) {
      const code = this.active ? "busy" : "service_unavailable";
      this.researchFailure(code);
      return failure(code);
    }
    this.active = true;
    let commitAttempted = false;
    const diagnostics: DiagnosticEvent[] = [];
    let outcome: Outcome<ResearchResult>;
    const attempted = () => commitAttempted;
    try {
      this.assert();
      outcome = await this.database.connection().execute(async (transaction) => {
        await sql`BEGIN IMMEDIATE`.execute(transaction);
        try {
          const tasks = new TaskTransaction(
            transaction,
            this.taskContext,
            undefined,
            this.continuationAdmissionStopped,
          );
          const result = await applyResearchCommand(
            transaction,
            command,
            () => {
              this.languageRegistry ??= new LanguageRegistry(
                this.options.languageRegistry ??
                  new URL("./iana-language-subtag-registry.txt", import.meta.url),
              );
              return this.languageRegistry;
            },
            tasks,
            payloadHash,
          );
          this.assert();
          if (
            !result.ok &&
            !(result.error.code === "record_not_found" && command.command === "project.open")
          ) {
            await sql`ROLLBACK`.execute(transaction);
            return result;
          }
          await tasks.flush();
          diagnostics.push(...tasks.diagnostics);
          commitAttempted = true;
          await this.commitResearch(transaction);
          this.continuationAdmissionStopped = tasks.continuationAdmissionStopped;
          this.notifyPauseCounts();
          for (const connection of tasks.modelRefreshes)
            this.taskContext.requestModelRefresh?.(connection);
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
      outcome = failure(attempted() ? "uncertain" : "storage_failed");
    } finally {
      this.active = false;
    }
    if (outcome.ok) {
      for (const event of diagnostics) this.researchDiagnostic(event);
      const events = {
        "development.createProject": { event_name: "ohtia.project.created" },
        "development.sendToJosefa": { event_name: "ohtia.development.josefa_message_appended" },
        "project.create": { event_name: "ohtia.project.created" },
        "project.open": { event_name: "ohtia.project.opened" },
        "project.confirmSetup": { event_name: "ohtia.project.setup_confirmed" },
        "project.rejectSetup": { event_name: "ohtia.project.setup_rejected" },
        "conversation.start": { event_name: "ohtia.conversation.started" },
        "conversation.rename": { event_name: "ohtia.conversation.renamed" },
        "message.append": { event_name: "ohtia.message.appended" },
        "task.stop": { event_name: "ohtia.task.stop_requested" },
        "conversation.stop": { event_name: "ohtia.conversation.stop_requested" },
        "task.startAgain": { event_name: "ohtia.task.replaced" },
        "task.tryAgain": { event_name: "ohtia.task.retry_requested" },
        "synthesis.tryAgain": { event_name: "ohtia.synthesis.retry_requested" },
        "development.runPlan": { event_name: "ohtia.development.plan_started" },
        "plan.addContributions": { event_name: "ohtia.plan.graph_recorded" },
        "plan.accept": { event_name: "ohtia.plan.accepted" },
        "plan.decline": { event_name: "ohtia.plan.declined" },
        "plan.finish": { event_name: "ohtia.plan.finished" },
        "plan.cancel": { event_name: "ohtia.plan.cancel_requested" },
        "consultation.accept": { event_name: "ohtia.consultation.accepted" },
        "consultation.decline": { event_name: "ohtia.consultation.declined" },
        "contribution.tryAgain": { event_name: "ohtia.contribution.retry_requested" },
        "contribution.startAgain": { event_name: "ohtia.contribution.restarted" },
        "task.continueAll": { event_name: "ohtia.task.continue_requested" },
        "task.cancelAll": { event_name: "ohtia.task.cancel_all_requested" },
        "usagePause.resume": { event_name: "ohtia.usage_pause.resume_requested" },
      } as const;
      this.researchDiagnostic(events[command.command]);
    } else {
      this.researchFailure(outcome.error.code);
    }
    return outcome;
  }
  private async taskTransaction<T>(
    operation: (tasks: TaskTransaction) => Promise<T>,
  ): Promise<Outcome<T>> {
    if (!this.ready || !this.database) return failure(this.active ? "busy" : "service_unavailable");
    this.active = true;
    let commitAttempted = false;
    const attempted = () => commitAttempted;
    const diagnostics: DiagnosticEvent[] = [];
    try {
      this.assert();
      const value = await this.database.connection().execute(async (transaction) => {
        await sql`BEGIN IMMEDIATE`.execute(transaction);
        try {
          const tasks = new TaskTransaction(
            transaction,
            this.taskContext,
            undefined,
            this.continuationAdmissionStopped,
          );
          const result = await operation(tasks);
          await tasks.flush();
          diagnostics.push(...tasks.diagnostics);
          this.assert();
          commitAttempted = true;
          await this.commitResearch(transaction);
          this.notifyPauseCounts();
          return result;
        } catch (error) {
          if (this.native?.inTransaction) await sql`ROLLBACK`.execute(transaction);
          throw error;
        }
      });
      for (const event of diagnostics) this.researchDiagnostic(event);
      return { ok: true, value };
    } catch {
      if (attempted()) this.admitted = false;
      return failure(attempted() ? "uncertain" : "storage_failed");
    } finally {
      this.active = false;
    }
  }
  runningTaskCount(): Promise<Outcome<number>> {
    return this.taskTransaction((tasks) => tasks.runningCount());
  }
  stoppingAttempts(): Promise<Outcome<readonly string[]>> {
    return this.taskTransaction((tasks) => tasks.stoppingAttempts());
  }
  reconcileTaskConnections(): Promise<Outcome<void>> {
    return this.taskTransaction((tasks) => tasks.reconcileConnections());
  }
  async prepareTask(): Promise<Outcome<PreparedTask | null>> {
    // Readmission and dispatch are separate commits: each advances its task revision once.
    const reconciled = await this.reconcileTaskConnections();
    if (!reconciled.ok) return reconciled;
    return this.taskTransaction((tasks) => tasks.prepareNext());
  }
  private registry(): LanguageRegistry {
    this.languageRegistry ??= new LanguageRegistry(
      this.options.languageRegistry ??
        new URL("./iana-language-subtag-registry.txt", import.meta.url),
    );
    return this.languageRegistry;
  }
  recordTaskEvent(
    attempt: string,
    event: ProviderEvent,
    text: string,
    calls: readonly import("@ohtia/contracts").ProviderToolCall[] = [],
    work?: import("@ohtia/contracts").ProviderWorkUsage,
  ): Promise<Outcome<RecordedTaskEvent>> {
    return this.taskTransaction((tasks) =>
      tasks.event(attempt, event, text, calls, () => this.registry(), work),
    );
  }

  private async researchRead<T>(
    query: (db: Kysely<Schema>) => Promise<Outcome<T>>,
    event?: "ohtia.project.listed" | "ohtia.conversation.listed" | "ohtia.message.listed",
    diagnoseFailure = true,
  ): Promise<Outcome<T>> {
    if (!this.ready || !this.database) {
      const code = this.active ? "busy" : "service_unavailable";
      if (diagnoseFailure) this.researchFailure(code);
      return failure(code);
    }
    this.active = true;
    let outcome: Outcome<T>;
    try {
      this.assert();
      // Keep existence and row reads in one snapshot, owned by the same data-service boundary.
      outcome = await this.database.transaction().execute(query);
      this.assert();
    } catch {
      outcome = failure("storage_failed");
    } finally {
      this.active = false;
    }
    if (outcome.ok) {
      if (event) this.researchDiagnostic({ event_name: event });
    } else if (diagnoseFailure) this.researchFailure(outcome.error.code);
    return outcome;
  }
  private readonly pauseObservers = new Set<(revision: number) => void>();
  private pauseRevision = 1;
  observePauseCounts(listener: (revision: number) => void): () => void {
    this.pauseObservers.add(listener);
    return () => {
      this.pauseObservers.delete(listener);
    };
  }
  private notifyPauseCounts(): void {
    const row = this.native?.prepare("SELECT revision FROM pause_counts_revision").get() as
      { revision: number } | undefined;
    if (!row || row.revision === this.pauseRevision) return;
    this.pauseRevision = row.revision;
    for (const observer of this.pauseObservers) {
      try {
        observer(row.revision);
      } catch {
        /* An observer cannot change a committed result. */
      }
    }
  }
  readPauses(): Promise<Outcome<import("@ohtia/contracts").PauseCounts>> {
    return this.researchRead(async (db) => ({ ok: true, value: await readPauseCounts(db) }));
  }
  readResearch(request: Request): Promise<Outcome<unknown>> {
    return this.researchRead((db) => readResearch(db, request, this.taskContext), undefined, false);
  }
  researchRevisions(
    scope: ResearchScope,
    diagnoseFailure = true,
  ): Promise<Outcome<readonly Extract<ResearchEvent, { kind: "changed" | "planChanged" }>[]>> {
    return this.researchRead(
      async (db) => {
        if (
          scope.projectId &&
          !(await db
            .selectFrom("projects")
            .select("id")
            .where("id", "=", bytes(scope.projectId))
            .executeTakeFirst())
        )
          return failure("record_not_found");
        if (scope.conversationId) {
          const row = await db
            .selectFrom("conversations")
            .select("project_id")
            .where("id", "=", bytes(scope.conversationId))
            .executeTakeFirst();
          if (!row || identifier(row.project_id) !== scope.projectId)
            return failure("record_not_found");
        }
        return { ok: true, value: await researchRevisions(db, scope) };
      },
      undefined,
      diagnoseFailure,
    );
  }
  researchTaskExists(taskId: string): Promise<Outcome<boolean>> {
    return this.researchRead(
      async (db) => ({
        ok: true,
        value: !!(await db
          .selectFrom("tasks")
          .select("id")
          .where("id", "=", bytes(taskId))
          .where("kind", "!=", "contribution")
          .executeTakeFirst()),
      }),
      undefined,
      false,
    );
  }
  async readResearchReceipt(
    operationId: string,
    command: string,
    payloadHash: string,
  ): Promise<Outcome<ResearchResult | null>> {
    return this.researchRead(
      async (db) => {
        const row = await db
          .selectFrom("command_receipts")
          .selectAll()
          .where("operation_id", "=", operationId)
          .executeTakeFirst();
        if (!row) return { ok: true, value: null };
        return row.command === command &&
          Buffer.from(row.payload_sha256).toString("hex") === payloadHash
          ? row.error_code
            ? failure(row.error_code)
            : { ok: true, value: await researchReceiptResult(db, row) }
          : failure("operation_conflict");
      },
      undefined,
      false,
    );
  }
  readProjects(): Promise<Outcome<readonly ProjectRecord[]>> {
    return this.researchRead(listProjects, "ohtia.project.listed");
  }
  readConversations(projectId: string): Promise<Outcome<readonly ConversationRecord[]>> {
    return this.researchRead((db) => listConversations(db, projectId), "ohtia.conversation.listed");
  }
  readMessages(
    conversationId: string,
    fromPosition = 1,
  ): Promise<Outcome<readonly MessageRecord[]>> {
    return this.researchRead(
      (db) => listMessages(db, conversationId, fromPosition),
      "ohtia.message.listed",
    );
  }

  private bounds(row: Preferences | undefined): Outcome<WindowBoundsRecord> {
    if (!row)
      return { ok: true, value: { schemaVersion: 1, revision: 0, value: null, source: "default" } };
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      return failure("preference_invalid");
    let value: unknown;
    try {
      if (row.value.length <= 1024) value = JSON.parse(row.value);
    } catch {
      /* Preserve rejected bytes. */
    }
    const valid = row.schema_version === 1 && isWindowBounds(value);
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        revision: row.revision,
        value: row.schema_version === 1 && isWindowBounds(value) ? value : null,
        source: valid ? "saved" : "invalid_fallback",
      },
    };
  }
  async readWindowBounds(): Promise<Outcome<WindowBoundsRecord>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    try {
      this.assert();
      return this.bounds(
        await this.database
          .selectFrom("application_preferences")
          .selectAll()
          .where("key", "=", "window_bounds")
          .executeTakeFirst(),
      );
    } catch {
      return failure("storage_failed");
    }
  }
  private boundsReceipt(
    row: LayoutReceiptRow | undefined,
  ): RecordedWindowBoundsCommand | undefined {
    if (!row) return;
    const value: unknown = JSON.parse(row.value);
    if (
      !isWindowBounds(value) ||
      !isIdentifier(row.operation_id) ||
      ![0, 1].includes(row.accepted) ||
      !Number.isSafeInteger(row.expected_revision) ||
      row.expected_revision < 0 ||
      !Number.isSafeInteger(row.result_revision) ||
      row.result_revision < 0 ||
      (row.accepted
        ? row.result_revision !== row.expected_revision + 1
        : row.result_revision === row.expected_revision)
    )
      throw new Error("Invalid window bounds receipt.");
    return {
      expectedRevision: row.expected_revision,
      value,
      outcome: row.accepted
        ? {
            ok: true,
            value: { schemaVersion: 1, revision: row.result_revision, value, source: "saved" },
          }
        : staleRevision(row.result_revision),
    };
  }
  async readWindowBoundsReceipt(operation: string): Promise<Outcome<WindowBoundsReceipt>> {
    if (!this.ready || !this.database) return failure("service_unavailable");
    if (!isIdentifier(operation)) return failure("invalid_message");
    try {
      this.assert();
      const result = this.boundsReceipt(
        await this.database
          .selectFrom("window_bounds_receipts")
          .selectAll()
          .where("operation_id", "=", operation)
          .executeTakeFirst(),
      );
      return {
        ok: true,
        value: result ? { state: "recorded", outcome: result.outcome } : { state: "not_found" },
      };
    } catch {
      return failure("storage_failed");
    }
  }
  async replaceWindowBounds(
    command: WindowBoundsChange,
  ): Promise<Outcome<SavedWindowBoundsRecord>> {
    if (!this.ready || !this.database) return failure(this.active ? "busy" : "service_unavailable");
    const decoded = decodeWindowBoundsChange(command);
    if (!decoded.ok) return decoded;
    command = decoded.value;
    this.active = true;
    let commitAttempted = false;
    const attempted = () => commitAttempted;
    try {
      this.assert();
      return await this.database.connection().execute(async (transaction) => {
        await sql`BEGIN IMMEDIATE`.execute(transaction);
        try {
          const receipt = this.boundsReceipt(
            await transaction
              .selectFrom("window_bounds_receipts")
              .selectAll()
              .where("operation_id", "=", command.operationId)
              .executeTakeFirst(),
          );
          const layout = this.bounds(
            await transaction
              .selectFrom("application_preferences")
              .selectAll()
              .where("key", "=", "window_bounds")
              .executeTakeFirst(),
          );
          let replaced: SavedWindowBoundsRecord | undefined;
          let recorded: RecordedWindowBoundsCommand | undefined;
          const result = applyWindowBoundsCommand(
            {
              readReceipt: () => receipt,
              readWindowBounds: () => layout,
              replaceWindowBounds: (value) => {
                if (!layout.ok || layout.value.revision >= Number.MAX_SAFE_INTEGER)
                  throw new Error("Revision exhausted.");
                replaced = {
                  schemaVersion: 1,
                  revision: layout.value.revision + 1,
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
                key: "window_bounds",
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
              .insertInto("window_bounds_receipts")
              .values({
                operation_id: command.operationId,
                expected_revision: command.expectedRevision,
                value: JSON.stringify(command.value),
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
}
