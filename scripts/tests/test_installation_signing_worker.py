"""Test fixed worker isolation with synthetic data, without credentials or remote signing."""

from __future__ import annotations

import base64
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_signing_worker as worker

ROOT = Path(__file__).resolve().parents[2]
SOURCE = "a" * 40
MAIN = "f" * 40
RECIPE = "c" * 40
BACKEND = "11111111-1111-1111-1111-111111111111"
OWN = "22222222-2222-2222-2222-222222222222"
PRODUCER = "33333333-3333-3333-3333-333333333333"


def environment():
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_REPOSITORY_ID": "1431132416",
        "GITHUB_REPOSITORY_OWNER_ID": "346940169",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "GITHUB_SHA": MAIN,
        "SOURCE_COMMIT": SOURCE,
        "SIGNING_RECIPE_SHA": RECIPE,
        "SIGNING_RECIPE_REF": f"ohtia/ohtia/{worker.WORKFLOW}@{RECIPE}",
        "GITHUB_RUN_ID": "100",
        "GITHUB_RUN_ATTEMPT": "2",
        "SIGNING_JOB_ID": "300",
        "SIGNING_SELECTION": "linux-x64-debian-13",
        "SCW_SIGNING_SERVICE_ORIGIN": "https://fixture.fnc.fr-par.scw.cloud",
        "SCW_SIGNING_INGRESS_BUCKET": "fixture-ingress",
        "SCW_SIGNING_RETAINED_BUCKET": "fixture-retained",
    }


def token():
    value = json.dumps({"scp": f"Actions.Results:{BACKEND}:{OWN}"}).encode()
    return "synthetic." + base64.urlsafe_b64encode(value).decode().rstrip("=") + ".synthetic"


class FakeNetwork:
    def __init__(self):
        self.values = {}
        for identifier, name, backend, status in [
            (300, "Sign private package / Submit private signing requests", OWN, "in_progress"),
            (
                200,
                "Qualify Linux build provenance / Attest unsigned package",
                PRODUCER,
                "completed",
            ),
        ]:
            self.values[f"/actions/jobs/{identifier}"] = {
                "id": identifier,
                "name": name,
                "run_id": 100,
                "run_attempt": 2,
                "head_sha": MAIN,
                "status": status,
                "conclusion": "success" if identifier == 200 else None,
            }
            self.values[f"/check-runs/{identifier}"] = {
                "id": identifier,
                "app": {"slug": "github-actions"},
                "external_id": backend,
                "details_url": f"https://github.com/ohtia/ohtia/actions/runs/100/job/{identifier}",
            }
        self.artifact = {
            "workflowRunBackendId": BACKEND,
            "workflowJobRunBackendId": PRODUCER,
            "name": "installation-proof-100-2-200",
            "databaseId": "400",
            "digest": "sha256:" + "f" * 64,
        }
        self.values["/actions/artifacts/400"] = {
            "id": 400,
            "name": self.artifact["name"],
            "expired": False,
            "digest": self.artifact["digest"],
            "workflow_run": {"id": 100, "head_sha": MAIN},
        }

    def api(self, endpoint):
        return self.values[endpoint]

    def results(self, operation, data):
        if operation == "ListArtifacts":
            return {"artifacts": [self.artifact]}
        if operation == "GetSignedArtifactURL":
            return {"signedUrl": "https://fixture.blob.core.windows.net/proof?synthetic=private"}
        raise AssertionError(operation)


class WorkerIdentityTests(unittest.TestCase):
    def test_execution_context_refuses_foreign_missing_or_unpinned_identity(self):
        env = environment()
        self.assertEqual(worker.context(env)["job"], 300)
        for key, value in [
            ("GITHUB_ACTIONS", "false"),
            ("GITHUB_REPOSITORY_ID", "1"),
            ("GITHUB_REF", "refs/pull/1/merge"),
            ("RUNNER_ENVIRONMENT", "self-hosted"),
            ("GITHUB_RUN_ATTEMPT", "01"),
            ("SIGNING_RECIPE_SHA", "main"),
            ("SIGNING_RECIPE_REF", f"ohtia/ohtia/{worker.WORKFLOW}@{SOURCE}"),
        ]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                worker.context(env | {key: value})

    def test_disabled_configuration_and_changed_recipe_refuse_before_preparation(self):
        with patch.object(worker.contract, "git", return_value=RECIPE.encode()):
            with self.assertRaisesRegex(ValueError, "worker_disabled"):
                worker.check(environment())
        with patch.object(worker.contract, "git", return_value=SOURCE.encode()):
            with self.assertRaisesRegex(ValueError, "worker_checkout"):
                worker.check(environment())

    def test_enabled_worker_requires_repository_metadata_without_tracked_resource_fallback(self):
        template = {
            "schema_version": 1,
            "enabled": True,
            "service_origin": None,
            "buckets": None,
            "resource_bindings_sha256": worker.metadata.caller_hash(
                worker.metadata.caller_bindings(environment())
            ),
        }
        with (
            patch.object(worker.contract, "git", return_value=RECIPE.encode()),
            patch.object(worker.attestor, "json_value", return_value=template),
        ):
            self.assertEqual(worker.check(environment()), worker.context(environment()))
            for name, value in (
                ("SCW_SIGNING_SERVICE_ORIGIN", ""),
                ("SCW_SIGNING_SERVICE_ORIGIN", "https://fixture.fnc.fr-par.scw.cloud/"),
                ("SCW_SIGNING_SERVICE_ORIGIN", "https://foreign.invalid"),
                ("SCW_SIGNING_SERVICE_ORIGIN", "https://other-tenant.fnc.fr-par.scw.cloud"),
                ("SCW_SIGNING_SERVICE_ORIGIN", "https://" + "a" * 500 + ".fnc.fr-par.scw.cloud"),
                ("SCW_SIGNING_INGRESS_BUCKET", "another-valid-bucket"),
                ("SCW_SIGNING_INGRESS_BUCKET", "1invalid-bucket"),
                ("SCW_SIGNING_INGRESS_BUCKET", "../foreign"),
                ("SCW_SIGNING_RETAINED_BUCKET", "fixture-ingress"),
            ):
                with (
                    self.subTest(name=name, value=value),
                    self.assertRaisesRegex(ValueError, "worker_configuration"),
                ):
                    worker.check(environment() | {name: value})
            approved = template["resource_bindings_sha256"]
            for commitment in (None, "0" * 64):
                template["resource_bindings_sha256"] = commitment
                with self.assertRaisesRegex(ValueError, "worker_configuration"):
                    worker.check(environment())
            template["resource_bindings_sha256"] = approved
            template["service_origin"] = "https://fixture.fnc.fr-par.scw.cloud"
            with self.assertRaisesRegex(ValueError, "worker_configuration"):
                worker.check(environment())

    @unittest.skipIf(sys.platform == "win32", "Linux worker private directory identity")
    def test_private_staging_refuses_symlinks_shared_modes_and_noncanonical_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            env = environment() | {"RUNNER_TEMP": str(root)}
            identity = worker.context(env)
            directory = worker.ensure_stage(env, identity)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            directory.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "worker_temp"):
                worker.ensure_stage(env, identity)
            directory.rmdir()
            directory.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "worker_temp"):
                worker.ensure_stage(env, identity)
            with self.assertRaisesRegex(ValueError, "worker_temp"):
                worker.stage(env | {"RUNNER_TEMP": str(root / "x/..")}, identity)

    def test_proof_origin_requires_exact_current_successful_attestor_and_backend(self):
        self.assertEqual(
            worker.artifact_origin(
                FakeNetwork(),
                worker.context(environment()),
                token(),
                "installation-proof-100-2-200",
            )[1],
            "f" * 64,
        )
        for mutation in ("run", "attempt", "source", "name", "backend", "expired", "digest", "app"):
            network = FakeNetwork()
            if mutation == "run":
                network.values["/actions/jobs/200"]["run_id"] = 101
            if mutation == "attempt":
                network.values["/actions/jobs/200"]["run_attempt"] = 1
            if mutation == "source":
                network.values["/actions/jobs/200"]["head_sha"] = "b" * 40
            if mutation == "name":
                network.values["/actions/jobs/200"]["name"] = "Other / Attest unsigned package"
            if mutation == "backend":
                network.artifact["workflowJobRunBackendId"] = OWN
            if mutation == "expired":
                network.values["/actions/artifacts/400"]["expired"] = True
            if mutation == "digest":
                network.values["/actions/artifacts/400"]["digest"] = "sha256:" + "e" * 64
            if mutation == "app":
                network.values["/check-runs/200"]["app"]["slug"] = "foreign"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                worker.artifact_origin(
                    network, worker.context(environment()), token(), "installation-proof-100-2-200"
                )
        for locator in (
            "installation-proof-100-1-200",
            "installation-proof-100-2-300",
            "../artifact",
            "installation-proof-101-2-200",
        ):
            with self.subTest(locator=locator), self.assertRaises(ValueError):
                worker.artifact_origin(
                    FakeNetwork(), worker.context(environment()), token(), locator
                )

    def test_invocation_scrubs_interpreter_overrides_and_keeps_credentials_out_of_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = environment() | {
                "RUNNER_TEMP": str(Path(temporary).resolve()),
                "OHTIA_SIGNING_INVOKE_TOKEN": "synthetic-invoker",
                "GITHUB_TOKEN": "synthetic-github",
                "ACTIONS_RUNTIME_TOKEN": "synthetic-results",
                "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "synthetic-oidc",
                "ACTIONS_ID_TOKEN_REQUEST_URL": "https://fixture.actions.githubusercontent.com/token",
                "NODE_OPTIONS": "--import=untrusted",
                "NODE_PATH": "untrusted",
                "PYTHONPATH": "untrusted",
                "GIT_CONFIG_COUNT": "1",
            }
            with (
                patch.object(worker, "check", return_value=worker.context(env)),
                patch.object(worker, "ensure_stage", return_value=Path(temporary).resolve()),
                patch.object(worker.subprocess, "run") as invoked,
            ):
                worker.invoke(env)
            command = invoked.call_args.args[0]
            clean = invoked.call_args.kwargs["env"]
            self.assertEqual(len(command), 2)
            self.assertEqual(command[1], str(ROOT / "tooling/installation-signing-worker.mjs"))
            for key in (
                "NODE_OPTIONS",
                "NODE_PATH",
                "PYTHONPATH",
                "GIT_CONFIG_COUNT",
                "ACTIONS_RUNTIME_TOKEN",
            ):
                self.assertNotIn(key, clean)
            for name in (
                "SCW_SIGNING_SERVICE_ORIGIN",
                "SCW_SIGNING_INGRESS_BUCKET",
                "SCW_SIGNING_RETAINED_BUCKET",
            ):
                self.assertEqual(clean[name], env[name])
            self.assertEqual(clean["SOURCE_COMMIT"], SOURCE)
            self.assertEqual(clean["GITHUB_SHA"], MAIN)
            self.assertEqual(clean["OHTIA_SIGNING_INVOKE_TOKEN"], "synthetic-invoker")
            self.assertNotIn("synthetic-invoker", " ".join(command))

    def test_fixed_action_and_job_never_execute_candidate_or_publish_private_results(self):
        workflow = (ROOT / ".github/workflows/signing-worker.yml").read_text()
        action = (ROOT / ".github/actions/installation-signing-worker/main.mjs").read_text()
        self.assertIn("ref: ${{ job.workflow_sha }}", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertNotIn("upload-artifact", workflow)
        self.assertNotIn("attestations: write", workflow)
        self.assertNotIn("secrets: inherit", workflow)
        self.assertNotIn("pnpm", workflow)
        self.assertNotIn("npm", workflow)
        self.assertEqual(workflow.count("secrets.OHTIA_SIGNING_INVOKE_TOKEN"), 1)
        preparation, invoke = workflow.split(
            "      - name: Sign and verify the private package and catalog", 1
        )
        self.assertNotIn("OHTIA_SIGNING_INVOKE_TOKEN", preparation)
        self.assertIn("id-token: write", preparation)
        self.assertIn('"-I"', action)
        self.assertNotIn("shell:", action)
        self.assertIn('stdio: "inherit"', action)
        self.assertIn("always()", invoke)

    def test_cli_errors_remain_static_and_do_not_print_capabilities(self):
        result = subprocess.run(
            [sys.executable, "-I", str(ROOT / "scripts/installation_signing_worker.py"), "unknown"],
            env=os.environ | {"OHTIA_SIGNING_INVOKE_TOKEN": "synthetic-private-value"},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "Private signing worker preparation refused.\n")


class WorkerArchiveTests(unittest.TestCase):
    def archive(self, directory, mutation=None):
        archive = directory / "proof.zip"
        with zipfile.ZipFile(archive, "w") as output:
            names = [
                "manifest.json",
                "closure.json",
                "predicate.json",
                "build-proof.json",
                "package.deb",
            ]
            if mutation == "path":
                names[-1] = "../package.deb"
            if mutation == "extra":
                names.append("unexpected.py")
            if mutation == "duplicate":
                names[-1] = "manifest.json"
            for name in names:
                row = zipfile.ZipInfo(name)
                row.external_attr = (
                    (stat.S_IFLNK if mutation == "link" and name == "package.deb" else stat.S_IFREG)
                    | 0o600
                ) << 16
                output.writestr(row, b"synthetic data; never executed")
        return archive

    def test_proof_extraction_accepts_only_five_bounded_ordinary_exact_files(self):
        for mutation in (None, "path", "extra", "duplicate", "link"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                archive = self.archive(directory, mutation)
                if mutation is None:
                    worker.unpack_proof(archive, directory / "input", "deb")
                    self.assertEqual(len(list((directory / "input").iterdir())), 5)
                else:
                    with self.assertRaises(ValueError):
                        worker.unpack_proof(archive, directory / "input", "deb")
                self.assertFalse((directory / "package.deb").exists())

    def test_oversized_metadata_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            archive = self.archive(directory)
            with (
                patch.object(worker.contract, "MAXIMUM_METADATA", 1),
                self.assertRaises(ValueError),
            ):
                worker.unpack_proof(archive, directory / "input", "deb")

    def test_tool_checksum_failure_prevents_binary_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = environment() | {"RUNNER_TEMP": str(Path(temporary).resolve())}
            with (
                patch.object(worker, "check", return_value=worker.context(env)),
                patch.object(worker, "ensure_stage", return_value=Path(temporary).resolve()),
                patch.object(
                    worker.urllib.request, "urlopen", return_value=io.BytesIO(b"untrusted archive")
                ),
            ):
                with self.assertRaisesRegex(ValueError, "worker_tools"):
                    worker.tools(env)
            self.assertFalse((Path(temporary) / "tools/node").exists())

    def test_tool_download_obeys_absolute_deadline_even_when_bytes_keep_arriving(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = environment() | {"RUNNER_TEMP": str(Path(temporary).resolve())}
            with (
                patch.object(worker, "check", return_value=worker.context(env)),
                patch.object(worker, "ensure_stage", return_value=Path(temporary).resolve()),
                patch.object(
                    worker.urllib.request, "urlopen", return_value=io.BytesIO(b"synthetic")
                ),
                patch.object(worker.time, "monotonic", side_effect=[0, 0, 10000]),
            ):
                with self.assertRaisesRegex(ValueError, "worker_tools"):
                    worker.tools(env)


if __name__ == "__main__":
    unittest.main()
