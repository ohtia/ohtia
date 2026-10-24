import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectWorkspace } from "./boundaries.mjs";
import { assertPackagePins } from "./pins.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const tools = JSON.parse(fs.readFileSync(path.join(root, "config/desktop/toolchain.json"))).tools;
if (process.versions.node !== tools.node.version) {
  console.error(
    "Incorrect Node version. Use python3 scripts/workspace.py setup, then its run entry.",
  );
  process.exit(1);
}
try {
  assertPackagePins(root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) {
    console.error(
      "Workspace command failed; inspect the preceding diagnostic. Frozen dependencies are never rewritten by checks.",
    );
    process.exit(result.status || 1);
  }
}
function node(relative, args = []) {
  run(process.execPath, [path.join(root, "node_modules", relative), ...args]);
}
function boundaries() {
  const result = inspectWorkspace(root);
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  return result.ordered;
}
function compile(noEmit = false) {
  const packages = boundaries();
  for (const item of packages)
    fs.rmSync(path.join(item.directory, "dist"), { recursive: true, force: true });
  for (const item of packages) {
    node("typescript/bin/tsc", [
      "-p",
      path.join(item.directory, "tsconfig.json"),
      ...(noEmit ? ["--emitDeclarationOnly"] : []),
    ]);
  }
}
const commands = {
  doctor() {
    console.log("Installed package pins match their manifests and the adopting toolchain.");
  },
  hooks() {
    run(python, ["-m", "pre_commit", "run", "--all-files"]);
  },
  "hooks:history"() {
    run(python, [
      "-m",
      "pre_commit",
      "run",
      "--hook-stage",
      "manual",
      "gitleaks-history",
      "--all-files",
    ]);
  },
  boundaries,
  build() {
    compile();
    node("vite/bin/vite.js", ["build", "--config", "tooling/vite.renderer.mjs"]);
  },
  typecheck() {
    compile(true);
    for (const item of boundaries())
      node("typescript/bin/tsc", ["-p", path.join(item.directory, "tsconfig.json"), "--noEmit"]);
    node("typescript/bin/tsc", ["-p", "tools/renderer-preview/tsconfig.json"]);
    run(python, ["-m", "pyrefly", "check"]);
  },
  lint() {
    compile(true);
    node("eslint/bin/eslint.js", ["packages"]);
    run(python, ["-m", "ruff", "check", "scripts"]);
  },
  "format:check"() {
    node("prettier/bin/prettier.cjs", ["--check", "."]);
    run(python, ["-m", "ruff", "format", "--check", "scripts"]);
  },
  format() {
    node("prettier/bin/prettier.cjs", ["--write", "."]);
    run(python, ["-m", "ruff", "format", "scripts"]);
  },
  test() {
    compile();
    node("vitest/vitest.mjs", ["run"]);
    run(python, ["-m", "unittest", "discover", "-s", "scripts/tests", "-v"]);
  },
  check() {
    for (const name of ["typecheck", "lint", "format:check", "test", "build"]) commands[name]();
  },
  dev() {
    compile();
    node("vite/bin/vite.js", ["tools/renderer-preview", "--host", "127.0.0.1", "--strictPort"]);
  },
  "package:local"() {
    commands.build();
    run(python, ["scripts/package_workspace.py"]);
  },
};
const command = commands[process.argv[2]];
if (!Object.hasOwn(commands, process.argv[2]) || typeof command !== "function") {
  console.error("Unknown workspace command. Select a declared package.json script.");
  process.exit(1);
}
command();
