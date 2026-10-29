"""Collect inert PR inputs and prepare reviewable release-note annotations (Python >=3.12).

All history, editorial assessments and approval receipts are supplied by a trusted
operator. Hashes identify bytes and context; they do not authenticate a reviewer
or authorize publication. This module performs no network or process execution.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

MAX_BYTES = 8 * 1024 * 1024
MAX_ITEMS = 20000
DISCLOSURES = (
    "migration",
    "reinstall",
    "removed_support",
    "format_adapter",
    "privacy_transfers",
    "security_urgency",
    "limitations",
)
KINDS = {"capability", "improvement", "correction", "deprecation/removal", "security"}
HEX40 = re.compile(r"[a-f0-9]{40}")
HEX64 = re.compile(r"[a-f0-9]{64}")
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
IDENTIFIER = re.compile(r"[a-z][a-z0-9-]{0,79}")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
CLAIM = re.compile(
    r"\b(faster|fastest|quicker|speed|performance|improv\w*|better|best|safer|secure\w*|"
    r"reduc\w*|increas\w*|sav\w* time|efficien\w*|reliab\w*)\b|\d\s*%",
    re.I,
)
AUTOLINK = re.compile(r"[:@]|www\.|#\d|\bgh-\d|\b[a-f0-9]{7,64}\b", re.I)
MARKER = re.compile(r"^```ohtia-note\n(.*?)\n```[ \t]*$", re.M | re.S)


class NoteError(ValueError):
    """An input is incomplete, inconsistent or no longer approved."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise NoteError(message)


def fields(value: object, names: str) -> dict:
    require(isinstance(value, dict) and set(value) == set(names.split()), "Unexpected fields.")
    return value


def versioned(value: object, names: str) -> dict:
    result = fields(value, "schema_version " + names)
    require(
        type(result["schema_version"]) is int and result["schema_version"] == 1,
        "Unsupported schema version.",
    )
    return result


def sequence(value: object) -> list:
    require(isinstance(value, list) and len(value) <= MAX_ITEMS, "Invalid or oversized list.")
    return value


def text(value: object) -> str:
    require(
        isinstance(value, str) and 0 < len(value) <= 4096 and value == value.strip(),
        "Expected nonempty bounded text.",
    )
    require(
        not any(unicodedata.category(c).startswith("C") for c in value),
        "Control characters are not permitted in text.",
    )
    return value


def match(value: object, pattern: re.Pattern) -> str:
    require(isinstance(value, str) and pattern.fullmatch(value) is not None, "Invalid identifier.")
    return value


def number(value: object) -> int:
    require(type(value) is int and 0 < value < 2**53, "Invalid issue or PR number.")
    return value


def unique(values: object, validator) -> list:
    items = sequence(values)
    for item in items:
        validator(item)
    require(len(set(items)) == len(items), "Duplicate list entry.")
    return items


def url(value: object) -> str:
    # URLs are retained as plain text evidence, never used as a fetch destination.
    result = text(value)
    require(
        re.fullmatch(r"https://[A-Za-z0-9][A-Za-z0-9./_~:#?=&%+@!,-]*", result) is not None,
        "Evidence requires a plain HTTPS URL.",
    )
    return result


def consequences(value: object) -> dict:
    result = fields(value, " ".join(DISCLOSURES))
    for item in result.values():
        if item is not None:
            text(item)
    return result


def claims(value: object) -> list:
    items = sequence(value)
    for item in items:
        fields(item, "text evidence")
        text(item["text"])
        require(bool(unique(item["evidence"], url)), "Claims require supporting evidence.")
    require(len({item["text"] for item in items}) == len(items), "Duplicate claim.")
    return items


def check_claims(strings: list[str], evidence: list) -> None:
    supported = {claim["text"] for claim in evidence}
    for value in strings:
        require(
            not CLAIM.search(value) or value in supported,
            "A possible benefit/performance claim needs explicit evidence and editorial review.",
        )


def unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON field.")
        result[key] = value
    return result


def decode(raw: str) -> object:
    require(len(raw.encode("utf-8")) <= MAX_BYTES, "Input exceeds the byte limit.")
    try:
        return json.loads(
            raw,
            object_pairs_hook=unique_object,
            parse_constant=lambda _: require(False, "Nonfinite JSON number."),
            parse_float=lambda _: require(False, "Noninteger JSON numbers are not supported."),
        )
    except (json.JSONDecodeError, RecursionError) as error:
        raise NoteError("Invalid JSON document.") from error


def read(path: Path) -> object:
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    require(len(raw) <= MAX_BYTES, "Input exceeds the byte limit.")
    return decode(raw.decode("utf-8"))


def canonical(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode("ascii")


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def bytes_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def write(path: Path, value: object) -> None:
    # Never replace prior evidence. An interrupted write stays visibly invalid.
    raw = canonical(value)
    require(
        len(raw) <= MAX_BYTES,
        "Output exceeds the byte limit; review the bounded input contract before retry.",
    )
    with path.open("xb") as stream:
        stream.write(raw)


def validate_note(note: object) -> dict:
    require(isinstance(note, dict), "Expected a note object.")
    if note.get("impact") == "none":
        versioned(note, "pr issues impact reason")
        text(note["reason"])
    else:
        versioned(
            note,
            "pr issues impact change_id kind task result platforms availability disclosures claims",
        )
        require(note["impact"] == "user", "Unknown impact classification.")
        match(note["change_id"], IDENTIFIER)
        require(note["kind"] in KINDS, "Unknown change kind.")
        text(note["task"])
        text(note["result"])
        require(bool(unique(note["platforms"], text)), "Platforms are required.")
        require(note["availability"] in {"available", "unfinished"}, "Unknown availability.")
        consequences(note["disclosures"])
        # Author claims can be incomplete; assembly checks the reviewed final claims.
        sequence(note["claims"])
        for claim in note["claims"]:
            fields(claim, "text evidence")
            text(claim["text"])
            unique(claim["evidence"], url)
    number(note["pr"])
    require(bool(unique(note["issues"], number)), "Issue evidence is required.")
    return note


def validate_notes(value: object) -> dict[int, dict]:
    value = versioned(value, "notes")
    result = {}
    for note in sequence(value["notes"]):
        validate_note(note)
        require(note["pr"] not in result, "Duplicate PR note.")
        result[note["pr"]] = note
    return result


def collect(value: object) -> dict:
    value = versioned(value, "pull_requests")
    notes = []
    for pr in sequence(value["pull_requests"]):
        fields(pr, "number body")
        number(pr["number"])
        require(isinstance(pr["body"], str), "Expected a PR body.")
        body = pr["body"].replace("\r\n", "\n")
        require(body.count("```ohtia-note") == 1, "Expected exactly one ohtia-note block.")
        blocks = MARKER.findall(body)
        require(len(blocks) == 1, "Invalid ohtia-note fence.")
        note = validate_note(decode(blocks[0]))
        require(note["pr"] == pr["number"], "PR body and capture identity differ.")
        notes.append(note)
    result = {"schema_version": 1, "notes": notes}
    validate_notes(result)
    return result


def history_scope(history: object, channel: str, application_version: str) -> dict:
    history = versioned(history, "repository source commits releases")
    match(history["repository"], REPOSITORY)
    match(history["source"], HEX40)
    require(channel in {"preview", "stable"}, "Unknown channel.")
    match(application_version, VERSION)
    commits = {}
    for commit in sequence(history["commits"]):
        fields(commit, "sha parents pr reason")
        sha = match(commit["sha"], HEX40)
        require(sha not in commits, "Duplicate commit.")
        parents = unique(commit["parents"], lambda x: match(x, HEX40))
        require(all(p in commits for p in parents), "History must include parents before children.")
        if commit["pr"] is None:
            text(commit["reason"])
        else:
            number(commit["pr"])
            require(commit["reason"] is None, "PR commits cannot carry an exclusion reason.")
        commits[sha] = commit
    require(history["source"] in commits, "Selected source is absent from history.")

    def ancestors(source: str) -> set[str]:
        require(source in commits, "Release source is absent from history.")
        found, todo = set(), [source]
        while todo:
            sha = todo.pop()
            if sha not in found:
                found.add(sha)
                todo.extend(commits[sha]["parents"])
        return found

    selected = ancestors(history["source"])
    require(set(commits) == selected, "History contains commits outside selected ancestry.")
    releases, ids = [], set()
    for release in sequence(history["releases"]):
        fields(release, "id version channel source announced")
        text(release["id"])
        require(release["id"] not in ids, "Duplicate release identity.")
        ids.add(release["id"])
        match(release["version"], VERSION)
        require(release["channel"] in {"stable", "preview"}, "Unknown release channel.")
        match(release["source"], HEX40)
        require(release["source"] in selected, "Published baseline is not an ancestor of source.")
        unique(release["announced"], lambda x: match(x, IDENTIFIER))
        releases.append(release)
    choices = [
        r
        for r in releases
        if r["channel"] == channel and (channel == "stable" or r["version"] == application_version)
    ]
    previous = choices[-1] if choices else None
    baseline_commits = ancestors(previous["source"]) if previous else set()
    delta = selected - baseline_commits

    def prs(subset):
        return sorted({commits[s]["pr"] for s in subset if commits[s]["pr"] is not None})

    return {
        "repository": history["repository"],
        "source": history["source"],
        "channel": channel,
        "application_version": application_version,
        "baseline": previous,
        "commits": sorted(delta),
        "prs": prs(delta),
        "all_prs": prs(selected),
        "excluded_commits": [commits[s] for s in sorted(delta) if commits[s]["pr"] is None],
    }


def plain(value: str) -> str:
    # GitHub post-processes decoded text for mentions/references even after entity encoding.
    # Protect every caller colon, including fragments completed by fixed template punctuation.
    # Encoder-owned code elements suppress post-processing without changing visible bytes.
    parts = []
    for token in re.split(r"( +)", value):
        encoded = "".join(c if c.isalnum() or c == " " else f"&#{ord(c)};" for c in token)
        parts.append(f"<code>{encoded}</code>" if AUTOLINK.search(token) else encoded)
    return "".join(parts)


def assemble(history: object, note_inputs: object, editorial: object) -> dict:
    editorial = versioned(
        editorial, "source channel application_version summary claims assessments changes"
    )
    scope = history_scope(history, editorial["channel"], editorial["application_version"])
    require(editorial["source"] == scope["source"], "Editorial source differs.")
    text(editorial["summary"])
    claims(editorial["claims"])
    check_claims([editorial["summary"]], editorial["claims"])
    notes = validate_notes(note_inputs)
    require(set(notes) == set(scope["all_prs"]), "Missing or unrelated PR note inputs.")
    assessments = {}
    groups = {}
    for assessment in sequence(editorial["assessments"]):
        fields(assessment, "pr impact reason disclosures")
        pr = number(assessment["pr"])
        require(pr not in assessments and pr in notes, "Duplicate or unrelated assessment.")
        require(assessment["impact"] in {"none", "user"}, "Unknown assessed impact.")
        text(assessment["reason"])
        consequences(assessment["disclosures"])
        require(
            assessment["impact"] == notes[pr]["impact"], "PR impact needs editorial correction."
        )
        if assessment["impact"] == "none":
            require(
                all(v is None for v in assessment["disclosures"].values()),
                "A consequence cannot be classified as no public effect.",
            )
        else:
            groups.setdefault(notes[pr]["change_id"], []).append(pr)
        assessments[pr] = assessment
    require(
        set(assessments) == set(notes), "Every source PR needs independent editorial assessment."
    )
    items, retained, warnings, details, seen = [], [], [], [], set()
    baseline = scope["baseline"]
    delta_prs = set(scope["prs"])
    announced = set(baseline["announced"]) if baseline else set()
    require(announced <= set(groups), "Baseline announcements are absent from source note history.")
    for change in sequence(editorial["changes"]):
        fields(change, "id available kind task result platforms prs issues disclosures claims")
        identifier = match(change["id"], IDENTIFIER)
        require(
            identifier in groups and identifier not in seen,
            "Duplicate or unrelated editorial change.",
        )
        seen.add(identifier)
        require(type(change["available"]) is bool, "Availability must be explicitly assessed.")
        require(change["kind"] in KINDS, "Unknown editorial kind.")
        for key in ("task", "result"):
            text(change[key])
        require(bool(unique(change["platforms"], text)), "Editorial platforms are required.")
        unique(change["prs"], number)
        require(set(change["prs"]) == set(groups[identifier]), "Incomplete grouped PR evidence.")
        issues = {i for pr in change["prs"] for i in notes[pr]["issues"]}
        require(
            set(unique(change["issues"], number)) == issues, "Incomplete grouped issue evidence."
        )
        disclosures = fields(change["disclosures"], " ".join(DISCLOSURES))
        for key, values in disclosures.items():
            unique(values, text)
            required = {
                v
                for pr in change["prs"]
                for v in (notes[pr]["disclosures"][key], assessments[pr]["disclosures"][key])
                if v is not None
            }
            require(
                required <= set(values), "A required consequence was omitted from editorial notes."
            )
        claims(change["claims"])
        check_claims(
            [change["task"], change["result"], *[v for vs in disclosures.values() for v in vs]],
            change["claims"],
        )
        relevant = bool(set(change["prs"]) & delta_prs) or identifier not in announced
        if not change["available"]:
            require(
                identifier not in announced,
                "Previously available scope needs an explicit removal note.",
            )
            retained.append(change)
            continue
        if change["kind"] == "deprecation/removal":
            require(
                bool(disclosures["removed_support"]),
                "A deprecation/removal requires its user consequence.",
            )
        # Current applicable disclosures survive even when unchanged capability prose is omitted.
        for key, values in disclosures.items():
            for value in values:
                warning = f"- {key.replace('_', ' ').capitalize()}: {plain(value)}"
                if warning not in warnings:
                    warnings.append(warning)
        if not relevant:
            continue
        items.append(change)
        base_url = f"https://github.com/{scope['repository']}"
        links = [f"[PR #{p}]({base_url}/pull/{p})" for p in sorted(change["prs"])]
        links += [f"[Issue #{i}]({base_url}/issues/{i})" for i in sorted(issues)]
        details.append(f"- {plain(change['task'])}: " + ", ".join(links))
        for claim in change["claims"]:
            details.append(
                f"- Claim evidence ({plain(claim['text'])}): "
                + ", ".join(plain(u) for u in claim["evidence"])
            )
    require(seen == set(groups), "An editorial change is missing.")
    items.sort(key=lambda c: c["id"])
    retained.sort(key=lambda c: c["id"])
    baseline_text = (
        f"{baseline['id']} ({baseline['source']})" if baseline else "none; complete delivered scope"
    )
    lines = [
        f"# Ohtia {scope['application_version']} — {scope['channel']}",
        "",
        f"Baseline: {plain(baseline_text)}.",
        "",
    ]
    if warnings:
        lines += ["## Required actions and important disclosures", "", *sorted(warnings), ""]
    lines += [plain(editorial["summary"]), ""]
    for heading, kinds in (
        ("Improvements", {"capability", "improvement"}),
        ("Corrections", {"correction"}),
        ("Deprecations and removals", {"deprecation/removal"}),
        ("Security", {"security"}),
    ):
        bullets = [
            f"- {plain(c['task'])}: {plain(c['result'])} "
            f"(Platforms: {plain(', '.join(c['platforms']))}.)"
            for c in items
            if c["kind"] in kinds
        ]
        if bullets:
            lines += [f"## {heading}", "", *bullets, ""]
    lines += ["## Technical details", "", f"Source: {scope['source']}.", "", *sorted(details)]
    for claim in editorial["claims"]:
        lines.append(
            f"- Summary evidence: {plain(claim['text'])}: "
            + ", ".join(plain(u) for u in claim["evidence"])
        )
    body = "\n".join(lines).rstrip() + "\n"
    payload = {
        "schema_version": 1,
        "kind": "note",
        "scope": scope,
        "inputs": {"history": history, "notes": note_inputs, "editorial": editorial},
        "inputs_sha256": digest({"history": history, "notes": note_inputs, "editorial": editorial}),
        "body": body,
        "body_sha256": bytes_digest(body),
        "announced": sorted(announced | {c["id"] for c in items}),
        "retained": retained,
    }
    return seal(payload)


def seal(payload: dict) -> dict:
    return copy.deepcopy({**payload, "subject_sha256": digest(payload)})


def unseal(value: object) -> dict:
    require(isinstance(value, dict) and "subject_sha256" in value, "Missing content identity.")
    payload = {k: v for k, v in value.items() if k != "subject_sha256"}
    require(match(value["subject_sha256"], HEX64) == digest(payload), "Content identity changed.")
    return payload


def validate_bundle(value: object) -> dict:
    payload = unseal(value)
    versioned(payload, "kind scope inputs inputs_sha256 body body_sha256 announced retained")
    require(payload["kind"] == "note", "Expected a note bundle.")
    scope = fields(
        payload["scope"],
        "repository source channel application_version baseline commits prs all_prs excluded_commits",
    )
    match(scope["repository"], REPOSITORY)
    match(scope["source"], HEX40)
    require(scope["channel"] in {"stable", "preview"}, "Invalid note channel.")
    match(scope["application_version"], VERSION)
    match(payload["inputs_sha256"], HEX64)
    require(
        isinstance(payload["body"], str) and len(payload["body"].encode("utf-8")) <= MAX_BYTES,
        "Invalid note body.",
    )
    require(payload["body_sha256"] == bytes_digest(payload["body"]), "Note bytes changed.")
    unique(payload["announced"], lambda x: match(x, IDENTIFIER))
    sequence(payload["retained"])
    inputs = fields(payload["inputs"], "history notes editorial")
    require(payload["inputs_sha256"] == digest(inputs), "Assembly input identity changed.")
    require(
        value == assemble(inputs["history"], inputs["notes"], inputs["editorial"]),
        "Note bundle must reproduce its complete reviewed assembly inputs.",
    )
    return value


def candidate(value: object) -> dict:
    value = versioned(value, "id source application_version packages_sha256")
    match(value["id"], HEX64)
    match(value["source"], HEX40)
    match(value["application_version"], VERSION)
    match(value["packages_sha256"], HEX64)
    return value


def propose(note: object, package_identity: object) -> dict:
    validate_bundle(note)
    candidate(package_identity)
    require(
        note["scope"]["source"] == package_identity["source"]
        and note["scope"]["application_version"] == package_identity["application_version"],
        "Note and candidate identities differ.",
    )
    return seal(
        {"schema_version": 1, "kind": "annotation", "candidate": package_identity, "note": note}
    )


def receipt(value: object, subject: str) -> dict:
    value = versioned(value, "subject_sha256 by evidence")
    require(value["subject_sha256"] == subject, "Approval does not identify the current proposal.")
    require(
        re.fullmatch(r"human:[A-Za-z0-9][A-Za-z0-9-]{0,38}", value["by"]) is not None,
        "An explicit human review identity is required.",
    )
    url(value["evidence"])
    return value


def validate_approved(value: object) -> dict:
    value = versioned(value, "proposal approval")
    validate_proposal(value["proposal"])
    receipt(value["approval"], value["proposal"]["subject_sha256"])
    return value


def validate_proposal(value: object) -> dict:
    payload = unseal(value)
    if payload.get("kind") == "annotation":
        versioned(payload, "kind candidate note")
        require(
            value == propose(payload["note"], payload["candidate"]), "Invalid annotation proposal."
        )
    else:
        versioned(payload, "kind before after reason")
        require(
            payload["kind"] in {"channel-promotion", "prose-correction"},
            "Unknown review operation.",
        )
        text(payload["reason"])
        # Transitions retain two annotation receipts, never recursively nested transitions.
        for side in ("before", "after"):
            approved = versioned(payload[side], "proposal approval")
            annotation = fields(
                approved["proposal"], "schema_version kind candidate note subject_sha256"
            )
            require(annotation["kind"] == "annotation", "Transition requires approved annotations.")
            validate_approved(payload[side])
        before = payload["before"]["proposal"]
        after = payload["after"]["proposal"]
        require(
            before["candidate"] == after["candidate"], "A prose operation cannot change packages."
        )
        old, new = before["note"], after["note"]
        if payload["kind"] == "channel-promotion":
            require(
                old["scope"]["channel"] == "preview" and new["scope"]["channel"] == "stable",
                "Promotion requires preview to stable.",
            )
        else:
            require(
                old["scope"] == new["scope"], "Correction cannot change channel or baseline scope."
            )
            require(old["body_sha256"] != new["body_sha256"], "Correction needs changed prose.")
    return value


def approve(proposal: object, decision: object) -> dict:
    validate_proposal(proposal)
    receipt(decision, proposal["subject_sha256"])
    return copy.deepcopy({"schema_version": 1, "proposal": proposal, "approval": decision})


def transition(before: object, after: object, kind: str, reason: str) -> dict:
    result = seal(
        {"schema_version": 1, "kind": kind, "before": before, "after": after, "reason": reason}
    )
    validate_proposal(result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    commands = {
        "collect": ("capture", "output"),
        "assemble": ("history", "notes", "editorial", "output"),
        "render": ("note",),
        "propose": ("note", "candidate", "output"),
        "approve": ("proposal", "decision", "output"),
        "transition": ("before", "after", "kind", "reason", "output"),
        "verify": ("approved",),
    }
    for name, arguments in commands.items():
        command = sub.add_parser(name)
        for arg in arguments:
            command.add_argument(arg)
    args = parser.parse_args(argv)
    try:

        def load(name):
            return read(Path(getattr(args, name)))

        if args.command == "collect":
            result = collect(load("capture"))
        elif args.command == "assemble":
            result = assemble(load("history"), load("notes"), load("editorial"))
        elif args.command == "render":
            print(validate_bundle(load("note"))["body"], end="")
            return 0
        elif args.command == "propose":
            result = propose(load("note"), load("candidate"))
        elif args.command == "approve":
            result = approve(load("proposal"), load("decision"))
        elif args.command == "transition":
            result = transition(load("before"), load("after"), args.kind, args.reason)
        else:
            validate_approved(load("approved"))
            print("Note receipt is internally consistent; external authorization remains required.")
            return 0
        write(Path(args.output), result)
        return 0
    except (ValueError, OSError, UnicodeError, TypeError, KeyError, RecursionError, OverflowError):
        print(
            "Change notes failed: invalid/incomplete input, stale approval, or unavailable output. "
            "Review the documented schema and use a new evidence path.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
