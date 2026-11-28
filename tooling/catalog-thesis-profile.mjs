import path from "node:path";
import { expect } from "@playwright/test";
import { captureCatalog } from "./catalog-character.mjs";

export async function verifyThesisProfileSpecimen(page, url, engine, output) {
  const { message } = await import("../packages/contracts/dist/index.js");
  const previousViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 320, height: 650 });
    for (const [locale, appearance] of [
      ["en-US", "light"],
      ["ko-KR", "dark"],
    ]) {
      const text = (key, params = {}) => message(locale, key, params);
      await page.goto(`${url}?screen=thesis-profile&locale=${locale}&appearance=${appearance}`);
      const title = page.locator(".profile-thesis-title");
      await expect(title).toBeVisible();
      // The working title uses the whole document width and wraps instead of overflowing.
      const widths = await page.locator(".thesis-profile").evaluate((article) => {
        const style = article.ownerDocument.defaultView.getComputedStyle(article);
        const inner =
          article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const heading = article.querySelector(".profile-thesis-title");
        return { inner, title: heading.getBoundingClientRect().width };
      });
      expect(Math.abs(widths.title - widths.inner)).toBeLessThanOrEqual(1);
      await expect(page.getByText(text("profile.savedVersion", { number: 1 }))).toBeVisible();
      const milestones = page.locator('[data-profile-field="milestones"]');
      await expect(milestones.getByText(text("profile.datePassed"))).toBeVisible();
      await expect(milestones.getByText(text("profile.milestoneDone"))).toBeVisible();
      const questions = page.locator('[data-profile-field="questions"]');
      await expect(questions.getByText("한글 연구 질문 · ملاحظات")).toBeVisible();
      await expect(
        questions.getByText(text("profile.origin.described_material"), { exact: false }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: text("profile.editSection", { section: text("profile.section.research") }),
        })
        .press("Enter");
      const editing = page.locator('[data-profile-field="questions"]');
      await expect(
        page.locator('[data-profile-section="research"] input:checked').first(),
      ).toBeFocused();
      const editor = editing.getByRole("textbox").first();
      await editor.fill("연구 질문 수정");
      expect(await page.locator("main").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      await page.getByRole("button", { name: text("profile.save"), exact: true }).press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: text("profile.saveFailed") }),
      ).toBeVisible();
      await expect(editor).toHaveValue("연구 질문 수정");
      if (output)
        await captureCatalog(page, {
          path: path.join(output, `${engine}-thesis-profile-${locale}.png`),
        });
    }
  } finally {
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}
