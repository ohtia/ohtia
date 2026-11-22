import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { LateUsageReport, ProviderUsage } from "@ohtia/contracts";
import { canonicalJson, identifier, type ResearchSchema } from "./research.js";

const windowMs = 15 * 60 * 1000;

export interface UsageReportRow extends ProviderUsage {
  attempt_id: Uint8Array;
  revision: number;
  origin: "end" | "late";
  estimated: number;
  report_sha256: Uint8Array;
  accepted_at: string;
}

export function usageDeadline(endedAt: string): string {
  return new Date(Date.parse(endedAt) + windowMs).toISOString();
}

export function reportRow(
  attempt: Uint8Array,
  origin: UsageReportRow["origin"],
  report: LateUsageReport,
  now: string,
): UsageReportRow {
  const { revision, estimated, usage } = report;
  return {
    attempt_id: attempt,
    revision,
    origin,
    ...usage,
    estimated: Number(estimated),
    report_sha256: createHash("sha256")
      .update(
        canonicalJson({
          attemptId: identifier(attempt),
          revision,
          origin,
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
          reasoningTokens: usage.reasoning_tokens,
          estimated,
        }),
      )
      .digest(),
    accepted_at: now,
  };
}

export async function recordEndUsage(
  db: Kysely<ResearchSchema>,
  attempt: ProviderUsage & { id: Uint8Array },
  now: string,
): Promise<void> {
  const usage = {
    input_tokens: attempt.input_tokens,
    cached_input_tokens: attempt.cached_input_tokens,
    output_tokens: attempt.output_tokens,
    reasoning_tokens: attempt.reasoning_tokens,
  };
  if (Object.values(usage).some((count) => count !== null))
    await db
      .insertInto("usage_reports")
      .values(reportRow(attempt.id, "end", { revision: 1, estimated: false, usage }, now))
      .execute();
}
