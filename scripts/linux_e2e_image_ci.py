"""Hosted Linux image construction, qualification, publication and consumer re-run."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import linux_e2e
from linux_e2e_image_inputs import fingerprint, inputs

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / ".reports/linux-e2e-image"
REPOSITORY = "ohtia/ohtia"
REGISTRY = "ghcr.io"
PACKAGE = "ohtia/linux-e2e"
WORKFLOW = ".github/workflows/linux-e2e-image.yml"
CONSUMER = ".github/workflows/ci.yml"
MARKER = "OHTIA_LINUX_E2E_IMAGE_PUBLICATION="
MANIFEST_TYPES = ", ".join(
    (
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    )
)


def command(arguments, **options):
    return subprocess.run(arguments, check=True, **options)


def captured(arguments, **options):
    return subprocess.check_output(arguments, text=True, **options).strip()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def context():
    sha = os.environ.get("GITHUB_SHA", "")
    require(
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
        and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY
        and os.environ.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch")
        and re.fullmatch(r"[0-9a-f]{40}", sha)
        and captured(["git", "rev-parse", "HEAD"]) == sha,
        "Hosted production requires this repository's GitHub-hosted image workflow.",
    )
    # Qualification needs this identity; refuse an unusable event before paying for a build.
    linux_e2e.checkout_identity()
    return {
        "producer": "github-hosted",
        "source_commit": sha,
        "source_tree": captured(["git", "rev-parse", "HEAD^{tree}"]),
        "run_url": f"https://github.com/{REPOSITORY}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
    }


def credentials():
    return os.environ["GH_ACTOR"], os.environ["GH_TOKEN"]


def registry_token(scope, credential):
    url = f"https://{REGISTRY}/token?service={REGISTRY}&scope=repository:{PACKAGE}:{scope}"
    actor, token = credential
    authorization = base64.b64encode(f"{actor}:{token}".encode()).decode()
    request = urllib.request.Request(url, headers={"Authorization": "Basic " + authorization})
    with urllib.request.urlopen(request, timeout=30) as reply:
        return json.load(reply)["token"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def registry_get(path, bearer, accept=None):
    """Read one registry object; blob redirects are followed without the registry credential."""
    headers = {"Authorization": "Bearer " + bearer}
    if accept:
        headers["Accept"] = accept
    request = urllib.request.Request(f"https://{REGISTRY}/v2/{PACKAGE}/{path}", headers=headers)
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=60) as reply:
            return reply.read()
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise
        location = urllib.parse.urljoin(request.full_url, error.headers["Location"])
        error.close()
    require(location.startswith("https://"), "Registry redirect left HTTPS.")
    with urllib.request.urlopen(location, timeout=120) as reply:
        return reply.read()


def digest_of(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def published(identity, bearer):
    """Return the published amd64 manifest/config digests for these inputs, or None if absent."""
    try:
        top = registry_get("manifests/inputs-" + identity, bearer, MANIFEST_TYPES)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        if status == 404:
            return None
        raise ValueError(f"GHCR image lookup failed (HTTP {status}).") from None
    manifest = json.loads(top)
    descriptor = digest_of(top)
    if "manifests" in manifest:
        children = [
            item["digest"]
            for item in manifest["manifests"]
            if item.get("platform", {}).get("architecture") == "amd64"
            and item.get("platform", {}).get("os") == "linux"
        ]
        require(len(children) == 1, "Published index must contain exactly one Linux amd64 image.")
        descriptor = children[0]
        raw = registry_get("manifests/" + descriptor, bearer, MANIFEST_TYPES)
        require(digest_of(raw) == descriptor, "Published manifest digest mismatch.")
        manifest = json.loads(raw)
    config_digest = manifest["config"]["digest"]
    raw = registry_get("blobs/" + config_digest, bearer)
    require(digest_of(raw) == config_digest, "Published configuration digest mismatch.")
    config = json.loads(raw)
    require(
        config.get("architecture") == "amd64"
        and config.get("os") == "linux"
        and config.get("config", {}).get("User") == "pwuser"
        and config.get("config", {}).get("Labels", {}).get("io.ohtia.image-inputs") == identity,
        "Published image does not carry the declared inputs and account.",
    )
    return {"manifest": descriptor, "config": config_digest}


def write_probe(credential):
    """Exercise package-write permission before construction; authentication alone proves no scope."""
    phase = "token authentication"
    try:
        bearer = registry_token("pull,push", credential)
        phase = "package-write probe"
        request = urllib.request.Request(
            f"https://{REGISTRY}/v2/{PACKAGE}/blobs/uploads/",
            data=b"",
            method="POST",
            headers={"Authorization": "Bearer " + bearer},
        )
        with urllib.request.urlopen(request, timeout=30) as reply:
            location = urllib.parse.urljoin(f"https://{REGISTRY}/", reply.headers["Location"])
            require(
                reply.status == 202 and location.startswith(f"https://{REGISTRY}/"),
                "Unexpected registry write-probe response.",
            )
        phase = "upload cancellation"
        try:
            cancel = urllib.request.Request(
                location, method="DELETE", headers={"Authorization": "Bearer " + bearer}
            )
            with urllib.request.urlopen(cancel, timeout=30):
                pass
        except urllib.error.HTTPError as error:
            # GHCR accepts the empty probe but does not support cancelling it (HTTP 405).
            if error.code != 405:
                raise
            error.close()
            print("GHCR accepted the write probe; upload cancellation is unsupported (HTTP 405).")
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise ValueError(
            f"GHCR {phase} failed (HTTP {status}); verify package-write permission. No image build started."
        ) from None
    except urllib.error.URLError:
        raise ValueError(f"GHCR {phase} connection failed. No image build started.") from None


@contextmanager
def docker_session(credential):
    """Log in through a private temporary Docker configuration used only by registry commands."""
    actor, token = credential
    with tempfile.TemporaryDirectory(prefix="ohtia-docker-") as directory:
        environment = {**os.environ, "DOCKER_CONFIG": directory}
        command(
            ["docker", "login", REGISTRY, "--username", actor, "--password-stdin"],
            input=token,
            text=True,
            env=environment,
            stdout=subprocess.DEVNULL,
        )
        yield environment


def prerequisites():
    require(
        platform.system() == "Linux" and platform.machine() in ("x86_64", "amd64"),
        "Image production requires native Linux x86-64.",
    )
    info = json.loads(captured(["docker", "info", "--format", "{{json .}}"]))
    require(
        info["Architecture"] in ("x86_64", "amd64") and "name=apparmor" in info["SecurityOptions"],
        "A native Docker daemon with enforcing AppArmor is required.",
    )
    # Docker 25 and later export an OCI image layout; refuse older engines before compiling.
    major = re.match(r"(\d+)\.", str(info.get("ServerVersion", "")))
    require(major and int(major[1]) >= 25, "Docker Engine 25 or later is required.")
    command(["sudo", "-n", "apparmor_parser", "--version"], stdout=subprocess.DEVNULL)
    linux_e2e.configuration()
    command(["bash", "tools/linux-e2e/run.sh", "--preflight"])


def image_identity(archive):
    with tarfile.open(archive) as tar:
        index = json.load(tar.extractfile("index.json"))
        candidates = []

        def read(digest):
            data = tar.extractfile("blobs/sha256/" + digest.split(":")[1]).read()
            require(digest_of(data) == digest, "Image export digest mismatch.")
            return json.loads(data)

        def visit(descriptor):
            manifest = read(descriptor["digest"])
            if "manifests" in manifest:
                for item in manifest["manifests"]:
                    visit(item)
            else:
                config = read(manifest["config"]["digest"])
                if config.get("architecture") == "amd64" and config.get("os") == "linux":
                    require(config["config"].get("User") == "pwuser", "Image account mismatch.")
                    candidates.append((descriptor["digest"], manifest["config"]["digest"]))

        for descriptor in index["manifests"]:
            visit(descriptor)
        require(len(candidates) == 1, "Exactly one native Linux amd64 image is required.")
        return candidates[0]


def local_image(identity):
    image = json.loads(captured(["docker", "image", "inspect", linux_e2e.image_tag(identity)]))[0]
    linux_e2e.inspect_image(linux_e2e.configuration(), image, identity)
    return image


def native_result(candidate):
    native = json.loads((OUTPUT / "native/result.json").read_text())
    config = linux_e2e.configuration()
    expected = linux_e2e.account(config, native.get("reports", []), native.get("identity"))
    identity = native.get("identity", {})
    require(
        native.get("status") == "passed"
        and native.get("cases") == expected["cases"]
        and native.get("shards") == expected["shards"]
        and identity == candidate.get("qualification_identity")
        and identity.get("input_fingerprint") == candidate.get("input_fingerprint")
        and identity.get("image_id") == candidate.get("local_image_id"),
        "Refusing publication without complete native qualification.",
    )
    return native


def receipt(reference, destination):
    container = captured(["docker", "create", reference])
    try:
        command(
            ["docker", "cp", container + ":/opt/ohtia-image/webkit.json", str(destination)],
            stdout=subprocess.DEVNULL,
        )
    finally:
        command(["docker", "rm", container], stdout=subprocess.DEVNULL)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def write_outputs(values):
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            stream.writelines(f"{key}={value}\n" for key, value in values.items())


def plan():
    """Request construction only when GHCR reports no publication; uncertainty stops the run."""
    identity = fingerprint(inputs())
    existing = published(identity, registry_token("pull", credentials()))
    decision = {"build": "false" if existing else "true", "inputs": identity}
    print(
        f"An image for inputs {identity} is already published; no construction is required."
        if existing
        else f"No published image matches inputs {identity}; construction is required."
    )
    write_outputs(decision)
    return decision


def build():
    provenance = context()
    records = inputs()
    identity = fingerprint(records)
    credential = credentials()
    # Runs for the same inputs are serialized; a predecessor may have published meanwhile.
    if published(identity, registry_token("pull", credential)) is not None:
        print(
            f"An image for inputs {identity} was published meanwhile; no construction is required."
        )
        write_outputs({"published": "true"})
        return None
    prerequisites()
    write_probe(credential)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    reference = linux_e2e.image_tag(identity)
    command(
        [
            "docker",
            "build",
            "--platform",
            "linux/amd64",
            "--label",
            f"org.opencontainers.image.source=https://github.com/{REPOSITORY}",
            "--label",
            "io.ohtia.image-inputs=" + identity,
            "--label",
            "io.ohtia.source-tree=" + provenance["source_tree"],
            "--label",
            "org.opencontainers.image.revision=" + provenance["source_commit"],
            "--file",
            "tools/linux-e2e/Dockerfile",
            "--tag",
            reference,
            ".",
        ]
    )
    archive = OUTPUT / "image.oci.tar"
    command(["docker", "save", "--output", str(archive), reference])
    _, config_digest = image_identity(archive)
    archive.unlink()
    image = local_image(identity)
    webkit = receipt(reference, OUTPUT / "webkit.json")
    attempt = OUTPUT / "native"
    if attempt.exists():
        attempt.rename(OUTPUT / f"native-failed-{time.time_ns()}")
    # Qualification resolves the freshly built local tag and never receives registry credentials.
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GH_") and key != "DOCKER_CONFIG"
    }
    command(["bash", "tools/linux-e2e/run.sh", "--output", str(attempt)], env=environment)
    native = json.loads((attempt / "result.json").read_text())
    candidate = {
        **provenance,
        "tag": reference,
        "inputs": records,
        "input_fingerprint": identity,
        "config_digest": config_digest,
        "local_image_id": image["Id"],
        "webkit_record_sha256": webkit,
        "elapsed_seconds": time.monotonic() - started,
        "qualification_identity": native["identity"],
    }
    native_result(candidate)
    (OUTPUT / "candidate.json").write_text(json.dumps(candidate, indent=2) + "\n")
    return candidate


def publish():
    provenance = context()
    candidate = json.loads((OUTPUT / "candidate.json").read_text())
    require(
        all(candidate.get(key) == value for key, value in provenance.items()),
        "Qualification belongs to another producer candidate.",
    )
    # Validate the complete inventory before opening any registry session.
    native_result(candidate)
    records = inputs()
    identity = fingerprint(records)
    require(
        candidate["inputs"] == records and candidate["input_fingerprint"] == identity,
        "Qualified input bytes changed before publication.",
    )
    image = local_image(identity)
    require(
        image["Id"] == candidate["local_image_id"]
        and receipt(image["Id"], OUTPUT / "publication-webkit.json")
        == candidate["webkit_record_sha256"],
        "Qualified local image changed before publication.",
    )
    credential = credentials()
    # Never replace an existing input-addressed publication.
    require(
        published(identity, registry_token("pull", credential)) is None,
        "These inputs were published concurrently; no replacement is permitted.",
    )
    with docker_session(credential) as environment:
        command(["docker", "push", candidate["tag"]], env=environment)
    remote = published(identity, registry_token("pull", credential))
    require(
        remote is not None and remote["config"] == candidate["config_digest"],
        "Published image configuration mismatch.",
    )
    record = {
        **provenance,
        "inputs": records,
        "input_fingerprint": identity,
        "image": candidate["tag"] + "@" + remote["manifest"],
        "config_digest": remote["config"],
        "webkit_record_sha256": candidate["webkit_record_sha256"],
    }
    (OUTPUT / "publication.json").write_text(json.dumps(record, indent=2) + "\n")
    print(MARKER + json.dumps(record, sort_keys=True, separators=(",", ":")), flush=True)
    return record


class GitHubError(Exception):
    """A GitHub API call failed; its diagnostic excludes credentials."""


def gh_api(*arguments):
    result = subprocess.run(
        ["gh", "api", *arguments],
        capture_output=True,
        text=True,
        errors="replace",
        check=False,
    )
    if result.returncode:
        raise GitHubError(result.stderr.strip()[-300:] or f"gh api exited {result.returncode}")
    return result.stdout


def waiting_runs(now=None):
    """Return each branch's latest pull-request check run from the re-runnable 30 days."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=30)
    since = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    latest = {}
    # GitHub returns at most 1,000 runs for a filtered listing.
    for page in range(1, 11):
        runs = json.loads(
            gh_api(
                "--method",
                "GET",
                f"repos/{REPOSITORY}/actions/workflows/{Path(CONSUMER).name}/runs",
                "-f",
                "event=pull_request",
                "-f",
                f"created=>={since}",
                "-f",
                "per_page=100",
                "-f",
                f"page={page}",
            )
        )["workflow_runs"]
        for run in runs:
            if (run.get("head_repository") or {}).get("full_name") != REPOSITORY or run.get(
                "path"
            ) != CONSUMER:
                continue
            branch = run["head_branch"]
            if branch not in latest or (run["created_at"], run["id"]) > (
                latest[branch]["created_at"],
                latest[branch]["id"],
            ):
                latest[branch] = run
        if len(runs) < 100:
            break
    else:
        print(
            "The listing reached GitHub's 1,000-run limit; older runs were not examined.",
            file=sys.stderr,
        )
    return sorted(
        (
            run
            for run in latest.values()
            if run.get("status") == "completed"
            and run.get("conclusion") == "failure"
            # GitHub refuses to re-run a workflow run older than 30 days.
            and datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")) >= cutoff
        ),
        key=lambda run: (run["created_at"], run["id"]),
        reverse=True,
    )


def waiting_for(run, missing):
    """Report whether a failed job of this run stopped because this exact image was missing."""
    jobs = json.loads(
        gh_api(
            "--method",
            "GET",
            f"repos/{REPOSITORY}/actions/runs/{run['id']}/jobs",
            "-f",
            "filter=latest",
        )
    )["jobs"]
    for job in jobs:
        if job.get("conclusion") != "failure":
            continue
        try:
            log = gh_api(f"repos/{REPOSITORY}/actions/jobs/{job['id']}/logs")
        except GitHubError as error:
            # An expired or deleted log cannot show that the check waited for this image.
            if "HTTP 404" in str(error) or "HTTP 410" in str(error):
                print(f"Log unavailable for {run['html_url']}; not re-run.", file=sys.stderr)
                continue
            raise
        if missing in log:
            return True
    return False


def rerun():
    """Re-run pull-request checks whose latest run failed for lack of this publication."""
    missing = linux_e2e.MISSING_IMAGE.format(fingerprint(inputs()))
    rerun_runs = []
    failures = []
    for run in waiting_runs():
        # Each check is independent: one unreadable run must not block the others.
        try:
            if not waiting_for(run, missing):
                continue
            gh_api(
                "--method", "POST", f"repos/{REPOSITORY}/actions/runs/{run['id']}/rerun-failed-jobs"
            )
        except (GitHubError, ValueError, KeyError) as error:
            failures.append(f"{run.get('html_url', run.get('id'))}: {error}")
            continue
        print(f"Re-ran the failed jobs of {run['html_url']}.")
        rerun_runs.append(run["id"])
    if not rerun_runs and not failures:
        print("No pull-request check is waiting for this image.")
    for failure in failures:
        print("Could not inspect or re-run " + failure, file=sys.stderr)
    require(
        not failures, f"{len(failures)} pull-request check(s) could not be inspected or re-run."
    )
    return rerun_runs


def main():
    global OUTPUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "build", "publish", "rerun"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.output:
        OUTPUT = args.output.resolve()
    {"plan": plan, "build": build, "publish": publish, "rerun": rerun}[args.command]()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, GitHubError) as error:
        raise SystemExit(f"Linux E2E image production stopped: {error}") from None
