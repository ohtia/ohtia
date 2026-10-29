import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diagnosticCatalog,
  diagnosticLimits,
  decodeDiagnosticEvent,
  decodeDiagnosticRecord,
  decodeDiagnosticLine,
  decodeChildDiagnostic,
  diagnosticToOpenTelemetry,
  makeDiagnosticRecord,
  suppressDiagnosticCapture,
} from "../packages/contracts/dist/index.js";
import {
  DiagnosticWriter,
  ServiceSupervisor,
  stopBrokerServices,
  recoverDiagnosticsAfterShutdown,
} from "../packages/main/dist/index.js";

const marker = "PRIVATE_研究_token_query_filename_SQL_value";
const time = "2000-01-01T00:00:00.001Z";
const started = { event_name: "ohtia.application.started" };
const roots: string[] = [];
const writers: DiagnosticWriter[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const writer of writers.splice(0)) await writer.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(options: Partial<ConstructorParameters<typeof DiagnosticWriter>[0]> = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "ohtia diagnostics 研究 ")),
  );
  roots.push(root);
  const writer = new DiagnosticWriter({
    root,
    version: "0.0.0-test",
    now: () => time,
    assertAdmission: () => {},
    ...options,
  });
  writers.push(writer);
  return {
    writer,
    root,
    logs: path.join(root, "logs"),
    active: path.join(root, "logs/ohtia.jsonl"),
  };
}
function line(event = started) {
  return JSON.stringify(makeDiagnosticRecord(event, "0.0.0-test", time)) + "\n";
}
function fillExact(file: string, target: number) {
  const a = line();
  const b = line({ event_name: "ohtia.application.stopped" });
  // These catalog events differ by one byte. Find an exact complete-record boundary.
  for (let n = 0; n <= target / a.length; n++) {
    const remaining = target - n * a.length;
    if (remaining % b.length === 0) {
      fs.writeFileSync(file, a.repeat(n) + b.repeat(remaining / b.length));
      return;
    }
  }
  throw new Error("No exact boundary fixture.");
}
describe("ohtia-log-v1 closed catalog and mapping", () => {
  it("accepts reordered and escaped compact records, rejects escaped duplicate keys and dispatches future versions before v1 fields", () => {
    const record = makeDiagnosticRecord(started, "1.2.3", time)!;
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(record).reverse()));
    expect(decodeDiagnosticLine(Buffer.from(reordered))).toEqual({ ok: true, value: record });
    const escaped = JSON.stringify(record)
      .replace('"service.name"', '"service.\\u006eame"')
      .replace('"ohtia"', '"\\u006fhtia"');
    expect(decodeDiagnosticLine(Buffer.from(escaped))).toEqual({ ok: true, value: record });
    const duplicate = JSON.stringify(record).replace(
      '"schema_version":1',
      '"schema_version":1,"schema_\\u0076ersion":1',
    );
    expect(decodeDiagnosticLine(Buffer.from(duplicate)).ok).toBe(false);
    expect(decodeDiagnosticRecord({ schema_version: 2, future: { message: marker } })).toEqual({
      ok: false,
      code: "unsupported_schema",
    });
  });

  it("round trips every catalog event, exact severity/outcome pairs and optional actual time", () => {
    for (const [event_name, spec] of Object.entries(diagnosticCatalog)) {
      const event = { event_name, ...(spec.errors.length ? { error_code: spec.errors[0] } : {}) };
      const record = makeDiagnosticRecord(event, "1.2.3-native", time)!;
      expect(decodeDiagnosticRecord(record)).toEqual({ ok: true, value: record });
      expect(decodeDiagnosticLine(Buffer.from(JSON.stringify(record)))).toEqual({
        ok: true,
        value: record,
      });
      const mapped = diagnosticToOpenTelemetry(record);
      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.value).not.toHaveProperty("Timestamp");
        expect(mapped.value).not.toHaveProperty("Body");
        expect(mapped.value).not.toHaveProperty("TraceId");
        expect(mapped.value.ObservedTimestamp).toBe(BigInt(Date.parse(time)) * 1000000n);
        expect(mapped.value.Attributes["ohtia.log.schema_version"]).toBe(1);
      }
    }
    const record = makeDiagnosticRecord(
      { ...started, timestamp: "1999-12-31T23:59:59.999Z", duration_ms: 0 },
      "1.2.3",
      time,
      "018f35ec-1234-4abc-8abc-123456789abc",
    )!;
    expect(diagnosticToOpenTelemetry(record)).toMatchObject({
      ok: true,
      value: { Timestamp: 946684799999000000n },
    });
  });
  it("rejects private markers in every undeclared field, identity, exception and nested bag without evaluating getters", () => {
    const record = makeDiagnosticRecord(started, "1.2.3", time)!;
    for (const field of [
      "message",
      "body",
      "exception",
      "stack",
      "metadata",
      "trace_id",
      "filename",
      "query",
      "prompt",
      "response",
      "sql",
      "token",
      "ohtia.task.id",
      "ohtia.attempt.id",
    ]) {
      expect(decodeDiagnosticEvent({ ...started, [field]: marker })).toBeUndefined();
      expect(decodeDiagnosticRecord({ ...record, [field]: marker }).ok).toBe(false);
      expect(
        decodeDiagnosticRecord({ ...record, attributes: { ...record.attributes, [field]: marker } })
          .ok,
      ).toBe(false);
    }
    const getter = vi.fn(() => marker);
    expect(
      decodeDiagnosticEvent(
        Object.defineProperty({ ...started }, "timestamp", { get: getter, enumerable: true }),
      ),
    ).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    for (const value of [
      Object.create(started),
      { ...started, [Symbol("private")]: marker },
      new Error(marker),
      { event_name: marker },
      { ...started, error_code: marker },
      { ...started, timestamp: marker },
      { ...started, duration_ms: marker },
    ])
      expect(decodeDiagnosticEvent(value)).toBeUndefined();
    expect(JSON.stringify(decodeDiagnosticRecord({ ...record, message: marker }))).not.toContain(
      marker,
    );
  });
  it("rejects cross-field, time, number, unknown-version, duplicate-key, UTF-8 and oversized inputs", () => {
    const record = makeDiagnosticRecord(started, "1.2.3", time)!;
    for (const modified of [
      { ...record, severity_number: 17 },
      { ...record, severity_text: "WARN" },
      { ...record, resource: { ...record.resource, "service.name": marker } },
      { ...record, attributes: { ...record.attributes, "ohtia.outcome": "failure" } },
      { ...record, attributes: { ...record.attributes, "ohtia.operation": "storage.open" } },
    ])
      expect(decodeDiagnosticRecord(modified).ok).toBe(false);
    for (const timestamp of [
      "2000-02-30T00:00:00.000Z",
      "2000-01-01T00:00:00Z",
      time.replace("Z", "+00:00"),
      "2000-01-01T00:00:60.000Z",
    ])
      expect(decodeDiagnosticEvent({ ...started, timestamp })).toBeUndefined();
    for (const duration_ms of [-1, -0, NaN, Infinity])
      expect(decodeDiagnosticEvent({ ...started, duration_ms })).toBeUndefined();
    expect(decodeDiagnosticRecord({ ...record, schema_version: 2 })).toEqual({
      ok: false,
      code: "unsupported_schema",
    });
    const encoded = JSON.stringify(record);
    for (const text of [
      "\ufeff" + encoded,
      encoded.replace('"schema_version":1', '"schema_version":1,"schema_version":1'),
      "\n",
      encoded + "\n",
      encoded.replace('"schema_version":1', '"schema_version":NaN'),
    ])
      expect(decodeDiagnosticLine(Buffer.from(text)).ok).toBe(false);
    for (const bytes of [
      Buffer.from([0xc0, 0xaf]),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from([0xf4, 0x90, 0x80, 0x80]),
    ])
      expect(decodeDiagnosticLine(bytes).ok).toBe(false);
    expect(decodeDiagnosticLine(Buffer.alloc(diagnosticLimits.recordBytes + 1))).toEqual({
      ok: false,
      code: "oversized_record",
    });
  });
  it("rejects claimed child identity, stale generation and broker-only events", () => {
    const event = { event_name: "ohtia.storage.open_failed", error_code: "storage_unavailable" };
    const wire = { kind: "diagnostic", generation: "current", event };
    expect(decodeChildDiagnostic(JSON.stringify(wire), "current")).toEqual(event);
    for (const value of [
      { ...wire, generation: "old" },
      { ...wire, resource: marker },
      { ...wire, event: { ...event, observed_timestamp: marker } },
      { ...wire, event: started },
      { ...wire, event: { ...event, correlation: marker } },
    ])
      expect(decodeChildDiagnostic(JSON.stringify(value), "current")).toBeUndefined();
  });
  it("drops automatic output without inspecting thrown/SDK objects and completes write callbacks", async () => {
    let discard: (...args: readonly unknown[]) => boolean = () => false;
    suppressDiagnosticCapture((sink) => {
      discard = sink;
    });
    const trap = vi.fn(() => {
      throw new Error(marker);
    });
    const object = { toString: trap, toJSON: trap };
    const complete = vi.fn();
    expect(discard(object, complete)).toBe(true);
    await Promise.resolve();
    expect(complete).toHaveBeenCalledOnce();
    expect(trap).not.toHaveBeenCalled();
  });
});
describe("broker-owned bounded diagnostic files", () => {
  it("keeps broker timers responsive during delayed Windows ACL failure, latches failure and cancels on close", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    const previousSystem = process.env.SystemRoot;
    const { writer, root } = fixture();
    vi.useFakeTimers();
    const children: EventEmitter[] = [];
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      const child = new EventEmitter();
      Object.assign(child, {
        kill: vi.fn(() => {
          child.emit("close", null);
          return true;
        }),
      });
      children.push(child);
      setTimeout(() => {
        child.emit("close", 1);
      }, 6000);
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    try {
      Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
      process.env.SystemRoot = "/synthetic-system";
      const append = writer.append(started);
      await vi.advanceTimersByTimeAsync(0);
      expect(spawn).toHaveBeenCalledOnce();
      const [executable, args, options] = spawn.mock.calls[0];
      expect(executable).toBe(
        path.join("/synthetic-system", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      );
      expect(args).toEqual(["-NoProfile", "-NonInteractive", "-Command", expect.any(String)]);
      expect(args?.join(" ")).not.toContain(root);
      expect(options).toMatchObject({
        env: { OHTIA_DIAGNOSTIC_ACL_PATH: path.join(root, "logs") },
        timeout: 15000,
        windowsHide: true,
        stdio: "ignore",
      });
      expect(writer.reservedPermissionProcesses).toBe(2);
      children[0].emit("error", new Error(marker));
      children[0].emit("error", new Error(marker));
      let responsive = false;
      setTimeout(() => {
        responsive = true;
      }, 1);
      await vi.advanceTimersByTimeAsync(10);
      expect(responsive).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(await append).toMatchObject({ ok: false, status: "unavailable" });
      expect(await writer.append(started)).toMatchObject({ ok: false, status: "unavailable" });
      expect(spawn).toHaveBeenCalledOnce();
      const retry = writer.initializeLogs();
      await vi.advanceTimersByTimeAsync(0);
      expect(spawn).toHaveBeenCalledTimes(2);
      await writer.close();
      expect(await retry).toMatchObject({ ok: false });
      expect(writer.reservedPermissionProcesses).toBe(0);
      const denied = fixture({ canStartPermissionHelper: () => false });
      expect(await denied.writer.append(started)).toMatchObject({
        ok: false,
        status: "unavailable",
      });
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(process, "platform", descriptor);
      if (previousSystem === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = previousSystem;
      vi.useRealTimers();
    }
  });
  it("writes actual supplied artifact identity, LF-only complete lines, default INFO, bounded safe read and confirmation", async () => {
    const { writer, root, active, logs } = fixture();
    expect(await writer.append(started)).toEqual({ ok: true, status: "ready" });
    expect(await writer.append({ event_name: "ohtia.service.cancel_requested" })).toEqual({
      ok: true,
      status: "ready",
    });
    const bytes = fs.readFileSync(active);
    expect(bytes.toString()).toBe(line());
    expect(bytes.at(-1)).toBe(10);
    expect(bytes[0]).toBe(123);
    const page = await writer.read(0);
    expect(page.records).toHaveLength(1);
    expect(page.records[0].resource["service.version"]).toBe("0.0.0-test");
    expect(await writer.deleteLogs(false)).toMatchObject({
      ok: false,
      status: "confirmation_required",
    });
    expect(fs.readFileSync(active)).toEqual(bytes);
    if (process.platform !== "win32") {
      expect(fs.statSync(logs).mode & 0o777).toBe(0o700);
      expect(fs.statSync(active).mode & 0o777).toBe(0o600);
    }
    fs.writeFileSync(path.join(root, "ohtia.db3"), "synthetic durable research");
    expect(await writer.deleteLogs(true)).toMatchObject({ ok: true, deleted: 1 });
    expect(fs.readFileSync(active).length).toBe(0);
    expect(fs.readFileSync(path.join(root, "ohtia.db3"), "utf8")).toBe(
      "synthetic durable research",
    );
  });
  it("rotates at the exact byte limit, retains no sixth file, and bounds UTF-8 rejected input", async () => {
    const { writer, active, logs } = fixture();
    await writer.initializeLogs();
    const recordBytes = Buffer.byteLength(line());
    fillExact(active, diagnosticLimits.fileBytes - recordBytes);
    expect(await writer.append(started)).toMatchObject({ ok: true });
    expect(fs.statSync(active).size).toBe(diagnosticLimits.fileBytes);
    for (let round = 0; round < 6; round++) {
      expect(await writer.append(started)).toMatchObject({ ok: true });
      expect(fs.statSync(path.join(logs, "ohtia.1.jsonl")).size).toBe(diagnosticLimits.fileBytes);
      fillExact(active, diagnosticLimits.fileBytes);
    }
    expect(fs.readdirSync(logs).sort()).toEqual([
      "ohtia.1.jsonl",
      "ohtia.2.jsonl",
      "ohtia.3.jsonl",
      "ohtia.4.jsonl",
      "ohtia.jsonl",
    ]);
    expect(
      fs.readdirSync(logs).reduce((sum, name) => sum + fs.statSync(path.join(logs, name)).size, 0),
    ).toBe(25 * 1024 * 1024);
    expect(await writer.append({ ...started, message: marker.repeat(10000) })).toMatchObject({
      ok: false,
    });
    for (const name of fs.readdirSync(logs))
      expect(fs.readFileSync(path.join(logs, name), "utf8")).not.toContain(marker);
  });
  it("repairs interrupted UTF-8/final lines, removes extra managed archives and bounds startup files", async () => {
    const { writer, active, logs } = fixture();
    fs.mkdirSync(logs);
    fs.writeFileSync(active, Buffer.concat([Buffer.from(line()), Buffer.from([0xe7, 0xa0])]));
    fs.writeFileSync(path.join(logs, "ohtia.8.jsonl"), marker);
    fs.writeFileSync(path.join(logs, "unrelated.txt"), "retain");
    fs.writeFileSync(
      path.join(logs, "ohtia.4.jsonl"),
      Buffer.alloc(diagnosticLimits.fileBytes + 100, 65),
    );
    expect(await writer.append(started)).toMatchObject({ ok: true });
    expect(fs.readFileSync(active, "utf8")).toBe(line() + line());
    expect(fs.existsSync(path.join(logs, "ohtia.8.jsonl"))).toBe(false);
    expect(fs.readFileSync(path.join(logs, "unrelated.txt"), "utf8")).toBe("retain");
    expect(fs.statSync(path.join(logs, "ohtia.4.jsonl")).size).toBe(0);
  });
  it("serializes append/delete, reports bounded queue saturation and allows a later append", async () => {
    const { writer, active } = fixture();
    const promises = [writer.append(started), writer.deleteLogs(true), writer.append(started)];
    expect((await Promise.all(promises)).every((r) => r.ok)).toBe(true);
    expect(fs.readFileSync(active, "utf8")).toBe(line());
    const saturated = await Promise.all(
      Array.from({ length: diagnosticLimits.pending + 1 }, () => writer.append(started)),
    );
    expect(saturated.filter((r) => r.status === "busy")).toHaveLength(1);
    expect(await writer.append(started)).toMatchObject({ ok: true });
    const duplicate = new DiagnosticWriter({
      root: path.dirname(path.dirname(active)),
      version: "1.0.0",
      assertAdmission: () => {},
    });
    writers.push(duplicate);
    expect(await duplicate.append(started)).toMatchObject({ ok: false, status: "unavailable" });
  });
  it("repairs a partial append after failure without dumping error content", async () => {
    const { writer, active } = fixture();
    await writer.initializeLogs();
    const write = fs.writeSync;
    vi.spyOn(fs, "writeSync").mockImplementationOnce((fd, bytes, offset, length) => {
      write(fd, bytes as Uint8Array, offset as number, 10);
      throw new Error(marker);
    });
    expect(await writer.append(started)).toEqual({ ok: false, status: "unavailable" });
    vi.restoreAllMocks();
    expect(await writer.append(started)).toMatchObject({ ok: true });
    expect(fs.readFileSync(active, "utf8")).toBe(line());
  });
  it("recovers a failed rotation and reports partial deletion accurately", async () => {
    const { writer, active, logs } = fixture();
    await writer.initializeLogs();
    fillExact(active, diagnosticLimits.fileBytes);
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error(marker);
    });
    expect(await writer.append(started)).toMatchObject({ ok: false, status: "unavailable" });
    vi.restoreAllMocks();
    expect(await writer.append(started)).toMatchObject({ ok: true });
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (file === path.join(logs, "ohtia.1.jsonl")) throw new Error(marker);
      unlink(file);
    });
    expect(await writer.deleteLogs(true)).toMatchObject({
      ok: false,
      status: "unavailable",
      deleted: 1,
    });
    vi.restoreAllMocks();
    expect(await writer.append(started)).toMatchObject({ ok: true });
  });
  it("refuses aliases, hardlinks and denied admission without touching durable/stable files or a fallback root", async () => {
    const { writer, root, logs } = fixture();
    const durable = path.join(root, "ohtia.db3");
    fs.writeFileSync(durable, marker);
    fs.mkdirSync(logs);
    fs.linkSync(durable, path.join(logs, "ohtia.jsonl"));
    expect(await writer.append(started)).toMatchObject({ ok: false, status: "unavailable" });
    expect(fs.readFileSync(durable, "utf8")).toBe(marker);
    const denied = fixture({
      assertAdmission: () => {
        throw new Error(marker);
      },
    });
    expect(await denied.writer.append(started)).toMatchObject({ ok: false, status: "unavailable" });
    expect(fs.existsSync(denied.logs)).toBe(false);
    const alias = fixture();
    fs.symlinkSync(denied.root, alias.logs, process.platform === "win32" ? "junction" : "dir");
    expect(await alias.writer.append(started)).toMatchObject({ ok: false, status: "unavailable" });
    expect(fs.existsSync(denied.active)).toBe(false);
  });
  it("returns bounded decoded pages and counters rather than corrupt/unknown raw records", async () => {
    const { writer, active } = fixture();
    await writer.initializeLogs();
    const future =
      JSON.stringify({ ...makeDiagnosticRecord(started, "1.2.3", time), schema_version: 2 }) + "\n";
    fs.writeFileSync(
      active,
      line().repeat(65) + JSON.stringify({ message: marker }) + "\n" + future,
    );
    const page = await writer.read(0);
    expect(page.records).toHaveLength(64);
    expect(page.nextOffset).toBeDefined();
    const rest = await writer.read(0, page.nextOffset);
    expect(rest.records).toHaveLength(1);
    expect(rest.invalid).toBe(1);
    expect(rest.unsupported).toBe(1);
    expect(JSON.stringify(rest)).not.toContain(marker);
    expect(await writer.read(0, 1)).toMatchObject({ ok: false });
    expect(await writer.read(5)).toMatchObject({ ok: false });
  });
  it("routes only validated current child diagnostics without releasing or faulting application work", () => {
    let receive: (input: unknown) => void = () => {};
    const diagnostic = vi.fn();
    const kill = vi.fn();
    const supervisor = new ServiceSupervisor(
      {
        send: () => {},
        kill,
        messages: (listener) => {
          receive = listener;
        },
        exited: () => {},
      },
      "current",
      () => {},
      undefined,
      false,
      diagnostic,
    );
    receive(JSON.stringify({ kind: "ready", generation: "current" }));
    const event = { event_name: "ohtia.storage.opened" };
    receive(JSON.stringify({ kind: "diagnostic", generation: "current", event }));
    expect(diagnostic).toHaveBeenLastCalledWith(event);
    receive(JSON.stringify({ kind: "diagnostic", generation: "old", event }));
    expect(diagnostic).toHaveBeenLastCalledWith(undefined);
    expect(supervisor.available).toBe(true);
    expect(kill).not.toHaveBeenCalled();
    vi.useFakeTimers();
    void supervisor.stop();
    vi.runAllTimers();
    vi.useRealTimers();
  });
});

describe("one broker shutdown deadline", () => {
  it("cancels diagnostics during service drain and does not add another grace budget", async () => {
    vi.useFakeTimers();
    let closed = false;
    let closePromise: Promise<void> | undefined;
    const close = vi.fn(() => {
      closePromise ??= new Promise<void>((resolve) =>
        setTimeout(() => {
          closed = true;
          resolve();
        }, 2000),
      );
      return closePromise;
    });
    const stopped = stopBrokerServices(
      { stop: () => new Promise((resolve) => setTimeout(() => resolve(true), 9000)) },
      { append: () => Promise.resolve(), close },
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await stopped).toBe(true);
    expect(closed).toBe(true);
    vi.useRealTimers();
  });
  it("reports uncertain at the original total deadline when helper cessation cannot be proved", async () => {
    vi.useFakeTimers();
    let resolveClose: (() => void) | undefined;
    const closing = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const stopped = stopBrokerServices(
      { stop: () => new Promise((resolve) => setTimeout(() => resolve(true), 9000)) },
      { append: () => Promise.resolve(), close: () => closing },
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(await stopped).toBe(false);
    resolveClose?.();
    await Promise.resolve();
    vi.useRealTimers();
  });
});

describe("diagnostics after uncertain shutdown", () => {
  it("restores append after a failed service drain once the old writer is closed", async () => {
    const { writer, root } = fixture();
    await writer.append(started);
    vi.useFakeTimers();
    const stopping = stopBrokerServices(
      { stop: () => new Promise((resolve) => setTimeout(() => resolve(false), 6000)) },
      writer,
    );
    await vi.advanceTimersByTimeAsync(6000);
    expect(await stopping).toBe(false);
    let replacement: DiagnosticWriter | undefined;
    await recoverDiagnosticsAfterShutdown(
      writer,
      () => true,
      () => {
        replacement = new DiagnosticWriter({
          root,
          version: "0.0.0-test",
          assertAdmission: () => {},
        });
        writers.push(replacement);
      },
    );
    expect(await replacement!.append(started)).toMatchObject({ ok: true });
    vi.useRealTimers();
  });
  it("does not reopen until cessation or after the caller withdraws admission", async () => {
    let done: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      done = resolve;
    });
    let admitted = true;
    const reopen = vi.fn();
    const recovery = recoverDiagnosticsAfterShutdown(
      { close: () => closed },
      () => admitted,
      reopen,
    );
    await Promise.resolve();
    expect(reopen).not.toHaveBeenCalled();
    admitted = false;
    done?.();
    await recovery;
    expect(reopen).not.toHaveBeenCalled();
  });
  it("identifies normal stop notifications without classifying them as faults", async () => {
    let exit: () => void = () => {};
    const changed = vi.fn();
    const supervisor = new ServiceSupervisor(
      {
        send: () => {},
        kill: () => {},
        messages: () => {},
        exited: (listener) => {
          exit = listener;
        },
      },
      "generation",
      changed,
    );
    const stopped = supervisor.stop();
    exit();
    expect(await stopped).toBe(true);
    expect(
      changed.mock.calls
        .filter((call) => call[0] === "unavailable")
        .every((call) => call[1] === true),
    ).toBe(true);
  });
});
