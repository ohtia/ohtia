"""Orchestrate a single approved disposable lease or independently reconcile completed leases."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import scaleway_bootstrap as bootstrap
import scaleway_cycle as cycle
import scaleway_evidence as evidence_archive
import scaleway_preflight as preflight
import scaleway_progress as reporting
from scaleway_ledger import (
    GitHub,
    attempt_ended,
    install_cli,
    settled_records,
    validate_resolutions,
)

INCOMING = "/var/lib/ohtia-qualification/incoming"
GUEST_SOURCE = "/home/ohtia/source"
GUEST_OUTPUT = "/home/ohtia/result"


def enabled(*, recovery: bool = False) -> None:
    cycle.require(
        os.environ.get("SCW_RECOVERY_ENABLED") == "true"
        and (recovery or os.environ.get("SCW_CYCLE_ENABLED") == "true"),
        "cycle_not_enabled",
    )


def key_lifetimes() -> None:
    now = cycle.timestamp(cycle.utc())
    limits = cycle.policy()["limits"]
    minimum = now + dt.timedelta(
        seconds=limits["lease_seconds"]
        + limits["cleanup_seconds"]
        + limits["key_validity_margin_seconds"]
    )
    for name in ("SCW_CREATOR_KEY_EXPIRES_AT", "SCW_CLEANUP_KEY_EXPIRES_AT"):
        cycle.require(cycle.timestamp(os.environ.get(name, "")) > minimum, "key_expiry_margin")


def previous(gh: GitHub, settings: dict, *, current: tuple[str, str], fresh: bool) -> list:
    value = gh.completed_ledger(settings, fresh=fresh)
    resolutions = value.get("empty_project_resolutions", [])
    unresolved = gh.intents(
        settings,
        previous=value["leases"],
        excluding=current,
        unallocated=value.get("unallocated_attempts", []),
        resolutions=resolutions,
    )
    cycle.require(not unresolved, "unresolved_prior_intent")
    cycle.require(
        len(value["leases"]) + len(resolutions) < cycle.policy()["limits"]["maximum_leases"],
        "ledger_capacity",
    )
    return value["leases"]


def ensure_recovery(gh: GitHub, *, dispatch: bool) -> None:
    enabled()
    identity = cycle.source_context("creator")
    gh.run(identity["run_id"], "creator", require_active=True)
    gh.guards()
    key_lifetimes()
    preflight.ensure(gh, cycle.configuration(), identity, dispatch=dispatch)


def prepare(gh: GitHub, profile: str, directory: Path, build_directory: Path) -> None:
    enabled()
    identity = cycle.source_context("creator")
    gh.run(identity["run_id"], "creator", require_active=True)
    gh.guards()
    key_lifetimes()
    settings = cycle.configuration(profile)
    previous(gh, settings, current=(identity["run_id"], identity["attempt"]), fresh=True)
    build = cycle.read(build_directory / "build.json")
    cycle.validate_build(build)
    cycle.require(
        build["identity"] == identity
        and build["profile"] == profile
        and build["source_tree"]
        == cycle.command(["git", "rev-parse", "HEAD^{tree}"]).stdout.decode().strip(),
        "controller_build_identity",
    )
    for key in ("package", "harness"):
        cycle.verify_artifact(build_directory, build[key])
    cycle.require(not directory.exists(), "fresh_intent_output")
    directory.mkdir(parents=True, mode=0o700)
    cycle.write(
        directory / "intent.json", cycle.create_intent(identity, settings, build, cycle.utc())
    )


def cloud_config(intent: dict, resources: dict, public_key: str) -> bytes:
    profile = intent["profile"]
    common = ["python3", "sudo", "binutils", "gnome-shell", "gnome-session", "unzip"]
    packages = common + (
        [
            "python3-gobject",
            "libatomic",
            "dbus-daemon",
            "dbus-tools",
            "btrfs-progs",
            "iproute",
            "libxcrypt-compat",
            "gtk3",
            "nss",
            "alsa-lib",
            "libXScrnSaver",
            "libXtst",
            "libsecret",
            "libnotify",
            "at-spi2-atk",
            "policycoreutils",
            "selinux-policy-targeted",
            "audit",
            "mesa-libgbm",
            "xdg-utils",
        ]
        if profile == "fedora-44"
        else [
            "python3-gi",
            "libatomic1",
            "dbus-user-session",
            "dbus-bin",
            "e2fsprogs",
            "libgtk-3-0t64",
            "libnss3",
            "libasound2t64",
            "libgbm1",
            "libxss1",
            "libxtst6",
            "libsecret-1-0",
            "libnotify4",
            "libatspi2.0-0t64",
            "apparmor",
            "apparmor-utils",
            "iproute2",
            "xdg-utils",
        ]
    )
    policy = cycle.policy()
    guard = {
        "version": 1,
        "intent": intent,
        "resources": resources,
        "home_bytes": policy["storage"]["home_bytes"],
        "maximum_harness_files": policy["limits"]["maximum_harness_files"],
        "maximum_harness_expanded_bytes": policy["limits"]["maximum_harness_expanded_bytes"],
        "package_inventory_bytes": policy["limits"]["package_inventory_bytes"],
        "package_inventory_seconds": policy["limits"]["package_inventory_seconds"],
    }
    cycle.require(len(json.dumps(guard).encode()) <= 65536, "guest_guard_bound")
    desktop = cycle.intent_cell(intent)["desktop"]
    commands = []
    if desktop == "kde":
        # The official KDE set installs without recommended or weak dependencies, never GNOME.
        commands += cycle.linux_desktop.kde_install_commands(profile, packages)
        packages = []
    elif profile == "fedora-44":
        commands.append(
            ["dnf", "-y", "install", "--allowerasing", "fedora-release-identity-workstation"]
        )
    if profile == "fedora-44":
        commands.append(["systemctl", "start", "auditd"])
    commands += [
        ["mkdir", "-p", INCOMING],
        ["chmod", "0755", "/var/lib/ohtia-qualification", INCOMING],
        ["/usr/bin/python3", "/usr/local/lib/ohtia-qualification/bootstrap.py", "prepare"],
    ]
    value = {
        "users": [
            {"name": "root", "lock_passwd": True, "ssh_authorized_keys": [public_key.strip()]},
            {
                "name": "ohtia",
                "homedir": "/home/ohtia",
                "shell": "/bin/bash",
                "lock_passwd": True,
                "groups": [],
                "sudo": None,
            },
        ],
        "ssh_pwauth": False,
        "disable_root": False,
        "bootcmd": [
            [
                "systemd-run",
                "--unit=ohtia-lease-expiry",
                # Both units must work while cloud-init still blocks sysinit.target.
                "--timer-property=DefaultDependencies=no",
                "--timer-property=Conflicts=shutdown.target",
                "--timer-property=Before=shutdown.target",
                "--property=DefaultDependencies=no",
                "--property=Conflicts=shutdown.target",
                "--property=Before=shutdown.target",
                f"--on-active={policy['limits']['guest_shutdown_seconds']}s",
                "/usr/bin/systemctl",
                "poweroff",
            ]
        ],
        "write_files": [
            # Preserve the ephemeral key when Scaleway regenerates authorized_keys.
            {
                "path": "/root/.ssh/instance_keys",
                "owner": "root:root",
                "permissions": "0600",
                "content": public_key.strip() + "\n",
            },
            {
                "path": str(cycle.GUARD),
                "owner": "root:root",
                "permissions": "0644",
                "content": json.dumps(guard),
            },
            {
                "path": "/usr/local/lib/ohtia-qualification/bootstrap.py",
                "owner": "root:root",
                "permissions": "0555",
                "content": (cycle.ROOT / "scripts/scaleway_bootstrap.py").read_text(),
            },
        ],
        "package_update": True,
        # cloud-init's schema refuses an empty list; KDE guests install through runcmd.
        **({"packages": packages} if packages else {}),
        "runcmd": commands,
    }
    return ("#cloud-config\n" + json.dumps(value, indent=2) + "\n").encode()


def ssh_options(key: Path, known: Path) -> list[str]:
    pairs = {
        "IdentityAgent": "none",
        "IdentitiesOnly": "yes",
        "StrictHostKeyChecking": "yes",
        "UserKnownHostsFile": str(known),
        "GlobalKnownHostsFile": "/dev/null",
        "BatchMode": "yes",
        "PasswordAuthentication": "no",
        "KbdInteractiveAuthentication": "no",
        "ForwardAgent": "no",
        "ForwardX11": "no",
        "ClearAllForwardings": "yes",
        "PermitLocalCommand": "no",
        "ConnectTimeout": "5",
        "ServerAliveInterval": "10",
        "ServerAliveCountMax": "2",
    }
    return [
        "-F",
        "/dev/null",
        "-i",
        str(key),
        *(arg for name, value in pairs.items() for arg in ("-o", f"{name}={value}")),
    ]


def host_key(
    api: cycle.API,
    intent: dict,
    resources: dict,
    key: Path,
    deadline: float,
    progress: reporting.Progress | None = None,
) -> tuple[str, Path]:
    known = key.parent / "known_hosts"

    def diagnose(operation: str, **observations):
        if progress is not None:
            progress.host_key(intent["nonce"], operation, **observations)

    def request(operation: str, action):
        diagnose(operation)
        try:
            return action()
        except cycle.CycleError as error:
            code = cycle.failure_code(error)
            expired = time.monotonic() >= deadline
            diagnose(operation, provider_failure=code)
            if (
                code in {"provider_transport", "provider_deadline", "provider_operation_deadline"}
                and expired
            ):
                raise cycle.CycleError("host_key_deadline") from None
            raise

    def observe(name: str):
        if progress is not None:
            progress.observe(name)

    while time.monotonic() < deadline:
        server = request("server", lambda: api.get("server", resources["server"]))
        cycle.require(server is not None, "server_disappeared")
        api.owned("server", server, intent)
        diagnose("server", server=server)
        if progress is not None and progress.state["last_observation"] in {
            "not-observed",
            "allocation-response",
        }:
            observe("host-server-observed")
        address = request("ip", lambda: api.get("ip", resources["ip"]))
        cycle.require(address is not None, "ip_disappeared")
        api.owned("ip", address, intent)
        parsed = ipaddress.ip_address(address["address"])
        cycle.require(parsed.version == 4 and parsed.is_global, "guest_address_identity")
        if address.get("server") is None:
            diagnose("ip", ip_attachment="unattached")
            observe("host-ip-unattached")
            time.sleep(cycle.policy()["limits"]["poll_seconds"])
            continue
        attached = (
            isinstance(address["server"], dict)
            and address["server"].get("id") == resources["server"]
        )
        diagnose("ip", ip_attachment="matched" if attached else "invalid")
        cycle.require(attached, "guest_address_identity")
        fingerprints = request(
            "fingerprint",
            lambda: api.request(
                "GET",
                api.path("server", resources["server"]) + "/user_data/ssh-host-fingerprints",
                raw=True,
                missing=True,
            ),
        )
        if fingerprints:
            diagnose("fingerprint", fingerprint_status="invalid")
            cycle.require(len(fingerprints) <= 65536, "host_fingerprint_bound")
            trusted = set(re.findall(rb"SHA256:[A-Za-z0-9+/]{43}(?![A-Za-z0-9+/])", fingerprints))
            cycle.require(bool(trusted), "host_fingerprint_unavailable")
            diagnose("fingerprint", fingerprint_status="present")
            if progress is not None and progress.state["last_observation"] in {
                "host-server-observed",
                "host-ip-unattached",
                "host-fingerprint-missing",
            }:
                observe("host-fingerprint-present")
            operation, diagnostic = "host-keyscan", {}
            try:
                if progress is not None:
                    progress.attempted(operation)
                diagnose("keyscan")
                scan = cycle.command(
                    ["ssh-keyscan", "-T", "5", "-t", "ed25519", str(parsed)],
                    timeout=10,
                    diagnostics=diagnostic,
                ).stdout
                diagnose("keyscan", scan=diagnostic)
                lines = [line for line in scan.splitlines() if not line.startswith(b"#")]
                cycle.require(
                    len(lines) == 1
                    and re.fullmatch(
                        str(parsed).encode().replace(b".", rb"\.")
                        + rb" ssh-ed25519 [A-Za-z0-9+/=]{40,200}",
                        lines[0],
                    )
                    is not None,
                    "host_scan_identity",
                )
                candidate = key.parent / "host-key.pub"
                candidate.write_bytes(lines[0] + b"\n")
                if progress is not None:
                    progress.transport(operation, diagnostic)
                operation, diagnostic = "host-keygen", {}
                if progress is not None:
                    progress.attempted(operation)
                diagnose("keygen")
                observed = cycle.command(
                    ["ssh-keygen", "-l", "-E", "sha256", "-f", str(candidate)],
                    diagnostics=diagnostic,
                ).stdout.split()
                cycle.require(len(observed) >= 2 and observed[1] in trusted, "host_key_mismatch")
                known.write_bytes(lines[0] + b"\n")
                known.chmod(0o600)
                diagnose("admitted")
                return str(parsed), known
            except subprocess.SubprocessError:
                observe(
                    "host-keyscan-failed" if operation == "host-keyscan" else "host-keygen-failed"
                )
            finally:
                if progress is not None:
                    progress.transport(operation, diagnostic)
                if operation == "host-keyscan":
                    diagnose("keyscan", scan=diagnostic)
        else:
            diagnose("fingerprint", fingerprint_status="missing")
            observe("host-fingerprint-missing")
        time.sleep(cycle.policy()["limits"]["poll_seconds"])
    raise cycle.CycleError("host_key_deadline")


def guest(
    api: cycle.API,
    intent: dict,
    resources: dict,
    key: Path,
    build_directory: Path,
    output: Path,
    deadline: float,
    progress: reporting.Progress | None = None,
) -> dict:

    def inventory_record(state: str) -> dict:
        # The image is the selected input; the architecture is observed in the guest.
        return {
            "version": 1,
            "identity": intent["identity"],
            "cell": cycle.intent_cell(intent),
            "selected_image_id": intent["image_id"],
            "guest_state": state,
        }

    def inventory_unavailable() -> None:
        # The helper cannot be reached: mark the list explicitly instead of omitting it.
        try:
            cycle.write(
                output / "native-os-packages.json",
                {
                    **inventory_record("failed"),
                    "status": "failed",
                    "code": "package_inventory_unavailable",
                },
            )
        except (OSError, ValueError, KeyError, TypeError):
            pass

    if progress is not None:
        progress.phase("host-key", deadline=deadline)
    try:
        address, known = host_key(api, intent, resources, key, deadline, progress)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        inventory_unavailable()
        raise
    if progress is not None:
        progress.observe("host-key-admitted")
        progress.phase("bootstrap", deadline=deadline)
    options = ssh_options(key, known)
    test_deadline = deadline
    phase = "bootstrap"

    def remote(text: str, *, timeout: int = 30, operation: str = "evidence"):
        cycle.require(time.monotonic() < deadline, "guest_test_deadline")
        diagnostic = {}
        if progress is not None:
            progress.attempted(operation)
        try:
            return cycle.command(
                ["ssh", "-T", *options, f"root@{address}", text],
                timeout=min(timeout, max(1, int(deadline - time.monotonic()))),
                diagnostics=diagnostic,
            ).stdout
        finally:
            if progress is not None:
                progress.transport(operation, diagnostic)

    def bootstrap_status(operation="bootstrap-status"):
        raw = cycle.decode(
            remote(
                "/usr/bin/python3 /usr/local/lib/ohtia-qualification/bootstrap.py status",
                operation=operation,
            )
        )
        cycle.require(
            type(raw.get("ready")) is bool and type(raw.get("failed")) is bool,
            "bootstrap_status_shape",
        )
        safe = {
            "version": 1,
            "ready": raw["ready"],
            "failed": raw["failed"],
            "code": cycle.failure_code(cycle.CycleError(raw.get("code")))
            if raw.get("code")
            else None,
            "program": raw.get("program")
            if raw.get("program")
            in {
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
            else None,
            "exit_code": raw.get("exit_code") if type(raw.get("exit_code")) is int else None,
            "cloud_init_error_count": cycle.integer(raw.get("cloud_init_error_count", 0)),
        }
        cycle.write(output / "bootstrap.json", safe)
        return safe

    def observe_inventory(state: str) -> dict:
        """Retain the root-produced package list only after its digest and form are verified."""
        limits = cycle.policy()["limits"]
        record = inventory_record(state)
        try:
            summary = cycle.decode(
                remote(
                    "/usr/bin/python3 /usr/local/lib/ohtia-qualification/bootstrap.py packages",
                    timeout=limits["package_inventory_seconds"] + 30,
                    operation="inventory",
                )
            )
            if summary.get("status") == "failed":
                code = summary.get("code")
                raise cycle.CycleError(
                    code if code in bootstrap.INVENTORY_CODES else "package_inventory_failed"
                )
            cycle.require(
                set(summary) == {"version", "status", "machine", "packages", "bytes", "sha256"}
                and summary["version"] == 1
                and summary["status"] == "observed"
                and summary["machine"] == "aarch64"
                and type(summary["packages"]) is int
                and type(summary["bytes"]) is int
                and 0 < summary["bytes"] <= limits["package_inventory_bytes"]
                and isinstance(summary["sha256"], str),
                "guest_package_inventory_shape",
            )
            data = remote(f"cat {cycle.GUEST_INVENTORY}", operation="inventory")
            cycle.require(
                len(data) == summary["bytes"]
                and hashlib.sha256(data).hexdigest() == summary["sha256"],
                "guest_package_inventory_digest",
            )
            try:
                count = bootstrap.inventory_count(data, limits["package_inventory_bytes"])
            except ValueError as error:
                raise cycle.CycleError(str(error)) from None
            cycle.require(count == summary["packages"], "guest_package_inventory_digest")
            with (output / "native-os-packages.txt").open("xb") as retained:
                retained.write(data)
            record.update(
                status="observed",
                architecture=summary["machine"],
                packages=count,
                bytes=len(data),
                sha256=summary["sha256"],
            )
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
            record.update(status="failed", code=cycle.failure_code(error))
            try:
                cycle.write(output / "native-os-packages.json", record)
            except (OSError, ValueError):
                pass
            raise
        cycle.write(output / "native-os-packages.json", record)
        return record

    primary = None
    readiness_confirmed = False
    inventory, inventory_attempted = None, False
    try:
        while time.monotonic() < test_deadline:
            try:
                if not readiness_confirmed:
                    present = reporting.readiness(
                        remote(reporting.READINESS_COMMAND, operation="ssh-readiness")
                    )
                    if progress is not None:
                        progress.readiness(present)
                    readiness_confirmed = all(present.values())
                    if not readiness_confirmed:
                        time.sleep(
                            min(
                                cycle.policy()["limits"]["poll_seconds"],
                                max(0, test_deadline - time.monotonic()),
                            )
                        )
                        continue
                observed = bootstrap_status()
            except subprocess.SubprocessError:
                readiness_confirmed = False
                time.sleep(
                    min(
                        cycle.policy()["limits"]["poll_seconds"],
                        max(0, test_deadline - time.monotonic()),
                    )
                )
                continue
            if progress is not None:
                progress.observe(
                    "bootstrap-failed"
                    if observed["failed"]
                    else "bootstrap-ready"
                    if observed["ready"]
                    else "bootstrap-not-ready"
                )
            cycle.require(not observed["failed"], "guest_bootstrap_failed")
            if observed["ready"]:
                break
            time.sleep(
                min(
                    cycle.policy()["limits"]["poll_seconds"],
                    max(0, test_deadline - time.monotonic()),
                )
            )
        cycle.require(time.monotonic() < test_deadline, "guest_bootstrap_deadline")
        phase = "inventory"
        if progress is not None:
            progress.phase(phase, deadline=deadline)
        inventory_attempted = True
        inventory = observe_inventory("ready")
        phase = "transfer"
        if progress is not None:
            progress.observe("inventory-complete")
            progress.phase(phase, deadline=deadline)
        for kind in ("harness", "package"):
            file = cycle.verify_artifact(build_directory, intent["build"][kind])
            diagnostic = {}
            if progress is not None:
                progress.attempted("transfer")
            try:
                cycle.command(
                    ["scp", "-q", *options, str(file), f"root@{address}:{INCOMING}/{file.name}"],
                    timeout=max(1, int(test_deadline - time.monotonic())),
                    diagnostics=diagnostic,
                )
            finally:
                if progress is not None:
                    progress.transport("transfer", diagnostic)
        phase = "install"
        if progress is not None:
            progress.observe("transfer-complete")
            progress.phase(phase, deadline=deadline)
        remote(
            f"chmod 0644 {INCOMING}/* && /usr/bin/python3 /usr/local/lib/ohtia-qualification/bootstrap.py install",
            timeout=300,
            operation="install",
        )
        phase = "smoke"
        if progress is not None:
            progress.observe("installation-complete")
            progress.phase(phase, deadline=deadline)
        remote(
            f"cd {GUEST_SOURCE} && runuser -u ohtia -- .tooling/python/bin/python3 scripts/scaleway_guest.py display {GUEST_OUTPUT}",
            timeout=cycle.policy()["limits"]["test_seconds"],
            operation="smoke",
        )
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        primary = error
        if progress is not None:
            progress.failure(error)
        cycle.write(
            output / "guest-failure.json",
            cycle.failure_record(error, phase),
        )
    deadline = min(
        test_deadline + cycle.policy()["limits"]["cleanup_seconds"],
        time.monotonic() + cycle.policy()["limits"]["evidence_seconds"],
    )
    if progress is not None:
        progress.phase("evidence", deadline=deadline)
    diagnostic = {
        "version": 1,
        "status": "unavailable",
        "reason": "diagnostic-command-unavailable",
        "stage": "ssh-readiness",
        "readiness": None,
        "guest": None,
    }
    try:
        present = reporting.readiness(
            remote(reporting.READINESS_COMMAND, operation="guest-diagnostics", timeout=10)
        )
        diagnostic["readiness"] = present
        if all(present.values()):
            diagnostic["stage"] = "guest-summary"
            data = remote(
                "/usr/bin/python3 /usr/local/lib/ohtia-qualification/bootstrap.py diagnostics",
                operation="guest-diagnostics",
                timeout=10,
            )
            diagnostic.update(
                status="observed", reason=None, guest=reporting.guest_diagnostic(data)
            )
        else:
            diagnostic["reason"] = "interpreter-or-helper-unavailable"
    except subprocess.CalledProcessError:
        diagnostic["reason"] = "diagnostic-command-failed"
    except subprocess.TimeoutExpired:
        diagnostic["reason"] = "diagnostic-command-timeout"
    except subprocess.SubprocessError:
        diagnostic["reason"] = "diagnostic-command-unavailable"
    except OSError:
        diagnostic["reason"] = "local-io-unavailable"
    except (ValueError, KeyError, TypeError):
        diagnostic.update(status="invalid", reason="diagnostic-invalid")
    try:
        cycle.write(
            output / "guest-bootstrap-diagnostics.json", diagnostic, discard_incomplete=True
        )
    except (OSError, ValueError):
        pass
    value = None
    for operation in ("display", "smoke"):
        try:
            detail = cycle.decode(
                remote(f"runuser -u ohtia -- cat {GUEST_OUTPUT}/{operation}-failure.json")
            )
            safe = {
                "version": 1,
                "phase": "guest-" + operation,
                "code": cycle.failure_code(cycle.CycleError(detail.get("code"))),
                "program": detail.get("program")
                if detail.get("program") in cycle.SAFE_PROGRAMS
                else None,
                "exit_code": detail.get("exit_code")
                if type(detail.get("exit_code")) is int
                else None,
                "errno": detail.get("errno") if type(detail.get("errno")) is int else None,
                "distribution_qualified": False,
            }
            cycle.write(output / f"guest-{operation}-failure.json", safe)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            pass
    try:
        if diagnostic["readiness"] is None or all(diagnostic["readiness"].values()):
            bootstrap_status(operation="guest-diagnostics")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        pass
    # A guest that failed before the list was taken still yields an explicitly marked
    # record: one bounded attempt when it can run the helper, otherwise an unavailable list.
    if not inventory_attempted:
        if diagnostic["readiness"] is not None and all(diagnostic["readiness"].values()):
            try:
                observe_inventory("failed")
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
                pass
        else:
            inventory_unavailable()
    try:
        data = remote(f"runuser -u ohtia -- cat {GUEST_OUTPUT}/result.json")
        value = cycle.decode(data)
        cycle.require(
            value["status"] in {"passed", "failed"}
            and value["identity"] == intent["identity"]
            and value["build"] == intent["build"]
            and value["cell"] == cycle.intent_cell(intent)
            and value["distribution_qualified"] is False
            and value["publisher_signed"] is False
            and inventory is not None
            and value.get("os_packages")
            == {"bytes": inventory["bytes"], "sha256": inventory["sha256"]},
            "guest_result_binding",
        )
        cycle.write(output / "native.json", value)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        value = None
        if primary is None:
            primary = error
            cycle.write(output / "guest-failure.json", cycle.failure_record(error, "evidence"))
    try:
        if value is not None and value["status"] == "passed":
            try:
                compressed = remote(
                    f"runuser -u ohtia -- cat {GUEST_OUTPUT}/{evidence_archive.FILENAME}"
                )
                evidence_archive.admit(compressed, value["native"])
                with (output / evidence_archive.FILENAME).open("xb") as retained:
                    retained.write(compressed)
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
                if primary is None:
                    primary = error
                    cycle.write(
                        output / "guest-failure.json", cycle.failure_record(error, "evidence")
                    )
        for suite in ("runtime", "storage", "diagnostics", "startup"):
            try:
                report = remote(
                    f"cd {GUEST_SOURCE} && runuser -u ohtia -- .tooling/python/bin/python3 scripts/scaleway_guest.py collect {GUEST_OUTPUT} {suite}"
                )
                if value is not None and value["status"] == "passed":
                    record = value["suites"][suite]
                    cycle.require(
                        len(report) == record["bytes"]
                        and hashlib.sha256(report).hexdigest() == record["sha256"],
                        "guest_suite_digest",
                    )
                cycle.decode(report)
                with (output / f"{suite}.json").open("xb") as retained:
                    retained.write(report)
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
                if primary is None:
                    primary = error
                    cycle.write(
                        output / "guest-failure.json", cycle.failure_record(error, "evidence")
                    )
            try:
                supervision = remote(
                    f"cd {GUEST_SOURCE} && runuser -u ohtia -- .tooling/python/bin/python3 scripts/scaleway_guest.py collect {GUEST_OUTPUT} {suite}-supervision"
                )
                cycle.decode(supervision)
                with (output / f"{suite}-supervision.json").open("xb") as retained:
                    retained.write(supervision)
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
                pass
    finally:
        try:
            log = remote(
                f"cd {GUEST_SOURCE} && runuser -u ohtia -- .tooling/python/bin/python3 scripts/scaleway_guest.py collect {GUEST_OUTPUT} compositor"
            )
            (output / "compositor.log").write_bytes(log)
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    if primary is not None:
        if isinstance(primary, cycle.CycleError):
            raise primary
        raise cycle.CycleError(
            "native_smoke_failed" if phase == "smoke" else "guest_operation_failed"
        ) from None
    cycle.require(value is not None and value["status"] == "passed", "native_smoke_failed")
    return value


def execute(gh: GitHub, directory: Path, build_directory: Path, output: Path, fault: str) -> None:
    identity = cycle.source_context("creator")
    intent = cycle.read(directory / "intent.json")
    cycle.require(intent["identity"] == identity, "controller_intent_identity")
    cycle.require(not output.exists(), "fresh_cycle_output")
    output.mkdir(parents=True, mode=0o700)
    with reporting.Progress(output, identity, intent["profile"], fault) as progress:
        _execute(gh, intent, identity, build_directory, output, fault, progress)


def _execute(
    gh: GitHub,
    intent: dict,
    identity: dict,
    build_directory: Path,
    output: Path,
    fault: str,
    progress: reporting.Progress,
) -> None:
    state = {
        "version": 1,
        "identity": identity,
        "nonce": intent["nonce"],
        "status": "not-started",
        "allocation_resolved": True,
        "in_flight": None,
        "resources": {},
        "native_smoke_passed": False,
        "distribution_qualified": False,
    }
    journal = output / "journal.json"

    cycle.write(journal, state)
    enabled()
    settings = cycle.configuration(intent["profile"])
    cycle.validate_intent(intent, settings)
    cycle.require(
        intent["identity"] == identity
        and 0
        <= (cycle.timestamp(cycle.utc()) - cycle.timestamp(intent["created_at"])).total_seconds()
        <= 120,
        "fresh_intent_required",
    )
    gh.run(identity["run_id"], "creator", require_active=True)
    gh.guards()
    key_lifetimes()
    previous(gh, settings, current=(identity["run_id"], identity["attempt"]), fresh=True)
    # A local file is insufficient: require the immutable intent artifact before any provider write.
    stored = [
        a
        for a in gh.artifacts(identity["run_id"])
        if a["name"] == f"scw-intent-{identity['run_id']}-{identity['attempt']}"
    ]
    cycle.require(
        len(stored) == 1 and gh.artifact(stored[0], "intent.json") == intent,
        "published_intent_required",
    )
    cycle.require(fault in cycle.FAULTS, "fault_mode")
    private = Path(os.environ["RUNNER_TEMP"]) / ("ohtia-lease-" + intent["nonce"])
    private.mkdir(mode=0o700)
    key = private / "id_ed25519"
    cycle.command(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key), "-C", "ohtia-qualification"]
    )
    key.chmod(0o600)
    public_key = key.with_suffix(".pub").read_text()

    def record(event):
        state.update(
            {
                "in_flight": event["kind"] if event["stage"] == "write_intent" else None,
                "resources": dict(event["resources"]),
                "allocation_resolved": event["stage"] != "write_intent",
            }
        )
        cycle.write(journal, state)
        progress.allocation(event["kind"], event["stage"])

    api = cycle.API(os.environ.get("SCW_SECRET_KEY", ""), settings, "creator")
    cycle.write(journal, state)
    deadline = time.monotonic() + cycle.policy()["limits"]["test_seconds"]
    api.deadline = deadline
    progress.phase("allocation", deadline=deadline)
    try:
        resources = api.create(
            intent,
            public_key,
            lambda allocated: cloud_config(intent, allocated, public_key),
            record,
        )
        result = guest(api, intent, resources, key, build_directory, output, deadline, progress)
        state.update(
            {
                "native_smoke_passed": True,
                "native_result_sha256": cycle.digest(output / "native.json"),
                "status": "tested",
            }
        )
        cycle.write(journal, state)
        progress.observe("native-smoke-passed")
        if fault == "after-native-smoke":
            progress.phase("controller-loss")
            # This intentionally bypasses finally on the same tested VM; Actions still retains the journal.
            shutil.rmtree(private)
            os._exit(137)
        cycle.require(result["status"] == "passed", "native_smoke_failed")
    except BaseException as error:
        progress.failure(error)
        state["failure_code"] = cycle.failure_code(error)
        cycle.write(journal, state)
        raise
    finally:
        try:
            api.deadline = min(
                time.monotonic() + cycle.policy()["limits"]["cleanup_seconds"],
                deadline + cycle.policy()["limits"]["cleanup_seconds"],
            )
            progress.phase("cleanup", deadline=api.deadline)
            seen = api.discover(intent)
            state["allocation_resolved"] = (
                state["allocation_resolved"] or state["in_flight"] in seen
            )
            state["observed_before_cleanup"] = seen
            cycle.write(journal, state)
            receipt = api.cleanup(intent, api.deadline, known=state["resources"])
            receipt["allocation_resolved"] = state["allocation_resolved"]
            state.update({"status": "cleaned", "normal_cleanup": receipt})
            cycle.write(journal, state)
            cycle.require(state["allocation_resolved"], "uncertain_allocation_quarantined")
            progress.observe("resources-absent")
        finally:
            shutil.rmtree(private, ignore_errors=True)


def recovery_context(gh: GitHub) -> tuple[dict, dict]:
    enabled(recovery=True)
    identity = cycle.source_context("cleanup")
    gh.run(identity["run_id"], "cleanup")
    gh.guards(recovery=True)
    settings = cycle.configuration()
    if identity["event"] == "workflow_run":
        event = cycle.read(Path(os.environ["GITHUB_EVENT_PATH"]))
        trigger = event["workflow_run"]
        producer = gh.run(str(trigger["id"]), "creator")
        cycle.require(
            trigger["head_sha"] == producer["head_sha"]
            and trigger["workflow_id"] == producer["workflow_id"]
            and producer["status"] == "completed",
            "recovery_trigger",
        )
    return identity, settings


def resolve_lost(gh: GitHub, api: cycle.API, identity: dict) -> list:
    """Settle ended attempts whose intent is no longer listed, only through an empty project.

    The provider step starts after its intent was prepared, so the lease it could have created has
    expired and its cleanup budget has passed by the read. Anything present, an incomplete read or
    an attempt that has not ended keeps the refusal and deletes nothing.
    """
    lost = gh.lost()
    if not lost:
        return []
    limits = cycle.policy()["limits"]
    margin = dt.timedelta(seconds=limits["lease_seconds"] + limits["cleanup_seconds"])
    started = []
    for run, attempt in lost:
        cycle.require(
            run["status"] == "completed" or attempt < run["run_attempt"],
            "missing_allocation_intent",
        )
        try:
            started.append(gh.provider_started(run, attempt))
        except cycle.CycleError as error:
            # A failed read leaves the step start unreported.
            raise cycle.CycleError("missing_allocation_intent") from error
    now = cycle.utc()
    cycle.require(
        all(cycle.timestamp(now) >= start + margin for start in started),
        "missing_allocation_intent",
    )
    try:
        observed = api.project_inventory()
    except cycle.CycleError as error:
        # An incomplete or refused read cannot establish an empty project.
        raise cycle.CycleError("missing_allocation_intent") from error
    cycle.require(
        all(observed[key] == 0 for key in ("servers", "volumes", "ips", "ohtia_security_groups")),
        "missing_allocation_intent",
    )
    rows = [
        {
            "identity": {
                "repository": cycle.REPOSITORY,
                "source_sha": run["head_sha"],
                "workflow": cycle.policy()["qualification_workflow"],
                "run_id": str(run["id"]),
                "attempt": str(attempt),
                "event": run["event"],
            },
            "provider_started_at": start.isoformat().replace("+00:00", "Z"),
            "observed_at": now,
            "recovery": {"run_id": identity["run_id"], "attempt": identity["attempt"]},
            "observed": observed,
        }
        for (run, attempt), start in zip(lost, started, strict=True)
    ]
    validate_resolutions(rows)
    return rows


def prepare_recovery(gh: GitHub, output: Path) -> None:
    identity, settings = recovery_context(gh)
    ledger = gh.completed_ledger(settings)
    carried = ledger["leases"]
    pending = gh.intents(
        settings,
        previous=carried,
        unallocated=ledger.get("unallocated_attempts", []),
        resolutions=ledger.get("empty_project_resolutions", []),
        collect_lost=True,
    )
    cycle.require(
        len(pending) <= cycle.policy()["limits"]["managed_instances"], "recovery_pending_bound"
    )
    api = cycle.API(os.environ.get("SCW_SECRET_KEY", ""), settings, "cleanup")
    api.deadline = time.monotonic() + cycle.policy()["limits"]["cleanup_seconds"]
    resolutions = ledger.get("empty_project_resolutions", []) + resolve_lost(gh, api, identity)
    items = []
    for intent, producer in pending:
        cycle.validate_intent(intent, settings, historical=True)
        ended = attempt_ended(intent, producer)
        deferred = not ended and cycle.timestamp(cycle.utc()) < cycle.timestamp(
            intent["expires_at"]
        )
        if deferred:
            items.append({"intent": intent, "deferred": True})
            continue
        seen = api.discover(intent)
        journal = gh.journal(intent)
        prior = gh.prior_recovery(settings, intent, identity)
        known = dict(seen)
        for other in ((journal or {}).get("resources", {}), (prior or {}).get("known", {})):
            for kind, resource in other.items():
                cycle.require(
                    kind in cycle.KINDS and (kind not in known or known[kind] == resource),
                    "conflicting_resource_receipt",
                )
                known[kind] = cycle.identifier(resource)
        unattempted = ended and not gh.provider_attempted(
            producer, int(intent["identity"]["attempt"])
        )
        cycle.require(not unattempted or not seen, "unexpected_unattempted_resources")
        resolved = (
            unattempted
            or set(seen) == set(cycle.KINDS)
            or bool(prior and prior["allocation_resolved"])
        )
        if journal is not None:
            resolved = (
                resolved or journal["allocation_resolved"] or journal.get("in_flight") in seen
            )
        items.append(
            {
                "intent": intent,
                "deferred": False,
                "known": known,
                "allocation_resolved": resolved,
                "observed_full": set(seen) == set(cycle.KINDS)
                or bool(prior and prior["observed_full"]),
                "native_smoke_passed": bool(
                    (journal and journal.get("native_smoke_passed") is True)
                    or (prior and prior["native_smoke_passed"])
                ),
                "absorbed_artifacts": dict((prior or {}).get("absorbed_artifacts", {})),
            }
        )
    artifact_name = cycle.recovery_plan_name(
        pending[0][0]["nonce"] if pending else "empty", identity["attempt"]
    )
    value = {
        "version": 2,
        "artifact_name": artifact_name,
        "identity": identity,
        "project_binding": settings["project_binding"],
        "zone": settings["zone"],
        "policy_sha256": cycle.digest(cycle.POLICY_PATH),
        "carried": carried,
        "unallocated_attempts": gh.unallocated(),
        "empty_project_resolutions": resolutions,
        "items": items,
        "distribution_qualified": False,
    }
    output.mkdir(parents=True, exist_ok=False)
    cycle.write(output / "plan.json", value)
    if target := os.environ.get("GITHUB_OUTPUT"):
        with Path(target).open("a") as stream:
            stream.write("artifact_name=" + artifact_name + "\n")


def recover(gh: GitHub, output: Path, plan_file: Path) -> None:
    identity, settings = recovery_context(gh)
    planned = cycle.read(plan_file)
    cycle.require(
        planned["version"] == 2
        and planned["identity"] == identity
        and planned["project_binding"] == settings["project_binding"]
        and planned["zone"] == settings["zone"]
        and planned["distribution_qualified"] is False,
        "recovery_plan_identity",
    )
    cycle.require(
        len(planned["items"]) <= cycle.policy()["limits"]["managed_instances"],
        "recovery_pending_bound",
    )
    expected_name = cycle.recovery_plan_name(
        planned["items"][0]["intent"]["nonce"] if planned["items"] else "empty", identity["attempt"]
    )
    cycle.require(planned["artifact_name"] == expected_name, "recovery_plan_name")
    settled_records(
        {
            "leases": planned["carried"],
            "unallocated_attempts": planned["unallocated_attempts"],
            "empty_project_resolutions": planned["empty_project_resolutions"],
        }
    )
    artifacts = [a for a in gh.artifacts(identity["run_id"]) if a["name"] == expected_name]
    cycle.require(
        len(artifacts) == 1 and gh.artifact(artifacts[0], "plan.json") == planned,
        "published_recovery_plan_required",
    )
    api = cycle.API(os.environ.get("SCW_SECRET_KEY", ""), settings, "cleanup")
    leases = list(planned["carried"])
    deferred = [item["intent"]["nonce"] for item in planned["items"] if item["deferred"]]
    deadline = time.monotonic() + cycle.policy()["limits"]["cleanup_seconds"]
    api.deadline = deadline
    output.mkdir(parents=True, exist_ok=True)
    result = {
        "version": 1,
        "identity": identity,
        "project_binding": settings["project_binding"],
        "zone": settings["zone"],
        "policy_sha256": cycle.digest(cycle.POLICY_PATH),
        "status": "failed",
        "authority": "cleanup",
        "leases": leases,
        "unallocated_attempts": planned.get("unallocated_attempts", []),
        "empty_project_resolutions": planned["empty_project_resolutions"],
        "deferred": deferred,
        "checked_at": cycle.utc(),
        "distribution_qualified": False,
    }
    try:
        for item in planned["items"]:
            if item["deferred"]:
                continue
            intent = item["intent"]
            receipt = api.cleanup(intent, deadline, known=item["known"])
            receipt.update(
                {
                    "allocation_resolved": item["allocation_resolved"],
                    "independent_deletion_observed": item["observed_full"],
                    "native_smoke_passed": item["native_smoke_passed"],
                }
            )
            leases.append({"intent": intent, "receipt": receipt})
            cycle.write(output / "recovery.json", result)
        owned = set()
        for item in planned["items"]:
            owned.update(api.discover(item["intent"]).values())
        for kind in ("server", "root", "ip"):
            cycle.require(
                all(row["id"] in owned for row in api.objects(kind)), "untracked_project_resource"
            )
        result["status"] = (
            "passed"
            if all(row["receipt"]["allocation_resolved"] for row in leases)
            else "quarantined"
        )
    except BaseException as error:
        result["failure"] = cycle.failure_record(error, "recovery")
        raise
    finally:
        result["checked_at"] = cycle.utc()
        cycle.write(output / "recovery.json", result)
    cycle.require(result["status"] == "passed", "uncertain_allocation_quarantined")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operation",
        choices=(
            "install-cli",
            "ensure-recovery",
            "prepare",
            "run",
            "prepare-recovery",
            "recover",
            "backup-input",
            "restore",
        ),
    )
    parser.add_argument("--cli", type=Path)
    parser.add_argument("--profile", choices=list(cycle.policy()["profiles"]))
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--build", type=Path)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fault", choices=cycle.FAULTS, default="none")
    parser.add_argument("--dispatch", action="store_true")
    args = parser.parse_args()
    if args.output is None and args.operation != "ensure-recovery":
        parser.error("--output is required for this operation")
    try:
        if args.operation == "backup-input":
            from scaleway_restore import prepare_input

            cycle.require(args.archive is not None, "backup_archive_required")
            result = prepare_input(args.archive.absolute(), args.output.absolute())
            print(
                "Private restore input prepared; approve this checkpoint SHA-256: "
                + result["sha256"]
            )
        elif args.operation == "install-cli":
            cycle.source_context(
                "cleanup"
                if os.environ.get("GITHUB_WORKFLOW_REF", "").endswith(
                    "/installation-cleanup.yml@refs/heads/main"
                )
                else "creator"
            )
            install_cli(args.output.absolute())
        else:
            cycle.require(args.cli is not None, "cli_argument")
            gh = GitHub(args.cli.absolute())
            if args.operation == "ensure-recovery":
                ensure_recovery(gh, dispatch=args.dispatch)
            elif args.operation == "prepare":
                cycle.require(
                    args.profile is not None and args.build is not None, "prepare_arguments"
                )
                prepare(gh, args.profile, args.output.absolute(), args.build.absolute())
            elif args.operation == "run":
                cycle.require(
                    args.directory is not None and args.build is not None, "run_arguments"
                )
                execute(
                    gh,
                    args.directory.absolute(),
                    args.build.absolute(),
                    args.output.absolute(),
                    args.fault,
                )
            elif args.operation == "restore":
                from scaleway_restore import restore

                restore(gh, args.output.absolute())
            elif args.operation == "prepare-recovery":
                prepare_recovery(gh, args.output.absolute())
            else:
                cycle.require(args.plan is not None, "recovery_plan_required")
                recover(gh, args.output.absolute(), args.plan.absolute())
        return 0
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        RuntimeError,
        subprocess.SubprocessError,
    ) as error:
        print(
            "Disposable ARM qualification failed ("
            + cycle.failure_code(error)
            + "); inspect bounded artifacts and actual provider state.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
