"""Resolve one immutable package source from main without inspecting commit signatures."""

from __future__ import annotations

import os
import re
from pathlib import Path

import installation_attestor as attestor
import installation_build_contract as contract


def resolve_source(requested, main, network):
    source = requested.strip() or main
    contract.require(
        all(
            type(value) is str and re.fullmatch(r"[a-f0-9]{40}", value) for value in (source, main)
        ),
        "source_hash",
    )
    commit = network.api(f"/git/commits/{source}")
    contract.require(type(commit) is dict and type(commit.get("tree")) is dict, "source_commit")
    tree = commit.get("tree", {}).get("sha")
    contract.require(
        commit.get("sha") == source and type(tree) is str and re.fullmatch(r"[a-f0-9]{40}", tree),
        "source_commit",
    )
    if source != main:
        # Later pages omit the changed-files list; only ancestry metadata is consumed.
        compared = network.api(f"/compare/{source}...{main}?per_page=1&page=2")
        contract.require(
            type(compared) is dict
            and compared.get("status") == "ahead"
            and type(compared.get("base_commit")) is dict
            and type(compared.get("merge_base_commit")) is dict
            and compared.get("base_commit", {}).get("sha") == source
            and compared.get("merge_base_commit", {}).get("sha") == source,
            "source_not_in_main",
        )
    return {"source_commit": source, "source_tree": tree, "main_commit": main}


if __name__ == "__main__":
    try:
        contract.require(
            os.environ.get("GITHUB_REPOSITORY") == contract.REPOSITORY
            and os.environ.get("GITHUB_REF") == "refs/heads/main"
            and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch",
            "source_context",
        )
        selected = resolve_source(
            os.environ.get("SOURCE_HASH", ""),
            os.environ["GITHUB_SHA"],
            attestor.Network(os.environ),
        )
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            output.write(f"source-commit={selected['source_commit']}\n")
            output.write(f"source-tree={selected['source_tree']}\n")
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
            summary.write(
                f"## Selected package source\n\n"
                f"Repository: `ohtia/ohtia` · branch: `main`\n\n"
                f"Package commit: `{selected['source_commit']}`\n\n"
                f"Package tree: `{selected['source_tree']}`\n\n"
                f"Workflow main snapshot: `{selected['main_commit']}`\n"
            )
        print(contract.canonical(selected).decode(), end="")
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        raise SystemExit("Package source selection refused.") from None
