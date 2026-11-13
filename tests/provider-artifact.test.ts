import { EventEmitter } from "node:events";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  acknowledgeStartupDialog,
  refuseDevelopmentCommand,
  sampleStartupProcess,
  observeMacAccessibility,
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
  const run = vi.fn(async () => ({ stdout: "window_lookup\naction_invoke\nacknowledged\n" }));
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
it("retains bounded native tree counters without exposing accessibility text", async () => {
  const report = vi.fn();
  const tree = {
    nodes: 8,
    static_text: 2,
    headings: 1,
    role_errors: 0,
    value_errors: 1,
    values_read: 2,
    other_exact: 1,
    containing_expected: 1,
    role_error_status: 0,
    value_error_status: -1700,
    default_buttons: 1,
  };
  expect(
    await acknowledgeStartupDialog(
      123,
      "expected",
      "darwin",
      async () => ({
        stdout: "Private text\ntree:8,2,1,0,1,2,1,1,0,-1700,1\nexpected_text_absent\n",
      }),
      report,
    ),
  ).toBe(false);
  expect(report).toHaveBeenLastCalledWith({
    kind: "automation_pending",
    stage: "expected_text_absent",
    native_status: null,
    tree,
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain("Private");
  for (const malformed of [
    "tree:9999,2,1,0,1,2,1,1,0,-1700,1",
    "tree:1,2,1,0,0,1,1,1,0,0,1",
    "tree:8,2,1,0,0,1,2,1,0,0,1",
    "tree:Private text",
    "tree:8,2,1,0,1,2,1,1,0,-1700,1,9",
    "tree:8,2,1,0,1,2,1,1,0,-1000000,1",
    "tree:8,2,1,0,0,2,1,1,0,-1700,1",
  ]) {
    report.mockClear();
    expect(
      await acknowledgeStartupDialog(
        123,
        "expected",
        "darwin",
        async () => ({ stdout: malformed + "\nexpected_text_absent\n" }),
        report,
      ),
    ).toBe(false);
    expect(report).toHaveBeenLastCalledWith({
      kind: "automation_pending",
      stage: "expected_text_absent",
      native_status: null,
    });
  }
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
    stage: null,
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain("Private");
  report.mockClear();
  expect(
    await acknowledgeStartupDialog(
      123,
      "expected",
      "win32",
      async () => {
        throw Object.assign(new Error("No matching dialog"), {
          code: 2,
          stdout: "window_lookup\nwindow_absent\n",
        });
      },
      report,
    ),
  ).toBe(false);
  expect(report).toHaveBeenCalledWith({
    kind: "automation_pending",
    stage: "window_absent",
    native_status: null,
  });
});
it("reports allowlisted dialog stages without retaining native UI or driver text", async () => {
  const report = vi.fn();
  for (const [stdout, observation] of [
    [
      "element_unavailable\n",
      { kind: "automation_pending", stage: "element_unavailable", native_status: null },
    ],
    [
      "ui_scripting_unavailable\n",
      { kind: "automation_pending", stage: "ui_scripting_unavailable", native_status: null },
    ],
    ["owner_absent\n", { kind: "automation_pending", stage: "owner_absent", native_status: null }],
    [
      "activation_pending\n",
      { kind: "automation_pending", stage: "activation_pending", native_status: null },
    ],
    [
      "window_absent_frontmost\n",
      { kind: "automation_pending", stage: "window_absent_frontmost", native_status: null },
    ],
    [
      "expected_text_name_only\n",
      { kind: "automation_pending", stage: "expected_text_name_only", native_status: null },
    ],
    [
      "action_failed:-25211\n",
      { kind: "automation_pending", stage: "action_failed", native_status: -25211 },
    ],
    ["Private UI value\n", { kind: "automation_protocol_error" }],
  ] as const) {
    report.mockClear();
    expect(
      await acknowledgeStartupDialog(123, "expected", "darwin", async () => ({ stdout }), report),
    ).toBe(false);
    expect(report).toHaveBeenCalledExactlyOnceWith(observation);
    expect(JSON.stringify(report.mock.calls)).not.toContain("Private");
  }
  for (const [code, kind] of [
    [null, "automation_timeout"],
    ["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "automation_output_limit"],
  ] as const) {
    report.mockClear();
    expect(
      await acknowledgeStartupDialog(
        123,
        "expected",
        "win32",
        async () => {
          throw Object.assign(new Error("Private driver error"), {
            killed: true,
            code,
            stdout: "Private prefix\ndriver_load\n",
          });
        },
        report,
      ),
    ).toBe(false);
    expect(report).toHaveBeenCalledExactlyOnceWith({
      kind,
      exit_code: null,
      native_status: null,
      stage: "driver_load",
    });
    expect(JSON.stringify(report.mock.calls)).not.toContain("Private");
  }
});
it("observes controlled Windows initialization progress before its single controller completes", async () => {
  const execute = promisify(execFile);
  const report = vi.fn();
  const run = vi.fn((_file, _args, options) =>
    execute(
      process.execPath,
      [
        "-e",
        "console.log('Private native output'); console.log('driver_load'); console.log('acknowledged')",
      ],
      options,
    ),
  );
  expect(await acknowledgeStartupDialog(123, "expected", "win32", run, report, 12000)).toBe(true);
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0]?.[2]).toMatchObject({
    timeout: 12000,
    maxBuffer: 65536,
    env: { OHTIA_STARTUP_DRIVER_BUDGET_MS: "12000" },
  });
  expect(report).toHaveBeenCalledWith({
    kind: "automation_pending",
    stage: "driver_load",
    native_status: null,
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain("Private");
  expect(await acknowledgeStartupDialog(123, "expected", "win32", run, report, 20001)).toBe(false);
  expect(run).toHaveBeenCalledOnce();
});
it("loads the Windows dialog controller once within the existing refusal deadline", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn() });
  const acknowledge = vi.fn(async () => false);
  await expect(
    refuseDevelopmentCommand(
      { executable: "/application", app: "/app", args: [] },
      {},
      "/scratch",
      "expected",
      {
        platform: "win32",
        spawnProcess: () => child,
        acknowledge,
        deadline_ms: 20,
        poll_ms: 1,
      },
    ),
  ).rejects.toThrow("dialog_acknowledged=false");
  expect(acknowledge).toHaveBeenCalledOnce();
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
});
it("retains only bounded flags from the owned macOS startup process sample", async () => {
  const run = vi.fn(async () => ({
    stdout:
      "Private path and stack details\n-[NSAlert runModal]\n-[NSApplication run]\nelectron::ShowErrorBox\n",
  }));
  const result = await sampleStartupProcess(123, run);
  expect(result).toEqual({
    kind: "sampled",
    ns_alert_run_modal_frame_seen: true,
    ns_application_run_frame_seen: true,
    show_error_box_frame_seen: true,
    module_loader_frame_seen: false,
    sampling_started_seen: false,
    sampling_completed_seen: false,
  });
  expect(run.mock.calls[0]?.[0]).toBe("/usr/bin/sample");
  expect(run.mock.calls[0]?.[1]).toEqual(["123", "1", "10", "-file", "/dev/stdout"]);
  expect(run.mock.calls[0]?.[2]).toEqual({ timeout: 10000, maxBuffer: 1048576 });
  expect(JSON.stringify(result)).not.toContain("Private");
  expect(await sampleStartupProcess(0, run)).toEqual({
    kind: "sample_unavailable",
    exit_code: null,
  });
  expect(await sampleStartupProcess(123, run, 10001)).toEqual({
    kind: "sample_unavailable",
    exit_code: null,
  });
  expect(run).toHaveBeenCalledOnce();
  expect(
    await sampleStartupProcess(123, async () => {
      throw Object.assign(new Error("Private driver error"), { code: 7 });
    }),
  ).toEqual({
    kind: "sample_unavailable",
    exit_code: 7,
    ns_alert_run_modal_frame_seen: false,
    ns_application_run_frame_seen: false,
    show_error_box_frame_seen: false,
    module_loader_frame_seen: false,
    sampling_started_seen: false,
    sampling_completed_seen: false,
  });
  const partial = await sampleStartupProcess(123, async () => {
    throw Object.assign(new Error("Private diagnostic"), {
      killed: true,
      stdout: "Private stack details\n-[NSAlert runModal]\n",
      stderr: "Sampling process 123\nSampling completed, processing symbols\nPrivate path",
    });
  });
  expect(partial).toEqual({
    kind: "sample_timeout",
    exit_code: null,
    ns_alert_run_modal_frame_seen: true,
    ns_application_run_frame_seen: false,
    show_error_box_frame_seen: false,
    module_loader_frame_seen: false,
    sampling_started_seen: true,
    sampling_completed_seen: true,
  });
  expect(JSON.stringify(partial)).not.toContain("Private");
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
it("terminates and reaps its owned refusal child when graceful termination is ignored", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-refusal-child-"));
  roots.push(root);
  const script = path.join(root, "child.cjs");
  fs.writeFileSync(
    script,
    'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
  );
  const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  const kill = vi.spyOn(child, "kill");
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Fixture exited before readiness.")));
    });
    await expect(
      refuseDevelopmentCommand(
        { executable: process.execPath, app: script, args: [] },
        {},
        root,
        "expected",
        {
          platform: "linux",
          spawnProcess: () => child,
          deadline_ms: 25,
        },
      ),
    ).rejects.toThrow("did not exit");
    await vi.waitFor(
      () => expect(child.exitCode !== null || child.signalCode !== null).toBe(true),
      { timeout: 1000, interval: 10 },
    );
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
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
  expect(stalled.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  const failed = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const failure = refuseDevelopmentCommand(runtime, {}, "/scratch", "expected", {
    platform: "linux",
    spawnProcess: () => failed,
  });
  failed.emit("error", new Error("Synthetic launch failure."));
  await expect(failure).rejects.toThrow("launch failure");
});

it("observes macOS accessibility trust without prompting or retaining native diagnostics", async () => {
  for (const [stdout, state] of [
    ["trusted\n", "trusted"],
    ["untrusted\n", "untrusted"],
    ["Private native diagnostic", "unavailable"],
  ]) {
    const run = vi.fn(async () => ({ stdout }));
    const result = await observeMacAccessibility(run, "darwin");
    expect(result).toEqual({ state });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe("/usr/bin/osascript");
    expect(run.mock.calls[0]?.[1].slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
    expect(run.mock.calls[0]?.[1][3]).toContain("$.AXIsProcessTrusted()");
    expect(run.mock.calls[0]?.[1][3]).not.toMatch(/AXMakeProcessTrusted|WithOptions|Prompt/);
    expect(run.mock.calls[0]?.[2]).toEqual({ timeout: 2000, maxBuffer: 4096 });
    expect(JSON.stringify(result)).not.toContain("Private");
  }
  const run = vi.fn(async () => {
    throw Object.assign(new Error("Private error"), { killed: true });
  });
  expect(await observeMacAccessibility(run, "darwin")).toEqual({ state: "timeout" });
  expect(await observeMacAccessibility(run, "linux")).toEqual({ state: "unsupported" });
  expect(run).toHaveBeenCalledOnce();
});
