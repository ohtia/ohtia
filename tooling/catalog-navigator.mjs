import path from "node:path";
import { expect } from "@playwright/test";
import { captureCatalog } from "./catalog-character.mjs";

export async function verifyNavigatorSpecimen(page, url, engine, output) {
  const { message } = await import("../packages/contracts/dist/index.js");
  const previousViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 320, height: 650 });
    for (const [locale, appearance] of [
      ["en-US", "light"],
      ["ko-KR", "dark"],
    ]) {
      const text = (key, params = {}) => message(locale, key, params);
      await page.goto(`${url}?screen=navigator&locale=${locale}&appearance=${appearance}`);
      const navigator = page.locator(".navigator");
      await expect(navigator).toBeVisible();
      expect(await page.locator("main").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      const milestones = page.locator(".navigator-milestones li");
      await expect(milestones).toHaveCount(2);
      await expect(milestones.first()).toContainText(text("profile.datePassed"));
      await expect(page.locator(".navigator-deadline")).not.toContainText(
        text("navigator.deadline.pending"),
      );
      const stages = page.locator(".research-stage-select");
      await expect(stages).toHaveCount(8);
      await expect(stages.first()).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('.research-stage[data-kind="milestone"]')).toContainText(
        text("navigator.milestone.pending"),
      );
      await stages.nth(3).focus();
      await page.keyboard.press("Enter");
      await expect(stages.nth(3)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".navigator-stage")).toContainText(text("navigator.laterStage"));
      await stages.first().press("Enter");
      await page
        .getByRole("button", { name: text("profile.section.research"), exact: true })
        .press("Enter");
      await expect(page.locator("main")).toHaveAttribute("data-opened", "research");
      if (output)
        await captureCatalog(page, {
          path: path.join(output, `${engine}-navigator-${locale}.png`),
        });
    }
  } finally {
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}
