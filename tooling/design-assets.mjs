import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkColorUsage } from "./design-usage.mjs";
import { checkTokens } from "./design-tokens.mjs";

/** Exercise the current runtime's Intl output as well as the inspector's fixed repertoires. */
export function validateDesignAssets(root) {
  const locales = JSON.parse(
    fs.readFileSync(path.join(root, "config/quality/inventory.json")),
  ).locales;
  let sample = "";
  for (const locale of locales) {
    sample += new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(
      new Date("2026-01-02T00:00:00Z"),
    );
    for (const currency of [
      "USD",
      "EUR",
      "GBP",
      "KRW",
      "INR",
      "CAD",
      "AUD",
      "BRL",
      "MXN",
      "ARS",
      "CHF",
      "SEK",
      "DKK",
      "NOK",
    ])
      sample += new Intl.NumberFormat(locale, { style: "currency", currency }).format(-1234567.89);
  }
  // Korean output is checked through the Korean faces, never assigned to a Latin font.
  sample = [...sample]
    .filter(
      (char) =>
        char.codePointAt(0) < 0x1100 ||
        (char.codePointAt(0) >= 0x2000 && char.codePointAt(0) < 0x3000),
    )
    .join("");
  const result = spawnSync(
    path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    ["scripts/design_assets.py"],
    { cwd: root, input: sample, encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Design asset inspection failed: ${result.stderr}`);
  const model = checkTokens(root);
  checkRendererStyles(root, model);
  const icons = JSON.parse(
    fs.readFileSync(path.join(root, "packages/renderer/icons/manifest.json")),
  )
    .icons.map((record) => record.name)
    .sort();
  if (JSON.stringify(icons) !== JSON.stringify([...new Set(Object.values(model.icons))].sort()))
    throw new Error("Lucide export inventory differs from canonical mappings");
  return JSON.parse(result.stdout);
}

export function checkRendererStyles(root, model = checkTokens(root)) {
  return checkColorUsage(
    model,
    Object.fromEntries(
      fs
        .readdirSync(path.join(root, "packages/renderer/src"), { recursive: true })
        .filter(
          (name) =>
            name.endsWith(".css") && !["design-tokens.css", "design-fonts.css"].includes(name),
        )
        .map((name) => [
          name.replaceAll(path.sep, "/"),
          fs.readFileSync(path.join(root, "packages/renderer/src", name), "utf8"),
        ]),
    ),
    JSON.parse(fs.readFileSync(path.join(root, "packages/renderer/color-usage.json"), "utf8")),
  );
}
