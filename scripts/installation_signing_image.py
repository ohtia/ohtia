"""Assemble a minimal, checksum-pinned context for the independently administered signer."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

from workspace import ROOT, download, unpack

MANIFEST = ROOT / "config/installation/signing-image.json"


def validate_manifest(value: dict) -> None:
    if (
        set(value) != {"schema_version", "base_image", "packages", "license_fallbacks"}
        or value["schema_version"] != 1
    ):
        raise ValueError("Invalid signing image manifest.")
    if not re.fullmatch(r"docker\.io/library/debian@sha256:[a-f0-9]{64}", value["base_image"]):
        raise ValueError("Invalid signing image base.")
    names = set()
    for item in value["packages"]:
        if set(item) != {"file", "url", "sha256"}:
            raise ValueError("Invalid signing image package.")
        name = item["file"]
        parsed = urlsplit(item["url"])
        if (
            Path(name).name != name
            or not name.endswith(("_amd64.deb", "_all.deb"))
            or name in names
            or parsed.scheme != "https"
            or parsed.hostname != "deb.debian.org"
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or unquote(parsed.path.rsplit("/", 1)[-1]) != name
            or len(item["sha256"]) != 64
            or any(c not in "0123456789abcdef" for c in item["sha256"])
        ):
            raise ValueError("Invalid signing image package binding.")
        names.add(name)
    if not names:
        raise ValueError("Empty signing image package closure.")
    identities = set()
    for row in value["license_fallbacks"]:
        if (
            set(row) != {"package", "license", "source_package", "file", "sha256"}
            or row["package"] in identities
            or not all(
                re.fullmatch(r"(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+@[A-Za-z0-9.+_-]+", row[key])
                for key in ("package", "source_package")
            )
            or not isinstance(row["license"], str)
            or not row["license"]
            or Path(row["file"]).name != row["file"]
            or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
        ):
            raise ValueError("Invalid dependency notice fallback.")
        identities.add(row["package"])


def isolated_runtime(context: Path, temporary: Path, tools: dict) -> str:
    """Bundle from fresh frozen dependencies using checksum-verified Node and pnpm executables."""
    artifact = tools["pnpm"]["artifacts"]["linux-x64"]
    archive = ROOT / ".cache/downloads" / Path(urlsplit(artifact["url"]).path).name
    download(artifact, archive)
    pnpm_directory = temporary / "pnpm"
    unpack(archive, pnpm_directory)
    executable = pnpm_directory / "package/pnpm"
    if not executable.is_file():
        raise ValueError("Pinned pnpm archive layout mismatch.")
    project = temporary / "project"
    project.mkdir()
    for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "LICENSE"):
        shutil.copy2(ROOT / name, project / name)
    for metadata in sorted((ROOT / "packages").glob("*/package.json")) + [
        ROOT / "tools/desktop-probes/package.json"
    ]:
        destination = project / metadata.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(metadata, destination)
    names = (
        "installation-signing-container.mjs",
        "installation-source.mjs",
        "installation-source-pack.mjs",
        "installation-signing-image.mjs",
        "installation-signing-scaleway.mjs",
        "installation-authority.mjs",
        "installation-signer.mjs",
        "installation-signing-runner.mjs",
        "installation-filesystem.mjs",
        "update-admission.mjs",
    )
    (project / "tooling").mkdir()
    for name in names:
        shutil.copy2(ROOT / "tooling" / name, project / "tooling" / name)
    for name in (
        "config/desktop/resource-policy.json",
        "config/desktop/targets.json",
        "config/installation/signing-image.json",
    ):
        destination = project / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)
    lock_hash = hashlib.sha256((project / "pnpm-lock.yaml").read_bytes()).hexdigest()
    home = temporary / "home"
    home.mkdir()
    global_config = home / "empty.npmrc"
    global_config.touch()
    environment = {
        "PATH": str(context / "node/bin") + os.pathsep + "/usr/bin:/bin",
        "HOME": str(home),
        "NPM_CONFIG_USERCONFIG": str(project / ".npmrc"),
        "NPM_CONFIG_GLOBALCONFIG": str(global_config),
        "CI": "true",
    }
    subprocess.run(
        [
            str(executable),
            "--userconfig",
            str(project / ".npmrc"),
            "--store-dir",
            str(ROOT / ".cache/pnpm/store"),
            "--state-dir",
            str(temporary / "pnpm-state"),
            "--config.cacheDir=" + str(ROOT / ".cache/pnpm/cache"),
            "--config.verifyStoreIntegrity=true",
            "--config.packageImportMethod=copy",
            "install",
            "--offline",
            "--frozen-lockfile",
            "--ignore-scripts",
            "--ignore-pnpmfile",
        ],
        cwd=project,
        env=environment,
        check=True,
    )
    if hashlib.sha256((project / "pnpm-lock.yaml").read_bytes()).hexdigest() != lock_hash:
        raise ValueError("Frozen image dependency lock changed.")
    subprocess.run(
        [
            str(context / "node/bin/node"),
            str(project / "tooling/installation-signing-image.mjs"),
            str(context / "runtime"),
        ],
        cwd=project,
        env=environment,
        check=True,
    )
    if hashlib.sha256((ROOT / "pnpm-lock.yaml").read_bytes()).hexdigest() != lock_hash:
        raise ValueError("Image source lock changed during assembly.")
    return lock_hash


def prepare(destination: Path, cache: Path) -> None:
    manifest = json.loads(MANIFEST.read_bytes())
    validate_manifest(manifest)
    destination = destination.absolute()
    if destination.exists():
        raise ValueError("Signing image context already exists.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ohtia-image-", dir=destination.parent) as temporary:
        context = Path(temporary) / "context"
        context.mkdir()
        packages = context / "debs"
        packages.mkdir()
        for item in manifest["packages"]:
            archive = cache / "debs" / item["file"]
            download(item, archive)
            shutil.copyfile(archive, packages / item["file"])
        tools = json.loads((ROOT / "config/desktop/toolchain.json").read_bytes())["tools"]
        gh = json.loads((ROOT / "config/installation/scaleway.json").read_bytes())["github_cli"]
        for name, artifact, prefix in (
            (
                "node",
                tools["node"]["artifacts"]["linux-x64"],
                f"node-v{tools['node']['version']}-linux-x64",
            ),
            ("gh", gh, f"gh_{gh['version']}_linux_amd64"),
        ):
            archive = cache / Path(urlsplit(artifact["url"]).path).name
            download(artifact, archive)
            expanded = Path(temporary) / name
            unpack(archive, expanded)
            selected = context / name
            (selected / "bin").mkdir(parents=True)
            shutil.copy2(expanded / prefix / "bin" / name, selected / "bin" / name)
            for license_file in (expanded / prefix).glob("LICENSE*"):
                shutil.copy2(license_file, selected / license_file.name)
        lock_hash = isolated_runtime(context, Path(temporary), tools)
        recipe = ROOT / "tools/installation-signer"
        containerfile = (recipe / "Containerfile").read_text()
        if containerfile.splitlines()[0] != "FROM " + manifest["base_image"]:
            raise ValueError("Signing image recipe/base mismatch.")
        for name in ("Containerfile", "entrypoint.sh"):
            shutil.copy2(recipe / name, context / name)
        record = {
            **manifest,
            "tool_artifacts": {
                "node": {
                    "version": tools["node"]["version"],
                    **tools["node"]["artifacts"]["linux-x64"],
                },
                "gh": gh,
            },
            "pnpm_lock_sha256": lock_hash,
            "javascript_dependencies": "fresh-offline-frozen-install-with-store-integrity-verification",
        }
        (context / "manifest.json").write_text(json.dumps(record, indent=2) + "\n")
        context.rename(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/signing-image")
    args = parser.parse_args()
    prepare(args.destination, args.cache)


if __name__ == "__main__":
    main()
