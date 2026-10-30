"""Check facility evidence limits, privilege refusal and KVM descriptor cleanup."""

from __future__ import annotations

import contextlib
import errno
import io
import json
import os
import runpy
import stat
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_facilities as facilities

HOSTED = {
    "GITHUB_ACTIONS": "true",
    "RUNNER_ENVIRONMENT": "github-hosted",
    "RUNNER_OS": "Linux",
    "RUNNER_ARCH": "ARM64",
    "GITHUB_REPOSITORY": "ohtia/ohtia",
    "GITHUB_RUN_ID": "123456",
    "GITHUB_RUN_ATTEMPT": "2",
}
CHECKOUT = "a" * 40
TREE = "b" * 40


class FacilityTests(unittest.TestCase):
    def hosted(self, **environment):
        stack = contextlib.ExitStack()
        stack.enter_context(patch.dict(os.environ, HOSTED | environment, clear=True))
        stack.enter_context(patch.object(facilities.platform, "system", return_value="Linux"))
        stack.enter_context(patch.object(facilities.platform, "machine", return_value="aarch64"))
        stack.enter_context(
            patch.object(
                facilities.platform,
                "freedesktop_os_release",
                return_value={"ID": "ubuntu", "VERSION_ID": "26.04"},
            )
        )
        stack.enter_context(
            patch.object(facilities.platform, "release", return_value="6.20.0-test")
        )
        stack.enter_context(patch.object(os, "getuid", return_value=1002, create=True))
        stack.enter_context(patch.object(os, "geteuid", return_value=1002, create=True))
        return stack

    def test_identity_binds_actual_architecture_and_distinct_run_attempt(self):
        with self.hosted():
            actual = facilities.hosted_identity("arm64", CHECKOUT, TREE)
        self.assertEqual(actual["architecture"], "arm64")
        self.assertEqual(actual["run_id"], 123456)
        self.assertEqual(actual["run_attempt"], 2)
        self.assertEqual(actual["checkout_sha"], CHECKOUT)
        self.assertEqual(actual["tree_sha"], TREE)
        self.assertEqual(
            actual["operating_system"],
            {"distribution": "ubuntu", "version": "26.04", "kernel": "6.20.0-test"},
        )
        with (
            self.hosted(),
            patch.object(
                facilities.platform,
                "freedesktop_os_release",
                return_value={"ID": "unbounded/private marker"},
            ),
        ):
            with self.assertRaisesRegex(facilities.FacilityError, "host_release_unknown"):
                facilities.hosted_identity("arm64", CHECKOUT, TREE)

    def test_identity_refuses_wrong_architecture_or_unqualified_execution_context(self):
        cases = [
            ({"GITHUB_ACTIONS": "false"}, "arm64", "hosted_actions_context_required"),
            ({"RUNNER_ENVIRONMENT": "self-hosted"}, "arm64", "hosted_actions_context_required"),
            ({}, "x64", "native_architecture_mismatch"),
            ({"GITHUB_RUN_ATTEMPT": "0"}, "arm64", "run_identity"),
            ({"GITHUB_RUN_ID": str(2**53)}, "arm64", "run_identity"),
            ({"GITHUB_REPOSITORY": "unexpected\nrepository"}, "arm64", "repository_identity"),
        ]
        for environment, architecture, reason in cases:
            with self.subTest(reason=reason), self.hosted(**environment):
                with self.assertRaisesRegex(facilities.FacilityError, reason):
                    facilities.hosted_identity(architecture, CHECKOUT, TREE)

    def test_identity_refuses_root_or_unknown_git_identity(self):
        with self.hosted(), patch.object(os, "geteuid", return_value=0):
            with self.assertRaisesRegex(facilities.FacilityError, "unprivileged_process_required"):
                facilities.hosted_identity("arm64", CHECKOUT, TREE)
        with self.hosted(), self.assertRaisesRegex(facilities.FacilityError, "git_identity"):
            facilities.hosted_identity("arm64", "not-a-commit", TREE)

    def test_effective_capabilities_are_required_and_not_inferred_from_user_name(self):
        with patch.object(
            Path, "read_text", return_value="Name:\tpython\nCapEff:\t0000000000000000\n"
        ):
            self.assertEqual(facilities.capabilities(), 0)
        with patch.object(Path, "read_text", return_value="CapEff:\t0000000000000001\n"):
            self.assertEqual(facilities.capabilities(), 1)
        for value in ("Name:\tpython\n", "CapEff:\tinvalid\n", "CapEff:\t0000000000000000\n" * 2):
            with patch.object(Path, "read_text", return_value=value):
                with self.assertRaisesRegex(
                    facilities.FacilityError, "effective_capabilities_unknown"
                ):
                    facilities.capabilities()

    def test_sudo_probe_has_fixed_command_no_inherited_secret_environment_and_timeout(self):
        with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=1)) as run:
            self.assertEqual(facilities.unattended_sudo(), "denied")
        args, options = run.call_args
        self.assertEqual(args[0], ["/usr/bin/sudo", "-n", "--", "/usr/bin/true"])
        self.assertEqual(options["env"], {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        self.assertEqual(options["timeout"], 5)
        for result, expected in [(0, "allowed"), (2, "unknown"), (-9, "unknown")]:
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=result)):
                self.assertEqual(facilities.unattended_sudo(), expected)
        for error in (OSError("private marker"), subprocess.TimeoutExpired("sudo", 5)):
            with patch.object(subprocess, "run", side_effect=error):
                self.assertEqual(facilities.unattended_sudo(), "unknown")

    def test_kvm_probe_creates_and_closes_both_descriptors_without_claiming_a_guest_boot(self):
        self.enterContext(patch.multiple(os, O_CLOEXEC=0x80000, O_NOFOLLOW=0x20000, create=True))
        fake_fcntl = SimpleNamespace(ioctl=Mock(side_effect=[12, 11]))
        with (
            patch.dict(sys.modules, {"fcntl": fake_fcntl}),
            patch.object(os, "open", return_value=10),
            patch.object(os, "fstat", return_value=SimpleNamespace(st_mode=stat.S_IFCHR)),
            patch.object(os, "close") as close,
        ):
            report = facilities.kvm_observation()
        self.assertEqual(report["status"], "available")
        self.assertTrue(report["empty_vm_created"])
        self.assertFalse(report["guest_booted"])
        self.assertEqual([call.args[0] for call in close.call_args_list], [11, 10])
        self.assertEqual(fake_fcntl.ioctl.call_args_list[1].args, (10, facilities.KVM_CREATE_VM, 0))

    def test_kvm_denial_absence_and_non_devices_never_become_availability(self):
        self.enterContext(patch.multiple(os, O_CLOEXEC=0x80000, O_NOFOLLOW=0x20000, create=True))
        for code, reason in [(errno.ENOENT, "device_missing"), (errno.EACCES, "access_denied")]:
            with (
                patch.dict(sys.modules, {"fcntl": SimpleNamespace(ioctl=Mock())}),
                patch.object(os, "open", side_effect=OSError(code, "private marker")),
            ):
                report = facilities.kvm_observation()
            self.assertEqual(report["status"], "unavailable")
            self.assertEqual(report["reason"], reason)
            self.assertNotIn("private marker", json.dumps(report))
        with (
            patch.dict(sys.modules, {"fcntl": SimpleNamespace(ioctl=Mock())}),
            patch.object(os, "open", return_value=10),
            patch.object(os, "fstat", return_value=SimpleNamespace(st_mode=stat.S_IFREG)),
            patch.object(os, "close") as close,
        ):
            report = facilities.kvm_observation()
        self.assertEqual(report["reason"], "not_character_device")
        close.assert_called_once_with(10)

    def test_kvm_api_create_and_cleanup_failures_retain_unavailable_state(self):
        self.enterContext(patch.multiple(os, O_CLOEXEC=0x80000, O_NOFOLLOW=0x20000, create=True))
        for calls, reason in [
            ([11], "unsupported_api_version"),
            ([12, OSError(errno.EPERM, "private marker")], "access_denied"),
            ([12, -1], "invalid_vm_descriptor"),
        ]:
            with (
                patch.dict(sys.modules, {"fcntl": SimpleNamespace(ioctl=Mock(side_effect=calls))}),
                patch.object(os, "open", return_value=10),
                patch.object(os, "fstat", return_value=SimpleNamespace(st_mode=stat.S_IFCHR)),
                patch.object(os, "close") as close,
            ):
                report = facilities.kvm_observation()
            self.assertEqual(report["status"], "unavailable")
            self.assertEqual(report["reason"], reason)
            close.assert_called_once_with(10)
        with (
            patch.dict(sys.modules, {"fcntl": SimpleNamespace(ioctl=Mock(side_effect=[12, 11]))}),
            patch.object(os, "open", return_value=10),
            patch.object(os, "fstat", return_value=SimpleNamespace(st_mode=stat.S_IFCHR)),
            patch.object(os, "close", side_effect=OSError(errno.EIO, "private marker")) as close,
        ):
            report = facilities.kvm_observation()
        self.assertEqual(report["status"], "unavailable")
        self.assertFalse(report["empty_vm_created"])
        self.assertEqual(close.call_count, 2)

    def test_account_probe_refuses_effective_capabilities_and_unattended_administration(self):
        for capabilities, sudo, accepted in [
            (0, "denied", True),
            (1, "denied", False),
            (0, "allowed", False),
            (0, "unknown", False),
        ]:
            with (
                self.hosted(),
                patch.object(facilities, "capabilities", return_value=capabilities),
                patch.object(facilities, "unattended_sudo", return_value=sudo),
                patch.object(facilities, "kvm_observation") as kvm,
            ):
                report = facilities.observe("account", "arm64", CHECKOUT, TREE)
            self.assertEqual(facilities.accepted_observation(report, False), accepted)
            self.assertFalse(report["distribution_qualified"])
            self.assertFalse(report["display_session_probed"])
            kvm.assert_not_called()

    def test_host_observation_and_required_vm_admission_are_distinct(self):
        with (
            self.hosted(),
            patch.object(facilities, "capabilities", return_value=0),
            patch.object(facilities, "unattended_sudo", return_value="allowed"),
            patch.object(facilities, "kvm_observation", return_value={"status": "unavailable"}),
        ):
            report = facilities.observe("host", "arm64", CHECKOUT, TREE)
        self.assertTrue(facilities.accepted_observation(report, False))
        self.assertFalse(facilities.accepted_observation(report, True))
        self.assertFalse(report["distribution_qualified"])

    def test_cli_reports_observations_but_refuses_unknown_or_elevated_accounts(self):
        for sudo, expected in [("denied", 0), ("allowed", 1), ("unknown", 1)]:
            with (
                self.hosted(),
                patch.object(
                    sys,
                    "argv",
                    [
                        "probe",
                        "account",
                        "--expected-architecture",
                        "arm64",
                        "--checkout-sha",
                        CHECKOUT,
                        "--tree-sha",
                        TREE,
                    ],
                ),
                patch.object(facilities, "capabilities", return_value=0),
                patch.object(facilities, "unattended_sudo", return_value=sudo),
                contextlib.redirect_stdout(io.StringIO()) as output,
            ):
                self.assertEqual(facilities.main(), expected)
            self.assertEqual(json.loads(output.getvalue())["unattended_sudo"], sudo)
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(
                sys,
                "argv",
                [
                    "probe",
                    "host",
                    "--expected-architecture",
                    "arm64",
                    "--checkout-sha",
                    CHECKOUT,
                    "--tree-sha",
                    TREE,
                ],
            ),
            contextlib.redirect_stdout(io.StringIO()) as output,
            contextlib.redirect_stderr(io.StringIO()) as errors,
        ):
            self.assertEqual(facilities.main(), 1)
        self.assertEqual(output.getvalue(), "")
        self.assertIn("required", errors.getvalue())

    def test_entry_point_refuses_local_execution_without_environment_or_file_mutation(self):
        script = Path(facilities.__file__)
        args = [
            str(script),
            "host",
            "--expected-architecture",
            "arm64",
            "--checkout-sha",
            CHECKOUT,
            "--tree-sha",
            TREE,
        ]
        before = os.environ.copy()
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(sys, "argv", args),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            with self.assertRaises(SystemExit) as ended:
                runpy.run_path(str(script), run_name="__main__")
            self.assertEqual(ended.exception.code, 1)
        self.assertEqual(os.environ, before)


if __name__ == "__main__":
    unittest.main()
