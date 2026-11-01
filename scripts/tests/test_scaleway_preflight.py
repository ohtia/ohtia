"""Exercise the recovery prerequisite of qualification without GitHub or provider access."""

from __future__ import annotations

import contextlib
import copy
import datetime as dt
import io
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scaleway_cycle as cycle
import scaleway_preflight as preflight
import scaleway_progress as progress
import scaleway_qualification as qualification
from scaleway_ledger import PUBLISH_STEP, GitHub, attempt_ended
from test_scaleway_cycle import MemoryAPI, fixtures

SOURCE = "a" * 40
IDENTITY = {"run_id": "101", "attempt": "1"}
QUALIFICATION = cycle.ROOT / ".github/workflows/installation-qualification.yml"
RECOVERY = cycle.ROOT / ".github/workflows/installation-cleanup.yml"


def now_minus(seconds: int) -> str:
    moment = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=seconds)
    return moment.isoformat().replace("+00:00", "Z")


def receipt(run_id: int = 100, age: int = 0) -> dict:
    return {
        "identity": {"run_id": str(run_id), "attempt": "1"},
        "checked_at": now_minus(age),
        "leases": [],
        "unallocated_attempts": [],
    }


def run_row(run_id: int, status: str = "completed", conclusion: str | None = "success") -> dict:
    return {
        "id": run_id,
        "status": status,
        "conclusion": conclusion,
        "head_repository": {"full_name": cycle.REPOSITORY},
    }


class FakeActions:
    """A recording GitHub fixture; it is not evidence of how GitHub behaves."""

    def __init__(self):
        self.evidence = cycle.CycleError("fresh_recovery_required")
        self.pending = []
        self.history = [run_row(100)]
        self.head = SOURCE
        self.job = None
        self.requests = 0
        self.outcomes = ["success"]
        self.lost_response = False
        self.starts_run = True
        self.read_failures = 0
        self.in_flight = None
        self.hang = False

    def recovery_runs(self):
        if self.read_failures:
            self.read_failures -= 1
            raise cycle.CycleError("github_read_failed")
        return [dict(row) for row in self.history]

    def completed_ledger(self, settings, *, fresh=False):
        assert fresh is True
        if isinstance(self.evidence, Exception):
            raise self.evidence
        return self.evidence

    def intents(self, settings, *, previous, excluding=None, unallocated=None):
        assert excluding == ("101", "1")
        return self.pending

    def main_revision(self):
        return self.head

    def current_job(self, identity, name):
        assert identity == IDENTITY and name == preflight.REFRESH_JOB
        return self.job

    def dispatch_recovery(self):
        self.requests += 1
        if self.starts_run:
            self.in_flight = run_row(max(r["id"] for r in self.history) + 1, "queued", None)
            self.history.insert(0, self.in_flight)
        if self.lost_response:
            raise cycle.CycleError("github_read_failed")

    def tick(self):
        if self.in_flight is None or self.hang:
            return
        if self.in_flight["status"] == "queued":
            self.in_flight["status"] = "in_progress"
            return
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        self.in_flight.update(status="completed", conclusion=outcome)
        if outcome == "success":
            self.evidence = receipt(self.in_flight["id"])
        self.in_flight = None


class Clock:
    def __init__(self, actions: FakeActions):
        self.now = 1000.0
        self.actions = actions
        self.sleeps = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        self.sleeps += 1
        self.actions.tick()


class PreflightCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.summary = self.root / "summary.md"
        self.limits = cycle.policy()["limits"]
        self.actions = FakeActions()
        self.clock = Clock(self.actions)
        self.output = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.output))
        self.enterContext(patch.object(preflight, "time", self.clock))
        self.enterContext(
            patch.dict(os.environ, {"GITHUB_SHA": SOURCE, "GITHUB_STEP_SUMMARY": str(self.summary)})
        )

    def ensure(self, *, dispatch=True):
        return preflight.ensure(self.actions, {}, IDENTITY, dispatch=dispatch)

    def records(self):
        return [
            json.loads(line.split("=", 1)[1])
            for line in self.output.getvalue().splitlines()
            if line.startswith("OHTIA_ARM_PREFLIGHT=")
        ]

    def refused(self, code, *, dispatch=True):
        self.summary.unlink(missing_ok=True)
        with self.assertRaises(cycle.CycleError) as caught:
            self.ensure(dispatch=dispatch)
        self.assertEqual(cycle.failure_code(caught.exception), code)
        return self.summary.read_text(encoding="utf-8")


class ReuseAndRefreshTests(PreflightCase):
    def test_recent_valid_evidence_is_reused_without_a_request(self):
        self.actions.evidence = receipt(100, age=self.limits["recovery_reuse_seconds"] - 60)
        state = self.ensure()
        self.assertEqual(state["decision"], "ready")
        self.assertEqual(state["recovery_run"], "100")
        self.assertEqual(self.actions.requests, 0)
        self.assertEqual(self.clock.sleeps, 0)

    def test_absent_evidence_requests_recovery_and_admits_only_its_receipt(self):
        state = self.ensure()
        self.assertEqual(self.actions.requests, 1)
        self.assertEqual(state["recovery_run"], "101")
        self.assertEqual(self.records()[-1]["decision"], "admitted")

    def test_evidence_older_than_reuse_is_refreshed_before_it_can_expire(self):
        self.actions.evidence = receipt(100, age=self.limits["recovery_reuse_seconds"] + 60)
        state = self.ensure()
        self.assertEqual(self.actions.requests, 1)
        self.assertLess(state["age_seconds"], self.limits["recovery_reuse_seconds"])

    def test_evidence_from_an_earlier_policy_is_refreshed_automatically(self):
        self.actions.evidence = cycle.CycleError("recovery_policy_changed")
        self.assertEqual(self.ensure()["decision"], "ready")
        self.assertEqual(self.actions.requests, 1)

    def test_recent_evidence_with_an_ended_unresolved_attempt_is_refreshed(self):
        self.actions.evidence = receipt(100)
        intent = {"identity": {"attempt": "1"}, "expires_at": now_minus(-3600)}
        self.actions.pending = [(intent, {"status": "completed", "run_attempt": 1})]

        def resolved():
            self.actions.pending = []
            self.actions.evidence = receipt(101)

        original = self.actions.tick

        def tick():
            original()
            if self.actions.in_flight is None and self.actions.requests:
                resolved()

        self.actions.tick = tick
        self.assertEqual(self.ensure()["recovery_run"], "101")
        self.assertEqual(self.actions.requests, 1)

    def test_queued_or_running_recovery_is_awaited_without_a_request(self):
        for status in ("queued", "in_progress", "waiting", "pending"):
            with self.subTest(status=status):
                self.actions = FakeActions()
                self.clock.actions = self.actions
                self.actions.in_flight = run_row(150, status, None)
                self.actions.history.insert(0, self.actions.in_flight)
                state = self.ensure()
                self.assertEqual(state["recovery_run"], "150")
                self.assertEqual(self.actions.requests, 0)

    def test_concurrent_requests_share_one_running_recovery(self):
        first = FakeActions()
        first.in_flight = run_row(150, "in_progress", None)
        first.history.insert(0, first.in_flight)
        self.actions = first
        self.clock.actions = first
        self.assertEqual(self.ensure()["recovery_run"], "150")
        first.job = {"status": "completed", "conclusion": "success"}
        self.assertEqual(self.ensure(dispatch=False)["recovery_run"], "150")
        self.assertEqual(first.requests, 0)


class StopTests(PreflightCase):
    def test_untrusted_evidence_stops_without_a_request_or_wait(self):
        for code in (
            "recovery_source",
            "recovery_status",
            "recovery_artifact_missing",
            "recovery_configuration",
            "artifact_digest_mismatch",
            "artifact_unavailable",
            "invalid_artifact_archive",
            "ledger_unresolved",
            "run_workflow",
            "run_not_main_ancestor",
            "workflow_inactive",
        ):
            with self.subTest(code=code):
                self.actions = FakeActions()
                self.clock.actions = self.actions
                self.actions.evidence = cycle.CycleError(code)
                self.refused(code)
                self.assertEqual(self.actions.requests, 0)

    def test_full_ledger_stops_without_a_request(self):
        self.actions.evidence = receipt(100)
        self.actions.evidence["leases"] = [{}] * self.limits["maximum_leases"]
        self.refused("ledger_capacity")
        self.assertEqual(self.actions.requests, 0)

    def test_active_lease_is_never_reclaimed_to_unblock_a_request(self):
        self.actions.evidence = receipt(100)
        intent = {"identity": {"attempt": "1"}, "expires_at": now_minus(-3600)}
        self.actions.pending = [(intent, {"status": "in_progress", "run_attempt": 1})]
        self.assertIn("is not reclaimed", self.refused("active_lease_present"))
        self.assertEqual(self.actions.requests, 0)

    def test_expired_lease_of_an_active_producer_is_left_to_recovery(self):
        self.actions.evidence = receipt(100)
        intent = {"identity": {"attempt": "1"}, "expires_at": now_minus(60)}
        self.actions.pending = [(intent, {"status": "in_progress", "run_attempt": 1})]
        self.actions.outcomes = ["failure"]
        self.refused("recovery_run_failed")
        self.assertEqual(self.actions.requests, 1)

    def test_failed_or_timed_out_recovery_stops_at_once_and_names_its_run(self):
        for conclusion in ("failure", "timed_out", "startup_failure"):
            with self.subTest(conclusion=conclusion):
                self.actions = FakeActions()
                self.clock.actions = self.actions
                self.actions.outcomes = [conclusion]
                self.output.truncate(0)
                self.output.seek(0)
                text = self.refused("recovery_run_failed")
                self.assertEqual(self.actions.requests, 1)
                self.assertIn("Recovery run: `101`", text)
                self.assertEqual(self.records()[-1]["recovery_run"], "101")

    def test_failure_of_a_joined_recovery_stops_without_a_replacement(self):
        for conclusion in ("failure", "timed_out", "startup_failure"):
            with self.subTest(conclusion=conclusion):
                self.actions = FakeActions()
                self.clock.actions = self.actions
                self.actions.outcomes = [conclusion]
                self.actions.in_flight = run_row(150, "in_progress", None)
                self.actions.history.insert(0, self.actions.in_flight)
                self.output.truncate(0)
                self.output.seek(0)
                self.assertIn("Recovery run: `150`", self.refused("recovery_run_failed"))
                self.assertEqual(self.actions.requests, 0)

    def test_superseded_joined_recovery_is_followed_by_one_request(self):
        self.actions.outcomes = ["cancelled", "success"]
        self.actions.in_flight = run_row(150, "in_progress", None)
        self.actions.history.insert(0, self.actions.in_flight)
        self.assertEqual(self.ensure()["recovery_run"], "151")
        self.assertEqual(self.actions.requests, 1)

    def test_joined_success_without_usable_evidence_is_followed_by_one_request(self):
        self.actions.in_flight = run_row(150, "in_progress", None)
        self.actions.history.insert(0, self.actions.in_flight)
        original = self.actions.tick

        def tick():
            joined = self.actions.in_flight is self.actions.history[-2]
            original()
            if joined and self.actions.in_flight is None:
                self.actions.evidence = cycle.CycleError("fresh_recovery_required")

        self.actions.tick = tick
        self.assertEqual(self.ensure()["recovery_run"], "151")
        self.assertEqual(self.actions.requests, 1)

    def two_awaited_runs(self, first, second, *, evidence=None):
        """Run 150 runs and 151 waits behind it; both end between two polls."""
        older, newer = run_row(150, "in_progress", None), run_row(151, "queued", None)
        self.actions.history[:0] = [newer, older]
        original = self.actions.tick

        def tick():
            original()
            if self.clock.sleeps == 1:
                older.update(status="completed", conclusion=first)
                newer.update(status="completed", conclusion=second)
                if evidence is not None:
                    self.actions.evidence = evidence

        self.actions.tick = tick

    def test_a_cancelled_newer_run_cannot_hide_an_awaited_failure(self):
        for conclusion in ("cancelled", "skipped"):
            with self.subTest(conclusion=conclusion):
                self.actions = FakeActions()
                self.clock.actions = self.actions
                self.clock.sleeps = 0
                self.two_awaited_runs("failure", conclusion)
                self.output.truncate(0)
                self.output.seek(0)
                self.assertIn("Recovery run: `150`", self.refused("recovery_run_failed"))
                self.assertEqual(self.actions.requests, 0)

    def test_a_newer_successful_run_supersedes_an_awaited_failure(self):
        self.two_awaited_runs("failure", "success", evidence=receipt(151))
        self.assertEqual(self.ensure()["recovery_run"], "151")
        self.assertEqual(self.actions.requests, 0)

    def test_an_awaited_failure_ended_by_a_newer_success_without_evidence_can_request(self):
        self.two_awaited_runs("failure", "success")
        self.assertEqual(self.ensure()["recovery_run"], "152")
        self.assertEqual(self.actions.requests, 1)

    def test_a_request_after_a_joined_run_waits_for_its_own_run_to_appear(self):
        self.actions.outcomes = ["cancelled"]
        self.actions.in_flight = run_row(150, "in_progress", None)
        self.actions.history.insert(0, self.actions.in_flight)
        self.actions.starts_run = False
        original = self.actions.tick
        polls = []

        def tick():
            original()
            if self.actions.requests:
                polls.append(self.clock.now)
                if len(polls) == 2:
                    self.actions.history.insert(0, run_row(151))
                    self.actions.evidence = receipt(151)

        self.actions.tick = tick
        self.assertEqual(self.ensure()["recovery_run"], "151")
        self.assertEqual(self.actions.requests, 1)

    def test_a_later_requested_failure_is_named_after_a_superseded_joined_run(self):
        self.actions.outcomes = ["cancelled", "failure"]
        self.actions.in_flight = run_row(150, "in_progress", None)
        self.actions.history.insert(0, self.actions.in_flight)
        self.assertIn("Recovery run: `151`", self.refused("recovery_run_failed"))
        self.assertEqual(self.actions.requests, 1)

    def test_report_never_pairs_a_run_with_another_runs_attempt_or_age(self):
        self.actions.evidence = receipt(100, age=self.limits["recovery_reuse_seconds"] + 60)
        self.actions.evidence["identity"]["attempt"] = "3"
        self.actions.outcomes = ["failure"]
        text = self.refused("recovery_run_failed")
        self.assertIn("Recovery run: `101`; attempt: `unknown`", text)
        self.assertIn("observation age in seconds: `None`", text)
        final = self.records()[-1]
        self.assertEqual(
            (final["recovery_run"], final["attempt"], final["age_seconds"]), ("101", None, None)
        )

    def test_report_keeps_the_attempt_and_age_of_the_admitted_run(self):
        self.actions.evidence = receipt(100, age=60)
        self.actions.evidence["identity"]["attempt"] = "3"
        self.ensure()
        final = self.records()[-1]
        self.assertEqual((final["recovery_run"], final["attempt"]), ("100", "3"))
        self.assertGreaterEqual(final["age_seconds"], 60)

    def test_an_earlier_failed_recovery_does_not_stop_a_first_request(self):
        self.actions.history = [run_row(100, conclusion="failure")]
        self.assertEqual(self.ensure()["recovery_run"], "101")
        self.assertEqual(self.actions.requests, 1)

    def test_superseded_recovery_is_requested_again_within_the_bound(self):
        self.actions.outcomes = ["cancelled", "success"]
        self.assertEqual(self.ensure()["recovery_run"], "102")
        self.assertEqual(self.actions.requests, 2)

    def test_requests_end_at_their_bound(self):
        self.actions.outcomes = ["cancelled"]
        self.refused("recovery_dispatch_limit")
        self.assertEqual(self.actions.requests, self.limits["maximum_recovery_dispatches"])

    def test_successful_runs_without_usable_evidence_cannot_loop(self):
        def tick():
            if self.actions.in_flight is not None:
                self.actions.in_flight.update(status="completed", conclusion="success")
                self.actions.in_flight = None

        self.actions.tick = tick
        self.refused("recovery_dispatch_limit")
        self.assertEqual(self.actions.requests, self.limits["maximum_recovery_dispatches"])

    def test_refused_requests_stop_after_their_bound(self):
        self.actions.lost_response = True
        self.actions.starts_run = False
        self.refused("recovery_dispatch_failed")
        self.assertEqual(self.actions.requests, self.limits["maximum_recovery_dispatches"])

    def test_a_request_is_not_repeated_while_its_run_may_still_appear(self):
        self.actions.starts_run = False
        self.refused("recovery_dispatch_failed")
        self.assertGreaterEqual(
            self.clock.now - 1000.0,
            self.limits["recovery_dispatch_visibility_seconds"],
        )

    def test_a_lost_response_awaits_the_run_it_started(self):
        self.actions.lost_response = True
        self.assertEqual(self.ensure()["recovery_run"], "101")
        self.assertEqual(self.actions.requests, 1)

    def test_waiting_is_bounded_when_recovery_never_finishes(self):
        self.actions.hang = True
        self.refused("recovery_wait_deadline")
        self.assertEqual(self.actions.requests, 1)
        self.assertLessEqual(
            self.clock.now - 1000.0,
            self.limits["recovery_wait_seconds"] + self.limits["recovery_poll_seconds"],
        )

    def test_read_failures_are_retried_until_the_deadline_with_their_code(self):
        self.actions.evidence = receipt(100)
        self.actions.read_failures = 3
        self.assertEqual(self.ensure()["recovery_run"], "100")
        self.assertEqual(self.clock.sleeps, 3)
        self.actions.read_failures = 10**6
        self.refused("github_read_failed")

    def test_source_behind_main_stops_before_requesting_a_run_it_could_not_admit(self):
        self.actions.head = "b" * 40
        self.assertIn("from current main", self.refused("qualification_source_outdated"))
        self.assertEqual(self.actions.requests, 0)

    def test_source_behind_main_can_still_reuse_admitted_evidence(self):
        self.actions.head = "b" * 40
        self.actions.evidence = receipt(100)
        self.assertEqual(self.ensure()["decision"], "ready")

    def test_cancellation_ends_the_wait_and_requests_nothing_more(self):
        self.actions.in_flight = run_row(150, "in_progress", None)
        self.actions.history.insert(0, self.actions.in_flight)
        with (
            patch.object(self.clock, "sleep", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            self.ensure()
        self.assertEqual(self.actions.requests, 0)
        self.assertIn("controller_cancelled", self.summary.read_text(encoding="utf-8"))
        self.assertEqual(self.actions.in_flight["status"], "in_progress")

    def test_malformed_github_data_refuses_with_a_safe_code(self):
        self.actions.history = [{"id": 1}]
        with self.assertRaises(KeyError):
            self.ensure()
        self.assertEqual(self.actions.requests, 0)
        self.assertIn("qualification_failed", self.summary.read_text(encoding="utf-8"))

    def test_report_files_are_optional_and_write_failures_do_not_change_the_result(self):
        self.actions.evidence = receipt(100)
        with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(self.root / "missing" / "s.md")}):
            self.assertEqual(self.ensure()["decision"], "ready")
        environment = {k: v for k, v in os.environ.items() if k != "GITHUB_STEP_SUMMARY"}
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(self.ensure()["decision"], "ready")

    def test_records_expose_decisions_without_private_values(self):
        self.ensure()
        decisions = [record["decision"] for record in self.records()]
        self.assertEqual(decisions[0], "evidence")
        self.assertIn("requested", decisions)
        self.assertIn("waiting", decisions)
        self.assertEqual(decisions[-1], "admitted")
        for record in self.records():
            self.assertEqual(
                set(record),
                {
                    "age_seconds",
                    "attempt",
                    "decision",
                    "elapsed_seconds",
                    "mode",
                    "reason",
                    "recovery_run",
                    "requests",
                },
            )


class ObserverTests(PreflightCase):
    """The job holding creator authority reads evidence and can never request recovery."""

    def setUp(self):
        super().setUp()
        self.actions.job = {"status": "completed", "conclusion": "success"}

    def test_observer_accepts_older_evidence_than_the_refresher_reuses(self):
        age = self.limits["recovery_reuse_seconds"] + 60
        self.actions.evidence = receipt(100, age=age)
        self.assertEqual(self.ensure(dispatch=False)["decision"], "ready")

    def test_observer_refuses_evidence_near_expiry_even_after_the_refresher_succeeded(self):
        self.actions.evidence = receipt(100, age=self.limits["recovery_admission_seconds"] + 60)
        self.refused("fresh_recovery_required", dispatch=False)
        self.assertEqual(self.actions.requests, 0)

    def test_observer_waits_for_the_refresher_even_when_evidence_is_usable(self):
        """Admitting earlier could allocate while the refresher's recovery run still inspects."""
        age = self.limits["recovery_reuse_seconds"] + 60
        self.actions.evidence = receipt(100, age=age)
        self.actions.job = {"status": "in_progress", "conclusion": None}

        def tick():
            if self.clock.sleeps == 3:
                self.actions.job = {"status": "completed", "conclusion": "success"}
                self.actions.evidence = receipt(120)

        self.actions.tick = tick
        self.assertEqual(self.ensure(dispatch=False)["recovery_run"], "120")
        self.assertEqual(self.clock.sleeps, 3)
        self.assertEqual(self.actions.requests, 0)

    def test_observer_stops_when_the_refresher_failed_or_was_cancelled(self):
        self.actions.evidence = receipt(100)
        for conclusion in ("failure", "cancelled", "skipped"):
            with self.subTest(conclusion=conclusion):
                self.actions.job = {"status": "completed", "conclusion": conclusion}
                self.refused("recovery_preflight_failed", dispatch=False)
                self.assertEqual(self.actions.requests, 0)

    def test_observer_wait_is_bounded_when_a_second_approval_never_arrives(self):
        self.actions.evidence = receipt(100)
        self.actions.job = {"status": "waiting", "conclusion": None}
        self.refused("recovery_wait_deadline", dispatch=False)
        self.assertEqual(self.actions.requests, 0)

    def test_observer_wait_is_bounded_when_the_refresher_is_not_listed(self):
        self.actions.evidence = receipt(100)
        self.actions.job = None
        self.refused("recovery_wait_deadline", dispatch=False)

    def test_observer_retries_failed_reads_of_the_refresher(self):
        self.actions.evidence = receipt(100)
        results = [
            cycle.CycleError("github_read_failed"),
            {"status": "completed", "conclusion": "success"},
        ]
        with patch.object(self.actions, "current_job", side_effect=results):
            self.assertEqual(self.ensure(dispatch=False)["decision"], "ready")
        self.assertEqual(self.clock.sleeps, 1)

    def test_observer_stops_on_untrusted_evidence(self):
        self.actions.evidence = cycle.CycleError("recovery_source")
        self.refused("recovery_source", dispatch=False)

    def test_observer_stops_on_unresolved_or_changed_policy_evidence(self):
        self.actions.evidence = cycle.CycleError("recovery_policy_changed")
        self.refused("recovery_policy_changed", dispatch=False)
        self.actions.evidence = receipt(100)
        intent = {"identity": {"attempt": "1"}, "expires_at": now_minus(-3600)}
        self.actions.pending = [(intent, {"status": "completed", "run_attempt": 1})]
        self.refused("unresolved_prior_intent", dispatch=False)
        self.assertEqual(self.actions.requests, 0)

    def test_reuse_is_stricter_than_admission_and_the_unchanged_limit(self):
        self.assertEqual(self.limits["recovery_observation_seconds"], 1800)
        self.assertLess(
            self.limits["recovery_reuse_seconds"], self.limits["recovery_admission_seconds"]
        )
        # The controller still needs its 120 second intent window after the last check.
        self.assertGreater(
            self.limits["recovery_observation_seconds"] - self.limits["recovery_admission_seconds"],
            120,
        )


class RealLedgerTests(PreflightCase):
    """Run the classification through the real evidence reader, not the fixture above."""

    def setUp(self):
        super().setUp()
        executable = self.root / "gh"
        executable.write_bytes(b"synthetic")
        self.gh = GitHub(executable)
        self.settings, _ = fixtures()
        self.run_record = {
            "id": 999,
            "run_attempt": 1,
            "head_sha": SOURCE,
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
        }
        self.value = {
            "version": 1,
            "status": "passed",
            "identity": {
                "repository": cycle.REPOSITORY,
                "source_sha": SOURCE,
                "workflow": cycle.policy()["cleanup_workflow"],
                "run_id": "999",
                "attempt": "1",
                "event": "workflow_dispatch",
            },
            "project_binding": self.settings["project_binding"],
            "zone": self.settings["zone"],
            "policy_sha256": cycle.digest(cycle.POLICY_PATH),
            "checked_at": now_minus(10),
            "authority": "cleanup",
            "leases": [],
            "distribution_qualified": False,
        }
        workflow = {"id": 1, "path": cycle.policy()["cleanup_workflow"], "state": "active"}
        for name, value in (
            ("workflow", workflow),
            ("run", self.run_record),
            ("artifacts", [{"name": "scw-recovery-999-1"}]),
            ("pages", []),
            ("main_revision", SOURCE),
            ("recovery_runs", [run_row(999)]),
        ):
            self.enterContext(patch.object(self.gh, name, return_value=value))
        self.enterContext(
            patch.object(self.gh, "rows", side_effect=lambda *a, **k: iter([self.run_record]))
        )
        self.enterContext(
            patch.object(self.gh, "artifact", side_effect=lambda *a: copy.deepcopy(self.value))
        )
        self.dispatched = self.enterContext(patch.object(self.gh, "dispatch_recovery"))

    def attempt(self, *, dispatch=True):
        return preflight.ensure(self.gh, self.settings, IDENTITY, dispatch=dispatch)

    def test_valid_receipt_is_reused_with_its_exact_run_and_attempt(self):
        state = self.attempt()
        self.assertEqual((state["recovery_run"], state["attempt"]), ("999", "1"))
        self.dispatched.assert_not_called()

    def test_mismatched_or_failed_receipts_refuse_without_a_request(self):
        for field, value, code in (
            ("identity", {**self.value["identity"], "run_id": "1000"}, "recovery_source"),
            ("status", "failed", "recovery_status"),
            ("zone", "nl-ams-2", "recovery_configuration"),
            ("project_binding", "0" * 64, "recovery_configuration"),
        ):
            with self.subTest(field=field):
                original = copy.deepcopy(self.value)
                self.value[field] = value
                with self.assertRaises(cycle.CycleError) as caught:
                    self.attempt()
                self.assertEqual(cycle.failure_code(caught.exception), code)
                self.dispatched.assert_not_called()
                self.value = original

    def test_restored_checkpoint_requests_recovery_instead_of_admitting(self):
        self.value["authority"] = "restore"
        self.dispatched.side_effect = lambda: self.value.update(authority="cleanup")
        self.assertEqual(self.attempt()["decision"], "ready")
        self.dispatched.assert_called_once()

    def test_expired_or_earlier_policy_receipts_request_recovery(self):
        for field, value in (
            ("checked_at", "2020-01-01T00:00:00Z"),
            ("policy_sha256", "f" * 64),
        ):
            with self.subTest(field=field):
                self.dispatched.reset_mock()
                original = self.value[field]
                self.value[field] = value
                self.dispatched.side_effect = lambda field=field, original=original: (
                    self.value.update({field: original})
                )
                self.assertEqual(self.attempt()["decision"], "ready")
                self.dispatched.assert_called_once()

    def test_observer_holding_creator_authority_cannot_reach_the_dispatch(self):
        self.value["checked_at"] = "2020-01-01T00:00:00Z"
        with patch.object(
            self.gh, "current_job", return_value={"status": "completed", "conclusion": "success"}
        ):
            with self.assertRaises(cycle.CycleError) as caught:
                self.attempt(dispatch=False)
        self.assertEqual(cycle.failure_code(caught.exception), "fresh_recovery_required")
        self.dispatched.assert_not_called()


class GitHubBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        executable = Path(temporary.name).resolve() / "gh"
        executable.write_bytes(b"synthetic")
        self.gh = GitHub(executable)
        self.enterContext(patch.dict(os.environ, {"GITHUB_TOKEN": "synthetic"}))

    def test_dispatch_is_one_fixed_request_for_reconciliation_of_main(self):
        with patch.object(self.gh, "_capture", return_value=b"") as capture:
            self.gh.dispatch_recovery()
        arguments = capture.call_args.args[0]
        self.assertEqual(arguments[arguments.index("--method") + 1], "POST")
        self.assertIn(
            "repos/{owner}/{repo}/actions/workflows/installation-cleanup.yml/dispatches", arguments
        )
        fields = [arguments[i + 1] for i, value in enumerate(arguments) if value == "-f"]
        self.assertEqual(fields, ["ref=main", "inputs[mode]=recover"])

    def test_general_reads_still_cannot_write(self):
        with patch.object(self.gh, "_capture", return_value=b"{}") as capture:
            self.gh.bytes("repos/{owner}/{repo}/branches/main")
        self.assertNotIn("--method", capture.call_args.args[0])

    def test_recovery_listing_keeps_unfinished_runs_of_this_repository_only(self):
        foreign = {**run_row(3), "head_repository": {"full_name": "fork/ohtia"}}
        rows = [run_row(2, "in_progress", None), foreign, run_row(1)]
        with (
            patch.object(self.gh, "workflow", return_value={"id": 7}),
            patch.object(self.gh, "get", return_value={"workflow_runs": rows}) as get,
        ):
            self.assertEqual([r["id"] for r in self.gh.recovery_runs()], [2, 1])
        self.assertIn("/actions/workflows/7/runs?branch=main&per_page=100", get.call_args.args[0])

    def test_recovery_listing_refuses_an_unbounded_response(self):
        rows = [run_row(i) for i in range(101)]
        with (
            patch.object(self.gh, "workflow", return_value={"id": 7}),
            patch.object(self.gh, "get", return_value={"workflow_runs": rows}),
            self.assertRaisesRegex(cycle.CycleError, "github_list"),
        ):
            self.gh.recovery_runs()

    def test_current_job_is_read_from_this_exact_attempt(self):
        job = {"name": preflight.REFRESH_JOB, "status": "completed"}
        with patch.object(self.gh, "pages", return_value=[job, {"name": "other"}]) as pages:
            self.assertEqual(self.gh.current_job(IDENTITY, preflight.REFRESH_JOB), job)
        pages.assert_called_once_with(
            "repos/{owner}/{repo}/actions/runs/101/attempts/1/jobs", "jobs"
        )
        with patch.object(self.gh, "pages", return_value=[]):
            self.assertIsNone(self.gh.current_job(IDENTITY, preflight.REFRESH_JOB))

    def test_an_active_controller_waiting_for_evidence_does_not_block_recovery(self):
        """The provider step is pending while its job waits, and has no intent yet."""
        settings, _ = fixtures()
        run = {
            "id": 101,
            "run_attempt": 1,
            "head_sha": SOURCE,
            "status": "in_progress",
            "event": "workflow_dispatch",
        }
        jobs = [
            {
                "name": "Create and qualify one ARM lease",
                "steps": [
                    {
                        "name": "Create, test and remove the lease",
                        "status": "pending",
                        "conclusion": None,
                    }
                ],
            }
        ]
        with (
            patch.object(self.gh, "workflow", return_value={"id": 1}),
            patch.object(
                self.gh,
                "pages",
                side_effect=lambda endpoint, key: [run] if key == "workflow_runs" else jobs,
            ),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[]),
        ):
            self.assertEqual(self.gh.intents(settings, previous=[]), [])
        self.assertEqual(self.gh.unallocated(), [])

    def test_provider_step_cannot_have_run_without_a_successful_publication(self):
        run = {"id": 101}

        def jobs(publish, provider):
            steps = [
                {"name": PUBLISH_STEP, "status": publish[0], "conclusion": publish[1]},
                {
                    "name": "Create, test and remove the lease",
                    "status": provider[0],
                    "conclusion": provider[1],
                },
            ]
            return [{"name": "Create and qualify one ARM lease", "steps": steps}]

        closed = ("completed", "cancelled")
        for publish, provider, attempted in (
            (("pending", None), closed, False),
            (("completed", "cancelled"), closed, False),
            (("completed", "failure"), closed, False),
            (("completed", "skipped"), closed, False),
            (("in_progress", None), ("pending", None), False),
            (("completed", "success"), closed, True),
            (("completed", "success"), ("in_progress", None), True),
            (("completed", "success"), ("pending", None), False),
        ):
            with (
                self.subTest(publish=publish, provider=provider),
                patch.object(self.gh, "pages", return_value=jobs(publish, provider)),
            ):
                self.assertEqual(self.gh.provider_attempted(run, 1, intent_missing=True), attempted)

    def test_published_intent_keeps_the_cautious_reading_of_a_closed_provider_step(self):
        """An uploaded intent shows publication finished even if a lost runner's report lags."""
        steps = [
            {"name": PUBLISH_STEP, "status": "completed", "conclusion": "cancelled"},
            {
                "name": "Create, test and remove the lease",
                "status": "completed",
                "conclusion": "cancelled",
            },
        ]
        jobs = [{"name": "Create and qualify one ARM lease", "steps": steps}]
        with patch.object(self.gh, "pages", return_value=jobs):
            self.assertTrue(self.gh.provider_attempted({"id": 101}, 1))
            self.assertFalse(self.gh.provider_attempted({"id": 101}, 1, intent_missing=True))

    def test_duplicate_publication_steps_are_refused(self):
        steps = [{"name": PUBLISH_STEP, "status": "completed", "conclusion": "success"}] * 2
        with (
            patch.object(
                self.gh,
                "pages",
                return_value=[{"name": "Create and qualify one ARM lease", "steps": steps}],
            ),
            self.assertRaisesRegex(cycle.CycleError, "provider_step_count"),
        ):
            self.gh.provider_attempted({"id": 101}, 1, intent_missing=True)

    def test_runner_loss_during_the_evidence_wait_leaves_recovery_able_to_proceed(self):
        """A closed job whose provider step never ran must not block every later recovery."""
        settings, _ = fixtures()
        run = {
            "id": 101,
            "run_attempt": 1,
            "head_sha": SOURCE,
            "status": "completed",
            "event": "workflow_dispatch",
        }
        steps = [
            {"name": PUBLISH_STEP, "status": "completed", "conclusion": "cancelled"},
            {
                "name": "Create, test and remove the lease",
                "status": "completed",
                "conclusion": "cancelled",
            },
        ]
        jobs = [{"name": "Create and qualify one ARM lease", "steps": steps}]
        with (
            patch.object(self.gh, "workflow", return_value={"id": 1}),
            patch.object(
                self.gh,
                "pages",
                side_effect=lambda endpoint, key: [run] if key == "workflow_runs" else jobs,
            ),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[]),
        ):
            self.assertEqual(self.gh.intents(settings, previous=[]), [])
        self.assertEqual(self.gh.unallocated(), [{"run_id": "101", "attempt": "1"}])

    def test_rerun_that_hides_an_allocated_earlier_intent_fails_closed(self):
        """GitHub lists only the newest attempt's artifacts, as run 41258158175 showed."""
        settings, _ = fixtures()
        run = {
            "id": 101,
            "run_attempt": 2,
            "head_sha": SOURCE,
            "status": "in_progress",
            "event": "workflow_dispatch",
        }
        steps = [
            {"name": PUBLISH_STEP, "status": "completed", "conclusion": "success"},
            {
                "name": "Create, test and remove the lease",
                "status": "completed",
                "conclusion": "failure",
            },
        ]
        jobs = [{"name": "Create and qualify one ARM lease", "steps": steps}]
        with (
            patch.object(self.gh, "workflow", return_value={"id": 1}),
            patch.object(
                self.gh,
                "pages",
                side_effect=lambda endpoint, key: [run] if key == "workflow_runs" else jobs,
            ),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[]),
            self.assertRaisesRegex(cycle.CycleError, "missing_allocation_intent"),
        ):
            self.gh.intents(settings, previous=[], excluding=("101", "2"))

    def test_only_an_earlier_attempt_of_an_active_run_has_ended(self):
        intent = {"identity": {"attempt": "1"}}
        self.assertTrue(attempt_ended(intent, {"status": "completed", "run_attempt": 1}))
        self.assertTrue(attempt_ended(intent, {"status": "in_progress", "run_attempt": 2}))
        self.assertFalse(attempt_ended(intent, {"status": "in_progress", "run_attempt": 1}))


class RecoveryInteractionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.settings, self.intent = fixtures()
        self.api = MemoryAPI(self.settings)
        self.api.role = "cleanup"
        self.identity = {
            **self.intent["identity"],
            "workflow": cycle.policy()["cleanup_workflow"],
            "run_id": "999",
            "event": "workflow_dispatch",
        }
        self.gh = Mock(spec=GitHub)
        self.gh.unallocated.return_value = []
        self.gh.completed_ledger.return_value = {"leases": []}
        self.gh.journal.return_value = None
        self.gh.prior_recovery.return_value = None
        self.gh.provider_attempted.return_value = True
        self.enterContext(patch.object(qualification, "enabled"))
        self.enterContext(patch.object(cycle, "source_context", return_value=self.identity))
        self.enterContext(patch.object(cycle, "configuration", return_value=self.settings))
        self.enterContext(patch.object(cycle, "API", return_value=self.api))
        self.enterContext(patch.object(cycle, "validate_intent"))
        self.enterContext(patch.object(cycle.time, "sleep"))

    def recover(self, intent, producer):
        self.gh.intents.return_value = [(intent, producer)]
        plan = self.root / "plan"
        qualification.prepare_recovery(self.gh, plan)
        planned = cycle.read(plan / "plan.json")
        self.gh.artifacts.return_value = [{"name": planned["artifact_name"]}]
        self.gh.artifact.return_value = planned
        qualification.recover(self.gh, self.root / "result", plan / "plan.json")
        return cycle.read(self.root / "result/recovery.json")

    def test_current_attempt_of_an_active_producer_keeps_its_valid_lease(self):
        intent = {**self.intent, "expires_at": now_minus(-3600)}
        result = self.recover(intent, {"id": 101, "status": "in_progress", "run_attempt": 1})
        self.assertEqual(result["deferred"], [intent["nonce"]])
        self.assertEqual(result["leases"], [])

    def test_earlier_attempt_is_reconciled_while_its_rerun_waits_for_evidence(self):
        self.gh.journal.return_value = {"resources": {}, "allocation_resolved": True}
        intent = {**self.intent, "expires_at": now_minus(-3600)}
        result = self.recover(intent, {"id": 101, "status": "in_progress", "run_attempt": 2})
        self.assertEqual(result["deferred"], [])
        self.assertEqual(result["leases"][0]["receipt"]["status"], "absent")
        self.assertEqual(result["status"], "passed")

    def test_earlier_attempt_that_never_reached_the_provider_needs_no_journal(self):
        self.gh.provider_attempted.return_value = False
        intent = {**self.intent, "expires_at": now_minus(-3600)}
        result = self.recover(intent, {"id": 101, "status": "in_progress", "run_attempt": 2})
        self.assertTrue(result["leases"][0]["receipt"]["allocation_resolved"])
        self.assertFalse(any(method != "GET" for method, _, _ in self.api.calls))


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        _, intent = fixtures()
        self.identity = intent["identity"]
        self.intent = {**intent, "created_at": cycle.utc()}
        self.source = self.root / "intent"
        self.source.mkdir()
        cycle.write(self.source / "intent.json", self.intent)
        self.gh = Mock()
        self.gh.artifacts.return_value = [{"name": "scw-intent-101-1"}]
        self.gh.artifact.return_value = self.intent

    def rehearse(self, *, published=True):
        if not published:
            self.gh.artifacts.return_value = []
        output = self.root / "cycle"
        with (
            patch.object(cycle, "source_context", return_value=self.identity),
            patch.object(cycle, "configuration", return_value={}),
            patch.object(cycle, "validate_intent"),
            patch.object(cycle, "API") as provider,
            patch.object(cycle, "command") as command,
            patch.object(qualification, "enabled"),
            patch.object(qualification, "key_lifetimes"),
            patch.object(qualification, "previous") as previous,
            patch.dict(os.environ, {"RUNNER_TEMP": str(self.root), "GITHUB_STEP_SUMMARY": ""}),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            try:
                qualification.execute(self.gh, self.source, self.root, output, "before-allocation")
            finally:
                provider.assert_not_called()
                command.assert_not_called()
                self.assertFalse(list(self.root.glob("ohtia-lease-*")))
        previous.assert_called_once()
        return output

    def test_rehearsal_passes_every_admission_and_calls_no_provider(self):
        output = self.rehearse()
        journal = cycle.read(output / "journal.json")
        self.assertEqual(journal["status"], "not-started")
        self.assertTrue(journal["allocation_resolved"])
        self.assertEqual(journal["resources"], {})
        self.assertFalse(journal["native_smoke_passed"])
        final = cycle.read(output / "controller-progress.json")
        self.assertEqual((final["fault"], final["status"]), ("before-allocation", "succeeded"))

    def test_rehearsal_still_requires_its_published_intent(self):
        with self.assertRaisesRegex(cycle.CycleError, "published_intent_required"):
            self.rehearse(published=False)

    def test_rehearsal_completion_is_recorded_with_its_fault(self):
        output = self.rehearse()
        with (
            contextlib.redirect_stdout(io.StringIO()),
            patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}),
        ):
            result = progress.completion(
                output, self.identity, self.intent["profile"], "before-allocation", "success"
            )
        self.assertEqual((result["status"], result["controller_result"]), ("observed", "succeeded"))

    def test_unknown_fault_is_refused(self):
        self.assertNotIn("skip-admission", cycle.FAULTS)
        with self.assertRaisesRegex(cycle.CycleError, "progress_identity"):
            progress.Progress(self.root, self.identity, self.intent["profile"], "skip-admission")


class CommandTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.executable = Path(temporary.name).resolve() / "gh"
        self.executable.write_bytes(b"synthetic")

    def invoke(self, *arguments):
        with (
            patch.object(sys, "argv", ["scaleway_qualification.py", *arguments]),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            return qualification.main()

    def test_ensure_recovery_grants_dispatch_only_through_its_explicit_flag(self):
        for extra, expected in (([], False), (["--dispatch"], True)):
            with (
                self.subTest(extra=extra),
                patch.object(qualification, "ensure_recovery") as ensure,
            ):
                self.assertEqual(
                    self.invoke("ensure-recovery", "--cli", str(self.executable), *extra), 0
                )
                self.assertEqual(ensure.call_args.kwargs, {"dispatch": expected})

    def test_other_operations_still_require_their_output(self):
        with self.assertRaises(SystemExit) as caught:
            self.invoke("prepare-recovery", "--cli", str(self.executable))
        self.assertEqual(caught.exception.code, 2)

    def test_failed_preflight_exits_nonzero_with_a_safe_code(self):
        with patch.object(
            qualification, "ensure_recovery", side_effect=cycle.CycleError("recovery_run_failed")
        ):
            self.assertEqual(self.invoke("ensure-recovery", "--cli", str(self.executable)), 1)

    def test_disabled_controls_stop_before_any_github_read(self):
        gh = Mock(spec=GitHub)
        with (
            patch.dict(os.environ, {"SCW_CYCLE_ENABLED": "false"}, clear=False),
            self.assertRaisesRegex(cycle.CycleError, "cycle_not_enabled"),
        ):
            qualification.ensure_recovery(gh, dispatch=True)
        self.assertEqual(gh.mock_calls, [])

    def test_admission_checks_run_before_evidence_is_read(self):
        order = []
        gh = Mock(spec=GitHub)
        gh.run.side_effect = lambda *a, **k: order.append("run")
        gh.guards.side_effect = lambda: order.append("guards")
        with (
            patch.object(qualification, "enabled", side_effect=lambda: order.append("enabled")),
            patch.object(cycle, "source_context", return_value={"run_id": "1"}),
            patch.object(qualification, "key_lifetimes", side_effect=lambda: order.append("keys")),
            patch.object(cycle, "configuration", return_value={}),
            patch.object(preflight, "ensure", side_effect=lambda *a, **k: order.append("ensure")),
        ):
            qualification.ensure_recovery(gh, dispatch=False)
        self.assertEqual(order, ["enabled", "run", "guards", "keys", "ensure"])

    def test_policy_refuses_an_inconsistent_recovery_budget(self):
        for changes in (
            {"recovery_reuse_seconds": 1500},
            {"recovery_admission_seconds": 1800},
            {"recovery_dispatch_visibility_seconds": 1},
            {"recovery_wait_seconds": 60},
        ):
            with self.subTest(changes=changes):
                selected = copy.deepcopy(json.loads(cycle.POLICY_PATH.read_text(encoding="utf-8")))
                selected["limits"].update(changes)
                with (
                    patch.object(cycle, "read", return_value=selected),
                    self.assertRaisesRegex(cycle.CycleError, "recovery_budget"),
                ):
                    cycle.policy()


class WorkflowContractTests(unittest.TestCase):
    """Check the declared authority; only a live run shows what GitHub actually enforces."""

    def setUp(self):
        self.qualification = QUALIFICATION.read_text(encoding="utf-8")
        self.recovery = RECOVERY.read_text(encoding="utf-8")
        self.jobs = self.sections(self.qualification)

    @staticmethod
    def sections(text: str) -> dict:
        body = text.split("\njobs:\n", 1)[1]
        parts = re.split(r"^  ([a-z-]+):\n", body, flags=re.MULTILINE)
        return dict(zip(parts[1::2], parts[2::2], strict=True))

    def test_job_order_places_evidence_before_build_and_approval(self):
        self.assertEqual(
            list(self.jobs), ["recovery-preflight", "build", "recovery-refresh", "qualify"]
        )
        self.assertNotIn("needs:", self.jobs["recovery-preflight"])
        self.assertIn("needs: recovery-preflight\n", self.jobs["build"])
        self.assertIn("needs: build\n", self.jobs["recovery-refresh"])
        self.assertIn("needs: build\n", self.jobs["qualify"])

    def test_request_authority_stays_in_jobs_without_any_cloud_credential(self):
        for name in ("recovery-preflight", "recovery-refresh"):
            with self.subTest(job=name):
                job = self.jobs[name]
                self.assertIn("actions: write\n", job)
                self.assertIn("ensure-recovery --dispatch", job)
                self.assertNotIn("secrets.", job)
                self.assertNotIn("SCW_SECRET_KEY", job)
                self.assertNotIn("download-artifact", job)
                self.assertNotIn("persist-credentials: true", job)
        self.assertEqual(self.qualification.count("actions: write"), 2)
        self.assertEqual(self.qualification.count("--dispatch"), 2)

    def test_creator_job_only_reads_actions_and_observes_evidence(self):
        job = self.jobs["qualify"]
        self.assertIn("actions: read\n", job)
        self.assertNotIn("actions: write", job)
        self.assertNotIn("--dispatch", job)
        self.assertLess(
            job.index("ensure-recovery"), job.index("scaleway_qualification.py prepare")
        )
        self.assertLess(job.index("scaleway_qualification.py prepare"), job.index("SCW_SECRET_KEY"))

    def test_build_has_no_authority_added_by_the_prerequisite(self):
        self.assertNotIn("permissions:", self.jobs["build"])
        self.assertNotIn("GITHUB_TOKEN", self.jobs["build"])

    def test_paid_approval_gate_is_unchanged_and_precedes_the_refresh(self):
        self.assertNotIn("environment:", self.jobs["recovery-preflight"])
        for name in ("recovery-refresh", "qualify"):
            self.assertIn("environment: scaleway-qualification\n", self.jobs[name])

    def test_observer_reads_the_refresh_job_by_its_declared_name(self):
        self.assertIn(f"name: {preflight.REFRESH_JOB}\n", self.jobs["recovery-refresh"])

    def test_historical_job_and_step_identities_remain_for_the_recovery_reader(self):
        self.assertIn("name: Create and qualify one ARM lease\n", self.jobs["qualify"])
        self.assertIn("name: Create, test and remove the lease\n", self.jobs["qualify"])
        self.assertIn(f"name: {PUBLISH_STEP}\n", self.jobs["qualify"])

    def test_provider_step_runs_only_after_its_intent_was_published(self):
        job = self.jobs["qualify"]
        publish = job.index(f"name: {PUBLISH_STEP}\n")
        provider = job.index("name: Create, test and remove the lease\n")
        self.assertLess(publish, provider)
        # A step without its own condition runs only when the steps before it succeeded.
        self.assertNotIn("if:", job[publish : job.index("name: Summarize controller completion")])

    def test_timeouts_cover_the_policy_wait_and_keep_the_controller_bound(self):
        limits = cycle.policy()["limits"]
        minutes = (limits["recovery_wait_seconds"] + 120) // 60 + 1
        for name in ("recovery-preflight", "recovery-refresh", "qualify"):
            found = re.search(
                r"name: (?:Reuse recent|Wait for admitted).*\n\s+timeout-minutes: ([0-9]+)\n",
                self.jobs[name],
            )
            self.assertGreaterEqual(int(found[1]), minutes)
        controller = re.search(
            r"id: controller\n\s+timeout-minutes: ([0-9]+)\n", self.jobs["qualify"]
        )
        self.assertLessEqual(int(controller[1]) * 60, limits["lease_seconds"])
        self.assertGreater(
            int(controller[1]) * 60, limits["test_seconds"] + limits["cleanup_seconds"]
        )
        job = int(re.search(r"\n    timeout-minutes: ([0-9]+)\n", self.jobs["qualify"])[1])
        self.assertGreaterEqual(job, int(controller[1]) + 30)

    def test_recovery_stays_independent_of_qualification_and_triggers_nothing(self):
        self.assertIn("workflows: [Installation ARM qualification]", self.recovery)
        self.assertIn("types: [completed]", self.recovery)
        self.assertIn('cron: "7,22,37,52 * * * *"', self.recovery)
        self.assertIn("workflow_dispatch:", self.recovery)
        self.assertNotIn("actions: write", self.recovery)
        self.assertNotIn("ensure-recovery", self.recovery)
        self.assertNotIn("needs:", self.recovery)

    def test_workflows_cannot_deadlock_or_cancel_each_other(self):
        self.assertIn("group: installation-scaleway-creator", self.qualification)
        recover = self.sections(self.recovery)["recover"]
        self.assertIn("group: installation-scaleway-recovery", recover)
        self.assertNotIn("group: installation-scaleway-creator", recover)
        for text in (self.qualification, recover):
            self.assertIn("cancel-in-progress: false", text)
        self.assertNotIn("cancel-in-progress: true", self.qualification + self.recovery)

    def test_enablement_controls_keep_their_independent_purposes(self):
        condition = "vars.SCW_CYCLE_ENABLED == 'true' && vars.SCW_RECOVERY_ENABLED == 'true'"
        for job in self.jobs.values():
            self.assertIn(condition, job)
        recover = self.sections(self.recovery)["recover"]
        self.assertIn("vars.SCW_RECOVERY_ENABLED == 'true'", recover)
        self.assertNotIn("vars.SCW_CYCLE_ENABLED ==", recover)

    def test_rehearsal_input_and_fault_list_match(self):
        self.assertIn(f"options: [{', '.join(cycle.FAULTS)}]", self.qualification)


if __name__ == "__main__":
    unittest.main()
