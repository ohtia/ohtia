/* global document, getComputedStyle */
import { expect } from "@playwright/test";
import path from "node:path";
import { captureCatalog, watchCatalogPage } from "./catalog-character.mjs";

export async function verifyProjectSelectorSpecimen(page, url, engine, output) {
  const watch = await watchCatalogPage(page, url, "Project selector", engine);
  const locales = ["en-US", "de-DE", "ko-KR"];
  const variants = [
    ...locales.map((locale) => ({ locale, expanded: false })),
    { locale: "en-US", expanded: true },
  ];
  let journeys = 0;
  try {
    for (const { locale, expanded } of variants)
      for (const theme of ["light", "dark"])
        for (const width of [320, 1023, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(
            `${url}?screen=project-selector&locale=${locale}&theme=${theme}${expanded ? "&expanded" : ""}`,
          );
          const combo = page.getByRole("combobox");
          await expect(combo).toBeVisible();
          const firstRow = await combo.evaluate(
            (node) => node.closest(".workspace-title-row") !== null,
          );
          expect(firstRow).toBe(true);
          const plus = page.locator('.workspace-title-row [data-workspace-command="project.new"]');
          const comboRect = await combo.boundingBox();
          const plusRect = await plus.boundingBox();
          expect(Math.abs(comboRect.y - plusRect.y)).toBeLessThanOrEqual(1);
          expect(plusRect.x).toBeGreaterThanOrEqual(comboRect.x + comboRect.width);
          expect(plusRect.x + plusRect.width).toBeLessThanOrEqual(width);
          expect((await combo.locator("bdi").boundingBox()).width).toBeGreaterThan(24);

          await combo.focus();
          await page.keyboard.press("ArrowDown");
          await expect(page.getByRole("option")).toHaveCount(41);
          const moreName = await page.getByRole("option").last().innerText();
          expect(await page.getByRole("listbox").ariaSnapshot()).toContain(moreName);
          const measured = await combo.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              height: rect.height,
              width: rect.width,
              font: getComputedStyle(element).fontSize,
            };
          });
          expect(measured.height).toBe(32);
          expect(measured.width).toBeLessThanOrEqual(320);
          const popup = page.locator(".project-selector-popup");
          expect((await popup.boundingBox()).width).toBe(Math.min(360, width));
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press("Enter");
          await expect(combo).toHaveAttribute("aria-expanded", "false");
          await combo.click();
          await expect(page.locator('[role=option][aria-current="true"]')).toHaveCount(1);
          expect((await combo.locator("bdi").boundingBox()).width).toBeGreaterThan(24);
          await expect(page.locator('[role=option][aria-current="true"] svg')).toHaveCount(2);
          await page.keyboard.press("End");
          await page.keyboard.press("Enter");
          await expect(page.getByRole("option")).toHaveCount(81);
          await expect(page.locator('[role=option][aria-selected="true"]')).toHaveAttribute(
            "id",
            /option-40$/,
          );
          await page.keyboard.press("End");
          await page.keyboard.press("Enter");
          await expect(page.getByRole("option")).toHaveCount(95);
          await expect(page.locator('[role=option][aria-selected="true"]')).toHaveAttribute(
            "id",
            /option-80$/,
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
          ).toBe(true);
          await page.keyboard.press("Home");
          await captureCatalog(page, {
            path: path.join(
              output,
              `${engine}-project-selector-${expanded ? "pseudo" : locale}-${theme}-${String(width)}.png`,
            ),
            fullPage: true,
          });
          journeys++;
        }
    for (const state of ["empty", "failed", "slow", "failedMore"]) {
      await page.goto(`${url}?screen=project-selector&${state}`);
      const combo = page.getByRole("combobox");
      await combo.click();
      if (state === "empty") await expect(page.getByRole("status")).toHaveText("No projects yet.");
      else if (state === "failed") {
        await expect(page.getByRole("alert")).toContainText("couldn’t load the projects");
        await expect(page.getByRole("option")).toContainText("Reload projects");
      } else if (state === "slow")
        await expect(page.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
      else {
        await expect(page.getByRole("option")).toHaveCount(41);
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("alert")).toContainText("couldn’t load more projects");
        await expect(page.getByRole("option")).toHaveCount(41);
      }
      if (state === "failed" || state === "failedMore") {
        const notice = page.getByRole("alert");
        const action = page.locator(".project-selector-more");
        const box = await notice.boundingBox();
        const button = await action.boundingBox();
        expect(button.y - box.y - box.height).toBe(8);
        await expect(notice.locator("button, a")).toHaveCount(0);
      }
      journeys++;
    }
    for (const failure of ["failed", "openingFailed&restore"]) {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(`${url}?screen=project-selector&${failure}`);
      const combo = page.getByRole("combobox");
      await expect(combo).toHaveAttribute("aria-expanded", "false");
      const error = page.locator(".project-selector-open-error");
      await expect(error.getByRole("alert")).toBeVisible();
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(async () => {
            const anchor = await combo.boundingBox();
            const box = await error.boundingBox();
            return Math.abs(box.y - anchor.y - anchor.height);
          })
          .toBeLessThanOrEqual(1);
        const box = await error.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        const notice = await error.getByRole("alert").boundingBox();
        const action = await error
          .getByRole("button", {
            name: failure === "failed" ? "Reload projects" : "Try again",
            exact: true,
          })
          .boundingBox();
        expect(action.y - notice.y - notice.height).toBe(8);
      }
      const retry = error.getByRole("button", {
        name: failure === "failed" ? "Reload projects" : "Try again",
        exact: true,
      });
      await combo.focus();
      await page.keyboard.press("Tab");
      await expect(retry).toBeFocused();
      await expect(error).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(error.getByRole("button", { name: "Dismiss", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(retry).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(combo).toBeFocused();
      await expect(error.getByRole("alert")).toBeVisible();
      await expect(combo).toHaveAttribute("aria-expanded", "false");
      await page.setViewportSize({ width: 320, height: 900 });
      await expect(page.locator(".workspace")).toHaveAttribute("data-mode", "narrow");
      await expect.poll(async () => (await error.boundingBox()).x).toBe(0);
      const covered = await page.evaluate(() => {
        const overlay = document.querySelector(".project-selector-open-error");
        const box = overlay.getBoundingClientRect();
        const target = [...document.querySelectorAll('button,a[href],[tabindex="0"]')].find(
          (node) => {
            if (
              overlay.contains(node) ||
              node.disabled ||
              node.tabIndex < 0 ||
              node.closest("[inert]")
            )
              return false;
            const r = node.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              r.left >= box.left &&
              r.right <= box.right &&
              r.top >= box.top &&
              r.bottom <= box.bottom
            );
          },
        );
        target?.setAttribute("data-focus-occlusion-check", "");
        return !!target;
      });
      expect(covered).toBe(true);
      const target = page.locator("[data-focus-occlusion-check]");
      await target.focus();
      await expect(target).toBeFocused();
      await expect(error).toHaveCount(0);
      await combo.click();
      if (failure === "failed") await expect(page.getByRole("alert")).toBeVisible();
      else {
        await expect(page.getByRole("option")).toHaveCount(41);
        await expect(page.getByRole("alert")).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alert")).toHaveCount(0);
      journeys++;
    }
    if (engine === "chromium") {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await page.goto(`${url}?screen=project-selector`);
      const combo = page.getByRole("combobox");
      await combo.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("option")).toHaveCount(41);
      await page.keyboard.press("ArrowDown");
      await expect(page.locator('[role=option][aria-selected="true"]')).toHaveCount(1);
      const border = await page
        .locator('[role=option][aria-selected="true"]')
        .evaluate((element) => ({
          actual: getComputedStyle(element).borderInlineStartWidth,
          expected: getComputedStyle(element).getPropertyValue("--focus-width").trim(),
        }));
      expect(border.actual).toBe(border.expected);
      await page.keyboard.press("Escape");
      await expect(combo).toBeFocused();
      await expect(combo).toHaveAttribute("aria-expanded", "false");
      await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
      journeys++;
    }
    await watch.assert();
    return {
      journeys,
      locales,
      widths: [320, 1023, 1280],
      themes: ["light", "dark"],
      keyboard: true,
      forcedColors: engine === "chromium",
      reducedMotion: engine === "chromium",
      pagination: [40, 40, 15],
      limitations: [
        "Synthetic portable catalog; native screen-reader, IME and real-account journeys require separate evidence.",
      ],
    };
  } finally {
    await watch.dispose();
  }
}
