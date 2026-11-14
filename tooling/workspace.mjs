import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectWorkspace } from "./boundaries.mjs";
import { assertPackagePins } from "./pins.mjs";
import { checkTokens } from "./design-tokens.mjs";
import { validateDesignAssets } from "./design-assets.mjs";
import { generatePortPolicy } from "./port-policy.mjs";

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
  checkTokens(root);
  validateDesignAssets(root);
  generatePortPolicy(root);
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
  fs.cpSync(
    path.join(root, "packages/utility/src/migrations"),
    path.join(root, "packages/utility/dist/migrations"),
    { recursive: true },
  );
  fs.copyFileSync(
    path.join(root, "config/localization/iana-language-subtag-registry.txt"),
    path.join(root, "packages/utility/dist/iana-language-subtag-registry.txt"),
  );
  fs.rmSync(path.join(root, "tools/desktop-probes/dist"), { recursive: true, force: true });
  node("typescript/bin/tsc", ["-p", "tools/desktop-probes/tsconfig.json"]);
}
const commands = {
  "design:check"() {
    checkTokens(root);
    validateDesignAssets(root);
  },
  doctor() {
    console.log("Installed package pins match their manifests and the adopting toolchain.");
  },
  hooks() {
    run(python, ["-m", "pre_commit", "run", "--all-files", "--show-diff-on-failure"]);
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
  "catalog:build"() {
    compile();
    node("vite/bin/vite.js", ["build", "--config", "tooling/vite.catalog.mjs"]);
  },
  async build(development = false) {
    compile();
    node("vite/bin/vite.js", ["build", "--config", "tooling/vite.renderer.mjs"]);
    const { buildDesktop } = await import("./desktop-build.mjs");
    await buildDesktop(root, { development });
  },
  typecheck() {
    compile(true);
    for (const item of boundaries())
      node("typescript/bin/tsc", ["-p", path.join(item.directory, "tsconfig.json"), "--noEmit"]);
    node("typescript/bin/tsc", ["-p", "tools/renderer-preview/tsconfig.json"]);
    node("typescript/bin/tsc", ["-p", "tools/desktop-probes/tsconfig.json", "--noEmit"]);
    run(python, ["-m", "pyrefly", "check"]);
  },
  lint() {
    compile(true);
    node("eslint/bin/eslint.js", [
      "packages",
      "tools/desktop-probes/src",
      "tools/desktop-probes/*.mjs",
      "tooling/quality*.mjs",
      "tooling/design-*.mjs",
      "tooling/catalog*.mjs",
      "tooling/command*.mjs",
      "tooling/product-graph.mjs",
      "tooling/credential-acceptance.mjs",
      "tooling/linux-e2e*.mjs",
      "tooling/update-*.mjs",
      "tooling/installation-*.mjs",
      "tooling/installation-*.cjs",
    ]);
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
    run(process.execPath, ["tooling/quality.mjs", "test", ...process.argv.slice(3)]);
  },
  "quality:cases"() {
    compile();
    run(process.execPath, ["tooling/quality.mjs", "cases"]);
  },
  "quality:inventory"() {
    run(process.execPath, ["tooling/quality.mjs", "inventory"]);
  },
  "quality:plan"() {
    run(python, ["scripts/quality_delivery.py", "plan", ...process.argv.slice(3)]);
  },
  "quality:aggregate"() {
    run(python, ["scripts/quality_delivery.py", "aggregate", ...process.argv.slice(3)]);
  },
  async "quality:build"() {
    await commands.build();
    run(python, ["scripts/quality_native.py", ...process.argv.slice(3)]);
  },
  "quality:native"() {
    run(process.execPath, ["tooling/quality.mjs", "native", ...process.argv.slice(3)]);
  },
  async check() {
    for (const name of ["typecheck", "lint", "format:check", "test", "build"])
      await commands[name]();
  },
  async preview() {
    if (process.argv.length > 3) throw new Error("Use preview without arguments.");
    compile();
    node("vite/bin/vite.js", ["build", "--config", "tooling/vite.catalog.mjs"]);
    node("vite/bin/vite.js", ["preview", "--config", "tooling/vite.catalog.mjs"]);
  },
  async dev() {
    // Only the development command's switches pass through; the runtime admits them in this mode.
    const switches = process.argv.slice(3);
    if (switches.some((item) => !/^--ohtia-dev-[a-z]+(?:-[a-z]+)*=/.test(item)))
      throw new Error(
        "Use dev without arguments, or with --ohtia-dev-command=<action> and its --ohtia-dev-<argument>=<value> switches. An inspected profile launch is desktop:launch <profile> <prepared>.",
      );
    // An open window keeps its runtime: this launch reaches it without replacing anything.
    const { developmentInstanceRunning } = await import("./development-instance.mjs");
    const attaching = developmentInstanceRunning(path.join(root, ".ohtia-dev"));
    if (attaching && switches.length)
      console.log(
        "A window from this checkout is open. Its terminal prints the command's results.",
      );
    else if (attaching)
      console.log("A window from this checkout is open. Close it and run dev to see a change.");
    if (!attaching) await commands.build(true);
    else if (!fs.existsSync(path.join(root, "packages/main/dist/index.js"))) compile();
    const { launchDevelopment, prepareDevelopmentRoot } = await import("./desktop-launch.mjs");
    const directory = prepareDevelopmentRoot();
    const runtime = path.join(directory, "runtime");
    if (!attaching) {
      fs.rmSync(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      run(python, ["scripts/desktop_runtime.py", `${process.platform}-${process.arch}`, runtime]);
    }
    await launchDevelopment(directory, runtime, switches);
  },
  async "desktop:launch"() {
    const [profile, prepared] = process.argv.slice(3);
    if (!profile || !prepared)
      throw new Error(
        "Use desktop:launch <absolute-runtime-profile.json> <absolute-prepared-runtime>. See docs/desktop-runtime.md.",
      );
    const { launchDesktop } = await import("./desktop-launch.mjs");
    await launchDesktop(profile, prepared);
  },
  "desktop:prepare"() {
    run(python, ["scripts/desktop_runtime.py", ...process.argv.slice(3)]);
  },
  "linux:e2e"() {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw new Error("Use a native Linux x86-64 host for the Docker/AppArmor E2E route.");
    run("bash", ["tools/linux-e2e/run.sh", ...process.argv.slice(3)]);
  },
  async "credentials:test"() {
    const { developmentInstanceRunning } = await import("./development-instance.mjs");
    if (developmentInstanceRunning(path.join(root, ".ohtia-dev")))
      throw new Error("Close this checkout's development application before checking credentials.");
    await commands.build(true);
    const { prepareDevelopmentRoot } = await import("./desktop-launch.mjs");
    const directory = prepareDevelopmentRoot();
    const runtime = path.join(directory, "runtime");
    fs.rmSync(runtime, { recursive: true, force: true });
    run(python, ["scripts/desktop_runtime.py", `${process.platform}-${process.arch}`, runtime]);
    run(process.execPath, ["tooling/credential-acceptance.mjs", ...process.argv.slice(3)]);
  },
  "desktop:test"() {
    run(process.execPath, ["tooling/desktop-acceptance.mjs", ...process.argv.slice(3)]);
  },
  "diagnostics:test"() {
    run(process.execPath, ["tooling/diagnostic-acceptance.mjs", ...process.argv.slice(3)]);
  },
  "storage:test"() {
    run(process.execPath, ["tooling/storage-acceptance.mjs", ...process.argv.slice(3)]);
  },
  async "package:local"() {
    await commands.build();
    run(python, ["scripts/package_workspace.py"]);
  },
  async "probes:prepare"() {
    await commands.build();
    run(python, ["scripts/desktop_probes.py", "prepare", ...process.argv.slice(3)]);
  },
  async "probes:bundle"() {
    await commands.build();
    run(python, ["scripts/desktop_probes.py", "bundle", ...process.argv.slice(3)]);
  },
  "probes:run"() {
    run(python, ["scripts/desktop_probes.py", "run", ...process.argv.slice(3)]);
  },
  "probes:report"() {
    run(python, ["scripts/desktop_probes.py", "report", ...process.argv.slice(3)]);
  },
  "probes:package"() {
    run(python, ["scripts/desktop_delivery.py", ...process.argv.slice(3)]);
  },
};
const command = commands[process.argv[2]];
if (!Object.hasOwn(commands, process.argv[2]) || typeof command !== "function") {
  console.error("Unknown workspace command. Select a declared package.json script.");
  process.exit(1);
}
await command();
