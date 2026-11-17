/* global document, getComputedStyle */
import path from "node:path";
import { expect } from "@playwright/test";
import { captureCatalog, watchCatalogPage } from "./catalog-character.mjs";

export async function verifyTaskNoticeSpecimen(page, url, engine, output) {
  const watch = await watchCatalogPage(page, url, "Task notices", engine);
  const cases = [];
  try {
    await page.setViewportSize({ width: 320, height: 1000 });
    for (const theme of ["light", "dark"])
      for (const locale of ["en-US", "de-DE", "ko-KR", "pt-BR"])
        for (const kind of ["subscription", "api_key"]) {
          await page.goto(
            `${url}?screen=task-notices&theme=${theme}&locale=${locale}${kind === "api_key" ? "&apiKey" : ""}`,
          );
          await page.evaluate(() => document.fonts.ready);
          const panel = page.locator(".task-notices-specimen");
          expect(await panel.locator(".conversation-notice").count()).toBe(37);
          expect(
            await panel.locator(".conversation-notice button,.conversation-notice a").count(),
          ).toBe(0);
          expect(await panel.locator(".conversation-notice > svg").count()).toBe(37);
          const errors = await panel.evaluate((element) =>
            [...element.querySelectorAll(".task-notice, .task-notice-actions, button, a")]
              .filter(
                (node) =>
                  node.closest("dialog") === null && node.scrollWidth > node.clientWidth + 1,
              )
              .map((node) => node.className),
          );
          expect(errors).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
          ).toBe(true);
          const status = panel.locator(".conversation-notice.status").first();
          const measured = await status.evaluate((element) => ({
            background: getComputedStyle(element).backgroundColor,
            emphasis: (() => {
              const reference = document.createElement("span");
              reference.style.backgroundColor = "var(--surface-emphasis)";
              element.append(reference);
              const color = getComputedStyle(reference).backgroundColor;
              reference.remove();
              return color;
            })(),
            border: getComputedStyle(element).borderTopWidth,
          }));
          expect(measured.background).toBe(measured.emphasis);
          expect(measured.border).toBe("1px");
          const geometry = await status.evaluate((element) => {
            const style = getComputedStyle(element);
            const icon = element.querySelector("svg").getBoundingClientRect();
            return {
              block: style.paddingBlockStart,
              inline: style.paddingInlineStart,
              gap: style.gap,
              radius: style.borderRadius,
              font: style.fontSize,
              line: style.lineHeight,
              icon: [icon.width, icon.height],
            };
          });
          expect(geometry).toEqual({
            block: "8px",
            inline: "12px",
            gap: "8px",
            radius: "6px",
            font: "14px",
            line: "21px",
            icon: [16, 16],
          });
          const spacing = await panel.locator('[data-case="4"]').evaluate((element) => {
            const box = element.querySelector(".conversation-notice").getBoundingClientRect();
            const actions = element.querySelector(".task-notice-actions").getBoundingClientRect();
            const voice = element.querySelector(".voice-label").getBoundingClientRect();
            return { actions: actions.top - box.bottom, voice: box.top - voice.bottom };
          });
          expect(spacing).toEqual({ actions: 8, voice: 8 });

          expect(await panel.locator('[data-case="8"] .voice-label').count()).toBe(0);
          expect(await panel.locator('[data-case="32"] .task-notice-actions button').count()).toBe(
            0,
          );
          await captureCatalog(panel, {
            path: path.join(output, `${engine}-task-notices-${theme}-${locale}-${kind}.png`),
          });
          cases.push({ theme, locale, kind, width: 280, notices: 37, geometry, spacing });
        }
    await page.goto(`${url}?screen=task-notices&locale=de-DE&expanded&width=320`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.goto(`${url}?screen=task-notices&uncertain`);
    const trigger = page.locator('[data-case="30"] .task-notice-actions button');
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("dialog[open] [data-close]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await page.locator("dialog[open] .primitive-primary").click();
    await expect(page.locator("output")).toHaveText(/^restart /);
    await expect(page.locator('[data-case="30"]')).toContainText("won’t run twice");
    const first = await page.locator("output").textContent();
    await trigger.click();
    await expect(page.locator("output")).toHaveText(first);
    if (engine === "chromium") {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await trigger.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(trigger).toBeFocused();
      expect(await trigger.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
    }
    await watch.assert();
    return {
      cases,
      pseudolocalization: true,
      keyboard: true,
      idempotentActions: true,
      csp: true,
      limitations: [
        "Synthetic catalog only; no native account, physical IME or manual screen-reader verification.",
      ],
    };
  } finally {
    await watch.dispose();
  }
}
