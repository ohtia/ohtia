import { createHash } from "node:crypto";
import {
  providerMessageVersion,
  type DevelopmentActionMessage,
  type DevelopmentReport,
  type ProviderEventMessage,
  type ProviderResult,
  type ProviderUsage,
  type TransferEntry,
} from "@ohtia/contracts";
import type { DurableStore } from "./storage.js";
import { operationPolicy } from "./operations.js";
import { unknownUsage, type TaskContext } from "./tasks.js";

interface Stream {
  readonly operationId: string;
  text: string;
  sequence: number;
  readonly transfer: readonly TransferEntry[];
  readonly started: number;
  last: number;
  longestSilence: number;
  usage: ProviderUsage;
  readonly maxOutput: number;
  interrupted?: boolean;
  cut?: "output_limit_exceeded";
}
/** Streaming buffers carry no execution authority: the committed task and attempt do. */
export class DurableProvider {
  private readonly streams = new Map<string, Stream>();
  private disposed = false;
  constructor(
    private readonly options: {
      readonly storage: DurableStore;
      readonly context: TaskContext;
      readonly send: (text: string) => void;
      readonly monotonic?: () => number;
    },
  ) {}
  private now(): number {
    return (this.options.monotonic ?? (() => performance.now()))();
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
      action.name === "stop" || action.name === "start-again"
        ? {
            command: action.name === "stop" ? ("task.stop" as const) : ("task.startAgain" as const),
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
                command: "message.append" as const,
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
        action.name === "create-development-project"
          ? "project"
          : action.name === "start-conversation"
            ? "conversation"
            : action.name === "stop" || action.name === "start-again"
              ? "task"
              : "message",
      id: result.value.resultId,
    });
    await this.pump();
  }
  /** Each returned permit is already committed. No network or IPC runs while the write lock is held. */
  async pump(): Promise<void> {
    // Connection reports also arrive during storage admission. They cannot read task state
    // or turn an in-progress migration into a provider/service failure.
    if (!this.canPump()) return;
    this.options.storage.setTaskContext(this.options.context);
    const stopping = await this.options.storage.stoppingAttempts();
    if (!stopping.ok) throw new Error("Stopping attempts could not be read.");
    for (const attempt of stopping.value) this.interrupt(attempt);
    while (this.canPump()) {
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
        operationId: prepared.value.acceptedByOperationId,
        text: "",
        sequence: 0,
        transfer: prepared.value.transfer,
        started: now,
        last: now,
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
    const now = this.now();
    stream.longestSilence = Math.max(stream.longestSilence, now - stream.last);
    stream.last = now;
    stream.sequence = message.event.sequence;
    let event = message.event;
    if (event.type === "text") {
      if (stream.cut) return true;
      const remaining = stream.maxOutput - Buffer.byteLength(stream.text, "utf8");
      const kept = utf8Beginning(event.text, remaining);
      const saved = await this.options.storage.recordTaskEvent(message.attempt, event, "");
      if (!saved.ok) throw new Error("Provider event could not be stored.");
      if (!saved.value.recorded) return true;
      stream.text += kept;
      if (kept)
        this.report(stream.operationId, { type: "text", attempt: message.attempt, text: kept });
      if (kept === event.text) return true;
      stream.cut = "output_limit_exceeded";
      this.interrupt(message.attempt);
      return true;
    }
    if (event.type === "result" && stream.cut)
      event = { ...event, result: { status: "failed", reason: stream.cut, dispatched: true } };
    if (event.type === "result" && event.result.status === "completed" && !stream.text)
      event = { ...event, result: { status: "failed", reason: "empty_reply", dispatched: true } };
    const saved = await this.options.storage.recordTaskEvent(message.attempt, event, stream.text);
    if (!saved.ok) throw new Error("Provider event could not be stored.");
    if (!saved.value.recorded) return true;
    if (event.type === "usage") stream.usage = event.usage;
    if (event.type === "result") {
      this.streams.delete(message.attempt);
      const result = saved.value.result;
      if (!result) throw new Error("Terminal provider outcome was not recorded.");
      if (
        result.status === "cancelled" ||
        result.status === "uncertain" ||
        (result.status === "failed" &&
          ["deadline_exceeded", "inactivity_timeout", "output_limit_exceeded"].includes(
            result.reason,
          ))
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
      duration_ms: Math.round(now - stream.started),
      longest_silence_ms: Math.round(stream.longestSilence),
    });
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
