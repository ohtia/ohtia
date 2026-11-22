import {
  failure,
  providerOperations,
  type Outcome,
  type ProviderOperation,
  type ReplyDetails,
  type ResearchInputs,
  type TransferEntry,
} from "@ohtia/contracts";
import type { Kysely } from "kysely";
import { bytes, identifier, type ResearchSchema } from "./research.js";
import { replyAgent } from "./operations.js";
import { unknownUsage, type TaskContext } from "./tasks.js";

export async function readReplyDetails(
  db: Kysely<ResearchSchema>,
  { projectId, taskId }: ResearchInputs["reply.details"],
  context: TaskContext,
): Promise<Outcome<ReplyDetails>> {
  const task = await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", bytes(taskId))
    .where("project_id", "=", bytes(projectId))
    .where("state", "in", ["completed", "failed", "cancelled", "uncertain"])
    .executeTakeFirst();
  if (!task) return failure("record_not_found");
  const operation = task.operation as ProviderOperation;
  if (!providerOperations.includes(operation)) return failure("record_not_found");

  const attempts = await db
    .selectFrom("attempts")
    .selectAll()
    .where("task_id", "=", task.id)
    .orderBy("attempt_number", "desc")
    .execute();
  const dispatched = attempts.find((attempt) => attempt.dispatch_permitted_at !== null);
  const attempt = dispatched ?? attempts[0];
  const connection = context.connections.read(task.connection);
  const account = context.connections.account(task.connection);
  const storedFingerprint = dispatched?.account_fingerprint;
  const model = (slug: string | null | undefined) =>
    slug ? (connection?.models?.find(({ id }) => id === slug)?.name ?? slug) : null;

  const report = attempt
    ? await db
        .selectFrom("usage_reports")
        .selectAll()
        .where("attempt_id", "=", attempt.id)
        .orderBy("revision", "desc")
        .executeTakeFirst()
    : undefined;
  const tokens = attempt
    ? {
        input_tokens: attempt.input_tokens,
        cached_input_tokens: attempt.cached_input_tokens,
        output_tokens: attempt.output_tokens,
        reasoning_tokens: attempt.reasoning_tokens,
      }
    : unknownUsage;
  // A provider error can terminate the stream with counters regardless of its reason.
  // An empty reply comes from a completed stream and retains the provider's full accounting.
  const interrupted =
    attempt?.state === "cancelled" ||
    attempt?.state === "uncertain" ||
    (attempt?.state === "failed" &&
      attempt.dispatch_permitted_at !== null &&
      attempt.outcome_reason !== "empty_reply");
  const manifest = JSON.parse(dispatched?.transfer_manifest ?? "[]") as TransferEntry[];
  const versionIds = manifest.flatMap((entry) =>
    entry.kind === "memory_version" ? [bytes(entry.reference)] : [],
  );
  const memoryRows = versionIds.length
    ? await db
        .selectFrom("memory_entry_versions as v")
        .innerJoin("memory_entries as e", "e.id", "v.entry_id")
        .select(["v.id", "v.entry_id", "v.number"])
        .where("e.project_id", "=", task.project_id)
        .where("v.id", "in", versionIds)
        .execute()
    : [];
  const startedAt = dispatched?.started_at ?? null;
  const overwrittenByRetry =
    task.kind === "synthesis" &&
    (task.state === "failed" || task.state === "uncertain") &&
    (await db
      .selectFrom("tasks")
      .select("id")
      .where("replaces_task_id", "=", task.id)
      .where("created_at", "=", task.updated_at)
      .executeTakeFirst());
  const endedAt = (overwrittenByRetry && attempts[0]?.finished_at) || task.updated_at;
  const versions = new Map(memoryRows.map((row) => [identifier(row.id), row]));

  return {
    ok: true,
    value: {
      agentId: replyAgent(task.operation),
      operation,
      instructionVersion: task.instruction_version,
      connectionId: task.connection,
      connectionKind: account.kind,
      accountRevision: account.revision ?? null,
      account: !dispatched
        ? null
        : connection?.state !== "connected"
          ? "disconnected"
          : !storedFingerprint || !account.fingerprint
            ? "unknown"
            : Buffer.from(storedFingerprint).toString("hex") === account.fingerprint
              ? "same"
              : "different",
      requestedModel: model(attempt?.requested_model),
      observedModel: model(attempt?.observed_model),
      requestedEffort: dispatched?.requested_effort ?? null,
      observedEffort: attempt?.observed_effort ?? null,
      attempts: attempts.length,
      startedAt,
      endedAt,
      durationMs:
        startedAt && endedAt >= startedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null,
      tokens,
      usage: Object.values(tokens).every((value) => value === null)
        ? "unreported"
        : report?.estimated
          ? "estimated"
          : interrupted
            ? "incomplete"
            : report?.origin === "late"
              ? "late"
              : "reported",
      memory: manifest.flatMap((entry) => {
        const row = entry.kind === "memory_version" ? versions.get(entry.reference) : undefined;
        return row
          ? [
              {
                entryId: identifier(row.entry_id),
                version: row.number,
                versionId: identifier(row.id),
              },
            ]
          : [];
      }),
    },
  };
}
