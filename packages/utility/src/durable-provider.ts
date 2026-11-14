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
      action.name === "create-development-project"
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
          result.error.code === "record_not_found"
            ? result.error.code
            : "invalid_action",
      });
      return;
    }
    this.report(action.operation_id, {
      type: "record",
      record:
        action.name === "create-development-project"
          ? "project"
          : action.name === "start-conversation"
            ? "conversation"
            : "message",
      id: result.value.resultId,
    });
    await this.pump();
  }
  /** Each returned permit is already committed. No network or IPC runs while the write lock is held. */
  async pump(): Promise<void> {
    this.options.storage.setTaskContext(this.options.context);
    while (!this.disposed && this.options.storage.ready) {
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
        type: "attempt",
        attempt: message.request.attempt,
      });
      this.send(message);
    }
  }
  interrupt(attempt: string): void {
    if (!this.streams.has(attempt)) return;
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
      const remaining = stream.maxOutput - Buffer.byteLength(stream.text, "utf8");
      const kept = utf8Beginning(event.text, remaining);
      const saved = await this.options.storage.recordTaskEvent(message.attempt, event, "");
      if (!saved.ok) throw new Error("Provider event could not be stored.");
      if (!saved.value) return true;
      stream.text += kept;
      if (kept)
        this.report(stream.operationId, { type: "text", attempt: message.attempt, text: kept });
      if (kept === event.text) return true;
      this.interrupt(message.attempt);
      event = {
        type: "result",
        sequence: event.sequence,
        result: { status: "failed", reason: "output_limit_exceeded", dispatched: true },
      };
    }
    if (event.type === "result" && event.result.status === "completed" && !stream.text)
      event = { ...event, result: { status: "failed", reason: "empty_reply", dispatched: true } };
    const saved = await this.options.storage.recordTaskEvent(message.attempt, event, stream.text);
    if (!saved.ok) throw new Error("Provider event could not be stored.");
    if (!saved.value) return true;
    if (event.type === "usage") stream.usage = event.usage;
    if (event.type === "result") {
      this.streams.delete(message.attempt);
      this.finished(message.attempt, stream, event.result, now);
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
