/* global document, window, getComputedStyle */
import fs from "node:fs";
import path from "node:path";
import { build, preview } from "vite";
import { expect } from "@playwright/test";
import { verifyCommandSpecimens } from "./command-presentation.mjs";

export async function serveCatalog(root) {
  const configFile = path.join(root, "tooling/vite.catalog.mjs");
  await build({ configFile, logLevel: "silent" });
  const server = await preview({ configFile, preview: { port: 0 } });
  return {
    url: server.resolvedUrls.local[0],
    async close() {
      await new Promise((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
async function keyboardJourneys(page, url) {
  await page.goto(url);
  const tab = page.getByRole("tab", { name: "Source", exact: true });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Space");
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Switch from notes", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Switch to source?", exact: true })
    .getByRole("button", { name: "Switch to source", exact: true })
    .click();
  await expect(tab).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Notes", exact: true, includeHidden: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Close notes", exact: true }).focus();
  await page.keyboard.press("Enter");
  const closeNotes = page.getByRole("dialog", { name: "Close notes tab?", exact: true });
  await expect(closeNotes.locator("[data-safe]")).toBeFocused();
  await closeNotes.getByRole("button", { name: "Close notes tab", exact: true }).click();
  await expect(tab).toBeFocused();
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "Open dialog", exact: true });
  await page.getByRole("button", { name: "Help for sources", exact: true }).hover();
  await trigger.focus();
  await trigger.evaluate((element) => element.click());
  const dialog = page.getByRole("dialog", { name: "Source dialog", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("checkbox", { name: "Ignore close requests", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Dialog help", exact: true }).focus();
  await expect(dialog.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tooltip")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Dialog details", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Dialog details", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Attempt second modal", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expect(dialog).toBeVisible();
  const hold = dialog.getByRole("checkbox", { name: "Ignore close requests", exact: true });
  await hold.check();
  await dialog.getByRole("heading", { name: "Source dialog", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").focus();
  await dialog
    .getByRole("button", { name: "Remove focused field", exact: true })
    .evaluate((element) => element.click());
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => element.close());
  await expect(dialog).toBeVisible();
  await hold.uncheck();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Delete synthetic source", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete synthetic source?", exact: true });
  await expect(confirm.locator("[data-safe]")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Source actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Rename source", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Remove source", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  const help = page.getByRole("button", { name: "Help for sources", exact: true });
  await help.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.getByRole("tooltip").hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Source title", exact: true });
  await input.fill("");
  await input.blur();
  await page.getByRole("button", { name: "Validate title", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Correct the title", exact: true })).toBeFocused();
  await page
    .getByRole("alert", { name: "Correct the title", exact: true })
    .getByRole("link")
    .click();
  await expect(input).toBeFocused();
  await input.fill("Corrected title");
  await input.blur();
  await expect(page.getByRole("alert", { name: "Correct the title", exact: true })).toHaveCount(0);
  await input.fill("");
  await input.press("Tab");
  await expect(page.getByRole("combobox", { name: "Source type", exact: true })).toBeFocused();
  await input.fill("New researcher draft 연구");
  await page.getByRole("button", { name: "Accept synthetic operation", exact: true }).click();
  await expect(input).toHaveValue("New researcher draft 연구");
}

export async function verifyCatalog(page, url, engine, output) {
  const errors = [];
  const violations = [];
  const requests = [];
  const error = (value) => errors.push(value.message);
  const consoleError = (value) => {
    if (value.type() === "error") violations.push(value.text());
  };
  const request = (value) => requests.push(value.url());
  page.on("pageerror", error);
  page.on("console", consoleError);
  page.on("request", request);
  try {
    await verifyCommandSpecimens(page, url, engine);
    await keyboardJourneys(page, url);
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    if (engine === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      const tree = await cdp.send("Accessibility.getFullAXTree");
      for (const role of [
        "button",
        "textbox",
        "combobox",
        "checkbox",
        "switch",
        "radio",
        "tab",
        "tabpanel",
        "table",
        "progressbar",
        "status",
      ])
        expect(
          tree.nodes.some((node) => !node.ignored && node.role?.value === role),
          role,
        ).toBe(true);
    }
    for (const width of [320, 600, 1024, 1280]) {
      const themeColors = new Set();
      await page.setViewportSize({ width, height: 700 });
      for (const theme of ["light", "dark"]) {
        await page.getByLabel("Theme", { exact: true }).selectOption(theme);
        themeColors.add(
          await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
        );
        await page.getByLabel("Expand labels by at least 40%", { exact: true }).check();
        await page
          .getByRole("switch", { name: "Korean mixed-script specimens", exact: true })
          .check();
        const expandedLabel = await page
          .getByRole("button", { name: /^Open dialog/ })
          .textContent();
        expect(Array.from(expandedLabel).length).toBeGreaterThanOrEqual(
          Math.ceil(Array.from("Open dialog — 연구 근거 확인").length * 1.4),
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const tabs = page.getByRole("tab");
        for (const tabIndex of [0, (await tabs.count()) - 1]) {
          await tabs.nth(tabIndex).focus();
          await page.keyboard.press(tabIndex === 0 ? "Home" : "End");
          const focus = await tabs.nth(tabIndex).evaluate((element) => {
            const tab = element.getBoundingClientRect(),
              list = element.closest('[role="tablist"]').getBoundingClientRect(),
              style = getComputedStyle(element),
              extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
            return {
              left: tab.left - extent - list.left,
              right: list.right - tab.right - extent,
              top: tab.top - extent - list.top,
              bottom: list.bottom - tab.bottom - extent,
            };
          });
          for (const edge of Object.values(focus)) expect(edge).toBeGreaterThanOrEqual(-0.5);
        }
        await page.getByRole("button", { name: /^Source details/ }).click();
        const popover = page.getByRole("region", { name: /^Source details/ });
        const box = await popover.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
      }
      expect(themeColors.size).toBe(2);
    }
    if (engine === "chromium") {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      const system = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "CanvasText";
        probe.style.backgroundColor = "Canvas";
        probe.style.borderColor = "ButtonText";
        probe.style.outlineColor = "Highlight";
        document.body.append(probe);
        const style = getComputedStyle(probe),
          colors = {
            text: style.color,
            background: style.backgroundColor,
            border: style.borderColor,
            focus: style.outlineColor,
          };
        probe.remove();
        return colors;
      });
      const iconButton = page.getByRole("button", { name: /^Add source/ });
      const painted = await iconButton.evaluate((element) => {
        const style = getComputedStyle(element),
          svg = element.querySelector("svg");
        return {
          color: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
          width: parseFloat(style.borderWidth),
          stroke: getComputedStyle(svg).stroke,
        };
      });
      expect(painted).toMatchObject({
        color: system.text,
        background: system.background,
        border: system.border,
        stroke: system.text,
      });
      expect(painted.width).toBeGreaterThan(0);
      expect(
        await page
          .getByRole("link", { name: /^Ohtia website/ })
          .evaluate((element) => getComputedStyle(element).textDecorationLine),
      ).toBe("underline");
      expect(
        await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
      ).toBe(true);
      const touchContext = await page.context().browser().newContext({ hasTouch: true });
      try {
        const touch = await touchContext.newPage();
        await touch.goto(url);
        expect(await touch.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(
          true,
        );
        const box = await touch
          .getByRole("button", { name: "Open dialog", exact: true })
          .boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
      } finally {
        await touchContext.close();
      }
    }
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: /^Open dialog/ }).focus();
    expect(
      await page
        .getByRole("button", { name: /^Open dialog/ })
        .evaluate((element) => getComputedStyle(element).outlineWidth),
    ).toBe("3px");
    await page.evaluate(() => {
      document.styleSheets[0].insertRule(
        "p {line-height:1.5 !important;margin-bottom:2em !important;}",
      );
      document.styleSheets[0].insertRule(
        "* {letter-spacing:.12em !important;word-spacing:.16em !important;}",
      );
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(requests.every((request) => request.startsWith(url))).toBe(true);
    expect(
      await page.evaluate(
        () => [...document.fonts].filter((font) => font.status === "error").length,
      ),
    ).toBe(0);
    // Offline here means network connections are disabled by CSP; font resources remain local.
    const csp = (await page.request.get(url)).headers()["content-security-policy"];
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("style-src 'self'");
    const scroll = page.locator(".primitive-table-scroll");
    await scroll.evaluate((element) => {
      const body = element.querySelector("tbody"),
        row = body.firstElementChild;
      for (let index = 0; index < 80; index++) body.append(row.cloneNode(true));
    });
    await scroll.evaluate((element) => {
      element.scrollTop = 100;
    });
    const before = await scroll.locator("thead th").first().boundingBox();
    await scroll.evaluate((element) => {
      element.scrollTop = 300;
    });
    const after = await scroll.locator("thead th").first().boundingBox();
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    const sortButton = scroll.getByRole("button", { name: /^Pages/ });
    await sortButton.focus();
    const sortFocus = await sortButton.evaluate((element) => {
      const box = element.getBoundingClientRect(),
        region = element.closest(".primitive-table-scroll").getBoundingClientRect(),
        style = getComputedStyle(element),
        extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return {
        left: box.left - extent - region.left,
        right: region.right - box.right - extent,
        top: box.top - extent - region.top,
        bottom: region.bottom - box.bottom - extent,
      };
    });
    for (const edge of Object.values(sortFocus)) expect(edge).toBeGreaterThanOrEqual(-0.5);
    await scroll.evaluate((element) => {
      [...element.querySelectorAll("tbody tr")].forEach((row, index) => {
        const cell = row.querySelector("td"),
          control = document.createElement("button");
        control.id = `interactive-row-${index}`;
        control.textContent = `Inspect row ${index}`;
        cell.replaceChildren(control);
      });
    });
    const headerHit = await scroll.evaluate((element) => {
      const control = element.querySelector("#interactive-row-25"),
        anchor = document.createElement("span");
      anchor.className = "primitive-layer-anchor";
      control.replaceWith(anchor);
      anchor.append(control);
      const head = element.querySelector("thead th:last-child");
      element.scrollTop += anchor.getBoundingClientRect().top - head.getBoundingClientRect().top;
      const box = anchor.getBoundingClientRect();
      return !!document
        .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        ?.closest("thead");
    });
    expect(headerHit).toBe(true);
    await scroll.evaluate((element) => {
      const target = element.querySelector("#interactive-row-25");
      element.scrollTop +=
        target.getBoundingClientRect().top - element.getBoundingClientRect().top - 6;
    });
    await page.locator("#interactive-row-26").focus();
    await page.keyboard.press("Shift+Tab");
    const bodyFocus = await page.locator("#interactive-row-25").evaluate((element) => {
      const table = element.closest("table"),
        style = getComputedStyle(element);
      return {
        top:
          element.getBoundingClientRect().top -
          parseFloat(style.outlineWidth) -
          parseFloat(style.outlineOffset),
        headerBottom: table.querySelector("thead th").getBoundingClientRect().bottom,
      };
    });
    expect(bodyFocus.top).toBeGreaterThanOrEqual(bodyFocus.headerBottom - 0.5);
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, `${engine}-catalog.png`), fullPage: true });
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
    return {
      engine,
      widths: [320, 600, 1024, 1280],
      themes: ["light", "dark"],
      expansion: true,
      mixedKorean: true,
      keyboard: true,
      csp: true,
      accessibilityTree: engine === "chromium",
      forcedColors: engine === "chromium",
      coarseTargets: engine === "chromium",
      nestedEscape: true,
      tabFocusVisibility: true,
      stickyTableHeader: true,
      limitations: [
        "Portable catalog only; native IME, packaged zoom and manual assistive qualification are separate.",
      ],
    };
  } finally {
    page.off("pageerror", error);
    page.off("console", consoleError);
    page.off("request", request);
  }
}
