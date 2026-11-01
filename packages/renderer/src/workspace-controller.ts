import {
  copyWorkspaceLayout,
  workspacePanels,
  type WorkspaceLayout,
  type WorkspacePanel,
} from "@ohtia/contracts";
import { LayoutPreferences, type LayoutPreferenceState } from "./layout-preferences.js";
import {
  defaultWorkspaceLayout,
  resolveWorkspaceLayout,
  separatorRange,
  transferWorkspaceWidth,
  resetWorkspacePair,
  type WorkspaceGeometry,
} from "./workspace-geometry.js";
export type LayoutFocusIntent =
  | { readonly target: "panel-control" | "panel-heading"; readonly panel: WorkspacePanel }
  | { readonly target: "focus-control" };
export type LayoutAction = {
  readonly applied: boolean;
  readonly reason?: "last_panel" | "unavailable" | "unchanged";
  readonly focus?: LayoutFocusIntent;
};
export interface WorkspaceState {
  readonly preference: WorkspaceLayout;
  readonly geometry: WorkspaceGeometry;
  readonly focusMode: boolean;
  readonly dragging: boolean;
  readonly initializing: boolean;
  readonly transitions: boolean;
  readonly persistence: LayoutPreferenceState;
}
export interface ResizeHost {
  capture(pointerId: number): void;
  release(pointerId: number): void;
  lock(): void;
  unlock(): void;
}
export type ResizeCancelReason =
  "escape" | "pointercancel" | "focus-loss" | "unmount" | "viewport" | "visibility";
interface Drag {
  readonly pointer: number;
  readonly x: number;
  readonly left: WorkspacePanel;
  readonly right: WorkspacePanel;
  readonly start: WorkspaceGeometry;
  readonly host: ResizeHost;
}
/** One pure allocation owner per window. Consumers apply focus intents and translated announcements. */
export class WorkspaceController {
  private layout: WorkspaceLayout;
  private geometry: WorkspaceGeometry;
  private selected: WorkspacePanel = "documents";
  private snapshot: WorkspaceLayout | undefined;
  private drag: Drag | undefined;
  private disposed = false;
  private initializing = true;
  private initialization: Promise<void> | undefined;
  private readonly stop: () => void;
  private persistence: LayoutPreferenceState;
  constructor(
    private readonly preferences: LayoutPreferences,
    private width: number,
    private coarse = false,
    private readonly changed: (state: WorkspaceState) => void = () => {},
    private readonly focus: (intent: LayoutFocusIntent) => void = () => {},
  ) {
    this.layout = defaultWorkspaceLayout(width);
    this.geometry = resolveWorkspaceLayout(this.layout, width, coarse);
    this.persistence = preferences.snapshot;
    this.stop = preferences.observe((state) => {
      this.persistence = state;
      this.emit();
    });
  }
  get state(): WorkspaceState {
    return {
      preference: copyWorkspaceLayout(this.layout),
      geometry: {
        ...this.geometry,
        visible: { ...this.geometry.visible },
        widths: { ...this.geometry.widths },
        pairs: this.geometry.pairs.map((pair) => [...pair] as const),
      },
      focusMode: !!this.snapshot,
      dragging: !!this.drag,
      initializing: this.initializing,
      transitions: !this.drag,
      persistence: this.persistence,
    };
  }
  private get unavailable(): boolean {
    return this.disposed || this.initializing || this.preferences.busy;
  }
  private emit(): void {
    if (!this.disposed) this.changed(this.state);
  }
  private resolve(reopened?: WorkspacePanel): void {
    this.geometry = resolveWorkspaceLayout(
      this.layout,
      this.width,
      this.coarse,
      this.selected,
      reopened,
    );
  }
  initialize(): Promise<void> {
    if (this.disposed && !this.initialization) return Promise.resolve();
    this.initialization ??= this.loadInitial();
    return this.initialization;
  }
  private async loadInitial(): Promise<void> {
    const record = await this.preferences.load(true);
    if (this.disposed) return;
    this.initializing = false;
    const current = this.preferences.readModel;
    const loaded = record.ok
      ? current && current.revision >= record.value.revision
        ? current
        : record.value
      : undefined;
    if (loaded && loaded.value) {
      const saved = copyWorkspaceLayout(loaded.value);
      if (this.snapshot) {
        this.snapshot = saved;
        this.layout = { ...saved, visible: { explorer: false, documents: true, chat: false } };
      } else this.layout = saved;
    }
    this.resolve();
    this.emit();
  }
  viewport(width: number, coarse = this.coarse, focused?: WorkspacePanel): void {
    if (this.disposed) return;
    this.cancelResize("viewport");
    const wasWide = this.geometry.mode === "wide";
    const previousVisible = this.geometry.visible;
    this.width = width;
    this.coarse = coarse;
    if (Math.floor(width) < 1024 && wasWide) {
      if (this.snapshot) {
        this.layout = this.snapshot;
        this.snapshot = undefined;
      }
      this.selected =
        focused && previousVisible[focused]
          ? focused
          : previousVisible.documents
            ? "documents"
            : previousVisible.chat
              ? "chat"
              : "explorer";
    }
    this.resolve();
    if (!wasWide && this.geometry.mode === "wide" && !this.layout.visible[this.selected])
      this.focus({ target: "panel-control", panel: this.selected });
    this.emit();
  }
  select(panel: WorkspacePanel): LayoutAction {
    if (this.disposed || this.geometry.mode !== "narrow")
      return { applied: false, reason: "unavailable" };
    this.selected = panel;
    this.resolve();
    const focus = { target: "panel-heading", panel } as const;
    this.focus(focus);
    this.emit();
    return { applied: true, focus };
  }
  visibility(panel: WorkspacePanel, focused?: WorkspacePanel): LayoutAction {
    if (this.unavailable || this.geometry.mode !== "wide")
      return { applied: false, reason: "unavailable" };
    this.cancelResize("visibility");
    const open = !this.layout.visible[panel];
    if (!open && workspacePanels.filter((p) => this.layout.visible[p]).length === 1)
      return { applied: false, reason: "last_panel" };
    this.snapshot = undefined;
    const focus = open
      ? ({ target: "panel-heading", panel } as const)
      : focused === panel
        ? ({ target: "panel-control", panel } as const)
        : undefined;
    if (!open && focus) this.focus(focus);
    this.layout = { ...this.layout, visible: { ...this.layout.visible, [panel]: open } };
    this.resolve(open ? panel : undefined);
    if (open && focus) this.focus(focus);
    this.emit();
    void this.preferences.save(this.layout);
    return focus ? { applied: true, focus } : { applied: true };
  }
  focusMode(): LayoutAction {
    if (this.disposed || this.geometry.mode !== "wide")
      return { applied: false, reason: "unavailable" };
    this.cancelResize("visibility");
    if (this.snapshot) {
      this.layout = this.snapshot;
      this.snapshot = undefined;
    } else {
      this.snapshot = copyWorkspaceLayout(this.layout);
      this.layout = { ...this.layout, visible: { explorer: false, documents: true, chat: false } };
    }
    this.resolve();
    const focus = { target: "focus-control" } as const;
    this.focus(focus);
    this.emit();
    return { applied: true, focus };
  }
  reset(focused?: WorkspacePanel): LayoutAction {
    if (this.unavailable) return { applied: false, reason: "unavailable" };
    this.cancelResize("visibility");
    this.snapshot = undefined;
    const focus =
      this.geometry.mode === "narrow" &&
      focused &&
      focused !== "documents" &&
      this.geometry.visible[focused]
        ? ({ target: "panel-control", panel: focused } as const)
        : undefined;
    if (focus) this.focus(focus);
    this.layout = defaultWorkspaceLayout(this.width);
    this.selected = "documents";
    this.resolve();
    this.emit();
    void this.preferences.save(this.layout);
    return focus ? { applied: true, focus } : { applied: true };
  }
  private commitGeometry(next: WorkspaceGeometry, force = false): LayoutAction {
    if (this.unavailable || next.mode !== "wide") return { applied: false, reason: "unavailable" };
    if (
      !force &&
      workspacePanels.every((panel) => next.widths[panel] === this.geometry.widths[panel])
    ) {
      this.emit();
      return { applied: false, reason: "unchanged" };
    }
    this.snapshot = undefined;
    const preferredWidths = { ...this.layout.preferredWidths };
    for (const panel of workspacePanels)
      if (next.visible[panel]) preferredWidths[panel] = Math.min(100000, next.widths[panel]);
    this.layout = { ...this.layout, preferredWidths };
    this.geometry = next;
    this.emit();
    void this.preferences.save(this.layout);
    return { applied: true };
  }
  key(
    left: WorkspacePanel,
    right: WorkspacePanel,
    key: "ArrowLeft" | "ArrowRight" | "Home" | "End" | "Enter",
    shift = false,
  ): LayoutAction {
    if (this.unavailable || this.drag) return { applied: false, reason: "unavailable" };
    const range = separatorRange(this.geometry, left, right);
    if (!range) return { applied: false, reason: "unavailable" };
    const next =
      key === "Enter"
        ? resetWorkspacePair(this.geometry, left, right, this.coarse)
        : transferWorkspaceWidth(
            this.geometry,
            left,
            right,
            key === "Home"
              ? range.minimum
              : key === "End"
                ? range.maximum
                : range.current + (key === "ArrowLeft" ? -1 : 1) * (shift ? 64 : 16),
          );
    return this.commitGeometry(next, key === "Enter");
  }
  size(panel: WorkspacePanel, increase: boolean): LayoutAction {
    if (this.unavailable || this.drag) return { applied: false, reason: "unavailable" };
    const pair =
      this.geometry.pairs.find(([left]) => left === panel) ??
      this.geometry.pairs.find(([, right]) => right === panel);
    if (!pair) return { applied: false, reason: "unavailable" };
    const [left, right] = pair;
    return this.commitGeometry(
      transferWorkspaceWidth(
        this.geometry,
        left,
        right,
        this.geometry.widths[left] + (increase ? 16 : -16) * (panel === left ? 1 : -1),
      ),
    );
  }
  pairReset(left: WorkspacePanel, right: WorkspacePanel): LayoutAction {
    if (this.unavailable || this.drag) return { applied: false, reason: "unavailable" };
    if (!separatorRange(this.geometry, left, right))
      return { applied: false, reason: "unavailable" };
    return this.commitGeometry(resetWorkspacePair(this.geometry, left, right, this.coarse), true);
  }
  beginResize(
    left: WorkspacePanel,
    right: WorkspacePanel,
    pointer: number,
    x: number,
    host: ResizeHost,
  ): boolean {
    if (
      this.unavailable ||
      this.drag ||
      !Number.isFinite(x) ||
      !separatorRange(this.geometry, left, right)
    )
      return false;
    try {
      host.capture(pointer);
      host.lock();
    } catch {
      this.releaseHost(host, pointer);
      return false;
    }
    this.drag = { pointer, x, left, right, start: this.geometry, host };
    this.emit();
    return true;
  }
  moveResize(pointer: number, x: number): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== pointer || !Number.isFinite(x)) return;
    this.geometry = transferWorkspaceWidth(
      drag.start,
      drag.left,
      drag.right,
      drag.start.widths[drag.left] + x - drag.x,
    );
    this.emit();
  }
  endResize(pointer: number): LayoutAction {
    const drag = this.drag;
    if (!drag || drag.pointer !== pointer) return { applied: false, reason: "unavailable" };
    const next = this.geometry;
    this.release(drag);
    this.geometry = drag.start;
    return this.commitGeometry({ ...next });
  }
  private releaseHost(host: ResizeHost, pointer: number): void {
    try {
      host.release(pointer);
    } catch {
      /* Capture may already be lost. */
    } finally {
      try {
        host.unlock();
      } catch {
        /* Cleanup failure must not revive the gesture. */
      }
    }
  }
  private release(drag: Drag): void {
    this.drag = undefined;
    this.releaseHost(drag.host, drag.pointer);
  }
  cancelResize(reason: ResizeCancelReason): ResizeCancelReason | undefined {
    const drag = this.drag;
    if (!drag) return;
    this.geometry = drag.start;
    this.release(drag);
    this.emit();
    return reason;
  }
  dispose(): void {
    if (this.disposed) return;
    this.cancelResize("unmount");
    this.disposed = true;
    this.stop();
  }
}
