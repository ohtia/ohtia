/* global clearTimeout */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { focusNative, withCommandCleanup } from "./command-native-focus.mjs";
import { invokeNativeMenu } from "./command-acceptance.mjs";
import { message } from "../packages/contracts/dist/index.js";

/** Observe the actual browser-side input boundary; DevTools key events bypass it. */
async function nativeKey(nativeWindow, platform, keyCode, expectedCode) {
  await focusNative(nativeWindow, "Settings keyboard input");
  return nativeWindow.evaluate(
    (window, { platform, keyCode, expectedCode }) =>
      new Promise((resolve, reject) => {
        const contents = window.webContents;
        let timer;
        const finish = (error, value) => {
          clearTimeout(timer);
          contents.removeListener("before-input-event", observe);
          if (error) reject(error);
          else resolve(value);
        };
        const observe = (event, input) => {
          if (input.type !== "keyDown") return;
          const value = {
            key: input.key,
            code: input.code,
            control: input.control,
            meta: input.meta,
            prevented: event.defaultPrevented,
          };
          if (
            input.code !== expectedCode ||
            !event.defaultPrevented ||
            input.isComposing ||
            input.alt ||
            input.control !== (platform !== "darwin") ||
            input.meta !== (platform === "darwin")
          )
            finish(new Error(`Settings shortcut was not intercepted: ${JSON.stringify(value)}`));
          else finish(undefined, value);
        };
        contents.on("before-input-event", observe);
        timer = setTimeout(
          () => finish(new Error("Settings shortcut input was not observed.")),
          5000,
        );
        try {
          const modifiers = [
            platform === "darwin" ? "meta" : "control",
            ...(keyCode.startsWith("num") ? ["iskeypad"] : []),
          ];
          contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
          contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
        } catch (error) {
          finish(error);
        }
      }),
    { platform, keyCode, expectedCode },
  );
}
async function nativeControlWheel(nativeWindow, deltaY) {
  await focusNative(nativeWindow, "Settings Ctrl+wheel input");
  return nativeWindow.evaluate(
    (window, deltaY) =>
      new Promise((resolve, reject) => {
        const contents = window.webContents;
        const finish = (error, direction) => {
          clearTimeout(timer);
          contents.removeListener("zoom-changed", observe);
          if (error) reject(error);
          else resolve(direction);
        };
        const observe = (_event, direction) => finish(undefined, direction);
        const timer = setTimeout(
          () => finish(new Error("Ctrl+wheel did not produce zoom-changed.")),
          5000,
        );
        contents.on("zoom-changed", observe);
        try {
          contents.sendInputEvent({
            type: "mouseWheel",
            x: 100,
            y: 100,
            deltaY,
            deltaX: 0,
            wheelTicksY: Math.sign(deltaY),
            modifiers: ["control"],
            canScroll: true,
          });
        } catch (error) {
          finish(error);
        }
      }),
    deltaY,
  );
}
/** Run only inside the storage harness's admitted independent native profile. */
export async function verifyPackagedSettings(application, page, second, output) {
  const locale = (await page.evaluate(() => window.ohtia.bootstrap.read())).locale;
  const text = (key) => message(locale, key);
  const before = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
  expect(before.ok).toBe(true);
  const beforeLayout = await page.evaluate(() => window.ohtia.foundation.readLayout().result);
  expect(beforeLayout.ok).toBe(true);
  const dialog = page.getByRole("dialog", { name: text("settings.title"), exact: true });
  await expect(dialog).toBeVisible();
  const nativeWindow = await application.browserWindow(page);
  const originalSize = await nativeWindow.evaluate((window) => window.getContentSize());
  const platform = await application.evaluate(() => process.platform);
  const inputs = [];
  const factors = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.webContents.getZoomFactor()),
    );
  const expectFactors = async (percent) => {
    await expect(async () => {
      const observed = await factors();
      expect(observed).toHaveLength(2);
      for (const factor of observed)
        expect(
          Math.abs(factor - percent / 100),
          `Native zoom factor ${factor} must match ${percent / 100}.`,
        ).toBeLessThanOrEqual(0.000001);
    }).toPass({ timeout: 5000 });
  };
  const changeZoom = async (value) => {
    const result = await page.evaluate(
      async ({ value, operationId }) => {
        const current = await window.ohtia.foundation.readPresentation().result;
        if (!current.ok) throw new Error("Presentation preference is unavailable.");
        return window.ohtia.foundation.replaceZoom(
          { operationId, expectedRevision: current.value.zoom.revision, value },
          current.value.serviceGeneration,
        ).result;
      },
      { value, operationId: randomUUID() },
    );
    expect(result.ok).toBe(true);
    await expectFactors(value);
    return result;
  };
  return withCommandCleanup(
    async () => {
      await focusNative(nativeWindow, "Settings native menu");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: text("command.settings.open"), exact: true }),
      ).toBeFocused();
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.enabled,
          ),
        )
        .toBe(true);
      await invokeNativeMenu(application, "settings.open");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      inputs.push(await nativeKey(nativeWindow, platform, ",", "Comma"));
      await expect(dialog).toBeVisible();
      await dialog.locator('input[type="radio"][value="hidden"]').check();
      await expect
        .poll(
          async () =>
            (await second.evaluate(() => window.ohtia.foundation.readPresentation().result)).value
              ?.character.value,
        )
        .toBe("hidden");
      await expect(dialog.locator(".settings-character-preview img")).toHaveCount(0);
      await second.getByRole("button", { name: text("command.about.open"), exact: true }).click();
      // About uses the branded H1 as its accessible name, rather than the command label.
      const about = second.getByRole("dialog", { name: "Ohtia", exact: true });
      await expect(about).toBeVisible();
      await expect(about.locator(".about-character")).toHaveCount(0);
      await about.locator("[data-close]").click();
      await dialog.locator('input[type="radio"][value="static"]').check();
      await expect(dialog.locator(".settings-character-preview img")).toHaveCSS("width", "96px");
      await changeZoom(100);
      for (const value of [110, 125]) {
        await dialog
          .getByRole("button", { name: text("command.zoom.increase"), exact: true })
          .click();
        await expectFactors(value);
      }
      await changeZoom(100);
      await page.evaluate(() => {
        const draft = document.createElement("textarea");
        draft.id = "settings-input-preservation-fixture";
        draft.value = "Synthetic private draft 연구 초안";
        document.querySelector(".settings-content").append(draft);
      });
      await page.locator("#settings-input-preservation-fixture").focus();
      await page
        .locator("#settings-input-preservation-fixture")
        .evaluate((element) => element.setSelectionRange(10, 22));
      inputs.push(await nativeKey(nativeWindow, platform, "=", "Equal"));
      await expectFactors(110);
      inputs.push(await nativeKey(nativeWindow, platform, "numadd", "NumpadAdd"));
      await expectFactors(125);
      inputs.push(await nativeKey(nativeWindow, platform, "numsub", "NumpadSubtract"));
      await expectFactors(110);
      inputs.push(await nativeKey(nativeWindow, platform, "-", "Minus"));
      await expectFactors(100);
      inputs.push(await nativeKey(nativeWindow, platform, "num0", "Numpad0"));
      await expect(dialog).toContainText(text("command.reason.actual_size"));
      inputs.push(await nativeKey(nativeWindow, platform, "0", "Digit0"));
      const wheelIn = await nativeControlWheel(nativeWindow, 120);
      expect(["in", "out"]).toContain(wheelIn);
      await expectFactors(wheelIn === "in" ? 110 : 90);
      await changeZoom(100);
      const wheelOut = await nativeControlWheel(nativeWindow, -120);
      expect(wheelOut).toBe(wheelIn === "in" ? "out" : "in");
      await expectFactors(wheelOut === "in" ? 110 : 90);
      await changeZoom(100);
      const beforePinch = await page.evaluate(
        () => window.ohtia.foundation.readPresentation().result,
      );
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send("Input.synthesizePinchGesture", {
          x: 100,
          y: 100,
          scaleFactor: 1.5,
          gestureSourceType: "touch",
        });
        const metrics = await cdp.send("Page.getLayoutMetrics");
        expect((metrics.cssVisualViewport ?? metrics.visualViewport).scale).toBe(1);
        await expectFactors(100);
        expect(
          (await page.evaluate(() => window.ohtia.foundation.readPresentation().result)).value.zoom,
        ).toEqual(beforePinch.value.zoom);
      } finally {
        await cdp.detach();
      }
      await changeZoom(75);
      const minimum = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
      inputs.push(await nativeKey(nativeWindow, platform, "numsub", "NumpadSubtract"));
      await expect(dialog).toContainText(text("command.reason.zoom_minimum"));
      expect(
        (await page.evaluate(() => window.ohtia.foundation.readPresentation().result)).value.zoom,
      ).toEqual(minimum.value.zoom);
      await changeZoom(400);
      const maximum = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
      inputs.push(await nativeKey(nativeWindow, platform, "numadd", "NumpadAdd"));
      await expect(dialog).toContainText(text("command.reason.zoom_maximum"));
      expect(
        (await page.evaluate(() => window.ohtia.foundation.readPresentation().result)).value.zoom,
      ).toEqual(maximum.value.zoom);
      await changeZoom(100);
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("zoom.increase")?.enabled,
          ),
        )
        .toBe(true);
      await invokeNativeMenu(application, "zoom.increase");
      await expectFactors(110);
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("zoom.increase")?.enabled,
          ),
        )
        .toBe(true);
      await invokeNativeMenu(application, "zoom.increase");
      await expectFactors(125);
      const afterSteps = await page.evaluate(
        () => window.ohtia.foundation.readPresentation().result,
      );
      expect(afterSteps.value.zoom.value).toBe(125);
      await nativeWindow.evaluate((window) => window.setContentSize(1280, 800));
      await changeZoom(400);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(320);
      const reflow = await dialog.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        overflow: element.scrollWidth > element.clientWidth,
      }));
      expect(reflow.width).toBeLessThanOrEqual(reflow.viewportWidth - 32);
      expect(reflow.height).toBeLessThanOrEqual(reflow.viewportHeight - 32);
      expect(reflow.overflow).toBe(false);
      await page.screenshot({ path: path.join(output, "settings-400-percent.png") });
      await expect(page.locator("#settings-input-preservation-fixture")).toBeFocused();
      expect(
        await page
          .locator("#settings-input-preservation-fixture")
          .evaluate((element) => [element.selectionStart, element.selectionEnd]),
      ).toEqual([10, 22]);
      await dialog.getByRole("button", { name: text("command.zoom.reset"), exact: true }).click();
      await expectFactors(100);
      const final = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
      expect(final.value.appearance).toEqual(before.value.appearance);
      expect(await page.evaluate(() => window.ohtia.foundation.readLayout().result)).toEqual(
        beforeLayout,
      );
      await expect(page.locator("#settings-input-preservation-fixture")).toHaveValue(
        "Synthetic private draft 연구 초안",
      );
      return {
        cases: [
          "native-settings-dialog",
          "synthetic-private-input-survives-native-zoom",
          "passive-zoom-preserves-stored-layout",
          "native-menu-and-shortcut-settings-entry",
          "escape-closes-and-restores-entry",
          "native-primary-and-keypad-zoom-shortcuts",
          "native-zoom-menu-entries",
          "native-zoom-limit-unavailable-reasons",
          "native-control-wheel-command",
          "chromium-synthetic-pinch-does-not-change-visual-or-interface-zoom",
          "character-publication-and-hidden-about",
          "admitted-zoom-100-110-125",
          "confirmed-multiwindow-factor",
          "native-400-percent-reflow",
          "actual-size-restores-100",
        ],
        before,
        inputs,
        afterSteps,
        final,
        reflow,
        limitations: [
          "Automated native DOM/factor checks do not establish physical keyboard layouts, native OS IME composition or manual assistive conformance.",
        ],
      };
    },
    async () => {
      await page.evaluate(() =>
        document.getElementById("settings-input-preservation-fixture")?.remove(),
      );
      const current = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
      if (current.ok) {
        await page.evaluate(
          async ({ value, revision, operationId }) =>
            window.ohtia.foundation.replaceCharacter({
              operationId,
              expectedRevision: revision,
              value,
            }).result,
          {
            value: before.value.character.value,
            revision: current.value.character.revision,
            operationId: randomUUID(),
          },
        );
        await changeZoom(before.value.zoom.value);
      }
      await nativeWindow.evaluate((window, size) => window.setContentSize(...size), originalSize);
      await nativeWindow.dispose();
    },
  );
}
