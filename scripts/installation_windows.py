"""Ordinary-account Windows adapters for the internal installation campaign."""

from __future__ import annotations

import ctypes as c
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path, PureWindowsPath

import desktop_probes
import desktop_runtime
import quality_native
import windows_contributor
import workspace

ROOT = Path(__file__).resolve().parent.parent


def require(value, message):
    if not value:
        raise ValueError(message)


def opened(file):
    """Open a canonical regular file without following a reparse point or admitting writers."""
    import msvcrt
    from ctypes import wintypes as w

    require(file.is_absolute() and file.resolve() == file, "Aliased Windows file.")
    desktop_probes.real_directory(str(file.parent))
    k = c.WinDLL("kernel32", use_last_error=True)
    k.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE]
    k.CreateFileW.restype = w.HANDLE
    k.CloseHandle.argtypes = [w.HANDLE]
    handle = k.CreateFileW(str(file), 0x80000000, 1, None, 3, 0x08200000, None)
    if handle == w.HANDLE(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        fd = msvcrt.open_osfhandle(int(handle), os.O_RDONLY | os.O_BINARY)
    except BaseException:
        k.CloseHandle(handle)
        raise
    info = os.fstat(fd)
    if not (
        stat.S_ISREG(info.st_mode)
        and info.st_nlink == 1
        and not getattr(info, "st_file_attributes", 0) & 0x400
    ):
        os.close(fd)
        raise ValueError("Windows alias, hardlink or special file refused.")
    return fd


def read_json(file, maximum=65536):
    fd = opened(file)
    try:
        require(os.fstat(fd).st_size <= maximum, "Oversized Windows JSON.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        require(len(data) <= maximum, "Windows JSON exceeded its bound.")
        return json.loads(data)
    finally:
        os.close(fd)


def observe(file, destination=None):
    fd = opened(file)
    try:
        info = os.fstat(fd)
        checksum = hashlib.sha256()
        with os.fdopen(fd, "rb", closefd=False) as source:
            output = destination.open("xb") if destination is not None else None
            try:
                remaining = info.st_size
                while remaining:
                    data = source.read(min(remaining, 1024 * 1024))
                    require(data, "Windows file truncated during observation.")
                    remaining -= len(data)
                    checksum.update(data)
                    if output:
                        output.write(data)
                require(not source.read(1), "Windows file grew during observation.")
                if output:
                    output.flush()
                    os.fsync(output.fileno())
            finally:
                if output:
                    output.close()
        return {"sha256": checksum.hexdigest(), "bytes": info.st_size}
    finally:
        os.close(fd)


def identity(pid):
    require(type(pid) is int and pid > 0, "Invalid Windows process identifier.")
    from ctypes import wintypes as w

    k = c.WinDLL("kernel32", use_last_error=True)
    a = c.WinDLL("advapi32", use_last_error=True)
    k.OpenProcess.argtypes, k.OpenProcess.restype = [w.DWORD, w.BOOL, w.DWORD], w.HANDLE
    k.GetProcessTimes.argtypes = [w.HANDLE, *([c.POINTER(w.FILETIME)] * 4)]
    k.GetExitCodeProcess.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
    k.CloseHandle.argtypes = [w.HANDLE]
    k.LocalFree.argtypes, k.LocalFree.restype = [c.c_void_p], c.c_void_p
    a.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
    a.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
    a.ConvertSidToStringSidW.argtypes = [c.c_void_p, c.POINTER(w.LPWSTR)]
    handle = k.OpenProcess(0x1000, False, pid)
    if not handle:
        if c.get_last_error() == 87:
            raise ProcessLookupError("Native Windows lease owner ceased.")
        raise c.WinError(c.get_last_error())
    token = w.HANDLE()
    try:
        exit_code = w.DWORD()
        require(k.GetExitCodeProcess(handle, c.byref(exit_code)), "Cannot inspect lease status.")
        if exit_code.value != 259:
            raise ProcessLookupError("Native Windows lease owner exited.")
        created, exited, kernel, user = (w.FILETIME() for _ in range(4))
        require(
            k.GetProcessTimes(
                handle, c.byref(created), c.byref(exited), c.byref(kernel), c.byref(user)
            ),
            "Cannot inspect process creation time.",
        )
        require(a.OpenProcessToken(handle, 8, c.byref(token)), "Cannot inspect process owner.")
        size = w.DWORD()
        a.GetTokenInformation(token, 1, None, 0, c.byref(size))
        require(0 < size.value <= 65536, "Invalid Windows token size.")
        buffer = c.create_string_buffer(size.value)
        require(
            a.GetTokenInformation(token, 1, buffer, size.value, c.byref(size)),
            "Cannot read Windows owner.",
        )
        sid = w.LPWSTR()
        require(
            a.ConvertSidToStringSidW(c.c_void_p.from_buffer(buffer), c.byref(sid)),
            "Cannot decode Windows owner.",
        )
        try:
            owner = sid.value
        finally:
            k.LocalFree(c.cast(sid, c.c_void_p))
        return {
            "platform": "win32",
            "pid": pid,
            "sid": owner,
            "created_100ns": str((created.dwHighDateTime << 32) | created.dwLowDateTime),
        }
    finally:
        if token:
            k.CloseHandle(token)
        k.CloseHandle(handle)


def lease_status(file):
    lease = read_json(file)
    require(
        type(lease.get("pid")) is int
        and lease["pid"] > 0
        and lease.get("owner", {}).get("pid") == lease["pid"]
        and lease["owner"].get("platform") == "win32"
        and isinstance(lease["owner"].get("created_100ns"), str)
        and lease["owner"]["created_100ns"].isdigit(),
        "Invalid Windows lease birth identity.",
    )
    require(
        lease.get("owner", {}).get("sid") == identity(os.getpid())["sid"], "Foreign Windows lease."
    )
    try:
        live = identity(lease["pid"]) == lease["owner"]
    except ProcessLookupError:
        live = False
    return {"status": "live" if live else "ceased", "lease": lease}


def check_admission(record, profile, native):
    import time

    directory = Path(profile["scratch_root"]) / "update-acceptance"
    lease = read_json(directory / "operation.lock")
    state = read_json(directory / "accepted.json")
    admission = record["admission"]
    require(
        lease == admission["lease"] and state == admission["state"], "Windows admission changed."
    )
    require(
        state["highest_version"] == record["version"]
        and state["catalog_sha256"] == admission["catalog_sha256"],
        "Wrong Windows acceptance floor.",
    )
    require(
        lease_status(directory / "operation.lock")["status"] == "live",
        "Windows operation owner ceased.",
    )
    require(
        state["last_accepted_ms"] <= int(time.time() * 1000) < admission["expires_ms"],
        "Windows catalog expired or clock uncertain.",
    )


def file_tree(directory):
    require(directory.resolve() == directory, "Aliased Windows payload.")
    result = {}
    for parent, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs + files:
            file = Path(parent) / name
            info = file.lstat()
            require(
                not getattr(info, "st_file_attributes", 0) & 0x400, "Windows payload reparse point."
            )
            if stat.S_ISDIR(info.st_mode):
                continue
            relative = file.relative_to(directory).as_posix()
            # These are installer-generated controls, not application payload identity.
            if relative.casefold() in {
                "prepared.json",
                "uninstall ohtia-quality.exe",
                "uninstallericon.ico",
            }:
                continue
            result[relative] = {"sha256": observe(file)["sha256"]}
    return result


def validate_entries(text, maximum, maximum_entries):
    entries, identities, total = [], set(), 0
    for block in text.replace("\r\n", "\n").split("\n\n"):
        fields = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
        if "Path" not in fields:
            continue
        require("Size" in fields, "Archive member has no declared size.")
        require(len(entries) < maximum_entries, "Too many Windows archive members.")
        name = fields["Path"]
        path = PureWindowsPath(name)
        require(
            not path.is_absolute()
            and not path.drive
            and not path.root
            and ".." not in path.parts
            and ":" not in name
            and name.replace("\\", "/") == path.as_posix()
            and all(not part.endswith((".", " ")) for part in path.parts),
            "Unsafe archive member.",
        )
        import re

        require(
            not any(
                re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", part, re.IGNORECASE)
                for part in path.parts
            ),
            "Reserved Windows archive name.",
        )
        require(
            path.as_posix().casefold() not in identities,
            "Duplicate Windows archive member.",
        )
        require(
            "Symbolic Link" not in fields
            and "Hard Link" not in fields
            and "L" not in fields.get("Attributes", "")
            and not any(part.startswith("l") for part in fields.get("Attributes", "").split()),
            "Archive link refused.",
        )
        size = int(fields["Size"])
        require(size >= 0, "Negative archive member size.")
        total += size
        require(total <= maximum, "Expanded package exceeds qualification bound.")
        identities.add(path.as_posix().casefold())
        entries.append(name)
    require(entries, "Empty Windows archive.")
    return entries


def archive_payload(file, destination, native):
    code = "const {createRequire}=require('node:module');const r=createRequire(require.resolve('electron-builder/package.json'));r('app-builder-lib/out/toolsets/7zip.js').getPath7za().then(p=>console.log(p));"
    tool = Path(native.command([workspace.node_path(), "-e", code], capture=True).splitlines()[-1])
    require(
        tool.is_file()
        and tool.resolve() == tool
        and tool.is_relative_to(ROOT / ".cache/quality-builder"),
        "Use the locked builder's private archive tool.",
    )
    budgets = json.loads((ROOT / "config/desktop/resource-policy.json").read_text())["budgets"]
    outer = archive_listing(tool, file, budgets, native)
    entries = validate_entries(
        outer, budgets["update_expanded_bytes"]["value"], budgets["update_archive_entries"]["value"]
    )
    require(
        "resources\\app\\package.json" in entries or "resources/app/package.json" in entries,
        "Missing embedded native application.",
    )
    native.command([tool, "x", "-y", "-bd", file, "-o" + str(destination)])
    return destination


def expected(file, cell, native):
    with tempfile.TemporaryDirectory(prefix="ohtia-expected-") as temporary:
        root = Path(temporary).resolve() / "payload"
        archive_payload(file, root, native)
        require(
            desktop_runtime.architecture(root / "ohtia-quality.exe") == "x64", "Wrong NSIS CPU."
        )
        require(
            desktop_runtime.architecture(root / "resources/app/native/binding.node") == "x64",
            "Wrong Windows addon CPU.",
        )
        return (
            file_tree(root),
            (root / "resources/app/migrations/manifest.json").read_bytes(),
            json.loads((root / "resources/app/package.json").read_text()),
        )


def prepare(args, native):
    windows_contributor.preflight()
    profile = json.loads(
        native.command(
            [
                workspace.node_path(),
                "tooling/installation-profile.mjs",
                "--inspect-profile",
                args.runtime_profile,
            ],
            capture=True,
        )
    )
    cell = read_json(args.cell)
    require(
        cell["target"] == profile["target"] == workspace.target_id() == "win32-x64"
        and cell["profile"] == "windows-11-25h2"
        and cell["formats"] == ["nsis"],
        "Wrong Windows native context.",
    )
    record = read_json(args.staged)
    native.check_installation_admission(record, profile)
    file = native.verify_staged(record)
    inventory, manifest, metadata = expected(file, cell, native)
    require(
        metadata["name"] == "ohtia-quality" and metadata["version"] == record["version"],
        "Wrong Windows package identity.",
    )
    require(
        len(json.loads(manifest)) == record["entry"]["schema"]["target"]
        and hashlib.sha256(manifest).hexdigest() == record["migration_manifest_sha256"],
        "Windows migration contract changed.",
    )
    destination = args.destination
    require(
        destination.is_absolute()
        and destination.resolve() == destination
        and destination.is_relative_to(Path(profile["scratch_root"])),
        "Use this Windows fixture installation.",
    )
    require(
        args.output.is_absolute()
        and args.output.parent.resolve() == args.output.parent
        and args.output.is_relative_to(Path(profile["scratch_root"]))
        and not args.output.exists(),
        "Use a fresh Windows receipt inside inspected scratch.",
    )
    checkpoint_file = args.output.parent / ("windows-pending-" + record["sha256"] + ".json")
    before = native.store_snapshot(profile)
    require(
        before == record["admission"].get("source_store"),
        "Store changed since semantic Windows preflight; refuse installation.",
    )
    if checkpoint_file.exists():
        checkpoint = read_json(checkpoint_file)
        require(
            checkpoint["kind"] == "unchanged-verified-store"
            and checkpoint["sha256"] == record["sha256"]
            and checkpoint["destination"] == str(destination)
            and checkpoint["store"] == before,
            "Windows pending candidate or store changed.",
        )
        require(
            checkpoint["current"]["schema"] == record["admission"]["source_schema"]
            and checkpoint["current"]["installed_version"]
            == record["admission"]["installed_version"],
            "Windows resumed pre-transition contract changed.",
        )
    else:
        require(not destination.exists(), "Preserve an unrelated existing installation.")
        checkpoint = {
            "kind": "unchanged-verified-store",
            "sha256": record["sha256"],
            "destination": str(destination),
            "store": before,
            "current": {
                "schema": record["admission"]["source_schema"],
                "installed_version": record["admission"]["installed_version"],
            },
            "phase": "requested",
        }
        publish(checkpoint_file, checkpoint)
    already_active = checkpoint["phase"] == "settled"
    if already_active:
        native.assert_quiescent(destination)
        require(
            file_tree(destination) == inventory and native.store_snapshot(profile) == before,
            "Settled Windows installation changed.",
        )
        result = {"activation": "already-active"}
    else:
        previous = record["admission"].get("installed_directory")
        if previous:
            previous = Path(previous)
            require(
                previous.resolve() == previous
                and previous.is_relative_to(Path(profile["scratch_root"])),
                "Foreign previous Windows installation.",
            )
            native.assert_quiescent(previous)
        if destination.exists():
            native.assert_quiescent(destination)
        retained = destination if destination.exists() else previous
        if retained and retained.exists():
            import uuid

            backup = destination.with_name(destination.name + ".retained-" + uuid.uuid4().hex)
            shutil.copytree(retained, backup)
            require(
                file_tree(backup) == file_tree(retained),
                "Previous Windows payload changed during preservation.",
            )
        check_registration(previous, destination)
        native.check_installation_admission(record, profile)
        require(
            native.store_snapshot(profile) == before, "Store changed before Windows installation."
        )
        result = quality_native.run_owned(
            nsis_command(file, destination),
            ROOT,
            quality_native.build_environment(),
            300,
            5,
        )
        require(
            result["exit_code"] == 0
            and not result["timed_out"]
            and not result["contained_processes_remaining_at_exit"]
            and not result.get("contained_processes_remaining_after_cleanup", False),
            "Windows installer failed or process cessation unconfirmed; retain the installation and acceptance floor.",
        )
        require(
            native.store_snapshot(profile) == before,
            "Installer changed synthetic store before admission.",
        )
        require(
            file_tree(destination) == inventory,
            "Installed Windows bytes differ from admitted package.",
        )
        checkpoint["phase"] = "settled"
        publish(checkpoint_file, checkpoint)
    prepared = quality_native.prepared_record(destination, cell)
    (destination / "prepared.json").write_text(json.dumps(prepared) + "\n")
    args.output.write_text(
        json.dumps(
            {
                "status": "passed",
                "sha256": record["sha256"],
                "version": record["version"],
                "prepared_directory": str(destination),
                "native": result,
            }
        )
        + "\n"
    )


def reconcile(directory, evidence, native):
    """Keep an exclusive native guard alive in both parent and metadata child."""
    from ctypes import wintypes as w

    desktop_probes.real_directory(str(directory))
    k = c.WinDLL("kernel32", use_last_error=True)

    class Security(c.Structure):
        _fields_ = [("length", w.DWORD), ("descriptor", c.c_void_p), ("inherit", w.BOOL)]

    security = Security(c.sizeof(Security), None, True)
    k.CreateFileW.argtypes = [
        w.LPCWSTR,
        w.DWORD,
        w.DWORD,
        c.POINTER(Security),
        w.DWORD,
        w.DWORD,
        w.HANDLE,
    ]
    k.CreateFileW.restype = w.HANDLE
    k.CloseHandle.argtypes = [w.HANDLE]
    handle = k.CreateFileW(
        str(directory / "reconciliation.guard"),
        0xC0000000,
        0,
        c.byref(security),
        4,
        0x00200000,
        None,
    )
    if handle == w.HANDLE(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        require(
            lease_status(directory / "operation.lock")["status"] == "ceased",
            "Windows lease owner is still live.",
        )
        checksum = native.digest(directory / "operation.lock")
        startup = subprocess.STARTUPINFO()
        startup.lpAttributeList = {"handle_list": [int(handle)]}
        result = subprocess.run(
            [
                str(workspace.node_path()),
                str(ROOT / "tooling/installation-reconcile.mjs"),
                str(directory),
                str(evidence),
                checksum,
            ],
            cwd=ROOT,
            env=quality_native.build_environment(),
            startupinfo=startup,
            close_fds=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
            timeout=30,
        )
        require(
            native.digest(directory / "operation.lock") == checksum
            and lease_status(directory / "operation.lock")["status"] == "ceased",
            "Windows retained lease changed during reconciliation.",
        )
        import uuid

        decoded = json.loads(result.stdout)
        require(decoded["status"] == "reconciled", "Incomplete Windows reconciliation.")
        (directory / "operation.lock").rename(
            directory / ("operation-reconciled-" + uuid.uuid4().hex + ".json")
        )
        return decoded
    finally:
        k.CloseHandle(handle)


def publish(file, value):
    import uuid

    temporary = file.with_name(file.name + "." + uuid.uuid4().hex + ".partial")
    with temporary.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(value) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(file)


def inspect_baseline(args, native):
    profile = json.loads(
        native.command(
            [
                workspace.node_path(),
                "tooling/installation-profile.mjs",
                "--inspect-profile",
                args.runtime_profile,
            ],
            capture=True,
        )
    )
    directory = Path(profile["scratch_root"]) / "update-acceptance"
    created = not directory.exists()
    if created:
        directory.mkdir(mode=0o700)
    try:
        native.inspect_baseline(
            args.runtime_profile,
            args.cell,
            args.archive,
            args.payload,
            args.output,
            args.expected_sha256,
        )
    finally:
        # Only our newly created, still-empty container can disappear. Existing
        # missing-floor state is never reset or reinterpreted as a fresh campaign.
        if created and directory.exists() and not any(directory.iterdir()):
            directory.rmdir()


def archive_listing(tool, file, budgets, native):
    import concurrent.futures

    child = subprocess.Popen(
        [str(tool), "l", "-slt", "-ba", "-sccUTF-8", str(file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=quality_native.build_environment(),
    )

    def bounded():
        data = bytearray()
        while True:
            block = child.stdout.read(4096)
            if not block:
                break
            data.extend(block)
            require(
                len(data) <= budgets["update_archive_listing_bytes"]["value"],
                "Archive listing exceeded its bound.",
            )
        return bytes(data).decode("utf-8")

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(bounded)
        try:
            result = future.result(timeout=30)
            require(child.wait(timeout=5) == 0, "Native archive inspection failed.")
            return result
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()
            child.stdout.close()


def nsis_command(file, destination):
    # NSIS requires an unquoted /D= tail, including paths with spaces. No shell is used.
    require(not any(ch in str(destination) for ch in '\r\n\0"'), "Invalid NSIS destination.")
    return subprocess.list2cmdline([str(file), "/S"]) + " /D=" + str(destination)


def registered_installations():
    import uuid
    import winreg

    # The locked builder derives this registry identity from the quality app ID.
    guid = str(uuid.uuid5(uuid.UUID("50e065bc-3134-11e6-9bab-38c9862bdaf3"), "org.ohtia.quality"))
    result = []
    for hive, scope in ((winreg.HKEY_CURRENT_USER, "user"), (winreg.HKEY_LOCAL_MACHINE, "machine")):

        def read(key, name):
            try:
                handle = winreg.OpenKey(hive, key, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY)
            except FileNotFoundError:
                return None
            with handle:
                try:
                    value, kind = winreg.QueryValueEx(handle, name)
                except FileNotFoundError:
                    raise ValueError(
                        "Existing NSIS registration lacks a required value; preserve it."
                    ) from None
                require(
                    kind == winreg.REG_SZ and isinstance(value, str) and value,
                    "Invalid NSIS registration.",
                )
                return value

        location = read("Software\\" + guid, "InstallLocation")
        uninstall = read(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + guid, "UninstallString"
        )
        if location is not None or uninstall is not None:
            require(
                location is not None and uninstall is not None,
                "Incomplete NSIS registration; preserve it.",
            )
            result.append({"scope": scope, "location": location, "uninstall": uninstall})
    return result


def check_registration(previous, destination):
    permitted = {destination}
    if previous is not None:
        permitted.add(previous)
    for item in registered_installations():
        location = Path(item["location"])
        require(
            item["scope"] == "user"
            and location in permitted
            and location.resolve() == location
            and item["uninstall"]
            == '"' + str(location / "Uninstall ohtia-quality.exe") + '" /currentuser',
            "Preserve an unrelated or ambiguous registered NSIS installation; inspect it explicitly before continuing.",
        )
