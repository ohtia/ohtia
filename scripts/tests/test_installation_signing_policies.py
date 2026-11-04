"""Check the offline access preview's least-privilege and disclosure contracts."""

import copy
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from fnmatch import fnmatchcase
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_signing_policies as policies

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "config/installation/signing-access.example.json"
SCRIPT = ROOT / "scripts/installation_signing_policies.py"


def allowed(policy, principal, action, resource, *, header=None, secure=True):
    """Evaluate only the emitted subset as a payload oracle, never as provider evidence."""
    for row in policy["Statement"]:
        if row["Principal"] != {"SCW": principal} or action not in row["Action"]:
            continue
        if not any(fnmatchcase(resource, pattern) for pattern in row["Resource"]):
            continue
        attributes = {
            "aws:SecureTransport": "true" if secure else "false",
            "s3:if-none-match": header,
        }
        matches = []
        for operator, clauses in row.get("Condition", {}).items():
            for attribute, expected in clauses.items():
                actual = attributes[attribute]
                if operator == "Null":
                    matches.append((actual is None) == (expected == "true"))
                elif operator in {"Bool", "StringEquals"}:
                    matches.append(actual is not None and actual == expected)
                else:
                    raise AssertionError("Unexpected preview condition operator")
        if not all(matches):
            continue
        return True
    return False


class SigningPolicyTests(unittest.TestCase):
    def setUp(self):
        self.bindings = json.loads(EXAMPLE.read_bytes())
        self.files = {
            name: json.loads(data) for name, data in policies.render(self.bindings).items()
        }
        self.runtime = "application_id:" + self.bindings["runtime_application_id"]
        self.administrator = "user_id:" + self.bindings["administrator_user_id"]

    def test_invoker_has_only_project_scoped_private_invocation(self):
        value = self.files["iam-invoker.json"]
        self.assertEqual(value["application_id"], self.bindings["invoker_application_id"])
        self.assertEqual(value["organization_id"], self.bindings["organization_id"])
        self.assertEqual(
            value["rules"],
            [
                {
                    "project_ids": [self.bindings["project_id"]],
                    "permission_set_names": ["ContainersPrivateAccess"],
                }
            ],
        )

    def test_runtime_iam_has_no_administration_or_unconditioned_secret_access(self):
        rules = self.files["iam-runtime.json"]["rules"]
        self.assertTrue(
            all(
                r["project_ids"] == [self.bindings["project_id"]] and "organization_id" not in r
                for r in rules
            )
        )
        self.assertEqual(
            {p for r in rules for p in r["permission_set_names"]},
            {
                "ContainersReadOnly",
                "SecretManagerSecretAccess",
                "ObjectStorageObjectsRead",
                "ObjectStorageObjectsWrite",
            },
        )
        secret = next(r for r in rules if "SecretManagerSecretAccess" in r["permission_set_names"])
        self.assertTrue(secret["condition"].startswith("resource.id in "))
        self.assertEqual(
            set(json.loads(secret["condition"].removeprefix("resource.id in "))),
            {v["secret_id"] for v in self.bindings["secret_versions"].values()},
        )

    def test_version_pin_changes_fragment_without_claiming_per_version_iam(self):
        changed = copy.deepcopy(self.bindings)
        changed["secret_versions"]["rpm"]["revision"] = 2
        rendered = policies.render(changed)
        self.assertEqual(
            rendered["iam-runtime.json"], policies.encode(self.files["iam-runtime.json"])
        )
        self.assertEqual(
            json.loads(rendered["runtime-fragment.json"])["secret_versions"]["rpm"]["revision"], 2
        )

    def test_runtime_bucket_access_is_limited_to_exact_data_prefixes(self):
        for role in ("ingress", "retained"):
            policy = self.files["bucket-" + role + ".json"]
            bucket = self.files["runtime-fragment.json"]["buckets"][role]
            self.assertEqual(policy["Version"], "2023-04-17")
            for row in policy["Statement"]:
                self.assertEqual(row["Effect"], "Allow")
                self.assertIn(
                    row["Principal"], [{"SCW": self.runtime}, {"SCW": self.administrator}]
                )
                self.assertLessEqual(set(row["Action"]), {"s3:GetObject", "s3:PutObject"})
            prefixes = ("objects",) if role == "ingress" else ("objects", "journal", "tokens")
            for prefix in prefixes:
                self.assertTrue(
                    allowed(
                        policy, self.runtime, "s3:GetObject", bucket + "/" + prefix + "/fixture"
                    )
                )
                self.assertTrue(
                    allowed(
                        policy,
                        self.runtime,
                        "s3:PutObject",
                        bucket + "/" + prefix + "/fixture",
                        header="*",
                    )
                )
            for resource in (bucket + "/elsewhere/fixture", "other-bucket/objects/fixture", bucket):
                for action in (
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:ListBucket",
                    "s3:DeleteObject",
                    "s3:PutBucketPolicy",
                ):
                    self.assertFalse(allowed(policy, self.runtime, action, resource, header="*"))
            self.assertFalse(
                allowed(
                    policy, "application_id:foreign", "s3:GetObject", bucket + "/objects/fixture"
                )
            )
            self.assertFalse(
                allowed(
                    policy, self.runtime, "s3:GetObject", bucket + "/objects/fixture", secure=False
                )
            )

    def test_put_requires_exact_create_only_header_and_never_grants_delete_or_list(self):
        for role in ("ingress", "retained"):
            policy = self.files["bucket-" + role + ".json"]
            resource = self.files["runtime-fragment.json"]["buckets"][role] + "/objects/fixture"
            for header in (None, "", '"etag"', "wrong"):
                self.assertFalse(
                    allowed(policy, self.runtime, "s3:PutObject", resource, header=header)
                )
            for action in (
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:PutObjectAcl",
                "s3:GetObjectVersion",
                "s3:PutBucketPolicy",
            ):
                self.assertFalse(allowed(policy, self.runtime, action, resource, header="*"))
            self.assertFalse(
                allowed(policy, self.runtime, "s3:PutObject", resource, header="*", secure=False)
            )

    def test_control_is_read_only_for_runtime_and_writable_only_by_named_administrator(self):
        policy = self.files["bucket-retained.json"]
        bucket = self.files["runtime-fragment.json"]["buckets"]["retained"]
        control = bucket + "/control/active.json"
        self.assertTrue(allowed(policy, self.runtime, "s3:GetObject", control))
        self.assertFalse(allowed(policy, self.runtime, "s3:PutObject", control, header="*"))
        self.assertTrue(allowed(policy, self.administrator, "s3:PutObject", control))
        self.assertFalse(
            allowed(policy, self.administrator, "s3:PutObject", bucket + "/control/other.json")
        )
        self.assertFalse(allowed(policy, self.administrator, "s3:DeleteObject", control))
        self.assertEqual(
            {action for row in policy["Statement"] for action in row["Action"]},
            {"s3:GetObject", "s3:PutObject"},
        )
        self.assertFalse(allowed(policy, self.runtime, "s3:GetBucketPolicy", bucket))

    def test_rejects_unknown_fields_credentials_and_principal_aliasing(self):
        for change in (
            lambda b: b.update(secret_key="never-log-this-secret"),
            lambda b: b.update(runtime_application_id=b["invoker_application_id"]),
            lambda b: b.update(administrator_user_id=b["runtime_application_id"]),
            lambda b: b.update(schema_version=True),
            lambda b: b.update(secret_versions={}),
            lambda b: b["secret_versions"]["rpm"].update(data="private-key"),
        ):
            b = copy.deepcopy(self.bindings)
            change(b)
            with self.subTest(change=change), self.assertRaises(ValueError):
                policies.render(b)

    def test_refuses_injected_noncanonical_or_nil_resource_ids(self):
        for field in (*policies.IDENTITIES, "secret_id"):
            for item in (
                "*",
                "invalid",
                "../escape",
                'id"] || true',
                "00000000-0000-0000-0000-000000000000",
                "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
                None,
                1,
            ):
                b = copy.deepcopy(self.bindings)
                target = b["secret_versions"]["rpm"] if field == "secret_id" else b
                target[field] = item
                with (
                    self.subTest(field=field, item=item),
                    self.assertRaises((ValueError, TypeError)),
                ):
                    policies.render(b)

    def test_refuses_aliases_booleans_out_of_range_revisions_and_reused_secrets(self):
        for value in ("latest", "latest_enabled", "1", True, 0, -1, 4294967296, None):
            b = copy.deepcopy(self.bindings)
            b["secret_versions"]["rpm"]["revision"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                policies.render(b)
        b = copy.deepcopy(self.bindings)
        b["secret_versions"]["rpm"]["secret_id"] = b["secret_versions"]["catalog"]["secret_id"]
        with self.assertRaises(ValueError):
            policies.render(b)

    def test_manifest_binds_every_payload_and_only_fixed_provider_operations(self):
        rendered = policies.render(self.bindings)
        self.assertEqual(rendered, policies.render(copy.deepcopy(self.bindings)))
        manifest = json.loads(rendered["plan.json"])
        self.assertEqual(
            manifest["files"],
            {
                name: hashlib.sha256(raw).hexdigest()
                for name, raw in rendered.items()
                if name != "plan.json"
            },
        )
        self.assertEqual(
            manifest["bindings_sha256"], hashlib.sha256(policies.encode(self.bindings)).hexdigest()
        )
        self.assertTrue(manifest["requires_independent_approval"])
        self.assertEqual(manifest["mode"], "offline-preview")
        self.assertEqual(len(manifest["requests"]), 4)
        self.assertEqual(
            [r["payload"] for r in manifest["requests"]],
            [
                "bucket-ingress.json",
                "bucket-retained.json",
                "iam-runtime.json",
                "iam-invoker.json",
            ],
        )
        for request in manifest["requests"]:
            self.assertIn(request["payload"], manifest["files"])
            if request["method"] == "POST":
                self.assertEqual(request["url"], "https://api.scaleway.com/iam/v1alpha1/policies")
            else:
                self.assertEqual(request["method"], "PUT")
                self.assertIn(
                    request["url"],
                    {
                        f"https://{b}.s3.fr-par.scw.cloud/?policy"
                        for b in self.files["runtime-fragment.json"]["buckets"].values()
                    },
                )

    def test_new_output_permissions_and_existing_output_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview"
            policies.prepare(EXAMPLE, output)
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
                self.assertTrue(
                    all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in output.iterdir())
                )
            with self.assertRaises(FileExistsError):
                policies.prepare(EXAMPLE, output)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})

    def test_bounded_duplicate_free_input_before_any_output(self):
        with tempfile.TemporaryDirectory() as directory:
            input_file = Path(directory) / "bindings.json"
            output = Path(directory) / "preview"
            for data in (
                '{"schema_version":1,"schema_version":1}',
                " " * (policies.MAX_BYTES + 1),
                "[]",
                "invalid",
            ):
                input_file.write_text(data)
                with self.subTest(data=data[:20]), self.assertRaises(ValueError):
                    policies.prepare(input_file, output)
                self.assertFalse(output.exists())

    def test_cli_is_offline_and_errors_never_echo_input_or_ambient_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview"
            env = {
                **os.environ,
                "SCW_SECRET_KEY": "never-log-this-secret",
                "AWS_SECRET_ACCESS_KEY": "never-log-this-secret",
            }
            args = [
                sys.executable,
                str(SCRIPT),
                "--bindings",
                str(EXAMPLE),
                "--output",
                str(output),
            ]
            result = subprocess.run(args, env=env, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertNotIn(
                "never-log-this-secret",
                result.stdout + result.stderr + "".join(p.read_text() for p in output.iterdir()),
            )
            bad = Path(directory) / "bad.json"
            b = copy.deepcopy(self.bindings)
            b["secret_key"] = "never-log-this-secret"
            bad.write_text(json.dumps(b))
            for extra in (["--apply", "never-log-this-secret"], ["--bindings", str(bad)]):
                result = subprocess.run(
                    [*args, *extra], env=env, capture_output=True, text=True, check=False
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("never-log-this-secret", result.stdout + result.stderr)
                self.assertNotIn("Traceback", result.stderr)
