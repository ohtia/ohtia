import type { Kysely, Selectable } from "kysely";
import type { PlanChangeInvalidReason } from "@ohtia/contracts";
import type { ResearchSchema } from "./research.js";
import type { InterventionRow } from "./consultations.js";
import {
  isCollaborationProposal,
  isPlanChangeTool,
  utf8Size,
  type ProviderTool,
  type ProviderToolCall,
} from "@ohtia/contracts";
import { canonicalJson } from "./research.js";
import type { consultableAgents } from "./consultations.js";

export function planChangeTool(agents: ReturnType<typeof consultableAgents>): ProviderTool {
  return {
    namespace: "ohtia",
    name: "propose_plan_change",
    description:
      "Propose a change to the unfinished plan of this conversation. The researcher applies or declines it in Ohtia.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        new_purpose: {
          type: "string",
          description: "The plan's new purpose, or an empty string to keep the current one.",
        },
        replace_shared_context: {
          type: "boolean",
          description:
            "True to replace the context sent to contributions that have not started with shared_context.",
        },
        shared_context: {
          type: "string",
          description:
            "The new context for contributions that have not started, which may be empty. Ignored unless replace_shared_context is true.",
        },
        remove: {
          type: "array",
          description: "Plan keys of the contributions to remove.",
          items: {
            type: "string",
          },
        },
        replace: {
          type: "array",
          description:
            "Contributions to replace, each named by its plan key, with the complete new version. The agent stays the same.",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description: "Plan key of the contribution to replace; the new version keeps it.",
              },
              request: {
                type: "string",
                description: "The complete new request, which must stand on its own.",
              },
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
                items: {
                  type: "string",
                },
              },
            },
            required: ["key", "request", "reason", "required", "depends_on"],
            additionalProperties: false,
          },
        },
        add: {
          type: "array",
          description: "New contributions.",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description:
                  "Plan key of the new contribution: 1 to 64 lowercase letters, digits or hyphens.",
              },
              agent: {
                type: "string",
                enum: agents.map(({ id }) => id),
                description: "The agent that prepares the contribution.",
              },
              request: {
                type: "string",
                description: "The request, which must stand on its own.",
              },
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
                items: {
                  type: "string",
                },
              },
            },
            required: ["key", "agent", "request", "reason", "required", "depends_on"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "new_purpose",
        "replace_shared_context",
        "shared_context",
        "remove",
        "replace",
        "add",
      ],
      additionalProperties: false,
    },
  };
}

interface Replacement {
  readonly key: string;
  readonly request: string;
  readonly reason: string;
  readonly required: boolean;
  readonly depends_on: readonly string[];
}
interface Addition extends Replacement {
  readonly agent: string;
}
export interface PlanChange {
  readonly new_purpose: string;
  readonly replace_shared_context: boolean;
  readonly shared_context: string;
  readonly remove: readonly string[];
  readonly replace: readonly Replacement[];
  readonly add: readonly Addition[];
}
export interface PlanChangeProposalRow {
  id: Uint8Array;
  intervention_id: Uint8Array;
  proposed_by_attempt_id: Uint8Array;
  change: string;
  expected_graph_version: number;
  expected_states: string;
  preview_states: string;
  state: "proposed" | "applied" | "declined" | "replaced" | "invalid";
  invalid_reason: PlanChangeInvalidReason | null;
  created_at: string;
  decided_at: string | null;
  decided_by_operation_id: string | null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && !/[\uD800-\uDFFF]/u.test(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}
function replacement(value: unknown, addition: boolean): value is Replacement | Addition {
  return (
    object(value) &&
    Object.keys(value).length === (addition ? 6 : 5) &&
    text(value.key) &&
    text(value.request) &&
    text(value.reason) &&
    typeof value.required === "boolean" &&
    strings(value.depends_on) &&
    (!addition || text(value.agent))
  );
}
function planChange(value: unknown): value is PlanChange {
  return (
    object(value) &&
    Object.keys(value).length === 6 &&
    text(value.new_purpose) &&
    typeof value.replace_shared_context === "boolean" &&
    text(value.shared_context) &&
    strings(value.remove) &&
    Array.isArray(value.replace) &&
    value.replace.every((item) => replacement(item, false)) &&
    Array.isArray(value.add) &&
    value.add.every((item) => replacement(item, true))
  );
}

export function readPlanChange(calls: readonly ProviderToolCall[], maxBytes: number) {
  const first = calls.find(isPlanChangeTool);
  if (!first || utf8Size(first.arguments) > maxBytes) return;
  let value: unknown;
  let change: string;
  try {
    value = JSON.parse(first.arguments);
    if (!object(value)) return;
    change = canonicalJson(value);
  } catch {
    return;
  }
  if (utf8Size(change) > maxBytes) return;
  const multiple = calls.filter(isCollaborationProposal).length > 1;
  if (!multiple && !planChange(value)) return;
  return { change, invalid: multiple ? ("multiple_calls" as const) : undefined };
}

export function storedPlanChange(change: string): PlanChange {
  const value: unknown = JSON.parse(change);
  if (!planChange(value)) throw new Error("Invalid stored plan change.");
  return value;
}

export function planChangeRevision(state: PlanChangeProposalRow["state"]) {
  return state === "proposed" || state === "invalid" ? 1 : 2;
}

export function planChangeNote(
  proposal: Pick<PlanChangeProposalRow, "state" | "invalid_reason">,
): string {
  switch (proposal.state) {
    case "proposed":
      return "Note from Ohtia: at this point you proposed a plan change that is waiting for the researcher to apply or decline it.";
    case "applied":
      return "Note from Ohtia: at this point you proposed a plan change that the researcher applied.";
    case "declined":
      return "Note from Ohtia: at this point you proposed a plan change that the researcher declined; the plan did not change.";
    case "replaced":
      return "Note from Ohtia: at this point you proposed a plan change that a later proposal of yours replaced.";
    case "invalid":
      if (!proposal.invalid_reason) throw new Error("Invalid plan change lacks its reason.");
      return (
        "Note from Ohtia: at this point Ohtia did not accept your plan change because it failed the check " +
        proposal.invalid_reason +
        "; the plan did not change. The researcher was told."
      );
  }
}

export async function effectivePlan(
  db: Kysely<ResearchSchema>,
  plan: Pick<Selectable<InterventionRow>, "id" | "purpose" | "shared_context">,
) {
  const values = {
    purpose: plan.purpose ?? "",
    context: plan.shared_context ?? "",
    purposeSource: plan.id,
    contextSource: plan.id,
  };
  const changes = await db
    .selectFrom("graph_change_proposals as p")
    .innerJoin("graph_changes as g", "g.proposal_id", "p.id")
    .select(["p.id", "p.change"])
    .where("p.intervention_id", "=", plan.id)
    .orderBy("g.graph_version")
    .execute();
  for (const entry of changes) {
    const change = storedPlanChange(entry.change);
    if (change.new_purpose) {
      values.purpose = change.new_purpose;
      values.purposeSource = entry.id;
    }
    if (change.replace_shared_context) {
      values.context = change.shared_context;
      values.contextSource = entry.id;
    }
  }
  return values;
}
