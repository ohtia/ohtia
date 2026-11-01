"""Reconcile immutable delivery metadata; no credentials, network or publication authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
CAPABILITIES = (
    "build",
    "provenance",
    "native_runtime",
    "catalog_authentication",
    "native_package_signing",
    "first_installation",
    "installed_update",
)
STATES = {"unknown", "unavailable", "failed", "passed", "expired", "revoked", "not_required"}
SHA = re.compile(r"[a-f0-9]{64}")
COMMIT = re.compile(r"[a-f0-9]{40}")
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,95}")


class AdmissionError(ValueError):
    """A stable non-sensitive admission refusal code."""


def require(condition, code):
    if not condition:
        raise AdmissionError(code)


def fields(value, names):
    require(type(value) is dict and set(value) == set(names.split()), "fields")


def integer(value, minimum=0):
    require(type(value) is int and minimum <= value <= 9007199254740991, "integer")
    return value


def identifier(value):
    require(type(value) is str and ID.fullmatch(value) is not None, "identifier")
    return value


def digest_id(value):
    require(type(value) is str and SHA.fullmatch(value) is not None, "digest")
    return value


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_field")
        result[key] = value
    return result


def canonical(value):
    def scalars(item):
        require(type(item) in (dict, list, str, int, bool, type(None)), "scalar")
        if type(item) is dict:
            require(all(type(k) is str for k in item), "field_name")
            for v in item.values():
                scalars(v)
        elif type(item) is list:
            for v in item:
                scalars(v)

    try:
        scalars(value)
        return (
            json.dumps(
                value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")
            )
            + "\n"
        ).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise AdmissionError("encoding") from None


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def decode(data, maximum):
    require(type(data) is bytes and 0 < len(data) <= maximum, "metadata_bound")
    try:
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=unique,
            parse_constant=lambda _: (_ for _ in ()).throw(AdmissionError("number")),
        )
        require(canonical(value) == data, "representation")
        return value
    except (UnicodeError, ValueError, RecursionError) as error:
        if isinstance(error, AdmissionError):
            raise
        raise AdmissionError("encoding") from None


def read_bytes(path, maximum):
    import os

    require(not path.is_symlink(), "metadata_file")
    try:
        fd = os.open(
            path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        )
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, "metadata_file")
            data = source.read(maximum + 1)
    except OSError:
        raise AdmissionError("metadata_unavailable") from None
    require(len(data) <= maximum, "metadata_bound")
    return data


def configuration():
    numeric = json.loads((ROOT / "config/desktop/resource-policy.json").read_bytes())
    limits = {
        name.removeprefix("delivery_"): entry["value"]
        for name, entry in numeric["budgets"].items()
        if name.startswith("delivery_")
    }
    targets = json.loads((ROOT / "config/desktop/targets.json").read_bytes())
    policy = json.loads((ROOT / "config/desktop/delivery-capabilities.json").read_bytes())
    limits["installer_bytes"] = numeric["budgets"]["update_package_bytes"]["value"]
    return targets, policy, limits


def policy_digest(targets, policy, limits):
    return sha({"targets": targets, "capabilities": policy, "limits": limits})


def subject(value):
    fields(value, "kind id repository application_version source_commit source_tree")
    require(value["kind"] in {"quality", "qualification", "candidate"}, "subject_kind")
    identifier(value["id"])
    require(value["repository"] == "ohtia/ohtia", "repository")
    version(value["application_version"])
    require(
        ("-dev." in value["application_version"]) == (value["kind"] != "candidate"),
        "subject_version_class",
    )
    for name in ("source_commit", "source_tree"):
        require(type(value[name]) is str and COMMIT.fullmatch(value[name]) is not None, "source")


def version(value):
    require(type(value) is str and len(value) <= 96, "version")
    match = re.fullmatch(
        r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(dev|beta)\.([1-9][0-9]*)(?:\.([1-9][0-9]*))?)?",
        value,
    )
    require(match is not None, "version")
    a, b, c, kind, run, attempt = match.groups()
    require((kind == "dev") == (attempt is not None), "version")
    return (
        int(a),
        int(b),
        int(c),
        2 if kind is None else 1 if kind == "dev" else 0,
        int(run or 0),
        int(attempt or 0),
    )


def profiles(target, policy):
    return {name: item for name, item in policy["profiles"].items() if item["os"] == target["os"]}


def cell_specs(targets, selected):
    """Derive required native cells from trusted target policy, never from producer omissions."""
    result = {}
    for target in targets["targets"]:
        if target["id"] not in selected:
            continue
        if target["os"] == "linux":
            for profile in target["distribution_profiles"]:
                group = (
                    "ubuntu-deb"
                    if profile["id"].startswith("ubuntu-")
                    else "debian-deb"
                    if profile["id"].startswith("debian-")
                    else "fedora-rpm"
                )
                for display in profile["display_backends"]:
                    key = target["id"] + "-" + profile["id"].replace(".", "-") + "-" + display
                    result[key] = {
                        "target": target["id"],
                        "profile": group,
                        "os_profile": profile["id"],
                        "os_version": profile["id"].split("-", 1)[1],
                        "filesystem": profile["filesystems"][0],
                        "security": profile["security_policy"],
                        "display": display,
                    }
        elif target["os"] == "darwin":
            majors = (
                target["required_os_majors"]
                if target["native_required"]
                else target["admitted_os_majors"]
            )
            require(bool(majors), "optional_scope_empty")
            for major in majors:
                result[f"{target['id']}-macos-{major}"] = {
                    "target": target["id"],
                    "profile": "macos-dmg-zip",
                    "os_profile": f"macos-{major}",
                    "os_version": str(major),
                    "filesystem": "APFS",
                    "security": "native-sandbox",
                    "display": "windowserver",
                }
        else:
            result[target["id"] + "-windows-11"] = {
                "target": target["id"],
                "profile": "windows-nsis",
                "os_profile": "windows-11",
                "os_version": "11",
                "filesystem": "NTFS",
                "security": "native-sandbox",
                "display": "desktop",
            }
    return result


@dataclass(frozen=True)
class Context:
    """Supplied by the trusted caller; never deserialize authority from the input bundle.

    verify_evidence must independently validate provenance/authority and completeness
    of the relevant evidence record. This module does not implement the P4/P6/P7
    signing or attestation adapters. Omitting the verifier always refuses eligibility.
    """

    expected_subject_sha256: str
    expected_manifest_sha256: str
    now_ms: int
    selected_targets: tuple[str, ...]
    operation: str
    verify_evidence: Callable[[dict, bytes], bool] | None = None
    revoked: frozenset[str] = frozenset()
    baseline_inventories: frozenset[str] = frozenset()
    baseline_requirements: tuple[tuple[str, tuple[str, ...]], ...] = ()


def _reconcile(capabilities, artifacts, cells, evidence, context, records):
    targets, policy, limits = configuration()
    documents = [capabilities, artifacts, cells, evidence]
    total = sum(len(canonical(v)) for v in documents)
    for doc in documents:
        require(len(canonical(doc)) <= limits["document_bytes"], "metadata_bound")
    require(total <= limits["total_metadata_bytes"], "metadata_total")
    expected_subject = capabilities["subject"]
    subject(expected_subject)
    require(sha(expected_subject) == digest_id(context.expected_subject_sha256), "expected_subject")
    require(sha(capabilities) == digest_id(context.expected_manifest_sha256), "expected_manifest")
    integer(context.now_ms)
    declared = {t["id"]: t for t in targets["targets"]}
    selected = set(context.selected_targets)
    require(
        len(selected) == len(context.selected_targets)
        and bool(selected)
        and selected <= set(declared),
        "requested_targets",
    )
    require(context.operation in {"linux_qualification", "candidate", "public"}, "operation")
    required = {t["id"] for t in targets["targets"] if t["native_required"]}
    require(required <= selected, "required_target_scope")
    require(expected_subject["kind"] != "quality", "quality_not_qualification")
    require(
        context.operation not in {"candidate", "public"} or expected_subject["kind"] == "candidate",
        "public_subject",
    )
    require(
        context.operation != "public" or "-dev." not in expected_subject["application_version"],
        "development_distribution",
    )
    for doc in documents:
        require(
            type(doc) is dict
            and type(doc.get("schema_version")) is int
            and doc["schema_version"] == 1,
            "schema_version",
        )
        require(doc.get("subject") == expected_subject, "subject_binding")
    fields(capabilities, "schema_version subject inputs targets")
    fields(
        capabilities["inputs"],
        "target_policy capability_policy artifact_inventory cell_inventory evidence_inventory",
    )
    expected = {
        "target_policy": sha(targets),
        "capability_policy": policy_digest(targets, policy, limits),
        "artifact_inventory": sha(artifacts),
        "cell_inventory": sha(cells),
        "evidence_inventory": sha(evidence),
    }
    require(capabilities["inputs"] == expected, "input_binding")
    fields(artifacts, "schema_version subject inventories")
    fields(cells, "schema_version subject cells")
    fields(evidence, "schema_version subject records")
    inventories = artifacts["inventories"]
    require(
        type(inventories) is list and 0 < len(inventories) <= limits["version_inventories"],
        "inventory_bound",
    )
    catalog, inventory_ids, inventory_hashes, versions, package_digests = (
        {},
        set(),
        {},
        set(),
        set(),
    )
    for inventory in inventories:
        fields(inventory, "subject artifacts")
        subject(inventory["subject"])
        sid = sha(inventory["subject"])
        require(sid not in inventory_ids, "duplicate_inventory")
        inventory_ids.add(sid)
        require(inventory["subject"]["application_version"] not in versions, "duplicate_version")
        versions.add(inventory["subject"]["application_version"])
        inventory_hashes[sid] = sha(inventory)
        if inventory["subject"] != expected_subject:
            require(
                inventory["subject"]["kind"] in {"qualification", "candidate"}
                and sha(inventory) in context.baseline_inventories,
                "baseline_authority",
            )
            require(
                context.operation != "public" or inventory["subject"]["kind"] == "candidate",
                "public_baseline_class",
            )
        require(
            type(inventory["artifacts"]) is list
            and 0 < len(inventory["artifacts"]) <= limits["artifacts_per_inventory"],
            "artifact_bound",
        )
        for artifact in inventory["artifacts"]:
            fields(
                artifact,
                "id targets profile format architecture slices sha256 bytes native_version build signing provenance",
            )
            aid = identifier(artifact["id"])
            key = (sid, aid)
            require(key not in catalog, "duplicate_artifact")
            digest_id(artifact["sha256"])
            require(artifact["sha256"] not in package_digests, "artifact_digest_reuse")
            package_digests.add(artifact["sha256"])
            integer(artifact["bytes"], 1)
            require(artifact["bytes"] <= limits["installer_bytes"], "package_bound")
            ts = artifact["targets"]
            require(
                type(ts) is list
                and bool(ts)
                and len(set(ts)) == len(ts)
                and set(ts)
                <= (selected if inventory["subject"] == expected_subject else set(declared)),
                "artifact_targets",
            )
            slices = sorted({declared[t]["arch"] for t in ts})
            require(artifact["slices"] == slices, "artifact_slices")
            if artifact["architecture"] == "universal":
                require(
                    set(ts) == {"darwin-x64", "darwin-arm64"} and slices == ["arm64", "x64"],
                    "universal_slices",
                )
            else:
                require(
                    len(ts) == 1 and artifact["architecture"] == slices[0], "artifact_architecture"
                )
            for t in ts:
                ps = profiles(declared[t], policy)
                require(
                    artifact["profile"] in ps
                    and artifact["format"] in ps[artifact["profile"]]["formats"],
                    "artifact_profile",
                )
            require(
                type(artifact["native_version"]) is str
                and 0 < len(artifact["native_version"]) <= 160,
                "native_version",
            )
            for name in ("build", "provenance"):
                identifier(artifact[name])
            require(
                type(artifact["signing"]) is list
                and len(set(artifact["signing"])) == len(artifact["signing"]),
                "signing",
            )
            require(
                policy["profiles"][artifact["profile"]]["native_signing"] != "not_required"
                or not artifact["signing"],
                "signing_policy",
            )
            for reference in artifact["signing"]:
                identifier(reference)
            catalog[key] = (artifact, inventory["subject"])
    current = sha(expected_subject)
    require(current in inventory_ids, "current_inventory")

    def reference(ref):
        fields(ref, "inventory artifact sha256 bytes")
        key = (digest_id(ref["inventory"]), identifier(ref["artifact"]))
        require(key in catalog, "artifact_missing")
        item, item_subject = catalog[key]
        require(
            ref["sha256"] == item["sha256"]
            and type(ref["bytes"]) is int
            and ref["bytes"] == item["bytes"],
            "artifact_bytes",
        )
        return item, item_subject

    specs = cell_specs(targets, selected)
    baseline_requirements = dict(context.baseline_requirements)
    require(
        len(baseline_requirements) == len(context.baseline_requirements)
        and set(baseline_requirements) == set(specs),
        "baseline_requirements",
    )
    for required_baselines in baseline_requirements.values():
        require(
            type(required_baselines) is tuple
            and len(required_baselines) <= limits["version_inventories"]
            and len(set(required_baselines)) == len(required_baselines),
            "baseline_requirements",
        )
        for digest in required_baselines:
            digest_id(digest)
            require(digest in context.baseline_inventories, "baseline_authority")
    require(type(cells["cells"]) is list and len(cells["cells"]) <= limits["cells"], "cell_bound")
    bycell = {}
    used = set()
    for cell in cells["cells"]:
        fields(
            cell,
            "id target profile os_profile os_version filesystem security display scenarios assignments",
        )
        cid = identifier(cell["id"])
        require(cid not in bycell and cid in specs, "cell_identity")
        require({k: cell[k] for k in specs[cid]} == specs[cid], "cell_environment")
        require(
            type(cell["scenarios"]) is list
            and set(cell["scenarios"]) == set(policy["scenarios"])
            and len(cell["scenarios"]) == len(policy["scenarios"]),
            "cell_scenarios",
        )
        assignment = cell["assignments"]
        fields(assignment, "install update baselines")
        profile = policy["profiles"][cell["profile"]]
        for role in ("install", "update"):
            item, sub = reference(assignment[role])
            require(
                assignment[role]["inventory"] == current
                and cell["target"] in item["targets"]
                and item["profile"] == cell["profile"]
                and item["format"] == profile[role],
                "artifact_assignment",
            )
            used.add((current, item["id"]))
        require(
            profile["install"] != profile["update"]
            or assignment["install"] == assignment["update"],
            "artifact_role_substitution",
        )
        require(
            type(assignment["baselines"]) is list,
            "baseline_missing",
        )
        if declared[cell["target"]]["os"] == "linux" or context.operation == "public":
            require(bool(assignment["baselines"]), "baseline_missing")
        seen = set()
        for ref in assignment["baselines"]:
            item, sub = reference(ref)
            key = (ref["inventory"], ref["artifact"])
            require(
                key not in seen
                and ref["inventory"] != current
                and sub["repository"] == expected_subject["repository"]
                and version(sub["application_version"])
                < version(expected_subject["application_version"]),
                "baseline_identity",
            )
            seen.add(key)
            require(
                cell["target"] in item["targets"]
                and item["profile"] == cell["profile"]
                and item["format"] in {profile["install"], profile["update"]},
                "baseline_profile",
            )
        require(
            {inventory_hashes[r["inventory"]] for r in assignment["baselines"]}
            == set(baseline_requirements[cid]),
            "baseline_coverage",
        )
        bycell[cid] = cell
    require(set(bycell) == set(specs), "cell_coverage")
    require({key for key in catalog if key[0] == current} == used, "unassigned_artifact")
    # Sessions for one OS/profile/CPU must exercise one final package.
    shared = {}
    for cell in bycell.values():
        key = (cell["target"], cell["os_profile"])
        value = {role: cell["assignments"][role] for role in ("install", "update")}
        require(key not in shared or shared[key] == value, "session_package_substitution")
        shared[key] = value

    def scenario_assignments(cell, scenario):
        baselines = (
            cell["assignments"]["baselines"]
            if "baseline" in policy["scenarios"][scenario]
            else [None]
        )
        combinations = []
        for baseline in baselines:
            refs = [
                baseline if role == "baseline" else cell["assignments"][role]
                for role in policy["scenarios"][scenario]
            ]
            combinations.append(list({canonical(ref): ref for ref in refs}.values()))
        return combinations

    def validate_native_observation(record, cell):
        arch = declared[cell["target"]]["arch"]
        require(
            type(record["observed"]) is dict
            and all(
                record["observed"].get(flag) is True
                for flag in ("native", "ordinary_user", "graphical_session")
            )
            and record["observed"]
            == {
                **specs[cell["id"]],
                "native": True,
                "ordinary_user": True,
                "graphical_session": True,
                "architecture": arch,
                "process_architecture": arch,
                "addon_architecture": arch,
            },
            "native_environment",
        )

    def validate_artifact_details(record):
        kind, details = record["kind"], record["details"]
        if kind == "build":
            fields(details, "inputs_sha256 payload_sha256")
            digest_id(details["inputs_sha256"])
            digest_id(details["payload_sha256"])
        elif kind == "provenance":
            require(details == {"mechanism": "github-artifact-attestation"}, "provenance_mechanism")
        else:
            fields(details, "mechanism authority signer")
            digest_id(details["authority"])
            digest_id(details["signer"])
            if kind == "catalog_authentication":
                require(details["mechanism"] == "ed25519", "catalog_mechanism")
            else:
                mechanism = policy["profiles"][record["profile"]]["native_signing"]
                require(
                    mechanism != "not_required" and details["mechanism"] == mechanism,
                    "signing_mechanism",
                )

    references = evidence["records"]
    require(
        type(references) is list and len(references) <= limits["evidence_records"], "evidence_bound"
    )
    require(
        len(set(references)) == len(references) and set(references) == set(records),
        "evidence_index",
    )
    verified, effective, by_receipt = {}, {}, {}
    job_identities, native_jobs, invocations = {}, {}, set()
    for expected_digest in references:
        digest_id(expected_digest)
        data = records[expected_digest]
        record = decode(data, limits["evidence_record_bytes"])
        require(hashlib.sha256(data).hexdigest() == expected_digest, "evidence_digest")
        total += len(data)
        require(total <= limits["total_metadata_bytes"], "evidence_bound")
        fields(
            record,
            "id kind subject target profile artifacts cell scenarios execution observed outcome observed_at_ms expires_at_ms proof_sha256 details",
        )
        digest_id(record["proof_sha256"])
        rid = identifier(record["id"])
        require(rid not in by_receipt, "duplicate_evidence_id")
        subject(record["subject"])
        require(record["subject"] == expected_subject, "evidence_subject")
        digest = hashlib.sha256(data).hexdigest()
        require(digest not in verified, "duplicate_evidence")
        require(
            record["kind"] in CAPABILITIES
            and record["target"] in selected
            and record["profile"] in profiles(declared[record["target"]], policy),
            "evidence_kind",
        )
        require(
            record["outcome"] in {"passed", "failed", "cancelled", "skipped", "unknown"},
            "evidence_outcome",
        )
        start, end = integer(record["observed_at_ms"]), integer(record["expires_at_ms"])
        require(start < end, "evidence_time")
        fields(record["execution"], "workflow workflow_sha run_id attempt job_id invocation")
        execution = record["execution"]
        require(
            type(execution["workflow"]) is str
            and re.fullmatch(r"\.github/workflows/[a-z0-9-]+\.ya?ml", execution["workflow"])
            is not None,
            "workflow",
        )
        require(
            type(execution["workflow_sha"]) is str
            and COMMIT.fullmatch(execution["workflow_sha"]) is not None,
            "workflow_source",
        )
        for field in ("run_id", "attempt", "job_id"):
            integer(execution[field], 1)
        identifier(execution["invocation"])
        job_parent = {k: v for k, v in execution.items() if k not in {"job_id", "invocation"}}
        require(
            execution["job_id"] not in job_identities
            or job_identities[execution["job_id"]] == job_parent,
            "job_identity_conflict",
        )
        job_identities[execution["job_id"]] = job_parent
        if record["kind"] == "build" and "-dev." in expected_subject["application_version"]:
            run, attempt = map(
                int, expected_subject["application_version"].split("-dev.")[1].split(".")
            )
            require(
                (execution["run_id"], execution["attempt"]) == (run, attempt),
                "development_build_identity",
            )
        require(
            type(record["artifacts"]) is list and bool(record["artifacts"]), "evidence_artifacts"
        )
        for ref in record["artifacts"]:
            item, sub = reference(ref)
            require(
                sub == record["subject"] or record["kind"] in policy["capability_scenarios"],
                "evidence_subject",
            )
        require(
            type(record["scenarios"]) is list
            and all(type(v) is str for v in record["scenarios"])
            and len(set(record["scenarios"])) == len(record["scenarios"]),
            "evidence_scenarios",
        )
        require(type(record["details"]) is dict, "evidence_details")
        require(
            len({canonical(ref) for ref in record["artifacts"]}) == len(record["artifacts"]),
            "duplicate_evidence_artifact",
        )
        if record["kind"] in policy["capability_scenarios"]:
            require(type(record["cell"]) is str and record["cell"] in bycell, "native_cell")
            cell = bycell[record["cell"]]
            require(
                record["target"] == cell["target"] and record["profile"] == cell["profile"],
                "native_cell",
            )
            require(
                bool(record["scenarios"])
                and set(record["scenarios"]) <= set(policy["capability_scenarios"][record["kind"]]),
                "evidence_scenarios",
            )
            require(
                execution["job_id"] not in native_jobs
                or native_jobs[execution["job_id"]] == cell["id"],
                "native_job_cell",
            )
            native_jobs[execution["job_id"]] = cell["id"]
            for scenario in record["scenarios"]:
                key = canonical([execution, cell["id"], scenario, record["artifacts"]])
                require(key not in invocations, "duplicate_native_execution")
                invocations.add(key)
                if record["outcome"] == "passed":
                    combinations = scenario_assignments(cell, scenario)
                    require(
                        bool(combinations) and record["artifacts"] in combinations,
                        "native_artifact_assignment",
                    )
            if record["outcome"] == "passed":
                validate_native_observation(record, cell)
            else:
                require(
                    record["observed"] is None or type(record["observed"]) is dict,
                    "native_environment",
                )
        else:
            require(
                record["cell"] is None and record["scenarios"] == [] and record["observed"] is None,
                "artifact_evidence",
            )
            if record["outcome"] == "passed":
                validate_artifact_details(record)
        accepted = False
        if context.verify_evidence is not None:
            try:
                # The adapter receives a detached copy; indexed bytes remain authoritative.
                accepted = context.verify_evidence(json.loads(data), data) is True
            except Exception:
                pass
        effective[digest] = (
            "revoked"
            if digest in context.revoked
            else "expired"
            if end <= context.now_ms
            else "unknown"
            if not accepted or start > context.now_ms
            else "passed"
            if record["outcome"] == "passed"
            else "failed"
        )
        verified[digest] = (
            record,
            accepted
            and digest not in context.revoked
            and start <= context.now_ms < end
            and record["outcome"] == "passed",
        )
        by_receipt[rid] = record

    for (sid, _), (item, _) in catalog.items():
        if sid != current:
            continue
        ref = {
            "inventory": sid,
            "artifact": item["id"],
            "sha256": item["sha256"],
            "bytes": item["bytes"],
        }
        for kind, receipt_ids in (
            ("build", [item["build"]]),
            ("provenance", [item["provenance"]]),
            ("native_package_signing", item["signing"]),
        ):
            for rid in receipt_ids:
                require(rid in by_receipt, "artifact_receipt_missing")
                receipt = by_receipt[rid]
                require(
                    receipt["kind"] == kind
                    and receipt["target"] in item["targets"]
                    and receipt["profile"] == item["profile"]
                    and ref in receipt["artifacts"],
                    "artifact_receipt_binding",
                )
    producer_jobs = {
        record["execution"]["job_id"]
        for record, _ in verified.values()
        if record["kind"] in {"build", "native_package_signing"}
    }
    require(producer_jobs.isdisjoint(native_jobs), "producer_test_separation")

    groups = capabilities["targets"]
    require(type(groups) is list and len(groups) == len(declared), "target_declaration")
    seen_targets = set()
    decisions = []
    for entry in groups:
        fields(entry, "target profiles")
        target = entry["target"]
        require(target in declared and target not in seen_targets, "target_declaration")
        seen_targets.add(target)
        ps = profiles(declared[target], policy)
        require(
            type(entry["profiles"]) is list and len(entry["profiles"]) == len(ps),
            "profile_declaration",
        )
        seen_profiles = set()
        for group in entry["profiles"]:
            fields(group, "profile formats capabilities")
            name = group["profile"]
            require(name in ps and name not in seen_profiles, "profile_declaration")
            seen_profiles.add(name)
            require(group["formats"] == ps[name]["formats"], "format_declaration")
            fields(group["capabilities"], " ".join(CAPABILITIES))
            required_caps = (
                set(CAPABILITIES)
                if declared[target]["os"] == "linux" or context.operation == "public"
                else {"build", "provenance", "native_runtime"}
            )
            capability_states = {}
            for capability, claim in group["capabilities"].items():
                fields(claim, "state evidence")
                require(
                    claim["state"] in STATES
                    and type(claim["evidence"]) is list
                    and len(set(claim["evidence"])) == len(claim["evidence"]),
                    "capability_state",
                )
                refs = []
                for digest in claim["evidence"]:
                    digest_id(digest)
                    require(digest in verified, "evidence_missing")
                    record, good = verified[digest]
                    require(
                        record["kind"] == capability
                        and (
                            record["target"] == target
                            or (
                                capability not in policy["capability_scenarios"]
                                and all(
                                    target in reference(ref)[0]["targets"]
                                    for ref in record["artifacts"]
                                )
                            )
                        )
                        and record["profile"] == name
                        and record["subject"] == expected_subject,
                        "capability_binding",
                    )
                    refs.append((record, good))
                not_required = (
                    capability == "native_package_signing"
                    and ps[name]["native_signing"] == "not_required"
                )
                require(claim["state"] != "not_required" or not_required, "invalid_waiver")
                if claim["state"] == "passed":
                    require(bool(refs), "passed_without_evidence")
                state = claim["state"]
                if state == "passed":
                    state = next(
                        (effective[d] for d in claim["evidence"] if effective[d] != "passed"),
                        "passed",
                    )
                capability_states[capability] = state
                if not_required:
                    require(
                        claim["state"] == "not_required" and not claim["evidence"], "signing_policy"
                    )
                if target not in selected:
                    require(
                        claim["state"] in {"unknown", "unavailable", "not_required"}
                        and not claim["evidence"],
                        "unselected_claim",
                    )
                    continue
                if capability not in required_caps and claim["state"] != "passed":
                    continue
                if not_required:
                    require(
                        claim["state"] == "not_required" and not claim["evidence"], "signing_policy"
                    )
                    continue
                require(
                    claim["state"] == "passed" and bool(refs) and all(good for _, good in refs),
                    "capability_unqualified",
                )
                relevant = [
                    c for c in bycell.values() if c["target"] == target and c["profile"] == name
                ]
                if capability in policy["capability_scenarios"]:
                    for cell in relevant:
                        for scenario in policy["capability_scenarios"][capability]:
                            combinations = scenario_assignments(cell, scenario)
                            require(bool(combinations), "scenario_coverage")
                            for expected_refs in combinations:
                                require(
                                    any(
                                        r["cell"] == cell["id"]
                                        and scenario in r["scenarios"]
                                        and r["artifacts"] == expected_refs
                                        for r, _ in refs
                                    ),
                                    "scenario_coverage",
                                )
                else:
                    needed = {
                        tuple((ref["inventory"], ref["artifact"]))
                        for c in relevant
                        for ref in [c["assignments"]["install"], c["assignments"]["update"]]
                    }
                    covered = set()
                    signing_coverage = {}
                    for r, _ in refs:
                        require(
                            r["cell"] is None and r["scenarios"] == [] and r["observed"] is None,
                            "artifact_evidence",
                        )
                        for ref in r["artifacts"]:
                            item, _ = reference(ref)
                            require(
                                target in item["targets"]
                                and item["profile"] == name
                                and ref["inventory"] == current,
                                "artifact_evidence_binding",
                            )
                            expected_refs = (
                                [item["build"]]
                                if capability == "build"
                                else [item["provenance"]]
                                if capability == "provenance"
                                else item["signing"]
                                if capability == "native_package_signing"
                                else [r["id"]]
                            )
                            require(r["id"] in expected_refs, "artifact_receipt_binding")
                            if capability == "native_package_signing":
                                signing_coverage.setdefault(
                                    (ref["inventory"], ref["artifact"]), set()
                                ).add(r["id"])
                            covered.add((ref["inventory"], ref["artifact"]))
                    require(needed <= covered, "artifact_evidence_coverage")
                    if capability == "native_package_signing":
                        for key in needed:
                            require(
                                bool(catalog[key][0]["signing"])
                                and set(catalog[key][0]["signing"])
                                <= signing_coverage.get(key, set()),
                                "signing_evidence_coverage",
                            )
            decisions.append(
                {
                    "target": target,
                    "profile": name,
                    "requested": target in selected,
                    "capabilities": capability_states,
                    "distribution_eligible": context.operation == "public" and target in selected,
                }
            )
    # Installed payload comparison is separate from the original installer digest.
    build_payloads = {
        r["id"]: r["details"]["payload_sha256"]
        for r, good in verified.values()
        if good and r["kind"] == "build"
    }
    for record, _ in verified.values():
        if record["kind"] != "native_runtime" or record["outcome"] != "passed":
            continue
        expected_payloads = {}
        for ref in record["artifacts"]:
            item, _ = reference(ref)
            require(item["build"] in build_payloads, "payload_build_missing")
            expected_payloads[item["id"]] = build_payloads[item["build"]]
        require(
            record["details"] == {"installed_payloads": expected_payloads},
            "installed_payload_binding",
        )
    report = {
        "schema_version": 1,
        "status": "admitted",
        "operation": context.operation,
        "subject": expected_subject,
        "inputs": expected,
        "scope": decisions,
        "publication_authorized": False,
    }
    payloads = tuple(
        (a["id"], a["sha256"], a["bytes"]) for (sid, _), (a, _) in catalog.items() if sid == current
    )
    return Admitted(_SEAL, canonical(report), payloads, context.operation)


_SEAL = object()


@dataclass(frozen=True)
class Admitted:
    """An in-process result, never a deserializable authorization from a JSON report."""

    _seal: object
    _report: bytes
    _payloads: tuple[tuple[str, str, int], ...]
    _operation: str

    def report(self):
        require(self._seal is _SEAL, "admission_binding")
        return json.loads(self._report)


def reconcile(capabilities, artifacts, cells, evidence, context, *, records):
    """Reconcile one bounded bundle using an independently supplied trusted caller.

    The caller supplies canonical evidence bytes keyed by their index digest.
    A producer cannot select or import the verification authority.
    """
    try:
        _, _, limits = configuration()
        require(
            isinstance(records, Mapping) and len(records) <= limits["evidence_records"],
            "evidence_bound",
        )
        docs = [
            decode(canonical(d), limits["document_bytes"])
            for d in (capabilities, artifacts, cells, evidence)
        ]
        return _reconcile(*docs, context, dict(records))
    except (
        OSError,
        KeyError,
        TypeError,
        AttributeError,
        IndexError,
        ValueError,
        RecursionError,
    ) as error:
        if isinstance(error, AdmissionError):
            raise
        raise AdmissionError("malformed_metadata") from None


def _load_bundle(directory):
    _, _, limits = configuration()
    names = ("capabilities.json", "artifacts.json", "cells.json", "evidence.json")
    docs, total = [], 0
    for name in names:
        data = read_bytes(directory / name, limits["document_bytes"])
        total += len(data)
        require(total <= limits["total_metadata_bytes"], "metadata_total")
        docs.append(decode(data, limits["document_bytes"]))
    require(type(docs[3]) is dict, "fields")
    references = docs[3].get("records")
    require(
        type(references) is list and len(references) <= limits["evidence_records"], "evidence_bound"
    )
    require(len(set(references)) == len(references), "evidence_index")
    records = {}
    for key in references:
        digest_id(key)
        data = read_bytes(directory / "records" / (key + ".json"), limits["evidence_record_bytes"])
        total += len(data)
        require(total <= limits["total_metadata_bytes"], "metadata_total")
        records[key] = data
    return docs, records


def load_bundle(directory):
    """Load fixed local inputs, converting malformed or unavailable input into refusal."""
    try:
        return _load_bundle(directory)
    except (
        OSError,
        KeyError,
        TypeError,
        AttributeError,
        IndexError,
        ValueError,
        RecursionError,
    ) as error:
        if isinstance(error, AdmissionError):
            raise
        raise AdmissionError("malformed_metadata") from None


def verify_payload(path, expected):
    """Verify original transferred installer bytes without unpacking or executing them."""
    require(isinstance(path, Path), "package_file")
    require(type(expected) is dict and {"bytes", "sha256"} <= set(expected), "package_identity")
    integer(expected["bytes"], 1)
    require(expected["bytes"] <= configuration()[2]["installer_bytes"], "package_bound")
    digest_id(expected["sha256"])
    require(not path.is_symlink(), "package_file")
    h, count = hashlib.sha256(), 0
    try:
        fd = os.open(
            path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        )
        with os.fdopen(fd, "rb") as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "package_file")
            while block := stream.read(65536):
                count += len(block)
                require(count <= expected["bytes"], "package_bytes")
                h.update(block)
    except OSError:
        raise AdmissionError("package_unavailable") from None
    require(count == expected["bytes"] and h.hexdigest() == expected["sha256"], "package_bytes")


def verify_uploads(admitted, uploads):
    """Verify reported uploaded bytes against the in-process admitted inventory only."""
    require(type(admitted) is Admitted and admitted._seal is _SEAL, "admission_binding")
    require(admitted._operation == "public", "upload_scope")
    expected = {key: (digest, size) for key, digest, size in admitted._payloads}
    require(type(uploads) is list and len(uploads) == len(expected), "upload_coverage")
    seen = set()
    for receipt in uploads:
        fields(receipt, "artifact sha256 bytes")
        key = identifier(receipt["artifact"])
        require(key in expected and key not in seen, "upload_identity")
        seen.add(key)
        require(
            type(receipt["bytes"]) is int
            and (receipt["sha256"], receipt["bytes"]) == expected[key],
            "upload_bytes",
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--subject-sha256", required=True)
    parser.add_argument("--now-ms", type=int, required=True)
    args = parser.parse_args()
    try:
        docs, records = load_bundle(args.directory)
        require(sha(docs[0]["subject"]) == args.subject_sha256, "expected_subject")
        targets, _, _ = configuration()
        context = Context(
            args.subject_sha256,
            sha(docs[0]),
            args.now_ms,
            tuple(t["id"] for t in targets["targets"] if t["native_required"]),
            "linux_qualification",
        )
        result = reconcile(*docs, context, records=records)
    except (
        AdmissionError,
        OSError,
        KeyError,
        AttributeError,
        TypeError,
        ValueError,
        RecursionError,
    ):
        # There is deliberately no CLI option to trust producer claims or import a verifier.
        print(
            json.dumps(
                {
                    "status": "denied",
                    "reason": "delivery_admission_refused",
                    "publication_authorized": False,
                }
            )
        )
        return 1
    print(json.dumps(result.report()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
