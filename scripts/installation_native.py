"""Manually qualify internal Linux/macOS packages; no publication or platform identity claim."""

from __future__ import annotations

import argparse
import concurrent.futures
import ctypes
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath

import desktop_runtime
import quality_native
import workspace

ROOT = Path(__file__).resolve().parent.parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def tool_environment():
    if sys.platform == "linux" and os.getuid() == 0:
        return {
            "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": "/root",
            "LANG": "C",
            "LC_ALL": "C",
        }
    return quality_native.build_environment()


def command(arguments, *, capture=False, timeout=900):
    result = subprocess.run(
        [str(value) for value in arguments],
        cwd=ROOT,
        env=tool_environment(),
        capture_output=capture,
        text=True,
        check=True,
        timeout=timeout,
    )
    return result.stdout.strip() if capture else ""


def digest(file):
    with file.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def read_bounded_json(file, maximum=65536, uid=None):
    require(file.is_absolute() and file.resolve() == file, "Aliased JSON input.")
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        require(
            stat.S_ISREG(info.st_mode)
            and info.st_nlink == 1
            and info.st_size <= maximum
            and (uid is None or info.st_uid == uid),
            "Unsafe or oversized JSON input.",
        )
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        require(len(data) <= maximum, "JSON input grew beyond its bound.")
        return json.loads(data)
    finally:
        os.close(descriptor)


def observe_file(file, uid=None, destination=None):
    require(file.resolve() == file, "Aliased file observation.")
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    output = None
    try:
        info = os.fstat(descriptor)
        require(
            stat.S_ISREG(info.st_mode)
            and info.st_nlink == 1
            and (uid is None or info.st_uid == uid),
            "Unsafe observed file.",
        )
        if destination is not None:
            output = destination.open("xb")
        checksum = hashlib.sha256()
        remaining = info.st_size
        while remaining:
            data = os.read(descriptor, min(remaining, 1024 * 1024))
            require(data, "Observed file was truncated.")
            remaining -= len(data)
            checksum.update(data)
            if output is not None:
                output.write(data)
        require(not os.read(descriptor, 1), "Observed file grew during inspection.")
        if output is not None:
            output.flush()
            os.fsync(output.fileno())
        return {"sha256": checksum.hexdigest(), "bytes": info.st_size}
    finally:
        if output is not None:
            output.close()
        os.close(descriptor)


def store_snapshot(profile):
    """Bind a verified, quiescent store and every SQLite journal to its exact current bytes."""
    result = {}
    root = Path(profile["research_root"])
    for name in ("ohtia.db3", "ohtia.db3-wal", "ohtia.db3-shm", "ohtia.db3-journal"):
        file = root / name
        if not file.exists() and not file.is_symlink():
            result[name] = None
            continue
        result[name] = observe_file(file, uid=Path(profile["home"]).stat().st_uid)
    return result


def native_profile(target, profile, backend):
    require(os.getuid() != 0, "Run qualification in an independent ordinary native account.")
    require(workspace.target_id() == target, "Native target mismatch.")
    require(
        target in {"linux-x64", "linux-arm64", "darwin-arm64"},
        "Target outside this internal qualification.",
    )
    manifest = json.loads((ROOT / "config/desktop/targets.json").read_text())
    row = next(item for item in manifest["targets"] if item["id"] == target)
    if sys.platform == "linux":
        release = platform.freedesktop_os_release()
        require(f"{release['ID']}-{release['VERSION_ID']}" == profile, "Wrong distribution.")
        declared = next(item for item in row["distribution_profiles"] if item["id"] == profile)
        filesystem = command(["findmnt", "-n", "-o", "FSTYPE", "-T", Path.home()], capture=True)
        require(
            filesystem in declared["filesystems"] and backend in declared["display_backends"],
            "Unqualified filesystem or display.",
        )
        if profile == "fedora-44":
            require(
                release.get("VARIANT_ID") == "workstation"
                and command(["getenforce"], capture=True) == "Enforcing",
                "Fedora Workstation and enforcing SELinux required.",
            )
        else:
            require(
                Path("/sys/module/apparmor/parameters/enabled").read_text().strip() == "Y",
                "Enabled AppArmor required.",
            )
        require(
            bool(os.environ.get("WAYLAND_DISPLAY"))
            if backend == "wayland"
            else bool(os.environ.get("DISPLAY")) and not os.environ.get("WAYLAND_DISPLAY"),
            "Native session unavailable.",
        )
        formats = [declared["package"]]
    else:
        release = command(["/usr/bin/sw_vers", "-productVersion"], capture=True)
        require(
            profile == f"macos-{release.split('.')[0]}"
            and int(release.split(".")[0]) in row["required_os_majors"],
            "Wrong native macOS family.",
        )
        translated = subprocess.run(
            ["/usr/sbin/sysctl", "-in", "sysctl.proc_translated"],
            capture_output=True,
            text=True,
            check=False,
        )
        require(
            translated.returncode in {0, 1} and translated.stdout.strip() in {"", "0"},
            "Rosetta is not admitted.",
        )
        filesystem = quality_native.macos_filesystem(Path.home())
        require(
            filesystem.lower() == "apfs" and backend == "windowserver",
            "Native APFS/WindowServer required.",
        )
        command(["/bin/launchctl", "print", f"gui/{os.getuid()}"], capture=True)
        formats = ["dmg", "zip"]
    return {
        "target": target,
        "profile": profile,
        "backend": backend,
        "filesystem": filesystem,
        "formats": formats,
    }


def verify_staged(record):
    """Recheck exact staged bytes immediately before any native package operation."""
    file = Path(record["file"])
    info = file.lstat()
    require(
        file.resolve() == file
        and file.is_file()
        and not file.is_symlink()
        and info.st_nlink == 1
        and info.st_uid == os.getuid(),
        "Unsafe staged file.",
    )
    require(
        info.st_size == record["bytes"] == record["entry"]["bytes"]
        and digest(file) == record["sha256"] == record["entry"]["sha256"],
        "Staged package changed.",
    )
    return file


class PayloadInventory(dict):
    """Application bytes plus the migration contract extracted from that same archive."""

    def set_contract(self, data):
        require(len(data) <= 65536, "Packaged migration manifest exceeds its bound.")
        manifest = json.loads(data)
        require(
            isinstance(manifest, list)
            and manifest
            and all(set(item) == {"name", "sha256"} for item in manifest),
            "Invalid packaged migration manifest.",
        )
        self.target_schema = len(manifest)
        self.migration_manifest_sha256 = hashlib.sha256(data).hexdigest()


def tree_inventory(directory):
    result = {}
    for parent, directories, names in os.walk(directory, followlinks=False):
        for name in directories + names:
            file = Path(parent) / name
            relative = file.relative_to(directory).as_posix()
            if relative == "prepared.json":
                continue
            info = file.lstat()
            require(file.resolve().is_relative_to(directory), "Installed link escapes its payload.")
            if stat.S_ISLNK(info.st_mode):
                result[relative] = {"link": os.readlink(file)}
            elif stat.S_ISREG(info.st_mode):
                require(info.st_nlink == 1, "Installed payload has aliased files.")
                result[relative] = {"sha256": digest(file), "mode": stat.S_IMODE(info.st_mode)}
            else:
                require(stat.S_ISDIR(info.st_mode), "Special installed payload entry.")
    return result


def package_inventory(file, cell):
    """Derive expected application bytes from the authenticated archive, never its installed inventory."""
    prefix = PurePosixPath("opt/ohtia-quality")
    result = PayloadInventory()
    if file.suffix in {".deb", ".rpm"}:
        # rpm2archive streams PAX without extracting files; hash actual bytes rather than legacy RPM MD5 tags.
        conversion = (
            ["dpkg-deb", "--fsys-tarfile", str(file)]
            if file.suffix == ".deb"
            else ["rpm2archive", "--nocompression", "--format=pax", str(file)]
        )
        child = subprocess.Popen(
            conversion,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=tool_environment(),
        )
        try:
            with tarfile.open(fileobj=child.stdout, mode="r|") as archive:
                for member in archive:
                    name = PurePosixPath(member.name.lstrip("/"))
                    if not name.is_relative_to(prefix):
                        continue
                    relative = name.relative_to(prefix).as_posix()
                    require(
                        ".." not in name.parts and relative not in result,
                        "Unsafe or duplicate package payload path.",
                    )
                    if member.isdir():
                        continue
                    if member.issym():
                        result[relative] = {"link": member.linkname}
                    else:
                        require(member.isfile(), "Unsupported package hardlink or special file.")
                        source = archive.extractfile(member)
                        require(source is not None, "Missing package payload bytes.")
                        with source:
                            if relative == "resources/app/migrations/manifest.json":
                                data = source.read(65537)
                                result.set_contract(data)
                                checksum = hashlib.sha256(data).hexdigest()
                            else:
                                checksum = hashlib.file_digest(source, "sha256").hexdigest()
                        result[relative] = {"sha256": checksum, "mode": member.mode & 0o7777}
            require(child.wait(timeout=30) == 0, "Native archive conversion failed.")
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            if child.stdout:
                child.stdout.close()
            if child.stderr:
                child.stderr.close()
    else:
        require(
            sys.platform == "darwin" and file.suffix in {".zip", ".dmg"},
            "Unsupported package inventory.",
        )
        with tempfile.TemporaryDirectory(prefix="ohtia-payload-") as temporary:
            unpacked = quality_native.unpack_package(
                file, file.suffix[1:], Path(temporary).resolve() / "payload"
            )
            result = PayloadInventory(tree_inventory(unpacked))
            app = next(unpacked.glob("*.app"))
            result.set_contract(
                (app / "Contents/Resources/app/migrations/manifest.json").read_bytes()
            )
    require(
        result and hasattr(result, "target_schema"),
        "Empty authenticated package payload or missing migration contract.",
    )
    return result


def verify_installed_payload(file, cell, payload, evidence=None, contract=None):
    expected = package_inventory(file, cell)
    if contract is not None:
        require(
            expected.target_schema == contract["entry"]["schema"]["target"]
            and expected.migration_manifest_sha256 == contract["migration_manifest_sha256"],
            "Authenticated package differs from its selected migration contract.",
        )
    actual = tree_inventory(payload)
    if evidence is not None:
        evidence.write_text(
            json.dumps(
                {"package_sha256": digest(file), "expected": expected, "observed": actual}, indent=2
            )
            + "\n"
        )
    require(actual == expected, "Installed bytes do not match the authenticated package payload.")
    return hashlib.sha256(
        json.dumps(expected, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def process_identity(pid):
    require(type(pid) is int and pid > 0, "Invalid lease process identifier.")
    if sys.platform == "linux":
        directory = Path("/proc") / str(pid)
        fields = (directory / "stat").read_text().rsplit(") ", 1)[1].split()
        return {
            "platform": "linux",
            "pid": pid,
            "uid": directory.stat().st_uid,
            "start_ticks": fields[19],
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
        }
    require(sys.platform == "darwin", "Native Linux or macOS lease required.")

    # proc_bsdinfo ABI: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
    class BsdInfo(ctypes.Structure):
        _fields_ = [
            ("identity", ctypes.c_uint32 * 12),
            ("command", ctypes.c_char * 16),
            ("name", ctypes.c_char * 32),
            ("details", ctypes.c_uint32 * 6),
            ("start_seconds", ctypes.c_uint64),
            ("start_microseconds", ctypes.c_uint64),
        ]

    library = ctypes.CDLL("/usr/lib/libproc.dylib")
    library.proc_pidinfo.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint64,
        ctypes.c_void_p,
        ctypes.c_int,
    ]
    library.proc_pidinfo.restype = ctypes.c_int
    info = BsdInfo()
    require(
        library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        == ctypes.sizeof(info)
        and info.identity[3] == pid,
        "Lease process identity unavailable.",
    )
    return {
        "platform": "darwin",
        "pid": pid,
        "uid": info.identity[5],
        "start_seconds": info.start_seconds,
        "start_microseconds": info.start_microseconds,
    }


def lease_status(file):
    lease = read_bounded_json(file)
    require(isinstance(lease.get("owner"), dict), "A retained native birth identity is required.")
    pid = lease["pid"]
    require(
        type(pid) is int
        and pid > 0
        and lease["owner"].get("pid") == pid
        and lease["owner"].get("uid") == os.getuid(),
        "Invalid native lease owner.",
    )
    try:
        observed = process_identity(pid)
    except (OSError, ValueError):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return {"status": "ceased", "lease": lease}
        raise ValueError(
            "The old process identity cannot be inspected; preserve the lock."
        ) from None
    return {"status": "live" if observed == lease["owner"] else "ceased", "lease": lease}


def reconcile_state(directory, evidence):
    """Reclaim only a proven ceased lease; an OS lock survives in the metadata child until it exits."""
    import fcntl

    require(
        directory.resolve() == directory
        and directory.is_dir()
        and directory.stat().st_uid == os.getuid()
        and stat.S_IMODE(directory.stat().st_mode) & 0o077 == 0,
        "Use the private native acceptance directory.",
    )
    guard = os.open(
        directory / "reconciliation.guard", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
    )
    try:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(guard)
        require(
            stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
            "Unsafe native reconciliation guard.",
        )
        lock = directory / "operation.lock"
        status = lease_status(lock)
        require(status["status"] == "ceased", "The recorded operation owner is still alive.")
        checksum = digest(lock)
        result = subprocess.run(
            [
                str(workspace.node_path()),
                str(ROOT / "tooling/installation-reconcile.mjs"),
                str(directory),
                str(evidence),
                checksum,
            ],
            cwd=ROOT,
            env=tool_environment(),
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
            pass_fds=(guard,),
        )
        require(
            digest(lock) == checksum and lease_status(lock)["status"] == "ceased",
            "The retained operation lease changed during reconciliation.",
        )
        destination = directory / (
            "operation-reconciled-" + __import__("uuid").uuid4().hex + ".json"
        )
        lock.rename(destination)
        folder = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
        return json.loads(result.stdout)
    finally:
        os.close(guard)


def check_installation_admission(record, profile):
    """A live orchestrator retains the replay lock through the privileged transition and observation."""
    require(
        isinstance(profile, dict) and isinstance(record.get("admission"), dict),
        "Active installation admission required.",
    )
    admission = record["admission"]
    directory = Path(profile["scratch_root"]) / "update-acceptance"
    lock = directory / "operation.lock"
    state_file = directory / "accepted.json"
    uid = Path(profile["home"]).stat().st_uid
    lease = read_bounded_json(lock, uid=uid)
    state = read_bounded_json(state_file, uid=uid)
    require(
        lease == admission["lease"]
        and state == admission["state"]
        and state["highest_version"] == record["version"]
        and state["catalog_sha256"] == admission["catalog_sha256"],
        "Installation admission is stale or belongs to another operation.",
    )
    require(
        type(lease.get("pid")) is int and lease["pid"] > 0 and isinstance(lease.get("nonce"), str),
        "Invalid installation lease.",
    )
    require(
        process_identity(lease["pid"]) == lease.get("owner")
        and lease["owner"]["uid"] == Path(profile["home"]).stat().st_uid,
        "Lease process ceased, changed identity or belongs to another native account.",
    )
    require(
        state["last_accepted_ms"] <= int(time.time() * 1000) < admission["expires_ms"],
        "Clock uncertainty or catalog expiry before activation.",
    )


def assert_quiescent(payload):
    require(
        not installed_processes(payload, []), "Stop the installed application before replacement."
    )


def package_identity(file, cell, version):
    arch = cell["target"].split("-")[1]
    if file.suffix == ".deb":
        output = command(
            ["dpkg-deb", "--field", file, "Package", "Version", "Architecture"], capture=True
        )
        values = dict(line.split(": ", 1) for line in output.splitlines())
        require(
            values
            == {
                "Package": "ohtia-quality",
                "Version": version.replace("-", "~", 1) + "-1",
                "Architecture": {"x64": "amd64", "arm64": "arm64"}[arch],
            },
            "Wrong DEB metadata.",
        )
    elif file.suffix == ".rpm":
        output = command(
            ["rpm", "-qp", "--qf", "%{NAME}\n%{EPOCHNUM}\n%{VERSION}-%{RELEASE}\n%{ARCH}", file],
            capture=True,
        )
        require(
            output.splitlines()
            == [
                "ohtia-quality",
                "0",
                version.replace("-", "~", 1) + "-1",
                {"x64": "x86_64", "arm64": "aarch64"}[arch],
            ],
            "Wrong RPM metadata.",
        )


def install_staged(
    record,
    cell,
    destination,
    *,
    rpm_keyring=None,
    rpm_key_id=None,
    profile=None,
    administrator=False,
    before_transition=None,
    repair=False,
):
    check_installation_admission(record, profile)
    file = verify_staged(record)
    package_identity(file, cell, record["version"])
    expected = package_inventory(file, cell)
    require(
        expected.target_schema == record["entry"]["schema"]["target"]
        and expected.migration_manifest_sha256 == record["migration_manifest_sha256"],
        "Catalog schema differs from its authenticated package.",
    )
    if file.suffix in {".deb", ".rpm"}:
        require(
            administrator and os.getuid() == 0,
            "Linux installation requires the explicitly authorized external operator.",
        )
        assert_quiescent(Path("/opt/ohtia-quality"))
    if file.suffix == ".deb":
        require(
            record["entry"]["native_version"] == record["version"].replace("-", "~", 1) + "-1",
            "Native DEB version differs from the selected artifact.",
        )
        current = subprocess.run(
            ["dpkg-query", "-W", "-f=${Version}", "ohtia-quality"],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        require(current.returncode in {0, 1}, "Native installed version unavailable.")
        if current.returncode == 0:
            older = subprocess.run(
                [
                    "dpkg",
                    "--compare-versions",
                    record["entry"]["native_version"],
                    "lt",
                    current.stdout.strip(),
                ],
                check=False,
                timeout=30,
            )
            require(older.returncode == 1, "Native package downgrade refused.")
        plan = command(
            [
                "apt-get",
                "--simulate",
                "--no-download",
                "--no-install-recommends",
                "--no-remove",
                "install",
                file,
            ],
            capture=True,
        )
        for line in plan.splitlines():
            if line.startswith(("Inst ", "Conf ", "Remv ")):
                require(
                    not line.startswith("Remv ")
                    and line.split()[1].split(":")[0] == "ohtia-quality",
                    "Missing dependency or unrelated package transition; leave the installation unchanged.",
                )
        command(["dpkg", "--refuse-downgrade", "--simulate", "--install", file])
        check_installation_admission(record, profile)
        if before_transition is not None:
            before_transition()
        command(["dpkg", "--refuse-downgrade", "--install", file])
        return Path("/opt/ohtia-quality")
    if file.suffix == ".rpm":
        require(
            rpm_keyring is not None
            and isinstance(rpm_key_id, str)
            and len(rpm_key_id) in {40, 64}
            and all(character in "0123456789abcdef" for character in rpm_key_id),
            "Explicit expected-key RPM database and fingerprint required.",
        )
        require(
            rpm_keyring.resolve() == rpm_keyring
            and rpm_keyring.is_dir()
            and rpm_keyring.stat().st_uid == 0
            and stat.S_IMODE(rpm_keyring.stat().st_mode) & 0o022 == 0,
            "Expected-key database must be canonical and administrator controlled.",
        )
        keys = command(["rpmkeys", "--dbpath", rpm_keyring, "--list"], capture=True)
        require(
            len(keys.splitlines()) == 1 and keys.split()[0].lower() == rpm_key_id,
            "RPM trust database differs from the independently selected key.",
        )
        output = command(["rpmkeys", "--dbpath", rpm_keyring, "--checksig", file], capture=True)
        require(
            output.endswith("digests signatures OK")
            and "NOKEY" not in output
            and "NOT OK" not in output,
            "RPM signature not verified against the expected key.",
        )
        installed = subprocess.run(
            ["rpm", "-q", "--qf", "%{EPOCHNUM}\n%{VERSION}-%{RELEASE}\n", "ohtia-quality"],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        require(installed.returncode in {0, 1}, "Native RPM installed version unavailable.")
        expected_version = record["version"].replace("-", "~", 1) + "-1"
        require(
            record["entry"]["native_version"] == expected_version,
            "Native RPM version differs from its selected artifact.",
        )
        current_version = None
        if installed.returncode == 0:
            fields = installed.stdout.splitlines()
            require(len(fields) == 2 and fields[0] == "0", "Unsupported installed RPM epoch.")
            current_version = fields[1]
            for version in (expected_version, current_version):
                require(
                    len(version) <= 128
                    and re.fullmatch(
                        r"[0-9]+(?:\.[0-9]+){2}(?:~(?:dev|beta)\.[0-9]+(?:\.[0-9]+)?)?-1", version
                    ),
                    "Unsupported native quality RPM version.",
                )
            ordering = command(
                [
                    "rpm",
                    "--eval",
                    f'%{{lua: print(rpm.vercmp("{expected_version}","{current_version}"))}}',
                ],
                capture=True,
            )
            require(ordering in {"0", "1"}, "Native RPM downgrade refused.")
        operation = "--reinstall" if repair and current_version == expected_version else "--upgrade"
        command(["rpm", operation, "--test", file])
        check_installation_admission(record, profile)
        if before_transition is not None:
            before_transition()
        command(["rpm", operation, file])
        return Path("/opt/ohtia-quality")
    require(
        sys.platform == "darwin" and file.suffix in {".zip", ".dmg"},
        "Unsupported internal installer.",
    )
    previous = record["admission"].get("installed_directory")
    if previous is not None:
        prior = Path(previous)
        require(
            prior.resolve() == prior and prior.is_relative_to(Path(profile["scratch_root"])),
            "Invalid prior macOS installation.",
        )
        assert_quiescent(prior)
    require(not destination.exists(), "Preserve previous installation; use a new destination.")
    candidate = destination.with_name(destination.name + ".partial")
    require(not candidate.exists(), "Retain interrupted activation and reconcile it explicitly.")
    # DMG mounting is read-only; ZIP extraction and framework-link checks precede activation.
    payload = quality_native.unpack_package(file, file.suffix[1:], candidate)
    apps = list(payload.glob("*.app"))
    require(len(apps) == 1, "Exactly one application required.")
    app = apps[0]
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    require(
        info.get("CFBundleIdentifier") == "org.ohtia.quality"
        and info.get("CFBundleShortVersionString") == record["version"],
        "Wrong application identity.",
    )
    prepared = quality_native.prepared_record(payload, cell)
    require(
        desktop_runtime.architecture(payload / prepared["executable"])
        == cell["target"].split("-")[1],
        "Wrong application CPU.",
    )
    command(["/usr/bin/codesign", "--verify", "--deep", "--strict", app])
    signature = subprocess.run(
        ["/usr/bin/codesign", "--display", "--verbose=4", str(app)],
        env=tool_environment(),
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    require(
        "Signature=adhoc" in signature.stderr.splitlines(),
        "Internal macOS fixtures require an ad-hoc signature.",
    )
    check_installation_admission(record, profile)
    payload.rename(destination)
    return destination


def installed_processes(payload, known, ready_only=False):
    rows = quality_native.processes(payload, known, ready_only=ready_only)
    if sys.platform != "darwin":
        return rows
    # Match OS executable paths, not observer command arguments containing the installation path.
    output = command(["/bin/ps", "-axo", "pid=,comm="], capture=True)
    actual = set()
    for line in output.splitlines():
        parts = line.strip().split(None, 1)
        if (
            len(parts) == 2
            and Path(parts[1]).is_absolute()
            and Path(parts[1]).is_relative_to(payload)
        ):
            actual.add(int(parts[0]))
    return [row for row in rows if row["pid"] in actual]


def prepare_mac(profile_file, cell_file, staged_file, destination, output):
    profile = json.loads(
        command(
            [
                workspace.node_path(),
                "tooling/installation-profile.mjs",
                "--inspect-profile",
                profile_file,
            ],
            capture=True,
        )
    )
    cell = json.loads(cell_file.read_text())
    record = json.loads(staged_file.read_text())
    require(
        sys.platform == "darwin"
        and native_profile(cell["target"], cell["profile"], cell["backend"]) == cell,
        "Use the admitted native macOS fixture.",
    )
    require(
        destination.is_absolute()
        and destination.resolve() == destination
        and destination.is_relative_to(Path(profile["scratch_root"]))
        and output.is_relative_to(Path(profile["scratch_root"])),
        "Use canonical scratch installation and receipt paths.",
    )
    check_installation_admission(record, profile)
    if destination.exists():
        verify_staged(record)
        binding = verify_installed_payload(Path(record["file"]), cell, destination, contract=record)
    else:
        install_staged(record, cell, destination, profile=profile)
        binding = verify_installed_payload(Path(record["file"]), cell, destination, contract=record)
    descriptor = quality_native.prepared_record(destination, cell)
    (destination / "prepared.json").write_text(json.dumps(descriptor) + "\n")
    output.write_text(
        json.dumps(
            {
                "status": "passed",
                "sha256": record["sha256"],
                "payload_manifest_sha256": binding,
                "prepared_directory": str(destination),
            }
        )
        + "\n"
    )


def observe_installed(profile_file, payload, output, cell, previous=None):
    args = [
        str(workspace.node_path()),
        "tooling/installation-smoke.mjs",
        str(profile_file),
        str(payload),
        str(output),
    ]
    if previous is not None:
        args.append(str(previous))
    samples = []
    identities = []
    displays = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            quality_native.run_owned, args, ROOT, quality_native.build_environment(), 120, 5
        )
        while not future.done():
            identity_file = output / "native-processes.json"
            if identity_file.exists():
                known = json.loads(identity_file.read_text())["processes"]
                for item in known:
                    if item not in identities:
                        identities.append(item)
                samples.extend(installed_processes(payload, known, ready_only=True))
                display = quality_native.display_connection(known, cell["backend"])
                if display is not None and display not in displays:
                    displays.append(display)
            time.sleep(0.2)
        supervision = future.result()
    remaining = installed_processes(payload, identities)
    observation = {
        "samples": samples,
        "ready_processes": identities,
        "display_observations": displays,
        "supervision": supervision,
        "remaining": remaining,
    }
    output.mkdir(exist_ok=True)
    (output / "native-observations.json").write_text(json.dumps(observation, indent=2) + "\n")
    require(
        supervision["exit_code"] == 0
        and not supervision["timed_out"]
        and not supervision["contained_processes_remaining_at_exit"]
        and not supervision.get("contained_processes_remaining_after_cleanup", False),
        "Installed graphical journey or supervised cleanup failed.",
    )
    require(
        identities and not remaining,
        "Installed process cessation unconfirmed.",
    )
    renderers = [item for item in samples if item["renderer"]]
    require(
        renderers and all(item["sandbox"] for item in renderers),
        "Native renderer sandbox was not observed.",
    )
    if sys.platform == "darwin":
        capture = output / "installed-window.png"
        require(capture.is_file(), "Missing native window capture.")
        displays.append(
            {
                "backend": "windowserver",
                "source": "packaged-window-capture",
                "sha256": digest(capture),
            }
        )
    require(displays, "Native display was not observed.")
    receipt = json.loads((output / "installation-receipt.json").read_text())
    require(
        receipt["status"] == "passed"
        and len(receipt["cases"]) == 2
        and all(case["result"] == "pass" for case in receipt["cases"]),
        "Incomplete installed-store journey.",
    )
    native = {
        "samples": samples,
        "ready_processes": identities,
        "display_observations": displays,
        "supervision": supervision,
        "remaining": [],
    }
    (output / "native-observations.json").write_text(json.dumps(native, indent=2) + "\n")
    return receipt, native


def exercise(
    profile_file,
    cell_file,
    staged_file,
    destination,
    output,
    rpm_keyring=None,
    installed=False,
    previous=None,
):
    """Admit installed bytes and observe actual store persistence across a native upgrade."""
    profile = json.loads(
        command(
            [
                workspace.node_path(),
                "tooling/installation-profile.mjs",
                "--inspect-profile",
                profile_file,
            ],
            capture=True,
        )
    )
    require(
        output.is_absolute()
        and output.resolve().is_relative_to(Path(profile["scratch_root"]))
        and not output.exists(),
        "Use fresh evidence inside inspected scratch.",
    )
    cell = json.loads(cell_file.read_text())
    record = json.loads(staged_file.read_text())
    require(
        native_profile(cell["target"], cell["profile"], cell["backend"]) == cell,
        "Native cell changed.",
    )
    check_installation_admission(record, profile)
    if installed:
        verify_staged(record)
        package_identity(Path(record["file"]), cell, record["version"])
        payload = Path("/opt/ohtia-quality") if sys.platform == "linux" else destination
        if sys.platform == "darwin":
            require(
                payload.resolve() == payload
                and payload.is_relative_to(Path(profile["scratch_root"])),
                "Existing macOS payload must remain inside inspected scratch.",
            )
        require(
            payload.is_dir()
            and not payload.is_symlink()
            and payload.stat().st_uid == (0 if sys.platform == "linux" else os.getuid()),
            "Root-owned installation required.",
        )
        metadata_file = (
            payload / "resources/app/package.json"
            if sys.platform == "linux"
            else next(payload.glob("*.app")) / "Contents/Resources/app/package.json"
        )
        require(
            json.loads(metadata_file.read_text())["version"] == record["version"],
            "Installed package version mismatch.",
        )
        require(
            (payload / "prepared.json").is_file(),
            "Operator must publish the installed byte inventory.",
        )
    else:
        if sys.platform == "darwin":
            require(
                destination.is_absolute()
                and destination.parent.resolve() == destination.parent
                and destination.is_relative_to(Path(profile["scratch_root"])),
                "Use inspected scratch installation destination.",
            )
        payload = install_staged(
            record, cell, destination, rpm_keyring=rpm_keyring, profile=profile
        )
        prepared = quality_native.prepared_record(payload, cell)
        descriptor = payload / "prepared.json"
        descriptor.write_text(json.dumps(prepared) + "\n")
    binding = verify_installed_payload(
        Path(record["file"]),
        cell,
        payload,
        output.parent / (output.name + "-payload.json"),
        contract=record,
    )
    check_installation_admission(record, profile)
    receipt, native = observe_installed(profile_file, payload, output, cell, previous)
    result = {
        "version": 1,
        "status": "passed",
        "cell": cell,
        "prepared_directory": str(payload),
        "package": {
            "sha256": digest(verify_staged(record)),
            "version": record["version"],
            "payload_manifest_sha256": binding,
        },
        "saved": receipt["saved"],
        "store_sha256": digest(Path(profile["research_root"]) / "ohtia.db3"),
        "store_files": store_snapshot(profile),
        "artifact_file": record["file"],
        "native": native,
        "platform_trust": "ad-hoc-internal" if sys.platform == "darwin" else "internal-catalog",
    }
    (output / "installation-result.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def inspect_baseline(profile_file, cell_file, archive, payload, output, expected_sha256):
    """Explicit read-only handoff for an existing synthetic store; no old graphical action is replayed."""
    profile = json.loads(
        command(
            [
                workspace.node_path(),
                "tooling/installation-profile.mjs",
                "--inspect-profile",
                profile_file,
            ],
            capture=True,
        )
    )
    cell = read_bounded_json(cell_file)
    require(
        cell["target"] == profile["target"] == workspace.target_id(),
        "Baseline target differs from its native fixture.",
    )
    actual_profile = (
        f"{platform.freedesktop_os_release()['ID']}-{platform.freedesktop_os_release()['VERSION_ID']}"
        if sys.platform == "linux"
        else "macos-" + command(["/usr/bin/sw_vers", "-productVersion"], capture=True).split(".")[0]
    )
    require(
        cell["profile"] == actual_profile, "Baseline distribution differs from its native fixture."
    )
    scratch = Path(profile["scratch_root"])
    require(
        output.is_absolute()
        and output.parent.resolve() == output.parent
        and output.is_relative_to(scratch)
        and not output.exists(),
        "Use a new scratch baseline proof.",
    )
    require(
        payload.resolve() == payload
        and payload.is_dir()
        and (
            payload == Path("/opt/ohtia-quality")
            if sys.platform == "linux"
            else payload.is_relative_to(scratch)
        ),
        "Inspect only the existing native fixture installation.",
    )
    require(
        archive.resolve() == archive
        and archive.is_relative_to(scratch)
        and archive.is_file()
        and digest(archive) == expected_sha256,
        "The independently selected baseline archive changed.",
    )
    lock = scratch / "update-acceptance/operation.lock"
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        lease = {
            "pid": os.getpid(),
            "nonce": __import__("uuid").uuid4().hex,
            "owner": process_identity(os.getpid()),
            "started_ms": int(time.time() * 1000),
        }
        os.write(descriptor, (json.dumps(lease) + "\n").encode())
        os.fsync(descriptor)
        assert_quiescent(payload)
        binding = verify_installed_payload(archive, cell, payload)
        prepared = quality_native.prepared_record(payload, cell)
        if sys.platform == "darwin":
            app = next(payload.glob("*.app"))
            command(["/usr/bin/codesign", "--verify", "--deep", "--strict", app])
        before = store_snapshot(profile)
        observation = output.with_name(output.name + ".store.json")
        descriptor_file = output.with_name(output.name + ".descriptor.json")
        with descriptor_file.open("x") as descriptor_stream:
            descriptor_stream.write(json.dumps(prepared) + "\n")
        subprocess.run(
            [
                str(payload / prepared["executable"]),
                str(ROOT / "tooling/installation-store.cjs"),
                str(payload),
                profile["research_root"],
                str(observation),
                str(descriptor_file),
            ],
            env={**tool_environment(), "ELECTRON_RUN_AS_NODE": "1"},
            check=True,
            timeout=30,
        )
        store = read_bounded_json(observation)
        snapshot = store_snapshot(profile)
        require(snapshot == before, "Store changed during baseline inspection.")
        require(digest(archive) == expected_sha256, "Baseline archive changed during inspection.")
        proof = {
            "schema_version": 1,
            "kind": "inspected-native-baseline",
            "cell": cell,
            "home": profile["home"],
            "research_root": profile["research_root"],
            "prepared_directory": str(payload),
            "artifact_file": str(archive),
            "package": {
                "sha256": expected_sha256,
                "version": store["installed_version"],
                "payload_manifest_sha256": binding,
            },
            "saved": store["appearance"],
            "store_sha256": snapshot["ohtia.db3"]["sha256"],
            "store_files": snapshot,
        }
        with output.open("x") as stream:
            stream.write(json.dumps(proof, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)
        lock.unlink()


def native_ordering():
    pairs = [
        ("0.1.0~beta.2-1", "0.1.0~beta.10-1"),
        ("0.1.0~beta.10-1", "0.1.0~dev.2.1-1"),
        ("0.1.0~dev.2.1-1", "0.1.0~dev.10.1-1"),
        ("0.1.0~dev.10.1-1", "0.1.0-1"),
    ]
    if sys.platform != "linux":
        return {"status": "inapplicable", "reason": "No native DEB/RPM ordering on macOS."}
    if platform.freedesktop_os_release()["ID"] == "fedora":
        for left, right in pairs:
            output = command(
                ["rpm", "--eval", f'%{{lua: print(rpm.vercmp("{left}","{right}"))}}'], capture=True
            )
            require(output == "-1", "Native RPM ordering rejected the provisional mapping.")
    else:
        for left, right in pairs:
            command(["dpkg", "--compare-versions", left, "lt", right])
    return {"status": "passed", "pairs": pairs}


def source_identity():
    """Bind dirty worktrees or explicitly sealed source archives to actual source file bytes."""
    head = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if head.returncode == 0:
        names = command(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"], capture=True
        ).splitlines()
        return {
            "source_sha": head.stdout.strip(),
            "files": {
                name: digest(ROOT / name) for name in sorted(names) if (ROOT / name).is_file()
            },
        }
    file = ROOT / "installation-inputs.json"
    require(
        file.is_file() and not file.is_symlink(),
        "A source archive requires its independently retained input seal.",
    )
    record = json.loads(file.read_text())
    require(
        isinstance(record.get("files"), dict) and record["files"], "Missing source file inventory."
    )
    for name, expected in record["files"].items():
        path = ROOT / name
        require(
            path.resolve().is_relative_to(ROOT)
            and path.is_file()
            and not path.is_symlink()
            and digest(path) == expected,
            "Source archive differs from its retained seal.",
        )
    actual = command(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"], capture=True
    ).splitlines()
    require(
        set(actual) - {"installation-inputs.json"} == set(record["files"]),
        "Source archive contains undeclared or missing source files; initialize its empty Git inventory before building.",
    )
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    build = sub.add_parser(
        "build",
        epilog="Fedora output must be signed with an independently provisioned qualification key before catalog construction and administrator registration. Retain its public fingerprint and expected-key database separately; this entry grants no signing or installation authority.",
    )
    build.add_argument("target")
    build.add_argument("profile")
    build.add_argument("backend")
    build.add_argument("output", type=Path)
    run = sub.add_parser("exercise")
    run.add_argument("runtime_profile", type=Path)
    run.add_argument("cell", type=Path)
    run.add_argument("staged", type=Path)
    run.add_argument("destination", type=Path)
    run.add_argument("output", type=Path)
    run.add_argument("--rpm-keyring", type=Path)
    run.add_argument("--installed", action="store_true")
    run.add_argument("--previous", type=Path)
    build.add_argument(
        "--run-id",
        type=int,
        required=True,
        help="Unique positive internal run identity; packages use dev.<run>.<attempt>.",
    )
    identity_parser = sub.add_parser(
        "lease-identity", help="Read the native birth identity of an operation owner."
    )
    identity_parser.add_argument("pid", type=int)
    lease_parser = sub.add_parser(
        "lease-status", help="Inspect a retained lease without signalling its owner."
    )
    lease_parser.add_argument("file", type=Path)
    verify = sub.add_parser(
        "verify-payload", help="Read-only binding of installed bytes to a selected archive."
    )
    verify.add_argument("archive", type=Path)
    verify.add_argument("cell", type=Path)
    verify.add_argument("payload", type=Path)
    prepare = sub.add_parser(
        "prepare-mac",
        help="Prepare exact ad-hoc macOS bytes without opening or mutating its store.",
    )
    for name in ("runtime_profile", "cell", "staged", "destination", "output"):
        prepare.add_argument(name, type=Path)
    baseline = sub.add_parser(
        "inspect-baseline",
        help="Inspect exact installed bytes, store integrity and current preference without replaying old actions; use the proof with a new campaign --baseline.",
    )
    for name in ("runtime_profile", "cell", "archive", "payload", "output"):
        baseline.add_argument(name, type=Path)
    baseline.add_argument("--expected-sha256", required=True)
    reconcile = sub.add_parser(
        "reconcile-state",
        help="Explicitly reclaim a ceased native lease and reconcile retained signed metadata without lowering replay/version floors.",
    )
    reconcile.add_argument("runtime_profile", type=Path)
    reconcile.add_argument("evidence", type=Path)
    describe = sub.add_parser(
        "describe-payload",
        help="Derive an executable descriptor from the verified payload, never its excluded sidecar.",
    )
    for name in ("cell", "payload", "output"):
        describe.add_argument(name, type=Path)
    args = parser.parse_args()
    try:
        if args.operation == "describe-payload":
            require(
                args.payload.resolve() == args.payload
                and args.output.parent.resolve() == args.output.parent,
                "Use canonical descriptor paths.",
            )
            descriptor = quality_native.prepared_record(args.payload, read_bounded_json(args.cell))
            with args.output.open("x") as stream:
                stream.write(json.dumps(descriptor) + "\n")
            return 0
        require(
            sys.platform in {"linux", "darwin"},
            "These internal native helpers support Linux and macOS only.",
        )
        if args.operation == "reconcile-state":
            profile = json.loads(
                command(
                    [
                        workspace.node_path(),
                        "tooling/installation-profile.mjs",
                        "--inspect-profile",
                        args.runtime_profile,
                    ],
                    capture=True,
                )
            )
            scratch = Path(profile["scratch_root"])
            require(
                args.evidence.resolve() == args.evidence and args.evidence.is_relative_to(scratch),
                "Use retained evidence inside the native fixture.",
            )
            print(json.dumps(reconcile_state(scratch / "update-acceptance", args.evidence)))
            return 0
        if args.operation == "inspect-baseline":
            inspect_baseline(
                args.runtime_profile,
                args.cell,
                args.archive,
                args.payload,
                args.output,
                args.expected_sha256,
            )
            return 0
        if args.operation == "prepare-mac":
            prepare_mac(args.runtime_profile, args.cell, args.staged, args.destination, args.output)
            return 0
        if args.operation == "lease-status":
            print(json.dumps(lease_status(args.file)))
            return 0
        if args.operation == "lease-identity":
            print(json.dumps(process_identity(args.pid)))
            return 0
        if args.operation == "verify-payload":
            print(
                json.dumps(
                    {
                        "payload_manifest_sha256": verify_installed_payload(
                            args.archive, json.loads(args.cell.read_text()), args.payload
                        )
                    }
                )
            )
            return 0
        if args.operation == "exercise":
            exercise(
                args.runtime_profile,
                args.cell,
                args.staged,
                args.destination,
                args.output,
                args.rpm_keyring,
                args.installed,
                args.previous,
            )
            return 0
        require(0 < args.run_id <= 2**53 - 1, "Use a finite positive unique run identity.")
        cell = native_profile(args.target, args.profile, args.backend)
        output = args.output.absolute()
        require(not output.exists(), "Use a new retained build destination.")
        output.mkdir(parents=True)
        inputs = source_identity()
        command([workspace.python_path(), "scripts/workspace.py", "run", "build"])
        require(source_identity() == inputs, "Source changed while building the application.")
        (output / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
        (output / "cell.json").write_text(json.dumps(cell, indent=2) + "\n")
        (output / "native-ordering.json").write_text(json.dumps(native_ordering(), indent=2) + "\n")
        versions = [f"0.0.0-dev.{args.run_id}.{attempt}" for attempt in (1, 2)]
        manifest_file = ROOT / "artifacts/desktop-app/migrations/manifest.json"
        migrations = json.loads(manifest_file.read_text())
        require(
            isinstance(migrations, list) and migrations,
            "Missing freshly packaged migration contract.",
        )
        (output / "contracts.json").write_text(
            json.dumps(
                {
                    "versions": versions,
                    "target_schema": len(migrations),
                    "migration_manifest_sha256": digest(manifest_file),
                },
                indent=2,
            )
            + "\n"
        )
        for attempt in (1, 2):
            work = output / f"build-{attempt}"
            work.mkdir()
            desktop_runtime.assemble(args.target, work / "assembled")
            config = quality_native.configuration(
                cell, work / "assembled", work / "packages", versions[attempt - 1]
            )
            (work / "builder.json").write_text(json.dumps(config, indent=2) + "\n")
            command([workspace.node_path(), "tooling/quality-package.mjs", work / "builder.json"])
            require(source_identity() == inputs, "Build changed sealed source inputs.")
            # Successful duplicate build intermediates are disposable; retain final packages and inputs.
            for directory in (work / "assembled", work / "packaging-app"):
                if directory.is_dir() and not directory.is_symlink():
                    shutil.rmtree(directory)
            for directory in (work / "packages").iterdir():
                if directory.is_dir() and not directory.is_symlink():
                    shutil.rmtree(directory)
        return 0
    except (
        OSError,
        ValueError,
        KeyError,
        StopIteration,
        subprocess.SubprocessError,
        workspace.WorkspaceError,
    ) as error:
        print(f"Internal installation qualification refused: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
