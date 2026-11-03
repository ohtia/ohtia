"""Data-only build contracts shared by the fixed recipe and its isolated attestor."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

RECIPE = ".github/workflows/signing-build.yml"
REPOSITORY = "ohtia/ohtia"
BUDGETS = json.loads(
    (Path(__file__).resolve().parents[1] / "config/desktop/resource-policy.json").read_bytes()
)["budgets"]
MAXIMUM_PACKAGE = BUDGETS["update_package_bytes"]["value"]
MAXIMUM_METADATA = BUDGETS["delivery_evidence_record_bytes"]["value"]
MAXIMUM_VERIFICATION = BUDGETS["signing_jwks_bytes"]["value"]


def require(condition, code):
    if not condition:
        raise ValueError(code)


def canonical(value):
    # Match catalogBytes: ECMAScript property order, UTF-16 key sorting and one final LF.
    def key_order(key):
        numeric = re.fullmatch(r"0|[1-9][0-9]*", key)
        if numeric and int(key) < 2**32 - 1:
            return (0, int(key))
        return (1, key.encode("utf-16-be"))

    def ordered(item):
        if isinstance(item, dict):
            return {key: ordered(item[key]) for key in sorted(item, key=key_order)}
        if isinstance(item, list):
            return [ordered(value) for value in item]
        return item

    return (json.dumps(ordered(value), ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def positive(value):
    require(type(value) in {str, int} and re.fullmatch(r"[1-9][0-9]{0,15}", str(value)), "identity")
    result = int(value)
    require(result <= 2**53 - 1, "identity")
    return result


def identity(env):
    require(
        env["GITHUB_REPOSITORY"] == REPOSITORY
        and env["GITHUB_REPOSITORY_ID"] == "1431132416"
        and env["GITHUB_REPOSITORY_OWNER_ID"] == "346940169"
        and env["GITHUB_REF"] == "refs/heads/main"
        and env["GITHUB_EVENT_NAME"] == "workflow_dispatch"
        and env["RUNNER_ENVIRONMENT"] == "github-hosted"
        and re.fullmatch("[a-f0-9]{40}", env["GITHUB_SHA"])
        and re.fullmatch("[a-f0-9]{40}", env["RECIPE_SHA"])
        and env["RECIPE_REF"] == f"{REPOSITORY}/{RECIPE}@{env['RECIPE_SHA']}",
        "recipe_identity",
    )
    return {
        "source": env["GITHUB_SHA"],
        "recipe": env["RECIPE_SHA"],
        "run": positive(env["GITHUB_RUN_ID"]),
        "attempt": positive(env["GITHUB_RUN_ATTEMPT"]),
        "job": positive(env["ATTESTOR_JOB_ID"]),
    }


def selection(name, recipe_root):
    manifest = json.loads((recipe_root / "config/desktop/targets.json").read_bytes())
    for target in manifest["targets"]:
        if target["id"] not in {"linux-x64", "linux-arm64"}:
            continue
        for profile in target["distribution_profiles"]:
            if name == f"{target['id']}-{profile['id']}":
                return {
                    "target": target["id"],
                    "profile": profile["id"],
                    "backend": "wayland",
                    "filesystem": profile["filesystems"][0],
                    "formats": [profile["package"]],
                }
    raise ValueError("selection")


def git(root, *arguments):
    result = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", *arguments],
        cwd=root,
        env={
            "PATH": os.defpath,
            "LANG": "C.UTF-8",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_TERMINAL_PROMPT": "0",
        },
        capture_output=True,
        check=True,
        timeout=30,
    )
    require(len(result.stdout) <= MAXIMUM_METADATA, "source_metadata_bound")
    return result.stdout


def source_contract(root, context):
    """Inspect tracked bytes without importing, building or executing candidate source."""
    require(git(root, "rev-parse", "HEAD").decode().strip() == context["source"], "source_commit")
    tree = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
    files = {}
    total = 0
    for entry in git(root, "ls-tree", "-rz", "HEAD").split(b"\0"):
        if not entry:
            continue
        header, raw_name = entry.split(b"\t", 1)
        mode, kind, oid = header.decode().split()
        name = raw_name.decode("utf-8")
        file = root / name
        require(
            mode in {"100644", "100755"}
            and kind == "blob"
            and file.resolve() == file
            and file.is_file()
            and file.stat().st_nlink == 1,
            "source_entry",
        )
        total += file.stat().st_size
        require(total <= 512 * 1024**2 and len(files) < 65536, "source_size")
        data = file.read_bytes()
        require(
            hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() == oid,
            "changed_source",
        )
        files[name] = sha256(data)
    inputs = {"source_sha": context["source"], "files": files}
    migration = root / "packages/utility/src/migrations/manifest.json"
    migrations = json.loads(migration.read_bytes())
    require(type(migrations) is list and 0 < len(migrations) <= 10000, "migration_contract")
    version = f"0.0.0-dev.{context['run']}.{context['attempt']}"
    contracts = {
        "versions": [version, f"0.0.0-dev.{context['run']}.{context['attempt'] + 1}"],
        "target_schema": len(migrations),
        "migration_manifest_sha256": sha256(migration.read_bytes()),
    }
    return {"inputs": inputs, "contracts": contracts}, tree
