"""Contracts for the isolated compositor-input adapter; no native session is simulated as passing."""

import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_wayland_input as input_adapter


class WaylandInputTests(unittest.TestCase):
    def setUp(self):
        self.gio = SimpleNamespace(DBusCallFlags=SimpleNamespace(NO_AUTO_START=4))
        self.glib = SimpleNamespace(Variant=lambda signature, value: (signature, value))

    def test_refuses_regular_desktop_before_importing_gi_or_opening_bus(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(RuntimeError, "owned"):
            input_adapter.main()

    def test_cli_refusal_is_bounded_and_contains_the_cause_without_traceback(self):
        environment = dict(os.environ)
        environment.pop("OHTIA_NATIVE_COMPOSITOR_PID", None)
        result = subprocess.run(
            [sys.executable, str(Path(input_adapter.__file__))],
            env=environment,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("RuntimeError", result.stderr)
        self.assertIn("owned headless Wayland session", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertLess(len(result.stderr), 400)

    def test_admits_owned_non_ci_session_and_refuses_missing_or_invalid_pid(self):
        environment = {
            "XDG_RUNTIME_DIR": "/run/user/1234",
            "XDG_SESSION_TYPE": "wayland",
            "XDG_CURRENT_DESKTOP": "GNOME",
            "OHTIA_NATIVE_COMPOSITOR_PID": "42",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(os, "getuid", return_value=1234, create=True),
            patch.object(sys, "platform", "linux"),
        ):
            input_adapter.require_owned_session()
            for pid in ("", "0", "-1", "٤٢", "42x"):
                with (
                    self.subTest(pid=pid),
                    patch.dict(os.environ, {"OHTIA_NATIVE_COMPOSITOR_PID": pid}),
                    self.assertRaises(RuntimeError),
                ):
                    input_adapter.require_owned_session()

    def test_pins_both_same_user_bus_owners_to_launcher_pid_without_reading_environment(self):
        for uid, pid, arguments, accepted in (
            (1234, 42, b"/usr/bin/gnome-shell\0--headless\0--wayland\0", True),
            (0, 42, b"gnome-shell\0--headless\0--wayland\0", False),
            (1234, 43, b"gnome-shell\0--headless\0--wayland\0", False),
            (1234, 42, b"gnome-shell\0--wayland\0", False),
            (1234, 42, b"other\0--headless\0--wayland\0", False),
        ):
            with self.subTest(uid=uid, pid=pid, arguments=arguments):
                query = Mock(side_effect=[(":1.7",), (":1.8",), (uid,), (pid,), (uid,), (pid,)])

                def read(path):
                    self.assertEqual(str(path), "/proc/42/cmdline")
                    return arguments

                with (
                    patch.dict(os.environ, {"OHTIA_NATIVE_COMPOSITOR_PID": "42"}),
                    patch.object(os, "getuid", return_value=1234, create=True),
                    patch.object(input_adapter, "call", query),
                    patch("pathlib.Path.read_bytes", autospec=True, side_effect=read),
                ):
                    if accepted:
                        self.assertEqual(
                            input_adapter.verify_compositor(Mock(), self.gio, self.glib),
                            {"remote": ":1.7", "shell": ":1.8"},
                        )
                        self.assertEqual(query.call_args_list[-1].args[-1], ("(s)", (":1.8",)))
                    else:
                        with self.assertRaises(RuntimeError):
                            input_adapter.verify_compositor(Mock(), self.gio, self.glib)

    def test_one_connection_holds_session_until_keys_are_released_and_stopped(self):
        bus = Mock()

        def response(*args):
            value = (
                ("/session/1",)
                if args[3] == "CreateSession"
                else (False,)
                if args[3] == "Get"
                else ()
            )
            return SimpleNamespace(unpack=lambda: value)

        bus.call_sync.side_effect = response
        input_adapter.cycle_window(bus, self.gio, self.glib, {"remote": ":1.7", "shell": ":1.8"})
        calls = bus.call_sync.call_args_list
        self.assertEqual(
            [entry.args[3] for entry in calls],
            [
                "CreateSession",
                "Start",
                "Get",
                "Get",
                "NotifyKeyboardKeycode",
                "NotifyKeyboardKeycode",
                "NotifyKeyboardKeycode",
                "NotifyKeyboardKeycode",
                "Stop",
            ],
        )
        self.assertEqual(
            [entry.args[4] for entry in calls[4:8]],
            [
                ("(ub)", (56, True)),
                ("(ub)", (1, True)),
                ("(ub)", (1, False)),
                ("(ub)", (56, False)),
            ],
        )
        for entry in calls:
            self.assertEqual(entry.args[0], ":1.8" if entry.args[3] == "Get" else ":1.7")
            self.assertEqual(entry.args[-3:], (4, 1000, None))

    def test_dismisses_only_an_observed_shell_overview_before_cycling(self):
        observed = []
        overview = iter([(True,), (True,), (False,)])

        def send(_bus, _gio, _owner, _path, _interface, method, parameters=None):
            observed.append((method, parameters))
            if method == "CreateSession":
                return ("/session/1",)
            if method == "Get":
                return next(overview, (False,))
            return ()

        with (
            patch.object(input_adapter, "call", side_effect=send),
            patch.object(input_adapter.time, "sleep"),
        ):
            input_adapter.cycle_window(
                Mock(), self.gio, self.glib, {"remote": ":1.7", "shell": ":1.8"}
            )
        keys = [parameters for method, parameters in observed if method == "NotifyKeyboardKeycode"]
        self.assertEqual(keys[:2], [("(ub)", (1, True)), ("(ub)", (1, False))])
        self.assertEqual(
            keys[2:],
            [
                ("(ub)", (56, True)),
                ("(ub)", (1, True)),
                ("(ub)", (1, False)),
                ("(ub)", (56, False)),
            ],
        )
        self.assertEqual(observed[-1], ("Stop", None))

    def overview_session(self, active, observed=None, refuse_set=False, latency=0.0):
        """Run cycle_window against a shell whose overview follows the inputs sent.

        A simulated clock advances by each sleep and by `latency` for every D-Bus call.
        """
        observed = [] if observed is None else observed
        self.destinations = []
        self.clock = 0.0

        def sleep(seconds):
            self.clock += seconds

        def send(_bus, _gio, owner, path, interface, method, parameters=None):
            self.clock += latency
            observed.append((method, parameters))
            self.destinations.append((method, owner, path, interface))
            if method == "Set" and refuse_set:
                error = RuntimeError("org.freedesktop.DBus.Error.AccessDenied")
                error.add_note(f"D-Bus operation: {interface}.{method}")
                raise error
            if method == "CreateSession":
                return ("/session/1",)
            if method == "Get":
                escapes = sum(
                    1
                    for name, value in observed
                    if name == "NotifyKeyboardKeycode" and value == ("(ub)", (1, True))
                )
                hidden = any(name == "Set" for name, _ in observed)
                return (active(escapes, hidden),)
            return ()

        with (
            patch.object(input_adapter, "call", side_effect=send),
            patch.object(input_adapter.time, "monotonic", side_effect=lambda: self.clock),
            patch.object(input_adapter.time, "sleep", side_effect=sleep),
        ):
            input_adapter.cycle_window(
                Mock(), self.gio, self.glib, {"remote": ":1.7", "shell": ":1.8"}
            )
        return observed

    def keys(self, observed):
        return [parameters for method, parameters in observed if method == "NotifyKeyboardKeycode"]

    def test_welcome_can_consume_first_escape_before_observed_overview_dismisses(self):
        observed = self.overview_session(lambda escapes, hidden: escapes < 2)
        keys = self.keys(observed)
        self.assertEqual(keys[:4], [("(ub)", (1, True)), ("(ub)", (1, False))] * 2)
        self.assertEqual(
            keys[4:],
            [
                ("(ub)", (56, True)),
                ("(ub)", (1, True)),
                ("(ub)", (1, False)),
                ("(ub)", (56, False)),
            ],
        )
        self.assertNotIn("Set", [method for method, _ in observed])
        self.assertEqual(observed[-1], ("Stop", None))

    def test_an_overview_that_ignores_escape_is_hidden_through_the_shell(self):
        observed = self.overview_session(lambda escapes, hidden: not hidden)
        escapes = [k for k in self.keys(observed) if k == ("(ub)", (1, True))]
        self.assertEqual(len(escapes), input_adapter.OVERVIEW_INPUTS + 1)
        hide = next(parameters for method, parameters in observed if method == "Set")
        self.assertEqual(hide, ("(ssv)", ("org.gnome.Shell", "OverviewActive", ("b", False))))
        self.assertIn(
            ("Set", ":1.8", "/org/gnome/Shell", "org.freedesktop.DBus.Properties"),
            self.destinations,
        )
        self.assertIn(("(ub)", (56, True)), self.keys(observed))
        self.assertEqual(observed[-1], ("Stop", None))

    def test_an_overview_that_stays_active_fails_without_cycling(self):
        observed = []
        with self.assertRaisesRegex(
            RuntimeError, "stayed active after 3 Escape inputs and the shell's hide request"
        ):
            self.overview_session(lambda escapes, hidden: True, observed)
        self.assertNotIn(("(ub)", (56, True)), self.keys(observed))
        self.assertEqual(observed[-1], ("Stop", None))

    def test_a_refused_hide_request_names_the_inputs_and_still_stops(self):
        observed = []
        with self.assertRaises(RuntimeError) as raised:
            self.overview_session(lambda escapes, hidden: True, observed, True)
        message = input_adapter.failure_message(raised.exception)
        self.assertIn("Properties.Set", message)
        self.assertIn("after 3 Escape inputs", message)
        self.assertLessEqual(len(message), 400)
        self.assertNotIn(("(ub)", (56, True)), self.keys(observed))
        self.assertEqual(observed[-1], ("Stop", None))

    def test_a_slow_shell_still_receives_the_hide_request_within_the_deadline(self):
        for latency in (0.2, 0.5, 0.9):
            observed = []
            with (
                self.subTest(latency=latency),
                self.assertRaisesRegex(RuntimeError, "and the shell's hide request"),
            ):
                self.overview_session(lambda escapes, hidden: True, observed, latency=latency)
            self.assertIn("Set", [method for method, _ in observed])
            self.assertEqual(observed[-1], ("Stop", None))
            # Process startup and compositor verification are not simulated here.
            self.assertLess(
                self.clock,
                input_adapter.OVERVIEW_DEADLINE_SECONDS
                + input_adapter.OVERVIEW_WAIT_SECONDS
                + 6 * latency,
            )
        hidden = self.overview_session(lambda escapes, hidden: not hidden, latency=0.2)
        self.assertIn(("(ub)", (56, True)), self.keys(hidden))

    def test_the_overview_dismissal_fits_the_caller_bound(self):
        # The Escape waits fit before the hide reserve, which holds the hide request's
        # wait and its call; the deadline leaves room within the 10 s caller bound.
        escapes = input_adapter.OVERVIEW_INPUTS * input_adapter.OVERVIEW_WAIT_SECONDS
        self.assertLessEqual(
            escapes,
            input_adapter.OVERVIEW_DEADLINE_SECONDS - input_adapter.OVERVIEW_HIDE_RESERVE_SECONDS,
        )
        self.assertLess(
            input_adapter.OVERVIEW_WAIT_SECONDS, input_adapter.OVERVIEW_HIDE_RESERVE_SECONDS
        )
        self.assertLess(input_adapter.OVERVIEW_DEADLINE_SECONDS, 10)
        caller = (
            Path(__file__).resolve().parents[2] / "tooling/command-native-focus.mjs"
        ).read_text()
        self.assertIn("timeout: 10000", caller)

    def test_earliest_dbus_failure_survives_a_cleanup_failure_with_operation(self):
        bus = Mock()
        primary = RuntimeError("synthetic input timeout " + "x" * 400)
        bus.call_sync.side_effect = primary
        try:
            try:
                input_adapter.call(
                    bus, self.gio, ":1.7", "/session/1", "input.Session", "NotifyKeyboardKeycode"
                )
            finally:
                raise RuntimeError("synthetic Stop timeout")
        except RuntimeError as error:
            message = input_adapter.failure_message(error)
        self.assertIn("synthetic input timeout", message)
        self.assertIn("input.Session.NotifyKeyboardKeycode", message)
        self.assertIn("cleanup also failed", message)
        self.assertLessEqual(len(message), 340)

    def test_failed_key_release_still_releases_alt_and_stops(self):
        observed = []

        def send(_bus, _gio, _owner, _path, _interface, method, parameters=None):
            observed.append((method, parameters))
            if method == "CreateSession":
                return ("/session/1",)
            if method == "Get":
                return (False,)
            if parameters == ("(ub)", (1, False)):
                raise RuntimeError("synthetic release refusal")
            return ()

        with patch.object(input_adapter, "call", side_effect=send):
            with self.assertRaisesRegex(RuntimeError, "release refusal"):
                input_adapter.cycle_window(
                    Mock(), self.gio, self.glib, {"remote": ":1.7", "shell": ":1.8"}
                )
        self.assertEqual(
            observed[-2:], [("NotifyKeyboardKeycode", ("(ub)", (56, False))), ("Stop", None)]
        )

    def test_input_error_releases_pressed_keys_and_stops_without_success(self):
        observed = []

        def send(_bus, _gio, _owner, _path, _interface, method, parameters=None):
            observed.append((method, parameters))
            if method == "CreateSession":
                return ("/session/1",)
            if method == "Get":
                return (False,)
            if parameters == ("(ub)", (1, True)):
                raise RuntimeError("synthetic input refusal")
            return ()

        with patch.object(input_adapter, "call", side_effect=send):
            with self.assertRaisesRegex(RuntimeError, "input refusal"):
                input_adapter.cycle_window(
                    Mock(), self.gio, self.glib, {"remote": ":1.7", "shell": ":1.8"}
                )
        self.assertEqual(
            observed[-3:],
            [
                ("NotifyKeyboardKeycode", ("(ub)", (1, False))),
                ("NotifyKeyboardKeycode", ("(ub)", (56, False))),
                ("Stop", None),
            ],
        )


if __name__ == "__main__":
    unittest.main()
