import { test, expect } from "@playwright/test";
import { accountShards, shardCases } from "../../tooling/quality-core.mjs";

test("a zero-exit partition with a preparation failure cannot pass admission", () => {
  const identity = { run: "synthetic-behavior-case" };
  const inventory = [{ shard: "1", cases: ["required"] }];
  const report = {
    version: 1,
    shard: "1",
    identity,
    status: "passed",
    preparation: "failed",
    cases: [{ id: "required", status: "passed", attempts: 1 }],
  };
  expect(() => accountShards(inventory, [report], identity)).toThrow(/preparation/);
});

test("out-of-order shards preserve the exact declared union", () => {
  const identity = { run: "synthetic-behavior-case" };
  const inventory = shardCases(["a", "b", "c", "d", "e"], 3).map((cases, index) => ({
    shard: String(index),
    cases,
  }));
  const reports = inventory
    .map((shard) => ({
      version: 1,
      shard: shard.shard,
      identity,
      status: "passed",
      preparation: "passed",
      cases: shard.cases.map((id) => ({ id, status: "passed", attempts: 1 })),
    }))
    .reverse();
  expect(accountShards(inventory, reports, identity)).toEqual({
    status: "passed",
    cases: 5,
    shards: 3,
  });
  reports[0].cases.pop();
  expect(() => accountShards(inventory, reports, identity)).toThrow(/cases/);
});
