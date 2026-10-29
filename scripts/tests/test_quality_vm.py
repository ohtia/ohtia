"""Verify immutable guest selection and refusal of non-native VM execution."""

from __future__ import annotations

import json
import os
import runpy
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

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
                self.assertIn("fedora-release-identity-workstation", commands)
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

    def test_guest_packaging_dependencies_and_modern_disk_device_options(self):
        for profile in ("fedora-44", "debian-13"):
            config = json.loads(
                vm.cloud_config(profile, "ssh-ed25519 synthetic-key").split("\n", 1)[1]
            )
            self.assertIn("binutils", config["packages"])
        args = vm.home_disk_arguments(Path("/fixture/home.qcow2"))
        self.assertIn("file=/fixture/home.qcow2,format=qcow2,if=none,id=quality-home", args)
        self.assertIn("virtio-blk-pci,drive=quality-home,serial=ohtia-quality-home", args)
        self.assertNotIn("serial=", args[1])
        root_args = vm.root_disk_arguments(Path("/fixture/root.qcow2"))
        self.assertIn("file=/fixture/root.qcow2,format=qcow2,if=none,id=quality-os", root_args)
        self.assertIn("virtio-blk-pci,drive=quality-os,bootindex=1", root_args)

    def test_guest_diagnostics_exclude_keys_and_reject_aliases(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            attempt = root / "attempt"
            attempt.mkdir()
            output = root / "output"
            output.mkdir()
            for name in ("qemu.log", "serial.log", "ssh-key"):
                (attempt / name).write_text("synthetic " + name)
            vm.retain_diagnostics(attempt, output)
            self.assertEqual({p.name for p in output.iterdir()}, {"qemu.log", "serial.log"})
            self.assertEqual((output / "serial.log").read_text(), "synthetic serial.log")
            (attempt / "qemu.log").unlink()
            (attempt / "qemu.log").symlink_to(attempt / "ssh-key")
            with self.assertRaises(delivery.DeliveryError):
                vm.retain_diagnostics(attempt, output)

    def test_cleanup_failure_still_retains_logs_and_never_overwrites_aliases(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            attempt = root / "attempt"
            attempt.mkdir()
            output = root / "output"
            output.mkdir()
            (attempt / "qemu.log").write_text("synthetic boot failure")
            child = SimpleNamespace(
                poll=Mock(return_value=None),
                kill=Mock(),
                wait=Mock(side_effect=subprocess.TimeoutExpired("qemu", 10)),
            )
            self.assertFalse(vm.finish_guest(child, attempt, output))
            self.assertEqual((output / "qemu.log").read_text(), "synthetic boot failure")
            (output / "qemu.log").unlink()
            secret = root / "key"
            secret.write_text("synthetic untouched")
            (output / "qemu.log").symlink_to(secret)
            self.assertFalse(vm.finish_guest(None, attempt, output))
            self.assertEqual(secret.read_text(), "synthetic untouched")
            (output / "qemu.log").unlink()
            (attempt / "qemu.log").unlink()
            (attempt / "qemu.log").hardlink_to(secret)
            with self.assertRaises(delivery.DeliveryError):
                vm.retain_diagnostics(attempt, output)

    def test_existing_attempt_never_authorizes_diagnostic_copy(self):
        cell = next(
            c
            for c in delivery.cells(delivery.read(delivery.ROOT / "config/desktop/targets.json"))
            if c["id"] == "fedora-44-x64-vm"
        )
        policy = delivery.read(delivery.ROOT / "config/quality/virtual-machines.json")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            attempt = root / "artifacts" / cell["id"]
            attempt.mkdir(parents=True)
            output = root / "output"
            output.mkdir()
            (attempt / "qemu.log").write_text("old evidence")
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
                patch.object(sys, "argv", ["quality_vm.py", cell["id"], str(output)]),
            ):
                self.assertEqual(vm.main(), 1)
            self.assertEqual(list(output.iterdir()), [])

    def test_guest_compositor_and_failed_suite_share_bus_and_retain_bounded_log(self):
        for audit_outcome in (0, 1, "watchdog"):
            with self.subTest(audit_outcome=audit_outcome):
                with tempfile.TemporaryDirectory() as temporary:
                    home = Path(temporary)
                    source = home / "source"
                    source.mkdir()
                    runtime = home / "runtime"
                    runtime.mkdir()
                    (home / "environment.json").write_text(
                        json.dumps(
                            {
                                "GITHUB_SHA": "synthetic",
                                "OHTIA_QUALITY_VM": "fedora-44-x64-vm",
                                "XDG_SESSION_TYPE": "wayland",
                                "XDG_CURRENT_DESKTOP": "GNOME",
                            }
                        )
                    )
                    real_path = Path

                    def guest_path(value):
                        if value == "/home/ohtia-quality":
                            return home
                        if value == f"/run/user/{os.getuid()}":
                            return runtime
                        return real_path(value)

                    child = Mock()

                    def compositor(arguments, **options):
                        self.assertEqual(arguments[0], "gnome-shell")
                        options["stdout"].write(b"x" * (2 * 1024 * 1024 + 100))
                        return child

                    activated = []

                    def command(arguments, **options):
                        if arguments[0] == "dbus-update-activation-environment":
                            self.assertEqual(
                                arguments[1:],
                                [
                                    "XDG_RUNTIME_DIR",
                                    "XDG_SESSION_TYPE",
                                    "XDG_CURRENT_DESKTOP",
                                    "WAYLAND_DISPLAY",
                                ],
                            )
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"], "unix:path=synthetic"
                            )
                            self.assertEqual(options["env"]["WAYLAND_DISPLAY"], "wayland-0")
                            self.assertEqual(options["env"]["XDG_SESSION_TYPE"], "wayland")
                            self.assertEqual(options["env"]["XDG_CURRENT_DESKTOP"], "GNOME")
                            self.assertEqual(options["timeout"], 10)
                            activated.append(True)
                        if arguments[0] == "/usr/bin/sudo":
                            self.assertEqual(
                                arguments[:7],
                                [
                                    "/usr/bin/sudo",
                                    "-n",
                                    "/usr/bin/timeout",
                                    "--signal=TERM",
                                    "--kill-after=1s",
                                    "8s",
                                    "/usr/sbin/ausearch",
                                ],
                            )
                            self.assertEqual(
                                arguments[7:],
                                ["--input-logs", "-m", "AVC,USER_AVC", "-ts", "boot", "--raw"],
                            )
                            self.assertEqual(options["timeout"], 12)
                            self.assertEqual(options["stdin"], subprocess.DEVNULL)
                            options["stdout"].write(b"a" * (256 * 1024 + 100))
                            if audit_outcome == "watchdog":
                                raise subprocess.TimeoutExpired(arguments, 12)
                            return subprocess.CompletedProcess(arguments, audit_outcome)
                        if arguments[0] == "/usr/bin/systemctl":
                            return subprocess.CompletedProcess(arguments, 0, stdout="active\n")
                        if "quality:build" in arguments:
                            self.assertEqual(activated, [True])
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"], "unix:path=synthetic"
                            )
                            raise subprocess.CalledProcessError(1, arguments)
                        return subprocess.CompletedProcess(arguments, 0)

                    with socket.socket(socket.AF_UNIX) as wayland:
                        wayland.bind(str(runtime / "wayland-0"))
                        with (
                            patch.dict(
                                os.environ, {"DBUS_SESSION_BUS_ADDRESS": "unix:path=synthetic"}
                            ),
                            patch("pathlib.Path", side_effect=guest_path),
                            patch("subprocess.Popen", side_effect=compositor) as launched,
                            patch("subprocess.run", side_effect=command),
                            self.assertRaises(subprocess.CalledProcessError),
                        ):
                            runpy.run_path(
                                str(delivery.ROOT / "tooling/quality-packaging/guest-run.py")
                            )
                        self.assertEqual(
                            launched.call_args.kwargs["env"]["DBUS_SESSION_BUS_ADDRESS"],
                            "unix:path=synthetic",
                        )
                    child.terminate.assert_called_once()
                    child.wait.assert_called_once_with(timeout=10)
                    self.assertEqual(
                        (source / "artifacts/quality-result/gnome.log").stat().st_size,
                        2 * 1024 * 1024,
                    )
                    self.assertEqual(
                        (source / "artifacts/quality-result/selinux-audit.log").stat().st_size,
                        256 * 1024,
                    )
                    receipt = json.loads(
                        (source / "artifacts/quality-result/selinux-audit.json").read_text()
                    )
                    self.assertEqual(
                        receipt["exit_code"], None if audit_outcome == "watchdog" else audit_outcome
                    )
                    self.assertEqual(receipt["watchdog"], audit_outcome == "watchdog")
                    self.assertEqual(receipt["auditd"]["state"], "active")
                    self.assertTrue(receipt["truncated"])
                    self.assertEqual(receipt["query"], "boot AVC,USER_AVC")

    def test_fedora_identity_uses_install_scoped_dnf5_options(self):
        config = json.loads(vm.cloud_config("fedora-44", "ssh-ed25519 synthetic").split("\n", 1)[1])
        self.assertIn(["systemctl", "start", "auditd"], config["runcmd"])
        command = next(c for c in config["runcmd"] if c[0] == "dnf")
        self.assertLess(command.index("install"), command.index("--allowerasing"))
        self.assertIn("fedora-release-identity-workstation", command)
        self.assertNotIn("--skip-broken", command)
        self.assertNotIn("--nogpgcheck", command)


if __name__ == "__main__":
    unittest.main()
