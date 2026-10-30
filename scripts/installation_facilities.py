"""Observe hosted Linux execution facilities without granting distribution qualification."""

from __future__ import annotations

import argparse
import contextlib
import errno
import json
import os
import platform
import re
import stat
import subprocess
import sys
from pathlib import Path

ARCHITECTURES = {"x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}
KVM_GET_API_VERSION = 0xAE00
KVM_CREATE_VM = 0xAE01
KVM_API_VERSION = 12
MAXIMUM_REPORT_BYTES = 8192


class FacilityError(Exception):
    """A bounded observation cannot be established."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise FacilityError(code)


def kvm_observation() -> dict:
    """Create and close an empty VM; this does not boot or qualify a guest."""
    result = {
        "status": "unavailable",
        "reason": "not_observed",
        "api_version": None,
        "empty_vm_created": False,
        "guest_booted": False,
    }
    try:
        # fcntl is Linux-only; importing this module remains portable for the test inventory.
        import fcntl

        with contextlib.ExitStack() as descriptors:
            system = os.open("/dev/kvm", os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
            descriptors.callback(os.close, system)
            require(stat.S_ISCHR(os.fstat(system).st_mode), "not_character_device")
            version = fcntl.ioctl(system, KVM_GET_API_VERSION, 0)
            result["api_version"] = version
            require(version == KVM_API_VERSION, "unsupported_api_version")
            vm = fcntl.ioctl(system, KVM_CREATE_VM, 0)
            require(type(vm) is int and vm >= 0, "invalid_vm_descriptor")
            descriptors.callback(os.close, vm)
        result.update(status="available", reason="empty_vm_closed", empty_vm_created=True)
    except FacilityError as error:
        result["reason"] = str(error)
    except OSError as error:
        result["reason"] = {
            errno.ENOENT: "device_missing",
            errno.EACCES: "access_denied",
            errno.EPERM: "access_denied",
            errno.ENODEV: "device_unavailable",
            errno.ENOTTY: "unsupported_device",
        }.get(error.errno, "system_call_failed")
    return result


def capabilities() -> int:
    """Read the current process's effective capabilities, failing closed on unknown data."""
    status = Path("/proc/self/status").read_text(encoding="ascii")
    fields = re.findall(r"^CapEff:\s+([0-9a-fA-F]{16})$", status, re.MULTILINE)
    require(len(fields) == 1, "effective_capabilities_unknown")
    return int(fields[0], 16)


def unattended_sudo() -> str:
    """Observe only a fixed no-op command and retain no sudo output or credentials."""
    try:
        result = subprocess.run(
            ["/usr/bin/sudo", "-n", "--", "/usr/bin/true"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    return (
        "allowed" if result.returncode == 0 else "denied" if result.returncode == 1 else "unknown"
    )


def hosted_identity(expected_architecture: str, checkout: str, tree: str) -> dict:
    require(platform.system() == "Linux", "linux_host_required")
    require(
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
        and os.environ.get("RUNNER_OS") == "Linux",
        "hosted_actions_context_required",
    )
    require(os.getuid() != 0 and os.geteuid() != 0, "unprivileged_process_required")
    machine = platform.machine().lower()
    architecture = ARCHITECTURES.get(machine)
    require(
        architecture == expected_architecture
        and {"X64": "x64", "ARM64": "arm64"}.get(os.environ.get("RUNNER_ARCH")) == architecture,
        "native_architecture_mismatch",
    )
    require(all(re.fullmatch(r"[a-f0-9]{40}", value) for value in (checkout, tree)), "git_identity")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    require(
        len(repository) <= 201 and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository),
        "repository_identity",
    )
    identifiers = {}
    for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        value = os.environ.get(name, "")
        require(bool(re.fullmatch(r"[1-9][0-9]{0,15}", value)), "run_identity")
        require(int(value) <= 2**53 - 1, "run_identity")
        identifiers[name] = int(value)
    release = platform.freedesktop_os_release()
    system_identity = {
        "distribution": release.get("ID", ""),
        "version": release.get("VERSION_ID", ""),
        "kernel": platform.release(),
    }
    require(
        all(re.fullmatch(r"[A-Za-z0-9._+-]{1,160}", value) for value in system_identity.values()),
        "host_release_unknown",
    )
    return {
        "operating_system": system_identity,
        "repository": repository,
        "checkout_sha": checkout,
        "tree_sha": tree,
        "run_id": identifiers["GITHUB_RUN_ID"],
        "run_attempt": identifiers["GITHUB_RUN_ATTEMPT"],
        "architecture": architecture,
        "python_version": platform.python_version(),
    }


def observe(role: str, expected_architecture: str, checkout: str, tree: str) -> dict:
    require(role in {"host", "account"}, "unknown_role")
    result = {
        "schema_version": 1,
        "scope": "hosted_linux_facility_observation",
        "role": role,
        "identity": hosted_identity(expected_architecture, checkout, tree),
        "distribution_qualified": False,
        "display_session_probed": False,
        "effective_uid": os.geteuid(),
        "effective_capabilities": capabilities(),
        "unattended_sudo": unattended_sudo(),
    }
    if role == "host":
        result["kvm"] = kvm_observation()
    return result


def accepted_observation(report: dict, require_kvm: bool) -> bool:
    """A usable observation never becomes installer or native-guest qualification."""
    if report["role"] == "account":
        return report["effective_capabilities"] == 0 and report["unattended_sudo"] == "denied"
    return not require_kvm or report["kvm"]["status"] == "available"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=("host", "account"))
    parser.add_argument("--expected-architecture", required=True, choices=("x64", "arm64"))
    parser.add_argument("--checkout-sha", required=True)
    parser.add_argument("--tree-sha", required=True)
    parser.add_argument("--require-kvm", action="store_true")
    args = parser.parse_args()
    try:
        require(not args.require_kvm or args.role == "host", "kvm_requires_host_role")
        report = observe(args.role, args.expected_architecture, args.checkout_sha, args.tree_sha)
        encoded = json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n"
        require(len(encoded.encode("utf-8")) <= MAXIMUM_REPORT_BYTES, "report_size")
        sys.stdout.write(encoded)
        return 0 if accepted_observation(report, args.require_kvm) else 1
    except (FacilityError, OSError) as error:
        code = str(error) if isinstance(error, FacilityError) else "observation_io_failed"
        print(f"Installation facility observation refused: {code}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
