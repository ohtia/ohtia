/* global document, getComputedStyle, matchMedia */
import { expect } from "@playwright/test";
import path from "node:path";
import { captureCatalog, watchCatalogPage } from "./catalog-character.mjs";

async function selectorInTitleRow(page) {
  const titleRow = page.locator(".workspace-title-row");
  const combo = titleRow.getByRole("combobox");
  const plus = titleRow.locator('[data-workspace-command="project.new"]');
  await expect(combo).toBeVisible();
  await expect(plus).toBeVisible();
  const [row, selector, create] = await Promise.all([
    titleRow.boundingBox(),
    combo.boundingBox(),
    plus.boundingBox(),
  ]);
  expect(selector.x).toBeGreaterThanOrEqual(row.x);
  expect(create.x).toBeGreaterThanOrEqual(selector.x + selector.width);
  expect(create.x + create.width).toBeLessThanOrEqual(row.x + row.width);
  expect(
    Math.abs(selector.y + selector.height / 2 - create.y - create.height / 2),
  ).toBeLessThanOrEqual(1);
  return combo;
}

async function verifyActivityBadges(page, url, engine, output) {
  for (const { locale, expanded, width } of [
    { locale: "en-US", expanded: false, width: 1280 },
    { locale: "de-DE", expanded: false, width: 320 },
    { locale: "ko-KR", expanded: false, width: 320 },
    { locale: "en-US", expanded: true, width: 320 },
  ]) {
    await page.setViewportSize({ width, height: 800 });
    const base = `${url}?screen=project-selector&locale=${locale}${expanded ? "&expanded" : ""}`;
    const chatControl = page.locator('[data-workspace-command="panels.chat"]');
    await page.goto(base);
    await expect(chatControl).toBeVisible();
    const plain = await chatControl.boundingBox();
    await page.goto(`${base}&activity`);
    await expect(chatControl.locator(".activity-badge")).toHaveCount(2);
    const marked = await chatControl.boundingBox();
    expect(marked.width).toBeCloseTo(plain.width, 0);
    expect(marked.height).toBeCloseTo(plain.height, 0);
    const checks = await chatControl.evaluate((button) => {
      const control = button.getBoundingClientRect();
      const badge = button.querySelector(".activity-badge-new");
      const attention = button.querySelector(".activity-badge-attention");
      const news = badge.getBoundingClientRect();
      const warning = attention.getBoundingClientRect();
      const icon = attention.querySelector("svg").getBoundingClientRect();
      return {
        news: {
          top: Math.round(news.top - control.top),
          end: Math.round(news.right - control.right),
          height: news.height,
          padding: getComputedStyle(badge).paddingInline,
        },
        attention: {
          end: Math.round(warning.right - control.right),
          bottom: Math.round(warning.bottom - control.bottom),
          width: warning.width,
          height: warning.height,
          icon: icon.width,
        },
        animations: badge.getAnimations().length + attention.getAnimations().length,
      };
    });
    // Offsets are measured from the control's padding box, inside its border.
    expect(checks.news.top).toBeGreaterThanOrEqual(-6);
    expect(checks.news.top).toBeLessThanOrEqual(-5);
    expect(checks.news.end).toBeGreaterThanOrEqual(5);
    expect(checks.news.end).toBeLessThanOrEqual(6);
    expect(checks.news.height).toBe(18);
    expect(checks.news.padding).toBe("5px");
    expect(checks.attention.end).toBeGreaterThanOrEqual(5);
    expect(checks.attention.end).toBeLessThanOrEqual(6);
    expect(checks.attention.bottom).toBeGreaterThanOrEqual(5);
    expect(checks.attention.bottom).toBeLessThanOrEqual(6);
    expect(checks.attention).toMatchObject({ width: 18, height: 18, icon: 12 });
    expect(checks.animations).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (!expanded && locale === "en-US") {
      await captureCatalog(page, { path: path.join(output, `${engine}-activity-wide.png`) });
      const selector = page.getByRole("combobox");
      await expect(selector).toHaveAccessibleName("Current project");
      expect(await selector.ariaSnapshot()).toContain("Another project needs your attention.");
      await selector.click();
      await expect(
        page.getByRole("option").filter({ hasText: "Needs your attention" }),
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
      if (engine === "chromium") {
        await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
        for (const badge of await chatControl.locator(".activity-badge").all()) {
          const border = await badge.evaluate((element) => {
            const style = getComputedStyle(element);
            return [
              style.borderTopWidth,
              style.borderTopStyle,
              style.borderTopColor === style.color,
            ];
          });
          expect(border).toEqual(["1px", "solid", true]);
        }
        await captureCatalog(page, { path: path.join(output, `${engine}-activity-forced.png`) });
        await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
      }
      await chatControl.click();
      await expect(
        page
          .getByRole("button", {
            name: "Show conversation history, 1 needs your attention, 2 with new replies",
          })
          .locator(".activity-badge"),
      ).toHaveCount(2);
    }
  }
  return 4;
}

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
          const combo = await selectorInTitleRow(page);
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
    const verifyInsets = async (target, coarse) => {
      await target.setViewportSize({ width: 320, height: 900 });
      for (const [platform, start, end, locale] of [
        ["linux", 0, 138, "de-DE"],
        ["darwin", 76, 0, "ko-KR"],
      ]) {
        await target.goto(
          `${url}?screen=project-selector&platform=${platform}&start=${start}&end=${end}&locale=${locale}`,
        );
        const combo = await selectorInTitleRow(target);
        const row = await target.locator(".workspace-title-row").boundingBox();
        expect(row.x).toBe(start);
        expect(row.x + row.width).toBe(320 - end);
        if (coarse) {
          expect(await target.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
          const plus = await target
            .locator('.workspace-title-row [data-workspace-command="project.new"]')
            .boundingBox();
          expect(Math.min(plus.width, plus.height)).toBeGreaterThanOrEqual(44);
          const selector = await combo.boundingBox();
          expect(Math.min(selector.width, selector.height)).toBeGreaterThanOrEqual(44);
        }
        await combo.click();
        const options = target.getByRole("option");
        await expect(options).toHaveCount(41);
        if (coarse) {
          const smallest = await options.evaluateAll((rows) =>
            Math.min(
              ...rows.map((row) => {
                const bounds = row.getBoundingClientRect();
                return Math.min(bounds.width, bounds.height);
              }),
            ),
          );
          expect(smallest).toBeGreaterThanOrEqual(44);
        }
        await options.first().click();
        await expect(combo.locator("svg")).toHaveCount(2);
        await selectorInTitleRow(target);
        expect(
          (await combo.locator("bdi").boundingBox()).width,
          `${platform} selected project title, coarse pointer: ${String(coarse)}`,
        ).toBeGreaterThan(24);
        journeys++;
      }
    };
    await verifyInsets(page, false);
    if (engine === "chromium") {
      const coarse = await page.context().browser().newContext({ hasTouch: true });
      try {
        const target = await coarse.newPage();
        const touch = await watchCatalogPage(target, url, "Project selector coarse insets", engine);
        try {
          await verifyInsets(target, true);
          await touch.assert();
        } finally {
          await touch.dispose();
        }
      } finally {
        await coarse.close();
      }
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
    journeys += await verifyActivityBadges(page, url, engine, output);
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
