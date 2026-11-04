import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import ts from "typescript";
import { productGraph } from "../tooling/product-graph.mjs";
import { catalogCsp } from "../tooling/vite.catalog.mjs";
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe("catalog build admission", () => {
  it("declares every unconditional successful runtime report in the packaged-case catalog", () => {
    const source = ts.createSourceFile(
      "desktop-acceptance.mjs",
      fs.readFileSync("tooling/desktop-acceptance.mjs", "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const main = source.statements.find(ts.isTryStatement);
    expect(main).toBeDefined();
    const emitted: string[] = [];
    const visit = (block: ts.Block) => {
      for (const statement of block.statements) {
        if (ts.isTryStatement(statement)) {
          visit(statement.tryBlock);
          if (statement.finallyBlock) visit(statement.finallyBlock);
        } else if (
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression)
        ) {
          const call = statement.expression;
          if (
            ts.isIdentifier(call.expression) &&
            call.expression.text === "passed" &&
            call.arguments[0] &&
            ts.isStringLiteral(call.arguments[0])
          )
            emitted.push(call.arguments[0].text);
        }
      }
    };
    visit(main!.tryBlock);
    if (main!.finallyBlock) visit(main!.finallyBlock);
    expect(emitted.length).toBeGreaterThan(0);
    const inventory = JSON.parse(fs.readFileSync("config/quality/packaged-cases.json", "utf8")) as {
      runtime: string[];
    };
    for (const id of emitted) expect(inventory.runtime, id).toContain(id);
  });

  it("loads qualification modules before generated product files exist", () => {
    const repository = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-catalog-cold-import-"));
    temporary.push(root);
    fs.mkdirSync(path.join(root, "tooling"));
    fs.symlinkSync(
      path.join(repository, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    for (const name of [
      "catalog-acceptance.mjs",
      "catalog-workspace.mjs",
      "catalog-character.mjs",
      "catalog-research.mjs",
      "command-presentation.mjs",
    ])
      fs.copyFileSync(path.join(repository, "tooling", name), path.join(root, "tooling", name));
    const moduleUrl = pathToFileURL(path.join(root, "tooling/catalog-acceptance.mjs")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const helpers = await import(${JSON.stringify(moduleUrl)}); if (typeof helpers.serveCatalog !== "function" || typeof helpers.verifyCatalog !== "function") throw new Error("Qualification exports unavailable.");`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "tools/renderer-preview/neutral.ts",
    "tools/renderer-preview/character-specimen.tsx",
    "tools/renderer-preview/research-specimen.tsx",
    "tests/transport.ts",
    "packages/renderer/src/catalog.ts",
    "packages/utility/src/fixture.ts",
    "packages/main/src/probe.spec.ts",
    "packages/utility/src/fixtures/neutral.ts",
    "packages/renderer/src/catalog/neutral.ts",
  ])("rejects development modules before tree shaking: %s", async (file) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-product-graph-"));
    temporary.push(root);
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'export const synthetic = "CATALOG_ONLY_SENTINEL";');
    fs.writeFileSync(
      path.join(root, "entry.ts"),
      `import "./${file}"; export const product = true;`,
    );
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [productGraph(root)],
        build: { write: false, lib: { entry: "entry.ts", formats: ["es"] } },
      }),
    ).rejects.toThrow(/Development module in product graph/);
  });
  it("exports research presentation from the renderer library without catalog specimens or synthetic research", async () => {
    const result = await build({
      configFile: "tooling/vite.renderer.mjs",
      logLevel: "silent",
      build: { write: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) =>
      "output" in item ? item.output : [],
    );
    const code = outputs
      .map((item) => (item.type === "chunk" ? item.code : String(item.source)))
      .join("\n");
    for (const name of [
      "EvidenceHighlight",
      "TutorComment",
      "ProposalCard",
      "ContrastResult",
      "CritiqueLevel",
      "ObservationCard",
      "ReviewRequired",
      "CoverageStatement",
      "SourceRow",
      "ProcessingStatus",
      "RestrictionBadge",
      "WeeklyActions",
      "StageStatus",
      "PaceIndicator",
      "SaveStatus",
      "VersionConflict",
    ])
      expect(code).toMatch(new RegExp(`\\b${name}\\b`));
    for (const sentinel of [
      "ResearchSpecimen",
      "Research component catalog",
      "SYSTEM NOTICE",
      "Synthetic source",
      "Last synthetic callback",
    ])
      expect(code).not.toContain(sentinel);
  });
  it("admits product sources and retains the same restrictive CSP as the desktop", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-product-graph-"));
    temporary.push(root);
    fs.writeFileSync(path.join(root, "entry.ts"), "export const product = true;");
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [productGraph(root)],
        build: { write: false, lib: { entry: "entry.ts", formats: ["es"] } },
      }),
    ).resolves.toBeDefined();
    expect(fs.readFileSync("packages/main/src/entry.ts", "utf8")).toContain(catalogCsp);
    const html = fs.readFileSync("tools/renderer-preview/index.html", "utf8");
    expect(html).toContain(catalogCsp.replace("; frame-ancestors 'none'", ""));
    expect(
      fs
        .readFileSync("tooling/desktop-build.mjs", "utf8")
        .match(/plugins: \[productGraph\(root\)\]/g),
    ).toHaveLength(2);
    expect(fs.readFileSync("tooling/vite.renderer.mjs", "utf8")).toContain(
      "productGraph(process.cwd())",
    );
  });
});
