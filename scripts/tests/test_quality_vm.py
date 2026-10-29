"""Verify immutable guest selection and refusal of non-native VM execution."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_delivery as delivery
import quality_vm as vm


class VirtualMachineTests(unittest.TestCase):
    def test_cloud_configuration_preserves_native_security_and_unprivileged_execution(self):
        for profile in ("fedora-44", "debian-13"):
            config = json.loads(
                vm.cloud_config(profile, "ssh-ed25519 synthetic-public-key").split("\n", 1)[1]
            )
            self.assertFalse(config["ssh_pwauth"])
            self.assertTrue(config["disable_root"])
            self.assertEqual(config["users"][0]["name"], "ohtia-quality")
            self.assertTrue(config["users"][0]["lock_passwd"])
            commands = json.dumps(config["runcmd"])
            self.assertNotIn("setenforce 0", commands)
            self.assertNotIn("nogpgcheck", commands)
            if profile == "fedora-44":
                self.assertIn("mkfs.btrfs", commands)
                self.assertIn("Enforcing", commands)
                self.assertIn("fedora-release-workstation", commands)
        with self.assertRaises(delivery.DeliveryError):
            vm.cloud_config("unreviewed-distribution", "public-key")

    def test_guest_policy_has_no_emulated_or_arm_fallback(self):
        policy = delivery.read(delivery.ROOT / "config/quality/virtual-machines.json")
        self.assertEqual(policy["accelerator"], "kvm")
        self.assertEqual(policy["host_runner"], "ubuntu-26.04")
        self.assertEqual(policy["architecture"], "x64")
        self.assertEqual(policy["pending_architectures"], ["arm64"])
        self.assertEqual(set(policy["guests"]), {"fedora-44", "debian-13"})
        for guest in policy["guests"].values():
            image = guest["image"]
            self.assertTrue(image["url"].startswith("https://"))
            self.assertIn("checksum_source", image)
            self.assertEqual(
                len(image.get("sha256", image.get("sha512"))), 64 if "sha256" in image else 128
            )

    def test_local_vm_execution_is_rejected_before_files_or_commands(self):
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(os.environ, {}, clear=True),
            patch.object(sys, "argv", ["quality_vm.py", "fedora-44-x64-vm", temporary + "/output"]),
            patch.object(vm, "run") as command,
        ):
            self.assertEqual(vm.main(), 1)
            command.assert_not_called()
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_ssh_identity_is_scoped_to_the_new_local_guest(self):
        args = vm.ssh_arguments(Path("/key"), Path("/known-hosts"), 2222)
        self.assertIn("ohtia-quality@127.0.0.1", args)
        self.assertIn("UserKnownHostsFile=/known-hosts", args)
        self.assertIn("BatchMode=yes", args)
        self.assertNotIn("StrictHostKeyChecking=no", args)

    def test_empty_checkout_retains_failure_evidence_before_guest_download(self):
        cell = next(
            c
            for c in delivery.cells(delivery.read(delivery.ROOT / "config/desktop/targets.json"))
            if c["id"] == "fedora-44-x64-vm"
        )
        policy = delivery.read(delivery.ROOT / "config/quality/virtual-machines.json")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "artifacts/quality-result"
            with (
                patch.object(vm, "ROOT", root),
                patch.dict(
                    os.environ, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted"}
                ),
                patch.object(vm.platform, "machine", return_value="x86_64"),
                patch.object(
                    vm.platform,
                    "freedesktop_os_release",
                    return_value={"ID": "ubuntu", "VERSION_ID": "26.04"},
                ),
                patch.object(vm.Path, "is_char_device", return_value=True),
                patch.object(vm.os, "access", return_value=True),
                patch.object(delivery, "identity", return_value={}),
                patch.object(delivery, "plan", return_value={"cells": [cell]}),
                patch.object(delivery, "read", return_value=policy),
                patch.object(
                    vm.shutil, "disk_usage", return_value=SimpleNamespace(free=30 * 1024**3)
                ),
                patch.object(
                    vm, "download", side_effect=OSError("synthetic download failure")
                ) as download,
                patch.object(sys, "argv", ["quality_vm.py", cell["id"], str(output)]),
            ):
                self.assertEqual(vm.main(), 1)
                download.assert_called_once()
            self.assertEqual(json.loads((output / "result.json").read_text())["status"], "failed")
            self.assertTrue((root / "artifacts" / cell["id"]).is_dir())


if __name__ == "__main__":
    unittest.main()
