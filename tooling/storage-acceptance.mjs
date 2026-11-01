// Non-shipping native acceptance; each run retains complete failed and passing observations.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { _electron, expect } from "@playwright/test";
import { pseudolocalize } from "../tests/fixtures/pseudolocalization.mjs";
import { admittedLaunch } from "./desktop-launch.mjs";
import { recordReadyNativeProcesses } from "./desktop-native-observation.mjs";
import { verifyStableSentinels } from "../packages/main/dist/index.js";
import {
  message,
  portLimits,
  supportedLocales,
  localeAutonyms,
} from "../packages/contracts/dist/index.js";

const [profileFile, prepared, output] = process.argv.slice(2);
if (!profileFile || !prepared || !output)
  throw new Error("Use storage:test <profile.json> <prepared-runtime> <new-evidence-directory>.");
const launch = admittedLaunch(profileFile, prepared);
const inventory = JSON.parse(
  fs.readFileSync(new URL("../config/desktop/storage-cases.json", import.meta.url)),
);
for (const field of ["component_cases", "graphical_cases", "interruption_points"])
  if (
    !Array.isArray(inventory[field]) ||
    !inventory[field].length ||
    new Set(inventory[field]).size !== inventory[field].length
  )
    throw new Error("Invalid required storage case inventory.");
if (
  !path.isAbsolute(output) ||
  !output.startsWith(launch.profile.scratch_root + path.sep) ||
  fs.existsSync(output)
)
  throw new Error("A new isolated evidence directory is required.");
fs.mkdirSync(output);
const receipt = {
  version: 1,
  artifact: createHash("sha256")
    .update(fs.readFileSync(path.join(prepared, "prepared.json")))
    .digest("hex"),
  cases: [],
  limitations: [
    "Manual assistive and human linguistic acceptance are separate.",
    "Instrumented failure cases are distinct from ordinary native execution and physical power loss.",
  ],
};
function record(id, observed) {
  receipt.cases.push({ id, result: "pass", observed });
  fs.writeFileSync(
    path.join(output, "storage-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
}
let application;
let openingObserved = false;
async function start() {
  application = await _electron.launch({
    executablePath: launch.executable,
    args: [launch.app, ...launch.args],
    env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    chromiumSandbox: true,
    bypassCSP: false,
    timeout: 20000,
    artifactsDir: output,
  });
  const page = await application.firstWindow();
  await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok, {
      timeout: portLimits.service_start_ms,
    })
    .toBe(true);
  await recordReadyNativeProcesses(application, output);
  return page;
}
async function holdNextStorageNotice() {
  await application.evaluate(({ utilityProcess }) => {
    const fork = utilityProcess.fork;
    utilityProcess.fork = (...args) => {
      utilityProcess.fork = fork;
      const child = fork.apply(utilityProcess, args);
      const emit = child.emit;
      child.emit = function (event, ...values) {
        if (
          event === "message" &&
          typeof values[0] === "string" &&
          JSON.parse(values[0]).kind === "storage"
        ) {
          globalThis.__heldStoragePid = child.pid;
          globalThis.__releaseStorageNotice = () => {
            child.emit = emit;
            emit.call(child, event, ...values);
          };
          return true;
        }
        return emit.call(child, event, ...values);
      };
      return child;
    };
  });
}
async function open(page, expected = "storage_ready") {
  const snapshot = await page.evaluate(() => window.ohtia.bootstrap.read());
  const observeOpening = !openingObserved && expected === "storage_ready";
  if (observeOpening) await holdNextStorageNotice();
  await page
    .getByRole("button", { name: message(snapshot.locale, "open_storage"), exact: true })
    .click();
  if (observeOpening) {
    await expect
      .poll(() =>
        application.evaluate(() => typeof globalThis.__releaseStorageNotice === "function"),
      )
      .toBe(true);
    await expect(page.locator("#location-state")).toHaveText(
      message(snapshot.locale, "storage_opening"),
    );
    await expect(page.locator("#location-state")).toBeFocused();
    await expect(
      page.getByRole("button", { name: message(snapshot.locale, "retry"), exact: true }).last(),
    ).toBeDisabled();
    const attempts = await page.evaluate(() =>
      Promise.all([
        window.ohtia.bootstrap.retryService(),
        window.ohtia.bootstrap.openStorage(),
        window.ohtia.bootstrap.restoreCheckpoint(),
      ]),
    );
    expect(attempts.map((value) => value.state)).toEqual([
      "storage_opening",
      "storage_opening",
      "storage_opening",
    ]);
    await application.evaluate(() => {
      globalThis.__releaseStorageNotice();
      delete globalThis.__releaseStorageNotice;
    });
    openingObserved = true;
    record("opening-remains-gated-and-focused", {
      delayedStorageNotice: true,
      pendingActionsRejected: true,
      focusOnPersistentNotice: true,
      mechanism:
        "non-shipping main test peer holds one real utility outcome; no simulated filesystem latency",
    });
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: 20000,
    })
    .toBe(expected);
  if (expected === "storage_ready")
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).value?.engine,
      )
      .toBe("verified");
  return (await page.evaluate(() => window.ohtia.bootstrap.read())).locale;
}
async function component(mode, directory, expectedInterruption = false) {
  const helper = fileURLToPath(new URL("./storage-native-cases.mjs", import.meta.url));
  return application.evaluate(
    async ({ utilityProcess }, input) => {
      const child = utilityProcess.fork(
        input.helper,
        [input.profile, input.app, input.directory, input.mode],
        {
          serviceName: "Ohtia storage acceptance",
          stdio: "ignore",
          execArgv: [],
          cwd: input.scratch,
          env: input.env,
        },
      );
      const messages = [];
      return new Promise((resolve, reject) => {
        let paused = false;
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Native storage case exceeded its bound."));
        }, 60000);
        child.on("message", (message) => {
          const value = JSON.parse(message);
          messages.push(value);
          if (value.kind === "complete" || value.kind === "failed") child.postMessage("ack");
          if (value.kind === "paused" && input.interrupted) {
            paused = true;
            child.kill();
          }
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, paused, messages });
        });
      });
    },
    {
      helper,
      profile: profileFile,
      app: launch.app,
      directory,
      mode,
      interrupted: expectedInterruption,
      scratch: launch.profile.scratch_root,
      env: launch.env,
    },
  );
}
try {
  let page = await start();
  const locale = await open(page);
  const text = (key) => message(locale, key);
  await page.evaluate(async () => {
    window.__storageAppearanceEvents = [];
    window.__storageAppearanceSubscription = window.ohtia.foundation.subscribeAppearance(
      (notice) => {
        window.__storageAppearanceEvents.push(notice);
      },
    );
    const ready = await window.__storageAppearanceSubscription.ready;
    if (!ready.ok) throw new Error("Appearance subscription failed.");
  });
  const before = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  expect(before.ok).toBe(true);
  const selected = before.value.value === "dark" ? "light" : "dark";
  const control = page.getByRole("combobox", { name: text("appearance"), exact: true });
  await expect(control).toBeEnabled();
  await control.selectOption(selected);
  await page.getByRole("button", { name: text("save"), exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).value?.value,
    )
    .toBe(selected);
  const saved = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  expect(saved.value.revision).toBe(before.value.revision + 1);
  record("graphical-persisted-appearance", { before, saved });
  const operationId = `native-${randomUUID()}`;
  const changed = selected === "dark" ? "light" : "dark";
  await application.evaluate(({ BrowserWindow }, operation) => {
    const frame = BrowserWindow.getAllWindows()[0].webContents.mainFrame;
    const original = frame.send;
    globalThis.__restoreStorageReply = () => {
      frame.send = original;
    };
    frame.send = function (channel, text) {
      if (typeof text === "string") {
        const value = JSON.parse(text);
        if (
          value.kind === "result" &&
          value.operation === "appearance.replace" &&
          value.operationId === operation
        )
          return;
      }
      return original.call(this, channel, text);
    };
  }, operationId);
  const uncertain = await page.evaluate(
    async (command) => window.ohtia.foundation.replaceAppearance(command).result,
    { operationId, expectedRevision: saved.value.revision, value: changed },
  );
  expect(uncertain).toMatchObject({ ok: false, error: { code: "uncertain" } });
  await application.evaluate(() => {
    globalThis.__restoreStorageReply();
    delete globalThis.__restoreStorageReply;
  });
  const recovered = await page.evaluate(
    async (operation) => window.ohtia.foundation.readAppearanceReceipt(operation).result,
    operationId,
  );
  expect(recovered).toMatchObject({
    ok: true,
    value: {
      state: "recorded",
      outcome: { ok: true, value: { value: changed, revision: saved.value.revision + 1 } },
    },
  });
  record("lost-response-reconciled-without-replay", { uncertain, recovered });
  const replay = await page.evaluate(
    async (command) => window.ohtia.foundation.replaceAppearance(command).result,
    { operationId, expectedRevision: saved.value.revision, value: changed },
  );
  expect(replay).toEqual(recovered.value.outcome);
  const events = await page.evaluate(() => {
    const values = window.__storageAppearanceEvents;
    window.__storageAppearanceSubscription.dispose();
    return values;
  });
  expect(events.every((event) => event.ok)).toBe(true);
  expect(events.map((event) => event.value.revision)).toEqual([
    before.value.revision,
    saved.value.revision,
    saved.value.revision + 1,
  ]);
  record("ipc-replay-preserves-subscription", { replay, events });
  await page.evaluate(() => window.ohtia.bootstrap.newWindow());
  await expect.poll(() => application.windows().length).toBe(2);
  const second = application.windows().find((window) => window !== page);
  await expect
    .poll(
      async () =>
        (await second.evaluate(() => window.ohtia.foundation.readAppearance().result)).value?.value,
    )
    .toBe(changed);
  // Exercise the language owner through the actual packaged bridge and existing isolated store.
  const language = page.locator('select[aria-describedby="language-help"]');
  const initialLanguage = await page.evaluate(() => window.ohtia.foundation.readLocale().result);
  expect(initialLanguage.ok).toBe(true);
  await expect(language.locator("option")).toHaveCount(26);
  await page.evaluate(() => {
    const draft = document.createElement("textarea");
    draft.id = "locale-preservation-fixture";
    draft.value = "Synthetic researcher draft 연구 초안";
    document.querySelector("main").append(draft);
    window.__localeInput = draft;
  });
  for (const choice of supportedLocales) {
    await language.focus();
    await language.selectOption(choice);
    await expect(language).toBeFocused();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.ohtia.foundation.readLocale().result)).value
            ?.effectiveLocale,
      )
      .toBe(choice);
    await expect(page.locator("html")).toHaveAttribute("lang", choice);
    await expect(second.locator("html")).toHaveAttribute("lang", choice);
    await expect(language.locator(`option[value="${choice}"]`)).toHaveAttribute("lang", choice);
    await expect(language.locator(`option[value="${choice}"]`)).toHaveText(
      localeAutonyms[choice].label,
    );
    await expect(page.locator("#language-title")).toHaveText(
      message(choice, "settings.language.title"),
    );
    for (const width of [320, 600, 1024, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  }
  const renderedTexts = await page.locator("main").evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const values = [];
    while (walker.nextNode())
      if (walker.currentNode.textContent.trim()) values.push(walker.currentNode.textContent);
    return values;
  });
  await page.evaluate((expanded) => {
    const clone = document.querySelector("main").cloneNode(true);
    for (const element of clone.querySelectorAll("[id]")) element.removeAttribute("id");
    clone.id = "locale-pseudo-fixture";
    clone.setAttribute("aria-hidden", "true");
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let index = 0;
    while (walker.nextNode())
      if (walker.currentNode.textContent.trim()) walker.currentNode.textContent = expanded[index++];
    document.body.append(clone);
  }, renderedTexts.map(pseudolocalize));
  for (const width of [320, 600, 1024, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.screenshot({ path: path.join(output, "locale-pseudo-320.png"), fullPage: true });
  await page.locator("#locale-pseudo-fixture").evaluate((element) => element.remove());
  await page.locator("#locale-preservation-fixture").focus();
  const currentLanguage = await page.evaluate(() => window.ohtia.foundation.readLocale().result);
  const localeOperationId = randomUUID();
  const languageCommand = {
    operationId: localeOperationId,
    expectedRevision: currentLanguage.value.record.revision,
    value: initialLanguage.value.record.value,
  };
  const restoredLanguage = await page.evaluate(
    (command) => window.ohtia.foundation.replaceLocale(command).result,
    languageCommand,
  );
  expect(restoredLanguage.ok).toBe(true);
  expect(
    await page.evaluate(
      (command) => window.ohtia.foundation.replaceLocale(command).result,
      languageCommand,
    ),
  ).toEqual(restoredLanguage);
  expect(
    await page.evaluate(
      (id) => window.ohtia.foundation.readLocaleReceipt(id).result,
      localeOperationId,
    ),
  ).toEqual({ ok: true, value: { state: "recorded", outcome: restoredLanguage } });
  const staleLanguage = await page.evaluate(
    (command) => window.ohtia.foundation.replaceLocale(command).result,
    { ...languageCommand, operationId: randomUUID() },
  );
  expect(staleLanguage).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  await expect(page.locator("html")).toHaveAttribute("lang", initialLanguage.value.effectiveLocale);
  await expect(second.locator("html")).toHaveAttribute(
    "lang",
    initialLanguage.value.effectiveLocale,
  );
  expect(
    await page.evaluate(() => ({
      same: window.__localeInput === document.getElementById("locale-preservation-fixture"),
      value: window.__localeInput.value,
      focused: document.activeElement === window.__localeInput,
    })),
  ).toEqual({ same: true, value: "Synthetic researcher draft 연구 초안", focused: true });
  const languageTree = await page.locator("body").ariaSnapshot();
  expect(languageTree).toContain(
    message(initialLanguage.value.effectiveLocale, "settings.language.title"),
  );
  await page.locator("#locale-preservation-fixture").evaluate((element) => element.remove());
  record("graphical-persisted-locale", {
    locales: [...supportedLocales],
    widths: [320, 600, 1024, 1280],
    restoredLanguage,
    staleLanguage,
    tree: languageTree,
    inputFixture: "synthetic textarea, not project-switch qualification",
    pseudolocalization: "separate synthetic layout clone with at least 40 percent text expansion",
  });
  // Leave a draft in the first window, then replace the utility. The document and input must survive.
  await control.selectOption("system");
  await page.evaluate(() => {
    window.__storageDocumentMarker = "retained";
  });
  const processes = await application.evaluate(({ app }) => app.getAppMetrics());
  const services = processes.filter(
    (value) => value.type === "Utility" && value.name === "Ohtia data service",
  );
  expect(services).toHaveLength(1);
  process.kill(services[0].pid, "SIGKILL");
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok)
    .toBe(false);
  await page.evaluate(() => window.ohtia.bootstrap.retryService());
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).value?.engine,
      { timeout: 20000 },
    )
    .toBe("verified");
  expect(await page.evaluate(() => window.__storageDocumentMarker)).toBe("retained");
  await expect(control).toHaveValue("system");
  await language.selectOption("es-AR");
  await expect(second.locator("html")).toHaveAttribute("lang", "es-AR");
  await language.selectOption(initialLanguage.value.record.value);
  await expect(page.locator("html")).toHaveAttribute("lang", initialLanguage.value.effectiveLocale);
  await expect(second.locator("html")).toHaveAttribute(
    "lang",
    initialLanguage.value.effectiveLocale,
  );
  record("utility-retry-preserves-input-and-document", {
    retainedValue: "system",
    processes,
    localePropagationAfterReplacement: true,
  });
  await expect(page.locator("#location-state")).toHaveText(text("storage_ready"));
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await control.focus();
  await expect(control).toBeFocused();
  const tree = await page.locator("body").ariaSnapshot();
  expect(tree).toContain("combobox");
  expect(tree).toContain("button");
  await page.screenshot({ path: path.join(output, "storage-320.png"), fullPage: true });
  record("keyboard-reflow-accessibility", { tree });
  const cases = await component("cases", path.join(output, "components"));
  expect(cases.code).toBe(0);
  const complete = cases.messages.find((value) => value.kind === "complete");
  expect(complete).toBeDefined();
  expect(complete.results.every((value) => value.result === "pass")).toBe(true);
  expect(complete.results.map((value) => value.id).sort()).toEqual(
    [...inventory.component_cases].sort(),
  );
  record("packaged-native-storage-cases", complete);
  for (const boundary of inventory.interruption_points) {
    const directory = path.join(output, `interruption-${boundary}`);
    const interrupted = await component(`interrupt-${boundary}`, directory, true);
    expect(interrupted.paused).toBe(true);
    const inspected = await component(`inspect-${boundary}`, directory);
    expect(inspected.code).toBe(0);
    expect(inspected.messages.some((value) => value.kind === "complete")).toBe(true);
    record(`process-interruption-${boundary}`, { interrupted, inspected });
  }
  const finalLanguage = await page.evaluate(() => window.ohtia.foundation.readLocale().result);
  const final = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  const checkpointRoot = path.join(launch.profile.research_root, "recovery/migrations");
  const priorCheckpoints = fs.readdirSync(checkpointRoot).sort();
  const settings = path.join(launch.profile.configuration_root, "Ohtia", "settings");
  const locatorFiles = () => fs.readdirSync(settings).sort();
  const priorLocatorFiles = locatorFiles();
  await application.close();
  application = undefined;
  verifyStableSentinels(launch.profile);
  page = await start();
  await open(page);
  expect(await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).toEqual(final);
  expect(fs.readdirSync(checkpointRoot).sort()).toEqual(priorCheckpoints);
  expect(locatorFiles()).toEqual(priorLocatorFiles);
  const restartedLanguage = await page.evaluate(() => window.ohtia.foundation.readLocale().result);
  expect(restartedLanguage).toMatchObject({
    ok: true,
    value: {
      record: finalLanguage.value.record,
      systemLocale: finalLanguage.value.systemLocale,
      effectiveLocale: finalLanguage.value.effectiveLocale,
    },
  });
  expect(restartedLanguage.value.serviceGeneration).not.toBe(finalLanguage.value.serviceGeneration);
  record("application-restart-and-current-no-checkpoint", {
    final,
    finalLanguage,
    locatorRepublished: false,
  });
  await application.close();
  application = undefined;
  verifyStableSentinels(launch.profile);
  const locatorFile = path.join(settings, "data-location.json");
  const locatorBytes = fs.readFileSync(locatorFile);
  for (const corrected of ["located", "pending_create"]) {
    fs.writeFileSync(locatorFile, "{");
    page = await start();
    expect((await page.evaluate(() => window.ohtia.bootstrap.read())).state).toBe(
      "locator_invalid",
    );
    if (corrected === "located") fs.writeFileSync(locatorFile, locatorBytes);
    else fs.unlinkSync(locatorFile);
    const snapshot = await page.evaluate(() => window.ohtia.bootstrap.read());
    await page
      .getByRole("button", { name: message(snapshot.locale, "retry"), exact: true })
      .last()
      .click();
    await expect
      .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state)
      .toBe(corrected);
    await open(page);
    expect(await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).toEqual(
      final,
    );
    await application.close();
    application = undefined;
  }
  record("locator-repair-without-application-restart", {
    correctedStates: ["located", "pending_create"],
    previousValuePreserved: true,
  });
  // Remove only this test profile's synthetic database while every product connection is closed.
  const databaseFile = path.join(launch.profile.research_root, "ohtia.db3");
  const retainedDatabase = databaseFile + ".acceptance-retained";
  fs.renameSync(databaseFile, retainedDatabase);
  try {
    page = await start();
    await open(page, "storage_failed");
    expect(fs.existsSync(databaseFile)).toBe(false);
    expect((await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).ok).toBe(
      false,
    );
    await application.close();
    application = undefined;
  } finally {
    if (application) {
      await application.close();
      application = undefined;
    }
    expect(fs.existsSync(databaseFile)).toBe(false);
    fs.linkSync(retainedDatabase, databaseFile);
    fs.unlinkSync(retainedDatabase);
  }
  record("missing-located-database-blocked", {
    replacementCreated: false,
    retainedOriginalRestored: true,
  });
  // Synthetic unresolved-upgrade input is installed only while all product connections are closed.
  const operation = priorCheckpoints.find((name) => /^[0-9a-f-]{36}$/.test(name));
  const checkpointManifest = JSON.parse(
    fs.readFileSync(path.join(checkpointRoot, operation, "manifest.json")),
  );
  const gate = path.join(launch.profile.research_root, "migration-pending.json");
  const intent = {
    version: 1,
    operation,
    source: checkpointManifest.sourceRevision,
    target: checkpointManifest.targetRevision,
  };
  fs.writeFileSync(gate, JSON.stringify(intent), { flag: "wx", mode: 0o600 });
  page = await start();
  const recoveryLocale = await open(page, "recovery_required");
  await expect(page.locator("#location-state")).toBeFocused();
  await page
    .getByRole("button", { name: message(recoveryLocale, "retry"), exact: true })
    .last()
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: 20000,
    })
    .toBe("storage_ready");
  expect(await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).toEqual(final);
  record("graphical-recovery-retry", {
    priorTargetPreserved: true,
    fixture: "synthetic unresolved intent bound to the verified checkpoint",
  });
  await application.close();
  application = undefined;
  fs.writeFileSync(gate, JSON.stringify(intent), { flag: "wx", mode: 0o600 });
  page = await start();
  await open(page, "recovery_required");
  await page
    .getByRole("button", { name: message(recoveryLocale, "restore_checkpoint"), exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: 20000,
    })
    .toBe("checkpoint_restored");
  expect((await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).ok).toBe(
    false,
  );
  const retained = fs.readdirSync(checkpointRoot).filter((name) => name.includes(".failed-"));
  expect(retained.length).toBeGreaterThan(0);
  await holdNextStorageNotice();
  await page
    .getByRole("button", { name: message(recoveryLocale, "retry"), exact: true })
    .last()
    .click();
  await expect
    .poll(() => application.evaluate(() => typeof globalThis.__releaseStorageNotice === "function"))
    .toBe(true);
  const interruptedPid = await application.evaluate(() => globalThis.__heldStoragePid);
  process.kill(interruptedPid, "SIGKILL");
  await application.evaluate(() => {
    delete globalThis.__releaseStorageNotice;
    delete globalThis.__heldStoragePid;
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state)
    .toBe("checkpoint_restored");
  expect((await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).ok).toBe(
    false,
  );
  await expect(
    page.getByRole("button", { name: message(recoveryLocale, "restore_checkpoint"), exact: true }),
  ).toHaveCount(0);
  record("admission-crash-preserves-recovery-phase", {
    actualTerminatedPid: interruptedPid,
    retainedPhase: "checkpoint_restored",
    normalStorageAdmitted: false,
    boundary: "real child terminated before its held storage outcome reached main",
  });
  await page
    .getByRole("button", { name: message(recoveryLocale, "retry"), exact: true })
    .last()
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.bootstrap.read())).state, {
      timeout: 20000,
    })
    .toBe("storage_ready");
  const restored = await page.evaluate(() => window.ohtia.foundation.readAppearance().result);
  expect(restored).toMatchObject({
    ok: true,
    value: { revision: 0, value: "system", source: "default" },
  });
  await expect(page.locator("#location-state")).toBeFocused();
  const restoredLocaleControl = page.locator('select[aria-describedby="language-help"]');
  await restoredLocaleControl.selectOption("ko-KR");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ohtia.foundation.readLocale().result)).value?.record
          .value,
    )
    .toBe("ko-KR");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.screenshot({ path: path.join(output, "locale-ko-320.png"), fullPage: true });
  record("graphical-checkpoint-restoration", {
    restored,
    sourceRevision: checkpointManifest.sourceRevision,
  });
  await application.close();
  application = undefined;
  verifyStableSentinels(launch.profile);
  record("bounded-clean-shutdown", { stableSentinelsUnchanged: true });
  expect(receipt.cases.map((row) => row.id).sort()).toEqual(
    [
      ...inventory.graphical_cases,
      ...inventory.interruption_points.map((point) => `process-interruption-${point}`),
    ].sort(),
  );
} catch (error) {
  receipt.cases.push({ id: "run", result: "fail", error: String(error) });
  process.exitCode = 1;
} finally {
  if (application)
    await application.close().catch(() => {
      process.exitCode = 1;
    });
  fs.writeFileSync(
    path.join(output, "storage-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
}
