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
                        observer.observe(
                            "host-keyscan-failed" if code == 1 else "host-keygen-failed"
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


class HostKeyDiagnosticTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = [0.0]
        self.enterContext(patch.object(cycle.time, "monotonic", side_effect=lambda: self.now[0]))
        self.enterContext(patch.object(cycle.time, "sleep", side_effect=self.sleep))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}))
        self.intent = {"nonce": "00000000-0000-4000-8000-000000000001", "profile": "debian-13"}
        self.resources = {
            "server": "00000000-0000-4000-8000-000000000002",
            "ip": "00000000-0000-4000-8000-000000000003",
        }
        self.observer = progress.Progress(self.root, IDENTITY, "debian-13", "none")
        self.observer.phase("host-key", deadline=10)
        self.api = Mock()
        self.api.get.side_effect = self.get
        self.api.request.return_value = b"SHA256:" + b"B" * 43
        self.api.path.return_value = (
            "/instance/v1/zones/nl-ams-1/servers/" + self.resources["server"]
        )
        self.address = {"address": "8.8.8.8", "server": {"id": self.resources["server"]}}
        self.mode = "passed"
        self.command = self.enterContext(
            patch.object(cycle, "command", side_effect=self.command_result)
        )

    def sleep(self, seconds):
        self.now[0] += seconds

    def get(self, kind, resource):
        return (
            {"state": "running", "boot_type": "local", "private": PRIVATE}
            if kind == "server"
            else self.address
        )

    def command_result(self, args, *, diagnostics, **kwargs):
        if args[0] == "ssh-keyscan":
            if self.mode != "passed":
                category = {"cancelled": "controller-cancelled", "timeout": "process-timeout"}.get(
                    self.mode, "process-failed"
                )
                diagnostics.update(
                    category=category, exit_code=1 if category == "process-failed" else None
                )
                if self.mode == "cancelled":
                    raise KeyboardInterrupt(PRIVATE)
                if self.mode == "timeout":
                    raise subprocess.TimeoutExpired(args, 10)
                raise subprocess.CalledProcessError(1, args)
            data = b"8.8.8.8 ssh-ed25519 " + b"A" * 64 + b"\n"
        else:
            if self.mode == "keygen-failed":
                diagnostics.update(category="process-failed", exit_code=7)
                raise subprocess.CalledProcessError(7, args)
            data = b"256 SHA256:" + b"B" * 43 + b" fixture ED25519"
        diagnostics.update(category="success", exit_code=0)
        return subprocess.CompletedProcess(args, 0, data)

    def admit(self):
        return qualification.host_key(
            self.api, self.intent, self.resources, self.root / "identity", 10, self.observer
        )

    def diagnostic(self):
        return cycle.read(self.root / "host-key-diagnostics.json")

    def test_each_wait_condition_has_distinct_observations_without_authenticated_ssh(self):
        for mode, expected in [
            ("ip", "host-ip-unattached"),
            ("fingerprint", "host-fingerprint-missing"),
            ("scan", "host-keyscan-failed"),
            ("timeout", "host-keyscan-failed"),
        ]:
            with self.subTest(mode=mode):
                self.now[0] = 0
                (self.root / "host-key-diagnostics.json").unlink(missing_ok=True)
                self.mode = mode
                self.address["server"] = None if mode == "ip" else {"id": self.resources["server"]}
                self.api.request.return_value = (
                    None if mode == "fingerprint" else b"SHA256:" + b"B" * 43
                )
                self.command.reset_mock()
                self.observer = progress.Progress(self.root, IDENTITY, "debian-13", "none")
                with self.assertRaisesRegex(cycle.CycleError, "host_key_deadline"):
                    self.admit()
                value = self.diagnostic()
                self.assertEqual(self.observer.state["last_observation"], expected)
                self.assertEqual(self.observer.state["guest_state"], "unknown")
                self.assertNotIn("ssh-readiness", self.observer.state["attempts"])
                self.assertEqual(value["server_state"], "running")
                self.assertEqual(value["boot_type"], "local")
                self.assertEqual(
                    value["ip_attachment"], "unattached" if mode == "ip" else "matched"
                )
                self.assertEqual(
                    value["fingerprint_status"],
                    "unobserved"
                    if mode == "ip"
                    else "missing"
                    if mode == "fingerprint"
                    else "present",
                )
                self.assertEqual(
                    value["operation"],
                    "ip" if mode == "ip" else "fingerprint" if mode == "fingerprint" else "keyscan",
                )
                if mode in {"ip", "fingerprint"}:
                    self.command.assert_not_called()
                    self.assertEqual(
                        value["scan"], {"attempts": 0, "category": None, "exit_code": None}
                    )
                else:
                    self.assertEqual(value["scan"]["attempts"], 2)
                    self.assertEqual(
                        value["scan"]["category"],
                        "process-timeout" if mode == "timeout" else "process-failed",
                    )
                self.assertFalse((self.root / "known_hosts").exists())
                observations = [
                    e
                    for e in self.observer.history
                    if e["event"] == "observation" and e["last_observation"] == expected
                ]
                self.assertEqual(len(observations), 1)

    def test_matching_key_is_admitted_only_after_owned_metadata_and_fingerprint(self):
        address, known = self.admit()
        self.assertEqual(address, "8.8.8.8")
        self.assertEqual(known.read_bytes(), b"8.8.8.8 ssh-ed25519 " + b"A" * 64 + b"\n")
        self.assertEqual(known.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.api.owned.call_count, 2)
        self.assertEqual(self.diagnostic()["operation"], "admitted")
        self.assertEqual(self.diagnostic()["scan"]["category"], "success")
        self.assertEqual(self.observer.state["attempts"], {"host-keyscan": 1, "host-keygen": 1})
        observed = {
            e["last_observation"] for e in self.observer.history if e["event"] == "observation"
        }
        self.assertTrue({"host-server-observed", "host-fingerprint-present"} <= observed)

    def test_invalid_attachment_fingerprint_and_mismatched_key_still_fail_closed(self):
        for mode, expected in [
            ("attachment", "guest_address_identity"),
            ("fingerprint", "host_fingerprint_unavailable"),
            ("key", "host_key_mismatch"),
        ]:
            with self.subTest(mode=mode):
                (self.root / "host-key-diagnostics.json").unlink(missing_ok=True)
                self.address["server"] = {
                    "id": "00000000-0000-4000-8000-000000000004"
                    if mode == "attachment"
                    else self.resources["server"]
                }
                self.api.request.return_value = (
                    b"private-invalid"
                    if mode == "fingerprint"
                    else b"SHA256:" + (b"C" if mode == "key" else b"B") * 43
                )
                with self.assertRaisesRegex(cycle.CycleError, expected):
                    self.admit()
                self.assertFalse((self.root / "known_hosts").exists())
                value = self.diagnostic()
                self.assertEqual(
                    value["ip_attachment"], "invalid" if mode == "attachment" else "matched"
                )
                self.assertEqual(
                    value["fingerprint_status"],
                    "unobserved"
                    if mode == "attachment"
                    else "invalid"
                    if mode == "fingerprint"
                    else "present",
                )
                self.assertNotIn(PRIVATE, (self.root / "host-key-diagnostics.json").read_text())

    def test_deadline_cutoff_retains_api_error_but_earlier_and_identity_errors_keep_their_code(
        self,
    ):
        for remaining, code, expected in [
            (0, "provider_transport", "host_key_deadline"),
            (0, "provider_deadline", "host_key_deadline"),
            (0, "provider_operation_deadline", "host_key_deadline"),
            (9, "provider_transport", "provider_transport"),
            (0, "foreign_project", "foreign_project"),
        ]:
            with self.subTest(code=code, remaining=remaining):
                self.now[0] = 0

                def failed(kind, resource):
                    self.now[0] = 10 - remaining
                    raise cycle.CycleError(code)

                self.api.get.side_effect = failed
                with self.assertRaisesRegex(cycle.CycleError, expected):
                    self.admit()
                retained = self.diagnostic()["provider_failure"]
                self.assertEqual(retained["operation"], "server")
                self.assertEqual(retained["code"], code)
                self.assertFalse((self.root / "known_hosts").exists())

        self.now[0] = 0

        def early_failure(kind, resource):
            self.now[0] = 9.9
            raise cycle.CycleError("provider_transport")

        self.api.get.side_effect = early_failure
        record = self.observer.host_key

        def delayed_record(nonce, operation, **observations):
            if observations.get("provider_failure"):
                self.now[0] = 11
            return record(nonce, operation, **observations)

        with (
            patch.object(self.observer, "host_key", side_effect=delayed_record),
            self.assertRaisesRegex(cycle.CycleError, "provider_transport"),
        ):
            self.admit()

    def test_cancellation_keeps_scan_category_and_never_accepts_a_key(self):
        self.mode = "cancelled"
        with self.assertRaises(KeyboardInterrupt):
            self.admit()
        self.assertEqual(self.diagnostic()["scan"]["category"], "controller-cancelled")
        self.assertFalse((self.root / "known_hosts").exists())

    def test_keygen_abnormal_exits_retain_transport_and_preserve_the_original_exception(self):
        for category, error in [
            ("controller-cancelled", KeyboardInterrupt(PRIVATE)),
            ("local-io-failed", OSError(PRIVATE)),
            ("output-limit", cycle.CycleError("process_output_bound")),
        ]:
            with self.subTest(category=category):
                self.now[0] = 0
                (self.root / "host-key-diagnostics.json").unlink(missing_ok=True)
                self.observer = progress.Progress(self.root, IDENTITY, "debian-13", "none")

                def command(args, **kwargs):
                    if args[0] == "ssh-keygen":
                        kwargs["diagnostics"].update(category=category, exit_code=None)
                        raise error
                    return self.command_result(args, **kwargs)

                self.command.side_effect = command
                with self.assertRaises(type(error)) as raised:
                    self.admit()
                self.assertIs(raised.exception, error)
                self.assertEqual(
                    self.observer.state["last_transport"],
                    {"operation": "host-keygen", "category": category, "exit_code": None},
                )
                self.assertEqual(self.diagnostic()["operation"], "keygen")
                self.assertEqual(self.diagnostic()["scan"]["category"], "success")
                self.assertFalse((self.root / "known_hosts").exists())
                retained = (self.root / "controller-events.json").read_text()
                self.assertNotIn(PRIVATE, retained)
                self.assertEqual(
                    json.loads(retained)["events"][-1]["last_transport"]["category"], category
                )

    def test_keygen_failure_has_its_own_live_operation_and_preserves_scan_observation(self):
        original = self.command_result

        def result(args, **kwargs):
            if args[0] == "ssh-keygen":
                kwargs["diagnostics"].update(category="process-failed", exit_code=7)
                raise subprocess.CalledProcessError(7, args)
            return original(args, **kwargs)

        self.command.side_effect = result
        with self.assertRaisesRegex(cycle.CycleError, "host_key_deadline"):
            self.admit()
        self.assertEqual(self.diagnostic()["operation"], "keygen")
        self.assertEqual(self.diagnostic()["scan"]["category"], "success")
        self.assertEqual(self.observer.state["last_observation"], "host-keygen-failed")
        self.assertEqual(self.observer.state["last_transport"]["exit_code"], 7)

    def test_maximum_snapshot_and_progress_fit_bounds_and_discard_unselected_private_values(self):
        self.observer.state["identity"] = {
            "source_sha": "a" * 40,
            "run_id": "9" * 20,
            "attempt": "9" * 20,
        }
        for operation in progress.OPERATIONS:
            self.observer.state["attempts"][operation] = 999999
        self.observer.host_key(
            self.intent["nonce"],
            "fingerprint",
            server={"state": [PRIVATE], "boot_type": {"private": PRIVATE}},
            ip_attachment="invalid",
            fingerprint_status="invalid",
            provider_failure=max(cycle.SAFE_FAILURE_CODES, key=len),
            scan={
                "category": max(progress.TRANSPORT_CATEGORIES, key=len),
                "exit_code": -255,
                "raw": PRIVATE,
            },
        )
        value = self.diagnostic()
        self.assertEqual(value["server_state"], "other")
        self.assertEqual(value["boot_type"], "other")
        self.assertEqual(value["scan"]["attempts"], 999999)
        self.assertNotIn(PRIVATE, json.dumps(value))
        self.assertEqual(
            set(value),
            {
                "version",
                "identity",
                "profile",
                "nonce",
                "observed_at",
                "operation",
                "server_state",
                "boot_type",
                "ip_attachment",
                "fingerprint_status",
                "scan",
                "provider_failure",
            },
        )
        self.observer.host_key(
            self.intent["nonce"],
            "fingerprint",
            server={"state": "stopped in place", "boot_type": "bootscript"},
        )
        self.assertLessEqual(
            len((self.root / "host-key-diagnostics.json").read_bytes()),
            cycle.policy()["limits"]["progress_record_bytes"],
        )
        largest = self.diagnostic()
        self.assertEqual(largest["server_state"], "stopped-in-place")
        self.assertEqual(largest["boot_type"], "bootscript")
        self.assertEqual(self.observer.state["diagnostic_write_failures"], 0)
        self.observer.transport(
            "bootstrap-status", {"category": "authentication-rejected-marker", "exit_code": 255}
        )
        self.observer.transport(
            "host-keyscan", {"category": "connection-timeout-marker", "exit_code": 1}
        )
        self.observer.state.update(
            fault="after-native-smoke",
            identity={"source_sha": "a" * 40, "run_id": "9" * 20, "attempt": "9" * 20},
            guest_state="interpreter-or-helper-unavailable",
            ssh_readiness={"python": False, "helper": False},
            primary_failure=max(cycle.SAFE_FAILURE_CODES, key=len),
            diagnostic_write_failures=999999,
        )
        self.observer.emit("heartbeat")
        retained = cycle.read(self.root / "controller-progress.json")
        self.assertEqual(retained["event"], "heartbeat")
        self.assertEqual(retained["identity"]["attempt"], "9" * 20)
        self.assertEqual(retained["attempts"], self.observer.state["attempts"])
        self.assertLessEqual(
            len((self.root / "controller-progress.json").read_bytes()),
            cycle.policy()["limits"]["progress_record_bytes"],
        )

    def test_recorder_io_failure_does_not_replace_admission_failure(self):
        write = cycle.write

        def fail(path, value, **kwargs):
            if path.name == "host-key-diagnostics.json":
                raise OSError(PRIVATE)
            return write(path, value, **kwargs)

        self.api.request.return_value = None
        with (
            patch.object(cycle, "write", side_effect=fail),
            self.assertRaisesRegex(cycle.CycleError, "host_key_deadline"),
        ):
            self.admit()
        self.assertGreater(self.observer.state["diagnostic_write_failures"], 0)
        self.assertFalse((self.root / "known_hosts").exists())

    def test_real_controller_finally_cleans_after_host_key_recorder_failure_and_cancellation(self):
        for cancelled in (False, True):
            with self.subTest(cancelled=cancelled):
                self.now[0] = 0
                self.mode = "cancelled" if cancelled else "passed"
                self.api.request.return_value = b"SHA256:" + b"B" * 43 if cancelled else None
                identity = dict(IDENTITY)
                intent = {**self.intent, "identity": identity, "created_at": cycle.utc()}
                source = self.root / ("source-" + str(cancelled))
                source.mkdir()
                cycle.write(source / "intent.json", intent)
                output = self.root / ("output-" + str(cancelled))
                gh = Mock()
                gh.artifacts.return_value = [{"name": "scw-intent-101-1"}]
                gh.artifact.return_value = intent
                self.api.discover.return_value = dict(self.resources)
                self.api.cleanup.return_value = {
                    "status": "absent",
                    "resources": dict(self.resources),
                }
                self.api.cleanup.reset_mock()

                def create(intent, public, config, record):
                    record(
                        {"kind": "server", "stage": "allocated", "resources": dict(self.resources)}
                    )
                    return dict(self.resources)

                self.api.create.side_effect = create
                command = self.command_result

                def invoke(args, **kwargs):
                    if "-q" in args:
                        key = Path(args[args.index("-f") + 1])
                        key.write_bytes(b"synthetic identity")
                        key.with_suffix(".pub").write_text("ssh-ed25519 synthetic")
                        return subprocess.CompletedProcess(args, 0, b"")
                    return command(args, **kwargs)

                self.command.side_effect = invoke
                selected = copy.deepcopy(cycle.policy())
                selected["limits"]["test_seconds"] = 10
                original_write = cycle.write

                def write(path, value, **kwargs):
                    if path.name == "host-key-diagnostics.json" and not cancelled:
                        raise OSError(PRIVATE)
                    return original_write(path, value, **kwargs)

                expected = KeyboardInterrupt if cancelled else cycle.CycleError
                with (
                    patch.object(cycle, "source_context", return_value=identity),
                    patch.object(cycle, "configuration", return_value={}),
                    patch.object(cycle, "validate_intent"),
                    patch.object(cycle, "policy", return_value=selected),
                    patch.object(cycle, "API", return_value=self.api),
                    patch.object(cycle, "write", side_effect=write),
                    patch.object(qualification, "enabled"),
                    patch.object(qualification, "key_lifetimes"),
                    patch.object(qualification, "previous"),
                    patch.dict(os.environ, {"RUNNER_TEMP": str(self.root)}),
                    self.assertRaises(expected),
                ):
                    qualification.execute(gh, source, self.root, output, "none")
                self.api.cleanup.assert_called_once()
                journal = cycle.read(output / "journal.json")
                self.assertEqual(journal["status"], "cleaned")
                self.assertEqual(journal["normal_cleanup"]["status"], "absent")
                self.assertFalse(journal["native_smoke_passed"])
                self.assertEqual(
                    journal["failure_code"],
                    "controller_cancelled" if cancelled else "host_key_deadline",
                )
                self.assertEqual(list(self.root.glob("ohtia-lease-*")), [])

    def test_pending_scan_does_not_relabel_a_previous_failed_result_as_current(self):
        self.observer.attempted("host-keyscan")
        self.observer.host_key(
            self.intent["nonce"], "keyscan", scan={"category": "process-failed", "exit_code": 1}
        )
        self.observer.attempted("host-keyscan")
        self.observer.host_key(self.intent["nonce"], "keyscan")
        self.assertEqual(
            self.diagnostic()["scan"], {"attempts": 2, "category": None, "exit_code": None}
        )


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
        self.assertIn("artifacts/scw-cycle/host-key-diagnostics.json", source)
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
