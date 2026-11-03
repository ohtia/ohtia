"""Bootstrap only an immutable worker and inspect public proof data without executing it."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import installation_attestor as attestor
import installation_build_contract as contract

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/signing-worker.yml"


def context(env):
    contract.require(
        env.get("GITHUB_ACTIONS") == "true"
        and env.get("GITHUB_REPOSITORY") == "ohtia/ohtia"
        and env.get("GITHUB_REPOSITORY_ID") == "1431132416"
        and env.get("GITHUB_REPOSITORY_OWNER_ID") == "346940169"
        and env.get("GITHUB_REF") == "refs/heads/main"
        and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
        and env.get("RUNNER_ENVIRONMENT") == "github-hosted",
        "worker_context",
    )
    source, recipe = env.get("GITHUB_SHA", ""), env.get("SIGNING_RECIPE_SHA", "")
    contract.require(
        all(re.fullmatch("[a-f0-9]{40}", x) for x in [source, recipe]), "worker_context"
    )
    contract.require(
        env.get("SIGNING_RECIPE_REF") == f"ohtia/ohtia/{WORKFLOW}@{recipe}", "worker_context"
    )
    return {
        "source": source,
        "recipe": recipe,
        "run": contract.positive(env["GITHUB_RUN_ID"]),
        "attempt": contract.positive(env["GITHUB_RUN_ATTEMPT"]),
        "job": contract.positive(env["SIGNING_JOB_ID"]),
    }


def stage(env, identity):
    parent = Path(env["RUNNER_TEMP"])
    contract.require(
        parent.is_absolute() and parent.resolve() == parent and parent.is_dir(), "worker_temp"
    )
    return parent / f"ohtia-signing-{identity['run']}-{identity['attempt']}-{identity['job']}"


def ensure_stage(env, identity):
    directory = stage(env, identity)
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    contract.require(
        stat.S_ISDIR(info.st_mode)
        and info.st_uid == os.getuid()
        and stat.S_IMODE(info.st_mode) == 0o700,
        "worker_temp",
    )
    return directory


def check(env):
    identity = context(env)
    contract.require(
        contract.git(ROOT, "rev-parse", "HEAD").decode().strip() == identity["recipe"],
        "worker_checkout",
    )
    configuration = attestor.json_value(
        (ROOT / "config/installation/signing-client.json").read_bytes()
    )
    contract.require(
        configuration.get("schema_version") == 1 and configuration.get("enabled") is True,
        "worker_disabled",
    )
    contract.selection(env["SIGNING_SELECTION"], ROOT)
    return identity


def artifact_origin(network, identity, token, locator):
    match = re.fullmatch(r"installation-proof-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)", locator)
    contract.require(match is not None, "worker_proof")
    run, attempt, producer_id = map(int, match.groups())
    contract.require(
        (run, attempt) == (identity["run"], identity["attempt"]) and producer_id != identity["job"],
        "worker_proof",
    )
    own = network.api(f"/actions/jobs/{identity['job']}")
    producer = network.api(f"/actions/jobs/{producer_id}")
    for row in (own, producer):
        contract.require(
            row["run_id"] == run
            and row["run_attempt"] == attempt
            and row["head_sha"] == identity["source"],
            "worker_job",
        )
    contract.require(
        own["id"] == identity["job"]
        and own["status"] == "in_progress"
        and own["name"].endswith(" / Submit private signing requests"),
        "worker_job",
    )
    contract.require(
        producer["id"] == producer_id
        and producer["status"] == "completed"
        and producer["conclusion"] == "success"
        and producer["name"] == "Qualify Linux build provenance / Attest unsigned package",
        "worker_producer",
    )
    checks = [network.api(f"/check-runs/{row['id']}") for row in (own, producer)]
    for row, value in zip((own, producer), checks, strict=True):
        contract.require(
            value["id"] == row["id"]
            and value["app"]["slug"] == "github-actions"
            and value["details_url"]
            == f"https://github.com/ohtia/ohtia/actions/runs/{run}/job/{row['id']}",
            "worker_check",
        )
    backend_run, backend_job = attestor.runtime_ids(token)
    contract.require(checks[0]["external_id"] == backend_job, "worker_backend")
    result = network.results(
        "ListArtifacts",
        {
            "workflowRunBackendId": backend_run,
            "workflowJobRunBackendId": backend_job,
            "nameFilter": locator,
        },
    )
    contract.require(
        type(result["artifacts"]) is list and len(result["artifacts"]) == 1, "worker_artifact"
    )
    artifact = result["artifacts"][0]
    contract.require(
        attestor.field(artifact, "workflowRunBackendId") == backend_run
        and attestor.field(artifact, "workflowJobRunBackendId") == checks[1]["external_id"]
        and artifact["name"] == locator,
        "worker_artifact",
    )
    identifier = contract.positive(attestor.field(artifact, "databaseId"))
    digest = artifact["digest"]
    contract.require(
        type(digest) is str and re.fullmatch("sha256:[a-f0-9]{64}", digest), "worker_digest"
    )
    rest = network.api(f"/actions/artifacts/{identifier}")
    contract.require(
        rest["id"] == identifier
        and rest["name"] == locator
        and rest["expired"] is False
        and rest["digest"] == digest
        and rest["workflow_run"]["id"] == run
        and rest["workflow_run"]["head_sha"] == identity["source"],
        "worker_artifact",
    )
    url = network.results(
        "GetSignedArtifactURL",
        {
            "workflowRunBackendId": backend_run,
            "workflowJobRunBackendId": checks[1]["external_id"],
            "name": locator,
        },
    )
    return attestor.field(url, "signedUrl"), digest.removeprefix("sha256:")


def unpack_proof(archive, output, extension):
    expected = {
        "manifest.json",
        "closure.json",
        "predicate.json",
        "build-proof.json",
        f"package.{extension}",
    }
    with zipfile.ZipFile(archive) as source:
        rows = source.infolist()
        contract.require(
            len(rows) == len(expected) and {x.filename for x in rows} == expected, "worker_archive"
        )
        output.mkdir(mode=0o700)
        for row in rows:
            maximum = (
                contract.MAXIMUM_PACKAGE
                if row.filename.startswith("package.")
                else contract.MAXIMUM_METADATA
            )
            contract.require(
                not row.flag_bits & 1
                and stat.S_IFMT(row.external_attr >> 16) in {0, stat.S_IFREG}
                and not row.is_dir()
                and 0 < row.file_size <= maximum
                and row.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED},
                "worker_archive",
            )
            with source.open(row) as src, (output / row.filename).open("xb") as dst:
                count = 0
                while chunk := src.read(1024 * 1024):
                    count += len(chunk)
                    contract.require(count <= row.file_size, "worker_archive")
                    dst.write(chunk)
                contract.require(count == row.file_size, "worker_archive")
            (output / row.filename).chmod(0o600)


def prepare(env, network=None):
    identity = check(env)
    directory = ensure_stage(env, identity)
    network = network or attestor.Network(env)
    url, digest = artifact_origin(
        network, identity, env["ACTIONS_RUNTIME_TOKEN"], env["SIGNING_PROOF_ARTIFACT"]
    )
    archive = directory / "proof.zip"
    network.download(
        url,
        archive,
        digest,
        maximum=contract.MAXIMUM_PACKAGE + 4 * contract.MAXIMUM_METADATA + 1024 * 1024,
    )
    cell = contract.selection(env["SIGNING_SELECTION"], ROOT)
    unpack_proof(archive, directory / "input", cell["formats"][0])
    archive.unlink()
    run = network.api(f"/actions/runs/{identity['run']}")
    (directory / "run.json").write_bytes(contract.canonical(run))


def tools(env):
    identity = check(env)
    directory = ensure_stage(env, identity)
    target = directory / "tools"
    target.mkdir(mode=0o700)
    node = json.loads((ROOT / "config/desktop/toolchain.json").read_bytes())["tools"]["node"]
    gh = json.loads((ROOT / "config/installation/scaleway.json").read_bytes())["github_cli"]
    expires = time.monotonic() + contract.BUDGETS["signing_subprocess_ms"]["value"] / 1000
    for name, record, prefix in [
        ("node", node["artifacts"]["linux-x64"], f"node-v{node['version']}-linux-x64"),
        ("gh", gh, f"gh_{gh['version']}_linux_amd64"),
    ]:
        remaining = expires - time.monotonic()
        contract.require(remaining > 0, "worker_tools_deadline")
        archive = directory / (name + ".tar.gz")
        digest = hashlib.sha256()
        count = 0
        with (
            urllib.request.urlopen(record["url"], timeout=min(30, remaining)) as response,
            archive.open("xb") as output,
        ):
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                contract.require(
                    count <= contract.MAXIMUM_PACKAGE and time.monotonic() < expires, "worker_tools"
                )
                digest.update(chunk)
                output.write(chunk)
        contract.require(digest.hexdigest() == record["sha256"], "worker_tools")
        with tarfile.open(archive, "r:*") as source:
            row = source.getmember(prefix + "/bin/" + name)
            contract.require(
                row.isfile()
                and not row.issym()
                and not row.islnk()
                and 0 < row.size <= contract.MAXIMUM_PACKAGE,
                "worker_tools",
            )
            with source.extractfile(row) as src, (target / name).open("xb") as output:
                shutil.copyfileobj(src, output)
        (target / name).chmod(0o500)
        archive.unlink()


def invoke(env):
    identity = check(env)
    directory = ensure_stage(env, identity)
    allowed = {
        "GITHUB_ACTIONS",
        "GITHUB_REPOSITORY",
        "GITHUB_REPOSITORY_ID",
        "GITHUB_REPOSITORY_OWNER_ID",
        "GITHUB_REF",
        "GITHUB_EVENT_NAME",
        "RUNNER_ENVIRONMENT",
        "GITHUB_SHA",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "SIGNING_RECIPE_SHA",
        "SIGNING_RECIPE_REF",
        "SIGNING_JOB_ID",
        "SIGNING_SELECTION",
        "GITHUB_TOKEN",
        "ACTIONS_ID_TOKEN_REQUEST_URL",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
        "OHTIA_SIGNING_INVOKE_TOKEN",
    }
    clean = {key: value for key, value in env.items() if key in allowed}
    clean.update(PATH=os.defpath, LANG="C.UTF-8", OHTIA_SIGNING_STAGE=str(directory))
    subprocess.run(
        [str(directory / "tools/node"), str(ROOT / "tooling/installation-signing-worker.mjs")],
        cwd=ROOT,
        env=clean,
        check=True,
        timeout=2 * 20 * 60 + 5 * 60,
    )


def main():
    env = os.environ
    try:
        action = sys.argv[1] if len(sys.argv) == 2 else "prepare"
        if action == "cleanup":
            shutil.rmtree(stage(env, context(env)), ignore_errors=True)
        elif action == "check":
            check(env)
        elif action == "tools":
            tools(env)
        elif action == "prepare":
            prepare(env)
        elif action == "invoke":
            invoke(env)
        else:
            raise ValueError("worker_action")
    except Exception:
        print("Private signing worker preparation refused.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
