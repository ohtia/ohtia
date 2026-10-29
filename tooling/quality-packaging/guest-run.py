"""Enter the fresh guest account and preserve original CI source/event identities."""

import json
import os
import subprocess
import time
from pathlib import Path

home = Path("/home/ohtia-quality")
env = {**os.environ, **json.loads((home / "environment.json").read_text())}
source = home / "source"
subprocess.run(
    ["git", "clone", "--no-checkout", str(home / "source.bundle"), str(source)], check=True
)
subprocess.run(["git", "checkout", "--detach", env["GITHUB_SHA"]], cwd=source, check=True)
env["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
os.environ.update(env)
subprocess.run(["python3", "scripts/workspace.py", "setup"], cwd=source, env=env, check=True)
# The guest owns its kernel, home filesystem, GNOME compositor and policy; no host desktop is mounted.
with (home / "gnome.log").open("wb") as log:
    compositor = subprocess.Popen(
        [
            "dbus-run-session",
            "--",
            "gnome-shell",
            "--headless",
            "--wayland",
            "--virtual-monitor",
            "1280x720",
        ],
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            sockets = list(Path(env["XDG_RUNTIME_DIR"]).glob("wayland-*"))
            sockets = [file for file in sockets if file.is_socket()]
            if sockets:
                env["WAYLAND_DISPLAY"] = sockets[0].name
                break
            if compositor.poll() is not None:
                raise SystemExit("Native GNOME Wayland compositor failed.")
            time.sleep(0.2)
        else:
            raise SystemExit("Native GNOME Wayland compositor did not become ready.")
        env.pop("DISPLAY", None)
        subprocess.run(
            [
                "python3",
                "scripts/workspace.py",
                "run",
                "quality:build",
                env["OHTIA_QUALITY_VM"],
                "artifacts/quality-result",
            ],
            cwd=source,
            env=env,
            check=True,
        )
    finally:
        compositor.terminate()
        try:
            compositor.wait(timeout=10)
        except subprocess.TimeoutExpired:
            compositor.kill()
            compositor.wait(timeout=5)
