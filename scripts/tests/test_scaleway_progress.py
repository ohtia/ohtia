"""Verify bounded diagnostics with synthetic children and mocked guest/provider transport."""

from __future__ import annotations

import contextlib
import copy
import errno
import io
import json
import os
import runpy
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scaleway_bootstrap as bootstrap
import scaleway_cycle as cycle
import scaleway_progress as progress
import scaleway_qualification as qualification

IDENTITY = {"source_sha": "a" * 40, "run_id": "101", "attempt": "1"}
PRIVATE = "synthetic-private-stderr-marker"


class CommandDiagnosticTests(unittest.TestCase):
    def test_failed_transport_returns_only_normalized_marker_and_status(self):
        for text, expected in (
            ("Permission denied (publickey). " + PRIVATE, "authentication-rejected-marker"),
            ("Connection refused " + PRIVATE, "connection-refused-marker"),
            ("Host key verification failed. " + PRIVATE, "host-key-rejected-marker"),
            ("Connection timed out " + PRIVATE, "connection-timeout-marker"),
            (PRIVATE, "process-failed"),
        ):
            with self.subTest(category=expected):
                diagnostic = {}
                with self.assertRaises(subprocess.CalledProcessError) as result:
                    cycle.command(
                        [
                            sys.executable,
                            "-c",
                            f"import sys;sys.stderr.write({text!r});sys.exit(255)",
                        ],
                        diagnostics=diagnostic,
                    )
                self.assertEqual(diagnostic, {"category": expected, "exit_code": 255})
                self.assertIsNone(result.exception.stderr)
                self.assertIsNone(result.exception.output)
                self.assertNotIn(PRIVATE, json.dumps(diagnostic))

    def test_simultaneous_stdout_and_stderr_do_not_deadlock(self):
        diagnostic = {}
        result = cycle.command(
            [sys.executable, "-c", "import sys;sys.stderr.write('X'*8192);sys.stdout.write('ok')"],
            diagnostics=diagnostic,
        )
        self.assertEqual(result.stdout, b"ok")
        self.assertIsNone(result.stderr)
        self.assertEqual(diagnostic, {"category": "success", "exit_code": 0})

    def test_oversized_private_output_is_drained_without_changing_the_exit_result(self):
        for status in (0, 7):
            with self.subTest(status=status):
                diagnostic = {}
                arguments = [
                    sys.executable,
                    "-c",
                    "import sys;sys.stderr.write('Permission denied (publickey). ' + 'X'*200000);"
                    f"sys.stdout.write('ok');sys.exit({status})",
                ]
                if status:
                    with self.assertRaises(subprocess.CalledProcessError) as error:
                        cycle.command(arguments, diagnostics=diagnostic)
                    self.assertEqual(error.exception.returncode, status)
                    self.assertIsNone(error.exception.stderr)
                    self.assertEqual(
                        diagnostic,
                        {"category": "authentication-rejected-marker", "exit_code": status},
                    )
                else:
                    result = cycle.command(arguments, diagnostics=diagnostic)
                    self.assertEqual(result.stdout, b"ok")
                    self.assertIsNone(result.stderr)
                    self.assertEqual(diagnostic, {"category": "success", "exit_code": 0})

    def test_cancelled_command_terminates_child_and_preserves_cancellation(self):
        diagnostic, children = {}, []
        original = subprocess.Popen

        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            return child

        with (
            patch.object(cycle.subprocess, "Popen", side_effect=spawn),
            patch.object(cycle.selectors.DefaultSelector, "select", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            cycle.command(
                [sys.executable, "-c", "import time;time.sleep(5)"], diagnostics=diagnostic
            )
        self.assertEqual(diagnostic, {"category": "controller-cancelled", "exit_code": None})
        self.assertIsNotNone(children[0].poll())

    def test_cancellation_survives_reap_timeout_without_unbounded_context_wait(self):
        diagnostic, children, waits = {}, [], []
        original = subprocess.Popen
        interruption = KeyboardInterrupt()

        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            wait = child.wait

            def delayed_wait(timeout=None):
                waits.append(timeout)
                if timeout == 5:
                    raise subprocess.TimeoutExpired(args[0], timeout)
                return wait(timeout=timeout)

            child.wait = delayed_wait
            return child

        with (
            patch.object(cycle.subprocess, "Popen", side_effect=spawn),
            patch.object(cycle.selectors.DefaultSelector, "select", side_effect=interruption),
            self.assertRaises(KeyboardInterrupt) as raised,
        ):
            cycle.command(
                [sys.executable, "-c", "import time;time.sleep(5)"], diagnostics=diagnostic
            )
        self.assertIs(raised.exception, interruption)
        self.assertEqual(diagnostic, {"category": "controller-cancelled", "exit_code": None})
        self.assertIn(5, waits)
        self.assertNotIn(None, waits)
        self.assertIsNotNone(children[0].poll())

    def test_stdout_bound_still_applies_when_stderr_is_captured(self):
        selected = copy.deepcopy(cycle.policy())
        selected["limits"]["maximum_json_bytes"] = 64
        diagnostic = {}
        with (
            patch.object(cycle, "policy", return_value=selected),
            self.assertRaisesRegex(cycle.CycleError, "process_output_bound"),
        ):
            cycle.command([sys.executable, "-c", "print('X'*65)"], diagnostics=diagnostic)
        self.assertEqual(diagnostic["category"], "output-limit")

    def test_timeout_terminates_synthetic_child_and_retains_no_stderr(self):
        diagnostic, children = {}, []
        original = subprocess.Popen

        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            return child

        with (
            patch.object(cycle.subprocess, "Popen", side_effect=spawn),
            self.assertRaises(subprocess.TimeoutExpired) as result,
        ):
            cycle.command(
                [
                    sys.executable,
                    "-c",
                    f"import sys,time;sys.stderr.write({PRIVATE!r});sys.stderr.flush();time.sleep(5)",
                ],
                timeout=0.05,
                diagnostics=diagnostic,
            )
        self.assertEqual(diagnostic, {"category": "process-timeout", "exit_code": None})
        self.assertIsNone(result.exception.stderr)
        self.assertIsNone(result.exception.output)
        self.assertIsNotNone(children[0].poll())


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.enterContext(patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}))

    def test_heartbeat_during_silent_work_never_claims_guest_progress(self):
        selected = copy.deepcopy(cycle.policy())
        selected["limits"]["progress_interval_seconds"] = 1
        summary = self.root / "summary.md"
        console = io.StringIO()
        with (
            patch.object(cycle, "policy", return_value=selected),
            patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}),
            contextlib.redirect_stdout(console),
        ):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                observer.phase("bootstrap", deadline=time.monotonic() + 10)
                cycle.command([sys.executable, "-c", "import time;time.sleep(1.2)"])
        events = cycle.read(self.root / "controller-events.json")["events"]
        heartbeat = next(event for event in events if event["event"] == "heartbeat")
        self.assertTrue(heartbeat["controller_alive"])
        self.assertEqual(heartbeat["guest_state"], "unknown")
        self.assertIsNone(heartbeat["last_observed_at"])
        self.assertIn("controller liveness", summary.read_text(encoding="utf-8"))
        self.assertFalse(cycle.read(self.root / "controller-progress.json")["controller_alive"])

    def test_history_console_and_full_record_are_bounded(self):
        selected = copy.deepcopy(cycle.policy())
        selected["limits"]["progress_maximum_records"] = 4
        console = io.StringIO()
        with (
            patch.object(cycle, "policy", return_value=selected),
            contextlib.redirect_stdout(console),
        ):
            with progress.Progress(
                self.root, IDENTITY, "debian-13", "after-native-smoke"
            ) as observer:
                for operation in progress.OPERATIONS:
                    observer.attempted(operation)
                observer.readiness({"python": True, "helper": True})
                observer.transport(
                    "bootstrap-status", {"category": "process-timeout", "exit_code": None}
                )
                for _ in range(10):
                    observer.emit("heartbeat")
        events = cycle.read(self.root / "controller-events.json")["events"]
        self.assertEqual(len(events), 4)
        self.assertEqual(len(console.getvalue().splitlines()), 4)
        self.assertEqual(events[-1]["event"], "final")
        for event in events:
            self.assertLessEqual(
                len((json.dumps(event, sort_keys=True, indent=2) + "\n").encode()),
                selected["limits"]["progress_record_bytes"],
            )

    def test_past_event_counts_are_immutable_and_bootstrap_failure_survives_collection(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                observer.attempted("bootstrap-status")
                observer.transport(
                    "bootstrap-status",
                    {"category": "authentication-rejected-marker", "exit_code": 255},
                )
                observer.attempted("bootstrap-status")
                observer.transport("evidence", {"category": "process-failed", "exit_code": 1})
        events = cycle.read(self.root / "controller-events.json")["events"]
        first = next(row for row in events if row["event"] == "transport")
        self.assertEqual(first["attempts"]["bootstrap-status"], 1)
        retained = cycle.read(self.root / "bootstrap-transport.json")
        self.assertEqual(
            retained["bootstrap_transport_failure"]["category"], "authentication-rejected-marker"
        )

    def test_repeated_observations_keep_fresh_counters_without_flooding_events(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                for _ in range(20):
                    observer.attempted("bootstrap-status")
                    observer.transport("bootstrap-status", {"category": "success", "exit_code": 0})
                    observer.observe("bootstrap-not-ready")
                observer.emit("heartbeat")
        events = cycle.read(self.root / "controller-events.json")["events"]
        self.assertEqual(sum(e["event"] == "transport" for e in events), 1)
        self.assertEqual(sum(e["event"] == "observation" for e in events), 1)
        self.assertEqual(events[-1]["attempts"]["bootstrap-status"], 20)

    def test_missing_helper_is_one_readiness_state_even_after_transport_flaps(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                for attempt in range(100):
                    observer.attempted("ssh-readiness")
                    observer.readiness({"python": True, "helper": False})
                    observer.transport(
                        "ssh-readiness",
                        {
                            "category": "success" if attempt % 2 else "process-timeout",
                            "exit_code": None,
                        },
                    )
                observer.readiness({"python": True, "helper": True})
        events = cycle.read(self.root / "controller-events.json")["events"]
        observations = [e for e in events if e["event"] == "observation"]
        self.assertEqual(len(observations), 2)
        self.assertEqual(observations[0]["last_observation"], "interpreter-or-helper-unavailable")
        self.assertEqual(observations[1]["last_observation"], "ssh-execution-confirmed")
        self.assertEqual(events[-1]["attempts"]["ssh-readiness"], 100)

    def test_cancellation_does_not_erase_the_polling_transport_failure(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                observer.transport(
                    "bootstrap-status",
                    {"category": "authentication-rejected-marker", "exit_code": 255},
                )
                observer.transport(
                    "bootstrap-status", {"category": "controller-cancelled", "exit_code": None}
                )
        result = cycle.read(self.root / "bootstrap-transport.json")
        self.assertEqual(result["last_transport"]["category"], "controller-cancelled")
        self.assertEqual(
            result["bootstrap_transport_failure"]["category"], "authentication-rejected-marker"
        )

    def test_failed_diagnostic_write_removes_own_partial_and_recovers(self):
        with contextlib.redirect_stdout(io.StringIO()):
            observer = progress.Progress(self.root, IDENTITY, "fedora-44", "none")
            with patch.object(
                cycle.os, "fsync", side_effect=OSError(errno.ENOSPC, "synthetic full disk")
            ):
                observer.emit("heartbeat")
            self.assertFalse((self.root / "controller-progress.json.partial").exists())
            observer.__exit__(None, None, None)
        result = cycle.read(self.root / "controller-progress.json")
        self.assertEqual(result["event"], "final")
        self.assertEqual(result["diagnostic_write_failures"], 1)

    def test_diagnostic_writer_preserves_preexisting_partial(self):
        partial = self.root / "controller-progress.json.partial"
        partial.write_bytes(b"existing owner")
        with contextlib.redirect_stdout(io.StringIO()):
            observer = progress.Progress(self.root, IDENTITY, "fedora-44", "none")
            observer.emit("heartbeat")
        self.assertEqual(partial.read_bytes(), b"existing owner")
        self.assertEqual(observer.state["diagnostic_write_failures"], 1)

    def test_completion_distinguishes_final_snapshot_from_process_loss_and_invalid_data(self):
        for mode in ("final", "historical", "missing", "invalid", "foreign"):
            with self.subTest(mode=mode), contextlib.redirect_stdout(io.StringIO()):
                path = self.root / mode
                path.mkdir()
                observer = progress.Progress(path, IDENTITY, "fedora-44", "none")
                if mode == "final":
                    observer.__exit__(None, None, None)
                elif mode == "historical":
                    observer.emit("heartbeat")
                elif mode == "invalid":
                    (path / "controller-progress.json").write_bytes(b"private-invalid-json")
                elif mode == "foreign":
                    observer.state["identity"] = {**IDENTITY, "run_id": "999"}
                    observer.__exit__(None, None, None)
                result = progress.completion(path, IDENTITY, "fedora-44", "none", "failure")
                self.assertEqual(result["status"], "observed" if mode == "final" else "unavailable")
                self.assertEqual(
                    result["controller_result"], "succeeded" if mode == "final" else None
                )
                self.assertNotIn("private-invalid-json", json.dumps(result))
                self.assertEqual(
                    result["reason"], None if mode == "final" else "final-record-unavailable"
                )
                if mode == "historical":
                    self.assertTrue(
                        cycle.read(path / "controller-progress.json")["controller_alive"]
                    )
                    self.assertEqual(result["reason"], "final-record-unavailable")

    def test_completion_io_failures_preserve_producer_outcome_and_safe_console(self):
        for failure in ("file", "directory", "summary"):
            with (
                self.subTest(failure=failure),
                contextlib.redirect_stdout(io.StringIO()) as console,
            ):
                with progress.Progress(self.root, IDENTITY, "fedora-44", "none"):
                    pass
                summary = self.root / "summary.md"
                with (
                    patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}),
                    contextlib.ExitStack() as patches,
                ):
                    if failure == "file":
                        patches.enter_context(
                            patch.object(cycle, "write", side_effect=OSError(errno.ENOSPC, PRIVATE))
                        )
                    elif failure == "directory":
                        patches.enter_context(
                            patch.object(Path, "mkdir", side_effect=OSError(errno.ENOSPC, PRIVATE))
                        )
                    else:
                        patches.enter_context(
                            patch("builtins.open", side_effect=OSError(errno.ENOSPC, PRIVATE))
                        )
                    result = progress.completion(
                        self.root, IDENTITY, "fedora-44", "none", "success"
                    )
                self.assertEqual(result["status"], "observed")
                self.assertEqual(result["controller_result"], "succeeded")
                self.assertIn("OHTIA_ARM_COMPLETION=", console.getvalue())
                self.assertNotIn(PRIVATE, console.getvalue())

    def test_summarize_entrypoint_runs_without_provider_or_guest_operations(self):
        with (
            patch.object(cycle, "source_context", return_value=IDENTITY) as source,
            patch.object(cycle, "command", side_effect=AssertionError("unexpected process")),
            patch.object(sys, "argv", ["scaleway_progress.py", "summarize", str(self.root)]),
            patch.dict(
                os.environ,
                {
                    "QUALIFICATION_PROFILE": "fedora-44",
                    "QUALIFICATION_FAULT": "none",
                    "ARM_CONTROLLER_OUTCOME": "failure",
                },
            ),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            runpy.run_path(str(cycle.ROOT / "scripts/scaleway_progress.py"), run_name="__main__")
        source.assert_called_once_with("creator")
        result = cycle.read(self.root / "controller-completion.json")
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "final-record-unavailable")

    def test_changing_transport_errors_cannot_spend_the_lease_heartbeat_reserve(self):
        console = io.StringIO()
        with contextlib.redirect_stdout(console):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                for _ in range(120):
                    for code in (1, 2, 1, 2):
                        observer.transport(
                            "bootstrap-status", {"category": "process-failed", "exit_code": code}
                        )
                    observer.emit("heartbeat")
        events = [json.loads(line.split("=", 1)[1]) for line in console.getvalue().splitlines()]
        self.assertEqual(sum(e["event"] == "heartbeat" for e in events), 120)
        self.assertEqual(events[-1]["event"], "final")
        self.assertLessEqual(len(events), 256)

    def test_diagnostic_io_failure_does_not_replace_primary_error_or_cleanup(self):
        cleaned = []
        with (
            contextlib.redirect_stdout(io.StringIO()),
            patch.object(cycle, "write", side_effect=OSError("private path")),
            self.assertRaisesRegex(cycle.CycleError, "guest_bootstrap_deadline"),
        ):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none") as observer:
                try:
                    observer.failure(cycle.CycleError("guest_bootstrap_deadline"))
                    raise cycle.CycleError("guest_bootstrap_deadline")
                finally:
                    cleaned.append(True)
                    observer.phase("cleanup")
        self.assertEqual(cleaned, [True])

    def test_cancellation_is_recorded_without_private_error_details(self):
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(KeyboardInterrupt):
            with progress.Progress(self.root, IDENTITY, "fedora-44", "none"):
                raise KeyboardInterrupt(PRIVATE)
        result = cycle.read(self.root / "controller-progress.json")
        self.assertEqual(result["primary_failure"], "controller_cancelled")
        self.assertNotIn(PRIVATE, json.dumps(result))


class GuestDiagnosticTests(unittest.TestCase):
    def test_cancellation_during_process_launch_has_its_own_transport_category(self):
        diagnostic = {}
        with (
            patch.object(cycle.subprocess, "Popen", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            cycle.command(["ssh"], diagnostics=diagnostic)
        self.assertEqual(diagnostic, {"category": "controller-cancelled", "exit_code": None})

    def test_shell_readiness_needs_no_python_or_bootstrap_helper(self):
        with self.assertRaisesRegex(cycle.CycleError, "ssh_readiness_shape"):
            progress.readiness(b'{"python":"yes","helper":true}')
        self.assertEqual(
            progress.readiness(b'{"python":true,"helper":false}'), {"python": True, "helper": False}
        )
        self.assertNotIn("python3 ", progress.READINESS_COMMAND)

    def test_guest_units_are_normalized_and_failures_are_unavailable(self):
        source = {
            "version": 1,
            "ready": False,
            "failed": False,
            "code": None,
            "program": None,
            "exit_code": None,
            "cloud_init_error_count": 0,
        }
        results = [
            subprocess.CompletedProcess([], 0, "LoadState=loaded\nActiveState=active\n", PRIVATE),
            subprocess.CompletedProcess([], 0, "LoadState=not-found\nActiveState=inactive\n", ""),
            subprocess.CompletedProcess([], 0, PRIVATE, ""),
            subprocess.TimeoutExpired([], 2),
        ]
        with (
            patch.object(bootstrap, "status", return_value=source),
            patch.object(bootstrap.subprocess, "run", side_effect=results),
        ):
            record = bootstrap.diagnostics()
        self.assertEqual(
            record["units"],
            {
                progress.UNITS[0]: "active",
                progress.UNITS[1]: "unavailable",
                progress.UNITS[2]: "unavailable",
                progress.UNITS[3]: "unavailable",
            },
        )
        self.assertNotIn(PRIVATE, json.dumps(record))
        self.assertEqual(progress.guest_diagnostic(json.dumps(record).encode()), record)
        record["units"][progress.UNITS[0]] = PRIVATE
        with self.assertRaisesRegex(cycle.CycleError, "guest_diagnostic_shape"):
            progress.guest_diagnostic(json.dumps(record).encode())

    def test_readonly_helper_failure_preserves_original_failure_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "bootstrap-failure.json"
            marker.write_bytes(b"original failure")
            for operation in ("status", "diagnostics"):
                with (
                    patch.object(bootstrap, "FAILURE", marker),
                    patch.object(sys, "argv", ["bootstrap.py", operation]),
                    patch.object(bootstrap, operation, side_effect=OSError("synthetic failure")),
                    contextlib.redirect_stderr(io.StringIO()),
                    self.assertRaises(SystemExit),
                ):
                    bootstrap.main()
                self.assertEqual(marker.read_bytes(), b"original failure")

    def call_guest(self, mode):
        now = [0.0]
        calls = []
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name).resolve()

        def command(args, **kwargs):
            self.assertEqual(args[0], "ssh")
            text = args[-1]
            calls.append(text)
            now[0] += 0.1
            diagnostic = kwargs.get("diagnostics", {})
            if (
                mode in {"ssh-exit-255", "timeout"}
                or mode in {"remote-exit-2", "remote-exit-1"}
                and text != progress.READINESS_COMMAND
            ):
                if mode == "timeout":
                    diagnostic.update(category="process-timeout", exit_code=None)
                    now[0] += kwargs["timeout"]
                    raise subprocess.TimeoutExpired(args, kwargs["timeout"])
                status = {"ssh-exit-255": 255, "remote-exit-2": 2, "remote-exit-1": 1}[mode]
                diagnostic.update(category="process-failed", exit_code=status)
                raise subprocess.CalledProcessError(status, args)
            diagnostic.update(category="success", exit_code=0)
            if text == progress.READINESS_COMMAND:
                if mode == "invalid-diagnostic-readiness" and now[0] >= 10:
                    return subprocess.CompletedProcess(
                        args, 0, b'{"python":"private","helper":true}'
                    )
                return subprocess.CompletedProcess(
                    args,
                    0,
                    json.dumps({"python": True, "helper": mode != "helper-missing"}).encode(),
                )
            if text.endswith("bootstrap.py status"):
                if mode == "collection-failure":
                    if now[0] < 10:
                        diagnostic.update(category="authentication-rejected-marker", exit_code=255)
                        raise subprocess.CalledProcessError(255, args)
                    diagnostic.update(category="process-timeout", exit_code=None)
                    raise subprocess.TimeoutExpired(args, 1)
                if mode == "invalid-json":
                    return subprocess.CompletedProcess(args, 0, b"not-json")
                if mode == "invalid-shape":
                    return subprocess.CompletedProcess(args, 0, b'{"ready":"yes","failed":false}')
                return subprocess.CompletedProcess(
                    args,
                    0,
                    json.dumps(
                        {
                            "ready": False,
                            "failed": mode == "reported-failure",
                            "code": None,
                            "cloud_init_error_count": 0,
                        }
                    ).encode(),
                )
            if mode == "guest-diagnostic-timeout" and text.endswith("bootstrap.py diagnostics"):
                diagnostic.update(category="process-timeout", exit_code=None)
                raise subprocess.TimeoutExpired(args, 10)
            if mode == "invalid-diagnostic-summary" and text.endswith("bootstrap.py diagnostics"):
                return subprocess.CompletedProcess(args, 0, b"private-invalid-json")
            if mode == "not-ready-diagnostics" and text.endswith("bootstrap.py diagnostics"):
                return subprocess.CompletedProcess(
                    args,
                    0,
                    json.dumps(
                        {
                            "version": 1,
                            "ready": False,
                            "failed": False,
                            "code": None,
                            "program": None,
                            "exit_code": None,
                            "cloud_init_error_count": 0,
                            "units": {unit: "active" for unit in progress.UNITS},
                        }
                    ).encode(),
                )
            raise subprocess.CalledProcessError(1, args)

        def sleep(seconds):
            now[0] += seconds

        with (
            patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}),
            patch.object(cycle.time, "monotonic", side_effect=lambda: now[0]),
            patch.object(cycle.time, "sleep", side_effect=sleep),
            patch.object(
                qualification, "host_key", return_value=("203.0.113.5", directory / "known")
            ),
            patch.object(cycle, "command", side_effect=command),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            with self.assertRaises(cycle.CycleError) as failure:
                with progress.Progress(directory, IDENTITY, "fedora-44", "none") as observer:
                    qualification.guest(
                        Mock(), {}, {}, directory / "key", directory, directory, 10.0, observer
                    )
        return directory, calls, failure.exception

    def test_all_transport_failures_retain_category_status_and_attempts_before_cleanup(self):
        for mode, code in [
            ("ssh-exit-255", 255),
            ("remote-exit-2", 2),
            ("remote-exit-1", 1),
            ("timeout", None),
        ]:
            with self.subTest(mode=mode):
                directory, _, error = self.call_guest(mode)
                self.assertEqual(str(error), "guest_bootstrap_deadline")
                result = cycle.read(directory / "bootstrap-transport.json")
                self.assertEqual(result["bootstrap_transport_failure"]["exit_code"], code)
                self.assertGreater(result["attempts"]["ssh-readiness"], 0)
                self.assertEqual(
                    cycle.read(directory / "guest-bootstrap-diagnostics.json")["status"],
                    "unavailable",
                )

    def test_final_status_collection_cannot_overwrite_polling_failure(self):
        directory, _, error = self.call_guest("collection-failure")
        self.assertEqual(str(error), "guest_bootstrap_deadline")
        result = cycle.read(directory / "bootstrap-transport.json")
        self.assertEqual(
            result["bootstrap_transport_failure"]["category"], "authentication-rejected-marker"
        )
        self.assertGreater(result["attempts"]["guest-diagnostics"], 1)

    def test_invalid_diagnostic_readings_remain_distinct_from_unavailable_transport(self):
        for mode in ("invalid-diagnostic-readiness", "invalid-diagnostic-summary", "timeout"):
            with self.subTest(mode=mode):
                directory, _, error = self.call_guest(mode)
                self.assertEqual(str(error), "guest_bootstrap_deadline")
                result = cycle.read(directory / "guest-bootstrap-diagnostics.json")
                self.assertEqual(
                    result["status"], "unavailable" if mode == "timeout" else "invalid"
                )
                self.assertEqual(
                    result["reason"],
                    "diagnostic-command-timeout" if mode == "timeout" else "diagnostic-invalid",
                )
                self.assertNotIn("private", json.dumps(result))

    def test_failed_diagnostic_command_reports_stage_without_claiming_transport_cause(self):
        for mode, stage, reason in (
            ("ssh-exit-255", "ssh-readiness", "diagnostic-command-failed"),
            ("remote-exit-1", "guest-summary", "diagnostic-command-failed"),
            ("guest-diagnostic-timeout", "guest-summary", "diagnostic-command-timeout"),
        ):
            with self.subTest(mode=mode):
                directory, _, error = self.call_guest(mode)
                self.assertEqual(str(error), "guest_bootstrap_deadline")
                result = cycle.read(directory / "guest-bootstrap-diagnostics.json")
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["stage"], stage)
                self.assertEqual(
                    result["readiness"],
                    None if stage == "ssh-readiness" else {"python": True, "helper": True},
                )

    def test_valid_guest_diagnostics_are_retained_without_overriding_the_deadline(self):
        directory, _, error = self.call_guest("not-ready-diagnostics")
        self.assertEqual(str(error), "guest_bootstrap_deadline")
        result = cycle.read(directory / "guest-bootstrap-diagnostics.json")
        self.assertEqual(result["status"], "observed")
        self.assertEqual(set(result["guest"]["units"]), set(progress.UNITS))
        self.assertEqual(
            cycle.read(directory / "guest-failure.json")["code"], "guest_bootstrap_deadline"
        )

    def test_missing_helper_is_not_a_successful_bootstrap_or_unknown_transport(self):
        directory, calls, error = self.call_guest("helper-missing")
        self.assertEqual(str(error), "guest_bootstrap_deadline")
        result = cycle.read(directory / "controller-progress.json")
        self.assertEqual(result["guest_state"], "ssh-execution-confirmed")
        self.assertEqual(result["ssh_readiness"], {"python": True, "helper": False})
        self.assertFalse(any(text.endswith("bootstrap.py status") for text in calls))
        self.assertEqual(
            cycle.read(directory / "guest-bootstrap-diagnostics.json")["reason"],
            "interpreter-or-helper-unavailable",
        )

    def test_valid_not_ready_and_explicit_failure_remain_distinct(self):
        for mode, expected in [
            ("not-ready", "guest_bootstrap_deadline"),
            ("reported-failure", "guest_bootstrap_failed"),
        ]:
            with self.subTest(mode=mode):
                directory, _, error = self.call_guest(mode)
                self.assertEqual(str(error), expected)
                self.assertTrue((directory / "bootstrap.json").is_file())
                self.assertEqual(cycle.read(directory / "guest-failure.json")["code"], expected)
                self.assertEqual(
                    cycle.read(directory / "guest-bootstrap-diagnostics.json")["status"],
                    "unavailable",
                )

    def test_invalid_status_still_refuses_and_keeps_the_primary_validation_error(self):
        for mode, expected in [
            ("invalid-json", "invalid_json"),
            ("invalid-shape", "bootstrap_status_shape"),
        ]:
            with self.subTest(mode=mode):
                directory, _, error = self.call_guest(mode)
                self.assertEqual(str(error), expected)
                self.assertEqual(
                    cycle.read(directory / "controller-progress.json")["primary_failure"], expected
                )

    def test_operational_display_preserves_historical_recovery_identities_and_deadlines(self):
        source = (cycle.ROOT / ".github/workflows/installation-qualification.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "run-name: ARM qualification · ${{ inputs.profile }} · fault=${{ inputs.fault }}",
            source,
        )
        self.assertIn("name: Create and qualify one ARM lease", source)
        self.assertIn("name: Create, test and remove the lease", source)
        self.assertIn("id: controller", source)
        self.assertIn("continue-on-error: true", source)
        self.assertIn("ARM_CONTROLLER_OUTCOME: ${{ steps.controller.outcome }}", source)
        self.assertIn("python3 scripts/scaleway_progress.py summarize artifacts/scw-cycle", source)
        self.assertIn("artifacts/scw-cycle/controller-completion.json", source)
        self.assertIn(
            "workflows: [Installation ARM qualification]",
            (cycle.ROOT / ".github/workflows/installation-cleanup.yml").read_text(encoding="utf-8"),
        )
        limits = cycle.policy()["limits"]
        self.assertEqual(
            [
                limits[k]
                for k in (
                    "test_seconds",
                    "cleanup_seconds",
                    "lease_seconds",
                    "guest_shutdown_seconds",
                    "evidence_seconds",
                )
            ],
            [2400, 600, 3600, 3000, 60],
        )


if __name__ == "__main__":
    unittest.main()
