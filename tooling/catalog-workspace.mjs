/* global document, window, getComputedStyle */
import path from "node:path";
import { expect } from "@playwright/test";

async function assertChromeBounds(page) {
  const results = await page.locator(".workspace-title-row").evaluate((row) => {
    const bounds = row.getBoundingClientRect();
    return [...row.querySelectorAll("button, .ohtia-brand")].map((control) => {
      const rect = control.getBoundingClientRect();
      return {
        name: control.getAttribute("aria-label") ?? control.textContent,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        start: bounds.left,
        end: bounds.right,
        floor: bounds.bottom,
      };
    });
  });
  for (const item of results) {
    expect(item.left, item.name).toBeGreaterThanOrEqual(item.start);
    expect(item.right, item.name).toBeLessThanOrEqual(item.end);
    expect(item.top, item.name).toBeGreaterThanOrEqual(0);
    expect(item.bottom, item.name).toBeLessThanOrEqual(item.floor);
  }
  const outside = await page.locator(".workspace button:visible").evaluateAll((controls) =>
    controls
      .filter((control) => {
        // Offscreen content in a local scroll region is reachable by normal scrolling.
        if (control.closest(".workspace-panel-scroll")) return false;
        const rect = control.getBoundingClientRect();
        return (
          rect.left < 0 ||
          rect.right > window.innerWidth ||
          rect.top < 0 ||
          rect.bottom > window.innerHeight
        );
      })
      .map((control) => control.getAttribute("aria-label") ?? control.textContent),
  );
  expect(outside).toEqual([]);
  const overlap = await page.locator("[role=separator]").evaluateAll((separators) =>
    separators.map((element) => {
      const hit = element.getBoundingClientRect();
      const left = document
        .querySelector(
          `[data-workspace-panel="${element.dataset.separatorLeft}"] .workspace-panel-scroll`,
        )
        .getBoundingClientRect();
      const right = document
        .querySelector(
          `[data-workspace-panel="${element.dataset.separatorRight}"] .workspace-panel-scroll`,
        )
        .getBoundingClientRect();
      return { left: left.right - hit.left, right: hit.right - right.left };
    }),
  );
  const coveredControls = await page.locator(".workspace").evaluate((root) => {
    const hits = [...root.querySelectorAll("[role=separator]")].map((element) =>
      element.getBoundingClientRect(),
    );
    return [...root.querySelectorAll("button")]
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          hits.some(
            (hit) =>
              Math.min(rect.right, hit.right) > Math.max(rect.left, hit.left) &&
              Math.min(rect.bottom, hit.bottom) > Math.max(rect.top, hit.top),
          )
        );
      })
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
  });
  expect(coveredControls).toEqual([]);
  const footerHits = await page
    .locator(".workspace-explorer:not([hidden]) .workspace-explorer-footer button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.right - 1, rect.top + rect.height / 2);
        return {
          name: button.getAttribute("aria-label"),
          correct: hit?.closest("button") === button,
        };
      }),
    );
  for (const hit of footerHits) expect(hit.correct, hit.name).toBe(true);
  for (const pair of overlap) {
    expect(pair.left).toBeLessThanOrEqual(0);
    expect(pair.right).toBeLessThanOrEqual(0);
  }
}
async function assertRailTargets(page, width, size) {
  expect((await page.locator(".workspace-rail").boundingBox()).width).toBe(width);
  const targets = await page.locator(".workspace-rail button").all();
  expect(targets).toHaveLength(2);
  for (const target of targets) {
    const rect = await target.boundingBox();
    expect([rect.width, rect.height]).toEqual([size, size]);
    expect(
      await target.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return (
          document
            .elementFromPoint(rect.right - 0.5, rect.top + rect.height / 2)
            ?.closest("button") === button
        );
      }),
    ).toBe(true);
  }
}
async function focusByTab(page, target) {
  await page.bringToFront();
  // Establish the document's controlled start; reach the target only with real Tab input.
  await page.locator(".workspace-skip").focus();
  await expect(page.locator(".workspace-skip")).toBeFocused();
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  const name = await target.evaluate(
    (element) =>
      element.getAttribute("aria-label") ?? element.getAttribute("role") ?? element.className,
  );
  const active = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
  );
  throw new Error(`Keyboard journey did not reach ${name}; final focus: ${active}`);
}
async function assertFocusGuard(target) {
  await expect(target).toHaveCSS("outline-width", "3px");
  await expect(target).toHaveCSS("outline-offset", "2px");
  const bounds = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const clip = element.closest(".workspace-regions").getBoundingClientRect();
    const css = getComputedStyle(element);
    const guard = parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset);
    return {
      left: rect.left - guard,
      right: rect.right + guard,
      top: rect.top - guard,
      bottom: rect.bottom + guard,
      clip: { left: clip.left, right: clip.right, top: clip.top, bottom: clip.bottom },
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.clip.left);
  expect(bounds.right).toBeLessThanOrEqual(bounds.clip.right);
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.clip.top);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.clip.bottom);
}
export async function verifyWorkspaceSpecimen(page, url, engine, output) {
  const { message } = await import("../packages/contracts/dist/index.js");
  const errors = [];
  const error = (value) => errors.push(String(value));
  page.on("pageerror", error);
  const route = (extra = "") => `${url}?screen=workspace${extra}`;
  try {
    for (const theme of ["light", "dark"]) {
      for (const width of [1440, 1280, 1024, 1023, 600, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route(`&theme=${theme}`));
        await expect(
          page.locator('.workspace [aria-label="Hide chat"], .workspace-selector'),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const measured = await page.locator(".workspace").evaluate((root) => ({
          width: root.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          row: root.querySelector(".workspace-title-row").getBoundingClientRect().height,
          panels: [...root.querySelectorAll("[data-workspace-panel]:not([hidden])")].map(
            (panel) => panel.getBoundingClientRect().width,
          ),
          separators: root.querySelectorAll("[role=separator]").length,
        }));
        await assertChromeBounds(page);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.locator(".workspace-welcome h1")).toHaveCSS("line-height", "40px");
        await expect(page.locator(".workspace-project-context")).toHaveCSS("line-height", "21px");
        expect(measured.width).toBe(width);
        expect(measured.pageWidth).toBeLessThanOrEqual(width);
        expect(measured.row).toBe(48);
        expect(measured.panels).toEqual(
          width === 1440
            ? [256, 816, 360]
            : width === 1280
              ? [256, 656, 360]
              : width === 1024
                ? [200, 536, 280]
                : [width],
        );
        expect(measured.separators).toBe(width >= 1024 ? 2 : 0);
        if (width < 1024) {
          const chat = page.getByRole("button", { name: "Chat", exact: true });
          await chat.click();
          await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeFocused();
          await expect(chat).toHaveAttribute("aria-pressed", "true");
          await expect(page.getByRole("button", { name: "Settings…", exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Documents", exact: true }).click();
        }
        if ([1280, 600].includes(width))
          await page.screenshot({
            path: path.join(output, `${engine}-workspace-${width}-${theme}.png`),
          });
      }
    }
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route(`&theme=${theme}`));
      const separator = page.getByRole("separator").nth(1);
      await separator.hover();
      await expect(separator.locator(".workspace-splitter-line")).toHaveCSS("inline-size", "4px");
      const grip = await separator.locator(".workspace-grip").boundingBox();
      expect([grip.width, grip.height]).toEqual([16, 32]);
      await page.screenshot({ path: path.join(output, `${engine}-separator-hover-${theme}.png`) });
      const box = await separator.boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 64, y);
      await expect(separator).toHaveAttribute("aria-valuenow", "592");
      expect(
        await separator
          .locator(".workspace-splitter-line")
          .evaluate((element) => getComputedStyle(element).borderColor),
      ).toBe(
        await page.locator(".workspace").evaluate((element) => getComputedStyle(element).color),
      );
      await page.screenshot({
        path: path.join(output, `${engine}-separator-dragging-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(separator).toHaveAttribute("aria-valuenow", "656");
      await page.mouse.up();
      await expect(page.locator("output[data-synthetic-saves]")).toHaveAttribute(
        "data-synthetic-saves",
        "0",
      );
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 64, y);
      await page.mouse.up();
      await expect(separator).toHaveAttribute("aria-valuenow", "592");
      await expect(page.locator("output[data-synthetic-saves]")).toHaveAttribute(
        "data-synthetic-saves",
        "1",
      );
      await expect(page.getByRole("alert")).toContainText(
        message("en-US", "workspace.notRemembered"),
      );
      await page.screenshot({ path: path.join(output, `${engine}-save-failed-${theme}.png`) });
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      const before = Number(
        await page.locator("output[data-synthetic-saves]").getAttribute("data-synthetic-saves"),
      );
      await separator.dblclick();
      await expect(separator).toHaveAttribute("aria-valuenow", "656");
      await expect(page.locator("output[data-synthetic-saves]")).toHaveAttribute(
        "data-synthetic-saves",
        String(before + 1),
      );
      await focusByTab(page, separator);
      await assertFocusGuard(separator);
      await page.keyboard.press("Home");
      await expect(separator).toHaveAttribute("data-minimum", "left");
      await expect(separator).toHaveCSS("cursor", "e-resize");
      await expect(separator.locator("..").getByRole("tooltip")).toContainText("Minimum");
      await page.screenshot({
        path: path.join(output, `${engine}-separator-minimum-${theme}.png`),
      });
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Expand document", exact: true }).click();
      await page.getByRole("button", { name: "Hide documents", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toContainText(
        message("en-US", "command.reason.last_panel"),
      );
      await page.screenshot({ path: path.join(output, `${engine}-last-panel-${theme}.png`) });
      await page.getByRole("button", { name: "Return to previous layout", exact: true }).click();
      await expect(page.locator(".workspace-attention")).toHaveCount(0);
      await page.getByRole("button", { name: "Expand document", exact: true }).click();
      await page.screenshot({ path: path.join(output, `${engine}-focus-${theme}.png`) });
      await page.getByRole("button", { name: "Return to previous layout", exact: true }).click();
      await page.goto(route(`&theme=${theme}&uncertain`));
      await page.getByRole("button", { name: "Hide chat", exact: true }).click();
      await expect(page.locator(".workspace-attention")).toContainText(
        message("en-US", "workspace.uncertain"),
      );
      await page.screenshot({ path: path.join(output, `${engine}-save-uncertain-${theme}.png`) });
      await page.getByRole("button", { name: "Check", exact: true }).click();
      await expect(page.locator("output[data-synthetic-saves]")).toHaveAttribute(
        "data-synthetic-saves",
        "1",
      );
      await page.goto(route(`&theme=${theme}`));
      await page.locator(".workspace-skip").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".workspace-documents > h2")).toBeFocused();
      await expect(page.getByRole("tab")).toHaveCSS("outline-width", "3px");
      await expect(page.getByRole("tab")).toHaveCSS("outline-offset", "2px");
      await page.screenshot({ path: path.join(output, `${engine}-heading-focus-${theme}.png`) });
      await page.setViewportSize({ width: 600, height: 400 });
      await expect(page.locator(".workspace")).toHaveAttribute("data-mode", "narrow");
      await focusByTab(page, page.locator(".workspace-documents .workspace-panel-scroll"));
      await assertFocusGuard(page.locator(".workspace-documents .workspace-panel-scroll"));
      await focusByTab(page, page.getByRole("button", { name: "Chat", exact: true }));
      await page.keyboard.press("Enter");
      await assertFocusGuard(page.getByRole("heading", { name: "Chat", exact: true }));
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route());
    await focusByTab(
      page,
      page.getByRole("button", { name: "Increase width of Documents", exact: true }),
    );
    await assertFocusGuard(
      page.getByRole("button", { name: "Increase width of Documents", exact: true }),
    );
    for (const command of ["settings.open", "panels.explorer"]) {
      await page.getByRole("button", { name: "Expand document", exact: true }).click();
      await assertRailTargets(page, 40, 32);
      const railControl = page.locator(`.workspace-rail [data-workspace-command="${command}"]`);
      await focusByTab(page, railControl);
      await assertFocusGuard(railControl);
      await page.evaluate(() => document.dispatchEvent(new window.Event("synthetic:layout-reset")));
      await expect(page.locator(".workspace-rail")).toHaveCount(0);
      await expect(
        page.locator(
          command === "settings.open"
            ? '.workspace-explorer-footer [data-workspace-command="settings.open"]'
            : '.workspace-title-row [data-workspace-command="panels.explorer"]',
        ),
      ).toBeFocused();
    }
    for (const width of [1280, 600, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route("&zoom=400"));
      const indicator = page.locator('[data-workspace-command="zoom.reset"]');
      await expect(indicator).toBeVisible();
      await expect(indicator).toHaveCSS("font-variant-numeric", "tabular-nums");
      await expect(indicator).toHaveCSS("line-height", "20px");
      await assertChromeBounds(page);
      await indicator.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("output[data-synthetic-zoom-intents]")).toHaveAttribute(
        "data-synthetic-zoom-intents",
        "1",
      );
      await expect(indicator).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.matches(".workspace button"))).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route());
    await page.locator(".workspace").evaluate((element) => {
      element.style.inlineSize = "1023.64px";
    });
    await expect(page.locator(".workspace")).toHaveAttribute("data-mode", "narrow");
    expect((await page.locator(".workspace-documents").boundingBox()).width).toBe(1023);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route());
    const splitter = page.getByRole("separator").nth(1);
    await splitter.focus();
    await page.keyboard.press("Home");
    await expect(splitter).toHaveAttribute("aria-valuenow", "320");
    await page.keyboard.press("Enter");
    await expect(splitter).toHaveAttribute("aria-valuenow", "656");
    await page.getByRole("button", { name: "Expand document", exact: true }).click();
    const restore = page.getByRole("button", { name: "Return to previous layout", exact: true });
    await expect(restore).toBeFocused();
    await expect(page.locator(".workspace-rail")).toBeVisible();
    await restore.click();
    await page.getByRole("button", { name: "Hide chat", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Chat", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Open chat", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Open Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Synthetic command destination" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open Settings", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Ohtia help", exact: true }).click();
    await page.setViewportSize({ width: 600, height: 400 });
    await expect(page.locator(".workspace")).toHaveAttribute("data-mode", "narrow");
    await expect(page.locator(".workspace-explorer")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator(".workspace-skip")).toBeFocused();
    const skip = await page.locator(".workspace-skip").boundingBox();
    expect(skip.y).toBeGreaterThanOrEqual(48);
    for (const locale of ["ko-KR", "de-DE", "fi-FI", "fr-FR", "pt-BR"]) {
      await page.setViewportSize({ width: 320, height: 400 });
      await page.goto(route(`&locale=${locale}`));
      await expect(
        page.getByRole("heading", { name: message(locale, "workspace.welcome") }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      await expect(page.locator(".workspace-selector button")).toHaveCount(3);
    }
    await page.setViewportSize({ width: 600, height: 400 });
    await page.goto(route("&publishFails"));
    await expect(page.getByRole("alert")).toContainText(message("en-US", "command.failed"));
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(400);
    await page.setViewportSize({ width: 600, height: 400 });
    await page.goto(route("&hidden"));
    await expect(page.locator(".workspace .about-character")).toHaveCount(0);
    await page.locator(".workspace *").evaluateAll((elements) => {
      for (const element of elements) {
        element.style.letterSpacing = ".12em";
        element.style.wordSpacing = ".16em";
        element.style.lineHeight = "1.5";
      }
    });
    await page.locator(".workspace p").evaluateAll((elements) => {
      for (const element of elements) element.style.marginBlock = "2em";
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(600);
    if (engine === "chromium") {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await expect(page.locator(".workspace-selector button[aria-pressed=true]")).toHaveCSS(
        "border-top-style",
        "solid",
      );
      await expect(page.locator(".workspace-selector button[aria-pressed=true]")).toHaveCSS(
        "border-top-width",
        "1px",
      );
      for (const control of await page
        .locator(".workspace-selector button:not([aria-pressed=true])")
        .all())
        await expect(control).toHaveCSS("border-top-width", "0px");
      await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    }
    if (engine === "chromium") {
      const browser = page.context().browser();
      const coarse = await browser.newContext({
        hasTouch: true,
        viewport: { width: 1280, height: 800 },
      });
      try {
        const touch = await coarse.newPage();
        await touch.goto(route());
        await expect(touch.locator('.workspace [aria-label="Hide chat"]')).toBeVisible();
        await assertChromeBounds(touch);
        const targets = await touch.locator(".workspace button:visible").evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              name: element.getAttribute("aria-label") ?? element.textContent,
              width: rect.width,
              height: rect.height,
            };
          }),
        );
        for (const target of targets) {
          expect(target.width, target.name).toBeGreaterThanOrEqual(44);
          expect(target.height, target.name).toBeGreaterThanOrEqual(44);
        }
        await touch.getByRole("button", { name: "Expand document", exact: true }).click();
        await assertRailTargets(touch, 48, 44);
        for (const command of ["settings.open", "panels.explorer"]) {
          const target = touch.locator(`.workspace-rail [data-workspace-command="${command}"]`);
          await focusByTab(touch, target);
          await assertFocusGuard(target);
        }
        await touch.getByRole("button", { name: "Return to previous layout", exact: true }).click();
        await touch.getByRole("button", { name: "Fold project contents", exact: true }).click();
        await touch.getByRole("button", { name: "Hide documents", exact: true }).click();
        await assertRailTargets(touch, 48, 44);
        await touch.locator(".workspace-skip").focus();
        await touch.keyboard.press("Enter");
        const heading = touch.getByRole("heading", { name: "Chat", exact: true });
        await expect(heading).toBeFocused();
        await assertFocusGuard(heading);
        const clearance = await heading.evaluate((element) => {
          const rect = element.getBoundingClientRect(),
            css = getComputedStyle(element);
          const guard = parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset);
          const ringLeft = rect.left - guard;
          return {
            textInset:
              rect.left +
              parseFloat(css.paddingLeft) -
              element.closest("[data-workspace-panel]").getBoundingClientRect().left,
            covered: [...document.querySelectorAll(".workspace-rail button")]
              .filter((button) => {
                const box = button.getBoundingClientRect();
                return (
                  box.right > ringLeft &&
                  box.left < ringLeft + parseFloat(css.outlineWidth) &&
                  box.top < rect.bottom + guard &&
                  box.bottom > rect.top - guard
                );
              })
              .map((button) => button.getAttribute("aria-label")),
          };
        });
        expect(clearance.textInset).toBe(32);
        expect(clearance.covered).toEqual([]);
        await touch.screenshot({ path: path.join(output, `${engine}-coarse-chat-heading.png`) });
      } finally {
        await coarse.close();
      }
    }
    // The browser reference can verify declared safe areas; native measurements belong to the window producer.
    for (const width of [1440, 1280, 1024, 1023, 600, 320])
      for (const platform of ["linux", "darwin"]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(
          route(
            `&platform=${platform}&start=${platform === "darwin" ? 76 : 0}&end=${platform === "darwin" ? 0 : 138}`,
          ),
        );
        await expect(page.locator('.workspace-selector, [aria-label="Hide chat"]')).toBeVisible();
        await assertChromeBounds(page);
        const context = page.locator(".workspace-project-context");
        await context.hover();
        await expect(page.locator(".workspace-context-tooltip [role=tooltip]")).toHaveText(
          message("en-US", "workspace.noProject"),
        );
        const bounds = await page.locator(".workspace-title-row").boundingBox();
        const tip = await page.locator(".workspace-context-tooltip [role=tooltip]").boundingBox();
        expect(tip.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
        expect(bounds.x).toBe(platform === "darwin" ? 76 : 0);
        expect(bounds.x + bounds.width).toBe(platform === "darwin" ? width : width - 138);
      }
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto(route("&expanded"));
    await expect(page.locator(".workspace-selector")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
    await page.goto(`${url}?screen=scoped-workspace`);
    await page.getByRole("tab", { name: "Synthetic draft", exact: true }).focus();
    await page.keyboard.press("Enter");
    const buffer = page.getByRole("textbox", { name: "Synthetic buffer", exact: true });
    await buffer.fill("Newer researcher buffer 연구");
    await page.getByRole("button", { name: "Delayed selection", exact: true }).click();
    await page.getByRole("button", { name: "Switch synthetic scope", exact: true }).click();
    await expect(buffer).toHaveValue("Synthetic manuscript buffer B");
    await buffer.fill("Private buffer B");
    await page.getByRole("button", { name: "Switch synthetic scope", exact: true }).click();
    await buffer.focus();
    await buffer.evaluate((element) => {
      element.setSelectionRange(4, 9);
    });
    await expect(
      page.getByText("Scope A, incarnation 2, selection original", { exact: true }),
    ).toBeVisible();
    // Settle the delayed callback deterministically after revisiting A with a newer incarnation.
    await page.clock.runFor(150);
    await expect(buffer).toHaveValue("Newer researcher buffer 연구");
    await expect(buffer).toBeFocused();
    expect(
      await buffer.evaluate((element) => [element.selectionStart, element.selectionEnd]),
    ).toEqual([4, 9]);
    await expect(
      page.getByText("Scope A, incarnation 2, selection original", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delayed selection", exact: true }).click();
    await page.getByRole("button", { name: "Dispose synthetic view", exact: true }).click();
    await page.clock.runFor(150);
    await expect(
      page.getByText("Scope A, incarnation 2, selection original", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    return {
      widths: [1440, 1280, 1024, 1023, 600, 320],
      themes: ["light", "dark"],
      syntheticScopes: true,
      limits: [
        "Portable reference; native window controls, real zoom and assistive journeys require native evidence.",
      ],
    };
  } finally {
    page.off("pageerror", error);
  }
}
