"""Plan, apply, and verify the declared policy of the Ohtia GitHub repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
REPO = "repos/{owner}/{repo}"
EXPECTED_REPOSITORY = "ohtia/ohtia"
EXPECTED_DEFAULT_BRANCH = "main"


class PolicyError(Exception):
    """A read, validation, or write failed; conformity was not established."""


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise PolicyError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_config(directory: Path) -> dict:
    result = {}
    for name in (
        "repository",
        "actions-permissions",
        "security",
        "labels",
        "ruleset-main",
    ):
        result[name] = json.loads(
            (directory / f"{name}.json").read_text(encoding="utf-8"),
            object_pairs_hook=unique_object,
        )
    labels = result["labels"]
    if not isinstance(labels, list) or not labels:
        raise PolicyError("The label catalog must be a nonempty list")
    names = set()
    for label in labels:
        if set(label) != {"name", "color", "description"}:
            raise PolicyError("Each label requires name, color, and description")
        if not isinstance(label["name"], str) or not label["name"]:
            raise PolicyError("Label names must be nonempty strings")
        if label["name"].casefold() in names:
            raise PolicyError("Duplicate managed label name")
        names.add(label["name"].casefold())
        if not isinstance(label["color"], str) or not re.fullmatch(
            r"[0-9a-fA-F]{6}", label["color"]
        ):
            raise PolicyError("Label colors must contain six hexadecimal digits")
        if not isinstance(label["description"], str) or len(label["description"]) > 100:
            raise PolicyError("Label descriptions must be strings of at most 100 characters")
    if result["security"] != {
        "vulnerability_alerts": True,
        "automated_security_fixes": True,
    }:
        raise PolicyError("Dependency security controls must remain enabled")
    return result


def project(actual: object, expected: object) -> object:
    """Compare declared fields, while rejecting missing fields and preserving list membership."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or not expected.keys() <= actual.keys():
            raise PolicyError("GitHub response is missing declared fields; check permissions")
        return {
            key: (
                None
                if key in {"integration_id", "description"} and actual[key] is None
                else project(actual[key], value)
            )
            for key, value in expected.items()
        }
    if isinstance(expected, list):
        if not isinstance(actual, list):
            raise PolicyError("GitHub response contains an invalid list")
        if expected and isinstance(expected[0], dict):
            # Rules are keyed by type, and required checks by context.
            key = "type" if "type" in expected[0] else "context"
            wanted = {item[key]: item for item in expected}
            if any(not isinstance(item, dict) or key not in item for item in actual):
                raise PolicyError("GitHub response contains an invalid policy item")
            values = [
                project(item, wanted[item[key]]) if item[key] in wanted else item for item in actual
            ]
            return sorted(values, key=canonical)
        return sorted(actual, key=canonical)
    if type(actual) is not type(expected):
        raise PolicyError("GitHub response contains a missing or invalid policy value")
    return actual


def normalized(value: object) -> object:
    if isinstance(value, dict):
        result = {key: normalized(item) for key, item in value.items()}
        if "color" in result:
            result["color"] = result["color"].lower()
        return result
    if isinstance(value, list):
        return sorted((normalized(item) for item in value), key=canonical)
    return value


class GitHub:
    def request(
        self,
        endpoint: str,
        method: str = "GET",
        payload: dict | None = None,
        allowed: tuple[int, ...] = (200,),
    ) -> tuple[int, object]:
        command = [
            "gh",
            "api",
            "--hostname",
            "github.com",
            "--include",
            "--method",
            method,
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "X-GitHub-Api-Version: 2026-03-10",
            endpoint,
        ]
        with tempfile.TemporaryDirectory(prefix="ohtia-github-policy-") as scratch:
            if payload is not None:
                path = Path(scratch) / "payload.json"
                path.write_text(canonical(payload), encoding="utf-8")
                command.extend(["--input", str(path)])
            try:
                result = subprocess.run(
                    command,
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                raise PolicyError(f"GitHub {method} {endpoint} could not complete") from error
        output = result.stdout.replace("\r\n", "\n")
        headers, separator, body = output.partition("\n\n")
        match = re.match(r"HTTP/\S+ (\d{3})\b", headers)
        if not separator or not match:
            raise PolicyError(f"GitHub {method} {endpoint} did not return an HTTP response")
        status = int(match[1])
        if status not in allowed or (result.returncode and status < 400):
            # Never echo arbitrary CLI diagnostics, authentication headers, or response bodies.
            raise PolicyError(f"GitHub {method} {endpoint} returned HTTP {status}")
        try:
            return status, json.loads(body) if body.strip() else None
        except json.JSONDecodeError as error:
            raise PolicyError(f"GitHub {method} {endpoint} returned invalid JSON") from error

    def get(self, endpoint: str) -> object:
        return self.request(endpoint)[1]

    def listing(self, endpoint: str) -> list:
        result = []
        separator = "&" if "?" in endpoint else "?"
        for page in range(1, 101):
            values = self.get(f"{endpoint}{separator}per_page=100&page={page}")
            if not isinstance(values, list):
                raise PolicyError(f"Expected a list from {endpoint}")
            result.extend(values)
            if len(values) < 100:
                return result
        raise PolicyError(f"Pagination exceeded the limit for {endpoint}")


def operation(
    resource: str,
    endpoint: str,
    expected: dict,
    actual: object,
    method: str = "PUT",
    read_endpoint: str | None = None,
) -> dict | None:
    before = project(actual, expected) if actual is not None else None
    if normalized(before) == normalized(expected):
        return None
    return {
        "resource": resource,
        "method": method,
        "endpoint": endpoint,
        "read_endpoint": read_endpoint or endpoint,
        "before": before,
        "after": expected,
    }


def security_value(github: GitHub, name: str) -> dict:
    endpoint = f"{REPO}/{name.replace('_', '-')}"
    if name == "vulnerability_alerts":
        status, _ = github.request(endpoint, allowed=(204, 404))
        return {"enabled": status == 204}
    value = github.get(endpoint)
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("enabled"), bool)
        or not isinstance(value.get("paused"), bool)
    ):
        raise PolicyError("Cannot read automated security fixes")
    return {"enabled": value["enabled"] and value.get("paused") is False}


def plan(github: GitHub, config: dict, stage: str) -> dict:
    repository = github.get(REPO)
    if (
        repository.get("full_name") != EXPECTED_REPOSITORY
        or repository.get("visibility") != "public"
    ):
        raise PolicyError("Run from the public ohtia/ohtia repository")
    if repository.get("default_branch") != EXPECTED_DEFAULT_BRANCH:
        raise PolicyError(
            "The default branch must be main; resolve branch drift before applying policy"
        )
    changes = []

    def add(*args: object, **kwargs: object) -> None:
        change = operation(*args, **kwargs)
        if change:
            changes.append(change)

    if stage == "base":
        add("repository", REPO, config["repository"], repository, method="PATCH")
        actions = config["actions-permissions"]
        permissions = github.get(f"{REPO}/actions/permissions")
        add(
            "actions.permissions",
            f"{REPO}/actions/permissions",
            actions["permissions"],
            permissions,
        )
        selected = (
            github.get(f"{REPO}/actions/permissions/selected-actions")
            if permissions.get("allowed_actions") == "selected"
            else None
        )
        add(
            "actions.selected_actions",
            f"{REPO}/actions/permissions/selected-actions",
            actions["selected_actions"],
            selected,
        )
        add(
            "actions.workflow",
            f"{REPO}/actions/permissions/workflow",
            actions["workflow"],
            github.get(f"{REPO}/actions/permissions/workflow"),
        )
        for name in config["security"]:
            add(
                f"security.{name}",
                f"{REPO}/{name.replace('_', '-')}",
                {"enabled": True},
                security_value(github, name),
            )
        labels = github.listing(f"{REPO}/labels")
        by_name = {label["name"].casefold(): label for label in labels}
        for label in config["labels"]:
            existing = by_name.get(label["name"].casefold())
            target = f"{REPO}/labels/{quote(label['name'], safe='')}"
            write_target = (
                f"{REPO}/labels/{quote(existing['name'], safe='')}"
                if existing
                else f"{REPO}/labels"
            )
            add(
                f"label.{label['name']}",
                write_target,
                label,
                existing,
                method="PATCH" if existing else "POST",
                read_endpoint=target,
            )
        extras = sorted(
            label["name"]
            for label in labels
            if label["name"].casefold() not in {x["name"].casefold() for x in config["labels"]}
        )
    else:
        desired = config["ruleset-main"]
        app = github.get("apps/github-actions")
        checks = next(
            rule["parameters"]["required_status_checks"]
            for rule in desired["rules"]
            if rule["type"] == "required_status_checks"
        )
        if app.get("slug") != "github-actions" or any(
            check["integration_id"] != app.get("id") for check in checks
        ):
            raise PolicyError("Required checks must identify the live GitHub Actions app")
        rulesets = github.listing(f"{REPO}/rulesets?includes_parents=true")
        matching = [item for item in rulesets if item["name"] == desired["name"]]
        if len(matching) > 1 or any(
            item.get("source") != EXPECTED_REPOSITORY or item.get("source_type") != "Repository"
            for item in matching
        ):
            raise PolicyError("Conflicting rulesets named main; no ruleset will be replaced")
        existing = github.get(f"{REPO}/rulesets/{matching[0]['id']}") if matching else None
        effective = github.listing(
            f"{REPO}/rules/branches/{quote(repository['default_branch'], safe='')}"
        )
        own_id = matching[0]["id"] if matching else None
        if any(rule.get("ruleset_id") != own_id for rule in effective):
            raise PolicyError("Another active ruleset affects main; resolve the conflict first")
        status, _ = github.request(
            f"{REPO}/branches/{quote(repository['default_branch'], safe='')}/protection",
            allowed=(200, 404),
        )
        if status == 200:
            raise PolicyError("Classic branch protection affects main; resolve the conflict first")
        endpoint = f"{REPO}/rulesets/{own_id}" if existing else f"{REPO}/rulesets"
        add(
            "ruleset.main",
            endpoint,
            desired,
            existing,
            method="PUT" if existing else "POST",
        )
        extras = []
        # A matching definition with no effective rules is not enforcement.
        if not changes:
            expected = normalized(desired["rules"])
            if normalized(project(effective, desired["rules"])) != expected:
                raise PolicyError("Effective main rules differ from the declared ruleset")
    return {
        "repository": {
            "id": repository["id"],
            "full_name": repository["full_name"],
            "default_branch": repository["default_branch"],
        },
        "stage": stage,
        "changes": changes,
        "unmanaged_labels": extras,
    }


def digest(value: dict) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def apply(github: GitHub, config: dict, stage: str, confirmation: str) -> None:
    candidate = plan(github, config, stage)
    if digest(candidate) != confirmation:
        raise PolicyError(
            "The plan changed or its confirmation hash is incorrect; no writes performed"
        )
    if stage == "ruleset" and candidate["changes"]:
        workflow = github.get(f"{REPO}/actions/workflows/ci.yml")
        if workflow.get("path") != ".github/workflows/ci.yml" or workflow.get("state") != "active":
            raise PolicyError(
                "Publish and verify the active CI workflow before requiring its check"
            )
    for change in candidate["changes"]:
        resource = change["resource"]
        payload = change["after"]
        if resource.startswith("security."):
            payload = None
        elif resource.startswith("label.") and change["method"] == "PATCH":
            payload = {
                "new_name": payload["name"],
                "color": payload["color"],
                "description": payload["description"],
            }
        _, response = github.request(
            change["endpoint"],
            method=change["method"],
            payload=payload,
            allowed=(200, 201, 204),
        )
        if resource.startswith("security."):
            actual = security_value(github, resource.split(".", 1)[1])
        else:
            endpoint = change["read_endpoint"]
            if resource == "ruleset.main" and change["method"] == "POST":
                endpoint = f"{REPO}/rulesets/{response['id']}"
            actual = github.get(endpoint)
        if normalized(project(actual, change["after"])) != normalized(change["after"]):
            raise PolicyError(
                f"Readback differs after updating {resource}; earlier writes may have succeeded"
            )
        print(f"Verified {resource}")
    if plan(github, config, stage)["changes"]:
        raise PolicyError("The final read still differs; earlier writes may have succeeded")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "apply", "verify"))
    parser.add_argument("--stage", choices=("base", "ruleset", "all"), default="all")
    parser.add_argument("--confirm", help="SHA-256 printed by plan; required for apply")
    args = parser.parse_args(argv)
    if args.command == "apply" and (args.stage == "all" or not args.confirm):
        parser.error("apply requires --stage base|ruleset and --confirm <sha256>")
    try:
        config = load_config(ROOT / "config/github")
        github = GitHub()
        if args.command == "apply":
            apply(github, config, args.stage, args.confirm)
            return 0
        stages = ("base", "ruleset") if args.stage == "all" else (args.stage,)
        different = False
        for stage in stages:
            candidate = plan(github, config, stage)
            if args.command == "plan":
                print(json.dumps(candidate, indent=2))
                print(f"Plan SHA-256: {digest(candidate)}")
            else:
                for change in candidate["changes"]:
                    print(f"Different: {change['resource']}")
                print(f"{stage}: {'differs' if candidate['changes'] else 'verified'}")
            different |= bool(candidate["changes"])
        return 1 if different else 0
    except (
        PolicyError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        StopIteration,
    ) as error:
        print(f"Policy could not be established: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
