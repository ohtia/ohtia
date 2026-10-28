"""Verify hosted-only image publication and immutable OCI identity handling."""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import linux_e2e_image_ci as producer


class ImageCIProducerTests(unittest.TestCase):
    def test_local_or_foreign_contexts_are_refused_before_production(self):
        environment = {
            "GITHUB_ACTIONS": "true",
            "RUNNER_ENVIRONMENT": "github-hosted",
            "GITHUB_REPOSITORY": "ohtia/ohtia",
            "GITHUB_EVENT_NAME": "push",
            "GITHUB_SHA": "a" * 40,
            "GITHUB_RUN_ID": "123",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(producer, "captured", return_value="a" * 40),
        ):
            self.assertEqual(producer.context()["source_commit"], "a" * 40)
        for key, value in (
            ("GITHUB_ACTIONS", "false"),
            ("RUNNER_ENVIRONMENT", "self-hosted"),
            ("GITHUB_REPOSITORY", "fixture/foreign"),
            ("GITHUB_EVENT_NAME", "pull_request"),
            ("GITHUB_SHA", "not-a-sha"),
        ):
            with (
                patch.dict(os.environ, {**environment, key: value}, clear=True),
                self.assertRaises(ValueError),
            ):
                producer.context()

    def test_export_binds_manifest_config_and_nonroot_architecture(self):
        def data(value):
            raw = json.dumps(value).encode()
            return raw, "sha256:" + hashlib.sha256(raw).hexdigest()

        for user in ("pwuser", "root"):
            config, config_hash = data(
                {"architecture": "amd64", "os": "linux", "config": {"User": user}}
            )
            manifest, manifest_hash = data({"config": {"digest": config_hash}})
            index, _ = data({"manifests": [{"digest": manifest_hash}]})
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

    def test_failed_qualification_cannot_reach_registry_authentication(self):
        provenance = {"source_commit": "a" * 40, "run_url": "https://example.invalid/synthetic-run"}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "native").mkdir()
            (output / "candidate.json").write_text(json.dumps(provenance))
            (output / "native/result.json").write_text(json.dumps({"status": "failed", "cases": 9}))
            with (
                patch.object(producer, "OUTPUT", output),
                patch.object(producer, "context", return_value=provenance),
                patch.object(producer, "command") as command,
                self.assertRaisesRegex(ValueError, "complete native qualification"),
            ):
                producer.publish()
            command.assert_not_called()

    def test_published_index_must_retain_the_qualified_configuration(self):
        descriptor = "sha256:" + "b" * 64
        config = "sha256:" + "c" * 64
        with patch.object(
            producer,
            "captured",
            side_effect=[
                json.dumps({"manifests": [{"digest": descriptor}]}),
                json.dumps({"config": {"digest": config}}),
            ],
        ):
            self.assertEqual(producer.remote_manifest("synthetic-tag", config), descriptor)
        with (
            patch.object(
                producer, "captured", return_value=json.dumps({"config": {"digest": "wrong"}})
            ),
            self.assertRaisesRegex(ValueError, "configuration mismatch"),
        ):
            producer.remote_manifest("synthetic-tag", config)


if __name__ == "__main__":
    unittest.main()
