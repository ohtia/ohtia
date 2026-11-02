"""Validate real font repertoires and reject altered local assets and CSS."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("design_assets", ROOT / "scripts/design_assets.py")
assert SPEC is not None and SPEC.loader is not None
assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assets)


class DesignAssetsTests(unittest.TestCase):
    def test_actual_fonts_icons_and_brand_match_their_complete_contracts(self):
        self.assertEqual(assets.validate_fonts(ROOT), 19)
        self.assertEqual(assets.validate_icons(ROOT), 49)
        self.assertEqual(assets.validate_brand(ROOT), 3)

    def test_changed_font_bytes_and_css_ranges_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "packages/renderer/fonts", root / "packages/renderer/fonts")
            (root / "packages/renderer/src").mkdir()
            css = root / "packages/renderer/src/design-fonts.css"
            shutil.copyfile(ROOT / "packages/renderer/src/design-fonts.css", css)
            font = root / "packages/renderer/fonts/IBMPlexSans-Regular.woff2"
            original = font.read_bytes()
            font.write_bytes(original + b"altered")
            with self.assertRaisesRegex(ValueError, "Font byte"):
                assets.validate_fonts(root)
            font.write_bytes(original)
            css.write_text(css.read_text().replace("U+207F", "U+0000-FFFF"))
            with self.assertRaisesRegex(ValueError, "CSS drift"):
                assets.validate_fonts(root)

    def test_missing_face_or_forged_repertoire_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "packages/renderer/fonts", root / "packages/renderer/fonts")
            manifest = root / "packages/renderer/fonts/manifest.json"
            record = json.loads(manifest.read_text())
            record["fonts"][0]["cmap"] = "0-FFFF"
            manifest.write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, "repertoire"):
                assets.validate_fonts(root)
            record["fonts"].pop()
            manifest.write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, "Unmanifested or missing"):
                assets.validate_fonts(root)

    def test_missing_icon_or_altered_original_image_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "packages/renderer/icons", root / "packages/renderer/icons")
            (root / "packages/renderer/icons/menu.svg").unlink()
            with self.assertRaisesRegex(ValueError, "Missing"):
                assets.validate_icons(root)
            shutil.copytree(
                ROOT / "packages/renderer/branding", root / "packages/renderer/branding"
            )
            image = root / "packages/renderer/branding/illustration.png"
            image.write_bytes(image.read_bytes() + b"altered")
            with self.assertRaisesRegex(ValueError, "Brand differs"):
                assets.validate_brand(root)

    def test_utf8_runtime_sample_is_not_decoded_through_the_windows_code_page(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/design_assets.py")],
            input="Évidence − ₹".encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=ROOT,
            env={**os.environ, "PYTHONUTF8": "0", "PYTHONIOENCODING": "cp1252"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["fonts"], 19)

    def test_changed_generated_icon_geometry_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "packages/renderer/icons", root / "packages/renderer/icons")
            (root / "packages/renderer/src").mkdir()
            module = root / "packages/renderer/src/design-icons.ts"
            module.write_text((ROOT / "packages/renderer/src/design-icons.ts").read_text() + "\n")
            with self.assertRaisesRegex(ValueError, "Icon module drift"):
                assets.validate_icons(root)
