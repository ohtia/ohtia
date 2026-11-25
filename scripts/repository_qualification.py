"""Qualify repository delivery of a prepared version on one native Linux cell (SPEC-001-041).

The prepare-release workflow runs this entry point from the selected source, without secrets,
after the Linux packages of the prepared version B are in the `test` repositories. It builds
version A from the same commit with a lower development version, registered against the `test`
zone, installs A from its package file, saves a value, updates to B through the package manager
and checks the value, the running version and the sandbox state. A is never released and its
package is discarded; the retained report records each step, the digests and the host identity.
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
import quality_delivery as delivery
import quality_native
import workspace

ROOT = delivery.ROOT

# The cells whose complete scenario this harness runs; each is a declared hosted display cell.
CELLS = ("linux-x64-ubuntu-26-04-gnome",)
PAYLOAD = Path("/opt/ohtia")
SOURCE_ENTRY = Path("/etc/apt/sources.list.d/ohtia.sources")
POLICY = Path("/etc/apparmor.d/ohtia")
# The update reads only the Ohtia entry the package installed, so it neither depends on nor
# changes the runner's distribution indexes, and keeps the archive it downloads for its digest.
APT_STATE = Path("/var/cache/apt/ohtia-qualification")
SHA256 = re.compile(r"[0-9a-f]{64}")


def declared_cell(cell_id: str) -> dict:
    delivery.require(cell_id in CELLS, "Repository qualification covers only its declared cells.")
    cells = delivery.read(ROOT / "config/quality/build-targets.json")["cells"]
    cell = next(item for item in cells if item["id"] == cell_id)
    delivery.require(
        cell["launcher"] == "display-session" and cell["formats"] == ["deb"],
        "Repository qualification needs a hosted display cell with one DEB package.",
    )
    return cell


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


def expected_package(digests: dict, cell: dict) -> dict:
    """Return the release's single DEB of the cell, which apt authenticates by its index."""
    found = [
        asset
        for asset in digests.get("assets", [])
        if asset.get("target") == cell["target"]
        and asset.get("profile") == cell["profile"]
        and asset.get("format") == "deb"
    ]
    delivery.require(len(found) == 1, "The release must hold exactly one DEB of the cell.")
    asset = found[0]
    delivery.require(
        isinstance(asset.get("name"), str)
        and SHA256.fullmatch(str(asset.get("sha256"))) is not None
        and isinstance(asset.get("bytes"), int)
        and asset["bytes"] > 0
        and asset.get("authentication") == "repository",
        "The release records an invalid DEB of the cell.",
    )
    return {key: asset[key] for key in ("name", "sha256", "bytes")}


def native_version(version: str) -> str:
    """Return the DEB version the package construction gives an application version."""
    return version.replace("-", "~", 1) + "-1"


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


def installed_version() -> str | None:
    result = run(["dpkg-query", "-W", "-f=${Status}\t${Version}", "ohtia"], check=False)
    if result.returncode != 0:
        return None
    status, _, version = result.stdout.partition("\t")
    return version if status == "install ok installed" else None


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


def qualify(cell: dict, output: Path, env: dict) -> None:
    release = release_inputs(env)
    version, commit = release["version"], release["commit"]
    check_source(commit, version)
    expected = expected_package(release["digests"], cell)
    run_id, attempt = int(env["GITHUB_RUN_ID"]), int(env["GITHUB_RUN_ATTEMPT"])
    a_version = application_version.development_version(run_id, attempt)
    host = quality_native.host_matches(cell)
    delivery.require(not output.exists(), "Use a fresh qualification report destination.")
    output.mkdir(parents=True)
    report = Report(
        output,
        {
            "version": 1,
            "status": "failed",
            "cell": cell,
            "host": {**host, "runner_name": env.get("RUNNER_NAME")},
            "release": {"version": version, "commit": commit, "package": expected},
            "qualification_version": a_version,
            "steps": [],
        },
    )
    work = ROOT / "artifacts" / f"repository-{cell['id']}"
    delivery.require(not work.exists(), "Use a fresh qualification work directory.")
    try:
        with report.step("fresh-host") as observed:
            delivery.require(installed_version() is None, "Ohtia is already installed.")
            for installed in quality_native.repository_files(cell["profile"], "stable"):
                delivery.require(not os.path.lexists(installed), f"{installed} already exists.")
            observed["installed"] = None
        with report.step("build-a") as observed:
            packages = quality_native.construct_package(cell, work, a_version, "test")
            found = sorted(packages.glob("*.deb"))
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
            run(["sudo", "dpkg", "--install", package_a], capture=False)
            observed["installed_version"] = installed_version()
            delivery.require(
                observed["installed_version"] == native_version(a_version),
                "The package file did not install version A.",
            )
        with report.step("repository-a") as observed:
            observed.update(quality_native.verify_repository_registered(cell, "test"))
        with report.step("sandbox-a") as observed:
            observed.update(sandbox_state())
        context = work / "context.json"
        with report.step("save-value-a") as observed:
            quality_native.command(
                [workspace.node_path(), "tooling/quality-profile.mjs", "prepare", context]
            )
            profile = Path(delivery.read(context)["profile"])
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
            observed["downloaded"] = update(a_version, version)
            observed["installed_version"] = installed_version()
            delivery.require(
                observed["installed_version"] == native_version(version),
                "The package manager did not install version B.",
            )
            delivery.require(
                observed["downloaded"]["sha256"] == expected["sha256"]
                and observed["downloaded"]["bytes"] == expected["bytes"],
                "apt installed other bytes than the unpublished release holds.",
            )
            # dpkg compares every installed file with the digest the package recorded.
            verified = run(["dpkg", "--verify", "ohtia"], check=False)
            delivery.require(
                verified.returncode == 0 and not verified.stdout.strip(),
                "Installed files differ from B: " + verified.stdout + verified.stderr,
            )
        with report.step("repository-b") as observed:
            # A release package registers the stable zone, so the update replaces the test entry.
            observed.update(quality_native.verify_repository_registered(cell, "stable"))
        with report.step("sandbox-b") as observed:
            observed.update(sandbox_state())
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
            # Retaining the fixture verifies the stable roots' sentinels before moving the store.
            quality_native.command(
                [workspace.node_path(), "tooling/quality-profile.mjs", "retain", context]
            )
            observed["stable_preserved"] = True
        with report.step("a-unreleased") as observed:
            observed.update(unreleased(a_version))
        report.record["status"] = "passed"
        report.save()
    finally:
        # Version A is discarded: its package leaves the runner with no copy in the report.
        shutil.rmtree(work / "packages", ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cell")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        qualify(declared_cell(args.cell), args.output.absolute(), dict(os.environ))
    except Exception as error:
        # Every failure, including an unexpected record shape, names its cause after this prefix.
        print(f"Repository qualification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
