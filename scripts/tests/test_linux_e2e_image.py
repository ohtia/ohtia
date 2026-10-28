"""Check source integrity and dependency closure for the Linux E2E image recipe."""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import linux_e2e_image as image


class ImageRecipeTests(unittest.TestCase):
    def test_downloaded_patch_must_match_before_it_is_written(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "patch.diff"
            record = {
                "url": "https://example.invalid/permitted-synthetic-fixture",
                "sha256": "0" * 64,
            }
            with (
                patch.object(
                    image.urllib.request, "urlopen", return_value=io.BytesIO(b"synthetic patch")
                ),
                self.assertRaisesRegex(ValueError, "digest mismatch"),
            ):
                image.checked_patch(record, destination)
            self.assertFalse(destination.exists())
            record["sha256"] = hashlib.sha256(b"synthetic patch").hexdigest()
            with patch.object(
                image.urllib.request, "urlopen", return_value=io.BytesIO(b"synthetic patch")
            ):
                image.checked_patch(record, destination)
            self.assertEqual(destination.read_bytes(), b"synthetic patch")

    def test_source_hashes_detect_changed_bytes_and_do_not_include_git_transport_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".git").mkdir()
            (root / ".git/config").write_text("synthetic excluded transport fixture")
            file = root / "source.cpp"
            file.write_text("synthetic source version one")
            initial = image.source_files(root)
            file.write_text("synthetic source version two")
            self.assertNotEqual(image.source_files(root), initial)
            self.assertEqual(set(initial), {"source.cpp"})

    @unittest.skipIf(sys.platform == "win32", "Creating POSIX fixture links needs native support")
    def test_vendor_fixture_links_are_recorded_without_reading_their_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "source"
            root.mkdir()
            target = parent / "outside"
            target.mkdir()
            (target / "fixture").write_text("first synthetic bytes")
            (root / "link").symlink_to(target, target_is_directory=True)
            initial = image.source_files(root)
            self.assertEqual(initial, {"link": {"link": str(target)}})
            (target / "fixture").write_text("changed synthetic bytes")
            self.assertEqual(image.source_files(root), initial)

    def test_usrmerge_package_ownership_requires_one_actual_package(self):
        results = [
            SimpleNamespace(returncode=1, stdout=""),
            SimpleNamespace(returncode=0, stdout="libexample:amd64: /lib/example.so\n"),
        ]
        with patch.object(image.subprocess, "run", side_effect=results):
            self.assertEqual(
                image.package_for_library(PurePosixPath("/usr/lib/example.so")), "libexample:amd64"
            )
        with (
            patch.object(
                image.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=0, stdout="one:amd64: /lib/example.so\ntwo:amd64: /lib/example.so\n"
                ),
            ),
            self.assertRaisesRegex(ValueError, "Ambiguous"),
        ):
            image.package_for_library(PurePosixPath("/usr/lib/example.so"))
        with (
            patch.object(
                image.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="")
            ),
            self.assertRaisesRegex(ValueError, "no pinned package"),
        ):
            image.package_for_library(PurePosixPath("/usr/lib/example.so"))

    def test_canonical_source_receipt_rejects_manual_or_mismatched_provenance(self):
        config = json.loads(image.MANIFEST.read_text())
        source = {
            "version": 1,
            "build_method": "canonical-recipe",
            "recipe_sha256": image.sha256(Path(image.__file__)),
            "manifest_sha256": image.sha256(image.MANIFEST),
            "source_tree": config["source"]["patched_tree"],
            "source": config["source"],
            "patch": config["patch"],
            "files": {"source.cpp": {"sha256": "a" * 64, "mode": 0o644}},
        }
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "source-inputs.json"
            with patch.object(image, "SOURCE_INPUTS", file):
                file.write_text(json.dumps(source))
                self.assertEqual(image.checked_source_record(config), source)
                for change in (
                    {"build_method": "manual-prefix"},
                    {"source_tree": "b" * 40},
                    {"recipe_sha256": "c" * 64},
                    {"manifest_sha256": "d" * 64},
                    {"files": {}},
                    {"version": 0},
                ):
                    file.write_text(json.dumps({**source, **change}))
                    with self.assertRaisesRegex(ValueError, "preparation receipt"):
                        image.checked_source_record(config)

    def test_failed_generated_header_preparation_prevents_parallel_compilation(self):
        config = json.loads(image.MANIFEST.read_text())
        with tempfile.TemporaryDirectory() as directory:
            config["cmake"]["LIBBACKTRACE_INCLUDE_DIR"] = str(Path(directory) / "include")
            header = Path(directory) / "backtrace.h"
            header.write_text("permitted synthetic compiler header")
            calls = []

            def execute(arguments, **options):
                calls.append((arguments, options))
                if "--target" in arguments:
                    raise subprocess.CalledProcessError(1, arguments)

            with (
                patch.object(image, "checked_source_record", return_value={}),
                patch.object(image, "build_jobs", return_value=2),
                patch.object(image.Path, "glob", return_value=[header]),
                patch.object(image, "execute", side_effect=execute),
                self.assertRaises(subprocess.CalledProcessError),
            ):
                image.compile_webkit(config)
            self.assertEqual(len(calls), 2)
            self.assertIn("WebKitGTK/DerivedSources/WebKitDirectoryInputStreamData.h", calls[1][0])
            self.assertTrue(
                all(options["env"]["PYTHONDONTWRITEBYTECODE"] == "1" for _, options in calls)
            )

    def test_compiler_parallelism_is_bounded_by_cpu_quota_and_available_memory(self):
        gib = 1024**3
        config = {"memory_per_job_bytes": 4 * gib}
        cases = (
            ((64, 256 * gib, None, None), 64),
            ((64, 100 * gib, None, None), 25),
            ((4, 15 * gib, None, None), 3),
            ((64, 256 * gib, "800000 100000", None), 8),
            ((64, 256 * gib, "max 100000", str(20 * gib)), 5),
            ((8, gib, None, None), 1),
        )
        for (cpus, available, cpu_max, memory_max), expected in cases:
            files = {"/proc/meminfo": f"MemTotal: 1 kB\nMemAvailable: {available // 1024} kB\n"}
            if cpu_max:
                files["/sys/fs/cgroup/cpu.max"] = cpu_max
            if memory_max:
                files["/sys/fs/cgroup/memory.max"] = memory_max
            with (
                self.subTest(cpus=cpus, available=available, cpu_max=cpu_max),
                patch.object(
                    image.os, "sched_getaffinity", return_value=set(range(cpus)), create=True
                ),
                patch.object(
                    image.Path,
                    "is_file",
                    autospec=True,
                    side_effect=lambda path: path.as_posix() in files,
                ),
                patch.object(
                    image.Path,
                    "read_text",
                    autospec=True,
                    side_effect=lambda path, *args, **kwargs: files[path.as_posix()],
                ),
            ):
                self.assertEqual(image.build_jobs(config), expected)
        with self.assertRaisesRegex(ValueError, "memory budget"):
            with (
                patch.object(image.os, "sched_getaffinity", return_value={0}, create=True),
                patch.object(image.Path, "is_file", return_value=False),
                patch.object(image.Path, "read_text", return_value="MemAvailable: 1 kB\n"),
            ):
                image.build_jobs({"memory_per_job_bytes": 0})

    def test_finalization_accepts_only_the_parallelism_recorded_by_compilation(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "compile-receipt.json"
            for jobs in (None, 0, "8"):
                receipt.write_text(json.dumps({"jobs": jobs}))
                with (
                    self.subTest(jobs=jobs),
                    patch.object(image, "COMPILE_RECEIPT", receipt),
                    patch.object(image, "checked_cache"),
                    patch.object(image, "checked_source_record", return_value={"files": {}}),
                    patch.object(image, "source_files", return_value={}),
                    self.assertRaisesRegex(ValueError, "compilation receipt"),
                ):
                    image.finalize({})

    def test_docker_recipe_keeps_both_base_layers_pinned_and_finishes_as_the_test_account(self):
        config = json.loads(image.MANIFEST.read_text())
        dockerfile = (image.ROOT / "tools/linux-e2e/Dockerfile").read_text().splitlines()
        self.assertEqual(
            [line.split()[1] for line in dockerfile if line.startswith("FROM ")],
            [config["base_image"], config["base_image"]],
        )
        self.assertEqual(
            [line for line in dockerfile if line.startswith("USER ")][-1], "USER pwuser"
        )
        self.assertEqual(config["cmake"]["ENABLE_BUBBLEWRAP_SANDBOX"], "ON")
        self.assertEqual(config["cmake"]["ENABLE_ORIENTATION_EVENTS"], "ON")

    def test_recipe_refuses_accidental_execution_outside_the_builder(self):
        with (
            patch.object(sys, "argv", ["image.py", "prepare"]),
            patch.object(image.platform, "system", return_value="Linux"),
            patch.object(image.platform, "machine", return_value="x86_64"),
            patch.object(image.os, "geteuid", return_value=0, create=True),
            patch.object(image.Path, "exists", return_value=False),
            patch.object(image, "prepare") as prepare,
            self.assertRaisesRegex(ValueError, "disposable"),
        ):
            image.main()
        prepare.assert_not_called()


if __name__ == "__main__":
    unittest.main()
