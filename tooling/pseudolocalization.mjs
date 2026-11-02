/** Expand already rendered synthetic text; this is never a supported locale or fallback. */
export function pseudolocalize(text) {
  return `⟦${text}${"·".repeat(Math.ceil(Array.from(text).length * 0.4))}⟧`;
}
