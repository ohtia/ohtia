import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
const execute = promisify(execFile);

const windowsDialog = String.raw`
$ErrorActionPreference = 'Stop'
$ownerId = [int]$env:OHTIA_STARTUP_OWNER_PID
$expected = $env:OHTIA_STARTUP_EXPECTED_TEXT
function Report-Stage([string]$stage) {
  [Console]::Out.WriteLine($stage)
  [Console]::Out.Flush()
}
$budget = [int]$env:OHTIA_STARTUP_DRIVER_BUDGET_MS
$clock = [System.Diagnostics.Stopwatch]::StartNew()
Report-Stage 'driver_load'
[void][System.Reflection.Assembly]::Load('UIAutomationClient, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
Report-Stage 'window_lookup'
while ($clock.ElapsedMilliseconds -lt $budget) {
  try {
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($windows.Count -eq 0) { $stage = 'window_absent' } else { $stage = 'dialog_absent' }
    foreach ($window in $windows) {
      Report-Stage 'dialog_lookup'
      if ($window.Current.ClassName -cne '#32770') { continue }
      $stage = 'expected_text_absent'
      Report-Stage 'text_lookup'
      $children = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $matched = $false
      foreach ($element in $children) { if ($element.Current.Name -ceq $expected) { $matched = $true } }
      if (-not $matched) { continue }
      $stage = 'action_unavailable'
      Report-Stage 'action_lookup'
      $pattern = $null
      if (-not $window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) { continue }
      # Electron's TaskDialog admits cancellation. Close only this PID/text-matched native dialog.
      Report-Stage 'action_invoke'
      ([System.Windows.Automation.WindowPattern]$pattern).Close()
      Report-Stage 'acknowledged'
      exit 0
    }
  } catch [System.Windows.Automation.ElementNotAvailableException] {
    # An owned window may disappear between enumeration and an element access.
    $stage = 'element_unavailable'
  }
  Report-Stage $stage
  [System.Threading.Thread]::Sleep(100)
}

exit 2
`;
const macDialog = String.raw`
on run argv
  set ownerId to (item 1 of argv) as integer
  set expected to item 2 of argv
  tell application "System Events"
    if not UI elements enabled then return "ui_scripting_unavailable"
    set owners to application processes whose unix id is ownerId
    if (count of owners) is 0 then return "owner_absent"
    if (count of owners) is not 1 then return "owner_ambiguous"
    tell item 1 of owners
      set frontmost to true
      if not frontmost then return "activation_pending"
      set stage to "window_absent_frontmost"
      repeat with candidate in windows
        set stage to "expected_text_absent"
        set matched to false
        set nameMatched to false
        repeat with candidateElement in entire contents of candidate
          try
            if role of candidateElement is "AXStaticText" then
              if (value of candidateElement as text) is expected then set matched to true
            end if
          end try
          try
            if role of candidateElement is "AXStaticText" and (name of candidateElement as text) is expected then set nameMatched to true
          end try
        end repeat
        if nameMatched and not matched then set stage to "expected_text_name_only"
        if matched then
          set stage to "action_unavailable"
          try
            set defaultAction to value of attribute "AXDefaultButton" of candidate
            if role of defaultAction is "AXButton" and enabled of defaultAction then
              set stage to "action_invoke"
              perform action "AXPress" of defaultAction
              return "acknowledged"
            end if
          on error number nativeStatus
            return "action_failed:" & nativeStatus
          end try
        end if
      end repeat
    end tell
  end tell
  return stage
end run
`;
// Driver output is an allowlisted protocol, never native UI text or arbitrary diagnostics.
const dialogStages = new Set([
  "driver_load",
  "ui_scripting_unavailable",
  "window_lookup",
  "window_absent",
  "element_unavailable",
  "window_absent_frontmost",
  "activation_pending",
  "dialog_lookup",
  "dialog_absent",
  "text_lookup",
  "expected_text_absent",
  "expected_text_name_only",
  "owner_absent",
  "owner_ambiguous",
  "action_unavailable",
  "action_lookup",
  "action_invoke",
  "action_failed",
]);
function dialogObservation(stdout) {
  if (typeof stdout !== "string") return null;
  const value = stdout.trim().split(/\r?\n/).at(-1);
  if (dialogStages.has(value)) return { stage: value, native_status: null };
  const status = /^action_failed:(-?\d{1,6})$/.exec(value);
  return status ? { stage: "action_failed", native_status: Number(status[1]) } : null;
}
/** Acknowledge only the expected startup error owned by this test's child, never another window. */
export async function acknowledgeStartupDialog(
  pid,
  expected,
  platform = process.platform,
  run = execute,
  reportFailure = () => {},
  budget_ms = 4000,
) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof expected !== "string" || !expected.length)
    return false;
  if (!Number.isSafeInteger(budget_ms) || budget_ms < 1 || budget_ms > 20000) return false;
  let executable, args;
  let progress;
  if (platform === "win32") {
    executable = path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    args = ["-NoProfile", "-NonInteractive", "-Command", windowsDialog];
  } else if (platform === "darwin") {
    executable = "/usr/bin/osascript";
    args = ["-e", macDialog, String(pid), expected];
  } else return false;
  try {
    const pending = run(executable, args, {
      timeout: platform === "win32" ? budget_ms : 4000,
      maxBuffer: platform === "win32" && budget_ms > 4000 ? 65536 : 16384,
      windowsHide: true,
      ...(platform === "win32"
        ? {
            env: {
              ...process.env,
              OHTIA_STARTUP_OWNER_PID: String(pid),
              OHTIA_STARTUP_EXPECTED_TEXT: expected,
              OHTIA_STARTUP_DRIVER_BUDGET_MS: String(budget_ms),
            },
          }
        : {}),
    });
    // execFile's public promise.child stream makes initialization progress observable before exit.
    if (pending.child?.stdout) {
      progress = createInterface({ input: pending.child.stdout });
      progress.on("error", () => {});
      progress.on("line", (line) => {
        const observation = dialogObservation(line);
        if (observation) reportFailure({ kind: "automation_pending", ...observation });
      });
    }
    const result = await pending;
    if (result.stdout.trim().split(/\r?\n/).at(-1) === "acknowledged") return true;
    const observation = dialogObservation(result.stdout);
    reportFailure({
      kind: observation ? "automation_pending" : "automation_protocol_error",
      ...observation,
    });
    return false;
  } catch (error) {
    const observation = dialogObservation(error?.stdout);
    // Exit 2 is a normal Windows poll; retain its closed logical stage as evidence.
    if (platform === "win32" && error?.code === 2 && observation) {
      reportFailure({ kind: "automation_pending", ...observation });
    } else {
      const nativeStatus =
        platform === "darwin" && typeof error?.stderr === "string"
          ? /\((-\d{3,6})\)/.exec(error.stderr)?.[1]
          : undefined;
      reportFailure({
        kind:
          error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
            ? "automation_output_limit"
            : error?.killed
              ? "automation_timeout"
              : "automation_failed",
        exit_code: Number.isInteger(error?.code) ? error.code : null,
        native_status: nativeStatus ? Number(nativeStatus) : (observation?.native_status ?? null),
        stage: observation?.stage ?? null,
      });
    }
    return false;
  } finally {
    progress?.close();
  }
}
function sampleObservation(stdout, stderr) {
  const stack = typeof stdout === "string" ? stdout : "";
  const outputs = [stdout, stderr].filter((value) => typeof value === "string");
  return {
    ns_alert_run_modal_frame_seen: /NSAlert[^\r\n]*runModal/.test(stack),
    ns_application_run_frame_seen: /NSApplication[^\r\n]*\brun\b/.test(stack),
    show_error_box_frame_seen: /\bShowErrorBox\b/.test(stack),
    module_loader_frame_seen: /\b(?:dlopen|uv_dlopen)\b/.test(stack),
    sampling_started_seen: outputs.some((value) => /Sampling process\s+\d+/.test(value)),
    sampling_completed_seen: outputs.some((value) =>
      /Sampling completed, processing symbols/.test(value),
    ),
  };
}
/** Read one bounded sample of this synthetic child; retain only known frame/progress flags. */
export async function sampleStartupProcess(pid, run = execute) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    return { kind: "sample_unavailable", exit_code: null };
  try {
    const result = await run(
      "/usr/bin/sample",
      [String(pid), "1", "10", "-mayDie", "-file", "/dev/stdout"],
      { timeout: 4000, maxBuffer: 1048576 },
    );
    return { kind: "sampled", ...sampleObservation(result.stdout, result.stderr) };
  } catch (error) {
    return {
      kind:
        error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
          ? "sample_output_limit"
          : error?.killed
            ? "sample_timeout"
            : "sample_unavailable",
      exit_code: Number.isInteger(error?.code) ? error.code : null,
      ...sampleObservation(error?.stdout, error?.stderr),
    };
  }
}
/** The shipped entry point retains its native modal admission error on Windows and macOS. */
export async function refuseDevelopmentCommand(
  runtime,
  env,
  scratch,
  expectedMessage,
  options = {},
) {
  const platform = options.platform ?? process.platform;
  const child = (options.spawnProcess ?? spawn)(
    runtime.executable,
    [runtime.app, ...runtime.args, "--ohtia-dev-command=request"],
    { env, cwd: scratch, stdio: "ignore" },
  );
  let ended = false;
  let acknowledged = false;
  let lastFailure = null;
  let processSample = null;
  let sample = Promise.resolve();
  const deadline_ms = options.deadline_ms ?? 20000;
  const controllerDeadline = performance.now() + deadline_ms;
  const sampleTimer =
    platform === "darwin"
      ? setTimeout(() => {
          if (!ended) {
            processSample = { kind: "sample_pending" };
            sample = sampleStartupProcess(child.pid).then((value) => {
              processSample = value;
            });
          }
        }, 5000)
      : undefined;
  let timer;
  const exit = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "Development-switch refusal did not exit; dialog_acknowledged=" +
            acknowledged +
            "; automation=" +
            JSON.stringify(lastFailure) +
            "; process_sample=" +
            JSON.stringify(processSample) +
            ".",
        ),
      );
    }, deadline_ms);
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code);
    });
  });
  const acknowledgement = (async () => {
    while (!ended && ["win32", "darwin"].includes(platform)) {
      if (
        await (
          options.acknowledge ??
          ((pid, expected, selectedPlatform) =>
            acknowledgeStartupDialog(
              pid,
              expected,
              selectedPlatform,
              execute,
              (failure) => {
                lastFailure = failure;
              },
              selectedPlatform === "win32"
                ? Math.max(1, Math.min(20000, Math.floor(controllerDeadline - performance.now())))
                : 4000,
            ))
        )(child.pid, expectedMessage, platform)
      ) {
        acknowledged = true;
        lastFailure = null;
        break;
      }
      // One Windows process owns loading and polling within the existing overall deadline.
      if (platform === "win32") break;
      if (!ended)
        await new Promise((resolve) => {
          setTimeout(resolve, options.poll_ms ?? 100);
        });
    }
  })();
  let code;
  try {
    code = await exit;
  } finally {
    ended = true;
    clearTimeout(timer);
    clearTimeout(sampleTimer);
    await Promise.all([acknowledgement, sample]);
  }
  if (code !== 1)
    throw new Error(
      "The packaged development switch was not refused with the admission exit code.",
    );
  return { exit_code: code, dialog_acknowledged: acknowledged };
}
