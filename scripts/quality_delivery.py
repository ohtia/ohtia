"""Plan and account for native quality deliveries without granting release authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "OHTIA_CI_PROVENANCE="
SHA = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"[a-f0-9]{64}")
SUITES = ("runtime", "storage", "diagnostics")
FULL_MATRIX = "full-required-matrix"
DOCUMENTATION_ONLY = "documentation-only"


class DeliveryError(ValueError):
    """Required delivery evidence is missing, changed or unsuccessful."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DeliveryError(message)


def unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate evidence field.")
        result[key] = value
    return result


def read(file: Path) -> dict:
    require(
        not file.is_symlink() and file.stat().st_size <= 8 * 1024 * 1024, "Unsafe evidence file."
    )
    value = json.loads(file.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    require(isinstance(value, dict), "Expected an evidence object.")
    return value


def digest(file: Path) -> str:
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write(file: Path, value: dict) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT).decode().strip()


def cells(manifest: dict, quality: dict | None = None) -> list[dict]:
    """Keep the recurring hosted CI matrix distinct from distribution qualification."""
    require(manifest.get("schema_version") == 1, "Unsupported target manifest.")
    targets = manifest["targets"]
    expected = {
        f"{system}-{arch}" for system in ("linux", "win32", "darwin") for arch in ("x64", "arm64")
    }
    require(
        len(targets) == 6 and {t["id"] for t in targets} == expected, "Incomplete target manifest."
    )
    quality = read(ROOT / "config/quality/build-targets.json") if quality is None else quality
    require(
        quality.get("version") == 1
        and quality.get("scope") == "github-hosted-standard-public-repository",
        "Unsupported quality matrix.",
    )
    result = quality["cells"]
    required_runners = {
        "ubuntu-24.04",
        "ubuntu-24.04-arm",
        "ubuntu-26.04",
        "ubuntu-26.04-arm",
        "windows-2025",
        "windows-11-arm",
        "macos-26",
        "xcode-27",
    }
    require(
        len(result) == len(required_runners) + 6
        and {c["runner"] for c in result} == required_runners,
        "Missing or nonstandard required hosted runner.",
    )
    require(len({c["id"] for c in result}) == len(result), "Duplicate native cell.")
    for cell in result:
        require(
            set(cell) == {"id", "runner", "target", "profile", "backend", "filesystem", "formats"},
            "Invalid quality cell schema.",
        )
        require(
            re.fullmatch(r"[a-z0-9-]+", cell["id"]) is not None, "Unsafe native cell identifier."
        )
        target = next(t for t in targets if t["id"] == cell["target"])
        require(cell["filesystem"] in target["filesystems"], "Undeclared native filesystem.")
        require(
            cell["formats"]
            and len(cell["formats"]) == len(set(cell["formats"]))
            and set(cell["formats"]) <= set(target["quality_packages"]),
            "Invalid package inventory.",
        )
        runner = cell["runner"]
        if cell["profile"] in {"fedora-44", "debian-13"}:
            expected_format = "rpm" if cell["profile"] == "fedora-44" else "deb"
            require(
                cell["runner"] == "ubuntu-26.04"
                and cell["target"] == "linux-x64"
                and cell["backend"] == "wayland"
                and cell["formats"] == [expected_format]
                and cell["filesystem"] == ("btrfs" if expected_format == "rpm" else "ext4"),
                "Invalid native VM cell.",
            )
        elif runner.startswith("ubuntu-"):
            expected_target = "linux-arm64" if runner.endswith("-arm") else "linux-x64"
            require(
                cell["target"] == expected_target
                and cell["profile"] == runner.removesuffix("-arm")
                and cell["backend"] in {"x11", "wayland"}
                and cell["formats"] == ["deb"],
                "Mismatched Ubuntu hosted cell.",
            )
        elif runner.startswith("windows-"):
            arm = runner == "windows-11-arm"
            require(
                cell["target"] == ("win32-arm64" if arm else "win32-x64")
                and cell["profile"] == ("windows-11" if arm else "windows-server-2025")
                and cell["backend"] == "desktop"
                and cell["formats"] == ["nsis"],
                "Mismatched Windows hosted cell.",
            )
        else:
            require(
                cell["target"] == "darwin-arm64"
                and cell["profile"] == ("macos-26" if runner == "macos-26" else "macos-27")
                and cell["backend"] == "windowserver"
                and cell["formats"] == ["dmg", "zip"],
                "Mismatched macOS hosted cell.",
            )
    require(
        len({(c["target"], c["profile"], c["backend"]) for c in result}) == len(result),
        "Duplicate native profile/backend.",
    )
    return result


def identity(env: dict | None = None) -> dict:
    """Bind PR merge and actual main checkouts independently; refuse dirty CI inputs."""
    env = os.environ if env is None else env
    event = read(Path(env["GITHUB_EVENT_PATH"]))
    kind = env["GITHUB_EVENT_NAME"]
    require(kind in {"pull_request", "push"}, "Unsupported quality-build event.")
    require(env["GITHUB_REPOSITORY"] == "ohtia/ohtia", "Unexpected repository.")
    run_id, attempt = int(env["GITHUB_RUN_ID"]), int(env["GITHUB_RUN_ATTEMPT"])
    require(run_id > 0 and attempt > 0, "Invalid run/attempt.")
    checkout, tree = git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")
    dirty = git("status", "--porcelain", "--untracked-files=all")
    require(
        not dirty,
        "Quality checkout has uncommitted inputs: " + json.dumps(dirty[:4096]),
    )
    require(checkout == env["GITHUB_SHA"], "Actual checkout differs from the event revision.")
    pull = event.get("pull_request") or {}
    if kind == "pull_request":
        require(
            env["GITHUB_REF"] == f"refs/pull/{event['number']}/merge",
            "Expected the PR merge checkout.",
        )
        head, base = pull["head"]["sha"], pull["base"]["sha"]
        require(
            git("show", "-s", "--format=%P", "HEAD").split() == [base, head],
            "Wrong PR merge parents.",
        )
    else:
        require(
            env["GITHUB_REF"] == "refs/heads/main" and not pull, "Expected integrated main source."
        )
        require(event["after"] == checkout, "Push did not test its actual integrated revision.")
        head, base = None, None
    record = {
        "schema_version": 1,
        "repository": env["GITHUB_REPOSITORY"],
        "event": kind,
        "ref": env["GITHUB_REF"],
        "run_id": run_id,
        "run_attempt": attempt,
        "pull_request": event.get("number") if pull else None,
        "head_sha": head,
        "base_sha": base,
        "github_sha": env["GITHUB_SHA"],
        "checkout_sha": checkout,
        "tree_sha": tree,
    }
    validate_identity(record)
    return record


def validate_identity(record: dict) -> None:
    keys = {
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
    }
    require(
        set(record) == keys
        and type(record["schema_version"]) is int
        and record["schema_version"] == 1,
        "Invalid checkout identity schema.",
    )
    require(record["repository"] == "ohtia/ohtia", "Unexpected source repository.")
    for key in ("run_id", "run_attempt"):
        require(type(record[key]) is int and record[key] > 0, "Invalid run identity.")
    for key in ("github_sha", "checkout_sha", "tree_sha"):
        require(
            isinstance(record[key], str) and SHA.fullmatch(record[key]) is not None,
            "Invalid source SHA.",
        )
    require(record["github_sha"] == record["checkout_sha"], "Wrong tested checkout.")
    if record["event"] == "pull_request":
        require(
            type(record["pull_request"]) is int and record["pull_request"] > 0, "Invalid PR number."
        )
        require(record["ref"] == f"refs/pull/{record['pull_request']}/merge", "Wrong PR ref.")
        for key in ("head_sha", "base_sha"):
            require(
                isinstance(record[key], str) and SHA.fullmatch(record[key]) is not None,
                "Missing PR head/base.",
            )
    else:
        require(
            record["event"] == "push" and record["ref"] == "refs/heads/main", "Wrong main event."
        )
        require(
            all(record[key] is None for key in ("pull_request", "head_sha", "base_sha")),
            "PR identity cannot qualify main.",
        )


def tree_entries(revision: str) -> dict[str, tuple[str, ...]]:
    entries = {}
    for line in git("ls-tree", "-z", revision).split("\0"):
        if line:
            metadata, path = line.split("\t", 1)
            entries[path] = tuple(metadata.split())
    return entries


def quality_scope(env: dict | None = None) -> str:
    """Select native jobs from the actual merge trees; uncertainty keeps the full matrix."""
    env = os.environ if env is None else env
    try:
        if env["GITHUB_EVENT_NAME"] != "pull_request":
            return FULL_MATRIX
        pull = read(Path(env["GITHUB_EVENT_PATH"]))["pull_request"]
        parents = [pull["base"]["sha"], pull["head"]["sha"]]
        if git("show", "-s", "--format=%P", "HEAD").split() != parents:
            return FULL_MATRIX
        before, after = tree_entries("HEAD^1"), tree_entries("HEAD")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return FULL_MATRIX
    old, new = before.pop("docs", None), after.pop("docs", None)
    limited = (
        before == after
        and old is not None
        and new is not None
        and old[:2] == new[:2] == ("040000", "tree")
        and old != new
    )
    return DOCUMENTATION_ONLY if limited else FULL_MATRIX


def require_needs(env: dict | None = None) -> None:
    """Admit only the complete upstream result that the reported selection requires."""
    env = os.environ if env is None else env
    message = "Every mandatory repository and native job must succeed."
    needs = json.loads(env["OHTIA_QUALITY_NEEDS"], object_pairs_hook=unique_object)
    require(
        isinstance(needs, dict)
        and set(needs) == {"scope", "checks", "native"}
        and needs["scope"]["result"] == "success"
        and needs["checks"]["result"] == "success",
        message,
    )
    admitted = {FULL_MATRIX: "success"}
    if env["GITHUB_EVENT_NAME"] == "pull_request":
        admitted[DOCUMENTATION_ONLY] = "skipped"
    selection = needs["scope"]["outputs"]["selection"]
    require(selection in admitted and needs["native"]["result"] == admitted[selection], message)


def input_seal() -> dict:
    paths = [
        "pnpm-lock.yaml",
        "uv.lock",
        ".github/workflows/ci.yml",
        "config/github/ci-verification.json",
        "config/desktop/targets.json",
        "config/desktop/toolchain.json",
        "config/desktop/resource-policy.json",
        "config/quality/build-targets.json",
        "config/quality/delivery-security.json",
        "config/quality/virtual-machines.json",
        "config/quality/packaged-cases.json",
        "config/desktop/storage-cases.json",
        "config/desktop/diagnostic-cases.json",
    ]
    return {name: digest(ROOT / name) for name in paths}


def version(record: dict) -> str:
    validate_identity(record)
    return f"0.0.0-dev.{record['run_id']}.{record['run_attempt']}"


def plan(record: dict) -> dict:
    validate_identity(record)
    return {
        "version": 1,
        "identity": record,
        "inputs": input_seal(),
        "application_version": version(record),
        "selection": FULL_MATRIX,
        "reason": "Full checks for every integrated-main change and every pull request that is not documentation-only.",
        "retention_days": read(ROOT / "config/desktop/resource-policy.json")["budgets"][
            "ci_retention_days"
        ]["value"],
        "cells": cells(read(ROOT / "config/desktop/targets.json")),
    }


def artifact(file: Path, directory: Path) -> dict:
    relative = file.relative_to(directory).as_posix()
    require(
        file.is_file() and not file.is_symlink() and file.resolve() == file.absolute(),
        "Unsafe artifact path.",
    )
    require(file.stat().st_size > 0, "Empty artifact.")
    return {"file": relative, "sha256": digest(file), "bytes": file.stat().st_size}


def check_attachment(record: dict, directory: Path) -> Path:
    require(set(record) == {"file", "sha256", "bytes"}, "Invalid artifact identity.")
    require(
        isinstance(record["file"], str) and "\\" not in record["file"], "Invalid artifact filename."
    )
    require(
        type(record["bytes"]) is int
        and record["bytes"] > 0
        and isinstance(record["sha256"], str)
        and DIGEST.fullmatch(record["sha256"]) is not None,
        "Invalid artifact size/digest.",
    )
    file = directory / record["file"]
    require(
        file.resolve().is_relative_to(directory.resolve()) and file.resolve() == file.absolute(),
        "Artifact escapes its evidence directory.",
    )
    require(artifact(file, directory) == record, "Artifact bytes changed or disappeared.")
    return file


def suite_cases(suite: str, target: str) -> tuple[set[str], set[str]]:
    if suite == "runtime":
        inventory = read(ROOT / "config/quality/packaged-cases.json")
        return set(inventory["runtime"]), set(inventory["runtime_observations"])
    inventory = read(
        ROOT / f"config/desktop/{'storage' if suite == 'storage' else 'diagnostic'}-cases.json"
    )
    cases = inventory["graphical_cases"] + (
        [f"process-interruption-{point}" for point in inventory["interruption_points"]]
        if suite == "storage"
        else inventory["windows_cases"]
        if target.startswith("win32-")
        else []
    )
    return set(cases), set()


def validate_suite(suite: str, target: str, evidence: dict) -> None:
    expected, observations = suite_cases(suite, target)
    cases = evidence.get("cases")
    require(isinstance(cases, list) and bool(cases), "Missing packaged cases.")
    require(len({case["id"] for case in cases}) == len(cases), "Duplicate packaged case.")
    require({case["id"] for case in cases} == expected, "Incomplete smoke case inventory.")
    require(
        all(
            case["result"] == ("observed" if case["id"] in observations else "pass")
            for case in cases
        ),
        "Unsuccessful packaged case.",
    )


def account(expected: dict, directory: Path) -> dict:
    """No skipped target, stale attempt, format or failed case can become a green aggregate."""
    require(
        expected == plan(expected["identity"]), "Plan does not match the actual source and policy."
    )
    found = {entry.name for entry in directory.iterdir()}
    names = {
        f"quality-{cell['id']}-{expected['identity']['run_id']}-{expected['identity']['run_attempt']}"
        for cell in expected["cells"]
    }
    require(found == names, "Missing or unexpected native artifact partitions.")
    results = []
    for cell in expected["cells"]:
        name = f"quality-{cell['id']}-{expected['identity']['run_id']}-{expected['identity']['run_attempt']}"
        partition = directory / name
        receipt = read(partition / "result.json")
        require(
            type(receipt.get("version")) is int
            and receipt.get("version") == 1
            and receipt.get("status") == "passed",
            "Native delivery failed or is incomplete.",
        )
        validate_identity(receipt["plan"]["identity"])
        require(
            receipt.get("cell") == cell and receipt.get("plan") == expected,
            "Native source/run/policy identity differs.",
        )
        require(
            set(receipt["packages"]) == set(cell["formats"]),
            "Missing or unexpected package format.",
        )
        for format_id, package in receipt["packages"].items():
            check_attachment(package["artifact"], partition)
            require(
                package["application_version"] == expected["application_version"],
                "Wrong development version.",
            )
            native = package["native"]
            architecture = cell["target"].split("-")[1]
            require(
                native["execution"] == "native" and native["emulated"] is False,
                "Emulation does not qualify native evidence.",
            )
            require(
                all(
                    native[key] == architecture
                    for key in ("host_arch", "process_arch", "addon_arch")
                ),
                "Native CPU mismatch.",
            )
            require(
                native["target"] == cell["target"]
                and native["profile"] == cell["profile"]
                and native["backend"] == cell["backend"]
                and native["filesystem"] == cell["filesystem"],
                "Native profile mismatch.",
            )
            require(
                native["tree_cessation"] is True
                and native["sandbox_observed"] is True
                and native["stable_preserved"] is True,
                "Missing native isolation/shutdown evidence.",
            )
            observed = read(check_attachment(native["evidence"], partition))
            require(
                observed.get("plan") == expected
                and observed.get("cell") == cell
                and observed.get("package") == package["artifact"],
                "Native observation belongs to another artifact or source.",
            )
            require(
                isinstance(observed.get("prepared_sha256"), str)
                and DIGEST.fullmatch(observed["prepared_sha256"]) is not None,
                "Missing prepared payload identity.",
            )
            display = observed.get("display_observations")
            require(
                isinstance(display, list)
                and bool(display)
                and all(
                    row.get("backend") == cell["backend"]
                    and row.get("source")
                    == (
                        "unix-peer"
                        if cell["target"].startswith("linux-")
                        else "packaged-window-capture"
                    )
                    for row in display
                ),
                "Missing or wrong native display backend observation.",
            )
            samples = observed.get("samples")
            require(
                isinstance(samples, list) and bool(samples) and observed.get("remaining") == [],
                "Incomplete native process observations.",
            )
            require(
                all(
                    type(row.get("pid")) is int
                    and row["pid"] > 0
                    and type(row.get("renderer")) is bool
                    and type(row.get("sandbox")) is bool
                    for row in samples
                ),
                "Invalid native process identity/control schema.",
            )
            renderers = [row for row in samples if row.get("renderer") is True]
            require(
                renderers and all(row.get("sandbox") is True for row in renderers),
                "Native renderer sandbox was not established.",
            )
            require(set(package["suites"]) == set(SUITES), "Incomplete packaged smoke suites.")
            for suite in SUITES:
                evidence = read(check_attachment(package["suites"][suite], partition))
                validate_suite(suite, cell["target"], evidence)
                binding = "preparedSha256" if suite == "diagnostics" else "artifact"
                require(
                    evidence.get(binding) == observed["prepared_sha256"],
                    "Smoke suite tested a different payload.",
                )
            require(format_id in cell["formats"], "Unexpected package format.")
        if cell["id"].endswith("-vm"):
            machine = read(partition / "virtual-machine.json")
            require(
                machine.get("plan") == expected
                and machine.get("cell") == cell
                and type(machine.get("guest_exit")) is int
                and machine.get("guest_exit") == 0
                and set(machine.get("accelerator", {})) == {"enabled", "present"}
                and all(machine["accelerator"][field] is True for field in ("enabled", "present")),
                "Missing or unsuccessful actual KVM guest evidence.",
            )
        results.append({"cell": cell["id"], "formats": cell["formats"], "status": "passed"})
    return {"version": 1, "status": "passed", "plan": expected, "results": results}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("record")
    commands.add_parser("scope")
    commands.add_parser("needs")
    planned = commands.add_parser("plan")
    planned.add_argument("output", type=Path)
    aggregate = commands.add_parser("aggregate")
    aggregate.add_argument("plan", type=Path)
    aggregate.add_argument("directory", type=Path)
    aggregate.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "record":
            print(MARKER + json.dumps(identity(), separators=(",", ":")))
        elif args.command == "scope":
            selected = quality_scope()
            with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
                output.write(f"selection={selected}\n")
            print(f"OHTIA_QUALITY_SELECTION={selected}")
        elif args.command == "needs":
            require_needs()
        elif args.command == "plan":
            write(args.output, plan(identity()))
        else:
            expected = read(args.plan)
            require(expected["identity"] == identity(), "Aggregate checkout differs from the plan.")
            write(args.output, account(expected, args.directory))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f"Quality delivery refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
