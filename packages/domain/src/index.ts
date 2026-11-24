import { isAppearance, type Appearance, type ColorScheme } from "@ohtia/contracts";

export function appearanceOrDefault(value: unknown): Appearance {
  return isAppearance(value) ? value : "system";
}

export function resolveColorScheme(appearance: Appearance, systemDark: boolean): ColorScheme {
  return appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
}

export { applyAppearanceCommand } from "./appearance-command.js";
export type {
  AppearanceCommand,
  RecordedAppearanceCommand,
  AppearanceTransaction,
} from "./appearance-command.js";

export * from "./locale-command.js";
export {
  applyLayoutCommand,
  type LayoutTransaction,
  type RecordedLayoutCommand,
} from "./layout-command.js";

export * from "./window-bounds-command.js";

export {
  applyUpdateCheckCommand,
  type UpdateCheckCommand,
  type RecordedUpdateCheckCommand,
  type UpdateCheckTransaction,
} from "./update-check-command.js";
