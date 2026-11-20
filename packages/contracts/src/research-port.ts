import type {
  ConversationRecord,
  FinishPlanResult,
  ProjectRecord,
  ResearchPayloads,
  ResearchResult,
} from "./research.js";
import {
  handoffInvalidReasons,
  type HandoffInvalidReason,
  planOutcomes,
  planInvalidReasons,
  type PlanInvalidReason,
  type PlanOutcome,
} from "./research.js";
import { isConnectionId } from "./connections.js";
import { utf8Size, type PortCall, type Subscription, type Outcome } from "./port.js";

export const researchOperations = [
  "handoff.accept",
  "handoff.decline",
  "handoff.return",
  "handoff.selection",
  "project.create",
  "project.open",
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
  "conversation.list",
  "conversation.read",
  "timeline.listBefore",
  "timeline.read",
  "research.subscribe",
  "text.part",
  "text.readPart",
  "reply.readParts",
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
  | { readonly state: "failed" | "blocked" | "cancelled" | "uncertain"; readonly messageId: null }
);

export interface TimelineMessage extends TimelineIdentity {
  readonly kind: "message";
  readonly rank: 1;
  readonly consultation?: true;
  readonly synthesisSources?: readonly SynthesisSource[];
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
export type TimelineItem =
  | TimelineMessage
  | TimelineTask
  | TimelineSetupProposal
  | TimelineConsultation
  | TimelinePlan
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
    readonly policyVersion: 1;
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
  | { readonly kind: "destinationChanged"; readonly connection: string }
  | { readonly kind: "pauseCounts"; readonly revision: number }
  | {
      readonly kind: "changed";
      readonly record: "project" | "conversation" | "timeline" | "usagePause" | "executionLimits";
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
  readonly operation: string;
  readonly maxAttemptDurationMs: number;
  readonly connection: string;
}
export const researcherMessageLimit = 20_000;
export function validResearcherMessage(text: string): boolean {
  return text.trim().length > 0 && Array.from(text).length <= researcherMessageLimit;
}
export interface ResearchInputs {
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
  "project.confirmSetup": ResearchPayloads["project.confirmSetup"];
  "project.rejectSetup": ResearchPayloads["project.rejectSetup"];
  "conversation.start": Omit<ResearchPayloads["conversation.start"], "content"> & {
    readonly content: string | TextDescriptor;
  };
  "conversation.rename": ResearchPayloads["conversation.rename"];
  "message.append": { readonly conversationId: string; readonly content: string | TextDescriptor };
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
  "reply.readParts": { readonly taskId: string; readonly fromSequence: number };
}
export interface ResearchOutputs {
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
  "project.confirmSetup": ResearchResult;
  "project.rejectSetup": ResearchResult;
  "conversation.start": ResearchResult;
  "conversation.rename": ResearchResult;
  "message.append": ResearchResult;
  "project.list": ListPage<ProjectRecord, ProjectCursor>;
  "conversation.list": ListPage<ConversationSummary, ConversationCursor>;
  "conversation.read": IdPage<ConversationSummary>;
  "timeline.listBefore": ListPage<TimelineItem, TimelineCursor>;
  "timeline.read": IdPage<TimelineItem>;
  "research.subscribe": { readonly subscriptionId: string };
  "text.part": { readonly accepted: true };
  "text.readPart": { readonly text: string };
  "reply.readParts": ReplyParts;
}
export interface ResearchPort {
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
  stopTask(operationId: string, input: ResearchInputs["task.stop"]): PortCall<ResearchResult>;
  readDestination(
    input: ResearchInputs["destination.read"],
  ): PortCall<ResearchOutputs["destination.read"]>;
  createProject(operationId: string): PortCall<ResearchResult>;
  openProject(operationId: string, input: ResearchInputs["project.open"]): PortCall<ResearchResult>;
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
    "handoff.accept",
    "handoff.decline",
    "handoff.return",
    "project.create",
    "project.open",
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
      ((previous.state === "queued" && item.state === "queued") ||
        item.consultationRetryFits !== previous.consultationRetryFits)
    )
      items.set(item.id, {
        ...previous,
        waitingForModels: item.waitingForModels,
        waitingLimit: item.waitingLimit,
        ...(item.consultationRetryFits === undefined
          ? {}
          : { consultationRetryFits: item.consultationRetryFits }),
      });
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
    case "conversation.stop":
      return exact(value, ["conversationId"]) && isResearchId(value.conversationId);
    case "task.continueAll":
    case "pause.read":
      return exact(value, []);
    case "usagePause.resume":
      return exact(value, ["connection"]) && value.connection === "chatgpt";
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
      return exact(value, ["projectId"]) && isResearchId(value.projectId);
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
function project(value: unknown): boolean {
  return (
    exact(value, [
      "id",
      "projectType",
      "title",
      "documentLanguage",
      "isDevelopment",
      "setupConfirmedAt",
      "lastOpenedAt",
      "createdAt",
      "updatedAt",
    ]) &&
    isResearchId(value.id) &&
    value.projectType === "thesis" &&
    nullable(value.title, (x) => typeof x === "string") &&
    nullable(value.documentLanguage, (x) => typeof x === "string") &&
    typeof value.isDevelopment === "boolean" &&
    nullable(value.setupConfirmedAt, date) &&
    date(value.lastOpenedAt) &&
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
          isSynthesisSources(value.synthesisSources))) &&
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
    typeof value.waitingForModels === "boolean" &&
    nullable(value.waitingLimit, integer) &&
    typeof value.dispatched === "boolean" &&
    typeof value.superseded === "boolean" &&
    value.kind === "task" &&
    value.rank === 3
  );
}
function isSynthesisSources(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every(
      (source: unknown) =>
        exact(source, ["key", "agentId", "state", "messageId"]) &&
        typeof source.key === "string" &&
        /^[a-z0-9-]{1,64}(?![\s\S])/.test(source.key) &&
        isReplyAgent(source.agentId) &&
        (source.state === "completed"
          ? isResearchId(source.messageId)
          : ["failed", "blocked", "cancelled", "uncertain"].some(
              (state) => state === source.state,
            ) && source.messageId === null),
    ) &&
    new Set(value.map((source: SynthesisSource) => source.key)).size === value.length
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
          exact(d, ["operation", "maxAttemptDurationMs", "connection"]) &&
          opaque(d.operation) &&
          integer(d.maxAttemptDurationMs) &&
          isConnectionId(d.connection),
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
  if (operation === "plan.read") return isPlanSnapshot(value);
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
  if (isResearchMutation(operation))
    return exact(value, ["resultId"]) && isResearchId(value.resultId);
  if (operation === "research.subscribe")
    return exact(value, ["subscriptionId"]) && opaque(value.subscriptionId);
  if (operation === "text.part") return exact(value, ["accepted"]) && value.accepted === true;
  if (operation === "text.readPart")
    return exact(value, ["text"]) && typeof value.text === "string";
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
  const valid =
    operation === "project.list"
      ? project
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
          "usage_limit_reached",
          "not_eligible",
          "connection_expired",
          "provider_unavailable",
          "request_rejected",
          "provider_error",
          "invalid_output",
          "output_limit_exceeded",
          "connection_lost",
          "empty_reply",
          "input_too_large",
          "permit_expired",
          "inactivity_timeout",
          "deadline_exceeded",
          "cancelled_by_researcher",
          "service_restarted",
        ].includes(x),
    ) &&
    nullable(value.replyMessageId, isResearchId) &&
    integer(value.maxAttemptDurationMs) &&
    integer(value.maxInactivityMs)
  );
}
function isPlanTaskProgress(value: unknown): value is PlanTaskProgress {
  return (
    exact(value, [
      "agentId",
      "state",
      "connection",
      "blockingReason",
      "outcomeReason",
      "replyMessageId",
      "maxAttemptDurationMs",
      "maxInactivityMs",
    ]) && isTaskProgress(value)
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
    value.policyVersion === 1 &&
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

export function isResearchEvent(value: unknown): value is ResearchEvent {
  if (!obj(value)) return false;
  if (value.kind === "planChanged")
    return (
      exact(value, ["kind", "planId", "throughSequence", "revision"]) &&
      isResearchId(value.planId) &&
      integer(value.throughSequence, 0) &&
      integer(value.revision)
    );
  if (value.kind === "destinationChanged")
    return exact(value, ["kind", "connection"]) && isConnectionId(value.connection);
  if (value.kind === "pauseCounts")
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
    ["project", "conversation", "timeline", "usagePause", "executionLimits"].includes(
      value.record,
    ) &&
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
  if (operation === "handoff.accept" || operation === "handoff.decline")
    return output.resultId === input.proposalId;
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
  if (operation === "project.open") return output.resultId === input.projectId;
  if (operation === "conversation.start") return isResearchId(output.resultId);
  if (operation === "conversation.rename") return output.resultId === input.conversationId;
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
