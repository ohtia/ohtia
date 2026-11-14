"""Select, check, assemble and reserve an unpublished release in the prepare-release workflow.

Every operation runs from the workflow revision, never from the selected source:

- ``select`` admits a dispatch from protected ``main`` and resolves the optional
  ``hash`` input to one commit of the dispatch commit's history;
- ``check`` reads the root version of the selected source and refuses a version that
  is published or reserved by another run, before any build;
- ``assemble`` checks the packages built by every platform job and the RPM packages
  signed by the signing job against the declaration, and writes the digest file and
  the release body, which opens with the first notes text of ``scripts/release_notes.py``;
- ``reserve`` atomically creates the annotated ``reserved/v<version>`` tag on the
  selected commit, after every package is built, signed and assembled;
- ``publish`` creates the unpublished release and uploads its assets without
  replacing any asset already there.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import application_version
import release_platforms

REPOSITORY = "ohtia/ohtia"
API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"
WORKFLOW = ".github/workflows/prepare-release.yml"
SHA = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
FINGERPRINT = re.compile(r"[0-9A-F]{40}")
SIGNING = Path("config/release/signing.json")
SIGNED_RECORD = "signing.json"
MAXIMUM_RESPONSE = 8 * 1024 * 1024
MAXIMUM_ERROR = 4096
MAXIMUM_NOTES = 1024 * 1024
# GitHub refuses a longer release body: "body is too long (maximum is 125000 characters)".
MAXIMUM_BODY_CHARACTERS = 125_000
MAXIMUM_RELEASE_PAGES = 10
DIGESTS = "release-digests.json"
UNSIGNED_HEADING = "## Unsigned testing packages"
UNSIGNED_STATEMENT = (
    "These packages are unsigned. They are for testing only and are not distributed installers."
)
# The selected source must contain the build entry point this workflow runs.
ENTRY_POINTS = ("scripts/release_build.py", "config/release/platforms.json")


class ReleaseError(Exception):
    """The release cannot be prepared; nothing after the failed check runs."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReleaseError(message)


class GitHub:
    """A bounded client for the few REST operations this workflow needs."""

    def __init__(self, token: str, opener=urllib.request.urlopen):
        require(bool(token), "The workflow token is missing.")
        self.token = token
        self.opener = opener

    def request(
        self,
        method: str,
        url: str,
        payload: dict | None = None,
        *,
        data=None,
        headers: dict | None = None,
        allowed: tuple[int, ...] = (200,),
        timeout: int = 60,
    ) -> tuple[int, object]:
        if payload is not None:
            data = json.dumps(payload).encode()
        # The body belongs to the request from its creation: assigning it later, as
        # urlopen(request, data=...) does, drops Content-Length and makes urllib send a
        # file chunked, which the GitHub upload API rejects with "Bad Content-Length".
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Accept", "application/vnd.github+json")
        request.add_header("Authorization", f"Bearer {self.token}")
        request.add_header("X-GitHub-Api-Version", "2026-03-10")
        if payload is not None:
            request.add_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        reason = ""
        try:
            with self.opener(request, timeout=timeout) as response:
                status, body = response.status, response.read(MAXIMUM_RESPONSE + 1)
        except urllib.error.HTTPError as error:
            with error:  # An HTTP error holds the response; release it after reading.
                status, body, reason = error.code, b"", error_reason(error)
        except (OSError, ValueError) as error:
            raise ReleaseError(
                f"GitHub {method} {urlparse_path(url)} could not complete."
            ) from error
        # Never echo response bodies: they may carry data the log should not hold. An error
        # response contributes only GitHub's short, sanitized error message.
        require(
            status in allowed,
            f"GitHub {method} {urlparse_path(url)} returned HTTP {status}{reason}.",
        )
        require(len(body) <= MAXIMUM_RESPONSE, "GitHub returned an oversized response.")
        try:
            return status, json.loads(body) if body.strip() else None
        except ValueError as error:
            raise ReleaseError("GitHub returned invalid JSON.") from error

    def api(self, method: str, path: str, payload: dict | None = None, **kwargs):
        return self.request(method, f"{API}/repos/{REPOSITORY}/{path}", payload, **kwargs)


def error_reason(error: urllib.error.HTTPError) -> str:
    """Return GitHub's error message as a short printable suffix, or nothing."""
    try:
        message = json.loads(error.read(MAXIMUM_ERROR)).get("message")
    except Exception:  # noqa: BLE001 - a suffix of an error message must never raise.
        return ""
    if not isinstance(message, str):
        return ""
    printable = "".join(c for c in message if c.isprintable() and c.isascii())[:200]
    return f" ({printable})" if printable else ""


def urlparse_path(url: str) -> str:
    return urllib.parse.urlsplit(url).path


def environment(env: dict, *names: str) -> list[str]:
    values = [env.get(name, "") for name in names]
    require(all(values), "The workflow environment is incomplete.")
    return values


def output(env: dict, values: dict) -> None:
    with Path(env["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as stream:
        for key, value in values.items():
            stream.write(f"{key}={value}\n")


def select(github: GitHub, env: dict) -> str:
    """Admit a main dispatch and return the selected commit of its history."""
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY, "Prepare releases only in ohtia/ohtia.")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Use the manual dispatch.")
    require(
        env.get("GITHUB_REF") == "refs/heads/main",
        "Dispatch prepare-release from main; other branches and tags are refused.",
    )
    dispatch = env.get("GITHUB_SHA", "")
    require(SHA.fullmatch(dispatch) is not None, "Invalid dispatch commit.")
    selected = env.get("OHTIA_RELEASE_HASH", "") or dispatch
    require(
        SHA.fullmatch(selected) is not None,
        "The hash input must be a full lowercase commit SHA or empty.",
    )
    if selected != dispatch:
        _, compare = github.api("GET", f"compare/{selected}...{dispatch}?per_page=1")
        require(
            isinstance(compare, dict)
            and compare.get("status") == "ahead"
            and compare.get("behind_by") == 0
            and (compare.get("merge_base_commit") or {}).get("sha") == selected,
            "The selected commit is not in the history of the dispatched main commit.",
        )
    return selected


def tag_message(run_id: str, commit: str) -> str:
    return f"Reserved by prepare-release run {run_id} for {commit}."


def check(github: GitHub, env: dict, source: Path) -> dict:
    """Read the root version of the checked-out selected source and admit it before building."""
    commit = environment(env, "OHTIA_RELEASE_COMMIT")[0]
    require(SHA.fullmatch(commit) is not None, "Invalid selected commit.")
    head = (source / ".git").exists() and git_revision(source, "HEAD")
    require(head == commit, "The checked-out source differs from the selected commit.")
    tree = git_revision(source, "HEAD^{tree}")
    for name in ENTRY_POINTS:
        require(
            source.joinpath(name).is_file(),
            "The selected commit predates the release build entry point.",
        )
    require(
        release_platforms.load(source) == release_platforms.load(),
        "The selected commit declares other release platforms than this workflow revision.",
    )
    try:
        version = application_version.root_version(source)
    except application_version.VersionError as error:
        raise ReleaseError(str(error)) from error
    require_unpublished(github, version)
    own_reservation(github, env, version, commit)
    return {"commit": commit, "tree": tree, "version": version}


def own_reservation(github: GitHub, env: dict, version: str, commit: str) -> bool:
    """Return whether this run already reserved the version; refuse another run's reservation.

    Only a rerun of the reserving run, on the same commit, may continue past a reservation.
    """
    run_id, attempt = environment(env, "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")
    tag = f"reserved/v{version}"
    status, ref = github.api("GET", f"git/ref/tags/{urllib.parse.quote(tag)}", allowed=(200, 404))
    if status == 404:
        return False
    target = (ref or {}).get("object") or {}
    require(
        target.get("type") == "tag" and SHA.fullmatch(str(target.get("sha"))) is not None,
        f"The version {version} is already reserved; raise the version in source.",
    )
    _, existing = github.api("GET", f"git/tags/{target['sha']}")
    require(
        int(attempt) > 1
        and isinstance(existing, dict)
        and (existing.get("object") or {}).get("sha") == commit
        and (existing.get("object") or {}).get("type") == "commit"
        and str(existing.get("message", "")).strip() == tag_message(run_id, commit),
        f"The version {version} is already reserved; raise the version in source.",
    )
    return True


def reserve(github: GitHub, env: dict) -> None:
    """Reserve the checked version on the selected commit, after every package is assembled."""
    commit, version, run_id = environment(
        env, "OHTIA_RELEASE_COMMIT", "OHTIA_RELEASE_VERSION", "GITHUB_RUN_ID"
    )
    require(SHA.fullmatch(commit) is not None, "Invalid selected commit.")
    require(VERSION.fullmatch(version) is not None, "Invalid release version.")
    require_unpublished(github, version)
    if own_reservation(github, env, version, commit):
        return
    tag = f"reserved/v{version}"
    message = tag_message(run_id, commit)
    _, created = github.api(
        "POST",
        "git/tags",
        {"tag": tag, "message": message, "object": commit, "type": "commit"},
        allowed=(201,),
    )
    require(
        isinstance(created, dict) and SHA.fullmatch(str(created.get("sha"))) is not None,
        "GitHub returned an invalid tag object.",
    )
    # Creating a reference is atomic: of two concurrent runs, exactly one reserves.
    status, _ = github.api(
        "POST",
        "git/refs",
        {"ref": f"refs/tags/{tag}", "sha": created["sha"]},
        allowed=(201, 422),
    )
    require(status == 201, f"Another run reserved {version} first; raise the version in source.")


def require_unpublished(github: GitHub, version: str) -> None:
    """Refuse a version whose release tag exists: a draft would silently follow that tag."""
    status, _ = github.api(
        "GET", f"git/ref/tags/{urllib.parse.quote(f'v{version}')}", allowed=(200, 404)
    )
    require(status == 404, f"The version tag v{version} already exists; raise the version.")


def git_revision(directory: Path, revision: str) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", revision], cwd=directory, text=True, timeout=60
    ).strip()


def digest(file: Path) -> str:
    hashed = hashlib.sha256()
    with file.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            hashed.update(block)
    return hashed.hexdigest()


def signing_fingerprint(root: Path | None = None) -> str:
    """Return the primary fingerprint recorded for the committed release signing key."""
    try:
        value = json.loads(
            (root or release_platforms.ROOT).joinpath(SIGNING).read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, ValueError) as error:
        raise ReleaseError("The release signing record cannot be read as JSON.") from error
    require(
        isinstance(value, dict)
        and set(value) == {"schema_version", "fingerprint"}
        and value["schema_version"] == 1
        and isinstance(value["fingerprint"], str)
        and FINGERPRINT.fullmatch(value["fingerprint"]) is not None,
        "Unsupported release signing record.",
    )
    return value["fingerprint"]


def signed_by_job(item: dict) -> bool:
    """The signing job signs the RPM packages of a signed platform after they are built."""
    return item["format"] == "rpm" and item["authentication"] == "embedded"


def signed_packages(signed: Path, expected: list[dict], root: Path | None) -> dict[str, dict]:
    """Read the signing job's record of the packages it signed, keyed by asset name."""
    try:
        record = json.loads((signed / SIGNED_RECORD).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise ReleaseError("The signing record cannot be read as JSON.") from error
    require(
        isinstance(record, dict)
        and set(record) == {"schema_version", "fingerprint", "packages"}
        and record["schema_version"] == 1
        and record["fingerprint"] == signing_fingerprint(root)
        and isinstance(record["packages"], list),
        "The signing record does not match the committed signing key.",
    )
    packages = {}
    for package in record["packages"]:
        require(
            isinstance(package, dict)
            and set(package) == {"name", "unsigned_sha256", "bytes", "sha256"}
            and isinstance(package["name"], str)
            and package["name"] not in packages,
            "Duplicate or invalid signed package.",
        )
        packages[package["name"]] = package
    require(
        sorted(packages) == sorted(item["name"] for item in expected if signed_by_job(item)),
        "The signed packages differ from the declared RPM packages.",
    )
    return packages


def assemble(
    env: dict,
    inputs: Path,
    signed: Path,
    notes: Path,
    destination: Path,
    root: Path | None = None,
) -> dict:
    """Check every platform's build and the signed packages, then write the release files.

    ``signed`` holds the signing job's RPM packages and their record; each one must come from
    the build record's bytes. ``notes`` is the ``notes.md`` file of the read-only notes job; it
    opens the release body.
    """
    commit, tree, version, run_id, attempt, workflow_sha = environment(
        env,
        "OHTIA_RELEASE_COMMIT",
        "OHTIA_RELEASE_TREE",
        "OHTIA_RELEASE_VERSION",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "GITHUB_SHA",
    )
    platforms = release_platforms.load(root)
    expected = release_platforms.expected_assets(platforms, version)
    targets = {build["target"] for platform in platforms for build in platform["builds"]}
    records = sorted(inputs.glob("*/build.json"))
    require(
        len(records) == len(targets), "Every declared target requires exactly one build record."
    )
    built = {}
    for record_file in records:
        record = json.loads(record_file.read_text(encoding="utf-8"))
        require(
            record.get("schema_version") == 1
            and record.get("version") == version
            and record.get("source") == {"commit": commit, "tree": tree}
            and record.get("target") in targets,
            "A build record does not match the checked version and source.",
        )
        for asset in record.get("assets", []):
            name = asset.get("name")
            require(
                isinstance(name, str) and name not in built and "/" not in name,
                "Duplicate or invalid asset.",
            )
            file = record_file.parent / name
            require(
                file.is_file()
                and not file.is_symlink()
                and file.stat().st_size == asset.get("bytes")
                and digest(file) == asset.get("sha256"),
                f"The built asset {name} does not match its build record.",
            )
            built[name] = {"record": record, "asset": asset, "file": file}
    require(
        sorted(built) == sorted(item["name"] for item in expected),
        "The built assets differ from the declared release platforms.",
    )
    for name, package in signed_packages(signed, expected, root).items():
        file = signed / name
        require(
            package["unsigned_sha256"] == built[name]["asset"]["sha256"]
            and package["sha256"] != package["unsigned_sha256"]
            and file.is_file()
            and not file.is_symlink()
            and file.stat().st_size == package["bytes"]
            and digest(file) == package["sha256"],
            f"The signed package {name} does not match its build record and signing record.",
        )
        # The release holds the signed bytes; the digest file records their digest.
        built[name]["file"] = file
        built[name]["final"] = {"bytes": package["bytes"], "sha256": package["sha256"]}
    require(
        notes.is_file() and not notes.is_symlink() and notes.stat().st_size <= MAXIMUM_NOTES,
        "The release notes are missing or too large.",
    )
    first_notes = notes.read_text(encoding="utf-8")
    # The body depends only on the declared assets, so its length is checked before writing.
    body = release_body(
        {
            "assets": [
                {"name": item["name"], "authentication": item["authentication"]}
                for item in expected
            ]
        },
        first_notes,
    )
    require(
        len(body) <= MAXIMUM_BODY_CHARACTERS,
        f"The release body exceeds GitHub's {MAXIMUM_BODY_CHARACTERS} characters.",
    )
    require(not destination.exists(), "Use a fresh release directory.")
    (destination / "assets").mkdir(parents=True)
    assets = []
    for item in expected:
        entry = built[item["name"]]
        require(
            entry["record"]["target"] == item["target"]
            and entry["asset"].get("format") == item["format"]
            and entry["asset"].get("profile") == item["profile"],
            "A built asset is attributed to the wrong platform.",
        )
        final = entry.get("final", entry["asset"])
        shutil.copyfile(entry["file"], destination / "assets" / item["name"])
        assets.append(
            {
                "name": item["name"],
                "platform": item["platform"],
                "target": item["target"],
                "profile": item["profile"],
                "format": item["format"],
                "bytes": final["bytes"],
                "sha256": final["sha256"],
                "authentication": item["authentication"],
            }
        )
    record = {
        "schema_version": 1,
        "version": version,
        "source": {"commit": commit, "tree": tree},
        "workflow": {
            "path": WORKFLOW,
            "commit": workflow_sha,
            "run_id": int(run_id),
            "run_attempt": int(attempt),
        },
        "assets": assets,
    }
    (destination / DIGESTS).write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    (destination / "body.md").write_text(body, encoding="utf-8")
    return record


def release_body(record: dict, notes: str) -> str:
    """Open with the first notes text and list unsigned assets under the testing heading."""
    lines = [notes.rstrip("\n"), ""]
    unsigned = [
        asset["name"] for asset in record["assets"] if asset["authentication"] == "unsigned"
    ]
    if unsigned:
        lines += [UNSIGNED_HEADING, "", UNSIGNED_STATEMENT, ""]
        lines += [f"- `{name}`" for name in unsigned]
        lines.append("")
    return "\n".join(lines)


def find_release(github: GitHub, tag: str) -> dict | None:
    """Find the release of a tag, including drafts, which the tag lookup omits."""
    for page in range(1, MAXIMUM_RELEASE_PAGES + 1):
        _, values = github.api("GET", f"releases?per_page=100&page={page}")
        require(isinstance(values, list), "GitHub returned an invalid release list.")
        matching = [item for item in values if item.get("tag_name") == tag]
        require(len(matching) <= 1, "More than one release uses this version.")
        if matching:
            return matching[0]
        if len(values) < 100:
            return None
    raise ReleaseError("The release list exceeds the reviewed bound.")


def uploaded_matches(asset: dict, expected: dict) -> bool:
    digest_value = asset.get("digest")
    return (
        asset.get("name") == expected["name"]
        and asset.get("size") == expected["bytes"]
        and asset.get("state", "uploaded") == "uploaded"
        and (digest_value is None or digest_value == f"sha256:{expected['sha256']}")
    )


def same_text(stored: object, expected: str) -> bool:
    """Compare a stored release body without its line-ending or trailing-space form."""
    return isinstance(stored, str) and stored.replace("\r\n", "\n").rstrip() == expected.rstrip()


def publish(github: GitHub, env: dict, directory: Path) -> dict:
    """Create the unpublished release and upload every asset and then the digest file."""
    record = json.loads((directory / DIGESTS).read_text(encoding="utf-8"))
    body = (directory / "body.md").read_text(encoding="utf-8")
    version, commit = record["version"], record["source"]["commit"]
    require(
        env.get("OHTIA_RELEASE_VERSION") == version and env.get("OHTIA_RELEASE_COMMIT") == commit,
        "The assembled release differs from the reservation.",
    )
    tag = f"v{version}"
    require_unpublished(github, version)
    release = find_release(github, tag)
    if release is None:
        _, release = github.api(
            "POST",
            "releases",
            {
                "tag_name": tag,
                "target_commitish": commit,
                "name": version,
                "body": body,
                "draft": True,
                "prerelease": False,
            },
            allowed=(201,),
        )
    else:
        # Only a rerun of the reserving run reaches this point; it never replaces an asset.
        require(
            release.get("draft") is True and release.get("target_commitish") == commit,
            f"A release for {version} already exists outside this preparation.",
        )
        require(
            not release.get("assets"),
            f"The unpublished release of {version} already holds assets; raise the version.",
        )
        # The empty draft of an earlier attempt takes this attempt's title and body. GitHub
        # detaches a draft from its tag when an update omits tag_name, so the update repeats
        # the tag and its target.
        _, release = github.api(
            "PATCH",
            f"releases/{release['id']}",
            {
                "tag_name": tag,
                "target_commitish": commit,
                "name": version,
                "body": body,
                "draft": True,
            },
        )
    require(isinstance(release, dict) and isinstance(release.get("id"), int), "Bad release.")
    files = [{**asset, "file": directory / "assets" / asset["name"]} for asset in record["assets"]]
    digests = directory / DIGESTS
    files.append(
        {
            "name": DIGESTS,
            "bytes": digests.stat().st_size,
            "sha256": digest(digests),
            "file": digests,
        }
    )
    for item in files:
        url = (
            f"{UPLOADS}/repos/{REPOSITORY}/releases/{release['id']}/assets?"
            + urllib.parse.urlencode({"name": item["name"]})
        )
        with item["file"].open("rb") as stream:
            _, uploaded = github.request(
                "POST",
                url,
                data=stream,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(item["bytes"]),
                },
                allowed=(201,),
                timeout=900,
            )
        require(
            isinstance(uploaded, dict) and uploaded_matches(uploaded, item),
            f"GitHub recorded {item['name']} with a different length or digest.",
        )
    _, final = github.api("GET", f"releases/{release['id']}")
    require(
        isinstance(final, dict)
        and final.get("draft") is True
        and final.get("tag_name") == tag
        and final.get("target_commitish") == commit
        and final.get("name") == version
        and same_text(final.get("body"), body),
        "The release is no longer the unpublished release of this version.",
    )
    actual = {asset.get("name"): asset for asset in final.get("assets", [])}
    require(
        sorted(actual) == sorted(item["name"] for item in files)
        and all(uploaded_matches(actual[item["name"]], item) for item in files),
        "The unpublished release does not hold exactly the assembled assets.",
    )
    return {"id": release["id"], "url": final.get("html_url", "")}


def summary(env: dict, lines: list[str]) -> None:
    file = env.get("GITHUB_STEP_SUMMARY")
    if file:
        with Path(file).open("a", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None, env: dict | None = None) -> int:
    env = dict(os.environ) if env is None else env
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("select")
    commands.add_parser("check").add_argument("source", type=Path)
    command = commands.add_parser("assemble")
    command.add_argument("inputs", type=Path)
    command.add_argument("signed", type=Path)
    command.add_argument("notes", type=Path)
    command.add_argument("destination", type=Path)
    commands.add_parser("reserve")
    commands.add_parser("publish").add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "select":
            output(env, {"commit": select(GitHub(env.get("GITHUB_TOKEN", "")), env)})
        elif args.command == "check":
            checked = check(GitHub(env.get("GITHUB_TOKEN", "")), env, args.source.absolute())
            output(env, checked)
            summary(
                env,
                [
                    f"Preparing `{checked['version']}` from `{checked['commit']}`.",
                    f"Source tree: `{checked['tree']}`.",
                ],
            )
        elif args.command == "assemble":
            assemble(
                env,
                args.inputs.absolute(),
                args.signed.absolute(),
                args.notes.absolute(),
                args.destination.absolute(),
            )
        elif args.command == "reserve":
            reserve(GitHub(env.get("GITHUB_TOKEN", "")), env)
            summary(
                env,
                [
                    f"Reserved `reserved/v{env['OHTIA_RELEASE_VERSION']}` on "
                    f"`{env['OHTIA_RELEASE_COMMIT']}`."
                ],
            )
        else:
            published = publish(GitHub(env.get("GITHUB_TOKEN", "")), env, args.directory)
            summary(env, [f"Unpublished release: {published['url']}"])
    except (
        ReleaseError,
        release_platforms.PlatformError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
    ) as error:
        print(f"Release preparation refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
