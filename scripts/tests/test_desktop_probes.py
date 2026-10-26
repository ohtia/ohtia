"""Verify fail-closed probe admission and evidence accounting without launching native code."""

from __future__ import annotations

import copy
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

NONREAPING_POSIX = os.name != "nt" and all(
    hasattr(os, name)
    for name in (
        "waitid",
        "WNOWAIT",
        "WEXITED",
        "WNOHANG",
        "P_PID",
        "CLD_EXITED",
        "CLD_KILLED",
        "CLD_DUMPED",
    )
)

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("desktop_probes", SCRIPTS / "desktop_probes.py")
probes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probes)


class CommandTests(unittest.TestCase):
    def test_common_command_forwards_native_scenario_flags(self):
        arguments = ["probes:prepare", "tmp/native-admission.json", "--scenario", "ipc"]
        with (
            patch.object(
                probes.workspace.sys,
                "argv",
                ["workspace.py", "run", arguments[0], "--", *arguments[1:]],
            ),
            patch.object(probes.workspace, "diagnose"),
            patch.object(probes.workspace, "diagnose_dependencies"),
            patch.object(probes.workspace, "pnpm") as pnpm,
        ):
            self.assertEqual(probes.workspace.main(), 0)
        pnpm.assert_called_once_with("run", *arguments)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.home = self.root / "independent"
        self.home.mkdir(mode=0o700)
        config = self.home / ".config"
        research = self.home / "research"
        scratch = self.home / "scratch"
        for directory in (config, research, scratch):
            directory.mkdir(mode=0o700)
        stable = {}
        for role in probes.ROLES:
            directory = self.root / f"stable-{role}"
            directory.mkdir(mode=0o700)
            marker = directory / probes.SENTINEL
            marker.write_text("synthetic stable sentinel\n")
            stable[role] = {"root": str(directory), "sentinel_sha256": probes.digest(marker)}
        evidence = self.root / "host.txt"
        evidence.write_text("Synthetic test fixture, not native host evidence.\n")
        self.data = {
            "schema_version": 1,
            "kind": "independent-native-profile",
            "inspected_by": "human:test",
            "native": True,
            "fixtures": "synthetic-or-permitted-public",
            "target": "linux-x64",
            "profile": "ubuntu-24.04",
            "backend": "wayland",
            "home": str(self.home),
            "configuration_root": str(config),
            "research_root": str(research),
            "scratch_root": str(scratch),
            "stable_roots": stable,
            "manual_checks": {
                name: True
                for name in (
                    "independent_account_or_vm",
                    "no_emulation",
                    "local_owned_unsynchronized_volumes",
                    "no_credentials",
                    "stable_roots_complete",
                    "native_security_and_display",
                )
            },
            "host_evidence": {"file": "host.txt", "sha256": probes.digest(evidence)},
            "hardware": {"fixture": True},
            "network": {"fixture": True},
        }
        self.file = self.root / "admission.json"
        self.enterContext(patch.object(Path, "home", return_value=self.home))
        self.enterContext(patch.object(probes, "account_home", return_value=self.home))
        self.enterContext(patch.object(probes.workspace, "target_id", return_value="linux-x64"))
        self.enterContext(patch.object(probes.sys, "platform", "linux"))
        self.enterContext(
            patch.dict(os.environ, {"XDG_CONFIG_HOME": str(config), "XDG_SESSION_TYPE": "wayland"})
        )

    def admit(self):
        self.file.write_text(json.dumps(self.data))
        return probes.admission(self.file)

    def test_independent_synthetic_profile_and_sentinels(self):
        self.assertEqual(self.admit()["target"], "linux-x64")

    def test_agent_inspection_keeps_all_manual_checks_required(self):
        self.data["inspected_by"] = "agent:codex"
        self.assertEqual(self.admit()["inspected_by"], "agent:codex")
        self.data["manual_checks"]["independent_account_or_vm"] = False
        with self.assertRaisesRegex(probes.ProbeError, "unverified"):
            self.admit()

    def test_inspection_requires_an_explicit_supported_actor(self):
        for actor in ("codex", "agent:", "service:codex"):
            with self.subTest(actor=actor):
                self.data["inspected_by"] = actor
                with self.assertRaises(probes.ProbeError):
                    self.admit()

    def test_missing_manual_confirmation_is_not_inferred(self):
        self.data["manual_checks"]["independent_account_or_vm"] = False
        with self.assertRaisesRegex(probes.ProbeError, "unverified"):
            self.admit()

    def test_stable_account_is_rejected_before_native_execution(self):
        self.data["stable_roots"]["configuration"]["root"] = str(self.home)
        with self.assertRaisesRegex(probes.ProbeError, "overlaps"):
            self.admit()

    def test_nested_configuration_and_research_roots_are_rejected(self):
        self.data["research_root"] = self.data["configuration_root"]
        with self.assertRaisesRegex(probes.ProbeError, "disjoint"):
            self.admit()

    def test_changed_stable_sentinel_is_rejected(self):
        directory = Path(self.data["stable_roots"]["store"]["root"])
        (directory / probes.SENTINEL).write_text("changed\n")
        with self.assertRaisesRegex(probes.ProbeError, "changed"):
            self.admit()

    def test_wrong_target_is_rejected(self):
        self.data["target"] = "linux-arm64"
        with self.assertRaisesRegex(probes.ProbeError, "CPU/OS"):
            self.admit()

    def test_elevated_context_is_rejected(self):
        with patch.object(probes, "is_elevated", return_value=True):
            with self.assertRaisesRegex(probes.ProbeError, "elevated"):
                self.admit()

    def test_home_override_cannot_impersonate_an_independent_account(self):
        with patch.object(probes, "account_home", return_value=self.root / "stable-account"):
            with self.assertRaisesRegex(probes.ProbeError, "changing HOME"):
                self.admit()

    def test_unknown_profile_cannot_replace_native_workstation(self):
        self.data["profile"] = "fedora-kde"
        with self.assertRaisesRegex(probes.ProbeError, "outside"):
            self.admit()

    @unittest.skipUnless(hasattr(os, "symlink"), "Symlink fixture needs platform support")
    def test_symlinked_scratch_root_is_rejected(self):
        alias = self.home / "alias"
        alias.symlink_to(self.data["scratch_root"], target_is_directory=True)
        self.data["scratch_root"] = str(alias)
        with self.assertRaisesRegex(probes.ProbeError, "aliases"):
            self.admit()

    def test_host_evidence_tamper_is_rejected(self):
        (self.root / "host.txt").write_text("altered\n")
        with self.assertRaisesRegex(probes.ProbeError, "altered"):
            self.admit()

    def attempt_fixture(self, suffix=""):
        self.admit()
        attempt = Path(self.data["scratch_root"]) / f"attempt-synthetic{suffix}"
        attempt.mkdir(mode=0o700)
        (attempt / "runtime").mkdir(mode=0o700)
        probes.write_json(
            attempt / "prepared.json",
            {
                "inputs": {},
                "target": "linux-x64",
                "runtime_inventory": {},
                "expected": {"deadlineMs": 1},
                "executable": "runtime/not-executed",
            },
        )
        probes.write_json(
            attempt / "admitted.json",
            {
                "attempt_id": attempt.name,
                "admission_sha256": probes.digest(self.file),
                "prepared_sha256": probes.digest(attempt / "prepared.json"),
                **{key: self.data[key] for key in ("target", "profile", "backend")},
            },
        )
        return attempt

    def test_failed_post_preparation_admission_never_seals_the_attempt(self):
        self.admit()
        sentinel = Path(self.data["stable_roots"]["store"]["root"]) / probes.SENTINEL

        def assemble(_target, attempt, _scenario):
            attempt.mkdir()
            (attempt / "prepared.json").write_text('{"synthetic":true}')
            sentinel.write_text("Changed during synthetic assembly.")

        with patch.object(probes, "bundle", side_effect=assemble):
            with self.assertRaisesRegex(probes.ProbeError, "changed"):
                probes.prepare(self.file)
        attempt = next(Path(self.data["scratch_root"]).glob("attempt-*"))
        self.assertTrue((attempt / "prepared.json").is_file())
        self.assertFalse((attempt / "admitted.json").exists())

    def test_replaced_native_input_is_refused_before_execution(self):
        attempt = self.attempt_fixture()
        (attempt / "runtime/replaced").write_text("synthetic replacement")
        with (
            patch.object(probes, "source_inputs", return_value={}),
            patch.object(probes, "run_owned") as launch,
        ):
            with self.assertRaisesRegex(probes.ProbeError, "replaced"):
                probes.run(self.file, attempt)
            launch.assert_not_called()

    def test_mismatched_linux_login_session_refuses_every_scenario_before_launch(self):
        for session in ("wayland", "x11", "", "tty"):
            for scenario in probes.SCENARIOS:
                with self.subTest(session=session, scenario=scenario):
                    self.data["backend"] = "x11" if session == "wayland" else "wayland"
                    self.admit()
                    attempt = self.attempt_fixture("-" + (session or "empty") + "-" + scenario)
                    prepared = probes.read_json(attempt / "prepared.json")
                    prepared["expected"]["scenario"] = scenario
                    (attempt / "prepared.json").write_text(json.dumps(prepared))
                    with (
                        patch.dict(os.environ, {"XDG_SESSION_TYPE": session}),
                        patch.object(probes, "run_owned") as launch,
                    ):
                        with self.assertRaisesRegex(probes.ProbeError, "login session"):
                            probes.run(self.file, attempt)
                    launch.assert_not_called()
                    self.assertFalse((attempt / "observations").exists())

    def test_native_launch_uses_manifest_arguments_and_preserves_session(self):
        attempt = self.attempt_fixture()

        def execute(command, cwd, env, *args):
            self.assertEqual(command, [str(attempt / "runtime/not-executed")])
            self.assertEqual(env["XDG_SESSION_TYPE"], "wayland")
            self.assertNotIn("NODE_OPTIONS", env)
            (attempt / "observations/runtime.json").write_text("{}")
            return {
                "exit_code": 0,
                "timed_out": False,
                "contained_processes_remaining_at_exit": False,
            }

        with (
            patch.object(probes, "source_inputs", return_value={}),
            patch.object(probes, "run_owned", side_effect=execute),
            patch.dict(
                os.environ, {"XDG_SESSION_TYPE": "wayland", "NODE_OPTIONS": "--bad-fixture"}
            ),
        ):
            probes.run(self.file, attempt)

    def test_playwright_scenario_uses_the_pinned_controller_and_binds_its_receipt(self):
        for retain_control in (True, False):
            with self.subTest(retain_control=retain_control):
                attempt = self.attempt_fixture("-playwright-" + str(retain_control))
                prepared = probes.read_json(attempt / "prepared.json")
                prepared["expected"]["scenario"] = "playwright"
                (attempt / "prepared.json").write_text(json.dumps(prepared))
                admitted = probes.read_json(attempt / "admitted.json")
                admitted["prepared_sha256"] = probes.digest(attempt / "prepared.json")
                (attempt / "admitted.json").write_text(json.dumps(admitted))

                def execute(command, _cwd, env, *_args):
                    self.assertEqual(
                        command[:2],
                        [
                            str(probes.workspace.node_path()),
                            str(probes.PACKAGE / "playwright-control.mjs"),
                        ],
                    )
                    self.assertEqual(command[2:4], [str(attempt), str(attempt / "observations")])
                    self.assertNotIn("NODE_OPTIONS", env)
                    self.assertEqual(env["DEBUG"], "pw:browser")
                    (attempt / "observations/runtime.json").write_text('{"synthetic":true}')
                    if retain_control:
                        (attempt / "observations/playwright-control.json").write_text(
                            '{"synthetic":true}'
                        )
                    return {
                        "exit_code": 0,
                        "timed_out": False,
                        "contained_processes_remaining_at_exit": False,
                    }

                with (
                    patch.object(probes, "source_inputs", return_value={}),
                    patch.object(probes, "run_owned", side_effect=execute),
                ):
                    if retain_control:
                        probes.run(self.file, attempt)
                    else:
                        with self.assertRaises(probes.ProbeError):
                            probes.run(self.file, attempt)
                execution = probes.read_json(attempt / "execution.json")
                self.assertEqual(execution["observations_complete"], retain_control)
                self.assertEqual(
                    execution["playwright_control_sha256"],
                    probes.digest(attempt / "observations/playwright-control.json")
                    if retain_control
                    else None,
                )

    def test_integrity_observation_failure_still_retains_failure_receipt(self):
        attempt = self.attempt_fixture()
        with (
            patch.object(
                probes, "source_inputs", side_effect=[{}, subprocess.CalledProcessError(1, "git")]
            ),
            patch.object(
                probes,
                "run_owned",
                return_value={
                    "exit_code": 0,
                    "timed_out": False,
                    "contained_processes_remaining_at_exit": False,
                    "full_tree_cessation": None,
                    "containment": "synthetic-test-only",
                },
            ),
        ):
            with self.assertRaisesRegex(probes.ProbeError, "failed"):
                probes.run(self.file, attempt)
        self.assertFalse(probes.read_json(attempt / "execution.json")["inputs_unchanged"])

    def test_supervisor_timeout_keeps_the_last_stage_checkpoint_digest(self):
        attempt = self.attempt_fixture()

        def execute(*args):
            (attempt / "observations/progress.jsonl").write_text('{"stage":"utility"}\n')
            return {
                "exit_code": -15,
                "timed_out": True,
                "contained_processes_remaining_at_exit": False,
            }

        with (
            patch.object(probes, "source_inputs", return_value={}),
            patch.object(probes, "run_owned", side_effect=execute),
        ):
            with self.assertRaises(probes.ProbeError):
                probes.run(self.file, attempt)
        receipt = probes.read_json(attempt / "execution.json")
        self.assertEqual(
            receipt["progress_sha256"], probes.digest(attempt / "observations/progress.jsonl")
        )
        self.assertIsNone(receipt["runtime_result_sha256"])
        self.assertFalse(receipt["observations_complete"])
        self.assertTrue(receipt["process_supervision"]["timed_out"])

    def test_unreadable_receipt_inputs_do_not_erase_execution_evidence(self):
        original_digest = probes.digest
        for name in ("runtime.json", "prepared.json", "admitted.json"):
            with self.subTest(name=name):
                attempt = self.attempt_fixture(name)

                def execute(*args):
                    (attempt / "observations/runtime.json").write_text("{}")
                    if name != "runtime.json":
                        (attempt / name).unlink()
                    return {
                        "exit_code": 0,
                        "timed_out": False,
                        "contained_processes_remaining_at_exit": False,
                    }

                def read_digest(file):
                    if name == "runtime.json" and file.name == name:
                        raise PermissionError("Synthetic denied observation")
                    return original_digest(file)

                with (
                    patch.object(probes, "source_inputs", return_value={}),
                    patch.object(probes, "run_owned", side_effect=execute),
                    patch.object(probes, "digest", side_effect=read_digest),
                ):
                    with self.assertRaisesRegex(probes.ProbeError, "failed"):
                        probes.run(self.file, attempt)
                receipt = probes.read_json(attempt / "execution.json")
                self.assertFalse(receipt["observations_complete"])
                self.assertFalse(receipt["inputs_unchanged"])
                self.assertEqual(receipt["exit_code"], 0)
                self.assertIn("process_supervision", receipt)

    def test_changed_or_malformed_admission_retains_incomplete_receipt(self):
        for corruption in ("manual-check-list", "recursive-json", "readable-drift"):
            with self.subTest(corruption=corruption):
                attempt = self.attempt_fixture(corruption)

                def execute(*args):
                    (attempt / "observations/runtime.json").write_text("{}")
                    changed = copy.deepcopy(self.data)
                    if corruption == "manual-check-list":
                        changed["manual_checks"] = list(changed["manual_checks"])
                    elif corruption == "recursive-json":
                        self.file.write_text('{"deep":' + "[" * 5000 + "0" + "]" * 5000 + "}")
                    else:
                        changed["network"] = {"synthetic_fixture": "changed"}
                    if corruption != "recursive-json":
                        self.file.write_text(json.dumps(changed))
                    return {
                        "exit_code": 0,
                        "timed_out": False,
                        "contained_processes_remaining_at_exit": False,
                    }

                with (
                    patch.object(probes, "source_inputs", return_value={}),
                    patch.object(probes, "run_owned", side_effect=execute),
                ):
                    with self.assertRaisesRegex(probes.ProbeError, "failed"):
                        probes.run(self.file, attempt)
                receipt = probes.read_json(attempt / "execution.json")
                self.assertFalse(receipt["observations_complete"])
                self.assertFalse(receipt["inputs_unchanged"])
                self.assertFalse(receipt["stable_sentinels_unchanged"])
                self.assertEqual(receipt["exit_code"], 0)


class ArtifactTests(unittest.TestCase):
    def test_native_launch_rejects_unreviewed_switches_for_every_target(self):
        manifest = probes.read_json(probes.ROOT / "config/desktop/targets.json")
        for row in manifest["targets"]:
            target = row["id"]
            self.assertEqual(probes.native_arguments(target), [])
            changed = copy.deepcopy(manifest)
            next(item for item in changed["targets"] if item["id"] == target)[
                "runtime_arguments"
            ] = ["--no-sandbox"]
            with (
                self.subTest(target=target),
                patch.object(probes, "read_json", return_value=changed),
            ):
                with self.assertRaisesRegex(probes.ProbeError, "runtime argument"):
                    probes.native_arguments(target)

    def test_binding_engine_must_match_the_adopting_manifest(self):
        tools_file = probes.ROOT / "config/desktop/toolchain.json"
        tools = probes.read_json(tools_file)
        original_read = probes.read_json
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            source = package / "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c"
            source.parent.mkdir(parents=True)
            sqlite = tools["tools"]["sqlite"]
            source.write_text(
                f'#define SQLITE_VERSION "{sqlite["version"]}"\n#define SQLITE_SOURCE_ID "{sqlite["source_id"]}"\n'
            )
            with patch.object(probes, "PACKAGE", package):
                self.assertEqual(
                    probes.expected_inputs("linux-x64")["sqliteVersion"], sqlite["version"]
                )
                changed = copy.deepcopy(tools)
                changed["tools"]["sqlite"]["version"] = "0.0.0"
                with patch.object(
                    probes,
                    "read_json",
                    side_effect=lambda path: changed if path == tools_file else original_read(path),
                ):
                    with self.assertRaisesRegex(probes.ProbeError, "adopting engine"):
                        probes.expected_inputs("linux-x64")

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX process-group wait contract")
    def test_unreapable_child_never_falls_back_to_an_unbounded_context_wait(self):
        from unittest.mock import MagicMock

        import probe_process

        child = MagicMock()
        child.pid = 12345
        child.__enter__.return_value = child
        child.wait.side_effect = subprocess.TimeoutExpired(["synthetic"], 1)
        child.__exit__.side_effect = AssertionError("Unbounded Popen context cleanup attempted.")
        with (
            patch.object(probe_process.subprocess, "Popen", return_value=child),
            patch.object(probe_process.os, "waitid", return_value=None),
            patch.object(probe_process, "group_has_members", return_value=True),
            patch.object(probe_process.os, "killpg"),
        ):
            with self.assertRaises(subprocess.TimeoutExpired):
                probe_process.run_owned(["synthetic"], Path.cwd(), {}, 0.01, 0.01)
        child.__exit__.assert_not_called()
        self.assertTrue(
            all(call.kwargs.get("timeout") is not None for call in child.wait.call_args_list)
        )

    def test_missing_nonreaping_observation_refuses_before_process_creation(self):
        import probe_process

        with (
            patch.object(probe_process, "os", SimpleNamespace(name="posix")),
            patch.object(probe_process.subprocess, "Popen") as launch,
        ):
            with self.assertRaisesRegex(OSError, "non-reaping"):
                probe_process.run_owned(["synthetic"], Path.cwd(), {}, 1, 1)
        launch.assert_not_called()

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX process-group identity contract")
    def test_lost_leader_identity_never_signals_a_numeric_group(self):
        from unittest.mock import MagicMock

        import probe_process

        child = MagicMock()
        child.pid = 12345
        with (
            patch.object(probe_process.subprocess, "Popen", return_value=child),
            patch.object(probe_process.os, "waitid", side_effect=ChildProcessError),
            patch.object(probe_process.os, "killpg") as signal_group,
        ):
            with self.assertRaisesRegex(OSError, "identity was lost"):
                probe_process.run_owned(["synthetic"], Path.cwd(), {}, 1, 1)
        signal_group.assert_not_called()
        child.wait.assert_not_called()

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX process-group identity contract")
    def test_group_signals_never_follow_reaping_the_identity_anchor(self):
        from unittest.mock import MagicMock

        import probe_process

        child = MagicMock()
        child.pid = 12345
        child.returncode = 0

        def signal_group(_group, sig):
            if sig == 0:
                raise ProcessLookupError
            self.assertEqual(child.wait.call_count, 0, "Group signal followed leader reaping")

        with (
            patch.object(probe_process.subprocess, "Popen", return_value=child),
            patch.object(
                probe_process.os, "waitid", return_value=SimpleNamespace(si_code=os.CLD_EXITED)
            ),
            patch.object(probe_process, "group_has_members", return_value=False),
            patch.object(probe_process.os, "killpg", side_effect=signal_group),
        ):
            result = probe_process.run_owned(["synthetic"], Path.cwd(), {}, 1, 0)
        self.assertTrue(result["leader_retained_until_group_signals"])
        self.assertFalse(result["contained_processes_remaining_at_exit"])
        child.wait.assert_called_once_with(timeout=0)

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX process-group leak contract")
    def test_lingering_descendant_remains_a_failure_after_it_is_cleaned(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = probes.run_owned(
                ["/bin/sh", "-c", "sleep 30 & exit 0"],
                Path(temporary),
                {"PATH": "/usr/bin:/bin"},
                timeout=5,
                grace=0.1,
            )
            self.assertEqual(result["exit_code"], 0)
            self.assertFalse(result["timed_out"])
            self.assertTrue(result["contained_processes_remaining_before_cleanup"])
            self.assertTrue(result["contained_processes_remaining_at_exit"])

    @unittest.skipUnless(
        sys.platform == "linux" and NONREAPING_POSIX, "Requires isolated Linux subreaper fixture"
    )
    def test_descendant_that_exits_within_grace_does_not_report_a_leak(self):
        with tempfile.TemporaryDirectory() as temporary:
            pid_file = Path(temporary) / "grandchild.pid"
            child_code = (
                "import os,time; from pathlib import Path; child=os.fork(); "
                "time.sleep(.15) if child==0 else None; "
                f"Path({str(pid_file)!r}).write_text(str(child)) if child else None; "
                "os._exit(0)"
            )
            wrapper = f"""
import ctypes,json,os,sys,threading,time
from pathlib import Path
sys.path.insert(0,{str(SCRIPTS)!r})
from probe_process import run_owned
native=ctypes.CDLL(None,use_errno=True)
native.prctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong]
native.prctl.restype=ctypes.c_int
if native.prctl(36,1,0,0,0)!=0:sys.exit(42)
errors=[]
def reap():
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  try:
   pid=int(Path({str(pid_file)!r}).read_text())
   os.waitpid(pid,0)
   return
  except (FileNotFoundError,ChildProcessError,ValueError):time.sleep(.005)
 errors.append('Synthetic descendant could not be reaped.')
thread=threading.Thread(target=reap);thread.start()
result=run_owned([sys.executable,'-c',{child_code!r}],Path({temporary!r}),{{'PATH':'/usr/bin:/bin'}},5,1)
thread.join(timeout=5)
assert not thread.is_alive() and not errors,errors
print(json.dumps(result))
"""
            result = subprocess.run(
                [sys.executable, "-c", wrapper],
                cwd=temporary,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 42:
                self.skipTest("Kernel policy does not permit the isolated subreaper fixture")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt["exit_code"], 0)
            self.assertFalse(receipt["contained_processes_remaining_before_cleanup"])
            self.assertFalse(receipt["contained_processes_remaining_at_exit"])

    def test_darwin_group_observation_excludes_only_the_zombie_leader(self):
        from unittest.mock import MagicMock

        import probe_process

        for rows, expected in (
            ("123 123 Z\n", False),
            ("123 123 Z\n456 123 S\n", True),
            ("123 123 S\n", True),
            ("123 123 Z\n456 123 Z\n", True),
        ):
            with self.subTest(rows=rows):
                observer = MagicMock()
                observer.returncode = 0
                observer.communicate.return_value = (rows, "")
                with (
                    patch.object(probe_process.sys, "platform", "darwin"),
                    patch.object(probe_process.subprocess, "Popen", return_value=observer) as start,
                ):
                    self.assertEqual(probe_process.group_has_members(123), expected)
                self.assertEqual(
                    start.call_args.args[0], ["/bin/ps", "-A", "-o", "pid=,pgid=,stat="]
                )
                self.assertEqual(
                    start.call_args.kwargs["env"], {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
                )
                observer.__exit__.assert_not_called()

    def test_darwin_failed_or_malformed_group_observation_never_means_absence(self):
        from unittest.mock import MagicMock

        import probe_process

        for code, rows in ((1, ""), (0, "invalid membership\n")):
            with self.subTest(code=code, rows=rows):
                observer = MagicMock()
                observer.returncode = code
                observer.communicate.return_value = (rows, "")
                with (
                    patch.object(probe_process.sys, "platform", "darwin"),
                    patch.object(probe_process.subprocess, "Popen", return_value=observer),
                ):
                    with self.assertRaises((OSError, ValueError)):
                        probe_process.group_has_members(123)

    def test_darwin_observation_timeout_uses_only_bounded_waits(self):
        from unittest.mock import MagicMock

        import probe_process

        observer = MagicMock()
        observer.communicate.side_effect = [subprocess.TimeoutExpired("synthetic-ps", 1), ("", "")]
        with (
            patch.object(probe_process.sys, "platform", "darwin"),
            patch.object(probe_process.subprocess, "Popen", return_value=observer),
        ):
            with self.assertRaisesRegex(OSError, "timed out"):
                probe_process.group_has_members(123)
        observer.kill.assert_called_once()
        self.assertTrue(
            all(
                call.kwargs.get("timeout") is not None
                for call in observer.communicate.call_args_list
            )
        )
        observer.__exit__.assert_not_called()

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX process-group identity contract")
    def test_timeout_signals_term_then_kill_before_reaping(self):
        import signal
        from unittest.mock import MagicMock

        import probe_process

        child = MagicMock()
        child.pid = 12345
        child.returncode = -9
        signals = []

        def signal_group(_group, sig):
            if sig == 0:
                raise ProcessLookupError
            self.assertEqual(child.wait.call_count, 0)
            signals.append(sig)

        with (
            patch.object(probe_process.subprocess, "Popen", return_value=child),
            patch.object(probe_process.os, "waitid", return_value=None),
            patch.object(probe_process, "group_has_members", return_value=True),
            patch.object(probe_process.os, "killpg", side_effect=signal_group),
        ):
            result = probe_process.run_owned(["synthetic"], Path.cwd(), {}, 0, 0)
        self.assertEqual(signals, [signal.SIGTERM, signal.SIGKILL])
        self.assertTrue(result["timed_out"])

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX process-group observation contract")
    def test_group_observation_failure_still_cleans_before_reaping(self):
        import signal
        from unittest.mock import MagicMock

        import probe_process

        child = MagicMock()
        child.pid = 12345

        def signal_group(_group, sig):
            self.assertEqual(sig, signal.SIGKILL)
            self.assertEqual(child.wait.call_count, 0)

        with (
            patch.object(probe_process.subprocess, "Popen", return_value=child),
            patch.object(
                probe_process.os, "waitid", return_value=SimpleNamespace(si_code=os.CLD_EXITED)
            ),
            patch.object(
                probe_process,
                "group_has_members",
                side_effect=OSError("synthetic unavailable observation"),
            ),
            patch.object(probe_process.os, "killpg", side_effect=signal_group),
        ):
            with self.assertRaisesRegex(OSError, "synthetic unavailable"):
                probe_process.run_owned(["synthetic"], Path.cwd(), {}, 1, 0)
        child.wait.assert_called_once_with(timeout=0)

    @unittest.skipIf(not NONREAPING_POSIX, "POSIX child notification contract")
    def test_nonexit_wait_notification_does_not_authorize_cleanup(self):
        from unittest.mock import MagicMock

        import probe_process

        child = MagicMock()
        child.pid = 12345
        child.returncode = 0
        statuses = [
            SimpleNamespace(si_code=getattr(os, "CLD_STOPPED", 5)),
            SimpleNamespace(si_code=os.CLD_EXITED),
        ]

        def signal_group(_group, sig):
            if sig == 0:
                raise ProcessLookupError
            self.assertEqual(observe.call_count, 2)

        with (
            patch.object(probe_process.subprocess, "Popen", return_value=child),
            patch.object(probe_process.os, "waitid", side_effect=statuses) as observe,
            patch.object(probe_process, "group_has_members", return_value=False),
            patch.object(probe_process.os, "killpg", side_effect=signal_group),
        ):
            result = probe_process.run_owned(["synthetic"], Path.cwd(), {}, 1, 0)
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["timed_out"])

    @unittest.skipIf(
        not NONREAPING_POSIX,
        "Requires native non-reaping POSIX observation; Windows jobs need separate native proof",
    )
    def test_owned_process_timeout_is_failed_and_waited(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = probes.run_owned(
                [sys.executable, "-c", "import time; time.sleep(60)"],
                Path(temporary),
                dict(os.environ),
                timeout=0.05,
                grace=1,
            )
            self.assertTrue(result["timed_out"])
            self.assertNotEqual(result["exit_code"], 0)

    @unittest.skipIf(
        not NONREAPING_POSIX,
        "Requires native non-reaping POSIX observation; Windows jobs need separate native proof",
    )
    def test_owned_process_success_is_observed(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = probes.run_owned(
                [sys.executable, "-c", "pass"],
                Path(temporary),
                dict(os.environ),
                timeout=5,
                grace=1,
            )
            self.assertEqual(result["exit_code"], 0)
            self.assertFalse(result["timed_out"])
            self.assertFalse(result["contained_processes_remaining_at_exit"])
            self.assertIsNone(result["full_tree_cessation"])

    @unittest.skipIf(
        not NONREAPING_POSIX,
        "Requires native non-reaping POSIX observation; Windows jobs need separate native proof",
    )
    def test_native_startup_diagnostics_reach_the_launcher_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            child = [
                sys.executable,
                "-c",
                "import sys; print('synthetic native stdout'); "
                "print('synthetic native failure', file=sys.stderr); sys.exit(7)",
            ]
            wrapper = (
                f"import os, sys; sys.path.insert(0, {str(SCRIPTS)!r}); "
                "from pathlib import Path; from probe_process import run_owned; "
                f"result = run_owned({child!r}, Path({temporary!r}), dict(os.environ), 5, 1); "
                "sys.exit(result['exit_code'])"
            )
            result = subprocess.run(
                [sys.executable, "-c", wrapper], capture_output=True, text=True, check=False
            )
            self.assertEqual(result.returncode, 7)
            self.assertIn("synthetic native stdout", result.stdout)
            self.assertIn("synthetic native failure", result.stderr)

    def test_machine_headers_override_filename(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "linux-x64.node"
            header = bytearray(64)
            header[:6] = b"\x7fELF\x02\x01"
            header[18:20] = (183).to_bytes(2, "little")
            file.write_bytes(header)
            self.assertEqual(probes.binary_arch(file), "arm64")

    def test_pe_and_macho_headers(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "native"
            header = bytearray(64)
            header[:2] = b"MZ"
            header[60:64] = (64).to_bytes(4, "little")
            file.write_bytes(header + b"PE\0\0\x64\x86")
            self.assertEqual(probes.binary_arch(file), "x64")
            file.write_bytes(b"\xcf\xfa\xed\xfe" + (0x100000C).to_bytes(4, "little"))
            self.assertEqual(probes.binary_arch(file), "arm64")

    def test_archive_escape_does_not_write_outside_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "runtime.zip"
            destination = root / "unpacked"
            destination.mkdir()
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("../escape", "injected")
            with self.assertRaises(probes.ProbeError):
                probes.extract_runtime(archive, destination)
            self.assertFalse((root / "escape").exists())

    def test_archive_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive = root / "runtime.zip"
            destination = root / "unpacked"
            destination.mkdir()
            with zipfile.ZipFile(archive, "w") as zipped:
                link = zipfile.ZipInfo("framework")
                link.create_system = 3
                link.external_attr = 0o120777 << 16
                zipped.writestr(link, "../../outside")
            with self.assertRaisesRegex(probes.ProbeError, "escapes"):
                probes.extract_runtime(archive, destination)

    def test_missing_native_records_never_qualify_a_target(self):
        result = probes.report([])
        self.assertFalse(result["complete"])
        self.assertEqual(result["qualified_targets"], [])
        self.assertEqual(len(result["missing_profiles"]), 13)

    def test_duplicate_json_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "record.json"
            file.write_text('{"ok":true,"ok":false}')
            with self.assertRaises(probes.ProbeError):
                probes.read_json(file)


class ControllerTests(unittest.TestCase):
    @unittest.skipUnless(
        probes.workspace.node_path().is_file()
        and (probes.ROOT / "node_modules/@playwright/test/package.json").is_file(),
        "Requires the isolated locked Node workspace; repository-policy CI does not bootstrap it",
    )
    def test_controller_refusals_retain_tool_identity_without_launching_a_runtime(self):
        for case in ("scenario", "arguments", "executable-path"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                attempt = Path(temporary)
                output = attempt / "observations"
                output.mkdir()
                prepared = {
                    "target": "linux-x64",
                    "executable": "../outside" if case == "executable-path" else "runtime/absent",
                    "expected": {"scenario": "journey" if case == "scenario" else "playwright"},
                }
                (attempt / "prepared.json").write_text(json.dumps(prepared))
                args = ["--no-sandbox"] if case == "arguments" else []
                result = subprocess.run(
                    [
                        str(probes.workspace.node_path()),
                        str(probes.PACKAGE / "playwright-control.mjs"),
                        str(attempt),
                        str(output),
                        json.dumps(args),
                    ],
                    cwd=probes.ROOT,
                    env={"PATH": os.defpath},
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                receipt = probes.read_json(output / "playwright-control.json")
                self.assertFalse(receipt["ok"])
                self.assertEqual(receipt["coreVersion"], receipt["toolVersion"])
                self.assertRegex(receipt["coreBundleSha256"], r"^[a-f0-9]{64}$")
                expected = {
                    "scenario": "Wrong pinned tool or native scenario.",
                    "arguments": "Native control requires the reviewed empty runtime argument policy.",
                    "executable-path": "Executable escaped its admitted runtime.",
                }[case]
                self.assertEqual(receipt["failure"]["message"], expected)
                self.assertNotIn("arguments", receipt)
                self.assertNotIn("identity", receipt)


class ReportTests(unittest.TestCase):
    """Synthetic protocol fixtures test accounting; these are never native run records."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.inputs = {"pnpm-lock.yaml": "a" * 64, "uv.lock": "b" * 64}
        self.enterContext(patch.object(probes, "source_inputs", return_value=self.inputs))
        # Metadata parsing is replaced by explicit synthetic fixture identities, not native loading.
        self.expected = {
            target: {
                "target": target,
                "addonSha256": "c" * 64,
                "sqliteVersion": "fixture",
                "sqliteSourceId": "fixture-source",
                "requiredOptions": ["fixture-option"],
                "runtime": {"node": "fixture-node", "electron": "fixture-electron"},
                "busyMs": 1,
                "deadlineMs": 1,
                "scenario": "journey",
                "messageBytes": 65536,
                "stringBytes": 4096,
            }
            for target, _, _ in probes.profile_cells()
        }
        self.enterContext(
            patch.object(
                probes,
                "expected_inputs",
                side_effect=lambda target, scenario="journey": {
                    **copy.deepcopy(self.expected[target]),
                    "scenario": scenario,
                },
            )
        )
        self.toolchain = probes.read_json(probes.ROOT / "config/desktop/toolchain.json")
        self.records = [self.record(cell) for cell in probes.profile_cells()]

    def save(self, file, data):
        file.write_text(json.dumps(data))

    def record(self, cell, scenario="journey", directory=None, dark_before=False):
        target, profile, backend = cell
        directory = directory or self.root / f"{target}-{profile}-{backend}"
        (directory / "observations").mkdir(parents=True)
        (directory / "host-evidence.bin").write_text("Synthetic host fixture; not native evidence.")
        scope = dict(zip(("target", "profile", "backend"), cell, strict=True))
        attempt_id = f"synthetic-{directory.name}"
        declaration = {
            "schema_version": 1,
            "kind": "independent-native-profile",
            "inspected_by": "human:synthetic-test",
            "native": True,
            "fixtures": "synthetic-or-permitted-public",
            **scope,
            "home": "/synthetic/independent",
            "configuration_root": "/synthetic/independent/config",
            "research_root": "/synthetic/independent/research",
            "scratch_root": "/synthetic/independent/scratch",
            "stable_roots": {
                role: {"root": f"/synthetic/stable-{role}", "sentinel_sha256": "d" * 64}
                for role in probes.ROLES
            },
            "manual_checks": {
                key: True
                for key in (
                    "independent_account_or_vm",
                    "no_emulation",
                    "local_owned_unsynchronized_volumes",
                    "no_credentials",
                    "stable_roots_complete",
                    "native_security_and_display",
                )
            },
            "host_evidence": {
                "file": "host-evidence.bin",
                "sha256": probes.digest(directory / "host-evidence.bin"),
            },
            "hardware": {"synthetic_fixture": True},
            "network": {"synthetic_fixture": True},
        }
        self.save(directory / "admission.json", declaration)
        expected = {**copy.deepcopy(self.expected[target]), "scenario": scenario}
        prepared = {
            "schema_version": 1,
            "qualified": False,
            "inputs": self.inputs,
            "target": target,
            "runtime_archive_sha256": self.toolchain["tools"]["electron"]["artifacts"][target][
                "sha256"
            ],
            # These producer modes need not exist on the reconciliation host.
            "runtime_inventory": {"native": "file:777:" + "e" * 64},
            "expected": expected,
        }
        self.save(directory / "prepared.json", prepared)
        self.save(
            directory / "admitted.json",
            {
                **scope,
                "attempt_id": attempt_id,
                "admission_sha256": probes.digest(directory / "admission.json"),
                "prepared_sha256": probes.digest(directory / "prepared.json"),
            },
        )
        observed = {
            "ok": True,
            "scenario": scenario,
            "initialJourney": {
                "status": {"ready": True, "target": target, "electron": "fixture-electron"},
                "appearanceBefore": "system",
                "appearanceAfter": "light" if dark_before else "dark",
                "nativeDarkBefore": dark_before,
                "rendererDarkBefore": dark_before,
                "rendererDark": not dark_before,
                "windows": 1,
            },
            "utilityExited": True,
            "utilityExitCode": 0,
            "target": target,
            "versions": expected["runtime"],
            "preloadIsolation": {"sandboxed": True, "contextIsolated": True},
            **{
                name: True
                for name in (
                    "privilegedGlobalsAbsent",
                    "protocolMethodDenied",
                    "resourceRequestCancelled",
                    "rendererCspConnectionDenied",
                )
            },
            "utility": {
                "ok": True,
                "result": {
                    "arch": target.rsplit("-", 1)[1],
                    "versions": expected["runtime"],
                    **{
                        key: expected[key]
                        for key in ("addonSha256", "sqliteVersion", "sqliteSourceId")
                    },
                    "compileOptions": expected["requiredOptions"],
                    **{
                        name: True
                        for name in (
                            "foreignKeys",
                            "constraintRejected",
                            "migrationRollback",
                            "fileBackedReopen",
                            "backup",
                            "competingWriterRejected",
                        )
                    },
                },
            },
        }
        if scenario == "utility-crash":
            observed.pop("utility")
            observed.update(
                {
                    "ok": False,
                    "utilityExitCode": 9,
                    "utilityCrash": {"pid": 12345, "killAccepted": True},
                    "failure": {"message": "Utility failed or omitted its result."},
                }
            )
        elif scenario == "ipc":
            observed.update(
                {
                    "preloadOversizeRejected": True,
                    "navigationDenied": True,
                    "privilegedImport": {"denied": True},
                    "invalidRequests": [
                        {"caseId": name, "reply": {"ok": False, "code": "invalid-request"}}
                        for name in (
                            "null",
                            "unknown-operation",
                            "oversized",
                            "unexpected-frame-key",
                        )
                    ],
                    "spoofedSender": {
                        "expectedContentsId": 1,
                        "actualContentsId": 2,
                        "sameOrigin": True,
                        "reply": {"ok": False, "code": "untrusted-sender"},
                    },
                }
            )
        elif scenario == "playwright":
            observed["playwrightControlReleased"] = True
            self.save(
                directory / "observations/playwright-control.json",
                {
                    "ok": True,
                    "scenario": scenario,
                    "target": target,
                    "toolVersion": self.toolchain["tools"]["@playwright/test"]["version"],
                    "coreVersion": self.toolchain["tools"]["@playwright/test"]["version"],
                    "coreBundleSha256": "e" * 64,
                    "controlReleased": True,
                    "nativeExit": {"code": 0, "signal": None},
                    "documentUrl": "ohtia-probe://qualification/index.html",
                    "identity": {
                        "ready": True,
                        "target": target,
                        "versions": expected["runtime"],
                        "processArgv": ["synthetic-executable"],
                        "switches": {
                            name: (
                                {"present": True, "value": backend}
                                if name == "ozone-platform" and target.startswith("linux-")
                                else {"present": False, "value": ""}
                            )
                            for name in (
                                "no-sandbox",
                                "disable-setuid-sandbox",
                                "ozone-platform",
                                "disable-web-security",
                            )
                        },
                    },
                    "renderer": {
                        "privilegedGlobalsAbsent": True,
                        "status": {
                            "ok": True,
                            "value": {
                                "ready": True,
                                "target": target,
                                "electron": expected["runtime"]["electron"],
                            },
                        },
                    },
                },
            )
        self.save(directory / "observations/runtime.json", observed)
        self.save(
            directory / "execution.json",
            {
                **scope,
                "attempt_id": attempt_id,
                "exit_code": 1 if scenario == "utility-crash" else 0,
                "inputs_unchanged": True,
                "stable_sentinels_unchanged": True,
                "observations_complete": True,
                "process_supervision": {
                    "timed_out": False,
                    "contained_processes_remaining_at_exit": False,
                    "native_runtime_containment": (
                        None
                        if scenario == "playwright" and not target.startswith("win32-")
                        else "windows-kill-on-close-job"
                        if target.startswith("win32-")
                        else "posix-process-group"
                    ),
                    "root_role": "playwright-controller"
                    if scenario == "playwright"
                    else "native-runtime",
                },
                "prepared_sha256": probes.digest(directory / "prepared.json"),
                "admitted_sha256": probes.digest(directory / "admitted.json"),
                "runtime_result_sha256": probes.digest(directory / "observations/runtime.json"),
                "native_runtime_inventory_sha256": probes.object_digest(
                    prepared["runtime_inventory"]
                ),
            },
        )
        if scenario == "playwright":
            execution = probes.read_json(directory / "execution.json")
            execution["playwright_control_sha256"] = probes.digest(
                directory / "observations/playwright-control.json"
            )
            self.save(directory / "execution.json", execution)
        if scenario != "journey":
            return directory
        scenarios = {}
        for name in set(probes.SCENARIO_CASES.values()):
            support = self.record(cell, name, directory / "scenarios" / name)
            execution = support / "execution.json"
            scenarios[name] = {
                "file": execution.relative_to(directory).as_posix(),
                "sha256": probes.digest(execution),
            }
        cases = {}
        for case_id in probes.MANUAL_CASES:
            supporting = (
                directory / "scenarios" / probes.SCENARIO_CASES[case_id]
                if case_id in probes.SCENARIO_CASES
                else directory
            )
            case_prepared = probes.read_json(supporting / "prepared.json")
            file = directory / f"{case_id}.json"
            self.save(
                file,
                {
                    **scope,
                    "case_id": case_id,
                    "source_inputs_sha256": probes.object_digest(self.inputs),
                    "runtime_inventory_sha256": probes.object_digest(
                        case_prepared["runtime_inventory"]
                    ),
                    "execution_sha256": probes.digest(supporting / "execution.json"),
                    "result": "pass",
                    "procedure": "Synthetic fixture procedure, not an actual native observation.",
                    "expected": "Synthetic expected outcome.",
                    "observed": "Synthetic observed outcome.",
                    "limitations": "Unit fixture only; cannot qualify any real native target.",
                },
            )
            cases[case_id] = {
                "result": "pass",
                "evidence": {"file": file.name, "sha256": probes.digest(file)},
            }
        self.save(
            directory / "native-cases.json",
            {"reviewed_by": "human:synthetic-test", "cases": cases, "scenarios": scenarios},
        )
        return directory

    def rebind_execution(self, directory, scenario_directory):
        """Refresh all attachments so a semantic refusal cannot rely on stale hashes."""
        execution = scenario_directory / "execution.json"
        receipt = probes.read_json(execution)
        receipt["admitted_sha256"] = probes.digest(scenario_directory / "admitted.json")
        self.save(execution, receipt)
        file = directory / "native-cases.json"
        cases = probes.read_json(file)
        for reference in cases["scenarios"].values():
            if directory / reference["file"] == execution:
                reference["sha256"] = probes.digest(execution)
        for case_id, case in cases["cases"].items():
            expected_directory = (
                directory / "scenarios" / probes.SCENARIO_CASES[case_id]
                if case_id in probes.SCENARIO_CASES
                else directory
            )
            if expected_directory == scenario_directory:
                evidence = directory / case["evidence"]["file"]
                summary = probes.read_json(evidence)
                summary["execution_sha256"] = probes.digest(execution)
                self.save(evidence, summary)
                case["evidence"]["sha256"] = probes.digest(evidence)
        self.save(file, cases)

    def test_rehashed_canonical_and_supporting_records_cannot_replace_preparation_seal(self):
        directory = self.records[0]
        for name in ("journey", "ipc", "utility-crash", "playwright"):
            with self.subTest(scenario=name):
                scenario_directory = (
                    directory if name == "journey" else directory / "scenarios" / name
                )
                file = scenario_directory / "admitted.json"
                original = file.read_bytes()
                admitted = probes.read_json(file)
                admitted["prepared_sha256"] = "0" * 64
                self.save(file, admitted)
                self.rebind_execution(directory, scenario_directory)
                result = probes.report(self.records)
                self.assertFalse(result["complete"])
                self.assertTrue(any("Evidence identities" in item for item in result["failures"]))
                file.write_bytes(original)
                self.rebind_execution(directory, scenario_directory)
                restored = probes.report(self.records)
                self.assertTrue(restored["complete"], restored["failures"])

    def test_playwright_cannot_claim_posix_electron_containment_from_its_controller(self):
        directory = next(record for record in self.records if record.name.startswith("linux-"))
        support = directory / "scenarios/playwright"
        file = support / "execution.json"
        receipt = probes.read_json(file)
        receipt["process_supervision"]["native_runtime_containment"] = "posix-process-group"
        self.save(file, receipt)
        self.rebind_execution(directory, support)
        result = probes.report(self.records)
        self.assertFalse(result["complete"])
        self.assertTrue(any("containment scope" in item for item in result["failures"]))

    def test_rehashed_playwright_tool_or_effective_switch_disagreement_fails_closed(self):
        directory = self.records[0]
        support = directory / "scenarios/playwright"
        file = support / "observations/playwright-control.json"
        original = file.read_bytes()
        for change in ("core-version", "missing-identity", "forbidden-switch"):
            with self.subTest(change=change):
                control = json.loads(original)
                if change == "core-version":
                    control["coreVersion"] = "0.0.0"
                elif change == "missing-identity":
                    control.pop("coreBundleSha256")
                else:
                    control["identity"]["switches"]["no-sandbox"] = {"present": True, "value": ""}
                self.save(file, control)
                execution = support / "execution.json"
                receipt = probes.read_json(execution)
                receipt["playwright_control_sha256"] = probes.digest(file)
                self.save(execution, receipt)
                self.rebind_execution(directory, support)
                result = probes.report(self.records)
                self.assertFalse(result["complete"])
                self.assertTrue(any("Playwright runtime" in item for item in result["failures"]))
        file.write_bytes(original)

    def test_rehashed_playwright_backend_cannot_contradict_the_admitted_linux_cell(self):
        directory = next(record for record in self.records if record.name.startswith("linux-"))
        support = directory / "scenarios/playwright"
        file = support / "observations/playwright-control.json"
        control = probes.read_json(file)
        admitted = probes.read_json(support / "admitted.json")
        control["identity"]["switches"]["ozone-platform"] = {
            "present": True,
            "value": "x11" if admitted["backend"] == "wayland" else "wayland",
        }
        self.save(file, control)
        execution = support / "execution.json"
        receipt = probes.read_json(execution)
        receipt["playwright_control_sha256"] = probes.digest(file)
        self.save(execution, receipt)
        self.rebind_execution(directory, support)
        result = probes.report(self.records)
        self.assertFalse(result["complete"])
        self.assertTrue(any("Playwright runtime" in item for item in result["failures"]))

    def test_system_dark_appearance_still_requires_and_accepts_an_actual_change(self):
        record = self.record(
            probes.profile_cells()[0], directory=self.root / "dark-native-fixture", dark_before=True
        )
        result = probes.report([record, *self.records[1:]])
        self.assertTrue(result["complete"], result["failures"])

    def test_all_manual_summaries_cannot_replace_missing_native_scenarios(self):
        file = self.records[0] / "native-cases.json"
        cases = probes.read_json(file)
        cases["scenarios"].pop("ipc")
        self.save(file, cases)
        self.assertFalse(probes.report(self.records)["complete"])

    def test_rehashed_ipc_record_must_contain_the_actual_refusals(self):
        directory = self.records[0]
        runtime = directory / "scenarios/ipc/observations/runtime.json"
        observed = probes.read_json(runtime)
        observed.pop("privilegedImport")
        self.save(runtime, observed)
        execution = runtime.parent.parent / "execution.json"
        receipt = probes.read_json(execution)
        receipt["runtime_result_sha256"] = probes.digest(runtime)
        self.save(execution, receipt)
        file = directory / "native-cases.json"
        cases = probes.read_json(file)
        cases["scenarios"]["ipc"]["sha256"] = probes.digest(execution)
        self.save(file, cases)
        result = probes.report(self.records)
        self.assertFalse(result["complete"])
        self.assertTrue(any("IPC/frame/navigation/import" in item for item in result["failures"]))

    def test_ipc_case_cannot_bind_to_the_canonical_journey_execution(self):
        directory = self.records[0]
        file = directory / "native-cases.json"
        cases = probes.read_json(file)
        case = cases["cases"]["ipc-spoofed-frame"]
        evidence = directory / case["evidence"]["file"]
        summary = probes.read_json(evidence)
        summary["execution_sha256"] = probes.digest(directory / "execution.json")
        self.save(evidence, summary)
        case["evidence"]["sha256"] = probes.digest(evidence)
        self.save(file, cases)
        self.assertFalse(probes.report(self.records)["complete"])

    def test_complete_receipts_are_portable_without_foreign_runtime_files(self):
        result = probes.report(self.records)
        self.assertTrue(result["complete"], result["failures"])
        self.assertEqual(len(result["qualified_targets"]), 6)

    def test_agent_case_review_accepts_only_complete_evidence(self):
        for directory in self.records:
            file = directory / "native-cases.json"
            cases = probes.read_json(file)
            cases["reviewed_by"] = "agent:codex"
            self.save(file, cases)
        self.assertTrue(probes.report(self.records)["complete"])
        missing = self.records[0] / "native-cases.json"
        cases = probes.read_json(missing)
        cases["cases"].pop("renderer-sandbox-os-observed")
        self.save(missing, cases)
        self.assertFalse(probes.report(self.records)["complete"])

    def test_case_review_requires_an_explicit_supported_actor(self):
        file = self.records[0] / "native-cases.json"
        cases = probes.read_json(file)
        cases["reviewed_by"] = "service:codex"
        self.save(file, cases)
        self.assertFalse(probes.report(self.records)["complete"])

    def test_partial_target_does_not_inherit_other_cells(self):
        result = probes.report(self.records[:1])
        self.assertFalse(result["complete"])
        self.assertEqual(result["qualified_targets"], [])

    def test_rehashed_runtime_cannot_omit_or_replace_the_canonical_journey(self):
        directory = self.records[0]
        runtime_file = directory / "observations/runtime.json"
        original = probes.read_json(runtime_file)
        for change in ("missing", "two-windows", "no-appearance-change", "ipc-scenario"):
            with self.subTest(change=change):
                runtime = copy.deepcopy(original)
                if change == "missing":
                    del runtime["initialJourney"]
                elif change == "two-windows":
                    runtime["initialJourney"]["windows"] = 2
                elif change == "no-appearance-change":
                    runtime["initialJourney"]["appearanceAfter"] = "system"
                else:
                    runtime["scenario"] = "ipc"
                self.save(runtime_file, runtime)
                execution = probes.read_json(directory / "execution.json")
                execution["runtime_result_sha256"] = probes.digest(runtime_file)
                self.save(directory / "execution.json", execution)
                result = probes.report(self.records)
                self.assertFalse(result["complete"])
                self.assertTrue(
                    any("canonical status/appearance" in item for item in result["failures"])
                )

    def test_missing_admission_or_host_observation_fails_closed(self):
        for name in ("admission.json", "host-evidence.bin"):
            with self.subTest(name=name):
                file = self.records[0] / name
                saved = file.read_bytes()
                file.unlink()
                result = probes.report(self.records)
                self.assertFalse(result["complete"])
                self.assertNotIn(str(self.root), json.dumps(result))
                file.write_bytes(saved)

    def test_rehashed_wrong_archive_cannot_replace_adopting_inputs(self):
        directory = self.records[0]
        prepared = probes.read_json(directory / "prepared.json")
        prepared["runtime_archive_sha256"] = "0" * 64
        self.save(directory / "prepared.json", prepared)
        execution = probes.read_json(directory / "execution.json")
        execution["prepared_sha256"] = probes.digest(directory / "prepared.json")
        self.save(directory / "execution.json", execution)
        admitted = probes.read_json(directory / "admitted.json")
        admitted["prepared_sha256"] = probes.digest(directory / "prepared.json")
        self.save(directory / "admitted.json", admitted)
        self.rebind_execution(directory, directory)
        result = probes.report(self.records)
        self.assertFalse(result["complete"])
        self.assertTrue(any("adopting manifests" in failure for failure in result["failures"]))

    def test_arbitrary_attachment_bytes_cannot_satisfy_native_case(self):
        directory = self.records[0]
        cases = probes.read_json(directory / "native-cases.json")
        case = cases["cases"]["disk-full"]
        file = directory / case["evidence"]["file"]
        file.write_text("arbitrary bytes, not a scoped observation")
        case["evidence"]["sha256"] = probes.digest(file)
        self.save(directory / "native-cases.json", cases)
        self.assertFalse(probes.report(self.records)["complete"])

    def test_case_summaries_cannot_silently_move_to_another_execution(self):
        directory = self.records[0]
        admitted = probes.read_json(directory / "admitted.json")
        execution = probes.read_json(directory / "execution.json")
        admitted["attempt_id"] = "another-synthetic-attempt"
        self.save(directory / "admitted.json", admitted)
        execution["attempt_id"] = admitted["attempt_id"]
        execution["admitted_sha256"] = probes.digest(directory / "admitted.json")
        self.save(directory / "execution.json", execution)
        result = probes.report(self.records)
        self.assertFalse(result["complete"])
        self.assertTrue(any("scope or observations" in item for item in result["failures"]))


if __name__ == "__main__":
    unittest.main()
