import { expect } from "@playwright/test";

// Layout widths at actual size, then the 1280-DIP window at 200% and 400% zoom.
export const designViewportCases = Object.freeze([
  ...[320, 600, 1024, 1280].map((width) => Object.freeze({ width, height: 600, zoomFactor: 1 })),
  Object.freeze({ width: 1280, height: 600, zoomFactor: 2 }),
  Object.freeze({ width: 1280, height: 600, zoomFactor: 4 }),
]);

const specimenIds = ["design-ui", "design-document", "design-code", "design-math", "design-wrap"];

async function readNativeViewport(nativeWindow) {
  return nativeWindow.evaluate((window) => {
    const [width, height] = window.getContentSize();
    return {
      width,
      height,
      zoomFactor: window.webContents.getZoomFactor(),
      bounds: window.getBounds(),
    };
  });
}

async function observeViewport(page, nativeWindow) {
  const native = await readNativeViewport(nativeWindow);
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const scrolling = document.scrollingElement ?? root;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: root.clientWidth,
      scrollWidth: scrolling.scrollWidth,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        availableWidth: window.screen.availWidth,
        availableHeight: window.screen.availHeight,
      },
      specimens: [...document.querySelectorAll("#design-acceptance > p")].map((element) => ({
        id: element.id,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      })),
    };
  });
  return { native, ...layout };
}

/** Resize the real content area and use Electron page zoom, without viewport emulation. */
export async function setNativeViewport(page, nativeWindow, target, { timeout = 5000 } = {}) {
  await nativeWindow.evaluate((window, state) => {
    window.webContents.setZoomFactor(state.zoomFactor);
    window.setContentSize(state.width, state.height, false);
  }, target);
  let observed;
  try {
    await expect
      .poll(
        async () => {
          observed = await observeViewport(page, nativeWindow);
          return [
            observed.native.width,
            observed.native.height,
            observed.viewportWidth,
            observed.viewportHeight,
          ];
        },
        { message: `Native viewport ${target.width}px at ${target.zoomFactor * 100}%`, timeout },
      )
      .toEqual([
        target.width,
        target.height,
        Math.round(target.width / target.zoomFactor),
        Math.round(target.height / target.zoomFactor),
      ]);
  } catch (error) {
    throw new Error(
      `${error.message}\nNative geometry: ${JSON.stringify({ native: observed?.native, screen: observed?.screen })}`,
      { cause: error },
    );
  }
  expect(observed.native.zoomFactor, "Electron zoom factor").toBeCloseTo(target.zoomFactor, 8);
  return observed;
}

export function assertDesignViewport(observed, target) {
  const label = `${target.width}px at ${target.zoomFactor * 100}%`;
  expect(observed.native.width, `${label}: native content width`).toBe(target.width);
  expect(observed.native.height, `${label}: native content height`).toBe(target.height);
  expect(observed.native.zoomFactor, `${label}: native zoom`).toBeCloseTo(target.zoomFactor, 8);
  expect(observed.viewportWidth, `${label}: CSS viewport width`).toBe(
    Math.round(target.width / target.zoomFactor),
  );
  expect(observed.viewportHeight, `${label}: CSS viewport height`).toBe(
    Math.round(target.height / target.zoomFactor),
  );
  expect(observed.clientWidth, `${label}: positive layout width`).toBeGreaterThan(0);
  expect(observed.scrollWidth, `${label}: document horizontal overflow`).toBeLessThanOrEqual(
    observed.clientWidth,
  );
  expect(observed.specimens.map((item) => item.id).sort(), `${label}: role specimens`).toEqual(
    [...specimenIds].sort(),
  );
  for (const specimen of observed.specimens) {
    expect(specimen.clientWidth, `${label}/${specimen.id}: visible text`).toBeGreaterThan(0);
    expect(
      specimen.scrollWidth,
      `${label}/${specimen.id}: role horizontal overflow`,
    ).toBeLessThanOrEqual(specimen.clientWidth);
    expect(specimen.fontSize, `${label}/${specimen.id}: text below 12px`).toBeGreaterThanOrEqual(
      12,
    );
  }
}

/** Preserve native dimensions and origin zoom even if a boundary assertion fails. */
export async function verifyDesignViewports(page, nativeWindow) {
  const previous = await readNativeViewport(nativeWindow);
  const observations = [];
  let primaryError;
  try {
    for (const target of designViewportCases) {
      const observed = await setNativeViewport(page, nativeWindow, target);
      assertDesignViewport(observed, target);
      observations.push({ target, observed });
    }
    return observations;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await setNativeViewport(page, nativeWindow, previous);
    } catch (error) {
      if (primaryError)
        throw new AggregateError(
          [primaryError, error],
          `${primaryError.message}; viewport restoration failed: ${error.message}`,
        );
      throw error;
    }
  }
}
