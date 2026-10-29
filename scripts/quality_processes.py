"""Observe package-owned Linux processes with the ordinary account's read authority."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def same_process(row: dict, proc: Path = Path("/proc")) -> bool:
    """Match an unreused, non-zombie process identity without requiring an executable link."""
    try:
        stat = (proc / str(row["pid"]) / "stat").read_text()
    except (FileNotFoundError, ProcessLookupError):
        return False
    fields = stat[stat.rfind(")") + 2 :].split()
    return fields[0] not in {"Z", "X"} and fields[19] == row["start_time"]


def observe(directory: Path, known: list[dict], proc: Path = Path("/proc")) -> list[dict]:
    directory = directory.resolve(strict=True)
    selected = {row["pid"]: row for row in known}
    result = []
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        pid = int(entry.name)
        identified = pid in selected
        try:
            if identified:
                identified = same_process(selected[pid], proc)
            if not identified:
                if entry.stat().st_uid != os.getuid():
                    continue
                try:
                    executable = (entry / "exe").resolve(strict=True)
                except PermissionError:
                    continue
                if not executable.is_relative_to(directory):
                    continue
            status = dict(
                line.split(":", 1)
                for line in (entry / "status").read_text().splitlines()
                if ":" in line
            )
            if status.get("State", "").strip().startswith(("Z", "X")):
                continue
            if identified:
                renderer = selected[pid]["renderer"]
            else:
                renderer = b"--type=renderer" in (entry / "cmdline").read_bytes()
            nested = len(status.get("NSpid", "").split()) > 1
            seccomp = status.get("Seccomp", "").strip() == "2"
            no_new_privileges = status.get("NoNewPrivs", "").strip() == "1"
            result.append(
                {
                    "pid": pid,
                    "renderer": renderer,
                    "sandbox": renderer and seccomp and no_new_privileges and nested,
                    "nested_pid_namespace": nested,
                    "seccomp_filter": seccomp,
                    "no_new_privileges": no_new_privileges,
                    "identity_source": "native-broker-metrics"
                    if identified
                    else "native-executable-path",
                }
            )
        except (FileNotFoundError, ProcessLookupError):
            continue
    return result


if __name__ == "__main__":
    if sys.platform != "linux" or len(sys.argv) != 3:
        raise SystemExit(
            "Use the Linux observer with an installed directory and native broker process identities."
        )
    known = json.loads(sys.argv[2])
    if (
        not isinstance(known, list)
        or len(known) > 64
        or any(
            set(row) != {"pid", "renderer", "start_time"}
            or type(row["pid"]) is not int
            or row["pid"] <= 0
            or type(row["renderer"]) is not bool
            or not isinstance(row["start_time"], str)
            or not row["start_time"].isdecimal()
            for row in known
        )
    ):
        raise SystemExit("Invalid broker process identity inventory.")
    print(json.dumps(observe(Path(sys.argv[1]), known)))
