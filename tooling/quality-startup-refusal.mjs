import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const execute = promisify(execFile);

const windowsDialog = String.raw`
$ErrorActionPreference = 'Stop'
$ownerId = [int]$env:OHTIA_STARTUP_OWNER_PID
$expected = $env:OHTIA_STARTUP_EXPECTED_TEXT
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OhtiaStartupDialog {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter, IntPtr data, uint flags, uint timeout, out UIntPtr result);
}
"@
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerId)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
foreach ($window in $windows) {
  $handle = [IntPtr]$window.Current.NativeWindowHandle
  $className = [System.Text.StringBuilder]::new(256)
  if ([OhtiaStartupDialog]::GetClassName($handle, $className, 256) -eq 0 -or $className.ToString() -ne '#32770') { continue }
  $children = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $matched = $false
  foreach ($element in $children) { if ($element.Current.Name -eq $expected) { $matched = $true } }
  if (-not $matched) { continue }
  # Electron ShowErrorBox is a TaskDialog with the implicit IDOK action.
  # Window controls are not dialog actions and must not enter a button count.
  $result = [UIntPtr]::Zero
  $sent = [OhtiaStartupDialog]::SendMessageTimeout($handle, 0x466, [UIntPtr]::new([uint32]1), [IntPtr]::Zero, 2, 1000, [ref]$result)
  if ($sent -ne [IntPtr]::Zero) { Write-Output 'acknowledged'; exit 0 }
}
exit 2
`;
const macDialog = String.raw`
on run argv
  set ownerId to (item 1 of argv) as integer
  set expected to item 2 of argv
  tell application "System Events"
    set owners to application processes whose unix id is ownerId
    if (count of owners) is not 1 then return "absent"
    tell item 1 of owners
      repeat with candidate in windows
        set matched to false
        repeat with candidateElement in entire contents of candidate
          try
            if role of candidateElement is "AXStaticText" and (value of candidateElement as text) is expected then set matched to true
          end try
        end repeat
        if matched then
          try
            set defaultAction to value of attribute "AXDefaultButton" of candidate
            if role of defaultAction is "AXButton" and enabled of defaultAction then
              perform action "AXPress" of defaultAction
              return "acknowledged"
            end if
          end try
        end if
      end repeat
    end tell
  end tell
  return "absent"
end run
`;
/** Acknowledge only the expected startup error owned by this test's child, never another window. */
export async function acknowledgeStartupDialog(
  pid,
  expected,
  platform = process.platform,
  run = execute,
  reportFailure = () => {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof expected !== "string" || !expected.length)
    return false;
  let executable, args;
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
    const result = await run(executable, args, {
      timeout: 4000,
      maxBuffer: 16384,
      windowsHide: true,
      ...(platform === "win32"
        ? {
            env: {
              ...process.env,
              OHTIA_STARTUP_OWNER_PID: String(pid),
              OHTIA_STARTUP_EXPECTED_TEXT: expected,
            },
          }
        : {}),
    });
    return result.stdout.trim() === "acknowledged";
  } catch (error) {
    // An absent Windows dialog is an expected poll result, not an automation failure.
    if (platform !== "win32" || error?.code !== 2) {
      const nativeStatus =
        platform === "darwin" && typeof error?.stderr === "string"
          ? /\((-\d{3,6})\)/.exec(error.stderr)?.[1]
          : undefined;
      reportFailure({
        kind: error?.killed ? "automation_timeout" : "automation_failed",
        exit_code: Number.isInteger(error?.code) ? error.code : null,
        native_status: nativeStatus ? Number(nativeStatus) : null,
      });
    }
    return false;
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
            ".",
        ),
      );
    }, options.deadline_ms ?? 20000);
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
            acknowledgeStartupDialog(pid, expected, selectedPlatform, execute, (failure) => {
              lastFailure = failure;
            }))
        )(child.pid, expectedMessage, platform)
      ) {
        acknowledged = true;
        lastFailure = null;
        break;
      }
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
    await acknowledgement;
  }
  if (code !== 1)
    throw new Error(
      "The packaged development switch was not refused with the admission exit code.",
    );
  return { exit_code: code, dialog_acknowledged: acknowledged };
}
