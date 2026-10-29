"""Check macOS bootstrap trust, read-only diagnosis and failure redaction."""

from __future__ import annotations

import ast
import io
import json
import os
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_contributor as mac


class MacosContributorTests(unittest.TestCase):
    def test_bootstrap_keeps_python39_grammar(self):
        ast.parse(Path(mac.__file__).read_text(), feature_version=(3, 9))

    def test_archive_rejects_links_outside_relocated_python_tree(self):
        for entries in ([("python/x", "..")], [("python/a", "b/.."), ("python/b", "..")]):
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "links.tar.gz"
                with tarfile.open(archive, "w:gz") as source:
                    for name, target in entries:
                        entry = tarfile.TarInfo(name)
                        entry.type, entry.linkname = tarfile.SYMTYPE, target
                        source.addfile(entry)
                output = root / "out"
                output.mkdir()
                with self.assertRaises(mac.ContributorError):
                    mac.extract_python(archive, output)

    def test_package_overlap_refused_before_prepared_bytes_change(self):
        import quality_native

        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory).resolve()
            prepared = scratch / "prepared"
            (prepared / "app").mkdir(parents=True)
            marker = prepared / "app/immutable"
            marker.write_bytes(b"original")
            profile = scratch / "runtime-profile.json"
            profile.write_text(json.dumps({"scratch_root": str(scratch)}))
            output = prepared / "app/local-package"
            with (
                patch.object(mac, "admit"),
                patch.object(quality_native, "configuration") as configure,
            ):
                with self.assertRaisesRegex(mac.ContributorError, "must not overlap"):
                    mac.package(profile, prepared, output)
                configure.assert_not_called()
            self.assertFalse(output.exists())
            self.assertEqual(marker.read_bytes(), b"original")

    def test_shared_setup_reason_is_preserved_without_child_paths(self):
        result = {
            "contained_processes_remaining_after_cleanup": False,
            "timed_out": False,
            "exit_code": 1,
            "contained_processes_remaining_at_exit": False,
        }

        def failed(*args, **kwargs):
            os.write(
                2,
                b"Workspace setup stopped: Downloaded tool digest mismatch; private=/secret/home\n",
            )
            return result

        with patch("probe_process.run_owned", side_effect=failed):
            with self.assertRaisesRegex(
                mac.ContributorError, "download digest mismatch"
            ) as failure:
                mac.mutating_command(["synthetic"])
        self.assertNotIn("/secret", str(failure.exception))

    @unittest.skipIf(sys.platform == "win32", "POSIX process-group supervision fixture")
    def test_timeout_stops_setup_grandchild_before_retry_guidance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            child_pid = root / "child.pid"
            code = "import subprocess,sys,signal,time; from pathlib import Path; child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']); signal.signal(signal.SIGTERM,lambda *args:(child.wait(timeout=2),sys.exit(0))); Path(sys.argv[1]).write_text(str(child.pid)); time.sleep(60)"
            with self.assertRaisesRegex(mac.ContributorError, "timed out"):
                mac.mutating_command([sys.executable, "-c", code, child_pid], timeout=5, grace=2)
            pid = int(child_pid.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    @unittest.skipIf(sys.platform == "win32", "POSIX symbolic-link parent fixture")
    def test_linked_parent_rejection_never_writes_outside_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            output = root / "extraction"
            output.mkdir()
            archive = root / "malformed.tar.gz"
            with tarfile.open(archive, "w:gz") as source:
                entry = tarfile.TarInfo("python")
                entry.type = tarfile.DIRTYPE
                source.addfile(entry)
                for name, target in [
                    ("python/a", "b/.."),
                    ("python/b", "c/.."),
                    ("python/c", "."),
                    ("python/a/owned", "."),
                ]:
                    entry = tarfile.TarInfo(name)
                    entry.type, entry.linkname = tarfile.SYMTYPE, target
                    source.addfile(entry)
            before = set(root.iterdir())
            with self.assertRaises(mac.ContributorError):
                mac.extract_python(archive, output)
            self.assertEqual(set(root.iterdir()), before)
            self.assertFalse((root / "owned").is_symlink())

    @unittest.skipIf(sys.platform == "win32", "POSIX terminal-signal supervision fixture")
    def test_terminal_signals_stop_supervisor_grandchild(self):
        child_code = "import subprocess,sys,signal,time;from pathlib import Path;child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);signal.signal(signal.SIGTERM,lambda *args:(child.wait(timeout=2),sys.exit(0)));Path(sys.argv[1]).write_text(str(child.pid));time.sleep(60)"
        runner = "import sys;sys.path.insert(0,'scripts');import macos_contributor as m;\ntry:m.mutating_command([sys.executable,'-c',sys.argv[1],sys.argv[2]],timeout=60,grace=2)\nexcept m.ContributorError as e:print(str(e));sys.exit(1)"
        for kind in (signal.SIGHUP, signal.SIGQUIT):
            with self.subTest(signal=kind), tempfile.TemporaryDirectory() as directory:
                pid_file = Path(directory).resolve() / "grandchild.pid"
                child = subprocess.Popen(
                    [sys.executable, "-c", runner, child_code, str(pid_file)],
                    cwd=mac.ROOT,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                try:
                    deadline = time.monotonic() + 10
                    while not pid_file.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(pid_file.exists())
                    child.send_signal(kind)
                    stdout, stderr = child.communicate(timeout=10)
                    self.assertEqual(child.returncode, 1, stderr)
                    self.assertIn("interrupted; its contained process group was stopped", stdout)
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int(pid_file.read_text()), 0)
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.communicate(timeout=5)

    def test_non_macos_refused_before_native_command(self):
        with patch.object(mac.sys, "platform", "linux"), patch.object(mac, "command") as run:
            with self.assertRaisesRegex(mac.ContributorError, "native macOS"):
                mac.preflight()
            run.assert_not_called()

    def test_unqualified_macos_family_is_refused(self):
        with (
            patch.object(mac.sys, "platform", "darwin"),
            patch.object(mac, "command", return_value="15.9"),
        ):
            with self.assertRaisesRegex(mac.ContributorError, "26 or 27"):
                mac.preflight()

    def test_rosetta_refused_before_any_tool_install_or_profile_read(self):
        translated = subprocess.CompletedProcess([], 0, "1\n", "")
        with (
            patch.object(mac.sys, "platform", "darwin"),
            patch.object(mac, "command", return_value="26.7.2"),
            patch.object(mac.subprocess, "run", return_value=translated),
            patch.object(mac, "filesystem") as filesystem,
        ):
            with self.assertRaisesRegex(mac.ContributorError, "Rosetta"):
                mac.preflight()
            filesystem.assert_not_called()

    def test_interpreter_architecture_mismatch_refused(self):
        native = subprocess.CompletedProcess([], 1, "", "unknown key")
        with (
            patch.object(mac.sys, "platform", "darwin"),
            patch.object(mac.platform, "machine", return_value="x86_64"),
            patch.object(mac, "command", return_value="27.2"),
            patch.object(mac.subprocess, "run", return_value=native),
        ):
            with self.assertRaisesRegex(mac.ContributorError, "CPU/interpreter"):
                mac.preflight()

    def test_missing_developer_tools_has_exact_consented_repair(self):
        failure = subprocess.CompletedProcess([], 1, "", "/private/tool/error")
        with patch.object(mac.subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(mac.ContributorError, "xcode-select --install"):
                mac.command(["/usr/bin/xcrun", "--show-sdk-version"])

    def test_failed_native_command_redacts_path_and_exception(self):
        failure = subprocess.CompletedProcess([], 1, "/private/home/secret", "credential=secret")
        with patch.object(mac.subprocess, "run", return_value=failure):
            with self.assertRaises(mac.ContributorError) as raised:
                mac.command(["/private/home/tool"])
        self.assertNotIn("secret", str(raised.exception))
        self.assertNotIn("/private", str(raised.exception))
        self.assertIn("recovery", str(raised.exception))

    def test_doctor_requires_no_install_or_local_directory_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(mac, "ROOT", root),
                patch.object(mac, "preflight", return_value={"architecture": "arm64"}),
                patch.object(mac.sys, "argv", ["macos_contributor.py", "doctor"]),
                patch("builtins.print"),
            ):
                self.assertEqual(mac.main(), 0)
            self.assertEqual(list(root.iterdir()), [])

    def test_setup_requires_explicit_download_consent(self):
        with (
            patch.object(mac, "preflight", return_value={}),
            patch.object(mac, "setup") as setup,
            patch.object(mac.sys, "argv", ["macos_contributor.py", "setup"]),
            patch("builtins.print"),
        ):
            self.assertEqual(mac.main(), 1)
            setup.assert_not_called()

    @unittest.skipIf(sys.platform == "win32", "POSIX interpreter symlink/mode fixture")
    def test_safe_archive_preserves_internal_interpreter_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "python.tar.gz"
            with tarfile.open(archive, "w:gz") as source:
                file = tarfile.TarInfo("python/bin/python3.14")
                file.size, file.mode = 4, 0o6755
                source.addfile(file, io.BytesIO(b"test"))
                link = tarfile.TarInfo("python/bin/python3")
                link.type, link.linkname = tarfile.SYMTYPE, "python3.14"
                source.addfile(link)
            output = root / "output"
            output.mkdir()
            mac.extract_python(archive, output)
            self.assertEqual((output / "python/bin/python3").read_bytes(), b"test")
            self.assertEqual((output / "python/bin/python3.14").stat().st_mode & 0o7777, 0o755)

    def test_archive_rejects_traversal_absolute_paths_links_and_devices(self):
        cases = [
            ("../escape", tarfile.REGTYPE, ""),
            ("/absolute", tarfile.REGTYPE, ""),
            ("python/bin/link", tarfile.SYMTYPE, "../../../escape"),
            ("python/device", tarfile.CHRTYPE, ""),
            ("python/hardlink", tarfile.LNKTYPE, "python/file"),
        ]
        for name, kind, target in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "bad.tar.gz"
                with tarfile.open(archive, "w:gz") as source:
                    entry = tarfile.TarInfo(name)
                    entry.type, entry.linkname = kind, target
                    source.addfile(entry)
                output = root / "out"
                output.mkdir()
                with self.assertRaises(mac.ContributorError):
                    mac.extract_python(archive, output)
                self.assertFalse((root / "escape").exists())

    def test_corrupt_download_is_not_extracted_or_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config/desktop").mkdir(parents=True)
            (root / "config/desktop/toolchain.json").write_text(
                json.dumps(
                    {
                        "tools": {
                            "python": {
                                "version": "3.14.8",
                                "artifacts": {
                                    "darwin-arm64": {
                                        "url": "https://example.invalid/python.tar.gz",
                                        "sha256": "0" * 64,
                                    }
                                },
                            }
                        }
                    }
                )
            )
            with (
                patch.object(mac, "ROOT", root),
                patch.object(mac.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt")),
                patch.object(mac, "extract_python") as extract,
                patch.object(mac, "command") as command,
            ):
                with self.assertRaisesRegex(mac.ContributorError, "digest mismatch"):
                    mac.bootstrap_python()
                extract.assert_not_called()
                command.assert_not_called()
            self.assertFalse((root / ".cache/macos-bootstrap/python.partial").exists())

    def test_concurrent_setup_preserves_owner_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".tooling").mkdir()
            lock = root / ".tooling/setup.lock"
            lock.write_text("other-pid")
            with patch.object(mac, "ROOT", root):
                with self.assertRaisesRegex(mac.ContributorError, "Setup already owns"):
                    mac.setup()
            self.assertEqual(lock.read_text(), "other-pid")

    def test_package_requires_admission_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "new-package"
            with patch.object(mac, "admit", side_effect=mac.ContributorError("Unverified profile")):
                with self.assertRaisesRegex(mac.ContributorError, "Unverified"):
                    mac.package(Path("profile"), Path("prepared"), output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
