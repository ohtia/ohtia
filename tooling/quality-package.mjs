// Build unsigned development packages using the locked builder and the assembled runtime.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require("electron-builder");
const validateOnly = process.argv[2] === "--validate";
const [configuration] = process.argv.slice(validateOnly ? 3 : 2);
const config = JSON.parse(fs.readFileSync(configuration, "utf8"));
if (!/^0\.0\.0-dev\.[1-9][0-9]*\.[1-9][0-9]*$/.test(config.extraMetadata.version))
  throw new Error("Quality packages require a run/attempt development version.");
process.umask(0o022);
const platform = { linux: Platform.LINUX, win32: Platform.WINDOWS, darwin: Platform.MAC }[
  process.platform
];
if (!platform || !["x64", "arm64"].includes(process.arch))
  throw new Error("Undeclared native packaging platform.");
const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
const { validateConfiguration } = builderRequire("app-builder-lib/out/util/config/config.js");
await validateConfiguration(config, { isEnabled: false });
if (validateOnly) process.exit(0);
// Use an isolated application directory with the complete locked external dependency closure.
// The assembled runtime remains unchanged and never becomes a second mutable authority.
const application = path.join(path.dirname(config.directories.output), "packaging-app");
fs.cpSync(config.directories.app, application, { recursive: true });
config.directories.app = application;
const utilityRequire = createRequire(path.join(root, "packages/utility/package.json"));
const betterRequire = createRequire(utilityRequire.resolve("better-sqlite3/package.json"));
const addonHeaders = path.dirname(betterRequire.resolve("node-addon-api/package.json"));
fs.cpSync(addonHeaders, path.join(application, "node_modules/node-addon-api"), {
  recursive: true,
  filter: (entry) => !path.relative(addonHeaders, entry).split(path.sep).includes("node_modules"),
});
const metadataFile = path.join(application, "package.json");
const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
const tools = JSON.parse(fs.readFileSync(path.join(root, "config/desktop/toolchain.json"))).tools;
metadata.dependencies = Object.fromEntries(
  ["better-sqlite3", "kysely"].map((name) => [name, tools[name].version]),
);
fs.writeFileSync(metadataFile, JSON.stringify({ ...metadata, ...config.extraMetadata }));
// Retain the notices of dependencies actually bundled into the app, as well as native/runtime notices.
const noticeDirectory = path.join(config.directories.app, "licenses");
fs.copyFileSync(path.join(root, "LICENSE"), path.join(noticeDirectory, "Ohtia-LICENSE"));
for (const name of ["react", "react-dom", "scheduler"]) {
  const resolver =
    name === "scheduler" ? createRequire(require.resolve("react-dom/package.json")) : require;
  const source = path.dirname(resolver.resolve(`${name}/package.json`));
  fs.copyFileSync(path.join(source, "LICENSE"), path.join(noticeDirectory, `${name}-LICENSE`));
}
function refreshInventory(app) {
  const inventory = {};
  for (const name of fs.readdirSync(app, { recursive: true })) {
    const file = path.join(app, name);
    if (name !== "inventory.json" && fs.statSync(file).isFile())
      inventory[name.replaceAll(path.sep, "/")] = createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
  }
  fs.writeFileSync(
    path.join(app, "inventory.json"),
    JSON.stringify({ version: 1, files: inventory }),
  );
}
// No signing credentials, updater configuration or publication action is part of this entry.
await build({
  projectDir: root,
  config: {
    ...config,
    publish: null,
    npmRebuild: false,
    nodeGypRebuild: false,
    asar: false,
    afterSign: async ({ appOutDir }) => {
      if (process.platform !== "darwin") return;
      const bundle = path.join(appOutDir, "ohtia-quality.app");
      const app = path.join(bundle, "Contents/Resources/app");
      const file = path.join(app, "storage.json");
      const descriptor = JSON.parse(fs.readFileSync(file, "utf8"));
      // Ad-hoc signing can change Mach-O bytes without changing the engine. Bind admission to
      // the completed signed addon, then reseal only the containing bundle's resource envelope.
      descriptor.bindingSha256 = createHash("sha256")
        .update(fs.readFileSync(path.join(app, "native/binding.node")))
        .digest("hex");
      fs.writeFileSync(file, JSON.stringify(descriptor) + "\n");
      refreshInventory(app);
      execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", bundle], { stdio: "inherit" });
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], {
        stdio: "inherit",
      });
    },
    afterPack: async ({ appOutDir }) => {
      const app =
        process.platform === "darwin"
          ? path.join(appOutDir, "ohtia-quality.app/Contents/Resources/app")
          : path.join(appOutDir, "resources/app");
      refreshInventory(app);
      const files = fs.readdirSync(appOutDir, { recursive: true });
      for (const name of files) {
        const file = path.join(appOutDir, name);
        if (fs.lstatSync(file).isFile() && process.platform !== "win32")
          fs.chmodSync(file, fs.statSync(file).mode & 0o755);
      }
    },
  },
  targets: platform.createTarget(
    config[process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"]
      .target,
    process.arch === "arm64" ? Arch.arm64 : Arch.x64,
  ),
  publish: "never",
});
