"""Check and publish a prepared unpublished release in the publish-release workflow.

Every operation runs from the workflow revision and never builds or signs a package:

- ``check`` admits a dispatch from protected ``main``, finds the unpublished release of the
  version and its ``reserved/v<version>`` tag, downloads every asset and verifies it against
  the release's digest file, checks the testing-only heading at the end of the body, and
  shows the version, commit, asset digests and body digests for the maintainer's approval;
- ``publish``, after that approval, checks the same state again, refuses a body that
  changed since the check, removes every asset recorded as unsigned and the testing-only
  heading, records the SHA-256 of the exact body as ``release-notes.sha256``, makes the
  release public and latest, which creates ``v<version>`` on the reserved commit, and
  verifies the public result.

A retry reconciles the state it finds: it finishes the remaining steps with the same
version and bytes and never replaces an uploaded asset. When a step fails after the release
became public, the error names the public surfaces.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import release_prepare as prepare
from release_prepare import ReleaseError, require

NOTES_DIGEST = "release-notes.sha256"
DIGEST = re.compile(r"[0-9a-f]{64}")
MAXIMUM_DIGEST_FILE = 1024 * 1024
MAXIMUM_ASSET = 2 * 1024 * 1024 * 1024
CHUNK = 1024 * 1024
UNSIGNED_WORD = re.compile(r"(?i)\bunsigned\b")
QUOTES = re.compile(r"^(?:[ \t]*>)*")
CONTAINERS = re.compile(r"^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*")
SETEXT_UNDERLINE = re.compile(r" {0,3}(?:=+|-+)[ \t]*")
HTML_HEADING = re.compile(r"(?is)<h[1-6]\b[^>]*>(?:(?!</h[1-6]).)*\bunsigned\b")
WORKFLOWS = ".github/workflows/"
MAXIMUM_COMPARED_FILES = 300


def admit(env: dict) -> str:
    """Admit a main dispatch and return its version input."""
    require(
        env.get("GITHUB_REPOSITORY") == prepare.REPOSITORY, "Publish releases only in ohtia/ohtia."
    )
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Use the manual dispatch.")
    require(
        env.get("GITHUB_REF") == "refs/heads/main",
        "Dispatch publish-release from main; other branches and tags are refused.",
    )
    version = env.get("OHTIA_RELEASE_VERSION", "")
    require(
        prepare.VERSION.fullmatch(version) is not None,
        "The version input must be a final major.minor.patch version without leading zeroes.",
    )
    return version


def reserved_commit(github: prepare.GitHub, version: str) -> str:
    """Return the commit that the annotated reserved/v<version> tag names."""
    tag = f"reserved/v{version}"
    status, ref = github.api("GET", f"git/ref/tags/{urllib.parse.quote(tag)}", allowed=(200, 404))
    require(status == 200, f"The version {version} has no {tag} tag; prepare it first.")
    target = (ref or {}).get("object") or {}
    require(
        target.get("type") == "tag" and prepare.SHA.fullmatch(str(target.get("sha"))) is not None,
        f"The {tag} reference is not an annotated reservation tag.",
    )
    _, existing = github.api("GET", f"git/tags/{target['sha']}")
    named = (existing or {}).get("object") or {}
    require(
        isinstance(existing, dict)
        and named.get("type") == "commit"
        and prepare.SHA.fullmatch(str(named.get("sha"))) is not None,
        f"The {tag} tag does not name a commit.",
    )
    return named["sha"]


def find_release(github: prepare.GitHub, version: str) -> dict:
    release = prepare.find_release(github, f"v{version}")
    require(release is not None, f"No unpublished release of {version} exists; prepare it first.")
    require(isinstance(release.get("id"), int), "GitHub returned an invalid release.")
    _, current = github.api("GET", f"releases/{release['id']}")
    require(isinstance(current, dict), "GitHub returned an invalid release.")
    return current


def require_release_identity(release: dict, version: str, commit: str) -> None:
    require(
        release.get("tag_name") == f"v{version}" and release.get("name") == version,
        f"The release of {version} no longer has its prepared tag or title.",
    )
    require(
        release.get("target_commitish") == commit,
        f"The release of {version} targets another commit than reserved/v{version}.",
    )
    require(release.get("prerelease") is False, f"The release of {version} is a prerelease.")


def assets_by_name(release: dict) -> dict[str, dict]:
    assets = release.get("assets")
    require(isinstance(assets, list), "GitHub returned an invalid asset list.")
    named = {asset.get("name"): asset for asset in assets if isinstance(asset, dict)}
    require(len(named) == len(assets), "The release holds an invalid or repeated asset.")
    return named


def download(github: prepare.GitHub, asset: dict, destination: Path, limit: int) -> tuple[int, str]:
    """Stream one release asset to a file and return its length and SHA-256."""
    require(isinstance(asset.get("id"), int), "GitHub returned an invalid asset.")
    url = f"{prepare.API}/repos/{prepare.REPOSITORY}/releases/assets/{asset['id']}"
    request = urllib.request.Request(url, method="GET")
    request.add_header("Accept", "application/octet-stream")
    request.add_header("X-GitHub-Api-Version", "2026-03-10")
    # GitHub answers with a redirect to signed storage; the token must not follow it there.
    request.add_unredirected_header("Authorization", f"Bearer {github.token}")
    hashed, length = hashlib.sha256(), 0
    try:
        with github.opener(request, timeout=900) as response, destination.open("wb") as stream:
            require(response.status == 200, f"GitHub returned HTTP {response.status} for an asset.")
            while block := response.read(CHUNK):
                length += len(block)
                require(
                    length <= limit, f"The asset {asset.get('name')} exceeds its recorded length."
                )
                hashed.update(block)
                stream.write(block)
    except urllib.error.HTTPError as error:
        with error:
            raise ReleaseError(
                f"GitHub returned HTTP {error.code} for {asset.get('name')}."
            ) from error
    except (OSError, ValueError) as error:
        raise ReleaseError(f"The asset {asset.get('name')} could not be downloaded.") from error
    return length, hashed.hexdigest()


def digest_record(
    github: prepare.GitHub, assets: dict, version: str, commit: str, scratch: Path
) -> tuple[dict, dict]:
    """Download and validate the digest file; return the record and its asset facts."""
    asset = assets.get(prepare.DIGESTS)
    require(asset is not None, f"The release has no {prepare.DIGESTS}.")
    path = scratch / prepare.DIGESTS
    length, sha256 = download(github, asset, path, MAXIMUM_DIGEST_FILE)
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as error:
        raise ReleaseError(f"The {prepare.DIGESTS} asset is not valid JSON.") from error
    require(
        isinstance(record, dict)
        and record.get("schema_version") == 1
        and record.get("version") == version
        and (record.get("source") or {}).get("commit") == commit,
        f"The {prepare.DIGESTS} asset does not describe {version} at the reserved commit.",
    )
    entries = record.get("assets")
    require(isinstance(entries, list) and entries, f"The {prepare.DIGESTS} asset lists no package.")
    names = set()
    for entry in entries:
        require(
            isinstance(entry, dict)
            and isinstance(entry.get("name"), str)
            and entry["name"] not in (prepare.DIGESTS, NOTES_DIGEST)
            and isinstance(entry.get("bytes"), int)
            and 0 < entry["bytes"] <= MAXIMUM_ASSET
            and DIGEST.fullmatch(str(entry.get("sha256"))) is not None
            and entry.get("authentication") in ("embedded", "repository", "unsigned"),
            f"The {prepare.DIGESTS} asset holds an invalid entry.",
        )
        names.add(entry["name"])
    require(len(names) == len(entries), f"The {prepare.DIGESTS} asset repeats a package.")
    return record, {"name": prepare.DIGESTS, "bytes": length, "sha256": sha256}


def unsigned_heading(text: str) -> bool:
    """Return whether the text holds a heading containing the word "unsigned".

    It recognizes ATX headings of any level and setext headings, also inside blockquotes
    and list items, and HTML heading elements.
    """
    if HTML_HEADING.search(text):
        return True
    paragraph: list[str] = []
    # CommonMark ends a line at CRLF, LF or a lone CR.
    for raw in re.split(r"\r\n|\r|\n", text):
        # An underline is recognized before list markers, as a lone "-" may underline a heading.
        quoted = QUOTES.sub("", raw).lstrip(" \t") if paragraph else ""
        if (
            paragraph
            and SETEXT_UNDERLINE.fullmatch(quoted)
            and any(UNSIGNED_WORD.search(item) for item in paragraph)
        ):
            return True
        line = CONTAINERS.sub("", raw)
        if not line.strip():
            # An empty list item cannot interrupt a paragraph: its marker stays paragraph text.
            if paragraph and quoted.strip():
                paragraph.append(quoted)
            else:
                paragraph = []
            continue
        if re.match(r"#{1,6}(?:[ \t]|$)", line) and UNSIGNED_WORD.search(line):
            return True
        paragraph.append(line)
    return False


def unsigned_section(record: dict) -> str:
    """Return the testing-only heading block exactly as preparation wrote it."""
    names = [entry["name"] for entry in record["assets"] if entry["authentication"] == "unsigned"]
    if not names:
        return ""
    lines = [prepare.UNSIGNED_HEADING, "", prepare.UNSIGNED_STATEMENT, ""]
    return "\n".join(lines + [f"- `{name}`" for name in names])


def final_body(body: object, record: dict) -> str:
    """Return the body without the testing-only heading block, keeping every other byte.

    The block must close the body as preparation wrote it, apart from line endings and
    trailing line breaks; a changed block, or a remnant of it elsewhere, is refused. A body
    whose block was already removed by an earlier attempt is returned unchanged.
    """
    require(isinstance(body, str) and body.strip(), "The release body is empty.")
    expected = unsigned_section(record)
    heading = re.compile(rf"(?m)^{re.escape(prepare.UNSIGNED_HEADING)}\r?$")
    found = list(heading.finditer(body))

    # A remnant of the block must never survive into a public body: a heading containing the
    # word "unsigned", the statement or an unsigned package name outside the exact block.
    names = [entry["name"] for entry in record["assets"] if entry["authentication"] == "unsigned"]

    def remnant(text: str) -> str:
        if unsigned_heading(text):
            return 'a heading containing the word "unsigned"'
        if prepare.UNSIGNED_STATEMENT in text:
            return "the testing-only statement"
        named = [name for name in names if name in text]
        return f"the unsigned package name {named[0]}" if named else ""

    if not found:
        trace = remnant(body)
        require(
            not trace,
            f"The release body holds {trace} outside the prepared testing-only heading block; "
            "restore the block as prepared or remove the remnant.",
        )
        return body
    start = found[0].start()
    require(len(found) == 1, "The release body holds the testing-only heading more than once.")
    require(
        bool(expected),
        "The release body holds the testing-only heading, but the digest file records no unsigned package.",
    )
    trace = remnant(body[:start])
    require(not trace, f"The release body holds {trace} before the testing-only heading block.")
    # Trailing blank lines, whitespace-only ones included, are not part of the block.
    block = re.sub(r"(?:\n[ \t]*)+\Z", "", body[start:].replace("\r\n", "\n"))
    require(
        block == expected,
        "The testing-only heading block differs from the prepared one or is not at the end of the body.",
    )
    # Only the blank lines that separate the block go, whitespace-only ones included; trailing
    # spaces of the last notes line stay.
    remaining = re.sub(r"(?:\r?\n[ \t]*)+\Z", "", body[:start])
    require(remaining, "The release body holds only the testing-only heading block.")
    return remaining


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def notes_digest_content(final: str) -> bytes:
    return f"{sha256_text(final)}\n".encode("ascii")


def inspect(github: prepare.GitHub, version: str, scratch: Path) -> dict:
    """Read and verify the prepared state; return every fact the later steps compare."""
    commit = reserved_commit(github, version)
    release = find_release(github, version)
    require_release_identity(release, version, commit)
    if release.get("draft") is True:
        require_tag_free(github, version)
        require_workflows_unchanged(github, commit)
    assets = assets_by_name(release)
    record, digests = digest_record(github, assets, version, commit, scratch)
    expected = {entry["name"]: entry for entry in record["assets"]}
    signed = {name for name, entry in expected.items() if entry["authentication"] != "unsigned"}
    allowed = set(expected) | {prepare.DIGESTS, NOTES_DIGEST}
    extra = sorted(set(assets) - allowed)
    require(not extra, f"The release holds assets outside its digest file: {', '.join(extra)}.")
    missing = sorted(signed - set(assets))
    require(not missing, f"The release lacks signed packages: {', '.join(missing)}.")
    for name in sorted(set(assets) & set(expected)):
        entry, asset = expected[name], assets[name]
        require(
            asset.get("size") == entry["bytes"] and asset.get("state", "uploaded") == "uploaded",
            f"The asset {name} differs from the digest file.",
        )
        length, sha256 = download(github, asset, scratch / "asset", entry["bytes"])
        require(
            length == entry["bytes"] and sha256 == entry["sha256"],
            f"The asset {name} differs from the digest file.",
        )
    body = release.get("body")
    final = final_body(body, record)
    unsigned_left = sorted(
        name
        for name, entry in expected.items()
        if entry["authentication"] == "unsigned" and name in assets
    )
    require(
        final != body or not unsigned_left,
        "The release body lacks the testing-only heading although unsigned packages remain.",
    )
    notes = assets.get(NOTES_DIGEST)
    notes_recorded = False
    if notes is not None and notes.get("state", "uploaded") == "uploaded":
        content = notes_digest_content(final)
        if notes.get("size") == len(content):
            length, sha256 = download(github, notes, scratch / NOTES_DIGEST, len(content))
            notes_recorded = sha256 == hashlib.sha256(content).hexdigest()
    # A notes digest of an unpublished release that is incomplete or records another body is
    # replaced by publication; a public release must already hold the right one.
    require(
        notes_recorded or release.get("draft") is True,
        f"The public release's {NOTES_DIGEST} does not record its body.",
    )
    return {
        "version": version,
        "commit": commit,
        "release": release,
        "record": record,
        "digests": digests,
        "body": body,
        "body_sha256": sha256_text(body),
        "final": final,
        "final_sha256": sha256_text(final),
        "notes_recorded": notes_recorded,
    }


def require_tag_free(github: prepare.GitHub, version: str) -> None:
    """Refuse an existing v<version>: GitHub would publish the release on that tag's commit."""
    status, _ = github.api(
        "GET", f"git/ref/tags/{urllib.parse.quote(f'v{version}')}", allowed=(200, 404)
    )
    require(status == 404, f"The tag v{version} already exists; it is never moved or replaced.")


def require_workflows_unchanged(github: prepare.GitHub, commit: str) -> None:
    """Refuse a reserved commit whose workflow files differ from main.

    GitHub requires workflow-write authorization, which the workflow token cannot hold, to
    publish a release whose target commit adds or modifies a workflow file relative to the
    default branch. A workflow file that only main holds is not such a change.
    """
    _, ref = github.api("GET", "git/ref/heads/main")
    head = ((ref or {}).get("object") or {}).get("sha")
    require(
        prepare.SHA.fullmatch(str(head)) is not None, "GitHub returned an invalid main reference."
    )
    if head == commit:
        return
    # One commit per page keeps the response small; the file list is complete either way.
    _, compared = github.api("GET", f"compare/{commit}...{head}?per_page=1")
    files = (compared or {}).get("files")
    require(
        isinstance(compared, dict)
        and compared.get("status") == "ahead"
        and compared.get("behind_by") == 0
        and isinstance(files, list),
        "The reserved commit is not in the history of main.",
    )
    require(
        len(files) < MAXIMUM_COMPARED_FILES,
        "The reserved commit differs from main in too many files to check its workflow files.",
    )
    changed = sorted(
        item.get("filename", "")
        for item in files
        if isinstance(item, dict)
        and any(
            str(name).startswith(WORKFLOWS)
            for name in (item.get("filename"), item.get("previous_filename"))
        )
        and item.get("status") != "added"
    )
    require(
        not changed,
        "The reserved commit's workflow files differ from main, so GitHub refuses the workflow "
        f"token to publish it: {', '.join(changed)}.",
    )


def require_public_state(github: prepare.GitHub, state: dict) -> dict:
    """Verify the public release, its tag and its assets after publication."""
    version, commit = state["version"], state["commit"]
    _, release = github.api("GET", f"releases/{state['release']['id']}")
    require(
        isinstance(release, dict) and release.get("draft") is False, "The release is not public."
    )
    require_release_identity(release, version, commit)
    require(
        release.get("body") == state["final"],
        "The public release body differs from the approved one.",
    )
    assets = assets_by_name(release)
    expected = {
        entry["name"]: entry
        for entry in state["record"]["assets"]
        if entry["authentication"] != "unsigned"
    }
    content = notes_digest_content(state["final"])
    expected[prepare.DIGESTS] = state["digests"]
    expected[NOTES_DIGEST] = {
        "name": NOTES_DIGEST,
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    require(
        sorted(assets) == sorted(expected)
        and all(prepare.uploaded_matches(assets[name], expected[name]) for name in expected),
        "The public release does not hold exactly the signed packages, the digest file and the notes digest.",
    )
    status, ref = github.api(
        "GET", f"git/ref/tags/{urllib.parse.quote(f'v{version}')}", allowed=(200, 404)
    )
    require(status == 200, f"The release is public but the tag v{version} does not exist.")
    target = (ref or {}).get("object") or {}
    if target.get("type") == "tag":
        _, annotated = github.api("GET", f"git/tags/{target.get('sha')}")
        target = (annotated or {}).get("object") or {}
    require(
        target.get("type") == "commit" and target.get("sha") == commit,
        f"The tag v{version} does not name the reserved commit {commit}.",
    )
    return release


def check(github: prepare.GitHub, env: dict, scratch: Path) -> dict:
    version = admit(env)
    state = inspect(github, version, scratch)
    if state["release"].get("draft") is not True:
        # Only a retry of a run that already made the release public may continue, to verify it.
        require(
            int(env.get("GITHUB_RUN_ATTEMPT", "1")) > 1,
            f"The release {version} is already public.",
        )
        state["public"] = require_public_state(github, state)
    return state


def approval_summary(state: dict) -> list[str]:
    lines = [
        f"## Publish {state['version']}",
        "",
        f"- Version: `{state['version']}`",
        f"- Reserved commit: `{state['commit']}`",
        f"- Release: {state['release'].get('html_url', '')}",
        f"- Release body SHA-256: `{state['body_sha256']}`",
        f"- Published body SHA-256, recorded as `{NOTES_DIGEST}`: `{state['final_sha256']}`",
        "",
        "| Asset | Authentication | Bytes | SHA-256 |",
        "| ----- | -------------- | ----- | ------- |",
    ]
    for entry in state["record"]["assets"]:
        action = " (removed)" if entry["authentication"] == "unsigned" else ""
        lines.append(
            f"| `{entry['name']}`{action} | {entry['authentication']} | {entry['bytes']} | `{entry['sha256']}` |"
        )
    digests = state["digests"]
    lines.append(f"| `{digests['name']}` | | {digests['bytes']} | `{digests['sha256']}` |")
    if state["release"].get("draft") is not True:
        lines += ["", "The release is already public; this retry only verified it."]
    return lines


def publish(github: prepare.GitHub, env: dict, scratch: Path) -> dict:
    version = admit(env)
    approved = {
        name: env.get(variable, "")
        for name, variable in (
            ("body", "OHTIA_RELEASE_BODY_SHA256"),
            ("final", "OHTIA_RELEASE_FINAL_SHA256"),
            ("digests", "OHTIA_RELEASE_DIGESTS_SHA256"),
        )
    }
    require(
        all(DIGEST.fullmatch(value) is not None for value in approved.values()),
        "The approved digests are missing.",
    )
    state = inspect(github, version, scratch)
    require(
        state["commit"] == env.get("OHTIA_RELEASE_COMMIT")
        and state["release"]["id"] == int(env.get("OHTIA_RELEASE_ID", "0"))
        and state["digests"]["sha256"] == approved["digests"],
        "The release, its reservation or its digest file changed after the approval.",
    )
    require(
        state["body_sha256"] in (approved["body"], approved["final"])
        and state["final_sha256"] == approved["final"],
        "The release body changed after the approval; run the workflow again to approve it.",
    )
    release = state["release"]
    state["published"] = release.get("draft") is True
    if state["published"]:
        identity = {"tag_name": f"v{version}", "target_commitish": state["commit"], "name": version}
        # An update that changes nothing comes first: it shows that GitHub lets this token
        # update the release before any asset or text is removed. GitHub detaches a draft
        # from its tag when an update omits tag_name, so every update repeats the identity.
        _, probed = github.api("PATCH", f"releases/{release['id']}", {**identity, "draft": True})
        require(
            isinstance(probed, dict) and probed.get("draft") is True,
            "GitHub did not keep the release unpublished.",
        )
        assets = assets_by_name(release)
        for entry in state["record"]["assets"]:
            asset = assets.get(entry["name"])
            if entry["authentication"] == "unsigned" and asset is not None:
                github.api("DELETE", f"releases/assets/{asset['id']}", allowed=(204,))
        if state["body"] != state["final"]:
            _, updated = github.api(
                "PATCH",
                f"releases/{release['id']}",
                {**identity, "body": state["final"], "draft": True},
            )
            require(
                isinstance(updated, dict) and updated.get("body") == state["final"],
                "GitHub stored another release body than the approved one.",
            )
        if not state["notes_recorded"]:
            stale = assets.get(NOTES_DIGEST)
            if stale is not None:
                github.api("DELETE", f"releases/assets/{stale['id']}", allowed=(204,))
            upload_notes_digest(github, release["id"], state["final"])
        try:
            _, published = github.api(
                "PATCH",
                f"releases/{release['id']}",
                {**identity, "draft": False, "make_latest": "true"},
            )
            require(isinstance(published, dict), "GitHub returned an invalid release.")
        except ReleaseError as error:
            raise ReleaseError(f"{error} {public_surfaces(github, version)}") from error
    try:
        state["public"] = require_public_state(github, state)
    except ReleaseError as error:
        raise ReleaseError(f"{error} {public_surfaces(github, version)}") from error
    return state


def upload_notes_digest(github: prepare.GitHub, release_id: int, final: str) -> None:
    content = notes_digest_content(final)
    url = (
        f"{prepare.UPLOADS}/repos/{prepare.REPOSITORY}/releases/{release_id}/assets?"
        + urllib.parse.urlencode({"name": NOTES_DIGEST})
    )
    _, uploaded = github.request(
        "POST",
        url,
        data=content,
        headers={"Content-Type": "text/plain", "Content-Length": str(len(content))},
        allowed=(201,),
    )
    expected = {
        "name": NOTES_DIGEST,
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    require(
        isinstance(uploaded, dict) and prepare.uploaded_matches(uploaded, expected),
        f"GitHub recorded {NOTES_DIGEST} with a different length or digest.",
    )


def public_surfaces(github: prepare.GitHub, version: str) -> str:
    """Name the surfaces that are public after a failure, for the maintainer's recovery."""
    surfaces = []
    try:
        release = prepare.find_release(github, f"v{version}")
        if release is not None and release.get("draft") is False:
            surfaces.append(f"the release {version}")
        status, _ = github.api(
            "GET", f"git/ref/tags/{urllib.parse.quote(f'v{version}')}", allowed=(200, 404)
        )
        if status == 200:
            surfaces.append(f"the tag v{version}")
    except ReleaseError:
        return "The public surfaces could not be read."
    if not surfaces:
        return "Nothing is public."
    return "Public now: " + " and ".join(surfaces) + "."


def main(argv: list[str] | None = None, env: dict | None = None) -> int:
    env = dict(os.environ) if env is None else env
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check")
    commands.add_parser("publish")
    args = parser.parse_args(argv)
    try:
        github = prepare.GitHub(env.get("GITHUB_TOKEN", ""))
        with tempfile.TemporaryDirectory(prefix="publish-release-") as directory:
            scratch = Path(directory)
            if args.command == "check":
                state = check(github, env, scratch)
                prepare.output(
                    env,
                    {
                        "commit": state["commit"],
                        "release": str(state["release"]["id"]),
                        "body": state["body_sha256"],
                        "final": state["final_sha256"],
                        "digests": state["digests"]["sha256"],
                    },
                )
                prepare.summary(env, approval_summary(state))
            else:
                state = publish(github, env, scratch)
                action = "Published" if state["published"] else "Verified the published release"
                prepare.summary(
                    env,
                    [
                        f"{action} {state['version']}: {state['public'].get('html_url', '')}",
                        f"Tag `v{state['version']}` names `{state['commit']}`; "
                        f"`{NOTES_DIGEST}` records `{state['final_sha256']}`.",
                    ],
                )
    except (ReleaseError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"Release publication refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
