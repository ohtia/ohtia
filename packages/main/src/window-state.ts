import { randomUUID } from "node:crypto";
import {
  isWindowBounds,
  windowMinimum,
  windowTokens,
  failure,
  type WindowBounds,
  type AppearanceRecord,
  type Appearance,
  type Operation,
  type OperationInputs,
  type OperationOutputs,
  type Outcome,
} from "@ohtia/contracts";
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Placement extends Rectangle {
  readonly maximized: boolean;
}
function clampSize(bounds: Rectangle, area: Rectangle): Rectangle {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.min(bounds.width, area.width),
    height: Math.min(bounds.height, area.height),
  };
}
function fits(bounds: Rectangle, area: Rectangle): boolean {
  return (
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height
  );
}
/** Displays supply work areas in DIP. No monitor identity enters the preference. */
export function windowPlacement(
  saved: unknown,
  areas: readonly Rectangle[],
  primary: Rectangle,
  focused?: Rectangle,
  backend: "positioned" | "wayland" = "positioned",
): Placement {
  const fallback = clampSize({ x: 0, y: 0, width: 1280, height: 800 }, primary);
  const normal = {
    ...fallback,
    x: Math.round(primary.x + (primary.width - fallback.width) / 2),
    y: Math.round(primary.y + (primary.height - fallback.height) / 2),
    maximized: false,
  };
  const valid = isWindowBounds(saved) ? saved : undefined;
  if (backend === "wayland")
    return {
      ...clampSize(valid ?? normal, primary),
      x: 0,
      y: 0,
      maximized: valid?.maximized ?? false,
    };

  if (focused) {
    const area =
      areas.find(
        (area) =>
          focused.x >= area.x &&
          focused.y >= area.y &&
          focused.x < area.x + area.width &&
          focused.y < area.y + area.height,
      ) ?? primary;
    const size = clampSize(valid ?? normal, area);
    return {
      ...size,
      x: Math.max(area.x, Math.min(focused.x + 24, area.x + area.width - size.width)),
      y: Math.max(area.y, Math.min(focused.y + 24, area.y + area.height - size.height)),
      maximized: valid?.maximized ?? false,
    };
  }
  if (valid)
    for (const area of areas) {
      const candidate = clampSize(valid, area);
      if (fits(candidate, area)) return { ...candidate, maximized: valid.maximized };
    }
  return normal;
}
export function windowOptions(
  platform: string,
  scheme: "light" | "dark",
  placement: Placement,
  wayland = false,
) {
  const colors = windowTokens[scheme];
  const bounds = {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
  return {
    ...(wayland ? { width: bounds.width, height: bounds.height } : bounds),
    minWidth: windowMinimum.width,
    minHeight: windowMinimum.height,
    show: false,
    backgroundColor: colors["surface.page"],
    autoHideMenuBar: true,
    titleBarStyle: platform === "darwin" ? ("hiddenInset" as const) : ("hidden" as const),
    ...(platform === "darwin"
      ? { titleBarOverlay: { height: windowTokens.height } }
      : {
          titleBarOverlay: {
            height: windowTokens.height,
            color: colors["surface.panel"],
            ...(platform === "win32" ? { symbolColor: colors["content.primary"] } : {}),
          },
        }),
  };
}
export interface ThemedWindow {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
  setTitleBarOverlay(options: { height: number; color: string; symbolColor?: string }): void;
}
/** A revision belongs to one admitted service generation. Native system changes do not write it. */
export class WindowTheme {
  private revision = -1;
  private choice: Appearance = "system";
  constructor(
    private platform: string,
    private systemDark: () => boolean,
  ) {}
  reset(): void {
    this.revision = -1;
    this.choice = "system";
  }
  confirm(record: AppearanceRecord): boolean {
    if (record.revision <= this.revision) return false;
    this.revision = record.revision;
    this.choice = record.source === "invalid_fallback" ? "system" : record.value;
    return true;
  }
  source(workspace = true): Appearance {
    return workspace ? this.choice : "system";
  }
  scheme(workspace = true): "light" | "dark" {
    const source = this.source(workspace);
    return source !== "system" ? source : this.systemDark() ? "dark" : "light";
  }
  apply(window: ThemedWindow, workspace = true): void {
    if (window.isDestroyed()) return;
    const colors = windowTokens[this.scheme(workspace)];
    window.setBackgroundColor(colors["surface.page"]);
    if (this.platform !== "darwin")
      window.setTitleBarOverlay({
        height: windowTokens.height,
        color: colors["surface.panel"],
        ...(this.platform === "win32" ? { symbolColor: colors["content.primary"] } : {}),
      });
  }
}
export interface WindowPreferencePeer {
  readonly ceased?: boolean;
  request<K extends Operation>(
    operation: K,
    payload: OperationInputs[K],
    operationId?: string,
  ): Promise<Outcome<OperationOutputs[K]>>;
}
/** Close-time writes outlive their renderer. Each accepted intent is submitted once, in order. */
export class WindowPreferences {
  private queue = Promise.resolve();
  private pending = 0;
  private uncertain = new Map<string, { owner: WindowPreferencePeer; reported: boolean }>();
  constructor(
    private peer: () => WindowPreferencePeer | undefined,
    private failed: () => void,
    private limit: number,
  ) {}
  async read() {
    const peer = this.peer();
    return peer ? peer.request("bounds.read", {}) : failure("service_unavailable");
  }
  save(value: WindowBounds): Promise<void> {
    const peer = this.peer();
    if (!peer || !isWindowBounds(value) || this.pending + this.uncertain.size >= this.limit) {
      this.failed();
      return Promise.resolve();
    }
    const operationId = randomUUID();
    const copied = { ...value };
    this.pending++;
    const work = this.queue
      .then(async () => {
        const current = await peer.request("bounds.read", {});
        if (!current.ok) {
          this.failed();
          return;
        }
        const result = await peer.request(
          "bounds.replace",
          { expectedRevision: current.value.revision, value: copied },
          operationId,
        );
        if (result.ok) return;
        if (result.error.code === "uncertain") {
          this.uncertain.set(operationId, { owner: peer, reported: false });
          await this.reconcile(operationId, peer);
        } else this.failed();
      })
      .catch(() => {
        this.failed();
      })
      .finally(() => {
        this.pending--;
      });
    this.queue = work;
    return work;
  }
  private async reconcile(operationId: string, peer: WindowPreferencePeer): Promise<void> {
    const original = this.uncertain.get(operationId);
    if (!original) return;
    const receipt = await peer.request("bounds.receipt", { targetOperationId: operationId });
    if (receipt.ok && receipt.value.state === "recorded") {
      this.uncertain.delete(operationId);
      if (!receipt.value.outcome.ok && !original.reported) {
        original.reported = true;
        this.failed();
      }
    } else {
      // A replacement writer establishes absence only after its predecessor has ceased.
      if (
        receipt.ok &&
        receipt.value.state === "not_found" &&
        original.owner !== peer &&
        original.owner.ceased === true
      )
        this.uncertain.delete(operationId);
      if (!original.reported) {
        original.reported = true;
        this.failed();
      }
    }
  }
  async reconcilePending(): Promise<void> {
    const peer = this.peer();
    if (!peer) return;
    for (const operationId of this.uncertain.keys()) await this.reconcile(operationId, peer);
  }
  drain(): Promise<void> {
    return this.queue;
  }
}
