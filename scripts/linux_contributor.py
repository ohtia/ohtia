"""Prepare and diagnose the declared native Linux contributor environments (Python >=3.12)."""

# Set this before any source-module import so diagnosis also works with a fresh managed interpreter.
# ruff: noqa: E402
import sys

sys.dont_write_bytecode = True

import argparse
import hashlib
import json
import os
import platform
import re
import shlex
import signal
import socket
import stat
import subprocess
import tempfile
import time
import tomllib
from contextlib import contextmanager
from pathlib import Path

import desktop_runtime
import quality_native
import workspace
from probe_process import _signal_anchored_group, group_has_members, run_owned

ROOT = workspace.ROOT
RECEIPT = ROOT / ".tooling/linux-setup.json"
RUNTIME_PARENT = Path("/run/user")
# Reserve pathname bytes for the pinned Electron singleton socket below admitted TMPDIR.
MAX_SCRATCH_BYTES = 60
SESSION_INTERRUPTED = "Native session interrupted. Its owned command, compositor and private bus are stopped with bounded cleanup; retain the scratch log and receipts before retrying."
SCRATCH_REMEDY = "The admitted scratch root exceeds this Linux entry’s 60-byte UTF-8 limit for Electron temporary sockets. Select a shorter canonical owned scratch directory, repeat its independent-profile inspection and retry; do not alias a stable root or redirect application configuration."


class ContributorError(ValueError):
    """A controlled contributor prerequisite or command failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContributorError(message)


def read(file: Path) -> dict:
    return json.loads(file.read_text(encoding="utf-8"))


def native_profile() -> tuple[str, dict, dict]:
    require(
        sys.platform == "linux",
        "Use this entry on native Linux; see docs/developer-workspace.md for other platforms.",
    )
    target = workspace.target_id()
    release = platform.freedesktop_os_release()
    name = f"{release.get('ID')}-{release.get('VERSION_ID')}"
    target_record = next(
        t for t in read(ROOT / "config/desktop/targets.json")["targets"] if t["id"] == target
    )
    profiles = target_record["distribution_profiles"]
    require(
        name in {p["id"] for p in profiles},
        "Unsupported Linux distribution/version. Use a declared Ubuntu, Debian or Fedora profile in config/desktop/targets.json.",
    )
    if name == "fedora-44":
        require(
            release.get("VARIANT_ID") == "workstation",
            "Use Fedora 44 Workstation with GNOME; another Fedora edition is not a qualified route.",
        )
    profile = next(p for p in profiles if p["id"] == name)
    packages = read(ROOT / "config/desktop/linux-contributor.json")["profiles"][name]
    return target, profile, packages


def observe(command: list[str | Path]) -> subprocess.CompletedProcess[str]:
    """Capture tool output privately; callers expose only controlled result fields."""
    return subprocess.run(
        [str(part) for part in command],
        cwd=ROOT,
        env=quality_native.build_environment(),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def package_commands(packages: dict) -> list[list[str]]:
    if packages["manager"] == "apt-get":
        return [
            ["sudo", "apt-get", "update"],
            [
                "sudo",
                "apt-get",
                "install",
                "--no-install-recommends",
                "--no-upgrade",
                *packages["packages"],
            ],
        ]
    return [
        [
            "sudo",
            "dnf",
            "--repo=fedora",
            "--repo=updates",
            "--setopt=gpgcheck=True",
            "install",
            "--setopt=install_weak_deps=False",
            *packages["packages"],
        ]
    ]


def prerequisites(packages: dict, *, install: bool) -> None:
    print(
        "OS packages come from the distribution's configured signed vendor repositories. Inspect repository trust before consenting; this entry never adds a repository."
    )
    for source in packages["sources"]:
        print(f"Package catalog: {source}")
    commands = package_commands(packages)
    for command in commands:
        print(shlex.join(command), flush=True)
    if not install:
        print(
            "Review the package-manager transaction; rerun prerequisites --install to consent. No packages were installed."
        )
        return
    require(
        os.getuid() != 0,
        "Run as the ordinary contributor account. Only the displayed OS-package commands use sudo.",
    )
    for command in commands:
        result = subprocess.run(command, cwd=ROOT, check=False)
        require(
            result.returncode == 0,
            "OS package installation failed or was declined. Restore vendor repository/network access and rerun prerequisites --install; do not change sandbox policy.",
        )


def input_hashes() -> dict[str, str]:
    files = [
        "pnpm-lock.yaml",
        "uv.lock",
        "package.json",
        "pyproject.toml",
        "pnpm-workspace.yaml",
        ".npmrc",
        "config/desktop/toolchain.json",
        "config/desktop/targets.json",
        "config/desktop/linux-contributor.json",
    ]
    files += [
        p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "packages").glob("*/package.json"))
    ]
    files += ["tools/desktop-probes/package.json"]
    return {name: workspace.digest(ROOT / name) for name in files}


def checkout_environment() -> bool:
    return all(
        not (ROOT / name).is_symlink() and (ROOT / name).resolve() == ROOT / name
        for name in (".tooling", ".venv", ".cache", "node_modules")
    )


def inspect_context(runtime_profile: Path, runtime: Path | None = None, *, cancelled=None) -> dict:
    try:
        ensure_session_active(cancelled)
        require(
            runtime_profile.is_absolute() and (runtime is None or runtime.is_absolute()),
            "Use absolute native profile and prepared-runtime paths.",
        )
        command = [
            workspace.node_path(),
            "tooling/linux-doctor.mjs",
            "--context",
            str(runtime_profile),
        ]
        if runtime is not None:
            command.append(str(runtime))
        result = observe(command)
        ensure_session_active(cancelled)
        require(
            result.returncode == 0,
            "Isolation/runtime admission failed. Build first, then inspect doctor --profile --runtime before retrying.",
        )
        return json.loads(result.stdout)

    except Exception:
        ensure_session_active(cancelled)
        raise


def setup() -> None:
    require(
        os.getuid() != 0,
        "Run setup under the ordinary independent contributor account, never root.",
    )
    require(
        checkout_environment(),
        "Use real checkout-local .tooling, .venv, .cache and node_modules directories; preserve and unlink foreign directory aliases before setup.",
    )
    inputs = input_hashes()
    with workspace.setup_lock():
        RECEIPT.unlink(missing_ok=True)
        workspace.setup()
        require(
            input_hashes() == inputs,
            "Setup inputs changed; inspect the diff and repeat setup without rewriting locks.",
        )
        temporary = RECEIPT.with_suffix(".partial")
        temporary.write_text(
            json.dumps({"version": 1, "target": workspace.target_id(), "inputs": inputs}, indent=2)
            + "\n",
            encoding="utf-8",
        )
        temporary.replace(RECEIPT)


def python_tools_match() -> bool:
    groups = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))[
        "dependency-groups"
    ]["dev"]
    expected = dict(entry.split("==") for entry in groups)
    code = (
        "import importlib.metadata as m,json;print(json.dumps({n:m.version(n) for n in "
        + repr(list(expected))
        + "}))"
    )
    result = observe([ROOT / ".venv/bin/python", "-B", "-c", code])
    return result.returncode == 0 and json.loads(result.stdout) == expected


def doctor(
    profile: dict,
    packages: dict,
    runtime_profile: Path | None,
    runtime: Path | None,
    *,
    cancelled=None,
) -> dict:
    checks = []

    def check(code: str, action, remedy: str) -> None:
        ensure_session_active(cancelled)
        try:
            passed = bool(action())
        except (
            OSError,
            ValueError,
            TypeError,
            AttributeError,
            KeyError,
            StopIteration,
            subprocess.SubprocessError,
            workspace.WorkspaceError,
        ):
            passed = False
        checks.append({"check": code, "passed": passed, **({} if passed else {"remedy": remedy})})

    check(
        "ordinary-account",
        lambda: os.getuid() != 0,
        "Log into the inspected independent ordinary account; do not run Electron or setup as root.",
    )
    check(
        "checkout-environment",
        checkout_environment,
        "Use checkout-local environment directories; preserve and unlink foreign cache/tool aliases before repeating setup.",
    )
    check(
        "bootstrap-python",
        lambda: sys.version_info >= (3, 12),
        "Install the vendor's native Python 3.12 or later before running this entry.",
    )
    check(
        "checkout-permissions",
        lambda: os.access(ROOT, os.R_OK | os.W_OK | os.X_OK) and ROOT.stat().st_uid == os.getuid(),
        "Use a contributor-owned local checkout; repair only that checkout's ownership and permissions.",
    )
    check(
        "checkout-filesystem",
        lambda: (
            observe(["findmnt", "-n", "-o", "FSTYPE", "-T", ROOT]).stdout.strip()
            in profile["filesystems"]
        ),
        "Place the checkout on this profile's declared ext4 or Btrfs filesystem; synchronized/network directories are excluded.",
    )
    check(
        "glibc",
        lambda: (
            platform.libc_ver()[0] == "glibc"
            and tuple(map(int, platform.libc_ver()[1].split(".")))
            >= tuple(map(int, profile["libc_minimum"].split(".")))
        ),
        "Use the declared distribution's native glibc; musl and older libc routes are unsupported.",
    )
    for name in packages["packages"]:

        def installed(name=name):
            if packages["manager"] == "apt-get":
                result = observe(["dpkg-query", "-W", "-f=${db:Status-Status}", name])
                return result.returncode == 0 and result.stdout == "installed"
            return observe(["rpm", "-q", name]).returncode == 0

        check(
            f"package:{name}",
            installed,
            "Review prerequisites, then run prerequisites --install and repeat doctor.",
        )
    check(
        "native-compiler",
        lambda: (
            observe(["c++", "-dumpmachine"])
            .stdout.strip()
            .startswith("x86_64-" if workspace.target_id() == "linux-x64" else "aarch64-")
        ),
        "Install the profile's compiler/header packages for the actual native CPU; no cross compiler substitutes for native execution.",
    )
    check(
        "user-namespaces",
        lambda: int(Path("/proc/sys/user/max_user_namespaces").read_text()) > 0,
        "Have the host administrator restore the qualified distribution's user-namespace policy; never pass --no-sandbox.",
    )
    if profile["id"] == "debian-13":
        check(
            "debian-unprivileged-userns",
            lambda: Path("/proc/sys/kernel/unprivileged_userns_clone").read_text().strip() == "1",
            "The Debian kernel has disabled unprivileged user namespaces. Have the administrator restore the qualified vendor policy, then repeat doctor; never disable the Chromium sandbox.",
        )
    if profile["id"] == "fedora-44":
        check(
            "selinux",
            lambda: observe(["getenforce"]).stdout.strip() == "Enforcing",
            "Use Fedora Workstation with enforcing SELinux; inspect targeted denials without setting permissive mode.",
        )
    else:
        check(
            "apparmor",
            lambda: Path("/sys/module/apparmor/parameters/enabled").read_text().strip() == "Y",
            "Use the declared enabled AppArmor configuration. Ubuntu additionally needs an executable-specific userns allowance before Electron launch; see the guide.",
        )
    check(
        "display-session",
        lambda: display_available(profile),
        "Use this profile's native GNOME Wayland session (Ubuntu 24.04 also admits X11). Start the private session described in docs/linux-contribution.md for automated runs; SSH alone supplies no display.",
    )
    for name, executable, prefix in (
        ("node", workspace.node_path(), "v"),
        ("pnpm", workspace.TOOLS / "pnpm/pnpm-native", ""),
        ("uv", workspace.uv_path(), "uv "),
        ("python", workspace.python_path(), "Python "),
    ):

        def pinned(name=name, executable=executable, prefix=prefix):
            result = observe([executable, "--version"])
            return (
                result.returncode == 0
                and result.stdout.split()[
                    : len((prefix + workspace.tool_records()[name]["version"]).split())
                ]
                == (prefix + workspace.tool_records()[name]["version"]).split()
            )

        check(
            f"tool:{name}",
            pinned,
            "Run setup in this checkout. For a wrong or damaged tool remove only its named .tooling subdirectory and repeat setup; never upgrade global tools.",
        )
    check(
        "node-native-cpu",
        lambda: (
            observe(
                [workspace.node_path(), "-p", "process.platform + '-' + process.arch"]
            ).stdout.strip()
            == workspace.target_id()
        ),
        "Reinstall this checkout's pinned native Node; emulated execution cannot qualify a target.",
    )
    check(
        "frozen-inputs",
        lambda: (
            read(RECEIPT)
            == {"version": 1, "target": workspace.target_id(), "inputs": input_hashes()}
        ),
        "Run this entry's setup after restoring the reviewed manifests and locks; setup must pass without changing locks.",
    )
    check(
        "installed-package-pins",
        lambda: observe([workspace.node_path(), "tooling/workspace.mjs", "doctor"]).returncode == 0,
        "Repeat frozen setup; do not regenerate locks to repair stale installed dependencies.",
    )
    check(
        "python-tool-pins",
        python_tools_match,
        "Repeat frozen setup to restore the pinned pre-commit, Ruff and Pyrefly packages in this checkout's virtual environment.",
    )
    if runtime_profile is not None:
        admitted_context = None

        def inspect_runtime():
            nonlocal admitted_context
            admitted_context = inspect_context(runtime_profile, runtime, cancelled=cancelled)
            return True

        check(
            "isolated-runtime",
            inspect_runtime,
            "Build first, then use the inspected runtime-profile.json and unchanged prepared runtime. Inspect account roots, permissions, aliases and synthetic stable sentinels using docs/desktop-runtime.md.",
        )
        if admitted_context is not None:
            check(
                "isolated-root-access",
                lambda: all(
                    os.access(admitted_context[key], os.R_OK | os.W_OK | os.X_OK)
                    for key in ("configuration_root", "research_root", "scratch_root")
                ),
                "Restore read/write/search access only on the inspected independent fixture roots; never elevate the app or adopt a stable store.",
            )
            check(
                "isolated-scratch-path",
                lambda: len(os.fsencode(admitted_context["scratch_root"])) <= MAX_SCRATCH_BYTES,
                SCRATCH_REMEDY,
            )
    return {
        "version": 1,
        "target": workspace.target_id(),
        "profile": profile["id"],
        "passed": all(c["passed"] for c in checks),
        "checks": checks,
        "limits": "Read-only prerequisite checks; native addon loading, active Electron sandbox, actual Ozone backend, stable metadata preservation and durable restart require the native acceptance walkthrough.",
    }


def display_available(profile: dict) -> bool:
    backend = os.environ.get("XDG_SESSION_TYPE")
    if backend not in profile["display_backends"]:
        return False
    if backend == "wayland":
        if "GNOME" not in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
            return False
        directory = Path(os.environ.get("XDG_RUNTIME_DIR", "/nonexistent"))
        name = os.environ.get("WAYLAND_DISPLAY", "")
        if not name or Path(name).name != name or directory.stat().st_uid != os.getuid():
            return False
        endpoint = directory / name
    else:
        match = re.fullmatch(r":([0-9]+)(?:\.[0-9]+)?", os.environ.get("DISPLAY", ""))
        if match is None:
            return False
        endpoint = Path("/tmp/.X11-unix") / f"X{match[1]}"
    if not stat.S_ISSOCK(endpoint.stat().st_mode):
        return False
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(2)
        connection.connect(str(endpoint))
    return True


def sandbox_policy(runtime_profile: Path, runtime: Path) -> str:
    """Print an exact-executable Ubuntu allowance; never load or change host policy."""
    context = inspect_context(runtime_profile, runtime)
    executable = Path(context["executable"])
    require(
        executable.is_relative_to(runtime),
        "The admitted executable must remain inside its prepared-runtime directory.",
    )
    value = str(executable)
    require(
        executable.is_absolute()
        and executable.resolve() == executable
        and all(ord(c) >= 32 and ord(c) != 127 for c in value)
        and not any(c in value for c in '*?[]{}^"\\'),
        "Use a canonical runtime executable path without AppArmor pattern/control characters; spaces and Unicode are supported.",
    )
    identity = hashlib.sha256(
        (value + "\0" + workspace.digest(runtime / "prepared.json")).encode("utf-8")
    ).hexdigest()[:12]
    return (
        "abi <abi/4.0>,\ninclude <tunables/global>\n"
        + f'profile ohtia-contributor-{identity} "{value}" flags=(unconfined) {{\n  userns,\n}}\n'
    )


@contextmanager
def terminal_signals():
    """Latch interruption through process creation and cleanup; never raise in a handler."""
    previous = {
        getattr(signal, name): signal.getsignal(getattr(signal, name))
        for name in ("SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT")
        if hasattr(signal, name)
    }
    interrupted = False

    def receive(_kind, _frame):
        nonlocal interrupted
        interrupted = True

    try:
        for kind in previous:
            signal.signal(kind, receive)
        yield lambda: interrupted
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)


@contextmanager
def session_environment(env):
    """Give in-process diagnosis/smoke the same filtered session as supervised commands."""
    previous = dict(os.environ)
    try:
        os.environ.clear()
        os.environ.update(env)
        yield
    finally:
        os.environ.clear()
        os.environ.update(previous)


def ensure_session_active(cancelled):
    require(cancelled is None or not cancelled(), SESSION_INTERRUPTED)


def wait_for_compositor(
    compositor, directory: Path, notifications, timeout: float = 45, *, cancelled=None
) -> str:
    """A listening socket precedes GNOME UI initialization; require its ready notification."""
    deadline = time.monotonic() + timeout
    ready = False
    while time.monotonic() < deadline:
        ensure_session_active(cancelled)
        require(
            owned_running(compositor),
            "GNOME Wayland failed before UI readiness. Inspect the retained compositor log and native session prerequisites.",
        )
        try:
            ready = ready or b"READY=1" in notifications.recv(4096).splitlines()
        except TimeoutError:
            pass
        sockets = [
            file
            for file in directory.glob("wayland-*")
            if file.is_socket() and file.stat().st_uid == os.getuid()
        ]
        require(len(sockets) <= 1, "The private GNOME attempt must own exactly one Wayland socket.")
        if ready and sockets:
            return sockets[0].name
        if ready:
            time.sleep(0.05)
    raise ContributorError(
        "Private GNOME UI readiness timed out. Inspect the native session and retained compositor log before retrying."
    )


@contextmanager
def private_runtime_directory(stable_roots: list[str]):
    """Keep native IPC pathnames short while preserving the admitted account boundary."""
    native = RUNTIME_PARENT / str(os.getuid())
    require(
        native.is_dir()
        and native.resolve() == native
        and native.stat().st_uid == os.getuid()
        and stat.S_IMODE(native.stat().st_mode) & 0o077 == 0,
        "The native account runtime directory is unavailable or unsafe. Log into the inspected account so the OS creates its owner-only /run/user/<uid>; do not redirect XDG_RUNTIME_DIR to another profile.",
    )
    require(
        all(
            not native.is_relative_to(Path(value)) and not Path(value).is_relative_to(native)
            for value in stable_roots
        ),
        "The native account runtime directory overlaps a declared stable root. Correct the independent-profile inspection before launching.",
    )
    with tempfile.TemporaryDirectory(prefix="ohtia-", dir=native) as directory:
        path = Path(directory)
        require(
            len(os.fsencode(path / "gnome-ready.socket")) < 108,
            "The native IPC pathname exceeds Linux's 107-byte socket limit. Restore the standard short /run/user/<uid> account runtime location before retrying.",
        )
        yield path


def owned_running(child) -> bool:
    """Observe exit without reaping the private process-group anchor."""
    return os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG) is None


def stop_owned_group(child) -> None:
    """Terminate the owned daemon and activation helpers before reaping their anchor."""
    try:
        _signal_anchored_group(child.pid, signal.SIGTERM)
        deadline = time.monotonic() + 3
        while group_has_members(child.pid) and time.monotonic() < deadline:
            time.sleep(0.05)
    finally:
        try:
            _signal_anchored_group(child.pid, signal.SIGKILL)
        finally:
            child.wait(timeout=5)
    deadline = time.monotonic() + 3
    while group_has_members(child.pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    require(
        not group_has_members(child.pid),
        "Private session helpers remain after shutdown. Preserve this session and inspect its owned process group before retrying; never stop the login user bus.",
    )


@contextmanager
def private_bus(env: dict[str, str], runtime: Path, log, *, cancelled=None):
    """Own the bus instead of trusting an inherited nonempty session address."""
    endpoint = runtime / "bus"
    private_env = {**env, "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(endpoint)}
    bus = subprocess.Popen(
        [
            "dbus-daemon",
            "--session",
            "--nofork",
            "--nopidfile",
            "--address=" + private_env["DBUS_SESSION_BUS_ADDRESS"],
        ],
        cwd=runtime,
        env=private_env,
        start_new_session=True,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            ensure_session_active(cancelled)
            require(
                owned_running(bus),
                "The private D-Bus daemon failed. Inspect the retained session log and the declared dbus package before retrying.",
            )
            if endpoint.is_socket() and endpoint.stat().st_uid == os.getuid():
                break
            time.sleep(0.05)
        else:
            raise ContributorError(
                "The private D-Bus socket did not become ready. Check native session packages and retry the preserved attempt."
            )
        yield private_env
    finally:
        stop_owned_group(bus)


def session(runtime_profile: Path, runtime: Path, action: str, evidence: Path | None) -> int:
    """Own cleanup even when the terminal/SSH caller requests interruption."""
    with terminal_signals() as cancelled:
        return private_session(runtime_profile, runtime, action, evidence, cancelled)


def private_session(
    runtime_profile: Path, runtime: Path, action: str, evidence: Path | None, cancelled
) -> int:
    """Run one admitted command with an owned private bus and ready GNOME display."""
    require(os.getuid() != 0, "Start the private session as the ordinary independent account.")
    context = inspect_context(runtime_profile, runtime, cancelled=cancelled)
    scratch = Path(context["scratch_root"])
    if action != "doctor":
        require(len(os.fsencode(scratch)) <= MAX_SCRATCH_BYTES, SCRATCH_REMEDY)
    require(
        action in {"dev", "desktop:test", "storage:test", "diagnostics:test", "doctor", "smoke"},
        "Choose a declared native contributor command.",
    )
    needs_evidence = action.endswith(":test") or action == "smoke"
    require(
        evidence is None or needs_evidence,
        "--evidence is supported only for native test and smoke actions.",
    )
    if needs_evidence:
        require(
            evidence is not None
            and evidence.is_absolute()
            and not evidence.exists()
            and evidence.parent.resolve().is_relative_to(scratch),
            "Use a new absolute evidence directory inside the admitted scratch root.",
        )
    ensure_session_active(cancelled)
    attempt = Path(tempfile.mkdtemp(prefix="contributor-wayland-", dir=scratch))
    with private_runtime_directory(context["stable_roots"]) as directory:
        env = quality_native.build_environment()
        env.update(
            {
                "XDG_RUNTIME_DIR": str(directory),
                "XDG_SESSION_TYPE": "wayland",
                "XDG_CURRENT_DESKTOP": "GNOME",
                "LIBGL_ALWAYS_SOFTWARE": "1",
            }
        )
        env.pop("DISPLAY", None)
        env.pop("WAYLAND_DISPLAY", None)
        with (
            (attempt / "compositor.log").open("wb") as log,
            private_bus(env, directory, log, cancelled=cancelled) as bus_env,
            socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as readiness,
        ):
            endpoint = str(directory / "gnome-ready.socket")
            readiness.bind(endpoint)
            readiness.settimeout(0.1)
            env = {**bus_env, "NOTIFY_SOCKET": endpoint}
            compositor = subprocess.Popen(
                ["gnome-shell", "--headless", "--wayland", "--virtual-monitor", "1280x720"],
                cwd=scratch,
                env=env,
                start_new_session=True,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                env["WAYLAND_DISPLAY"] = wait_for_compositor(
                    compositor, directory, readiness, cancelled=cancelled
                )
                env.pop("NOTIFY_SOCKET", None)
                ensure_session_active(cancelled)
                if action in {"smoke", "doctor"}:
                    with session_environment(env):
                        _, profile, packages = native_profile()
                        if action == "smoke":
                            smoke(profile, runtime_profile, runtime, evidence, cancelled=cancelled)
                            return 0
                        result = doctor(
                            profile, packages, runtime_profile, runtime, cancelled=cancelled
                        )
                        ensure_session_active(cancelled)
                        print(json.dumps(result, indent=2))
                        return 0 if result["passed"] else 1
                args = [
                    sys.executable,
                    "scripts/workspace.py",
                    "run",
                    action,
                    str(runtime_profile),
                    str(runtime),
                ]
                if evidence is not None:
                    args.append(str(evidence))
                result = run_owned(args, ROOT, env, float("inf"), 5, cancelled=cancelled)
                ensure_session_active(cancelled)
                require(
                    not result["contained_processes_remaining_after_cleanup"],
                    "Native command cleanup is unverified. Preserve this attempt and inspect its owned command group before retrying.",
                )
                return result["exit_code"]
            except Exception:
                ensure_session_active(cancelled)
                raise
            finally:
                stop_owned_group(compositor)


def smoke(
    profile: dict, runtime_profile: Path, runtime: Path, evidence: Path, *, cancelled=None
) -> None:
    if cancelled is None:
        with terminal_signals() as interrupted:
            return native_smoke(profile, runtime_profile, runtime, evidence, interrupted)
    return native_smoke(profile, runtime_profile, runtime, evidence, cancelled)


def native_smoke(
    profile: dict, runtime_profile: Path, runtime: Path, evidence: Path, cancelled
) -> None:
    require(
        os.getuid() != 0 and display_available(profile),
        "Use the admitted ordinary account and native graphical session for smoke.",
    )
    context = inspect_context(runtime_profile, runtime, cancelled=cancelled)
    scratch = Path(context["scratch_root"])
    require(len(os.fsencode(scratch)) <= MAX_SCRATCH_BYTES, SCRATCH_REMEDY)
    require(
        evidence.is_absolute()
        and not evidence.exists()
        and evidence.parent.resolve().is_relative_to(scratch),
        "Use a new absolute smoke evidence directory inside the admitted scratch root.",
    )
    ensure_session_active(cancelled)
    evidence.mkdir()
    cell = {"target": workspace.target_id(), "backend": os.environ.get("XDG_SESSION_TYPE")}
    try:
        suites, native = quality_native.smoke(
            runtime_profile, runtime, evidence, cell, cancelled=cancelled
        )
    except Exception:
        ensure_session_active(cancelled)
        raise
    ensure_session_active(cancelled)
    (evidence / "contributor-smoke.json").write_text(
        json.dumps(
            {
                "version": 1,
                "scope": "native-contributor-runtime",
                "target": cell["target"],
                "profile": profile["id"],
                "inputs": input_hashes(),
                "native": native,
                "suites": {
                    key: {"file": str(file.relative_to(evidence)), "sha256": workspace.digest(file)}
                    for key, file in suites.items()
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        "Native runtime, storage and diagnostic suites passed with sampled OS sandbox/display and final process-absence observations. Retain the stable fixture metadata comparison separately."
    )


def package(profile: dict, destination: Path, attempt: int) -> None:
    require(
        os.getuid() != 0, "Build the local unsigned package as the ordinary contributor account."
    )
    require(
        destination.is_absolute() and not destination.exists(),
        "Use a fresh absolute package destination; existing attempts are preserved.",
    )
    require(
        destination.parent.is_dir() and destination.parent.resolve() == destination.parent,
        "Use an existing canonical package destination parent without symlink aliases; choose a fresh absolute attempt path before building.",
    )
    require(
        os.access(destination.parent, os.W_OK | os.X_OK),
        "The package destination parent is not writable/searchable by this account. Fix only the owned directory's permissions or select another qualified destination; do not build as root.",
    )
    require(attempt > 0, "Use a positive local attempt number.")
    inputs = input_hashes()
    destination.mkdir()
    built = subprocess.run(
        [sys.executable, "scripts/workspace.py", "run", "build"],
        cwd=ROOT,
        env=quality_native.build_environment(),
        check=False,
    )
    require(
        built.returncode == 0,
        "Build failed before packaging. Restore the diagnosed prerequisite and retry with a fresh destination; existing attempts are preserved.",
    )
    assembled = destination / "assembled"
    desktop_runtime.assemble(workspace.target_id(), assembled)
    cell = {
        "target": workspace.target_id(),
        "profile": profile["id"],
        "formats": [profile["package"]],
    }
    config = quality_native.configuration(
        cell, assembled, destination / "packages", f"0.0.0-dev.1.{attempt}"
    )
    config_file = destination / "builder.json"
    config_file.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    result = subprocess.run(
        [str(workspace.node_path()), "tooling/quality-package.mjs", str(config_file)],
        cwd=ROOT,
        env=quality_native.build_environment(),
        check=False,
    )
    require(
        result.returncode == 0,
        "Local packaging failed. Preserve this attempt, restore the reported build prerequisite and retry with a new destination.",
    )
    require(
        input_hashes() == inputs,
        "Packaging changed locked inputs; inspect the diff before retrying.",
    )
    artifacts = sorted((destination / "packages").glob(f"*.{profile['package']}"))
    require(
        len(artifacts) == 1,
        "Expected exactly one native local package; preserve the attempt for inspection.",
    )
    (destination / "local-package.json").write_text(
        json.dumps(
            {
                "version": 1,
                "scope": "local-unsigned-contributor-package",
                "target": cell["target"],
                "profile": cell["profile"],
                "inputs": inputs,
                "package": {"name": artifacts[0].name, "sha256": workspace.digest(artifacts[0])},
                "executed": False,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        "Local unsigned package created. Installation and native smoke remain separate explicit steps; no app was launched."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    install = commands.add_parser(
        "prerequisites", help="Print the OS transaction; --install consents to run it with sudo."
    )
    install.add_argument("--install", action="store_true")
    commands.add_parser(
        "setup", help="Install checkout-local pinned tools and frozen dependencies; safe to repeat."
    )
    diagnosis = commands.add_parser(
        "doctor", help="Read-only checks with content-free JSON output."
    )
    diagnosis.add_argument("--profile", type=Path)
    diagnosis.add_argument("--runtime", type=Path)
    allowance = commands.add_parser(
        "sandbox-policy",
        help="Print an exact-path Ubuntu AppArmor allowance for administrator review; never load it.",
    )
    allowance.add_argument("profile", type=Path)
    allowance.add_argument("runtime", type=Path)
    graphical = commands.add_parser(
        "session",
        help="Run an admitted command with its own private D-Bus and GNOME Wayland session.",
    )
    graphical.add_argument(
        "action",
        choices=("doctor", "dev", "desktop:test", "storage:test", "diagnostics:test", "smoke"),
    )
    graphical.add_argument("profile", type=Path)
    graphical.add_argument("runtime", type=Path)
    graphical.add_argument("--evidence", type=Path)
    acceptance = commands.add_parser(
        "smoke",
        help="Run all native suites with OS sandbox/display and shutdown observations in the admitted session.",
    )
    acceptance.add_argument("profile", type=Path)
    acceptance.add_argument("runtime", type=Path)
    acceptance.add_argument("evidence", type=Path)
    packaging = commands.add_parser(
        "package",
        help="Build one local unsigned native package without installing or executing it.",
    )
    packaging.add_argument("destination", type=Path)
    packaging.add_argument("--attempt", type=int, default=1)
    args = parser.parse_args()
    try:
        _, profile, packages = native_profile()
        if args.command == "prerequisites":
            prerequisites(packages, install=args.install)
        elif args.command == "setup":
            setup()
        elif args.command == "doctor":
            require(
                args.runtime is None or args.profile is not None,
                "doctor --runtime requires --profile; runtime inspection never skips isolation admission.",
            )
            result = doctor(profile, packages, args.profile, args.runtime)
            print(json.dumps(result, indent=2))
            return 0 if result["passed"] else 1
        elif args.command == "sandbox-policy":
            require(
                profile["id"].startswith("ubuntu-"),
                "This allowance is Ubuntu-specific; Fedora and Debian retain their declared native policy.",
            )
            print(sandbox_policy(args.profile, args.runtime), end="")
        elif args.command == "smoke":
            smoke(profile, args.profile, args.runtime, args.evidence)
        elif args.command == "session":
            return session(args.profile, args.runtime, args.action, args.evidence)
        else:
            package(profile, args.destination, args.attempt)
    except ContributorError as error:
        print(f"Linux contribution stopped: {error}", file=sys.stderr)
        return 1
    except workspace.WorkspaceError:
        print(
            "Linux contribution stopped: the pinned workspace operation failed. Restore reviewed inputs and network access, then repeat setup without upgrading global tools or rewriting locks.",
            file=sys.stderr,
        )
        return 1
    except (
        OSError,
        ValueError,
        TypeError,
        AttributeError,
        KeyError,
        StopIteration,
        subprocess.SubprocessError,
    ):
        print(
            "Linux contribution stopped: a required input, permission, tool or network operation failed. Preserve the attempt, run doctor and follow docs/linux-contribution.md; private exception text is omitted.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
