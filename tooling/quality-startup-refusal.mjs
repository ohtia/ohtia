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
  set nodeCount to 0
  set staticCount to 0
  set headingCount to 0
  set roleErrors to 0
  set valueErrors to 0
  set valueReads to 0
  set otherExact to 0
  set containingExpected to 0
  set roleErrorStatus to 0
  set valueErrorStatus to 0
  set defaultButtons to 0
  tell application "System Events"
    if not UI elements enabled then return "ui_scripting_unavailable"
    set owners to application processes whose unix id is ownerId
    if (count of owners) is 0 then return "owner_absent"
    if (count of owners) is not 1 then return "owner_ambiguous"
    tell item 1 of owners
      set frontmost to true
      if not frontmost then return "activation_pending"
      set stage to "window_absent_frontmost"
      repeat with candidateReference in windows
        set candidate to contents of candidateReference
        set stage to "expected_text_absent"
        set matched to false
        set nameMatched to false
        repeat with elementReference in entire contents of candidate
          set candidateElement to contents of elementReference
          set nodeCount to nodeCount + 1
          try
            set candidateRole to role of candidateElement as text
            if candidateRole is "AXStaticText" then set staticCount to staticCount + 1
            if candidateRole is "AXHeading" then set headingCount to headingCount + 1
            if candidateRole is "AXStaticText" or candidateRole is "AXHeading" or candidateRole is "AXTextArea" then
              try
                set candidateValue to value of candidateElement as text
                set valueReads to valueReads + 1
                if candidateValue contains expected then set containingExpected to containingExpected + 1
                if candidateValue is expected then
                  if candidateRole is "AXStaticText" then
                    set matched to true
                  else
                    set otherExact to otherExact + 1
                  end if
                end if
              on error number nativeStatus
                set valueErrors to valueErrors + 1
                if valueErrorStatus is 0 then set valueErrorStatus to nativeStatus
              end try
            end if
            if candidateRole is "AXStaticText" then
              try
                if (name of candidateElement as text) is expected then set nameMatched to true
              end try
            end if
          on error number nativeStatus
            set roleErrors to roleErrors + 1
            if roleErrorStatus is 0 then set roleErrorStatus to nativeStatus
          end try
        end repeat
        try
          set observedDefault to value of attribute "AXDefaultButton" of candidate
          if role of observedDefault is "AXButton" and enabled of observedDefault then set defaultButtons to defaultButtons + 1
        end try
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
  return "tree:" & nodeCount & "," & staticCount & "," & headingCount & "," & roleErrors & "," & valueErrors & "," & valueReads & "," & otherExact & "," & containingExpected & "," & roleErrorStatus & "," & valueErrorStatus & "," & defaultButtons & linefeed & stage
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
  const lines = stdout.trim().split(/\r?\n/);
  const value = lines.at(-1);
  const counts = lines
    .map((line) =>
      /^tree:(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4}),(-?\d{1,6}),(-?\d{1,6}),(\d{1,4})$/.exec(
        line,
      ),
    )
    .find(Boolean)
    ?.slice(1)
    .map(Number);
  let tree;
  if (
    counts &&
    counts.filter((_, index) => index !== 8 && index !== 9).every((count) => count <= 4096)
  ) {
    const [
      nodes,
      static_text,
      headings,
      role_errors,
      value_errors,
      values_read,
      other_exact,
      containing_expected,
      role_error_status,
      value_error_status,
      default_buttons,
    ] = counts;
    if (
      static_text + headings <= nodes &&
      role_errors <= nodes &&
      value_errors + values_read <= nodes &&
      other_exact <= values_read &&
      containing_expected <= values_read &&
      (role_errors > 0 || role_error_status === 0) &&
      (value_errors > 0 || value_error_status === 0)
    )
      tree = {
        nodes,
        static_text,
        headings,
        role_errors,
        value_errors,
        values_read,
        other_exact,
        containing_expected,
        role_error_status,
        value_error_status,
        default_buttons,
      };
  }
  const observation = tree ? { tree } : {};
  if (dialogStages.has(value)) return { stage: value, native_status: null, ...observation };
  if (tree && value.startsWith("tree:"))
    return { stage: "tree_observed", native_status: null, tree };
  const status = /^action_failed:(-?\d{1,6})$/.exec(value);
  return status
    ? { stage: "action_failed", native_status: Number(status[1]), ...observation }
    : null;
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
export async function sampleStartupProcess(pid, run = execute, budget_ms = 10000) {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(budget_ms) ||
    budget_ms < 1 ||
    budget_ms > 10000
  )
    return { kind: "sample_unavailable", exit_code: null };
  try {
    const result = await run("/usr/bin/sample", [String(pid), "1", "10", "-file", "/dev/stdout"], {
      timeout: budget_ms,
      maxBuffer: 1048576,
    });
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
/** Read this automation client's trust state without requesting or granting access. */
export async function observeMacAccessibility(run = execute, platform = process.platform) {
  if (platform !== "darwin") return { state: "unsupported" };
  try {
    const result = await run(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("ApplicationServices"); if (typeof $.AXIsProcessTrusted !== "function") ObjC.bindFunction("AXIsProcessTrusted", ["bool", []]); $.AXIsProcessTrusted() ? "trusted" : "untrusted"',
      ],
      { timeout: 2000, maxBuffer: 4096 },
    );
    const state = result.stdout.trim();
    return { state: state === "trusted" || state === "untrusted" ? state : "unavailable" };
  } catch (error) {
    return { state: error?.killed ? "timeout" : "unavailable" };
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
  let automationClientTrust = null;
  const trustObservation =
    platform === "darwin"
      ? observeMacAccessibility().then((value) => {
          automationClientTrust = value;
        })
      : Promise.resolve();
  const sampleTimer =
    platform === "darwin"
      ? setTimeout(() => {
          if (!ended) {
            processSample = { kind: "sample_pending" };
            const remaining = Math.max(1, Math.floor(controllerDeadline - performance.now()));
            sample = sampleStartupProcess(child.pid, execute, Math.min(10000, remaining)).then(
              (value) => {
                processSample = value;
              },
            );
          }
        }, 5000)
      : undefined;
  let timer;
  const exit = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          "Development-switch refusal did not exit; dialog_acknowledged=" +
            acknowledged +
            "; automation=" +
            JSON.stringify(lastFailure) +
            "; process_sample=" +
            JSON.stringify(processSample) +
            "; automation_client_trust=" +
            JSON.stringify(automationClientTrust) +
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
    await Promise.all([acknowledgement, sample, trustObservation]);
  }
  if (code !== 1)
    throw new Error(
      "The packaged development switch was not refused with the admission exit code.",
    );
  return { exit_code: code, dialog_acknowledged: acknowledged };
}
