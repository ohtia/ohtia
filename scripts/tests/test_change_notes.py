"""Exercise N14 with synthetic source graphs, inert PR text and review receipts."""

from __future__ import annotations

import copy
import html
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import change_notes as notes

FIXTURES = Path(__file__).parent / "fixtures/change-notes"


class ChangeNotesTests(unittest.TestCase):
    def setUp(self):
        self.history = json.loads((FIXTURES / "history.json").read_text())
        self.inputs = json.loads((FIXTURES / "notes.json").read_text())
        self.editorial = json.loads((FIXTURES / "editorial.json").read_text())
        self.candidate = json.loads((FIXTURES / "candidate.json").read_text())

    def bundle(self):
        return notes.assemble(self.history, self.inputs, self.editorial)

    def release(self, channel="preview", version="1.0.0", source="b", announced=None):
        self.history["releases"].append(
            {
                "id": f"fixture-{len(self.history['releases'])}",
                "version": version,
                "channel": channel,
                "source": source * 40,
                "announced": ["resume-reading"] if announced is None else announced,
            }
        )

    def decision(self, proposal):
        return {
            "schema_version": 1,
            "subject_sha256": proposal["subject_sha256"],
            "by": "human:fixture-reviewer",
            "evidence": "https://example.org/reviews/fixture",
        }

    def approved(self):
        proposal = notes.propose(self.bundle(), self.candidate)
        return notes.approve(proposal, self.decision(proposal))

    def test_first_stable_covers_all_prs_and_retains_unfinished_scope(self):
        bundle = self.bundle()
        self.assertIsNone(bundle["scope"]["baseline"])
        self.assertEqual(bundle["scope"]["prs"], [101, 102, 103, 104, 105])
        self.assertEqual(bundle["announced"], ["open-sources", "resume-reading"])
        self.assertEqual([c["id"] for c in bundle["retained"]], ["export-notes"])
        self.assertNotIn("Export your notes", bundle["body"])
        self.assertEqual(
            bundle["body"].count("- Resume your reading:"), 2
        )  # prose + technical evidence
        self.assertLess(
            bundle["body"].index("Reinstall this"),
            bundle["body"].index(notes.plain(self.editorial["summary"])),
        )
        self.assertIn("https://github.com/ohtia/ohtia/pull/102", bundle["body"])
        self.assertEqual(notes.validate_bundle(bundle), bundle)

    def test_stable_includes_scope_previously_available_only_in_preview(self):
        self.release()
        bundle = self.bundle()
        self.assertIsNone(bundle["scope"]["baseline"])
        self.assertIn("Resume your reading", bundle["body"])
        self.assertEqual(len(bundle["scope"]["commits"]), 5)

    def test_preview_delta_uses_last_preview_for_same_intended_stable(self):
        self.release()
        self.release(version="2.0.0", source="c", announced=[])
        self.editorial["channel"] = "preview"
        bundle = self.bundle()
        self.assertEqual(bundle["scope"]["baseline"]["source"], "b" * 40)
        self.assertEqual(bundle["scope"]["prs"], [103, 104, 105])
        self.assertNotIn("Resume your reading", bundle["body"])
        self.assertIn("Open local sources", bundle["body"])

    def test_preview_without_matching_baseline_uses_complete_scope(self):
        self.release(version="2.0.0")
        self.editorial["channel"] = "preview"
        self.assertIsNone(self.bundle()["scope"]["baseline"])
        self.assertEqual(len(self.bundle()["scope"]["commits"]), 5)

    def test_stable_uses_last_stable_and_includes_later_preview_changes(self):
        self.release(channel="stable", version="0.9.0", source="b")
        self.release(source="e", announced=["resume-reading", "open-sources"])
        bundle = self.bundle()
        self.assertEqual(bundle["scope"]["baseline"]["version"], "0.9.0")
        self.assertEqual(bundle["scope"]["prs"], [103, 104, 105])
        self.assertIn("Open local sources", bundle["body"])

    def test_available_previously_unfinished_change_is_carried_forward(self):
        self.release(source="d")
        self.editorial["channel"] = "preview"
        self.editorial["changes"][1]["available"] = True
        bundle = self.bundle()
        self.assertEqual(bundle["scope"]["prs"], [105])
        self.assertIn("Export your notes", bundle["body"])
        self.assertIn("export-notes", bundle["announced"])
        self.assertEqual(bundle["retained"], [])

    def test_graph_difference_includes_late_merged_side_branch(self):
        self.release(source="b")
        self.editorial["channel"] = "preview"
        self.history["commits"][3]["parents"] = ["a" * 40]
        self.history["commits"][4]["parents"] = ["c" * 40, "d" * 40]
        self.assertEqual(self.bundle()["scope"]["prs"], [103, 104, 105])

    def test_missing_duplicate_unrelated_and_misclassified_inputs_fail(self):
        for mutation in (
            lambda: self.inputs["notes"].pop(),
            lambda: self.inputs["notes"].append(copy.deepcopy(self.inputs["notes"][0])),
            lambda: self.inputs["notes"][0].update(pr=999),
            lambda: self.editorial["assessments"].pop(),
            lambda: self.editorial["assessments"][0].update(impact="none"),
            lambda: self.editorial["changes"].pop(),
            lambda: self.editorial["changes"][0]["prs"].pop(),
            lambda: self.editorial["changes"][0]["issues"].pop(),
        ):
            with self.subTest(mutation=mutation):
                self.setUp()
                mutation()
                with self.assertRaises(notes.NoteError):
                    self.bundle()

    def test_all_critical_consequences_require_independent_assessment_and_disclosure(self):
        for key in notes.DISCLOSURES:
            with self.subTest(key=key):
                self.setUp()
                self.editorial["assessments"][0]["disclosures"][key] = "Required fixture action."
                with self.assertRaises(notes.NoteError):
                    self.bundle()
                self.editorial["changes"][0]["disclosures"][key].append("Required fixture action.")
                self.assertIn(notes.plain("Required fixture action."), self.bundle()["body"])

    def test_no_public_effect_requires_reason_and_cannot_hide_consequences(self):
        self.inputs["notes"][2]["reason"] = ""
        with self.assertRaises(notes.NoteError):
            self.bundle()
        self.setUp()
        self.editorial["assessments"][2]["disclosures"]["privacy_transfers"] = "Sends a request."
        with self.assertRaises(notes.NoteError):
            self.bundle()

    def test_overclaims_require_evidence_in_final_copy_including_summary_and_disclosures(self):
        for target, key in ((self.editorial, "summary"), (self.editorial["changes"][0], "result")):
            with self.subTest(key=key):
                original = target[key]
                target[key] = "Open files 50% faster."
                with self.assertRaises(notes.NoteError):
                    self.bundle()
                target["claims"] = [
                    {"text": target[key], "evidence": ["https://example.org/benchmark"]}
                ]
                self.assertIn("benchmark", self.bundle()["body"])
                target[key], target["claims"] = original, []
        self.editorial["changes"][0]["disclosures"]["limitations"] = ["Better performance."]
        with self.assertRaises(notes.NoteError):
            self.bundle()

    def test_unsupported_author_claim_can_be_removed_by_editor(self):
        self.inputs["notes"][0]["result"] = "Open files 50% faster."
        self.inputs["notes"][0]["claims"] = [{"text": "Open files 50% faster.", "evidence": []}]
        self.assertNotIn("50%", self.bundle()["body"])

    def test_capture_supports_native_newlines_and_requires_unique_exact_identity(self):
        capture = json.loads((FIXTURES / "capture.json").read_text())
        self.assertEqual(notes.collect(capture), self.inputs)
        capture["pull_requests"][0]["body"] = capture["pull_requests"][0]["body"].replace(
            "\n", "\r\n"
        )
        self.assertEqual(notes.collect(capture), self.inputs)
        capture["pull_requests"][0]["number"] = 777
        with self.assertRaises(notes.NoteError):
            notes.collect(capture)
        capture = json.loads((FIXTURES / "capture.json").read_text())
        capture["pull_requests"][0]["body"] *= 2
        with self.assertRaises(notes.NoteError):
            notes.collect(capture)

    def test_shell_markup_and_helper_payloads_remain_inert_and_cannot_select_authority(self):
        attack = (
            "$(touch sentinel) `helper` <script>alert(1)</script> [run](javascript:evil) @everyone"
        )
        self.editorial["changes"][0]["result"] = attack
        self.inputs["notes"][0]["result"] = attack
        with (
            patch("subprocess.run", side_effect=AssertionError("No process execution")),
            patch("subprocess.Popen", side_effect=AssertionError("No process execution")),
        ):
            bundle = self.bundle()
        for unsafe in ("<script>", "`helper`", "@everyone", "[run]", "$(touch"):
            self.assertNotIn(unsafe, bundle["body"])
        self.assertIn("&#36;", bundle["body"])
        self.inputs["notes"][0]["workflow"] = "publish"
        with self.assertRaises(notes.NoteError):
            self.bundle()

    def test_json_duplicate_unknown_version_controls_and_nonfinite_values_fail(self):
        for raw in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}', '{"a":1.5}'):
            with self.subTest(raw=raw), self.assertRaises(notes.NoteError):
                notes.decode(raw)
        for mutation in (
            lambda: self.inputs.update(schema_version=True),
            lambda: self.inputs["notes"][0].update(schema_version=2),
            lambda: self.inputs["notes"][0].update(task="bad\x1b[31m"),
            lambda: self.inputs["notes"][0].update(pr=True),
            lambda: self.editorial.update(source="f" * 40),
        ):
            with self.subTest(mutation=mutation):
                self.setUp()
                mutation()
                with self.assertRaises(notes.NoteError):
                    self.bundle()
        with patch.object(notes, "MAX_BYTES", 8), self.assertRaises(notes.NoteError):
            notes.decode('"too much text"')

    def test_incomplete_cyclic_duplicate_and_nonancestor_history_fails(self):
        for mutation in (
            lambda: self.history["commits"][1].update(parents=["f" * 40]),
            lambda: self.history["commits"][1].update(parents=["b" * 40]),
            lambda: self.history["commits"].append(copy.deepcopy(self.history["commits"][0])),
            lambda: self.history.update(source="c" * 40),
        ):
            with self.subTest(mutation=mutation):
                self.setUp()
                mutation()
                with self.assertRaises(notes.NoteError):
                    self.bundle()
        self.setUp()
        self.release(source="f")
        with self.assertRaises(notes.NoteError):
            self.bundle()

    def test_non_pr_commits_require_explicit_retained_exclusion_reason(self):
        self.history["commits"].append(
            {
                "sha": "f" * 40,
                "parents": ["e" * 40],
                "pr": None,
                "reason": "Reviewed integration commit.",
            }
        )
        self.history["source"] = self.editorial["source"] = "f" * 40
        bundle = self.bundle()
        self.assertEqual(
            bundle["scope"]["excluded_commits"][0]["reason"], "Reviewed integration commit."
        )
        self.history["commits"][-1]["reason"] = ""
        with self.assertRaises(notes.NoteError):
            self.bundle()

    def test_approval_identifies_exact_candidate_note_channel_baseline_and_bytes(self):
        proposal = notes.propose(self.bundle(), self.candidate)
        decision = self.decision(proposal)
        approved = notes.approve(proposal, decision)
        self.assertEqual(notes.validate_approved(approved), approved)
        self.editorial["summary"] = "Open sources and resume reading."
        changed = notes.propose(self.bundle(), self.candidate)
        with self.assertRaises(notes.NoteError):
            notes.approve(changed, decision)
        altered = copy.deepcopy(proposal)
        altered["note"]["body"] += "changed"
        with self.assertRaises(notes.NoteError):
            notes.approve(altered, decision)
        self.candidate["id"] = "3" * 64
        with self.assertRaises(notes.NoteError):
            notes.approve(notes.propose(self.bundle(), self.candidate), decision)

    def test_self_consistent_forged_bundle_cannot_bypass_assembly(self):
        bundle = self.bundle()
        bundle["body"] = "Hidden migration warning.\n"
        bundle["body_sha256"] = notes.bytes_digest(bundle["body"])
        bundle = notes.seal({k: v for k, v in bundle.items() if k != "subject_sha256"})
        with self.assertRaises(notes.NoteError):
            notes.propose(bundle, self.candidate)

    def test_preview_to_stable_preserves_exact_packages_and_retains_both_notes(self):
        self.editorial["channel"] = "preview"
        before = self.approved()
        self.editorial["channel"] = "stable"
        after = self.approved()
        proposal = notes.transition(
            before, after, "channel-promotion", "Review complete stable scope."
        )
        approved = notes.approve(proposal, self.decision(proposal))
        self.assertEqual(notes.validate_approved(approved), approved)
        self.assertEqual(proposal["before"]["proposal"]["note"]["scope"]["channel"], "preview")
        self.assertEqual(proposal["after"]["proposal"]["candidate"], self.candidate)
        wrong = copy.deepcopy(after)
        wrong["proposal"]["candidate"]["packages_sha256"] = "3" * 64
        wrong["proposal"] = notes.seal(
            {k: v for k, v in wrong["proposal"].items() if k != "subject_sha256"}
        )
        wrong["approval"] = self.decision(wrong["proposal"])
        with self.assertRaises(notes.NoteError):
            notes.transition(before, wrong, "channel-promotion", "Cannot change bytes.")

    def test_correction_retains_before_after_bytes_digests_reason_and_explicit_approval(self):
        before = self.approved()
        self.editorial["summary"] = "Open local sources and resume reading."
        after = self.approved()
        proposal = notes.transition(
            before, after, "prose-correction", "Clarify the English summary."
        )
        record = notes.approve(proposal, self.decision(proposal))
        self.assertNotEqual(
            proposal["before"]["proposal"]["note"]["body_sha256"],
            proposal["after"]["proposal"]["note"]["body_sha256"],
        )
        self.assertEqual(notes.validate_approved(record), record)
        with self.assertRaises(notes.NoteError):
            notes.approve(proposal, after["approval"])
        with self.assertRaises(notes.NoteError):
            notes.transition(before, before, "prose-correction", "No actual edit.")
        self.release(channel="stable", version="0.9.0")
        with self.assertRaises(notes.NoteError):
            notes.transition(before, self.approved(), "prose-correction", "Changed baseline.")

    def test_receipts_do_not_infer_humans_or_accept_stale_decisions(self):
        proposal = notes.propose(self.bundle(), self.candidate)
        for changes in (
            {"by": "agent:fixture"},
            {"subject_sha256": "f" * 64},
            {"evidence": "javascript:bad"},
            {"publish": True},
        ):
            with self.subTest(changes=changes), self.assertRaises(notes.NoteError):
                notes.approve(proposal, {**self.decision(proposal), **changes})

    def test_cli_full_pipeline_uses_new_paths_and_never_overwrites_evidence(self):
        with tempfile.TemporaryDirectory(prefix="notes á ") as temp:
            root = Path(temp)
            out = root / "notes.json"
            self.assertEqual(notes.main(["collect", str(FIXTURES / "capture.json"), str(out)]), 0)
            bundle = root / "bundle.json"
            self.assertEqual(
                notes.main(
                    [
                        "assemble",
                        str(FIXTURES / "history.json"),
                        str(out),
                        str(FIXTURES / "editorial.json"),
                        str(bundle),
                    ]
                ),
                0,
            )
            with redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(notes.main(["render", str(bundle)]), 0)
            self.assertEqual(stdout.getvalue(), self.bundle()["body"])
            proposal = root / "proposal.json"
            self.assertEqual(
                notes.main(
                    ["propose", str(bundle), str(FIXTURES / "candidate.json"), str(proposal)]
                ),
                0,
            )
            decision = root / "decision.json"
            notes.write(decision, self.decision(notes.read(proposal)))
            approved = root / "approved.json"
            self.assertEqual(
                notes.main(["approve", str(proposal), str(decision), str(approved)]), 0
            )
            with redirect_stdout(io.StringIO()):
                self.assertEqual(notes.main(["verify", str(approved)]), 0)
            prior = approved.read_bytes()
            with redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(
                    notes.main(["approve", str(proposal), str(decision), str(approved)]), 1
                )
            self.assertEqual(approved.read_bytes(), prior)
            self.assertNotIn(str(root), stderr.getvalue())

    def test_malformed_cli_inputs_fail_without_traceback_or_input_disclosure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad = root / "malformed.json"
            for raw in (
                '{"subject_sha256":"' + "f" * 64 + '","unknown":1e999}',
                '{"schema_version":1,"proposal":[],"approval":{}}',
            ):
                bad.write_text(raw)
                with redirect_stderr(io.StringIO()) as stderr:
                    self.assertEqual(notes.main(["verify", str(bad)]), 1)
                self.assertNotIn("Traceback", stderr.getvalue())
                self.assertNotIn(raw, stderr.getvalue())

    def test_disclosures_on_baseline_capabilities_survive_delta_prose_omission(self):
        for key in notes.DISCLOSURES:
            with self.subTest(key=key):
                self.setUp()
                self.release(source="b")
                self.editorial["channel"] = "preview"
                consequence = "Current consequence on previously announced scope."
                self.editorial["assessments"][0]["disclosures"][key] = consequence
                self.editorial["changes"][0]["disclosures"][key].append(consequence)
                bundle = self.bundle()
                self.assertNotIn("- Resume your reading:", bundle["body"])
                self.assertIn(notes.plain(consequence), bundle["body"])
                self.assertLess(
                    bundle["body"].index(notes.plain(consequence)),
                    bundle["body"].index(notes.plain(self.editorial["summary"])),
                )

    def test_free_text_cannot_form_bare_links_mentions_or_issue_references(self):
        value = (
            "Read https://example.org/a_b?q=1&x=2#part and www.example.org GH-28 @reader. :warning:"
        )
        encoded = notes.plain(value)
        self.assertEqual(html.unescape(encoded.replace("<code>", "").replace("</code>", "")), value)
        self.assertEqual(encoded.count("<code>"), 5)
        for raw in (
            "https://",
            "www.",
            "GH-28",
            "@reader",
            "a_b",
            "?q=",
            "&x=",
            "#part",
            ":warning:",
        ):
            self.assertNotIn(raw, encoded)
        self.editorial["changes"][0]["result"] = value
        self.assertIn(encoded, self.bundle()["body"])
        for fragment in (":warning", "warning:", ":warning:", "foo:warning", ":warning::x:"):
            with self.subTest(fragment=fragment):
                self.editorial["changes"][0]["task"] = f"Restart now {fragment}"
                body = self.bundle()["body"]
                self.assertIn(notes.plain(f"Restart now {fragment}") + ":", body)
                self.assertIn("<code>", notes.plain(fragment))

    def test_deprecation_removal_requires_disclosure_and_uses_its_own_section(self):
        self.release(source="b")
        self.editorial["channel"] = "preview"
        # The current delivered outcome for the same capability is its removal.
        removed = self.inputs["notes"][-1]
        removed["change_id"] = "resume-reading"
        removed["kind"] = "deprecation/removal"
        change = self.editorial["changes"][0]
        change["kind"] = "deprecation/removal"
        change["result"] = "Reading progress is no longer retained."
        change["prs"].append(105)
        change["issues"].append(1105)
        self.editorial["changes"].pop()
        with self.assertRaises(notes.NoteError):
            self.bundle()
        change["disclosures"]["removed_support"] = [
            "Record your reading position before upgrading."
        ]
        bundle = self.bundle()
        self.assertIn("## Deprecations and removals", bundle["body"])
        self.assertNotIn("## Improvements", bundle["body"])
        self.assertIn(notes.plain(change["result"]), bundle["body"])
        self.assertIn(notes.plain("Record your reading position before upgrading."), bundle["body"])
        self.assertTrue(change["available"])

    def test_first_preview_without_same_version_baseline_uses_full_scope_even_after_stable(self):
        self.release(channel="stable", version="0.9.0", source="b")
        self.editorial["channel"] = "preview"
        bundle = self.bundle()
        self.assertIsNone(bundle["scope"]["baseline"])
        self.assertEqual(bundle["scope"]["prs"], [101, 102, 103, 104, 105])
        self.assertIn("Resume your reading", bundle["body"])

    def test_prose_correction_can_repair_omitted_announcement_with_identical_packages(self):
        before = self.approved()
        self.editorial["changes"][1]["available"] = True
        after = self.approved()
        proposal = notes.transition(
            before,
            after,
            "prose-correction",
            "Correct the previous omission after reviewing the same source and packages.",
        )
        record = notes.approve(proposal, self.decision(proposal))
        self.assertEqual(notes.validate_approved(record), record)
        self.assertEqual(before["proposal"]["candidate"], after["proposal"]["candidate"])
        self.assertNotIn("export-notes", before["proposal"]["note"]["announced"])
        self.assertIn("export-notes", after["proposal"]["note"]["announced"])

    def test_security_applicability_references_real_controls_and_tests(self):
        control_file = FIXTURES.parents[3] / "config/change-notes/security.json"
        record = json.loads(control_file.read_text())
        self.assertEqual(record["owner"], "STORY-001-014")
        for control in record["controls"]:
            self.assertTrue(control["requirements"])
            for test in control["deterministic_tests"]:
                self.assertTrue(hasattr(ChangeNotesTests, test.rsplit(".", 1)[-1]))
            for path in control["enforcing_files"]:
                self.assertTrue((FIXTURES.parents[3] / path).is_file())


if __name__ == "__main__":
    unittest.main()
