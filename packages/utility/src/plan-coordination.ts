import { effectivePlan, storedPlanChange } from "./plan-change-proposals.js";
import { authorizedOperation, planLimits, planRequestsUsed } from "./work-limits.js";
import { createHash } from "node:crypto";
import { sql, type Generated, type Kysely, type Selectable, type NotNull } from "kysely";
import {
  failure,
  utf8Size,
  type TransferEntry,
  type SynthesisSource,
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
  type PlanTaskProgress,
  type ResearchEvent,
  type ResearchScope,
} from "@ohtia/contracts";
import { holdingDependencies, planContributions } from "./contribution-graphs.js";
import { agentIdentity, type InterventionRow } from "./consultations.js";
import {
  recordedOperationPolicy,
  type BuiltInput,
  type InputMessage,
  type OperationPolicy,
} from "./operations.js";
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
  policy_version: 1 | 2 | 3;
  admission: "waiting" | "admitted" | "withdrawn";
  restart_held: number;
  stopped: Generated<number>;
  task_id: Uint8Array | null;
  ready_key: Uint8Array;
  created_at: string;
}

/** Matches the plan card and attention projections, including event exhaustion. */
export const planNeedsAttention = sql<number>`i.kind='plan' AND i.state='accepted' AND i.outcome IS NULL
  AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.intervention_id=i.id AND c.state='active')
  AND (
    EXISTS (SELECT 1 FROM intervention_events e WHERE e.intervention_id=i.id AND e.sequence>=${planEventLimit})
    OR (
      NOT EXISTS (SELECT 1 FROM contributions c WHERE c.intervention_id=i.id AND c.state='waiting')
      AND EXISTS (SELECT 1 FROM contributions c WHERE c.intervention_id=i.id
        AND c.required=1 AND c.state<>'completed' AND c.superseded_by_contribution_id IS NULL
        AND c.cancellation_reason IS NOT 'removed_by_researcher')
    )
  )`;

export function acceptedPlans(db: Kysely<ResearchSchema>) {
  return db
    .selectFrom("interventions")
    .where("interventions.kind", "=", "plan")
    .where("interventions.state", "=", "accepted");
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
  const synthesis = await authorizedOperation(db, plan.id, "virgilio", "contribution_synthesis");
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
      policy_version: synthesis ? 3 : 1,
      admission: withdrawn ? "withdrawn" : "waiting",
      task_id: null,
      ready_key: readyKey,
      restart_held: !withdrawn && restartHeld ? 1 : 0,
      created_at: now,
    })
    .execute();
}

/** Preserve every contribution's recorded disposition, including optional uncertain work. */
export async function legacySynthesisInput(
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

/** A finalized plan's graph and results are immutable, including across synthesis retries. */
export async function synthesisInput(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
  continuation: Pick<ContinuationRow, "reason" | "graph_version">,
  policy: OperationPolicy,
  memory?: BuiltInput,
): Promise<BuiltInput | undefined> {
  const outcome = continuation.reason === "finished_partial" ? "partial" : "complete";
  if (
    plan.outcome !== outcome ||
    plan.graph_version !== continuation.graph_version ||
    plan.purpose === null ||
    plan.shared_context === null
  )
    throw new Error("Synthesis lacks its finalized plan.");

  const effective =
    policy.version >= 2
      ? await effectivePlan(db, plan)
      : {
          purpose: plan.purpose,
          context: plan.shared_context,
          purposeSource: plan.id,
          contextSource: plan.id,
        };
  const contextLabel =
    effective.contextSource === plan.id
      ? "Context for every contribution of the plan:"
      : "Current shared context of the plan:";
  const planText = [
    "The researcher approved this plan, and no contribution of it is still working. Write its synthesis.",
    `Purpose of the plan:\n${effective.purpose}`,
    ...(effective.purpose !== plan.purpose
      ? [`Original purpose of the plan:\n${plan.purpose}`]
      : []),
    ...(effective.context ? [`${contextLabel}\n${effective.context}`] : []),
    `Plan outcome: ${outcome}`,
  ].join("\n\n");
  const input: BuiltInput["input"][number][] = [
    ...(memory?.input ?? []),
    { role: "user", text: planText },
  ];
  const transfer: TransferEntry[] = [
    { kind: "instructions", operation: policy.operation, version: policy.instruction_version },
    ...(memory?.transfer ?? []),
    { kind: "plan_context", reference: identifier(plan.id) },
  ];
  for (const reference of new Set([effective.purposeSource, effective.contextSource]))
    if (reference !== plan.id)
      transfer.push({ kind: "plan_context", reference: identifier(reference) });
  const nodes = await planContributions(db, plan.id, policy.version >= 2);
  const keys = new Map(nodes.map((node) => [identifier(node.id), node.plan_key]));
  let retiredLines: string[] = [];
  const flushRetired = () => {
    if (retiredLines.length) input.push({ role: "user", text: retiredLines.join("\n") });
    retiredLines = [];
  };
  for (const node of nodes) {
    const { name, role } = agentIdentity(node.agent_id);
    const requirement = node.required ? "required" : "optional";
    const header = `Contribution ${node.plan_key} by ${name}, ${role} (${requirement}): `;
    const retirement =
      node.cancellation_reason === "removed_by_researcher"
        ? "removed by the researcher in a plan change; it has no result."
        : node.cancellation_reason === "superseded"
          ? "replaced in a plan change by the later contribution with the same key; it has no result."
          : null;
    if (retirement) {
      transfer.push({ kind: "contribution_state", reference: identifier(node.id) });
      retiredLines.push(header + retirement);
      continue;
    }
    flushRetired();
    const request = `Request:\n${node.request}`;
    let stateLine: string;
    let result: string | undefined;
    let originalPurpose: string | undefined;
    transfer.push({ kind: "contribution_state", reference: identifier(node.id) });
    switch (node.state) {
      case "completed": {
        if (!node.result_message_id) throw new Error("Completed contribution lacks its result.");
        const message = await db
          .selectFrom("messages")
          .select("content")
          .where("id", "=", node.result_message_id)
          .executeTakeFirstOrThrow();
        transfer.push({ kind: "message", reference: identifier(node.result_message_id) });
        if (policy.version >= 2) {
          const source =
            node.purpose_proposal_id &&
            (await db
              .selectFrom("graph_change_proposals")
              .select("change")
              .where("id", "=", node.purpose_proposal_id)
              .executeTakeFirstOrThrow());
          const purpose = source ? storedPlanChange(source.change).new_purpose : plan.purpose;
          if (purpose !== effective.purpose) {
            originalPurpose =
              "Purpose when contribution " + node.plan_key + " started:\n" + purpose;
            if (node.purpose_proposal_id)
              transfer.push({
                kind: "plan_context",
                reference: identifier(node.purpose_proposal_id),
              });
          }
        }
        stateLine = "completed.";
        result = `Result:\n${message.content}`;
        break;
      }
      case "failed":
      case "uncertain": {
        const last =
          node.task_id && (node.state === "uncertain" || !node.failure_reason)
            ? await db
                .selectFrom("attempts")
                .select("outcome_reason")
                .where("task_id", "=", node.task_id)
                .orderBy("attempt_number", "desc")
                .executeTakeFirst()
            : undefined;
        const code = (node.state === "failed" ? node.failure_reason : null) ?? last?.outcome_reason;
        if (!code) throw new Error("Unsuccessful contribution lacks its reason.");
        stateLine =
          node.state === "failed"
            ? `failed with the code ${code}; it has no result.`
            : `ended uncertain with the code ${code}: Ohtia lost contact with the service, so whether it finished is unknown; it has no result.`;
        break;
      }
      case "blocked": {
        const key =
          node.blocked_by_contribution_id && keys.get(identifier(node.blocked_by_contribution_id));
        if (!key) throw new Error("Blocked contribution lacks its prerequisite.");
        stateLine = `blocked, because contribution ${key} did not complete; it has no result.`;
        break;
      }
      case "cancelled":
        stateLine = "cancelled; it has no result.";
        break;
      default:
        throw new Error("Synthesis cannot receive work that is still pending.");
    }
    input.push({
      role: "user",
      text: [header + stateLine, request, ...(result === undefined ? [] : [result])].join("\n\n"),
    });
    if (originalPurpose) input.push({ role: "user", text: originalPurpose });
  }
  flushRetired();
  if (
    input.length > policy.max_input_items ||
    input.reduce((total, { text }) => total + utf8Size(text), 0) > policy.max_input_bytes
  )
    return;
  return { input, transfer };
}

/** Project only the contribution identities and result references recorded for this dispatch. */
export async function synthesisSources(
  db: Kysely<ResearchSchema>,
  taskId: Uint8Array,
): Promise<SynthesisSource[]> {
  const { transfer_manifest: manifest } = await db
    .selectFrom("attempts")
    .select("transfer_manifest")
    .where("task_id", "=", taskId)
    .where("dispatch_permitted_at", "is not", null)
    .orderBy("attempt_number", "desc")
    .executeTakeFirstOrThrow();
  if (!manifest) throw new Error("Synthesis message lacks its transfer record.");
  const transfer = JSON.parse(manifest) as TransferEntry[];
  const plan = transfer.find((entry) => entry.kind === "plan_context");
  if (plan?.kind !== "plan_context") throw new Error("Synthesis transfer lacks its plan.");
  const nodes = new Map(
    (await planContributions(db, bytes(plan.reference), true)).map((node) => [
      identifier(node.id),
      node,
    ]),
  );
  return transfer.flatMap((entry, index): SynthesisSource[] => {
    if (entry.kind !== "contribution_state") return [];
    const node = nodes.get(entry.reference);
    if (!node) throw new Error("Synthesis transfer lacks its contribution.");
    const source = { key: node.plan_key, agentId: node.agent_id };
    const next = transfer[index + 1];
    if (node.state === "completed") {
      if (
        next?.kind !== "message" ||
        !node.result_message_id ||
        next.reference !== identifier(node.result_message_id)
      )
        throw new Error("Synthesis transfer lacks its completed result.");
      return [{ ...source, state: node.state, messageId: next.reference }];
    }
    if (node.state === "active" || node.state === "waiting" || next?.kind === "message")
      throw new Error("Synthesis transfer contains an invalid contribution state.");
    const state =
      node.cancellation_reason === "removed_by_researcher"
        ? "removed"
        : node.cancellation_reason === "superseded"
          ? "replaced"
          : node.state;
    return [{ ...source, state, messageId: null }];
  });
}

export function planText(text: string, source: string): PlanText {
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
    const row = await db
      .selectFrom("interventions")
      .select(["purpose", "shared_context"])
      .where("id", "=", bytes(id))
      .where("kind", "=", "plan")
      .where("state", "!=", "invalid")
      .executeTakeFirst();
    value = field === "purpose" ? row?.purpose : row?.shared_context;
  } else {
    const row = await db
      .selectFrom("contributions as c")
      .innerJoin("interventions as i", "i.id", "c.intervention_id")
      .select(["c.request", "c.reason"])
      .where("c.id", "=", bytes(id))
      .where("i.kind", "=", "plan")
      .where("i.state", "!=", "invalid")
      .executeTakeFirst();
    value = field === "request" ? row?.request : row?.reason;
  }
  const text = typeof value === "string" ? splitText(value)[index - 1] : undefined;
  return text === undefined ? failure("record_not_found") : { ok: true, value: { text } };
}

async function readPlanTask(
  db: Kysely<ResearchSchema>,
  id: Uint8Array | null,
  agentId: PlanTaskProgress["agentId"],
): Promise<PlanTaskProgress | null> {
  if (!id) return null;
  const task = await db
    .selectFrom("tasks")
    .select(["state", "blocking_reason", "connection", "operation", "policy_version"])
    .select((eb) => [
      eb
        .selectFrom("attempts")
        .select("outcome_reason")
        .where("task_id", "=", id)
        .orderBy("attempt_number", "desc")
        .limit(1)
        .as("outcomeReason"),
      eb.selectFrom("messages").select("id").where("task_id", "=", id).as("messageId"),
    ])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  const policy = recordedOperationPolicy(task.operation, task.policy_version);
  if (!policy) throw new Error("Plan task policy unavailable.");
  return {
    agentId,
    state:
      task.state === "waiting_capacity"
        ? task.blocking_reason
          ? "blocked"
          : "queued"
        : task.state,
    connection: task.connection,
    blockingReason: task.blocking_reason,
    outcomeReason: task.outcomeReason,
    replyMessageId: task.messageId ? identifier(task.messageId) : null,
    maxAttemptDurationMs: policy.max_attempt_duration_ms,
    maxInactivityMs: policy.max_inactivity_ms,
  };
}

export async function readPlan(
  db: Kysely<ResearchSchema>,
  planId: string,
): Promise<Outcome<PlanSnapshot>> {
  const plan = await db
    .selectFrom("interventions as i")
    .selectAll("i")
    .select(planNeedsAttention.as("needs_attention"))
    .where("id", "=", bytes(planId))
    .where("kind", "=", "plan")
    .executeTakeFirst();
  if (!plan || plan.state === "invalid") return failure("record_not_found");
  const effective = await effectivePlan(db, plan);
  const limits = await db
    .selectFrom("intervention_limits")
    .select("max_requests")
    .where("intervention_id", "=", plan.id)
    .executeTakeFirst();
  const destinations =
    plan.state === "accepted"
      ? await db
          .selectFrom("intervention_operations")
          .select(["agent_id", "connection"])
          .where("intervention_id", "=", plan.id)
          .execute()
      : [];
  const nodes = await planContributions(db, plan.id);
  const edges = await holdingDependencies(db, plan.id);
  const throughSequence = await planSequence(db, plan.id);
  const continuation = await planContinuation(db, plan.id);
  const task = await readPlanTask(db, continuation?.task_id ?? null, "virgilio");
  const requestsUsed = await planRequestsUsed(db, plan.id);
  const nodeId = (id: Uint8Array | null) => (id ? identifier(id) : null);

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
      state: plan.state,
      connections: Object.fromEntries(
        destinations.map(({ agent_id, connection }) => [agent_id, connection]),
      ),
      maxRequests: limits?.max_requests ?? planLimits.max_requests,
      requestsUsed,
      needsAttention: !!plan.needs_attention,
      purpose: planText(
        effective.purpose,
        effective.purposeSource === plan.id
          ? `plan_purpose_${planId}`
          : `plan_change_purpose_${identifier(effective.purposeSource)}`,
      ),
      sharedContext: planText(
        effective.context,
        effective.contextSource === plan.id
          ? `plan_context_${planId}`
          : `plan_change_context_${identifier(effective.contextSource)}`,
      ),
      contributions: await Promise.all(
        nodes.map(async (node) => ({
          request: planText(node.request, `plan_request_${identifier(node.id)}`),
          reason: planText(node.reason, `plan_reason_${identifier(node.id)}`),
          failureReason: node.failure_reason,
          id: identifier(node.id),
          key: node.plan_key,
          agentId: node.agent_id,
          required: !!node.required,
          state: node.state,
          taskId: nodeId(node.task_id),
          task: await readPlanTask(db, node.task_id, node.agent_id),
          resultMessageId: nodeId(node.result_message_id),
          blockedBy: nodeId(node.blocked_by_contribution_id),
          restartHeld: !!node.restart_held,
          prerequisites: edges
            .filter((edge) => identifier(edge.contribution_id) === identifier(node.id))
            .map((edge) => identifier(edge.prerequisite_id)),
        })),
      ),
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
            taskState: task?.state ?? null,
            task,
            stopped: !!continuation.stopped,
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
