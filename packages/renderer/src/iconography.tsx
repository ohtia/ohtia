import { createElement } from "react";
import { designMetrics } from "./design-tokens.js";
import { iconNodes } from "./design-icons.js";

export type LucideName = keyof typeof iconNodes;

/** Decorative local geometry; the consuming control owns its name and semantics. */
export function LucideGlyph({
  name,
  size = designMetrics["icon.size.medium"],
}: {
  readonly name: LucideName;
  readonly size?: (typeof designMetrics)[
    "icon.size.small" | "icon.size.medium" | "icon.size.large"];
}) {
  if (!Object.hasOwn(iconNodes, name)) throw new RangeError("Unknown local icon.");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="var(--icon-stroke)"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconNodes[name].map(([tag, attributes], index) =>
        createElement(tag, { ...attributes, key: index }),
      )}
    </svg>
  );
}
