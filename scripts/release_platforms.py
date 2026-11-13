"""Read the declared release platforms and name their packages.

Both the build entry point of the selected source and the release jobs of the
workflow revision use these names, so a package that the declaration does not
expect cannot enter the unpublished release.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECLARATION = Path("config/release/platforms.json")
EXTENSIONS = {"deb": "deb", "rpm": "rpm", "nsis": "exe", "dmg": "dmg", "zip": "zip"}
PLATFORM_TARGETS = {
    "linux": {"linux-x64", "linux-arm64"},
    "windows": {"win32-x64", "win32-arm64"},
    "macos": {"darwin-x64", "darwin-arm64"},
}
LINUX_PROFILES = {"ubuntu-26.04": "deb", "debian-13": "deb", "fedora-44": "rpm"}
RUNNER = re.compile(r"[a-z0-9][a-z0-9.-]*")


class PlatformError(ValueError):
    """The release platform declaration is missing or invalid."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PlatformError(message)


def load(root: Path | None = None) -> list[dict]:
    """Return the validated platform list of the declaration under ``root``."""
    try:
        value = json.loads((root or ROOT).joinpath(DECLARATION).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise PlatformError("The release platform declaration cannot be read as JSON.") from error
    require(
        isinstance(value, dict)
        and set(value) == {"schema_version", "platforms"}
        and value["schema_version"] == 1
        and isinstance(value["platforms"], list),
        "Unsupported release platform declaration.",
    )
    platforms = value["platforms"]
    require(
        [p.get("id") if isinstance(p, dict) else None for p in platforms] == list(PLATFORM_TARGETS),
        "The release declares Linux, Windows and macOS, in that order.",
    )
    targets = set()
    for platform in platforms:
        require(
            set(platform) == {"id", "signed", "builds"}
            and type(platform["signed"]) is bool
            and isinstance(platform["builds"], list)
            and platform["builds"],
            "Invalid release platform.",
        )
        for build in platform["builds"]:
            require(
                isinstance(build, dict)
                and set(build) == {"target", "runner", "packages"}
                and build["target"] in PLATFORM_TARGETS[platform["id"]]
                and build["target"] not in targets
                and isinstance(build["runner"], str)
                and RUNNER.fullmatch(build["runner"]) is not None
                and isinstance(build["packages"], list)
                and build["packages"],
                "Invalid release build.",
            )
            targets.add(build["target"])
            seen = set()
            for package in build["packages"]:
                linux = platform["id"] == "linux"
                require(
                    isinstance(package, dict)
                    and set(package) == ({"profile", "format"} if linux else {"format"})
                    and package["format"] in EXTENSIONS
                    and (not linux or LINUX_PROFILES.get(package["profile"]) == package["format"])
                    and (package.get("profile"), package["format"]) not in seen,
                    "Invalid release package.",
                )
                seen.add((package.get("profile"), package["format"]))
    return platforms


def asset_name(version: str, target: str, package: dict, signed: bool) -> str:
    """Name a release asset; an unsigned package always carries ``unsigned``."""
    parts = ["ohtia", version, target]
    if "profile" in package:
        parts.append(package["profile"])
    if not signed:
        parts.append("unsigned")
    return "-".join(parts) + "." + EXTENSIONS[package["format"]]


def expected_assets(platforms: list[dict], version: str) -> list[dict]:
    """List every asset the declaration requires for one version, in declaration order."""
    return [
        {
            "name": asset_name(version, build["target"], package, platform["signed"]),
            "platform": platform["id"],
            "target": build["target"],
            "profile": package.get("profile"),
            "format": package["format"],
            "signed": platform["signed"],
        }
        for platform in platforms
        for build in platform["builds"]
        for package in build["packages"]
    ]


def build_of(platforms: list[dict], target: str) -> tuple[dict, dict]:
    """Return the platform and build that declare ``target``."""
    for platform in platforms:
        for build in platform["builds"]:
            if build["target"] == target:
                return platform, build
    raise PlatformError("The release declares no build for this target.")
