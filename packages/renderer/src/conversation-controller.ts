import { ComposerController } from "./composer-controller.js";
import {
  mergeTimeline,
  chatgptConnection,
  type PauseCounts,
  type ProjectRecord,
  type TimelineSetupProposal,
  type ProviderDeclaration,
  type TimelineTask,
  failure,
  compareTimeline,
  portLimits,
  utf8Size,
  type Outcome,
  type ResearchOutputs,
  type ConversationSummary,
  type FoundationPort,
  type ResearchEvent,
  type ResearchScope,
  type Subscription,
  type TimelineCursor,
  type TimelineItem,
  type TextReference,
} from "@ohtia/contracts";
export type TaskAction = "resume" | "continue" | "retry" | "restart";
export interface ConversationState {
  readonly pauses?: PauseCounts;
  readonly project?: ProjectRecord;
  readonly setupActions?: ReadonlyMap<
    string,
    { readonly busy: boolean; readonly action: "confirm" | "reject"; readonly error?: string }
  >;
  readonly scope: ResearchScope;
  readonly status: "loading" | "ready" | "failed" | "unavailable";
  readonly conversation?: ConversationSummary;
  readonly items: readonly TimelineItem[];
  readonly texts: ReadonlyMap<string, string>;
  readonly replies: ReadonlyMap<string, { readonly sequence: number; readonly text: string }>;
  readonly next: TimelineCursor | null;
  readonly loadingEarlier: boolean;
  readonly failedEarlier: boolean;
  readonly completed: number;
}
const empty = (scope: ResearchScope): ConversationState => ({
  scope,
  status: "loading",
  items: [],
  texts: new Map(),
  replies: new Map(),
  next: null,
  loadingEarlier: false,
  failedEarlier: false,
  completed: 0,
});
export class ConversationController {
  private state: ConversationState = empty({ projectId: null, conversationId: null });
  private readonly listeners = new Set<() => void>();
  private stream: Subscription | undefined;
  private readonly observers = new Set<(notice: Outcome<ResearchEvent> | "ready") => void>();
  observe = (listener: (notice: Outcome<ResearchEvent> | "ready") => void): (() => void) => {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  };
  private observed(notice: Outcome<ResearchEvent> | "ready"): void {
    for (const listener of this.observers) listener(notice);
  }
  private epoch = 0;
  private disposed = false;
  private queue = Promise.resolve();
  private pendingReplies = new Map<string, { readonly sequence: number; readonly text: string }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private subscriptionRetry: ReturnType<typeof setTimeout> | undefined;
  private readonly cache = new Map<string, ConversationState>();
  private baselineEstablished = false;
  private readonly establishedRanges = new Map<string, TimelineCursor | null>();
  private readonly revisions = new Map<string, number>();
  private readonly noticeUpdates = new Map<string, number>();
  private readonly introducedTasks = new Map<string, string>();
  private readonly announcedNotices = new Map<string, string>();
  /** Historical reads do not announce. Live transitions are announced once per window. */
  claimTaskNotice(taskId: string, revision: number, signature: string): boolean {
    const live = (this.noticeUpdates.get(taskId) ?? 0) >= revision;
    const key = `${String(revision)}/${signature}`;
    if (this.announcedNotices.get(taskId) === key) return false;
    this.announcedNotices.set(taskId, key);
    return live;
  }
  readonly composer: ComposerController;
  constructor(
    private readonly port: FoundationPort,
    readonly connections: readonly ProviderDeclaration["connection"][] = [chatgptConnection],
  ) {
    this.composer = new ComposerController(port, undefined, connections, () => {
      this.reload();
    });
  }
  private pauseEpoch = -1;
  async refreshPauses(): Promise<void> {
    const epoch = this.epoch;
    const result = await this.port.readPauses().result;
    if (!this.live(epoch)) return;
    if (!result.ok) throw new Error("Pause counts unavailable.");
    if (this.pauseEpoch === epoch && (this.state.pauses?.revision ?? 0) > result.value.revision)
      return;
    this.pauseEpoch = epoch;
    this.state = { ...this.state, pauses: result.value };
    this.composer.pauses(result.value);
    this.publish();
  }
  async performTaskAction(
    operationId: string,
    action: TaskAction,
    task: TimelineTask,
  ): Promise<Outcome<import("@ohtia/contracts").ResearchResult>> {
    const conversationId = this.state.scope.conversationId;
    let result: Outcome<import("@ohtia/contracts").ResearchResult>;
    try {
      result = await (
        action === "resume"
          ? this.port.resumeUsagePause(operationId, { connection: task.connection as "chatgpt" })
          : action === "continue"
            ? this.port.continueAllTasks(operationId)
            : action === "retry"
              ? this.port.tryAgainTask(operationId, { taskId: task.id })
              : this.port.startAgainTask(operationId, { taskId: task.id })
      ).result;
    } catch {
      result = failure("invalid_service_result");
    }
    if (result.ok && !this.disposed) {
      if ((action === "retry" || action === "restart") && conversationId && result.value.resultId)
        this.introducedTasks.set(result.value.resultId, conversationId);
      // A failed reread cannot turn a confirmed save into another mutation.
      try {
        if (action === "resume" || action === "continue") await this.refreshPauses();
      } catch {
        this.failure(this.epoch);
      }
      this.reload();
    }
    return result;
  }
  private setupIntents = new Map<string, string>();
  private setupActions = new Map<
    string,
    { busy: boolean; action: "confirm" | "reject"; error?: string }
  >();
  performSetupAction = async (
    proposal: TimelineSetupProposal,
    action: "confirm" | "reject",
  ): Promise<void> => {
    if (this.disposed || this.setupActions.get(proposal.id)?.busy) return;
    const conversationId = this.state.scope.conversationId;
    const key = `${proposal.id}/${action}`;
    const operationId = this.setupIntents.get(key) ?? crypto.randomUUID();
    this.setupIntents.set(key, operationId);
    const update = (busy: boolean, error?: string) => {
      this.setupActions.set(proposal.id, { busy, action, ...(error ? { error } : {}) });
      if (!this.disposed && this.state.scope.conversationId === conversationId) {
        this.state = { ...this.state, setupActions: new Map(this.setupActions) };
        this.publish();
      }
    };
    update(true);
    let outcome;
    try {
      outcome = await (
        action === "confirm"
          ? this.port.confirmProjectSetup(operationId, { proposalId: proposal.id })
          : this.port.rejectProjectSetup(operationId, { proposalId: proposal.id })
      ).result;
    } catch {
      outcome = failure("invalid_service_result");
    }
    if (!this.live(this.epoch)) return;
    update(false, outcome.ok ? undefined : outcome.error.code);
    if (this.state.scope.conversationId !== conversationId) return;
    const epoch = this.epoch;
    if (outcome.ok || outcome.error.code === "proposal_not_waiting") {
      try {
        await this.readIds([proposal.id], epoch);
        await this.projects(epoch);
        if (this.live(epoch)) this.publish();
      } catch {
        this.failure(epoch);
      }
    }
  };
  snapshot = (): ConversationState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(): void {
    this.composer.setup(
      !!this.state.project?.setupConfirmedAt && !this.state.project.isDevelopment,
      this.state.items
        .filter((item) => item.kind === "setupProposal" && item.state === "proposed")
        .map((item) => item.id),
    );
    this.composer.running(
      !!this.state.conversation?.runningTask ||
        this.state.items.some(
          (item) =>
            item.kind === "task" &&
            ["queued", "blocked", "running", "cancelling"].includes(item.state),
        ),
      this.state.conversation?.runningTask?.state === "cancelling" ||
        this.state.items.some((item) => item.kind === "task" && item.state === "cancelling"),
    );
    for (const listener of this.listeners) listener();
  }
  private live(epoch: number): boolean {
    return !this.disposed && this.epoch === epoch;
  }
  private failure(epoch: number, error?: { code: string }): void {
    if (!this.live(epoch)) return;
    this.composer.destinationUnavailable();
    this.state = {
      ...this.state,
      status:
        error !== undefined && (error.code === "service_unavailable" || error.code === "disposed")
          ? "unavailable"
          : "failed",
    };
    this.publish();
  }
  private subscriptionFailure(epoch: number, error: { code: string }): void {
    if (!this.live(epoch)) return;
    const stream = this.stream;
    this.composer.destinationObservationLost();
    this.failure(epoch, error);
    if (this.live(epoch)) this.epoch++;
    stream?.dispose();
  }
  open(scope: ResearchScope): void {
    if (this.disposed) return;
    if (this.state.scope.conversationId)
      this.cache.set(this.state.scope.conversationId, this.state);
    this.composer.open(scope);
    this.composer.destinationObservationPending();
    const epoch = ++this.epoch;
    if (this.subscriptionRetry) clearTimeout(this.subscriptionRetry);
    this.subscriptionRetry = undefined;
    this.stream?.dispose();
    this.revisions.clear();
    this.baselineEstablished = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const cached = scope.conversationId ? this.cache.get(scope.conversationId) : undefined;
    this.state = cached
      ? {
          ...cached,
          loadingEarlier: false,
          status: cached.status === "ready" ? "ready" : "loading",
        }
      : empty(scope);
    this.state = { ...this.state, setupActions: new Map(this.setupActions) };
    this.pendingReplies = new Map(this.state.replies);
    this.publish();
    this.connect(epoch, false);
  }
  reload = (): void => {
    this.open(this.state.scope);
  };
  private connect(
    epoch: number,
    recovering: boolean,
    until = performance.now() + portLimits.request_deadline_ms,
    delay = 10,
  ): void {
    const replacing = this.stream !== undefined;
    this.stream?.dispose();
    const stream = this.port.subscribeResearch(this.state.scope, (notice) => {
      if (!this.live(epoch)) return;
      this.observed(notice);
      if (!this.live(epoch)) return;
      if (!notice.ok) {
        if (notice.error.code === "sequence_gap") {
          // A fresh subscription identity precedes all reads so changes during recovery remain observable.
          this.composer.destinationObservationPending();
          const recovery = ++this.epoch;
          this.state = { ...this.state, loadingEarlier: false, failedEarlier: false };
          this.publish();
          this.revisions.clear();
          this.connect(recovery, true);
        } else {
          this.subscriptionFailure(epoch, notice.error);
        }
        return;
      }
      this.queue = this.queue
        .then(async () => {
          if (this.live(epoch)) await this.event(notice.value, epoch);
        })
        .catch(() => {
          this.failure(epoch);
        });
    });
    this.stream = stream;
    void stream.ready.then((ready) => {
      if (!this.live(epoch) || this.stream !== stream) return;
      if (!ready.ok) {
        // Busy proves this subscription was not accepted. Disposal keeps its main slot until acknowledgement.
        const remaining = until - performance.now();
        if (ready.error.code === "busy" && replacing && remaining > 0) {
          this.subscriptionRetry = setTimeout(
            () => {
              this.subscriptionRetry = undefined;
              if (this.live(epoch) && this.stream === stream)
                this.connect(epoch, recovering, until, Math.min(delay * 2, 250));
            },
            Math.min(delay, remaining),
          );
          return;
        }
        this.subscriptionFailure(epoch, ready.error);
        return;
      }
      this.composer.destinationObservationReady();
      this.observed("ready");
      this.queue = this.queue
        .then(async () => {
          if (!this.live(epoch) || this.stream !== stream) return;
          await this.refresh(epoch, recovering);
        })
        .catch((error: unknown) => {
          this.failure(
            epoch,
            error instanceof Error && "code" in error ? { code: String(error.code) } : undefined,
          );
        });
    });
  }
  private async projects(epoch: number): Promise<void> {
    let cursor: string | null = null;
    do {
      const page: Outcome<ResearchOutputs["project.list"]> = await this.port.listProjects({
        cursor,
        count: 128,
      }).result;
      if (!page.ok)
        throw Object.assign(new Error("Projects could not be read."), { code: page.error.code });
      if (!this.live(epoch)) return;
      const project = page.value.items.find((project) => project.id === this.state.scope.projectId);
      if (project && (!this.state.project?.setupConfirmedAt || project.setupConfirmedAt))
        this.state = { ...this.state, project };
      cursor = page.value.next;
    } while (cursor);
  }
  private async header(epoch: number): Promise<void> {
    const { projectId, conversationId } = this.state.scope;
    if (!projectId || !conversationId) return;
    const result = await this.port.readConversations({ projectId, ids: [conversationId] }).result;
    if (!result.ok)
      throw Object.assign(new Error("Conversation unavailable."), { code: result.error.code });
    const conversation = result.value.items[0];
    if (!conversation || conversation.projectId !== projectId)
      throw new Error("Invalid conversation scope.");
    if (
      this.live(epoch) &&
      (!this.state.conversation || this.state.conversation.revision <= conversation.revision)
    )
      this.state = { ...this.state, conversation };
  }
  private async text(reference: TextReference, epoch: number): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let text = "";
      for (let index = 1; index <= reference.parts; index++) {
        const part = await this.port.readTextPart({ source: reference.source, index }).result;
        if (!this.live(epoch)) return "";
        if (!part.ok)
          throw Object.assign(new Error("Text part unavailable."), { code: part.error.code });
        text += part.value.text;
      }
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const sha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (utf8Size(text) === reference.bytes && sha256 === reference.sha256) return text;
    }
    throw new Error("Text integrity could not be verified.");
  }
  private async accept(
    items: readonly TimelineItem[],
    epoch: number,
    announce = false,
  ): Promise<void> {
    // A reserved reply can finish above the newest page while this window misses
    // events. Recover its immutable message explicitly, rather than losing partial text.
    const held = new Set(
      [...this.state.items, ...items]
        .filter((item) => item.kind === "message")
        .map((item) => item.id),
    );
    const missing = items.flatMap((item) =>
      item.kind === "task" && item.replyMessageId && !held.has(item.replyMessageId)
        ? [item.replyMessageId]
        : [],
    );
    if (missing.length) await this.readIds([...new Set(missing)], epoch, announce);
    if (!this.live(epoch)) return;
    const texts = new Map(this.state.texts);
    for (const item of items)
      if (item.kind === "setupProposal") {
        texts.set(
          `${item.id}/title`,
          typeof item.title === "string" ? item.title : await this.text(item.title, epoch),
        );
        texts.set(
          `${item.id}/language`,
          typeof item.documentLanguage === "string"
            ? item.documentLanguage
            : await this.text(item.documentLanguage, epoch),
        );
      } else if (item.kind === "message")
        texts.set(
          item.id,
          typeof item.content === "string" ? item.content : await this.text(item.content, epoch),
        );
    if (!this.live(epoch)) return;
    const previous = this.state.items;
    const known = new Map(previous.map((item) => [item.id, item]));
    const introduced = new Set<string>();
    for (const item of items) {
      if (item.kind !== "task") continue;
      if (this.introducedTasks.get(item.id) === this.state.scope.conversationId) {
        introduced.add(item.id);
        this.introducedTasks.delete(item.id);
      }
      const old = known.get(item.id);
      const recoveredChange =
        old !== undefined &&
        old.kind === "task" &&
        (old.revision < item.revision ||
          (old.revision === item.revision &&
            (old.waitingForModels !== item.waitingForModels ||
              old.waitingLimit !== item.waitingLimit)));
      if (announce || recoveredChange || introduced.has(item.id))
        this.noticeUpdates.set(
          item.id,
          Math.max(this.noticeUpdates.get(item.id) ?? 0, item.revision),
        );
    }
    let completed = this.state.completed;
    for (const item of items)
      if (
        item.kind === "message" &&
        item.authorKind === "agent" &&
        (announce ||
          introduced.has(item.taskId ?? "") ||
          this.introducedTasks.get(item.taskId ?? "") === this.state.scope.conversationId ||
          this.pendingReplies.has(item.taskId ?? "")) &&
        !previous.some((old) => old.id === item.id)
      )
        completed++;
    const replies = new Map(this.state.replies);
    for (const item of items)
      if (item.kind === "message" && item.taskId) {
        replies.delete(item.taskId);
        this.pendingReplies.delete(item.taskId);
      }
    this.state = {
      ...this.state,
      items: mergeTimeline(this.state.items, items),
      texts,
      replies,
      completed,
    };
  }
  private async page(
    cursor: TimelineCursor | null,
    epoch: number,
    announce = false,
  ): Promise<TimelineCursor | null> {
    const conversationId = this.state.scope.conversationId;
    if (!conversationId) return null;
    let remaining = 50;
    let next = cursor;
    do {
      const result = await this.port.listTimelineBefore({
        conversationId,
        cursor: next,
        count: remaining,
      }).result;
      if (!result.ok)
        throw Object.assign(new Error("Timeline page unavailable."), { code: result.error.code });
      if (!this.live(epoch)) return null;
      await this.accept(result.value.items, epoch, announce);
      remaining -= result.value.items.length;
      next = result.value.next;
      if (result.value.hasMore && !result.value.items.length)
        throw new Error("Timeline page made no progress.");
    } while (remaining > 0 && next);
    return next;
  }
  private async readIds(ids: readonly string[], epoch: number, announce = false): Promise<void> {
    const conversationId = this.state.scope.conversationId;
    if (!conversationId) return;
    for (let start = 0; start < ids.length; start += 128) {
      let remaining: readonly string[] = ids.slice(start, start + 128);
      while (remaining.length) {
        const result = await this.port.readTimeline({ conversationId, ids: remaining }).result;
        if (!result.ok)
          throw Object.assign(new Error("Timeline records unavailable."), {
            code: result.error.code,
          });
        if (!this.live(epoch)) return;
        if (result.value.remaining.length >= remaining.length)
          throw new Error("Timeline read made no progress.");
        await this.accept(result.value.items, epoch, announce);
        remaining = result.value.remaining;
      }
    }
  }
  private async reply(taskId: string, epoch: number): Promise<void> {
    let fromSequence = 1;
    let text = "";
    for (;;) {
      const result = await this.port.readReplyParts({ taskId, fromSequence }).result;
      if (!result.ok)
        throw Object.assign(new Error("Reply parts unavailable."), { code: result.error.code });
      if (!this.live(epoch)) return;
      for (const part of result.value.parts) {
        if (part.sequence !== fromSequence) throw new Error("Reply sequence is incomplete.");
        text += part.text;
        fromSequence++;
      }
      if (fromSequence > result.value.latestSequence) break;
      if (!result.value.parts.length) throw new Error("Reply read made no progress.");
    }
    if (this.state.items.some((item) => item.kind === "message" && item.taskId === taskId)) return;
    this.pendingReplies.set(taskId, { sequence: fromSequence - 1, text });
  }
  private async refresh(epoch: number, recovering: boolean): Promise<void> {
    await this.projects(epoch);
    if (!this.live(epoch)) return;
    void this.composer.refreshDestination();
    await this.refreshPauses();
    if (!this.live(epoch)) return;
    if (!this.state.scope.conversationId) {
      this.state = { ...this.state, status: "ready" };
      this.publish();
      return;
    }
    await this.header(epoch);
    if (!this.live(epoch)) return;
    const conversationId = this.state.scope.conversationId;
    // Partial recovery reads must not advance the last established contiguous range.
    const newestHeld = this.establishedRanges.get(conversationId);
    const preserveRange = newestHeld !== undefined && newestHeld !== null;
    const previousNext = this.state.next;
    const held = this.state.items.map((item) => item.id);
    const announce = recovering && this.baselineEstablished;
    let next = await this.page(null, epoch, announce);
    if (!this.live(epoch)) return;
    const latest = this.state.items.at(-1);
    const newestPage = latest
      ? { position: latest.position, rank: latest.rank, id: latest.id }
      : null;
    // Rejoin the latest page to the cached range before retaining its older continuation.
    while (this.live(epoch) && next && newestHeld && compareTimeline(next, newestHeld) > 0)
      next = await this.page(next, epoch, announce);
    if (!this.live(epoch)) return;
    if (recovering || held.length) await this.readIds(held, epoch);
    if (!this.live(epoch)) return;
    const introduced = [...this.introducedTasks]
      .filter(([, id]) => id === conversationId)
      .map(([id]) => id);
    if (introduced.length) await this.readIds(introduced, epoch);
    if (!this.live(epoch)) return;
    for (const item of this.state.items)
      if (item.kind === "task" && ["running", "cancelling"].includes(item.state))
        await this.reply(item.id, epoch);
    if (!this.live(epoch)) return;
    this.state = {
      ...this.state,
      replies: new Map(this.pendingReplies),
      next: preserveRange ? previousNext : next,
      status: "ready",
      failedEarlier: false,
    };
    this.establishedRanges.set(conversationId, newestPage);
    this.baselineEstablished = true;
    this.publish();
  }
  loadEarlier = (): void => {
    if (!this.state.next || this.state.loadingEarlier) return;
    const epoch = this.epoch;
    const cursor = this.state.next;
    this.state = { ...this.state, loadingEarlier: true, failedEarlier: false };
    this.publish();
    this.queue = this.queue.then(async () => {
      try {
        const next = await this.page(cursor, epoch);
        if (this.live(epoch)) this.state = { ...this.state, next, loadingEarlier: false };
      } catch {
        if (this.live(epoch))
          this.state = { ...this.state, loadingEarlier: false, failedEarlier: true };
      }
      if (this.live(epoch)) this.publish();
    });
  };
  private async event(event: ResearchEvent, epoch: number): Promise<void> {
    if (event.kind === "destinationChanged") {
      void this.composer.refreshDestination();
      await this.readIds(
        this.state.items
          .filter((item) => item.kind === "task" && item.state === "queued")
          .map((item) => item.id),
        epoch,
        true,
      );
      if (this.live(epoch)) this.publish();
      return;
    }
    if (event.kind === "inferenceActivity") {
      await this.readIds(
        this.state.items
          .filter((item) => item.kind === "task" && item.state === "queued")
          .map((item) => item.id),
        epoch,
        true,
      );
      if (this.live(epoch)) this.publish();
      return;
    }
    if (event.kind === "pauseCounts") {
      if ((this.state.pauses?.revision ?? 0) < event.revision) await this.refreshPauses();
      return;
    }
    if (event.kind === "changed" && event.record === "executionLimits") {
      await this.readIds(
        this.state.items
          .filter((item) => item.kind === "task" && item.state === "queued")
          .map((item) => item.id),
        epoch,
        true,
      );
      if (!this.live(epoch)) return;
    }
    if (event.kind === "reply") {
      const saved = this.state.items.some(
        (item) => item.kind === "message" && item.taskId === event.taskId,
      );
      if (saved) return;
      const previous = this.pendingReplies.get(event.taskId) ?? { sequence: 0, text: "" };
      if (event.sequence <= previous.sequence) return;
      if (event.sequence !== previous.sequence + 1) await this.reply(event.taskId, epoch);
      else
        this.pendingReplies.set(event.taskId, {
          sequence: event.sequence,
          text: previous.text + event.text,
        });
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        if (this.live(epoch)) {
          this.state = { ...this.state, replies: new Map(this.pendingReplies) };
          this.publish();
        }
      }, 100);
      return;
    }
    const key = `${event.record}/${event.id}`;
    if ((this.revisions.get(key) ?? 0) >= event.revision) return;
    if (
      (event.record === "project" && event.id === this.state.scope.projectId) ||
      (event.record === "conversation" && event.id === this.state.scope.conversationId)
    )
      void this.composer.refreshDestination();
    if (event.record === "project") await this.projects(epoch);
    if (!this.live(epoch)) return;
    if (event.record === "conversation" && event.id === this.state.scope.conversationId)
      await this.header(epoch);
    if (event.record === "timeline" && this.state.scope.conversationId)
      await this.readIds([event.id], epoch, true);
    if (!this.live(epoch)) return;
    this.revisions.set(key, event.revision);
    this.publish();
  }
  dispose(): void {
    this.disposed = true;
    this.composer.dispose();
    this.epoch++;
    this.stream?.dispose();
    if (this.timer) clearTimeout(this.timer);
    if (this.subscriptionRetry) clearTimeout(this.subscriptionRetry);
    this.cache.clear();
    this.establishedRanges.clear();
    this.listeners.clear();
    this.observers.clear();
    this.noticeUpdates.clear();
    this.announcedNotices.clear();
    this.introducedTasks.clear();
  }
}
