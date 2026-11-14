"""Exercise release selection, reservation, assembly and publication without network access."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import release_build  # noqa: E402
import release_platforms  # noqa: E402
import release_prepare as prepare  # noqa: E402

ROOT = release_platforms.ROOT
DISPATCH = "a" * 40
ANCESTOR = "b" * 40
WORKFLOW_TEXT = (ROOT / ".github/workflows/prepare-release.yml").read_text(encoding="utf-8")
# Structural assertions ignore the explanatory end-of-line comments.
WORKFLOW = re.sub(r"(?<=\S) # [^\n]*", "", WORKFLOW_TEXT)


def dispatch_env(**overrides) -> dict:
    return {
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_SHA": DISPATCH,
        "GITHUB_RUN_ID": "500",
        "GITHUB_RUN_ATTEMPT": "1",
        "OHTIA_RELEASE_HASH": "",
        **overrides,
    }


class FakeGitHub(prepare.GitHub):
    """Model the repository references, tag objects and releases the workflow touches."""

    def __init__(self):
        super().__init__("synthetic-token")
        self.compare = {"status": "ahead", "behind_by": 0, "merge_base_commit": {"sha": ANCESTOR}}
        self.refs: dict[str, str] = {}
        self.tags: dict[str, dict] = {}
        self.releases: list[dict] = []
        self.calls: list[tuple[str, str]] = []
        self.race = False
        self.upload_size_offset = 0

    def request(
        self, method, url, payload=None, *, data=None, headers=None, allowed=(200,), timeout=60
    ):
        path = url.split("ohtia/ohtia/", 1)[1]
        self.calls.append((method, path))
        status, value = self.respond(method, path, payload, data)
        prepare.require(status in allowed, f"HTTP {status}")
        return status, copy.deepcopy(value)

    def respond(self, method, path, payload, data):
        if method == "GET" and path.startswith("compare/"):
            return 200, self.compare
        if method == "GET" and path.startswith("git/ref/tags/"):
            name = "refs/tags/" + path.removeprefix("git/ref/tags/").replace("%2F", "/")
            if name not in self.refs:
                return 404, None
            return 200, {"object": {"type": "tag", "sha": self.refs[name]}}
        if method == "GET" and path.startswith("git/tags/"):
            return 200, self.tags[path.removeprefix("git/tags/")]
        if method == "POST" and path == "git/tags":
            sha = hashlib.sha1(json.dumps(payload).encode() + bytes(len(self.tags))).hexdigest()
            self.tags[sha] = {
                "message": payload["message"] + "\n",
                "object": {"sha": payload["object"], "type": "commit"},
            }
            return 201, {"sha": sha}
        if method == "POST" and path == "git/refs":
            if self.race or payload["ref"] in self.refs:
                return 422, None
            self.refs[payload["ref"]] = payload["sha"]
            return 201, {}
        if method == "GET" and path.startswith("releases?"):
            page = int(re.search(r"[?&]page=(\d+)", path)[1])
            return 200, self.releases[(page - 1) * 100 : page * 100]
        if method == "POST" and path == "releases":
            release = {
                "id": 9,
                "html_url": "https://github.com/ohtia/ohtia/releases/9",
                "assets": [],
                **payload,
            }
            self.releases.append(release)
            return 201, release
        if method == "POST" and path.startswith("releases/") and "/assets?" in path:
            name = path.split("name=", 1)[1]
            body = data.read()
            asset = {
                "name": name,
                "size": len(body) + self.upload_size_offset,
                "state": "uploaded",
                "digest": "sha256:" + hashlib.sha256(body).hexdigest(),
            }
            self.release(int(path.split("/")[1]))["assets"].append(asset)
            return 201, asset
        if method == "PATCH" and path.startswith("releases/"):
            release = self.release(int(path.split("/")[1]))
            if release["draft"] and "tag_name" not in payload:
                # Observed on GitHub: updating a draft without tag_name detaches its tag.
                release["tag_name"] = "untagged-0123456789abcdef0123"
            release.update(payload)
            return 200, release
        if method == "GET" and path.startswith("releases/"):
            return 200, self.release(int(path.split("/")[1]))
        raise AssertionError((method, path))

    def release(self, identifier):
        return next(item for item in self.releases if item["id"] == identifier)

    def writes(self):
        return [call for call in self.calls if call[0] != "GET"]


def git(directory: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", *args],
        cwd=directory,
        text=True,
    ).strip()


def source_checkout(directory: Path, version: str = "0.3.0", entry_points: bool = True) -> str:
    directory.mkdir()
    (directory / "package.json").write_text(json.dumps({"version": version}))
    if entry_points:
        for name in prepare.ENTRY_POINTS:
            (directory / name).parent.mkdir(parents=True, exist_ok=True)
            (directory / name).write_text((ROOT / name).read_text(encoding="utf-8"))
    git(directory, "init", "-q")
    git(directory, "add", "-A")
    git(directory, "commit", "-q", "-m", "synthetic")
    return git(directory, "rev-parse", "HEAD")


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.github = FakeGitHub()

    def test_empty_hash_selects_the_dispatch_commit_without_a_lookup(self):
        self.assertEqual(prepare.select(self.github, dispatch_env()), DISPATCH)
        self.assertEqual(self.github.calls, [])

    def test_ancestor_hash_is_admitted_through_the_comparison(self):
        selected = prepare.select(self.github, dispatch_env(OHTIA_RELEASE_HASH=ANCESTOR))
        self.assertEqual(selected, ANCESTOR)
        self.assertEqual(
            self.github.calls, [("GET", f"compare/{ANCESTOR}...{DISPATCH}?per_page=1")]
        )

    def test_refs_other_than_main_are_refused_before_any_lookup(self):
        for ref in ("refs/heads/feature", "refs/tags/v0.3.0", "refs/heads/main-copy"):
            with self.assertRaisesRegex(prepare.ReleaseError, "from main"):
                prepare.select(self.github, dispatch_env(GITHUB_REF=ref))
        for env in (
            dispatch_env(GITHUB_EVENT_NAME="push"),
            dispatch_env(GITHUB_REPOSITORY="someone/ohtia"),
        ):
            with self.assertRaises(prepare.ReleaseError):
                prepare.select(self.github, env)
        self.assertEqual(self.github.calls, [])

    def test_malformed_hashes_are_refused(self):
        for value in ("b" * 39, "B" * 40, "main", "b" * 40 + "\n", "v0.3.0"):
            with self.assertRaisesRegex(prepare.ReleaseError, "full lowercase"):
                prepare.select(self.github, dispatch_env(OHTIA_RELEASE_HASH=value))

    def test_commits_outside_the_main_history_are_refused(self):
        for compare in (
            {"status": "diverged", "behind_by": 2, "merge_base_commit": {"sha": "c" * 40}},
            {"status": "behind", "behind_by": 1, "merge_base_commit": {"sha": DISPATCH}},
            {"status": "ahead", "behind_by": 0, "merge_base_commit": {"sha": "c" * 40}},
            {"status": "identical", "behind_by": 0, "merge_base_commit": {"sha": ANCESTOR}},
        ):
            self.github.compare = compare
            with self.assertRaisesRegex(prepare.ReleaseError, "not in the history"):
                prepare.select(self.github, dispatch_env(OHTIA_RELEASE_HASH=ANCESTOR))


class ReservationTests(unittest.TestCase):
    def setUp(self):
        self.github = FakeGitHub()
        self.directory = tempfile.TemporaryDirectory()
        self.source = Path(self.directory.name) / "source"
        self.commit = source_checkout(self.source)

    def tearDown(self):
        self.directory.cleanup()

    def env(self, **overrides):
        return {**dispatch_env(OHTIA_RELEASE_COMMIT=self.commit), **overrides}

    def test_reservation_creates_an_annotated_tag_on_the_selected_commit(self):
        reserved = prepare.reserve(self.github, self.env(), self.source)
        self.assertEqual(reserved["version"], "0.3.0")
        self.assertEqual(reserved["commit"], self.commit)
        self.assertEqual(reserved["tree"], git(self.source, "rev-parse", "HEAD^{tree}"))
        tag = self.github.tags[self.github.refs["refs/tags/reserved/v0.3.0"]]
        self.assertEqual(tag["object"], {"sha": self.commit, "type": "commit"})
        self.assertIn("run 500", tag["message"])

    def test_an_existing_version_tag_is_refused_before_reserving(self):
        self.github.refs["refs/tags/v0.3.0"] = self.commit
        with self.assertRaisesRegex(prepare.ReleaseError, "version tag v0.3.0 already exists"):
            prepare.reserve(self.github, self.env(), self.source)
        self.assertEqual(self.github.writes(), [])

    def test_a_selected_commit_with_other_platforms_is_refused_before_reserving(self):
        declaration = json.loads((ROOT / release_platforms.DECLARATION).read_text())
        declaration["platforms"][2]["builds"][0]["packages"].pop()
        other = Path(self.directory.name) / "other"
        source_checkout(other)
        (other / release_platforms.DECLARATION).write_text(json.dumps(declaration))
        git(other, "commit", "-q", "-am", "other platforms")
        commit = git(other, "rev-parse", "HEAD")
        with self.assertRaisesRegex(prepare.ReleaseError, "other release platforms"):
            prepare.reserve(self.github, self.env(OHTIA_RELEASE_COMMIT=commit), other)
        self.assertEqual(self.github.calls, [])

    def test_an_existing_reservation_refuses_another_run(self):
        prepare.reserve(self.github, self.env(), self.source)
        writes = len(self.github.writes())
        for env in (
            self.env(GITHUB_RUN_ID="501"),
            self.env(GITHUB_RUN_ID="501", GITHUB_RUN_ATTEMPT="2"),
        ):
            with self.assertRaisesRegex(prepare.ReleaseError, "already reserved"):
                prepare.reserve(self.github, env, self.source)
        self.assertEqual(len(self.github.writes()), writes)

    def test_a_rerun_of_the_reserving_run_continues_on_the_same_commit(self):
        prepare.reserve(self.github, self.env(), self.source)
        writes = len(self.github.writes())
        reserved = prepare.reserve(self.github, self.env(GITHUB_RUN_ATTEMPT="2"), self.source)
        self.assertEqual(reserved["version"], "0.3.0")
        self.assertEqual(len(self.github.writes()), writes)

    def test_a_rerun_refuses_a_reservation_moved_to_another_commit(self):
        prepare.reserve(self.github, self.env(), self.source)
        tag = self.github.refs["refs/tags/reserved/v0.3.0"]
        self.github.tags[tag]["object"]["sha"] = "d" * 40
        with self.assertRaisesRegex(prepare.ReleaseError, "already reserved"):
            prepare.reserve(self.github, self.env(GITHUB_RUN_ATTEMPT="2"), self.source)

    def test_a_lightweight_reservation_is_never_adopted(self):
        self.github.refs["refs/tags/reserved/v0.3.0"] = self.commit
        original = self.github.respond

        def respond(method, path, payload, data):
            if path.startswith("git/ref/tags/reserved/"):
                return 200, {"object": {"type": "commit", "sha": self.commit}}
            return original(method, path, payload, data)

        with patch.object(self.github, "respond", side_effect=respond):
            with self.assertRaisesRegex(prepare.ReleaseError, "already reserved"):
                prepare.reserve(self.github, self.env(GITHUB_RUN_ATTEMPT="2"), self.source)

    def test_concurrent_runs_produce_exactly_one_reservation(self):
        # Both runs found no reservation; the reference creation decides the winner.
        prepare.reserve(self.github, self.env(), self.source)
        loser = FakeGitHub()
        loser.race = True
        with self.assertRaisesRegex(prepare.ReleaseError, "Another run reserved"):
            prepare.reserve(loser, self.env(GITHUB_RUN_ID="501"), self.source)
        self.assertEqual(list(self.github.refs), ["refs/tags/reserved/v0.3.0"])
        self.assertEqual(loser.refs, {})

    def test_a_different_checkout_or_missing_entry_point_is_refused_before_reserving(self):
        with self.assertRaisesRegex(prepare.ReleaseError, "differs from the selected"):
            prepare.reserve(self.github, self.env(OHTIA_RELEASE_COMMIT="e" * 40), self.source)
        old = Path(self.directory.name) / "old"
        commit = source_checkout(old, entry_points=False)
        with self.assertRaisesRegex(prepare.ReleaseError, "predates"):
            prepare.reserve(self.github, self.env(OHTIA_RELEASE_COMMIT=commit), old)
        self.assertEqual(self.github.calls, [])

    def test_an_invalid_root_version_is_refused_before_reserving(self):
        for index, version in enumerate(("0.3", "01.2.3", "0.3.0-rc.1")):
            source = Path(self.directory.name) / f"invalid-{index}"
            commit = source_checkout(source, version=version)
            with self.assertRaisesRegex(prepare.ReleaseError, "major.minor.patch"):
                prepare.reserve(self.github, self.env(OHTIA_RELEASE_COMMIT=commit), source)
        self.assertEqual(self.github.calls, [])


def build_inputs(directory: Path, version: str, commit: str, tree: str) -> Path:
    inputs = directory / "inputs"
    platforms = release_platforms.load()
    for platform in platforms:
        for build in platform["builds"]:
            folder = inputs / f"release-{build['target']}-500-1"
            folder.mkdir(parents=True)
            assets = []
            for package in build["packages"]:
                name = release_platforms.asset_name(
                    version, build["target"], package, platform["signed"]
                )
                content = f"synthetic {name}".encode()
                (folder / name).write_bytes(content)
                assets.append(
                    {
                        "name": name,
                        "profile": package.get("profile"),
                        "format": package["format"],
                        "bytes": len(content),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                )
            record = {
                "schema_version": 1,
                "version": version,
                "source": {"commit": commit, "tree": tree},
                "target": build["target"],
                "assets": assets,
            }
            (folder / "build.json").write_text(json.dumps(record))
    return inputs


NOTES = "<!-- Summary -->\n\n## Corrections\n\n- Task: Result. (#7)\n"


def notes_file(root):
    file = Path(root) / "notes.md"
    file.write_text(NOTES, encoding="utf-8")
    return file


class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.env = dispatch_env(
            OHTIA_RELEASE_COMMIT="c" * 40,
            OHTIA_RELEASE_TREE="d" * 40,
            OHTIA_RELEASE_VERSION="0.3.0",
        )
        self.inputs = build_inputs(self.root, "0.3.0", "c" * 40, "d" * 40)
        self.notes = notes_file(self.root)

    def tearDown(self):
        self.directory.cleanup()

    def test_complete_builds_produce_the_digest_file_and_testing_heading(self):
        record = prepare.assemble(self.env, self.inputs, self.notes, self.root / "release")
        names = [asset["name"] for asset in record["assets"]]
        self.assertEqual(len(names), 10)
        self.assertIn("ohtia-0.3.0-linux-x64-ubuntu-26.04-unsigned.deb", names)
        self.assertIn("ohtia-0.3.0-linux-arm64-fedora-44-unsigned.rpm", names)
        self.assertIn("ohtia-0.3.0-win32-arm64-unsigned.exe", names)
        self.assertIn("ohtia-0.3.0-darwin-arm64-unsigned.zip", names)
        self.assertTrue(
            all(
                "unsigned" in name and not asset["signed"]
                for name, asset in zip(names, record["assets"])
            )
        )
        written = json.loads((self.root / "release" / prepare.DIGESTS).read_text())
        self.assertEqual(written, record)
        self.assertEqual(record["source"], {"commit": "c" * 40, "tree": "d" * 40})
        self.assertEqual(record["workflow"]["path"], ".github/workflows/prepare-release.yml")
        for asset in record["assets"]:
            file = self.root / "release/assets" / asset["name"]
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), asset["sha256"])
            self.assertEqual(file.stat().st_size, asset["bytes"])
        body = (self.root / "release/body.md").read_text()
        self.assertTrue(body.startswith(NOTES + "\n" + prepare.UNSIGNED_HEADING + "\n"))
        self.assertNotIn("c" * 40, body)
        heading = body.index(prepare.UNSIGNED_HEADING + "\n\n" + prepare.UNSIGNED_STATEMENT)
        for name in names:
            self.assertGreater(body.index(f"- `{name}`"), heading)

    def test_a_missing_platform_build_fails_without_a_partial_release(self):
        for folder in self.inputs.glob("release-win32-x64-*"):
            for file in folder.iterdir():
                file.unlink()
            folder.rmdir()
        with self.assertRaisesRegex(prepare.ReleaseError, "Every declared target"):
            prepare.assemble(self.env, self.inputs, self.notes, self.root / "release")
        self.assertFalse((self.root / "release").exists())

    def test_missing_extra_or_altered_assets_are_refused(self):
        def change(mutate):
            inputs = build_inputs(
                Path(tempfile.mkdtemp(dir=self.root)), "0.3.0", "c" * 40, "d" * 40
            )
            record_file = next(inputs.glob("release-linux-x64-*/build.json"))
            record = json.loads(record_file.read_text())
            mutate(record_file.parent, record)
            record_file.write_text(json.dumps(record))
            return inputs

        def drop(folder, record):
            record["assets"].pop()

        def extra(folder, record):
            (folder / "ohtia-0.3.0-linux-x64-unsigned.deb").write_bytes(b"x")
            record["assets"].append(
                {
                    "name": "ohtia-0.3.0-linux-x64-unsigned.deb",
                    "profile": None,
                    "format": "deb",
                    "bytes": 1,
                    "sha256": hashlib.sha256(b"x").hexdigest(),
                }
            )

        def alter(folder, record):
            (folder / record["assets"][0]["name"]).write_bytes(b"altered")

        def other_source(folder, record):
            record["source"]["commit"] = "e" * 40

        def other_version(folder, record):
            record["version"] = "0.3.1"

        for mutate, message in (
            (drop, "differ from the declared"),
            (extra, "differ from the declared"),
            (alter, "does not match its build record"),
            (other_source, "reserved version and source"),
            (other_version, "reserved version and source"),
        ):
            with self.subTest(mutate.__name__):
                destination = self.root / f"release-{mutate.__name__}"
                with self.assertRaisesRegex(prepare.ReleaseError, message):
                    prepare.assemble(self.env, change(mutate), self.notes, destination)
                self.assertFalse(destination.exists())

    def test_a_signed_platform_carries_no_unsigned_marker_or_heading(self):
        declaration = json.loads((ROOT / release_platforms.DECLARATION).read_text())
        for platform in declaration["platforms"]:
            platform["signed"] = True
        root = self.root / "signed-root"
        (root / "config/release").mkdir(parents=True)
        (root / release_platforms.DECLARATION).write_text(json.dumps(declaration))
        with patch.object(release_platforms, "ROOT", root):
            inputs = build_inputs(self.root / "signed", "0.3.0", "c" * 40, "d" * 40)
        record = prepare.assemble(self.env, inputs, self.notes, self.root / "signed-release", root)
        self.assertFalse(any("unsigned" in asset["name"] for asset in record["assets"]))
        self.assertEqual((self.root / "signed-release/body.md").read_text(), NOTES)

    def test_the_body_may_reach_but_not_exceed_githubs_limit(self):
        expected = release_platforms.expected_assets(release_platforms.load(), "0.3.0")
        overhead = len(prepare.release_body({"assets": expected}, "x")) - 1
        for extra, accepted in ((0, True), (1, False)):
            with self.subTest(extra=extra):
                notes = self.root / f"limit-{extra}.md"
                notes.write_text("x" * (prepare.MAXIMUM_BODY_CHARACTERS - overhead + extra))
                destination = self.root / f"release-limit-{extra}"
                if accepted:
                    prepare.assemble(self.env, self.inputs, notes, destination)
                    body = (destination / "body.md").read_text()
                    self.assertEqual(len(body), prepare.MAXIMUM_BODY_CHARACTERS)
                else:
                    with self.assertRaisesRegex(prepare.ReleaseError, "exceeds GitHub's 125000"):
                        prepare.assemble(self.env, self.inputs, notes, destination)
                    self.assertFalse(destination.exists())

    def test_missing_or_oversized_notes_fail_without_a_release(self):
        for name, content in (("absent.md", None), ("large.md", "x" * (prepare.MAXIMUM_NOTES + 1))):
            with self.subTest(name):
                notes = self.root / name
                if content is not None:
                    notes.write_text(content)
                destination = self.root / f"release-{name}"
                with self.assertRaisesRegex(prepare.ReleaseError, "notes are missing or too large"):
                    prepare.assemble(self.env, self.inputs, notes, destination)
                self.assertFalse(destination.exists())


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.env = dispatch_env(
            OHTIA_RELEASE_COMMIT="c" * 40,
            OHTIA_RELEASE_TREE="d" * 40,
            OHTIA_RELEASE_VERSION="0.3.0",
        )
        inputs = build_inputs(self.root, "0.3.0", "c" * 40, "d" * 40)
        self.release = self.root / "release"
        self.record = prepare.assemble(self.env, inputs, notes_file(self.root), self.release)
        self.github = FakeGitHub()

    def tearDown(self):
        self.directory.cleanup()

    def uploads(self):
        return [
            path.split("name=", 1)[1] for method, path in self.github.calls if "/assets?" in path
        ]

    def test_publication_creates_one_draft_with_every_asset_then_the_digest_file(self):
        prepare.publish(self.github, self.env, self.release)
        release = self.github.releases[0]
        self.assertEqual(
            {key: release[key] for key in ("tag_name", "target_commitish", "name", "draft")},
            {"tag_name": "v0.3.0", "target_commitish": "c" * 40, "name": "0.3.0", "draft": True},
        )
        self.assertEqual(release["body"], (self.release / "body.md").read_text())
        expected = [asset["name"] for asset in self.record["assets"]] + [prepare.DIGESTS]
        self.assertEqual(self.uploads(), expected)
        digests = (self.release / prepare.DIGESTS).read_bytes()
        stored = next(asset for asset in release["assets"] if asset["name"] == prepare.DIGESTS)
        self.assertEqual(stored["digest"], "sha256:" + hashlib.sha256(digests).hexdigest())

    def test_a_rerun_reuses_an_empty_draft_and_never_replaces_assets(self):
        self.github.releases.append(
            {
                "id": 9,
                "tag_name": "v0.3.0",
                "target_commitish": "c" * 40,
                "draft": True,
                "assets": [],
            }
        )
        prepare.publish(self.github, self.env, self.release)
        self.assertNotIn(("POST", "releases"), self.github.calls)
        self.assertIn(("PATCH", "releases/9"), self.github.calls)
        release = self.github.releases[0]
        self.assertEqual(release["name"], "0.3.0")
        self.assertEqual(release["tag_name"], "v0.3.0")
        self.assertEqual(release["target_commitish"], "c" * 40)
        self.assertEqual(release["body"], (self.release / "body.md").read_text())
        self.github.calls.clear()
        with self.assertRaisesRegex(prepare.ReleaseError, "already holds assets"):
            prepare.publish(self.github, self.env, self.release)
        self.assertEqual(self.uploads(), [])

    def test_a_published_or_foreign_release_is_refused(self):
        for release in (
            {
                "id": 9,
                "tag_name": "v0.3.0",
                "target_commitish": "c" * 40,
                "draft": False,
                "assets": [],
            },
            {
                "id": 9,
                "tag_name": "v0.3.0",
                "target_commitish": "e" * 40,
                "draft": True,
                "assets": [],
            },
        ):
            self.github.releases = [release]
            self.github.calls.clear()
            with self.assertRaisesRegex(prepare.ReleaseError, "outside this preparation"):
                prepare.publish(self.github, self.env, self.release)
            self.assertEqual(self.github.writes(), [])

    def test_an_existing_version_tag_stops_publication_before_any_write(self):
        self.github.refs["refs/tags/v0.3.0"] = "c" * 40
        with self.assertRaisesRegex(prepare.ReleaseError, "version tag v0.3.0 already exists"):
            prepare.publish(self.github, self.env, self.release)
        self.assertEqual(self.github.writes(), [])

    def test_a_release_body_changed_during_upload_fails_the_readback(self):
        original = self.github.respond

        def respond(method, path, payload, data):
            status, value = original(method, path, payload, data)
            if method == "POST" and path == "releases":
                value["body"] = "edited"
            return status, value

        with patch.object(self.github, "respond", side_effect=respond):
            with self.assertRaisesRegex(prepare.ReleaseError, "no longer the unpublished"):
                prepare.publish(self.github, self.env, self.release)

    def test_the_readback_tolerates_only_the_stored_line_endings_of_the_body(self):
        original = self.github.respond

        def respond(method, path, payload, data):
            status, value = original(method, path, payload, data)
            if method == "POST" and path == "releases":
                value["body"] = value["body"].replace("\n", "\r\n").rstrip()
            return status, value

        with patch.object(self.github, "respond", side_effect=respond):
            prepare.publish(self.github, self.env, self.release)
        self.assertFalse(prepare.same_text(None, "body"))
        self.assertFalse(prepare.same_text("other\n", "body\n"))

    def test_an_upload_recorded_with_another_length_stops_publication(self):
        self.github.upload_size_offset = 1
        with self.assertRaisesRegex(prepare.ReleaseError, "different length or digest"):
            prepare.publish(self.github, self.env, self.release)
        self.assertEqual(len(self.uploads()), 1)

    def test_a_reservation_mismatch_is_refused_before_any_write(self):
        with self.assertRaisesRegex(prepare.ReleaseError, "differs from the reservation"):
            prepare.publish(
                self.github, {**self.env, "OHTIA_RELEASE_VERSION": "0.3.1"}, self.release
            )
        self.assertEqual(self.github.calls, [])

    def test_releases_are_searched_across_pages(self):
        self.github.releases = [
            {"id": index, "tag_name": f"v0.0.{index}", "draft": False, "assets": []}
            for index in range(10, 160)
        ]
        prepare.publish(self.github, self.env, self.release)
        self.assertIn(("GET", "releases?per_page=100&page=2"), self.github.calls)


class TransportTests(unittest.TestCase):
    def response(self, status, body):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.close()

        value = Response(body)
        value.status = status
        return value

    def test_http_errors_and_oversized_responses_fail_without_echoing_bodies(self):
        def failing(request, data=None, timeout=None):
            raise urllib.error.HTTPError(request.full_url, 422, "secret body", {}, io.BytesIO(b"x"))

        with self.assertRaisesRegex(prepare.ReleaseError, r"returned HTTP 422\.$"):
            prepare.GitHub("token", failing).api("POST", "git/refs", {})
        status, _ = prepare.GitHub("token", failing).api("POST", "git/refs", {}, allowed=(422,))
        self.assertEqual(status, 422)
        large = self.response(200, b" " * (prepare.MAXIMUM_RESPONSE + 1))
        with self.assertRaisesRegex(prepare.ReleaseError, "oversized"):
            prepare.GitHub("token", lambda *a, **k: large).api("GET", "releases")

    def test_uploaded_files_are_sent_with_their_length_not_chunked(self):
        sent = []
        handler = urllib.request.HTTPSHandler()
        handler.parent = urllib.request.build_opener()

        def opener(request, data=None, timeout=None):
            if data is not None:  # What OpenerDirector.open does with a late body.
                request.data = data
            prepared = handler.do_request_(request)
            sent.append({key.lower(): value for key, value in prepared.header_items()})
            return self.response(201, b"{}")

        stream = io.BytesIO(b"12345")
        prepare.GitHub("token", opener).request(
            "POST",
            f"{prepare.UPLOADS}/repos/ohtia/ohtia/releases/1/assets?name=a",
            data=stream,
            headers={"Content-Type": "application/octet-stream", "Content-Length": "5"},
            allowed=(201,),
        )
        self.assertEqual(sent[0].get("content-length"), "5")
        self.assertNotIn("transfer-encoding", sent[0])
        prepare.GitHub("token", opener).api("POST", "git/refs", {"ref": "x"}, allowed=(201,))
        self.assertEqual(sent[1]["content-length"], str(len(b'{"ref": "x"}')))
        self.assertEqual(sent[1]["content-type"], "application/json")

    def test_errors_name_only_githubs_sanitized_message(self):
        def answer(body):
            def failing(request, data=None, timeout=None):
                raise urllib.error.HTTPError(request.full_url, 400, "x", {}, io.BytesIO(body))

            return failing

        cases = [
            (b'{"message":"Bad Content-Length","request_id":"r"}', " (Bad Content-Length)"),
            (b'{"message":"bad\\u001b[31m\\u00e9","token":"secret"}', " (bad[31m)"),
            (json.dumps({"message": "m" * 300}).encode(), f" ({'m' * 200})"),
            (b'{"message":7}', ""),
            (b"not json", ""),
            (b"", ""),
            (b"[" * 4096, ""),
            (b'{"message":"' + b"m" * 4096 + b'"}', ""),
        ]
        for body, suffix in cases:
            with self.subTest(body=body[:40]):
                with self.assertRaises(prepare.ReleaseError) as caught:
                    prepare.GitHub("token", answer(body)).api("POST", "releases", {})
                self.assertEqual(
                    str(caught.exception),
                    f"GitHub POST /repos/ohtia/ohtia/releases returned HTTP 400{suffix}.",
                )
                self.assertNotIn("secret", str(caught.exception))

    def test_requests_carry_the_token_only_to_github(self):
        seen = []

        def opener(request, data=None, timeout=None):
            seen.append((request.full_url, request.get_header("Authorization"), timeout))
            return self.response(200, b"[]")

        prepare.GitHub("token", opener).api("GET", "releases?per_page=100&page=1")
        self.assertEqual(
            seen,
            [
                (
                    "https://api.github.com/repos/ohtia/ohtia/releases?per_page=100&page=1",
                    "Bearer token",
                    60,
                )
            ],
        )
        with self.assertRaises(prepare.ReleaseError):
            prepare.GitHub("", opener)

    def test_cli_reports_refusals_with_a_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dispatch_env(
                GITHUB_REF="refs/heads/feature",
                GITHUB_TOKEN="token",
                GITHUB_OUTPUT=str(Path(directory) / "output"),
            )
            with redirect_stderr(io.StringIO()) as error:
                self.assertEqual(prepare.main(["select"], env), 1)
            self.assertIn("from main", error.getvalue())
            self.assertFalse((Path(directory) / "output").exists())
            env["GITHUB_REF"] = "refs/heads/main"
            self.assertEqual(prepare.main(["select"], env), 0)
            self.assertEqual((Path(directory) / "output").read_text(), f"commit={DISPATCH}\n")


def job_blocks(text: str) -> dict[str, str]:
    jobs = text.split("\njobs:\n", 1)[1]
    names = re.findall(r"^  ([a-z][a-z0-9-]*):\n", jobs, re.MULTILINE)
    parts = re.split(r"^  [a-z][a-z0-9-]*:\n", jobs, flags=re.MULTILINE)[1:]
    return dict(zip(names, parts))


class WorkflowTests(unittest.TestCase):
    def test_the_workflow_is_manual_with_only_the_hash_input_and_no_default_permissions(self):
        head = WORKFLOW.split("\njobs:\n", 1)[0]
        self.assertIn("on:\n  workflow_dispatch:\n    inputs:\n      hash:\n", head)
        self.assertEqual(re.findall(r"^      ([a-z-]+):\n", head, re.MULTILINE), ["hash"])
        self.assertIn("\npermissions: {}\n", head)
        self.assertNotIn("concurrency", WORKFLOW)
        self.assertNotIn("secrets.", WORKFLOW)
        self.assertNotIn("environment:", WORKFLOW)
        self.assertNotIn(
            "${{ inputs.", WORKFLOW.replace("OHTIA_RELEASE_HASH: ${{ inputs.hash }}", "")
        )

    def test_each_platform_builds_in_its_own_read_only_job_from_the_declaration(self):
        jobs = job_blocks(WORKFLOW)
        self.assertEqual(list(jobs), ["reserve", "notes", "linux", "windows", "macos", "release"])
        for platform in release_platforms.load():
            block = jobs[platform["id"]]
            self.assertIn("    needs: reserve\n", block)
            self.assertEqual(
                re.findall(r"^    permissions:\n((?:      .+\n)+)", block, re.MULTILINE),
                ["      contents: read\n"],
            )
            matrix = re.findall(
                r"^          - target: ([a-z0-9-]+)\n            runner: ([a-z0-9.-]+)\n",
                block,
                re.MULTILINE,
            )
            self.assertEqual(matrix, [(b["target"], b["runner"]) for b in platform["builds"]])
            self.assertIn("ref: ${{ needs.reserve.outputs.commit }}", block)
            self.assertIn("scripts/release_build.py", block)
            self.assertNotIn("token", block)

    def test_only_the_reservation_and_release_jobs_can_write(self):
        jobs = job_blocks(WORKFLOW)
        self.assertIn("    permissions:\n      contents: write\n    outputs:", jobs["reserve"])
        self.assertIn(
            "    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n    steps:",
            jobs["release"],
        )
        # The release waits for the notes and every platform; a failed job skips it.
        self.assertIn("    needs: [reserve, notes, linux, windows, macos]\n", jobs["release"])
        self.assertNotIn("if:", jobs["release"])
        self.assertLess(
            jobs["release"].index("actions/attest@"),
            jobs["release"].index("release_prepare.py publish"),
        )
        for name in ("reserve", "notes", "release"):
            self.assertNotIn("workspace.py", jobs[name])
            self.assertNotIn("release_build.py", jobs[name])

    def test_pull_request_notes_are_read_in_a_read_only_job(self):
        block = job_blocks(WORKFLOW)["notes"]
        self.assertIn("    needs: reserve\n", block)
        self.assertEqual(
            re.findall(r"^    permissions:\n((?:      .+\n)+)", block, re.MULTILINE),
            ["      contents: read\n      pull-requests: read\n"],
        )
        self.assertIn("ref: ${{ needs.reserve.outputs.commit }}", block)
        self.assertIn("fetch-depth: 0", block)
        self.assertIn("python3 workflow/scripts/release_notes.py source", block)
        self.assertIn("name: notes-${{ github.run_id }}-${{ github.run_attempt }}", block)
        release = job_blocks(WORKFLOW)["release"]
        self.assertIn("name: notes-${{ github.run_id }}-${{ github.run_attempt }}", release)
        self.assertIn("assemble artifacts/release-inputs artifacts/release-notes/notes.md", release)
        self.assertNotIn("pulls", release)

    def test_actions_are_pinned_by_full_commit_sha(self):
        uses = re.findall(r"uses: (\S+)", WORKFLOW)
        self.assertTrue(uses)
        for action in uses:
            self.assertRegex(action, r"^actions/[a-z-]+@[0-9a-f]{40}$")
        self.assertEqual(
            WORKFLOW.count("persist-credentials: false"), WORKFLOW.count("actions/checkout@")
        )


class DeclarationTests(unittest.TestCase):
    def test_the_declaration_names_ten_unsigned_packages(self):
        names = [
            a["name"] for a in release_platforms.expected_assets(release_platforms.load(), "0.3.0")
        ]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(
            names,
            [
                "ohtia-0.3.0-linux-x64-ubuntu-26.04-unsigned.deb",
                "ohtia-0.3.0-linux-x64-debian-13-unsigned.deb",
                "ohtia-0.3.0-linux-x64-fedora-44-unsigned.rpm",
                "ohtia-0.3.0-linux-arm64-ubuntu-26.04-unsigned.deb",
                "ohtia-0.3.0-linux-arm64-debian-13-unsigned.deb",
                "ohtia-0.3.0-linux-arm64-fedora-44-unsigned.rpm",
                "ohtia-0.3.0-win32-x64-unsigned.exe",
                "ohtia-0.3.0-win32-arm64-unsigned.exe",
                "ohtia-0.3.0-darwin-arm64-unsigned.dmg",
                "ohtia-0.3.0-darwin-arm64-unsigned.zip",
            ],
        )

    def test_invalid_declarations_are_refused(self):
        original = json.loads((ROOT / release_platforms.DECLARATION).read_text())

        def mutate(change):
            value = copy.deepcopy(original)
            change(value)
            return value

        cases = [
            lambda v: v["platforms"].pop(),
            lambda v: v["platforms"].reverse(),
            lambda v: v["platforms"][0].update(signed="no"),
            lambda v: v["platforms"][0]["builds"][0].update(target="win32-x64"),
            lambda v: v["platforms"][0]["builds"][1].update(target="linux-x64"),
            lambda v: v["platforms"][0]["builds"][0]["packages"][2].update(format="deb"),
            lambda v: v["platforms"][0]["builds"][0]["packages"].append(
                {"profile": "ubuntu-26.04", "format": "deb"}
            ),
            lambda v: v["platforms"][1]["builds"][0]["packages"][0].update(profile="windows"),
            lambda v: v["platforms"][2]["builds"][0].update(runner="macos 26; echo"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config/release").mkdir(parents=True)
            for index, change in enumerate(cases):
                with self.subTest(index):
                    (root / release_platforms.DECLARATION).write_text(json.dumps(mutate(change)))
                    with self.assertRaises(release_platforms.PlatformError):
                        release_platforms.load(root)


class BuildTests(unittest.TestCase):
    def test_a_target_build_names_its_packages_and_records_their_digests(self):
        constructed = []

        def construct(cell, work, version):
            constructed.append((cell, version))
            packages = work / "packages"
            packages.mkdir(parents=True)
            for kind in cell["formats"]:
                extension = release_platforms.EXTENSIONS[kind]
                (packages / f"ohtia-{version}-{cell['target']}.{extension}").write_bytes(
                    f"{cell['profile']} {kind}".encode()
                )
            return packages

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            with (
                patch.object(release_build, "ROOT", root),
                patch.object(release_build.workspace, "target_id", return_value="linux-arm64"),
                patch.object(
                    release_build.application_version, "root_version", return_value="0.3.0"
                ),
                patch.object(
                    release_build.quality_native, "construct_package", side_effect=construct
                ),
                patch.object(
                    release_build,
                    "git",
                    side_effect=lambda *a: "" if a[0] == "status" else "f" * 40,
                ),
            ):
                (root / "artifacts").mkdir()
                record = release_build.build("linux-arm64", output)
        self.assertEqual(
            [(cell["profile"], cell["formats"]) for cell, _ in constructed],
            [("ubuntu-26.04", ["deb"]), ("debian-13", ["deb"]), ("fedora-44", ["rpm"])],
        )
        self.assertEqual({version for _, version in constructed}, {"0.3.0"})
        self.assertEqual(record["source"], {"commit": "f" * 40, "tree": "f" * 40})
        self.assertEqual(
            [asset["name"] for asset in record["assets"]],
            [
                "ohtia-0.3.0-linux-arm64-ubuntu-26.04-unsigned.deb",
                "ohtia-0.3.0-linux-arm64-debian-13-unsigned.deb",
                "ohtia-0.3.0-linux-arm64-fedora-44-unsigned.rpm",
            ],
        )

    def test_a_runner_for_another_target_is_refused_before_building(self):
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(release_build.workspace, "target_id", return_value="linux-x64"),
                patch.object(release_build.quality_native, "construct_package") as construct,
            ):
                with self.assertRaisesRegex(release_platforms.PlatformError, "runner"):
                    release_build.build("win32-x64", Path(directory) / "output")
            construct.assert_not_called()


if __name__ == "__main__":
    unittest.main()
