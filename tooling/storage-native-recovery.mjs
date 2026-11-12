/* global window */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { withCommandCleanup } from "./command-native-focus.mjs";

/** Preserve the failed native context and receipt before restoring this synthetic fixture. */
export async function verifyMissingLocatedDatabase(
  databaseFile,
  { start, open, close, enterPhase, observeFailure },
) {
  const retainedDatabase = databaseFile + ".acceptance-retained";
  fs.renameSync(databaseFile, retainedDatabase);
  await withCommandCleanup(
    () =>
      observeFailure(async () => {
        const page = await start();
        await open(page, "storage_failed");
        enterPhase("assert-missing-database-remains-blocked", "#location-state");
        expect(fs.existsSync(databaseFile)).toBe(false);
        expect(
          (await page.evaluate(() => window.ohtia.foundation.readAppearance().result)).ok,
        ).toBe(false);
        enterPhase("close-missing-database-application");
        await close();
      }),
    () =>
      observeFailure(async () => {
        enterPhase("restore-missing-database-fixture");
        await close();
        expect(fs.existsSync(databaseFile)).toBe(false);
        fs.linkSync(retainedDatabase, databaseFile);
        fs.unlinkSync(retainedDatabase);
      }),
  );
  return { replacementCreated: false, retainedOriginalRestored: true };
}

/** Observe both locale owners on the replacement before admitting the selector exercise. */
export async function waitForReplacedLocalePublication(
  page,
  second,
  previousGeneration,
  recordPublication,
) {
  // Keep the existing 20-second recovery budget; engine readiness alone cannot admit writes.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const status = await window.ohtia.foundation.readStatus().result;
          const bootstrap = await window.ohtia.bootstrap.read();
          return { engine: status.value?.engine, state: bootstrap.state };
        }),
      { timeout: 20000 },
    )
    .toEqual({ engine: "verified", state: "storage_ready" });
  const current = await page.evaluate(() => window.ohtia.foundation.readLocale().result);
  expect(current, `Recovered locale read failed: ${JSON.stringify(current)}`).toMatchObject({
    ok: true,
  });
  expect(current.value.serviceGeneration).not.toBe(previousGeneration);
  // A different value makes the subscription publication observable in each retained document.
  const choice = current.value.effectiveLocale === "ko-KR" ? "fr-FR" : "ko-KR";
  const saved = await page.evaluate(
    ({ operationId, expectedRevision, value, generation }) =>
      window.ohtia.foundation.replaceLocale({ operationId, expectedRevision, value }, generation)
        .result,
    {
      operationId: randomUUID(),
      expectedRevision: current.value.record.revision,
      value: choice,
      generation: current.value.serviceGeneration,
    },
  );
  expect(saved, `Recovery locale publication failed: ${JSON.stringify(saved)}`).toMatchObject({
    ok: true,
  });
  await expect(page.locator("html")).toHaveAttribute("lang", choice);
  await expect(second.locator("html")).toHaveAttribute("lang", choice);
  const observed = {
    serviceGeneration: current.value.serviceGeneration,
    choice,
    record: saved.value,
  };
  recordPublication(observed);
  return observed;
}
