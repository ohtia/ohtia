import { describe, expect, it } from "vitest";
import {
  dialogSafeAreaViewports,
  safeAreaDialogs,
  safeAreaIntersections,
  windowControlsExclusions,
  withCleanup,
} from "../tooling/dialog-safe-area.mjs";
import { focusRingMinimum } from "../tooling/command-presentation.mjs";

// The overlay and Settings Close geometry observed at 320 x 400 and 100% zoom in GNOME.
const gnome = { x: 0, y: 0, width: 281, height: 48 };
const box = (x: number, y: number, width: number, height: number) => ({
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
});

describe("window-controls safe area", () => {
  it("reserves the trailing system controls beside the usable title-bar area", () => {
    expect(windowControlsExclusions(gnome, 320)).toEqual([
      { left: 281, right: 320, top: 0, bottom: 48 },
    ]);
  });

  it("reserves leading traffic lights and both sides when the usable area is inset", () => {
    expect(windowControlsExclusions({ x: 78, y: 0, width: 242, height: 48 }, 320)).toEqual([
      { left: 0, right: 78, top: 0, bottom: 48 },
    ]);
    expect(windowControlsExclusions({ x: 70, y: 4, width: 200, height: 40 }, 320)).toEqual([
      { left: 0, right: 70, top: 4, bottom: 44 },
      { left: 270, right: 320, top: 4, bottom: 44 },
    ]);
  });

  it("refuses to infer a safe area from missing or empty overlay geometry", () => {
    expect(() => windowControlsExclusions(undefined, 320)).toThrow(/unavailable/);
    expect(() => windowControlsExclusions({ ...gnome, height: 0 }, 320)).toThrow(/unavailable/);
    expect(() => windowControlsExclusions({ ...gnome, width: Number.NaN }, 320)).toThrow(
      /unavailable/,
    );
  });

  it("detects the reported Settings Close overlap and its focus ring", () => {
    const exclusions = windowControlsExclusions(gnome, 320);
    expect(safeAreaIntersections(box(263, 29, 32, 32), exclusions)).toEqual([
      { area: exclusions[0], width: 14, height: 19 },
    ]);
    // Touching the band edge stays outside; a focus ring that crosses it does not.
    expect(safeAreaIntersections(box(263, 48, 32, 32), exclusions)).toEqual([]);
    expect(safeAreaIntersections(box(259, 44, 40, 40), exclusions)).toEqual([
      { area: exclusions[0], width: 18, height: 4 },
    ]);
  });

  it("accepts controls below the band or beside it, within layout rounding", () => {
    const exclusions = windowControlsExclusions(gnome, 320);
    expect(safeAreaIntersections(box(263, 64, 32, 32), exclusions)).toEqual([]);
    expect(safeAreaIntersections(box(16, 0, 265, 48), exclusions)).toEqual([]);
    expect(safeAreaIntersections(box(16, 0, 265 + 1 / 128, 48), exclusions)).toEqual([]);
    expect(safeAreaIntersections(box(16, 0, 266, 48), exclusions)).toHaveLength(1);
  });

  it("covers every delivered dialog at the minimum window and the zoom-reflow cases", () => {
    expect(safeAreaDialogs.map((dialog) => dialog.command)).toEqual([
      "settings.open",
      "palette.open",
      "shortcuts.open",
      "help.open",
      "about.open",
    ]);
    expect(dialogSafeAreaViewports).toContainEqual({
      width: 320,
      height: 400,
      zoomFactor: 1,
      textSpacing: true,
    });
    for (const target of dialogSafeAreaViewports) {
      expect(target.width).toBeGreaterThanOrEqual(320);
      expect(target.height).toBeGreaterThanOrEqual(400);
      expect(target.width / target.zoomFactor).toBeGreaterThanOrEqual(320);
      // The native viewport helper requires the exact CSS size, so each case maps to whole pixels.
      expect(Number.isInteger(target.width / target.zoomFactor)).toBe(true);
      expect(Number.isInteger(target.height / target.zoomFactor)).toBe(true);
    }
    // A later case lowers zoom without resizing, so stale overlay geometry would under-reserve.
    expect(dialogSafeAreaViewports.map((target) => target.zoomFactor)).toEqual([
      1, 0.9, 0.75, 4, 2,
    ]);
    expect(dialogSafeAreaViewports[2]).toMatchObject({
      width: dialogSafeAreaViewports[1].width,
      height: dialogSafeAreaViewports[1].height,
    });
    expect(
      dialogSafeAreaViewports
        .filter((target) => target.textSpacing)
        .map((target) => target.zoomFactor),
    ).toEqual([1, 4]);
  });

  it("expects the declared focus ring at Chromium's device-pixel snapping for the device-pixel ratio", () => {
    const close = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 2);
    // Values observed in Electron: 2.22/1.11 px at 90%, 2.67/1.33 px at 75%, 2.4/1.6 px at 125%.
    // The ratio is page zoom times display scale, so 125% display scaling at 100% zoom matches.
    for (const [ratio, width, offset] of [
      [1, 3, 2],
      [2, 3, 2],
      [4, 3, 2],
      [0.9, 2.222, 1.111],
      [0.75, 2.667, 1.333],
      [1.25, 2.4, 1.6],
    ]) {
      const minimum = focusRingMinimum(ratio);
      close(minimum.width, width);
      close(minimum.offset, offset);
      expect(width).toBeGreaterThanOrEqual(minimum.width);
      expect(offset).toBeGreaterThanOrEqual(minimum.offset);
    }
    // A thinner ring than the snapped declaration still fails.
    expect(2).toBeLessThan(focusRingMinimum(0.9).width);
    expect(2.5).toBeLessThan(focusRingMinimum(1).width);
  });

  it("keeps the primary failure when cleanup also fails", async () => {
    const primary = new Error("synthetic safe-area failure");
    const cleanup = new Error("synthetic restoration failure");
    const error = await withCleanup(
      async () => {
        throw primary;
      },
      async () => {
        throw cleanup;
      },
      "restoration",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([primary, cleanup]);
    expect((error as AggregateError).message).toContain("restoration failed");
    await expect(
      withCleanup(
        async () => "observed",
        async () => {
          throw cleanup;
        },
        "restoration",
      ),
    ).rejects.toBe(cleanup);
    const order: string[] = [];
    await expect(
      withCleanup(
        async () => {
          order.push("operation");
          return "observed";
        },
        async () => {
          order.push("cleanup");
        },
        "restoration",
      ),
    ).resolves.toBe("observed");
    expect(order).toEqual(["operation", "cleanup"]);
  });
});
