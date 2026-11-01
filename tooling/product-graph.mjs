import fs from "node:fs";
import path from "node:path";

/** Check resolved modules, before tree shaking can hide an accidental development import. */
export function productGraph(root) {
  const canonical = fs.realpathSync(root);
  return {
    name: "exclude-development-graphs",
    transform(_source, id) {
      if (id.startsWith("\0")) return;
      const file = id.split("?")[0];
      if (!path.isAbsolute(file) || !fs.existsSync(file)) return;
      const relative = path.relative(canonical, fs.realpathSync(file)).replaceAll(path.sep, "/");
      if (relative.split("/").includes("node_modules")) return;
      // This is the controlled product localization module, not a development catalog.
      if (/^packages\/contracts\/(?:src\/catalogs\.ts|dist\/catalogs\.js)$/.test(relative)) return;
      if (
        /^(?:tools|tests)\//.test(relative) ||
        relative
          .split("/")
          .some((segment) => /fixture|specimen|catalog|test[-_]?transport/i.test(segment)) ||
        /\.(?:test|spec)\.[^/]+$/.test(relative)
      )
        throw new Error(`Development module in product graph: ${relative}`);
    },
  };
}
