"""Canonical image-input identity shared by the hosted producer and the E2E consumer."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
BUILD = "config/desktop/linux-e2e-build.json"


def inputs(root=ROOT):
    """Return the mode and SHA-256 of every declared image input in this checkout."""
    declaration = json.loads((root / BUILD).read_bytes())["image_inputs"]
    if (
        not isinstance(declaration, list)
        or not declaration
        or any(not isinstance(name, str) for name in declaration)
        or len(declaration) != len(set(declaration))
        or BUILD not in declaration
    ):
        raise ValueError("Invalid canonical image-input declaration.")
    result = {}
    for name in sorted(declaration):
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or str(path) != name:
            raise ValueError("Image inputs must be canonical repository paths.")
        file = root / name
        if file.is_symlink() or not file.is_file():
            raise ValueError(f"Image input must be a regular file: {name}")
        mode = "100755" if file.stat().st_mode & 0o111 else "100644"
        result[name] = {"mode": mode, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
    return result


def fingerprint(records):
    return hashlib.sha256(
        json.dumps(records, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
