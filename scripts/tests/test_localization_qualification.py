"""Catalog provenance remains bound to bytes and preserves gaps in producer evidence."""

import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import interface_candidate
import localization_qualification as qualification


class CatalogProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        directory = self.root / qualification.CATALOGS
        directory.mkdir(parents=True)
        source = qualification.ROOT / qualification.CATALOGS
        for path in source.glob("*.json"):
            (directory / path.name).write_bytes(path.read_bytes())
        self.generation = qualification.read_json(qualification.ROOT / qualification.PROVENANCE)
        target = self.root / qualification.PROVENANCE
        target.write_text(json.dumps(self.generation))
        self.candidate = {
            "version": 1,
            "source_tree": "a" * 40,
            "locales": interface_candidate.seal(directory),
        }
        self.candidate["candidate_id"] = interface_candidate.fingerprint(self.candidate)
        self.blobs = {qualification.PROVENANCE: target.read_bytes()}
        self.blobs.update(
            {
                qualification.CATALOGS / path.name: path.read_bytes()
                for path in directory.glob("*.json")
            }
        )
        self.git = patch.object(
            qualification, "source_bytes", side_effect=lambda tree, resource: self.blobs[resource]
        )
        self.git.start()
        self.addCleanup(self.git.stop)

    def test_binds_every_locale_and_reference_without_inheriting_a_human_verifier(self):
        result = qualification.snapshot(self.candidate, self.root)
        self.assertEqual(len(result["catalogs"]), 25)
        for record in result["catalogs"]:
            self.assertEqual(record["human_linguistic_review"], "not-performed")
            self.assertEqual(
                record["reference_sha256"], self.candidate["locales"]["files"]["en-US.json"]
            )
            self.assertEqual(
                record["sha256"], self.candidate["locales"]["files"][record["locale"] + ".json"]
            )
        records = result["generation_manifest"]["records"]
        self.assertIsNone(records[0]["producer"]["effective_model"])
        self.assertEqual(
            next(record for record in records if record["scope"].startswith("identity.*"))[
                "producer"
            ]["effective_model"],
            "gpt-6.1-sol",
        )
        self.assertNotIn("verified", result)

    def test_refuses_changed_catalog_bytes_even_when_the_keys_are_unchanged(self):
        path = self.root / qualification.CATALOGS / "ko-KR.json"
        value = qualification.read_json(path)
        value["messages"]["title"] += " modified"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            qualification.snapshot(self.candidate, self.root)

    def test_refuses_changed_generation_records_and_invalid_candidate_identity(self):
        path = self.root / qualification.PROVENANCE
        self.generation["producer"]["effective_model"] = "invented-model"
        path.write_text(json.dumps(self.generation))
        with self.assertRaisesRegex(ValueError, "Generation records differ"):
            qualification.snapshot(self.candidate, self.root)
        changed = copy.deepcopy(self.candidate)
        changed["source_tree"] = "b" * 40
        with self.assertRaisesRegex(ValueError, "candidate identity"):
            qualification.snapshot(changed, self.root)

    def test_rehashing_changed_catalogs_cannot_reuse_original_source_provenance(self):
        path = self.root / qualification.CATALOGS / "ko-KR.json"
        value = qualification.read_json(path)
        value["messages"]["title"] += " changed"
        path.write_text(json.dumps(value))
        candidate = {key: value for key, value in self.candidate.items() if key != "candidate_id"}
        candidate["locales"] = interface_candidate.seal(self.root / qualification.CATALOGS)
        candidate["candidate_id"] = interface_candidate.fingerprint(candidate)
        with self.assertRaisesRegex(ValueError, "Catalog source differs"):
            qualification.snapshot(candidate, self.root)

    def test_duplicate_catalog_members_are_rejected_instead_of_silently_replacing_a_value(self):
        path = self.root / "duplicate.json"
        path.write_text('{"messages":{"key":"first","key":"second"}}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON member"):
            qualification.read_json(path)

    def test_check_cli_rejects_boolean_aliases_but_accepts_reformatted_snapshot(self):
        expected = qualification.snapshot(self.candidate, self.root)
        candidate_file = self.root / "candidate.json"
        candidate_file.write_text(json.dumps(self.candidate))
        output = self.root / "snapshot.json"
        output.write_text(json.dumps(expected, indent=4))
        args = ["localization_qualification.py", str(candidate_file), str(output), "--check"]
        with (
            patch.object(sys, "argv", args),
            patch.object(qualification, "snapshot", return_value=expected),
        ):
            with redirect_stdout(io.StringIO()):
                self.assertEqual(qualification.main(), 0)
            for field in ["schema_version", "generation_records"]:
                invalid = copy.deepcopy(expected)
                if field == "schema_version":
                    invalid[field] = True
                else:
                    invalid["catalogs"][0][field][:2] = [False, True]
                output.write_text(json.dumps(invalid))
                error = io.StringIO()
                with redirect_stderr(error), self.assertRaises(SystemExit) as failure:
                    qualification.main()
                self.assertEqual(failure.exception.code, 1)
                self.assertIn("Provenance snapshot is stale", error.getvalue())

    def test_nonobject_json_is_a_controlled_refusal(self):
        path = self.root / "invalid.json"
        path.write_text("[]")
        with self.assertRaisesRegex(ValueError, "JSON root must be an object"):
            qualification.read_json(path)

    def test_never_turns_a_human_declaration_into_initial_translation_review(self):
        self.generation["human_linguistic_review"] = {"by": "human:someone"}
        (self.root / qualification.PROVENANCE).write_text(json.dumps(self.generation))
        self.blobs[qualification.PROVENANCE] = (self.root / qualification.PROVENANCE).read_bytes()
        with self.assertRaisesRegex(ValueError, "Human review needs a versioned scope"):
            qualification.snapshot(self.candidate, self.root)


if __name__ == "__main__":
    unittest.main()
