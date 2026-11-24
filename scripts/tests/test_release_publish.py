"""Exercise release publication against a fixture repository state without network access."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import release_prepare as prepare  # noqa: E402
import release_publish as publish  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_TEXT = (ROOT / ".github/workflows/publish-release.yml").read_text(encoding="utf-8")
# Structural assertions ignore the explanatory end-of-line comments.
WORKFLOW = re.sub(r"(?<=\S) # [^\n]*", "", WORKFLOW_TEXT)
COMMIT = "c" * 40
TAG_OBJECT = "d" * 40
VERSION = "0.1.0"
PACKAGES = {
    "ohtia-0.1.0-linux-x64-fedora-44.rpm": ("embedded", b"signed rpm bytes"),
    "ohtia-0.1.0-linux-x64-ubuntu-26.04.deb": ("repository", b"deb bytes"),
    "ohtia-0.1.0-win32-x64-unsigned.exe": ("unsigned", b"unsigned exe bytes"),
    "ohtia-0.1.0-darwin-arm64-unsigned.dmg": ("unsigned", b"unsigned dmg bytes"),
}
NOTES = "Ohtia now opens.\r\n\r\n## Features\r\n\r\n- Open Ohtia: It opens. (#1)"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_file() -> bytes:
    record = {
        "schema_version": 1,
        "version": VERSION,
        "source": {"commit": COMMIT, "tree": "e" * 40},
        "workflow": {"path": prepare.WORKFLOW, "commit": COMMIT, "run_id": 7, "run_attempt": 1},
        "assets": [
            {"name": name, "bytes": len(data), "sha256": sha256(data), "authentication": kind}
            for name, (kind, data) in PACKAGES.items()
        ],
    }
    return (json.dumps(record, indent=2) + "\n").encode()


def prepared_body() -> str:
    """The body as preparation writes it and a browser edit stores it, with CRLF endings."""
    unsigned = [name for name, (kind, _) in PACKAGES.items() if kind == "unsigned"]
    block = [prepare.UNSIGNED_HEADING, "", prepare.UNSIGNED_STATEMENT, ""]
    block += [f"- `{name}`" for name in unsigned]
    return NOTES + "\r\n\r\n" + "\r\n".join(block) + "\r\n"


class Response(io.BytesIO):
    status = 200


class FakeGitHub(prepare.GitHub):
    """Model the reservation, the release, its assets and the tag that publication creates."""

    def __init__(self):
        super().__init__("synthetic-token", opener=self.open)
        self.refs = {f"refs/tags/reserved/v{VERSION}": TAG_OBJECT}
        self.tags = {TAG_OBJECT: {"object": {"type": "commit", "sha": COMMIT}}}
        self.blobs: dict[int, bytes] = {}
        self.next_id = 100
        self.release = {
            "id": 9,
            "tag_name": f"v{VERSION}",
            "target_commitish": COMMIT,
            "name": VERSION,
            "draft": True,
            "prerelease": False,
            "body": prepared_body(),
            "html_url": "https://github.com/ohtia/ohtia/releases/tag/untagged-1",
            "assets": [],
        }
        for name, (_, data) in PACKAGES.items():
            self.add_asset(name, data)
        self.add_asset(prepare.DIGESTS, digest_file())
        self.writes: list[tuple[str, str]] = []
        self.fail_after_publish = False
        self.main = COMMIT
        self.starter_upload = False
        self.compared_files: list[dict] = []

    def add_asset(self, name: str, data: bytes) -> dict:
        self.next_id += 1
        asset = {
            "id": self.next_id,
            "name": name,
            "size": len(data),
            "state": "uploaded",
            "digest": f"sha256:{sha256(data)}",
        }
        self.blobs[self.next_id] = data
        self.release["assets"].append(asset)
        return asset

    def open(self, request, timeout=60):
        assert "Authorization" not in request.headers, "the token must not follow the redirect"
        assert request.unredirected_hdrs.get("Authorization") == "Bearer synthetic-token"
        asset_id = int(request.full_url.rsplit("/", 1)[1])
        return Response(self.blobs[asset_id])

    def request(
        self, method, url, payload=None, *, data=None, headers=None, allowed=(200,), timeout=60
    ):
        path = url.split("ohtia/ohtia/", 1)[1]
        if method != "GET":
            self.writes.append((method, path))
        status, value = self.respond(method, path, payload, data)
        prepare.require(status in allowed, f"HTTP {status}")
        return status, copy.deepcopy(value)

    def respond(self, method, path, payload, data):
        if method == "GET" and path.startswith("git/ref/tags/"):
            name = "refs/tags/" + path.removeprefix("git/ref/tags/").replace("%2F", "/")
            if name not in self.refs:
                return 404, None
            kind = "tag" if self.refs[name] in self.tags else "commit"
            return 200, {"object": {"type": kind, "sha": self.refs[name]}}
        if method == "GET" and path == "git/ref/heads/main":
            return 200, {"object": {"type": "commit", "sha": self.main}}
        if method == "GET" and path == f"compare/{COMMIT}...{self.main}?per_page=1":
            return 200, {"status": "ahead", "behind_by": 0, "files": self.compared_files}
        if method == "GET" and path.startswith("git/tags/"):
            return 200, self.tags[path.removeprefix("git/tags/")]
        if method == "GET" and path.startswith("releases?"):
            return 200, [self.release] if self.release else []
        if method == "GET" and path == f"releases/{self.release['id']}":
            return 200, self.release
        if method == "DELETE" and path.startswith("releases/assets/"):
            asset_id = int(path.rsplit("/", 1)[1])
            self.release["assets"] = [a for a in self.release["assets"] if a["id"] != asset_id]
            return 204, None
        if method == "POST" and path.startswith(f"releases/{self.release['id']}/assets?name="):
            name = path.split("name=", 1)[1]
            if any(asset["name"] == name for asset in self.release["assets"]):
                return 422, None
            if self.starter_upload:
                self.starter_upload = False
                self.add_asset(name, b"")["state"] = "starter"
                return 502, None
            return 201, self.add_asset(name, bytes(data))
        if method == "PATCH" and path == f"releases/{self.release['id']}":
            assert payload["tag_name"] == f"v{VERSION}" and payload["target_commitish"] == COMMIT
            if "body" in payload:
                self.release["body"] = payload["body"]
            if payload.get("draft") is False:
                self.release["draft"] = False
                self.release["html_url"] = f"https://github.com/ohtia/ohtia/releases/tag/v{VERSION}"
                tag = f"refs/tags/v{VERSION}"
                assert tag not in self.refs, "the tag is created once"
                self.refs[tag] = COMMIT
                if self.fail_after_publish:
                    self.fail_after_publish = False
                    raise prepare.ReleaseError("connection lost")
            return 200, self.release
        raise AssertionError(f"unexpected {method} {path}")


def env(**overrides) -> dict:
    return {
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_RUN_ATTEMPT": "1",
        "OHTIA_RELEASE_VERSION": VERSION,
        **overrides,
    }


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.scratch = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def check(self, github, **overrides):
        return publish.check(github, env(**overrides), self.scratch)

    def approved(self, github, **overrides) -> dict:
        state = self.check(github, **overrides)
        return env(
            OHTIA_RELEASE_COMMIT=state["commit"],
            OHTIA_RELEASE_ID=str(state["release"]["id"]),
            OHTIA_RELEASE_BODY_SHA256=state["body_sha256"],
            OHTIA_RELEASE_FINAL_SHA256=state["final_sha256"],
            OHTIA_RELEASE_DIGESTS_SHA256=state["digests"]["sha256"],
            **overrides,
        )

    def refused(self, github, message, **overrides):
        with self.assertRaisesRegex(prepare.ReleaseError, message):
            self.check(github, **overrides)
        self.assertEqual(github.writes, [])

    def test_a_publication_makes_the_signed_packages_public_with_the_tag_and_notes_digest(self):
        github = FakeGitHub()
        before = {a["name"]: github.blobs[a["id"]] for a in github.release["assets"]}
        state = publish.publish(github, self.approved(github), self.scratch)
        release = github.release
        self.assertFalse(release["draft"])
        self.assertEqual(github.refs[f"refs/tags/v{VERSION}"], COMMIT)
        names = sorted(asset["name"] for asset in release["assets"])
        signed = [name for name, (kind, _) in PACKAGES.items() if kind != "unsigned"]
        self.assertEqual(names, sorted([*signed, prepare.DIGESTS, publish.NOTES_DIGEST]))
        for asset in release["assets"]:
            if asset["name"] != publish.NOTES_DIGEST:
                self.assertEqual(github.blobs[asset["id"]], before[asset["name"]])
        self.assertEqual(release["body"], NOTES)
        self.assertNotIn(prepare.UNSIGNED_HEADING, release["body"])
        notes = next(a for a in release["assets"] if a["name"] == publish.NOTES_DIGEST)
        self.assertEqual(github.blobs[notes["id"]], f"{sha256(NOTES.encode())}\n".encode())
        self.assertEqual(state["final_sha256"], sha256(NOTES.encode()))
        patches = [w for w in github.writes if w[0] == "PATCH"]
        self.assertEqual(len(patches), 3, "an unchanged update, the body and the publication")
        self.assertEqual(github.writes[0][0], "PATCH", "the unchanged update comes first")
        self.assertTrue(state["published"])

    def test_the_approval_summary_shows_the_version_commit_and_every_digest(self):
        github = FakeGitHub()
        lines = "\n".join(publish.approval_summary(self.check(github)))
        self.assertIn(f"`{VERSION}`", lines)
        self.assertIn(f"`{COMMIT}`", lines)
        for name, (kind, data) in PACKAGES.items():
            self.assertIn(f"`{sha256(data)}`", lines)
            self.assertEqual(f"`{name}` (removed)" in lines, kind == "unsigned")
        self.assertIn(f"`{sha256(digest_file())}`", lines)
        self.assertIn(f"`{sha256(NOTES.encode())}`", lines)

    def test_a_missing_release_or_reservation_is_refused_before_any_change(self):
        github = FakeGitHub()
        github.refs.clear()
        self.refused(github, "has no reserved/v0.1.0 tag")
        github = FakeGitHub()
        github.release["tag_name"] = "v0.2.0"
        self.refused(github, "No unpublished release")

    def test_an_already_public_release_is_refused_before_any_change(self):
        github = FakeGitHub()
        publish.publish(github, self.approved(github), self.scratch)
        github.writes.clear()
        self.refused(github, "already public")

    def test_an_asset_that_differs_from_the_digest_file_is_refused_before_any_change(self):
        github = FakeGitHub()
        rpm = github.release["assets"][0]
        github.blobs[rpm["id"]] = b"signed rpm byteZ"
        self.refused(github, "differs from the digest file")
        github = FakeGitHub()
        github.release["assets"] = github.release["assets"][1:]
        self.refused(github, "lacks signed packages")
        github = FakeGitHub()
        github.add_asset("extra.txt", b"extra")
        self.refused(github, "outside its digest file")

    def test_a_release_on_another_commit_or_a_moved_reservation_is_refused(self):
        github = FakeGitHub()
        github.release["target_commitish"] = "f" * 40
        self.refused(github, "targets another commit")
        github = FakeGitHub()
        github.refs[f"refs/tags/reserved/v{VERSION}"] = COMMIT
        self.refused(github, "not an annotated reservation tag")

    def test_a_changed_or_misplaced_testing_heading_is_refused(self):
        github = FakeGitHub()
        github.release["body"] = github.release["body"].replace("not distributed", "distributed")
        self.refused(github, "differs from the prepared one")
        github = FakeGitHub()
        github.release["body"] += "\r\nA line after the list.\r\n"
        self.refused(github, "not at the end")
        github = FakeGitHub()
        github.release["body"] = NOTES
        self.refused(github, "lacks the testing-only heading")

    def test_a_body_edited_after_the_approval_is_refused_before_any_change(self):
        github = FakeGitHub()
        approved = self.approved(github)
        github.release["body"] = github.release["body"].replace("It opens.", "It opens fast.")
        with self.assertRaisesRegex(prepare.ReleaseError, "body changed after the approval"):
            publish.publish(github, approved, self.scratch)
        self.assertEqual(github.writes, [])

    def test_a_run_interrupted_after_publication_creates_the_tag_once_and_replaces_no_asset(self):
        github = FakeGitHub()
        github.fail_after_publish = True
        approved = self.approved(github)
        with self.assertRaisesRegex(
            prepare.ReleaseError, "connection lost Public now: the release 0.1.0 and the tag v0.1.0"
        ):
            publish.publish(github, approved, self.scratch)
        uploaded = {a["name"]: a["id"] for a in github.release["assets"]}
        github.writes.clear()
        retried = self.approved(github, GITHUB_RUN_ATTEMPT="2")
        publish.publish(github, retried, self.scratch)
        self.assertEqual(github.writes, [], "the retry only verifies")
        self.assertEqual({a["name"]: a["id"] for a in github.release["assets"]}, uploaded)
        self.assertEqual(github.refs[f"refs/tags/v{VERSION}"], COMMIT)

    def test_a_retry_before_publication_finishes_the_remaining_steps(self):
        github = FakeGitHub()
        approved = self.approved(github)
        unsigned = [a for a in github.release["assets"] if a["name"].endswith((".exe", ".dmg"))]
        github.respond("DELETE", f"releases/assets/{unsigned[0]['id']}", None, None)
        retried = self.approved(github, GITHUB_RUN_ATTEMPT="2")
        self.assertEqual(
            retried["OHTIA_RELEASE_BODY_SHA256"], approved["OHTIA_RELEASE_BODY_SHA256"]
        )
        publish.publish(github, retried, self.scratch)
        self.assertFalse(github.release["draft"])
        self.assertEqual(github.release["body"], NOTES)

    def test_a_dispatch_from_another_ref_or_with_an_invalid_version_is_refused(self):
        github = FakeGitHub()
        self.refused(github, "Dispatch publish-release from main", GITHUB_REF="refs/heads/x")
        self.refused(github, "final major.minor.patch", OHTIA_RELEASE_VERSION="v0.1.0")
        self.refused(github, "final major.minor.patch", OHTIA_RELEASE_VERSION="0.1.0-rc.1")

    def test_a_failure_after_publication_names_the_public_surfaces(self):
        github = FakeGitHub()
        approved = self.approved(github)
        original = github.respond

        def broken(method, path, payload, data):
            status, value = original(method, path, payload, data)
            if method == "GET" and path == "releases/9" and value["draft"] is False:
                value = {**value, "body": "changed"}
            return status, value

        github.respond = broken
        with self.assertRaisesRegex(
            prepare.ReleaseError, "Public now: the release 0.1.0 and the tag v0.1.0"
        ):
            publish.publish(github, approved, self.scratch)

    def test_an_existing_version_tag_is_refused_before_any_change(self):
        github = FakeGitHub()
        github.refs[f"refs/tags/v{VERSION}"] = "f" * 40
        self.refused(github, "tag v0.1.0 already exists")

    def test_a_reserved_commit_whose_workflow_files_differ_from_main_is_refused(self):
        github = FakeGitHub()
        github.main = "a" * 40
        for status in ("modified", "removed", "renamed"):
            github.compared_files = [{"filename": ".github/workflows/ci.yml", "status": status}]
            self.refused(github, "workflow files differ from main.*: .github/workflows/ci.yml")
        github.compared_files = [
            {"filename": ".github/workflows/publish-release.yml", "status": "added"},
            {"filename": "docs/index.md", "status": "modified"},
        ]
        publish.publish(github, self.approved(github), self.scratch)
        self.assertFalse(github.release["draft"])

    def test_a_digest_file_replaced_after_the_approval_is_refused(self):
        github = FakeGitHub()
        approved = self.approved(github)
        record = json.loads(digest_file())
        record["workflow"]["run_attempt"] = 2
        replaced = (json.dumps(record) + "\n").encode()
        digests = next(a for a in github.release["assets"] if a["name"] == prepare.DIGESTS)
        github.blobs[digests["id"]] = replaced
        digests["size"] = len(replaced)
        with self.assertRaisesRegex(prepare.ReleaseError, "digest file changed after the approval"):
            publish.publish(github, approved, self.scratch)
        self.assertEqual(github.writes, [])

    def test_a_testing_heading_changed_after_its_unsigned_packages_were_removed_is_refused(self):
        github = FakeGitHub()
        approved = self.approved(github)
        for asset in list(github.release["assets"]):
            if asset["name"].endswith((".exe", ".dmg")):
                github.respond("DELETE", f"releases/assets/{asset['id']}", None, None)
        github.release["body"] = github.release["body"].replace(
            prepare.UNSIGNED_HEADING, prepare.UNSIGNED_HEADING + " "
        )
        github.writes.clear()
        self.refused(
            github, "outside the prepared testing-only heading block", GITHUB_RUN_ATTEMPT="2"
        )
        with self.assertRaisesRegex(
            prepare.ReleaseError, "outside the prepared testing-only heading block"
        ):
            publish.publish(github, approved, self.scratch)

    def test_a_rewritten_testing_section_or_changed_last_line_is_refused(self):
        record = json.loads(digest_file())
        rewritten = prepared_body().replace(prepare.UNSIGNED_HEADING, "## Unsigned test packages")
        rewritten = rewritten.replace(prepare.UNSIGNED_STATEMENT, "The packages are unsigned.")
        with self.assertRaisesRegex(
            prepare.ReleaseError, "outside the prepared testing-only heading block"
        ):
            publish.final_body(rewritten, record)
        listed = NOTES + "\r\n\r\n- `ohtia-0.1.0-win32-x64-unsigned.exe`\r\n"
        with self.assertRaisesRegex(
            prepare.ReleaseError, "outside the prepared testing-only heading block"
        ):
            publish.final_body(listed, record)
        changed = prepared_body().replace("unsigned.dmg`\r\n", "unsigned.dmg` \t\r\n")
        with self.assertRaisesRegex(prepare.ReleaseError, "differs from the prepared one"):
            publish.final_body(changed, record)

    def test_a_heading_containing_unsigned_in_any_form_is_refused(self):
        record = json.loads(digest_file())
        for heading in (
            "### Unsigned test builds",
            "Unsigned test builds\r\n---",
            "Unsigned test builds\r\n====",
            "<h2>Unsigned test builds</h2>",
            "Unsigned test\r\nbuilds\r\n---",
            "> ## Unsigned test builds",
            "> Unsigned test builds\r\n> ---",
            "- ## Unsigned test builds",
            "Unsigned test builds\r\n- ",
            "Unsigned test builds\r\n-\t",
            "> Unsigned test builds\r\n> - ",
            "Unsigned test builds\r---",
            "Unsigned test builds\r\n* \r\n---",
            "Unsigned test builds\r\n+ \r\n===",
            "Unsigned test builds\r\n1. \r\n---",
        ):
            body = NOTES + "\r\n\r\n" + heading + "\r\n\r\nFor testing only.\r\n"
            with self.assertRaisesRegex(
                prepare.ReleaseError, 'heading containing the word "unsigned"'
            ):
                publish.final_body(body, record)
            with self.assertRaisesRegex(
                prepare.ReleaseError, "before the testing-only heading block"
            ):
                publish.final_body(body + "\r\n" + prepared_body().split(NOTES, 1)[1], record)

    def test_blank_lines_around_the_block_are_removed_with_it(self):
        record = json.loads(digest_file())
        self.assertEqual(publish.final_body(prepared_body() + " \t\r\n\r\n", record), NOTES)
        spaced = prepared_body().replace(NOTES + "\r\n\r\n", NOTES + "\r\n \r\n")
        self.assertEqual(publish.final_body(spaced, record), NOTES)

    def test_a_testing_heading_without_unsigned_packages_names_the_cause(self):
        record = json.loads(digest_file())
        signed = {
            **record,
            "assets": [a for a in record["assets"] if a["authentication"] != "unsigned"],
        }
        body = NOTES + "\r\n\r\n" + prepare.UNSIGNED_HEADING + "\r\n"
        with self.assertRaisesRegex(prepare.ReleaseError, "records no unsigned package"):
            publish.final_body(body, signed)

    def test_a_reserved_commit_outside_the_history_of_main_is_refused(self):
        github = FakeGitHub()
        github.main = "a" * 40
        original = github.respond

        def diverged(method, path, payload, data):
            status, value = original(method, path, payload, data)
            if path.startswith("compare/"):
                value = {**value, "status": "diverged", "behind_by": 1}
            return status, value

        github.respond = diverged
        self.refused(github, "not in the history of main")

    def test_notes_that_mention_unsigned_testing_packages_are_kept(self):
        record = json.loads(digest_file())
        note = "- Publish a release: Publication removes the unsigned testing packages. (#262)"
        body = prepared_body().replace("It opens. (#1)", "It opens. (#1)\r\n" + note)
        self.assertTrue(publish.final_body(body, record).endswith(note))

    def test_a_public_release_with_another_notes_digest_is_refused_on_retry(self):
        github = FakeGitHub()
        publish.publish(github, self.approved(github), self.scratch)
        notes = next(a for a in github.release["assets"] if a["name"] == publish.NOTES_DIGEST)
        github.blobs[notes["id"]] = f"{'0' * 64}\n".encode()
        github.writes.clear()
        self.refused(github, "does not record its body", GITHUB_RUN_ATTEMPT="2")

    def test_the_section_removal_keeps_the_notes_bytes_including_trailing_spaces(self):
        record = json.loads(digest_file())
        body = prepared_body().replace("It opens. (#1)", "It opens. (#1)  ")
        self.assertEqual(publish.final_body(body, record), NOTES + "  ")
        signed = {
            **record,
            "assets": [a for a in record["assets"] if a["authentication"] != "unsigned"],
        }
        self.assertEqual(publish.final_body(NOTES + "\r\n", signed), NOTES + "\r\n")

    def test_an_interrupted_notes_upload_is_replaced_on_retry(self):
        github = FakeGitHub()
        github.starter_upload = True
        approved = self.approved(github)
        with self.assertRaisesRegex(prepare.ReleaseError, "HTTP 502"):
            publish.publish(github, approved, self.scratch)
        self.assertTrue(github.release["draft"])
        retried = self.approved(github, GITHUB_RUN_ATTEMPT="2")
        publish.publish(github, retried, self.scratch)
        notes = [a for a in github.release["assets"] if a["name"] == publish.NOTES_DIGEST]
        self.assertEqual(len(notes), 1)
        self.assertEqual(github.blobs[notes[0]["id"]], f"{sha256(NOTES.encode())}\n".encode())

    def test_a_notes_digest_of_an_earlier_body_is_replaced_before_publication(self):
        github = FakeGitHub()
        github.add_asset(publish.NOTES_DIGEST, f"{'0' * 64}\n".encode())
        publish.publish(github, self.approved(github), self.scratch)
        notes = [a for a in github.release["assets"] if a["name"] == publish.NOTES_DIGEST]
        self.assertEqual(github.blobs[notes[0]["id"]], f"{sha256(NOTES.encode())}\n".encode())

    def test_a_retry_of_failed_jobs_reuses_the_first_approval_after_the_body_update(self):
        github = FakeGitHub()
        approved = self.approved(github)
        original = github.respond

        def fail_upload(method, path, payload, data):
            if method == "POST":
                return 500, None
            return original(method, path, payload, data)

        github.respond = fail_upload
        with self.assertRaisesRegex(prepare.ReleaseError, "HTTP 500"):
            publish.publish(github, approved, self.scratch)
        self.assertEqual(github.release["body"], NOTES)
        github.respond = original
        publish.publish(github, {**approved, "GITHUB_RUN_ATTEMPT": "2"}, self.scratch)
        self.assertFalse(github.release["draft"])

    def test_the_cli_reports_a_refusal_with_a_nonzero_exit(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            code = publish.main(["check"], env(GITHUB_TOKEN=""))
        self.assertEqual(code, 1)
        self.assertIn(
            "Release publication refused: The workflow token is missing.", stderr.getvalue()
        )


class WorkflowTests(unittest.TestCase):
    def test_the_workflow_runs_from_main_with_a_version_input_and_serialized_runs(self):
        self.assertIn("workflow_dispatch:\n    inputs:\n      version:", WORKFLOW)
        self.assertIn(
            "concurrency:\n  group: publish-release\n  cancel-in-progress: false", WORKFLOW
        )
        self.assertIn("permissions: {}", WORKFLOW)
        uses = [line.strip() for line in WORKFLOW.splitlines() if "${{ inputs." in line]
        self.assertEqual(
            uses,
            [
                "OHTIA_RELEASE_VERSION: ${{ inputs.version }}",
                "version: ${{ inputs.version }}",
                "OHTIA_RELEASE_VERSION: ${{ inputs.version }}",
            ],
        )

    def test_only_the_approved_job_publishes_and_it_follows_the_check(self):
        check, rest = WORKFLOW.split("\n  repository:\n")
        repository, publish_job = rest.split("\n  publish:\n")
        self.assertNotIn("environment:", check)
        self.assertIn("release_publish.py check", check)
        # The stable repositories are written after the first approval, before publication.
        self.assertIn("    needs: check\n", repository)
        self.assertIn("    environment: release-signing\n", repository)
        self.assertIn("digests-sha256: ${{ needs.check.outputs.digests }}", repository)
        self.assertIn("    needs: [check, repository]\n", publish_job)
        self.assertIn("environment: release-signing\n", publish_job)
        self.assertIn("release_publish.py publish", publish_job)
        self.assertNotIn("secrets.", check + publish_job)
        self.assertEqual(
            re.findall(r"\$\{\{ secrets\.([A-Z0-9_]+) \}\}", repository),
            ["SIGNING_SUBKEY", "SIGNING_PASSPHRASE", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
        )

    def test_the_workflow_contains_no_build_or_signing_step(self):
        for forbidden in (
            "release_build",
            "rpmsign",
            "gpg",
            "pnpm",
            "npm ",
            "setup-node",
            "attest",
        ):
            self.assertNotIn(forbidden, WORKFLOW)
        uses = re.findall(r"uses: ([^@\s]+)@([0-9a-f]{40})\n", WORKFLOW)
        self.assertEqual({name for name, _ in uses}, {"actions/checkout", "actions/setup-python"})
        # The only other action is the repository action, which signs indexes, never packages.
        self.assertEqual(WORKFLOW.count("uses: $/.github/actions/apt-repository\n"), 1)
        self.assertEqual(len(uses) + 1, WORKFLOW.count("uses:"))


if __name__ == "__main__":
    unittest.main()
