import fs from "node:fs";
import path from "node:path";

/** Match pnpm's package inventory rather than Finder files or leftover outputs. */
export function packageDirectories(root) {
  return fs
    .readdirSync(path.join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        fs.existsSync(path.join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => path.join(root, "packages", entry.name));
}
