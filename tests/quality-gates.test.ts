import { createCoverageInstrumenter } from "../tooling/quality-instrumenter.mjs";
import vm from "node:vm";
import { transformWithOxc } from "vite";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountShards,
  assertDeclaredCases,
  readJson,
  shardCases,
} from "../tooling/quality-core.mjs";
import {
  coverageGate as evaluateCoverage,
  coverageByPath,
  changedLines,
  changedExecutableLines as attributeChanges,
  validateFileCoverage,
} from "../tooling/quality-coverage.mjs";
import { catalogGate } from "../tooling/quality-catalogs.mjs";
import { accountNative, nativeInventory } from "../tooling/quality-inventory.mjs";
import { assertCheckoutIdentity, checkoutIdentity } from "../tooling/quality.mjs";
import { fixturePath, differentTarget } from "./fixtures/platform.js";
import { playwrightCases } from "../tooling/quality-playwright.mjs";

// Use the selected coverage provider's own pinned instrumenter for execution-boundary fixtures.
const instrumentRequire = createRequire(import.meta.resolve("@vitest/coverage-istanbul"));
const { createCoverageMap } = instrumentRequire("@vitest/istanbul-lib-coverage");
const { createSourceMapStore } = instrumentRequire("@vitest/istanbul-lib-source-maps");
async function instrument(source: string, filename = "/fixture/own.js", inputSourceMap?: object) {
  const context = {};
  vm.runInNewContext(
    createCoverageInstrumenter({
      coverageGlobalScope: "globalThis",
      coverageGlobalScopeFunc: false,
    }).instrumentSync(source, filename, inputSourceMap),
    context,
  );
  const raw = JSON.parse(
    JSON.stringify((context as { __coverage__: Record<string, unknown> }).__coverage__[filename]),
  );
  const mapped = await createSourceMapStore().transformCoverage(
    createCoverageMap({ [filename]: raw }),
  );
  return JSON.parse(JSON.stringify(mapped.fileCoverageFor(filename).toJSON()));
}
function changedExecutableLines(
  source: string,
  label: string,
  lines: Map<number, number>,
  changed: Set<number>,
  branches = { branchMap: {}, b: {} },
) {
  const anchors = [...lines].sort(([a], [b]) => a - b);
  const raw = {
    statementMap: Object.fromEntries(
      anchors.map(([line], i) => [
        String(i),
        {
          start: { line, column: 0 },
          end: {
            line: anchors[i + 1] ? anchors[i + 1][0] - 1 : source.split("\n").length,
            column: null,
          },
        },
      ]),
    ),
    s: Object.fromEntries(anchors.map(([, hit], i) => [String(i), hit])),
    fnMap: {},
    f: {},
    ...branches,
  };
  return attributeChanges(source, label, changed, raw);
}
function denominator(reports: Record<string, ReturnType<typeof report>>) {
  const result = structuredClone(reports);
  for (const coverage of Object.values(result)) {
    for (const key of Object.keys(coverage.s)) coverage.s[key] = 0;
    for (const key of Object.keys(coverage.f)) coverage.f[key] = 0;
    for (const key of Object.keys(coverage.b)) coverage.b[key] = coverage.b[key].map(() => 0);
  }
  return result;
}
function coverageGate(
  root: string,
  reports: Record<string, ReturnType<typeof report>>,
  base: string,
  changes: (file: string) => Set<number>,
) {
  return evaluateCoverage(root, reports, base, changes, denominator(reports));
}
const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-quality-ñ-"));
  temporary.push(root);
  return root;
}
function report(file: string, lineHits = [1, 1, 1, 1, 1], branches = [1, 1, 1, 1, 1]) {
  const loc = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 20 } });
  return {
    path: file,
    statementMap: Object.fromEntries(lineHits.map((_, i) => [String(i), loc(i + 1)])),
    s: Object.fromEntries(lineHits.map((hit, i) => [String(i), hit])),
    branchMap: { 0: { type: "if", locations: branches.map(() => loc(1)) } },
    b: { 0: branches },
    fnMap: {},
    f: {},
  };
}
function product() {
  const root = fixture();
  const file = path.join(root, "packages", "example", "src", "own.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(root, "packages/example/package.json"), '{"name":"@ohtia/example"}');
  fs.writeFileSync(
    file,
    Array.from({ length: 5 }, (_, i) => `export const value${i} = ${i};`).join("\n"),
  );
  return { root, file };
}
describe("independent product coverage", () => {
  it("rejects an unobservable executable class heritage expression", async () => {
    const source = "const marker = 1;\nclass A extends\n  Object\n{}\n";
    const coverage = await instrument(source);
    expect(() =>
      attributeChanges(source, "own.js", new Set([3]), denominator({ own: coverage }).own),
    ).toThrow("runtime expression has no coverage region");
  });
  it("preserves covered and uncovered observable class heritage", async () => {
    const source = "const A = class extends\n  Object\n{};\n";
    const coverage = await instrument(source);
    expect([...attributeChanges(source, "own.js", new Set([2]), coverage).values()]).toEqual([1]);
    expect([
      ...attributeChanges(
        source,
        "own.js",
        new Set([2]),
        denominator({ own: coverage }).own,
      ).values(),
    ]).toEqual([0]);
  });
  it("excludes erased heritage type arguments and implements clauses", () => {
    const source = "class A extends Base<\n  number\n> implements\n  Interface\n{}\n";
    expect(attributeChanges(source, "own.ts", new Set([2, 4]), report("own.ts", [], [])).size).toBe(
      0,
    );
  });
  it("rejects changed decorator expressions when no execution region is observable", () => {
    const source = "@decorate\nclass A {}\n";
    expect(() =>
      attributeChanges(source, "own.ts", new Set([1]), report("own.ts", [], [])),
    ).toThrow("runtime expression has no coverage region");
  });

  it.each([
    ["null", 0],
    ["{ call: (value: number) => value }", 1],
  ] as const)(
    "retains argument execution through Vite and Babel maps for %s",
    async (receiver, expected) => {
      const source = `const receiver: { call(value: number): number } | null = ${receiver};\nreceiver?.call(\n  123\n);\n`;
      const filename = "/fixture/mapped.ts";
      const transformed = await transformWithOxc(source, filename, { sourcemap: true });
      expect(transformed.map).toBeTruthy();
      const coverage = await instrument(transformed.code, filename, transformed.map!);
      validateFileCoverage(coverage, source, filename);
      expect([...attributeChanges(source, filename, new Set([3]), coverage).values()]).toEqual([
        expected,
      ]);
    },
  );

  it("rejects changed computed class keys when the provider has no execution region", async () => {
    const source = "class A { [\n  Symbol.iterator\n]() {} }\n";
    const coverage = await instrument(source);
    expect(Object.keys(coverage.statementMap)).toHaveLength(0);
    const canonical = denominator({ own: coverage }).own;
    validateFileCoverage(canonical, source, "own.js");
    expect(() => attributeChanges(source, "own.js", new Set([2]), canonical)).toThrow(
      "runtime expression has no coverage region",
    );
  });
  it("retains observable computed keys as covered or uncovered executable changes", async () => {
    const source = "const A = class { [\n  Symbol.iterator\n]() {} };\n";
    const coverage = await instrument(source);
    expect([...attributeChanges(source, "own.js", new Set([2]), coverage).values()]).toEqual([1]);
    expect([
      ...attributeChanges(
        source,
        "own.js",
        new Set([2]),
        denominator({ own: coverage }).own,
      ).values(),
    ]).toEqual([0]);
  });
  it.each([
    "interface A { [\n  Symbol.iterator\n](): number; }\n",
    "abstract class A { abstract [\n  Symbol.iterator\n](): number; }\n",
    "abstract class A { abstract [\n  Symbol.iterator\n]: number; }\n",
    "class A { [\n  Symbol.iterator\n](): number; [Symbol.iterator]() { return 1; } }\n",
  ])("keeps erased computed signatures outside the executable denominator %s", (source) => {
    expect(attributeChanges(source, "own.ts", new Set([2]), report("own.ts", [], [])).size).toBe(0);
  });

  it.each([
    ["const receiver={call:(value)=>value}; receiver?.call(\n 123\n);\n", 2],
    ["let value=0; value ||= (()=>({\n key:123\n}))();\n", 2],
  ])("keeps executed conditional arguments applicable and covered %s", async (source, line) => {
    expect([
      ...attributeChanges(
        source as string,
        "own.js",
        new Set([line as number]),
        await instrument(source as string),
      ).values(),
    ]).toEqual([1]);
  });
  it.each([
    ["const fn = () => ({\n key: 123\n});\n", 2],
    ["let n=0; while (n>0) { n=123; }\n", 1],
    ["try { 1; } catch (error) { const fn=()=>({\n key:123\n}); }\n", 2],
    ["const receiver = null; receiver?.call(\n  123\n);\n", 2],
    ["let value=1; value ||= (() => ({\n key:123\n}))();\n", 2],
  ])("does not borrow executed declaration hits for unexecuted code %s", async (source, line) => {
    expect([
      ...attributeChanges(
        source as string,
        "own.js",
        new Set([line as number]),
        await instrument(source as string),
      ).values(),
    ]).toEqual([0]);
  });
  it("parses regular-expression and template tokens without losing subsequent executable lines", async () => {
    const source = "const expression=/[/*]/;\nconst value=123;\nconst template=`/* ${value} */`;\n";
    const coverage = await instrument(source);
    expect(attributeChanges(source, "own.js", new Set([2]), coverage).has(2)).toBe(true);
    coverage.s = Object.fromEntries(Object.keys(coverage.s).map((key) => [key, 0]));
    expect([...attributeChanges(source, "own.js", new Set([2, 3]), coverage).values()]).toEqual([
      0, 0,
    ]);
  });
  it("does not borrow an enclosing initializer hit for an unexecuted ternary or short-circuit alternative", () => {
    const source = 'const result = true\n ? "covered"\n : "changed";\n';
    const coverage = {
      branchMap: {
        0: {
          type: "cond-expr",
          locations: [
            { start: { line: 2, column: 3 }, end: { line: 2, column: 12 } },
            { start: { line: 3, column: 3 }, end: { line: 3, column: 12 } },
          ],
        },
      },
      b: { 0: [1, 0] },
    };
    expect([
      ...changedExecutableLines(
        source,
        "own.ts",
        new Map([[1, 1]]),
        new Set([3]),
        coverage,
      ).values(),
    ]).toEqual([0]);
    coverage.branchMap[0].type = "binary-expr";
    expect([
      ...changedExecutableLines(
        source,
        "own.ts",
        new Map([[1, 1]]),
        new Set([3]),
        coverage,
      ).values(),
    ]).toEqual([0]);
  });
  it("uses if body alternatives without marking the executed condition as unexecuted", () => {
    const source = "if (ready) {\n  work();\n} else {\n  fallback();\n}\n";
    const loc = (start: number, end: number) => ({
      start: { line: start, column: 0 },
      end: { line: end, column: 1 },
    });
    const coverage = {
      branchMap: { 0: { type: "if", loc: loc(1, 5), locations: [loc(1, 5), loc(3, 5)] } },
      b: { 0: [0, 1] },
    };
    expect([
      ...changedExecutableLines(
        source,
        "own.ts",
        new Map([
          [1, 1],
          [2, 0],
          [4, 1],
        ]),
        new Set([1, 2, 4]),
        coverage,
      ).values(),
    ]).toEqual([1, 0, 1]);
  });
  it("normalizes Windows coverage and canonical-map keys through the same projection", () => {
    const file = "C:/checkout/packages/example/src/own.ts";
    const actual = coverageByPath("C:\\checkout", { [file]: report(file) }, path.win32);
    const canonical = coverageByPath(
      "C:\\checkout",
      denominator({ [file]: report(file) }),
      path.win32,
    );
    expect([...actual.keys()]).toEqual([...canonical.keys()]);
    expect(canonical.get("C:\\checkout\\packages\\example\\src\\own.ts")).toBeDefined();
  });
  it("keeps a multiline loop condition applicable when the statement starts on another line", () => {
    const source = "while (\n  changedCondition\n) {\n  work();\n}\n";
    expect([
      ...changedExecutableLines(
        source,
        "own.ts",
        new Map([
          [1, 0],
          [4, 0],
        ]),
        new Set([2]),
      ).values(),
    ]).toEqual([0]);
  });
  it("does not let a healthy package compensate for another package's failed floor", () => {
    const { root, file } = product();
    const other = path.join(root, "packages", "healthy", "src", "own.ts");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/healthy/package.json"), '{"name":"@ohtia/healthy"}');
    fs.copyFileSync(file, other);
    const result = coverageGate(
      root,
      { [file]: report(file, [1, 1, 1, 0, 0]), [other]: report(other) },
      "base",
      () => new Set(),
    );
    expect(result.packages.healthy.lines.status).toBe("passed");
    expect(result.packages.example.lines.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
  it("requires 90% of changed executable lines independently of the 80% package floor", () => {
    const { root, file } = product();
    fs.writeFileSync(
      file,
      Array.from({ length: 10 }, (_, i) => `export const value${i} = ${i};`).join("\n"),
    );
    const changed = () => new Set(Array.from({ length: 10 }, (_, i) => i + 1));
    for (const hits of [9, 8]) {
      const result = coverageGate(
        root,
        {
          [file]: report(
            file,
            Array.from({ length: 10 }, (_, i) => (i < hits ? 1 : 0)),
          ),
        },
        "base",
        changed,
      );
      expect(result.packages.example.lines.status).toBe("passed");
      expect(result.packages.example.diff.status).toBe(hits === 9 ? "passed" : "failed");
    }
  });
  it("rejects a nonempty partial-file denominator and a missing independent map", () => {
    const { root, file } = product();
    const complete = { [file]: report(file) };
    const canonical = denominator(complete);
    delete complete[file].statementMap["4"];
    delete complete[file].s["4"];
    expect(() => evaluateCoverage(root, complete, "base", () => new Set(), canonical)).toThrow(
      /partial\/stale/,
    );
    expect(() => evaluateCoverage(root, complete, "base", () => new Set())).toThrow(/independent/);
  });
  it("counts changed multiline literals and leaves comment/type-only edits inapplicable", () => {
    const source =
      'export const values = [\n  "changed",\n  "kept",\n];\n// comment\ntype Name = string;\n';
    expect([
      ...changedExecutableLines(source, "own.ts", new Map([[1, 0]]), new Set([2])).values(),
    ]).toEqual([0]);
    expect(changedExecutableLines(source, "own.ts", new Map([[1, 1]]), new Set([5, 6])).size).toBe(
      0,
    );
  });
  it("passes exactly 80% line/branch floors and keeps a no-executable diff inapplicable", () => {
    const { root, file } = product();
    const result = coverageGate(
      root,
      { [file]: report(file, [1, 1, 1, 1, 0], [1, 1, 1, 1, 0]) },
      "base",
      () => new Set(),
    );
    expect(result.status).toBe("passed");
    expect(result.packages.example.diff).toEqual({
      covered: 0,
      total: 0,
      percent: null,
      status: "inapplicable",
    });
  });
  it.each(["lines", "branches", "diff"])(
    "fails %s without borrowing another dimension",
    (dimension) => {
      const { root, file } = product();
      const r = report(
        file,
        dimension === "branches" ? undefined : [1, 1, 1, 0, 0],
        dimension === "branches" ? [1, 1, 1, 0, 0] : undefined,
      );
      if (dimension === "diff") r.s = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 0 };
      const result = coverageGate(root, { [file]: r }, "base", () =>
        dimension === "diff" ? new Set([5]) : new Set(),
      );
      expect(result.status).toBe("failed");
      expect(result.packages.example[dimension].status).toBe("failed");
    },
  );
  it("does not average packages and rejects own unimported-code omission", () => {
    const { root, file } = product();
    const unimported = path.join(path.dirname(file), "never-imported.ts");
    fs.writeFileSync(unimported, "export function unused() { return 1; }\n");
    expect(() => coverageGate(root, { [file]: report(file) }, "base", () => new Set())).toThrow(
      /inventory/,
    );
    const result = coverageGate(
      root,
      { [file]: report(file), [unimported]: report(unimported, [0], [0, 0]) },
      "base",
      () => new Set(),
    );
    expect(result.packages.example.lines.total).toBe(6);
  });
  it.each([
    "missing-counter",
    "negative",
    "fractional",
    "bad-location",
    "branch-arity",
    "empty-map",
  ])("rejects malformed %s reports", (kind) => {
    const r = report("own.ts");
    if (kind === "missing-counter") delete r.s["0"];
    if (kind === "negative") r.s["0"] = -1;
    if (kind === "fractional") r.s["0"] = 0.5;
    if (kind === "bad-location") r.statementMap["0"].start.line = 900;
    if (kind === "branch-arity") r.b[0].pop();
    if (kind === "empty-map") {
      r.statementMap = {};
      r.s = {};
    }
    expect(() => validateFileCoverage(r, "const a=1;\n".repeat(5), "own.ts")).toThrow();
  });
  it("missing and syntactically invalid reports fail instead of returning empty results", () => {
    const root = fixture();
    expect(() => readJson(path.join(root, "missing.json"))).toThrow(/missing\/invalid/);
    const duplicate = path.join(root, "duplicate.json");
    fs.writeFileSync(duplicate, '{"ok":true,"o\\u006b":false}');
    expect(() => readJson(duplicate)).toThrow(/duplicate JSON key/);
    const file = path.join(root, "bad.json");
    fs.writeFileSync(file, "{no");
    expect(() => readJson(file)).toThrow(/missing\/invalid/);
  });
  it("uses the immutable base, staged/unstaged edits and new files, rather than HEAD-only changes", () => {
    const root = fixture();
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("config", "color.ui", "always");
    git("config", "color.diff", "always");
    git("config", "user.email", "synthetic@example.invalid");
    git("config", "user.name", "Synthetic Fixture");
    const file = path.join(root, "own.ts");
    fs.writeFileSync(file, "const a = 1;\n");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic base");
    const base = git("rev-parse", "HEAD");
    fs.writeFileSync(file, "const a = 2;\n");
    git("add", ".");
    fs.appendFileSync(file, "const b = 3;\n");
    expect([...changedLines(root, base, file)]).toEqual([1, 2]);
    fs.writeFileSync(path.join(root, ".git/info/attributes"), "*.ts -diff\n");
    expect([...changedLines(root, base, file)]).toEqual([1, 2]);
    const added = path.join(root, "new.ts");
    fs.writeFileSync(added, "export const fresh = 1;\n");
    expect(changedLines(root, base, added).has(1)).toBe(true);
    expect(() => changedLines(root, "main", file)).toThrow(/immutable/);
  });
});

describe("complete mandatory result accounting", () => {
  it("rejects a deleted or conditionally unregistered mandatory case against the committed registry", () => {
    const registry = {
      version: 1,
      vitest: ["first", "required"],
      playwright: ["browser"],
      python: ["policy"],
    };
    expect(() => assertDeclaredCases(registry, "vitest", ["first"])).toThrow(
      /committed\/discovered/,
    );
    expect(() => assertDeclaredCases(registry, "playwright", [])).toThrow();
    expect(() => assertDeclaredCases(registry, "python", ["policy", "unexpected"])).toThrow();
    expect(() => assertDeclaredCases(registry, "vitest", ["first", "required"])).not.toThrow();
  });
  const identity = { tree: "synthetic" };
  function corpus() {
    const inventory = shardCases(["a", "b", "c"], 2).map((cases, i) => ({
      shard: String(i),
      cases,
    }));
    const reports = inventory.map((p) => ({
      version: 1,
      shard: p.shard,
      preparation: "passed",
      status: "passed",
      identity,
      cases: p.cases.map((id) => ({ id, status: "passed", attempts: 1, expectedFailure: false })),
    }));
    return { inventory, reports };
  }
  it("admits the exact union independent of arrival order", () => {
    const { inventory, reports } = corpus();
    expect(accountShards(inventory, reports.reverse(), identity).cases).toBe(3);
  });
  it.each([
    "missing-shard",
    "duplicate-shard",
    "missing-case",
    "extra-case",
    "failed",
    "skipped",
    "cancelled",
    "pending",
    "preparation",
    "stale",
    "expected-failure",
    "retry",
  ])("rejects %s even with successful process exits", (kind) => {
    const { inventory, reports } = corpus();
    if (kind === "missing-shard") reports.pop();
    else if (kind === "duplicate-shard") reports.push(reports[0]);
    else if (kind === "missing-case") reports[0].cases.pop();
    else if (kind === "extra-case")
      reports[0].cases.push({
        id: "unexpected",
        status: "passed",
        attempts: 1,
        expectedFailure: false,
      });
    else if (kind === "preparation") reports[0].preparation = "failed";
    else if (kind === "stale") reports[0].identity = { tree: "other" };
    else if (kind === "expected-failure") reports[0].cases[0].expectedFailure = true;
    else if (kind === "retry") reports[0].cases[0].attempts = 2;
    else reports[0].cases[0].status = kind;
    expect(() => accountShards(inventory, reports, identity)).toThrow();
  });
});

describe("catalog contracts without silent fallback", () => {
  const locales = ["en-US", "ko-KR"];
  const contracts = {
    greeting: { params: { name: "string" } },
    count: { params: { count: "number" }, forms: { count: { kind: "plural" } } },
    choice: {
      params: { mode: "string" },
      forms: { mode: { kind: "select", options: ["ready", "other"] } },
    },
  };
  function corpus() {
    return Object.fromEntries(
      locales.map((locale) => [
        locale,
        {
          version: 1,
          locale,
          messages: {
            greeting: "Hello {name}",
            count: "{count, plural, other {# sheep}}",
            choice: "{mode, select, ready {Ready} other {Wait}}",
          },
        },
      ]),
    );
  }
  it("accepts locale-specific plural forms including Korean without an English one form", () => {
    expect(catalogGate(locales, contracts, corpus()).locales).toBe(2);
  });
  it.each([
    "locale",
    "key",
    "parameter",
    "type",
    "plural",
    "syntax",
    "select",
    "extra",
    "markup",
    "version",
  ])("rejects %s contract failures", (kind) => {
    const catalogs = corpus();
    if (kind === "locale") delete catalogs["ko-KR"];
    else if (kind === "key") delete catalogs["ko-KR"].messages.greeting;
    else if (kind === "version") catalogs["ko-KR"].version = 2;
    else if (kind === "parameter") catalogs["ko-KR"].messages.greeting = "Hello";
    else if (kind === "type") catalogs["ko-KR"].messages.greeting = "Hello {name, number}";
    else if (kind === "plural")
      catalogs["ko-KR"].messages.count = "{count, plural, one {One} other {#}}";
    else if (kind === "syntax") catalogs["ko-KR"].messages.count = "{count, plural,";
    else if (kind === "select") catalogs["ko-KR"].messages.choice = "{mode, select, other {Wait}}";
    else if (kind === "markup") catalogs["ko-KR"].messages.greeting = "<b>{name}</b>";
    else catalogs["ko-KR"].messages.greeting = "{name} {unexpected}";
    expect(() => catalogGate(locales, contracts, catalogs)).toThrow();
  });
});

describe("native OS/CPU/profile partitions", () => {
  it("projects every declared Windows/macOS filesystem and package format and rejects an unmodelled baseline", () => {
    const expanded = JSON.parse(fs.readFileSync("config/desktop/targets.json", "utf8"));
    const windows = expanded.targets.find((target) => target.id === "win32-x64");
    windows.filesystems.push("synthetic-filesystem");
    windows.quality_packages.push("synthetic-format");
    const mac = expanded.targets.find((target) => target.id === "darwin-arm64");
    mac.filesystems.push("synthetic-filesystem");
    mac.quality_packages.push("synthetic-format");
    const cells = nativeInventory(expanded);
    for (const target of ["win32-x64", "darwin-arm64"])
      expect(
        cells.some(
          (cell) =>
            cell.target === target &&
            cell.profile.endsWith("/synthetic-filesystem") &&
            cell.package === "synthetic-format",
        ),
      ).toBe(true);
    windows.baseline = "unmodelled Windows release";
    expect(() => nativeInventory(expanded)).toThrow(/baseline/);
  });
  const targets = JSON.parse(fs.readFileSync("config/desktop/targets.json", "utf8"));
  const identity = {
    run: "synthetic-native-accounting-only",
    base: "a".repeat(40),
    head: "b".repeat(40),
    sourceSha256: "c".repeat(64),
    workflowSha256: "d".repeat(64),
  };
  function corpus() {
    const cells = nativeInventory(targets, ["win32-arm64", "darwin-x64"]);
    const reports = cells.map((cell) => ({
      ...cell,
      version: 1,
      status: "passed",
      preparation: "passed",
      identity,
      execution: "native",
      hostArch: cell.arch,
      processArch: cell.arch,
      emulated: false,
      artifactSha256: "a".repeat(64),
      cases: cell.cases.map((id) => ({ id, status: "passed", attempts: 1 })),
      operator: "synthetic-operator",
      tool: "synthetic-tool",
    }));
    return { cells, reports };
  }
  it("retains all six declared targets, required Linux display/filesystem profiles and macOS majors", () => {
    const { cells, reports } = corpus();
    expect(new Set(cells.map((c) => c.target)).size).toBe(6);
    expect(cells.some((c) => c.profile === "ubuntu-24.04/x11/ext4")).toBe(true);
    expect(cells.some((c) => c.profile === "macos-27/APFS")).toBe(true);
    expect(accountNative(cells, reports, identity).status).toBe("passed");
  });
  it.each([
    "five-targets",
    "missing-format",
    "missing-arm64",
    "emulated",
    "universal-one-slice",
    "browser",
    "linux-image",
    "profile",
    "case",
    "manual",
    "artifact",
    "preparation",
  ])("rejects %s as complete native evidence", (kind) => {
    const { cells, reports } = corpus();
    let selected = reports;
    if (kind === "missing-format") selected = reports.filter((r) => r.package !== "zip");
    else if (kind === "five-targets") selected = reports.filter((r) => r.target !== "darwin-x64");
    else if (kind === "missing-arm64") selected = reports.filter((r) => r.target !== "linux-arm64");
    else if (kind === "emulated") reports[0].emulated = true;
    else if (kind === "universal-one-slice") {
      const slice = reports.find((r) => r.target === "darwin-x64")!;
      slice.hostArch = "arm64";
      slice.processArch = "arm64";
    } else if (kind === "browser" || kind === "linux-image") reports[0].kind = kind;
    else if (kind === "profile") reports[0].profile = "other";
    else if (kind === "case") reports[0].cases.pop();
    else if (kind === "manual") reports.find((r) => r.kind === "native-assistive").operator = "";
    else if (kind === "artifact") reports[0].artifactSha256 = "";
    else reports[0].preparation = "failed";
    expect(() => accountNative(cells, selected, identity)).toThrow();
  });
  it("rejects missing or reclassified declared target metadata", () => {
    const data = structuredClone(targets);
    data.targets.pop();
    expect(() => nativeInventory(data)).toThrow();
    const changed = structuredClone(targets);
    changed.targets.find((t) => t.id === "linux-arm64").native_required = false;
    expect(() => nativeInventory(changed)).toThrow(/misclassified/);
  });
});

it("rejects missing Playwright reports and expected-failure/skipped mandatory cases", () => {
  expect(() => playwrightCases({})).toThrow();
  const report = {
    errors: [],
    suites: [
      {
        specs: [
          {
            file: "x.spec.ts",
            id: "id",
            tests: [
              {
                projectName: "tooling",
                expectedStatus: "failed",
                status: "expected",
                results: [{ status: "failed", retry: 0 }],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(() => playwrightCases(report)).toThrow(/mandatory/);
  report.suites[0].specs[0].tests[0].expectedStatus = "passed";
  report.suites[0].specs[0].tests[0].results[0].status = "skipped";
  expect(() => playwrightCases(report)).toThrow(/mandatory/);
});

it("normalizes fixture metadata paths and chooses a genuinely different negative target on every declared CPU", () => {
  expect(fixturePath(path.win32.join("C:\\fixture", "renderer", "index.html"))).toContain(
    "/renderer/",
  );
  expect(fixturePath(path.win32.join("C:\\fixture", "storage.json"))).toMatch(/\/storage.json$/);
  for (const platform of ["linux", "win32", "darwin"])
    for (const arch of ["x64", "arm64"])
      expect(differentTarget(platform, arch)).not.toBe(`${platform}-${arch}`);
});
it("rejects stale native provenance even when reports agree with their caller-supplied identity", () => {
  const root = fixture();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Synthetic Fixture");
  git("config", "user.email", "synthetic@example.invalid");
  fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github/workflows/ci.yml"), "name: Synthetic\n");
  fs.writeFileSync(path.join(root, "own.ts"), "const a=1;\n");
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic base");
  const base = git("rev-parse", "HEAD");
  const identity = { run: "synthetic", ...checkoutIdentity(root, base) };
  expect(() => assertCheckoutIdentity(root, identity)).not.toThrow();
  expect(() => assertCheckoutIdentity(root, { ...identity, head: "0".repeat(40) })).toThrow(/head/);
  expect(() =>
    assertCheckoutIdentity(root, { ...identity, workflowSha256: "0".repeat(64) }),
  ).toThrow(/workflowSha256/);
  fs.writeFileSync(path.join(root, "own.ts"), "const a=2;\n");
  expect(() => assertCheckoutIdentity(root, identity)).toThrow(/sourceSha256/);
});
