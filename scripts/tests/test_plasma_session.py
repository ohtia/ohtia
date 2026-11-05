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
        self.daemon_pid = 3999
        self.frontend_environment = None
        self.preexisting = {}
        self.service_cleanup = None

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
            self.assertEqual(
                arguments[1:],
                [
                    f"XDG_RUNTIME_DIR={self.runtime}",
                    f"WAYLAND_DISPLAY={plasma.SOCKET}",
                    "XDG_CURRENT_DESKTOP=KDE",
                    "XDG_SESSION_TYPE=wayland",
                    "KDE_SESSION_VERSION=6",
                    "QT_QPA_PLATFORM=wayland",
                ],
            )
            self.assertNotIn("WAYLAND_DISPLAY", options["env"])
            return subprocess.CompletedProcess(arguments, self.update_status)
        method = arguments[6].rsplit(".", 1)[1]
        name = arguments[7].removeprefix("string:")
        if method == "GetConnectionUnixProcessID":
            pid = {"org.freedesktop.DBus": self.daemon_pid, plasma.FRONTEND: 3998}.get(name)
            return subprocess.CompletedProcess(
                arguments, 0 if pid else 1, stdout=f"   uint32 {pid}\n" if pid else ""
            )
        if method == "NameHasOwner":
            started = {p.arguments[0] for p in self.processes}
            owned = self.owners.get(name, False) and (
                name != "org.kde.KWin" or "kwin_wayland" in started or self.foreign_kwin
            )
            return subprocess.CompletedProcess(
                arguments, 0, stdout=f"   boolean {'true' if owned else 'false'}\n"
            )
        self.assertEqual(method, "StartServiceByName")
        if name == plasma.FRONTEND:
            return subprocess.CompletedProcess(arguments, 0, stdout="   uint32 2\n")
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
            patch.object(plasma, "environment_entries", side_effect=self.entries),
            patch.object(plasma, "stop_session_processes", side_effect=self.cleanup),
            patch.object(plasma, "session_processes", side_effect=self.scan),
            patch.object(plasma, "identities", side_effect=lambda pids: dict.fromkeys(pids, b"1")),
        )

    def scan(self, runtime, excluded):
        self.assertEqual(runtime, self.runtime)
        self.assertEqual(excluded.get(self.daemon_pid), b"1")
        return self.preexisting

    def entries(self, pid, proc=None):
        self.assertEqual(pid, 3998)
        if self.frontend_environment is not None:
            return self.frontend_environment
        return [b"XDG_CURRENT_DESKTOP=KDE", b"XDG_RUNTIME_DIR=" + os.fsencode(self.runtime)]

    def cleanup(self, runtime, excluded):
        self.assertEqual(runtime, self.runtime)
        self.assertIn(self.daemon_pid, excluded)
        self.assertIn(os.getpid(), excluded)
        self.order.append(("cleanup", "session processes"))
        if self.service_cleanup is not None:
            self.service_cleanup(runtime, excluded)

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
        # KWin activates the portal frontend at startup, so the update must precede KWin.
        self.assertLess(update, self.order.index(("start", "kwin_wayland")))
        self.assertEqual(
            [entry for entry in self.order if entry[0] in ("stop", "cleanup")],
            [("stop", "plasmashell"), ("stop", "kwin_wayland"), ("cleanup", "session processes")],
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

    def test_activation_environment_failure_fails_before_kwin(self):
        self.update_status = 1
        self.failure("activation environment update failed")
        self.assertEqual([entry for entry in self.order if entry[0] == "start"], [])

    def test_portal_frontend_without_the_plasma_environment_fails_the_cell(self):
        runtime = b"XDG_RUNTIME_DIR=" + os.fsencode(self.runtime)
        for label, environment in (
            ("other desktop", [b"XDG_CURRENT_DESKTOP=GNOME", runtime]),
            ("caller runtime", [b"XDG_CURRENT_DESKTOP=KDE", b"XDG_RUNTIME_DIR=/run/user/1000"]),
            ("unreadable", []),
        ):
            with self.subTest(label=label):
                self.order.clear()
                self.processes.clear()
                (self.runtime / plasma.SOCKET).unlink(missing_ok=True)
                self.frontend_environment = environment
                self.failure("not running with the Plasma session environment", ready_seconds=0.01)

    def test_a_runtime_already_carried_by_other_processes_is_refused_before_kwin(self):
        self.preexisting = {4100: b"700"}
        with self.assertRaisesRegex(plasma.PlasmaError, "already use this runtime directory"):
            with self.enter():
                self.fail("A shared runtime marker must not start a session.")
        self.assertEqual(self.processes, [])

    def test_the_login_runtime_is_refused_and_a_caller_supplied_one_is_admitted(self):
        uid = os.getuid()
        self.assertTrue(plasma.login_runtime(Path(f"/run/user/{uid}")))
        self.assertTrue(plasma.login_runtime(Path(f"/run/user/{uid}/../{uid}")))
        self.assertFalse(plasma.login_runtime(Path(f"/run/user/{uid}/op")))
        with patch.object(plasma, "login_runtime", return_value=True):
            with self.assertRaisesRegex(plasma.PlasmaError, "not the login runtime"):
                with self.enter():
                    self.fail("The login runtime must not become a session runtime.")
        self.assertEqual(self.processes, [])
        # The contributor and Scaleway routes pass the session runtime in their own environment.
        self.base["XDG_RUNTIME_DIR"] = str(self.runtime)
        with self.enter() as env:
            self.assertEqual(env["XDG_RUNTIME_DIR"], str(self.runtime))

    def test_an_unidentified_bus_daemon_fails_before_starting_kwin(self):
        self.daemon_pid = None
        with self.assertRaisesRegex(plasma.PlasmaError, "did not identify itself"):
            with self.enter():
                self.fail("The session must not start without its bus daemon identity.")
        self.assertEqual(self.processes, [])

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

    def teardown_trace(self, failures, body=None):
        trace = []

        def step(name):
            def run(*args):
                if name != "release" and args[0] is None:
                    return
                label = name if name == "release" else args[0].arguments[0]
                trace.append(label)
                if name != "release":
                    args[0].returncode = 0
                if label in failures:
                    raise failures[label]

            return run

        self.enterContext(patch.object(plasma, "stop", side_effect=step("stop")))
        self.enterContext(
            patch.object(plasma, "release_document_mount", side_effect=step("release"))
        )

        def services(runtime, excluded):
            trace.append("services")
            if "services" in failures:
                raise failures["services"]

        self.service_cleanup = services
        try:
            with self.enter():
                if body is not None:
                    raise body
        except BaseException as error:
            return trace, error
        return trace, None

    def test_teardown_runs_every_step_and_keeps_the_first_or_earlier_failure(self):
        shell = plasma.PlasmaError("plasmashell helpers remain after shutdown.")
        kwin = plasma.PlasmaError("kwin_wayland helpers remain after shutdown.")
        mount = plasma.PlasmaError("The document portal mount could not be released.")
        body = plasma.PlasmaError("KWin or plasmashell exited during the session.")
        services = plasma.PlasmaError("Processes of the private Plasma session remain.")
        steps = ["plasmashell", "kwin_wayland", "release", "services"]
        for label, failures, raised, expected in (
            ("clean", {}, None, None),
            ("shell", {"plasmashell": shell}, None, shell),
            ("kwin and mount", {"kwin_wayland": kwin, "release": mount}, None, kwin),
            ("mount only", {"release": mount}, None, mount),
            ("services only", {"services": services}, None, services),
            ("body keeps precedence", {"release": mount}, body, body),
            ("interrupted shell", {"plasmashell": KeyboardInterrupt()}, None, KeyboardInterrupt),
        ):
            with self.subTest(label=label):
                self.order.clear()
                self.processes.clear()
                (self.runtime / plasma.SOCKET).unlink(missing_ok=True)
                trace, error = self.teardown_trace(failures, raised)
                self.assertEqual(trace, steps)
                if expected is KeyboardInterrupt:
                    self.assertIsInstance(error, KeyboardInterrupt)
                else:
                    self.assertIs(error, expected)

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


class DocumentMountTests(unittest.TestCase):
    def test_mount_table_finds_escaped_and_dead_fuse_mounts(self):
        with tempfile.TemporaryDirectory() as temporary:
            table = Path(temporary) / "mountinfo"
            table.write_bytes(
                b"36 25 0:32 / /run/user/1000/kde\\040x/doc rw - fuse.portal portal rw\n"
                b"37 25 0:33 / /tmp rw - tmpfs tmpfs rw\n"
            )
            self.assertTrue(plasma.mounted(Path("/run/user/1000/kde x/doc"), table))
            self.assertFalse(plasma.mounted(Path("/run/user/1000/kde x"), table))
            with patch.object(plasma.os.path, "ismount", return_value=True) as fallback:
                self.assertTrue(plasma.mounted(Path("/x"), Path(temporary) / "missing"))
            fallback.assert_called_once()

    def test_a_hung_unmount_fails_the_session(self):
        def hang(*args, **kwargs):
            raise subprocess.TimeoutExpired("fusermount3", 10)

        with (
            patch.object(plasma, "mounted", return_value=True),
            patch.object(plasma.shutil, "which", return_value="/usr/bin/fusermount3"),
            patch.object(plasma.subprocess, "run", side_effect=hang),
            self.assertRaisesRegex(plasma.PlasmaError, "could not be released"),
        ):
            plasma.release_document_mount(Path("/run/user/1000/kde-x"), {"PATH": "/usr/bin"})

    def test_release_detaches_only_a_mounted_document_portal(self):
        runtime = Path("/run/user/1000/kde-x")
        with patch.object(plasma.subprocess, "run") as run:
            with patch.object(plasma, "mounted", return_value=False):
                plasma.release_document_mount(runtime, {"PATH": "/usr/bin"})
            run.assert_not_called()
        states = iter([True, False])
        with (
            patch.object(plasma, "mounted", side_effect=lambda path: next(states)),
            patch.object(plasma.shutil, "which", return_value="/usr/bin/fusermount3"),
            patch.object(
                plasma.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
            ) as run,
        ):
            plasma.release_document_mount(runtime, {"PATH": "/usr/bin"})
        self.assertEqual(
            run.call_args.args[0], ["/usr/bin/fusermount3", "-u", "-z", str(runtime / "doc")]
        )

    def test_a_mount_that_cannot_be_released_fails_the_session(self):
        runtime = Path("/run/user/1000/kde-x")
        for which, status in (("/usr/bin/fusermount3", 1), (None, 0)):
            with (
                self.subTest(which=which, status=status),
                patch.object(plasma, "mounted", return_value=True),
                patch.object(plasma.shutil, "which", return_value=which),
                patch.object(
                    plasma.subprocess, "run", return_value=subprocess.CompletedProcess([], status)
                ),
                self.assertRaises(plasma.PlasmaError),
            ):
                plasma.release_document_mount(runtime, {"PATH": "/usr/bin"})


class SessionServiceTests(unittest.TestCase):
    def setUp(self):
        self.handles = []

    def handle(self, pid):
        # A real descriptor stands in for the process handle, so closing it is observable.
        descriptor = os.open(os.devnull, os.O_RDONLY)
        self.handles.append(descriptor)
        return descriptor

    def assertClosed(self):
        self.assertTrue(self.handles)
        for descriptor in self.handles:
            with self.assertRaises(OSError):
                os.fstat(descriptor)

    def fake_proc(self, root, pid, *, state="S", start="900", environment=b"", ppid=1):
        entry = root / str(pid)
        entry.mkdir()
        (entry / "stat").write_bytes(
            f"{pid} (svc) {state} {ppid} 0 0 0 -1 0 0 0 0 0 0 0 0 0 0 0 1 0 {start} 0".encode()
        )
        (entry / "environ").write_bytes(environment)

    def test_finds_only_live_owned_processes_of_this_runtime_directory(self):
        runtime = Path("/run/user/1000/op")
        mine = b"XDG_RUNTIME_DIR=/run/user/1000/op\0DBUS_SESSION_BUS_ADDRESS=unix:path=x\0"
        with tempfile.TemporaryDirectory() as temporary:
            proc = Path(temporary)
            self.fake_proc(proc, 50, environment=mine)
            self.fake_proc(proc, 51, environment=b"XDG_RUNTIME_DIR=/run/user/1000/op2\0")
            self.fake_proc(proc, 52, environment=b"XDG_RUNTIME_DIR=/run/user/1000\0")
            self.fake_proc(proc, 53, state="Z", environment=mine)
            self.fake_proc(proc, 54, environment=mine)
            self.fake_proc(proc, 55, environment=b"")
            (proc / "self").mkdir()
            self.fake_proc(proc, 56, start="905", environment=mine)
            # 54 is excluded by its identity; 56 reuses an excluded PID with another start time.
            excluded = {54: b"900", 56: b"111"}
            self.assertEqual(
                plasma.session_processes(runtime, excluded, proc), {50: b"900", 56: b"905"}
            )
            with patch.object(plasma.os, "getuid", return_value=os.getuid() + 1):
                self.assertEqual(plasma.session_processes(runtime, {}, proc), {})

    def test_ancestors_include_this_process_and_its_parent(self):
        found = plasma.ancestors()
        self.assertIn(os.getpid(), found)
        self.assertIn(os.getppid(), found)
        with tempfile.TemporaryDirectory() as temporary:
            proc = Path(temporary)
            self.fake_proc(proc, 700, ppid=1)
            self.fake_proc(proc, 1, ppid=0)
            with patch.object(plasma.os, "getpid", return_value=700):
                self.assertEqual(plasma.ancestors(proc), {700, 1})

    def test_a_launcher_that_carries_the_marker_never_selects_itself(self):
        # The contributor and Scaleway launchers run with the session runtime in their own
        # environment; the real scan with the real ancestors must not report them.
        with tempfile.TemporaryDirectory(prefix="op-") as runtime:
            code = (
                "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); "
                "import plasma_session as p; "
                "print(sorted(p.session_processes(Path(sys.argv[2]), p.identities(p.ancestors()))))"
            )
            result = subprocess.run(
                [sys.executable, "-c", code, str(Path(plasma.__file__).parent), runtime],
                env={**os.environ, "XDG_RUNTIME_DIR": runtime},
                capture_output=True,
                text=True,
                check=True,
                timeout=30,
            )
            self.assertEqual(result.stdout.strip(), "[]")

    def test_stops_a_leftover_service_and_spares_excluded_processes(self):
        with tempfile.TemporaryDirectory(prefix="op-") as runtime:
            env = {**os.environ, "XDG_RUNTIME_DIR": runtime}
            leftover = subprocess.Popen(["sleep", "30"], env=env, start_new_session=True)
            spared = subprocess.Popen(["sleep", "30"], env=env, start_new_session=True)
            try:
                deadline = plasma.time.monotonic() + 5
                while plasma.time.monotonic() < deadline and set(
                    plasma.session_processes(Path(runtime), {})
                ) != {leftover.pid, spared.pid}:
                    plasma.time.sleep(0.05)
                plasma.stop_session_processes(Path(runtime), plasma.identities({spared.pid}))
                self.assertIsNotNone(leftover.wait(timeout=5))
                self.assertIsNone(spared.poll())
            finally:
                for process in (leftover, spared):
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=5)

    def test_never_signals_a_reused_identifier_and_reports_survivors(self):
        with (
            patch.object(plasma, "session_processes", return_value={60: b"900"}),
            patch.object(plasma, "process_start", return_value=(b"S", b"901")),
            patch.object(plasma.os, "pidfd_open", side_effect=self.handle, create=True),
            patch.object(plasma.signal, "pidfd_send_signal", create=True) as send,
            patch.object(plasma.time, "sleep"),
            patch.object(plasma.time, "monotonic", side_effect=[0, 0, 100, 100, 200, 200]),
            self.assertRaisesRegex(plasma.PlasmaError, "remain after shutdown"),
        ):
            plasma.stop_session_processes(Path("/run/user/1000/op"), {})
        send.assert_not_called()
        self.assertClosed()

    def test_signals_only_through_a_handle_checked_after_opening(self):
        order = []
        with (
            patch.object(
                plasma.os,
                "pidfd_open",
                side_effect=lambda pid: order.append("open") or self.handle(pid),
                create=True,
            ),
            patch.object(
                plasma,
                "process_start",
                side_effect=lambda pid, proc: order.append("check") or (b"S", b"900"),
            ),
            patch.object(
                plasma.signal,
                "pidfd_send_signal",
                side_effect=lambda fd, sig: order.append(("send", fd == self.handles[-1], sig)),
                create=True,
            ),
        ):
            plasma.signal_identified(60, b"900", plasma.signal.SIGTERM)
        self.assertEqual(order, ["open", "check", ("send", True, plasma.signal.SIGTERM)])
        self.assertClosed()
        for error in (PermissionError(), ProcessLookupError()):
            with (
                self.subTest(error=type(error).__name__),
                patch.object(plasma.os, "pidfd_open", side_effect=self.handle, create=True),
                patch.object(plasma, "process_start", return_value=(b"S", b"900")),
                patch.object(plasma.signal, "pidfd_send_signal", side_effect=error, create=True),
            ):
                plasma.signal_identified(60, b"900", plasma.signal.SIGTERM)
                self.assertClosed()
        with patch.object(plasma.os, "pidfd_open", side_effect=ProcessLookupError(), create=True):
            plasma.signal_identified(60, b"900", plasma.signal.SIGTERM)

    def test_portal_frontend_must_carry_the_plasma_session_environment(self):
        replies = {
            "StartServiceByName": subprocess.CompletedProcess([], 0, stdout="   uint32 2\n"),
            "GetConnectionUnixProcessID": subprocess.CompletedProcess(
                [], 0, stdout="   uint32 70\n"
            ),
        }
        env = {"XDG_RUNTIME_DIR": "/run/user/1000/op"}
        with tempfile.TemporaryDirectory() as temporary:
            proc = Path(temporary)
            (proc / "70").mkdir()
            with patch.object(plasma, "bus", side_effect=lambda _env, method, *a: replies[method]):
                for environment, expected in (
                    (b"XDG_CURRENT_DESKTOP=KDE\0XDG_RUNTIME_DIR=/run/user/1000/op\0", True),
                    (b"XDG_RUNTIME_DIR=/run/user/1000/op\0", False),
                    (b"XDG_CURRENT_DESKTOP=KDE\0XDG_RUNTIME_DIR=/run/user/1000\0", False),
                ):
                    (proc / "70" / "environ").write_bytes(environment)
                    self.assertIs(plasma.portal_on_plasma(env, proc), expected)
                replies["GetConnectionUnixProcessID"] = subprocess.CompletedProcess([], 1)
                self.assertFalse(plasma.portal_on_plasma(env, proc))


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
