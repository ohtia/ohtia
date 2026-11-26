"""Qualify repository delivery on a maintainer-created disposable ARM64 guest (SPEC-001-041).

The Debian and Fedora ARM64 cells run on guests that the maintainer creates for one prepare-release
run, from the base image of the cell's distribution, with root SSH access through one key. This
tool prepares a guest as the CI prepares its KVM guests and runs the repository qualification task
there through the same guest entry point, `tooling/quality-packaging/guest-run.py`:

    python3 scripts/repository_guest.py provision <cell> <address> <key>
    python3 scripts/repository_guest.py run <cell> <address> <key> <digests> <output>

`run` qualifies the clean checkout of the release commit. It reads the prepare-release run's
identity and the release version from the environment, as the qualification job does, and the
release's `release-digests.json` from a file. Each guest serves exactly one cell and is deleted
after its report is copied.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

import application_version
import linux_profiles
import quality_delivery as delivery
import quality_vm
import repository_qualification as qualification

ROOT = delivery.ROOT
GUEST_HOME = "/home/ohtia"
REPORTS = "artifacts/repository-qualification"
# The ARM guests of scaleway_qualification.py add these to the KVM guest set; Node needs libatomic.
ARM_PACKAGES = {
    "fedora": ["libatomic", "mesa-libgbm", "xdg-utils"],
    "debian": ["libatomic1", "e2fsprogs"],
}
ADDRESS = re.compile(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}")


def guest_cell(cell_id: str) -> dict:
    """Return a declared guest cell; hosted and KVM cells run in the prepare-release jobs."""
    cell = qualification.declared_cell(cell_id)
    delivery.require(cell["launcher"] == "guest", "Only the ARM64 guest cells run on this tool.")
    return cell


def provision_script(cell: dict, public_key: str) -> str:
    """Render the CI guest provisioning of the cell as one root shell script."""
    delivery.require(
        re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+( [!-~]+)?", public_key) is not None,
        "Use one Ed25519 public key.",
    )
    profile, desktop = cell["profile"], cell["desktop"]
    fedora = linux_profiles.is_fedora(profile)
    config = json.loads(
        quality_vm.cloud_config(profile, public_key, desktop=desktop).split("\n", 1)[1]
    )
    lines = [
        "set -eux",
        "export DEBIAN_FRONTEND=noninteractive",
        # A guest serves one cell from its base image: refuse an earlier Ohtia or account.
        "test ! -e /opt/ohtia",
        "if id ohtia >/dev/null 2>&1; then echo 'The guest already has an ohtia account.' >&2; exit 1; fi",
    ]
    if "apt" in config:
        conf = shlex.quote(config["apt"]["conf"])
        lines.append(f"printf %s {conf} > /etc/apt/apt.conf.d/90ohtia-retries")
    # cloud-init installs the KVM guest's list with the package manager's defaults, so the guest
    # receives the same packages, recommended ones included on Debian.
    install = "dnf -y install" if fedora else "apt-get install -y"
    lines.append("dnf -y makecache" if fedora else "apt-get update")
    packages = config.get("packages", []) + ARM_PACKAGES[linux_profiles.distribution(profile)]
    lines.append(f"{install} " + " ".join(shlex.quote(name) for name in packages))
    account = [
        # The account of the KVM guests: locked password, administrative authority for the harness.
        f"useradd -m -d {GUEST_HOME} -s /bin/bash ohtia",
        "passwd -l ohtia",
        "printf 'ohtia ALL=(ALL) NOPASSWD:ALL\\n' > /etc/sudoers.d/ohtia",
        "chmod 0440 /etc/sudoers.d/ohtia",
        f"install -d -m 0700 -o ohtia -g ohtia {GUEST_HOME}/.ssh",
        f"printf '%s\\n' {shlex.quote(public_key)} > {GUEST_HOME}/.ssh/authorized_keys",
        f"chown ohtia:ohtia {GUEST_HOME}/.ssh/authorized_keys",
        f"chmod 0600 {GUEST_HOME}/.ssh/authorized_keys",
        *([f"restorecon -RF {GUEST_HOME}"] if fedora else []),
    ]
    if desktop == "kde" and fedora:
        # The ARM instance has no GPU; scaleway_qualification.py gives KWin vgem's render node.
        lines.append("modprobe vgem")
    for command in config["runcmd"]:
        text = command if isinstance(command, str) else shlex.join(command)
        # A KVM guest mounts a separate home disk; this guest's home is on its root filesystem.
        if "/sys/block/vdb/serial" in text:
            continue
        # The account comes after every package transaction, including the KDE set of the
        # later commands, so a failed transfer can be repeated on this guest.
        if text == "loginctl enable-linger ohtia":
            lines += account
            account = []
        lines.append(text)
    delivery.require(not account, "The guest provisioning names no account step.")
    return "\n".join(lines) + "\n"


def environment(cell: dict, commit: str, digests: dict, env: dict) -> dict:
    """Return the guest environment that quality_vm.py writes for repository qualification."""
    version = env["OHTIA_RELEASE_VERSION"]
    delivery.require(
        application_version.FINAL.fullmatch(version) is not None
        and digests.get("version") == version
        and digests.get("source", {}).get("commit") == commit,
        "The digest file does not describe this release commit and version.",
    )
    run_id, attempt = env["GITHUB_RUN_ID"], env["GITHUB_RUN_ATTEMPT"]
    delivery.require(
        run_id.isdecimal() and attempt.isdecimal() and int(run_id) > 0 and int(attempt) > 0,
        "Name the prepare-release run and attempt of the release.",
    )
    return {
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_RUN_ID": run_id,
        "GITHUB_RUN_ATTEMPT": attempt,
        "GITHUB_SHA": commit,
        "GITHUB_EVENT_PATH": f"{GUEST_HOME}/event.json",
        # The guest is fresh and disposable, which the KVM guests' admission requires.
        "GITHUB_ACTIONS": "true",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_NAME": "maintainer-guest",
        "OHTIA_QUALITY_VM": cell["id"],
        "XDG_SESSION_TYPE": "wayland",
        "XDG_CURRENT_DESKTOP": "GNOME",
        "OHTIA_RELEASE_VERSION": version,
        "OHTIA_RELEASE_COMMIT": commit,
        "OHTIA_RELEASE_DIGESTS": json.dumps(digests),
        "OHTIA_SOURCE_COMMIT": commit,
        "OHTIA_GUEST_TASK": "quality:repository",
    }


def ssh_options(key: Path, known_hosts: Path) -> list[str]:
    return [
        "-i",
        str(key),
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        f"UserKnownHostsFile={known_hosts}",
        "-o",
        "ConnectTimeout=15",
    ]


def run(args: list, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def known_hosts(cell: dict) -> Path:
    """Both operations on a cell's guest admit the host key it first presented."""
    directory = ROOT / "artifacts/guests" / cell["id"]
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "known_hosts"


def provision(cell: dict, address: str, key: Path, known_hosts: Path) -> None:
    public_key = Path(f"{key}.pub").read_text(encoding="utf-8").strip()
    script = provision_script(cell, public_key)
    run(
        ["ssh", *ssh_options(key, known_hosts), f"root@{address}", "bash -s"],
        input=script,
        text=True,
        timeout=3600,
    )


def qualify(cell: dict, address: str, key: Path, digests_file: Path, output: Path) -> int:
    commit = delivery.git("rev-parse", "HEAD")
    delivery.require(
        not delivery.git("status", "--porcelain", "--untracked-files=no"),
        "Run from the clean checkout of the release commit.",
    )
    digests = json.loads(digests_file.read_text(encoding="utf-8"))
    values = environment(cell, commit, digests, dict(os.environ))
    delivery.require(not output.exists(), "Use a fresh report destination.")
    output.mkdir(parents=True)
    options = ssh_options(key, known_hosts(cell))
    guest = f"ohtia@{address}"
    with tempfile.TemporaryDirectory(prefix="ohtia-guest-") as directory:
        staged = Path(directory)
        run(["git", "bundle", "create", staged / "source.bundle", "HEAD"], cwd=ROOT)
        delivery.write(staged / "environment.json", values)
        delivery.write(staged / "event.json", {})
        run(
            [
                "scp",
                *options,
                staged / "source.bundle",
                staged / "environment.json",
                staged / "event.json",
                ROOT / "tooling/quality-packaging/guest-run.py",
                f"{guest}:{GUEST_HOME}/",
            ],
            timeout=600,
        )
    try:
        exit_code = subprocess.run(
            ["ssh", *options, guest, f"python3 {GUEST_HOME}/guest-run.py"],
            check=False,
            timeout=5400,
        ).returncode
    except subprocess.TimeoutExpired:
        # The guest keeps what it wrote; its report is still copied below.
        exit_code = None
    # Retain whatever report the guest wrote before interpreting its exit; an early failure
    # leaves none, which guest.json records.
    try:
        copied = (
            subprocess.run(
                ["scp", "-r", *options, f"{guest}:{GUEST_HOME}/source/{REPORTS}/*", output],
                check=False,
                timeout=600,
            ).returncode
            == 0
        )
    except subprocess.TimeoutExpired:
        copied = False
    delivery.write(
        output / "guest.json",
        {
            "version": 1,
            "cell": cell,
            "address": address,
            "commit": commit,
            "run_id": values["GITHUB_RUN_ID"],
            "run_attempt": values["GITHUB_RUN_ATTEMPT"],
            "guest_exit": exit_code,
            "timed_out": exit_code is None,
            "report_copied": copied,
        },
    )
    return 1 if exit_code is None or not copied else exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    operations = parser.add_subparsers(dest="operation", required=True)
    for name in ("provision", "run"):
        command = operations.add_parser(name)
        command.add_argument("cell")
        command.add_argument("address")
        command.add_argument("key", type=Path)
        if name == "run":
            command.add_argument("digests", type=Path)
            command.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        cell = guest_cell(args.cell)
        delivery.require(ADDRESS.fullmatch(args.address) is not None, "Use the guest's IPv4.")
        key = args.key.expanduser().absolute()
        if args.operation == "provision":
            provision(cell, args.address, key, known_hosts(cell))
            return 0
        code = qualify(cell, args.address, key, args.digests, args.output.absolute())
        if code:
            print(f"Repository qualification failed on {cell['id']}.", file=sys.stderr)
        return 1 if code else 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"Guest qualification failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
