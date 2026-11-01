import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import {
  accountShards,
  assertDeclaredCases,
  git,
  occurrenceIds,
  readJson,
  requireGate,
  sameSet,
  walk,
} from "./quality-core.mjs";
import { coverageGate } from "./quality-coverage.mjs";
import { catalogGate } from "./quality-catalogs.mjs";
import { nativeInventory, accountNative } from "./quality-inventory.mjs";
import { playwrightCases } from "./quality-playwright.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".reports/quality");
const inventory = readJson(path.join(root, "config/quality/inventory.json"));
requireGate(inventory?.version === 1, "unsupported quality inventory version");
export function diffBase(root, explicit, env = process.env) {
  let base = explicit;
  if (!base && env.GITHUB_ACTIONS === "true") {
    const event = readJson(env.GITHUB_EVENT_PATH);
    base =
      env.GITHUB_EVENT_NAME === "pull_request"
        ? event.pull_request?.base?.sha
        : env.GITHUB_EVENT_NAME === "push"
          ? event.before
          : undefined;
    requireGate(base, "CI event has no declared diff base");
  }
  base ??= git(root, ["merge-base", "HEAD", "origin/main"]);
  requireGate(/^[a-f0-9]{40}$/.test(base), "diff base must be a full immutable SHA");
  git(root, ["cat-file", "-e", `${base}^{commit}`]);
  requireGate(
    git(root, ["merge-base", base, "HEAD"]) === base,
    "diff base is not an ancestor of the tested checkout",
  );
  return base;
}
function write(name, value) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
}
function execute(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  requireGate(
    !result.error && result.status === 0,
    `preparation/test command failed: ${args.join(" ")}`,
  );
}
export function sourceDigest(root) {
  const hash = createHash("sha256");
  const files = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of files) {
    hash.update(JSON.stringify(file));
    const absolute = path.join(root, file);
    hash.update(
      fs.existsSync(absolute)
        ? createHash("sha256")
            .update(
              fs.lstatSync(absolute).isSymbolicLink()
                ? fs.readlinkSync(absolute)
                : fs.readFileSync(absolute),
            )
            .digest("hex")
        : "<deleted>",
    );
  }
  return hash.digest("hex");
}
export function checkoutIdentity(root, base) {
  return {
    base,
    head: git(root, ["rev-parse", "HEAD"]),
    sourceSha256: sourceDigest(root),
    workflowSha256: createHash("sha256")
      .update(fs.readFileSync(path.join(root, ".github/workflows/ci.yml")))
      .digest("hex"),
  };
}
export function assertCheckoutIdentity(root, identity) {
  requireGate(identity && typeof identity === "object", "missing native checkout identity");
  const current = checkoutIdentity(root, diffBase(root, identity.base));
  for (const key of Object.keys(current))
    requireGate(identity[key] === current[key], `native ${key} does not match the tested checkout`);
}
export function collectedVitestInventory(collected, applicability, platform) {
  requireGate(collected.length > 0, "empty Vitest inventory");
  sameSet(
    applicability.map((item) => item.id),
    [...new Set(applicability.map((item) => item.id))],
    "Vitest applicability identifiers",
  );
  requireGate(
    applicability.every(
      (item) =>
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.reason === "string" &&
        item.reason.length > 0 &&
        Array.isArray(item.platforms) &&
        item.platforms.length > 0 &&
        item.platforms.every((platform) => ["linux", "win32", "darwin"].includes(platform)),
    ),
    "invalid Vitest applicability declaration",
  );
  const omittedVitest = applicability.filter((item) => item.platforms.includes(platform));
  // Vitest list excludes skipped cases; the run reporter must still account for them.
  const expected = [...collected, ...omittedVitest.map((item) => item.id)];
  sameSet(expected, [...new Set(expected)], "Vitest enumeration identifiers");
  const requiredVitest = collected;
  return { expected, required: requiredVitest, inapplicable: omittedVitest };
}
export function vitestCollection(registry, collected, applicability, platform) {
  const result = collectedVitestInventory(collected, applicability, platform);
  requireGate(
    applicability.every((item) => registry.vitest.includes(item.id)),
    "unknown Vitest applicability identifier",
  );
  assertDeclaredCases(registry, "vitest", result.expected);
  return result;
}
export async function runTests(base) {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const identity = {
    run: randomUUID(),
    ...checkoutIdentity(root, base),
    githubRun: process.env.GITHUB_RUN_ID ?? null,
    githubAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
  write("identity.json", identity);
  write("result.json", { status: "failed", preparation: "pending", identity });
  sameSet(
    walk(path.join(root, "tests"))
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => path.relative(root, f).replaceAll("\\", "/")),
    inventory.vitest,
    "Vitest source files",
  );
  sameSet(
    walk(path.join(root, "tests"))
      .filter((f) => f.endsWith(".spec.ts"))
      .map((f) => path.relative(root, f).replaceAll("\\", "/")),
    inventory.playwright,
    "Playwright source files",
  );
  const registry = readJson(path.join(root, "config/quality/cases.json"));
  const env = { ...process.env, OHTIA_QUALITY_IDENTITY: JSON.stringify(identity) };
  const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
  execute(
    [vitest, "list", "--no-static-parse", `--json=${path.join(output, "vitest-inventory.json")}`],
    env,
  );
  const listed = readJson(path.join(output, "vitest-inventory.json"));
  const collected = occurrenceIds(
    listed.map((c) => `${path.relative(root, c.file).replaceAll("\\", "/")}::${c.name}`),
  );
  sameSet(
    [...new Set(listed.map((c) => path.relative(root, c.file).replaceAll("\\", "/")))],
    inventory.vitest,
    "Vitest discovered files",
  );
  const {
    expected,
    required: requiredVitest,
    inapplicable: omittedVitest,
  } = vitestCollection(registry, collected, inventory.vitest_inapplicable ?? [], process.platform);
  execute([vitest, "run", "--config", "vitest.denominator.config.ts"], env);
  const denominatorRun = readJson(path.join(output, "denominator-run.json"));
  requireGate(
    denominatorRun.success === true && denominatorRun.numTotalTests === 0,
    "denominator generation executed unexpected cases",
  );
  const denominator = readJson(path.join(output, "denominator/coverage-final.json"));
  execute([vitest, "run", "--coverage"], env);
  const vitestReport = readJson(path.join(output, "vitest-accounting.json"));
  sameSet(
    vitestReport.cases.map((item) => item.id),
    expected,
    "complete Vitest run cases",
  );
  const vitestResult = accountShards(
    [{ shard: "vitest-1", cases: requiredVitest }],
    [
      {
        ...vitestReport,
        cases: vitestReport.cases.filter(
          (item) => !omittedVitest.some((excluded) => excluded.id === item.id),
        ),
      },
    ],
    identity,
  );
  vitestResult.inapplicable = omittedVitest;
  const playwright = path.join(root, "node_modules/@playwright/test/cli.js");
  execute([playwright, "test", "--list"], {
    ...env,
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(output, "playwright-inventory.json"),
  });
  const pwInventory = playwrightCases(
    readJson(path.join(output, "playwright-inventory.json")),
    true,
  );
  sameSet(
    [...new Set(pwInventory.map((c) => `tests/quality/${c.file}`))],
    inventory.playwright,
    "Playwright discovered files",
  );
  assertDeclaredCases(
    registry,
    "playwright",
    pwInventory.map((item) => item.id),
  );
  execute([playwright, "test"], {
    ...env,
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(output, "playwright.json"),
  });
  const pwCases = playwrightCases(readJson(path.join(output, "playwright.json")));
  // Both reports are produced by this invocation in the newly created owned directory.
  const playwrightResult = accountShards(
    [{ shard: "playwright-1", cases: pwInventory.map((c) => c.id) }],
    [
      {
        version: 1,
        shard: "playwright-1",
        preparation: "passed",
        status: "passed",
        identity,
        cases: pwCases,
      },
    ],
    identity,
  );
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const pythonPreparation = spawnSync(python, ["scripts/quality_tests.py", "--list"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  requireGate(
    !pythonPreparation.error && pythonPreparation.status === 0,
    "repository Python discovery failed",
  );
  const pythonInventory = readJson(path.join(output, "python-inventory.json"));
  requireGate(
    pythonInventory.preparation === "passed" && pythonInventory.status === "inventory",
    "incomplete Python inventory",
  );
  assertDeclaredCases(registry, "python", pythonInventory.discovered);
  const pythonResult = spawnSync(python, ["scripts/quality_tests.py"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  requireGate(
    !pythonResult.error && pythonResult.status === 0,
    "repository Python behavior/accounting failed",
  );
  const pythonReport = readJson(path.join(output, "python.json"));
  sameSet(pythonReport.required, pythonInventory.required, "Python discovered/run cases");
  const pythonAccounting = accountShards(
    [{ shard: "python-1", cases: pythonInventory.required }],
    [pythonReport],
    identity,
  );
  const { catalogs, supportedLocales, messageContracts } =
    await import("../packages/contracts/dist/index.js");
  sameSet([...supportedLocales], inventory.locales, "product locale inventory");
  const catalogsResult = catalogGate(inventory.locales, messageContracts, catalogs);
  const coverage = coverageGate(
    root,
    readJson(path.join(output, "coverage/coverage-final.json")),
    base,
    undefined,
    denominator,
  );
  write("coverage-result.json", coverage);
  const result = {
    version: 1,
    identity,
    preparation: "passed",
    status: coverage.status,
    vitest: vitestResult,
    playwright: playwrightResult,
    python: pythonAccounting,
    catalogs: catalogsResult,
    coverage,
  };
  requireGate(
    sourceDigest(root) === identity.sourceSha256,
    "source inputs changed during verification",
  );
  write("result.json", result);
  console.log(JSON.stringify(result, null, 2));
  requireGate(
    result.status === "passed",
    "per-package coverage floors failed; see .reports/quality/coverage-result.json",
  );
}
export async function updateCases() {
  const scratch = path.join(output, "case-discovery");
  fs.mkdirSync(scratch, { recursive: true });
  const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
  execute(
    [vitest, "list", "--no-static-parse", `--json=${path.join(scratch, "vitest.json")}`],
    process.env,
  );
  const vitestCases = collectedVitestInventory(
    occurrenceIds(
      readJson(path.join(scratch, "vitest.json")).map(
        (item) => `${path.relative(root, item.file).replaceAll("\\", "/")}::${item.name}`,
      ),
    ),
    inventory.vitest_inapplicable ?? [],
    process.platform,
  ).expected;
  execute([path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--list"], {
    ...process.env,
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(scratch, "playwright.json"),
  });
  const playwrightList = playwrightCases(readJson(path.join(scratch, "playwright.json")), true).map(
    (item) => item.id,
  );
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const result = spawnSync(python, ["scripts/quality_tests.py", "--list"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  requireGate(!result.error && result.status === 0, "Python registry discovery failed");
  const pythonList = readJson(path.join(output, "python-inventory.json")).discovered;
  const registry = {
    version: 1,
    vitest: vitestCases.sort(),
    playwright: playwrightList.sort(),
    python: pythonList.sort(),
  };
  for (const runtime of ["vitest", "playwright", "python"])
    assertDeclaredCases(registry, runtime, registry[runtime]);
  fs.writeFileSync(
    path.join(root, "config/quality/cases.json"),
    JSON.stringify(registry, null, 2) + "\n",
  );
  console.log(
    "Updated the committed case registry. Review this deliberate inventory change; checks never update it.",
  );
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "cases") await updateCases();
  else if (command === "test") await runTests(diffBase(root, args[0]));
  else if (command === "inventory")
    console.log(
      JSON.stringify(
        {
          native: nativeInventory(
            readJson(path.join(root, "config/desktop/targets.json")),
            inventory.included_optional_targets,
          ),
          declaredTargets: readJson(path.join(root, "config/desktop/targets.json")).targets.map(
            (target) => ({
              id: target.id,
              required: target.native_required,
              included:
                target.native_required || inventory.included_optional_targets.includes(target.id),
            }),
          ),
          portableBrowserEngines: inventory.portable_browser_engines,
          separateEvidence: inventory.separate_evidence,
        },
        null,
        2,
      ),
    );
  else if (command === "native") {
    requireGate(args.length === 2, "use quality:native <identity.json> <reports.json>");
    const identity = readJson(args[0]);
    assertCheckoutIdentity(root, identity);
    console.log(
      accountNative(
        nativeInventory(
          readJson(path.join(root, "config/desktop/targets.json")),
          inventory.included_optional_targets,
        ),
        readJson(args[1]),
        identity,
      ),
    );
  } else throw new Error("Select quality test, cases, inventory or native.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
