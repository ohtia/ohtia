// Optional local-probe observations; these never admit a deployment or change its limits.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { SigningError, demand, signingLimits } from "./installation-authority.mjs";

const maximumText = signingLimits.request_bytes;
const interval = 25;
// Synchronous reads finish decoding before this bounded metadata buffer is reused.
const kernelBuffer = Buffer.alloc(maximumText + 1);
const eventNames = ["low", "high", "max", "oom", "oom_kill", "oom_group_kill"];
const statNames = ["anon", "file", "shmem", "kernel", "pgscan", "pgsteal"];

function cgroupText(name) {
  const descriptor = fs.openSync(
    "/sys/fs/cgroup/" + name,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const bytes = kernelBuffer;
    let length = 0;
    for (;;) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      length += count;
      demand(length <= maximumText, "size_refused");
      if (count === 0)
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    }
  } finally {
    fs.closeSync(descriptor);
  }
}
function text(read, name) {
  const value = read(name);
  demand(typeof value === "string" && Buffer.byteLength(value) <= maximumText, "size_refused");
  return value.trim();
}
function integer(value) {
  demand(/^(?:0|[1-9][0-9]*)$/.test(value), "authority_unavailable");
  const number = Number(value);
  demand(Number.isSafeInteger(number), "authority_unavailable");
  return number;
}
function counters(value) {
  const result = Object.create(null);
  for (const line of value.split("\n")) {
    const parts = line.trim().split(/\s+/);
    demand(
      parts.length === 2 && /^[a-z][a-z0-9_]*$/.test(parts[0]) && !(parts[0] in result),
      "authority_unavailable",
    );
    result[parts[0]] = integer(parts[1]);
  }
  return result;
}

// The reader seam is a trusted test dependency, never a CLI path or environment override.
export function signingResourceSnapshot(read = cgroupText) {
  try {
    const memoryLimit = integer(text(read, "memory.max"));
    const swapLimit = integer(text(read, "memory.swap.max"));
    const cpu = text(read, "cpu.max").split(/\s+/);
    demand(cpu.length === 2, "authority_unavailable");
    const quota = integer(cpu[0]),
      period = integer(cpu[1]);
    demand(
      memoryLimit === signingLimits.container_memory_bytes &&
        swapLimit === 0 &&
        quota > 0 &&
        period > 0 &&
        BigInt(quota) * 1000n === BigInt(period) * BigInt(signingLimits.container_mvcpu),
      "authority_unavailable",
    );
    const stat = counters(text(read, "memory.stat"));
    const events = counters(text(read, "memory.events"));
    demand(
      ["anon", "file", "shmem", "kernel"].every((name) => name in stat) &&
        "oom" in events &&
        "oom_kill" in events,
      "authority_unavailable",
    );
    return {
      memory_limit_bytes: memoryLimit,
      swap_limit_bytes: swapLimit,
      cpu: { quota_us: quota, period_us: period },
      current_bytes: integer(text(read, "memory.current")),
      lifetime_peak_bytes: integer(text(read, "memory.peak")),
      stat: Object.fromEntries(
        statNames.filter((name) => name in stat).map((name) => [name, stat[name]]),
      ),
      events: Object.fromEntries(
        eventNames.filter((name) => name in events).map((name) => [name, events[name]]),
      ),
    };
  } catch (error) {
    if (error instanceof SigningError) throw error;
    throw new SigningError("authority_unavailable");
  }
}

export async function observeSigningResources(operation, { read = cgroupText } = {}) {
  const started = performance.now();
  const snapshot = () => ({
    ...signingResourceSnapshot(read),
    elapsed_ms: Math.round(performance.now() - started),
  });
  const before = snapshot();
  let last = before,
    samples = 1,
    collectionError = false;
  const maxima = { current: before, shmem: before };
  const capture = () => {
    if (collectionError) return;
    try {
      last = snapshot();
      samples++;
      if (last.current_bytes > maxima.current.current_bytes) maxima.current = last;
      if (last.stat.shmem > maxima.shmem.stat.shmem) maxima.shmem = last;
    } catch {
      collectionError = true;
    }
  };
  const report = () => {
    const names = Object.keys(before.events);
    const stable =
      names.length === Object.keys(last.events).length &&
      names.every((name) => name in last.events && last.events[name] >= before.events[name]);
    return {
      schema_version: 1,
      scope: "cgroup_and_descendants",
      sampling_target_interval_ms: interval,
      sample_count: samples,
      collection_complete: !collectionError && stable,
      before,
      last,
      maxima,
      events_delta: stable
        ? Object.fromEntries(names.map((name) => [name, last.events[name] - before.events[name]]))
        : null,
    };
  };
  const timer = globalThis.setInterval(capture, interval);
  timer.unref();
  try {
    const result = await operation();
    capture();
    const observations = report();
    demand(observations.collection_complete, "authority_unavailable");
    demand(
      observations.events_delta.oom === 0 && observations.events_delta.oom_kill === 0,
      "operation_failed",
    );
    return { result, resource_observations: observations };
  } catch (error) {
    capture();
    const failure = error instanceof Error ? error : new SigningError("operation_failed");
    failure.resource_observations = report();
    throw failure;
  } finally {
    globalThis.clearInterval(timer);
  }
}
