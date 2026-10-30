"""Verify platform selection, bounded archive trust and controlled setup failures."""

from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

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

    def test_go_hook_build_caches_and_user_configuration_are_isolated(self):
        with patch.dict(
            workspace.os.environ,
            {
                "GOCACHE": "/other-checkout/build",
                "GOMODCACHE": "/other-checkout/modules",
                "GOENV": "/private/go-config",
                "GOAUTH": "git /private/credentials",
            },
        ):
            env = workspace.environment()
        self.assertEqual(env["GOCACHE"], str(workspace.ROOT / ".cache/go-build"))
        self.assertEqual(env["GOMODCACHE"], str(workspace.ROOT / ".cache/go-mod"))
        self.assertEqual(env["GOENV"], "off")
        self.assertEqual(env["GOAUTH"], "off")

    def test_digest_failure_never_publishes_download(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tool.zip"
            with (
                patch.object(workspace.sys, "platform", "linux"),
                patch.object(
                    workspace.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")
                ),
            ):
                with self.assertRaisesRegex(workspace.WorkspaceError, "digest mismatch"):
                    workspace.download(
                        {"url": "https://example.invalid/tool.zip", "sha256": "0" * 64}, destination
                    )
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_suffix(".partial").exists())

    def test_windows_https_client_uses_native_system_directory_and_schannel(self):
        with tempfile.TemporaryDirectory() as directory:
            system = Path(directory) / "System32"
            system.mkdir()
            executable = system / "curl.exe"
            executable.touch()
            kernel = MagicMock()

            def location(buffer, maximum):
                buffer.value = str(system)
                return len(str(system))

            kernel.GetSystemDirectoryW.side_effect = location
            with (
                patch("ctypes.WinDLL", return_value=kernel, create=True),
                patch.object(
                    workspace.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess(
                        [], 0, "curl 8.17.0 libcurl/8.17.0 Schannel\n", ""
                    ),
                ) as run,
                patch.dict(workspace.os.environ, {"CURL_SSL_BACKEND": "openssl"}),
            ):
                self.assertEqual(workspace.windows_https_client(), (executable, "8.17.0"))
                self.assertEqual(workspace.os.environ["CURL_SSL_BACKEND"], "openssl")
            self.assertEqual(run.call_args.args[0], [str(executable), "--disable", "--version"])
            self.assertEqual(run.call_args.kwargs["env"]["CURL_SSL_BACKEND"], "schannel")

    def test_windows_https_client_refuses_missing_or_non_native_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            system = Path(directory)
            kernel = MagicMock()

            def location(buffer, maximum):
                buffer.value = str(system)
                return len(str(system))

            kernel.GetSystemDirectoryW.side_effect = location
            with patch("ctypes.WinDLL", return_value=kernel, create=True):
                with self.assertRaisesRegex(
                    workspace.WorkspaceError, "system HTTPS client unavailable"
                ):
                    workspace.windows_https_client()
                (system / "curl.exe").touch()
                with patch.object(
                    workspace.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], 0, "curl 8.17.0 OpenSSL\n", ""),
                ):
                    with self.assertRaisesRegex(workspace.WorkspaceError, "Schannel build"):
                        workspace.windows_https_client()

    def test_windows_download_is_verified_atomic_and_ignores_curl_configuration(self):
        payload = b"synthetic reviewed artifact"
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "space accented é" / "tool.zip"
            executable = Path(directory) / "System32/curl.exe"

            def transfer(command, **kwargs):
                Path(command[command.index("--output") + 1]).write_bytes(payload)
                self.assertFalse(destination.exists())
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.object(workspace.sys, "platform", "win32"),
                patch.object(
                    workspace, "windows_https_client", return_value=(executable, "8.17.0")
                ),
                patch.object(workspace.subprocess, "run", side_effect=transfer) as run,
            ):
                workspace.download(
                    {
                        "url": "https://example.invalid/tool.zip",
                        "sha256": hashlib.sha256(payload).hexdigest(),
                    },
                    destination,
                )
            self.assertEqual(destination.read_bytes(), payload)
            self.assertFalse(destination.with_suffix(".partial").exists())
            command = run.call_args.args[0]
            self.assertEqual(command[:2], [str(executable), "--disable"])
            for flag in ("--proto", "--proto-redir"):
                self.assertEqual(command[command.index(flag) + 1], "=https")
            self.assertIn("--no-ssl-auto-client-cert", command)
            self.assertNotIn("--insecure", command)
            self.assertNotIn("--max-time", command)
            self.assertIsNone(run.call_args.kwargs.get("timeout"))
            self.assertEqual(command[command.index("--connect-timeout") + 1], "30")
            self.assertEqual(command[command.index("--speed-limit") + 1], "1")
            self.assertEqual(command[command.index("--speed-time") + 1], "120")
            self.assertEqual(run.call_args.kwargs["env"]["CURL_SSL_BACKEND"], "schannel")

    def test_windows_download_failure_preserves_cache_and_withholds_private_output(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tool.zip"
            destination.write_bytes(b"preserved failed cache")
            partial = destination.with_suffix(".partial")
            partial.write_bytes(b"incomplete")
            with (
                patch.object(workspace.sys, "platform", "win32"),
                patch.object(
                    workspace, "windows_https_client", return_value=(Path("curl.exe"), "8.17.0")
                ),
                patch.object(
                    workspace.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], 60, b"", b"private/home secret"),
                ),
            ):
                with self.assertRaisesRegex(
                    workspace.WorkspaceError, "certificate validation failed"
                ) as error:
                    workspace.download(
                        {"url": "https://example.invalid/tool.zip", "sha256": "0" * 64}, destination
                    )
            self.assertNotIn("private", str(error.exception))
            self.assertNotIn("secret", str(error.exception))
            self.assertEqual(destination.read_bytes(), b"preserved failed cache")
            self.assertFalse(partial.exists())

    def test_windows_download_digest_mismatch_never_publishes_or_admits_non_https(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tool.zip"

            def transfer(command, **kwargs):
                Path(command[command.index("--output") + 1]).write_bytes(b"wrong")
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.object(workspace.sys, "platform", "win32"),
                patch.object(
                    workspace, "windows_https_client", return_value=(Path("curl.exe"), "8.17.0")
                ),
                patch.object(workspace.subprocess, "run", side_effect=transfer) as run,
            ):
                with self.assertRaisesRegex(workspace.WorkspaceError, "digest mismatch"):
                    workspace.download(
                        {"url": "https://example.invalid/tool.zip", "sha256": "0" * 64}, destination
                    )
                run.reset_mock()
                with self.assertRaisesRegex(workspace.WorkspaceError, "HTTPS URLs"):
                    workspace.download(
                        {"url": "http://example.invalid/tool.zip", "sha256": "0" * 64}, destination
                    )
                run.assert_not_called()
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_suffix(".partial").exists())

    def test_pnpm_store_and_state_are_explicitly_local(self):
        with patch.object(workspace, "invoke", return_value="") as invoke:
            workspace.pnpm("install", "--frozen-lockfile")
        command = invoke.call_args.args[0]
        self.assertIs(invoke.call_args.kwargs["noninteractive"], True)
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

            def mutate(command, *, noninteractive=False):
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
