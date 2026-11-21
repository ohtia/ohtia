import { createHash } from "node:crypto";
import { failure, type AddContributionsPayload, type Outcome, utf8Size } from "@ohtia/contracts";
import { sql, type Generated, type Kysely, type NotNull, type Selectable } from "kysely";
import { consultableAgents, type ContributionRow, type InterventionRow } from "./consultations.js";
import {
  operationPolicy,
  contributionSynthesisPolicy,
  type InputMessage,
  type OperationPolicy,
} from "./operations.js";
import {
  authorizedOperation,
  authorizeWork,
  interventionLimits,
  planLimits,
  reserveWork,
  workFits,
} from "./work-limits.js";
import type { ReplyAgent } from "@ohtia/contracts";
import {
  bytes,
  canonicalJson,
  identifier,
  isEntityId,
  newId,
  type ResearchSchema,
} from "./research.js";
import { effectivePlan, storedPlanChange } from "./plan-change-proposals.js";
import type { RuntimeMode } from "./tasks.js";

export interface DependencyRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  contribution_id: Uint8Array;
  prerequisite_id: Uint8Array;
  added_in_graph_version: number;
  removed_in_graph_version: number | null;
}

export interface GraphChangeRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  graph_version: number;
  kind: "accepted" | "contributions_added" | "plan_changed";
  proposal_id: Generated<Uint8Array | null>;
  applied_by_operation_id: string;
  proposed_by_attempt_id: Uint8Array | null;
  summary: string;
  created_at: string;
}

const testAgents = [
  {
    id: "josefa",
    name: "Josefa",
    role: "the reference librarian",
    operation: "development_test",
    version: 2,
  },
  {
    id: "virgilio",
    name: "Virgilio",
    role: "the research guide",
    operation: "development_test",
    version: 3,
  },
] as const;
type PlanAgent = ReturnType<typeof consultableAgents>[number] | (typeof testAgents)[number];

export function planAgents(mode: RuntimeMode, synthetic: boolean): readonly PlanAgent[] {
  return synthetic ? (mode === "development" ? testAgents : []) : consultableAgents(mode);
}

export function contributionKey(
  agent: string,
  operation: string,
  policyVersion: number,
  request: string,
  prerequisites: readonly string[],
): Buffer {
  return createHash("sha256")
    .update(
      canonicalJson({
        agent,
        operation,
        policyVersion,
        request,
        prerequisites: [...prerequisites].sort(),
      }),
    )
    .digest();
}

export function planContributions(
  db: Kysely<ResearchSchema>,
  id: Uint8Array,
  includeHistory = false,
) {
  return db
    .selectFrom("contributions")
    .selectAll()
    .where("intervention_id", "=", id)
    .where("plan_key", "is not", null)
    .$if(!includeHistory, (query) =>
      query
        .where("superseded_by_contribution_id", "is", null)
        .where(sql<boolean>`cancellation_reason IS NOT 'removed_by_researcher'`),
    )
    .$narrowType<{ plan_key: NotNull }>()
    .orderBy(sql`rowid`)
    .execute();
}

export function holdingDependencies(db: Kysely<ResearchSchema>, id: Uint8Array) {
  return db
    .selectFrom("contribution_dependencies")
    .selectAll()
    .where("intervention_id", "=", id)
    .where("removed_in_graph_version", "is", null)
    .execute();
}

function scalarText(value: unknown): value is string {
  return typeof value === "string" && !/[\0\uD800-\uDFFF]/u.test(value);
}

export function isPlanKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}(?![\s\S])/.test(value);
}

/** Prerequisites precede their dependents. Map insertion order breaks ties. */
export function topologicalOrder(
  edges: ReadonlyMap<string, readonly string[]>,
): string[] | undefined {
  const unmet = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const ready: string[] = [];
  for (const [key, prerequisites] of edges) {
    unmet.set(key, prerequisites.length);
    if (!prerequisites.length) ready.push(key);
    for (const prerequisite of prerequisites) {
      const children = dependents.get(prerequisite) ?? [];
      children.push(key);
      dependents.set(prerequisite, children);
    }
  }
  for (const key of ready)
    for (const dependent of dependents.get(key) ?? []) {
      const remaining = (unmet.get(dependent) ?? 0) - 1;
      unmet.set(dependent, remaining);
      if (!remaining) ready.push(dependent);
    }
  return ready.length === edges.size ? ready : undefined;
}

/** Internal acceptance and additive graph changes share the same validation and audit records. */
export async function addContributions(
  db: Kysely<ResearchSchema>,
  payload: AddContributionsPayload,
  mode: RuntimeMode,
  resolveConnection: (agent: ReplyAgent) => string,
  operationId: string,
  now: string,
  approval?:
    | { readonly kind: "proposal"; readonly attempt: Uint8Array }
    | {
        readonly kind: "acceptance";
        readonly plan: Selectable<InterventionRow>;
        readonly connections: Readonly<Partial<Record<ReplyAgent, string>>>;
        readonly inFlightReply: Uint8Array | null;
      },
): Promise<Outcome<Uint8Array>> {
  const requests: readonly unknown[] = payload.contributions;
  if (
    !Array.isArray(payload.contributions) ||
    !Number.isSafeInteger(payload.expectedGraphVersion) ||
    payload.expectedGraphVersion < 0
  )
    return failure("invalid_message");
  if (!requests.length) return failure("empty_plan");
  if (approval && requests.length === 1) return failure("too_few_contributions");
  const creating = "conversationId" in payload;
  const targetId = creating ? payload.conversationId : payload.planId;
  if (!isEntityId(targetId)) return failure("invalid_message");
  const acceptedProposal = approval?.kind === "acceptance" ? approval.plan : undefined;
  const id = acceptedProposal?.id ?? (creating ? newId() : bytes(targetId));
  const existing = creating
    ? undefined
    : await db
        .selectFrom("interventions")
        .selectAll()
        .where("id", "=", id)
        .where("kind", "=", "plan")
        .where("state", "=", "accepted")
        .executeTakeFirst();
  if (!creating && !existing) return failure("record_not_found");
  if ((existing?.graph_version ?? 0) !== payload.expectedGraphVersion)
    return failure("graph_version_conflict");
  if (existing?.outcome) return failure("plan_state_changed");
  if (creating) {
    if (!scalarText(payload.purpose) || !scalarText(payload.sharedContext))
      return failure("invalid_message");
    if (!payload.purpose.trim()) return failure("purpose_empty");
    if (Array.from(payload.purpose).length > 2000) return failure("purpose_too_long");
    if (utf8Size(payload.sharedContext) > 32768) return failure("shared_context_too_large");
  }
  const conversationId = existing?.conversation_id ?? bytes(targetId);
  const conversation = await db
    .selectFrom("conversations as c")
    .innerJoin("projects as p", "p.id", "c.project_id")
    .select(["c.project_id", "p.is_development", "p.setup_confirmed_at"])
    .where("c.id", "=", conversationId)
    .executeTakeFirst();
  if (!conversation) return failure("record_not_found");
  if (!conversation.is_development && !conversation.setup_confirmed_at)
    return failure("agent_unavailable");
  const enabled = planAgents(mode, !!conversation.is_development);
  const limits = existing ? await interventionLimits(db, id) : planLimits;
  if (!limits) return failure("limit_reached");
  const previous = existing ? await planContributions(db, id) : [];
  if (previous.length + requests.length > limits.max_contributions)
    return failure("plan_too_large");
  const byKey = new Map(previous.map((row) => [row.plan_key, row.id]));
  const retiredKeys = existing
    ? new Set(
        (await planContributions(db, id, true))
          .filter((node) => node.cancellation_reason === "removed_by_researcher")
          .map((node) => node.plan_key),
      )
    : new Set<string>();
  const keysById = new Map(previous.map((row) => [identifier(row.id), row.plan_key]));
  const edges = new Map<string, string[]>(previous.map((row) => [row.plan_key, []]));
  for (const dependency of existing ? await holdingDependencies(db, id) : []) {
    const child = keysById.get(identifier(dependency.contribution_id));
    const parent = keysById.get(identifier(dependency.prerequisite_id));
    const prerequisites = child ? edges.get(child) : undefined;
    if (!prerequisites || !parent) throw new Error("Stored dependency lacks a contribution.");
    prerequisites.push(parent);
  }
  const proposedNodes = acceptedProposal ? await planContributions(db, id) : [];
  const proposedEdges = acceptedProposal ? await holdingDependencies(db, id) : [];
  const proposedIds = new Map(proposedNodes.map((row) => [row.plan_key, row.id]));
  const dedupe = new Set(previous.map((row) => Buffer.from(row.dedupe_key).toString("hex")));
  const version = payload.expectedGraphVersion + 1;
  const contributions: Array<{
    id: Uint8Array;
    agent_id: PlanAgent["id"];
    operation: PlanAgent["operation"];
    policy_version: number;
    request: string;
    reason: string;
    plan_key: string;
    required: number;
    dedupe_key: Uint8Array;
  }> = [];
  const policies: OperationPolicy[] = [];
  let dependencyCount = [...edges.values()].reduce(
    (total, prerequisites) => total + prerequisites.length,
    0,
  );
  for (const request of requests) {
    if (request === null || typeof request !== "object" || Array.isArray(request))
      return failure("invalid_message");
    const entry = request as Record<string, unknown>;
    if (
      Object.keys(entry).some(
        (key) =>
          !["agent", "planKey", "request", "reason", "required", "prerequisites"].includes(key),
      ) ||
      (entry.required !== undefined && typeof entry.required !== "boolean") ||
      !Array.isArray(entry.prerequisites) ||
      !scalarText(entry.request) ||
      (!approval &&
        (!scalarText(entry.reason) ||
          !entry.reason.trim() ||
          Array.from(entry.reason).length > 500))
    )
      return failure("invalid_message");
    if (!isPlanKey(entry.planKey)) return failure("plan_key_invalid");
    if (byKey.has(entry.planKey) || retiredKeys.has(entry.planKey))
      return failure("plan_key_duplicate");
    if (!entry.request.trim()) return failure("request_empty");
    if (utf8Size(entry.request) > 8192) return failure("request_too_large");
    if (!scalarText(entry.reason) || !entry.reason.trim()) return failure("reason_empty");
    if (Array.from(entry.reason).length > 500) return failure("reason_too_long");
    const agent = enabled.find(({ id }) => id === entry.agent);
    const policy = agent && operationPolicy(agent.operation, agent.version, mode);
    if (existing && (!agent || !(await authorizedOperation(db, id, agent.id, agent.operation))))
      return failure("agent_not_authorized");
    if (!agent || !policy) return failure("agent_unavailable");
    policies.push(policy);
    if (!entry.prerequisites.every(isPlanKey)) return failure("unknown_prerequisite");
    const prerequisites = [...new Set(entry.prerequisites)];
    if (prerequisites.includes(entry.planKey)) return failure("self_dependency");
    if (!approval && prerequisites.length !== entry.prerequisites.length)
      return failure("invalid_message");
    dependencyCount += prerequisites.length;
    if (dependencyCount > limits.max_dependencies) return failure("plan_too_large");
    const key = contributionKey(
      agent.id,
      agent.operation,
      agent.version,
      entry.request,
      prerequisites,
    );
    if (dedupe.has(key.toString("hex"))) return failure("duplicate_contribution");
    dedupe.add(key.toString("hex"));
    const contributionId = proposedIds.get(entry.planKey) ?? newId();
    byKey.set(entry.planKey, contributionId);
    edges.set(entry.planKey, prerequisites);
    contributions.push({
      id: contributionId,
      agent_id: agent.id,
      operation: agent.operation,
      policy_version: agent.version,
      request: entry.request,
      reason: entry.reason,
      plan_key: entry.planKey,
      required: entry.required === false ? 0 : 1,
      dedupe_key: key,
    });
  }
  for (const { plan_key: key } of contributions)
    if (edges.get(key)?.some((prerequisite) => !byKey.has(prerequisite)))
      return failure("unknown_prerequisite");
  const order = topologicalOrder(edges);
  if (!order) return failure("cycle");

  // Only the coordinator can add work. Prerequisite chains do not add delegation levels.
  if (
    !(await workFits(
      db,
      limits,
      creating ? [...policies, contributionSynthesisPolicy] : policies,
      existing?.id,
    ))
  )
    return failure("limit_reached");

  const dependencies = acceptedProposal
    ? proposedEdges
    : contributions.flatMap(({ id: contributionId, plan_key }) =>
        (edges.get(plan_key) ?? []).map((prerequisite) => {
          const prerequisiteId = byKey.get(prerequisite);
          if (!prerequisiteId) throw new Error("Validated prerequisite lacks an identity.");
          return {
            id: newId(),
            intervention_id: id,
            contribution_id: contributionId,
            prerequisite_id: prerequisiteId,
            added_in_graph_version: version,
            removed_in_graph_version: null,
          };
        }),
      );
  const summary = canonicalJson({
    contributions: contributions.map(({ id }) => identifier(id)),
    dependencies: dependencies.map(({ id }) => identifier(id)),
  });
  if (utf8Size(summary) > 16384) return failure("input_too_large");

  const proposing = approval?.kind === "proposal";
  const destinations = [
    ...contributions.map(({ agent_id, operation }) => ({
      agent_id,
      operation,
      connection: resolveConnection(agent_id),
    })),
    {
      agent_id: "virgilio" as const,
      operation: contributionSynthesisPolicy.operation,
      connection: resolveConnection("virgilio"),
    },
  ];
  if (approval?.kind === "acceptance") {
    const agents = new Set(destinations.map(({ agent_id }) => agent_id));
    if (
      Object.keys(approval.connections).length !== agents.size ||
      destinations.some(({ agent_id, connection }) => approval.connections[agent_id] !== connection)
    )
      return failure("destination_changed");
    const initial = new Map<OperationPolicy, number>();
    for (const [index, node] of contributions.entries()) {
      const policy = policies[index];
      if (policy && !edges.get(node.plan_key)?.length)
        initial.set(policy, (initial.get(policy) ?? 0) + 1);
    }
    for (const [policy, needed] of initial) {
      const { count } = await db
        .selectFrom("tasks")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("operation", "=", policy.operation)
        .where("state", "in", ["queued", "blocked"])
        .executeTakeFirstOrThrow();
      if (count + needed > policy.max_pending_tasks) return failure("pending_limit_reached");
    }
    await db
      .updateTable("interventions")
      .set({
        state: "accepted",
        graph_version: version,
        decided_at: now,
        decided_by_operation_id: operationId,
        approved_during_attempt_id: approval.inFlightReply,
        revision: sql`revision+1`,
      })
      .where("id", "=", id)
      .execute();
  } else if (creating) {
    if (proposing)
      await db
        .updateTable("interventions")
        .set({ state: "replaced", decided_at: now, revision: sql`revision+1` })
        .where("conversation_id", "=", conversationId)
        .where("state", "=", "proposed")
        .execute();
    const prior = await latestAcceptedPlan(db, conversationId);
    await db
      .insertInto("interventions")
      .values({
        id,
        project_id: conversation.project_id,
        conversation_id: conversationId,
        kind: "plan",
        state: proposing ? "proposed" : "accepted",
        invalid_reason: null,
        proposed_by_attempt_id: proposing ? approval.attempt : null,
        created_at: now,
        decided_at: proposing ? null : now,
        decided_by_operation_id: proposing ? null : operationId,
        revision: 1,
        graph_version: proposing ? 0 : version,
        previous_plan_id: prior?.outcome ? prior.id : null,
        purpose: payload.purpose,
        shared_context: payload.sharedContext,
      })
      .execute();
  } else {
    await db
      .updateTable("interventions")
      .set({ graph_version: version, revision: sql`revision+1` })
      .where("id", "=", id)
      .execute();
  }
  if (creating && !proposing) {
    await authorizeWork(db, id, limits, destinations, now);
    await reserveWork(db, id, null, contributionSynthesisPolicy, now);
  }
  // Store the proposal in execution order. All endpoints must exist before adding edges.
  if (proposing)
    contributions.sort(
      (left, right) => order.indexOf(left.plan_key) - order.indexOf(right.plan_key),
    );
  for (const [index, contribution] of contributions.entries()) {
    if (!acceptedProposal)
      await db
        .insertInto("contributions")
        .values({
          ...contribution,
          intervention_id: id,
          added_in_graph_version: version,
          task_id: null,
          created_at: now,
        })
        .execute();
    const policy = policies[index];
    if (proposing) continue;
    if (!policy) throw new Error("Validated contribution lacks its policy.");
    await reserveWork(db, id, contribution.id, policy, now);
  }
  if (!acceptedProposal)
    for (const dependency of dependencies)
      await db.insertInto("contribution_dependencies").values(dependency).execute();
  if (proposing) return { ok: true, value: id };
  await db
    .insertInto("graph_changes")
    .values({
      id: newId(),
      intervention_id: id,
      graph_version: version,
      kind: creating ? "accepted" : "contributions_added",
      applied_by_operation_id: operationId,
      proposed_by_attempt_id: acceptedProposal?.proposed_by_attempt_id ?? null,
      summary,
      created_at: now,
    })
    .execute();
  return { ok: true, value: id };
}

/** Freeze the dependency identities and completed results when a contribution becomes ready. */
export async function readyInputs(
  db: Kysely<ResearchSchema>,
  id: Uint8Array,
): Promise<string | undefined> {
  const rows = await db
    .selectFrom("contribution_dependencies as d")
    .innerJoin("contributions as c", "c.id", "d.prerequisite_id")
    .leftJoin("messages as m", "m.id", "c.result_message_id")
    .select([
      "d.id",
      "c.state",
      "c.task_id",
      "m.id as result",
      "m.task_id as result_task",
      "m.ending",
    ])
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom("tasks as t")
            .select("t.id")
            .whereRef("t.replaces_task_id", "=", "c.task_id"),
        )
        .as("superseded"),
    )
    .where("d.contribution_id", "=", id)
    .where("d.removed_in_graph_version", "is", null)
    .orderBy("d.id")
    .execute();
  const inputs = [];
  for (const row of rows) {
    if (
      row.state !== "completed" ||
      !row.result ||
      !row.result_task ||
      !row.task_id ||
      row.ending !== "complete" ||
      row.superseded ||
      identifier(row.result_task) !== identifier(row.task_id)
    )
      return;
    inputs.push([identifier(row.id), identifier(row.result)]);
  }
  return JSON.stringify(inputs);
}

export async function planInput(
  db: Kysely<ResearchSchema>,
  contribution: Selectable<ContributionRow>,
  policy: OperationPolicy,
): Promise<InputMessage[] | undefined> {
  if (contribution.plan_key === null) throw new Error("Plan contribution lacks a key.");
  const plan = await db
    .selectFrom("interventions")
    .select(["id", "purpose", "shared_context"])
    .where("id", "=", contribution.intervention_id)
    .executeTakeFirstOrThrow();
  const source = contribution.context_proposal_id
    ? await db
        .selectFrom("graph_change_proposals")
        .select(["id", "change"])
        .where("id", "=", contribution.context_proposal_id)
        .executeTakeFirstOrThrow()
    : undefined;
  const effective = contribution.task_id
    ? {
        context: source
          ? storedPlanChange(source.change).shared_context
          : (plan.shared_context ?? ""),
        contextSource: source?.id ?? plan.id,
      }
    : await effectivePlan(db, plan);
  const context = effective.context
    ? `Context for every contribution of the plan:\n${effective.context}\n\n`
    : "";
  const input: InputMessage[] = [
    {
      role: "user",
      reference: identifier(contribution.id),
      transferKind: "contribution_request",
      planContext: identifier(effective.contextSource),
      text:
        "This request comes from a plan by Virgilio, the research guide. The researcher approved it and cannot answer questions in this reply.\n\n" +
        context +
        `Your contribution (${contribution.plan_key}):\n${contribution.request}`,
    },
  ];
  const results = await db
    .selectFrom("contribution_dependencies as d")
    .innerJoin("contributions as c", "c.id", "d.prerequisite_id")
    .leftJoin("messages as m", "m.id", "c.result_message_id")
    .select(["c.plan_key", "c.agent_id", "m.id", "m.content"])
    .where("d.contribution_id", "=", contribution.id)
    .where("d.removed_in_graph_version", "is", null)
    .orderBy(sql`c.rowid`)
    .execute();
  for (const result of results) {
    const agent = [...consultableAgents("development"), ...testAgents].find(
      ({ id }) => id === result.agent_id,
    );
    if (!agent || result.plan_key === null || result.id === null || result.content === null)
      throw new Error("Invalid prerequisite contribution.");
    input.push({
      role: "user",
      reference: identifier(result.id),
      text: `Result of contribution ${result.plan_key} by ${agent.name}, ${agent.role}:\n${result.content}`,
    });
  }
  if (
    input.length > policy.max_input_items ||
    input.reduce((sum, item) => sum + utf8Size(item.text), 0) > policy.max_input_bytes
  )
    return;
  return input;
}

export function waitingForPlanWork(state: Selectable<ContributionRow>["state"]): boolean {
  return state === "waiting" || state === "active";
}

export function latestAcceptedPlan(db: Kysely<ResearchSchema>, conversation: Uint8Array) {
  return db
    .selectFrom("interventions")
    .selectAll()
    .where("conversation_id", "=", conversation)
    .where("kind", "=", "plan")
    .where("state", "=", "accepted")
    .orderBy(sql`rowid DESC`)
    .executeTakeFirst();
}
