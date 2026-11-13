import { EventEmitter } from "node:events";
import {
  acknowledgeStartupDialog,
  refuseDevelopmentCommand,
} from "../tooling/quality-startup-refusal.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { inspectProviderArtifact, productGraph } from "../tooling/product-graph.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("rejects fake provider source, compiled modules and inlined bytes in final package inspections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-provider-artifact-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "main.mjs"), "export const connections = [];\n");
  expect(() => inspectProviderArtifact(root)).not.toThrow();
  for (const name of [
    "fake-provider.ts",
    "fake-provider.js",
    "fake-provider.d.ts",
    "development-command.ts",
    "development-command.js",
    "development-command.d.ts",
  ]) {
    const file = path.join(root, name);
    fs.writeFileSync(file, "");
    expect(() => inspectProviderArtifact(root)).toThrow();
    fs.unlinkSync(file);
  }
  for (const text of [
    "fake-provider",
    "synthetic-session",
    "__ohtiaCredentialAcceptance",
    "development-command",
  ]) {
    fs.writeFileSync(path.join(root, "main.mjs"), text);
    expect(() => inspectProviderArtifact(root)).toThrow();
  }
});
it("rejects a fake module before production tree shaking and admits it only to a development graph", () => {
  const root = path.resolve(".");
  for (const name of ["fake-provider", "development-command"]) {
    const file = path.join(root, `packages/main/src/${name}.ts`);
    expect(() => productGraph(root).transform("", file)).toThrow("Development module");
    expect(() => productGraph(root, { development: true }).transform("", file)).not.toThrow();
  }
});

it("acknowledges only an expected native startup error and refuses unrelated or unapproved automation", async () => {
  const expected = 'Expected "startup" error';
  const run = vi.fn(async () => ({ stdout: "acknowledged\n" }));
  for (const platform of ["win32", "darwin"]) {
    expect(await acknowledgeStartupDialog(123, expected, platform, run)).toBe(true);
    if (platform === "win32") {
      expect(run.mock.calls.at(-1)?.[2].env).toMatchObject({
        OHTIA_STARTUP_OWNER_PID: "123",
        OHTIA_STARTUP_EXPECTED_TEXT: expected,
      });
      expect(run.mock.calls.at(-1)?.[1]).not.toContain(expected);
    } else expect(run.mock.calls.at(-1)?.[1].slice(-2)).toEqual(["123", expected]);
    expect(run.mock.calls.at(-1)?.[2]).toMatchObject({ timeout: 4000, maxBuffer: 16384 });
  }
  expect(await acknowledgeStartupDialog(0, "error", "win32", run)).toBe(false);
  expect(await acknowledgeStartupDialog(123, "error", "linux", run)).toBe(false);
  expect(
    await acknowledgeStartupDialog(123, "error", "darwin", async () => {
      throw new Error("Automation not approved.");
    }),
  ).toBe(false);
  expect(
    await acknowledgeStartupDialog(123, "error", "win32", async () => ({ stdout: "unrelated" })),
  ).toBe(false);
});
it("retains only controlled native automation failure metadata", async () => {
  const report = vi.fn();
  const error = Object.assign(new Error("Private driver text"), {
    code: 1,
    stderr: "Private native details (-1719)",
  });
  expect(
    await acknowledgeStartupDialog(
      123,
      "expected",
      "darwin",
      async () => {
        throw error;
      },
      report,
    ),
  ).toBe(false);
  expect(report).toHaveBeenCalledWith({
    kind: "automation_failed",
    exit_code: 1,
    native_status: -1719,
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain("Private");
  report.mockClear();
  expect(
    await acknowledgeStartupDialog(
      123,
      "expected",
      "win32",
      async () => {
        throw Object.assign(new Error("No matching dialog"), { code: 2 });
      },
      report,
    ),
  ).toBe(false);
  expect(report).not.toHaveBeenCalled();
});
it("distinguishes an unacknowledged modal from an acknowledged child that remains running", async () => {
  for (const acknowledged of [false, true]) {
    const child = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn() });
    await expect(
      refuseDevelopmentCommand(
        { executable: "/application", app: "/app", args: [] },
        {},
        "/scratch",
        "expected",
        {
          platform: "darwin",
          spawnProcess: () => child,
          acknowledge: async () => acknowledged,
          deadline_ms: 10,
          poll_ms: 1,
        },
      ),
    ).rejects.toThrow("dialog_acknowledged=" + acknowledged);
    expect(child.kill).toHaveBeenCalledOnce();
  }
});
it("verifies the packaged startup refusal after acknowledging its native modal error", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn() });
  const launch = vi.fn(() => child);
  const result = refuseDevelopmentCommand(
    { executable: "/application", app: "/app", args: [] },
    {},
    "/scratch",
    "expected",
    {
      platform: "win32",
      spawnProcess: launch,
      acknowledge: async (pid, text) => {
        expect(pid).toBe(123);
        expect(text).toBe("expected");
        queueMicrotask(() => child.emit("exit", 1));
        return true;
      },
    },
  );
  expect(await result).toEqual({ exit_code: 1, dialog_acknowledged: true });
  expect(launch.mock.calls[0]?.[1]).toEqual(["/app", "--ohtia-dev-command=request"]);
});
it("rejects a successful launch and bounds a stalled packaged refusal", async () => {
  const runtime = { executable: "/application", app: "/app", args: [] };
  const successful = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn() });
  const result = refuseDevelopmentCommand(runtime, {}, "/scratch", "expected", {
    platform: "linux",
    spawnProcess: () => successful,
  });
  successful.emit("exit", 0);
  await expect(result).rejects.toThrow("admission exit code");
  const stalled = Object.assign(new EventEmitter(), { pid: 124, kill: vi.fn() });
  await expect(
    refuseDevelopmentCommand(runtime, {}, "/scratch", "expected", {
      platform: "linux",
      spawnProcess: () => stalled,
      deadline_ms: 10,
    }),
  ).rejects.toThrow("did not exit");
  expect(stalled.kill).toHaveBeenCalledOnce();
  const failed = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const failure = refuseDevelopmentCommand(runtime, {}, "/scratch", "expected", {
    platform: "linux",
    spawnProcess: () => failed,
  });
  failed.emit("error", new Error("Synthetic launch failure."));
  await expect(failure).rejects.toThrow("launch failure");
});
