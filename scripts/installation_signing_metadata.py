"""Validate public deployment metadata without performing I/O or granting authority."""

from __future__ import annotations

import hashlib
import json
import re

MAX_VARIABLE_BYTES = 2 * 1024 * 1024


def require(condition: bool) -> None:
    if not condition:
        raise ValueError("Invalid signing deployment metadata.")


def unique(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, item in pairs:
        require(key not in result)
        result[key] = item
    return result


def repository_variables(raw: bytes) -> dict[str, str]:
    require(0 < len(raw) <= MAX_VARIABLE_BYTES)
    pages = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(pages, list) and 0 < len(pages) <= 100)
    variables = {}
    total = None
    for page in pages:
        require(isinstance(page, dict))
        count, rows = page.get("total_count"), page.get("variables")
        require(type(count) is int and 0 <= count <= 1000 and isinstance(rows, list))
        require(total is None or total == count)
        total = count
        for row in rows:
            require(isinstance(row, dict))
            name, value = row.get("name"), row.get("value")
            require(isinstance(name, str) and isinstance(value, str) and name not in variables)
            variables[name] = value
    require(len(variables) == total)
    return variables


def caller_bindings(variables: dict[str, str]) -> dict:
    origin = variables.get("SCW_SIGNING_SERVICE_ORIGIN", "")
    buckets = {
        role: variables.get("SCW_SIGNING_" + role.upper() + "_BUCKET", "")
        for role in ("ingress", "retained")
    }
    require(
        len(origin) <= 512
        and re.fullmatch(r"https://[a-z0-9][a-z0-9.-]*\.fnc\.fr-par\.scw\.cloud", origin)
        is not None
    )
    require(all(re.fullmatch(r"[a-z][a-z0-9-]{1,61}[a-z0-9]", v) for v in buckets.values()))
    require(buckets["ingress"] != buckets["retained"])
    return {"service_origin": origin, "buckets": buckets}


def caller_hash(bindings: dict) -> str:
    # This closed record contains only ASCII keys and validated ASCII locator values.
    raw = (json.dumps(bindings, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return hashlib.sha256(raw).hexdigest()
