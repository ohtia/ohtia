"""Build the unsigned release packages of one target with the exact root version.

The prepare-release workflow runs this entry point from the selected source,
without secrets, after ``scripts/workspace.py run build``. It reuses the package
construction of the continuous-integration quality builds and only changes the
version, which is the final root version rather than a development version.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import application_version
import quality_native
import release_platforms
import workspace

ROOT = release_platforms.ROOT


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def digest(file: Path) -> str:
    hashed = hashlib.sha256()
    with file.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            hashed.update(block)
    return hashed.hexdigest()


def build(target: str, output: Path) -> dict:
    platforms = release_platforms.load()
    platform, declared = release_platforms.build_of(platforms, target)
    release_platforms.require(
        workspace.target_id() == target, "The runner does not match the release target."
    )
    release_platforms.require(not output.exists(), "Use a fresh release build output.")
    version = application_version.root_version()
    commit, tree = git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")
    output.mkdir(parents=True)
    groups: dict[str | None, list[dict]] = {}
    for package in declared["packages"]:
        groups.setdefault(package.get("profile"), []).append(package)
    assets = []
    for profile, packages in groups.items():
        work = ROOT / "artifacts" / f"release-{target}-{profile or 'packages'}"
        cell = {
            "target": target,
            "profile": profile or "",
            "formats": [package["format"] for package in packages],
        }
        built = quality_native.construct_package(cell, work, version)
        for package in packages:
            extension = release_platforms.EXTENSIONS[package["format"]]
            found = sorted(built.glob(f"*.{extension}"))
            release_platforms.require(len(found) == 1, "Expected exactly one built package.")
            name = release_platforms.asset_name(version, target, package, platform["signed"])
            copied = output / name
            shutil.copyfile(found[0], copied)
            assets.append(
                {
                    "name": name,
                    "profile": package.get("profile"),
                    "format": package["format"],
                    "bytes": copied.stat().st_size,
                    "sha256": digest(copied),
                }
            )
    release_platforms.require(
        git("rev-parse", "HEAD") == commit
        and not git("status", "--porcelain", "--untracked-files=no"),
        "The release build changed its source.",
    )
    record = {
        "schema_version": 1,
        "version": version,
        "source": {"commit": commit, "tree": tree},
        "target": target,
        "assets": assets,
    }
    (output / "build.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        build(args.target, args.output.absolute())
    except (
        OSError,
        ValueError,
        KeyError,
        subprocess.SubprocessError,
    ) as error:
        print(f"Release build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
