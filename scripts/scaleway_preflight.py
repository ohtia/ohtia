"""Obtain independent recovery evidence before qualification allocates anything."""

from __future__ import annotations

import json
import os
import time

import scaleway_cycle as cycle
from scaleway_ledger import GitHub, attempt_ended

REFRESH_JOB = "Refresh recovery evidence after approval"
# A newer successful recovery run supersedes evidence in these states; others need a person.
REFRESHABLE = frozenset({"fresh_recovery_required", "recovery_policy_changed"})
TRANSIENT = frozenset({"github_deadline", "github_read_failed"})
FAILED_CONCLUSIONS = frozenset({"failure", "startup_failure", "timed_out"})
NO_RESULT_CONCLUSIONS = frozenset({"cancelled", "skipped"})
RELAUNCH = "Dispatch qualification again from current main."
ACTIONS = {
    "active_lease_present": "An unexpired lease is still active and is not reclaimed for this "
    "request. Dispatch qualification again after it finishes or expires.",
    "controller_cancelled": "This job was cancelled. Independent recovery is unaffected.",
    "fresh_recovery_required": "Recovery succeeded earlier but its observation is no longer "
    "recent enough. " + RELAUNCH,
    "qualification_source_outdated": "main advanced after this dispatch, so a new recovery run "
    "could not be admitted here. " + RELAUNCH,
    "recovery_dispatch_failed": "GitHub did not start a recovery run. Check the job's actions "
    "permission and GitHub's availability. " + RELAUNCH,
    "recovery_dispatch_limit": "Requested recovery runs finished without usable evidence. "
    "Inspect the listed run. " + RELAUNCH,
    "recovery_preflight_failed": "The refresh job failed. Inspect its summary. " + RELAUNCH,
    "recovery_run_failed": "Inspect the listed recovery run and correct its cause. " + RELAUNCH,
    "recovery_wait_deadline": "Recovery did not provide evidence within the wait limit. "
    "Inspect the listed run. " + RELAUNCH,
    "run_not_main_ancestor": "A recovery run used a newer main than this dispatch. " + RELAUNCH,
    "unresolved_prior_intent": "An earlier allocation has no absence receipt yet. Inspect the "
    "newest recovery run. " + RELAUNCH,
}
DEFAULT_ACTION = "Inspect the listed recovery run and its retained artifacts. " + RELAUNCH


class Report:
    """Publish decision changes in Actions; these records describe progress, not authority."""

    def __init__(self, *, dispatch: bool):
        self.mode = "request" if dispatch else "observe"
        self.started = time.monotonic()
        self.last = None
        self.values = {"recovery_run": None, "attempt": None, "age_seconds": None, "requests": 0}

    def note(self, decision: str, reason: str | None = None, **values) -> None:
        if "recovery_run" in values and values["recovery_run"] != self.values["recovery_run"]:
            self.values.update(attempt=None, age_seconds=None)
        self.values.update(values)
        change = (decision, reason, self.values["recovery_run"], self.values["requests"])
        if change == self.last:
            return
        self.last = change
        record = {
            "decision": decision,
            "elapsed_seconds": int(time.monotonic() - self.started),
            "mode": self.mode,
            "reason": reason,
            **self.values,
        }
        print("OHTIA_ARM_PREFLIGHT=" + json.dumps(record, sort_keys=True), flush=True)

    def finish(self, failure: str | None) -> None:
        self.note("refused" if failure else "admitted", failure)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if not summary:
            return
        run, attempt = self.values["recovery_run"], self.values["attempt"]
        lines = [
            "\n### ARM recovery preflight\n\n",
            f"- Result: `{'refused' if failure else 'admitted'}`.\n",
            f"- Recovery run: `{run or 'none'}`; attempt: `{attempt or 'unknown'}`; "
            f"observation age in seconds: `{self.values['age_seconds']}`; "
            f"recovery requests from this job: `{self.values['requests']}`.\n",
        ]
        if failure:
            lines += [
                f"- Failure: `{failure}`. {ACTIONS.get(failure, DEFAULT_ACTION)}\n",
                "- This step allocates nothing and leaves retained recovery obligations in place.\n",
            ]
        try:
            with open(summary, "a", encoding="utf-8") as stream:
                stream.writelines(lines)
        except OSError:
            pass


def observe(gh: GitHub, settings: dict, current: tuple[str, str], maximum_age: int) -> dict:
    """Classify the newest evidence; anything a refresh cannot correct stops qualification."""
    try:
        value = gh.completed_ledger(settings, fresh=True)
    except cycle.CycleError as error:
        code = cycle.failure_code(error)
        if code in REFRESHABLE:
            return {"decision": "refresh", "reason": code}
        raise
    now = cycle.timestamp(cycle.utc())
    age = int((now - cycle.timestamp(value["checked_at"])).total_seconds())
    state = {
        "recovery_run": value["identity"]["run_id"],
        "attempt": value["identity"]["attempt"],
        "age_seconds": age,
    }
    pending = gh.intents(
        settings,
        previous=value["leases"],
        excluding=current,
        unallocated=value.get("unallocated_attempts", []),
    )
    cycle.require(
        all(
            attempt_ended(intent, producer) or now >= cycle.timestamp(intent["expires_at"])
            for intent, producer in pending
        ),
        "active_lease_present",
    )
    if pending:
        return {"decision": "refresh", "reason": "unresolved_prior_intent", **state}
    cycle.require(
        len(value["leases"]) < cycle.policy()["limits"]["maximum_leases"], "ledger_capacity"
    )
    if age > maximum_age:
        return {"decision": "refresh", "reason": "fresh_recovery_required", **state}
    return {"decision": "ready", "reason": None, **state}


def request_recovery(gh: GitHub, runs: list, sent: dict, report: Report, reason: str) -> None:
    """Start a run unless one already answered; a lost response still counts as a request."""
    limits = cycle.policy()["limits"]
    # After a request only a newer run can answer it; before one, the runs this job awaited can.
    answered = [
        row
        for row in runs
        if (row["id"] > sent["baseline"] if sent["requests"] else row["id"] in sent["awaited"])
    ]
    if answered:
        # A cancelled run reached no result, so it cannot hide an older run's failure.
        decided = [row for row in answered if row["conclusion"] not in NO_RESULT_CONCLUSIONS]
        latest = max(decided or answered, key=lambda row: row["id"])
        report.note("observed", reason, recovery_run=str(latest["id"]))
        cycle.require(latest["conclusion"] not in FAILED_CONCLUSIONS, "recovery_run_failed")
    elif (
        sent["requests"]
        and time.monotonic() - sent["at"] < limits["recovery_dispatch_visibility_seconds"]
    ):
        return
    if sent["requests"] >= limits["maximum_recovery_dispatches"]:
        raise cycle.CycleError(
            "recovery_dispatch_limit" if answered else "recovery_dispatch_failed"
        )
    # GitHub starts dispatched runs from the head of main, which this source could not admit.
    cycle.require(gh.main_revision() == os.environ["GITHUB_SHA"], "qualification_source_outdated")
    sent.update(
        baseline=max((row["id"] for row in runs), default=0),
        requests=sent["requests"] + 1,
        at=time.monotonic(),
    )
    report.note("requested", reason, requests=sent["requests"])
    try:
        gh.dispatch_recovery()
    except cycle.CycleError as error:
        if cycle.failure_code(error) not in TRANSIENT:
            raise


def noted(report: Report, state: dict) -> dict:
    values = ("recovery_run", "attempt", "age_seconds")
    report.note("evidence", state["reason"], **{k: state[k] for k in values if k in state})
    return state


def requester(gh: GitHub, settings: dict, current: tuple[str, str], report: Report):
    """Reuse recent evidence, await unfinished recovery or request a new run."""
    maximum_age = cycle.policy()["limits"]["recovery_reuse_seconds"]
    sent = {"requests": 0, "baseline": 0, "at": 0.0, "awaited": set()}
    state = None

    def step() -> dict | None:
        nonlocal state
        runs = gh.recovery_runs()
        active = [row for row in runs if row["status"] != "completed"]
        # Unfinished recovery cannot change the evidence, so spare the longer read until then.
        if state is None or not active:
            state = noted(report, observe(gh, settings, current, maximum_age))
            if state["decision"] == "ready":
                return state
        if active:
            sent["awaited"].update(row["id"] for row in active)
            newest = max(active, key=lambda row: row["id"])
            report.note("waiting", state["reason"], recovery_run=str(newest["id"]))
        else:
            request_recovery(gh, runs, sent, report, state["reason"])
        return None

    return step


def observer(gh: GitHub, settings: dict, identity: dict, current: tuple[str, str], report: Report):
    """Read evidence once the refresh job ends, so its recovery run cannot overlap allocation."""
    maximum_age = cycle.policy()["limits"]["recovery_admission_seconds"]

    def step() -> dict | None:
        job = gh.current_job(identity, REFRESH_JOB)
        if job is None or job["status"] != "completed":
            report.note("waiting", "refresh_job_unfinished")
            return None
        cycle.require(job["conclusion"] == "success", "recovery_preflight_failed")
        state = noted(report, observe(gh, settings, current, maximum_age))
        if state["decision"] != "ready":
            raise cycle.CycleError(state["reason"])
        return state

    return step


def bounded(step, report: Report) -> dict:
    """Repeat one decision until it yields evidence; failed GitHub reads retry within the bound."""
    limits = cycle.policy()["limits"]
    deadline = time.monotonic() + limits["recovery_wait_seconds"]
    read_failure = None
    while True:
        try:
            state = step()
            if state is not None:
                return state
            read_failure = None
        except cycle.CycleError as error:
            read_failure = cycle.failure_code(error)
            if read_failure not in TRANSIENT:
                raise
            report.note("retrying", read_failure)
        if time.monotonic() >= deadline:
            raise cycle.CycleError(read_failure or "recovery_wait_deadline")
        time.sleep(limits["recovery_poll_seconds"])


def ensure(gh: GitHub, settings: dict, identity: dict, *, dispatch: bool) -> dict:
    """Return usable evidence, requesting recovery only when this job holds dispatch authority."""
    report = Report(dispatch=dispatch)
    current = (identity["run_id"], identity["attempt"])
    try:
        step = (
            requester(gh, settings, current, report)
            if dispatch
            else observer(gh, settings, identity, current, report)
        )
        state = bounded(step, report)
    except BaseException as error:
        report.finish(cycle.failure_code(error))
        raise
    report.finish(None)
    return state
