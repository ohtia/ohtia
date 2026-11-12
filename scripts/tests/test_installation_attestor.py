"""Exercise the isolated attestor with synthetic metadata; these are not hosted provenance proofs."""

from __future__ import annotations

import base64
import copy
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
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_attestor as attestor
import installation_build as builder
import installation_build_contract as contract
import workspace

ROOT = Path(__file__).resolve().parents[2]
SOURCE = "a" * 40
MAIN = "f" * 40
RECIPE = "b" * 40
RUN_BACKEND = "11111111-1111-1111-1111-111111111111"
BUILD_BACKEND = "22222222-2222-2222-2222-222222222222"
ATTEST_BACKEND = "33333333-3333-3333-3333-333333333333"


def environment():
    return {
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_REPOSITORY_ID": "1431132416",
        "GITHUB_REPOSITORY_OWNER_ID": "346940169",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "GITHUB_SHA": MAIN,
        "SOURCE_COMMIT": SOURCE,
        "RECIPE_SHA": RECIPE,
        "RECIPE_REF": f"ohtia/ohtia/{contract.RECIPE}@{RECIPE}",
        "GITHUB_RUN_ID": "100",
        "GITHUB_RUN_ATTEMPT": "2",
        "ATTESTOR_JOB_ID": "202",
        "BUILD_SELECTION": "linux-x64-debian-13",
        "GITHUB_TOKEN": "synthetic-api-token",
        "ACTIONS_RESULTS_URL": attestor.RESULTS,
    }


def token():
    payload = contract.canonical({"scp": f"Actions.Results:{RUN_BACKEND}:{ATTEST_BACKEND}"})
    return "synthetic." + base64.urlsafe_b64encode(payload).decode().rstrip("=") + ".synthetic"


class FakeNetwork:
    def __init__(self):
        self.jobs = [
            {
                "id": identifier,
                "run_id": 100,
                "run_attempt": 2,
                "head_sha": MAIN,
                "name": "qualification / " + name,
                "status": status,
                "conclusion": conclusion,
            }
            for identifier, name, status, conclusion in (
                (201, attestor.BUILD_NAME, "completed", "success"),
                (202, attestor.ATTEST_NAME, "in_progress", None),
            )
        ]
        self.checks = {
            identifier: {
                "id": identifier,
                "app": {"slug": "github-actions"},
                "external_id": backend,
                "details_url": f"https://github.com/ohtia/ohtia/actions/runs/100/job/{identifier}",
            }
            for identifier, backend in ((201, BUILD_BACKEND), (202, ATTEST_BACKEND))
        }
        self.artifact = {
            "workflowRunBackendId": RUN_BACKEND,
            "workflowJobRunBackendId": BUILD_BACKEND,
            "databaseId": "300",
            "name": "installation-build-100-2-201",
            "digest": "sha256:" + "d" * 64,
        }
        self.rest = {
            "id": 300,
            "name": self.artifact["name"],
            "expired": False,
            "digest": self.artifact["digest"],
            "workflow_run": {"id": 100, "head_sha": MAIN},
        }
        self.artifacts = [self.artifact]
        self.calls = []

    def api(self, endpoint):
        self.calls.append(endpoint)
        if "/jobs?" in endpoint:
            return {"jobs": self.jobs, "total_count": len(self.jobs)}
        if endpoint.startswith("/check-runs/"):
            return self.checks[int(endpoint.rsplit("/", 1)[1])]
        if endpoint == "/actions/artifacts/300":
            return self.rest
        raise AssertionError(endpoint)

    def results(self, operation, data):
        self.calls.append((operation, copy.deepcopy(data)))
        if operation == "ListArtifacts":
            return {"artifacts": self.artifacts}
        raise AssertionError(operation)


class OriginTests(unittest.TestCase):
    def setUp(self):
        self.context = contract.identity(environment())
        self.network = FakeNetwork()

    def verify(self):
        return attestor.build_origin(self.network, self.context, token())

    def test_binds_actual_completed_producer_backend_to_immutable_artifact(self):
        result = self.verify()
        self.assertEqual(result["producer_job_id"], 201)
        self.assertEqual(result["producer_backend_id"], BUILD_BACKEND)
        self.assertEqual(result["artifact_id"], 300)
        self.assertEqual(self.context["job"], 202)
        self.assertNotIn("synthetic", contract.canonical(result).decode())

    def test_rejects_other_job_even_when_run_name_and_digest_match(self):
        self.network.artifact["workflowJobRunBackendId"] = ATTEST_BACKEND
        with self.assertRaisesRegex(ValueError, "artifact_producer"):
            self.verify()

    def test_rejects_ambiguous_or_failed_sibling(self):
        for mutation in ("duplicate", "failure", "running"):
            with self.subTest(mutation=mutation):
                self.network = FakeNetwork()
                if mutation == "duplicate":
                    self.network.jobs.append(copy.deepcopy(self.network.jobs[0]))
                elif mutation == "failure":
                    self.network.jobs[0]["conclusion"] = "failure"
                else:
                    self.network.jobs[0]["status"] = "in_progress"
                with self.assertRaises(ValueError):
                    self.verify()

    def test_rejects_different_source_run_attempt_and_check_identity(self):
        changes = (("head_sha", "c" * 40), ("run_id", 101), ("run_attempt", 1))
        for key, value in changes:
            with self.subTest(key=key):
                self.network = FakeNetwork()
                self.network.jobs[0][key] = value
                with self.assertRaisesRegex(ValueError, "job_identity"):
                    self.verify()
        self.network = FakeNetwork()
        self.network.checks[202]["external_id"] = BUILD_BACKEND
        with self.assertRaisesRegex(ValueError, "attestor_backend"):
            self.verify()

    def test_rejects_replaced_expired_or_multiple_artifacts(self):
        for mutation in ("digest", "expired", "source", "duplicate"):
            with self.subTest(mutation=mutation):
                self.network = FakeNetwork()
                if mutation == "digest":
                    self.network.rest["digest"] = "sha256:" + "e" * 64
                elif mutation == "expired":
                    self.network.rest["expired"] = True
                elif mutation == "source":
                    self.network.rest["workflow_run"]["head_sha"] = "c" * 40
                else:
                    self.network.artifacts.append(copy.deepcopy(self.network.artifact))
                with self.assertRaises(ValueError):
                    self.verify()

    def test_checks_only_this_call_and_refuses_missing_pagination(self):
        self.network.jobs[1]["name"] = "another-call / " + attestor.ATTEST_NAME
        with self.assertRaisesRegex(ValueError, "producer_job"):
            self.verify()
        self.network = FakeNetwork()
        self.network.api = Mock(return_value={"jobs": [], "total_count": 101})
        with self.assertRaisesRegex(ValueError, "jobs_bound"):
            self.verify()


class DataTests(unittest.TestCase):
    def test_canonical_closure_matches_the_existing_javascript_consumer(self):
        value = {
            "inputs": {
                "source_sha": SOURCE,
                "files": {"é/file": "a", "\U00010000": "b", "\ue000": "c", "10": "d", "2": "e"},
            },
            "contracts": {"versions": ["0.0.0-dev.100.2", "0.0.0-dev.100.3"]},
        }
        result = subprocess.check_output(
            [
                str(workspace.node_path()),
                "--input-type=module",
                "-e",
                "import { catalogBytes } from './tooling/update-admission.mjs'; process.stdout.write(catalogBytes(JSON.parse(process.argv[1])));",
                json.dumps(value),
            ],
            cwd=ROOT,
        )
        self.assertEqual(contract.canonical(value), result)

    def test_rejects_mutable_recipe_and_foreign_execution(self):
        changes = (
            ("RECIPE_REF", f"ohtia/ohtia/{contract.RECIPE}@refs/heads/main"),
            ("GITHUB_EVENT_NAME", "pull_request"),
            ("RUNNER_ENVIRONMENT", "self-hosted"),
            ("GITHUB_REPOSITORY_ID", "2"),
            ("GITHUB_REF", "refs/heads/other"),
        )
        for key, value in changes:
            with self.subTest(key=key):
                env = environment()
                env[key] = value
                with self.assertRaisesRegex(ValueError, "recipe_identity"):
                    contract.identity(env)

    def test_selects_only_native_linux_profiles_in_the_recipe_manifest(self):
        for arch in ("x64", "arm64"):
            for profile, extension in (
                ("ubuntu-26.04", "deb"),
                ("debian-13", "deb"),
                ("fedora-44", "rpm"),
            ):
                selected = contract.selection(f"linux-{arch}-{profile}", ROOT)
                self.assertEqual(selected["formats"], [extension])
        for value in ("linux-x64-fedora-45", "win32-x64", "../../command", ""):
            with self.assertRaisesRegex(ValueError, "selection"):
                contract.selection(value, ROOT)

    def test_duplicate_json_keys_and_ambiguous_protobuf_fields_are_refused(self):
        with self.assertRaisesRegex(ValueError, "duplicate_metadata"):
            attestor.json_value('{"id":1,"id":2}')
        self.assertEqual(attestor.field({"signed_url": "value"}, "signedUrl"), "value")
        with self.assertRaisesRegex(ValueError, "results_field"):
            attestor.field({"signed_url": "x", "signedUrl": "y"}, "signedUrl")

    def test_extracts_only_one_bounded_regular_package_to_a_fixed_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "artifact.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("package.deb", b"synthetic-package")
            result = attestor.extract_package(archive, root / "output.deb", "deb")
            self.assertEqual(result, {"bytes": 17, "sha256": contract.sha256(b"synthetic-package")})
            self.assertEqual((root / "output.deb").read_bytes(), b"synthetic-package")

    def test_refuses_zip_links_traversal_duplicates_and_expansion_bounds(self):
        for kind in ("link", "traversal", "duplicate", "size"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "artifact.zip"
                with zipfile.ZipFile(archive, "w") as bundle:
                    name = "../package.deb" if kind == "traversal" else "package.deb"
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = (stat.S_IFLNK | 0o777) << 16 if kind == "link" else 0
                    bundle.writestr(entry, b"synthetic-package")
                    if kind == "duplicate":
                        bundle.writestr("extra", b"extra")
                with patch.object(contract, "MAXIMUM_PACKAGE", 1 if kind == "size" else 1024):
                    with self.assertRaises(ValueError):
                        attestor.extract_package(archive, root / "output.deb", "deb")
                self.assertFalse((root / "output.deb").exists())

    def test_download_refuses_credential_forwarding_and_digest_mismatch(self):
        network = attestor.Network(environment())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "archive.zip"
            for url in (
                "http://host.blob.core.windows.net/x",
                "https://evil.test/x",
                "https://user@host.blob.core.windows.net/x",
            ):
                with self.subTest(url=url), self.assertRaisesRegex(ValueError, "download_origin"):
                    network.download(url, output, "a" * 64)
            stream = io.BytesIO(b"synthetic")
            network.open = Mock(return_value=stream)
            with self.assertRaisesRegex(ValueError, "archive_digest"):
                network.download("https://host.blob.core.windows.net/x", output, "a" * 64)
            self.assertEqual(network.open.call_args.args, ("https://host.blob.core.windows.net/x",))
            self.assertEqual(network.open.call_args.kwargs, {})

    def test_redirects_are_never_followed_and_results_origin_is_fixed(self):
        self.assertIsNone(
            attestor.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.test")
        )
        env = environment()
        env["ACTIONS_RESULTS_URL"] = "https://evil.test"
        with self.assertRaisesRegex(ValueError, "results_origin"):
            attestor.Network(env).results("ListArtifacts", {})


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.env = environment() | {
            "ATTESTOR_OUTPUT": str(self.root / "proof"),
            "SOURCE_ROOT": str(self.root / "source"),
            "ACTIONS_RUNTIME_TOKEN": token(),
            "ATTESTOR_GH": "/fixed/gh",
        }
        self.closure = {
            "inputs": {"source_sha": SOURCE, "files": {"source": "f" * 64}},
            "contracts": {
                "versions": ["0.0.0-dev.100.2", "0.0.0-dev.100.3"],
                "target_schema": 4,
                "migration_manifest_sha256": "e" * 64,
            },
        }
        self.network = FakeNetwork()
        original_results = self.network.results
        self.network.results = lambda operation, data: (
            {"signed_url": "https://host.blob.core.windows.net/object?synthetic"}
            if operation == "GetSignedArtifactURL"
            else original_results(operation, data)
        )

        def download(url, destination, expected):
            with zipfile.ZipFile(destination, "w") as bundle:
                extension = contract.selection(self.env["BUILD_SELECTION"], ROOT)["formats"][0]
                bundle.writestr(f"package.{extension}", b"synthetic-package")

        self.network.download = download

    def prepare(self):
        with (
            patch.object(contract, "source_contract", return_value=(self.closure, "c" * 40)),
            patch.object(attestor, "inspect_native") as inspect,
        ):
            manifest = attestor.prepare(self.env, self.network)
        self.assertEqual(inspect.call_args.args[2], "0.0.0-dev.100.2")
        return manifest

    def verified_result(self, manifest):
        output = Path(self.env["ATTESTOR_OUTPUT"])
        self.env["ATTESTATION_BUNDLE"] = str(self.root / "synthetic-bundle.jsonl")
        Path(self.env["ATTESTATION_BUNDLE"]).write_text('{"synthetic":true}\n')
        return {
            "verificationResult": {
                "signature": {
                    "certificate": {
                        "issuer": "https://token.actions.githubusercontent.com",
                        "sourceRepositoryURI": "https://github.com/ohtia/ohtia",
                        "sourceRepositoryIdentifier": "1431132416",
                        "sourceRepositoryOwnerIdentifier": "346940169",
                        "sourceRepositoryDigest": MAIN,
                        "sourceRepositoryRef": "refs/heads/main",
                        "runnerEnvironment": "github-hosted",
                        "buildTrigger": "workflow_dispatch",
                        "buildSignerURI": f"https://github.com/ohtia/ohtia/{contract.RECIPE}@{RECIPE}",
                        "buildSignerDigest": RECIPE,
                        "runInvocationURI": "https://github.com/ohtia/ohtia/actions/runs/100/attempts/2",
                    }
                },
                "verifiedTimestamps": [{"synthetic": True}],
                "statement": {
                    "predicateType": contract.PREDICATE_TYPE,
                    "subject": [{"name": "package.deb", "digest": {"sha256": manifest["sha256"]}}],
                    "predicate": json.loads((output / "predicate.json").read_bytes()),
                },
            }
        }

    def test_emits_consumer_manifest_and_authenticated_producer_link(self):
        manifest = self.prepare()
        self.assertEqual(manifest["build_execution"]["job_id"], 202)
        self.assertEqual(manifest["native_version"], "0.0.0~dev.100.2-1")
        self.assertEqual(
            manifest["inputs_sha256"], contract.sha256(contract.canonical(self.closure))
        )
        result = self.verified_result(manifest)
        predicate = result["verificationResult"]["statement"]["predicate"]
        self.assertEqual(predicate["artifact"], manifest)
        self.assertEqual(predicate["producer"]["producer_job_id"], 201)
        runner = Mock(
            return_value=subprocess.CompletedProcess([], 0, stdout=contract.canonical([result]))
        )
        proof = attestor.verify_bundle(self.env, runner)
        self.assertEqual(set(proof), {"schema_version", "artifact", "bundle"})
        self.assertEqual(proof["artifact"], manifest)
        accepted = subprocess.check_output(
            [
                str(workspace.node_path()),
                "--input-type=module",
                "-e",
                "import {verifyBuildResult} from './tooling/installation-authority.mjs'; const x=JSON.parse(process.argv[1]); process.stdout.write(String(verifyBuildResult(x.result,x.request,x.policy,x.artifact)));",
                json.dumps(
                    {
                        "result": result["verificationResult"],
                        "request": {
                            "subject": {"source_commit": SOURCE},
                            "execution": {"workflow_sha": MAIN},
                            "input": {"sha256": manifest["sha256"]},
                        },
                        "policy": {
                            "repository_id": "1431132416",
                            "owner_id": "346940169",
                            "build_workflow": {"workflow": contract.RECIPE, "sha": RECIPE},
                        },
                        "artifact": manifest,
                    }
                ),
            ],
            cwd=ROOT,
        )
        self.assertEqual(accepted, b"true")
        command = runner.call_args.args[0]
        self.assertEqual(command[command.index("--predicate-type") + 1], contract.PREDICATE_TYPE)
        self.assertIn("--deny-self-hosted-runners", command)
        self.assertNotIn("--no-public-good", command)
        self.assertEqual(command[command.index("--signer-digest") + 1], RECIPE)
        self.assertNotIn("ACTIONS_RUNTIME_TOKEN", runner.call_args.kwargs["env"])
        self.assertFalse(
            Path(runner.call_args.kwargs["env"]["GH_CONFIG_DIR"]).is_relative_to(
                Path(self.env["ATTESTOR_OUTPUT"])
            )
        )
        self.assertFalse((Path(self.env["ATTESTOR_OUTPUT"]) / "artifact.zip").exists())

    def test_signing_recipe_installs_verifier_with_distinct_recipe_and_source_commits(self):
        import scaleway_cycle
        import scaleway_ledger

        env = self.env | {
            "ATTESTOR_OPERATION": "install-cli",
            "ATTESTOR_GH_DIRECTORY": str(self.root / "gh"),
            "GITHUB_WORKFLOW_REF": "ohtia/ohtia/.github/workflows/installation-signing.yml@refs/heads/main",
        }
        self.assertNotEqual(env["GITHUB_SHA"], env["RECIPE_SHA"])
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(contract, "git", return_value=(RECIPE + "\n").encode()),
            patch.object(scaleway_ledger, "install_cli") as installer,
            patch.object(
                scaleway_cycle,
                "source_context",
                side_effect=AssertionError("ARM guard must not be reused"),
            ),
        ):
            attestor.main()
        installer.assert_called_once_with(Path(env["ATTESTOR_GH_DIRECTORY"]))
        with patch.object(contract, "git", return_value=(SOURCE + "\n").encode()):
            with self.assertRaisesRegex(ValueError, "recipe_checkout"):
                attestor.install_verifier(env)

    def test_all_six_manifests_pass_complete_build_authority_and_signer_preflight(self):
        fixtures = []
        for arch in ("x64", "arm64"):
            for profile in ("ubuntu-26.04", "debian-13", "fedora-44"):
                selected = f"linux-{arch}-{profile}"
                self.env["BUILD_SELECTION"] = selected
                self.env["ATTESTOR_OUTPUT"] = str(self.root / selected)
                manifest = self.prepare()
                self.assertRegex(manifest["id"], r"^[a-z][a-z0-9-]{0,127}$")
                fixtures.append({"artifact": manifest, "result": self.verified_result(manifest)})
        self.assertEqual(len({f["artifact"]["id"] for f in fixtures}), 6)
        checked = subprocess.check_output(
            [
                str(workspace.node_path()),
                "--input-type=module",
                "-e",
                r"""import assert from "node:assert/strict";
import {createPublicKey} from "node:crypto";
import {canonical,hash,GitHubBuildAuthority} from "./tooling/installation-authority.mjs";
import {SigningService,validateRequest} from "./tooling/installation-signer.mjs";
const fixtures=JSON.parse(process.argv[1]);
const publicKey=createPublicKey({key:Buffer.from("302a300506032b6570032100"+"01".repeat(32),"hex"),format:"der",type:"spki"}).export({format:"pem",type:"spki"}).toString();
const policy={schema_version:1,enabled:false,repository_id:"1431132416",owner_id:"346940169",audience:"ohtia:installation-signing",environment:"installation-signing",caller_workflow:".github/workflows/installation-signing.yml",signing_workflow:{workflow:".github/workflows/signing-worker.yml",sha:"c".repeat(40)},build_workflow:{workflow:".github/workflows/signing-build.yml",sha:"b".repeat(40)},catalog_public_key:publicKey,rpm_primary:"1".repeat(40),rpm_subkey:"2".repeat(40),deployment:{provider:"scaleway-serverless-containers",region:"fr-par",container_id:"12345678-1234-1234-1234-123456789abc",image_digest:"sha256:"+"f".repeat(64)}};
for(const fixture of fixtures){
 const a=fixture.artifact;
 const proof={schema_version:1,artifact:a,bundle:"synthetic bundle; verifier mocked"};
 const proofBytes=canonical(proof);
 const request={schema_version:1,operation:a.format==="rpm"?"rpm-sign":"deb-bind",subject:{kind:"qualification",id:"synthetic-subject",repository:"ohtia/ohtia",application_version:"0.0.0-dev.100.2",source_commit:a.source_commit,source_tree:a.source_tree},execution:{workflow:policy.signing_workflow.workflow,workflow_sha:fixture.result.verificationResult.signature.certificate.sourceRepositoryDigest,run_id:100,attempt:2,job_id:303,invocation:"synthetic-signing"},artifact_id:a.id,input:{sha256:a.sha256,bytes:a.bytes},build_proof:{sha256:hash(proofBytes),bytes:proofBytes.length},catalog_bindings:[]};
 validateRequest(canonical(request));
 const authority=new GitHubBuildAuthority(policy,{job:async(id)=>({id,run_id:100,run_attempt:2,head_sha:request.execution.workflow_sha,status:"completed",conclusion:"success"}),runner:async()=>Buffer.from(JSON.stringify([fixture.result]))});
 assert.deepEqual(await authority.verify("synthetic-input-not-executed",proof,request),a);
 SigningService.prototype.checkArtifact.call({policy},request,a);
}
process.stdout.write(String(fixtures.length));""",
                json.dumps(fixtures),
            ],
            cwd=ROOT,
        )
        self.assertEqual(checked, b"6")

    def test_verification_refuses_other_recipe_source_run_attempt_or_job(self):
        manifest = self.prepare()
        for kind in (
            "recipe",
            "source",
            "run",
            "attempt",
            "job",
            "digest",
            "timestamp",
            "type",
            "version",
            "boolean_version",
            "producer",
            "extra",
            "missing",
        ):
            with self.subTest(kind=kind):
                result = self.verified_result(manifest)
                verified = result["verificationResult"]
                cert = verified["signature"]["certificate"]
                if kind == "recipe":
                    cert["buildSignerDigest"] = "c" * 40
                elif kind == "source":
                    cert["sourceRepositoryDigest"] = "c" * 40
                elif kind in {"run", "attempt"}:
                    cert["runInvocationURI"] = (
                        f"https://github.com/ohtia/ohtia/actions/runs/{101 if kind == 'run' else 100}/attempts/{1 if kind == 'attempt' else 2}"
                    )
                elif kind == "job":
                    verified["statement"]["predicate"]["artifact"]["build_execution"]["job_id"] = (
                        201
                    )
                elif kind == "digest":
                    verified["statement"]["subject"][0]["digest"]["sha256"] = "c" * 64
                elif kind == "timestamp":
                    verified["verifiedTimestamps"] = []
                elif kind == "type":
                    verified["statement"]["predicateType"] = "https://slsa.dev/provenance/v1"
                elif kind == "version":
                    verified["statement"]["predicate"]["schema_version"] = 2
                elif kind == "boolean_version":
                    verified["statement"]["predicate"]["schema_version"] = True
                elif kind == "producer":
                    verified["statement"]["predicate"]["producer"]["producer_job_id"] = 999
                elif kind == "extra":
                    verified["statement"]["predicate"]["unrecognized"] = True
                else:
                    del verified["statement"]["predicate"]["producer"]
                runner = Mock(
                    return_value=subprocess.CompletedProcess(
                        [], 0, stdout=contract.canonical([result])
                    )
                )
                with self.assertRaisesRegex(ValueError, "verified_build_identity"):
                    attestor.verify_bundle(self.env, runner)
        self.assertFalse((Path(self.env["ATTESTOR_OUTPUT"]) / "build-proof.json").exists())

    def test_failed_cryptographic_verifier_never_releases_a_proof(self):
        manifest = self.prepare()
        self.verified_result(manifest)
        runner = Mock(side_effect=subprocess.CalledProcessError(1, ["/fixed/gh"]))
        with self.assertRaises(subprocess.CalledProcessError):
            attestor.verify_bundle(self.env, runner)
        self.assertFalse((Path(self.env["ATTESTOR_OUTPUT"]) / "build-proof.json").exists())

    def test_native_inspection_requires_correct_epoch_version_name_and_architecture(self):
        for arch in ("x64", "arm64"):
            for profile in ("debian-13", "fedora-44"):
                cell = contract.selection(f"linux-{arch}-{profile}", ROOT)
                rpm = profile == "fedora-44"
                expected_arch = (
                    ("x86_64" if arch == "x64" else "aarch64")
                    if rpm
                    else ("amd64" if arch == "x64" else "arm64")
                )
                fields = [
                    "ohtia-quality",
                    *(["0"] if rpm else []),
                    "0.0.0~dev.100.2-1",
                    expected_arch,
                ]
                runner = Mock(
                    return_value=subprocess.CompletedProcess(
                        [], 0, stdout=("\n".join(fields) + "\n").encode()
                    )
                )
                attestor.inspect_native(self.root / "package", cell, "0.0.0-dev.100.2", runner)
                for index in range(len(fields)):
                    wrong = fields.copy()
                    wrong[index] = "unexpected"
                    runner.return_value.stdout = ("\n".join(wrong) + "\n").encode()
                    with self.assertRaisesRegex(ValueError, "native_metadata"):
                        attestor.inspect_native(
                            self.root / "package", cell, "0.0.0-dev.100.2", runner
                        )
                self.assertNotIn("GITHUB_TOKEN", runner.call_args.kwargs["env"])

    def test_unsigned_builder_refuses_credentials_and_copies_only_selected_package(self):
        env = self.env | {"BUILD_OUTPUT": str(self.root / "unsigned")}
        for key in ("SCW_SECRET_KEY", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "CSC_KEY_PASSWORD"):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "credentialed_builder"):
                builder.build(self.root, ROOT, Path(env["BUILD_OUTPUT"]), env | {key: "synthetic"})
        packages = self.root / "packages"
        packages.mkdir()
        (packages / "built.deb").write_bytes(b"synthetic-package")
        helper = Mock()
        helper.construct_package.return_value = packages
        with (
            patch.dict(sys.modules, {"quality_native": helper}),
            patch.object(contract, "source_contract", return_value=(self.closure, "c" * 40)),
            patch.object(sys, "path", sys.path.copy()),
        ):
            builder.build(self.root, ROOT, Path(env["BUILD_OUTPUT"]), env)
        self.assertEqual(
            (Path(env["BUILD_OUTPUT"]) / "package.deb").read_bytes(), b"synthetic-package"
        )
        self.assertEqual(helper.construct_package.call_args.args[2], "0.0.0-dev.100.2")


class SourceTests(unittest.TestCase):
    def test_inspects_source_as_data_and_rejects_modified_tracked_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            safe = {
                "PATH": os.environ["PATH"],
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_TERMINAL_PROMPT": "0",
            }

            def git(*args):
                return (
                    subprocess.check_output(
                        ["git", *args], cwd=root, env=safe, stderr=subprocess.DEVNULL
                    )
                    .decode()
                    .strip()
                )

            git("init", "-q")
            migration = root / "packages/utility/src/migrations/manifest.json"
            migration.parent.mkdir(parents=True)
            migration.write_text('[{"name":"synthetic"}]\n')
            (root / "candidate.py").write_text('raise RuntimeError("must not execute")\n')
            git("add", ".")
            git(
                "-c",
                "user.name=Synthetic fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "Synthetic source",
            )
            context = contract.identity(environment())
            context["source"] = git("rev-parse", "HEAD")
            closure, tree = contract.source_contract(root, context)
            self.assertEqual(tree, git("rev-parse", "HEAD^{tree}"))
            self.assertEqual(
                closure["contracts"]["versions"], ["0.0.0-dev.100.2", "0.0.0-dev.100.3"]
            )
            self.assertEqual(closure["inputs"]["source_sha"], context["source"])
            (root / "candidate.py").write_text("modified")
            with self.assertRaisesRegex(ValueError, "changed_source"):
                contract.source_contract(root, context)


if __name__ == "__main__":
    unittest.main()
