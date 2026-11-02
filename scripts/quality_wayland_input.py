"""Cycle a window through compositor keyboard input in an owned headless session."""

from __future__ import annotations

import os
import re
import sys
import time
from contextlib import ExitStack
from pathlib import Path

SERVICE = "org.gnome.Mutter.RemoteDesktop"
ROOT = "/org/gnome/Mutter/RemoteDesktop"
INTERFACE = SERVICE + ".Session"


def require_owned_session() -> None:
    """Require an unprivileged launcher's explicit compositor identity before opening its bus."""
    if (
        sys.platform != "linux"
        or os.getuid() == 0
        or os.environ.get("XDG_SESSION_TYPE") != "wayland"
        or os.environ.get("XDG_CURRENT_DESKTOP") != "GNOME"
        or not os.environ.get("XDG_RUNTIME_DIR")
        or re.fullmatch(r"[1-9][0-9]*", os.environ.get("OHTIA_NATIVE_COMPOSITOR_PID", "")) is None
    ):
        raise RuntimeError(
            "Compositor input requires an unprivileged owned headless Wayland session."
        )


def call(bus, gio, destination, path, interface, method, parameters=None):
    """Use bounded calls on the same connection for the complete input session."""
    try:
        return bus.call_sync(
            destination,
            path,
            interface,
            method,
            parameters,
            None,
            gio.DBusCallFlags.NO_AUTO_START,
            1000,
            None,
        ).unpack()
    except Exception as error:
        error.add_note(f"D-Bus operation: {interface}.{method}")
        raise


def verify_compositor(bus, gio, glib) -> dict:
    """Pin the bus owner and require the launcher's same-user headless compositor."""

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

    owners = {
        "remote": query("GetNameOwner", SERVICE),
        "shell": query("GetNameOwner", "org.gnome.Shell"),
    }
    expected = int(os.environ["OHTIA_NATIVE_COMPOSITOR_PID"])
    for owner in owners.values():
        uid = query("GetConnectionUnixUser", owner)
        pid = query("GetConnectionUnixProcessID", owner)
        if uid != os.getuid() or pid != expected:
            raise RuntimeError("The compositor must match the launcher's PID and user.")
    arguments = (Path("/proc") / str(expected) / "cmdline").read_bytes().split(b"\0")
    if (
        Path(os.fsdecode(arguments[0])).name != "gnome-shell"
        or b"--headless" not in arguments
        or b"--wayland" not in arguments
    ):
        raise RuntimeError("Compositor input is restricted to the owned headless GNOME process.")
    return owners


def cycle_window(bus, gio, glib, owners) -> None:
    """Send and release Alt+Escape through Mutter, retaining its permission controls."""
    owner = owners["remote"]
    session = call(bus, gio, owner, ROOT, SERVICE, "CreateSession")[0]
    with ExitStack() as cleanup:
        cleanup.callback(call, bus, gio, owner, session, INTERFACE, "Stop")
        call(bus, gio, owner, session, INTERFACE, "Start")

        def keys(*codes):
            # Register every release before pressing; all cleanup callbacks run
            # even if one notification fails, then the session is stopped.
            with ExitStack() as released:
                for key in codes:
                    released.callback(
                        call,
                        bus,
                        gio,
                        owner,
                        session,
                        INTERFACE,
                        "NotifyKeyboardKeycode",
                        glib.Variant("(ub)", (key, False)),
                    )
                    call(
                        bus,
                        gio,
                        owner,
                        session,
                        INTERFACE,
                        "NotifyKeyboardKeycode",
                        glib.Variant("(ub)", (key, True)),
                    )

        def overview_active():
            return call(
                bus,
                gio,
                owners["shell"],
                "/org/gnome/Shell",
                "org.freedesktop.DBus.Properties",
                "Get",
                glib.Variant("(ss)", ("org.gnome.Shell", "OverviewActive")),
            )[0]

        # GNOME starts in its overview, where window-cycling shortcuts are inactive.
        # Dismiss only an observed shell overview, never an application's open modal.
        for attempt in range(2):
            if not overview_active():
                break
            keys(1)
            # A first-session WelcomeDialog can consume the first Escape while
            # the overview remains visible. Reobserve before a second bounded input.
            deadline = time.monotonic() + 1
            while overview_active() and time.monotonic() < deadline:
                time.sleep(0.05)
        if overview_active():
            raise RuntimeError("The headless GNOME overview did not dismiss after bounded input.")
        # Linux evdev keycodes: left Alt and Escape. This is compositor input,
        # not Chromium input and not physical keyboard-layout qualification.
        keys(56, 1)


def failure_message(error: Exception) -> str:
    """Preserve initiating operation context through subsequent cleanup errors."""
    root = error
    visited = set()
    while root.__context__ is not None and id(root.__context__) not in visited:
        visited.add(id(root))
        root = root.__context__
    notes = "; ".join(getattr(root, "__notes__", []))[:100]
    metadata = f"{type(root).__name__[:40]}; {notes}"
    if root is not error:
        metadata += f"; cleanup also failed ({type(error).__name__[:40]})"
    # Reserve metadata before bounding the free-form cause, so a long exception
    # cannot erase the failed operation or the presence of a cleanup error.
    cause = str(root)[: max(0, 300 - len(metadata) - 2)]
    return f"Native compositor input failed: {metadata}: {cause}"


def main() -> None:
    require_owned_session()
    # Use the distribution's GI bindings, independently of the workspace Python.
    from gi.repository import Gio, GLib

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    owner = verify_compositor(bus, Gio, GLib)
    cycle_window(bus, Gio, GLib, owner)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Receipts retain a bounded cause and operation without a traceback.
        print(failure_message(error), file=sys.stderr)
        raise SystemExit(1) from None
