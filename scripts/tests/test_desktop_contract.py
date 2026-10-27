"""Negative admission cases for host-independent desktop qualification inputs."""

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "desktop_contract", ROOT / "scripts/desktop_contract.py"
)
assert SPEC is not None and SPEC.loader is not None
contract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(contract)


def record(name):
    return json.loads((ROOT / "config/desktop" / f"{name}.json").read_text())


class QualificationAdmissionTests(unittest.TestCase):
    def test_packaging_helpers_require_complete_native_identity(self):
        for mutation in ("missing", "coverage", "source", "architecture", "digest"):
            data = record("toolchain")
            helpers = data["tools"]["electron-builder"]["linux_packaging_helpers"]
            if mutation == "missing":
                del helpers["fpm"]
            elif mutation == "coverage":
                del helpers["7zip"]["artifacts"]["linux-arm64"]
            else:
                artifact = helpers["fpm"]["artifacts"]["linux-x64"]
                if mutation == "source":
                    artifact["url"] = artifact["url"].replace("github.com", "untrusted.invalid")
                elif mutation == "architecture":
                    artifact["url"] = artifact["url"].replace("linux-amd64", "linux-arm64v8")
                else:
                    artifact["sha256"] = "partial"
            with self.subTest(mutation=mutation), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)

    def test_repository_contract_is_usable_without_native_execution(self):
        contract.check_repository(ROOT)

    def test_every_missing_native_cell_fails(self):
        for index in range(6):
            with self.subTest(index=index):
                data = record("targets")
                del data["targets"][index]
                with self.assertRaises(contract.ContractError):
                    contract.check_targets(data)

    def test_duplicate_cross_build_or_mismatched_target_fails(self):
        for mutation in ("duplicate", "emulation", "wrong-cpu", "optional"):
            with self.subTest(mutation=mutation):
                data = record("targets")
                if mutation == "duplicate":
                    data["targets"][1] = copy.deepcopy(data["targets"][0])
                elif mutation == "emulation":
                    data["native_acceptance_substitutes"] = ["Rosetta"]
                elif mutation == "wrong-cpu":
                    data["targets"][0]["arch"] = "arm64"
                else:
                    data["targets"][0]["native_required"] = False
                with self.assertRaises(contract.ContractError):
                    contract.check_targets(data)

    def test_optional_targets_remain_admitted_and_required_scope_cannot_drift(self):
        data = record("targets")
        required = {row["id"] for row in data["targets"] if row["native_required"]}
        self.assertEqual(required, {"linux-x64", "linux-arm64", "win32-x64", "darwin-arm64"})
        contract.check_targets(data)
        for target in ("win32-arm64", "darwin-x64", "darwin-arm64"):
            changed = copy.deepcopy(data)
            row = next(row for row in changed["targets"] if row["id"] == target)
            row["native_required"] = not row["native_required"]
            with self.subTest(target=target), self.assertRaises(contract.ContractError):
                contract.check_targets(changed)
        for majors in ([], [26], [15, 26, 27]):
            changed = copy.deepcopy(data)
            row = next(row for row in changed["targets"] if row["id"] == "darwin-arm64")
            row["required_os_majors"] = majors
            with self.subTest(majors=majors), self.assertRaises(contract.ContractError):
                contract.check_targets(changed)

    def test_tools_cannot_borrow_another_line_in_the_same_adr(self):
        data = record("toolchain")
        data["tools"]["node"]["version"] = data["tools"]["pnpm"]["version"]
        with self.assertRaisesRegex(contract.ContractError, "node leaves"):
            contract.check_toolchain(data, ROOT)

    def test_required_download_and_component_identities_cannot_be_removed(self):
        for name in ("typescript", "sqlite", "python", "electron-updater"):
            data = record("toolchain")
            del data["tools"][name]["artifact"]
            with self.subTest(name=name), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)
        for name in ("node", "electron", "python", "uv", "ruff", "pyrefly", "powershell"):
            data = record("toolchain")
            target = "win32-x64" if name == "powershell" else "linux-x64"
            del data["tools"][name]["artifacts"][target]["url"]
            with self.subTest(name=name), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)
        for mutation in ("source_id", "chrome", "integrity"):
            data = record("toolchain")
            if mutation == "source_id":
                del data["tools"]["sqlite"]["source_id"]
            elif mutation == "chrome":
                data["tools"]["electron"]["embedded_runtime_metadata"]["chrome"] = None
            else:
                del data["tools"]["typescript"]["artifact"]["integrity"]
            with self.subTest(mutation=mutation), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)

    def test_swapped_native_downloads_fail_for_every_download_family(self):
        for name in ("electron", "node", "python", "uv", "ruff", "pyrefly", "powershell"):
            data = record("toolchain")
            system = "win32" if name == "powershell" else "darwin"
            artifacts = data["tools"][name]["artifacts"]
            a, b = f"{system}-x64", f"{system}-arm64"
            artifacts[a], artifacts[b] = artifacts[b], artifacts[a]
            with self.subTest(name=name), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)

    def test_embedded_identity_preserves_only_the_v8_electron_build_tag(self):
        data = record("toolchain")
        self.assertEqual(
            data["tools"]["electron"]["embedded_runtime_metadata"]["v8"],
            "15.6.75.19-electron.0",
        )
        contract.check_toolchain(data, ROOT)
        for component, identity in (
            ("v8", "15.6.75.19-electron.unknown"),
            ("v8", "15.6.75.19-other.0"),
            ("chrome", "156.0.8078.48-electron.0"),
            ("node", "24.22.0-electron.0"),
        ):
            changed = record("toolchain")
            changed["tools"]["electron"]["embedded_runtime_metadata"][component] = identity
            with self.subTest(component=component, identity=identity):
                with self.assertRaises(contract.ContractError):
                    contract.check_toolchain(changed, ROOT)

    def test_native_shell_alias_and_package_contract_cannot_drift(self):
        for mutation in ("aliases", "exclusion", "package", "shell"):
            data = record("targets")
            if mutation == "aliases":
                data["targets"][0]["aliases"] = ["arm64"]
            elif mutation == "exclusion":
                data["excluded_architectures"].pop()
            elif mutation == "package":
                data["targets"][0]["distribution_packages"] = ["AppImage"]
            else:
                del data["targets"][2]["primary_shell"]
            with self.subTest(mutation=mutation), self.assertRaises(contract.ContractError):
                contract.check_targets(data)

    def test_artifact_validation_rejects_insecure_urls_and_non_string_digests(self):
        for value in (None, 123, True, "abc"):
            data = record("toolchain")["tools"]["typescript"]["artifact"]
            data["sha256"] = value
            with self.subTest(value=value), self.assertRaises(contract.ContractError):
                contract.check_artifact(data)
        data = record("toolchain")["tools"]["typescript"]["artifact"]
        data["url"] = data["url"].replace("https://", "http://")
        with self.assertRaises(contract.ContractError):
            contract.check_artifact(data)

    def test_python_variant_engine_and_sqlite_distribution_remain_fixed(self):
        for name, key, value in (
            ("python", "variant", "freethreaded"),
            ("sqlite", "distribution", "system"),
            ("typescript", "version", "7.0.2"),
        ):
            data = record("toolchain")
            data["tools"][name][key] = value
            with self.subTest(name=name), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)
        data = record("toolchain")
        data["tools"]["ruff"]["artifacts"]["linux-x64"]["requires_python"] = ">=3.15"
        with self.assertRaises(contract.ContractError):
            contract.check_toolchain(data, ROOT)

    def test_fixed_policy_does_not_authorize_values_within_a_broad_range(self):
        data = record("resource-policy")
        data["budgets"]["release_retirement_notice_days"]["permitted"]["minimum"] = 1
        with self.assertRaises(contract.ContractError):
            contract.check_policy(data)

    def test_facility_substitutions_do_not_qualify_another_native_profile(self):
        for index, label in ((0, "ubuntu-26.04"), (2, "windows-2025")):
            data = record("targets")
            data["targets"][index]["testing_facilities"]["hosted_candidates"] = [label]
            with self.subTest(label=label), self.assertRaises(contract.ContractError):
                contract.check_targets(data)

    def test_actual_ci_and_hook_pins_must_match_the_manifest(self):
        tools = record("toolchain")["tools"]
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        hooks = (ROOT / ".pre-commit-config.yaml").read_text()
        for name, before, after in (
            ("runner", "ubuntu-26.04", "ubuntu-24.04"),
            ("python", 'python-version: "3.14.8"', 'python-version: "3.14.9"'),
            ("prettier", "rev: v3.9.10", "rev: v3.9.9"),
            ("ruff", "rev: v0.17.2", "rev: v0.17.1"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / ".github/workflows").mkdir(parents=True)
                changed_workflow = workflow.replace(before, after)
                changed_hooks = hooks.replace(before, after)
                self.assertTrue(changed_workflow != workflow or changed_hooks != hooks)
                (root / ".github/workflows/ci.yml").write_text(changed_workflow)
                (root / ".pre-commit-config.yaml").write_text(changed_hooks)
                with self.assertRaises(contract.ContractError):
                    contract.check_configuration(root, tools)

    def test_mutable_ci_source_wrong_ci_artifact_or_msi_bootstrap_fails(self):
        for mutation in ("source", "ci-os", "ci-url", "powershell-msi"):
            data = record("toolchain")
            python = data["tools"]["python"]
            if mutation == "source":
                python["ci_source"] = (
                    "https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json"
                )
            elif mutation == "ci-os":
                python["ci_artifact"]["os"] = "ubuntu-24.04"
            elif mutation == "ci-url":
                python["ci_artifact"]["url"] = python["ci_artifact"]["url"].replace(
                    "26.04", "24.04"
                )
            else:
                artifact = data["tools"]["powershell"]["artifacts"]["win32-x64"]
                artifact["url"] = artifact["url"].removesuffix(".zip") + ".msi"
            with self.subTest(mutation=mutation), self.assertRaises(contract.ContractError):
                contract.check_toolchain(data, ROOT)

    def test_startup_and_shutdown_must_fit_the_measurement_window(self):
        data = record("resource-policy")
        budget = data["budgets"]["application_start_ms"]
        budget["value"] = 35000
        budget["permitted"] = {"minimum": 35000, "maximum": 35000}
        with self.assertRaisesRegex(contract.ContractError, "measurement window"):
            contract.check_policy(data)

    def test_linux_requires_both_distribution_packages_on_both_cpus(self):
        for index in (0, 1):
            for mutation in (
                "missing-rpm",
                "missing-fedora",
                "wrong-rpm-arch",
                "ubuntu-as-fedora",
                "wrong-image",
            ):
                data = record("targets")
                row = data["targets"][index]
                if mutation == "missing-rpm":
                    row["quality_packages"] = ["deb"]
                    row["distribution_packages"] = ["deb"]
                elif mutation == "missing-fedora":
                    row["distribution_profiles"].pop()
                elif mutation == "wrong-rpm-arch":
                    row["native_package_architectures"]["rpm"] = "arm64"
                elif mutation == "ubuntu-as-fedora":
                    row["distribution_profiles"][1]["hosted_candidates"] = ["ubuntu-24.04"]
                else:
                    image = row["distribution_profiles"][1]["qualification_image"]
                    opposite = "aarch64" if index == 0 else "x86_64"
                    image["url"] = (
                        image["url"].rsplit("/", 1)[0]
                        + f"/Fedora-Workstation-Live-44-1.7.{opposite}.iso"
                    )
                with (
                    self.subTest(index=index, mutation=mutation),
                    self.assertRaises(contract.ContractError),
                ):
                    contract.check_targets(data)

    def test_added_distribution_profiles_require_their_selected_cpu_and_wayland(self):
        data = record("targets")
        contract.check_targets(data)
        for target_index, profile_id in (
            (0, "ubuntu-26.04"),
            (0, "debian-13"),
            (1, "ubuntu-26.04"),
            (1, "debian-13"),
        ):
            for field, value in (
                ("display_backends", ["x11"]),
                ("libc_minimum", "2.39"),
                ("package", "rpm"),
            ):
                mutated = copy.deepcopy(data)
                profile = next(
                    p
                    for p in mutated["targets"][target_index]["distribution_profiles"]
                    if p["id"] == profile_id
                )
                profile[field] = value
                with (
                    self.subTest(target=target_index, profile=profile_id, field=field),
                    self.assertRaises(contract.ContractError),
                ):
                    contract.check_targets(mutated)
        for target_index in (0, 1):
            for profile_id in ("ubuntu-26.04", "debian-13"):
                missing = copy.deepcopy(data)
                missing["targets"][target_index]["distribution_profiles"] = [
                    p
                    for p in missing["targets"][target_index]["distribution_profiles"]
                    if p["id"] != profile_id
                ]
                with (
                    self.subTest(target=target_index, missing=profile_id),
                    self.assertRaises(contract.ContractError),
                ):
                    contract.check_targets(missing)

    def test_linux_display_and_fedora_checksum_identity_cannot_drift(self):
        for mutation in ("ozone", "ozone-auto", "backend", "checksum"):
            data = record("targets")
            row = data["targets"][0]
            if mutation == "ozone":
                row["runtime_arguments"] = ["--ozone-platform=x11"]
            elif mutation == "ozone-auto":
                row["runtime_arguments"] = ["--ozone-platform=auto"]
            elif mutation == "backend":
                row["distribution_profiles"][1]["display_backends"] = ["x11"]
            else:
                image = row["distribution_profiles"][1]["qualification_image"]
                image["checksum_source"] = image["checksum_source"].replace("x86_64", "aarch64")
            with self.subTest(mutation=mutation), self.assertRaises(contract.ContractError):
                contract.check_targets(data)

    def test_non_linux_rows_cannot_enable_unreviewed_runtime_switches(self):
        for index, row in enumerate(record("targets")["targets"]):
            if row["os"] == "linux":
                continue
            data = record("targets")
            data["targets"][index]["runtime_arguments"] = ["--no-sandbox"]
            with self.subTest(target=row["id"]), self.assertRaises(contract.ContractError):
                contract.check_targets(data)

    def test_native_artifact_identity_and_coverage_are_required(self):
        for mutation in ("missing", "wrong-header", "invalid-digest", "yanked"):
            with self.subTest(mutation=mutation):
                data = record("toolchain")
                artifacts = data["tools"]["better-sqlite3"]["artifacts"]
                if mutation == "missing":
                    del artifacts["win32-arm64"]
                elif mutation == "wrong-header":
                    artifacts["win32-arm64"]["architecture"] = "x64"
                elif mutation == "invalid-digest":
                    artifacts["win32-arm64"]["sha256"] = "abc"
                else:
                    artifacts["win32-arm64"]["yanked"] = True
                with self.assertRaises(contract.ContractError):
                    contract.check_toolchain(data, ROOT)

    def test_incompatible_peers_or_embedded_node_fail(self):
        for name, field, value in (
            ("typescript-eslint", "peers", {"typescript": ">=7.0.0"}),
            ("vitest", "peers", {"vite": "^9.0.0"}),
            (
                "electron",
                "embedded_runtime_metadata",
                {"node": "20.0.0", "chrome": "156.0.0", "v8": "15.6.0", "modules": "150"},
            ),
        ):
            with self.subTest(name=name):
                data = record("toolchain")
                data["tools"][name][field] = value
                with self.assertRaises(contract.ContractError):
                    contract.check_toolchain(data, ROOT)

    def test_missing_unknown_or_invalid_numeric_policy_fails(self):
        for value in (True, False, 0, -1, 1.5, float("inf"), float("nan"), "65536", None, 2**53):
            with self.subTest(value=value):
                data = record("resource-policy")
                data["budgets"]["message_bytes"]["value"] = value
                with self.assertRaises(contract.ContractError):
                    contract.check_policy(data)
        for name in ("missing", "unknown"):
            data = record("resource-policy")
            if name == "missing":
                del data["budgets"]["request_deadline_ms"]
            else:
                data["budgets"]["other_deadline_ms"] = data["budgets"]["request_deadline_ms"]
            with self.assertRaises(contract.ContractError):
                contract.check_policy(data)

    def test_unit_mismatch_and_boolean_schema_are_rejected(self):
        data = record("resource-policy")
        data["budgets"]["message_bytes"]["unit"] = "millisecond"
        with self.assertRaises(contract.ContractError):
            contract.check_policy(data)
        for name, checker in (
            ("targets", contract.check_targets),
            ("resource-policy", contract.check_policy),
            ("security-applicability", contract.check_security),
        ):
            with self.subTest(name=name):
                data = record(name)
                data["schema_version"] = True
                with self.assertRaises(contract.ContractError):
                    checker(data)

    def test_cross_budget_conflicts_fail_even_when_each_value_is_positive(self):
        for name, value in (
            ("shutdown_total_ms", 9999),
            ("initial_output_bytes", 65536),
            ("pending_global", 63),
            ("service_start_ms", 16000),
            ("sqlite_busy_ms", 5000),
            ("diagnostic_files", 6),
        ):
            with self.subTest(name=name):
                data = record("resource-policy")
                data["budgets"][name]["value"] = value
                data["budgets"][name]["permitted"] = {"minimum": value, "maximum": value}
                with self.assertRaises(contract.ContractError):
                    contract.check_policy(data)

    def test_security_exclusions_cannot_remove_baseline_requirements(self):
        for mutation in ("missing", "duplicate", "reason", "owner", "disposition"):
            with self.subTest(mutation=mutation):
                data = record("security-applicability")
                group = data["groups"]["no-cookie-session"]
                if mutation == "missing":
                    group["requirements"].pop()
                elif mutation == "duplicate":
                    group["requirements"].append(group["requirements"][0])
                elif mutation == "reason":
                    group["reason"] = ""
                elif mutation == "owner":
                    group["owners"] = []
                else:
                    group["disposition"] = "passed"
                with self.assertRaises(contract.ContractError):
                    contract.check_security(data)

    def test_duplicate_json_keys_fail_before_contract_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ambiguous.json"
            path.write_text('{"schema_version":1,"schema_version":2}')
            with self.assertRaisesRegex(contract.ContractError, "Duplicate JSON key"):
                contract.read_json(path)

    def test_bad_checkout_returns_controlled_cli_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/desktop_contract.py"), "--root", directory],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("D1a metadata check failed", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_published_range_boundaries_and_unsupported_syntax(self):
        cases = [
            ("6.0.3", ">=4.8.4 <6.1.0", True),
            ("6.1.0", ">=4.8.4 <6.1.0", False),
            ("10.13.0", "^8.57.0 || ^9.0.0 || ^10.0.0", True),
            ("11.0.0", "^8.57.0 || ^9.0.0 || ^10.0.0", False),
            ("26.12.1", ">=18.*", True),
            ("3.14.8", ">=3.8", True),
            ("0.29.7", "^0.29.0", True),
            ("0.30.0", "^0.29.0", False),
        ]
        for version, constraint, expected in cases:
            with self.subTest(version=version, constraint=constraint):
                self.assertEqual(contract.accepts(version, constraint), expected)
        for constraint in ("workspace:*", ">6.1", "<=6.1", "^6.1"):
            with self.subTest(constraint=constraint), self.assertRaises(contract.ContractError):
                contract.accepts("6.1.5", constraint)


if __name__ == "__main__":
    unittest.main()
