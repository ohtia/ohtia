import {
  workspacePanels,
  workspaceMinimums,
  type WorkspaceLayout,
  type WorkspacePanel,
  type PanelWidths,
  type PanelVisibility,
} from "@ohtia/contracts";
import { designMetrics as metrics } from "./design-tokens.js";
export const readingWidth =
  34 * metrics["type.doc.body.size"] +
  2 *
    (metrics["component.workspace.document.padding"] +
      metrics["component.workspace.content.padding"]);
export const wideMinimum = 1024;
export function workspaceWidth(width: number): number {
  if (!Number.isFinite(width) || width < 0 || !Number.isSafeInteger(Math.floor(width)))
    throw new Error("Invalid available workspace width.");
  return Math.floor(width);
}
export function defaultWorkspaceLayout(width: number): WorkspaceLayout {
  const w = workspaceWidth(width);
  const reference = w < wideMinimum ? 1280 : w;
  const explorer = metrics["component.workspace.explorer.initial"];
  const chat = metrics["component.workspace.chat.initial"];
  return {
    version: 1,
    visible: { explorer: true, documents: true, chat: true },
    preferredWidths: {
      explorer,
      chat,
      documents: Math.min(
        100000,
        Math.max(
          readingWidth,
          reference - explorer - chat - 2 * metrics["component.separator.line"],
        ),
      ),
    },
  };
}
export interface WorkspaceGeometry {
  readonly width: number;
  readonly mode: "wide" | "narrow";
  readonly visible: PanelVisibility;
  readonly widths: PanelWidths;
  readonly rail: number;
  readonly pairs: readonly (readonly [WorkspacePanel, WorkspacePanel])[];
}
/** The only viewport allocation. It never changes the supplied preferred record. */
export function resolveWorkspaceLayout(
  layout: WorkspaceLayout,
  width: number,
  coarse = false,
  selected: WorkspacePanel = "documents",
  reopened?: WorkspacePanel,
): WorkspaceGeometry {
  const w = workspaceWidth(width);
  if (w < wideMinimum)
    return {
      width: w,
      mode: "narrow",
      visible: {
        explorer: selected === "explorer",
        documents: selected === "documents",
        chat: selected === "chat",
      },
      widths: {
        explorer: selected === "explorer" ? w : 0,
        documents: selected === "documents" ? w : 0,
        chat: selected === "chat" ? w : 0,
      },
      rail: 0,
      pairs: [],
    };
  const panels = workspacePanels.filter((panel) => layout.visible[panel]);
  const rail = layout.visible.explorer
    ? 0
    : metrics[coarse ? "component.rail.coarse" : "component.rail.width"];
  const available = w - rail - metrics["component.separator.line"] * (panels.length - 1);
  const widths = { explorer: 0, documents: 0, chat: 0 };
  for (const panel of panels)
    widths[panel] = Math.max(workspaceMinimums[panel], layout.preferredWidths[panel]);
  let excess = panels.reduce((sum, panel) => sum + widths[panel], 0) - available;
  if (excess < 0) {
    const receiver = panels.includes("documents")
      ? "documents"
      : panels.includes("chat")
        ? "chat"
        : "explorer";
    widths[receiver] -= excess;
  } else {
    const sides: WorkspacePanel[] =
      reopened === "chat" ? ["explorer", "chat"] : ["chat", "explorer"];
    for (const [panel, threshold] of [
      ["documents", readingWidth],
      ...sides.map((side) => [side, workspaceMinimums[side]] as const),
      ["documents", workspaceMinimums.documents],
    ] as const) {
      const key = panel;
      const yieldWidth = Math.min(excess, Math.max(0, widths[key] - threshold));
      widths[key] -= yieldWidth;
      excess -= yieldWidth;
    }
  }
  for (const panel of panels) widths[panel] = Math.floor(widths[panel]);
  const last = panels.at(-1);
  if (last) widths[last] += available - panels.reduce((sum, panel) => sum + widths[panel], 0);
  return {
    width: w,
    mode: "wide",
    visible: { ...layout.visible },
    widths,
    rail,
    pairs: panels.slice(1).map((panel, i) => [panels[i] as WorkspacePanel, panel] as const),
  };
}
export interface SeparatorRange {
  readonly minimum: number;
  readonly current: number;
  readonly maximum: number;
}
export function separatorRange(
  geometry: WorkspaceGeometry,
  left: WorkspacePanel,
  right: WorkspacePanel,
): SeparatorRange | undefined {
  if (!geometry.pairs.some((pair) => pair[0] === left && pair[1] === right)) return;
  return {
    minimum: workspaceMinimums[left],
    current: geometry.widths[left],
    maximum: geometry.widths[left] + geometry.widths[right] - workspaceMinimums[right],
  };
}
export function transferWorkspaceWidth(
  geometry: WorkspaceGeometry,
  left: WorkspacePanel,
  right: WorkspacePanel,
  requestedLeft: number,
): WorkspaceGeometry {
  const range = separatorRange(geometry, left, right);
  if (!range || !Number.isFinite(requestedLeft)) return geometry;
  const next = Math.min(range.maximum, Math.max(range.minimum, Math.floor(requestedLeft)));
  if (next === range.current) return geometry;
  return {
    ...geometry,
    widths: {
      ...geometry.widths,
      [left]: next,
      [right]: geometry.widths[left] + geometry.widths[right] - next,
    },
  };
}
export function resetWorkspacePair(
  geometry: WorkspaceGeometry,
  left: WorkspacePanel,
  right: WorkspacePanel,
  coarse = false,
): WorkspaceGeometry {
  if (!separatorRange(geometry, left, right)) return geometry;
  const defaults = resolveWorkspaceLayout(
    { ...defaultWorkspaceLayout(geometry.width), visible: geometry.visible },
    geometry.width,
    coarse,
  );
  const side = left === "explorer" ? left : right;
  const requested =
    side === left
      ? defaults.widths[left]
      : geometry.widths[left] + geometry.widths[right] - defaults.widths[right];
  return transferWorkspaceWidth(geometry, left, right, requested);
}
