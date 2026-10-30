"""Run one explicitly authorized Linux qualification transaction without persistent sudo access."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import installation_native as native
import quality_native
import workspace

PRIVATE = Path("/var/lib/ohtia-installation-qualification")
PAYLOAD = Path("/opt/ohtia-quality")


def read(file, maximum=65536):
    return native.read_bounded_json(file, maximum)


def publish(file, value, parent_uid=0):
    # Walk from the filesystem root without following any user-controlled directory link.
    native.require(file.is_absolute(), "Absolute operator output required.")
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    temporary = file.name + "." + __import__("uuid").uuid4().hex + ".partial"
    try:
        for part in file.parent.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        native.require(os.fstat(descriptor).st_uid == parent_uid, "Foreign output directory.")
        output = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o644,
            dir_fd=descriptor,
        )
        os.fchmod(output, 0o644)
        with os.fdopen(output, "w") as stream:
            stream.write(json.dumps(value, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.rename(temporary, file.name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def trusted_helper():
    paths = [native.ROOT, Path(__file__).resolve()]
    paths.extend(
        Path(module.__file__).resolve()
        for module in tuple(sys.modules.values())
        if getattr(module, "__file__", None)
        and Path(module.__file__).resolve().is_relative_to(native.ROOT)
    )
    for selected in paths:
        for item in (selected, *selected.parents):
            info = item.stat()
            native.require(
                info.st_uid == 0 and stat.S_IMODE(info.st_mode) & 0o022 == 0,
                "Use a separately verified root-owned helper tree, never the fixture checkout.",
            )

    seal = native.read_bounded_json(
        native.ROOT / "installation-inputs.json", 8 * 1024 * 1024, uid=0
    )
    native.require(
        isinstance(seal.get("files"), dict) and seal["files"],
        "A separately verified helper input seal is required.",
    )
    for name, expected in seal["files"].items():
        file = native.ROOT / name
        native.require(
            file.resolve() == file and file.is_relative_to(native.ROOT), "Unsafe helper seal path."
        )
        info = file.stat()
        native.require(
            stat.S_ISREG(info.st_mode)
            and info.st_uid == 0
            and stat.S_IMODE(info.st_mode) & 0o022 == 0
            and native.digest(file) == expected,
            "Administrator-owned helper source differs from its retained input seal.",
        )


def canonical_digest(value):
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    return hashlib.sha256(data.encode()).hexdigest()


def artifact_registration(args, profile, account, cell):
    native.require(
        args.expected_sha256 and args.expected_candidate and args.build,
        "Artifact admission requires an independently selected digest, candidate and build record.",
    )
    native.require(
        args.build.resolve() == args.build
        and args.build.is_relative_to(Path(profile["scratch_root"])),
        "Use this fixture's canonical build record.",
    )
    inputs = read(args.build / "inputs.json", 8 * 1024 * 1024)
    contracts = read(args.build / "contracts.json")
    candidate = canonical_digest({"inputs": inputs, "contracts": contracts})
    native.require(
        candidate == args.expected_candidate,
        "Build inputs differ from the administrator's candidate pin.",
    )
    archive = copied_archive(
        args.admit_artifact, args.expected_sha256, account, Path(profile["scratch_root"])
    )
    inventory = native.package_inventory(archive, cell)
    native.require(
        inventory.target_schema == contracts["target_schema"]
        and inventory.migration_manifest_sha256 == contracts["migration_manifest_sha256"],
        "Archive migration contract differs from the selected build.",
    )
    versions = []
    for version in contracts["versions"]:
        try:
            native.package_identity(archive, cell, version)
            versions.append(version)
        except ValueError:
            continue
    native.require(len(versions) == 1, "Archive identity is not one unique selected build version.")
    approval = {
        "identity": {"uid": account.pw_uid, "profile": str(args.runtime_profile)},
        "sha256": args.expected_sha256,
        "bytes": archive.stat().st_size,
        "archive": archive.name,
        "version": versions[0],
        "candidate": candidate,
        "target": cell["target"],
        "profile": cell["profile"],
        "schema": {
            "source_min": 0,
            "source_max": inventory.target_schema,
            "target": inventory.target_schema,
        },
        "migration_manifest_sha256": inventory.migration_manifest_sha256,
    }
    for file in PRIVATE.glob("approved-*.json"):
        prior = native.read_bounded_json(file, uid=0)
        native.require(
            prior["version"] != approval["version"] or prior["sha256"] == approval["sha256"],
            "A reserved native version cannot identify different package bytes.",
        )
    publish(PRIVATE / ("approved-" + args.expected_sha256 + ".json"), approval)
    print(
        "Administrator-selected artifact and sealed build identity registered; no installation performed."
    )


def approved_artifact(record, identity, cell):
    file = PRIVATE / ("approved-" + record["sha256"] + ".json")
    approval = native.read_bounded_json(file, uid=0)
    native.require(
        approval["identity"] == identity
        and approval["target"] == cell["target"]
        and approval["profile"] == cell["profile"]
        and approval["sha256"] == record["sha256"]
        and approval["bytes"] == record["bytes"]
        and approval["version"] == record["version"]
        and record["entry"]["native_version"] == approval["version"].replace("-", "~", 1) + "-1"
        and approval["candidate"] == record["admission"]["candidate"]
        and approval["schema"] == record["entry"]["schema"]
        and approval["migration_manifest_sha256"] == record["migration_manifest_sha256"],
        "Request differs from the administrator-owned artifact admission.",
    )
    archive = PRIVATE / approval["archive"]
    native.require(
        archive.resolve() == archive
        and archive.parent == PRIVATE
        and archive.stat().st_uid == 0
        and native.digest(archive) == approval["sha256"],
        "Administrator-approved archive changed.",
    )
    return archive


def recovery_checkpoint(owner, profile):
    preflight = owner.get("preflight")
    native.require(
        preflight is not None and native.store_snapshot(profile) == preflight["store"],
        "The store or journals changed since verified pre-installation inspection; retain evidence and inspect recovery separately.",
    )
    native.assert_quiescent(PAYLOAD)
    return {
        "kind": "unchanged-verified-store",
        "sha256": Path(owner["pending"]).stem,
        "current": preflight["current"],
        "store": preflight["store"],
    }


def profile_input(file):
    import pwd

    native.require(
        file.is_absolute() and file.name == "runtime-profile.json",
        "Explicit runtime-profile.json required.",
    )
    profile = read(file)
    account = pwd.getpwnam(profile["username"])
    native.require(
        account.pw_uid != 0
        and file.stat().st_uid == account.pw_uid
        and Path(account.pw_dir) == Path(profile["home"])
        and file.is_relative_to(Path(account.pw_dir)),
        "Foreign or privileged runtime profile.",
    )
    for name in ("home", "configuration_root", "research_root", "scratch_root"):
        directory = Path(profile[name])
        native.require(
            directory.resolve() == directory
            and directory.is_dir()
            and directory.stat().st_uid == account.pw_uid,
            "Unqualified fixture root.",
        )
    home = Path(account.pw_dir)
    native.require(
        Path(profile["configuration_root"]) == home / ".config"
        and Path(profile["research_root"]) == home / "ohtia"
        and Path(profile["scratch_root"]).is_relative_to(home),
        "Preserve the native fixed configuration and research roots.",
    )
    return profile, account


def copied_archive(file, expected, account, scratch, expected_bytes=None):
    native.require(
        isinstance(expected, str)
        and len(expected) == 64
        and all(character in "0123456789abcdef" for character in expected),
        "An exact SHA-256 archive identity is required.",
    )
    native.require(
        file.is_absolute()
        and (file.is_relative_to(scratch) or file.is_relative_to(PRIVATE))
        and file.suffix in {".deb", ".rpm"},
        "Select an archive inside the fixture or protected operator storage.",
    )
    uid = 0 if file.is_relative_to(PRIVATE) else account.pw_uid
    maximum = read(native.ROOT / "config/desktop/resource-policy.json")["budgets"][
        "update_package_bytes"
    ]["value"]
    info = file.lstat()
    native.require(
        file.resolve() == file
        and stat.S_ISREG(info.st_mode)
        and info.st_nlink == 1
        and info.st_uid == uid
        and 0 < info.st_size <= maximum
        and (expected_bytes is None or info.st_size == expected_bytes),
        "Unsafe or mismatched selected archive.",
    )
    destination = PRIVATE / (expected + file.suffix)
    pending = (
        None
        if destination.exists()
        else PRIVATE / (expected + ".transfer-" + __import__("uuid").uuid4().hex)
    )
    observed = native.observe_file(file, uid=uid, destination=pending)
    native.require(
        observed["sha256"] == expected
        and observed["bytes"] == info.st_size
        and (expected_bytes is None or observed["bytes"] == expected_bytes),
        "Selected archive changed or differs from its independent pin.",
    )
    if pending is not None:
        pending.chmod(0o600)
        pending.rename(destination)
        folder = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    native.require(
        native.observe_file(destination, uid=0) == observed, "Protected archive identity changed."
    )
    return destination


def configured_package(cell, version):
    """Check native configuration independently of the unpacked payload bytes."""
    expected = version.replace("-", "~", 1) + "-1"
    if cell["profile"].startswith("fedora-"):
        arguments = ["rpm", "-q", "--qf", "%{EPOCHNUM}\n%{VERSION}-%{RELEASE}\n", "ohtia-quality"]
        wanted = "0\n" + expected
    else:
        arguments = ["dpkg-query", "-W", "-f=${Status}\n${Version}", "ohtia-quality"]
        wanted = "install ok installed\n" + expected
    result = subprocess.run(arguments, capture_output=True, text=True, check=False, timeout=30)
    native.require(
        result.returncode == 0 and result.stdout.strip() == wanted,
        "Native package is absent, unconfigured or a different version.",
    )


def deb_idle_locks():
    """Hold dpkg's POSIX record locks while acknowledging an already configured package."""
    import fcntl

    descriptors = []
    try:
        for file in ("/var/lib/dpkg/lock-frontend", "/var/lib/dpkg/lock"):
            descriptor = os.open(file, os.O_RDWR | os.O_NOFOLLOW)
            descriptors.append(descriptor)
            fcntl.lockf(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptors
    except BaseException:
        for descriptor in descriptors:
            os.close(descriptor)
        raise


def store_preflight(profile, account, cell):
    native.assert_quiescent(PAYLOAD)
    before = native.store_snapshot(profile)
    metadata = PAYLOAD / "resources/app/package.json"
    version = read(metadata)["version"] if metadata.exists() else None
    if before["ohtia.db3"] is None:
        return {"schema": 0, "installed_version": version, "store_files": before}
    prepared = quality_native.prepared_record(PAYLOAD, cell)
    # The parent remains root-owned and non-writable by the fixture. No privileged
    # writes or ownership changes follow paths beneath its user-controlled scratch.
    with tempfile.TemporaryDirectory(prefix="ohtia-operator-preflight-", dir="/tmp") as directory:
        temporary = Path(directory)
        temporary.chmod(0o711)
        child = temporary / "observer"
        child.mkdir(mode=0o700)
        descriptor = os.open(child, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fchown(descriptor, account.pw_uid, account.pw_gid)
        finally:
            os.close(descriptor)
        descriptor_file = temporary / "descriptor.json"
        publish(descriptor_file, prepared)
        output = child / "store.json"
        environment = {
            "HOME": account.pw_dir,
            "USER": account.pw_name,
            "LOGNAME": account.pw_name,
            "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
            "ELECTRON_RUN_AS_NODE": "1",
        }
        subprocess.run(
            [
                "runuser",
                "-u",
                account.pw_name,
                "--",
                str(PAYLOAD / prepared["executable"]),
                str(native.ROOT / "tooling/installation-store.cjs"),
                str(PAYLOAD),
                profile["research_root"],
                str(output),
                str(descriptor_file),
            ],
            env=environment,
            cwd=native.ROOT,
            check=True,
            timeout=30,
        )
        result = native.read_bounded_json(output, uid=account.pw_uid)
        native.require(
            native.store_snapshot(profile) == before, "Store changed during semantic inspection."
        )
        return {**result, "store_files": before}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime_profile", type=Path)
    parser.add_argument("cell", type=Path)
    parser.add_argument("staged", type=Path, nargs="?")
    parser.add_argument("receipt", type=Path, nargs="?")
    parser.add_argument(
        "--rpm-keyring",
        type=Path,
        help="Independently provisioned expected-key database; never the system vendor keyring.",
    )
    parser.add_argument(
        "--claim-existing",
        type=Path,
        help="Explicitly identify this task's already installed archive before taking ownership; verifies every payload byte.",
    )
    parser.add_argument(
        "--expected-sha256",
        help="Independent SHA-256 required for explicit artifact registration or an existing-installation claim.",
    )
    parser.add_argument(
        "--admit-artifact",
        type=Path,
        help="Register an independently selected archive before processing any user request; no installation.",
    )
    parser.add_argument(
        "--build",
        type=Path,
        help="Selected sealed build inputs/contracts for artifact registration.",
    )
    parser.add_argument(
        "--expected-candidate",
        help="Independent SHA-256 of canonical {inputs,contracts}; never copy authority from a user request.",
    )
    parser.add_argument(
        "--inspect-pending",
        type=Path,
        help="Publish the unchanged verified-store checkpoint for an interrupted pending transaction; no activation.",
    )
    parser.add_argument(
        "--repair-pending",
        action="store_true",
        help="Explicitly retain a partial payload and retry its same pending archive after the old native manager has ceased.",
    )
    parser.add_argument(
        "--rpm-key-id", help="Independently selected expected full OpenPGP fingerprint."
    )
    args = parser.parse_args()
    try:
        native.require(
            os.name == "posix" and workspace.target_id().startswith("linux-") and os.getuid() == 0,
            "Use the explicitly authorized Linux administrator.",
        )
        trusted_helper()
        import fcntl

        profile, account = profile_input(args.runtime_profile)
        cell = read(args.cell)
        release = __import__("platform").freedesktop_os_release()
        native.require(
            cell["target"] == workspace.target_id() == profile["target"]
            and cell["profile"] == f"{release['ID']}-{release['VERSION_ID']}",
            "Operator native target mismatch.",
        )
        PRIVATE.mkdir(mode=0o700, exist_ok=True)
        native.require(
            PRIVATE.resolve() == PRIVATE
            and PRIVATE.stat().st_uid == 0
            and stat.S_IMODE(PRIVATE.stat().st_mode) == 0o700,
            "Operator state must be private and root owned.",
        )
        descriptor = os.open(
            PRIVATE / "package.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
        )
        native_locks = []
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            owner_file = PRIVATE / "owner.json"
            owner = read(owner_file) if owner_file.exists() else None
            identity = {"uid": account.pw_uid, "profile": str(args.runtime_profile)}
            if owner is not None:
                native.require(
                    owner["identity"] == identity,
                    "Another fixture owns this host-global quality installation.",
                )
            if args.admit_artifact:
                artifact_registration(args, profile, account, cell)
                return 0
            if args.inspect_pending:
                native.require(
                    owner is not None and owner.get("pending"), "No pending transaction to inspect."
                )
                selected = args.inspect_pending
                native.require(
                    selected.parent.resolve() == selected.parent
                    and selected.is_relative_to(Path(profile["scratch_root"]))
                    and selected.name
                    == "operator-pending-" + Path(owner["pending"]).stem + ".json",
                    "Use the pending candidate checkpoint inside this fixture's evidence.",
                )
                publish(selected, recovery_checkpoint(owner, profile), parent_uid=account.pw_uid)
                print("Unchanged verified-store checkpoint published; no installation performed.")
                return 0
            if args.claim_existing:
                native.require(
                    owner is None and args.expected_sha256 is not None,
                    "Claim only an explicitly identified unowned test installation.",
                )
                archive = copied_archive(
                    args.claim_existing,
                    args.expected_sha256,
                    account,
                    Path(profile["scratch_root"]),
                )
                native.package_identity(
                    archive, cell, read(PAYLOAD / "resources/app/package.json")["version"]
                )
                if not cell["profile"].startswith("fedora-"):
                    native_locks = deb_idle_locks()
                configured_package(cell, read(PAYLOAD / "resources/app/package.json")["version"])
                native.assert_quiescent(PAYLOAD)
                binding = native.verify_installed_payload(archive, cell, PAYLOAD)
                publish(
                    owner_file,
                    {
                        "identity": identity,
                        "archive": archive.name,
                        "payload_manifest_sha256": binding,
                    },
                )
                print("Explicit test-installation ownership recorded.")
                return 0
            native.require(
                args.staged is not None and args.receipt is not None,
                "A staged request and new receipt are required.",
            )
            native.require(
                args.staged.resolve() == args.staged
                and args.staged.is_relative_to(Path(profile["scratch_root"]))
                and args.receipt.parent == args.staged.parent,
                "Requests and receipts must stay in this fixture's evidence directory.",
            )
            native.require(
                args.receipt.name.startswith("operator-ready-") and args.receipt.suffix == ".json",
                "Use the requested operation receipt basename.",
            )
            record = read(args.staged)
            archive = approved_artifact(record, identity, cell)
            selected = copied_archive(
                Path(record["file"]),
                record["sha256"],
                account,
                Path(profile["scratch_root"]),
                expected_bytes=record["bytes"],
            )
            native.require(
                selected == archive, "Staging differs from the administrator-approved artifact."
            )
            native.check_installation_admission(record, profile)
            if owner is None:
                native.require(
                    not PAYLOAD.exists(),
                    "Existing quality installation requires explicit byte-verified ownership admission; preserve other tasks.",
                )
                status = subprocess.run(
                    ["dpkg-query", "-W", "ohtia-quality"]
                    if release["ID"] != "fedora"
                    else ["rpm", "-q", "ohtia-quality"],
                    capture_output=True,
                    check=False,
                    timeout=30,
                )
                native.require(
                    status.returncode == 1,
                    "Existing native package state must be reconciled before admission.",
                )
            settled_archive = None
            if owner is not None:
                if owner.get("pending"):
                    native.require(
                        Path(owner["pending"]).stem == record["sha256"],
                        "A different candidate cannot replace an unresolved native transaction.",
                    )
                for selected in (owner.get("pending"), owner.get("archive")):
                    if not selected:
                        continue
                    try:
                        native.verify_installed_payload(PRIVATE / selected, cell, PAYLOAD)
                        settled_archive = selected
                        break
                    except (OSError, ValueError):
                        continue
                if owner.get("pending"):
                    native.require(
                        args.repair_pending,
                        "Partial installation requires explicit --repair-pending for the retained candidate.",
                    )
                    checkpoint = recovery_checkpoint(owner, profile)
                    current = checkpoint["current"]
                    failed = PRIVATE / ("failed-" + str(__import__("time").time_ns()))
                    failed.mkdir()
                    if PAYLOAD.exists():
                        shutil.copytree(PAYLOAD, failed / "payload", symlinks=True)
                    store = failed / "store"
                    store.mkdir()
                    for name, observation in checkpoint["store"].items():
                        if observation is not None:
                            copied = native.observe_file(
                                Path(profile["research_root"]) / name,
                                uid=account.pw_uid,
                                destination=store / name,
                            )
                            native.require(
                                copied == observation,
                                "Store changed while retaining repair evidence.",
                            )
                    publish(failed / "checkpoint.json", checkpoint)
                else:
                    native.require(
                        settled_archive is not None,
                        "Confirmed payload changed; preserve it for explicit recovery.",
                    )
                    retained = owner.get("preflight")
                    if (
                        settled_archive == archive.name
                        and retained is not None
                        and native.store_snapshot(profile) == retained["store"]
                        and retained["current"]["schema"] == record["admission"]["source_schema"]
                        and retained["current"]["installed_version"]
                        == record["admission"]["installed_version"]
                    ):
                        # Re-acknowledge this exact settled transaction from its root-owned
                        # pre-transition state; no graphical effect or different archive is replayed.
                        current = {**retained["current"], "store_files": retained["store"]}
                    else:
                        current = store_preflight(profile, account, cell)
            else:
                current = store_preflight(profile, account, cell)
            snapshot = (
                checkpoint["store"] if owner and owner.get("pending") else current["store_files"]
            )
            native.require(
                current["schema"] == record["admission"]["source_schema"]
                and current["installed_version"] == record["admission"]["installed_version"]
                and record["entry"]["schema"]["source_min"]
                <= current["schema"]
                <= record["entry"]["schema"]["source_max"],
                "Native state changed after catalog admission.",
            )
            protected = {**record, "file": str(archive)}

            def before_transition():
                native.require(
                    native.store_snapshot(profile) == snapshot,
                    "Store changed before native transition.",
                )
                pending_owner = {
                    "identity": identity,
                    "archive": owner.get("archive") if owner else None,
                    "pending": archive.name,
                    "preflight": {"current": current, "store": snapshot},
                }
                publish(owner_file, pending_owner)
                publish(
                    args.staged.parent / ("operator-pending-" + record["sha256"] + ".json"),
                    recovery_checkpoint(pending_owner, profile),
                    parent_uid=account.pw_uid,
                )

            already_active = (
                settled_archive == archive.name
                and not owner.get("pending")
                and not cell["profile"].startswith("fedora-")
            )
            if already_active:
                native_locks = deb_idle_locks()
                configured_package(cell, record["version"])
                native.check_installation_admission(record, profile)
                native.assert_quiescent(PAYLOAD)
                native.require(
                    native.store_snapshot(profile) == snapshot,
                    "Store changed before settled native acknowledgement.",
                )
                payload = PAYLOAD
            else:
                payload = native.install_staged(
                    protected,
                    cell,
                    PAYLOAD,
                    rpm_keyring=args.rpm_keyring,
                    rpm_key_id=args.rpm_key_id,
                    profile=profile,
                    administrator=True,
                    before_transition=before_transition,
                    repair=bool(
                        owner and (owner.get("pending") or settled_archive == archive.name)
                    ),
                )
            configured_package(cell, record["version"])
            binding = native.verify_installed_payload(archive, cell, payload)
            prepared = quality_native.prepared_record(payload, cell)
            publish(payload / "prepared.json", prepared)
            publish(
                owner_file,
                {
                    "identity": identity,
                    "archive": archive.name,
                    "payload_manifest_sha256": binding,
                    "preflight": {"current": current, "store": snapshot},
                },
            )
            publish(
                args.receipt,
                {
                    "status": "passed",
                    "sha256": record["sha256"],
                    "payload_manifest_sha256": binding,
                    "lease": record["admission"]["lease"],
                    "activation": "already-active" if already_active else "installed",
                },
                parent_uid=account.pw_uid,
            )
            print("Authorized native transaction and authenticated payload verification passed.")
        finally:
            for native_descriptor in native_locks:
                os.close(native_descriptor)
            os.close(descriptor)
    except (
        OSError,
        ValueError,
        KeyError,
        subprocess.SubprocessError,
        workspace.WorkspaceError,
    ) as error:
        print(f"Operator transaction refused: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
