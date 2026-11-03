"""Check the real fixed caller gate without dispatching Actions or issuing an attestation."""

from __future__ import annotations

import json
import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/installation-signing.yml"
RECIPE_SHA = "8be2fe56fd9fbbbe82f3e773a46e9f745767ebdd"


def gate():
    workflow = WORKFLOW.read_text()
    blocks = re.findall(r"^        run: \|\n((?:          [^\n]*\n)+)", workflow, re.MULTILINE)
    if len(blocks) != 1:
        raise AssertionError(
            "The fixed caller must have exactly one literal request-validation gate."
        )
    return "\n".join(line[10:] for line in blocks[0].splitlines()) + "\n"


def environment():
    return {
        "PATH": os.defpath,
        "GITHUB_ACTIONS": "true",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_REPOSITORY_ID": "1431132416",
        "GITHUB_REPOSITORY_OWNER_ID": "346940169",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "QUALIFICATION_SELECTION": "linux-x64-debian-13",
    }


class CallerContractTests(unittest.TestCase):
    def test_only_enumerated_selection_reaches_the_immutable_recipe(self):
        workflow = WORKFLOW.read_text()
        declared = re.findall(r"^          - (linux-\S+)$", workflow, re.MULTILINE)
        manifest = json.loads((ROOT / "config/desktop/targets.json").read_bytes())
        expected = {
            f"{target['id']}-{profile['id']}"
            for target in manifest["targets"]
            if target["id"] in {"linux-x64", "linux-arm64"}
            for profile in target["distribution_profiles"]
        }
        self.assertEqual(len(declared), 6)
        self.assertEqual(set(declared), expected)
        self.assertEqual(
            re.findall(r"^    uses: (.+)$", workflow, re.MULTILINE),
            [f"ohtia/ohtia/.github/workflows/signing-build.yml@{RECIPE_SHA}"],
        )
        self.assertIn("    needs: validate\n", workflow)
        self.assertEqual(
            re.findall(r"^      (\w+): \$\{\{ inputs\.(\w+) \}\}$", workflow, re.MULTILINE),
            [("selection", "selection")],
        )
        self.assertNotIn("secrets:", workflow)
        self.assertNotIn("environment:", workflow)
        self.assertNotIn("SCW_", workflow)
        self.assertNotIn("OHTIA_SIGNING_INVOKE_TOKEN", workflow)
        self.assertNotIn("secrets.", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("actions: write", workflow)
        self.assertNotIn("\nconcurrency:", workflow)

    def test_write_permissions_belong_only_to_the_reusable_call_ceiling(self):
        workflow = WORKFLOW.read_text()
        validation, delegated = workflow.split("  provenance:\n", 1)
        self.assertNotIn("id-token: write", validation)
        self.assertNotIn("attestations: write", validation)
        self.assertIn("      id-token: write\n", delegated)
        self.assertIn("      attestations: write\n", delegated)
        self.assertNotIn("run:", delegated)
        self.assertNotIn("steps:", delegated)
        recipe = (ROOT / ".github/workflows/signing-build.yml").read_text()
        construction = recipe.split("  build:\n", 1)[1].split("  attest:\n", 1)[0]
        self.assertNotIn("id-token: write", construction)
        self.assertNotIn("attestations: write", construction)
        self.assertIn("      contents: read\n", construction)
        self.assertNotIn("concurrency:", recipe)
        self.assertEqual(gate().count("case "), 1)


class CallerGateTests(unittest.TestCase):
    def run_gate(self, env):
        return subprocess.run(
            ["/bin/bash", "--noprofile", "--norc", "-c", gate()],
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )

    def test_each_native_linux_selection_is_accepted(self):
        for arch in ("x64", "arm64"):
            for profile in ("ubuntu-26.04", "fedora-44", "debian-13"):
                with self.subTest(arch=arch, profile=profile):
                    result = self.run_gate(
                        environment() | {"QUALIFICATION_SELECTION": f"linux-{arch}-{profile}"}
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout, "")
                    self.assertEqual(result.stderr, "")

    def test_api_overrides_and_shell_syntax_are_refused_as_data(self):
        for value in (
            "",
            "linux-x64-fedora-45",
            "win32-x64",
            "linux-x64-debian-13\n",
            "linux-x64-debian-13;exit 0",
            "$(printf injected)",
            "`printf injected`",
            "../../recipe",
            "linux-x64-debian-13 extra",
        ):
            with self.subTest(selection=value):
                result = self.run_gate(environment() | {"QUALIFICATION_SELECTION": value})
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr, "Build provenance qualification refused: selection.\n"
                )

    def test_foreign_and_missing_execution_identity_are_refused(self):
        for key, value in (
            ("GITHUB_ACTIONS", "false"),
            ("RUNNER_ENVIRONMENT", "self-hosted"),
            ("GITHUB_REPOSITORY", "other/ohtia"),
            ("GITHUB_REPOSITORY_ID", "1"),
            ("GITHUB_REPOSITORY_OWNER_ID", "1"),
            ("GITHUB_REF", "refs/heads/chore/issue-27"),
            ("GITHUB_EVENT_NAME", "pull_request"),
        ):
            for missing in (False, True):
                with self.subTest(key=key, missing=missing):
                    env = environment()
                    if missing:
                        env.pop(key)
                    else:
                        env[key] = value
                    result = self.run_gate(env)
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, "")
                    self.assertEqual(
                        result.stderr,
                        "Build provenance qualification refused: execution identity.\n",
                    )


if __name__ == "__main__":
    unittest.main()
