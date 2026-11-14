"""Run the signing job of the prepare-release workflow with disposable keys and a real RPM.

The job's steps are shell scripts inside the workflow definition, so these tests extract them
from the workflow and run them as GitHub Actions would, with the runner tools of this machine.
No key of the project is used: every key is generated for the test and discarded with it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_TEXT = (ROOT / ".github/workflows/prepare-release.yml").read_text(encoding="utf-8")
TOOLS = ("bash", "gpg", "gpgconf", "jq", "rpmbuild", "rpmkeys", "rpmsign", "sha256sum")
PASSPHRASE = "disposable signing passphrase"
VERSION = "0.3.0"
COMMIT = "c" * 40
TARGETS = ("linux-x64", "linux-arm64")
CHECK = "Check the RPM packages against their build records"
SIGN = "Sign the RPM packages with the release subkey"
VERIFY = "Verify the signatures against the committed key"


def sign_steps() -> dict[str, str]:
    """Return the shell script of each signing-job step that runs one, by step name."""
    jobs = WORKFLOW_TEXT.split("\njobs:\n", 1)[1]
    job = re.split(r"^  [a-z][a-z0-9-]*:\n", jobs.split("\n  sign:\n", 1)[1], flags=re.M)[0]
    steps = {}
    for step in job.split("\n      - name: ")[1:]:
        name, _, rest = step.partition("\n")
        if "        run: |\n" in rest:
            script = []
            for line in rest.split("        run: |\n", 1)[1].splitlines():
                if line and not line.startswith(" " * 10):
                    break
                script.append(line)
            steps[name] = textwrap.dedent("\n".join(script)) + "\n"
    return steps


def gpg(home: Path, *args: str, **kwargs) -> str:
    return subprocess.run(
        ["gpg", "--homedir", str(home), "--batch", "--pinentry-mode", "loopback", *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
        **kwargs,
    ).stdout


def fingerprints(home: Path, kind: str, key: str) -> list[str]:
    """List the fingerprints of the primary key (``pub``) or subkeys (``sub``) of a key."""
    listing = gpg(home, "--with-colons", "--list-keys", key).splitlines()
    return [
        listing[index + 1].split(":")[9]
        for index, line in enumerate(listing)
        if line.startswith(kind + ":")
    ]


def owner(home: Path, name: str) -> str:
    """Create an owner's certification-only primary key; return its fingerprint."""
    home.mkdir(mode=0o700)
    # The primary key predates the expired subkey that one test creates in the past.
    gpg(
        home,
        "--passphrase",
        PASSPHRASE,
        "--faked-system-time",
        "20200101T000000",
        "--quick-generate-key",
        f"{name} <{name.lower()}@example.invalid>",
        "ed25519",
        "cert",
        "never",
    )
    return fingerprints(home, "pub", name)[0]


def add_signing_subkey(home: Path, primary: str, *time: str, expire: str = "1y") -> str:
    before = set(fingerprints(home, "sub", primary))
    gpg(
        home,
        "--passphrase",
        PASSPHRASE,
        *time,
        "--quick-add-key",
        primary,
        "ed25519",
        "sign",
        expire,
    )
    return (set(fingerprints(home, "sub", primary)) - before).pop()


def export_subkey(home: Path, subkey: str) -> str:
    return gpg(home, "--passphrase", PASSPHRASE, "--armor", "--export-secret-subkeys", subkey + "!")


def kill_agent(home: Path) -> None:
    if home.is_dir():
        subprocess.run(
            ["gpgconf", "--homedir", str(home), "--kill", "all"],
            check=False,
            capture_output=True,
            timeout=60,
        )


@unittest.skipUnless(
    os.name == "posix" and all(shutil.which(tool) for tool in TOOLS),
    "Requires bash, GnuPG, jq and the RPM signing tools of the Ubuntu runner image",
)
class SigningJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = tempfile.TemporaryDirectory()
        base = Path(cls.base.name)
        cls.home = base / "home"
        cls.home.mkdir()
        cls.steps = sign_steps()
        owner_home, other_home = base / "owner", base / "other"
        cls.homes = (owner_home, other_home)
        cls.primary = owner(owner_home, "Disposable")
        expired = add_signing_subkey(
            owner_home, cls.primary, "--faked-system-time", "20200102T000000", expire="1d"
        )
        cls.public_before_subkey = gpg(owner_home, "--armor", "--export", cls.primary)
        cls.subkey = add_signing_subkey(owner_home, cls.primary)
        cls.public = gpg(owner_home, "--armor", "--export", cls.primary)
        cls.subkey_export = export_subkey(owner_home, cls.subkey)
        cls.expired_export = export_subkey(owner_home, expired)
        cls.full_export = gpg(
            owner_home, "--passphrase", PASSPHRASE, "--armor", "--export-secret-keys", cls.primary
        )
        # A subkey exported before its revocation, and the public key that carries the revocation.
        revoked = add_signing_subkey(owner_home, cls.primary)
        cls.revoked_export = export_subkey(owner_home, revoked)
        gpg(
            owner_home,
            "--passphrase",
            PASSPHRASE,
            "--command-fd",
            "0",
            "--edit-key",
            cls.primary,
            input=f"key {revoked}\nrevkey\ny\n1\n\ny\nsave\n",
        )
        cls.public_with_revocation = gpg(owner_home, "--armor", "--export", cls.primary)
        other = owner(other_home, "Foreign")
        cls.other_subkey = add_signing_subkey(other_home, other)
        cls.other_public = gpg(other_home, "--armor", "--export", other)
        cls.other_export = export_subkey(other_home, cls.other_subkey)
        cls.unsigned = cls.build_rpm(base / "rpmbuild")

    @classmethod
    def tearDownClass(cls):
        for home in cls.homes:
            kill_agent(home)
        cls.base.cleanup()

    @classmethod
    def build_rpm(cls, top: Path) -> bytes:
        (top / "SPECS").mkdir(parents=True)
        spec = top / "SPECS/signing-test.spec"
        spec.write_text(
            "Name: ohtia-signing-test\nVersion: 1\nRelease: 1\nSummary: Signing test\n"
            "License: MIT\nBuildArch: noarch\n%description\nSigning test.\n%files\n",
            encoding="utf-8",
        )
        subprocess.run(
            ["rpmbuild", "--quiet", "--define", f"_topdir {top}", "-bb", str(spec)],
            check=True,
            capture_output=True,
            env={**os.environ, "HOME": str(cls.home)},
            timeout=300,
        )
        return next((top / "RPMS").rglob("*.rpm")).read_bytes()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.directory.name) / "workspace"
        self.runner = Path(self.directory.name) / "runner"
        self.runner.mkdir()
        release = self.workspace / "config/release"
        release.mkdir(parents=True)
        shutil.copyfile(ROOT / "config/release/platforms.json", release / "platforms.json")
        self.write_signing(self.primary, self.public)
        self.names = {}
        for target in TARGETS:
            folder = self.workspace / f"artifacts/release-inputs/release-{target}-500-1"
            folder.mkdir(parents=True)
            rpm = f"ohtia-{VERSION}-{target}-fedora-44.rpm"
            deb = f"ohtia-{VERSION}-{target}-debian-13.deb"
            (folder / rpm).write_bytes(self.unsigned)
            (folder / deb).write_bytes(b"synthetic deb")
            assets = [
                {
                    "name": name,
                    "profile": profile,
                    "format": name.rsplit(".", 1)[1],
                    "bytes": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
                for name, profile, content in (
                    (deb, "debian-13", b"synthetic deb"),
                    (rpm, "fedora-44", self.unsigned),
                )
            ]
            record = {
                "schema_version": 1,
                "version": VERSION,
                "source": {"commit": COMMIT, "tree": "d" * 40},
                "target": target,
                "assets": assets,
            }
            (folder / "build.json").write_text(json.dumps(record), encoding="utf-8")
            self.names[target] = folder / rpm
        self.secrets = {"SIGNING_SUBKEY": self.subkey_export, "SIGNING_PASSPHRASE": PASSPHRASE}
        self.outputs = []

    def tearDown(self):
        kill_agent(self.runner / "rpm-signing/gnupg")
        self.directory.cleanup()

    def write_signing(self, fingerprint: str, public: str) -> None:
        release = self.workspace / "config/release"
        record = {"schema_version": 1, "fingerprint": fingerprint}
        (release / "signing.json").write_text(json.dumps(record), encoding="utf-8")
        (release / "signing-key.asc").write_text(public, encoding="utf-8")

    def run_step(self, name: str, secrets: bool = False) -> subprocess.CompletedProcess:
        env = {
            "PATH": os.environ["PATH"],
            "HOME": str(self.home),
            "RUNNER_TEMP": str(self.runner),
            "OHTIA_RELEASE_COMMIT": COMMIT,
            "OHTIA_RELEASE_VERSION": VERSION,
            **(self.secrets if secrets else {}),
        }
        result = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", self.steps[name]],
            cwd=self.workspace,
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        self.outputs.append(result.stdout + result.stderr)
        return result

    def run_job(self) -> list[subprocess.CompletedProcess]:
        results = []
        for name, secrets in ((CHECK, False), (SIGN, True), (VERIFY, False)):
            results.append(self.run_step(name, secrets))
            if results[-1].returncode:
                break
        return results

    def assertRefused(self, result, message):
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stderr, rf"(?m)^Signing refused: .*{re.escape(message)}")

    def checksig(self, file: Path, public: str) -> subprocess.CompletedProcess:
        """Check a package against a fresh key ring holding only the given public key."""
        keyring = Path(tempfile.mkdtemp(dir=self.directory.name))
        key = keyring / "key.asc"
        key.write_text(public, encoding="utf-8")
        env = {**os.environ, "HOME": str(self.home)}
        rpmkeys = ["rpmkeys", "--dbpath", str(keyring)]
        subprocess.run(
            [*rpmkeys, "--import", str(key)], check=True, capture_output=True, env=env, timeout=120
        )
        return subprocess.run(
            [*rpmkeys, "--checksig", str(file)],
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )

    def test_the_committed_public_key_is_the_recorded_primary_key_with_a_signing_subkey(self):
        record = json.loads((ROOT / "config/release/signing.json").read_text(encoding="utf-8"))
        public = ROOT / "config/release/signing-key.asc"
        home = Path(self.directory.name) / "committed"
        home.mkdir(mode=0o700)
        listing = gpg(home, "--with-colons", "--show-keys", str(public)).splitlines()
        kill_agent(home)
        keys = [
            (line.split(":")[0], line.split(":")[11], listing[index + 1].split(":")[9])
            for index, line in enumerate(listing)
            if line.split(":")[0] in {"pub", "sub"}
        ]
        self.assertEqual([key for key in keys if key[0] == "pub"][0][2], record["fingerprint"])
        self.assertEqual(sum(key[0] == "pub" for key in keys), 1)
        self.assertTrue(any(kind == "sub" and "s" in usage for kind, usage, _ in keys))
        # The key ring of the verification step accepts the committed key.
        keyring = Path(tempfile.mkdtemp(dir=self.directory.name))
        subprocess.run(
            ["rpmkeys", "--dbpath", str(keyring), "--import", str(public)],
            check=True,
            capture_output=True,
            env={**os.environ, "HOME": str(self.home)},
            timeout=120,
        )

    def test_every_rpm_is_signed_with_the_subkey_and_recorded_after_signing(self):
        results = self.run_job()
        self.assertEqual([result.returncode for result in results], [0, 0, 0], self.outputs)
        signed = self.workspace / "artifacts/signed"
        record = json.loads((signed / "signing.json").read_text())
        self.assertEqual(record["schema_version"], 1)
        self.assertEqual(record["fingerprint"], self.primary)
        unsigned = hashlib.sha256(self.unsigned).hexdigest()
        self.assertEqual(
            [package["name"] for package in record["packages"]],
            [path.name for path in sorted(self.names.values())],
        )
        self.assertEqual(
            sorted(p.name for p in signed.iterdir()),
            sorted([*(path.name for path in self.names.values()), "signing.json"]),
        )
        for package in record["packages"]:
            file = signed / package["name"]
            content = file.read_bytes()
            self.assertEqual(package["unsigned_sha256"], unsigned)
            self.assertEqual(package["sha256"], hashlib.sha256(content).hexdigest())
            self.assertEqual(package["bytes"], len(content))
            self.assertNotEqual(package["sha256"], unsigned)
            accepted = self.checksig(file, self.public)
            self.assertEqual(accepted.returncode, 0, accepted.stdout)
            self.assertEqual(accepted.stdout.strip(), f"{file}: digests signatures OK")
            altered = Path(self.directory.name) / f"altered-{package['name']}"
            changed = bytearray(content)
            changed[-10] ^= 0xFF
            altered.write_bytes(changed)
            refused = self.checksig(altered, self.public)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("NOT OK", refused.stdout)
        # Neither the passphrase nor the subkey reaches the log, and the passphrase file is gone.
        log = "".join(self.outputs)
        self.assertNotIn(PASSPHRASE, log)
        self.assertNotIn("PRIVATE KEY BLOCK", log)
        self.assertFalse((self.runner / "rpm-signing/passphrase").exists())

    def test_a_package_that_differs_from_its_build_record_is_refused_before_signing(self):
        changed = bytearray(self.unsigned)
        changed[-10] ^= 0xFF
        self.names["linux-arm64"].write_bytes(changed)
        results = self.run_job()
        self.assertEqual(len(results), 1)
        self.assertRefused(results[0], f"{self.names['linux-arm64'].name} differs from its build")

    def test_build_records_of_another_version_or_without_every_rpm_are_refused(self):
        record_file = self.names["linux-x64"].parent / "build.json"
        record = json.loads(record_file.read_text())
        for change, message in (
            (lambda value: value.update(version="0.3.1"), "does not match the checked version"),
            (lambda value: value["assets"].pop(), "do not list every declared RPM package"),
        ):
            with self.subTest(message):
                changed = json.loads(json.dumps(record))
                change(changed)
                record_file.write_text(json.dumps(changed))
                shutil.rmtree(self.runner / "rpm-signing", ignore_errors=True)
                self.assertRefused(self.run_step(CHECK), message)

    def test_a_subkey_of_another_primary_key_is_refused_before_signing(self):
        self.secrets["SIGNING_SUBKEY"] = self.other_export
        results = self.run_job()
        self.assertEqual(len(results), 2)
        self.assertRefused(results[1], "The signing subkey does not belong to the recorded primary")
        self.assertFalse((self.runner / "rpm-signing/signed").exists())

    def test_an_export_holding_the_secret_primary_key_is_refused(self):
        self.secrets["SIGNING_SUBKEY"] = self.full_export
        results = self.run_job()
        self.assertRefused(results[-1], "The import holds the secret primary key")
        self.assertFalse((self.runner / "rpm-signing/signed").exists())

    def test_an_expired_subkey_is_refused(self):
        self.secrets["SIGNING_SUBKEY"] = self.expired_export
        results = self.run_job()
        self.assertRefused(results[-1], "The import holds no single valid signing subkey")

    def test_a_subkey_missing_from_the_committed_public_key_is_refused(self):
        self.write_signing(self.primary, self.public_before_subkey)
        results = self.run_job()
        self.assertRefused(results[-1], "is not a valid signing subkey of the committed public key")

    def test_a_subkey_revoked_in_the_committed_public_key_is_refused(self):
        self.write_signing(self.primary, self.public_with_revocation)
        self.secrets["SIGNING_SUBKEY"] = self.revoked_export
        results = self.run_job()
        self.assertRefused(results[-1], "is not a valid signing subkey of the committed public key")
        self.assertFalse((self.runner / "rpm-signing/signed").exists())

    def test_a_committed_file_with_more_than_one_key_is_refused(self):
        self.write_signing(self.primary, self.public + self.other_public)
        results = self.run_job()
        self.assertRefused(results[-1], "The committed public key is not the recorded primary key")

    def test_a_committed_key_other_than_the_recorded_fingerprint_is_refused(self):
        self.write_signing(self.primary, self.other_public)
        results = self.run_job()
        self.assertRefused(results[-1], "The committed public key is not the recorded primary key")
        self.write_signing("0" * 40, self.public)
        shutil.rmtree(self.runner / "rpm-signing")
        self.assertRefused(self.run_job()[-1], "The committed public key is not the recorded")

    def test_a_wrong_passphrase_signs_nothing(self):
        self.secrets["SIGNING_PASSPHRASE"] = "wrong"
        results = self.run_job()
        self.assertRefused(results[-1], "rpmsign could not sign")
        self.assertFalse((self.runner / "rpm-signing/passphrase").exists())

    def test_unsigned_and_unknown_key_results_are_refused(self):
        self.assertEqual(self.run_step(CHECK).returncode, 0)
        self.assertEqual(self.run_step(SIGN, secrets=True).returncode, 0, self.outputs)
        target = self.runner / "rpm-signing/signed" / self.names["linux-x64"].name
        foreign = Path(self.directory.name) / "foreign.rpm"
        foreign.write_bytes(self.unsigned)
        other_home = self.homes[1]
        passphrase = Path(self.directory.name) / "passphrase"
        passphrase.write_text(PASSPHRASE, encoding="utf-8")
        subprocess.run(
            [
                "rpmsign",
                "--define",
                f"_gpg_name {self.other_subkey}!",
                "--define",
                f"_gpg_sign_cmd_extra_args --homedir {other_home} --batch --pinentry-mode "
                f"loopback --passphrase-file {passphrase}",
                "--resign",
                str(foreign),
            ],
            check=True,
            capture_output=True,
            env={**os.environ, "HOME": str(self.home)},
            timeout=120,
        )
        for name, content in (("unsigned", self.unsigned), ("NOKEY", foreign.read_bytes())):
            with self.subTest(name):
                target.write_bytes(content)
                shutil.rmtree(self.runner / "rpm-signing/keyring", ignore_errors=True)
                shutil.rmtree(self.workspace / "artifacts/signed", ignore_errors=True)
                result = self.run_step(VERIFY)
                self.assertRefused(result, target.name)
                self.assertFalse((self.workspace / "artifacts/signed/signing.json").exists())


if __name__ == "__main__":
    unittest.main()
