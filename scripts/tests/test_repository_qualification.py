"""Contracts of the repository qualification harness; no native installation is simulated as passing."""

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
CELL = {"target": "linux-x64", "profile": "ubuntu-26.04"}


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
    def test_covers_only_its_declared_hosted_gnome_cell(self):
        cell = qualification.declared_cell("linux-x64-ubuntu-26-04-gnome")
        self.assertEqual((cell["desktop"], cell["formats"]), ("gnome", ["deb"]))
        for other in ("linux-x64-ubuntu-26-04-kde", "linux-x64-fedora-44-gnome", "unknown"):
            with self.subTest(cell=other), self.assertRaises(ValueError):
                qualification.declared_cell(other)

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
