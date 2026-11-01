"""Prepare a private checkpoint input and restore it only through approved main execution."""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import lzma
import os
import stat
import time
import zipfile
import zlib
from pathlib import Path

import scaleway_cycle as cycle
from scaleway_ledger import GitHub, validate_unallocated


def checkpoint(value: dict, settings: dict) -> None:
    allowed = {
        "version",
        "identity",
        "project_binding",
        "zone",
        "policy_sha256",
        "status",
        "leases",
        "unallocated_attempts",
        "deferred",
        "checked_at",
        "distribution_qualified",
        "authority",
        "restoration",
    }
    cycle.require(
        set(value) <= allowed
        and value["version"] == 1
        and value["status"] == "passed"
        and value["distribution_qualified"] is False
        and not value.get("deferred"),
        "backup_checkpoint",
    )
    cycle.require(
        value["project_binding"] == settings["project_binding"]
        and value["zone"] == settings["zone"],
        "backup_project",
    )
    cycle.sha(value["project_binding"])
    cycle.sha(value["policy_sha256"])
    cycle.timestamp(value["checked_at"])
    identity = value["identity"]
    cycle.require(
        set(identity) == {"repository", "source_sha", "workflow", "run_id", "attempt", "event"}
        and identity["repository"] == cycle.REPOSITORY
        and identity["workflow"] == cycle.policy()["cleanup_workflow"]
        and identity["event"] in {"workflow_dispatch", "workflow_run", "schedule"},
        "backup_source",
    )
    cycle.sha(identity["source_sha"], 40)
    cycle.require(
        all(
            isinstance(identity[key], str)
            and identity[key].isdigit()
            and 0 < len(identity[key]) <= 20
            for key in ("run_id", "attempt")
        ),
        "backup_run",
    )
    validate_unallocated(value.get("unallocated_attempts", []))
    leases = value["leases"]
    cycle.require(
        isinstance(leases, list) and len(leases) <= cycle.policy()["limits"]["maximum_leases"],
        "backup_lease_bound",
    )
    seen = set()
    for row in leases:
        cycle.require(set(row) == {"intent", "receipt"}, "backup_lease_fields")
        intent, receipt = row["intent"], row["receipt"]
        cycle.validate_intent(intent, settings, historical=True)
        cycle.require(
            intent["nonce"] not in seen
            and receipt["nonce"] == intent["nonce"]
            and receipt["status"] == "absent"
            and receipt["allocation_resolved"] is True
            and receipt["distribution_qualified"] is False,
            "backup_absence",
        )
        seen.add(intent["nonce"])
        cycle.require(
            isinstance(receipt["resources"], dict)
            and set(receipt["resources"]) <= set(cycle.KINDS),
            "backup_resources",
        )
        for resource in receipt["resources"].values():
            cycle.identifier(resource)
        cycle.require(
            all(
                type(receipt.get(key, False)) is bool
                for key in ("independent_deletion_observed", "native_smoke_passed")
            ),
            "backup_native_flags",
        )
        cycle.timestamp(receipt["checked_at"])


def from_archive(file: Path) -> dict:
    info = file.lstat()
    maximum = cycle.policy()["limits"]["maximum_json_bytes"]
    cycle.require(
        stat.S_ISREG(info.st_mode)
        and info.st_nlink == 1
        and file.resolve() == file.absolute()
        and info.st_size <= maximum,
        "backup_archive_file",
    )
    try:
        with zipfile.ZipFile(file) as archive:
            cycle.require(archive.namelist() == ["recovery.json"], "backup_archive_members")
            member = archive.getinfo("recovery.json")
            cycle.require(
                member.file_size <= maximum
                and member.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                and not member.flag_bits & 1,
                "backup_archive_bound",
            )
            with archive.open(member) as source:
                value = cycle.decode(source.read(maximum + 1))
    except cycle.CycleError:
        raise
    except (zipfile.BadZipFile, zlib.error, OSError, EOFError, ValueError):
        raise cycle.CycleError("invalid_backup_archive") from None
    checkpoint(value, {"project_binding": value["project_binding"], "zone": value["zone"]})
    return value


def prepare_input(archive: Path, output: Path) -> dict:
    value = from_archive(archive)
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    compressed = lzma.compress(data, format=lzma.FORMAT_XZ, preset=6)
    payload = base64.b64encode(compressed).decode("ascii")
    cycle.require(
        len(payload) <= cycle.policy()["limits"]["maximum_restore_characters"], "backup_input_bound"
    )
    expected = hashlib.sha256(compressed).hexdigest()
    request = {
        "ref": "main",
        "inputs": {
            "mode": "restore",
            "backup_base64": payload,
            "backup_sha256": expected,
            "confirm_project_reconciled": "true",
        },
    }
    cycle.require(
        not output.exists() and output.parent.resolve() == output.parent.absolute(),
        "private_backup_destination",
    )
    with os.fdopen(os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w") as stream:
        json.dump(request, stream, indent=2)
        stream.write("\n")
    return {
        "sha256": expected,
        "input_characters": len(payload),
        "original_source": value["identity"],
    }


def decode_input(inputs: dict | None = None) -> tuple[dict, str]:
    if inputs is None:
        inputs = cycle.read(Path(os.environ["GITHUB_EVENT_PATH"]))["inputs"]
    payload = inputs.get("backup_base64", "")
    expected = cycle.sha(os.environ.get("SCW_RESTORE_SHA256", ""))
    cycle.require(
        0 < len(payload) <= cycle.policy()["limits"]["maximum_restore_characters"],
        "backup_input_bound",
    )
    try:
        compressed = base64.b64decode(payload, validate=True)
        cycle.require(hashlib.sha256(compressed).hexdigest() == expected, "backup_digest")
        maximum = cycle.policy()["limits"]["maximum_json_bytes"]
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ, memlimit=64 * 1024 * 1024)
        data = decoder.decompress(compressed, max_length=maximum + 1)
        cycle.require(
            len(data) <= maximum and decoder.eof and not decoder.unused_data,
            "backup_expanded_bound",
        )
        value = cycle.decode(data)
    except cycle.CycleError:
        raise
    except (OSError, EOFError, ValueError, zlib.error, lzma.LZMAError):
        raise cycle.CycleError("invalid_backup_payload") from None
    return value, expected


def restore(gh: GitHub, output: Path) -> None:
    cycle.require(
        os.environ.get("SCW_RECOVERY_ENABLED") == "true"
        and os.environ.get("SCW_CYCLE_ENABLED", "") in {"", "false"},
        "backup_requires_suspension",
    )
    identity = cycle.source_context("cleanup")
    cycle.require(identity["event"] == "workflow_dispatch", "backup_requires_manual_dispatch")
    event = cycle.read(Path(os.environ["GITHUB_EVENT_PATH"]))
    inputs = event.get("inputs", {})
    cycle.require(
        inputs.get("mode") == "restore"
        and inputs.get("confirm_project_reconciled") in {True, "true"}
        and inputs.get("backup_sha256") == os.environ.get("SCW_RESTORE_SHA256"),
        "backup_approval_input",
    )
    gh.run(identity["run_id"], "cleanup", require_active=True)
    gh.guards()
    settings = cycle.configuration()
    value, digest = decode_input(inputs)
    checkpoint(value, settings)
    workflow = gh.workflow(cycle.policy()["qualification_workflow"])
    producers = gh.pages(
        f"repos/{{owner}}/{{repo}}/actions/workflows/{workflow['id']}/runs?branch=main&event=workflow_dispatch",
        "workflow_runs",
    )
    cycle.require(all(run["status"] == "completed" for run in producers), "backup_active_producer")
    cycle.require(
        not gh.intents(
            settings, previous=value["leases"], unallocated=value.get("unallocated_attempts", [])
        ),
        "backup_incomplete_history",
    )
    api = cycle.API(os.environ.get("SCW_SECRET_KEY", ""), settings, "observer")
    api.deadline = time.monotonic() + cycle.policy()["limits"]["cleanup_seconds"]
    api.empty_slot()
    for row in value["leases"]:
        for kind, resource in row["receipt"]["resources"].items():
            observed = api.get(kind, resource)
            inactive = observed is None or (
                kind in {"root", "home"}
                and observed.get("status") == "deleted"
                and not observed.get("references")
            )
            cycle.require(
                inactive and all(item["id"] != resource for item in api.objects(kind)),
                "backup_resource_still_present",
            )
    approval = {
        "basis": "maintainer-approved-private-checkpoint",
        "run_id": identity["run_id"],
        "attempt": identity["attempt"],
        "source_sha": identity["source_sha"],
        "backup_sha256": digest,
        "origin": value["identity"],
    }
    leases = copy.deepcopy(value["leases"])
    for row in leases:
        row["receipt"]["checkpoint_approval"] = approval
    result = {
        "version": 1,
        "identity": identity,
        "project_binding": settings["project_binding"],
        "zone": settings["zone"],
        "policy_sha256": cycle.digest(cycle.POLICY_PATH),
        "status": "passed",
        "leases": leases,
        "unallocated_attempts": gh.unallocated(),
        "deferred": [],
        "checked_at": cycle.utc(),
        "authority": "restore",
        "restoration": approval,
        "distribution_qualified": False,
    }
    output.mkdir(parents=True, exist_ok=False)
    cycle.write(output / "recovery.json", result)
