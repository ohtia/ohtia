import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { diagnosticLimits, message } from "../packages/contracts/dist/index.js";
import { invokeNativeMenu } from "./command-acceptance.mjs";
import { focusNative, withCommandCleanup } from "./command-native-focus.mjs";
import { setNativeViewport } from "./design-viewport.mjs";

export async function verifyDiagnosticBundle(
  application,
  page,
  locale,
  activeRecord,
  directory,
  marker,
  output,
) {
  const archive = path.join(directory, "ohtia.4.jsonl");
  const active = path.join(directory, "ohtia.jsonl");
  const destination = path.join(output, "reviewed-diagnostics.json");
  const protectedFile = path.join(directory, "forbidden-bundle.json");
  const time = "2000-01-01T00:00:00.000Z";
  const correlation = randomUUID();
  const event = {
    ...activeRecord,
    observed_timestamp: time,
    attributes: { ...activeRecord.attributes, "ohtia.correlation.id": correlation },
  };
  const encoded = JSON.stringify(event) + "\n";
  const archiveFixture =
    encoded +
    JSON.stringify({ ...event, prompt: marker }) +
    "\n" +
    JSON.stringify({ schema_version: 2, response: marker }) +
    "\n";

  // Only the native chooser result is controlled. Use the shipped sender checks and filesystem write.
  const picker = await application.evaluateHandle(({ dialog }) => {
    const original = dialog.showSaveDialog;
    let pending;
    dialog.showSaveDialog = (parent, options) =>
      new Promise((resolve) => {
        pending = { parent: parent.id, options, resolve };
      });
    return {
      state: () => pending && { parent: pending.parent, options: pending.options },
      choose: (filePath) => {
        const { resolve } = pending;
        pending = undefined;
        resolve({ canceled: !filePath, filePath: filePath ?? "" });
      },
      restore: () => {
        dialog.showSaveDialog = original;
        pending?.resolve({ canceled: true, filePath: "" });
      },
    };
  });
  const choose = (file) => picker.evaluate((chooser, file) => chooser.choose(file), file);
  const window = await application.browserWindow(page);
  const text = (key, values = {}) => message(locale, key, values);
  const settings = page.getByRole("dialog", { name: text("settings.title"), exact: true });
  const section = settings.locator(".diagnostic-bundle");
  const status = section.getByRole("status");
  const launchPicker = async (button) => {
    await button.press("Enter");
    const parent = await window.evaluate((window) => window.id);
    await expect
      .poll(() => picker.evaluate((chooser) => chooser.state()))
      .toMatchObject({
        parent,
        options: { defaultPath: "ohtia-diagnostics.json" },
      });
  };
  let second;
  try {
    fs.writeFileSync(archive, archiveFixture, { flag: "wx", mode: 0o600 });
    const fixtureInode = fs.statSync(archive, { bigint: true }).ino;
    await focusNative(window, "reviewed diagnostic bundle");
    await invokeNativeMenu(application, "settings.open");
    await settings
      .getByRole("button", { name: text("diagnostics.title"), exact: true })
      .press("Enter");
    const trigger = section.getByRole("button", {
      name: text("diagnostics.bundle.title"),
      exact: true,
    });
    const preview = section.getByRole("button", {
      name: text("diagnostics.bundle.preview"),
      exact: true,
    });
    const save = section.getByRole("button", {
      name: text("diagnostics.bundle.save"),
      exact: true,
    });
    const json = section.getByRole("region", {
      name: text("diagnostics.bundle.preview"),
      exact: true,
    });
    await trigger.press("Enter");
    const slots = section.getByRole("checkbox");
    await expect(slots.first()).toBeFocused();
    for (let slot = 0; slot < 4; slot++) await slots.nth(slot).press("Space");
    await section.locator('input[name="from"]').fill(time.slice(0, 16));
    await section.locator('input[name="through"]').fill(time.slice(0, 16));
    assert.ok(await section.locator("form").evaluate((form) => form.checkValidity()));
    await preview.focus();
    await expect(preview).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(json).toBeFocused();
    await expect(status).toContainText(text("diagnostics.invalid", { count: 1 }));
    await expect(status).toContainText(text("diagnostics.unsupported", { count: 1 }));
    const original = await window.evaluate((window) => {
      const [width, height] = window.getContentSize();
      return {
        width,
        height,
        zoomFactor: window.webContents.getZoomFactor(),
        maximized: window.isMaximized(),
      };
    });
    const html = page.locator("html");
    const appearance = await html.getAttribute("data-appearance");
    await withCommandCleanup(
      async () => {
        const viewport = await setNativeViewport(page, window, {
          width: 1280,
          height: 800,
          zoomFactor: 4,
        });
        assert.equal(viewport.viewportWidth, 320);
        for (const [theme, forcedColors] of [
          ["light", "none"],
          ["dark", "none"],
          ["dark", "active"],
        ]) {
          await html.evaluate((root, theme) => root.setAttribute("data-appearance", theme), theme);
          await page.emulateMedia({ forcedColors });
          await expect(json).toBeVisible();
          await expect(save).toBeVisible();
          assert.ok(
            await settings
              .locator(".settings-content")
              .evaluate((element) => element.scrollWidth <= element.clientWidth),
          );
        }
      },
      async () => {
        await html.evaluate((root, appearance) => {
          if (appearance === null) root.removeAttribute("data-appearance");
          else root.setAttribute("data-appearance", appearance);
        }, appearance);
        await page.emulateMedia({ forcedColors: null });
        await setNativeViewport(page, window, original);
        if (original.maximized) await window.evaluate((window) => window.maximize());
      },
    );
    const approved = await json.textContent();
    assert.equal(JSON.parse(approved).records.length, 1);
    for (const omitted of [marker, correlation, directory]) assert.ok(!approved.includes(omitted));
    const originalSize = fs.statSync(active).size;
    fs.appendFileSync(active, "x".repeat(diagnosticLimits.fileBytes - originalSize - 1) + "\n");
    const appended = await page.evaluate(async () => {
      const read = await window.ohtia.foundation.readAppearance().result;
      if (!read.ok) return read;
      return window.ohtia.foundation.replaceAppearance({
        operationId: crypto.randomUUID(),
        expectedRevision: read.value.revision,
        value: read.value.value === "dark" ? "light" : "dark",
      }).result;
    });
    assert.equal(appended.ok, true);
    await expect
      .poll(() => fs.statSync(archive, { bigint: true, throwIfNoEntry: false })?.ino)
      .not.toBe(fixtureInode);
    fs.writeFileSync(destination, "previous");
    await launchPicker(save);
    await choose(destination);
    await expect(status).toContainText(text("diagnostics.bundle.saved"));
    assert.deepEqual(fs.readFileSync(destination), Buffer.from(approved));
    await preview.press("Escape");
    await expect(trigger).toBeFocused();

    const id = randomUUID();
    const replacement = randomUUID();
    const read = (page, request) =>
      page.evaluate((request) => window.ohtia.diagnostics.bundle(request), request);
    const select = { action: "prepare", id, from: time, through: time, slots: 16 };
    const prepared = await read(page, select);
    assert.equal(prepared.status, "preview");
    const opening = application.waitForEvent("window");
    await page.evaluate(() => window.ohtia.bootstrap.newWindow());
    second = await opening;
    await second.waitForFunction(() => !!window.ohtia?.diagnostics);
    assert.deepEqual(await read(second, { action: "save", token: prepared.token }), {
      status: "stale",
    });
    assert.equal(await picker.evaluate((chooser) => chooser.state()), undefined);
    await (await application.browserWindow(second)).evaluate((window) => window.close());
    second = undefined;

    const saving = read(page, { action: "save", token: prepared.token });
    await expect.poll(() => picker.evaluate((chooser) => chooser.state())).toBeTruthy();
    const next = await read(page, { ...select, id: replacement });
    assert.equal(next.status, "preview");
    await choose(destination);
    assert.deepEqual(await saving, { status: "stale" });
    assert.deepEqual(fs.readFileSync(destination), Buffer.from(approved));

    const cancelling = read(page, { action: "save", token: next.token });
    await expect.poll(() => picker.evaluate((chooser) => chooser.state())).toBeTruthy();
    await choose(undefined);
    assert.deepEqual(await cancelling, { status: "cancelled" });
    assert.deepEqual(await read(page, { action: "save", token: next.token }), { status: "stale" });

    const renewed = await read(page, select);
    assert.equal(renewed.status, "preview");
    const refusing = read(page, { action: "save", token: renewed.token });
    await expect.poll(() => picker.evaluate((chooser) => chooser.state())).toBeTruthy();
    await choose(protectedFile);
    assert.deepEqual(await refusing, { status: "unavailable" });
    assert.ok(!fs.existsSync(protectedFile));
  } finally {
    if (second)
      await (await application.browserWindow(second)).evaluate((window) => window.close());
    await picker.evaluate((chooser) => chooser.restore());
    await picker.dispose();
    if (
      fs.statSync(archive, { throwIfNoEntry: false })?.size === Buffer.byteLength(archiveFixture) &&
      fs.readFileSync(archive, "utf8") === archiveFixture
    )
      fs.unlinkSync(archive);
    if (await settings.isVisible()) await page.keyboard.press("Escape");
  }
}
