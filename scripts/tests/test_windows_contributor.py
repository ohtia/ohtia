"""Verify Windows contributor admission, download consent and private diagnostics."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import windows_contributor as win


class WindowsContributorTests(unittest.TestCase):
    def test_prepared_dotdot_alias_cannot_admit_nested_package_output(self):
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory).resolve()
            prepared = scratch / "prepared"
            (prepared / "app").mkdir(parents=True)
            marker = prepared / "app/immutable"
            marker.write_bytes(b"original")
            profile = scratch / "runtime-profile.json"
            profile.write_text(json.dumps({"scratch_root": str(scratch)}))
            alias = prepared / ".." / prepared.name
            output = prepared / "app/package"
            with patch.object(win, "admit"), patch.object(win, "mutating_command") as build:
                with self.assertRaisesRegex(win.ContributorError, "disjoint"):
                    win.package(profile, alias, output)
                build.assert_not_called()
            self.assertFalse(output.exists())
            self.assertEqual(marker.read_bytes(), b"original")

    def test_native_directory_acl_denial_does_not_create_a_probe_file(self):
        from unittest.mock import MagicMock

        for handle in (123, win.c.c_void_p(-1).value):
            with self.subTest(handle=handle), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                kernel = MagicMock()
                kernel.CreateFileW.return_value = handle
                with patch.object(win.c, "WinDLL", return_value=kernel, create=True):
                    if handle == 123:
                        win.directory_access(root)
                        kernel.CloseHandle.assert_called_once_with(handle)
                    else:
                        with self.assertRaisesRegex(
                            win.ContributorError, "Directory access denied"
                        ):
                            win.directory_access(root)
                        kernel.CloseHandle.assert_not_called()
                arguments = kernel.CreateFileW.call_args.args
                self.assertEqual(arguments[1], 0x27)
                self.assertEqual(arguments[4], 3)  # OPEN_EXISTING, never create a file.
                self.assertEqual(arguments[5], 0x02000000)
                self.assertEqual(list(root.iterdir()), [])

    def test_certificate_failure_has_native_trust_repair_without_raw_details(self):
        result = win.failure_message("CERTIFICATE_VERIFY_FAILED private/home secret")
        self.assertIn("Windows trusted roots", result)
        self.assertIn("Never disable TLS", result)
        self.assertNotIn("private/home", result)
        self.assertNotIn("secret", result)

    def test_raw_checkout_alias_is_rejected_before_tool_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "nested").mkdir()
            source = root / "script.py"
            source.write_text("# synthetic source\n")
            with patch.object(win, "__file__", str(root / "nested/../script.py")):
                with self.assertRaisesRegex(win.ContributorError, "Checkout alias refused"):
                    win.canonical_checkout()
            with patch.object(win, "__file__", str(source)):
                win.canonical_checkout()

    def test_native_alias_failure_reports_path_repair_without_raw_error(self):
        with (
            patch.object(
                win, "preflight", side_effect=win.desktop_probes.ProbeError("private/home")
            ),
            patch.object(sys, "argv", ["windows_contributor.py", "doctor"]),
            patch("sys.stderr", new_callable=io.StringIO) as output,
        ):
            self.assertEqual(win.main(), 1)
            self.assertIn("without aliases or reparse points", output.getvalue())
            self.assertNotIn("private/home", output.getvalue())
            self.assertNotIn("HTTPS", output.getvalue())

    def test_workspace_doctor_does_not_write_import_bytecode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / "scripts"
            scripts.mkdir()
            (scripts / "peer.py").write_text("value = 'synthetic'\n")
            (scripts / "workspace.py").write_text(
                "import importlib.util, pathlib\n"
                "peer = pathlib.Path(__file__).with_name('peer.py')\n"
                "spec = importlib.util.spec_from_file_location('peer', peer)\n"
                "spec.loader.exec_module(importlib.util.module_from_spec(spec))\n"
            )
            with (
                patch.object(win, "ROOT", root),
                patch.object(win.workspace, "python_path", return_value=Path(sys.executable)),
                patch.object(win.workspace, "environment", return_value=dict(os.environ)),
            ):
                win.workspace_doctor()
            self.assertFalse((scripts / "__pycache__").exists())

    def test_existing_recognized_policy_is_reported_without_strengthening(self):
        pin = win.workspace.tool_records()["powershell"]["version"]
        with tempfile.TemporaryDirectory() as directory:
            shell = Path(directory) / "pwsh.exe"
            shell.touch()
            for policy in ("Bypass", "Unrestricted", "AllSigned"):
                data = {"version": pin, "process": "X64", "os": "X64", "policy": policy}
                with (
                    patch.object(win, "SHELL", shell),
                    patch.object(win, "command", return_value=json.dumps(data)),
                ):
                    self.assertEqual(win.shell_doctor()["execution_policy"], policy)

    def test_successful_package_receipt_binds_prepared_and_installer_bytes(self):
        import hashlib

        import quality_native

        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory).resolve()
            prepared = scratch / "prepared"
            prepared.mkdir()
            (prepared / "prepared.json").write_bytes(b"synthetic prepared record")
            profile = scratch / "runtime-profile.json"
            profile.write_text(json.dumps({"scratch_root": str(scratch)}))
            output = scratch / "package"

            def build(*args, **kwargs):
                (output / "packages").mkdir()
                (output / "packages/installer.exe").write_bytes(b"synthetic PE fixture")

            with (
                patch.object(win, "admit"),
                patch.object(quality_native, "configuration", return_value={}),
                patch.object(win, "mutating_command", side_effect=build),
            ):
                receipt = win.package(profile, prepared, output)
            self.assertEqual(receipt, json.loads((output / "packages.json").read_text()))
            self.assertEqual(receipt["target"], "win32-x64")
            self.assertEqual(
                receipt["prepared_sha256"], hashlib.sha256(b"synthetic prepared record").hexdigest()
            )
            self.assertEqual(
                receipt["packages"],
                [
                    {
                        "name": "installer.exe",
                        "sha256": hashlib.sha256(b"synthetic PE fixture").hexdigest(),
                        "bytes": len(b"synthetic PE fixture"),
                    }
                ],
            )

    def test_other_os_refused_before_native_inspection(self):
        with (
            patch.object(win.sys, "platform", "linux"),
            patch.object(win, "native_architecture") as native,
        ):
            with self.assertRaisesRegex(win.ContributorError, "native Windows"):
                win.preflight()
            native.assert_not_called()

    def test_native_api_rejects_wow64_and_arm_hardware(self):
        from unittest.mock import MagicMock

        for process, native in ((0, 0x8664), (0x14C, 0x8664), (0x8664, 0xAA64), (0, 0xAA64)):
            with self.subTest(process=process, native=native):
                kernel = MagicMock()
                kernel.GetCurrentProcess.return_value = 1

                def observe(_handle, process_out, native_out):
                    process_out._obj.value = process
                    native_out._obj.value = native
                    return 1

                kernel.IsWow64Process2.side_effect = observe
                with patch.object(win.c, "WinDLL", return_value=kernel, create=True):
                    if process == 0 and native == 0x8664:
                        win.native_architecture()
                    else:
                        with self.assertRaisesRegex(win.ContributorError, "native Windows x64"):
                            win.native_architecture()

    def test_doctor_has_no_install_or_launch_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(win, "ROOT", root),
                patch.object(win, "preflight", return_value={"target": "win32-x64"}),
                patch.object(win, "shell_doctor", return_value={}),
                patch.object(win, "install_shell") as install,
                patch.object(win, "mutating_command") as mutate,
                patch.object(sys, "argv", ["windows_contributor.py", "doctor"]),
                patch("builtins.print"),
            ):
                self.assertEqual(win.main(), 0)
                install.assert_not_called()
                mutate.assert_not_called()
            self.assertEqual(list(root.iterdir()), [])

    def test_downloads_need_explicit_consent(self):
        for action in ("shell", "setup"):
            with (
                self.subTest(action=action),
                patch.object(win, "preflight", return_value={}),
                patch.object(win, "install_shell") as install,
                patch.object(sys, "argv", ["windows_contributor.py", action]),
                patch("builtins.print"),
            ):
                self.assertEqual(win.main(), 1)
                install.assert_not_called()

    def test_native_command_errors_do_not_echo_exception_or_output(self):
        for result in (
            subprocess.CompletedProcess([], 1, "credential=secret", "private/home"),
            OSError("private/home credential=secret"),
            subprocess.TimeoutExpired("private/home", 1, "credential=secret"),
        ):
            with (
                self.subTest(result=result),
                patch.object(
                    win.subprocess,
                    "run",
                    **(
                        {"side_effect": result}
                        if isinstance(result, Exception)
                        else {"return_value": result}
                    ),
                ),
            ):
                with self.assertRaisesRegex(win.ContributorError, "Controlled repair") as raised:
                    win.command(["native-tool"], remedy="Controlled repair")
                self.assertNotIn("secret", str(raised.exception))
                self.assertNotIn("private", str(raised.exception))

    def test_shell_archive_failure_remains_controlled_at_cli(self):
        for error, expected in (
            (win.zipfile.BadZipFile("private/home"), "pinned archive unavailable"),
            (
                win.workspace.WorkspaceError("Downloaded tool digest mismatch private/home"),
                "Download digest mismatch",
            ),
        ):
            with (
                self.subTest(error=error),
                patch.object(win, "preflight", return_value={}),
                patch.object(win, "install_shell", side_effect=error),
                patch.object(sys, "argv", ["windows_contributor.py", "shell", "--install-tools"]),
                patch("sys.stderr", new_callable=io.StringIO) as output,
            ):
                self.assertEqual(win.main(), 1)
                self.assertIn(expected, output.getvalue())
                self.assertNotIn("private/home", output.getvalue())

    def test_shell_checks_exact_pin_and_both_native_architectures(self):
        pin = win.workspace.tool_records()["powershell"]["version"]
        valid = {"version": pin, "process": "X64", "os": "X64", "policy": "AllSigned"}
        for changes in ({}, {"version": "0.0.0"}, {"process": "X86"}, {"os": "Arm64"}):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                shell = Path(directory) / "pwsh.exe"
                shell.touch()
                with (
                    patch.object(win, "SHELL", shell),
                    patch.object(win, "command", return_value=json.dumps(valid | changes)) as run,
                ):
                    if changes:
                        with self.assertRaisesRegex(win.ContributorError, "mismatch"):
                            win.shell_doctor()
                    else:
                        self.assertEqual(win.shell_doctor()["execution_policy"], "AllSigned")
                    child_env = run.call_args.kwargs["env"]
                    self.assertEqual(child_env["PSModuleAnalysisCachePath"], "NUL")
                    self.assertEqual(child_env["POWERSHELL_UPDATECHECK"], "Off")
                    self.assertEqual(child_env["POWERSHELL_TELEMETRY_OPTOUT"], "1")
                    arguments = run.call_args.args[0]
                    self.assertIn("-NoProfile", arguments)
                    self.assertFalse(
                        any(
                            "Set-ExecutionPolicy" in str(item) or "Bypass" in str(item)
                            for item in arguments
                        )
                    )

    def test_corrupt_shell_never_extracted_or_executed(self):
        artifact = {"url": "https://example.invalid/PowerShell.zip", "sha256": "0" * 64}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(win, "ROOT", root),
                patch.object(win, "SHELL", root / ".tooling/powershell/pwsh.exe"),
                patch.object(win.workspace, "ROOT", root),
                patch.object(win.workspace, "TOOLS", root / ".tooling"),
                patch.object(
                    win.workspace,
                    "tool_records",
                    return_value={"powershell": {"artifacts": {"win32-x64": artifact}}},
                ),
                patch.object(
                    win.workspace.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt")
                ),
                patch.object(
                    win.workspace,
                    "windows_download",
                    side_effect=lambda url, partial: partial.write_bytes(b"corrupt"),
                ),
                patch.object(win.workspace, "unpack") as unpack,
                patch.object(win, "shell_doctor") as execute,
            ):
                with self.assertRaisesRegex(win.workspace.WorkspaceError, "digest mismatch"):
                    win.install_shell()
                unpack.assert_not_called()
                execute.assert_not_called()
            self.assertFalse((root / ".tooling/powershell").exists())
            self.assertFalse((root / ".tooling/setup.lock").exists())

    def test_repeated_shell_install_preserves_existing_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shell = root / ".tooling/powershell/pwsh.exe"
            shell.parent.mkdir(parents=True)
            shell.write_bytes(b"pinned-fixture")
            with (
                patch.object(win, "SHELL", shell),
                patch.object(win.workspace, "TOOLS", root / ".tooling"),
                patch.object(win, "shell_doctor", return_value={}),
                patch.object(win.workspace, "download") as download,
            ):
                win.install_shell()
                win.install_shell()
                download.assert_not_called()
            self.assertEqual(shell.read_bytes(), b"pinned-fixture")

    def test_concurrent_shell_install_preserves_owner_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            tools = Path(directory)
            lock = tools / "setup.lock"
            lock.write_text("other-pid")
            with (
                patch.object(win.workspace, "TOOLS", tools),
                patch.object(win.workspace, "download") as download,
            ):
                with self.assertRaisesRegex(win.workspace.WorkspaceError, "Another setup owns"):
                    win.install_shell()
                download.assert_not_called()
            self.assertEqual(lock.read_text(), "other-pid")

    def test_shared_supervisor_captures_both_streams_without_console_leaks(self):
        with tempfile.TemporaryFile() as output:
            result = win.run_owned(
                [
                    sys.executable,
                    "-c",
                    "import sys;print('private stdout');print('private stderr',file=sys.stderr)",
                ],
                win.ROOT,
                dict(os.environ),
                10,
                2,
                output=output,
            )
            self.assertEqual(result["exit_code"], 0)
            output.seek(0)
            captured = output.read()
            self.assertIn(b"private stdout", captured)
            self.assertIn(b"private stderr", captured)

    def test_failed_setup_maps_reason_and_never_echoes_private_child_data(self):
        with self.assertRaisesRegex(
            win.ContributorError, "File access or sharing denied"
        ) as raised:
            win.mutating_command(
                [
                    sys.executable,
                    "-c",
                    "import sys;print('EPERM private/home credential=secret',file=sys.stderr);sys.exit(1)",
                ],
                timeout=10,
                grace=2,
            )
        self.assertNotIn("secret", str(raised.exception))
        self.assertNotIn("private/home", str(raised.exception))

    def test_missing_compiler_is_actionable_without_install(self):
        with (
            patch.object(win.shutil, "which", return_value=None),
            patch.dict(os.environ, {}, clear=True),
        ):
            with self.assertRaisesRegex(win.ContributorError, "x64 Native Tools"):
                win.compiler_doctor()

    def test_package_admission_precedes_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "package"
            with patch.object(win, "admit", side_effect=win.ContributorError("Unverified profile")):
                with self.assertRaisesRegex(win.ContributorError, "Unverified"):
                    win.package(Path("profile"), Path("prepared"), output)
            self.assertFalse(output.exists())

    def test_package_cannot_overwrite_prepared_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory).resolve()
            prepared = scratch / "prepared"
            prepared.mkdir()
            marker = prepared / "immutable"
            marker.write_bytes(b"original")
            profile = scratch / "runtime-profile.json"
            profile.write_text(json.dumps({"scratch_root": str(scratch)}))
            with patch.object(win, "admit"):
                with self.assertRaisesRegex(win.ContributorError, "disjoint"):
                    win.package(profile, prepared, prepared / "package")
            self.assertEqual(marker.read_bytes(), b"original")
            self.assertFalse((prepared / "package").exists())


if __name__ == "__main__":
    unittest.main()
