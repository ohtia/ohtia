"""Freeze one integrated interface candidate from validated native packages and a separate catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import quality_delivery as delivery


def seal(directory: Path) -> dict:
    """Retain every relative filename and byte digest; reject links and empty builds."""
    delivery.require(
        directory.is_dir()
        and not directory.is_symlink()
        and directory.resolve() == directory.absolute(),
        "Missing or aliased candidate input.",
    )
    files = {}
    for path in sorted(directory.rglob("*")):
        delivery.require(not path.is_symlink(), "Candidate inputs cannot contain symlinks.")
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = delivery.digest(path)
        else:
            delivery.require(path.is_dir(), "Unsupported candidate entry.")
    delivery.require(bool(files), "Empty candidate input.")
    return {"sha256": fingerprint(files), "files": files}


def fingerprint(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def freeze(plan: dict, native: Path, catalog: Path, catalog_identity: dict, owner: str) -> dict:
    """A complete aggregate and matching source are prerequisites, never inferred from a green name."""
    delivery.require(bool(owner.strip()), "Name the integrating owner.")
    tree = delivery.git("rev-parse", "HEAD^{tree}")
    delivery.require(
        not delivery.git("status", "--porcelain", "--untracked-files=all"),
        "Candidate source must be clean.",
    )
    delivery.require(
        plan["identity"]["tree_sha"] == tree, "Native packages belong to another source tree."
    )
    summary = delivery.account(plan, native)
    catalog_seal = seal(catalog)
    delivery.require(
        catalog_identity == {"source_tree": tree, "build": catalog_seal},
        "Catalog identity does not match its source and actual bytes.",
    )
    packages = []
    for cell in plan["cells"]:
        partition = (
            native
            / f"quality-{cell['id']}-{plan['identity']['run_id']}-{plan['identity']['run_attempt']}"
        )
        receipt = delivery.read(partition / "result.json")
        for format_id, package in receipt["packages"].items():
            packages.append(
                {
                    "cell": cell,
                    "format": format_id,
                    "artifact": package["artifact"],
                    "native": package["native"],
                    "suites": package["suites"],
                }
            )
    content = {
        "version": 1,
        "source_tree": tree,
        "owner": owner,
        "native_plan": plan,
        "native_summary": summary,
        "packages": packages,
        "catalog": catalog_identity,
        "locales": seal(delivery.ROOT / "packages/contracts/src/localization"),
        "fonts": seal(delivery.ROOT / "packages/renderer/fonts"),
        "branding": seal(delivery.ROOT / "packages/renderer/branding"),
        "icons": seal(delivery.ROOT / "packages/renderer/icons"),
        "verification_streams": ["STORY-002-010", "STORY-002-011"],
    }
    delivery.require(
        not delivery.git("status", "--porcelain", "--untracked-files=all")
        and delivery.git("rev-parse", "HEAD^{tree}") == tree,
        "Candidate source changed while freezing.",
    )
    return {"candidate_id": fingerprint(content), **content}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog")
    catalog.add_argument("output", type=Path)
    candidate = commands.add_parser("freeze")
    candidate.add_argument("plan", type=Path)
    candidate.add_argument("native", type=Path)
    candidate.add_argument("catalog", type=Path)
    candidate.add_argument("catalog_identity", type=Path)
    candidate.add_argument("output", type=Path)
    candidate.add_argument("--owner", required=True)
    args = parser.parse_args()
    try:
        delivery.require(
            not args.output.exists(), "Preserve the previous candidate; use a new output path."
        )
        if args.command == "catalog":
            delivery.require(
                not delivery.git("status", "--porcelain", "--untracked-files=all"),
                "Build the catalog from clean candidate source.",
            )
            tree = delivery.git("rev-parse", "HEAD^{tree}")
            subprocess.run(
                [
                    sys.executable,
                    str(delivery.ROOT / "scripts/workspace.py"),
                    "run",
                    "catalog:build",
                ],
                cwd=delivery.ROOT,
                check=True,
            )
            delivery.require(
                not delivery.git("status", "--porcelain", "--untracked-files=all")
                and delivery.git("rev-parse", "HEAD^{tree}") == tree,
                "Catalog source changed during the build.",
            )
            result = {
                "source_tree": tree,
                "build": seal(delivery.ROOT / "artifacts/semantic-catalog"),
            }
        else:
            result = freeze(
                delivery.read(args.plan),
                args.native,
                args.catalog,
                delivery.read(args.catalog_identity),
                args.owner,
            )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(result, indent=2) + "\n")
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Interface candidate refused: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
