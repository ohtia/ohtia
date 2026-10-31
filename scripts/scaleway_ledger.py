"""Read verified workflow/lease artifacts without executing their contents."""

from __future__ import annotations

import hashlib
import io
import os
import re
import selectors
import subprocess
import tarfile
import time
import urllib.request
import zipfile
import zlib
from pathlib import Path
from urllib.parse import unquote

import scaleway_cycle as cycle

REPO = "repos/{owner}/{repo}"


def install_cli(directory: Path) -> Path:
    tool = cycle.policy()["github_cli"]
    version = tool["version"]
    cycle.require(re.fullmatch(r"2\.[0-9]+\.[0-9]+", version) is not None, "cli_version")
    cycle.require(
        tool["url"]
        == f"https://github.com/cli/cli/releases/download/v{version}/gh_{version}_linux_amd64.tar.gz",
        "cli_origin",
    )
    cycle.sha(tool["sha256"])
    cycle.require(not directory.exists(), "cli_destination")
    directory.mkdir(mode=0o700, parents=True)
    archive = directory / "archive.tar.gz"
    total, hashed = 0, hashlib.sha256()
    deadline = time.monotonic() + 120
    with urllib.request.urlopen(tool["url"], timeout=20) as source, archive.open("xb") as target:
        cycle.require(source.url.startswith("https://"), "cli_redirect")
        while block := source.read(65536):
            total += len(block)
            cycle.require(
                total <= 64 * 1024 * 1024 and time.monotonic() < deadline, "cli_download_bound"
            )
            hashed.update(block)
            target.write(block)
    cycle.require(hashed.hexdigest() == tool["sha256"], "cli_digest")
    wanted = f"gh_{version}_linux_amd64/bin/gh"
    count, expanded, found = 0, 0, False
    with tarfile.open(archive, "r|gz") as stream:
        for member in stream:
            count += 1
            expanded += member.size
            cycle.require(
                count <= 2048
                and 0 <= member.size <= 128 * 1024 * 1024
                and expanded <= 256 * 1024 * 1024,
                "cli_archive_bound",
            )
            if member.name == wanted:
                cycle.require(not found and member.isfile(), "cli_archive_entry")
                found = True
                with stream.extractfile(member) as source, (directory / "gh").open("xb") as target:
                    while block := source.read(65536):
                        target.write(block)
                cycle.require((directory / "gh").stat().st_size == member.size, "cli_binary_size")
    cycle.require(found, "cli_binary_missing")
    archive.unlink()
    (directory / "gh").chmod(0o500)
    return directory / "gh"


def validate_unallocated(rows: list) -> dict:
    """Cache nonexecution of immutable repository run/attempt IDs, separately from leases."""
    cycle.require(
        isinstance(rows, list)
        and len(rows)
        <= cycle.policy()["limits"]["maximum_pages"] * cycle.policy()["limits"]["page_size"],
        "unallocated_bound",
    )
    result = {}
    for row in rows:
        cycle.require(set(row) == {"run_id", "attempt"}, "unallocated_fields")
        cycle.require(
            all(
                isinstance(row[key], str)
                and re.fullmatch(r"[1-9][0-9]{0,19}", row[key]) is not None
                for key in ("run_id", "attempt")
            ),
            "unallocated_run",
        )
        key = (row["run_id"], row["attempt"])
        cycle.require(key not in result, "unallocated_duplicate")
        result[key] = row
    return result


class GitHub:
    """Only GET endpoints in this repository; no implicit caller or machine credentials."""

    def __init__(self, executable: Path):
        cycle.require(executable.is_file() and not executable.is_symlink(), "cli_missing")
        self.executable = executable
        self._plan_index = {}
        self._unallocated = {}

    def bytes(self, endpoint: str, maximum: int = 2 * 1024 * 1024) -> bytes:
        cycle.require(
            endpoint.startswith(REPO + "/")
            and re.fullmatch(r"repos/\{owner\}/\{repo\}/[A-Za-z0-9_/?=&.%@-]+", endpoint)
            is not None
            and all(
                segment not in {".", ".."}
                for segment in unquote(endpoint.split("?", 1)[0]).split("/")
            )
            and "%" not in endpoint.split("?", 1)[0],
            "github_endpoint",
        )
        args = [
            str(self.executable),
            "api",
            "--hostname",
            "github.com",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            endpoint,
        ]
        if re.fullmatch(re.escape(REPO) + r"/compare/[a-f0-9]{40}\.\.\.[a-f0-9]{40}", endpoint):
            args[-1:-1] = [
                "--jq",
                "{behind_by: .behind_by, merge_base_commit: {sha: .merge_base_commit.sha}}",
            ]
        data = bytearray()
        with subprocess.Popen(
            args,
            cwd=cycle.ROOT,
            env=cycle.process_environment(github=True),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ) as child:
            try:
                deadline = time.monotonic() + 60
                with selectors.DefaultSelector() as selector:
                    selector.register(child.stdout, selectors.EVENT_READ)
                    while True:
                        remaining = deadline - time.monotonic()
                        cycle.require(
                            remaining > 0 and bool(selector.select(remaining)), "github_deadline"
                        )
                        block = os.read(child.stdout.fileno(), min(65536, maximum + 1 - len(data)))
                        if not block:
                            break
                        data.extend(block)
                        cycle.require(len(data) <= maximum, "github_response_bound")
                cycle.require(
                    child.wait(timeout=max(0.001, deadline - time.monotonic())) == 0,
                    "github_read_failed",
                )
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
        return bytes(data)

    def get(self, endpoint: str) -> dict:
        return cycle.decode(self.bytes(endpoint))

    def rows(self, endpoint: str, key: str, *, complete: bool = False):
        p = cycle.policy()["limits"]
        separator = "&" if "?" in endpoint else "?"
        count, expected, seen = 0, None, set()
        for page in range(1, p["maximum_pages"] + 1):
            value = self.get(endpoint + f"{separator}per_page={p['page_size']}&page={page}")
            rows = value.get(key)
            cycle.require(isinstance(rows, list) and len(rows) <= p["page_size"], "github_list")
            if key == "workflow_runs" or complete:
                total = cycle.integer(value["total_count"])
                cycle.require(expected is None or total == expected, "github_history_changed")
                expected = total
                # Filtered workflow searches have a service-side 1,000-result ceiling.
                # https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
                cycle.require(
                    key != "workflow_runs" or not complete or total < 1000,
                    "github_run_search_limit",
                )
            for row in rows:
                if key == "workflow_runs" or complete:
                    run_id = cycle.integer(row["id"])
                    cycle.require(run_id not in seen, "github_history_changed")
                    seen.add(run_id)
                count += 1
                yield row
            if len(rows) < p["page_size"]:
                if key == "workflow_runs" or complete:
                    cycle.require(
                        key != "workflow_runs" or expected < 1000, "github_run_search_limit"
                    )
                    cycle.require(count == expected, "github_history_incomplete")
                return
        raise cycle.CycleError("github_page_limit")

    def pages(self, endpoint: str, key: str) -> list:
        return list(self.rows(endpoint, key, complete=key == "workflow_runs"))

    def workflow(self, path: str, *, require_active: bool = False) -> dict:
        cycle.require(
            path in {cycle.policy()["qualification_workflow"], cycle.policy()["cleanup_workflow"]},
            "workflow_path",
        )
        value = self.get(f"{REPO}/actions/workflows/{Path(path).name}")
        cycle.require(
            value["path"] == path and (not require_active or value["state"] == "active"),
            "workflow_inactive",
        )
        return value

    def run(self, run_id: str, kind: str, *, require_active: bool = False) -> dict:
        cycle.require(re.fullmatch(r"[1-9][0-9]{0,19}", run_id) is not None, "run_id")
        path = cycle.policy()["qualification_workflow" if kind == "creator" else "cleanup_workflow"]
        expected = self.workflow(path, require_active=require_active)
        value = self.get(f"{REPO}/actions/runs/{run_id}")
        cycle.require(
            value["id"] == int(run_id)
            and value["workflow_id"] == expected["id"]
            and value["path"] == path,
            "run_workflow",
        )
        cycle.require(
            value["repository"]["full_name"]
            == value["head_repository"]["full_name"]
            == cycle.REPOSITORY
            and value["head_branch"] == "main",
            "run_repository",
        )
        allowed = (
            {"workflow_dispatch"}
            if kind == "creator"
            else {"workflow_dispatch", "workflow_run", "schedule"}
        )
        cycle.require(value["event"] in allowed, "run_event")
        cycle.sha(value["head_sha"], 40)
        comparison = self.get(f"{REPO}/compare/{value['head_sha']}...{os.environ['GITHUB_SHA']}")
        cycle.require(
            comparison["behind_by"] == 0
            and comparison["merge_base_commit"]["sha"] == value["head_sha"],
            "run_not_main_ancestor",
        )
        return value

    def artifact(self, artifact: dict, filename: str) -> dict:
        cycle.require(
            not artifact["expired"]
            and 0 < cycle.integer(artifact["size_in_bytes"]) <= 2 * 1024 * 1024,
            "artifact_unavailable",
        )
        expected = artifact.get("digest", "")
        cycle.require(expected.startswith("sha256:"), "artifact_digest_missing")
        cycle.sha(expected[7:])
        payload = self.bytes(f"{REPO}/actions/artifacts/{cycle.integer(artifact['id'])}/zip")
        cycle.require(
            hashlib.sha256(payload).hexdigest() == expected[7:], "artifact_digest_mismatch"
        )
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                cycle.require(archive.namelist() == [filename], "artifact_members")
                member = archive.getinfo(filename)
                cycle.require(
                    member.file_size <= cycle.policy()["limits"]["maximum_json_bytes"]
                    and member.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                    and not member.flag_bits & 1,
                    "artifact_file_bound",
                )
                with archive.open(member) as source:
                    data = source.read(cycle.policy()["limits"]["maximum_json_bytes"] + 1)
                value = cycle.decode(data)
        except cycle.CycleError:
            raise
        except (zipfile.BadZipFile, zlib.error, OSError, EOFError, ValueError):
            raise cycle.CycleError("invalid_artifact_archive") from None
        return value

    def artifacts(self, run_id: str) -> list:
        return self.pages(f"{REPO}/actions/runs/{run_id}/artifacts", "artifacts")

    def completed_ledger(self, settings: dict, *, fresh: bool = False) -> dict:
        """Read the newest successful recovery observation and its carried lease records."""
        workflow = self.workflow(cycle.policy()["cleanup_workflow"], require_active=fresh)
        runs = self.rows(
            f"{REPO}/actions/workflows/{workflow['id']}/runs?branch=main&status=success",
            "workflow_runs",
        )
        for candidate in runs:
            if candidate["status"] != "completed" or candidate["conclusion"] != "success":
                continue
            run = self.run(str(candidate["id"]), "cleanup")
            artifacts = [
                a
                for a in self.artifacts(str(run["id"]))
                if a["name"] == f"scw-recovery-{run['id']}-{run['run_attempt']}"
            ]
            if not artifacts:
                jobs = list(
                    self.rows(
                        f"{REPO}/actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs",
                        "jobs",
                        complete=True,
                    )
                )
                if jobs and all(
                    job.get("status") == "completed"
                    and job.get("conclusion") == "skipped"
                    and job.get("steps") == []
                    for job in jobs
                ):
                    continue
            cycle.require(len(artifacts) == 1, "recovery_artifact_missing")
            value = self.artifact(artifacts[0], "recovery.json")
            cycle.require(
                value["version"] == 1
                and value["status"] == "passed"
                and value["distribution_qualified"] is False,
                "recovery_status",
            )
            identity = value["identity"]
            cycle.require(
                identity
                == {
                    "repository": cycle.REPOSITORY,
                    "source_sha": run["head_sha"],
                    "workflow": cycle.policy()["cleanup_workflow"],
                    "run_id": str(run["id"]),
                    "attempt": str(run["run_attempt"]),
                    "event": run["event"],
                },
                "recovery_source",
            )
            cycle.require(
                value["project_binding"] == settings["project_binding"]
                and value["zone"] == settings["zone"]
                and (not fresh or value["policy_sha256"] == cycle.digest(cycle.POLICY_PATH)),
                "recovery_configuration",
            )
            age = (
                cycle.timestamp(cycle.utc()) - cycle.timestamp(value["checked_at"])
            ).total_seconds()
            cycle.require(
                not fresh or value.get("authority", "cleanup") == "cleanup",
                "fresh_recovery_required",
            )
            cycle.require(
                age >= 0
                and (not fresh or age <= cycle.policy()["limits"]["recovery_observation_seconds"]),
                "fresh_recovery_required",
            )
            leases = value["leases"]
            cycle.require(
                isinstance(leases, list)
                and len(leases) <= cycle.policy()["limits"]["maximum_leases"],
                "ledger_bound",
            )
            nonces = set()
            for row in leases:
                intent, receipt = row["intent"], row["receipt"]
                cycle.validate_intent(intent, settings, historical=True)
                cycle.require(
                    intent["nonce"] not in nonces and receipt["nonce"] == intent["nonce"],
                    "ledger_nonce",
                )
                nonces.add(intent["nonce"])
                cycle.require(
                    receipt["status"] == "absent"
                    and receipt["allocation_resolved"] is True
                    and receipt["distribution_qualified"] is False,
                    "ledger_unresolved",
                )
            validate_unallocated(value.get("unallocated_attempts", []))
            return value
        cycle.require(not fresh, "fresh_recovery_required")
        return {"leases": []}

    def provider_attempted(self, run: dict, attempt: int) -> bool:
        jobs = self.pages(f"{REPO}/actions/runs/{run['id']}/attempts/{attempt}/jobs", "jobs")
        controllers = [j for j in jobs if j["name"] == "Create and qualify one ARM lease"]
        cycle.require(len(controllers) <= 1, "controller_job_count")
        if not controllers:
            return False
        steps = [
            s for s in controllers[0]["steps"] if s["name"] == "Create, test and remove the lease"
        ]
        cycle.require(len(steps) <= 1, "provider_step_count")
        return bool(
            steps and steps[0]["status"] != "queued" and steps[0]["conclusion"] != "skipped"
        )

    def intents(
        self,
        settings: dict,
        *,
        previous: list,
        excluding: tuple[str, str] | None = None,
        unallocated: list | None = None,
    ) -> list[tuple[dict, dict]]:
        workflow = self.workflow(cycle.policy()["qualification_workflow"])
        runs = self.pages(
            f"{REPO}/actions/workflows/{workflow['id']}/runs?branch=main&event=workflow_dispatch",
            "workflow_runs",
        )
        resolved = {
            (row["intent"]["identity"]["run_id"], row["intent"]["identity"]["attempt"]): row[
                "intent"
            ]
            for row in previous
        }
        self._unallocated = validate_unallocated(unallocated or [])
        cycle.require(not set(resolved) & set(self._unallocated), "unallocated_conflict")
        settled = set(resolved) | set(self._unallocated)
        found = []
        for candidate in runs:
            run_id = str(candidate["id"])
            cycle.require(
                0
                < cycle.integer(candidate["run_attempt"])
                <= cycle.policy()["limits"]["maximum_run_attempts"],
                "run_attempt_bound",
            )
            if all(
                (run_id, str(attempt)) in settled
                for attempt in range(1, candidate["run_attempt"] + 1)
            ):
                cycle.require(
                    all(
                        resolved[(run_id, str(attempt))]["identity"]["source_sha"]
                        == candidate["head_sha"]
                        for attempt in range(1, candidate["run_attempt"] + 1)
                        if (run_id, str(attempt)) in resolved
                    ),
                    "carried_source",
                )
                continue
            run = self.run(run_id, "creator")
            cycle.require(
                0 < run["run_attempt"] <= cycle.policy()["limits"]["maximum_run_attempts"],
                "run_attempt_bound",
            )
            artifacts = self.artifacts(run_id)
            for attempt in range(1, run["run_attempt"] + 1):
                key = (run_id, str(attempt))
                if key == excluding:
                    continue
                if key in self._unallocated:
                    continue
                if key in resolved:
                    cycle.require(
                        resolved[key]["identity"]["source_sha"] == run["head_sha"], "carried_source"
                    )
                    continue
                matching = [a for a in artifacts if a["name"] == f"scw-intent-{run_id}-{attempt}"]
                cycle.require(len(matching) <= 1, "intent_artifact_count")
                if not matching:
                    cycle.require(
                        not self.provider_attempted(run, attempt), "missing_allocation_intent"
                    )
                    if run["status"] == "completed":
                        self._unallocated[key] = {"run_id": run_id, "attempt": str(attempt)}
                    continue
                intent = self.artifact(matching[0], "intent.json")
                cycle.validate_intent(intent, settings, historical=True)
                cycle.require(
                    intent["identity"]["run_id"] == run_id
                    and intent["identity"]["attempt"] == str(attempt)
                    and intent["identity"]["source_sha"] == run["head_sha"],
                    "intent_run_binding",
                )
                found.append((intent, run))
        cycle.require(
            len(found) + len(previous) <= cycle.policy()["limits"]["maximum_leases"], "ledger_bound"
        )
        validate_unallocated(self.unallocated())
        return found

    def unallocated(self) -> list:
        return [self._unallocated[key] for key in sorted(self._unallocated)]

    def prior_recovery(self, settings: dict, intent: dict, current: dict) -> dict | None:
        """Read cumulative plans in publication order, independent of workflow creation/reruns."""
        nonce = cycle.identifier(intent["nonce"])
        if nonce not in self._plan_index:
            index = []
            for attempt in range(1, cycle.policy()["limits"]["maximum_run_attempts"] + 1):
                rows = self.rows(
                    f"{REPO}/actions/artifacts?name={cycle.recovery_plan_name(nonce, str(attempt))}",
                    "artifacts",
                    complete=True,
                )
                for artifact in rows:
                    source = artifact.get("workflow_run") or {}
                    if artifact["expired"] or source.get("head_branch") != "main":
                        continue
                    if (
                        type(source.get("repository_id")) is not int
                        or source["repository_id"] <= 0
                        or source["repository_id"] != source.get("head_repository_id")
                    ):
                        continue
                    index.append(artifact)
                cycle.require(
                    len(index)
                    <= cycle.policy()["limits"]["maximum_leases"]
                    * cycle.policy()["limits"]["maximum_run_attempts"],
                    "recovery_plan_bound",
                )
            self._plan_index[nonce] = index
        since = cycle.timestamp(intent["created_at"]).replace(microsecond=0)
        candidates = []
        for artifact in self._plan_index[nonce]:
            if artifact["expired"] or cycle.timestamp(artifact["created_at"]) < since:
                continue
            source = artifact.get("workflow_run") or {}
            if source.get("head_branch") != "main" or source.get("repository_id") != source.get(
                "head_repository_id"
            ):
                continue
            run_id = str(cycle.integer(source["id"]))
            match = re.fullmatch(
                r"scw-recovery-plan-" + re.escape(nonce) + r"-([1-9][0-9]*)", artifact["name"]
            )
            cycle.require(match is not None, "recovery_plan_name")
            attempt = int(match[1])
            if run_id == current["run_id"] and attempt >= int(current["attempt"]):
                continue
            candidates.append((cycle.timestamp(artifact["created_at"]), artifact, run_id, attempt))
        merged, verified_runs, absorbed = None, {}, {}
        for created, artifact, run_id, attempt in sorted(
            candidates, key=lambda item: item[0], reverse=True
        ):
            artifact_id = str(cycle.integer(artifact["id"]))
            if artifact_id in absorbed:
                cycle.require(
                    absorbed[artifact_id] == artifact["digest"], "recovery_plan_coverage_conflict"
                )
                continue
            # Validated cumulative coverage avoids redownloading already merged immutable plans.
            if run_id not in verified_runs:
                verified_runs[run_id] = self.run(run_id, "cleanup")
            run = verified_runs[run_id]
            cycle.require(attempt <= run["run_attempt"], "run_attempt_bound")
            cycle.require(
                artifact["workflow_run"]["head_sha"] == run["head_sha"], "recovery_plan_source"
            )
            value = self.artifact(artifact, "plan.json")
            identity = {
                "repository": cycle.REPOSITORY,
                "source_sha": run["head_sha"],
                "workflow": cycle.policy()["cleanup_workflow"],
                "run_id": run_id,
                "attempt": str(attempt),
                "event": run["event"],
            }
            cycle.require(
                value["version"] == 2
                and value["identity"] == identity
                and value["project_binding"] == settings["project_binding"]
                and value["zone"] == settings["zone"],
                "recovery_plan_source",
            )
            for item in value["items"]:
                if item["intent"] != intent or item["deferred"]:
                    continue
                cycle.require(
                    isinstance(item["known"], dict) and set(item["known"]) <= set(cycle.KINDS),
                    "recovery_plan_resources",
                )
                for resource in item["known"].values():
                    cycle.identifier(resource)
                coverage = item.get("absorbed_artifacts", {})
                cycle.require(
                    isinstance(coverage, dict)
                    and len(coverage)
                    <= cycle.policy()["limits"]["maximum_leases"]
                    * cycle.policy()["limits"]["maximum_run_attempts"],
                    "recovery_plan_coverage_bound",
                )
                for covered_id, digest in coverage.items():
                    cycle.require(
                        re.fullmatch(r"[1-9][0-9]{0,19}", covered_id) is not None
                        and isinstance(digest, str)
                        and digest.startswith("sha256:"),
                        "recovery_plan_coverage",
                    )
                    cycle.sha(digest[7:])
                    cycle.require(
                        covered_id not in absorbed or absorbed[covered_id] == digest,
                        "recovery_plan_coverage_conflict",
                    )
                    absorbed[covered_id] = digest
                cycle.require(artifact_id not in coverage, "recovery_plan_coverage_cycle")
                absorbed[artifact_id] = artifact["digest"]
                cycle.require(
                    len(absorbed)
                    <= cycle.policy()["limits"]["maximum_leases"]
                    * cycle.policy()["limits"]["maximum_run_attempts"],
                    "recovery_plan_coverage_bound",
                )
                flags = ("allocation_resolved", "observed_full", "native_smoke_passed")
                cycle.require(all(type(item[key]) is bool for key in flags), "recovery_plan_flags")
                if merged is None:
                    merged = {**item, "known": dict(item["known"])}
                else:
                    for kind, resource in item["known"].items():
                        cycle.require(
                            kind not in merged["known"] or merged["known"][kind] == resource,
                            "conflicting_resource_receipt",
                        )
                        merged["known"][kind] = resource
                    for key in flags:
                        merged[key] = merged[key] or item[key]
        if merged is not None:
            merged["absorbed_artifacts"] = absorbed
        return merged

    def journal(self, intent: dict) -> dict | None:
        identity = intent["identity"]
        artifacts = [
            a
            for a in self.artifacts(identity["run_id"])
            if a["name"] == f"scw-journal-{identity['run_id']}-{identity['attempt']}"
        ]
        cycle.require(len(artifacts) <= 1, "journal_artifact_count")
        if not artifacts:
            return None
        value = self.artifact(artifacts[0], "journal.json")
        cycle.require(
            value["identity"] == identity and value["nonce"] == intent["nonce"], "journal_identity"
        )
        cycle.require(type(value["allocation_resolved"]) is bool, "journal_resolution")
        return value

    def guards(self, *, recovery: bool = False) -> None:
        p = cycle.policy()
        for key in (
            ("cleanup_environment",) if recovery else ("creator_environment", "cleanup_environment")
        ):
            name = p[key]
            env = self.get(f"{REPO}/environments/{name}")
            cycle.require(
                env["name"] == name
                and env["can_admins_bypass"] is False
                and env["deployment_branch_policy"]
                == {"protected_branches": False, "custom_branch_policies": True},
                "environment_guard",
            )
            branches = self.get(f"{REPO}/environments/{name}/deployment-branch-policies")
            cycle.require(
                branches["total_count"] == 1 and len(branches["branch_policies"]) == 1,
                "environment_branches",
            )
            branch = branches["branch_policies"][0]
            cycle.require(
                branch["name"] == "main" and branch["type"] == "branch", "environment_branch"
            )
            rules = env["protection_rules"]
            if key == "creator_environment":
                cycle.require(
                    {r["type"] for r in rules} == {"branch_policy", "required_reviewers"},
                    "creator_review_gate",
                )
                review = next(r for r in rules if r["type"] == "required_reviewers")
                cycle.require(
                    review["prevent_self_review"] is False
                    and [r["reviewer"].get("login") for r in review["reviewers"]]
                    == ["AdrianMastronardi"],
                    "creator_reviewer",
                )
            else:
                cycle.require(
                    {r["type"] for r in rules} == {"branch_policy"}, "cleanup_wait_forbidden"
                )
