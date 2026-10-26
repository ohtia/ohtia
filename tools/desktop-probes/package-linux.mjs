import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(import.meta.url);
process.umask(0o022);
const { build, Platform, Arch } = require("electron-builder");
const validateOnly = process.argv[2] === "--validate";
const [configuration, prepackaged] = process.argv.slice(validateOnly ? 3 : 2);
const config = JSON.parse(readFileSync(configuration, "utf8"));
const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
const { validateConfiguration } = builderRequire("app-builder-lib/out/util/config/config.js");
await validateConfiguration(config, { isEnabled: false });
if (!validateOnly)
  await build({
    projectDir: fileURLToPath(new URL("../..", import.meta.url)),
    prepackaged,
    targets: Platform.LINUX.createTarget(
      config.linux.target,
      process.arch === "arm64" ? Arch.arm64 : Arch.x64,
    ),
    config,
    publish: "never",
  });
