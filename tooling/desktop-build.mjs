import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "vite";

export async function buildDesktop(root) {
  const output = path.join(root, "artifacts/desktop-app");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const [boundary, format, file] of [
    ["main", "es", "main.mjs"],
    ["preload", "cjs", "preload.cjs"],
    ["utility", "es", "utility.mjs"],
  ]) {
    await build({
      configFile: false,
      root,
      logLevel: "warn",
      build: {
        outDir: output,
        emptyOutDir: false,
        target: "node24",
        minify: false,
        sourcemap: false,
        lib: {
          entry: `packages/${boundary}/src/entry.ts`,
          formats: [format],
          fileName: () => file,
        },
        rolldownOptions: { external: ["electron", /^node:/] },
      },
    });
  }
  await build({
    configFile: false,
    root: path.join(root, "packages/renderer/app"),
    base: "./",
    logLevel: "warn",
    build: {
      outDir: path.join(output, "renderer"),
      emptyOutDir: true,
      sourcemap: false,
      assetsInlineLimit: 0,
      rolldownOptions: {
        output: {
          entryFileNames: "assets/app.js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  });
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".otf": "font/otf",
  };
  const assets = {};
  for (const name of fs.readdirSync(path.join(output, "renderer"), { recursive: true })) {
    const file = path.join(output, "renderer", name);
    if (!fs.statSync(file).isFile()) continue;
    if (!types[path.extname(name)] || /(?:fixture|preview|probe|\.map$)/i.test(name))
      throw new Error("Unexpected desktop renderer asset.");
    const bytes = fs.readFileSync(file);
    assets[name.replaceAll(path.sep, "/")] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      type: types[path.extname(name)],
    };
  }
  fs.writeFileSync(path.join(output, "assets.json"), JSON.stringify(assets));
  fs.writeFileSync(
    path.join(output, "package.json"),
    JSON.stringify({
      name: "Ohtia",
      productName: "Ohtia",
      version: "0.0.0",
      private: true,
      type: "module",
      main: "main.mjs",
    }),
  );
  const licenses = path.join(output, "licenses");
  fs.mkdirSync(licenses);
  for (const name of fs.readdirSync(path.join(root, "packages/renderer/fonts")))
    if (name.endsWith("LICENSE.txt") || name === "manifest.json")
      fs.copyFileSync(path.join(root, "packages/renderer/fonts", name), path.join(licenses, name));
  const inventory = {};
  for (const name of fs.readdirSync(output, { recursive: true })) {
    const file = path.join(output, name);
    if (fs.statSync(file).isFile())
      inventory[name.replaceAll(path.sep, "/")] = createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
  }
  fs.writeFileSync(
    path.join(output, "inventory.json"),
    JSON.stringify({ version: 1, files: inventory }),
  );
  return output;
}
