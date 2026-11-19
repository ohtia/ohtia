import type { ProviderWorkUsage } from "@ohtia/contracts";
import { sql, type Kysely, type Selectable } from "kysely";
import type { OperationPolicy } from "./operations.js";
import { newId, type ResearchSchema } from "./research.js";
import type { AttemptRow } from "./tasks.js";

type ReservationPolicy = Pick<
  OperationPolicy,
  "max_attempts" | "max_input_bytes" | "max_output_bytes" | "max_attempt_duration_ms"
>;

type Budget = {
  max_requests: number;
  max_input_bytes: number;
  max_output_bytes: number;
  max_work_ms: number;
};
type Policy = Budget & {
  policy: "plan" | "consultation";
  policy_version: number;
  max_contributions: number;
  max_dependencies: number;
  max_levels: number;
  max_coordinator_turns: number;
};
export type InterventionLimitsRow = Policy & {
  intervention_id: Uint8Array;
  created_at: string;
};
export interface AuthorizedOperation {
  agent_id: string;
  operation: string;
  connection: string;
}
export type InterventionOperationRow = AuthorizedOperation & { intervention_id: Uint8Array };
export interface WorkAllocationRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  contribution_id: Uint8Array | null;
  share: "contribution" | "synthesis";
  task_id: Uint8Array | null;
  attempt_number: number;
  reserved_requests: number;
  reserved_input_bytes: number;
  reserved_output_bytes: number;
  reserved_work_ms: number;
  state: "held" | "settled" | "released";
  attempt_id: Uint8Array | null;
  used_requests: number | null;
  used_input_bytes: number | null;
  used_output_bytes: number | null;
  used_work_ms: number | null;
  created_at: string;
  settled_at: string | null;
}

// Accepted interventions keep their own snapshot when a new operation requires a larger policy.
export const planLimits = Object.freeze({
  policy: "plan",
  policy_version: 1,
  max_contributions: 8,
  max_dependencies: 16,
  max_levels: 1,
  max_coordinator_turns: 3,
  max_requests: 24,
  max_input_bytes: 8 * 1024 * 1024,
  max_output_bytes: 2 * 1024 * 1024,
  max_work_ms: 4 * 60 * 60 * 1000,
} satisfies Policy);
export const consultationLimits = Object.freeze({
  policy: "consultation",
  policy_version: 1,
  max_contributions: 1,
  max_dependencies: 0,
  max_levels: 1,
  max_coordinator_turns: 0,
  max_requests: 4,
  max_input_bytes: 1024 * 1024,
  max_output_bytes: 256 * 1024,
  max_work_ms: 40 * 60 * 1000,
} satisfies Policy);

export function interventionLimits(db: Kysely<ResearchSchema>, id: Uint8Array) {
  return db
    .selectFrom("intervention_limits")
    .selectAll()
    .where("intervention_id", "=", id)
    .executeTakeFirst();
}

export async function authorizeWork(
  db: Kysely<ResearchSchema>,
  id: Uint8Array,
  policy: Policy,
  operations: readonly AuthorizedOperation[],
  now: string,
): Promise<void> {
  await db
    .insertInto("intervention_limits")
    .values({ ...policy, intervention_id: id, created_at: now })
    .execute();
  const distinct = new Map(
    operations.map((operation) => [`${operation.agent_id}:${operation.operation}`, operation]),
  );
  await db
    .insertInto("intervention_operations")
    .values([...distinct.values()].map((operation) => ({ ...operation, intervention_id: id })))
    .execute();
}

export function authorizedOperation(
  db: Kysely<ResearchSchema>,
  id: Uint8Array,
  agent: string,
  operation: string,
) {
  return db
    .selectFrom("intervention_operations")
    .select("connection")
    .where("intervention_id", "=", id)
    .where("agent_id", "=", agent)
    .where("operation", "=", operation)
    .executeTakeFirst();
}

const zero: Budget = { max_requests: 0, max_input_bytes: 0, max_output_bytes: 0, max_work_ms: 0 };

/** Admission and insertion share the caller's immediate SQLite write transaction. */
export async function workFits(
  db: Kysely<ResearchSchema>,
  limits: Budget,
  policies: readonly ReservationPolicy[],
  interventionId?: Uint8Array,
): Promise<boolean> {
  const use = interventionId
    ? await db
        .selectFrom("work_allocations")
        .select([
          sql<number>`coalesce(sum(CASE state WHEN 'held' THEN reserved_requests ELSE used_requests END),0)`.as(
            "max_requests",
          ),
          sql<number>`coalesce(sum(CASE state WHEN 'held' THEN reserved_input_bytes ELSE used_input_bytes END),0)`.as(
            "max_input_bytes",
          ),
          sql<number>`coalesce(sum(CASE state WHEN 'held' THEN reserved_output_bytes ELSE used_output_bytes END),0)`.as(
            "max_output_bytes",
          ),
          sql<number>`coalesce(sum(CASE state WHEN 'held' THEN reserved_work_ms ELSE used_work_ms END),0)`.as(
            "max_work_ms",
          ),
        ])
        .where("intervention_id", "=", interventionId)
        .executeTakeFirstOrThrow()
    : { ...zero };
  for (const policy of policies) {
    use.max_requests += policy.max_attempts;
    use.max_input_bytes += policy.max_attempts * policy.max_input_bytes;
    use.max_output_bytes += policy.max_attempts * policy.max_output_bytes;
    use.max_work_ms += policy.max_attempts * policy.max_attempt_duration_ms;
  }
  return (
    use.max_requests <= limits.max_requests &&
    use.max_input_bytes <= limits.max_input_bytes &&
    use.max_output_bytes <= limits.max_output_bytes &&
    use.max_work_ms <= limits.max_work_ms
  );
}

export async function reserveWork(
  db: Kysely<ResearchSchema>,
  interventionId: Uint8Array,
  contributionId: Uint8Array | null,
  policy: ReservationPolicy,
  now: string,
): Promise<void> {
  if (policy.max_attempts !== 2)
    throw new Error("Intervention operation needs two attempt shares.");
  await db
    .insertInto("work_allocations")
    .values(
      [1, 2].map((attempt_number) => ({
        id: newId(),
        intervention_id: interventionId,
        contribution_id: contributionId,
        share: contributionId ? ("contribution" as const) : ("synthesis" as const),
        task_id: null,
        attempt_number,
        reserved_requests: 1,
        reserved_input_bytes: policy.max_input_bytes,
        reserved_output_bytes: policy.max_output_bytes,
        reserved_work_ms: policy.max_attempt_duration_ms,
        state: "held" as const,
        attempt_id: null,
        used_requests: null,
        used_input_bytes: null,
        used_output_bytes: null,
        used_work_ms: null,
        created_at: now,
        settled_at: null,
      })),
    )
    .execute();
}

export async function bindWork(
  db: Kysely<ResearchSchema>,
  contributionId: Uint8Array,
  taskId: Uint8Array,
): Promise<void> {
  const result = await db
    .updateTable("work_allocations")
    .set({ task_id: taskId })
    .where("contribution_id", "=", contributionId)
    .where("task_id", "is", null)
    .where("state", "=", "held")
    .executeTakeFirstOrThrow();
  if (result.numUpdatedRows !== 2n) throw new Error("Contribution lacks its attempt shares.");
}

export async function releaseTaskWork(
  db: Kysely<ResearchSchema>,
  taskId: Uint8Array,
  now: string,
): Promise<boolean> {
  const result = await db
    .updateTable("work_allocations")
    .set({ state: "released", settled_at: now })
    .where("task_id", "=", taskId)
    .where("state", "=", "held")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function releaseUnboundContributionWork(
  db: Kysely<ResearchSchema>,
  id: Uint8Array,
  now: string,
): Promise<boolean> {
  const result = await db
    .updateTable("work_allocations")
    .set({ state: "released", settled_at: now })
    .where("contribution_id", "=", id)
    .where("task_id", "is", null)
    .where("state", "=", "held")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function releasePendingWork(
  db: Kysely<ResearchSchema>,
  interventionId: Uint8Array,
  now: string,
  includeSynthesis: boolean,
): Promise<boolean> {
  let query = db
    .updateTable("work_allocations")
    .set({ state: "released", settled_at: now })
    .where("intervention_id", "=", interventionId)
    .where("state", "=", "held")
    .where("task_id", "is", null);
  if (!includeSynthesis) query = query.where("share", "=", "contribution");
  return (await query.executeTakeFirst()).numUpdatedRows > 0n;
}

export async function settleWork(
  db: Kysely<ResearchSchema>,
  attempt: Pick<AttemptRow, "id" | "task_id" | "attempt_number">,
  now: string,
  dispatched: boolean,
  usage?: ProviderWorkUsage,
): Promise<boolean> {
  const filter = db
    .updateTable("work_allocations")
    .where("task_id", "=", attempt.task_id)
    .where("attempt_number", "=", attempt.attempt_number)
    .where("state", "=", "held");
  if (!dispatched) {
    const result = await filter.set({ state: "released", settled_at: now }).executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
  // Unknown consumption (including recovery after a generation is lost) consumes the whole share.
  const result = await filter
    .set({
      state: "settled",
      attempt_id: attempt.id,
      used_requests: 1,
      used_input_bytes: usage
        ? sql`min(${usage.input_bytes},reserved_input_bytes)`
        : sql`reserved_input_bytes`,
      used_output_bytes: usage
        ? sql`min(${usage.output_bytes},reserved_output_bytes)`
        : sql`reserved_output_bytes`,
      used_work_ms: usage ? sql`min(${usage.work_ms},reserved_work_ms)` : sql`reserved_work_ms`,
      settled_at: now,
    })
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function consultationRetryFits(
  db: Kysely<ResearchSchema>,
  task: Selectable<ResearchSchema["tasks"]>,
  policy: OperationPolicy,
): Promise<boolean> {
  if (!task.contribution_id) throw new Error("Consultation lacks its contribution.");
  const row = await db
    .selectFrom("contributions")
    .select("intervention_id")
    .where("id", "=", task.contribution_id)
    .executeTakeFirstOrThrow();
  const limits = await interventionLimits(db, row.intervention_id);
  return !!limits && workFits(db, limits, [policy], row.intervention_id);
}
