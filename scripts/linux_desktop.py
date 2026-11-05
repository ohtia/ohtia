"""Linux desktop identities and package sets shared by every native qualification route."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path

DESKTOPS = ("gnome", "kde")
PROFILES = ("ubuntu-26.04", "fedora-44", "debian-13")
CURRENT_DESKTOP = {"gnome": "GNOME", "kde": "KDE"}
COMPOSITORS = {"gnome": "gnome-shell", "kde": "kwin_wayland"}
KDE_IDENTITY = {
    "ubuntu-26.04": "kubuntu-desktop",
    "debian-13": "task-kde-desktop",
    "fedora-44": "fedora-release-identity-kde-desktop",
}
FEDORA_VARIANTS = {"gnome": "workstation", "kde": "kde"}
# Executable names of display managers that the official desktop sets can install. Fedora's
# plasma-login-manager package runs `plasmalogin`.
DISPLAY_MANAGERS = (
    "gdm",
    "gdm3",
    "gdm-session-worker",
    "sddm",
    "sddm-helper",
    "plasmalogin",
    "lightdm",
)
# The kernel truncates /proc/<pid>/comm to 15 bytes.
COMM_BYTES = 15
KDE_EXPLICIT = {
    "apt-get": [
        "at-spi2-core",
        "xdg-utils",
        "xdg-desktop-portal-kde",
        "xsettingsd",
        "breeze-gtk-theme",
        "kde-config-gtk-style",
    ],
    "dnf": [
        "at-spi2-core",
        "xdg-utils",
        "xdg-desktop-portal-kde",
        "xsettingsd",
        "breeze-gtk-gtk3",
        "kde-gtk-config",
    ],
}
GNOME_SESSION_PACKAGES = ("gnome-shell", "gnome-session")
CELL = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class DesktopError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DesktopError(message)


def manager(profile: str) -> str:
    require(profile in PROFILES, "Unknown Linux distribution profile.")
    return "dnf" if profile == "fedora-44" else "apt-get"


def cell_id(target: str, profile: str, desktop: str | None = None) -> str:
    """Name a native cell `<target>-<profile>[-<desktop>]`, independent of where it runs."""
    parts = [target, profile.replace(".", "-")]
    if target.startswith("linux-"):
        require(desktop in DESKTOPS, "A Linux cell requires a declared desktop.")
        parts.append(desktop)
    else:
        require(desktop is None, "Only Linux cells declare a desktop.")
    value = "-".join(parts)
    require(CELL.fullmatch(value) is not None, "Unsafe native cell identifier.")
    return value


def kde_packages(profile: str, gnome_list: list[str]) -> list[str]:
    """Replace the GNOME session packages with the explicit KDE additions, keeping libraries."""
    explicit = KDE_EXPLICIT[manager(profile)]
    kept = [name for name in gnome_list if name not in GNOME_SESSION_PACKAGES]
    return [*kept, *(name for name in explicit if name not in kept)]


def kde_install_commands(profile: str, gnome_list: list[str]) -> list[list[str]]:
    """Install the official KDE set without recommended or weak dependencies, as root."""
    packages = kde_packages(profile, gnome_list)
    if manager(profile) == "apt-get":
        return [
            [
                "env",
                "DEBIAN_FRONTEND=noninteractive",
                "apt-get",
                "install",
                "--no-install-recommends",
                "-y",
                KDE_IDENTITY[profile],
                *packages,
            ]
        ]
    return [
        ["dnf", "-y", "install", "--allowerasing", KDE_IDENTITY[profile]],
        [
            "dnf",
            "-y",
            "install",
            "--setopt=install_weak_deps=False",
            "@kde-desktop",
            *packages,
        ],
    ]


def package_installed(profile: str, name: str) -> bool:
    """Ask the distribution's package database; an absent tool is not an installed package."""
    if manager(profile) == "apt-get":
        tool = shutil.which("dpkg-query")
        if tool is None:
            return False
        result = subprocess.run(
            [tool, "-W", "-f", "${db:Status-Status}", name],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        return result.returncode == 0 and result.stdout.strip() == "installed"
    tool = shutil.which("rpm")
    if tool is None:
        return False
    result = subprocess.run(
        [tool, "-q", name], capture_output=True, text=True, check=False, timeout=30
    )
    return result.returncode == 0


def installed_package_count(profile: str) -> int:
    if manager(profile) == "apt-get":
        command = ["dpkg-query", "-W", "-f", "${db:Status-Status}\n"]
        output = subprocess.run(
            command, capture_output=True, text=True, check=True, timeout=60
        ).stdout
        return sum(1 for line in output.splitlines() if line.strip() == "installed")
    output = subprocess.run(
        ["rpm", "-qa"], capture_output=True, text=True, check=True, timeout=60
    ).stdout
    return sum(1 for line in output.splitlines() if line.strip())


def identity_errors(
    profile: str,
    desktop: str,
    release: Mapping[str, str],
    env: Mapping[str, str],
    installed: Callable[[str], bool],
) -> list[str]:
    """Check the official distribution desktop identity and the session it provides."""
    errors = []
    if desktop not in DESKTOPS:
        return ["Unknown Linux desktop."]
    if profile == "fedora-44" and release.get("VARIANT_ID") != FEDORA_VARIANTS[desktop]:
        errors.append(
            "Fedora 44 KDE requires VARIANT_ID=kde."
            if desktop == "kde"
            else "Fedora 44 GNOME requires the Workstation identity."
        )
    identity = KDE_IDENTITY[profile]
    if desktop == "kde":
        if not installed(identity):
            errors.append(f"The official KDE identity package {identity} is not installed.")
        if installed("gnome-shell"):
            errors.append("A KDE cell must not have gnome-shell installed.")
        if env.get("XDG_CURRENT_DESKTOP") != "KDE":
            errors.append("A KDE cell requires XDG_CURRENT_DESKTOP=KDE.")
        if env.get("KDE_SESSION_VERSION") != "6":
            errors.append("A KDE cell requires KDE_SESSION_VERSION=6.")
    else:
        if installed(identity):
            errors.append(f"A GNOME cell must not have the KDE identity {identity} installed.")
        if not installed("gnome-shell"):
            errors.append("A GNOME cell requires gnome-shell.")
        if "GNOME" not in env.get("XDG_CURRENT_DESKTOP", "").split(":"):
            errors.append("A GNOME cell requires XDG_CURRENT_DESKTOP to include GNOME.")
    if env.get("XDG_SESSION_TYPE") != "wayland":
        errors.append("Linux cells require XDG_SESSION_TYPE=wayland.")
    if env.get("DISPLAY"):
        errors.append("Linux cells must not expose an X11 DISPLAY.")
    return errors


def require_identity(profile: str, desktop: str, release: Mapping[str, str]) -> None:
    errors = identity_errors(
        profile, desktop, release, os.environ, lambda name: package_installed(profile, name)
    )
    require(not errors, " ".join(errors))


def detect_desktop(profile: str, release: Mapping[str, str]) -> str:
    """Name the installed official desktop of a contributor machine, refusing a mixture."""
    kde = package_installed(profile, KDE_IDENTITY[profile])
    gnome = package_installed(profile, "gnome-shell")
    if profile == "fedora-44":
        variant = release.get("VARIANT_ID")
        require(
            variant in FEDORA_VARIANTS.values(),
            "Use Fedora 44 Workstation or Fedora 44 KDE; another Fedora edition is not a qualified route.",
        )
        selected = "kde" if variant == "kde" else "gnome"
        require(
            (kde and not gnome) if selected == "kde" else (gnome and not kde),
            "Install exactly one official desktop: Fedora KDE with "
            f"{KDE_IDENTITY[profile]} and without gnome-shell, or Fedora Workstation with "
            f"gnome-shell and without {KDE_IDENTITY[profile]}.",
        )
        return selected
    require(
        kde != gnome,
        "Install exactly one official desktop: GNOME, or KDE Plasma through "
        f"{KDE_IDENTITY[profile]} without gnome-shell.",
    )
    return "kde" if kde else "gnome"


def process_name(pid: int) -> str:
    return Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip()


def running_display_managers(proc: Path = Path("/proc")) -> list[str]:
    """Find display managers by executable name, also through the kernel-truncated comm."""
    found = set()
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        names = set()
        try:
            arguments = (entry / "cmdline").read_bytes().split(b"\0")
            if arguments and arguments[0]:
                names.add(os.path.basename(os.fsdecode(arguments[0])))
        except OSError:
            pass
        try:
            names.add((entry / "comm").read_text(encoding="utf-8").strip())
        except OSError:
            pass
        for manager in DISPLAY_MANAGERS:
            if manager in names or manager[:COMM_BYTES] in names:
                found.add(manager)
    return sorted(found)


def chromium_desktop(env: Mapping[str, str]) -> str:
    """Mirror Chromium's base/nix/xdg_util.cc classification of the desktop environment."""
    for name in env.get("XDG_CURRENT_DESKTOP", "").split(":"):
        if name == "GNOME":
            return "GNOME"
        if name == "KDE":
            return {"5": "KDE5", "6": "KDE6"}.get(env.get("KDE_SESSION_VERSION", ""), "KDE4")
    return "OTHER"


def process_arguments(pid: int) -> list[str]:
    raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    return [os.fsdecode(item) for item in raw.split(b"\0") if item]


def process_environment(pid: int) -> dict[str, str]:
    raw = Path(f"/proc/{pid}/environ").read_bytes()
    values = {}
    for item in raw.split(b"\0"):
        key, separator, value = item.partition(b"=")
        if separator:
            values[key.decode(errors="replace")] = value.decode(errors="replace")
    return values


def plasma_version() -> str | None:
    tool = shutil.which("plasmashell")
    if tool is None:
        return None
    result = subprocess.run(
        [tool, "--version"], capture_output=True, text=True, check=False, timeout=30
    )
    match = re.search(r"(\d+\.\d+\.\d+)", result.stdout)
    return match.group(1) if result.returncode == 0 and match else None
