"""Check immutable Linux runner admission and complete-result failure modes."""

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
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import linux_e2e as runner


class LinuxE2ETests(unittest.TestCase):
    def setUp(self):
        self.config = runner.configuration()
        self.identity = {"run": "synthetic-accounting-run"}
        self.reports = [
            {
                "identity": self.identity,
                "shard": name,
                "status": "passed",
                "preparation": "passed",
                "cases": [{"id": case, "status": "passed", "attempts": 1} for case in cases],
            }
            for name, cases in self.config["shards"].items()
        ]

    def test_full_inventory_passes_and_missing_duplicate_or_failed_cases_fail(self):
        self.assertEqual(
            runner.account(self.config, self.reports, self.identity),
            {"status": "passed", "shards": 2, "cases": 9},
        )
        mutations = [
            lambda reports: reports.pop(),
            lambda reports: reports[0].update(identity={"run": "stale-run"}),
            lambda reports: reports.append(copy.deepcopy(reports[0])),
            lambda reports: reports[0]["cases"].pop(),
            lambda reports: reports[0]["cases"].append(copy.deepcopy(reports[0]["cases"][0])),
            lambda reports: reports[0].update(preparation="failed"),
            lambda reports: reports[0].update(status="failed"),
            lambda reports: reports[0].update(shard="undeclared"),
            lambda reports: reports[0]["cases"][0].update(status="skipped"),
            lambda reports: reports[0]["cases"][0].update(status="cancelled"),
            lambda reports: reports[0]["cases"][0].update(attempts=2),
        ]
        for mutate in mutations:
            reports = copy.deepcopy(self.reports)
            mutate(reports)
            with self.assertRaises(ValueError):
                runner.account(self.config, reports, self.identity)

    def policy(self):
        resources = self.config["resources"]
        return {
            "Image": self.config["image_id"],
            "Mounts": [],
            "AppArmorProfile": self.config["apparmor_profile"],
            "Config": {"User": "pwuser"},
            "HostConfig": {
                "Privileged": False,
                "NetworkMode": "bridge",
                "IpcMode": "private",
                "PidMode": "",
                "CapAdd": [],
                "CapDrop": ["ALL"],
                "SecurityOpt": [
                    "no-new-privileges",
                    f"seccomp={runner.SECCOMP}",
                    f"apparmor={self.config['apparmor_profile']}",
                ],
                "Memory": resources["memory_bytes"],
                "MemorySwap": resources["memory_bytes"],
                "ShmSize": resources["shm_bytes"],
                "PidsLimit": resources["pids"],
                "NanoCpus": resources["cpus"] * 10**9,
            },
        }

    def test_effective_policy_rejects_host_mounts_root_privileges_and_unbounded_resources(self):
        runner.inspect_container(self.config, self.policy())
        mutations = [
            lambda value: value.update(
                Mounts=[{"Source": "/home/stable", "Destination": "/home/pwuser/.config"}]
            ),
            lambda value: value.update(Image="sha256:" + "0" * 64),
            lambda value: value["Config"].update(User="root"),
            lambda value: value.update(AppArmorProfile="unconfined"),
        ]
        for key, bad in (
            ("Privileged", True),
            ("MaskedPaths", ["/proc/interrupts"]),
            ("ReadonlyPaths", ["/proc/sys"]),
            ("NetworkMode", "host"),
            ("NetworkMode", "container:foreign"),
            ("PidMode", "container:foreign"),
            ("UTSMode", "host"),
            ("Devices", [{"PathOnHost": "/dev/sda"}]),
            ("DeviceRequests", [{"Count": -1}]),
            (
                "SecurityOpt",
                ["no-new-privileges", f"seccomp={runner.SECCOMP}", "apparmor=unconfined"],
            ),
            ("IpcMode", "host"),
            ("PidMode", "host"),
            ("CapAdd", ["SYS_ADMIN"]),
            ("CapDrop", []),
            ("Memory", 0),
            ("MemorySwap", -1),
            ("ShmSize", 67108864),
            ("PidsLimit", -1),
            ("NanoCpus", 0),
            ("SecurityOpt", ["seccomp=unconfined"]),
        ):
            mutations.append(lambda value, key=key, bad=bad: value["HostConfig"].update({key: bad}))
        for mutate in mutations:
            policy = self.policy()
            mutate(policy)
            with self.assertRaises(ValueError):
                runner.inspect_container(self.config, policy)

    def test_apparmor_requires_enforcement_and_real_sensitive_path_denials(self):
        with (
            patch.object(
                runner.Path,
                "read_text",
                return_value=f"{self.config['apparmor_profile']} (enforce)\n",
            ),
            patch.object(runner.os, "open", side_effect=PermissionError) as denied,
        ):
            runner.inspect_apparmor(self.config)
            self.assertEqual(denied.call_count, 2)
        with (
            patch.object(runner.Path, "read_text", return_value="unconfined\n"),
            self.assertRaisesRegex(ValueError, "not enforcing"),
        ):
            runner.inspect_apparmor(self.config)
        for effect in (None, FileNotFoundError("missing synthetic kernel path")):
            with (
                patch.object(
                    runner.Path,
                    "read_text",
                    return_value=f"{self.config['apparmor_profile']} (enforce)",
                ),
                patch.object(runner.os, "open", return_value=17, side_effect=effect),
                patch.object(runner.os, "close") as close,
                self.assertRaises((ValueError, FileNotFoundError)),
            ):
                runner.inspect_apparmor(self.config)
            if effect is None:
                close.assert_called_once_with(17)

    def test_profile_removal_requires_complete_readback_and_no_remaining_users(self):
        identifier = "a" * 64
        with patch.object(runner.subprocess, "check_output", return_value="") as query:
            runner.require_unused_policy()
            self.assertEqual(query.call_count, 1)
        with patch.object(
            runner.subprocess, "check_output", side_effect=[identifier, '"docker-default"\n']
        ):
            runner.require_unused_policy()
        for responses in (
            [identifier, json.dumps(self.config["apparmor_profile"])],
            [identifier, ""],
            [identifier, "not-json"],
            ["not-a-container-id"],
        ):
            with (
                patch.object(runner.subprocess, "check_output", side_effect=responses),
                self.assertRaises(ValueError),
            ):
                runner.require_unused_policy()
        with (
            patch.object(
                runner.subprocess,
                "check_output",
                side_effect=subprocess.CalledProcessError(1, "docker"),
            ),
            self.assertRaises(subprocess.SubprocessError),
        ):
            runner.require_unused_policy()

    @unittest.skipIf(sys.platform == "win32", "POSIX shell profile lifecycle contract")
    def test_profile_lifecycle_preserves_primary_exit_and_retains_used_or_unreadable_policy(self):
        script = runner.ROOT / "tools/linux-e2e/run.sh"
        subprocess.run(["bash", "-n", str(script)], check=True)
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            log = folder / "calls.log"
            python = folder / "python3"
            python.write_text(
                '#!/bin/sh\nprintf "python:%s\\n" "$2" >> "$OHTIA_TEST_LOG"\n'
                'case "$2" in\n policy-check) exit "${OHTIA_TEST_CHECK_EXIT:-0}";;\n'
                ' run) exit "${OHTIA_TEST_RUN_EXIT:-0}";;\n'
                ' policy-unused) exit "${OHTIA_TEST_UNUSED_EXIT:-0}";;\n'
                " *) exit 99;;\nesac\n"
            )
            sudo = folder / "sudo"
            sudo.write_text(
                '#!/bin/sh\nprintf "sudo:%s\\n" "$2" >> "$OHTIA_TEST_LOG"\n'
                'case "$2" in\n --add) exit "${OHTIA_TEST_ADD_EXIT:-0}";;\n'
                ' --remove) exit "${OHTIA_TEST_REMOVE_EXIT:-0}";;\n *) exit 99;;\nesac\n'
            )
            python.chmod(0o755)
            sudo.chmod(0o755)
            for check, add, run, unused, remove, expected in (
                (0, 0, 0, 0, 0, 0),
                (0, 0, 7, 0, 0, 7),
                (0, 0, 0, 1, 0, 1),
                (0, 0, 7, 1, 0, 7),
                (0, 0, 0, 0, 1, 1),
                (0, 0, 7, 0, 1, 7),
                (0, 3, 0, 0, 0, 3),
                (4, 0, 0, 0, 0, 4),
            ):
                log.unlink(missing_ok=True)
                environment = {
                    **os.environ,
                    "PATH": str(folder) + os.pathsep + os.environ.get("PATH", ""),
                    "OHTIA_TEST_LOG": str(log),
                    "OHTIA_TEST_CHECK_EXIT": str(check),
                    "OHTIA_TEST_ADD_EXIT": str(add),
                    "OHTIA_TEST_RUN_EXIT": str(run),
                    "OHTIA_TEST_UNUSED_EXIT": str(unused),
                    "OHTIA_TEST_REMOVE_EXIT": str(remove),
                }
                result = subprocess.run(
                    ["bash", str(script), "--output", "synthetic-output"],
                    env=environment,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, expected, result.stderr)
                events = log.read_text().splitlines()
                self.assertEqual("sudo:--add" in events, check == 0)
                self.assertEqual("python:run" in events, check == 0 and add == 0)
                self.assertEqual("sudo:--remove" in events, check == 0 and add == 0 and unused == 0)

    def test_no_mount_or_host_environment_option_is_in_the_launch_contract(self):
        args = runner.container_args(self.config, "synthetic-container")
        self.assertNotIn("--volume", args)
        self.assertNotIn("--mount", args)
        self.assertNotIn("--privileged", args)
        self.assertIn("--ipc=private", args)
        self.assertIn("--cap-drop=ALL", args)
        self.assertIn("--security-opt=systempaths=unconfined", args)
        self.assertIn(f"--security-opt=apparmor={self.config['apparmor_profile']}", args)
        self.assertIn(self.config["image"], args)
        self.assertNotIn("--env-host", args)

    def test_package_drift_is_rejected_before_container_preparation(self):
        original = runner.read_json

        def changed(file):
            value = original(file)
            if Path(file).name == "package.json":
                value["devDependencies"]["@playwright/test"] = "0.0.0"
            return value

        with (
            patch.object(runner, "read_json", side_effect=changed),
            self.assertRaisesRegex(ValueError, "parity"),
        ):
            runner.configuration()

    def test_invalid_and_duplicate_reports_are_not_recovered(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "report.json"
            for content in ('{"status":"failed","status":"passed"}', '{"status":'):
                file.write_text(content)
                with self.assertRaises(ValueError):
                    runner.read_json(file)
            file.unlink()
            with self.assertRaises(OSError):
                runner.read_json(file)

    def test_source_archive_cannot_transfer_credentials_or_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("synthetic credential fixture")
            with (
                patch.object(runner, "ROOT", root),
                patch.object(runner.subprocess, "check_output", return_value=b".env\0"),
                self.assertRaisesRegex(ValueError, "Credential"),
            ):
                runner.source_archive(root / "source.tar", {})
            (root / "link").symlink_to(root / ".env")
            with (
                patch.object(runner, "ROOT", root),
                patch.object(runner.subprocess, "check_output", return_value=b"link\0"),
                self.assertRaisesRegex(ValueError, "regular"),
            ):
                runner.source_archive(root / "linked.tar", {})

    def test_root_is_denied_before_preparation(self):
        if sys.platform != "linux":
            self.skipTest("The real Linux account API is unavailable on this host.")
        with (
            patch.object(runner.os, "getuid", return_value=0),
            self.assertRaisesRegex(ValueError, "Root"),
        ):
            runner.inside()

    def test_digest_cache_is_exact_and_engine_errors_never_trigger_an_image_fallback(self):
        image = {"Id": self.config["image_id"], "Architecture": "amd64", "Os": "linux"}
        with (
            patch.object(
                runner.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=0, stdout=json.dumps([image]), stderr=""),
            ),
            patch.object(runner, "command") as pull,
        ):
            self.assertEqual(runner.pinned_image("docker", self.config), (image, "cached"))
            pull.assert_not_called()
        with (
            patch.object(
                runner.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=1, stdout="", stderr="Cannot connect to engine"
                ),
            ),
            patch.object(runner, "command") as pull,
            self.assertRaisesRegex(ValueError, "restore engine access"),
        ):
            runner.pinned_image("docker", self.config)
        pull.assert_not_called()
        with (
            patch.object(
                runner.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=1, stdout="", stderr="No such image"),
            ),
            patch.object(runner, "command") as pull,
            patch.object(runner.subprocess, "check_output", return_value=json.dumps([image])),
        ):
            self.assertEqual(runner.pinned_image("docker", self.config), (image, "downloaded"))
        self.assertEqual(pull.call_args.args[0][-1], self.config["image"])

    def test_wrong_host_architecture_is_denied_before_creating_evidence(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(runner.platform, "system", return_value="Linux"),
            patch.object(runner.platform, "machine", return_value="aarch64"),
        ):
            output = Path(directory) / "attempt"
            with self.assertRaisesRegex(ValueError, "native Linux x86-64"):
                runner.run("docker", output)
            self.assertFalse(output.exists())

    def test_failed_stage_keeps_its_elapsed_time(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "timings.json"
            timings = {}
            with (
                self.assertRaisesRegex(ValueError, "seeded failure"),
                runner.measured(timings, "tests", file),
            ):
                raise ValueError("seeded failure")
            self.assertGreaterEqual(runner.read_json(file)["tests"], 0)

    def test_pull_request_identity_uses_event_head_base_and_actual_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "event.json"
            head, base, merge = "a" * 40, "b" * 40, "c" * 40
            file.write_text(
                json.dumps({"pull_request": {"head": {"sha": head}, "base": {"sha": base}}})
            )
            env = {
                "GITHUB_ACTIONS": "true",
                "GITHUB_EVENT_NAME": "pull_request",
                "GITHUB_EVENT_PATH": str(file),
                "GITHUB_SHA": merge,
            }

            def git(*args):
                if args == ("rev-parse", "HEAD"):
                    return merge
                if args == ("rev-parse", "HEAD^{tree}"):
                    return "d" * 40
                if args == ("merge-base", base, merge):
                    return base
                raise AssertionError(f"Unexpected Git query: {args}")

            with patch.object(runner, "git_text", side_effect=git):
                identity = runner.checkout_identity(env=env)
                self.assertEqual(identity["head"], head)
                self.assertEqual(identity["base"], base)
                self.assertEqual(identity["checkout_sha"], merge)
                with self.assertRaisesRegex(ValueError, "disagrees"):
                    runner.checkout_identity("e" * 40, env=env)
                with self.assertRaisesRegex(ValueError, "checkout differs"):
                    runner.checkout_identity(env={**env, "GITHUB_SHA": head})

    def test_runner_never_certifies_failed_incomplete_or_foreign_execution(self):
        for fault in (
            None,
            "exit",
            "identity",
            "report",
            "image",
            "host-policy",
            "copy",
            "cleanup",
            "exit-and-cleanup",
            "admission-and-copy",
            "timeout",
            "timeout-and-copy",
            "timeout-and-stop",
            "invalid-report",
            "exit-and-invalid-report",
        ):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "attempt"
                state = {}
                commands = []

                def archive(file, identity):
                    file.write_bytes(b"synthetic archive fixture")
                    state["identity"] = identity

                def execute(args, **kwargs):
                    commands.append(args)
                    if args[1] == "cp":
                        if fault in ("copy", "admission-and-copy", "timeout-and-copy"):
                            raise subprocess.CalledProcessError(1, args)
                        folder = output / "container"
                        folder.mkdir()
                        identity = (
                            state["identity"] if fault != "identity" else {"run": "another-run"}
                        )
                        (folder / "input.json").write_text(json.dumps(identity))
                        for report in self.reports:
                            if fault == "report" and report["shard"] == "electron":
                                continue
                            report = {**report, "identity": state["identity"]}
                            (folder / f"{report['shard']}.json").write_text(
                                "{invalid synthetic JSON"
                                if fault in ("invalid-report", "exit-and-invalid-report")
                                else json.dumps(report)
                            )
                    if args[1] == "stop" and fault == "timeout-and-stop":
                        raise subprocess.CalledProcessError(1, args)
                    if args[1] == "rm" and fault in ("cleanup", "exit-and-cleanup"):
                        raise subprocess.CalledProcessError(1, args)
                    return SimpleNamespace(returncode=0)

                def inspect(args, **kwargs):
                    if args[1] == "info":
                        if args[-1] == "{{json .SecurityOptions}}":
                            return json.dumps([] if fault == "host-policy" else ["name=apparmor"])
                        return json.dumps("x86_64")
                    if args[1] == "image":
                        return json.dumps(
                            [
                                {
                                    "Architecture": "arm64" if fault == "image" else "amd64",
                                    "Os": "linux",
                                    "Id": self.config["image_id"],
                                }
                            ]
                        )
                    return json.dumps([self.policy()])

                with (
                    patch.object(runner, "configuration", return_value=self.config),
                    patch.object(
                        runner,
                        "pinned_image",
                        side_effect=lambda *args: (
                            {
                                "Architecture": "arm64" if fault == "image" else "amd64",
                                "Os": "linux",
                                "Id": self.config["image_id"],
                            },
                            "cached",
                        ),
                    ),
                    patch.object(
                        runner,
                        "checkout_identity",
                        return_value={"head": "a" * 40, "base": "b" * 40},
                    ),
                    patch.object(runner.platform, "system", return_value="Linux"),
                    patch.object(runner.platform, "machine", return_value="x86_64"),
                    patch.object(runner, "source_archive", side_effect=archive),
                    patch.object(runner, "command", side_effect=execute),
                    patch.object(runner.subprocess, "check_output", side_effect=inspect),
                    patch.object(
                        runner.subprocess,
                        "run",
                        return_value=SimpleNamespace(
                            returncode=1
                            if fault
                            in (
                                "exit",
                                "exit-and-cleanup",
                                "admission-and-copy",
                                "exit-and-invalid-report",
                            )
                            else 0
                        ),
                        side_effect=subprocess.TimeoutExpired("synthetic docker attach", 600)
                        if fault and fault.startswith("timeout")
                        else None,
                    ),
                    contextlib.redirect_stdout(io.StringIO()),
                ):
                    if fault is None:
                        runner.run("docker", output)
                    else:
                        with self.assertRaises((ValueError, subprocess.SubprocessError)) as raised:
                            runner.run("docker", output)
                        if fault in (
                            "exit-and-cleanup",
                            "admission-and-copy",
                            "exit-and-invalid-report",
                        ):
                            self.assertIn(
                                "Container preparation/tests failed", str(raised.exception)
                            )
                result = runner.read_json(output / "result.json")
                self.assertEqual(result["status"], "passed" if fault is None else "failed")
                if fault and fault.startswith("timeout"):
                    self.assertIsInstance(raised.exception, subprocess.TimeoutExpired)
                    operations = [args[1] for args in commands]
                    self.assertLess(operations.index("stop"), operations.index("cp"))
                    self.assertLess(operations.index("cp"), operations.index("rm"))
                    self.assertIn("execution_error", result)
                    if fault != "timeout-and-copy":
                        self.assertTrue((output / "container/input.json").exists())
                        self.assertEqual(len(result["reports"]), 2)
                if fault in ("invalid-report", "exit-and-invalid-report"):
                    self.assertIn("report_errors", result)
                if fault in ("admission-and-copy", "timeout-and-copy"):
                    self.assertIn("evidence_error", result)
                if fault == "timeout-and-stop":
                    self.assertIn("stop_error", result)
                if fault in ("cleanup", "exit-and-cleanup"):
                    self.assertIn("cleanup_error", result)
                if fault not in ("image", "host-policy"):
                    self.assertTrue(any(args[1] == "rm" for args in commands))
                with (
                    patch.object(runner.platform, "system", return_value="Linux"),
                    patch.object(runner.platform, "machine", return_value="x86_64"),
                    self.assertRaisesRegex(ValueError, "new output"),
                ):
                    runner.run("docker", output)


if __name__ == "__main__":
    unittest.main()
