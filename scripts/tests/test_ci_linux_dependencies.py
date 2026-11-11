"""Exercise host package selection and bounded provisioning without changing host packages."""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ci_linux_dependencies as dependencies


def process_stopped(pid: int) -> bool:
    """Treat a missing, reaped or zombie process as stopped.

    Reading `/proc/<pid>/stat` raises `ProcessLookupError` when the process is reaped between
    opening and reading the file, and `FileNotFoundError` once it has been reaped.
    """
    try:
        return Path(f"/proc/{pid}/stat").read_text().split()[2] == "Z"
    except (FileNotFoundError, ProcessLookupError):
        return True


class LinuxDependenciesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.apt = self.root / "apt"
        self.parts = self.apt / "sources.list.d"
        self.parts.mkdir(parents=True)
        self.source = self.parts / "ubuntu.sources"
        self.source.write_text(
            "Types: deb\n"
            f"URIs: {dependencies.MIRROR_SOURCE}\n"
            "Suites: resolute resolute-updates resolute-security resolute-backports\n"
            "Components: main restricted universe multiverse\n"
            "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        )
        self.mirrors = self.apt / "apt-mirrors.txt"
        self.mirrors.write_text(
            "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
            "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
            "https://security.ubuntu.com/ubuntu/\tpriority:3\n"
        )
        self.inventory = self.root / "packages.txt"
        self.lists = self.root / "lists"
        self.lists.mkdir()
        for suite in dependencies.FRESH_SUITES:
            self.write_index(suite, datetime.now(UTC) - timedelta(hours=6))
        self.real_resolves = dependencies.resolves
        resolver = patch.object(dependencies, "resolves", return_value=True)
        self.resolves = resolver.start()
        self.addCleanup(resolver.stop)

    def write_index(self, suite, date, prefix="mirror+file:%2fetc%2fapt%2fapt-mirrors.txt"):
        header = f"Date: {format_datetime(date, usegmt=True)}\n" if date else ""
        (self.lists / f"{prefix}_dists_{suite}_InRelease").write_text(
            "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
            f"Origin: Ubuntu\nSuite: {suite}\n{header}Components: main\n"
        )

    def provision(self):
        with patch.object(dependencies, "gnu_timeout", return_value="/synthetic/gnutimeout"):
            dependencies.provision(
                "linux-x64-ubuntu-26-04-gnome",
                "display-session",
                self.apt,
                self.inventory,
                self.lists,
            )

    def test_gnu_timeout_prefers_prefixed_tool_and_verifies_fallback(self):
        for found, selected in (
            (["/usr/bin/gnutimeout"], "/usr/bin/gnutimeout"),
            ([None, "/usr/bin/timeout"], "/usr/bin/timeout"),
        ):
            with (
                self.subTest(selected=selected),
                patch.object(dependencies.shutil, "which", side_effect=found),
                patch.object(
                    dependencies.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess(
                        [], 0, "timeout (GNU coreutils) 9.7\n"
                    ),
                ) as execute,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(dependencies.gnu_timeout(), selected)
            self.assertEqual(execute.call_args.args[0], [selected, "--version"])

    def test_non_gnu_missing_or_unverifiable_timeout_fails_before_apt_changes(self):
        original = self.mirrors.read_bytes()
        for found, result in (
            (None, subprocess.CompletedProcess([], 0, "")),
            ("/timeout", subprocess.CompletedProcess([], 0, "timeout (uutils coreutils) 0.10.0\n")),
            ("/timeout", subprocess.CompletedProcess([], 1, "timeout (GNU coreutils) 9.7\n")),
            ("/timeout", subprocess.TimeoutExpired(["/timeout", "--version"], 5)),
            ("/timeout", OSError("synthetic missing executable")),
        ):
            with (
                self.subTest(found=found, result=str(result)),
                patch.object(dependencies.shutil, "which", return_value=found),
                patch.object(
                    dependencies.subprocess,
                    "run",
                    side_effect=result if isinstance(result, Exception) else None,
                    return_value=result,
                ),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaises(dependencies.ProvisionError),
            ):
                dependencies.provision(
                    "linux-x64-ubuntu-26-04-gnome", "display-session", self.apt, self.inventory
                )
            self.assertEqual(self.mirrors.read_bytes(), original)
            self.assertFalse(self.inventory.exists())

    def test_every_linux_matrix_cell_keeps_its_own_desktop_authority(self):
        cells = json.loads((dependencies.ROOT / "config/quality/build-targets.json").read_text())[
            "cells"
        ]
        for cell in cells:
            if not cell["target"].startswith("linux-"):
                continue
            with self.subTest(cell=cell["id"]):
                packages = dependencies.packages_for(cell["id"], cell["launcher"])
                if cell["launcher"] == "kvm":
                    self.assertEqual(
                        set(packages),
                        {"qemu-system-x86", "qemu-utils", "cloud-image-utils", "iproute2", "acl"},
                    )
                else:
                    self.assertFalse(
                        {"qemu-system-x86", "qemu-utils", "cloud-image-utils"} & set(packages)
                    )
                    if cell["desktop"] == "gnome":
                        self.assertTrue({"gnome-shell", "gnome-session"} <= set(packages))
                        self.assertNotIn("kubuntu-desktop", packages)
                    else:
                        self.assertIn("kubuntu-desktop", packages)
                        self.assertFalse({"gnome-shell", "gnome-session"} & set(packages))

    def test_invalid_cell_or_mismatched_launcher_fails_before_package_work(self):
        for cell, launcher in (
            ("unknown", "kvm"),
            ("win32-x64-windows-server-2025", "workspace"),
            ("linux-x64-debian-13-gnome", "display-session"),
            ("linux-arm64-ubuntu-26-04-kde", "kvm"),
        ):
            with self.subTest(cell=cell), self.assertRaises(dependencies.ProvisionError):
                dependencies.packages_for(cell, launcher)

    def test_mirror_selection_preserves_source_bytes_and_authentication(self):
        for filename in ("ubuntu.sources", "ubuntu.list"):
            with self.subTest(format=filename):
                if filename.endswith(".list"):
                    self.source.unlink()
                    self.source = self.apt / "sources.list"
                    self.source.write_text(
                        "deb [arch=arm64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] "
                        f"{dependencies.MIRROR_SOURCE} resolute main universe\n"
                    )
                original = self.source.read_bytes()
                other = self.parts / "vendor.list"
                other.write_text(
                    "deb [signed-by=/vendor.gpg] https://vendor.invalid/ stable main\n"
                )
                vendor = other.read_bytes()
                with contextlib.redirect_stdout(io.StringIO()):
                    dependencies.configure_mirrors(self.apt)
                self.assertEqual(self.source.read_bytes(), original)
                self.assertEqual(other.read_bytes(), vendor)
                self.assertEqual(
                    self.mirrors.read_text().splitlines(),
                    [
                        "https://archive.ubuntu.com/ubuntu/\tpriority:1",
                        "https://security.ubuntu.com/ubuntu/\tpriority:2",
                        "https://mirrors.edge.kernel.org/ubuntu/\tpriority:3",
                        "https://mirrors.mit.edu/ubuntu/\tpriority:4",
                    ],
                )

    def test_unresolvable_mirrors_are_skipped_in_their_declared_order(self):
        self.resolves.side_effect = lambda host: not host.endswith("ubuntu.com")
        with contextlib.redirect_stdout(io.StringIO()) as output:
            dependencies.configure_mirrors(self.apt)
        self.assertEqual(
            self.mirrors.read_text().splitlines(),
            [
                "https://mirrors.edge.kernel.org/ubuntu/\tpriority:1",
                "https://mirrors.mit.edu/ubuntu/\tpriority:2",
            ],
        )
        self.assertEqual(
            [call.args[0] for call in self.resolves.call_args_list],
            [
                "archive.ubuntu.com",
                "security.ubuntu.com",
                "mirrors.edge.kernel.org",
                "mirrors.mit.edu",
            ],
        )
        self.assertIn("archive.ubuntu.com did not resolve", output.getvalue())

    def test_no_resolvable_mirror_fails_before_any_apt_command(self):
        original = self.mirrors.read_bytes()
        self.resolves.return_value = False
        with (
            patch.object(dependencies.subprocess, "run") as execute,
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(dependencies.ProvisionError, "No Ubuntu APT mirror resolved"),
        ):
            self.provision()
        execute.assert_not_called()
        self.assertEqual(self.mirrors.read_bytes(), original)
        self.assertFalse(self.inventory.exists())

    def test_host_lookup_is_bounded_and_failures_count_as_unresolved(self):
        for outcome, expected in (
            (subprocess.CompletedProcess([], 0, b"151.101.1.1 STREAM host\n"), True),
            (subprocess.CompletedProcess([], 2, b""), False),
            (subprocess.CompletedProcess([], 0, b""), False),
            (subprocess.TimeoutExpired(["getent"], 10), False),
            (OSError("synthetic missing getent"), False),
        ):
            with (
                self.subTest(outcome=str(outcome)),
                patch.object(
                    dependencies.subprocess,
                    "run",
                    side_effect=outcome if isinstance(outcome, Exception) else None,
                    return_value=outcome,
                ) as execute,
            ):
                self.assertIs(self.real_resolves("mirror.invalid"), expected)
            self.assertEqual(execute.call_args.args[0], ["getent", "ahosts", "mirror.invalid"])
            self.assertEqual(execute.call_args.kwargs["timeout"], 10)

    def test_stale_missing_or_undated_indexes_stop_before_downloading(self):
        for case in ("stale", "missing", "undated"):
            for path in self.lists.iterdir():
                path.unlink()
            for suite in dependencies.FRESH_SUITES:
                self.write_index(suite, datetime.now(UTC) - timedelta(hours=6))
            if case == "stale":
                self.write_index("resolute-updates", datetime.now(UTC) - timedelta(days=8))
            elif case == "missing":
                next(self.lists.glob("*resolute-security_InRelease")).unlink()
            else:
                self.write_index("resolute-security", None)
            calls = []

            def execute(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 0)

            with (
                self.subTest(case=case),
                patch.object(dependencies.subprocess, "run", side_effect=execute),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaises(dependencies.ProvisionError),
            ):
                self.provision()
            self.assertEqual(len(calls), 1)
            self.assertIn("update", calls[0])

    def test_index_age_limit_is_seven_days(self):
        now = datetime(2026, 11, 11, 12, tzinfo=UTC)
        for suite in dependencies.FRESH_SUITES:
            self.write_index(suite, now - timedelta(days=7))
        with contextlib.redirect_stdout(io.StringIO()):
            dependencies.check_index_freshness(self.lists, now)
        self.write_index("resolute-security", now - timedelta(days=7, seconds=1))
        with self.assertRaisesRegex(dependencies.ProvisionError, "more than 7 days old"):
            dependencies.check_index_freshness(self.lists, now)

    def test_source_drift_fails_without_rewriting_the_mirror_list(self):
        original = self.mirrors.read_bytes()
        for content in (
            "URIs: https://archive.ubuntu.com/ubuntu/\n",
            f"URIs: {dependencies.MIRROR_SOURCE} http://azure.archive.ubuntu.com/ubuntu/\n",
        ):
            self.source.write_text(content)
            with self.subTest(content=content), self.assertRaises(dependencies.ProvisionError):
                dependencies.configure_mirrors(self.apt)
            self.assertEqual(self.mirrors.read_bytes(), original)
        self.source.write_text(f"URIs: {dependencies.MIRROR_SOURCE}\n")
        self.mirrors.unlink()
        with self.assertRaises(dependencies.ProvisionError):
            dependencies.configure_mirrors(self.apt)

    def test_successful_phases_share_budget_and_install_only_downloaded_archives(self):
        now = [0.0]
        calls = []

        def execute(command, **kwargs):
            calls.append((command, kwargs))
            now[0] += 100
            if kwargs["stdout"]:
                kwargs["stdout"].write("synthetic-package 1.0\n")
            return subprocess.CompletedProcess(command, 0)

        with (
            patch.object(dependencies.time, "monotonic", side_effect=lambda: now[0]),
            patch.object(dependencies.subprocess, "run", side_effect=execute),
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            self.provision()
        commands = [command for command, _ in calls]
        self.assertTrue(all(command[0] == "/synthetic/gnutimeout" for command in commands))
        self.assertEqual(
            [command[3] for command in commands], ["715.000s", "615.000s", "515.000s", "415.000s"]
        )
        self.assertIn("--error-on=any", commands[0])
        self.assertIn("--download-only", commands[1])
        self.assertIn("--no-download", commands[2])
        self.assertEqual(
            commands[1][commands[1].index("install") :], commands[2][commands[2].index("install") :]
        )
        self.assertIn("--no-install-recommends", commands[2])
        self.assertEqual(commands[3][4:], ["dpkg-query", "-W"])
        for _, kwargs in calls:
            self.assertEqual(kwargs["env"]["DEBIAN_FRONTEND"], "noninteractive")
        self.assertEqual(self.inventory.read_text(), "synthetic-package 1.0\n")
        for phase in (
            "index refresh",
            "archive acquisition",
            "installation/configuration",
            "package inventory",
        ):
            self.assertIn(f"Provisioning {phase}: exit=0; elapsed=100.0s", output.getvalue())

    def test_source_download_and_install_errors_stop_before_the_next_phase(self):
        for failed in range(3):
            calls = []

            def execute(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 100 if len(calls) == failed + 1 else 0)

            with (
                self.subTest(failed=failed),
                patch.object(dependencies.subprocess, "run", side_effect=execute),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaisesRegex(dependencies.ProvisionError, "failed.*100"),
            ):
                self.provision()
            self.assertEqual(len(calls), failed + 1)
            self.assertFalse(self.inventory.exists())

    def test_exhausted_budget_never_starts_another_child(self):
        for deadline in (104, 105, 105.0004):
            with (
                self.subTest(deadline=deadline),
                patch.object(dependencies.time, "monotonic", return_value=100),
                patch.object(dependencies.subprocess, "run") as execute,
                self.assertRaisesRegex(dependencies.ProvisionError, "budget exhausted before"),
            ):
                dependencies.run_phase(
                    "archive acquisition",
                    ["apt-get"],
                    deadline,
                    timeout_executable="/synthetic/gnutimeout",
                )
            execute.assert_not_called()
        with (
            patch.object(dependencies.time, "monotonic", return_value=100),
            patch.object(
                dependencies.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
            ) as execute,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            dependencies.run_phase(
                "archive acquisition",
                ["apt-get"],
                105.0011,
                timeout_executable="/synthetic/gnutimeout",
            )
        self.assertEqual(execute.call_args.args[0][3], "0.001s")

    def test_external_kill_is_not_misreported_as_an_exhausted_budget(self):
        for code in (-9, 137):
            with (
                self.subTest(code=code),
                patch.object(
                    dependencies.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], code),
                ),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaisesRegex(
                    dependencies.ProvisionError, "was killed.*external termination"
                ),
            ):
                dependencies.run_phase(
                    "archive acquisition",
                    ["apt-get"],
                    time.monotonic() + 100,
                    timeout_executable="/synthetic/gnutimeout",
                )

    @unittest.skipUnless(
        sys.platform.startswith("linux") and shutil.which("timeout"), "GNU timeout on Linux"
    )
    def test_real_budget_stops_stalled_and_continuously_progressing_process_groups(self):
        timeout_executable = dependencies.gnu_timeout()
        for progressing, force_kill in ((False, False), (False, True), (True, True)):
            pidfile = self.root / f"pids-{progressing}-{force_kill}.txt"
            child = (
                "import os,signal,time\n"
                + ("signal.signal(signal.SIGTERM, signal.SIG_IGN)\n" if force_kill else "")
                + "while True: time.sleep(.01)\n"
            )
            program = (
                "import os,signal,subprocess,sys,time\n"
                "from pathlib import Path\n"
                + ("signal.signal(signal.SIGTERM, signal.SIG_IGN)\n" if force_kill else "")
                + f"child=subprocess.Popen([sys.executable,'-c',{child!r}])\n"
                f"Path({str(pidfile)!r}).write_text(str(os.getpid())+' '+str(child.pid))\n"
                "while True:\n"
                + (" print('synthetic transfer progress',flush=True)\n" if progressing else "")
                + " time.sleep(.01)\n"
            )
            with (
                self.subTest(progressing=progressing, force_kill=force_kill),
                patch.object(dependencies, "KILL_GRACE_SECONDS", 0.1),
                contextlib.redirect_stdout(io.StringIO()),
                self.inventory.open("w") as log,
            ):
                started = time.monotonic()
                message = "was killed" if force_kill else "budget exhausted during"
                with self.assertRaisesRegex(dependencies.ProvisionError, message):
                    dependencies.run_phase(
                        "archive acquisition",
                        [sys.executable, "-c", program],
                        started + 1.5,
                        timeout_executable=timeout_executable,
                        stdout=log,
                    )
                self.assertLess(time.monotonic() - started, 5)
            self.assertTrue(
                pidfile.exists(), "Synthetic transfer did not start before its deadline"
            )

            pids = list(map(int, pidfile.read_text().split()))
            settled = time.monotonic() + 1
            while not all(process_stopped(pid) for pid in pids) and time.monotonic() < settled:
                time.sleep(0.01)
            self.assertTrue(
                all(process_stopped(pid) for pid in pids),
                f"Synthetic children survived termination: {pids}",
            )
            if progressing:
                self.assertIn("synthetic transfer progress", self.inventory.read_text())

    def test_process_stopped_treats_missing_reaped_and_zombie_processes_as_stopped(self):
        for label, outcome, expected in (
            ("missing", FileNotFoundError(2, "No such file or directory"), True),
            ("reaped during the read", ProcessLookupError(3, "No such process"), True),
            ("zombie", "4242 (python3) Z 1 4242 4242 0 -1 4194560\n", True),
            ("sleeping", "4242 (python3) S 1 4242 4242 0 -1 4194560\n", False),
        ):
            with (
                self.subTest(process=label),
                patch.object(
                    Path,
                    "read_text",
                    **(
                        {"side_effect": outcome}
                        if isinstance(outcome, Exception)
                        else {"return_value": outcome}
                    ),
                ) as read,
            ):
                self.assertIs(process_stopped(4242), expected)
                read.assert_called_once_with()

    def test_workflow_invokes_the_bounded_helper_with_an_outer_timeout(self):
        workflow = (dependencies.ROOT / ".github/workflows/ci.yml").read_text()
        step = workflow.split("- name: Prepare native Linux dependencies\n", 1)[1].split(
            "\n      - name:", 1
        )[0]
        self.assertIn("timeout-minutes: 15", step)
        self.assertIn(
            'scripts/ci_linux_dependencies.py "$OHTIA_QUALITY_CELL" "$OHTIA_QUALITY_LAUNCHER"', step
        )
        self.assertIn("--preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,RUNNER_TEMP", step)
        self.assertNotIn("apt-get", step)

    def test_main_rejects_local_execution_before_mutating_sources(self):
        with (
            patch.object(sys, "argv", ["ci_linux_dependencies.py", "cell", "kvm"]),
            patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}),
            patch.object(dependencies, "provision") as provision,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(dependencies.main(), 1)
        provision.assert_not_called()


if __name__ == "__main__":
    unittest.main()
