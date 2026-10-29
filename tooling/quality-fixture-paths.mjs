// Stable synthetic roots must remain outside the independent native account home.
export function selectStableTemporaryParent(host, candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    let parent;
    try {
      parent = host.canonical(candidate);
    } catch {
      continue;
    }
    if (!host.contains(host.home, parent) && !host.contains(parent, host.home)) return parent;
  }
  throw new Error("A canonical temporary directory outside the native home is required.");
}
