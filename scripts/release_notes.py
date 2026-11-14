"""Write the first release-notes text of a prepared version from its pull requests' notes.

The prepare-release workflow runs this entry point in a read-only job, from the workflow
revision, before the release job. It reads the first-parent history of the selected commit from
a full checkout and the merged pull requests from the GitHub API, collects each pull request's
``ohtia-note`` block with ``scripts/change_notes.py``, and writes ``notes.md`` and
``notes.json``. Pull request text is inert data: it is never executed, and every character that
Markdown or GitHub could turn into markup, a mention or a link is rendered literally.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import change_notes
import release_prepare

VERSION_TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
SHA = re.compile(r"[0-9a-f]{40}")
MAXIMUM_PULL_PAGES = 100
SUMMARY = "<!-- Summary: replace this comment with one or two sentences about this release. -->"
ACTIONS = (
    "migration",
    "reinstall",
    "removed_support",
    "format_adapter",
    "privacy_transfers",
    "security_urgency",
)
NOTICES = "Breaking Changes and Notices"
SECTIONS = (
    ("Security", {"security"}),
    ("Features", {"capability", "improvement"}),
    ("Bug Fixes", {"correction"}),
)
# GitHub refuses a longer release body; the release job adds the unsigned-packages section.
MAXIMUM_CHARACTERS = release_prepare.MAXIMUM_BODY_CHARACTERS - 5000
# Text GitHub turns into a mention, a reference, a link, math or an emoji after Markdown;
# a backslash does not stop it, a code span does (checked with GitHub's Markdown API).
LINKED = re.compile(
    r"@|://|www\.|#\d|\bgh-\d|\b(?=[0-9a-f]*\d)[0-9a-f]{7,64}\b|\$|:[a-z0-9_+-]+:",
    re.IGNORECASE,
)
MARKUP = re.compile(r"([\\`*_\[\]<>~|#&!])")
# Block markers at the start of a line; a backslash escapes punctuation, never a digit.
LEADING_MARK = re.compile(r"^([+\-=])")
LEADING_NUMBER = re.compile(r"^(\d+)([.)])")


def require(condition: bool, message: str) -> None:
    release_prepare.require(condition, message)


def git(source: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=source, text=True, timeout=120)


def code(token: str) -> str:
    """Return a Markdown code span that shows the token exactly."""
    fence = "`" * (max((len(run) for run in re.findall(r"`+", token)), default=0) + 1)
    pad = " " if token.startswith("`") or token.endswith("`") else ""
    return f"{fence}{pad}{token}{pad}{fence}"


def literal(text: str, leading: bool = False) -> str:
    """Render note text on one line, as literal text, with standard Markdown escapes."""
    words = []
    for token in " ".join(text.split()).split(" "):
        words.append(code(token) if LINKED.search(token) else MARKUP.sub(r"\\\1", token))
    rendered = " ".join(words)
    if leading:
        rendered = LEADING_NUMBER.sub(r"\1\\\2", LEADING_MARK.sub(r"\\\1", rendered))
    return rendered


def previous_tag(source: Path, commit: str) -> str | None:
    """Return the highest published version tag in the history of the commit, if any."""
    tags = git(source, "tag", "--list", "v*", "--merged", commit).split()
    versions = [
        (tuple(int(part) for part in match.groups()), tag)
        for tag in tags
        if (match := VERSION_TAG.fullmatch(tag))
    ]
    return max(versions)[1] if versions else None


def merges(source: Path, commit: str, baseline: str | None = None) -> list[tuple[str, list[str]]]:
    """List (merge commit, parents) on the first-parent history, oldest first."""
    arguments = ["log", "--first-parent", "--merges", "--reverse", "--format=%H %P", commit]
    if baseline is not None:
        arguments.append(f"^{baseline}")
    result = []
    for line in git(source, *arguments).splitlines():
        sha, *parents = line.split()
        require(all(SHA.fullmatch(value) for value in [sha, *parents]), "Unexpected history.")
        result.append((sha, parents))
    return result


def closed_pulls(github: release_prepare.GitHub) -> dict[int, dict]:
    """Read every closed pull request of the repository, bodies included."""
    pulls: dict[int, dict] = {}
    for page in range(1, MAXIMUM_PULL_PAGES + 1):
        _, values = github.api(
            "GET", f"pulls?state=closed&sort=created&direction=asc&per_page=100&page={page}"
        )
        require(isinstance(values, list), "Unexpected pull request listing.")
        for value in values:
            require(isinstance(value, dict) and isinstance(value.get("number"), int), "Bad PR.")
            pulls[value["number"]] = value
        if len(values) < 100:
            return pulls
    raise release_prepare.ReleaseError("Too many pull requests to list.")


def merged_by_head(pulls: dict[int, dict]) -> dict[str, int | None]:
    """Map each merged pull request's head commit to its number; None when ambiguous.

    A GitHub merge commit's second parent is the merged pull request's head. Matching by
    that commit, rather than by the editable merge subject, finds every merged pull request.
    """
    heads: dict[str, int | None] = {}
    for number, pull in pulls.items():
        head = pull.get("head")
        sha = head.get("sha") if isinstance(head, dict) else None
        if pull.get("merged_at") is not None and isinstance(sha, str) and SHA.fullmatch(sha):
            heads[sha] = None if sha in heads else number
    return heads


def note_of(pull: dict) -> dict | None:
    """Return the validated note of a merged pull request, or None."""
    if not isinstance(pull.get("body"), str):
        return None
    capture = {
        "schema_version": 1,
        "pull_requests": [{"number": pull["number"], "body": pull["body"]}],
    }
    try:
        return change_notes.collect(capture)["notes"][0]
    except (ValueError, TypeError, KeyError, RecursionError):
        return None


def draft(source: Path, commit: str, github: release_prepare.GitHub) -> dict:
    """Collect the notes of the pull requests since the previous published version."""
    require(SHA.fullmatch(commit) is not None, "Invalid selected commit.")
    require(git(source, "rev-parse", "HEAD").strip() == commit, "Check out the selected commit.")
    baseline = previous_tag(source, commit)
    in_range = {sha for sha, _ in merges(source, commit, baseline)}
    pulls = closed_pulls(github)
    heads = merged_by_head(pulls)
    order, delta, unmatched = [], set(), []
    for sha, parents in merges(source, commit):
        number = heads.get(parents[1]) if len(parents) == 2 else None
        if number is None:
            if sha in in_range:
                unmatched.append(sha)
            continue
        order.append(number)
        if sha in in_range:
            delta.add(number)
    notes: list[dict] = []
    without_note = []
    for number in order:
        note = note_of(pulls[number])
        if note is None:
            if number in delta:
                without_note.append(number)
        else:
            notes.append(note)
    # A change's pending notes are those of this range and the earlier unfinished notes after
    # its last earlier available note: an earlier available note was announced by an earlier
    # release, so that announcement and everything before it are not repeated.
    changes: dict[str, list[dict]] = {}
    for note in notes:
        if note["impact"] != "user":
            continue
        pending = changes.setdefault(note["change_id"], [])
        if note["pr"] not in delta and note["availability"] == "available":
            pending.clear()
        else:
            pending.append(note)
    announced, unfinished = [], []
    for group in changes.values():
        current = [note for note in group if note["pr"] in delta]
        if not current:
            continue
        latest = current[-1]
        if latest["availability"] != "available":
            unfinished.append(latest["pr"])
            continue
        disclosures: dict[str, list[str]] = {key: [] for key in ACTIONS}
        for note in group:
            for key in ACTIONS:
                value = note["disclosures"].get(key)
                if value and value not in disclosures[key]:
                    disclosures[key].append(value)
        announced.append(
            {"note": latest, "prs": [note["pr"] for note in group], "disclosures": disclosures}
        )
    position = {number: index for index, number in enumerate(order)}
    announced.sort(key=lambda change: position[change["note"]["pr"]])
    return {
        "schema_version": 1,
        "commit": commit,
        "baseline": baseline,
        "pull_requests": sorted(delta),
        "without_note": sorted(without_note),
        "unmatched_merges": unmatched,
        "unfinished": sorted(unfinished),
        "changes": announced,
    }


def render(record: dict) -> str:
    """Render the first notes text: summary placeholder, notices, then changes by kind."""

    def line(change: dict, text: str, references: bool = True) -> str:
        rendered = f"- {literal(change['note']['task'], leading=True)}: {literal(text)}"
        if references:
            rendered += " (" + ", ".join(f"#{number}" for number in change["prs"]) + ")"
        return rendered

    lines = [SUMMARY, ""]
    notices = [
        line(change, value, references=False)
        for change in record["changes"]
        for key in ACTIONS
        for value in change["disclosures"][key]
    ]
    notices += [
        line(change, change["note"]["result"])
        for change in record["changes"]
        if change["note"]["kind"] == "deprecation/removal"
    ]
    if notices:
        lines += [f"## {NOTICES}", "", *notices, ""]
    for heading, kinds in SECTIONS:
        rows = [change for change in record["changes"] if change["note"]["kind"] in kinds]
        if rows:
            lines += [f"## {heading}", "", *(line(c, c["note"]["result"]) for c in rows), ""]
    return "\n".join(lines)


def write(source: Path, output: Path, env: dict) -> dict:
    github = release_prepare.GitHub(env.get("GITHUB_TOKEN", ""))
    commit = env.get("OHTIA_RELEASE_COMMIT", "")
    record = draft(source, commit, github)
    require(not output.exists(), "Use a fresh notes directory.")
    text = render(record)
    require(
        len(text) <= MAXIMUM_CHARACTERS,
        f"The release notes exceed {MAXIMUM_CHARACTERS} characters; shorten the ohtia-note "
        "blocks of the included pull requests.",
    )
    output.mkdir(parents=True)
    (output / "notes.md").write_text(text, encoding="utf-8")
    report = {key: value for key, value in record.items() if key != "changes"}
    report["announced"] = [change["prs"] for change in record["changes"]]
    (output / "notes.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return record


def summary_lines(record: dict) -> list[str]:
    def numbers(values: list[int]) -> str:
        return ", ".join(f"#{number}" for number in values) or "none"

    baseline = f"`{record['baseline']}`" if record["baseline"] else "none (whole history)"
    return [
        f"Release notes since {baseline}: {len(record['pull_requests'])} pull requests, "
        f"{len(record['changes'])} announced changes.",
        f"Pull requests without a valid `ohtia-note`: {numbers(record['without_note'])}.",
        "Merge commits without a matching merged pull request: "
        + (", ".join(f"`{sha[:12]}`" for sha in record["unmatched_merges"]) or "none")
        + ".",
        f"Unfinished changes not announced: {numbers(record['unfinished'])}.",
    ]


def main(argv: list[str] | None = None, env: dict | None = None) -> int:
    env = dict(os.environ) if env is None else env
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    try:
        record = write(args.source.absolute(), args.output.absolute(), env)
        release_prepare.summary(env, summary_lines(record))
    except (
        release_prepare.ReleaseError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ) as error:
        print(f"Release notes refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
