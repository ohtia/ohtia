import { createRequire } from "node:module";
import { transformSync } from "@babel/core";
import optionalChaining from "@babel/plugin-transform-optional-chaining";
import logicalAssignment from "@babel/plugin-transform-logical-assignment-operators";

const require = createRequire(import.meta.resolve("@vitest/coverage-istanbul"));
const { createInstrumenter } = require("@vitest/istanbul-lib-instrument");

/** Expose conditional execution to the selected provider without changing production builds. */
export function createCoverageInstrumenter(options = {}) {
  const delegate = createInstrumenter({
    produceSourceMap: true,
    autoWrap: false,
    esModules: true,
    compact: false,
    ...options,
    ignoreLines: true,
  });
  return {
    instrumentSync(source, filename, inputSourceMap) {
      const lowered = transformSync(source, {
        filename: filename.split("?")[0],
        sourceFileName: filename.split("?")[0],
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        inputSourceMap: inputSourceMap ?? false,
        plugins: [
          optionalChaining.default ?? optionalChaining,
          logicalAssignment.default ?? logicalAssignment,
        ],
      });
      if (typeof lowered?.code !== "string" || !lowered.map)
        throw new Error("Coverage execution-boundary transform failed.");
      return delegate.instrumentSync(lowered.code, filename, lowered.map);
    },
    lastFileCoverage: () => delegate.lastFileCoverage(),
    lastSourceMap: () => delegate.lastSourceMap(),
  };
}
