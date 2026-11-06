import { EventEmitter } from "node:events";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installStorageNoticeHold,
  readHeldStorageNotice,
  waitForHeldStorageNotice,
} from "../tooling/storage-opening-notice.mjs";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ["__storageNoticeHeld", "__releaseStorageNotice", "__heldStoragePid"])
    Reflect.deleteProperty(globalThis, name);
});

function fixture() {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { pid: 42 });
  const messages: unknown[] = [];
  child.on("message", (value) => messages.push(value));
  const fork = vi.fn(() => child);
  const utilityProcess = { fork };
  installStorageNoticeHold({ utilityProcess });
  utilityProcess.fork();
  const application = { evaluate: vi.fn(async (callback: () => unknown) => callback()) };
  return { child, messages, fork, utilityProcess, application };
}
const storage = JSON.stringify({ kind: "storage", state: "storage_ready" });

// The default poll cadence can stop at about four seconds for a five-second deadline.
describe("held storage notice deadline", () => {
  it("accepts a notice at 4.5 seconds and keeps it gated until explicit release", async () => {
    const input = fixture();
    const pending = waitForHeldStorageNotice(input.application);
    const completed = vi.fn();
    void pending.then(completed);
    const ready = JSON.stringify({ kind: "ready" });
    input.child.emit("message", ready);
    await vi.advanceTimersByTimeAsync(4500);
    expect(completed).not.toHaveBeenCalled();
    input.child.emit("message", storage);
    await expect(pending).resolves.toBe(true);
    expect(input.messages).toEqual([ready]);
    expect(Reflect.get(globalThis, "__heldStoragePid")).toBe(42);
    expect(input.utilityProcess.fork).toBe(input.fork);
    Reflect.get(globalThis, "__releaseStorageNotice")();
    expect(input.messages).toEqual([ready, storage]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes a held notice immediately when it arrives before the wait begins", async () => {
    const input = fixture();
    input.child.emit("message", storage);
    await expect(waitForHeldStorageNotice(input.application)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("remains pending until the unchanged five seconds when the notice never arrives", async () => {
    const input = fixture();
    const pending = waitForHeldStorageNotice(input.application);
    const completed = vi.fn();
    void pending.then(completed);
    await vi.advanceTimersByTimeAsync(4999);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a notice in the final millisecond without increasing the deadline", async () => {
    const input = fixture();
    const pending = waitForHeldStorageNotice(input.application);
    await vi.advanceTimersByTimeAsync(4999);
    input.child.emit("message", storage);
    await expect(pending).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a timeout false when the notice arrives after the deadline", async () => {
    const input = fixture();
    const pending = waitForHeldStorageNotice(input.application);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(false);
    input.child.emit("message", storage);
    await expect(pending).resolves.toBe(false);
    expect(input.messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an uninstalled hold instead of treating it as a successful opening", async () => {
    const application = { evaluate: async (callback: () => unknown) => callback() };
    await expect(waitForHeldStorageNotice(application)).rejects.toThrow(
      "Storage notice hold is not installed",
    );
  });

  it("retains a failed signal and clears its deadline", async () => {
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    vi.stubGlobal(
      "__storageNoticeHeld",
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    const application = { evaluate: async (callback: () => unknown) => callback() };
    const pending = waitForHeldStorageNotice(application);
    const error = new Error("synthetic hold failure");
    fail(error);
    await expect(pending).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes a stalled native round trip in the same five-second deadline", async () => {
    vi.useFakeTimers();
    const application = { evaluate: () => new Promise<void>(() => {}) };
    const pending = waitForHeldStorageNotice(application);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a synchronous peer failure and clears the deadline", async () => {
    vi.useFakeTimers();
    const error = new Error("synthetic peer failure");
    const application = {
      evaluate: () => {
        throw error;
      },
    };
    await expect(waitForHeldStorageNotice(application)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes both callbacks into a separate main-process context without module closures", async () => {
    vi.useFakeTimers();
    const peer = vm.createContext({ Promise, setTimeout, clearTimeout });
    const install = vm.runInContext(`(${installStorageNoticeHold.toString()})`, peer);
    const read = vm.runInContext(`(${readHeldStorageNotice.toString()})`, peer);
    const child = new EventEmitter();
    const utilityProcess = { fork: () => child };
    install({ utilityProcess });
    utilityProcess.fork();
    const pending = waitForHeldStorageNotice({
      evaluate: async (callback: () => unknown) => {
        expect(callback).toBe(readHeldStorageNotice);
        return read();
      },
    });
    await vi.advanceTimersByTimeAsync(4500);
    child.emit("message", storage);
    await expect(pending).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
