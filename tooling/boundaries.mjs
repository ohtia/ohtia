import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { packageDirectories } from "./packages.mjs";

function runtimeDependencies(manifest) {
  return {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
}
function allDependencies(manifest) {
  return { ...runtimeDependencies(manifest), ...manifest.devDependencies };
}

export function inspectWorkspace(root) {
  const policies = JSON.parse(
    fs.readFileSync(path.join(root, "config/workspace-boundaries.json"), "utf8"),
  );
  const packages = new Map();
  const actual = packageDirectories(root).map((directory) => path.basename(directory));
  if (actual.some((entry) => !Object.hasOwn(policies, entry)))
    throw new Error("Every package must have an explicit boundary policy.");
  const errors = [];
  for (const boundary of Object.keys(policies)) {
    const directory = path.join(root, "packages", boundary);
    if (fs.lstatSync(directory).isSymbolicLink())
      errors.push(`${boundary}: symlinked package directories are forbidden`);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    if (manifest.name !== `@ohtia/${boundary}`)
      errors.push(`${boundary}: package identity mismatch`);
    if (!manifest.exports?.["."]?.types || !manifest.exports?.["."]?.import)
      errors.push(`${boundary}: declare public types and output`);
    packages.set(manifest.name, { boundary, directory, manifest });
  }
  const active = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(name) {
    if (active.has(name)) {
      errors.push(`Dependency cycle at ${name}`);
      return;
    }
    if (visited.has(name)) return;
    active.add(name);
    const item = packages.get(name);
    for (const dependency of Object.keys(allDependencies(item.manifest))) {
      if (packages.has(dependency)) visit(dependency);
    }
    active.delete(name);
    visited.add(name);
    ordered.push(item);
  }
  for (const name of packages.keys()) visit(name);
  for (const item of packages.values()) {
    const { boundary, directory, manifest } = item;
    const policy = policies[boundary];
    const runtime = runtimeDependencies(manifest);
    const declarations = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ].flatMap((category) => Object.entries(manifest[category] ?? {}));
    for (const [dependency, version] of declarations) {
      const internal = dependency.startsWith("@ohtia/");
      if (
        internal
          ? !policy.packages.includes(dependency)
          : Object.hasOwn(runtime, dependency) && !policy.external.includes(dependency)
      )
        errors.push(`${boundary}: forbidden dependency ${dependency}`);
      if (internal && version !== "workspace:*")
        errors.push(`${boundary}: internal dependency must use workspace:*`);
    }
    const sourceRoot = path.join(directory, "src");
    if (fs.lstatSync(sourceRoot).isSymbolicLink())
      errors.push(`${boundary}: symlinked product sources are forbidden`);
    for (const entry of fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
      if (entry.isSymbolicLink())
        errors.push(`${boundary}: symlinked product sources are forbidden`);
    }
    const files = fs
      .readdirSync(sourceRoot, { recursive: true })
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    for (const file of files) {
      const full = path.join(sourceRoot, file);
      if (!fs.realpathSync(full).startsWith(fs.realpathSync(sourceRoot) + path.sep)) {
        errors.push(`${boundary}: source escapes its package`);
        continue;
      }
      // ADR-0007 requires published executable migration bytes to survive compiler changes.
      // Admit only the fixed utility migration modules; checkJs checks them alongside TypeScript.
      if (
        !/\.tsx?$/.test(file) &&
        !(
          boundary === "utility" &&
          ["migrations/0001_initial.mjs", "migrations/0002_receipts.mjs"].includes(
            file.replaceAll(path.sep, "/"),
          )
        )
      )
        errors.push(`${boundary}: product sources must be checked TypeScript`);
      const source = ts.createSourceFile(
        full,
        fs.readFileSync(full, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      if (
        source.typeReferenceDirectives.length ||
        source.libReferenceDirectives.length ||
        source.referencedFiles.length
      )
        errors.push(
          `${boundary}/${file}: source-level compiler references are forbidden; use the boundary tsconfig`,
        );
      function checkImport(specifier) {
        if (!specifier || !ts.isStringLiteralLike(specifier)) {
          errors.push(`${boundary}/${file}: computed imports are forbidden`);
          return;
        }
        const value = specifier.text;
        if (value.startsWith(".")) {
          const resolved = path.resolve(path.dirname(full), value);
          if (!resolved.startsWith(sourceRoot + path.sep))
            errors.push(`${boundary}/${file}: cross-package internal path ${value}`);
        } else if (value.startsWith("node:")) {
          if (!policy.builtins.includes(value))
            errors.push(`${boundary}/${file}: forbidden builtin ${value}`);
        } else {
          const dependency = value.startsWith("@")
            ? value.split("/").slice(0, 2).join("/")
            : value.split("/")[0];
          if (dependency.startsWith("@ohtia/") && value !== dependency)
            errors.push(`${boundary}/${file}: internal-path import ${value}`);
          if (
            !runtime[dependency] ||
            ![...policy.packages, ...policy.external].includes(dependency)
          )
            errors.push(`${boundary}/${file}: forbidden import ${value}`);
        }
      }
      function walk(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
          checkImport(node.moduleSpecifier);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
          checkImport(node.argument.literal);
        if (ts.isImportEqualsDeclaration(node))
          errors.push(`${boundary}/${file}: import-equals is forbidden`);
        if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) checkImport(node.arguments[0]);
          if (ts.isIdentifier(node.expression) && node.expression.text === "require")
            errors.push(`${boundary}/${file}: require is forbidden; use checked ESM imports`);
        }
        ts.forEachChild(node, walk);
      }
      walk(source);
    }
  }
  return { errors, ordered };
}
