// Three separate development processes prove store persistence; no provider access is performed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { _electron as electron } from "@playwright/test";
import {
  prepareDevelopmentRoot,
  developmentLaunch,
  shortTemporaryDirectory,
} from "./desktop-launch.mjs";
import { developmentInstanceRunning } from "./development-instance.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = prepareDevelopmentRoot();
if (developmentInstanceRunning(directory))
  throw new Error("Close this checkout's development application before checking credentials.");
const runtime = path.join(directory, "runtime");
const output = path.join(root, "tmp/credential-acceptance");
fs.mkdirSync(output, { recursive: true });
const selected = process.argv[2];
if (process.argv.length > 3 || (selected && !["read", "delete", "unavailable"].includes(selected)))
  throw new Error("Use credentials:test [read|delete|unavailable].");
const actions = selected ? [selected] : ["write", "read", "delete"];
const receipt = {
  target: `${process.platform}-${process.arch}`,
  desktop: process.env.XDG_CURRENT_DESKTOP ?? "native",
  cases: [],
};
try {
  for (const action of actions) {
    const scratch = shortTemporaryDirectory("ohtia-creds-");
    let application;
    try {
      const launch = developmentLaunch(directory, runtime, scratch);
      application = await electron.launch({
        chromiumSandbox: true,
        bypassCSP: false,
        colorScheme: null,
        executablePath: launch.executable,
        args: [launch.app, ...launch.args],
        env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
        timeout: 30000,
      });
      await application.firstWindow();
      const result = await application.evaluate(async (_electron, action) => {
        const check = globalThis.__ohtiaCredentialAcceptance;
        if (typeof check !== "function")
          throw new Error("Development credential check unavailable.");
        return check(action);
      }, action);
      receipt.cases.push({ action, status: result.status });
      if (result.status !== (action === "write" ? "stored" : "confirmed"))
        throw new Error(
          "Native credential check did not confirm the expected state; preserve the checkout for inspection.",
        );
    } finally {
      try {
        await application?.close();
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(receipt, null, 2) + "\n");
}
console.log(
  "Native synthetic credential checks completed; record the actual OS, desktop and store implementation separately.",
);
