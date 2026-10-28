import { occurrenceIds, requireGate, sameSet } from "./quality-core.mjs";

export function playwrightCases(report, listed = false) {
  requireGate(
    report &&
      Array.isArray(report.suites) &&
      Array.isArray(report.errors) &&
      report.errors.length === 0,
    "invalid/error Playwright report",
  );
  const cases = [];
  function visit(suites, parents = []) {
    for (const suite of suites) {
      const titles = [...parents, suite.title ?? ""];
      visit(suite.suites ?? [], titles);
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests) {
          requireGate(
            typeof spec.file === "string" && typeof spec.id === "string",
            "Playwright case identity missing",
          );
          const id = `${spec.file.replaceAll("\\", "/")}::${test.projectName}::${[...titles, spec.title].join(" > ")}`;
          if (!listed)
            requireGate(
              test.expectedStatus === "passed" &&
                test.status === "expected" &&
                test.results.length === 1 &&
                test.results[0].status === "passed" &&
                test.results[0].retry === 0 &&
                (test.results[0].errors ?? []).length === 0,
              `${id}: mandatory Playwright result did not pass once`,
            );
          cases.push({
            id,
            file: spec.file,
            status: "passed",
            attempts: listed ? 0 : 1,
            expectedFailure: false,
          });
        }
    }
  }
  visit(report.suites);
  requireGate(cases.length > 0, "empty Playwright inventory");
  const ids = occurrenceIds(cases.map((c) => c.id));
  cases.forEach((item, index) => {
    item.id = ids[index];
  });
  sameSet(
    cases.map((c) => c.id),
    [...new Set(cases.map((c) => c.id))],
    "Playwright cases",
  );
  return cases;
}
