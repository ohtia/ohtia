import { createHash } from "node:crypto";
import { sql, type Kysely, type Selectable, type NotNull } from "kysely";
import {
  failure,
  isPlanEventPayload,
  planEventLimit,
  planEventPageSize,
  isResearchId,
  splitText,
  type PlanText,
  type Outcome,
  type PlanEventKind,
  type PlanEventPage,
  type PlanEventPayload,
  type PlanSnapshot,
  type ResearchEvent,
  type ResearchScope,
} from "@ohtia/contracts";
import {
  holdingDependencies,
  planContributions,
  waitingForPlanWork,
} from "./contribution-graphs.js";
import type { InterventionRow } from "./consultations.js";
import type { InputMessage } from "./operations.js";
import { bytes, canonicalJson, identifier, newId, type ResearchSchema } from "./research.js";

export interface PlanEventRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  sequence: number;
  kind: PlanEventKind;
  contribution_id: Uint8Array | null;
  task_id: Uint8Array | null;
  payload: string;
  payload_sha256: Uint8Array;
  created_at: string;
}
export interface ContinuationRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  graph_version: number;
  through_sequence: number;
  reason: "required_set_complete" | "finished_partial";
  policy_version: 1;
  admission: "waiting" | "admitted" | "withdrawn";
  restart_held: number;
  task_id: Uint8Array | null;
  ready_key: Uint8Array;
  created_at: string;
}

export function acceptedPlans(db: Kysely<ResearchSchema>) {
  return db.selectFrom("interventions").where("kind", "=", "plan").where("state", "=", "accepted");
}
export function acceptedPlan(db: Kysely<ResearchSchema>, id: Uint8Array) {
  return acceptedPlans(db).selectAll().where("id", "=", id).executeTakeFirst();
}
export async function planSequence(db: Kysely<ResearchSchema>, id: Uint8Array): Promise<number> {
  const row = await db
    .selectFrom("intervention_events")
    .select("sequence")
    .where("intervention_id", "=", id)
    .orderBy("sequence", "desc")
    .executeTakeFirst();
  return row?.sequence ?? 0;
}
export async function hasEventRoom(db: Kysely<ResearchSchema>, id: Uint8Array, count = 1) {
  return (await planSequence(db, id)) + count <= planEventLimit;
}

export async function appendPlanEvent(
  db: Kysely<ResearchSchema>,
  id: Uint8Array,
  now: string,
  kind: PlanEventKind,
  payload: PlanEventPayload,
  contributionId: Uint8Array | null = null,
  taskId: Uint8Array | null = null,
): Promise<number> {
  if (!isPlanEventPayload(kind, payload)) throw new Error("Invalid coordination event payload.");
  const canonical = canonicalJson(payload);
  if (Buffer.byteLength(canonical) > 2048)
    throw new Error("Coordination event payload is too large.");
  const sequence = (await planSequence(db, id)) + 1;
  await db
    .insertInto("intervention_events")
    .values({
      id: newId(),
      intervention_id: id,
      sequence,
      kind,
      contribution_id: contributionId,
      task_id: taskId,
      payload: canonical,
      payload_sha256: createHash("sha256").update(canonical).digest(),
      created_at: now,
    })
    .execute();
  return sequence;
}

export function planContinuation(db: Kysely<ResearchSchema>, id: Uint8Array) {
  return db
    .selectFrom("continuations")
    .selectAll()
    .where("intervention_id", "=", id)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

export async function createContinuation(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
  reason: ContinuationRow["reason"],
  now: string,
  withdrawn: boolean,
  restartHeld: boolean,
): Promise<void> {
  const results = (await planContributions(db, plan.id)).flatMap((node) =>
    node.state === "completed" && node.result_message_id
      ? [{ contributionId: identifier(node.id), resultId: identifier(node.result_message_id) }]
      : [],
  );
  const readyKey = createHash("sha256")
    .update(
      canonicalJson({
        planId: identifier(plan.id),
        graphVersion: plan.graph_version,
        results: results.sort((left, right) =>
          left.contributionId < right.contributionId ? -1 : 1,
        ),
      }),
    )
    .digest();
  if (
    await db
      .selectFrom("continuations")
      .select("id")
      .where("ready_key", "=", readyKey)
      .executeTakeFirst()
  )
    return;
  const id = newId();
  const sequence =
    (await planSequence(db, plan.id)) ||
    (await appendPlanEvent(db, plan.id, now, "plan_ended", {
      outcome: reason === "finished_partial" ? "partial" : "complete",
    }));
  await appendPlanEvent(db, plan.id, now, "continuation_created", {
    continuationId: identifier(id),
  });
  await db
    .insertInto("continuations")
    .values({
      id,
      intervention_id: plan.id,
      graph_version: plan.graph_version,
      through_sequence: sequence,
      reason,
      policy_version: 1,
      admission: withdrawn ? "withdrawn" : "waiting",
      task_id: null,
      ready_key: readyKey,
      restart_held: !withdrawn && restartHeld ? 1 : 0,
      created_at: now,
    })
    .execute();
}

/** Preserve every contribution's recorded disposition, including optional uncertain work. */
export async function synthesisInput(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
): Promise<InputMessage[]> {
  if (plan.purpose === null || plan.shared_context === null)
    throw new Error("Synthesis lacks its accepted plan context.");
  const nodes = await db
    .selectFrom("contributions as c")
    .leftJoin("messages as m", "m.id", "c.result_message_id")
    .select([
      "c.id",
      "c.agent_id",
      "c.plan_key",
      "c.required",
      "c.state",
      "m.id as resultId",
      "m.content",
    ])
    .where("c.intervention_id", "=", plan.id)
    .where("c.plan_key", "is not", null)
    .$narrowType<{ plan_key: NotNull }>()
    .orderBy(sql`c.rowid`)
    .execute();
  return [
    {
      role: "user",
      reference: identifier(plan.id),
      transferKind: "plan_context",
      text: `Purpose: ${plan.purpose}\nShared context: ${plan.shared_context}`,
    },
    ...nodes.flatMap((node): InputMessage[] => [
      {
        role: "user",
        reference: identifier(node.id),
        transferKind: "contribution_state",
        text: `Contribution ${node.plan_key} by ${node.agent_id} (${node.required ? "required" : "optional"}): ${node.state}.`,
      },
      ...(node.resultId && node.content
        ? [{ role: "user" as const, reference: identifier(node.resultId), text: node.content }]
        : []),
    ]),
  ];
}

function planText(text: string, source: string): PlanText {
  const bytes = Buffer.byteLength(text);
  return Buffer.byteLength(JSON.stringify(text)) <= 512
    ? text
    : {
        source,
        bytes,
        parts: splitText(text).length,
        sha256: createHash("sha256").update(text).digest("hex"),
      };
}

export async function readPlanText(
  db: Kysely<ResearchSchema>,
  source: string,
  index: number,
): Promise<Outcome<{ readonly text: string }>> {
  const match = /^plan_(purpose|context|request|reason)_(.+)$/.exec(source);
  const [, field, id] = match ?? [];
  if (!isResearchId(id)) return failure("record_not_found");
  let value: string | null | undefined;
  if (field === "purpose" || field === "context") {
    const row = await acceptedPlan(db, bytes(id));
    value = field === "purpose" ? row?.purpose : row?.shared_context;
  } else {
    const row = await db
      .selectFrom("contributions as c")
      .innerJoin("interventions as i", "i.id", "c.intervention_id")
      .select(["c.request", "c.reason"])
      .where("c.id", "=", bytes(id))
      .where("i.kind", "=", "plan")
      .where("i.state", "=", "accepted")
      .executeTakeFirst();
    value = field === "request" ? row?.request : row?.reason;
  }
  const text = typeof value === "string" ? splitText(value)[index - 1] : undefined;
  return text === undefined ? failure("record_not_found") : { ok: true, value: { text } };
}

export async function readPlan(
  db: Kysely<ResearchSchema>,
  planId: string,
): Promise<Outcome<PlanSnapshot>> {
  const plan = await acceptedPlan(db, bytes(planId));
  if (!plan) return failure("record_not_found");
  const nodes = await planContributions(db, plan.id);
  const edges = await holdingDependencies(db, plan.id);
  const throughSequence = await planSequence(db, plan.id);
  const continuation = await planContinuation(db, plan.id);
  const task = continuation?.task_id
    ? await db
        .selectFrom("tasks")
        .select(["state", "blocking_reason"])
        .where("id", "=", continuation.task_id)
        .executeTakeFirstOrThrow()
    : null;
  const nodeId = (id: Uint8Array | null) => (id ? identifier(id) : null);
  const hasActive = nodes.some(({ state }) => state === "active");
  return {
    ok: true,
    value: {
      planId,
      projectId: identifier(plan.project_id),
      conversationId: identifier(plan.conversation_id),
      revision: plan.revision,
      graphVersion: plan.graph_version,
      outcome: plan.outcome,
      throughSequence,
      needsAttention:
        !plan.outcome &&
        !hasActive &&
        (throughSequence >= planEventLimit ||
          (!nodes.some(({ state }) => waitingForPlanWork(state)) &&
            nodes.some(({ required, state }) => !!required && state !== "completed"))),
      purpose: planText(plan.purpose ?? "", `plan_purpose_${planId}`),
      sharedContext: planText(plan.shared_context ?? "", `plan_context_${planId}`),
      contributions: nodes.map((node) => ({
        request: planText(node.request, `plan_request_${identifier(node.id)}`),
        reason: planText(node.reason, `plan_reason_${identifier(node.id)}`),
        failureReason: node.failure_reason,
        id: identifier(node.id),
        key: node.plan_key,
        agentId: node.agent_id,
        required: !!node.required,
        state: node.state,
        taskId: nodeId(node.task_id),
        resultMessageId: nodeId(node.result_message_id),
        blockedBy: nodeId(node.blocked_by_contribution_id),
        restartHeld: !!node.restart_held,
        prerequisites: edges
          .filter((edge) => identifier(edge.contribution_id) === identifier(node.id))
          .map((edge) => identifier(edge.prerequisite_id)),
      })),
      continuation: continuation
        ? {
            id: identifier(continuation.id),
            graphVersion: continuation.graph_version,
            throughSequence: continuation.through_sequence,
            reason: continuation.reason,
            policyVersion: continuation.policy_version,
            admission: continuation.admission,
            restartHeld: !!continuation.restart_held,
            taskId: nodeId(continuation.task_id),
            taskState:
              task?.state === "waiting_capacity"
                ? task.blocking_reason
                  ? "blocked"
                  : "queued"
                : (task?.state ?? null),
          }
        : null,
    },
  };
}

export async function listPlanEvents(
  db: Kysely<ResearchSchema>,
  planId: string,
  afterSequence: number,
): Promise<Outcome<PlanEventPage>> {
  const plan = await acceptedPlan(db, bytes(planId));
  if (!plan) return failure("record_not_found");
  const throughSequence = await planSequence(db, plan.id);
  const rows = await db
    .selectFrom("intervention_events")
    .selectAll()
    .where("intervention_id", "=", plan.id)
    .where("sequence", ">", afterSequence)
    .orderBy("sequence")
    .limit(planEventPageSize)
    .execute();
  return {
    ok: true,
    value: {
      planId,
      throughSequence,
      events: rows.map((row) => {
        const payload: unknown = JSON.parse(row.payload);
        if (!isPlanEventPayload(row.kind, payload))
          throw new Error("Invalid stored coordination event payload.");
        return {
          id: identifier(row.id),
          sequence: row.sequence,
          kind: row.kind,
          contributionId: row.contribution_id ? identifier(row.contribution_id) : null,
          taskId: row.task_id ? identifier(row.task_id) : null,
          payload,
          payloadHash: Buffer.from(row.payload_sha256).toString("hex"),
          createdAt: row.created_at,
        };
      }),
    },
  };
}

export async function planRevisions(db: Kysely<ResearchSchema>, scope: ResearchScope) {
  if (!scope.projectId) return [];
  let query = acceptedPlans(db)
    .select(["id", "revision"])
    .where("project_id", "=", bytes(scope.projectId));
  if (scope.conversationId)
    query = query.where("conversation_id", "=", bytes(scope.conversationId));
  const result: Extract<ResearchEvent, { kind: "planChanged" }>[] = [];
  for (const plan of await query.execute())
    result.push({
      kind: "planChanged",
      planId: identifier(plan.id),
      revision: plan.revision,
      throughSequence: await planSequence(db, plan.id),
    });
  return result;
}
