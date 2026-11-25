import {
  projectTitleError,
  type CommandReason,
  type Outcome,
  type RenameProjectResult,
  type ResearchInputs,
  type FoundationPort,
  type ProjectRecord,
  type ProjectCursor,
  type ResearchScope,
} from "@ohtia/contracts";

export interface ProjectRenameDraft {
  readonly projectId: string;
  readonly text: string;
  readonly expectedTitleRevision: number;
  readonly busy: boolean;
  readonly intent?:
    | {
        readonly operationId: string;
        readonly input: ResearchInputs["project.rename"];
      }
    | undefined;
  readonly needsRevision?: boolean | undefined;
  readonly confirmedTitle?: string | undefined;
  readonly notice?: "invalid" | "stale" | "uncertain" | "failed" | "readFailed" | undefined;
}

export function latestProject(
  current: ProjectRecord | undefined,
  incoming: ProjectRecord | undefined,
): ProjectRecord | undefined {
  if (!incoming) return current;
  if (!current || current.id !== incoming.id) return incoming;
  if (
    current.setupConfirmedAt &&
    (!incoming.setupConfirmedAt || current.titleRevision > incoming.titleRevision)
  )
    return current;
  return incoming;
}

export interface ProjectState {
  readonly rename: ProjectRenameDraft | null;
  readonly renameSaved: number;
  readonly renameRefreshFailed: boolean;
  readonly renameRefreshFailures: number;
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
    rename: null,
    renameSaved: 0,
    renameRefreshFailed: false,
    renameRefreshFailures: 0,
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
  private readonly renameDrafts = new Map<string, ProjectRenameDraft>();
  private renameProject: ProjectRecord | undefined;
  private pendingTitleRefresh: { projectId: string; titleRevision: number } | undefined;
  private renameRefreshing = false;
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
      "listProjects" | "listConversations" | "openProject" | "renameProject" | "readProject"
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
  forgetProjectRecords(): void {
    this.advanceSelection();
    this.renameProject = undefined;
    this.knownProjects.clear();
    this.projectExists = false;
    this.listEpoch++;
    this.update({
      items: [],
      next: null,
      hasProjects: false,
      failed: false,
      failedMore: false,
      loading: false,
      loadingMore: false,
    });
    if (this.hasListed) void this.load();
  }
  prepareRename = (project: ProjectRecord | undefined): void => {
    const previous = this.renameProject;
    this.renameProject = project;
    const pending = this.pendingTitleRefresh;
    if (
      this.state.renameRefreshFailed &&
      pending &&
      project &&
      project.id === pending.projectId &&
      project.titleRevision >= pending.titleRevision
    ) {
      this.pendingTitleRefresh = undefined;
      this.update({ renameRefreshFailed: false });
      return;
    }
    if (previous === project) return;
    if (
      !previous ||
      !project ||
      previous.id !== project.id ||
      Boolean(previous.setupConfirmedAt) !== Boolean(project.setupConfirmedAt)
    )
      this.update({});
  };
  renameReason = (): CommandReason | undefined =>
    !this.renameProject
      ? "no_project"
      : !this.renameProject.setupConfirmedAt
        ? "project_in_setup"
        : this.state.rename
          ? "modal_open"
          : undefined;
  beginRename = (): boolean => {
    const project = this.renameProject;
    if (!project || project.title === null || this.renameReason()) return false;
    const draft = this.renameDrafts.get(project.id) ?? {
      projectId: project.id,
      text: project.title,
      expectedTitleRevision: project.titleRevision,
      busy: false,
    };
    this.update({ rename: draft });
    return true;
  };
  editRename = (text: string): void => {
    const draft = this.state.rename;
    if (!draft || draft.busy || draft.intent) return;
    this.update({
      rename: { ...draft, text, notice: draft.notice === "invalid" ? undefined : draft.notice },
    });
  };
  closeRename = (): void => {
    const draft = this.state.rename;
    if (!draft || draft.busy) return;
    if (draft.intent) this.renameDrafts.set(draft.projectId, draft);
    else this.renameDrafts.delete(draft.projectId);
    this.update({ rename: null });
  };
  private advanceSelection(): number {
    const draft = this.state.rename;
    if (draft)
      this.renameDrafts.set(draft.projectId, {
        ...draft,
        busy: false,
        ...(draft.intent ? { notice: "uncertain" } : {}),
      });
    this.pendingTitleRefresh = undefined;
    this.renameRefreshing = false;
    const epoch = ++this.selectionEpoch;
    this.update({ rename: null, renameRefreshFailed: false });
    return epoch;
  }
  private cacheProject(project: ProjectRecord): ProjectRecord {
    const latest = latestProject(this.knownProjects.get(project.id), project) ?? project;
    this.knownProjects.set(project.id, latest);
    return latest;
  }
  private showProjectTitle(project: ProjectRecord, patch: Partial<ProjectState>): void {
    const latest = this.cacheProject(project);
    this.update({
      ...patch,
      items: this.state.items.map((row) => latestProject(latest, row) ?? row),
    });
  }
  saveRename = async (): Promise<void> => {
    const draft = this.state.rename;
    const project = this.renameProject;
    if (!draft || draft.busy || !project || project.id !== draft.projectId) return;
    if (!draft.needsRevision && projectTitleError(draft.text)) {
      this.update({ rename: { ...draft, notice: "invalid" } });
      return;
    }
    const epoch = this.selectionEpoch;
    const current = () => !this.disposed && this.selectionEpoch === epoch;
    if (draft.needsRevision) {
      this.update({ rename: { ...draft, busy: true } });
      const latest = await this.readTitle(draft.projectId);
      if (!current()) return;
      if (latest && latest.title !== null) {
        this.showProjectTitle(latest, {
          rename: {
            ...draft,
            expectedTitleRevision: latest.titleRevision,
            confirmedTitle: latest.title,
            needsRevision: false,
            notice: "stale",
          },
        });
      } else this.update({ rename: { ...draft, notice: "readFailed" } });
      return;
    }
    const intent = draft.intent ?? {
      operationId: crypto.randomUUID(),
      input: {
        projectId: draft.projectId,
        title: draft.text,
        expectedTitleRevision: draft.expectedTitleRevision,
      },
    };
    this.update({ rename: { ...draft, intent, busy: true, notice: undefined } });
    let result: Outcome<RenameProjectResult> | undefined;
    try {
      result = await this.port.renameProject(intent.operationId, intent.input).result;
    } catch {
      // Transport failure can occur after the service commits the operation.
    }
    if (!current()) return;
    if (result?.ok) {
      const confirmed = { ...project, ...result.value.titleChange };
      this.renameDrafts.delete(draft.projectId);
      this.showProjectTitle(confirmed, {
        rename: null,
        renameSaved: this.state.renameSaved + 1,
        renameRefreshFailed: false,
      });
      if (current()) await this.refreshTitleAt(confirmed.id, confirmed.titleRevision);
      return;
    }
    const code = result?.error.code;
    const uncertain =
      !code ||
      code === "uncertain" ||
      code === "invalid_service_result" ||
      (draft.intent !== undefined &&
        code !== "stale_revision" &&
        code !== "operation_conflict" &&
        code !== "name_invalid" &&
        code !== "record_not_found" &&
        code !== "project_in_setup" &&
        code !== "limit_reached");
    this.update({
      rename: {
        ...draft,
        intent: uncertain ? intent : undefined,
        needsRevision: code === "stale_revision",
        notice: uncertain
          ? "uncertain"
          : code === "stale_revision"
            ? "stale"
            : code === "name_invalid"
              ? "invalid"
              : "failed",
      },
    });
  };
  private async readTitle(projectId: string): Promise<ProjectRecord | undefined> {
    try {
      const result = await this.port.readProject({ projectId }).result;
      return result.ok ? result.value : undefined;
    } catch {
      return;
    }
  }
  noteProjectTitle(projectId: string, titleRevision: number): void {
    if (this.disposed || (this.project(projectId)?.titleRevision ?? 0) >= titleRevision) return;
    void this.refreshTitleAt(projectId, titleRevision);
  }
  private refreshTitleAt(projectId: string, titleRevision: number): Promise<void> {
    const pending = this.pendingTitleRefresh;
    if (!pending || pending.projectId !== projectId || pending.titleRevision < titleRevision)
      this.pendingTitleRefresh = { projectId, titleRevision };
    return this.refreshTitle();
  }
  refreshTitle = async (): Promise<void> => {
    const pending = this.pendingTitleRefresh;
    if (!pending || this.renameRefreshing) return;
    const epoch = this.selectionEpoch;
    this.renameRefreshing = true;
    const project = await this.readTitle(pending.projectId);
    if (this.disposed || epoch !== this.selectionEpoch) return;
    this.renameRefreshing = false;
    if (this.pendingTitleRefresh !== pending) return this.refreshTitle();
    if (project && project.titleRevision >= pending.titleRevision) {
      this.pendingTitleRefresh = undefined;
      this.showProjectTitle(project, { renameRefreshFailed: false });
      return;
    }
    this.update({
      renameRefreshFailed: true,
      renameRefreshFailures: this.state.renameRefreshFailures + 1,
    });
  };
  beginCreation = (): number => {
    this.restoreEpoch = undefined;
    this.update({ openingFailed: null });
    return this.advanceSelection();
  };
  adopt(scope: ResearchScope, expectedRevision = this.selectionEpoch): boolean {
    if (this.disposed) return false;
    if (expectedRevision !== this.selectionEpoch) {
      this.noteProject();
      return false;
    }
    const refresh = this.hasListed;
    this.advanceSelection();
    this.restoreEpoch = undefined;
    ++this.listEpoch;
    this.renameProject = undefined;
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
      for (const project of items) this.cacheProject(project);
      const confirmedItems = items.map((row) => this.knownProjects.get(row.id) ?? row);
      this.update({
        items: more ? [...this.state.items, ...confirmedItems] : confirmedItems,
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
    const epoch = this.advanceSelection();
    this.restoreEpoch = undefined;
    this.update({ openingFailed: null });
    try {
      let conversationId = this.conversations.get(projectId);
      if (conversationId === undefined) {
        const page = await this.port.listConversations({ projectId, cursor: null, count: 1 })
          .result;
        if (this.isDisposed() || epoch !== this.selectionEpoch) return;
        if (!page.ok || !page.value.items[0]) throw new Error("Project conversation unavailable.");
        conversationId = page.value.items[0].id;
      }
      if (this.isDisposed() || epoch !== this.selectionEpoch) return;
      this.advanceSelection();
      this.renameProject = undefined;
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
