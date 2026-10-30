"""Check protected Actions access to Scaleway using only fixed-origin GET requests."""

from __future__ import annotations

import http.client
import json
import os
import platform
import re
import subprocess
import sys
import time
import uuid
from urllib.parse import urlencode

HOST = "api.scaleway.com"
MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024
MAXIMUM_REPORT_BYTES = 16384
REQUEST_SECONDS = 20
CATALOG_PAGE_SIZE = 100
MAXIMUM_CATALOG_PAGES = 5
HTTP_FAILURES = {401: "api_unauthorized", 403: "api_forbidden", 429: "api_rate_limited"}
WORKFLOW = "ohtia/ohtia/.github/workflows/scaleway-access.yml@refs/heads/main"

FAILURE_CODES = frozenset(
    {
        "api_deadline_exceeded",
        "api_forbidden",
        "api_rate_limited",
        "api_request_refused",
        "api_transport_or_json_failed",
        "api_unauthorized",
        "block_storage_unsupported",
        "catalog_page_limit",
        "checkout_source_mismatch",
        "duplicate_images",
        "duplicate_response_key",
        "encoded_response",
        "image_identity_mismatch",
        "image_instance_incompatible",
        "image_not_bootable_sbs",
        "image_target_mismatch",
        "incomplete_response",
        "instance_type_unavailable",
        "invalid_api_path",
        "invalid_arm_instance",
        "invalid_credential",
        "invalid_disk_size",
        "invalid_instance_catalog",
        "invalid_instance_type",
        "invalid_json_number",
        "invalid_resource_list",
        "invalid_response_shape",
        "invalid_run_identity",
        "invalid_source_identity",
        "invalid_uuid_configuration",
        "invalid_zone",
        "missing_credential",
        "report_too_large",
        "resource_project_mismatch",
        "response_too_large",
        "untrusted_context",
        "workflow_source_mismatch",
        "wrong_runner",
    }
)


class PreflightError(Exception):
    """A controlled access or configuration check failed."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise PreflightError(code)


def canonical_uuid(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise PreflightError("invalid_uuid_configuration") from None
    require(str(parsed) == value and parsed.int != 0, "invalid_uuid_configuration")
    return value


def context() -> dict:
    """Require the protected main-only dispatch, binding its actual checkout."""
    expected = {
        "GITHUB_ACTIONS": "true",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "Linux",
        "RUNNER_ARCH": "X64",
        "GITHUB_REPOSITORY": "ohtia/ohtia",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
    }
    require(
        all(os.environ.get(key) == value for key, value in expected.items()), "untrusted_context"
    )
    require(platform.system() == "Linux" and platform.machine() == "x86_64", "wrong_runner")
    sha = os.environ.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", sha) is not None, "invalid_source_identity")
    require(os.environ.get("GITHUB_WORKFLOW_SHA") == sha, "workflow_source_mismatch")
    run, attempt = (os.environ.get(key, "") for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    require(
        all(re.fullmatch(r"[1-9][0-9]{0,19}", value) for value in (run, attempt)),
        "invalid_run_identity",
    )
    checkout = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
        env={
            "PATH": os.environ.get("PATH", ""),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        },
    ).stdout.strip()
    require(checkout == sha, "checkout_source_mismatch")
    return {
        "repository": "ohtia/ohtia",
        "source_sha": sha,
        "workflow": WORKFLOW,
        "run_id": run,
        "attempt": attempt,
    }


def configuration() -> dict:
    """Read deployment settings without accepting caller-supplied API endpoints."""
    project = canonical_uuid(os.environ.get("SCW_PROJECT_ID", ""))
    zone = os.environ.get("SCW_ARM_ZONE", "")
    require(re.fullmatch(r"(?:fr-par|nl-ams|pl-waw)-[123]", zone) is not None, "invalid_zone")
    instance_type = os.environ.get("SCW_ARM_INSTANCE_TYPE", "")
    require(
        re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,63}", instance_type) is not None, "invalid_instance_type"
    )
    disk = os.environ.get("SCW_ARM_DISK_GIB", "")
    require(re.fullmatch(r"[1-9][0-9]{0,4}", disk) is not None, "invalid_disk_size")
    images = {
        "fedora_44": canonical_uuid(os.environ.get("SCW_ARM_FEDORA44_IMAGE_ID", "")),
        "debian_trixie": canonical_uuid(os.environ.get("SCW_ARM_DEBIAN13_IMAGE_ID", "")),
    }
    require(len(set(images.values())) == 2, "duplicate_images")
    return {
        "project_id": project,
        "zone": zone,
        "instance_type": instance_type,
        "disk_gib": int(disk),
        "images": images,
    }


def unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_response_key")
        result[key] = value
    return result


def get(path: str, *, token: str | None = None) -> dict:
    """GET one bounded JSON object; never redirect, retry or expose response bodies."""
    require(
        path.startswith(
            ("/instance/v1/zones/", "/block/v1/zones/", "/marketplace/v2/local-images/")
        ),
        "invalid_api_path",
    )
    require(
        re.fullmatch(r"/[A-Za-z0-9_/?=&.%-]+", path) is not None and ".." not in path,
        "invalid_api_path",
    )
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "ohtia-scaleway-preflight/1",
    }
    if token is not None:
        require(
            len(token) <= 256 and re.fullmatch(r"[A-Za-z0-9-]{16,256}", token) is not None,
            "invalid_credential",
        )
        headers["X-Auth-Token"] = token
    deadline = time.monotonic() + REQUEST_SECONDS
    connection = http.client.HTTPSConnection(HOST, timeout=REQUEST_SECONDS)
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        # http.client does not follow redirects. No Location, error body or request header is logged.
        require(response.status == 200, HTTP_FAILURES.get(response.status, "api_request_refused"))
        require(
            response.getheader("Content-Encoding", "identity") == "identity", "encoded_response"
        )
        data = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "api_deadline_exceeded")
            if connection.sock is not None:
                connection.sock.settimeout(remaining)
            block = response.read1(min(65536, MAXIMUM_RESPONSE_BYTES + 1 - len(data)))
            if not block:
                break
            data.extend(block)
            require(len(data) <= MAXIMUM_RESPONSE_BYTES, "response_too_large")
        require(response.length in (None, 0), "incomplete_response")
        result = json.loads(
            data,
            object_pairs_hook=unique_object,
            parse_constant=lambda _: require(False, "invalid_json_number"),
        )
        require(isinstance(result, dict), "invalid_response_shape")
        return result
    except (OSError, http.client.HTTPException, ValueError, RecursionError):
        raise PreflightError("api_transport_or_json_failed") from None
    finally:
        connection.close()


def read_access(settings: dict, token: str) -> dict:
    """Check filtered reads, not IAM write authority or denial on other projects."""
    zone, project = settings["zone"], settings["project_id"]
    checks = (
        (
            "instances",
            f"/instance/v1/zones/{zone}/servers?"
            + urlencode({"project": project, "per_page": 1, "page": 1}),
            "servers",
            "project",
        ),
        (
            "block_storage",
            f"/block/v1/zones/{zone}/volumes?"
            + urlencode(
                {"project_id": project, "include_deleted": "false", "page_size": 1, "page": 1}
            ),
            "volumes",
            "project_id",
        ),
    )
    result = {}
    for name, path, collection, project_field in checks:
        data = get(path, token=token)
        items = data.get(collection)
        require(isinstance(items, list) and len(items) <= 1, "invalid_resource_list")
        require(
            all(isinstance(item, dict) and item.get(project_field) == project for item in items),
            "resource_project_mismatch",
        )
        # Do not retain existing machines, addresses, volumes or resource names in public artifacts.
        result[name] = "authenticated_list_accepted"
    return result


def profile(settings: dict) -> dict:
    """Validate the selected ARM image/SKU combinations using the public catalog."""
    zone, instance_type = settings["zone"], settings["instance_type"]
    selected = None
    for page in range(1, MAXIMUM_CATALOG_PAGES + 1):
        catalog = get(
            f"/instance/v1/zones/{zone}/products/servers?per_page={CATALOG_PAGE_SIZE}&page={page}"
        )
        servers = catalog.get("servers")
        require(
            isinstance(servers, dict) and len(servers) <= CATALOG_PAGE_SIZE,
            "invalid_instance_catalog",
        )
        if instance_type in servers:
            selected = servers[instance_type]
            break
        require(len(servers) == CATALOG_PAGE_SIZE, "instance_type_unavailable")
    else:
        raise PreflightError("catalog_page_limit")
    require(isinstance(selected, dict), "invalid_instance_catalog")
    require(
        selected.get("arch") == "arm64" and selected.get("end_of_service") is False,
        "invalid_arm_instance",
    )
    capabilities = selected.get("capabilities")
    require(
        isinstance(capabilities, dict) and capabilities.get("block_storage") is True,
        "block_storage_unsupported",
    )
    images = []
    for label, image_id in settings["images"].items():
        image = get(f"/marketplace/v2/local-images/{image_id}")
        require(
            image.get("id") == image_id and image.get("label") == label, "image_identity_mismatch"
        )
        require(image.get("zone") == zone and image.get("arch") == "arm64", "image_target_mismatch")
        require(image.get("type") == "instance_sbs", "image_not_bootable_sbs")
        compatible = image.get("compatible_commercial_types")
        require(
            isinstance(compatible, list) and instance_type in compatible,
            "image_instance_incompatible",
        )
        images.append({"id": image_id, "label": label, "arch": "arm64", "type": "instance_sbs"})
    return {
        "zone": zone,
        "instance_type": instance_type,
        "architecture": "arm64",
        "disk_gib": settings["disk_gib"],
        "images": images,
    }


def observe() -> dict:
    identity = context()
    settings = configuration()
    token = os.environ.get("SCW_SECRET_KEY", "")
    require(bool(token), "missing_credential")
    access = read_access(settings, token)
    selected = profile(settings)
    return {
        "version": 1,
        "identity": identity,
        "status": "passed",
        "access": access,
        "profile": selected,
        "resources_created": False,
        "write_authority_tested": False,
        "project_policy_isolation_tested": False,
        "disk_capacity_tested": False,
        "stock_reserved": False,
        "distribution_qualified": False,
    }


def main() -> int:
    try:
        report = json.dumps(observe(), sort_keys=True, indent=2)
        require(len(report.encode("utf-8")) <= MAXIMUM_REPORT_BYTES, "report_too_large")
        print(report)
        return 0
    except (PreflightError, OSError, ValueError, subprocess.SubprocessError) as error:
        # Only reviewed static diagnostic codes may reach the log, never arbitrary exception text.
        code = (
            str(error)
            if isinstance(error, PreflightError) and str(error) in FAILURE_CODES
            else "preflight_failed"
        )
        print(
            f"Scaleway preflight failed ({code}); check configuration and protected API access.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
