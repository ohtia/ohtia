"""Linux distribution profiles declared by the target manifest.

A profile id is `<distribution>-<version>`, the `ID` and `VERSION_ID` fields of the
distribution's os-release file. Ohtia supports the two most recent Fedora releases (ADR-0056),
so Fedora profiles are added and retired only in `config/desktop/targets.json`; code asks this
module instead of naming a release.
"""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ROOT / "config/desktop/targets.json"
PROFILE = re.compile(r"(ubuntu|debian|fedora)-([0-9]+(?:\.[0-9]+)?)")


@cache
def declared() -> tuple[str, ...]:
    """Return every Linux distribution profile id of the target manifest, in declared order."""
    manifest = json.loads(TARGETS.read_text(encoding="utf-8"))
    ids: list[str] = []
    for target in manifest["targets"]:
        if target.get("os") != "linux":
            continue
        for profile in target.get("distribution_profiles", []):
            if profile["id"] not in ids:
                ids.append(profile["id"])
    return tuple(ids)


def parse(profile: str) -> tuple[str, str]:
    """Return the os-release `ID` and `VERSION_ID` that a profile id names."""
    match = PROFILE.fullmatch(profile)
    if match is None:
        raise ValueError(f"Invalid Linux distribution profile {profile!r}.")
    return match[1], match[2]


def distribution(profile: str) -> str:
    return parse(profile)[0]


def version(profile: str) -> str:
    return parse(profile)[1]


def is_fedora(profile: str) -> bool:
    return PROFILE.fullmatch(profile) is not None and distribution(profile) == "fedora"


def fedora() -> tuple[str, ...]:
    """Return the declared Fedora profiles, oldest first."""
    return tuple(sorted((p for p in declared() if is_fedora(p)), key=lambda p: int(version(p))))


def package_format(profile: str) -> str:
    """Return the native package format of a profile: RPM for Fedora, DEB otherwise."""
    return "rpm" if is_fedora(profile) else "deb"


def native_release(profile: str) -> str:
    """Return the package revision: `1`, with the Fedora distribution tag on RPM, as in `1.fc<release>`."""
    return f"1.fc{version(profile)}" if is_fedora(profile) else "1"


def package_tool(profile: str) -> str:
    """Return the low-level package query tool of a profile."""
    return "rpm" if is_fedora(profile) else "dpkg"


def kernel_marker(profile: str) -> str:
    """Return the text that a vendor kernel release of a Fedora or Debian profile contains."""
    name, number = parse(profile)
    if name == "fedora":
        return f".fc{number}"
    if name == "debian":
        return f"deb{number}"
    raise ValueError("Only Fedora and Debian profiles name their kernel build.")


def os_release_name(profile: str) -> str:
    """Return the profile's distribution and release for messages, such as `Fedora 45`."""
    name, number = parse(profile)
    return f"{name.capitalize()} {number}"
