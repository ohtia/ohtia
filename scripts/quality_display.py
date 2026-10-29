"""Run an Ubuntu quality cell in its own native GNOME Wayland session."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def main() -> int:
    if (
        len(sys.argv) != 3
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        or os.getuid() == 0
    ):
        raise SystemExit("Use one declared Wayland cell in a fresh unprivileged hosted VM.")
    with tempfile.TemporaryDirectory(prefix="ohtia-wayland-", dir=Path.home()) as directory:
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
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    sockets = [
                        file for file in Path(directory).glob("wayland-*") if file.is_socket()
                    ]
                    if sockets:
                        env["WAYLAND_DISPLAY"] = sockets[0].name
                        break
                    if child.poll() is not None:
                        raise SystemExit("Native GNOME Wayland failed before Electron startup.")
                    time.sleep(0.2)
                else:
                    raise SystemExit("Native GNOME Wayland did not become ready.")
                result = subprocess.run(
                    [sys.executable, "scripts/workspace.py", "run", "quality:build", *sys.argv[1:]],
                    env=env,
                    check=False,
                    timeout=3600,
                )
                return result.returncode
            finally:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
