import { isIdentifier, utf8Size } from "./port.js";
import { isDiagnosticTime } from "./diagnostics.js";
import { isUnicodeText } from "./canonical-json.js";
import { isResearchId } from "./research-port.js";

export const researchStages = [
  "onboarding",
  "topic_problem",
  "literature",
  "methodology",
  "investigate",
  "describe",
  "interpret",
] as const;

export type ResearchStageId = (typeof researchStages)[number];
export type ResearchStageState = "not-started" | "in-progress" | "done";
export type StageActionAvailability = "available" | "workflow_unavailable" | "wrong_state";

export interface StageArtifactVersion {
  readonly artifact: "conversation_message";
  readonly id: string;
  readonly revision: 1;
}

export interface StageReference {
  readonly stageId: ResearchStageId;
  readonly decisionId: string;
  readonly revision: number;
}

export interface StageSnapshot {
  readonly projectId: string;
  readonly stageId: ResearchStageId;
  readonly state: ResearchStageState;
  readonly revision: number;
  readonly decisionId: string | null;
  readonly profileRevisionId: string | null;
  readonly enter: StageActionAvailability;
  readonly reopen: StageActionAvailability;
  readonly latestEntry: StageReference | null;
}

export type StageTransition =
  | { readonly kind: "enter" }
  | {
      readonly kind: "reopen";
      readonly reviewedDecisionId: string;
      readonly nextReviewCondition: string;
    };

export interface StageTransitionPayload {
  readonly projectId: string;
  readonly stageId: ResearchStageId;
  readonly expectedRevision: number;
  readonly decision: StageTransitionDetails;
}

export interface StageTransitionDetails {
  readonly profileRevisionId: string | null;
  readonly reason: string;
  readonly artifacts: readonly StageArtifactVersion[];
  readonly remainingConditions: readonly string[];
  readonly transition: StageTransition;
}

export type StageDecision = StageReference & {
  readonly projectId: string;
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly observedAt: string;
  readonly actor: "researcher";
  readonly profileRevisionId: string | null;
  readonly reason: string;
  readonly artifacts: readonly StageArtifactVersion[];
  readonly remainingConditions: readonly string[];
} & (
    | {
        readonly kind: "enter";
        readonly precedingState: "not-started";
        readonly state: "in-progress";
      }
    | { readonly kind: "complete"; readonly precedingState: "in-progress"; readonly state: "done" }
    | {
        readonly kind: "reopen";
        readonly precedingState: "done";
        readonly state: "in-progress";
        readonly reviewedDecisionId: string;
        readonly affectedProfileRevisionId: string | null;
        readonly affectedOutputs: readonly StageArtifactVersion[];
        readonly nextReviewCondition: string;
      }
  );

export interface StageTransitionResult {
  readonly resultId: string;
  readonly stageDecision: Extract<StageDecision, { kind: "enter" | "reopen" }>;
}

export interface StageReceiptResult {
  readonly projectId: string;
  readonly stageId: ResearchStageId;
  readonly operationId: string;
  readonly receipt: StageTransitionResult | null;
}

function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function number(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function text(value: unknown, max: number): boolean {
  return (
    isUnicodeText(value) &&
    value.trim().length > 0 &&
    !value.includes("\0") &&
    utf8Size(value) <= max
  );
}

function optionalId(value: unknown): boolean {
  return value === null || isResearchId(value);
}

export function isResearchStage(value: unknown): value is ResearchStageId {
  return researchStages.some((stage) => stage === value);
}

function artifacts(value: unknown): value is readonly StageArtifactVersion[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every(
      (item) =>
        shape(item, ["artifact", "id", "revision"]) &&
        item.artifact === "conversation_message" &&
        isResearchId(item.id) &&
        item.revision === 1,
    ) &&
    new Set(value.map((item: StageArtifactVersion) => item.id)).size === value.length
  );
}

function conditions(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 8 && value.every((item) => text(item, 256));
}

function reopenFields(value: Record<string, unknown>): boolean {
  return isResearchId(value.reviewedDecisionId) && text(value.nextReviewCondition, 512);
}

function transition(value: unknown): value is StageTransition {
  return (
    (shape(value, ["kind"]) && value.kind === "enter") ||
    (shape(value, ["kind", "reviewedDecisionId", "nextReviewCondition"]) &&
      value.kind === "reopen" &&
      reopenFields(value))
  );
}

const payloadKeys = ["projectId", "stageId", "expectedRevision", "decision"] as const;

export function isStageTransition(
  value: unknown,
  extraKeys: readonly string[] = [],
): value is StageTransitionPayload {
  return (
    shape(value, [...payloadKeys, ...extraKeys]) &&
    isResearchId(value.projectId) &&
    isResearchStage(value.stageId) &&
    number(value.expectedRevision, 0) &&
    shape(value.decision, [
      "profileRevisionId",
      "reason",
      "artifacts",
      "remainingConditions",
      "transition",
    ]) &&
    optionalId(value.decision.profileRevisionId) &&
    text(value.decision.reason, 1024) &&
    artifacts(value.decision.artifacts) &&
    conditions(value.decision.remainingConditions) &&
    transition(value.decision.transition)
  );
}

function reference(value: Record<string, unknown>): boolean {
  return (
    isResearchStage(value.stageId) && isResearchId(value.decisionId) && number(value.revision, 1)
  );
}

export function stageAction(
  stageId: ResearchStageId,
  state: ResearchStageState,
  required: ResearchStageState,
): StageActionAvailability {
  if (stageId !== "onboarding") return "workflow_unavailable";
  return state === required ? "available" : "wrong_state";
}

export function isStageSnapshot(value: unknown): value is StageSnapshot {
  return (
    shape(value, [
      "projectId",
      "stageId",
      "state",
      "revision",
      "decisionId",
      "profileRevisionId",
      "enter",
      "reopen",
      "latestEntry",
    ]) &&
    isResearchId(value.projectId) &&
    isResearchStage(value.stageId) &&
    (value.state === "not-started" || value.state === "in-progress" || value.state === "done") &&
    (value.state === "not-started"
      ? value.revision === 0 && value.decisionId === null
      : reference(value)) &&
    optionalId(value.profileRevisionId) &&
    value.enter === stageAction(value.stageId, value.state, "not-started") &&
    value.reopen === stageAction(value.stageId, value.state, "done") &&
    (value.latestEntry === null ||
      (shape(value.latestEntry, ["stageId", "decisionId", "revision"]) &&
        reference(value.latestEntry)))
  );
}

export function isStageDecision(value: unknown): value is StageDecision {
  const keys = [
    "stageId",
    "decisionId",
    "revision",
    "projectId",
    "operationId",
    "expectedRevision",
    "observedAt",
    "actor",
    "profileRevisionId",
    "reason",
    "artifacts",
    "remainingConditions",
    "kind",
    "precedingState",
    "state",
  ];
  return (
    (shape(value, keys) ||
      shape(value, [
        ...keys,
        "reviewedDecisionId",
        "affectedProfileRevisionId",
        "affectedOutputs",
        "nextReviewCondition",
      ])) &&
    reference(value) &&
    isResearchId(value.projectId) &&
    isIdentifier(value.operationId) &&
    number(value.expectedRevision, 0) &&
    value.revision === value.expectedRevision + 1 &&
    isDiagnosticTime(value.observedAt) &&
    value.actor === "researcher" &&
    optionalId(value.profileRevisionId) &&
    text(value.reason, 1024) &&
    artifacts(value.artifacts) &&
    conditions(value.remainingConditions) &&
    (value.kind === "reopen"
      ? value.precedingState === "done" &&
        value.state === "in-progress" &&
        value.revision >= 3 &&
        reopenFields(value) &&
        optionalId(value.affectedProfileRevisionId) &&
        artifacts(value.affectedOutputs)
      : !Object.hasOwn(value, "reviewedDecisionId") &&
        (value.kind === "enter"
          ? value.precedingState === "not-started" &&
            value.state === "in-progress" &&
            value.revision === 1
          : value.kind === "complete" &&
            value.precedingState === "in-progress" &&
            value.state === "done" &&
            value.revision >= 2))
  );
}

export function isStageTransitionResult(value: unknown): value is StageTransitionResult {
  return (
    shape(value, ["resultId", "stageDecision"]) &&
    isStageDecision(value.stageDecision) &&
    value.stageDecision.kind !== "complete" &&
    value.resultId === value.stageDecision.decisionId
  );
}
