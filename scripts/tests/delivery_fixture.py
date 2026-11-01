"""Reusable synthetic consumer fixtures; these are never real qualification evidence."""

from __future__ import annotations

import copy
import hashlib
from dataclasses import replace
from pathlib import Path

import delivery_admission as admission

NOW = 10000


class Fixture:
    """Generate complete metadata without building, signing or running any installer."""

    def __init__(self, *, public=False, optional=(), universal=False):
        self.targets, self.policy, self.limits = admission.configuration()
        self.selected = tuple(
            t["id"] for t in self.targets["targets"] if t["native_required"]
        ) + tuple(optional)
        self.public = public
        self.subject = {
            "kind": "candidate" if public else "qualification",
            "id": "synthetic-current",
            "repository": "ohtia/ohtia",
            "application_version": "0.1.0" if public else "0.1.0-dev.101.1",
            "source_commit": "a" * 40,
            "source_tree": "b" * 40,
        }
        self.previous = {
            **self.subject,
            "id": "synthetic-baseline",
            "application_version": "0.0.9" if public else "0.1.0-dev.100.1",
            "source_commit": "c" * 40,
            "source_tree": "d" * 40,
        }
        current, old = [], []
        self.payloads = {}
        for target in self.targets["targets"]:
            if target["id"] not in self.selected:
                continue
            for profile, settings in admission.profiles(target, self.policy).items():
                for fmt in settings["formats"]:
                    aid = f"{target['id']}-{profile}-{fmt}"
                    payload = ("SYNTHETIC INSTALLER " + aid).encode()
                    self.payloads[aid] = payload
                    artifact = {
                        "id": aid,
                        "targets": [target["id"]],
                        "profile": profile,
                        "format": fmt,
                        "architecture": target["arch"],
                        "slices": [target["arch"]],
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "bytes": len(payload),
                        "native_version": "synthetic-" + self.subject["application_version"],
                        "build": "build-" + aid,
                        "provenance": "provenance-" + aid,
                        "signing": []
                        if settings["native_signing"] == "not_required"
                        or (target["os"] != "linux" and not public)
                        else ["sign-" + aid],
                    }
                    current.append(artifact)
                    if target["os"] == "linux" or public:
                        baseline = copy.deepcopy(artifact)
                        baseline.update(
                            sha256=admission.sha({"synthetic-baseline": aid}),
                            bytes=30,
                            native_version="synthetic-" + self.previous["application_version"],
                        )
                        old.append(baseline)
        if universal:
            for items in (current, old):
                for fmt in ("dmg", "zip"):
                    mac = [
                        a for a in items if a["profile"] == "macos-dmg-zip" and a["format"] == fmt
                    ]
                    if not mac:
                        continue
                    item = copy.deepcopy(mac[0])
                    aid = "darwin-universal-" + fmt
                    item.update(
                        id=aid,
                        targets=["darwin-x64", "darwin-arm64"],
                        architecture="universal",
                        slices=["arm64", "x64"],
                        build="build-" + aid,
                        provenance="provenance-" + aid,
                        signing=["sign-" + aid] if any(a["signing"] for a in mac) else [],
                    )
                    if items is current:
                        payload = ("SYNTHETIC INSTALLER " + aid).encode()
                        self.payloads[aid] = payload
                        item.update(sha256=hashlib.sha256(payload).hexdigest(), bytes=len(payload))
                        for previous in mac:
                            self.payloads.pop(previous["id"], None)
                    else:
                        item["sha256"] = admission.sha({"synthetic-baseline": aid})
                    items[:] = [a for a in items if a not in mac] + [item]
        self.artifacts = {
            "schema_version": 1,
            "subject": self.subject,
            "inventories": [
                {"subject": self.subject, "artifacts": current},
                {"subject": self.previous, "artifacts": old},
            ],
        }
        self.cells = {"schema_version": 1, "subject": self.subject, "cells": []}
        for cid, spec in admission.cell_specs(self.targets, set(self.selected)).items():
            settings = self.policy["profiles"][spec["profile"]]

            def find(items, fmt):
                return next(
                    a
                    for a in items
                    if spec["target"] in a["targets"]
                    and a["profile"] == spec["profile"]
                    and a["format"] == fmt
                )

            baselines = (
                [self.ref(find(old, settings["install"]), self.previous)]
                if spec["target"].startswith("linux-") or public
                else []
            )
            self.cells["cells"].append(
                {
                    "id": cid,
                    **spec,
                    "scenarios": list(self.policy["scenarios"]),
                    "assignments": {
                        "install": self.ref(find(current, settings["install"])),
                        "update": self.ref(find(current, settings["update"])),
                        "baselines": baselines,
                    },
                }
            )
        self.capabilities = {
            "schema_version": 1,
            "subject": self.subject,
            "inputs": {},
            "targets": [],
        }
        for target in self.targets["targets"]:
            groups = []
            for profile, settings in admission.profiles(target, self.policy).items():
                claims = {c: {"state": "unknown", "evidence": []} for c in admission.CAPABILITIES}
                if settings["native_signing"] == "not_required":
                    claims["native_package_signing"]["state"] = "not_required"
                elif target["os"] != "linux" and not public:
                    for cap in (
                        "native_package_signing",
                        "catalog_authentication",
                        "first_installation",
                        "installed_update",
                    ):
                        claims[cap]["state"] = "unavailable"
                groups.append(
                    {"profile": profile, "formats": settings["formats"], "capabilities": claims}
                )
            self.capabilities["targets"].append({"target": target["id"], "profiles": groups})
        self.records = {}
        self.objects = []
        for artifact in current:
            target, profile = artifact["targets"][0], artifact["profile"]
            settings = self.policy["profiles"][profile]
            kinds = ["build", "provenance"]
            if target.startswith("linux-") or public:
                kinds += ["catalog_authentication"]
                if settings["native_signing"] != "not_required":
                    kinds += ["native_package_signing"]
            for kind in kinds:
                rid = (
                    artifact["build"]
                    if kind == "build"
                    else artifact["provenance"]
                    if kind == "provenance"
                    else artifact["signing"][0]
                    if kind == "native_package_signing"
                    else "catalog-" + artifact["id"]
                )
                details = (
                    {"inputs_sha256": "e" * 64, "payload_sha256": self.payload_digest(artifact)}
                    if kind == "build"
                    else {"mechanism": "github-artifact-attestation"}
                    if kind == "provenance"
                    else {
                        "mechanism": "ed25519"
                        if kind == "catalog_authentication"
                        else settings["native_signing"],
                        "authority": "f" * 64,
                        "signer": "0" * 64,
                    }
                )
                self.add(
                    self.record(rid, kind, target, profile, [self.ref(artifact)], details=details)
                )
        if universal:
            for kind in admission.CAPABILITIES:
                if kind not in self.policy["capability_scenarios"]:
                    self.claim("darwin-arm64", "macos-dmg-zip", kind).update(
                        copy.deepcopy(self.claim("darwin-x64", "macos-dmg-zip", kind))
                    )
        for cell in self.cells["cells"]:
            for kind, scenarios in self.policy["capability_scenarios"].items():
                if (
                    kind != "native_runtime"
                    and not cell["target"].startswith("linux-")
                    and not public
                ):
                    continue
                for scenario in scenarios:
                    combos = (
                        cell["assignments"]["baselines"]
                        if "baseline" in self.policy["scenarios"][scenario]
                        else [None]
                    )
                    for index, baseline in enumerate(combos):
                        refs = [
                            baseline if role == "baseline" else cell["assignments"][role]
                            for role in self.policy["scenarios"][scenario]
                        ]
                        refs = list({admission.canonical(r): r for r in refs}.values())
                        observed = {
                            **{
                                k: cell[k]
                                for k in (
                                    "target",
                                    "profile",
                                    "os_profile",
                                    "os_version",
                                    "filesystem",
                                    "security",
                                    "display",
                                )
                            },
                            "native": True,
                            "ordinary_user": True,
                            "graphical_session": True,
                            "architecture": cell["target"].split("-")[1],
                            "process_architecture": cell["target"].split("-")[1],
                            "addon_architecture": cell["target"].split("-")[1],
                        }
                        details = (
                            {
                                "installed_payloads": {
                                    r["artifact"]: self.payload_digest(
                                        next(a for a in current if a["id"] == r["artifact"])
                                    )
                                    for r in refs
                                }
                            }
                            if kind == "native_runtime"
                            else {"synthetic": True}
                        )
                        self.add(
                            self.record(
                                f"{scenario.replace('_', '-')}-{cell['id']}-{index}",
                                kind,
                                cell["target"],
                                cell["profile"],
                                refs,
                                cell=cell["id"],
                                scenarios=[scenario],
                                observed=observed,
                                details=details,
                            )
                        )
        self.refresh()

    def payload_digest(self, artifact):
        return admission.sha(
            {"synthetic-installed-payload": artifact["targets"], "profile": artifact["profile"]}
        )

    def ref(self, artifact, subject=None):
        return {
            "inventory": admission.sha(subject or self.subject),
            "artifact": artifact["id"],
            "sha256": artifact["sha256"],
            "bytes": artifact["bytes"],
        }

    def claim(self, target, profile, kind):
        return next(
            g
            for e in self.capabilities["targets"]
            if e["target"] == target
            for g in e["profiles"]
            if g["profile"] == profile
        )["capabilities"][kind]

    def record(
        self,
        rid,
        kind,
        target,
        profile,
        refs,
        *,
        cell=None,
        scenarios=None,
        observed=None,
        details=None,
    ):
        return {
            "id": rid,
            "kind": kind,
            "subject": self.subject,
            "target": target,
            "profile": profile,
            "artifacts": refs,
            "cell": cell,
            "scenarios": scenarios or [],
            "execution": {
                "workflow": ".github/workflows/synthetic-fixture.yml",
                "workflow_sha": "a" * 40,
                "run_id": 102 if cell is not None else 101,
                "attempt": 1,
                "job_id": (
                    2000 + list(admission.cell_specs(self.targets, set(self.selected))).index(cell)
                )
                if cell is not None
                else 1000
                + next(i for i, t in enumerate(self.targets["targets"]) if t["id"] == target),
                "invocation": "synthetic-native-1" if cell is not None else "synthetic-build-1",
            },
            "observed": observed,
            "outcome": "passed",
            "observed_at_ms": NOW - 100,
            "expires_at_ms": NOW + 100,
            "proof_sha256": admission.sha({"synthetic-proof": rid}),
            "details": details or {},
        }

    def add(self, record, *, claim=True):
        self.objects.append(record)
        if claim:
            value = self.claim(record["target"], record["profile"], record["kind"])
            value["state"] = "passed"
            value["evidence"].append(admission.sha(record))

    def refresh(self):
        """Recompute metadata references, without implicitly approving altered evidence."""
        self.records = {admission.sha(r): admission.canonical(r) for r in self.objects}
        self.evidence = {
            "schema_version": 1,
            "subject": self.subject,
            "records": list(self.records),
        }
        self.capabilities["inputs"] = {
            "target_policy": admission.sha(self.targets),
            "capability_policy": admission.policy_digest(self.targets, self.policy, self.limits),
            "artifact_inventory": admission.sha(self.artifacts),
            "cell_inventory": admission.sha(self.cells),
            "evidence_inventory": admission.sha(self.evidence),
        }

    def mutate_record(self, record, update):
        before = admission.sha(record)
        update(record)
        after = admission.sha(record)
        for entry in self.capabilities["targets"]:
            for group in entry["profiles"]:
                for value in group["capabilities"].values():
                    value["evidence"] = [after if d == before else d for d in value["evidence"]]
        self.refresh()

    def context(self, **changes):
        """Snapshot an explicitly synthetic authority outside the untrusted bundle."""
        allowed = frozenset(self.records)
        context = admission.Context(
            admission.sha(self.subject),
            admission.sha(self.capabilities),
            NOW,
            self.selected,
            "public" if self.public else "linux_qualification",
            lambda r, data: hashlib.sha256(data).hexdigest() in allowed,
            baseline_inventories=frozenset(
                admission.sha(i) for i in self.artifacts["inventories"][1:]
            ),
            baseline_requirements=tuple(
                (
                    cell["id"],
                    tuple(
                        sorted(
                            {
                                admission.sha(inventory)
                                for ref in cell["assignments"]["baselines"]
                                for inventory in self.artifacts["inventories"]
                                if admission.sha(inventory["subject"]) == ref["inventory"]
                            }
                        )
                    ),
                )
                for cell in self.cells["cells"]
            ),
        )
        return replace(context, **changes)

    def admit(self, context=None):
        return admission.reconcile(
            self.capabilities,
            self.artifacts,
            self.cells,
            self.evidence,
            context or self.context(),
            records=self.records,
        )

    def write(self, directory: Path):
        for name, value in zip(
            ("capabilities", "artifacts", "cells", "evidence"),
            (self.capabilities, self.artifacts, self.cells, self.evidence),
            strict=True,
        ):
            (directory / (name + ".json")).write_bytes(admission.canonical(value))
        (directory / "records").mkdir(exist_ok=True)
        for digest, data in self.records.items():
            (directory / "records" / (digest + ".json")).write_bytes(data)
