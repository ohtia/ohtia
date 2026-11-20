import {
  isConsultationTool,
  isCollaborationProposal,
  type ConsultationInvalidReason,
  type ConsultationState,
  type ProviderTool,
  type PlanInvalidReason,
  type ProviderToolCall,
  type ReplyAgent,
} from "@ohtia/contracts";
import type { Generated } from "kysely";
import type { PlanOutcome } from "@ohtia/contracts";
import { operationPolicy } from "./operations.js";
import type { RuntimeMode } from "./tasks.js";

const consultationCatalog = [
  {
    id: "josefa",
    name: "Josefa",
    role: "the reference librarian",
    capability: "prepares search strategy plans",
    operation: "search_strategy_planning",
    version: 2,
  },
] as const;

export function consultableAgents(mode: RuntimeMode) {
  return consultationCatalog.filter(({ operation, version }) =>
    operationPolicy(operation, version, mode),
  );
}

export function consultationTool(agents: ReturnType<typeof consultableAgents>): ProviderTool {
  return {
    namespace: "ohtia",
    name: "propose_consultation",
    description:
      "Propose one bounded request for an enabled agent, subject to researcher approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "The agent to consult.",
          enum: agents.map(({ id }) => id),
        },
        request: {
          type: "string",
          description: "The exact self-contained question and context the agent will receive.",
        },
        reason: { type: "string", description: "Why the researcher might want this consultation." },
      },
      required: ["agent", "request", "reason"],
      additionalProperties: false,
    },
  };
}

export interface InterventionRow {
  id: Uint8Array;
  project_id: Uint8Array;
  conversation_id: Uint8Array;
  kind: "consultation" | "plan";
  state: ConsultationState;
  invalid_reason: ConsultationInvalidReason | PlanInvalidReason | null;
  proposed_by_attempt_id: Uint8Array | null;
  purpose: Generated<string | null>;
  shared_context: Generated<string | null>;
  graph_version: Generated<number>;
  outcome: Generated<PlanOutcome | null>;
  finished_at: Generated<string | null>;
  finished_by_operation_id: Generated<string | null>;
  created_at: string;
  decided_at: string | null;
  decided_by_operation_id: string | null;
  approved_during_attempt_id: Generated<Uint8Array | null>;
  revision: number;
}

export interface ContributionRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  agent_id: "josefa" | "virgilio";
  operation: "search_strategy_planning" | "development_test";
  plan_key: Generated<string | null>;
  required: Generated<number>;
  state: Generated<
    "waiting" | "active" | "completed" | "failed" | "uncertain" | "blocked" | "cancelled"
  >;
  blocked_by_contribution_id: Generated<Uint8Array | null>;
  failure_reason: Generated<"input_too_large" | "input_changed" | "destination_changed" | null>;
  ready_inputs: Generated<string | null>;
  result_message_id: Generated<Uint8Array | null>;
  restart_held: Generated<number>;
  dedupe_key: Uint8Array;
  policy_version: Generated<number>;
  added_in_graph_version: Generated<number>;
  request: string;
  reason: string;
  task_id: Uint8Array | null;
  created_at: string;
}

type Proposal = Pick<ContributionRow, "request" | "reason"> & {
  agent_id: "josefa";
  operation: "search_strategy_planning";
};
export function decodeConsultationProposal(
  calls: readonly ProviderToolCall[],
  mode: RuntimeMode,
): { readonly values: Proposal } | { readonly invalid: ConsultationInvalidReason } | undefined {
  const matching = calls.filter(isConsultationTool);
  if (calls.filter(isCollaborationProposal).length > 1) return { invalid: "multiple_calls" };
  if (!matching[0]) return;
  let value: unknown;
  try {
    value = JSON.parse(matching[0].arguments);
  } catch {
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    !("request" in value) ||
    typeof value.request !== "string" ||
    !("reason" in value) ||
    typeof value.reason !== "string" ||
    !("agent" in value) ||
    typeof value.agent !== "string"
  )
    return;
  // JSON escapes can decode into invalid scalars even when the provider event is valid UTF-8.
  if (/[\uD800-\uDFFF]/u.test(value.request) || /[\uD800-\uDFFF]/u.test(value.reason)) return;
  if (!value.request.trim()) return { invalid: "request_empty" };
  if (Buffer.byteLength(value.request, "utf8") > 32768) return { invalid: "request_too_long" };
  if (!value.reason.trim()) return { invalid: "reason_empty" };
  if (Array.from(value.reason).length > 500) return { invalid: "reason_too_long" };
  const agentId = value.agent;
  const agent = consultableAgents(mode).find(({ id }) => agentId === id);
  if (!agent) return { invalid: "agent_unavailable" };
  return {
    values: {
      agent_id: agent.id,
      operation: agent.operation,
      request: value.request,
      reason: value.reason,
    },
  };
}

export function consultationInput(request: string): string {
  return (
    "This request comes from a consultation by Virgilio, the research guide. The researcher approved it and cannot answer questions in this reply.\n\nRequest:\n" +
    request
  );
}

export function agentIdentity(agent: ReplyAgent) {
  return (
    consultationCatalog.find(({ id }) => id === agent) ?? {
      name: "Virgilio",
      role: "the research guide",
    }
  );
}

export function otherAgentInput(agent: ReplyAgent, content: string): string {
  const identity = agentIdentity(agent);
  return `Message from ${identity.name}, ${identity.role}:\n\n${content}`;
}

export function consultationNote(
  proposal: Pick<InterventionRow, "state" | "invalid_reason">,
  agentName: string,
): string {
  const prefix = `Note from Ohtia: at this point you proposed asking ${agentName} for a contribution`;
  switch (proposal.state) {
    case "proposed":
      return prefix + "; the proposal is waiting for the researcher to accept or decline it.";
    case "accepted":
      return (
        prefix +
        `, and the researcher accepted it; ${agentName}'s result appears in this conversation as a message from ${agentName} once it is saved.`
      );
    case "declined":
      return prefix + "; the researcher declined, so nothing was sent.";
    case "replaced":
      return prefix + "; a later proposal of yours replaced it.";
    case "invalid": {
      if (proposal.invalid_reason === "multiple_calls")
        return "Note from Ohtia: at this point you made more than one proposal in one reply, so Ohtia accepted none of them. The researcher was told.";
      const explanations = {
        request_empty: "its request was empty.",
        request_too_long: "its request was longer than 32,768 bytes.",
        reason_empty: "it had no reason.",
        reason_too_long: "its reason was longer than 500 characters.",
        agent_unavailable: "it named an agent that isn't available.",
      } as const;
      if (!proposal.invalid_reason || !Object.hasOwn(explanations, proposal.invalid_reason))
        throw new Error("Invalid consultation lacks a reason.");
      return `Note from Ohtia: at this point Ohtia did not accept your consultation proposal because ${explanations[proposal.invalid_reason as keyof typeof explanations]} The researcher was told.`;
    }
  }
}
