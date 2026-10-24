"""Read-only pre-merge CI provenance checks from a reviewed, immutable checkout."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import selectors
import signal
import subprocess
import sys
import time
import types
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
REPO = "repos/{owner}/{repo}"
REPOSITORY = "ohtia/ohtia"
TRUSTED_FILES = (
    "scripts/github_pr.py",
    "scripts/github_policy.py",
    "config/github/ci-verification.json",
    ".github/workflows/ci.yml",
)
MARKER = "OHTIA_CI_PROVENANCE="


class VerificationError(Exception):
    """Required evidence is absent, inconsistent or unsuccessful."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def sha(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise VerificationError("Expected a complete lowercase Git SHA")
    return value


def positive(value: object) -> int:
    require(type(value) is int and value > 0, "Expected a positive identifier")
    return value


def git(*arguments: str, root: Path = ROOT) -> bytes:
    result = subprocess.run(
        ["git", "--no-pager", *arguments],
        cwd=root,
        capture_output=True,
        timeout=30,
        check=False,
    )
    require(result.returncode == 0, "Cannot establish the verifier's Git revision")
    return result.stdout


def trusted_state(revision: str, root: Path = ROOT) -> dict:
    """Detect local drift; the maintainer, not this self-check, approves the revision."""
    sha(revision)
    require(
        git("rev-parse", "HEAD", root=root).decode().strip() == revision,
        "Use the explicitly reviewed verifier revision",
    )
    hashes = {}
    for name in TRUSTED_FILES:
        path = root / name
        require(
            not path.is_symlink() and path.resolve() == path.absolute(),
            "Trusted verifier files cannot use symlinks",
        )
        expected = git("cat-file", "blob", f"{revision}:{name}", root=root)
        require(path.read_bytes() == expected, "Trusted verifier files have local changes")
        hashes[name] = hashlib.sha256(expected).hexdigest()
    return {"revision": revision, "files_sha256": hashes}


def load_policy(path: Path, unique_object) -> dict:
    policy = json.loads(path.read_text(), object_pairs_hook=unique_object)
    require(set(policy) == {"workflow_path", "event", "jobs"}, "Invalid CI verification policy")
    require(
        policy["workflow_path"] == ".github/workflows/ci.yml" and policy["event"] == "pull_request",
        "Unsupported workflow contract",
    )
    require(isinstance(policy["jobs"], dict) and bool(policy["jobs"]), "Missing job inventory")
    for name, job in policy["jobs"].items():
        require(isinstance(name, str) and bool(name), "Invalid required job name")
        require(set(job) == {"steps", "optional_steps"}, "Invalid required job inventory")
        for field in ("steps", "optional_steps"):
            values = job[field]
            require(
                isinstance(values, list)
                and all(isinstance(x, str) and x for x in values)
                and len(values) == len(set(values)),
                "Invalid step inventory",
            )
        require(
            bool(job["steps"]) and not set(job["steps"]) & set(job["optional_steps"]),
            "Overlapping or empty step inventory",
        )
    require(
        sum("Record tested revision" in j["steps"] for j in policy["jobs"].values()) == 1,
        "Exactly one job must record the tested revision",
    )
    return policy


def object_list(github, endpoint: str, key: str) -> list:
    """Read a complete API envelope and reject pagination races or truncation."""
    result = []
    total = None
    separator = "&" if "?" in endpoint else "?"
    for page in range(1, 101):
        body = github.get(f"{endpoint}{separator}per_page=100&page={page}")
        require(
            isinstance(body, dict)
            and type(body.get("total_count")) is int
            and body["total_count"] >= 0
            and isinstance(body.get(key), list),
            "Missing or invalid paginated evidence",
        )
        if total is None:
            total = body["total_count"]
        require(body["total_count"] == total, "Evidence changed during pagination")
        batch = body[key]
        result.extend(batch)
        require(len(batch) <= 100 and len(result) <= total, "Invalid evidence count")
        if len(batch) < 100:
            require(len(result) == total, "Incomplete paginated evidence")
            ids = [positive(item["id"]) for item in result]
            require(len(ids) == len(set(ids)), "Duplicate evidence identifiers")
            return result
    raise VerificationError("Evidence pagination exceeded its bound")


def download_log(
    job_id: int, root: Path = ROOT, limit: int = 8 * 1024 * 1024, timeout: float = 60
) -> str:
    """Bound the gh process, its output and lifetime; never print CLI diagnostics."""
    positive(job_id)
    require(os.name == "posix", "Log verification requires a POSIX development host")
    # Capture raw log bytes in this bounded pipe; never forward escape sequences to a terminal.
    command = [
        "gh",
        "api",
        "--hostname",
        "github.com",
        "--allow-escape-sequences",
        f"{REPO}/actions/jobs/{job_id}/logs",
    ]
    chunks = []
    size = 0
    with subprocess.Popen(
        command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True
    ) as process:
        try:
            deadline = time.monotonic() + timeout
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(
                        remaining > 0 and bool(selector.select(remaining)),
                        "Job log download timed out",
                    )
                    chunk = os.read(process.stdout.fileno(), min(65536, limit - size + 1))
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= limit, "Job log exceeds the verification bound")
                    chunks.append(chunk)
            require(
                process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0,
                "Cannot read job logs; check access and retention",
            )
        finally:
            # Only this newly created process group; never any PR/provider process.
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    return b"".join(chunks).decode("utf-8", errors="strict")


def receipt_from_log(text: str, unique_object) -> dict:
    records = []
    for line in text.splitlines():
        # The timestamp is attached by GitHub's log stream, not supplied by the receipt.
        match = re.fullmatch(r"\d{4}-\d\d-\d\dT\S+Z " + re.escape(MARKER) + r"(\{.*\})", line)
        if match:
            records.append(json.loads(match[1], object_pairs_hook=unique_object))
    require(len(records) == 1, "Missing or duplicate checkout provenance receipt")
    record = records[0]
    require(
        isinstance(record, dict)
        and set(record)
        == {
            "schema_version",
            "repository",
            "event",
            "ref",
            "run_id",
            "run_attempt",
            "pull_request",
            "head_sha",
            "base_sha",
            "github_sha",
            "checkout_sha",
            "tree_sha",
        },
        "Invalid checkout provenance schema",
    )
    require(
        type(record["schema_version"]) is int and record["schema_version"] == 1,
        "Unsupported checkout provenance version",
    )
    return record


def successful(value: dict, label: str) -> None:
    require(
        value.get("status") == "completed" and value.get("conclusion") == "success",
        f"Required {label} did not complete successfully",
    )


def current_pr(github, number: int, head: str, base: str) -> dict:
    pr = github.get(f"{REPO}/pulls/{number}")
    require(
        pr["number"] == number
        and pr["state"] == "open"
        and pr["merged"] is False
        and pr["draft"] is False,
        "PR must be open and ready",
    )
    require(
        pr["mergeable"] is not None,
        "GitHub is computing mergeability; retry the complete verification after it finishes",
    )
    require(pr["mergeable"] is True, "PR must be mergeable")
    require(
        pr["base"]["repo"]["full_name"] == REPOSITORY and pr["base"]["ref"] == "main",
        "PR targets a different repository or branch",
    )
    require(
        pr["head"]["sha"] == head and pr["base"]["sha"] == base,
        "PR head/base differs from the reviewed candidate",
    )
    ref = github.get(f"{REPO}/git/ref/heads/main")
    require(ref["object"]["sha"] == base, "The current base branch has changed")
    return pr


def verify(
    github,
    policy: dict,
    *,
    number: int,
    run_id: int,
    head: str,
    base: str,
    tree: str,
    workflow_bytes: bytes,
    log_reader,
    unique_object,
) -> dict:
    """Compare remote evidence with explicit reviewed identities; never execute PR files."""
    positive(number)
    positive(run_id)
    for value in (head, base, tree):
        sha(value)
    workflow_blob = hashlib.sha1(
        b"blob " + str(len(workflow_bytes)).encode() + b"\0" + workflow_bytes
    ).hexdigest()
    repo = github.get(REPO)
    require(
        repo["full_name"] == REPOSITORY
        and repo["visibility"] == "public"
        and repo["default_branch"] == "main",
        "Unexpected repository",
    )
    pr = current_pr(github, number, head, base)
    merge = sha(pr["merge_commit_sha"])
    comparison = github.get(f"{REPO}/compare/{base}...{head}")
    require(
        comparison["behind_by"] == 0 and comparison["merge_base_commit"]["sha"] == base,
        "The candidate is behind its reviewed base",
    )
    head_commit = github.get(f"{REPO}/git/commits/{head}")
    merge_commit = github.get(f"{REPO}/git/commits/{merge}")
    require(
        head_commit["sha"] == head and head_commit["tree"]["sha"] == tree,
        "The head tree differs from the reviewed candidate",
    )
    require(
        merge_commit["sha"] == merge
        and merge_commit["tree"]["sha"] == tree
        and [p["sha"] for p in merge_commit["parents"]] == [base, head],
        "The synthetic merge does not match the reviewed head/base/tree",
    )
    path = quote(policy["workflow_path"], safe="/")
    content = github.get(f"{REPO}/contents/{path}?ref={merge}")
    require(
        content["type"] == "file" and content["encoding"] == "base64",
        "Cannot establish the tested workflow bytes",
    )
    data = base64.b64decode(content["content"].replace("\n", ""), validate=True)
    blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    require(
        content["sha"] == blob == workflow_blob and data == workflow_bytes,
        "The tested workflow differs from the explicitly reviewed workflow",
    )
    workflow = github.get(f"{REPO}/actions/workflows/ci.yml")
    require(
        workflow["path"] == policy["workflow_path"] and workflow["state"] == "active",
        "Unexpected or inactive registered workflow",
    )
    workflow_id = positive(workflow["id"])
    run = github.get(f"{REPO}/actions/runs/{run_id}")
    require(
        run["id"] == run_id
        and run["workflow_id"] == workflow_id
        and run["path"] == policy["workflow_path"]
        and run["event"] == policy["event"]
        and run["head_sha"] == head
        and run["repository"]["id"] == repo["id"]
        and run["head_repository"]["id"] == pr["head"]["repo"]["id"],
        "Workflow run provenance does not match the PR",
    )
    successful(run, "workflow")
    attempt = positive(run["run_attempt"])
    recent = object_list(
        github,
        f"{REPO}/actions/workflows/{workflow_id}/runs?event=pull_request&head_sha={head}",
        "workflow_runs",
    )
    require(
        bool(recent) and max(r["id"] for r in recent) == run_id,
        "A newer workflow run supersedes the selected result",
    )
    jobs = object_list(github, f"{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    require(
        len(jobs) == len(policy["jobs"]) and {j["name"] for j in jobs} == set(policy["jobs"]),
        "Actual jobs differ from the reviewed mandatory inventory",
    )
    app = github.get("apps/github-actions")
    require(app["slug"] == "github-actions", "Unexpected GitHub Actions app")
    positive(app["id"])
    result_jobs = []
    receipt = None
    for job in jobs:
        require(
            job["run_id"] == run_id and job["run_attempt"] == attempt and job["head_sha"] == head,
            "Job belongs to a different run or candidate",
        )
        successful(job, "job")
        match = re.fullmatch(
            r"https://api\.github\.com/repos/ohtia/ohtia/check-runs/(\d+)", job["check_run_url"]
        )
        require(match is not None, "Unexpected check-run URL")
        check = github.get(f"{REPO}/check-runs/{int(match[1])}")
        require(
            check["id"] == int(match[1])
            and check["name"] == job["name"]
            and check["head_sha"] == head
            and check["app"]["id"] == app["id"]
            and check["app"]["slug"] == app["slug"]
            and check["check_suite"]["id"] == run["check_suite_id"],
            "Check result has an unexpected source or suite",
        )
        successful(check, "check")
        declared = policy["jobs"][job["name"]]
        steps = job["steps"]
        names = [step["name"] for step in steps]
        require(
            len(names) == len(set(names))
            and set(declared["steps"]) <= set(names)
            and set(names) <= set(declared["steps"] + declared["optional_steps"]),
            "Job steps differ from the reviewed inventory",
        )
        for step in steps:
            if step["name"] in declared["steps"] or step.get("conclusion") != "skipped":
                successful(step, "step")
        if "Record tested revision" in declared["steps"]:
            receipt = receipt_from_log(log_reader(job["id"]), unique_object)
        result_jobs.append({"id": job["id"], "name": job["name"], "steps": names})
    expected = {
        "schema_version": 1,
        "repository": REPOSITORY,
        "event": "pull_request",
        "ref": f"refs/pull/{number}/merge",
        "run_id": run_id,
        "run_attempt": attempt,
        "pull_request": number,
        "head_sha": head,
        "base_sha": base,
        "github_sha": merge,
        "checkout_sha": merge,
        "tree_sha": tree,
    }
    require(
        receipt == expected
        and all(
            type(receipt[k]) is int
            for k in ("schema_version", "run_id", "run_attempt", "pull_request")
        ),
        "Checkout provenance does not match the reviewed PR and run",
    )
    final = current_pr(github, number, head, base)
    require(final["merge_commit_sha"] == merge, "The merge candidate changed during verification")
    final_recent = object_list(
        github,
        f"{REPO}/actions/workflows/{workflow_id}/runs?event=pull_request&head_sha={head}",
        "workflow_runs",
    )
    require(
        bool(final_recent) and max(r["id"] for r in final_recent) == run_id,
        "A newer run appeared during verification",
    )
    latest = github.get(f"{REPO}/actions/runs/{run_id}")
    require(latest == run, "Workflow evidence changed during verification")
    return {
        "result": "verified",
        "repository": REPOSITORY,
        "pull_request": number,
        "head_sha": head,
        "base_sha": base,
        "candidate_tree_sha": tree,
        "tested_sha": merge,
        "workflow_id": workflow_id,
        "workflow_path": policy["workflow_path"],
        "workflow_blob_sha": workflow_blob,
        "event": run["event"],
        "run_id": run_id,
        "run_attempt": attempt,
        "github_app_id": app["id"],
        "jobs": result_jobs,
        "limitation": "Maintainer-selected reviewed verifier; not a GitHub-enforced merge gate",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pull_request", type=int)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--tree", required=True)
    parser.add_argument("--verifier-revision", required=True)
    args = parser.parse_args(argv)
    try:
        trust = trusted_state(args.verifier_revision)
        # Import only after the dependency's exact reviewed bytes have been checked.
        transport = ROOT / "scripts/github_policy.py"
        source = transport.read_bytes()
        require(
            hashlib.sha256(source).hexdigest() == trust["files_sha256"]["scripts/github_policy.py"],
            "Reviewed transport changed before loading",
        )
        policy_module = types.ModuleType("github_policy")
        policy_module.__file__ = str(transport)
        # Compile the checked source itself; an ignored bytecode cache is not trusted evidence.
        exec(compile(source, str(transport), "exec"), policy_module.__dict__)
        policy = load_policy(
            ROOT / "config/github/ci-verification.json", policy_module.unique_object
        )
        data = (ROOT / ".github/workflows/ci.yml").read_bytes()
        report = verify(
            policy_module.GitHub(),
            policy,
            number=args.pull_request,
            run_id=args.run_id,
            head=args.head,
            base=args.base,
            tree=args.tree,
            workflow_bytes=data,
            log_reader=download_log,
            unique_object=policy_module.unique_object,
        )
        require(
            trusted_state(args.verifier_revision) == trust, "Verifier changed during verification"
        )
        report["verifier"] = trust
        print(json.dumps(report, indent=2))
        return 0
    except Exception as error:
        # An imported transport error is intentionally reported without its remote payload.
        message = (
            str(error)
            if isinstance(error, VerificationError)
            else "Required evidence is unavailable"
        )
        print(f"PR verification failed: {message}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
