"""Contracts for the isolated KWin activation adapter; no native session is simulated as passing."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_kwin_focus as focus


class KWinFocusTests(unittest.TestCase):
    def setUp(self):
        self.gio = SimpleNamespace(DBusCallFlags=SimpleNamespace(NO_AUTO_START=4))
        self.glib = SimpleNamespace(Variant=lambda signature, value: (signature, value))
        self.runtime = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.session = {
            "XDG_RUNTIME_DIR": str(self.runtime),
            "XDG_SESSION_TYPE": "wayland",
            "XDG_CURRENT_DESKTOP": "KDE",
            "KDE_SESSION_VERSION": "6",
            "OHTIA_NATIVE_COMPOSITOR_PID": "42",
        }

    def owned(self, **changes):
        environment = {**self.session, **changes}
        return (
            patch.dict(
                os.environ, {k: v for k, v in environment.items() if v is not None}, clear=True
            ),
            patch.object(sys, "platform", "linux"),
        )

    def test_refuses_an_ordinary_desktop_before_importing_gi_or_opening_a_bus(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.dict(sys.modules, {"gi": None, "gi.repository": None}),
            self.assertRaisesRegex(RuntimeError, "owned headless Plasma"),
        ):
            focus.main(["1234"])

    def test_admits_only_an_owned_plasma_6_session_and_one_process_identifier(self):
        environment, platform = self.owned()
        with environment, platform:
            self.assertEqual(focus.require_owned_session(["1234"]), 1234)
        for change in (
            {"XDG_CURRENT_DESKTOP": "GNOME"},
            {"XDG_CURRENT_DESKTOP": "KDE:GNOME"},
            {"KDE_SESSION_VERSION": "5"},
            {"KDE_SESSION_VERSION": None},
            {"XDG_SESSION_TYPE": "x11"},
            {"XDG_RUNTIME_DIR": None},
            {"OHTIA_NATIVE_COMPOSITOR_PID": "0"},
            {"OHTIA_NATIVE_COMPOSITOR_PID": "42x"},
        ):
            environment, platform = self.owned(**change)
            with self.subTest(change=change), environment, platform:
                with self.assertRaises(RuntimeError):
                    focus.require_owned_session(["1234"])
        for argv in ([], ["0"], ["-1"], ["12a"], ["٤٢"], ["1", "2"]):
            environment, platform = self.owned()
            with self.subTest(argv=argv), environment, platform:
                with self.assertRaisesRegex(RuntimeError, "process identifier"):
                    focus.require_owned_session(argv)

    def test_refuses_a_root_account(self):
        environment, platform = self.owned()
        with environment, platform, patch.object(os, "getuid", return_value=0, create=True):
            with self.assertRaisesRegex(RuntimeError, "unprivileged"):
                focus.require_owned_session(["1234"])

    def test_pins_kwin_to_the_launcher_pid_user_and_headless_process(self):
        uid = os.getuid()
        for owner_uid, pid, arguments, accepted in (
            (uid, 42, b"/usr/bin/kwin_wayland\0--virtual\0--socket\0wayland-ohtia\0", True),
            (uid + 1, 42, b"kwin_wayland\0--virtual\0", False),
            (uid, 43, b"kwin_wayland\0--virtual\0", False),
            (uid, 42, b"kwin_wayland\0--socket\0wayland-0\0", False),
            (uid, 42, b"gnome-shell\0--headless\0--virtual\0", False),
        ):
            with self.subTest(uid=owner_uid, pid=pid, arguments=arguments):
                query = Mock(side_effect=[(":1.4",), (owner_uid,), (pid,)])

                def read(path):
                    self.assertEqual(str(path), "/proc/42/cmdline")
                    return arguments

                with (
                    patch.dict(os.environ, {"OHTIA_NATIVE_COMPOSITOR_PID": "42"}),
                    patch.object(focus, "call", query),
                    patch("pathlib.Path.read_bytes", autospec=True, side_effect=read),
                ):
                    if accepted:
                        self.assertEqual(
                            focus.verify_compositor(Mock(), self.gio, self.glib), ":1.4"
                        )
                    else:
                        with self.assertRaises(RuntimeError):
                            focus.verify_compositor(Mock(), self.gio, self.glib)

    def test_script_selects_the_first_inactive_normal_window_of_the_process(self):
        source = focus.script_source(1234)
        self.assertIn("workspace.windowList()", source)
        self.assertIn("window.pid === 1234", source)
        self.assertIn("window.normalWindow", source)
        self.assertIn("!window.active", source)
        self.assertIn(")[0];", source)
        self.assertIn("workspace.activeWindow = target", source)

    def test_loads_runs_unloads_and_deletes_the_private_script(self):
        calls = []

        def call(bus, gio, destination, path, interface, method, parameters=None):
            calls.append((path, interface, method, parameters))
            if method == "loadScript":
                file = Path(parameters[1][0])
                self.assertEqual(file.parent, self.runtime)
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
                self.assertIn("window.pid === 77", file.read_text())
                return (3,)
            return ()

        environment, platform = self.owned()
        with environment, platform, patch.object(focus, "call", side_effect=call):
            focus.activate(Mock(), self.gio, self.glib, ":1.4", 77)
        self.assertEqual(
            [(path, method) for path, _, method, _ in calls],
            [
                ("/Scripting", "loadScript"),
                ("/Scripting/Script3", "run"),
                ("/Scripting", "unloadScript"),
            ],
        )
        self.assertEqual(calls[1][1], "org.kde.kwin.Script")
        name = calls[0][3][1][1]
        self.assertEqual(calls[2][3], ("(s)", (name,)))
        self.assertEqual(list(self.runtime.iterdir()), [])

    def test_failed_run_still_unloads_and_deletes_the_script(self):
        methods = []

        def call(bus, gio, destination, path, interface, method, parameters=None):
            methods.append(method)
            if method == "loadScript":
                return (0,)
            if method == "run":
                raise RuntimeError("synthetic KWin script failure")
            return ()

        environment, platform = self.owned()
        with environment, platform, patch.object(focus, "call", side_effect=call):
            with self.assertRaisesRegex(RuntimeError, "synthetic KWin"):
                focus.activate(Mock(), self.gio, self.glib, ":1.4", 77)
        self.assertEqual(methods, ["loadScript", "run", "unloadScript"])
        self.assertEqual(list(self.runtime.iterdir()), [])

    def test_refused_load_deletes_the_script_without_running_it(self):
        methods = []

        def call(bus, gio, destination, path, interface, method, parameters=None):
            methods.append(method)
            if method == "loadScript":
                raise RuntimeError("synthetic load refusal")
            return ()

        environment, platform = self.owned()
        with environment, platform, patch.object(focus, "call", side_effect=call):
            with self.assertRaises(RuntimeError):
                focus.activate(Mock(), self.gio, self.glib, ":1.4", 77)
        self.assertEqual(methods, ["loadScript"])
        self.assertEqual(list(self.runtime.iterdir()), [])

    def test_cli_refusal_is_bounded_and_names_kwin_without_traceback(self):
        environment = {k: v for k, v in os.environ.items() if k != "OHTIA_NATIVE_COMPOSITOR_PID"}
        result = subprocess.run(
            [sys.executable, str(Path(focus.__file__)), "1234"],
            env=environment,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("KWin activation failed", result.stderr)
        self.assertIn("owned headless Plasma session", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertLess(len(result.stderr), 400)

    def test_gnome_helper_refuses_a_kde_session(self):
        import quality_wayland_input

        environment, platform = self.owned()
        with environment, platform:
            with self.assertRaisesRegex(RuntimeError, "owned headless Wayland"):
                quality_wayland_input.require_owned_session()


if __name__ == "__main__":
    unittest.main()
