/** Return the preview prefix when text remains beyond a positive code-point limit. */
export function clippedText(text: string, limit: number): string | undefined {
  if (limit === 0 || text.length <= limit) return undefined;
  let count = 0;
  let end = 0;
  for (const point of text) {
    if (count === limit) return text.slice(0, end);
    count++;
    end += point.length;
  }
  return undefined;
}
