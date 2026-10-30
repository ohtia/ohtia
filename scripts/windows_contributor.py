"""Prepare and diagnose native Windows x64 contribution (bootstrap Python >=3.12)."""

from __future__ import annotations

import argparse
import ctypes as c
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
from pathlib import Path


def shared_modules():
    """Load shared maintenance helpers without making diagnosis write import caches."""
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        import desktop_probes
        import workspace
        from probe_process import run_owned

        return desktop_probes, workspace, run_owned
    finally:
        sys.dont_write_bytecode = previous


desktop_probes, workspace, run_owned = shared_modules()

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / ".tooling/powershell/pwsh.exe"


class ContributorError(Exception):
    """A controlled diagnostic that contains no private paths or child output."""


def require(condition, message):
    if not condition:
        raise ContributorError(message)


def command(arguments, *, remedy, env=None, timeout=30):
    try:
        result = subprocess.run(
            [str(item) for item in arguments],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ContributorError(remedy) from error
    require(result.returncode == 0, remedy)
    return result.stdout.strip()


def native_architecture():
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.IsWow64Process2.argtypes = [w.HANDLE, c.POINTER(w.USHORT), c.POINTER(w.USHORT)]
    kernel.IsWow64Process2.restype = w.BOOL
    process, native = w.USHORT(), w.USHORT()
    require(
        kernel.IsWow64Process2(kernel.GetCurrentProcess(), c.byref(process), c.byref(native)),
        "Cannot inspect native CPU; retry doctor in native Windows x64 Python.",
    )
    require(
        process.value == 0 and native.value == 0x8664,
        "Use native Windows x64 Python on x64 hardware; ARM64, WOW64 and WSL are not admitted by this route.",
    )


def directory_access(directory):
    """Ask the native token for directory rights without creating a probe file."""
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [
        w.LPCWSTR,
        w.DWORD,
        w.DWORD,
        c.c_void_p,
        w.DWORD,
        w.DWORD,
        w.HANDLE,
    ]
    kernel.CreateFileW.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    kernel.CloseHandle.restype = w.BOOL
    # OPEN_EXISTING + FILE_FLAG_BACKUP_SEMANTICS opens the directory itself.
    # LIST_DIRECTORY, ADD_FILE, ADD_SUBDIRECTORY and TRAVERSE require real ACL
    # authority; os.access on Windows only checks file attributes.
    handle = kernel.CreateFileW(str(directory), 0x27, 7, None, 3, 0x02000000, None)
    require(
        handle is not None and handle != c.c_void_p(-1).value,
        "Directory access denied; restore the independent account's read/traverse/create rights for home, checkout and local tool/cache directories, then retry doctor without elevation.",
    )
    require(
        kernel.CloseHandle(handle),
        "Native directory handle could not be closed; stop and inspect the attempt before retrying doctor.",
    )


def filesystem(directory):
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    kernel.GetVolumePathNameW.argtypes = [w.LPCWSTR, w.LPWSTR, w.DWORD]
    kernel.GetDriveTypeW.argtypes = [w.LPCWSTR]
    kernel.GetVolumeInformationW.argtypes = [
        w.LPCWSTR,
        w.LPWSTR,
        w.DWORD,
        c.c_void_p,
        c.c_void_p,
        c.c_void_p,
        w.LPWSTR,
        w.DWORD,
    ]
    volume, kind = c.create_unicode_buffer(32768), c.create_unicode_buffer(64)
    require(
        kernel.GetVolumePathNameW(str(directory), volume, len(volume))
        and kernel.GetDriveTypeW(volume.value) == 3
        and kernel.GetVolumeInformationW(volume.value, None, 0, None, None, None, kind, len(kind))
        and kind.value == "NTFS",
        "Use an accessible local fixed NTFS home and checkout, outside network/synchronized folders; retry doctor.",
    )
    return "NTFS"


def graphical_session():
    from ctypes import wintypes as w

    class Flags(c.Structure):
        _fields_ = [("inherit", w.BOOL), ("reserved", w.BOOL), ("flags", w.DWORD)]

    user = c.WinDLL("user32", use_last_error=True)
    user.GetProcessWindowStation.restype = w.HANDLE
    user.GetUserObjectInformationW.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p]
    flags = Flags()
    require(
        user.GetUserObjectInformationW(
            user.GetProcessWindowStation(), 1, c.byref(flags), c.sizeof(flags), None
        )
        and flags.flags & 1,
        "Use this independent account's logged-in native desktop terminal, not an SSH/service session; retry doctor there.",
    )


def canonical_checkout():
    require(
        Path(__file__).absolute() == Path(__file__).resolve(),
        "Checkout alias refused; reopen the task worktree through its canonical native path, without junctions, symlinks or subst drives, and retry doctor.",
    )


def preflight():
    require(sys.platform == "win32", "Use native Windows 11 x64, not WSL or another OS.")
    require(
        sys.getwindowsversion().build >= 26200 and sys.getwindowsversion().product_type == 1,
        "Use the reviewed Windows 11 25H2 or later supported release.",
    )
    native_architecture()
    canonical_checkout()
    require(
        not desktop_probes.is_elevated(),
        "Use an ordinary desktop terminal; do not run contributor commands as Administrator.",
    )
    home = desktop_probes.account_home()
    for directory in (home, ROOT):
        desktop_probes.real_directory(str(directory))
        directory_access(directory)
        filesystem(directory)
    require(
        len(str(ROOT).encode("utf-16-le")) // 2 <= 80,
        "Checkout path exceeds this route's conservative 80 UTF-16 unit limit; use a shorter local directory without changing global long-path policy.",
    )
    for name in (".tooling", ".cache", ".venv", "node_modules"):
        directory = ROOT / name
        if directory.exists() or directory.is_symlink():
            desktop_probes.real_directory(str(directory))
            directory_access(directory)
    graphical_session()
    git = shutil.which("git.exe")
    require(
        git is not None,
        "Install native Git for Windows from git-scm.com, reopen the terminal and retry doctor.",
    )
    version = command(
        [git, "--version"], remedy="Git failed; repair native Git for Windows and retry doctor."
    )
    require(
        re.fullmatch(r"git version [0-9]+\.[0-9]+\.[0-9]+(?:\.windows\.[0-9]+)?", version),
        "Unexpected Git identity; restore native Git for Windows and retry doctor.",
    )
    _https_client, https_version = workspace.windows_https_client()
    return {
        "target": "win32-x64",
        "https_client": {"version": https_version, "tls": "Schannel"},
        "windows_build": sys.getwindowsversion().build,
        "filesystem": "NTFS",
        "desktop": "visible",
        "git": version,
    }


def shell_environment():
    env = dict(os.environ)
    env.update(
        {
            "POWERSHELL_TELEMETRY_OPTOUT": "1",
            "POWERSHELL_DIAGNOSTICS_OPTOUT": "1",
            "POWERSHELL_UPDATECHECK": "Off",
            "PSModuleAnalysisCachePath": "NUL",
        }
    )
    return env


def shell_doctor():
    require(
        SHELL.is_file(),
        "Run python scripts/windows_contributor.py shell --install-tools to install the reviewed portable PowerShell into this checkout.",
    )
    data = json.loads(
        command(
            [
                SHELL,
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "@{version=$PSVersionTable.PSVersion.ToString();process=[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString();os=[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString();policy=(Get-ExecutionPolicy).ToString()} | ConvertTo-Json -Compress",
            ],
            remedy="Pinned PowerShell failed; preserve the attempt, inspect organizational execution policy and restore only .tooling/powershell before retrying shell --install-tools.",
            env=shell_environment(),
        )
    )
    require(
        isinstance(data, dict),
        "Pinned PowerShell returned an invalid diagnostic; restore the reviewed local shell and retry doctor.",
    )
    require(
        data.get("version") == workspace.tool_records()["powershell"]["version"]
        and data.get("process") == data.get("os") == "X64",
        "PowerShell version/architecture mismatch; remove only the inactive .tooling/powershell and repeat shell --install-tools.",
    )
    require(
        isinstance(data.get("policy"), str)
        and data["policy"]
        in {
            "Restricted",
            "AllSigned",
            "RemoteSigned",
            "Default",
            "Undefined",
            "Unrestricted",
            "Bypass",
        },
        "Unrecognized effective execution policy; review organizational policy and retry doctor. Setup reports recognized existing policy without changing it.",
    )
    return {"version": data["version"], "architecture": "x64", "execution_policy": data["policy"]}


def install_shell():
    with workspace.setup_lock():
        if not SHELL.exists():
            artifact = workspace.tool_records()["powershell"]["artifacts"]["win32-x64"]
            archive = ROOT / ".cache/downloads" / str(artifact["url"]).rsplit("/", 1)[1]
            workspace.download(artifact, archive)
            with tempfile.TemporaryDirectory(
                prefix="powershell-", dir=ROOT / ".tooling"
            ) as temporary:
                extracted = Path(temporary)
                workspace.unpack(archive, extracted)
                require(
                    (extracted / "pwsh.exe").is_file(),
                    "Pinned PowerShell archive layout refused; preserve the cache and restore the reviewed manifest.",
                )
                require(
                    not SHELL.parent.exists(),
                    "Incomplete PowerShell installation; confirm no active setup, preserve evidence and remove only .tooling/powershell before retrying.",
                )
                extracted.rename(SHELL.parent)
    return shell_doctor()


def compiler_doctor():
    # Default builds load the pinned prebuild; this optional check admits a
    # separately prepared x64 Native Tools environment for source compilation.
    compiler = shutil.which("cl.exe")
    sdk = os.environ.get("WindowsSdkDir")
    version = os.environ.get("WindowsSDKVersion", "").rstrip("\\/")
    require(
        compiler is not None and sdk is not None and re.fullmatch(r"10\.0\.[0-9]+\.0", version),
        "Missing compiler/SDK; install Visual Studio 2022 Build Tools with Desktop development with C++, MSVC v143 x64/x86 and Windows 11 SDK 10.0.26100.0 or newer. Open its x64 Native Tools prompt, then the pinned pwsh -NoProfile, and retry doctor --compiler.",
    )
    require(
        int(version.split(".")[2]) >= 26100
        and (Path(sdk) / "Include" / version / "um/Windows.h").is_file(),
        "Windows SDK headers unavailable; repair the selected Windows 11 SDK >=10.0.26100.0 and retry doctor --compiler in a fresh x64 Native Tools environment.",
    )
    # /Bv with no source returns failure on valid MSVC; inspect only its closed banner.
    result = subprocess.run(
        [compiler, "/Bv"], capture_output=True, text=True, timeout=30, check=False
    )
    banner = result.stdout + result.stderr
    match = re.search(r"Compiler Version (19\.[0-9]+\.[0-9]+) for x64", banner)
    require(
        match is not None and int(match[1].split(".")[1]) >= 44,
        "Select MSVC 19.44 or newer targeting x64; an x86/ARM compiler cannot qualify the native fallback.",
    )
    return {"msvc": match[1], "sdk": version, "target": "x64"}


def mutating_command(arguments, *, env=None, timeout=1800, grace=5):
    print(
        "Running pinned tools with private output capture; wait for the controlled result.",
        flush=True,
    )
    try:
        with tempfile.TemporaryFile() as output:
            result = run_owned(
                [str(item) for item in arguments],
                ROOT,
                workspace.environment() if env is None else env,
                timeout,
                grace,
                output=output,
            )
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 262144))
            transcript = output.read().decode("utf-8", errors="replace")
    except (OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        raise ContributorError(
            "Tool execution/cleanup is unverified; retain the attempt and setup lock. Inspect native checkout processes before retrying; do not remove a live writer's lock."
        ) from error
    require(
        not result.get("contained_processes_remaining_after_cleanup", False),
        "Tool cleanup is unverified; retain evidence and inspect native processes before retrying.",
    )
    require(
        not result["timed_out"],
        "Tool timed out and its contained processes stopped; preserve the attempt, inspect the setup lock and retry after restoring network/cache access.",
    )
    if result["exit_code"] or result["contained_processes_remaining_at_exit"]:
        raise ContributorError(failure_message(transcript))


def failure_message(transcript):
    """Select only repository-owned diagnostics; never return subprocess text."""
    for markers, diagnostic in (
        (
            (
                "CERTIFICATE_VERIFY_FAILED",
                "certificate verify failed",
                "Windows HTTPS certificate validation failed",
            ),
            "HTTPS certificate validation failed; restore Windows trusted roots through Windows Update or approved organization policy, then retry. Never disable TLS verification or import an unverified server certificate.",
        ),
        (
            ("Windows system HTTPS client unavailable", "Windows HTTPS transport requires"),
            "Native Windows HTTPS client unavailable; repair the OS curl component through Windows Update, then retry doctor. Keep certificate verification and execution policy enabled.",
        ),
        (
            ("Windows HTTPS download failed",),
            "Native HTTPS download failed; restore access to the manifest's primary HTTPS endpoint and retry setup --install-tools without changing frozen inputs or disabling certificate verification.",
        ),
        (
            ("digest mismatch",),
            "Download digest mismatch; preserve this diagnostic, verify the reviewed manifest and HTTPS access, then retry without executing failed bytes.",
        ),
        (
            ("Another setup owns",),
            "Setup lock exists; confirm its PID and every checkout writer have stopped before removing a stale .tooling/setup.lock and retrying.",
        ),
        (
            ("ERR_PNPM_OUTDATED_LOCKFILE", "changed a lockfile"),
            "Frozen inputs disagree; inspect git diff and restore reviewed manifests/locks before retrying without regenerating them.",
        ),
        (
            ("EPERM", "EACCES", "Permission denied", "WinError 32"),
            "File access or sharing denied; close this checkout's app/editor/tool processes, restore account access and retry. Keep antivirus and global security policy enabled.",
        ),
        (
            ("version mismatch", "NODE_MODULE_VERSION", "not a valid Win32"),
            "Runtime/native artifact mismatch; preserve evidence, restore only the affected checkout-local tools and repeat frozen setup on native x64.",
        ),
    ):
        if any(marker in transcript for marker in markers):
            return diagnostic
    return "Pinned command failed; verify HTTPS/cache access, free local NTFS space, reviewed inputs and tool prerequisites. Preserve the attempt and follow docs/windows-contribution.md#recovery before retrying; raw child output is withheld."


def workspace_doctor():
    env = workspace.environment()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    command(
        [workspace.python_path(), "-I", "-B", ROOT / "scripts/workspace.py", "doctor"],
        env=env,
        timeout=120,
        remedy="Frozen workspace tools/dependencies failed validation; repeat setup --install-tools in this checkout and retry doctor --workspace without changing locks or global tools.",
    )


def admit(profile, prepared):
    require(
        profile is not None
        and prepared is not None
        and profile.is_absolute()
        and prepared.is_absolute(),
        "Supply absolute --profile and --prepared paths from the inspected independent native profile.",
    )
    command(
        [
            workspace.node_path(),
            "--input-type=module",
            "-e",
            "import { admittedLaunch } from './tooling/desktop-launch.mjs'; admittedLaunch(process.argv[1],process.argv[2]);",
            profile,
            prepared,
        ],
        env=workspace.environment(),
        timeout=120,
        remedy="Native launch admission refused before Electron execution; inspect stable exclusions, native roots and prepared hashes using docs/desktop-runtime.md, then retry with an inspected profile and unchanged prepared runtime.",
    )


def package(profile, prepared, output):
    admit(profile, prepared)
    prepared = prepared.resolve(strict=True)
    record = json.loads(profile.read_text(encoding="utf-8"))
    require(
        output is not None
        and output.is_absolute()
        and not output.exists()
        and output.parent.is_dir()
        and output.parent.resolve() == output.parent
        and output.is_relative_to(Path(record["scratch_root"]))
        and not output.is_relative_to(prepared)
        and not prepared.is_relative_to(output),
        "Choose a new absolute package --output with a canonical existing parent inside admitted scratch, disjoint from the immutable prepared runtime.",
    )
    import quality_native

    config = quality_native.configuration(
        {"target": "win32-x64", "profile": "windows-11", "formats": ["nsis"]},
        prepared,
        output / "packages",
        "0.0.0-dev.1.1",
    )
    output.mkdir()
    configuration = output / "builder.json"
    configuration.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    mutating_command(
        [workspace.node_path(), "tooling/quality-package.mjs", configuration],
        env=quality_native.build_environment(),
    )
    artifacts = list((output / "packages").glob("*.exe"))
    require(
        len(artifacts) == 1,
        "Expected exactly one native unsigned NSIS package; preserve the attempt and retry using a new output directory.",
    )
    receipt = {
        "version": 1,
        "target": "win32-x64",
        "prepared_sha256": workspace.digest(prepared / "prepared.json"),
        "packages": [
            {"name": file.name, "sha256": workspace.digest(file), "bytes": file.stat().st_size}
            for file in artifacts
        ],
    }
    (output / "packages.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("doctor", "shell", "setup", "package"))
    parser.add_argument(
        "--install-tools",
        action="store_true",
        help="Consent to pinned checkout-local downloads; never installs OS packages.",
    )
    parser.add_argument("--workspace", action="store_true")
    parser.add_argument("--compiler", action="store_true")
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    started = time.monotonic()
    try:
        report = preflight()
        if args.command in {"shell", "setup"}:
            require(
                args.install_tools,
                "Review docs/windows-contribution.md and add --install-tools to consent to manifest-pinned checkout-local downloads. No OS packages or execution-policy changes are made.",
            )
            report["powershell"] = install_shell()
            if args.command == "setup":
                mutating_command([sys.executable, "-I", ROOT / "scripts/workspace.py", "setup"])
        else:
            report["powershell"] = shell_doctor()
            if args.workspace or args.profile or args.prepared or args.command == "package":
                workspace_doctor()
            if args.command == "package":
                report["package"] = package(args.profile, args.prepared, args.output)
            elif args.profile or args.prepared:
                admit(args.profile, args.prepared)
                report["launch_admission"] = "passed-without-launch"
        if args.compiler:
            report["compiler"] = compiler_doctor()
        report.update(command=args.command, elapsed_seconds=round(time.monotonic() - started, 3))
        print(json.dumps(report, indent=2))
        return 0
    except (
        ContributorError,
        desktop_probes.ProbeError,
        workspace.WorkspaceError,
        OSError,
        ValueError,
        KeyError,
        tarfile.TarError,
        zipfile.BadZipFile,
        subprocess.SubprocessError,
        KeyboardInterrupt,
    ) as error:
        if isinstance(error, ContributorError):
            diagnostic = str(error)
        elif isinstance(error, desktop_probes.ProbeError):
            diagnostic = "Native account/path inspection refused; use existing canonical account-owned local NTFS directories without aliases or reparse points, restore native account/token access, and retry doctor without elevation. See docs/windows-contribution.md#recovery."
        elif isinstance(error, workspace.WorkspaceError):
            diagnostic = failure_message(str(error))
        else:
            diagnostic = "Native inspection, network or pinned archive unavailable; restore native prerequisites and HTTPS/cache access using docs/windows-contribution.md#recovery, then retry. Private paths and child output are withheld."
        print("Windows contribution stopped: " + diagnostic, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
