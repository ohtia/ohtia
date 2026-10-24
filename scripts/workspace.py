"""Run the locked contributor tools in a checkout-local environment (Python >=3.12)."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import urllib.request
import zipfile
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import NotRequired, TypedDict, cast

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tooling"
MANIFEST = ROOT / "config/desktop/toolchain.json"


class WorkspaceError(Exception):
    """Setup or a declared tool failed without changing the locked resolution."""


class ToolRecord(TypedDict):
    version: str
    artifact: NotRequired[dict[str, object]]
    artifacts: NotRequired[dict[str, dict[str, object]]]


def tool_records() -> dict[str, ToolRecord]:
    """Isolate the authored JSON manifest from the typed tool orchestration."""
    decoded: object = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not isinstance(decoded, dict) or not isinstance(decoded.get("tools"), dict):
        raise WorkspaceError(
            "Invalid toolchain manifest; restore the reviewed config/desktop/toolchain.json and rerun its contract checker."
        )
    return cast(dict[str, ToolRecord], decoded["tools"])


def target_id(system: str | None = None, machine: str | None = None) -> str:
    systems = {"Linux": "linux", "Darwin": "darwin", "Windows": "win32"}
    architectures = {
        "x86_64": "x64",
        "amd64": "x64",
        "x64": "x64",
        "aarch64": "arm64",
        "arm64": "arm64",
    }
    os_id = systems.get(system or platform.system())
    arch = architectures.get((machine or platform.machine()).lower())
    if os_id is None or arch is None:
        raise WorkspaceError(
            "Unsupported OS/CPU: use a declared native x64 or arm64 target; 32-bit and emulated acceptance are excluded."
        )
    return f"{os_id}-{arch}"


def environment() -> dict[str, str]:
    env = dict(os.environ)
    paths = [
        TOOLS / "node" / ("" if os.name == "nt" else "bin"),
        TOOLS / "uv",
        TOOLS / "python" / ("" if os.name == "nt" else "bin"),
        ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin"),
    ]
    env["PATH"] = os.pathsep.join(map(str, paths)) + os.pathsep + env.get("PATH", "")
    env.update(
        {
            "UV_CACHE_DIR": str(ROOT / ".cache/uv"),
            "PRE_COMMIT_HOME": str(ROOT / ".cache/pre-commit"),
            "UV_PROJECT_ENVIRONMENT": str(ROOT / ".venv"),
            "UV_PYTHON_DOWNLOADS": "never",
            "UV_PYTHON": str(python_path()),
            "PYTHONNOUSERSITE": "1",
            "ELECTRON_SKIP_BINARY_DOWNLOAD": "1",
            "COREPACK_ENABLE_PROJECT_SPEC": "0",
            "COREPACK_ENABLE_NETWORK": "0",
            "PLAYWRIGHT_BROWSERS_PATH": str(ROOT / ".cache/playwright"),
        }
    )
    env.pop("VIRTUAL_ENV", None)
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    return env


def node_path() -> Path:
    return TOOLS / "node" / ("node.exe" if os.name == "nt" else "bin/node")


def python_path() -> Path:
    return TOOLS / "python" / ("python.exe" if os.name == "nt" else "bin/python3")


def uv_path() -> Path:
    return TOOLS / "uv" / ("uv.exe" if os.name == "nt" else "uv")


def invoke(command: list[str | Path], *, capture: bool = False) -> str:
    try:
        result = subprocess.run(
            [str(part) for part in command],
            cwd=ROOT,
            env=environment(),
            check=True,
            text=True,
            stdout=subprocess.PIPE if capture else None,
        )
    except OSError as exc:
        raise WorkspaceError(
            f"Cannot run {command[0]}. Run bootstrap/setup in this checkout and check local executable permissions."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise WorkspaceError(
            "Command failed. Check the diagnostic above, network access and pinned prerequisites; rerun setup without rewriting locks or upgrading global tools."
        ) from exc
    return result.stdout.strip() if capture else ""


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(artifact: dict[str, object], destination: Path) -> None:
    url, expected = str(artifact["url"]), str(artifact["sha256"])
    if destination.exists() and digest(destination) == expected:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(".partial")
    try:
        with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        if digest(partial) != expected:
            raise WorkspaceError(
                "Downloaded tool digest mismatch; remove the damaged cache entry and verify the reviewed manifest. No tool was installed."
            )
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def unpack(archive: Path, destination: Path) -> None:
    if archive.name.endswith((".zip", ".whl")):
        with zipfile.ZipFile(archive) as zipped:
            for member in zipped.infolist():
                resolved = (destination / member.filename).resolve()
                if not resolved.is_relative_to(destination.resolve()):
                    raise WorkspaceError("Unsafe archive path in pinned tool.")
            zipped.extractall(destination)
    else:
        with tarfile.open(archive) as packed:
            packed.extractall(destination, filter="data")


def install_tool(
    name: str, artifact: dict[str, object], executable: Path, prefix: str | None
) -> None:
    archive_name = str(artifact["url"]).rsplit("/", 1)[1]
    archive = ROOT / ".cache/downloads" / archive_name
    download(artifact, archive)
    TOOLS.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{name}-", dir=TOOLS) as temporary:
        extracted = Path(temporary)
        unpack(archive, extracted)
        if prefix is None:
            matches = [path for path in extracted.rglob(executable.name) if path.is_file()]
            if len(matches) != 1:
                raise WorkspaceError(
                    f"Expected exactly one {name} executable in the pinned archive."
                )
            selected = extracted / "selected"
            selected.mkdir()
            shutil.copy2(matches[0], selected / executable.name)
            (selected / executable.name).chmod(0o755)
        else:
            selected = extracted / prefix
        destination = TOOLS / name
        if destination.exists():
            shutil.rmtree(destination)
        selected.replace(destination)
    if not executable.is_file():
        raise WorkspaceError(f"Pinned {name} archive has an unexpected layout.")


def bootstrap() -> None:
    tools = tool_records()
    target = target_id()
    for name, executable, prefix in (
        (
            "node",
            node_path(),
            str(tools["node"]["artifacts"][target]["url"])
            .rsplit("/", 1)[1]
            .removesuffix(".tar.xz")
            .removesuffix(".tar.gz")
            .removesuffix(".zip"),
        ),
        ("pnpm", TOOLS / "pnpm/bin/pnpm.mjs", "package"),
        ("uv", uv_path(), None),
        ("python", python_path(), "python"),
    ):
        artifact = (
            tools[name].get("artifact") if name == "pnpm" else tools[name]["artifacts"][target]
        )
        if artifact is None:
            raise WorkspaceError(
                f"Missing pinned {name} artifact; restore the reviewed toolchain manifest."
            )
        if not executable.exists():
            print(f"Installing pinned {name} for {target}", flush=True)
            install_tool(name, artifact, executable, prefix)
    native = TOOLS / "pnpm" / ("pnpm-native.exe" if os.name == "nt" else "pnpm-native")
    if not native.exists():
        artifact = tools["pnpm"]["artifacts"][target]
        archive = ROOT / ".cache/downloads" / str(artifact["url"]).rsplit("/", 1)[1]
        download(artifact, archive)
        with tempfile.TemporaryDirectory(dir=TOOLS) as temporary:
            unpack(archive, Path(temporary))
            source = Path(temporary) / "package" / ("pnpm.exe" if os.name == "nt" else "pnpm")
            shutil.copy2(source, native)
            native.chmod(0o755)
    diagnose()


def pnpm(*args: str) -> str:
    locks = {name: digest(ROOT / name) for name in ("pnpm-lock.yaml", "uv.lock")}
    try:
        return invoke(
            [
                node_path(),
                TOOLS / "pnpm/bin/pnpm.mjs",
                "--userconfig",
                ROOT / ".npmrc",
                "--state-dir",
                ROOT / ".cache/pnpm/state",
                "--store-dir",
                ROOT / ".cache/pnpm/store",
                "--config.verifyDepsBeforeRun=error",
                *args,
            ]
        )
    finally:
        if any(digest(ROOT / name) != expected for name, expected in locks.items()):
            raise WorkspaceError(
                "Command changed a lockfile; stop and inspect the diff. Restore the reviewed inputs instead of accepting an implicit resolution."
            )


def diagnose() -> None:
    tools = tool_records()
    checks = {
        "node": [node_path(), "--version"],
        "pnpm": [node_path(), TOOLS / "pnpm/bin/pnpm.mjs", "--version"],
        "uv": [uv_path(), "--version"],
        "python": [python_path(), "--version"],
    }
    for name, command in checks.items():
        actual = invoke(command, capture=True).split()
        if len(actual) < (1 if name in ("node", "pnpm") else 2):
            raise WorkspaceError(
                f"{name} did not report its version. Reinstall its checkout-local pin."
            )
        version = actual[0].removeprefix("v") if name in ("node", "pnpm") else actual[1]
        if version != tools[name]["version"]:
            raise WorkspaceError(
                f"{name} version mismatch: expected {tools[name]['version']}, got {version}. Remove .tooling/{name} and rerun bootstrap; global upgrades are not a repair."
            )
        print(f"{name}: {version}")
    observed = invoke([node_path(), "-p", "process.platform + '-' + process.arch"], capture=True)
    if observed != target_id():
        raise WorkspaceError("Developer Node architecture does not match the host target.")
    print(f"Tools match {observed}; this is not native desktop qualification.")


def diagnose_dependencies() -> None:
    executable = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    groups = cast(
        list[str],
        tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["dependency-groups"][
            "dev"
        ],
    )
    expected = dict(entry.split("==") for entry in groups)
    code = (
        "import importlib.metadata as m, json; print(json.dumps({name: m.version(name) for name in "
        + repr(list(expected))
        + "}))"
    )
    actual = json.loads(invoke([executable, "-c", code], capture=True))
    if actual != expected:
        raise WorkspaceError("Python tool version mismatch; rerun frozen setup in this checkout.")
    pnpm("run", "doctor")


def setup() -> None:
    bootstrap()
    locks = {name: digest(ROOT / name) for name in ("pnpm-lock.yaml", "uv.lock")}
    try:
        pnpm("install", "--frozen-lockfile")
        invoke([uv_path(), "lock", "--check"])
        invoke([uv_path(), "sync", "--frozen", "--all-groups", "--python", python_path()])
        diagnose_dependencies()
    finally:
        if any(digest(ROOT / name) != expected for name, expected in locks.items()):
            raise WorkspaceError(
                "Frozen setup changed a lockfile; stop and inspect the diff before continuing."
            )


@contextmanager
def setup_lock() -> Generator[None, None, None]:
    TOOLS.mkdir(exist_ok=True)
    lock = TOOLS / "setup.lock"
    try:
        stream = lock.open("x", encoding="utf-8")
    except FileExistsError as exc:
        raise WorkspaceError(
            "Another setup owns .tooling/setup.lock. Check its recorded PID; remove the lock only after confirming that setup has stopped."
        ) from exc
    try:
        with stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        lock.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("bootstrap", "setup", "doctor", "run"))
    parser.add_argument("arguments", nargs="*")
    args = parser.parse_args()
    try:
        if args.command in ("bootstrap", "setup"):
            with setup_lock():
                bootstrap() if args.command == "bootstrap" else setup()
        elif args.command == "doctor":
            diagnose()
            diagnose_dependencies()
        else:
            diagnose()
            diagnose_dependencies()
            if not args.arguments:
                raise WorkspaceError("Specify a declared package command, for example: run check.")
            pnpm("run", *args.arguments)
    except (
        WorkspaceError,
        OSError,
        ValueError,
        tarfile.TarError,
        zipfile.BadZipFile,
    ) as exc:
        print(f"Workspace setup stopped: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
