import type { ManuscriptSection } from "@ohtia/contracts";

export type ManuscriptOutline = readonly ManuscriptSection[];

export interface ManuscriptBranch {
  readonly heading: ManuscriptSection;
  readonly children: ManuscriptBranch[];
}

export function manuscriptBranches(headings: ManuscriptOutline): ManuscriptBranch[] {
  const roots: ManuscriptBranch[] = [];
  const ancestors: ManuscriptBranch[] = [];
  for (const heading of headings) {
    while ((ancestors.at(-1)?.heading.level ?? 0) >= heading.level) ancestors.pop();
    const branch = { heading, children: [] };
    (ancestors.at(-1)?.children ?? roots).push(branch);
    ancestors.push(branch);
  }
  return roots;
}

/** Each ancestor retains its sibling group so a breadcrumb can navigate within that level. */
export function manuscriptPath(
  branches: readonly ManuscriptBranch[],
  active: string,
): readonly { heading: ManuscriptSection; siblings: readonly ManuscriptBranch[] }[] {
  for (const { heading, children } of branches) {
    const entry = { heading, siblings: branches };
    if (heading.id === active) return [entry];
    const path = manuscriptPath(children, active);
    if (path.length > 0) return [entry, ...path];
  }
  return [];
}

export function manuscriptSubtree(
  branches: readonly ManuscriptBranch[],
  depth = 0,
): readonly { heading: ManuscriptSection; depth: number }[] {
  return branches.flatMap(({ heading, children }) => [
    { heading, depth },
    ...manuscriptSubtree(children, depth + 1),
  ]);
}

/** Headings with children, which Fold all closes while the outline itself stays open. */
export function foldableBranches(branches: readonly ManuscriptBranch[]): string[] {
  return branches.flatMap(({ heading, children }) =>
    children.length > 0 ? [heading.id, ...foldableBranches(children)] : [],
  );
}
