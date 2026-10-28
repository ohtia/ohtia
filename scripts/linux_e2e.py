"""Run the immutable x86-64 Linux E2E environment without host data mounts."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from linux_e2e_image_inputs import fingerprint, inputs

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config/desktop/linux-e2e.json"
IMAGE_NAME = "ghcr.io/ohtia/linux-e2e"
# The image workflow matches this exact text to re-run checks that waited for an image.
MISSING_IMAGE = "No published Linux E2E image matches image inputs {}."
SECCOMP = ROOT / "config/desktop/linux-e2e-seccomp.json"
APPARMOR = ROOT / "config/desktop/linux-e2e.apparmor"


def read_json(file):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON key.")
            result[key] = value
        return result

    return json.loads(Path(file).read_text(encoding="utf-8"), object_pairs_hook=unique)


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def configuration():
    config = read_json(CONFIG)
    require(config["version"] == 1 and config["target"] == "linux-x64", "Invalid Linux E2E scope.")
    require(
        isinstance(config["uid"], int) and config["uid"] > 0 and config["user"] != "root",
        "Root image account refused.",
    )
    require(digest(SECCOMP) == config["seccomp_sha256"], "Unreviewed seccomp profile.")
    require(digest(APPARMOR) == config["apparmor_sha256"], "Unreviewed AppArmor profile.")
    require(config["apparmor_profile"] == "ohtia-linux-e2e-v1", "Unknown AppArmor policy.")
    package = read_json(ROOT / "package.json")
    require(
        package["devDependencies"]["@playwright/test"] == config["playwright"],
        "Image/package parity failed.",
    )
    return config


def command(args, **kwargs):
    kwargs.setdefault("timeout", 600)
    return subprocess.run(args, check=True, **kwargs)


def image_tag(identity):
    """Name the publication built from exactly these declared image inputs."""
    return f"{IMAGE_NAME}:inputs-{identity}"


def container_args(config, name, image_id):
    resources = config["resources"]
    return [
        "create",
        "--name",
        name,
        "--platform",
        "linux/amd64",
        "--interactive",
        "--init",
        "--user",
        config["user"],
        "--workdir",
        config["home"],
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        f"--security-opt=apparmor={config['apparmor_profile']}",
        "--security-opt=systempaths=unconfined",
        f"--security-opt=seccomp={SECCOMP}",
        "--ipc=private",
        "--network=bridge",
        f"--cpus={resources['cpus']}",
        f"--memory={resources['memory_bytes']}",
        f"--memory-swap={resources['memory_bytes']}",
        f"--shm-size={resources['shm_bytes']}",
        f"--pids-limit={resources['pids']}",
        "--env=HOME=/home/pwuser",
        "--env=PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1",
        image_id,
        "sh",
        "-eu",
        "-c",
        "mkdir work && tar --no-same-owner -xf - -C work && exec python3 work/scripts/linux_e2e.py inside",
    ]


def inspect_image(config, image, identity):
    require(
        image["Architecture"] == "amd64" and image["Os"] == "linux",
        "Image identity/platform mismatch.",
    )
    require(image.get("Config", {}).get("User") == config["user"], "Image account mismatch.")
    require(
        re.fullmatch(r"[0-9a-f]{64}", identity)
        and (image["Config"].get("Labels") or {}).get("io.ohtia.image-inputs") == identity,
        "Image/input fingerprint mismatch.",
    )


def inspect_container(config, inspected, image_id):
    """Check effective engine settings, not merely the intended command line."""
    host = inspected["HostConfig"]
    actual = inspected["Config"]
    resources = config["resources"]
    require(not inspected.get("Mounts"), "Host mounts are forbidden.")
    require(inspected["Image"] == image_id, "Wrong container image identity.")
    require(actual["User"] == config["user"], "The container must use its dedicated account.")
    require(not host.get("Privileged"), "Privileged containers are forbidden.")
    require(host.get("NetworkMode") == "bridge", "Private networking required.")
    require(
        host["IpcMode"] == "private"
        and host.get("PidMode", "") in ("", "private")
        and host.get("UTSMode", "") in ("", "private"),
        "Private IPC/PID namespaces required.",
    )
    require(not host.get("CapAdd"), "Extra capabilities are forbidden.")
    require(
        not host.get("Devices") and not host.get("DeviceRequests"),
        "Host device access is forbidden.",
    )
    require(
        not host.get("Binds") and not host.get("VolumesFrom"),
        "Host/container volumes are forbidden.",
    )
    dropped = {value.upper().removeprefix("CAP_") for value in host["CapDrop"]}
    defaults = {
        "CHOWN",
        "DAC_OVERRIDE",
        "FOWNER",
        "FSETID",
        "KILL",
        "NET_BIND_SERVICE",
        "SETFCAP",
        "SETGID",
        "SETPCAP",
        "SETUID",
        "SYS_CHROOT",
        "MKNOD",
        "NET_RAW",
        "AUDIT_WRITE",
    }
    require("ALL" in dropped or defaults <= dropped, "All capabilities must be dropped.")
    require(
        any("no-new-privileges" in value for value in host["SecurityOpt"]),
        "No-new-privileges required.",
    )
    require(
        all(
            value == "no-new-privileges"
            or value == "no-new-privileges=true"
            or value == f"apparmor={config['apparmor_profile']}"
            or value == "systempaths=unconfined"
            or value.startswith("seccomp=")
            for value in host["SecurityOpt"]
        ),
        "Unexpected security override.",
    )
    require(
        inspected.get("AppArmorProfile") == config["apparmor_profile"]
        and f"apparmor={config['apparmor_profile']}" in host["SecurityOpt"],
        "The reviewed nested-sandbox AppArmor policy is required.",
    )
    require(
        not host.get("MaskedPaths") and not host.get("ReadonlyPaths"),
        "Locked path mounts prevent WebKit's private proc namespace.",
    )
    profiles = [
        value.split("=", 1)[1] for value in host["SecurityOpt"] if value.startswith("seccomp=")
    ]
    require(len(profiles) == 1, "One reviewed seccomp profile is required.")
    profile = profiles[0]
    require(
        profile == str(SECCOMP)
        or (profile.startswith("{") and json.loads(profile) == read_json(SECCOMP)),
        "Unreviewed seccomp profile.",
    )
    require(
        host["Memory"] == resources["memory_bytes"]
        and host["MemorySwap"] == resources["memory_bytes"],
        "Incorrect memory limit.",
    )
    require(
        host["ShmSize"] == resources["shm_bytes"] and host["PidsLimit"] == resources["pids"],
        "Incorrect shared memory/PID bounds.",
    )
    cpus = host.get("NanoCpus", 0) / 1e9 or host.get("CpuQuota", 0) / (
        host.get("CpuPeriod", 0) or 100000
    )
    require(cpus == resources["cpus"], "Incorrect CPU bound.")


def account(config, reports, identity):
    require(len(reports) == len(config["shards"]), "Missing/extra shard report.")
    seen = set()
    for report in reports:
        require(report.get("identity") == identity, "Stale/foreign shard identity.")
        shard = report["shard"]
        require(shard in config["shards"] and shard not in seen, "Unknown/duplicate shard.")
        seen.add(shard)
        require(
            report["status"] == "passed" and report["preparation"] == "passed",
            "Failed preparation/shard.",
        )
        cases = report["cases"]
        ids = [case["id"] for case in cases]
        require(
            len(ids) == len(set(ids)) and set(ids) == set(config["shards"][shard]),
            "Incomplete/extra case inventory.",
        )
        require(
            all(case["status"] == "passed" and case["attempts"] == 1 for case in cases),
            "Mandatory case did not pass exactly once.",
        )
    return {
        "status": "passed",
        "shards": len(seen),
        "cases": sum(len(v) for v in config["shards"].values()),
    }


def git_text(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, timeout=60).strip()


def checkout_identity(explicit_base=None, env=None):
    env = os.environ if env is None else env
    checkout = git_text("rev-parse", "HEAD")
    head = checkout
    base = explicit_base
    if env.get("GITHUB_ACTIONS") == "true":
        event = read_json(env["GITHUB_EVENT_PATH"])
        if env.get("GITHUB_EVENT_NAME") == "pull_request":
            head = event["pull_request"]["head"]["sha"]
            event_base = event["pull_request"]["base"]["sha"]
        elif env.get("GITHUB_EVENT_NAME") == "push":
            head = event["after"]
            event_base = event["before"]
            # A branch-creating push has no previous revision; use its default-branch ancestry.
            if event_base == "0" * 40:
                event_base = base or git_text("merge-base", "HEAD", "origin/main")
        elif env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
            head = checkout
            event_base = base or git_text("merge-base", "HEAD", "origin/main")
        else:
            raise ValueError("CI event has no declared head/base identity.")
        require(base is None or base == event_base, "Explicit base disagrees with CI event.")
        base = event_base
        require(env.get("GITHUB_SHA") == checkout, "CI checkout differs from GitHub revision.")
    base = base or git_text("merge-base", "HEAD", "origin/main")
    for revision in (head, base, checkout):
        require(
            isinstance(revision, str) and re.fullmatch(r"[a-f0-9]{40}", revision),
            "Full immutable revision identities required.",
        )
    require(
        git_text("merge-base", base, checkout) == base,
        "Declared base is not an ancestor of the checkout.",
    )
    return {
        "head": head,
        "base": base,
        "checkout_sha": checkout,
        "checkout_tree": git_text("rev-parse", "HEAD^{tree}"),
        "workflow_sha256": digest(ROOT / ".github/workflows/ci.yml"),
        "github_run": env.get("GITHUB_RUN_ID"),
        "github_attempt": env.get("GITHUB_RUN_ATTEMPT"),
    }


def source_tree(files):
    with tempfile.TemporaryDirectory(prefix="ohtia-source-index-") as temporary:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(temporary) / "index")}
        command(["git", "read-tree", "--empty"], cwd=ROOT, env=env)
        command(
            [
                "git",
                "--literal-pathspecs",
                "add",
                "--all",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
            cwd=ROOT,
            env=env,
            input=("\0".join(files) + "\0").encode(),
        )
        return subprocess.check_output(
            ["git", "write-tree"], cwd=ROOT, env=env, text=True, timeout=60
        ).strip()


@contextmanager
def measured(timings, label, destination):
    started = time.monotonic()
    try:
        yield
    finally:
        timings[label] = time.monotonic() - started
        destination.write_text(json.dumps(timings, indent=2) + "\n")


def source_archive(destination, identity):
    files = (
        subprocess.check_output(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT
        )
        .decode()
        .split("\0")
    )
    hashes = {}
    with tarfile.open(destination, "w") as archive:
        for name in sorted(set(filter(None, files))):
            if name == "linux-e2e-input.json":
                continue
            file = ROOT / name
            if not file.exists():
                continue
            require(
                file.is_file() and not file.is_symlink(),
                "Only regular source files may enter the container.",
            )
            require(
                not name.startswith((".git/", ".aws/", ".ssh/", ".codex/"))
                and not file.name.startswith(".env"),
                "Credential input refused.",
            )
            hashes[name] = digest(file)
            archive.add(file, arcname=name, recursive=False)
        identity["files"] = hashes
        identity["candidate_tree"] = source_tree(hashes)
        identity["source_sha256"] = hashlib.sha256(
            json.dumps(hashes, sort_keys=True).encode()
        ).hexdigest()
        data = (json.dumps(identity, sort_keys=True) + "\n").encode()
        entry = tarfile.TarInfo("linux-e2e-input.json")
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))
    return hashes


def resolved_image(engine, config, identity):
    """Use the image built from the declared inputs: local cache first, else its publication."""
    tag = image_tag(identity)

    def inspect():
        return subprocess.run(
            [engine, "image", "inspect", tag],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    result = inspect()
    cache = "cached"
    if result.returncode:
        require(
            any(
                marker in result.stderr.lower()
                for marker in ("no such image", "image not known", "no images found")
            ),
            "Cannot inspect the Linux E2E image; restore engine access without changing inputs.",
        )
        pulled = subprocess.run(
            [engine, "pull", "--platform", "linux/amd64", tag],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        if pulled.returncode:
            missing = any(
                marker in pulled.stderr.lower() for marker in ("not found", "manifest unknown")
            )
            raise ValueError(
                MISSING_IMAGE.format(identity)
                + " The 'Build Linux E2E image' workflow builds it after a push that changes "
                "those inputs and then re-runs this check."
                if missing
                else f"Cannot pull the Linux E2E image: {pulled.stderr.strip()[-500:]}"
            )
        result = inspect()
        require(result.returncode == 0, "The pulled Linux E2E image cannot be inspected.")
        cache = "downloaded"
    image = json.loads(result.stdout)[0]
    inspect_image(config, image, identity)
    digests = sorted(
        {
            value.split("@", 1)[1]
            for value in image.get("RepoDigests") or []
            if value.startswith(IMAGE_NAME + "@sha256:")
        }
    )
    return image, digests, cache


def copy_reports(engine, name, output):
    command(
        [engine, "cp", f"{name}:/home/pwuser/work/.reports/linux-e2e", str(output / "container")],
        timeout=60,
    )


def snapshot_reports(config, output, result):
    reports = []
    errors = []
    for name in config["shards"]:
        file = output / f"container/{name}.json"
        if file.exists():
            try:
                report = read_json(file)
                require(isinstance(report, dict), "Invalid shard report object.")
                reports.append(report)
            except (OSError, ValueError) as error:
                errors.append(f"{name}: {error}")
    result["reports"] = reports
    timing_file = output / "container/timings.json"
    if timing_file.exists():
        try:
            result["container_timings_seconds"] = read_json(timing_file)
        except (OSError, ValueError) as error:
            errors.append(f"timings: {error}")
    if errors:
        result["report_errors"] = errors
    return reports, errors


def run(engine, output, base=None):
    require(engine == "docker", "Only the reviewed Docker/AppArmor route is admitted.")
    config = configuration()
    require(
        platform.system() == "Linux" and platform.machine() in ("x86_64", "amd64"),
        "Use a native Linux x86-64 host; emulation is not accepted.",
    )
    output = output.absolute()
    require(not output.exists(), "Use a new output directory; failed evidence is preserved.")
    identity = {
        "run": str(uuid.uuid4()),
        **checkout_identity(base),
        "host_architecture": platform.machine(),
    }
    output.mkdir(parents=True)
    result = {"status": "failed", "identity": identity, "timings_seconds": {}}
    result_file = output / "result.json"
    result_file.write_text(json.dumps(result, indent=2) + "\n")
    name = "ohtia-e2e-" + identity["run"]
    created = False
    try:
        architecture_field = "{{json .Architecture}}"
        engine_arch = json.loads(
            subprocess.check_output([engine, "info", "--format", architecture_field], timeout=60)
        )
        require(engine_arch in ("amd64", "x86_64"), "Container engine host is not native x86-64.")
        security = subprocess.check_output(
            [engine, "info", "--format", "{{json .SecurityOptions}}"], text=True, timeout=60
        )
        require("name=apparmor" in json.loads(security), "An enforcing AppArmor host is required.")
        result["engine_architecture"] = engine_arch
        identity["input_fingerprint"] = fingerprint(inputs())
        with measured(result["timings_seconds"], "image_preparation", output / "host-timings.json"):
            image, digests, cache_state = resolved_image(
                engine, config, identity["input_fingerprint"]
            )
            result["image_cache"] = cache_state
        # The registry digest is recorded per run; Git fixes the inputs the image was built from.
        identity["image"] = image_tag(identity["input_fingerprint"]) + (
            "@" + digests[0] if len(digests) == 1 else ""
        )
        identity["image_id"] = image["Id"]
        identity["image_repo_digests"] = digests
        with tempfile.TemporaryDirectory(prefix="ohtia-linux-source-") as temporary:
            archive = Path(temporary) / "source.tar"
            source_archive(archive, identity)
            command([engine, *container_args(config, name, image["Id"])], stdout=subprocess.DEVNULL)
            created = True
            inspected = json.loads(subprocess.check_output([engine, "inspect", name], timeout=60))[
                0
            ]
            inspect_container(config, inspected, image["Id"])
            (output / "container-policy.json").write_text(json.dumps(inspected, indent=2) + "\n")
            with (
                measured(
                    result["timings_seconds"], "setup_and_tests", output / "host-timings.json"
                ),
                archive.open("rb") as source,
            ):
                try:
                    execution = subprocess.run(
                        [engine, "start", "--attach", "--interactive", name],
                        stdin=source,
                        timeout=600,
                        check=False,
                    )
                except (OSError, subprocess.SubprocessError) as error:
                    result["execution_error"] = str(error)
                    try:
                        command([engine, "stop", "--time", "10", name], timeout=30)
                    except (OSError, subprocess.SubprocessError) as error:
                        result["stop_error"] = str(error)
                    try:
                        copy_reports(engine, name, output)
                        snapshot_reports(config, output, result)
                    except (OSError, subprocess.SubprocessError) as error:
                        result["evidence_error"] = str(error)
                    raise
            result["container_exit"] = execution.returncode
            copy_error = None
            try:
                copy_reports(engine, name, output)
            except (OSError, subprocess.SubprocessError) as error:
                result["evidence_error"] = str(error)
                copy_error = error
            reports, report_errors = snapshot_reports(config, output, result)
            require(execution.returncode == 0, "Container preparation/tests failed.")
            if copy_error is not None:
                raise copy_error
            require(not report_errors, "Invalid container evidence; inspect report_errors.")
            observed = read_json(output / "container/input.json")
            require(observed == identity, "Container tested another source/run identity.")
            result.update(account(config, reports, identity))
    finally:
        primary_failure = sys.exc_info()[0] is not None
        try:
            if created:
                command([engine, "rm", "--force", name], stdout=subprocess.DEVNULL, timeout=60)
        except (OSError, subprocess.SubprocessError) as error:
            result["status"] = "failed"
            result["cleanup_error"] = str(error)
            result["retained_container"] = name
            if not primary_failure:
                raise
        finally:
            result_file.write_text(json.dumps(result, indent=2) + "\n")
            if os.environ.get("GITHUB_ACTIONS") == "true":
                receipt = {
                    **result,
                    "identity": {key: value for key, value in identity.items() if key != "files"},
                    "file_count": len(identity.get("files", {})),
                }
                receipt["reports"] = [
                    {
                        **report,
                        "identity": {
                            key: value
                            for key, value in report["identity"].items()
                            if key != "files"
                        },
                    }
                    for report in result.get("reports", [])
                ]
                print("OHTIA_LINUX_E2E_RESULT=" + json.dumps(receipt, separators=(",", ":")))
            else:
                print(f"Linux E2E {result['status']}; evidence: {result_file}")


def inspect_apparmor(config):
    require(
        Path("/proc/self/attr/current").read_text().strip()
        == f"{config['apparmor_profile']} (enforce)",
        "The reviewed AppArmor profile is not enforcing.",
    )
    for file, flags in (
        ("/proc/interrupts", os.O_RDONLY),
        ("/proc/keys", os.O_RDONLY),
    ):
        try:
            descriptor = os.open(file, flags)
        except PermissionError:
            continue
        else:
            os.close(descriptor)
            raise ValueError(f"Sensitive kernel path is not denied: {file}")


def require_unused_policy():
    """Permit removal only after a successful readback proves no container uses it."""
    config = configuration()
    identifiers = subprocess.check_output(
        ["docker", "ps", "--all", "--quiet", "--no-trunc"], text=True, timeout=60
    ).split()
    require(
        all(re.fullmatch(r"[0-9a-f]{64}", value) for value in identifiers),
        "Cannot establish container identities; retain the AppArmor profile.",
    )
    if not identifiers:
        return
    profiles = subprocess.check_output(
        ["docker", "inspect", "--format", "{{json .AppArmorProfile}}", *identifiers],
        text=True,
        timeout=60,
    ).splitlines()
    require(len(profiles) == len(identifiers), "Incomplete policy readback; retain AppArmor.")
    require(
        all(json.loads(value) != config["apparmor_profile"] for value in profiles),
        "A container still uses the E2E AppArmor profile; retain it until cleanup succeeds.",
    )


def inside():
    config = configuration()
    import pwd

    user = pwd.getpwuid(os.getuid())
    require(
        os.getuid() != 0
        and os.getuid() == config["uid"]
        and user.pw_name == config["user"]
        and user.pw_dir == config["home"],
        "Root/foreign account refused.",
    )
    status = Path("/proc/self/status").read_text()
    require(
        all(
            f"{key}:\t0000000000000000" in status
            for key in ("CapEff", "CapPrm", "CapBnd", "CapAmb")
        )
        and "NoNewPrivs:\t1" in status
        and "Seccomp:\t2" in status,
        "Container capability/seccomp policy is inactive.",
    )
    inspect_apparmor(config)
    require(platform.machine() == "x86_64" and sys.platform == "linux", "Wrong native target.")
    require(
        not any(
            Path(p).exists() for p in ("/var/run/docker.sock", "/run/podman/podman.sock", "/host")
        ),
        "Host service/data mount refused.",
    )
    require(
        not any(
            key in os.environ
            for key in (
                "DISPLAY",
                "WAYLAND_DISPLAY",
                "DBUS_SESSION_BUS_ADDRESS",
                "XAUTHORITY",
                "SSH_AUTH_SOCK",
            )
        ),
        "Host display/session/credentials refused.",
    )
    for executable in (
        "python3",
        "git",
        "Xvfb",
        "xvfb-run",
        "xauth",
        "dbus-run-session",
        "unshare",
    ):
        require(shutil.which(executable), f"Missing reviewed OS dependency: {executable}.")
    command(["unshare", "--user", "--map-root-user", "--pid", "--fork", "true"])
    report = ROOT / ".reports/linux-e2e"
    report.mkdir(parents=True)
    identity = read_json(ROOT / "linux-e2e-input.json")
    for name, expected in identity["files"].items():
        require(digest(ROOT / name) == expected, "Transferred source changed.")
    (report / "input.json").write_text(json.dumps(identity, indent=2) + "\n")
    timings = {}
    for label in ("cold_setup", "warm_setup"):
        with measured(timings, label, report / "timings.json"):
            command([sys.executable, str(ROOT / "scripts/workspace.py"), "setup"], cwd=ROOT)
    import workspace

    env = workspace.environment()
    env.update(
        {"PLAYWRIGHT_BROWSERS_PATH": "/ms-playwright", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"}
    )
    command([str(workspace.node_path()), "tooling/linux-e2e.mjs", "parity"], cwd=ROOT, env=env)
    with measured(timings, "build", report / "timings.json"):
        command([str(workspace.node_path()), "tooling/workspace.mjs", "build"], cwd=ROOT, env=env)
    home = Path(user.pw_dir)
    scratch = home / "scratch"
    for directory in (home / ".config", home / "ohtia", scratch):
        directory.mkdir(mode=0o700, exist_ok=True)
    stable = {}
    for key in ("configuration", "store", "recovery"):
        directory = Path("/tmp/ohtia-stable") / key
        directory.mkdir(parents=True, mode=0o700)
        sentinel = directory / ".ohtia-runtime-sentinel"
        sentinel.write_text("synthetic isolated container fixture\n")
        stable[key] = {"root": str(directory), "sentinel_sha256": digest(sentinel)}
    profile = {
        "schema_version": 1,
        "kind": "independent-native-profile",
        "inspected_by": "agent:ohtia-linux-e2e",
        "username": user.pw_name,
        "target": "linux-x64",
        "home": str(home),
        "configuration_root": str(home / ".config"),
        "research_root": str(home / "ohtia"),
        "scratch_root": str(scratch),
        "stable_roots": stable,
        "manual_checks": dict.fromkeys(
            (
                "independent_account_or_vm",
                "no_emulation",
                "local_owned_unsynchronized_volumes",
                "no_credentials",
                "stable_roots_complete",
                "native_security_and_display",
            ),
            True,
        ),
    }
    profile_file = scratch / "runtime-profile.json"
    profile_file.write_text(json.dumps(profile) + "\n")
    command(
        [
            str(workspace.python_path()),
            "scripts/desktop_runtime.py",
            "linux-x64",
            str(scratch / "prepared"),
        ],
        cwd=ROOT,
        env=env,
    )
    runtime = scratch / "session"
    runtime.mkdir(mode=0o700)
    env.update({"XDG_RUNTIME_DIR": str(runtime), "XDG_SESSION_TYPE": "x11", "LANG": "C.UTF-8"})
    with measured(timings, "tests", report / "timings.json"):
        command(
            [
                "dbus-run-session",
                "--",
                "xvfb-run",
                "--auto-servernum",
                "--server-args=-screen 0 1280x800x24 -nolisten tcp",
                str(workspace.node_path()),
                "tooling/linux-e2e.mjs",
                "test",
                str(profile_file),
                str(scratch / "prepared"),
            ],
            cwd=ROOT,
            env=env,
        )
    account(config, [read_json(report / f"{name}.json") for name in config["shards"]], identity)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "inside", "policy-unused", "policy-check"))
    parser.add_argument("--engine", choices=("docker",), default="docker")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--base")
    args = parser.parse_args()
    try:
        if args.command == "inside":
            inside()
        elif args.command == "policy-unused":
            require_unused_policy()
        elif args.command == "policy-check":
            configuration()
        else:
            require(args.output is not None, "A new --output directory is required.")
            run(args.engine, args.output, args.base)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(
            f"Linux E2E refused: {error}. No sandbox or download fallback is permitted.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
