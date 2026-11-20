import type { ConversationAgent, ReplyAgent } from "./research-port.js";

/** Internal data-service contract. Window exposure belongs to STORY-003-010. */
export interface ProjectRecord {
  readonly id: string;
  readonly projectType: "thesis";
  readonly title: string | null;
  readonly documentLanguage: string | null;
  readonly isDevelopment: boolean;
  readonly setupConfirmedAt: string | null;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
  readonly updatedAt: string;
}
export interface ConversationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly agentId: ReplyAgent;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}
/** The same persisted name rules apply to researcher edits and generated suggestions. */
export function validConversationTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 400 &&
    Array.from(value).length <= 200 &&
    value.trim() === value &&
    !/^\p{White_Space}|\p{White_Space}$/u.test(value) &&
    !/[\0\uD800-\uDFFF]/u.test(value)
  );
}
export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly position: number;
  readonly authorKind: "researcher" | "agent";
  readonly agentId: string | null;
  readonly taskId: string | null;
  readonly content: string;
  readonly ending: "complete" | "partial" | null;
  readonly createdAt: string;
}
export const planInvalidReasons = [
  "multiple_calls",
  "plan_unfinished",
  "empty_plan",
  "too_few_contributions",
  "plan_too_large",
  "limit_reached",
  "purpose_empty",
  "purpose_too_long",
  "shared_context_too_large",
  "request_empty",
  "request_too_large",
  "reason_empty",
  "reason_too_long",
  "plan_key_invalid",
  "plan_key_duplicate",
  "duplicate_contribution",
  "unknown_prerequisite",
  "self_dependency",
  "cycle",
  "agent_unavailable",
] as const;
export type PlanInvalidReason = (typeof planInvalidReasons)[number];

export interface PlanContributionRequest {
  readonly planKey: string;
  readonly agent: string;
  readonly request: string;
  readonly reason: string;
  readonly required?: boolean;
  readonly prerequisites: readonly string[];
}
export type AddContributionsPayload = (
  | {
      readonly conversationId: string;
      readonly expectedGraphVersion: 0;
      readonly purpose: string;
      readonly sharedContext: string;
    }
  | { readonly planId: string; readonly expectedGraphVersion: number }
) & { readonly contributions: readonly PlanContributionRequest[] };
export const planOutcomes = ["complete", "partial", "failed", "cancelled"] as const;
export type PlanOutcome = (typeof planOutcomes)[number];

export interface ResearchPayloads {
  readonly "plan.addContributions": AddContributionsPayload;
  readonly "plan.cancel": { readonly planId: string };
  readonly "plan.finish": { readonly planId: string };
  readonly "conversation.stop": { readonly conversationId: string };
  readonly "task.stop": { readonly taskId: string };
  readonly "plan.accept": {
    readonly planId: string;
    readonly connections: Readonly<Partial<Record<ReplyAgent, string>>>;
  };
  readonly "plan.decline": { readonly planId: string };
  readonly "consultation.accept": { readonly proposalId: string; readonly connection: string };
  readonly "consultation.decline": { readonly proposalId: string };
  /** Taskless destination refusals are addressed by contribution ID. */
  readonly "contribution.tryAgain":
    ResearchPayloads["task.tryAgain"] | { readonly contributionId: string };
  readonly "contribution.startAgain": ResearchPayloads["task.startAgain"];
  readonly "task.tryAgain": { readonly taskId: string };
  /** Invoking this human command acknowledges possible duplicate charges. */
  readonly "task.startAgain": { readonly taskId: string };
  readonly "usagePause.resume": { readonly connection: "chatgpt" };
  readonly "task.continueAll": Record<string, never>;
  readonly "task.cancelAll": Record<string, never>;
  readonly "synthesis.tryAgain": ResearchPayloads["task.startAgain"];
  readonly "development.runPlan": { readonly projectId: string };
  readonly "development.createProject": Record<string, never>;
  readonly "development.sendToJosefa": ResearchPayloads["message.append"];
  readonly "project.create": Record<string, never>;
  readonly "project.open": { readonly projectId: string };
  readonly "project.confirmSetup": { readonly proposalId: string };
  readonly "project.rejectSetup": { readonly proposalId: string };
  readonly "conversation.start": {
    readonly projectId: string;
    readonly agentId?: ConversationAgent;
    readonly content: string;
  };
  readonly "conversation.rename": {
    readonly conversationId: string;
    readonly title: string;
    readonly expectedUpdatedAt: string;
  };
  readonly "message.append": { readonly conversationId: string; readonly content: string };
}
export type ResearchCommandName = keyof ResearchPayloads;
export type ResearchCommand = {
  [K in ResearchCommandName]: {
    readonly command: K;
    readonly operationId: string;
    readonly payload: ResearchPayloads[K];
  };
}[ResearchCommandName];
/** A stable receipt result; read records separately so replay never returns newer content as the old result. */
export interface ResearchResult {
  readonly resultId: string;
  readonly outcome?: PlanOutcome;
}
export interface FinishPlanResult extends ResearchResult {
  readonly outcome: PlanOutcome;
}
export const researchCommands = [
  "plan.addContributions",
  "plan.finish",
  "plan.cancel",
  "conversation.stop",
  "task.stop",
  "task.startAgain",
  "task.tryAgain",
  "plan.accept",
  "plan.decline",
  "consultation.accept",
  "consultation.decline",
  "contribution.tryAgain",
  "contribution.startAgain",
  "usagePause.resume",
  "task.continueAll",
  "task.cancelAll",
  "synthesis.tryAgain",
  "development.runPlan",
  "development.createProject",
  "development.sendToJosefa",
  "project.create",
  "project.open",
  "project.confirmSetup",
  "project.rejectSetup",
  "conversation.start",
  "conversation.rename",
  "message.append",
] as const satisfies readonly ResearchCommandName[];
