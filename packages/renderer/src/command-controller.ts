import {
  commandDefinitions,
  isCommandIntent,
  isCommandId,
  type CommandContext,
  type CommandEntry,
  type CommandId,
  type CommandIntent,
  type CommandReason,
  type CommandResult,
  type CommandSnapshot,
  type InterfaceLocale,
} from "@ohtia/contracts";

export interface CommandExecution {
  readonly context: CommandContext;
  isCurrent(): boolean;
}
export interface CommandHandler {
  /** Rechecked at invocation; availability never grants domain authority. */
  state(): Omit<CommandEntry, "id">;
  run(execution: CommandExecution): boolean | Promise<boolean>;
}
interface CommandRegistration {
  readonly handler: CommandHandler;
}
/** One window owns its registry. Native menus consume snapshots and send causal intents. */
export class CommandController {
  private handlers = new Map<CommandId, CommandRegistration>();
  private listeners = new Set<() => void>();
  private disposed = false;
  private revision = 0;
  private localSequence = 0;
  private last = new Map<
    CommandIntent["source"],
    { intent: CommandIntent; result: Promise<CommandResult> }
  >();
  constructor(
    readonly context: CommandContext,
    private locale: InterfaceLocale,
  ) {}
  register(id: CommandId, handler: CommandHandler): () => void {
    if (this.disposed || !isCommandId(id) || this.handlers.has(id))
      throw new Error("Command handler registration refused.");
    const registration = { handler };
    this.handlers.set(id, registration);
    this.changed();
    return () => {
      if (this.handlers.get(id) !== registration) return;
      this.handlers.delete(id);
      this.changed();
    };
  }
  setLocale(locale: InterfaceLocale): void {
    this.locale = locale;
    this.changed();
  }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  changed(): void {
    if (this.disposed) return;
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  entry(id: CommandId): CommandEntry {
    return {
      id,
      ...(this.handlers.get(id)?.handler.state() ?? { reason: "handler_missing" as const }),
    };
  }
  snapshot(): CommandSnapshot {
    return {
      windowGeneration: this.context.windowGeneration,
      revision: this.revision,
      locale: this.locale,
      entries: commandDefinitions.map(({ id }) => this.entry(id)),
    };
  }
  invoke(command: CommandId): Promise<CommandResult> {
    return this.receive({
      windowGeneration: this.context.windowGeneration,
      source: "renderer",
      sequence: ++this.localSequence,
      command,
    });
  }
  private owns(id: CommandId, registration: CommandRegistration | undefined): boolean {
    return !this.disposed && this.handlers.get(id) === registration;
  }
  receive(input: unknown): Promise<CommandResult> {
    if (this.disposed) return Promise.resolve({ status: "revoked" });
    if (!isCommandIntent(input)) return Promise.resolve({ status: "unknown_command" });
    if (input.windowGeneration !== this.context.windowGeneration)
      return Promise.resolve({ status: "stale_context" });
    const previous = this.last.get(input.source);
    if (previous && input.sequence <= previous.intent.sequence) {
      if (input.sequence === previous.intent.sequence && input.command === previous.intent.command)
        return previous.result;
      return Promise.resolve({ status: "stale_intent" });
    }
    const registration = this.handlers.get(input.command);
    const result = Promise.resolve().then(async (): Promise<CommandResult> => {
      if (!this.owns(input.command, registration)) return { status: "revoked" };
      if (!registration) return { status: "unavailable", reason: "handler_missing" };
      const handler = registration.handler;
      try {
        const reason = handler.state().reason;
        if (reason) return { status: "unavailable", reason };
        const completed = await handler.run({
          context: this.context,
          isCurrent: () => this.owns(input.command, registration),
        });
        if (!this.owns(input.command, registration)) return { status: "revoked" };
        return { status: completed ? "completed" : "failed" };
      } catch {
        return { status: "failed" };
      }
    });
    this.last.set(input.source, { intent: input, result });
    return result;
  }
  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
    this.listeners.clear();
    this.last.clear();
  }
}
/** Controlled presentation input; callers retain preference and renderer-application ownership. */
export interface CommandPresentationState {
  readonly modal: boolean;
  readonly composing: boolean;
  readonly editable: boolean;
}
export function presentationReason(
  id: CommandId,
  state: CommandPresentationState,
): CommandReason | undefined {
  if (
    state.composing &&
    !id.startsWith("edit.") &&
    id !== "application.quit" &&
    id !== "window.close"
  )
    return "composing";
  if (id.startsWith("edit.") && !state.editable) return "no_edit_target";
  if (
    state.modal &&
    ["about.open", "help.open", "settings.open", "palette.open", "shortcuts.open"].includes(id)
  )
    return "modal_open";
  return undefined;
}
