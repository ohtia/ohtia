import {
  canonicalJson,
  failure,
  isStageDecision,
  isStageTransition,
  stageAction,
  staleRevision,
  type Outcome,
  type ResearchInputs,
  type ResearchStageId,
  type ResearchStageState,
  type StageArtifactVersion,
  type StageDecision,
  type StageReference,
  type StageSnapshot,
  type StageTransitionPayload,
  type StageTransitionResult,
  type StageReceiptResult,
} from "@ohtia/contracts";
import type { Kysely } from "kysely";
import { bytes, identifier, newId, type ResearchSchema } from "./research.js";
import { digest } from "./research-text.js";
import {
  confirmedThesis,
  currentProfileIdentity,
  messageArtifactExists,
} from "./thesis-profile.js";

export interface StageDecisionRow {
  id: Uint8Array;
  project_id: Uint8Array;
  stage: ResearchStageId;
  revision: number;
  project_order: number;
  kind: StageDecision["kind"];
  preceding_state: ResearchStageState;
  previous_decision_id: Uint8Array | null;
  profile_revision_id: Uint8Array | null;
  operation_id: string;
  actor: "researcher";
  observed_at: string;
  reason: string;
  remaining_conditions: string;
  next_review_condition: string | null;
}

export interface ResearchStageSchema {
  research_stage_decisions: StageDecisionRow;
  research_stage_artifacts: {
    decision_id: Uint8Array;
    position: number;
    message_id: Uint8Array;
  };
}

type Database = Kysely<ResearchSchema>;

export function stageTransitionPayload(
  input: ResearchInputs["stage.transition"],
): StageTransitionPayload {
  const { projectId, stageId, expectedRevision, decision } = input;
  return { projectId, stageId, expectedRevision, decision };
}

export function stageTransitionHash(payload: StageTransitionPayload): string {
  return digest(canonicalJson(payload));
}

function stageDecisions(db: Database, project: Uint8Array, stage: ResearchStageId) {
  return db
    .selectFrom("research_stage_decisions")
    .where("project_id", "=", project)
    .where("stage", "=", stage);
}

function latestDecision(db: Database, project: Uint8Array, stage: ResearchStageId) {
  return stageDecisions(db, project, stage)
    .selectAll()
    .orderBy("revision", "desc")
    .executeTakeFirst();
}

function reference(row: Pick<StageDecisionRow, "id" | "stage" | "revision">): StageReference {
  return { stageId: row.stage, decisionId: identifier(row.id), revision: row.revision };
}

function stateOf(row: StageDecisionRow | undefined): ResearchStageState {
  return row ? (row.kind === "complete" ? "done" : "in-progress") : "not-started";
}

export async function stageProjectOrder(db: Database, project: Uint8Array): Promise<number> {
  const row = await db
    .selectFrom("research_stage_decisions")
    .select("project_order")
    .where("project_id", "=", project)
    .orderBy("project_order", "desc")
    .executeTakeFirst();
  return row?.project_order ?? 0;
}

async function artifactVersions(
  db: Database,
  decisionId: Uint8Array,
): Promise<StageArtifactVersion[]> {
  const artifacts = await db
    .selectFrom("research_stage_artifacts")
    .select("message_id")
    .where("decision_id", "=", decisionId)
    .orderBy("position")
    .execute();
  return artifacts.map(({ message_id }) => ({
    artifact: "conversation_message",
    id: identifier(message_id),
    revision: 1,
  }));
}

async function decision(db: Database, row: StageDecisionRow): Promise<StageDecision> {
  const reviewed =
    row.kind === "reopen" && row.previous_decision_id
      ? await db
          .selectFrom("research_stage_decisions")
          .select(["id", "profile_revision_id"])
          .where("id", "=", row.previous_decision_id)
          .executeTakeFirstOrThrow()
      : undefined;
  const value = {
    ...reference(row),
    projectId: identifier(row.project_id),
    operationId: row.operation_id,
    expectedRevision: row.revision - 1,
    observedAt: row.observed_at,
    actor: row.actor,
    profileRevisionId: row.profile_revision_id && identifier(row.profile_revision_id),
    reason: row.reason,
    artifacts: await artifactVersions(db, row.id),
    remainingConditions: JSON.parse(row.remaining_conditions) as unknown,
    kind: row.kind,
    precedingState: row.preceding_state,
    state: stateOf(row),
    ...(reviewed && {
      reviewedDecisionId: identifier(reviewed.id),
      affectedProfileRevisionId:
        reviewed.profile_revision_id && identifier(reviewed.profile_revision_id),
      affectedOutputs: await artifactVersions(db, reviewed.id),
      nextReviewCondition: row.next_review_condition,
    }),
  };
  if (!isStageDecision(value)) throw new Error("Invalid stored research stage decision.");
  return value;
}

export async function applyStageTransition(
  db: Database,
  input: StageTransitionPayload,
  operationId: string,
  observedAt: string,
): Promise<Outcome<Buffer>> {
  if (!isStageTransition(input)) return failure("invalid_message");
  const { stageId, expectedRevision } = input;
  const { profileRevisionId, transition, artifacts, reason, remainingConditions } = input.decision;
  const thesis = await confirmedThesis(db, input.projectId);
  if (!thesis.ok) return thesis;
  const project = thesis.value;
  const prior = await latestDecision(db, project, stageId);
  const revision = prior?.revision ?? 0;
  if (expectedRevision !== revision) return staleRevision(revision);
  const precedingState = stateOf(prior);
  const availability = stageAction(
    stageId,
    precedingState,
    transition.kind === "enter" ? "not-started" : "done",
  );
  if (availability === "workflow_unavailable") return failure("stage_unavailable");
  if (availability === "wrong_state") return failure("stage_state_changed");

  const priorId = prior?.id ?? null;
  if (transition.kind === "reopen") {
    if (!prior || identifier(prior.id) !== transition.reviewedDecisionId)
      return failure("input_changed");
    await decision(db, prior);
  }
  if (profileRevisionId !== (await currentProfileIdentity(db, project)))
    return failure("input_changed");
  for (const artifact of artifacts) {
    if (!(await messageArtifactExists(db, project, artifact.id)))
      return failure("record_not_found");
  }
  const order = await stageProjectOrder(db, project);
  if (order >= Number.MAX_SAFE_INTEGER) return failure("limit_reached");
  const id = newId();
  await db
    .insertInto("research_stage_decisions")
    .values({
      id,
      project_id: project,
      stage: stageId,
      revision: revision + 1,
      project_order: order + 1,
      kind: transition.kind,
      preceding_state: precedingState,
      previous_decision_id: priorId,
      profile_revision_id: profileRevisionId === null ? null : bytes(profileRevisionId),
      operation_id: operationId,
      actor: "researcher",
      observed_at: observedAt,
      reason,
      remaining_conditions: canonicalJson(remainingConditions),
      next_review_condition: transition.kind === "reopen" ? transition.nextReviewCondition : null,
    })
    .execute();
  if (artifacts.length) {
    await db
      .insertInto("research_stage_artifacts")
      .values(
        artifacts.map((artifact, index) => ({
          decision_id: id,
          position: index + 1,
          message_id: bytes(artifact.id),
        })),
      )
      .execute();
  }
  return { ok: true, value: id };
}

export async function readStage(
  db: Database,
  input: ResearchInputs["stage.read"],
): Promise<Outcome<StageSnapshot>> {
  const { projectId, stageId } = input;
  const thesis = await confirmedThesis(db, projectId);
  if (!thesis.ok) return thesis;
  const project = thesis.value;
  const current = await latestDecision(db, project, stageId);
  const latest = await db
    .selectFrom("research_stage_decisions")
    .select(["id", "stage", "revision"])
    .where("project_id", "=", project)
    .where("kind", "in", ["enter", "reopen"])
    .orderBy("project_order", "desc")
    .executeTakeFirst();
  const state = stateOf(current);
  return {
    ok: true,
    value: {
      projectId,
      stageId,
      state,
      revision: current?.revision ?? 0,
      decisionId: current ? identifier(current.id) : null,
      profileRevisionId: await currentProfileIdentity(db, project),
      enter: stageAction(stageId, state, "not-started"),
      reopen: stageAction(stageId, state, "done"),
      latestEntry: latest ? reference(latest) : null,
    },
  };
}

export async function readStageHistory(
  db: Database,
  input: ResearchInputs["stage.history"],
): Promise<Outcome<StageDecision>> {
  const thesis = await confirmedThesis(db, input.projectId);
  if (!thesis.ok) return thesis;
  const row = await stageDecisions(db, thesis.value, input.stageId)
    .selectAll()
    .where("revision", "=", input.revision)
    .executeTakeFirst();
  return row ? { ok: true, value: await decision(db, row) } : failure("record_not_found");
}

export async function stageReceiptResult(
  db: Database,
  operationId: string,
  id: Uint8Array,
): Promise<StageTransitionResult> {
  const row = await db
    .selectFrom("research_stage_decisions")
    .selectAll()
    .where("id", "=", id)
    .where("operation_id", "=", operationId)
    .executeTakeFirstOrThrow();
  const stageDecision = await decision(db, row);
  if (stageDecision.kind === "complete") throw new Error("Invalid transition receipt.");
  return { resultId: stageDecision.decisionId, stageDecision };
}

export async function readStageReceipt(
  db: Database,
  input: ResearchInputs["stage.receipt"],
): Promise<Outcome<StageReceiptResult>> {
  const { projectId, stageId, operationId } = input;
  const thesis = await confirmedThesis(db, projectId);
  if (!thesis.ok) return thesis;
  const row = await db
    .selectFrom("command_receipts")
    .selectAll()
    .where("operation_id", "=", operationId)
    .executeTakeFirst();
  if (!row) return { ok: true, value: { projectId, stageId, operationId, receipt: null } };
  if (
    row.command !== "stage.transition" ||
    Buffer.from(row.payload_sha256).toString("hex") !==
      stageTransitionHash(stageTransitionPayload(input))
  )
    return failure("operation_conflict");
  const receipt = await stageReceiptResult(db, operationId, row.result_id);
  if (receipt.stageDecision.projectId !== projectId || receipt.stageDecision.stageId !== stageId)
    return failure("operation_conflict");
  return { ok: true, value: { projectId, stageId, operationId, receipt } };
}
