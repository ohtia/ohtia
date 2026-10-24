import { isAppearance, type Appearance, type ColorScheme } from "@ohtia/contracts";

export function appearanceOrDefault(value: unknown): Appearance {
  return isAppearance(value) ? value : "system";
}

export function resolveColorScheme(appearance: Appearance, systemDark: boolean): ColorScheme {
  return appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
}
