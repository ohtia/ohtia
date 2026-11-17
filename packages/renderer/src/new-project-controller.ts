import {
  failure,
  type FoundationPort,
  type ResearchScope,
  type ProviderDeclaration,
  chatgptConnection,
} from "@ohtia/contracts";

export interface NewProjectState {
  readonly busy: boolean;
  readonly dialog: "connection" | "failed" | "uncertain" | "openingFailed" | null;
}
/** A creation intent retains its receipt identity through retries and failed opening reads. */
export class NewProjectController {
  private state: NewProjectState = { busy: false, dialog: null };
  private listeners = new Set<() => void>();
  private operationId: string | undefined;
  private createdId: string | undefined;
  private disposed = false;
  constructor(
    private readonly port: FoundationPort,
    private readonly onCreated: (scope: ResearchScope) => void,
    private readonly nextId: () => string = () => crypto.randomUUID(),
    private readonly connections: readonly ProviderDeclaration["connection"][] = [
      chatgptConnection,
    ],
  ) {}
  snapshot = (): NewProjectState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(state: NewProjectState): void {
    if (this.disposed) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  close = (): void => {
    if (this.state.busy) return;
    // An unresolved creation keeps its identifier even after closing its dialog.
    this.update({ busy: false, dialog: null });
  };
  private isDisposed(): boolean {
    return this.disposed;
  }
  start = async (): Promise<boolean> => {
    if (this.disposed || this.state.busy) return false;
    this.update({ busy: true, dialog: null });
    try {
      if (!this.createdId) {
        const states = await Promise.all(
          this.connections.map(
            async (connection) => await this.port.readConnection(connection.id).result,
          ),
        );
        if (this.isDisposed()) return false;
        if (!states.some((state) => state.ok && state.value.state === "connected")) {
          if (states.some((state) => !state.ok)) throw new Error("Connection state unavailable.");
          this.update({ busy: false, dialog: "connection" });
          return false;
        }
      }
      if (!this.createdId) {
        const outcome = await this.port
          .createProject((this.operationId ??= this.nextId()))
          .result.catch(() => failure("invalid_service_result"));
        if (this.isDisposed()) return false;
        if (!outcome.ok) {
          const uncertain = [
            "uncertain",
            "timeout",
            "cancelled",
            "disposed",
            "invalid_service_result",
          ].includes(outcome.error.code);
          this.update({ busy: false, dialog: uncertain ? "uncertain" : "failed" });
          return false;
        }
        this.createdId = outcome.value.resultId;
      }
      const conversations = await this.port.listConversations({
        projectId: this.createdId,
        cursor: null,
        count: 1,
      }).result;
      if (this.isDisposed()) return false;
      if (!conversations.ok || !conversations.value.items[0])
        throw new Error("Created project could not be opened.");
      this.onCreated({
        projectId: this.createdId,
        conversationId: conversations.value.items[0].id,
      });
      this.operationId = undefined;
      this.createdId = undefined;
      this.update({ busy: false, dialog: null });
      return true;
    } catch {
      this.update({
        busy: false,
        dialog: this.createdId ? "openingFailed" : this.operationId ? "uncertain" : "failed",
      });
      return false;
    }
  };
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
