"""Run one command in an owned headless KDE Plasma 6 Wayland session on a private bus."""

from __future__ import annotations

import argparse
import os
import re
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
# KWin activates the portal frontend at startup; it reads its desktop from its own environment.
FRONTEND = "org.freedesktop.portal.Desktop"


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


def owner_pid(env: dict[str, str], name: str) -> int | None:
    """Ask the bus which process owns a name; the bus daemon answers for itself too."""
    result = bus(env, "GetConnectionUnixProcessID", f"string:{name}")
    match = re.search(r"\buint32 (\d+)\b", result.stdout) if result.returncode == 0 else None
    return int(match.group(1)) if match and int(match.group(1)) > 0 else None


def environment_entries(pid: int, proc: Path = Path("/proc")) -> list[bytes] | None:
    """Read another process's own environment only when this account owns it."""
    entry = proc / str(pid)
    try:
        if entry.stat().st_uid != os.getuid():
            return None
        return (entry / "environ").read_bytes().split(b"\0")
    except OSError:
        return None


def portal_on_plasma(env: dict[str, str], proc: Path = Path("/proc")) -> bool:
    """Require the frontend started with this session's desktop, or it serves GTK fallbacks."""
    started = bus(env, "StartServiceByName", f"string:{FRONTEND}", "uint32:0")
    if started.returncode != 0 or not re.search(r"\buint32 [12]\b", started.stdout):
        return False
    pid = owner_pid(env, FRONTEND)
    entries = environment_entries(pid, proc) if pid is not None else None
    return entries is not None and {
        b"XDG_CURRENT_DESKTOP=KDE",
        b"XDG_RUNTIME_DIR=" + os.fsencode(env["XDG_RUNTIME_DIR"]),
    } <= set(entries)


def update_activation(env: dict[str, str], log: BinaryIO) -> None:
    """Give bus-activated services the session's values before KWin can activate any of them."""
    values = {**{name: env[name] for name in ACTIVATION if name in env}, "WAYLAND_DISPLAY": SOCKET}
    try:
        update = subprocess.run(
            [
                "dbus-update-activation-environment",
                *(f"{name}={values[name]}" for name in ACTIVATION),
            ],
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


def login_runtime(runtime: Path) -> bool:
    """Report whether a runtime directory is the account's login runtime.

    Callers may pass the session runtime in their own `XDG_RUNTIME_DIR`, as the contributor
    and Scaleway routes do. The startup marker scan then refuses a directory that another
    process of this account, with a readable environment, already carries.
    """
    return runtime.resolve() == Path(f"/run/user/{os.getuid()}").resolve()


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


def release_document_mount(runtime: Path, env: dict[str, str]) -> None:
    """Detach the document portal's FUSE mount, which outlives the session inside its runtime.

    The bus-activated portal belongs to the private bus, not to the session's process groups,
    so its mount at `<runtime>/doc` would otherwise block removing the runtime directory.
    """
    mount = runtime / "doc"
    if not mounted(mount):
        return
    tool = shutil.which("fusermount3", path=env.get("PATH")) or shutil.which(
        "fusermount", path=env.get("PATH")
    )
    require(tool is not None, "The document portal mount needs fusermount3 to be released.")
    try:
        result = subprocess.run(
            [str(tool), "-u", "-z", str(mount)],
            capture_output=True,
            check=False,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        result = None
    require(
        result is not None and result.returncode == 0 and not mounted(mount),
        "The document portal mount in the Plasma runtime directory could not be released.",
    )


def process_start(pid: int, proc: Path = Path("/proc")) -> tuple[bytes, bytes] | None:
    """Return a live process's state and start time; the pair identifies it against PID reuse."""
    try:
        fields = (proc / str(pid) / "stat").read_bytes().rsplit(b")", 1)[-1].split()
    except OSError:
        return None
    return (fields[0], fields[19]) if len(fields) > 19 else None


def ancestors(proc: Path = Path("/proc")) -> set[int]:
    """Return this process and every ancestor, including a PID 1 of this PID namespace."""
    result, pid = set(), os.getpid()
    while pid > 0 and pid not in result:
        result.add(pid)
        try:
            fields = (proc / str(pid) / "stat").read_bytes().rsplit(b")", 1)[-1].split()
            pid = int(fields[1])
        except (OSError, IndexError, ValueError):
            break
    return result


def identities(pids: set[int], proc: Path = Path("/proc")) -> dict[int, bytes]:
    """Bind excluded processes to their start times so a reused PID is not excluded."""
    return {pid: identity[1] for pid in pids if (identity := process_start(pid, proc))}


def session_processes(
    runtime: Path, excluded: dict[int, bytes], proc: Path = Path("/proc")
) -> dict[int, bytes]:
    """Find this account's live processes that carry the session's private runtime directory.

    Bus-activated services inherit it from the activation environment and can outlive the
    session's process groups; a remaining process of the command carries it as well. The
    launcher, its ancestors and the bus daemon are excluded. A process that rewrote its own
    environment area, as Chromium does, is not found here and stays the caller's to supervise.
    """
    marker = b"XDG_RUNTIME_DIR=" + os.fsencode(runtime)
    found = {}
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        pid = int(entry.name)
        identity = process_start(pid, proc)
        if identity is None or excluded.get(pid) == identity[1]:
            continue
        entries = environment_entries(pid, proc)
        if identity[0] not in {b"Z", b"X"} and entries and marker in entries:
            found[pid] = identity[1]
    return found


def signal_identified(pid: int, start: bytes, sig: int, proc: Path = Path("/proc")) -> None:
    """Signal through a process handle whose start time was checked after it was opened.

    The handle keeps naming the same process even if the numeric PID is reused afterwards.
    A process that vanished or refuses the signal stays for the final cessation check.
    """
    try:
        handle = os.pidfd_open(pid)
    except OSError:
        return
    try:
        identity = process_start(pid, proc)
        if identity is not None and identity[1] == start:
            signal.pidfd_send_signal(handle, sig)
    except OSError:
        pass
    finally:
        os.close(handle)


def stop_session_processes(
    runtime: Path, excluded: dict[int, bytes], proc: Path = Path("/proc")
) -> None:
    """Stop leftover session services and verify cessation, never signaling a reused PID."""
    for sig, seconds in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
        deadline = time.monotonic() + seconds
        signalled = set()
        while True:
            remaining = session_processes(runtime, excluded, proc)
            if not remaining:
                return
            for pid, start in remaining.items():
                if (pid, start) not in signalled:
                    signal_identified(pid, start, sig, proc)
                    signalled.add((pid, start))
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
    require(
        not session_processes(runtime, excluded, proc),
        "Processes of the private Plasma session remain after shutdown.",
    )


def teardown(
    shell: subprocess.Popen | None,
    compositor: subprocess.Popen | None,
    runtime: Path,
    env: dict[str, str],
    *,
    report: bool,
    excluded: dict[int, bytes] | None = None,
) -> None:
    """Always stop the shell, then KWin, release the portal mount, then remaining services.

    An earlier session failure stays the reported one; otherwise the first teardown failure,
    including an interruption, is raised after every step was attempted.
    """
    first: BaseException | None = None
    for step in (
        lambda: stop(shell),
        lambda: stop(compositor),
        lambda: release_document_mount(runtime, env),
        lambda: excluded is not None and stop_session_processes(runtime, excluded),
    ):
        try:
            step()
        except BaseException as error:
            if first is None:
                first = error
    if report and first is not None:
        raise first


def mounted(path: Path, mountinfo: Path = Path("/proc/self/mountinfo")) -> bool:
    """Read the mount table; a mount whose FUSE daemon died fails lstat and `os.path.ismount`."""
    try:
        lines = mountinfo.read_bytes().splitlines()
    except OSError:
        return os.path.ismount(path)
    target = os.fsencode(path)
    for line in lines:
        fields = line.split(b" ")
        if len(fields) > 4:
            point = re.sub(
                rb"\\([0-7]{3})", lambda match: bytes([int(match.group(1), 8)]), fields[4]
            )
            if point == target:
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
    require(
        not login_runtime(runtime),
        "Use a runtime directory created for this Plasma session, not the login runtime.",
    )
    daemon = owner_pid(env, "org.freedesktop.DBus")
    require(daemon is not None, "The private D-Bus daemon did not identify itself.")
    excluded = identities({daemon, *ancestors()})
    # Teardown signals by this runtime marker, so no other process may carry it beforehand.
    require(
        not session_processes(runtime, excluded),
        "Other processes already use this runtime directory; use one created for this session.",
    )
    try:
        update_activation(env, log)
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
        waiting(
            lambda: portal_on_plasma(env),
            "The desktop portal is not running with the Plasma session environment.",
        )
        env["OHTIA_NATIVE_COMPOSITOR_PID"] = str(compositor.pid)
        yield env
        # A session whose shell or compositor stopped during the command did not qualify it.
        require(
            compositor.poll() is None and shell.poll() is None,
            "KWin or plasmashell exited during the session; KWin alone does not qualify.",
        )
    except BaseException:
        teardown(shell, compositor, runtime, env, report=False, excluded=excluded)
        raise
    teardown(shell, compositor, runtime, env, report=True, excluded=excluded)


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
