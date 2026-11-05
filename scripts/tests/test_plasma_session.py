"""Contracts for the shared Plasma launcher; no native session is simulated as passing."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import plasma_session as plasma


class FakeProcess:
    def __init__(self, arguments, pid):
        self.arguments = arguments
        self.pid = pid
        self.returncode = None

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        self.returncode = 0 if self.returncode is None else self.returncode
        return self.returncode


class PlasmaSessionTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="kde-")))
        os.chmod(self.runtime, 0o700)
        self.base = {"PATH": os.environ.get("PATH", ""), "DBUS_SESSION_BUS_ADDRESS": "unix:path=x"}
        self.order = []
        self.processes = []
        self.owners = {"org.kde.KWin": True, "org.kde.plasmashell": True}
        self.foreign_kwin = False
        self.update_status = 0
        self.portal = True
        self.publish_socket = True

    def fake_popen(self, arguments, **options):
        self.assertTrue(options["start_new_session"])
        process = FakeProcess(arguments, 4000 + len(self.processes))
        self.processes.append(process)
        self.order.append(("start", arguments[0]))
        if arguments[0] == "kwin_wayland":
            self.assertEqual(options["env"]["XDG_CURRENT_DESKTOP"], "KDE")
            self.assertEqual(options["env"]["KDE_SESSION_VERSION"], "6")
            self.assertNotIn("WAYLAND_DISPLAY", options["env"])
            if self.publish_socket:
                (self.runtime / plasma.SOCKET).touch()
        return process

    def fake_run(self, arguments, **options):
        self.order.append(("run", arguments[0]))
        if arguments[0] == "dbus-update-activation-environment":
            self.assertEqual(arguments[1:], list(plasma.ACTIVATION))
            self.assertIn("XDG_RUNTIME_DIR", arguments)
            self.assertEqual(options["env"]["WAYLAND_DISPLAY"], plasma.SOCKET)
            return subprocess.CompletedProcess(arguments, self.update_status)
        method = arguments[6].rsplit(".", 1)[1]
        name = arguments[7].removeprefix("string:")
        if method == "NameHasOwner":
            started = {p.arguments[0] for p in self.processes}
            owned = self.owners.get(name, False) and (
                name != "org.kde.KWin" or "kwin_wayland" in started or self.foreign_kwin
            )
            return subprocess.CompletedProcess(
                arguments, 0, stdout=f"   boolean {'true' if owned else 'false'}\n"
            )
        self.assertEqual(method, "StartServiceByName")
        self.assertEqual(name, plasma.PORTAL)
        return subprocess.CompletedProcess(
            arguments, 0 if self.portal else 1, stdout="   uint32 1\n" if self.portal else ""
        )

    def killpg(self, pid, sig):
        process = next(p for p in self.processes if p.pid == pid)
        if process.returncode is None:
            self.order.append(("stop", process.arguments[0]))
            process.returncode = -sig

    def session(self, **options):
        socket = Mock(side_effect=lambda: (self.runtime / plasma.SOCKET).exists())
        return (
            patch.object(plasma.subprocess, "Popen", side_effect=self.fake_popen),
            patch.object(plasma.subprocess, "run", side_effect=self.fake_run),
            patch.object(plasma.os, "killpg", side_effect=self.killpg),
            patch.object(plasma.shutil, "which", return_value="/usr/bin/dbus-send"),
            patch.object(Path, "is_socket", lambda path: socket()),
            patch.object(plasma.time, "sleep"),
            patch.object(plasma, "group_alive", return_value=False),
        )

    def enter(self, **options):
        patches = self.session()
        for item in patches:
            self.enterContext(item)
        return plasma.session(self.base, self.runtime, Mock(), **options)

    def test_ready_session_exports_plasma_identity_and_stops_shell_before_kwin(self):
        with self.enter() as env:
            self.assertEqual(env["WAYLAND_DISPLAY"], plasma.SOCKET)
            self.assertEqual(env["XDG_CURRENT_DESKTOP"], "KDE")
            self.assertEqual(env["KDE_SESSION_VERSION"], "6")
            self.assertEqual(env["XDG_SESSION_TYPE"], "wayland")
            self.assertEqual(env["XDG_RUNTIME_DIR"], str(self.runtime))
            self.assertEqual(env["OHTIA_NATIVE_COMPOSITOR_PID"], str(self.processes[0].pid))
            self.assertNotIn("DISPLAY", env)
        starts = [entry for entry in self.order if entry[0] == "start"]
        self.assertEqual(starts, [("start", "kwin_wayland"), ("start", "plasmashell")])
        update = self.order.index(("run", "dbus-update-activation-environment"))
        self.assertLess(update, self.order.index(("start", "plasmashell")))
        self.assertEqual(
            [entry for entry in self.order if entry[0] == "stop"],
            [("stop", "plasmashell"), ("stop", "kwin_wayland")],
        )
        self.assertEqual(
            self.processes[0].arguments[1:4],
            ["--virtual", "--no-lockscreen", "--no-global-shortcuts"],
        )
        self.assertIn("--socket", self.processes[0].arguments)
        self.assertEqual(self.processes[1].arguments, ["plasmashell", "--no-respawn"])

    def failure(self, message, **options):
        with self.assertRaisesRegex(plasma.PlasmaError, message):
            with self.enter(**options):
                self.fail("A session that is not ready must not run its command.")
        for process in self.processes:
            self.assertIsNotNone(process.returncode)

    def test_kwin_alone_without_plasmashell_does_not_qualify(self):
        self.owners["org.kde.plasmashell"] = False
        self.failure("KWin alone does not qualify", ready_seconds=0.01)

    def test_activation_environment_failure_fails_before_plasmashell(self):
        self.update_status = 1
        self.failure("activation environment update failed")
        self.assertNotIn(("start", "plasmashell"), self.order)

    def test_portal_backend_failure_fails_the_cell(self):
        self.portal = False
        self.failure("KDE portal backend", ready_seconds=0.01)

    def test_missing_socket_or_bus_name_fails_within_the_deadline(self):
        self.publish_socket = False
        self.failure("Wayland socket", ready_seconds=0.01)
        self.order.clear()
        self.processes.clear()
        self.publish_socket = True
        (self.runtime / plasma.SOCKET).unlink(missing_ok=True)
        self.owners["org.kde.KWin"] = False
        self.failure("bus name", ready_seconds=0.01)

    def test_interrupted_session_stops_its_processes(self):
        self.owners["org.kde.plasmashell"] = False
        self.failure("interrupted", cancelled=lambda: True)

    def test_refuses_shared_bus_long_or_shared_runtime_and_root(self):
        self.base.pop("DBUS_SESSION_BUS_ADDRESS")
        with self.assertRaisesRegex(plasma.PlasmaError, "private D-Bus"):
            with plasma.session(self.base, self.runtime, Mock()):
                pass
        self.base["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=x"
        os.chmod(self.runtime, 0o755)
        with self.assertRaisesRegex(plasma.PlasmaError, "private to this account"):
            with plasma.session(self.base, self.runtime, Mock()):
                pass
        os.chmod(self.runtime, 0o700)
        deep = self.runtime / ("d" * 100)
        deep.mkdir(mode=0o700)
        with self.assertRaisesRegex(plasma.PlasmaError, "too long"):
            with plasma.session(self.base, deep, Mock()):
                pass
        with patch.object(plasma.os, "getuid", return_value=0):
            with self.assertRaisesRegex(plasma.PlasmaError, "ordinary account"):
                with plasma.session(self.base, self.runtime, Mock()):
                    pass

    def test_refuses_a_bus_that_already_has_a_kwin(self):
        self.foreign_kwin = True
        with self.assertRaisesRegex(plasma.PlasmaError, "already has a KWin"):
            with self.enter():
                self.fail("A shared desktop bus must not receive the private session.")
        self.assertEqual(self.processes, [])

    def test_shell_or_compositor_exit_during_the_command_fails_the_session(self):
        for index in (1, 0):
            with self.subTest(process=("plasmashell", "kwin_wayland")[index]):
                self.order.clear()
                self.processes.clear()
                (self.runtime / plasma.SOCKET).unlink(missing_ok=True)
                with self.assertRaisesRegex(plasma.PlasmaError, "exited during the session"):
                    with self.enter():
                        self.processes[index].returncode = 1
                for process in self.processes:
                    self.assertIsNotNone(process.returncode)

    def test_kwin_is_stopped_even_when_the_shell_group_does_not_stop(self):
        stopped = []

        def stop(child):
            if child is None:
                return
            stopped.append(child.arguments[0])
            child.returncode = 0
            if child.arguments[0] == "plasmashell":
                raise plasma.PlasmaError("Plasma session helpers remain after shutdown.")

        self.enterContext(patch.object(plasma, "stop", side_effect=stop))
        with self.assertRaisesRegex(plasma.PlasmaError, "remain after shutdown"):
            with self.enter():
                pass
        self.assertEqual(stopped, ["plasmashell", "kwin_wayland"])

    def test_shell_teardown_failure_is_reported_before_a_kwin_failure(self):
        def stop(child):
            if child is None:
                return
            child.returncode = 0
            raise plasma.PlasmaError(f"{child.arguments[0]} helpers remain after shutdown.")

        self.enterContext(patch.object(plasma, "stop", side_effect=stop))
        with self.assertRaisesRegex(plasma.PlasmaError, "^plasmashell helpers"):
            with self.enter():
                pass

    def test_kwin_is_stopped_when_stopping_the_shell_is_interrupted(self):
        stopped = []

        def stop(child):
            if child is None:
                return
            stopped.append(child.arguments[0])
            child.returncode = 0
            if child.arguments[0] == "plasmashell":
                raise KeyboardInterrupt

        self.enterContext(patch.object(plasma, "stop", side_effect=stop))
        with self.assertRaises(KeyboardInterrupt):
            with self.enter():
                pass
        self.assertEqual(stopped, ["plasmashell", "kwin_wayland"])

    def test_unanswered_bus_is_not_ready(self):
        def hang(*args, **kwargs):
            raise subprocess.TimeoutExpired("dbus-send", 10)

        with (
            patch.object(plasma.shutil, "which", return_value="/usr/bin/dbus-send"),
            patch.object(plasma.subprocess, "run", side_effect=hang),
        ):
            self.assertFalse(plasma.has_owner({}, "org.kde.KWin"))
            self.assertFalse(plasma.start_portal({}))

    def test_listed_activatable_names_do_not_count_as_owners(self):
        result = subprocess.CompletedProcess([], 0, stdout="   boolean false\n")
        with patch.object(plasma, "bus", return_value=result):
            self.assertFalse(plasma.has_owner({}, "org.kde.plasmashell"))
        with patch.object(
            plasma, "bus", return_value=subprocess.CompletedProcess([], 1, stdout="")
        ):
            self.assertFalse(plasma.has_owner({}, "org.kde.KWin"))


class GroupStopTests(unittest.TestCase):
    def test_group_membership_tolerates_a_name_cut_inside_a_utf8_character(self):
        with tempfile.TemporaryDirectory() as temporary:
            proc = Path(temporary)
            (proc / "40").mkdir()
            name = ("ñ" * 8).encode()[:15]
            (proc / "40" / "stat").write_bytes(b"40 (" + name + b") S 1 4242 4242 0 -1")
            (proc / "41").mkdir()
            (proc / "41" / "stat").write_bytes(b"41 (a b) c) S 1 77 77 0 -1")
            self.assertTrue(plasma.group_alive(4242, proc))
            self.assertTrue(plasma.group_alive(77, proc))
            self.assertFalse(plasma.group_alive(4243, proc))

    def test_never_signals_the_free_id_of_a_reaped_empty_group(self):
        child = FakeProcess(["kwin_wayland"], 4243)
        child.returncode = 0
        with (
            patch.object(plasma.os, "killpg", create=True) as signal_group,
            patch.object(plasma, "group_alive", return_value=False),
        ):
            plasma.stop(child)
        signal_group.assert_not_called()

    def test_stops_descendants_that_outlive_their_group_leader(self):
        child = subprocess.Popen(["/bin/sh", "-c", "sleep 30 & exit 0"], start_new_session=True)
        deadline = plasma.time.monotonic() + 5
        while child.poll() is None and plasma.time.monotonic() < deadline:
            plasma.time.sleep(0.05)
        self.assertEqual(child.returncode, 0)
        self.assertTrue(plasma.group_alive(child.pid))
        plasma.stop(child)
        self.assertFalse(plasma.group_alive(child.pid))

    def test_reports_a_group_that_does_not_stop(self):
        child = FakeProcess(["kwin_wayland"], 4242)
        child.returncode = 0
        with (
            patch.object(plasma.os, "killpg"),
            patch.object(plasma, "group_alive", return_value=True),
            patch.object(plasma.time, "sleep"),
            patch.object(plasma.time, "monotonic", side_effect=[0, 0, 100, 100, 200, 200]),
        ):
            with self.assertRaisesRegex(plasma.PlasmaError, "remain after shutdown"):
                plasma.stop(child)


if __name__ == "__main__":
    unittest.main()
