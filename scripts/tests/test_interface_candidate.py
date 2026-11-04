"""Synthetic evidence verifies candidate admission, never actual native qualification."""

from __future__ import annotations

import copy
import shutil
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import interface_candidate as candidate
import quality_delivery as delivery
import test_quality_delivery as fixtures


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.DeliveryTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.populate()
        self.catalog = self.fixture.output.parent / (self.fixture.output.name + "-catalog")
        self.catalog.mkdir()
        self.addCleanup(lambda: shutil.rmtree(self.catalog))
        (self.catalog / "index.html").write_text("Synthetic development catalog", encoding="utf-8")
        self.tree = self.fixture.identity["tree_sha"]
        self.identity = {"source_tree": self.tree, "build": candidate.seal(self.catalog)}
        self.git = patch.object(
            delivery, "git", side_effect=lambda *args: "" if args[0] == "status" else self.tree
        )
        self.git.start()
        self.addCleanup(self.git.stop)

    def freeze(self, identity=None):
        return candidate.freeze(
            self.fixture.plan,
            self.fixture.output,
            self.catalog,
            identity or self.identity,
            "human:integrator",
        )

    def test_binds_actual_packages_catalog_and_assets_to_both_streams(self):
        result = self.freeze()
        self.assertEqual(result["verification_streams"], ["STORY-002-010", "STORY-002-011"])
        self.assertEqual(len(result["packages"]), 10)
        self.assertEqual(result["source_tree"], self.tree)
        self.assertEqual(len(result["locales"]["files"]), 25)
        self.assertEqual(result, self.freeze())
        self.assertEqual(
            result["candidate_id"],
            candidate.fingerprint(
                {key: value for key, value in result.items() if key != "candidate_id"}
            ),
        )

    def test_refuses_a_missing_native_cell_and_changed_package_bytes(self):
        package = next(self.fixture.output.rglob("package.deb"))
        package.write_bytes(b"changed synthetic package")
        with self.assertRaisesRegex(ValueError, "Artifact"):
            self.freeze()
        package.unlink()
        with self.assertRaises((ValueError, OSError)):
            self.freeze()

    def test_refuses_a_missing_native_partition(self):
        shutil.rmtree(next(path for path in self.fixture.output.iterdir() if path.is_dir()))
        with self.assertRaisesRegex(ValueError, "Missing or unexpected native artifact partitions"):
            self.freeze()

    def test_refuses_native_directory_alias_through_attachment_admission(self):
        alias = self.fixture.output / ".." / self.fixture.output.name
        with self.assertRaisesRegex(ValueError, "Artifact escapes"):
            candidate.freeze(
                self.fixture.plan, alias, self.catalog, self.identity, "human:integrator"
            )

    def test_refuses_stale_catalog_bytes_or_source_identity(self):
        stale = copy.deepcopy(self.identity)
        stale["source_tree"] = "a" * 40
        with self.assertRaisesRegex(ValueError, "Catalog identity"):
            self.freeze(stale)
        (self.catalog / "index.html").write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Catalog identity"):
            self.freeze()

    def test_refuses_dirty_source_and_another_native_source_tree(self):
        with patch.object(
            delivery,
            "git",
            side_effect=lambda *args: " M file" if args[0] == "status" else self.tree,
        ):
            with self.assertRaisesRegex(ValueError, "clean"):
                self.freeze()
        with patch.object(
            delivery, "git", side_effect=lambda *args: "" if args[0] == "status" else "e" * 40
        ):
            with self.assertRaisesRegex(ValueError, "another source tree"):
                self.freeze()

    def test_requires_an_owner_and_rejects_empty_or_linked_catalogs(self):
        with self.assertRaisesRegex(ValueError, "integrating owner"):
            candidate.freeze(
                self.fixture.plan, self.fixture.output, self.catalog, self.identity, " "
            )
        (self.catalog / "index.html").unlink()
        with self.assertRaisesRegex(ValueError, "Empty"):
            candidate.seal(self.catalog)
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(ValueError, "Missing"):
                candidate.seal(self.catalog)


if __name__ == "__main__":
    unittest.main()
