import {
  failure,
  isResearchId,
  isReplyAgent,
  splitText,
  type Outcome,
  type PlanChangePreview,
  type PlanChangeRequest,
  type PlanChangeRow,
  type ReplyAgent,
  type TimelinePlanChangeProposal,
} from "@ohtia/contracts";
import type { Kysely } from "kysely";
import { planContributions } from "./contribution-graphs.js";
import { planText } from "./plan-coordination.js";
import { planChangeRevision, storedPlanChange } from "./plan-change-proposals.js";
import { bytes, identifier, type ResearchSchema } from "./research.js";

const sourcePattern =
  /^plan_change_(purpose|context|request|reason)_([0-9a-f-]+)(?:_(add|replace)_([0-7]))?$/;

export async function readPlanChangePart(
  db: Kysely<ResearchSchema>,
  source: string,
  index: number,
): Promise<Outcome<{ readonly text: string }>> {
  const [, field, id, group, offset] = sourcePattern.exec(source) ?? [];
  if (!isResearchId(id)) return failure("record_not_found");
  const proposal = await db
    .selectFrom("graph_change_proposals")
    .select("change")
    .where("id", "=", bytes(id))
    .where("state", "!=", "invalid")
    .executeTakeFirst();
  if (!proposal) return failure("record_not_found");
  const change = storedPlanChange(proposal.change);
  const entry = group === "add" || group === "replace" ? change[group][Number(offset)] : undefined;
  const value =
    field === "purpose" && !group && change.new_purpose
      ? change.new_purpose
      : field === "context" && !group && change.replace_shared_context
        ? change.shared_context
        : field === "request" || field === "reason"
          ? entry?.[field]
          : undefined;
  const text = value === undefined ? undefined : splitText(value)[index - 1];
  return text === undefined ? failure("record_not_found") : { ok: true, value: { text } };
}

function proposalInConversation(db: Kysely<ResearchSchema>, conversationId: string, id: string) {
  return db
    .selectFrom("graph_change_proposals as p")
    .innerJoin("interventions as i", "i.id", "p.intervention_id")
    .innerJoin("attempts as a", "a.id", "p.proposed_by_attempt_id")
    .innerJoin("tasks as t", "t.id", "a.task_id")
    .selectAll("p")
    .select(["t.id as task_id", "t.reply_position"])
    .where("p.id", "=", bytes(id))
    .where("i.conversation_id", "=", bytes(conversationId))
    .executeTakeFirst();
}

export async function readPlanChangeTimelineItem(
  db: Kysely<ResearchSchema>,
  conversationId: string,
  id: string,
): Promise<TimelinePlanChangeProposal | undefined> {
  const proposal = await proposalInConversation(db, conversationId, id);
  if (!proposal || proposal.reply_position === null) return;
  return {
    kind: "planChangeProposal",
    rank: 2,
    id,
    position: proposal.reply_position,
    revision: planChangeRevision(proposal.state),
    taskId: identifier(proposal.task_id),
    state: proposal.state,
    invalidReason: proposal.invalid_reason,
  };
}

export async function readPlanChangePreview(
  db: Kysely<ResearchSchema>,
  conversationId: string,
  id: string,
): Promise<Outcome<PlanChangePreview & { readonly proposalId: string }>> {
  const proposal = await proposalInConversation(db, conversationId, id);
  if (!proposal || proposal.state === "invalid") return failure("record_not_found");
  const change = storedPlanChange(proposal.change);
  const version = proposal.expected_graph_version;
  const all = await planContributions(db, proposal.intervention_id, true);
  const historical = new Map(all.map((node) => [identifier(node.id), node]));
  const applied = await db
    .selectFrom("graph_changes as g")
    .innerJoin("graph_change_proposals as p", "p.id", "g.proposal_id")
    .select(["p.change", "g.graph_version"])
    .where("g.intervention_id", "=", proposal.intervention_id)
    .where("g.graph_version", "<=", version)
    .execute();
  const removedAt = new Map<string, number>();
  for (const entry of applied)
    for (const key of storedPlanChange(entry.change).remove) {
      const node = all.findLast(
        (row) => row.plan_key === key && row.added_in_graph_version < entry.graph_version,
      );
      if (!node) throw new Error("Removed contribution lacks its historical record.");
      removedAt.set(identifier(node.id), entry.graph_version);
    }
  const replacements = new Set(change.replace.map(({ key }) => key));
  const nodes = all.filter(
    (node) =>
      node.added_in_graph_version <= version &&
      (!removedAt.has(identifier(node.id)) || replacements.has(node.plan_key)) &&
      (!node.superseded_by_contribution_id ||
        (historical.get(identifier(node.superseded_by_contribution_id))?.added_in_graph_version ??
          0) > version),
  );
  const byId = new Map(nodes.map((node) => [identifier(node.id), node]));
  const byKey = new Map(nodes.map((node) => [node.plan_key, node]));
  const edges = await db
    .selectFrom("contribution_dependencies")
    .select([
      "contribution_id",
      "prerequisite_id",
      "added_in_graph_version",
      "removed_in_graph_version",
    ])
    .where("intervention_id", "=", proposal.intervention_id)
    .where(
      "contribution_id",
      "in",
      nodes.map(({ id }) => id),
    )
    .where("added_in_graph_version", "<=", version)
    .execute();
  const prerequisites = new Map(nodes.map(({ plan_key }) => [plan_key, [] as string[]]));
  for (const edge of edges) {
    const childId = identifier(edge.contribution_id);
    const child = byId.get(childId);
    const parent = historical.get(identifier(edge.prerequisite_id));
    const priorVersion = (removedAt.get(childId) ?? version + 1) - 1;
    if (
      child &&
      parent &&
      edge.added_in_graph_version <= priorVersion &&
      (edge.removed_in_graph_version === null || edge.removed_in_graph_version > priorVersion)
    )
      prerequisites.get(child.plan_key)?.push(parent.plan_key);
  }
  const routes = await db
    .selectFrom("intervention_operations")
    .select(["agent_id", "connection"])
    .where("intervention_id", "=", proposal.intervention_id)
    .execute();
  const connections = new Map(routes.map((row) => [row.agent_id, row.connection]));
  const connection = (agent: ReplyAgent) => {
    const route = connections.get(agent);
    if (!route) throw new Error("Plan change row lacks its accepted route.");
    return route;
  };
  const {
    rows: snapshots,
    additionalRequests,
    remainingRequests,
    maxRequests,
  } = JSON.parse(proposal.preview_states) as Pick<
    PlanChangePreview,
    "additionalRequests" | "remainingRequests" | "maxRequests"
  > & {
    rows: Record<
      string,
      Pick<PlanChangeRow, "state" | "taskState" | "blockingReason" | "blockedBy" | "restartHeld">
    >;
  };
  const rows = new Map<string, PlanChangeRow>();
  for (const node of nodes) {
    const snapshot = Object.hasOwn(snapshots, node.plan_key) ? snapshots[node.plan_key] : undefined;
    if (!snapshot) throw new Error("Plan change preview lacks its captured state.");
    const row = {
      state: snapshot.state,
      taskState: snapshot.taskState,
      blockingReason: snapshot.blockingReason,
      blockedBy: snapshot.blockedBy,
      restartHeld: snapshot.restartHeld,
    };
    rows.set(node.plan_key, {
      ...row,
      key: node.plan_key,
      connection: connection(node.agent_id),
      waitingFor: (prerequisites.get(node.plan_key) ?? []).filter(
        (key) => snapshots[key]?.state !== "completed",
      ),
    });
  }
  const rowAt = (key: string) => {
    const row = rows.get(key);
    if (!row) throw new Error("Plan change preview lacks its original contribution.");
    return row;
  };
  function request(
    group: "add" | "replace",
    entry: (typeof change.replace)[number],
    index: number,
    agent: ReplyAgent,
  ): PlanChangeRequest {
    const before = group === "replace" ? byKey.get(entry.key) : undefined;
    const after = [...new Set(entry.depends_on)];
    const beforeDependencies = new Set(prerequisites.get(entry.key));
    const changed: PlanChangeRequest["changed"][number][] = [];
    if (before) {
      if (entry.request !== before.request) changed.push("request");
      if (entry.reason !== before.reason) changed.push("reason");
      if (entry.required !== !!before.required) changed.push("required");
      if (
        beforeDependencies.size !== after.length ||
        after.some((key) => !beforeDependencies.has(key))
      )
        changed.push("prerequisites");
    }
    return {
      key: entry.key,
      agentId: agent,
      connection: connection(agent),
      required: entry.required,
      prerequisites: after,
      changed,
      request: planText(entry.request, `plan_change_request_${id}_${group}_${String(index)}`),
      reason: planText(entry.reason, `plan_change_reason_${id}_${group}_${String(index)}`),
    };
  }
  const modified = new Set([...change.remove, ...change.replace.map(({ key }) => key)]);
  const preview: PlanChangePreview = {
    removed: change.remove.map(rowAt),
    replaced: change.replace.map((entry, index) => {
      const original = byKey.get(entry.key);
      if (!original) throw new Error("Plan change preview lacks its original contribution.");
      return {
        before: rowAt(entry.key),
        after: request("replace", entry, index, original.agent_id),
      };
    }),
    added: change.add.map((entry, index) => {
      if (!isReplyAgent(entry.agent))
        throw new Error("Plan change addition lacks its authorized agent.");
      return request("add", entry, index, entry.agent);
    }),
    unchanged: [...rows.values()].filter(({ key }) => !modified.has(key)),
    purpose: change.new_purpose ? planText(change.new_purpose, `plan_change_purpose_${id}`) : null,
    context: change.replace_shared_context
      ? planText(change.shared_context, `plan_change_context_${id}`)
      : null,
    additionalRequests,
    remainingRequests,
    maxRequests,
  };
  return { ok: true, value: { ...preview, proposalId: id } };
}
