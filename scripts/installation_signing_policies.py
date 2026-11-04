"""Render offline, credential-free IAM and bucket-policy previews for the Linux signer."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
from pathlib import Path
from uuid import UUID

ROLES = ("rpm", "rpm_passphrase", "catalog", "catalog_passphrase")
IDENTITIES = (
    "organization_id",
    "project_id",
    "administrator_user_id",
    "invoker_application_id",
    "runtime_application_id",
)
MAX_BYTES = 65536


def require(condition: bool) -> None:
    if not condition:
        raise ValueError("Invalid signing access bindings.")


def encode(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()


def validate(value: object) -> dict:
    require(isinstance(value, dict))
    require(set(value) == {"schema_version", *IDENTITIES, "secret_versions"})
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
    versions = value["secret_versions"]
    require(isinstance(versions, dict) and set(versions) == set(ROLES))
    for ref in versions.values():
        require(isinstance(ref, dict) and set(ref) == {"secret_id", "revision"})
        item = ref["secret_id"]
        require(isinstance(item, str) and str(UUID(item)) == item and UUID(item).int != 0)
        require(type(ref["revision"]) is int and 1 <= ref["revision"] <= 4294967295)
    require(len({ref["secret_id"] for ref in versions.values()}) == 4)
    return value


def unique(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, item in pairs:
        require(key not in result)
        result[key] = item
    return result


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


def render(bindings: object) -> dict[str, bytes]:
    b = validate(bindings)
    project = b["project_id"]
    buckets = {role: f"ohtia-signing-{role}-{project}" for role in ("ingress", "retained")}

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
        "runtime-fragment.json": {"buckets": buckets, "secret_versions": b["secret_versions"]},
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


def prepare(bindings: Path, output: Path) -> None:
    files = render(load(bindings))
    output.mkdir(mode=0o700)
    for name, data in files.items():
        with (output / name).open("xb") as stream:
            os.chmod(output / name, 0o600)
            stream.write(data)


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.exit(2, "Invalid signing access arguments.\n")


def main() -> int:
    parser = Parser(description=__doc__)
    parser.add_argument("--bindings", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        prepare(args.bindings, args.output)
    except (OSError, ValueError, TypeError, RecursionError):
        print("Unable to prepare signing access preview.", file=sys.stderr)
        return 1
    print("Prepared offline signing access preview; no provider requests were made.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
