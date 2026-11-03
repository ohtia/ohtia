import { sql } from "kysely";

export const schema = `CREATE TABLE presentation_receipts (
    feature TEXT NOT NULL CHECK (feature IN ('character','zoom')),
    operation_id TEXT NOT NULL,
    intent TEXT CHECK (intent IS NULL OR (feature='zoom' AND intent IN ('increase','decrease','reset'))),
    error_code TEXT CHECK (error_code IS NULL OR (feature='zoom' AND intent IS NOT NULL AND error_code IN ('zoom_minimum','zoom_maximum','actual_size'))),
    expected_revision INTEGER NOT NULL CHECK (typeof(expected_revision)='integer' AND expected_revision >= 0 AND expected_revision < 9007199254740991),
    value TEXT NOT NULL CHECK (typeof(value)='text' AND length(value)<=128),
    accepted INTEGER NOT NULL CHECK (typeof(accepted)='integer' AND accepted IN (0,1)),
    result_revision INTEGER NOT NULL CHECK (typeof(result_revision)='integer' AND result_revision >= 0 AND result_revision <= 9007199254740991),
    PRIMARY KEY (feature, operation_id),
    CHECK ((accepted=1 AND error_code IS NULL AND result_revision=expected_revision+1) OR (accepted=0 AND ((error_code IS NULL AND result_revision<>expected_revision) OR (error_code IS NOT NULL AND result_revision=expected_revision))))
  )`;

/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  await sql.raw(schema).execute(database);
}
