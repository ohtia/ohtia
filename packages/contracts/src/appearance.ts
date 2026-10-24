export const appearances = ["system", "light", "dark"] as const;
export type Appearance = (typeof appearances)[number];
export type ColorScheme = Exclude<Appearance, "system">;

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}
