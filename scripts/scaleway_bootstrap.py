"""Prepare only the root-authorized disposable guest; never accept arbitrary device paths."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import platform
import re
import selectors
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

GUARD = Path("/run/ohtia-qualification.json")
FAILURE = Path("/var/lib/ohtia-qualification-failed.json")
INVENTORY = Path("/var/lib/ohtia-qualification/native-os-packages.txt")
INVENTORY_CODES = frozenset(
    {
        "package_inventory_failed",
        "package_inventory_timeout",
        "package_inventory_oversized",
        "package_inventory_invalid",
        "package_inventory_identity",
        "package_inventory_root_required",
    }
)
# Fixed absolute programs and formats; each line is name, [epoch:]version and architecture.
INVENTORY_COMMANDS = {
    "rpm": (
        "/usr/bin/rpm",
        "--query",
        "--all",
        "--queryformat",
        "%{NAME}\t%|EPOCH?{%{EPOCH}:}:{}|%{VERSION}-%{RELEASE}\t%{ARCH}\n",
    ),
    "dpkg": (
        "/usr/bin/dpkg-query",
        "--show",
        "--showformat=${db:Status-Status}\t${Package}\t${Version}\t${Architecture}\n",
    ),
}
INVENTORY_FIELDS = (
    re.compile(r"[A-Za-z0-9][A-Za-z0-9+._-]*"),
    re.compile(r"[A-Za-z0-9.+~^:_-]+"),
    re.compile(r"[A-Za-z0-9_]+|\(none\)"),
)
# dpkg keeps removed packages' configuration files; intermediate states remain invalid.
DPKG_ABSENT = frozenset({"not-installed", "config-files"})
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


CLOUD_STAGES = ("init-local", "init", "modules-config", "modules-final")
CLOUD_MODULES = frozenset(
    "ansible apk_configure apt_configure apt_pipelining bootcmd byobu ca_certs chef "
    "disable_ec2_metadata disk_setup fan final_message growpart grub_dpkg install_hotplug "
    "keyboard keys_to_console landscape locale lxd mcollective mounts ntp "
    "package_update_upgrade_install phone_home power_state_change puppet reset_rmc resizefs "
    "resolv_conf rh_subscription rsyslog runcmd salt_minion scripts_per_boot scripts_per_instance "
    "scripts_per_once scripts_user scripts_vendor seed_random set_hostname set_passwords snap "
    "spacewalk ssh ssh_authkey_fingerprints ssh_import_id timezone ubuntu_autoinstall "
    "ubuntu_drivers ubuntu_pro update_etc_hosts update_hostname users_groups wireguard "
    "write_files write_files_deferred yum_add_repo zypper_add_repo".split()
)
CLOUD_EXCEPTIONS = frozenset(
    {
        "ProcessExecutionError",
        "PackageInstallerError",
        "RuntimeError",
        "ValueError",
        "TypeError",
        "KeyError",
        "OSError",
        "IOError",
        "FileNotFoundError",
        "PermissionError",
        "NotImplementedError",
        "ImportError",
    }
)
CLOUD_PROGRAMS = frozenset(
    {
        "apt-get",
        "apt",
        "dpkg",
        "dnf",
        "yum",
        "rpm",
        "sh",
        "bash",
        "python3",
        "systemctl",
        "run-parts",
        "runcmd",
        "ssh-keygen",
        "mount",
        "growpart",
        "resize2fs",
    }
)
CLOUD_ERRORS = frozenset(
    {"command-failed", "package-install-failed", "runparts-failed", "exception", "unclassified"}
)
CLOUD_SOURCE_STATES = frozenset({"observed", "unavailable", "invalid", "oversized"})
CLOUD_ERROR_LIMIT = 8
CLOUD_DATA = Path("/var/lib/cloud/data")


def cloud_source(path: Path, *, validate_errors: bool = True) -> tuple[str, dict]:
    """Read fixed cloud-init JSON, including its normal symlinks, with a hard byte bound."""
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                return "unavailable", {}
            data = stream.read(65537)
        if len(data) > 65536:
            return "oversized", {}
        value = json.loads(data)
        value = value.get("v1") if isinstance(value, dict) else None
        if not isinstance(value, dict):
            return "invalid", {}
        if not validate_errors:
            return "observed", value
        for part in (value, *(value.get(stage, {}) for stage in CLOUD_STAGES)):
            if not isinstance(part, dict) or not isinstance(part.get("errors", []), list):
                return "invalid", {}
            if not all(isinstance(error, str) for error in part.get("errors", [])):
                return "invalid", {}
        return "observed", value
    except OSError as error:
        if not validate_errors and not isinstance(error, FileNotFoundError):
            raise
        return "unavailable", {}
    except RecursionError:
        if not validate_errors:
            raise
        return "invalid", {}
    except ValueError:
        return "invalid", {}


def cloud_error(text: str, stage: str | None) -> dict:
    """Recognize module exception metadata without evaluating syntax or exporting free text."""
    result = dict(
        stage=stage, module=None, exception=None, error="unclassified", program=None, exit_code=None
    )
    if len(text) > 8192:
        return result
    try:
        node = ast.parse(text, mode="eval").body
        if isinstance(node, ast.Tuple) and len(node.elts) == 2:
            module, node = node.elts
            if isinstance(module, ast.Constant) and isinstance(module.value, str):
                name = module.value.replace("-", "_")
                result["module"] = name if name in CLOUD_MODULES else None
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            return result
        name = node.func.id
        if name not in CLOUD_EXCEPTIONS:
            return result
        result.update(
            exception=name,
            error="package-install-failed" if name == "PackageInstallerError" else "exception",
        )
        if len(node.args) != 1 or node.keywords or not isinstance(node.args[0], ast.Constant):
            return result
        message = node.args[0].value
        if not isinstance(message, str):
            return result
        if name == "RuntimeError" and re.fullmatch(
            r"Runparts: [0-9]+ failures \([^\n]*\) in [0-9]+ attempted commands", message
        ):
            result["error"] = "runparts-failed"
        if name != "ProcessExecutionError":
            return result
        result["error"] = "command-failed"
        header = re.match(
            r"(?:Unexpected error while running command\.|Exec format error\. Missing #! in script\?)"
            r"\nCommand: ([^\n]{1,2048})\nExit code: (-?[0-9]{1,3}|-)\nReason: ",
            message,
        )
        if header:
            if header[2] != "-" and -255 <= int(header[2]) <= 255:
                result["exit_code"] = int(header[2])
            command = ast.literal_eval(header[1])
            if isinstance(command, list) and command and isinstance(command[0], str):
                program = Path(command[0]).name
                result["program"] = program if program in CLOUD_PROGRAMS else None
    except (ValueError, SyntaxError, TypeError, RecursionError, MemoryError):
        pass
    return result


def cloud_diagnostics() -> dict:
    """Keep stage-bound observations, collapsing the result file's copies of stage errors."""
    result = {"sources": {}, "errors": [], "truncated": False}
    seen = set()
    status_errors = set()
    for source in ("status", "result"):
        state, value = cloud_source(CLOUD_DATA / (source + ".json"))
        result["sources"][source] = state
        parts = [(stage, value.get(stage, {})) for stage in CLOUD_STAGES]
        parts.append((None, value))
        for stage, part in parts:
            for text in part.get("errors", []):
                if source == "result" and text in status_errors or (stage, text) in seen:
                    continue
                seen.add((stage, text))
                if source == "status":
                    status_errors.add(text)
                if len(result["errors"]) >= CLOUD_ERROR_LIMIT:
                    result["truncated"] = True
                    continue
                result["errors"].append(cloud_error(text, stage))
                result["truncated"] |= len(text) > 8192
    return result


def run(*args):
    return subprocess.run(
        list(args), check=True, capture_output=True, text=True, timeout=120
    ).stdout.strip()


def bounded_output(arguments: tuple[str, ...], maximum: int, seconds: int) -> bytes:
    """Read at most the bounded stdout of a fixed program before its deadline, or refuse."""
    data = bytearray()
    deadline = time.monotonic() + seconds
    try:
        with subprocess.Popen(
            list(arguments),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        ) as child:
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(child.stdout, selectors.EVENT_READ)
                    while True:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0 or not selector.select(remaining):
                            raise ValueError("package_inventory_timeout")
                        block = os.read(child.stdout.fileno(), min(65536, maximum + 1 - len(data)))
                        if not block:
                            break
                        data.extend(block)
                        if len(data) > maximum:
                            raise ValueError("package_inventory_oversized")
                status = child.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise ValueError("package_inventory_timeout") from None
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
    except OSError:
        raise ValueError("package_inventory_failed") from None
    if status:
        raise ValueError("package_inventory_failed")
    return bytes(data)


def inventory_rows(data: bytes, *, dpkg_states: bool = False) -> list[str]:
    """Admit complete fixed-field rows only; a partial or unexpected row refuses the whole list."""
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        raise ValueError("package_inventory_invalid") from None
    if not text.endswith("\n"):
        raise ValueError("package_inventory_invalid")
    rows = []
    for line in text[:-1].split("\n"):
        fields = line.split("\t")
        if dpkg_states:
            if len(fields) != 4:
                raise ValueError("package_inventory_invalid")
            state, *fields = fields
            if state in DPKG_ABSENT:
                # Omitted rows must be equally well formed; an absent package may lack
                # a version and an architecture.
                name, *details = fields
                if not INVENTORY_FIELDS[0].fullmatch(name) or not all(
                    not field or pattern.fullmatch(field)
                    for pattern, field in zip(INVENTORY_FIELDS[1:], details)
                ):
                    raise ValueError("package_inventory_invalid")
                continue
            if state != "installed":
                raise ValueError("package_inventory_invalid")
        if len(fields) != 3 or not all(
            pattern.fullmatch(field) for pattern, field in zip(INVENTORY_FIELDS, fields)
        ):
            raise ValueError("package_inventory_invalid")
        rows.append("\t".join(fields))
    if not rows or len(set(rows)) != len(rows):
        raise ValueError("package_inventory_invalid")
    return sorted(rows)


def package_inventory(manager: str, maximum: int, seconds: int) -> bytes:
    """Return the sorted installed-package list shared by native CI and disposable guests."""
    if manager not in INVENTORY_COMMANDS:
        raise ValueError("package_inventory_failed")
    rows = inventory_rows(
        bounded_output(INVENTORY_COMMANDS[manager], maximum, seconds),
        dpkg_states=manager == "dpkg",
    )
    data = ("\n".join(rows) + "\n").encode("ascii")
    if len(data) > maximum:
        raise ValueError("package_inventory_oversized")
    return data


def inventory_count(data: bytes, maximum: int) -> int:
    """Validate a retained list as produced: bounded, canonical, sorted and duplicate-free."""
    if len(data) > maximum:
        raise ValueError("package_inventory_oversized")
    rows = inventory_rows(data)
    if ("\n".join(rows) + "\n").encode("ascii") != data:
        raise ValueError("package_inventory_invalid")
    return len(rows)


def read_inventory(maximum: int) -> bytes:
    info = INVENTORY.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or info.st_mode & 0o022
        or info.st_size > maximum
    ):
        raise ValueError("package_inventory_identity")
    with INVENTORY.open("rb") as stream:
        return stream.read(maximum + 1)


def packages() -> dict:
    """Record the guest's package list once; later calls report the retained first observation."""
    if os.getuid() != 0:
        raise ValueError("package_inventory_root_required")
    guard = json.loads(GUARD.read_bytes())
    manager = {"fedora-44": "rpm", "debian-13": "dpkg"}.get(guard["intent"]["profile"])
    maximum, seconds = guard["package_inventory_bytes"], guard["package_inventory_seconds"]
    if type(maximum) is not int or type(seconds) is not int or maximum <= 0 or seconds <= 0:
        raise ValueError("package_inventory_failed")
    folder = INVENTORY.parent
    folder.mkdir(mode=0o755, exist_ok=True)
    info = folder.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("package_inventory_identity")
    if os.path.lexists(INVENTORY):
        data = read_inventory(maximum)
    else:
        data = package_inventory(manager, maximum, seconds)
        descriptor, name = tempfile.mkstemp(prefix=".native-os-packages-", dir=folder)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(name, 0o644)
            # A hard link publishes the complete list without replacing an earlier one.
            os.link(name, INVENTORY)
        finally:
            os.unlink(name)
    count = inventory_count(data, maximum)
    return {
        "version": 1,
        "status": "observed",
        "machine": platform.machine(),
        "packages": count,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def packages_report() -> dict:
    try:
        return packages()
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, ValueError) else ""
        return {
            "version": 1,
            "status": "failed",
            "code": code if code in INVENTORY_CODES else "package_inventory_failed",
        }


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
    commands = required_commands(guard["intent"]["build"]["cell"].get("desktop"))
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


def required_commands(desktop: str | None) -> tuple[str, ...]:
    """Name the session commands each desktop's guest must provide before readiness."""
    if desktop == "kde":
        # Plasma runs through the shared launcher on its own private bus.
        return (
            "kwin_wayland",
            "plasmashell",
            "dbus-run-session",
            "dbus-send",
            "dbus-update-activation-environment",
            "sudo",
            "ss",
        )
    if desktop == "gnome":
        return (
            "gnome-shell",
            "gdbus",
            "dbus-update-activation-environment",
            "systemd-run",
            "sudo",
            "ss",
        )
    raise ValueError("guest_desktop")


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


def status(*, diagnostic: bool = False) -> dict:
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
    for source in ("status", "result"):
        try:
            _, value = cloud_source(CLOUD_DATA / (source + ".json"), validate_errors=False)
            # Preserve polling refusal even for malformed nonempty error collections.
            errors = len(value.get("errors", []))
            for stage in CLOUD_STAGES:
                errors += len(value.get(stage, {}).get("errors", []))
            result["cloud_init_error_count"] += errors
        except (OSError, RecursionError) as error:
            if not diagnostic:
                raise
            result["failed"] = True
            result["code"] = result["code"] or (
                "bootstrap_io_failed" if isinstance(error, OSError) else "bootstrap_failed"
            )
        except (ValueError, TypeError, AttributeError):
            pass
    if result["cloud_init_error_count"]:
        result["failed"] = True
        result["code"] = result["code"] or "cloud_init_failed"
    return result


def diagnostics() -> dict:
    """Return bounded, allowlisted cloud-init metadata and selected unit states."""
    value = status(diagnostic=True)
    value["cloud_init"] = cloud_diagnostics()
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
        elif operation == "packages":
            print(json.dumps(packages_report(), sort_keys=True))
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
