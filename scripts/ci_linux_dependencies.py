"""Provision Ubuntu CI hosts with authenticated archives and a shared wall-clock budget."""

from __future__ import annotations

import email.utils
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import linux_desktop

ROOT = Path(__file__).resolve().parents[1]
BUDGET_SECONDS = 12 * 60
KILL_GRACE_SECONDS = 5
MIRROR_SOURCE = "mirror+file:/etc/apt/apt-mirrors.txt"
# Official mirrors first; the fallbacks sit outside ubuntu.com so a failure resolving that domain
# does not take every mirror down. All of them are authenticated with the same Ubuntu keys.
MIRRORS = (
    "https://archive.ubuntu.com/ubuntu/",
    "https://security.ubuntu.com/ubuntu/",
    "https://mirrors.edge.kernel.org/ubuntu/",
    "https://mirrors.mit.edu/ubuntu/",
)
LOOKUP_TIMEOUT_SECONDS = 10
# Ubuntu InRelease files carry no Valid-Until; bound the age of the pockets that change.
FRESH_SUITES = ("resolute-security", "resolute-updates")
MAX_INDEX_AGE = timedelta(days=7)
KVM_PACKAGES = ["qemu-system-x86", "qemu-utils", "cloud-image-utils", "iproute2", "acl"]
GNOME_PACKAGES = [
    "gnome-shell",
    "gnome-session",
    "python3-gi",
    "dbus-user-session",
    "xdg-utils",
    "iproute2",
    "acl",
    "libgtk-3-0t64",
    "libnss3",
    "libasound2t64",
    "libgbm1",
    "libxss1",
    "libxtst6",
    "libsecret-1-0",
    "libnotify4",
    "libatspi2.0-0",
    "apparmor",
]
APT = [
    "apt-get",
    "-o",
    "Acquire::Retries=1",
    "-o",
    "Acquire::http::Timeout=15",
    "-o",
    "Acquire::https::Timeout=15",
    "-o",
    "DPkg::Lock::Timeout=30",
]


class ProvisionError(RuntimeError):
    pass


def gnu_timeout() -> str:
    """Ubuntu 26.04's unprefixed timeout is uutils; require GNU's group-wide KILL behavior."""
    executable = shutil.which("gnutimeout") or shutil.which("timeout")
    if executable is None:
        raise ProvisionError("GNU timeout is required for process-group cleanup but is missing.")
    try:
        result = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, timeout=5, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProvisionError("Could not verify the GNU timeout implementation.") from exc
    version = result.stdout.splitlines()[0] if result.stdout else ""
    if result.returncode or not version.startswith(
        ("timeout (GNU coreutils) ", "gnutimeout (GNU coreutils) ")
    ):
        raise ProvisionError(f"GNU timeout is required; detected implementation: {version!r}.")
    print(f"Provisioning timeout implementation: {executable}: {version}", flush=True)
    return executable


def packages_for(cell: str, launcher: str) -> list[str]:
    cells = json.loads((ROOT / "config/quality/build-targets.json").read_text())["cells"]
    selected = next((item for item in cells if item["id"] == cell), None)
    if selected is None or not selected["target"].startswith("linux-"):
        raise ProvisionError("Expected a declared native Linux quality cell.")
    if selected["launcher"] != launcher:
        raise ProvisionError("The launcher differs from the declared quality cell.")
    if launcher == "kvm":
        return list(KVM_PACKAGES)
    if launcher != "display-session" or selected["profile"] != "ubuntu-26.04":
        raise ProvisionError("Unsupported hosted Linux dependency route.")
    if selected["desktop"] == "kde":
        return ["kubuntu-desktop", *linux_desktop.kde_packages("ubuntu-26.04", GNOME_PACKAGES)]
    return list(GNOME_PACKAGES)


def resolves(host: str) -> bool:
    """Bounded lookup through the system resolver; a hung or failed lookup counts as absent."""
    try:
        result = subprocess.run(
            ["getent", "ahosts", host],
            capture_output=True,
            timeout=LOOKUP_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def configure_mirrors(apt_root: Path) -> None:
    """Keep sources, suites, components and Signed-By; change only the hosted mirror list."""
    sources = [apt_root / "sources.list"]
    for suffix in ("*.list", "*.sources"):
        sources.extend(sorted((apt_root / "sources.list.d").glob(suffix)))
    contents = [path.read_text() for path in sources if path.is_file()]
    if not any(MIRROR_SOURCE in content for content in contents):
        raise ProvisionError(
            "Hosted APT mirror-list source is missing; inspect runner source drift."
        )
    if any("azure.archive.ubuntu.com" in content for content in contents):
        raise ProvisionError(
            "A direct Azure APT source bypasses the mirror list; inspect source drift."
        )
    mirrors = apt_root / "apt-mirrors.txt"
    if not mirrors.is_file():
        raise ProvisionError("Hosted APT mirror list is missing.")
    available = []
    for mirror in MIRRORS:
        host = urlsplit(mirror).hostname
        if resolves(host):
            available.append(mirror)
        else:
            print(f"Ubuntu APT mirror skipped: {host} did not resolve.", flush=True)
    if not available:
        raise ProvisionError("No Ubuntu APT mirror resolved; inspect runner DNS.")
    listing = "".join(
        f"{mirror}\tpriority:{index}\n" for index, mirror in enumerate(available, start=1)
    )
    mirrors.write_text(listing)
    print("Ubuntu APT mirrors (source authentication unchanged):\n" + listing, flush=True)


def release_date(text: str) -> datetime | None:
    """Read the Date field of a clearsigned InRelease's first paragraph."""
    lines = text.splitlines()
    if lines and lines[0] == "-----BEGIN PGP SIGNED MESSAGE-----":
        lines = lines[lines.index("") + 1 :] if "" in lines else []
    for line in lines:
        if not line.strip() or line.startswith("-----BEGIN PGP SIGNATURE-----"):
            break
        if line.startswith("Date:"):
            try:
                return email.utils.parsedate_to_datetime(line[5:].strip())
            except (TypeError, ValueError):
                return None
    return None


def check_index_freshness(lists: Path, now: datetime | None = None) -> None:
    """Reject stale but validly signed indexes, which a fallback mirror could serve."""
    now = now or datetime.now(UTC)
    for suite in FRESH_SUITES:
        found = sorted(lists.glob(f"*_dists_{suite}_InRelease"))
        if not found:
            raise ProvisionError(f"The {suite} index is missing after the index refresh.")
        for path in found:
            date = release_date(path.read_text(errors="replace"))
            if date is None or date.tzinfo is None:
                raise ProvisionError(f"The {suite} index has no valid Date field.")
            if now - date > MAX_INDEX_AGE:
                raise ProvisionError(
                    f"The {suite} index is dated {date.isoformat()}, more than "
                    f"{MAX_INDEX_AGE.days} days old; a mirror may be stale."
                )
            print(f"Ubuntu index {suite}: dated {date.isoformat()}", flush=True)


def run_phase(
    name: str, command: list[str], deadline: float, *, timeout_executable: str, stdout=None
) -> None:
    """GNU timeout supervises the whole root-owned process group, including apt/dpkg children."""
    started = time.monotonic()
    remaining_ms = int((deadline - started - KILL_GRACE_SECONDS) * 1000)
    if remaining_ms <= 0:
        raise ProvisionError(f"Provisioning budget exhausted before {name}.")
    # Round down before admission: serializing a positive sub-millisecond value as 0 disables timeout.
    remaining = remaining_ms / 1000
    print(f"Provisioning {name}: start; {remaining:.1f}s available", flush=True)
    result = subprocess.run(
        [
            timeout_executable,
            "--verbose",
            f"--kill-after={KILL_GRACE_SECONDS}s",
            f"{remaining:.3f}s",
            *command,
        ],
        env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"},
        stdout=stdout,
        check=False,
    )
    elapsed = time.monotonic() - started
    print(f"Provisioning {name}: exit={result.returncode}; elapsed={elapsed:.1f}s", flush=True)
    if result.returncode == 124:
        raise ProvisionError(
            f"Provisioning budget exhausted during {name}; required work is incomplete."
        )
    if result.returncode in (137, -9):
        raise ProvisionError(
            f"Provisioning {name} was killed (exit {result.returncode}); "
            "check elapsed time and timeout signal logs for budget exhaustion or external termination."
        )
    if result.returncode:
        raise ProvisionError(f"Provisioning {name} failed (exit {result.returncode}).")


def provision(
    cell: str,
    launcher: str,
    apt_root: Path,
    inventory: Path,
    lists: Path = Path("/var/lib/apt/lists"),
) -> None:
    packages = packages_for(cell, launcher)
    started = time.monotonic()
    deadline = started + BUDGET_SECONDS
    print(f"Provisioning {cell} via {launcher}; budget={BUDGET_SECONDS}s", flush=True)
    timeout_executable = gnu_timeout()
    configure_mirrors(apt_root)
    print("Requested host packages: " + " ".join(packages), flush=True)
    run_phase(
        "index refresh",
        [*APT, "update", "--error-on=any"],
        deadline,
        timeout_executable=timeout_executable,
    )
    check_index_freshness(lists)
    install = ["install", "--no-install-recommends", "-y", *packages]
    run_phase(
        "archive acquisition",
        [*APT, "--download-only", *install],
        deadline,
        timeout_executable=timeout_executable,
    )
    # Installation cannot silently start another network transfer after the bounded download.
    run_phase(
        "installation/configuration",
        [*APT, "--no-download", *install],
        deadline,
        timeout_executable=timeout_executable,
    )
    with inventory.open("w") as stream:
        run_phase(
            "package inventory",
            ["dpkg-query", "-W"],
            deadline,
            timeout_executable=timeout_executable,
            stdout=stream,
        )
    print(f"Provisioning complete; elapsed={time.monotonic() - started:.1f}s", flush=True)


def main() -> int:
    try:
        if len(sys.argv) != 3:
            raise ProvisionError("Usage: ci_linux_dependencies.py <cell> <launcher>")
        if (
            platform.system() != "Linux"
            or os.geteuid() != 0
            or os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        ):
            raise ProvisionError(
                "Host provisioning requires root on a fresh GitHub-hosted Linux VM."
            )
        release = platform.freedesktop_os_release()
        if release.get("ID") != "ubuntu" or release.get("VERSION_ID") != "26.04":
            raise ProvisionError("Host provisioning requires the declared Ubuntu 26.04 runner.")
        provision(
            sys.argv[1],
            sys.argv[2],
            Path("/etc/apt"),
            Path(os.environ["RUNNER_TEMP"]) / "ohtia-native-packages.txt",
        )
    except (ProvisionError, OSError, KeyError, ValueError) as exc:
        print(f"Linux CI provisioning failed: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
