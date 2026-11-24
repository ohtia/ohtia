"""Check the Linux distribution profiles that code reads from the target manifest."""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import linux_profiles  # noqa: E402
import quality_native  # noqa: E402
import scaleway_bootstrap  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


class LinuxProfileTests(unittest.TestCase):
    def test_the_manifest_declares_two_consecutive_fedora_releases(self):
        self.assertEqual(linux_profiles.fedora(), ("fedora-44", "fedora-45"))
        self.assertEqual(
            set(linux_profiles.declared()),
            {"ubuntu-26.04", "fedora-44", "fedora-45", "debian-13"},
        )

    def test_profile_properties_follow_the_distribution(self):
        self.assertEqual(linux_profiles.parse("fedora-45"), ("fedora", "45"))
        self.assertEqual(linux_profiles.parse("ubuntu-26.04"), ("ubuntu", "26.04"))
        for profile, package, tool in (
            ("fedora-44", "rpm", "rpm"),
            ("fedora-45", "rpm", "rpm"),
            ("debian-13", "deb", "dpkg"),
            ("ubuntu-26.04", "deb", "dpkg"),
        ):
            with self.subTest(profile=profile):
                self.assertEqual(linux_profiles.package_format(profile), package)
                self.assertEqual(linux_profiles.package_tool(profile), tool)
        self.assertEqual(linux_profiles.kernel_marker("fedora-45"), ".fc45")
        self.assertEqual(linux_profiles.kernel_marker("debian-13"), "deb13")
        self.assertEqual(linux_profiles.native_release("fedora-45"), "1.fc45")
        for profile in ("ubuntu-26.04", "debian-13", "windows-11-25h2", ""):
            self.assertEqual(linux_profiles.native_release(profile), "1")
        self.assertEqual(linux_profiles.os_release_name("fedora-45"), "Fedora 45")
        for invalid in ("fedora", "fedora-", "arch-1", "fedora-45-kde", "Fedora-45"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                linux_profiles.parse(invalid)
        self.assertFalse(linux_profiles.is_fedora("fedora-kde"))

    def test_no_code_names_a_fedora_release(self):
        """Fedora releases are added and retired only in configuration (ADR-0056)."""
        literal = re.compile(r"fedora[-_]?[0-9]{2}|FEDORA[0-9]{2}|\.fc[0-9]{2}\b")
        files = [
            *ROOT.glob("scripts/*.py"),
            *ROOT.glob("tooling/**/*.py"),
            *ROOT.glob("tooling/**/*.sh"),
            *ROOT.glob("tooling/**/*.mjs"),
            *ROOT.glob("tools/**/*.sh"),
        ]
        named = [
            f"{file.relative_to(ROOT)}: {match[0]}"
            for file in files
            for match in literal.finditer(file.read_text(encoding="utf-8"))
        ]
        self.assertEqual(named, [])


class FedoraPackageCheckTests(unittest.TestCase):
    def test_each_rpm_checks_the_release_of_its_own_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            for profile in ("fedora-44", "fedora-45"):
                with self.subTest(profile=profile):
                    work = Path(directory) / profile
                    work.mkdir()
                    script = quality_native.fedora_before_install(
                        {"profile": profile, "formats": ["rpm"]}, work
                    )
                    text = script.read_text()
                    release = profile.removeprefix("fedora-")
                    self.assertEqual(script.parent, work)
                    self.assertIn(f"\nOHTIA_FEDORA_VERSION={release}\n", text)
                    self.assertIn('[ "$VERSION_ID" = "$OHTIA_FEDORA_VERSION" ]', text)
                    self.assertLess(
                        text.index("OHTIA_FEDORA_VERSION="), text.index('"$VERSION_ID"')
                    )

    def test_each_rpm_accepts_only_its_own_fedora_release(self):
        """Run the generated distribution check against synthetic os-release files."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for built in ("fedora-44", "fedora-45"):
                work = root / built
                work.mkdir()
                text = quality_native.fedora_before_install(
                    {"profile": built, "formats": ["rpm"]}, work
                ).read_text()
                lines = text.splitlines()
                start = lines.index(". /etc/os-release")
                end = next(i for i, line in enumerate(lines) if '"$VERSION_ID"' in line)
                for host_id, host_version in (
                    ("fedora", "44"),
                    ("fedora", "45"),
                    ("rhel", built.removeprefix("fedora-")),
                ):
                    release = root / f"os-release-{built}-{host_id}-{host_version}"
                    release.write_text(f"ID={host_id}\nVERSION_ID={host_version}\n")
                    check = "\n".join(
                        [
                            "set -eu",
                            next(
                                line for line in lines if line.startswith("OHTIA_FEDORA_VERSION=")
                            ),
                            *lines[start : end + 1],
                            # A failed check must stop the script, not fall through to later lines.
                            "true",
                        ]
                    ).replace("/etc/os-release", str(release))
                    result = subprocess.run(["sh", "-c", check], check=False)
                    accepted = host_id == "fedora" and built == f"fedora-{host_version}"
                    with self.subTest(built=built, host=f"{host_id}-{host_version}"):
                        self.assertEqual(result.returncode == 0, accepted)

    def test_the_native_fixture_policy_accepts_only_the_profile_release(self):
        policy = (ROOT / "tools/desktop-probes/linux-profile-policy.sh").read_text()
        with tempfile.TemporaryDirectory() as directory:
            for profile, host_id, host_version, accepted in (
                ("fedora-45", "fedora", "45", True),
                ("fedora-45", "fedora", "44", False),
                ("fedora-44", "fedora", "44", True),
                ("debian-13", "debian", "13", True),
                ("debian-13", "fedora", "13", False),
            ):
                release = Path(directory) / f"{profile}-{host_id}-{host_version}"
                release.write_text(f"ID={host_id}\nVERSION_ID={host_version}\n")
                script = (
                    f"OHTIA_NATIVE_DISTRIBUTION_PROFILE={profile}\n"
                    + policy.replace("/etc/os-release", str(release))
                    + "\nverify_distribution_profile\n"
                )
                result = subprocess.run(["sh", "-c", script], check=False)
                with self.subTest(profile=profile, host=f"{host_id}-{host_version}"):
                    self.assertEqual(result.returncode == 0, accepted)

    def test_unsigned_test_rpms_install_with_digest_checks_only(self):
        """RPM 6, as on Fedora 45, refuses an unsigned package unless the policy is digest."""
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(quality_native, "command") as command,
        ):
            quality_native.unpack_package(Path("ohtia.rpm"), "rpm", Path(directory) / "unpacked")
        self.assertEqual(
            command.call_args.args[0],
            ["sudo", "rpm", "--install", "--define", "_pkgverify_level digest", Path("ohtia.rpm")],
        )
        source = (ROOT / "scripts/scaleway_bootstrap.py").read_text()
        self.assertIn(
            'run("rpm", "--install", "--define", "_pkgverify_level digest", package)', source
        )
        self.assertTrue(callable(scaleway_bootstrap.fedora_profile))

    def test_a_cell_without_an_rpm_writes_no_check(self):
        with tempfile.TemporaryDirectory() as directory:
            script = quality_native.fedora_before_install(
                {"profile": "debian-13", "formats": ["deb"]}, Path(directory)
            )
            self.assertEqual(list(Path(directory).iterdir()), [])
            self.assertEqual(script, ROOT / "tooling/quality-packaging/before-fedora.sh")


if __name__ == "__main__":
    unittest.main()
