import {
  consultableAgents,
  consultationTool,
  consultationNote,
  consultationInput,
  decodeConsultationProposal,
  otherAgentInput,
} from "./consultations.js";
import {
  addContributions,
  contributionKey,
  holdingDependencies,
  planContributions,
  planInput,
  readyInputs,
  topologicalOrder,
  waitingForPlanWork,
} from "./contribution-graphs.js";
import {
  acceptedPlan,
  acceptedPlans,
  appendPlanEvent,
  createContinuation,
  hasEventRoom,
  planContinuation,
  legacySynthesisInput,
  synthesisInput,
} from "./plan-coordination.js";
import {
  planInvalidReason,
  planProposalNote,
  planStatusNote,
  planTool,
  readPlanProposal,
  unfinishedPlan,
  unfinishedPlans,
} from "./plan-proposals.js";
import {
  handoffBoundary,
  handoffBusy,
  handoffContext,
  handoffProposalNote,
  handoffTool,
  readHandoffProposal,
  replaceHandoff,
  saveHandoffProposal,
} from "./handoffs.js";
import type { PlanEventKind, PlanEventPayload } from "@ohtia/contracts";
import type { ContributionRow, InterventionRow } from "./consultations.js";
import {
  authorizeWork,
  authorizedOperation,
  bindWork,
  bindSynthesisWork,
  consultationLimits,
  interventionLimits,
  releasePendingWork,
  releaseTaskWork,
  releaseUnboundContributionWork,
  reserveWork,
  settleWork,
  workFits,
} from "./work-limits.js";
import { renderProjectInstructions } from "./thesis-route.js";
import {
  acceptedSetupCalls,
  setupInvalidReason,
  setupNote,
  setupRevision,
  setupTool,
  setupTextProjection,
} from "./project-setup.js";
import type { ProviderToolCall } from "@ohtia/contracts";
import type { LanguageRegistry } from "./research.js";
import { randomUUID } from "node:crypto";
import { type Generated, type Kysely, type Selectable, sql } from "kysely";
import {
  type Outcome,
  type ConversationAgent,
  type ReplyAgent,
  type ProviderDispatchMessage,
  type ProviderEvent,
  type ProviderResult,
  type ProviderUsage,
  type ProviderWorkUsage,
  type TransferEntry,
  type ServiceConnections,
  failure,
  invalidPlan,
  connectionInferenceLimits,
  isProviderModelSlug,
  type DiagnosticEvent,
  providerMessageVersion,
  conversationTitlePolicy,
  conversationTitleInstructionSuffix,
  validConversationTitle,
  type ProviderTool,
  utf8Size,
} from "@ohtia/contracts";
import { bytes, identifier, newId, type ResearchSchema } from "./research.js";
import {
  buildInput,
  operationPolicy,
  recordedOperationPolicy,
  replyAgent,
  testSynthesisPolicy,
  contributionSynthesisPolicy,
  type OperationPolicy,
  type InputMessage,
} from "./operations.js";
const conversationTitleTool: ProviderTool = {
  namespace: conversationTitlePolicy.namespace,
  name: conversationTitlePolicy.name,
  description: "Return the title of the current conversation alongside the ordinary reply.",
  strict: true,
  parameters: {
    type: "object",
    properties: { title: { type: "string", description: "A concise conversation title." } },
    required: ["title"],
    additionalProperties: false,
  },
};

export type RuntimeMode = "development" | "installed" | "qualification";

export type TaskState =
  | "queued"
  | "blocked"
  | "waiting_capacity"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "uncertain";
export type BlockingReason =
  | "connection_disabled"
  | "permission_required"
  | "input_changed"
  | "configuration_unavailable"
  | "restart_paused"
  | "usage_limit_reached";
export type AttemptState =
  | "prepared"
  | "running"
  | "waiting_user"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "uncertain";
export type AttemptReason =
  | "usage_limit_reached"
  | "not_eligible"
  | "connection_expired"
  | "provider_unavailable"
  | "request_rejected"
  | "provider_error"
  | "invalid_output"
  | "output_limit_exceeded"
  | "connection_lost"
  | "empty_reply"
  | "input_too_large"
  | "permit_expired"
  | "inactivity_timeout"
  | "deadline_exceeded"
  | "cancelled_by_researcher"
  | "service_restarted";
export interface TaskRow {
  id: Uint8Array;
  project_id: Uint8Array;
  conversation_id: Uint8Array;
  input_through_position: number | null;
  kind: "reply" | "consultation" | "contribution" | "synthesis";
  contribution_id: Uint8Array | null;
  reply_position: number | null;
  operation: string;
  policy_version: number;
  instruction_version: number;
  connection: string;
  document_language: string | null;
  accepted_by_operation_id: string;
  replaces_task_id: Uint8Array | null;
  charge_warning_accepted_at: string | null;
  state: TaskState;
  blocking_reason: BlockingReason | null;
  state_revision: number;
  created_at: string;
  updated_at: string;
}
export interface AttemptRow extends ProviderUsage {
  id: Uint8Array;
  task_id: Uint8Array;
  attempt_number: number;
  service_generation: string;
  state: AttemptState;
  outcome_reason: AttemptReason | null;
  requested_model: string | null;
  observed_model: string | null;
  dispatch_permitted_at: string | null;
  transfer_manifest: string | null;
  provider_request_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
/** The committed terminal decision is returned to the stream reporter, including a winning Stop. */
export type RecordedTaskEvent =
  | { readonly recorded: false }
  | { readonly recorded: true; readonly result?: ProviderResult; readonly proposalId?: string };

export interface UsagePauseRow {
  id: Uint8Array;
  connection: "chatgpt";
  source_attempt_id: Uint8Array;
  paused_at: string;
  resumed_at: string | null;
  resumed_by_operation_id: string | null;
}
export interface TaskSchema {
  service_runs: { generation: string; started_at: string; clean_stop_at: string | null };
  usage_limit_pauses: UsagePauseRow;
  tasks: TaskRow;
  attempts: AttemptRow & { conversation_title_policy: Generated<number | null> };
  application_preferences: { key: string; schema_version: number; revision: number; value: string };
}
function delegatedTask(task: TaskRow): boolean {
  return task.kind !== "reply";
}

export const unknownUsage: ProviderUsage = Object.freeze({
  input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
});
export interface PreparedTask {
  readonly kind: TaskRow["kind"];
  readonly dispatch: ProviderDispatchMessage;
  readonly transfer: readonly TransferEntry[];
  readonly acceptedByOperationId: string;
  readonly taskId: string;
}
export interface TaskContext {
  readonly mode: RuntimeMode;
  readonly generation: string;
  readonly connections: ServiceConnections;
  readonly requestModelRefresh?: (connection: string) => void;
  readonly resolveAgentConnection?: (agent: ReplyAgent) => string;
}
/** One instance belongs to one short database transaction. It never sends a provider request. */
export class TaskTransaction {
  readonly diagnostics: DiagnosticEvent[] = [];
  readonly modelRefreshes = new Set<string>();
  readonly finishedReplies: Extract<
    import("@ohtia/contracts").ResearchEvent,
    { kind: "replyFinished" }
  >[] = [];
  get touchedConversations(): Iterable<Uint8Array> {
    return this.conversations.values();
  }
  private readonly changedPlans = new Map<string, Uint8Array>();
  private readonly interventions = new Map<string, Uint8Array>();
  private readonly conversations = new Map<string, Uint8Array>();
  private admitSynthesis = false;
  private restartingAfterCrash = false;
  private readonly exitCancelledPlans = new Set<string>();
  get continuationAdmissionStopped(): boolean {
    return this.stopContinuationAdmission;
  }
  private titleSuggestion?: { conversation: string; attemptId: Uint8Array; title: string };
  constructor(
    private readonly db: Kysely<ResearchSchema>,
    readonly context: TaskContext,
    private readonly now = new Date().toISOString(),
    private stopContinuationAdmission = false,
  ) {}
  touch(conversation: Uint8Array): void {
    this.conversations.set(identifier(conversation), conversation);
  }
  private readonly revisedInterventions = new Map<string, Uint8Array>();
  private touchIntervention(id: Uint8Array): void {
    const key = identifier(id);
    if (!this.revisedInterventions.has(key)) this.interventions.set(key, id);
  }
  private interventionRevised(id: Uint8Array): void {
    const key = identifier(id);
    this.revisedInterventions.set(key, id);
    this.interventions.delete(key);
  }
  async flush(): Promise<void> {
    for (const id of this.changedPlans.values()) await this.advancePlan(id);
    if (this.admitSynthesis && !this.stopContinuationAdmission) {
      await this.admitWaitingContinuations(contributionSynthesisPolicy);
      await this.admitWaitingContinuations(testSynthesisPolicy);
    }
    for (const id of this.interventions.values()) {
      const row = await this.db
        .updateTable("interventions")
        .set({ revision: sql`revision+1` })
        .where("id", "=", id)
        .returning("conversation_id")
        .executeTakeFirstOrThrow();
      this.touch(row.conversation_id);
    }
    for (const id of this.revisedInterventions.values()) {
      const row = await this.db
        .selectFrom("interventions")
        .select("conversation_id")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      this.touch(row.conversation_id);
    }
    for (const [conversation, id] of this.conversations) {
      const revision = this.db
        .updateTable("conversations")
        .set({ revision: sql`revision+1` })
        .where("id", "=", id);
      const suggestion = this.titleSuggestion;
      if (suggestion?.conversation === conversation) {
        // Keep the manual rename version so an edit already in progress can still win.
        const named = await revision
          .set({ title: suggestion.title, title_attempt_id: suggestion.attemptId })
          .where("automatic_title_eligible", "=", 1)
          .where("title", "is", null)
          .executeTakeFirst();
        if (named.numUpdatedRows === 1n) continue;
      }
      await revision.execute();
    }
  }
  private async change(task: TaskRow, change: Partial<TaskRow>): Promise<void> {
    const changed = await this.db
      .updateTable("tasks")
      .set({ ...change, state_revision: task.state_revision + 1, updated_at: this.now })
      .where("id", "=", task.id)
      .where("state_revision", "=", task.state_revision)
      .executeTakeFirstOrThrow();
    if (changed.numUpdatedRows !== 1n) throw new Error("Task revision changed.");
    this.touch(task.conversation_id);
    if (task.kind === "synthesis") {
      const owner = await this.db
        .selectFrom("continuations")
        .select("intervention_id")
        .where("task_id", "=", task.id)
        .executeTakeFirstOrThrow();
      this.touchIntervention(owner.intervention_id);
      if (
        (task.state === "queued" || task.state === "blocked") &&
        change.state &&
        change.state !== "queued" &&
        change.state !== "blocked"
      )
        this.admitSynthesis = true;
      if (change.state && ["completed", "failed", "uncertain", "cancelled"].includes(change.state))
        if (await releaseTaskWork(this.db, task.id, this.now)) this.workReleased();
    }
    if (task.contribution_id) {
      const contribution = await this.db
        .selectFrom("contributions")
        .select("intervention_id")
        .where("id", "=", task.contribution_id)
        .executeTakeFirstOrThrow();
      this.touchIntervention(contribution.intervention_id);
      const state = change.state;
      if (
        state === "completed" ||
        state === "failed" ||
        state === "uncertain" ||
        state === "cancelled"
      ) {
        if (await releaseTaskWork(this.db, task.id, this.now)) this.workReleased();
        const result =
          state === "completed"
            ? await this.db
                .selectFrom("messages")
                .select("id")
                .where("task_id", "=", task.id)
                .where("ending", "=", "complete")
                .executeTakeFirstOrThrow()
            : undefined;
        await this.db
          .updateTable("contributions")
          .set({ state, result_message_id: result?.id ?? null })
          .where("id", "=", task.contribution_id)
          .where("task_id", "=", task.id)
          .execute();
        if (task.kind === "contribution") {
          await this.planEvent(
            contribution.intervention_id,
            `contribution_${state}`,
            {},
            task.contribution_id,
            task.id,
          );
          this.changedPlans.set(
            identifier(contribution.intervention_id),
            contribution.intervention_id,
          );
        }
      }
    }
  }
  agentConnection(agent: ReplyAgent): string {
    return this.context.resolveAgentConnection?.(agent) ?? "chatgpt";
  }
  /** Shared routing for acceptance and destination preview, independent of connection state. */
  async destination(projectId: Uint8Array, recipient: ConversationAgent = "virgilio") {
    const project = await this.db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", projectId)
      .executeTakeFirstOrThrow();
    if (recipient === "josefa") {
      if (project.is_development || project.setup_confirmed_at === null) return null;
      const policy = operationPolicy("search_strategy_planning", 3, this.context.mode);
      return policy ? { policy, connection: this.agentConnection(recipient) } : null;
    }
    if (recipient !== "virgilio") return null;
    const policy = operationPolicy(
      project.is_development
        ? "development_test"
        : project.setup_confirmed_at === null
          ? "project_setup"
          : "direct_guidance",
      project.is_development ? 1 : project.setup_confirmed_at === null ? 2 : 4,
      this.context.mode,
    );
    return policy ? { policy, connection: this.agentConnection(recipient) } : null;
  }
  async stopConversation(id: Uint8Array, operationId: string): Promise<Outcome<Uint8Array>> {
    const conversation = await this.db
      .selectFrom("conversations")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!conversation) return failure("record_not_found");
    const tasks = await this.db
      .selectFrom("tasks")
      .select("id")
      .where("conversation_id", "=", id)
      .where("kind", "in", ["reply", "consultation"])
      .where("state", "in", ["queued", "blocked", "running", "cancelling"])
      .execute();
    for (const task of tasks) {
      const stopped = await this.control("task.stop", task.id, operationId);
      if (!stopped.ok) return stopped;
    }
    return { ok: true, value: id };
  }
  /** Later operation stories extend routing when their policies become available. */
  async admission(
    projectId: Uint8Array,
    conversationId: Uint8Array | null,
    content: string,
    recipient?: ReplyAgent,
  ): Promise<Outcome<null>> {
    const destination = await this.destination(projectId, recipient);
    if (!destination) return failure("service_unavailable");
    const { policy } = destination;
    if (Buffer.byteLength(content, "utf8") > policy.max_input_bytes)
      return failure("input_too_large");
    const pending = conversationId ? await this.waiting(conversationId) : undefined;
    const count = await this.db
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("operation", "=", policy.operation)
      .where("state", "in", ["queued", "blocked"])
      .executeTakeFirstOrThrow();
    if (pending?.operation !== policy.operation && count.count >= policy.max_pending_tasks)
      return failure("pending_limit_reached");
    return { ok: true, value: null };
  }
  private unfinishedConsultation(conversation: Uint8Array) {
    return this.db
      .selectFrom("tasks")
      .select("id")
      .where("conversation_id", "=", conversation)
      .where("kind", "=", "consultation")
      .where("state", "in", ["queued", "blocked", "running", "cancelling"])
      .executeTakeFirst();
  }
  async decideConsultation(
    id: Uint8Array,
    operationId: string,
    shownConnection: string | undefined,
  ): Promise<Outcome<Uint8Array>> {
    const proposal = await this.db
      .selectFrom("interventions")
      .selectAll()
      .where("id", "=", id)
      .where("kind", "=", "consultation")
      .executeTakeFirst();
    if (!proposal) return failure("record_not_found");
    if (proposal.state !== "proposed") return failure("proposal_not_waiting");
    const contribution = await this.db
      .selectFrom("contributions")
      .selectAll()
      .where("intervention_id", "=", id)
      .executeTakeFirstOrThrow();
    const accepting = shownConnection !== undefined;
    if (accepting && (await unfinishedPlan(this.db, proposal.conversation_id)))
      return failure("plan_unfinished");
    const policy = accepting
      ? operationPolicy(contribution.operation, contribution.policy_version, this.context.mode)
      : undefined;
    const destination = policy
      ? { policy, connection: this.agentConnection(contribution.agent_id) }
      : null;
    if (accepting && (!destination || destination.connection !== shownConnection))
      return failure("destination_changed");
    if (destination) {
      if (await this.unfinishedConsultation(proposal.conversation_id))
        return failure("consultation_unfinished");
      if (await this.pendingLimitReached(destination.policy))
        return failure("pending_limit_reached");
      if (!(await workFits(this.db, consultationLimits, [destination.policy])))
        return failure("limit_reached");
    }
    await this.db
      .updateTable("interventions")
      .set({
        state: accepting ? "accepted" : "declined",
        decided_at: this.now,
        decided_by_operation_id: operationId,
        revision: sql`revision+1`,
      })
      .where("id", "=", id)
      .execute();
    if (destination) {
      await authorizeWork(
        this.db,
        id,
        consultationLimits,
        [
          {
            agent_id: contribution.agent_id,
            operation: contribution.operation,
            connection: destination.connection,
          },
        ],
        this.now,
      );
      await reserveWork(this.db, id, contribution.id, destination.policy, this.now);
      const taskId = newId();
      const reason = await this.connectionBlock(destination.connection);
      const project = await this.db
        .selectFrom("projects")
        .select("document_language")
        .where("id", "=", proposal.project_id)
        .executeTakeFirstOrThrow();
      await this.db
        .insertInto("tasks")
        .values({
          id: taskId,
          project_id: proposal.project_id,
          conversation_id: proposal.conversation_id,
          input_through_position: null,
          kind: "consultation",
          contribution_id: contribution.id,
          reply_position: null,
          operation: destination.policy.operation,
          policy_version: destination.policy.version,
          instruction_version: destination.policy.instruction_version,
          connection: destination.connection,
          document_language: project.document_language,
          accepted_by_operation_id: operationId,
          replaces_task_id: null,
          charge_warning_accepted_at: null,
          state: reason ? "blocked" : "queued",
          blocking_reason: reason,
          state_revision: 1,
          created_at: this.now,
          updated_at: this.now,
        })
        .execute();
      await this.db
        .updateTable("contributions")
        .set({ task_id: taskId, state: "active" })
        .where("id", "=", contribution.id)
        .execute();
      await bindWork(this.db, contribution.id, taskId);
      this.diagnostics.push(
        { event_name: "ohtia.task.accepted" },
        { event_name: "ohtia.work.reserved" },
      );
    }
    this.touch(proposal.conversation_id);
    return { ok: true, value: id };
  }
  async decidePlan(
    id: Uint8Array,
    operationId: string,
    connections: Readonly<Partial<Record<ReplyAgent, string>>> | undefined,
  ): Promise<Outcome<Uint8Array>> {
    const plan = await this.db
      .selectFrom("interventions")
      .selectAll()
      .where("id", "=", id)
      .where("kind", "=", "plan")
      .executeTakeFirst();
    if (!plan) return failure("record_not_found");
    if (plan.state !== "proposed") return failure("proposal_not_waiting");
    if (!connections) {
      await this.db
        .updateTable("interventions")
        .set({
          state: "declined",
          decided_at: this.now,
          decided_by_operation_id: operationId,
          revision: sql`revision+1`,
        })
        .where("id", "=", id)
        .execute();
      this.touch(plan.conversation_id);
      return { ok: true, value: id };
    }
    if (await unfinishedPlan(this.db, plan.conversation_id)) return failure("plan_unfinished");
    // An in-flight reply predates this approval even if the plan finishes before the reply.
    const inFlightReply = await this.db
      .selectFrom("attempts as a")
      .innerJoin("tasks as t", "t.id", "a.task_id")
      .select("a.id")
      .where("t.conversation_id", "=", plan.conversation_id)
      .where("t.operation", "=", "direct_guidance")
      .where("a.state", "in", ["running", "waiting_user"])
      .executeTakeFirst();
    const nodes = await planContributions(this.db, id);
    const edges = await holdingDependencies(this.db, id);
    const keys = new Map(nodes.map((node) => [identifier(node.id), node.plan_key]));
    const accepted = await addContributions(
      this.db,
      {
        conversationId: identifier(plan.conversation_id),
        expectedGraphVersion: 0,
        purpose: plan.purpose ?? "",
        sharedContext: plan.shared_context ?? "",
        contributions: nodes.map((node) => ({
          planKey: node.plan_key,
          agent: node.agent_id,
          request: node.request,
          reason: node.reason,
          required: !!node.required,
          prerequisites: edges
            .filter((edge) => identifier(edge.contribution_id) === identifier(node.id))
            .map((edge) => keys.get(identifier(edge.prerequisite_id)) ?? ""),
        })),
      },
      this.context.mode,
      (agent) => this.agentConnection(agent),
      operationId,
      this.now,
      { kind: "acceptance", plan, connections, inFlightReply: inFlightReply?.id ?? null },
    );
    if (!accepted.ok)
      return accepted.error.code === "destination_changed" ||
        accepted.error.code === "pending_limit_reached"
        ? accepted
        : invalidPlan(planInvalidReason(accepted.error.code));
    this.diagnostics.push({ event_name: "ohtia.work.reserved" });
    this.interventionRevised(id);
    return this.recordGraphChange(id);
  }

  private openPlans() {
    return acceptedPlans(this.db).select("id").where("outcome", "is", null);
  }

  private clearPlanRestartHolds(id: Uint8Array) {
    return this.db
      .updateTable("contributions")
      .set({ restart_held: 0 })
      .where("intervention_id", "=", id)
      .where("restart_held", "=", 1)
      .execute();
  }

  private planEvent(
    id: Uint8Array,
    kind: PlanEventKind,
    payload: PlanEventPayload,
    contributionId: Uint8Array | null = null,
    taskId: Uint8Array | null = null,
  ) {
    this.touchIntervention(id);
    return appendPlanEvent(this.db, id, this.now, kind, payload, contributionId, taskId);
  }

  async recordGraphChange(id: Uint8Array): Promise<Outcome<Uint8Array>> {
    const plan = await acceptedPlan(this.db, id);
    if (!plan) throw new Error("Changed plan could not be read.");
    if (!(await hasEventRoom(this.db, id))) return failure("event_limit_reached");
    await this.planEvent(id, "graph_changed", { graphVersion: plan.graph_version });
    if (!(await this.advancePlan(id))) return failure("event_limit_reached");
    return { ok: true, value: id };
  }

  private async cancelUnstartedContributions(
    id?: Uint8Array,
    states: readonly ("waiting" | "blocked")[] = ["waiting", "blocked"],
  ): Promise<void> {
    let query = this.db
      .updateTable("contributions")
      .set({ state: "cancelled", blocked_by_contribution_id: null, restart_held: 0 })
      .where("state", "in", states);
    query = id
      ? query.where("intervention_id", "=", id)
      : query.where("intervention_id", "in", this.openPlans());
    const rows = await query.returning(["id", "intervention_id"]).execute();
    for (const row of rows) {
      if (await releaseUnboundContributionWork(this.db, row.id, this.now)) this.workReleased();
      await this.planEvent(row.intervention_id, "contribution_cancelled", {}, row.id);
      this.changedPlans.set(identifier(row.intervention_id), row.intervention_id);
    }
  }

  private async withdrawWaitingContinuations(id?: Uint8Array): Promise<void> {
    let query = this.db
      .updateTable("continuations")
      .set({ admission: "withdrawn", restart_held: 0 })
      .where("admission", "=", "waiting");
    if (id) query = query.where("intervention_id", "=", id);
    for (const row of await query.returning("intervention_id").execute()) {
      const released = await this.db
        .updateTable("work_allocations")
        .set({ state: "released", settled_at: this.now })
        .where("intervention_id", "=", row.intervention_id)
        .where("share", "=", "synthesis")
        .where("task_id", "is", null)
        .where("state", "=", "held")
        .executeTakeFirst();
      if (released.numUpdatedRows) this.workReleased();
      this.touchIntervention(row.intervention_id);
    }
  }

  async cancelPlan(id: Uint8Array, operationId: string): Promise<Outcome<Uint8Array>> {
    const plan = await acceptedPlan(this.db, id);
    if (!plan) return failure("record_not_found");
    if (plan.outcome) {
      const continuation = await planContinuation(this.db, id);
      if (continuation?.admission === "waiting") await this.withdrawWaitingContinuations(id);
      else if (continuation?.task_id)
        await this.control("task.stop", continuation.task_id, operationId, true);
      return { ok: true, value: id };
    }
    await this.cancelUnstartedContributions(id);
    for (const node of await planContributions(this.db, id))
      if (node.state === "active" && node.task_id)
        await this.control("task.stop", node.task_id, operationId, true);
    if (await releasePendingWork(this.db, id, this.now, true)) this.workReleased();
    await this.endPlan(plan, "cancelled", operationId);
    return { ok: true, value: id };
  }

  private async endPlan(
    plan: Selectable<InterventionRow>,
    outcome: NonNullable<Selectable<InterventionRow>["outcome"]>,
    operationId: string | null = null,
  ): Promise<void> {
    await this.db
      .updateTable("interventions")
      .set({
        outcome,
        finished_at: this.now,
        finished_by_operation_id: operationId,
        revision: sql`revision+1`,
      })
      .where("id", "=", plan.id)
      .execute();
    this.interventionRevised(plan.id);
    await this.planEvent(plan.id, "plan_ended", { outcome });
    if (outcome === "complete" || outcome === "partial")
      await this.recordContinuation(plan, outcome);
  }

  private async recordContinuation(
    plan: Selectable<InterventionRow>,
    outcome: "complete" | "partial",
  ): Promise<void> {
    const withdrawn =
      this.stopContinuationAdmission || this.exitCancelledPlans.has(identifier(plan.id));
    await createContinuation(
      this.db,
      plan,
      outcome === "complete" ? "required_set_complete" : "finished_partial",
      this.now,
      withdrawn,
      this.restartingAfterCrash,
    );
    if (withdrawn) {
      if (await releasePendingWork(this.db, plan.id, this.now, true)) this.workReleased();
    } else this.admitSynthesis = true;
    this.touchIntervention(plan.id);
  }

  private async admitWaitingContinuations(policy: OperationPolicy): Promise<void> {
    let available = policy.max_pending_tasks - (await this.pendingCount(policy.operation));
    if (available <= 0) return;
    const returning = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("kind", "=", "synthesis")
      .where("operation", "=", policy.operation)
      .where("state", "=", "waiting_capacity")
      .orderBy("created_at")
      .orderBy("id")
      .limit(available)
      .execute();
    for (const task of returning) {
      const reason = task.blocking_reason;
      await this.change(task, { state: reason ? "blocked" : "queued", blocking_reason: reason });
      this.diagnostics.push({ event_name: "ohtia.task.readmitted" });
      available--;
    }
    if (available <= 0) return;
    const rows = await this.db
      .selectFrom("continuations")
      .selectAll()
      .where("admission", "=", "waiting")
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("intervention_operations as o")
            .select("o.intervention_id")
            .whereRef("o.intervention_id", "=", "continuations.intervention_id")
            .where("o.agent_id", "=", "virgilio")
            .where("o.operation", "=", policy.operation),
        ),
      )
      .orderBy("created_at")
      .orderBy("id")
      .limit(available)
      .execute();
    for (const row of rows) {
      const plan = await acceptedPlan(this.db, row.intervention_id);
      const receipt =
        row.reason === "finished_partial"
          ? plan?.finished_by_operation_id
          : plan?.decided_by_operation_id;
      const route = await authorizedOperation(
        this.db,
        row.intervention_id,
        "virgilio",
        policy.operation,
      );
      if (!plan || !receipt || !route)
        throw new Error("Ready continuation lacks its authorized operation.");
      const project = await this.db
        .selectFrom("projects")
        .select("document_language")
        .where("id", "=", plan.project_id)
        .executeTakeFirstOrThrow();
      const taskId = newId();
      const reason = row.restart_held
        ? "restart_paused"
        : this.synthesisRouteAvailable(policy.operation, route.connection)
          ? await this.connectionBlock(route.connection)
          : "configuration_unavailable";
      await this.db
        .updateTable("continuations")
        .set({ admission: "admitted", task_id: taskId, restart_held: 0 })
        .where("id", "=", row.id)
        .execute();
      await this.db
        .insertInto("tasks")
        .values({
          id: taskId,
          kind: "synthesis",
          contribution_id: null,
          project_id: plan.project_id,
          conversation_id: plan.conversation_id,
          input_through_position: null,
          reply_position: null,
          operation: policy.operation,
          policy_version: policy.version,
          instruction_version: policy.instruction_version,
          connection: route.connection,
          document_language: project.document_language,
          accepted_by_operation_id: receipt,
          replaces_task_id: null,
          charge_warning_accepted_at: null,
          state: reason ? "blocked" : "queued",
          blocking_reason: reason,
          state_revision: 1,
          created_at: this.now,
          updated_at: this.now,
        })
        .execute();
      await bindSynthesisWork(this.db, plan.id, taskId);
      this.touchIntervention(plan.id);
      this.diagnostics.push({ event_name: "ohtia.task.accepted" });
    }
  }

  async finishPlan(id: Uint8Array, operationId: string): Promise<Outcome<Uint8Array>> {
    const plan = await this.db
      .selectFrom("interventions")
      .selectAll()
      .where("id", "=", id)
      .where("kind", "=", "plan")
      .where("state", "=", "accepted")
      .executeTakeFirst();
    if (!plan) return failure("record_not_found");
    if (plan.outcome) return { ok: true, value: id };
    const contributions = await planContributions(this.db, id);
    const capped = !(await hasEventRoom(this.db, id));
    if (
      contributions.some(({ state }) => state === "active") ||
      (!capped &&
        (contributions.some(({ state }) => state === "waiting") ||
          !contributions.some(({ state, required }) => required && state !== "completed")))
    )
      return failure("plan_state_changed");
    if (capped) await this.cancelUnstartedContributions(id, ["waiting"]);
    await this.clearPlanRestartHolds(id);
    const hasResult = contributions.some(({ state }) => state === "completed");
    if (await releasePendingWork(this.db, id, this.now, !hasResult)) this.workReleased();
    await this.endPlan(plan, hasResult ? "partial" : "failed", operationId);
    return { ok: true, value: id };
  }

  /** Advance the accepted graph against committed task outcomes in the same transaction. */
  private async advancePlan(id: Uint8Array): Promise<boolean> {
    const plan = await this.db
      .selectFrom("interventions")
      .selectAll()
      .where("id", "=", id)
      .where("kind", "=", "plan")
      .where("state", "=", "accepted")
      .where("outcome", "is", null)
      .executeTakeFirst();
    // Revision 22 could store synthetic plans, but had no accepted work envelopes for them.
    if (!plan || !(await interventionLimits(this.db, id))) return true;
    const nodes = await planContributions(this.db, id);
    const byId = new Map(nodes.map((row) => [identifier(row.id), row]));
    const edges = new Map(nodes.map((row) => [identifier(row.id), [] as string[]]));
    for (const edge of await holdingDependencies(this.db, id)) {
      const prerequisites = edges.get(identifier(edge.contribution_id));
      if (!prerequisites) throw new Error("Stored dependency lacks a contribution.");
      prerequisites.push(identifier(edge.prerequisite_id));
    }
    const order = topologicalOrder(edges);
    if (!order) throw new Error("Stored contribution graph contains a cycle.");
    const nodeAt = (key: string) => {
      const node = byId.get(key);
      if (!node) throw new Error("Stored dependency lacks a contribution.");
      return node;
    };
    let withinCap = true;
    for (const key of order) {
      const node = nodeAt(key);
      if (node.state !== "waiting" && node.state !== "blocked") continue;
      const prerequisites = (edges.get(key) ?? []).map(nodeAt);
      if (node.ready_inputs !== null) {
        if (!node.restart_held && !(await this.activateContribution(plan, node))) withinCap = false;
        continue;
      }
      const blocker = prerequisites.find(
        ({ state }) => !waitingForPlanWork(state) && state !== "completed",
      );
      if (blocker) {
        const root = blocker.blocked_by_contribution_id ?? blocker.id;
        if (
          !node.blocked_by_contribution_id ||
          identifier(root) !== identifier(node.blocked_by_contribution_id)
        ) {
          await this.db
            .updateTable("contributions")
            .set({ state: "blocked", blocked_by_contribution_id: root })
            .where("id", "=", node.id)
            .execute();
          node.state = "blocked";
          node.blocked_by_contribution_id = root;
          await this.planEvent(
            id,
            "contribution_blocked",
            { blockedBy: identifier(root) },
            node.id,
          );
          if (!(await hasEventRoom(this.db, id, 0))) withinCap = false;
        }
        continue;
      }
      if (node.state === "blocked") {
        if (!(await hasEventRoom(this.db, id))) {
          withinCap = false;
          continue;
        }
        await this.db
          .updateTable("contributions")
          .set({ state: "waiting", blocked_by_contribution_id: null })
          .where("id", "=", node.id)
          .execute();
        node.state = "waiting";
        node.blocked_by_contribution_id = null;
        await this.planEvent(id, "contribution_waiting", {}, node.id);
      }
      if (
        !node.restart_held &&
        prerequisites.every(({ state }) => state === "completed") &&
        !(await this.activateContribution(plan, node))
      )
        withinCap = false;
    }
    if (
      nodes.length &&
      nodes.every(
        ({ required, state }) => !waitingForPlanWork(state) && (!required || state === "completed"),
      )
    ) {
      await this.clearPlanRestartHolds(id);
      if (await releasePendingWork(this.db, id, this.now, false)) this.workReleased();
      await this.endPlan(plan, "complete");
      this.diagnostics.push({ event_name: "ohtia.plan.completed" });
    }
    return withinCap;
  }

  private async activationRefusal(
    node: Selectable<ContributionRow>,
  ): Promise<"destination_changed" | "input_changed" | undefined> {
    const operation = await authorizedOperation(
      this.db,
      node.intervention_id,
      node.agent_id,
      node.operation,
    );
    if (!operation || operation.connection !== this.agentConnection(node.agent_id))
      return "destination_changed";
    if (
      node.plan_key !== null &&
      (node.ready_inputs === null || node.ready_inputs !== (await readyInputs(this.db, node.id)))
    )
      return "input_changed";
  }

  private async activateContribution(
    plan: Selectable<InterventionRow>,
    node: Selectable<ContributionRow>,
  ): Promise<boolean> {
    if (!(await hasEventRoom(this.db, plan.id))) return false;
    const policy = recordedOperationPolicy(node.operation, node.policy_version);
    if (!policy || !plan.decided_by_operation_id)
      throw new Error("Accepted contribution has no policy or receipt.");
    if (node.ready_inputs === null) {
      const inputs = await readyInputs(this.db, node.id);
      if (inputs !== undefined) {
        await this.db
          .updateTable("contributions")
          .set({ ready_inputs: inputs })
          .where("id", "=", node.id)
          .execute();
        node.ready_inputs = inputs;
      }
    }
    const refusal = await this.activationRefusal(node);
    const reason =
      refusal ?? ((await planInput(this.db, node, policy)) ? undefined : "input_too_large");
    if (reason) {
      node.state = "failed";
      await this.db
        .updateTable("contributions")
        .set({ state: node.state, failure_reason: reason, restart_held: 0 })
        .where("id", "=", node.id)
        .execute();
      if (await releaseUnboundContributionWork(this.db, node.id, this.now)) this.workReleased();
      await this.planEvent(plan.id, "contribution_failed", { reason }, node.id);
      this.diagnostics.push(
        reason === "input_too_large"
          ? { event_name: "ohtia.contribution.input_too_large", error_code: reason }
          : { event_name: "ohtia.contribution.activation_refused", error_code: reason },
      );
      return true;
    }
    if (await this.pendingLimitReached(policy)) return true;
    await this.insertContributionTask(plan, node, policy, plan.decided_by_operation_id);
    return true;
  }

  async retryContributionWithoutTask(
    id: Uint8Array,
    operationId: string,
  ): Promise<Outcome<Uint8Array>> {
    const node = await this.db
      .selectFrom("contributions")
      .selectAll()
      .where("id", "=", id)
      .where("plan_key", "is not", null)
      .executeTakeFirst();
    if (!node) return failure("record_not_found");
    const plan = await this.db
      .selectFrom("interventions")
      .selectAll()
      .where("id", "=", node.intervention_id)
      .executeTakeFirstOrThrow();
    if (plan.outcome || node.task_id || node.failure_reason !== "destination_changed")
      return failure("task_not_retryable");
    if (!(await hasEventRoom(this.db, plan.id))) return failure("event_limit_reached");
    const refusal = await this.activationRefusal(node);
    if (refusal) return failure(refusal);
    const policy = operationPolicy(node.operation, node.policy_version, this.context.mode);
    if (!policy) return failure("service_unavailable");
    if (!(await planInput(this.db, node, policy))) return failure("input_too_large");
    const limits = await interventionLimits(this.db, plan.id);
    if (!limits || !(await workFits(this.db, limits, [policy], plan.id)))
      return failure("limit_reached");
    if (await this.pendingLimitReached(policy)) return failure("pending_limit_reached");
    await reserveWork(this.db, plan.id, node.id, policy, this.now);
    this.diagnostics.push({ event_name: "ohtia.work.reserved" });
    const taskId = await this.insertContributionTask(plan, node, policy, operationId);
    if (!(await this.advancePlan(plan.id))) return failure("event_limit_reached");
    return { ok: true, value: taskId };
  }

  private async settleDelegatedAttempt(
    attempt: Pick<AttemptRow, "id" | "task_id" | "attempt_number">,
    dispatched: boolean,
    work?: ProviderWorkUsage,
  ): Promise<void> {
    if (await settleWork(this.db, attempt, this.now, dispatched, work)) {
      if (dispatched) this.diagnostics.push({ event_name: "ohtia.work.settled" });
      else this.workReleased();
    }
  }

  private workReleased(): void {
    this.diagnostics.push({ event_name: "ohtia.work.released" });
  }

  private async insertContributionTask(
    plan: Selectable<InterventionRow>,
    node: Selectable<ContributionRow>,
    policy: OperationPolicy,
    operationId: string,
  ): Promise<Uint8Array> {
    const project = await this.db
      .selectFrom("projects")
      .select("document_language")
      .where("id", "=", plan.project_id)
      .executeTakeFirstOrThrow();
    const taskId = newId();
    const connection = this.agentConnection(node.agent_id);
    const reason = operationPolicy(node.operation, node.policy_version, this.context.mode)
      ? await this.connectionBlock(connection)
      : "configuration_unavailable";
    await this.db
      .insertInto("tasks")
      .values({
        id: taskId,
        kind: "contribution",
        contribution_id: node.id,
        project_id: plan.project_id,
        conversation_id: plan.conversation_id,
        input_through_position: null,
        reply_position: null,
        operation: policy.operation,
        policy_version: policy.version,
        instruction_version: policy.instruction_version,
        connection,
        document_language: project.document_language,
        accepted_by_operation_id: operationId,
        replaces_task_id: null,
        charge_warning_accepted_at: null,
        state: reason ? "blocked" : "queued",
        blocking_reason: reason,
        state_revision: 1,
        created_at: this.now,
        updated_at: this.now,
      })
      .execute();
    await bindWork(this.db, node.id, taskId);
    node.state = "active";
    await this.db
      .updateTable("contributions")
      .set({ task_id: taskId, state: node.state, failure_reason: null })
      .where("id", "=", node.id)
      .execute();
    await this.planEvent(plan.id, "contribution_started", {}, node.id, taskId);
    this.diagnostics.push({ event_name: "ohtia.task.accepted" });
    return taskId;
  }

  private async pendingLimitReached(policy: OperationPolicy): Promise<boolean> {
    return (await this.pendingCount(policy.operation)) >= policy.max_pending_tasks;
  }
  private async pendingCount(operation: string): Promise<number> {
    const pending = await this.db
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("operation", "=", operation)
      .where("state", "in", ["queued", "blocked"])
      .executeTakeFirstOrThrow();
    return pending.count;
  }
  private waiting(conversation: Uint8Array) {
    return this.db
      .selectFrom("tasks")
      .selectAll()
      .where("conversation_id", "=", conversation)
      .where("kind", "=", "reply")
      .where("state", "in", ["queued", "blocked"])
      .executeTakeFirst();
  }
  async accept(
    projectId: Uint8Array,
    conversationId: Uint8Array,
    position: number,
    operationId: string,
    recipient?: ReplyAgent,
  ): Promise<void> {
    const project = await this.db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", projectId)
      .executeTakeFirstOrThrow();
    this.touch(conversationId);
    this.diagnostics.push({ event_name: "ohtia.task.accepted" });
    const destination = await this.destination(projectId, recipient);
    if (!destination) throw new Error("Task policy unavailable.");
    const { policy, connection } = destination;
    const old = await this.waiting(conversationId);
    const reason = old?.blocking_reason ?? (await this.connectionBlock(connection));
    if (old) await this.change(old, { state: "cancelled", blocking_reason: null });
    await this.db
      .insertInto("tasks")
      .values({
        id: newId(),
        project_id: projectId,
        conversation_id: conversationId,
        input_through_position: position,
        kind: "reply",
        contribution_id: null,
        reply_position: null,
        operation: policy.operation,
        policy_version: policy.version,
        instruction_version: policy.instruction_version,
        connection,
        document_language: project.document_language,
        accepted_by_operation_id: operationId,
        replaces_task_id: old?.id ?? null,
        charge_warning_accepted_at: null,
        state: reason ? "blocked" : "queued",
        blocking_reason: reason,
        state_revision: 1,
        created_at: this.now,
        updated_at: this.now,
      })
      .execute();
  }
  private async replaceWaiting(conversation: Uint8Array, includedPosition?: number): Promise<void> {
    const old = await this.waiting(conversation);
    if (!old) return;
    const reason = old.blocking_reason ?? (await this.connectionBlock(old.connection));
    await this.change(old, { state: "cancelled", blocking_reason: null });
    await this.db
      .insertInto("tasks")
      .values({
        ...old,
        input_through_position: Math.max(old.input_through_position ?? 0, includedPosition ?? 0),
        id: newId(),
        replaces_task_id: old.id,
        charge_warning_accepted_at: null,
        state: reason ? "blocked" : "queued",
        blocking_reason: reason,
        reply_position: null,
        state_revision: 1,
        created_at: this.now,
        updated_at: this.now,
      })
      .execute();
    this.touch(conversation);
  }
  private async usagePause(connection: string) {
    return this.db
      .selectFrom("usage_limit_pauses")
      .selectAll()
      .where("connection", "=", connection as "chatgpt")
      .where("resumed_at", "is", null)
      .executeTakeFirst();
  }
  private async connectionBlock(connection: string): Promise<BlockingReason | null> {
    if (!this.context.connections.available(connection)) return "connection_disabled";
    return (await this.usagePause(connection)) ? "usage_limit_reached" : null;
  }
  private synthesisRouteAvailable(operation: string, connection: string): boolean {
    return (
      connection === this.agentConnection("virgilio") &&
      (operation === contributionSynthesisPolicy.operation ||
        (operation === testSynthesisPolicy.operation &&
          connection === "fake" &&
          this.context.mode === "development"))
    );
  }
  /** Revalidate the released operation's authority and immutable inputs without changing its scope. */
  private async valid(task: TaskRow): Promise<boolean> {
    const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
    if (!policy || policy.instruction_version !== task.instruction_version) return false;
    if (task.kind === "reply") {
      if (task.connection !== "chatgpt") return false;
    } else if (task.kind !== "synthesis") {
      const contribution =
        task.contribution_id &&
        (await this.db
          .selectFrom("contributions")
          .selectAll()
          .where("id", "=", task.contribution_id)
          .where("task_id", "=", task.id)
          .executeTakeFirst());
      if (
        !contribution ||
        task.connection !== this.agentConnection(contribution.agent_id) ||
        (await this.activationRefusal(contribution))
      )
        return false;
    }
    const project = await this.db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", task.project_id)
      .executeTakeFirst();
    const receipt = await this.db
      .selectFrom("command_receipts")
      .selectAll()
      .where("operation_id", "=", task.accepted_by_operation_id)
      .executeTakeFirst();
    if (task.kind === "contribution") {
      if (
        !project ||
        !task.contribution_id ||
        !receipt ||
        project.document_language !== task.document_language
      )
        return false;
      const eligible = project.is_development
        ? task.operation === "development_test"
        : project.setup_confirmed_at !== null && task.operation === "search_strategy_planning";
      if (!eligible) return false;
      const plan = await this.db
        .selectFrom("contributions as c")
        .innerJoin("interventions as i", "i.id", "c.intervention_id")
        .select(["i.id", "i.decided_by_operation_id"])
        .where("c.id", "=", task.contribution_id)
        .where("c.task_id", "=", task.id)
        .where("i.kind", "=", "plan")
        .where("i.state", "=", "accepted")
        .where("i.outcome", "is", null)
        .executeTakeFirst();
      if (!plan) return false;
      if (
        receipt.command === "plan.accept" ||
        receipt.command === "plan.addContributions" ||
        receipt.command === "development.runPlan"
      )
        return (
          plan.decided_by_operation_id === receipt.operation_id &&
          identifier(receipt.result_id) === identifier(plan.id)
        );
      return (
        (receipt.command === "contribution.tryAgain" ||
          receipt.command === "contribution.startAgain") &&
        identifier(receipt.result_id) === identifier(task.id)
      );
    }
    if (task.kind === "synthesis") {
      const continuation = await this.db
        .selectFrom("continuations")
        .select(["id", "intervention_id"])
        .where("task_id", "=", task.id)
        .where("admission", "=", "admitted")
        .where("stopped", "=", 0)
        .executeTakeFirst();
      return (
        !!continuation &&
        !!project &&
        (project.is_development === 1
          ? this.context.mode === "development"
          : project.setup_confirmed_at !== null) &&
        project.document_language === task.document_language &&
        this.synthesisRouteAvailable(task.operation, task.connection) &&
        (
          await authorizedOperation(
            this.db,
            continuation.intervention_id,
            "virgilio",
            task.operation,
          )
        )?.connection === task.connection &&
        !!receipt &&
        (receipt.command === "synthesis.tryAgain"
          ? identifier(receipt.result_id) === identifier(task.id)
          : ["plan.accept", "plan.addContributions", "plan.finish", "development.runPlan"].includes(
              receipt.command,
            ))
      );
    }
    if (task.kind === "consultation")
      return (
        !!project &&
        !project.is_development &&
        project.setup_confirmed_at !== null &&
        project.document_language === task.document_language &&
        task.operation === "search_strategy_planning" &&
        !!task.contribution_id &&
        !!receipt &&
        ["consultation.accept", "contribution.tryAgain", "contribution.startAgain"].includes(
          receipt.command,
        )
      );
    const message = await this.db
      .selectFrom("messages")
      .select("id")
      .where("conversation_id", "=", task.conversation_id)
      .where("position", "=", task.input_through_position)
      .executeTakeFirst();
    return (
      !!project &&
      (project.is_development
        ? task.operation === "development_test"
        : project.setup_confirmed_at === null
          ? task.operation === "project_setup"
          : (task.operation === "direct_guidance" ||
              task.operation === "search_strategy_planning") &&
            task.document_language === project.document_language) &&
      !!message &&
      !!receipt &&
      (receipt.command === "task.startAgain" ||
        receipt.command === "task.tryAgain" ||
        receipt.command === "conversation.start" ||
        receipt.command === "message.append" ||
        (receipt.command === "development.sendToJosefa" &&
          this.context.mode === "development" &&
          task.operation === "search_strategy_planning"))
    );
  }
  private pending(includeReturning = false) {
    return this.db
      .selectFrom("tasks")
      .selectAll()
      .where(
        "state",
        "in",
        includeReturning ? ["queued", "blocked", "waiting_capacity"] : ["queued", "blocked"],
      )
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }
  /** Preserve unrelated and restart holds; connection reports cannot consent to recovery. */
  async reconcileConnections(): Promise<void> {
    for (const task of await this.pending()) {
      if (
        task.blocking_reason &&
        !["connection_disabled", "usage_limit_reached"].includes(task.blocking_reason)
      )
        continue;
      let reason = await this.connectionBlock(task.connection);
      if (!reason && task.state === "blocked" && !(await this.valid(task)))
        reason = "connection_disabled";
      if (reason !== task.blocking_reason) {
        await this.change(task, { state: reason ? "blocked" : "queued", blocking_reason: reason });
        this.diagnostics.push({
          event_name: reason ? "ohtia.task.blocked" : "ohtia.task.readmitted",
        });
      }
    }
  }
  async resumeUsage(connection: "chatgpt", operationId: string): Promise<void> {
    const pause = await this.usagePause(connection);
    if (!pause) return;
    await this.db
      .updateTable("usage_limit_pauses")
      .set({ resumed_at: this.now, resumed_by_operation_id: operationId })
      .where("id", "=", pause.id)
      .execute();
    await this.reconcileConnections();
    this.diagnostics.push({ event_name: "ohtia.usage_pause.resumed" });
  }
  private async retrySynthesis(task: TaskRow, operationId: string): Promise<Outcome<Uint8Array>> {
    if (task.kind !== "synthesis" || task.operation !== contributionSynthesisPolicy.operation)
      return failure("task_not_retryable");
    const continuation = await this.db
      .selectFrom("continuations as c")
      .innerJoin("work_allocations as w", "w.intervention_id", "c.intervention_id")
      .selectAll("c")
      .where("w.task_id", "=", task.id)
      .executeTakeFirst();
    if (!continuation?.task_id) return failure("record_not_found");
    if (identifier(continuation.task_id) !== identifier(task.id))
      return failure("newer_task_exists");
    const attempt = await this.db
      .selectFrom("attempts")
      .select("outcome_reason")
      .where("task_id", "=", task.id)
      .orderBy("attempt_number", "desc")
      .executeTakeFirst();
    if (
      continuation.stopped ||
      (task.state !== "failed" && task.state !== "uncertain") ||
      ["not_eligible", "input_too_large"].includes(attempt?.outcome_reason ?? "")
    )
      return failure("task_not_retryable");
    const activePlan = await unfinishedPlan(this.db, task.conversation_id);
    if (activePlan && identifier(activePlan.id) !== identifier(continuation.intervention_id))
      return failure("plan_unfinished");
    const policy = contributionSynthesisPolicy;
    const limits = await interventionLimits(this.db, continuation.intervention_id);
    const turns = await this.db
      .selectFrom("work_allocations")
      .select(({ fn }) => fn.count<number>("task_id").distinct().as("count"))
      .where("intervention_id", "=", continuation.intervention_id)
      .where("share", "=", "synthesis")
      .executeTakeFirstOrThrow();
    if (
      !limits ||
      turns.count >= limits.max_coordinator_turns ||
      !(await workFits(this.db, limits, [policy], continuation.intervention_id))
    )
      return failure("limit_reached");
    if (await this.pendingLimitReached(policy)) return failure("pending_limit_reached");
    const replacement = newId();
    const reason = this.synthesisRouteAvailable(task.operation, task.connection)
      ? await this.connectionBlock(task.connection)
      : "configuration_unavailable";

    await reserveWork(this.db, continuation.intervention_id, null, policy, this.now);
    await this.db
      .insertInto("tasks")
      .values({
        ...task,
        id: replacement,
        accepted_by_operation_id: operationId,
        replaces_task_id: task.id,
        charge_warning_accepted_at: task.state === "uncertain" ? this.now : null,
        reply_position: null,
        state: reason ? "blocked" : "queued",
        blocking_reason: reason,
        state_revision: 1,
        created_at: this.now,
        updated_at: this.now,
      })
      .execute();
    await this.change(task, {});
    await this.db
      .updateTable("continuations")
      .set({ task_id: replacement })
      .where("id", "=", continuation.id)
      .execute();
    await bindSynthesisWork(this.db, continuation.intervention_id, replacement);
    this.touchIntervention(continuation.intervention_id);
    this.touch(task.conversation_id);
    if (
      task.state === "failed" &&
      this.context.connections.read(task.connection)?.models?.length === 0
    )
      this.modelRefreshes.add(task.connection);
    this.diagnostics.push(
      { event_name: "ohtia.task.accepted" },
      { event_name: "ohtia.work.reserved" },
    );
    return { ok: true, value: replacement };
  }

  async control(
    command:
      | "task.stop"
      | "task.startAgain"
      | "task.tryAgain"
      | "contribution.tryAgain"
      | "contribution.startAgain"
      | "synthesis.tryAgain",
    id: Uint8Array,
    operationId: string,
    stoppingAll = false,
  ): Promise<Outcome<Uint8Array>> {
    const task = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!task) return failure("record_not_found");
    if (command === "task.stop") {
      if ((task.kind === "contribution" || task.kind === "synthesis") && !stoppingAll)
        return failure("task_not_stoppable");
      if (
        task.kind === "synthesis" &&
        ["queued", "blocked", "waiting_capacity", "running", "cancelling"].includes(task.state)
      )
        await this.db
          .updateTable("continuations")
          .set({ stopped: 1 })
          .where("task_id", "=", task.id)
          .where("stopped", "=", 0)
          .execute();
      if (
        task.state === "queued" ||
        task.state === "blocked" ||
        task.state === "waiting_capacity"
      ) {
        await this.change(task, { state: "cancelled", blocking_reason: null });
        this.diagnostics.push({ event_name: "ohtia.task.cancelled" });
      } else if (task.state === "running" || task.state === "cancelling") {
        const attempt = await this.db
          .selectFrom("attempts")
          .selectAll()
          .where("task_id", "=", task.id)
          .where("state", "in", ["prepared", "running", "waiting_user", "stopping"])
          .executeTakeFirstOrThrow();
        if (
          task.connection === "chatgpt" &&
          attempt.service_generation !== this.context.generation
        ) {
          // Main drains the previous generation before starting this service. Explicit Stop
          // can therefore use its closed connection, without an interrupt to a vanished stream.
          await this.db
            .updateTable("attempts")
            .set({
              state: "cancelled",
              outcome_reason: "cancelled_by_researcher",
              finished_at: this.now,
              ...(!delegatedTask(task) || attempt.dispatch_permitted_at === null
                ? unknownUsage
                : {}),
            })
            .where("id", "=", attempt.id)
            .execute();
          if (delegatedTask(task))
            await this.settleDelegatedAttempt(attempt, attempt.dispatch_permitted_at !== null);
          await this.change(task, { state: "cancelled" });
          this.diagnostics.push({ event_name: "ohtia.task.cancelled" });
        } else if (task.state === "running") {
          await this.db
            .updateTable("attempts")
            .set({ state: "stopping" })
            .where("id", "=", attempt.id)
            .execute();
          await this.change(task, { state: "cancelling" });
        }
      }
      return { ok: true, value: task.id };
    }
    if (command === "synthesis.tryAgain") return this.retrySynthesis(task, operationId);
    if (task.kind === "synthesis") return failure("task_not_retryable");
    const isConsultation = task.kind === "consultation";
    const delegated = delegatedTask(task);
    if (command.startsWith("contribution.") !== delegated) return failure("task_not_retryable");
    const retry = command === "task.tryAgain" || command === "contribution.tryAgain";
    const contribution = task.contribution_id
      ? await this.db
          .selectFrom("contributions")
          .selectAll()
          .where("id", "=", task.contribution_id)
          .executeTakeFirstOrThrow()
      : undefined;
    if (contribution) {
      if (task.kind === "contribution") {
        const plan = await this.db
          .selectFrom("interventions")
          .select("outcome")
          .where("id", "=", contribution.intervention_id)
          .executeTakeFirstOrThrow();
        if (plan.outcome) return failure("task_not_retryable");
        if (!(await hasEventRoom(this.db, contribution.intervention_id)))
          return failure("event_limit_reached");
      }
      if (!contribution.task_id || identifier(contribution.task_id) !== identifier(task.id))
        return failure("newer_task_exists");
    }
    const lastAttempt = await this.db
      .selectFrom("attempts")
      .selectAll()
      .where("task_id", "=", task.id)
      .orderBy("attempt_number", "desc")
      .executeTakeFirst();
    if (
      retry
        ? task.state !== "failed" || lastAttempt?.outcome_reason === "not_eligible"
        : task.state !== "uncertain"
    )
      return failure("task_not_retryable");
    if (task.operation === "project_setup") {
      const project = await this.db
        .selectFrom("projects")
        .select("setup_confirmed_at")
        .where("id", "=", task.project_id)
        .executeTakeFirstOrThrow();
      if (project.setup_confirmed_at !== null) return failure("task_not_retryable");
    }
    if (task.kind === "reply" && task.input_through_position !== null) {
      const boundary = await handoffBoundary(this.db, task.conversation_id);
      if (boundary?.position && task.input_through_position < boundary.position)
        return failure("task_not_retryable");
    }
    // rowid expresses actual acceptance order even if the wall clock moves backwards.
    const newer =
      !delegated &&
      (await this.db
        .selectFrom("tasks")
        .select("id")
        .where("conversation_id", "=", task.conversation_id)
        .where("kind", "=", "reply")
        .where(sql<boolean>`rowid > (SELECT rowid FROM tasks WHERE id=${task.id})`)
        .executeTakeFirst());
    if (newer) return failure("newer_task_exists");
    const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
    if (!policy) return failure("service_unavailable");
    if (contribution) {
      const limits = await interventionLimits(this.db, contribution.intervention_id);
      if (!limits) return failure("limit_reached");
      if (task.connection !== this.agentConnection(contribution.agent_id))
        return failure("destination_changed");
      const destination = await this.activationRefusal(contribution);
      if (destination) return failure(destination);
      if (!(await workFits(this.db, limits, [policy], contribution.intervention_id)))
        return failure("limit_reached");
    }
    if (isConsultation && (await this.unfinishedConsultation(task.conversation_id)))
      return failure("consultation_unfinished");
    if (await this.pendingLimitReached(policy)) return failure("pending_limit_reached");
    const project = await this.db
      .selectFrom("projects")
      .select("document_language")
      .where("id", "=", task.project_id)
      .executeTakeFirstOrThrow();
    const reason = await this.connectionBlock(task.connection);
    const partial =
      !delegated &&
      (await this.db
        .selectFrom("messages")
        .select("id")
        .where("task_id", "=", task.id)
        .where("ending", "=", "partial")
        .executeTakeFirst());
    const latest =
      !delegated &&
      (await this.db
        .selectFrom("messages")
        .select("position")
        .where("conversation_id", "=", task.conversation_id)
        .orderBy("position", "desc")
        .executeTakeFirstOrThrow());
    const replacement = newId();
    if (contribution) {
      await reserveWork(this.db, contribution.intervention_id, contribution.id, policy, this.now);
      this.diagnostics.push({ event_name: "ohtia.work.reserved" });
    }
    await this.db
      .insertInto("tasks")
      .values({
        ...task,
        id: replacement,
        reply_position: null,
        replaces_task_id: task.id,
        accepted_by_operation_id: operationId,
        document_language: delegated ? task.document_language : project.document_language,
        input_through_position: latest && !partial ? latest.position : task.input_through_position,
        charge_warning_accepted_at: retry ? null : this.now,
        state: reason ? "blocked" : "queued",
        blocking_reason: reason,
        state_revision: 1,
        created_at: this.now,
        updated_at: this.now,
      })
      .execute();
    if (task.contribution_id) {
      await bindWork(this.db, task.contribution_id, replacement);
      const contribution = await this.db
        .updateTable("contributions")
        .set({ task_id: replacement, state: "active", failure_reason: null })
        .where("id", "=", task.contribution_id)
        .returning("intervention_id")
        .executeTakeFirstOrThrow();
      this.touchIntervention(contribution.intervention_id);
      if (task.kind === "contribution") {
        await this.planEvent(
          contribution.intervention_id,
          "contribution_started",
          {},
          task.contribution_id,
          replacement,
        );
        if (!(await this.advancePlan(contribution.intervention_id)))
          return failure("event_limit_reached");
      }
    }
    this.touch(task.conversation_id);
    if (retry && this.context.connections.read(task.connection)?.models?.length === 0)
      this.modelRefreshes.add(task.connection);
    return { ok: true, value: replacement };
  }
  async runningCount(): Promise<number> {
    const row = await this.db
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("state", "in", ["running", "cancelling"])
      .executeTakeFirstOrThrow();
    return row.count;
  }
  /** One transaction cancels pending work and records the same stopping intent as Stop. */
  async cancelAll(): Promise<void> {
    this.stopContinuationAdmission = true;
    await this.withdrawWaitingContinuations();
    await this.cancelUnstartedContributions();
    const tasks = await this.db
      .selectFrom("tasks")
      .select("id")
      .where("state", "in", ["queued", "blocked", "waiting_capacity", "running", "cancelling"])
      .execute();
    for (const task of tasks) {
      const result = await this.control("task.stop", task.id, "cancel-all", true);
      if (!result.ok) throw new Error("Task cancellation failed.");
    }
  }
  async stoppingAttempts(): Promise<readonly string[]> {
    const rows = await this.db
      .selectFrom("attempts")
      .select("id")
      .where("state", "=", "stopping")
      .where("service_generation", "=", this.context.generation)
      .execute();
    return rows.map((row) => identifier(row.id));
  }
  /** Recovery Retry never resumes provider work. The caller still owns the durable gate. */
  async recoverMigration(): Promise<void> {
    await this.recoverRestart(false);
  }
  /** Main has closed the old generation before admission. A permit is possible dispatch. */
  async recoverRestart(orderly: boolean): Promise<void> {
    this.restartingAfterCrash = !orderly;
    const heldContinuations = !orderly
      ? await this.db
          .updateTable("continuations")
          .set({ restart_held: 1 })
          .where("admission", "=", "waiting")
          .where("restart_held", "=", 0)
          .returning("intervention_id")
          .execute()
      : [];
    for (const row of heldContinuations) this.touchIntervention(row.intervention_id);
    const held = orderly
      ? []
      : await this.db
          .updateTable("contributions")
          .set({ restart_held: 1 })
          .where("intervention_id", "in", this.openPlans())
          .where("state", "in", ["waiting", "blocked"])
          .where("restart_held", "=", 0)
          .returning("intervention_id")
          .execute();
    for (const { intervention_id: id } of held) this.touchIntervention(id);
    const tasks = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("state", "in", ["queued", "blocked", "waiting_capacity", "running", "cancelling"])
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    for (const task of tasks) {
      if (
        task.state === "queued" ||
        task.state === "blocked" ||
        task.state === "waiting_capacity"
      ) {
        if (!orderly && task.blocking_reason !== "restart_paused")
          await this.change(task, {
            state: task.state === "waiting_capacity" ? task.state : "blocked",
            blocking_reason: "restart_paused",
          });
        continue;
      }
      const attempt = await this.db
        .selectFrom("attempts")
        .selectAll()
        .where("task_id", "=", task.id)
        .where("state", "in", ["prepared", "running", "waiting_user", "stopping"])
        .executeTakeFirstOrThrow();
      const cancelled = task.state === "cancelling";
      if (cancelled && task.kind === "contribution" && task.contribution_id) {
        const owner = await this.db
          .selectFrom("contributions")
          .select("intervention_id")
          .where("id", "=", task.contribution_id)
          .executeTakeFirstOrThrow();
        // Plan Stop already ended its plan. A stopping contribution in an open plan
        // can only be the durable intent left by Cancel work and quit.
        this.exitCancelledPlans.add(identifier(owner.intervention_id));
      }
      const dispatched = attempt.dispatch_permitted_at !== null;
      await this.db
        .updateTable("attempts")
        .set({
          state: cancelled || !dispatched ? "cancelled" : "uncertain",
          outcome_reason: cancelled ? "cancelled_by_researcher" : "service_restarted",
          finished_at: this.now,
          ...(!delegatedTask(task) || !dispatched ? unknownUsage : {}),
        })
        .where("id", "=", attempt.id)
        .execute();
      if (delegatedTask(task)) await this.settleDelegatedAttempt(attempt, dispatched);
      const policy = recordedOperationPolicy(task.operation, task.policy_version);
      const state: TaskState = cancelled
        ? "cancelled"
        : dispatched
          ? "uncertain"
          : task.kind === "reply" && (await this.waiting(task.conversation_id))
            ? "cancelled"
            : policy && attempt.attempt_number >= policy.max_attempts
              ? "failed"
              : policy && task.kind === "synthesis" && (await this.pendingLimitReached(policy))
                ? "waiting_capacity"
                : orderly
                  ? "queued"
                  : "blocked";
      await this.change(task, {
        state,
        blocking_reason:
          state === "blocked" || (state === "waiting_capacity" && !orderly)
            ? "restart_paused"
            : null,
      });
    }
    // Reconcile a synthetic plan missing its atomic continuation before admitting pending work.
    for (const plan of await acceptedPlans(this.db)
      .selectAll()
      .where(
        "id",
        "in",
        this.db
          .selectFrom("intervention_limits")
          .select("intervention_id")
          .where("policy", "=", "plan"),
      )
      .where("id", "not in", this.db.selectFrom("continuations").select("intervention_id"))
      .execute()) {
      if (plan.outcome === "complete" || plan.outcome === "partial")
        await this.recordContinuation(plan, plan.outcome);
      else if (!plan.outcome) this.changedPlans.set(identifier(plan.id), plan.id);
    }
    this.admitSynthesis = true;
    if (!orderly && (tasks.length || held.length || heldContinuations.length))
      this.diagnostics.push({ event_name: "ohtia.task.recovery_paused" });
  }
  /** Continue the shared recovery hold only after all current prerequisites are revalidated. */
  async continueAll(): Promise<void> {
    for (const task of await this.pending(true)) {
      if (task.blocking_reason !== "restart_paused") continue;
      // Explicit recovery continuation preserves the connection's plan pause across projects.
      const reason = (await this.usagePause(task.connection))
        ? "usage_limit_reached"
        : !operationPolicy(task.operation, task.policy_version, this.context.mode)
          ? "configuration_unavailable"
          : ((await this.connectionBlock(task.connection)) ??
            ((await this.valid(task)) ? null : "connection_disabled"));
      await this.change(task, {
        state: task.state === "waiting_capacity" ? task.state : reason ? "blocked" : "queued",
        blocking_reason: reason,
      });
    }
    const continued = await this.db
      .updateTable("contributions")
      .set({ restart_held: 0 })
      .where("restart_held", "=", 1)
      .returning("intervention_id")
      .execute();
    for (const { intervention_id: id } of continued) {
      this.touchIntervention(id);
      this.changedPlans.set(identifier(id), id);
    }
    for (const row of await this.db
      .updateTable("continuations")
      .set({ restart_held: 0 })
      .where("admission", "=", "waiting")
      .where("restart_held", "=", 1)
      .returning("intervention_id")
      .execute())
      this.touchIntervention(row.intervention_id);
    this.admitSynthesis = true;
    this.diagnostics.push({ event_name: "ohtia.task.continued" });
  }
  /** Capacity is read in the caller's transaction, using the dispatch admission rules. */
  private async capacity() {
    const preference = await this.db
      .selectFrom("application_preferences")
      .selectAll()
      .where("key", "=", "execution_limits")
      .executeTakeFirstOrThrow();
    const limits = JSON.parse(preference.value) as { max_concurrent_inference: number };
    const occupied = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("state", "in", ["running", "cancelling", "uncertain"])
      // ChatGPT and the development fake have no background work to quarantine after main
      // closes their connection. Keep the recorded outcome uncertain without occupying capacity.
      .where((eb) =>
        eb.or([
          eb("state", "!=", "uncertain"),
          eb(
            "connection",
            "not in",
            this.context.mode === "development" ? ["chatgpt", "fake"] : ["chatgpt"],
          ),
        ]),
      )
      .execute();
    return { limit: limits.max_concurrent_inference, occupied };
  }
  async waitingLimit(connection: string): Promise<number | null> {
    const { limit, occupied } = await this.capacity();
    if (occupied.length >= limit) return limit;
    const connectionLimit = Object.hasOwn(connectionInferenceLimits, connection)
      ? (connectionInferenceLimits[connection] ?? 1)
      : 1;
    return occupied.filter((other) => other.connection === connection).length >= connectionLimit
      ? connectionLimit
      : null;
  }
  /** Claim capacity and persist dispatch evidence. The caller sends only after COMMIT succeeds. */
  async prepareNext(): Promise<PreparedTask | null> {
    const { limit, occupied } = await this.capacity();
    if (occupied.length >= limit) return null;
    // A graph may have ready contributions waiting for its operation's pending-task budget.
    const plans = await this.db
      .selectFrom("contributions as c")
      .innerJoin("interventions as i", "i.id", "c.intervention_id")
      .select("i.id")
      .distinct()
      .where("i.kind", "=", "plan")
      .where("i.state", "=", "accepted")
      .where("i.outcome", "is", null)
      .where("c.state", "=", "waiting")
      .execute();
    for (const plan of plans) await this.advancePlan(plan.id);
    const candidates = await this.db
      .selectFrom("tasks")
      .innerJoin("command_receipts as r", "r.operation_id", "tasks.accepted_by_operation_id")
      .selectAll("tasks")
      .where("tasks.state", "in", ["queued", "blocked"])
      .orderBy((eb) =>
        eb
          .case()
          .when(
            eb.and([
              eb.or([
                eb.and([
                  eb("tasks.kind", "=", "reply"),
                  eb("tasks.operation", "=", "direct_guidance"),
                ]),
                eb("tasks.kind", "=", "consultation"),
              ]),
              eb.exists(
                unfinishedPlans(this.db).where(
                  "interventions.conversation_id",
                  "=",
                  eb.ref("tasks.conversation_id"),
                ),
              ),
            ]),
          )
          .then(0)
          .else(1)
          .end(),
      )
      .orderBy(sql`r.rowid`)
      .orderBy(sql`tasks.rowid`)
      .execute();
    const queuedConversations = new Set<string>();
    for (const task of candidates) {
      const conversationKey = identifier(task.conversation_id);
      if (task.kind === "reply" || task.kind === "consultation") {
        if (queuedConversations.has(conversationKey)) continue;
        queuedConversations.add(conversationKey);
      }
      if (task.state !== "queued") continue;
      if (
        (task.kind === "reply" || task.kind === "consultation") &&
        occupied.some(
          (other) =>
            Buffer.from(other.conversation_id).equals(Buffer.from(task.conversation_id)) &&
            (other.kind === "reply" || other.kind === "consultation") &&
            other.state !== "uncertain",
        )
      )
        continue;
      const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
      if (!policy || (delegatedTask(task) && !(await this.valid(task)))) {
        await this.change(task, { state: "blocked", blocking_reason: "configuration_unavailable" });
        continue;
      }
      if (
        !this.context.connections.available(task.connection) ||
        this.context.connections.awaitingModels(task.connection)
      )
        continue;
      // ChatGPT declares three concurrent requests. Other adapters retain the ADR-0011 default.
      const connectionLimit = Object.hasOwn(connectionInferenceLimits, task.connection)
        ? (connectionInferenceLimits[task.connection] ?? 1)
        : 1;
      if (
        occupied.filter((other) => other.connection === task.connection).length >= connectionLimit
      )
        continue;
      const previous = await this.db
        .selectFrom("attempts")
        .selectAll()
        .where("task_id", "=", task.id)
        .execute();
      const position = await nextPosition(this.db, task.conversation_id);
      const firstModel = this.context.connections.read(task.connection)?.models?.[0]?.id;
      const model = isProviderModelSlug(firstModel) ? firstModel : undefined;
      const conversation = await this.db
        .selectFrom("conversations")
        .selectAll()
        .where("id", "=", task.conversation_id)
        .executeTakeFirstOrThrow();
      const suggestTitle =
        task.kind === "reply" &&
        conversation.automatic_title_eligible === 1 &&
        conversation.title === null &&
        (task.operation === "project_setup"
          ? task.instruction_version >= 2
          : task.operation === "direct_guidance" &&
            // The setup conversation receives suggestions only during setup.
            !(await this.db
              .selectFrom("project_setup_proposals as p")
              .innerJoin("tasks as t", "t.id", "p.task_id")
              .select("p.id")
              .where("p.project_id", "=", task.project_id)
              .where("p.state", "=", "confirmed")
              .where("t.conversation_id", "=", task.conversation_id)
              .executeTakeFirst())) &&
        !(
          task.replaces_task_id &&
          (await this.db
            .selectFrom("attempts")
            .select("id")
            .where("task_id", "=", task.replaces_task_id)
            .where("conversation_title_policy", "=", conversationTitlePolicy.version)
            .where("outcome_reason", "=", "empty_reply")
            .executeTakeFirst())
        );
      const messages =
        task.input_through_position === null
          ? []
          : await this.db
              .selectFrom("messages")
              .leftJoin("tasks as origin", "origin.id", "messages.task_id")
              .selectAll("messages")
              .select("origin.kind as origin_kind")
              .where("messages.conversation_id", "=", task.conversation_id)
              .where("messages.position", "<=", task.input_through_position)
              .orderBy("messages.position")
              .execute();
      const agent = replyAgent(task.operation);
      const handoffs =
        task.kind === "reply" && task.input_through_position !== null
          ? await this.db
              .selectFrom("handoffs")
              .selectAll()
              .where("conversation_id", "=", task.conversation_id)
              .where("state", "=", "accepted")
              .where("position", "<", task.input_through_position)
              .orderBy("position")
              .execute()
          : [];
      const selections = handoffs.length
        ? await this.db
            .selectFrom("handoff_selected_messages as s")
            .innerJoin("handoffs as h", "h.id", "s.handoff_id")
            .select(["s.handoff_id", "s.message_id"])
            .where("h.conversation_id", "=", task.conversation_id)
            .execute()
        : [];
      const byId = new Map(messages.map((message) => [identifier(message.id), message]));
      const selectionsByHandoff = new Map<string, (typeof messages)[number][]>();
      for (const selection of selections) {
        const message = byId.get(identifier(selection.message_id));
        if (!message) continue;
        const reference = identifier(selection.handoff_id);
        const group = selectionsByHandoff.get(reference) ?? [];
        group.push(message);
        selectionsByHandoff.set(reference, group);
      }
      const inputMessages: InputMessage[] = [];
      const appendMessage = async (
        message: (typeof messages)[number],
        position = message.position,
        handoff?: InputMessage["handoff"],
      ) => {
        const outcome =
          message.ending === "partial" && message.task_id
            ? await this.db
                .selectFrom("attempts")
                .selectAll()
                .where("task_id", "=", message.task_id)
                .orderBy("attempt_number", "desc")
                .executeTakeFirst()
            : undefined;
        const otherAgent =
          message.author_kind === "agent" &&
          (message.origin_kind === "contribution" || message.agent_id !== agent);
        inputMessages.push({
          reference: identifier(message.id),
          position,
          ...(handoff ? { handoff } : {}),
          role:
            message.author_kind === "researcher" || otherAgent
              ? ("user" as const)
              : ("assistant" as const),
          text: otherAgent
            ? otherAgentInput(
                replyAgent(
                  message.agent_id === "josefa" ? "search_strategy_planning" : "direct_guidance",
                ),
                message.content,
              )
            : message.content,
          ...(message.ending === "partial"
            ? {
                partial: {
                  agent: agentName(message.agent_id),
                  reason: outcome?.outcome_reason ?? null,
                },
              }
            : {}),
        });
      };
      let segmentOwner = handoffs[0]?.from_agent_id ?? conversation.agent_id;
      let priorReply = false;
      let nextHandoff = 0;
      const appendBoundaries = async (through: number) => {
        for (let handoff = handoffs[nextHandoff]; handoff; handoff = handoffs[nextHandoff]) {
          if (handoff.position === null || handoff.position > through) break;
          nextHandoff++;
          // The handoff proposal can be Virgilio’s only reply in that part.
          if (handoff.from_agent_id === "virgilio") priorReply = true;
          segmentOwner = handoff.to_agent_id ?? segmentOwner;
          const segment = handoff.position;
          if (segmentOwner !== agent) continue;
          const reference = identifier(handoff.id);
          const selected = selectionsByHandoff.get(reference) ?? [];
          const context = handoffContext(handoff, priorReply, selected.length > 0);
          if (selected.length) {
            for (const message of selected.sort((a, b) => a.position - b.position))
              await appendMessage(message, segment, { reference, text: context });
          } else {
            inputMessages.push({
              position: segment,
              reference,
              role: "user",
              text: context,
              handoffMarker: true,
            });
          }
        }
      };
      for (const message of messages) {
        if (handoffs[nextHandoff]?.position !== undefined) await appendBoundaries(message.position);
        if (!handoffs.length || segmentOwner === agent) await appendMessage(message);
        if (
          segmentOwner === "virgilio" &&
          message.agent_id === "virgilio" &&
          (message.origin_kind === "reply" || message.origin_kind === "synthesis")
        )
          priorReply = true;
      }
      await appendBoundaries(Number.MAX_SAFE_INTEGER);
      const proposals =
        task.operation === "project_setup"
          ? await this.db
              .selectFrom("project_setup_proposals as p")
              .innerJoin("tasks as t", "t.id", "p.task_id")
              .selectAll("p")
              .select("t.reply_position")
              .where("t.conversation_id", "=", task.conversation_id)
              .orderBy("t.reply_position")
              .execute()
          : [];
      const notes: NonNullable<Parameters<typeof buildInput>[3]>[number][] = proposals.flatMap(
        (proposal) => {
          const text = setupNote(proposal);
          return text && proposal.reply_position !== null
            ? [
                {
                  position: proposal.reply_position,
                  reference: identifier(proposal.id),
                  revision: setupRevision(proposal),
                  text,
                },
              ]
            : [];
        },
      );
      const enabledConsultations =
        task.kind === "reply" &&
        task.operation === "direct_guidance" &&
        task.instruction_version >= 2
          ? consultableAgents(this.context.mode)
          : [];
      const planCapable =
        task.kind === "reply" &&
        task.operation === "direct_guidance" &&
        task.instruction_version >= 3;
      const activePlan =
        task.operation === "direct_guidance"
          ? await unfinishedPlan(this.db, task.conversation_id)
          : undefined;
      if (enabledConsultations.length || planCapable) {
        const consultations = await this.db
          .selectFrom("interventions as i")
          .innerJoin("attempts as a", "a.id", "i.proposed_by_attempt_id")
          .innerJoin("tasks as t", "t.id", "a.task_id")
          .leftJoin("contributions as c", (join) =>
            join.onRef("c.intervention_id", "=", "i.id").on("c.plan_key", "is", null),
          )
          .select([
            "i.id",
            "i.kind",
            "i.state",
            "i.invalid_reason",
            "i.revision",
            "t.reply_position",
            "c.agent_id",
          ])
          .where("i.conversation_id", "=", task.conversation_id)
          .where("i.kind", "in", planCapable ? ["consultation", "plan"] : ["consultation"])
          .orderBy("t.reply_position")
          .execute();
        for (const proposal of consultations) {
          if (proposal.reply_position === null) continue;
          const agent = enabledConsultations.find(({ id }) => id === proposal.agent_id);
          notes.push({
            kind: proposal.kind === "plan" ? "plan_proposal" : "consultation_proposal",
            position: proposal.reply_position,
            reference: identifier(proposal.id),
            revision: proposal.revision,
            text:
              proposal.kind === "plan"
                ? planProposalNote(proposal)
                : consultationNote(proposal, agent?.name ?? "Josefa"),
          });
        }
      }
      if (task.operation === "direct_guidance") {
        const handoffProposals = await this.db
          .selectFrom("handoffs as h")
          .innerJoin("attempts as a", "a.id", "h.proposed_by_attempt_id")
          .innerJoin("tasks as t", "t.id", "a.task_id")
          .select(["h.id", "h.state", "h.invalid_reason", "t.reply_position"])
          .where("h.conversation_id", "=", task.conversation_id)
          .where("h.state", "!=", "accepted")
          .orderBy("t.reply_position")
          .execute();
        for (const proposal of handoffProposals) {
          const text = handoffProposalNote(proposal);
          if (text && proposal.reply_position !== null)
            notes.push({
              kind: "handoff_proposal",
              position: proposal.reply_position,
              reference: identifier(proposal.id),
              revision: proposal.state === "proposed" || proposal.state === "invalid" ? 1 : 2,
              text,
            });
        }
      }
      const canHandoff =
        planCapable &&
        task.instruction_version >= 4 &&
        conversation.agent_id === "virgilio" &&
        !!(await this.destination(task.project_id, "josefa")) &&
        !(await handoffBusy(this.db, task.conversation_id, task.id));
      const contribution = task.contribution_id
        ? await this.db
            .selectFrom("contributions")
            .selectAll()
            .where("id", "=", task.contribution_id)
            .executeTakeFirstOrThrow()
        : undefined;
      const project = await this.db
        .selectFrom("projects")
        .selectAll()
        .where("id", "=", task.project_id)
        .executeTakeFirstOrThrow();
      const instructions =
        (task.kind === "contribution" ||
          task.operation === "direct_guidance" ||
          task.operation === "search_strategy_planning" ||
          task.operation === "contribution_synthesis") &&
        project.title !== null &&
        task.document_language !== null
          ? renderProjectInstructions(
              policy.instructions,
              {
                project_type: project.project_type,
                title: project.title,
                document_language: task.document_language,
              },
              {
                queryable_locations: "none in this version",
                consultable_agents: enabledConsultations
                  .map(
                    ({ id, name, role, capability }) => `- ${id}: ${name}, ${role}, ${capability}.`,
                  )
                  .join("\n"),
              },
            )
          : policy.instructions;
      const contributionInput =
        task.kind === "contribution" && contribution
          ? await planInput(this.db, contribution, policy)
          : undefined;
      if (task.kind === "contribution" && !contributionInput)
        throw new Error("Activated contribution lacks its validated input.");
      const owner =
        task.kind === "synthesis"
          ? await this.db
              .selectFrom("continuations")
              .select(["intervention_id", "reason", "graph_version"])
              .where("task_id", "=", task.id)
              .executeTakeFirstOrThrow()
          : undefined;
      const plan = owner ? await acceptedPlan(this.db, owner.intervention_id) : undefined;
      if (owner && !plan) throw new Error("Synthesis lacks its accepted plan.");
      const synthesis = plan && owner && task.operation === "contribution_synthesis";
      const baseInput = synthesis
        ? await synthesisInput(this.db, plan, owner, policy)
        : buildInput(
            policy,
            (plan ? await legacySynthesisInput(this.db, plan) : contributionInput) ??
              (contribution
                ? [
                    {
                      role: "user",
                      reference: identifier(contribution.id),
                      text: consultationInput(contribution.request),
                      transferKind: "consultation_request",
                    },
                  ]
                : inputMessages),
            {
              reference: identifier(conversation.id),
              revision: conversation.revision,
            },
            notes,
          );
      const built =
        baseInput && activePlan
          ? {
              input: [
                ...baseInput.input,
                { role: "user" as const, text: await planStatusNote(this.db, activePlan) },
              ],
              transfer: [
                ...baseInput.transfer,
                {
                  kind: "note" as const,
                  note: "plan_status" as const,
                  reference: identifier(activePlan.id),
                  revision: activePlan.revision,
                },
              ],
            }
          : baseInput;
      if (previous.length >= policy.max_attempts) {
        this.diagnostics.push({ event_name: "ohtia.task.failed" });
        await this.change(task, { state: "failed" });
        continue;
      }
      const exhausted =
        previous.filter((attempt) => attempt.dispatch_permitted_at !== null).length >=
        policy.max_work_units;
      const attemptId = newId();
      await this.db
        .insertInto("attempts")
        .values({
          id: attemptId,
          task_id: task.id,
          attempt_number: previous.length + 1,
          service_generation: this.context.generation,
          state: "prepared",
          outcome_reason: null,
          requested_model: null,
          observed_model: null,
          dispatch_permitted_at: null,
          transfer_manifest: null,
          provider_request_id: null,
          ...unknownUsage,
          created_at: this.now,
          started_at: null,
          finished_at: null,
        })
        .execute();
      if (!model || !built || exhausted) {
        const reason =
          synthesis && !built
            ? "input_too_large"
            : !model
              ? "provider_unavailable"
              : !built
                ? "invalid_output"
                : "permit_expired";
        await this.db
          .updateTable("attempts")
          .set({ state: "failed", outcome_reason: reason, finished_at: this.now })
          .where("id", "=", attemptId)
          .execute();
        if (delegatedTask(task))
          await this.settleDelegatedAttempt(
            { id: attemptId, task_id: task.id, attempt_number: previous.length + 1 },
            false,
          );
        this.diagnostics.push({ event_name: "ohtia.task.failed" });
        if (synthesis && task.reply_position === null)
          await this.change(task, { state: "failed", reply_position: position });
        else await this.change(task, { state: "failed" });
        continue;
      }
      await this.change(task, {
        state: "running",
        reply_position: task.reply_position ?? position,
      });
      await this.db
        .updateTable("attempts")
        .set({
          state: "running",
          requested_model: model,
          dispatch_permitted_at: this.now,
          transfer_manifest: JSON.stringify(built.transfer),
          conversation_title_policy: suggestTitle ? conversationTitlePolicy.version : null,
          started_at: this.now,
        })
        .where("id", "=", attemptId)
        .execute();
      this.diagnostics.push({ event_name: "ohtia.task.dispatch_permitted" });
      return {
        kind: task.kind,
        transfer: built.transfer,
        acceptedByOperationId: task.accepted_by_operation_id,
        taskId: identifier(task.id),
        dispatch: {
          kind: "provider_dispatch",
          version: providerMessageVersion,
          generation: this.context.generation,
          request: {
            attempt: identifier(attemptId),
            operation: policy.operation,
            connection: task.connection,
            model,
            instructions: suggestTitle
              ? instructions + conversationTitleInstructionSuffix(policy.operation)
              : instructions,
            input: built.input,
            tools: [
              ...(task.operation === "project_setup" ? [setupTool] : []),
              ...(!activePlan && enabledConsultations.length
                ? [
                    consultationTool(enabledConsultations),
                    ...(planCapable ? [planTool(enabledConsultations)] : []),
                  ]
                : []),
              ...(canHandoff ? [handoffTool] : []),
              ...(suggestTitle ? [conversationTitleTool] : []),
            ],
            project: identifier(task.project_id),
            policy_version: task.policy_version,
            instruction_version: task.instruction_version,
            document_language: task.document_language,
            limits: {
              max_output_bytes: policy.max_output_bytes,
              max_attempt_duration_ms: policy.max_attempt_duration_ms,
              max_inactivity_ms: policy.max_inactivity_ms,
            },
          },
          permit: {
            id: randomUUID(),
            attempt: identifier(attemptId),
            issued_at: Date.parse(this.now),
          },
        },
      };
    }
    return null;
  }
  async event(
    attemptId: string,
    event: ProviderEvent,
    text: string,
    calls: readonly ProviderToolCall[] = [],
    registry?: () => LanguageRegistry,
    work?: ProviderWorkUsage,
  ): Promise<RecordedTaskEvent> {
    const attempt = await this.db
      .selectFrom("attempts")
      .selectAll()
      .where("id", "=", bytes(attemptId))
      .executeTakeFirst();
    if (
      !attempt ||
      attempt.service_generation !== this.context.generation ||
      !["prepared", "running", "waiting_user", "stopping"].includes(attempt.state)
    )
      return { recorded: false };
    const task = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("id", "=", attempt.task_id)
      .executeTakeFirstOrThrow();
    if (task.state !== "running" && task.state !== "cancelling") return { recorded: false };
    if (event.type === "text" || event.type === "activity" || event.type === "tool_call")
      return { recorded: task.state === "running" };
    if (event.type === "started") {
      await this.db
        .updateTable("attempts")
        .set({
          observed_model: event.model ?? attempt.observed_model,
          provider_request_id: event.provider_request_id,
        })
        .where("id", "=", attempt.id)
        .execute();
      await this.change(task, {});
      return { recorded: true };
    }
    if (event.type === "usage") {
      await this.db.updateTable("attempts").set(event.usage).where("id", "=", attempt.id).execute();
      await this.change(task, {});
      return { recorded: true };
    }
    // Stop won the committed revision: even an already queued successful result can only
    // acknowledge cessation. Keep received partial text, never publish it as a complete reply.
    const accepted = task.operation === "project_setup" ? acceptedSetupCalls(calls) : [];
    let handoff =
      task.kind === "reply" && task.operation === "direct_guidance" && task.instruction_version >= 4
        ? readHandoffProposal(calls, !!(await this.destination(task.project_id, "josefa")))
        : undefined;
    if (
      handoff &&
      !("invalid" in handoff) &&
      (await handoffBusy(this.db, task.conversation_id, task.id))
    )
      handoff = { invalid: "conversation_busy" };
    const proposedPlan =
      !handoff && task.operation === "direct_guidance" && task.instruction_version >= 3
        ? readPlanProposal(calls, identifier(task.conversation_id))
        : undefined;
    const consultation =
      !handoff &&
      !proposedPlan &&
      task.operation === "direct_guidance" &&
      task.instruction_version >= 2
        ? decodeConsultationProposal(calls, this.context.mode)
        : undefined;
    const result: ProviderResult =
      task.state === "cancelling"
        ? (task.kind === "contribution" || task.kind === "synthesis") &&
          event.result.status === "uncertain"
          ? event.result
          : { status: "cancelled" }
        : event.result.status === "completed" &&
            !text &&
            !accepted.length &&
            !consultation &&
            !proposedPlan &&
            !handoff
          ? { status: "failed", reason: "empty_reply", dispatched: true }
          : event.result;
    const notDispatched =
      (result.status === "failed" && !result.dispatched) ||
      (delegatedTask(task) &&
        ((event.result.status === "failed" && !event.result.dispatched) ||
          work?.dispatched === false));
    let state: AttemptState = result.status;
    const reason: AttemptReason | null =
      result.status === "failed" || result.status === "uncertain"
        ? result.reason
        : result.status === "cancelled"
          ? "cancelled_by_researcher"
          : null;
    if (
      notDispatched &&
      result.status === "failed" &&
      ["permit_expired", "connection_expired"].includes(result.reason)
    )
      state = "cancelled";
    await this.db
      .updateTable("attempts")
      .set({
        state,
        outcome_reason: reason,
        finished_at: this.now,
        ...(notDispatched ? { dispatch_permitted_at: null } : {}),
        ...((
          delegatedTask(task)
            ? notDispatched
            : state === "cancelled" ||
              state === "uncertain" ||
              reason === "deadline_exceeded" ||
              reason === "inactivity_timeout" ||
              reason === "output_limit_exceeded"
        )
          ? unknownUsage
          : {}),
      })
      .where("id", "=", attempt.id)
      .execute();
    if (delegatedTask(task))
      await this.settleDelegatedAttempt(
        attempt,
        !notDispatched && attempt.dispatch_permitted_at !== null,
        event.result.status === "uncertain" ? undefined : work,
      );
    const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
    const canReturnToPending = policy && attempt.attempt_number < policy.max_attempts;
    let taskState: TaskState =
      state === "completed"
        ? "completed"
        : state === "uncertain"
          ? "uncertain"
          : state === "cancelled"
            ? "cancelled"
            : "failed";
    let blockingReason: BlockingReason | null = null;
    if (
      notDispatched &&
      result.status === "failed" &&
      (result.reason === "permit_expired" || result.reason === "connection_expired")
    ) {
      const disconnected = result.reason === "connection_expired";
      if (task.kind === "reply" && (await this.waiting(task.conversation_id)))
        taskState = "cancelled";
      else if (!canReturnToPending) taskState = "failed";
      else {
        taskState =
          task.kind === "synthesis" && (await this.pendingLimitReached(policy))
            ? "waiting_capacity"
            : disconnected
              ? "blocked"
              : "queued";
        if (disconnected) blockingReason = "connection_disabled";
      }
    }
    if (reason === "usage_limit_reached" && task.connection === "chatgpt") {
      if (!(await this.usagePause(task.connection))) {
        await this.db
          .insertInto("usage_limit_pauses")
          .values({
            id: newId(),
            connection: "chatgpt",
            source_attempt_id: attempt.id,
            paused_at: this.now,
            resumed_at: null,
            resumed_by_operation_id: null,
          })
          .execute();
        this.diagnostics.push({ event_name: "ohtia.usage_pause.opened" });
      }
    }
    let savedReplyAgent: ReplyAgent | undefined;
    if (text && !notDispatched) {
      if (task.reply_position === null) throw new Error("Running task lacks a reply reservation.");
      const contributor =
        task.kind === "contribution" && task.contribution_id
          ? await this.db
              .selectFrom("contributions")
              .select("agent_id")
              .where("id", "=", task.contribution_id)
              .executeTakeFirstOrThrow()
          : undefined;
      const agentId = contributor?.agent_id ?? replyAgent(task.operation);
      await this.db
        .insertInto("messages")
        .values({
          id: newId(),
          conversation_id: task.conversation_id,
          position: task.reply_position,
          author_kind: "agent",
          agent_id: agentId,
          content: text,
          task_id: task.id,
          ending: state === "completed" ? "complete" : "partial",
          created_at: this.now,
        })
        .execute();
      savedReplyAgent = agentId;
      if (task.kind !== "synthesis")
        await this.replaceWaiting(
          task.conversation_id,
          task.kind !== "reply" ? task.reply_position : undefined,
        );
    }
    if (
      result.status === "completed" &&
      (task.operation === "direct_guidance" || task.operation === "project_setup") &&
      attempt.conversation_title_policy === conversationTitlePolicy.version &&
      validConversationTitle(result.conversation_title) &&
      policy &&
      utf8Size(text) + utf8Size(result.conversation_title) <= policy.max_output_bytes
    ) {
      this.titleSuggestion = {
        conversation: identifier(task.conversation_id),
        title: result.conversation_title,
        attemptId: attempt.id,
      };
    }
    let proposalId: string | undefined;
    let savedProposal = false;
    if (state === "completed" && accepted[0]) {
      if (!registry) throw new Error("Setup registry unavailable.");
      const values = accepted[0];
      const invalid = accepted.length > 1 ? "multiple_calls" : setupInvalidReason(values, registry);
      if (!invalid)
        await this.db
          .updateTable("project_setup_proposals")
          .set({ state: "replaced", decided_at: this.now, decided_by_operation_id: null })
          .where("project_id", "=", task.project_id)
          .where("state", "=", "proposed")
          .execute();
      const proposalIdentity = newId();
      proposalId = identifier(proposalIdentity);
      await this.db
        .insertInto("project_setup_proposals")
        .values({
          id: proposalIdentity,
          project_id: task.project_id,
          task_id: task.id,
          attempt_id: attempt.id,
          ...values,
          title: setupTextProjection(values.title),
          document_language: setupTextProjection(values.document_language),
          state: invalid ? "invalid" : "proposed",
          invalid_reason: invalid,
          created_at: this.now,
          decided_at: null,
          decided_by_operation_id: null,
        })
        .execute();
      savedProposal = true;
      this.diagnostics.push({ event_name: "ohtia.project.setup_proposed" });
      // A tool-only reply changes the next queued task's input as well as a textual reply.
      if (!text) await this.replaceWaiting(task.conversation_id);
    }
    if (state === "completed" && handoff) {
      if (!("invalid" in handoff)) await replaceHandoff(this.db, task.conversation_id, this.now);
      const { owner_revision } = await this.db
        .selectFrom("conversations")
        .select("owner_revision")
        .where("id", "=", task.conversation_id)
        .executeTakeFirstOrThrow();
      await saveHandoffProposal(
        this.db,
        task.conversation_id,
        attempt.id,
        owner_revision,
        handoff,
        this.now,
      );
      savedProposal = true;
      this.diagnostics.push({ event_name: "ohtia.handoff.proposed" });
      if (!text) await this.replaceWaiting(task.conversation_id);
    }
    if (state === "completed" && consultation) {
      const invalid = "invalid" in consultation ? consultation.invalid : null;
      const id = newId();
      if (!invalid) {
        await replaceHandoff(this.db, task.conversation_id, this.now);
        await this.db
          .updateTable("interventions")
          .set({ state: "replaced", decided_at: this.now, revision: sql`revision+1` })
          .where("state", "=", "proposed")
          .where("conversation_id", "=", task.conversation_id)
          .execute();
      }
      await this.db
        .insertInto("interventions")
        .values({
          id,
          project_id: task.project_id,
          conversation_id: task.conversation_id,
          kind: "consultation",
          proposed_by_attempt_id: attempt.id,
          invalid_reason: invalid,
          state: invalid ? "invalid" : "proposed",
          created_at: this.now,
          decided_at: invalid ? this.now : null,
          decided_by_operation_id: null,
          revision: 1,
        })
        .execute();
      if ("values" in consultation)
        await this.db
          .insertInto("contributions")
          .values({
            ...consultation.values,
            dedupe_key: contributionKey(
              consultation.values.agent_id,
              consultation.values.operation,
              2,
              consultation.values.request,
              [],
            ),
            id: newId(),
            intervention_id: id,
            task_id: null,
            created_at: this.now,
          })
          .execute();
      savedProposal = true;
      this.diagnostics.push({ event_name: "ohtia.consultation.proposed" });
      if (!text) await this.replaceWaiting(task.conversation_id);
    }
    if (state === "completed" && proposedPlan) {
      let invalid = "invalid" in proposedPlan ? proposedPlan.invalid : undefined;
      if (
        invalid !== "multiple_calls" &&
        ((await unfinishedPlan(this.db, task.conversation_id)) ||
          (await this.db
            .selectFrom("interventions")
            .select("id")
            .where("conversation_id", "=", task.conversation_id)
            .where("approved_during_attempt_id", "=", attempt.id)
            .executeTakeFirst()) ||
          (JSON.parse(attempt.transfer_manifest ?? "[]") as TransferEntry[]).some(
            (entry) => entry.kind === "note" && entry.note === "plan_status",
          ))
      )
        invalid = "plan_unfinished";
      if (!invalid && "payload" in proposedPlan) {
        const saved = await addContributions(
          this.db,
          proposedPlan.payload,
          this.context.mode,
          (agent) => this.agentConnection(agent),
          task.accepted_by_operation_id,
          this.now,
          { kind: "proposal", attempt: attempt.id },
        );
        if (saved.ok) await replaceHandoff(this.db, task.conversation_id, this.now);
        else invalid = planInvalidReason(saved.error.code);
      }
      if (invalid)
        await this.db
          .insertInto("interventions")
          .values({
            id: newId(),
            project_id: task.project_id,
            conversation_id: task.conversation_id,
            kind: "plan",
            proposed_by_attempt_id: attempt.id,
            invalid_reason: invalid,
            state: "invalid",
            created_at: this.now,
            decided_at: this.now,
            decided_by_operation_id: null,
            revision: 1,
          })
          .execute();
      savedProposal = true;
      this.diagnostics.push({ event_name: "ohtia.plan.proposed" });
      if (!text) await this.replaceWaiting(task.conversation_id);
    }
    // A proposal or its validation notice can be the whole reply.
    // Save one event when the turn includes both text and a proposal.
    if (savedReplyAgent || (savedProposal && !notDispatched))
      this.finishedReplies.push({
        kind: "replyFinished",
        projectId: identifier(task.project_id),
        conversationId: identifier(task.conversation_id),
        agentId: savedReplyAgent ?? replyAgent(task.operation),
      });
    await this.change(task, { state: taskState, blocking_reason: blockingReason });
    if (reason === "usage_limit_reached" && task.connection === "chatgpt")
      await this.reconcileConnections();
    this.diagnostics.push({
      event_name:
        taskState === "completed"
          ? "ohtia.task.completed"
          : taskState === "uncertain"
            ? "ohtia.task.uncertain"
            : taskState === "blocked" || taskState === "waiting_capacity"
              ? "ohtia.task.blocked"
              : taskState === "queued"
                ? "ohtia.task.readmitted"
                : taskState === "cancelled"
                  ? "ohtia.task.cancelled"
                  : "ohtia.task.failed",
    });
    return { recorded: true, result, ...(proposalId ? { proposalId } : {}) };
  }
}

export async function nextPosition(
  db: Kysely<ResearchSchema>,
  conversation: Uint8Array,
): Promise<number> {
  const result = await sql<{ position: number }>`SELECT max(
    coalesce((SELECT max(position) FROM messages WHERE conversation_id=${conversation}),0),
    coalesce((SELECT max(reply_position) FROM tasks WHERE conversation_id=${conversation}),0),
    coalesce((SELECT max(position) FROM handoffs WHERE conversation_id=${conversation}),0))+1 AS position`.execute(
    db,
  );
  const position = result.rows[0]?.position;
  if (position === undefined) throw new Error("Message positions unavailable.");
  if (!Number.isSafeInteger(position)) throw new Error("Message positions exhausted.");
  return position;
}

function agentName(id: string | null): string {
  const names: Readonly<Record<string, string>> = {
    virgilio: "Virgilio",
    josefa: "Josefa",
    "jorge-luis": "Jorge Luis",
    erasmus: "Erasmus",
    boris: "Boris",
    maria: "María",
    thomas: "Thomas",
  };
  const name = id && Object.hasOwn(names, id) ? names[id] : undefined;
  if (!name) throw new Error("Unknown message agent.");
  return name;
}
