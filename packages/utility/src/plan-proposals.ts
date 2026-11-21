import {
  isPlanTool,
  isCollaborationProposal,
  planInvalidReasons,
  type AddContributionsPayload,
  type PlanInvalidReason,
  type ProviderTool,
  type ProviderToolCall,
} from "@ohtia/contracts";
import { sql, type Kysely, type Selectable } from "kysely";
import { agentIdentity, type consultableAgents, type InterventionRow } from "./consultations.js";
import {
  planContributions,
  holdingDependencies,
  waitingForPlanWork,
} from "./contribution-graphs.js";
import { acceptedPlans } from "./plan-coordination.js";
import { identifier, type ResearchSchema } from "./research.js";

export function planTool(agents: ReturnType<typeof consultableAgents>): ProviderTool {
  return {
    namespace: "ohtia",
    name: "propose_plan",
    description:
      "Propose a plan of two or more contributions from other Ohtia agents. The researcher runs or declines it in Ohtia.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "The plan's question: what the contributions should answer together.",
        },
        shared_context: {
          type: "string",
          description: "Context sent to every contribution of the plan, which may be empty.",
        },
        contributions: {
          type: "array",
          description: "The plan's contributions, in the order they run.",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description:
                  "Plan key of the contribution: 1 to 64 lowercase letters, digits or hyphens.",
              },
              agent: {
                type: "string",
                enum: agents.map(({ id }) => id),
                description: "The agent that prepares the contribution.",
              },
              request: { type: "string", description: "The request, which must stand on its own." },
              reason: {
                type: "string",
                description: "Why the plan needs this contribution, shown only to the researcher.",
              },
              required: {
                type: "boolean",
                description: "False when the answer can do without this contribution.",
              },
              depends_on: {
                type: "array",
                description: "Plan keys of the contributions whose results it needs.",
                items: { type: "string" },
              },
            },
            required: ["key", "agent", "request", "reason", "required", "depends_on"],
            additionalProperties: false,
          },
        },
      },
      required: ["purpose", "shared_context", "contributions"],
      additionalProperties: false,
    },
  };
}

type NewPlan = Extract<AddContributionsPayload, { readonly conversationId: string }>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readPlanProposal(
  calls: readonly ProviderToolCall[],
  conversationId: string,
): { readonly payload: NewPlan } | { readonly invalid: PlanInvalidReason } | undefined {
  const call = calls.find(isPlanTool);
  if (!call) return;
  if (calls.filter(isCollaborationProposal).length > 1) return { invalid: "multiple_calls" };
  let value: Record<string, unknown>;
  try {
    value = record(JSON.parse(call.arguments));
  } catch {
    return { invalid: "empty_plan" };
  }
  if (!Array.isArray(value.contributions) || !value.contributions.length)
    return { invalid: "empty_plan" };
  if (value.contributions.length === 1) return { invalid: "too_few_contributions" };
  if (typeof value.purpose !== "string" || /[\0\uD800-\uDFFF]/u.test(value.purpose))
    return { invalid: "purpose_empty" };
  if (typeof value.shared_context !== "string" || /[\0\uD800-\uDFFF]/u.test(value.shared_context))
    return { invalid: "shared_context_too_large" };
  if (Object.keys(value).length !== 3) return { invalid: "empty_plan" };
  const contributions: NewPlan["contributions"][number][] = [];
  for (const item of value.contributions) {
    const { key, agent, request, reason, required, depends_on } = record(item);
    if (typeof key !== "string") return { invalid: "plan_key_invalid" };
    if (typeof agent !== "string") return { invalid: "agent_unavailable" };
    if (typeof request !== "string" || /[\0\uD800-\uDFFF]/u.test(request))
      return { invalid: "request_empty" };
    if (typeof reason !== "string" || /[\0\uD800-\uDFFF]/u.test(reason))
      return { invalid: "reason_empty" };
    if (!Array.isArray(depends_on) || !depends_on.every((entry) => typeof entry === "string"))
      return { invalid: "unknown_prerequisite" };
    if (typeof required !== "boolean" || Object.keys(record(item)).length !== 6)
      return { invalid: "plan_key_invalid" };
    contributions.push({
      planKey: key,
      agent,
      request,
      reason,
      required,
      prerequisites: depends_on,
    });
  }
  return {
    payload: {
      conversationId,
      expectedGraphVersion: 0,
      purpose: value.purpose,
      sharedContext: value.shared_context,
      contributions,
    },
  };
}

export function planInvalidReason(value: unknown): PlanInvalidReason {
  if (!planInvalidReasons.includes(value as PlanInvalidReason))
    throw new Error("Plan validation returned an unexpected error.");
  return value as PlanInvalidReason;
}

export function unfinishedPlans(db: Kysely<ResearchSchema>) {
  return acceptedPlans(db)
    .leftJoin("continuations as c", "c.intervention_id", "interventions.id")
    .leftJoin("tasks as t", "t.id", "c.task_id")
    .selectAll("interventions")
    .where((eb) =>
      eb.or([
        eb("interventions.outcome", "is", null),
        eb("c.admission", "=", "waiting"),
        eb("t.state", "in", ["queued", "blocked", "running", "cancelling", "waiting_capacity"]),
      ]),
    );
}
export function unfinishedPlan(db: Kysely<ResearchSchema>, conversationId: Uint8Array) {
  return unfinishedPlans(db)
    .where("interventions.conversation_id", "=", conversationId)
    .orderBy(sql`interventions.rowid DESC`)
    .executeTakeFirst();
}

export async function planStatusNote(
  db: Kysely<ResearchSchema>,
  plan: Selectable<InterventionRow>,
  instructionVersion = 4,
): Promise<string> {
  const nodes = await planContributions(db, plan.id, instructionVersion >= 5);
  const current = nodes.filter(
    (node) =>
      !node.superseded_by_contribution_id && node.cancellation_reason !== "removed_by_researcher",
  );
  const keys = new Map(nodes.map((node) => [identifier(node.id), node.plan_key]));
  const edges = instructionVersion >= 5 ? await holdingDependencies(db, plan.id) : [];
  const state = plan.outcome
    ? "its contributions have ended and the synthesis is being written"
    : current.some(({ state }) => waitingForPlanWork(state))
      ? "running"
      : "waiting for the researcher to finish or stop it, because a required contribution did not complete";
  const labels = {
    waiting: "waiting",
    active: "working",
    completed: "completed",
    failed: "failed",
    uncertain: "uncertain",
    blocked: "blocked",
    cancelled: "cancelled",
  } as const;
  return [
    `Note from Ohtia: a plan that the researcher approved in this conversation hasn't finished. Plan state: ${state}.`,
    "Contributions:",
    ...nodes
      .filter((node) => !node.superseded_by_contribution_id)
      .map((node) => {
        const agent = agentIdentity(node.agent_id).name;
        const id = identifier(node.id);
        const prerequisites = edges
          .filter((edge) => identifier(edge.contribution_id) === id)
          .map((edge) => keys.get(identifier(edge.prerequisite_id)))
          .join(", ");
        const requirement =
          instructionVersion >= 5 ? (node.required ? ", required" : ", optional") : "";
        const after = prerequisites ? ", after " + prerequisites : "";
        const label =
          node.cancellation_reason === "removed_by_researcher" ? "removed" : labels[node.state];
        return `- ${node.plan_key} (${agent}${requirement}${after}): ${label}`;
      }),
    "Results that have arrived appear in this conversation as messages from the agents that wrote them. Ohtia starts the synthesis as a separate reply when the plan's work finishes. Until the plan has finished, you cannot propose a consultation or another plan.",
  ].join("\n");
}

export function planProposalNote(
  proposal: Pick<InterventionRow, "state" | "invalid_reason">,
): string {
  switch (proposal.state) {
    case "proposed":
      return "Note from Ohtia: at this point you proposed a plan; the proposal is waiting for the researcher to run or decline it.";
    case "accepted":
      return "Note from Ohtia: at this point you proposed a plan, and the researcher ran it; its results and its synthesis appear in this conversation as messages once they are saved.";
    case "declined":
      return "Note from Ohtia: at this point you proposed a plan; the researcher declined it, so nothing was sent.";
    case "replaced":
      return "Note from Ohtia: at this point you proposed a plan; a later proposal of yours replaced it.";
    case "invalid":
      return proposal.invalid_reason === "multiple_calls"
        ? "Note from Ohtia: at this point you made more than one proposal in one reply, so Ohtia accepted none of them. The researcher was told."
        : `Note from Ohtia: at this point Ohtia did not accept your plan proposal because it failed the check ${planInvalidReason(proposal.invalid_reason)}; nothing was sent. The researcher was told.`;
  }
}
