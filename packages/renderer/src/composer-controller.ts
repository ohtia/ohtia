import { stagedCommand } from "./staged-command.js";
import {
  defaultProviderConnections,
  validResearcherMessage,
  type FoundationPort,
  type MessageDestination,
  type PauseCounts,
  type ConnectionState,
  type Outcome,
  type ProviderDeclaration,
  type ReplyAgent,
  type ResearchResult,
  type ResearchScope,
} from "@ohtia/contracts";

export type ComposerNotice = "pendingLimit" | "inputTooLarge" | "uncertain" | "failed";
export interface ComposerState {
  readonly text: string;
  readonly agentId: ReplyAgent;
  readonly correction?: string | null;
  readonly setupFinal?: boolean;
  readonly focusRequest?: number;
  readonly saving: boolean;
  readonly starting?: boolean;
  readonly stopping: boolean;
  readonly cancelling: boolean;
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
  readonly connectionState?: ConnectionState;
  readonly usagePaused?: boolean;
  readonly announcement: number;
  readonly reuse: string | null;
}
interface Draft {
  state: ComposerState;
  intent?: { readonly id: string; readonly text: string; readonly agentId: ReplyAgent };
  pending?: { readonly text: string; clearPrefix: boolean };
  stopId?: string;
  stopConfirmed: boolean;
  destinationRead: number;
  destinationCancel?: () => void;
}
const initial = (): Draft => ({
  stopConfirmed: false,
  destinationRead: 0,
  state: {
    text: "",
    agentId: "virgilio",
    saving: false,
    stopping: false,
    cancelling: false,
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
  private pauseCounts: PauseCounts | undefined;
  pauses(counts: PauseCounts): void {
    this.pauseCounts = counts;
    for (const draft of this.drafts.values())
      this.update(draft, {
        usagePaused: counts.usage.some((p) => p.connection === draft.state.destination?.connection),
      });
  }
  private observationUnavailable = false;
  constructor(
    private readonly port: FoundationPort,
    private readonly nextId: () => string = () => crypto.randomUUID(),
    private readonly declarations: readonly ProviderDeclaration["connection"][] = defaultProviderConnections,
    private readonly restoreObservation?: () => void,
    private readonly conversationStarted?: (
      scope: ResearchScope,
      active: boolean,
      agent: ReplyAgent,
    ) => void,
  ) {}
  snapshot = (): ComposerState => this.draft.state;
  selectedAgent = (): ReplyAgent => this.draft.state.agentId;
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
    if (
      this.scope.projectId !== scope.projectId ||
      this.scope.conversationId !== scope.conversationId
    )
      this.update(this.draft, { correction: null });
    this.scope = scope;
    const key = `${scope.projectId ?? ""}/${scope.conversationId ?? ""}`;
    this.draft = this.drafts.get(key) ?? initial();
    this.drafts.set(key, this.draft);
    this.invalidateDestination(this.draft);
    this.update(this.draft, { destinationStatus: "loading", announcement: 0 });
  }
  focus = (): void => {
    this.update(this.draft, { focusRequest: (this.draft.state.focusRequest ?? 0) + 1 });
  };
  correct(proposalId: string): void {
    this.update(this.draft, { correction: proposalId });
    this.focus();
  }
  setup(final: boolean, openProposalIds: readonly string[]): void {
    const correction = this.draft.state.correction;
    this.update(this.draft, {
      setupFinal: final,
      ...(correction && !openProposalIds.includes(correction) ? { correction: null } : {}),
    });
  }
  edit = (text: string): void => {
    const draft = this.draft;
    if (draft.pending && !text.startsWith(draft.pending.text)) draft.pending.clearPrefix = false;
    delete draft.intent;
    this.update(draft, { text, notice: null });
  };
  selectAgent = (agentId: ReplyAgent): void => {
    const draft = this.draft;
    if (
      !this.scope.projectId ||
      this.scope.conversationId ||
      draft.state.saving ||
      draft.state.notice === "uncertain" ||
      draft.state.agentId === agentId
    )
      return;
    delete draft.intent;
    this.update(draft, { agentId, destination: null, destinationStatus: "loading", notice: null });
    void this.refreshDestination();
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
  running(running: boolean, cancelling = false): void {
    const draft = this.draft;
    this.update(draft, {
      running,
      cancelling,
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
          : { projectId: scope.projectId, agentId: draft.state.agentId },
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
        connectionState: connection.value.state,
        usagePaused:
          this.pauseCounts?.usage.some((p) => p.connection === destination.connection) ?? false,
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
    const { projectId, conversationId } = this.scope;
    if (
      !projectId ||
      (!conversationId && !this.conversationStarted) ||
      draft.state.destinationStatus !== "ready" ||
      draft.state.saving ||
      draft.state.stopping ||
      draft.state.cancelling ||
      !validResearcherMessage(draft.state.text)
    )
      return;
    const intent = draft.intent ?? {
      id: this.nextId(),
      text: draft.state.text,
      agentId: draft.state.agentId,
    };
    draft.intent = intent;
    draft.pending = { text: intent.text, clearPrefix: true };
    this.update(draft, {
      saving: true,
      starting: !conversationId,
      notice: null,
      announcement: draft.state.announcement + 1,
    });
    void this.save(projectId, conversationId, intent).then(async (outcome) => {
      if (this.disposed) return;
      const text =
        outcome.ok && draft.pending?.clearPrefix
          ? draft.state.text.slice(intent.text.length)
          : draft.state.text;
      delete draft.pending;
      this.update(draft, {
        text,
        ...(outcome.ok ? { correction: null } : {}),
        saving: false,
        starting: false,
        notice: outcome.ok ? null : saveNotice(outcome.error.code, !conversationId),
      });
      if (outcome.ok && draft.intent === intent) delete draft.intent;
      if (conversationId && draft.state.stopping) await this.stop(draft, conversationId);
      if (!conversationId && outcome.ok && outcome.value.resultId) {
        const key = `${projectId}/${outcome.value.resultId}`;
        const existing = this.drafts.get(key);
        // Another window can observe the saved row and this window can open it
        // before the receipt arrives. Preserve both drafts in that case.
        if (!existing) this.drafts.set(key, draft);
        if (!existing || !draft.state.text) this.drafts.delete(`${projectId}/`);
        this.conversationStarted?.(
          { projectId, conversationId: outcome.value.resultId },
          this.draft === draft,
          intent.agentId,
        );
      }
    });
  };
  private async save(
    projectId: string,
    conversationId: string | null,
    intent: { readonly id: string; readonly text: string; readonly agentId: ReplyAgent },
  ): Promise<Outcome<ResearchResult>> {
    return stagedCommand(this.port, intent.id, intent.text, (content) =>
      conversationId
        ? this.port.appendMessage(intent.id, { conversationId, content })
        : this.port.startConversation(intent.id, { projectId, agentId: intent.agentId, content }),
    );
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
function saveNotice(code: string, starting: boolean): ComposerNotice {
  if (code === "pending_limit_reached") return "pendingLimit";
  if (!starting && code === "input_too_large") return "inputTooLarge";
  return ["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"].includes(code)
    ? "uncertain"
    : "failed";
}
