"""Bounded lease, provider and process contracts for disposable ARM qualification."""

from __future__ import annotations

import datetime as dt
import hashlib
import http.client
import ipaddress
import json
import os
import platform
import re
import selectors
import stat
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "config/installation/scaleway.json"
GUARD = Path("/run/ohtia-qualification.json")
KINDS = ("root", "home", "ip", "server", "security")
REPOSITORY = "ohtia/ohtia"
API_HOST = "api.scaleway.com"


class CycleError(ValueError):
    """A controlled boundary failed; codes never contain remote response bodies."""


SAFE_FAILURE_CODES = frozenset(
    [
        "absence_deadline",
        "aliased_file",
        "allocation_configuration",
        "allocation_shape",
        "api_credential",
        "api_method",
        "api_path",
        "api_role",
        "apparmor_not_enforcing",
        "artifact_changed",
        "artifact_digest_mismatch",
        "artifact_digest_missing",
        "artifact_file_bound",
        "artifact_members",
        "artifact_regular_file",
        "artifact_unavailable",
        "backup_absence",
        "backup_active_producer",
        "backup_approval_input",
        "backup_archive_bound",
        "backup_archive_file",
        "backup_archive_members",
        "backup_archive_required",
        "backup_checkpoint",
        "backup_digest",
        "backup_expanded_bound",
        "backup_incomplete_history",
        "backup_input_bound",
        "backup_lease_bound",
        "backup_lease_fields",
        "backup_native_flags",
        "backup_project",
        "backup_requires_manual_dispatch",
        "backup_requires_suspension",
        "backup_resource_still_present",
        "backup_resources",
        "backup_run",
        "backup_source",
        "bootstrap_command_failed",
        "bootstrap_failed",
        "bootstrap_io_failed",
        "bootstrap_status_shape",
        "build_artifact_fields",
        "build_artifact_size",
        "build_cell",
        "build_changed_source",
        "build_fields",
        "build_filename",
        "build_identity",
        "build_policy",
        "build_profile",
        "build_scope",
        "build_version",
        "carried_source",
        "checkout_revision",
        "cleanup_allocation_forbidden",
        "cleanup_deadline",
        "cleanup_incomplete",
        "cleanup_wait_forbidden",
        "cli_archive_bound",
        "cli_archive_entry",
        "cli_argument",
        "cli_binary_missing",
        "cli_binary_size",
        "cli_destination",
        "cli_digest",
        "cli_download_bound",
        "cli_missing",
        "cli_origin",
        "cli_redirect",
        "cli_version",
        "cloud_init_failed",
        "conflicting_resource_receipt",
        "controller_build_identity",
        "controller_intent_identity",
        "controller_job_count",
        "creator_review_gate",
        "creator_reviewer",
        "credentialed_builder",
        "cycle_not_enabled",
        "duplicate_json_key",
        "duplicate_resource",
        "environment_branch",
        "environment_branches",
        "environment_guard",
        "evidence_budget",
        "fault_mode",
        "fedora_recovery_required",
        "foreign_project",
        "fresh_build_output",
        "fresh_cycle_output",
        "fresh_guest_output",
        "fresh_intent_output",
        "fresh_intent_required",
        "fresh_recovery_required",
        "github_deadline",
        "github_endpoint",
        "github_history_changed",
        "github_history_incomplete",
        "github_list",
        "github_page_limit",
        "github_read_failed",
        "github_response_bound",
        "github_run_search_limit",
        "guest_account",
        "guest_address_identity",
        "guest_architecture",
        "guest_bootstrap_deadline",
        "guest_bootstrap_failed",
        "guest_bootstrap_operation",
        "guest_capabilities",
        "guest_cell",
        "guest_collection_bound",
        "guest_collection_file",
        "guest_collection_identity",
        "guest_collection_profile",
        "guest_collection_record",
        "guest_credentials",
        "guest_display_cleanup",
        "guest_expiry_not_armed",
        "guest_guard_bound",
        "guest_guard_identity",
        "guest_guard_owner",
        "guest_harness_entry",
        "guest_home",
        "guest_home_identity",
        "guest_installer_root_required",
        "guest_lease_expired",
        "guest_not_ready",
        "guest_operation_failed",
        "guest_output_path",
        "guest_output_required",
        "guest_policy",
        "guest_process_architecture",
        "guest_profile",
        "guest_required_command",
        "guest_result_binding",
        "guest_sudo_permission",
        "guest_suite_digest",
        "guest_test_deadline",
        "guest_transfer_digest",
        "guest_transfer_identity",
        "guest_user_bus",
        "guest_volume_serial",
        "guest_wayland_socket",
        "harness_absolute_link",
        "harness_compressed_bound",
        "harness_expanded_bound",
        "harness_link_escape",
        "harness_special_file",
        "host_fingerprint_bound",
        "host_fingerprint_unavailable",
        "host_key_deadline",
        "host_key_mismatch",
        "host_scan_identity",
        "identity_fields",
        "image_identity",
        "image_profile",
        "image_root_size",
        "installed_package_changed",
        "instance_budget",
        "instance_catalog",
        "instance_configuration",
        "instance_shape",
        "instance_unavailable",
        "intent_artifact_count",
        "intent_build_policy",
        "intent_expiry",
        "intent_fields",
        "intent_identity",
        "intent_policy",
        "intent_profile",
        "intent_project",
        "intent_resource_policy",
        "intent_run",
        "intent_run_binding",
        "intent_scope",
        "invalid_artifact_archive",
        "invalid_backup_archive",
        "invalid_backup_payload",
        "invalid_digest",
        "invalid_integer",
        "invalid_json",
        "invalid_observation_archive",
        "invalid_timestamp",
        "invalid_uuid",
        "ip_disappeared",
        "ip_still_attached",
        "journal_artifact_count",
        "journal_identity",
        "journal_resolution",
        "json_number",
        "json_object",
        "json_too_large",
        "key_expiry_margin",
        "lease_budget",
        "lease_duration",
        "lease_resource_fields",
        "lease_resource_identity",
        "lease_storage_capacity",
        "lease_storage_fields",
        "lease_storage_shape",
        "ledger_bound",
        "ledger_capacity",
        "ledger_nonce",
        "ledger_unresolved",
        "limits_policy",
        "local_io_failed",
        "missing_allocation_intent",
        "missing_github_token",
        "native_guest_root_required",
        "native_smoke_failed",
        "nonpublic_address",
        "observation_artifact",
        "observation_completion",
        "observation_compressed_bound",
        "observation_digest",
        "observation_expanded_bound",
        "observation_sandbox",
        "observation_shape",
        "observation_summary",
        "observation_transfer_bound",
        "observer_write_forbidden",
        "ordinary_extractor_required",
        "package_count",
        "package_install_missing",
        "package_seal_requires_root",
        "policy_version",
        "prepare_arguments",
        "private_backup_destination",
        "privileged_guest_account",
        "process_failed",
        "process_output_bound",
        "process_timeout",
        "profile_configuration",
        "project_not_empty",
        "provider_deadline",
        "provider_encoding",
        "provider_incomplete",
        "provider_operation_deadline",
        "provider_refused",
        "provider_size",
        "provider_step_count",
        "provider_transport",
        "public_key",
        "published_intent_required",
        "published_recovery_plan_required",
        "recovery_artifact_missing",
        "recovery_configuration",
        "recovery_pending_bound",
        "recovery_plan_bound",
        "recovery_plan_coverage",
        "recovery_plan_coverage_bound",
        "recovery_plan_coverage_conflict",
        "recovery_plan_coverage_cycle",
        "recovery_plan_flags",
        "recovery_plan_identity",
        "recovery_plan_name",
        "recovery_plan_nonce",
        "recovery_plan_required",
        "recovery_plan_resources",
        "recovery_plan_source",
        "recovery_source",
        "recovery_status",
        "recovery_trigger",
        "request_size",
        "resource_identity",
        "resource_kind",
        "resource_list",
        "resource_name",
        "resource_ownership",
        "resource_page_limit",
        "root_volume_refused",
        "run_arguments",
        "run_attempt_bound",
        "run_event",
        "run_id",
        "run_identity",
        "run_not_main_ancestor",
        "run_repository",
        "run_workflow",
        "runner_architecture",
        "security_still_attached",
        "selinux_not_enforcing",
        "server_disappeared",
        "server_shape",
        "shutdown_budget",
        "storage_configuration",
        "storage_policy",
        "timestamp_not_utc",
        "unallocated_bound",
        "unallocated_conflict",
        "unallocated_duplicate",
        "unallocated_fields",
        "unallocated_run",
        "unapproved_cloud_shape",
        "uncertain_allocation_quarantined",
        "uncertain_provider_write",
        "unexpected_attachment",
        "unexpected_network_attachment",
        "unexpected_unattempted_resources",
        "unknown_profile",
        "unknown_role",
        "unresolved_prior_intent",
        "unsafe_file",
        "unsafe_home_volume",
        "unsafe_output",
        "untracked_project_resource",
        "untrusted_context",
        "untrusted_event",
        "volume_deadline",
        "volume_disappeared",
        "volume_iops",
        "volume_size",
        "volume_unavailable",
        "workflow_inactive",
        "workflow_path",
        "workflow_revision",
        "zone_configuration",
    ]
)


def failure_code(error: BaseException) -> str:
    if (
        isinstance(error, CycleError)
        and error.args
        and isinstance(error.args[0], str)
        and error.args[0] in SAFE_FAILURE_CODES
    ):
        return error.args[0]
    if isinstance(error, subprocess.TimeoutExpired):
        return "process_timeout"
    if isinstance(error, subprocess.CalledProcessError):
        return "process_failed"
    if isinstance(error, OSError):
        return "local_io_failed"
    if isinstance(error, KeyboardInterrupt):
        return "controller_cancelled"
    return "qualification_failed"


SAFE_PROGRAMS = frozenset(
    {
        "ssh",
        "scp",
        "ssh-keygen",
        "ssh-keyscan",
        "gnome-shell",
        "gdbus",
        "dbus-update-activation-environment",
        "systemd-run",
        "systemctl",
        "sudo",
        "rpm",
        "dpkg",
        "runuser",
        "python3",
        "node",
        "git",
    }
)


def failure_record(error: BaseException, phase: str) -> dict:
    result = {
        "version": 1,
        "phase": phase,
        "code": failure_code(error),
        "program": None,
        "exit_code": None,
        "errno": error.errno if isinstance(error, OSError) and type(error.errno) is int else None,
        "distribution_qualified": False,
    }
    if isinstance(error, (subprocess.CalledProcessError, subprocess.TimeoutExpired)):
        arguments = error.cmd
        if isinstance(arguments, (list, tuple)) and arguments:
            program = Path(str(arguments[0])).name
            result["program"] = program if program in SAFE_PROGRAMS else None
        if isinstance(error, subprocess.CalledProcessError):
            result["exit_code"] = error.returncode
    return result


def require(condition: bool, code: str) -> None:
    if not condition:
        raise CycleError(code)


def frozen_resources(value: dict) -> dict:
    return {
        "name_prefix": value["name_prefix"],
        "architecture": value["architecture"],
        "storage": value["storage"],
        "lease_seconds": value["limits"]["lease_seconds"],
    }


def validate_resources(value: dict) -> None:
    require(
        set(value) == {"name_prefix", "architecture", "storage", "lease_seconds"},
        "lease_resource_fields",
    )
    require(
        isinstance(value["name_prefix"], str)
        and re.fullmatch(r"[a-z][a-z0-9-]{0,39}", value["name_prefix"]) is not None
        and value["architecture"] == "arm64",
        "lease_resource_identity",
    )
    storage = value["storage"]
    require(
        set(storage) == {"unit", "root_bytes", "home_bytes", "total_bytes", "perf_iops"}
        and storage["unit"] == "decimal-GB",
        "lease_storage_fields",
    )
    require(
        all(
            type(storage[k]) is int and 0 < integer(storage[k]) and storage[k] % 512 == 0
            for k in ("root_bytes", "home_bytes", "total_bytes")
        ),
        "lease_storage_capacity",
    )
    require(
        storage["root_bytes"] + storage["home_bytes"] == storage["total_bytes"]
        and type(storage["perf_iops"]) is int
        and storage["perf_iops"] in {5000, 15000},
        "lease_storage_shape",
    )
    require(
        type(value["lease_seconds"]) is int and 0 < value["lease_seconds"] <= 86400,
        "lease_duration",
    )


def policy() -> dict:
    value = read(POLICY_PATH)
    require(value["version"] == 1 and value["repository"] == REPOSITORY, "policy_version")
    validate_resources(frozen_resources(value))
    storage, limits = value["storage"], value["limits"]
    require(
        storage["unit"] == "decimal-GB"
        and storage["root_bytes"] + storage["home_bytes"] == storage["total_bytes"],
        "storage_policy",
    )
    require(all(type(n) is int and n > 0 for n in limits.values()), "limits_policy")
    require(
        limits["test_seconds"] + limits["cleanup_seconds"] < limits["lease_seconds"], "lease_budget"
    )
    require(
        limits["test_seconds"] < limits["guest_shutdown_seconds"] < limits["lease_seconds"],
        "shutdown_budget",
    )
    require(limits["managed_instances"] == 1, "instance_budget")
    require(limits["evidence_seconds"] < limits["cleanup_seconds"], "evidence_budget")
    return value


def unique(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def decode(data: bytes, maximum: int = 2 * 1024 * 1024) -> dict:
    require(len(data) <= maximum, "json_too_large")
    try:
        value = json.loads(
            data, object_pairs_hook=unique, parse_constant=lambda _: require(False, "json_number")
        )
    except (ValueError, RecursionError):
        raise CycleError("invalid_json") from None
    require(isinstance(value, dict), "json_object")
    return value


def read(path: Path, maximum: int = 2 * 1024 * 1024) -> dict:
    info = path.lstat()
    require(
        stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum, "unsafe_file"
    )
    require(path.resolve() == path.absolute(), "aliased_file")
    return decode(path.read_bytes(), maximum)


def write(path: Path, value: dict) -> None:
    require(
        path.parent.resolve() == path.parent.absolute() and not path.is_symlink(), "unsafe_output"
    )
    temporary = path.with_name(path.name + ".partial")
    data = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    with temporary.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def identifier(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise CycleError("invalid_uuid") from None
    require(str(parsed) == value and parsed.int != 0, "invalid_uuid")
    return value


def sha(value: str, length: int = 64) -> str:
    require(
        isinstance(value, str)
        and re.fullmatch(r"[a-f0-9]{" + str(length) + "}", value) is not None,
        "invalid_digest",
    )
    return value


def integer(value, maximum: int = 2**63 - 1) -> int:
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,20}", value):
        value = int(value)
    require(type(value) is int and 0 <= value <= maximum, "invalid_integer")
    return value


def timestamp(value: str) -> dt.datetime:
    try:
        result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        raise CycleError("invalid_timestamp") from None
    require(result.utcoffset() == dt.timedelta(0), "timestamp_not_utc")
    return result


def utc() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


def process_environment(*, github: bool = False) -> dict:
    result = {
        key: os.environ[key]
        for key in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")
        if key in os.environ
    }
    result.update(
        {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "LC_ALL": "C.UTF-8"}
    )
    if github:
        require(bool(os.environ.get("GITHUB_TOKEN")), "missing_github_token")
        result.update(
            {
                "GH_TOKEN": os.environ["GITHUB_TOKEN"],
                "GH_HOST": "github.com",
                "GH_PROMPT_DISABLED": "1",
            }
        )
    return result


def command(args: list, *, timeout: int = 30) -> subprocess.CompletedProcess:
    """Capture only bounded child output; no provider or GitHub credentials enter subprocesses."""
    arguments = [str(arg) for arg in args]
    maximum = policy()["limits"]["maximum_json_bytes"]
    data = bytearray()
    with subprocess.Popen(
        arguments,
        cwd=ROOT,
        env=process_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as child:
        try:
            deadline = time.monotonic() + timeout
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise subprocess.TimeoutExpired(arguments, timeout)
                    block = os.read(child.stdout.fileno(), min(65536, maximum + 1 - len(data)))
                    if not block:
                        break
                    data.extend(block)
                    require(len(data) <= maximum, "process_output_bound")
            status = child.wait(timeout=max(0.001, deadline - time.monotonic()))
            if status:
                raise subprocess.CalledProcessError(status, arguments)
            return subprocess.CompletedProcess(arguments, status, bytes(data))
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)


def source_context(role: str) -> dict:
    p = policy()
    require(role in {"build", "creator", "cleanup"}, "unknown_role")
    filename = p["cleanup_workflow"] if role == "cleanup" else p["qualification_workflow"]
    expected = {
        "GITHUB_ACTIONS": "true",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "Linux",
        "GITHUB_REPOSITORY": REPOSITORY,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": f"{REPOSITORY}/{filename}@refs/heads/main",
    }
    require(all(os.environ.get(k) == v for k, v in expected.items()), "untrusted_context")
    require(
        platform.system() == "Linux"
        and platform.machine() == ("aarch64" if role == "build" else "x86_64")
        and os.environ.get("RUNNER_ARCH") == ("ARM64" if role == "build" else "X64"),
        "runner_architecture",
    )
    event = os.environ.get("GITHUB_EVENT_NAME")
    require(
        event
        in (
            {"workflow_dispatch", "schedule", "workflow_run"}
            if role == "cleanup"
            else {"workflow_dispatch"}
        ),
        "untrusted_event",
    )
    revision = sha(os.environ.get("GITHUB_SHA", ""), 40)
    # workflow_run uses the current default-branch workflow, never the producer's checkout.
    require(os.environ.get("GITHUB_WORKFLOW_SHA") == revision, "workflow_revision")
    require(
        command(["git", "rev-parse", "HEAD"]).stdout.decode().strip() == revision,
        "checkout_revision",
    )
    run_id, attempt = (os.environ.get(k, "") for k in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    require(all(re.fullmatch(r"[1-9][0-9]{0,19}", v) for v in (run_id, attempt)), "run_identity")
    return {
        "repository": REPOSITORY,
        "source_sha": revision,
        "workflow": filename,
        "run_id": run_id,
        "attempt": attempt,
        "event": event,
    }


def configuration(profile: str | None = None) -> dict:
    p = policy()
    project = identifier(os.environ.get("SCW_PROJECT_ID", ""))
    zone = os.environ.get("SCW_ARM_ZONE", "")
    require(re.fullmatch(r"(?:fr-par|nl-ams|pl-waw)-[123]", zone) is not None, "zone_configuration")
    result = {
        "project": project,
        "project_binding": hashlib.sha256(project.encode()).hexdigest(),
        "zone": zone,
    }
    if profile is not None:
        require(profile in p["profiles"], "profile_configuration")
        selected = p["profiles"][profile]
        sku = os.environ.get("SCW_ARM_INSTANCE_TYPE", "")
        require(re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,63}", sku) is not None, "instance_configuration")
        # A new decimal-GB setting replaces, rather than reinterprets, the legacy GiB setting.
        require(
            os.environ.get("SCW_ARM_DISK_GB") == str(p["storage"]["total_bytes"] // 10**9),
            "storage_configuration",
        )
        require(
            zone in p["approved_zones"] and sku in p["approved_instance_types"],
            "unapproved_cloud_shape",
        )
        result.update(
            {
                "profile": profile,
                "instance_type": sku,
                "image_id": identifier(os.environ.get(selected["image_variable"], "")),
            }
        )
    return result


def cell(profile: str) -> dict:
    selected = policy()["profiles"].get(profile)
    require(selected is not None, "unknown_profile")
    return {
        "id": f"{profile}-arm64-scaleway",
        "target": "linux-arm64",
        "profile": profile,
        "backend": "wayland",
        "filesystem": selected["filesystem"],
        "formats": [selected["format"]],
    }


def validate_build(value: dict, *, historical: bool = False) -> None:
    require(
        set(value)
        == {
            "version",
            "identity",
            "profile",
            "cell",
            "application_version",
            "source_tree",
            "policy_sha256",
            "package",
            "harness",
            "distribution_qualified",
            "publisher_signed",
        },
        "build_fields",
    )
    require(
        value["version"] == 1
        and value["distribution_qualified"] is False
        and value["publisher_signed"] is False,
        "build_scope",
    )
    require(
        isinstance(value["profile"], str)
        and re.fullmatch(r"[a-z][a-z0-9.-]{0,63}", value["profile"]) is not None,
        "build_profile",
    )
    if historical:
        selected = value["cell"]
        require(
            set(selected) == {"id", "target", "profile", "backend", "filesystem", "formats"}
            and selected["id"] == f"{value['profile']}-arm64-scaleway"
            and selected["profile"] == value["profile"]
            and selected["target"] == "linux-arm64"
            and selected["backend"] == "wayland"
            and selected["filesystem"] in {"btrfs", "ext4"}
            and selected["formats"] in (["rpm"], ["deb"]),
            "build_cell",
        )
    else:
        require(value["cell"] == cell(value["profile"]), "build_cell")
    identity = value["identity"]
    require(
        value["application_version"] == f"0.0.0-dev.{identity['run_id']}.{identity['attempt']}",
        "build_version",
    )
    sha(value["source_tree"], 40)
    sha(value["policy_sha256"])
    require(historical or value["policy_sha256"] == digest(POLICY_PATH), "build_policy")
    limits = policy()["limits"]
    for key, extension, maximum in (
        (
            "package",
            value["cell"]["formats"][0],
            limits["maximum_package_bytes"],
        ),
        ("harness", "tar.gz", limits["maximum_harness_bytes"]),
    ):
        record = value[key]
        require(set(record) == {"file", "bytes", "sha256"}, "build_artifact_fields")
        require(
            isinstance(record["file"], str)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+-]{0,199}", record["file"]) is not None
            and record["file"].endswith("." + extension),
            "build_filename",
        )
        require(
            0 < integer(record["bytes"]) and (historical or record["bytes"] <= maximum),
            "build_artifact_size",
        )
        sha(record["sha256"])


def verify_artifact(directory: Path, record: dict) -> Path:
    file = directory / record["file"]
    info = file.lstat()
    require(
        stat.S_ISREG(info.st_mode)
        and info.st_nlink == 1
        and not file.is_symlink()
        and file.resolve() == file.absolute(),
        "artifact_regular_file",
    )
    require(
        info.st_size == record["bytes"] and digest(file) == record["sha256"], "artifact_changed"
    )
    return file


def create_intent(identity: dict, settings: dict, build: dict, now: str) -> dict:
    p = policy()
    start = timestamp(now)
    nonce = str(uuid.uuid4())
    value = {
        "version": 2,
        "identity": identity,
        "resource_plan": frozen_resources(p),
        "profile": settings["profile"],
        "project_binding": settings["project_binding"],
        "zone": settings["zone"],
        "instance_type": settings["instance_type"],
        "image_id": settings["image_id"],
        "created_at": now,
        "expires_at": (start + dt.timedelta(seconds=p["limits"]["lease_seconds"]))
        .isoformat()
        .replace("+00:00", "Z"),
        "nonce": nonce,
        "policy_sha256": digest(POLICY_PATH),
        "build": build,
        "resources_created": False,
        "distribution_qualified": False,
    }
    validate_intent(value, settings)
    return value


def validate_intent(value: dict, settings: dict, *, historical: bool = False) -> None:
    require(
        set(value)
        == {
            "version",
            "identity",
            "resource_plan",
            "profile",
            "project_binding",
            "zone",
            "instance_type",
            "image_id",
            "created_at",
            "expires_at",
            "nonce",
            "policy_sha256",
            "build",
            "resources_created",
            "distribution_qualified",
        },
        "intent_fields",
    )
    require(
        value["version"] == 2
        and value["resources_created"] is False
        and value["distribution_qualified"] is False,
        "intent_scope",
    )
    p = policy()
    validate_resources(value["resource_plan"])
    require(historical or value["resource_plan"] == frozen_resources(p), "intent_resource_policy")
    sha(value["policy_sha256"])
    require(historical or value["policy_sha256"] == digest(POLICY_PATH), "intent_policy")
    require(
        value["project_binding"] == settings["project_binding"]
        and value["zone"] == settings["zone"],
        "intent_project",
    )
    identifier(value["nonce"])
    identifier(value["image_id"])
    require(historical or value["profile"] in p["profiles"], "intent_profile")
    require(
        timestamp(value["expires_at"]) > timestamp(value["created_at"])
        and timestamp(value["expires_at"]) - timestamp(value["created_at"])
        == dt.timedelta(seconds=value["resource_plan"]["lease_seconds"]),
        "intent_expiry",
    )
    identity = value["identity"]
    require(
        set(identity) == {"repository", "source_sha", "workflow", "run_id", "attempt", "event"},
        "identity_fields",
    )
    require(
        identity["repository"] == REPOSITORY
        and identity["workflow"] == p["qualification_workflow"]
        and identity["event"] == "workflow_dispatch",
        "intent_identity",
    )
    sha(identity["source_sha"], 40)
    require(
        all(re.fullmatch(r"[1-9][0-9]{0,19}", identity[k]) for k in ("run_id", "attempt")),
        "intent_run",
    )
    validate_build(value["build"], historical=historical)
    require(value["build"]["policy_sha256"] == value["policy_sha256"], "intent_build_policy")
    require(
        value["build"]["identity"] == identity and value["build"]["profile"] == value["profile"],
        "build_identity",
    )


def recovery_plan_name(nonce: str, attempt: str) -> str:
    require(nonce == "empty" or identifier(nonce) == nonce, "recovery_plan_nonce")
    require(
        isinstance(attempt, str)
        and attempt.isdigit()
        and 0 < int(attempt) <= policy()["limits"]["maximum_run_attempts"],
        "run_attempt_bound",
    )
    return f"scw-recovery-plan-{nonce}-{attempt}"


def name(intent: dict, kind: str) -> str:
    require(kind in KINDS, "resource_kind")
    return f"{intent['resource_plan']['name_prefix']}-{uuid.UUID(intent['nonce']).hex}-{kind}"


def tags(intent: dict, kind: str) -> list[str]:
    return [
        f"ohtia-lease:{intent['nonce']}",
        f"ohtia-run:{intent['identity']['run_id']}",
        f"ohtia-attempt:{intent['identity']['attempt']}",
        f"ohtia-kind:{kind}",
    ]


class API:
    """Fixed-origin transport; cleanup never exposes an allocation or update route."""

    def __init__(self, token: str, settings: dict, role: str):
        require(role in {"creator", "cleanup", "observer"}, "api_role")
        require(re.fullmatch(r"[A-Za-z0-9-]{16,256}", token or "") is not None, "api_credential")
        self.token, self.settings, self.role = token, settings, role
        self.deadline = None

    def request(
        self, method: str, path: str, value=None, *, raw: bool = False, missing: bool = False
    ):
        zone = self.settings["zone"]
        roots = (f"/instance/v1/zones/{zone}/", f"/block/v1/zones/{zone}/")
        require(
            (
                path.startswith(roots)
                or (method == "GET" and path.startswith("/marketplace/v2/local-images/"))
            )
            and ".." not in path
            and re.fullmatch(r"/[A-Za-z0-9_/?=&.%-]+", path) is not None,
            "api_path",
        )
        require(method in {"GET", "POST", "PATCH", "DELETE"}, "api_method")
        if self.role == "observer":
            require(method == "GET", "observer_write_forbidden")
        if self.role in {"cleanup", "observer"}:
            item = r"[a-f0-9-]{36}"
            instance = rf"/instance/v1/zones/{zone}/(?:servers|ips|security_groups)"
            block = rf"/block/v1/zones/{zone}/volumes"
            allowed = (
                (
                    method == "GET"
                    and re.fullmatch(
                        rf"(?:{instance}|{block})(?:/{item})?(?:\?[A-Za-z0-9_=&%-]+)?", path
                    )
                    is not None
                )
                or (
                    method == "DELETE"
                    and re.fullmatch(rf"(?:{instance}|{block})/{item}", path) is not None
                )
                or (
                    method == "POST"
                    and re.fullmatch(rf"/instance/v1/zones/{zone}/servers/{item}/action", path)
                    is not None
                    and value == {"action": "poweroff"}
                )
            )
            require(allowed, "cleanup_allocation_forbidden")
        p = policy()
        limit, seconds = p["limits"]["maximum_json_bytes"], p["limits"]["request_seconds"]
        if self.deadline is not None:
            require(time.monotonic() < self.deadline, "provider_operation_deadline")
            seconds = min(seconds, self.deadline - time.monotonic())
        body = (
            value
            if isinstance(value, bytes)
            else json.dumps(value).encode()
            if value is not None
            else None
        )
        require(body is None or len(body) <= limit, "request_size")
        headers = {
            "X-Auth-Token": self.token,
            "Accept-Encoding": "identity",
            "User-Agent": "ohtia-qualification/1",
        }
        if body is not None:
            headers["Content-Type"] = (
                "text/plain" if isinstance(value, bytes) else "application/json"
            )
        connection = http.client.HTTPSConnection(API_HOST, timeout=seconds)
        deadline = time.monotonic() + seconds
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            if (
                response.status == 404
                and missing
                and (
                    method in {"GET", "DELETE"}
                    or (method == "POST" and value == {"action": "poweroff"})
                )
            ):
                return None
            require(
                response.status in ({200} if method == "GET" else {200, 201, 202, 204}),
                "provider_refused",
            )
            require(
                response.getheader("Content-Encoding", "identity") == "identity",
                "provider_encoding",
            )
            chunks = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                require(remaining > 0, "provider_deadline")
                if connection.sock is not None:
                    connection.sock.settimeout(remaining)
                block = response.read1(min(65536, limit + 1 - len(chunks)))
                if not block:
                    break
                chunks.extend(block)
                require(len(chunks) <= limit, "provider_size")
            require(response.length in (None, 0), "provider_incomplete")
            if raw:
                return bytes(chunks)
            return decode(bytes(chunks), limit) if chunks else {}
        except (OSError, http.client.HTTPException, CycleError) as error:
            if method in {"POST", "PATCH"}:
                raise CycleError("uncertain_provider_write") from None
            if isinstance(error, CycleError):
                raise
            raise CycleError("provider_transport") from None
        finally:
            connection.close()

    def path(self, kind: str, resource: str | None = None) -> str:
        paths = {
            "server": ("instance", "servers"),
            "root": ("block", "volumes"),
            "home": ("block", "volumes"),
            "ip": ("instance", "ips"),
            "security": ("instance", "security_groups"),
        }
        require(kind in paths, "resource_kind")
        api, collection = paths[kind]
        path = f"/{api}/v1/zones/{self.settings['zone']}/{collection}"
        return path + "/" + identifier(resource) if resource is not None else path

    def objects(self, kind: str) -> list[dict]:
        key = {
            "server": "servers",
            "root": "volumes",
            "home": "volumes",
            "ip": "ips",
            "security": "security_groups",
        }[kind]
        project_field = "project_id" if kind in {"root", "home"} else "project"
        p = policy()["limits"]
        result = []
        for page in range(1, p["maximum_pages"] + 1):
            query = {
                project_field: self.settings["project"],
                "page": page,
                "page_size" if kind in {"root", "home"} else "per_page": p["page_size"],
            }
            if kind in {"root", "home"}:
                query["include_deleted"] = "false"
            data = self.request("GET", self.path(kind) + "?" + urlencode(query))
            rows = data.get(key)
            require(isinstance(rows, list) and len(rows) <= p["page_size"], "resource_list")
            require(
                all(
                    isinstance(row, dict) and row.get(project_field) == self.settings["project"]
                    for row in rows
                ),
                "foreign_project",
            )
            result.extend(rows)
            if len(rows) < p["page_size"]:
                return result
        raise CycleError("resource_page_limit")

    def get(self, kind: str, resource: str):
        value = self.request("GET", self.path(kind, resource), missing=True)
        if value is None:
            return None
        key = {"server": "server", "ip": "ip", "security": "security_group"}.get(kind)
        result = value.get(key) if key else value
        require(isinstance(result, dict) and result.get("id") == resource, "resource_identity")
        field = "project_id" if kind in {"root", "home"} else "project"
        require(result.get(field) == self.settings["project"], "foreign_project")
        return result

    def owned(self, kind: str, obj: dict, intent: dict) -> None:
        identifier(obj["id"])
        field = "project_id" if kind in {"root", "home"} else "project"
        require(
            obj.get(field) == self.settings["project"]
            and set(tags(intent, kind)) <= set(obj.get("tags", [])),
            "resource_ownership",
        )
        if kind != "ip":
            require(obj.get("name") == name(intent, kind), "resource_name")
        if kind in {"root", "home"}:
            storage = intent["resource_plan"]["storage"]
            require(
                integer(obj.get("size"))
                == storage["root_bytes" if kind == "root" else "home_bytes"],
                "volume_size",
            )
            require(obj.get("specs", {}).get("perf_iops") == storage["perf_iops"], "volume_iops")
        if kind == "server":
            require(
                obj.get("commercial_type") == intent["instance_type"]
                and obj.get("arch") == intent["resource_plan"]["architecture"],
                "server_shape",
            )

    def discover(self, intent: dict) -> dict:
        result = {}
        for kind in KINDS:
            rows = [
                row
                for row in self.objects(kind)
                if f"ohtia-lease:{intent['nonce']}" in row.get("tags", [])
                and f"ohtia-kind:{kind}" in row.get("tags", [])
            ]
            require(len(rows) <= 1, "duplicate_resource")
            if rows:
                self.owned(kind, rows[0], intent)
                result[kind] = rows[0]["id"]
        return result

    def empty_slot(self) -> None:
        require(
            not any(self.objects(kind) for kind in ("server", "root", "ip")), "project_not_empty"
        )

    def admit_profile(self, intent: dict) -> None:
        selected = None
        for page in range(1, policy()["limits"]["maximum_pages"] + 1):
            rows = self.request(
                "GET",
                f"/instance/v1/zones/{intent['zone']}/products/servers?per_page=100&page={page}",
            ).get("servers")
            require(isinstance(rows, dict) and len(rows) <= 100, "instance_catalog")
            if intent["instance_type"] in rows:
                selected = rows[intent["instance_type"]]
                break
            require(len(rows) == 100, "instance_unavailable")
        require(
            isinstance(selected, dict)
            and selected.get("arch") == "arm64"
            and selected.get("end_of_service") is False
            and selected.get("capabilities", {}).get("block_storage") is True,
            "instance_shape",
        )
        image = self.request("GET", f"/marketplace/v2/local-images/{intent['image_id']}")
        require(
            image.get("id") == intent["image_id"]
            and image.get("zone") == intent["zone"]
            and image.get("arch") == "arm64"
            and image.get("type") == "instance_sbs"
            and image.get("label") == policy()["profiles"][intent["profile"]]["image_label"]
            and intent["instance_type"] in image.get("compatible_commercial_types", []),
            "image_profile",
        )

    def create(self, intent: dict, public_key: str, cloud_config, journal) -> dict:
        require(self.role == "creator", "cleanup_allocation_forbidden")
        validate_intent(intent, self.settings)
        require(
            all(intent[k] == self.settings[k] for k in ("profile", "instance_type", "image_id")),
            "allocation_configuration",
        )
        self.empty_slot()
        self.admit_profile(intent)
        storage = policy()["storage"]
        image = self.request(
            "GET", f"/instance/v1/zones/{intent['zone']}/images/{intent['image_id']}"
        )["image"]
        require(
            image.get("id") == intent["image_id"] and image.get("arch") == "arm64", "image_identity"
        )
        snapshot = image["root_volume"]
        require(
            snapshot["volume_type"] == "sbs_snapshot"
            and integer(snapshot["size"]) <= storage["root_bytes"],
            "image_root_size",
        )
        require(
            re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9_-]+)?\n?", public_key)
            is not None,
            "public_key",
        )
        resources = {}

        def allocate(kind, body):
            journal({"stage": "write_intent", "kind": kind, "resources": resources})
            data = self.request("POST", self.path(kind), body)
            key = {"server": "server", "ip": "ip", "security": "security_group"}.get(kind)
            obj = data.get(key) if key else data
            # Record the returned ID before validating fields that might fail after allocation.
            if isinstance(obj, dict) and isinstance(obj.get("id"), str):
                resources[kind] = identifier(obj["id"])
                journal({"stage": "allocated", "kind": kind, "resources": resources})
            require(isinstance(obj, dict), "allocation_shape")
            self.owned(kind, obj, intent)
            return obj

        security = allocate(
            "security",
            {
                "name": name(intent, "security"),
                "project": self.settings["project"],
                "project_default": False,
                "stateful": True,
                "inbound_default_policy": "drop",
                "outbound_default_policy": "accept",
                "tags": tags(intent, "security"),
            },
        )
        self.request(
            "POST",
            self.path("security", security["id"]) + "/rules",
            {
                "protocol": "TCP",
                "direction": "inbound",
                "action": "accept",
                "ip_range": "0.0.0.0/0",
                "dest_port_from": 22,
                "dest_port_to": 22,
                "position": 0,
            },
        )
        for kind in ("root", "home"):
            origin = (
                {
                    "from_snapshot": {
                        "snapshot_id": identifier(snapshot["id"]),
                        "size": storage["root_bytes"],
                    }
                }
                if kind == "root"
                else {"from_empty": {"size": storage["home_bytes"]}}
            )
            allocate(
                kind,
                {
                    "name": name(intent, kind),
                    "project_id": self.settings["project"],
                    "perf_iops": storage["perf_iops"],
                    "tags": tags(intent, kind),
                    **origin,
                },
            )
            self.wait_volume(kind, resources[kind], time.monotonic() + 120)
        ip = allocate(
            "ip",
            {
                "project": self.settings["project"],
                "type": "routed_ipv4",
                "tags": tags(intent, "ip"),
            },
        )
        require(
            ipaddress.ip_address(ip["address"]).version == 4
            and ipaddress.ip_address(ip["address"]).is_global,
            "nonpublic_address",
        )
        allocate(
            "server",
            {
                "name": name(intent, "server"),
                "project": self.settings["project"],
                "commercial_type": intent["instance_type"],
                "dynamic_ip_required": False,
                "public_ips": [ip["id"]],
                "volumes": {
                    "0": {"id": resources["root"], "volume_type": "sbs_volume", "boot": True},
                    "1": {"id": resources["home"], "volume_type": "sbs_volume"},
                },
                "security_group": security["id"],
                "tags": tags(intent, "server"),
            },
        )
        require(
            re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9_-]+)?\n?", public_key)
            is not None,
            "public_key",
        )
        self.request(
            "PATCH",
            self.path("server", resources["server"]) + "/user_data/cloud-init",
            cloud_config(resources),
        )
        self.request(
            "POST", self.path("server", resources["server"]) + "/action", {"action": "poweron"}
        )
        return resources

    def wait_volume(self, kind: str, resource: str, deadline: float) -> None:
        while time.monotonic() < deadline:
            value = self.get(kind, resource)
            require(value is not None, "volume_disappeared")
            if value.get("status") == "available" and not value.get("references"):
                return
            require(value.get("status") not in {"error", "deleted"}, "volume_unavailable")
            time.sleep(policy()["limits"]["poll_seconds"])
        raise CycleError("volume_deadline")

    def cleanup(self, intent: dict, deadline: float, *, known: dict | None = None) -> dict:
        validate_intent(intent, self.settings, historical=True)
        resources = self.discover(intent)
        for kind, resource in (known or {}).items():
            require(
                kind in KINDS and (kind not in resources or resources[kind] == resource),
                "conflicting_resource_receipt",
            )
            identifier(resource)
            existing = self.get(kind, resource)
            if existing is not None:
                self.owned(kind, existing, intent)
            resources[kind] = resource
        if "server" in resources:
            server = self.get("server", resources["server"])
            if server is not None:
                self.owned("server", server, intent)
                volume_ids = {v["id"] for v in server.get("volumes", {}).values()}
                require(
                    volume_ids <= {resources[k] for k in ("root", "home") if k in resources},
                    "unexpected_attachment",
                )
                require(
                    {v["id"] for v in server.get("public_ips", [])} <= {resources.get("ip")}
                    and server.get("security_group", {}).get("id") == resources.get("security"),
                    "unexpected_network_attachment",
                )
                while server is not None and server.get("state") != "stopped":
                    require(time.monotonic() < deadline, "cleanup_deadline")
                    if server.get("state") in {"running", "stopped in place"}:
                        self.request(
                            "POST",
                            self.path("server", server["id"]) + "/action",
                            {"action": "poweroff"},
                            missing=True,
                        )
                    time.sleep(policy()["limits"]["poll_seconds"])
                    server = self.get("server", resources["server"])
                if server is not None:
                    self.request("DELETE", self.path("server", server["id"]), missing=True)
            self.absent("server", resources["server"], deadline)
        for kind in ("root", "home", "ip", "security"):
            if kind not in resources:
                continue
            obj = self.get(kind, resources[kind])
            if obj is None:
                self.absent(kind, resources[kind], deadline)
                continue
            self.owned(kind, obj, intent)
            if (
                kind in {"root", "home"}
                and obj.get("status") == "deleted"
                and not obj.get("references")
            ):
                self.absent(kind, resources[kind], deadline)
                continue
            if kind in {"root", "home"}:
                self.wait_volume(kind, resources[kind], deadline)
            if kind == "ip":
                require(obj.get("server") is None, "ip_still_attached")
            if kind == "security":
                require(
                    not obj.get("servers") and obj.get("project_default") is False,
                    "security_still_attached",
                )
            self.request("DELETE", self.path(kind, resources[kind]), missing=True)
            self.absent(kind, resources[kind], deadline)
        require(not self.discover(intent), "cleanup_incomplete")
        return {
            "version": 1,
            "nonce": intent["nonce"],
            "status": "absent",
            "resources": resources,
            "checked_at": utc(),
            "distribution_qualified": False,
        }

    def absent(self, kind: str, resource: str, deadline: float) -> None:
        while time.monotonic() < deadline:
            value = self.get(kind, resource)
            inactive = value is None or (
                kind in {"root", "home"}
                and value.get("status") == "deleted"
                and not value.get("references")
            )
            if inactive and all(row["id"] != resource for row in self.objects(kind)):
                return
            time.sleep(policy()["limits"]["poll_seconds"])
        raise CycleError("absence_deadline")
