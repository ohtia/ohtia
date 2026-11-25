"""Qualify repository delivery of a prepared version on one native Linux cell (SPEC-001-041).

The prepare-release workflow runs this entry point from the selected source, without secrets,
after the Linux packages of the prepared version B are in the `test` repositories. On a GNOME
cell, the complete scenario builds version A from the same commit with a lower development
version, registered against the `test` zone, installs A from its package file, saves a value,
updates to B through apt or dnf and checks the value, the running version and the sandbox and
policy state. A is never released and its package is discarded. On a KDE cell, the short
scenario installs B from its package file in the `test` zone and checks the running version and
the same state. The retained report records each step, the digests and the host identity.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import application_version
import installation_native
import linux_profiles
import quality_delivery as delivery
import quality_native
import workspace

ROOT = delivery.ROOT

# The x86-64 Linux cells of the quality inventory: GNOME runs the complete scenario, KDE the
# short one. Ubuntu runs on its hosted runner, Debian and Fedora in their KVM guests.
TARGET = "linux-x64"
LAUNCHERS = ("display-session", "kvm")
PAYLOAD = Path("/opt/ohtia")
SOURCE_ENTRY = Path("/etc/apt/sources.list.d/ohtia.sources")
FEDORA_ENTRY = Path("/etc/yum.repos.d/ohtia.repo")
POLICY = Path("/etc/apparmor.d/ohtia")
# The update reads only the Ohtia entry the package installed, so it neither depends on nor
# changes the host's distribution indexes, and keeps the package it downloads for its digest.
APT_STATE = Path("/var/cache/apt/ohtia-qualification")
DNF_STATE = Path("/var/cache/ohtia-qualification")
SHA256 = re.compile(r"[0-9a-f]{64}")


def declared_cell(cell_id: str) -> dict:
    cells = delivery.read(ROOT / "config/quality/build-targets.json")["cells"]
    found = [item for item in cells if item["id"] == cell_id]
    delivery.require(len(found) == 1, "Repository qualification covers only declared cells.")
    cell = found[0]
    delivery.require(
        cell["target"] == TARGET
        and cell["launcher"] in LAUNCHERS
        and cell.get("desktop") in {"gnome", "kde"}
        and cell["formats"] == [linux_profiles.package_format(cell["profile"])],
        "Repository qualification covers the x86-64 Linux cells with one native package.",
    )
    return cell


def package_format(cell: dict) -> str:
    return cell["formats"][0]


def release_inputs(env: dict) -> dict:
    """Return the prepared version, its commit and the digest file of its unpublished release."""
    version, commit = env["OHTIA_RELEASE_VERSION"], env["OHTIA_RELEASE_COMMIT"]
    delivery.require(
        application_version.FINAL.fullmatch(version) is not None, "Invalid prepared version."
    )
    delivery.require(re.fullmatch(r"[0-9a-f]{40}", commit) is not None, "Invalid release commit.")
    digests = json.loads(env["OHTIA_RELEASE_DIGESTS"])
    delivery.require(
        isinstance(digests, dict)
        and digests.get("schema_version") == 1
        and digests.get("version") == version
        and digests.get("source", {}).get("commit") == commit,
        "The release digest file does not describe the prepared version and commit.",
    )
    return {"version": version, "commit": commit, "digests": digests}


# apt authenticates a DEB through the signed index; each RPM carries its own signature.
AUTHENTICATION = {"deb": "repository", "rpm": "embedded"}


def expected_package(digests: dict, cell: dict) -> dict:
    """Return the release's single package of the cell with its digest and authentication."""
    kind = package_format(cell)
    found = [
        asset
        for asset in digests.get("assets", [])
        if asset.get("target") == cell["target"]
        and asset.get("profile") == cell["profile"]
        and asset.get("format") == kind
    ]
    delivery.require(len(found) == 1, "The release must hold exactly one package of the cell.")
    asset = found[0]
    delivery.require(
        isinstance(asset.get("name"), str)
        and re.fullmatch(r"ohtia-[A-Za-z0-9._-]+\.(deb|rpm)", asset["name"]) is not None
        and SHA256.fullmatch(str(asset.get("sha256"))) is not None
        and isinstance(asset.get("bytes"), int)
        and asset["bytes"] > 0
        and asset.get("authentication") == AUTHENTICATION[kind],
        "The release records an invalid package of the cell.",
    )
    return {key: asset[key] for key in ("name", "sha256", "bytes")}


def native_version(version: str, profile: str = "ubuntu-26.04") -> str:
    """Return the DEB version, or the RPM version and release, the package construction gives."""
    native = version.replace("-", "~", 1) + "-1"
    if linux_profiles.is_fedora(profile):
        return f"{native}.fc{linux_profiles.version(profile)}"
    return native


def check_source(commit: str, version: str) -> None:
    delivery.require(
        delivery.git("rev-parse", "HEAD") == commit
        and not delivery.git("status", "--porcelain", "--untracked-files=no"),
        "Qualify the clean checkout of the release commit.",
    )
    delivery.require(
        application_version.root_version() == version, "The root version is not the release."
    )


def run(args: list, *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    """Run a command; a failure names its captured output, so the report keeps the cause."""
    arguments = [str(arg) for arg in args]
    result = subprocess.run(
        arguments,
        cwd=ROOT,
        env=quality_native.build_environment(),
        check=False,
        capture_output=capture,
        text=True,
        timeout=900,
    )
    if check and result.returncode != 0:
        output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part)
        raise delivery.DeliveryError(
            f"{' '.join(arguments)} exited with {result.returncode}: {output[-4000:]}".strip()
        )
    return result


def installed_version(profile: str = "ubuntu-26.04") -> str | None:
    if linux_profiles.is_fedora(profile):
        result = run(["rpm", "-q", "--qf", "%{VERSION}-%{RELEASE}", "ohtia"], check=False)
        return result.stdout if result.returncode == 0 else None
    result = run(["dpkg-query", "-W", "-f=${Status}\t${Version}", "ohtia"], check=False)
    if result.returncode != 0:
        return None
    status, _, version = result.stdout.partition("\t")
    return version if status == "install ok installed" else None


def install_file(profile: str, package: Path, *, signed: bool) -> None:
    """Install a package file as a researcher does, before any repository is registered."""
    if linux_profiles.is_fedora(profile):
        if signed:
            # A release RPM is verified against the committed release key.
            run(["sudo", "rpm", "--import", ROOT / "config/release/signing-key.asc"])
            run(["sudo", "rpm", "--install", package], capture=False)
        else:
            # A qualification build is unsigned; RPM 6 then needs digest-only verification.
            run(["sudo", "rpm", "--install", *quality_native.UNSIGNED_RPM, package], capture=False)
        return
    run(["sudo", "dpkg", "--install", package], capture=False)


def verify_installed_files(profile: str) -> None:
    """Compare every installed file with the digest its package recorded."""
    tool = (
        ["rpm", "-V", "ohtia"]
        if linux_profiles.is_fedora(profile)
        else ["dpkg", "--verify", "ohtia"]
    )
    verified = run(tool, check=False)
    delivery.require(
        verified.returncode == 0 and not verified.stdout.strip(),
        "Installed files differ from their package: " + verified.stdout + verified.stderr,
    )


def policy_state(profile: str) -> dict:
    """Check the sandbox and policy state ADR-0038 requires on the cell's distribution."""
    distribution = linux_profiles.distribution(profile)
    if distribution == "fedora":
        enforce = run(["getenforce"]).stdout.strip()
        delivery.require(enforce == "Enforcing", "SELinux must remain enforcing.")
        # matchpathcon -V prints one "verified." line per correctly labelled path.
        labels = run(["sudo", "find", PAYLOAD, "-xdev", "-exec", "matchpathcon", "-V", "{}", "+"])
        lines = labels.stdout.splitlines()
        delivery.require(
            lines and all(line.endswith(" verified.") for line in lines),
            "The installed files do not carry their SELinux labels.",
        )
        return {"selinux": enforce, "labelled_paths": len(lines)}
    if distribution == "debian":
        delivery.require(
            Path("/sys/module/apparmor/parameters/enabled").read_text().strip() == "Y",
            "AppArmor must remain enabled.",
        )
        namespaces = Path("/proc/sys/kernel/unprivileged_userns_clone").read_text().strip()
        delivery.require(namespaces == "1", "Debian must admit unprivileged user namespaces.")
        delivery.require(not os.path.lexists(POLICY), "Debian installs no AppArmor allowance.")
        return {
            "apparmor_enabled": True,
            "unprivileged_userns_clone": namespaces,
            "allowance": None,
        }
    return sandbox_state()


def sandbox_state() -> dict:
    """Check the namespace allowance that the package installs for its fixed executable."""
    delivery.require(
        Path("/sys/module/apparmor/parameters/enabled").read_text().strip() == "Y",
        "AppArmor must remain enabled.",
    )
    info = os.lstat(POLICY)
    source = PAYLOAD / "resources/apparmor-profile"
    delivery.require(
        stat.S_ISREG(info.st_mode)
        and info.st_uid == 0
        and info.st_gid == 0
        and stat.S_IMODE(info.st_mode) == 0o644
        and POLICY.read_bytes() == source.read_bytes(),
        "The AppArmor allowance is not the packaged root-owned 0644 profile.",
    )
    # The kernel's profile list is readable only by root.
    loaded = run(["sudo", "cat", "/sys/kernel/security/apparmor/profiles"]).stdout.splitlines()
    delivery.require("ohtia (unconfined)" in loaded, "The AppArmor allowance is not loaded.")
    restriction = Path("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
    return {
        "apparmor_enabled": True,
        "policy_sha256": delivery.digest(POLICY),
        "loaded_profile": "ohtia (unconfined)",
        "restrict_unprivileged_userns": (
            restriction.read_text().strip() if restriction.exists() else None
        ),
    }


def apt(*args: str) -> list[str]:
    return [
        "sudo",
        "apt-get",
        "-o",
        "Dir::Etc::SourceList=/dev/null",
        "-o",
        f"Dir::Etc::SourceParts={APT_STATE / 'sources'}",
        "-o",
        f"Dir::State::Lists={APT_STATE / 'lists'}",
        "-o",
        f"Dir::Cache::Archives={APT_STATE / 'archives'}",
        "-o",
        "APT::Keep-Downloaded-Packages=true",
        "-o",
        "APT::Update::Error-Mode=any",
        *args,
    ]


def update_plan(simulation: str, installed: str, candidate: str) -> None:
    """Require that the update replaces exactly the installed Ohtia package and nothing else."""
    actions = [
        line
        for line in simulation.splitlines()
        if line.split(" ", 1)[0] in {"Inst", "Remv", "Conf", "Purg"}
    ]
    delivery.require(
        len(actions) == 2
        and actions[0].startswith(f"Inst ohtia [{installed}] ({candidate} ")
        and actions[1].startswith(f"Conf ohtia ({candidate} "),
        "The package manager plans another change than updating Ohtia: " + json.dumps(actions),
    )


def update(a_version: str, b_version: str) -> dict:
    """Update through the registered entry: apt reads the signed index and replaces A with B."""
    run(["sudo", "mkdir", "-p", APT_STATE / "sources", APT_STATE / "lists/partial"])
    run(["sudo", "mkdir", "-p", APT_STATE / "archives/partial"])
    run(["sudo", "ln", "-s", SOURCE_ENTRY, APT_STATE / "sources/ohtia.sources"])
    run(apt("update"), capture=False)
    simulation = run(
        apt("--simulate", "--no-install-recommends", "install", "--only-upgrade", "ohtia")
    ).stdout
    update_plan(simulation, native_version(a_version), native_version(b_version))
    run(
        apt("--yes", "--no-install-recommends", "install", "--only-upgrade", "ohtia"),
        capture=False,
    )
    archives = sorted((APT_STATE / "archives").glob("ohtia_*.deb"))
    delivery.require(len(archives) == 1, "apt kept no single downloaded Ohtia package.")
    return {
        "file": archives[0].name,
        "sha256": delivery.digest(archives[0]),
        "bytes": archives[0].stat().st_size,
    }


def dnf(*args: str) -> list[str]:
    return [
        "sudo",
        "dnf",
        "--assumeyes",
        f"--setopt=reposdir={DNF_STATE / 'repos'}",
        f"--setopt=cachedir={DNF_STATE / 'cache'}",
        "--setopt=keepcache=True",
        *args,
    ]


def installed_packages() -> set[str]:
    listed = run(["rpm", "-qa", "--qf", "%{NAME}\t%{EPOCHNUM}:%{VERSION}-%{RELEASE}\t%{ARCH}\n"])
    return set(listed.stdout.splitlines())


def update_with_dnf(profile: str, a_version: str, b_version: str, expected: dict) -> dict:
    """Update through the registered entry: dnf checks the signed metadata and the RPM signature.

    The download is compared with the release before anything is installed, and the update must
    change nothing but the Ohtia package.
    """
    run(["sudo", "mkdir", "-p", DNF_STATE / "repos"])
    run(["sudo", "ln", "-s", FEDORA_ENTRY, DNF_STATE / "repos/ohtia.repo"])
    # Importing a key adds a gpg-pubkey entry to the package list. Import the committed key,
    # which the repository file names, before the baseline, so dnf has none left to import.
    run(["sudo", "rpm", "--import", ROOT / "config/release/signing-key.asc"])
    before = installed_packages()
    run(dnf("upgrade", "--downloadonly", "ohtia"), capture=False)
    cached = sorted((DNF_STATE / "cache").glob("*/packages/ohtia-*.rpm"))
    delivery.require(len(cached) == 1, "dnf kept no single downloaded Ohtia package.")
    downloaded = {
        "file": cached[0].name,
        "sha256": delivery.digest(cached[0]),
        "bytes": cached[0].stat().st_size,
    }
    delivery.require(
        downloaded["sha256"] == expected["sha256"] and downloaded["bytes"] == expected["bytes"],
        "dnf downloaded other bytes than the unpublished release holds.",
    )
    run(dnf("upgrade", "ohtia"), capture=False)
    after = installed_packages()
    architecture = "x86_64"
    delivery.require(
        before - after == {f"ohtia\t0:{native_version(a_version, profile)}\t{architecture}"}
        and after - before == {f"ohtia\t0:{native_version(b_version, profile)}\t{architecture}"},
        "The package manager changed another package than Ohtia: "
        + json.dumps({"removed": sorted(before - after), "added": sorted(after - before)}),
    )
    return downloaded


def download_from_test(cell: dict, expected: dict, work: Path) -> Path:
    """Download B's file from the cell's `test` repository and compare it with the release."""
    distribution = linux_profiles.distribution(cell["profile"])
    directory = (
        f"fedora/{linux_profiles.version(cell['profile'])}"
        if distribution == "fedora"
        else distribution
    )
    url = f"{quality_native.REPOSITORY_URL}/test/{directory}/{expected['name']}"
    target = work / expected["name"]
    work.mkdir(parents=True)
    run(
        ["curl", "--fail", "--silent", "--show-error", "--proto", "=https", "--output", target, url]
    )
    delivery.require(
        delivery.digest(target) == expected["sha256"]
        and target.stat().st_size == expected["bytes"],
        "The test repository holds other bytes than the unpublished release.",
    )
    return target


def unreleased(version: str) -> dict:
    """Show that no version tag or reservation names the qualification version A."""
    repository = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}.git"
    names = [f"refs/tags/v{version}", f"refs/tags/reserved/v{version}"]
    listed = run(["git", "ls-remote", "--tags", repository, *names]).stdout.strip()
    delivery.require(not listed, "A tag names the qualification version.")
    return {"repository": repository, "absent_tags": names}


def write_prepared(cell: dict, work: Path) -> None:
    """Describe the installed bytes for the admitted launch, outside the package's own files."""
    record = work / "prepared.json"
    delivery.write(record, quality_native.prepared_record(PAYLOAD, cell))
    run(["sudo", "install", "-m", "0644", record, PAYLOAD / "prepared.json"])


def observe(profile: Path, cell: dict, report: Path, name: str, previous: Path | None) -> dict:
    """Start the installed application twice, as the installation journey does, and keep it."""
    scratch = Path(delivery.read(profile)["scratch_root"])
    evidence = scratch / f"installed-{name}"
    try:
        receipt, _ = installation_native.observe_installed(
            profile, PAYLOAD, evidence, cell, previous
        )
    finally:
        if evidence.exists():
            shutil.copytree(evidence, report / f"installed-{name}")
    return receipt


class Report:
    """Write the report after every step, so a failure keeps the steps that ran."""

    def __init__(self, output: Path, record: dict):
        self.output, self.record = output, record
        self.save()

    def save(self) -> None:
        delivery.write(self.output / "result.json", self.record)

    @contextlib.contextmanager
    def step(self, name: str):
        entry = {"id": name, "result": "failed"}
        self.record["steps"].append(entry)
        observed: dict = {}
        try:
            yield observed
        except BaseException as error:
            entry["error"] = str(error)
            raise
        else:
            entry["result"] = "passed"
        finally:
            entry["observed"] = observed
            self.save()


def start_report(cell: dict, output: Path, env: dict, scenario: str) -> tuple[dict, dict, Report]:
    release = release_inputs(env)
    check_source(release["commit"], release["version"])
    expected = expected_package(release["digests"], cell)
    host = quality_native.host_matches(cell)
    delivery.require(not output.exists(), "Use a fresh qualification report destination.")
    output.mkdir(parents=True)
    report = Report(
        output,
        {
            "version": 1,
            "status": "failed",
            "scenario": scenario,
            "cell": cell,
            "host": {**host, "runner_name": env.get("RUNNER_NAME")},
            "release": {
                "version": release["version"],
                "commit": release["commit"],
                "package": expected,
            },
            "steps": [],
        },
    )
    return release, expected, report


def require_fresh_host(cell: dict, observed: dict) -> None:
    delivery.require(installed_version(cell["profile"]) is None, "Ohtia is already installed.")
    for installed in quality_native.repository_files(cell["profile"], "stable"):
        delivery.require(not os.path.lexists(installed), f"{installed} already exists.")
    observed["installed"] = None


def prepare_profile(context: Path) -> Path:
    quality_native.command(
        [workspace.node_path(), "tooling/quality-profile.mjs", "prepare", context]
    )
    return Path(delivery.read(context)["profile"])


def retain_profile(context: Path, observed: dict) -> None:
    # Retaining the fixture verifies the stable roots' sentinels before moving the store.
    quality_native.command(
        [workspace.node_path(), "tooling/quality-profile.mjs", "retain", context]
    )
    observed["stable_preserved"] = True


def qualify(cell: dict, output: Path, env: dict) -> None:
    """Run the complete scenario: install A from its file, update to B, keep the saved value."""
    release, expected, report = start_report(cell, output, env, "complete")
    version, profile_id = release["version"], cell["profile"]
    run_id, attempt = int(env["GITHUB_RUN_ID"]), int(env["GITHUB_RUN_ATTEMPT"])
    a_version = application_version.development_version(run_id, attempt)
    report.record["qualification_version"] = a_version
    work = ROOT / "artifacts" / f"repository-{cell['id']}"
    delivery.require(not work.exists(), "Use a fresh qualification work directory.")
    try:
        with report.step("fresh-host") as observed:
            require_fresh_host(cell, observed)
        with report.step("build-a") as observed:
            packages = quality_native.construct_package(cell, work, a_version, "test")
            found = sorted(packages.glob(f"*.{package_format(cell)}"))
            delivery.require(len(found) == 1, "Expected exactly one qualification package.")
            package_a = found[0]
            observed.update(
                {
                    "file": package_a.name,
                    "sha256": delivery.digest(package_a),
                    "bytes": package_a.stat().st_size,
                }
            )
        with report.step("install-a") as observed:
            install_file(profile_id, package_a, signed=False)
            observed["installed_version"] = installed_version(profile_id)
            delivery.require(
                observed["installed_version"] == native_version(a_version, profile_id),
                "The package file did not install version A.",
            )
        with report.step("repository-a") as observed:
            observed.update(quality_native.verify_repository_registered(cell, "test"))
        with report.step("policy-a") as observed:
            observed.update(policy_state(profile_id))
        context = work / "context.json"
        with report.step("save-value-a") as observed:
            profile = prepare_profile(context)
            write_prepared(cell, work)
            receipt_a = observe(profile, cell, output, "a", None)
            delivery.require(
                receipt_a["running_versions"] == [a_version, a_version],
                "The installed application does not report version A.",
            )
            observed.update(
                {"saved": receipt_a["saved"], "running_versions": receipt_a["running_versions"]}
            )
            run(["sudo", "rm", PAYLOAD / "prepared.json"])
        with report.step("update-to-b") as observed:
            if linux_profiles.is_fedora(profile_id):
                observed["downloaded"] = update_with_dnf(profile_id, a_version, version, expected)
            else:
                observed["downloaded"] = update(a_version, version)
            observed["installed_version"] = installed_version(profile_id)
            delivery.require(
                observed["installed_version"] == native_version(version, profile_id),
                "The package manager did not install version B.",
            )
            delivery.require(
                observed["downloaded"]["sha256"] == expected["sha256"]
                and observed["downloaded"]["bytes"] == expected["bytes"],
                "The package manager installed other bytes than the unpublished release holds.",
            )
            verify_installed_files(profile_id)
        with report.step("repository-b") as observed:
            # A release package registers the stable zone, so the update replaces the test entry.
            observed.update(quality_native.verify_repository_registered(cell, "stable"))
        with report.step("policy-b") as observed:
            observed.update(policy_state(profile_id))
        with report.step("value-after-update") as observed:
            write_prepared(cell, work)
            receipt_b = observe(
                profile, cell, output, "b", output / "installed-a/installation-receipt.json"
            )
            delivery.require(
                receipt_b["cases"][0]["id"] == "existing-store-preserves-appearance"
                and receipt_b["cases"][0]["observed"] == receipt_a["saved"],
                "The update did not keep the saved value.",
            )
            delivery.require(
                receipt_b["running_versions"] == [version, version],
                "The updated application does not report version B.",
            )
            observed.update(
                {
                    "kept": receipt_b["cases"][0]["observed"],
                    "running_versions": receipt_b["running_versions"],
                }
            )
        with report.step("stable-sentinels") as observed:
            retain_profile(context, observed)
        with report.step("a-unreleased") as observed:
            observed.update(unreleased(a_version))
        report.record["status"] = "passed"
        report.save()
    finally:
        # Version A is discarded: its package leaves the runner with no copy in the report.
        shutil.rmtree(work / "packages", ignore_errors=True)


def qualify_short(cell: dict, output: Path, env: dict) -> None:
    """Run the short scenario: install B's file from the test zone and start the application."""
    release, expected, report = start_report(cell, output, env, "short")
    version, profile_id = release["version"], cell["profile"]
    work = ROOT / "artifacts" / f"repository-{cell['id']}"
    delivery.require(not work.exists(), "Use a fresh qualification work directory.")
    with report.step("fresh-host") as observed:
        require_fresh_host(cell, observed)
    with report.step("download-b") as observed:
        package_b = download_from_test(cell, expected, work / "download")
        observed.update({"file": package_b.name, "sha256": expected["sha256"]})
    with report.step("install-b") as observed:
        install_file(profile_id, package_b, signed=True)
        observed["installed_version"] = installed_version(profile_id)
        delivery.require(
            observed["installed_version"] == native_version(version, profile_id),
            "The package file did not install version B.",
        )
        verify_installed_files(profile_id)
    with report.step("repository-b") as observed:
        observed.update(quality_native.verify_repository_registered(cell, "stable"))
    with report.step("policy-b") as observed:
        observed.update(policy_state(profile_id))
    context = work / "context.json"
    with report.step("start-b") as observed:
        profile = prepare_profile(context)
        write_prepared(cell, work)
        receipt = observe(profile, cell, output, "b", None)
        delivery.require(
            receipt["running_versions"] == [version, version],
            "The installed application does not report version B.",
        )
        observed["running_versions"] = receipt["running_versions"]
    with report.step("stable-sentinels") as observed:
        retain_profile(context, observed)
    report.record["status"] = "passed"
    report.save()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cell")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        cell = declared_cell(args.cell)
        scenario = qualify if cell["desktop"] == "gnome" else qualify_short
        scenario(cell, args.output.absolute(), dict(os.environ))
    except Exception as error:
        # Every failure, including an unexpected record shape, names its cause after this prefix.
        print(f"Repository qualification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
