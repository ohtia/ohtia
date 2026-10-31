"""Build one unsigned ARM package and a confined native probe harness without cloud keys."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import tarfile
from pathlib import Path

import quality_native
import scaleway_cycle as cycle


def included(relative: Path) -> bool:
    parts = relative.parts
    if not parts or any(
        p in {".git", ".cache", ".venv", "__pycache__"} or p.startswith(".env") for p in parts
    ):
        return False
    if parts[0] in {"scripts", "tooling", "config", "packages", "node_modules"}:
        return True
    if parts[0] == "tools":
        return len(parts) > 1 and parts[1] == "desktop-probes"
    return parts[0] == ".tooling" and len(parts) > 1 and parts[1] in {"node", "python"}


def harness(root: Path, destination: Path) -> None:
    """Archive selected source/dependencies; links must remain in the admitted tree."""
    limits = cycle.policy()["limits"]
    count, total = 0, 0
    with tarfile.open(destination, "x:gz", dereference=False) as archive:
        for parent, folders, files in os.walk(root, followlinks=False):
            relative = Path(parent).relative_to(root)
            folders[:] = sorted(
                d
                for d in folders
                if included(relative / d) or (relative == Path(".") and d in {".tooling", "tools"})
            )
            for name in sorted(folders + files):
                file = Path(parent) / name
                path = file.relative_to(root)
                if not included(path):
                    continue
                info = file.lstat()
                cycle.require(
                    stat.S_ISDIR(info.st_mode)
                    or stat.S_ISREG(info.st_mode)
                    or stat.S_ISLNK(info.st_mode),
                    "harness_special_file",
                )
                if stat.S_ISLNK(info.st_mode):
                    target = file.resolve(strict=True)
                    cycle.require(
                        target.is_relative_to(root) and included(target.relative_to(root)),
                        "harness_link_escape",
                    )
                    cycle.require(
                        not Path(os.readlink(file)).is_absolute(), "harness_absolute_link"
                    )
                elif stat.S_ISREG(info.st_mode):
                    total += info.st_size
                count += 1
                cycle.require(
                    count <= limits["maximum_harness_files"]
                    and total <= limits["maximum_harness_expanded_bytes"],
                    "harness_expanded_bound",
                )
                entry = archive.gettarinfo(str(file), arcname=path.as_posix())
                entry.uid = entry.gid = entry.mtime = 0
                entry.uname = entry.gname = ""
                entry.mode = 0o700 if info.st_mode & 0o111 or file.is_dir() else 0o600
                if stat.S_ISREG(info.st_mode):
                    # pnpm legitimately hardlinks its store. Copy file bytes, never tar hardlink authority.
                    entry.type, entry.linkname, entry.size = tarfile.REGTYPE, "", info.st_size
                    with file.open("rb") as stream:
                        archive.addfile(entry, stream)
                else:
                    archive.addfile(entry)
    cycle.require(
        destination.stat().st_size <= limits["maximum_harness_bytes"], "harness_compressed_bound"
    )


def build(profile: str, output: Path) -> dict:
    identity = cycle.source_context("build")
    cycle.require(
        not any(
            k.startswith("SCW_")
            or k in {"CSC_KEY_PASSWORD", "WIN_CSC_KEY_PASSWORD", "APPLE_ID_PASSWORD"}
            for k in os.environ
        ),
        "credentialed_builder",
    )
    selected = cycle.cell(profile)
    cycle.require(not output.exists(), "fresh_build_output")
    output.mkdir(parents=True)
    version = f"0.0.0-dev.{identity['run_id']}.{identity['attempt']}"
    work = cycle.ROOT / "artifacts" / "scaleway-package"
    packages = quality_native.construct_package(selected, work, version)
    found = list(packages.glob("*." + selected["formats"][0]))
    cycle.require(len(found) == 1, "package_count")
    package = output / found[0].name
    shutil.copyfile(found[0], package)
    bundle = output / "harness.tar.gz"
    harness(cycle.ROOT, bundle)

    def artifact(file):
        return {"file": file.name, "bytes": file.stat().st_size, "sha256": cycle.digest(file)}

    value = {
        "version": 1,
        "identity": identity,
        "profile": profile,
        "cell": selected,
        "application_version": version,
        "source_tree": cycle.command(["git", "rev-parse", "HEAD^{tree}"]).stdout.decode().strip(),
        "policy_sha256": cycle.digest(cycle.POLICY_PATH),
        "package": artifact(package),
        "harness": artifact(bundle),
        "distribution_qualified": False,
        "publisher_signed": False,
    }
    cycle.validate_build(value)
    cycle.require(
        cycle.source_context("build") == identity
        and not cycle.command(["git", "status", "--porcelain", "--untracked-files=no"]).stdout,
        "build_changed_source",
    )
    cycle.write(output / "build.json", value)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", choices=list(cycle.policy()["profiles"]))
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        build(args.profile, args.output.absolute())
        return 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        print("ARM qualification package construction failed; no cloud resources were requested.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
