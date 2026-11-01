import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const clean = (value) => value.replaceAll("`", "").trim();
export const cssName = (name) => `--${name.replaceAll(".", "-")}`;
function section(text, heading, end) {
  const start = text.indexOf(heading);
  const finish = end ? text.indexOf(end, start + heading.length) : text.length;
  if (start < 0 || finish < 0) throw new Error(`Missing canonical section: ${heading}`);
  return text.slice(start + heading.length, finish);
}
function rows(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[ -]+\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map(clean));
}
/** Parse the canonical documents; generated artifacts never introduce physical decisions. */
export function readDesign(design, workspace) {
  const tokens = {},
    pairs = [],
    typography = {},
    icons = {};
  const add = (name, value) => {
    if (Object.hasOwn(tokens, name)) throw new Error(`Duplicate token: ${name}`);
    tokens[name] = value;
  };
  for (const row of rows(section(design, "#### Reference palette", "#### Semantic color tokens")))
    if (row[0]?.startsWith("ref.")) {
      if (!/^#[a-f0-9]{6}$/.test(row[1])) throw new Error("Invalid canonical color");
      add(row[0], row[1]);
    }
  for (const text of [section(design, "#### Semantic color tokens", "#### Color usage rules")])
    for (const row of rows(text))
      if (
        /^(surface|content|border|action|focus|selection|voice|evidence|attention|danger|character)\./.test(
          row[0],
        )
      )
        add(row[0], { light: `ref.color.${row[1]}`, dark: `ref.color.${row[2]}` });
  for (const row of rows(section(design, "#### Verified contrast pairs", "### Typography")))
    if (/^[a-z]+\./.test(row[0]))
      pairs.push({ foreground: row[0], background: row[1], minimum: Number(row[2].split(":")[0]) });
  for (const row of rows(
    section(design, "#### Interface scale", "#### Weights, styles and numerals"),
  )) {
    if (!row[0]?.startsWith("type.")) continue;
    const [size, height] = row[2].split("/").map(Number);
    const family = { Sans: "ui", Serif: "document", Mono: "code", Math: "math" }[row[1]];
    if (!family || !Number.isFinite(size) || !Number.isFinite(Number(row[3])))
      throw new Error("Invalid type scale");
    typography[row[0]] = {
      family: `font.family.${family}`,
      size,
      ...(height ? { height } : {}),
      weight: Number(row[3]),
    };
    for (const [part, value] of Object.entries(typography[row[0]]))
      add(
        `${row[0]}.${part}`,
        typeof value === "number" ? `${value}${part === "weight" ? "" : "px"}` : { alias: value },
      );
  }
  for (const row of rows(section(design, "### Spacing", "### Shape")))
    if (row[0]?.startsWith("space."))
      add(row[0], row[1] === "0" ? "0px" : row[1].replaceAll(" ", ""));
  const measurements =
    section(design, "### Shape", "## Ohtia's symbol and character") +
    section(
      design,
      "### Initial animation repertoire",
      "### Static, hidden and interrupted presentation",
    ) +
    section(workspace, "## Workspace component measurements", "## Regions and surfaces");
  for (const match of measurements.matchAll(
    /`((?:radius|border-width|focus|component|z|motion\.duration|icon)\.[a-z0-9.-]+)`\s*(?::|is|of|,)?\s*(\d+(?:\.\d+)?)\s*(px|ms)?/g,
  )) {
    const [, name, number, unit] = match;
    add(name, `${number}${unit ?? (name.startsWith("icon.size") ? "px" : "")}`);
  }
  for (const match of measurements.matchAll(/`(component\.[a-z0-9.-]+)`:\s*alias of `(.*?)`/g))
    add(match[1], { alias: match[2] });
  const selection = design.match(/`component\.list-row\.selection-indicator` token is a (\d+) px/);
  if (!selection) throw new Error("Missing selection indicator");
  add("component.list-row.selection-indicator", `${selection[1]}px`);
  for (const match of section(
    design,
    "#### Families and stacks",
    "#### Application rules",
  ).matchAll(/`(font\.family\.[a-z]+)`: ([^\n]+)\./g))
    add(
      match[1],
      match[2]
        .replaceAll(" (U+207F only)", "")
        .split(", ")
        .map((name) => JSON.stringify(name))
        .join(", "),
    );
  const measure = design.match(/`measure\.reading` is `(\d+em)`/);
  const easing = design.match(/`motion\.easing\.standard` is `([^`]+)`/);
  if (!measure || !easing) throw new Error("Missing measure/easing");
  add("measure.reading", measure[1]);
  add("motion.easing.standard", easing[1]);
  const scrim = design.match(
    /`overlay\.scrim`: `([^`]+)` at (\d+)% opacity in light mode and `([^`]+)` at (\d+)%/,
  );
  const shadow = design.match(
    /`shadow\.overlay`: vertical offset (\d+) px and blur (\d+) px in `([^`]+)` at (\d+)%/,
  );
  if (!scrim || !shadow) throw new Error("Missing overlay tokens");
  add("overlay.scrim", {
    light: { color: `ref.color.${scrim[1]}`, alpha: Number(scrim[2]) / 100 },
    dark: { color: `ref.color.${scrim[3]}`, alpha: Number(scrim[4]) / 100 },
  });
  add("shadow.overlay", {
    shadow: {
      y: Number(shadow[1]),
      blur: Number(shadow[2]),
      color: `ref.color.${shadow[3]}`,
      alpha: Number(shadow[4]) / 100,
    },
  });
  for (const row of rows(section(design, "Fixed mappings:", "## Ohtia's symbol and character")))
    if (/^[a-z]+(?:-[a-z]+)*$/.test(row[1])) icons[row[0]] = row[1];
  for (const row of rows(
    section(design, "#### Comparison outcomes", "#### Criticism and review"),
  )) {
    const icon = row.find((cell, index) => index > 0 && /^[a-z]+(?:-[a-z]+)*$/.test(cell));
    if (icon) icons[row[0]] = icon;
  }
  for (const match of section(
    workspace,
    "## Visibility, focus mode and narrow layout",
    "## Desktop preference boundary",
  )
    .split("\n")
    .filter((line) => /^- `[A-Z]/.test(line) || line.includes("Theme selection offers"))
    .join("\n")
    .matchAll(/`([A-Z][A-Za-z0-9]+)`/g))
    icons[match[1]] = match[1]
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([a-z])(\d)/g, "$1-$2")
      .toLowerCase();
  // Every concrete reference in either canonical document must resolve.
  const names = [
    ...(design + workspace).matchAll(
      /`((?:ref\.|surface\.|content\.|border\.|action\.|focus\.|selection\.|voice\.|evidence\.|attention\.|danger\.|character\.|font\.|type\.|measure\.|space\.|radius\.|border-width\.|component\.|z\.|motion\.|icon\.|overlay\.|shadow\.)[a-z0-9.-]+)`/g,
    ),
  ].map((m) => m[1]);
  for (const name of names)
    if (name !== "ref.color" && !Object.hasOwn(tokens, name) && !Object.hasOwn(typography, name))
      throw new Error(`Unparsed canonical token: ${name}`);
  if (pairs.some((pair) => ![3, 7].includes(pair.minimum)))
    throw new Error("Invalid contrast minimum");
  if (Object.values(typography).some((style) => style.size < 12))
    throw new Error("Typography below the 12px floor");
  const resolve = (name, mode, seen = new Set()) => {
    if (seen.has(name)) throw new Error(`Cyclic token: ${name}`);
    if (!Object.hasOwn(tokens, name)) throw new Error(`Unresolved token: ${name}`);
    seen.add(name);
    const value = tokens[name];
    if (typeof value === "string") return value;
    if (value.alias) return resolve(value.alias, mode, seen);
    const selected = value[mode];
    if (typeof selected === "string") return resolve(selected, mode, seen);
    const color = selected ?? value.shadow;
    const hex = resolve(color.color, mode, seen);
    const rgba = `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ")} / ${color.alpha})`;
    return value.shadow ? `0 ${color.y}px ${color.blur}px ${rgba}` : rgba;
  };
  for (const name of Object.keys(tokens)) for (const mode of ["light", "dark"]) resolve(name, mode);
  return { tokens, typography, icons, pairs, resolve };
}
export function contrast(foreground, background) {
  const luminance = (hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function assertPair(design, foreground, background, minimum) {
  const pair = design.pairs.find((p) => p.foreground === foreground && p.background === background);
  if (!pair || pair.minimum < minimum)
    throw new Error(`Unlisted contrast pair: ${foreground}/${background}`);
  for (const mode of ["light", "dark"])
    if (contrast(design.resolve(foreground, mode), design.resolve(background, mode)) < pair.minimum)
      throw new Error(`Insufficient contrast: ${foreground}/${background}/${mode}`);
}
function declaration(name, value, mode) {
  if (typeof value === "string") return value;
  if (value.alias) return `var(${cssName(value.alias)})`;
  if (typeof value[mode] === "string") return `var(${cssName(value[mode])})`;
  return null;
}
export function renderTokens(model) {
  for (const pair of model.pairs) assertPair(model, pair.foreground, pair.background, pair.minimum);
  const block = (mode, predicate = () => true) =>
    Object.entries(model.tokens)
      .filter(([name, value]) => predicate(name, value))
      .map(
        ([name, value]) =>
          `  ${cssName(name)}: ${declaration(name, value, mode) ?? model.resolve(name, mode)};`,
      )
      .join("\n");
  const dark = block("dark", (_, value) => typeof value === "object" && value.dark);
  const motion = Object.keys(model.tokens)
    .filter((name) => name.startsWith("motion.duration."))
    .map((name) => `  ${cssName(name)}: 0ms;`)
    .join("\n");
  const typeRules = Object.entries(model.typography)
    .map(
      ([name, style]) =>
        `[data-type="${name}"] {\n  font-family: var(${cssName(style.family)});\n  font-size: var(${cssName(name + ".size")});\n  font-weight: var(${cssName(name + ".weight")});\n  line-height: ${style.height ? style.height / style.size : 1.5};\n}\n`,
    )
    .join("\n");
  const css = `/* Generated from docs/design-system.md and docs/workspace-layout.md. */\n:root {\n${block("light")}\n}\n:root[data-appearance="dark"] {\n${dark}\n}\n@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-appearance="light"]):not([data-appearance="dark"])) {\n${dark}\n  }\n}\n@media (prefers-reduced-motion: reduce) {\n  :root {\n${motion}\n  }\n}\n${typeRules}`;
  const numeric = Object.fromEntries(
    Object.keys(model.tokens)
      .filter((name) => /^-?\d+(\.\d+)?(px|ms)?$/.test(model.resolve(name, "light")))
      .sort()
      .map((name) => [name, parseFloat(model.resolve(name, "light"))]),
  );
  const ts = `// Generated from the canonical design and workspace definitions; values use CSS px or ms.\nexport const designMetrics = ${JSON.stringify(numeric, null, 2)} as const;\nexport const iconMappings = ${JSON.stringify(model.icons, null, 2)} as const;\n`;
  return { css, ts };
}
export function checkTokens(directory = root, write = false) {
  const model = readDesign(
    fs.readFileSync(path.join(directory, "docs/design-system.md"), "utf8"),
    fs.readFileSync(path.join(directory, "docs/workspace-layout.md"), "utf8"),
  );
  const output = renderTokens(model);
  for (const [file, value] of [
    ["packages/renderer/src/design-tokens.css", output.css],
    ["packages/renderer/src/design-tokens.ts", output.ts],
  ]) {
    const target = path.join(directory, file);
    if (write) fs.writeFileSync(target, value);
    else if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== value)
      throw new Error(`Design token drift: ${file}`);
  }
  return model;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkTokens(root, process.argv[2] === "--write");
}
