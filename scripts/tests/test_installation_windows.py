"""Windows archive boundary, file observation and process-lease contracts."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_native as native
import installation_windows as windows


class WindowsArchiveTests(unittest.TestCase):
    def listing(self, *names):
        return "\n\n".join("Path = " + name + "\nSize = 1\nAttributes = A" for name in names)

    def test_archive_members_are_relative_unaliased_and_case_unique(self):
        self.assertEqual(
            windows.validate_entries(self.listing("resources\\app\\package.json"), 10, 10),
            ["resources\\app\\package.json"],
        )
        self.assertEqual(
            windows.validate_entries(
                self.listing("resources\\app\\package.json", "other").replace("\n", "\r\n"), 10, 10
            ),
            ["resources\\app\\package.json", "other"],
        )
        for names in [
            ("C:\\foreign",),
            ("\\foreign",),
            ("..\\foreign",),
            ("safe\\..\\foreign",),
            ("folder.\\file",),
            ("file:stream",),
            ("CON.txt",),
            ("safe\\NUL",),
            ("A", "a"),
            ("a\\b", "a/b"),
            ("a/./b",),
            ("a//b",),
        ]:
            with self.subTest(names=names), self.assertRaises(ValueError):
                windows.validate_entries(self.listing(*names), 10, 10)

    def test_archive_expansion_count_and_link_bounds_are_enforced_before_extraction(self):
        for listing, maximum, count in [
            (self.listing("a", "b"), 1, 10),
            (self.listing("a").replace("Size = 1", "Size = -1"), 10, 10),
            (self.listing("a", "b"), 10, 1),
            (self.listing("a") + "\nSymbolic Link = target", 10, 10),
            (self.listing("a") + "\nHard Link = target", 10, 10),
            (self.listing("a").replace("Attributes = A", "Attributes = AL"), 10, 10),
            (self.listing("a").replace("Attributes = A", "Attributes = A_ lrwxrwxrwx"), 10, 10),
            (self.listing("a") + "\n\nPath = b\nAttributes = A", 10, 10),
        ]:
            with self.subTest(listing=listing), self.assertRaises(ValueError):
                windows.validate_entries(listing, maximum, count)

    def test_fresh_baseline_container_is_removed_but_existing_missing_floor_is_preserved(self):
        for existing in (False, True):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                directory = root / "update-acceptance"
                if existing:
                    directory.mkdir()
                native = SimpleNamespace(
                    command=lambda *_args, **_kwargs: json.dumps({"scratch_root": str(root)}),
                    inspect_baseline=lambda *_args: None,
                )
                args = SimpleNamespace(
                    runtime_profile=root / "profile.json",
                    cell=root / "cell.json",
                    archive=root / "base.exe",
                    payload=root / "base",
                    output=root / "proof.json",
                    expected_sha256="a" * 64,
                )
                windows.inspect_baseline(args, native)
                self.assertEqual(directory.exists(), existing)

    def test_atomic_checkpoint_refuses_to_overwrite_on_failed_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "pending.json"
            windows.publish(target, {"phase": "requested"})
            original = target.read_bytes()
            with patch.object(Path, "replace", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    windows.publish(target, {"phase": "settled"})
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(len(list(target.parent.glob("*.partial"))), 1)

    def test_nsis_destination_with_spaces_remains_an_unquoted_final_tail(self):
        command = windows.nsis_command(
            PureWindowsPath("C:/installer folder/update.exe"),
            PureWindowsPath("C:/scratch é/installed"),
        )
        self.assertEqual(command, r'"C:\installer folder\update.exe" /S /D=C:\scratch é\installed')
        for destination in ['C:/bad"path', "C:/bad\npath"]:
            with self.assertRaises(ValueError):
                windows.nsis_command(Path("update.exe"), Path(destination))

    def test_unrelated_machine_or_ambiguous_registration_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            old, destination = root / "old", root / "new"
            own = {
                "scope": "user",
                "location": str(old),
                "uninstall": '"' + str(old / "Uninstall ohtia-quality.exe") + '" /currentuser',
            }
            with patch.object(windows, "registered_installations", return_value=[own]):
                windows.check_registration(old, destination)
                with self.assertRaises(ValueError):
                    windows.check_registration(None, destination)
            for changed in [{**own, "scope": "machine"}, {**own, "uninstall": '"foreign.exe"'}]:
                with (
                    patch.object(windows, "registered_installations", return_value=[changed]),
                    self.assertRaises(ValueError),
                ):
                    windows.check_registration(old, destination)

    def test_registry_reader_distinguishes_absent_keys_from_missing_required_values(self):
        class Key:
            def __init__(self, values):
                self.values = values

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        keys = {}

        def open_key(hive, key, *_args):
            section = "uninstall" if "Uninstall" in key else "install"
            if (hive, section) not in keys:
                raise FileNotFoundError()
            return Key(keys[(hive, section)])

        def query(handle, name):
            if name not in handle.values:
                raise FileNotFoundError()
            return handle.values[name], 1

        registry = SimpleNamespace(
            HKEY_CURRENT_USER=1,
            HKEY_LOCAL_MACHINE=2,
            KEY_READ=4,
            KEY_WOW64_64KEY=8,
            REG_SZ=1,
            OpenKey=open_key,
            QueryValueEx=query,
        )
        with patch.dict(sys.modules, {"winreg": registry}):
            self.assertEqual(windows.registered_installations(), [])
            for section in ("install", "uninstall"):
                keys[(1, section)] = {}
                with self.assertRaisesRegex(ValueError, "lacks a required value"):
                    windows.registered_installations()
                keys.clear()
            keys[(1, "install")] = {"InstallLocation": "existing"}
            keys[(1, "uninstall")] = {"UninstallString": "retained"}
            self.assertEqual(
                windows.registered_installations(),
                [{"scope": "user", "location": "existing", "uninstall": "retained"}],
            )

    def test_changed_semantically_inspected_store_refuses_before_checkpoint_or_installer(self):
        import hashlib
        from unittest.mock import Mock

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            profile = {"target": "win32-x64", "scratch_root": str(root)}
            manifest = b"[{}]"
            record = {
                "version": "0.0.0-dev.27.1",
                "sha256": "a" * 64,
                "migration_manifest_sha256": hashlib.sha256(manifest).hexdigest(),
                "entry": {"schema": {"target": 1}},
                "admission": {"source_store": {"original": "semantically inspected"}},
            }
            cell = {"target": "win32-x64", "profile": "windows-11-25h2", "formats": ["nsis"]}
            args = SimpleNamespace(
                runtime_profile=root / "profile.json",
                cell=root / "cell.json",
                staged=root / "staged.json",
                destination=root / "new",
                output=root / "receipt.json",
            )
            fake = SimpleNamespace(
                command=lambda *_a, **_k: json.dumps(profile),
                check_installation_admission=lambda *_a: None,
                verify_staged=lambda *_a: root / "update.exe",
                store_snapshot=lambda *_a: {"changed": "after inspection"},
            )
            with (
                patch.object(windows.windows_contributor, "preflight"),
                patch.object(windows.workspace, "target_id", return_value="win32-x64"),
                patch.object(
                    windows,
                    "read_json",
                    side_effect=lambda file: cell if file == args.cell else record,
                ),
                patch.object(
                    windows,
                    "expected",
                    return_value=(
                        {},
                        manifest,
                        {"name": "ohtia-quality", "version": record["version"]},
                    ),
                ),
                patch.object(windows.quality_native, "run_owned", new=Mock()) as installer,
            ):
                with self.assertRaisesRegex(ValueError, "Store changed since semantic"):
                    windows.prepare(args, fake)
                installer.assert_not_called()
            self.assertFalse(args.output.exists())
            self.assertFalse(list(root.glob("windows-pending-*")))


@unittest.skipUnless(sys.platform == "win32", "Windows native file handles and process-token APIs")
class WindowsNativeTests(unittest.TestCase):
    def test_readonly_handle_rejects_hardlink_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary).resolve() / "é record.json"
            file.write_text('{"value":1}', encoding="utf-8")
            self.assertEqual(windows.read_json(file), {"value": 1})
            with self.assertRaises(ValueError):
                windows.read_json(file, maximum=2)
            os.link(file, file.with_name("hardlink.json"))
            with self.assertRaises(ValueError):
                windows.read_json(file)
            self.assertEqual(file.read_text(), '{"value":1}')

    def test_open_handle_denies_concurrent_writer_until_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary).resolve() / "file.json"
            file.write_text("{}")
            fd = windows.opened(file)
            try:
                with self.assertRaises(OSError):
                    file.write_text("changed")
            finally:
                os.close(fd)
            self.assertEqual(file.read_text(), "{}")

    def test_process_birth_is_exact_json_safe_and_cannot_be_replaced_by_pid(self):
        value = windows.identity(os.getpid())
        self.assertEqual(value["pid"], os.getpid())
        self.assertIsInstance(value["created_100ns"], str)
        self.assertEqual(json.loads(json.dumps(value)), windows.identity(os.getpid()))
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary).resolve() / "lease.json"
            file.write_text(json.dumps({"pid": os.getpid(), "owner": value}))
            self.assertEqual(windows.lease_status(file)["status"], "live")
            value["created_100ns"] = "1"
            file.write_text(json.dumps({"pid": os.getpid(), "owner": value}))
            self.assertEqual(windows.lease_status(file)["status"], "ceased")

    def test_terminated_child_is_proven_ceased_without_signalling_another_process(self):
        child = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"])
        try:
            value = windows.identity(child.pid)
            child.kill()
            child.wait()
            with tempfile.TemporaryDirectory() as temporary:
                file = Path(temporary).resolve() / "lease.json"
                file.write_text(json.dumps({"pid": child.pid, "owner": value}))
                self.assertEqual(windows.lease_status(file)["status"], "ceased")
                lease = file.with_name("operation.lock")
                file.rename(lease)
                state = file.with_name("accepted.json")
                state.write_text(
                    json.dumps(
                        {
                            "sequence": 1,
                            "catalog_sha256": "a" * 64,
                            "highest_version": "0.0.0-dev.27.1",
                            "last_accepted_ms": 1,
                        },
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                    + "\n",
                    newline="\n",
                )
                original = state.read_bytes()
                result = windows.reconcile(file.parent, file.parent, native)
                self.assertEqual(result["status"], "reconciled")
                self.assertFalse(lease.exists())
                self.assertEqual(state.read_bytes(), original)
                self.assertEqual(len(list(file.parent.glob("operation-reconciled-*.json"))), 1)

                # Model replacement by a live lease before guard acquisition.
                # The real exclusive handle makes the guard unreadable here.
                def replacement_status(_file):
                    try:
                        with (file.parent / "reconciliation.guard").open("rb"):
                            pass
                    except PermissionError:
                        return {"status": "live"}
                    return {"status": "ceased"}

                with (
                    patch.object(windows, "lease_status", side_effect=replacement_status),
                    patch.object(windows.subprocess, "run") as child_command,
                ):
                    with self.assertRaisesRegex(ValueError, "still live"):
                        windows.reconcile(file.parent, file.parent, native)
                    child_command.assert_not_called()
                self.assertEqual(state.read_bytes(), original)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
