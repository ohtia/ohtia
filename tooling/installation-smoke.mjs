/* global window */
// Non-shipping graphical first-install and existing-store upgrade journey.
import fs from "node:fs";
import path from "node:path";
import { _electron, expect } from "@playwright/test";
import { admittedLaunch } from "./desktop-launch.mjs";
import { recordReadyNativeProcesses } from "./desktop-native-observation.mjs";
import { verifyStableSentinels } from "../packages/main/dist/index.js";
import { message } from "../packages/contracts/dist/index.js";
const [profileFile, preparedDirectory, output, previousFile] = process.argv.slice(2);
const launch = admittedLaunch(profileFile, preparedDirectory);
if (
  !path.isAbsolute(output) ||
  !output.startsWith(launch.profile.scratch_root + path.sep) ||
  fs.existsSync(output)
)
  throw new Error("Use fresh native evidence inside inspected scratch.");
fs.mkdirSync(output, { mode: 0o700 });
const previous = previousFile ? JSON.parse(fs.readFileSync(previousFile)) : null;
const receipt = { version: 1, status: "failed", cases: [], previous: previous?.saved ?? null };
let application;
async function start() {
  application = await _electron.launch({
    executablePath: launch.executable,
    args: [launch.app, ...launch.args],
    env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    chromiumSandbox: true,
    bypassCSP: false,
    timeout: 20000,
  });
  const page = await application.firstWindow();
  await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
  const snapshot = await page.evaluate(() => window.ohtia.bootstrap.read());
  await page
    .getByRole("button", { name: message(snapshot.locale, "open_storage"), exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: 20000,
    })
    .toBe("storage_ready");
  await recordReadyNativeProcesses(application, output);
  // Keep the ready runtime observable for the independent native OS sampler.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return page;
}
try {
  const page = await start();
  const before = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  expect(before.ok).toBe(true);
  if (previous) expect(before.value).toEqual(previous.saved);
  receipt.cases.push({
    id: previous ? "existing-store-preserves-appearance" : "first-install-opens-native-store",
    result: "pass",
    observed: before.value,
  });
  const bootstrap = await page.evaluate(() => window.ohtia.bootstrap.read());
  const selected = before.value.value === "dark" ? "light" : "dark";
  await page
    .getByRole("combobox", { name: message(bootstrap.locale, "appearance"), exact: true })
    .selectOption(selected);
  await page.getByRole("button", { name: message(bootstrap.locale, "save"), exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).value?.value,
    )
    .toBe(selected);
  const saved = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  expect(saved.ok).toBe(true);
  expect(saved.value.revision).toBe(before.value.revision + 1);
  receipt.saved = saved.value;
  await page.screenshot({ path: path.join(output, "installed-window.png") });
  await application.close();
  application = undefined;
  const reopened = await start();
  const after = await reopened.evaluate(() => window.ohtia.foundation.readAppearance().result);
  expect(after.ok).toBe(true);
  expect(after.value).toEqual(saved.value);
  receipt.cases.push({
    id: "installed-update-persists-across-restart",
    result: "pass",
    observed: after.value,
  });
  await application.close();
  application = undefined;
  verifyStableSentinels(launch.profile);
  receipt.status = "passed";
} finally {
  if (application) await application.close();
  fs.writeFileSync(
    path.join(output, "installation-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
