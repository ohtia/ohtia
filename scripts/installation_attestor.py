"""Attest bounded data from a completed sibling build; never execute its source or package."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import stat
import subprocess
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import installation_build_contract as contract

API = "https://api.github.com/repos/ohtia/ohtia"
RESULTS = "https://results-receiver.actions.githubusercontent.com"
SERVICE = "/twirp/github.actions.results.api.v1.ArtifactService/"
BUILD_NAME = "Construct unsigned package"
ATTEST_NAME = "Attest unsigned package"


def json_value(data):
    def pairs(entries):
        result = {}
        for name, value in entries:
            contract.require(name not in result, "duplicate_metadata")
            result[name] = value
        return result

    return json.loads(data, object_pairs_hook=pairs)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Network:
    """Keep bearer credentials on their exact origin; do not log response bodies or capabilities."""

    def __init__(self, env):
        self.env = env
        self.opener = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))
        self.expires = time.monotonic() + 180

    def open(self, url, *, token=None, data=None):
        remaining = self.expires - time.monotonic()
        contract.require(remaining > 0, "network_deadline")
        headers = {"User-Agent": "ohtia-build-attestor", "Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if data is not None:
            headers["Content-Type"] = "application/json"
        return self.opener.open(
            urllib.request.Request(url, headers=headers, data=data), timeout=min(20, remaining)
        )

    def metadata(self, url, *, token, data=None):
        with self.open(url, token=token, data=data) as response:
            raw = response.read(contract.MAXIMUM_METADATA + 1)
        contract.require(len(raw) <= contract.MAXIMUM_METADATA, "metadata_size")
        return json_value(raw)

    def api(self, endpoint):
        contract.require(endpoint.startswith("/") and ".." not in endpoint, "api_path")
        return self.metadata(API + endpoint, token=self.env["GITHUB_TOKEN"])

    def results(self, operation, data):
        contract.require(
            self.env["ACTIONS_RESULTS_URL"].rstrip("/") == RESULTS
            and operation in {"ListArtifacts", "GetSignedArtifactURL"},
            "results_origin",
        )
        return self.metadata(
            RESULTS + SERVICE + operation,
            token=self.env["ACTIONS_RUNTIME_TOKEN"],
            data=contract.canonical(data),
        )

    def download(self, url, destination, expected):
        parsed = urllib.parse.urlsplit(url)
        contract.require(
            parsed.scheme == "https"
            and parsed.hostname
            and re.fullmatch(r"[a-z0-9]+\.blob\.core\.windows\.net", parsed.hostname)
            and parsed.port in {None, 443}
            and not parsed.username
            and not parsed.password
            and not parsed.fragment,
            "download_origin",
        )
        checksum = hashlib.sha256()
        count = 0
        with self.open(url) as response, destination.open("xb") as output:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                contract.require(
                    count <= contract.MAXIMUM_PACKAGE + 1024 * 1024
                    and time.monotonic() < self.expires,
                    "archive_size_or_deadline",
                )
                checksum.update(chunk)
                output.write(chunk)
        contract.require(count > 0 and checksum.hexdigest() == expected, "archive_digest")


def field(value, name):
    """Accept the two protobuf JSON spellings, refusing ambiguous responses."""
    snake = re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), name)
    keys = {name, snake} & value.keys()
    contract.require(len(keys) == 1, "results_field")
    return value[keys.pop()]


def runtime_ids(token):
    contract.require(type(token) is str and len(token) <= 65536, "runtime_scope")
    segments = token.split(".")
    contract.require(len(segments) == 3, "runtime_scope")
    value = json_value(base64.urlsafe_b64decode(segments[1] + "=" * (-len(segments[1]) % 4)))
    scopes = [s.split(":") for s in value["scp"].split() if s.startswith("Actions.Results:")]
    contract.require(len(scopes) == 1 and len(scopes[0]) == 3, "runtime_scope")
    _, run, job = scopes[0]
    contract.require(
        all(re.fullmatch("[a-f0-9-]{36}", item) for item in (run, job)), "runtime_scope"
    )
    # This decode is only routing context. Authenticated Results and Checks responses grant authority.
    return run, job


def build_origin(network, context, token):
    jobs = []
    for page in range(1, 11):
        result = network.api(
            f"/actions/runs/{context['run']}/attempts/{context['attempt']}/jobs?per_page=100&page={page}"
        )
        contract.require(type(result["jobs"]) is list, "jobs_response")
        jobs.extend(result["jobs"])
        if len(jobs) == result["total_count"]:
            break
        contract.require(page < 10 and result["jobs"], "jobs_bound")
    own = [j for j in jobs if j["id"] == context["job"]]
    contract.require(len(own) == 1, "attestor_job")
    own = own[0]
    contract.require(own["name"].endswith(" / " + ATTEST_NAME), "attestor_name")
    expected_name = own["name"][: -len(ATTEST_NAME)] + BUILD_NAME
    builds = [j for j in jobs if j["name"] == expected_name]
    contract.require(len(builds) == 1, "producer_job")
    producer = builds[0]
    for row in (own, producer):
        contract.require(
            row["run_id"] == context["run"]
            and row["run_attempt"] == context["attempt"]
            and row["head_sha"] == context["source"],
            "job_identity",
        )
    contract.require(
        own["status"] == "in_progress"
        and producer["status"] == "completed"
        and producer["conclusion"] == "success"
        and producer["id"] != own["id"],
        "producer_success",
    )
    checks = [network.api(f"/check-runs/{row['id']}") for row in (own, producer)]
    for check, row in zip(checks, (own, producer), strict=True):
        contract.require(
            check["id"] == row["id"]
            and check["app"]["slug"] == "github-actions"
            and check["details_url"]
            == f"https://github.com/ohtia/ohtia/actions/runs/{context['run']}/job/{row['id']}",
            "check_identity",
        )
    backend_run, backend_job = runtime_ids(token)
    contract.require(checks[0]["external_id"] == backend_job, "attestor_backend")
    name = f"installation-build-{context['run']}-{context['attempt']}-{producer['id']}"
    result = network.results(
        "ListArtifacts",
        {
            "workflowRunBackendId": backend_run,
            "workflowJobRunBackendId": backend_job,
            "nameFilter": name,
        },
    )
    contract.require(
        type(result["artifacts"]) is list and len(result["artifacts"]) == 1, "artifact_count"
    )
    artifact = result["artifacts"][0]
    contract.require(
        field(artifact, "workflowRunBackendId") == backend_run
        and field(artifact, "workflowJobRunBackendId") == checks[1]["external_id"]
        and artifact["name"] == name,
        "artifact_producer",
    )
    identifier = contract.positive(field(artifact, "databaseId"))
    checksum = artifact["digest"]
    contract.require(
        type(checksum) is str and re.fullmatch("sha256:[a-f0-9]{64}", checksum), "artifact_digest"
    )
    rest = network.api(f"/actions/artifacts/{identifier}")
    contract.require(
        rest["id"] == identifier
        and rest["name"] == name
        and rest["expired"] is False
        and rest["digest"] == checksum
        and rest["workflow_run"]["id"] == context["run"]
        and rest["workflow_run"]["head_sha"] == context["source"],
        "artifact_identity",
    )
    return {
        "producer_job_id": producer["id"],
        "producer_backend_id": checks[1]["external_id"],
        "workflow_run_backend_id": backend_run,
        "artifact_id": identifier,
        "artifact_name": name,
        "archive_sha256": checksum.removeprefix("sha256:"),
    }


def extract_package(archive, output, extension):
    """Accept exactly one bounded regular member, copied to a fixed new file without extract()."""
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        contract.require(len(entries) == 1, "archive_entries")
        entry = entries[0]
        kind = stat.S_IFMT(entry.external_attr >> 16)
        contract.require(
            entry.filename == f"package.{extension}"
            and kind in {0, stat.S_IFREG}
            and not entry.is_dir()
            and not entry.flag_bits & 1
            and entry.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
            and 0 < entry.file_size <= contract.MAXIMUM_PACKAGE,
            "archive_member",
        )
        checksum = hashlib.sha256()
        count = 0
        with bundle.open(entry) as source, output.open("xb") as destination:
            while chunk := source.read(1024 * 1024):
                count += len(chunk)
                contract.require(count <= entry.file_size, "package_size")
                checksum.update(chunk)
                destination.write(chunk)
        contract.require(count == entry.file_size, "package_size")
        return {"sha256": checksum.hexdigest(), "bytes": count}


def inspect_native(package, cell, version, runner=subprocess.run):
    """Read fixed native fields without installing the package or running its scripts."""
    native_version = version.replace("-", "~", 1) + "-1"
    arch = cell["target"].removeprefix("linux-")
    if cell["formats"] == ["deb"]:
        arguments = [
            "/usr/bin/dpkg-deb",
            "--show",
            "--showformat=${Package}\\n${Version}\\n${Architecture}\\n",
            str(package),
        ]
        expected = ["ohtia-quality", native_version, "amd64" if arch == "x64" else "arm64"]
    else:
        arguments = [
            "/usr/bin/rpm",
            "--query",
            "--package",
            "--queryformat",
            "%{NAME}\\n%{EPOCHNUM}\\n%{VERSION}-%{RELEASE}\\n%{ARCH}\\n",
            str(package),
        ]
        expected = ["ohtia-quality", "0", native_version, "x86_64" if arch == "x64" else "aarch64"]
    result = runner(
        arguments,
        env={"PATH": os.defpath, "LANG": "C", "LC_ALL": "C"},
        capture_output=True,
        check=True,
        timeout=30,
    )
    contract.require(result.stdout.decode("utf-8").splitlines() == expected, "native_metadata")


def prepare(env, network=None):
    context = contract.identity(env)
    recipe = Path(__file__).resolve().parents[1]
    source = Path(env["SOURCE_ROOT"])
    output = Path(env["ATTESTOR_OUTPUT"])
    contract.require(not output.exists(), "fresh_output")
    cell = contract.selection(env["BUILD_SELECTION"], recipe)
    closure, tree = contract.source_contract(source, context)
    network = network or Network(env)
    origin = build_origin(network, context, env["ACTIONS_RUNTIME_TOKEN"])
    response = network.results(
        "GetSignedArtifactURL",
        {
            "workflowRunBackendId": origin["workflow_run_backend_id"],
            "workflowJobRunBackendId": origin["producer_backend_id"],
            "name": origin["artifact_name"],
        },
    )
    output.mkdir(mode=0o700)
    archive = output / "artifact.zip"
    network.download(field(response, "signedUrl"), archive, origin["archive_sha256"])
    extension = cell["formats"][0]
    package = extract_package(archive, output / f"package.{extension}", extension)
    archive.unlink()
    version = closure["contracts"]["versions"][0]
    inspect_native(output / f"package.{extension}", cell, version)
    manifest = {
        "id": f"ohtia-{env['BUILD_SELECTION'].replace('.', '-')}-{extension}",
        "target": cell["target"],
        "profile": cell["profile"],
        "format": extension,
        "native_version": version.replace("-", "~", 1) + "-1",
        "source_commit": context["source"],
        "source_tree": tree,
        "inputs_sha256": contract.sha256(contract.canonical(closure)),
        **package,
        "build_execution": {
            "workflow": contract.RECIPE,
            "workflow_sha": context["recipe"],
            "run_id": context["run"],
            "attempt": context["attempt"],
            "job_id": context["job"],
            "invocation": f"attestor-{context['job']}",
        },
    }
    predicate = {
        "buildDefinition": {
            "buildType": "https://github.com/ohtia/ohtia/installation-build/v1",
            "externalParameters": {"ohtia": manifest},
            "resolvedDependencies": [
                {
                    "uri": "git+https://github.com/ohtia/ohtia",
                    "digest": {"gitCommit": context["source"]},
                }
            ],
        },
        "runDetails": {
            "builder": {
                "id": f"https://github.com/ohtia/ohtia/{contract.RECIPE}@{context['recipe']}"
            },
            "metadata": {
                "invocationId": f"https://github.com/ohtia/ohtia/actions/runs/{context['run']}/job/{context['job']}"
            },
            "byproducts": [{"name": "ohtia-build-origin", "annotations": origin}],
        },
    }
    for name, value in (
        ("manifest.json", manifest),
        ("predicate.json", predicate),
        ("closure.json", closure),
    ):
        (output / name).write_bytes(contract.canonical(value))
    return manifest


def verify_bundle(env, runner=subprocess.run):
    """Cryptographically verify the genuine bundle before releasing the consumer's proof envelope."""
    context = contract.identity(env)
    output = Path(env["ATTESTOR_OUTPUT"])
    manifest = json_value((output / "manifest.json").read_bytes())
    predicate = json_value((output / "predicate.json").read_bytes())
    bundle = Path(env["ATTESTATION_BUNDLE"])
    contract.require(
        bundle.resolve() == bundle
        and bundle.is_file()
        and bundle.stat().st_nlink == 1
        and 0 < bundle.stat().st_size <= contract.MAXIMUM_METADATA,
        "bundle_file",
    )
    package = output / f"package.{manifest['format']}"
    cli_env = {
        "PATH": os.defpath,
        "LANG": "C.UTF-8",
        "GH_HOST": "github.com",
        "GH_CONFIG_DIR": str(output.parent / "attestor-gh-config"),
        "GH_TOKEN": env["GITHUB_TOKEN"],
    }
    result = runner(
        [
            env["ATTESTOR_GH"],
            "attestation",
            "verify",
            str(package),
            "--repo",
            contract.REPOSITORY,
            "--bundle",
            str(bundle),
            "--signer-workflow",
            f"{contract.REPOSITORY}/{contract.RECIPE}",
            "--signer-digest",
            context["recipe"],
            "--source-digest",
            context["source"],
            "--source-ref",
            "refs/heads/main",
            "--deny-self-hosted-runners",
            "--format",
            "json",
        ],
        env=cli_env,
        capture_output=True,
        check=True,
        timeout=90,
    )
    contract.require(len(result.stdout) <= contract.MAXIMUM_VERIFICATION, "verification_size")
    results = json_value(result.stdout)
    contract.require(type(results) is list and 0 < len(results) <= 32, "verification_results")
    expected = {
        "issuer": "https://token.actions.githubusercontent.com",
        "sourceRepositoryURI": "https://github.com/ohtia/ohtia",
        "sourceRepositoryIdentifier": "1431132416",
        "sourceRepositoryOwnerIdentifier": "346940169",
        "sourceRepositoryDigest": context["source"],
        "sourceRepositoryRef": "refs/heads/main",
        "runnerEnvironment": "github-hosted",
        "buildTrigger": "workflow_dispatch",
        "buildSignerURI": f"https://github.com/ohtia/ohtia/{contract.RECIPE}@{context['recipe']}",
        "buildSignerDigest": context["recipe"],
        "runInvocationURI": f"https://github.com/ohtia/ohtia/actions/runs/{context['run']}/attempts/{context['attempt']}",
    }
    matched = False
    for row in results:
        verified = row.get("verificationResult", {})
        cert = verified.get("signature", {}).get("certificate", {})
        statement = verified.get("statement", {})
        matched |= (
            all(cert.get(key) == value for key, value in expected.items())
            and bool(verified.get("verifiedTimestamps"))
            and statement.get("predicateType") == "https://slsa.dev/provenance/v1"
            and statement.get("predicate") == predicate
            and any(
                s.get("digest", {}).get("sha256") == manifest["sha256"]
                for s in statement.get("subject", [])
            )
        )
    contract.require(matched, "verified_build_identity")
    proof = {
        "schema_version": 1,
        "artifact": manifest,
        "bundle": bundle.read_text(encoding="utf-8"),
    }
    proof_bytes = contract.canonical(proof)
    contract.require(len(proof_bytes) <= contract.MAXIMUM_METADATA, "proof_size")
    (output / "build-proof.json").write_bytes(proof_bytes)
    return proof


def install_verifier(env):
    """Reuse the bounded public CLI installer under this recipe's own identity contract."""
    context = contract.identity(env)
    recipe = Path(__file__).resolve().parents[1]
    contract.require(
        contract.git(recipe, "rev-parse", "HEAD").decode().strip() == context["recipe"],
        "recipe_checkout",
    )
    from scaleway_ledger import install_cli

    return install_cli(Path(env["ATTESTOR_GH_DIRECTORY"]))


def main():
    try:
        if os.environ.get("ATTESTOR_OPERATION") == "install-cli":
            install_verifier(os.environ)
        elif os.environ.get("ATTESTOR_OPERATION") == "verify":
            verify_bundle(os.environ)
        else:
            prepare(os.environ)
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
        zipfile.BadZipFile,
    ):
        # Upstream exceptions can contain bearer tokens, signed URLs or untrusted response bodies.
        raise SystemExit("Build attestation preparation refused.") from None


if __name__ == "__main__":
    main()
