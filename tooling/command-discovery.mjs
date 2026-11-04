/* global document, innerWidth, getComputedStyle */
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { verifyCommandFocus } from "./command-presentation.mjs";

/** Real browser layout with synthetic platform/bridge inputs, separate from native qualification. */
export async function verifyCommandDiscovery(page, url, engine, output) {
  const { message, commandDefinitions, componentShortcutDefinitions, supportedLocales } =
    await import("../packages/contracts/dist/index.js");
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const { shortcutLabel } = await import("../packages/renderer/dist/command-discovery.js");
  const specimen = page.getByRole("region", { name: "Command surface specimens" });
  const trigger = (locale, surface) =>
    specimen
      .locator(".command-entry-actions")
      .getByRole("button", { name: message(locale, `command.${surface}.open`), exact: true });
  const measurements = [];
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Theme", { exact: true }).selectOption(theme);
    for (const locale of ["en-US", "de-DE", "fi-FI", "ko-KR"]) {
      await specimen.getByLabel("Command specimen language").selectOption(locale);
      for (const width of [320, 600, 1024, 1280]) {
        await page.setViewportSize({ width, height: 400 });
        for (const surface of ["palette", "shortcuts"]) {
          const origin = trigger(locale, surface);
          await origin.click();
          const dialog = page.locator(
            surface === "palette" ? ".command-palette[open]" : ".shortcuts-dialog[open]",
          );
          expect(
            await dialog
              .locator(".discovery-feedback")
              .evaluate((element) => element.getBoundingClientRect().height),
          ).toBe(0);
          const measurement = await dialog.evaluate((dialog) => {
            const rect = dialog.getBoundingClientRect();
            return {
              width: rect.width,
              top: rect.top,
              left: rect.left,
              right: rect.right,
              viewport: innerWidth,
              overflow: dialog.scrollWidth - dialog.clientWidth,
            };
          });
          expect(measurement.top).toBe(surface === "palette" ? 64 : 40);
          expect(measurement.left).toBeGreaterThanOrEqual(15);
          expect(measurement.right).toBeLessThanOrEqual(measurement.viewport - 15);
          expect(measurement.width).toBeLessThanOrEqual(surface === "palette" ? 600 : 480);
          expect(measurement.overflow).toBeLessThanOrEqual(1);
          if (surface === "palette")
            expect(
              await dialog.evaluate((dialog) =>
                Math.abs(
                  dialog.querySelector(".palette-footer").getBoundingClientRect().width -
                    dialog.clientWidth,
                ),
              ),
            ).toBeLessThanOrEqual(1);
          await verifyCommandFocus(dialog.locator("[data-close]"));
          if (surface === "palette") {
            const input = dialog.getByRole("combobox");
            await verifyCommandFocus(input);
            await input.fill("zzzzzz");
            await expect(dialog.getByRole("status")).toHaveText(
              message(locale, "palette.empty", { query: "zzzzzz" }),
            );
            await input.fill("");
            await expect(dialog.getByRole("option")).toHaveCount(commandDefinitions.length);
            // Component focus remains on the combobox while the active option scrolls.
            for (let index = 0; index < commandDefinitions.length; index++)
              await input.press("ArrowDown");
            await expect(input).toBeFocused();
          }
          await page.keyboard.press("Escape");
          await expect(origin).toBeFocused();
          measurements.push({ theme, locale, viewportWidth: width, surface, ...measurement });
        }
      }
    }
  }
  for (const height of [100, 200]) {
    await page.setViewportSize({ width: 320, height });
    await specimen.getByLabel("Command specimen language").selectOption("en-US");
    for (const surface of ["palette", "shortcuts"]) {
      await trigger("en-US", surface).click();
      const dialog = page.locator(
        surface === "palette" ? ".command-palette[open]" : ".shortcuts-dialog[open]",
      );
      await verifyCommandFocus(dialog.locator("[data-close]"));
      if (surface === "palette") {
        const input = dialog.getByRole("combobox");
        await verifyCommandFocus(input);
        await input.press("ArrowDown");
        const bounds = await dialog.evaluate((dialog) => {
          const list = dialog.querySelector("[role=listbox]").getBoundingClientRect();
          const active = dialog.querySelector('[aria-selected="true"]').getBoundingClientRect();
          return { top: active.top - list.top, bottom: list.bottom - active.bottom };
        });
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeGreaterThanOrEqual(0);
      } else await verifyCommandFocus(dialog.locator(".shortcuts-note"));
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 320, height: 400 });
  for (const surface of ["palette", "shortcuts"]) {
    await trigger("en-US", surface).click();
    const dialog = page.locator(
      surface === "palette" ? ".command-palette[open]" : ".shortcuts-dialog[open]",
    );
    // Synthetic rendered-label expansion exercises layout, not linguistic quality.
    await dialog.evaluate((dialog) => {
      for (const label of dialog.querySelectorAll(
        "th, .palette-group-label, .palette-reason, [role=option] > span[id]",
      )) {
        const text = label.textContent;
        label.textContent = `${text} ${"x".repeat(Math.ceil(Array.from(text).length * 0.4))}`;
      }
    });
    expect(
      await dialog.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth),
    ).toBeLessThanOrEqual(1);
    await verifyCommandFocus(dialog.locator("[data-close]"));
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 1180 });
  fs.mkdirSync(output, { recursive: true });
  for (const locale of supportedLocales) {
    await specimen.getByLabel("Command specimen language").selectOption(locale);
    await trigger(locale, "palette").click();
    await expect(page.locator(".command-palette[open]").getByRole("combobox")).toBeFocused();
    await expect(page.locator(".command-palette[open]").getByRole("option")).toHaveCount(
      commandDefinitions.length,
    );
    await page.keyboard.press("Escape");
  }
  await specimen.getByLabel("Command specimen language").selectOption("en-US");
  for (const platform of ["win32", "linux", "darwin"]) {
    await specimen.getByLabel("Command specimen platform").selectOption(platform);
    await trigger("en-US", "shortcuts").click();
    const expected = [
      ...commandDefinitions.filter((command) => command.shortcuts[platform].length),
      ...componentShortcutDefinitions,
    ];
    await expect(page.locator(".shortcuts-dialog[open] [data-shortcut-id]")).toHaveCount(
      expected.length,
    );
    for (const command of expected) {
      await expect(
        page.locator(`.shortcuts-dialog[open] [data-shortcut-id="${command.id}"] kbd`),
      ).toHaveText(command.shortcuts[platform].map(shortcutLabel));
    }
    await page.keyboard.press("Escape");
  }
  await specimen.getByLabel("Command specimen platform").selectOption("linux");
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await trigger("en-US", "palette").click();
  await page.screenshot({ path: path.join(output, `${engine}-command-palette.png`) });
  if (engine === "chromium") {
    await page.emulateMedia({ forcedColors: "active" });
    const active = page.locator('.command-palette[open] [aria-selected="true"]');
    expect(
      await active.evaluate((element) => getComputedStyle(element).borderInlineStartWidth),
    ).toBe("3px");
    await page.emulateMedia({ forcedColors: "none" });
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 1080 });
  await trigger("en-US", "shortcuts").click();
  await page.screenshot({ path: path.join(output, `${engine}-keyboard-shortcuts.png`) });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 400 });
  for (const locale of ["en-US", "de-DE", "fi-FI", "ko-KR"]) {
    await specimen.getByLabel("Command specimen language").selectOption(locale);
    for (const surface of ["palette", "shortcuts"]) {
      await trigger(locale, surface).click();
      const dialog = page.locator(
        surface === "palette" ? ".command-palette[open]" : ".shortcuts-dialog[open]",
      );
      const feedback = dialog.locator(".discovery-feedback-scroll");
      // Exact controlled message text with synthetic DOM notice admission, not a native command result.
      const text = `${message(locale, "about.copyOutsideFailed")} ${message(locale, "command.reason.modal_open")}`;
      await feedback.evaluate((element, text) => {
        const notice = document.createElement("p");
        notice.className = "command-danger";
        notice.setAttribute("role", "alert");
        notice.setAttribute("data-feedback-probe", "");
        notice.textContent = text;
        element.append(notice);
        element.scrollTop = 0;
      }, text);
      await expect(feedback).toHaveAccessibleName(message(locale, "command.feedback"));
      await verifyCommandFocus(feedback);
      await feedback.press("PageDown");
      await expect.poll(() => feedback.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      if (surface === "palette") {
        for (const height of [200, 100]) {
          await page.setViewportSize({ width: 320, height });
          const input = dialog.getByRole("combobox");
          await verifyCommandFocus(input);
          await input.press("ArrowDown");
          await expect
            .poll(() =>
              dialog.evaluate((dialog) => {
                const active = dialog
                  .querySelector('[aria-selected="true"]')
                  .getBoundingClientRect();
                const list = dialog.querySelector(".palette-list").getBoundingClientRect();
                const bounds = dialog.getBoundingClientRect();
                return (
                  active.top >= Math.max(list.top, bounds.top) &&
                  active.bottom <= Math.min(list.bottom, bounds.bottom)
                );
              }),
            )
            .toBe(true);
          await verifyCommandFocus(feedback);
          await verifyCommandFocus(dialog.locator("[data-close]"));
        }
        await page.setViewportSize({ width: 320, height: 400 });
      }
      await feedback.evaluate((element) => element.querySelector("[data-feedback-probe]").remove());
      expect(
        await dialog
          .locator(".discovery-feedback")
          .evaluate((element) => element.getBoundingClientRect().height),
      ).toBe(0);
      await page.keyboard.press("Escape");
    }
  }
  return {
    engine,
    measurements,
    shortHeights: [100, 200],
    renderedLabelExpansion: 0.4,
    hiddenConsumerFeedback: true,
    longFeedbackKeyboardScroll: true,
    shortHeightFeedback: true,
    locales: supportedLocales,
    platforms: ["win32", "linux", "darwin"],
    limitations: [
      "Synthetic bridge and platform inputs; native keyboard layouts, OS IME, packaged zoom and assistive journeys remain separate.",
    ],
  };
}
