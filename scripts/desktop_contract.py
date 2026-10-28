"""Check D1a metadata without executing a candidate or qualifying a native host."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

TARGETS = {
    f"{system}-{arch}" for system in ("linux", "win32", "darwin") for arch in ("x64", "arm64")
}
FACILITIES = {
    "linux-x64": ["ubuntu-24.04"],
    "linux-arm64": ["ubuntu-24.04-arm"],
    "win32-x64": [],
    "win32-arm64": ["windows-11-arm"],
    "darwin-x64": ["macos-15-intel", "macos-26-intel"],
    "darwin-arm64": ["macos-15", "macos-26", "xcode-27"],
}
TOOL_ADRS = {
    "typescript": "0002",
    "electron": "0003",
    "node": "0004",
    "pnpm": "0004",
    "powershell": "0004",
    "eslint": "0004",
    "typescript-eslint": "0004",
    "prettier": "0004",
    "python": "0005",
    "uv": "0005",
    "ruff": "0005",
    "pyrefly": "0005",
    "sqlite": "0006",
    "better-sqlite3": "0007",
    "kysely": "0007",
    "vitest": "0018",
    "jsdom": "0018",
    "@vitest/coverage-istanbul": "0016",
    "@babel/core": "0016",
    "@babel/plugin-transform-optional-chaining": "0016",
    "@babel/plugin-transform-logical-assignment-operators": "0016",
    "@formatjs/icu-messageformat-parser": "0016",
    "@playwright/test": "0018",
    "react": "0022",
    "react-dom": "0022",
    "vite": "0022",
    "electron-builder": "0038",
    "electron-updater": "0038",
}
BUDGET_UNITS = {
    "message_bytes": "byte",
    "string_bytes": "byte",
    "identifier_bytes": "byte",
    "container_items": "item",
    "message_nodes": "node",
    "message_depth": "level",
    "pending_per_window": "request",
    "pending_global": "request",
    "windows": "window",
    "subscriptions_per_window": "subscription",
    "event_queue_items": "event",
    "event_queue_bytes": "byte",
    "request_deadline_ms": "millisecond",
    "service_start_ms": "millisecond",
    "application_start_ms": "millisecond",
    "shutdown_grace_ms": "millisecond",
    "shutdown_termination_ms": "millisecond",
    "shutdown_total_ms": "millisecond",
    "process_tree_count": "process",
    "process_tree_rss_bytes": "byte",
    "process_tree_cpu_ms": "cpu-millisecond",
    "measurement_window_ms": "millisecond",
    "initial_input_bytes": "byte",
    "initial_input_items": "field",
    "initial_output_bytes": "byte",
    "initial_work_units": "operation",
    "sqlite_busy_ms": "millisecond",
    "automatic_service_restarts": "restart",
    "locator_bytes": "byte",
    "diagnostic_event_bytes": "byte",
    "diagnostic_queue_items": "event",
    "diagnostic_queue_bytes": "byte",
    "diagnostic_file_bytes": "byte",
    "diagnostic_files": "file",
    "setup_active_ms": "millisecond",
    "setup_cold_download_ms": "millisecond",
    "ci_retention_days": "day",
    "release_retirement_notice_days": "day",
}
REQUIRED_BUDGETS = set(BUDGET_UNITS)


class ContractError(ValueError):
    """A metadata record violates the qualification contract."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    require(isinstance(value, dict), f"Expected JSON object: {path}")
    return value


def positive(value: Any) -> bool:
    return type(value) is int and 0 < value <= 2**53 - 1


def check_targets(record: dict[str, Any]) -> None:
    require(
        type(record.get("schema_version")) is int and record["schema_version"] == 1,
        "Unsupported target schema",
    )
    rows = record.get("targets")
    require(isinstance(rows, list) and len(rows) == 6, "Exactly six target rows are required")
    require(
        {row.get("id") for row in rows} == TARGETS, "Required native target missing or duplicated"
    )
    for row in rows:
        require(row["id"] == f"{row.get('os')}-{row.get('arch')}", "Target identity mismatch")
        require(
            type(row.get("native_required")) is bool
            and row["native_required"] == (row["id"] not in {"win32-arm64", "darwin-x64"}),
            "Native qualification scope differs from the required and optional target contract",
        )
        aliases = {"x64", "amd64", "x86_64"} if row["arch"] == "x64" else {"arm64", "aarch64"}
        require(set(row.get("aliases", [])) == aliases, "Architecture aliases are incomplete")
        for field in (
            "baseline",
            "filesystems",
            "display",
            "quality_packages",
            "distribution_packages",
        ):
            require(bool(row.get(field)), f"Missing {field} for {row['id']}")
        expected = {"linux": ["deb", "rpm"], "win32": ["nsis"], "darwin": ["dmg", "zip"]}[row["os"]]
        require(
            row["quality_packages"] == row["distribution_packages"] == expected,
            "Delivery package set differs from the selected contract",
        )
    for row in rows:
        require(
            row.get("runtime_arguments", []) == [],
            "Native runtime arguments must preserve the reviewed automatic selection",
        )
        facilities = row.get("testing_facilities", {})
        require(
            facilities.get("hosted_candidates") == FACILITIES[row["id"]]
            and bool(facilities.get("admission")),
            "Candidate testing facilities and admission limits are required",
        )
        if row["os"] == "linux":
            require(
                "runtime_arguments" in row,
                "Linux runtime must use the reviewed native display selection",
            )
            profiles = row.get("distribution_profiles", [])
            expected_profiles = {"ubuntu-24.04", "fedora-44", "ubuntu-26.04", "debian-13"}
            require(
                isinstance(profiles, list)
                and len(profiles) == len(expected_profiles)
                and {p.get("id") for p in profiles} == expected_profiles,
                "Declared Linux distribution profiles are required on their selected CPU",
            )
            expected_arch = (
                {"deb": "amd64", "rpm": "x86_64"}
                if row["arch"] == "x64"
                else {"deb": "arm64", "rpm": "aarch64"}
            )
            require(
                row.get("native_package_architectures") == expected_arch,
                "Linux native package architecture differs",
            )
            for profile in profiles:
                ubuntu = profile["id"] == "ubuntu-24.04"
                fedora = profile["id"] == "fedora-44"
                libc = {
                    "ubuntu-24.04": "2.39",
                    "fedora-44": "2.43",
                    "ubuntu-26.04": "2.43",
                    "debian-13": "2.41",
                }[profile["id"]]
                require(
                    profile.get("package") == ("rpm" if fedora else "deb")
                    and profile.get("filesystems") == (["btrfs"] if fedora else ["ext4"])
                    and profile.get("libc_minimum") == libc,
                    "Linux distribution/package/filesystem baseline differs",
                )
                require(
                    profile.get("hosted_candidates") == (FACILITIES[row["id"]] if ubuntu else []),
                    "A hosted Ubuntu runner cannot qualify Fedora",
                )
                require(
                    bool(profile.get("kernel"))
                    and bool(profile.get("security_policy"))
                    and bool(profile.get("display")),
                    "Linux native policy and display are required",
                )
                require(
                    profile.get("display_backends")
                    == (["wayland", "x11"] if ubuntu else ["wayland"]),
                    "Declared native display backend coverage differs",
                )
                if fedora:
                    image = profile.get("qualification_image", {})
                    check_artifact(image)
                    arch = expected_arch["rpm"]
                    source_root = f"https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Workstation/{arch}/iso/"
                    require(
                        image["url"] == source_root + f"Fedora-Workstation-Live-44-1.7.{arch}.iso"
                        and image.get("checksum_source")
                        == source_root + f"Fedora-Workstation-44-1.7-{arch}-CHECKSUM"
                        and bool(profile.get("required_facility"))
                        and bool(image.get("admission")),
                        "Fedora provisioning image/checksum identity and admission are required",
                    )

        if row["os"] == "win32":
            shell = row.get("primary_shell", {})
            require(
                shell.get("tool") == "powershell"
                and shell.get("executable") == "pwsh.exe"
                and shell.get("arguments") == ["-NoProfile"]
                and bool(shell.get("execution_policy")),
                "Windows requires the reviewed native primary shell",
            )
        if row["os"] == "darwin":
            expected = [15, 26] if row["arch"] == "x64" else [15, 26, 27]
            require(row.get("admitted_os_majors") == expected, "Declared macOS families differ")
            require(
                row.get("required_os_majors") == ([26, 27] if row["arch"] == "arm64" else []),
                "Required macOS qualification families differ",
            )
    require(
        set(record.get("excluded_architectures", [])) == {"ia32", "x86", "arm", "armv7l"},
        "32-bit exclusions must remain explicit",
    )
    require(
        record.get("native_acceptance_substitutes") == [],
        "Emulation/cross-build cannot qualify a target",
    )


def check_artifact(artifact: dict[str, Any], *, packaged: bool = False) -> None:
    require(isinstance(artifact, dict), "Artifact record is required")
    if packaged:
        require(
            isinstance(artifact.get("path"), str) and bool(artifact["path"]),
            "Packaged addon path is required",
        )
    else:
        url = artifact.get("url")
        require(
            isinstance(url, str) and url.startswith("https://") and bool(urlsplit(url).netloc),
            "Artifact source must be HTTPS",
        )
    digest = artifact.get("sha256")
    require(
        isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
        "Artifact requires a complete lowercase SHA-256",
    )
    if "bytes" in artifact:
        require(positive(artifact["bytes"]), "Artifact byte length must be positive")
    require(
        artifact.get("inspection")
        in {
            "published-metadata-only",
            "downloaded-integrity-checked",
            "downloaded-hash-computed",
            "downloaded-header-and-hash-checked",
        },
        "Artifact inspection must distinguish observation from execution",
    )
    require(artifact.get("yanked", False) is False, "Yanked artifacts cannot be selected")


def check_target_download(name: str, version: str, target: str, artifact: dict[str, Any]) -> None:
    """Bind published download names to their declared CPU and platform, without loading bytes."""
    filename = unquote(urlsplit(artifact["url"]).path.rsplit("/", 1)[-1])
    system, arch = target.split("-")
    if name == "electron":
        expected = f"electron-v{version}-{target}.zip"
    elif name == "node":
        platform = "win" if system == "win32" else system
        suffix = "zip" if system == "win32" else "tar.gz" if system == "darwin" else "tar.xz"
        expected = f"node-v{version}-{platform}-{arch}.{suffix}"
    elif name == "powershell":
        expected = f"PowerShell-{version}-win-{arch}.zip"
    elif name == "python":
        build = artifact.get("build", "")
        require(
            isinstance(build, str) and re.fullmatch(r"\d{8}", build) is not None,
            "Managed CPython build identity is required",
        )
        cpu = "x86_64" if arch == "x64" else "aarch64"
        platform = {
            "linux": "unknown-linux-gnu",
            "win32": "pc-windows-msvc",
            "darwin": "apple-darwin",
        }[system]
        expected = f"cpython-{version}+{build}-{cpu}-{platform}-install_only_stripped.tar.gz"
    else:
        tags = {
            "linux-x64": ("manylinux_", "_x86_64"),
            "linux-arm64": ("manylinux_", "_aarch64"),
            "win32-x64": ("win_amd64.whl",),
            "win32-arm64": ("win_arm64.whl",),
            "darwin-x64": ("macosx_", "_x86_64.whl"),
            "darwin-arm64": ("macosx_", "_arm64.whl"),
        }[target]
        require(
            filename.startswith(f"{name}-{version}-py3-none-")
            and filename.endswith(".whl")
            and all(tag in filename for tag in tags),
            f"{name} wheel target identity mismatch",
        )
        return
    require(filename == expected, f"{name} download target/version identity mismatch")


def accepts(version: str, constraint: str) -> bool:
    """Evaluate the simple stable-version ranges in the inspected engine/peer metadata.

    This deliberately rejects unsupported range syntax; it is not an npm resolver.
    """
    constraint = re.sub(r"([<>]=?|\^|=)\s+", r"\1", constraint)
    current = tuple(map(int, version.split(".")))
    alternatives = []
    for alternative in constraint.split("||"):
        results = []
        for token in alternative.split():
            match = re.fullmatch(r"(>=|<=|>|<|\^|=)?(\d+)(?:\.(\d+|\*))?(?:\.(\d+|\*))?", token)
            require(match is not None, f"Unsupported reviewed range syntax: {constraint}")
            op = match[1] or "="
            parts = match.groups()[1:]
            require(
                not (op in {">", "<=", "^"} and any(p in {None, "*"} for p in parts)),
                f"Unsupported partial comparator: {constraint}",
            )
            base = tuple(int(p) if p and p != "*" else 0 for p in parts)
            if op == "^":
                index = next((i for i, value in enumerate(base) if value), 2)
                upper = tuple(
                    base[i] + 1 if i == index else base[i] if i < index else 0 for i in range(3)
                )
                results.append(base <= current < upper)
            elif op == "=":
                results.append(
                    all(p is None or p == "*" or int(p) == current[i] for i, p in enumerate(parts))
                )
            else:
                results.append(
                    {
                        ">=": current >= base,
                        "<=": current <= base,
                        ">": current > base,
                        "<": current < base,
                    }[op]
                )
        require(bool(results), "Empty engine/peer range")
        alternatives.append(all(results))
    return any(alternatives)


def check_toolchain(record: dict[str, Any], root: Path) -> None:
    require(
        type(record.get("schema_version")) is int and record["schema_version"] == 1,
        "Unsupported toolchain schema",
    )
    tools = record.get("tools", {})
    require(set(tools) == set(TOOL_ADRS), "Candidate tool inventory differs from the required set")
    for name, tool in tools.items():
        require(tool.get("adr") == TOOL_ADRS[name], f"Wrong adopting ADR for {name}")
        version = tool.get("version", "")
        require(
            re.fullmatch(r"\d+\.\d+\.\d+", version) is not None,
            f"Exact release patch required: {name}",
        )
        documents = list((root / "docs/adr").glob(f"adr-{tool['adr']}-*.md"))
        require(len(documents) == 1, f"Missing adopting ADR for {name}")
        line = ".".join(version.split(".")[:2]) + ".*"
        label = {
            "node": "Node",
            "python": "CPython",
            "react": "React and React DOM",
            "react-dom": "React and React DOM",
            "@playwright/test": "Playwright",
        }.get(name, name)
        selected = re.search(
            r"(?<![\w@/-])" + re.escape(label) + r"\s+`(\d+\.\d+\.\*)`",
            documents[0].read_text(encoding="utf-8"),
            re.IGNORECASE,
        )
        require(
            selected is not None and selected[1] == line, f"{name} leaves its adopting ADR line"
        )
        require(tool.get("source", "").startswith("https://"), f"Primary source required: {name}")
        if name not in {"node", "uv", "ruff", "pyrefly", "powershell"}:
            require("artifact" in tool, f"Required artifact identity missing: {name}")
            check_artifact(tool["artifact"])
            if urlsplit(tool["artifact"]["url"]).netloc == "registry.npmjs.org":
                integrity = tool["artifact"].get("integrity", "")
                require(
                    isinstance(integrity, str) and integrity.startswith("sha512-"),
                    f"Published npm integrity required: {name}",
                )
                try:
                    decoded = base64.b64decode(integrity.removeprefix("sha512-"), validate=True)
                except ValueError as error:
                    raise ContractError(f"Invalid npm integrity: {name}") from error
                require(len(decoded) == 64, f"Invalid npm integrity length: {name}")
        if name in {
            "electron",
            "node",
            "better-sqlite3",
            "python",
            "uv",
            "ruff",
            "pyrefly",
            "powershell",
        }:
            required_targets = {"win32-x64", "win32-arm64"} if name == "powershell" else TARGETS
            require(
                set(tool.get("artifacts", {})) == required_targets,
                f"Required native artifact coverage differs: {name}",
            )
            for target, artifact in tool["artifacts"].items():
                check_artifact(artifact, packaged=name == "better-sqlite3")
                if name != "better-sqlite3":
                    check_target_download(name, version, target, artifact)
                if name == "better-sqlite3":
                    require(
                        artifact.get("architecture") == target.split("-")[1],
                        "Native addon header architecture mismatch",
                    )
                    require(
                        artifact.get("path") == f"package/prebuilds/{target}.node",
                        "Native addon path mismatch",
                    )
    helpers = tools["electron-builder"].get("linux_packaging_helpers", {})
    require(set(helpers) == {"fpm", "7zip"}, "Frozen Linux packaging helpers are required")
    for name, helper in helpers.items():
        release = helper.get("release", "")
        require(
            re.fullmatch(re.escape(name) + r"@\d+\.\d+\.\d+", release) is not None,
            "Packaging helper release must be exact",
        )
        require(
            set(helper.get("artifacts", {})) == {"linux-x64", "linux-arm64"},
            "Packaging helper native coverage differs",
        )
        for target, artifact in helper["artifacts"].items():
            check_artifact(artifact)
            arch = target.split("-")[1]
            if name == "fpm":
                native_arch = "amd64" if arch == "x64" else "arm64v8"
                filename = (
                    f"fpm-{helper.get('fpm_version')}-ruby-{helper.get('ruby_version')}"
                    f"-linux-{native_arch}.7z"
                )
            else:
                filename = f"7zip-linux-{arch}.tar.gz"
            require(
                unquote(artifact["url"])
                == "https://github.com/electron-userland/electron-builder-binaries/releases/download/"
                + release
                + "/"
                + filename,
                "Packaging helper source or native filename differs",
            )
    require(tools["react"]["version"] == tools["react-dom"]["version"], "React pair must match")
    require(
        tools["python"].get("variant") == "conventional-gil", "Free-threaded Python is not selected"
    )
    require(
        tools["sqlite"].get("distribution") == "better-sqlite3-bundled",
        "Custom SQLite is not selected",
    )
    require(
        tools["better-sqlite3"].get("node_api_version") == 10, "Reviewed Node-API contract changed"
    )
    runtime = tools["electron"].get("embedded_runtime_metadata", {})
    require(
        set(runtime) == {"node", "chrome", "v8", "modules"},
        "Embedded runtime identity is incomplete",
    )

    for component in ("node", "chrome", "v8"):
        identity = runtime[component]
        pattern = r"\d+(?:\.\d+){2,3}"
        if component == "v8":
            pattern += r"(?:-electron\.\d+)?"
        require(
            isinstance(identity, str) and re.fullmatch(pattern, identity) is not None,
            f"Invalid embedded {component} identity",
        )
    require(
        isinstance(runtime["modules"], str)
        and runtime["modules"].isdigit()
        and int(runtime["modules"]) > 0,
        "Invalid embedded module ABI identity",
    )
    require(
        isinstance(tools["node"].get("modules"), str)
        and tools["node"]["modules"].isdigit()
        and int(tools["node"]["modules"]) > 0,
        "Developer Node module ABI identity is required",
    )
    source_id = tools["sqlite"].get("source_id")
    require(
        isinstance(source_id, str)
        and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [0-9a-f]{64}", source_id)
        is not None,
        "SQLite source identity is required",
    )
    ci = tools["python"].get("ci_artifact", {})
    check_artifact(ci)
    require(
        ci.get("os") == "ubuntu-26.04"
        and ci.get("arch") == "x64"
        and ci["url"].endswith(f"/python-{tools['python']['version']}-linux-26.04-x64.tar.gz"),
        "CI Python artifact identity differs from the runner contract",
    )
    ci_source = tools["python"].get("ci_source")
    require(
        isinstance(ci_source, str)
        and re.fullmatch(
            r"https://raw\.githubusercontent\.com/actions/python-versions/[0-9a-f]{40}/versions-manifest\.json",
            ci_source,
        )
        is not None,
        "CI Python metadata requires a commit-pinned source",
    )
    source_digest = tools["python"].get("ci_source_sha256")
    require(
        isinstance(source_digest, str) and re.fullmatch(r"[0-9a-f]{64}", source_digest) is not None,
        "CI Python source digest is required",
    )
    for name, tool in tools.items():
        engine = tool.get("engines", {}).get("node")
        if engine:
            require(
                accepts(tools["node"]["version"], engine), f"Developer Node violates {name} engines"
            )
        for peer in ("typescript", "eslint", "react", "vite"):
            constraint = tool.get("peers", {}).get(peer)
            if constraint:
                require(
                    accepts(tools[peer]["version"], constraint),
                    f"{name} violates {peer} peer range",
                )
        if name in {"uv", "ruff", "pyrefly"}:
            for artifact in tool["artifacts"].values():
                require(
                    accepts(tools["python"]["version"], artifact["requires_python"]),
                    f"Python violates {name} wheel requirements",
                )
    for name in ("better-sqlite3", "kysely"):
        require(
            accepts(runtime["node"], tools[name]["engines"]["node"]),
            f"Embedded Node violates {name} engine metadata",
        )


def check_configuration(root: Path, tools: dict[str, Any]) -> None:
    """Check the repository's literal CI and hook pins; expressions require reviewed adaptation."""
    workflow = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    runners = re.findall(r"^[ \t]+runs-on:[ \t]+([^\s#]+)[ \t]*$", workflow, re.MULTILINE)
    require(runners == [tools["python"]["ci_artifact"]["os"]], "CI runner and manifest differ")
    interpreters = re.findall(
        r"^[ \t]+python-version:[ \t]+[\"']?(\d+\.\d+\.\d+)[\"']?[ \t]*$", workflow, re.MULTILINE
    )
    require(interpreters == [tools["python"]["version"]], "CI Python and manifest differ")
    hooks = (root / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    for name, repository in (
        ("prettier", "https://github.com/rbubley/mirrors-prettier"),
        ("ruff", "https://github.com/astral-sh/ruff-pre-commit"),
    ):
        pattern = (
            r"^[ \t]*-[ \t]+repo:[ \t]+"
            + re.escape(repository)
            + r"[ \t]*\n[ \t]+rev:[ \t]+v(\d+\.\d+\.\d+)[ \t]*$"
        )
        pins = re.findall(pattern, hooks, re.MULTILINE)
        require(pins == [tools[name]["version"]], f"{name} hook and manifest differ")


def check_policy(record: dict[str, Any]) -> None:
    require(
        type(record.get("schema_version")) is int
        and record["schema_version"] == 1
        and record.get("policy_id") == "foundation-1",
        "Unsupported numeric policy identity",
    )
    require(bool(record.get("measurement")), "Encoded-byte measurement contract is required")
    budgets = record.get("budgets", {})
    require(set(budgets) == REQUIRED_BUDGETS, "Required resource bound missing or unknown")
    for name, budget in budgets.items():
        require(positive(budget.get("value")), f"Finite positive integer required: {name}")
        require(budget.get("unit") == BUDGET_UNITS[name], f"Unknown unit: {name}")
        interval = budget.get("permitted", {})
        low, high = interval.get("minimum"), interval.get("maximum")
        require(
            positive(low) and positive(high) and low == budget["value"] == high,
            f"Invalid permitted range: {name}",
        )
        require(
            budget.get("owner") in {"003", "004", "005", "006", "012", "016", "018"},
            f"Unknown resource owner: {name}",
        )
        for field in ("scope", "failure", "rationale"):
            require(
                isinstance(budget.get(field), str) and bool(budget[field].strip()),
                f"Missing {field}: {name}",
            )
    v = {name: budget["value"] for name, budget in budgets.items()}
    require(
        v["identifier_bytes"] <= v["string_bytes"] <= v["message_bytes"], "String bounds conflict"
    )
    require(
        v["initial_input_bytes"] < v["message_bytes"]
        and v["initial_output_bytes"] < v["message_bytes"],
        "Initial payload must leave room for the envelope",
    )
    require(
        v["pending_per_window"] * v["windows"] <= v["pending_global"],
        "Aggregate pending cap conflicts",
    )
    require(v["message_bytes"] <= v["event_queue_bytes"], "Queue cannot hold one maximum event")
    require(
        v["service_start_ms"] <= v["application_start_ms"],
        "Service startup exceeds application budget",
    )
    require(
        v["shutdown_grace_ms"] + v["shutdown_termination_ms"] == v["shutdown_total_ms"],
        "Shutdown budgets do not compose",
    )
    require(
        v["application_start_ms"] + v["shutdown_total_ms"] <= v["measurement_window_ms"],
        "Initial journey cannot fit within the measurement window",
    )
    require(
        v["sqlite_busy_ms"] < v["request_deadline_ms"], "SQLite timeout consumes request deadline"
    )
    require(v["locator_bytes"] == 64 * 1024, "Locator limit differs from architecture")
    require(
        v["diagnostic_file_bytes"] == 5 * 1024 * 1024 and v["diagnostic_files"] == 5,
        "Diagnostic retention differs from ADR-0013",
    )
    require(
        v["diagnostic_event_bytes"] <= v["diagnostic_queue_bytes"] <= v["diagnostic_file_bytes"],
        "Diagnostic bounds conflict",
    )


def check_security(record: dict[str, Any]) -> None:
    require(
        type(record.get("schema_version")) is int and record["schema_version"] == 1,
        "Unsupported applicability schema",
    )
    baseline = record.get("baseline", {})
    require(
        baseline.get("version") == "5.0.0" and baseline.get("levels") == [1, 2],
        "ADR-0000 baseline changed without review",
    )
    require(
        baseline.get("source_sha256")
        == "bcdbec214d70abcfad9284a31d4f9e5134305831d628aad3aa85d7e26626cb35",
        "Inspected ASVS baseline identity changed",
    )
    identifiers = []
    groups = record.get("groups", {})
    require(bool(groups), "Security applicability is empty")
    for group in groups.values():
        require(
            group.get("disposition") in {"applicable", "excluded", "outside-foundation"},
            "Unknown security applicability",
        )
        require(
            bool(group.get("reason")) and bool(group.get("owners")),
            "Every applicability/exclusion requires a reason and an owner",
        )
        require(bool(group.get("requirements")), "Applicability groups cannot be empty")
        identifiers.extend(group["requirements"])
    require(len(identifiers) == len(set(identifiers)), "Duplicate ASVS assignment")
    identity = hashlib.sha256(("\n".join(sorted(identifiers)) + "\n").encode()).hexdigest()
    require(
        identity == "b8cfb8b71b648bc0e181b2a8e4318c36dc1742807e882efe4cfa4b7ac5c97183",
        "L1/L2 baseline requirement coverage differs",
    )


def check_repository(root: Path) -> None:
    directory = root / "config/desktop"
    check_targets(read_json(directory / "targets.json"))
    toolchain = read_json(directory / "toolchain.json")
    check_toolchain(toolchain, root)
    check_configuration(root, toolchain["tools"])
    check_policy(read_json(directory / "resource-policy.json"))
    check_security(read_json(directory / "security-applicability.json"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        check_repository(args.root)
    except (ContractError, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"D1a metadata check failed: {error}", file=sys.stderr)
        return 1
    print(
        "D1a metadata checks passed; native execution, signing and update qualification are separate."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
