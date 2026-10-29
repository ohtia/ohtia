"""Bootstrap and diagnose native Apple Silicon contribution (bootstrap Python >=3.9)."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import plistlib
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent


class ContributorError(Exception):
    """A controlled failure safe to include in a shareable diagnosis."""


def command(arguments, *, cwd=ROOT, env=None, timeout=30):
    """Keep native errors, paths and inherited environment out of diagnostics."""
    remedies = {
        "/usr/bin/xcode-select": "Apple developer tools unavailable; run xcode-select --install, complete Apple's consent/license interface, then retry doctor.",
        "/usr/bin/xcrun": "Apple compiler/SDK unavailable; run xcode-select --install or finish the selected Xcode license, then retry doctor.",
        "/usr/bin/git": "Apple Git unavailable; run xcode-select --install, complete installation, then retry doctor.",
        "/bin/launchctl": "No native GUI session for this account; log into its graphical desktop and retry doctor.",
        "/usr/bin/codesign": "Apple code-signing tool verification failed; restore the OS developer tools and retry doctor without disabling platform controls.",
        "/usr/sbin/diskutil": "Cannot inspect the native volume; use an accessible local APFS home and checkout, then retry doctor.",
    }
    remediation = remedies.get(
        str(arguments[0]),
        "Tool failed or timed out; follow docs/macos-contribution.md#recovery, verify prerequisites and network access, then retry without changing locks.",
    )
    try:
        result = subprocess.run(
            [str(item) for item in arguments],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ContributorError(remediation) from error
    if result.returncode:
        raise ContributorError(remediation)
    return result.stdout.strip()


def require(condition, diagnostic):
    if not condition:
        raise ContributorError(diagnostic)


def sha256(file):
    result = hashlib.sha256()
    with file.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def filesystem(directory):
    rows = command(["/bin/df", "-P", directory]).splitlines()
    require(
        len(rows) == 2 and rows[1].split()[0].startswith("/dev/"),
        "Use a local APFS volume; network volumes are not qualified.",
    )
    info = plistlib.loads(
        command(["/usr/sbin/diskutil", "info", "-plist", rows[1].split()[0]]).encode()
    )
    require(
        info.get("FilesystemType", "").lower() == "apfs",
        "Move this checkout and test home to local APFS, then retry doctor.",
    )
    return "apfs"


def preflight():
    require(sys.platform == "darwin", "Use a native macOS 26 or 27 Apple Silicon host.")
    release = command(["/usr/bin/sw_vers", "-productVersion"])
    require(
        release.split(".")[0] in {"26", "27"},
        "This contributor route requires macOS 26 or 27; other families are not qualified here.",
    )
    # On a native process the optional translation key can be absent, but ARM hardware
    # and the actual interpreter architecture must independently agree.
    translated = subprocess.run(
        ["/usr/sbin/sysctl", "-in", "sysctl.proc_translated"],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    require(
        translated.returncode in {0, 1} and translated.stdout.strip() in {"", "0"},
        "Rosetta is not admitted; reopen Terminal and Python natively on Apple Silicon.",
    )
    require(
        platform.machine() == "arm64"
        and command(["/usr/sbin/sysctl", "-n", "hw.optional.arm64"]) == "1",
        "Wrong CPU/interpreter architecture; use native ARM64 Python and Terminal, not Rosetta or Intel binaries.",
    )
    require(os.getuid() != 0, "Run contribution commands as an ordinary account, without sudo.")
    import pwd

    account = pwd.getpwuid(os.getuid())
    home = Path(account.pw_dir)
    require(
        home.resolve() == home and Path(__file__).absolute() == Path(__file__).resolve(),
        "Use canonical, unaliased home and checkout directories.",
    )
    for name in (".tooling", ".cache", ".venv", "node_modules"):
        local = ROOT / name
        require(
            not local.is_symlink() and (not local.exists() or local.resolve() == local),
            "Checkout tool/cache directory is aliased; use separate checkout-local environments and retry doctor.",
        )
    for directory in (home, ROOT):
        require(
            directory.stat().st_uid == os.getuid()
            and os.access(directory, os.R_OK | os.W_OK | os.X_OK),
            "Home or checkout access denied; restore current-account ownership/access and retry doctor without sudo.",
        )
        filesystem(directory)
    command(["/usr/bin/xcode-select", "-p"])
    command(["/usr/bin/git", "--version"])
    clang = command(["/usr/bin/xcrun", "clang", "--version"])
    require(
        "arm64-apple-darwin" in clang,
        "Select native Apple developer tools using xcode-select; reopen a native shell and retry doctor.",
    )
    sdk = command(["/usr/bin/xcrun", "--show-sdk-version"])
    # This is session availability, not profile admission or sandbox qualification.
    command(["/bin/launchctl", "print", "gui/" + str(os.getuid())])
    command(["/usr/bin/codesign", "--verify", "/usr/bin/codesign"])
    return {
        "macos": release,
        "architecture": "arm64",
        "filesystem": "apfs",
        "clang": clang.splitlines()[0],
        "sdk": sdk,
        "gui_session": "available",
    }


def extract_python(archive, destination):
    """Extract the authenticated pin without special files or escaping links (Python 3.9)."""
    destination = destination.resolve(strict=True)
    links = []
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            relative = PurePosixPath(member.name)
            require(
                not relative.is_absolute()
                and ".." not in relative.parts
                and relative.parts
                and relative.parts[0] == "python",
                "Invalid pinned Python archive; restore the reviewed toolchain input.",
            )
            file = destination.joinpath(*relative.parts)
            require(
                file.resolve().is_relative_to(destination.resolve()),
                "Escaping pinned Python archive path.",
            )
            if member.isdir():
                file.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                file.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, file.open("xb") as output:
                    shutil.copyfileobj(data, output)
                file.chmod(member.mode & 0o755)
            elif member.issym():
                target = Path(member.linkname)
                require(
                    not target.is_absolute()
                    and (file.parent / target)
                    .resolve()
                    .is_relative_to((destination / "python").resolve()),
                    "Escaping pinned Python archive link.",
                )
                links.append((file, member.linkname))
            else:
                raise ContributorError(
                    "Unsupported pinned Python archive entry; preserve the cache and report the manifest input."
                )
    for file, target in links:
        try:
            parent = file.parent.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise ContributorError("Invalid pinned Python link parent.") from error
        require(
            parent == file.parent and parent.is_relative_to((destination / "python").resolve()),
            "Pinned Python link parent must be an ordinary directory inside its installed tree.",
        )
        require(
            not file.exists() and not file.is_symlink(), "Duplicate pinned Python archive link."
        )
        file.symlink_to(target)
    for file, _target in links:
        try:
            contained = file.resolve().is_relative_to((destination / "python").resolve())
        except (OSError, RuntimeError) as error:
            raise ContributorError("Invalid pinned Python link chain.") from error
        require(contained, "Escaping pinned Python link chain.")


def bootstrap_python():
    tools = json.loads((ROOT / "config/desktop/toolchain.json").read_text())["tools"]
    python = ROOT / ".tooling/python/bin/python3"
    if python.exists():
        require(
            command([python, "--version"]) == "Python " + tools["python"]["version"],
            "Local Python version mismatch; preserve the failed attempt, remove only .tooling/python after confirming no active command, and rerun setup.",
        )
        require(
            command([python, "-I", "-c", "import platform; print(platform.machine())"]) == "arm64",
            "Local Python architecture mismatch; remove only .tooling/python after confirming cessation and retry native setup.",
        )
        return python
    record = tools["python"]["artifacts"]["darwin-arm64"]
    cache = ROOT / ".cache/macos-bootstrap"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / (record["sha256"] + ".tar.gz")
    if not archive.exists() or sha256(archive) != record["sha256"]:
        partial = cache / "python.partial"
        try:
            with (
                urllib.request.urlopen(record["url"], timeout=120) as response,
                partial.open("wb") as output,
            ):
                shutil.copyfileobj(response, output)
            require(
                sha256(partial) == record["sha256"],
                "Python download digest mismatch; no downloaded interpreter was executed. Retry setup after verifying network and reviewed manifest.",
            )
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    (ROOT / ".tooling").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ROOT / ".tooling", prefix="macos-bootstrap-") as temporary:
        extract_python(archive, Path(temporary))
        (Path(temporary) / "python").rename(ROOT / ".tooling/python")
    require(
        command([python, "--version"]) == "Python " + tools["python"]["version"],
        "Pinned Python failed version verification; preserve the attempt and retry setup after repairing .tooling/python.",
    )
    return python


def mutating_command(arguments, *, env=None, timeout=1800, grace=5, phase="setup"):
    """Contain trusted tool children; retain an unreaped leader through group cleanup."""
    from probe_process import run_owned

    print("Running pinned " + phase + "; tool output is checked before sharing.", flush=True)
    kinds = [
        getattr(signal, name)
        for name in ("SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT")
        if hasattr(signal, name)
    ]
    previous_handlers = {kind: signal.getsignal(kind) for kind in kinds}
    interruption_requested = False

    def interrupted(_signum, _frame):
        nonlocal interruption_requested
        # Latching avoids throwing through Popen or descriptor restoration. The
        # supervisor requests graceful group termination and verifies cleanup.
        interruption_requested = True

    for kind in previous_handlers:
        signal.signal(kind, interrupted)
    saved = []
    try:
        with tempfile.TemporaryFile(mode="w+b") as output:
            sys.stdout.flush()
            sys.stderr.flush()
            try:
                for descriptor in (1, 2):
                    saved.append((descriptor, os.dup(descriptor)))
                    os.dup2(output.fileno(), descriptor)
                try:
                    result = run_owned(
                        [str(item) for item in arguments],
                        ROOT,
                        dict(os.environ) if env is None else env,
                        timeout,
                        grace,
                        cancelled=lambda: interruption_requested,
                    )
                except (OSError, subprocess.SubprocessError) as error:
                    raise ContributorError(
                        "Pinned "
                        + phase
                        + " cleanup is unverified; retain the attempt and setup lock. Do not retry until native process inspection proves that checkout writers have stopped."
                    ) from error
            finally:
                for descriptor, original in saved:
                    os.dup2(original, descriptor)
                    os.close(original)
                saved.clear()
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 262144))
            transcript = output.read().decode("utf-8", errors="replace")
        require(
            not result["contained_processes_remaining_after_cleanup"],
            "Pinned "
            + phase
            + " process-group cessation is unverified; retain the attempt and lock and inspect native processes before retrying.",
        )
        if result.get("interrupted") or interruption_requested:
            raise ContributorError(
                "Pinned "
                + phase
                + " interrupted; its contained process group was stopped. Preserve the attempt and inspect the checkout's setup lock before retrying."
            )
        if result["timed_out"]:
            raise ContributorError(
                "Pinned "
                + phase
                + " timed out; its contained process group was stopped. Preserve the attempt and inspect the setup lock before retrying."
            )
        if result["exit_code"] or result["contained_processes_remaining_at_exit"]:
            reasons = (
                (
                    ("digest mismatch",),
                    "Pinned tool download digest mismatch; remove only the damaged checkout cache entry after verifying the manifest, then retry setup --install-tools.",
                ),
                (
                    ("changed a lockfile", "Command changed a lockfile"),
                    "Frozen installation changed a lockfile; stop and inspect git diff. Restore reviewed inputs before retrying setup --install-tools.",
                ),
                (
                    ("version mismatch",),
                    "Pinned tool/dependency version mismatch; repair the affected checkout-local tool and retry setup --install-tools without global upgrades.",
                ),
                (
                    ("Another setup owns",),
                    "A setup lock already exists; verify its recorded PID and all checkout writers have stopped before removing a stale lock and retrying.",
                ),
                (
                    ("archive has an unexpected layout", "Unsafe archive"),
                    "Pinned tool archive layout refused; preserve the cache, restore the reviewed manifest and retry setup --install-tools.",
                ),
                (
                    ("ERR_PNPM_OUTDATED_LOCKFILE",),
                    "Frozen dependency inputs disagree; restore the reviewed manifests and locks, then retry setup --install-tools without regenerating locks.",
                ),
                (
                    ("ENOSPC", "No space left"),
                    "Local APFS space exhausted; retain failed outputs, free space outside research data and retry with a new package attempt.",
                ),
                (
                    ("EACCES", "EPERM", "Permission denied"),
                    "Tool output access denied; restore current-account access to the checkout/scratch roots and retry without sudo.",
                ),
                (
                    ("Command failed: /usr/bin/codesign",),
                    "Local ad-hoc code signing failed; verify Apple tools and native inputs, then retry packaging with a new --output directory.",
                ),
            )
            for markers, diagnostic in reasons:
                if any(marker in transcript for marker in markers):
                    raise ContributorError(diagnostic)
            raise ContributorError(
                "Pinned "
                + phase
                + " failed; verify HTTPS access to the manifest/registry endpoints, reviewed locks, local APFS space and developer tools. Preserve failed outputs and retry setup --install-tools or package with a new --output directory; do not change global tools."
            )
    finally:
        for descriptor, original in saved:
            os.dup2(original, descriptor)
            os.close(original)
        for kind, handler in previous_handlers.items():
            signal.signal(kind, handler)


def setup(started=None):
    # Cooperate with workspace.py's same exclusive lock until the interpreter is
    # installed, then release it before the common setup acquires its own lock.
    tools = ROOT / ".tooling"
    tools.mkdir(exist_ok=True)
    lock = tools / "setup.lock"
    try:
        stream = lock.open("x")
    except FileExistsError as error:
        raise ContributorError(
            "Setup already owns .tooling/setup.lock; confirm its PID has stopped before removing a stale lock and retrying."
        ) from error
    try:
        with stream:
            stream.write(str(os.getpid()))
        python = bootstrap_python()
    finally:
        lock.unlink(missing_ok=True)
    if sys.version_info < (3, 12):
        # Apple's Python lacks the non-reaping waitid primitive. Replace this
        # launcher before starting any long-lived tool subtree; do not add an
        # unsupervised intermediate process.
        env = dict(os.environ)
        for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
            env.pop(key, None)
        env["PYTHONNOUSERSITE"] = "1"
        env["OHTIA_MACOS_SETUP_STARTED"] = str(time.monotonic() if started is None else started)
        os.execve(
            python, [str(python), str(Path(__file__).resolve()), "setup", "--install-tools"], env
        )
    mutating_command(
        [python, "-I", ROOT / "scripts/workspace.py", "setup"], phase="frozen workspace setup"
    )


def managed_environment():
    # Imported only after the pinned interpreter is available; system Python 3.9
    # cannot import the shared workspace's Python 3.12 maintenance dependencies.
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        import workspace

        return workspace.environment()
    finally:
        sys.dont_write_bytecode = previous


def workspace_doctor():
    python = ROOT / ".tooling/python/bin/python3"
    require(
        python.is_file(),
        "Run /usr/bin/python3 scripts/macos_contributor.py setup --install-tools first.",
    )
    for relative in (
        ".tooling/node/bin/node",
        ".tooling/pnpm/bin/pnpm.mjs",
        ".tooling/pnpm/pnpm-native",
        ".tooling/uv/uv",
        ".venv/bin/python",
    ):
        require(
            (ROOT / relative).is_file(),
            "Missing "
            + relative
            + "; rerun /usr/bin/python3 scripts/macos_contributor.py setup --install-tools in this checkout, then retry doctor --workspace.",
        )
    try:
        command([python, "-I", ROOT / "scripts/workspace.py", "doctor"], timeout=120)
    except ContributorError as error:
        raise ContributorError(
            "Frozen workspace tools or dependencies failed validation; rerun setup --install-tools in this checkout and retry doctor --workspace without changing locks or global tools."
        ) from error


def admit(profile, prepared):
    require(
        profile is not None and prepared is not None,
        "Supply --profile and --prepared with absolute inspected profile and prepared runtime paths.",
    )
    require(
        profile.is_absolute() and prepared.is_absolute(),
        "Use absolute --profile and --prepared paths; follow docs/desktop-runtime.md.",
    )
    node = ROOT / ".tooling/node/bin/node"
    script = "import { admittedLaunch } from './tooling/desktop-launch.mjs'; admittedLaunch(process.argv[1],process.argv[2]);"
    try:
        command(
            [node, "--input-type=module", "-e", script, profile, prepared],
            env=managed_environment(),
            timeout=120,
        )
    except ContributorError as error:
        raise ContributorError(
            "Native launch admission refused; inspect the profile, stable-root exclusions and prepared-byte identities using docs/desktop-runtime.md, then retry doctor with an inspected profile and a fresh unchanged runtime. No Electron process was launched."
        ) from error


def package(profile, prepared, output):
    admit(profile, prepared)
    require(
        output is not None
        and output.is_absolute()
        and not output.exists()
        and output.parent.resolve() == output.parent,
        "Use a new absolute --output directory with an existing canonical parent inside the admitted scratch root.",
    )
    # The JS admission above validates the complete record before its scratch path
    # is used here; no profile is manufactured or approved by this setup tool.
    record = json.loads(profile.read_text())
    require(
        output.is_relative_to(Path(record["scratch_root"])),
        "Package output must stay inside the admitted scratch root.",
    )
    import quality_native

    require(
        not output.is_relative_to(prepared.resolve())
        and not prepared.resolve().is_relative_to(output),
        "Package output must not overlap the immutable prepared runtime; choose a new sibling attempt inside scratch.",
    )
    config = quality_native.configuration(
        {
            "target": "darwin-arm64",
            "profile": "macos-" + platform.mac_ver()[0].split(".")[0],
            "formats": ["dmg", "zip"],
        },
        prepared,
        output / "packages",
        "0.0.0-dev.1.1",
    )
    output.mkdir()
    configuration = output / "builder.json"
    configuration.write_text(json.dumps(config, indent=2) + "\n")
    mutating_command(
        [ROOT / ".tooling/node/bin/node", "tooling/quality-package.mjs", configuration],
        env=quality_native.build_environment(),
        phase="local quality packaging",
    )
    artifacts = sorted((output / "packages").glob("*.dmg")) + sorted(
        (output / "packages").glob("*.zip")
    )
    require(
        len(artifacts) == 2,
        "Expected one native DMG and ZIP; preserve the package attempt and retry with a new output directory.",
    )
    receipt = {
        "version": 1,
        "target": "darwin-arm64",
        "prepared_sha256": sha256(prepared / "prepared.json"),
        "packages": [
            {"name": file.name, "sha256": sha256(file), "bytes": file.stat().st_size}
            for file in artifacts
        ],
    }
    (output / "packages.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("doctor", "setup", "package"))
    parser.add_argument(
        "--install-tools",
        action="store_true",
        help="Consent to pinned checkout-local tool/dependency downloads; never installs OS packages.",
    )
    parser.add_argument(
        "--workspace",
        action="store_true",
        help="Also check effective frozen workspace tools/dependencies.",
    )
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    started = time.monotonic()
    inherited_start = os.environ.pop("OHTIA_MACOS_SETUP_STARTED", None)
    if inherited_start is not None:
        try:
            observed_start = float(inherited_start)
            if math.isfinite(observed_start) and started - 3600 <= observed_start <= started:
                started = observed_start
        except ValueError:
            pass
    try:
        report = preflight()
        if args.command == "package" or args.workspace or args.profile or args.prepared:
            require(
                sys.version_info >= (3, 12),
                "Use .tooling/python/bin/python3 scripts/macos_contributor.py for workspace/profile/package checks after setup.",
            )
        if args.command == "setup":
            require(
                args.install_tools,
                "Setup downloads the manifest's pinned Python, Node, pnpm, uv and frozen dependencies into this checkout. Review docs/macos-contribution.md, then add --install-tools to consent.",
            )
            setup(started)
        elif args.command == "package":
            workspace_doctor()
            report["package"] = package(args.profile, args.prepared, args.output)
        else:
            if args.workspace or args.profile or args.prepared:
                workspace_doctor()
            if args.profile or args.prepared:
                admit(args.profile, args.prepared)
                report["launch_admission"] = "passed-without-launch"
        report["command"] = args.command
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        print(json.dumps(report, indent=2))
    except KeyboardInterrupt:
        print(
            "macOS contribution interrupted; preserve the attempt and inspect active checkout processes and its setup lock before retrying.",
            file=sys.stderr,
        )
        return 1
    except (
        ContributorError,
        OSError,
        ValueError,
        KeyError,
        tarfile.TarError,
        subprocess.SubprocessError,
    ) as error:
        diagnostic = (
            str(error)
            if isinstance(error, ContributorError)
            else "Native inspection or pinned input unavailable; follow docs/macos-contribution.md#recovery and retry."
        )
        print("macOS contribution stopped: " + diagnostic, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
