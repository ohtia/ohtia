import type {
  FoundationPort,
  ResearchEvent,
  ResearchScope,
  ConversationCursor,
  ProjectAttentionPage,
  ReplyAgent,
  Outcome,
  ResearchOutputs,
} from "@ohtia/contracts";

type AlertSource = "conversation" | "plan";
export interface ActivityState {
  readonly projects: ReadonlySet<string>;
  readonly chat: { readonly replies: number; readonly attention: number };
  readonly history: { readonly replies: number; readonly attention: number };
  readonly replyAnnouncement?: {
    readonly key: number;
    readonly count: number;
    readonly agent?: ReplyAgent;
  };
  readonly alerts: readonly { readonly key: number; readonly source: AlertSource }[];
}

export class ActivityController {
  private scope: ResearchScope = { projectId: null, conversationId: null };
  private visible = false;
  private focused = false;
  private readonly unreadByProject = new Map<string, Map<string, number>>();
  private attended = new Map<string, boolean>();
  private projects = new Set<string>();
  private revision: number | undefined;
  private session = 0;
  private queue = Promise.resolve();
  private attentionRetry: ReturnType<typeof setTimeout> | undefined;
  private attentionRetryDelay = 250;
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private clearAlerts: ReturnType<typeof setTimeout> | undefined;
  private key = 0;
  private readonly listeners = new Set<() => void>();
  private state: ActivityState = {
    projects: this.projects,
    alerts: [],
    chat: { replies: 0, attention: 0 },
    history: { replies: 0, attention: 0 },
  };

  constructor(private readonly port: FoundationPort) {}

  snapshot = (): ActivityState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(
    announcement?: Partial<Pick<ActivityState, "alerts" | "replyAnnouncement">>,
  ): void {
    const project = this.scope.projectId;
    const current = this.scope.conversationId;
    const unread = project ? this.unreadByProject.get(project) : undefined;
    let replies = 0;
    let conversations = 0;
    for (const [id, count] of unread ?? []) {
      replies += count;
      if (id !== current) conversations++;
    }
    const attended = [...this.attended.values()].filter(Boolean).length;
    const chat = { replies, attention: project && this.projects.has(project) ? 1 : 0 };
    const history = {
      replies: conversations,
      attention: attended - Number(!!(current && this.attended.get(current))),
    };
    if (
      !announcement &&
      this.state.projects === this.projects &&
      this.state.chat.replies === chat.replies &&
      this.state.chat.attention === chat.attention &&
      this.state.history.replies === history.replies &&
      this.state.history.attention === history.attention
    )
      return;
    this.state = { ...this.state, ...announcement, projects: this.projects, chat, history };
    for (const listener of this.listeners) listener();
  }

  private viewing(): boolean {
    return this.visible && this.focused;
  }

  private clearViewed(): boolean {
    const { projectId, conversationId } = this.scope;
    return (
      this.viewing() &&
      !!projectId &&
      !!conversationId &&
      (this.unreadByProject.get(projectId)?.delete(conversationId) ?? false)
    );
  }

  presentation(visible: boolean, focused: boolean): void {
    this.visible = visible;
    this.focused = focused;
    if (this.clearViewed()) this.publish();
  }

  open(scope: ResearchScope): void {
    this.disconnect();
    if (scope.projectId !== this.scope.projectId) {
      this.attended.clear();
      this.resetReplyBatch();
    }
    if (
      scope.projectId !== this.scope.projectId ||
      scope.conversationId !== this.scope.conversationId
    )
      this.visible = false;
    this.scope = scope;
    this.publish();
  }

  disconnect(): void {
    this.session++;
    this.queue = Promise.resolve();
    this.clearAttentionRetry();
  }

  private clearAttentionRetry(): void {
    if (this.attentionRetry) clearTimeout(this.attentionRetry);
    this.attentionRetry = undefined;
    this.attentionRetryDelay = 250;
  }

  private retryAttention(session: number): void {
    if (session !== this.session || this.attentionRetry) return;
    this.attentionRetry = setTimeout(() => {
      this.attentionRetry = undefined;
      this.ready();
    }, this.attentionRetryDelay);
    this.attentionRetryDelay = Math.min(2000, this.attentionRetryDelay * 2);
  }

  private resetReplyBatch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = 0;
  }

  private enqueue(work: (session: number) => Promise<void>): void {
    const session = this.session;
    this.queue = this.queue
      .then(async () => {
        if (this.session === session) await work(session);
      })
      .catch(() => {
        // Port failures retry in the read methods. An unexpected exception must not interrupt queued events.
      });
  }

  ready(): void {
    this.enqueue(async (session) => {
      await this.readProjects(session);
    });
  }

  event(event: ResearchEvent): void {
    switch (event.kind) {
      case "replyFinished":
        if (event.projectId === this.scope.projectId)
          this.reply(event.projectId, event.conversationId, event.agentId);
        break;
      case "attentionRaised":
        this.publish({ alerts: [...this.state.alerts, { key: ++this.key, source: event.source }] });
        if (this.clearAlerts) clearTimeout(this.clearAlerts);
        this.clearAlerts = setTimeout(() => {
          this.clearAlerts = undefined;
          this.publish({ alerts: [] });
        }, 10000);
        break;
      case "projectAttention":
        this.enqueue(async (session) => {
          if (this.revision !== event.revision) await this.readProjects(session);
        });
        break;
      case "changed":
        if (event.record === "conversation")
          this.enqueue(async (session) => {
            await this.readConversation(session, event.id);
          });
        break;
    }
  }

  private reply(project: string, conversation: string, agent: ReplyAgent): void {
    if (this.viewing() && conversation === this.scope.conversationId) {
      this.publish({ replyAnnouncement: { key: ++this.key, count: 1, agent } });
      return;
    }
    let unread = this.unreadByProject.get(project);
    if (!unread) {
      unread = new Map();
      this.unreadByProject.set(project, unread);
    }
    unread.set(conversation, (unread.get(conversation) ?? 0) + 1);
    this.pending++;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const count = this.pending;
      this.pending = 0;
      this.publish({ replyAnnouncement: { key: ++this.key, count } });
    }, 2000);
    this.publish();
  }

  private async readProjects(session: number): Promise<void> {
    let page: ProjectAttentionPage | undefined;
    let ids = new Set<string>();
    do {
      const result = await this.port.listProjectAttention({
        cursor: page ? page.next : null,
        count: 128,
      }).result;
      if (session !== this.session) return;
      if (!result.ok) {
        this.retryAttention(session);
        return;
      }
      if (page && page.revision !== result.value.revision) {
        page = undefined;
        ids = new Set();
        continue;
      }
      page = result.value;
      for (const id of page.items) ids.add(id);
      if (!page.hasMore) break;
    } while (session === this.session);

    if (!page || session !== this.session) return;
    if (ids.size !== this.projects.size || [...ids].some((id) => !this.projects.has(id)))
      this.projects = ids;
    this.publish();
    if (await this.readConversations(session)) {
      if (session !== this.session) return;
      this.revision = page.revision;
      this.clearAttentionRetry();
    } else this.retryAttention(session);
  }

  private async readConversations(session: number): Promise<boolean> {
    const { projectId } = this.scope;
    const attention = new Map<string, boolean>();
    if (projectId && this.projects.has(projectId)) {
      let cursor: ConversationCursor | null = null;
      do {
        const page: Outcome<ResearchOutputs["conversation.list"]> =
          await this.port.listConversations({ projectId, cursor, count: 50 }).result;
        if (this.session !== session || !page.ok) return false;
        for (const row of page.value.items) attention.set(row.id, row.status === "attention");
        cursor = page.value.next;
      } while (cursor);
    }
    if (this.session !== session) return false;
    this.attended = attention;
    this.publish();
    return true;
  }

  private async readConversation(session: number, id: string): Promise<void> {
    const { projectId } = this.scope;
    if (!projectId || !this.projects.has(projectId)) return;
    const result = await this.port.readConversations({ projectId, ids: [id] }).result;
    const row = result.ok ? result.value.items[0] : undefined;
    if (this.session !== session) return;
    if (!row) {
      this.retryAttention(session);
      return;
    }
    this.attended.set(id, row.status === "attention");
    this.publish();
  }

  dispose(): void {
    this.disconnect();
    this.resetReplyBatch();
    if (this.clearAlerts) clearTimeout(this.clearAlerts);
    this.listeners.clear();
  }
}
