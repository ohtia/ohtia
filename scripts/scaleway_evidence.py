"""Bound compressed native observations independently from the small result envelope."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import zlib
from pathlib import Path

import scaleway_cycle as cycle

FILENAME = "native-observations.json.gz"


def summary(value: dict) -> dict:
    cycle.require(
        isinstance(value.get("samples"), list)
        and all(isinstance(row, dict) for row in value["samples"])
        and isinstance(value.get("display_observations"), list),
        "observation_shape",
    )
    samples = value["samples"]
    renderers = [row for row in samples if row.get("renderer")]
    cycle.require(
        renderers and all(row.get("sandbox") is True for row in renderers), "observation_sandbox"
    )
    cycle.require(
        value["remaining"] == [] and bool(value["display_observations"]), "observation_completion"
    )
    return {
        "sample_count": len(samples),
        "renderer_sample_count": len(renderers),
        "renderers_sandboxed": True,
        "display_observation_count": len(value["display_observations"]),
        "remaining": [],
    }


def pack(directory: Path, observations: dict) -> dict:
    limits = cycle.policy()["limits"]
    result = summary(observations)
    file = directory / FILENAME
    total = 0
    with file.open("xb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", mtime=0, filename="") as compressed:
            encoder = json.JSONEncoder(sort_keys=True, separators=(",", ":"), allow_nan=False)
            for text in encoder.iterencode(observations):
                data = text.encode("utf-8")
                total += len(data)
                cycle.require(
                    total <= limits["maximum_observation_bytes"], "observation_expanded_bound"
                )
                compressed.write(data)
    cycle.require(
        file.stat().st_size <= limits["maximum_observation_archive_bytes"],
        "observation_compressed_bound",
    )
    result["artifact"] = {
        "file": FILENAME,
        "encoding": "gzip",
        "bytes": file.stat().st_size,
        "uncompressed_bytes": total,
        "sha256": cycle.digest(file),
    }
    return result


def admit(data: bytes, expected: dict) -> None:
    limits = cycle.policy()["limits"]
    record = expected["artifact"]
    cycle.require(
        set(record) == {"file", "encoding", "bytes", "uncompressed_bytes", "sha256"}
        and record["file"] == FILENAME
        and record["encoding"] == "gzip",
        "observation_artifact",
    )
    cycle.require(
        0 < len(data) == record["bytes"] <= limits["maximum_observation_archive_bytes"]
        and 0 < cycle.integer(record["uncompressed_bytes"]) <= limits["maximum_observation_bytes"],
        "observation_transfer_bound",
    )
    cycle.require(
        hashlib.sha256(data).hexdigest() == cycle.sha(record["sha256"]),
        "observation_digest",
    )
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as source:
            uncompressed = source.read(limits["maximum_observation_bytes"] + 1)
        cycle.require(
            len(uncompressed) == record["uncompressed_bytes"]
            and len(uncompressed) <= limits["maximum_observation_bytes"],
            "observation_expanded_bound",
        )
        observed = cycle.decode(uncompressed, limits["maximum_observation_bytes"])
    except cycle.CycleError:
        raise
    except (OSError, EOFError, ValueError, zlib.error):
        raise cycle.CycleError("invalid_observation_archive") from None
    cycle.require(
        {key: value for key, value in expected.items() if key != "artifact"} == summary(observed),
        "observation_summary",
    )
