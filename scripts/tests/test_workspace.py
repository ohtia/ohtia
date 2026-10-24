"""Verify platform selection, bounded archive trust and controlled setup failures."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workspace


class WorkspaceTests(unittest.TestCase):
    def test_six_targets_and_aliases(self):
        for system, prefix in (("Linux", "linux"), ("Windows", "win32"), ("Darwin", "darwin")):
            for machine, arch in (
                ("AMD64", "x64"),
                ("x86_64", "x64"),
                ("aarch64", "arm64"),
                ("ARM64", "arm64"),
            ):
                self.assertEqual(workspace.target_id(system, machine), f"{prefix}-{arch}")
        for machine in ("i686", "x86", "armv7l"):
            with self.assertRaises(workspace.WorkspaceError):
                workspace.target_id("Linux", machine)

    def test_paths_are_checkout_local_without_inherited_python_environment(self):
        with patch.dict(
            workspace.os.environ,
            {"VIRTUAL_ENV": "/other", "PYTHONPATH": "/private", "PYTHONHOME": "/other"},
        ):
            env = workspace.environment()
        for key in ("VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME"):
            self.assertNotIn(key, env)
        for key in ("UV_CACHE_DIR", "UV_PROJECT_ENVIRONMENT", "UV_PYTHON"):
            self.assertTrue(Path(env[key]).is_relative_to(workspace.ROOT))

    def test_digest_failure_never_publishes_download(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tool.zip"
            with patch.object(
                workspace.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")
            ):
                with self.assertRaisesRegex(workspace.WorkspaceError, "digest mismatch"):
                    workspace.download(
                        {"url": "https://example.invalid/tool.zip", "sha256": "0" * 64}, destination
                    )
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_suffix(".partial").exists())

    def test_pnpm_store_and_state_are_explicitly_local(self):
        with patch.object(workspace, "invoke", return_value="") as invoke:
            workspace.pnpm("install", "--frozen-lockfile")
        command = invoke.call_args.args[0]
        self.assertIn("--config.verifyDepsBeforeRun=error", command)
        for flag, suffix in (
            ("--store-dir", ".cache/pnpm/store"),
            ("--state-dir", ".cache/pnpm/state"),
        ):
            self.assertEqual(command[command.index(flag) + 1], workspace.ROOT / suffix)

    def test_effective_version_mismatch_stops(self):
        with patch.object(workspace, "invoke", return_value="v0.0.0"):
            with self.assertRaisesRegex(workspace.WorkspaceError, "version mismatch"):
                workspace.diagnose()

    def test_simultaneous_setup_is_rejected_without_deleting_owner_lock(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(workspace, "TOOLS", Path(directory)),
        ):
            with workspace.setup_lock():
                with self.assertRaisesRegex(workspace.WorkspaceError, "Another setup"):
                    with workspace.setup_lock():
                        self.fail("Concurrent setup was admitted")
                self.assertTrue((Path(directory) / "setup.lock").exists())
            self.assertFalse((Path(directory) / "setup.lock").exists())

    def test_invalid_manifest_root_stops_with_a_controlled_diagnostic(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "toolchain.json"
            for text in ("[]", '{"tools": []}'):
                manifest.write_text(text, encoding="utf-8")
                with patch.object(workspace, "MANIFEST", manifest):
                    with self.assertRaisesRegex(
                        workspace.WorkspaceError, "Invalid toolchain manifest"
                    ):
                        workspace.tool_records()

    def test_a_package_command_cannot_succeed_after_mutating_a_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("pnpm-lock.yaml", "uv.lock"):
                (root / name).write_text("original", encoding="utf-8")

            def mutate(command):
                (root / "pnpm-lock.yaml").write_text("changed", encoding="utf-8")
                return ""

            with (
                patch.object(workspace, "ROOT", root),
                patch.object(workspace, "invoke", side_effect=mutate),
            ):
                with self.assertRaisesRegex(workspace.WorkspaceError, "changed a lockfile"):
                    workspace.pnpm("run", "doctor")

    def test_missing_executable_names_the_repair(self):
        with patch.object(workspace.subprocess, "run", side_effect=FileNotFoundError()):
            with self.assertRaisesRegex(workspace.WorkspaceError, "missing-tool.*bootstrap/setup"):
                workspace.invoke(["missing-tool", "--version"])

    def test_zip_paths_cannot_escape_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("../escaped", "unsafe")
            with self.assertRaises(workspace.WorkspaceError):
                workspace.unpack(archive, Path(directory) / "target")
            self.assertFalse((Path(directory) / "escaped").exists())


if __name__ == "__main__":
    unittest.main()
