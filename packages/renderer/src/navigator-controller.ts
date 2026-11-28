import {
  failure,
  type FoundationPort,
  type PortCall,
  type ResearchStageId,
  type StageDecision,
  type StageSnapshot,
  type WorkflowStep,
} from "@ohtia/contracts";
import type { ProjectSelectionLease } from "./pending-project-work.js";

type StagePort = Pick<FoundationPort, "readResearchStage" | "readStageDecision">;

/** A stage's read projection: its snapshot and, once started, its latest stage record. */
export interface NavigatorStage {
  readonly snapshot: StageSnapshot;
  readonly latest: StageDecision | null;
}

export interface NavigatorState {
  readonly projectId: string | undefined;
  readonly stages: ReadonlyMap<ResearchStageId, NavigatorStage> | undefined;
  readonly reading: boolean;
  readonly readFailed: boolean;
}

/** The committed Navigator surface of the current project, for presentation consumers. */
export type NavigatorSurfaceEvent =
  | { readonly kind: "committed"; readonly projectId: string }
  | { readonly kind: "selected"; readonly projectId: string };

interface Binding {
  readonly lease: ProjectSelectionLease;
  readonly steps: readonly WorkflowStep[];
  readonly abort: AbortController;
  subscriptionId: string | undefined;
  /** The highest project-wide stage record order announced for this project. */
  observed: number;
  stale: boolean;
}

/** The Navigator surface is committed only while its stages render in a visible Documents panel. */
export function navigatorSurfaceCommitted(
  selected: boolean,
  visible: boolean,
  state: NavigatorState,
): boolean {
  return selected && visible && !!state.stages && !state.readFailed;
}

const idle: NavigatorState = {
  projectId: undefined,
  stages: undefined,
  reading: false,
  readFailed: false,
};

/**
 * Reads the stage projection of the selected project. It only reads: opening or refreshing the
 * Navigator never starts a stage or any other work, and late results of an earlier selection are
 * discarded.
 */
export class NavigatorController {
  private binding: Binding | undefined;
  private state: NavigatorState = idle;
  private readonly listeners = new Set<() => void>();
  private readonly surfaceListeners = new Set<(event: NavigatorSurfaceEvent) => void>();

  constructor(private readonly port: StagePort) {}

  snapshot = (): NavigatorState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<NavigatorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  attach(lease: ProjectSelectionLease, steps: readonly WorkflowStep[]): () => void {
    this.binding?.abort.abort();
    const binding: Binding = {
      lease,
      steps,
      abort: new AbortController(),
      subscriptionId: undefined,
      observed: 0,
      stale: true,
    };
    this.binding = binding;
    this.update({ ...idle, projectId: lease.projectId });
    return () => {
      binding.abort.abort();
      if (this.binding === binding) {
        this.binding = undefined;
        this.update(idle);
      }
    };
  }

  /** Reads begin once the project's conversation subscription authorizes them. */
  setSubscription(subscriptionId: string | undefined): void {
    const binding = this.binding;
    if (!this.current(binding) || binding.subscriptionId === subscriptionId) return;
    binding.subscriptionId = subscriptionId;
    if (subscriptionId) {
      binding.stale = true;
      void this.load();
    }
  }

  /** A committed stage record of the current project; `order` is its project-wide order. */
  changed(projectId: string, order: number): void {
    const binding = this.binding;
    if (!this.current(binding) || binding.lease.projectId !== projectId) return;
    if (order <= binding.observed) return;
    binding.observed = order;
    binding.stale = true;
    void this.load();
  }

  retry = (): void => {
    const binding = this.binding;
    if (!this.current(binding)) return;
    binding.stale = true;
    void this.load();
  };

  private current(binding: Binding | undefined): binding is Binding {
    return (
      !!binding &&
      this.binding === binding &&
      !binding.abort.signal.aborted &&
      binding.lease.isCurrent()
    );
  }

  private async call<T>(binding: Binding, request: () => PortCall<T>) {
    if (!this.current(binding)) return failure("stale_generation");
    const { signal } = binding.abort;
    const call = request();
    const cancel = () => {
      call.cancel();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await call.result;
      return this.current(binding) ? result : failure("stale_generation");
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  private async read(
    binding: Binding,
    subscriptionId: string,
    stageId: ResearchStageId,
  ): Promise<NavigatorStage> {
    const scope = { projectId: binding.lease.projectId, subscriptionId };
    const snapshot = await this.call(binding, () =>
      this.port.readResearchStage({ ...scope, stageId }),
    );
    if (!snapshot.ok || snapshot.value.projectId !== scope.projectId)
      throw new Error("Stage unavailable.");
    if (snapshot.value.revision === 0) return { snapshot: snapshot.value, latest: null };
    const latest = await this.call(binding, () =>
      this.port.readStageDecision({ ...scope, stageId, revision: snapshot.value.revision }),
    );
    if (!latest.ok || latest.value.decisionId !== snapshot.value.decisionId)
      throw new Error("Stage record unavailable.");
    return { snapshot: snapshot.value, latest: latest.value };
  }

  private async load(): Promise<void> {
    const binding = this.binding;
    if (!this.current(binding) || !binding.subscriptionId || this.state.reading || !binding.stale)
      return;
    const subscriptionId = binding.subscriptionId;
    const observed = binding.observed;
    binding.stale = false;
    this.update({ reading: true, readFailed: false });
    try {
      const entries = await Promise.all(
        binding.steps.flatMap((step) =>
          step.kind === "stage"
            ? [this.read(binding, subscriptionId, step.id).then((view) => [step.id, view] as const)]
            : [],
        ),
      );
      if (!this.current(binding) || binding.subscriptionId !== subscriptionId) return;
      this.update({ stages: new Map(entries) });
    } catch {
      if (this.current(binding) && binding.subscriptionId === subscriptionId)
        this.update({ readFailed: true });
    } finally {
      if (this.current(binding)) {
        this.update({ reading: false });
        if (binding.subscriptionId !== subscriptionId || binding.observed > observed) {
          binding.stale = true;
          void this.load();
        }
      }
    }
  }

  observeSurface = (listener: (event: NavigatorSurfaceEvent) => void): (() => void) => {
    this.surfaceListeners.add(listener);
    return () => this.surfaceListeners.delete(listener);
  };

  /** The Navigator tab is committed and visible for the current project. */
  committed(lease: ProjectSelectionLease): void {
    this.emit(lease, "committed");
  }

  /** The researcher explicitly activated the Navigator tab. */
  selected(lease: ProjectSelectionLease): void {
    this.emit(lease, "selected");
  }

  private emit(lease: ProjectSelectionLease, kind: NavigatorSurfaceEvent["kind"]): void {
    const binding = this.binding;
    if (!this.current(binding) || binding.lease !== lease) return;
    for (const listener of this.surfaceListeners) listener({ kind, projectId: lease.projectId });
  }
}
