"""Run one command in an owned headless KDE Plasma 6 Wayland session on a private bus."""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import stat
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

SOCKET = "wayland-ohtia"
READY_SECONDS = 60
# The kernel limits a Unix socket path, including its runtime directory, to 108 bytes.
SOCKET_PATH_LIMIT = 108
# A bus started before the private runtime directory existed does not know it either.
ACTIVATION = (
    "XDG_RUNTIME_DIR",
    "WAYLAND_DISPLAY",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_TYPE",
    "KDE_SESSION_VERSION",
    "QT_QPA_PLATFORM",
)
PORTAL = "org.freedesktop.impl.portal.desktop.kde"


class PlasmaError(RuntimeError):
    """The Plasma session did not become ready; the cell fails instead of falling back."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PlasmaError(message)


def bus(env: dict[str, str], method: str, *arguments: str) -> subprocess.CompletedProcess[str]:
    tool = shutil.which("dbus-send", path=env.get("PATH"))
    require(tool is not None, "dbus-send is required for Plasma session readiness.")
    command = [
        str(tool),
        "--session",
        "--print-reply",
        "--reply-timeout=5000",
        "--dest=org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        f"org.freedesktop.DBus.{method}",
        *arguments,
    ]
    try:
        return subprocess.run(
            command, env=env, capture_output=True, text=True, check=False, timeout=10
        )
    except subprocess.TimeoutExpired:
        # An unanswered bus is not ready; the readiness deadline decides the outcome.
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="")


def has_owner(env: dict[str, str], name: str) -> bool:
    """Ask the bus for a current owner; listed activatable names do not count."""
    result = bus(env, "NameHasOwner", f"string:{name}")
    return result.returncode == 0 and "boolean true" in result.stdout


def start_portal(env: dict[str, str]) -> bool:
    result = bus(env, "StartServiceByName", f"string:{PORTAL}", "uint32:0")
    return result.returncode == 0 and ("uint32 1" in result.stdout or "uint32 2" in result.stdout)


def session_environment(base: dict[str, str], runtime: Path) -> dict[str, str]:
    env = {
        **base,
        "XDG_RUNTIME_DIR": str(runtime),
        "XDG_SESSION_TYPE": "wayland",
        "XDG_CURRENT_DESKTOP": "KDE",
        "KDE_SESSION_VERSION": "6",
        "QT_QPA_PLATFORM": "wayland",
    }
    env.pop("DISPLAY", None)
    env.pop("WAYLAND_DISPLAY", None)
    return env


def group_alive(pgid: int, proc: Path = Path("/proc")) -> bool:
    """Report whether any process, other than a reaped leader, remains in the owned group."""
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            stat_line = (entry / "stat").read_bytes()
        except OSError:
            continue
        # The command name is parenthesized, may contain spaces and is cut to 15 bytes, which
        # can split a UTF-8 character; only the ASCII fields after it are read.
        fields = stat_line.rsplit(b")", 1)[-1].split()
        if len(fields) > 2 and fields[2] == str(pgid).encode():
            return True
    return False


def stop(child: subprocess.Popen | None) -> None:
    """Stop the whole owned process group, even after its leader exited, and verify cessation."""
    if child is None:
        return
    # A reaped leader with an empty group no longer owns its ID; never signal a reused one.
    if child.poll() is not None and not group_alive(child.pid):
        return
    for sig, seconds in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if child.poll() is not None and not group_alive(child.pid):
                return
            time.sleep(0.05)
    require(
        child.poll() is not None and not group_alive(child.pid),
        "Plasma session helpers remain after shutdown.",
    )


@contextmanager
def session(
    base: dict[str, str],
    runtime: Path,
    log: BinaryIO,
    *,
    cancelled: Callable[[], bool] | None = None,
    ready_seconds: float = READY_SECONDS,
) -> Iterator[dict[str, str]]:
    """Start KWin and plasmashell, require readiness, then stop plasmashell before KWin."""
    require(os.getuid() != 0, "Start the Plasma session as an ordinary account.")
    require(
        bool(base.get("DBUS_SESSION_BUS_ADDRESS")),
        "Start the Plasma session on its own private D-Bus session bus.",
    )
    require(
        runtime.is_dir()
        and runtime.stat().st_uid == os.getuid()
        and stat.S_IMODE(runtime.stat().st_mode) & 0o077 == 0,
        "The Plasma runtime directory must be private to this account.",
    )
    require(
        len(os.fsencode(runtime / SOCKET)) < SOCKET_PATH_LIMIT,
        "The Plasma runtime directory is too long for its Wayland socket.",
    )
    env = session_environment(base, runtime)
    compositor = shell = None
    deadline = time.monotonic() + ready_seconds

    def waiting(condition: Callable[[], bool], message: str) -> None:
        while not condition():
            require(cancelled is None or not cancelled(), "The Plasma session was interrupted.")
            require(compositor is not None and compositor.poll() is None, message)
            require(shell is None or shell.poll() is None, message)
            require(time.monotonic() < deadline, message)
            time.sleep(0.1)

    require(
        not has_owner(env, "org.kde.KWin"),
        "Start the Plasma session on a fresh private bus; this bus already has a KWin.",
    )
    try:
        compositor = subprocess.Popen(
            [
                "kwin_wayland",
                "--virtual",
                "--no-lockscreen",
                "--no-global-shortcuts",
                "--socket",
                SOCKET,
                "--width",
                "1280",
                "--height",
                "720",
            ],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        endpoint = runtime / SOCKET
        waiting(
            lambda: endpoint.is_socket() and endpoint.stat().st_uid == os.getuid(),
            "KWin did not publish its Wayland socket in time.",
        )
        waiting(lambda: has_owner(env, "org.kde.KWin"), "KWin did not take its bus name in time.")
        env["WAYLAND_DISPLAY"] = SOCKET
        # Bus-activated portals need the session display; without it they abort at startup.
        try:
            update = subprocess.run(
                ["dbus-update-activation-environment", *ACTIVATION],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=False,
                timeout=10,
            )
        except subprocess.TimeoutExpired:
            update = None
        require(
            update is not None and update.returncode == 0,
            "The D-Bus activation environment update failed.",
        )
        shell = subprocess.Popen(
            ["plasmashell", "--no-respawn"],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        waiting(
            lambda: has_owner(env, "org.kde.plasmashell"),
            "plasmashell did not take its bus name in time; KWin alone does not qualify.",
        )
        waiting(lambda: start_portal(env), "The KDE portal backend did not start in time.")
        env["OHTIA_NATIVE_COMPOSITOR_PID"] = str(compositor.pid)
        yield env
        # A session whose shell or compositor stopped during the command did not qualify it.
        require(
            compositor.poll() is None and shell.poll() is None,
            "KWin or plasmashell exited during the session; KWin alone does not qualify.",
        )
    finally:
        # Stop KWin whatever stopping the shell raised, including an interruption; the shell's
        # failure is then reported first.
        try:
            stop(shell)
        except BaseException as failure:
            try:
                stop(compositor)
            finally:
                raise failure
        stop(compositor)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    run = commands.add_parser("run", help="Run a command inside a fresh Plasma session.")
    run.add_argument("--runtime", type=Path, required=True)
    run.add_argument("--log", type=Path, required=True)
    run.add_argument("--timeout", type=int, default=3600)
    run.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("Name the command to run after --.")
    try:
        with args.log.open("xb") as log, session(dict(os.environ), args.runtime, log) as env:
            return subprocess.run(command, env=env, check=False, timeout=args.timeout).returncode
    except PlasmaError as error:
        print(f"Plasma session failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
