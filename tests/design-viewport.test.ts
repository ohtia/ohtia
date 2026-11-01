import { describe, expect, it } from "vitest";
import {
  assertDesignViewport,
  designViewportCases,
  verifyDesignViewports,
  setNativeViewport,
} from "../tooling/design-viewport.mjs";

const ids = ["design-ui", "design-document", "design-code", "design-math", "design-wrap"];

function observation(width: number, height: number, zoomFactor: number) {
  const viewportWidth = Math.round(width / zoomFactor);
  const clientWidth = viewportWidth - 15;
  return {
    native: { width, height, zoomFactor },
    viewportWidth,
    viewportHeight: Math.round(height / zoomFactor),
    clientWidth,
    scrollWidth: clientWidth,
    devicePixelRatio: zoomFactor,
    specimens: ids.map((id) => ({
      id,
      clientWidth: clientWidth - 32,
      scrollWidth: clientWidth - 32,
      fontSize: 18,
    })),
  };
}

function nativeFixture(overflow = false, failRestoration = false, ignoreResize = false) {
  const state = { width: 800, height: 600, zoomFactor: 1.25 };
  const events: unknown[][] = [];
  const window = {
    getContentSize: () => [state.width, state.height],
    getBounds: () => ({ x: 0, y: 0, width: state.width + 16, height: state.height + 39 }),
    setContentSize(width: number, height: number, animate: boolean) {
      if (failRestoration && width === 800) throw new Error("Synthetic restoration failure");
      events.push(["size", width, height, animate]);
      if (!ignoreResize) Object.assign(state, { width, height });
    },
    webContents: {
      getZoomFactor: () => state.zoomFactor,
      setZoomFactor(zoomFactor: number) {
        events.push(["zoom", zoomFactor]);
        state.zoomFactor = zoomFactor;
      },
    },
  };
  return {
    state,
    events,
    handle: {
      evaluate: async (
        callback: (window: unknown, argument: unknown) => unknown,
        argument: unknown,
      ) => callback(window, argument),
    },
    page: {
      evaluate: async () => {
        const result = observation(state.width, state.height, state.zoomFactor);
        if (overflow && state.width === 600) result.scrollWidth++;
        const { native: _native, ...layout } = result;
        return {
          ...layout,
          screen: { width: 1024, height: 768, availableWidth: 1024, availableHeight: 728 },
        };
      },
    },
  };
}

describe("native design viewport verification", () => {
  it("covers the four actual-size widths and 1280-DIP zoom at 200 and 400 percent", () => {
    expect(
      designViewportCases.map(({ width, zoomFactor }: { width: number; zoomFactor: number }) => [
        width,
        zoomFactor,
      ]),
    ).toEqual([
      [320, 1],
      [600, 1],
      [1024, 1],
      [1280, 1],
      [1280, 2],
      [1280, 4],
    ]);
    for (const target of designViewportCases)
      expect(() =>
        assertDesignViewport(observation(target.width, target.height, target.zoomFactor), target),
      ).not.toThrow();
  });

  it("rejects unchanged zoom and layout width instead of accepting font-size-only enlargement", () => {
    const target = designViewportCases[4];
    const measured = observation(target.width, target.height, target.zoomFactor);
    expect(() =>
      assertDesignViewport({ ...measured, native: { ...measured.native, zoomFactor: 1 } }, target),
    ).toThrow(/native zoom/);
    expect(() => assertDesignViewport({ ...measured, viewportWidth: 1280 }, target)).toThrow(
      /CSS viewport width/,
    );
    expect(() =>
      assertDesignViewport({ ...measured, native: { ...measured.native, width: 1279 } }, target),
    ).toThrow(/native content width/);
  });

  it("rejects document overflow, clipped role text, missing specimens and text below the floor", () => {
    const target = designViewportCases[0];
    const measured = observation(target.width, target.height, target.zoomFactor);
    expect(() =>
      assertDesignViewport({ ...measured, scrollWidth: measured.clientWidth + 1 }, target),
    ).toThrow(/document horizontal overflow/);
    expect(() =>
      assertDesignViewport({ ...measured, specimens: measured.specimens.slice(1) }, target),
    ).toThrow(/role specimens/);
    for (const change of [
      { scrollWidth: measured.specimens[0].clientWidth + 1 },
      { clientWidth: 0 },
      { fontSize: 11 },
    ]) {
      const specimens = measured.specimens.map((specimen, index) =>
        index ? specimen : { ...specimen, ...change },
      );
      expect(() => assertDesignViewport({ ...measured, specimens }, target)).toThrow(
        /role horizontal overflow|visible text|text below 12px/,
      );
    }
  });

  it("calls native size and zoom setters for every case and restores the original nondefault state", async () => {
    const fixture = nativeFixture();
    const result = await verifyDesignViewports(fixture.page, fixture.handle);
    expect(result.map(({ target }: { target: unknown }) => target)).toEqual(designViewportCases);
    expect(fixture.events.filter(([kind]) => kind === "zoom")).toEqual([
      ["zoom", 1],
      ["zoom", 1],
      ["zoom", 1],
      ["zoom", 1],
      ["zoom", 2],
      ["zoom", 4],
      ["zoom", 1.25],
    ]);
    expect(fixture.events.filter(([kind]) => kind === "size").at(-1)).toEqual([
      "size",
      800,
      600,
      false,
    ]);
    expect(fixture.state).toEqual({ width: 800, height: 600, zoomFactor: 1.25 });
  });

  it("reports actual window and screen dimensions when native resizing is refused", async () => {
    const fixture = nativeFixture(false, false, true);
    await expect(
      setNativeViewport(fixture.page, fixture.handle, designViewportCases[0], { timeout: 50 }),
    ).rejects.toThrow(/Native geometry:[\s\S]*"width":800[\s\S]*"width":1024/);
  });

  it("restores native state when a reflow assertion fails", async () => {
    const fixture = nativeFixture(true);
    await expect(verifyDesignViewports(fixture.page, fixture.handle)).rejects.toThrow(
      /document horizontal overflow/,
    );
    expect(fixture.state).toEqual({ width: 800, height: 600, zoomFactor: 1.25 });
  });

  it("preserves both verification and restoration errors", async () => {
    const fixture = nativeFixture(true, true);
    await expect(verifyDesignViewports(fixture.page, fixture.handle)).rejects.toThrow(
      /document horizontal overflow[\s\S]*restoration failure/,
    );
  });
});
