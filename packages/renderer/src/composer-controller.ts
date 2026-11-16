import {
  chatgptConnection,
  failure,
  splitText,
  utf8Size,
  validResearcherMessage,
  type FoundationPort,
  type MessageDestination,
  type Outcome,
  type ProviderDeclaration,
  type ResearchResult,
  type ResearchScope,
} from "@ohtia/contracts";

export type ComposerNotice = "pendingLimit" | "inputTooLarge" | "uncertain" | "failed";
export interface ComposerState {
  readonly text: string;
  readonly saving: boolean;
  readonly stopping: boolean;
  readonly stopFailed: boolean;
  readonly running: boolean;
  readonly notice: ComposerNotice | null;
  readonly destinationStatus: "loading" | "ready" | "failed";
  readonly destination:
    | (MessageDestination & {
        readonly declaration: ProviderDeclaration["connection"];
        readonly email: string;
      })
    | null;
  readonly announcement: number;
  readonly reuse: string | null;
}
interface Draft {
  state: ComposerState;
  version: number;
  intent?: { readonly id: string; readonly text: string; readonly version: number };
  pending?: { readonly text: string; clearPrefix: boolean };
  stopId?: string;
  stopConfirmed: boolean;
  destinationRead: number;
  destinationCancel?: () => void;
}
const initial = (): Draft => ({
  version: 0,
  stopConfirmed: false,
  destinationRead: 0,
  state: {
    text: "",
    saving: false,
    stopping: false,
    stopFailed: false,
    running: false,
    notice: null,
    destination: null,
    destinationStatus: "loading",
    announcement: 0,
    reuse: null,
  },
});
/** Window-owned memory only. Pending callbacks retain their original scope across navigation. */
export class ComposerController {
  private readonly drafts = new Map<string, Draft>();
  private readonly listeners = new Set<() => void>();
  private scope: ResearchScope = { projectId: null, conversationId: null };
  private draft = initial();
  private disposed = false;
  private observationUnavailable = false;
  constructor(
    private readonly port: FoundationPort,
    private readonly nextId: () => string = () => crypto.randomUUID(),
    private readonly declarations: readonly ProviderDeclaration["connection"][] = [
      chatgptConnection,
    ],
    private readonly restoreObservation?: () => void,
  ) {}
  snapshot = (): ComposerState => this.draft.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(draft: Draft, state: Partial<ComposerState>): void {
    if (this.disposed) return;
    draft.state = { ...draft.state, ...state };
    if (draft === this.draft) for (const listener of this.listeners) listener();
  }
  open(scope: ResearchScope): void {
    this.invalidateDestination(this.draft);
    this.scope = scope;
    const key = `${scope.projectId ?? ""}/${scope.conversationId ?? ""}`;
    this.draft = this.drafts.get(key) ?? initial();
    this.drafts.set(key, this.draft);
    this.invalidateDestination(this.draft);
    this.update(this.draft, { destinationStatus: "loading", announcement: 0 });
  }
  edit = (text: string): void => {
    const draft = this.draft;
    if (draft.pending && !text.startsWith(draft.pending.text)) draft.pending.clearPrefix = false;
    draft.version++;
    delete draft.intent;
    this.update(draft, { text, notice: null });
  };
  reuse = (text: string): void => {
    if (this.draft.state.text.length) this.update(this.draft, { reuse: text });
    else this.edit(text);
  };
  closeReuse = (): void => {
    this.update(this.draft, { reuse: null });
  };
  replaceReuse = (): void => {
    const text = this.draft.state.reuse;
    if (text !== null) this.edit(text);
    this.closeReuse();
  };
  running(running: boolean): void {
    const draft = this.draft;
    this.update(draft, {
      running,
      ...(draft.stopConfirmed && !running ? { stopping: false } : {}),
    });
  }
  private currentDestination(draft: Draft, read: number): boolean {
    return !this.disposed && read === draft.destinationRead;
  }
  private invalidateDestination(draft: Draft): void {
    draft.destinationRead++;
    draft.destinationCancel?.();
    delete draft.destinationCancel;
  }
  destinationObservationPending(): void {
    this.observationUnavailable = true;
    this.invalidateDestination(this.draft);
    this.update(this.draft, { destination: null, destinationStatus: "loading" });
  }
  destinationObservationLost(): void {
    this.observationUnavailable = true;
    this.invalidateDestination(this.draft);
    this.update(this.draft, { destination: null, destinationStatus: "failed" });
  }
  destinationObservationReady(): void {
    this.observationUnavailable = false;
  }
  destinationUnavailable(): void {
    // An independent panel failure cannot invalidate disclosure that already completed.
    if (this.draft.state.destinationStatus !== "loading") return;
    this.invalidateDestination(this.draft);
    this.update(this.draft, { destination: null, destinationStatus: "failed" });
  }
  async refreshDestination(): Promise<void> {
    if (this.disposed) return;
    if (this.observationUnavailable) {
      this.restoreObservation?.();
      return;
    }
    const draft = this.draft;
    const scope = this.scope;
    this.invalidateDestination(draft);
    const read = draft.destinationRead;
    this.update(draft, { destinationStatus: "loading" });
    if (!scope.projectId) {
      this.update(draft, { destination: null, destinationStatus: "ready" });
      return;
    }
    try {
      const request = this.port.readDestination(
        scope.conversationId
          ? { projectId: scope.projectId, conversationId: scope.conversationId }
          : { projectId: scope.projectId, agentId: "virgilio" },
      );
      draft.destinationCancel = () => {
        request.cancel();
      };
      const result = await request.result;
      if (!this.currentDestination(draft, read)) return;
      if (!result.ok) throw new Error("Destination unavailable.");
      if (!result.value.destination) {
        this.update(draft, { destination: null, destinationStatus: "ready" });
        return;
      }
      const destination = result.value.destination;
      const declaration = this.declarations.find((entry) => entry.id === destination.connection);
      if (!declaration) throw new Error("Destination declaration unavailable.");
      const account = this.port.readConnection(destination.connection);
      draft.destinationCancel = () => {
        account.cancel();
      };
      const connection = await account.result;
      if (!this.currentDestination(draft, read)) return;
      if (!connection.ok) throw new Error("Destination account unavailable.");
      this.update(draft, {
        destinationStatus: "ready",
        destination: {
          ...destination,
          declaration,
          email: connection.value.account_email ?? connection.value.last_account_email ?? "",
        },
      });
    } catch {
      if (this.currentDestination(draft, read))
        this.update(draft, { destination: null, destinationStatus: "failed" });
    } finally {
      if (this.currentDestination(draft, read)) delete draft.destinationCancel;
    }
  }
  send = (): void => {
    const draft = this.draft;
    const conversationId = this.scope.conversationId;
    if (
      !conversationId ||
      !this.scope.projectId ||
      draft.state.destinationStatus !== "ready" ||
      draft.state.saving ||
      draft.state.stopping ||
      !validResearcherMessage(draft.state.text)
    )
      return;
    const intent = draft.intent ?? {
      id: this.nextId(),
      text: draft.state.text,
      version: draft.version,
    };
    draft.intent = intent;
    draft.pending = { text: intent.text, clearPrefix: true };
    this.update(draft, { saving: true, notice: null, announcement: draft.state.announcement + 1 });
    void this.save(conversationId, intent).then(async (outcome) => {
      if (this.disposed) return;
      const text =
        outcome.ok && draft.pending?.clearPrefix
          ? draft.state.text.slice(intent.text.length)
          : draft.state.text;
      delete draft.pending;
      this.update(draft, {
        text,
        saving: false,
        notice: outcome.ok ? null : saveNotice(outcome.error.code),
      });
      if (outcome.ok && draft.intent === intent) delete draft.intent;
      if (draft.state.stopping) await this.stop(draft, conversationId);
    });
  };
  private async save(
    conversationId: string,
    intent: { readonly id: string; readonly text: string },
  ): Promise<Outcome<ResearchResult>> {
    try {
      const parts = splitText(intent.text);
      let content: string | { parts: number; bytes: number; sha256: string } = intent.text;
      if (parts.length > 1) {
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent.text));
        content = {
          parts: parts.length,
          bytes: utf8Size(intent.text),
          sha256: [...new Uint8Array(hash)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(""),
        };
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (typeof content !== "string")
          for (let index = 0; index < parts.length; index++) {
            const part = await this.port.sendTextPart(intent.id, {
              index: index + 1,
              count: content.parts,
              bytes: content.bytes,
              sha256: content.sha256,
              text: parts[index] ?? "",
            }).result;
            if (!part.ok) return part;
          }
        const result = await this.port.appendMessage(intent.id, { conversationId, content }).result;
        if (result.ok || result.error.code !== "parts_incomplete" || attempt === 1) return result;
      }
    } catch {
      return failure("invalid_service_result");
    }
    return failure("invalid_service_result");
  }
  requestStop = (): void => {
    const draft = this.draft;
    const conversationId = this.scope.conversationId;
    if (!conversationId || draft.state.stopping || (!draft.state.saving && !draft.state.running))
      return;
    draft.stopId = this.nextId();
    draft.stopConfirmed = false;
    this.update(draft, { stopping: true, stopFailed: false });
    if (!draft.state.saving) void this.stop(draft, conversationId);
  };
  retryStop = (): void => {
    const draft = this.draft;
    if (!this.scope.conversationId || !draft.state.stopFailed || draft.state.saving) return;
    this.update(draft, { stopFailed: false });
    void this.stop(draft, this.scope.conversationId);
  };
  private async stop(draft: Draft, conversationId: string): Promise<void> {
    try {
      const result = await this.port.stopConversation((draft.stopId ??= this.nextId()), {
        conversationId,
      }).result;
      if (this.disposed) return;
      draft.stopConfirmed = result.ok;
      this.update(draft, { stopFailed: !result.ok, stopping: !result.ok || draft.state.running });
    } catch {
      this.update(draft, { stopFailed: true });
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const draft of this.drafts.values()) this.invalidateDestination(draft);
    this.listeners.clear();
    this.drafts.clear();
  }
}
function saveNotice(code: string): ComposerNotice {
  if (code === "pending_limit_reached") return "pendingLimit";
  if (code === "input_too_large") return "inputTooLarge";
  return ["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"].includes(code)
    ? "uncertain"
    : "failed";
}
