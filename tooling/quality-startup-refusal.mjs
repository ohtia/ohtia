import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const execute = promisify(execFile);

const windowsDialog = String.raw`
$ErrorActionPreference = 'Stop'
$ownerId = [int]$env:OHTIA_STARTUP_OWNER_PID
$expected = $env:OHTIA_STARTUP_EXPECTED_TEXT
Add-Type -AssemblyName UIAutomationClient
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerId)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
foreach ($window in $windows) {
  $children = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $matched = $false
  foreach ($element in $children) { if ($element.Current.Name.Contains($expected)) { $matched = $true } }
  if (-not $matched) { continue }
  $buttons = @($children | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
  if ($buttons.Count -ne 1) { continue }
  $pattern = $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  Write-Output 'acknowledged'
  exit 0
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
        repeat with element in entire contents of candidate
          try
            if role of element is "AXStaticText" and (value of element as text) contains expected then set matched to true
          end try
        end repeat
        if matched and (count of buttons of candidate) is 1 then
          click button 1 of candidate
          return "acknowledged"
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
  } catch {
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
  let timer;
  const exit = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new Error("Development-switch refusal did not exit after native acknowledgement."));
    }, options.deadline_ms ?? 20000);
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code);
    });
  });
  const acknowledgement = (async () => {
    while (!ended && ["win32", "darwin"].includes(platform)) {
      if (
        await (options.acknowledge ?? acknowledgeStartupDialog)(
          child.pid,
          expectedMessage,
          platform,
        )
      ) {
        acknowledged = true;
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
