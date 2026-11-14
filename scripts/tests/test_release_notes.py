"""Exercise the first release-notes text with a real Git history and a fake GitHub API."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from contextlib import redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import change_notes  # noqa: E402
import release_notes as notes  # noqa: E402
import release_prepare  # noqa: E402

ISOLATED = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def note(pr, change_id="change", kind="correction", availability="available", **fields):
    if fields.get("impact") == "none":
        return {"schema_version": 1, "pr": pr, "issues": [1], "impact": "none", "reason": "x"}
    disclosures = dict.fromkeys(change_notes.DISCLOSURES)
    disclosures.update(fields.get("disclosures", {}))
    return {
        "schema_version": 1,
        "pr": pr,
        "issues": [1],
        "impact": "user",
        "change_id": change_id,
        "kind": kind,
        "task": fields.get("task", f"Task {pr}"),
        "result": fields.get("result", f"Result {pr}."),
        "platforms": ["Linux"],
        "availability": availability,
        "disclosures": disclosures,
        "claims": [],
    }


def body(value):
    return f"Text.\n\n```ohtia-note\n{json.dumps(value, indent=2)}\n```\n"


class FakeGitHub(release_prepare.GitHub):
    def __init__(self, pulls):
        self.pulls = pulls
        self.calls = []

    def api(self, method, path, payload=None, **kwargs):
        self.calls.append((method, path))
        page = int(path.rsplit("page=", 1)[1])
        values = list(self.pulls.values())
        return 200, values[(page - 1) * 100 : page * 100]


class History:
    """A main branch whose pull requests are merged with GitHub's merge commit subject."""

    def __init__(self, root: Path):
        self.root = root
        self.git("init", "--quiet", "--initial-branch=main")
        self.commit("initial")
        self.pulls = {}

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
            env=ISOLATED,
        ).stdout.strip()

    def commit(self, message):
        (self.root / "file").write_text(message)
        self.git("add", "file")
        self.git("commit", "--quiet", "--no-gpg-sign", "-m", message)
        return self.git("rev-parse", "HEAD")

    def merge(self, number, text=None, merged=True, subject=None):
        self.git("switch", "--quiet", "-c", f"pr-{number}")
        head = self.commit(f"change {number}")
        self.git("switch", "--quiet", "main")
        subject = subject or f"Merge pull request #{number} from fork/pr-{number}"
        self.git("merge", "--quiet", "--no-ff", "--no-gpg-sign", "-m", subject, f"pr-{number}")
        self.pulls[number] = {
            "number": number,
            "merged_at": "2026-11-14T00:00:00Z" if merged else None,
            "head": {"sha": head},
            "body": body(note(number)) if text is None else text,
        }
        return self.git("rev-parse", "HEAD")

    def tag(self, name):
        self.git("tag", name)

    def draft(self):
        return notes.draft(self.root, self.git("rev-parse", "HEAD"), FakeGitHub(self.pulls))


class DraftTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.history = History(Path(self.directory.name))

    def tearDown(self):
        self.directory.cleanup()

    def test_without_a_published_tag_the_text_covers_the_whole_history(self):
        self.history.merge(1)
        self.history.tag("reserved/v0.1.0")
        self.history.merge(2)
        record = self.history.draft()
        self.assertIsNone(record["baseline"])
        self.assertEqual(record["pull_requests"], [1, 2])
        self.assertEqual([change["prs"] for change in record["changes"]], [[1, 2]])

    def test_a_reserved_but_unpublished_version_is_never_the_baseline(self):
        self.history.merge(1, body(note(1, "first")))
        self.history.tag("v0.1.0")
        self.history.merge(2, body(note(2, "prepared")))
        self.history.tag("reserved/v0.2.0")
        self.history.merge(3, body(note(3, "fix")))
        record = self.history.draft()
        self.assertEqual(record["baseline"], "v0.1.0")
        self.assertEqual(record["pull_requests"], [2, 3])
        text = notes.render(record)
        self.assertIn("- Task 2: Result 2. (#2)", text)
        self.assertIn("- Task 3: Result 3. (#3)", text)
        self.assertNotIn("Task 1", text)

    def test_the_highest_published_version_in_the_history_is_the_baseline(self):
        self.history.merge(1)
        self.history.tag("v0.9.0")
        self.history.merge(2)
        self.history.tag("v0.10.0")
        self.history.tag("v1.0.0-rc.1")
        self.history.merge(3, body(note(3, "later")))
        self.assertEqual(self.history.draft()["baseline"], "v0.10.0")

    def test_a_pull_request_without_a_valid_note_is_reported_and_preparation_continues(self):
        self.history.merge(1, "No note at all.")
        self.history.merge(2, body({"impact": "user"}))
        self.history.merge(3)
        record = self.history.draft()
        self.assertEqual(record["without_note"], [1, 2])
        self.assertEqual(record["unmatched_merges"], [])
        self.assertEqual([change["prs"] for change in record["changes"]], [[3]])

    def test_a_merge_with_an_edited_subject_is_still_its_pull_request(self):
        self.history.merge(1, subject="Ship the export (#1)")
        record = self.history.draft()
        self.assertEqual(record["pull_requests"], [1])
        self.assertEqual([change["prs"] for change in record["changes"]], [[1]])

    def test_merges_without_a_merged_pull_request_are_reported_by_commit(self):
        unmerged = self.history.merge(1, merged=False)
        other = self.history.merge(2)
        self.history.pulls[2]["head"]["sha"] = "f" * 40
        self.history.merge(3)
        record = self.history.draft()
        self.assertEqual(record["unmatched_merges"], [unmerged, other])
        self.assertEqual(record["pull_requests"], [3])
        self.assertIn(
            f"Merge commits without a matching merged pull request: `{unmerged[:12]}`, "
            f"`{other[:12]}`.",
            notes.summary_lines(record),
        )

    def test_two_merged_pull_requests_with_one_head_are_ambiguous(self):
        merge = self.history.merge(1)
        self.history.pulls[2] = {**self.history.pulls[1], "number": 2}
        record = self.history.draft()
        self.assertEqual(record["unmatched_merges"], [merge])
        self.assertEqual(record["changes"], [])

    def test_a_merge_whose_head_differs_from_the_pull_request_is_not_trusted(self):
        merge = self.history.merge(1)
        self.history.pulls[1]["head"]["sha"] = "f" * 40
        record = self.history.draft()
        self.assertEqual(record["unmatched_merges"], [merge])
        self.assertEqual(record["without_note"], [])
        self.assertEqual(record["changes"], [])

    def test_unfinished_and_no_impact_notes_are_not_announced(self):
        self.history.merge(1, body(note(1, "later", availability="unfinished")))
        self.history.merge(2, body(note(2, impact="none")))
        self.history.merge(3, body(note(3, "now")))
        record = self.history.draft()
        self.assertEqual(record["unfinished"], [1])
        self.assertEqual([change["prs"] for change in record["changes"]], [[3]])

    def test_a_change_completed_later_is_announced_once_with_all_its_pull_requests(self):
        self.history.merge(1, body(note(1, "export", "capability", "unfinished", task="Old")))
        self.history.tag("v0.1.0")
        self.history.merge(2, body(note(2, "export", "capability", task="Export your notes")))
        self.history.merge(3, body(note(3, "export", "capability", task="Export your notes")))
        record = self.history.draft()
        self.assertEqual(record["unfinished"], [])
        self.assertEqual([change["prs"] for change in record["changes"]], [[1, 2, 3]])
        self.assertIn("- Export your notes: Result 3. (#1, #2, #3)", notes.render(record))

    def test_an_announced_change_is_not_repeated_and_disclosures_of_the_group_are_kept(self):
        backup = {"migration": "Back up first."}
        self.history.merge(1, body(note(1, "export", disclosures={"migration": "Old."})))
        self.history.merge(2, body(note(2, "sync", availability="unfinished", disclosures=backup)))
        self.history.tag("v0.1.0")
        self.history.merge(3, body(note(3, "export", task="Export")))
        self.history.merge(4, body(note(4, "sync", task="Sync")))
        record = self.history.draft()
        self.assertEqual([change["prs"] for change in record["changes"]], [[3], [2, 4]])
        text = notes.render(record)
        self.assertIn("- Sync: Back up first.", text)
        self.assertNotIn("Old.", text)

    def test_a_change_finished_before_the_baseline_does_not_bring_back_its_history(self):
        self.history.merge(
            1, body(note(1, "export", availability="unfinished", disclosures={"migration": "Old."}))
        )
        self.history.merge(2, body(note(2, "export")))
        self.history.tag("v0.1.0")
        self.history.merge(
            3,
            body(
                note(
                    3,
                    "export",
                    "deprecation/removal",
                    task="Remove",
                    disclosures={"removed_support": "Gone."},
                )
            ),
        )
        record = self.history.draft()
        self.assertEqual([change["prs"] for change in record["changes"]], [[3]])
        text = notes.render(record)
        self.assertIn("- Remove: Gone.", text)
        self.assertIn("- Remove: Result 3. (#3)", text)
        self.assertNotIn("Old.", text)
        self.assertNotIn("#1", text)

    def test_more_than_one_page_of_pull_requests_is_read_and_bounded(self):
        for number in range(1, 106):
            self.history.pulls[number] = {"number": number, "merged_at": None, "head": {}}
        self.history.merge(200)
        github = FakeGitHub(self.history.pulls)
        record = notes.draft(self.history.root, self.history.git("rev-parse", "HEAD"), github)
        self.assertEqual([change["prs"] for change in record["changes"]], [[200]])
        self.assertEqual(len(github.calls), 2)
        self.assertIn("sort=created&direction=asc", github.calls[0][1])
        with unittest.mock.patch.object(notes, "MAXIMUM_PULL_PAGES", 1):
            with self.assertRaisesRegex(release_prepare.ReleaseError, "Too many pull requests"):
                notes.draft(self.history.root, self.history.git("rev-parse", "HEAD"), github)


class RenderTests(unittest.TestCase):
    def record(self, *items):
        def disclosures(item):
            return {
                key: [item["disclosures"][key]] if item["disclosures"][key] else []
                for key in notes.ACTIONS
            }

        return {
            "changes": [
                {"note": item, "prs": [item["pr"]], "disclosures": disclosures(item)}
                for item in items
            ]
        }

    def test_sections_follow_the_change_kind_and_notices_come_first(self):
        text = notes.render(
            self.record(
                note(1, "a", "correction", task="Fix it", result="Fixed."),
                note(
                    2,
                    "b",
                    "capability",
                    task="Do it",
                    result="Done.",
                    disclosures={"migration": "Migrate first.", "limitations": "Not on KDE."},
                ),
                note(3, "c", "security", task="Stay safe", result="Patched."),
                note(4, "d", "deprecation/removal", task="Drop it", result="Removed."),
                note(5, "e", "improvement", task="Speed", result="Faster."),
            )
        )
        self.assertEqual(
            text,
            "\n".join(
                [
                    notes.SUMMARY,
                    "",
                    "## Breaking Changes and Notices",
                    "",
                    "- Do it: Migrate first.",
                    "- Drop it: Removed. (#4)",
                    "",
                    "## Security",
                    "",
                    "- Stay safe: Patched. (#3)",
                    "",
                    "## Features",
                    "",
                    "- Do it: Done. (#2)",
                    "- Speed: Faster. (#5)",
                    "",
                    "## Bug Fixes",
                    "",
                    "- Fix it: Fixed. (#1)",
                    "",
                ]
            ),
        )
        self.assertNotIn("Not on KDE", text)

    def test_notes_may_reach_but_not_exceed_the_notes_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "source").mkdir()
            history = History(Path(directory) / "source")
            history.merge(1, body(note(1, result="x" * 300)))
            env = {
                "GITHUB_TOKEN": "token",
                "OHTIA_RELEASE_COMMIT": history.git("rev-parse", "HEAD"),
            }
            github = FakeGitHub(history.pulls)
            length = len(notes.render(history.draft()))
            for limit, code in ((length, 0), (length - 1, 1)):
                with self.subTest(limit=limit):
                    output = Path(directory) / f"notes-{limit}"
                    errors = io.StringIO()
                    with unittest.mock.patch.object(release_prepare, "GitHub", return_value=github):
                        with unittest.mock.patch.object(notes, "MAXIMUM_CHARACTERS", limit):
                            with redirect_stderr(errors):
                                result = notes.main([str(history.root), str(output)], env)
                    self.assertEqual(result, code)
                    self.assertEqual(output.exists(), code == 0)
                    if code:
                        self.assertIn(f"exceed {limit} characters", errors.getvalue())

    def test_shell_markdown_link_and_mention_syntax_stay_literal(self):
        hostile = (
            "Run `rm -rf ~` $(whoami) [click](https://example.invalid) ![i](x.png) "
            "**bold** <b>raw</b> &amp; @someone #12 cec4ec2ec16b mail@example.invalid"
        )
        line = notes.render(self.record(note(1, task="- " + hostile, result=hostile)))
        line = line.splitlines()[-1]
        expected = (
            "\\`rm -rf \\~\\` `$(whoami)` `[click](https://example.invalid)` \\!\\[i\\](x.png) "
            "\\*\\*bold\\*\\* \\<b\\>raw\\</b\\> \\&amp; `@someone` `#12` `cec4ec2ec16b` "
            "`mail@example.invalid`"
        )
        self.assertEqual(line, f"- \\- Run {expected}: Run {expected} (#1)")

    def test_code_spans_hold_backticks_and_text_is_one_line(self):
        self.assertEqual(notes.code("a`@b"), "``a`@b``")
        self.assertEqual(notes.code("`@b`"), "`` `@b` ``")
        self.assertEqual(notes.literal("one\n\n## two\r\n- three"), "one \\#\\# two - three")
        self.assertEqual(notes.literal("1. first", leading=True), "1\\. first")
        self.assertEqual(notes.literal("2) second", leading=True), "2\\) second")
        self.assertEqual(
            notes.literal("Set $x$ and :warning: but keep 3.5 and 10:30"),
            "Set `$x$` and `:warning:` but keep 3.5 and 10:30",
        )
        self.assertEqual(notes.literal("see _www.example.invalid"), "see `_www.example.invalid`")


class CommandTests(unittest.TestCase):
    def test_the_command_writes_the_text_report_and_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "source").mkdir()
            history = History(Path(directory) / "source")
            history.merge(1, "No note.")
            history.merge(2)
            summary = Path(directory) / "summary.md"
            env = {
                "GITHUB_TOKEN": "token",
                "OHTIA_RELEASE_COMMIT": history.git("rev-parse", "HEAD"),
                "GITHUB_STEP_SUMMARY": str(summary),
            }
            output = Path(directory) / "notes"
            github = FakeGitHub(history.pulls)
            with unittest.mock.patch.object(release_prepare, "GitHub", return_value=github):
                code = notes.main([str(history.root), str(output)], env)
            self.assertEqual(code, 0)
            self.assertIn("- Task 2: Result 2. (#2)", (output / "notes.md").read_text())
            report = json.loads((output / "notes.json").read_text())
            self.assertEqual(report["without_note"], [1])
            self.assertEqual(report["announced"], [[2]])
            self.assertIn("without a valid `ohtia-note`: #1.", summary.read_text())

    def test_a_checkout_of_another_commit_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            history = History(Path(directory))
            env = {"GITHUB_TOKEN": "token", "OHTIA_RELEASE_COMMIT": "a" * 40}
            errors = io.StringIO()
            with redirect_stderr(errors):
                code = notes.main([directory, str(Path(directory) / "out")], env)
            self.assertEqual(code, 1)
            self.assertIn("Check out the selected commit", errors.getvalue())
            self.assertFalse((Path(directory) / "out").exists())
            del history


if __name__ == "__main__":
    unittest.main()
