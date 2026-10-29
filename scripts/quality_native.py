"""Construct and smoke-test unsigned packages in a fresh GitHub-hosted native VM."""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

import desktop_runtime
import quality_delivery as delivery
import quality_processes as process_observer
import workspace
from probe_process import run_owned

ROOT = delivery.ROOT


def command(args: list, *, capture: bool = False) -> str:
    result = subprocess.run(
        [str(arg) for arg in args],
        cwd=ROOT,
        env=build_environment(),
        check=True,
        capture_output=capture,
        text=True,
        timeout=900,
    )
    return result.stdout if capture else ""


def build_environment() -> dict:
    # No signing, provider, publication, administrative or runtime injection credentials.
    allowed = {
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "SystemRoot",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "DISPLAY",
        "XAUTHORITY",
        "XDG_RUNTIME_DIR",
        "DBUS_SESSION_BUS_ADDRESS",
        "XDG_SESSION_TYPE",
        "LANG",
        "LC_ALL",
        "GITHUB_ACTIONS",
        "RUNNER_ENVIRONMENT",
        "RUNNER_TEMP",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "OHTIA_QUALITY_VM",
        "WAYLAND_DISPLAY",
        "XDG_CURRENT_DESKTOP",
    }
    env = {
        key: value
        for key, value in workspace.environment().items()
        if key in allowed
        or key.startswith("UV_")
        or key in {"PYTHONNOUSERSITE", "ELECTRON_SKIP_BINARY_DOWNLOAD", "PLAYWRIGHT_BROWSERS_PATH"}
    }
    env.update(
        {
            "CSC_IDENTITY_AUTO_DISCOVERY": "false",
            "ELECTRON_BUILDER_CACHE": str(ROOT / ".cache/quality-builder"),
        }
    )
    return env


def macos_filesystem(directory: Path) -> str:
    """Resolve the directory's containing device before querying its filesystem type."""
    rows = command(["/bin/df", "-P", directory], capture=True).splitlines()
    delivery.require(len(rows) == 2, "Cannot identify the native data volume.")
    columns = rows[1].split()
    delivery.require(
        len(columns) >= 6 and columns[0].startswith("/dev/"),
        "A native local data volume is required.",
    )
    device = columns[0]
    record = plistlib.loads(
        command(["/usr/sbin/diskutil", "info", "-plist", device], capture=True).encode("utf-8")
    )
    delivery.require(
        isinstance(record, dict)
        and record.get("DeviceNode") == device
        and isinstance(record.get("FilesystemType"), str),
        "Native volume identity or filesystem type is unavailable.",
    )
    return record["FilesystemType"]


def host_matches(cell: dict) -> dict:
    delivery.require(
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted",
        "Use a fresh standard GitHub-hosted VM.",
    )
    delivery.require(
        workspace.target_id() == cell["target"], "Hosted OS/CPU differs from the required cell."
    )
    if sys.platform == "linux":
        release = platform.freedesktop_os_release()
        if cell["profile"] in {"fedora-44", "debian-13"}:
            delivery.require(
                os.environ.get("OHTIA_QUALITY_VM") == cell["id"],
                "Use this distribution's actual KVM guest.",
            )
            expected_id, version_id = (
                ("fedora", "44") if cell["profile"] == "fedora-44" else ("debian", "13")
            )
            delivery.require(
                release.get("ID") == expected_id and release.get("VERSION_ID") == version_id,
                "Wrong native guest distribution.",
            )
            if expected_id == "fedora":
                delivery.require(
                    release.get("VARIANT_ID") == "workstation"
                    and ".fc44" in platform.release()
                    and command(["getenforce"], capture=True).strip() == "Enforcing",
                    "Provisioned Fedora requires its vendor kernel, Workstation release package and enforcing SELinux.",
                )
            else:
                delivery.require(
                    "deb13" in platform.release(), "Debian requires its own vendor kernel."
                )
        else:
            delivery.require(
                release.get("ID") == "ubuntu"
                and f"ubuntu-{release.get('VERSION_ID')}" == cell["profile"],
                "Wrong Ubuntu host.",
            )
        delivery.require(os.getuid() != 0, "Root Electron execution is forbidden.")
        filesystem = command(
            ["findmnt", "-n", "-o", "FSTYPE", "-T", str(Path.home())], capture=True
        ).strip()
        delivery.require(filesystem == cell["filesystem"], "Unqualified Linux data filesystem.")
        if cell["backend"] == "x11":
            delivery.require(
                bool(os.environ.get("DISPLAY")) and not os.environ.get("WAYLAND_DISPLAY"),
                "A private X11 session is required.",
            )
        else:
            delivery.require(
                not os.environ.get("DISPLAY")
                and os.environ.get("WAYLAND_DISPLAY")
                and os.environ.get("XDG_CURRENT_DESKTOP") == "GNOME",
                "Use the private GNOME Wayland session without an XWayland fallback.",
            )
    elif sys.platform == "darwin":
        release = command(["/usr/bin/sw_vers", "-productVersion"], capture=True).strip()
        delivery.require(f"macos-{release.split('.')[0]}" == cell["profile"], "Wrong macOS family.")
        translated = subprocess.run(
            ["/usr/sbin/sysctl", "-in", "sysctl.proc_translated"],
            capture_output=True,
            text=True,
            check=False,
        )
        delivery.require(translated.stdout.strip() != "1", "Rosetta is not native execution.")
        filesystem = macos_filesystem(Path.home())
        delivery.require(filesystem.lower() == "apfs", "Unqualified macOS filesystem.")
    else:
        release = command(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_OperatingSystem).Caption",
            ],
            capture=True,
        ).strip()
        delivery.require(
            (
                "Server 2025" in release
                if cell["profile"] == "windows-server-2025"
                else "Windows 11" in release
            ),
            "Wrong Windows host family.",
        )
        filesystem = command(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-Volume -DriveLetter $env:USERPROFILE.Substring(0,1)).FileSystem",
            ],
            capture=True,
        ).strip()
        delivery.require(filesystem == "NTFS", "Unqualified Windows filesystem.")
    return {
        "platform": sys.platform,
        "machine": platform.machine(),
        "kernel": platform.release(),
        "release": release,
        "filesystem": filesystem,
        "image_os": os.environ.get("ImageOS"),
        "image_version": os.environ.get("ImageVersion"),
    }


def configuration(cell: dict, prepared: Path, output: Path, version: str) -> dict:
    record = delivery.read(prepared / "prepared.json")
    app = prepared / record["app"]
    tools = delivery.read(ROOT / "config/desktop/toolchain.json")["tools"]
    resources = ROOT / "tooling/quality-packaging"
    config = {
        "appId": "org.ohtia.quality",
        "productName": "ohtia-quality",
        "executableName": "ohtia-quality",
        "electronVersion": tools["electron"]["version"],
        "electronDist": str(prepared / "runtime"),
        "directories": {"app": str(app), "output": str(output), "buildResources": str(resources)},
        "extraMetadata": {
            "name": "ohtia-quality",
            "version": version,
            "description": "Ohtia unsigned quality build",
            "author": "Ohtia",
            "homepage": "https://github.com/ohtia/ohtia",
            "license": "MIT",
        },
        "artifactName": f"ohtia-{version}-{cell['target']}.${{ext}}",
        "files": ["**/*"],
        "buildNumber": "1",
        "linux": {
            "target": cell["formats"] if cell["target"].startswith("linux-") else ["deb"],
            "category": "Development",
            "synopsis": "Ohtia quality artifact",
        },
        "deb": {
            "packageName": "ohtia-quality",
            "maintainer": "Ohtia <quality@example.invalid>",
            "afterInstall": str(resources / "after-install.sh"),
            "afterRemove": str(resources / "after-remove.sh"),
            "appArmorProfile": str(resources / "apparmor"),
            "fpm": ["--before-install", str(resources / "before-install.sh")],
            "recommends": [],
            "depends": [
                "libgtk-3-0",
                "libnss3",
                "libasound2t64",
                "libgbm1",
                "libxss1",
                "libxtst6",
                "libsecret-1-0",
                "libnotify4",
                "libatspi2.0-0",
                "apparmor",
                "xdg-utils",
            ],
        },
        "win": {"target": ["nsis"], "signAndEditExecutable": False},
        "nsis": {
            "oneClick": False,
            "perMachine": False,
            "allowElevation": False,
            "allowToChangeInstallationDirectory": True,
            "createDesktopShortcut": False,
            "createStartMenuShortcut": False,
        },
        "mac": {
            "target": ["dmg", "zip"],
            "identity": "-",
            "hardenedRuntime": False,
            "notarize": False,
            "category": "public.app-category.education",
        },
        "publish": None,
    }
    native_version = version.replace("-", "~", 1)
    config["deb"]["fpm"] += ["--version", native_version, "--iteration", "1"]
    if cell["profile"] == "debian-13":
        config["deb"].pop("appArmorProfile")
        config["deb"]["afterInstall"] = str(resources / "after-debian.sh")
        config["deb"]["afterRemove"] = str(resources / "after-remove-native.sh")
        config["deb"]["fpm"] = [
            "--before-install",
            str(resources / "before-debian.sh"),
            "--version",
            native_version,
            "--iteration",
            "1",
        ]
    config["rpm"] = {
        "maintainer": "Ohtia <quality@example.invalid>",
        "packageName": "ohtia-quality",
        "afterInstall": str(resources / "after-fedora.sh"),
        "afterRemove": str(resources / "after-remove-native.sh"),
        "fpm": [
            "--before-install",
            str(resources / "before-fedora.sh"),
            "--version",
            native_version,
            "--iteration",
            "1",
        ],
        "depends": [
            "gtk3",
            "nss",
            "alsa-lib",
            "libXScrnSaver",
            "libXtst",
            "libsecret",
            "libnotify",
            "at-spi2-atk",
            "policycoreutils",
        ],
    }
    return config


def prepared_record(directory: Path, cell: dict) -> dict:
    if sys.platform == "darwin":
        app = next(directory.glob("*.app"))
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
        resources = app / "Contents/Resources/app"
    else:
        executable = directory / ("ohtia-quality.exe" if os.name == "nt" else "ohtia-quality")
        resources = directory / "resources/app"
    addon = resources / "native/binding.node"
    arch = cell["target"].split("-")[1]
    delivery.require(
        desktop_runtime.architecture(executable) == arch
        and desktop_runtime.architecture(addon) == arch,
        "Installed executable/addon CPU mismatch.",
    )
    files, links = {}, {}
    for parent, directories, names in os.walk(directory, followlinks=False):
        for name in directories + names:
            file = Path(parent) / name
            relative = file.relative_to(directory).as_posix()
            if file.is_symlink():
                delivery.require(
                    file.resolve().is_relative_to(directory), "Escaping installed framework link."
                )
                links[relative] = os.readlink(file)
            elif file.is_file() and relative != "prepared.json":
                files[relative] = delivery.digest(file)
    return {
        "version": 1,
        "target": cell["target"],
        "executable": executable.relative_to(directory).as_posix(),
        "app": resources.relative_to(directory).as_posix(),
        "files": files,
        "links": links,
    }


def unpack_package(file: Path, kind: str, destination: Path) -> Path:
    destination.mkdir()
    if kind == "deb":
        command(["sudo", "dpkg", "--install", file])
        return Path("/opt/ohtia-quality")
    if kind == "rpm":
        command(["sudo", "rpm", "--install", file])
        return Path("/opt/ohtia-quality")
    if kind == "nsis":
        command([file, "/S", f"/D={destination}"])
        return destination
    if kind == "zip":
        command(["/usr/bin/ditto", "-x", "-k", file, destination])
    else:
        mount = destination / "mount"
        mount.mkdir()
        command(
            ["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, file]
        )
        try:
            app = next(mount.glob("*.app"))
            shutil.copytree(app, destination / app.name, symlinks=True)
        finally:
            command(["/usr/bin/hdiutil", "detach", mount])
        mount.rmdir()
    return destination


def processes(
    directory: Path, known: list[dict] | None = None, *, ready_only: bool = False
) -> list[dict]:
    """Inspect actual native processes whose executable belongs to this package."""
    result = []
    ready = {row["pid"] for row in known or [] if row["renderer"]}
    if sys.platform == "linux":
        # Observation has the ordinary suite account's authority; unavailable procfs data fails.
        active = [row for row in known or [] if process_observer.same_process(row)]
        rows = json.loads(
            command(
                [
                    sys.executable,
                    "-I",
                    ROOT / "scripts/quality_processes.py",
                    directory,
                    json.dumps(active),
                ],
                capture=True,
            )
        )
        return [row for row in rows if not ready_only or not row["renderer"] or row["pid"] in ready]
    elif sys.platform == "darwin":
        output = command(["/bin/ps", "-axo", "pid=,comm=,args="], capture=True)
        library = ctypes.CDLL("/usr/lib/system/libsystem_sandbox.dylib")
        library.sandbox_check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        library.sandbox_check.restype = ctypes.c_int
        for line in output.splitlines():
            if str(directory) not in line:
                continue
            pid = int(line.split(None, 1)[0])
            renderer = "--type=renderer" in line
            if ready_only and renderer and pid not in ready:
                continue
            decision = library.sandbox_check(pid, b"process-fork", 0) if renderer else None
            if renderer and decision is not None and decision < 0 and process_exited(pid):
                continue
            result.append(
                {
                    "pid": pid,
                    "renderer": renderer,
                    "sandbox": decision == 1,
                    "seatbelt_process_fork": decision,
                }
            )
    else:
        if ready_only:
            # Query the already published ready PIDs directly. A fresh CIM/PowerShell query
            # can outlive a short smoke window and miss the renderer entirely.
            items = [
                {"ProcessId": row["pid"], "CreationTime": row.get("creation_time_ms")}
                for row in known or []
                if row["renderer"]
            ]
        else:
            # Final package-process enumeration remains independent of the ready inventory.
            output = command(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
                ],
                capture=True,
            )
            items = json.loads(output)
        for item in items:
            if ready_only:
                renderer = True
            else:
                executable = item.get("ExecutablePath")
                if not executable or not Path(executable).is_relative_to(directory):
                    continue
                renderer = "--type=renderer" in (item.get("CommandLine") or "")
            token = (
                windows_token(
                    item["ProcessId"],
                    directory if ready_only else None,
                    item.get("CreationTime") if ready_only else None,
                )
                if renderer
                else {}
            )
            if ready_only and token["query_status"] == "identity_mismatch":
                continue  # GetProcessTimes proves this is a different generation of the PID.
            if (
                renderer
                and token["query_status"] != "observed"
                and process_exited(item["ProcessId"])
            ):
                continue
            result.append(
                {
                    "pid": item["ProcessId"],
                    "renderer": renderer,
                    "sandbox": token.get("query_status") == "observed"
                    and token.get("restricted") is True
                    and type(token.get("integrity_rid")) is int
                    and 0 <= token["integrity_rid"] <= 0x1000,
                    "token": token,
                }
            )
    return result


def process_exited(pid: int) -> bool:
    """Ignore a failed sandbox query only when the OS confirms the target has stopped."""
    if sys.platform == "win32":
        from ctypes import wintypes as w

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = (
            [w.DWORD, w.BOOL, w.DWORD],
            w.HANDLE,
        )
        kernel.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
        kernel.CloseHandle.argtypes = [w.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            # ERROR_INVALID_PARAMETER for a positive PID means the process no longer exists;
            # access denial or an unknown query failure must still fail the sandbox observation.
            return pid > 0 and ctypes.get_last_error() == 87
        try:
            code = w.DWORD()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value != 259
        finally:
            kernel.CloseHandle(handle)
    result = subprocess.run(
        ["/bin/ps", "-p", str(pid), "-o", "stat="],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
    )
    if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
        return True
    delivery.require(result.returncode == 0, "Native process liveness could not be observed.")
    states = result.stdout.split()
    return bool(states) and all(state.startswith(("Z", "X")) for state in states)


def windows_token(
    pid: int, directory: Path | None = None, creation_time_ms: float | None = None
) -> dict:
    """Observe the restricted token and integrity label used by Chromium's renderer sandbox."""
    from ctypes import wintypes as w

    class SidAndAttributes(ctypes.Structure):
        _fields_ = [("sid", ctypes.c_void_p), ("attributes", w.DWORD)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = [w.DWORD, w.BOOL, w.DWORD], w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    advapi.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)]
    advapi.IsTokenRestricted.argtypes, advapi.IsTokenRestricted.restype = [w.HANDLE], w.BOOL
    advapi.GetTokenInformation.argtypes = [
        w.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        w.DWORD,
        ctypes.POINTER(w.DWORD),
    ]
    advapi.GetSidSubAuthorityCount.argtypes = [ctypes.c_void_p]
    advapi.GetSidSubAuthorityCount.restype = ctypes.POINTER(w.BYTE)
    advapi.GetSidSubAuthority.argtypes = [ctypes.c_void_p, w.DWORD]
    advapi.GetSidSubAuthority.restype = ctypes.POINTER(w.DWORD)
    observed = {"restricted": False, "integrity_rid": None, "query_status": "open_process_failed"}
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return observed
    token = w.HANDLE()
    try:
        if directory is not None:
            if (
                type(creation_time_ms) not in (int, float)
                or not math.isfinite(creation_time_ms)
                or creation_time_ms <= 0
            ):
                return {**observed, "query_status": "creation_identity_missing"}
            kernel.GetProcessTimes.argtypes = [w.HANDLE, *([ctypes.POINTER(w.FILETIME)] * 4)]
            kernel.GetProcessTimes.restype = w.BOOL
            created, exited, kernel_time, user_time = (w.FILETIME() for _ in range(4))
            if not kernel.GetProcessTimes(
                handle,
                ctypes.byref(created),
                ctypes.byref(exited),
                ctypes.byref(kernel_time),
                ctypes.byref(user_time),
            ):
                return {**observed, "query_status": "creation_query_failed"}
            ticks = (created.dwHighDateTime << 32) | created.dwLowDateTime
            # Match Chromium Time::FromFileTime -> InMillisecondsFSinceUnixEpoch:
            # truncate 100 ns ticks to microseconds before converting the epoch and unit.
            observed["creation_time_ms"] = (ticks // 10 - 11644473600000000) / 1000.0
            if observed["creation_time_ms"] != creation_time_ms:
                return {**observed, "query_status": "identity_mismatch"}
            kernel.QueryFullProcessImageNameW.argtypes = [
                w.HANDLE,
                w.DWORD,
                w.LPWSTR,
                ctypes.POINTER(w.DWORD),
            ]
            kernel.QueryFullProcessImageNameW.restype = w.BOOL
            image = ctypes.create_unicode_buffer(32768)
            length = w.DWORD(len(image))
            if not kernel.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(length)):
                return {**observed, "query_status": "image_query_failed"}
            if not Path(image.value).is_relative_to(directory):
                return {**observed, "query_status": "image_mismatch"}
        if not advapi.OpenProcessToken(handle, 8, ctypes.byref(token)):
            return {**observed, "query_status": "open_token_failed"}
        observed["restricted"] = bool(advapi.IsTokenRestricted(token))
        length = w.DWORD()
        # TokenIntegrityLevel is a variable-sized TOKEN_MANDATORY_LABEL containing a SID.
        advapi.GetTokenInformation(token, 25, None, 0, ctypes.byref(length))
        if not 0 < length.value <= 65536:
            return {**observed, "query_status": "integrity_size_failed"}
        buffer = ctypes.create_string_buffer(length.value)
        if not advapi.GetTokenInformation(token, 25, buffer, length, ctypes.byref(length)):
            return {**observed, "query_status": "integrity_query_failed"}
        sid = ctypes.cast(buffer, ctypes.POINTER(SidAndAttributes)).contents.sid
        if not sid:
            return {**observed, "query_status": "missing_integrity_sid"}
        count = advapi.GetSidSubAuthorityCount(sid)
        if not count or not count.contents.value:
            return {**observed, "query_status": "missing_integrity_level"}
        value = advapi.GetSidSubAuthority(sid, count.contents.value - 1)
        if not value:
            return {**observed, "query_status": "integrity_read_failed"}
        return {**observed, "integrity_rid": value.contents.value, "query_status": "observed"}
    finally:
        if token:
            kernel.CloseHandle(token)
        kernel.CloseHandle(handle)


def display_connection(known: list[dict], backend: str) -> dict | None:
    if sys.platform != "linux":
        return None
    if not known:
        return None
    output = command(["ss", "-xnpH"], capture=True)
    rows = []
    for line in output.splitlines():
        values = line.split()
        if len(values) < 8 or values[1] != "ESTAB":
            continue
        rows.append(
            {
                "inode": values[5],
                "peer": values[7],
                "address": values[4],
                "pids": [int(pid) for pid in re.findall(r"pid=(\d+)", line)],
            }
        )
    owned = {row["pid"] for row in known}
    for row in rows:
        if not owned.intersection(row["pids"]):
            continue
        peers = [peer for peer in rows if peer["inode"] == row["peer"]]
        for peer in peers:
            marker = "wayland-" if backend == "wayland" else "/tmp/.X11-unix/X"
            if marker in peer["address"]:
                return {
                    "backend": backend,
                    "source": "unix-peer",
                    "client_pids": row["pids"],
                    "server_pids": peer["pids"],
                    "peer_inode": peer["inode"],
                }
    return None


def smoke(profile: Path, prepared: Path, destination: Path, cell: dict) -> tuple[dict, dict]:
    import concurrent.futures

    suites, observations = {}, []
    known = []
    identity_history = []
    displays = []
    for suite, entry, receipt in (
        ("runtime", "desktop-acceptance.mjs", "receipt.json"),
        ("storage", "storage-acceptance.mjs", "storage-receipt.json"),
        ("diagnostics", "diagnostic-acceptance.mjs", "diagnostic-receipt.json"),
    ):
        output = destination / suite
        known = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                run_owned,
                [
                    str(workspace.node_path()),
                    str(ROOT / "tooling" / entry),
                    str(profile),
                    str(prepared),
                    str(output),
                ],
                ROOT,
                build_environment(),
                900,
                5,
            )
            while not future.done():
                known_file = output / "native-processes.json"
                if known_file.exists():
                    known = delivery.read(known_file)["processes"]
                    for row in known:
                        if row not in identity_history:
                            identity_history.append(row)
                observations.extend(processes(prepared, known, ready_only=True))
                connected = display_connection(known, cell["backend"])
                if connected is not None and connected not in displays:
                    displays.append(connected)
                time.sleep(0.2)
            supervision = future.result()
        delivery.write(destination / f"{suite}-supervision.json", supervision)
        delivery.write(
            destination / "native-observations.json",
            {
                "samples": observations,
                "ready_processes": identity_history,
                "display_observations": displays,
            },
        )
        delivery.require(
            supervision["exit_code"] == 0
            and not supervision["timed_out"]
            and not supervision["contained_processes_remaining_at_exit"]
            and not supervision.get("contained_processes_remaining_after_cleanup", False),
            "Packaged suite or supervised cleanup failed.",
        )
        result = delivery.read(output / receipt)
        delivery.validate_suite(suite, cell["target"], result)
        if suite == "runtime" and sys.platform != "linux":
            # Successful real packaged-window capture is evidence of rendering, not an OS socket query.
            capture = output / "foundation-320.png"
            delivery.require(capture.is_file(), "Missing packaged window capture.")
            displays.append(
                {
                    "backend": cell["backend"],
                    "source": "packaged-window-capture",
                    "case": "graphical-capture",
                    "sha256": delivery.digest(capture),
                }
            )
        suites[suite] = output / receipt
    delivery.require(
        not processes(prepared, identity_history), "Packaged processes remain after shutdown."
    )
    delivery.require(bool(displays), "The actual native display connection was not observed.")
    renderers = [row for row in observations if row["renderer"]]
    delivery.require(
        renderers and all(row["sandbox"] for row in renderers),
        "No successful native renderer sandbox observation.",
    )
    return suites, {
        "samples": observations,
        "display_observations": displays,
        "remaining": [],
        "minimum_poll_delay_ms": 200,
        "limitations": "Samples establish ready renderer OS sandbox and final absence of package executables; they do not measure lifetime resources or physical power loss.",
    }


def retain_failed_reports(source: Path, destination: Path) -> None:
    """Retain normalized bounded JSON reports without adopting fixture links or stores."""
    destination.mkdir()
    issues = []
    for folder in (source, *(source / suite for suite in delivery.SUITES)):
        if not folder.is_dir() or folder.is_symlink() or folder.is_junction():
            continue
        for file in folder.glob("*.json"):
            relative = file.relative_to(source)
            try:
                info = file.lstat()
                delivery.require(
                    stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    "Nonregular or aliased failure report.",
                )
                report = delivery.read(file)
                delivery.write(destination / relative, report)
            except (OSError, ValueError, RecursionError) as error:
                issues.append({"report": relative.as_posix(), "error_type": type(error).__name__})
    if issues:
        delivery.write(destination / "retention-issues.json", {"issues": issues})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cell")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output.absolute()
    try:
        planned = delivery.plan(delivery.identity())
        cell = next(c for c in planned["cells"] if c["id"] == args.cell)
        host = host_matches(cell)
        delivery.require(not output.exists(), "Use a fresh native evidence destination.")
        output.mkdir(parents=True)
        result = {
            "version": 1,
            "status": "failed",
            "cell": cell,
            "plan": planned,
            "host": host,
            "packages": {},
        }
        if sys.platform == "linux":
            package_command = (
                ["rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n"]
                if cell["profile"] == "fedora-44"
                else ["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\n"]
            )
            (output / "native-os-packages.txt").write_text(command(package_command, capture=True))
        delivery.write(output / "result.json", result)
        work = ROOT / "artifacts" / f"quality-{args.cell}"
        work.mkdir()
        assembled = work / "assembled"
        desktop_runtime.assemble(cell["target"], assembled)
        config = configuration(cell, assembled, work / "packages", planned["application_version"])
        delivery.write(work / "builder.json", config)
        command([workspace.node_path(), "tooling/quality-package.mjs", work / "builder.json"])
        context = work / "context.json"
        command([workspace.node_path(), "tooling/quality-profile.mjs", "prepare", context])
        profile = Path(delivery.read(context)["profile"])
        for kind in cell["formats"]:
            extension = "exe" if kind == "nsis" else kind
            package = next((work / "packages").glob(f"*.{extension}"))
            copied = output / package.name
            shutil.copyfile(package, copied)
            payload = unpack_package(package, kind, work / f"installed-{kind}")
            prepared = prepared_record(payload, cell)
            if kind in {"deb", "rpm"}:
                delivery.write(work / "prepared.json", prepared)
                command(
                    [
                        "sudo",
                        "install",
                        "-m",
                        "0644",
                        work / "prepared.json",
                        payload / "prepared.json",
                    ]
                )
            else:
                delivery.write(payload / "prepared.json", prepared)
            evidence = Path(delivery.read(profile)["scratch_root"]) / f"evidence-{kind}"
            evidence.mkdir()
            try:
                suites, native = smoke(profile, payload, evidence, cell)
            except Exception:
                try:
                    retain_failed_reports(evidence, output / f"{kind}-evidence")
                except Exception as error:
                    print(f"Failed suite reports could not be retained: {error}", file=sys.stderr)
                raise
            shutil.copytree(evidence, output / f"{kind}-evidence")
            native.update(
                {
                    "upstream_addon_sha256": delivery.read(ROOT / "config/desktop/toolchain.json")[
                        "tools"
                    ]["better-sqlite3"]["artifacts"][cell["target"]]["sha256"],
                    "packaged_addon_sha256": delivery.digest(
                        payload / prepared["app"] / "native/binding.node"
                    ),
                    "prepared_sha256": delivery.digest(payload / "prepared.json"),
                    "plan": planned,
                    "cell": cell,
                    "package": delivery.artifact(copied, output),
                    "prepared": prepared,
                }
            )
            native_file = output / f"{kind}-native.json"
            delivery.write(native_file, native)
            attached = {}
            for name, file in suites.items():
                target = output / f"{kind}-{name}.json"
                shutil.copyfile(file, target)
                attached[name] = delivery.artifact(target, output)
            runtime_report = delivery.read(suites["runtime"])
            runtime_identity = next(
                case["observed"]
                for case in runtime_report["cases"]
                if case["id"] == "native-executable-identities"
            )
            arch = cell["target"].split("-")[1]
            delivery.require(
                runtime_identity["architecture"] == arch
                and runtime_identity["platform"] == cell["target"].split("-")[0],
                "Actual packaged process has the wrong OS/CPU.",
            )
            result["packages"][kind] = {
                "artifact": delivery.artifact(copied, output),
                "application_version": planned["application_version"],
                "suites": attached,
                "native": {
                    "execution": "native",
                    "emulated": False,
                    "target": cell["target"],
                    "profile": cell["profile"],
                    "backend": cell["backend"],
                    "filesystem": cell["filesystem"],
                    "host_arch": arch,
                    "process_arch": runtime_identity["architecture"],
                    "addon_arch": arch,
                    "sandbox_observed": True,
                    "tree_cessation": True,
                    "stable_preserved": True,
                    "evidence": delivery.artifact(native_file, output),
                },
            }
            delivery.write(output / "result.json", result)
            command([workspace.node_path(), "tooling/quality-profile.mjs", "retain", context])
            if kind == "deb":
                command(["sudo", "dpkg", "--remove", "ohtia-quality"])
            elif kind == "rpm":
                command(["sudo", "rpm", "--erase", "ohtia-quality"])
        delivery.require(
            delivery.plan(delivery.identity()) == planned,
            "Build changed its source or locked inputs.",
        )
        result["status"] = "passed"
        delivery.write(output / "result.json", result)
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        StopIteration,
        subprocess.SubprocessError,
    ) as error:
        print(f"Native quality delivery failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
