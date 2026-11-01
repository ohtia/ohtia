import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { productGraph } from "../tooling/product-graph.mjs";
import { catalogCsp } from "../tooling/vite.catalog.mjs";
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe("catalog build admission", () => {
  it.each([
    "tools/renderer-preview/neutral.ts",
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
