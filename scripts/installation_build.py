"""Construct one unsigned Linux package; this process has no attestation or signing authority."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import installation_build_contract as contract


def build(source, recipe, output, env):
    context = contract.identity(env)
    cell = contract.selection(env["BUILD_SELECTION"], recipe)
    contract.require(
        not any(
            name.startswith("SCW_")
            or name
            in {"ACTIONS_ID_TOKEN_REQUEST_TOKEN", "CSC_KEY_PASSWORD", "WIN_CSC_KEY_PASSWORD"}
            for name in env
        ),
        "credentialed_builder",
    )
    before, _ = contract.source_contract(source, context)
    # Dependency-executing imports belong exclusively to this unprivileged construction job.
    sys.path.insert(0, str(source / "scripts"))
    import quality_native

    contract.require(not output.exists(), "fresh_output")
    output.mkdir(parents=True)
    work = output.parent / "unsigned-package-work"
    version = before["contracts"]["versions"][0]
    packages = quality_native.construct_package(cell, work, version)
    extension = cell["formats"][0]
    found = list(packages.glob(f"*.{extension}"))
    contract.require(len(found) == 1, "package_count")
    contract.require(0 < found[0].stat().st_size <= contract.MAXIMUM_PACKAGE, "package_size")
    contract.require(contract.source_contract(source, context)[0] == before, "changed_source")
    shutil.copyfile(found[0], output / f"package.{extension}")


if __name__ == "__main__":
    try:
        build(
            Path(os.environ["SOURCE_ROOT"]),
            Path(__file__).resolve().parents[1],
            Path(os.environ["BUILD_OUTPUT"]),
            os.environ,
        )
    except (OSError, ValueError, KeyError, RuntimeError):
        raise SystemExit("Unsigned package construction refused.") from None
