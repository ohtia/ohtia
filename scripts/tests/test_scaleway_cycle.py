"""Exercise lease ownership, write uncertainty, cleanup and workflow evidence without cloud access."""

from __future__ import annotations

import base64
import contextlib
import copy
import datetime as dt
import gzip
import hashlib
import http.client
import io
import json
import lzma
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_native
import scaleway_bootstrap as bootstrap
import scaleway_build as build
import scaleway_cycle as cycle
import scaleway_evidence as evidence_archive
import scaleway_guest as guest_probe
import scaleway_qualification as qualification
import scaleway_restore as restoration
from scaleway_ledger import GitHub

PROJECT = "00000000-0000-4000-8000-000000000001"
IMAGE = "00000000-0000-4000-8000-000000000002"
SNAPSHOT = "00000000-0000-4000-8000-000000000003"
TOKEN = "synthetic-credential-for-tests"


def fixtures(profile="fedora-44"):
    settings = {
        "project": PROJECT,
        "project_binding": hashlib.sha256(PROJECT.encode()).hexdigest(),
        "zone": "nl-ams-1",
        "profile": profile,
        "instance_type": "BASIC2-A8C-32G",
        "image_id": IMAGE,
    }
    identity = {
        "repository": "ohtia/ohtia",
        "source_sha": "a" * 40,
        "workflow": cycle.policy()["qualification_workflow"],
        "run_id": "101",
        "attempt": "1",
        "event": "workflow_dispatch",
    }
    extension = cycle.policy()["profiles"][profile]["format"]
    package = {"file": f"ohtia-quality.{extension}", "bytes": 10, "sha256": "b" * 64}
    harness = {"file": "harness.tar.gz", "bytes": 10, "sha256": "c" * 64}
    manifest = {
        "version": 1,
        "identity": identity,
        "profile": profile,
        "cell": cycle.cell(profile),
        "application_version": "0.0.0-dev.101.1",
        "source_tree": "d" * 40,
        "policy_sha256": cycle.digest(cycle.POLICY_PATH),
        "package": package,
        "harness": harness,
        "distribution_qualified": False,
        "publisher_signed": False,
    }
    return settings, cycle.create_intent(identity, settings, manifest, "2026-10-31T00:00:00Z")


class MemoryAPI(cycle.API):
    """A recording provider fixture, not evidence of Scaleway execution."""

    def __init__(self, settings, role="creator"):
        super().__init__(TOKEN, settings, role)
        self.rows = {"server": {}, "root": {}, "ip": {}, "security": {}}
        self.calls, self.fail_after, self.fail_before, self.refuse_delete = [], None, None, None

    def objects(self, kind):
        return copy.deepcopy(list(self.rows["root" if kind == "home" else kind].values()))

    def get(self, kind, resource):
        return copy.deepcopy(self.rows["root" if kind == "home" else kind].get(resource))

    def request(self, method, path, value=None, **kwargs):
        self.calls.append((method, path, copy.deepcopy(value)))
        if method == "GET" and "/products/servers" in path:
            return {
                "servers": {
                    "BASIC2-A8C-32G": {
                        "arch": "arm64",
                        "end_of_service": False,
                        "capabilities": {"block_storage": True},
                    }
                }
            }
        if method == "GET" and "/marketplace/" in path:
            return {
                "id": IMAGE,
                "zone": "nl-ams-1",
                "arch": "arm64",
                "label": "fedora_44",
                "type": "instance_sbs",
                "compatible_commercial_types": ["BASIC2-A8C-32G"],
            }
        if method == "GET" and "/images/" in path:
            return {
                "image": {
                    "id": IMAGE,
                    "arch": "arm64",
                    "root_volume": {
                        "id": SNAPSHOT,
                        "size": 10 * 10**9,
                        "volume_type": "sbs_snapshot",
                    },
                }
            }
        if "/rules" in path or "/user_data/" in path:
            return {}
        if path.endswith("/action"):
            server_id = path.split("/")[-2]
            self.rows["server"][server_id]["state"] = (
                "running" if value["action"] == "poweron" else "stopped"
            )
            return {}
        collection = path.split("/")[-1]
        if method == "POST":
            kind = {
                "servers": "server",
                "volumes": "root",
                "ips": "ip",
                "security_groups": "security",
            }[collection]
            role = next(t.split(":")[1] for t in value["tags"] if t.startswith("ohtia-kind:"))
            if self.fail_before == role:
                raise cycle.CycleError("uncertain_provider_write")
            resource = str(uuid.uuid4())
            obj = {**value, "id": resource}
            if kind == "root":
                obj.update(
                    {
                        "size": next(v["size"] for k, v in value.items() if k.startswith("from_")),
                        "status": "available",
                        "references": [],
                        "specs": {"perf_iops": value["perf_iops"]},
                    }
                )
            if kind == "server":
                obj.update(
                    {
                        "arch": "arm64",
                        "state": "stopped",
                        "public_ips": [{"id": value["public_ips"][0]}],
                        "security_group": {"id": value["security_group"]},
                    }
                )
                self.rows["ip"][value["public_ips"][0]]["server"] = {"id": resource}
                for volume in value["volumes"].values():
                    self.rows["root"][volume["id"]]["references"] = [{"id": resource}]
                self.rows["security"][value["security_group"]]["servers"] = [{"id": resource}]
            if kind == "ip":
                obj.update({"address": "8.8.8.8", "server": None})
            if kind == "security":
                obj["servers"] = []
            self.rows[kind][resource] = obj
            if self.fail_after == role:
                raise cycle.CycleError("uncertain_provider_write")
            key = {"server": "server", "ip": "ip", "security": "security_group"}.get(kind)
            return {key: copy.deepcopy(obj)} if key else copy.deepcopy(obj)
        if method == "DELETE":
            kind = (
                "root"
                if "/block/" in path
                else "server"
                if "/servers/" in path
                else "ip"
                if "/ips/" in path
                else "security"
            )
            if self.refuse_delete == kind:
                raise cycle.CycleError("provider_refused")
            self.rows[kind].pop(collection, None)
            if kind == "server":
                for volume in self.rows["root"].values():
                    volume["references"] = []
                for ip in self.rows["ip"].values():
                    ip["server"] = None
                for group in self.rows["security"].values():
                    group["servers"] = []
            return {}
        raise AssertionError((method, path))


class CycleTests(unittest.TestCase):
    def setUp(self):
        self.settings, self.intent = fixtures()
        self.api = MemoryAPI(self.settings)
        self.events = []
        self.key = "ssh-ed25519 " + "A" * 64
        self.config = lambda resources: b"#cloud-config\n{}\n"

    def create(self):
        return self.api.create(
            self.intent,
            self.key,
            self.config,
            lambda event: self.events.append(copy.deepcopy(event)),
        )

    def test_storage_is_32_decimal_gb_split_without_extra_capacity(self):
        resources = self.create()
        volumes = [self.api.get(kind, resources[kind]) for kind in ("root", "home")]
        self.assertEqual(sorted(v["size"] for v in volumes), [10_000_000_000, 22_000_000_000])
        self.assertEqual(sum(v["size"] for v in volumes), 32_000_000_000)
        self.assertTrue(all(v["specs"]["perf_iops"] == 5000 for v in volumes))
        self.assertEqual(set(resources), set(cycle.KINDS))

    def test_each_allocation_has_a_prior_journal_and_its_returned_uuid(self):
        resources = self.create()
        self.assertEqual([e["stage"] for e in self.events], ["write_intent", "allocated"] * 5)
        for before, after in zip(self.events[::2], self.events[1::2]):
            self.assertNotIn(before["kind"], before["resources"])
            self.assertEqual(after["resources"][after["kind"]], resources[after["kind"]])

    def test_lost_create_response_is_not_retried_and_is_discoverable(self):
        self.api.fail_after = "home"
        with self.assertRaisesRegex(cycle.CycleError, "uncertain_provider_write"):
            self.create()
        self.assertEqual(self.events[-1]["stage"], "write_intent")
        self.assertEqual(
            len([c for c in self.api.calls if c[0] == "POST" and "/block/" in c[1]]), 2
        )
        self.assertEqual(set(self.api.discover(self.intent)), {"security", "root", "home"})
        receipt = self.api.cleanup(self.intent, time.monotonic() + 10)
        self.assertEqual(receipt["status"], "absent")
        self.assertTrue(all(not rows for rows in self.api.rows.values()))

    def test_absent_response_to_an_uncertain_post_does_not_justify_retry(self):
        self.api.fail_before = "home"
        with self.assertRaisesRegex(cycle.CycleError, "uncertain_provider_write"):
            self.create()
        self.assertNotIn("home", self.api.discover(self.intent))
        self.assertEqual(self.events[-1]["kind"], "home")
        self.assertEqual(self.events[-1]["stage"], "write_intent")

    def test_cleanup_releases_server_both_volumes_ip_and_network_policy(self):
        resources = self.create()
        with patch.object(cycle.time, "sleep"):
            receipt = self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)
        self.assertEqual(receipt["resources"], resources)
        self.assertFalse(receipt["distribution_qualified"])
        deleted = [path for method, path, _ in self.api.calls if method == "DELETE"]
        self.assertEqual(len(deleted), 5)
        self.assertTrue(deleted[0].endswith(resources["server"]))
        self.assertEqual(
            self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)["status"],
            "absent",
        )

    def test_changed_tags_on_a_recorded_resource_refuse_deletion_and_absence(self):
        resources = self.create()
        self.api.rows["root"][resources["home"]]["tags"] = []
        with self.assertRaisesRegex(cycle.CycleError, "resource_ownership"):
            self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)
        self.assertFalse(any(method == "DELETE" for method, _, _ in self.api.calls))

    def test_stopped_in_place_is_powered_off_before_deletion(self):
        resources = self.create()
        self.api.rows["server"][resources["server"]]["state"] = "stopped in place"
        with patch.object(cycle.time, "sleep"):
            self.assertEqual(
                self.api.cleanup(self.intent, time.monotonic() + 10)["status"], "absent"
            )
        self.assertTrue(
            any(
                method == "POST" and body == {"action": "poweroff"}
                for method, _, body in self.api.calls
            )
        )

    def test_old_lease_uses_its_frozen_resource_facts_after_policy_changes(self):
        resources = self.create()
        changed = copy.deepcopy(cycle.policy())
        changed["name_prefix"] = "replacement"
        changed["storage"].update(
            {"root_bytes": 16_000_000_000, "home_bytes": 16_000_000_000, "perf_iops": 15000}
        )
        changed["limits"].update(
            {
                "test_seconds": 30,
                "cleanup_seconds": 30,
                "lease_seconds": 120,
                "guest_shutdown_seconds": 60,
                "evidence_seconds": 5,
                "maximum_package_bytes": 1,
            }
        )
        changed["profiles"].pop("fedora-44")
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary).resolve() / "policy.json"
            cycle.write(file, changed)
            with patch.object(cycle, "POLICY_PATH", file), patch.object(cycle.time, "sleep"):
                receipt = self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)
                self.assertEqual(receipt["status"], "absent")
                with self.assertRaises(cycle.CycleError):
                    cycle.validate_intent(self.intent, self.settings)

    def test_deleted_volume_tombstone_is_not_an_active_allocation(self):
        resources = self.create()
        original_request, original_objects = self.api.request, self.api.objects

        def request(method, path, value=None, **kwargs):
            if method == "DELETE" and "/block/" in path:
                self.api.rows["root"][path.split("/")[-1]]["status"] = "deleted"
                self.api.calls.append((method, path, value))
                return {}
            return original_request(method, path, value, **kwargs)

        def objects(kind):
            return [row for row in original_objects(kind) if row.get("status") != "deleted"]

        with (
            patch.object(self.api, "request", side_effect=request),
            patch.object(self.api, "objects", side_effect=objects),
            patch.object(cycle.time, "sleep"),
        ):
            self.assertEqual(
                self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)["status"],
                "absent",
            )
            self.assertEqual(
                self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)["status"],
                "absent",
            )
        self.assertTrue(all(row["status"] == "deleted" for row in self.api.rows["root"].values()))

    def test_foreign_volume_attachment_refuses_even_server_deletion(self):
        resources = self.create()
        self.api.rows["server"][resources["server"]]["volumes"]["2"] = {"id": str(uuid.uuid4())}
        with self.assertRaisesRegex(cycle.CycleError, "unexpected_attachment"):
            self.api.cleanup(self.intent, time.monotonic() + 10)
        self.assertFalse(any(method == "DELETE" for method, _, _ in self.api.calls))

    def test_foreign_network_attachment_refuses_deletion(self):
        resources = self.create()
        self.api.rows["server"][resources["server"]]["public_ips"].append({"id": str(uuid.uuid4())})
        with self.assertRaisesRegex(cycle.CycleError, "unexpected_network_attachment"):
            self.api.cleanup(self.intent, time.monotonic() + 10)

    def test_partial_delete_failure_stays_failed_and_can_resume(self):
        resources = self.create()
        self.api.refuse_delete = "root"
        with (
            patch.object(cycle.time, "sleep"),
            self.assertRaisesRegex(cycle.CycleError, "provider_refused"),
        ):
            self.api.cleanup(self.intent, time.monotonic() + 10)
        self.assertFalse(self.api.rows["server"])
        self.assertTrue(self.api.rows["root"])
        self.api.refuse_delete = None
        self.assertEqual(
            self.api.cleanup(self.intent, time.monotonic() + 10, known=resources)["status"],
            "absent",
        )

    def test_occupied_project_refuses_the_first_paid_write(self):
        self.api.rows["server"][str(uuid.uuid4())] = {"project": PROJECT}
        with self.assertRaisesRegex(cycle.CycleError, "project_not_empty"):
            self.create()
        self.assertFalse(any(method != "GET" for method, _, _ in self.api.calls))

    def test_mismatched_profile_or_public_key_refuses_allocation(self):
        for change in ("profile", "key"):
            with self.subTest(change=change):
                settings = dict(self.settings)
                settings["instance_type"] = (
                    "unapproved" if change == "profile" else settings["instance_type"]
                )
                api = MemoryAPI(settings)
                with self.assertRaises(cycle.CycleError):
                    api.create(
                        self.intent,
                        "injected\nkey" if change == "key" else self.key,
                        self.config,
                        lambda _: None,
                    )
                self.assertFalse(any(method != "GET" for method, _, _ in api.calls))

    def test_manifest_rejects_fake_attempts_wrong_arch_and_changed_bytes(self):
        original = self.intent["build"]
        for path, value in (
            (("application_version",), "0.0.0-dev.101.2"),
            (("cell",), "linux-x64"),
            (("publisher_signed",), True),
            (("package", "bytes"), True),
            (("package", "file"), "../package.rpm"),
        ):
            with self.subTest(path=path):
                manifest = copy.deepcopy(original)
                target = manifest
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaises(cycle.CycleError):
                    cycle.validate_build(manifest)

    def test_cleanup_transport_cannot_allocate_resize_patch_or_poweron(self):
        api = cycle.API(TOKEN, self.settings, "cleanup")
        prefix = "/instance/v1/zones/nl-ams-1/"
        for method, path, value in [
            ("POST", prefix + "servers", {}),
            ("POST", prefix + "servers/" + IMAGE + "/action", {"action": "poweron"}),
            ("PATCH", "/block/v1/zones/nl-ams-1/volumes/" + IMAGE, {}),
            ("DELETE", prefix + "images/" + IMAGE, None),
            ("GET", "/instance/v1/zones/fr-par-1/servers", None),
        ]:
            with (
                self.subTest(method=method, path=path),
                patch.object(cycle.http.client, "HTTPSConnection") as connection,
            ):
                with self.assertRaises(cycle.CycleError):
                    api.request(method, path, value)
                connection.assert_not_called()

    def test_legacy_gib_setting_is_not_silently_reinterpreted(self):
        values = {
            "SCW_PROJECT_ID": PROJECT,
            "SCW_ARM_ZONE": "nl-ams-1",
            "SCW_ARM_INSTANCE_TYPE": "BASIC2-A8C-32G",
            "SCW_ARM_FEDORA44_IMAGE_ID": IMAGE,
            "SCW_ARM_DISK_GIB": "32",
        }
        with patch.dict(os.environ, values, clear=True):
            with self.assertRaisesRegex(cycle.CycleError, "storage_configuration"):
                cycle.configuration("fedora-44")
            with patch.dict(os.environ, {"SCW_ARM_DISK_GB": "32"}):
                self.assertEqual(cycle.configuration("fedora-44")["image_id"], IMAGE)

    def test_subprocess_environment_excludes_all_provider_and_github_secrets(self):
        with patch.dict(
            os.environ,
            {
                "SCW_SECRET_KEY": "private",
                "GITHUB_TOKEN": "github-secret",
                "SSH_AUTH_SOCK": "agent",
                "NODE_OPTIONS": "injection",
                "PYTHONPATH": "injection",
            },
            clear=False,
        ):
            ordinary = cycle.process_environment()
            self.assertFalse(
                set(ordinary)
                & {
                    "SCW_SECRET_KEY",
                    "GITHUB_TOKEN",
                    "GH_TOKEN",
                    "SSH_AUTH_SOCK",
                    "NODE_OPTIONS",
                    "PYTHONPATH",
                }
            )
            authenticated = cycle.process_environment(github=True)
            self.assertEqual(authenticated["GH_TOKEN"], "github-secret")
            self.assertNotIn("SCW_SECRET_KEY", authenticated)

    def test_cloud_config_has_early_shutdown_no_guest_sudo_and_uuid_bound_home(self):
        resources = {kind: str(uuid.uuid4()) for kind in cycle.KINDS}
        value = json.loads(
            qualification.cloud_config(self.intent, resources, self.key).decode().split("\n", 1)[1]
        )
        account = next(u for u in value["users"] if u["name"] == "ohtia-quality")
        self.assertIsNone(account["sudo"])
        self.assertTrue(account["lock_passwd"])
        self.assertNotIn("ssh_authorized_keys", account)
        self.assertEqual(value["bootcmd"][0][-2:], ["/usr/bin/systemctl", "poweroff"])
        guard = json.loads(
            next(f["content"] for f in value["write_files"] if f["path"] == str(cycle.GUARD))
        )
        self.assertEqual(guard["resources"], resources)
        self.assertEqual(guard["home_bytes"], 10_000_000_000)
        self.assertNotIn("SCW_SECRET_KEY", json.dumps(value))

    def test_cloud_config_supplies_native_key_before_scaleway_refresh(self):
        public_key = self.key + " ohtia-qualification\n"
        resources = {kind: str(uuid.uuid4()) for kind in cycle.KINDS}
        for profile in cycle.policy()["profiles"]:
            with self.subTest(profile=profile):
                _, intent = fixtures(profile)
                value = json.loads(
                    qualification.cloud_config(intent, resources, public_key)
                    .decode()
                    .split("\n", 1)[1]
                )
                keys = [
                    entry
                    for entry in value["write_files"]
                    if entry["path"] == "/root/.ssh/instance_keys"
                ]
                self.assertEqual(len(keys), 1)
                key = keys[0]
                self.assertEqual(key["owner"], "root:root")
                self.assertEqual(key["permissions"], "0600")
                self.assertEqual(key["content"], public_key.strip() + "\n")
                self.assertFalse(key.get("defer", False))
                self.assertFalse(key.get("append", False))
                account = next(user for user in value["users"] if user["name"] == "root")
                self.assertEqual(account["ssh_authorized_keys"], [public_key.strip()])

    def test_ssh_never_accepts_unknown_keys_or_forwards_agents(self):
        values = qualification.ssh_options(Path("/tmp/key"), Path("/tmp/known"))
        self.assertIn("StrictHostKeyChecking=yes", values)
        self.assertIn("IdentityAgent=none", values)
        self.assertIn("ForwardAgent=no", values)
        self.assertNotIn("StrictHostKeyChecking=accept-new", values)

    def test_host_key_waits_for_owned_ip_attachment_and_uses_api_fingerprint(self):
        resources = self.create()
        with tempfile.TemporaryDirectory() as temporary:
            key = Path(temporary).resolve() / "identity"
            original_get = self.api.get
            calls = []

            def get(kind, resource):
                value = original_get(kind, resource)
                if kind == "ip" and not calls:
                    calls.append(kind)
                    value["server"] = None
                return value

            scan = b"8.8.8.8 ssh-ed25519 " + b"A" * 64 + b"\n"
            fingerprint = b"SHA256:" + b"B" * 43
            outputs = [
                subprocess.CompletedProcess([], 0, scan),
                subprocess.CompletedProcess([], 0, b"256 " + fingerprint + b" fixture ED25519"),
            ]
            with (
                patch.object(self.api, "get", side_effect=get),
                patch.object(self.api, "request", return_value=fingerprint),
                patch.object(cycle, "command", side_effect=outputs) as command,
                patch.object(cycle.time, "sleep") as sleeping,
            ):
                address, known = qualification.host_key(
                    self.api, self.intent, resources, key, time.monotonic() + 10
                )
            self.assertEqual(address, "8.8.8.8")
            self.assertEqual(known.read_bytes(), scan)
            self.assertEqual(command.call_count, 2)
            sleeping.assert_called_once()

    def test_untrusted_host_key_is_rejected_without_creating_known_hosts(self):
        resources = self.create()
        with tempfile.TemporaryDirectory() as temporary:
            key = Path(temporary).resolve() / "identity"
            outputs = [
                subprocess.CompletedProcess([], 0, b"8.8.8.8 ssh-ed25519 " + b"A" * 64 + b"\n"),
                subprocess.CompletedProcess(
                    [], 0, b"256 SHA256:" + b"C" * 43 + b" fixture ED25519"
                ),
            ]
            with (
                patch.object(self.api, "request", return_value=b"SHA256:" + b"B" * 43),
                patch.object(cycle, "command", side_effect=outputs),
                self.assertRaisesRegex(cycle.CycleError, "host_key_mismatch"),
            ):
                qualification.host_key(self.api, self.intent, resources, key, time.monotonic() + 10)
            self.assertFalse((key.parent / "known_hosts").exists())

    def test_enablement_requires_the_exact_reviewed_policy_hash(self):
        with patch.dict(
            os.environ,
            {
                "SCW_CYCLE_ENABLED": "true",
                "SCW_RECOVERY_ENABLED": "true",
                "SCW_APPROVED_POLICY_SHA256": "0" * 64,
            },
            clear=True,
        ):
            with self.assertRaisesRegex(cycle.CycleError, "cycle_not_enabled"):
                qualification.enabled()
        with patch.dict(
            os.environ,
            {
                "SCW_CYCLE_ENABLED": "true",
                "SCW_RECOVERY_ENABLED": "true",
                "SCW_APPROVED_POLICY_SHA256": cycle.digest(cycle.POLICY_PATH),
            },
            clear=True,
        ):
            qualification.enabled()

    def test_creator_requires_both_expiries_with_recovery_margin(self):
        now = cycle.timestamp(cycle.utc())
        values = {
            key: (now + dt.timedelta(days=3)).isoformat()
            for key in ("SCW_CREATOR_KEY_EXPIRES_AT", "SCW_CLEANUP_KEY_EXPIRES_AT")
        }
        with patch.dict(os.environ, values, clear=True):
            qualification.key_lifetimes()
            with patch.dict(
                os.environ,
                {"SCW_CLEANUP_KEY_EXPIRES_AT": (now + dt.timedelta(hours=1)).isoformat()},
            ):
                with self.assertRaisesRegex(cycle.CycleError, "key_expiry_margin"):
                    qualification.key_lifetimes()

    def test_suspending_creation_keeps_independent_recovery_enabled(self):
        with patch.dict(
            os.environ,
            {
                "SCW_CYCLE_ENABLED": "false",
                "SCW_RECOVERY_ENABLED": "true",
                "SCW_APPROVED_POLICY_SHA256": cycle.digest(cycle.POLICY_PATH),
            },
            clear=True,
        ):
            qualification.enabled(recovery=True)
            with self.assertRaisesRegex(cycle.CycleError, "cycle_not_enabled"):
                qualification.enabled()

    def test_github_hosted_flag_cannot_bypass_a_cloud_guard(self):
        with (
            patch.dict(
                os.environ, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted"}
            ),
            patch("scaleway_guest.admit_guest", side_effect=cycle.CycleError("guest_not_ready")),
        ):
            with self.assertRaisesRegex(cycle.CycleError, "guest_not_ready"):
                quality_native.host_matches(cycle.cell("fedora-44"), external_guard={})


class TransportTests(unittest.TestCase):
    def response(self, data=b"{}", status=200, remaining=0):
        response = Mock(status=status, length=remaining)
        response.getheader.side_effect = lambda name, default=None: default
        response.read1.side_effect = [data, b""]
        connection = Mock(sock=None)
        connection.getresponse.return_value = response
        return connection

    def test_userdata_uses_the_documented_text_plain_transport(self):
        settings, _ = fixtures()
        connection = self.response(data=b"", status=204)
        with patch.object(cycle.http.client, "HTTPSConnection", return_value=connection):
            cycle.API(TOKEN, settings, "creator").request(
                "PATCH",
                "/instance/v1/zones/nl-ams-1/servers/"
                + str(uuid.uuid4())
                + "/user_data/cloud-init",
                b"#cloud-config\n{}",
            )
        self.assertEqual(
            connection.request.call_args.kwargs["headers"]["Content-Type"], "text/plain"
        )

    def test_restoration_transport_rejects_all_provider_writes(self):
        settings, _ = fixtures()
        api = cycle.API(TOKEN, settings, "observer")
        with patch.object(cycle.http.client, "HTTPSConnection") as connection:
            for method in ("POST", "PATCH", "DELETE"):
                with (
                    self.subTest(method=method),
                    self.assertRaisesRegex(cycle.CycleError, "observer_write_forbidden"),
                ):
                    api.request(method, api.path("server", str(uuid.uuid4())), {})
        connection.assert_not_called()

    def test_truncated_framed_body_and_redirects_fail_without_retry(self):
        settings, _ = fixtures()
        for connection in (self.response(b"{}", remaining=3), self.response(status=302)):
            with (
                self.subTest(),
                patch.object(
                    cycle.http.client, "HTTPSConnection", return_value=connection
                ) as factory,
            ):
                with self.assertRaises(cycle.CycleError):
                    cycle.API(TOKEN, settings, "creator").request(
                        "GET", "/instance/v1/zones/nl-ams-1/servers"
                    )
                self.assertEqual(factory.call_count, 1)
                self.assertEqual(connection.request.call_count, 1)
                connection.close.assert_called_once()

    def test_uncertain_post_does_not_retry_or_expose_provider_bodies(self):
        settings, _ = fixtures()
        connection = Mock()
        connection.request.side_effect = http.client.RemoteDisconnected("secret response text")
        with patch.object(cycle.http.client, "HTTPSConnection", return_value=connection):
            with self.assertRaisesRegex(cycle.CycleError, "^uncertain_provider_write$"):
                cycle.API(TOKEN, settings, "creator").request(
                    "POST", "/instance/v1/zones/nl-ams-1/servers", {}
                )
            self.assertEqual(connection.request.call_count, 1)

    def test_expired_operation_deadline_prevents_a_request(self):
        settings, _ = fixtures()
        api = cycle.API(TOKEN, settings, "cleanup")
        api.deadline = time.monotonic() - 1
        with (
            patch.object(cycle.http.client, "HTTPSConnection") as connection,
            self.assertRaisesRegex(cycle.CycleError, "provider_operation_deadline"),
        ):
            api.request("GET", api.path("server"))
        connection.assert_not_called()


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.settings, self.intent = fixtures()
        self.api = MemoryAPI(self.settings)
        self.identity = {
            **self.intent["identity"],
            "workflow": cycle.policy()["cleanup_workflow"],
            "run_id": "999",
            "event": "workflow_dispatch",
        }
        self.gh = Mock(spec=GitHub)
        self.gh.unallocated.return_value = []
        self.gh.completed_ledger.return_value = {"leases": []}
        self.producer = {"id": 101, "status": "completed", "run_attempt": 1}
        self.gh.intents.return_value = [(self.intent, self.producer)]
        self.gh.journal.return_value = None
        self.gh.prior_recovery.return_value = None
        self.gh.run.return_value = {"created_at": self.intent["created_at"]}
        self.gh.provider_attempted.return_value = True
        self.enterContext(patch.object(qualification, "enabled"))
        self.enterContext(patch.object(cycle, "source_context", return_value=self.identity))
        self.enterContext(patch.object(cycle, "configuration", return_value=self.settings))
        self.enterContext(patch.object(cycle, "API", return_value=self.api))
        self.enterContext(patch.object(cycle.time, "sleep"))

    def create(self):
        return self.api.create(
            self.intent, "ssh-ed25519 " + "A" * 64, lambda _: b"{}", lambda _: None
        )

    def recover(self):
        self.api.role = "cleanup"
        plan = self.root / ("plan-" + str(uuid.uuid4()))
        qualification.prepare_recovery(self.gh, plan)
        self.last_plan = cycle.read(plan / "plan.json")
        self.gh.artifacts.return_value = [{"name": self.last_plan["artifact_name"]}]
        self.gh.artifact.return_value = self.last_plan
        qualification.recover(self.gh, self.root / "result", plan / "plan.json")
        return cycle.read(self.root / "result/recovery.json")

    def test_completed_failed_producer_is_reclaimed_without_another_approval(self):
        resources = self.create()
        self.gh.journal.return_value = {
            "resources": resources,
            "allocation_resolved": True,
            "native_smoke_passed": True,
        }
        result = self.recover()
        receipt = result["leases"][0]["receipt"]
        self.assertEqual(receipt["status"], "absent")
        self.assertTrue(receipt["independent_deletion_observed"])
        self.assertTrue(receipt["native_smoke_passed"])
        self.assertEqual(result["status"], "passed")
        self.assertEqual(self.producer["status"], "completed")
        self.assertFalse(any(rows for rows in self.api.rows.values()))

    def test_cancelled_before_provider_step_records_no_allocation(self):
        self.gh.provider_attempted.return_value = False
        result = self.recover()
        self.assertTrue(result["leases"][0]["receipt"]["allocation_resolved"])
        self.assertFalse(any(method != "GET" for method, _, _ in self.api.calls))

    def test_recovery_created_before_a_completed_lease_can_still_reclaim_it(self):
        self.create()
        self.api.calls.clear()
        self.gh.run.return_value = {"created_at": "2026-10-30T00:00:00Z"}
        result = self.recover()
        self.assertEqual(result["deferred"], [])
        self.assertEqual(result["leases"][0]["receipt"]["status"], "absent")
        self.assertFalse(any(rows for rows in self.api.rows.values()))

    def test_active_unexpired_producer_is_deferred(self):
        self.create()
        self.producer["status"] = "in_progress"
        with patch.object(cycle, "utc", return_value=self.intent["created_at"]):
            result = self.recover()
        self.assertEqual(result["deferred"], [self.intent["nonce"]])
        self.assertEqual(result["leases"], [])
        self.assertFalse(any(method == "DELETE" for method, _, _ in self.api.calls))

    def test_expired_active_producer_is_reclaimed_without_a_journal(self):
        self.create()
        self.producer["status"] = "in_progress"
        with patch.object(cycle, "utc", return_value=self.intent["expires_at"]):
            result = self.recover()
        self.assertTrue(result["leases"][0]["receipt"]["allocation_resolved"])
        self.assertFalse(result["leases"][0]["receipt"]["native_smoke_passed"])

    def test_missing_journal_and_partial_allocation_stays_quarantined(self):
        self.api.fail_after = "home"
        with self.assertRaises(cycle.CycleError):
            self.create()
        with self.assertRaisesRegex(cycle.CycleError, "uncertain_allocation_quarantined"):
            self.recover()
        result = cycle.read(self.root / "result/recovery.json")
        self.assertEqual(result["status"], "quarantined")
        self.assertFalse(any(rows for rows in self.api.rows.values()))
        self.assertFalse(result["leases"][0]["receipt"]["allocation_resolved"])

    def test_uncertain_create_is_resolved_only_when_its_resource_is_observed(self):
        self.api.fail_after = "home"
        with self.assertRaises(cycle.CycleError):
            self.create()
        self.gh.journal.return_value = {
            "resources": {},
            "allocation_resolved": False,
            "in_flight": "home",
        }
        self.assertEqual(self.recover()["status"], "passed")

    def test_foreign_project_resource_is_never_deleted_to_obtain_health(self):
        self.gh.intents.return_value = []
        resource = str(uuid.uuid4())
        self.api.rows["server"][resource] = {"id": resource, "project": PROJECT, "tags": []}
        with self.assertRaisesRegex(cycle.CycleError, "untracked_project_resource"):
            self.recover()
        self.assertIn(resource, self.api.rows["server"])
        self.assertFalse(any(method == "DELETE" for method, _, _ in self.api.calls))

    def test_controller_refuses_a_build_tree_that_differs_from_its_checkout(self):
        build_directory = self.root / "build"
        build_directory.mkdir()
        cycle.write(build_directory / "build.json", self.intent["build"])
        creator = self.intent["identity"]
        self.gh.intents.return_value = []
        with (
            patch.object(cycle, "source_context", return_value=creator),
            patch.object(qualification, "key_lifetimes"),
            patch.object(
                cycle, "command", return_value=subprocess.CompletedProcess([], 0, b"e" * 40 + b"\n")
            ),
            self.assertRaisesRegex(cycle.CycleError, "controller_build_identity"),
        ):
            qualification.prepare(self.gh, "fedora-44", self.root / "intent", build_directory)
        self.assertFalse((self.root / "intent").exists())
        self.assertFalse(any(method != "GET" for method, _, _ in self.api.calls))

    def test_partial_recovery_keeps_all_observed_ids_and_native_proof(self):
        resources = self.create()
        self.gh.journal.return_value = {
            "resources": resources,
            "allocation_resolved": True,
            "native_smoke_passed": True,
        }
        self.api.refuse_delete = "root"
        with self.assertRaisesRegex(cycle.CycleError, "provider_refused"):
            self.recover()
        preserved = self.last_plan["items"][0]
        self.assertTrue(preserved["observed_full"])
        self.assertFalse(self.api.rows["server"])
        self.api.refuse_delete = None
        self.gh.journal.return_value = None
        self.gh.prior_recovery.return_value = preserved
        result = self.recover()
        receipt = result["leases"][0]["receipt"]
        self.assertTrue(receipt["allocation_resolved"])
        self.assertTrue(receipt["independent_deletion_observed"])
        self.assertTrue(receipt["native_smoke_passed"])
        self.assertFalse(any(rows for rows in self.api.rows.values()))
        self.assertEqual(
            sum(
                method == "POST" and path.endswith("/servers") for method, path, _ in self.api.calls
            ),
            1,
        )

    def test_creation_reserves_the_last_ledger_slot_before_allocating(self):
        self.gh.intents.return_value = []
        self.gh.completed_ledger.return_value = {
            "leases": [{"intent": self.intent}] * cycle.policy()["limits"]["maximum_leases"]
        }
        with self.assertRaisesRegex(cycle.CycleError, "ledger_capacity"):
            qualification.previous(self.gh, self.settings, current=("102", "1"), fresh=True)
        self.assertFalse(any(method != "GET" for method, _, _ in self.api.calls))

    def test_recovery_carries_nonallocation_evidence_separately_from_leases(self):
        self.gh.intents.return_value = []
        self.gh.unallocated.return_value = [{"run_id": "100", "attempt": "1"}]
        result = self.recover()
        self.assertEqual(result["unallocated_attempts"], [{"run_id": "100", "attempt": "1"}])
        self.assertEqual(result["leases"], [])

    def test_missing_prior_recovery_receipt_blocks_creation(self):
        self.gh.intents.return_value = [(self.intent, self.producer)]
        with self.assertRaisesRegex(cycle.CycleError, "unresolved_prior_intent"):
            qualification.previous(self.gh, self.settings, current=("102", "1"), fresh=True)


class LedgerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        executable = self.root / "gh"
        executable.write_bytes(b"synthetic")
        self.gh = GitHub(executable)
        self.settings, self.intent = fixtures()
        self.workflow = {
            "id": 1,
            "path": cycle.policy()["qualification_workflow"],
            "state": "active",
        }
        self.run = {
            "id": 101,
            "run_attempt": 2,
            "head_sha": self.intent["identity"]["source_sha"],
            "status": "completed",
            "event": "workflow_dispatch",
        }

    def ledger_with_missing_artifact(self, jobs, *, fresh=False):
        run = {**self.run, "conclusion": "success"}
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(
                self.gh,
                "rows",
                side_effect=lambda endpoint, key, **kwargs: iter(
                    [run] if key == "workflow_runs" else jobs
                ),
            ) as rows,
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[]),
        ):
            value = self.gh.completed_ledger(self.settings, fresh=fresh)
        rows.assert_any_call(
            "repos/{owner}/{repo}/actions/runs/101/attempts/2/jobs", "jobs", complete=True
        )
        return value

    def test_skipped_only_recovery_cannot_invent_a_ledger_or_fresh_health(self):
        jobs = [{"id": 1, "status": "completed", "conclusion": "skipped", "steps": []}]
        self.assertEqual(self.ledger_with_missing_artifact(jobs), {"leases": []})
        with self.assertRaisesRegex(cycle.CycleError, "fresh_recovery_required"):
            self.ledger_with_missing_artifact(jobs, fresh=True)

    def test_missing_recovery_artifact_still_refuses_executed_or_unproven_jobs(self):
        for jobs in (
            [],
            [{"id": 1, "status": "completed", "conclusion": "success", "steps": []}],
            [{"id": 1, "status": "in_progress", "conclusion": "skipped", "steps": []}],
            [{"id": 1, "status": "completed", "conclusion": "skipped"}],
            [
                {
                    "id": 1,
                    "status": "completed",
                    "conclusion": "skipped",
                    "steps": [{"conclusion": "success"}],
                }
            ],
        ):
            with (
                self.subTest(jobs=jobs),
                self.assertRaisesRegex(cycle.CycleError, "recovery_artifact_missing"),
            ):
                self.ledger_with_missing_artifact(jobs)

    def test_rerun_cannot_exclude_an_unresolved_earlier_attempt(self):
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "pages", return_value=[self.run]),
            patch.object(self.gh, "run", return_value=self.run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-intent-101-1"}]),
            patch.object(self.gh, "artifact", return_value=self.intent),
        ):
            result = self.gh.intents(self.settings, previous=[], excluding=("101", "2"))
        self.assertEqual([value["identity"]["attempt"] for value, _ in result], ["1"])

    def test_cancelled_step_remains_uncertain_while_skipped_or_queued_does_not(self):
        for status, conclusion, attempted in (
            ("completed", "skipped", False),
            ("queued", None, False),
            ("completed", "cancelled", True),
            ("in_progress", None, True),
        ):
            jobs = [
                {
                    "name": "Create and qualify one ARM lease",
                    "steps": [
                        {
                            "name": "Create, test and remove the lease",
                            "status": status,
                            "conclusion": conclusion,
                        }
                    ],
                }
            ]
            with (
                self.subTest(status=status, conclusion=conclusion),
                patch.object(self.gh, "pages", return_value=jobs),
            ):
                self.assertEqual(self.gh.provider_attempted(self.run, 1), attempted)

    def test_nonexecution_cache_avoids_reauditing_closed_attempts(self):
        self.run.update({"run_attempt": 1, "event": "workflow_dispatch"})
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "pages", return_value=[self.run]),
            patch.object(self.gh, "run", return_value=self.run),
            patch.object(self.gh, "artifacts", return_value=[]),
            patch.object(self.gh, "provider_attempted", return_value=False),
        ):
            self.assertEqual(self.gh.intents(self.settings, previous=[]), [])
        cached = self.gh.unallocated()
        self.assertEqual(cached, [{"run_id": "101", "attempt": "1"}])
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "pages", return_value=[self.run]),
            patch.object(self.gh, "run") as read_run,
            patch.object(self.gh, "artifacts") as artifacts,
            patch.object(self.gh, "provider_attempted") as attempted,
        ):
            self.assertEqual(self.gh.intents(self.settings, previous=[], unallocated=cached), [])
        read_run.assert_not_called()
        artifacts.assert_not_called()
        attempted.assert_not_called()

    def test_nonexecution_cache_cannot_hide_a_later_attempt(self):
        value = copy.deepcopy(self.intent)
        value["identity"]["attempt"] = "2"
        value["build"]["identity"]["attempt"] = "2"
        value["build"]["application_version"] = "0.0.0-dev.101.2"
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "pages", return_value=[self.run]),
            patch.object(self.gh, "run", return_value=self.run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-intent-101-2"}]),
            patch.object(self.gh, "artifact", return_value=value),
        ):
            result = self.gh.intents(
                self.settings, previous=[], unallocated=[{"run_id": "101", "attempt": "1"}]
            )
        self.assertEqual([intent["identity"]["attempt"] for intent, _ in result], ["2"])

    def test_missing_intent_after_an_executed_provider_step_fails_closed(self):
        self.run["run_attempt"] = 1
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "pages", return_value=[self.run]),
            patch.object(self.gh, "run", return_value=self.run),
            patch.object(self.gh, "artifacts", return_value=[]),
            patch.object(self.gh, "provider_attempted", return_value=True),
            self.assertRaisesRegex(cycle.CycleError, "missing_allocation_intent"),
        ):
            self.gh.intents(self.settings, previous=[])

    def test_carried_absence_survives_original_intent_artifact_expiry(self):
        self.run["run_attempt"] = 1
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "pages", return_value=[self.run]),
            patch.object(self.gh, "run", return_value=self.run),
            patch.object(self.gh, "artifacts", return_value=[]) as artifacts,
            patch.object(self.gh, "provider_attempted") as attempted,
        ):
            result = self.gh.intents(
                self.settings, previous=[{"intent": self.intent, "receipt": {"status": "absent"}}]
            )
        self.assertEqual(result, [])
        attempted.assert_not_called()
        artifacts.assert_not_called()

    def ledger_fixture(self):
        run = {
            "id": 999,
            "run_attempt": 1,
            "head_sha": "a" * 40,
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
        }
        value = {
            "version": 1,
            "status": "passed",
            "identity": {
                "repository": cycle.REPOSITORY,
                "source_sha": run["head_sha"],
                "workflow": cycle.policy()["cleanup_workflow"],
                "run_id": "999",
                "attempt": "1",
                "event": run["event"],
            },
            "project_binding": self.settings["project_binding"],
            "zone": self.settings["zone"],
            "policy_sha256": cycle.digest(cycle.POLICY_PATH),
            "checked_at": cycle.utc(),
            "leases": [],
            "distribution_qualified": False,
        }
        return run, value

    def test_latest_recovery_does_not_scan_all_older_scheduled_runs(self):
        run, value = self.ledger_fixture()
        page = {"workflow_runs": [run] * 100, "total_count": 100}
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "get", return_value=page) as get,
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-recovery-999-1"}]),
            patch.object(self.gh, "artifact", return_value=value),
        ):
            self.assertEqual(self.gh.completed_ledger(self.settings)["leases"], [])
        self.assertEqual(get.call_count, 1)

    def test_old_policy_absence_can_be_carried_but_is_not_fresh_health(self):
        run, value = self.ledger_fixture()
        historical = copy.deepcopy(self.intent)
        historical["policy_sha256"] = "f" * 64
        historical["build"]["policy_sha256"] = "f" * 64
        value["policy_sha256"] = "f" * 64
        value["leases"] = [
            {
                "intent": historical,
                "receipt": {
                    "nonce": historical["nonce"],
                    "status": "absent",
                    "allocation_resolved": True,
                    "distribution_qualified": False,
                },
            }
        ]
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "rows", return_value=iter([run])),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-recovery-999-1"}]),
            patch.object(self.gh, "artifact", return_value=value),
        ):
            self.assertEqual(
                self.gh.completed_ledger(self.settings)["leases"][0]["intent"], historical
            )
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "rows", return_value=iter([run])),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-recovery-999-1"}]),
            patch.object(self.gh, "artifact", return_value=value),
            self.assertRaisesRegex(cycle.CycleError, "recovery_configuration"),
        ):
            self.gh.completed_ledger(self.settings, fresh=True)
        with self.assertRaisesRegex(cycle.CycleError, "intent_policy"):
            cycle.validate_intent(historical, self.settings)

    def test_restored_checkpoint_is_not_fresh_cleanup_key_health(self):
        run, value = self.ledger_fixture()
        value["authority"] = "restore"
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "rows", return_value=iter([run])),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-recovery-999-1"}]),
            patch.object(self.gh, "artifact", return_value=value),
            self.assertRaisesRegex(cycle.CycleError, "fresh_recovery_required"),
        ):
            self.gh.completed_ledger(self.settings, fresh=True)

    def test_stale_or_unresolved_recovery_never_becomes_creation_health(self):
        run, value = self.ledger_fixture()
        value["checked_at"] = "2020-01-01T00:00:00Z"
        with (
            patch.object(self.gh, "workflow", return_value=self.workflow),
            patch.object(self.gh, "rows", return_value=iter([run])),
            patch.object(self.gh, "run", return_value=run),
            patch.object(self.gh, "artifacts", return_value=[{"name": "scw-recovery-999-1"}]),
            patch.object(self.gh, "artifact", return_value=value),
            self.assertRaisesRegex(cycle.CycleError, "fresh_recovery_required"),
        ):
            self.gh.completed_ledger(self.settings, fresh=True)

    def test_disabled_creation_workflow_remains_readable_to_recovery(self):
        disabled = {
            "id": 1,
            "path": cycle.policy()["qualification_workflow"],
            "state": "disabled_manually",
        }
        with (
            patch.object(self.gh, "get", return_value=disabled),
            patch.object(self.gh, "pages", return_value=[]),
        ):
            self.assertEqual(self.gh.intents(self.settings, previous=[]), [])
            with self.assertRaisesRegex(cycle.CycleError, "workflow_inactive"):
                self.gh.workflow(disabled["path"], require_active=True)

    def test_recovery_does_not_depend_on_the_creator_environment(self):
        def get(endpoint):
            self.assertNotIn("scaleway-qualification", endpoint)
            if endpoint.endswith("/deployment-branch-policies"):
                return {"total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}]}
            return {
                "name": "scaleway-cleanup",
                "can_admins_bypass": False,
                "deployment_branch_policy": {
                    "protected_branches": False,
                    "custom_branch_policies": True,
                },
                "protection_rules": [{"type": "branch_policy"}],
            }

        with patch.object(self.gh, "get", side_effect=get):
            self.gh.guards(recovery=True)

    def test_environment_requires_main_only_and_no_cleanup_approval_gate(self):
        def get(endpoint):
            if endpoint.endswith("/deployment-branch-policies"):
                return {"total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}]}
            creator = endpoint.endswith("/scaleway-qualification")
            rules = [{"type": "branch_policy"}]
            if creator:
                rules.append(
                    {
                        "type": "required_reviewers",
                        "prevent_self_review": False,
                        "reviewers": [{"reviewer": {"login": "AdrianMastronardi"}}],
                    }
                )
            return {
                "name": endpoint.split("/")[-1],
                "can_admins_bypass": False,
                "deployment_branch_policy": {
                    "protected_branches": False,
                    "custom_branch_policies": True,
                },
                "protection_rules": rules,
            }

        with patch.object(self.gh, "get", side_effect=get):
            self.gh.guards()

        def gated(endpoint):
            value = get(endpoint)
            if endpoint.endswith("/scaleway-cleanup"):
                value["protection_rules"].append({"type": "required_reviewers"})
            return value

        with (
            patch.object(self.gh, "get", side_effect=gated),
            self.assertRaisesRegex(cycle.CycleError, "cleanup_wait_forbidden"),
        ):
            self.gh.guards()


@unittest.skipIf(os.name == "nt", "POSIX metadata-controller pipe fixture")
class MetadataTransportTests(unittest.TestCase):
    """Keep the real endpoint, pagination, source and artifact readers; replace only process I/O."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        executable = self.root / "synthetic-gh"
        executable.write_bytes(b"transport fixture")
        self.gh = GitHub(executable)
        self.settings, self.intent = fixtures()
        self.calls, self.responses = [], {}
        self.enterContext(patch.dict(os.environ, {"GITHUB_SHA": "d" * 40, "GITHUB_TOKEN": TOKEN}))
        self.real_popen = subprocess.Popen
        self.enterContext(patch.object(subprocess, "Popen", side_effect=self.popen))
        self.prefix = "repos/{owner}/{repo}"
        self.responses[self.prefix + "/actions/workflows/installation-cleanup.yml"] = {
            "id": 2,
            "path": cycle.policy()["cleanup_workflow"],
            "state": "active",
        }
        self.run = {
            "id": 900,
            "workflow_id": 2,
            "run_attempt": 3,
            "path": cycle.policy()["cleanup_workflow"],
            "head_sha": "a" * 40,
            "repository": {"full_name": cycle.REPOSITORY},
            "head_repository": {"full_name": cycle.REPOSITORY},
            "head_branch": "main",
            "event": "schedule",
            "status": "in_progress",
            "created_at": self.intent["created_at"],
            "conclusion": None,
        }
        self.responses[self.prefix + "/actions/runs/900"] = self.run
        self.responses[self.prefix + "/compare/" + "a" * 40 + "..." + "d" * 40] = {
            "behind_by": 0,
            "merge_base_commit": {"sha": "a" * 40},
        }
        self.artifact_records = []
        self.backend = self.response

    def response(self, endpoint):
        if endpoint.startswith(self.prefix + "/actions/artifacts?"):
            query = parse_qs(urlsplit(endpoint).query)
            records = [r for r in self.artifact_records if r["name"] == query["name"][0]]
            start = (int(query["page"][0]) - 1) * 100
            return {"artifacts": records[start : start + 100], "total_count": len(records)}
        return self.responses[endpoint]

    def popen(self, args, **kwargs):
        endpoint = args[-1]
        self.calls.append(endpoint)
        value = self.backend(endpoint)
        if "/compare/" in endpoint:
            self.assertIn("--jq", args)
            self.assertEqual(
                args[args.index("--jq") + 1],
                "{behind_by: .behind_by, merge_base_commit: {sha: .merge_base_commit.sha}}",
            )
            value = {
                "behind_by": value["behind_by"],
                "merge_base_commit": {"sha": value["merge_base_commit"]["sha"]},
            }
        payload = value if isinstance(value, bytes) else json.dumps(value).encode()
        code = "import base64,sys;sys.stdout.buffer.write(base64.b64decode(sys.argv[1]))"
        return self.real_popen(
            [sys.executable, "-c", code, base64.b64encode(payload).decode()], **kwargs
        )

    def archive(self, number, attempt, item, run_id=900, created="2026-10-31T00:00:01Z"):
        value = {
            "version": 2,
            "identity": {
                "repository": cycle.REPOSITORY,
                "source_sha": "a" * 40,
                "workflow": cycle.policy()["cleanup_workflow"],
                "run_id": str(run_id),
                "attempt": str(attempt),
                "event": "schedule",
            },
            "project_binding": self.settings["project_binding"],
            "zone": self.settings["zone"],
            "items": [item],
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("plan.json", json.dumps(value))
        payload = buffer.getvalue()
        self.responses[self.prefix + f"/actions/artifacts/{number}/zip"] = payload
        record = {
            "id": number,
            "created_at": created,
            "workflow_run": {
                "id": run_id,
                "head_branch": "main",
                "head_sha": "a" * 40,
                "repository_id": 1,
                "head_repository_id": 1,
            },
            "name": cycle.recovery_plan_name(self.intent["nonce"], str(attempt)),
            "expired": False,
            "size_in_bytes": len(payload),
            "digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
        }

        self.artifact_records.append(record)
        return record

    def test_real_run_reader_accepts_compare_without_admitting_traversal(self):
        self.assertEqual(self.gh.run("900", "cleanup")["id"], 900)
        self.assertEqual(len(self.calls), 3)
        for segment in ("..", "%2e%2e", "%2f..%2f"):
            with (
                self.subTest(segment=segment),
                self.assertRaisesRegex(cycle.CycleError, "github_endpoint"),
            ):
                self.gh.bytes(self.prefix + "/" + segment + "/actions/runs")
        self.assertEqual(len(self.calls), 3)

    def test_ancestry_projection_excludes_large_commit_file_patches(self):
        self.responses[self.prefix + "/compare/" + "a" * 40 + "..." + "d" * 40]["files"] = [
            {"patch": "x" * (3 * 1024 * 1024)}
        ]
        self.assertEqual(self.gh.run("900", "cleanup")["id"], 900)

    def test_untrusted_plan_artifact_is_ignored_without_downloading_it(self):
        item = {
            "intent": self.intent,
            "deferred": False,
            "known": {},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        artifact = self.archive(1, 1, item)
        artifact["workflow_run"]["head_repository_id"] = 2
        self.assertIsNone(
            self.gh.prior_recovery(self.settings, self.intent, {"run_id": "999", "attempt": "1"})
        )
        self.assertNotIn(self.prefix + "/actions/artifacts/1/zip", self.calls)

    def test_no_prior_plan_uses_a_lease_window_without_per_run_history_calls(self):
        self.intent["created_at"] = "2026-10-31T00:00:00.987654Z"
        result = self.gh.prior_recovery(
            self.settings, self.intent, {"run_id": "999", "attempt": "1"}
        )
        self.assertIsNone(result)
        self.assertEqual(len(self.calls), cycle.policy()["limits"]["maximum_run_attempts"])
        self.assertFalse(
            any("/runs" in endpoint or "created=" in endpoint for endpoint in self.calls)
        )

    def test_same_run_earlier_attempts_merge_resources_and_native_proof(self):
        strong = {
            "intent": self.intent,
            "deferred": False,
            "known": {kind: str(uuid.uuid4()) for kind in cycle.KINDS},
            "allocation_resolved": True,
            "observed_full": True,
            "native_smoke_passed": True,
        }
        weak = {
            **strong,
            "known": {"root": strong["known"]["root"]},
            "observed_full": False,
            "allocation_resolved": False,
            "native_smoke_passed": False,
        }
        self.archive(1, 1, strong)
        self.archive(2, 2, weak)
        self.archive(3, 3, weak)
        result = self.gh.prior_recovery(
            self.settings, self.intent, {"run_id": "900", "attempt": "3"}
        )
        self.assertEqual(result["known"], strong["known"])
        self.assertTrue(
            all(
                result[key]
                for key in ("allocation_resolved", "observed_full", "native_smoke_passed")
            )
        )
        self.assertNotIn(self.prefix + "/actions/artifacts/3/zip", self.calls)
        self.assertLessEqual(len(self.calls), cycle.policy()["limits"]["maximum_run_attempts"] + 8)

    def test_interleaved_older_run_rerun_is_selected_by_plan_publication(self):
        weak = {
            "intent": self.intent,
            "deferred": False,
            "known": {},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        strong = {
            **weak,
            "known": {kind: str(uuid.uuid4()) for kind in cycle.KINDS},
            "allocation_resolved": True,
            "observed_full": True,
            "native_smoke_passed": True,
        }
        self.responses[self.prefix + "/actions/runs/899"] = {
            **self.run,
            "id": 899,
            "run_attempt": 2,
        }
        self.archive(1, 1, weak, 899, "2026-10-31T00:00:01Z")
        self.archive(2, 1, weak, 900, "2026-10-31T00:00:02Z")
        self.archive(3, 2, strong, 899, "2026-10-31T00:00:03Z")
        value = self.gh.prior_recovery(
            self.settings, self.intent, {"run_id": "900", "attempt": "2"}
        )
        self.assertEqual({key: value[key] for key in strong}, strong)
        self.assertIn(self.prefix + "/actions/artifacts/2/zip", self.calls)
        self.assertFalse(any("/runs?" in endpoint for endpoint in self.calls))

    def test_incomplete_newer_snapshot_cannot_erase_an_older_retained_proof(self):
        weak = {
            "intent": self.intent,
            "deferred": False,
            "known": {},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        strong = {
            **weak,
            "known": {kind: str(uuid.uuid4()) for kind in cycle.KINDS},
            "allocation_resolved": True,
            "observed_full": True,
            "native_smoke_passed": True,
        }
        self.archive(1, 1, strong, created="2026-10-31T00:00:01Z")
        self.archive(2, 2, weak, created="2026-10-31T00:00:02Z")
        value = self.gh.prior_recovery(
            self.settings, self.intent, {"run_id": "999", "attempt": "1"}
        )
        self.assertEqual({key: value[key] for key in strong}, strong)

    def test_cumulative_coverage_bounds_downloads_after_many_failed_cleanups(self):
        item = {
            "intent": self.intent,
            "deferred": False,
            "known": {},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        old = [self.archive(number, 1, item, run_id=1000 + number) for number in range(1, 250)]
        coverage = {str(row["id"]): row["digest"] for row in old}
        self.archive(
            250, 1, {**item, "absorbed_artifacts": coverage}, created="2026-10-31T00:00:02Z"
        )
        value = self.gh.prior_recovery(
            self.settings, self.intent, {"run_id": "999", "attempt": "1"}
        )
        self.assertEqual(len(value["absorbed_artifacts"]), 250)
        downloads = [endpoint for endpoint in self.calls if endpoint.endswith("/zip")]
        self.assertEqual(downloads, [self.prefix + "/actions/artifacts/250/zip"])
        self.assertLessEqual(len(self.calls), 30)

    def test_cumulative_coverage_rejects_a_changed_artifact_digest(self):
        item = {
            "intent": self.intent,
            "deferred": False,
            "known": {},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        self.archive(1, 1, item)
        self.archive(
            2,
            2,
            {**item, "absorbed_artifacts": {"1": "sha256:" + "f" * 64}},
            created="2026-10-31T00:00:02Z",
        )
        with self.assertRaisesRegex(cycle.CycleError, "recovery_plan_coverage_conflict"):
            self.gh.prior_recovery(self.settings, self.intent, {"run_id": "999", "attempt": "1"})

    def test_untrusted_artifacts_do_not_consume_the_admitted_plan_bound(self):
        item = {
            "intent": self.intent,
            "deferred": False,
            "known": {},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        for number in (1, 2):
            self.archive(number, 1, item)["workflow_run"]["head_repository_id"] = 2
        self.archive(3, 1, item)
        policy = copy.deepcopy(cycle.policy())
        policy["limits"].update({"maximum_leases": 1, "maximum_run_attempts": 1})
        with patch.object(cycle, "policy", return_value=policy):
            value = self.gh.prior_recovery(
                self.settings, self.intent, {"run_id": "999", "attempt": "1"}
            )
        self.assertEqual(value["known"], {})
        self.assertEqual(
            [endpoint for endpoint in self.calls if endpoint.endswith("/zip")],
            [self.prefix + "/actions/artifacts/3/zip"],
        )

    def test_tied_plan_publications_reject_conflicting_known_uuids(self):
        item = {
            "intent": self.intent,
            "deferred": False,
            "known": {"root": str(uuid.uuid4())},
            "allocation_resolved": False,
            "observed_full": False,
            "native_smoke_passed": False,
        }
        self.archive(1, 1, item)
        self.archive(2, 2, {**item, "known": {"root": str(uuid.uuid4())}})
        with self.assertRaisesRegex(cycle.CycleError, "conflicting_resource_receipt"):
            self.gh.prior_recovery(self.settings, self.intent, {"run_id": "999", "attempt": "1"})

    def test_complete_history_refuses_service_truncation_and_short_responses(self):
        endpoint = self.prefix + "/actions/workflows/1/runs?branch=main"
        for total, reason in (
            (1000, "github_run_search_limit"),
            (1001, "github_run_search_limit"),
            (1, "github_history_incomplete"),
        ):
            self.responses[endpoint + "&per_page=100&page=1"] = {
                "workflow_runs": [],
                "total_count": total,
            }
            with self.subTest(total=total), self.assertRaisesRegex(cycle.CycleError, reason):
                self.gh.pages(endpoint, "workflow_runs")

    def test_initial_ledger_ignores_unlimited_disabled_or_failed_runs(self):
        def backend(endpoint):
            if "/runs?" in endpoint:
                query = parse_qs(urlsplit(endpoint).query)
                self.assertEqual(query["status"], ["success"])
                return {"workflow_runs": [], "total_count": 0}
            return self.responses[endpoint]

        self.backend = backend
        self.assertEqual(self.gh.completed_ledger(self.settings), {"leases": []})
        self.assertEqual(len(self.calls), 2)


class RestoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.settings, self.intent = fixtures()
        self.identity = {
            **self.intent["identity"],
            "workflow": cycle.policy()["cleanup_workflow"],
            "run_id": "999",
        }
        self.checkpoint = {
            "version": 1,
            "identity": {**self.identity, "run_id": "998"},
            "project_binding": self.settings["project_binding"],
            "zone": self.settings["zone"],
            "policy_sha256": cycle.digest(cycle.POLICY_PATH),
            "status": "passed",
            "leases": [
                {
                    "intent": self.intent,
                    "receipt": {
                        "nonce": self.intent["nonce"],
                        "status": "absent",
                        "resources": {kind: str(uuid.uuid4()) for kind in cycle.KINDS},
                        "allocation_resolved": True,
                        "native_smoke_passed": True,
                        "independent_deletion_observed": True,
                        "checked_at": cycle.utc(),
                        "distribution_qualified": False,
                    },
                }
            ],
            "deferred": [],
            "checked_at": cycle.utc(),
            "distribution_qualified": False,
        }
        self.archive = self.root / "checkpoint.zip"
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("recovery.json", json.dumps(self.checkpoint))
        self.request = self.root / "dispatch.json"
        self.prepared = restoration.prepare_input(self.archive, self.request)
        self.inputs = cycle.read(self.request)["inputs"]
        self.event = self.root / "event.json"
        cycle.write(self.event, {"inputs": self.inputs})
        self.enterContext(
            patch.dict(
                os.environ,
                {
                    "SCW_RECOVERY_ENABLED": "true",
                    "SCW_CYCLE_ENABLED": "false",
                    "SCW_APPROVED_POLICY_SHA256": cycle.digest(cycle.POLICY_PATH),
                    "SCW_RESTORE_SHA256": self.inputs["backup_sha256"],
                    "GITHUB_EVENT_PATH": str(self.event),
                },
                clear=True,
            )
        )
        self.enterContext(patch.object(cycle, "source_context", return_value=self.identity))
        self.enterContext(patch.object(cycle, "configuration", return_value=self.settings))
        self.api = MemoryAPI(self.settings, "cleanup")
        self.factory = self.enterContext(patch.object(cycle, "API", return_value=self.api))
        self.gh = Mock(spec=GitHub)
        self.gh.unallocated.return_value = []
        self.gh.workflow.return_value = {"id": 1}
        self.gh.pages.return_value = []
        self.gh.intents.return_value = []

    def test_approved_empty_project_restores_only_checkpoint_evidence(self):
        restoration.restore(self.gh, self.root / "result")
        result = cycle.read(self.root / "result/recovery.json")
        self.assertEqual(result["authority"], "restore")
        self.assertEqual(result["restoration"]["backup_sha256"], self.prepared["sha256"])
        receipt = result["leases"][0]["receipt"]
        self.assertTrue(receipt["native_smoke_passed"])
        self.assertEqual(
            receipt["checkpoint_approval"]["basis"], "maintainer-approved-private-checkpoint"
        )
        self.gh.guards.assert_called_once_with()
        self.gh.run.assert_called_once_with("999", "cleanup", require_active=True)
        self.gh.intents.assert_called_once_with(
            self.settings, previous=self.checkpoint["leases"], unallocated=[]
        )
        self.factory.assert_called_once_with("", self.settings, "observer")
        self.assertEqual(self.api.calls, [])
        if os.name != "nt":
            self.assertEqual(self.request.stat().st_mode & 0o777, 0o600)

    def test_enabled_creation_or_mismatched_approval_cannot_restore(self):
        for values, reason in (
            ({"SCW_CYCLE_ENABLED": "true"}, "backup_requires_suspension"),
            ({"SCW_RESTORE_SHA256": "f" * 64}, "backup_approval_input"),
            ({"SCW_APPROVED_POLICY_SHA256": "f" * 64}, "backup_requires_suspension"),
        ):
            with self.subTest(reason=reason), patch.dict(os.environ, values):
                with self.assertRaisesRegex(cycle.CycleError, reason):
                    restoration.restore(self.gh, self.root / "result")
        self.factory.assert_not_called()

    def test_manual_confirmation_is_required_before_provider_reads(self):
        for changes in ({"confirm_project_reconciled": "false"}, {"mode": "recover"}):
            cycle.write(self.event, {"inputs": {**self.inputs, **changes}})
            with self.assertRaisesRegex(cycle.CycleError, "backup_approval_input"):
                restoration.restore(self.gh, self.root / "result")
        self.factory.assert_not_called()

    def test_wrong_project_and_active_or_uncovered_producers_block_restore(self):
        cases = (
            ("project", "backup_project"),
            ("active", "backup_active_producer"),
            ("history", "backup_incomplete_history"),
        )
        for change, reason in cases:
            with self.subTest(change=change):
                settings = {**self.settings}
                if change == "project":
                    settings["project_binding"] = "f" * 64
                self.gh.pages.return_value = (
                    [{"status": "in_progress"}] if change == "active" else []
                )
                self.gh.intents.return_value = [(self.intent, {})] if change == "history" else []
                with patch.object(cycle, "configuration", return_value=settings):
                    with self.assertRaisesRegex(cycle.CycleError, reason):
                        restoration.restore(self.gh, self.root / "result")
        self.factory.assert_not_called()

    def test_nonempty_project_is_never_cleaned_as_part_of_restore(self):
        self.api.rows["server"][str(uuid.uuid4())] = {"id": str(uuid.uuid4())}
        with self.assertRaisesRegex(cycle.CycleError, "project_not_empty"):
            restoration.restore(self.gh, self.root / "result")
        self.assertEqual(self.api.calls, [])
        self.assertFalse((self.root / "result").exists())

    def test_exact_old_resource_presence_blocks_restore_even_if_not_listed(self):
        with patch.object(self.api, "get", return_value={"status": "available"}):
            with self.assertRaisesRegex(cycle.CycleError, "backup_resource_still_present"):
                restoration.restore(self.gh, self.root / "result")
        self.assertEqual(self.api.calls, [])

    def test_changed_payload_and_oversized_decompression_are_rejected(self):
        with patch.dict(os.environ, {"SCW_RESTORE_SHA256": "f" * 64}):
            with self.assertRaisesRegex(cycle.CycleError, "backup_digest"):
                restoration.decode_input()
        limits = copy.deepcopy(cycle.policy())
        limits["limits"]["maximum_json_bytes"] = 32
        with patch.object(cycle, "policy", return_value=limits):
            with self.assertRaises(cycle.CycleError):
                restoration.decode_input()

    def test_default_history_bound_fits_the_dispatch_input_budget(self):
        rows = []
        for number in range(cycle.policy()["limits"]["maximum_leases"]):
            row = copy.deepcopy(self.checkpoint["leases"][0])
            intent = row["intent"]
            intent["nonce"] = str(uuid.uuid4())
            intent["identity"]["run_id"] = str(10000 + number)
            intent["identity"]["source_sha"] = hashlib.sha1(uuid.uuid4().bytes).hexdigest()
            intent["build"]["identity"] = copy.deepcopy(intent["identity"])
            intent["build"]["application_version"] = f"0.0.0-dev.{10000 + number}.1"
            intent["build"]["source_tree"] = hashlib.sha1(uuid.uuid4().bytes).hexdigest()
            for kind in ("package", "harness"):
                intent["build"][kind]["sha256"] = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
            row["receipt"]["nonce"] = intent["nonce"]
            row["receipt"]["resources"] = {kind: str(uuid.uuid4()) for kind in cycle.KINDS}
            rows.append(row)
        value = {
            **self.checkpoint,
            "leases": rows,
            "unallocated_attempts": [
                {
                    "run_id": str(((number + 1) * 6364136223846793005) % ((1 << 63) - 1) + 1),
                    "attempt": "1",
                }
                for number in range(999 - len(rows))
            ],
        }
        archive = self.root / "full.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("recovery.json", json.dumps(value))
        result = restoration.prepare_input(archive, self.root / "full-dispatch.json")
        self.assertLessEqual(
            result["input_characters"], cycle.policy()["limits"]["maximum_restore_characters"]
        )

    def test_invalid_private_zip_reports_a_closed_error(self):
        broken = self.root / "broken.zip"
        broken.write_bytes(b"not a ZIP archive")
        with self.assertRaisesRegex(cycle.CycleError, "invalid_backup_archive"):
            restoration.from_archive(broken)

    def test_private_zip_refuses_unbounded_secondary_compression_codecs(self):
        file = self.root / "bzip.zip"
        with zipfile.ZipFile(file, "w", compression=zipfile.ZIP_BZIP2) as archive:
            archive.writestr("recovery.json", json.dumps(self.checkpoint))
        with self.assertRaisesRegex(cycle.CycleError, "backup_archive_bound"):
            restoration.from_archive(file)

    def test_corrupt_restore_compression_has_a_closed_error(self):
        payload = bytearray(lzma.compress(b"A"))
        payload[-1] ^= 255
        cycle.write(
            self.event,
            {"inputs": {**self.inputs, "backup_base64": base64.b64encode(payload).decode()}},
        )
        with patch.dict(os.environ, {"SCW_RESTORE_SHA256": hashlib.sha256(payload).hexdigest()}):
            with self.assertRaisesRegex(cycle.CycleError, "invalid_backup_payload"):
                restoration.decode_input()

    def test_failed_or_unresolved_checkpoint_cannot_be_prepared(self):
        self.checkpoint["leases"][0]["receipt"]["allocation_resolved"] = False
        with self.assertRaisesRegex(cycle.CycleError, "backup_absence"):
            restoration.checkpoint(self.checkpoint, self.settings)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.settings, self.intent = fixtures()

    def test_real_display_environment_is_admitted_without_signing_credentials(self):
        environment = guest_probe.display_environment(
            self.intent["identity"], self.root / "runtime"
        )
        self.assertEqual(environment["CSC_IDENTITY_AUTO_DISCOVERY"], "false")
        self.assertEqual(environment["GITHUB_RUN_ID"], self.intent["identity"]["run_id"])
        self.assertEqual(environment["XDG_SESSION_TYPE"], "wayland")
        self.assertNotIn("DISPLAY", environment)
        guest_probe.admit_environment(environment)

    def test_guest_environment_still_refuses_credentials_and_altered_unsigned_switch(self):
        environment = guest_probe.display_environment(
            self.intent["identity"], self.root / "runtime"
        )
        for key, value in (
            ("CSC_KEY_PASSWORD", "synthetic-signing-password"),
            ("CSC_IDENTITY_AUTO_DISCOVERY", "true"),
            ("SCW_SECRET_KEY", "synthetic-provider-key"),
            ("GITHUB_TOKEN", "synthetic-github-token"),
            ("SSH_AUTH_SOCK", "/synthetic/agent"),
        ):
            with (
                self.subTest(key=key),
                self.assertRaisesRegex(cycle.CycleError, "guest_credentials"),
            ):
                guest_probe.admit_environment({**environment, key: value})

    def test_early_guest_refusals_retain_safe_codes_without_creating_success_output(self):
        for stage in ("guard", "admission", "success"):
            home = self.root / stage
            home.mkdir()
            output = home / "result"
            error = cycle.CycleError("guest_policy" if stage == "guard" else "guest_credentials")
            observed = []

            def smoke(destination):
                observed.append(destination)
                self.assertFalse(destination.exists())

            with (
                self.subTest(stage=stage),
                patch.object(sys, "argv", ["scaleway_guest.py", "smoke", str(output)]),
                patch.object(Path, "home", return_value=home),
                patch.object(
                    guest_probe,
                    "guard",
                    side_effect=error if stage == "guard" else None,
                    return_value={"intent": self.intent},
                ),
                patch.object(
                    guest_probe, "admit_guest", side_effect=error if stage == "admission" else None
                ),
                patch.object(guest_probe, "smoke", side_effect=smoke),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                status = guest_probe.main()
            if stage == "success":
                self.assertEqual(status, 0)
                self.assertEqual(observed, [output])
                self.assertFalse(output.exists())
            else:
                self.assertEqual(status, 1)
                self.assertEqual(observed, [])
                failure = cycle.read(output / "smoke-failure.json")
                self.assertEqual(failure["code"], cycle.failure_code(error))
                self.assertFalse((output / "result.json").exists())

    def test_guest_refusal_never_writes_to_an_unadmitted_output_path(self):
        output = self.root / "foreign-output"
        with (
            patch.object(sys, "argv", ["scaleway_guest.py", "smoke", str(output)]),
            patch.object(Path, "home", return_value=self.root),
            patch.object(guest_probe, "guard") as guarded,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(guest_probe.main(), 1)
        guarded.assert_not_called()
        self.assertFalse(output.exists())

    def test_large_valid_native_observations_fit_a_small_lossless_envelope(self):
        sample = {
            "pid": 101,
            "parent": 1,
            "renderer": True,
            "sandbox": True,
            "birth": "stable-process-identity",
            "executable": "/opt/ohtia-quality/ohtia-quality",
        }
        value = {
            "samples": [sample] * 30000,
            "remaining": [],
            "display_observations": [{"backend": "wayland", "source": "unix-peer"}],
        }
        record = evidence_archive.pack(self.root, value)
        payload = (self.root / evidence_archive.FILENAME).read_bytes()
        self.assertGreater(
            record["artifact"]["uncompressed_bytes"], cycle.policy()["limits"]["maximum_json_bytes"]
        )
        self.assertLess(len(json.dumps(record)), cycle.policy()["limits"]["maximum_json_bytes"])
        evidence_archive.admit(payload, record)
        self.assertEqual(record["sample_count"], 30000)

    def test_observation_archive_cannot_expand_beyond_its_bound(self):
        payload = gzip.compress(b" " * 5000, mtime=0)
        expected = {
            "artifact": {
                "file": evidence_archive.FILENAME,
                "encoding": "gzip",
                "bytes": len(payload),
                "uncompressed_bytes": 1000,
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        }
        limits = copy.deepcopy(cycle.policy())
        limits["limits"]["maximum_observation_bytes"] = 1024
        with (
            patch.object(cycle, "policy", return_value=limits),
            self.assertRaises(cycle.CycleError),
        ):
            evidence_archive.admit(payload, expected)

    def test_corrupt_deflate_is_a_controlled_observation_error(self):
        payload = bytearray(gzip.compress(b"A", mtime=0))
        payload[10] = 7
        record = {
            "artifact": {
                "file": evidence_archive.FILENAME,
                "encoding": "gzip",
                "bytes": len(payload),
                "uncompressed_bytes": 1,
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        }
        with self.assertRaisesRegex(cycle.CycleError, "invalid_observation_archive"):
            evidence_archive.admit(bytes(payload), record)

    def test_failure_diagnostics_never_include_exception_or_command_secrets(self):
        for error in (
            cycle.CycleError(TOKEN),
            ValueError(TOKEN),
            OSError(13, TOKEN),
            subprocess.CalledProcessError(1, ["ssh", "-i", TOKEN]),
        ):
            result = cycle.failure_record(error, "synthetic")
            self.assertNotIn(TOKEN, json.dumps(result))
        self.assertEqual(
            cycle.failure_record(cycle.CycleError("host_key_mismatch"), "ssh")["code"],
            "host_key_mismatch",
        )
        result = cycle.failure_record(
            subprocess.CalledProcessError(2, ["/private/path/gdbus", TOKEN]), "display"
        )
        self.assertEqual((result["program"], result["exit_code"]), ("gdbus", 2))

    def test_bootstrap_error_codes_do_not_echo_subprocess_output(self):
        error = subprocess.CalledProcessError(1, ["rpm", TOKEN], output=TOKEN, stderr=TOKEN)
        result = bootstrap.failure(error, "install")
        self.assertEqual((result["code"], result["program"]), ("bootstrap_command_failed", "rpm"))
        self.assertNotIn(TOKEN, json.dumps(result))

    def call_guest(
        self,
        *,
        timeout=False,
        bootstrap_failure=False,
        corrupt=False,
        bad_receipt=False,
        result_error=False,
        invalid_result=False,
    ):
        output = self.root / "output"
        output.mkdir()
        now = [0.0]
        native = {
            "status": "failed",
            "identity": self.intent["identity"],
            "build": self.intent["build"],
            "cell": cycle.cell(self.intent["profile"]),
            "distribution_qualified": False,
            "publisher_signed": False,
        }

        if invalid_result:
            native["identity"] = {**native["identity"], "source_sha": "f" * 40}
        report = b'{"cases":[]}'
        corrupt_archive = bytearray(gzip.compress(b"A", mtime=0))
        corrupt_archive[10] = 7
        if corrupt:
            native["status"] = "passed"
            native["native"] = {
                "artifact": {
                    "file": evidence_archive.FILENAME,
                    "encoding": "gzip",
                    "bytes": len(corrupt_archive),
                    "uncompressed_bytes": 1,
                    "sha256": hashlib.sha256(corrupt_archive).hexdigest(),
                }
            }
            native["suites"] = {
                suite: {"bytes": len(report), "sha256": hashlib.sha256(report).hexdigest()}
                for suite in ("runtime", "storage", "diagnostics")
            }

        home = self.root / "guest-home"
        guest_output = home / "result"
        scratch = home / ".ohtia-quality-fixture"
        if not bootstrap_failure:
            guest_output.mkdir(parents=True)
            (home / ".ohtia-qualification-gnome.log").write_bytes(
                b"bounded compositor diagnostic\n"
            )
            scratch.mkdir()
            cycle.write(scratch / "runtime-profile.json", {"scratch_root": str(scratch)})
            cycle.write(
                guest_output / "context.json",
                {
                    "profile": str(scratch / "runtime-profile.json"),
                    "owner": self.intent["identity"]["run_id"],
                    "attempt": self.intent["identity"]["attempt"],
                },
            )
            for suite, filename in (
                ("runtime", "receipt.json"),
                ("storage", "storage-receipt.json"),
                ("diagnostics", "diagnostic-receipt.json"),
            ):
                if suite != "runtime" and not corrupt and not bad_receipt:
                    continue
                destination = scratch / "evidence" / suite / filename
                destination.parent.mkdir(parents=True)
                destination.write_bytes(
                    b'{"cases":[false]}' if bad_receipt and suite == "runtime" else report
                )
                cycle.write(
                    scratch / "evidence" / (suite + "-supervision.json"),
                    {"returncode": 1, "timed_out": True},
                )
        if bad_receipt:
            native["status"] = "passed"
            observations = {
                "samples": [{"renderer": True, "sandbox": True}],
                "display_observations": [{"backend": "wayland"}],
                "remaining": [],
            }
            native["native"] = evidence_archive.pack(self.root, observations)
            corrupt_archive = bytearray((self.root / evidence_archive.FILENAME).read_bytes())
            native["suites"] = {
                suite: {"bytes": len(report), "sha256": hashlib.sha256(report).hexdigest()}
                for suite in ("runtime", "storage", "diagnostics")
            }

        def command(args, **kwargs):
            text = args[-1]
            if args[0] == "ssh" and text == qualification.reporting.READINESS_COMMAND:
                return subprocess.CompletedProcess(args, 0, b'{"python":true,"helper":true}')
            if args[0] == "ssh" and text.endswith("bootstrap.py status"):
                return subprocess.CompletedProcess(
                    args,
                    0,
                    json.dumps(
                        {
                            "ready": not bootstrap_failure,
                            "failed": bootstrap_failure,
                            "code": "guest_volume_serial" if bootstrap_failure else None,
                            "cloud_init_error_count": 0,
                        }
                    ).encode(),
                )
            if (
                args[0] == "ssh"
                and "scripts/scaleway_guest.py display" in text
                and not corrupt
                and not bad_receipt
                and not result_error
                and not invalid_result
            ):
                now[0] = 100.0
                raise subprocess.TimeoutExpired(args, 100)
            if args[0] == "ssh" and text.endswith("/result.json") and not bootstrap_failure:
                if result_error:
                    raise subprocess.CalledProcessError(255, args)
                data = json.dumps(native).encode()
            elif (
                args[0] == "ssh"
                and text.endswith("/" + evidence_archive.FILENAME)
                and (corrupt or bad_receipt)
            ):
                data = bytes(corrupt_archive)
            elif args[0] == "ssh" and "scripts/scaleway_guest.py collect " in text:
                with (
                    patch.object(Path, "home", return_value=home),
                    patch.object(guest_probe, "guard", return_value={"intent": self.intent}),
                ):
                    try:
                        data = guest_probe.collect(guest_output, text.split()[-1])
                    except (OSError, ValueError, KeyError):
                        raise subprocess.CalledProcessError(1, args) from None
            elif args[0] == "ssh" and "cat " in text:
                raise subprocess.CalledProcessError(1, args)
            else:
                data = b""
            return subprocess.CompletedProcess(args, 0, data)

        with (
            patch.object(qualification, "host_key", return_value=("8.8.8.8", self.root / "known")),
            patch.object(cycle, "verify_artifact", return_value=self.root / "fixture.bin"),
            patch.object(cycle.time, "monotonic", side_effect=lambda: now[0]),
            patch.object(cycle.time, "sleep") as sleeping,
            patch.object(cycle, "command", side_effect=command) as called,
            self.assertRaises(cycle.CycleError),
        ):
            qualification.guest(
                Mock(), self.intent, {}, self.root / "key", self.root, output, 100.0
            )
        return output, sleeping, called

    def test_unreadable_result_does_not_discard_live_reports_or_log(self):
        output, _, _ = self.call_guest(result_error=True)
        self.assertFalse((output / "native.json").exists())
        self.assertTrue((output / "runtime.json").is_file())
        self.assertTrue((output / "runtime-supervision.json").is_file())
        self.assertEqual(
            (output / "compositor.log").read_bytes(), b"bounded compositor diagnostic\n"
        )

    def test_invalid_result_binding_does_not_discard_diagnostic_reports(self):
        output, _, _ = self.call_guest(invalid_result=True)
        self.assertFalse((output / "native.json").exists())
        self.assertTrue((output / "runtime.json").is_file())
        self.assertEqual(cycle.read(output / "guest-failure.json")["code"], "guest_result_binding")

    def test_emitted_diagnostic_codes_survive_controller_rewrapping(self):
        for code in (
            "process_failed",
            "process_timeout",
            "local_io_failed",
            "bootstrap_failed",
            "cloud_init_failed",
            "guest_operation_failed",
        ):
            with self.subTest(code=code):
                self.assertEqual(cycle.failure_code(cycle.CycleError(code)), code)

    def test_corrupt_observations_preserve_other_suite_receipts_before_failure(self):
        output, _, _ = self.call_guest(corrupt=True)
        for suite in ("runtime", "storage", "diagnostics"):
            self.assertTrue((output / (suite + ".json")).is_file())
        self.assertEqual(
            cycle.read(output / "guest-failure.json")["code"], "invalid_observation_archive"
        )

    def test_native_timeout_retains_existing_partial_receipts_before_deletion(self):
        output, _, _ = self.call_guest(timeout=True)
        self.assertEqual(cycle.read(output / "native.json")["status"], "failed")
        self.assertTrue((output / "runtime.json").is_file())
        self.assertEqual(
            (output / "compositor.log").read_bytes(), b"bounded compositor diagnostic\n"
        )
        self.assertEqual(cycle.read(output / "guest-failure.json")["code"], "process_timeout")

    def test_bad_first_suite_preserves_later_receipts_and_supervision(self):
        output, _, _ = self.call_guest(bad_receipt=True)
        self.assertFalse((output / "runtime.json").exists())
        self.assertTrue((output / "storage.json").is_file())
        self.assertTrue((output / "diagnostics.json").is_file())
        self.assertTrue(cycle.read(output / "runtime-supervision.json")["timed_out"])
        self.assertEqual(cycle.read(output / "guest-failure.json")["code"], "guest_suite_digest")

    def test_bootstrap_failure_is_retained_without_spending_the_test_deadline(self):
        output, sleeping, called = self.call_guest(bootstrap_failure=True)
        self.assertEqual(cycle.read(output / "bootstrap.json")["code"], "guest_volume_serial")
        self.assertEqual(cycle.read(output / "guest-failure.json")["phase"], "bootstrap")
        self.assertFalse(any(call.args[0][0] == "scp" for call in called.call_args_list))
        sleeping.assert_not_called()


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        executable = self.root / "gh"
        executable.write_bytes(b"synthetic binary")
        self.gh = GitHub(executable)

    def artifact(self, members):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for key, value in members:
                archive.writestr(key, value)
        payload = buffer.getvalue()
        record = {
            "id": 1,
            "expired": False,
            "size_in_bytes": len(payload),
            "digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
        }
        return record, payload

    def test_artifact_requires_exact_zip_digest_and_single_bounded_member(self):
        record, payload = self.artifact([("intent.json", b'{"version":1}')])
        with patch.object(self.gh, "bytes", return_value=payload):
            self.assertEqual(self.gh.artifact(record, "intent.json"), {"version": 1})
            record["digest"] = "sha256:" + "0" * 64
            with self.assertRaisesRegex(cycle.CycleError, "artifact_digest_mismatch"):
                self.gh.artifact(record, "intent.json")
        record, payload = self.artifact([("intent.json", b"{}"), ("extra.py", b"do not execute")])
        with (
            patch.object(self.gh, "bytes", return_value=payload),
            self.assertRaisesRegex(cycle.CycleError, "artifact_members"),
        ):
            self.gh.artifact(record, "intent.json")

    def test_invalid_artifact_zip_reports_a_closed_error_after_digest_admission(self):
        payload = b"not a ZIP archive"
        record = {
            "id": 1,
            "expired": False,
            "size_in_bytes": len(payload),
            "digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
        }
        with (
            patch.object(self.gh, "bytes", return_value=payload),
            self.assertRaisesRegex(cycle.CycleError, "invalid_artifact_archive"),
        ):
            self.gh.artifact(record, "plan.json")

    def test_artifact_zip_refuses_secondary_compression_before_decoding(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_BZIP2) as archive:
            archive.writestr("intent.json", '{"version":1}')
        payload = buffer.getvalue()
        record = {
            "id": 1,
            "expired": False,
            "size_in_bytes": len(payload),
            "digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
        }
        with (
            patch.object(self.gh, "bytes", return_value=payload),
            self.assertRaisesRegex(cycle.CycleError, "artifact_file_bound"),
        ):
            self.gh.artifact(record, "intent.json")

    def test_repository_endpoint_cannot_select_another_repository_or_write(self):
        for endpoint in (
            "repos/elsewhere/project/actions/runs",
            "repos/{owner}/{repo}/../secrets",
            "https://example.invalid/",
        ):
            with (
                self.subTest(endpoint=endpoint),
                self.assertRaisesRegex(cycle.CycleError, "github_endpoint"),
            ):
                self.gh.bytes(endpoint)

    def test_harness_copies_pnpm_hardlinks_as_independent_bytes(self):
        modules = self.root / "node_modules"
        modules.mkdir()
        (modules / "a").write_bytes(b"permitted dependency")
        os.link(modules / "a", modules / "b")
        archive = self.root / "harness.tar.gz"
        build.harness(self.root, archive)
        with tarfile.open(archive) as stream:
            files = [
                entry
                for entry in stream.getmembers()
                if entry.name in {"node_modules/a", "node_modules/b"}
            ]
            self.assertEqual(len(files), 2)
            self.assertTrue(all(entry.isfile() for entry in files))
            self.assertEqual(
                [stream.extractfile(entry).read() for entry in files], [b"permitted dependency"] * 2
            )

    @unittest.skipIf(os.name == "nt", "POSIX confined symlink fixture")
    def test_harness_refuses_an_escaping_dependency_symlink(self):
        modules = self.root / "node_modules"
        modules.mkdir()
        (modules / "escape").symlink_to(Path(tempfile.gettempdir()))
        with self.assertRaisesRegex(cycle.CycleError, "harness_link_escape"):
            build.harness(self.root, self.root / "harness.tar.gz")

    @unittest.skipIf(os.name == "nt", "POSIX workspace package link fixture")
    def test_harness_keeps_the_confined_desktop_probe_workspace_dependency(self):
        package = self.root / "tools/desktop-probes"
        package.mkdir(parents=True)
        (package / "package.json").write_text('{"name":"@ohtia/desktop-probes"}')
        modules = self.root / "node_modules/@ohtia"
        modules.mkdir(parents=True)
        (modules / "desktop-probes").symlink_to("../../tools/desktop-probes")
        archive = self.root / "harness.tar.gz"
        build.harness(self.root, archive)
        with tarfile.open(archive) as stream:
            names = stream.getnames()
            self.assertIn("tools/desktop-probes/package.json", names)
            self.assertTrue(stream.getmember("node_modules/@ohtia/desktop-probes").issym())
            self.assertFalse(any(name.startswith("tools/linux-e2e/") for name in names))

    def test_package_digest_and_regular_file_are_rechecked_before_transfer(self):
        file = self.root / "quality.rpm"
        file.write_bytes(b"package")
        record = {"file": file.name, "bytes": 7, "sha256": hashlib.sha256(b"package").hexdigest()}
        self.assertEqual(cycle.verify_artifact(self.root, record), file)
        file.write_bytes(b"changed")
        with self.assertRaisesRegex(cycle.CycleError, "artifact_changed"):
            cycle.verify_artifact(self.root, record)


if __name__ == "__main__":
    unittest.main()
