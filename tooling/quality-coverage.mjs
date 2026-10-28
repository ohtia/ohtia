import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isDeepStrictEqual } from "node:util";
import { git, requireGate, sameSet, walk } from "./quality-core.mjs";
import { packageDirectories } from "./packages.mjs";

export function productSources(root) {
  return packageDirectories(root)
    .flatMap((directory) => walk(path.join(directory, "src")))
    .filter(
      (file) =>
        /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) &&
        !file.endsWith(".d.ts") &&
        file !== path.join(root, "packages/contracts/src/generated/resource-policy.ts"),
    );
}
export function changedLines(root, base, file) {
  requireGate(/^[a-f0-9]{40}$/.test(base), "diff base must be an immutable full commit SHA");
  git(root, ["cat-file", "-e", `${base}^{commit}`]);
  const relative = path.relative(root, file).split(path.sep).join("/");
  const oldFiles = git(root, ["ls-tree", "--name-only", base, "--", relative]);
  if (!oldFiles)
    return new Set(
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((_, i) => i + 1),
    );
  const diff = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--text",
    "--inter-hunk-context=0",
    "--diff-algorithm=myers",
    "--no-indent-heuristic",
    "--unified=0",
    base,
    "--",
    relative,
  ]);
  const lines = new Set();
  const headers = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)];
  requireGate(
    !diff ||
      headers.length > 0 ||
      git(root, ["show", `${base}:${relative}`]) === fs.readFileSync(file, "utf8").trimEnd(),
    `${relative}: source content changed without textual hunks`,
  );
  for (const match of headers) {
    const start = Number(match[1]),
      count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line++) lines.add(line);
  }
  return lines;
}
function location(value, lineCount, end = false) {
  return (
    value &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    value.line <= lineCount &&
    ((end && value.column === null) || (Number.isSafeInteger(value.column) && value.column >= 0))
  );
}
function hits(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
export function executableSource(source, label) {
  const ast = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true);
  return ast.statements.some(
    (node) =>
      !ts.isImportDeclaration(node) &&
      !ts.isExportDeclaration(node) &&
      !ts.isInterfaceDeclaration(node) &&
      !ts.isTypeAliasDeclaration(node),
  );
}
export function validateFileCoverage(report, source, label) {
  requireGate(
    !/\b(?:istanbul|c8|v8) ignore\b/.test(source),
    `${label}: unreviewed coverage suppression`,
  );
  requireGate(
    report && typeof report === "object",
    `${label}: missing own source (including unimported code)`,
  );
  for (const field of ["statementMap", "s", "branchMap", "b", "fnMap", "f"])
    requireGate(
      report[field] && typeof report[field] === "object" && !Array.isArray(report[field]),
      `${label}: invalid ${field}`,
    );
  for (const [map, counters] of [
    ["statementMap", "s"],
    ["branchMap", "b"],
    ["fnMap", "f"],
  ])
    sameSet(Object.keys(report[map]), Object.keys(report[counters]), `${label}: ${map} counters`);
  const lineCount = source.split("\n").length;
  const lines = new Map();
  for (const [id, loc] of Object.entries(report.statementMap)) {
    requireGate(
      location(loc.start, lineCount) &&
        location(loc.end, lineCount, true) &&
        loc.end.line >= loc.start.line &&
        hits(report.s[id]),
      `${label}: invalid statement ${id}`,
    );
    lines.set(loc.start.line, Math.max(lines.get(loc.start.line) ?? 0, report.s[id]));
  }
  const ast = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    label.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // Reexports/type declarations may have no counters. A body/initializer cannot disappear.
  let executable = false;
  function visit(node) {
    if (
      (ts.isVariableDeclaration(node) && node.initializer) ||
      ts.isExpressionStatement(node) ||
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node)
    )
      executable = true;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  requireGate(!executable || lines.size > 0, `${label}: empty report for own executable code`);
  const branches = [];
  for (const [id, branch] of Object.entries(report.branchMap)) {
    const counts = report.b[id];
    requireGate(
      Array.isArray(branch.locations) &&
        branch.locations.length > 0 &&
        Array.isArray(counts) &&
        counts.length === branch.locations.length &&
        counts.every(hits),
      `${label}: invalid branch ${id}`,
    );
    for (const [index, loc] of branch.locations.entries()) {
      const implicitElse =
        branch.type === "if" && index === 1 && JSON.stringify(loc) === '{"start":{},"end":{}}';
      requireGate(
        implicitElse || (location(loc.start, lineCount) && location(loc.end, lineCount, true)),
        `${label}: invalid branch location`,
      );
    }
    branches.push(...counts);
  }
  for (const [id, fn] of Object.entries(report.fnMap))
    requireGate(
      fn.loc &&
        location(fn.loc.start, lineCount) &&
        location(fn.loc.end, lineCount, true) &&
        hits(report.f[id]),
      `${label}: invalid function ${id}`,
    );
  return { lines, branches };
}
/** Count changed source lines using raw execution regions, never a collapsed enclosing hit. */
export function changedExecutableLines(source, label, changed, coverage) {
  requireGate(
    coverage?.statementMap && coverage?.fnMap && coverage?.branchMap,
    "missing raw diff execution maps",
  );
  const ast = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    label.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const starts = ast.getLineStarts();
  const position = (location, end = false) => {
    if (!location?.line || location.line > starts.length) return undefined;
    return location.column === null && end
      ? (starts[location.line] ?? source.length)
      : starts[location.line - 1] + location.column;
  };
  const regions = [];
  function region(location, hits) {
    const start = position(location?.start),
      end = position(location?.end, true);
    if (start !== undefined && end !== undefined && end > start) regions.push({ start, end, hits });
  }
  for (const [id, location] of Object.entries(coverage.statementMap))
    region(location, coverage.s[id]);
  for (const [id, fn] of Object.entries(coverage.fnMap)) region(fn.loc, coverage.f[id]);
  const ifBodies = new Map();
  const tokens = [];
  const delimiters = new Set([
    ts.SyntaxKind.CloseBraceToken,
    ts.SyntaxKind.CloseBracketToken,
    ts.SyntaxKind.OpenParenToken,
    ts.SyntaxKind.CloseParenToken,
    ts.SyntaxKind.SemicolonToken,
    ts.SyntaxKind.CommaToken,
  ]);
  function visit(node, needsRegion = false) {
    if (ts.isHeritageClause(node)) {
      if (node.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent))
        for (const type of node.types) visit(type.expression, true);
      return;
    }
    if (ts.isDecorator(node)) {
      visit(node.expression, true);
      return;
    }
    if (
      (ts.isFunctionLike(node) && !node.body && !node.modifiers?.some(ts.isDecorator)) ||
      (ts.isPropertyDeclaration(node) &&
        ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Abstract &&
        !node.modifiers?.some(ts.isDecorator)) ||
      ts.isTypeNode(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) ||
      ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient
    )
      return;
    if (ts.isIfStatement(node)) {
      const start = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      ifBodies.set(
        `${start.line + 1}:${start.character}`,
        [node.thenStatement, node.elseStatement].map((body) => {
          if (!body) return undefined;
          const statements = ts.isBlock(body) ? [...body.statements] : [body];
          return statements.length
            ? { start: statements[0].getStart(ast), end: statements.at(-1).end }
            : undefined;
        }),
      );
    }
    const children = node.getChildren(ast);
    if (children.length) {
      for (const child of children) visit(child, needsRegion || ts.isComputedPropertyName(node));
      return;
    }
    if (
      delimiters.has(node.kind) ||
      node.kind === ts.SyntaxKind.EndOfFileToken ||
      (node.kind === ts.SyntaxKind.OpenBraceToken && !ts.isObjectLiteralExpression(node.parent)) ||
      node.end <= node.getStart(ast)
    )
      return;
    const start = node.getStart(ast),
      end = node.end;
    if (source.slice(start, end).trim()) tokens.push({ start, end, requiresRegion: needsRegion });
  }
  visit(ast);
  for (const [id, branch] of Object.entries(coverage.branchMap)) {
    if (branch.type === "if") {
      for (const [index, body] of (
        ifBodies.get(`${branch.loc?.start?.line}:${branch.loc?.start?.column}`) ?? []
      ).entries())
        if (body) regions.push({ ...body, hits: coverage.b[id][index] });
    } else
      for (const [index, location] of branch.locations.entries())
        region(location, coverage.b[id][index]);
  }
  const result = new Map();
  for (const line of changed) {
    const start = starts[line - 1],
      end = starts[line] ?? source.length;
    if (start === undefined) continue;
    const segments = tokens
      .filter((token) => token.start < end && token.end > start)
      .map((token) => ({
        start: Math.max(start, token.start),
        end: Math.min(end, token.end),
        requiresRegion: token.requiresRegion,
      }));
    requireGate(
      segments
        .filter((token) => token.requiresRegion)
        .every((token) =>
          regions.some((context) => context.start < token.end && context.end > token.start),
        ),
      `${label}:${line}: runtime expression has no coverage region; extend instrumentation before accepting this change`,
    );
    const hits = regions
      .filter((context) =>
        segments.some((token) => context.start < token.end && context.end > token.start),
      )
      .map((context) => context.hits);
    if (hits.length) result.set(line, Math.min(...hits));
  }
  return result;
}
function metric(covered, total, floor) {
  return {
    covered,
    total,
    percent: total ? (100 * covered) / total : null,
    status: total ? (100 * covered >= floor * total ? "passed" : "failed") : "inapplicable",
  };
}
export function coverageByPath(root, reports, paths = path) {
  const indexed = new Map();
  for (const [key, report] of Object.entries(reports)) {
    const file = paths.resolve(root, key);
    requireGate(
      !indexed.has(file) && report.path === key,
      `duplicate or mismatched coverage path: ${key}`,
    );
    indexed.set(file, report);
  }
  return indexed;
}
export function coverageGate(
  root,
  reports,
  base,
  changes = (file) => changedLines(root, base, file),
  canonical,
) {
  requireGate(
    reports && typeof reports === "object" && !Array.isArray(reports),
    "invalid coverage report",
  );
  requireGate(
    canonical && typeof canonical === "object",
    "missing independent coverage denominator",
  );
  const sources = productSources(root);
  const indexed = coverageByPath(root, reports);
  const canonicalByPath = coverageByPath(root, canonical);
  sameSet(
    [...indexed.keys()].filter((f) => !sources.includes(f)),
    [],
    "unexpected coverage sources",
  );
  for (const file of sources) {
    if (!indexed.has(file) && !executableSource(fs.readFileSync(file, "utf8"), file))
      indexed.set(file, {
        path: file,
        statementMap: {},
        s: {},
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      });
  }
  sameSet([...indexed.keys()], sources, "coverage source inventory");
  for (const [file, actual] of indexed) {
    const expected = canonicalByPath.get(file);
    if (!expected && !executableSource(fs.readFileSync(file, "utf8"), file)) continue;
    requireGate(expected, `${file}: missing independent denominator`);
    for (const field of ["statementMap", "branchMap", "fnMap"])
      requireGate(
        isDeepStrictEqual(actual[field], expected[field]),
        `${file}: partial/stale ${field} denominator`,
      );
    requireGate(
      Object.values(expected.s).every((n) => n === 0) &&
        Object.values(expected.f).every((n) => n === 0) &&
        Object.values(expected.b)
          .flat()
          .every((n) => n === 0),
      `${file}: denominator must contain no execution evidence`,
    );
  }
  const packages = {};
  for (const directory of packageDirectories(root)) {
    const name = path.basename(directory);
    const allLines = [],
      allBranches = [],
      diffLines = [];
    for (const file of sources.filter((file) => file.startsWith(directory + path.sep))) {
      const { lines, branches } = validateFileCoverage(
        indexed.get(file),
        fs.readFileSync(file, "utf8"),
        file,
      );
      const changed = changes(file);
      allLines.push(...lines.values());
      allBranches.push(...branches);
      diffLines.push(
        ...changedExecutableLines(
          fs.readFileSync(file, "utf8"),
          file,
          changed,
          indexed.get(file),
        ).values(),
      );
    }
    packages[name] = {
      lines: metric(allLines.filter((hit) => hit > 0).length, allLines.length, 80),
      branches: metric(allBranches.filter((hit) => hit > 0).length, allBranches.length, 80),
      diff: metric(diffLines.filter((hit) => hit > 0).length, diffLines.length, 90),
    };
  }
  return {
    version: 1,
    base,
    packages,
    status: Object.values(packages).some((p) => Object.values(p).some((m) => m.status === "failed"))
      ? "failed"
      : "passed",
  };
}
