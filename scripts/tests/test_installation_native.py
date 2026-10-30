"""Regression contracts for internal native admission, payload identity and package transactions."""

import io
import json
import os
import select
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from contextlib import ExitStack, contextmanager, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_native as native
import installation_operator as operator


@unittest.skipUnless(os.name == "posix", "POSIX internal Linux/macOS qualification helpers")
class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.file = self.root / "ohtia.deb"
        self.file.write_bytes(b"synthetic internal package")
        checksum = native.digest(self.file)
        self.record = {
            "file": str(self.file),
            "bytes": self.file.stat().st_size,
            "sha256": checksum,
            "entry": {
                "bytes": self.file.stat().st_size,
                "sha256": checksum,
                "schema": {"source_min": 0, "source_max": 2, "target": 2},
                "native_version": "0.0.0~dev.27.1-1",
            },
            "version": "0.0.0-dev.27.1",
            "migration_manifest_sha256": "a" * 64,
        }
        self.cell = {"target": "linux-x64"}
        (self.root / "trust").mkdir()
        self.trust = MagicMock(spec=Path)
        self.trust.resolve.return_value = self.trust
        self.trust.is_dir.return_value = True
        self.trust.stat.return_value = SimpleNamespace(st_uid=0, st_mode=0o40700)
        self.trust.__str__.return_value = str(self.root / "trust")

    def tearDown(self):
        self.temporary.cleanup()

    @contextmanager
    def adapter(self, suffix=".deb"):
        if suffix != self.file.suffix:
            selected = self.file.with_suffix(suffix)
            self.file.rename(selected)
            self.file = selected
            self.record["file"] = str(selected)
        with ExitStack() as stack:
            for name in ("check_installation_admission", "package_identity", "assert_quiescent"):
                stack.enter_context(patch.object(native, name))
            stack.enter_context(patch.object(native, "verify_staged", return_value=self.file))
            stack.enter_context(
                patch.object(
                    native,
                    "package_inventory",
                    return_value=SimpleNamespace(
                        target_schema=2, migration_manifest_sha256="a" * 64
                    ),
                )
            )
            stack.enter_context(patch.object(os, "getuid", return_value=0))
            stack.enter_context(
                patch.object(
                    native.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="")
                )
            )
            yield

    def install(self, **kwargs):
        return native.install_staged(
            self.record,
            self.cell,
            self.root / "installed",
            administrator=True,
            profile={},
            **kwargs,
        )

    def test_changed_missing_or_aliased_bytes_refuse_before_native_commands(self):
        self.assertEqual(native.verify_staged(self.record), self.file)
        self.file.write_bytes(b"changed")
        with (
            patch.object(native, "check_installation_admission"),
            patch.object(native, "command") as execute,
        ):
            with self.assertRaises(ValueError):
                self.install()
            execute.assert_not_called()
        self.file.unlink()
        with self.assertRaises(OSError):
            native.verify_staged(self.record)
        target = self.root / "elsewhere"
        target.write_bytes(b"synthetic internal package")
        self.file.symlink_to(target)
        with self.assertRaises(ValueError):
            native.verify_staged(self.record)

    def test_package_metadata_rejects_wrong_cpu_name_epoch_and_version(self):
        expected = "Package: ohtia-quality\nVersion: 0.0.0~dev.27.1-1\nArchitecture: amd64"
        with patch.object(native, "command", return_value=expected):
            native.package_identity(self.file, self.cell, self.record["version"])
        for output in [
            expected.replace("amd64", "arm64"),
            expected.replace("ohtia-quality", "other"),
            expected.replace("27.1", "27.2"),
        ]:
            with (
                patch.object(native, "command", return_value=output),
                self.assertRaises(ValueError),
            ):
                native.package_identity(self.file, self.cell, self.record["version"])
        for output in [
            "ohtia-quality\n1\n0.0.0~dev.27.1-1\nx86_64",
            "ohtia-quality\n0\n0.0.0~dev.27.1-1\naarch64",
        ]:
            with (
                patch.object(native, "command", return_value=output),
                self.assertRaises(ValueError),
            ):
                native.package_identity(
                    self.file.with_suffix(".rpm"), self.cell, self.record["version"]
                )

    def test_deb_dependency_plan_refuses_unrelated_install_removal_or_configuration(self):
        for plan in ("Inst libexample (1.0)", "Remv ohtia-quality", "Conf unrelated (1.0)"):
            with self.adapter(), patch.object(native, "command", return_value=plan) as execute:
                with self.assertRaises(ValueError):
                    self.install()
                self.assertEqual(execute.call_count, 1)
                self.assertEqual(execute.call_args.args[0][0], "apt-get")

    def test_deb_simulation_failure_never_activates_or_repairs_dependencies(self):
        with (
            self.adapter(),
            patch.object(native, "command", side_effect=ValueError("dependencies")) as execute,
        ):
            with self.assertRaises(ValueError):
                self.install()
            self.assertEqual(execute.call_count, 1)
            self.assertIn("--no-remove", execute.call_args.args[0])
            self.assertIn("--simulate", execute.call_args.args[0])

    def test_deb_refuses_native_downgrade_even_when_directly_invoked(self):
        outcomes = [
            SimpleNamespace(returncode=0, stdout="0.0.0~dev.27.2-1"),
            SimpleNamespace(returncode=0),
        ]
        with (
            self.adapter(),
            patch.object(native.subprocess, "run", side_effect=outcomes),
            patch.object(native, "command") as execute,
        ):
            with self.assertRaisesRegex(ValueError, "downgrade"):
                self.install()
            execute.assert_not_called()

    def test_deb_rechecks_lease_after_all_simulations_before_transition(self):
        with (
            self.adapter(),
            patch.object(native, "command", return_value="Inst ohtia-quality (test)") as execute,
            patch.object(
                native, "check_installation_admission", side_effect=[None, ValueError("stale")]
            ),
        ):
            with self.assertRaisesRegex(ValueError, "stale"):
                self.install()
            self.assertEqual(len(execute.call_args_list), 2)
            self.assertIn("--simulate", execute.call_args_list[-1].args[0])
            self.assertIn("--refuse-downgrade", execute.call_args_list[-1].args[0])

    def test_catalog_schema_must_match_authenticated_package_before_native_transaction(self):
        with (
            self.adapter(),
            patch.object(
                native,
                "package_inventory",
                return_value=SimpleNamespace(target_schema=3, migration_manifest_sha256="a" * 64),
            ),
            patch.object(native, "command") as execute,
        ):
            with self.assertRaisesRegex(ValueError, "schema"):
                self.install()
            execute.assert_not_called()

    def test_rpm_requires_exact_independently_pinned_keyring(self):
        fingerprint = "a" * 40
        for listing in ("", "b" * 40 + " other key", fingerprint + " ours\n" + "b" * 40 + " other"):
            with (
                self.adapter(".rpm"),
                patch.object(native, "command", return_value=listing) as execute,
            ):
                with self.assertRaises(ValueError):
                    self.install(rpm_keyring=self.trust, rpm_key_id=fingerprint)
                self.assertEqual(execute.call_count, 1)
        with self.adapter(".rpm"), patch.object(native, "command") as execute:
            with self.assertRaises(ValueError):
                self.install(rpm_keyring=self.trust)
            execute.assert_not_called()

    def test_rpm_rejects_unsigned_nokey_and_invalid_signatures(self):
        fingerprint = "a" * 40
        for output in (
            "package.rpm: digests OK",
            "package.rpm: NOKEY",
            "package.rpm: digests signatures NOT OK",
        ):
            with (
                self.adapter(".rpm"),
                patch.object(
                    native, "command", side_effect=[fingerprint + " our key", output]
                ) as execute,
            ):
                with self.assertRaises(ValueError):
                    self.install(rpm_keyring=self.trust, rpm_key_id=fingerprint)
                self.assertEqual(execute.call_count, 2)

    def test_rpm_native_signature_and_dependency_verification_precede_upgrade(self):
        fingerprint = "a" * 40
        events = []

        def execute(args, **_kwargs):
            events.append([str(argument) for argument in args])
            return (
                fingerprint + " our key"
                if "--list" in args
                else "package.rpm: digests signatures OK"
            )

        with self.adapter(".rpm"), patch.object(native, "command", side_effect=execute):
            self.install(
                rpm_keyring=self.trust,
                rpm_key_id=fingerprint,
                before_transition=lambda: events.append("transition"),
            )
        self.assertEqual(events[0][0], "rpmkeys")
        self.assertIn("--checksig", events[1])
        self.assertEqual(events[2], ["rpm", "--upgrade", "--test", str(self.file)])
        self.assertEqual(events[3], "transition")
        self.assertEqual(events[4], ["rpm", "--upgrade", str(self.file)])

    def test_rpm_repair_refuses_downgrade_and_reinstalls_only_same_registered_version(self):
        fingerprint = "a" * 40
        for current, ordering, success in (
            ("0.0.0~dev.27.2-1", "-1", False),
            ("0.0.0~dev.27.1-1", "0", True),
        ):
            commands = []

            def execute(args, **_kwargs):
                commands.append([str(arg) for arg in args])
                if "--list" in args:
                    return fingerprint + " expected key"
                if "--eval" in args:
                    return ordering
                return "package.rpm: digests signatures OK"

            with (
                self.adapter(".rpm"),
                patch.object(
                    native.subprocess,
                    "run",
                    return_value=SimpleNamespace(returncode=0, stdout="0\n" + current + "\n"),
                ),
                patch.object(native, "command", side_effect=execute),
            ):
                if success:
                    self.install(rpm_keyring=self.trust, rpm_key_id=fingerprint, repair=True)
                    self.assertEqual(commands[-2], ["rpm", "--reinstall", "--test", str(self.file)])
                    self.assertEqual(commands[-1], ["rpm", "--reinstall", str(self.file)])
                else:
                    with self.assertRaisesRegex(ValueError, "downgrade"):
                        self.install(rpm_keyring=self.trust, rpm_key_id=fingerprint, repair=True)
                    self.assertFalse(
                        any(
                            "--upgrade" in command or "--reinstall" in command
                            for command in commands
                        )
                    )

    def admission(self):
        directory = self.root / "update-acceptance"
        directory.mkdir()
        now = int(time.time() * 1000)
        lease = {"pid": os.getpid(), "nonce": "test", "owner": native.process_identity(os.getpid())}
        state = {
            "highest_version": self.record["version"],
            "catalog_sha256": "a" * 64,
            "last_accepted_ms": now - 1,
        }
        (directory / "operation.lock").write_text(json.dumps(lease))
        (directory / "accepted.json").write_text(json.dumps(state))
        self.record["admission"] = {
            "lease": lease,
            "state": state,
            "catalog_sha256": state["catalog_sha256"],
            "expires_ms": now + 60000,
        }
        return {"scratch_root": str(self.root), "home": str(self.root)}

    @unittest.skipUnless(sys.platform in {"linux", "darwin"}, "Native process identity")
    def test_activation_requires_live_same_birth_identity_matching_floor_and_unexpired_catalog(
        self,
    ):
        profile = self.admission()
        native.check_installation_admission(self.record, profile)
        for kind in ("floor", "lease", "identity", "expiry", "clock"):
            original = json.loads(json.dumps(self.record["admission"]))
            if kind == "floor":
                self.record["admission"]["state"]["highest_version"] = "0.0.0-dev.27.2"
            elif kind == "lease":
                self.record["admission"]["lease"]["nonce"] = "other"
            elif kind == "identity":
                self.record["admission"]["lease"]["owner"]["pid"] = 1
                (self.root / "update-acceptance/operation.lock").write_text(
                    json.dumps(self.record["admission"]["lease"])
                )
            elif kind == "expiry":
                self.record["admission"]["expires_ms"] = 1
            else:
                self.record["admission"]["state"]["last_accepted_ms"] += 600000
                (self.root / "update-acceptance/accepted.json").write_text(
                    json.dumps(self.record["admission"]["state"])
                )
            with self.assertRaises(ValueError):
                native.check_installation_admission(self.record, profile)
            self.record["admission"] = original
            (self.root / "update-acceptance/operation.lock").write_text(
                json.dumps(original["lease"])
            )
            (self.root / "update-acceptance/accepted.json").write_text(
                json.dumps(original["state"])
            )

    def test_archive_binding_rejects_same_version_different_payload_even_with_forged_inventory(
        self,
    ):
        manifest = b'[{"name":"0001_initial","sha256":"' + b"a" * 64 + b'"}]'
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as archive:
            for name, data in {
                "resources/app/package.json": b'{"version":"0.1.0"}',
                "resources/app/migrations/manifest.json": manifest,
            }.items():
                member = tarfile.TarInfo("./opt/ohtia-quality/" + name)
                member.size, member.mode = len(data), 0o644
                archive.addfile(member, io.BytesIO(data))
        payload = self.root / "installed"
        (payload / "resources/app/migrations").mkdir(parents=True)
        (payload / "resources/app/migrations/manifest.json").write_bytes(manifest)
        (payload / "resources/app/package.json").write_text('{"version":"0.1.0"}')

        def process(*_args, **_kwargs):
            return SimpleNamespace(
                stdout=io.BytesIO(stream.getvalue()),
                stderr=io.BytesIO(),
                wait=lambda **_: 0,
                poll=lambda: 0,
            )

        for suffix in (".deb", ".rpm"):
            with (
                self.subTest(format=suffix),
                patch.object(native.subprocess, "Popen", side_effect=process) as conversion,
            ):
                (payload / "resources/app/package.json").write_text('{"version":"0.1.0"}')
                native.verify_installed_payload(self.file.with_suffix(suffix), self.cell, payload)
                self.assertEqual(
                    conversion.call_args.args[0][0],
                    "dpkg-deb" if suffix == ".deb" else "rpm2archive",
                )
                (payload / "resources/app/package.json").write_text(
                    '{"version":"0.1.0", "different":true}'
                )
                (payload / "prepared.json").write_text(json.dumps(native.tree_inventory(payload)))
                with self.assertRaisesRegex(ValueError, "Installed bytes"):
                    native.verify_installed_payload(
                        self.file.with_suffix(suffix), self.cell, payload
                    )
        failed = process()
        failed.wait = lambda **_: 1
        with (
            patch.object(native.subprocess, "Popen", return_value=failed),
            self.assertRaisesRegex(ValueError, "conversion failed"),
        ):
            native.package_inventory(self.file.with_suffix(".rpm"), self.cell)

    def test_sealed_source_archive_rejects_modified_missing_and_undeclared_inputs(self):
        source = self.root / "source"
        source.mkdir()
        (source / "module.txt").write_text("sealed source")
        (source / ".gitignore").write_text("artifacts/\n")
        native.subprocess.run(["git", "init", "--quiet", str(source)], check=True)
        record = {
            "source_sha": "a" * 40,
            "files": {name: native.digest(source / name) for name in ("module.txt", ".gitignore")},
        }
        (source / "installation-inputs.json").write_text(json.dumps(record))
        with patch.object(native, "ROOT", source):
            self.assertEqual(native.source_identity(), record)
            (source / "artifacts").mkdir()
            (source / "artifacts/stale-output").write_text("previous build")
            self.assertEqual(native.source_identity(), record)
            (source / "module.txt").write_text("modified")
            with self.assertRaisesRegex(ValueError, "seal"):
                native.source_identity()
            (source / "module.txt").write_text("sealed source")
            (source / "undeclared.txt").write_text("extra")
            with self.assertRaisesRegex(ValueError, "undeclared"):
                native.source_identity()
            (source / "undeclared.txt").unlink()
            (source / "module.txt").unlink()
            with self.assertRaisesRegex(ValueError, "seal"):
                native.source_identity()

    def test_native_json_and_store_observation_refuse_aliases_hardlinks_devices_and_oversize(self):
        selected = self.root / "record.json"
        selected.write_text('{"safe":true}')
        self.assertEqual(native.read_bounded_json(selected), {"safe": True})
        self.assertEqual(native.observe_file(selected)["bytes"], selected.stat().st_size)
        with self.assertRaises(ValueError):
            native.read_bounded_json(selected, maximum=2)
        alias = self.root / "alias"
        alias.symlink_to(selected)
        for operation in (native.read_bounded_json, native.observe_file):
            with self.assertRaises(ValueError):
                operation(alias)
        link = self.root / "linked"
        os.link(selected, link)
        for operation in (native.read_bounded_json, native.observe_file):
            with self.assertRaises(ValueError):
                operation(selected)
        link.unlink()
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        for operation in (native.read_bounded_json, native.observe_file):
            with self.assertRaises(ValueError):
                operation(fifo)

    def test_native_smoke_cannot_install_before_native_profile_readmission(self):
        staged, cell = self.root / "staged.json", self.root / "cell.json"
        staged.write_text(json.dumps(self.record))
        cell.write_text("{}")
        with (
            patch.object(native, "command", side_effect=ValueError("unverified account")),
            patch.object(native, "install_staged") as install,
        ):
            with self.assertRaises(ValueError):
                native.exercise(
                    self.root / "runtime-profile.json",
                    cell,
                    staged,
                    self.root / "installed",
                    self.root / "evidence",
                )
            install.assert_not_called()

    def test_macos_observer_arguments_do_not_become_live_package_processes(self):
        payload = self.root / "installed"
        rows = [{"pid": 100}, {"pid": 200}, {"pid": 300}]
        listing = f"100 /usr/bin/python3\n200 {payload}/Ohtia.app/Contents/MacOS/Ohtia\n300 {payload}-other/helper\n"
        with (
            patch.object(native.sys, "platform", "darwin"),
            patch.object(native.quality_native, "processes", return_value=rows),
            patch.object(native, "command", return_value=listing),
        ):
            self.assertEqual(native.installed_processes(payload, []), [rows[1]])

    def interrupted_owner(self, directory):
        code = "import json,os,pathlib,sys,time; sys.path.insert(0,sys.argv[2]); import installation_native as native; directory=pathlib.Path(sys.argv[1]); lease={'pid':os.getpid(),'nonce':'killed-owner','owner':native.process_identity(os.getpid())}; (directory/'operation.lock').write_text(json.dumps(lease)+'\\n'); print('ready',flush=True); time.sleep(60)"
        child = subprocess.Popen(
            [sys.executable, "-u", "-c", code, str(directory), str(Path(native.__file__).parent)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        ready = select.select([child.stdout], [], [], 5)[0]
        if not ready or child.stdout.readline().strip() != "ready":
            child.kill()
            child.wait()
            self.fail("Synthetic operation owner did not become ready.")
        self.addCleanup(lambda: child.poll() is None and (child.kill(), child.wait()))
        self.addCleanup(child.stdout.close)
        self.addCleanup(child.stderr.close)
        return child

    def test_native_reconciliation_refuses_live_owner_and_recovers_sigkill_without_floor_reset(
        self,
    ):
        directory = self.root / "acceptance"
        directory.mkdir(mode=0o700)
        evidence = self.root / "retained"
        evidence.mkdir()
        state = {
            "sequence": 1,
            "catalog_sha256": "a" * 64,
            "highest_version": "0.0.0-dev.27.1",
            "last_accepted_ms": int(time.time() * 1000),
        }
        encoded = json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n"
        (directory / "accepted.json").write_text(encoded)
        child = self.interrupted_owner(directory)
        with self.assertRaisesRegex(ValueError, "still alive"):
            native.reconcile_state(directory, evidence)
        self.assertTrue((directory / "operation.lock").exists())
        child.kill()
        child.wait()
        result = native.reconcile_state(directory, evidence)
        self.assertEqual(result["state"], state)
        self.assertEqual((directory / "accepted.json").read_text(), encoded)
        self.assertFalse((directory / "operation.lock").exists())
        self.assertEqual(len(list(directory.glob("operation-reconciled-*.json"))), 1)

    def test_native_reconciliation_retains_signed_or_torn_partial_without_lowering_floor(self):
        for torn in (False, True):
            with self.subTest(torn=torn):
                directory = self.root / ("acceptance-torn" if torn else "acceptance-complete")
                directory.mkdir(mode=0o700)
                evidence = directory / "evidence"
                evidence.mkdir()
                node = """import fs from 'node:fs'; import path from 'node:path'; import {generateKeyPairSync,sign} from 'node:crypto'; import {execFileSync} from 'node:child_process';
const module=await import(process.argv[1]),directory=process.argv[2],evidence=process.argv[3],now=Date.now();
const keys=generateKeyPairSync('ed25519'),public_key=keys.publicKey.export({type:'spki',format:'pem'}).toString(),id=module.keyIdentity(public_key);
const catalog={schema_version:1,key_id:id,sequence:2,issued_ms:now-1000,expires_ms:now+60000,candidate:'b'.repeat(64),source_sha:'a'.repeat(40),version:'0.1.0',channels:['preview'],notes_sha256:'c'.repeat(64),packages:[{target:'linux-x64',profile:'ubuntu-24.04',format:'deb',filename:'qualified.deb',bytes:1,sha256:'d'.repeat(64),native_version:'0.1.0-1',schema:{source_min:0,source_max:1,target:1},queued_work_version:null}]};
const bytes=module.catalogBytes(catalog),signature=sign(null,bytes,keys.privateKey),trust={keys:[{id,public_key,revoked:false}]};
const admitted=module.verifyCatalog(bytes,signature,trust,{now_ms:now,execution:'internal',channel:'preview',preview_opt_in:true,previous:null,installed_version:null,target:'linux-x64',profile:'ubuntu-24.04',format:'deb',schema:0,queued_work_version:null});
fs.writeFileSync(path.join(evidence,'catalog.json'),bytes);fs.writeFileSync(path.join(evidence,'catalog.sig'),signature);fs.writeFileSync(path.join(evidence,'qualification-trust.json'),JSON.stringify(trust));fs.writeFileSync(path.join(evidence,'campaign.json'),JSON.stringify({cell:{target:'linux-x64',profile:'ubuntu-24.04'},attempts:[{attempt:1,format:'deb',catalogName:'catalog.json',signatureName:'catalog.sig'}]}));const owner=JSON.parse(execFileSync(process.argv[4],[process.argv[5],'lease-identity',String(process.pid)],{encoding:'utf8'}));
const rename=fs.renameSync; fs.renameSync=()=>{throw Object.assign(new Error('synthetic ENOSPC while committing accepted state'),{code:'ENOSPC'});};
try { await module.withAcceptanceState(directory,true,async(_previous,persist)=>persist(admitted),{owner}); throw new Error('Expected persistence failure'); }
catch(error) { if(error.code!=='ENOSPC') throw error; }
finally { fs.renameSync=rename; }
if(!fs.existsSync(path.join(directory,'operation.lock'))) throw new Error('Ordinary persistence failure lost its recovery owner');"""
                subprocess.run(
                    [
                        str(native.workspace.node_path()),
                        "--input-type=module",
                        "-e",
                        node,
                        (native.ROOT / "tooling/update-admission.mjs").as_uri(),
                        str(directory),
                        str(evidence),
                        sys.executable,
                        str(Path(native.__file__)),
                    ],
                    check=True,
                    timeout=15,
                )
                if torn:
                    (directory / "accepted.partial").write_bytes(b'{"sequence":')
                retained = (directory / "accepted.partial").read_bytes()
                previous = {
                    "sequence": 1,
                    "catalog_sha256": "a" * 64,
                    "highest_version": "0.0.0-dev.27.1",
                    "last_accepted_ms": 1,
                }
                (directory / "accepted.json").write_text(
                    json.dumps(previous, sort_keys=True, separators=(",", ":")) + "\n"
                )
                self.assertEqual(
                    native.lease_status(directory / "operation.lock")["status"], "ceased"
                )
                result = native.reconcile_state(directory, evidence)
                self.assertEqual(result["state"]["sequence"], 2)
                self.assertEqual(result["state"]["highest_version"], "0.1.0")
                copies = list(directory.glob("accepted-partial-reconciled-*.json"))
                self.assertEqual(len(copies), 1)
                self.assertEqual(copies[0].read_bytes(), retained)
                self.assertFalse((directory / "accepted.partial").exists())
                self.assertFalse((directory / "operation.lock").exists())

    @contextmanager
    def operator_fixture(self, pending=False, damaged=False):
        private = self.root / "operator-state"
        private.mkdir(mode=0o700)
        payload = private / "payload"
        payload.mkdir()
        (payload / "q").write_bytes(
            b"retained partial executable" if damaged else b"installed executable"
        )
        home = self.root / "native-home"
        home.mkdir()
        scratch = home / "scratch"
        scratch.mkdir(mode=0o700)
        research = home / "ohtia"
        research.mkdir()
        (research / "ohtia.db3").write_bytes(b"unchanged synthetic database bytes")
        profile_file = scratch / "runtime-profile.json"
        profile_file.write_text("{}")
        cell_file = scratch / "cell.json"
        cell = {"target": "linux-x64", "profile": "ubuntu-24.04"}
        cell_file.write_text(json.dumps(cell))
        profile = {
            "target": "linux-x64",
            "home": str(home),
            "scratch_root": str(scratch),
            "research_root": str(research),
        }
        account = SimpleNamespace(
            pw_uid=os.getuid(), pw_gid=os.getgid(), pw_name="fixture", pw_dir=str(home)
        )
        identity = {"uid": account.pw_uid, "profile": str(profile_file)}
        record = json.loads(json.dumps(self.record))
        download = scratch / "download.deb"
        download.write_bytes(self.file.read_bytes())
        record["file"] = str(download)
        archive = private / (record["sha256"] + ".deb")
        archive.write_bytes(self.file.read_bytes())
        record["admission"] = {
            "candidate": "c" * 64,
            "source_schema": 2,
            "installed_version": record["version"],
            "expires_ms": int(time.time() * 1000) + 60000,
        }
        directory = scratch / "update-acceptance"
        directory.mkdir(mode=0o700)
        lease = {
            "pid": os.getpid(),
            "nonce": "operator-fixture",
            "owner": native.process_identity(os.getpid()),
        }
        state = {
            "sequence": 2,
            "highest_version": record["version"],
            "catalog_sha256": "d" * 64,
            "last_accepted_ms": int(time.time() * 1000) - 1,
        }
        (directory / "operation.lock").write_text(json.dumps(lease))
        (directory / "accepted.json").write_text(json.dumps(state))
        record["admission"].update(lease=lease, state=state, catalog_sha256=state["catalog_sha256"])
        staged = scratch / "staged.json"
        staged.write_text(json.dumps(record))
        receipt = scratch / "operator-ready-1-operator-fixture.json"
        approval = {
            "identity": identity,
            "sha256": record["sha256"],
            "bytes": record["bytes"],
            "archive": archive.name,
            "version": record["version"],
            "candidate": "c" * 64,
            "target": cell["target"],
            "profile": cell["profile"],
            "schema": record["entry"]["schema"],
            "migration_manifest_sha256": record["migration_manifest_sha256"],
        }
        approval_file = private / ("approved-" + record["sha256"] + ".json")
        approval_file.write_text(json.dumps(approval))
        current = {
            "schema": 2,
            "installed_version": record["version"],
            "store_files": native.store_snapshot(profile),
        }
        owner = {"identity": identity, "archive": archive.name}
        if pending:
            old = private / ("e" * 64 + ".deb")
            old.write_bytes(b"previous selected archive")
            owner.update(
                archive=old.name,
                pending=archive.name,
                preflight={"current": current, "store": native.store_snapshot(profile)},
            )
        (private / "owner.json").write_text(json.dumps(owner))
        original_stat, original_fstat = Path.stat, os.fstat

        def root_info(info):
            values = list(info)
            values[4] = 0
            return os.stat_result(values)

        def path_stat(file, *args, **kwargs):
            info = original_stat(file, *args, **kwargs)
            return root_info(info) if file.is_relative_to(private) else info

        def fd_stat(fd):
            info = original_fstat(fd)
            # Model administrator-owned files while keeping all actual writes in this temporary tree.
            for file in (private, *private.rglob("*")):
                observed = original_stat(file)
                if (observed.st_dev, observed.st_ino) == (info.st_dev, info.st_ino):
                    return root_info(info)
            return info

        with ExitStack() as stack:
            stack.enter_context(patch.object(operator, "PRIVATE", private))
            stack.enter_context(patch.object(operator, "PAYLOAD", payload))
            stack.enter_context(patch.object(operator, "trusted_helper"))
            stack.enter_context(patch.object(operator, "configured_package"))
            stack.enter_context(patch.object(operator, "deb_idle_locks", return_value=[]))
            stack.enter_context(
                patch.object(operator, "profile_input", return_value=(profile, account))
            )
            stack.enter_context(
                patch.object(operator.workspace, "target_id", return_value="linux-x64")
            )
            stack.enter_context(
                patch.object(
                    native.platform,
                    "freedesktop_os_release",
                    return_value={"ID": "ubuntu", "VERSION_ID": "24.04"},
                )
            )
            stack.enter_context(patch.object(Path, "stat", path_stat))
            stack.enter_context(patch.object(os, "fstat", fd_stat))
            stack.enter_context(patch.object(os, "getuid", return_value=0))
            stack.enter_context(patch.object(native, "assert_quiescent"))
            stack.enter_context(
                patch.object(
                    operator.quality_native,
                    "prepared_record",
                    return_value={
                        "version": 1,
                        "target": "linux-x64",
                        "executable": "q",
                        "app": "resources/app",
                        "files": {},
                        "links": {},
                    },
                )
            )
            yield SimpleNamespace(
                private=private,
                payload=payload,
                profile=profile,
                archive=archive,
                record=record,
                staged=staged,
                receipt=receipt,
                approval=approval_file,
                current=current,
                arguments=[
                    "installation_operator.py",
                    str(profile_file),
                    str(cell_file),
                    str(staged),
                    str(receipt),
                ],
            )

    def test_operator_main_reuses_exact_already_active_payload_without_rerunning_managers(self):
        with (
            self.operator_fixture() as fixture,
            patch.object(sys, "argv", fixture.arguments),
            patch.object(native, "verify_installed_payload", return_value="binding"),
            patch.object(operator, "store_preflight", return_value=fixture.current),
            patch.object(native, "install_staged") as install,
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(operator.main(), 0)
            install.assert_not_called()
            self.assertEqual(
                json.loads(fixture.receipt.read_text())["activation"], "already-active"
            )

    def test_operator_resumes_settled_first_install_or_upgrade_from_journey_pretransition_record(
        self,
    ):
        original = self.root
        for previous in (None, "0.0.0-dev.26.2"):
            with (
                self.subTest(previous=previous),
                tempfile.TemporaryDirectory(dir=original) as temporary,
            ):
                self.root = Path(temporary)
                try:
                    with self.operator_fixture() as fixture:
                        if previous is None:
                            (Path(fixture.profile["research_root"]) / "ohtia.db3").unlink()
                        source_schema = 0 if previous is None else 2
                        source = {"schema": source_schema, "installed_version": previous}
                        snapshot = native.store_snapshot(fixture.profile)
                        owner_file = fixture.private / "owner.json"
                        owner = json.loads(owner_file.read_text())
                        owner["preflight"] = {"current": source, "store": snapshot}
                        owner_file.write_text(json.dumps(owner))
                        fixture.record["admission"].update(
                            source_schema=source_schema, installed_version=previous
                        )
                        fixture.staged.write_text(json.dumps(fixture.record))
                        with (
                            patch.object(sys, "argv", fixture.arguments),
                            patch.object(
                                native, "verify_installed_payload", return_value="binding"
                            ),
                            patch.object(operator, "store_preflight") as inspect,
                            patch.object(native, "install_staged") as install,
                            redirect_stdout(io.StringIO()),
                        ):
                            self.assertEqual(operator.main(), 0)
                            inspect.assert_not_called()
                            install.assert_not_called()
                            self.assertEqual(
                                json.loads(fixture.receipt.read_text())["activation"],
                                "already-active",
                            )
                            self.assertEqual(
                                json.loads(owner_file.read_text())["preflight"]["store"], snapshot
                            )
                finally:
                    self.root = original

    def test_operator_rejects_old_settled_checkpoint_after_store_changed(self):
        with self.operator_fixture() as fixture:
            owner_file = fixture.private / "owner.json"
            owner = json.loads(owner_file.read_text())
            source = {"schema": 2, "installed_version": "0.0.0-dev.26.2"}
            owner["preflight"] = {
                "current": source,
                "store": native.store_snapshot(fixture.profile),
            }
            owner_file.write_text(json.dumps(owner))
            fixture.record["admission"]["installed_version"] = source["installed_version"]
            fixture.staged.write_text(json.dumps(fixture.record))
            (Path(fixture.profile["research_root"]) / "ohtia.db3-wal").write_bytes(b"new write")
            with (
                patch.object(sys, "argv", fixture.arguments),
                patch.object(native, "verify_installed_payload", return_value="binding"),
                patch.object(operator, "store_preflight", return_value=fixture.current) as inspect,
                patch.object(native, "install_staged") as install,
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(operator.main(), 1)
                inspect.assert_called_once()
                install.assert_not_called()
                self.assertFalse(fixture.receipt.exists())

    def test_operator_refuses_store_write_between_preflight_and_settled_quiescence(self):
        with self.operator_fixture() as fixture:
            owner_file = fixture.private / "owner.json"
            owner = json.loads(owner_file.read_text())
            source = {"schema": 2, "installed_version": "0.0.0-dev.26.2"}
            owner["preflight"] = {
                "current": source,
                "store": native.store_snapshot(fixture.profile),
            }
            owner_file.write_text(json.dumps(owner))
            retained_owner = owner_file.read_bytes()
            fixture.record["admission"]["installed_version"] = source["installed_version"]
            fixture.staged.write_text(json.dumps(fixture.record))

            def concurrent_writer(_payload):
                (Path(fixture.profile["research_root"]) / "ohtia.db3").write_bytes(
                    b"concurrent write completed before quiescence"
                )

            with (
                patch.object(sys, "argv", fixture.arguments),
                patch.object(native, "verify_installed_payload", return_value="binding"),
                patch.object(operator, "store_preflight") as inspect,
                patch.object(native, "assert_quiescent", side_effect=concurrent_writer),
                patch.object(native, "install_staged") as install,
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(operator.main(), 1)
                inspect.assert_not_called()
                install.assert_not_called()
                self.assertEqual(owner_file.read_bytes(), retained_owner)
                self.assertFalse(fixture.receipt.exists())

    def test_operator_main_rejects_unregistered_or_mutated_user_requests_before_installation(self):
        with (
            self.operator_fixture() as fixture,
            patch.object(sys, "argv", fixture.arguments),
            patch.object(native, "install_staged") as install,
            patch.object(operator, "store_preflight") as inspect,
            redirect_stdout(io.StringIO()),
        ):
            approval = fixture.approval.read_bytes()
            fixture.approval.unlink()
            self.assertEqual(operator.main(), 1)
            fixture.approval.write_bytes(approval)
            record = fixture.record
            original_version = record["entry"]["native_version"]
            record["entry"]["native_version"] = "999.0.0-1"
            fixture.staged.write_text(json.dumps(record))
            self.assertEqual(operator.main(), 1)
            record["entry"]["native_version"] = original_version
            record["migration_manifest_sha256"] = "f" * 64
            fixture.staged.write_text(json.dumps(record))
            self.assertEqual(operator.main(), 1)
            record["migration_manifest_sha256"] = "a" * 64
            fixture.staged.write_text(json.dumps(record))
            Path(record["file"]).write_bytes(b"tampered staged package")
            self.assertEqual(operator.main(), 1)
            install.assert_not_called()
            inspect.assert_not_called()

    def test_operator_main_repairs_damaged_payload_from_unchanged_verified_store_without_executing_it(
        self,
    ):
        with self.operator_fixture(pending=True, damaged=True) as fixture:
            done = False

            def binding(*_args, **_kwargs):
                if not done:
                    raise ValueError("partial installed bytes")
                return "binding"

            def install(_record, _cell, destination, **kwargs):
                nonlocal done
                self.assertTrue(kwargs["repair"])
                kwargs["before_transition"]()
                done = True
                return destination

            with (
                patch.object(sys, "argv", [*fixture.arguments, "--repair-pending"]),
                patch.object(native, "verify_installed_payload", side_effect=binding),
                patch.object(operator, "store_preflight") as inspect,
                patch.object(native, "install_staged", side_effect=install),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(operator.main(), 0)
                inspect.assert_not_called()
                failed = list(fixture.private.glob("failed-*"))
                self.assertEqual(len(failed), 1)
                self.assertEqual(
                    (failed[0] / "payload/q").read_bytes(), b"retained partial executable"
                )
                self.assertEqual(
                    (failed[0] / "store/ohtia.db3").read_bytes(),
                    b"unchanged synthetic database bytes",
                )
                self.assertEqual(json.loads(fixture.receipt.read_text())["activation"], "installed")

    def test_operator_reconfigures_fully_unpacked_pending_bytes_and_never_acknowledges_them_early(
        self,
    ):
        with self.operator_fixture(pending=True) as fixture:

            def install(_record, _cell, destination, **kwargs):
                self.assertTrue(kwargs["repair"])
                self.assertFalse(fixture.receipt.exists())
                kwargs["before_transition"]()
                return destination

            with (
                patch.object(sys, "argv", [*fixture.arguments, "--repair-pending"]),
                patch.object(native, "verify_installed_payload", return_value="binding"),
                patch.object(operator, "store_preflight") as inspect,
                patch.object(native, "install_staged", side_effect=install) as execute,
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(operator.main(), 0)
                execute.assert_called_once()
                inspect.assert_not_called()
                self.assertEqual(json.loads(fixture.receipt.read_text())["activation"], "installed")

    def test_operator_refuses_unconfigured_dpkg_even_when_all_payload_bytes_match(self):
        with (
            patch.object(
                operator.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=0, stdout="install ok unpacked\n0.0.0~dev.27.1-1"
                ),
            ),
            self.assertRaisesRegex(ValueError, "unconfigured"),
        ):
            operator.configured_package({"profile": "ubuntu-24.04"}, "0.0.0-dev.27.1")

    def test_operator_store_inspection_uses_derived_descriptor_and_coupled_snapshot_outside_user_scratch(
        self,
    ):
        payload = self.root / "payload"
        (payload / "resources/app").mkdir(parents=True)
        (payload / "resources/app/package.json").write_text('{"version":"0.0.0-dev.27.1"}')
        (payload / "prepared.json").write_text('{"executable":"../../foreign"}')
        research = self.root / "research"
        research.mkdir()
        (research / "ohtia.db3").write_bytes(b"unchanged")
        scratch = self.root / "scratch-alias"
        scratch.symlink_to(research, target_is_directory=True)
        profile = {
            "home": str(self.root),
            "scratch_root": str(scratch),
            "research_root": str(research),
        }
        account = SimpleNamespace(
            pw_uid=os.getuid(), pw_gid=os.getgid(), pw_name="fixture", pw_dir=str(self.root)
        )
        derived = {"executable": "quality", "app": "resources/app"}
        mutation = False

        def observe(arguments, **_kwargs):
            output, descriptor = Path(arguments[-2]), Path(arguments[-1])
            self.assertFalse(output.is_relative_to(self.root))
            self.assertEqual(json.loads(descriptor.read_text()), derived)
            self.assertEqual(arguments[4], str(payload / "quality"))
            output.write_text('{"schema":2,"installed_version":"0.0.0-dev.27.1"}')
            if mutation:
                (research / "ohtia.db3-wal").write_bytes(b"concurrent write")

        def descriptor_publish(file, value):
            file.write_text(json.dumps(value))
            file.chmod(0o644)

        with (
            patch.object(operator, "PAYLOAD", payload),
            patch.object(native, "assert_quiescent"),
            patch.object(operator.quality_native, "prepared_record", return_value=derived),
            patch.object(operator, "publish", side_effect=descriptor_publish),
            patch.object(operator.subprocess, "run", side_effect=observe),
            patch.object(os, "chown", side_effect=AssertionError("path chown forbidden")),
        ):
            result = operator.store_preflight(profile, account, {"target": "linux-x64"})
            self.assertEqual(result["store_files"], native.store_snapshot(profile))
            mutation = True
            with self.assertRaisesRegex(ValueError, "changed during"):
                operator.store_preflight(profile, account, {"target": "linux-x64"})

    def test_operator_main_refuses_changed_store_instead_of_reusing_old_schema_inspection(self):
        with self.operator_fixture(pending=True, damaged=True) as fixture:
            (Path(fixture.profile["research_root"]) / "ohtia.db3").write_bytes(b"changed data")
            with (
                patch.object(sys, "argv", [*fixture.arguments, "--repair-pending"]),
                patch.object(native, "verify_installed_payload", side_effect=ValueError("partial")),
                patch.object(native, "install_staged") as install,
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(operator.main(), 1)
                install.assert_not_called()
                self.assertFalse(fixture.receipt.exists())

    def test_operator_rejects_linked_receipt_directory_and_preserves_unrelated_target(self):
        directory = self.root / "evidence"
        directory.mkdir()
        link = self.root / "alias"
        link.symlink_to(directory, target_is_directory=True)
        with self.assertRaises(OSError):
            operator.publish(link / "receipt.json", {}, parent_uid=os.getuid())
        self.assertFalse((directory / "receipt.json").exists())
        operator.publish(directory / "receipt.json", {"status": "passed"}, parent_uid=os.getuid())
        self.assertEqual(json.loads((directory / "receipt.json").read_text()), {"status": "passed"})


if __name__ == "__main__":
    unittest.main()
