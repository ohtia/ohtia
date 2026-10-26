/** Control a disposable native probe through the root workspace's pinned test toolchain. */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("@playwright/test");
const toolVersion = require("@playwright/test/package.json").version;
const testRequire = createRequire(require.resolve("@playwright/test/package.json"));
const playwrightRequire = createRequire(testRequire.resolve("playwright/package.json"));
const coreVersion = playwrightRequire("playwright-core/package.json").version;
const coreBundle = playwrightRequire.resolve("playwright-core/lib/coreBundle");
const coreBundleSha256 = createHash("sha256").update(readFileSync(coreBundle)).digest("hex");
const tools = JSON.parse(
  readFileSync(path.join(root, "config/desktop/toolchain.json"), "utf8"),
).tools;
const [attempt, output, argumentsJson] = process.argv.slice(2);
const prepared = JSON.parse(readFileSync(path.join(attempt, "prepared.json"), "utf8"));
const executable = path.resolve(attempt, prepared.executable);
const args = JSON.parse(argumentsJson);
const result = {
  ok: false,
  toolVersion,
  coreVersion,
  coreBundleSha256,
  target: prepared.target,
  scenario: "playwright",
};
let application;
try {
  if (
    toolVersion !== tools["@playwright/test"].version ||
    coreVersion !== toolVersion ||
    prepared.expected.scenario !== "playwright"
  )
    throw new Error("Wrong pinned tool or native scenario.");
  if (!Array.isArray(args) || args.length !== 0)
    throw new Error("Native control requires the reviewed empty runtime argument policy.");
  const relative = path.relative(path.join(attempt, "runtime"), executable);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep))
    throw new Error("Executable escaped its admitted runtime.");
  const admitted = JSON.parse(readFileSync(path.join(attempt, "admitted.json"), "utf8"));
  const runtimeEnvironment = { ...process.env };
  delete runtimeEnvironment.DEBUG;
  application = await _electron.launch({
    executablePath: executable,
    args,
    cwd: output,
    artifactsDir: output,
    env: runtimeEnvironment,
    chromiumSandbox: true,
    colorScheme: null,
    timeout: prepared.expected.deadlineMs,
  });
  const child = application.process();
  const stopped = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  result.arguments = child.spawnargs;
  if (
    child.spawnargs.some((value) => /no-sandbox|disable-setuid-sandbox|ozone-platform=/.test(value))
  )
    throw new Error("Forbidden native runtime argument.");
  result.identity = await application.evaluate(({ app }) => ({
    ready: app.isReady(),
    executable: process.execPath,
    target: `${process.platform}-${process.arch}`,
    versions: process.versions,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    processArgv: process.argv,
    switches: Object.fromEntries(
      ["no-sandbox", "disable-setuid-sandbox", "ozone-platform", "disable-web-security"].map(
        (name) => [
          name,
          { present: app.commandLine.hasSwitch(name), value: app.commandLine.getSwitchValue(name) },
        ],
      ),
    ),
  }));
  if (
    !result.identity.ready ||
    (process.platform === "linux" &&
      result.identity.switches["ozone-platform"].present &&
      result.identity.switches["ozone-platform"].value !== admitted.backend) ||
    ["no-sandbox", "disable-setuid-sandbox", "disable-web-security"].some(
      (name) => result.identity.switches[name].present,
    ) ||
    result.identity.target !== prepared.target ||
    realpathSync(result.identity.executable) !== realpathSync(executable) ||
    Object.entries(prepared.expected.runtime).some(
      ([key, value]) => result.identity.versions[key] !== value,
    )
  )
    throw new Error("Playwright controlled a different native runtime.");
  const page = await application.firstWindow({ timeout: prepared.expected.deadlineMs });
  await page.waitForURL("ohtia-probe://qualification/index.html", {
    waitUntil: "domcontentloaded",
    timeout: prepared.expected.deadlineMs,
  });
  await page.emulateMedia({ colorScheme: null });
  result.documentUrl = page.url();
  result.renderer = await page.evaluate(async () => ({
    privilegedGlobalsAbsent:
      typeof globalThis.process === "undefined" &&
      typeof globalThis.require === "undefined" &&
      typeof globalThis.Buffer === "undefined",
    status: await globalThis.ohtiaNativeProbe.status(),
  }));
  if (
    result.documentUrl !== "ohtia-probe://qualification/index.html" ||
    !result.renderer.privilegedGlobalsAbsent ||
    result.renderer.status.ok !== true ||
    result.renderer.status.value.ready !== true ||
    result.renderer.status.value.target !== prepared.target ||
    result.renderer.status.value.electron !== prepared.expected.runtime.electron
  )
    throw new Error("Controlled renderer or private status bridge disagrees.");
  result.controlReleased = await application.evaluate(({ app }) =>
    app.emit("ohtia-probe-control-ready"),
  );
  result.nativeExit = await stopped;
  const observed = JSON.parse(readFileSync(path.join(output, "runtime.json"), "utf8"));
  if (
    !result.controlReleased ||
    result.nativeExit.code !== 0 ||
    result.nativeExit.signal !== null ||
    observed.ok !== true ||
    observed.utilityExited !== true ||
    observed.playwrightControlReleased !== true
  )
    throw new Error("Controlled native journey did not finish successfully.");
  result.ok = true;
} catch (error) {
  result.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  writeFileSync(
    path.join(output, "playwright-control.json"),
    JSON.stringify(result, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}
