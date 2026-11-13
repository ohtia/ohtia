"""Execute the common packaged probes in a root-admitted ordinary ARM guest account."""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import quality_delivery as delivery
import quality_native as native
import scaleway_cycle as cycle
import scaleway_evidence as evidence_archive
import workspace


def guard() -> dict:
    file = cycle.GUARD
    info = file.lstat()
    cycle.require(
        info.st_uid == 0
        and not info.st_mode & 0o022
        and file.parent.stat().st_uid == 0
        and not file.parent.stat().st_mode & 0o022,
        "guest_guard_owner",
    )
    value = cycle.read(file, 65536)
    cycle.require(
        type(value.get("ready_at_epoch")) is int and value["ready_at_epoch"] > 0, "guest_not_ready"
    )
    cycle.require(
        cycle.timestamp(value["intent"]["expires_at"]) > cycle.timestamp(cycle.utc()),
        "guest_lease_expired",
    )
    cycle.require(
        value["intent"]["policy_sha256"] == cycle.digest(cycle.POLICY_PATH), "guest_policy"
    )
    cycle.validate_build(value["intent"]["build"])
    cycle.require(
        platform.system() == "Linux" and platform.machine() == "aarch64", "guest_architecture"
    )
    return value


def admit_environment(environment: dict) -> None:
    """Allow the exact unsigned-build switch while refusing credential namespaces."""
    for key, value in environment.items():
        cycle.require(
            (key == "CSC_IDENTITY_AUTO_DISCOVERY" and value == "false")
            or (
                not key.startswith(("SCW_", "GH_TOKEN", "GITHUB_TOKEN", "AWS_", "CSC_"))
                and key != "SSH_AUTH_SOCK"
            ),
            "guest_credentials",
        )


def admit_guest(selected: dict) -> dict:
    import pwd

    value = guard()
    cycle.require(selected == cycle.intent_cell(value["intent"]), "guest_cell")
    account = pwd.getpwuid(os.getuid())
    cycle.require(
        account.pw_name == "ohtia"
        and os.getuid() != 0
        and os.getgid() == account.pw_gid
        and os.getgroups() == [account.pw_gid],
        "guest_account",
    )
    cycle.require(
        Path.home() == Path("/home/ohtia") and Path.home().stat().st_uid == os.getuid(),
        "guest_home",
    )
    status = dict(
        line.split(":", 1)
        for line in Path("/proc/self/status").read_text().splitlines()
        if ":" in line
    )
    cycle.require(
        all(int(status[k].strip(), 16) == 0 for k in ("CapInh", "CapPrm", "CapEff", "CapAmb")),
        "guest_capabilities",
    )
    sudo = subprocess.run(
        ["sudo", "-n", "-l"],
        env=cycle.process_environment(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=5,
        check=False,
    )
    cycle.require(sudo.returncode != 0, "guest_sudo_permission")
    admit_environment(dict(os.environ))
    return value


def os_packages() -> dict:
    """Bind the root-produced pre-installation package list into the native result."""
    file = cycle.GUEST_INVENTORY
    info = file.lstat()
    maximum = cycle.policy()["limits"]["package_inventory_bytes"]
    cycle.require(
        stat.S_ISREG(info.st_mode)
        and info.st_uid == 0
        and info.st_nlink == 1
        and not info.st_mode & 0o022
        and 0 < info.st_size <= maximum,
        "package_inventory_identity",
    )
    with file.open("rb") as source:
        data = source.read(maximum + 1)
    cycle.require(len(data) == info.st_size, "package_inventory_identity")
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def seal() -> None:
    cycle.require(os.getuid() == 0, "package_seal_requires_root")
    value = guard()
    selected = cycle.intent_cell(value["intent"])
    payload = Path("/opt/ohtia")
    cycle.require(payload.is_dir() and not payload.is_symlink(), "package_install_missing")
    delivery.write(payload / "prepared.json", native.prepared_record(payload, selected))


def collect(output: Path, record: str) -> bytes:
    """Read a fixed completed report directly from the still-live private scratch tree."""
    identity = guard()["intent"]["identity"]
    if record == "compositor":
        file = compositor_log(cycle.intent_cell(guard()["intent"])["desktop"])
        info = file.lstat()
        cycle.require(
            file.resolve() == file and stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
            "guest_collection_file",
        )
        with file.open("rb") as source:
            return source.read(cycle.policy()["limits"]["maximum_json_bytes"])
    context = cycle.read(output / "context.json")
    cycle.require(
        context["owner"] == identity["run_id"] and context["attempt"] == identity["attempt"],
        "guest_collection_identity",
    )
    profile = Path(context["profile"])
    cycle.require(
        profile.is_absolute()
        and profile.resolve() == profile
        and profile.name == "runtime-profile.json"
        and profile.parent.parent == Path.home()
        and profile.parent.name.startswith(".ohtia-"),
        "guest_collection_profile",
    )
    data = cycle.read(profile)
    cycle.require(Path(data["scratch_root"]) == profile.parent, "guest_collection_profile")
    receipts = {
        "runtime": "receipt.json",
        "storage": "storage-receipt.json",
        "diagnostics": "diagnostic-receipt.json",
        "startup": "startup-receipt.json",
    }
    locations = {
        suite: profile.parent / "evidence" / suite / filename
        for suite, filename in receipts.items()
    }
    locations.update(
        {
            suite + "-supervision": profile.parent / "evidence" / (suite + "-supervision.json")
            for suite in receipts
        }
    )
    cycle.require(record in locations, "guest_collection_record")
    file = locations[record]
    info = file.lstat()
    cycle.require(
        file.resolve() == file and stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
        "guest_collection_file",
    )
    maximum = cycle.policy()["limits"]["maximum_json_bytes"]
    cycle.require(info.st_size <= maximum, "guest_collection_bound")
    with file.open("rb") as source:
        payload = source.read(maximum + 1)
    cycle.decode(payload)
    return payload


def smoke(output: Path) -> None:
    value = guard()
    selected = cycle.intent_cell(value["intent"])
    value = admit_guest(selected)
    identity = value["intent"]["identity"]
    os.environ.update(
        {"GITHUB_RUN_ID": identity["run_id"], "GITHUB_RUN_ATTEMPT": identity["attempt"]}
    )
    cycle.require(not output.exists(), "fresh_guest_output")
    output.mkdir()
    context = output / "context.json"
    native.command([workspace.node_path(), "tooling/quality-profile.mjs", "prepare-cloud", context])
    profile = Path(delivery.read(context)["profile"])
    prepared = Path("/opt/ohtia")
    original = cycle.digest(prepared / "prepared.json")
    host = native.host_matches(selected, external_guard=value)
    evidence = Path(delivery.read(profile)["scratch_root"]) / "evidence"
    evidence.mkdir()
    result = {
        "version": 1,
        "status": "failed",
        "cell": selected,
        "identity": identity,
        "build": value["intent"]["build"],
        "host": host,
        "os_packages": os_packages(),
        "distribution_qualified": False,
        "publisher_signed": False,
    }
    cycle.write(output / "result.json", result)
    try:
        suites, observation = native.smoke(profile, prepared, evidence, selected)
    except Exception:
        native.retain_failed_reports(evidence, output / "evidence")
        raise
    shutil.copytree(evidence, output / "evidence")
    cycle.require(
        cycle.digest(prepared / "prepared.json") == original
        and native.prepared_record(prepared, selected) == delivery.read(prepared / "prepared.json"),
        "installed_package_changed",
    )
    runtime = delivery.read(suites["runtime"])
    observed = next(
        case["observed"]
        for case in runtime["cases"]
        if case["id"] == "native-executable-identities"
    )
    cycle.require(
        observed["architecture"] == "arm64" and observed["platform"] == "linux",
        "guest_process_architecture",
    )
    result.update(
        {
            "status": "passed",
            "native": evidence_archive.pack(output, observation),
            "prepared_sha256": original,
            "addon_sha256": cycle.digest(
                prepared / delivery.read(prepared / "prepared.json")["app"] / "native/binding.node"
            ),
            "suites": {
                name: {"sha256": cycle.digest(file), "bytes": file.stat().st_size}
                for name, file in suites.items()
            },
        }
    )
    cycle.write(output / "result.json", result)
    native.command([workspace.node_path(), "tooling/quality-profile.mjs", "retain-cloud", context])


def compositor_log(desktop: str) -> Path:
    name = {"gnome": "gnome", "kde": "plasma"}[desktop]
    return Path.home() / f".ohtia-qualification-{name}.log"


def plasma_display(value: dict, output: Path) -> int:
    """KDE cells run the smoke inside the shared Plasma launcher on a private bus."""
    runtime = Path(tempfile.mkdtemp(prefix="kde-", dir=Path.home()))
    log = compositor_log("kde")
    env = display_environment(value["intent"]["identity"], runtime)
    env.pop("DBUS_SESSION_BUS_ADDRESS", None)
    seconds = cycle.policy()["limits"]["test_seconds"]
    try:
        result = subprocess.run(
            [
                "dbus-run-session",
                "--",
                sys.executable,
                str(cycle.ROOT / "scripts/plasma_session.py"),
                "run",
                "--runtime",
                str(runtime),
                "--log",
                str(log),
                "--timeout",
                str(seconds),
                "--",
                sys.executable,
                str(Path(__file__).absolute()),
                "smoke",
                str(output),
            ],
            cwd=cycle.ROOT,
            env=env,
            timeout=seconds + 120,
            check=False,
        )
        return result.returncode
    finally:
        output.mkdir(exist_ok=True)
        if log.is_file():
            with log.open("rb") as incoming, (output / "compositor.log").open("xb") as target:
                target.write(incoming.read(cycle.policy()["limits"]["maximum_json_bytes"]))


def display_environment(identity: dict, runtime: Path) -> dict:
    env = {
        **native.build_environment(),
        "XDG_RUNTIME_DIR": str(runtime),
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path={runtime / 'bus'}",
        "XDG_SESSION_TYPE": "wayland",
        "XDG_CURRENT_DESKTOP": "GNOME",
        "LIBGL_ALWAYS_SOFTWARE": "1",
        "GITHUB_RUN_ID": identity["run_id"],
        "GITHUB_RUN_ATTEMPT": identity["attempt"],
    }
    env.pop("DISPLAY", None)
    return env


def display(output: Path) -> int:
    value = guard()
    selected = cycle.intent_cell(value["intent"])
    admit_guest(selected)
    if selected["desktop"] == "kde":
        return plasma_display(value, output)
    runtime = Path(f"/run/user/{os.getuid()}")
    env = display_environment(value["intent"]["identity"], runtime)

    def run(arguments, timeout=10):
        return subprocess.run(
            arguments,
            cwd=cycle.ROOT,
            env=env,
            check=True,
            timeout=timeout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    run(["systemctl", "--user", "daemon-reload"])
    run(["systemctl", "--user", "start", "dbus.socket"])
    bus = runtime / "bus"
    cycle.require(bus.is_socket() and bus.stat().st_uid == os.getuid(), "guest_user_bus")
    run(["gdbus", "wait", "--session", "--timeout=8", "org.freedesktop.systemd1"])
    variables = [
        "DBUS_SESSION_BUS_ADDRESS",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
    ]
    run(["dbus-update-activation-environment", "--systemd", *variables])
    log = compositor_log("gnome")
    log.touch(mode=0o600, exist_ok=False)
    try:
        run(
            [
                "systemd-run",
                "--user",
                "--unit=ohtia-qualification-gnome",
                "--property=Type=notify",
                "--property=TimeoutStartSec=60s",
                "--property=TimeoutStopSec=10s",
                f"--property=StandardOutput=append:{log}",
                "--property=StandardError=inherit",
                "--",
                "/usr/bin/gnome-shell",
                "--headless",
                "--wayland",
                "--virtual-monitor",
                "1280x720",
            ],
            timeout=65,
        )
        compositor_pid = subprocess.run(
            [
                "systemctl",
                "--user",
                "show",
                "--property=MainPID",
                "--value",
                "ohtia-qualification-gnome.service",
            ],
            env=env,
            text=True,
            capture_output=True,
            check=True,
            timeout=10,
        ).stdout.strip()
        if (
            not compositor_pid.isascii()
            or not compositor_pid.isdecimal()
            or int(compositor_pid) <= 0
        ):
            cycle.require(False, "guest_compositor_identity")
        env["OHTIA_NATIVE_COMPOSITOR_PID"] = compositor_pid
        sockets = [
            file
            for file in runtime.glob("wayland-*")
            if file.is_socket() and file.stat().st_uid == os.getuid()
        ]
        cycle.require(len(sockets) == 1, "guest_wayland_socket")
        env["WAYLAND_DISPLAY"] = sockets[0].name
        run(["dbus-update-activation-environment", "--systemd", *variables, "WAYLAND_DISPLAY"])
        run(
            [
                "systemd-run",
                "--user",
                "--unit=ohtia-qualification-session",
                "--property=Type=oneshot",
                "--property=RemainAfterExit=yes",
                "--property=BindsTo=graphical-session.target",
                "--property=After=graphical-session.target",
                "--",
                "/usr/bin/true",
            ]
        )
        run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.freedesktop.portal.Desktop",
                "--object-path",
                "/org/freedesktop/portal/desktop",
                "--method",
                "org.freedesktop.portal.Settings.ReadAll",
                "['org.freedesktop.appearance']",
            ]
        )
        run(["systemctl", "--user", "is-active", "--quiet", "ohtia-qualification-gnome.service"])
        result = subprocess.run(
            [sys.executable, str(Path(__file__).absolute()), "smoke", str(output)],
            cwd=cycle.ROOT,
            env=env,
            timeout=cycle.policy()["limits"]["test_seconds"],
            check=False,
        )
        return result.returncode
    finally:
        failed = sys.exception() is not None
        cleanup_failed = False
        for unit in (
            "ohtia-qualification-session.service",
            "ohtia-qualification-gnome.service",
        ):
            try:
                run(["systemctl", "--user", "stop", unit], timeout=15)
            except (OSError, subprocess.SubprocessError):
                cleanup_failed = True
        output.mkdir(exist_ok=True)
        with log.open("rb") as incoming, (output / "compositor.log").open("xb") as target:
            target.write(incoming.read(cycle.policy()["limits"]["maximum_json_bytes"]))
        cycle.require(failed or not cleanup_failed, "guest_display_cleanup")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("seal", "display", "smoke", "collect"))
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("record", nargs="?")
    args = parser.parse_args()
    output_admitted = False
    try:
        if args.operation == "seal":
            seal()
            return 0
        cycle.require(args.output is not None, "guest_output_required")
        output = args.output.absolute()
        cycle.require(
            output == Path.home() / "result" and output.resolve() == output, "guest_output_path"
        )
        output_admitted = True
        admit_guest(cycle.intent_cell(guard()["intent"]))
        if args.operation == "collect":
            sys.stdout.buffer.write(collect(output, args.record))
            return 0
        if args.operation == "display":
            return display(output)
        smoke(output)
        return 0
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        StopIteration,
        subprocess.SubprocessError,
    ) as error:
        if output_admitted:
            try:
                output.mkdir(exist_ok=True)
                failure = output / f"{args.operation}-failure.json"
                if not failure.exists() and failure.parent.resolve() == failure.parent:
                    cycle.write(failure, cycle.failure_record(error, args.operation))
            except OSError:
                pass
        print(
            "Native disposable guest checks failed (" + cycle.failure_code(error) + ").",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
