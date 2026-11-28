/* global document, getComputedStyle */
import path from "node:path";
import { expect } from "@playwright/test";
import { captureCatalog, watchCatalogPage } from "./catalog-character.mjs";

/** The OpenRouter group in Settings › AI services at the regular and narrow widths. */
export async function verifyConnectionsSpecimen(page, url, engine, output) {
  const watch = await watchCatalogPage(page, url, "Connections", engine);
  const cases = [];
  try {
    for (const width of [560, 288])
      for (const locale of ["en-US", "de-DE", "ko-KR"]) {
        await page.setViewportSize({ width: width + 32, height: 1600 });
        await page.goto(`${url}?screen=connections&locale=${locale}&width=${width}`);
        await page.evaluate(() => document.fonts.ready);
        const panel = page.locator(".connections-specimen");
        await expect(panel.locator(".connection-privacy")).toHaveCount(6);
        await expect(panel.locator(".connection-privacy a")).toHaveCount(24);
        await expect(panel.locator('[data-case="1"] .connection-state')).toContainText("2026");
        // Sign in with OpenRouter: the waiting row and the note about a key Ohtia did not keep.
        await expect(panel.locator('[data-case="4"] .connection-actions button')).toHaveCount(1);
        await expect(panel.locator('[data-case="5"] .connection-unkept a')).toHaveCount(1);
        const problems = await panel.evaluate((element) => {
          const clipped = [
            ...element.querySelectorAll(
              ".connection-row *, .connection-privacy, .connection-privacy *, .connection-unkept *",
            ),
          ]
            // Inline boxes report no client width in every engine; their blocks are measured.
            .filter(
              (node) =>
                getComputedStyle(node).display !== "inline" &&
                node.scrollWidth > node.clientWidth + 1,
            )
            .map((node) => `${node.tagName}.${node.className}`);
          const links = [...element.querySelectorAll(".connection-privacy a")].map((link) =>
            link.getBoundingClientRect(),
          );
          const overlapping = links.some((a, i) =>
            links.some(
              (b, j) =>
                i < j &&
                a.left < b.right - 0.5 &&
                b.left < a.right - 0.5 &&
                a.top < b.bottom - 0.5 &&
                b.top < a.bottom - 0.5,
            ),
          );
          return { clipped, overlapping };
        });
        expect(problems).toEqual({ clipped: [], overlapping: false });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await captureCatalog(panel, {
          path: path.join(output, `${engine}-connections-${locale}-${width}.png`),
        });
        cases.push({ locale, width, groups: 6 });
      }
    await watch.assert();
    return {
      cases,
      limitations: ["Synthetic OpenRouter rows only; no main process, keyring or network."],
    };
  } finally {
    await watch.dispose();
  }
}
