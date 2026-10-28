import fs from "node:fs";
import path from "node:path";
import { occurrenceIds } from "./quality-core.mjs";

export default class QualityVitestReporter {
  onTestRunEnd(modules, errors, reason) {
    const cases = modules.flatMap((module) =>
      [...module.children.allTests()].map((test) => ({
        id: `${path.relative(process.cwd(), module.moduleId).replaceAll("\\", "/")}::${test.fullName}`,
        status: test.result().state,
        expectedFailure: test.options.fails === true,
        attempts: test.diagnostic()
          ? 1 + test.diagnostic().retryCount + test.diagnostic().repeatCount
          : 0,
      })),
    );
    const ids = occurrenceIds(cases.map((test) => test.id));
    cases.forEach((test, i) => {
      test.id = ids[i];
    });
    const report = {
      version: 1,
      shard: "vitest-1",
      identity: JSON.parse(process.env.OHTIA_QUALITY_IDENTITY ?? "null"),
      preparation:
        errors.length === 0 && modules.length > 0 && modules.every((m) => m.errors().length === 0)
          ? "passed"
          : "failed",
      status:
        reason === "passed" && modules.every((m) => m.state() === "passed") ? "passed" : "failed",
      cases,
    };
    fs.mkdirSync(".reports/quality", { recursive: true });
    fs.writeFileSync(
      ".reports/quality/vitest-accounting.json",
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
