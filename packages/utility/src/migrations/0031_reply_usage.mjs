import { sql } from "kysely";
import { synthesisTables as previous } from "./0025_contribution_synthesis.mjs";
import { objects as work } from "./0023_shared_work_limits.mjs";

export const attemptColumns = {
  usage_report_deadline_at: "TEXT",
  account_fingerprint: "BLOB CHECK (account_fingerprint IS NULL OR (typeof(account_fingerprint)='blob' AND length(account_fingerprint)=32 AND dispatch_permitted_at IS NOT NULL))",
};
export const attempts = previous.attempts.replace(
  ",\n    UNIQUE (task_id,attempt_number)",
  ", " + Object.entries(attemptColumns).map(([name, type]) => name + " " + type).join(", ") +
    ",\n    UNIQUE (task_id,attempt_number)",
);
/** @param {string} name */
const counter = (name) => name + " INTEGER CHECK (" + name + " IS NULL OR (typeof(" + name + ")='integer' AND " + name + " BETWEEN 0 AND 9007199254740991))";
export const usageReports = `CREATE TABLE usage_reports (
    attempt_id BLOB NOT NULL REFERENCES attempts(id),
    revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
    origin TEXT NOT NULL CHECK (origin IN ('end','late')),
    ${counter("input_tokens")},
    ${counter("cached_input_tokens")},
    ${counter("output_tokens")},
    ${counter("reasoning_tokens")},
    estimated INTEGER NOT NULL CHECK (estimated IN (0,1)),
    report_sha256 BLOB NOT NULL CHECK (typeof(report_sha256)='blob' AND length(report_sha256)=32),
    accepted_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id,revision)
  )`;
export const objects = {
  attempts_changes: work.attempts_changes.replace(
    "OR (OLD.state IN",
    `OR (OLD.usage_report_deadline_at IS NOT NULL AND NEW.usage_report_deadline_at IS NOT OLD.usage_report_deadline_at)
      OR (OLD.account_fingerprint IS NOT NULL AND NEW.account_fingerprint IS NOT OLD.account_fingerprint
        AND NOT (NEW.account_fingerprint IS NULL AND NEW.dispatch_permitted_at IS NULL))
      OR (OLD.state IN ('completed','failed','cancelled','uncertain') AND NEW.account_fingerprint IS NOT OLD.account_fingerprint)
      OR (OLD.state IN`,
  ),
  usage_reports_changes: "CREATE TRIGGER usage_reports_changes BEFORE UPDATE ON usage_reports BEGIN SELECT RAISE(ABORT,'Immutable usage report'); END",
  usage_reports_delete: "CREATE TRIGGER usage_reports_delete BEFORE DELETE ON usage_reports BEGIN SELECT RAISE(ABORT,'Immutable usage report'); END",
};
/** @param {import("kysely").Kysely<unknown>} db */
export async function up(db) {
  for (const [name, type] of Object.entries(attemptColumns))
    await sql.raw("ALTER TABLE attempts ADD COLUMN " + name + " " + type).execute(db);
  await sql.raw(usageReports).execute(db);
  await sql.raw("DROP TRIGGER attempts_changes").execute(db);
  for (const definition of Object.values(objects)) await sql.raw(definition).execute(db);
}
