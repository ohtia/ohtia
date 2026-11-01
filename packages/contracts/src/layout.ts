/** Public, non-sensitive workspace preference; no research identities belong here. */
export const workspacePanels = ["explorer", "documents", "chat"] as const;
export type WorkspacePanel = (typeof workspacePanels)[number];
export type PanelWidths = Readonly<Record<WorkspacePanel, number>>;
export type PanelVisibility = Readonly<Record<WorkspacePanel, boolean>>;
export const workspaceMinimums: PanelWidths = { explorer: 200, documents: 320, chat: 280 };
export interface WorkspaceLayout {
  readonly version: 1;
  readonly visible: PanelVisibility;
  readonly preferredWidths: PanelWidths;
}
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, "value")
      );
    })
  );
}
/** Structural check never invokes an accessor or accepts private/unknown fields. */
export function isWorkspaceLayout(value: unknown): value is WorkspaceLayout {
  if (
    !fields(value, ["version", "visible", "preferredWidths"]) ||
    value.version !== 1 ||
    !fields(value.visible, workspacePanels) ||
    !fields(value.preferredWidths, workspacePanels)
  )
    return false;
  const visible = value.visible;
  const widths = value.preferredWidths;
  return (
    workspacePanels.every((panel) => typeof visible[panel] === "boolean") &&
    workspacePanels.some((panel) => visible[panel] === true) &&
    workspacePanels.every((panel) => {
      const width = widths[panel];
      return (
        typeof width === "number" &&
        Number.isFinite(width) &&
        width >= workspaceMinimums[panel] &&
        width <= 100000
      );
    })
  );
}
export function copyWorkspaceLayout(value: WorkspaceLayout): WorkspaceLayout {
  return {
    version: 1,
    visible: { ...value.visible },
    preferredWidths: { ...value.preferredWidths },
  };
}
export function sameWorkspaceLayout(left: WorkspaceLayout, right: WorkspaceLayout): boolean {
  return workspacePanels.every(
    (panel) =>
      left.visible[panel] === right.visible[panel] &&
      left.preferredWidths[panel] === right.preferredWidths[panel],
  );
}
