import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appearanceOrDefault, resolveColorScheme } from "../packages/domain/dist/index.js";
import { assertPreloadIsolation } from "../packages/preload/dist/index.js";
import { rendererWebPreferences } from "../packages/main/dist/index.js";
import { inspectSqliteEngine } from "../packages/utility/dist/index.js";
import { inspectWorkspace } from "../tooling/boundaries.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia boundaries ñ "));
  temporary.push(root);
  fs.cpSync("config", path.join(root, "config"), { recursive: true });
  for (const name of ["contracts", "domain", "renderer", "main", "preload", "utility"]) {
    fs.mkdirSync(path.join(root, "packages", name), { recursive: true });
    fs.copyFileSync(
      `packages/${name}/package.json`,
      path.join(root, "packages", name, "package.json"),
    );
    fs.cpSync(`packages/${name}/src`, path.join(root, "packages", name, "src"), {
      recursive: true,
    });
  }
  return root;
}
function source(root: string, boundary: string, text: string) {
  fs.writeFileSync(path.join(root, "packages", boundary, "src", "violation.ts"), text);
}

describe("workspace authority", () => {
  it("accepts the actual acyclic public package graph", () => {
    expect(inspectWorkspace(process.cwd()).errors).toEqual([]);
  });
  it.each([
    ["renderer", 'import fs from "node:fs";'],
    ["domain", 'export * from "react";'],
    ["renderer", 'type Main = import("@ohtia/main").Main;'],
    ["renderer", 'import { x } from "@ohtia/domain/src/internal.js";'],
    ["renderer", 'import "../../main/src/index.js";'],
    ["renderer", "const x = import(channel);"],
    ["preload", 'const fs = require("node:fs");'],
    ["renderer", '/// <reference types="node" />\nexport {};'],
    ["domain", '/// <reference lib="dom" />\nexport {};'],
  ])("rejects forbidden %s source %s", (boundary, text) => {
    const root = fixture();
    source(root, boundary, text);
    expect(inspectWorkspace(root).errors.length).toBeGreaterThan(0);
  });
  it.each(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])(
    "rejects cycles through %s",
    (category) => {
      const root = fixture();
      const file = path.join(root, "packages/contracts/package.json");
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      manifest[category] ??= {};
      manifest[category]["@ohtia/domain"] = "workspace:*";
      fs.writeFileSync(file, JSON.stringify(manifest));
      expect(inspectWorkspace(root).errors.join("\n")).toMatch(/Dependency cycle/);
    },
  );
  it("ignores Finder files and orphan outputs but rejects undeclared real packages", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "packages/.DS_Store"), "");
    fs.mkdirSync(path.join(root, "packages/orphan/dist"), { recursive: true });
    expect(inspectWorkspace(root).errors).toEqual([]);
    fs.writeFileSync(path.join(root, "packages/orphan/package.json"), '{"name":"@ohtia/orphan"}');
    expect(() => inspectWorkspace(root)).toThrow(/explicit boundary policy/);
  });
  it("rejects a linked package before generated outputs can be removed", () => {
    const root = fixture();
    const directory = path.join(root, "packages/domain");
    const target = path.join(root, "linked-domain");
    fs.renameSync(directory, target);
    fs.symlinkSync(target, directory, process.platform === "win32" ? "junction" : "dir");
    expect(inspectWorkspace(root).errors).toContain(
      "domain: symlinked package directories are forbidden",
    );
  });
  it("rejects an additional linked package instead of hiding it from validation", () => {
    const root = fixture();
    fs.symlinkSync(
      path.join(root, "packages/domain"),
      path.join(root, "packages/legacy"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => inspectWorkspace(root)).toThrow(/explicit boundary policy/);
  });
  it("checks conflicting internal declarations without letting another category hide them", () => {
    const root = fixture();
    const file = path.join(root, "packages/domain/package.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.peerDependencies = { "@ohtia/contracts": "^0.0.0" };
    manifest.devDependencies["@ohtia/contracts"] = "workspace:*";
    fs.writeFileSync(file, JSON.stringify(manifest));
    expect(inspectWorkspace(root).errors).toContain(
      "domain: internal dependency must use workspace:*",
    );
  });
  it("rejects forbidden development-only internal dependencies", () => {
    const root = fixture();
    const file = path.join(root, "packages/domain/package.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.devDependencies["@ohtia/main"] = "workspace:*";
    fs.writeFileSync(file, JSON.stringify(manifest));
    expect(inspectWorkspace(root).errors).toContain("domain: forbidden dependency @ohtia/main");
  });
});

describe("appearance and boundary building blocks", () => {
  it.each([undefined, null, 0, {}, "LIGHT", "other"])(
    "uses system without mutating invalid data %s",
    (value) => {
      expect(appearanceOrDefault(value)).toBe("system");
    },
  );
  it("resolves explicit and system choices", () => {
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("dark", false)).toBe("dark");
    expect(resolveColorScheme("system", true)).toBe("dark");
    expect(resolveColorScheme("system", false)).toBe("light");
  });
  it.each([
    [false, false],
    [false, true],
    [true, false],
  ])("refuses unsafe preload execution", (contextIsolated, sandboxed) => {
    expect(() => assertPreloadIsolation({ contextIsolated, sandboxed })).toThrow(/isolation/);
  });
  it("keeps privileged renderer capabilities disabled", () => {
    const preferences = rendererWebPreferences(path.resolve("preload.cjs"));
    expect(preferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(() => rendererWebPreferences("relative.cjs")).toThrow(/absolute/);
  });
  it("loads the selected SQLite engine in a disposable developer process", async () => {
    expect(await inspectSqliteEngine()).toBe("3.53.4");
  });
});
