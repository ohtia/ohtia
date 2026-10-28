/** Normalize fixture-only paths without accessing the host filesystem. */
export function fixturePath(value: unknown): string {
  return String(value).replaceAll("\\", "/");
}
export function differentTarget(
  platform: string = process.platform,
  architecture: string = process.arch,
): string {
  return `${platform}-${architecture === "x64" ? "arm64" : "x64"}`;
}
