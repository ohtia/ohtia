import fs from "node:fs";
import { URL } from "node:url";
import { expect } from "@playwright/test";
import { verifyDesignViewports } from "./design-viewport.mjs";

const faces = JSON.parse(
  fs.readFileSync(new URL("../packages/renderer/fonts/manifest.json", import.meta.url), "utf8"),
).fonts;

/** Compare Chromium's rounded CSS-pixel serialization without hiding layout drift. */
export function assertTypographyScale(observed, expected) {
  const { height, ...exact } = expected;
  expect(observed).toMatchObject(exact);
  expect(observed.height).toMatch(/^\d+(?:\.\d+)?px$/);
  expect(Number.parseFloat(observed.height)).toBeCloseTo(height, 2);
}

/** CSS minification can express a zero duration in either seconds or milliseconds. */
export function assertZeroDuration(value) {
  expect(value).toMatch(/^(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/);
  expect(Number.parseFloat(value)).toBe(0);
}

/** Scoped checks in the real packaged renderer; these fixtures never ship. */
export async function verifyPackagedDesign(page, cdp, nativeWindow) {
  const previous = await page.evaluate(() =>
    document.documentElement.getAttribute("data-appearance"),
  );
  const requests = [];
  const observe = (request) => requests.push(request.url());
  page.on("request", observe);
  const result = {
    fonts: {},
    viewports: {},
    themes: [],
    limitations: [
      "Synthetic typography specimens; no formula parsing, IME, fluent-language or screen-reader certification.",
    ],
  };
  try {
    await page.evaluate(() => {
      const container = document.createElement("section");
      container.id = "design-acceptance";
      for (const [role, text] of [
        ["ui", "Évidence Ŀ ŀ ĳ ẞ ₹ 연구 근거 가 漢字〮"],
        ["document", "Authored evidence Ŀ ŀ ₹ 연구 근거 가 漢字〮 ⁿ"],
        ["code", "const evidence = '연구'; ⁿ"],
        ["math", "∑ ∫ √ ℝ ∇"],
      ]) {
        const item = document.createElement("p");
        item.id = `design-${role}`;
        item.dataset.fontRole = role;
        item.lang = "ko-KR";
        item.textContent = text;
        container.append(item);
      }
      const wrapping = document.createElement("p");
      wrapping.id = "design-wrap";
      wrapping.dataset.fontRole = "document";
      wrapping.lang = "ko-KR";
      wrapping.textContent = "Evidence연구자료의출처와근거를확인하세요".repeat(8);
      container.append(wrapping);
      const emphasis = document.createElement("em");
      emphasis.textContent = "연구자의 강조";
      container.querySelector("#design-document").append(emphasis);
      for (const [id, tag, role, type] of [
        ["heading", "h2", "document", "type.doc.h2"],
        ["code-scale", "code", "code", "type.doc.code"],
      ]) {
        const item = document.createElement(tag);
        item.id = `design-${id}`;
        item.dataset.fontRole = role;
        item.dataset.type = type;
        item.textContent = "Synthetic scale";
        container.append(item);
      }
      document.querySelector("main").append(container);
    });
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const readFonts = async () => {
      const loaded = await page.evaluate(async (records) => {
        const loadedFaces = [];
        for (const face of records) {
          const text =
            face.family === "Noto Sans"
              ? "ⁿ"
              : face.family.endsWith(" KR")
                ? "연구"
                : face.family === "IBM Plex Math"
                  ? "∑∫√"
                  : "Évidence 1234";
          const matches = await document.fonts.load(
            `${face.style} ${face.weight} 16px "${face.family}"`,
            text,
          );
          loadedFaces.push({
            file: face.file,
            matching: matches.filter(
              (font) =>
                font.family.replaceAll('"', "") === face.family &&
                font.weight === String(face.weight) &&
                font.style === face.style &&
                font.status === "loaded",
            ).length,
          });
        }
        await document.fonts.ready;
        return loadedFaces;
      }, faces);
      expect(loaded).toHaveLength(faces.length);
      for (const face of loaded) expect(face.matching).toBeGreaterThan(0);
      const observations = { faces: loaded, roles: {} };
      for (const [role, families] of [
        ["ui", ["IBM Plex Sans", "IBM Plex Sans KR", "Noto Sans KR"]],
        ["document", ["IBM Plex Serif", "Noto Serif KR", "Noto Sans"]],
        ["code", ["IBM Plex Mono", "Noto Sans KR", "Noto Sans"]],
        ["math", ["IBM Plex Math"]],
      ]) {
        const { root } = await cdp.send("DOM.getDocument");
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: `#design-${role}`,
        });
        const observed = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        for (const family of families)
          expect(
            observed.fonts.some(
              (font) => font.isCustomFont && font.familyName === family && font.glyphCount > 0,
            ),
          ).toBe(true);
        expect(observed.fonts.every((font) => font.isCustomFont)).toBe(true);
        observations.roles[role] = observed.fonts;
      }
      return observations;
    };
    for (const [system, explicit, expected, mode] of [
      ["light", "light", "rgb(250, 248, 245)", "light"],
      ["dark", "light", "rgb(250, 248, 245)", "light"],
      ["light", "dark", "rgb(21, 20, 17)", "dark"],
      ["dark", null, "rgb(21, 20, 17)", "dark"],
      ["light", null, "rgb(250, 248, 245)", "light"],
    ]) {
      await page.emulateMedia({ colorScheme: system });
      await page.evaluate(
        (value) =>
          value
            ? document.documentElement.setAttribute("data-appearance", value)
            : document.documentElement.removeAttribute("data-appearance"),
        explicit,
      );
      const color = await page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      );
      expect(color).toBe(expected);
      if (!result.fonts[mode]) {
        result.fonts[mode] = await readFonts();
        result.viewports[mode] = await verifyDesignViewports(page, nativeWindow);
      }
      result.themes.push({ system, explicit, observed: color });
    }
    const scales = await page.evaluate(() =>
      ["heading", "code-scale"].map((name) => {
        const style = getComputedStyle(document.querySelector(`#design-${name}`));
        return { name, size: style.fontSize, height: style.lineHeight, weight: style.fontWeight };
      }),
    );
    assertTypographyScale(scales[0], { size: "26px", height: 34, weight: "600" });
    assertTypographyScale(scales[1], { size: "15px", height: 24, weight: "400" });
    result.scales = scales;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const presentation = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement),
        text = getComputedStyle(document.querySelector("#design-document em"));
      return {
        quick: root.getPropertyValue("--motion-duration-quick").trim(),
        contributor: root.getPropertyValue("--motion-duration-contributor-active").trim(),
        emphasis: text.textEmphasisStyle,
        fontStyle: text.fontStyle,
        synthesis: text.fontSynthesis,
        wordBreak: text.wordBreak,
        wrapping: text.overflowWrap,
      };
    });
    assertZeroDuration(presentation.quick);
    assertZeroDuration(presentation.contributor);
    expect(presentation).toMatchObject({
      fontStyle: "normal",
      synthesis: "none",
      wordBreak: "keep-all",
      wrapping: "anywhere",
    });
    expect(presentation.emphasis).toContain("dot");
    result.presentation = presentation;
    result.forcedColors = [];
    for (const [system, appearance] of [
      ["light", "light"],
      ["dark", "dark"],
      ["dark", null],
      ["light", "system"],
    ]) {
      await page.evaluate(
        (value) =>
          value
            ? document.documentElement.setAttribute("data-appearance", value)
            : document.documentElement.removeAttribute("data-appearance"),
        appearance,
      );
      await page.emulateMedia({ colorScheme: system, forcedColors: "active" });
      await page.keyboard.press("Tab");
      await page.locator("button").first().focus();
      const forced = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement),
          button = getComputedStyle(document.querySelector("button"));
        return {
          root: root.color,
          control: button.borderTopStyle,
          outline: button.outlineWidth,
          focus: root.getPropertyValue("--focus-ring").trim(),
          surface: root.getPropertyValue("--surface-page").trim(),
          label: root.getPropertyValue("--content-primary").trim(),
          brand: getComputedStyle(document.querySelector(".ohtia-glasses")).color,
        };
      });
      expect(forced.control).not.toBe("none");
      expect(forced).toMatchObject({
        outline: "3px",
        focus: "Highlight",
        surface: "Canvas",
        label: "CanvasText",
      });
      expect(forced.brand).toBe(forced.root);
      result.forcedColors.push({ system, appearance, ...forced });
    }
    expect(requests.every((url) => url.startsWith("ohtia://app/"))).toBe(true);
    result.requests = requests;
    return result;
  } finally {
    page.off("request", observe);
    await page.evaluate((value) => {
      document.querySelector("#design-acceptance")?.remove();
      if (value === null) document.documentElement.removeAttribute("data-appearance");
      else document.documentElement.setAttribute("data-appearance", value);
    }, previous);
    await page.emulateMedia({ colorScheme: null, reducedMotion: null, forcedColors: null });
  }
}
