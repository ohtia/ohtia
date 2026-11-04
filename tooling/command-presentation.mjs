/* global document, getComputedStyle, HTMLDialogElement, innerWidth, innerHeight, window */
import { expect } from "@playwright/test";

/** Inspect the admitted document without waiting for a denied navigation to complete. */
export async function observeCommandDialog(page, selector) {
  return page.evaluate((selector) => {
    const matches = document.querySelectorAll(selector);
    if (matches.length > 1) throw new Error("Command dialog selector must identify one surface.");
    const dialog = matches[0];
    if (!(dialog instanceof HTMLDialogElement)) return { open: false, visible: false };
    const bounds = dialog.getBoundingClientRect();
    return {
      open: dialog.open,
      visible:
        dialog.open &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        getComputedStyle(dialog).visibility === "visible",
    };
  }, selector);
}

/** Focus alone must reveal the target and its complete ring, without another control above it. */
export async function verifyCommandFocus(control) {
  await control.page().keyboard.press("Tab");
  await control.focus();
  await expect(control).toBeFocused();
  const observation = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    const offset = Number.parseFloat(style.outlineOffset);
    const ring = width + offset;
    const bounds = {
      left: rect.left - ring,
      right: rect.right + ring,
      top: rect.top - ring,
      bottom: rect.bottom + ring,
    };
    const issues = [];
    if (width < 3 || offset < 2) issues.push("Focus ring is below the declared width or offset.");
    if (
      bounds.left < 0 ||
      bounds.right > innerWidth ||
      bounds.top < 0 ||
      bounds.bottom > innerHeight
    )
      issues.push("Focus ring extends outside the viewport.");
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const computed = getComputedStyle(parent),
        box = parent.getBoundingClientRect();
      if (
        /auto|scroll|hidden|clip/.test(computed.overflowY) &&
        (bounds.top < box.top + parent.clientTop - 0.5 ||
          bounds.bottom > box.top + parent.clientTop + parent.clientHeight + 0.5)
      )
        issues.push("Focus ring is clipped vertically.");
      if (
        /auto|scroll|hidden|clip/.test(computed.overflowX) &&
        (bounds.left < box.left + parent.clientLeft - 0.5 ||
          bounds.right > box.left + parent.clientLeft + parent.clientWidth + 0.5)
      )
        issues.push("Focus ring is clipped horizontally.");
    }
    const points = [];
    for (let x = rect.left + 1; x < rect.right; x += 4)
      points.push(
        [x, rect.top + 1],
        [x, rect.bottom - 1],
        [x, bounds.top + 1],
        [x, bounds.bottom - 1],
      );
    for (let y = rect.top + 1; y < rect.bottom; y += 4)
      points.push(
        [rect.left + 1, y],
        [rect.right - 1, y],
        [bounds.left + 1, y],
        [bounds.right - 1, y],
      );
    for (const [x, y] of points) {
      const other = document
        .elementFromPoint(x, y)
        ?.closest("button,a,input,select,textarea,summary,[tabindex]");
      if (other && other !== element && !element.contains(other) && !other.contains(element)) {
        issues.push("Another interactive control obscures the target or ring.");
        break;
      }
    }
    return { bounds, width, offset, issues: [...new Set(issues)] };
  });
  expect(observation.issues).toEqual([]);
  return observation;
}

/** Inspect the selected real resource after browser layout and density changes settle. */
export async function verifyAboutRendition(image) {
  let observation;
  await expect
    .poll(async () => {
      observation = await image.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        ratio: window.devicePixelRatio,
        source: element.currentSrc,
        decoded: element.complete && element.naturalWidth > 0 && element.naturalHeight > 0,
      }));
      const extension = observation.width * observation.ratio > 512 ? "svg" : "png";
      return observation.decoded && observation.source.endsWith(`/illustration.${extension}`);
    })
    .toBe(true);
  expect(observation.width).toBe(observation.height);
  return observation;
}

/** Controlled viewport/density inputs; metric invalidation is real, not a synthetic resize event or monitor transfer. */
export async function verifyCommandDensities(cdp, image) {
  const observations = [];
  const viewport = await image.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  try {
    for (const [index, ratio] of [4, 8, 4, 4.01, 8].entries()) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height + 1 + (index % 2),
        deviceScaleFactor: ratio,
        mobile: false,
      });
      await expect.poll(() => image.evaluate(() => window.devicePixelRatio)).toBeCloseTo(ratio, 5);
      observations.push(await verifyAboutRendition(image));
    }
    await image.evaluate((element) => {
      element.style.maxInlineSize = "64px";
    });
    const capped = await verifyAboutRendition(image);
    expect(capped.width).toBe(64);
    expect(capped.source).toMatch(/illustration\.png$/);
    observations.push(capped);
  } finally {
    await image.evaluate((element) => element.style.removeProperty("max-inline-size"));
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
  observations.push(await verifyAboutRendition(image));
  return observations;
}

/** Read the actual Chromium accessibility tree; role-query heuristics differ for top-layer dialogs. */
export async function verifyCommandLandmarks(cdp) {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const dialogs = nodes.filter((node) => !node.ignored && node.role?.value === "dialog");
  expect(dialogs).toHaveLength(1);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const pending = [dialogs[0].nodeId];
  while (pending.length) {
    const node = byId.get(pending.pop());
    expect(node).toBeDefined();
    if (!node.ignored) expect(["banner", "contentinfo"]).not.toContain(node.role?.value);
    pending.push(...(node.childIds ?? []));
  }
}

/** Portable specimen checks share the exact focus and rendition assertions used by native qualification. */
export async function verifyCommandSpecimens(page, url, engine) {
  const { message } = await import("../packages/contracts/dist/index.js");
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const specimen = page.getByRole("region", { name: "Command surface specimens" });
  for (const theme of ["light", "dark"])
    for (const locale of ["en-US", "de-DE", "fi-FI", "ko-KR"])
      for (const height of [150, 300])
        for (const surface of ["about", "help"]) {
          await page.setViewportSize({ width: 320, height });
          await page.getByLabel("Theme", { exact: true }).selectOption(theme);
          await specimen.getByLabel("Command specimen language").selectOption(locale);
          const trigger = specimen.getByRole("button", {
            name: message(locale, `command.${surface}.open`),
            exact: true,
          });
          await trigger.click();
          const dialog = page.locator(`.${surface}-dialog[open]`);
          await expect(dialog).toBeVisible();
          for (const control of [
            dialog.locator("[data-close]"),
            surface === "about"
              ? dialog.locator(".about-version button")
              : dialog.getByRole("button", {
                  name: message(locale, "command.shortcuts.open"),
                  exact: true,
                }),
            dialog.locator(".command-dialog-footer button"),
          ])
            await verifyCommandFocus(control);
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
        }
  await specimen.getByLabel("Command specimen language").selectOption("en-US");
  // Reserve the classic scrollbar gutter even in headless browsers that hide scrollbars.
  // This exercises the available containing width rather than assuming 100vw is usable.
  try {
    await page.evaluate(() => (document.documentElement.style.scrollbarGutter = "stable"));
    for (const width of [320, 600, 1024, 1280]) {
      await page.setViewportSize({ width, height: 600 });
      for (const surface of ["about", "help"]) {
        await specimen
          .getByRole("button", { name: message("en-US", `command.${surface}.open`), exact: true })
          .click();
        const geometry = await page.locator(`.${surface}-dialog[open]`).evaluate((dialog) => {
          const bounds = dialog.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            viewport: innerWidth,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(15);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport - 15);
        expect(geometry.width).toBeLessThanOrEqual(480);
        await page.keyboard.press("Escape");
      }
    }
  } finally {
    await page.evaluate(() => document.documentElement.style.removeProperty("scrollbar-gutter"));
  }
  if (engine === "chromium") {
    await page.setViewportSize({ width: 800, height: 600 });
    await specimen
      .getByRole("button", { name: message("en-US", "command.about.open"), exact: true })
      .click();
    const cdp = await page.context().newCDPSession(page);
    try {
      await verifyCommandLandmarks(cdp);
      await verifyCommandDensities(cdp, page.locator(".about-dialog[open] img"));
      await page.keyboard.press("Escape");
      await specimen
        .getByRole("button", { name: message("en-US", "command.help.open"), exact: true })
        .click();
      await verifyCommandLandmarks(cdp);
    } finally {
      await cdp.detach();
    }
    await page.keyboard.press("Escape");
  }
}
