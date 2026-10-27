"""Verify native package admission without building or installing an executable."""

import copy
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_delivery as delivery


class DeliveryTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix" and Path("/opt").is_dir(), "Native POSIX shell fixture")
    def test_security_hooks_refuse_failed_empty_find_observations_before_policy_changes(self):
        for name, failure in (
            ("linux-before-install.sh", "permissions"),
            ("linux-after-install.sh", "permissions"),
            ("linux-after-install.sh", "setid"),
        ):
            with (
                self.subTest(script=name, failure=failure),
                tempfile.TemporaryDirectory() as temporary,
            ):
                marker = Path(temporary) / "policy-changed"
                # Source the actual hook with shell functions replacing native observations.
                # The fixed PATH cannot bypass these functions; no privileged action is run.
                harness = """
                    id() { printf '0\\n'; }
                    verify_distribution_profile() { :; }
                    stat() { printf '0\\n'; }
                    find() {
                        case " $* " in
                            *' /6000 '*) test "$FAILURE" != setid || return 23 ;;
                            *) test "$FAILURE" != permissions || return 23 ;;
                        esac
                    }
                    getenforce() { printf 'Enforcing\\n'; }
                    restorecon() { : > "$MARKER"; }
                    matchpathcon() { :; }
                    apparmor_parser() { : > "$MARKER"; }
                    . "$HOOK"
                """
                result = subprocess.run(
                    ["/bin/sh", "-c", harness],
                    env={
                        "HOOK": str(delivery.ASSETS / name),
                        "FAILURE": failure,
                        "MARKER": str(marker),
                        "OHTIA_NATIVE_PACKAGE_FORMAT": "rpm",
                        "OHTIA_NATIVE_DISTRIBUTION_PROFILE": "fedora-44",
                    },
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
                self.assertFalse(marker.exists())

    @unittest.skipUnless(os.name == "posix", "POSIX package mode contract")
    def test_payload_modes_are_independent_of_original_user_private_group_umask(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / "source"
            source.mkdir(mode=0o775)
            source.chmod(0o775)
            file = source / "data"
            file.write_bytes(b"public fixture")
            file.chmod(0o664)
            executable = source / "application"
            executable.write_bytes(b"synthetic executable")
            executable.chmod(0o775)
            payload = root / "payload"
            delivery.shutil.copytree(source, payload)
            delivery.normalize_payload_permissions(payload)
            self.assertEqual(payload.stat().st_mode & 0o777, 0o755)
            self.assertEqual((payload / "data").stat().st_mode & 0o777, 0o644)
            self.assertEqual((payload / "application").stat().st_mode & 0o777, 0o755)
            self.assertEqual(file.stat().st_mode & 0o777, 0o664)
            self.assertEqual(executable.stat().st_mode & 0o777, 0o775)

    @unittest.skipUnless(os.name == "posix", "POSIX package mode contract")
    def test_payload_rejects_setid_and_escaping_symlinks_before_permission_changes(self):
        for case in ("setid", "link"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                payload = root / "payload"
                payload.mkdir()
                outside = root / "outside"
                outside.write_bytes(b"unchanged")
                outside.chmod(0o640)
                if case == "setid":
                    file = payload / "application"
                    file.write_bytes(b"fixture")
                    file.chmod(0o4755)
                else:
                    (payload / "alias").symlink_to(outside)
                with self.assertRaises(delivery.probes.ProbeError):
                    delivery.normalize_payload_permissions(payload)
                self.assertEqual(outside.stat().st_mode & 0o777, 0o640)
                self.assertEqual(outside.read_bytes(), b"unchanged")

    @unittest.skipUnless(
        delivery.probes.workspace.node_path().is_file(), "Requires frozen workspace setup"
    )
    def test_generated_native_formats_match_the_actual_locked_builder_schema(self):
        tools = json.loads((delivery.ROOT / "config/desktop/toolchain.json").read_text())["tools"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for package_format in ("deb", "rpm"):
                output = root / package_format
                output.mkdir()
                config = delivery.builder_configuration(
                    output, output / "payload", package_format, tools
                )
                file = output / "config.json"
                file.write_text(json.dumps(config))
                command = [
                    str(delivery.probes.workspace.node_path()),
                    str(delivery.ASSETS / "package-linux.mjs"),
                    "--validate",
                    str(file),
                ]
                env = {
                    **({"SYSTEMROOT": os.environ["SYSTEMROOT"]} if os.name == "nt" else {}),
                    "HOME": str(root),
                    "PATH": str(delivery.probes.workspace.node_path().parent),
                }
                result = subprocess.run(
                    command,
                    cwd=delivery.ROOT,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                # Reproduce the exact native failure: format-specific hooks in linux are rejected.
                config["linux"]["afterInstall"] = "invalid-general-hook"
                file.write_text(json.dumps(config))
                result = subprocess.run(
                    command,
                    cwd=delivery.ROOT,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Invalid configuration", result.stderr)

    @unittest.skipUnless(os.name == "posix", "POSIX helper symlink materialization")
    def test_helper_archive_root_and_relative_executable_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "helper.tar.gz"
            output = root / "output"
            output.mkdir()
            with tarfile.open(archive, "w:gz") as stream:
                file = tarfile.TarInfo("7zip/bin/7zz")
                file.size = 7
                stream.addfile(file, io.BytesIO(b"fixture"))
                link = tarfile.TarInfo("7zip/bin/7za")
                link.type = tarfile.SYMTYPE
                link.linkname = "7zz"
                stream.addfile(link)
            delivery.extract_7zip_archive(archive, output)
            self.assertEqual((output / "bin/7za").read_bytes(), b"fixture")
            self.assertFalse((output / "7zip").exists())

    def test_helper_archive_refuses_escape_before_writing_outside(self):
        for name, target in (
            ("outside/file", None),
            ("7zip/../escape", None),
            ("7zip/bin/7za", "../../../escape"),
        ):
            with self.subTest(name=name, target=target), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = root / "helper.tar.gz"
                output = root / "output"
                output.mkdir()
                with tarfile.open(archive, "w:gz") as stream:
                    entry = tarfile.TarInfo(name)
                    if target is None:
                        entry.size = 1
                        stream.addfile(entry, io.BytesIO(b"x"))
                    else:
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = target
                        stream.addfile(entry)
                with self.assertRaises((delivery.probes.ProbeError, tarfile.FilterError)):
                    delivery.extract_7zip_archive(archive, output)
                self.assertFalse((root / "escape").exists())

    def test_declared_native_version_mapping_preserves_vocabulary(self):
        self.assertEqual(delivery.native_version("1.2.3-dev.32.1"), "1.2.3~dev.32.1")
        self.assertEqual(delivery.native_version("1.2.3-beta.12"), "1.2.3~beta.12")
        self.assertEqual(delivery.native_version("1.2.3"), "1.2.3")
        for value in ("1.2.3-rc.1", "1.2.3+build.1", "1.2.3-dev.01.1", "01.2.3", "1.2", "1.2.3\n"):
            with self.subTest(value=value), self.assertRaises(delivery.probes.ProbeError):
                delivery.native_version(value)

    @unittest.skipIf(
        os.name != "posix" or getattr(os, "getuid", lambda: 0)() == 0,
        "Requires an ordinary POSIX test user",
    )
    def test_install_scripts_refuse_ordinary_user_and_inherited_command_override(self):
        # Execute the real privilege gate with a poisoned inherited PATH; no native install occurs.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake = root / "id"
            fake.write_text("#!/bin/sh\ntouch '" + str(root / "override-used") + "'\necho 0\n")
            fake.chmod(0o755)
            self.assert_hooks_refuse(str(root))
            self.assertFalse((root / "override-used").exists())

    def assert_hooks_refuse(self, poisoned_path):
        for format_ in ("deb", "rpm"):
            for name in (
                "linux-before-install.sh",
                "linux-after-install.sh",
                "linux-after-remove.sh",
            ):
                script = delivery.generated_script(name, format_)
                result = subprocess.run(
                    ["/bin/sh", "-s"],
                    input=script,
                    env={"PATH": poisoned_path, "OHTIA_NATIVE_PACKAGE_FORMAT": "untrusted"},
                    text=True,
                    capture_output=True,
                )
                self.assertNotEqual(
                    result.returncode, 0, (format_, name, result.stdout, result.stderr)
                )

    def test_unsupported_distribution_policy_is_refused_before_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for format_, profile in (
                ("rpm", "debian-13"),
                ("deb", "fedora-44"),
                ("deb", "debian-13\nid"),
            ):
                with (
                    self.subTest(format=format_, profile=profile),
                    self.assertRaises(delivery.probes.ProbeError),
                ):
                    delivery.builder_configuration(root, root / "payload", format_, {}, profile)
                self.assertEqual(list(root.iterdir()), [])

    def test_invalid_version_or_distribution_never_reaches_builder(self):
        with patch.object(delivery.subprocess, "check_output") as invocation:
            with self.assertRaises(delivery.probes.ProbeError):
                delivery.package(Path("admission.json"), Path("attempt"), "deb", "1.2.3-rc.1")
            with patch.object(
                delivery.probes,
                "admission",
                return_value={"target": "linux-x64", "profile": "fedora-44"},
            ):
                with self.assertRaises(delivery.probes.ProbeError):
                    delivery.package(
                        Path("admission.json"), Path("attempt"), "deb", "1.2.3-dev.1.1"
                    )
        invocation.assert_not_called()

    def test_helper_projection_is_checked_against_installed_locked_source(self):
        tools = json.loads((delivery.ROOT / "config/desktop/toolchain.json").read_text())["tools"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "out/toolsets").mkdir(parents=True)
            for name, helper in tools["electron-builder"]["linux_packaging_helpers"].items():
                source = (
                    helper["release"]
                    + "\n"
                    + "\n".join(
                        '"' + artifact["url"].rsplit("/", 1)[-1] + '": "' + artifact["sha256"] + '"'
                        for artifact in helper["artifacts"].values()
                    )
                )
                (root / "out/toolsets" / ("linux.js" if name == "fpm" else "7zip.js")).write_text(
                    source
                )
            delivery.check_helpers(tools, root)
            for field in ("release", "url", "sha256"):
                changed = copy.deepcopy(tools)
                helper = changed["electron-builder"]["linux_packaging_helpers"]["fpm"]
                if field == "release":
                    helper[field] = "fpm@99.0.0"
                else:
                    helper["artifacts"]["linux-x64"][field] = (
                        "https://untrusted.invalid/fixture" if field == "url" else "0" * 64
                    )
                with self.subTest(field=field), self.assertRaises(delivery.probes.ProbeError):
                    delivery.check_helpers(changed, root)


@unittest.skipUnless(os.name == "posix", "Native Linux package orchestration contract")
class PackageOrchestrationTests(unittest.TestCase):
    @contextmanager
    def fixture(self, failed_stage=None, failure_flag=None, replace_admission=False):
        # External executables are replaced, while package files, hashes and receipts are real.
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as mocks:
            root = Path(temporary).resolve()
            scratch = root / "scratch"
            attempt = scratch / "attempt-synthetic"
            runtime = attempt / "runtime"
            (runtime / "resources/app").mkdir(parents=True)
            (runtime / "resources/app/package.json").write_text('{"type":"module"}')
            (runtime / "electron").write_bytes(b"Synthetic runtime; never executed.")
            (runtime / "electron").chmod(0o755)
            admission = root / "admission.json"
            sentinel = root / "sentinel"
            sentinel.write_text("Original synthetic stable data.")
            admission.write_text(json.dumps({"sentinel_sha256": delivery.probes.digest(sentinel)}))
            inputs = {"synthetic-source": "a" * 64}
            prepared = {
                "inputs": inputs,
                "target": "linux-x64",
                "expected": {"scenario": "journey"},
                "runtime_inventory": delivery.probes.inventory(runtime),
            }
            (attempt / "prepared.json").write_text(json.dumps(prepared))
            (attempt / "admitted.json").write_text(
                json.dumps(
                    {
                        "attempt_id": attempt.name,
                        "admission_sha256": delivery.probes.digest(admission),
                        "prepared_sha256": delivery.probes.digest(attempt / "prepared.json"),
                    }
                )
            )
            tools = {"electron": {"version": "45.0.0"}}
            (root / "config/desktop").mkdir(parents=True)
            (root / "config/desktop/toolchain.json").write_text(json.dumps({"tools": tools}))
            (root / "LICENSE").write_text("Synthetic permitted fixture.")
            builder = root / "builder"
            icons = builder / "templates/icons/electron-linux"
            icons.mkdir(parents=True)
            (icons / "16.png").write_bytes(b"Synthetic icon; no image decoder invoked.")
            helpers = {
                name: {"artifacts": {"linux-x64": {"url": "synthetic", "sha256": "b" * 64}}}
                for name in ("7zip", "fpm")
            }

            def validate(file):
                declared = json.loads(file.read_text())
                if declared["sentinel_sha256"] != delivery.probes.digest(sentinel):
                    raise delivery.probes.ProbeError("Synthetic sentinel changed.")
                return {
                    "target": "linux-x64",
                    "profile": "ubuntu-24.04",
                    "scratch_root": str(scratch),
                }

            def extract(_archive, destination):
                (destination / "bin").mkdir()
                (destination / "bin/7za").write_bytes(b"Synthetic helper; never executed.")

            def supervise(command, _cwd, _env, _timeout, _grace):
                stage = "extract" if command[1] == "x" else "builder"
                if stage == "extract":
                    destination = Path(
                        next(value[2:] for value in command if value.startswith("-o"))
                    )
                    (destination / "fpm").write_bytes(b"Synthetic FPM; never executed.")
                else:
                    destination = Path(command[2]).parent / "packages"
                    destination.mkdir()
                    (destination / "fixture.deb").write_bytes(
                        b"Synthetic package; never installed."
                    )
                    if replace_admission:
                        sentinel.write_text("Changed synthetic stable data.")
                        admission.write_text(
                            json.dumps({"sentinel_sha256": delivery.probes.digest(sentinel)})
                        )
                result = {
                    "exit_code": 0,
                    "timed_out": False,
                    "contained_processes_remaining_at_exit": False,
                    "full_tree_cessation": None,
                    "containment": "synthetic-no-process-executed",
                }
                if stage == failed_stage:
                    result[failure_flag] = True
                return result

            for owner, name, options in (
                (delivery, "ROOT", {"new": root}),
                (delivery, "check_helpers", {"return_value": helpers}),
                (delivery.probes, "admission", {"side_effect": validate}),
                (delivery.probes, "source_inputs", {"return_value": inputs}),
                (delivery.probes, "binary_arch", {"return_value": "x64"}),
                (
                    delivery.probes.workspace,
                    "download",
                    {"side_effect": lambda _metadata, file: file.write_bytes(b"fixture")},
                ),
                (delivery, "extract_7zip_archive", {"side_effect": extract}),
                (
                    delivery.subprocess,
                    "check_output",
                    {"return_value": str(builder / "package.json") + "\n"},
                ),
                (delivery, "run_owned", {"side_effect": supervise}),
            ):
                mocks.enter_context(patch.object(owner, name, **options))
            yield admission, attempt

    def test_zero_exit_cannot_hide_timeout_or_remaining_helper_processes(self):
        for stage in ("extract", "builder"):
            for flag in ("timed_out", "contained_processes_remaining_at_exit"):
                with (
                    self.subTest(stage=stage, flag=flag),
                    self.fixture(stage, flag) as (admission, attempt),
                ):
                    with self.assertRaises(delivery.probes.ProbeError):
                        delivery.package(admission, attempt, "deb", "0.0.0-dev.32.8")
                    output = next(attempt.glob("delivery-*/package-receipt.json"))
                    receipt = json.loads(output.read_text())
                    self.assertFalse(receipt["ok"])
                    supervision = (
                        receipt["helpers"]["fpm"]["extraction_supervision"]
                        if stage == "extract"
                        else receipt["builder_supervision"]
                    )
                    self.assertTrue(supervision[flag])

    def test_success_retains_extraction_and_builder_supervision(self):
        with self.fixture() as (admission, attempt):
            output = delivery.package(admission, attempt, "deb", "0.0.0-dev.32.8")
            receipt = json.loads((output / "package-receipt.json").read_text())
            self.assertTrue(receipt["ok"])
            self.assertEqual(receipt["helpers"]["fpm"]["extraction_supervision"]["exit_code"], 0)
            self.assertTrue(receipt["stable_admission_unchanged"])

    def test_failed_final_observations_retain_both_supervisors_and_recheck_admission(self):
        for field in ("source_inputs_unchanged", "canonical_runtime_inventory_unchanged", "both"):
            for failure in (
                PermissionError("Synthetic final observation denied."),
                subprocess.CalledProcessError(1, "synthetic-observation"),
            ):
                with (
                    self.subTest(field=field, failure=type(failure).__name__),
                    self.fixture() as (admission, attempt),
                ):
                    inputs = delivery.probes.source_inputs()
                    original_inventory = delivery.probes.inventory
                    calls = 0

                    def inventory(directory):
                        nonlocal calls
                        if directory == attempt / "runtime":
                            calls += 1
                            if calls == 2 and field in (
                                "canonical_runtime_inventory_unchanged",
                                "both",
                            ):
                                raise failure
                        return original_inventory(directory)

                    with (
                        patch.object(
                            delivery.probes,
                            "source_inputs",
                            side_effect=[inputs, failure]
                            if field in ("source_inputs_unchanged", "both")
                            else [inputs, inputs],
                        ),
                        patch.object(delivery.probes, "inventory", side_effect=inventory),
                    ):
                        with self.assertRaises(delivery.probes.ProbeError):
                            delivery.package(admission, attempt, "deb", "0.0.0-dev.32.8")
                    receipt = json.loads(
                        next(attempt.glob("delivery-*/package-receipt.json")).read_text()
                    )
                    self.assertFalse(receipt["ok"])
                    self.assertFalse(receipt["final_observations_complete"])
                    self.assertTrue(receipt["stable_admission_unchanged"])
                    self.assertEqual(
                        receipt["helpers"]["fpm"]["extraction_supervision"]["exit_code"], 0
                    )
                    self.assertEqual(receipt["builder_supervision"]["exit_code"], 0)
                    self.assertIn("active_build_ms", receipt)
                    self.assertIn("sha256", receipt["package"])
                    self.assertEqual(calls, 2)
                    expected = (
                        {"source_inputs_unchanged", "canonical_runtime_inventory_unchanged"}
                        if field == "both"
                        else {field}
                    )
                    self.assertEqual(set(receipt["observation_failures"]), expected)

    def test_replacing_sentinel_and_its_declaration_cannot_certify_preservation(self):
        with self.fixture(replace_admission=True) as (admission, attempt):
            with self.assertRaises(delivery.probes.ProbeError):
                delivery.package(admission, attempt, "deb", "0.0.0-dev.32.8")
            receipt = json.loads(next(attempt.glob("delivery-*/package-receipt.json")).read_text())
            self.assertFalse(receipt["ok"])
            self.assertFalse(receipt["stable_admission_unchanged"])


if __name__ == "__main__":
    unittest.main()
