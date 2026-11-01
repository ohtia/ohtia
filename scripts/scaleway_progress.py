"""Bounded public controller progress; observations never grant execution authority."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import threading
import time
from pathlib import Path

import scaleway_bootstrap as bootstrap
import scaleway_cycle as cycle

PHASES = frozenset(
    {
        "preflight",
        "allocation",
        "host-key",
        "bootstrap",
        "transfer",
        "install",
        "smoke",
        "evidence",
        "cleanup",
        "controller-loss",
        "complete",
    }
)
OBSERVATIONS = frozenset(
    {
        "not-observed",
        "allocation-response",
        "host-key-admitted",
        "host-server-observed",
        "host-ip-unattached",
        "host-fingerprint-missing",
        "host-fingerprint-present",
        "host-keyscan-failed",
        "host-keygen-failed",
        "ssh-execution-confirmed",
        "interpreter-or-helper-unavailable",
        "bootstrap-not-ready",
        "bootstrap-ready",
        "bootstrap-failed",
        "transfer-complete",
        "installation-complete",
        "native-smoke-passed",
        "resources-absent",
    }
)
TRANSPORT_CATEGORIES = frozenset(
    {
        "success",
        "process-failed",
        "process-timeout",
        "output-limit",
        "local-io-failed",
        "controller-cancelled",
        "authentication-rejected-marker",
        "connection-refused-marker",
        "connection-timeout-marker",
        "host-key-rejected-marker",
    }
)
OPERATIONS = frozenset(
    {
        "host-keyscan",
        "host-keygen",
        "ssh-readiness",
        "bootstrap-status",
        "transfer",
        "install",
        "smoke",
        "evidence",
        "guest-diagnostics",
    }
)
UNIT_STATES = frozenset(
    {
        "active",
        "reloading",
        "inactive",
        "failed",
        "activating",
        "deactivating",
        "maintenance",
        "refreshing",
        "unavailable",
    }
)
UNITS = (
    "cloud-init.service",
    "cloud-init-network.service",
    "cloud-config.service",
    "cloud-final.service",
)
READINESS_COMMAND = (
    "printf '{\"python\":'; if test -x /usr/bin/python3; then printf true; else printf false; fi; "
    "printf ',\"helper\":'; if test -r /usr/local/lib/ohtia-qualification/bootstrap.py; "
    "then printf true; else printf false; fi; printf '}\\n'"
)


def stderr_category(data: bytes) -> str:
    """Reported markers are hints only; no remote text survives classification."""
    for marker, category in (
        (b"REMOTE HOST IDENTIFICATION HAS CHANGED", "host-key-rejected-marker"),
        (b"Host key verification failed", "host-key-rejected-marker"),
        (b"Permission denied (publickey", "authentication-rejected-marker"),
        (b"Connection refused", "connection-refused-marker"),
        (b"Connection timed out", "connection-timeout-marker"),
    ):
        if marker in data:
            return category
    return "process-failed"


def _provider_enum(value: object, allowed: set[str]) -> str:
    if value is None:
        return "unavailable"
    return value if isinstance(value, str) and value in allowed else "other"


class Progress:
    """Observe synchronously changing phases with a controller-only heartbeat."""

    def __init__(self, directory: Path, identity: dict, profile: str, fault: str):
        self.limits = cycle.policy()["limits"]
        cycle.require(
            profile in cycle.policy()["profiles"] and fault in {"none", "after-native-smoke"},
            "progress_identity",
        )
        cycle.sha(identity["source_sha"], 40)
        cycle.require(
            all(
                isinstance(identity[k], str) and re.fullmatch(r"[1-9][0-9]{0,19}", identity[k])
                for k in ("run_id", "attempt")
            ),
            "progress_identity",
        )
        self.directory = directory
        self.started = time.monotonic()
        self.deadline = None
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.thread = None
        self.history = []
        self.emitted = 0
        self.change_emitted = 0
        self.transport_states = {}
        self.host_key_state = None
        interval = self.limits["progress_interval_seconds"]
        self.heartbeat_reserve = min(
            self.limits["progress_maximum_records"] // 2,
            (self.limits["lease_seconds"] + interval - 1) // interval,
        )
        self.state = {
            "version": 1,
            "identity": {k: identity[k] for k in ("source_sha", "run_id", "attempt")},
            "profile": profile,
            "fault": fault,
            "phase": "preflight",
            "status": "running",
            "controller_alive": True,
            "last_observation": "not-observed",
            "guest_state": "unknown",
            "ssh_readiness": None,
            "allocation_role": None,
            "last_observed_at": None,
            "attempts": {},
            "last_transport": None,
            "bootstrap_transport_failure": None,
            "primary_failure": None,
            "diagnostic_write_failures": 0,
        }

    def __enter__(self):
        self.emit("phase")
        self.thread = threading.Thread(target=self._heartbeat, daemon=True, name="arm-progress")
        self.thread.start()
        return self

    def _heartbeat(self):
        while not self.stop.wait(self.limits["progress_interval_seconds"]):
            self.emit("heartbeat")

    def emit(self, event: str):
        cycle.require(
            event in {"phase", "heartbeat", "observation", "transport", "failure", "final"},
            "progress_operation",
        )
        with self.lock:
            self._emit(event)

    def _emit(self, event: str):
        now = time.monotonic()
        record = {
            **self.state,
            "attempts": dict(self.state["attempts"]),
            "event": event,
            "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "elapsed_seconds": max(0, int(now - self.started)),
            "remaining_seconds": max(0, int(self.deadline - now))
            if self.deadline is not None
            else None,
        }
        encoded = (json.dumps(record, sort_keys=True, indent=2) + "\n").encode()
        if len(encoded) > self.limits["progress_record_bytes"]:
            return
        self.history.append(record)
        self.history = self.history[-self.limits["progress_maximum_records"] :]
        try:
            cycle.write(
                self.directory / "controller-progress.json", record, discard_incomplete=True
            )
            cycle.write(
                self.directory / "controller-events.json",
                {"version": 1, "events": self.history},
                discard_incomplete=True,
            )
        except (OSError, ValueError):
            self.state["diagnostic_write_failures"] = min(
                999999, self.state["diagnostic_write_failures"] + 1
            )
        final = event == "final"
        bound = self.limits["progress_maximum_records"] - (0 if final else 1)
        change_budget = self.limits["progress_maximum_records"] - self.heartbeat_reserve - 1
        change_allowed = event in {"heartbeat", "final"} or self.change_emitted < change_budget
        if self.emitted < bound and change_allowed:
            try:
                print(
                    "OHTIA_ARM_PROGRESS="
                    + json.dumps(record, sort_keys=True, separators=(",", ":")),
                    flush=True,
                )
            except (OSError, ValueError):
                pass
            self.emitted += 1
            if event not in {"heartbeat", "final"}:
                self.change_emitted += 1

    def phase(self, name: str, *, deadline: float | None = None):
        cycle.require(name in PHASES, "progress_phase")
        with self.lock:
            self.state["phase"] = name
            if deadline is not None:
                self.deadline = deadline
            self._emit("phase")

    def observe(self, name: str):
        cycle.require(name in OBSERVATIONS, "progress_observation")
        with self.lock:
            changed = self.state["last_observation"] != name
            self.state["last_observation"] = name
            if name in {
                "ssh-execution-confirmed",
                "bootstrap-not-ready",
                "bootstrap-ready",
                "bootstrap-failed",
                "native-smoke-passed",
            }:
                self.state["guest_state"] = name
            self.state["last_observed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            if changed:
                self._emit("observation")

    def readiness(self, value: dict):
        with self.lock:
            present = {"python": value["python"], "helper": value["helper"]}
            changed = self.state["ssh_readiness"] != present
            self.state["ssh_readiness"] = present
            self.state["last_observed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            if changed:
                self.state["guest_state"] = "ssh-execution-confirmed"
                self.state["last_observation"] = (
                    "ssh-execution-confirmed"
                    if all(present.values())
                    else "interpreter-or-helper-unavailable"
                )
                self._emit("observation")

    def allocation(self, role: str, stage: str):
        cycle.require(
            role in cycle.KINDS and stage in {"write_intent", "allocated"}, "progress_operation"
        )
        with self.lock:
            self.state["allocation_role"] = role
            self._emit("phase")
        if stage == "allocated":
            self.observe("allocation-response")

    def attempted(self, operation: str):
        cycle.require(operation in OPERATIONS, "progress_operation")
        with self.lock:
            attempts = self.state["attempts"]
            attempts[operation] = min(999999, attempts.get(operation, 0) + 1)

    def transport(self, operation: str, observation: dict):
        cycle.require(operation in OPERATIONS, "progress_operation")
        category = observation.get("category")
        if category not in TRANSPORT_CATEGORIES:
            return
        status = observation.get("exit_code")
        status = status if type(status) is int and -255 <= status <= 255 else None
        with self.lock:
            previous = self.transport_states.get(operation)
            self.state["last_transport"] = {
                "operation": operation,
                "category": category,
                "exit_code": status,
            }
            self.transport_states[operation] = dict(self.state["last_transport"])
            if operation in {"ssh-readiness", "bootstrap-status"} and category not in {
                "success",
                "controller-cancelled",
            }:
                self.state["bootstrap_transport_failure"] = dict(self.state["last_transport"])
            try:
                cycle.write(
                    self.directory / "bootstrap-transport.json",
                    {
                        "version": 1,
                        "identity": self.state["identity"],
                        "attempts": dict(self.state["attempts"]),
                        "last_transport": self.state["last_transport"],
                        "bootstrap_transport_failure": self.state["bootstrap_transport_failure"],
                        "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    },
                    discard_incomplete=True,
                )
            except (OSError, ValueError):
                self.state["diagnostic_write_failures"] = min(
                    999999, self.state["diagnostic_write_failures"] + 1
                )
            if previous != self.state["last_transport"]:
                self._emit("transport")

    def host_key(self, nonce: str, operation: str, **observations):
        """Retain selected admission observations, never raw metadata or key material."""
        cycle.require(
            operation in {"server", "ip", "fingerprint", "keyscan", "keygen", "admitted"},
            "progress_operation",
        )
        cycle.identifier(nonce)
        with self.lock:
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            if self.host_key_state is None:
                self.host_key_state = {
                    "version": 1,
                    "identity": dict(self.state["identity"]),
                    "profile": self.state["profile"],
                    "nonce": nonce,
                    "server_state": "unavailable",
                    "boot_type": "unavailable",
                    "ip_attachment": "unobserved",
                    "fingerprint_status": "unobserved",
                    "scan": {"attempts": 0, "category": None, "exit_code": None},
                    "provider_failure": None,
                }
            value = self.host_key_state
            value.update(operation=operation, observed_at=now)
            server = observations.get("server")
            if isinstance(server, dict):
                state = server.get("state")
                if state == "stopped in place":
                    value["server_state"] = "stopped-in-place"
                else:
                    value["server_state"] = _provider_enum(
                        state, {"running", "starting", "stopped", "stopping"}
                    )
                value["boot_type"] = _provider_enum(
                    server.get("boot_type"), {"local", "bootscript", "rescue"}
                )
            for field, allowed in (
                ("ip_attachment", {"unobserved", "unattached", "matched", "invalid"}),
                ("fingerprint_status", {"unobserved", "missing", "present", "invalid"}),
            ):
                candidate = observations.get(field)
                if isinstance(candidate, str) and candidate in allowed:
                    value[field] = candidate
            scan = observations.get("scan")
            attempts = self.state["attempts"].get("host-keyscan", 0)
            if attempts > value["scan"]["attempts"]:
                value["scan"].update(category=None, exit_code=None)
            value["scan"]["attempts"] = attempts
            if isinstance(scan, dict):
                category, status = scan.get("category"), scan.get("exit_code")
                value["scan"].update(
                    category=category
                    if isinstance(category, str) and category in TRANSPORT_CATEGORIES
                    else None,
                    exit_code=status if type(status) is int and -255 <= status <= 255 else None,
                )
            error = observations.get("provider_failure")
            if (
                isinstance(error, str)
                and error in cycle.SAFE_FAILURE_CODES
                and operation in {"server", "ip", "fingerprint"}
            ):
                value["provider_failure"] = {
                    "operation": operation,
                    "code": error,
                    "observed_at": now,
                }
            try:
                encoded = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
                cycle.require(
                    len(encoded) <= self.limits["progress_record_bytes"], "progress_record_bound"
                )
                cycle.write(
                    self.directory / "host-key-diagnostics.json", value, discard_incomplete=True
                )
            except (OSError, ValueError):
                self.state["diagnostic_write_failures"] = min(
                    999999, self.state["diagnostic_write_failures"] + 1
                )

    def failure(self, error: BaseException):
        with self.lock:
            if self.state["primary_failure"] is None:
                self.state["primary_failure"] = cycle.failure_code(error)
            self._emit("failure")

    def __exit__(self, kind, error, traceback):
        self.stop.set()
        if self.thread is not None:
            self.thread.join()
        if error is not None:
            self.failure(error)
        with self.lock:
            self.state["phase"] = "complete"
            self.state["status"] = "failed" if self.state["primary_failure"] else "succeeded"
            self.state["controller_alive"] = False
            self._emit("final")
            summary = os.environ.get("GITHUB_STEP_SUMMARY")
            if summary:
                try:
                    with open(summary, "a", encoding="utf-8") as stream:
                        stream.write(
                            "\n### ARM qualification\n\n"
                            f"- Profile: `{self.state['profile']}`; fault: `{self.state['fault']}`.\n"
                            f"- Controller result: `{self.state['status']}`; failure: `{self.state['primary_failure'] or 'none'}`.\n"
                            f"- Last verified observation: `{self.state['last_observation']}`; guest state: `{self.state['guest_state']}`.\n"
                            "- Heartbeats indicate controller liveness; guest progress requires an actual observation.\n"
                        )
                except OSError:
                    pass


def readiness(data: bytes) -> dict:
    value = cycle.decode(data, cycle.policy()["limits"]["guest_diagnostic_bytes"])
    cycle.require(
        set(value) == {"python", "helper"} and all(type(v) is bool for v in value.values()),
        "ssh_readiness_shape",
    )
    return value


def cloud_diagnostic(value: dict) -> None:
    """Reject arbitrary text or extensions in public cloud-init evidence."""
    valid = (
        isinstance(value, dict)
        and set(value) == {"sources", "errors", "truncated"}
        and isinstance(value["sources"], dict)
        and set(value["sources"]) == {"status", "result"}
        and all(
            isinstance(state, str) and state in bootstrap.CLOUD_SOURCE_STATES
            for state in value["sources"].values()
        )
        and type(value["truncated"]) is bool
        and isinstance(value["errors"], list)
        and len(value["errors"]) <= bootstrap.CLOUD_ERROR_LIMIT
    )
    cycle.require(valid, "guest_diagnostic_shape")
    for error in value["errors"]:
        cycle.require(
            isinstance(error, dict)
            and set(error) == {"stage", "module", "exception", "error", "program", "exit_code"},
            "guest_diagnostic_shape",
        )
        for field, allowed in (
            ("stage", bootstrap.CLOUD_STAGES),
            ("module", bootstrap.CLOUD_MODULES),
            ("exception", bootstrap.CLOUD_EXCEPTIONS),
            ("program", bootstrap.CLOUD_PROGRAMS),
        ):
            cycle.require(
                error[field] is None or isinstance(error[field], str) and error[field] in allowed,
                "guest_diagnostic_shape",
            )
        cycle.require(
            isinstance(error["error"], str) and error["error"] in bootstrap.CLOUD_ERRORS,
            "guest_diagnostic_shape",
        )
        cycle.require(
            error["exit_code"] is None
            or type(error["exit_code"]) is int
            and -255 <= error["exit_code"] <= 255,
            "guest_diagnostic_shape",
        )


def guest_diagnostic(data: bytes) -> dict:
    value = cycle.decode(data, cycle.policy()["limits"]["guest_diagnostic_bytes"])
    cycle.require(
        set(value)
        == {
            "version",
            "ready",
            "failed",
            "code",
            "program",
            "exit_code",
            "cloud_init_error_count",
            "cloud_init",
            "units",
        },
        "guest_diagnostic_shape",
    )
    cycle.require(
        type(value["version"]) is int
        and value["version"] == 1
        and all(type(value[k]) is bool for k in ("ready", "failed")),
        "guest_diagnostic_shape",
    )
    cycle.require(
        value["code"] is None or value["code"] in cycle.SAFE_FAILURE_CODES, "guest_diagnostic_shape"
    )
    cycle.require(
        value["program"] is None
        or value["program"]
        in cycle.SAFE_PROGRAMS
        | {
            "id",
            "lsblk",
            "findmnt",
            "getenforce",
            "mkfs.btrfs",
            "mkfs.ext4",
            "mount",
            "restorecon",
            "loginctl",
        },
        "guest_diagnostic_shape",
    )
    cycle.require(
        value["exit_code"] is None
        or type(value["exit_code"]) is int
        and -255 <= value["exit_code"] <= 255,
        "guest_diagnostic_shape",
    )
    cycle.require(
        type(value["cloud_init_error_count"]) is int
        and 0 <= value["cloud_init_error_count"] <= 65536,
        "guest_diagnostic_shape",
    )
    cycle.require(
        isinstance(value["units"], dict)
        and set(value["units"]) == set(UNITS)
        and all(state in UNIT_STATES for state in value["units"].values()),
        "guest_diagnostic_shape",
    )
    cloud_diagnostic(value["cloud_init"])
    return value


def completion(directory: Path, identity: dict, profile: str, fault: str, outcome: str) -> dict:
    """Describe whether this attempt finalized; never infer current liveness from a heartbeat."""
    observer = Progress(directory, identity, profile, fault)
    cycle.require(outcome in {"success", "failure", "cancelled", "skipped"}, "progress_operation")
    result = {
        "version": 1,
        "identity": observer.state["identity"],
        "profile": profile,
        "fault": fault,
        "workflow_step_outcome": outcome,
        "status": "unavailable",
        "reason": "final-record-unavailable",
        "controller_result": None,
    }
    try:
        snapshot = cycle.read(
            directory / "controller-progress.json", observer.limits["progress_record_bytes"]
        )
        cycle.require(
            snapshot.get("version") == 1
            and snapshot.get("identity") == result["identity"]
            and snapshot.get("profile") == profile
            and snapshot.get("fault") == fault
            and snapshot.get("event") == "final"
            and snapshot.get("controller_alive") is False
            and snapshot.get("status") in {"succeeded", "failed"},
            "progress_operation",
        )
        result.update(status="observed", reason=None, controller_result=snapshot["status"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        directory.mkdir(parents=True, exist_ok=True)
        cycle.write(directory / "controller-completion.json", result, discard_incomplete=True)
    except (OSError, ValueError):
        pass
    try:
        print("OHTIA_ARM_COMPLETION=" + json.dumps(result, sort_keys=True), flush=True)
    except (OSError, ValueError):
        pass
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as stream:
                stream.write(
                    "\n### ARM controller completion\n\n"
                    f"- Final controller record: `{result['status']}`.\n"
                    f"- Controller result: `{result['controller_result'] or 'unknown'}`; step outcome: `{outcome}`.\n"
                    "- An earlier heartbeat is historical; absence of completion metadata leaves completion unknown.\n"
                )
        except OSError:
            pass
    return result


if __name__ == "__main__":
    import sys

    cycle.require(len(sys.argv) == 3 and sys.argv[1] == "summarize", "progress_operation")
    completion(
        Path(sys.argv[2]).absolute(),
        cycle.source_context("creator"),
        os.environ.get("QUALIFICATION_PROFILE", ""),
        os.environ.get("QUALIFICATION_FAULT", ""),
        os.environ.get("ARM_CONTROLLER_OUTCOME", ""),
    )
