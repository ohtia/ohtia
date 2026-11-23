import { windowConnectionSubscription } from "./connection-subscription.js";
import { ActivityController } from "./activity-controller.js";
import { ConversationHistoryController } from "./conversation-history-controller.js";
import { stagedCommand } from "./staged-command.js";
import { ComposerController } from "./composer-controller.js";
import {
  mergeTimeline,
  defaultProviderConnections,
  isUsagePauseConnection,
  type PauseCounts,
  type ProjectRecord,
  type TimelineSetupProposal,
  type TimelineConsultation,
  type TimelinePlan,
  type TimelineHandoffProposal,
  type HandoffSelectionMessage,
  type PlanSnapshot,
  type PlanChangePreview,
  isSynthesisSources,
  type SynthesisSource,
  type PlanText,
  type ProviderDeclaration,
  type TimelineTask,
  failure,
  staleRevision,
  compareTimeline,
  portLimits,
  utf8Size,
  type Outcome,
  type ResearchResult,
  type ResearchOutputs,
  type ConversationSummary,
  type ReplyAgent,
  type CommandReason,
  type FoundationPort,
  type ResearchEvent,
  type ResearchScope,
  type Subscription,
  type TimelineCursor,
  type TimelineItem,
  type TextReference,
} from "@ohtia/contracts";
export type ReadPlanCard = Omit<PlanSnapshot, "purpose" | "sharedContext" | "contributions"> & {
  readonly purpose: string;
  readonly sharedContext: string;
  readonly contributions: readonly (Omit<
    PlanSnapshot["contributions"][number],
    "request" | "reason"
  > & {
    readonly request: string;
    readonly reason: string;
  })[];
};
export type PlanProgressAction =
  | { readonly kind: "cancel" | "finish"; readonly planId: string }
  | { readonly kind: "retryContribution"; readonly contributionId: string }
  | { readonly kind: "retryTask" | "restartTask" | "retrySynthesis"; readonly taskId: string }
  | {
      readonly kind: "resume";
      readonly connection: Parameters<FoundationPort["resumeUsagePause"]>[1]["connection"];
    }
  | { readonly kind: "continue" };

export type TaskAction = "resume" | "continue" | "retry" | "restart";
type RenameNotice = "empty" | "spaces" | "long" | "stale" | "uncertain" | "failed";
interface RenameState {
  readonly text: string;
  readonly expectedUpdatedAt: string;
  readonly busy: boolean;
  readonly notice?: RenameNotice | undefined;
  readonly intent?: string | undefined;
  readonly needsRefresh?: boolean | undefined;
}
export interface ConversationState {
  readonly pauses?: PauseCounts;
  readonly consultationDestination?: string | null | undefined;
  readonly project?: ProjectRecord;
  readonly setupActions?: ReadonlyMap<
    string,
    {
      readonly busy: boolean;
      readonly action: "confirm" | "reject";
      readonly error?: string;
      readonly unavailable?: boolean;
    }
  >;
  readonly scope: ResearchScope;
  readonly status: "loading" | "ready" | "failed" | "unavailable";
  readonly conversation?: ConversationSummary;
  readonly agentHint?: ReplyAgent | undefined;
  readonly rename?: RenameState | undefined;
  readonly renamed?: number | undefined;
  readonly newConversationRequest?: number | undefined;
  readonly items: readonly TimelineItem[];
  readonly texts: ReadonlyMap<string, string>;
  readonly planChanges?: ReadonlyMap<string, PlanChangePreview>;
  readonly synthesisSources?: ReadonlyMap<string, readonly SynthesisSource[]>;
  readonly replies: ReadonlyMap<string, { readonly sequence: number; readonly text: string }>;
  readonly next: TimelineCursor | null;
  readonly loadingEarlier: boolean;
  readonly failedEarlier: boolean;
  readonly completed: number;
  readonly completedAgent?: TimelineTask["agentId"] | undefined;
}
export function knownConversationAgent(state: ConversationState): ReplyAgent | undefined {
  const project = state.project;
  return (
    state.conversation?.agentId ??
    state.agentHint ??
    (project && (project.isDevelopment || !project.setupConfirmedAt) ? "virgilio" : undefined)
  );
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
/** A saved researcher reply continues setup beyond the proposal's reserved reply position. */
export function setupProposalResponded(
  proposal: TimelineSetupProposal,
  items: readonly TimelineItem[],
): boolean {
  return (
    proposal.state === "proposed" &&
    items.some(
      (item) =>
        item.kind === "message" &&
        item.authorKind === "researcher" &&
        item.position > proposal.position,
    )
  );
}
export class ConversationController {
  readonly activity: ActivityController;
  readonly readingPositions = new Map<string, { top: number; follow: boolean }>();
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
  private readonly sharedAttentionPlans = new Map<string, number>();
  hasSharedPlanAttention = (id: string, revision: number): boolean =>
    this.sharedAttentionPlans.get(id) === revision;
  private readonly sharedAttentionTasks = new Map<string, number>();
  /** Historical reads do not announce. Live transitions are announced once per window. */
  claimTaskNotice(taskId: string, revision: number, signature: string): boolean {
    const live = (this.noticeUpdates.get(taskId) ?? 0) >= revision;
    const key = `${String(revision)}/${signature}`;
    if (this.announcedNotices.get(taskId) === key) return false;
    this.announcedNotices.set(taskId, key);
    return live && this.sharedAttentionTasks.get(taskId) !== revision;
  }
  readonly composer: ComposerController;
  readonly history: ConversationHistoryController;
  private newRequest = 0;
  private renameAnnouncement = 0;
  private readonly renames = new Map<string, RenameState>();
  constructor(
    private readonly port: FoundationPort,
    readonly connections: readonly ProviderDeclaration["connection"][] = defaultProviderConnections,
    onConversationStarted?: (scope: ResearchScope) => void,
  ) {
    this.activity = new ActivityController(port);
    this.history = new ConversationHistoryController(port, this.reload);
    this.composer = new ComposerController(
      port,
      undefined,
      connections,
      this.reload,
      (scope, active, agent) => {
        onConversationStarted?.(scope);
        if (
          active &&
          this.state.scope.projectId === scope.projectId &&
          !this.state.scope.conversationId
        )
          this.open(scope, agent);
      },
    );
  }
  private readonly destinationListeners = new Set<() => void>();
  observePlanDestinations = (refresh: () => void): (() => void) => {
    this.destinationListeners.add(refresh);
    const subscriptions = this.connections.map(({ id }) =>
      windowConnectionSubscription(this.port)(id, (notice) => {
        if (notice.ok) refresh();
      }),
    );
    return () => {
      this.destinationListeners.delete(refresh);
      for (const subscription of subscriptions) subscription.dispose();
    };
  };
  readPlanDestinations = async (
    projectId: string,
    agents: readonly ReplyAgent[],
  ): Promise<PlanSnapshot["connections"]> => {
    const pairs = await Promise.all(
      agents.map(async (agentId) => {
        const result = await this.port.readDestination({ projectId, agentId }).result;
        return [agentId, result.ok ? result.value.destination?.connection : undefined] as const;
      }),
    );
    return Object.fromEntries(pairs.filter((pair) => pair[1] !== undefined));
  };
  private planReads: Promise<unknown> = Promise.resolve();
  readPlanCard = (planId: string, signal?: AbortSignal): Promise<ReadPlanCard> => {
    const epoch = this.epoch;
    // A card can reference more text parts than the port admits as pending per window.
    const read = this.planReads.then(async () => {
      const checkScope = () => {
        if (!this.live(epoch) || signal?.aborted) throw new Error("Plan read abandoned.");
      };
      checkScope();
      const result = await this.port.readPlan({ planId }).result;
      if (!result.ok) throw new Error("Plan unavailable.");
      checkScope();
      const plan = result.value;
      if (
        plan.conversationId !== this.state.scope.conversationId ||
        plan.projectId !== this.state.scope.projectId
      )
        throw new Error("Invalid plan scope.");
      const resolve = (value: PlanText) => {
        checkScope();
        return typeof value === "string" ? Promise.resolve(value) : this.text(value, epoch);
      };
      const purpose = await resolve(plan.purpose);
      const sharedContext = await resolve(plan.sharedContext);
      const contributions: ReadPlanCard["contributions"][number][] = [];
      for (const node of plan.contributions)
        contributions.push({
          ...node,
          request: await resolve(node.request),
          reason: await resolve(node.reason),
        });
      checkScope();
      return { ...plan, purpose, sharedContext, contributions };
    });
    this.planReads = read.catch(() => undefined);
    return read;
  };
  performPlanAction = async (
    operationId: string,
    proposal: TimelinePlan,
    connections?: PlanSnapshot["connections"],
  ) => {
    const epoch = this.epoch;
    const result = await (
      connections
        ? this.port.acceptPlan(operationId, { planId: proposal.id, connections })
        : this.port.declinePlan(operationId, { planId: proposal.id })
    ).result.catch(() => failure("invalid_service_result"));
    if (this.live(epoch) && (result.ok || result.error.code === "proposal_not_waiting")) {
      this.queue = this.queue
        .then(async () => {
          if (!this.live(epoch)) return;
          await this.readIds([proposal.id], epoch);
          if (this.live(epoch)) this.publish();
        })
        .catch(() => {
          if (this.live(epoch)) this.reload();
        });
      await this.queue;
    }
    return result;
  };
  performMemoryUndo = async (operationId: string, taskId: string, itemId: string) => {
    const epoch = this.epoch;
    const result = await this.port
      .undoMemory(operationId, { taskId })
      .result.catch(() => failure("invalid_service_result"));
    if (result.ok && this.live(epoch)) {
      this.queue = this.queue
        .then(async () => {
          if (!this.live(epoch)) return;
          await this.readIds([itemId], epoch);
          if (this.live(epoch)) this.publish();
        })
        .catch(() => {
          if (this.live(epoch)) this.reload();
        });
      await this.queue;
    }
    return result;
  };
  performPlanChange = async (operationId: string, id: string, apply: boolean) => {
    const epoch = this.epoch;
    const result = await (
      apply
        ? this.port.applyPlanChange(operationId, { proposalId: id })
        : this.port.declinePlanChange(operationId, { proposalId: id })
    ).result.catch(() => failure("invalid_service_result"));
    if (this.live(epoch) && (result.ok || result.error.code === "proposal_not_waiting")) {
      this.queue = this.queue
        .then(async () => {
          if (!this.live(epoch)) return;
          await this.readIds([id], epoch);
          if (this.live(epoch)) this.publish();
        })
        .catch(() => {
          if (this.live(epoch)) this.reload();
        });
      await this.queue;
    }
    return result;
  };
  performPlanProgressAction = async (
    operationId: string,
    action: PlanProgressAction,
  ): Promise<Outcome<ResearchResult>> => {
    const epoch = this.epoch;
    const operation = () => {
      switch (action.kind) {
        case "cancel":
          return this.port.cancelPlan(operationId, { planId: action.planId });
        case "finish":
          return this.port.finishPlan(operationId, { planId: action.planId });
        case "retryContribution":
          return this.port.tryAgainContribution(operationId, {
            contributionId: action.contributionId,
          });
        case "retryTask":
          return this.port.tryAgainContribution(operationId, { taskId: action.taskId });
        case "restartTask":
          return this.port.startAgainContribution(operationId, { taskId: action.taskId });
        case "retrySynthesis":
          return this.port.tryAgainSynthesis(operationId, { taskId: action.taskId });
        case "continue":
          return this.port.continueAllTasks(operationId);
        case "resume":
          return this.port.resumeUsagePause(operationId, { connection: action.connection });
      }
    };
    const result = await operation().result.catch(() => failure("invalid_service_result"));
    if (result.ok && this.live(epoch) && (action.kind === "continue" || action.kind === "resume")) {
      try {
        await this.refreshPauses();
      } catch {
        if (this.live(epoch)) this.failure(epoch);
      }
    }
    return result;
  };
  private consultationRead = 0;
  refreshConsultationDestination = async (): Promise<void> => {
    const { projectId } = this.state.scope;
    if (
      !projectId ||
      !this.state.items.some(
        (item) =>
          (item.kind === "consultation" && item.state === "proposed") ||
          (item.kind === "handoffProposal" && item.state !== "invalid"),
      )
    )
      return;
    const epoch = this.epoch;
    const revision = ++this.consultationRead;
    const result = await this.port
      .readDestination({ projectId, agentId: "josefa" })
      .result.catch(() => failure("invalid_service_result"));
    if (!this.live(epoch) || revision !== this.consultationRead) return;
    this.state = {
      ...this.state,
      consultationDestination: result.ok ? (result.value.destination?.connection ?? null) : null,
    };
    this.publish();
  };
  observeConsultationDestination = (): (() => void) => {
    void this.refreshConsultationDestination();
    const scope = this.state.scope;
    let observing = true;
    const subscriptions = this.connections.map(({ id }) =>
      windowConnectionSubscription(this.port)(id, (notice) => {
        if (
          observing &&
          notice.ok &&
          scope.projectId === this.state.scope.projectId &&
          scope.conversationId === this.state.scope.conversationId
        )
          void this.refreshConsultationDestination();
      }),
    );
    return () => {
      observing = false;
      for (const subscription of subscriptions) subscription.dispose();
    };
  };
  performConsultationAction = async (
    operationId: string,
    proposal: TimelineConsultation,
    action: "accept" | "decline",
    connection?: string,
  ): Promise<Outcome<import("@ohtia/contracts").ResearchResult>> => {
    const epoch = this.epoch;
    if (action === "accept" && !connection) return failure("service_unavailable");
    const result = await (
      action === "accept" && connection
        ? this.port.acceptConsultation(operationId, { proposalId: proposal.id, connection })
        : this.port.declineConsultation(operationId, { proposalId: proposal.id })
    ).result.catch(() => failure("invalid_service_result"));
    if (this.live(epoch)) {
      if (!result.ok && result.error.code === "destination_changed")
        await this.refreshConsultationDestination();
      if (result.ok || result.error.code === "proposal_not_waiting") {
        this.queue = this.queue
          .then(async () => {
            if (!this.live(epoch)) return;
            await this.readIds([proposal.id], epoch);
            if (this.live(epoch)) this.publish();
          })
          .catch(() => {
            if (this.live(epoch)) this.reload();
          });
        await this.queue;
      }
    }
    return result;
  };
  private refreshHandoff(proposal?: string): Promise<void> {
    const epoch = this.epoch;
    this.queue = this.queue
      .then(async () => {
        if (!this.live(epoch)) return;
        await this.header(epoch);
        if (proposal) await this.readIds([proposal], epoch);
        await this.page(null, epoch);
        if (this.live(epoch)) {
          this.publish();
          void this.composer.refreshDestination();
        }
      })
      .catch(() => {
        if (this.live(epoch)) this.reload();
      });
    return this.queue;
  }
  performHandoffAction = async (
    id: string,
    proposal: TimelineHandoffProposal,
    action: "accept" | "decline",
  ): Promise<Outcome<ResearchResult>> => {
    const epoch = this.epoch;
    const result = await (
      action === "accept"
        ? this.port.acceptHandoff(id, {
            proposalId: proposal.id,
            expectedOwnerRevision: proposal.expectedOwnerRevision,
          })
        : this.port.declineHandoff(id, { proposalId: proposal.id })
    ).result.catch(() => failure("invalid_service_result"));
    if (
      this.live(epoch) &&
      (result.ok ||
        result.error.code === "owner_changed" ||
        result.error.code === "proposal_not_waiting")
    )
      await this.refreshHandoff(proposal.id);
    return result;
  };
  listHandoffMessages = async (
    conversationId: string,
    expectedOwnerRevision: number,
    signal: AbortSignal,
  ): Promise<Outcome<{ messages: HandoffSelectionMessage[]; priorReply: boolean }>> => {
    let after = 0;
    const messages: HandoffSelectionMessage[] = [];
    while (!signal.aborted) {
      const page = await this.port
        .listHandoffSelection({ conversationId, expectedOwnerRevision, after })
        .result.catch(() => failure("invalid_service_result"));
      if (!page.ok) return page;
      messages.push(...page.value.messages);
      if (page.value.next === null)
        return { ok: true, value: { messages, priorReply: page.value.priorReply } };
      after = page.value.next;
    }
    return failure("cancelled");
  };
  returnHandoff = async (
    id: string,
    conversationId: string,
    expectedOwnerRevision: number,
    selection: string,
  ): Promise<Outcome<ResearchResult>> => {
    const epoch = this.epoch;
    const result = await stagedCommand(this.port, id, selection, (content) =>
      this.port.returnHandoff(id, { conversationId, expectedOwnerRevision, selection: content }),
    );
    if (this.live(epoch) && (result.ok || result.error.code === "owner_changed"))
      await this.refreshHandoff();
    return result;
  };
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
    if (action === "resume" && !isUsagePauseConnection(task.connection))
      return failure("invalid_message");
    let result: Outcome<import("@ohtia/contracts").ResearchResult>;
    try {
      result = await (
        action === "resume" && isUsagePauseConnection(task.connection)
          ? this.port.resumeUsagePause(operationId, { connection: task.connection })
          : action === "continue"
            ? this.port.continueAllTasks(operationId)
            : task.synthesis
              ? this.port.tryAgainSynthesis(operationId, { taskId: task.id })
              : action === "retry"
                ? task.consultation
                  ? this.port.tryAgainContribution(operationId, { taskId: task.id })
                  : this.port.tryAgainTask(operationId, { taskId: task.id })
                : task.consultation
                  ? this.port.startAgainContribution(operationId, { taskId: task.id })
                  : this.port.startAgainTask(operationId, { taskId: task.id })
      ).result;
    } catch {
      result = failure("invalid_service_result");
    }
    if (result.ok && !this.disposed) {
      if (
        !task.synthesis &&
        (action === "retry" || action === "restart") &&
        conversationId &&
        result.value.resultId
      )
        this.introducedTasks.set(result.value.resultId, conversationId);
      // A failed reread cannot turn a confirmed save into another mutation.
      try {
        if (action === "resume" || action === "continue") await this.refreshPauses();
      } catch {
        this.failure(this.epoch);
      }
      this.reload();
    }
    if (!result.ok && result.error.code === "newer_task_exists") this.reload();
    return result;
  }
  private setupIntents = new Map<string, string>();
  private setupActions = new Map<
    string,
    { busy: boolean; action: "confirm" | "reject"; error?: string; unavailable?: boolean }
  >();
  performSetupAction = async (
    proposal: TimelineSetupProposal,
    action: "confirm" | "reject",
  ): Promise<void> => {
    if (
      this.disposed ||
      this.setupActions.get(proposal.id)?.busy ||
      setupProposalResponded(proposal, this.state.items)
    )
      return;
    const conversationId = this.state.scope.conversationId;
    const key = `${proposal.id}/${action}`;
    const operationId = this.setupIntents.get(key) ?? crypto.randomUUID();
    this.setupIntents.set(key, operationId);
    const update = (
      busy: boolean,
      error?: string,
      unavailable = !!this.setupActions.get(proposal.id)?.unavailable,
    ) => {
      this.setupActions.set(proposal.id, {
        busy,
        action,
        ...(error ? { error } : {}),
        ...(unavailable ? { unavailable: true } : {}),
      });
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
    const notWaiting = !outcome.ok && outcome.error.code === "proposal_not_waiting";
    update(
      false,
      outcome.ok || notWaiting ? undefined : outcome.error.code,
      notWaiting || !!this.setupActions.get(proposal.id)?.unavailable,
    );
    if (this.state.scope.conversationId !== conversationId) return;
    const epoch = this.epoch;
    if (outcome.ok || outcome.error.code === "proposal_not_waiting") {
      try {
        await this.readIds([proposal.id], epoch);
        if (!this.live(epoch)) return;
        const reread = this.state.items.find((item) => item.id === proposal.id);
        if (notWaiting && reread && reread.kind === "setupProposal" && reread.state === "replaced")
          update(false, "proposal_not_waiting", true);
        await this.projects(epoch);
        if (this.live(epoch)) {
          void this.composer.refreshDestination();
          this.publish();
          if (!outcome.ok && outcome.error.code === "proposal_not_waiting") this.reload();
        }
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
  newConversationReason = (): CommandReason | undefined => {
    if (!this.state.scope.projectId) return "no_project";
    if (!this.state.project) return "busy";
    if (!this.state.project.setupConfirmedAt) return "project_in_setup";
    if (this.state.status === "unavailable") return "busy";
    return undefined;
  };
  startNew = (): boolean => {
    const { projectId, conversationId } = this.state.scope;
    if (this.disposed || !projectId || this.newConversationReason()) return false;
    this.history.hide();
    if (conversationId) this.open({ projectId, conversationId: null });
    this.state = { ...this.state, newConversationRequest: ++this.newRequest };
    this.publish();
    return true;
  };
  switchConversation = (id: string): void => {
    const { projectId, conversationId } = this.state.scope;
    const agent = this.history.snapshot().items.find((row) => row.id === id)?.agentId;
    this.history.hide();
    if (projectId && id !== conversationId) this.open({ projectId, conversationId: id }, agent);
  };
  private setRename(id: string, rename?: RenameState): void {
    if (this.disposed) return;
    if (rename) this.renames.set(id, rename);
    else this.renames.delete(id);
    if (this.state.scope.conversationId === id) {
      this.state = { ...this.state, rename };
      this.publish();
    }
  }
  beginRename = (displayedName: string): void => {
    const row = this.state.conversation;
    if (!row || this.renames.has(row.id)) return;
    this.setRename(row.id, {
      text: displayedName,
      expectedUpdatedAt: row.updatedAt,
      busy: false,
    });
  };
  editRename = (text: string): void => {
    const { rename, scope } = this.state;
    if (!rename || rename.busy || !scope.conversationId || text === rename.text) return;
    this.setRename(scope.conversationId, { ...rename, text, notice: undefined, intent: undefined });
  };
  cancelRename = (): void => {
    const { rename, scope } = this.state;
    if (scope.conversationId && rename && !rename.busy) this.setRename(scope.conversationId);
  };
  saveRename = async (): Promise<void> => {
    const {
      rename,
      scope: { projectId, conversationId },
    } = this.state;
    if (!projectId || !conversationId || !rename || rename.busy) return;
    const { text } = rename;
    const invalid = !text
      ? "empty"
      : text.trim() !== text || /^\p{White_Space}|\p{White_Space}$/u.test(text)
        ? "spaces"
        : Array.from(text).length > 200
          ? "long"
          : undefined;
    if (invalid) {
      this.setRename(conversationId, { ...rename, notice: invalid });
      return;
    }
    const intent = rename.intent ?? crypto.randomUUID();
    this.setRename(conversationId, { ...rename, intent, busy: true, notice: undefined });
    let result: Outcome<import("@ohtia/contracts").ResearchResult> = staleRevision(0);
    if (!rename.needsRefresh) {
      try {
        result = await this.port.renameConversation(intent, {
          conversationId,
          title: text,
          expectedUpdatedAt: rename.expectedUpdatedAt,
        }).result;
      } catch {
        result = failure("invalid_service_result");
      }
    }
    if (this.disposed) return;
    const stale = !result.ok && result.error.code === "stale_revision";
    if (result.ok || stale) {
      // Resolve the expected version from a scoped read. A receipt confirms the
      // rename even when a subsequent read fails.
      let current: ConversationSummary | undefined;
      try {
        const fresh = await this.port.readConversations({ projectId, ids: [conversationId] })
          .result;
        if (fresh.ok) current = fresh.value.items[0];
      } catch {
        // Stale edits must refresh before they may send another mutation.
      }
      if (!this.live(this.epoch)) return;
      if (current && this.state.scope.conversationId === conversationId) {
        this.acceptHeader(current);
        current = this.state.conversation;
      }
      if (current && this.state.scope.projectId === projectId)
        this.history.changed(current.id, current.revision);
      if (result.ok) {
        if (this.state.conversation?.id === conversationId) {
          this.state = {
            ...this.state,
            conversation: current ?? { ...this.state.conversation, title: text },
            renamed: ++this.renameAnnouncement,
          };
        }
        this.setRename(conversationId);
      } else {
        this.setRename(conversationId, {
          ...rename,
          busy: false,
          intent: undefined,
          notice: current ? "stale" : "failed",
          expectedUpdatedAt: current ? current.updatedAt : rename.expectedUpdatedAt,
          needsRefresh: !current,
        });
      }
      return;
    }
    const uncertain = [
      "uncertain",
      "timeout",
      "cancelled",
      "disposed",
      "invalid_service_result",
    ].includes(result.error.code);
    this.setRename(conversationId, {
      ...rename,
      busy: false,
      intent,
      notice: uncertain ? "uncertain" : "failed",
    });
  };
  private publish(): void {
    this.composer.setup(
      !!this.state.project?.setupConfirmedAt && !this.state.project.isDevelopment,
      this.state.items
        .filter(
          (item) =>
            item.kind === "setupProposal" &&
            item.state === "proposed" &&
            !this.setupActions.get(item.id)?.unavailable &&
            !setupProposalResponded(item, this.state.items),
        )
        .map((item) => item.id),
    );
    this.composer.running(
      !!this.state.conversation?.runningTask ||
        this.state.items.some(
          (item) =>
            item.kind === "task" &&
            !item.synthesis &&
            ["queued", "blocked", "running", "cancelling"].includes(item.state),
        ),
      this.state.conversation?.runningTask?.state === "cancelling" ||
        this.state.items.some(
          (item) => item.kind === "task" && !item.synthesis && item.state === "cancelling",
        ),
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
    this.history.disconnected(error.code);
    this.activity.disconnect();
    this.failure(epoch, error);
    if (this.live(epoch)) this.epoch++;
    stream?.dispose();
  }
  open(scope: ResearchScope, agentHint?: ReplyAgent): void {
    if (this.disposed) return;
    if (this.state.scope.conversationId)
      this.cache.set(this.state.scope.conversationId, this.state);
    const previous = this.state;
    this.history.scope(scope.projectId);
    this.composer.open(scope);
    this.composer.destinationObservationPending();
    const epoch = ++this.epoch;
    this.queue = Promise.resolve();
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
    this.state = {
      ...this.state,
      ...(previous.scope.projectId === scope.projectId && previous.project
        ? { project: previous.project }
        : {}),
      agentHint: agentHint ?? this.state.agentHint,
      rename: scope.conversationId ? this.renames.get(scope.conversationId) : undefined,
      newConversationRequest: undefined,
      renamed: previous.renamed,
      setupActions: new Map(this.setupActions),
    };
    this.pendingReplies = new Map(this.state.replies);
    this.activity.open(scope);
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
          this.history.scope(this.state.scope.projectId);
          this.activity.disconnect();
          const recovery = ++this.epoch;
          this.queue = Promise.resolve();
          this.state = { ...this.state, loadingEarlier: false, failedEarlier: false };
          this.publish();
          this.revisions.clear();
          this.connect(recovery, true);
        } else {
          this.subscriptionFailure(epoch, notice.error);
        }
        return;
      }
      if (notice.value.kind === "attentionRaised") {
        const { task, plan } = notice.value;
        if (task) this.sharedAttentionTasks.set(task.id, task.revision);
        if (plan) this.sharedAttentionPlans.set(plan.id, plan.revision);
      }
      this.activity.event(notice.value);
      if (notice.value.kind === "changed" && notice.value.record === "conversation")
        this.history.changed(notice.value.id, notice.value.revision);
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
      this.history.connected();
      this.activity.ready();
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
  refreshProject(): void {
    const epoch = this.epoch;
    this.queue = this.queue
      .then(async () => {
        if (!this.live(epoch)) return;
        await this.projects(epoch);
        if (this.live(epoch)) this.publish();
      })
      .catch(() => {
        // The established subscription remains authoritative if this metadata read fails.
      });
  }
  private async projects(epoch: number): Promise<void> {
    let cursor: import("@ohtia/contracts").ProjectCursor | null = null;
    do {
      const page: Outcome<ResearchOutputs["project.list"]> = await this.port.listProjects({
        cursor,
        count: 40,
      }).result;
      if (!page.ok)
        throw Object.assign(new Error("Projects could not be read."), { code: page.error.code });
      if (!this.live(epoch)) return;
      const project = page.value.items.find((project) => project.id === this.state.scope.projectId);
      if (project && (!this.state.project?.setupConfirmedAt || project.setupConfirmedAt))
        this.state = { ...this.state, project };
      if (project) return;
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
    if (!conversation || conversation.id !== conversationId || conversation.projectId !== projectId)
      throw new Error("Invalid conversation scope.");
    if (this.live(epoch)) this.acceptHeader(conversation);
  }
  private acceptHeader(conversation: ConversationSummary): void {
    if (
      this.state.scope.conversationId === conversation.id &&
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
    const planChanges = new Map(this.state.planChanges);
    const synthesisSources = new Map(this.state.synthesisSources);
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
      } else if (
        item.kind === "planChangeProposal" &&
        item.state !== "invalid" &&
        this.state.scope.conversationId
      ) {
        const result = await this.port.readPlanChange({
          conversationId: this.state.scope.conversationId,
          proposalId: item.id,
        }).result;
        if (!this.live(epoch)) return;
        if (!result.ok) throw new Error("Plan change preview unavailable.");
        const preview = result.value;
        planChanges.set(item.id, preview);
        const references = [
          preview.purpose,
          preview.context,
          ...[...preview.added, ...preview.replaced.map(({ after }) => after)].flatMap(
            ({ request, reason }) => [request, reason],
          ),
        ];
        for (const value of references)
          if (value && typeof value !== "string" && !texts.has(value.source))
            texts.set(value.source, await this.text(value, epoch));
      } else if (item.kind === "handoffProposal" && item.note !== null) {
        texts.set(
          item.id,
          typeof item.note === "string" ? item.note : await this.text(item.note, epoch),
        );
      } else if (item.kind === "consultation" && item.request !== null) {
        texts.set(
          item.id,
          typeof item.request === "string" ? item.request : await this.text(item.request, epoch),
        );
      } else if (item.kind === "message") {
        texts.set(
          item.id,
          typeof item.content === "string" ? item.content : await this.text(item.content, epoch),
        );
        if (
          item.synthesisSources &&
          !isSynthesisSources(item.synthesisSources) &&
          !synthesisSources.has(item.id)
        ) {
          const records: unknown = JSON.parse(await this.text(item.synthesisSources, epoch));
          if (!isSynthesisSources(records)) throw new Error("Invalid synthesis sources.");
          synthesisSources.set(item.id, records);
        }
      }
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
              old.waitingLimit !== item.waitingLimit ||
              old.retryNotBeforeAt !== item.retryNotBeforeAt ||
              old.modelUnavailable !== item.modelUnavailable ||
              old.modelName !== item.modelName)));
      if (announce || recoveredChange || introduced.has(item.id))
        this.noticeUpdates.set(
          item.id,
          Math.max(this.noticeUpdates.get(item.id) ?? 0, item.revision),
        );
    }
    let completed = this.state.completed;
    let completedAgent = this.state.completedAgent;
    for (const item of items)
      if (
        item.kind === "message" &&
        item.agentId !== null &&
        (announce ||
          introduced.has(item.taskId ?? "") ||
          this.introducedTasks.get(item.taskId ?? "") === this.state.scope.conversationId ||
          this.pendingReplies.has(item.taskId ?? "")) &&
        !previous.some((old) => old.id === item.id)
      ) {
        completed++;
        completedAgent = item.agentId;
      }
    const replies = new Map(this.state.replies);
    for (const item of items) {
      const taskId =
        item.kind === "message"
          ? item.taskId
          : item.kind === "task" && item.state === "failed" && item.outcomeReason === "refused"
            ? item.id
            : null;
      if (!taskId) continue;
      replies.delete(taskId);
      this.pendingReplies.delete(taskId);
    }
    this.state = {
      ...this.state,
      items: mergeTimeline(this.state.items, items),
      texts,
      planChanges,
      synthesisSources,
      replies,
      completed,
      completedAgent,
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
  revealMessage = (id: string): Promise<boolean> => {
    const epoch = this.epoch;
    const reveal = this.queue.then(async () => {
      if (!this.live(epoch)) return false;
      if (this.state.items.some((item) => item.id === id)) return true;
      this.state = { ...this.state, loadingEarlier: true, failedEarlier: false };
      this.publish();
      try {
        let next = this.state.next;
        while (next && this.live(epoch) && !this.state.items.some((item) => item.id === id))
          next = await this.page(next, epoch);
        if (this.live(epoch))
          this.state = {
            ...this.state,
            next,
            loadingEarlier: false,
            failedEarlier: !this.state.items.some((item) => item.id === id),
          };
      } catch {
        if (this.live(epoch))
          this.state = { ...this.state, loadingEarlier: false, failedEarlier: true };
      }
      if (!this.live(epoch)) return false;
      this.publish();
      return !this.state.failedEarlier;
    });
    this.queue = reveal.then(() => {});
    return reveal;
  };
  private async event(event: ResearchEvent, epoch: number): Promise<void> {
    if (
      event.kind === "projectAttention" ||
      event.kind === "attentionRaised" ||
      event.kind === "replyFinished"
    )
      return;
    if (event.kind === "planChanged") {
      const item = this.state.items.find(
        (item) => item.id === event.planId && item.kind === "plan",
      );
      if (item && item.revision < event.revision) {
        await this.readIds([event.planId], epoch);
        if (this.live(epoch)) this.publish();
      }
      return;
    }
    if (
      event.kind === "destinationChanged" ||
      event.kind === "agentPreferenceChanged" ||
      event.kind === "providerModelsChanged"
    ) {
      for (const refresh of this.destinationListeners) refresh();
      void this.composer.refreshDestination();
      void this.refreshConsultationDestination();
      await this.readIds(
        this.state.items
          .filter(
            (item) =>
              item.kind === "task" &&
              (item.state === "queued" || item.blockingReason === "configuration_unavailable"),
          )
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
      if (!this.live(epoch)) return;
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
    this.history.dispose();
    this.activity.dispose();
    this.renames.clear();
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
    this.sharedAttentionTasks.clear();
    this.sharedAttentionPlans.clear();
    this.introducedTasks.clear();
  }
}
