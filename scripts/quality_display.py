"""Run an Ubuntu quality cell in its own native GNOME or KDE Plasma Wayland session."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import plasma_session

ROOT = Path(__file__).resolve().parents[1]


def cell_desktop(cell_id: str) -> str:
    cells = json.loads((ROOT / "config/quality/build-targets.json").read_text(encoding="utf-8"))
    cell = next((item for item in cells["cells"] if item["id"] == cell_id), None)
    if cell is None or cell.get("launcher") != "display-session":
        raise SystemExit("Use one declared hosted display-session cell.")
    return cell["desktop"]


def quality_build(env: dict[str, str]) -> int:
    return subprocess.run(
        [sys.executable, "scripts/workspace.py", "run", "quality:build", *sys.argv[1:]],
        env=env,
        check=False,
        timeout=3600,
    ).returncode


def plasma(directory: str) -> int:
    """KDE cells use the shared Plasma launcher on this job's private bus."""
    with (Path(directory) / "compositor.log").open("wb") as log:
        try:
            with plasma_session.session(
                {**os.environ, "LIBGL_ALWAYS_SOFTWARE": "1"}, Path(directory), log
            ) as env:
                return quality_build(env)
        except plasma_session.PlasmaError as error:
            raise SystemExit(f"Native KDE Plasma Wayland session failed: {error}") from None


def gnome(directory: str) -> int:
    env = {
        **os.environ,
        "XDG_RUNTIME_DIR": directory,
        "XDG_SESSION_TYPE": "wayland",
        "XDG_CURRENT_DESKTOP": "GNOME",
        "LIBGL_ALWAYS_SOFTWARE": "1",
    }
    env.pop("DISPLAY", None)
    with (Path(directory) / "compositor.log").open("wb") as log:
        child = subprocess.Popen(
            ["gnome-shell", "--headless", "--wayland", "--virtual-monitor", "1280x720"],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            env["OHTIA_NATIVE_COMPOSITOR_PID"] = str(child.pid)
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                sockets = [file for file in Path(directory).glob("wayland-*") if file.is_socket()]
                if sockets:
                    env["WAYLAND_DISPLAY"] = sockets[0].name
                    break
                if child.poll() is not None:
                    raise SystemExit("Native GNOME Wayland failed before Electron startup.")
                time.sleep(0.2)
            else:
                raise SystemExit("Native GNOME Wayland did not become ready.")
            return quality_build(env)
        finally:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)


def main() -> int:
    if (
        len(sys.argv) != 3
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        or os.getuid() == 0
    ):
        raise SystemExit("Use one declared Wayland cell in a fresh unprivileged hosted VM.")
    desktop = cell_desktop(sys.argv[1])
    with tempfile.TemporaryDirectory(prefix="ohtia-wayland-", dir=Path.home()) as directory:
        return plasma(directory) if desktop == "kde" else gnome(directory)


if __name__ == "__main__":
    raise SystemExit(main())
