import { defineConfig } from "vitest/config";
import configuration from "./vitest.config.js";

// Instrument every product module without running cases. This is a denominator,
// never a successful test partition and never a substitute for mandatory tests.
export default defineConfig({
  ...configuration,
  test: {
    ...configuration.test,
    include: [],
    passWithNoTests: true,
    reporters: [["json", { outputFile: ".reports/quality/denominator-run.json" }]],
    coverage: {
      ...configuration.test?.coverage,
      enabled: true,
      reportsDirectory: ".reports/quality/denominator",
    },
  },
});
