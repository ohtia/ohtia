import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeSigningResources,
  signingResourceSnapshot,
} from "../tooling/installation-signing-resources.mjs";
import { SigningError } from "../tooling/installation-authority.mjs";

function fixture() {
  const files: Record<string, string> = {
    "memory.max": "4294967296\n",
    "memory.swap.max": "0\n",
    "cpu.max": "100000 100000\n",
    "memory.current": "1000\n",
    "memory.peak": "1200\n",
    "memory.stat":
      "anon 100\nfile 800\nshmem 600\nkernel 100\npgscan 2\npgsteal 1\nfuture_stat 9\n",
    "memory.events": "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\nfuture_event 7\n",
  };
  return { files, read: (name: string) => files[name] };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("local signing resource observations", () => {
  it("closes its kernel descriptor when metadata exceeds the byte bound", () => {
    vi.spyOn(fs, "openSync").mockReturnValue(123);
    const close = vi.spyOn(fs, "closeSync").mockImplementation(() => {});
    vi.spyOn(fs, "readSync").mockImplementation((_fd: any, buffer: any) => {
      buffer.fill(49);
      return buffer.length;
    });
    expect(() => signingResourceSnapshot()).toThrow("size_refused");
    expect(close).toHaveBeenCalledExactlyOnceWith(123);
  });
  it("preserves native uncertainty when resource collection also fails", async () => {
    vi.useFakeTimers();
    const f = fixture(),
      error = new SigningError("signing_uncertain");
    const failure = await observeSigningResources(async () => {
      f.files["memory.stat"] = "invalid";
      await vi.advanceTimersByTimeAsync(25);
      throw error;
    }, f).catch((e) => e);
    expect(failure).toBe(error);
    expect(failure.resource_observations.collection_complete).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves overlapping file and tmpfs counters without inventing working-set headroom", () => {
    const f = fixture(),
      result = signingResourceSnapshot(f.read);
    expect(result.stat).toEqual({
      anon: 100,
      file: 800,
      shmem: 600,
      kernel: 100,
      pgscan: 2,
      pgsteal: 1,
    });
    expect(result).toMatchObject({
      current_bytes: 1000,
      lifetime_peak_bytes: 1200,
      memory_limit_bytes: 4294967296,
      swap_limit_bytes: 0,
    });
    expect(result.events).not.toHaveProperty("future_event");
  });
  it("reports a cgroup lifetime peak at the ceiling without declaring admission or failure", () => {
    const f = fixture();
    f.files["memory.peak"] = "4294967296";
    expect(signingResourceSnapshot(f.read).lifetime_peak_bytes).toBe(4294967296);
  });
  it("rejects unlimited memory before running the cryptographic operation", async () => {
    const f = fixture();
    f.files["memory.max"] = "max";
    const operation = vi.fn();
    await expect(observeSigningResources(operation, f)).rejects.toThrow("authority_unavailable");
    expect(operation).not.toHaveBeenCalled();
  });
  it("rejects a different allocation, swap allowance or CPU quota", () => {
    for (const [name, value] of [
      ["memory.max", "8589934592"],
      ["memory.swap.max", "1"],
      ["cpu.max", "max 100000"],
      ["cpu.max", "200000 100000"],
      ["cpu.max", "0 100000"],
    ]) {
      const f = fixture();
      f.files[name] = value;
      expect(() => signingResourceSnapshot(f.read)).toThrow("authority_unavailable");
    }
  });
  it("accepts an equivalent finite CPU period and quota", () => {
    const f = fixture();
    f.files["cpu.max"] = "50000 50000";
    expect(signingResourceSnapshot(f.read).cpu).toEqual({ quota_us: 50000, period_us: 50000 });
  });
  it("rejects duplicate counters, unsafe integers and absent required counters", () => {
    for (const [name, value] of [
      ["memory.stat", "anon 1\nanon 2"],
      ["memory.current", "9007199254740992"],
      ["memory.events", "oom 0"],
      ["memory.peak", "-1"],
      ["memory.peak", "1.5"],
    ]) {
      const f = fixture();
      f.files[name] = value;
      expect(() => signingResourceSnapshot(f.read)).toThrow("authority_unavailable");
    }
  });
  it("bounds metadata reads and normalizes inaccessible cgroup files", () => {
    const f = fixture();
    f.files["memory.stat"] = "x".repeat(65537);
    expect(() => signingResourceSnapshot(f.read)).toThrow("size_refused");
    expect(() =>
      signingResourceSnapshot(() => {
        throw new Error("private local path");
      }),
    ).toThrow("authority_unavailable");
  });
  it("retains the actual peak snapshots and counter deltas across an operation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const result = await observeSigningResources(async () => {
      f.files["memory.current"] = "4000";
      f.files["memory.stat"] = f.files["memory.stat"].replace("shmem 600", "shmem 900");
      await vi.advanceTimersByTimeAsync(25);
      f.files["memory.current"] = "2000";
      return "completed";
    }, f);
    expect(result.result).toBe("completed");
    expect(result.resource_observations).toMatchObject({
      collection_complete: true,
      sample_count: 3,
      scope: "cgroup_and_descendants",
      events_delta: { oom: 0, oom_kill: 0 },
      maxima: { current: { current_bytes: 4000 }, shmem: { stat: { shmem: 900 } } },
      last: { current_bytes: 2000 },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves the original native failure and includes observations", async () => {
    const f = fixture(),
      error = new SigningError("signing_uncertain");
    const failure = await observeSigningResources(async () => {
      throw error;
    }, f).catch((e) => e);
    expect(failure).toBe(error);
    expect(failure.resource_observations.collection_complete).toBe(true);
  });
  it("fails incomplete sampling without an uncaught timer exception", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const failure = await observeSigningResources(async () => {
      f.files["memory.stat"] = "invalid";
      await vi.advanceTimersByTimeAsync(25);
      return "native-completed";
    }, f).catch((e) => e);
    expect(failure.code).toBe("authority_unavailable");
    expect(failure.resource_observations.collection_complete).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses reset counters and new OOM events while retaining their evidence", async () => {
    for (const reset of [false, true]) {
      const f = fixture();
      f.files["memory.events"] = f.files["memory.events"].replace("max 0", "max 2");
      const failure = await observeSigningResources(async () => {
        f.files["memory.events"] = f.files["memory.events"].replace(
          reset ? "max 2" : "oom 0",
          reset ? "max 1" : "oom 1",
        );
      }, f).catch((e) => e);
      expect(failure.code).toBe(reset ? "authority_unavailable" : "operation_failed");
      expect(failure.resource_observations.collection_complete).toBe(!reset);
      if (!reset) expect(failure.resource_observations.events_delta.oom).toBe(1);
    }
  });
});
