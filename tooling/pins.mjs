import fs from "node:fs";
import path from "node:path";
import { packageDirectories } from "./packages.mjs";

export function assertPackagePins(root) {
  const tools = JSON.parse(fs.readFileSync(path.join(root, "config/desktop/toolchain.json"))).tools;
  const manifests = [
    path.join(root, "package.json"),
    ...packageDirectories(root).map((directory) => path.join(directory, "package.json")),
  ];
  for (const file of manifests) {
    const manifest = JSON.parse(fs.readFileSync(file));
    const declarations = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ].flatMap((category) => Object.entries(manifest[category] ?? {}));
    for (const [name, version] of declarations) {
      if (version === "workspace:*") continue;
      if (!/^\d+\.\d+\.\d+$/.test(version))
        throw new Error(`${manifest.name}: ${name} must have an exact manifest pin`);
      if (tools[name] && version !== tools[name].version)
        throw new Error(`${manifest.name}: ${name} differs from the adopting toolchain manifest`);
      const installed = JSON.parse(
        fs.readFileSync(path.join(path.dirname(file), "node_modules", name, "package.json")),
      );
      if (installed.version !== version)
        throw new Error(`${manifest.name}: effective ${name} version mismatch; rerun frozen setup`);
    }
  }
}
