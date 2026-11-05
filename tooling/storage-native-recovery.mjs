import fs from "node:fs";
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
