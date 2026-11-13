"""Read the application version that the root package.json declares.

The root manifest is the only source of the application version. A release build
uses that final version exactly; a continuous-integration or contributor package
appends the run and attempt as ``<version>-dev.<run>.<attempt>``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NUMBER = r"(?:0|[1-9][0-9]*)"
FINAL = re.compile(rf"{NUMBER}\.{NUMBER}\.{NUMBER}")
# Groups: the final version, then the run and the attempt.
DEVELOPMENT = re.compile(rf"({FINAL.pattern})-dev\.([1-9][0-9]*)\.([1-9][0-9]*)")


class VersionError(ValueError):
    """The root manifest does not declare a usable application version."""


def root_version(root: Path | None = None) -> str:
    """Return the final major.minor.patch version of the root manifest, which a release build uses exactly."""
    try:
        manifest = json.loads((root or ROOT).joinpath("package.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise VersionError("The root package.json cannot be read as JSON.") from error
    value = manifest.get("version") if isinstance(manifest, dict) else None
    if type(value) is not str or FINAL.fullmatch(value) is None:
        raise VersionError(
            "The root package.json version must be a final major.minor.patch version without leading zeroes or a prerelease suffix."
        )
    return value


def development_version(run: int, attempt: int, root: Path | None = None) -> str:
    """Return the development package version for one run and attempt."""
    if not all(type(value) is int and value > 0 for value in (run, attempt)):
        raise VersionError("A development version requires a positive run and attempt.")
    return f"{root_version(root)}-dev.{run}.{attempt}"
