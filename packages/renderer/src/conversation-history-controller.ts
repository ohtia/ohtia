import {
  compareConversations,
  type ConversationCursor,
  type ConversationSummary,
  type FoundationPort,
} from "@ohtia/contracts";

export interface HistoryState {
  readonly projectId: string | null;
  readonly visible: boolean;
  readonly status: "loading" | "ready" | "failed" | "unavailable";
  readonly items: readonly ConversationSummary[];
  readonly next: ConversationCursor | null;
  readonly loadingOlder: boolean;
  readonly failedOlder: boolean;
}

const empty = (projectId: string | null): HistoryState => ({
  projectId,
  visible: false,
  status: "loading",
  items: [],
  next: null,
  loadingOlder: false,
  failedOlder: false,
});
const pageSize = 50;
const unavailable = (code: unknown) => code === "service_unavailable" || code === "disposed";

/** Window-owned history. The immutable cursor bounds the range already paged in. */
export class ConversationHistoryController {
  private state = empty(null);
  private readonly listeners = new Set<() => void>();
  private readonly rows = new Map<string, ConversationSummary>();
  private readonly changes = new Map<string, number>();
  private queue = Promise.resolve();
  private epoch = 0;
  private active = false;
  private connectionProblem: "failed" | "unavailable" | null = null;
  private refreshing = false;
  private initialized = false;
  private loaded = false;
  private scheduled = false;
  constructor(
    private readonly port: FoundationPort,
    private readonly reconnect: () => void,
  ) {}
  snapshot = (): HistoryState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<HistoryState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  scope(projectId: string | null): void {
    this.epoch++;
    this.queue = Promise.resolve();
    this.scheduled = false;
    this.changes.clear();
    this.active = false;
    this.refreshing = false;
    this.connectionProblem = null;
    if (projectId !== this.state.projectId) {
      this.rows.clear();
      this.initialized = false;
      this.loaded = false;
      this.update(empty(projectId));
    } else if (this.state.loadingOlder) {
      this.update({ loadingOlder: false });
    }
  }
  connected(): void {
    this.active = true;
    if (this.initialized) this.reload();
  }
  disconnected(code: string): void {
    this.scope(this.state.projectId);
    this.connectionProblem = unavailable(code) ? "unavailable" : "failed";
    if (this.initialized) this.update({ status: this.connectionProblem });
  }
  show = (): void => {
    if (!this.state.projectId || this.state.visible) return;
    this.update({ visible: true });
    this.ensureLoaded();
  };
  ensureLoaded = (): void => {
    if (!this.state.projectId || this.initialized) return;
    this.initialized = true;
    if (this.active) this.reload();
    else this.update({ status: this.connectionProblem ?? "loading" });
  };
  hide = (): void => {
    if (this.state.visible) this.update({ visible: false });
  };
  reload = (): void => {
    if (!this.active) {
      if (this.connectionProblem === "failed") {
        this.update({ status: "loading" });
        this.reconnect();
      }
      return;
    }
    if (this.refreshing || this.state.loadingOlder) return;
    this.refreshing = true;
    if (!this.loaded || this.state.status !== "ready")
      this.update({ status: "loading", failedOlder: false });
    this.enqueue(async (projectId, epoch) => {
      try {
        const previous = this.state.next;
        const covered = this.loaded;
        const held = this.state.items.map((item) => item.id);
        const reads = new Map<string, ConversationSummary>();
        if (held.length) await this.read(projectId, held, epoch, reads);
        let next: ConversationCursor | null = null;
        do {
          if (epoch !== this.epoch) return;
          next = await this.page(projectId, next, epoch, reads);
        } while (next && covered && (!previous || compareConversations(next, previous) > 0));
        if (epoch !== this.epoch) return;
        this.accept(reads);
        this.loaded = true;
        // Recovery revalidates the visible range without revealing an older page.
        const frontier =
          previous &&
          (next || [...reads.values()].some((item) => compareConversations(item, previous) < 0))
            ? previous
            : next;
        this.publish(frontier, { status: "ready" });
      } catch (error) {
        this.fail(epoch, error, false);
      } finally {
        if (epoch === this.epoch) this.refreshing = false;
      }
    });
  };
  loadOlder = (): void => {
    if (
      !this.active ||
      this.state.status !== "ready" ||
      !this.state.next ||
      this.state.loadingOlder
    )
      return;
    this.update({ loadingOlder: true, failedOlder: false });
    this.enqueue(async (projectId, epoch) => {
      const cursor = this.state.next;
      if (!cursor || this.state.status !== "ready") {
        this.update({ loadingOlder: false });
        return;
      }
      try {
        const reads = new Map<string, ConversationSummary>();
        const next = await this.page(projectId, cursor, epoch, reads);
        if (epoch !== this.epoch) return;
        this.accept(reads);
        this.publish(next, { loadingOlder: false });
      } catch (error) {
        this.fail(epoch, error, true);
      }
    });
  };
  changed(id: string, revision: number): void {
    if (!this.initialized || !this.active || (this.rows.get(id)?.revision ?? 0) >= revision) return;
    this.changes.set(id, Math.max(this.changes.get(id) ?? 0, revision));
    if (this.scheduled) return;
    this.scheduled = true;
    this.enqueue(async (projectId, epoch) => {
      this.scheduled = false;
      const ids = [...this.changes].flatMap(([id, revision]) =>
        (this.rows.get(id)?.revision ?? 0) < revision ? [id] : [],
      );
      this.changes.clear();
      try {
        const reads = new Map<string, ConversationSummary>();
        await this.read(projectId, ids, epoch, reads);
        if (epoch !== this.epoch) return;
        this.accept(reads);
        if (this.loaded) this.publish(this.state.next);
      } catch (error) {
        this.fail(epoch, error, false);
      }
    });
  }
  dispose(): void {
    this.listeners.clear();
    this.scope(null);
  }
  private enqueue(work: (projectId: string, epoch: number) => Promise<void>): void {
    const { projectId } = this.state;
    const epoch = this.epoch;
    if (projectId)
      this.queue = this.queue.then(async () => {
        if (epoch === this.epoch) await work(projectId, epoch);
      });
  }
  private fail(epoch: number, error: unknown, older: boolean): void {
    if (epoch !== this.epoch) return;
    const lost = error instanceof Error && "code" in error && unavailable(error.code);
    this.update({
      ...(lost ? { status: "unavailable" } : older ? { failedOlder: true } : { status: "failed" }),
      loadingOlder: false,
    });
  }
  private accept(incoming: ReadonlyMap<string, ConversationSummary>): void {
    for (const [id, item] of incoming)
      if ((this.rows.get(id)?.revision ?? 0) <= item.revision) this.rows.set(id, item);
  }
  private publish(next: ConversationCursor | null, patch: Partial<HistoryState> = {}): void {
    this.update({
      ...patch,
      next,
      items: [...this.rows.values()]
        .filter((item) => !next || compareConversations(item, next) >= 0)
        .sort((a, b) => compareConversations(b, a)),
    });
  }
  private async read(
    projectId: string,
    ids: readonly string[],
    epoch: number,
    output: Map<string, ConversationSummary>,
  ): Promise<void> {
    for (let start = 0; start < ids.length; start += 128) {
      let remaining = ids.slice(start, start + 128);
      while (remaining.length && epoch === this.epoch) {
        const result = await this.port.readConversations({ projectId, ids: remaining }).result;
        if (!result.ok) throw Object.assign(new Error("Conversation read failed."), result.error);
        if (result.value.remaining.length >= remaining.length)
          throw new Error("Conversation read made no progress.");
        this.collect(projectId, result.value.items, output);
        remaining = [...result.value.remaining];
      }
    }
  }
  private collect(
    projectId: string,
    items: readonly ConversationSummary[],
    output: Map<string, ConversationSummary>,
  ): void {
    for (const item of items) {
      if (item.projectId !== projectId) throw new Error("Invalid conversation scope.");
      output.set(item.id, item);
    }
  }
  private async page(
    projectId: string,
    cursor: ConversationCursor | null,
    epoch: number,
    output: Map<string, ConversationSummary>,
  ): Promise<ConversationCursor | null> {
    let count = pageSize;
    do {
      const result = await this.port.listConversations({ projectId, cursor, count }).result;
      if (epoch !== this.epoch) return null;
      if (!result.ok) throw Object.assign(new Error("Conversation page failed."), result.error);
      const { items, next } = result.value;
      if (next && (!items.length || (cursor && compareConversations(next, cursor) >= 0)))
        throw new Error("Conversation page made no progress.");
      this.collect(projectId, items, output);
      count -= items.length;
      cursor = next;
    } while (cursor && count > 0);
    return cursor;
  }
}
