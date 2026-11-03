// Bundle an isolated frozen installation; no developer node_modules or whole-worktree copy.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));

export function writeDependencyNotices(packages, notices, fallbackPolicy, projectLicense) {
  fs.mkdirSync(notices, { recursive: true });
  fs.copyFileSync(projectLicense, path.join(notices, "Ohtia-LICENSE"));
  const noticeMap = {};
  for (const [identity, directory] of packages) {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
    const copied = [];
    for (const name of fs.readdirSync(directory)) {
      const source = path.join(directory, name);
      if (
        /^(?:licen[sc]e|notice|copying)(?:[.-].*)?$/i.test(name) &&
        fs.lstatSync(source).isFile()
      ) {
        const target = identity.replaceAll("/", "-") + "-" + name;
        fs.copyFileSync(source, path.join(notices, target));
        copied.push(target);
      }
    }
    let fallbackSource = null;
    if (!copied.length) {
      const matches = fallbackPolicy.filter((row) => row.package === identity);
      const selected = matches[0];
      if (
        matches.length !== 1 ||
        selected.license !== metadata.license ||
        !packages.has(selected.source_package) ||
        path.basename(selected.file) !== selected.file
      )
        throw new Error("Missing declared dependency notice: " + identity);
      const source = path.join(packages.get(selected.source_package), selected.file);
      if (!fs.lstatSync(source).isFile()) throw new Error("Invalid dependency notice file.");
      const bytes = fs.readFileSync(source);
      if (createHash("sha256").update(bytes).digest("hex") !== selected.sha256)
        throw new Error("Dependency notice digest mismatch.");
      const target = identity.replaceAll("/", "-") + "-LICENSE";
      fs.writeFileSync(path.join(notices, target), bytes);
      copied.push(target);
      fallbackSource = selected.source_package + "/" + selected.file;
    }
    noticeMap[identity] = {
      license: metadata.license,
      files: copied,
      fallback_source: fallbackSource,
    };
  }
  if (!packages.size) throw new Error("Empty signer dependency notice inventory.");
  fs.writeFileSync(
    path.join(notices, "notice-map.json"),
    JSON.stringify(noticeMap, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(notices, "dependencies.json"),
    JSON.stringify([...packages.keys()].sort(), null, 2) + "\n",
  );
}

export async function assembleSigningRuntime(destination) {
  destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error("Signing runtime destination already exists.");
  await build({
    configFile: false,
    publicDir: false,
    root,
    logLevel: "warn",
    ssr: { noExternal: true },
    plugins: [
      {
        name: "signer-dependency-notices",
        generateBundle() {
          const packages = new Map();
          for (const id of this.getModuleIds()) {
            if (!id.includes("node_modules") || id.startsWith("\0")) continue;
            let directory = path.dirname(id.split("?")[0]);
            while (directory.startsWith(path.join(root, "node_modules") + path.sep)) {
              const metadata = path.join(directory, "package.json");
              if (fs.existsSync(metadata)) {
                const pkg = JSON.parse(fs.readFileSync(metadata));
                if (typeof pkg.name === "string" && typeof pkg.version === "string") {
                  packages.set(pkg.name + "@" + pkg.version, directory);
                  break;
                }
              }
              directory = path.dirname(directory);
            }
          }
          const fallbackPolicy = JSON.parse(
            fs.readFileSync(path.join(root, "config/installation/signing-image.json")),
          ).license_fallbacks;
          writeDependencyNotices(
            packages,
            path.join(destination, "licenses"),
            fallbackPolicy,
            path.join(root, "LICENSE"),
          );
        },
      },
    ],
    build: {
      ssr: "tooling/installation-signing-container.mjs",
      target: "node26",
      minify: false,
      sourcemap: false,
      outDir: path.join(destination, "tooling"),
      rolldownOptions: { output: { entryFileNames: "installation-signing-container.mjs" } },
    },
  });
  for (const name of ["installation-signing-runner.mjs", "installation-source-pack.mjs"])
    fs.copyFileSync(path.join(root, "tooling", name), path.join(destination, "tooling", name));
  fs.mkdirSync(path.join(destination, "config/desktop"), { recursive: true });
  for (const name of ["resource-policy.json", "targets.json"])
    fs.copyFileSync(
      path.join(root, "config/desktop", name),
      path.join(destination, "config/desktop", name),
    );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await assembleSigningRuntime(process.argv[2]);
