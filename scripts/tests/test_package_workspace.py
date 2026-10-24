"""Verify declared archive contents and preservation of the previous successful artifact."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import package_workspace


class PackageArchiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ohtia archive ñ ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / "config/desktop").mkdir(parents=True)
        (self.root / "config/workspace-boundaries.json").write_text(
            '{"contracts": {}}', encoding="utf-8"
        )
        for name in ("contracts", "unchecked"):
            package = self.root / "packages" / name
            (package / "dist").mkdir(parents=True)
            (package / "package.json").write_text(
                json.dumps(
                    {"exports": {".": {"types": "./dist/index.d.ts", "import": "./dist/index.js"}}}
                ),
                encoding="utf-8",
            )
            for file in ("index.js", "index.d.ts"):
                (package / "dist" / file).write_text("export {};\n", encoding="utf-8")
        for name in (
            "pnpm-lock.yaml",
            "config/desktop/targets.json",
            "config/desktop/toolchain.json",
        ):
            (self.root / name).write_text("{}\n", encoding="utf-8")
        replacement = patch.object(package_workspace, "ROOT", self.root)
        replacement.start()
        self.addCleanup(replacement.stop)
        self.archive = self.root / "artifacts/workspace-libraries.zip"

    def test_undeclared_package_outputs_are_excluded(self):
        package_workspace.main()
        with zipfile.ZipFile(self.archive) as archive:
            names = archive.namelist()
        self.assertIn("packages/contracts/dist/index.js", names)
        self.assertIn("packages/contracts/dist/index.d.ts", names)
        self.assertFalse(any(name.startswith("packages/unchecked/") for name in names))

    def test_validation_failure_preserves_the_previous_archive(self):
        package_workspace.main()
        original = self.archive.read_bytes()
        (self.root / "packages/contracts/dist/index.js").unlink()
        with self.assertRaisesRegex(SystemExit, "Missing public build output"):
            package_workspace.main()
        self.assertEqual(self.archive.read_bytes(), original)
        self.assertEqual([path.name for path in self.archive.parent.iterdir()], [self.archive.name])

    def test_write_failure_preserves_the_previous_archive(self):
        package_workspace.main()
        original = self.archive.read_bytes()
        with patch.object(
            zipfile.ZipFile, "write", side_effect=OSError("synthetic archive failure")
        ):
            with self.assertRaisesRegex(OSError, "synthetic archive failure"):
                package_workspace.main()
        self.assertEqual(self.archive.read_bytes(), original)
        self.assertEqual([path.name for path in self.archive.parent.iterdir()], [self.archive.name])


if __name__ == "__main__":
    unittest.main()
