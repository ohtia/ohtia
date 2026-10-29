"""Enter the fresh guest account and preserve original CI source/event identities."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

home = Path("/home/ohtia-quality")
env = {**os.environ, **json.loads((home / "environment.json").read_text())}
source = home / "source"
subprocess.run(
    ["git", "clone", "--no-checkout", str(home / "source.bundle"), str(source)], check=True
)
subprocess.run(["git", "checkout", "--detach", env["GITHUB_SHA"]], cwd=source, check=True)
env["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
# This account belongs only to this fresh guest. Use its standard user bus so
# D-Bus and systemd activation address the same GNOME session and services.
bus = Path(env["XDG_RUNTIME_DIR"]) / "bus"
env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus}"
# Cloud images can start this manager before desktop packages install user units.
# systemctl reaches the user's private manager socket, even before dbus.socket exists.
for operation in (["daemon-reload"], ["start", "dbus.socket"]):
    subprocess.run(
        ["/usr/bin/systemctl", "--user", *operation],
        env=env,
        check=True,
        timeout=10,
    )
if not bus.is_socket() or bus.stat().st_uid != os.getuid():
    raise SystemExit("The guest account's native D-Bus socket is unavailable.")
subprocess.run(
    [
        "gdbus",
        "call",
        "--session",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        "org.freedesktop.DBus.GetId",
    ],
    env=env,
    stdout=subprocess.DEVNULL,
    check=True,
    timeout=10,
)
# Socket activation starts the daemon; wait for the manager's bus name before
# relying on systemd-backed desktop activation. This is a readiness wait, not a retry.
subprocess.run(
    ["gdbus", "wait", "--session", "--timeout=8", "org.freedesktop.systemd1"],
    env=env,
    stdout=subprocess.DEVNULL,
    check=True,
    timeout=10,
)
os.environ.update(env)
subprocess.run(["python3", "scripts/workspace.py", "setup"], cwd=source, env=env, check=True)
# Seed activation before GNOME can request services; publish its actual socket later.
env.pop("DISPLAY", None)
subprocess.run(
    [
        "dbus-update-activation-environment",
        "--systemd",
        "DBUS_SESSION_BUS_ADDRESS",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
    ],
    env=env,
    check=True,
    timeout=10,
)
# The guest owns its kernel, home filesystem, GNOME compositor and policy; no host desktop is mounted.
with (home / "gnome.log").open("x+b") as log:
    compositor = subprocess.Popen(
        [
            "gnome-shell",
            "--headless",
            "--wayland",
            "--virtual-monitor",
            "1280x720",
        ],
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    session_attempted = False
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            sockets = list(Path(env["XDG_RUNTIME_DIR"]).glob("wayland-*"))
            sockets = [file for file in sockets if file.is_socket()]
            if sockets:
                env["WAYLAND_DISPLAY"] = sockets[0].name
                break
            if compositor.poll() is not None:
                raise SystemExit("Native GNOME Wayland compositor failed.")
            time.sleep(0.2)
        else:
            raise SystemExit("Native GNOME Wayland compositor did not become ready.")
        subprocess.run(
            [
                "dbus-update-activation-environment",
                "--systemd",
                "DBUS_SESSION_BUS_ADDRESS",
                "XDG_RUNTIME_DIR",
                "XDG_SESSION_TYPE",
                "XDG_CURRENT_DESKTOP",
                "WAYLAND_DISPLAY",
            ],
            env=env,
            check=True,
            timeout=10,
        )
        # A graphical session pulls in the passive target required by GNOME portals.
        # The anchor runs only trusted /usr/bin/true as this disposable guest user.
        session_attempted = True
        subprocess.run(
            [
                "/usr/bin/systemd-run",
                "--user",
                "--unit=ohtia-quality-session",
                "--property=Type=oneshot",
                "--property=RemainAfterExit=yes",
                "--property=BindsTo=graphical-session.target",
                "--property=After=graphical-session.target",
                "--",
                "/usr/bin/true",
            ],
            env=env,
            check=True,
            timeout=10,
        )
        subprocess.run(
            [
                "python3",
                "scripts/workspace.py",
                "run",
                "quality:build",
                env["OHTIA_QUALITY_VM"],
                "artifacts/quality-result",
            ],
            cwd=source,
            env=env,
            check=True,
        )
    finally:
        suite_failed = sys.exception() is not None
        try:
            if session_attempted:
                subprocess.run(
                    ["/usr/bin/systemctl", "--user", "stop", "ohtia-quality-session.service"],
                    env=env,
                    check=True,
                    timeout=10,
                )
        except (OSError, subprocess.SubprocessError) as error:
            if not suite_failed:
                raise
            print(f"Guest session cleanup failed: {type(error).__name__}", file=sys.stderr)
        finally:
            try:
                compositor.terminate()
                try:
                    compositor.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    compositor.kill()
                    compositor.wait(timeout=5)
            finally:
                output = source / "artifacts" / "quality-result"
                try:
                    log.flush()
                    diagnostic = os.pread(log.fileno(), 2 * 1024 * 1024, 0)
                    output.mkdir(parents=True, exist_ok=True)
                    with (output / "gnome.log").open("xb") as retained:
                        retained.write(diagnostic)
                except OSError as error:
                    print(
                        f"Guest compositor diagnostics could not be retained: {type(error).__name__}",
                        file=sys.stderr,
                    )
                try:
                    with (home / "user-session.log").open("x+b") as journal:
                        try:
                            subprocess.run(
                                [
                                    "/usr/bin/journalctl",
                                    "--user",
                                    "--boot",
                                    "--lines=100",
                                    "--no-pager",
                                ],
                                env=env,
                                stdin=subprocess.DEVNULL,
                                stdout=journal,
                                stderr=subprocess.STDOUT,
                                timeout=5,
                                check=False,
                            )
                        finally:
                            journal.flush()
                            with (output / "user-session.log").open("xb") as retained:
                                retained.write(os.pread(journal.fileno(), 64 * 1024, 0))
                except (OSError, subprocess.SubprocessError) as error:
                    print(
                        f"Guest user-session diagnostics could not be retained: {type(error).__name__}",
                        file=sys.stderr,
                    )
                if env["OHTIA_QUALITY_VM"] == "fedora-44-x64-vm":
                    try:
                        service = subprocess.run(
                            ["/usr/bin/systemctl", "is-active", "auditd"],
                            stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL,
                            text=True,
                            timeout=5,
                            check=False,
                        )
                        auditd = {
                            "exit_code": service.returncode,
                            "state": (service.stdout or "").strip()[:32],
                        }
                    except (OSError, subprocess.SubprocessError) as error:
                        auditd = {"exit_code": None, "error_type": type(error).__name__}
                    try:
                        descriptor = os.open(
                            home / "selinux-audit.log", os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600
                        )
                        with os.fdopen(descriptor, "r+b") as audit:
                            status = {
                                "exit_code": None,
                                "watchdog": False,
                                "query": "boot AVC,USER_AVC",
                                "auditd": auditd,
                                "retained_byte_limit": 256 * 1024,
                            }
                            try:
                                query = subprocess.run(
                                    [
                                        "/usr/bin/sudo",
                                        "-n",
                                        "/usr/bin/timeout",
                                        "--signal=TERM",
                                        "--kill-after=1s",
                                        "8s",
                                        "/usr/sbin/ausearch",
                                        "--input-logs",
                                        "-m",
                                        "AVC,USER_AVC",
                                        "-ts",
                                        "boot",
                                        "--raw",
                                    ],
                                    stdin=subprocess.DEVNULL,
                                    stdout=audit,
                                    stderr=subprocess.STDOUT,
                                    timeout=12,
                                    check=False,
                                )
                                status["exit_code"] = query.returncode
                            except subprocess.TimeoutExpired:
                                status["watchdog"] = True
                            except (OSError, subprocess.SubprocessError) as error:
                                status["error_type"] = type(error).__name__
                            finally:
                                audit.flush()
                                status["truncated"] = os.fstat(audit.fileno()).st_size > 256 * 1024
                                with (output / "selinux-audit.log").open("xb") as retained:
                                    retained.write(os.pread(audit.fileno(), 256 * 1024, 0))
                                with (output / "selinux-audit.json").open(
                                    "x", encoding="utf-8"
                                ) as receipt:
                                    json.dump(status, receipt)
                    except OSError as error:
                        print(
                            f"Guest SELinux diagnostics could not be retained: {type(error).__name__}",
                            file=sys.stderr,
                        )
