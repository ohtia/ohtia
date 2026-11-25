"""Run the package repository action of the release workflows with disposable keys and packages.

The action's steps are shell scripts inside its definition, so these tests extract them and run
them as GitHub Actions would, with the runner tools of this machine. `gh`, `aws` and `curl` are
replaced by local stand-ins: a release fixture, a bucket directory and the public address that
serves that directory. apt and dnf themselves then read the published repositories from that
directory.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_release_signing as signing  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ACTION = ROOT / ".github/actions/package-repositories/action.yml"
TOOLS = (
    "bash",
    "cmp",
    "createrepo_c",
    "dpkg-deb",
    "dpkg-scanpackages",
    "gpg",
    "gpgconf",
    "gpgv",
    "gzip",
    "jq",
    "rpmbuild",
    "rpmsign",
    "sha256sum",
    "zcat",
)
# Fedora's dnf is dnf5; Ubuntu and Debian package dnf 4, whose dnf5 build rejects valid
# repomd.xml signatures on Ubuntu 26.04, so the tests use whichever `dnf` the system names.
DNF = shutil.which("dnf")


def dnf5() -> bool:
    if not DNF:
        return False
    result = subprocess.run([DNF, "--version"], capture_output=True, text=True, timeout=60)
    return "dnf5" in result.stdout + result.stderr


PASSPHRASE = signing.PASSPHRASE
COMMIT = "c" * 40
RUN_ID = "4242"
ACCOUNT = "0123456789abcdef0123456789abcdef"
FETCH = "Fetch the Linux packages of the release"
METADATA = "Build the dnf metadata"
BUILD = "Build the apt indexes"
CHECK = "Check the dnf metadata against the release"
SIGN = "Sign the repository indexes with the release subkey"
VERIFY = "Verify the index signatures against the committed key"
UPLOAD = "Upload the package repositories"
IMMUTABLE = "public, max-age=31536000, immutable"

# Stand-ins for the runner's gh, aws and curl, backed by the release fixture and bucket directory.
FAKE_GH = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json, os, sys
    root = os.environ["FAKE_RELEASE"]
    args = sys.argv[1:]
    assert args[0] == "api", args
    path = args[-1]
    if "releases/assets/" in path:
        asset = path.rsplit("/", 1)[1]
        with open(os.path.join(root, "assets", asset), "rb") as stream:
            sys.stdout.buffer.write(stream.read())
    else:
        assert "--paginate" in args and "--slurp" in args, args
        with open(os.path.join(root, "releases.json"), "rb") as stream:
            releases = json.load(stream)
        json.dump([releases], sys.stdout)
    """
)
FAKE_AWS = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json, os, shutil, sys
    bucket_root = os.environ["FAKE_BUCKET"]
    log = os.environ["FAKE_AWS_LOG"]
    args = sys.argv[1:]
    assert args[:3] == ["--endpoint-url", "https://" + os.environ["R2_ACCOUNT_ID"] + ".r2.cloudflarestorage.com", "--no-cli-pager"], args
    args = args[3:]
    def key(url):
        assert url.startswith("s3://ohtia-packages/"), url
        return url[len("s3://ohtia-packages/"):]
    def record(entry):
        with open(log, "a") as stream:
            stream.write(json.dumps(entry) + "\\n")
        fail = os.environ.get("FAKE_AWS_FAIL")
        if fail and entry.get("op") == "put" and entry["key"].endswith(fail):
            sys.exit("upload failed")
    if args[:2] == ["s3api", "list-objects-v2"]:
        prefix = args[args.index("--prefix") + 1]
        keys = []
        for parent, _, names in os.walk(bucket_root):
            for name in names:
                relative = os.path.relpath(os.path.join(parent, name), bucket_root)
                if relative.startswith(prefix) and not relative.endswith(".meta"):
                    keys.append(relative)
        json.dump({"Contents": [{"Key": k} for k in sorted(keys)]} if keys else {}, sys.stdout)
    elif args[:2] == ["s3", "cp"]:
        rest = args[2:]
        meta = {}
        while rest[0].startswith("--"):
            if rest[0] == "--only-show-errors":
                rest = rest[1:]
            else:
                meta[rest[0][2:]] = rest[1]
                rest = rest[2:]
        source, destination = rest
        if destination.startswith("s3://"):
            target = os.path.join(bucket_root, key(destination))
            record({"op": "put", "key": key(destination), **meta})
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(source, target)
            with open(target + ".meta", "w") as stream:
                json.dump(meta, stream)
        else:
            record({"op": "get", "key": key(source)})
            shutil.copyfile(os.path.join(bucket_root, key(source)), destination)
    elif args[:2] == ["s3", "rm"]:
        target = key(args[-1])
        record({"op": "delete", "key": target})
        os.remove(os.path.join(bucket_root, target))
        os.remove(os.path.join(bucket_root, target) + ".meta")
    else:
        sys.exit("unexpected aws call: " + " ".join(args))
    """
)
FAKE_CURL = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import os, sys
    args = sys.argv[1:]
    output = None
    url = None
    i = 0
    while i < len(args):
        if args[i] == "-o":
            output = args[i + 1]; i += 2
        elif args[i] in ("--retry", "-H"):
            i += 2
        elif args[i].startswith("-"):
            i += 1
        else:
            url = args[i]; i += 1
    address = "https://packages.ohtia.com/"
    assert url.startswith(address), url
    name = url[len(address):].split("?", 1)[0]
    with open(os.path.join(os.environ["FAKE_BUCKET"], name), "rb") as stream:
        data = stream.read()
    if os.environ.get("FAKE_CURL_ALTER") and name.endswith(os.environ["FAKE_CURL_ALTER"]):
        data = data + b"altered"
    if output:
        open(output, "wb").write(data)
    else:
        sys.stdout.buffer.write(data)
    """
)


def action_steps() -> dict[str, str]:
    """Return each step's name and shell script, read from the action definition."""
    text = ACTION.read_text(encoding="utf-8")
    steps = {}
    for block in text.split("\n    - name: ")[1:]:
        name = block.split("\n", 1)[0]
        script = block.split("      run: |\n", 1)[1]
        lines = []
        for line in script.splitlines():
            if line and not line.startswith("        "):
                break
            lines.append(line[8:])
        steps[name] = "\n".join(lines) + "\n"
    return steps


def build_deb(directory: Path, name: str, version: str, architecture: str) -> Path:
    tree = directory / ("tree-" + name)
    (tree / "DEBIAN").mkdir(parents=True)
    (tree / "opt/ohtia").mkdir(parents=True)
    (tree / "opt/ohtia/marker").write_text(name + "\n")
    (tree / "DEBIAN/control").write_text(
        f"Package: ohtia\nVersion: {version}-1\nArchitecture: {architecture}\n"
        "Maintainer: Disposable <disposable@example.invalid>\n"
        "Description: Disposable repository fixture\n"
    )
    file = directory / name
    subprocess.run(
        ["dpkg-deb", "--root-owner-group", "-Zgzip", "--build", str(tree), str(file)],
        check=True,
        capture_output=True,
        timeout=120,
    )
    return file


def build_rpm(directory: Path, name: str, version: str, release: str, architecture: str) -> Path:
    top = directory / ("rpmbuild-" + name)
    (top / "SPECS").mkdir(parents=True)
    spec = top / "SPECS/ohtia.spec"
    spec.write_text(
        f"Name: ohtia\nVersion: {version}\nRelease: 1.fc{release}\n"
        "Summary: Disposable repository fixture\nLicense: MIT\n"
        "%description\nDisposable repository fixture\n"
        "%install\nmkdir -p %{buildroot}/opt/ohtia\n"
        f"echo {name} > %{{buildroot}}/opt/ohtia/marker\n"
        "%files\n/opt/ohtia/marker\n"
    )
    subprocess.run(
        [
            "rpmbuild",
            "--quiet",
            "--define",
            f"_topdir {top}",
            "--define",
            "_build_id_links none",
            "--target",
            architecture,
            "-bb",
            str(spec),
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    built = next((top / "RPMS" / architecture).glob("*.rpm"))
    file = directory / name
    built.rename(file)
    return file


def sign_rpm(file: Path, home: Path, subkey: str) -> None:
    passphrase = home / "rpm-passphrase"
    passphrase.write_text(PASSPHRASE)
    subprocess.run(
        [
            "rpmsign",
            "--define",
            f"_gpg_name {subkey}!",
            "--define",
            "_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback "
            f"--passphrase-file {passphrase}",
            "--addsign",
            str(file),
        ],
        check=True,
        capture_output=True,
        env={**os.environ, "GNUPGHOME": str(home)},
        timeout=120,
    )


@unittest.skipUnless(
    os.name == "posix" and all(shutil.which(tool) for tool in TOOLS),
    "Requires bash, dpkg-dev, createrepo_c, the RPM tools, GnuPG and jq",
)
class PackageRepositoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = tempfile.TemporaryDirectory()
        base = Path(cls.base.name)
        cls.steps = action_steps()
        owner_home, other_home = base / "owner", base / "other"
        cls.homes = (owner_home, other_home)
        cls.owner_home, cls.other_home = owner_home, other_home
        cls.primary = signing.owner(owner_home, "Disposable")
        expired = signing.add_signing_subkey(
            owner_home, cls.primary, "--faked-system-time", "20200102T000000", expire="1d"
        )
        cls.subkey = signing.add_signing_subkey(owner_home, cls.primary)
        cls.public = signing.gpg(owner_home, "--armor", "--export", cls.primary)
        cls.subkey_export = signing.export_subkey(owner_home, cls.subkey)
        cls.expired_export = signing.export_subkey(owner_home, expired)
        cls.full_export = signing.gpg(
            owner_home, "--passphrase", PASSPHRASE, "--armor", "--export-secret-keys", cls.primary
        )
        other = signing.owner(other_home, "Foreign")
        cls.other_public = signing.gpg(other_home, "--armor", "--export", other)
        cls.other_subkey = signing.add_signing_subkey(other_home, other)
        cls.other_export = signing.export_subkey(other_home, cls.other_subkey)
        cls.bin = base / "bin"
        cls.bin.mkdir()
        for name, script in (("gh", FAKE_GH), ("aws", FAKE_AWS), ("curl", FAKE_CURL)):
            (cls.bin / name).write_text(script)
            (cls.bin / name).chmod(0o755)
        platforms = json.loads((ROOT / "config/release/platforms.json").read_text())
        cls.debs = [
            (build["target"], package["profile"])
            for platform in platforms["platforms"]
            if platform["id"] == "linux"
            for build in platform["builds"]
            for package in build["packages"]
            if package["format"] == "deb"
        ]
        cls.rpms = [
            (build["target"], package["profile"])
            for platform in platforms["platforms"]
            if platform["id"] == "linux"
            for build in platform["builds"]
            for package in build["packages"]
            if package["format"] == "rpm"
        ]

    @classmethod
    def tearDownClass(cls):
        for home in cls.homes:
            signing.kill_agent(home)
        cls.base.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.bucket = self.root / "bucket"
        self.bucket.mkdir()
        self.log = self.root / "aws.log"
        self.secrets = {"SIGNING_SUBKEY": self.subkey_export, "SIGNING_PASSPHRASE": PASSPHRASE}
        self.extra: dict[str, str] = {}
        self.write_workspace(self.public)

    def tearDown(self):
        self.directory.cleanup()

    def write_workspace(self, public: str, fingerprint: str | None = None) -> None:
        self.workspace = self.root / "workspace"
        release = self.workspace / "config/release"
        release.mkdir(parents=True, exist_ok=True)
        for name in ("platforms.json", "repository.json"):
            shutil.copyfile(ROOT / "config/release" / name, release / name)
        (release / "signing-key.asc").write_text(public, encoding="utf-8")
        record = {"schema_version": 1, "fingerprint": fingerprint or self.primary}
        (release / "signing.json").write_text(json.dumps(record), encoding="utf-8")

    def prepare_release(
        self, version: str, *, run_id: str = RUN_ID, alter: str = "", foreign: str = ""
    ) -> None:
        """Write a release fixture of version with every declared Debian and Fedora package."""
        fixture = self.root / ("release-" + version)
        if fixture.exists():
            shutil.rmtree(fixture)
        (fixture / "assets").mkdir(parents=True)
        packages = fixture / "packages"
        packages.mkdir()
        entries, assets = [], []
        architecture = {"linux-x64": "amd64", "linux-arm64": "arm64"}
        for index, (target, profile) in enumerate(self.debs, start=1):
            name = f"ohtia-{version}-{target}-{profile}.deb"
            file = build_deb(packages, name, version, architecture[target])
            data = file.read_bytes()
            entries.append(
                {
                    "name": name,
                    "platform": "linux",
                    "target": target,
                    "profile": profile,
                    "format": "deb",
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "authentication": "repository",
                }
            )
            if name == alter:
                data = data[:-1] + bytes([data[-1] ^ 1])
            (fixture / "assets" / str(index)).write_bytes(data)
            assets.append({"id": index, "name": name, "size": len(data), "state": "uploaded"})
        rpm_architecture = {"linux-x64": "x86_64", "linux-arm64": "aarch64"}
        for index, (target, profile) in enumerate(self.rpms, start=50):
            name = f"ohtia-{version}-{target}-{profile}.rpm"
            release = profile.split("-", 1)[1]
            file = build_rpm(packages, name, version, release, rpm_architecture[target])
            if name == foreign:
                sign_rpm(file, self.other_home, self.other_subkey)
            else:
                sign_rpm(file, self.owner_home, self.subkey)
            data = file.read_bytes()
            entries.append(
                {
                    "name": name,
                    "platform": "linux",
                    "target": target,
                    "profile": profile,
                    "format": "rpm",
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "authentication": "embedded",
                }
            )
            if name == alter:
                data = data[:-1] + bytes([data[-1] ^ 1])
            (fixture / "assets" / str(index)).write_bytes(data)
            assets.append({"id": index, "name": name, "size": len(data), "state": "uploaded"})
        record = {
            "schema_version": 1,
            "version": version,
            "source": {"commit": COMMIT, "tree": "d" * 40},
            "workflow": {
                "path": "prepare",
                "commit": COMMIT,
                "run_id": int(run_id),
                "run_attempt": 1,
            },
            "assets": entries,
        }
        digests = json.dumps(record, indent=2).encode()
        (fixture / "assets" / "100").write_bytes(digests)
        assets.append(
            {"id": 100, "name": "release-digests.json", "size": len(digests), "state": "uploaded"}
        )
        self.digests_sha256 = hashlib.sha256(digests).hexdigest()
        self.record = record
        release = {
            "id": 7,
            "tag_name": f"v{version}",
            "name": version,
            "target_commitish": COMMIT,
            "prerelease": False,
            "draft": True,
            "assets": assets,
        }
        (fixture / "releases.json").write_text(json.dumps([release]))
        self.fixture = fixture

    def run_step(self, name: str, **env: str) -> subprocess.CompletedProcess:
        environment = {
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "HOME": str(self.root),
            "LANG": "C.UTF-8",
            "RUNNER_TEMP": str(self.runner),
            "GITHUB_REPOSITORY": "ohtia/ohtia",
            "GITHUB_RUN_ID": RUN_ID,
            "FAKE_RELEASE": str(self.fixture),
            "FAKE_BUCKET": str(self.bucket),
            "FAKE_AWS_LOG": str(self.log),
            **env,
        }
        return subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", self.steps[name]],
            cwd=self.workspace,
            env=environment,
            capture_output=True,
            text=True,
            timeout=300,
        )

    def run_action(
        self,
        version: str,
        zone: str = "test",
        *,
        run_id: str = RUN_ID,
        digests: str = "",
        tamper=None,
    ) -> list[subprocess.CompletedProcess]:
        """Run the metadata stage, then the publish stage with that stage's dnf metadata."""
        fetch = {
            "OHTIA_REPOSITORY_ZONE": zone,
            "GH_TOKEN": "synthetic",
            "OHTIA_RELEASE_VERSION": version,
            "OHTIA_RELEASE_COMMIT": COMMIT,
            "OHTIA_RELEASE_RUN_ID": run_id,
            "OHTIA_RELEASE_DIGESTS_SHA256": digests,
        }
        results = []
        self.runner = Path(tempfile.mkdtemp(dir=self.root))
        for name, env in (
            (FETCH, {**fetch, "OHTIA_REPOSITORY_STAGE": "metadata"}),
            (METADATA, {}),
        ):
            results.append(self.run_step(name, **env))
            if results[-1].returncode:
                self.last_upload = results[-1]
                return results
        metadata = self.runner / "package-repositories/dnf-metadata"
        if tamper:
            tamper(metadata)
        self.runner = Path(tempfile.mkdtemp(dir=self.root))
        for name, env in (
            (FETCH, {**fetch, "OHTIA_REPOSITORY_STAGE": "publish"}),
            (BUILD, {}),
            (CHECK, {"OHTIA_DNF_METADATA": str(metadata)}),
            (SIGN, self.secrets),
            (VERIFY, {}),
            (
                UPLOAD,
                {
                    "OHTIA_REPOSITORY_ZONE": zone,
                    "AWS_ACCESS_KEY_ID": "synthetic",
                    "AWS_SECRET_ACCESS_KEY": "synthetic",
                    "R2_ACCOUNT_ID": ACCOUNT,
                    **self.extra,
                },
            ),
        ):
            results.append(self.run_step(name, **env))
            if results[-1].returncode:
                break
        self.last_upload = results[-1]
        return results

    def assertSucceeded(self, results):
        for result in results:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(results), 8)

    def assertRefused(self, results, prefix, message):
        self.assertNotEqual(results[-1].returncode, 0)
        self.assertRegex(results[-1].stderr, rf"(?m)^{prefix} refused: .*{re.escape(message)}")

    def operations(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def distributions(self) -> set[str]:
        return {profile.split("-", 1)[0] for _, profile in self.debs}

    def test_the_action_publishes_a_signed_flat_repository_for_each_distribution(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        operations = self.operations()
        for distribution in self.distributions():
            prefix = f"test/{distribution}/"
            puts = [op for op in operations if op["op"] == "put" and op["key"].startswith(prefix)]
            names = [op["key"][len(prefix) :] for op in puts]
            # Packages first, then the indexes by digest, the plain indexes, and InRelease last.
            kinds = [
                "deb" if n.endswith(".deb") else "hash" if n.startswith("by-hash/") else n
                for n in names
            ]
            self.assertEqual(kinds[-1], "InRelease")
            self.assertEqual(kinds[-3:-1], ["Packages", "Packages.gz"])
            self.assertEqual(kinds[:-3], sorted(kinds[:-3], key=lambda kind: kind != "deb"))
            self.assertEqual(kinds.count("hash"), 2)
            self.assertNotIn("Release", names)
            for op in puts:
                expected = (
                    IMMUTABLE
                    if op["key"].endswith(".deb") or "/by-hash/" in op["key"]
                    else "no-cache"
                )
                self.assertEqual(op["cache-control"], expected, op)
            expected = {
                entry["name"]: entry["sha256"]
                for entry in self.record["assets"]
                if entry["format"] == "deb" and entry["profile"].startswith(distribution + "-")
            }
            served = {
                file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                for file in (self.bucket / prefix).glob("*.deb")
            }
            self.assertEqual(served, expected)
            release = (self.bucket / prefix / "InRelease").read_text()
            self.assertIn("Acquire-By-Hash: yes", release)
            self.assertIn("Architectures: amd64 arm64", release)
            self.assertNotRegex(release, "(?m)^(Suite|Codename):")
        self.assertFalse(any(op["op"] == "delete" for op in operations))
        self.assertFalse((self.bucket / "stable").exists())

    @unittest.skipUnless(shutil.which("apt-get"), "Requires apt, as on the Ubuntu runner image")
    def test_apt_accepts_the_repository_with_the_committed_key_and_offers_the_version(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        for distribution in self.distributions():
            state = self.apt_state(distribution)
            update = state("update")
            self.assertEqual(update.returncode, 0, update.stdout + update.stderr)
            self.assertNotRegex(update.stdout + update.stderr, r"(?m)^(W|E):")
            policy = state("-s", "install", "ohtia")
            self.assertEqual(policy.returncode, 0, policy.stderr)
            self.assertIn("Inst ohtia (0.3.0-1", policy.stdout)
            fetched = state("--download-only", "-y", "install", "ohtia")
            self.assertEqual(fetched.returncode, 0, fetched.stdout + fetched.stderr)

    @unittest.skipUnless(shutil.which("apt-get"), "Requires apt, as on the Ubuntu runner image")
    def test_apt_refuses_an_invalid_signature_and_a_package_altered_after_indexing(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        distribution = sorted(self.distributions())[0]
        prefix = self.bucket / "test" / distribution
        package = next(file for file in prefix.glob("*.deb") if "-linux-x64-" in file.name)
        data = bytearray(package.read_bytes())
        data[-1] ^= 1
        package.write_bytes(bytes(data))
        state = self.apt_state(distribution)
        self.assertEqual(state("update").returncode, 0)
        fetched = state("--download-only", "-y", "install", "ohtia")
        self.assertNotEqual(fetched.returncode, 0)
        self.assertRegex(fetched.stdout + fetched.stderr, "(?i)hash sum mismatch|size mismatch")
        release = prefix / "InRelease"
        text = release.read_text()
        release.write_text(text.replace("Label: Ohtia", "Label: Altered"))
        refused = self.apt_state(distribution)("update")
        self.assertNotEqual(refused.returncode, 0)
        self.assertRegex(refused.stdout + refused.stderr, "(?i)signature|not signed|BADSIG")
        release.write_text(text)
        foreign = self.apt_state(distribution, public=self.other_public)("update")
        self.assertNotEqual(foreign.returncode, 0)
        self.assertRegex(foreign.stdout + foreign.stderr, "(?i)NO_PUBKEY|not signed")

    def apt_state(self, distribution: str, *, public: str | None = None):
        """Return a callable that runs apt-get with one persistent private state directory."""
        state = Path(tempfile.mkdtemp(dir=self.root))
        for directory in (
            "etc/sources.list.d",
            "etc/preferences.d",
            "lists/partial",
            "cache/archives/partial",
        ):
            (state / directory).mkdir(parents=True)
        key = state / "ohtia-archive-keyring.asc"
        key.write_text(public or self.public, encoding="utf-8")
        (state / "etc/sources.list.d/ohtia.sources").write_text(
            f"Types: deb\nURIs: file:{self.bucket}/test/{distribution}/\nSuites: ./\n"
            f"Signed-By: {key}\n"
        )
        (state / "status").write_text("")
        options = []
        for setting in (
            f"Dir::Etc::sourcelist={state / 'etc/sources.list'}",
            f"Dir::Etc::sourceparts={state / 'etc/sources.list.d'}",
            f"Dir::Etc::preferencesparts={state / 'etc/preferences.d'}",
            f"Dir::State::Lists={state / 'lists'}",
            f"Dir::State::status={state / 'status'}",
            f"Dir::Cache={state / 'cache'}",
            "Debug::NoLocking=true",
            "APT::Architecture=amd64",
            "APT::Sandbox::User=",
        ):
            options += ["-o", setting]

        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run(
                ["apt-get", *options, *args],
                cwd=state,
                capture_output=True,
                text=True,
                timeout=120,
            )

        return run

    def test_an_interrupted_upload_keeps_the_previous_index_and_reports_it(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        distribution = sorted(self.distributions())[0]
        previous = (self.bucket / "test" / distribution / "InRelease").read_bytes()
        self.prepare_release("0.3.1")
        self.extra = {"FAKE_AWS_FAIL": f"test/{distribution}/InRelease"}
        results = self.run_action("0.3.1")
        self.assertNotEqual(results[-1].returncode, 0)
        self.assertIn(
            f"::error::The test/{distribution} repository upload is incomplete: it stopped while "
            "uploading the signed index, and the previous index is still served.",
            results[-1].stderr,
        )
        self.assertEqual((self.bucket / "test" / distribution / "InRelease").read_bytes(), previous)
        self.extra = {}
        self.assertSucceeded(self.run_action("0.3.1"))
        self.assertIn("0.3.1-1", (self.bucket / "test" / distribution / "Packages").read_text())
        # The interrupted upload had already replaced Packages; the packages of the index that
        # stayed served until the retry, 0.3.0, remain for clients that read it.
        self.assertEqual(self.served_versions(distribution), {"0.3.0", "0.3.1"})

    def served_versions(self, distribution: str) -> set[str]:
        prefix = self.bucket / "test" / distribution
        return {re.match(r"ohtia-([0-9.]+)-", f.name)[1] for f in prefix.glob("*.deb")}

    def test_a_rerun_of_the_same_version_keeps_the_previous_version(self):
        for version in ("0.3.0", "0.3.1"):
            self.prepare_release(version)
            self.assertSucceeded(self.run_action(version))
        # A rerun reads the same release bytes, so it builds the same index.
        self.assertSucceeded(self.run_action("0.3.1"))
        self.assertIn("older files stay until the next version", self.last_upload.stdout)
        for distribution in self.distributions():
            self.assertEqual(self.served_versions(distribution), {"0.3.0", "0.3.1"})
        self.prepare_release("0.3.2")
        self.assertSucceeded(self.run_action("0.3.2"))
        for distribution in self.distributions():
            self.assertEqual(self.served_versions(distribution), {"0.3.1", "0.3.2"})

    def test_a_previous_index_without_its_packages_by_digest_removes_nothing(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        self.prepare_release("0.3.1")
        self.assertSucceeded(self.run_action("0.3.1"))
        distribution = sorted(self.distributions())[0]
        prefix = self.bucket / "test" / distribution
        listed = [
            line.split()[0]
            for line in (prefix / "InRelease").read_text().splitlines()
            if re.fullmatch(r" [0-9a-f]{64} [0-9]+ Packages", line)
        ]
        # Each case publishes a new version, so its previous index differs from the new one.
        for case, version in (("missing", "0.3.2"), ("altered", "0.3.3")):
            with self.subTest(case=case):
                previous = prefix / "by-hash/SHA256" / listed[0]
                if case == "missing":
                    previous.unlink()
                    previous.with_name(previous.name + ".meta").unlink()
                else:
                    previous.write_bytes(b"Package: other\n")
                    previous.with_name(previous.name + ".meta").write_text("{}")
                self.prepare_release(version)
                results = self.run_action(version)
                self.assertSucceeded(results)
                self.assertIn(
                    f"::warning::The previous test/{distribution} index names no readable "
                    "Packages by digest; no file was removed.",
                    results[-1].stdout,
                )
                self.assertLessEqual({"0.3.0", "0.3.1"}, self.served_versions(distribution))
                listed = [
                    line.split()[0]
                    for line in (prefix / "InRelease").read_text().splitlines()
                    if re.fullmatch(r" [0-9a-f]{64} [0-9]+ Packages", line)
                ]

    def test_served_bytes_that_differ_from_the_release_are_reported(self):
        self.prepare_release("0.3.0")
        name = next(e["name"] for e in self.record["assets"] if e["format"] == "deb")
        self.extra = {"FAKE_CURL_ALTER": name}
        results = self.run_action("0.3.0")
        self.assertNotEqual(results[-1].returncode, 0)
        self.assertIn(
            f"comparing the served {name}, and the new signed index is served", results[-1].stderr
        )

    def test_a_new_version_keeps_the_previous_packages_and_removes_older_ones(self):
        for version in ("0.3.0", "0.3.1", "0.3.2"):
            self.prepare_release(version)
            self.assertSucceeded(self.run_action(version))
        for distribution in self.distributions():
            prefix = self.bucket / "test" / distribution
            versions = {re.match(r"ohtia-([0-9.]+)-", f.name)[1] for f in prefix.glob("*.deb")}
            self.assertEqual(versions, {"0.3.1", "0.3.2"})
            hashes = {
                f.name
                for f in (prefix / "by-hash/SHA256").iterdir()
                if not f.name.endswith(".meta")
            }
            self.assertEqual(len(hashes), 4)
            listed = {
                line.split()[0]
                for line in (prefix / "InRelease").read_text().splitlines()
                if re.fullmatch(r" [0-9a-f]{64} [0-9]+ Packages(\.gz)?", line)
            }
            self.assertLessEqual(listed, hashes)

    def test_the_stable_zone_is_bound_to_the_approved_digests(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(
            self.run_action("0.3.0", "stable", run_id="", digests=self.digests_sha256)
        )
        self.assertTrue((self.bucket / "stable").is_dir())
        self.assertFalse((self.bucket / "test").exists())
        results = self.run_action("0.3.0", "stable", run_id="", digests="0" * 64)
        self.assertRefused(results, "Repository", "differs from the approved digests")
        # Publication runs from the current main: a declaration changed since preparation does
        # not block the approved release, while preparation still checks its own declaration.
        platforms = self.workspace / "config/release/platforms.json"
        declaration = json.loads(platforms.read_text())
        linux = next(p for p in declaration["platforms"] if p["id"] == "linux")
        linux["builds"][0]["packages"].append({"profile": "debian-14", "format": "deb"})
        platforms.write_text(json.dumps(declaration))
        self.assertSucceeded(
            self.run_action("0.3.0", "stable", run_id="", digests=self.digests_sha256)
        )
        self.assertRefused(
            self.run_action("0.3.0"), "Repository", "does not list every declared deb package"
        )

    def test_two_profiles_of_one_distribution_are_refused(self):
        self.prepare_release("0.3.0")
        record = json.loads((self.fixture / "assets/100").read_text())
        entry = next(e for e in record["assets"] if e["profile"].startswith("ubuntu-"))
        entry["profile"] = "ubuntu-26.10"
        data = json.dumps(record).encode()
        (self.fixture / "assets/100").write_bytes(data)
        release = json.loads((self.fixture / "releases.json").read_text())
        release[0]["assets"][-1]["size"] = len(data)
        (self.fixture / "releases.json").write_text(json.dumps(release))
        self.assertRefused(
            self.run_action("0.3.0"), "Repository", "Two ubuntu profiles would share one repository"
        )

    def test_a_release_that_differs_from_its_digests_or_run_is_refused(self):
        self.prepare_release("0.3.0")
        self.assertRefused(
            self.run_action("0.3.0", run_id="99"), "Repository", "does not describe this release"
        )
        self.assertRefused(self.run_action("0.3.1"), "Repository", "not exactly one release")
        self.assertRefused(
            self.run_action("0.3.0", "public"), "Repository", "zone must be stable or test"
        )
        self.assertRefused(
            self.run_action("0.3.0", run_id=""), "Repository", "Neither a run nor approved digests"
        )
        name = next(e["name"] for e in self.record["assets"] if e["format"] == "deb")
        self.prepare_release("0.3.0", alter=name)
        self.assertRefused(
            self.run_action("0.3.0"), "Repository", f"{name} differs from release-digests.json"
        )
        self.prepare_release("0.3.0")
        record = json.loads((self.fixture / "assets/100").read_text())
        record["assets"][0]["authentication"] = "unsigned"
        data = json.dumps(record).encode()
        (self.fixture / "assets/100").write_bytes(data)
        release = json.loads((self.fixture / "releases.json").read_text())
        release[0]["assets"][-1]["size"] = len(data)
        (self.fixture / "releases.json").write_text(json.dumps(release))
        self.assertRefused(
            self.run_action("0.3.0"), "Repository", "is not authenticated by the repository"
        )
        self.assertEqual(self.log.read_text() if self.log.exists() else "", "")

    def test_a_subkey_that_is_not_the_release_subkey_is_refused_before_signing(self):
        self.prepare_release("0.3.0")
        for export, message in (
            (self.other_export, "does not belong to the recorded primary key"),
            (self.full_export, "holds the secret primary key"),
            (self.expired_export, "no single valid signing subkey"),
        ):
            with self.subTest(message=message):
                self.secrets = {"SIGNING_SUBKEY": export, "SIGNING_PASSPHRASE": PASSPHRASE}
                results = self.run_action("0.3.0")
                self.assertEqual(len(results), 6)
                self.assertRefused(results, "Signing", message)
        self.secrets = {"SIGNING_SUBKEY": self.subkey_export, "SIGNING_PASSPHRASE": "wrong"}
        results = self.run_action("0.3.0")
        self.assertRefused(results, "Signing", "could not sign")
        self.assertFalse(self.log.exists())
        self.secrets = {"SIGNING_SUBKEY": self.subkey_export, "SIGNING_PASSPHRASE": PASSPHRASE}
        self.write_workspace(self.other_public)
        self.assertRefused(self.run_action("0.3.0"), "Signing", "not the recorded primary key")

    # Fedora dnf repositories, one per declared Fedora release.

    def fedora_releases(self) -> set[str]:
        return {profile.split("-", 1)[1] for _, profile in self.rpms}

    def fedora_versions(self, release: str, zone: str = "test") -> set[str]:
        prefix = self.bucket / zone / "fedora" / release
        return {re.match(r"ohtia-([0-9.]+)-", f.name)[1] for f in prefix.glob("*.rpm")}

    def dnf_state(self, release: str, *, public: str | None = None):
        """Return a callable that runs dnf with one private configuration and cache."""
        state = Path(tempfile.mkdtemp(dir=self.root))
        (state / "repos").mkdir()
        key = state / "RPM-GPG-KEY-ohtia"
        key.write_text(public or self.public, encoding="utf-8")
        (state / "repos/ohtia.repo").write_text(
            "[ohtia]\nname=Ohtia\n"
            f"baseurl=file://{self.bucket}/test/fedora/{release}/\n"
            "enabled=1\ngpgcheck=1\nrepo_gpgcheck=1\nskip_if_unavailable=0\n"
            f"gpgkey=file://{key}\n"
        )
        options = [
            "-y",
            f"--setopt=reposdir={state / 'repos'}",
            f"--setopt=cachedir={state / 'cache'}",
            "--repo=ohtia",
            f"--releasever={release}",
        ]
        if dnf5():
            options.append(f"--setopt=system_cachedir={state / 'cache'}")
        else:
            # dnf 4 reads a package database, so an unprivileged query uses an empty root.
            (state / "root").mkdir()
            options.append(f"--installroot={state / 'root'}")

        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run(
                [DNF, *options, *args],
                cwd=state,
                capture_output=True,
                text=True,
                timeout=300,
                env={**os.environ, "HOME": str(state)},
            )

        run.state = state
        return run

    def test_the_action_publishes_a_signed_dnf_repository_for_each_fedora_release(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        operations = self.operations()
        keyring = self.root / "keyring.gpg"
        keyring.write_bytes(
            subprocess.run(
                ["gpg", "--batch", "--dearmor"],
                input=self.public.encode(),
                capture_output=True,
                check=True,
            ).stdout
        )
        for release in self.fedora_releases():
            prefix = f"test/fedora/{release}/"
            puts = [op for op in operations if op["op"] == "put" and op["key"].startswith(prefix)]
            names = [op["key"][len(prefix) :] for op in puts]
            # Packages first, then the data files by digest, repomd.xml and its signature last.
            kinds = [
                "rpm" if n.endswith(".rpm") else n if n.startswith("repodata/repomd") else "data"
                for n in names
            ]
            self.assertEqual(kinds[-2:], ["repodata/repomd.xml", "repodata/repomd.xml.asc"])
            self.assertEqual(kinds[:-2], sorted(kinds[:-2], key=lambda kind: kind != "rpm"))
            self.assertEqual(kinds.count("data"), 3)
            for op in puts:
                expected = "no-cache" if "/repodata/repomd" in op["key"] else IMMUTABLE
                self.assertEqual(op["cache-control"], expected, op)
            expected = {
                entry["name"]: entry["sha256"]
                for entry in self.record["assets"]
                if entry["format"] == "rpm" and entry["profile"] == f"fedora-{release}"
            }
            served = {
                file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                for file in (self.bucket / prefix).glob("*.rpm")
            }
            self.assertEqual(served, expected)
            repodata = self.bucket / prefix / "repodata"
            verified = subprocess.run(
                [
                    "gpgv",
                    "--keyring",
                    str(keyring),
                    str(repodata / "repomd.xml.asc"),
                    str(repodata / "repomd.xml"),
                ],
                capture_output=True,
            )
            self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertEqual(
            {op["key"].split("/")[2] for op in operations if "/fedora/" in op["key"]},
            self.fedora_releases(),
        )

    @unittest.skipUnless(DNF, "Requires dnf, as installed for the repository tests")
    def test_dnf_accepts_each_release_repository_with_the_committed_key(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        for release in self.fedora_releases():
            dnf = self.dnf_state(release)
            query = dnf("repoquery", "--qf", "%{name}-%{version}-%{release}.%{arch}\n", "ohtia")
            self.assertEqual(query.returncode, 0, query.stdout + query.stderr)
            self.assertIn(f"ohtia-0.3.0-1.fc{release}.", query.stdout)

    @unittest.skipUnless(DNF, "Requires dnf, as installed for the repository tests")
    def test_dnf_refuses_metadata_with_an_invalid_signature_or_another_key(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        release = sorted(self.fedora_releases())[0]
        signature = self.bucket / "test/fedora" / release / "repodata/repomd.xml.asc"
        foreign = self.dnf_state(release, public=self.other_public)("repoquery", "ohtia")
        self.assertNotEqual(foreign.returncode, 0)
        self.assertRegex(foreign.stdout + foreign.stderr, "(?i)signature|gpg|openpgp")
        original = signature.read_bytes()
        repomd = signature.with_name("repomd.xml")
        repomd.write_bytes(repomd.read_bytes().replace(b"<revision>", b"<revision>1"))
        refused = self.dnf_state(release)("repoquery", "ohtia")
        self.assertNotEqual(refused.returncode, 0)
        self.assertRegex(refused.stdout + refused.stderr, "(?i)signature|gpg|openpgp")
        self.assertEqual(signature.read_bytes(), original)

    def test_a_package_altered_after_indexing_or_signed_with_another_key_is_refused(self):
        """dnf5 refuses both; dnf 4 installs only as root, so there rpmkeys and digests check them."""
        foreign = next(f"ohtia-0.3.0-{t}-{p}.rpm" for t, p in self.rpms if t == "linux-x64")
        self.prepare_release("0.3.0", foreign=foreign)
        self.assertSucceeded(self.run_action("0.3.0"))
        release = next(p.split("-", 1)[1] for t, p in self.rpms if foreign.endswith(f"{t}-{p}.rpm"))
        prefix = self.bucket / "test/fedora" / release
        current = dnf5()
        if current:
            dnf = self.dnf_state(release)
            install = dnf(
                f"--installroot={dnf.state / 'root'}",
                "--use-host-config",
                "--setopt=tsflags=test",
                "install",
                "ohtia",
            )
            self.assertNotEqual(install.returncode, 0)
            self.assertRegex(install.stdout + install.stderr, "(?i)signature verification failed")
        else:
            keyring = self.root / "rpmdb"
            keyring.mkdir()
            key = self.root / "committed.asc"
            key.write_text(self.public)
            subprocess.run(["rpmkeys", "--dbpath", str(keyring), "--import", str(key)], check=True)
            checked = subprocess.run(
                ["rpmkeys", "--dbpath", str(keyring), "--checksig", str(prefix / foreign)],
                capture_output=True,
                text=True,
            )
            self.assertNotRegex(checked.stdout, "digests signatures OK$")
        package = prefix / foreign
        package.write_bytes(package.read_bytes() + b"altered")
        if current:
            dnf = self.dnf_state(release)
            fetched = dnf(
                f"--installroot={dnf.state / 'root'}",
                "--use-host-config",
                "install",
                "--downloadonly",
                "ohtia",
            )
            self.assertNotEqual(fetched.returncode, 0)
            self.assertRegex(fetched.stdout + fetched.stderr, "(?i)download|checksum|mismatch")
        else:
            listed = subprocess.run(
                ["zcat", "-f", *map(str, (prefix / "repodata").glob("*-primary.xml.gz"))],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            self.assertNotIn(hashlib.sha256(package.read_bytes()).hexdigest(), listed)

    def test_dnf_metadata_that_differs_from_the_release_is_refused(self):
        self.prepare_release("0.3.0")
        release = sorted(self.fedora_releases())[0]

        def drop_release(metadata: Path) -> None:
            shutil.rmtree(metadata / release)

        def alter_data(metadata: Path) -> None:
            data = next((metadata / release / "repodata").glob("*-other.xml.gz"))
            data.write_bytes(data.read_bytes() + b"x")

        def other_packages(metadata: Path) -> None:
            source = self.runner / "package-repositories/rpm" / release
            subset = self.root / "subset"
            subset.mkdir()
            shutil.copy(next(source.glob("*.rpm")), subset)
            shutil.rmtree(metadata / release)
            (metadata / release).mkdir()
            subprocess.run(
                ["createrepo_c", "--quiet", "--no-database", "--checksum", "sha256",
                 "--general-compress-type", "gz", "--outputdir", str(metadata / release),
                 str(subset)],
                check=True,
                capture_output=True,
            )  # fmt: skip

        for tamper, message in (
            (drop_release, "does not cover exactly the Fedora releases"),
            (alter_data, "other file differs from repomd.xml"),
            (other_packages, "does not list exactly the release's RPMs"),
        ):
            with self.subTest(message=message):
                results = self.run_action("0.3.0", tamper=tamper)
                self.assertRefused(results, "Repository", message)
        self.assertFalse(self.log.exists())

    def test_crafted_dnf_metadata_is_refused_before_signing(self):
        """Metadata that does not describe exactly the release's RPMs is refused before signing."""
        self.prepare_release("0.3.0")
        release = sorted(self.fedora_releases())[0]

        def rewrite(kind: str, change):
            def tamper(metadata: Path) -> None:
                repomd = metadata / release / "repodata/repomd.xml"
                text = repomd.read_text()
                if kind == "repomd":
                    repomd.write_text(change(text))
                    return
                data = next((metadata / release / "repodata").glob(f"*-{kind}.xml.gz"))
                old = hashlib.sha256(data.read_bytes()).hexdigest()
                content = gzip.compress(
                    change(gzip.decompress(data.read_bytes()).decode()).encode()
                )
                new = hashlib.sha256(content).hexdigest()
                # A careful forger also renames the file after its new digest, as createrepo_c does.
                data.unlink()
                (data.parent / f"{new}-{kind}.xml.gz").write_bytes(content)
                repomd.write_text(text.replace(old, new))

            return tamper

        def hide_packages(text: str) -> str:
            body = text[text.index("<package ") : text.rindex("</metadata>")]
            text = text.replace(body, "<!-- " + body.replace("--", "") + " -->")
            return re.sub(r'packages="[0-9]+"', 'packages="0"', text, count=1)

        cases = (
            (rewrite("primary", hide_packages), "does not list exactly the release's RPMs"),
            (
                rewrite("primary", lambda t: t.replace(
                    "<metadata", '<!DOCTYPE metadata [<!ENTITY x "y">]><metadata', 1)),
                "declares a document type or entity",
            ),
            (
                rewrite("other", lambda t: t.replace(
                    "</otherdata>", t[t.index("<package ") : t.index("</package>") + 10]
                    + "</otherdata>")),
                "other data does not describe exactly the release's RPMs",
            ),
            (
                rewrite("repomd", lambda t: t.replace(
                    "</repomd>",
                    '<data type="updateinfo"><checksum type="sha256">' + "0" * 64
                    + '</checksum><location href="repodata/' + "0" * 64
                    + '-updateinfo.xml.gz"/></data></repomd>')),
                "names unexpected updateinfo data",
            ),
        )  # fmt: skip
        for tamper, message in cases:
            with self.subTest(message=message):
                self.assertRefused(self.run_action("0.3.0", tamper=tamper), "Repository", message)
        self.assertFalse(self.log.exists())

    def test_an_interrupted_fedora_upload_reports_what_is_served(self):
        self.prepare_release("0.3.0")
        self.assertSucceeded(self.run_action("0.3.0"))
        release = sorted(self.fedora_releases())[0]
        prefix = self.bucket / "test/fedora" / release / "repodata"
        previous = (prefix / "repomd.xml").read_bytes()
        self.prepare_release("0.3.1")
        for failing, message in (
            ("repodata/repomd.xml", "uploading the signed metadata, and the previous metadata is still served"),
            ("repodata/repomd.xml.asc", "uploading the signed metadata, and the new metadata may be served without its signature"),
        ):  # fmt: skip
            with self.subTest(failing=failing):
                self.extra = {"FAKE_AWS_FAIL": f"test/fedora/{release}/{failing}"}
                results = self.run_action("0.3.1")
                self.assertNotEqual(results[-1].returncode, 0)
                self.assertIn(
                    f"::error::The test/fedora/{release} repository upload is incomplete: it "
                    f"stopped while {message}.",
                    results[-1].stderr,
                )
            if failing == "repodata/repomd.xml":
                self.assertEqual((prefix / "repomd.xml").read_bytes(), previous)
        self.extra = {}
        self.assertSucceeded(self.run_action("0.3.1"))
        self.assertEqual(self.fedora_versions(release), {"0.3.0", "0.3.1"})

    def test_fedora_repositories_keep_the_previous_version_only(self):
        for version in ("0.3.0", "0.3.1"):
            self.prepare_release(version)
            self.assertSucceeded(self.run_action(version))
        self.assertSucceeded(self.run_action("0.3.1"))
        self.assertIn("lists the same packages; older files stay", self.last_upload.stdout)
        for release in self.fedora_releases():
            self.assertEqual(self.fedora_versions(release), {"0.3.0", "0.3.1"})
        self.prepare_release("0.3.2")
        self.assertSucceeded(self.run_action("0.3.2"))
        for release in self.fedora_releases():
            self.assertEqual(self.fedora_versions(release), {"0.3.1", "0.3.2"})
            repodata = self.bucket / "test/fedora" / release / "repodata"
            data = {f.name for f in repodata.iterdir() if f.name.endswith(".xml.gz")}
            self.assertEqual(len(data), 6)


class PackageRepositoryWorkflowTests(unittest.TestCase):
    """Both release workflows build the dnf metadata, then publish one zone from a protected job."""

    def job(self, workflow: str, name: str) -> str:
        text = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
        return text.split(f"\n  {name}:\n", 1)[1].split("\n\n  ", 1)[0] + "\n"

    def test_each_workflow_publishes_its_zone_from_a_protected_job(self):
        for workflow, zone, binding in (
            ("prepare-release.yml", "test", "run-id: ${{ github.run_id }}"),
            ("publish-release.yml", "stable", "digests-sha256: ${{ needs.check.outputs.digests }}"),
        ):
            job = (
                (ROOT / ".github/workflows" / workflow)
                .read_text(encoding="utf-8")
                .split("\n  repository:\n", 1)[1]
            )
            with self.subTest(workflow=workflow):
                self.assertIn("    environment: release-signing\n", job)
                self.assertIn(
                    "      group: package-repositories\n      cancel-in-progress: false\n", job
                )
                self.assertIn("uses: $/.github/actions/package-repositories\n", job)
                self.assertIn("          stage: publish\n", job)
                self.assertIn("name: ${{ needs.metadata.outputs.artifact }}\n", job)
                self.assertIn("          sparse-checkout: config/release\n", job)
                self.assertIn(f"          zone: {zone}\n", job)
                self.assertIn(f"          {binding}\n", job)
                self.assertIn("          persist-credentials: false\n", job)
                self.assertIn("r2-account-id: ${{ vars.R2_ACCOUNT_ID }}", job)
        publish = self.job("publish-release.yml", "publish")
        self.assertIn("    needs: [check, repository]\n", publish)

    def test_the_dnf_metadata_is_built_without_secrets_before_the_protected_job(self):
        for workflow, needs, repository_needs in (
            ("prepare-release.yml", "[check, release]", "[check, release, metadata]"),
            ("publish-release.yml", "check", "[check, metadata]"),
        ):
            text = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
            metadata = text.split("\n  metadata:\n", 1)[1].split("\n  repository:\n", 1)[0]
            repository = text.split("\n  repository:\n", 1)[1]
            with self.subTest(workflow=workflow):
                self.assertIn(f"    needs: {needs}\n", metadata)
                self.assertIn(f"    needs: {repository_needs}\n", repository)
                self.assertNotIn("environment:", metadata)
                self.assertNotIn("secrets.", metadata)
                self.assertIn(
                    "sudo apt-get install --no-install-recommends -y createrepo-c\n", metadata
                )
                self.assertIn("          stage: metadata\n", metadata)
                self.assertIn("artifact=dnf-metadata-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT", metadata)
                # The repository job may wait for approval or be rerun for up to 30 days.
                self.assertIn("          retention-days: 30\n", metadata)
                self.assertNotIn("apt-get", repository.split("\n  publish:\n", 1)[0])

    def test_the_action_interpolates_no_input_into_a_script(self):
        text = ACTION.read_text(encoding="utf-8")
        for block in text.split("      run: |\n")[1:]:
            script = block.split("\n    - name: ", 1)[0]
            self.assertNotIn("${{", script)


if __name__ == "__main__":
    unittest.main()
