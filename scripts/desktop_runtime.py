"""Assemble locked Electron bytes and production app outputs without launching them."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import struct
import zipfile
from pathlib import Path, PurePosixPath

import workspace

ROOT = Path(__file__).resolve().parent.parent


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def architecture(executable: Path) -> str:
    """Read native headers without executing the target."""
    with executable.open("rb") as stream:
        header = stream.read(64)
        if len(header) != 64:
            raise ValueError("Truncated native executable header.")
        if header.startswith(b"\x7fELF"):
            machine = struct.unpack_from("<H" if header[5] == 1 else ">H", header, 18)[0]
            return {62: "x64", 183: "arm64"}.get(machine, "unsupported")
        if header.startswith(b"MZ"):
            stream.seek(struct.unpack_from("<I", header, 60)[0])
            signature = stream.read(6)
            if len(signature) != 6 or signature[:4] != b"PE\0\0":
                raise ValueError("Invalid native PE signature.")
            return {0x8664: "x64", 0xAA64: "arm64"}.get(
                struct.unpack_from("<H", signature, 4)[0], "unsupported"
            )
        if header[:4] == b"\xcf\xfa\xed\xfe":
            return {0x01000007: "x64", 0x0100000C: "arm64"}.get(
                struct.unpack_from("<I", header, 4)[0], "unsupported"
            )
    raise ValueError("Unrecognized native executable format.")


def unpack(archive: Path, destination: Path) -> None:
    """Preserve framework links, reject escaping entries, and strip special mode bits."""
    links: list[tuple[Path, str]] = []
    with zipfile.ZipFile(archive) as zipped:
        for entry in zipped.infolist():
            relative = PurePosixPath(entry.filename)
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or "\\" in entry.filename
                or any(":" in part for part in relative.parts)
            ):
                raise ValueError("Unsafe Electron archive path.")
            target = destination.joinpath(*relative.parts)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                link = zipped.read(entry).decode("utf-8")
                if Path(link).is_absolute() or not (target.parent / link).resolve().is_relative_to(
                    destination.resolve()
                ):
                    raise ValueError("Unsafe Electron framework link.")
                links.append((target, link))
            elif entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(entry) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod((mode & 0o777) or 0o644)
    for target, link in links:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(link)


def assemble(target: str, destination: Path) -> None:
    manifest = json.loads((ROOT / "config/desktop/toolchain.json").read_text())
    targets = json.loads((ROOT / "config/desktop/targets.json").read_text())["targets"]
    if target not in {item["id"] for item in targets}:
        raise ValueError(
            "Choose a declared target; no implicit architecture fallback is supported."
        )
    product = ROOT / "artifacts/desktop-app"
    inventory = json.loads((product / "inventory.json").read_text())
    for name, expected in inventory["files"].items():
        file = product / name
        if (
            file.is_symlink()
            or not file.resolve().is_relative_to(product)
            or sha256(file) != expected
        ):
            raise ValueError("Production app outputs changed. Run the desktop build again.")
    destination = destination.absolute()
    if destination.exists() or destination.parent.resolve() != destination.parent:
        raise ValueError("Use a new attempt directory with an existing unaliased parent.")
    artifact = manifest["tools"]["electron"]["artifacts"][target]
    archive = ROOT / ".cache/desktop-runtime" / f"{artifact['sha256']}.zip"
    workspace.download(artifact, archive)
    destination.mkdir()
    runtime = destination / "runtime"
    runtime.mkdir()
    unpack(archive, runtime)
    if target.startswith("darwin"):
        executable = "runtime/Electron.app/Contents/MacOS/Electron"
        app = "runtime/Electron.app/Contents/Resources/app"
    else:
        executable = "runtime/electron.exe" if target.startswith("win32") else "runtime/electron"
        app = "runtime/resources/app"
    shutil.copytree(product, destination / app)
    if architecture(destination / executable) != target.split("-")[1]:
        raise ValueError("The executable architecture does not match its target.")
    files: dict[str, str] = {}
    links: dict[str, str] = {}
    for directory, subdirs, names in os.walk(destination, followlinks=False):
        for name in [*subdirs, *names]:
            file = Path(directory) / name
            relative = file.relative_to(destination).as_posix()
            if file.is_symlink():
                links[relative] = os.readlink(file)
            elif file.is_file():
                files[relative] = sha256(file)
    prepared = {
        "version": 1,
        "target": target,
        "executable": executable,
        "app": app,
        "electron_archive_sha256": artifact["sha256"],
        "files": files,
        "links": links,
    }
    (destination / "prepared.json").write_text(json.dumps(prepared, indent=2) + "\n")
    print(f"Assembled {target}; no Electron executable was launched: {destination}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target")
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        assemble(args.target, args.destination)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, workspace.WorkspaceError) as error:
        print(
            f"Desktop assembly refused: {error}. Preserve failed attempts and check reviewed inputs."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
