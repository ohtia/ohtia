"""Exercise Linux admission, privacy, repeat setup and read-only diagnosis contracts."""

from __future__ import annotations

import contextlib
import io
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path, PurePosixPath
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import linux_contributor as linux


class LinuxContributorTests(unittest.TestCase):
    def setUp(self):
        # Native Linux operations are controlled fixtures on every test host.
        patcher = patch.object(
            linux.os,
            "getuid",
            return_value=getattr(os, "getuid", lambda: Path(tempfile.gettempdir()).stat().st_uid)(),
            create=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        native_target = linux.workspace.target_id
        target = patch.object(
            linux.workspace,
            "target_id",
            side_effect=lambda: native_target(
                system="Linux", machine=linux.platform.machine() or "x86_64"
            ),
        )
        target.start()
        self.addCleanup(target.stop)

    def profile(self, name="ubuntu-26.04", arch="x86_64"):
        distro, version = name.split("-", 1)
        with (
            patch.object(linux.sys, "platform", "linux"),
            patch.object(linux.platform, "machine", return_value=arch),
            patch.object(linux.platform, "system", return_value="Linux"),
            patch.object(
                linux.platform,
                "freedesktop_os_release",
                return_value={"ID": distro, "VERSION_ID": version, "VARIANT_ID": "workstation"},
            ),
        ):
            return linux.native_profile()

    def test_every_declared_linux_profile_and_cpu_has_an_exact_route(self):
        targets = linux.read(linux.ROOT / "config/desktop/targets.json")["targets"]
        required = set()
        for target in targets:
            if target["os"] != "linux":
                continue
            for profile in target["distribution_profiles"]:
                required.add(profile["id"])
                for alias in target["aliases"]:
                    actual, chosen, route = self.profile(profile["id"], alias)
                    self.assertEqual(actual, target["id"])
                    self.assertEqual(chosen, profile)
                    self.assertIn(route["manager"], ("apt-get", "dnf"))
                    self.assertIn("python3", route["packages"])
                    self.assertEqual(len(route["packages"]), len(set(route["packages"])))
        self.assertEqual(
            set(linux.read(linux.ROOT / "config/desktop/linux-contributor.json")["profiles"]),
            required,
        )

    def test_unsupported_distro_and_fedora_edition_are_refused_without_execution(self):
        for release in (
            {"ID": "ubuntu", "VERSION_ID": "25.10"},
            {"ID": "fedora", "VERSION_ID": "44", "VARIANT_ID": "kde"},
            {"ID": "PRIVATE-HOST", "VERSION_ID": "PRIVATE-VERSION"},
        ):
            with patch.object(linux.platform, "freedesktop_os_release", return_value=release):
                with self.assertRaises(linux.ContributorError) as error:
                    linux.native_profile()
                self.assertNotIn("PRIVATE", str(error.exception))

    def test_prerequisite_preview_never_executes_or_elevates(self):
        _, _, route = self.profile()
        with (
            patch.object(linux.subprocess, "run") as run,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            linux.prerequisites(route, install=False)
        run.assert_not_called()
        commands = linux.package_commands(route)
        self.assertEqual(commands[0], ["sudo", "apt-get", "update"])
        self.assertIn("--no-upgrade", commands[1])
        self.assertNotIn("-y", commands[1])
        self.assertIn("libatspi2.0-0t64", commands[1])

    def test_root_setup_stops_before_creating_any_local_environment(self):
        with (
            patch.object(linux.os, "getuid", return_value=0),
            patch.object(linux.workspace, "setup") as setup,
        ):
            with self.assertRaises(linux.ContributorError):
                linux.setup()
        setup.assert_not_called()

    def test_setup_repeat_retains_frozen_inputs_and_failed_retry_invalidates_receipt(self):
        with tempfile.TemporaryDirectory(prefix="Ohtia investigación ") as temporary:
            root = Path(temporary)
            tools = root / ".tooling"
            with (
                patch.object(linux, "RECEIPT", tools / "linux-setup.json"),
                patch.object(linux.workspace, "TOOLS", tools),
                patch.object(linux, "input_hashes", return_value={"pnpm-lock.yaml": "same"}),
                patch.object(linux.workspace, "setup") as setup,
                patch.object(linux.os, "getuid", return_value=1000),
            ):
                linux.setup()
                first = linux.RECEIPT.read_bytes()
                linux.setup()
                self.assertEqual(first, linux.RECEIPT.read_bytes())
                setup.side_effect = linux.workspace.WorkspaceError("network failed")
                with self.assertRaises(linux.workspace.WorkspaceError):
                    linux.setup()
                self.assertFalse(linux.RECEIPT.exists())

    def test_doctor_handles_missing_tools_without_writes_or_private_diagnostics(self):
        _, profile, packages = self.profile()
        with tempfile.TemporaryDirectory(prefix="Ohtia investigación ") as temporary:
            root = Path(temporary)
            marker = root / "sentinel"
            marker.write_bytes(b"unchanged")
            before = list(root.rglob("*"))
            with (
                patch.object(linux, "ROOT", root),
                patch.object(linux, "RECEIPT", root / ".tooling/linux-setup.json"),
                patch.object(
                    linux, "observe", side_effect=FileNotFoundError("/home/private/credential")
                ),
                patch.object(linux, "display_available", return_value=False),
            ):
                result = linux.doctor(profile, packages, None, None)
            self.assertFalse(result["passed"])
            self.assertNotIn("/home/private/credential", json.dumps(result))
            self.assertEqual(list(root.rglob("*")), before)
            self.assertEqual(marker.read_bytes(), b"unchanged")
            for name in (
                "tool:node",
                "tool:pnpm",
                "frozen-inputs",
                "display-session",
                "native-compiler",
            ):
                self.assertFalse(next(c["passed"] for c in result["checks"] if c["check"] == name))

    def test_dead_or_wrong_display_cannot_pass(self):
        _, profile, _ = self.profile()
        with patch.dict(os.environ, {"XDG_SESSION_TYPE": "x11", "DISPLAY": ":0"}, clear=True):
            self.assertFalse(linux.display_available(profile))
        with tempfile.TemporaryDirectory() as temporary:
            endpoint = Path(temporary) / "wayland-0"
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(str(endpoint))
                server.listen()
                with patch.dict(
                    os.environ,
                    {
                        "XDG_SESSION_TYPE": "wayland",
                        "XDG_CURRENT_DESKTOP": "GNOME",
                        "XDG_RUNTIME_DIR": temporary,
                        "WAYLAND_DISPLAY": "wayland-0",
                    },
                    clear=True,
                ):
                    self.assertTrue(linux.display_available(profile))
                    os.environ["WAYLAND_DISPLAY"] = "../private"
                    self.assertFalse(linux.display_available(profile))
            endpoint.unlink()

    def test_inspection_reuses_admission_without_launching_or_exposing_errors(self):
        _, profile, packages = self.profile()

        def observe(command):
            return subprocess.CompletedProcess(
                command, 1, stdout="private /home/path TOKEN=secret", stderr="private details"
            )

        with (
            patch.object(linux, "observe", side_effect=observe) as probe,
            patch.object(linux, "display_available", return_value=False),
        ):
            result = linux.doctor(
                profile,
                packages,
                PurePosixPath("/synthetic/runtime-profile.json"),
                PurePosixPath("/synthetic/runtime"),
            )
        self.assertNotIn("TOKEN", json.dumps(result))
        self.assertNotIn("/synthetic", json.dumps(result))
        self.assertIn("tooling/linux-doctor.mjs", probe.call_args.args[0])
        self.assertFalse(
            next(c["passed"] for c in result["checks"] if c["check"] == "isolated-runtime")
        )

    def test_uv_build_metadata_is_accepted_but_another_version_is_not(self):
        _, profile, packages = self.profile()
        for actual, expected in (
            ("uv 0.13.5 (reviewed-build)", True),
            ("uv 0.0.0 (other-build)", False),
        ):

            def observe(command):
                return subprocess.CompletedProcess(command, 0, stdout=actual, stderr="")

            with (
                patch.object(linux, "observe", side_effect=observe),
                patch.object(linux, "display_available", return_value=False),
            ):
                result = linux.doctor(profile, packages, None, None)
            self.assertEqual(
                next(c["passed"] for c in result["checks"] if c["check"] == "tool:uv"), expected
            )

    def test_unadmitted_session_never_starts_a_compositor_or_app(self):
        with (
            patch.dict(os.environ, {"DBUS_SESSION_BUS_ADDRESS": "unix:path=/synthetic/bus"}),
            patch.object(linux, "observe", return_value=subprocess.CompletedProcess([], 1)),
            patch.object(linux.subprocess, "Popen") as start,
        ):
            with self.assertRaises(linux.ContributorError):
                linux.session(
                    Path("/synthetic/runtime-profile.json"), Path("/synthetic/runtime"), "dev", None
                )
            start.assert_not_called()

    def test_sandbox_policy_is_exact_path_and_rejects_patterns(self):
        with tempfile.TemporaryDirectory(prefix="Ohtia investigación ") as temporary:
            runtime = Path(temporary).resolve()
            (runtime / "prepared.json").write_text("{}")
            with patch.object(
                linux,
                "inspect_context",
                return_value={"executable": str(runtime / "runtime/electron")},
            ) as admission:
                policy = linux.sandbox_policy(Path("/synthetic/runtime-profile.json"), runtime)
                self.assertIn('"' + str(runtime / "runtime/electron") + '"', policy)
                self.assertIn("  userns,", policy)
                admission.return_value = {"executable": str(runtime / "runtime*/electron")}
                with self.assertRaises(linux.ContributorError):
                    linux.sandbox_policy(Path("/synthetic/runtime-profile.json"), runtime)
                admission.return_value = {"executable": str(runtime.parent / "outside/electron")}
                with self.assertRaises(linux.ContributorError):
                    linux.sandbox_policy(Path("/synthetic/runtime-profile.json"), runtime)

    def test_setup_refuses_foreign_environment_before_mutating_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "checkout"
            foreign = Path(temporary) / "other-checkout-tools"
            root.mkdir()
            foreign.mkdir()
            (root / ".tooling").symlink_to(foreign, target_is_directory=True)
            with (
                patch.object(linux, "ROOT", root),
                patch.object(linux.os, "getuid", return_value=1000),
                patch.object(linux.workspace, "setup") as setup,
            ):
                with self.assertRaises(linux.ContributorError):
                    linux.setup()
                setup.assert_not_called()
            self.assertEqual(list(foreign.iterdir()), [])

    def test_policy_uses_admitted_snapshot_without_rereading_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary).resolve()
            (runtime / "prepared.json").write_text("{}")
            with (
                patch.object(
                    linux,
                    "inspect_context",
                    return_value={"executable": str(runtime / "runtime/electron")},
                ),
                patch.object(
                    linux, "read", side_effect=AssertionError("Unvalidated profile reread")
                ),
            ):
                policy = linux.sandbox_policy(Path("/synthetic/runtime-profile.json"), runtime)
            self.assertIn(str(runtime / "runtime/electron"), policy)

    def test_diagnosis_does_not_inherit_injection_or_external_bytecode_cache(self):
        with (
            patch.dict(
                os.environ,
                {
                    "NODE_OPTIONS": "--require=/synthetic/private.js",
                    "NODE_COMPILE_CACHE": "/synthetic/foreign-cache",
                    "PYTHONPYCACHEPREFIX": "/synthetic/foreign-python",
                },
            ),
            patch.object(
                linux.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, stdout="version", stderr=""),
            ) as run,
        ):
            linux.observe(["synthetic-tool", "--version"])
        env = run.call_args.kwargs["env"]
        for key in ("NODE_OPTIONS", "NODE_COMPILE_CACHE", "PYTHONPYCACHEPREFIX"):
            self.assertNotIn(key, env)
        self.assertEqual(env["UV_CACHE_DIR"], str(linux.ROOT / ".cache/uv"))

    def test_identical_runtime_bytes_in_another_directory_have_distinct_policy_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            names = []
            for name in ("first", "second"):
                runtime = Path(temporary).resolve() / name
                runtime.mkdir()
                (runtime / "prepared.json").write_text("{}")
                with patch.object(
                    linux,
                    "inspect_context",
                    return_value={"executable": str(runtime / "runtime/electron")},
                ):
                    policy = linux.sandbox_policy(Path("/synthetic/runtime-profile.json"), runtime)
                names.append(policy.splitlines()[2].split()[1])
            self.assertNotEqual(names[0], names[1])

    def test_malformed_manifest_types_have_a_controlled_private_diagnostic(self):
        output = io.StringIO()
        with (
            patch.object(
                linux, "native_profile", return_value=("linux-x64", {}, {"packages": None})
            ),
            patch.object(sys, "argv", ["linux_contributor.py", "doctor"]),
            patch.object(linux, "observe", side_effect=FileNotFoundError("/home/private/tool")),
            contextlib.redirect_stderr(output),
        ):
            result = linux.main()
        self.assertEqual(result, 1)
        self.assertIn("private exception text is omitted", output.getvalue())
        self.assertNotIn("Traceback", output.getvalue())
        self.assertNotIn("/home/", output.getvalue())

    def test_wayland_socket_alone_does_not_release_gnome_ui_readiness(self):
        with (
            tempfile.TemporaryDirectory() as temporary,
            socket.socket(socket.AF_UNIX) as display,
            patch.object(linux, "owned_running", return_value=True),
        ):
            directory = Path(temporary)
            display.bind(str(directory / "wayland-0"))
            display.listen()
            compositor = Mock()
            compositor.poll.return_value = None
            notifications = Mock()
            notifications.recv.side_effect = [b"STATUS=initializing", b"READY=0", b"READY=1"]
            self.assertEqual(
                linux.wait_for_compositor(compositor, directory, notifications), "wayland-0"
            )
            self.assertEqual(notifications.recv.call_count, 3)

    def test_missing_gnome_ready_notification_fails_closed(self):
        compositor = Mock()
        compositor.poll.return_value = None
        notifications = Mock()
        notifications.recv.side_effect = TimeoutError()
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(linux.time, "monotonic", side_effect=[0, 0, 2]),
            patch.object(linux, "owned_running", return_value=True),
        ):
            with self.assertRaisesRegex(linux.ContributorError, "UI readiness timed out"):
                linux.wait_for_compositor(compositor, Path(temporary), notifications, timeout=1)
        notifications.recv.assert_called_once_with(4096)

    def test_debian_disabled_clone_switch_fails_even_with_available_namespaces(self):
        _, profile, packages = self.profile("debian-13")
        original = Path.read_text
        for switch in ("0", "1"):

            def contents(path, *args, **kwargs):
                if path.as_posix() == "/proc/sys/kernel/unprivileged_userns_clone":
                    return switch
                if path.as_posix() == "/proc/sys/user/max_user_namespaces":
                    return "128132"
                return original(path, *args, **kwargs)

            with (
                patch.object(Path, "read_text", contents),
                patch.object(linux, "observe", side_effect=FileNotFoundError()),
                patch.object(linux, "display_available", return_value=False),
            ):
                result = linux.doctor(profile, packages, None, None)
            checks = {item["check"]: item["passed"] for item in result["checks"]}
            self.assertTrue(checks["user-namespaces"])
            self.assertEqual(checks["debian-unprivileged-userns"], switch == "1")

    def test_private_bus_replaces_inherited_address_and_reaps_its_daemon(self):
        with tempfile.TemporaryDirectory() as temporary, socket.socket(socket.AF_UNIX) as server:
            directory = Path(temporary)
            endpoint = directory / "bus"
            server.bind(str(endpoint))
            child = Mock()
            log = io.BytesIO()
            inherited = {"DBUS_SESSION_BUS_ADDRESS": "unix:path=/synthetic/user-bus"}
            with (
                patch.object(linux.subprocess, "Popen", return_value=child) as start,
                patch.object(linux, "owned_running", return_value=True),
                patch.object(linux, "stop_owned_group") as stop,
            ):
                with linux.private_bus(inherited, directory, log) as env:
                    self.assertEqual(env["DBUS_SESSION_BUS_ADDRESS"], "unix:path=" + str(endpoint))
                    self.assertNotEqual(env, inherited)
                    stop.assert_not_called()
                stop.assert_called_once_with(child)
            self.assertIn("--nofork", start.call_args.args[0])
            self.assertTrue(start.call_args.kwargs["start_new_session"])
            self.assertEqual(start.call_args.kwargs["env"], env)
            self.assertEqual(inherited["DBUS_SESSION_BUS_ADDRESS"], "unix:path=/synthetic/user-bus")

    def test_bus_group_is_signalled_before_reaping_the_owned_anchor(self):
        child = Mock(pid=123)
        events = []
        child.wait.side_effect = lambda **kwargs: events.append("reap")
        with (
            patch.object(
                linux,
                "_signal_anchored_group",
                side_effect=lambda pid, sig: events.append((pid, sig)),
            ),
            patch.object(linux, "group_has_members", return_value=False),
        ):
            linux.stop_owned_group(child)
        self.assertEqual(events, [(123, signal.SIGTERM), (123, signal.SIGKILL), "reap"])

    def test_bus_readiness_observation_retains_the_process_group_anchor(self):
        child = Mock(pid=123)
        with patch.object(linux.os, "waitid", create=True, return_value=None) as wait:
            # Windows only exercises the controlled API call shape, not a native observer.
            with patch.multiple(linux.os, P_PID=1, WEXITED=4, WNOWAIT=8, WNOHANG=16, create=True):
                self.assertTrue(linux.owned_running(child))
        wait.assert_called_once_with(1, 123, 4 | 8 | 16)
        child.poll.assert_not_called()
        child.wait.assert_not_called()

    def test_terminal_signals_latch_and_restore_without_throwing_through_creation(self):
        kinds = [
            getattr(signal, name)
            for name in ("SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT")
            if hasattr(signal, name)
        ]
        previous = {kind: signal.getsignal(kind) for kind in kinds}
        for kind in kinds:
            with linux.terminal_signals() as cancelled:
                self.assertFalse(cancelled())
                signal.getsignal(kind)(kind, None)
                self.assertTrue(cancelled())
            self.assertEqual({k: signal.getsignal(k) for k in kinds}, previous)

    def test_real_terminal_signals_stop_the_supervisors_owned_group(self):
        program = """
import sys, subprocess, time
from pathlib import Path, PurePosixPath
sys.path.insert(0, str(Path(sys.argv[1]) / 'scripts'))
import linux_contributor as linux
with linux.terminal_signals() as cancelled:
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], start_new_session=True)
    try:
        temporary = Path(sys.argv[2]).with_suffix('.tmp')
        temporary.write_text(str(child.pid))
        temporary.replace(sys.argv[2])
        while not cancelled():
            time.sleep(0.01)
    finally:
        linux.stop_owned_group(child)
"""
        for kind in (signal.SIGTERM, signal.SIGHUP, signal.SIGQUIT, signal.SIGINT):
            with tempfile.TemporaryDirectory() as temporary:
                marker = Path(temporary) / "owned-pid"
                child_fd = None
                supervisor = subprocess.Popen(
                    [sys.executable, "-c", program, str(linux.ROOT), str(marker)],
                    cwd=temporary,
                    env=linux.quality_native.build_environment(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                try:
                    deadline = time.monotonic() + 10
                    while (
                        not marker.exists()
                        and supervisor.poll() is None
                        and time.monotonic() < deadline
                    ):
                        time.sleep(0.01)
                    self.assertTrue(
                        marker.exists(), "Supervisor did not publish its synthetic child"
                    )
                    child_pid = int(marker.read_text())
                    child_fd = os.pidfd_open(child_pid)
                    supervisor.send_signal(kind)
                    output, errors = supervisor.communicate(timeout=15)
                    self.assertEqual(supervisor.returncode, 0, (output, errors))
                    with self.assertRaises(ProcessLookupError):
                        signal.pidfd_send_signal(child_fd, 0)
                finally:
                    if child_fd is not None:
                        try:
                            signal.pidfd_send_signal(child_fd, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        os.close(child_fd)
                    if supervisor.poll() is None:
                        supervisor.kill()
                    supervisor.communicate(timeout=5)

    def test_interrupted_admission_reports_cancellation_before_starting_helpers(self):
        def interrupted_probe(command):
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="private failure")

        for entry in ("session", "smoke"):
            with (
                tempfile.TemporaryDirectory() as temporary,
                patch.object(linux.os, "getuid", return_value=1000),
                patch.object(linux, "display_available", return_value=True),
                patch.object(linux, "observe", side_effect=interrupted_probe),
                patch.object(linux.subprocess, "Popen") as start,
            ):
                root = Path(temporary).resolve()
                with self.assertRaisesRegex(linux.ContributorError, "Native session interrupted"):
                    if entry == "session":
                        linux.session(root / "runtime-profile.json", root / "runtime", "dev", None)
                    else:
                        linux.smoke(
                            {}, root / "runtime-profile.json", root / "runtime", root / "evidence"
                        )
                start.assert_not_called()

    def test_foreground_group_interruption_during_admission_has_the_right_remedy(self):
        program = """
import sys, subprocess
from pathlib import Path, PurePosixPath
sys.path.insert(0, str(Path(sys.argv[1]) / 'scripts'))
import linux_contributor as linux
probe = 'from pathlib import Path;import sys,os,time,signal;signal.signal(signal.SIGINT,signal.SIG_DFL);signal.signal(signal.SIGHUP,signal.SIG_DFL);p=Path(sys.argv[1]);t=p.with_suffix(".tmp");t.write_text(str(os.getpid()));t.replace(p);time.sleep(60)'
def observe(_command):
    return subprocess.run([sys.executable, '-c', probe, sys.argv[2]], capture_output=True, text=True)
linux.observe = observe
with linux.terminal_signals() as cancelled:
    try:
        linux.inspect_context(Path('/synthetic/profile'), Path('/synthetic/runtime'), cancelled=cancelled)
    except linux.ContributorError as error:
        print(str(error))
        raise SystemExit(1)
"""
        for kind in (signal.SIGINT, signal.SIGHUP):
            with tempfile.TemporaryDirectory() as temporary:
                marker = Path(temporary) / "admission-pid"
                child_fd = None
                supervisor = subprocess.Popen(
                    [sys.executable, "-c", program, str(linux.ROOT), str(marker)],
                    cwd=temporary,
                    env=linux.quality_native.build_environment(),
                    start_new_session=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                try:
                    deadline = time.monotonic() + 10
                    while (
                        not marker.exists()
                        and supervisor.poll() is None
                        and time.monotonic() < deadline
                    ):
                        time.sleep(0.01)
                    self.assertTrue(marker.exists())
                    child_fd = os.pidfd_open(int(marker.read_text()))
                    os.killpg(supervisor.pid, kind)
                    output, errors = supervisor.communicate(timeout=10)
                    self.assertEqual(supervisor.returncode, 1, errors)
                    self.assertIn(b"Native session interrupted", output)
                    self.assertNotIn(b"Isolation/runtime admission failed", output)
                    with self.assertRaises(ProcessLookupError):
                        signal.pidfd_send_signal(child_fd, 0)
                finally:
                    if child_fd is not None:
                        try:
                            signal.pidfd_send_signal(child_fd, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        os.close(child_fd)
                    if supervisor.poll() is None:
                        supervisor.kill()
                    supervisor.communicate(timeout=5)

    def test_cancelled_compositor_start_stops_before_readiness_or_launch(self):
        compositor = Mock()
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(linux.ContributorError, "interrupted"):
                linux.wait_for_compositor(
                    compositor, Path(temporary), Mock(), cancelled=lambda: True
                )
        compositor.poll.assert_not_called()

    def test_in_process_session_environment_is_filtered_and_restored_on_failure(self):
        before = dict(os.environ)
        with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
            with linux.session_environment(
                {"HOME": "/synthetic", "DBUS_SESSION_BUS_ADDRESS": "unix:path=/synthetic/bus"}
            ):
                self.assertEqual(
                    dict(os.environ),
                    {"HOME": "/synthetic", "DBUS_SESSION_BUS_ADDRESS": "unix:path=/synthetic/bus"},
                )
                raise RuntimeError("synthetic failure")
        self.assertEqual(dict(os.environ), before)

    def test_long_multibyte_scratch_roots_do_not_extend_native_ipc_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            native = parent / str(os.getuid())
            native.mkdir(mode=0o700)
            scratch = parent / ("investigación " * 12)
            scratch.mkdir()
            self.assertGreater(len(os.fsencode(scratch)), 108)
            with patch.object(linux, "RUNTIME_PARENT", parent):
                with linux.private_runtime_directory([str(scratch)]) as directory:
                    self.assertEqual(directory.parent, native)
                    endpoint = directory / "gnome-ready.socket"
                    self.assertLess(len(os.fsencode(endpoint)), 108)
                    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as ready:
                        ready.bind(str(endpoint))
                    self.assertEqual(list(scratch.iterdir()), [])
                self.assertFalse(directory.exists())

    def test_private_runtime_refuses_unsafe_permissions_and_stable_overlap(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            native = parent / str(os.getuid())
            native.mkdir(mode=0o700)
            with patch.object(linux, "RUNTIME_PARENT", parent):
                for stable in (parent, native, native / "stable"):
                    with self.assertRaisesRegex(linux.ContributorError, "stable root"):
                        with linux.private_runtime_directory([str(stable)]):
                            self.fail("Stable overlap was admitted")
                native.chmod(0o755)
                with self.assertRaisesRegex(linux.ContributorError, "runtime directory"):
                    with linux.private_runtime_directory([]):
                        self.fail("Shared runtime directory was admitted")
                self.assertEqual(list(native.iterdir()), [])

    def test_package_parent_alias_is_refused_before_attempt_or_build(self):
        _, profile, _ = self.profile()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            real = root / "real"
            real.mkdir()
            alias = root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with (
                patch.object(linux.os, "getuid", return_value=1000),
                patch.object(linux.subprocess, "run") as build,
            ):
                with self.assertRaisesRegex(linux.ContributorError, "canonical"):
                    linux.package(profile, alias / "attempt", 1)
                build.assert_not_called()
                self.assertEqual(list(real.iterdir()), [])

    def test_package_missing_or_unwritable_parent_stops_before_build(self):
        _, profile, _ = self.profile()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with (
                patch.object(linux.os, "getuid", return_value=1000),
                patch.object(linux.subprocess, "run") as build,
            ):
                with self.assertRaisesRegex(linux.ContributorError, "canonical"):
                    linux.package(profile, root / "missing" / "attempt", 1)
                with patch.object(linux.os, "access", return_value=False):
                    with self.assertRaisesRegex(linux.ContributorError, "writable"):
                        linux.package(profile, root / "attempt", 1)
                build.assert_not_called()
                self.assertEqual(list(root.iterdir()), [])

    def test_multibyte_scratch_over_limit_refuses_app_before_helpers_or_evidence(self):
        for root in ("/" + "a" * 60, "/" + "á" * 30):
            self.assertGreater(len(os.fsencode(root)), linux.MAX_SCRATCH_BYTES)
            with (
                patch.object(linux.os, "getuid", return_value=1000),
                patch.object(linux, "display_available", return_value=True),
                patch.object(linux, "inspect_context", return_value={"scratch_root": root}),
                patch.object(linux.subprocess, "Popen") as start,
                patch.object(Path, "mkdir") as mkdir,
            ):
                with self.assertRaisesRegex(linux.ContributorError, "60-byte"):
                    linux.session(Path("/profile"), Path("/runtime"), "dev", None)
                with self.assertRaisesRegex(linux.ContributorError, "60-byte"):
                    linux.smoke({}, Path("/profile"), Path("/runtime"), Path(root) / "evidence")
                start.assert_not_called()
                mkdir.assert_not_called()

    def test_doctor_reports_scratch_path_limit_without_launching(self):
        _, profile, packages = self.profile()
        for root, expected in (("/" + "a" * 59, True), ("/" + "á" * 30, False)):
            with (
                patch.object(linux, "observe", side_effect=FileNotFoundError()),
                patch.object(linux, "display_available", return_value=False),
                patch.object(linux, "inspect_context", return_value={"scratch_root": root}),
                patch.object(linux.subprocess, "Popen") as start,
            ):
                result = linux.doctor(profile, packages, Path("/profile"), Path("/runtime"))
            self.assertEqual(
                next(
                    c["passed"] for c in result["checks"] if c["check"] == "isolated-scratch-path"
                ),
                expected,
            )
            start.assert_not_called()

    def test_session_refuses_unused_evidence_before_starting_helpers(self):
        with (
            patch.object(linux.os, "getuid", return_value=1000),
            patch.object(linux, "inspect_context", return_value={"scratch_root": "/synthetic"}),
            patch.object(linux.subprocess, "Popen") as start,
        ):
            with self.assertRaisesRegex(linux.ContributorError, "only for native test"):
                linux.session(Path("/profile"), Path("/runtime"), "doctor", Path("/evidence"))
            start.assert_not_called()

    def test_existing_package_attempt_is_preserved(self):
        _, profile, _ = self.profile()
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(linux.os, "getuid", return_value=1000),
            patch.object(linux.desktop_runtime, "assemble") as assemble,
        ):
            marker = Path(temporary) / "keep"
            marker.write_text("evidence")
            with self.assertRaises(linux.ContributorError):
                linux.package(profile, Path(temporary), 1)
            assemble.assert_not_called()
            self.assertEqual(marker.read_text(), "evidence")


if __name__ == "__main__":
    unittest.main()
