import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  checkTokens,
  readDesign,
  renderTokens,
  assertPair,
  contrast,
} from "../tooling/design-tokens.mjs";
import { OhtiaBrand, OhtiaGlasses } from "../packages/renderer/src/branding.js";
import { LucideGlyph } from "../packages/renderer/src/iconography.js";
import { isRendererAssetPath } from "../packages/main/src/asset-policy.js";
import { checkColorUsage } from "../tooling/design-usage.mjs";
import { checkRendererStyles } from "../tooling/design-assets.mjs";
import { designMetrics, iconMappings } from "../packages/renderer/src/design-tokens.js";

const design = fs.readFileSync("docs/design-system.md", "utf8");
const workspace = fs.readFileSync("docs/workspace-layout.md", "utf8");

describe("canonical design foundations", () => {
  it("resolves every workspace alias and exports numerical metrics from canonical values", () => {
    const model = checkTokens();
    expect(Object.keys(model.tokens).length).toBeGreaterThan(250);
    expect(designMetrics["component.workspace.context-bar.minimum"]).toBe(48);
    expect(designMetrics["component.workspace.document.padding"]).toBe(12);
    expect(designMetrics["type.doc.body.size"]).toBe(18);
    expect(iconMappings["Keyboard shortcuts"]).toBe("keyboard");
    expect(model.resolve("font.family.document", "light")).toContain(
      '"IBM Plex Serif", "Noto Serif KR", "Noto Sans"',
    );
  });
  it("rejects missing aliases, duplicate definitions and canonical changes absent from generated output", () => {
    expect(() =>
      readDesign(design, workspace.replace("alias of `space.4`", "alias of `space.absent`")),
    ).toThrow(/Unresolved|Unparsed/);
    expect(() =>
      readDesign(design.replace("### Shape", "| `space.4` | 16 px |\n### Shape"), workspace),
    ).toThrow(/Duplicate/);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-design-"));
    try {
      for (const file of [
        "docs/design-system.md",
        "docs/workspace-layout.md",
        "packages/renderer/src/design-tokens.css",
        "packages/renderer/src/design-tokens.ts",
      ]) {
        fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
        fs.copyFileSync(file, path.join(temporary, file));
      }
      fs.appendFileSync(
        path.join(temporary, "packages/renderer/src/design-tokens.css"),
        "/* drift */",
      );
      expect(() => checkTokens(temporary)).toThrow(/drift/);
      fs.copyFileSync(
        "packages/renderer/src/design-tokens.css",
        path.join(temporary, "packages/renderer/src/design-tokens.css"),
      );
      fs.writeFileSync(
        path.join(temporary, "docs/workspace-layout.md"),
        workspace.replace("256 px;", "257 px;"),
      );
      expect(() => checkTokens(temporary)).toThrow(/drift/);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
  it("independently calculates contrasts and refuses unlisted or weakened pairs", () => {
    const model = readDesign(design, workspace);
    expect(contrast("#000000", "#ffffff")).toBe(21);
    expect(contrast("#ffffff", "#ffffff")).toBe(1);
    for (const pair of model.pairs)
      assertPair(model, pair.foreground, pair.background, pair.minimum);
    expect(() => assertPair(model, "voice.ohtia.content", "selection.surface", 7)).toThrow(
      /Unlisted/,
    );
    const altered = readDesign(design.replace("`#1f1d19`", "`#faf8f5`"), workspace);
    expect(() => renderTokens(altered)).toThrow(/contrast/);
  });
  it("preserves explicit theme precedence and zeroes every motion duration for reduced motion", () => {
    const model = readDesign(design, workspace),
      { css } = renderTokens(model);
    expect(css).toContain(
      ':root:where(:not([data-appearance="light"]):not([data-appearance="dark"]))',
    );
    expect(model.resolve("surface.page", "light")).toBe("#faf8f5");
    expect(model.resolve("surface.page", "dark")).toBe("#151411");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of Object.keys(model.tokens).filter((name) =>
      name.startsWith("motion.duration."),
    ))
      expect(reduced).toContain(`--${name.replaceAll(".", "-")}: 0ms;`);
  });
});

describe("static Ohtia identity", () => {
  it("uses the specified compact geometry without an extra accessible voice", () => {
    const document = new JSDOM(renderToStaticMarkup(createElement(OhtiaBrand))).window.document;
    expect(document.body.textContent).toBe("Ohtia");
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("circle")?.getAttribute("cx")).toBe("7.125");
    expect(document.querySelector("circle")?.getAttribute("r")).toBe("4.125");
    expect(document.querySelector('[data-type="type.ui.subheading"]')).not.toBeNull();
  });
  it("uses filled original glasses at the larger supported sizes", () => {
    const document = new JSDOM(renderToStaticMarkup(createElement(OhtiaGlasses, { size: 64 })))
      .window.document;
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(document.querySelector("svg")?.getAttribute("width")).toBe("64");
    expect(document.querySelector("circle")?.getAttribute("r")).toBe("11");
    expect(document.querySelector('[fill="var(--voice-ohtia-surface)"]')).not.toBeNull();
  });
});

describe("review regression contracts", () => {
  it("preserves explicit scales and document heading and code defaults through the real cascade", () => {
    const css = ["design-tokens.css", "design-roles.css", "foundation.css"]
      .map((name) =>
        fs.readFileSync(`packages/renderer/src/${name}`, "utf8").replace(/^@import.*$/gm, ""),
      )
      .join("\n");
    const dom = new JSDOM(
      `<style>${css}</style><h2 id="explicit" data-font-role="document" data-type="type.doc.h2">Heading</h2><code id="code-explicit" data-font-role="code" data-type="type.doc.code">Code</code><div data-font-role="document"><h2 id="heading">Heading</h2><code id="code">Code</code></div>`,
    );
    for (const [id, scale] of [
      ["explicit", "h2"],
      ["heading", "h2"],
      ["code", "code"],
      ["code-explicit", "code"],
    ]) {
      const style = dom.window.getComputedStyle(dom.window.document.getElementById(id)!);
      expect(style.fontSize).toBe(`var(--type-doc-${scale}-size)`);
      expect(style.fontWeight).toBe(`var(--type-doc-${scale}-weight)`);
    }
    dom.window.close();
  });
  it("rejects actual consumer color mutations and unresolved CSS variables through the build gate", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-consumer-"));
    try {
      for (const file of [
        "docs/design-system.md",
        "docs/workspace-layout.md",
        "packages/renderer/color-usage.json",
        ...["design-tokens.css", "design-tokens.ts", "design-roles.css", "foundation.css"].map(
          (name) => `packages/renderer/src/${name}`,
        ),
      ]) {
        fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
        fs.copyFileSync(file, path.join(temporary, file));
      }
      expect(checkRendererStyles(temporary)).toBeGreaterThan(0);
      const file = path.join(temporary, "packages/renderer/src/design-roles.css");
      const original = fs.readFileSync(file, "utf8");
      fs.writeFileSync(
        file,
        original.replace(".ohtia-brand {", ".ohtia-brand { background: var(--selection-surface);"),
      );
      expect(() => checkRendererStyles(temporary)).toThrow(
        /Background differs|Unlisted contrast pair/,
      );
      const attacks: [string, RegExp][] = [
        [
          original.replace(
            "color: var(--voice-ohtia-content);",
            "color: color-mix(in srgb, var(--voice-ohtia-content) 1%, white);",
          ),
          /direct semantic color/,
        ],
        [original + ".ohtia-brand { color: var(--voice-ohtia-content); }", /Split color/],
        [
          original.replace(
            ".ohtia-brand {",
            ".ohtia-brand { border-top: var(--border-width-default) solid var(--border-control); border-top-color: var(--surface-page);",
          ),
          /contrast/,
        ],
        [
          original.replace(
            ".ohtia-brand {",
            ".ohtia-brand { border-inline-start: 1px solid #ff0000;",
          ),
          /border\/outline/,
        ],
        [original.replace(".ohtia-brand {", ".ohtia-brand { fill: red;"), /direct semantic color/],
        [
          original.replace(".ohtia-brand {", ".ohtia-brand { box-shadow: 0 0 0 1px red;"),
          /color transformation/,
        ],
        [
          original.replace(
            ".ohtia-brand {",
            ".ohtia-brand { text-decoration-color: var(--surface-page);",
          ),
          /contrast/,
        ],
        [
          original.replace(".ohtia-brand {", ".ohtia-brand { .child { color: red; }"),
          /Nested renderer CSS/,
        ],
        [
          original.replace(".ohtia-brand {", ".ohtia-brand { color: red !important;"),
          /priority override/,
        ],
        [
          original.replace(".ohtia-brand {", ".ohtia-brand { color: red;"),
          /Duplicate CSS declaration/,
        ],
        [
          original + "@starting-style { .ohtia-brand { color: red; } }",
          /Unsupported renderer CSS at-rule/,
        ],
      ];
      for (const prefix of ["_", "*"])
        attacks.push([
          original.replace(
            "color: var(--voice-ohtia-content);",
            `${prefix}color: var(--voice-ohtia-content);`,
          ),
          /Unsupported CSS property prefix/,
        ]);
      for (const separator of [" *:", " (x):", " []:", " é:", " .:", " +:", " $:"])
        attacks.push([
          original.replace(
            "color: var(--voice-ohtia-content);",
            `color${separator} var(--voice-ohtia-content);`,
          ),
          /Unsupported CSS property separator/,
        ]);
      attacks.push([
        original.replace(
          "color: var(--voice-ohtia-content);",
          "(x) color: var(--voice-ohtia-content);",
        ),
        /Unsupported CSS property prefix/,
      ]);
      attacks.push([
        original.replace(".ohtia-brand {", "; .ohtia-brand {"),
        /Unsupported CSS rule separator/,
      ]);
      attacks.push([
        original.replace("color: var(--voice-ohtia-content);", "color: var(--content-primary);"),
        /Foreground differs from declared usage/,
      ]);
      for (const declaration of [
        "text-decoration: underline red",
        "opacity: 0.01",
        "fill-opacity: 0.01",
        "stroke-opacity: 0.01",
        "mask-image: linear-gradient(transparent, transparent)",
        "all: initial",
        "all: unset",
        "-webkit-box-shadow: 0 0 0 1px red",
        "-webkit-filter: opacity(0.01)",
        "forced-color-adjust: none",
        "outline-style: none",
        "outline-width: 0",
        "-webkit-text-fill-color: var(--content-disabled)",
        "-webkit-text-emphasis-color: red",
        "-webkit-box-reflect: below 0 linear-gradient(red, red)",
      ])
        attacks.push([
          original.replace(".ohtia-brand {", `.ohtia-brand { ${declaration};`),
          /Unsupported renderer CSS property or value/,
        ]);
      for (const reference of ["var(--Missing)", "var( --missing )", "var(--missing-metric)"])
        attacks.push([
          original + `.unknown { width: ${reference}; }`,
          /Unresolved renderer variable/,
        ]);
      for (const character of ["\u00a0", "\u000b", "\ufeff", "\u2003", "\u3000"])
        for (const edge of ["leading", "trailing"]) {
          const decorate = (text: string) =>
            edge === "leading" ? character + text : text + character;
          attacks.push([
            original.replace(
              "color: var(--voice-ohtia-content);",
              `color: ${decorate("var(--voice-ohtia-content)")};`,
            ),
            /direct semantic color/,
          ]);
          attacks.push([
            original.replace(".ohtia-brand {", `${decorate(".ohtia-brand")} {`),
            /Unregistered colored selector/,
          ]);
          attacks.push([
            original.replace("color: CanvasText;", `color: ${decorate("CanvasText")};`),
            /Unsupported forced-color declaration/,
          ]);
          attacks.push([
            original + `.unknown { font-size: var(${decorate("--type-ui-body-size")}); }`,
            /Unsupported variable expression/,
          ]);
        }
      for (const [attack, reason] of attacks) {
        fs.writeFileSync(file, attack);
        expect(() => checkRendererStyles(temporary)).toThrow(reason);
      }
      for (const whitespace of ["\t", "\n", "\f", "\r", " ", "\t\n\f\r "]) {
        fs.writeFileSync(
          file,
          original.replace(
            "color: var(--voice-ohtia-content);",
            `color${whitespace}:${whitespace}var(--voice-ohtia-content)${whitespace};`,
          ),
        );
        expect(checkRendererStyles(temporary)).toBeGreaterThan(0);
      }
      fs.writeFileSync(file, original + ".unknown { width: var(--missing-metric); }");
      expect(() => checkRendererStyles(temporary)).toThrow(/Unresolved renderer variable/);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
  it("rejects invalid color ownership, uninspected syntax and forced-color escapes", () => {
    const model = checkTokens();
    const sources = Object.fromEntries(
      ["foundation.css", "design-roles.css"].map((name) => [
        name,
        fs.readFileSync(`packages/renderer/src/${name}`, "utf8"),
      ]),
    );
    const usage = JSON.parse(fs.readFileSync("packages/renderer/color-usage.json", "utf8"));
    expect(() => checkColorUsage(model, sources, {})).toThrow(/Missing renderer color usage/);
    expect(() =>
      checkColorUsage(model, sources, {
        version: 1,
        rules: [{ selector: "a", minimum: 4, backgrounds: [] }],
      }),
    ).toThrow(/Invalid renderer color usage/);
    expect(() =>
      checkColorUsage(model, sources, { ...usage, rules: [...usage.rules, usage.rules[0]] }),
    ).toThrow(/Duplicate renderer color owner/);
    expect(() =>
      checkColorUsage(model, sources, {
        ...usage,
        rules: [...usage.rules, { selector: ".unused", minimum: 3, backgrounds: ["surface.page"] }],
      }),
    ).toThrow(/Unused renderer color declaration/);
    expect(() =>
      checkColorUsage(model, sources, {
        ...usage,
        rules: usage.rules.map((rule: { selector: string }) =>
          rule.selector === ".ohtia-brand" ? { ...rule, minimum: 3 } : rule,
        ),
      }),
    ).toThrow(/Text contrast minimum/);
    expect(() =>
      checkColorUsage(
        model,
        {
          ...sources,
          "foundation.css": sources["foundation.css"].replace(
            "  outline: var(--focus-width)",
            "  color: var(--content-primary); outline: var(--focus-width)",
          ),
        },
        usage,
      ),
    ).toThrow(/Unexpected foreground/);
    const cases: [string, RegExp][] = [
      ['@import "https://example.invalid/style.css";', /Uninspected CSS import/],
      ['@import "./absent.css";', /Uninspected CSS import/],
      ["@supports (display: grid) { a { display: grid; } }", /Unsupported renderer CSS at-rule/],
      ["a { color:", /Unparsed renderer stylesheet/],
      [
        "@media (forced-colors: active) { a { color: red; } }",
        /Unsupported forced-color declaration/,
      ],
      ["a { color: var(--content-primary); }", /Unregistered colored selector/],
      [":root { --surface-page: red; }", /Authored override/],
      ["a { font-size: var(--type-ui-body-size, 12px); }", /Unsupported variable expression/],
    ];
    for (const [css, reason] of cases)
      expect(() => checkColorUsage(model, { ...sources, "mutation.css": css }, usage)).toThrow(
        reason,
      );
  });
  it("applies paragraph and quotation spacing on a passage carrying its own document role", () => {
    const css = ["design-tokens.css", "design-roles.css", "foundation.css"]
      .map((name) =>
        fs.readFileSync(`packages/renderer/src/${name}`, "utf8").replace(/^@import.*$/gm, ""),
      )
      .join("\n");
    const dom = new JSDOM(
      `<style>${css}</style><p data-font-role="document">Text</p><blockquote data-font-role="document">Quote</blockquote>`,
    );
    expect(dom.window.getComputedStyle(dom.window.document.querySelector("p")!).marginBlock).toBe(
      "1em",
    );
    expect(
      dom.window.getComputedStyle(dom.window.document.querySelector("blockquote")!)
        .marginInlineStart,
    ).toBe("var(--space-6)");
    dom.window.close();
  });
  it("rejects invalid normative contrast minima and type sizes below the floor", () => {
    expect(() => readDesign(design.replace("| 7:1", "| invalid"), workspace)).toThrow(
      /contrast minimum/,
    );
    const small = design.replace(/(`type\.ui\.caption`\s*\|\s*Sans\s*\|\s*)12/, "$1" + "11");
    expect(small).not.toBe(design);
    expect(() => readDesign(small, workspace)).toThrow(/12px floor/);
  });
  it("rejects removal of required definitions even before regeneration", () => {
    for (const name of ["component.target.minimum", "component.rail.width"]) {
      const altered = design.replace(
        new RegExp("`" + name.replaceAll(".", "\\.") + "`: \\d+ px"),
        "",
      );
      expect(altered).not.toBe(design);
      expect(() => readDesign(altered, workspace)).toThrow(/Unparsed canonical token/);
    }
  });
  it("delivers every comparison icon as controlled token-stroked geometry", () => {
    const mappings = {
      "Supported by examined content": "circle-dot",
      "Partially supported": "contrast",
      Ambiguous: "circle-question-mark",
      "Not found in examined content": "search-x",
      "Contradicted by examined content": "arrow-left-right",
      "Not verified by Ohtia": "ban",
    };
    for (const [meaning, name] of Object.entries(mappings))
      expect(iconMappings[meaning as keyof typeof iconMappings]).toBe(name);
    for (const name of new Set(Object.values(iconMappings))) {
      const doc = new JSDOM(renderToStaticMarkup(createElement(LucideGlyph, { name }))).window
        .document;
      expect(doc.querySelector("svg")?.getAttribute("stroke-width")).toBe("var(--icon-stroke)");
      expect(doc.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
      expect(doc.querySelector("svg")?.children.length).toBeGreaterThan(0);
      expect(doc.querySelector("script,foreignObject,image,use")).toBeNull();
    }
    expect(() =>
      renderToStaticMarkup(createElement(LucideGlyph, { name: "unknown" as never })),
    ).toThrow(/Unknown/);
  });
  it("admits the actual bundled image names while refusing traversal and executable image-directory entries", () => {
    for (const directory of ["icons", "branding"])
      for (const file of fs
        .readdirSync(`packages/renderer/${directory}`)
        .filter((name) => /\.(svg|png)$/.test(name)))
        expect(isRendererAssetPath(`${directory}/${file}`)).toBe(true);
    for (const name of ["index.html", "assets/app.js", "assets/IBMPlexMath-Regular.woff2"])
      expect(isRendererAssetPath(name)).toBe(true);
    for (const name of [
      "../escape.html",
      "icons/menu.js",
      "branding/evil.svg",
      "icons/../app.js",
      "icons/a/b.svg",
      "icons/%2e%2e.svg",
      "branding/illustration.png?x",
    ])
      expect(isRendererAssetPath(name)).toBe(false);
  });
  it("keeps the 24/25 geometry boundary and rejects nonfinite or character-sized glasses", () => {
    expect(renderToStaticMarkup(createElement(OhtiaGlasses, { size: 25 }))).toContain(
      'viewBox="0 0 64 64"',
    );
    expect(renderToStaticMarkup(createElement(OhtiaGlasses, { size: 40 }))).toContain('width="40"');
    for (const size of [0, -1, 96, Infinity, NaN])
      expect(() => renderToStaticMarkup(createElement(OhtiaGlasses, { size }))).toThrow(
        /Glasses size/,
      );
  });
});
