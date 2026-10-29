"""Verify hosted image production, input-addressed publication and consumer re-runs."""

from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import linux_e2e_image_ci as producer

RUN = "4242"
PROVENANCE = {
    "producer": "github-hosted",
    "source_commit": "a" * 40,
    "source_tree": "b" * 40,
    "run_url": f"https://github.com/ohtia/ohtia/actions/runs/{RUN}",
}
RECORDS = {"tools/linux-e2e/Dockerfile": {"mode": "100644", "sha256": "c" * 64}}
IDENTITY = producer.fingerprint(RECORDS)
TAG = producer.linux_e2e.image_tag(IDENTITY)
MANIFEST = "sha256:" + "d" * 64
CONFIGURATION = "sha256:" + "e" * 64
LOCAL = "sha256:" + "f" * 64
CREDENTIALS = {"GH_TOKEN": "synthetic-secret", "GH_ACTOR": "fixture-actor"}


def http_error(status):
    return producer.urllib.error.HTTPError(
        "https://ghcr.io/v2/fixture", status, "fixture", {}, None
    )


def blob(value):
    raw = json.dumps(value).encode()
    return raw, "sha256:" + hashlib.sha256(raw).hexdigest()


def local_image(identity=IDENTITY):
    return {
        "Id": LOCAL,
        "Architecture": "amd64",
        "Os": "linux",
        "Config": {"User": "pwuser", "Labels": {"io.ohtia.image-inputs": identity}},
    }


def qualified():
    config = producer.linux_e2e.configuration()
    identity = {
        "run": "synthetic-native-qualification",
        "input_fingerprint": IDENTITY,
        "image": TAG,
        "image_id": LOCAL,
    }
    reports = [
        {
            "shard": name,
            "identity": identity,
            "status": "passed",
            "preparation": "passed",
            "cases": [{"id": case, "status": "passed", "attempts": 1} for case in cases],
        }
        for name, cases in config["shards"].items()
    ]
    candidate = {
        **PROVENANCE,
        "tag": TAG,
        "inputs": RECORDS,
        "input_fingerprint": IDENTITY,
        "config_digest": CONFIGURATION,
        "local_image_id": LOCAL,
        "webkit_record_sha256": "9" * 64,
        "qualification_identity": identity,
    }
    native = {
        "identity": identity,
        "status": "passed",
        "shards": len(config["shards"]),
        "cases": sum(len(cases) for cases in config["shards"].values()),
        "reports": reports,
    }
    return candidate, native


def retain(output, candidate, native):
    (output / "native").mkdir(parents=True)
    (output / "candidate.json").write_text(json.dumps(candidate))
    (output / "native/result.json").write_text(json.dumps(native))


class HostedContextTests(unittest.TestCase):
    ENVIRONMENT = {
        "GITHUB_ACTIONS": "true",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_EVENT_NAME": "push",
        "GITHUB_SHA": "a" * 40,
        "GITHUB_RUN_ID": RUN,
    }

    def test_only_this_repository_hosted_push_or_dispatch_can_produce(self):
        for event in ("push", "workflow_dispatch"):
            with (
                patch.dict(
                    os.environ, {**self.ENVIRONMENT, "GITHUB_EVENT_NAME": event}, clear=True
                ),
                patch.object(producer, "captured", side_effect=["a" * 40, "b" * 40]),
                patch.object(producer.linux_e2e, "checkout_identity") as identity,
            ):
                self.assertEqual(producer.context(), PROVENANCE)
                identity.assert_called_once()
        for key, value in (
            ("GITHUB_ACTIONS", "false"),
            ("RUNNER_ENVIRONMENT", "self-hosted"),
            ("GITHUB_REPOSITORY", "fixture/foreign"),
            ("GITHUB_EVENT_NAME", "pull_request"),
            ("GITHUB_SHA", "not-a-sha"),
        ):
            with (
                self.subTest(key=key),
                patch.dict(os.environ, {**self.ENVIRONMENT, key: value}, clear=True),
                patch.object(producer, "captured", return_value="a" * 40),
                patch.object(producer.linux_e2e, "checkout_identity") as identity,
                self.assertRaises(ValueError),
            ):
                producer.context()
            identity.assert_not_called()

    def test_an_unqualifiable_event_identity_stops_before_the_build(self):
        with (
            patch.dict(os.environ, self.ENVIRONMENT, clear=True),
            patch.object(producer, "captured", return_value="a" * 40),
            patch.object(
                producer.linux_e2e,
                "checkout_identity",
                side_effect=ValueError("Declared base is not an ancestor of the checkout."),
            ),
            patch.object(producer, "prerequisites") as prerequisites,
            patch.object(producer, "command") as command,
            self.assertRaisesRegex(ValueError, "ancestor"),
        ):
            producer.build()
        prerequisites.assert_not_called()
        command.assert_not_called()


class PublicationLookupTests(unittest.TestCase):
    def registry(self, objects):
        def get(path, bearer, accept=None):
            if path not in objects:
                raise http_error(404)
            return objects[path]

        return patch.object(producer, "registry_get", side_effect=get)

    def image(self, label=IDENTITY, user="pwuser"):
        config, config_digest = blob(
            {
                "architecture": "amd64",
                "os": "linux",
                "config": {"User": user, "Labels": {"io.ohtia.image-inputs": label}},
            }
        )
        manifest, manifest_digest = blob({"config": {"digest": config_digest}})
        return config, config_digest, manifest, manifest_digest

    def test_missing_publication_is_absent_but_other_registry_failures_never_mean_build(self):
        with self.registry({}):
            self.assertIsNone(producer.published(IDENTITY, "bearer"))
        for status in (401, 403, 500):
            with (
                self.subTest(status=status),
                patch.object(producer, "registry_get", side_effect=http_error(status)),
                self.assertRaisesRegex(ValueError, f"HTTP {status}"),
            ):
                producer.published(IDENTITY, "bearer")

    def test_single_manifest_and_index_resolve_to_the_labelled_amd64_configuration(self):
        config, config_digest, manifest, manifest_digest = self.image()
        with self.registry(
            {"manifests/inputs-" + IDENTITY: manifest, "blobs/" + config_digest: config}
        ):
            self.assertEqual(
                producer.published(IDENTITY, "bearer"),
                {"manifest": manifest_digest, "config": config_digest},
            )
        attestation, attestation_digest = blob({"config": {"digest": config_digest}})
        index, _ = blob(
            {
                "manifests": [
                    {
                        "digest": manifest_digest,
                        "platform": {"architecture": "amd64", "os": "linux"},
                    },
                    {"digest": attestation_digest, "platform": {"architecture": "unknown"}},
                ]
            }
        )
        objects = {
            "manifests/inputs-" + IDENTITY: index,
            "manifests/" + manifest_digest: manifest,
            "blobs/" + config_digest: config,
        }
        with self.registry(objects):
            self.assertEqual(producer.published(IDENTITY, "bearer")["manifest"], manifest_digest)
        with self.registry({**objects, "manifests/" + manifest_digest: b'{"tampered":true}'}):
            with self.assertRaisesRegex(ValueError, "manifest digest"):
                producer.published(IDENTITY, "bearer")

    def test_foreign_label_account_or_altered_configuration_is_refused(self):
        for label, user in (("0" * 64, "pwuser"), (IDENTITY, "root")):
            config, config_digest, manifest, _ = self.image(label, user)
            with (
                self.subTest(label=label, user=user),
                self.registry(
                    {"manifests/inputs-" + IDENTITY: manifest, "blobs/" + config_digest: config}
                ),
                self.assertRaisesRegex(ValueError, "declared inputs"),
            ):
                producer.published(IDENTITY, "bearer")
        config, config_digest, manifest, _ = self.image()
        with (
            self.registry(
                {"manifests/inputs-" + IDENTITY: manifest, "blobs/" + config_digest: config + b" "}
            ),
            self.assertRaisesRegex(ValueError, "configuration digest"),
        ):
            producer.published(IDENTITY, "bearer")

    def test_blob_redirect_is_followed_without_the_registry_credential(self):
        redirect = producer.urllib.error.HTTPError(
            "https://ghcr.io/v2/ohtia/linux-e2e/blobs/x",
            307,
            "redirect",
            {"Location": "https://objects.example.invalid/signed"},
            None,
        )

        def refuse(request, timeout):
            raise redirect

        followed = []

        def urlopen(request, timeout):
            followed.append(request)
            return contextlib.nullcontext(io.BytesIO(b"payload"))

        with (
            patch.object(
                producer.urllib.request,
                "build_opener",
                return_value=SimpleNamespace(open=refuse),
            ),
            patch.object(producer.urllib.request, "urlopen", side_effect=urlopen),
        ):
            self.assertEqual(producer.registry_get("blobs/x", "secret-bearer"), b"payload")
        self.assertEqual(followed, ["https://objects.example.invalid/signed"])


class PlanTests(unittest.TestCase):
    def decide(self, existing):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            with (
                patch.dict(os.environ, {"GITHUB_OUTPUT": str(output), **CREDENTIALS}, clear=True),
                patch.object(producer, "inputs", return_value=RECORDS),
                patch.object(producer, "registry_token", return_value="bearer"),
                patch.object(
                    producer,
                    "published",
                    side_effect=existing if isinstance(existing, Exception) else None,
                    return_value=existing,
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                decision = producer.plan()
            return decision, output.read_text()

    def test_construction_is_requested_only_when_the_publication_is_absent(self):
        decision, written = self.decide({"manifest": MANIFEST})
        self.assertEqual(decision["build"], "false")
        self.assertIn("build=false", written)
        decision, written = self.decide(None)
        self.assertEqual(decision, {"build": "true", "inputs": IDENTITY})
        self.assertIn("build=true", written)

    def test_registry_uncertainty_stops_without_requesting_a_build(self):
        with self.assertRaisesRegex(ValueError, "HTTP 403"):
            self.decide(ValueError("GHCR image lookup failed (HTTP 403)."))

    def test_workflow_triggers_only_on_declared_inputs_and_gates_construction(self):
        workflow = (producer.ROOT / producer.WORKFLOW).read_text().splitlines()
        start = workflow.index("    paths:")
        paths = []
        for line in workflow[start + 1 :]:
            if not line.startswith("      - "):
                break
            paths.append(line.removeprefix("      - "))
        declared = json.loads((producer.ROOT / "config/desktop/linux-e2e-build.json").read_text())
        self.assertEqual(sorted(paths), sorted(declared["image_inputs"]))
        text = "\n".join(workflow)
        self.assertIn("if: needs.plan.outputs.build == 'true'", text)
        self.assertIn("runs-on: ${{ vars.LINUX_E2E_IMAGE_RUNNER || 'ubuntu-26.04' }}", text)
        self.assertNotIn("pull_request", text)
        self.assertEqual(text.count("python3 scripts/linux_e2e_image_ci.py rerun"), 1)
        # Recovery must also run when planning found the publication and skipped construction.
        self.assertIn("!cancelled() && needs.plan.result == 'success' &&", text)
        self.assertIn(
            "(needs.plan.outputs.build == 'false' || needs.image.result == 'success')", text
        )
        self.assertIn("group: linux-e2e-image-recovery-${{ needs.plan.outputs.inputs }}", text)
        # Only the recovery job may re-run checks.
        self.assertEqual(text.count("actions: write"), 1)
        self.assertIn("inputs: ${{ steps.plan.outputs.inputs }}", text)
        self.assertIn("group: linux-e2e-image-inputs-${{ needs.plan.outputs.inputs }}", text)
        self.assertIn("if: steps.build.outputs.published != 'true'", text)


class ConstructionTests(unittest.TestCase):
    def construct(self, existing, probe=None):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            with (
                patch.dict(os.environ, {**CREDENTIALS, "GITHUB_OUTPUT": str(output)}),
                patch.object(producer, "context", return_value=PROVENANCE),
                patch.object(producer, "prerequisites") as prerequisites,
                patch.object(producer, "inputs", return_value=RECORDS),
                patch.object(producer, "registry_token", return_value="bearer"),
                patch.object(producer, "published", return_value=existing),
                patch.object(producer, "write_probe", side_effect=probe),
                patch.object(producer, "command") as command,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                try:
                    return producer.build()
                finally:
                    self.calls = SimpleNamespace(
                        prerequisites=prerequisites,
                        command=command,
                        output=output.read_text() if output.exists() else "",
                    )

    def test_a_serialized_successor_reuses_the_publication_without_construction(self):
        self.assertIsNone(self.construct({"manifest": MANIFEST}))
        self.assertIn("published=true", self.calls.output)
        self.calls.prerequisites.assert_not_called()
        self.calls.command.assert_not_called()

    def test_missing_write_scope_prevents_construction(self):
        with self.assertRaisesRegex(ValueError, "HTTP 403"):
            self.construct(None, ValueError("GHCR package-write probe failed (HTTP 403)"))
        self.calls.command.assert_not_called()

    def test_qualification_uses_the_local_input_tag_without_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            commands = []

            def command(args, **options):
                commands.append((args, options))
                if args[:2] == ["docker", "save"]:
                    (output / "image.oci.tar").touch()
                if args[0] == "bash":
                    self.assertFalse(any(key.startswith("GH_") for key in options["env"]))
                    raise producer.subprocess.CalledProcessError(7, args)

            with (
                patch.dict(os.environ, CREDENTIALS),
                patch.object(producer, "OUTPUT", output),
                patch.object(producer, "context", return_value=PROVENANCE),
                patch.object(producer, "prerequisites"),
                patch.object(producer, "inputs", return_value=RECORDS),
                patch.object(producer, "registry_token", return_value="bearer"),
                patch.object(producer, "published", return_value=None),
                patch.object(producer, "write_probe"),
                patch.object(producer, "receipt", return_value="9" * 64),
                patch.object(producer, "local_image", return_value=local_image()),
                patch.object(producer, "image_identity", return_value=(MANIFEST, CONFIGURATION)),
                patch.object(producer, "command", side_effect=command),
                self.assertRaises(producer.subprocess.CalledProcessError),
            ):
                producer.build()
            self.assertFalse((output / "candidate.json").exists())
            build = commands[0][0]
            self.assertIn("io.ohtia.image-inputs=" + IDENTITY, build)
            self.assertIn("org.opencontainers.image.revision=" + "a" * 40, build)
            self.assertEqual(build[build.index("--tag") + 1], TAG)
            self.assertFalse(any("push" in args for args, _ in commands))

    def test_export_binds_manifest_config_and_nonroot_architecture(self):
        for user in ("pwuser", "root"):
            config, config_hash = blob(
                {"architecture": "amd64", "os": "linux", "config": {"User": user}}
            )
            manifest, manifest_hash = blob({"config": {"digest": config_hash}})
            index, _ = blob({"manifests": [{"digest": manifest_hash}]})
            with tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / "image.tar"
                with tarfile.open(file, "w") as archive:
                    for name, raw in (
                        ("index.json", index),
                        ("blobs/sha256/" + manifest_hash.split(":")[1], manifest),
                        ("blobs/sha256/" + config_hash.split(":")[1], config),
                    ):
                        entry = tarfile.TarInfo(name)
                        entry.size = len(raw)
                        archive.addfile(entry, io.BytesIO(raw))
                if user == "pwuser":
                    self.assertEqual(producer.image_identity(file), (manifest_hash, config_hash))
                else:
                    with self.assertRaisesRegex(ValueError, "account mismatch"):
                        producer.image_identity(file)

    def test_missing_apparmor_or_old_engine_fails_before_any_build_operation(self):
        engine = {
            "Architecture": "x86_64",
            "SecurityOptions": ["name=apparmor"],
            "ServerVersion": "29.1.3",
        }
        for change, message in (
            ({"SecurityOptions": []}, "enforcing AppArmor"),
            ({"ServerVersion": "24.0.9"}, "Docker Engine 25"),
            ({"ServerVersion": ""}, "Docker Engine 25"),
        ):
            with (
                self.subTest(change=change),
                patch.object(producer.platform, "system", return_value="Linux"),
                patch.object(producer.platform, "machine", return_value="x86_64"),
                patch.object(producer, "captured", return_value=json.dumps({**engine, **change})),
                patch.object(producer, "command") as command,
                self.assertRaisesRegex(ValueError, message),
            ):
                producer.prerequisites()
            command.assert_not_called()


class PublicationTests(unittest.TestCase):
    def publish(self, output, native=None, fault=None):
        candidate, complete = qualified()
        retain(output, candidate, native or complete)
        lookups = [
            {"manifest": MANIFEST, "config": CONFIGURATION} if fault == "concurrent" else None,
            {
                "manifest": MANIFEST,
                "config": "sha256:" + "0" * 64 if fault == "configuration" else CONFIGURATION,
            },
        ]
        image = local_image()
        if fault == "replaced":
            image["Id"] = "sha256:" + "1" * 64
        stdout = io.StringIO()
        with (
            patch.dict(os.environ, CREDENTIALS),
            patch.object(producer, "OUTPUT", output),
            patch.object(producer, "context", return_value=PROVENANCE),
            patch.object(
                producer, "inputs", return_value={"changed": {}} if fault == "drift" else RECORDS
            ),
            patch.object(producer, "local_image", return_value=image),
            patch.object(
                producer, "receipt", return_value="0" * 64 if fault == "receipt" else "9" * 64
            ),
            patch.object(producer, "registry_token", return_value="bearer") as token,
            patch.object(producer, "published", side_effect=lookups),
            patch.object(
                producer, "docker_session", return_value=contextlib.nullcontext({})
            ) as session,
            patch.object(producer, "command") as command,
            contextlib.redirect_stdout(stdout),
        ):
            try:
                return producer.publish(), stdout.getvalue()
            finally:
                self.calls = SimpleNamespace(token=token, session=session, command=command)

    def test_incomplete_or_foreign_qualification_never_reaches_the_registry(self):
        _, native = qualified()
        changes = [
            lambda value: value["reports"].pop(),
            lambda value: value["reports"][0]["cases"].pop(),
            lambda value: value["reports"][0]["cases"][0].update(status="skipped"),
            lambda value: value["reports"][0].update(preparation="failed"),
            lambda value: value.update(shards=1),
            lambda value: value.update(cases=value["cases"] - 1),
            lambda value: value["identity"].update(image_id="sha256:" + "0" * 64),
            lambda value: value["identity"].update(input_fingerprint="0" * 64),
        ]
        for index, change in enumerate(changes):
            with self.subTest(change=index), tempfile.TemporaryDirectory() as directory:
                value = copy.deepcopy(native)
                change(value)
                for report in value["reports"]:
                    report["identity"] = value["identity"]
                with self.assertRaises(ValueError):
                    self.publish(Path(directory), value)
                self.calls.token.assert_not_called()
                self.calls.command.assert_not_called()

    def test_drift_replacement_overwrite_or_configuration_faults_never_publish_a_record(self):
        for fault in ("drift", "replaced", "receipt", "concurrent", "configuration"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                with self.assertRaises(ValueError):
                    self.publish(output, fault=fault)
                self.assertFalse((output / "publication.json").exists())
                if fault != "configuration":
                    self.calls.session.assert_not_called()

    def test_successful_publication_records_the_registry_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            record, stdout = self.publish(output)
            self.assertEqual(record["image"], TAG + "@" + MANIFEST)
            self.assertEqual(record["input_fingerprint"], IDENTITY)
            self.assertEqual(record["inputs"], RECORDS)
            self.assertEqual(self.calls.command.call_args.args[0], ["docker", "push", TAG])
            emitted = [line for line in stdout.splitlines() if line.startswith(producer.MARKER)]
            self.assertEqual(json.loads(emitted[0].removeprefix(producer.MARKER)), record)
            self.assertEqual(json.loads((output / "publication.json").read_text()), record)

    def test_write_probe_requires_accepted_upload_and_tolerates_only_unsupported_cancel(self):
        for cancellation in (None, 405, 401, 500):
            with self.subTest(cancellation=cancellation):
                cancelled = (
                    http_error(cancellation)
                    if cancellation
                    else contextlib.nullcontext(SimpleNamespace(status=204))
                )
                responses = [
                    contextlib.nullcontext(io.BytesIO(b'{"token":"synthetic-bearer"}')),
                    contextlib.nullcontext(
                        SimpleNamespace(
                            status=202,
                            headers={"Location": "/v2/ohtia/linux-e2e/blobs/uploads/synthetic"},
                        )
                    ),
                    cancelled,
                ]
                with (
                    patch.object(producer.urllib.request, "urlopen", side_effect=responses) as call,
                    contextlib.redirect_stdout(io.StringIO()),
                ):
                    if cancellation in (None, 405):
                        producer.write_probe(("actor", "synthetic-secret"))
                        self.assertEqual(
                            [item.args[0].get_method() for item in call.call_args_list],
                            ["GET", "POST", "DELETE"],
                        )
                    else:
                        with self.assertRaisesRegex(ValueError, f"HTTP {cancellation}") as caught:
                            producer.write_probe(("actor", "synthetic-secret"))
                        self.assertNotIn("synthetic-secret", str(caught.exception))


class FixedClock(producer.datetime):
    """Keep the dated recovery fixtures inside GitHub's 30-day re-run window."""

    @classmethod
    def now(cls, tz=None):
        return producer.datetime(2026, 10, 29, 18, 0, 0, tzinfo=tz)


class RerunTests(unittest.TestCase):
    MISSING = producer.linux_e2e.MISSING_IMAGE.format(IDENTITY)

    def run_record(self, identifier, branch, created, **changes):
        return {
            "id": identifier,
            "created_at": created,
            "head_branch": branch,
            "head_repository": {"full_name": "ohtia/ohtia"},
            "path": producer.CONSUMER,
            "status": "completed",
            "conclusion": "failure",
            "html_url": f"https://github.com/ohtia/ohtia/actions/runs/{identifier}",
            **changes,
        }

    def rerun(self, pages, logs, jobs=None, failures=()):
        """Serve listing pages, per-run jobs and per-job logs; selected calls fail."""
        calls = []

        def gh_api(*args):
            calls.append(args)
            path = next(value for value in args if value.startswith("repos/"))
            for suffix, message in failures:
                if path.endswith(suffix):
                    raise producer.GitHubError(message)
            if path.endswith("/workflows/ci.yml/runs"):
                page = int(next(value for value in args if value.startswith("page=")).split("=")[1])
                return json.dumps({"workflow_runs": pages[page - 1] if page <= len(pages) else []})
            if path.endswith("/jobs"):
                run = int(path.split("/")[-2])
                default = [{"id": run * 10, "conclusion": "failure"}]
                return json.dumps({"jobs": (jobs or {}).get(run, default)})
            if path.endswith("/logs"):
                return logs.get(int(path.split("/")[-2]), "")
            return ""

        with (
            patch.object(producer, "inputs", return_value=RECORDS),
            patch.object(producer, "gh_api", side_effect=gh_api),
            patch.object(producer, "datetime", FixedClock),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()) as stderr,
        ):
            try:
                result = producer.rerun()
            finally:
                self.stderr = stderr.getvalue()
                self.calls = calls
        return result, [args[-1] for args in calls if "POST" in args]

    def test_every_branch_waiting_for_this_image_is_re_run_newest_first(self):
        result, reruns = self.rerun(
            [
                [
                    self.run_record(3, "branch-c", "2026-10-28T12:00:00Z"),
                    self.run_record(2, "branch-b", "2026-10-28T11:00:00Z"),
                    self.run_record(1, "branch-a", "2026-10-28T10:00:00Z"),
                ]
            ],
            {10: "x " + self.MISSING + " y", 20: "Linux E2E refused: " + self.MISSING, 30: "other"},
        )
        self.assertEqual(result, [2, 1])
        self.assertEqual(
            reruns,
            [
                "repos/ohtia/ohtia/actions/runs/2/rerun-failed-jobs",
                "repos/ohtia/ohtia/actions/runs/1/rerun-failed-jobs",
            ],
        )
        listing = self.calls[0]
        self.assertIn("event=pull_request", listing)
        self.assertTrue(any(value.startswith("created=>=") for value in listing))
        job_queries = [args for args in self.calls if any(v.endswith("/jobs") for v in args)]
        self.assertTrue(job_queries)
        self.assertTrue(all("filter=latest" in args for args in job_queries))

    def test_all_pages_are_read_and_only_failed_jobs_logs_are_inspected(self):
        first = [
            self.run_record(
                1000 + index, f"busy-{index}", "2026-10-28T12:00:00Z", conclusion="success"
            )
            for index in range(100)
        ]
        second = [self.run_record(5, "branch-a", "2026-10-27T10:00:00Z")]
        result, _ = self.rerun(
            [first, second],
            {50: "unrelated", 51: self.MISSING},
            jobs={
                5: [
                    {"id": 50, "conclusion": "failure"},
                    {"id": 52, "conclusion": "success"},
                    {"id": 51, "conclusion": "failure"},
                ]
            },
        )
        self.assertEqual(result, [5])
        logs = [args for args in self.calls if str(args[-1]).endswith("/logs")]
        # gh api refuses log bodies with terminal escape sequences unless allowed.
        self.assertEqual(
            logs,
            [
                ("--allow-escape-sequences", "repos/ohtia/ohtia/actions/jobs/50/logs"),
                ("--allow-escape-sequences", "repos/ohtia/ohtia/actions/jobs/51/logs"),
            ],
        )

    def test_one_failing_check_never_blocks_the_others_and_is_reported(self):
        runs = [
            [
                self.run_record(2, "branch-b", "2026-10-28T11:00:00Z"),
                self.run_record(1, "branch-a", "2026-10-28T10:00:00Z"),
            ]
        ]
        with self.assertRaisesRegex(ValueError, "1 pull-request check"):
            self.rerun(
                runs,
                {10: self.MISSING},
                failures=(("/jobs/20/logs", "gh: Server Error (HTTP 502)"),),
            )
        self.assertIn(
            "repos/ohtia/ohtia/actions/runs/1/rerun-failed-jobs", [args[-1] for args in self.calls]
        )
        self.assertIn("HTTP 502", self.stderr)
        # An expired log is only a warning, so a stale branch cannot keep the job red.
        result, reruns = self.rerun(
            runs, {10: self.MISSING}, failures=(("/jobs/20/logs", "gh: Not Found (HTTP 404)"),)
        )
        self.assertEqual(result, [1])
        self.assertIn("Log unavailable", self.stderr)

    def test_the_cutoff_is_an_exact_timestamp_and_older_runs_are_never_re_run(self):
        now = producer.datetime(2026, 10, 29, 18, 0, 0, tzinfo=producer.timezone.utc)
        listed = [
            self.run_record(2, "fresh", "2026-09-29T18:00:01Z"),
            self.run_record(1, "stale", "2026-09-29T10:00:00Z"),
        ]
        calls = []

        def gh_api(*args):
            calls.append(args)
            return json.dumps({"workflow_runs": listed})

        with patch.object(producer, "gh_api", side_effect=gh_api):
            selected = producer.waiting_runs(now)
        self.assertEqual([run["id"] for run in selected], [2])
        self.assertIn("created=>=2026-09-29T18:00:00Z", calls[0])

    def test_the_listing_stops_at_github_result_limit_and_says_so(self):
        full = [
            self.run_record(index, f"branch-{index}", "2026-10-28T12:00:00Z", conclusion="success")
            for index in range(100)
        ]
        with (
            patch.object(producer, "datetime", FixedClock),
            patch.object(
                producer, "gh_api", return_value=json.dumps({"workflow_runs": full})
            ) as api,
            contextlib.redirect_stderr(io.StringIO()) as stderr,
        ):
            self.assertEqual(producer.waiting_runs(), [])
        self.assertEqual(api.call_count, 10)
        self.assertIn("1,000-run limit", stderr.getvalue())

    def test_gh_api_failures_carry_status_without_the_token(self):
        failed = SimpleNamespace(returncode=1, stdout="", stderr="gh: Not Found (HTTP 404)\n")
        with (
            patch.object(producer.subprocess, "run", return_value=failed) as run,
            self.assertRaisesRegex(producer.GitHubError, "HTTP 404"),
        ):
            producer.gh_api("repos/ohtia/ohtia/actions/jobs/1/logs")
        self.assertEqual(run.call_args.args[0][:2], ["gh", "api"])
        passed = SimpleNamespace(returncode=0, stdout="log text", stderr="")
        with patch.object(producer.subprocess, "run", return_value=passed):
            self.assertEqual(producer.gh_api("repos/ohtia/ohtia/actions/jobs/1/logs"), "log text")

    def test_superseded_passing_foreign_or_other_image_failures_are_left_alone(self):
        other = producer.linux_e2e.MISSING_IMAGE.format("0" * 64)
        cases = {
            "superseded": (
                [
                    self.run_record(5, "branch-a", "2026-10-28T12:00:00Z", conclusion="success"),
                    self.run_record(4, "branch-a", "2026-10-28T10:00:00Z"),
                ],
                {40: self.MISSING},
            ),
            "running": (
                [self.run_record(6, "branch-a", "2026-10-28T12:00:00Z", status="in_progress")],
                {60: self.MISSING},
            ),
            "fork": (
                [
                    self.run_record(
                        7,
                        "branch-a",
                        "2026-10-28T12:00:00Z",
                        head_repository={"full_name": "x/fork"},
                    )
                ],
                {70: self.MISSING},
            ),
            "deleted-fork": (
                [self.run_record(8, "branch-a", "2026-10-28T12:00:00Z", head_repository=None)],
                {80: self.MISSING},
            ),
            "workflow": (
                [self.run_record(9, "branch-a", "2026-10-28T12:00:00Z", path="other.yml")],
                {90: self.MISSING},
            ),
            "other-image": (
                [self.run_record(11, "branch-a", "2026-10-28T12:00:00Z")],
                {110: other},
            ),
            "none": ([], {}),
        }
        for name, (runs, logs) in cases.items():
            with self.subTest(case=name):
                result, reruns = self.rerun([runs], logs)
                self.assertEqual(result, [])
                self.assertEqual(reruns, [])


if __name__ == "__main__":
    unittest.main()
