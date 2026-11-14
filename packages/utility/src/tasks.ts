import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import {
  type Outcome,
  type ProviderDispatchMessage,
  type ProviderEvent,
  type ProviderResult,
  type ProviderUsage,
  type TransferEntry,
  type ServiceConnections,
  failure,
  connectionInferenceLimits,
  isProviderModelSlug,
  type DiagnosticEvent,
  providerMessageVersion,
} from "@ohtia/contracts";
import { bytes, identifier, newId, type ResearchSchema } from "./research.js";
import { buildInput, operationPolicy } from "./operations.js";
export type RuntimeMode = "development" | "installed" | "qualification";

export type TaskState =
  | "queued"
  | "blocked"
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
  | "permit_expired"
  | "inactivity_timeout"
  | "deadline_exceeded"
  | "cancelled_by_researcher"
  | "service_restarted";
export interface TaskRow {
  id: Uint8Array;
  project_id: Uint8Array;
  conversation_id: Uint8Array;
  input_through_position: number;
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
  { readonly recorded: false } | { readonly recorded: true; readonly result?: ProviderResult };

export interface UsagePauseRow {
  id: Uint8Array;
  connection: "chatgpt";
  source_attempt_id: Uint8Array;
  paused_at: string;
  resumed_at: string | null;
  resumed_by_operation_id: string | null;
}
export interface TaskSchema {
  usage_limit_pauses: UsagePauseRow;
  tasks: TaskRow;
  attempts: AttemptRow;
  application_preferences: { key: string; schema_version: number; revision: number; value: string };
}
export const unknownUsage: ProviderUsage = Object.freeze({
  input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
});
export interface PreparedTask {
  readonly dispatch: ProviderDispatchMessage;
  readonly transfer: readonly TransferEntry[];
  readonly acceptedByOperationId: string;
  readonly taskId: string;
}
export interface TaskContext {
  readonly mode: RuntimeMode;
  readonly generation: string;
  readonly connections: ServiceConnections;
}
/** One instance belongs to one short database transaction. It never sends a provider request. */
export class TaskTransaction {
  readonly diagnostics: DiagnosticEvent[] = [];
  private readonly conversations = new Map<string, Uint8Array>();
  constructor(
    private readonly db: Kysely<ResearchSchema>,
    readonly context: TaskContext,
    private readonly now = new Date().toISOString(),
  ) {}
  touch(conversation: Uint8Array): void {
    this.conversations.set(identifier(conversation), conversation);
  }
  async flush(): Promise<void> {
    for (const id of this.conversations.values())
      await this.db
        .updateTable("conversations")
        .set({ revision: sql`revision+1` })
        .where("id", "=", id)
        .execute();
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
  }
  /** Later operation stories extend routing when their policies become available. */
  async admission(
    projectId: Uint8Array,
    conversationId: Uint8Array | null,
    content: string,
  ): Promise<Outcome<null>> {
    const project = await this.db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", projectId)
      .executeTakeFirstOrThrow();
    if (!project.is_development) return { ok: true, value: null };
    const policy = operationPolicy("development_test", 1, this.context.mode);
    if (!policy) return failure("service_unavailable");
    if (Buffer.byteLength(content, "utf8") > policy.max_input_bytes)
      return failure("input_too_large");
    const pending = conversationId ? await this.waiting(conversationId) : undefined;
    const count = await this.db
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("operation", "=", policy.operation)
      .where("state", "in", ["queued", "blocked"])
      .executeTakeFirstOrThrow();
    if (!pending && count.count >= policy.max_pending_tasks)
      return failure("pending_limit_reached");
    return { ok: true, value: null };
  }
  private waiting(conversation: Uint8Array) {
    return this.db
      .selectFrom("tasks")
      .selectAll()
      .where("conversation_id", "=", conversation)
      .where("state", "in", ["queued", "blocked"])
      .executeTakeFirst();
  }
  async accept(
    projectId: Uint8Array,
    conversationId: Uint8Array,
    position: number,
    operationId: string,
  ): Promise<void> {
    const project = await this.db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", projectId)
      .executeTakeFirstOrThrow();
    this.touch(conversationId);
    if (!project.is_development) return;
    this.diagnostics.push({ event_name: "ohtia.task.accepted" });
    const policy = operationPolicy("development_test", 1, this.context.mode);
    if (!policy) throw new Error("Task policy unavailable.");
    const old = await this.waiting(conversationId);
    const reason = old?.blocking_reason ?? (await this.connectionBlock("chatgpt"));
    if (old) await this.change(old, { state: "cancelled", blocking_reason: null });
    await this.db
      .insertInto("tasks")
      .values({
        id: newId(),
        project_id: projectId,
        conversation_id: conversationId,
        input_through_position: position,
        reply_position: null,
        operation: policy.operation,
        policy_version: policy.version,
        instruction_version: policy.instruction_version,
        connection: "chatgpt",
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
  private async replaceWaiting(conversation: Uint8Array): Promise<void> {
    const old = await this.waiting(conversation);
    if (!old) return;
    const reason = old.blocking_reason ?? (await this.connectionBlock(old.connection));
    await this.change(old, { state: "cancelled", blocking_reason: null });
    await this.db
      .insertInto("tasks")
      .values({
        ...old,
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
  /** Revalidate the released operation's authority and immutable inputs without changing its scope. */
  private async valid(task: TaskRow): Promise<boolean> {
    const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
    if (
      !policy ||
      policy.instruction_version !== task.instruction_version ||
      task.connection !== "chatgpt"
    )
      return false;
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
    const message = await this.db
      .selectFrom("messages")
      .select("id")
      .where("conversation_id", "=", task.conversation_id)
      .where("position", "=", task.input_through_position)
      .executeTakeFirst();
    return (
      !!project?.is_development &&
      !!message &&
      !!receipt &&
      ["conversation.start", "message.append", "task.startAgain"].includes(receipt.command)
    );
  }
  private pending() {
    return this.db
      .selectFrom("tasks")
      .selectAll()
      .where("state", "in", ["queued", "blocked"])
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
  async control(
    command: "task.stop" | "task.startAgain",
    id: Uint8Array,
    operationId: string,
  ): Promise<Outcome<Uint8Array>> {
    const task = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!task) return failure("record_not_found");
    if (command === "task.stop") {
      if (task.state === "queued" || task.state === "blocked") {
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
              ...unknownUsage,
            })
            .where("id", "=", attempt.id)
            .execute();
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
    if (task.state !== "uncertain") return failure("task_not_retryable");
    // rowid expresses actual acceptance order even if the wall clock moves backwards.
    const newer = await this.db
      .selectFrom("tasks")
      .select("id")
      .where("conversation_id", "=", task.conversation_id)
      .where(sql<boolean>`rowid > (SELECT rowid FROM tasks WHERE id=${task.id})`)
      .executeTakeFirst();
    if (newer) return failure("newer_task_exists");
    const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
    if (!policy) return failure("service_unavailable");
    const pending = await this.db
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("operation", "=", task.operation)
      .where("state", "in", ["queued", "blocked"])
      .executeTakeFirstOrThrow();
    if (pending.count >= policy.max_pending_tasks) return failure("pending_limit_reached");
    const project = await this.db
      .selectFrom("projects")
      .select("document_language")
      .where("id", "=", task.project_id)
      .executeTakeFirstOrThrow();
    const reason = await this.connectionBlock(task.connection);
    const replacement = newId();
    await this.db
      .insertInto("tasks")
      .values({
        ...task,
        id: replacement,
        reply_position: null,
        replaces_task_id: task.id,
        accepted_by_operation_id: operationId,
        document_language: project.document_language,
        charge_warning_accepted_at: this.now,
        state: reason ? "blocked" : "queued",
        blocking_reason: reason,
        state_revision: 1,
        created_at: this.now,
        updated_at: this.now,
      })
      .execute();
    this.touch(task.conversation_id);
    return { ok: true, value: replacement };
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
    const tasks = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("state", "in", ["queued", "blocked", "running", "cancelling"])
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    for (const task of tasks) {
      if (task.state === "queued" || task.state === "blocked") {
        if (task.blocking_reason !== "restart_paused")
          await this.change(task, { state: "blocked", blocking_reason: "restart_paused" });
        continue;
      }
      const attempt = await this.db
        .selectFrom("attempts")
        .selectAll()
        .where("task_id", "=", task.id)
        .where("state", "in", ["prepared", "running", "waiting_user", "stopping"])
        .executeTakeFirstOrThrow();
      const cancelled = task.state === "cancelling";
      const dispatched = attempt.dispatch_permitted_at !== null;
      await this.db
        .updateTable("attempts")
        .set({
          state: cancelled || !dispatched ? "cancelled" : "uncertain",
          outcome_reason: cancelled ? "cancelled_by_researcher" : "service_restarted",
          finished_at: this.now,
          ...unknownUsage,
        })
        .where("id", "=", attempt.id)
        .execute();
      const project = await this.db
        .selectFrom("projects")
        .select("is_development")
        .where("id", "=", task.project_id)
        .executeTakeFirstOrThrow();
      const policy = operationPolicy(
        task.operation,
        task.policy_version,
        project.is_development ? "development" : "installed",
      );
      const state: TaskState = cancelled
        ? "cancelled"
        : dispatched
          ? "uncertain"
          : (await this.waiting(task.conversation_id))
            ? "cancelled"
            : policy && attempt.attempt_number >= policy.max_attempts
              ? "failed"
              : "blocked";
      await this.change(task, {
        state,
        blocking_reason: state === "blocked" ? "restart_paused" : null,
      });
    }
    if (tasks.length) this.diagnostics.push({ event_name: "ohtia.task.recovery_paused" });
  }
  /** Continue the shared recovery hold only after all current prerequisites are revalidated. */
  async continueAll(): Promise<void> {
    for (const task of await this.pending()) {
      if (task.blocking_reason !== "restart_paused") continue;
      // Explicit recovery continuation preserves the connection's plan pause across projects.
      const reason = (await this.usagePause(task.connection))
        ? "usage_limit_reached"
        : !operationPolicy(task.operation, task.policy_version, this.context.mode)
          ? "configuration_unavailable"
          : ((await this.connectionBlock(task.connection)) ??
            ((await this.valid(task)) ? null : "connection_disabled"));
      await this.change(task, { state: reason ? "blocked" : "queued", blocking_reason: reason });
    }
    this.diagnostics.push({ event_name: "ohtia.task.continued" });
  }
  /** Claim capacity and persist dispatch evidence. The caller sends only after COMMIT succeeds. */
  async prepareNext(): Promise<PreparedTask | null> {
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
      // ChatGPT has no background execution or cancellation endpoint. Every final event is
      // delivered after main has closed the connection; restart recovery closes old generations.
      .where((eb) => eb.or([eb("state", "!=", "uncertain"), eb("connection", "!=", "chatgpt")]))
      .execute();
    if (occupied.length >= limits.max_concurrent_inference) return null;
    const candidates = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("state", "=", "queued")
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    for (const task of candidates) {
      if (
        occupied.some(
          (other) =>
            Buffer.from(other.conversation_id).equals(Buffer.from(task.conversation_id)) &&
            other.state !== "uncertain",
        )
      )
        continue;
      const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
      if (!policy) {
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
      const messages = await this.db
        .selectFrom("messages")
        .selectAll()
        .where("conversation_id", "=", task.conversation_id)
        .where("position", "<=", task.input_through_position)
        .orderBy("position")
        .execute();
      const inputMessages = [];
      for (const message of messages) {
        const outcome =
          message.ending === "partial" && message.task_id
            ? await this.db
                .selectFrom("attempts")
                .selectAll()
                .where("task_id", "=", message.task_id)
                .orderBy("attempt_number", "desc")
                .executeTakeFirst()
            : undefined;
        inputMessages.push({
          reference: identifier(message.id),
          role: message.author_kind === "researcher" ? ("user" as const) : ("assistant" as const),
          text: message.content,
          ...(message.ending === "partial"
            ? {
                partial: {
                  agent: agentName(message.agent_id),
                  reason: outcome?.outcome_reason ?? null,
                },
              }
            : {}),
        });
      }
      const built = buildInput(policy, inputMessages, {
        reference: identifier(conversation.id),
        revision: conversation.revision,
      });
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
        const reason = !model
          ? "provider_unavailable"
          : !built
            ? "invalid_output"
            : "permit_expired";
        await this.db
          .updateTable("attempts")
          .set({ state: "failed", outcome_reason: reason, finished_at: this.now })
          .where("id", "=", attemptId)
          .execute();
        this.diagnostics.push({ event_name: "ohtia.task.failed" });
        await this.change(task, { state: "failed" });
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
          started_at: this.now,
        })
        .where("id", "=", attemptId)
        .execute();
      this.diagnostics.push({ event_name: "ohtia.task.dispatch_permitted" });
      return {
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
            instructions: policy.instructions,
            input: built.input,
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
  async event(attemptId: string, event: ProviderEvent, text: string): Promise<RecordedTaskEvent> {
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
    if (event.type === "text" || event.type === "activity")
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
    const result: ProviderResult =
      task.state === "cancelling"
        ? { status: "cancelled" }
        : event.result.status === "completed" && !text
          ? { status: "failed", reason: "empty_reply", dispatched: true }
          : event.result;
    const notDispatched = result.status === "failed" && !result.dispatched;
    let state: AttemptState = result.status;
    const reason: AttemptReason | null =
      result.status === "failed" || result.status === "uncertain"
        ? result.reason
        : result.status === "cancelled"
          ? "cancelled_by_researcher"
          : null;
    if (notDispatched && ["permit_expired", "connection_expired"].includes(result.reason))
      state = "cancelled";
    await this.db
      .updateTable("attempts")
      .set({
        state,
        outcome_reason: reason,
        finished_at: this.now,
        ...(notDispatched ? { dispatch_permitted_at: null } : {}),
        ...(state === "cancelled" ||
        state === "uncertain" ||
        reason === "deadline_exceeded" ||
        reason === "inactivity_timeout" ||
        reason === "output_limit_exceeded"
          ? unknownUsage
          : {}),
      })
      .where("id", "=", attempt.id)
      .execute();
    const policy = operationPolicy(task.operation, task.policy_version, this.context.mode);
    let taskState: TaskState =
      state === "completed"
        ? "completed"
        : state === "uncertain"
          ? "uncertain"
          : state === "cancelled"
            ? "cancelled"
            : "failed";
    if (notDispatched && result.reason === "permit_expired")
      taskState = (await this.waiting(task.conversation_id))
        ? "cancelled"
        : policy && attempt.attempt_number < policy.max_attempts
          ? "queued"
          : "failed";
    let blockingReason: BlockingReason | null = null;
    if (notDispatched && result.reason === "connection_expired") {
      taskState = (await this.waiting(task.conversation_id))
        ? "cancelled"
        : policy && attempt.attempt_number < policy.max_attempts
          ? "blocked"
          : "failed";
      if (taskState === "blocked") blockingReason = "connection_disabled";
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
    if (text && !notDispatched) {
      if (task.reply_position === null) throw new Error("Running task lacks a reply reservation.");
      await this.db
        .insertInto("messages")
        .values({
          id: newId(),
          conversation_id: task.conversation_id,
          position: task.reply_position,
          author_kind: "agent",
          agent_id: "virgilio",
          content: text,
          task_id: task.id,
          ending: state === "completed" ? "complete" : "partial",
          created_at: this.now,
        })
        .execute();
      await this.replaceWaiting(task.conversation_id);
    }
    await this.change(task, { state: taskState, blocking_reason: blockingReason });
    if (reason === "usage_limit_reached" && task.connection === "chatgpt")
      await this.reconcileConnections();
    this.diagnostics.push({
      event_name:
        taskState === "completed"
          ? "ohtia.task.completed"
          : taskState === "uncertain"
            ? "ohtia.task.uncertain"
            : taskState === "blocked"
              ? "ohtia.task.blocked"
              : taskState === "queued"
                ? "ohtia.task.readmitted"
                : taskState === "cancelled"
                  ? "ohtia.task.cancelled"
                  : "ohtia.task.failed",
    });
    return { recorded: true, result };
  }
}

export async function nextPosition(
  db: Kysely<ResearchSchema>,
  conversation: Uint8Array,
): Promise<number> {
  const result = await sql<{ position: number }>`SELECT max(
    coalesce((SELECT max(position) FROM messages WHERE conversation_id=${conversation}),0),
    coalesce((SELECT max(reply_position) FROM tasks WHERE conversation_id=${conversation}),0))+1 AS position`.execute(
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
