import {
  type FoundationPort,
  type ProjectRecord,
  type ProjectCursor,
  type ResearchScope,
} from "@ohtia/contracts";
import type { ConversationController } from "./conversation-controller.js";
import type { HistoryState } from "./conversation-history-controller.js";

interface ProjectCollectionsSnapshot {
  readonly scope: ResearchScope;
  readonly conversations: HistoryState | undefined;
}

/** Project-scoped presentation of the existing conversation and memory collections. */
export class ProjectCollections {
  private state: ProjectCollectionsSnapshot | undefined;

  constructor(
    private readonly conversation: Pick<
      ConversationController,
      "snapshot" | "subscribe" | "history" | "switchConversation" | "observe"
    >,
  ) {}

  snapshot = (): ProjectCollectionsSnapshot => {
    const { scope } = this.conversation.snapshot();
    const history = this.conversation.history.snapshot();
    const conversations =
      scope.projectId && history.projectId === scope.projectId ? history : undefined;
    if (
      this.state &&
      this.state.scope.projectId === scope.projectId &&
      this.state.scope.conversationId === scope.conversationId &&
      this.state.conversations === conversations
    )
      return this.state;
    return (this.state = { scope, conversations });
  };

  subscribe = (listener: () => void): (() => void) => {
    let current = this.snapshot();
    const update = () => {
      const next = this.snapshot();
      if (next !== current) {
        current = next;
        listener();
      }
    };
    const stopSelection = this.conversation.subscribe(update);
    const stopHistory = this.conversation.history.subscribe(update);
    return () => {
      stopSelection();
      stopHistory();
    };
  };

  observeMemory: ConversationController["observe"] = (listener) =>
    this.conversation.observe((notice) => {
      if (
        notice === "ready" ||
        !notice.ok ||
        (notice.value.kind === "changed" &&
          notice.value.record === "memory" &&
          notice.value.id === this.conversation.snapshot().scope.projectId)
      )
        listener(notice);
    });

  loadConversations(projectId: string, action: "initial" | "retry" | "older"): void {
    if (this.snapshot().conversations?.projectId !== projectId) return;
    const { history } = this.conversation;
    if (action === "initial") history.ensureLoaded();
    else if (action === "retry") history.reload();
    else history.loadOlder();
  }

  openConversation(projectId: string, id: string): boolean {
    const { conversations } = this.snapshot();
    if (
      !conversations ||
      conversations.projectId !== projectId ||
      conversations.status !== "ready" ||
      !conversations.items.some((item) => item.id === id)
    )
      return false;
    this.conversation.switchConversation(id);
    return true;
  }
}

export interface ProjectState {
  readonly items: readonly ProjectRecord[];
  readonly next: ProjectCursor | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly failed: boolean;
  readonly failedMore: boolean;
  readonly hasProjects: boolean;
  readonly openingFailed: string | null;
  readonly failureRevision: number;
  readonly firstPageRevision: number;
}
/** Window-local selection; selecting a project neither owns nor stops durable work. */
export class ProjectController {
  private state: ProjectState = {
    items: [],
    next: null,
    loading: false,
    loadingMore: false,
    failed: false,
    failedMore: false,
    hasProjects: false,
    openingFailed: null,
    failureRevision: 0,
    firstPageRevision: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly conversations = new Map<string, string | null>();
  private listEpoch = 0;
  private selectionEpoch = 0;
  private restoreEpoch: number | undefined;
  private readonly knownProjects = new Map<string, ProjectRecord>();
  private disposed = false;
  private isDisposed(): boolean {
    return this.disposed;
  }
  private initialized = false;
  private hasListed = false;
  private projectExists = false;
  noteProject = (): void => {
    this.projectExists = true;
    this.update({ hasProjects: true });
  };
  constructor(
    private readonly port: Pick<
      FoundationPort,
      "listProjects" | "listConversations" | "openProject"
    >,
    private readonly select: (scope: ResearchScope) => void,
  ) {}
  snapshot = (): ProjectState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<ProjectState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  remember(scope: ResearchScope): void {
    if (scope.projectId) this.conversations.set(scope.projectId, scope.conversationId);
  }
  rememberStarted(scope: ResearchScope): void {
    if (scope.projectId && this.conversations.get(scope.projectId) === null) this.remember(scope);
  }
  project(id: string | null): ProjectRecord | undefined {
    return id ? this.knownProjects.get(id) : undefined;
  }
  beginCreation = (): number => {
    this.restoreEpoch = undefined;
    this.update({ openingFailed: null });
    return ++this.selectionEpoch;
  };
  adopt(scope: ResearchScope, expectedRevision = this.selectionEpoch): boolean {
    if (this.disposed) return false;
    if (expectedRevision !== this.selectionEpoch) {
      this.noteProject();
      return false;
    }
    const refresh = this.hasListed;
    ++this.selectionEpoch;
    this.restoreEpoch = undefined;
    ++this.listEpoch;
    this.remember(scope);
    this.projectExists = true;
    this.update({ hasProjects: true, openingFailed: null, loading: refresh, loadingMore: false });
    this.select(scope);
    if (scope.projectId) void this.recordOpening(scope.projectId);
    if (refresh) void this.load();
    return true;
  }
  private async recordOpening(projectId: string): Promise<void> {
    // An ordering write must never roll back the window's successful selection.
    try {
      await this.port.openProject(crypto.randomUUID(), { projectId }).result;
    } catch {
      /* A later opening retries the ordering write with a new intent. */
    }
  }
  initialize = async (restoreLast: boolean): Promise<void> => {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    if (restoreLast) this.restoreEpoch = this.selectionEpoch;
    await this.load();
  };
  load = async (more = false): Promise<ProjectRecord | undefined> => {
    if (
      this.disposed ||
      (more && (this.state.loading || this.state.loadingMore || !this.state.next))
    )
      return;
    this.hasListed = true;
    const epoch = ++this.listEpoch;
    const cursor = more ? this.state.next : null;
    this.update(
      more
        ? { loadingMore: true, failedMore: false }
        : {
            items: [],
            next: null,
            firstPageRevision: this.state.firstPageRevision + 1,
            loading: true,
            loadingMore: false,
            failed: false,
            failedMore: false,
          },
    );
    try {
      const items: ProjectRecord[] = [];
      let next = cursor;
      do {
        const page = await this.port.listProjects({ cursor: next, count: 40 - items.length })
          .result;
        if (this.isDisposed() || epoch !== this.listEpoch) return;
        if (!page.ok) throw new Error("Projects unavailable.");
        items.push(...page.value.items);
        next = page.value.next;
        if (next && page.value.items.length === 0) throw new Error("Project page did not advance.");
      } while (next && items.length < 40);
      if (!more && items.length === 0 && this.projectExists)
        throw new Error("Project list changed during the read.");
      for (const project of items) this.knownProjects.set(project.id, project);
      this.update({
        items: more ? [...this.state.items, ...items] : items,
        next,
        hasProjects: this.projectExists || more || items.length > 0,
        loading: false,
        loadingMore: false,
      });
      if (items.length) this.projectExists = true;
      if (!more && this.restoreEpoch !== undefined && this.restoreEpoch === this.selectionEpoch) {
        this.restoreEpoch = undefined;
        if (items[0]) await this.open(items[0].id);
      }
      return items[0];
    } catch {
      if (epoch === this.listEpoch)
        this.update(
          more
            ? { loadingMore: false, failedMore: true }
            : { loading: false, failed: true, failureRevision: this.state.failureRevision + 1 },
        );
      return;
    }
  };
  open = async (projectId: string): Promise<void> => {
    if (this.disposed) return;
    const epoch = ++this.selectionEpoch;
    this.restoreEpoch = undefined;
    this.update({ openingFailed: null });
    try {
      let conversationId = this.conversations.get(projectId);
      if (conversationId === undefined) {
        const page = await this.port.listConversations({ projectId, cursor: null, count: 1 })
          .result;
        if (this.isDisposed() || epoch !== this.selectionEpoch) return;
        if (!page.ok) throw new Error("Project conversation unavailable.");
        conversationId = page.value.items[0]?.id ?? null;
      }
      if (this.isDisposed() || epoch !== this.selectionEpoch) return;
      this.remember({ projectId, conversationId });
      this.select({ projectId, conversationId });
      void this.recordOpening(projectId);
    } catch {
      if (epoch === this.selectionEpoch)
        this.update({ openingFailed: projectId, failureRevision: this.state.failureRevision + 1 });
    }
  };
  dispose(): void {
    this.disposed = true;
    this.listEpoch++;
    this.selectionEpoch++;
    this.listeners.clear();
  }
}
