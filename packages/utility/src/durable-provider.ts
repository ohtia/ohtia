import { createHash } from "node:crypto";
import {
  providerMessageVersion,
  type ApplicationExitControl,
  splitText,
  type ReplyPart,
  type ReplyParts,
  type DevelopmentActionMessage,
  type DevelopmentReport,
  type ProviderEventMessage,
  type ProviderToolCall,
  type ProviderResult,
  type ProviderUsage,
  type TransferEntry,
  type ServiceWakeMessage,
} from "@ohtia/contracts";
import type { DurableStore } from "./storage.js";
import { operationPolicy } from "./operations.js";
import { unknownUsage, type TaskContext, type TaskRow } from "./tasks.js";

interface Stream {
  readonly taskId: string;
  readonly taskKind: TaskRow["kind"];
  readonly parts: ReplyPart[];
  readonly operationId: string;
  text: string;
  readonly calls: ProviderToolCall[];
  outputBytes: number;
  sequence: number;
  readonly transfer: readonly TransferEntry[];
  sampledMono: number;
  sampledWall: number;
  elapsed: number;
  last: number;
  readonly maxDuration: number;
  readonly maxInactivity: number;
  longestSilence: number;
  usage: ProviderUsage;
  readonly maxOutput: number;
  interrupted?: boolean;
  cut?: "output_limit_exceeded" | "deadline_exceeded" | "inactivity_timeout";
}
/** Streaming buffers carry no execution authority: the committed task and attempt do. */
export class DurableProvider {
  private readonly streams = new Map<string, Stream>();
  private disposed = false;
  private exitControl: ApplicationExitControl | undefined;
  private exitCancelledFor: string | undefined;
  private exitFailedFor: string | undefined;
  /** Synchronous admission barrier also stops an already queued pump between transactions. */
  holdExit(control: ApplicationExitControl): void {
    if (control.action !== "resume") this.exitControl = control;
  }
  /** Execute in the serialized service queue after holdExit has observed the control. */
  async applicationExit(control: ApplicationExitControl): Promise<void> {
    if (control.action === "resume") {
      if (this.exitControl?.operationId !== control.operationId) return;
      this.exitControl = undefined;
      this.exitCancelledFor = undefined;
      this.exitFailedFor = undefined;
    } else {
      if (this.exitFailedFor === control.operationId) this.exitFailedFor = undefined;
      if (control.action === "cancel") {
        const result = await this.options.storage.executeResearchCommand({
          command: "task.cancelAll",
          operationId: control.operationId,
          payload: {},
        });
        if (result.ok) this.exitCancelledFor = control.operationId;
        else this.exitFailedFor = control.operationId;
      }
    }
    await this.pump();
    if (!this.canPump()) await this.publishExit();
  }
  private async publishExit(): Promise<void> {
    if (!this.exitControl || this.disposed) return;
    const result = await this.options.storage.runningTaskCount();
    this.send({
      kind: "application_exit_state",
      generation: this.options.context.generation,
      operationId: this.exitControl.operationId,
      running: result.ok ? result.value : 0,
      held: true,
      cancelled: this.exitCancelledFor === this.exitControl.operationId,
      failed: this.exitFailedFor === this.exitControl.operationId || !result.ok,
    });
  }
  private lastWake: string | undefined;
  constructor(
    private readonly options: {
      readonly storage: DurableStore;
      readonly context: TaskContext;
      readonly send: (text: string) => void;
      readonly reply?: (taskId: string, sequence: number, text: string) => void;
      readonly monotonic?: () => number;
      readonly wallClock?: () => number;
    },
  ) {}
  private now(): number {
    return (this.options.monotonic ?? (() => performance.now()))();
  }
  private wall(): number {
    return (this.options.wallClock ?? Date.now)();
  }
  private elapsed(stream: Stream): number {
    const mono = this.now();
    const wall = this.wall();
    stream.elapsed += Math.max(0, mono - stream.sampledMono, wall - stream.sampledWall);
    stream.sampledMono = mono;
    stream.sampledWall = wall;
    return stream.elapsed;
  }
  /** Review every active stream before admitting post-wake effects; closure still owns release. */
  wake(message: ServiceWakeMessage): void {
    if (!this.canPump() || message.generation !== this.options.context.generation) return;
    const key = JSON.stringify(message);
    if (key === this.lastWake) return;
    this.lastWake = key;
    for (const [attempt, stream] of this.streams) {
      // A queued event or a newly prepared stream may already have sampled resume.
      // Add only time through that endpoint which the previous sample did not observe.
      const throughSleep =
        stream.elapsed +
        (message.asleepMs === 0
          ? 0
          : Math.max(0, Date.parse(message.resumedAt) - stream.sampledWall));
      const elapsed = Math.max(this.elapsed(stream), throughSleep);
      stream.elapsed = elapsed;
      stream.longestSilence = Math.max(stream.longestSilence, elapsed - stream.last);
      if (!stream.cut) {
        if (elapsed >= stream.maxDuration) stream.cut = "deadline_exceeded";
        else if (elapsed - stream.last >= stream.maxInactivity) stream.cut = "inactivity_timeout";
      }
      if (stream.cut) this.interrupt(attempt);
    }
    this.options.storage.emitWakeDiagnostic();
  }
  private canPump(): boolean {
    return !this.disposed && this.options.storage.ready;
  }
  private send(message: unknown): void {
    if (!this.disposed) this.options.send(JSON.stringify(message));
  }
  private report(operationId: string, report: DevelopmentReport): void {
    this.send({
      kind: "development_report",
      version: providerMessageVersion,
      generation: this.options.context.generation,
      operation_id: operationId,
      report,
    });
  }
  /** Called inside the data service's serialized command queue, never concurrently with receive. */
  async developmentAction(message: DevelopmentActionMessage): Promise<void> {
    if (this.options.context.mode !== "development" || this.disposed) return;
    this.options.storage.setTaskContext(this.options.context);
    const action = message.action;
    if (action.name === "open-conversation") {
      const projects = await this.options.storage.readProjects();
      if (projects.ok)
        for (const project of projects.value) {
          const conversations = await this.options.storage.readConversations(project.id);
          if (
            conversations.ok &&
            conversations.value.some((row) => row.id === action.conversation)
          ) {
            this.report(action.operation_id, {
              type: "conversation_opened",
              projectId: project.id,
              conversationId: action.conversation,
            });
            return;
          }
        }
      this.report(action.operation_id, { type: "refused", reason: "record_not_found" });
      return;
    }
    if (action.name === "resume-requests" || action.name === "continue-all") {
      const result = await this.options.storage.executeResearchCommand(
        action.name === "resume-requests"
          ? {
              command: "usagePause.resume",
              operationId: action.operation_id,
              payload: { connection: action.connection },
            }
          : { command: "task.continueAll", operationId: action.operation_id, payload: {} },
      );
      this.report(
        action.operation_id,
        result.ok
          ? { type: "record", record: "receipt", id: result.value.resultId }
          : {
              type: "refused",
              reason: result.error.code === "uncertain" ? "uncertain" : "invalid_action",
            },
      );
      await this.pump();
      return;
    }
    if (action.name === "interrupt") {
      if (this.streams.has(action.attempt)) {
        this.interrupt(action.attempt);
        this.report(action.operation_id, { type: "interrupt_sent", attempt: action.attempt });
      } else this.report(action.operation_id, { type: "refused", reason: "unknown_attempt" });
      return;
    }
    if (action.name === "request") {
      const first = this.options.context.connections.read("chatgpt")?.models?.[0]?.id;
      if (!first || !this.options.context.connections.available("chatgpt")) {
        this.report(action.operation_id, { type: "refused", reason: "connection_unavailable" });
        return;
      }
      if (action.model !== first) {
        this.report(action.operation_id, { type: "refused", reason: "invalid_action" });
        return;
      }
      const project = await this.options.storage.executeResearchCommand({
        command: "development.createProject",
        operationId: createHash("sha256")
          .update(`development-project:${action.operation_id}`)
          .digest("hex"),
        payload: {},
      });
      if (!project.ok) {
        this.report(action.operation_id, { type: "refused", reason: "invalid_action" });
        return;
      }
      await this.developmentAction({
        ...message,
        action: {
          name: "start-conversation",
          operation_id: action.operation_id,
          project: project.value.resultId,
          text: action.text,
        },
      });
      return;
    }
    const command =
      action.name === "confirm-setup" || action.name === "reject-setup"
        ? {
            command:
              action.name === "confirm-setup"
                ? ("project.confirmSetup" as const)
                : ("project.rejectSetup" as const),
            operationId: action.operation_id,
            payload: { proposalId: action.proposal },
          }
        : action.name === "create-project"
          ? { command: "project.create" as const, operationId: action.operation_id, payload: {} }
          : action.name === "stop" || action.name === "start-again"
            ? {
                command:
                  action.name === "stop" ? ("task.stop" as const) : ("task.startAgain" as const),
                operationId: action.operation_id,
                payload: { taskId: action.task },
              }
            : action.name === "create-development-project"
              ? {
                  command: "development.createProject" as const,
                  operationId: action.operation_id,
                  payload: {},
                }
              : action.name === "start-conversation"
                ? {
                    command: "conversation.start" as const,
                    operationId: action.operation_id,
                    payload: { projectId: action.project, content: action.text },
                  }
                : {
                    command:
                      action.name === "send-to-josefa"
                        ? ("development.sendToJosefa" as const)
                        : ("message.append" as const),
                    operationId: action.operation_id,
                    payload: { conversationId: action.conversation, content: action.text },
                  };
    const result = await this.options.storage.executeResearchCommand(command);
    if (!result.ok) {
      this.report(action.operation_id, {
        type: "refused",
        reason:
          result.error.code === "input_too_large" ||
          result.error.code === "pending_limit_reached" ||
          result.error.code === "record_not_found" ||
          result.error.code === "newer_task_exists" ||
          result.error.code === "task_not_retryable" ||
          result.error.code === "proposal_not_waiting" ||
          result.error.code === "setup_reply_active" ||
          result.error.code === "uncertain"
            ? result.error.code
            : "invalid_action",
      });
      // A lost acknowledgement may have committed Stop. Read the durable stopping intents
      // before returning, so that uncertainty cannot leave that connection streaming.
      if (action.name === "stop" && result.error.code === "uncertain") await this.pump();
      return;
    }
    this.report(action.operation_id, {
      type: "record",
      record:
        action.name === "create-development-project" || action.name === "create-project"
          ? "project"
          : action.name === "confirm-setup" || action.name === "reject-setup"
            ? "receipt"
            : action.name === "start-conversation"
              ? "conversation"
              : action.name === "stop" || action.name === "start-again"
                ? "task"
                : "message",
      id: result.value.resultId,
    });
    if (action.name === "create-project") {
      const conversations = await this.options.storage.readConversations(result.value.resultId);
      if (conversations.ok && conversations.value[0])
        this.report(action.operation_id, {
          type: "record",
          record: "conversation",
          id: conversations.value[0].id,
        });
    }
    await this.pump();
  }
  /** Each returned permit is already committed. No network or IPC runs while the write lock is held. */
  async pump(): Promise<void> {
    // Connection reports also arrive during storage admission. They cannot read task state
    // or turn an in-progress migration into a provider/service failure.
    if (!this.canPump()) return;
    this.options.storage.setTaskContext(this.options.context);
    try {
      const stopping = await this.options.storage.stoppingAttempts();
      if (!stopping.ok) throw new Error("Stopping attempts could not be read.");
      for (const attempt of stopping.value) this.interrupt(attempt);
      while (this.canPump() && !this.exitControl) {
        const prepared = await this.options.storage.prepareTask();
        if (!prepared.ok || !prepared.value) return;
        const message = prepared.value.dispatch;
        const policy = operationPolicy(
          message.request.operation,
          message.request.policy_version,
          this.options.context.mode,
        );
        if (!policy) throw new Error("Dispatched operation policy unavailable.");
        const now = this.now();
        this.streams.set(message.request.attempt, {
          taskId: prepared.value.taskId,
          taskKind: prepared.value.kind,
          parts: [],
          operationId: prepared.value.acceptedByOperationId,
          text: "",
          calls: [],
          outputBytes: 0,
          sequence: 0,
          transfer: prepared.value.transfer,
          sampledMono: now,
          sampledWall: this.wall(),
          elapsed: 0,
          last: 0,
          maxDuration: policy.max_attempt_duration_ms,
          maxInactivity: policy.max_inactivity_ms,
          longestSilence: 0,
          usage: unknownUsage,
          maxOutput: policy.max_output_bytes,
        });
        this.report(prepared.value.acceptedByOperationId, {
          type: "record",
          record: "task",
          id: prepared.value.taskId,
        });
        this.report(prepared.value.acceptedByOperationId, {
          type: "attempt",
          attempt: message.request.attempt,
        });
        this.send(message);
      }
    } finally {
      await this.publishExit();
    }
  }
  interrupt(attempt: string): void {
    const stream = this.streams.get(attempt);
    if (!stream || stream.interrupted) return;
    stream.interrupted = true;
    this.send({
      kind: "provider_interrupt",
      version: providerMessageVersion,
      generation: this.options.context.generation,
      attempt,
    });
  }
  async receive(message: ProviderEventMessage): Promise<boolean> {
    const stream = this.streams.get(message.attempt);
    if (this.disposed || message.generation !== this.options.context.generation || !stream)
      return true;
    if (message.event.sequence !== stream.sequence + 1) return false;
    const now = this.elapsed(stream);
    stream.longestSilence = Math.max(stream.longestSilence, now - stream.last);
    stream.last = now;
    stream.sequence = message.event.sequence;
    let event = message.event;
    if (event.type === "text") {
      if (stream.cut) return true;
      const remaining = stream.maxOutput - stream.outputBytes;
      const kept = utf8Beginning(event.text, remaining);
      const saved = await this.options.storage.recordTaskEvent(message.attempt, event, "");
      if (!saved.ok) throw new Error("Provider event could not be stored.");
      if (!saved.value.recorded) return true;
      stream.text += kept;
      stream.outputBytes += Buffer.byteLength(kept, "utf8");
      for (const text of kept ? splitText(kept) : []) {
        const sequence = stream.parts.length + 1;
        stream.parts.push({ sequence, text });
        if (stream.taskKind !== "contribution") this.options.reply?.(stream.taskId, sequence, text);
      }
      if (kept)
        this.report(stream.operationId, { type: "text", attempt: message.attempt, text: kept });
      if (kept === event.text) return true;
      stream.cut = "output_limit_exceeded";
      this.interrupt(message.attempt);
      return true;
    }
    if (event.type === "tool_call") {
      if (stream.cut) return true;
      const size = Buffer.byteLength(event.arguments, "utf8");
      if (stream.outputBytes + size > stream.maxOutput) {
        stream.cut = "output_limit_exceeded";
        stream.calls.length = 0;
        this.interrupt(message.attempt);
        return true;
      }
      stream.outputBytes += size;
      stream.calls.push({
        namespace: event.namespace,
        name: event.name,
        arguments: event.arguments,
      });
      return true;
    }
    // A wake timeout cannot overwrite main's proof that no request was dispatched.
    // Preserve its reason and the task's remaining readmission budget.
    if (event.type === "result" && stream.cut) {
      if (stream.taskKind !== "reply" && message.work?.dispatched === false) {
        if (event.result.status === "cancelled")
          event = {
            ...event,
            result: { status: "failed", reason: "permit_expired", dispatched: false },
          };
      } else if (
        !(event.result.status === "failed" && !event.result.dispatched) &&
        (stream.taskKind === "reply" || event.result.status !== "uncertain")
      ) {
        event = { ...event, result: { status: "failed", reason: stream.cut, dispatched: true } };
      }
    }
    const saved = await this.options.storage.recordTaskEvent(
      message.attempt,
      event,
      stream.text,
      stream.calls,
      stream.taskKind === "reply" ? undefined : message.work,
    );
    if (!saved.ok) throw new Error("Provider event could not be stored.");
    if (!saved.value.recorded) return true;
    if (event.type === "usage") stream.usage = event.usage;
    if (event.type === "result") {
      this.streams.delete(message.attempt);
      if (saved.value.proposalId)
        this.report(stream.operationId, {
          type: "record",
          record: "proposal",
          id: saved.value.proposalId,
        });
      const result = saved.value.result;
      if (!result) throw new Error("Terminal provider outcome was not recorded.");
      if (
        stream.taskKind === "reply" &&
        (result.status === "cancelled" ||
          result.status === "uncertain" ||
          (result.status === "failed" &&
            ["deadline_exceeded", "inactivity_timeout", "output_limit_exceeded"].includes(
              result.reason,
            )))
      )
        stream.usage = unknownUsage;
      this.finished(message.attempt, stream, result, now);
      await this.pump();
    }
    return true;
  }
  private finished(attempt: string, stream: Stream, result: ProviderResult, now: number): void {
    this.report(stream.operationId, {
      type: "finished",
      attempt,
      result,
      usage: stream.usage,
      transfer: stream.transfer,
      events: stream.sequence,
      duration_ms: Math.round(now),
      longest_silence_ms: Math.round(stream.longestSilence),
    });
  }
  replyParts(taskId: string, fromSequence: number): ReplyParts {
    const stream = [...this.streams.values()].find((value) => value.taskId === taskId);
    return {
      parts: stream?.parts.filter((part) => part.sequence >= fromSequence) ?? [],
      latestSequence: stream?.parts.length ?? 0,
    };
  }
  dispose(): void {
    this.disposed = true;
    this.streams.clear();
  }
}

/** Return the longest UTF-8 prefix fitting the budget, ending at a complete code point. */
export function utf8Beginning(text: string, maximum: number): string {
  let bytes = 0;
  let end = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point, "utf8");
    if (bytes + size > maximum) break;
    bytes += size;
    end += point.length;
  }
  return text.slice(0, end);
}
