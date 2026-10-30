"""Exercise complete target, package, case and PR/main identity accounting."""

from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_delivery as delivery


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name).resolve()
        self.identity = {
            "schema_version": 1,
            "repository": "ohtia/ohtia",
            "event": "pull_request",
            "ref": "refs/pull/26/merge",
            "run_id": 100,
            "run_attempt": 2,
            "pull_request": 26,
            "head_sha": "a" * 40,
            "base_sha": "b" * 40,
            "github_sha": "c" * 40,
            "checkout_sha": "c" * 40,
            "tree_sha": "d" * 40,
        }
        self.plan = delivery.plan(self.identity)

    def populate(self):
        for cell in self.plan["cells"]:
            directory = self.output / f"quality-{cell['id']}-100-2"
            directory.mkdir()
            packages = {}
            for format_id in cell["formats"]:
                package = directory / f"package.{format_id}"
                package.write_bytes(b"synthetic package")
                observation = directory / f"{format_id}-native.json"
                delivery.write(
                    observation,
                    {
                        "plan": self.plan,
                        "cell": cell,
                        "package": delivery.artifact(package, directory),
                        "prepared_sha256": "e" * 64,
                        "display_observations": [
                            {
                                "backend": cell["backend"],
                                "source": "unix-peer"
                                if cell["target"].startswith("linux-")
                                else "packaged-window-capture",
                            }
                        ],
                        "samples": [{"pid": 1000, "renderer": True, "sandbox": True}],
                        "remaining": [],
                    },
                )
                native = {
                    "execution": "native",
                    "emulated": False,
                    "host_arch": cell["target"].split("-")[1],
                    "process_arch": cell["target"].split("-")[1],
                    "addon_arch": cell["target"].split("-")[1],
                    "target": cell["target"],
                    "profile": cell["profile"],
                    "backend": cell["backend"],
                    "filesystem": cell["filesystem"],
                    "tree_cessation": True,
                    "sandbox_observed": True,
                    "stable_preserved": True,
                    "evidence": delivery.artifact(observation, directory),
                }
                suites = {}
                for suite in delivery.SUITES:
                    required, observed = delivery.suite_cases(suite, cell["target"])
                    file = directory / f"{format_id}-{suite}.json"
                    delivery.write(
                        file,
                        {
                            "preparedSha256" if suite == "diagnostics" else "artifact": "e" * 64,
                            "cases": [
                                {"id": case, "result": "observed" if case in observed else "pass"}
                                for case in sorted(required)
                            ],
                        },
                    )
                    suites[suite] = delivery.artifact(file, directory)
                packages[format_id] = {
                    "artifact": delivery.artifact(package, directory),
                    "application_version": self.plan["application_version"],
                    "native": native,
                    "suites": suites,
                }
            delivery.write(
                directory / "result.json",
                {
                    "version": 1,
                    "status": "passed",
                    "cell": cell,
                    "plan": self.plan,
                    "packages": packages,
                },
            )

            if cell["id"].endswith("-vm"):
                delivery.write(
                    directory / "virtual-machine.json",
                    {
                        "version": 1,
                        "plan": self.plan,
                        "cell": cell,
                        "guest_exit": 0,
                        "accelerator": {"enabled": True, "present": True},
                    },
                )

    def first_receipt(self):
        return next(self.output.glob("*/result.json"))

    def test_complete_required_matrix_and_formats(self):
        cells = self.plan["cells"]
        self.assertEqual(len(cells), 14)
        self.assertEqual(sum(len(cell["formats"]) for cell in cells), 16)
        self.assertEqual(
            {c["target"] for c in cells},
            {"linux-x64", "linux-arm64", "win32-x64", "win32-arm64", "darwin-arm64"},
        )
        self.assertEqual(
            {c["profile"] for c in cells if c["target"] == "darwin-arm64"}, {"macos-26", "macos-27"}
        )
        self.populate()
        self.assertEqual(delivery.account(self.plan, self.output)["status"], "passed")

    def test_missing_extra_failed_skipped_cancelled_and_stale_partitions_fail(self):
        self.populate()
        file = self.first_receipt()
        original = delivery.read(file)
        for status in ("failed", "skipped", "cancelled", "pending"):
            with self.subTest(status=status):
                delivery.write(file, {**original, "status": status})
                with self.assertRaises(delivery.DeliveryError):
                    delivery.account(self.plan, self.output)
        delivery.write(file, original)
        for field, value in (
            ("run_attempt", 1),
            ("head_sha", "f" * 40),
            ("base_sha", "e" * 40),
            ("tree_sha", "f" * 40),
        ):
            changed = copy.deepcopy(original)
            changed["plan"]["identity"][field] = value
            delivery.write(file, changed)
            with self.subTest(field=field), self.assertRaises(delivery.DeliveryError):
                delivery.account(self.plan, self.output)
        delivery.write(file, original)
        extra = self.output / "extra"
        extra.mkdir()
        with self.assertRaises(delivery.DeliveryError):
            delivery.account(self.plan, self.output)
        extra.rmdir()
        file.unlink()
        with self.assertRaises(FileNotFoundError):
            delivery.account(self.plan, self.output)

    def test_emulation_wrong_architecture_and_missing_format_fail(self):
        self.populate()
        file = self.first_receipt()
        original = delivery.read(file)
        for field, value in (
            ("emulated", True),
            ("host_arch", "wrong"),
            ("process_arch", "wrong"),
            ("addon_arch", "wrong"),
            ("tree_cessation", False),
            ("sandbox_observed", False),
        ):
            changed = copy.deepcopy(original)
            next(iter(changed["packages"].values()))["native"][field] = value
            delivery.write(file, changed)
            with self.subTest(field=field), self.assertRaises(delivery.DeliveryError):
                delivery.account(self.plan, self.output)
        changed = copy.deepcopy(original)
        changed["packages"].pop(next(iter(changed["packages"])))
        delivery.write(file, changed)
        with self.assertRaises(delivery.DeliveryError):
            delivery.account(self.plan, self.output)

    def test_tampered_package_and_missing_smoke_case_fail(self):
        self.populate()
        file = self.first_receipt()
        receipt = delivery.read(file)
        package = next(iter(receipt["packages"].values()))
        artifact = file.parent / package["artifact"]["file"]
        artifact.write_bytes(b"changed")
        with self.assertRaisesRegex(delivery.DeliveryError, "bytes changed"):
            delivery.account(self.plan, self.output)
        artifact.write_bytes(b"synthetic package")
        suite_file = file.parent / package["suites"]["runtime"]["file"]
        suite = delivery.read(suite_file)
        suite["cases"].pop()
        delivery.write(suite_file, suite)
        package["suites"]["runtime"] = delivery.artifact(suite_file, file.parent)
        delivery.write(file, receipt)
        with self.assertRaisesRegex(delivery.DeliveryError, "case inventory"):
            delivery.account(self.plan, self.output)

    def test_main_and_pr_identities_are_distinct(self):
        main = {
            **self.identity,
            "event": "push",
            "ref": "refs/heads/main",
            "pull_request": None,
            "head_sha": None,
            "base_sha": None,
        }
        delivery.validate_identity(main)
        self.assertNotEqual(delivery.plan(main), self.plan)
        for key in ("pull_request", "head_sha", "base_sha"):
            with self.subTest(key=key), self.assertRaises(delivery.DeliveryError):
                delivery.validate_identity({**main, key: self.identity[key]})
        for field, value in (
            ("run_id", True),
            ("run_attempt", 0),
            ("checkout_sha", "e" * 40),
            ("ref", "refs/heads/main"),
        ):
            with self.subTest(field=field), self.assertRaises(delivery.DeliveryError):
                delivery.validate_identity({**self.identity, field: value})

        # The same initial/final identity guard must report bounded paths, never file contents.
        event = self.output / "event.json"
        delivery.write(event, {})
        env = {
            "GITHUB_EVENT_PATH": str(event),
            "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_REPOSITORY": "ohtia/ohtia",
            "GITHUB_RUN_ID": "100",
            "GITHUB_RUN_ATTEMPT": "1",
        }
        for dirty in [
            "?? generated.txt\n",
            ' M config/example.json\n?? "line\\nname"',
            "?? " + "x" * 8192,
        ]:
            with (
                self.subTest(dirty_length=len(dirty)),
                patch.object(delivery, "git", side_effect=["c" * 40, "d" * 40, dirty]),
            ):
                with self.assertRaises(delivery.DeliveryError) as refused:
                    delivery.identity(env)
                message = str(refused.exception)
                prefix = "Quality checkout has uncommitted inputs: "
                self.assertTrue(message.startswith(prefix))
                self.assertEqual(json.loads(message[len(prefix) :]), dirty[:4096])
                self.assertNotIn("\n", message)

    def test_missing_or_nonstandard_hosted_runner_fails(self):
        manifest = delivery.read(delivery.ROOT / "config/desktop/targets.json")
        matrix = delivery.read(delivery.ROOT / "config/quality/build-targets.json")
        for runner in ("ubuntu-26.04-xlarge", "self-hosted", "windows-latest"):
            invalid = copy.deepcopy(matrix)
            invalid["cells"][0]["runner"] = runner
            with self.subTest(runner=runner), self.assertRaises(delivery.DeliveryError):
                delivery.cells(manifest, invalid)
        matrix["cells"].pop()
        with self.assertRaises(delivery.DeliveryError):
            delivery.cells(manifest, matrix)

    def test_boolean_version_and_foreign_backend_observation_fail(self):
        self.populate()
        file = self.first_receipt()
        receipt = delivery.read(file)
        delivery.write(file, {**receipt, "version": True})
        with self.assertRaises(delivery.DeliveryError):
            delivery.account(self.plan, self.output)
        package = next(iter(receipt["packages"].values()))
        observed_file = file.parent / package["native"]["evidence"]["file"]
        observed = delivery.read(observed_file)
        observed["display_observations"][0]["backend"] = "foreign-backend"
        delivery.write(observed_file, observed)
        package["native"]["evidence"] = delivery.artifact(observed_file, file.parent)
        delivery.write(file, receipt)
        with self.assertRaisesRegex(delivery.DeliveryError, "backend"):
            delivery.account(self.plan, self.output)

    def test_unsafe_attachments_and_duplicate_json_fields_fail(self):
        file = self.output / "record.json"
        file.write_text('{"status":"passed","status":"failed"}')
        with self.assertRaisesRegex(delivery.DeliveryError, "Duplicate"):
            delivery.read(file)
        with self.assertRaises(delivery.DeliveryError):
            delivery.check_attachment(
                {"file": "../escape", "sha256": "a" * 64, "bytes": 1}, self.output
            )


def execute(*args: str, env: dict | None = None) -> tuple[int, str]:
    stdout = io.StringIO()
    with (
        patch.object(sys, "argv", ["quality_delivery.py", *args]),
        patch.dict(os.environ, env or {}),
        contextlib.redirect_stdout(stdout),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        return delivery.main(), stdout.getvalue()


class ScopeTests(unittest.TestCase):
    """Select native jobs from real synthetic merges rather than from reported file lists."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve() / "repository"
        self.root.mkdir()
        self.event = Path(temp.name).resolve() / "event.json"
        self.output = Path(temp.name).resolve() / "github-output"
        patcher = patch.object(delivery, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.command("init", "--quiet")
        for name in (
            "README.md",
            "docs/guide.md",
            "packages/app.ts",
            "pnpm-lock.yaml",
            "scripts/tool.py",
            "tooling/run.mjs",
        ):
            self.write(name)
        self.base = self.commit()

    def command(self, *args: str) -> str:
        env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        return (
            subprocess.check_output(
                [
                    "git",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    *args,
                ],
                cwd=self.root,
                env=env,
            )
            .decode()
            .strip()
        )

    def write(self, name: str, content: str = "synthetic\n") -> None:
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)

    def commit(self) -> str:
        self.command("add", "--all")
        self.command("commit", "--quiet", "--allow-empty", "-m", "Synthetic fixture")
        return self.command("rev-parse", "HEAD")

    def merge(self, change) -> str:
        """Check out the synthetic merge GitHub would test and describe it in the event."""
        self.command("checkout", "--quiet", "--detach", self.base)
        change()
        head = self.commit()
        self.command("checkout", "--quiet", "--detach", self.base)
        self.command("merge", "--quiet", "--no-ff", "--no-edit", head)
        delivery.write(
            self.event, {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}
        )
        return head

    def env(self, event_name: str = "pull_request") -> dict:
        return {"GITHUB_EVENT_NAME": event_name, "GITHUB_EVENT_PATH": str(self.event)}

    def test_change_only_under_docs_skips_native_jobs(self):
        def change():
            self.write("docs/guide.md", "changed\n")
            self.write("docs/adr/new.md")

        self.merge(change)
        self.assertEqual(delivery.quality_scope(self.env()), delivery.DOCUMENTATION_ONLY)

    def test_push_keeps_the_full_matrix_for_a_documentation_change(self):
        self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        self.assertEqual(delivery.quality_scope(self.env("push")), delivery.FULL_MATRIX)

    def test_every_other_difference_keeps_the_full_matrix(self):
        def docs_and_other():
            self.write("docs/guide.md", "changed\n")
            self.write("packages/app.ts", "changed\n")

        def rename_into_docs():
            self.command("mv", "scripts/tool.py", "docs/tool.py")

        def mode_only():
            (self.root / "scripts/tool.py").chmod(0o755)

        def replace_docs_with_a_file():
            self.command("rm", "-r", "--quiet", "docs")
            self.write("docs", "not a tree\n")

        def remove_docs():
            self.command("rm", "-r", "--quiet", "docs")

        changes = {
            "root markdown": lambda: self.write("README.md", "changed\n"),
            "docs and another path": docs_and_other,
            "packages": lambda: self.write("packages/app.ts", "changed\n"),
            "lockfile": lambda: self.write("pnpm-lock.yaml", "changed\n"),
            "tooling": lambda: self.write("tooling/run.mjs", "changed\n"),
            "rename into docs": rename_into_docs,
            "mode outside docs": mode_only,
            "empty difference": lambda: None,
            "docs replaced by a file": replace_docs_with_a_file,
            "docs removed": remove_docs,
        }
        for name, change in changes.items():
            with self.subTest(change=name):
                self.merge(change)
                self.assertEqual(delivery.quality_scope(self.env()), delivery.FULL_MATRIX)

    def test_merge_parents_must_match_the_event(self):
        head = self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        for pull in (
            {"base": {"sha": "f" * 40}, "head": {"sha": head}},
            {"base": {"sha": self.base}, "head": {"sha": "f" * 40}},
            {"base": {"sha": head}, "head": {"sha": self.base}},
        ):
            with self.subTest(pull=pull):
                delivery.write(self.event, {"pull_request": pull})
                self.assertEqual(delivery.quality_scope(self.env()), delivery.FULL_MATRIX)

    def test_a_commit_without_two_parents_keeps_the_full_matrix(self):
        self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        self.command("checkout", "--quiet", "--detach", self.base)
        self.write("docs/guide.md", "changed\n")
        head = self.commit()
        delivery.write(
            self.event, {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}
        )
        self.assertEqual(delivery.quality_scope(self.env()), delivery.FULL_MATRIX)

    def test_unreadable_evidence_and_git_failure_keep_the_full_matrix(self):
        self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        self.assertEqual(delivery.quality_scope(self.env()), delivery.DOCUMENTATION_ONLY)
        for content in ("not json", "[]", "{}", '{"pull_request":null}', '{"pull_request":{}}'):
            with self.subTest(event=content):
                self.event.write_text(content)
                self.assertEqual(delivery.quality_scope(self.env()), delivery.FULL_MATRIX)
        self.event.unlink()
        self.assertEqual(delivery.quality_scope(self.env()), delivery.FULL_MATRIX)
        self.assertEqual(delivery.quality_scope({}), delivery.FULL_MATRIX)
        self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        for failure in (subprocess.CalledProcessError(1, "git"), FileNotFoundError("git")):
            with (
                self.subTest(failure=failure),
                patch.object(delivery, "git", side_effect=failure),
            ):
                self.assertEqual(delivery.quality_scope(self.env()), delivery.FULL_MATRIX)

    def test_command_writes_one_selection_and_prints_it(self):
        self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        env = {**self.env(), "GITHUB_OUTPUT": str(self.output)}
        status, printed = execute("scope", env=env)
        self.assertEqual(status, 0)
        self.assertEqual(self.output.read_text(), "selection=documentation-only\n")
        self.assertEqual(printed, "OHTIA_QUALITY_SELECTION=documentation-only\n")
        self.event.unlink()
        status, printed = execute("scope", env=env)
        self.assertEqual(status, 0)
        self.assertEqual(
            self.output.read_text(),
            "selection=documentation-only\nselection=full-required-matrix\n",
        )
        self.assertEqual(printed, "OHTIA_QUALITY_SELECTION=full-required-matrix\n")

    def test_command_fails_only_when_its_output_cannot_be_written(self):
        self.merge(lambda: self.write("docs/guide.md", "changed\n"))
        unwritable = {**self.env(), "GITHUB_OUTPUT": str(self.root)}
        self.assertEqual(execute("scope", env=unwritable)[0], 1)
        with patch.dict(os.environ):
            os.environ.pop("GITHUB_OUTPUT", None)
            self.assertEqual(execute("scope", env=self.env())[0], 1)


class NeedsTests(unittest.TestCase):
    @staticmethod
    def needs(selection="full-required-matrix", native="success", **changes) -> dict:
        value = {
            "scope": {"result": "success", "outputs": {"selection": selection}},
            "checks": {"result": "success", "outputs": {}},
            "native": {"result": native, "outputs": {}},
        }
        value.update(changes)
        return value

    @staticmethod
    def status(needs, event="pull_request") -> int:
        env = {"OHTIA_QUALITY_NEEDS": json.dumps(needs), "GITHUB_EVENT_NAME": event}
        return execute("needs", env=env)[0]

    def test_only_complete_results_for_the_selection_are_accepted(self):
        for event, needs in (
            ("pull_request", self.needs()),
            ("push", self.needs()),
            ("pull_request", self.needs("documentation-only", "skipped")),
        ):
            with self.subTest(event=event, needs=needs):
                self.assertEqual(self.status(needs, event), 0)

    def test_inconsistent_or_incomplete_results_are_refused(self):
        failed = {"result": "failure", "outputs": {}}
        cancelled = {"result": "cancelled", "outputs": {}}
        extra = {**self.needs(), "other": {"result": "success", "outputs": {}}}
        missing = {key: value for key, value in self.needs().items() if key != "checks"}
        cases = {
            "documentation-only on push": (self.needs("documentation-only", "skipped"), "push"),
            "documentation-only with native": (self.needs("documentation-only"), "pull_request"),
            "documentation-only with failed native": (
                self.needs("documentation-only", "failure"),
                "pull_request",
            ),
            "full matrix with skipped native": (self.needs(native="skipped"), "pull_request"),
            "full matrix with failed native": (self.needs(native="failure"), "pull_request"),
            "full matrix with cancelled native": (self.needs(native="cancelled"), "push"),
            "missing key": (missing, "pull_request"),
            "extra key": (extra, "pull_request"),
            "failed scope": (self.needs(scope=failed), "pull_request"),
            "cancelled scope": (self.needs(scope=cancelled), "pull_request"),
            "failed checks": (self.needs(checks=failed), "pull_request"),
            "cancelled checks": (self.needs(checks=cancelled), "pull_request"),
            "empty selection": (self.needs(""), "pull_request"),
            "unknown selection": (self.needs("partial", "skipped"), "pull_request"),
            "null native for unknown selection": (self.needs("partial", None), "pull_request"),
            "not an object": ([], "pull_request"),
        }
        for name, (needs, event) in cases.items():
            with self.subTest(case=name):
                self.assertEqual(self.status(needs, event), 1)
        with patch.dict(os.environ):
            os.environ.pop("OHTIA_QUALITY_NEEDS", None)
            self.assertEqual(execute("needs", env={"GITHUB_EVENT_NAME": "push"})[0], 1)


if __name__ == "__main__":
    unittest.main()
