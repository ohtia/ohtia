"""Verify the shared delivery contract using explicitly synthetic evidence authorities."""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import delivery_admission as admission
from delivery_fixture import NOW, Fixture


class AdmissionTests(unittest.TestCase):
    def denied(self, fixture, code, context=None):
        with self.assertRaisesRegex(admission.AdmissionError, "^" + code + "$"):
            fixture.admit(context)

    def test_same_sealed_deb_covers_independent_x11_wayland_and_arm_cells(self):
        f = Fixture()
        self.assertEqual(f.admit().report()["status"], "admitted")
        self.assertEqual(len(f.cells["cells"]), 13)
        for target in ("linux-x64", "linux-arm64"):
            cells = [
                c
                for c in f.cells["cells"]
                if c["target"] == target and c["os_profile"] == "ubuntu-24.04"
            ]
            self.assertEqual({c["display"] for c in cells}, {"x11", "wayland"})
            self.assertEqual(cells[0]["assignments"]["install"], cells[1]["assignments"]["install"])
        self.assertNotEqual(
            f.cells["cells"][0]["assignments"]["install"]["sha256"],
            f.cells["cells"][5]["assignments"]["install"]["sha256"],
        )
        self.assertFalse(f.admit().report()["publication_authorized"])

    def test_deferred_publisher_capabilities_do_not_block_common_linux(self):
        report = Fixture().admit().report()
        windows = next(s for s in report["scope"] if s["target"] == "win32-x64")
        self.assertEqual(windows["capabilities"]["native_runtime"], "passed")
        self.assertEqual(windows["capabilities"]["native_package_signing"], "unavailable")

    def test_complete_public_fixture_uses_dmg_install_zip_update_and_distinct_baseline(self):
        f = Fixture(public=True)
        self.assertEqual(f.admit().report()["operation"], "public")
        mac = next(c for c in f.cells["cells"] if c["target"] == "darwin-arm64")
        self.assertTrue(mac["assignments"]["install"]["artifact"].endswith("-dmg"))
        self.assertTrue(mac["assignments"]["update"]["artifact"].endswith("-zip"))
        self.assertNotEqual(
            mac["assignments"]["update"]["inventory"],
            mac["assignments"]["baselines"][0]["inventory"],
        )

    def test_no_authority_or_unreadable_authority_cannot_admit_self_asserted_success(self):
        f = Fixture()
        for verifier in (None, lambda r, b: False, lambda r, b: "true"):
            self.denied(f, "capability_unqualified", f.context(verify_evidence=verifier))

        def unavailable(record, data):
            raise OSError("synthetic authority unavailable")

        self.denied(f, "capability_unqualified", f.context(verify_evidence=unavailable))

    def test_expected_manifest_prevents_omitted_failed_history(self):
        f = Fixture()
        failed = copy.deepcopy(f.objects[0])
        failed.update(id="synthetic-failed-attempt", outcome="failed")
        f.add(failed, claim=False)
        f.refresh()
        context = f.context()
        self.assertEqual(f.admit(context).report()["status"], "admitted")
        f.objects.remove(failed)
        f.refresh()
        self.denied(f, "expected_manifest", context)

    def test_successful_retry_retains_failed_attempt_without_using_it_as_success(self):
        f = Fixture()
        original = next(r for r in f.objects if r["kind"] == "native_runtime")
        retry = copy.deepcopy(original)
        f.mutate_record(original, lambda r: r.update(outcome="failed"))
        f.claim(original["target"], original["profile"], original["kind"])["evidence"].remove(
            admission.sha(original)
        )
        retry["id"] = "synthetic-successful-retry"
        retry["execution"]["attempt"] = 2
        retry["execution"]["job_id"] += 10000
        retry["execution"]["invocation"] = "synthetic-native-retry"
        f.add(retry)
        f.refresh()
        self.assertEqual(f.admit().report()["status"], "admitted")
        self.assertIn(admission.sha(original), f.evidence["records"])

    def test_wrong_source_or_candidate_is_refused(self):
        for field, value in (
            ("source_commit", "f" * 40),
            ("source_tree", "f" * 40),
            ("id", "another-candidate"),
        ):
            with self.subTest(field=field):
                f = Fixture()
                ctx = f.context()
                f.subject[field] = value
                self.denied(f, "expected_subject", ctx)

    def test_quality_and_wrong_operation_subjects_are_refused(self):
        f = Fixture()
        f.subject["kind"] = "quality"
        self.denied(f, "quality_not_qualification")
        f = Fixture()
        self.denied(f, "public_subject", f.context(operation="candidate"))
        self.denied(f, "public_subject", f.context(operation="public"))

        f = Fixture(public=True)
        f.subject["application_version"] = "0.1.0-dev.101.1"
        f.refresh()
        self.denied(f, "subject_version_class")

    def test_required_platforms_cannot_be_omitted_or_repeated(self):
        f = Fixture()
        self.denied(
            f, "required_target_scope", f.context(selected_targets=("linux-x64", "linux-arm64"))
        )
        self.denied(f, "requested_targets", f.context(selected_targets=f.selected + ("linux-x64",)))
        f.capabilities["targets"].pop()
        f.refresh()
        self.denied(f, "target_declaration")

    def test_optional_targets_remain_explicit_and_require_full_native_cells_when_selected(self):
        f = Fixture()
        self.assertEqual(
            next(s for s in f.admit().report()["scope"] if s["target"] == "darwin-x64")[
                "requested"
            ],
            False,
        )
        f = Fixture(optional=("darwin-x64", "win32-arm64"))
        self.assertEqual(len(f.cells["cells"]), 16)
        f.admit()
        context = f.context()
        f.cells["cells"].pop()
        f.refresh()
        self.denied(
            f,
            "cell_coverage",
            replace(context, expected_manifest_sha256=admission.sha(f.capabilities)),
        )

    def test_universal_output_requires_both_cpu_slices_and_independent_native_evidence(self):
        f = Fixture(public=True, optional=("darwin-x64",), universal=True)
        f.admit()
        for artifact in f.artifacts["inventories"][0]["artifacts"]:
            payload = f.payloads[artifact["id"]]
            self.assertEqual(admission.hashlib.sha256(payload).hexdigest(), artifact["sha256"])
            self.assertEqual(len(payload), artifact["bytes"])
        cell = next(c for c in f.cells["cells"] if c["target"] == "darwin-x64")
        record = next(
            r for r in f.objects if r["kind"] == "native_runtime" and r["cell"] == cell["id"]
        )
        f.mutate_record(record, lambda r: r["observed"].update(architecture="arm64"))
        self.denied(f, "native_environment")
        f = Fixture(optional=("darwin-x64",), universal=True)
        artifact = next(
            a
            for a in f.artifacts["inventories"][0]["artifacts"]
            if a["architecture"] == "universal"
        )
        artifact["slices"] = ["arm64"]
        f.refresh()
        self.denied(f, "artifact_slices")

    def test_missing_duplicate_or_foreign_cell_cannot_fill_coverage(self):
        for mutation, code in (
            (lambda cells: cells.pop(), "cell_coverage"),
            (lambda cells: cells.append(copy.deepcopy(cells[0])), "cell_identity"),
            (lambda cells: cells[0].update(id="foreign-cell"), "cell_identity"),
        ):
            with self.subTest(code=code):
                f = Fixture()
                context = f.context()
                mutation(f.cells["cells"])
                f.refresh()
                self.denied(
                    f,
                    code,
                    replace(context, expected_manifest_sha256=admission.sha(f.capabilities)),
                )

    def test_x11_p_wayland_q_is_refused_even_with_same_source_version_and_format(self):
        f = Fixture()
        original = f.artifacts["inventories"][0]["artifacts"][0]
        replacement = copy.deepcopy(original)
        replacement.update(id="same-version-rebuilt", sha256="1" * 64)
        f.artifacts["inventories"][0]["artifacts"].append(replacement)
        cell = next(
            c
            for c in f.cells["cells"]
            if c["target"] == original["targets"][0] and c["display"] == "x11"
        )
        cell["assignments"].update(install=f.ref(replacement), update=f.ref(replacement))
        f.refresh()
        self.denied(f, "session_package_substitution")

    def test_wrong_transferred_digest_or_length_is_refused_in_assignment(self):
        for field, value in (("sha256", "1" * 64), ("bytes", 1), ("bytes", True)):
            with self.subTest(field=field, value=value):
                f = Fixture()
                f.cells["cells"][0]["assignments"]["install"][field] = value
                f.refresh()
                self.denied(f, "artifact_bytes")

    def test_duplicate_artifact_and_extra_unassigned_artifact_are_refused(self):
        f = Fixture()
        items = f.artifacts["inventories"][0]["artifacts"]
        items.append(copy.deepcopy(items[0]))
        f.refresh()
        self.denied(f, "duplicate_artifact")
        items[-1]["id"] = "unassigned-package"
        items[-1]["sha256"] = "e" * 64
        f.refresh()
        self.denied(f, "unassigned_artifact")

    def test_ubuntu_and_debian_policy_profiles_are_not_interchangeable(self):
        f = Fixture()
        ubuntu = f.cells["cells"][0]["assignments"]["install"]
        debian = next(
            c
            for c in f.cells["cells"]
            if c["target"] == "linux-x64" and c["profile"] == "debian-deb"
        )
        debian["assignments"]["install"] = ubuntu
        f.refresh()
        self.denied(f, "artifact_assignment")

    def test_baseline_requires_independent_inventory_authority_and_older_version(self):
        f = Fixture()
        self.denied(f, "baseline_authority", f.context(baseline_inventories=frozenset()))
        f = Fixture()
        context = f.context()
        f.cells["cells"][0]["assignments"]["baselines"] = [
            f.cells["cells"][0]["assignments"]["install"]
        ]
        f.refresh()
        self.denied(
            f,
            "baseline_identity",
            replace(context, expected_manifest_sha256=admission.sha(f.capabilities)),
        )
        f = Fixture()
        f.cells["cells"][0]["assignments"]["baselines"] = []
        f.refresh()
        self.denied(f, "baseline_missing")

    def test_wrong_environment_account_cpu_backend_and_sandbox_are_refused(self):
        for field, value in (
            ("native", False),
            ("ordinary_user", False),
            ("ordinary_user", 1),
            ("graphical_session", False),
            ("architecture", "x64"),
            ("process_architecture", "x64"),
            ("addon_architecture", "x64"),
            ("display", "x11"),
            ("security", "disabled"),
            ("filesystem", "nfs"),
            ("os_version", "12"),
        ):
            with self.subTest(field=field):
                f = Fixture()
                record = next(
                    r
                    for r in f.objects
                    if r["kind"] == "native_runtime"
                    and r["target"] == "linux-arm64"
                    and r["observed"]["display"] == "wayland"
                )
                f.mutate_record(record, lambda r: r["observed"].update({field: value}))
                self.denied(f, "native_environment")

    def test_required_scenario_and_cell_evidence_cannot_be_reused_elsewhere(self):
        f = Fixture()
        r = next(r for r in f.objects if r["kind"] == "first_installation")
        f.claim(r["target"], r["profile"], r["kind"])["evidence"].remove(admission.sha(r))
        self.denied(f, "scenario_coverage")
        f = Fixture()
        r = next(r for r in f.objects if r["kind"] == "native_runtime")
        f.mutate_record(r, lambda r: r.update(cell="another-cell"))
        self.denied(f, "native_cell")

    def test_evidence_for_another_artifact_profile_or_subject_is_refused(self):
        for mutation, code in (
            (
                lambda r: r.update(
                    artifacts=[
                        {
                            "inventory": "0" * 64,
                            "artifact": "missing",
                            "sha256": "0" * 64,
                            "bytes": 1,
                        }
                    ]
                ),
                "artifact_missing",
            ),
            (lambda r: r.update(profile="debian-deb"), "artifact_receipt_binding"),
            (lambda r: r.update(subject={**r["subject"], "id": "foreign"}), "evidence_subject"),
        ):
            with self.subTest(code=code):
                f = Fixture()
                f.mutate_record(f.objects[0], mutation)
                self.denied(f, code)

    def test_wrong_run_attempt_workflow_revision_cannot_reuse_trusted_receipt(self):
        for field, value in (
            ("run_id", 999),
            ("attempt", 2),
            ("workflow_sha", "f" * 40),
            ("workflow", ".github/workflows/other.yml"),
        ):
            with self.subTest(field=field):
                f = Fixture()
                context = f.context()
                record = next(r for r in f.objects if r["kind"] == "native_runtime")
                job = record["execution"]["job_id"]
                for member in list(f.objects):
                    if member["execution"]["job_id"] == job:
                        f.mutate_record(member, lambda r: r["execution"].update({field: value}))
                context = replace(context, expected_manifest_sha256=admission.sha(f.capabilities))
                self.denied(f, "capability_unqualified", context)

        f = Fixture()
        context = f.context()
        f.mutate_record(f.objects[0], lambda r: r.update(proof_sha256="f" * 64))
        self.denied(
            f,
            "capability_unqualified",
            replace(context, expected_manifest_sha256=admission.sha(f.capabilities)),
        )

    def test_stale_future_revoked_failed_cancelled_skipped_and_unknown_results_deny(self):
        for change in (
            {"expires_at_ms": NOW},
            {"observed_at_ms": NOW + 1},
            {"outcome": "failed"},
            {"outcome": "cancelled"},
            {"outcome": "skipped"},
            {"outcome": "unknown"},
        ):
            with self.subTest(change=change):
                f = Fixture()
                f.mutate_record(f.objects[0], lambda r: r.update(change))
                self.denied(f, "capability_unqualified")
        f = Fixture()
        self.denied(
            f, "capability_unqualified", f.context(revoked=frozenset([admission.sha(f.objects[0])]))
        )

    def test_unknown_unavailable_failed_expired_and_revoked_required_claims_deny(self):
        for state in ("unknown", "unavailable", "failed", "expired", "revoked"):
            with self.subTest(state=state):
                f = Fixture()
                f.claim("linux-x64", "ubuntu-deb", "build")["state"] = state
                self.denied(f, "capability_unqualified")

    def test_deb_native_signing_waiver_never_waives_catalog_authentication(self):
        f = Fixture()
        f.claim("linux-x64", "ubuntu-deb", "catalog_authentication").update(
            state="not_required", evidence=[]
        )
        self.denied(f, "invalid_waiver")
        f = Fixture()
        f.claim("linux-x64", "fedora-rpm", "native_package_signing").update(
            state="not_required", evidence=[]
        )
        self.denied(f, "invalid_waiver")

    def test_catalog_rpm_and_attestation_mechanisms_are_distinct(self):
        for kind in ("catalog_authentication", "native_package_signing", "provenance"):
            with self.subTest(kind=kind):
                f = Fixture()
                r = next(r for r in f.objects if r["kind"] == kind)
                f.mutate_record(r, lambda r: r["details"].update(mechanism="self-asserted"))
                self.denied(
                    f,
                    {
                        "catalog_authentication": "catalog_mechanism",
                        "native_package_signing": "signing_mechanism",
                        "provenance": "provenance_mechanism",
                    }[kind],
                )

    def test_installed_payload_hash_is_not_the_installer_hash(self):
        f = Fixture()
        r = next(r for r in f.objects if r["kind"] == "native_runtime")
        key = r["artifacts"][0]["artifact"]
        f.mutate_record(
            r,
            lambda r: r["details"]["installed_payloads"].update({key: r["artifacts"][0]["sha256"]}),
        )
        self.denied(f, "installed_payload_binding")

    def test_policy_change_invalidates_previously_bound_inputs(self):
        f = Fixture()
        targets, policy, limits = admission.configuration()
        policy["owner"] = "another-policy"
        with patch.object(admission, "configuration", return_value=(targets, policy, limits)):
            self.denied(f, "input_binding")

    def test_record_digest_index_duplicates_and_unknown_fields_are_refused(self):
        f = Fixture()
        key = next(iter(f.records))
        f.records[key] += b" "
        self.denied(f, "representation")
        f = Fixture()
        f.evidence["records"].append(f.evidence["records"][0])
        f.capabilities["inputs"]["evidence_inventory"] = admission.sha(f.evidence)
        self.denied(f, "evidence_index")
        f = Fixture()
        f.cells["cells"][0]["ignored"] = True
        f.refresh()
        self.denied(f, "fields")
        f = Fixture()
        f.mutate_record(f.objects[0], lambda r: r.update(id=f.objects[1]["id"]))
        self.denied(f, "duplicate_evidence_id")

    def test_canonical_json_rejects_duplicates_floats_bom_and_noncanonical_whitespace(self):
        for data in (
            b'{"a":1,"a":2}\n',
            b'{"a":1.0}\n',
            b'{"a":NaN}\n',
            b"\xef\xbb\xbf{}\n",
            b"{ }\n",
            b"{}",
            b'{"b":1,"a":2}\n',
        ):
            with self.subTest(data=data), self.assertRaises(admission.AdmissionError):
                admission.decode(data, 100)
        self.assertEqual(admission.decode(b'{"a":true}\n', 100), {"a": True})
        with self.assertRaises(admission.AdmissionError):
            admission.integer(True)

    def test_documents_records_and_aggregate_metadata_have_separate_finite_bounds(self):
        f = Fixture()
        targets, policy, limits = admission.configuration()
        for name, value, code in (
            ("document_bytes", 100, "metadata_bound"),
            ("total_metadata_bytes", 100, "metadata_total"),
            ("version_inventories", 1, "inventory_bound"),
            ("artifacts_per_inventory", 1, "artifact_bound"),
            ("cells", 1, "cell_bound"),
            ("evidence_records", 1, "evidence_bound"),
            ("evidence_record_bytes", 100, "metadata_bound"),
            ("installer_bytes", 1, "package_bound"),
        ):
            with (
                self.subTest(limit=name),
                patch.object(
                    admission,
                    "configuration",
                    return_value=(targets, policy, {**limits, name: value}),
                ),
            ):
                # Limits are independently trusted policy, so bind the fixture to that test policy.
                f.capabilities["inputs"]["capability_policy"] = admission.policy_digest(
                    targets, policy, {**limits, name: value}
                )
                self.denied(f, code)

        f = Fixture()
        context = f.context()
        maximum = f.limits["evidence_records"]

        class OverLimit(Mapping):
            def __len__(self):
                return maximum + 1

            def __iter__(self):
                raise AssertionError("Must refuse before materializing records")

            def __getitem__(self, key):
                raise KeyError(key)

        f.records = OverLimit()
        self.denied(f, "evidence_bound", context)

    def test_evidence_record_may_exceed_document_bound_but_not_its_own_bound(self):
        f = Fixture()
        extra = copy.deepcopy(next(r for r in f.objects if r["kind"] == "first_installation"))
        extra.update(
            id="synthetic-large-diagnostic",
            outcome="failed",
            details={"padding": "x" * f.limits["document_bytes"]},
        )
        extra["execution"]["invocation"] = "synthetic-diagnostic-attempt"
        f.add(extra, claim=False)
        f.refresh()
        f.admit()
        extra["details"]["padding"] = "x" * f.limits["evidence_record_bytes"]
        f.refresh()
        self.denied(f, "metadata_bound")

    def test_loader_uses_only_fixed_bounded_files_and_refuses_symlink_or_missing_record(self):
        f = Fixture()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            f.write(root)
            docs, records = admission.load_bundle(root)
            admission.reconcile(*docs, f.context(), records=records)
            key = next(iter(records))
            file = root / "records" / (key + ".json")
            file.unlink()
            with self.assertRaisesRegex(admission.AdmissionError, "metadata_unavailable"):
                admission.load_bundle(root)
            if os.name == "posix":
                file.symlink_to(root / "capabilities.json")
                with self.assertRaisesRegex(admission.AdmissionError, "metadata_file"):
                    admission.load_bundle(root)

    def test_leaf_fifo_is_refused_without_blocking_and_payloads_are_streamed(self):
        f = Fixture()
        artifact = f.artifacts["inventories"][0]["artifacts"][0]
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "installer"
            file.write_bytes(f.payloads[artifact["id"]])
            admission.verify_payload(file, artifact)
            with self.assertRaisesRegex(admission.AdmissionError, "package_identity"):
                admission.verify_payload(file, {})
            file.write_bytes(b"changed")
            with self.assertRaisesRegex(admission.AdmissionError, "package_bytes"):
                admission.verify_payload(file, artifact)
            if os.name == "posix":
                file.unlink()
                os.mkfifo(file)
                with self.assertRaisesRegex(admission.AdmissionError, "package_file"):
                    admission.verify_payload(file, artifact)
                with self.assertRaisesRegex(admission.AdmissionError, "metadata_file"):
                    admission.read_bytes(file, 100)

    def test_uploaded_bytes_are_compared_to_immutable_admitted_inventory(self):
        f = Fixture(public=True)
        admitted = f.admit()
        uploads = [
            {"artifact": a["id"], "sha256": a["sha256"], "bytes": a["bytes"]}
            for a in f.artifacts["inventories"][0]["artifacts"]
        ]
        admission.verify_uploads(admitted, uploads)
        report = admitted.report()
        report["inputs"]["artifact_inventory"] = "0" * 64
        admission.verify_uploads(admitted, uploads)
        for code, malformed in (
            ("upload_coverage", uploads[:-1]),
            ("upload_identity", [uploads[0]] * len(uploads)),
            ("upload_bytes", [{**uploads[0], "bytes": 1}, *uploads[1:]]),
        ):
            with (
                self.subTest(upload_error=code),
                self.assertRaisesRegex(admission.AdmissionError, code),
            ):
                admission.verify_uploads(admitted, malformed)
        malformed = copy.deepcopy(uploads)
        malformed[0]["artifact"] = []
        with self.assertRaisesRegex(admission.AdmissionError, "identifier"):
            admission.verify_uploads(admitted, malformed)
        uploads[0]["sha256"] = "1" * 64
        with self.assertRaisesRegex(admission.AdmissionError, "upload_bytes"):
            admission.verify_uploads(admitted, uploads)
        for fake in (report, admission.Admitted(object(), b"{}", (), "public")):
            with self.assertRaisesRegex(admission.AdmissionError, "admission_binding"):
                admission.verify_uploads(fake, uploads)
        with self.assertRaisesRegex(admission.AdmissionError, "upload_scope"):
            admission.verify_uploads(Fixture().admit(), [])

    def test_public_admission_requires_every_platform_publisher_capability(self):
        for target, profile in (("win32-x64", "windows-nsis"), ("darwin-arm64", "macos-dmg-zip")):
            for kind in (
                "catalog_authentication",
                "native_package_signing",
                "first_installation",
                "installed_update",
            ):
                with self.subTest(target=target, kind=kind):
                    f = Fixture(public=True)
                    f.claim(target, profile, kind)["state"] = "unavailable"
                    self.denied(f, "capability_unqualified")

    def test_cli_never_imports_or_trusts_producer_authority(self):
        f = Fixture()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            f.write(root)
            result = subprocess.run(
                [
                    sys.executable,
                    str(admission.ROOT / "scripts/delivery_admission.py"),
                    str(root),
                    "--subject-sha256",
                    admission.sha(f.subject),
                    "--now-ms",
                    str(NOW),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(
                json.loads(result.stdout),
                {
                    "status": "denied",
                    "reason": "delivery_admission_refused",
                    "publication_authorized": False,
                },
            )
            self.assertNotIn(temp, result.stdout + result.stderr)
            (root / "evidence.json").write_bytes(admission.canonical({"records": [[]]}))
            with self.assertRaisesRegex(admission.AdmissionError, "malformed_metadata"):
                admission.load_bundle(root)

    def test_update_only_substitution_cannot_split_the_sealed_package(self):
        f = Fixture()
        original = f.artifacts["inventories"][0]["artifacts"][0]
        other = {**copy.deepcopy(original), "id": "different-update-bytes", "sha256": "1" * 64}
        f.artifacts["inventories"][0]["artifacts"].append(other)
        cell = next(
            c for c in f.cells["cells"] if c["target"] == "linux-x64" and c["display"] == "x11"
        )
        cell["assignments"]["update"] = f.ref(other)
        f.refresh()
        self.denied(f, "artifact_role_substitution")

    def test_passed_deferred_update_requires_nonempty_baseline_coverage(self):
        f = Fixture()
        r = copy.deepcopy(
            next(
                r
                for r in f.objects
                if r["kind"] == "native_runtime" and r["target"] == "darwin-arm64"
            )
        )
        r.update(
            id="deferred-update-without-baseline",
            kind="installed_update",
            scenarios=["compatibility_denial"],
        )
        f.add(r)
        f.refresh()
        self.denied(f, "native_artifact_assignment")

    def test_job_identity_separates_builds_cells_and_development_versions(self):
        f = Fixture()
        r = next(r for r in f.objects if r["kind"] == "native_runtime")
        build = next(r for r in f.objects if r["kind"] == "build")
        f.mutate_record(
            r,
            lambda r: r["execution"].update(
                {k: build["execution"][k] for k in ("run_id", "attempt", "job_id")}
            ),
        )
        self.denied(f, "producer_test_separation")
        f = Fixture()
        f.mutate_record(f.objects[0], lambda r: r["execution"].update(run_id=999))
        self.denied(f, "development_build_identity")
        f = Fixture()
        records = [r for r in f.objects if r["kind"] == "native_runtime"]
        f.mutate_record(
            records[1], lambda r: r["execution"].update(job_id=records[0]["execution"]["job_id"])
        )
        self.denied(f, "native_job_cell")
        f = Fixture()
        for record in list(f.objects):
            if record["cell"] is not None:
                f.mutate_record(record, lambda r: r["execution"].update(run_id=101))
        f.admit()  # Separate build/native jobs may share one workflow run.

    def test_retry_changes_invocation_without_inventing_workflow_attempt(self):
        f = Fixture()
        original = next(r for r in f.objects if r["kind"] == "native_runtime")
        retry = copy.deepcopy(original)
        f.mutate_record(original, lambda r: r.update(outcome="failed"))
        f.claim(original["target"], original["profile"], original["kind"])["evidence"].remove(
            admission.sha(original)
        )
        retry["id"] = "same-job-native-retry"
        f.add(retry)
        f.refresh()
        self.denied(f, "duplicate_native_execution")
        f.mutate_record(retry, lambda r: r["execution"].update(invocation="native-retry-2"))
        f.admit()
        self.assertEqual(original["execution"]["run_id"], retry["execution"]["run_id"])
        self.assertEqual(original["execution"]["attempt"], retry["execution"]["attempt"])
        self.assertEqual(original["proof_sha256"], retry["proof_sha256"])

    def test_package_digests_cannot_alias_formats_architectures_profiles_or_versions(self):
        for domain in ("format", "cpu", "profile", "version"):
            with self.subTest(domain=domain):
                f = Fixture(public=True)
                items = f.artifacts["inventories"][0]["artifacts"]
                first = items[0]
                if domain == "format":
                    first = next(a for a in items if a["format"] == "dmg")
                    second = next(a for a in items if a["format"] == "zip")
                elif domain == "cpu":
                    second = next(a for a in items if a["targets"] == ["linux-arm64"])
                elif domain == "profile":
                    second = next(
                        a
                        for a in items
                        if a["profile"] == "debian-deb" and a["targets"] == ["linux-x64"]
                    )
                else:
                    second = f.artifacts["inventories"][1]["artifacts"][0]
                second["sha256"] = first["sha256"]
                f.refresh()
                self.denied(f, "artifact_digest_reuse")

    def test_required_baseline_policy_cannot_be_reduced_by_the_producer(self):
        f = Fixture(public=True)
        older = copy.deepcopy(f.artifacts["inventories"][1])
        older["subject"] = {
            **older["subject"],
            "id": "older-supported-version",
            "application_version": "0.0.8",
        }
        for artifact in older["artifacts"]:
            artifact.update(
                sha256=admission.sha({"older-baseline": artifact["id"]}),
                native_version="synthetic-0.0.8",
            )
        f.artifacts["inventories"].append(older)
        f.refresh()
        f.admit()  # Authorized inventories may exceed the explicitly required scope.
        context = f.context()
        required = tuple(
            (cid, values + (admission.sha(older),)) for cid, values in context.baseline_requirements
        )
        context = replace(context, baseline_requirements=required)
        self.denied(f, "baseline_coverage", context)
        f.artifacts["inventories"].remove(older)
        f.refresh()
        self.denied(
            f,
            "baseline_coverage",
            replace(context, expected_manifest_sha256=admission.sha(f.capabilities)),
        )

    def test_macos_baseline_records_the_package_that_established_the_old_installation(self):
        f = Fixture(public=True)
        mac = next(c for c in f.cells["cells"] if c["target"] == "darwin-arm64")
        self.assertTrue(mac["assignments"]["baselines"][0]["artifact"].endswith("-dmg"))
        f.admit()
        previous_zip = next(
            a for a in f.artifacts["inventories"][1]["artifacts"] if a["format"] == "zip"
        )
        ref = f.ref(previous_zip, f.previous)
        for cell in f.cells["cells"]:
            if cell["target"] == "darwin-arm64":
                cell["assignments"]["baselines"] = [ref]
        for record in list(f.objects):
            if record["target"] == "darwin-arm64" and record["kind"] == "installed_update":
                f.mutate_record(record, lambda r: r["artifacts"].__setitem__(0, ref))
        f.refresh()
        f.admit()  # A prior ZIP update may legitimately have established the baseline too.

    def test_subject_and_public_baseline_version_classes_are_explicit(self):
        f = Fixture()
        f.subject["application_version"] = "1.0.0"
        self.denied(f, "subject_version_class")
        f = Fixture()
        f.subject["kind"] = "candidate"
        self.denied(f, "subject_version_class")
        f = Fixture(public=True)
        f.previous.update(kind="qualification", application_version="0.0.9-dev.100.1")
        f.refresh()
        self.denied(f, "public_baseline_class")
        common = Fixture().admit().report()
        self.assertFalse(any(p["distribution_eligible"] for p in common["scope"]))
        public = Fixture(public=True).admit().report()
        self.assertTrue(all(p["distribution_eligible"] for p in public["scope"] if p["requested"]))

    def test_every_declared_native_signing_step_needs_its_own_covered_receipt(self):
        f = Fixture(public=True)
        artifact = next(
            a for a in f.artifacts["inventories"][0]["artifacts"] if a["profile"] == "fedora-rpm"
        )
        artifact["signing"].append("second-signing-step")
        f.refresh()
        self.denied(f, "artifact_receipt_missing")
        receipt = copy.deepcopy(next(r for r in f.objects if r["id"] == artifact["signing"][0]))
        receipt["id"] = "second-signing-step"
        f.add(receipt, claim=False)
        f.refresh()
        self.denied(f, "signing_evidence_coverage")
        f.claim(receipt["target"], receipt["profile"], receipt["kind"])["evidence"].append(
            admission.sha(receipt)
        )
        f.admit()

    def test_complete_baseline_inventory_may_contain_a_currently_unselected_target(self):
        f = Fixture()
        source = Fixture(optional=("win32-arm64",))
        extra = copy.deepcopy(
            next(
                a
                for a in source.artifacts["inventories"][0]["artifacts"]
                if a["targets"] == ["win32-arm64"]
            )
        )
        extra.update(
            sha256=admission.sha({"old-optional": extra["id"]}),
            native_version="synthetic-" + f.previous["application_version"],
        )
        f.artifacts["inventories"][1]["artifacts"].append(extra)
        f.refresh()
        f.admit()

    def test_extra_indexed_native_records_are_validated_outside_required_coverage(self):
        for claimed in (True, False):
            for fault, code in (
                ("cell", "native_cell"),
                ("observed", "native_environment"),
                ("artifacts", "native_artifact_assignment"),
                ("subject", "evidence_subject"),
            ):
                with self.subTest(claimed=claimed, fault=fault):
                    f = Fixture()
                    extra = copy.deepcopy(
                        next(r for r in f.objects if r["kind"] == "first_installation")
                    )
                    extra["id"] = "extra-record"
                    extra["execution"]["invocation"] = "extra-native-invocation"
                    if fault == "cell":
                        extra["cell"] = "foreign-cell"
                    elif fault == "observed":
                        extra["observed"]["filesystem"] = "nfs"
                    elif fault == "subject":
                        extra["subject"] = {**extra["subject"], "id": "foreign-subject"}
                    else:
                        extra["artifacts"] = [f.cells["cells"][5]["assignments"]["install"]]
                    f.add(extra, claim=claimed)
                    f.refresh()
                    self.denied(f, code)
        f = Fixture()
        failed = copy.deepcopy(next(r for r in f.objects if r["kind"] == "native_runtime"))
        failed.update(id="failed-before-observation", outcome="failed", observed=None, details={})
        failed["execution"]["invocation"] = "failed-native-invocation"
        f.add(failed, claim=False)
        f.refresh()
        f.admit()

    def test_verifier_side_effects_and_external_exceptions_cannot_rewrite_admission(self):
        import http.client

        for error in (
            RuntimeError("synthetic-private-path"),
            http.client.HTTPException("synthetic-private-path"),
            subprocess.CalledProcessError(1, ["synthetic-private-path"]),
        ):
            with self.subTest(error=type(error).__name__):
                f = Fixture()

                def unavailable(record, data):
                    raise error

                self.denied(f, "capability_unqualified", f.context(verify_evidence=unavailable))
        f = Fixture()
        f.mutate_record(f.objects[0], lambda r: r.update(outcome="failed"))

        def normalize(record, data):
            record["outcome"] = "passed"
            return True

        self.denied(f, "capability_unqualified", f.context(verify_evidence=normalize))
        f = Fixture()

        def annotate(record, data):
            record["id"] = "adapter-local-name"
            return True

        f.admit(f.context(verify_evidence=annotate))

    def test_native_jobs_cannot_build_or_sign_any_indexed_package(self):
        for overlap in ("signing", "other-build", "extra-build"):
            with self.subTest(overlap=overlap):
                f = Fixture(public=True)
                native = next(r for r in f.objects if r["kind"] == "native_runtime")
                if overlap == "signing":
                    signer = next(r for r in f.objects if r["kind"] == "native_package_signing")
                    cell = next(
                        r
                        for r in f.objects
                        if r["kind"] == "native_runtime" and r["profile"] == "fedora-rpm"
                    )
                    f.mutate_record(
                        signer, lambda r: r.update(execution=copy.deepcopy(cell["execution"]))
                    )
                elif overlap == "other-build":
                    builder = next(
                        r
                        for r in f.objects
                        if r["kind"] == "build" and r["profile"] == "debian-deb"
                    )
                    f.mutate_record(builder, lambda r: r["execution"].update(job_id=3000))
                    f.mutate_record(
                        native, lambda r: r.update(execution=copy.deepcopy(builder["execution"]))
                    )
                else:
                    extra = copy.deepcopy(next(r for r in f.objects if r["kind"] == "build"))
                    extra.update(
                        id="unclaimed-extra-build", execution=copy.deepcopy(native["execution"])
                    )
                    f.add(extra, claim=False)
                    f.refresh()
                self.denied(f, "producer_test_separation")

    def test_a_job_cannot_have_conflicting_workflow_run_or_attempt_parents(self):
        for field, value in (
            ("workflow", ".github/workflows/other.yml"),
            ("workflow_sha", "f" * 40),
            ("run_id", 999),
            ("attempt", 2),
        ):
            with self.subTest(parent_field=field):
                f = Fixture(public=True)
                receipt = next(r for r in f.objects if r["kind"] == "provenance")
                f.mutate_record(receipt, lambda r: r["execution"].update({field: value}))
                self.denied(f, "job_identity_conflict")

    def test_deferred_publisher_lineage_is_not_current_signing_eligibility(self):
        for state in ("unavailable", "unknown", "expired", "revoked"):
            with self.subTest(publisher_state=state):
                f = Fixture(public=True)
                receipt = next(
                    r
                    for r in f.objects
                    if r["kind"] == "native_package_signing" and r["target"] == "win32-x64"
                )
                if state == "unknown":
                    f.mutate_record(receipt, lambda r: r.update(outcome="unknown"))
                if state == "expired":
                    f.mutate_record(receipt, lambda r: r.update(expires_at_ms=NOW))
                f.claim("win32-x64", "windows-nsis", "native_package_signing")["state"] = state
                overrides = {}
                if state == "unavailable":
                    overrides["verify_evidence"] = lambda r, data: r["id"] != receipt["id"]
                if state == "revoked":
                    overrides["revoked"] = frozenset([admission.sha(receipt)])
                context = f.context(operation="candidate", **overrides)
                report = f.admit(context).report()
                profile = next(p for p in report["scope"] if p["target"] == "win32-x64")
                self.assertEqual(profile["capabilities"]["native_package_signing"], state)
                self.assertFalse(profile["distribution_eligible"])
                self.denied(f, "capability_unqualified", replace(context, operation="public"))
        f = Fixture()
        f.artifacts["inventories"][0]["artifacts"][0]["signing"] = ["unsupported-deb-signing"]
        f.refresh()
        self.denied(f, "signing_policy")


if __name__ == "__main__":
    unittest.main()
