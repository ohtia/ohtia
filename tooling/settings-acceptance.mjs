/* global clearTimeout */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { focusNative, withCommandCleanup } from "./command-native-focus.mjs";
import { invokeNativeMenu } from "./command-acceptance.mjs";
import { message } from "../packages/contracts/dist/index.js";
import { withNativeFailureObservation } from "./native-failure-observation.mjs";

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
/** macOS has no Chromium zoom-changed route; observe the real Cmd+wheel DOM delivery. */
export async function nativeCommandWheel(page, nativeWindow, deltaY, observeFailure) {
  await focusNative(nativeWindow, "Settings Cmd+wheel input");
  const observation = await page.evaluateHandle(() => {
    let timer;
    let observe;
    const dispose = () => {
      clearTimeout(timer);
      window.removeEventListener("wheel", observe);
    };
    const promise = new Promise((resolve, reject) => {
      observe = (event) => {
        if (event.deltaY === 0) return;
        dispose();
        if (
          !event.isTrusted ||
          !event.metaKey ||
          event.ctrlKey ||
          (event.cancelable && !event.defaultPrevented) ||
          event.momentum !== false ||
          !Number.isFinite(event.wheelDeltaY) ||
          event.wheelDeltaY === 0
        )
          reject(new Error("Settings Cmd+wheel was not intercepted with native tick evidence."));
        else
          resolve({
            direction: event.wheelDeltaY > 0 ? "in" : "out",
            source: "Electron sendInputEvent / trusted DOM wheel",
            cancelable: event.cancelable,
            defaultPrevented: event.defaultPrevented,
            momentum: event.momentum,
            wheelDeltaY: event.wheelDeltaY,
          });
      };
      window.addEventListener("wheel", observe);
      timer = setTimeout(() => {
        dispose();
        reject(new Error("Settings Cmd+wheel input was not observed."));
      }, 5000);
    });
    // Preserve the rejection for the consumer even if native injection itself fails.
    promise.catch(() => {});
    return { promise, dispose };
  });
  return withCommandCleanup(
    () =>
      observeFailure(async () => {
        await nativeWindow.evaluate((window, deltaY) => {
          window.webContents.sendInputEvent({
            type: "mouseWheel",
            x: 100,
            y: 100,
            deltaY,
            deltaX: 0,
            wheelTicksY: Math.sign(deltaY),
            modifiers: ["meta"],
            canScroll: true,
          });
        }, deltaY);
        return observation.evaluate((state) => state.promise);
      }),
    () =>
      withCommandCleanup(
        () =>
          observeFailure(() => observation.evaluate((state) => state.dispose()), {
            phase: "cleanup-native-command-wheel-listener",
          }),
        () =>
          observeFailure(() => observation.dispose(), {
            phase: "cleanup-native-command-wheel-handle",
          }),
      ),
  );
}
async function nativeZoomWheel(page, nativeWindow, platform, deltaY, observeFailure) {
  if (platform === "darwin") return nativeCommandWheel(page, nativeWindow, deltaY, observeFailure);

  await focusNative(nativeWindow, "Settings Ctrl+wheel input");
  const direction = await nativeWindow.evaluate(
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
  return { direction, source: "Electron zoom-changed" };
}
/** Preserve the gesture or metrics failure before independent CDP detachment. */
export async function verifyNativePinch(page, phase, observeFailure, expectFactors) {
  phase("pinch-session");
  const cdp = await page.context().newCDPSession(page);
  return withCommandCleanup(
    () =>
      observeFailure(async () => {
        phase("pinch-baseline");
        const before = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
        phase("pinch-gesture");
        await cdp.send("Input.synthesizePinchGesture", {
          x: 100,
          y: 100,
          scaleFactor: 1.5,
          gestureSourceType: "touch",
        });
        phase("pinch-layout-metrics");
        const metrics = await cdp.send("Page.getLayoutMetrics");
        expect((metrics.cssVisualViewport ?? metrics.visualViewport).scale).toBe(1);
        await expectFactors(100);
        phase("pinch-preserves-interface-zoom");
        expect(
          (await page.evaluate(() => window.ohtia.foundation.readPresentation().result)).value.zoom,
        ).toEqual(before.value.zoom);
      }),
    () =>
      observeFailure(async () => {
        phase("pinch-detach");
        await cdp.detach();
      }),
  );
}

/** Run only inside the storage harness's admitted independent native profile. */
export async function verifyPackagedSettings(application, page, second, output, publishFailure) {
  const phases = [];
  const current = { phase: "settings-initialization", selector: null };
  const observeFailure = (operation, overrides = {}) =>
    withNativeFailureObservation(
      application,
      () => ({ ...current, ...overrides }),
      operation,
      publishFailure,
    );
  return observeFailure(() =>
    verifySettings(application, page, second, output, phases, observeFailure, current),
  );
}

async function verifySettings(application, page, second, output, phases, observeFailure, current) {
  const progressFile = path.join(output, "settings-progress.json");
  const phase = (name, selector = null) => {
    current.phase = name;
    current.selector = selector;
    phases.push(name);
    // Publish a complete checkpoint before an awaited native operation can stall.
    const temporary = `${progressFile}.partial`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, phases }, null, 2) + "\n");
    fs.renameSync(temporary, progressFile);
    console.log(`Settings acceptance phase: ${name}`);
  };
  phase("read-initial-state");
  expect(
    page.viewportSize(),
    "Native Settings checks must not inherit viewport emulation.",
  ).toBeNull();
  const locale = (await page.evaluate(() => window.ohtia.bootstrap.read())).locale;
  const text = (key) => message(locale, key);
  const before = await page.evaluate(() => window.ohtia.foundation.readPresentation().result);
  expect(before.ok).toBe(true);
  const beforeLayout = await page.evaluate(() => window.ohtia.foundation.readLayout().result);
  expect(beforeLayout.ok).toBe(true);
  const dialog = page.getByRole("dialog", { name: text("settings.title"), exact: true });
  await expect(dialog).toBeVisible();
  phase("read-native-window");
  const nativeWindow = await application.browserWindow(page);
  const originalSize = await nativeWindow.evaluate((window) => window.getContentSize());
  const platform = await application.evaluate(() => process.platform);
  const inputs = [];
  const factors = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.webContents.getZoomFactor()),
    );
  const expectFactors = async (percent) => {
    phase(`zoom-${percent}-native-factors`);
    await expect(async () => {
      const observed = await factors();
      expect(observed).toHaveLength(2);
      for (const factor of observed)
        expect(
          Math.abs(factor - percent / 100),
          `Native zoom factor ${factor} must match ${percent / 100}.`,
        ).toBeLessThanOrEqual(0.000001);
    }).toPass({ timeout: 5000 });
    // Native factors can update before this window receives the mutation receipt.
    // Wait for the originating controller before sending another intent.
    phase(`zoom-${percent}-controller-receipt`, ".settings-dialog[open] .settings-zoom output");
    await expect(dialog.locator(".settings-zoom output")).toHaveText(
      new Intl.NumberFormat(locale, { style: "percent" }).format(percent / 100),
    );
    for (const [command, boundary] of [
      ["decrease", 75],
      ["increase", 400],
      ["reset", 100],
    ]) {
      const position = { decrease: 1, increase: 2, reset: 3 }[command];
      phase(
        `zoom-${percent}-${command}-availability`,
        `.settings-dialog[open] .settings-zoom-actions > button:nth-of-type(${position})`,
      );
      await expect(
        dialog.getByRole("button", { name: text(`command.zoom.${command}`), exact: true }),
      ).toHaveAttribute("aria-disabled", String(percent === boundary));
    }
  };
  const changeZoom = async (value) => {
    phase(`zoom-${value}-write`);
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
    () =>
      observeFailure(async () => {
        phase("native-settings-menu");
        await focusNative(nativeWindow, "Settings native menu");
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        // The preceding 320px locale check hides the originating explorer footer.
        await expect(page.locator(".workspace-skip")).toBeFocused();
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
        phase("native-settings-shortcut");
        inputs.push(await nativeKey(nativeWindow, platform, ",", "Comma"));
        await expect(dialog).toBeVisible();
        phase("hide-character", '.settings-dialog[open] input[type="radio"][value="hidden"]');
        await dialog.locator('input[type="radio"][value="hidden"]').check();
        await expect
          .poll(
            async () =>
              (await second.evaluate(() => window.ohtia.foundation.readPresentation().result)).value
                ?.character.value,
          )
          .toBe("hidden");
        await expect(dialog.locator(".settings-character-preview img")).toHaveCount(0);
        phase("second-window-about", '[data-workspace-command="about.open"]');
        await second.getByRole("button", { name: text("command.about.open"), exact: true }).click();
        // About uses the branded H1 as its accessible name, rather than the command label.
        const about = second.getByRole("dialog", { name: "Ohtia", exact: true });
        await expect(about).toBeVisible();
        await expect(about.locator(".about-character")).toHaveCount(0);
        phase("second-window-about-close", ".about-dialog[open] [data-close]");
        await about.locator("[data-close]").click();
        phase("static-character", '.settings-dialog[open] input[type="radio"][value="static"]');
        await dialog.locator('input[type="radio"][value="static"]').check();
        await expect(dialog.locator(".settings-character-preview img")).toHaveCSS("width", "96px");
        await changeZoom(100);
        for (const value of [110, 125]) {
          phase(
            `zoom-${value}-button`,
            ".settings-dialog[open] .settings-zoom-actions > button:nth-of-type(2)",
          );
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
        phase("focus-private-input-fixture", "#settings-input-preservation-fixture");
        await page.locator("#settings-input-preservation-fixture").focus();
        await page
          .locator("#settings-input-preservation-fixture")
          .evaluate((element) => element.setSelectionRange(10, 22));
        phase("native-zoom-equal");
        inputs.push(await nativeKey(nativeWindow, platform, "=", "Equal"));
        await expectFactors(110);
        phase("native-zoom-keypad-add");
        inputs.push(await nativeKey(nativeWindow, platform, "numadd", "NumpadAdd"));
        await expectFactors(125);
        phase("native-zoom-keypad-subtract");
        inputs.push(await nativeKey(nativeWindow, platform, "numsub", "NumpadSubtract"));
        await expectFactors(110);
        phase("native-zoom-minus");
        inputs.push(await nativeKey(nativeWindow, platform, "-", "Minus"));
        await expectFactors(100);
        phase("native-zoom-keypad-reset");
        inputs.push(await nativeKey(nativeWindow, platform, "num0", "Numpad0"));
        await expect(dialog).toContainText(text("command.reason.actual_size"));
        phase("native-zoom-reset");
        inputs.push(await nativeKey(nativeWindow, platform, "0", "Digit0"));
        phase("native-wheel-positive");
        const wheelIn = await nativeZoomWheel(page, nativeWindow, platform, 120, observeFailure);
        expect(["in", "out"]).toContain(wheelIn.direction);
        if (platform === "darwin") expect(wheelIn.direction).toBe("in");
        await expectFactors(wheelIn.direction === "in" ? 110 : 90);
        await changeZoom(100);
        phase("native-wheel-negative");
        const wheelOut = await nativeZoomWheel(page, nativeWindow, platform, -120, observeFailure);
        expect(wheelOut.direction).toBe(wheelIn.direction === "in" ? "out" : "in");
        await expectFactors(wheelOut.direction === "in" ? 110 : 90);
        await changeZoom(100);
        await verifyNativePinch(page, phase, observeFailure, expectFactors);
        await changeZoom(75);
        const minimum = await page.evaluate(
          () => window.ohtia.foundation.readPresentation().result,
        );
        phase("native-zoom-keypad-subtract");
        inputs.push(await nativeKey(nativeWindow, platform, "numsub", "NumpadSubtract"));
        await expect(dialog).toContainText(text("command.reason.zoom_minimum"));
        expect(
          (await page.evaluate(() => window.ohtia.foundation.readPresentation().result)).value.zoom,
        ).toEqual(minimum.value.zoom);
        await changeZoom(400);
        const maximum = await page.evaluate(
          () => window.ohtia.foundation.readPresentation().result,
        );
        phase("native-zoom-keypad-add");
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
        phase("native-zoom-menu");
        await invokeNativeMenu(application, "zoom.increase");
        await expectFactors(110);
        await expect
          .poll(() =>
            application.evaluate(
              ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("zoom.increase")?.enabled,
            ),
          )
          .toBe(true);
        phase("native-zoom-menu");
        await invokeNativeMenu(application, "zoom.increase");
        await expectFactors(125);
        const afterSteps = await page.evaluate(
          () => window.ohtia.foundation.readPresentation().result,
        );
        expect(afterSteps.value.zoom.value).toBe(125);
        phase("native-reflow-resize");
        await nativeWindow.evaluate((window) => window.setContentSize(1280, 600));
        await changeZoom(400);
        await expect
          .poll(async () => [
            ...(await nativeWindow.evaluate((window) => window.getContentSize())),
            ...(await page.evaluate(() => [window.innerWidth, window.innerHeight])),
          ])
          .toEqual([1280, 600, 320, 150]);
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
        phase("native-reflow-screenshot", ".settings-dialog[open]");
        await page.screenshot({ path: path.join(output, "settings-400-percent.png") });
        await expect(page.locator("#settings-input-preservation-fixture")).toBeFocused();
        expect(
          await page
            .locator("#settings-input-preservation-fixture")
            .evaluate((element) => [element.selectionStart, element.selectionEnd]),
        ).toEqual([10, 22]);
        phase(
          "reset-zoom-button",
          ".settings-dialog[open] .settings-zoom-actions > button:nth-of-type(3)",
        );
        await dialog.getByRole("button", { name: text("command.zoom.reset"), exact: true }).click();
        await expectFactors(100);
        phase("final-preferences");
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
            "native-primary-modifier-wheel-command",
            "chromium-synthetic-pinch-does-not-change-visual-or-interface-zoom",
            "character-publication-and-hidden-about",
            "admitted-zoom-100-110-125",
            "confirmed-multiwindow-factor",
            "native-400-percent-reflow",
            "actual-size-restores-100",
          ],
          before,
          inputs,
          wheels: [wheelIn, wheelOut],
          afterSteps,
          final,
          reflow,
          limitations: [
            "Automated native DOM/factor checks do not establish physical keyboard layouts, native OS IME composition or manual assistive conformance.",
            "Electron synthetic wheel events can be non-cancelable; their receipts do not establish physical scroll cancellation or hardware notch counts.",
          ],
        };
      }),
    () =>
      observeFailure(async () => {
        phase("cleanup-remove-input");
        await page.evaluate(() =>
          document.getElementById("settings-input-preservation-fixture")?.remove(),
        );
        phase("cleanup-read-presentation");
        const confirmedPresentation = await page.evaluate(
          () => window.ohtia.foundation.readPresentation().result,
        );
        if (confirmedPresentation.ok) {
          phase("cleanup-restore-character");
          await page.evaluate(
            async ({ value, revision, operationId }) =>
              window.ohtia.foundation.replaceCharacter({
                operationId,
                expectedRevision: revision,
                value,
              }).result,
            {
              value: before.value.character.value,
              revision: confirmedPresentation.value.character.revision,
              operationId: randomUUID(),
            },
          );
          await changeZoom(before.value.zoom.value);
        }
        phase("cleanup-restore-window");
        await nativeWindow.evaluate((window, size) => window.setContentSize(...size), originalSize);
        phase("cleanup-dispose-window");
        await nativeWindow.dispose();
        phase("cleanup-complete");
      }),
  );
}
