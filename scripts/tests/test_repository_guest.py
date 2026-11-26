"""Contracts of the maintainer guest tool; no guest is provisioned or reached."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import repository_guest as guest

KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMruEUmE3OYMZMDue90Xwd5yYscxNBfhInz12LHPb9Jl test"
COMMIT = "a" * 40
RUN = {"OHTIA_RELEASE_VERSION": "0.2.2", "GITHUB_RUN_ID": "7", "GITHUB_RUN_ATTEMPT": "1"}


class RepositoryGuestTests(unittest.TestCase):
    def test_only_the_arm64_guest_cells_run_on_maintainer_guests(self):
        for profile in ("debian-13", "fedora-44", "fedora-45"):
            for desktop in ("gnome", "kde"):
                cell_id = f"linux-arm64-{profile}-{desktop}"
                with self.subTest(cell=cell_id):
                    cell = guest.guest_cell(cell_id)
                    self.assertEqual((cell["target"], cell["launcher"]), ("linux-arm64", "guest"))
        for hosted in ("linux-arm64-ubuntu-26-04-gnome", "linux-x64-fedora-44-gnome", "unknown"):
            with self.subTest(cell=hosted), self.assertRaises(ValueError):
                guest.guest_cell(hosted)

    def test_provisioning_follows_the_ci_guest_and_adds_the_arm_packages(self):
        fedora_kde = guest.provision_script(guest.guest_cell("linux-arm64-fedora-45-kde"), KEY)
        debian_gnome = guest.provision_script(guest.guest_cell("linux-arm64-debian-13-gnome"), KEY)
        for script in (fedora_kde, debian_gnome):
            lines = script.splitlines()
            self.assertEqual(lines[0], "set -eux")
            # A guest that already served a cell is refused before anything changes.
            self.assertLess(lines.index("test ! -e /opt/ohtia"), lines.index("passwd -l ohtia"))
            self.assertIn("printf 'ohtia ALL=(ALL) NOPASSWD:ALL\\n' > /etc/sudoers.d/ohtia", lines)
            self.assertNotIn("/sys/block/vdb/serial", script)
            self.assertEqual(
                lines[-2:], ["loginctl enable-linger ohtia", "touch /var/lib/ohtia-ready"]
            )
        for script in (fedora_kde, debian_gnome):
            lines = script.splitlines()
            installs = [
                i for i, line in enumerate(lines) if " install " in line and "useradd" not in line
            ]
            # The packages come before the account, so a failed transfer can be repeated.
            self.assertLess(max(installs), lines.index("passwd -l ohtia") - 1)
        # cloud-init installs the KVM guest's packages with Debian's default recommendations.
        self.assertIn("apt-get install -y python3 ", debian_gnome)
        self.assertNotIn("--no-install-recommends python3", debian_gnome)
        self.assertIn("libatomic mesa-libgbm xdg-utils", fedora_kde)
        self.assertIn("modprobe vgem", fedora_kde)
        self.assertIn("fedora-release-identity-kde-desktop", fedora_kde)
        self.assertNotIn("gnome-shell", fedora_kde)
        self.assertIn("libatomic1 e2fsprogs", debian_gnome)
        self.assertIn("gnome-shell", debian_gnome)
        self.assertNotIn("modprobe vgem", debian_gnome)
        for invalid in ("ssh-rsa AAAA test", "ssh-ed25519 AAAA test\nrm -rf /", ""):
            with self.subTest(key=invalid), self.assertRaises(ValueError):
                guest.provision_script(guest.guest_cell("linux-arm64-debian-13-kde"), invalid)

    def test_the_guest_environment_names_the_release_and_its_run(self):
        cell = guest.guest_cell("linux-arm64-fedora-44-gnome")
        digests = {"schema_version": 1, "version": "0.2.2", "source": {"commit": COMMIT}}
        values = guest.environment(cell, COMMIT, digests, RUN)
        self.assertEqual(values["OHTIA_QUALITY_VM"], "linux-arm64-fedora-44-gnome")
        self.assertEqual(values["OHTIA_GUEST_TASK"], "quality:repository")
        self.assertEqual(
            {values[key] for key in ("GITHUB_SHA", "OHTIA_SOURCE_COMMIT", "OHTIA_RELEASE_COMMIT")},
            {COMMIT},
        )
        self.assertEqual(json.loads(values["OHTIA_RELEASE_DIGESTS"]), digests)
        self.assertEqual((values["GITHUB_RUN_ID"], values["GITHUB_RUN_ATTEMPT"]), ("7", "1"))
        for name, changed_digests, env in (
            ("other commit", {**digests, "source": {"commit": "b" * 40}}, RUN),
            ("other version", {**digests, "version": "0.2.1"}, RUN),
            ("development version", digests, {**RUN, "OHTIA_RELEASE_VERSION": "0.2.2-dev.7.1"}),
            ("no run", digests, {**RUN, "GITHUB_RUN_ID": "0"}),
            ("malformed attempt", digests, {**RUN, "GITHUB_RUN_ATTEMPT": "1; true"}),
        ):
            with self.subTest(name), self.assertRaises(ValueError):
                guest.environment(cell, COMMIT, changed_digests, env)

    def test_a_run_retains_its_report_and_records_the_guest_outcome(self):
        cell = guest.guest_cell("linux-arm64-debian-13-kde")
        digests = {"schema_version": 1, "version": "0.2.2", "source": {"commit": COMMIT}}
        for name, guest_outcome, copy_code, expected in (
            ("passed", 0, 0, 0),
            ("failed before a report", 1, 1, 1),
            ("timed out", "timeout", 0, 1),
            ("report copy timed out", 0, "timeout", 1),
        ):
            with self.subTest(name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "digests.json").write_text(json.dumps(digests))
                calls = []

                def fake(args, **kwargs):
                    args = [str(arg) for arg in args]
                    calls.append(args)
                    if args[0] == "ssh":
                        if guest_outcome == "timeout":
                            raise subprocess.TimeoutExpired(args, 5400)
                        return subprocess.CompletedProcess(args, guest_outcome)
                    if copy_code == "timeout":
                        raise subprocess.TimeoutExpired(args, 600)
                    return subprocess.CompletedProcess(args, copy_code)

                with (
                    patch.dict(os.environ, RUN),
                    patch.object(guest.delivery, "git", side_effect=[COMMIT, ""]),
                    patch.object(guest, "known_hosts", return_value=root / "known_hosts"),
                    patch.object(guest, "run"),
                    patch.object(guest.subprocess, "run", side_effect=fake),
                ):
                    code = guest.qualify(
                        cell, "192.0.2.10", root / "key", root / "digests.json", root / "report"
                    )
                record = json.loads((root / "report/guest.json").read_text())
                self.assertEqual(code, expected)
                self.assertEqual(record["timed_out"], guest_outcome == "timeout")
                self.assertEqual(record["report_copied"], copy_code == 0)
                self.assertEqual(
                    record["guest_exit"], None if guest_outcome == "timeout" else guest_outcome
                )
                # The report is copied back after the guest ran, whatever its outcome.
                self.assertEqual([call[0] for call in calls], ["ssh", "scp"])
                self.assertIn(f"ohtia@192.0.2.10:/home/ohtia/source/{guest.REPORTS}/*", calls[1])

    def test_the_command_refuses_other_cells_and_addresses_before_connecting(self):
        for arguments in (
            ["provision", "linux-x64-debian-13-gnome", "192.0.2.10", "key"],
            ["provision", "linux-arm64-debian-13-gnome", "guest.example", "key"],
            ["provision", "linux-arm64-debian-13-gnome", "192.0.2.10;true", "key"],
        ):
            with (
                self.subTest(arguments=arguments),
                patch.dict(os.environ, {}, clear=False),
                patch.object(sys, "argv", ["repository_guest.py", *arguments]),
                patch.object(guest, "run") as run,
            ):
                self.assertEqual(guest.main(), 1)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
