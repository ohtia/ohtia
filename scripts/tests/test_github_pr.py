"""Reject unrelated, stale and incomplete CI evidence without executing candidate code."""

from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("github_pr", ROOT / "scripts/github_pr.py")
pr_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pr_check)
POLICY_SPEC = importlib.util.spec_from_file_location(
    "github_policy", ROOT / "scripts/github_policy.py"
)
policy_module = importlib.util.module_from_spec(POLICY_SPEC)
POLICY_SPEC.loader.exec_module(policy_module)
POLICY = pr_check.load_policy(
    ROOT / "config/github/ci-verification.json", policy_module.unique_object
)
BASE, HEAD, TREE, MERGE = (letter * 40 for letter in "abcd")
WORKFLOW = (ROOT / ".github/workflows/ci.yml").read_bytes()
BLOB = hashlib.sha1(b"blob " + str(len(WORKFLOW)).encode() + b"\0" + WORKFLOW).hexdigest()


class FakeGitHub:
    def __init__(self):
        self.calls = []
        self.on_read = None
        self.pr = {
            "number": 5,
            "state": "open",
            "merged": False,
            "draft": False,
            "mergeable": True,
            "merge_commit_sha": MERGE,
            "base": {"repo": {"id": 42, "full_name": "ohtia/ohtia"}, "ref": "main", "sha": BASE},
            "head": {"repo": {"id": 43, "full_name": "contributor/ohtia"}, "sha": HEAD},
        }
        self.run = {
            "id": 100,
            "run_attempt": 1,
            "workflow_id": 17,
            "path": POLICY["workflow_path"],
            "event": "pull_request",
            "head_sha": HEAD,
            "repository": {"id": 42},
            "head_repository": {"id": 43},
            "status": "completed",
            "conclusion": "success",
            "check_suite_id": 200,
            "pull_requests": [],  # GitHub can omit this even for a real PR run.
        }
        self.jobs = [
            {
                "id": 300,
                "name": "ci",
                "run_id": 100,
                "run_attempt": 1,
                "head_sha": HEAD,
                "status": "completed",
                "conclusion": "success",
                "check_run_url": "https://api.github.com/repos/ohtia/ohtia/check-runs/400",
                "steps": [
                    {"name": name, "status": "completed", "conclusion": "success"}
                    for name in POLICY["jobs"]["ci"]["steps"]
                ],
            }
        ]
        self.check = {
            "id": 400,
            "name": "ci",
            "head_sha": HEAD,
            "app": {"id": 15368, "slug": "github-actions"},
            "check_suite": {"id": 200},
            "status": "completed",
            "conclusion": "success",
        }
        self.recent = [{"id": 100}]
        self.receipt = {
            "schema_version": 1,
            "repository": "ohtia/ohtia",
            "event": "pull_request",
            "ref": "refs/pull/5/merge",
            "run_id": 100,
            "run_attempt": 1,
            "pull_request": 5,
            "head_sha": HEAD,
            "base_sha": BASE,
            "github_sha": MERGE,
            "checkout_sha": MERGE,
            "tree_sha": TREE,
        }
        repo = pr_check.REPO
        self.responses = {
            repo: {
                "id": 42,
                "full_name": "ohtia/ohtia",
                "visibility": "public",
                "default_branch": "main",
            },
            f"{repo}/pulls/5": self.pr,
            f"{repo}/git/ref/heads/main": {"object": {"sha": BASE}},
            f"{repo}/compare/{BASE}...{HEAD}": {"behind_by": 0, "merge_base_commit": {"sha": BASE}},
            f"{repo}/git/commits/{HEAD}": {"sha": HEAD, "tree": {"sha": TREE}},
            f"{repo}/git/commits/{MERGE}": {
                "sha": MERGE,
                "tree": {"sha": TREE},
                "parents": [{"sha": BASE}, {"sha": HEAD}],
            },
            f"{repo}/contents/.github/workflows/ci.yml?ref={MERGE}": {
                "type": "file",
                "encoding": "base64",
                "sha": BLOB,
                "content": base64.b64encode(WORKFLOW).decode(),
            },
            f"{repo}/actions/workflows/ci.yml": {
                "id": 17,
                "state": "active",
                "path": POLICY["workflow_path"],
            },
            f"{repo}/actions/runs/100": self.run,
            "apps/github-actions": {"id": 15368, "slug": "github-actions"},
            f"{repo}/check-runs/400": self.check,
        }

    def get(self, endpoint):
        self.calls.append(endpoint)
        if self.on_read:
            self.on_read(endpoint)
        if "/actions/workflows/17/runs?" in endpoint:
            return {"total_count": len(self.recent), "workflow_runs": copy.deepcopy(self.recent)}
        if endpoint == f"{pr_check.REPO}/actions/runs/100/attempts/1/jobs?per_page=100&page=1":
            return {"total_count": len(self.jobs), "jobs": copy.deepcopy(self.jobs)}
        return copy.deepcopy(self.responses[endpoint])

    def log(self, job_id):
        assert job_id == 300
        return "2000-01-01T00:00:00.000Z " + pr_check.MARKER + json.dumps(self.receipt) + "\n"


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.github = FakeGitHub()

    def verify(self, **overrides):
        options = {
            "number": 5,
            "run_id": 100,
            "head": HEAD,
            "base": BASE,
            "tree": TREE,
            "workflow_bytes": WORKFLOW,
            "log_reader": self.github.log,
            "unique_object": policy_module.unique_object,
        }
        options.update(overrides)
        return pr_check.verify(self.github, POLICY, **options)

    def test_real_merge_identity_and_empty_pr_list_can_pass(self):
        result = self.verify()
        self.assertEqual(result["result"], "verified")
        self.assertEqual(result["tested_sha"], MERGE)
        self.assertEqual(result["head_sha"], HEAD)
        self.assertNotEqual(result["tested_sha"], result["head_sha"])
        self.assertTrue(
            all("{owner}/{repo}" in c or c == "apps/github-actions" for c in self.github.calls)
        )

    def test_wrong_workflow_event_head_and_run_identity_fail(self):
        mutations = [
            ("workflow_id", 99),
            ("path", ".github/workflows/fake.yml"),
            ("event", "push"),
            ("head_sha", BASE),
            ("id", 99),
            ("run_attempt", True),
            ("conclusion", "cancelled"),
            ("status", "in_progress"),
        ]
        for field, value in mutations:
            with self.subTest(field=field):
                old = self.github.run[field]
                self.github.run[field] = value
                with self.assertRaises(pr_check.VerificationError):
                    self.verify()
                self.github.run[field] = old

    def test_run_from_another_repository_or_fork_fails(self):
        for field in ("repository", "head_repository"):
            with self.subTest(field=field):
                old = self.github.run[field]
                self.github.run[field] = {"id": 999}
                with self.assertRaises(pr_check.VerificationError):
                    self.verify()
                self.github.run[field] = old

    def test_wrong_app_or_suite_cannot_supply_same_named_check(self):
        for field, value in (
            ("app", {"id": 99, "slug": "github-actions"}),
            ("check_suite", {"id": 999}),
            ("head_sha", BASE),
            ("conclusion", "skipped"),
        ):
            with self.subTest(field=field):
                old = self.github.check[field]
                self.github.check[field] = value
                with self.assertRaises(pr_check.VerificationError):
                    self.verify()
                self.github.check[field] = old

    def test_closed_draft_unknown_mergeability_and_wrong_target_fail(self):
        for field, value in (
            ("state", "closed"),
            ("draft", True),
            ("merged", True),
            ("mergeable", None),
        ):
            with self.subTest(field=field):
                old = self.github.pr[field]
                self.github.pr[field] = value
                with self.assertRaises(pr_check.VerificationError):
                    self.verify()
                self.github.pr[field] = old
        self.github.pr["base"]["ref"] = "other"
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_candidate_tree_base_and_merge_parents_are_bound(self):
        with self.assertRaises(pr_check.VerificationError):
            self.verify(tree=BASE)
        with self.assertRaises(pr_check.VerificationError):
            self.verify(base=HEAD)
        commit = self.github.responses[f"{pr_check.REPO}/git/commits/{MERGE}"]
        commit["parents"].reverse()
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_behind_candidate_is_rejected(self):
        self.github.responses[f"{pr_check.REPO}/compare/{BASE}...{HEAD}"]["behind_by"] = 1
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_pr_cannot_replace_reviewed_workflow_bytes(self):
        content = self.github.responses[
            f"{pr_check.REPO}/contents/.github/workflows/ci.yml?ref={MERGE}"
        ]
        content["content"] = base64.b64encode(b"name: fake\n").decode()
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_required_steps_cannot_be_skipped_cancelled_or_removed(self):
        original = copy.deepcopy(self.github.jobs[0]["steps"])
        for conclusion in ("skipped", "cancelled", "failure", None):
            with self.subTest(conclusion=conclusion):
                self.github.jobs[0]["steps"][3]["conclusion"] = conclusion
                with self.assertRaises(pr_check.VerificationError):
                    self.verify()
        self.github.jobs[0]["steps"] = original[1:]
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_missing_extra_and_duplicate_jobs_or_steps_fail(self):
        original = copy.deepcopy(self.github.jobs)
        for jobs in ([], original * 2, [{**original[0], "name": "other"}]):
            self.github.jobs = jobs
            with self.assertRaises(pr_check.VerificationError):
                self.verify()
        self.github.jobs = original
        step = original[0]["steps"][0]
        self.github.jobs[0]["steps"].append(copy.deepcopy(step))
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_optional_skipped_cleanup_is_explicitly_allowed(self):
        self.github.jobs[0]["steps"].append(
            {"name": "Post Set up Python", "status": "completed", "conclusion": "skipped"}
        )
        self.assertEqual(self.verify()["result"], "verified")
        self.github.jobs[0]["steps"][-1]["conclusion"] = "failure"
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_receipt_cannot_claim_another_checkout_or_pr(self):
        for field, value in (
            ("checkout_sha", HEAD),
            ("tree_sha", BASE),
            ("pull_request", 6),
            ("ref", "refs/heads/main"),
            ("base_sha", HEAD),
            ("run_attempt", 2),
            ("schema_version", True),
        ):
            with self.subTest(field=field):
                old = self.github.receipt[field]
                self.github.receipt[field] = value
                with self.assertRaises(pr_check.VerificationError):
                    self.verify()
                self.github.receipt[field] = old

    def test_missing_and_duplicate_receipts_cannot_pass(self):
        with self.assertRaises(pr_check.VerificationError):
            self.verify(log_reader=lambda _: "")
        line = self.github.log(300)
        with self.assertRaises(pr_check.VerificationError):
            self.verify(log_reader=lambda _: line + line)

    def test_log_read_failure_does_not_become_success(self):
        def missing(_):
            raise pr_check.VerificationError("unavailable")

        with self.assertRaises(pr_check.VerificationError):
            self.verify(log_reader=missing)

    def test_newer_runs_including_pending_ones_supersede_old_success(self):
        self.github.recent.append({"id": 101})
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_head_and_run_changes_during_verification_fail(self):
        def changed_head(endpoint):
            if endpoint.endswith("/pulls/5") and self.github.calls.count(endpoint) > 1:
                self.github.pr["head"]["sha"] = BASE

        self.github.on_read = changed_head
        with self.assertRaises(pr_check.VerificationError):
            self.verify()
        self.github = FakeGitHub()

        def changed_attempt(endpoint):
            if endpoint.endswith("/actions/runs/100") and self.github.calls.count(endpoint) > 1:
                self.github.run["run_attempt"] = 2

        self.github.on_read = changed_attempt
        with self.assertRaises(pr_check.VerificationError):
            self.verify()

    def test_invalid_hash_never_reaches_api(self):
        with self.assertRaises(pr_check.VerificationError):
            self.verify(head="main; arbitrary")
        self.assertEqual(self.github.calls, [])

    def test_complete_envelope_pagination_and_missing_partition(self):
        github = type("Pages", (), {})()
        pages = [
            {"total_count": 101, "jobs": [{"id": i + 1} for i in range(100)]},
            {"total_count": 101, "jobs": [{"id": 101}]},
        ]
        with patch.object(github, "get", side_effect=pages, create=True):
            self.assertEqual(len(pr_check.object_list(github, "jobs", "jobs")), 101)
        with patch.object(
            github, "get", return_value={"total_count": 2, "jobs": [{"id": 1}]}, create=True
        ):
            with self.assertRaises(pr_check.VerificationError):
                pr_check.object_list(github, "jobs", "jobs")


class TrustAndTransportTests(unittest.TestCase):
    def test_trusted_files_are_bound_to_exact_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

            def command(*args):
                return subprocess.check_output(
                    ["git", "-c", "core.hooksPath=/dev/null", *args], cwd=root, env=env
                )

            command("init", "--quiet")
            for name in pr_check.TRUSTED_FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic\n")
            command("add", ".")
            command(
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "-m",
                "Synthetic fixture",
            )
            revision = command("rev-parse", "HEAD").decode().strip()
            self.assertEqual(pr_check.trusted_state(revision, root)["revision"], revision)
            (root / pr_check.TRUSTED_FILES[0]).write_text("changed\n")
            with self.assertRaises(pr_check.VerificationError):
                pr_check.trusted_state(revision, root)

    def test_actual_workflow_receipt_reports_git_checkout_not_just_event_sha(self):
        step = WORKFLOW.decode().split("      - name: Record tested revision\n", 1)[1]
        step = step.split("      - name: Set up Python\n", 1)[0]
        invocation, body = step.split("<<'PYTHON'\n", 1)
        invocation = shlex.split(invocation.rsplit("run: |", 1)[1].strip())
        self.assertEqual(invocation[0], "python3")
        source = textwrap.dedent(body.rsplit("          PYTHON", 1)[0])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

            def command(*args):
                return subprocess.check_output(
                    ["git", "-c", "core.hooksPath=/dev/null", *args], cwd=root, env=env
                )

            command("init", "--quiet")
            (root / "file").write_text("synthetic\n")
            command("add", "file")
            command(
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "-m",
                "Synthetic fixture",
            )
            actual = command("rev-parse", "HEAD").decode().strip()
            tree = command("rev-parse", "HEAD^{tree}").decode().strip()
            event = root / "event.json"
            event.write_text(
                json.dumps(
                    {"number": 5, "pull_request": {"head": {"sha": HEAD}, "base": {"sha": BASE}}}
                )
            )
            env.update(
                GITHUB_EVENT_PATH=str(event),
                GITHUB_REPOSITORY="ohtia/ohtia",
                GITHUB_EVENT_NAME="pull_request",
                GITHUB_REF="refs/pull/5/merge",
                GITHUB_RUN_ID="100",
                GITHUB_RUN_ATTEMPT="1",
                GITHUB_SHA=MERGE,
            )
            shadow = "open('shadow-executed', 'w').write('untrusted')\nraise RuntimeError('UNTRUSTED_RECEIPT_MODULE')\n"
            for module in ("json", "subprocess", "sitecustomize"):
                (root / f"{module}.py").write_text(shadow)
            env["PYTHONPATH"] = str(root)
            # Prove the fixture actually executes candidate code without isolation.
            control = subprocess.run(
                [sys.executable, "-"],
                input=source,
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(control.returncode, 0)
            self.assertIn("UNTRUSTED_RECEIPT_MODULE", control.stderr)
            self.assertTrue((root / "shadow-executed").exists())
            (root / "shadow-executed").unlink()
            output = subprocess.check_output(
                [sys.executable, *invocation[1:]],
                input=source,
                cwd=root,
                env=env,
                text=True,
            )
            self.assertFalse((root / "shadow-executed").exists())
            record = pr_check.receipt_from_log(
                "2000-01-01T00:00:00.000Z " + output, policy_module.unique_object
            )
            self.assertEqual(record["checkout_sha"], actual)
            self.assertEqual(record["tree_sha"], tree)
            self.assertNotEqual(record["checkout_sha"], record["github_sha"])
            self.assertEqual(record["head_sha"], HEAD)
            self.assertEqual(record["base_sha"], BASE)

    @unittest.skipUnless(os.name == "posix", "POSIX development-host transport")
    def test_log_download_bounds_and_failures_use_real_child_processes(self):
        original = subprocess.Popen

        def run(code, **options):
            def spawn(*args, **kwargs):
                return original([sys.executable, "-c", code], **kwargs)

            with patch.object(pr_check.subprocess, "Popen", side_effect=spawn):
                return pr_check.download_log(300, root=ROOT, **options)

        self.assertEqual(run("print('ok')"), "ok\n")
        with self.assertRaises(pr_check.VerificationError):
            run("print('x'*20)", limit=10)
        with self.assertRaises(pr_check.VerificationError):
            run("import time; time.sleep(10)", timeout=0.05)
        with self.assertRaises(pr_check.VerificationError):
            run("raise SystemExit(1)")

    def test_cli_refuses_unreviewed_local_code_before_api_use(self):
        with patch.object(
            pr_check, "trusted_state", side_effect=pr_check.VerificationError("dirty")
        ):
            with patch.object(pr_check, "verify") as verify:
                with patch.object(pr_check.sys, "stderr"):
                    code = pr_check.main(
                        [
                            "5",
                            "--run-id",
                            "100",
                            "--head",
                            HEAD,
                            "--base",
                            BASE,
                            "--tree",
                            TREE,
                            "--verifier-revision",
                            BASE,
                        ]
                    )
        self.assertEqual(code, 2)
        verify.assert_not_called()


if __name__ == "__main__":
    unittest.main()
