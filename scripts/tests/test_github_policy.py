"""Exercise policy enforcement and failure paths without network access."""

from __future__ import annotations

import copy
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

SPEC = importlib.util.spec_from_file_location(
    "github_policy", Path(__file__).parents[1] / "github_policy.py"
)
policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy)
CONFIG = policy.load_config(policy.ROOT / "config/github")


class FakeGitHub(policy.GitHub):
    def __init__(self):
        self.repository = {
            "id": 42,
            "full_name": "ohtia/ohtia",
            "visibility": "public",
            "default_branch": "main",
            **copy.deepcopy(CONFIG["repository"]),
        }
        self.actions = copy.deepcopy(CONFIG["actions-permissions"])
        self.labels = copy.deepcopy(CONFIG["labels"])
        self.alerts = True
        self.fixes = {"enabled": True, "paused": False}
        self.ruleset = {"id": 7, **copy.deepcopy(CONFIG["ruleset-main"])}
        self.other_rules = []
        self.classic = False
        self.app_id = 15368
        self.workflow = {"path": ".github/workflows/ci.yml", "state": "active"}
        self.fail_read = None
        self.fail_write = False
        self.discard_write = False
        self.writes = []

    def request(self, endpoint, method="GET", payload=None, allowed=(200,)):
        base = policy.REPO
        if method == "GET":
            if self.fail_read == endpoint:
                raise policy.PolicyError("Simulated permission failure")
            if endpoint == base:
                return 200, copy.deepcopy(self.repository)
            if endpoint == "apps/github-actions":
                return 200, {"id": self.app_id, "slug": "github-actions"}
            if endpoint == f"{base}/actions/workflows/ci.yml":
                return 200, self.workflow
            if endpoint.startswith(f"{base}/actions/permissions"):
                key = {
                    f"{base}/actions/permissions": "permissions",
                    f"{base}/actions/permissions/selected-actions": "selected_actions",
                    f"{base}/actions/permissions/workflow": "workflow",
                }[endpoint]
                return 200, copy.deepcopy(self.actions[key])
            if endpoint == f"{base}/vulnerability-alerts":
                return (204 if self.alerts else 404), None
            if endpoint == f"{base}/automated-security-fixes":
                return 200, self.fixes.copy()
            if endpoint.startswith(f"{base}/labels?"):
                return 200, copy.deepcopy(self.labels)
            if endpoint.startswith(f"{base}/labels/"):
                name = unquote(endpoint.rsplit("/", 1)[1])
                return 200, copy.deepcopy(next(x for x in self.labels if x["name"] == name))
            if endpoint.startswith(f"{base}/rulesets?"):
                return 200, (
                    [
                        {
                            "id": 7,
                            "name": "main",
                            "source": "ohtia/ohtia",
                            "source_type": "Repository",
                        }
                    ]
                    if self.ruleset
                    else []
                )
            if endpoint == f"{base}/rulesets/7":
                return 200, copy.deepcopy(self.ruleset)
            if endpoint.startswith(f"{base}/rules/branches/"):
                rules = (
                    [{**x, "ruleset_id": 7} for x in self.ruleset["rules"]] if self.ruleset else []
                )
                return 200, copy.deepcopy(rules + self.other_rules)
            if endpoint.endswith("/protection"):
                return (200 if self.classic else 404), None
            raise AssertionError(endpoint)
        self.writes.append((endpoint, method, copy.deepcopy(payload)))
        if self.fail_write:
            raise policy.PolicyError("Simulated write failure")
        if self.discard_write:
            return 200, {}
        if endpoint == base:
            self.repository.update(payload)
        elif endpoint.startswith(f"{base}/actions/permissions"):
            key = {
                f"{base}/actions/permissions": "permissions",
                f"{base}/actions/permissions/selected-actions": "selected_actions",
                f"{base}/actions/permissions/workflow": "workflow",
            }[endpoint]
            self.actions[key] = copy.deepcopy(payload)
        elif endpoint == f"{base}/vulnerability-alerts":
            self.alerts = True
        elif endpoint == f"{base}/automated-security-fixes":
            self.fixes = {"enabled": True, "paused": False}
        elif endpoint == f"{base}/labels":
            self.labels.append(copy.deepcopy(payload))
        elif endpoint.startswith(f"{base}/labels/"):
            name = unquote(endpoint.rsplit("/", 1)[1])
            label = next(x for x in self.labels if x["name"] == name)
            label.update(
                name=payload["new_name"],
                color=payload["color"],
                description=payload["description"],
            )
        elif endpoint.startswith(f"{base}/rulesets"):
            self.ruleset = {"id": 7, **copy.deepcopy(payload)}
            return 201, {"id": 7}
        else:
            raise AssertionError(endpoint)
        return 204, None


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.github = FakeGitHub()

    def apply(self, stage):
        confirmation = policy.digest(policy.plan(self.github, CONFIG, stage))
        with redirect_stdout(io.StringIO()):
            policy.apply(self.github, CONFIG, stage, confirmation)

    def test_conformity_and_read_only_planning(self):
        for stage in ("base", "ruleset"):
            self.assertEqual(policy.plan(self.github, CONFIG, stage)["changes"], [])
        self.assertEqual(self.github.writes, [])

    def test_update_only_declared_repository_fields(self):
        self.github.repository.update(allow_squash_merge=True, homepage="https://example.org")
        self.apply("base")
        self.assertFalse(self.github.repository["allow_squash_merge"])
        self.assertEqual(self.github.repository["homepage"], "https://example.org")
        self.assertEqual(len(self.github.writes), 1)
        self.assertEqual(self.github.writes[0][1], "PATCH")

    def test_missing_admin_fields_are_an_error(self):
        del self.github.repository["allow_squash_merge"]
        with self.assertRaises(policy.PolicyError):
            policy.plan(self.github, CONFIG, "base")

    def test_permission_failure_blocks_all_writes(self):
        self.github.repository["allow_squash_merge"] = True
        self.github.fail_read = f"{policy.REPO}/actions/permissions"
        with self.assertRaises(policy.PolicyError):
            policy.apply(self.github, CONFIG, "base", "unused")
        self.assertEqual(self.github.writes, [])

    def test_wrong_confirmation_never_writes(self):
        self.github.repository["allow_squash_merge"] = True
        with self.assertRaises(policy.PolicyError):
            policy.apply(self.github, CONFIG, "base", "incorrect")
        self.assertEqual(self.github.writes, [])

    def test_plan_is_bound_to_remote_changes_and_repository(self):
        confirmation = policy.digest(policy.plan(self.github, CONFIG, "base"))
        self.github.repository["allow_squash_merge"] = True
        with self.assertRaises(policy.PolicyError):
            policy.apply(self.github, CONFIG, "base", confirmation)
        self.assertEqual(self.github.writes, [])
        self.github.repository["full_name"] = "someone/else"
        with self.assertRaises(policy.PolicyError):
            policy.plan(self.github, CONFIG, "base")

    def test_label_creation_updates_and_unmanaged_preservation(self):
        self.github.labels = [
            copy.deepcopy(CONFIG["labels"][0]),
            {"name": "custom", "color": "123456", "description": "Unmanaged"},
        ]
        self.github.labels[0]["description"] = "Old description"
        self.apply("base")
        custom = next(x for x in self.github.labels if x["name"] == "custom")
        self.assertEqual(custom["description"], "Unmanaged")
        self.assertEqual(policy.plan(self.github, CONFIG, "base")["unmanaged_labels"], ["custom"])
        self.assertTrue(
            any(
                method == "PATCH" and "new_name" in payload
                for _, method, payload in self.github.writes
            )
        )
        self.assertFalse(any(method == "DELETE" for _, method, _ in self.github.writes))

    def test_label_case_change_uses_live_name_then_reads_declared_name(self):
        self.github.labels[0]["name"] = "Bug"
        self.apply("base")
        self.assertEqual(self.github.writes[0][0], f"{policy.REPO}/labels/Bug")
        self.assertEqual(self.github.writes[0][2]["new_name"], "bug")
        self.assertEqual(self.github.labels[0]["name"], "bug")

    def test_null_label_description_is_planned_and_updated(self):
        self.github.labels[0]["description"] = None
        candidate = policy.plan(self.github, CONFIG, "base")
        self.assertEqual(len(candidate["changes"]), 1)
        change = candidate["changes"][0]
        self.assertIsNone(change["before"]["description"])
        self.assertEqual(change["after"]["description"], CONFIG["labels"][0]["description"])
        self.assertEqual(self.github.writes, [])
        self.apply("base")
        self.assertEqual(self.github.labels[0]["description"], CONFIG["labels"][0]["description"])
        self.assertEqual(len(self.github.writes), 1)
        self.assertEqual(self.github.writes[0][1], "PATCH")
        self.assertEqual(policy.plan(self.github, CONFIG, "base")["changes"], [])

    def test_missing_label_description_remains_a_read_failure(self):
        del self.github.labels[0]["description"]
        with self.assertRaises(policy.PolicyError):
            self.apply("base")
        self.assertEqual(self.github.writes, [])

    def test_default_branch_drift_blocks_both_stages(self):
        self.github.repository["default_branch"] = "develop"
        for stage in ("base", "ruleset"):
            with self.subTest(stage=stage):
                with self.assertRaisesRegex(policy.PolicyError, "default branch must be main"):
                    policy.plan(self.github, CONFIG, stage)
        self.assertEqual(self.github.writes, [])

    def test_default_branch_change_invalidates_confirmed_plan(self):
        self.github.ruleset = None
        candidate = policy.plan(self.github, CONFIG, "ruleset")
        self.assertEqual(candidate["repository"]["default_branch"], "main")
        self.github.repository["default_branch"] = "develop"
        with self.assertRaisesRegex(policy.PolicyError, "default branch must be main"):
            policy.apply(self.github, CONFIG, "ruleset", policy.digest(candidate))
        self.assertEqual(self.github.writes, [])

    def test_non_object_api_response_is_read_error_not_drift(self):
        errors = io.StringIO()
        with patch.object(policy, "GitHub", return_value=self.github):
            with patch.object(self.github, "get", return_value=[]):
                with patch.object(policy.sys, "stderr", errors):
                    self.assertEqual(policy.main(["verify"]), 2)
        self.assertNotIn("Traceback", errors.getvalue())
        self.assertEqual(self.github.writes, [])

    def test_label_colors_are_case_insensitive(self):
        for label in self.github.labels:
            label["color"] = label["color"].upper()
        self.assertEqual(policy.plan(self.github, CONFIG, "base")["changes"], [])

    def test_enable_security_before_automated_fixes(self):
        self.github.alerts = False
        self.github.fixes = {"enabled": True, "paused": True}
        self.apply("base")
        self.assertEqual(
            [endpoint.rsplit("/", 1)[1] for endpoint, _, _ in self.github.writes],
            ["vulnerability-alerts", "automated-security-fixes"],
        )
        self.assertTrue(all(payload is None for _, _, payload in self.github.writes))

    def test_selected_actions_are_written_after_enabling_selected_policy(self):
        self.github.actions["permissions"]["allowed_actions"] = "all"
        self.apply("base")
        self.assertTrue(self.github.writes[0][0].endswith("/actions/permissions"))
        self.assertTrue(self.github.writes[1][0].endswith("/selected-actions"))

    def test_failed_write_stops_without_claiming_success(self):
        self.github.repository["allow_squash_merge"] = True
        self.github.alerts = False
        self.github.fail_write = True
        with self.assertRaises(policy.PolicyError):
            self.apply("base")
        self.assertEqual(len(self.github.writes), 1)

    def test_readback_detects_ignored_writes(self):
        self.github.repository["allow_squash_merge"] = True
        self.github.discard_write = True
        with self.assertRaisesRegex(policy.PolicyError, "Readback differs"):
            self.apply("base")

    def test_stage_isolation(self):
        self.github.repository["allow_squash_merge"] = True
        self.github.ruleset = None
        self.apply("base")
        self.assertIsNone(self.github.ruleset)
        self.github.repository["allow_squash_merge"] = True
        self.apply("ruleset")
        self.assertTrue(self.github.repository["allow_squash_merge"])

    def test_ruleset_creation_uses_readback_and_is_idempotent(self):
        self.github.ruleset = None
        self.apply("ruleset")
        self.apply("ruleset")
        self.assertEqual(len(self.github.writes), 1)
        self.assertEqual(self.github.writes[0][1], "POST")

    def test_ruleset_requires_published_active_workflow(self):
        self.github.ruleset = None
        self.github.workflow["state"] = "disabled_manually"
        with self.assertRaises(policy.PolicyError):
            self.apply("ruleset")
        self.assertEqual(self.github.writes, [])

    def test_ruleset_rejects_other_effective_rules_and_classic_protection(self):
        self.github.other_rules = [{"type": "deletion", "ruleset_id": 99}]
        with self.assertRaises(policy.PolicyError):
            policy.plan(self.github, CONFIG, "ruleset")
        self.github.other_rules = []
        self.github.classic = True
        with self.assertRaises(policy.PolicyError):
            policy.plan(self.github, CONFIG, "ruleset")
        self.assertEqual(self.github.writes, [])

    def test_ruleset_can_bind_a_previously_unbound_check(self):
        rule = next(
            x for x in self.github.ruleset["rules"] if x["type"] == "required_status_checks"
        )
        rule["parameters"]["required_status_checks"][0]["integration_id"] = None
        self.apply("ruleset")
        self.assertEqual(policy.plan(self.github, CONFIG, "ruleset")["changes"], [])
        self.assertEqual(self.github.writes[0][1], "PUT")

    def test_ruleset_checks_live_app_identity(self):
        self.github.app_id = 99
        with self.assertRaises(policy.PolicyError):
            policy.plan(self.github, CONFIG, "ruleset")

    def test_ruleset_checks_effective_enforcement(self):
        original = self.github.listing

        def listing(endpoint):
            return [] if "/rules/branches/" in endpoint else original(endpoint)

        with patch.object(self.github, "listing", side_effect=listing):
            with self.assertRaisesRegex(policy.PolicyError, "Effective"):
                policy.plan(self.github, CONFIG, "ruleset")

    def test_unexpected_rule_is_not_ignored(self):
        self.github.ruleset["rules"].append({"type": "creation"})
        self.assertTrue(policy.plan(self.github, CONFIG, "ruleset")["changes"])

    def test_inherited_ruleset_name_is_never_replaced(self):
        original = self.github.listing

        def listing(endpoint):
            if "/rulesets?" in endpoint:
                return [
                    {"id": 99, "name": "main", "source": "ohtia", "source_type": "Organization"}
                ]
            return original(endpoint)

        with patch.object(self.github, "listing", side_effect=listing):
            with self.assertRaisesRegex(policy.PolicyError, "Conflicting"):
                self.apply("ruleset")
        self.assertEqual(self.github.writes, [])

    def test_missing_security_fields_are_a_read_failure(self):
        del self.github.fixes["paused"]
        with self.assertRaises(policy.PolicyError):
            policy.plan(self.github, CONFIG, "base")

    def test_cli_exit_codes_distinguish_drift_and_read_failure(self):
        with patch.object(policy, "GitHub", return_value=self.github):
            with redirect_stdout(io.StringIO()):
                self.assertEqual(policy.main(["verify"]), 0)
                self.github.repository["allow_squash_merge"] = True
                self.assertEqual(policy.main(["verify", "--stage", "base"]), 1)
            self.github.fail_read = policy.REPO
            with patch.object(policy.sys, "stderr", io.StringIO()):
                self.assertEqual(policy.main(["verify"]), 2)
        self.assertEqual(self.github.writes, [])

    def test_pagination_keeps_every_label(self):
        github = policy.GitHub()
        with patch.object(github, "get", side_effect=[list(range(100)), [100]]):
            self.assertEqual(github.listing("labels"), list(range(101)))

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaises(policy.PolicyError):
            json.loads(
                '{"name": "first", "name": "second"}',
                object_pairs_hook=policy.unique_object,
            )

    def test_invalid_config_and_duplicate_labels_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in CONFIG.items():
                (root / f"{name}.json").write_text(json.dumps(value))
            (root / "labels.json").write_text(json.dumps([CONFIG["labels"][0]] * 2))
            with self.assertRaisesRegex(policy.PolicyError, "Duplicate"):
                policy.load_config(root)


class TransportTests(unittest.TestCase):
    def test_uses_structured_payload_and_literal_repository_placeholders(self):
        seen = []

        def run(command, **kwargs):
            seen.append(command)
            path = Path(command[command.index("--input") + 1])
            self.assertEqual(json.loads(path.read_text()), {"name": 'A quoted "label"'})
            return subprocess.CompletedProcess(
                command,
                0,
                'HTTP/2.0 201 Created\ncontent-type: application/json\n\n{"id":1}',
                "",
            )

        with patch.object(policy.subprocess, "run", side_effect=run):
            self.assertEqual(
                policy.GitHub().request(
                    f"{policy.REPO}/labels",
                    "POST",
                    {"name": 'A quoted "label"'},
                    allowed=(201,),
                ),
                (201, {"id": 1}),
            )
        self.assertIn("repos/{owner}/{repo}/labels", seen[0])
        self.assertIn("--hostname", seen[0])

    def test_empty_204_response_is_accepted(self):
        response = subprocess.CompletedProcess([], 0, "HTTP/2.0 204 No Content\n\n", "")
        with patch.object(policy.subprocess, "run", return_value=response):
            self.assertEqual(policy.GitHub().request("alerts", allowed=(204, 404)), (204, None))

    def test_403_is_not_interpreted_as_disabled(self):
        response = subprocess.CompletedProcess(
            [],
            1,
            'HTTP/2.0 403 Forbidden\n\n{"message":"private"}',
            "sensitive diagnostic",
        )
        with patch.object(policy.subprocess, "run", return_value=response):
            with self.assertRaisesRegex(policy.PolicyError, "HTTP 403") as error:
                policy.GitHub().request("alerts", allowed=(204, 404))
        self.assertNotIn("sensitive", str(error.exception))

    def test_missing_optional_endpoint_can_be_404(self):
        response = subprocess.CompletedProcess(
            [], 1, 'HTTP/2.0 404 Not Found\n\n{"message":"missing"}', ""
        )
        with patch.object(policy.subprocess, "run", return_value=response):
            self.assertEqual(policy.GitHub().request("alerts", allowed=(204, 404))[0], 404)

    def test_timeout_and_malformed_response_fail(self):
        with patch.object(
            policy.subprocess, "run", side_effect=subprocess.TimeoutExpired("gh", 60)
        ):
            with self.assertRaises(policy.PolicyError):
                policy.GitHub().get("repo")
        response = subprocess.CompletedProcess([], 0, "not an HTTP response", "")
        with patch.object(policy.subprocess, "run", return_value=response):
            with self.assertRaises(policy.PolicyError):
                policy.GitHub().get("repo")


if __name__ == "__main__":
    unittest.main()
