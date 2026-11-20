import { createHash } from "node:crypto";
import { failure, type AddContributionsPayload, type Outcome, utf8Size } from "@ohtia/contracts";
import { sql, type Kysely, type NotNull, type Selectable } from "kysely";
import { consultableAgents, type ContributionRow } from "./consultations.js";
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
  kind: "accepted" | "contributions_added";
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

function agents(mode: RuntimeMode, synthetic: boolean): readonly PlanAgent[] {
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

export function planContributions(db: Kysely<ResearchSchema>, id: Uint8Array) {
  return db
    .selectFrom("contributions")
    .selectAll()
    .where("intervention_id", "=", id)
    .where("plan_key", "is not", null)
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

function isPlanKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
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
): Promise<Outcome<Uint8Array>> {
  const requests: readonly unknown[] = payload.contributions;
  if (
    !Array.isArray(payload.contributions) ||
    !Number.isSafeInteger(payload.expectedGraphVersion) ||
    payload.expectedGraphVersion < 0
  )
    return failure("invalid_message");
  if (!requests.length) return failure("empty_plan");
  const creating = "conversationId" in payload;
  const targetId = creating ? payload.conversationId : payload.planId;
  if (!isEntityId(targetId)) return failure("invalid_message");
  const id = creating ? newId() : bytes(targetId);
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
  const enabled = agents(mode, !!conversation.is_development);
  const limits = existing ? await interventionLimits(db, id) : planLimits;
  if (!limits) return failure("limit_reached");
  const previous = existing ? await planContributions(db, id) : [];
  if (previous.length + requests.length > limits.max_contributions)
    return failure("plan_too_large");
  const byKey = new Map(previous.map((row) => [row.plan_key, row.id]));
  const keysById = new Map(previous.map((row) => [identifier(row.id), row.plan_key]));
  const edges = new Map<string, string[]>(previous.map((row) => [row.plan_key, []]));
  for (const dependency of existing ? await holdingDependencies(db, id) : []) {
    const child = keysById.get(identifier(dependency.contribution_id));
    const parent = keysById.get(identifier(dependency.prerequisite_id));
    const prerequisites = child ? edges.get(child) : undefined;
    if (!prerequisites || !parent) throw new Error("Stored dependency lacks a contribution.");
    prerequisites.push(parent);
  }
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
      !scalarText(entry.reason) ||
      !entry.reason.trim() ||
      Array.from(entry.reason).length > 500
    )
      return failure("invalid_message");
    if (!isPlanKey(entry.planKey)) return failure("plan_key_invalid");
    if (byKey.has(entry.planKey)) return failure("plan_key_duplicate");
    if (!entry.request.trim()) return failure("request_empty");
    if (utf8Size(entry.request) > 8192) return failure("request_too_large");
    const agent = enabled.find(({ id }) => id === entry.agent);
    const policy = agent && operationPolicy(agent.operation, agent.version, mode);
    if (existing && (!agent || !(await authorizedOperation(db, id, agent.id, agent.operation))))
      return failure("agent_not_authorized");
    if (!agent || !policy) return failure("agent_unavailable");
    policies.push(policy);
    if (!entry.prerequisites.every(isPlanKey)) return failure("unknown_prerequisite");
    const prerequisites = [...new Set(entry.prerequisites)];
    if (prerequisites.includes(entry.planKey)) return failure("self_dependency");
    if (prerequisites.length !== entry.prerequisites.length) return failure("invalid_message");
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
    const contributionId = newId();
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
  if (!topologicalOrder(edges)) return failure("cycle");

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

  const dependencies = contributions.flatMap(({ id: contributionId, plan_key }) =>
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

  if (creating) {
    await db
      .insertInto("interventions")
      .values({
        id,
        project_id: conversation.project_id,
        conversation_id: conversationId,
        kind: "plan",
        state: "accepted",
        invalid_reason: null,
        proposed_by_attempt_id: null,
        created_at: now,
        decided_at: now,
        decided_by_operation_id: operationId,
        revision: 1,
        graph_version: version,
        purpose: payload.purpose,
        shared_context: payload.sharedContext,
      })
      .execute();
    await authorizeWork(
      db,
      id,
      limits,
      [
        ...contributions.map(({ agent_id, operation }) => ({
          agent_id,
          operation,
          connection: resolveConnection(agent_id),
        })),
        {
          agent_id: "virgilio",
          operation: contributionSynthesisPolicy.operation,
          connection: resolveConnection("virgilio"),
        },
      ],
      now,
    );
    await reserveWork(db, id, null, contributionSynthesisPolicy, now);
  } else {
    await db
      .updateTable("interventions")
      .set({ graph_version: version, revision: sql`revision+1` })
      .where("id", "=", id)
      .execute();
  }
  // Insert in researcher order. All endpoints must exist before adding edges.
  for (const [index, contribution] of contributions.entries()) {
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
    if (!policy) throw new Error("Validated contribution lacks its policy.");
    await reserveWork(db, id, contribution.id, policy, now);
  }
  for (const dependency of dependencies)
    await db.insertInto("contribution_dependencies").values(dependency).execute();
  await db
    .insertInto("graph_changes")
    .values({
      id: newId(),
      intervention_id: id,
      graph_version: version,
      kind: creating ? "accepted" : "contributions_added",
      applied_by_operation_id: operationId,
      proposed_by_attempt_id: null,
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
    .select("shared_context")
    .where("id", "=", contribution.intervention_id)
    .executeTakeFirstOrThrow();
  const context = plan.shared_context
    ? `Context for every contribution of the plan:\n${plan.shared_context}\n\n`
    : "";
  const input: InputMessage[] = [
    {
      role: "user",
      reference: identifier(contribution.id),
      transferKind: "contribution_request",
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
