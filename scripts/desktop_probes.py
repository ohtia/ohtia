"""Assemble and run non-shipping native probes only after manual profile admission."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid
import zipfile
from pathlib import Path

import desktop_contract
import workspace
from probe_process import run_owned

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "tools/desktop-probes"
SENTINEL = ".ohtia-native-probe-sentinel"
ROLES = {"configuration", "store", "recovery"}
SCENARIOS = {"journey", "ipc", "utility-crash", "playwright"}
# Every case needs observations on the actual native profile, not a boolean from a mock.
MANUAL_CASES = {
    "native-host-and-dependencies",
    "native-display-backend-observed",
    "renderer-sandbox-os-observed",
    "playwright-electron-control",
    "packaged-csp",
    "navigation-denied",
    "privileged-import-denied",
    "ipc-spoofed-frame",
    "ipc-invalid-oversized",
    "wrong-runtime-abi",
    "wrong-addon-architecture",
    "unavailable-addon",
    "native-artifact-replaced",
    "engine-source-mismatch",
    "sandbox-denied",
    "denied-io",
    "fixed-locator-alias",
    "settings-data-overlap",
    "atomic-replacement-interrupted",
    "filesystem-locking",
    "filesystem-durability",
    "disk-full",
    "utility-crash",
    "tree-cessation",
    "resource-budget",
    "altered-lock",
    "stable-profile-sentinel",
    "installer-updater-feasibility",
    "setup-budget",
}


SCENARIO_CASES = {
    "ipc-spoofed-frame": "ipc",
    "ipc-invalid-oversized": "ipc",
    "navigation-denied": "ipc",
    "privileged-import-denied": "ipc",
    "utility-crash": "utility-crash",
    "playwright-electron-control": "playwright",
}


class ProbeError(Exception):
    """A failed prerequisite or observation leaves the profile unqualified."""


def read_json(file: Path) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ProbeError("Duplicate JSON key.")
            result[key] = value
        return result

    try:
        value = json.loads(file.read_text(encoding="utf-8"), object_pairs_hook=unique)
    except RecursionError:
        raise ProbeError("JSON nesting exceeds the decoder's supported structure.") from None
    if not isinstance(value, dict):
        raise ProbeError("Expected a JSON object.")
    return value


def digest(file: Path) -> str:
    return workspace.digest(file)


def same_or_inside(left: Path, right: Path) -> bool:
    return left == right or left.is_relative_to(right) or right.is_relative_to(left)


def real_directory(raw: str, *, owned: bool = True) -> Path:
    path = Path(raw)
    if not path.is_absolute() or not path.is_dir() or path.resolve() != path:
        raise ProbeError("Use existing absolute directories without aliases or symlinks.")
    for item in (path, *path.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ProbeError("Symlinks and Windows reparse points are not admitted.")
    if owned and hasattr(os, "getuid") and path.stat().st_uid != os.getuid():
        raise ProbeError("Qualification roots must belong to the independent account.")
    if owned and os.name != "nt" and path.stat().st_mode & 0o022:
        raise ProbeError("Qualification roots must not be writable by other accounts.")
    return path


def account_home() -> Path:
    """Read the native account profile independently of an inherited HOME override."""
    if os.name == "nt":
        import ctypes

        buffer = ctypes.create_unicode_buffer(32768)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x28, None, 0, buffer) != 0:
            raise ProbeError("Cannot determine the native account profile.")
        return Path(buffer.value).resolve()
    import pwd

    return Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()


def is_elevated() -> bool:
    if os.name != "nt":
        return os.geteuid() == 0
    import ctypes as c
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    security = c.WinDLL("advapi32", use_last_error=True)
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    security.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
    security.GetTokenInformation.argtypes = [
        w.HANDLE,
        c.c_int,
        c.c_void_p,
        w.DWORD,
        c.POINTER(w.DWORD),
    ]
    token, elevated, size = w.HANDLE(), w.DWORD(), w.DWORD()
    if not security.OpenProcessToken(kernel.GetCurrentProcess(), 8, c.byref(token)):
        raise ProbeError("Cannot inspect the native account token.")
    try:
        if not security.GetTokenInformation(
            token, 20, c.byref(elevated), c.sizeof(elevated), c.byref(size)
        ):
            raise ProbeError("Cannot inspect native token elevation.")
        return bool(elevated.value)
    finally:
        kernel.CloseHandle(token)


def profile_cells(*, required_only: bool = False) -> list[tuple[str, str, str]]:
    """Enumerate admitted native cells, or only the explicitly required qualification set."""
    record = read_json(ROOT / "config/desktop/targets.json")
    try:
        desktop_contract.check_targets(record)
    except desktop_contract.ContractError as exc:
        raise ProbeError("Invalid native qualification target contract.") from exc
    cells = []
    for target in record["targets"]:
        if required_only and not target["native_required"]:
            continue
        if target["os"] == "linux":
            for profile in target["distribution_profiles"]:
                for backend in profile["display_backends"]:
                    cells.append((target["id"], profile["id"], backend))
        elif target["os"] == "darwin":
            for major in (
                target["required_os_majors"] if required_only else target["admitted_os_majors"]
            ):
                cells.append((target["id"], f"macos-{major}", "windowserver"))
        else:
            cells.append((target["id"], "windows-11", "desktop"))
    return cells


def native_arguments(target: str) -> list[str]:
    rows = read_json(ROOT / "config/desktop/targets.json")["targets"]
    row = next((row for row in rows if row["id"] == target), None)
    if row is None or row.get("runtime_arguments", []) != []:
        raise ProbeError("Native launch requires the reviewed empty runtime argument policy.")
    return []


def validate_declaration(data: dict) -> None:
    """Validate portable declaration content without re-admitting a foreign host."""
    required = {
        "schema_version",
        "kind",
        "inspected_by",
        "native",
        "fixtures",
        "target",
        "profile",
        "backend",
        "home",
        "configuration_root",
        "research_root",
        "scratch_root",
        "stable_roots",
        "manual_checks",
        "host_evidence",
        "hardware",
        "network",
    }
    if (
        set(data) != required
        or type(data["schema_version"]) is not int
        or data["schema_version"] != 1
    ):
        raise ProbeError("Admission keys or schema version differ from the probe contract.")
    if (
        data["kind"] != "independent-native-profile"
        or data["native"] is not True
        or data["fixtures"] != "synthetic-or-permitted-public"
        or not re.fullmatch(r"(?:human|agent):[A-Za-z0-9-]+", data["inspected_by"])
    ):
        raise ProbeError("A manually verified independent native profile is mandatory.")
    checks = {
        "independent_account_or_vm",
        "no_emulation",
        "local_owned_unsynchronized_volumes",
        "no_credentials",
        "stable_roots_complete",
        "native_security_and_display",
    }
    if (
        not isinstance(data["manual_checks"], dict)
        or set(data["manual_checks"]) != checks
        or any(value is not True for value in data["manual_checks"].values())
    ):
        raise ProbeError("Manual native isolation checks are missing or unverified.")
    for field in ("hardware", "network"):
        if not isinstance(data[field], dict) or not data[field]:
            raise ProbeError("Record actual hardware, cache and network conditions.")
    if not isinstance(data["stable_roots"], dict) or set(data["stable_roots"]) != ROLES:
        raise ProbeError("Supply all stable configuration, store and recovery sentinels.")


def admission(file: Path) -> dict:
    """Validate an operator's prior manual inspection; never manufacture its attestation."""
    data = read_json(file)
    validate_declaration(data)
    if is_elevated():
        raise ProbeError("Never launch native probes with an elevated account token.")
    if data["target"] != workspace.target_id():
        raise ProbeError("Host CPU/OS differs from the admitted native target.")
    if (data["target"], data["profile"], data["backend"]) not in profile_cells():
        raise ProbeError("The native profile/backend is outside the selected target contract.")
    home = real_directory(data["home"])
    if home != account_home() or home != Path.home().resolve():
        raise ProbeError(
            "Log into the admitted independent account; changing HOME is insufficient."
        )
    config = real_directory(data["configuration_root"])
    expected_config = {
        "linux": Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config"))),
        "darwin": home / "Library/Application Support",
        "win32": Path(os.environ.get("APPDATA", str(home / "AppData/Roaming"))),
    }[sys.platform]
    if config != expected_config or not config.is_relative_to(home):
        raise ProbeError("Use the independent account's fixed native configuration root.")
    roots = [config, real_directory(data["research_root"]), real_directory(data["scratch_root"])]
    if any(same_or_inside(a, b) for i, a in enumerate(roots) for b in roots[i + 1 :]):
        raise ProbeError("Configuration, research and scratch roots must be disjoint.")
    if any(same_or_inside(root, ROOT) for root in roots):
        raise ProbeError("Probe data and repository roots must be disjoint.")
    stable = data["stable_roots"]
    if not isinstance(stable, dict) or set(stable) != ROLES:
        raise ProbeError("Supply all stable configuration, store and recovery sentinels.")
    for record in stable.values():
        if set(record) != {"root", "sentinel_sha256"}:
            raise ProbeError("Invalid stable sentinel declaration.")
        stable_root = real_directory(record["root"], owned=False)
        if same_or_inside(stable_root, home) or any(
            same_or_inside(stable_root, root) for root in [ROOT, *roots]
        ):
            raise ProbeError("Independent execution overlaps a stable profile.")
        marker = stable_root / SENTINEL
        if (
            marker.is_symlink()
            or not marker.is_file()
            or digest(marker) != record["sentinel_sha256"]
        ):
            raise ProbeError("Stable sentinel missing, aliased or changed; refuse execution.")
    attachment(file.parent, data["host_evidence"])
    return data


def attachment(directory: Path, record: dict) -> None:
    if set(record) != {"file", "sha256"} or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
        raise ProbeError("Evidence needs a relative file and its SHA-256.")
    file = directory / record["file"]
    if Path(record["file"]).is_absolute() or not file.resolve().is_relative_to(directory.resolve()):
        raise ProbeError("Evidence attachment escapes its record directory.")
    if not file.is_file() or file.is_symlink() or digest(file) != record["sha256"]:
        raise ProbeError("Missing or altered evidence attachment.")


def source_inputs() -> dict[str, str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return {
        name: digest(ROOT / name)
        for name in sorted(set(result.stdout.decode().split("\0")) - {""})
        if (ROOT / name).is_file()
    }


def binary_arch(file: Path) -> str:
    """Read the actual ELF, PE or thin Mach-O machine header, never its filename."""
    with file.open("rb") as stream:
        header = stream.read(64)
        if header[:4] == b"\x7fELF" and len(header) >= 20 and header[4] == 2:
            endian = "little" if header[5] == 1 else "big"
            machine = int.from_bytes(header[18:20], endian)
            return {62: "x64", 183: "arm64"}.get(machine, "unsupported")
        if header[:2] == b"MZ" and len(header) == 64:
            stream.seek(int.from_bytes(header[60:64], "little"))
            pe = stream.read(6)
            if pe[:4] == b"PE\0\0":
                return {0x8664: "x64", 0xAA64: "arm64"}.get(
                    int.from_bytes(pe[4:6], "little"), "unsupported"
                )
        if header[:4] == b"\xcf\xfa\xed\xfe":
            return {0x1000007: "x64", 0x100000C: "arm64"}.get(
                int.from_bytes(header[4:8], "little"), "unsupported"
            )
    raise ProbeError(
        "Unsupported, malformed or universal native artifact; inspect each native slice."
    )


def extract_runtime(archive: Path, destination: Path) -> None:
    """Preserve internal macOS framework symlinks without allowing archive escape."""
    with zipfile.ZipFile(archive) as zipped:
        links = []
        seen = set()
        for entry in zipped.infolist():
            name = entry.filename
            output = destination / name
            if (
                name in seen
                or "\\" in name
                or Path(name).is_absolute()
                or ".." in Path(name).parts
                or ":" in name
            ):
                raise ProbeError("Unsafe runtime ZIP member.")
            seen.add(name)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                links.append((output, zipped.read(entry).decode("utf-8")))
            elif entry.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with output.open("xb") as stream:
                    stream.write(zipped.read(entry))
                if mode & 0o111:
                    output.chmod(0o755)
        for output, target in links:
            if Path(target).is_absolute() or not (output.parent / target).resolve().is_relative_to(
                destination
            ):
                raise ProbeError("Runtime symlink escapes the artifact.")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.symlink_to(target)
        if any(not output.resolve().is_relative_to(destination) for output, _ in links):
            raise ProbeError("Runtime symlink chain escapes the artifact.")


def inventory(directory: Path) -> dict[str, str]:
    return {
        str(file.relative_to(directory)).replace(os.sep, "/"): "symlink:" + os.readlink(file)
        if file.is_symlink()
        else f"file:{stat.S_IMODE(file.stat().st_mode):o}:{digest(file)}"
        for file in sorted(directory.rglob("*"))
        if file.is_file() or file.is_symlink()
    }


def object_digest(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def expected_inputs(target: str, scenario: str = "journey") -> dict:
    if scenario not in SCENARIOS:
        raise ProbeError("Select a declared native qualification scenario.")
    tools = read_json(ROOT / "config/desktop/toolchain.json")["tools"]
    policy = read_json(ROOT / "config/desktop/resource-policy.json")["budgets"]
    source = (PACKAGE / "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c").read_text(
        encoding="utf-8"
    )
    version = re.search(r'#define SQLITE_VERSION\s+"([^"]+)"', source)
    identity = re.search(r'#define SQLITE_SOURCE_ID\s+"([^"]+)"', source)
    if version is None or identity is None:
        raise ProbeError("Locked SQLite source identity is unavailable.")
    if version[1] != tools["sqlite"]["version"] or identity[1] != tools["sqlite"]["source_id"]:
        raise ProbeError("Binding SQLite source differs from the adopting engine manifest.")
    return {
        "target": target,
        "addonSha256": tools["better-sqlite3"]["artifacts"][target]["sha256"],
        "sqliteVersion": version[1],
        "sqliteSourceId": identity[1],
        "requiredOptions": [
            "ENABLE_FTS5",
            "ENABLE_RTREE",
            "ENABLE_COLUMN_METADATA",
            "THREADSAFE=2",
        ],
        "runtime": {
            "electron": tools["electron"]["version"],
            **tools["electron"]["embedded_runtime_metadata"],
        },
        "busyMs": policy["sqlite_busy_ms"]["value"],
        "deadlineMs": policy["measurement_window_ms"]["value"],
        "scenario": scenario,
        "messageBytes": policy["message_bytes"]["value"],
        "stringBytes": policy["string_bytes"]["value"],
    }


def bundle(target: str, attempt: Path, scenario: str = "journey") -> Path:
    """Prepare exact native bytes without executing them or asserting native compatibility."""
    if target not in {cell[0] for cell in profile_cells()}:
        raise ProbeError("Select one of the six declared native targets.")
    if scenario not in SCENARIOS:
        raise ProbeError("Select a declared native qualification scenario.")
    inputs = source_inputs()
    attempt.mkdir(parents=True, mode=0o700)
    try:
        tools = read_json(ROOT / "config/desktop/toolchain.json")["tools"]
        runtime_archive = attempt / "electron.zip"
        workspace.download(tools["electron"]["artifacts"][target], runtime_archive)
        runtime = attempt / "runtime"
        runtime.mkdir()
        extract_runtime(runtime_archive, runtime)
        if target.startswith("darwin-"):
            resources = runtime / "Electron.app/Contents/Resources"
            executable = runtime / "Electron.app/Contents/MacOS/Electron"
        else:
            resources = runtime / "resources"
            executable = runtime / ("electron.exe" if target.startswith("win32-") else "electron")
        app_root = resources / "app"
        app_root.mkdir()
        for directory in ("dist", "assets"):
            shutil.copytree(PACKAGE / directory, app_root / directory)
        sqlite = (PACKAGE / "node_modules/better-sqlite3").resolve(strict=True)
        shutil.copytree(
            sqlite,
            app_root / "node_modules/better-sqlite3",
            ignore=shutil.ignore_patterns("node_modules"),
        )
        # The default entry's trusted nativeBinding route uses no bindings locator.
        native = app_root / "native/binding.node"
        native.parent.mkdir()
        addon_record = tools["better-sqlite3"]["artifacts"][target]
        source_addon = sqlite / addon_record["path"].removeprefix("package/")
        if digest(source_addon) != addon_record["sha256"]:
            raise ProbeError("Installed addon differs from the reviewed prebuild.")
        shutil.copyfile(source_addon, native)
        expected_arch = target.rsplit("-", 1)[1]
        if binary_arch(native) != expected_arch or binary_arch(executable) != expected_arch:
            raise ProbeError("Actual executable/addon header architecture mismatch.")
        expected = expected_inputs(target, scenario)
        write_json(app_root / "expected.json", expected)
        write_json(
            app_root / "package.json",
            {
                "name": "ohtia-native-qualification",
                "version": "0.0.0",
                "type": "module",
                "main": "dist/main.js",
            },
        )
        write_json(
            attempt / "prepared.json",
            {
                "schema_version": 1,
                "qualified": False,
                "inputs": inputs,
                "target": target,
                "executable": executable.relative_to(attempt).as_posix(),
                "runtime_archive_sha256": digest(runtime_archive),
                "runtime_inventory": inventory(runtime),
                "expected": expected,
            },
        )
        return attempt
    finally:
        if source_inputs() != inputs:
            raise ProbeError("Inputs or locks changed during preparation; discard this candidate.")


def prepare(admission_file: Path, scenario: str = "journey") -> Path:
    data = admission(admission_file)
    admission_before = digest(admission_file)
    attempt = Path(data["scratch_root"]) / f"attempt-{uuid.uuid4()}"
    try:
        bundle(data["target"], attempt, scenario)
        shutil.copyfile(admission_file, attempt / "admission.json")
        shutil.copyfile(
            admission_file.parent / data["host_evidence"]["file"], attempt / "host-evidence.bin"
        )
    finally:
        admission(admission_file)
    if (
        digest(admission_file) != admission_before
        or digest(attempt / "admission.json") != admission_before
    ):
        raise ProbeError("Admission changed during preparation; the attempt is not admitted.")
    # A failed post-check must never leave a runnable admission marker.
    write_json(
        attempt / "admitted.json",
        {
            "attempt_id": attempt.name,
            "admission_sha256": admission_before,
            "prepared_sha256": digest(attempt / "prepared.json"),
            "target": data["target"],
            "profile": data["profile"],
            "backend": data["backend"],
        },
    )
    return attempt


def write_json(file: Path, data: dict) -> None:
    with file.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")


def run(admission_file: Path, attempt: Path) -> None:
    data = admission(admission_file)
    if (
        data["target"].startswith("linux-")
        and os.environ.get("XDG_SESSION_TYPE") != data["backend"]
    ):
        raise ProbeError("Linux login session differs from the admitted display backend.")
    if attempt.resolve().parent != Path(data["scratch_root"]):
        raise ProbeError("Run only a prepared attempt in the admitted scratch directory.")
    prepared = read_json(attempt / "prepared.json")
    admitted = read_json(attempt / "admitted.json")
    prepared_before = digest(attempt / "prepared.json")
    admitted_before = digest(attempt / "admitted.json")
    if (
        admitted["attempt_id"] != attempt.name
        or admitted["admission_sha256"] != digest(admission_file)
        or admitted["prepared_sha256"] != prepared_before
        or prepared["inputs"] != source_inputs()
        or prepared["target"] != data["target"]
    ):
        raise ProbeError("Admission, source or locks changed since preparation.")
    runtime = attempt / "runtime"
    if inventory(runtime) != prepared["runtime_inventory"]:
        raise ProbeError("Prepared native runtime replaced or altered.")
    output = attempt / "observations"
    output.mkdir(mode=0o700)
    # Preserve the admitted login's display/session, never developer credentials or Node hooks.
    allowed = {
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "PATH",
        "XDG_CONFIG_HOME",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_DESKTOP",
        "DESKTOP_SESSION",
        "XDG_DATA_DIRS",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "DBUS_SESSION_BUS_ADDRESS",
        "XAUTHORITY",
        "LANG",
        "LC_ALL",
    }
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env["OHTIA_PROBE_RUN"] = str(output)
    start = time.monotonic_ns()
    result = None
    try:
        arguments = native_arguments(data["target"])
        command = [str(attempt / prepared["executable"]), *arguments]
        if prepared["expected"].get("scenario") == "playwright":
            # The pinned SDK pipes early native output through its browser diagnostic logger.
            env["DEBUG"] = "pw:browser"
            command = [
                str(workspace.node_path()),
                str(PACKAGE / "playwright-control.mjs"),
                str(attempt),
                str(output),
                json.dumps(arguments),
            ]
        result = run_owned(
            command,
            attempt,
            env,
            prepared["expected"]["deadlineMs"] / 1000,
            read_json(ROOT / "config/desktop/resource-policy.json")["budgets"][
                "shutdown_termination_ms"
            ]["value"]
            / 1000,
        )
        is_controlled = prepared["expected"].get("scenario") == "playwright"
        result["root_role"] = "playwright-controller" if is_controlled else "native-runtime"
        result["native_runtime_containment"] = (
            "windows-kill-on-close-job"
            if os.name == "nt"
            else None
            if is_controlled
            else "posix-process-group"
        )
        # Playwright creates another POSIX group; this supervisor observes its controller only.
        # Its SDK cleanup does not replace the independent native tree-cessation observation.
        if is_controlled and os.name != "nt":
            result["containment"] = "posix-controller-process-group"
    finally:
        try:
            admission(admission_file)
            sentinels_unchanged = True
        except Exception:
            # Keep the receipt even when mutable post-run admission data has a bad shape.
            sentinels_unchanged = False
        observations_complete = sentinels_unchanged

        def observe_hash(file: Path, *, optional: bool = False) -> str | None:
            nonlocal observations_complete
            try:
                return digest(file)
            except FileNotFoundError:
                if not optional:
                    observations_complete = False
                return None
            except (OSError, ValueError):
                observations_complete = False
                return None

        prepared_after = observe_hash(attempt / "prepared.json")
        admitted_after = observe_hash(attempt / "admitted.json")
        runtime_result = observe_hash(output / "runtime.json")
        control_result = (
            observe_hash(output / "playwright-control.json")
            if prepared["expected"].get("scenario") == "playwright"
            else None
        )
        progress_result = observe_hash(output / "progress.jsonl", optional=True)
        admission_after = observe_hash(admission_file)
        sentinels_unchanged = (
            sentinels_unchanged and admission_after == admitted["admission_sha256"]
        )
        observations_complete = observations_complete and sentinels_unchanged
        observed_inventory = None
        try:
            observed_inputs = source_inputs()
            observed_inventory = inventory(runtime)
            unchanged = (
                prepared["inputs"] == observed_inputs
                and observed_inventory == prepared["runtime_inventory"]
                and prepared_before == prepared_after
                and admitted_before == admitted_after
                and admission_after == admitted["admission_sha256"]
            )
        except (OSError, ValueError, subprocess.SubprocessError):
            observations_complete = False
            unchanged = False
        unchanged = unchanged and observations_complete
        write_json(
            attempt / "execution.json",
            {
                "qualified": False,
                "target": data["target"],
                "attempt_id": admitted["attempt_id"],
                "profile": data["profile"],
                "backend": data["backend"],
                "exit_code": result["exit_code"] if result else None,
                "process_supervision": result,
                "elapsed_ms": (time.monotonic_ns() - start) // 1_000_000,
                "inputs_unchanged": unchanged,
                "stable_sentinels_unchanged": sentinels_unchanged,
                "host_arch": platform.machine(),
                "developer_python": platform.python_version(),
                "remaining_native_cases": sorted(MANUAL_CASES),
                "observations_complete": observations_complete,
                "prepared_before_sha256": prepared_before,
                "admitted_before_sha256": admitted_before,
                "prepared_sha256": prepared_after,
                "admitted_sha256": admitted_after,
                "runtime_result_sha256": runtime_result,
                "playwright_control_sha256": control_result,
                "progress_sha256": progress_result,
                "native_runtime_inventory_sha256": object_digest(observed_inventory)
                if observed_inventory is not None
                else None,
            },
        )
    if (
        result["exit_code"] != 0
        or result["timed_out"]
        or result["contained_processes_remaining_at_exit"]
        or not unchanged
        or not sentinels_unchanged
    ):
        raise ProbeError("Native execution failed or inputs changed; target remains unqualified.")


def checked_native_record(directory: Path, scenario: str) -> tuple[dict, dict, dict, dict]:
    """Bind one native scenario's identities, exit semantics and actual observations."""
    prepared = read_json(directory / "prepared.json")
    admitted = read_json(directory / "admitted.json")
    declaration = read_json(directory / "admission.json")
    validate_declaration(declaration)
    execution = read_json(directory / "execution.json")
    observed = read_json(directory / "observations/runtime.json")
    if prepared["inputs"] != source_inputs():
        raise ProbeError("Record was not produced on the actual consumer inputs.")
    if (
        admitted["prepared_sha256"] != digest(directory / "prepared.json")
        or execution["prepared_sha256"] != digest(directory / "prepared.json")
        or execution["admitted_sha256"] != digest(directory / "admitted.json")
        or execution["runtime_result_sha256"] != digest(directory / "observations/runtime.json")
        or any(execution[key] != admitted[key] for key in ("target", "profile", "backend"))
        or prepared["target"] != admitted["target"]
        or execution["attempt_id"] != admitted["attempt_id"]
        or admitted["admission_sha256"] != digest(directory / "admission.json")
        or declaration["host_evidence"]["sha256"] != digest(directory / "host-evidence.bin")
        or any(declaration[key] != admitted[key] for key in ("target", "profile", "backend"))
        or execution["native_runtime_inventory_sha256"]
        != object_digest(prepared["runtime_inventory"])
    ):
        raise ProbeError("Evidence identities disagree or changed after execution.")
    if (
        not all(
            execution[key] is True
            for key in (
                "inputs_unchanged",
                "stable_sentinels_unchanged",
                "observations_complete",
            )
        )
        or type(execution["exit_code"]) is not int
        or (execution["exit_code"] == 0) != (scenario != "utility-crash")
        or execution["process_supervision"]["timed_out"] is not False
        or execution["process_supervision"]["contained_processes_remaining_at_exit"] is not False
    ):
        raise ProbeError("Native execution, input or sentinel evidence failed.")
    if scenario == "playwright" and (
        execution["process_supervision"].get("root_role") != "playwright-controller"
        or execution["process_supervision"].get("native_runtime_containment")
        != ("windows-kill-on-close-job" if admitted["target"].startswith("win32-") else None)
        or "native_runtime_containment" not in execution["process_supervision"]
    ):
        raise ProbeError(
            "Playwright supervision must disclose the actual native containment scope."
        )
    if observed.get("utilityExited") is not True:
        raise ProbeError("Utility cessation is unverified.")
    if scenario == "utility-crash":
        if (
            observed.get("ok") is not False
            or observed.get("utilityCrash", {}).get("killAccepted") is not True
            or type(observed.get("utilityExitCode")) is not int
            or "utility" in observed
            or observed.get("failure", {}).get("message") != "Utility failed or omitted its result."
        ):
            raise ProbeError("The controlled utility termination was not observed.")
    elif (
        observed.get("ok") is not True
        or type(observed.get("utilityExitCode")) is not int
        or observed.get("utilityExitCode") != 0
    ):
        raise ProbeError("Runtime/addon observations or successful utility exit failed.")
    expected = expected_inputs(admitted["target"], scenario)
    archive = read_json(ROOT / "config/desktop/toolchain.json")["tools"]["electron"]["artifacts"][
        admitted["target"]
    ]
    if prepared["expected"] != expected or prepared["runtime_archive_sha256"] != archive["sha256"]:
        raise ProbeError("Expected native inputs differ from the adopting manifests.")
    journey = observed.get("initialJourney", {})
    status = journey.get("status", {})
    appearance_before = journey.get("appearanceBefore")
    appearance_after = journey.get("appearanceAfter")
    if (
        observed.get("scenario") != scenario
        or type(journey.get("windows")) is not int
        or journey["windows"] != 1
        or status.get("ready") is not True
        or status.get("target") != admitted["target"]
        or status.get("electron") != expected["runtime"]["electron"]
        or appearance_before not in ("system", "light", "dark")
        or type(journey.get("nativeDarkBefore")) is not bool
        or type(journey.get("rendererDarkBefore")) is not bool
        or journey["rendererDarkBefore"] != journey["nativeDarkBefore"]
        or appearance_after != ("light" if journey["nativeDarkBefore"] else "dark")
        or type(journey.get("rendererDark")) is not bool
        or journey["rendererDark"] != (not journey["nativeDarkBefore"])
    ):
        raise ProbeError("The canonical status/appearance resource journey is missing.")
    if (
        observed.get("target") != admitted["target"]
        or observed.get("preloadIsolation") != {"sandboxed": True, "contextIsolated": True}
        or observed.get("privilegedGlobalsAbsent") is not True
        or not all(
            observed.get(key) is True
            for key in (
                "protocolMethodDenied",
                "resourceRequestCancelled",
                "rendererCspConnectionDenied",
            )
        )
        or any(
            observed.get("versions", {}).get(key) != value
            for key, value in expected["runtime"].items()
        )
    ):
        raise ProbeError("Main runtime, renderer isolation or resource observations disagree.")
    if scenario != "utility-crash":
        utility = observed.get("utility", {}).get("result", {})
        if (
            observed.get("utility", {}).get("ok") is not True
            or utility.get("arch") != admitted["target"].rsplit("-", 1)[1]
            or any(
                utility.get(key) != expected[key]
                for key in ("addonSha256", "sqliteVersion", "sqliteSourceId")
            )
            or any(
                utility.get("versions", {}).get(key) != value
                for key, value in expected["runtime"].items()
            )
            or not set(expected["requiredOptions"]) <= set(utility.get("compileOptions", []))
            or not all(
                utility.get(key) is True
                for key in (
                    "foreignKeys",
                    "constraintRejected",
                    "migrationRollback",
                    "fileBackedReopen",
                    "backup",
                    "competingWriterRejected",
                )
            )
        ):
            raise ProbeError("Packaged utility/addon/SQLite observations disagree.")

    if scenario == "ipc":
        invalid = observed.get("invalidRequests")
        spoofed = observed.get("spoofedSender", {})
        if (
            observed.get("preloadOversizeRejected") is not True
            or observed.get("navigationDenied") is not True
            or observed.get("privilegedImport", {}).get("denied") is not True
            or not isinstance(invalid, list)
            or len(invalid) != 4
            or {item.get("caseId") for item in invalid}
            != {"null", "unknown-operation", "oversized", "unexpected-frame-key"}
            or any(
                item.get("reply") != {"ok": False, "code": "invalid-request"} for item in invalid
            )
            or spoofed.get("sameOrigin") is not True
            or type(spoofed.get("expectedContentsId")) is not int
            or type(spoofed.get("actualContentsId")) is not int
            or spoofed["expectedContentsId"] == spoofed["actualContentsId"]
            or spoofed.get("reply") != {"ok": False, "code": "untrusted-sender"}
        ):
            raise ProbeError("Required native IPC/frame/navigation/import refusals are missing.")
    if scenario == "playwright":
        control_file = directory / "observations/playwright-control.json"
        if execution.get("playwright_control_sha256") != digest(control_file):
            raise ProbeError("The native Playwright control receipt is missing or changed.")
        control = read_json(control_file)
        identity = control.get("identity", {})
        renderer = control.get("renderer", {})
        status = renderer.get("status", {})
        tool = read_json(ROOT / "config/desktop/toolchain.json")["tools"]["@playwright/test"][
            "version"
        ]
        if (
            observed.get("playwrightControlReleased") is not True
            or control.get("ok") is not True
            or control.get("scenario") != "playwright"
            or control.get("target") != admitted["target"]
            or control.get("toolVersion") != tool
            or control.get("coreVersion") != tool
            or not isinstance(control.get("coreBundleSha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", control["coreBundleSha256"])
            or not isinstance(identity.get("processArgv"), list)
            or not all(isinstance(value, str) for value in identity["processArgv"])
            or not all(
                identity.get("switches", {}).get(name) == {"present": False, "value": ""}
                for name in (
                    "no-sandbox",
                    "disable-setuid-sandbox",
                    "disable-web-security",
                )
            )
            or (
                admitted["target"].startswith("linux-")
                and identity.get("switches", {}).get("ozone-platform", {}).get("present") is True
                and identity["switches"]["ozone-platform"].get("value") != admitted["backend"]
            )
            or control.get("controlReleased") is not True
            or control.get("nativeExit") != {"code": 0, "signal": None}
            or control.get("documentUrl") != "ohtia-probe://qualification/index.html"
            or identity.get("ready") is not True
            or identity.get("target") != admitted["target"]
            or any(
                identity.get("versions", {}).get(key) != value
                for key, value in expected["runtime"].items()
            )
            or renderer.get("privilegedGlobalsAbsent") is not True
            or status.get("ok") is not True
            or status.get("value", {}).get("ready") is not True
            or status.get("value", {}).get("target") != admitted["target"]
            or status.get("value", {}).get("electron") != expected["runtime"]["electron"]
        ):
            raise ProbeError(
                "Pinned native Playwright runtime/renderer/control observations disagree."
            )
    return prepared, admitted, execution, observed


def report(records: list[Path]) -> dict:
    """Require every native cell and case; missing evidence can never become a pass."""
    required = set(profile_cells(required_only=True))
    admitted_cells = set(profile_cells())
    passing = set()
    failures = []
    for directory in records:
        try:
            prepared, admitted, execution, observed = checked_native_record(directory, "journey")
            cell = tuple(admitted[key] for key in ("target", "profile", "backend"))
            if cell not in admitted_cells or cell in passing:
                raise ProbeError("Unexpected or duplicate native profile record.")
            cases = read_json(directory / "native-cases.json")
            # Native modes and framework links were checked on the producing OS and bound
            # to its execution receipt. Aggregation does not reinterpret foreign OS modes.
            if set(cases) != {"reviewed_by", "cases", "scenarios"} or not re.fullmatch(
                r"(?:human|agent):[A-Za-z0-9-]+", cases["reviewed_by"]
            ):
                raise ProbeError("Native case evidence requires explicit operator content review.")
            if set(cases["cases"]) != MANUAL_CASES:
                raise ProbeError("Missing mandatory native cases.")
            if set(cases["scenarios"]) != set(SCENARIO_CASES.values()):
                raise ProbeError("Missing native adversarial/control scenario records.")
            scenario_records = {}
            attempt_ids = {admitted["attempt_id"]}
            for scenario, reference in cases["scenarios"].items():
                attachment(directory, reference)
                file = directory / reference["file"]
                if file.name != "execution.json":
                    raise ProbeError(
                        "Reference a complete native scenario record's execution.json."
                    )
                record = checked_native_record(file.parent, scenario)
                if (
                    tuple(record[1][key] for key in ("target", "profile", "backend")) != cell
                    or record[1]["attempt_id"] in attempt_ids
                ):
                    raise ProbeError(
                        "Native supporting scenario scope or attempt identity disagrees."
                    )
                attempt_ids.add(record[1]["attempt_id"])
                scenario_records[scenario] = (file.parent, record)
            for case_id, case in cases["cases"].items():
                if set(case) != {"result", "evidence"} or case["result"] != "pass":
                    raise ProbeError("A mandatory native case did not pass.")
                attachment(directory, case["evidence"])
                observation = read_json(directory / case["evidence"]["file"])
                case_directory, case_record = scenario_records.get(
                    SCENARIO_CASES.get(case_id),
                    (directory, (prepared, admitted, execution, observed)),
                )
                case_prepared = case_record[0]
                if (
                    set(observation)
                    != {
                        "case_id",
                        "target",
                        "profile",
                        "backend",
                        "source_inputs_sha256",
                        "runtime_inventory_sha256",
                        "execution_sha256",
                        "result",
                        "procedure",
                        "expected",
                        "observed",
                        "limitations",
                    }
                    or observation["case_id"] != case_id
                    or any(
                        observation[key] != admitted[key]
                        for key in ("target", "profile", "backend")
                    )
                    or observation["source_inputs_sha256"] != object_digest(case_prepared["inputs"])
                    or observation["runtime_inventory_sha256"]
                    != object_digest(case_prepared["runtime_inventory"])
                    or observation["execution_sha256"] != digest(case_directory / "execution.json")
                    or observation["result"] != "pass"
                    or not all(
                        isinstance(observation[key], str) and observation[key].strip()
                        for key in ("procedure", "expected", "observed", "limitations")
                    )
                ):
                    raise ProbeError(
                        "Native case summary is missing its actual scope or observations."
                    )
            passing.add(cell)
        except (ProbeError, OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            failures.append(
                str(exc)
                if isinstance(exc, ProbeError)
                else "Malformed or unavailable native evidence."
            )
    targets = {cell[0] for cell in admitted_cells}
    qualified = sorted(
        target
        for target in targets
        if (
            {cell for cell in required if cell[0] == target}
            or {cell for cell in admitted_cells if cell[0] == target}
        )
        <= passing
    )
    return {
        "qualified_targets": qualified,
        "complete": required <= passing and not failures,
        "missing_profiles": [list(cell) for cell in sorted(required - passing)],
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "run"):
        command = commands.add_parser(name)
        command.add_argument("admission", type=Path)
        if name == "run":
            command.add_argument("attempt", type=Path)
        else:
            command.add_argument("--scenario", choices=sorted(SCENARIOS), default="journey")
    command = commands.add_parser("report")
    command.add_argument("records", type=Path, nargs="*")
    command = commands.add_parser("bundle")
    command.add_argument("target")
    command.add_argument("destination", type=Path)
    command.add_argument("--scenario", choices=sorted(SCENARIOS), default="journey")
    args = parser.parse_args()
    try:
        if args.command == "bundle":
            print(bundle(args.target, args.destination.resolve(), args.scenario))
        elif args.command == "prepare":
            print(prepare(args.admission.resolve(), args.scenario))
        elif args.command == "run":
            run(args.admission.resolve(), args.attempt.resolve())
        else:
            result = report(args.records)
            print(json.dumps(result, indent=2))
            return 0 if result["complete"] else 1
    except (
        ProbeError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        subprocess.SubprocessError,
        workspace.WorkspaceError,
    ):
        print(
            "Native qualification refused or failed. Check the admission, pinned inputs and documented native prerequisites; no target has been qualified.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
