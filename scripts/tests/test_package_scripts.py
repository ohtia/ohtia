"""Check package script failures on synthetic hosts and payloads."""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

PACKAGING = Path(__file__).resolve().parents[2] / "tooling/quality-packaging"
TEST_COMMAND = r"(?:\[[ \t]+[^\n]*?[ \t]+\]|(?<![\w./-])(?:/(?:usr/)?bin/)?test[ \t]+[^\n]*?)"
TEST_AND_LIST = re.compile(rf"{TEST_COMMAND}\s*&&\s*(?:#[^\n]*\n\s*)*(?:!\s+)?{TEST_COMMAND}")
ABSOLUTE_PATH = re.compile(r"(?<![\w./-])/")
ENTERED_CHECK = "started package check\n"
PASSED_CHECK = "passed package check\n"

ROOT = "opt/ohtia"
EXECUTABLE = f"{ROOT}/ohtia"
SOURCE = f"{ROOT}/resources/apparmor-profile"
POLICY = "etc/apparmor.d/ohtia"
INSTALLED_POLICY = "installed-policy"
PROFILES = "sys/kernel/security/apparmor/profiles"

# Only shell builtins and the named fixture operations can run with the test PATH.
HOST_COMMANDS = """
id() { printf '0\\n'; }
stat() { case "$2" in %U) printf 'root\\n';; %a) printf '644\\n';; *) return 2;; esac; }
find() { :; }
getenforce() { printf 'Enforcing\\n'; }
restorecon() { :; }
apparmor_parser() { :; }
cat() { command -p cat "$@"; }
grep() { command -p grep "$@"; }
install() { if [ -e installed-policy ]; then command -p mv installed-policy "$9"; fi; }
rm() { :; }
"""


class PackageScriptSourceTests(unittest.TestCase):
    def test_package_scripts_do_not_chain_test_commands_with_and(self):
        scripts = sorted(PACKAGING.rglob("*.sh"))
        self.assertTrue(scripts)
        for script in scripts:
            with self.subTest(script=script.name):
                source = script.read_text(encoding="utf-8").replace("\\\n", "")
                source = re.sub(r"(?m)^[ \t]*#.*$", "", source)
                self.assertNotRegex(source, TEST_AND_LIST)


@unittest.skipIf(os.name == "nt", "Package scripts require a POSIX shell.")
class PackageScriptExecutionTests(unittest.TestCase):
    def test_debian_preinstall_refuses_wrong_distribution_or_version(self):
        script = "before-debian.sh"
        first = '[ "$ID" = debian ]'
        second = '[ "$VERSION_ID" = 13 ]'
        self.assert_guard(script, first, second)
        for distribution, version in (("ubuntu", "13"), ("debian", "12")):
            with self.subTest(distribution=distribution, version=version):
                self.assert_guard(script, first, second, distribution=distribution, version=version)

    def test_payload_checks_refuse_wrong_file_types_and_symlinks(self):
        for script, expression, predicate, path, invalid_kind in (
            ("after-debian.sh", "$root", "-d", ROOT, "file"),
            ("after-fedora.sh", "$root", "-d", ROOT, "file"),
            ("after-install.sh", "$root", "-d", ROOT, "file"),
            ("after-install.sh", "$root/ohtia", "-x", EXECUTABLE, "file"),
            ("after-install.sh", "$source", "-f", SOURCE, "directory"),
            ("after-install.sh", "$policy", "-f", INSTALLED_POLICY, "directory"),
            ("after-remove.sh", "$policy", "-f", POLICY, "directory"),
        ):
            first = f'[ {predicate} "{expression}" ]'
            second = f'[ ! -L "{expression}" ]'
            with self.subTest(script=script, path=path):
                self.assert_guard(script, first, second)
            for kind in (invalid_kind, "symlink"):
                with self.subTest(script=script, path=path, kind=kind):
                    self.assert_guard(script, first, second, override=(path, kind))

    def test_fedora_label_check_prints_only_mismatches(self):
        verified = f"./{EXECUTABLE} verified.\n./{SOURCE} verified.\n"
        mismatch = (
            f"./{ROOT}/locales has context unconfined_u:object_r:user_home_t:s0, "
            "should be system_u:object_r:usr_t:s0\n"
        )
        error = f"matchpathcon(./{ROOT}/missing) failed: No such file or directory\n"
        source = (PACKAGING / "after-fedora.sh").read_text(encoding="utf-8")
        for status, stdout, stderr, expected in (
            (0, verified, "", ""),
            (1, verified + mismatch + verified, error, mismatch + error),
        ):
            with self.subTest(status=status):
                # The check is the only find call with -exec. Its output goes through the script.
                commands = f"""
matchpathcon() {{
  case "$1 $2" in "-V ./{ROOT}") ;; *) return 2;; esac
  printf '%s' {shlex.quote(stdout)}
  printf '%s' {shlex.quote(stderr)} >&2
  return {status}
}}
find() {{ case " $* " in *" -exec matchpathcon -V {{}} + "*) matchpathcon -V "$1";; esac; }}
"""
                result = self.run_script("after-fedora.sh", source, commands=commands)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, expected)
                self.assertNotIn(" verified.", result.stderr)
                self.assertEqual(result.returncode, status)

    def assert_guard(
        self, script, first, second, *, distribution="debian", version="13", override=None
    ):
        source = (PACKAGING / script).read_text(encoding="utf-8")
        # The final policy check is after installation. An earlier check guards the old policy.
        before, second_check, after = source.rpartition(f"{second}\n")
        self.assertTrue(second_check, f"Missing package check in {script}: {second}")
        before, first_check, between = before.rpartition(first)
        self.assertTrue(first_check, f"Missing package check in {script}: {first}")
        source = (
            f"{before}printf '%s\\n' 'started package check'\n"
            f"{first_check}{between}{second_check}"
            f"printf '%s\\n' 'passed package check'\n{after}"
        )
        result = self.run_script(script, source, distribution, version, override)

        expected_failure = override is not None or (distribution, version) != ("debian", "13")
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            result.stdout, ENTERED_CHECK if expected_failure else ENTERED_CHECK + PASSED_CHECK
        )
        self.assertEqual(result.returncode, 1 if expected_failure else 0)

    def run_script(
        self, script, source, distribution="debian", version="13", override=None, commands=""
    ):
        path_assignment = "PATH=/usr/sbin:/usr/bin:/sbin:/bin"
        self.assertIn(path_assignment, source)
        source = source.replace(path_assignment, "PATH=./no-host-commands")
        source = re.sub(r"(?<![\w./-])/(?=(?:etc|opt|proc|sys)/)", "./", source)
        # In find's permission operand the slash introduces a bitmask.
        fixture_body = source.removeprefix("#!/bin/sh\n").replace("-perm /6022", "-perm 6022")
        self.assertNotRegex(fixture_body, ABSOLUTE_PATH, f"Unmapped host path in {script}")

        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary)
            self.prepare_host(fixture, script, distribution, version, override)
            return subprocess.run(
                ["/bin/sh", "-c", HOST_COMMANDS + commands + source],
                cwd=fixture,
                env={},
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )

    def prepare_host(self, fixture, script, distribution, version, override):
        files = {
            "etc/os-release": f"ID={distribution}\nVERSION_ID={version}\n",
            "sys/module/apparmor/parameters/enabled": "Y\n",
            "proc/sys/kernel/unprivileged_userns_clone": "1\n",
            PROFILES: "ohtia (enforce)\n" if script == "after-install.sh" else "",
        }
        for name, content in files.items():
            path = fixture / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (fixture / POLICY).parent.mkdir(parents=True)

        entries = {ROOT: "directory", EXECUTABLE: "executable", SOURCE: "file"}
        if script == "after-install.sh":
            entries[INSTALLED_POLICY] = "file"
        if script == "after-remove.sh":
            entries[POLICY] = "file"
        for name, valid_kind in entries.items():
            if override == (ROOT, "file") and name.startswith(f"{ROOT}/"):
                continue
            path = fixture / name
            path.parent.mkdir(parents=True, exist_ok=True)
            kind = override[1] if override and name == override[0] else valid_kind
            if kind == "symlink":
                target = fixture / "symlink-target"
                self.create_entry(target, valid_kind)
                path.symlink_to(target)
            else:
                self.create_entry(path, kind)

    def create_entry(self, path, kind):
        if kind == "directory":
            path.mkdir()
        else:
            path.touch()
            if kind == "executable":
                path.chmod(0o755)
