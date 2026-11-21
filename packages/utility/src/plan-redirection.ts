import { planChangeLimit, utf8Size, type PlanChangeInvalidReason } from "@ohtia/contracts";
import { sql, type Kysely, type Selectable } from "kysely";
import {
  contributionKey,
  holdingDependencies,
  isPlanKey,
  planAgents,
  planContributions,
  topologicalOrder,
} from "./contribution-graphs.js";
import type { InterventionRow } from "./consultations.js";
import { operationPolicy, type OperationPolicy } from "./operations.js";
import {
  effectivePlan,
  storedPlanChange,
  type PlanChange,
  type PlanChangeProposalRow,
} from "./plan-change-proposals.js";
import { canonicalJson, identifier, newId, type ResearchSchema } from "./research.js";
import type { RuntimeMode } from "./tasks.js";
import {
  authorizedOperation,
  interventionLimits,
  planRequestsUsed,
  reserveWork,
  workFits,
} from "./work-limits.js";

type Node = Awaited<ReturnType<typeof planContributions>>[number];
type Retired = { node: Node; replacement: Uint8Array | null };
type NewNode = {
  id: Uint8Array;
  key: string;
  request: string;
  reason: string;
  required: boolean;
  policy: OperationPolicy;
  agent: Node["agent_id"];
  operation: Node["operation"];
  dedupe: Uint8Array;
};
interface ValidatedChange {
  retired: Retired[];
  added: NewNode[];
  previousEdges: Awaited<ReturnType<typeof holdingDependencies>>;
  ids: Map<string, Uint8Array>;
  edges: Map<string, string[]>;
  expectedStates: string;
  previewStates: Record<string, unknown>;
  maxRequests: number;
}

export async function validatePlanChange(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
  change: PlanChange,
  mode: RuntimeMode,
  expected?: { version: number; states?: string },
): Promise<ValidatedChange | PlanChangeInvalidReason> {
  if (plan.outcome || (expected && expected.version !== plan.graph_version)) return "plan_moved_on";
  const count =
    Number(change.new_purpose !== "") +
    Number(change.replace_shared_context) +
    change.remove.length +
    change.replace.length +
    change.add.length;
  if (count > planChangeLimit) return "too_many_changes";
  if (!count) return "empty_change";
  const keys = [
    ...change.remove,
    ...change.replace.map(({ key }) => key),
    ...change.add.map(({ key }) => key),
  ];
  if (keys.some((key) => !isPlanKey(key))) return "plan_key_invalid";
  if (new Set(keys).size !== keys.length) return "plan_key_duplicate";

  const all = await planContributions(db, plan.id, true);
  const nodes = all.filter(({ superseded_by_contribution_id }) => !superseded_by_contribution_id);
  const byKey = new Map(nodes.map((node) => [node.plan_key, node]));
  const byId = new Map(nodes.map((node) => [identifier(node.id), node.plan_key]));
  const retiredKeys = new Set(
    nodes
      .filter(({ cancellation_reason }) => cancellation_reason === "removed_by_researcher")
      .map(({ plan_key }) => plan_key),
  );
  const touched = [...change.remove, ...change.replace.map(({ key }) => key)].map((key) =>
    byKey.get(key),
  );
  if (touched.some((node) => !node)) return "unknown_contribution";
  const targets = touched.filter((node): node is Node => node !== undefined);
  const current = nodes.filter(
    ({ plan_key }) =>
      !retiredKeys.has(plan_key) || change.replace.some(({ key }) => key === plan_key),
  );
  const taskIds = current.flatMap((node) => (node.task_id ? [node.task_id] : []));
  const taskStates = taskIds.length
    ? await db
        .selectFrom("tasks")
        .select(["id", "state", "blocking_reason"])
        .select((eb) =>
          eb
            .selectFrom("attempts")
            .select(({ fn }) => fn.max<number>("attempt_number").as("attempt_count"))
            .whereRef("attempts.task_id", "=", "tasks.id")
            .as("attemptCount"),
        )
        .where("id", "in", taskIds)
        .execute()
    : [];
  const states = new Map(taskStates.map((task) => [identifier(task.id), task]));
  const previewStates = current.map((node) => {
    const taskId = node.task_id && identifier(node.task_id);
    const task = taskId ? states.get(taskId) : undefined;
    return [
      node.plan_key,
      {
        state: node.state,
        taskId,
        taskState: task?.state ?? null,
        attemptCount: task?.attemptCount ?? 0,
        blockingReason: task?.blocking_reason ?? null,
        blockedBy: node.blocked_by_contribution_id
          ? (byId.get(identifier(node.blocked_by_contribution_id)) ?? null)
          : null,
        restartHeld: !!node.restart_held,
      },
    ] as const;
  });
  const touchedKeys = new Set(targets.map(({ plan_key }) => plan_key));
  const expectedStates = canonicalJson(
    Object.fromEntries(previewStates.filter(([key]) => touchedKeys.has(key))),
  );
  if (expected?.states !== undefined && expected.states !== expectedStates) return "plan_moved_on";
  if (targets.some(({ state }) => state === "completed")) return "contribution_completed";
  if (change.remove.some((key) => retiredKeys.has(key))) return "empty_change";
  if (change.add.some(({ key }) => byKey.has(key))) return "plan_key_duplicate";

  const effective = await effectivePlan(db, plan);
  if (change.new_purpose !== "") {
    if (!change.new_purpose.trim() || change.new_purpose.includes("\0")) return "purpose_empty";
    if (Array.from(change.new_purpose).length > 2000) return "purpose_too_long";
    if (change.new_purpose === effective.purpose) return "empty_change";
  }
  if (change.replace_shared_context) {
    if (utf8Size(change.shared_context) > 32768) return "shared_context_too_large";
    if (change.shared_context === effective.context) return "empty_change";
  }
  const limits = await interventionLimits(db, plan.id);
  if (!limits) return "limit_reached";
  const removed = new Set([...retiredKeys, ...change.remove]);
  for (const { key } of change.replace) removed.delete(key);
  const replaced = new Set(change.replace.map(({ key }) => key));
  const retained = nodes.filter(
    ({ plan_key }) => !removed.has(plan_key) && !replaced.has(plan_key),
  );
  const previousEdges = await holdingDependencies(db, plan.id);
  const ids = new Map(retained.map(({ plan_key, id }) => [plan_key, id]));
  const originalEdges = new Map(nodes.map(({ plan_key }) => [plan_key, [] as string[]]));
  for (const edge of previousEdges) {
    const child = byId.get(identifier(edge.contribution_id));
    const parent = byId.get(identifier(edge.prerequisite_id));
    if (!child || !parent) throw new Error("Holding plan dependency lacks its contribution.");
    originalEdges.get(child)?.push(parent);
  }
  const edges = new Map(
    retained.map(({ plan_key }) => [plan_key, originalEdges.get(plan_key) ?? []]),
  );
  const dedupe = new Set(retained.map(({ dedupe_key }) => Buffer.from(dedupe_key).toString("hex")));
  const project = await db
    .selectFrom("projects")
    .select("is_development")
    .where("id", "=", plan.project_id)
    .executeTakeFirstOrThrow();
  const agents = planAgents(mode, !!project.is_development);
  const added: NewNode[] = [];
  for (const entry of [...change.replace, ...change.add]) {
    if (!entry.request.trim() || entry.request.includes("\0")) return "request_empty";
    if (utf8Size(entry.request) > 8192) return "request_too_large";
    if (!entry.reason.trim() || entry.reason.includes("\0")) return "reason_empty";
    if (Array.from(entry.reason).length > 500) return "reason_too_long";
    if (!entry.depends_on.every(isPlanKey)) return "unknown_prerequisite";
    const prerequisites = [...new Set(entry.depends_on)];
    if (prerequisites.includes(entry.key)) return "self_dependency";
    const previous = byKey.get(entry.key);
    if (
      previous &&
      !retiredKeys.has(entry.key) &&
      entry.request === previous.request &&
      entry.reason === previous.reason &&
      entry.required === !!previous.required &&
      canonicalJson([...prerequisites].sort()) ===
        canonicalJson([...(originalEdges.get(entry.key) ?? [])].sort())
    )
      return "empty_change";
    const agent = agents.find(
      ({ id }) => id === ("agent" in entry ? entry.agent : previous?.agent_id),
    );
    const policy = agent && operationPolicy(agent.operation, agent.version, mode);
    if (!agent || !policy || !(await authorizedOperation(db, plan.id, agent.id, agent.operation)))
      return "agent_not_authorized";
    const key = contributionKey(
      agent.id,
      agent.operation,
      policy.version,
      entry.request,
      prerequisites,
    );
    if (dedupe.has(key.toString("hex"))) return "duplicate_contribution";
    dedupe.add(key.toString("hex"));
    const id = newId();
    ids.set(entry.key, id);
    edges.set(entry.key, prerequisites);
    added.push({
      id,
      key: entry.key,
      request: entry.request,
      reason: entry.reason,
      required: entry.required,
      policy,
      agent: agent.id,
      operation: agent.operation,
      dedupe: key,
    });
  }
  if (!edges.size) return "empty_plan";
  if (
    edges.size > limits.max_contributions ||
    [...edges.values()].reduce((sum, deps) => sum + deps.length, 0) > limits.max_dependencies
  )
    return "plan_too_large";
  for (const deps of edges.values()) {
    if (deps.some((key) => removed.has(key))) return "dependency_removed";
    if (deps.some((key) => !edges.has(key))) return "unknown_prerequisite";
  }
  if (!topologicalOrder(edges)) return "cycle";
  if (
    !(await workFits(
      db,
      limits,
      added.map(({ policy }) => policy),
      plan.id,
      targets.map(({ id }) => id),
    ))
  )
    return "limit_reached";
  return {
    retired: targets.map((node) => ({
      node,
      replacement: replaced.has(node.plan_key) ? (ids.get(node.plan_key) ?? null) : null,
    })),
    added,
    previousEdges,
    ids,
    edges,
    expectedStates,
    previewStates: Object.fromEntries(previewStates),
    maxRequests: limits.max_requests,
  };
}

export async function recordPlanChangeProposal(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
  expectedVersion: number,
  attempt: Uint8Array,
  decoded: { change: string; invalid?: PlanChangeInvalidReason | undefined },
  mode: RuntimeMode,
  now: string,
) {
  const checked =
    decoded.invalid ??
    (await validatePlanChange(db, plan, storedPlanChange(decoded.change), mode, {
      version: expectedVersion,
    }));
  const invalid = typeof checked === "string" ? checked : null;
  if (!invalid)
    await db
      .updateTable("graph_change_proposals")
      .set({ state: "replaced", decided_at: now })
      .where("intervention_id", "=", plan.id)
      .where("state", "=", "proposed")
      .execute();
  await db
    .insertInto("graph_change_proposals")
    .values({
      id: newId(),
      intervention_id: plan.id,
      proposed_by_attempt_id: attempt,
      change: decoded.change,
      expected_graph_version: expectedVersion,
      expected_states: typeof checked === "string" ? "{}" : checked.expectedStates,
      preview_states:
        typeof checked === "string"
          ? "{}"
          : canonicalJson({
              rows: checked.previewStates,
              additionalRequests: checked.added.reduce(
                (total, { policy }) => total + policy.max_attempts,
                0,
              ),
              remainingRequests: checked.maxRequests - (await planRequestsUsed(db, plan.id)),
              maxRequests: checked.maxRequests,
            }),
      state: invalid ? "invalid" : "proposed",
      invalid_reason: invalid,
      created_at: now,
      decided_at: invalid ? now : null,
      decided_by_operation_id: null,
    })
    .execute();
}

export async function writePlanChange(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
  proposal: Selectable<PlanChangeProposalRow>,
  checked: ValidatedChange,
  operationId: string,
  now: string,
) {
  const version = plan.graph_version + 1;
  await db
    .updateTable("interventions")
    .set({ graph_version: version, revision: sql`revision+1` })
    .where("id", "=", plan.id)
    .execute();
  for (const entry of checked.added) {
    await db
      .insertInto("contributions")
      .values({
        id: entry.id,
        intervention_id: plan.id,
        task_id: null,
        agent_id: entry.agent,
        operation: entry.operation,
        policy_version: entry.policy.version,
        request: entry.request,
        reason: entry.reason,
        plan_key: entry.key,
        required: Number(entry.required),
        dedupe_key: entry.dedupe,
        added_in_graph_version: version,
        created_at: now,
      })
      .execute();
    await reserveWork(db, plan.id, entry.id, entry.policy, now);
  }
  const pair = (child: Uint8Array, parent: Uint8Array) =>
    identifier(child) + "/" + identifier(parent);
  const holding = new Map(
    checked.previousEdges.map((edge) => [
      pair(edge.contribution_id, edge.prerequisite_id),
      edge.id,
    ]),
  );
  for (const [key, deps] of checked.edges) {
    const child = checked.ids.get(key);
    if (!child) throw new Error("Validated contribution lacks its identity.");
    for (const dependency of deps) {
      const parent = checked.ids.get(dependency);
      if (!parent) throw new Error("Validated prerequisite lacks its identity.");
      if (holding.delete(pair(child, parent))) continue;
      await db
        .insertInto("contribution_dependencies")
        .values({
          id: newId(),
          intervention_id: plan.id,
          contribution_id: child,
          prerequisite_id: parent,
          added_in_graph_version: version,
          removed_in_graph_version: null,
        })
        .execute();
    }
  }
  if (holding.size)
    await db
      .updateTable("contribution_dependencies")
      .set({ removed_in_graph_version: version })
      .where("id", "in", [...holding.values()])
      .execute();
  await db
    .insertInto("graph_changes")
    .values({
      id: newId(),
      intervention_id: plan.id,
      graph_version: version,
      kind: "plan_changed",
      proposal_id: proposal.id,
      proposed_by_attempt_id: proposal.proposed_by_attempt_id,
      applied_by_operation_id: operationId,
      created_at: now,
      summary: canonicalJson({
        contributions: checked.added.map(({ id }) => identifier(id)),
        retired: checked.retired.map(({ node }) => ({
          id: identifier(node.id),
          previousCancellationReason: node.cancellation_reason,
        })),
      }),
    })
    .execute();
}
