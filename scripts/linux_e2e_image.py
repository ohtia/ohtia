"""Build the pinned WebKit sandbox layer inside its disposable Linux image builder."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "config/desktop/linux-e2e-build.json"
SOURCE = Path("/opt/webkit")
BUILD = Path("/opt/webkit-build")
PREFIX = Path("/opt/installed")
OUTPUT = Path("/opt/ohtia-image")
SOURCE_INPUTS = Path("/opt/source-inputs.json")
COMPILE_RECEIPT = Path("/opt/compile-receipt.json")


def execute(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def captured(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def sha256(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source_files(root):
    """Hash regular files and link text without following vendor fixture links."""
    result = {}
    for directory, subdirs, names in os.walk(root, followlinks=False):
        subdirs[:] = sorted(name for name in subdirs if name != ".git")
        for name in sorted(set([*names, *subdirs])):
            file = Path(directory) / name
            relative = file.relative_to(root).as_posix()
            mode = file.lstat().st_mode
            if stat.S_ISLNK(mode):
                result[relative] = {"link": os.readlink(file)}
            elif stat.S_ISREG(mode):
                result[relative] = {"sha256": sha256(file), "mode": stat.S_IMODE(mode)}
            elif not stat.S_ISDIR(mode):
                raise ValueError("Unexpected image-source file type.")
    return result


def checked_patch(record, destination):
    with urllib.request.urlopen(record["url"], timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise ValueError("WebKit patch digest mismatch; no patch was applied.")
    destination.write_bytes(data)


def prepare(config):
    snapshot = config["ubuntu_snapshot"]
    if not re.fullmatch(r"\d{8}T\d{6}Z", snapshot):
        raise ValueError("An immutable Ubuntu snapshot is required.")
    for file in Path("/etc/apt/sources.list.d").glob("*"):
        file.unlink()
    Path("/etc/apt/sources.list").write_text(
        "".join(
            f"deb [check-valid-until=no] https://snapshot.ubuntu.com/ubuntu/{snapshot} {suite} main universe\n"
            for suite in ("noble", "noble-updates", "noble-security")
        )
    )
    execute(["apt-get", "update"])
    execute(
        ["apt-get", "install", "-y", "--no-install-recommends", *config["build_packages"]],
        env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"},
    )
    execute(["git", "init", str(SOURCE)])
    execute(["git", "-C", str(SOURCE), "remote", "add", "origin", config["source"]["repository"]])
    execute(["git", "-C", str(SOURCE), "config", "remote.origin.promisor", "true"])
    execute(["git", "-C", str(SOURCE), "config", "remote.origin.partialclonefilter", "blob:none"])
    execute(
        [
            "git",
            "-C",
            str(SOURCE),
            "fetch",
            "--depth=1",
            "--filter=blob:none",
            "origin",
            config["source"]["commit"],
        ]
    )
    execute(["git", "-C", str(SOURCE), "checkout", "--detach", "FETCH_HEAD"])
    if captured(["git", "-C", str(SOURCE), "rev-parse", "HEAD"]) != config["source"]["commit"]:
        raise ValueError("WebKit source revision mismatch.")
    patch = Path("/opt/playwright-webkit.diff")
    checked_patch(config["patch"], patch)
    execute(["git", "apply", "--check", str(patch)], cwd=SOURCE)
    execute(["git", "apply", "--index", str(patch)], cwd=SOURCE)
    tree = captured(["git", "-C", str(SOURCE), "write-tree"])
    if tree != config["source"]["patched_tree"]:
        raise ValueError("Patched WebKit source tree mismatch.")
    SOURCE_INPUTS.write_text(
        json.dumps(
            {
                "version": 1,
                "build_method": "canonical-recipe",
                "recipe_sha256": sha256(Path(__file__)),
                "manifest_sha256": sha256(MANIFEST),
                "source_tree": tree,
                "source": config["source"],
                "patch": config["patch"],
                "files": source_files(SOURCE),
            },
            sort_keys=True,
        )
        + "\n"
    )


def checked_source_record(config):
    source = json.loads(SOURCE_INPUTS.read_text())
    expected = {
        "version": 1,
        "build_method": "canonical-recipe",
        "recipe_sha256": sha256(Path(__file__)),
        "manifest_sha256": sha256(MANIFEST),
        "source_tree": config["source"]["patched_tree"],
        "source": config["source"],
        "patch": config["patch"],
    }
    if any(source.get(key) != value for key, value in expected.items()) or not source.get("files"):
        raise ValueError("Canonical image preparation receipt mismatch.")
    return source


def compile_webkit(config):
    checked_source_record(config)
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    headers = Path(config["cmake"]["LIBBACKTRACE_INCLUDE_DIR"])
    headers.mkdir(exist_ok=True)
    for file in Path("/usr/lib/gcc/x86_64-linux-gnu/13/include").glob("backtrace*.h"):
        shutil.copyfile(file, headers / file.name)
    if not (headers / "backtrace.h").is_file():
        raise ValueError("The pinned compiler does not provide libbacktrace headers.")
    execute(
        [
            "cmake",
            "-S",
            str(SOURCE),
            "-B",
            str(BUILD),
            "-G",
            "Ninja",
            *[f"-D{key}={value}" for key, value in config["cmake"].items()],
        ],
        env=environment,
    )
    # The pinned GTK graph omits this header from NetworkProcess prerequisites.
    execute(
        [
            "cmake",
            "--build",
            str(BUILD),
            "--target",
            "WebKitGTK/DerivedSources/WebKitDirectoryInputStreamData.h",
            f"-j{config['jobs']}",
        ],
        env=environment,
    )
    execute(["cmake", "--build", str(BUILD), f"-j{config['jobs']}"], env=environment)
    execute(["cmake", "--install", str(BUILD)], env=environment)
    COMPILE_RECEIPT.write_text(
        json.dumps(
            {
                "recipe_sha256": sha256(Path(__file__)),
                "manifest_sha256": sha256(MANIFEST),
                "source_inputs_sha256": sha256(SOURCE_INPUTS),
                "cmake_cache_sha256": sha256(BUILD / "CMakeCache.txt"),
                "artifacts": source_files(PREFIX),
            },
            sort_keys=True,
        )
        + "\n"
    )


def package_for_library(file):
    candidates = [str(file)]
    if str(file).startswith("/usr/lib/"):
        candidates.append(str(file).removeprefix("/usr"))
    for name in candidates:
        result = subprocess.run(
            ["dpkg-query", "-S", name], capture_output=True, text=True, check=False
        )
        if result.returncode == 0:
            packages = {line.rsplit(": /", 1)[0] for line in result.stdout.splitlines()}
            if len(packages) != 1:
                raise ValueError("Ambiguous runtime library package ownership.")
            return packages.pop()
    raise ValueError(f"Runtime library has no pinned package owner: {file}")


def checked_cache(config):
    entries = {}
    for line in (BUILD / "CMakeCache.txt").read_text().splitlines():
        match = re.fullmatch(r"([^:#/][^:]*):[^=]*=(.*)", line)
        if match:
            entries[match[1]] = match[2]
    for key, expected in config["cmake"].items():
        observed = entries.get(key)
        if key in ("CMAKE_C_COMPILER", "CMAKE_CXX_COMPILER"):
            if (
                observed is None
                or Path(observed).resolve()
                != Path(shutil.which(expected) or "/missing-compiler").resolve()
            ):
                raise ValueError(f"Compiled image option mismatch: {key}")
        elif observed != expected:
            raise ValueError(f"Compiled image option mismatch: {key}")


def finalize(config):
    checked_cache(config)
    source = checked_source_record(config)
    if source["files"] != source_files(SOURCE):
        raise ValueError("Source/patch bytes changed during the image build.")
    compiled = json.loads(COMPILE_RECEIPT.read_text())
    expected = {
        "recipe_sha256": sha256(Path(__file__)),
        "manifest_sha256": sha256(MANIFEST),
        "source_inputs_sha256": sha256(SOURCE_INPUTS),
        "cmake_cache_sha256": sha256(BUILD / "CMakeCache.txt"),
        "artifacts": source_files(PREFIX),
    }
    if compiled != expected:
        raise ValueError("Canonical image compilation receipt mismatch.")
    OUTPUT.mkdir(exist_ok=True)
    libraries = sorted({str(file.parent) for file in PREFIX.rglob("*.so*") if file.is_file()})
    environment = {**os.environ, "LD_LIBRARY_PATH": ":".join(libraries)}

    def elf(file):
        if file.is_symlink() or not file.is_file():
            return False
        with file.open("rb") as stream:
            return stream.read(4) == b"\x7fELF"

    binaries = [file for file in PREFIX.rglob("*") if elf(file)]
    packages = {"bubblewrap", "xdg-dbus-proxy"}
    for file in [*binaries, Path("/usr/bin/bwrap"), Path("/usr/bin/xdg-dbus-proxy")]:
        output = captured(["ldd", str(file)], env=environment)
        if "not found" in output:
            raise ValueError(f"Missing runtime dependency: {file}")
        for line in output.splitlines():
            match = re.search(r"(?:=>\s*)?(/[^\s]+)\s+\(", line)
            if match:
                library = Path(match[1]).resolve()
                if not library.is_relative_to(PREFIX):
                    packages.add(package_for_library(library))
    (OUTPUT / "runtime-packages.txt").write_text(
        "\n".join(
            sorted(
                captured(["dpkg-query", "-W", "-f=${binary:Package}=${Version}", name])
                for name in packages
            )
        )
        + "\n"
    )
    (OUTPUT / "builder-packages.txt").write_text(captured(["dpkg-query", "-W"]) + "\n")
    miniature = PREFIX / "libexec/webkitgtk-6.0/MiniBrowser"
    bundles = sorted({file.resolve() for file in PREFIX.rglob("libwebkitgtkinjectedbundle.so")})
    if not miniature.is_file() or len(bundles) != 1:
        raise ValueError("The selected MiniBrowser/injected bundle was not installed.")
    launch = Path("/opt/ohtia-webkit-launch")
    launch.write_text(
        '#!/bin/sh\nset -eu\nfor argument in "$@"; do\n  case "$argument" in --headless*|--no-sandbox|--disable-*sandbox*) echo "This image admits sandboxed GTK WebKit under its private display only." >&2; exit 1;; esac\ndone\nif [ -n "${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-}" ]; then exit 1; fi\nexport LD_LIBRARY_PATH='
        + ":".join(libraries)
        + "\nexport WEBKIT_EXEC_PATH=/opt/installed/libexec/webkitgtk-6.0\nexport WEBKIT_INJECTED_BUNDLE_PATH="
        + str(next(iter(bundles)).parent)
        + '\nexec /opt/installed/libexec/webkitgtk-6.0/MiniBrowser "$@"\n'
    )
    launch.chmod(0o755)
    notices = OUTPUT / "notices"
    for relative in source["files"]:
        file = SOURCE / relative
        if (
            file.is_file()
            and not file.is_symlink()
            and file.name.upper().startswith(("COPYING", "LICENSE", "NOTICE"))
        ):
            destination = notices / file.relative_to(SOURCE)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, destination)
    record = {
        "version": 2,
        "build_method": "canonical-recipe",
        "stages": ["prepare", "compile", "finalize"],
        "compile_receipt_sha256": sha256(COMPILE_RECEIPT),
        "source": config["source"],
        "patch": config["patch"],
        "recipe_sha256": sha256(Path(__file__)),
        "manifest_sha256": sha256(MANIFEST),
        "source_inputs_sha256": sha256(SOURCE_INPUTS),
        "cmake_cache_sha256": sha256(BUILD / "CMakeCache.txt"),
        "source_validation": "canonical-stage-receipts-and-before-after-source-snapshot",
        "source_tree": source["source_tree"],
        "launcher_sha256": sha256(launch),
        "compiler": captured(["clang++", "--version"]),
        "artifacts": source_files(PREFIX),
    }
    shutil.copyfile(COMPILE_RECEIPT, OUTPUT / "compile-receipt.json")
    (OUTPUT / "webkit.json").write_text(json.dumps(record, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("prepare", "compile", "finalize"))
    args = parser.parse_args()
    if (
        platform.system() != "Linux"
        or platform.machine() != "x86_64"
        or os.geteuid() != 0
        or not (
            Path("/.dockerenv").exists()
            or Path("/run/.containerenv").exists()
            or (
                Path("/opt/ohtia-build-context.json").is_file()
                and Path("/opt/ohtia-build-context.json").read_bytes() == MANIFEST.read_bytes()
            )
        )
    ):
        raise ValueError(
            "Run this maintainer recipe only inside its disposable x86-64 image builder."
        )
    config = json.loads(MANIFEST.read_text())
    if config["version"] != 1 or config["target"] != "linux-x64":
        raise ValueError("Invalid image build scope.")
    {"prepare": prepare, "compile": compile_webkit, "finalize": finalize}[args.stage](config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
