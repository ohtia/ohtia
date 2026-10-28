"""Build, qualify and publish the Linux E2E image exclusively on GitHub-hosted CI."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / ".reports/linux-e2e-image"
CONFIG = ROOT / "config/desktop/linux-e2e.json"
IMAGE_NAME = "ghcr.io/ohtia/linux-e2e"


def command(arguments, **options):
    return subprocess.run(arguments, check=True, **options)


def captured(arguments):
    return subprocess.check_output(arguments, text=True).strip()


def context():
    sha = os.environ.get("GITHUB_SHA", "")
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        or os.environ.get("GITHUB_REPOSITORY") != "ohtia/ohtia"
        or os.environ.get("GITHUB_EVENT_NAME") != "push"
        or not re.fullmatch(r"[0-9a-f]{40}", sha)
        or captured(["git", "rev-parse", "HEAD"]) != sha
    ):
        raise ValueError("Image production requires this repository's GitHub-hosted push workflow.")
    run = os.environ["GITHUB_RUN_ID"]
    return {"source_commit": sha, "run_url": f"https://github.com/ohtia/ohtia/actions/runs/{run}"}


def write(name, value):
    (OUTPUT / name).write_text(json.dumps(value, indent=2) + "\n")


def image_identity(archive):
    with tarfile.open(archive) as tar:
        index = json.load(tar.extractfile("index.json"))
        candidates = []

        def read(digest):
            data = tar.extractfile("blobs/sha256/" + digest.split(":")[1]).read()
            if "sha256:" + hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("Image export digest mismatch.")
            return json.loads(data)

        def visit(descriptor):
            manifest = read(descriptor["digest"])
            if "manifests" in manifest:
                for item in manifest["manifests"]:
                    visit(item)
            else:
                config = read(manifest["config"]["digest"])
                if config.get("architecture") == "amd64" and config.get("os") == "linux":
                    if config["config"].get("User") != "pwuser":
                        raise ValueError("Image account mismatch.")
                    candidates.append((descriptor["digest"], manifest["config"]["digest"]))

        for descriptor in index["manifests"]:
            visit(descriptor)
        if len(candidates) != 1:
            raise ValueError("Exactly one native Linux amd64 image is required.")
        return candidates[0]


def build():
    provenance = context()
    OUTPUT.mkdir(parents=True, exist_ok=False)
    tag = IMAGE_NAME + ":sha-" + provenance["source_commit"]
    command(
        [
            "docker",
            "build",
            "--platform",
            "linux/amd64",
            "--memory",
            "12g",
            "--memory-swap",
            "12g",
            "--label",
            "org.opencontainers.image.source=https://github.com/ohtia/ohtia",
            "--label",
            "org.opencontainers.image.revision=" + provenance["source_commit"],
            "--label",
            "org.opencontainers.image.url=" + provenance["run_url"],
            "--file",
            "tools/linux-e2e/Dockerfile",
            "--tag",
            tag,
            ".",
        ]
    )
    archive = OUTPUT / "image.oci.tar"
    command(["docker", "save", "--output", str(archive), tag])
    manifest, config_digest = image_identity(archive)
    container = captured(["docker", "create", tag])
    try:
        command(
            [
                "docker",
                "cp",
                container + ":/opt/ohtia-image/webkit.json",
                str(OUTPUT / "webkit.json"),
            ]
        )
    finally:
        command(["docker", "rm", container])
    config = json.loads(CONFIG.read_text())
    config.update(
        image=tag + "@" + manifest,
        image_id=config_digest,
        webkit_record_sha256=hashlib.sha256((OUTPUT / "webkit.json").read_bytes()).hexdigest(),
    )
    write("linux-e2e.json", config)
    original = CONFIG.read_bytes()
    try:
        CONFIG.write_text(json.dumps(config, indent=2) + "\n")
        # This is qualification of proposed image pins, rather than the consumer PR gate.
        # Its real producer commit/run and the exact candidate input tree are retained below.
        environment = {**os.environ, "GITHUB_ACTIONS": "false"}
        command(
            ["bash", "tools/linux-e2e/run.sh", "--output", str(OUTPUT / "native")], env=environment
        )
    finally:
        CONFIG.write_bytes(original)
    native = json.loads((OUTPUT / "native/result.json").read_text())
    if native.get("status") != "passed" or native.get("cases") != 9:
        raise ValueError("The complete native image inventory did not pass.")
    write(
        "candidate.json",
        {**provenance, "tag": tag, "config": config, "qualification_identity": native["identity"]},
    )
    print("OHTIA_LINUX_E2E_IMAGE_QUALIFIED=" + json.dumps({**provenance, "image": config["image"]}))


def remote_manifest(tag, expected_config):
    manifest = json.loads(captured(["docker", "manifest", "inspect", tag]))
    if "manifests" in manifest:
        for item in manifest["manifests"]:
            child = json.loads(
                captured(["docker", "manifest", "inspect", IMAGE_NAME + "@" + item["digest"]])
            )
            if child.get("config", {}).get("digest") == expected_config:
                return item["digest"]
        raise ValueError("Published image configuration mismatch.")
    if manifest.get("config", {}).get("digest") != expected_config:
        raise ValueError("Published image configuration mismatch.")
    # The manifest distribution digest is emitted by docker push, not reconstructed JSON.
    return None


def publish():
    provenance = context()
    candidate = json.loads((OUTPUT / "candidate.json").read_text())
    if any(candidate.get(key) != value for key, value in provenance.items()):
        raise ValueError("Qualification belongs to another producer commit/run.")
    native = json.loads((OUTPUT / "native/result.json").read_text())
    if native.get("status") != "passed" or native.get("cases") != 9:
        raise ValueError("Refusing publication without complete native qualification.")
    token = os.environ["GH_TOKEN"]
    with tempfile.TemporaryDirectory(prefix="ohtia-ci-registry-") as directory:
        environment = {**os.environ, "DOCKER_CONFIG": directory}
        command(
            [
                "docker",
                "login",
                "ghcr.io",
                "--username",
                os.environ["GH_ACTOR"],
                "--password-stdin",
            ],
            input=token + "\n",
            text=True,
            env=environment,
        )
        del token
        result = command(
            ["docker", "push", candidate["tag"]], capture_output=True, text=True, env=environment
        )
        print(result.stdout)
        digests = re.findall(r"digest: (sha256:[0-9a-f]{64})", result.stdout + result.stderr)
        if len(set(digests)) != 1:
            raise ValueError("Cannot establish the published distribution digest.")
        # docker manifest uses the same temporary authentication configuration.
        original = os.environ.get("DOCKER_CONFIG")
        os.environ["DOCKER_CONFIG"] = directory
        try:
            child = remote_manifest(candidate["tag"], candidate["config"]["image_id"])
        finally:
            if original is None:
                os.environ.pop("DOCKER_CONFIG", None)
            else:
                os.environ["DOCKER_CONFIG"] = original
        candidate["config"]["image"] = candidate["tag"] + "@" + (child or digests[0])
    write("linux-e2e.json", candidate["config"])
    write("publication.json", candidate)
    print("OHTIA_LINUX_E2E_IMAGE_PUBLICATION=" + json.dumps(candidate, separators=(",", ":")))
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
        summary.write(
            "## Qualified Linux E2E image\n\n"
            + provenance["run_url"]
            + "\n\n```json\n"
            + json.dumps(candidate["config"], indent=2)
            + "\n```\n"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "publish"))
    args = parser.parse_args()
    {"build": build, "publish": publish}[args.command]()


if __name__ == "__main__":
    main()
