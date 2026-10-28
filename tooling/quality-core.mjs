import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function requireGate(condition, diagnostic) {
  if (!condition) throw new Error(`Quality gate: ${diagnostic}`);
}
export function readJson(file) {
  try {
    const source = fs.readFileSync(file, "utf8");
    const value = JSON.parse(source);
    const tokens = [...source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)].map((match) => match[0]);
    const stack = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "{") stack.push(new Set());
      else if (token === "[") stack.push(null);
      else if (token === "}" || token === "]") stack.pop();
      else if (token.startsWith('"') && tokens[i + 1] === ":") {
        const key = JSON.parse(token),
          keys = stack.at(-1);
        requireGate(!keys.has(key), `duplicate JSON key: ${key}`);
        keys.add(key);
      }
    }
    return value;
  } catch (error) {
    throw new Error(`Quality gate: missing/invalid JSON report ${file}: ${error.message}`);
  }
}
export function sameSet(actual, expected, context) {
  requireGate(
    Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.every((value) => typeof value === "string" && value.length > 0) &&
      expected.every((value) => typeof value === "string" && value.length > 0) &&
      new Set(actual).size === actual.length &&
      new Set(expected).size === expected.length &&
      actual.length === expected.length &&
      actual.every((value) => expected.includes(value)),
    `${context}: missing, duplicate or unexpected inventory item`,
  );
}
export function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((item) => {
    requireGate(!item.isSymbolicLink(), `symlink in inventory: ${item.name}`);
    const file = path.join(root, item.name);
    return item.isDirectory() ? walk(file) : [file];
  });
}
export function git(root, args) {
  return execFileSync("git", ["-c", "color.ui=never", "-c", "color.diff=never", ...args], {
    cwd: root,
    encoding: "utf8",
  }).trimEnd();
}

/** Deterministic partitions are disjoint: every declared case runs exactly once. */
export function shardCases(cases, count) {
  requireGate(Number.isSafeInteger(count) && count > 0, "invalid shard count");
  sameSet(cases, [...new Set(cases)], "case inventory");
  return Array.from({ length: count }, (_, index) =>
    [...cases].sort().filter((_, i) => i % count === index),
  );
}
export function accountShards(inventory, reports, identity) {
  requireGate(
    Array.isArray(inventory) && inventory.length > 0 && Array.isArray(reports),
    "empty/invalid shard inventory",
  );
  sameSet(
    reports.map((r) => r.shard),
    inventory.map((r) => r.shard),
    "shard union",
  );
  sameSet(
    inventory.flatMap((r) => r.cases),
    [...new Set(inventory.flatMap((r) => r.cases))],
    "case union",
  );
  for (const partition of inventory) {
    const report = reports.find((r) => r.shard === partition.shard);
    requireGate(
      report.version === 1 && report.preparation === "passed" && report.status === "passed",
      `${partition.shard}: incomplete preparation/run`,
    );
    requireGate(
      isDeepStrictEqual(report.identity, identity),
      `${partition.shard}: stale run identity`,
    );
    requireGate(Array.isArray(report.cases), `${partition.shard}: missing cases`);
    sameSet(
      report.cases.map((r) => r.id),
      partition.cases,
      `${partition.shard}: cases`,
    );
    for (const result of report.cases)
      requireGate(
        result.status === "passed" && result.expectedFailure !== true && result.attempts === 1,
        `${result.id}: mandatory case did not pass once`,
      );
  }
  return {
    status: "passed",
    cases: inventory.flatMap((p) => p.cases).length,
    shards: reports.length,
  };
}

export function occurrenceIds(names) {
  const counts = new Map();
  return names.map((name) => {
    const index = counts.get(name) ?? 0;
    counts.set(name, index + 1);
    return `${name}::case-${index}`;
  });
}

export function assertDeclaredCases(registry, runtime, cases) {
  requireGate(
    registry?.version === 1 && ["vitest", "playwright", "python"].includes(runtime),
    "invalid case registry",
  );
  sameSet(cases, registry[runtime], `${runtime}: committed/discovered case inventory`);
}
