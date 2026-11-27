/** One incarnation of a project selection in its owning renderer window. */
export interface ProjectSelectionLease {
  readonly projectId: string;
  readonly isCurrent: () => boolean;
}

export type PendingWorkDecision =
  | { readonly status: "keep_open" | "pending_confirmation" }
  | {
      readonly status: "safe_to_detach";
      /** Recheck mutable work after other guards finish and immediately before detaching. */
      readonly isCurrent?: () => boolean;
    };

export interface PendingWorkScope extends ProjectSelectionLease {
  /** Revoked when this evaluation can no longer authorize work for its captured selection. */
  readonly signal: AbortSignal;
}

/** Check scope freshness before acting on a delayed confirmation. */
export type PendingWorkGuard = (
  scope: PendingWorkScope,
) => PendingWorkDecision | Promise<PendingWorkDecision>;

type DetachDecision =
  | { readonly status: "keep_open" | "pending_confirmation" }
  | { readonly status: "safe_to_detach"; readonly isCurrent: () => boolean };

interface SelectionGuards {
  readonly registrations: Set<{ readonly guard: PendingWorkGuard }>;
  evaluation?: { readonly abort: AbortController; pending: boolean };
}

const keepOpen = { status: "keep_open" } as const;
const pending = { status: "pending_confirmation" } as const;

/** One registry per window. Editors own the decision and any save or discard. */
export class PendingProjectWork {
  private selection: SelectionGuards | undefined;

  constructor(private readonly selectionLease: () => ProjectSelectionLease | undefined) {}

  revokeSelection(): void {
    const selection = this.selection;
    this.selection = undefined;
    selection?.evaluation?.abort.abort();
  }

  private currentSelection(lease: ProjectSelectionLease): SelectionGuards | undefined {
    if (lease !== this.selectionLease() || !lease.isCurrent()) return;
    return (this.selection ??= { registrations: new Set() });
  }

  /** A mounted consumer renews its registration whenever the controller issues a new lease. */
  register(lease: ProjectSelectionLease, guard: PendingWorkGuard): () => void {
    const selection = this.currentSelection(lease);
    if (!selection) return () => {};
    const registration = { guard };
    selection.registrations.add(registration);
    selection.evaluation?.abort.abort();
    return () => {
      if (selection.registrations.delete(registration)) selection.evaluation?.abort.abort();
    };
  }

  /**
   * Evaluate in registration order so only one editor asks for a decision at a time.
   * A pending result keeps the selection open until a later evaluation allows detach.
   * Use a safe result only after its final freshness check in the same turn as detach.
   */
  async evaluate(lease: ProjectSelectionLease): Promise<DetachDecision> {
    const selection = this.currentSelection(lease);
    if (!selection) return keepOpen;
    if (selection.evaluation?.pending && !selection.evaluation.abort.signal.aborted) return pending;

    const previous = selection.evaluation;
    const evaluation = { abort: new AbortController(), pending: true };
    selection.evaluation = evaluation;
    previous?.abort.abort();
    const { signal } = evaluation.abort;
    const scope = Object.freeze({
      projectId: lease.projectId,
      signal,
      isCurrent: () => lease.isCurrent() && !signal.aborted,
    });
    if (!scope.isCurrent()) return keepOpen;
    let onAbort = () => {};
    const revoked = new Promise<DetachDecision>((resolve) => {
      onAbort = () => {
        resolve(keepOpen);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const decision = await Promise.race([revoked, this.evaluateGuards(selection, scope)]);
      if (!scope.isCurrent()) return keepOpen;
      if (decision.status === "safe_to_detach" && decision.isCurrent()) return decision;
      evaluation.abort.abort();
      return decision.status === "safe_to_detach" ? keepOpen : decision;
    } finally {
      signal.removeEventListener("abort", onAbort);
      evaluation.pending = false;
    }
  }

  private async evaluateGuards(
    selection: SelectionGuards,
    scope: PendingWorkScope,
  ): Promise<DetachDecision> {
    const checks: (() => boolean)[] = [];
    const allowed = () => {
      try {
        return scope.isCurrent() && checks.every((check) => check()) && scope.isCurrent();
      } catch {
        return false;
      }
    };

    try {
      for (const { guard } of selection.registrations) {
        if (!allowed()) return keepOpen;
        const decision = await guard(scope);
        if (!allowed()) return keepOpen;
        if (decision.status !== "safe_to_detach") return decision;
        if (decision.isCurrent) checks.push(decision.isCurrent);
      }
      return allowed() ? { status: "safe_to_detach", isCurrent: allowed } : keepOpen;
    } catch {
      return keepOpen;
    }
  }
}
