import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "vite";
import { productGraph } from "./product-graph.mjs";

export async function buildDesktop(root) {
  const output = path.join(root, "artifacts/desktop-app");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const [boundary, format, file] of [
    ["main", "es", "main.mjs"],
    ["preload", "cjs", "preload.cjs"],
    ["utility", "es", "utility.mjs"],
    ["storage", "es", "storage.js"],
    ["diagnostic-writer", "es", "diagnostic-writer.js"],
  ]) {
    await build({
      configFile: false,
      plugins: [productGraph(root)],
      root,
      logLevel: "warn",
      build: {
        outDir: output,
        emptyOutDir: false,
        target: "node24",
        minify: false,
        sourcemap: false,
        lib: {
          entry:
            boundary === "diagnostic-writer"
              ? "packages/main/src/diagnostic-writer.ts"
              : boundary === "storage"
                ? "packages/utility/src/storage.ts"
                : `packages/${boundary}/src/entry.ts`,
          formats: [format],
          fileName: () => file,
        },
        rolldownOptions: {
          external: [
            "electron",
            "better-sqlite3",
            "kysely",
            "kysely/migration",
            "./storage.js",
            ...(boundary === "main" ? ["./diagnostic-writer.js"] : []),
            /^node:/,
            /\.\/migrations\/.*\.mjs$/,
          ],
        },
      },
    });
  }
  await build({
    configFile: false,
    plugins: [productGraph(root)],
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
  for (const directory of ["icons", "branding"]) {
    const destination = path.join(output, "renderer", directory);
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(path.join(root, "packages/renderer", directory))) {
      if (/\.(svg|png)$/.test(name))
        fs.copyFileSync(
          path.join(root, "packages/renderer", directory, name),
          path.join(destination, name),
        );
    }
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".otf": "font/otf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const assets = {};
  for (const name of fs.readdirSync(path.join(output, "renderer"), { recursive: true })) {
    const file = path.join(output, "renderer", name);
    if (!fs.statSync(file).isFile()) continue;
    if (
      !types[path.extname(name)] ||
      /(?:fixture|preview|probe|catalog|specimen|test-transport|\.map$)/i.test(name)
    )
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
      version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
      private: true,
      type: "module",
      main: "main.mjs",
    }),
  );
  // Copy the exact immutable modules and external runtime packages; never rebundle migration bytes.
  fs.cpSync(path.join(root, "packages/utility/src/migrations"), path.join(output, "migrations"), {
    recursive: true,
  });
  for (const name of ["better-sqlite3", "kysely"]) {
    const source = fs.realpathSync(path.join(root, "packages/utility/node_modules", name));
    fs.cpSync(source, path.join(output, "node_modules", name), {
      recursive: true,
      filter: (entry) => {
        const relative = path.relative(source, entry);
        return (
          !relative.split(path.sep).includes("node_modules") &&
          (name !== "better-sqlite3" ||
            !relative ||
            ["lib", "prebuilds", "LICENSE", "package.json"].includes(relative.split(path.sep)[0]))
        );
      },
    });
  }
  const licenses = path.join(output, "licenses");
  fs.mkdirSync(licenses);
  for (const name of fs.readdirSync(path.join(root, "packages/renderer/fonts")))
    if (name.endsWith("LICENSE.txt") || name === "manifest.json")
      fs.copyFileSync(path.join(root, "packages/renderer/fonts", name), path.join(licenses, name));
  for (const directory of ["icons", "branding"]) {
    for (const name of ["LICENSE.txt", "manifest.json"]) {
      const source = path.join(root, "packages/renderer", directory, name);
      if (fs.existsSync(source))
        fs.copyFileSync(source, path.join(licenses, `${directory}-${name}`));
    }
  }
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(licenses, "Ohtia-LICENSE"));
  const require = createRequire(path.join(root, "package.json"));
  const notices = [];
  for (const component of [
    "react",
    "react-dom",
    "scheduler",
    "better-sqlite3",
    "node-addon-api",
    "kysely",
    "electron",
  ]) {
    const resolver =
      component === "scheduler"
        ? createRequire(require.resolve("react-dom/package.json"))
        : component === "node-addon-api"
          ? createRequire(
              path.join(
                fs.realpathSync(path.join(root, "packages/utility/node_modules/better-sqlite3")),
                "package.json",
              ),
            )
          : require;
    const source =
      component === "electron"
        ? fs.realpathSync(path.join(root, "packages/main/node_modules/electron"))
        : ["better-sqlite3", "kysely"].includes(component)
          ? fs.realpathSync(path.join(root, "packages/utility/node_modules", component))
          : path.dirname(resolver.resolve(`${component}/package.json`));
    const metadata = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    const name = ["LICENSE", "LICENSE.md"].find((name) => fs.existsSync(path.join(source, name)));
    if (!name || typeof metadata.license !== "string")
      throw new Error("Missing bundled dependency notice.");
    fs.copyFileSync(path.join(source, name), path.join(licenses, `${component}-LICENSE`));
    notices.push({ component, license: metadata.license });
  }
  const fonts = JSON.parse(
    fs.readFileSync(path.join(root, "packages/renderer/fonts/manifest.json"), "utf8"),
  );
  for (const font of fonts.fonts)
    if (!notices.some((notice) => notice.component === font.family))
      notices.push({ component: font.family, license: font.license });
  notices.push({ component: "Lucide", license: "ISC / MIT" });
  fs.writeFileSync(path.join(output, "notices.json"), JSON.stringify(notices));
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
