import type {
  ConversationRecord,
  FinishPlanResult,
  ProjectRecord,
  RenameProjectResult,
  ResearchPayloads,
  ResearchResult,
} from "./research.js";
import {
  handoffInvalidReasons,
  type HandoffInvalidReason,
  projectTitleError,
  planOutcomes,
  planInvalidReasons,
  planChangeInvalidReasons,
  type PlanChangeInvalidReason,
  type PlanInvalidReason,
  type PlanOutcome,
} from "./research.js";
import {
  providerOperations,
  providerFailureReasons,
  type ProviderOperation,
  type ProviderUsage,
} from "./provider-requests.js";
import {
  agentPreferenceTargets,
  isAccountRevision,
  isConnectionId,
  isUsagePauseConnection,
  isAgentPreferences,
  isProviderModelPageInput,
  isProviderModelPage,
  isReplaceAgentPreference,
  type AgentPreferences,
  type ProviderModelPageInput,
  type ProviderModelPage,
} from "./connections.js";
import { utf8Size, type PortCall, type Subscription, type Outcome } from "./port.js";

export const researchOperations = [
  "agentPreference.list",
  "agentPreference.replace",
  "providerModel.list",
  "handoff.accept",
  "handoff.decline",
  "handoff.return",
  "handoff.selection",
  "project.create",
  "project.open",
  "project.rename",
  "project.read",
  "project.confirmSetup",
  "project.rejectSetup",
  "conversation.start",
  "conversation.rename",
  "message.append",
  "conversation.stop",
  "task.stop",
  "plan.finish",
  "plan.cancel",
  "plan.read",
  "plan.accept",
  "plan.decline",
  "planChange.read",
  "memory.add",
  "memory.edit",
  "memory.withdraw",
  "memory.list",
  "memory.history",
  "memory.undo",
  "planChange.apply",
  "planChange.decline",
  "planEvent.list",
  "consultation.accept",
  "consultation.decline",
  "contribution.tryAgain",
  "contribution.startAgain",
  "task.tryAgain",
  "synthesis.tryAgain",
  "task.startAgain",
  "usagePause.resume",
  "task.continueAll",
  "pause.read",
  "destination.read",
  "project.list",
  "projectAttention.list",
  "conversation.list",
  "conversation.read",
  "timeline.listBefore",
  "timeline.read",
  "research.subscribe",
  "text.part",
  "text.readPart",
  "reply.readParts",
  "reply.details",
] as const;
export type ResearchOperation = (typeof researchOperations)[number];
export type WindowResearchCommand = Extract<ResearchOperation, keyof ResearchPayloads>;
export interface TextDescriptor {
  readonly parts: number;
  readonly bytes: number;
  readonly sha256: string;
}
export interface TextReference extends TextDescriptor {
  readonly source: string;
}
export type PortText = string | TextReference;
export interface TextPart {
  readonly index: number;
  readonly count: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly text: string;
}
export const memoryKinds = ["goal", "decision", "focus", "open_question", "note"] as const;
export type MemoryKind = (typeof memoryKinds)[number];
export const memoryEntryLimit = 100;
export const memoryByteLimit = 64 * 1024;
export const memoryTextLimit = 2000;
export const memoryPageSize = 8;
export const memoryChanges = [
  "added",
  "edited",
  "merged",
  "merged_into",
  "withdrawn",
  "undone",
] as const;
export type MemoryAuthor = "researcher" | "virgilio";
export interface MemoryVersion {
  readonly number: number;
  readonly kind: MemoryKind;
  readonly text: PortText;
  readonly state: "active" | "withdrawn";
  readonly change: (typeof memoryChanges)[number];
  readonly author: MemoryAuthor;
  readonly date: string;
}
export interface MemoryEntry extends MemoryVersion {
  readonly id: string;
  readonly originalAuthor: MemoryAuthor;
  readonly source: {
    readonly messageId: string;
    readonly conversationId: string;
    readonly prefix: string;
    readonly truncated: boolean;
  } | null;
}
export interface MemoryPage {
  readonly projectId: string;
  readonly revision: number;
  readonly entries: readonly MemoryEntry[];
  readonly next: string | null;
  readonly bytes: number;
  readonly active: number;
}
export interface MemoryHistory {
  readonly entryId: string;
  readonly versions: readonly MemoryVersion[];
  readonly next: number | null;
}
export interface ProjectCursor {
  readonly lastOpenedAt: string;
  readonly id: string;
}
export interface TimelineCursor {
  readonly position: number;
  readonly rank: number;
  readonly id: string;
}
export interface TimelineIdentity extends TimelineCursor {
  readonly revision: number;
}
export const conversationAgents = [
  "virgilio",
  "josefa",
  "jorge-luis",
  "erasmus",
  "boris",
  "maria",
] as const;
export type ConversationAgent = (typeof conversationAgents)[number];

export function isConversationAgent(value: unknown): value is ConversationAgent {
  return conversationAgents.some((agent) => agent === value);
}

export type ReplyAgent = "virgilio" | "josefa";

export function isReplyAgent(value: unknown): value is ReplyAgent {
  return value === "virgilio" || value === "josefa";
}

export type SynthesisSource = { readonly key: string; readonly agentId: ReplyAgent } & (
  | { readonly state: "completed"; readonly messageId: string }
  | {
      readonly state: "failed" | "blocked" | "cancelled" | "uncertain" | "removed" | "replaced";
      readonly messageId: null;
    }
);

export interface TimelineMessage extends TimelineIdentity {
  readonly kind: "message";
  readonly rank: 1;
  readonly consultation?: true;
  readonly synthesisSources?: readonly SynthesisSource[] | TextReference;
  readonly planContribution?: { readonly planId: string; readonly key: string };
  readonly authorKind: "researcher" | "agent";
  readonly agentId: ReplyAgent | null;
  readonly taskId: string | null;
  readonly content: PortText;
  readonly language: string | null;
  readonly ending: "complete" | "partial" | null;
}
export interface TimelineTask extends TimelineIdentity {
  readonly kind: "task";
  readonly rank: 3;
  readonly consultation?: true;
  readonly replacesTaskId?: string | null;
  readonly consultationRetryFits?: boolean;
  readonly synthesis?: true;
  readonly synthesisStopped?: boolean;
  readonly synthesisPlanId?: string;
  readonly agentId: ReplyAgent;
  readonly language: string | null;
  readonly connection: string;
  readonly blockingReason: string | null;
  readonly outcomeReason: string | null;
  readonly replyMessageId: string | null;
  readonly modelName?: string;
  readonly retryNotBeforeAt?: string;
  readonly providerMessage?: string;
  readonly modelUnavailable?: boolean;
  /** Advisory connection readiness, refreshed independently of the durable task revision. */
  readonly waitingForModels: boolean;
  /** The currently saturated inference limit, or null when capacity is available. */
  readonly waitingLimit: number | null;
  readonly dispatched: boolean;
  readonly superseded: boolean;
  readonly maxAttemptDurationMs: number;
  readonly maxInactivityMs: number;
  readonly state:
    | "queued"
    | "blocked"
    | "running"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "uncertain";
}
export interface TimelineSetupProposal extends TimelineIdentity {
  readonly kind: "setupProposal";
  readonly rank: 2;
  readonly taskId: string;
  readonly title: PortText;
  readonly documentLanguage: PortText;
  readonly state: "proposed" | "invalid" | "replaced" | "rejected" | "confirmed";
  readonly invalidReason:
    | "title_empty"
    | "title_whitespace"
    | "title_too_long"
    | "title_invalid"
    | "language_malformed"
    | "language_unknown"
    | "multiple_calls"
    | null;
}
export const consultationInvalidReasons = [
  "request_empty",
  "request_too_long",
  "reason_empty",
  "reason_too_long",
  "agent_unavailable",
  "multiple_calls",
] as const;
export type ConsultationInvalidReason = (typeof consultationInvalidReasons)[number];
export type ConsultationState = "proposed" | "accepted" | "declined" | "replaced" | "invalid";
export interface TimelineConsultation extends TimelineIdentity {
  readonly kind: "consultation";
  readonly rank: 2;
  readonly taskId: string;
  readonly language: string | null;
  readonly state: ConsultationState;
  readonly invalidReason: ConsultationInvalidReason | null;
  readonly agentId: "josefa" | null;
  readonly request: PortText | null;
  readonly reason: string | null;
  readonly connection: string | null;
}
export interface TimelinePlan extends TimelineIdentity {
  readonly kind: "plan";
  readonly rank: 2;
  readonly taskId: string | null;
  readonly language: string | null;
  readonly state: ConsultationState;
  readonly invalidReason: PlanInvalidReason | null;
}
export interface TimelineHandoffProposal extends TimelineIdentity {
  readonly kind: "handoffProposal";
  readonly rank: 2;
  readonly taskId: string;
  readonly expectedOwnerRevision: number;
  readonly note: PortText | null;
  readonly reason: string | null;
  readonly state: ConsultationState;
  readonly invalidReason: HandoffInvalidReason | null;
}
export interface TimelineHandoffDivider extends TimelineIdentity {
  readonly kind: "handoffDivider";
  readonly rank: 1;
  readonly agentId: ReplyAgent;
}
export interface PlanChangeRow {
  readonly key: string;
  readonly state: (typeof planContributionStates)[number];
  readonly taskState: PlanTaskProgress["state"] | null;
  readonly blockingReason: PlanTaskProgress["blockingReason"];
  readonly waitingFor: readonly string[];
  readonly blockedBy: string | null;
  readonly restartHeld: boolean;
  readonly connection: string;
}
export interface PlanChangeRequest {
  readonly key: string;
  readonly agentId: ReplyAgent;
  readonly connection: string;
  readonly required: boolean;
  readonly prerequisites: readonly string[];
  readonly request: PlanText;
  readonly reason: PlanText;
  readonly changed: readonly ("request" | "reason" | "required" | "prerequisites")[];
}
export interface PlanChangePreview {
  readonly removed: readonly PlanChangeRow[];
  readonly replaced: readonly {
    readonly before: PlanChangeRow;
    readonly after: PlanChangeRequest;
  }[];
  readonly added: readonly PlanChangeRequest[];
  readonly unchanged: readonly PlanChangeRow[];
  readonly purpose: PlanText | null;
  readonly context: PlanText | null;
  readonly additionalRequests: number;
  readonly remainingRequests: number;
  readonly maxRequests: number;
}
export interface TimelinePlanChangeProposal extends TimelineIdentity {
  readonly kind: "planChangeProposal";
  readonly rank: 2;
  readonly taskId: string;
  readonly state: "proposed" | "invalid" | "replaced" | "applied" | "declined";
  readonly invalidReason: PlanChangeInvalidReason | null;
}
export interface TimelineMemoryChange extends TimelineIdentity {
  readonly kind: "memoryChange";
  readonly rank: 3;
  readonly taskId: string;
  readonly added: number;
  readonly edited: number;
  readonly merged: number;
  readonly withdrawn: number;
  readonly rejected: number;
  readonly canUndo: boolean;
}
export interface TimelineMemoryReview extends TimelineIdentity {
  readonly kind: "memoryReview";
  readonly rank: 4;
  readonly taskId: string;
}
export type TimelineItem =
  | TimelineMemoryChange
  | TimelineMemoryReview
  | TimelineMessage
  | TimelineTask
  | TimelineSetupProposal
  | TimelineConsultation
  | TimelinePlan
  | TimelinePlanChangeProposal
  | TimelineHandoffProposal
  | TimelineHandoffDivider;
export interface HandoffSelectionMessage {
  readonly position: number;
  readonly agentId: ReplyAgent | null;
  readonly prefix: string;
  readonly truncated: boolean;
}
export interface HandoffSelectionPage {
  readonly priorReply: boolean;
  readonly messages: readonly HandoffSelectionMessage[];
  readonly next: number | null;
}
export const handoffSelectionPageSize = 8;
export interface ConversationCursor {
  readonly latestAt: string;
  readonly id: string;
}
export function compareConversations(a: ConversationCursor, b: ConversationCursor): number {
  return (
    (a.latestAt < b.latestAt ? -1 : a.latestAt > b.latestAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
export const conversationPreviewPrefixLimit = 1024;
export type ConversationSummary = ConversationRecord &
  ConversationCursor & {
    readonly ownerPosition: number | null;
    readonly latestPrefix: string;
    readonly latestTruncated: boolean;
    readonly latestLanguage: string | null;
    readonly status: "attention" | "replying" | "waiting" | null;
    readonly latestReplyTaskId: string | null;
    readonly runningTask: {
      readonly id: string;
      readonly agentId: ReplyAgent;
      readonly state: "running" | "cancelling";
    } | null;
  };
export type ProjectSummary = ProjectRecord & { readonly needsAttention: boolean };
export type ProjectAttentionPage = ListPage<string, string> & { readonly revision: number };
export interface PauseCounts {
  readonly revision: number;
  readonly restart: number;
  readonly usage: readonly { readonly connection: string; readonly count: number }[];
}
export interface ResearchScope {
  readonly projectId: string | null;
  readonly conversationId: string | null;
}
export interface ListPage<T, C> {
  readonly items: readonly T[];
  readonly next: C | null;
  readonly hasMore: boolean;
}
export interface IdPage<T> {
  readonly items: readonly T[];
  readonly remaining: readonly string[];
}
export interface ReplyPart {
  readonly sequence: number;
  readonly text: string;
}
export interface ReplyDetails {
  readonly agentId: ReplyAgent;
  readonly operation: ProviderOperation;
  readonly instructionVersion: number;
  readonly connectionId: string;
  readonly connectionKind: "subscription" | "api_key";
  readonly accountRevision: string | null;
  readonly account: "same" | "different" | "disconnected" | "unknown" | null;
  readonly requestedModel: string | null;
  readonly observedModel: string | null;
  readonly requestedEffort?: string | null;
  readonly observedEffort?: string | null;
  readonly refusalCategory?: string;
  readonly attempts: number;
  readonly startedAt: string | null;
  readonly endedAt: string;
  readonly durationMs: number | null;
  readonly tokens: ProviderUsage;
  readonly usage: "reported" | "late" | "estimated" | "unreported" | "incomplete";
  readonly memory: readonly {
    readonly entryId: string;
    readonly version: number;
    readonly versionId: string;
  }[];
}
export interface ReplyParts {
  readonly parts: readonly ReplyPart[];
  readonly latestSequence: number;
}
export const planEventKinds = [
  "contribution_started",
  "contribution_completed",
  "contribution_failed",
  "contribution_uncertain",
  "contribution_blocked",
  "contribution_waiting",
  "contribution_cancelled",
  "graph_changed",
  "continuation_created",
  "plan_ended",
] as const;
export type PlanEventKind = (typeof planEventKinds)[number];
export const planContributionStates = [
  "waiting",
  "active",
  "completed",
  "failed",
  "uncertain",
  "blocked",
  "cancelled",
] as const;
export const continuationAdmissions = ["waiting", "admitted", "withdrawn"] as const;
export const planSynthesisStates = [
  "queued",
  "blocked",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "uncertain",
] as const;
export const planEventLimit = 512;
export const planEventPageSize = 24;
export type PlanEventPayload =
  | Readonly<Record<string, never>>
  | { readonly graphVersion: number }
  | { readonly outcome: PlanOutcome }
  | { readonly continuationId: string }
  | { readonly blockedBy: string }
  | {
      readonly reason:
        "destination_changed" | "input_changed" | "input_too_large" | "cancelled_by_researcher";
    };
export interface PlanEvent {
  readonly id: string;
  readonly sequence: number;
  readonly kind: PlanEventKind;
  readonly contributionId: string | null;
  /** An intent can change state before it has a task. */
  readonly taskId: string | null;
  readonly payload: PlanEventPayload;
  readonly payloadHash: string;
  readonly createdAt: string;
}
export interface PlanEventPage {
  readonly planId: string;
  readonly throughSequence: number;
  readonly events: readonly PlanEvent[];
}
export type PlanText = string | TextReference;
export type PlanTaskProgress = Pick<
  TimelineTask,
  | "agentId"
  | "state"
  | "connection"
  | "blockingReason"
  | "outcomeReason"
  | "modelUnavailable"
  | "modelName"
  | "retryNotBeforeAt"
  | "providerMessage"
  | "replyMessageId"
  | "maxAttemptDurationMs"
  | "maxInactivityMs"
>;
export interface PlanSnapshot {
  readonly planId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly revision: number;
  readonly graphVersion: number;
  readonly outcome: PlanOutcome | null;
  readonly throughSequence: number;
  readonly needsAttention: boolean;
  readonly state: Exclude<ConsultationState, "invalid">;
  readonly connections: Readonly<Partial<Record<ReplyAgent, string>>>;
  readonly maxRequests: number;
  readonly requestsUsed: number;
  readonly purpose: PlanText;
  readonly sharedContext: PlanText;
  readonly contributions: readonly {
    readonly id: string;
    readonly key: string;
    readonly request: PlanText;
    readonly reason: PlanText;
    readonly failureReason: "destination_changed" | "input_changed" | "input_too_large" | null;
    readonly agentId: ReplyAgent;
    readonly required: boolean;
    readonly state: (typeof planContributionStates)[number];
    readonly taskId: string | null;
    readonly task: PlanTaskProgress | null;
    readonly resultMessageId: string | null;
    readonly blockedBy: string | null;
    readonly restartHeld: boolean;
    readonly prerequisites: readonly string[];
  }[];
  readonly continuation: {
    readonly id: string;
    readonly graphVersion: number;
    readonly throughSequence: number;
    readonly reason: "required_set_complete" | "finished_partial";
    readonly policyVersion: 1 | 2 | 3;
    readonly admission: (typeof continuationAdmissions)[number];
    readonly restartHeld: boolean;
    readonly taskId: string | null;
    readonly taskState: (typeof planSynthesisStates)[number] | null;
    readonly task: PlanTaskProgress | null;
    readonly stopped: boolean;
  } | null;
}
export type ResearchEvent =
  | {
      readonly kind: "planChanged";
      readonly planId: string;
      readonly throughSequence: number;
      readonly revision: number;
    }
  | { readonly kind: "inferenceActivity" }
  | {
      readonly kind: "agentPreferenceChanged";
      readonly target: import("./connections.js").AgentPreferenceTarget;
      readonly revision: number;
      readonly source?: "replace";
    }
  | {
      readonly kind: "providerModelsChanged";
      readonly connection: string;
      readonly list_revision: number;
    }
  | { readonly kind: "destinationChanged"; readonly connection: string }
  | { readonly kind: "pauseCounts"; readonly revision: number }
  | { readonly kind: "projectAttention"; readonly revision: number }
  | {
      readonly kind: "attentionRaised";
      readonly source: "conversation" | "plan";
      readonly task?: { readonly id: string; readonly revision: number };
      readonly plan?: { readonly id: string; readonly revision: number };
    }
  | {
      readonly kind: "replyFinished";
      readonly projectId: string;
      readonly conversationId: string;
      readonly agentId: ReplyAgent;
    }
  | {
      readonly kind: "changed";
      readonly record:
        | "project"
        | "projectTitle"
        | "conversation"
        | "timeline"
        | "usagePause"
        | "executionLimits"
        | "memory";
      readonly id: string;
      readonly revision: number;
    }
  | {
      readonly kind: "reply";
      readonly taskId: string;
      readonly sequence: number;
      readonly text: string;
    };
export interface MessageDestination {
  readonly retryNotBeforeAt?: string;
  readonly modelUnavailable?: boolean;
  readonly operation: string;
  readonly maxAttemptDurationMs: number;
  readonly connection: string;
}
export const researcherMessageLimit = 20_000;
export function validResearcherMessage(text: string): boolean {
  return text.trim().length > 0 && Array.from(text).length <= researcherMessageLimit;
}
export interface ResearchInputs {
  "agentPreference.list": { readonly operationId?: string };
  "agentPreference.replace": ResearchPayloads["agentPreference.replace"];
  "providerModel.list": ProviderModelPageInput;
  "handoff.accept": ResearchPayloads["handoff.accept"];
  "handoff.decline": ResearchPayloads["handoff.decline"];
  "handoff.return": Omit<ResearchPayloads["handoff.return"], "selection"> & {
    readonly selection: string | TextDescriptor;
  };
  "handoff.selection": {
    readonly conversationId: string;
    readonly expectedOwnerRevision: number;
    readonly after: number;
  };
  "pause.read": Record<string, never>;
  "contribution.startAgain": ResearchPayloads["contribution.startAgain"];
  "contribution.tryAgain": ResearchPayloads["contribution.tryAgain"];
  "consultation.decline": ResearchPayloads["consultation.decline"];
  "plan.finish": ResearchPayloads["plan.finish"];
  "plan.cancel": ResearchPayloads["plan.cancel"];
  "plan.read": { readonly planId: string };
  "plan.accept": ResearchPayloads["plan.accept"];
  "plan.decline": ResearchPayloads["plan.decline"];
  "planChange.read": { readonly conversationId: string; readonly proposalId: string };
  "memory.add": Omit<ResearchPayloads["memory.add"], "text"> & {
    readonly text: string | TextDescriptor;
  };
  "memory.edit": Omit<ResearchPayloads["memory.edit"], "text"> & {
    readonly text: string | TextDescriptor;
  };
  "memory.withdraw": ResearchPayloads["memory.withdraw"];
  "memory.list": { readonly projectId: string; readonly after: string | null };
  "memory.history": {
    readonly projectId: string;
    readonly entryId: string;
    readonly before: number | null;
  };
  "memory.undo": ResearchPayloads["memory.undo"];
  "planChange.apply": ResearchPayloads["planChange.apply"];
  "planChange.decline": ResearchPayloads["planChange.decline"];
  "planEvent.list": { readonly planId: string; readonly afterSequence: number };
  "consultation.accept": ResearchPayloads["consultation.accept"];
  "task.tryAgain": ResearchPayloads["task.tryAgain"];
  "synthesis.tryAgain": ResearchPayloads["synthesis.tryAgain"];
  "task.startAgain": ResearchPayloads["task.startAgain"];
  "usagePause.resume": ResearchPayloads["usagePause.resume"];
  "task.continueAll": ResearchPayloads["task.continueAll"];
  "conversation.stop": ResearchPayloads["conversation.stop"];
  "task.stop": ResearchPayloads["task.stop"];
  "destination.read": { readonly projectId: string } & (
    { readonly conversationId: string } | { readonly agentId: ConversationAgent }
  );
  "project.create": ResearchPayloads["project.create"];
  "project.open": ResearchPayloads["project.open"];
  "project.rename": ResearchPayloads["project.rename"];
  "project.read": { readonly projectId: string };
  "project.confirmSetup": ResearchPayloads["project.confirmSetup"];
  "project.rejectSetup": ResearchPayloads["project.rejectSetup"];
  "conversation.start": Omit<ResearchPayloads["conversation.start"], "content"> & {
    readonly content: string | TextDescriptor;
  };
  "conversation.rename": ResearchPayloads["conversation.rename"];
  "message.append": { readonly conversationId: string; readonly content: string | TextDescriptor };
  "projectAttention.list": { readonly cursor: string | null; readonly count: number };
  "project.list": { readonly cursor: ProjectCursor | null; readonly count: number };
  "conversation.list": {
    readonly projectId: string;
    readonly cursor: ConversationCursor | null;
    readonly count: number;
  };
  "conversation.read": { readonly projectId: string; readonly ids: readonly string[] };
  "timeline.listBefore": {
    readonly conversationId: string;
    readonly cursor: TimelineCursor | null;
    readonly count: number;
  };
  "timeline.read": { readonly conversationId: string; readonly ids: readonly string[] };
  "research.subscribe": ResearchScope & { readonly subscriptionId: string };
  "text.part": TextPart;
  "text.readPart": { readonly source: string; readonly index: number };
  "reply.details": { readonly projectId: string; readonly taskId: string };
  "reply.readParts": { readonly taskId: string; readonly fromSequence: number };
}
export interface ResearchOutputs {
  "agentPreference.list": AgentPreferences;
  "agentPreference.replace": ResearchResult;
  "providerModel.list": ProviderModelPage;
  "handoff.accept": ResearchResult;
  "handoff.decline": ResearchResult;
  "handoff.return": ResearchResult;
  "handoff.selection": HandoffSelectionPage;
  "pause.read": PauseCounts;
  "contribution.startAgain": ResearchResult;
  "contribution.tryAgain": ResearchResult;
  "consultation.decline": ResearchResult;
  "plan.finish": FinishPlanResult;
  "plan.cancel": FinishPlanResult;
  "plan.read": PlanSnapshot;
  "plan.accept": ResearchResult;
  "plan.decline": ResearchResult;
  "planChange.read": PlanChangePreview & { readonly proposalId: string };
  "memory.add": ResearchResult;
  "memory.edit": ResearchResult;
  "memory.withdraw": ResearchResult;
  "memory.list": MemoryPage;
  "memory.history": MemoryHistory;
  "memory.undo": ResearchResult;
  "planChange.apply": ResearchResult;
  "planChange.decline": ResearchResult;
  "planEvent.list": PlanEventPage;
  "consultation.accept": ResearchResult;
  "task.tryAgain": ResearchResult;
  "synthesis.tryAgain": ResearchResult;
  "task.startAgain": ResearchResult;
  "usagePause.resume": ResearchResult;
  "task.continueAll": ResearchResult;
  "conversation.stop": ResearchResult;
  "task.stop": ResearchResult;
  "destination.read": { readonly destination: MessageDestination | null };
  "project.create": ResearchResult;
  "project.open": ResearchResult;
  "project.rename": RenameProjectResult;
  "project.read": ProjectRecord;
  "project.confirmSetup": ResearchResult;
  "project.rejectSetup": ResearchResult;
  "conversation.start": ResearchResult;
  "conversation.rename": ResearchResult;
  "message.append": ResearchResult;
  "project.list": ListPage<ProjectSummary, ProjectCursor>;
  "projectAttention.list": ProjectAttentionPage;
  "conversation.list": ListPage<ConversationSummary, ConversationCursor>;
  "conversation.read": IdPage<ConversationSummary>;
  "timeline.listBefore": ListPage<TimelineItem, TimelineCursor>;
  "timeline.read": IdPage<TimelineItem>;
  "research.subscribe": { readonly subscriptionId: string };
  "text.part": { readonly accepted: true };
  "text.readPart": { readonly text: string };
  "reply.readParts": ReplyParts;
  "reply.details": ReplyDetails;
}
export interface ResearchPort {
  listAgentPreferences(operationId?: string): PortCall<AgentPreferences>;
  replaceAgentPreference(
    operationId: string,
    input: ResearchInputs["agentPreference.replace"],
  ): PortCall<ResearchResult>;
  listProviderModels(input: ProviderModelPageInput): PortCall<ProviderModelPage>;
  acceptHandoff(
    operationId: string,
    input: ResearchInputs["handoff.accept"],
  ): PortCall<ResearchResult>;
  declineHandoff(
    operationId: string,
    input: ResearchInputs["handoff.decline"],
  ): PortCall<ResearchResult>;
  returnHandoff(
    operationId: string,
    input: ResearchInputs["handoff.return"],
  ): PortCall<ResearchResult>;
  listHandoffSelection(input: ResearchInputs["handoff.selection"]): PortCall<HandoffSelectionPage>;
  readPauses(): PortCall<PauseCounts>;
  cancelPlan(operationId: string, input: ResearchInputs["plan.cancel"]): PortCall<FinishPlanResult>;
  acceptPlan(operationId: string, input: ResearchInputs["plan.accept"]): PortCall<ResearchResult>;
  declinePlan(operationId: string, input: ResearchInputs["plan.decline"]): PortCall<ResearchResult>;
  readPlanChange(
    input: ResearchInputs["planChange.read"],
  ): PortCall<ResearchOutputs["planChange.read"]>;
  applyPlanChange(
    operationId: string,
    input: ResearchInputs["planChange.apply"],
  ): PortCall<ResearchResult>;
  declinePlanChange(
    operationId: string,
    input: ResearchInputs["planChange.decline"],
  ): PortCall<ResearchResult>;
  readPlan(input: ResearchInputs["plan.read"]): PortCall<PlanSnapshot>;
  listPlanEvents(input: ResearchInputs["planEvent.list"]): PortCall<PlanEventPage>;
  finishPlan(operationId: string, input: ResearchInputs["plan.finish"]): PortCall<FinishPlanResult>;
  acceptConsultation(
    operationId: string,
    input: ResearchInputs["consultation.accept"],
  ): PortCall<ResearchResult>;
  declineConsultation(
    operationId: string,
    input: ResearchInputs["consultation.decline"],
  ): PortCall<ResearchResult>;
  tryAgainContribution(
    operationId: string,
    input: ResearchInputs["contribution.tryAgain"],
  ): PortCall<ResearchResult>;
  startAgainContribution(
    operationId: string,
    input: ResearchInputs["contribution.startAgain"],
  ): PortCall<ResearchResult>;
  tryAgainSynthesis(
    operationId: string,
    input: ResearchInputs["synthesis.tryAgain"],
  ): PortCall<ResearchResult>;
  tryAgainTask(
    operationId: string,
    input: ResearchInputs["task.tryAgain"],
  ): PortCall<ResearchResult>;
  startAgainTask(
    operationId: string,
    input: ResearchInputs["task.startAgain"],
  ): PortCall<ResearchResult>;
  resumeUsagePause(
    operationId: string,
    input: ResearchInputs["usagePause.resume"],
  ): PortCall<ResearchResult>;
  continueAllTasks(operationId: string): PortCall<ResearchResult>;
  stopConversation(
    operationId: string,
    input: ResearchInputs["conversation.stop"],
  ): PortCall<ResearchResult>;
  addMemory(operationId: string, input: ResearchInputs["memory.add"]): PortCall<ResearchResult>;
  editMemory(operationId: string, input: ResearchInputs["memory.edit"]): PortCall<ResearchResult>;
  withdrawMemory(
    operationId: string,
    input: ResearchInputs["memory.withdraw"],
  ): PortCall<ResearchResult>;
  listMemory(input: ResearchInputs["memory.list"]): PortCall<MemoryPage>;
  readMemoryHistory(input: ResearchInputs["memory.history"]): PortCall<MemoryHistory>;
  undoMemory(operationId: string, input: ResearchInputs["memory.undo"]): PortCall<ResearchResult>;
  stopTask(operationId: string, input: ResearchInputs["task.stop"]): PortCall<ResearchResult>;
  readDestination(
    input: ResearchInputs["destination.read"],
  ): PortCall<ResearchOutputs["destination.read"]>;
  createProject(operationId: string): PortCall<ResearchResult>;
  openProject(operationId: string, input: ResearchInputs["project.open"]): PortCall<ResearchResult>;
  renameProject(
    operationId: string,
    input: ResearchInputs["project.rename"],
  ): PortCall<RenameProjectResult>;
  readProject(input: ResearchInputs["project.read"]): PortCall<ProjectRecord>;
  confirmProjectSetup(
    operationId: string,
    input: ResearchInputs["project.confirmSetup"],
  ): PortCall<ResearchResult>;
  rejectProjectSetup(
    operationId: string,
    input: ResearchInputs["project.rejectSetup"],
  ): PortCall<ResearchResult>;
  startConversation(
    operationId: string,
    input: ResearchInputs["conversation.start"],
  ): PortCall<ResearchResult>;
  renameConversation(
    operationId: string,
    input: ResearchInputs["conversation.rename"],
  ): PortCall<ResearchResult>;
  appendMessage(
    operationId: string,
    input: ResearchInputs["message.append"],
  ): PortCall<ResearchResult>;
  listProjectAttention(
    input: ResearchInputs["projectAttention.list"],
  ): PortCall<ProjectAttentionPage>;
  listProjects(input: ResearchInputs["project.list"]): PortCall<ResearchOutputs["project.list"]>;
  listConversations(
    input: ResearchInputs["conversation.list"],
  ): PortCall<ResearchOutputs["conversation.list"]>;
  readConversations(
    input: ResearchInputs["conversation.read"],
  ): PortCall<ResearchOutputs["conversation.read"]>;
  listTimelineBefore(
    input: ResearchInputs["timeline.listBefore"],
  ): PortCall<ResearchOutputs["timeline.listBefore"]>;
  readTimeline(input: ResearchInputs["timeline.read"]): PortCall<ResearchOutputs["timeline.read"]>;
  sendTextPart(operationId: string, input: TextPart): PortCall<ResearchOutputs["text.part"]>;
  readTextPart(input: ResearchInputs["text.readPart"]): PortCall<ResearchOutputs["text.readPart"]>;
  readReplyDetails(input: ResearchInputs["reply.details"]): PortCall<ReplyDetails>;
  readReplyParts(input: ResearchInputs["reply.readParts"]): PortCall<ReplyParts>;
  subscribeResearch(
    scope: ResearchScope,
    listener: (notice: Outcome<ResearchEvent>) => void,
  ): Subscription;
}
export function isResearchOperation(value: string): value is ResearchOperation {
  return researchOperations.some((operation) => operation === value);
}
export function isResearchMutation(value: string): value is WindowResearchCommand {
  return [
    "agentPreference.replace",
    "handoff.accept",
    "handoff.decline",
    "handoff.return",
    "project.create",
    "project.open",
    "project.rename",
    "project.confirmSetup",
    "project.rejectSetup",
    "conversation.start",
    "conversation.rename",
    "message.append",
    "conversation.stop",
    "task.stop",
    "plan.finish",
    "plan.cancel",
    "plan.accept",
    "plan.decline",
    "memory.add",
    "memory.edit",
    "memory.withdraw",
    "memory.undo",
    "planChange.apply",
    "planChange.decline",
    "consultation.accept",
    "consultation.decline",
    "contribution.tryAgain",
    "contribution.startAgain",
    "task.tryAgain",
    "synthesis.tryAgain",
    "task.startAgain",
    "usagePause.resume",
    "task.continueAll",
  ].includes(value);
}
export function compareTimeline(a: TimelineCursor, b: TimelineCursor): number {
  return a.position - b.position || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function mergeTimeline(
  current: readonly TimelineItem[],
  incoming: readonly TimelineItem[],
): TimelineItem[] {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const previous = items.get(item.id);
    if (!previous || previous.revision < item.revision) items.set(item.id, item);
    else if (
      previous.kind === "task" &&
      item.kind === "task" &&
      (item.consultation || item.synthesis) &&
      item.superseded &&
      previous.revision === item.revision
    )
      items.set(item.id, {
        ...previous,
        superseded: true,
        ...(item.consultationRetryFits === undefined
          ? {}
          : { consultationRetryFits: item.consultationRetryFits }),
      });
    else if (
      previous.kind === "task" &&
      item.kind === "task" &&
      previous.revision === item.revision &&
      previous.blockingReason === "configuration_unavailable" &&
      item.blockingReason === "configuration_unavailable"
    ) {
      const prior = { ...previous };
      delete prior.modelName;
      delete prior.modelUnavailable;
      items.set(item.id, {
        ...prior,
        ...(item.modelName === undefined ? {} : { modelName: item.modelName }),
        ...(item.modelUnavailable === undefined ? {} : { modelUnavailable: item.modelUnavailable }),
        ...(item.consultationRetryFits === undefined
          ? {}
          : { consultationRetryFits: item.consultationRetryFits }),
      });
    } else if (
      previous.kind === "task" &&
      item.kind === "task" &&
      previous.revision === item.revision &&
      ((previous.state === "queued" && item.state === "queued") ||
        item.consultationRetryFits !== previous.consultationRetryFits)
    ) {
      const prior = { ...previous };
      delete prior.retryNotBeforeAt;
      items.set(item.id, {
        ...prior,
        waitingForModels: item.waitingForModels,
        waitingLimit: item.waitingLimit,
        ...(item.retryNotBeforeAt ? { retryNotBeforeAt: item.retryNotBeforeAt } : {}),
        ...(item.consultationRetryFits === undefined
          ? {}
          : { consultationRetryFits: item.consultationRetryFits }),
      });
    }
  }
  for (const task of items.values()) {
    if (task.kind !== "task" || !task.consultation || !task.replacesTaskId) continue;
    const replaced = items.get(task.replacesTaskId);
    if (replaced && replaced.kind === "task" && !replaced.superseded)
      items.set(replaced.id, { ...replaced, superseded: true, consultationRetryFits: false });
  }
  return [...items.values()].sort(compareTimeline);
}
export function splitText(text: string, maximum = 4096): string[] {
  if (!Number.isSafeInteger(maximum) || maximum < 4) throw new Error("Invalid text part bound.");
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const point of text) {
    const cp = point.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Error("Invalid Unicode scalar.");
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > maximum) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += point;
    bytes += size;
  }
  if (part || !parts.length) parts.push(part);
  return parts;
}

function obj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    obj(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function isResearchId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
function opaque(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
function hash(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function descriptor(value: unknown): value is TextDescriptor {
  return (
    exact(value, ["parts", "bytes", "sha256"]) &&
    integer(value.parts, 2, 64) &&
    integer(value.bytes, 4097, 262144) &&
    hash(value.sha256)
  );
}
export function isTextReference(value: unknown): value is TextReference {
  return (
    exact(value, ["source", "parts", "bytes", "sha256"]) &&
    opaque(value.source) &&
    descriptor({ parts: value.parts, bytes: value.bytes, sha256: value.sha256 })
  );
}
function content(value: unknown): boolean {
  return typeof value === "string" || descriptor(value);
}
function ids(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 128 && value.every(isResearchId);
}
function date(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function nullable(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value === null || valid(value);
}
function cursor(value: unknown): boolean {
  return (
    exact(value, ["position", "rank", "id"]) &&
    integer(value.position) &&
    integer(value.rank) &&
    isResearchId(value.id)
  );
}
export function researchInput(operation: ResearchOperation, value: unknown): boolean {
  switch (operation) {
    case "agentPreference.list":
      return exact(value, []) || (exact(value, ["operationId"]) && opaque(value.operationId));
    case "agentPreference.replace":
      return isReplaceAgentPreference(value);
    case "providerModel.list":
      return isProviderModelPageInput(value);
    case "handoff.accept":
      return (
        exact(value, ["proposalId", "expectedOwnerRevision"]) &&
        isResearchId(value.proposalId) &&
        integer(value.expectedOwnerRevision)
      );
    case "handoff.decline":
      return exact(value, ["proposalId"]) && isResearchId(value.proposalId);
    case "handoff.return":
      return (
        exact(value, ["conversationId", "expectedOwnerRevision", "selection"]) &&
        isResearchId(value.conversationId) &&
        integer(value.expectedOwnerRevision) &&
        content(value.selection)
      );
    case "handoff.selection":
      return (
        exact(value, ["conversationId", "expectedOwnerRevision", "after"]) &&
        isResearchId(value.conversationId) &&
        integer(value.expectedOwnerRevision) &&
        integer(value.after, 0)
      );
    case "memory.add":
      return (
        (exact(value, ["projectId", "kind", "text"]) ||
          (exact(value, ["projectId", "kind", "text", "sourceMessageId"]) &&
            isResearchId(value.sourceMessageId))) &&
        isResearchId(value.projectId) &&
        typeof value.kind === "string" &&
        content(value.text)
      );
    case "memory.edit":
      return (
        exact(value, ["entryId", "expectedVersion", "kind", "text"]) &&
        isResearchId(value.entryId) &&
        integer(value.expectedVersion) &&
        typeof value.kind === "string" &&
        content(value.text)
      );
    case "memory.withdraw":
      return (
        exact(value, ["entryId", "expectedVersion"]) &&
        isResearchId(value.entryId) &&
        integer(value.expectedVersion)
      );
    case "memory.list":
      return (
        exact(value, ["projectId", "after"]) &&
        isResearchId(value.projectId) &&
        nullable(value.after, isResearchId)
      );
    case "memory.history":
      return (
        exact(value, ["projectId", "entryId", "before"]) &&
        isResearchId(value.projectId) &&
        isResearchId(value.entryId) &&
        nullable(value.before, integer)
      );
    case "conversation.stop":
      return exact(value, ["conversationId"]) && isResearchId(value.conversationId);
    case "task.continueAll":
    case "pause.read":
      return exact(value, []);
    case "usagePause.resume":
      return exact(value, ["connection"]) && isUsagePauseConnection(value.connection);
    case "contribution.tryAgain":
      return (
        (exact(value, ["taskId"]) && isResearchId(value.taskId)) ||
        (exact(value, ["contributionId"]) && isResearchId(value.contributionId))
      );
    case "contribution.startAgain":
    case "synthesis.tryAgain":
    case "task.tryAgain":
    case "task.startAgain":
    case "task.stop":
    case "memory.undo":
      return exact(value, ["taskId"]) && isResearchId(value.taskId);
    case "destination.read":
      return (
        obj(value) &&
        isResearchId(value.projectId) &&
        ((exact(value, ["projectId", "conversationId"]) && isResearchId(value.conversationId)) ||
          (exact(value, ["projectId", "agentId"]) && isConversationAgent(value.agentId)))
      );
    case "project.create":
      return exact(value, []);
    case "project.open":
    case "project.read":
      return exact(value, ["projectId"]) && isResearchId(value.projectId);
    case "project.rename":
      return (
        exact(value, ["projectId", "title", "expectedTitleRevision"]) &&
        isResearchId(value.projectId) &&
        typeof value.title === "string" &&
        integer(value.expectedTitleRevision)
      );
    case "planEvent.list":
      return (
        exact(value, ["planId", "afterSequence"]) &&
        isResearchId(value.planId) &&
        integer(value.afterSequence, 0)
      );
    case "plan.accept":
      return (
        exact(value, ["planId", "connections"]) &&
        isResearchId(value.planId) &&
        isPlanConnections(value.connections)
      );
    case "plan.read":
    case "plan.decline":
    case "plan.cancel":
    case "plan.finish":
      return exact(value, ["planId"]) && isResearchId(value.planId);
    case "consultation.accept":
      return (
        exact(value, ["proposalId", "connection"]) &&
        isResearchId(value.proposalId) &&
        isConnectionId(value.connection)
      );
    case "planChange.read":
      return (
        exact(value, ["conversationId", "proposalId"]) &&
        isResearchId(value.conversationId) &&
        isResearchId(value.proposalId)
      );
    case "planChange.apply":
    case "planChange.decline":
    case "consultation.decline":
    case "project.confirmSetup":
    case "project.rejectSetup":
      return exact(value, ["proposalId"]) && isResearchId(value.proposalId);
    case "conversation.start":
      return (
        (exact(value, ["projectId", "content"]) ||
          (exact(value, ["projectId", "agentId", "content"]) &&
            isConversationAgent(value.agentId))) &&
        isResearchId(value.projectId) &&
        content(value.content)
      );
    case "message.append":
      return (
        exact(value, ["conversationId", "content"]) &&
        isResearchId(value.conversationId) &&
        content(value.content)
      );
    case "conversation.rename":
      return (
        exact(value, ["conversationId", "title", "expectedUpdatedAt"]) &&
        isResearchId(value.conversationId) &&
        typeof value.title === "string" &&
        date(value.expectedUpdatedAt)
      );
    case "projectAttention.list":
      return (
        exact(value, ["cursor", "count"]) &&
        nullable(value.cursor, isResearchId) &&
        integer(value.count, 1, 128)
      );
    case "project.list":
      return (
        exact(value, ["cursor", "count"]) &&
        nullable(value.cursor, projectCursor) &&
        integer(value.count, 1, 40)
      );
    case "conversation.list":
      return (
        exact(value, ["projectId", "cursor", "count"]) &&
        isResearchId(value.projectId) &&
        nullable(value.cursor, conversationCursor) &&
        integer(value.count, 1, 128)
      );
    case "conversation.read":
      return exact(value, ["projectId", "ids"]) && isResearchId(value.projectId) && ids(value.ids);
    case "timeline.listBefore":
      return (
        exact(value, ["conversationId", "cursor", "count"]) &&
        isResearchId(value.conversationId) &&
        nullable(value.cursor, cursor) &&
        integer(value.count, 1, 50)
      );
    case "timeline.read":
      return (
        exact(value, ["conversationId", "ids"]) &&
        isResearchId(value.conversationId) &&
        ids(value.ids)
      );
    case "research.subscribe":
      return (
        exact(value, ["subscriptionId", "projectId", "conversationId"]) &&
        opaque(value.subscriptionId) &&
        nullable(value.projectId, isResearchId) &&
        nullable(value.conversationId, isResearchId) &&
        (value.conversationId === null || value.projectId !== null)
      );
    case "text.part":
      return (
        exact(value, ["index", "count", "bytes", "sha256", "text"]) &&
        integer(value.index, Number.MIN_SAFE_INTEGER) &&
        integer(value.count, 2, 64) &&
        integer(value.bytes, 4097, 262144) &&
        hash(value.sha256) &&
        typeof value.text === "string"
      );
    case "text.readPart":
      return (
        exact(value, ["source", "index"]) && opaque(value.source) && integer(value.index, 1, 64)
      );
    case "reply.details":
      return (
        exact(value, ["projectId", "taskId"]) &&
        isResearchId(value.projectId) &&
        isResearchId(value.taskId)
      );
    case "reply.readParts":
      return (
        exact(value, ["taskId", "fromSequence"]) &&
        isResearchId(value.taskId) &&
        integer(value.fromSequence)
      );
  }
}
function conversationCursor(value: unknown): boolean {
  return exact(value, ["latestAt", "id"]) && date(value.latestAt) && isResearchId(value.id);
}
function conversation(value: unknown): boolean {
  return (
    exact(value, [
      "id",
      "projectId",
      "title",
      "createdAt",
      "updatedAt",
      "revision",
      "agentId",
      "ownerRevision",
      "ownerPosition",
      "latestAt",
      "latestPrefix",
      "latestTruncated",
      "latestLanguage",
      "status",
      "latestReplyTaskId",
      "runningTask",
    ]) &&
    isResearchId(value.id) &&
    isResearchId(value.projectId) &&
    nullable(value.title, (x) => typeof x === "string") &&
    date(value.createdAt) &&
    date(value.updatedAt) &&
    integer(value.revision) &&
    isReplyAgent(value.agentId) &&
    integer(value.ownerRevision) &&
    nullable(value.ownerPosition, integer) &&
    date(value.latestAt) &&
    typeof value.latestPrefix === "string" &&
    Array.from(value.latestPrefix).length <= conversationPreviewPrefixLimit &&
    typeof value.latestTruncated === "boolean" &&
    (!value.latestTruncated ||
      Array.from(value.latestPrefix).length === conversationPreviewPrefixLimit) &&
    nullable(value.latestLanguage, (x) => typeof x === "string") &&
    nullable(value.status, (x) => x === "attention" || x === "replying" || x === "waiting") &&
    nullable(value.latestReplyTaskId, isResearchId) &&
    nullable(
      value.runningTask,
      (x) =>
        exact(x, ["id", "agentId", "state"]) &&
        isResearchId(x.id) &&
        isReplyAgent(x.agentId) &&
        typeof x.state === "string" &&
        ["running", "cancelling"].includes(x.state),
    )
  );
}
function projectCursor(value: unknown): boolean {
  return exact(value, ["lastOpenedAt", "id"]) && date(value.lastOpenedAt) && isResearchId(value.id);
}
function project(value: unknown, summary: boolean): boolean {
  return (
    exact(value, [
      "id",
      "projectType",
      "title",
      "titleRevision",
      "documentLanguage",
      "isDevelopment",
      "setupConfirmedAt",
      "lastOpenedAt",
      ...(summary ? ["needsAttention"] : []),
      "createdAt",
      "updatedAt",
    ]) &&
    isResearchId(value.id) &&
    value.projectType === "thesis" &&
    integer(value.titleRevision) &&
    nullable(value.title, (x) => typeof x === "string") &&
    nullable(value.documentLanguage, (x) => typeof x === "string") &&
    typeof value.isDevelopment === "boolean" &&
    nullable(value.setupConfirmedAt, date) &&
    date(value.lastOpenedAt) &&
    (!summary || typeof value.needsAttention === "boolean") &&
    date(value.createdAt) &&
    date(value.updatedAt)
  );
}
function item(value: unknown): boolean {
  if (
    !obj(value) ||
    !cursor({ position: value.position, rank: value.rank, id: value.id }) ||
    !integer(value.revision)
  )
    return false;
  if (value.kind === "memoryReview")
    return (
      exact(value, ["id", "position", "rank", "revision", "kind", "taskId"]) &&
      value.rank === 4 &&
      value.revision === 1 &&
      isResearchId(value.taskId)
    );
  if (value.kind === "memoryChange") {
    if (
      !exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "taskId",
        "added",
        "edited",
        "merged",
        "withdrawn",
        "rejected",
        "canUndo",
      ]) ||
      !isResearchId(value.taskId) ||
      value.rank !== 3 ||
      !(value.revision === 1 || value.revision === 2) ||
      !integer(value.added, 0) ||
      !integer(value.edited, 0) ||
      !integer(value.merged, 0) ||
      !integer(value.withdrawn, 0) ||
      !integer(value.rejected, 0)
    )
      return false;
    const applied = value.added + value.edited + value.merged + value.withdrawn;
    return (
      applied <= 3 &&
      (applied > 0 || value.rejected > 0) &&
      (value.revision === 1 || applied > 0) &&
      value.canUndo === (applied > 0 && value.revision === 1)
    );
  }
  if (value.kind === "handoffDivider")
    return (
      exact(value, ["id", "position", "rank", "revision", "kind", "agentId"]) &&
      value.rank === 1 &&
      value.revision === 1 &&
      isReplyAgent(value.agentId)
    );
  if (value.kind === "handoffProposal")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "taskId",
        "expectedOwnerRevision",
        "note",
        "reason",
        "state",
        "invalidReason",
      ]) &&
      value.rank === 2 &&
      isResearchId(value.taskId) &&
      integer(value.expectedOwnerRevision) &&
      value.revision === (value.state === "proposed" || value.state === "invalid" ? 1 : 2) &&
      (value.state === "invalid"
        ? handoffInvalidReasons.includes(value.invalidReason as HandoffInvalidReason) &&
          value.note === null &&
          value.reason === null
        : ["proposed", "accepted", "declined", "replaced"].includes(value.state as string) &&
          value.invalidReason === null &&
          (typeof value.note === "string" || isTextReference(value.note)) &&
          typeof value.reason === "string")
    );
  if (value.kind === "planChangeProposal")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "taskId",
        "state",
        "invalidReason",
      ]) &&
      value.rank === 2 &&
      isResearchId(value.taskId) &&
      value.revision === (value.state === "proposed" || value.state === "invalid" ? 1 : 2) &&
      (value.state === "invalid"
        ? planChangeInvalidReasons.includes(value.invalidReason as PlanChangeInvalidReason)
        : ["proposed", "applied", "declined", "replaced"].some((state) => state === value.state) &&
          value.invalidReason === null)
    );
  if (value.kind === "plan")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "taskId",
        "language",
        "state",
        "invalidReason",
      ]) &&
      value.rank === 2 &&
      nullable(value.taskId, isResearchId) &&
      nullable(value.language, (language) => typeof language === "string") &&
      (value.state === "invalid"
        ? isResearchId(value.taskId) &&
          planInvalidReasons.includes(value.invalidReason as PlanInvalidReason)
        : ["proposed", "accepted", "declined", "replaced"].includes(value.state as string) &&
          value.invalidReason === null)
    );
  if (value.kind === "consultation")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "taskId",
        "language",
        "state",
        "invalidReason",
        "agentId",
        "request",
        "reason",
        "connection",
      ]) &&
      value.rank === 2 &&
      isResearchId(value.taskId) &&
      nullable(value.language, (language) => typeof language === "string") &&
      ["proposed", "accepted", "declined", "replaced", "invalid"].includes(value.state as string) &&
      (value.state === "accepted" ? isConnectionId(value.connection) : value.connection === null) &&
      (value.state === "invalid"
        ? consultationInvalidReasons.includes(value.invalidReason as ConsultationInvalidReason) &&
          value.agentId === null &&
          value.request === null &&
          value.reason === null
        : value.invalidReason === null &&
          value.agentId === "josefa" &&
          (typeof value.request === "string" || isTextReference(value.request)) &&
          typeof value.reason === "string")
    );
  if (value.kind === "setupProposal")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "taskId",
        "title",
        "documentLanguage",
        "state",
        "invalidReason",
      ]) &&
      value.rank === 2 &&
      isResearchId(value.taskId) &&
      (typeof value.title === "string" || isTextReference(value.title)) &&
      (typeof value.documentLanguage === "string" || isTextReference(value.documentLanguage)) &&
      ["proposed", "invalid", "replaced", "rejected", "confirmed"].includes(
        value.state as string,
      ) &&
      value.revision === (["proposed", "invalid"].includes(value.state as string) ? 1 : 2) &&
      (value.state === "invalid"
        ? [
            "title_empty",
            "title_whitespace",
            "title_too_long",
            "title_invalid",
            "language_malformed",
            "language_unknown",
            "multiple_calls",
          ].includes(value.invalidReason as string)
        : value.invalidReason === null)
    );
  if (!nullable(value.language, (x) => typeof x === "string")) return false;
  if (value.kind === "message")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "authorKind",
        "agentId",
        "taskId",
        "content",
        "language",
        "ending",
        ...(value.consultation === true ? ["consultation"] : []),
        ...(value.synthesisSources !== undefined ? ["synthesisSources"] : []),
        ...(value.planContribution !== undefined ? ["planContribution"] : []),
      ]) &&
      value.rank === 1 &&
      value.revision === 1 &&
      (value.synthesisSources === undefined ||
        (value.agentId === "virgilio" &&
          value.consultation === undefined &&
          (isSynthesisSources(value.synthesisSources) ||
            isTextReference(value.synthesisSources)))) &&
      (value.planContribution === undefined ||
        (value.authorKind === "agent" &&
          value.consultation === undefined &&
          value.synthesisSources === undefined &&
          exact(value.planContribution, ["planId", "key"]) &&
          isResearchId(value.planContribution.planId) &&
          typeof value.planContribution.key === "string" &&
          /^[a-z0-9-]{1,64}(?![\s\S])/.test(value.planContribution.key))) &&
      (typeof value.content === "string" || isTextReference(value.content)) &&
      (value.authorKind === "researcher"
        ? value.consultation === undefined &&
          value.agentId === null &&
          value.taskId === null &&
          value.language === null &&
          value.ending === null
        : value.authorKind === "agent" &&
          isReplyAgent(value.agentId) &&
          isResearchId(value.taskId) &&
          typeof value.ending === "string" &&
          ["complete", "partial"].includes(value.ending))
    );
  return (
    exact(value, [
      "id",
      "position",
      "rank",
      "revision",
      "kind",
      "agentId",
      "language",
      "state",
      "connection",
      "blockingReason",
      "outcomeReason",
      "replyMessageId",
      "waitingForModels",
      ...anthropicNoticeKeys(value),
      ...(Object.hasOwn(value, "modelUnavailable") ? ["modelUnavailable"] : []),
      "waitingLimit",
      "dispatched",
      "superseded",
      "maxAttemptDurationMs",
      "maxInactivityMs",
      ...(value.consultation === true
        ? ["consultation", "replacesTaskId", "consultationRetryFits"]
        : []),
      ...(value.synthesis === true
        ? [
            "synthesis",
            "synthesisStopped",
            ...(value.synthesisPlanId === undefined ? [] : ["synthesisPlanId"]),
          ]
        : []),
    ]) &&
    (value.synthesis !== true ||
      (value.agentId === "virgilio" &&
        value.consultation === undefined &&
        typeof value.synthesisStopped === "boolean" &&
        (value.synthesisPlanId === undefined || isResearchId(value.synthesisPlanId)))) &&
    (value.consultation !== true ||
      (nullable(value.replacesTaskId, isResearchId) &&
        typeof value.consultationRetryFits === "boolean")) &&
    isTaskProgress(value) &&
    (!Object.hasOwn(value, "modelName") || typeof value.modelName === "string") &&
    typeof value.waitingForModels === "boolean" &&
    nullable(value.waitingLimit, integer) &&
    typeof value.dispatched === "boolean" &&
    typeof value.superseded === "boolean" &&
    value.kind === "task" &&
    value.rank === 3
  );
}
function uniqueCurrentSynthesisKeys(sources: readonly SynthesisSource[]): boolean {
  const keys = sources
    .filter(({ state }) => state !== "removed" && state !== "replaced")
    .map(({ key }) => key);
  return new Set(keys).size === keys.length;
}
export function isSynthesisSources(value: unknown): value is readonly SynthesisSource[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= planEventLimit + 8 &&
    value.every(
      (source: unknown) =>
        exact(source, ["key", "agentId", "state", "messageId"]) &&
        typeof source.key === "string" &&
        /^[a-z0-9-]{1,64}(?![\s\S])/.test(source.key) &&
        isReplyAgent(source.agentId) &&
        (source.state === "completed"
          ? isResearchId(source.messageId)
          : ["failed", "blocked", "cancelled", "uncertain", "removed", "replaced"].some(
              (state) => state === source.state,
            ) && source.messageId === null),
    ) &&
    uniqueCurrentSynthesisKeys(value as SynthesisSource[])
  );
}

export function researchOutput(operation: ResearchOperation, value: unknown): boolean {
  if (operation === "pause.read")
    return (
      exact(value, ["revision", "restart", "usage"]) &&
      integer(value.revision) &&
      integer(value.restart, 0) &&
      Array.isArray(value.usage) &&
      value.usage.length <= 128 &&
      value.usage.every(
        (entry) =>
          exact(entry, ["connection", "count"]) &&
          isConnectionId(entry.connection) &&
          integer(entry.count, 0),
      ) &&
      new Set(value.usage.map((entry: unknown) => (obj(entry) ? entry.connection : undefined)))
        .size === value.usage.length
    );
  if (operation === "destination.read")
    return (
      exact(value, ["destination"]) &&
      nullable(
        value.destination,
        (d) =>
          exact(d, [
            "operation",
            "maxAttemptDurationMs",
            "connection",
            ...(obj(d) && Object.hasOwn(d, "retryNotBeforeAt") ? ["retryNotBeforeAt"] : []),
            ...(obj(d) && Object.hasOwn(d, "modelUnavailable") ? ["modelUnavailable"] : []),
          ]) &&
          opaque(d.operation) &&
          integer(d.maxAttemptDurationMs) &&
          isConnectionId(d.connection) &&
          (!Object.hasOwn(d, "retryNotBeforeAt") || date(d.retryNotBeforeAt)) &&
          (!Object.hasOwn(d, "modelUnavailable") || typeof d.modelUnavailable === "boolean"),
      )
    );
  if (operation === "handoff.selection")
    return (
      exact(value, ["priorReply", "messages", "next"]) &&
      typeof value.priorReply === "boolean" &&
      Array.isArray(value.messages) &&
      value.messages.length <= handoffSelectionPageSize &&
      nullable(value.next, integer) &&
      value.messages.every(
        (entry) =>
          exact(entry, ["position", "agentId", "prefix", "truncated"]) &&
          integer(entry.position) &&
          nullable(entry.agentId, isReplyAgent) &&
          typeof entry.prefix === "string" &&
          typeof entry.truncated === "boolean" &&
          Array.from(entry.prefix).length <= conversationPreviewPrefixLimit,
      )
    );
  if (operation === "agentPreference.list") return isAgentPreferences(value);
  if (operation === "providerModel.list") return isProviderModelPage(value);
  if (operation === "plan.read") return isPlanSnapshot(value);
  if (operation === "planChange.read") return isPlanChangePreview(value);
  if (operation === "planEvent.list")
    return (
      exact(value, ["planId", "throughSequence", "events"]) &&
      isResearchId(value.planId) &&
      integer(value.throughSequence, 0) &&
      Array.isArray(value.events) &&
      value.events.length <= planEventPageSize &&
      value.events.every(isPlanEvent)
    );
  if (operation === "plan.finish" || operation === "plan.cancel")
    return (
      exact(value, ["resultId", "outcome"]) &&
      isResearchId(value.resultId) &&
      planOutcomes.includes(value.outcome as PlanOutcome)
    );
  if (operation === "memory.list")
    return (
      exact(value, ["projectId", "revision", "entries", "next", "bytes", "active"]) &&
      isResearchId(value.projectId) &&
      integer(value.revision, 0) &&
      integer(value.bytes, 0, memoryByteLimit) &&
      integer(value.active, 0, memoryEntryLimit) &&
      nullable(value.next, isResearchId) &&
      Array.isArray(value.entries) &&
      value.entries.length <= memoryPageSize &&
      value.entries.every(isMemoryEntry)
    );
  if (operation === "memory.history")
    return (
      exact(value, ["entryId", "versions", "next"]) &&
      isResearchId(value.entryId) &&
      nullable(value.next, integer) &&
      Array.isArray(value.versions) &&
      value.versions.length <= memoryPageSize &&
      value.versions.every(isMemoryVersion)
    );
  if (operation === "project.read") return project(value, false);
  if (operation === "project.rename")
    return (
      exact(value, ["resultId", "titleChange"]) &&
      isResearchId(value.resultId) &&
      exact(value.titleChange, ["title", "titleRevision"]) &&
      typeof value.titleChange.title === "string" &&
      projectTitleError(value.titleChange.title) === null &&
      integer(value.titleChange.titleRevision)
    );
  if (isResearchMutation(operation))
    return exact(value, ["resultId"]) && isResearchId(value.resultId);
  if (operation === "research.subscribe")
    return exact(value, ["subscriptionId"]) && opaque(value.subscriptionId);
  if (operation === "text.part") return exact(value, ["accepted"]) && value.accepted === true;
  if (operation === "text.readPart")
    return exact(value, ["text"]) && typeof value.text === "string";
  if (operation === "reply.details")
    return (
      exact(value, [
        "agentId",
        "operation",
        "instructionVersion",
        "connectionId",
        "connectionKind",
        "account",
        "accountRevision",
        "requestedModel",
        "observedModel",
        ...(obj(value) && Object.hasOwn(value, "requestedEffort") ? ["requestedEffort"] : []),
        ...(obj(value) && Object.hasOwn(value, "observedEffort") ? ["observedEffort"] : []),
        ...(obj(value) && Object.hasOwn(value, "refusalCategory") ? ["refusalCategory"] : []),
        "attempts",
        "startedAt",
        "endedAt",
        "durationMs",
        "tokens",
        "usage",
        "memory",
      ]) &&
      isReplyAgent(value.agentId) &&
      providerOperations.includes(value.operation as ProviderOperation) &&
      integer(value.instructionVersion) &&
      isConnectionId(value.connectionId) &&
      (value.connectionKind === "subscription" || value.connectionKind === "api_key") &&
      (value.account === null ||
        ["same", "different", "disconnected", "unknown"].some((s) => s === value.account)) &&
      nullable(value.accountRevision, isAccountRevision) &&
      nullable(
        value.requestedModel,
        (name) => typeof name === "string" && utf8Size(name) <= 1024,
      ) &&
      (!Object.hasOwn(value, "requestedEffort") ||
        nullable(
          value.requestedEffort,
          (level) => typeof level === "string" && utf8Size(level) <= 128,
        )) &&
      (!Object.hasOwn(value, "observedEffort") ||
        nullable(
          value.observedEffort,
          (level) => typeof level === "string" && utf8Size(level) <= 128,
        )) &&
      nullable(value.observedModel, (name) => typeof name === "string" && utf8Size(name) <= 1024) &&
      (!Object.hasOwn(value, "refusalCategory") ||
        (typeof value.refusalCategory === "string" &&
          /^[a-z0-9_]{1,64}$/.test(value.refusalCategory))) &&
      integer(value.attempts, 0) &&
      nullable(value.startedAt, date) &&
      date(value.endedAt) &&
      nullable(value.durationMs, (ms) => integer(ms, 0)) &&
      exact(value.tokens, [
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "reasoning_tokens",
      ]) &&
      Object.values(value.tokens).every((count) => nullable(count, (n) => integer(n, 0))) &&
      ["reported", "late", "estimated", "unreported", "incomplete"].some(
        (origin) => origin === value.usage,
      ) &&
      Array.isArray(value.memory) &&
      value.memory.length <= memoryEntryLimit &&
      value.memory.every(
        (entry: unknown) =>
          exact(entry, ["entryId", "version", "versionId"]) &&
          isResearchId(entry.entryId) &&
          integer(entry.version) &&
          isResearchId(entry.versionId),
      )
    );
  if (operation === "reply.readParts")
    return (
      exact(value, ["parts", "latestSequence"]) &&
      integer(value.latestSequence, 0) &&
      Array.isArray(value.parts) &&
      value.parts.every(
        (part) =>
          exact(part, ["sequence", "text"]) &&
          integer(part.sequence) &&
          part.sequence <= (value.latestSequence as number) &&
          typeof part.text === "string",
      )
    );
  if (operation === "projectAttention.list")
    return (
      exact(value, ["items", "next", "hasMore", "revision"]) &&
      ids(value.items) &&
      integer(value.revision) &&
      typeof value.hasMore === "boolean" &&
      (value.hasMore ? isResearchId(value.next) : value.next === null)
    );
  const valid =
    operation === "project.list"
      ? (value: unknown) => project(value, true)
      : operation.startsWith("conversation.")
        ? conversation
        : item;
  if (!obj(value) || !Array.isArray(value.items) || !value.items.every(valid)) return false;
  if (operation === "timeline.read" || operation === "conversation.read")
    return exact(value, ["items", "remaining"]) && ids(value.remaining);
  return (
    exact(value, ["items", "next", "hasMore"]) &&
    typeof value.hasMore === "boolean" &&
    (value.hasMore
      ? operation === "timeline.listBefore"
        ? cursor(value.next)
        : operation === "project.list"
          ? projectCursor(value.next)
          : conversationCursor(value.next)
      : value.next === null)
  );
}
export function isPlanEventPayload(kind: PlanEventKind, value: unknown): value is PlanEventPayload {
  if (kind === "graph_changed")
    return exact(value, ["graphVersion"]) && integer(value.graphVersion);
  if (kind === "plan_ended")
    return exact(value, ["outcome"]) && planOutcomes.some((outcome) => outcome === value.outcome);
  if (kind === "continuation_created")
    return exact(value, ["continuationId"]) && isResearchId(value.continuationId);
  if (kind === "contribution_blocked")
    return exact(value, ["blockedBy"]) && isResearchId(value.blockedBy);
  if (kind === "contribution_failed" || kind === "contribution_uncertain")
    return (
      exact(value, []) ||
      (exact(value, ["reason"]) &&
        ["destination_changed", "input_changed", "input_too_large", "cancelled_by_researcher"].some(
          (reason) => reason === value.reason,
        ))
    );
  return exact(value, []);
}
function isPlanEvent(value: unknown): value is PlanEvent {
  if (
    !exact(value, [
      "id",
      "sequence",
      "kind",
      "contributionId",
      "taskId",
      "payload",
      "payloadHash",
      "createdAt",
    ])
  )
    return false;
  const kind = planEventKinds.find((entry) => entry === value.kind);
  return (
    !!kind &&
    isResearchId(value.id) &&
    integer(value.sequence) &&
    (kind.startsWith("contribution_")
      ? isResearchId(value.contributionId) &&
        (isResearchId(value.taskId) ||
          (value.taskId === null &&
            !["contribution_started", "contribution_completed", "contribution_uncertain"].includes(
              kind,
            )))
      : value.contributionId === null && value.taskId === null) &&
    isPlanEventPayload(kind, value.payload) &&
    hash(value.payloadHash) &&
    typeof value.createdAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)
  );
}
function isPlanText(value: unknown): value is PlanText {
  return (
    (typeof value === "string" && utf8Size(JSON.stringify(value)) <= 512) ||
    (exact(value, ["source", "parts", "bytes", "sha256"]) &&
      opaque(value.source) &&
      integer(value.parts, 1, 9) &&
      integer(value.bytes, 1, 32768) &&
      hash(value.sha256))
  );
}
export function isPlanConnections(
  value: unknown,
): value is ResearchInputs["plan.accept"]["connections"] {
  return (
    obj(value) &&
    Object.entries(value).every(
      ([agent, connection]) => isReplyAgent(agent) && isConnectionId(connection),
    )
  );
}
function anthropicNoticeKeys(value: Record<string, unknown>): string[] {
  return ["modelName", "retryNotBeforeAt", "providerMessage"].filter((key) =>
    Object.hasOwn(value, key),
  );
}
function isTaskProgress(
  value: Record<string, unknown>,
): value is PlanTaskProgress & Record<string, unknown> {
  return (
    isReplyAgent(value.agentId) &&
    planSynthesisStates.some((state) => state === value.state) &&
    isConnectionId(value.connection) &&
    nullable(
      value.blockingReason,
      (x) =>
        typeof x === "string" &&
        [
          "connection_disabled",
          "permission_required",
          "input_changed",
          "configuration_unavailable",
          "restart_paused",
          "usage_limit_reached",
        ].includes(x),
    ) &&
    nullable(
      value.outcomeReason,
      (x) =>
        typeof x === "string" &&
        [
          ...providerFailureReasons,
          "input_too_large",
          "cancelled_by_researcher",
          "service_restarted",
          "destination_changed",
        ].includes(x),
    ) &&
    (!Object.hasOwn(value, "modelName") || typeof value.modelName === "string") &&
    (!Object.hasOwn(value, "retryNotBeforeAt") ||
      (value.state === "queued" && date(value.retryNotBeforeAt))) &&
    (!Object.hasOwn(value, "providerMessage") ||
      (value.outcomeReason === "request_rejected" &&
        typeof value.providerMessage === "string" &&
        value.providerMessage.length > 0 &&
        utf8Size(value.providerMessage) <= 4096)) &&
    nullable(value.replyMessageId, isResearchId) &&
    (!Object.hasOwn(value, "modelUnavailable") || typeof value.modelUnavailable === "boolean") &&
    integer(value.maxAttemptDurationMs) &&
    integer(value.maxInactivityMs)
  );
}
function isPlanTaskProgress(value: unknown): value is PlanTaskProgress {
  return (
    obj(value) &&
    exact(value, [
      "agentId",
      "state",
      "connection",
      "blockingReason",
      "outcomeReason",
      "replyMessageId",
      "maxAttemptDurationMs",
      "maxInactivityMs",
      ...anthropicNoticeKeys(value),
      ...(Object.hasOwn(value, "modelUnavailable") ? ["modelUnavailable"] : []),
    ]) &&
    isTaskProgress(value)
  );
}
function isPlanSnapshot(value: unknown): value is PlanSnapshot {
  return (
    exact(value, [
      "planId",
      "projectId",
      "conversationId",
      "revision",
      "graphVersion",
      "outcome",
      "throughSequence",
      "needsAttention",
      "state",
      "connections",
      "maxRequests",
      "requestsUsed",
      "purpose",
      "sharedContext",
      "contributions",
      "continuation",
    ]) &&
    isResearchId(value.planId) &&
    isResearchId(value.projectId) &&
    isResearchId(value.conversationId) &&
    integer(value.revision) &&
    integer(value.graphVersion, 0) &&
    (value.state === "accepted" ? value.graphVersion > 0 : value.graphVersion === 0) &&
    (value.outcome === null || planOutcomes.some((outcome) => outcome === value.outcome)) &&
    integer(value.throughSequence, 0) &&
    typeof value.needsAttention === "boolean" &&
    ["proposed", "accepted", "declined", "replaced"].includes(value.state as string) &&
    isPlanConnections(value.connections) &&
    (value.state === "accepted" || Object.keys(value.connections).length === 0) &&
    integer(value.maxRequests) &&
    integer(value.requestsUsed, 0) &&
    value.requestsUsed <= value.maxRequests &&
    isPlanText(value.purpose) &&
    isPlanText(value.sharedContext) &&
    Array.isArray(value.contributions) &&
    value.contributions.length <= 8 &&
    value.contributions.every(
      (node) =>
        exact(node, [
          "id",
          "key",
          "request",
          "reason",
          "failureReason",
          "agentId",
          "required",
          "state",
          "taskId",
          "task",
          "resultMessageId",
          "blockedBy",
          "restartHeld",
          "prerequisites",
        ]) &&
        isResearchId(node.id) &&
        typeof node.key === "string" &&
        /^[a-z0-9-]{1,64}(?![\s\S])/.test(node.key) &&
        isPlanText(node.request) &&
        isPlanText(node.reason) &&
        [null, "destination_changed", "input_changed", "input_too_large"].some(
          (reason) => reason === node.failureReason,
        ) &&
        isReplyAgent(node.agentId) &&
        typeof node.required === "boolean" &&
        planContributionStates.some((state) => state === node.state) &&
        [node.taskId, node.resultMessageId, node.blockedBy].every(
          (id) => id === null || isResearchId(id),
        ) &&
        (node.taskId === null
          ? node.task === null
          : isPlanTaskProgress(node.task) && node.task.agentId === node.agentId) &&
        typeof node.restartHeld === "boolean" &&
        Array.isArray(node.prerequisites) &&
        node.prerequisites.length <= 8 &&
        node.prerequisites.every(isResearchId),
    ) &&
    (value.continuation === null || isContinuationSnapshot(value.continuation))
  );
}
function planKey(value: unknown): boolean {
  return typeof value === "string" && /^[a-z0-9-]{1,64}(?![\s\S])/.test(value);
}
function keys(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 8 && value.every(planKey);
}
function isPlanChangeRow(value: unknown): boolean {
  return (
    exact(value, [
      "key",
      "state",
      "taskState",
      "blockingReason",
      "waitingFor",
      "blockedBy",
      "restartHeld",
      "connection",
    ]) &&
    planKey(value.key) &&
    planContributionStates.some((state) => state === value.state) &&
    (value.taskState === null || planSynthesisStates.some((state) => state === value.taskState)) &&
    (value.blockingReason === null ||
      [
        "connection_disabled",
        "configuration_unavailable",
        "usage_limit_reached",
        "restart_paused",
      ].some((reason) => reason === value.blockingReason)) &&
    keys(value.waitingFor) &&
    nullable(value.blockedBy, planKey) &&
    typeof value.restartHeld === "boolean" &&
    isConnectionId(value.connection)
  );
}
function isPlanChangeRequest(value: unknown): boolean {
  return (
    exact(value, [
      "key",
      "agentId",
      "connection",
      "required",
      "prerequisites",
      "request",
      "reason",
      "changed",
    ]) &&
    planKey(value.key) &&
    isReplyAgent(value.agentId) &&
    isConnectionId(value.connection) &&
    typeof value.required === "boolean" &&
    keys(value.prerequisites) &&
    isPlanText(value.request) &&
    isPlanText(value.reason) &&
    Array.isArray(value.changed) &&
    value.changed.length <= 4 &&
    value.changed.every(
      (field: unknown) =>
        typeof field === "string" &&
        ["request", "reason", "required", "prerequisites"].includes(field),
    )
  );
}
function isPlanChangePreview(value: unknown): boolean {
  return (
    exact(value, [
      "proposalId",
      "removed",
      "replaced",
      "added",
      "unchanged",
      "purpose",
      "context",
      "additionalRequests",
      "remainingRequests",
      "maxRequests",
    ]) &&
    isResearchId(value.proposalId) &&
    Array.isArray(value.removed) &&
    value.removed.every(isPlanChangeRow) &&
    Array.isArray(value.replaced) &&
    value.replaced.every(
      (entry) =>
        exact(entry, ["before", "after"]) &&
        isPlanChangeRow(entry.before) &&
        isPlanChangeRequest(entry.after),
    ) &&
    Array.isArray(value.added) &&
    value.added.every(isPlanChangeRequest) &&
    Array.isArray(value.unchanged) &&
    value.unchanged.every(isPlanChangeRow) &&
    value.removed.length + value.replaced.length + value.unchanged.length <= 16 &&
    value.removed.length + value.replaced.length + value.added.length <= 8 &&
    nullable(value.purpose, isPlanText) &&
    nullable(value.context, isPlanText) &&
    integer(value.additionalRequests, 0) &&
    integer(value.remainingRequests, 0) &&
    integer(value.maxRequests) &&
    value.remainingRequests <= value.maxRequests
  );
}
function isContinuationSnapshot(value: unknown): boolean {
  return (
    exact(value, [
      "id",
      "graphVersion",
      "throughSequence",
      "reason",
      "policyVersion",
      "admission",
      "restartHeld",
      "taskId",
      "taskState",
      "task",
      "stopped",
    ]) &&
    isResearchId(value.id) &&
    integer(value.graphVersion) &&
    integer(value.throughSequence) &&
    (value.reason === "required_set_complete" || value.reason === "finished_partial") &&
    (value.policyVersion === 1 || value.policyVersion === 2 || value.policyVersion === 3) &&
    continuationAdmissions.some((admission) => admission === value.admission) &&
    typeof value.restartHeld === "boolean" &&
    (!value.restartHeld || value.admission === "waiting") &&
    typeof value.stopped === "boolean" &&
    (value.admission === "admitted"
      ? isResearchId(value.taskId) &&
        isPlanTaskProgress(value.task) &&
        value.task.agentId === "virgilio" &&
        value.task.state === value.taskState
      : value.taskId === null && value.taskState === null && value.task === null)
  );
}

function attentionSubject(value: unknown): boolean {
  return exact(value, ["id", "revision"]) && isResearchId(value.id) && integer(value.revision);
}
const memoryVersionKeys = ["number", "kind", "text", "state", "change", "author", "date"];
function memoryAuthor(value: unknown): boolean {
  return value === "researcher" || value === "virgilio";
}
function memoryVersionFields(value: Record<string, unknown>): boolean {
  return (
    integer(value.number) &&
    memoryKinds.includes(value.kind as MemoryKind) &&
    (typeof value.text === "string" || isTextReference(value.text)) &&
    (value.state === "active" || value.state === "withdrawn") &&
    memoryChanges.includes(value.change as MemoryVersion["change"]) &&
    memoryAuthor(value.author) &&
    date(value.date)
  );
}
function isMemoryVersion(value: unknown): boolean {
  return exact(value, memoryVersionKeys) && memoryVersionFields(value);
}
function isMemoryEntry(value: unknown): boolean {
  return (
    exact(value, [...memoryVersionKeys, "id", "originalAuthor", "source"]) &&
    isResearchId(value.id) &&
    memoryVersionFields(value) &&
    memoryAuthor(value.originalAuthor) &&
    nullable(
      value.source,
      (source) =>
        exact(source, ["messageId", "conversationId", "prefix", "truncated"]) &&
        isResearchId(source.messageId) &&
        isResearchId(source.conversationId) &&
        typeof source.prefix === "string" &&
        Array.from(source.prefix).length <= conversationPreviewPrefixLimit &&
        typeof source.truncated === "boolean",
    )
  );
}

export function isResearchEvent(value: unknown): value is ResearchEvent {
  if (!obj(value)) return false;
  if (value.kind === "planChanged")
    return (
      exact(value, ["kind", "planId", "throughSequence", "revision"]) &&
      isResearchId(value.planId) &&
      integer(value.throughSequence, 0) &&
      integer(value.revision)
    );
  if (value.kind === "agentPreferenceChanged")
    return (
      exact(value, [
        "kind",
        "target",
        "revision",
        ...(Object.hasOwn(value, "source") ? ["source"] : []),
      ]) &&
      (!Object.hasOwn(value, "source") || value.source === "replace") &&
      agentPreferenceTargets.some((target) => value.target === target) &&
      integer(value.revision)
    );
  if (value.kind === "providerModelsChanged")
    return (
      exact(value, ["kind", "connection", "list_revision"]) &&
      isConnectionId(value.connection) &&
      integer(value.list_revision)
    );
  if (value.kind === "destinationChanged")
    return exact(value, ["kind", "connection"]) && isConnectionId(value.connection);
  if (value.kind === "attentionRaised") {
    if (value.source !== "conversation" && value.source !== "plan") return false;
    const hasTask = Object.hasOwn(value, "task");
    const hasPlan = Object.hasOwn(value, "plan");
    return (
      exact(value, [
        "kind",
        "source",
        ...(hasTask ? ["task"] : []),
        ...(hasPlan ? ["plan"] : []),
      ]) &&
      (!hasTask || attentionSubject(value.task)) &&
      (!hasPlan || attentionSubject(value.plan))
    );
  }
  if (value.kind === "replyFinished")
    return (
      exact(value, ["kind", "projectId", "conversationId", "agentId"]) &&
      isResearchId(value.projectId) &&
      isResearchId(value.conversationId) &&
      isReplyAgent(value.agentId)
    );
  if (value.kind === "pauseCounts" || value.kind === "projectAttention")
    return exact(value, ["kind", "revision"]) && integer(value.revision);
  if (value.kind === "inferenceActivity") return exact(value, ["kind"]);
  if (value.kind === "reply")
    return (
      exact(value, ["kind", "taskId", "sequence", "text"]) &&
      isResearchId(value.taskId) &&
      integer(value.sequence) &&
      typeof value.text === "string"
    );
  return (
    exact(value, ["kind", "record", "id", "revision"]) &&
    value.kind === "changed" &&
    typeof value.record === "string" &&
    [
      "project",
      "projectTitle",
      "conversation",
      "timeline",
      "usagePause",
      "executionLimits",
      "memory",
    ].includes(value.record) &&
    (isResearchId(value.id) || (value.record === "executionLimits" && opaque(value.id))) &&
    integer(value.revision)
  );
}

/** Cross-check successful research responses against the admitted request, after schema validation. */
export function researchResultMatches(
  operation: ResearchOperation,
  input: unknown,
  output: unknown,
): boolean {
  if (!obj(input) || !obj(output)) return false;
  if (operation === "plan.finish" || operation === "plan.cancel")
    return output.resultId === input.planId;
  if (operation === "plan.read") return output.planId === input.planId;
  if (operation === "planChange.read") return output.proposalId === input.proposalId;
  if (operation === "planEvent.list") {
    const events = output.events as readonly PlanEvent[];
    return (
      output.planId === input.planId &&
      events.every(
        (event, index) =>
          event.sequence > (input.afterSequence as number) &&
          event.sequence <= (output.throughSequence as number) &&
          event.sequence > (events[index - 1]?.sequence ?? 0),
      )
    );
  }
  if (
    operation === "handoff.accept" ||
    operation === "handoff.decline" ||
    operation === "planChange.apply" ||
    operation === "planChange.decline"
  )
    return output.resultId === input.proposalId;
  if (operation === "memory.list") {
    const entries = output.entries as readonly MemoryEntry[];
    const ids = entries.map(({ id }) => id);
    return (
      output.projectId === input.projectId &&
      !ids.includes(input.after as string) &&
      new Set(ids).size === ids.length &&
      (output.next === null || output.next === ids.at(-1))
    );
  }
  if (operation === "memory.history") {
    const versions = output.versions as readonly MemoryVersion[];
    return (
      output.entryId === input.entryId &&
      versions.every(
        ({ number }, index) =>
          number < (versions[index - 1]?.number ?? (input.before as number | null) ?? Infinity),
      ) &&
      (output.next === null || output.next === versions.at(-1)?.number)
    );
  }
  if (operation === "memory.edit" || operation === "memory.withdraw")
    return output.resultId === input.entryId;
  if (operation === "memory.undo") return output.resultId === input.taskId;
  if (operation === "handoff.selection") {
    const messages = output.messages as readonly HandoffSelectionMessage[];
    return (
      (output.next === null || output.next === messages.at(-1)?.position) &&
      messages.every(
        ({ position }, index) =>
          position > (messages[index - 1]?.position ?? (input.after as number)),
      )
    );
  }
  if (operation === "project.read") return output.id === input.projectId;
  if (operation === "project.rename") {
    const { title, titleRevision } = (output as unknown as RenameProjectResult).titleChange;
    return (
      output.resultId === input.projectId &&
      title === input.title &&
      (titleRevision === input.expectedTitleRevision ||
        titleRevision === Number(input.expectedTitleRevision) + 1)
    );
  }
  if (operation === "project.open") return output.resultId === input.projectId;
  if (operation === "conversation.start") return isResearchId(output.resultId);
  if (operation === "conversation.rename") return output.resultId === input.conversationId;
  if (operation === "projectAttention.list") {
    const items = output.items as readonly string[];
    const cursor = input.cursor as string | null;
    return (
      items.length <= (input.count as number) &&
      (!output.hasMore || (items.length > 0 && output.next === items.at(-1))) &&
      items.every((id, index) => id > (items[index - 1] ?? cursor ?? ""))
    );
  }
  if (operation === "project.list") {
    const items = output.items as readonly ProjectRecord[];
    const compare = (a: ProjectCursor, b: ProjectCursor) =>
      (a.lastOpenedAt < b.lastOpenedAt ? -1 : a.lastOpenedAt > b.lastOpenedAt ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const last = items.at(-1);
    if (
      items.length > (input.count as number) ||
      (output.hasMore && (!last || compare(last, output.next as ProjectCursor) !== 0))
    )
      return false;
    return items.every(
      (item, index) =>
        (!input.cursor || compare(item, input.cursor as ProjectCursor) < 0) &&
        (index === 0 || compare(items[index - 1] ?? item, item) > 0),
    );
  }
  if (operation === "conversation.read" || operation === "timeline.read") {
    const requested = input.ids as readonly string[];
    const items = output.items as readonly { readonly id: string; readonly projectId?: string }[];
    const remaining = output.remaining as readonly string[];
    return (
      items.length <= requested.length &&
      items.every(
        (item, index) =>
          item.id === requested[index] &&
          (operation !== "conversation.read" || item.projectId === input.projectId),
      ) &&
      remaining.length === requested.length - items.length &&
      remaining.every((id, index) => id === requested[items.length + index]) &&
      (requested.length === 0 || items.length > 0)
    );
  }
  if (operation === "conversation.list") {
    const items = output.items as readonly ConversationSummary[];
    const last = items.at(-1);
    if (
      items.length > (input.count as number) ||
      (output.hasMore &&
        (!last || compareConversations(last, output.next as ConversationCursor) !== 0))
    )
      return false;
    return (
      items.every(
        (item, index) =>
          item.projectId === input.projectId &&
          (!input.cursor || compareConversations(item, input.cursor as ConversationCursor) < 0) &&
          (index === 0 || compareConversations(items[index - 1] ?? item, item) > 0),
      ) && new Set(items.map((item) => item.id)).size === items.length
    );
  }
  if (operation === "timeline.listBefore") {
    const items = output.items as readonly TimelineCursor[];
    const last = items.at(-1);
    if (
      items.length > (input.count as number) ||
      (output.hasMore && (!last || compareTimeline(last, output.next as TimelineCursor) !== 0))
    )
      return false;
    return items.every(
      (item, index) =>
        (!input.cursor || compareTimeline(item, input.cursor as TimelineCursor) < 0) &&
        (index === 0 || compareTimeline(items[index - 1] ?? item, item) > 0),
    );
  }
  if (operation === "reply.readParts") {
    const parts = output.parts as readonly ReplyPart[];
    return (
      parts.every((part, index) => part.sequence === (input.fromSequence as number) + index) &&
      ((input.fromSequence as number) > (output.latestSequence as number) || parts.length > 0)
    );
  }
  return true;
}
