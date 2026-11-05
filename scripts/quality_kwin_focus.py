"""Activate an application window through a KWin script in an owned headless Plasma session."""

from __future__ import annotations

import os
import re
import sys
import uuid
from contextlib import ExitStack
from pathlib import Path

from quality_wayland_input import call, failure_message

SERVICE = "org.kde.KWin"
SCRIPTING = "org.kde.kwin.Scripting"
SCRIPT = "org.kde.kwin.Script"
PID = re.compile(r"[1-9][0-9]*")


def require_owned_session(argv: list[str]) -> int:
    """Admit only an unprivileged launcher's Plasma session and one application process."""
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    if (
        sys.platform != "linux"
        or os.getuid() == 0
        or os.environ.get("XDG_SESSION_TYPE") != "wayland"
        or os.environ.get("XDG_CURRENT_DESKTOP") != "KDE"
        or os.environ.get("KDE_SESSION_VERSION") != "6"
        or not runtime
        or PID.fullmatch(os.environ.get("OHTIA_NATIVE_COMPOSITOR_PID", "")) is None
    ):
        raise RuntimeError(
            "KWin activation requires an unprivileged owned headless Plasma session."
        )
    if len(argv) != 1 or PID.fullmatch(argv[0]) is None:
        raise RuntimeError("Pass exactly one positive decimal application process identifier.")
    directory = Path(runtime)
    if not directory.is_dir() or directory.stat().st_uid != os.getuid():
        raise RuntimeError("The private runtime directory must belong to this account.")
    return int(argv[0])


def verify_compositor(bus, gio, glib) -> str:
    """Pin the KWin bus owner to the launcher's same-user headless compositor process."""

    def query(method, value):
        return call(
            bus,
            gio,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            method,
            glib.Variant("(s)", (value,)),
        )[0]

    owner = query("GetNameOwner", SERVICE)
    expected = int(os.environ["OHTIA_NATIVE_COMPOSITOR_PID"])
    if (
        query("GetConnectionUnixUser", owner) != os.getuid()
        or query("GetConnectionUnixProcessID", owner) != expected
    ):
        raise RuntimeError("KWin must match the launcher's compositor PID and user.")
    arguments = (Path("/proc") / str(expected) / "cmdline").read_bytes().split(b"\0")
    if Path(os.fsdecode(arguments[0])).name != "kwin_wayland" or b"--virtual" not in arguments:
        raise RuntimeError("Activation is restricted to the owned headless KWin process.")
    return owner


def script_source(pid: int) -> str:
    """Select the application's first inactive normal window; KWin reports its client PID."""
    return (
        "const target = workspace.windowList().filter(\n"
        f"  (window) => window.pid === {pid} && window.normalWindow && !window.active,\n"
        ")[0];\n"
        "if (target) workspace.activeWindow = target;\n"
    )


def activate(bus, gio, glib, owner: str, pid: int) -> None:
    """Load, run and always unload one KWin script, deleting its private file."""
    name = f"ohtia-focus-{uuid.uuid4().hex}"
    file = Path(os.environ["XDG_RUNTIME_DIR"]) / f"{name}.js"
    with ExitStack() as cleanup:
        descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        cleanup.callback(file.unlink, missing_ok=True)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(script_source(pid))
        identifier = call(
            bus,
            gio,
            owner,
            "/Scripting",
            SCRIPTING,
            "loadScript",
            glib.Variant("(ss)", (str(file), name)),
        )[0]
        cleanup.callback(
            call,
            bus,
            gio,
            owner,
            "/Scripting",
            SCRIPTING,
            "unloadScript",
            glib.Variant("(s)", (name,)),
        )
        if type(identifier) is not int or identifier < 0:
            raise RuntimeError("KWin refused the activation script.")
        call(bus, gio, owner, f"/Scripting/Script{identifier}", SCRIPT, "run")


def main(argv: list[str]) -> None:
    pid = require_owned_session(argv)
    # Use the distribution's GI bindings, independently of the workspace Python.
    from gi.repository import Gio, GLib

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    owner = verify_compositor(bus, Gio, GLib)
    activate(bus, Gio, GLib, owner, pid)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as error:
        # Receipts retain a bounded cause and operation without a traceback.
        print(
            failure_message(error).replace("compositor input", "KWin activation"), file=sys.stderr
        )
        raise SystemExit(1) from None
