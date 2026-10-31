"""Prepare only the root-authorized disposable guest; never accept arbitrary device paths."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import time
from pathlib import Path

GUARD = Path("/run/ohtia-qualification.json")
FAILURE = Path("/var/lib/ohtia-qualification-failed.json")
BOOTSTRAP_CODES = frozenset(
    {
        "native_guest_root_required",
        "guest_guard_identity",
        "privileged_guest_account",
        "guest_volume_serial",
        "unsafe_home_volume",
        "root_volume_refused",
        "guest_home_identity",
        "selinux_not_enforcing",
        "apparmor_not_enforcing",
        "guest_profile",
        "guest_expiry_not_armed",
        "guest_transfer_identity",
        "guest_transfer_digest",
        "ordinary_extractor_required",
        "guest_harness_entry",
        "guest_installer_root_required",
        "guest_bootstrap_operation",
        "guest_required_command",
    }
)
PROGRAMS = frozenset(
    {
        "id",
        "lsblk",
        "findmnt",
        "getenforce",
        "mkfs.btrfs",
        "mkfs.ext4",
        "mount",
        "restorecon",
        "loginctl",
        "systemctl",
        "runuser",
        "rpm",
        "dpkg",
        "python3",
    }
)


def run(*args):
    return subprocess.run(
        list(args), check=True, capture_output=True, text=True, timeout=120
    ).stdout.strip()


def prepare() -> None:
    import pwd

    if os.getuid() != 0 or platform.machine() != "aarch64":
        raise ValueError("native_guest_root_required")
    info = GUARD.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or info.st_mode & 0o022
        or info.st_size > 65536
    ):
        raise ValueError("guest_guard_identity")
    guard = json.loads(GUARD.read_bytes())
    profile, volumes = guard["intent"]["profile"], guard["resources"]
    account = pwd.getpwnam("ohtia-quality")
    if account.pw_uid == 0 or run("id", "-nG", "ohtia-quality").split() != ["ohtia-quality"]:
        raise ValueError("privileged_guest_account")
    # Scaleway SBS serials bind the guest device to the API volume UUID; no /dev/vdb assumption.
    devices = json.loads(
        run("lsblk", "--json", "--bytes", "--output", "PATH,SERIAL,SIZE,TYPE,FSTYPE,MOUNTPOINTS")
    )["blockdevices"]
    candidates = [row for row in devices if row.get("serial") == "volume-" + volumes["home"]]
    roots = [row for row in devices if row.get("serial") == "volume-" + volumes["root"]]
    if len(candidates) != 1 or len(roots) != 1:
        raise ValueError("guest_volume_serial")
    disk, root = candidates[0], roots[0]
    if (
        disk["path"] == root["path"]
        or disk["type"] != "disk"
        or disk["size"] != guard["home_bytes"]
        or disk.get("children")
        or disk.get("fstype")
        or any(disk.get("mountpoints") or [])
    ):
        raise ValueError("unsafe_home_volume")
    if run("findmnt", "-n", "-o", "SOURCE", "/") == disk["path"]:
        raise ValueError("root_volume_refused")
    home = Path(account.pw_dir)
    if home != Path("/home/ohtia-quality") or home.is_symlink():
        raise ValueError("guest_home_identity")
    if profile == "fedora-44":
        if run("getenforce") != "Enforcing":
            raise ValueError("selinux_not_enforcing")
        run("mkfs.btrfs", disk["path"])
    elif profile == "debian-13":
        if Path("/sys/module/apparmor/parameters/enabled").read_text().strip() != "Y":
            raise ValueError("apparmor_not_enforcing")
        run("mkfs.ext4", disk["path"])
    else:
        raise ValueError("guest_profile")
    run("mount", disk["path"], str(home))
    os.chown(home, account.pw_uid, account.pw_gid)
    home.chmod(0o700)
    if profile == "fedora-44":
        run("restorecon", "-RF", str(home))
    run("loginctl", "enable-linger", "ohtia-quality")
    commands = (
        "gnome-shell",
        "gdbus",
        "dbus-update-activation-environment",
        "systemd-run",
        "sudo",
        "ss",
    )
    if not all(shutil.which(command) for command in commands):
        raise ValueError("guest_required_command")
    # Make completion contingent on an already armed shutdown timer and an ordinary locked account.
    if run("systemctl", "is-active", "ohtia-lease-expiry.timer") != "active":
        raise ValueError("guest_expiry_not_armed")
    guard["ready_at_epoch"] = int(time.time())
    temporary = GUARD.with_suffix(".ready")
    with temporary.open("x") as stream:
        json.dump(guard, stream, sort_keys=True)
    temporary.chmod(0o644)
    os.replace(temporary, GUARD)
    Path("/var/lib/ohtia-qualification-ready").touch(exist_ok=False)


def artifact(file: Path, record: dict) -> None:
    info = file.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or info.st_size != record["bytes"]
        or file.is_symlink()
    ):
        raise ValueError("guest_transfer_identity")
    with file.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != record["sha256"]:
            raise ValueError("guest_transfer_digest")


def extract() -> None:
    import pwd

    if os.getuid() == 0 or pwd.getpwuid(os.getuid()).pw_name != "ohtia-quality":
        raise ValueError("ordinary_extractor_required")
    guard = json.loads(GUARD.read_bytes())
    source = Path("/home/ohtia-quality/source")
    source.mkdir(mode=0o700)
    archive = (
        Path("/var/lib/ohtia-qualification/incoming") / guard["intent"]["build"]["harness"]["file"]
    )
    count, total = 0, 0
    with tarfile.open(archive, "r|gz") as stream:
        for member in stream:
            count += 1
            total += member.size
            path = Path(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or count > guard["maximum_harness_files"]
                or member.size < 0
                or total > guard["maximum_harness_expanded_bytes"]
                or not (member.isfile() or member.isdir() or member.issym())
            ):
                raise ValueError("guest_harness_entry")
            stream.extract(member, source, filter="data")


def install() -> None:
    if os.getuid() != 0:
        raise ValueError("guest_installer_root_required")
    guard = json.loads(GUARD.read_bytes())
    incoming = Path("/var/lib/ohtia-qualification/incoming")
    build = guard["intent"]["build"]
    for record in (build["package"], build["harness"]):
        artifact(incoming / record["file"], record)
    run(
        "runuser",
        "-u",
        "ohtia-quality",
        "--",
        "/usr/bin/python3",
        "/usr/local/lib/ohtia-qualification/bootstrap.py",
        "extract",
    )
    package = str(incoming / build["package"]["file"])
    if guard["intent"]["profile"] == "fedora-44":
        run("rpm", "--install", package)
    else:
        run("dpkg", "--install", package)
    source = Path("/home/ohtia-quality/source")
    env = {"PATH": "/usr/bin:/usr/sbin:/bin:/sbin", "HOME": "/root", "LANG": "C.UTF-8"}
    subprocess.run(
        [
            str(source / ".tooling/python/bin/python3"),
            str(source / "scripts/scaleway_guest.py"),
            "seal",
        ],
        env=env,
        cwd=source,
        check=True,
        timeout=120,
    )
    Path("/var/lib/ohtia-qualification-installed").touch(exist_ok=False)


def status() -> dict:
    result = {
        "version": 1,
        "ready": Path("/var/lib/ohtia-qualification-ready").is_file(),
        "failed": False,
        "code": None,
        "program": None,
        "exit_code": None,
        "cloud_init_error_count": 0,
    }
    if FAILURE.is_file() and not FAILURE.is_symlink() and FAILURE.stat().st_size <= 4096:
        value = json.loads(FAILURE.read_bytes())
        result.update(
            {
                "failed": True,
                "code": value["code"]
                if value.get("code")
                in BOOTSTRAP_CODES
                | {"bootstrap_command_failed", "bootstrap_io_failed", "bootstrap_failed"}
                else "bootstrap_failed",
                "program": value.get("program") if value.get("program") in PROGRAMS else None,
                "exit_code": value.get("exit_code")
                if type(value.get("exit_code")) is int
                else None,
            }
        )
    for file in (Path("/var/lib/cloud/data/status.json"), Path("/var/lib/cloud/data/result.json")):
        if file.is_file() and file.stat().st_size <= 65536:
            try:
                value = json.loads(file.read_bytes()).get("v1", {})
                errors = len(value.get("errors", []))
                for stage in ("init", "init-local", "modules-config", "modules-final"):
                    errors += len(value.get(stage, {}).get("errors", []))
                result["cloud_init_error_count"] += errors
            except (ValueError, TypeError, AttributeError):
                pass
    if result["cloud_init_error_count"]:
        result["failed"] = True
        result["code"] = result["code"] or "cloud_init_failed"
    return result


def diagnostics() -> dict:
    """Read only selected unit states; never return raw service or cloud-init output."""
    value = status()
    states = {
        "active",
        "reloading",
        "inactive",
        "failed",
        "activating",
        "deactivating",
        "maintenance",
        "refreshing",
    }
    value["units"] = {}
    for unit in (
        "cloud-init.service",
        "cloud-init-network.service",
        "cloud-config.service",
        "cloud-final.service",
    ):
        state = "unavailable"
        try:
            result = subprocess.run(
                [
                    "/usr/bin/systemctl",
                    "show",
                    unit,
                    "--property=LoadState",
                    "--property=ActiveState",
                ],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
                env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
            )
            fields = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
            observed = fields.get("ActiveState")
            if (
                result.returncode == 0
                and fields.get("LoadState") == "loaded"
                and observed in states
            ):
                state = observed
        except (OSError, subprocess.SubprocessError):
            pass
        value["units"][unit] = state
    return value


def failure(error: BaseException, operation: str) -> dict:
    code = (
        str(error)
        if isinstance(error, ValueError) and str(error) in BOOTSTRAP_CODES
        else "bootstrap_failed"
    )
    program, exit_code = None, None
    if isinstance(error, subprocess.CalledProcessError):
        code = "bootstrap_command_failed"
        if isinstance(error.cmd, (tuple, list)) and error.cmd:
            first = Path(str(error.cmd[0])).name
            program = first if first in PROGRAMS else None
        exit_code = error.returncode
    elif isinstance(error, OSError):
        code = "bootstrap_io_failed"
    return {
        "version": 1,
        "operation": operation,
        "code": code,
        "program": program,
        "exit_code": exit_code,
    }


def main():
    operation = sys.argv[1] if len(sys.argv) == 2 else "prepare"
    try:
        if operation == "prepare":
            prepare()
        elif operation == "extract":
            extract()
        elif operation == "install":
            install()
        elif operation == "status":
            print(json.dumps(status(), sort_keys=True))
        elif operation == "diagnostics":
            print(json.dumps(diagnostics(), sort_keys=True))
        else:
            raise ValueError("guest_bootstrap_operation")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        report = failure(error, operation)
        if operation in {"prepare", "extract", "install"} and os.getuid() == 0:
            try:
                with FAILURE.open("w") as stream:
                    json.dump(report, stream, sort_keys=True)
                FAILURE.chmod(0o644)
            except OSError:
                pass
        print("Disposable guest operation failed (" + report["code"] + ").", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
