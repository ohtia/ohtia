"""Verify package construction constraints without impersonating native execution."""

from __future__ import annotations

import ctypes
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_delivery as delivery
import quality_native as native
import quality_processes as observer


class NativeTests(unittest.TestCase):
    def test_windows_powershell_round_trips_non_ascii_json(self):
        expected = {"path": "C:/ohtia é/研究/ohtia.exe"}
        script = (
            "[PSCustomObject]@{path=('C:/ohtia '+[char]233+'/'"
            "+[char]0x7814+[char]0x7a76+'/ohtia.exe')} | ConvertTo-Json -Compress"
        )
        with patch.object(
            native.subprocess,
            "run",
            return_value=SimpleNamespace(stdout=json.dumps(expected, ensure_ascii=False)),
        ) as run:
            self.assertEqual(json.loads(native.powershell(script)), expected)
        self.assertEqual(run.call_args.kwargs["encoding"], "utf-8")
        self.assertTrue(run.call_args.kwargs["capture_output"])
        self.assertIn("[Console]::OutputEncoding", run.call_args.args[0][-1])
        if os.name == "nt":
            self.assertEqual(json.loads(native.powershell(script)), expected)

    def test_local_accounts_never_become_automatic_hosted_fixtures(self):
        cell = delivery.cells(delivery.read(delivery.ROOT / "config/desktop/targets.json"))[0]
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(delivery.DeliveryError, "GitHub-hosted"):
                native.host_matches(cell)

    def test_host_target_mismatch_fails_before_native_launch(self):
        cell = delivery.cells(delivery.read(delivery.ROOT / "config/desktop/targets.json"))[0]
        with (
            patch.dict(
                os.environ, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted"}
            ),
            patch.object(native.workspace, "target_id", return_value="wrong"),
        ):
            with self.assertRaisesRegex(delivery.DeliveryError, "OS/CPU"):
                native.host_matches(cell)

    def test_build_and_product_children_inherit_no_authority_credentials(self):
        with patch.dict(
            os.environ,
            {
                "GH_TOKEN": "private",
                "CSC_KEY_PASSWORD": "private",
                "APPLE_ID": "private",
                "AWS_SECRET_ACCESS_KEY": "private",
                "NODE_OPTIONS": "--require=private",
                "ELECTRON_RUN_AS_NODE": "1",
            },
        ):
            env = native.build_environment()
            for key in (
                "GH_TOKEN",
                "CSC_KEY_PASSWORD",
                "APPLE_ID",
                "AWS_SECRET_ACCESS_KEY",
                "NODE_OPTIONS",
                "ELECTRON_RUN_AS_NODE",
            ):
                self.assertNotIn(key, env)
            self.assertEqual(env["CSC_IDENTITY_AUTO_DISCOVERY"], "false")
            for spelling in ("SystemDrive", "SYSTEMDRIVE"):
                with (
                    self.subTest(system_drive_key=spelling),
                    patch.dict(os.environ, {spelling: "Z:"}, clear=True),
                ):
                    forwarded = native.build_environment()
                    self.assertEqual(
                        forwarded.get("SystemDrive", forwarded.get("SYSTEMDRIVE")), "Z:"
                    )

        # Exercise the real launcher environment boundary, not native Windows execution.
        script = """
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {admittedLaunch} from './tooling/desktop-launch.mjs';
const root = fs.realpathSync.native(process.argv[1]);
const home = path.join(root,'home');
const configuration = path.join(home,'AppData','Roaming');
const research = path.join(home,'ohtia');
const scratch = path.join(home,'scratch');
for(const directory of [configuration,research,scratch]) fs.mkdirSync(directory,{recursive:true,mode:0o700});
const stable_roots = {};
for(const name of ['configuration','store','recovery']) {
  const directory = path.join(root,'stable-'+name);
  fs.mkdirSync(directory,{mode:0o700});
  const bytes = Buffer.from('Synthetic unchanged sentinel');
  fs.writeFileSync(path.join(directory,'.ohtia-runtime-sentinel'),bytes);
  stable_roots[name] = {root:directory,sentinel_sha256:createHash('sha256').update(bytes).digest('hex')};
}
Object.defineProperty(process,'platform',{value:'win32'});
os.userInfo = () => ({username:'synthetic',homedir:home});
const target = 'win32-'+process.arch;
const profile = {
  schema_version:1,kind:'independent-native-profile',inspected_by:'agent:synthetic-fixture',
  username:'synthetic',target,home,configuration_root:configuration,research_root:research,
  scratch_root:scratch,stable_roots,
  manual_checks:Object.fromEntries(['independent_account_or_vm','no_emulation',
    'local_owned_unsynchronized_volumes','no_credentials','stable_roots_complete',
    'native_security_and_display'].map(key=>[key,true]))
};
const file = path.join(scratch,'runtime-profile.json');
fs.writeFileSync(file,JSON.stringify(profile));
const prepared = path.join(root,'prepared');fs.mkdirSync(prepared);
fs.writeFileSync(path.join(prepared,'prepared.json'),JSON.stringify({
  version:1,target,executable:'runtime.exe',app:'app',files:{},links:{}
}));
process.env.SystemDrive = 'Z:';
process.env.AWS_SECRET_ACCESS_KEY = 'synthetic-unforwarded';
const launch = admittedLaunch(file,prepared);
assert.equal(launch.env.SystemDrive,'Z:');
assert.equal(launch.env.AWS_SECRET_ACCESS_KEY,undefined);
for(const invalid of [undefined,'','%SystemDrive%',
  'Z:'+path.win32.sep, path.win32.join('Z:'+path.win32.sep,'Windows')]) {
  if(invalid === undefined) delete process.env.SystemDrive;
  else process.env.SystemDrive = invalid;
  assert.throws(()=>admittedLaunch(file,prepared),/system-drive identity/);
}
"""
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run(
                [str(native.workspace.node_path()), "--input-type=module", "-e", script, temporary],
                cwd=delivery.ROOT,
                check=True,
                capture_output=True,
                timeout=60,
            )

    def test_declared_formats_use_unsigned_offline_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "prepared.json").write_text(json.dumps({"app": "runtime/resources/app"}))
            for cell in delivery.cells(
                delivery.read(delivery.ROOT / "config/desktop/targets.json")
            ):
                config = native.configuration(cell, root, root / "output", "0.0.0-dev.123.2")
                self.assertIsNone(config["publish"])
                self.assertFalse(config["win"]["signAndEditExecutable"])
                self.assertFalse(config["nsis"]["perMachine"])
                self.assertFalse(config["nsis"]["allowElevation"])
                self.assertFalse(config["mac"]["notarize"])
                self.assertEqual(config["mac"]["identity"], "-")
                for key in ("afterInstall", "afterRemove"):
                    self.assertTrue(
                        config["deb"][key].startswith(
                            str(native.ROOT / "tooling/quality-packaging")
                        )
                    )
                self.assertEqual(config["extraMetadata"]["version"], "0.0.0-dev.123.2")
                self.assertNotIn("update", json.dumps(config).lower())

    def test_native_header_mismatch_refuses_smoke(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(native.sys, "platform", "linux"),
            patch.object(native.desktop_runtime, "architecture", return_value="arm64"),
        ):
            with self.assertRaisesRegex(delivery.DeliveryError, "CPU mismatch"):
                native.prepared_record(Path(directory), {"target": "linux-x64"})

    def test_linux_metadata_passes_the_pinned_packager_semantics(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "prepared.json").write_text(json.dumps({"app": "runtime/resources/app"}))
            cells = delivery.cells(delivery.read(delivery.ROOT / "config/desktop/targets.json"))
            configs = [
                native.configuration(c, root, root / "output", "0.0.0-dev.123.2")
                for c in cells
                if c["target"].startswith("linux-")
            ]
            script = """
const {createRequire} = require('node:module');
const resolve = createRequire(require.resolve('electron-builder/package.json'));
const FpmTarget = resolve('app-builder-lib/out/targets/FpmTarget.js').default;
const configs = JSON.parse(process.argv[1]);
async function validate(config, format) {
  return FpmTarget.prototype.computeFpmMetaInfoOptions.call({
    options: config[format],
    packager: {
      appInfo: { computePackageUrl: async () => config.extraMetadata.homepage,
                 linuxPackageName: config.extraMetadata.name },
      info: { metadata: config.extraMetadata }
    }
  });
}
(async () => {
  for (const config of configs)
    for (const format of config.linux.target) await validate(config, format);
  const broken = structuredClone(configs.find(c => c.linux.target.includes('rpm')));
  delete broken.rpm.maintainer;
  let rejected = false;
  try { await validate(broken, 'rpm'); }
  catch (error) { rejected = error.message.includes("author 'email'"); }
  if (!rejected) throw Error('Missing RPM maintainer was not rejected');
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
            subprocess.run(
                [str(native.workspace.node_path()), "-e", script, json.dumps(configs)],
                cwd=delivery.ROOT,
                check=True,
                capture_output=True,
                timeout=60,
            )

    def test_windows_observes_restricted_low_integrity_tokens_without_appcontainer(self):
        from ctypes import wintypes as w

        for restricted, rid, accepted in [
            (True, 0, True),
            (True, 0x1000, True),
            (True, 0x2000, False),
            (False, 0, False),
        ]:
            with self.subTest(restricted=restricted, integrity=rid):
                kernel = SimpleNamespace(
                    OpenProcess=Mock(return_value=1),
                    CloseHandle=Mock(),
                    QueryFullProcessImageNameW=Mock(),
                    GetProcessTimes=Mock(),
                )
                security = SimpleNamespace(
                    OpenProcessToken=Mock(),
                    IsTokenRestricted=Mock(return_value=restricted),
                    GetTokenInformation=Mock(),
                    GetSidSubAuthorityCount=Mock(return_value=ctypes.pointer(w.BYTE(1))),
                    GetSidSubAuthority=Mock(return_value=ctypes.pointer(w.DWORD(rid))),
                )

                def open_token(handle, access, output):
                    ctypes.cast(output, ctypes.POINTER(w.HANDLE)).contents.value = 2
                    return True

                def information(token, kind, buffer, size, length):
                    self.assertEqual(kind, 25)
                    ctypes.cast(length, ctypes.POINTER(w.DWORD)).contents.value = 64
                    if buffer is None:
                        return False
                    ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p)).contents.value = 123
                    return True

                def image(handle, flags, buffer, length):
                    buffer.value = "/synthetic/package/ohtia.exe"
                    return True

                def times(handle, created, *_unused):
                    ticks = (11644473600000000 + 1793273211225933) * 10 + 9
                    value = ctypes.cast(created, ctypes.POINTER(w.FILETIME)).contents
                    value.dwLowDateTime = ticks & 0xFFFFFFFF
                    value.dwHighDateTime = ticks >> 32
                    return True

                kernel.GetProcessTimes.side_effect = times
                kernel.QueryFullProcessImageNameW.side_effect = image
                security.OpenProcessToken.side_effect = open_token
                security.GetTokenInformation.side_effect = information
                with (
                    patch.object(
                        native.ctypes,
                        "WinDLL",
                        create=True,
                        side_effect=lambda name, **kw: kernel if name == "kernel32" else security,
                    ),
                    patch.object(native.sys, "platform", "win32"),
                    patch.object(
                        native,
                        "command",
                        return_value=json.dumps(
                            [
                                {
                                    "ProcessId": 100,
                                    "ExecutablePath": "/synthetic/package/ohtia.exe",
                                    "CommandLine": "ohtia.exe --type=renderer",
                                }
                            ]
                        ),
                    ),
                ):
                    observed = native.processes(
                        Path("/synthetic/package"),
                        [{"pid": 100, "renderer": True, "creation_time_ms": 1793273211225.933}],
                        ready_only=True,
                    )[0]
                self.assertEqual(observed["sandbox"], accepted)
                self.assertEqual(observed["token"]["integrity_rid"], rid)
                self.assertEqual(observed["token"]["restricted"], restricted)
                self.assertEqual(kernel.CloseHandle.call_count, 2)

    def test_ready_windows_renderers_do_not_wait_for_cim_enumeration(self):
        observed = {"query_status": "observed", "restricted": True, "integrity_rid": 0}
        directory = Path("/synthetic/package")
        with (
            patch.object(native.sys, "platform", "win32"),
            patch.object(native, "command", side_effect=AssertionError("Unexpected CIM query")),
            patch.object(native, "windows_token", return_value=observed) as query,
        ):
            rows = native.processes(
                directory,
                [
                    {"pid": 100, "renderer": False},
                    {"pid": 101, "renderer": True, "creation_time_ms": 123.5},
                ],
                ready_only=True,
            )
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["pid"], 101)
            self.assertTrue(rows[0]["sandbox"])
            query.assert_called_once_with(101, directory, 123.5)
            self.assertEqual(native.processes(directory, [], ready_only=True), [])

    def test_ready_windows_token_query_rejects_unverified_package_images(self):
        from ctypes import wintypes as w

        for image_ok, path, expected in [
            (False, "", "image_query_failed"),
            (True, "/synthetic/foreign/exe", "image_mismatch"),
            (True, "/synthetic/package/exe", "open_token_failed"),
            (True, "/synthetic/package/exe", "identity_mismatch"),
            (True, "/synthetic/package/exe", "creation_query_failed"),
            (True, "/synthetic/package/exe", "creation_identity_missing"),
        ]:
            with self.subTest(image_ok=image_ok, image=path):
                kernel = SimpleNamespace(
                    OpenProcess=Mock(return_value=1),
                    CloseHandle=Mock(),
                    QueryFullProcessImageNameW=Mock(),
                    GetProcessTimes=Mock(),
                )
                security = SimpleNamespace(
                    OpenProcessToken=Mock(return_value=False),
                    IsTokenRestricted=Mock(),
                    GetTokenInformation=Mock(),
                    GetSidSubAuthorityCount=Mock(),
                    GetSidSubAuthority=Mock(),
                )

                def image(handle, flags, buffer, size):
                    self.assertEqual((handle, flags), (1, 0))
                    self.assertEqual(
                        ctypes.cast(size, ctypes.POINTER(w.DWORD)).contents.value, 32768
                    )
                    buffer.value = path
                    return image_ok

                def times(handle, created, *_unused):
                    ticks = (11644473600000000 + 1793273211225933) * 10 + 9
                    value = ctypes.cast(created, ctypes.POINTER(w.FILETIME)).contents
                    value.dwLowDateTime = ticks & 0xFFFFFFFF
                    value.dwHighDateTime = ticks >> 32
                    return expected != "creation_query_failed"

                kernel.GetProcessTimes.side_effect = times
                kernel.QueryFullProcessImageNameW.side_effect = image
                with patch.object(
                    native.ctypes,
                    "WinDLL",
                    create=True,
                    side_effect=lambda name, **kw: kernel if name == "kernel32" else security,
                ):
                    expected_time = (
                        None
                        if expected == "creation_identity_missing"
                        else 1793273212225.933
                        if expected == "identity_mismatch"
                        else 1793273211225.933
                    )
                    result = native.windows_token(101, Path("/synthetic/package"), expected_time)
                self.assertEqual(result["query_status"], expected)
                self.assertFalse(result["restricted"])
                self.assertIsNone(result["integrity_rid"])
                kernel.OpenProcess.assert_called_once_with(0x1000, False, 101)
                kernel.CloseHandle.assert_called_once_with(1)
                self.assertEqual(
                    security.OpenProcessToken.call_count, int(expected == "open_token_failed")
                )

    def test_windows_reused_pid_is_excluded_but_unknown_live_queries_fail(self):
        for status, expected in [
            ("identity_mismatch", []),
            ("image_mismatch", [False]),
            ("creation_query_failed", [False]),
            ("creation_identity_missing", [False]),
            ("open_token_failed", [False]),
        ]:
            with (
                self.subTest(status=status),
                patch.object(native.sys, "platform", "win32"),
                patch.object(native, "windows_token", return_value={"query_status": status}),
                patch.object(native, "process_exited", return_value=False) as exited,
            ):
                rows = native.processes(
                    Path("/synthetic/package"),
                    [{"pid": 101, "renderer": True, "creation_time_ms": 123.5}],
                    ready_only=True,
                )
                self.assertEqual([row["sandbox"] for row in rows], expected)
                self.assertEqual(exited.call_count, 0 if status == "identity_mismatch" else 1)

    def test_atomic_ready_report_replacement_has_a_finite_retry_budget(self):
        script = """
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {recordReadyNativeProcesses} from './tooling/desktop-native-observation.mjs';
Object.defineProperty(process, 'platform', {value:'win32'});
const app = {evaluate: async callback => callback({app: {
  getAppMetrics: () => [{pid:process.pid, type:'Tab', creationTime:123.5}]
}})};
const original = fs.renameSync;
let calls = 0;
fs.renameSync = (...args) => {
  calls++;
  if(calls < 3) throw Object.assign(new Error('Synthetic sharing violation'), {code:'EPERM'});
  return original(...args);
};
await recordReadyNativeProcesses(app, process.argv[1]);
assert.equal(calls,3);
const file = process.argv[1] + '/native-processes.json';
const before = fs.readFileSync(file,'utf8');
assert.equal(JSON.parse(before).processes[0].creation_time_ms,123.5);
calls = 0;
fs.renameSync = () => { calls++; throw Object.assign(new Error('Synthetic busy file'), {code:'EBUSY'}); };
await assert.rejects(recordReadyNativeProcesses(app, process.argv[1]), {code:'EBUSY'});
assert.equal(calls,5);
assert.equal(fs.readFileSync(file,'utf8'),before);
calls = 0;
fs.renameSync = () => { calls++; throw Object.assign(new Error('Synthetic disk error'), {code:'EIO'}); };
await assert.rejects(recordReadyNativeProcesses(app, process.argv[1]), {code:'EIO'});
assert.equal(calls,1);
fs.renameSync = original;
"""
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run(
                [str(native.workspace.node_path()), "--input-type=module", "-e", script, temporary],
                cwd=delivery.ROOT,
                check=True,
                capture_output=True,
                timeout=60,
            )

    def test_linux_identity_is_bound_to_process_start_time(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "package"
            package.mkdir()
            foreign = root / "unrelated"
            foreign.touch()
            proc = root / "proc"
            entry = proc / "123"
            entry.mkdir(parents=True)
            (entry / "exe").symlink_to(foreign)
            (entry / "stat").write_text("123 (renderer with spaces) S " + "0 " * 18 + "700 0\n")
            (entry / "status").write_text("State: S\nNSpid: 123 1\nSeccomp: 2\nNoNewPrivs: 1\n")
            known = [{"pid": 123, "renderer": True, "start_time": "700"}]
            self.assertTrue(observer.observe(package, known, proc)[0]["sandbox"])
            known[0]["start_time"] = "699"
            self.assertEqual(observer.observe(package, known, proc), [])

    def test_macos_sandbox_query_errors_and_allowances_do_not_pass(self):
        for decision in (-1, 0, 1):
            for exited in (False, True):
                library = SimpleNamespace(sandbox_check=Mock(return_value=decision))
                with (
                    patch.object(native.sys, "platform", "darwin"),
                    patch.object(native.ctypes, "CDLL", return_value=library),
                    patch.object(native, "process_exited", return_value=exited),
                    patch.object(
                        native, "command", return_value="100 /synthetic/app/helper --type=renderer"
                    ),
                ):
                    rows = native.processes(PurePosixPath("/synthetic/app"))
                if decision < 0 and exited:
                    self.assertEqual(rows, [])
                else:
                    self.assertEqual(rows[0]["sandbox"], decision == 1)
                    self.assertEqual(rows[0]["seatbelt_process_fork"], decision)

    def test_failed_renderer_query_is_ignored_only_after_confirmed_exit(self):
        for system in ("win32", "darwin"):
            for exited in (False, True):
                library = SimpleNamespace(sandbox_check=Mock(return_value=-1))
                output = (
                    json.dumps(
                        [
                            {
                                "ProcessId": 100,
                                "ExecutablePath": "/synthetic/app/exe",
                                "CommandLine": "exe --type=renderer",
                            }
                        ]
                    )
                    if system == "win32"
                    else "100 /synthetic/app/exe --type=renderer"
                )
                with (
                    patch.object(native.sys, "platform", system),
                    patch.object(native, "command", return_value=output),
                    patch.object(native.ctypes, "CDLL", return_value=library),
                    patch.object(
                        native,
                        "windows_token",
                        return_value={"query_status": "open_process_failed"},
                    ),
                    patch.object(native, "process_exited", return_value=exited),
                ):
                    rows = native.processes(
                        PurePosixPath("/synthetic/app"),
                        [{"pid": 100, "renderer": True}],
                        ready_only=True,
                    )
                    self.assertEqual(len(rows), 0 if exited else 1)
                    if rows:
                        self.assertFalse(rows[0]["sandbox"])
                    # Unknown startup renderers are excluded from sampling, not from final ownership checks.
                    self.assertEqual(
                        native.processes(PurePosixPath("/synthetic/app"), [], ready_only=True), []
                    )

    def test_process_exit_probe_retains_access_failures_and_live_processes(self):
        from ctypes import wintypes as w

        for code, expected in [(259, False), (0, True), (42, True)]:
            kernel = SimpleNamespace(
                OpenProcess=Mock(return_value=1), CloseHandle=Mock(), GetExitCodeProcess=Mock()
            )

            def exit_code(handle, pointer):
                ctypes.cast(pointer, ctypes.POINTER(w.DWORD)).contents.value = code
                return True

            kernel.GetExitCodeProcess.side_effect = exit_code
            with (
                patch.object(native.sys, "platform", "win32"),
                patch.object(native.ctypes, "WinDLL", create=True, return_value=kernel),
            ):
                self.assertEqual(native.process_exited(123), expected)
        for error, expected in [(87, True), (5, False)]:
            kernel.OpenProcess.return_value = 0
            with (
                patch.object(native.sys, "platform", "win32"),
                patch.object(native.ctypes, "WinDLL", create=True, return_value=kernel),
                patch.object(native.ctypes, "get_last_error", create=True, return_value=error),
            ):
                self.assertEqual(native.process_exited(123), expected)
        for code, state, expected in [(1, "", True), (0, "S", False), (0, "Z", True)]:
            with (
                patch.object(native.sys, "platform", "darwin"),
                patch.object(
                    native.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], code, state, ""),
                ),
            ):
                self.assertEqual(native.process_exited(123), expected)

        with (
            patch.object(native.sys, "platform", "darwin"),
            patch.object(
                native.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 1, "", "denied"),
            ),
        ):
            with self.assertRaises(delivery.DeliveryError):
                native.process_exited(123)

    def test_ready_process_producer_publishes_complete_atomic_linux_identity(self):
        if sys.platform != "linux":
            self.skipTest("Linux proc identity producer fixture")
        with tempfile.TemporaryDirectory() as temporary:
            script = """
import {recordReadyNativeProcesses} from './tooling/desktop-native-observation.mjs';
await recordReadyNativeProcesses({evaluate: async callback => callback({app: {
  getAppMetrics: () => [{pid:process.pid, type:'Tab'}]
}})}, process.argv[1]);
"""
            subprocess.run(
                [str(native.workspace.node_path()), "--input-type=module", "-e", script, temporary],
                cwd=delivery.ROOT,
                check=True,
                capture_output=True,
                timeout=60,
            )
            records = json.loads((Path(temporary) / "native-processes.json").read_text())[
                "processes"
            ]
            self.assertEqual(len(records), 1)
            self.assertTrue(records[0]["renderer"])
            self.assertTrue(records[0]["start_time"].isdecimal())
            self.assertEqual({p.name for p in Path(temporary).iterdir()}, {"native-processes.json"})
            retained = Path(temporary) / "retained"
            native.retain_failed_reports(Path(temporary), retained)
            self.assertEqual(
                delivery.read(retained / "native-processes.json")["processes"], records
            )
            self.assertFalse((retained / "retention-issues.json").exists())

    def test_final_process_history_retains_only_live_start_bound_identities(self):
        known = [{"pid": pid, "renderer": True, "start_time": str(pid)} for pid in range(1, 301)]
        with (
            patch.object(native.sys, "platform", "linux"),
            patch.object(
                native.process_observer, "same_process", side_effect=lambda row: row["pid"] == 300
            ),
            patch.object(native, "command", return_value="[]") as command,
        ):
            self.assertEqual(native.processes(Path("/synthetic/package"), known), [])
            self.assertEqual(json.loads(command.call_args.args[0][-1]), [known[-1]])

    def test_macos_filesystem_queries_the_containing_device_and_binds_the_result(self):
        home = Path("/Users/runner")
        listing = "Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 100 40 60 40% /System/Volumes/Data\n"
        info = plistlib.dumps({"DeviceNode": "/dev/disk3s5", "FilesystemType": "apfs"}).decode()
        with patch.object(native, "command", side_effect=[listing, info]) as command:
            self.assertEqual(native.macos_filesystem(home), "apfs")
            self.assertEqual(command.call_args_list[0].args[0], ["/bin/df", "-P", home])
            self.assertEqual(
                command.call_args_list[1].args[0],
                ["/usr/sbin/diskutil", "info", "-plist", "/dev/disk3s5"],
            )
        wrong = plistlib.dumps({"DeviceNode": "/dev/disk9s1", "FilesystemType": "apfs"}).decode()
        with patch.object(native, "command", side_effect=[listing, wrong]):
            with self.assertRaises(delivery.DeliveryError):
                native.macos_filesystem(home)
        with patch.object(
            native,
            "command",
            return_value="Filesystem Blocks Used Free Capacity Mounted on\nremote:/share 100 40 60 40% /Users\n",
        ):
            with self.assertRaises(delivery.DeliveryError):
                native.macos_filesystem(home)

        for record in (
            [],
            {"DeviceNode": "/dev/disk3s5"},
            {"DeviceNode": "/dev/disk3s5", "FilesystemType": 42},
        ):
            with patch.object(
                native, "command", side_effect=[listing, plistlib.dumps(record).decode()]
            ):
                with self.assertRaises(delivery.DeliveryError):
                    native.macos_filesystem(home)
        with patch.object(native, "command", return_value="Filesystem\n"):
            with self.assertRaises(delivery.DeliveryError):
                native.macos_filesystem(home)

    def test_stable_fixtures_use_external_temp_without_weakening_native_admission(self):
        script = r"""
import assert from 'node:assert/strict';
import path from 'node:path';
import {selectStableTemporaryParent} from './tooling/quality-fixture-paths.mjs';
import {admitRuntimeProfile} from './packages/contracts/dist/index.js';
const home='C:\\Users\\runneradmin';
const contains=(a,b)=>{const r=path.win32.relative(a,b);return r===''||(!path.win32.isAbsolute(r)&&r!=='..'&&!r.startsWith('..\\'));};
const host={username:'runneradmin',target:'win32-x64',home,
configurationRoot:path.win32.join(home,'AppData','Roaming'), researchRoot:path.win32.join(home,'ohtia'),
canonical:p=>p,contains,owned:()=>true};
const inside=path.win32.join(home,'AppData','Local','Temp');
const outside='D:\\a\\_temp';
const profile={schema_version:1,kind:'independent-native-profile',inspected_by:'agent:github-actions',
username:host.username,target:host.target,home,configuration_root:host.configurationRoot,
research_root:host.researchRoot,scratch_root:path.win32.join(home,'.quality-scratch'),
stable_roots:Object.fromEntries(['configuration','store','recovery'].map(role=>[role,{root:path.win32.join(inside,role),sentinel_sha256:'a'.repeat(64)}])),
manual_checks:Object.fromEntries(['independent_account_or_vm','no_emulation','local_owned_unsynchronized_volumes','no_credentials','stable_roots_complete','native_security_and_display'].map(key=>[key,true]))};
assert.throws(()=>admitRuntimeProfile(profile,host));
const selected=selectStableTemporaryParent(host,[inside,outside]);assert.equal(selected,outside);
for(const [role,entry] of Object.entries(profile.stable_roots))entry.root=path.win32.join(selected,role);
assert.equal(admitRuntimeProfile(profile,host),profile);
assert.throws(()=>selectStableTemporaryParent(host,[inside]));
const posix={home:'/home/runner',canonical:p=>p,contains:(a,b)=>b===a||b.startsWith(a+'/')};
assert.equal(selectStableTemporaryParent(posix,['/tmp','/home/runner/work/_temp']),'/tmp');
"""
        subprocess.run(
            [str(native.workspace.node_path()), "--input-type=module", "-e", script],
            cwd=delivery.ROOT,
            check=True,
            capture_output=True,
            timeout=60,
        )

    def test_failed_suites_retain_inner_diagnostics_without_fixture_aliases(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            diagnostics = source / "diagnostics"
            diagnostics.mkdir(parents=True)
            report = {
                "code": 1,
                "privateMarkerAbsent": True,
                "stdoutStderr": "synthetic controlled case failure",
            }
            (diagnostics / "component-process.json").write_text(json.dumps(report))
            (source / "diagnostics-supervision.json").write_text(json.dumps({"exit_code": 1}))
            fixture = diagnostics / "diagnostic-fixture"
            fixture.mkdir()
            (fixture / "state.db3").write_text("synthetic store")
            (fixture / "inner.json").write_text(json.dumps({"do_not_copy": "synthetic fixture"}))
            secret = root / "key.json"
            secret.write_text(json.dumps({"do_not_copy": "synthetic"}))
            alias = diagnostics / "alias.json"
            if os.name == "nt":
                alias.hardlink_to(secret)
            else:
                alias.symlink_to(secret)
            (diagnostics / "partial.json").write_text("{not complete")
            destination = root / "retained"
            os.link(secret, diagnostics / "hardlink.json")
            (diagnostics / "deep.json").write_text(json.dumps({"synthetic_parser_failure": True}))
            fifo = hasattr(os, "mkfifo")
            if fifo:
                os.mkfifo(diagnostics / "blocked.json")
            subprocess.run(
                [
                    sys.executable,
                    "-c",
                    """import sys
sys.path.insert(0, 'scripts')
from pathlib import Path
from unittest.mock import patch
import quality_native
read = quality_native.delivery.read
def parser_failure(file):
    if file.name == 'deep.json':
        raise RecursionError('Synthetic parser failure')
    return read(file)
with patch.object(quality_native.delivery, 'read', side_effect=parser_failure):
    quality_native.retain_failed_reports(Path(sys.argv[1]), Path(sys.argv[2]))
""",
                    str(source),
                    str(destination),
                ],
                cwd=delivery.ROOT,
                check=True,
                timeout=10,
            )
            self.assertEqual(
                json.loads((destination / "diagnostics/component-process.json").read_text()), report
            )
            self.assertEqual(
                json.loads((destination / "diagnostics-supervision.json").read_text()),
                {"exit_code": 1},
            )
            self.assertFalse((destination / "diagnostics/alias.json").exists())
            self.assertFalse((destination / "diagnostics/diagnostic-fixture").exists())
            expected_rejections = {"alias.json", "partial.json", "hardlink.json", "deep.json"}
            if fifo:
                expected_rejections.add("blocked.json")
            issues = json.loads((destination / "retention-issues.json").read_text())["issues"]
            self.assertEqual(
                {row["report"] for row in issues},
                {"diagnostics/" + name for name in expected_rejections},
            )
            self.assertEqual(
                next(
                    row["error_type"] for row in issues if row["report"] == "diagnostics/deep.json"
                ),
                "RecursionError",
            )
            for name in expected_rejections:
                self.assertFalse((destination / "diagnostics" / name).exists())


if __name__ == "__main__":
    unittest.main()
