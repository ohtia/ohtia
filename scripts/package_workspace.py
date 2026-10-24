"""Archive built workspace libraries; this is not an installable desktop distribution."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import TypedDict, cast

ROOT = Path(__file__).resolve().parent.parent


class PackageManifest(TypedDict):
    exports: dict[str, dict[str, str]]


def write_archive(destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        boundaries = cast(
            dict[str, object],
            json.loads((ROOT / "config/workspace-boundaries.json").read_text(encoding="utf-8")),
        )
        for name in sorted(boundaries):
            directory = ROOT / "packages" / name
            if directory.resolve() != directory:
                raise SystemExit("Archive inputs must be real declared package directories.")
            manifest_path = directory / "package.json"
            manifest = cast(PackageManifest, json.loads(manifest_path.read_text(encoding="utf-8")))
            for entry in manifest["exports"]["."].values():
                if not (manifest_path.parent / entry).is_file():
                    raise SystemExit("Missing public build output; run the workspace build first.")
            for path in [manifest_path, *sorted((manifest_path.parent / "dist").rglob("*"))]:
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT))
        for name in (
            "pnpm-lock.yaml",
            "config/desktop/targets.json",
            "config/desktop/toolchain.json",
        ):
            archive.write(ROOT / name, name)


def main() -> None:
    output = ROOT / "artifacts/workspace-libraries.zip"
    output.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(
        prefix=".workspace-", suffix=".zip", dir=output.parent, delete=False
    ) as stream:
        temporary = Path(stream.name)
    try:
        write_archive(temporary)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(
        "Created artifacts/workspace-libraries.zip (libraries only, no desktop runtime or installer)."
    )


if __name__ == "__main__":
    main()
