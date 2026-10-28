import { fixturePath, differentTarget } from "./fixtures/platform.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgs = process.argv;
const originalParent = Object.getOwnPropertyDescriptor(process, "parentPort");
const temporary: string[] = [];
const listenerCleanups: (() => void)[] = [];
afterEach(() => {
  listenerCleanups.splice(0).forEach((cleanup) => cleanup());
  process.argv = originalArgs;
  if (originalParent) Object.defineProperty(process, "parentPort", originalParent);
  else Reflect.deleteProperty(process, "parentPort");
  vi.restoreAllMocks();
  vi.doUnmock("node:os");
  vi.doUnmock("node:fs");
  vi.doUnmock("../packages/utility/src/storage.js");
  vi.doUnmock("../packages/utility/src/status-service.js");
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
async function launch(
  options: {
    mode?: string;
    generation?: string;
    locale?: string;
    parent?: boolean;
    admission?: string;
    storage?: string;
    closeFailure?: boolean;
    openFailure?: "recovery_required" | "retry_required" | "storage_failed";
  } = {},
) {
  vi.resetModules();
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const actualOs = await vi.importActual<typeof import("node:os")>("node:os");
  const root = actualFs.realpathSync.native(
    actualFs.mkdtempSync(path.join(actualOs.tmpdir(), "ohtia-utility-entry-")),
  );
  temporary.push(root);
  const home = path.join(root, "independent");
  const configuration = path.join(
    home,
    process.platform === "win32"
      ? "AppData/Roaming"
      : process.platform === "darwin"
        ? "Library/Application Support"
        : ".config",
  );
  const research = path.join(home, "ohtia");
  const scratch = path.join(home, "scratch");
  const stable = path.join(root, "stable");
  for (const directory of [home, configuration, research, scratch, stable])
    actualFs.mkdirSync(directory, { recursive: true });
  const sentinel = path.join(stable, ".ohtia-runtime-sentinel");
  actualFs.writeFileSync(sentinel, "Synthetic stable fixture");
  const sentinel_sha256 = createHash("sha256")
    .update(actualFs.readFileSync(sentinel))
    .digest("hex");
  const profile = {
    schema_version: 1,
    kind: "independent-native-profile",
    inspected_by: "agent:synthetic-test",
    username: "synthetic",
    target: `${process.platform}-${process.arch}`,
    home,
    configuration_root: configuration,
    research_root: research,
    scratch_root: scratch,
    stable_roots: Object.fromEntries(
      ["configuration", "store", "recovery"].map((key) => [key, { root: stable, sentinel_sha256 }]),
    ),
    manual_checks: {
      independent_account_or_vm: true,
      no_emulation: true,
      local_owned_unsynchronized_volumes: true,
      no_credentials: true,
      stable_roots_complete: true,
      native_security_and_display: true,
    },
  };
  let file = path.join(scratch, "runtime-profile.json");
  actualFs.writeFileSync(file, JSON.stringify(profile));
  if (options.admission === "wrong-name") {
    const renamed = path.join(scratch, "other.json");
    actualFs.renameSync(file, renamed);
    file = renamed;
  }
  if (options.admission === "hardlink") actualFs.linkSync(file, path.join(scratch, "alias.json"));
  if (options.admission === "oversized") actualFs.writeFileSync(file, " ".repeat(1024 * 1024));
  if (options.admission === "changed-sentinel") actualFs.writeFileSync(sentinel, "changed");
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  Object.defineProperty(process, "parentPort", {
    configurable: true,
    value: options.parent === false ? undefined : parent,
  });
  process.argv = [
    originalArgs[0]!,
    "synthetic-utility-entry",
    file,
    options.generation ?? "generation-1",
    options.locale ?? "en-US",
    options.mode ?? "create",
  ];
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  const user = actualOs.userInfo();
  vi.doMock("node:os", () => ({
    ...actualOs,
    default: {
      ...actualOs.default,
      userInfo: () => ({ ...user, username: "synthetic", homedir: home }),
    },
  }));
  const stores: Store[] = [];
  class Store {
    open = vi.fn(async () => {
      if (options.openFailure) throw new Error("Synthetic private failure text");
    });
    retry = vi.fn(async () => {});
    restorePending = vi.fn(async () => {});
    savedLocale = vi.fn(async () => ({ choice: "ko-KR", invalid: false }));
    recoveryState = vi.fn(() => options.openFailure ?? "recovery_required");
    close = vi.fn(async () => {
      if (options.closeFailure) throw new Error("Synthetic close failure");
    });
    constructor(readonly options: unknown) {
      stores.push(this);
    }
  }
  const service = {
    receive: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
    drain: vi.fn(async () => {}),
  };
  vi.doMock("../packages/utility/src/storage.js", () => ({ DurableStore: Store }));
  vi.doMock("../packages/utility/src/status-service.js", () => ({
    createStatusService: vi.fn(() => service),
  }));
  const metadata = {
    target:
      options.storage === "wrong-target"
        ? differentTarget()
        : `${process.platform}-${process.arch}`,
    bindingSha256: "a".repeat(64),
    engine: { version: "synthetic-engine" },
    runtime:
      options.storage === "wrong-runtime"
        ? { node: "impossible" }
        : { node: process.versions.node },
  };
  const readFileSync = (input: unknown, ...args: unknown[]) =>
    fixturePath(input).endsWith("/storage.json")
      ? JSON.stringify(options.storage === "invalid" ? null : metadata)
      : actualFs.readFileSync(input as never, ...(args as []));
  vi.doMock("node:fs", () => ({
    ...actualFs,
    default: { ...actualFs.default, readFileSync },
    readFileSync,
  }));
  const stdout = process.stdout.write,
    stderr = process.stderr.write;
  const listeners = new Map(
    ["uncaughtException", "unhandledRejection"].map((name) => [name, process.listeners(name)]),
  );
  try {
    await import("../packages/utility/src/entry.js");
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    const added = [...listeners].flatMap(([name, before]) =>
      process
        .listeners(name)
        .filter((listener) => !before.includes(listener))
        .map((listener) => ({ name, listener })),
    );
    listenerCleanups.push(() => {
      for (const { name, listener } of added) process.removeListener(name, listener);
    });
  }
  for (let i = 0; i < 15; i++) await Promise.resolve();
  return {
    root,
    home,
    file,
    sentinel,
    parent,
    exit,
    stores,
    service,
    generation: options.generation ?? "generation-1",
    changeSentinel: () => actualFs.writeFileSync(sentinel, "changed after admission"),
  };
}
describe("utility process composition with isolated synthetic files", () => {
  it.each([
    { parent: false },
    { generation: "bad generation" },
    { locale: "xx-XX" },
    { mode: "invalid" },
  ])("refuses an invalid parent context %j", async (options) => {
    const h = await launch(options);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.parent.listenerCount("message")).toBe(0);
    expect(h.stores).toHaveLength(0);
  });
  it.each(["wrong-name", "hardlink", "oversized", "changed-sentinel"])(
    "refuses %s admission without opening storage",
    async (admission) => {
      const h = await launch({ admission });
      expect(h.exit).toHaveBeenCalledWith(1);
      expect(h.stores).toHaveLength(0);
    },
  );
  it.each(["invalid", "wrong-target", "wrong-runtime"])(
    "refuses %s storage artifact identity",
    async (storage) => {
      const h = await launch({ storage });
      expect(h.exit).toHaveBeenCalledWith(1);
      expect(h.stores).toHaveLength(0);
    },
  );
  it.each(["create", "open", "retry", "restore", "blocked"])(
    "initializes %s and keeps storage activation separate from service readiness",
    async (mode) => {
      const h = await launch({ mode });
      expect(h.exit).not.toHaveBeenCalled();
      const messages = h.parent.postMessage.mock.calls.map(([value]) => JSON.parse(value));
      expect(messages[0]).toEqual({ kind: "ready", generation: h.generation });
      if (mode === "blocked") expect(h.stores).toHaveLength(0);
      else {
        expect(h.stores).toHaveLength(1);
        expect(h.stores[0].options).toMatchObject({
          root: path.join(h.home, "ohtia"),
          allowCreate: mode === "create",
        });
        expect(messages[1].state).toBe(
          mode === "restore" ? "checkpoint_restored" : "storage_ready",
        );
      }
      h.parent.emit("message", {
        data: JSON.stringify({
          kind: "activate_storage",
          generation: h.generation,
          locale: "ko-KR",
        }),
      });
      expect(h.service.activate).toHaveBeenCalledWith("ko-KR");
      h.parent.emit("message", {
        data: JSON.stringify({ kind: "activate_storage", generation: "other", locale: "ko-KR" }),
      });
      h.parent.emit("message", { data: { arbitrary: true } });
      expect(h.service.receive).toHaveBeenCalledTimes(2);
      h.parent.emit("message", {
        data: JSON.stringify({ kind: "shutdown", generation: h.generation }),
      });
      h.parent.emit("message", {
        data: JSON.stringify({ kind: "shutdown", generation: h.generation }),
      });
      h.parent.emit("message", { data: "post-stop" });
      for (let i = 0; i < 15; i++) await Promise.resolve();
      expect(h.service.dispose).toHaveBeenCalledOnce();
      expect(h.service.drain).toHaveBeenCalledOnce();
      expect(h.exit).toHaveBeenCalledWith(0);
      expect(h.service.receive).toHaveBeenCalledTimes(2);
      if (mode !== "blocked") expect(h.stores[0].close).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ["recovery_required", "recovery_required"],
    ["retry_required", "retry_required"],
    ["storage_failed", "storage_unavailable"],
  ] as const)("publishes content-free diagnostics for %s admission", async (state, errorCode) => {
    const h = await launch({ openFailure: state });
    const messages = h.parent.postMessage.mock.calls.map(([value]) => JSON.parse(value));
    expect(messages[0]).toEqual({ kind: "ready", generation: h.generation });
    expect(messages[1]).toEqual({ kind: "storage", generation: h.generation, state });
    expect(messages[2]).toEqual({
      kind: "diagnostic",
      generation: h.generation,
      event: {
        event_name: "ohtia.storage.open_failed",
        error_code: errorCode,
        timestamp: expect.any(String),
      },
    });
    expect(Number.isFinite(Date.parse(messages[2].event.timestamp))).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("Synthetic private failure text");
    expect(h.service.activate).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
  });
  it("disposes the service on malformed parent traffic", async () => {
    const h = await launch({ mode: "blocked" });
    h.parent.emit("message", { data: "not-json" });
    expect(h.service.dispose).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledWith(1);
  });
  it.each(["close", "sentinel"])("fails shutdown when %s verification fails", async (failure) => {
    const h = await launch({ closeFailure: failure === "close" });
    if (failure === "sentinel") h.changeSentinel();
    h.parent.emit("message", {
      data: JSON.stringify({ kind: "shutdown", generation: h.generation }),
    });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.exit).not.toHaveBeenCalledWith(0);
  });
});
