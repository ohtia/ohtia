"""Contracts of the repository qualification harness; no native installation is simulated as passing."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import repository_qualification as qualification

COMMIT = "a" * 40
CELL = {"target": "linux-x64", "profile": "ubuntu-26.04", "formats": ["deb"]}


def digests(**changes) -> dict:
    record = {
        "schema_version": 1,
        "version": "0.2.2",
        "source": {"commit": COMMIT, "tree": "b" * 40},
        "assets": [
            {
                "name": "ohtia-0.2.2-linux-x64-ubuntu-26.04.deb",
                "target": "linux-x64",
                "profile": "ubuntu-26.04",
                "format": "deb",
                "bytes": 127815168,
                "sha256": "c" * 64,
                "authentication": "repository",
            },
            {
                "name": "ohtia-0.2.2-linux-x64-debian-13.deb",
                "target": "linux-x64",
                "profile": "debian-13",
                "format": "deb",
                "bytes": 127814948,
                "sha256": "d" * 64,
                "authentication": "repository",
            },
        ],
    }
    record.update(changes)
    return record


def environment(record: dict, version: str = "0.2.2", commit: str = COMMIT) -> dict:
    return {
        "OHTIA_RELEASE_VERSION": version,
        "OHTIA_RELEASE_COMMIT": commit,
        "OHTIA_RELEASE_DIGESTS": json.dumps(record),
    }


# The simulation apt 3.2 printed on Ubuntu 26.04 for an update from the test repository.
SIMULATION = """\
Reading package lists...
Building dependency tree...
The following packages will be upgraded:
  ohtia
1 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Inst ohtia [0.2.2~dev.7.1-1] (0.2.2-1 Ohtia:packages.ohtia.com [amd64])
Conf ohtia (0.2.2-1 Ohtia:packages.ohtia.com [amd64])
"""


class RepositoryQualificationTests(unittest.TestCase):
    def test_covers_the_x86_64_linux_cells_of_the_quality_inventory(self):
        cells = json.loads((qualification.ROOT / "config/quality/build-targets.json").read_text())[
            "cells"
        ]
        declared = [cell["id"] for cell in cells if cell["target"] == "linux-x64"]
        self.assertEqual(len(declared), 8)
        for cell_id in declared:
            with self.subTest(cell=cell_id):
                cell = qualification.declared_cell(cell_id)
                self.assertIn(cell["launcher"], {"display-session", "kvm"})
        fedora = qualification.declared_cell("linux-x64-fedora-45-kde")
        self.assertEqual((fedora["desktop"], fedora["formats"]), ("kde", ["rpm"]))
        for other in ("linux-arm64-ubuntu-26-04-gnome", "win32-x64-windows-server-2025", "unknown"):
            with self.subTest(cell=other), self.assertRaises(ValueError):
                qualification.declared_cell(other)

    def test_each_desktop_selects_its_scenario(self):
        for cell_id, chosen in (
            ("linux-x64-fedora-44-gnome", "qualify"),
            ("linux-x64-debian-13-kde", "qualify_short"),
        ):
            with (
                self.subTest(cell=cell_id),
                patch.object(sys, "argv", ["repository_qualification.py", cell_id, "out"]),
                patch.object(qualification, "qualify") as complete,
                patch.object(qualification, "qualify_short") as short,
            ):
                self.assertEqual(qualification.main(), 0)
                (complete if chosen == "qualify" else short).assert_called_once()
                (short if chosen == "qualify" else complete).assert_not_called()

    def test_fedora_expects_the_signed_rpm_of_its_release(self):
        rpm = {
            "name": "ohtia-0.2.2-linux-x64-fedora-45.rpm",
            "target": "linux-x64",
            "profile": "fedora-45",
            "format": "rpm",
            "bytes": 114093859,
            "sha256": "e" * 64,
            "authentication": "embedded",
        }
        cell = {"target": "linux-x64", "profile": "fedora-45", "formats": ["rpm"]}
        record = digests()
        self.assertEqual(
            qualification.expected_package(digests(assets=[*record["assets"], rpm]), cell),
            {"name": rpm["name"], "sha256": "e" * 64, "bytes": 114093859},
        )
        for name, changed in (
            ("repository authentication", {**rpm, "authentication": "repository"}),
            ("unsafe name", {**rpm, "name": "../ohtia.rpm"}),
        ):
            with self.subTest(name), self.assertRaises(ValueError):
                qualification.expected_package(digests(assets=[changed]), cell)

    def test_reads_only_the_digest_file_of_the_prepared_version_and_commit(self):
        inputs = qualification.release_inputs(environment(digests()))
        self.assertEqual((inputs["version"], inputs["commit"]), ("0.2.2", COMMIT))
        refused = (
            environment(digests(version="0.2.1")),
            environment(digests(source={"commit": "e" * 40})),
            environment(digests(schema_version=2)),
            environment(digests(), version="0.2.2-dev.7.1"),
            environment(digests(), commit="A" * 40),
            {**environment(digests()), "OHTIA_RELEASE_DIGESTS": "[]"},
        )
        for env in refused:
            with self.subTest(env=env), self.assertRaises(ValueError):
                qualification.release_inputs(env)

    def test_expects_the_single_repository_authenticated_deb_of_the_cell(self):
        self.assertEqual(
            qualification.expected_package(digests(), CELL),
            {
                "name": "ohtia-0.2.2-linux-x64-ubuntu-26.04.deb",
                "sha256": "c" * 64,
                "bytes": 127815168,
            },
        )
        record = digests()
        missing = digests(assets=record["assets"][1:])
        twice = digests(assets=[record["assets"][0], *record["assets"]])
        unsigned = digests(assets=[{**record["assets"][0], "authentication": "unsigned"}])
        malformed = digests(assets=[{**record["assets"][0], "sha256": "C" * 64}])
        for name, refused in (
            ("missing", missing),
            ("twice", twice),
            ("unsigned", unsigned),
            ("malformed", malformed),
        ):
            with self.subTest(name), self.assertRaises(ValueError):
                qualification.expected_package(refused, CELL)

    def test_version_a_takes_the_lower_deb_version_of_a_development_build(self):
        # dpkg orders "~" before the end of the string, so 0.2.2~dev.7.1-1 precedes 0.2.2-1.
        self.assertEqual(qualification.native_version("0.2.2-dev.7.1"), "0.2.2~dev.7.1-1")
        self.assertEqual(qualification.native_version("0.2.2"), "0.2.2-1")
        # RPM adds the distribution tag of the release the package is built for.
        self.assertEqual(
            qualification.native_version("0.2.2-dev.7.1", "fedora-44"), "0.2.2~dev.7.1-1.fc44"
        )
        self.assertEqual(qualification.native_version("0.2.2", "fedora-45"), "0.2.2-1.fc45")

    def test_update_plan_admits_only_replacing_ohtia_with_version_b(self):
        qualification.update_plan(SIMULATION, "0.2.2~dev.7.1-1", "0.2.2-1")
        extra = SIMULATION + "Inst libgtk-3-0 (3.24.50-1 Ubuntu:26.04 [amd64])\n"
        removal = SIMULATION + "Remv libnss3 [2:3.120-1]\n"
        for name, simulation, installed, candidate in (
            ("extra installation", extra, "0.2.2~dev.7.1-1", "0.2.2-1"),
            ("removal", removal, "0.2.2~dev.7.1-1", "0.2.2-1"),
            ("other installed version", SIMULATION, "0.2.1-1", "0.2.2-1"),
            ("other candidate", SIMULATION, "0.2.2~dev.7.1-1", "0.2.3-1"),
            ("no update", "0 upgraded, 0 newly installed.\n", "0.2.2~dev.7.1-1", "0.2.2-1"),
        ):
            with self.subTest(name), self.assertRaises(ValueError):
                qualification.update_plan(simulation, installed, candidate)

    def test_the_update_reads_only_the_registered_entry_and_fails_on_any_index_error(self):
        command = qualification.apt("update")
        self.assertEqual(command[:2], ["sudo", "apt-get"])
        self.assertEqual(command[-1], "update")
        self.assertIn("Dir::Etc::SourceList=/dev/null", command)
        self.assertIn(f"Dir::Etc::SourceParts={qualification.APT_STATE / 'sources'}", command)
        self.assertIn("APT::Update::Error-Mode=any", command)
        self.assertIn("APT::Keep-Downloaded-Packages=true", command)
        self.assertEqual(command[2:-1:2], ["-o"] * 6)

    def test_the_update_simulates_and_checks_the_plan_before_installing(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            calls = []

            def fake(args, **kwargs):
                calls.append([str(arg) for arg in args])
                stdout = SIMULATION if "--simulate" in args else ""
                if "--yes" in args:
                    (state / "archives").mkdir()
                    (state / "archives/ohtia_0.2.2-1_amd64.deb").write_bytes(b"release bytes")
                return subprocess.CompletedProcess(args, 0, stdout, "")

            with (
                patch.object(qualification, "APT_STATE", state),
                patch.object(qualification, "run", side_effect=fake),
            ):
                downloaded = qualification.update("0.2.2-dev.7.1", "0.2.2")
        self.assertEqual(downloaded["file"], "ohtia_0.2.2-1_amd64.deb")
        self.assertEqual(downloaded["bytes"], len(b"release bytes"))
        steps = [
            next(word for word in ("ln", "update", "--simulate", "--yes", "mkdir") if word in call)
            for call in calls
        ]
        self.assertEqual(steps, ["mkdir", "mkdir", "ln", "update", "--simulate", "--yes"])
        self.assertEqual(
            calls[2][-2:], [str(qualification.SOURCE_ENTRY), str(state / "sources/ohtia.sources")]
        )

    def test_the_update_refuses_a_plan_or_archive_other_than_one_ohtia_package(self):
        for name, simulation, archives in (
            ("other plan", SIMULATION.replace("0.2.2-1", "0.2.3-1"), 1),
            ("no archive", SIMULATION, 0),
            ("two archives", SIMULATION, 2),
        ):
            with tempfile.TemporaryDirectory() as directory:
                state = Path(directory)
                installed = []

                def fake(args, **kwargs):
                    if "--yes" in args:
                        installed.append(True)
                        (state / "archives").mkdir()
                        for index in range(archives):
                            (state / f"archives/ohtia_0.2.{index}-1_amd64.deb").write_bytes(b"x")
                    stdout = simulation if "--simulate" in args else ""
                    return subprocess.CompletedProcess(args, 0, stdout, "")

                with (
                    self.subTest(name),
                    patch.object(qualification, "APT_STATE", state),
                    patch.object(qualification, "run", side_effect=fake),
                    self.assertRaises(ValueError),
                ):
                    qualification.update("0.2.2-dev.7.1", "0.2.2")
                # A refused plan installs nothing.
                self.assertEqual(installed, [] if name == "other plan" else [True])

    def test_dnf_compares_the_download_before_installing_and_changes_only_ohtia(self):
        a_row = "ohtia\t0:0.2.2~dev.7.1-1.fc45\tx86_64"
        b_row = "ohtia\t0:0.2.2-1.fc45\tx86_64"
        for name, content, after, refused in (
            ("passing", b"release bytes", {"glibc\t0:2.44-1\tx86_64", b_row}, False),
            ("other bytes", b"altered bytes", {"glibc\t0:2.44-1\tx86_64", b_row}, True),
            ("other package", b"release bytes", {"glibc\t0:2.45-1\tx86_64", b_row}, True),
        ):
            with self.subTest(name), tempfile.TemporaryDirectory() as directory:
                state = Path(directory)
                calls = []
                snapshots = iter([{"glibc\t0:2.44-1\tx86_64", a_row}, after])

                def fake(args, **kwargs):
                    args = [str(arg) for arg in args]
                    calls.append(args)
                    if "--downloadonly" in args:
                        packages = state / "cache/ohtia-1/packages"
                        packages.mkdir(parents=True)
                        (packages / "ohtia-0.2.2-linux-x64-fedora-45.rpm").write_bytes(content)
                    stdout = (
                        "\n".join(sorted(next(snapshots))) if args[:2] == ["rpm", "-qa"] else ""
                    )
                    return subprocess.CompletedProcess(args, 0, stdout, "")

                expected = {"sha256": hashlib.sha256(b"release bytes").hexdigest(), "bytes": 13}
                with (
                    patch.object(qualification, "DNF_STATE", state),
                    patch.object(qualification, "run", side_effect=fake),
                ):
                    if refused:
                        with self.assertRaises(ValueError):
                            qualification.update_with_dnf(
                                "fedora-45", "0.2.2-dev.7.1", "0.2.2", expected
                            )
                    else:
                        downloaded = qualification.update_with_dnf(
                            "fedora-45", "0.2.2-dev.7.1", "0.2.2", expected
                        )
                        self.assertEqual(downloaded["sha256"], expected["sha256"])
                # The committed key is imported before the baseline, so its gpg-pubkey entry
                # is never counted as a change of the update.
                imports = [
                    i for i, call in enumerate(calls) if call[:3] == ["sudo", "rpm", "--import"]
                ]
                baselines = [i for i, call in enumerate(calls) if call[:2] == ["rpm", "-qa"]]
                self.assertEqual(len(imports), 1)
                self.assertLess(imports[0], baselines[0])
                upgrades = [call for call in calls if "upgrade" in call]
                self.assertIn(f"--setopt=reposdir={state / 'repos'}", upgrades[0])
                self.assertIn("--downloadonly", upgrades[0])
                # Other bytes are refused before dnf installs anything.
                self.assertEqual(len(upgrades), 1 if name == "other bytes" else 2)

    def test_policy_state_follows_each_distribution(self):
        fedora_ok = {
            "getenforce": "Enforcing\n",
            "find": "/opt/ohtia verified.\n/opt/ohtia/ohtia verified.\n",
        }
        for name, outputs, refused in (
            ("labelled", fedora_ok, False),
            ("permissive", {**fedora_ok, "getenforce": "Permissive\n"}, True),
            (
                "unlabelled",
                {**fedora_ok, "find": "/opt/ohtia/ohtia has context x, should be y\n"},
                True,
            ),
        ):

            def fake(args, **kwargs):
                return subprocess.CompletedProcess(
                    args, 0, outputs[str(args[0]) if args[0] != "sudo" else str(args[1])], ""
                )

            with self.subTest(name), patch.object(qualification, "run", side_effect=fake):
                if refused:
                    with self.assertRaises(ValueError):
                        qualification.policy_state("fedora-44")
                else:
                    self.assertEqual(
                        qualification.policy_state("fedora-44"),
                        {"selinux": "Enforcing", "labelled_paths": 2},
                    )
        files = {
            "/sys/module/apparmor/parameters/enabled": "Y\n",
            "/proc/sys/kernel/unprivileged_userns_clone": "1\n",
        }
        for name, changes, allowance, refused in (
            ("admitted", {}, False, False),
            ("namespaces off", {"/proc/sys/kernel/unprivileged_userns_clone": "0\n"}, False, True),
            ("allowance present", {}, True, True),
        ):
            values = {**files, **changes}
            with (
                self.subTest(name),
                patch.object(qualification.Path, "read_text", lambda self: values[self.as_posix()]),
                patch.object(qualification.os.path, "lexists", return_value=allowance),
            ):
                if refused:
                    with self.assertRaises(ValueError):
                        qualification.policy_state("debian-13")
                else:
                    self.assertEqual(
                        qualification.policy_state("debian-13")["unprivileged_userns_clone"], "1"
                    )

    def test_package_files_install_with_their_own_verification(self):
        for profile, signed, expected in (
            ("ubuntu-26.04", True, [["sudo", "dpkg", "--install", "p.deb"]]),
            (
                "fedora-44",
                False,
                [["sudo", "rpm", "--install", "--define", "_pkgverify_level digest", "p.rpm"]],
            ),
            (
                "fedora-45",
                True,
                [
                    [
                        "sudo",
                        "rpm",
                        "--import",
                        str(qualification.ROOT / "config/release/signing-key.asc"),
                    ],
                    ["sudo", "rpm", "--install", "p.rpm"],
                ],
            ),
        ):
            calls = []
            package = "p.rpm" if profile.startswith("fedora") else "p.deb"
            with (
                self.subTest(profile=profile, signed=signed),
                patch.object(
                    qualification,
                    "run",
                    side_effect=lambda args, **kwargs: calls.append([str(a) for a in args]),
                ),
            ):
                qualification.install_file(profile, Path(package), signed=signed)
            self.assertEqual(calls, expected)

    def test_the_short_scenario_downloads_the_release_bytes_from_the_test_zone(self):
        expected = {"name": "ohtia-0.2.2-linux-x64-fedora-44.rpm", "bytes": 13}
        for content, refused in ((b"release bytes", False), (b"altered bytes", True)):
            with tempfile.TemporaryDirectory() as directory:
                urls = []

                def fake(args, **kwargs):
                    args = [str(arg) for arg in args]
                    urls.append(args[-1])
                    Path(args[args.index("--output") + 1]).write_bytes(content)

                with (
                    self.subTest(refused=refused),
                    patch.object(qualification, "run", side_effect=fake),
                ):
                    cell = {"profile": "fedora-44"}
                    record = {**expected, "sha256": hashlib.sha256(b"release bytes").hexdigest()}
                    if refused:
                        with self.assertRaises(ValueError):
                            qualification.download_from_test(cell, record, Path(directory) / "d")
                    else:
                        qualification.download_from_test(cell, record, Path(directory) / "d")
                self.assertEqual(
                    urls,
                    [
                        "https://packages.ohtia.com/test/fedora/44/ohtia-0.2.2-linux-x64-fedora-44.rpm"
                    ],
                )

    def test_a_failed_command_names_its_output(self):
        failed = subprocess.CompletedProcess(
            ["apt-get"], 100, "", "E: Unable to satisfy dependencies."
        )
        with (
            patch.object(qualification.subprocess, "run", return_value=failed),
            self.assertRaisesRegex(
                ValueError, "exited with 100: E: Unable to satisfy dependencies"
            ),
        ):
            qualification.run(["apt-get", "--simulate", "install", "ohtia"])
        with patch.object(qualification.subprocess, "run", return_value=failed):
            self.assertEqual(qualification.run(["apt-get"], check=False).returncode, 100)

    def test_the_report_keeps_each_step_and_the_failure_of_the_last(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            report = qualification.Report(output, {"status": "failed", "steps": []})
            with report.step("install-a") as observed:
                observed["installed_version"] = "0.2.2~dev.7.1-1"
            with self.assertRaises(ValueError), report.step("update-to-b") as observed:
                observed["downloaded"] = None
                raise ValueError("synthetic refusal")
            saved = json.loads((output / "result.json").read_text())
        self.assertEqual(
            saved["steps"],
            [
                {
                    "id": "install-a",
                    "result": "passed",
                    "observed": {"installed_version": "0.2.2~dev.7.1-1"},
                },
                {
                    "id": "update-to-b",
                    "result": "failed",
                    "error": "synthetic refusal",
                    "observed": {"downloaded": None},
                },
            ],
        )
        self.assertEqual(saved["status"], "failed")


if __name__ == "__main__":
    unittest.main()
