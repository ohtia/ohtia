/* global document, getComputedStyle */
import path from "node:path";
import { expect } from "@playwright/test";
import { captureCatalog, watchCatalogPage } from "./catalog-character.mjs";

/** Check actual block geometry so reset specificity cannot silently remove the token gap. */
async function verifyBlockSpacing(panel) {
  const gaps = await panel
    .locator(".conversation-message.agent .message-markdown")
    .first()
    .evaluate((element) => {
      const expected = parseFloat(getComputedStyle(element).getPropertyValue("--space-2"));
      return [element, ...element.querySelectorAll("blockquote,li")].flatMap((container) =>
        Array.from(container.children)
          .slice(1)
          .map((node) => ({
            before: node.previousElementSibling.tagName,
            after: node.tagName,
            expected,
            actual:
              node.getBoundingClientRect().top -
              node.previousElementSibling.getBoundingClientRect().bottom,
          })),
      );
    });
  expect(gaps.some((gap) => gap.before === "HR" || gap.after === "HR")).toBe(true);
  for (const gap of gaps)
    expect(Math.abs(gap.actual - gap.expected), `${gap.before} to ${gap.after}`).toBeLessThan(1);
}

/** Real browser layout and CSP checks; every effect stays in the synthetic specimen. */
export async function verifyConversationSpecimen(page, url, engine, output) {
  const watch = await watchCatalogPage(page, url, "Conversation", engine);
  const cases = [];
  try {
    for (const width of [280, 320]) {
      await page.setViewportSize({ width: 600, height: 900 });
      for (const theme of ["light", "dark"]) {
        for (const locale of ["en-US", "de-DE", "ko-KR"]) {
          await page.goto(
            `${url}?screen=conversation&width=${width}&theme=${theme}&locale=${locale}`,
          );
          await page.evaluate(() => document.fonts.ready);
          await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
          const panel = page.locator(".conversation-specimen-panel");
          expect(await panel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
            theme === "dark" ? "rgb(26, 24, 21)" : "rgb(244, 241, 237)",
          );
          expect(await panel.evaluate((e) => e.clientWidth)).toBe(width);
          await expect(panel.locator("script,img,iframe,object,embed,math")).toHaveCount(0);
          await expect(panel.locator("h1,h2,h3,h4,h5,h6")).toHaveCount(0);
          const measured = await panel.evaluate((e) => {
            const timeline = e.querySelector(".conversation-timeline");
            const code = e.querySelector(".message-code-box");
            const table = e.querySelector(".message-table-box");
            return {
              panelFits: e.scrollWidth <= e.clientWidth,
              timelineFits: timeline.scrollWidth <= timeline.clientWidth,
              researcherFits:
                e.querySelector(".conversation-message.researcher").getBoundingClientRect().width <=
                (timeline.clientWidth -
                  parseFloat(getComputedStyle(timeline).paddingLeft) -
                  parseFloat(getComputedStyle(timeline).paddingRight)) *
                  0.85 +
                  1,
              boxes: [code, table].map((box) => ({
                overflow: box.scrollWidth > box.clientWidth,
                focusable: box.tabIndex === 0,
                name: box.getAttribute("aria-label"),
                border: getComputedStyle(box).borderTopWidth,
              })),
            };
          });
          await verifyBlockSpacing(panel);
          expect(measured.panelFits).toBe(true);
          expect(measured.timelineFits).toBe(true);
          expect(measured.researcherFits).toBe(true);
          for (const box of measured.boxes) {
            expect(box.overflow).toBe(true);
            expect(box.focusable).toBe(true);
            expect(box.name).toBeTruthy();
            expect(box.border).toBe("1px");
          }
          for (const selector of [".message-code-box", ".message-table-box"]) {
            const box = panel.locator(selector);
            await box.focus();
            await expect(box).toBeFocused();
            await page.keyboard.press("ArrowRight");
            await expect.poll(() => box.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
            await box.evaluate((e) => {
              e.scrollLeft = 0;
            });
          }
          const link = panel.locator("a");
          await expect(link).toHaveCount(1);
          await link.focus();
          await expect(page.getByRole("tooltip")).toHaveText(
            "https://example.org/long/full/address?source=daily-temperature-series",
          );
          await page.keyboard.press("Escape");
          await expect(page.getByRole("tooltip")).toHaveCount(0);
          await page.keyboard.press("Enter");
          await expect(page.locator("output")).toContainText("open https://example.org/");
          await expect(panel.locator('[aria-busy="true"] button')).toHaveCount(0);
          await expect(panel.locator(".conversation-actions button")).toHaveCount(3);
          await panel.locator(".conversation-actions button").first().focus();
          await page.keyboard.press("Enter");
          await expect(panel.locator(".conversation-copy-status").first()).not.toBeEmpty();
          await expect(panel.locator(".conversation-actions button").first()).toBeFocused();
          await page.keyboard.press("Escape");

          const trigger = panel.locator(".reply-details-toggle");
          await panel
            .locator(".conversation-message.agent .conversation-actions button")
            .first()
            .focus();
          await page.keyboard.press("Tab");
          await expect(trigger).toBeFocused();
          await expect(trigger).not.toHaveAttribute("aria-expanded");
          await page.keyboard.press("Enter");
          const details = panel.locator(".reply-details");
          await expect(details.locator("dl > dt")).toHaveCount(16);
          await expect(details).not.toHaveAttribute("aria-busy");
          await expect(details).toContainText("GPT synthetic 한국어");
          expect(
            await details.evaluate((element) => {
              const grid = element.querySelector("dl");
              return (
                element.scrollWidth <= element.clientWidth &&
                getComputedStyle(grid).gridTemplateColumns.split(" ").length === 2
              );
            }),
          ).toBe(true);
          if (width === 280) {
            await captureCatalog(page, {
              path: path.join(output, `${engine}-reply-details-${width}-${theme}-${locale}.png`),
              fullPage: true,
            });
          }
          await details.locator(".reply-details-memory > summary").click();
          await details.locator(".reply-details-memory li summary").click();
          await expect(details.locator(".reply-details-memory li")).toContainText(
            "Synthetic memory version.",
          );
          await trigger.focus();
          await page.keyboard.press("Enter");
          await expect(details).toHaveCount(0);
          await expect(trigger).toBeFocused();
          await panel.locator(".conversation-actions button").first().focus();
          cases.push({ width, theme, locale });
          await captureCatalog(page, {
            path: path.join(output, `${engine}-conversation-${width}-${theme}-${locale}.png`),
            fullPage: true,
          });
        }
      }
    }
    await expect(page.locator(".conversation-copy-status").first()).toBeEmpty({ timeout: 7000 });
    await expect(page.locator(".conversation-actions button").first()).toBeFocused();
    const wideCases = [];
    await page.setViewportSize({ width: 1040, height: 900 });
    for (const theme of ["light", "dark"]) {
      for (const locale of ["en-US", "de-DE", "ko-KR"]) {
        let previous;
        for (const width of [640, 960]) {
          await page.goto(
            `${url}?screen=conversation&width=${width}&theme=${theme}&locale=${locale}`,
          );
          await page.evaluate(() => document.fonts.ready);
          const panel = page.locator(".conversation-specimen-panel");
          expect(await panel.evaluate((e) => e.clientWidth)).toBe(width);
          const geometry = await panel.evaluate((element) => {
            const agent = element.querySelector(".conversation-message.agent");
            const researcher = element.querySelector(".conversation-message.researcher");
            const prose = agent.querySelector(".message-markdown > p:not(.message-heading)");
            const timeline = element.querySelector(".conversation-timeline");
            const rect = (node) => node.getBoundingClientRect();
            return {
              prose: rect(prose).width,
              code: rect(agent.querySelector(".message-code-box")).width,
              table: rect(agent.querySelector(".message-table-box")).width,
              researcher: rect(researcher).width,
              researcherLimit:
                parseFloat(getComputedStyle(researcher).fontSize) *
                  parseFloat(getComputedStyle(researcher).getPropertyValue("--measure-reading")) +
                2 *
                  parseFloat(
                    getComputedStyle(researcher.querySelector(".conversation-text")).paddingLeft,
                  ),
              endDifference: Math.abs(rect(agent).right - rect(researcher).right),
              panelFits: element.scrollWidth <= element.clientWidth,
              timelineFits: timeline.scrollWidth <= timeline.clientWidth,
            };
          });
          await verifyBlockSpacing(panel);
          expect(Math.abs(geometry.prose - geometry.code)).toBeLessThan(1);
          expect(Math.abs(geometry.prose - geometry.table)).toBeLessThan(1);
          expect(geometry.researcher).toBeLessThanOrEqual(geometry.researcherLimit + 1);
          expect(geometry.endDifference).toBeLessThan(1);
          expect(geometry.panelFits && geometry.timelineFits).toBe(true);
          if (previous) {
            expect(geometry.prose - previous.prose).toBeGreaterThan(250);
            expect(Math.abs(geometry.researcher - previous.researcher)).toBeLessThan(1);
          }
          previous = geometry;
          wideCases.push({ width, theme, locale });
          await captureCatalog(page, {
            path: path.join(output, `${engine}-conversation-${width}-${theme}-${locale}.png`),
            fullPage: true,
          });
        }
      }
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${url}?screen=conversation&width=280&locale=de-DE&expanded=1&copyFails=1`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".conversation-actions button").first().click();
    await expect(page.locator('.conversation-saved-actions [role="alert"]')).toHaveCount(1);
    await expect(page.locator('[role="alert"] button, [role="alert"] a')).toHaveCount(0);
    expect(
      await page.locator(".conversation-timeline").evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const detailsTrigger = page.locator(".reply-details-toggle");
    await detailsTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".reply-details dd")).toHaveCount(16);
    await expect(page.locator(".reply-details h3")).toContainText("⟦");
    expect(
      await page.locator(".reply-details").evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    if (engine === "chromium") {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await expect(detailsTrigger).toBeFocused();
      await page.locator(".message-code-box").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator(".message-code-box")).toBeFocused();
      expect(
        await page.locator(".message-code-box").evaluate((e) => getComputedStyle(e).outlineStyle),
      ).not.toBe("none");
      await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    }
    await watch.assert();
    return {
      cases,
      wideCases,
      copyFeedbackExpiry: true,
      replyDetails: true,
      blockSpacing: true,
      pseudolocalization: true,
      copyFailure: true,
      keyboard: true,
      csp: true,
      limitations: [
        "Synthetic catalog; no native clipboard, provider, IME or manual screen-reader evidence.",
      ],
    };
  } finally {
    await watch.dispose();
  }
}
