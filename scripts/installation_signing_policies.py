"""Render offline, credential-free IAM and bucket-policy previews for the Linux signer."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent))
import installation_signing_metadata as metadata

ROLES = ("rpm", "rpm_passphrase", "catalog", "catalog_passphrase")
IDENTITIES = (
    "organization_id",
    "project_id",
    "administrator_user_id",
    "invoker_application_id",
    "runtime_application_id",
)
MAX_BYTES = 65536
MAX_VARIABLE_BYTES = metadata.MAX_VARIABLE_BYTES
unique = metadata.unique
VARIABLES = {
    **{(name,): "SCW_SIGNING_" + name.upper() for name in IDENTITIES},
    ("buckets", "ingress"): "SCW_SIGNING_INGRESS_BUCKET",
    ("buckets", "retained"): "SCW_SIGNING_RETAINED_BUCKET",
    **{
        ("secret_versions", role, field): "SCW_SIGNING_" + role.upper() + "_" + field.upper()
        for role in ROLES
        for field in ("secret_id", "revision")
    },
}


def require(condition: bool) -> None:
    if not condition:
        raise ValueError("Invalid signing access bindings.")


def encode(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()


def validate(value: object) -> dict:
    require(isinstance(value, dict))
    require(set(value) == {"schema_version", *IDENTITIES, "buckets", "secret_versions"})
    require(type(value["schema_version"]) is int and value["schema_version"] == 1)
    for name in IDENTITIES:
        item = value[name]
        require(isinstance(item, str) and str(UUID(item)) == item and UUID(item).int != 0)
    require(
        len(
            {
                value[k]
                for k in (
                    "administrator_user_id",
                    "invoker_application_id",
                    "runtime_application_id",
                )
            }
        )
        == 3
    )
    buckets = value["buckets"]
    require(isinstance(buckets, dict) and set(buckets) == {"ingress", "retained"})
    require(
        all(
            isinstance(name, str) and re.fullmatch(r"[a-z][a-z0-9-]{1,61}[a-z0-9]", name)
            for name in buckets.values()
        )
    )
    require(buckets["ingress"] != buckets["retained"])
    versions = value["secret_versions"]
    require(isinstance(versions, dict) and set(versions) == set(ROLES))
    for ref in versions.values():
        require(isinstance(ref, dict) and set(ref) == {"secret_id", "revision"})
        item = ref["secret_id"]
        require(isinstance(item, str) and str(UUID(item)) == item and UUID(item).int != 0)
        require(type(ref["revision"]) is int and 1 <= ref["revision"] <= 4294967295)
    require(len({ref["secret_id"] for ref in versions.values()}) == 4)
    return value


def load(path: Path) -> dict:
    require(not path.is_symlink())
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    flags |= getattr(os, "O_BINARY", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_BYTES)
        raw = stream.read(MAX_BYTES + 1)
        require(len(raw) == info.st_size)
    return validate(json.loads(raw, object_pairs_hook=unique))


def bindings_from_variables(raw: bytes) -> dict:
    """Read a complete paginated GitHub Variables response, never secret values or authority."""
    variables = metadata.repository_variables(raw)
    require(set(VARIABLES.values()) <= variables.keys())
    bindings = {"schema_version": 1, "buckets": {}, "secret_versions": {r: {} for r in ROLES}}
    for fields, name in VARIABLES.items():
        value = variables[name]
        if fields[-1] == "revision":
            require(re.fullmatch(r"[1-9][0-9]{0,9}", value) is not None)
            value = int(value)
        target = bindings
        for field in fields[:-1]:
            target = target[field]
        target[fields[-1]] = value
    return validate(bindings)


def render(bindings: object) -> dict[str, bytes]:
    b = validate(bindings)
    project = b["project_id"]
    buckets = b["buckets"]

    def iam(role: str, rules: list[dict]) -> dict:
        return {
            "name": "ohtia-signing-" + role,
            "description": "Restricted Linux signing " + role + " access.",
            "organization_id": b["organization_id"],
            "application_id": b[role + "_application_id"],
            "rules": [{"project_ids": [project], **rule} for rule in rules],
        }

    condition = "resource.id in " + json.dumps(
        [b["secret_versions"][role]["secret_id"] for role in ROLES]
    )
    runtime_rules = [
        {"permission_set_names": ["ContainersReadOnly"]},
        {"permission_set_names": ["SecretManagerSecretAccess"], "condition": condition},
        {"permission_set_names": ["ObjectStorageObjectsRead", "ObjectStorageObjectsWrite"]},
    ]
    files = {
        "iam-invoker.json": iam("invoker", [{"permission_set_names": ["ContainersPrivateAccess"]}]),
        "iam-runtime.json": iam("runtime", runtime_rules),
        "runtime-fragment.json": {
            "project_id": project,
            "buckets": buckets,
            "secret_versions": b["secret_versions"],
        },
    }
    for role, bucket in buckets.items():

        def statement(sid: str, principal: str, actions: list[str], resources: list[str]) -> dict:
            return {
                "Sid": sid,
                "Effect": "Allow",
                "Principal": {"SCW": principal},
                "Action": actions,
                "Resource": resources,
                "Condition": {"Bool": {"aws:SecureTransport": "true"}},
            }

        runtime = "application_id:" + b["runtime_application_id"]
        administrator = "user_id:" + b["administrator_user_id"]
        resources = [
            bucket + "/" + prefix + "/*"
            for prefix in (("objects",) if role == "ingress" else ("objects", "journal", "tokens"))
        ]
        read = statement("RuntimeRead", runtime, ["s3:GetObject"], resources)
        write = statement("RuntimeCreateOnly", runtime, ["s3:PutObject"], resources)
        write["Condition"].update(
            {
                "Null": {"s3:if-none-match": "false"},
                "StringEquals": {"s3:if-none-match": "*"},
            }
        )
        statements = [read, write]
        if role == "retained":
            control = [bucket + "/control/active.json"]
            statements += [
                statement("RuntimeControlRead", runtime, ["s3:GetObject"], control),
                statement(
                    "AdministratorControl", administrator, ["s3:GetObject", "s3:PutObject"], control
                ),
            ]
        files["bucket-" + role + ".json"] = {
            "Version": "2023-04-17",
            "Id": "ohtia-signing-" + role,
            "Statement": statements,
        }
    payloads = {name: encode(value) for name, value in files.items()}
    # Restrictions precede data grants; invocation is granted last.
    requests = [
        {
            "method": "PUT",
            "url": f"https://{bucket}.s3.fr-par.scw.cloud/?policy",
            "payload": "bucket-" + role + ".json",
        }
        for role, bucket in buckets.items()
    ] + [
        {
            "method": "POST",
            "url": "https://api.scaleway.com/iam/v1alpha1/policies",
            "payload": "iam-" + role + ".json",
        }
        for role in ("runtime", "invoker")
    ]
    payloads["plan.json"] = encode(
        {
            "schema_version": 1,
            "mode": "offline-preview",
            "requires_independent_approval": True,
            "region": "fr-par",
            "bindings_sha256": hashlib.sha256(encode(b)).hexdigest(),
            "files": {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()},
            "requests": requests,
        }
    )
    return payloads


def prepare_record(bindings: dict, output: Path) -> None:
    write_preview(render(bindings), output)


def write_preview(files: dict[str, bytes], output: Path) -> None:
    output.mkdir(mode=0o700)
    for name, data in files.items():
        with (output / name).open("xb") as stream:
            os.chmod(output / name, 0o600)
            stream.write(data)


def prepare(bindings: Path, output: Path) -> None:
    prepare_record(load(bindings), output)


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.exit(2, "Invalid signing access arguments.\n")


def main() -> int:
    parser = Parser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bindings", type=Path)
    source.add_argument("--github-variables", action="store_true")
    source.add_argument("--caller-variables", action="store_true")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.caller_variables:
            raw = sys.stdin.buffer.read(MAX_VARIABLE_BYTES + 1)
            caller = metadata.caller_bindings(metadata.repository_variables(raw))
            payload = encode(caller)
            write_preview(
                {
                    "caller-fragment.json": payload,
                    "plan.json": encode(
                        {
                            "schema_version": 1,
                            "mode": "offline-preview",
                            "requires_independent_approval": True,
                            "resource_bindings_sha256": metadata.caller_hash(caller),
                            "files": {"caller-fragment.json": hashlib.sha256(payload).hexdigest()},
                        }
                    ),
                },
                args.output,
            )
        elif args.github_variables:
            raw = sys.stdin.buffer.read(MAX_VARIABLE_BYTES + 1)
            prepare_record(bindings_from_variables(raw), args.output)
        else:
            prepare(args.bindings, args.output)
    except (OSError, ValueError, TypeError, RecursionError):
        print("Unable to prepare signing access preview.", file=sys.stderr)
        return 1
    print("Prepared offline signing access preview; no provider requests were made.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
