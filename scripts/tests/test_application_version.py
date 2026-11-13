"""Exercise the root manifest as the only source of the application version."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import application_version
import workspace

CHECKOUT = Path(__file__).resolve().parents[2]


def manifest_root(directory: str, version: object) -> Path:
    root = Path(directory)
    (root / "package.json").write_text(json.dumps({"name": "ohtia", "version": version}))
    return root


class ApplicationVersionTests(unittest.TestCase):
    def test_release_uses_the_exact_root_version_and_development_adds_run_and_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = manifest_root(directory, "0.3.0")
            self.assertEqual(application_version.root_version(root), "0.3.0")
            self.assertEqual(application_version.development_version(12, 3, root), "0.3.0-dev.12.3")
        self.assertEqual(
            application_version.root_version(),
            json.loads((CHECKOUT / "package.json").read_text())["version"],
        )

    def test_malformed_leading_zero_and_prerelease_root_versions_are_refused(self):
        for version in (
            "0.3",
            "v0.3.0",
            "0.3.0 ",
            "0.3.0\n",
            "",
            3,
            None,
            ["0.3.0"],
            "00.3.0",
            "0.03.0",
            "0.3.01",
            "0.3.0-beta.1",
            "0.3.0-dev.1.1",
            "0.3.0+build.1",
        ):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                root = manifest_root(directory, version)
                with self.assertRaises(application_version.VersionError):
                    application_version.root_version(root)
                with self.assertRaises(application_version.VersionError):
                    application_version.development_version(1, 1, root)

    def test_unreadable_manifest_and_invalid_run_identity_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(application_version.VersionError):
                application_version.root_version(root)
            (root / "package.json").write_text("{")
            with self.assertRaises(application_version.VersionError):
                application_version.root_version(root)
            (root / "package.json").write_text("[]")
            with self.assertRaises(application_version.VersionError):
                application_version.root_version(root)
            manifest_root(directory, "0.3.0")
            for run, attempt in ((0, 1), (1, 0), (True, 1), ("1", 1), (1, 1.0)):
                with self.subTest(run=run, attempt=attempt):
                    with self.assertRaises(application_version.VersionError):
                        application_version.development_version(run, attempt, root)

    def test_development_pattern_names_the_final_version_run_and_attempt(self):
        self.assertEqual(
            application_version.DEVELOPMENT.fullmatch("0.3.0-dev.12.3").groups(),
            ("0.3.0", "12", "3"),
        )
        for value in ("0.3.0", "0.3.0-dev.0.1", "0.3.0-dev.1", "0.03.0-dev.1.1"):
            with self.subTest(value=value):
                self.assertIsNone(application_version.DEVELOPMENT.fullmatch(value))

    @unittest.skipUnless(workspace.node_path().is_file(), "Requires frozen workspace setup")
    def test_packaging_accepts_only_a_final_or_run_attempt_development_version(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "builder.json"
            for version, accepted in (
                ("0.3.0-dev.12.3", True),
                ("0.3.0", True),
                ("0.0.0-dev.1.1", True),
                ("0.3.0-beta.1", False),
                ("0.3.0-dev.0.1", False),
                ("0.3.0-dev.1", False),
                ("03.0.0", False),
                ("0.3.0\n", False),
                (["0.3.0"], False),
            ):
                file.write_text(json.dumps({"extraMetadata": {"version": version}}))
                result = subprocess.run(
                    [
                        str(workspace.node_path()),
                        "tooling/quality-package.mjs",
                        "--validate",
                        str(file),
                    ],
                    cwd=CHECKOUT,
                    env={
                        **({"SYSTEMROOT": os.environ["SYSTEMROOT"]} if os.name == "nt" else {}),
                        "HOME": directory,
                        "PATH": str(workspace.node_path().parent),
                    },
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                with self.subTest(version=version):
                    self.assertEqual(result.returncode == 0, accepted, result.stderr)
                    if not accepted:
                        self.assertIn("final version or a run/attempt", result.stderr)


if __name__ == "__main__":
    unittest.main()
