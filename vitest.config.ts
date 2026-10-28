import path from "node:path";
import { createCoverageInstrumenter } from "./tooling/quality-instrumenter.mjs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "test-package-sources",
      enforce: "pre",
      resolveId(source, importer) {
        // Exercise the authored modules, retaining the same public package boundaries.
        const match = /(?:^|\/)packages\/([^/]+)\/dist\/(.+)\.js$/.exec(source);
        if (match)
          return path.resolve(
            `packages/${match[1]}/src/${match[2]}.${match[1] === "renderer" ? "tsx" : "ts"}`,
          );
        if (source.startsWith("@ohtia/") && !source.slice(7).includes("/")) {
          const name = source.slice(7);
          return path.resolve(`packages/${name}/src/index.${name === "renderer" ? "tsx" : "ts"}`);
        }
        // Vite resolves relative .js imports inside the selected TypeScript source.
        void importer;
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    alias: { electron: path.resolve("tests/fixtures/electron.ts") },
    allowOnly: false,
    passWithNoTests: false,
    maxWorkers: 2,
    testTimeout: 15000,
    reporters: [
      "default",
      "./tooling/quality-vitest-reporter.mjs",
      ["json", { outputFile: ".reports/quality/vitest.json" }],
    ],
    coverage: {
      provider: "istanbul",
      instrumenter: createCoverageInstrumenter,
      include: ["packages/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
      exclude: ["**/*.d.ts", "packages/contracts/src/generated/resource-policy.ts"],
      reporter: ["json", "text-summary"],
      reportsDirectory: ".reports/quality/coverage",
      reportOnFailure: true,
    },
  },
});
