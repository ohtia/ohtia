"""Bind catalog generation records to the exact bytes of a frozen interface candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

import interface_candidate as candidate_tools
import quality_delivery as delivery

ROOT = Path(__file__).resolve().parents[1]
PROVENANCE = Path("packages/contracts/catalog-provenance.json")
CATALOGS = Path("packages/contracts/src/localization")


def read_json(path: Path) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            delivery.require(key not in result, f"Duplicate JSON member in {path.name}: {key}")
            result[key] = value
        return result

    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)
    delivery.require(isinstance(value, dict), "JSON root must be an object.")
    return value


def source_bytes(tree: str, resource: Path) -> bytes:
    delivery.require(bool(re.fullmatch(r"[a-f0-9]{40}", tree)), "Invalid source tree identity.")
    return subprocess.check_output(["git", "show", f"{tree}:{resource.as_posix()}"], cwd=ROOT)


def snapshot(candidate: dict, root: Path = ROOT) -> dict:
    """Capture inherited producers; running verification never makes this agent a translator."""
    content = {key: value for key, value in candidate.items() if key != "candidate_id"}
    delivery.require(
        candidate.get("version") == 1
        and candidate.get("candidate_id") == candidate_tools.fingerprint(content),
        "Invalid frozen candidate identity.",
    )
    actual = candidate_tools.seal(root / CATALOGS)
    delivery.require(actual == candidate["locales"], "Catalog bytes differ from the candidate.")
    provenance = read_json(root / PROVENANCE)
    delivery.require(provenance.get("schema_version") == 1, "Unknown generation record format.")
    historical = source_bytes(candidate["source_tree"], PROVENANCE)
    delivery.require(
        (root / PROVENANCE).read_bytes() == historical,
        "Generation records differ from candidate source.",
    )
    records = [{key: value for key, value in provenance.items() if key != "extensions"}]
    records.extend(provenance.get("extensions", []))
    delivery.require(
        all(
            "human_linguistic_review" in record and record["human_linguistic_review"] is None
            for record in records
        ),
        "Human review needs a versioned scope; this snapshot only covers unreviewed catalogs.",
    )
    for record in records:
        producer = record.get("producer", {})
        delivery.require(
            isinstance(record.get("scope"), str)
            and bool(record["scope"].strip())
            and isinstance(producer.get("agent"), str)
            and bool(producer["agent"].strip())
            and (
                producer.get("effective_model") is None
                or (
                    isinstance(producer["effective_model"], str)
                    and bool(producer["effective_model"].strip())
                )
            )
            and bool(record.get("effective_model_evidence")),
            "Incomplete inherited generation record.",
        )
    reference = actual["files"].get("en-US.json")
    delivery.require(reference is not None and len(actual["files"]) == 25, "Expected 25 catalogs.")
    catalogs = []
    reference_keys = set(read_json(root / CATALOGS / "en-US.json")["messages"])
    for name, digest in actual["files"].items():
        delivery.require(
            hashlib.sha256(source_bytes(candidate["source_tree"], CATALOGS / name)).hexdigest()
            == digest,
            "Catalog source differs from the frozen candidate.",
        )
        value = read_json(root / CATALOGS / name)
        locale = name.removesuffix(".json")
        delivery.require(
            name.endswith(".json") and value.get("locale") == locale and value.get("version") == 1,
            "Invalid catalog identity.",
        )
        delivery.require(set(value["messages"]) == reference_keys, "Different message inventory.")
        catalogs.append(
            {
                "locale": locale,
                "resource": (CATALOGS / name).as_posix(),
                "sha256": digest,
                "reference_locale": "en-US",
                "reference_sha256": reference,
                "producer_kind": "language-model",
                "generation_records": list(range(len(records))),
                "human_linguistic_review": "not-performed",
            }
        )
    return {
        "schema_version": 1,
        "candidate_id": candidate["candidate_id"],
        "source_tree": candidate["source_tree"],
        "generation_manifest": {
            "resource": PROVENANCE.as_posix(),
            "sha256": hashlib.sha256((root / PROVENANCE).read_bytes()).hexdigest(),
            "records": records,
        },
        "catalogs": catalogs,
        "limitations": [
            "Generation records describe message batches across all locales; they do not prove regional review.",
            "A null effective model remains unknown; verification does not replace the original producer.",
            "No human translation, name-connotation or native Korean linguistic review is recorded.",
            "Structural and presentation checks do not certify fluency, usability or accessibility conformance.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        result = snapshot(read_json(args.candidate))
        if args.check:
            delivery.require(
                candidate_tools.fingerprint(read_json(args.output))
                == candidate_tools.fingerprint(result),
                "Provenance snapshot is stale.",
            )
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(
            "Catalog provenance matches the frozen candidate; human linguistic review not performed."
        )
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Catalog provenance refused: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
