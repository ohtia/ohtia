"""Build synthetic native Linux packages in an admitted, unprivileged fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tarfile
import time
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import desktop_probes as probes
from probe_process import run_owned

ROOT = probes.ROOT
ASSETS = ROOT / "tools/desktop-probes"
PROFILE = (
    "abi <abi/4.0>,\ninclude <tunables/global>\n"
    "profile ohtia-native-probe /opt/ohtia-native-probe/ohtia-native-probe "
    "flags=(unconfined) {\n  userns,\n}\n"
)


def native_version(value: str) -> str:
    """Admit only the prerelease vocabulary owned by ADR-0038."""
    number = r"(?:0|[1-9][0-9]*)"
    if not re.fullmatch(
        rf"{number}\.{number}\.{number}(?:-(?:dev\.{number}\.{number}|beta\.{number}))?",
        value,
    ):
        raise probes.ProbeError("Use the ADR-0038 version vocabulary without build metadata.")
    return value.replace("-", "~")


def check_helpers(tools: dict, installed: Path) -> dict:
    """Check the canonical helper projection against the locked builder implementation."""
    helpers = tools["electron-builder"]["linux_packaging_helpers"]
    if set(helpers) != {"fpm", "7zip"}:
        raise probes.ProbeError("Missing frozen Linux packaging helpers.")
    for name, helper in helpers.items():
        source = (
            installed / "out/toolsets" / ("linux.js" if name == "fpm" else "7zip.js")
        ).read_text()
        if helper["release"] not in source or set(helper["artifacts"]) != {
            "linux-x64",
            "linux-arm64",
        }:
            raise probes.ProbeError("Helper release differs from the locked builder.")
        for artifact in helper["artifacts"].values():
            url = urlsplit(artifact["url"])
            filename = unquote(url.path.rsplit("/", 1)[-1])
            if (
                url.scheme != "https"
                or url.netloc != "github.com"
                or unquote(url.path).rsplit("/", 1)[0]
                != "/electron-userland/electron-builder-binaries/releases/download/"
                + helper["release"]
                or f'"{filename}": "{artifact["sha256"]}"' not in source
            ):
                raise probes.ProbeError("Helper artifact differs from the locked primary source.")
    return helpers


def generated_script(name: str, package_format: str) -> str:
    script = (ASSETS / name).read_text()
    prefix = (
        "OHTIA_NATIVE_PACKAGE_FORMAT=" + package_format + "\n"
        "OHTIA_NATIVE_PROFILE_SHA256=" + hashlib.sha256(PROFILE.encode()).hexdigest() + "\n"
    )
    return "#!/bin/sh\n" + prefix + script.removeprefix("#!/bin/sh\n")


def normalize_payload_permissions(payload: Path) -> None:
    """Give the separate public fixture copy root-installable modes without following links."""
    if payload.is_symlink() or payload.resolve() != payload:
        raise probes.ProbeError("Package payload must be a new unaliased copy.")
    entries = [payload, *payload.rglob("*")]
    for file in entries:
        if file.is_symlink():
            if not file.resolve(strict=True).is_relative_to(payload):
                raise probes.ProbeError("Package payload symlink escapes its copied runtime.")
            continue
        mode = file.stat().st_mode
        if mode & 0o6000 or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise probes.ProbeError("Special or setuid/setgid payload entries are refused.")
    for file in entries:
        if not file.is_symlink():
            file.chmod(0o755 if file.is_dir() or file.stat().st_mode & 0o111 else 0o644)


def extract_7zip_archive(archive: Path, destination: Path) -> None:
    """Remove the verified helper's single archive root while retaining safe relative links."""
    with tarfile.open(archive) as stream:
        members = []
        for member in stream.getmembers():
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != "7zip" or ".." in parts:
                raise probes.ProbeError("Unexpected 7zip helper archive root or traversal.")
            if not (member.isdir() or member.isfile() or member.issym()):
                raise probes.ProbeError("Unsupported 7zip helper archive entry.")
            if len(parts) > 1:
                members.append(member.replace(name=PurePosixPath(*parts[1:]).as_posix()))
        stream.extractall(destination, members=members, filter="data")


def builder_configuration(output: Path, payload: Path, package_format: str, tools: dict) -> dict:
    """Generate per-format options for the selected builder schema and fixed fixture identity."""
    profile = output / "apparmor-profile"
    profile.write_text(PROFILE)
    profile.chmod(0o644)
    scripts = {}
    for name in ("linux-before-install.sh", "linux-after-install.sh", "linux-after-remove.sh"):
        file = output / name
        file.write_text(generated_script(name, package_format))
        scripts[name] = str(file)
    options = {
        "packageName": "ohtia-native-probe",
        "maintainer": "Ohtia qualification <qualification@example.invalid>",
        "afterInstall": scripts["linux-after-install.sh"],
        "afterRemove": scripts["linux-after-remove.sh"],
        "appArmorProfile": str(profile),
        "fpm": ["--before-install", scripts["linux-before-install.sh"]],
    }
    config = {
        "appId": "org.ohtia.native-probe",
        "productName": "ohtia-native-probe",
        "executableName": "ohtia-native-probe",
        "electronVersion": tools["electron"]["version"],
        "buildNumber": "1",
        "asar": False,
        "directories": {
            "output": str(output / "packages"),
            "app": str(payload / "resources/app"),
        },
        "extraMetadata": {"homepage": "https://github.com/ohtia/ohtia"},
        "linux": {
            "target": [package_format],
            "category": "Development",
            "icon": str(output / "icons"),
        },
        package_format: options,
        "publish": None,
    }
    # Native profile support is an explicit installed dependency, never a silent skip.
    if package_format == "deb":
        config["deb"].update(
            {
                "recommends": [],
                "depends": [
                    "libgtk-3-0",
                    "libnotify4",
                    "libnss3",
                    "libxss1",
                    "libxtst6",
                    "xdg-utils",
                    "libatspi2.0-0",
                    "libuuid1",
                    "libsecret-1-0",
                    "apparmor",
                ],
            }
        )
    return config


def package(admission_file: Path, attempt: Path, package_format: str, version: str) -> Path:
    mapped_version = native_version(version)
    data = probes.admission(admission_file)
    if os.name != "posix" or data["target"] not in {"linux-x64", "linux-arm64"}:
        raise probes.ProbeError("This fixture packages only admitted native Linux targets.")
    expected_format = "rpm" if data["profile"] == "fedora-44" else "deb"
    if package_format != expected_format:
        raise probes.ProbeError("Build the declared distribution's native package format.")
    if attempt.resolve() != attempt or attempt.parent != Path(data["scratch_root"]):
        raise probes.ProbeError("Package only an immutable attempt in the admitted scratch root.")
    prepared = probes.read_json(attempt / "prepared.json")
    admitted = probes.read_json(attempt / "admitted.json")
    inputs = probes.source_inputs()
    if (
        admitted["attempt_id"] != attempt.name
        or admitted["admission_sha256"] != probes.digest(admission_file)
        or admitted["prepared_sha256"] != probes.digest(attempt / "prepared.json")
        or prepared["inputs"] != inputs
        or prepared["target"] != data["target"]
        or prepared["expected"]["scenario"] != "journey"
        or probes.inventory(attempt / "runtime") != prepared["runtime_inventory"]
    ):
        raise probes.ProbeError("Source, admission, scenario or native runtime changed.")
    tools = probes.read_json(ROOT / "config/desktop/toolchain.json")["tools"]
    # Resolve only through this private package's frozen dependency graph.
    installed = Path(
        subprocess.check_output(
            [
                str(probes.workspace.node_path()),
                "--input-type=module",
                "-e",
                "import{createRequire}from'node:module';const r=createRequire(process.argv[1]);"
                "const b=createRequire(r.resolve('electron-builder/package.json'));"
                "console.log(b.resolve('app-builder-lib/package.json'));",
                str(ASSETS / "package.json"),
            ],
            text=True,
            cwd=ROOT,
            env={"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"},
        ).strip()
    ).parent
    helpers = check_helpers(tools, installed)
    output = attempt / ("delivery-" + str(uuid.uuid4()))
    output.mkdir(mode=0o700)
    receipt = {
        "kind": "native-linux-package-feasibility",
        "qualified": False,
        "target": data["target"],
        "profile": data["profile"],
        "format": package_format,
        "application_version": version,
        "native_version": mapped_version + "-1",
        "inputs": inputs,
        "prepared_sha256": probes.digest(attempt / "prepared.json"),
        "admitted_sha256": probes.digest(attempt / "admitted.json"),
        "helpers": {},
        "limits": [
            "This is an unsigned synthetic quality package, not final signed distribution.",
            "Construction does not prove native installation, updater transport or recovery.",
            "The fixed AppArmor exception permits user namespaces; it is not file-access confinement.",
        ],
    }
    try:
        env = {key: value for key, value in os.environ.items() if key in {"HOME", "LANG", "LC_ALL"}}
        env["PATH"] = "/usr/sbin:/usr/bin:/sbin:/bin"
        for name in ("7zip", "fpm"):
            artifact = helpers[name]["artifacts"][data["target"]]
            archive = output / (name + (".tar.gz" if name == "7zip" else ".7z"))
            started = time.monotonic_ns()
            probes.workspace.download(artifact, archive)
            receipt["helpers"][name] = {
                "artifact": artifact,
                "download_ms": (time.monotonic_ns() - started) // 1_000_000,
            }
            destination = output / name
            destination.mkdir(mode=0o700)
            if name == "7zip":
                extract_7zip_archive(archive, destination)
                extractor = destination / "bin/7za"
                if probes.binary_arch(extractor) != data["target"].split("-")[1]:
                    raise probes.ProbeError("Wrong native packaging helper architecture.")
                extractor.chmod(0o755)
                env["ELECTRON_BUILDER_7ZIP_PATH"] = str(extractor)
            else:
                result = run_owned(
                    [str(extractor), "x", "-bd", str(archive), "-o" + str(destination), "-y"],
                    ROOT,
                    env,
                    60,
                    5,
                )
                receipt["helpers"][name]["extraction_supervision"] = result
                if (
                    result["exit_code"] != 0
                    or result["timed_out"]
                    or result["contained_processes_remaining_at_exit"]
                ):
                    raise probes.ProbeError("Frozen FPM helper extraction failed.")
                env["CUSTOM_FPM_PATH"] = str(destination / "fpm")
            receipt["helpers"][name]["inventory"] = probes.inventory(destination)
        payload = output / "payload"
        shutil.copytree(attempt / "runtime", payload, symlinks=True)
        (payload / "electron").rename(payload / "ohtia-native-probe")
        normalize_payload_permissions(payload)
        metadata = probes.read_json(payload / "resources/app/package.json")
        metadata.update(
            {
                "name": "ohtia-native-probe",
                "version": version,
                "description": "Isolated native foundation qualification fixture",
                "license": "MIT",
            }
        )
        (payload / "resources/app/package.json").write_text(json.dumps(metadata, indent=2) + "\n")
        shutil.copyfile(ROOT / "LICENSE", payload / "OHTIA-LICENSE")
        (payload / "OHTIA-LICENSE").chmod(0o644)
        # FPM also receives builder-owned assets outside the runtime payload. Copy and
        # normalize those assets without changing the installed dependency's modes.
        icons = output / "icons"
        shutil.copytree(installed / "templates/icons/electron-linux", icons, symlinks=True)
        normalize_payload_permissions(icons)
        receipt["builder_asset_inventory"] = probes.inventory(icons)
        config = builder_configuration(output, payload, package_format, tools)
        configuration = output / "builder.json"
        configuration.write_text(json.dumps(config, indent=2) + "\n")
        env.update(
            {
                "ELECTRON_BUILDER_CACHE": str(output / "builder-cache"),
                "ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL": "https://127.0.0.1:1",
                "ELECTRON_SKIP_BINARY_DOWNLOAD": "1",
                "CSC_IDENTITY_AUTO_DISCOVERY": "false",
            }
        )
        started = time.monotonic_ns()
        receipt["builder_supervision"] = run_owned(
            [
                str(probes.workspace.node_path()),
                str(ASSETS / "package-linux.mjs"),
                str(configuration),
                str(payload),
            ],
            ROOT,
            env,
            300,
            5,
        )
        receipt["active_build_ms"] = (time.monotonic_ns() - started) // 1_000_000
        artifacts = list((output / "packages").glob("*." + package_format))
        if (
            receipt["builder_supervision"]["exit_code"] != 0
            or receipt["builder_supervision"]["timed_out"]
            or receipt["builder_supervision"]["contained_processes_remaining_at_exit"]
            or len(artifacts) != 1
        ):
            raise probes.ProbeError(
                "Native package build failed; retain diagnostics and failed candidate."
            )
        receipt["package"] = {
            "file": str(artifacts[0]),
            "sha256": probes.digest(artifacts[0]),
            "bytes": artifacts[0].stat().st_size,
        }
        receipt["construction_inputs"] = probes.inventory(output / "packages")
        receipt["ok"] = True
    except BaseException as error:
        receipt["ok"] = False
        receipt["failure"] = {"name": type(error).__name__, "message": str(error)}
        raise
    finally:
        receipt["final_observations_complete"] = True
        for field, observe in (
            ("source_inputs_unchanged", lambda: probes.source_inputs() == inputs),
            (
                "canonical_runtime_inventory_unchanged",
                lambda: probes.inventory(attempt / "runtime") == prepared["runtime_inventory"],
            ),
        ):
            try:
                receipt[field] = observe()
            except BaseException as error:
                receipt[field] = False
                receipt["ok"] = False
                receipt["final_observations_complete"] = False
                receipt.setdefault("observation_failures", {})[field] = {
                    "name": type(error).__name__,
                    "message": str(error),
                }
        try:
            if probes.digest(admission_file) != admitted["admission_sha256"]:
                raise probes.ProbeError("Admission declaration changed during packaging.")
            probes.admission(admission_file)
            if probes.digest(admission_file) != admitted["admission_sha256"]:
                raise probes.ProbeError("Admission declaration changed during packaging.")
            receipt["stable_admission_unchanged"] = True
        except BaseException as error:
            receipt["ok"] = False
            receipt["stable_admission_unchanged"] = False
            receipt["final_observations_complete"] = False
            receipt["admission_failure"] = {"name": type(error).__name__, "message": str(error)}
        finally:
            if not all(
                receipt[field]
                for field in (
                    "source_inputs_unchanged",
                    "canonical_runtime_inventory_unchanged",
                    "stable_admission_unchanged",
                    "final_observations_complete",
                )
            ):
                receipt["ok"] = False
            probes.write_json(output / "package-receipt.json", receipt)
    if not receipt["ok"]:
        raise probes.ProbeError("Packaging final observations failed or admitted inputs changed.")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("admission", type=Path)
    parser.add_argument("attempt", type=Path)
    parser.add_argument("--format", choices=("deb", "rpm"), required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    try:
        print(package(args.admission, args.attempt, args.format, args.version))
    except (
        probes.ProbeError,
        OSError,
        ValueError,
        KeyError,
        subprocess.SubprocessError,
        tarfile.TarError,
    ) as error:
        raise SystemExit("Native delivery fixture failed: " + str(error)) from error


if __name__ == "__main__":
    main()
