import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectProviderArtifact, productGraph } from "../tooling/product-graph.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("rejects fake provider source, compiled modules and inlined bytes in final package inspections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-provider-artifact-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "main.mjs"), "export const connections = [];\n");
  expect(() => inspectProviderArtifact(root)).not.toThrow();
  for (const name of ["fake-provider.ts", "fake-provider.js", "fake-provider.d.ts"]) {
    const file = path.join(root, name);
    fs.writeFileSync(file, "");
    expect(() => inspectProviderArtifact(root)).toThrow();
    fs.unlinkSync(file);
  }
  for (const text of ["fake-provider", "synthetic-session", "__ohtiaCredentialAcceptance"]) {
    fs.writeFileSync(path.join(root, "main.mjs"), text);
    expect(() => inspectProviderArtifact(root)).toThrow();
  }
});
it("rejects a fake module before production tree shaking and admits it only to a development graph", () => {
  const root = path.resolve(".");
  const file = path.join(root, "packages/main/src/fake-provider.ts");
  expect(() => productGraph(root).transform("", file)).toThrow("Development module");
  expect(() => productGraph(root, { development: true }).transform("", file)).not.toThrow();
});
