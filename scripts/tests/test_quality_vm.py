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
from contextlib import nullcontext
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
        for invalid_bus in (
            "missing",
            "foreign-owner",
            "reload-failure",
            "socket-start-failure",
            "handshake-failure",
            "manager-readiness-failure",
        ):
            with self.subTest(invalid_bus=invalid_bus), tempfile.TemporaryDirectory() as temporary:
                home = Path(temporary)
                (home / "environment.json").write_text(json.dumps({"GITHUB_SHA": "synthetic"}))
                real_path = Path
                candidate = Mock()
                candidate.is_socket.return_value = invalid_bus != "missing"
                candidate.stat.return_value.st_uid = os.getuid() + (invalid_bus == "foreign-owner")
                runtime = Mock()
                runtime.__truediv__ = Mock(return_value=candidate)

                def paths(value):
                    if value == "/home/ohtia-quality":
                        return home
                    if value == f"/run/user/{os.getuid()}":
                        return runtime
                    return real_path(value)

                seen = []

                def bootstrap(arguments, **options):
                    seen.append(arguments)
                    if arguments[0] == "/usr/bin/systemctl":
                        self.assertEqual(options["timeout"], 10)
                        self.assertTrue(options["check"])
                        expected = ["daemon-reload"] if len(seen) == 3 else ["start", "dbus.socket"]
                        self.assertEqual(arguments[1:], ["--user", *expected])
                        if (invalid_bus == "reload-failure" and len(seen) == 3) or (
                            invalid_bus == "socket-start-failure" and len(seen) == 4
                        ):
                            raise subprocess.CalledProcessError(1, arguments)
                    if arguments[0] == "gdbus":
                        if arguments[1] == "call" and invalid_bus == "handshake-failure":
                            raise subprocess.CalledProcessError(1, arguments)
                        if arguments[1] == "wait" and invalid_bus == "manager-readiness-failure":
                            self.assertEqual(
                                arguments[2:],
                                ["--session", "--timeout=8", "org.freedesktop.systemd1"],
                            )
                            raise subprocess.TimeoutExpired(arguments, 10)
                    return subprocess.CompletedProcess(arguments, 0)

                expected_error = (
                    SystemExit
                    if invalid_bus in ("missing", "foreign-owner")
                    else subprocess.TimeoutExpired
                    if invalid_bus == "manager-readiness-failure"
                    else subprocess.CalledProcessError
                )
                with (
                    patch.dict(os.environ, {}, clear=True),
                    patch("pathlib.Path", side_effect=paths),
                    patch("subprocess.run", side_effect=bootstrap),
                    patch("subprocess.Popen") as launched,
                    self.assertRaises(expected_error) as bootstrap_error,
                ):
                    runpy.run_path(str(delivery.ROOT / "tooling/quality-packaging/guest-run.py"))
                launched.assert_not_called()
                if invalid_bus in ("missing", "foreign-owner"):
                    self.assertEqual(
                        str(bootstrap_error.exception),
                        "The guest account's native D-Bus socket is unavailable.",
                    )
                counts = {
                    "missing": 4,
                    "foreign-owner": 4,
                    "reload-failure": 3,
                    "socket-start-failure": 4,
                    "handshake-failure": 5,
                    "manager-readiness-failure": 6,
                }
                self.assertEqual(len(seen), counts[invalid_bus])
        for audit_outcome, stop_failure, suite_failure, startup_failure in (
            (0, False, True, None),
            (1, False, True, None),
            ("watchdog", False, True, None),
            (0, True, True, None),
            (0, True, False, None),
            (0, False, False, None),
            (0, False, False, "compositor-readiness"),
            (0, False, False, "missing-wayland"),
            (0, False, False, "portal-readiness"),
            (0, False, False, "compositor-ceased"),
            (0, False, False, "compositor-stop"),
            (0, True, True, "compositor-stop"),
        ):
            with self.subTest(
                audit_outcome=audit_outcome,
                stop_failure=stop_failure,
                suite_failure=suite_failure,
                startup_failure=startup_failure,
            ):
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

                    compositor_calls = []
                    compositor_ready = []
                    portal_ready = []
                    quality_calls = []
                    activated = []
                    bus_checked = []
                    manager_ready = []
                    bootstrap_calls = []
                    session_calls = []

                    def command(arguments, **options):
                        if arguments[0] == "gdbus" and arguments[1] == "wait":
                            self.assertEqual(bus_checked, [True])
                            self.assertEqual(
                                arguments[2:],
                                ["--session", "--timeout=8", "org.freedesktop.systemd1"],
                            )
                            self.assertEqual(options["timeout"], 10)
                            self.assertTrue(options["check"])
                            self.assertEqual(options["stdout"], subprocess.DEVNULL)
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"],
                                f"unix:path={runtime / 'bus'}",
                            )
                            manager_ready.append(True)
                        if arguments[0] == "gdbus" and arguments[1] == "call":
                            self.assertEqual(options["timeout"], 10)
                            self.assertTrue(options["check"])
                            self.assertEqual(options["stdout"], subprocess.DEVNULL)
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"],
                                f"unix:path={runtime / 'bus'}",
                            )
                            if arguments[-1] == "org.freedesktop.DBus.GetId":
                                self.assertEqual(
                                    bootstrap_calls, [["daemon-reload"], ["start", "dbus.socket"]]
                                )
                                bus_checked.append(True)
                            else:
                                self.assertEqual(
                                    arguments[2:],
                                    [
                                        "--session",
                                        "--dest",
                                        "org.freedesktop.portal.Desktop",
                                        "--object-path",
                                        "/org/freedesktop/portal/desktop",
                                        "--method",
                                        "org.freedesktop.portal.Settings.ReadAll",
                                        "['org.freedesktop.appearance']",
                                    ],
                                )
                                self.assertEqual(compositor_ready, [True])
                                self.assertEqual(activated, [False, True])
                                self.assertEqual(session_calls, ["start"])
                                if startup_failure == "portal-readiness":
                                    raise subprocess.TimeoutExpired(arguments, 10)
                                portal_ready.append(True)
                        if arguments[0] == "dbus-update-activation-environment":
                            has_wayland = "WAYLAND_DISPLAY" in arguments
                            expected = [
                                "--systemd",
                                "DBUS_SESSION_BUS_ADDRESS",
                                "XDG_RUNTIME_DIR",
                                "XDG_SESSION_TYPE",
                                "XDG_CURRENT_DESKTOP",
                            ]
                            if has_wayland:
                                expected.append("WAYLAND_DISPLAY")
                                self.assertEqual(options["env"]["WAYLAND_DISPLAY"], "wayland-0")
                            self.assertEqual(arguments[1:], expected)
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"],
                                f"unix:path={runtime / 'bus'}",
                            )
                            self.assertEqual(options["env"]["XDG_SESSION_TYPE"], "wayland")
                            self.assertEqual(options["env"]["XDG_CURRENT_DESKTOP"], "GNOME")
                            self.assertEqual(options["timeout"], 10)
                            activated.append(has_wayland)
                        if arguments[0] == "/usr/bin/systemd-run":
                            self.assertTrue(options["check"])
                            if "--unit=ohtia-quality-gnome" in arguments:
                                self.assertEqual(bus_checked, [True])
                                self.assertEqual(manager_ready, [True])
                                self.assertEqual(activated, [False])
                                self.assertEqual(session_calls, [])
                                self.assertEqual(options["timeout"], 60)
                                self.assertIn("--property=Type=notify", arguments)
                                self.assertIn("--property=TimeoutStartSec=60s", arguments)
                                self.assertIn("--property=TimeoutStopSec=10s", arguments)
                                self.assertIn("--property=StandardError=inherit", arguments)
                                self.assertIn(
                                    f"--property=StandardOutput=append:{home / 'gnome.log'}",
                                    arguments,
                                )
                                self.assertEqual(
                                    arguments[arguments.index("--") + 1 :],
                                    [
                                        "/usr/bin/gnome-shell",
                                        "--headless",
                                        "--wayland",
                                        "--virtual-monitor",
                                        "1280x720",
                                    ],
                                )
                                self.assertNotIn("--no-block", arguments)
                                self.assertNotIn("--wait", arguments)
                                with (home / "gnome.log").open("ab") as log:
                                    log.write(b"x" * (2 * 1024 * 1024 + 100))
                                compositor_calls.append("start")
                                if startup_failure == "compositor-readiness":
                                    raise subprocess.TimeoutExpired(arguments, 60)
                                compositor_ready.append(True)
                            else:
                                self.assertEqual(compositor_ready, [True])
                                self.assertEqual(activated, [False, True])
                                self.assertEqual(
                                    arguments[1:],
                                    [
                                        "--user",
                                        "--unit=ohtia-quality-session",
                                        "--property=Type=oneshot",
                                        "--property=RemainAfterExit=yes",
                                        "--property=BindsTo=graphical-session.target",
                                        "--property=After=graphical-session.target",
                                        "--",
                                        "/usr/bin/true",
                                    ],
                                )
                                self.assertEqual(options["timeout"], 10)
                                session_calls.append("start")
                        if arguments[0] == "/usr/bin/journalctl":
                            self.assertEqual(
                                arguments[1:], ["--user", "--boot", "--lines=100", "--no-pager"]
                            )
                            self.assertEqual(options["timeout"], 5)
                            self.assertEqual(options["stdin"], subprocess.DEVNULL)
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"],
                                f"unix:path={runtime / 'bus'}",
                            )
                            options["stdout"].write(b"j" * (64 * 1024 + 100))
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
                            if arguments[1] == "--user" and arguments[2] in (
                                "daemon-reload",
                                "start",
                            ):
                                bootstrap_calls.append(arguments[2:])
                                self.assertEqual(
                                    options["env"]["XDG_RUNTIME_DIR"], f"/run/user/{os.getuid()}"
                                )
                                self.assertEqual(
                                    options["env"]["DBUS_SESSION_BUS_ADDRESS"],
                                    f"unix:path={runtime / 'bus'}",
                                )
                                self.assertTrue(options["check"])
                                self.assertEqual(options["timeout"], 10)
                            elif arguments[1] == "--user":
                                self.assertTrue(options["check"])
                                if arguments[2] == "is-active":
                                    self.assertEqual(
                                        arguments[2:],
                                        ["is-active", "--quiet", "ohtia-quality-gnome.service"],
                                    )
                                    self.assertEqual(portal_ready, [True])
                                    self.assertEqual(options["timeout"], 10)
                                    if startup_failure == "compositor-ceased":
                                        raise subprocess.CalledProcessError(1, arguments)
                                elif arguments[-1] == "ohtia-quality-gnome.service":
                                    self.assertEqual(arguments[2], "stop")
                                    self.assertEqual(options["timeout"], 15)
                                    compositor_calls.append("stop")
                                    if startup_failure == "compositor-stop":
                                        raise subprocess.TimeoutExpired(arguments, 15)
                                else:
                                    self.assertEqual(
                                        arguments[1:],
                                        ["--user", "stop", "ohtia-quality-session.service"],
                                    )
                                    self.assertEqual(options["timeout"], 10)
                                    session_calls.append("stop")
                                    if stop_failure:
                                        raise subprocess.TimeoutExpired(arguments, 10)
                            return subprocess.CompletedProcess(arguments, 0, stdout="active\n")
                        if "quality:build" in arguments:
                            self.assertEqual(compositor_ready, [True])
                            self.assertEqual(portal_ready, [True])
                            quality_calls.append(True)
                            self.assertEqual(activated, [False, True])
                            self.assertEqual(session_calls, ["start"])
                            self.assertEqual(
                                options["env"]["DBUS_SESSION_BUS_ADDRESS"],
                                f"unix:path={runtime / 'bus'}",
                            )
                            if suite_failure:
                                raise subprocess.CalledProcessError(1, arguments)
                        return subprocess.CompletedProcess(arguments, 0)

                    with (
                        socket.socket(socket.AF_UNIX) as wayland,
                        socket.socket(socket.AF_UNIX) as user_bus,
                    ):
                        if startup_failure != "missing-wayland":
                            wayland.bind(str(runtime / "wayland-0"))
                        user_bus.bind(str(runtime / "bus"))
                        expected_error = (
                            SystemExit
                            if startup_failure == "missing-wayland"
                            else subprocess.TimeoutExpired
                            if startup_failure in ("compositor-readiness", "portal-readiness")
                            else subprocess.CalledProcessError
                            if suite_failure or startup_failure == "compositor-ceased"
                            else subprocess.TimeoutExpired
                            if stop_failure or startup_failure == "compositor-stop"
                            else None
                        )
                        error_context = (
                            self.assertRaises(expected_error) if expected_error else nullcontext()
                        )
                        with (
                            patch.dict(
                                os.environ,
                                {"DBUS_SESSION_BUS_ADDRESS": "unix:path=wrong-private-bus"},
                                clear=True,
                            ),
                            patch("pathlib.Path", side_effect=guest_path),
                            patch("subprocess.Popen") as launched,
                            patch("subprocess.run", side_effect=command),
                            error_context as failure,
                        ):
                            runpy.run_path(
                                str(delivery.ROOT / "tooling/quality-packaging/guest-run.py")
                            )
                        launched.assert_not_called()
                    if suite_failure:
                        self.assertIn("quality:build", failure.exception.cmd)
                    elif startup_failure == "missing-wayland":
                        self.assertIn("exactly one native Wayland socket", str(failure.exception))
                    self.assertEqual(compositor_calls, ["start", "stop"])
                    before_session = startup_failure in ("compositor-readiness", "missing-wayland")
                    self.assertEqual(session_calls, [] if before_session else ["start", "stop"])
                    self.assertEqual(
                        quality_calls,
                        []
                        if startup_failure
                        in (
                            "compositor-readiness",
                            "missing-wayland",
                            "portal-readiness",
                            "compositor-ceased",
                        )
                        else [True],
                    )
                    self.assertEqual(
                        (source / "artifacts/quality-result/gnome.log").stat().st_size,
                        2 * 1024 * 1024,
                    )
                    self.assertEqual(
                        (source / "artifacts/quality-result/user-session.log").stat().st_size,
                        64 * 1024,
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
