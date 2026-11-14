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
it("rejects the development command's module and bytes in final package inspections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-command-artifact-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "main.mjs"), "export const connections = [];\n");
  for (const name of [
    "development-command.ts",
    "development-command.js",
    "development-command.d.ts",
  ]) {
    const file = path.join(root, name);
    fs.writeFileSync(file, "");
    expect(() => inspectProviderArtifact(root)).toThrow("Development command module");
    fs.unlinkSync(file);
  }
  for (const text of [
    "import('./development-command.js')",
    "write(`[ohtia dev] ${text}`)",
    "Describe the usual parts of a thesis in about 300 words.",
  ]) {
    fs.writeFileSync(path.join(root, "main.mjs"), text);
    expect(() => inspectProviderArtifact(root)).toThrow("Development command bytes");
  }
  // The runtime admission of the switches is part of every package and refuses them there.
  fs.writeFileSync(path.join(root, "main.mjs"), "const prefix = '--ohtia-dev-';");
  expect(() => inspectProviderArtifact(root)).not.toThrow();
});
it("rejects the development command before production tree shaking and admits it only to a development graph", () => {
  const root = path.resolve(".");
  const file = path.join(root, "packages/main/src/development-command.ts");
  expect(() => productGraph(root).transform("", file)).toThrow("Development module");
  expect(() => productGraph(root, { development: true }).transform("", file)).not.toThrow();
});
