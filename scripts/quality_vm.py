"""Run one pinned x64 distribution guest with mandatory KVM on a hosted Ubuntu VM."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import quality_delivery as delivery

ROOT = delivery.ROOT


def run(arguments: list, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(arg) for arg in arguments], check=True, timeout=kwargs.pop("timeout", 120), **kwargs
    )


def download(record: dict, destination: Path) -> None:
    algorithm = "sha256" if "sha256" in record else "sha512"
    hashed = hashlib.new(algorithm)
    with (
        urllib.request.urlopen(record["url"], timeout=60) as source,
        destination.open("xb") as target,
    ):
        while block := source.read(1024 * 1024):
            hashed.update(block)
            target.write(block)
    delivery.require(
        hashed.hexdigest() == record[algorithm],
        "Guest image checksum mismatch; no alternate image is admitted.",
    )


def cloud_config(profile: str, public_key: str) -> str:
    delivery.require(profile in {"fedora-44", "debian-13"}, "Unknown native guest.")
    packages = (
        [
            "python3",
            "git",
            "sudo",
            "curl",
            "gnome-shell",
            "gnome-session",
            "dbus-daemon",
            "dbus-x11",
            "btrfs-progs",
            "iproute",
            "rpm-build",
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
            "7zip",
            "unzip",
        ]
        if profile == "fedora-44"
        else [
            "python3",
            "git",
            "sudo",
            "curl",
            "gnome-shell",
            "gnome-session",
            "dbus-user-session",
            "libgtk-3-0t64",
            "libnss3",
            "libasound2t64",
            "libgbm1",
            "libxss1",
            "libxtst6",
            "libsecret-1-0",
            "libnotify4",
            "libatspi2.0-0",
            "apparmor",
            "apparmor-utils",
            "iproute2",
            "xdg-utils",
            "p7zip-full",
            "unzip",
        ]
    )
    commands = []
    if profile == "fedora-44":
        commands += [
            ["dnf", "-y", "--allowerasing", "install", "fedora-release-workstation"],
            [
                "bash",
                "-ceu",
                'test "$(cat /sys/block/vdb/serial)" = ohtia-quality-home; mkdir /tmp/quality-home; cp -a /home/ohtia-quality/. /tmp/quality-home/; mkfs.btrfs -f /dev/vdb; mount /dev/vdb /home/ohtia-quality; cp -a /tmp/quality-home/. /home/ohtia-quality/; chown -R ohtia-quality:ohtia-quality /home/ohtia-quality; restorecon -RF /home/ohtia-quality; test "$(getenforce)" = Enforcing',
            ],
        ]
    commands += [
        ["loginctl", "enable-linger", "ohtia-quality"],
        ["touch", "/var/lib/ohtia-quality-ready"],
    ]
    # JSON is YAML 1.2; cloud-init receives structured argv, not interpolated source text.
    value = {
        "users": [
            {
                "name": "ohtia-quality",
                "homedir": "/home/ohtia-quality",
                "shell": "/bin/bash",
                "lock_passwd": True,
                "sudo": "ALL=(ALL) NOPASSWD:ALL",
                "ssh_authorized_keys": [public_key.strip()],
            }
        ],
        "ssh_pwauth": False,
        "disable_root": True,
        "package_update": True,
        "packages": packages,
        "runcmd": commands,
    }
    return "#cloud-config\n" + json.dumps(value, indent=2) + "\n"


def qmp(socket_file: Path, request: str) -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(5)
        connection.connect(str(socket_file))
        stream = connection.makefile("rwb")
        json.loads(stream.readline())
        for name in ("qmp_capabilities", request):
            stream.write(json.dumps({"execute": name}).encode() + b"\n")
            stream.flush()
            while True:
                response = json.loads(stream.readline())
                if "return" in response:
                    break
                delivery.require("error" not in response, "Guest monitor command failed.")
        return response["return"]


def ssh_arguments(key: Path, known: Path, port: int) -> list:
    return [
        "ssh",
        "-T",
        "-i",
        str(key),
        "-p",
        str(port),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        f"UserKnownHostsFile={known}",
        "ohtia-quality@127.0.0.1",
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cell")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    child = None
    try:
        delivery.require(
            os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and platform.machine() == "x86_64"
            and Path("/dev/kvm").is_char_device()
            and os.access("/dev/kvm", os.R_OK | os.W_OK),
            "A native hosted x64 KVM device is required; ARM/TCG fallback is forbidden.",
        )
        release = platform.freedesktop_os_release()
        delivery.require(
            release.get("ID") == "ubuntu" and release.get("VERSION_ID") == "26.04",
            "Use the declared Ubuntu 26.04 VM host.",
        )
        planned = delivery.plan(delivery.identity())
        cell = next(item for item in planned["cells"] if item["id"] == args.cell)
        policy = delivery.read(ROOT / "config/quality/virtual-machines.json")
        guest = policy["guests"][cell["profile"]]
        delivery.require(
            cell["target"] == "linux-x64" and args.cell.endswith("-vm"),
            "Only the declared x64 VM cells are admitted.",
        )
        attempt = ROOT / "artifacts" / args.cell
        attempt.mkdir(parents=True)
        args.output.mkdir(parents=True)
        # Keep boot/provision failures attributable even when no guest report can be produced.
        delivery.write(
            args.output / "result.json",
            {"version": 1, "status": "failed", "cell": cell, "plan": planned, "packages": {}},
        )
        delivery.require(
            shutil.disk_usage(attempt).free >= 10 * 1024**3,
            "Insufficient hosted scratch capacity for native VM qualification.",
        )
        image = attempt / "base.qcow2"
        download(guest["image"], image)
        disk = attempt / "guest.qcow2"
        run(["qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", image, disk, "16G"])
        home = attempt / "home.qcow2"
        if cell["profile"] == "fedora-44":
            run(["qemu-img", "create", "-f", "qcow2", home, "10G"])
        key = attempt / "ssh-key"
        run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key])
        (attempt / "user-data").write_text(
            cloud_config(cell["profile"], (attempt / "ssh-key.pub").read_text())
        )
        (attempt / "meta-data").write_text(
            json.dumps(
                {
                    "instance-id": f"ohtia-{args.cell}-{planned['identity']['run_id']}-{planned['identity']['run_attempt']}",
                    "local-hostname": "ohtia-quality",
                }
            )
        )
        seed = attempt / "seed.iso"
        run(["cloud-localds", seed, attempt / "user-data", attempt / "meta-data"])
        bundle = attempt / "source.bundle"
        run(["git", "bundle", "create", bundle, "HEAD"], cwd=ROOT)
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        event = {key: event[key] for key in ("number", "pull_request", "after") if key in event}
        if "pull_request" in event:
            event["pull_request"] = {
                key: {"sha": event["pull_request"][key]["sha"]} for key in ("head", "base")
            }
        delivery.write(attempt / "event.json", event)
        names = (
            "GITHUB_EVENT_NAME",
            "GITHUB_REPOSITORY",
            "GITHUB_REF",
            "GITHUB_RUN_ID",
            "GITHUB_RUN_ATTEMPT",
            "GITHUB_SHA",
        )
        environment = {name: os.environ[name] for name in names}
        environment.update(
            {
                "GITHUB_EVENT_PATH": "/home/ohtia-quality/event.json",
                "GITHUB_ACTIONS": "true",
                "RUNNER_ENVIRONMENT": "github-hosted",
                "OHTIA_QUALITY_VM": args.cell,
                "XDG_SESSION_TYPE": "wayland",
                "XDG_CURRENT_DESKTOP": "GNOME",
            }
        )
        delivery.write(attempt / "environment.json", environment)
        with socket.socket() as allocation:
            allocation.bind(("127.0.0.1", 0))
            port = allocation.getsockname()[1]
        # A short socket path avoids AF_UNIX truncation in long checkout paths.
        import tempfile

        with tempfile.TemporaryDirectory(prefix="ohtia-kvm-") as qmp_directory:
            monitor = Path(qmp_directory) / "monitor.sock"
            argv = [
                "qemu-system-x86_64",
                "-accel",
                "kvm",
                "-cpu",
                "host",
                "-smp",
                str(policy["vcpus"]),
                "-m",
                str(policy["memory_mib"]),
                "-drive",
                f"file={disk},format=qcow2,if=virtio",
                "-drive",
                f"file={seed},media=cdrom,format=raw",
                "-device",
                "virtio-vga",
                "-display",
                "none",
                "-serial",
                f"file:{attempt / 'serial.log'}",
                "-monitor",
                "none",
                "-qmp",
                f"unix:{monitor},server=on,wait=off",
                "-netdev",
                f"user,id=net0,hostfwd=tcp:127.0.0.1:{port}-:22",
                "-device",
                "virtio-net-pci,netdev=net0",
                "-no-reboot",
            ]
            if home.exists():
                argv += ["-drive", f"file={home},format=qcow2,if=virtio,serial=ohtia-quality-home"]
            with (attempt / "qemu.log").open("wb") as log:
                child = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT)
                deadline = time.monotonic() + policy["deadline_seconds"]
                ssh = ssh_arguments(key, attempt / "known_hosts", port)
                while time.monotonic() < deadline:
                    delivery.require(child.poll() is None, "Native guest stopped before readiness.")
                    ready = subprocess.run(
                        ssh + ["test -f /var/lib/ohtia-quality-ready"],
                        capture_output=True,
                        timeout=10,
                    )
                    if ready.returncode == 0:
                        break
                    time.sleep(2)
                else:
                    raise delivery.DeliveryError("Guest setup exceeded its bounded deadline.")
                acceleration = qmp(monitor, "query-kvm")
                delivery.require(
                    acceleration.get("enabled") is True and acceleration.get("present") is True,
                    "The actual guest is not KVM accelerated.",
                )
                # TOFU is confined to this newly owned QEMU process and localhost-only forwarding.
                scp = [
                    "scp",
                    "-i",
                    str(key),
                    "-P",
                    str(port),
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "StrictHostKeyChecking=yes",
                    "-o",
                    f"UserKnownHostsFile={attempt / 'known_hosts'}",
                ]
                run(
                    scp
                    + [
                        bundle,
                        attempt / "event.json",
                        attempt / "environment.json",
                        ROOT / "tooling/quality-packaging/guest-run.py",
                        "ohtia-quality@127.0.0.1:/home/ohtia-quality/",
                    ],
                    timeout=180,
                )
                result = subprocess.run(
                    ssh + ["python3 /home/ohtia-quality/guest-run.py"],
                    timeout=max(1, deadline - time.monotonic()),
                    check=False,
                )
                # Always try to retain guest reports before interpreting the command exit.
                run(
                    scp
                    + [
                        "-r",
                        "ohtia-quality@127.0.0.1:/home/ohtia-quality/source/artifacts/quality-result/*",
                        str(args.output),
                    ],
                    timeout=180,
                )
                delivery.write(
                    args.output / "virtual-machine.json",
                    {
                        "version": 1,
                        "cell": cell,
                        "plan": planned,
                        "image": guest["image"],
                        "actual_image_sha256": delivery.digest(image),
                        "accelerator": acceleration,
                        "host_kernel": platform.release(),
                        "guest_exit": result.returncode,
                        "limitations": "Native x64 nested VM; virtual software graphics and powered cloud storage are not physical hardware/power-loss evidence. ARM guests remain outside this delivery.",
                    },
                )
                delivery.require(result.returncode == 0, "Guest native quality suite failed.")
                qmp(monitor, "system_powerdown")
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    child.wait(timeout=10)
                delivery.require(
                    delivery.plan(delivery.identity()) == planned,
                    "VM execution changed its source inputs.",
                )
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        StopIteration,
        subprocess.SubprocessError,
    ) as error:
        print(f"Native VM delivery failed: {error}", file=sys.stderr)
        return 1
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
