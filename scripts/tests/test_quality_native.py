"""Verify package construction constraints without impersonating native execution."""

from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_delivery as delivery
import quality_native as native
import quality_processes as observer


class NativeTests(unittest.TestCase):
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
                kernel = SimpleNamespace(OpenProcess=Mock(return_value=1), CloseHandle=Mock())
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
                    observed = native.processes(Path("/synthetic/package"))[0]
                self.assertEqual(observed["sandbox"], accepted)
                self.assertEqual(observed["token"]["integrity_rid"], rid)
                self.assertEqual(observed["token"]["restricted"], restricted)
                self.assertEqual(kernel.CloseHandle.call_count, 2)

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
                    rows = native.processes(Path("/synthetic/app"))
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
                        Path("/synthetic/app"), [{"pid": 100, "renderer": True}], ready_only=True
                    )
                    self.assertEqual(len(rows), 0 if exited else 1)
                    if rows:
                        self.assertFalse(rows[0]["sandbox"])
                    # Unknown startup renderers are excluded from sampling, not from final ownership checks.
                    self.assertEqual(
                        native.processes(Path("/synthetic/app"), [], ready_only=True), []
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
            records = json.loads((Path(temporary) / "native-processes.json").read_text())
            self.assertEqual(len(records), 1)
            self.assertTrue(records[0]["renderer"])
            self.assertTrue(records[0]["start_time"].isdecimal())
            self.assertEqual({p.name for p in Path(temporary).iterdir()}, {"native-processes.json"})

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


if __name__ == "__main__":
    unittest.main()
