import { randomUUID } from "node:crypto";
import { developmentInput, developmentTest, operationPolicy } from "@ohtia/domain";
import {
  decodeProviderMessage,
  unknownUsage,
  utf8Size,
  type ServiceConnections,
  type ProviderEvent,
  type ProviderResult,
  type ProviderUsage,
  type DevelopmentMessage,
  type ProviderMessage,
} from "@ohtia/contracts";

interface Attempt {
  readonly operation: string;
  readonly manifest: readonly string[];
  readonly began: number;
  last: number;
  silence: number;
  sequence: number;
  text: string;
  refusal: string;
  usage: ProviderUsage;
  result: ProviderResult | null;
}
/** Credential-free authority for development requests, replaced by durable attempts in STORY-003-005. */
export class ServiceRequests {
  private readonly attempts = new Map<string, Attempt>();
  private readonly operations = new Map<string, string>();
  private disposed = false;
  constructor(
    private readonly generation: string,
    private readonly mode: string,
    private readonly connections: ServiceConnections,
    private readonly send: (text: string) => void,
    private readonly now = Date.now,
  ) {}
  receive(text: unknown): boolean {
    const message = decodeProviderMessage(text);
    if (!message) return false;
    if (message.generation !== this.generation || this.disposed) return true;
    if (message.kind === "provider_event") {
      this.event(message.attempt, message.event);
      return true;
    }
    if (message.kind !== "development_command" || !operationPolicy("development_test", this.mode))
      throw new Error("Unauthorized provider message direction or runtime.");
    const { operation_id: operation, command } = message;
    const reply = (
      attempt: string | null,
      error: Extract<DevelopmentMessage, { kind: "development_result" }>["error"],
    ) => {
      this.post({
        version: 1,
        generation: this.generation,
        kind: "development_result",
        operation_id: operation,
        attempt,
        error,
      });
    };
    if (command.action === "interrupt") {
      const target = this.attempts.get(command.attempt);
      if (!target) reply(command.attempt, "unknown_attempt");
      else {
        if (!target.result)
          this.post({
            version: 1,
            generation: this.generation,
            kind: "provider_interrupt",
            attempt: command.attempt,
          });
        reply(command.attempt, null);
      }
      return true;
    }
    const previous = this.operations.get(operation);
    if (previous) {
      reply(previous, null);
      return true;
    }
    // Preserve operation deduplication even when old completed response bodies are evicted.
    if (
      this.operations.size >= 4096 ||
      [...this.attempts.values()].filter((a) => !a.result).length >=
        developmentTest.max_pending_tasks
    ) {
      reply(null, "busy");
      return true;
    }
    if (!this.connections.available("chatgpt")) {
      reply(null, "unavailable");
      return true;
    }
    for (const [id, item] of this.attempts) {
      if (this.attempts.size < 128) break;
      if (item.result) this.attempts.delete(id);
    }
    const attempt = randomUUID();
    const input = developmentInput([
      {
        reference: `${attempt}-input`,
        role: "user",
        content: "Describe the usual parts of a thesis in about 300 words.",
      },
    ]);
    const instructions = {
      reference: "development-test-instructions-v1",
      text: developmentTest.instructions,
    };
    this.operations.set(operation, attempt);
    this.attempts.set(attempt, {
      operation,
      manifest: [instructions.reference, ...input.map((i) => i.reference)],
      began: this.now(),
      last: this.now(),
      silence: 0,
      sequence: 0,
      text: "",
      refusal: "",
      usage: unknownUsage,
      result: null,
    });
    reply(attempt, null);
    // The last state check and exact manifest precede issuing a fresh single-use permit.
    if (!this.connections.available("chatgpt")) {
      this.event(attempt, {
        kind: "final",
        sequence: 1,
        result: { outcome: "failed", dispatched: false, reason: "connection_expired" },
      });
      return true;
    }
    this.post({
      version: 1,
      generation: this.generation,
      kind: "provider_dispatch",
      request: {
        attempt,
        operation: developmentTest.operation,
        connection: "chatgpt",
        model: command.model,
        input,
        instructions,
        limits: {
          max_input_bytes: developmentTest.max_input_bytes,
          max_input_items: developmentTest.max_input_items,
          max_output_bytes: developmentTest.max_output_bytes,
        },
      },
      permit: { id: randomUUID(), attempt, issued_at_ms: this.now(), policy_version: 1 },
    });
    return true;
  }
  private post(message: ProviderMessage | DevelopmentMessage): void {
    const text = JSON.stringify(message);
    if (!decodeProviderMessage(text)) throw new Error("Invalid outgoing provider message.");
    this.send(text);
  }
  private event(id: string, event: ProviderEvent): void {
    const attempt = this.attempts.get(id);
    if (!attempt || attempt.result) return;
    if (
      event.sequence !== attempt.sequence + 1 ||
      (event.kind === "started" && attempt.sequence !== 0) ||
      (attempt.sequence === 0 &&
        event.kind !== "started" &&
        !(
          event.kind === "final" &&
          (!event.result.dispatched || event.result.outcome === "uncertain")
        ))
    )
      throw new Error("Invalid provider event sequence.");
    if (event.kind === "text" || event.kind === "refusal") {
      if (
        utf8Size(attempt.text) + utf8Size(attempt.refusal) + utf8Size(event.text) >
        developmentTest.max_output_bytes
      )
        throw new Error("Provider output exceeded its bound.");
      attempt[event.kind === "text" ? "text" : "refusal"] += event.text;
    }
    if (event.kind === "usage") attempt.usage = event.usage;
    if (event.kind === "final") attempt.result = event.result;
    attempt.sequence = event.sequence;
    const now = this.now();
    attempt.silence = Math.max(attempt.silence, Math.max(0, now - attempt.last));
    attempt.last = now;
    this.post({
      version: 1,
      generation: this.generation,
      kind: "development_event",
      operation_id: attempt.operation,
      attempt: id,
      event,
      transfer_manifest: attempt.manifest,
      duration_ms: Math.max(0, now - attempt.began),
      longest_silence_ms: attempt.silence,
    });
  }
  inspect(id: string) {
    const attempt = this.attempts.get(id);
    return attempt
      ? {
          text: attempt.text,
          refusal: attempt.refusal,
          usage: attempt.usage,
          result: attempt.result,
          transfer_manifest: attempt.manifest,
        }
      : undefined;
  }
  dispose(): void {
    this.disposed = true;
    this.attempts.clear();
    this.operations.clear();
  }
}
