/* global document, getComputedStyle, innerHeight, innerWidth, navigator */
import { expect } from "@playwright/test";
import { focusNative } from "./command-native-focus.mjs";
import { verifyCommandFocus } from "./command-presentation.mjs";
import { setNativeViewport } from "./design-viewport.mjs";

/** Layout units are 1/64 CSS px; a smaller overlap is rounding between overlay and layout. */
const layoutTolerance = 1 / 64;

/**
 * The minimum content size at zoom levels that keep at least the 320 CSS px reflow width,
 * then the documented 400% and 200% zoom-reflow cases. Each size also lowers zoom without
 * resizing, so stale overlay geometry would under-reserve. Text-spacing overrides run at the
 * reported minimum and at the most height-constrained case, bounding the packaged suite time.
 */
export const dialogSafeAreaViewports = Object.freeze([
  Object.freeze({ width: 320, height: 400, zoomFactor: 1, textSpacing: true }),
  Object.freeze({ width: 320, height: 400, zoomFactor: 0.75, textSpacing: false }),
  Object.freeze({ width: 320, height: 400, zoomFactor: 0.9, textSpacing: false }),
  Object.freeze({ width: 1280, height: 600, zoomFactor: 4, textSpacing: true }),
  Object.freeze({ width: 1280, height: 600, zoomFactor: 2, textSpacing: false }),
]);

/** Delivered workspace dialogs, opened through their registered native menu commands. */
export const safeAreaDialogs = Object.freeze([
  Object.freeze({ command: "settings.open", selector: ".settings-dialog[open]" }),
  Object.freeze({ command: "palette.open", selector: ".command-palette[open]" }),
  Object.freeze({ command: "shortcuts.open", selector: ".shortcuts-dialog[open]" }),
  Object.freeze({ command: "help.open", selector: ".help-dialog[open]" }),
  Object.freeze({ command: "about.open", selector: ".about-dialog[open]" }),
]);

/**
 * The system controls occupy the overlay band outside the usable title-bar area: before it
 * (macOS traffic lights) and after it (Windows and Linux controls).
 */
export function windowControlsExclusions(titlebar, viewportWidth) {
  const values = [titlebar?.x, titlebar?.y, titlebar?.width, titlebar?.height, viewportWidth];
  if (!values.every(Number.isFinite) || titlebar.width < 0 || titlebar.height <= 0)
    throw new Error("Window Controls Overlay geometry is unavailable.");
  const top = titlebar.y;
  const bottom = titlebar.y + titlebar.height;
  return [
    { left: 0, right: titlebar.x, top, bottom },
    { left: titlebar.x + titlebar.width, right: viewportWidth, top, bottom },
  ].filter((area) => area.right > area.left);
}

/** Positive overlaps of one rendered rectangle with the reserved system-control areas. */
export function safeAreaIntersections(bounds, exclusions) {
  return exclusions.flatMap((area) => {
    const width = Math.min(bounds.right, area.right) - Math.max(bounds.left, area.left);
    const height = Math.min(bounds.bottom, area.bottom) - Math.max(bounds.top, area.top);
    return width > layoutTolerance && height > layoutTolerance ? [{ area, width, height }] : [];
  });
}

/** Keep the primary failure when cleanup also fails, as native viewport restoration does. */
export async function withCleanup(operation, cleanup, description) {
  let failure;
  try {
    return await operation();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (failure)
        throw new AggregateError(
          [failure, error],
          `${failure.message}; ${description} failed: ${error.message}`,
        );
      throw error;
    }
  }
}

/** Read the live overlay rectangle; a hidden overlay cannot establish the safe area. */
async function readTitlebar(page) {
  return page.evaluate(() => {
    const overlay = navigator.windowControlsOverlay;
    const rect = overlay?.visible ? overlay.getTitlebarAreaRect() : undefined;
    return {
      visible: overlay?.visible ?? null,
      titlebar: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}

/**
 * Apply WCAG 1.4.12 text-spacing overrides through CSSOM, which the document CSP admits.
 * Removal does not wait for a dialog that a failing step may already have closed.
 */
function setTextSpacing(page, selector, enabled) {
  return page.evaluate(
    ({ selector, active }) => {
      const element = document.querySelector(selector);
      if (!element) {
        if (active) throw new Error(`Text spacing target is missing: ${selector}`);
        return;
      }
      for (const node of [element, ...element.querySelectorAll("*")]) {
        for (const [property, value] of [
          ["line-height", "1.5"],
          ["letter-spacing", "0.12em"],
          ["word-spacing", "0.16em"],
        ])
          if (active) node.style.setProperty(property, value);
          else node.style.removeProperty(property);
        if (node.tagName === "P")
          if (active) node.style.setProperty("margin-block-end", "2em");
          else node.style.removeProperty("margin-block-end");
      }
    },
    { selector, active: enabled },
  );
}

/** Every keyboard-reachable control, focused into view, with its complete focus ring. */
async function verifyDialogControls(dialog, exclusions, label) {
  const controls = dialog.locator("button, [href], input, select, textarea, [tabindex], summary");
  const count = await controls.count();
  const observations = [];
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index);
    const reachable = await control.evaluate(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        element.getClientRects().length > 0,
    );
    if (!reachable) continue;
    const { bounds } = await verifyCommandFocus(control);
    const name = await control.evaluate(
      (element) =>
        element.getAttribute("aria-label") ||
        element.textContent.trim().slice(0, 40) ||
        element.getAttribute("type") ||
        element.tagName.toLowerCase(),
    );
    expect(
      safeAreaIntersections(bounds, exclusions),
      `${label}: ${name} and its focus ring stay outside the window controls`,
    ).toEqual([]);
    observations.push(name);
  }
  expect(observations.length, `${label}: keyboard-reachable controls`).toBeGreaterThan(0);
  return observations;
}

/** The active palette option, reached by arrow key, stays fully visible and outside the band. */
async function verifyPaletteOption(dialog, exclusions, label) {
  const input = dialog.getByRole("combobox");
  await input.focus();
  await input.press("ArrowDown");
  const option = await dialog.evaluate((element) => {
    const input = element.querySelector('[role="combobox"]');
    const active =
      input &&
      element.ownerDocument.getElementById(input.getAttribute("aria-activedescendant") ?? "");
    const list = active?.closest(".palette-list");
    if (!active || !list) return null;
    const rect = active.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    return {
      bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      list: {
        top: box.top + list.clientTop,
        bottom: box.top + list.clientTop + list.clientHeight,
      },
    };
  });
  expect(option, `${label}: palette exposes an active option`).not.toBeNull();
  expect(option.bounds.top, `${label}: active option top is visible`).toBeGreaterThanOrEqual(
    option.list.top - 0.5,
  );
  expect(option.bounds.bottom, `${label}: active option bottom is visible`).toBeLessThanOrEqual(
    option.list.bottom + 0.5,
  );
  expect(
    safeAreaIntersections(option.bounds, exclusions),
    `${label}: active option stays outside the window controls`,
  ).toEqual([]);
  return option;
}

async function verifyDialogCase(page, dialog, label, zoomFactor, reference) {
  const { visible, titlebar, viewport } = await readTitlebar(page);
  expect(visible, `${label}: Window Controls Overlay must be visible`).toBe(true);
  const exclusions = windowControlsExclusions(titlebar, viewport.width);
  // The overlay band has one native height; CSS px must follow every zoom change.
  const nativeBand = (titlebar.y + titlebar.height) * zoomFactor;
  if (reference.nativeBand === undefined) reference.nativeBand = nativeBand;
  expect(
    Math.abs(nativeBand - reference.nativeBand),
    `${label}: overlay band follows the current zoom`,
  ).toBeLessThanOrEqual(zoomFactor);
  const surface = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      horizontalOverflow: element.scrollWidth > element.clientWidth,
    };
  });
  expect(
    safeAreaIntersections(surface, exclusions),
    `${label}: dialog surface stays outside the window controls`,
  ).toEqual([]);
  expect(surface.bottom, `${label}: dialog fits the viewport`).toBeLessThanOrEqual(
    viewport.height + layoutTolerance,
  );
  expect(surface.horizontalOverflow, `${label}: dialog horizontal overflow`).toBe(false);
  const controls = await verifyDialogControls(dialog, exclusions, label);
  const option = (await dialog.evaluate((element) => element.matches(".command-palette")))
    ? await verifyPaletteOption(dialog, exclusions, label)
    : undefined;
  return { titlebar, nativeBand, viewport, exclusions, surface, controls, option };
}

/**
 * Open each delivered dialog at the minimum window and supported zoom cases, in both themes and
 * with text-spacing overrides, and keep it and every focus ring outside the native controls.
 */
export async function verifyDialogSafeAreas({ page, native, invoke, trigger }) {
  const originalSize = await native.evaluate((window) => window.getContentSize());
  const originalZoom = await native.evaluate((window) => window.webContents.getZoomFactor());
  const originalAppearance = await page.evaluate(
    () => document.documentElement.dataset.appearance ?? null,
  );
  const observations = [];
  const reference = {};
  const resize = async (target) => {
    await setNativeViewport(page, native, target);
    // A compositor can move focus during resize; native menu dispatch uses the focused window.
    await focusNative(native, `dialog safe area ${target.width}x${target.height}`);
  };
  return withCleanup(
    async () => {
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.appearance = value),
          theme,
        );
        for (const target of dialogSafeAreaViewports) {
          await resize(target);
          for (const { command, selector } of safeAreaDialogs) {
            const dialog = page.locator(selector);
            await trigger.focus();
            await invoke(command);
            await expect(dialog, `${command} opens`).toBeVisible();
            for (const textSpacing of target.textSpacing ? [false, true] : [false]) {
              const label = `${command} ${theme} ${target.width}x${target.height} at ${target.zoomFactor * 100}%${textSpacing ? " with text spacing" : ""}`;
              if (textSpacing) await setTextSpacing(page, selector, true);
              observations.push({
                command,
                theme,
                target,
                textSpacing,
                ...(await withCleanup(
                  () => verifyDialogCase(page, dialog, label, target.zoomFactor, reference),
                  () => (textSpacing ? setTextSpacing(page, selector, false) : undefined),
                  "text-spacing removal",
                )),
              });
            }
            await page.keyboard.press("Escape");
            await expect(dialog, `${command} closes with Escape`).toHaveCount(0);
            await expect(trigger, `${command} restores focus`).toBeFocused();
          }
        }
      }
      // Pointer activation of the relocated Close button still dismisses Settings.
      await resize(dialogSafeAreaViewports.find((target) => target.zoomFactor === 1));
      await trigger.focus();
      await invoke("settings.open");
      const settings = page.locator(".settings-dialog[open]");
      await expect(settings).toBeVisible();
      await settings.locator("[data-close]").click();
      await expect(settings).toHaveCount(0);
      await expect(trigger).toBeFocused();
      return {
        cases: [
          "dialogs-outside-window-controls-at-minimum-size-and-zoom",
          "dialog-focus-rings-outside-window-controls-with-text-spacing",
          "dialog-escape-and-close-restore-focus",
          "dialog-overlay-band-follows-zoom-decrease",
          "palette-active-option-visible-outside-window-controls",
        ],
        observations,
        limitations: [
          "Window Controls Overlay geometry is read from Chromium; native pixels, system-control activation, window movement and resize require independent native observation.",
          "Zoom above 100% at the 320 x 400 minimum is below the 320 CSS px reflow width and is covered by the 1280 x 600 zoom cases.",
        ],
      };
    },
    async () => {
      await page.keyboard.press("Escape");
      await page.evaluate((value) => {
        if (value === null) delete document.documentElement.dataset.appearance;
        else document.documentElement.dataset.appearance = value;
      }, originalAppearance);
      await setNativeViewport(page, native, {
        width: originalSize[0],
        height: originalSize[1],
        zoomFactor: originalZoom,
      });
    },
    "dialog safe-area restoration",
  );
}
