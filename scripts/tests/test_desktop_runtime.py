"""Verify runtime assembly rejects unsafe archives and inspects native bytes without execution."""

from __future__ import annotations

import io
import stat
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_runtime as runtime


class RuntimeArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.destination = self.root / "runtime"
        self.destination.mkdir()
        self.archive = self.root / "runtime.zip"

    def archive_with(self, name, data=b"synthetic", mode=stat.S_IFREG | 0o755):
        with zipfile.ZipFile(self.archive, "w") as zipped:
            info = zipfile.ZipInfo(name)
            info.external_attr = mode << 16
            zipped.writestr(info, data)

    def test_traversal_and_windows_drive_paths_are_rejected_on_every_host(self):
        for name in [
            "../escaped",
            "/escaped",
            "D:/escaped",
            "nested/../../../escaped",
            r"a\escaped",
        ]:
            with self.subTest(name=name):
                self.archive_with(name)
                with self.assertRaises(ValueError):
                    runtime.unpack(self.archive, self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])
        self.assertFalse((self.root / "escaped").exists())

    def test_framework_link_cannot_leave_the_runtime(self):
        self.archive_with("Framework/Current", b"../../outside", stat.S_IFLNK | 0o777)
        with self.assertRaises(ValueError):
            runtime.unpack(self.archive, self.destination)
        self.assertFalse((self.destination / "Framework/Current").exists())

    @unittest.skipIf(
        sys.platform == "win32", "Creating POSIX framework symlinks needs native support"
    )
    def test_internal_framework_link_is_preserved_and_setuid_is_stripped(self):
        with zipfile.ZipFile(self.archive, "w") as zipped:
            for name, data, mode in [
                ("Framework/Current", b"Versions/A", stat.S_IFLNK | 0o777),
                ("Framework/Versions/A", b"synthetic", stat.S_IFREG | 0o6755),
            ]:
                info = zipfile.ZipInfo(name)
                info.external_attr = mode << 16
                zipped.writestr(info, data)
        runtime.unpack(self.archive, self.destination)
        linked = self.destination / "Framework/Current"
        self.assertTrue(linked.is_symlink())
        self.assertEqual(linked.read_bytes(), b"synthetic")
        self.assertEqual(stat.S_IMODE(linked.stat().st_mode), 0o755)

    def test_architecture_inspection_handles_three_native_formats_without_execution(self):
        for architecture, elf_machine, mach_cpu, pe_machine in [
            ("x64", 62, 0x01000007, 0x8664),
            ("arm64", 183, 0x0100000C, 0xAA64),
        ]:
            elf = bytearray(64)
            elf[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", elf, 18, elf_machine)
            mach = bytearray(64)
            mach[:4] = b"\xcf\xfa\xed\xfe"
            struct.pack_into("<I", mach, 4, mach_cpu)
            pe = io.BytesIO()
            pe.write(b"MZ" + bytes(58) + struct.pack("<I", 64))
            pe.write(b"PE\0\0" + struct.pack("<H", pe_machine))
            for format_name, data in [("elf", elf), ("mach", mach), ("pe", pe.getvalue())]:
                with self.subTest(architecture=architecture, format=format_name):
                    binary = self.root / "not-executable"
                    binary.write_bytes(data)
                    binary.chmod(0o600)
                    self.assertEqual(runtime.architecture(binary), architecture)

    def test_truncated_native_headers_are_controlled_failures(self):
        for data in [b"\x7fELF", b"MZ", b"\xcf\xfa\xed\xfe", b"MZ" + bytes(62)]:
            with self.subTest(data=data[:4]):
                binary = self.root / "truncated"
                binary.write_bytes(data)
                with self.assertRaises(ValueError):
                    runtime.architecture(binary)


if __name__ == "__main__":
    unittest.main()
