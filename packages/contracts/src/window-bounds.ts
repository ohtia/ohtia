/** Non-sensitive normal window geometry in integer device-independent pixels. */
export interface WindowBounds {
  readonly version: 1;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}
export const windowMinimum = { width: 320, height: 400 } as const;
export function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = ["version", "x", "y", "width", "height", "maximized"];
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    !keys.every((key) => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))
  )
    return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === 1 &&
    typeof row.maximized === "boolean" &&
    [row.x, row.y, row.width, row.height].every(Number.isSafeInteger) &&
    Number(row.width) >= windowMinimum.width &&
    Number(row.width) <= 100000 &&
    Number(row.height) >= windowMinimum.height &&
    Number(row.height) <= 100000
  );
}
export function sameWindowBounds(left: WindowBounds, right: WindowBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.maximized === right.maximized
  );
}
