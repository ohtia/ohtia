import path from "node:path";
import postcss from "postcss";
import { assertPair, cssName } from "./design-tokens.mjs";

const trimCss = (value) => value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
const selectorKey = (selector) =>
  selector
    .split(",")
    .map((part) => trimCss(part))
    .sort()
    .join(",");
const systems = new Set(["canvas", "canvastext", "buttontext", "highlight", "currentcolor"]);
const isLineShorthand = (property) =>
  /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|column-rule)$/.test(
    property,
  );
// This vocabulary is intentionally explicit. New CSS features require a checked contract.
const layout = new Set([
  "align-items",
  "scroll-padding",
  "scroll-margin",
  "border-width",
  "min-inline-size",
  "flex-direction",
  "overflow-x",
  "overflow-y",
  "overflow",
  "position",
  "inset-inline-start",
  "inset-block-start",
  "inline-size",
  "block-size",
  "max-block-size",
  "min-block-size",
  "z-index",
  "font-variant-numeric",
  "clip-path",
  "border-radius",
  "box-sizing",
  "color-scheme",
  "cursor",
  "display",
  "flex-shrink",
  "flex-wrap",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-synthesis",
  "font-variant",
  "font-weight",
  "gap",
  "hyphens",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-block",
  "margin-inline-start",
  "max-inline-size",
  "max-width",
  "min-height",
  "outline-offset",
  "overflow-wrap",
  "padding",
  "stroke-linecap",
  "stroke-linejoin",
  "text-align",
  "text-emphasis-position",
  "white-space",
  "word-break",
]);
const paints = new Set([
  "background",
  "background-color",
  "color",
  "fill",
  "stroke",
  "box-shadow",
  "text-decoration-color",
  "text-emphasis-color",
  "caret-color",
  "outline-color",
]);
const isPaint = (property) =>
  paints.has(property) ||
  isLineShorthand(property) ||
  /^border-(?:(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?-)?color$/.test(property);
const media = new Set(["(pointer: coarse)", "(forced-colors: active)"]);

/** Closed declarations prevent unsupported CSS expressions from masquerading as checked tokens. */
export function checkColorUsage(model, sources, usage) {
  if (usage?.version !== 1 || !Array.isArray(usage.rules) || usage.rules.length === 0)
    throw new Error("Missing renderer color usage declarations");
  const names = new Map(Object.keys(model.tokens).map((name) => [cssName(name), name]));
  const declarations = new Map();
  for (const item of usage.rules) {
    if (
      typeof item.selector !== "string" ||
      ![3, 7].includes(item.minimum) ||
      !Array.isArray(item.backgrounds) ||
      !item.backgrounds.length
    )
      throw new Error("Invalid renderer color usage declaration");
    if (item.foreground && item.minimum !== (item.foreground === "content.disabled" ? 3 : 7))
      throw new Error("Text contrast minimum differs from its semantic role");
    const key = selectorKey(item.selector);
    if (declarations.has(key)) throw new Error(`Duplicate renderer color owner: ${key}`);
    for (const background of item.backgrounds) {
      model.resolve(background, "light");
      if (item.foreground) assertPair(model, item.foreground, background, item.minimum);
    }
    declarations.set(key, item);
  }
  const overlays = new Map();
  for (const overlay of usage.overlays ?? []) {
    if (
      overlay.selector !== ".primitive-dialog::backdrop" ||
      overlay.token !== "overlay.scrim" ||
      overlays.has(overlay.selector) ||
      declarations.has(overlay.selector)
    )
      throw new Error("Invalid overlay usage declaration");
    // The canonical translucent scrim has no foreground or text contrast pair.
    if (!model.resolve(overlay.token, "light").startsWith("rgb("))
      throw new Error("Invalid canonical overlay token");
    overlays.set(overlay.selector, overlay.token);
  }
  const seen = new Set();
  const token = (value, context) => {
    const match = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    const name = match && names.get(match[1]);
    if (!name || name.startsWith("ref.") || !/^#[a-f0-9]{6}$/.test(model.resolve(name, "light")))
      throw new Error(`Use one direct semantic color token: ${context}`);
    return name;
  };
  let checked = 0;
  for (const [file, css] of Object.entries(sources)) {
    let sheet;
    try {
      sheet = postcss.parse(css, { from: file });
    } catch (error) {
      throw new Error(`Unparsed renderer stylesheet: ${file}`, { cause: error });
    }
    const visit = (nodes, forced = false) => {
      for (const rule of nodes) {
        if (!/^[\t\n\f\r ]*$/.test(rule.raws.before ?? "") || rule.raws.ownSemicolon)
          throw new Error(`Unsupported CSS rule separator: ${file}`);
        if (rule.type === "comment") continue;
        if (rule.type === "atrule") {
          if (rule.name === "import" && rule.parent.type === "root" && !rule.nodes) {
            const match = /^(["'])([^"']+)\1$/.exec(rule.params);
            const href = match?.[2];
            const target =
              href && path.posix.normalize(path.posix.join(path.posix.dirname(file), href));
            if (
              !href ||
              /^(?:[a-z]+:|\/)/i.test(href) ||
              href.includes("\\") ||
              (!Object.hasOwn(sources, target) &&
                !["design-tokens.css", "design-fonts.css"].includes(target))
            )
              throw new Error(`Uninspected CSS import: ${file}/${rule.params}`);
            continue;
          }
          if (rule.name !== "media" || !media.has(rule.params) || !rule.nodes)
            throw new Error(`Unsupported renderer CSS at-rule: ${file}/${rule.name}`);
          visit(rule.nodes, forced || rule.params === "(forced-colors: active)");
          continue;
        }
        if (rule.type !== "rule") throw new Error(`Unsupported renderer CSS node: ${file}`);
        if (rule.nodes.some((node) => !["decl", "comment"].includes(node.type)))
          throw new Error(`Nested renderer CSS is not admitted: ${file}`);
        const context = `${file}: ${rule.selector}`;
        const style = new Map();
        if (rule.selector.includes("\\")) throw new Error(`Unsupported escaped CSS: ${context}`);
        for (const declaration of rule.nodes.filter((node) => node.type === "decl")) {
          if (!/^[\t\n\f\r ]*$/.test(declaration.raws.before ?? ""))
            throw new Error(`Unsupported CSS property prefix: ${context}`);
          if (!/^[\t\n\f\r ]*:[\t\n\f\r ]*$/.test(declaration.raws.between ?? ""))
            throw new Error(`Unsupported CSS property separator: ${context}`);
          const property = declaration.prop;
          const value = trimCss(declaration.value);
          if (property.includes("\\") || value.includes("\\"))
            throw new Error(`Unsupported escaped CSS: ${context}`);
          if (property !== property.toLowerCase())
            throw new Error(`Noncanonical CSS property: ${context}/${property}`);
          if (declaration.important)
            throw new Error(`CSS priority override is not admitted: ${context}`);
          if (style.has(property))
            throw new Error(`Duplicate CSS declaration: ${context}/${property}`);
          // Parse references before checking the property, including spaced and case-sensitive names.
          const withoutReferences = value.replace(
            /var\([\t\n\f\r ]*(--[A-Za-z0-9_-]+)[\t\n\f\r ]*\)/gi,
            (_, name) => {
              if (!names.has(name))
                throw new Error(`Unresolved renderer variable: ${file}/${name}`);
              return "";
            },
          );
          if (/var[\t\n\f\r ]*\(/i.test(withoutReferences))
            throw new Error(`Unsupported variable expression: ${context}/${property}`);
          const custom = property.startsWith("--") && names.has(property);
          const neutral =
            (property === "text-emphasis" && value === "filled dot") ||
            (property === "text-decoration" &&
              /^(none|underline|line-through|overline)$/.test(value)) ||
            (property === "border-style" && /^(solid|dashed|dotted|double)$/.test(value));
          if (!layout.has(property) && !isPaint(property) && !custom && !neutral)
            throw new Error(`Unsupported renderer CSS property or value: ${context}/${property}`);
          if (custom && !forced)
            throw new Error(`Authored override of canonical token: ${context}/${property}`);
          if (forced && (custom || isPaint(property)) && !systems.has(value.toLowerCase()))
            throw new Error(`Unsupported forced-color declaration: ${context}/${property}`);
          style.set(property, value);
        }
        const properties = [...style.keys()];
        if (forced) continue;
        const paint = properties.filter(isPaint);
        if (!paint.length) continue;
        const overlayKey = selectorKey(rule.selector);
        if (overlays.has(overlayKey)) {
          if (
            seen.has(overlayKey) ||
            style.size !== 1 ||
            style.get("background") !== `var(${cssName(overlays.get(overlayKey))})`
          )
            throw new Error(`Invalid overlay declaration: ${context}`);
          seen.add(overlayKey);
          checked++;
          continue;
        }
        const key = selectorKey(rule.selector),
          declared = declarations.get(key);
        if (!declared) throw new Error(`Unregistered colored selector: ${context}`);
        if (seen.has(key)) throw new Error(`Split color declarations are not admitted: ${context}`);
        seen.add(key);
        const foreground = style.get("color") ?? "";
        if (
          declared.foreground &&
          (!foreground || token(foreground, context) !== declared.foreground)
        )
          throw new Error(`Foreground differs from declared usage: ${context}`);
        if (!declared.foreground && foreground)
          throw new Error(`Unexpected foreground in color usage: ${context}`);
        for (const property of paint) {
          const value = style.get(property);
          if (property === "color") continue;
          if (["background", "background-color"].includes(property)) {
            const background = token(value, `${context}/${property}`);
            if (!declared.foreground || !declared.backgrounds.includes(background))
              throw new Error(`Background differs from declared color usage: ${context}`);
            assertPair(model, declared.foreground, background, declared.minimum);
            checked++;
            continue;
          }
          if (property === "box-shadow" && value === "var(--shadow-overlay)") continue;
          if (["fill", "stroke", "box-shadow"].includes(property) && value === "none") continue;
          if (property === "box-shadow")
            throw new Error(`Unsupported color transformation: ${context}/${property}`);
          let line;
          if (isLineShorthand(property)) {
            const match =
              /^var\((--[a-z0-9-]+)\) (?:solid|dashed|dotted|double) (var\(--[a-z0-9-]+\))$/.exec(
                value,
              );
            const width = match && names.get(match[1]);
            if (
              !width ||
              !/^\d+(?:\.\d+)?px$/.test(model.resolve(width, "light")) ||
              parseFloat(model.resolve(width, "light")) <= 0
            )
              throw new Error(`Unsupported border/outline declaration: ${context}/${property}`);
            line = token(match[2], context);
          } else if (value === "currentColor" && declared.foreground) line = declared.foreground;
          else line = token(value, `${context}/${property}`);
          for (const background of declared.backgrounds) {
            assertPair(model, line, background, 3);
            checked++;
          }
        }
      }
    };
    visit(sheet.nodes);
  }
  for (const key of [...declarations.keys(), ...overlays.keys()])
    if (!seen.has(key)) throw new Error(`Unused renderer color declaration: ${key}`);
  return checked;
}
