---
type: Playbook
title: Native foundation qualification
description: Assemble non-shipping native probes, admit independent profiles and retain complete target evidence without claiming partial native qualification.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: electron-esm-entry
    resource: https://github.com/electron/electron/blob/v45.0.0/lib/browser/init.ts
    title: Selected Electron main-entry loader
  - id: csp-report-url
    resource: https://www.w3.org/TR/CSP/#strip-url-for-use-in-reports
    title: CSP violation URL serialization
---

# Native foundation qualification

## Scope and authority

[STORY-001-018](epics/EPIC-001-desktop-foundation/STORY-001-018-qualify-the-native-foundation-targets.md) owns D1b. Its inputs are the reviewed [foundation contract](desktop-foundation-contract.md), [target manifest](../config/desktop/targets.json), [toolchain](../config/desktop/toolchain.json), [numeric policy](../config/desktop/resource-policy.json), and the [locked workspace](developer-workspace.md) on the actual consumer base. PRIN-004–007, PRIN-011, PRIN-013 and PRIN-016 require identified evidence, honest coverage and preserved private work. A compiled probe, a cross-built bundle or a passing unit test is not a native result.

The non-shipping [probe package](../tools/desktop-probes/package.json) uses the root pnpm lock and common build, type and lint commands. Product packages cannot import it through their boundary policies, and the local library archive uses only declared product outputs. The probe is disposable qualification code; later runtime and storage implementations are built from scratch against their contracts.

The [native foundation report](native-foundation-report.md) contains the observed qualification results and engineering consequences. This playbook owns the repeatable procedure.

## Assemble without executing

Run frozen workspace setup and checks in the task worktree. Assembly may occur on another CPU: it downloads only the selected pinned Electron ZIP, verifies its SHA-256, preserves internal framework links, strips special executable bits, copies the probe and selected binding, and reads actual executable/addon headers. It never launches those binaries, selects a stable profile or reads update feeds.

```bash
python3 scripts/workspace.py setup
python3 scripts/workspace.py run check
python3 scripts/workspace.py run probes:bundle linux-x64 artifacts/desktop-probes/linux-x64
```

Select a declared target ID and use only its enumerated native distribution/session profiles. Ubuntu 26.04 and Debian 13 are each selected on ARM64 and x86-64, with independent native evidence for every distribution and CPU. The destination must not exist; failed assemblies retain their attempted inputs for inspection. `prepared.json` records the complete source-input hashes, executable path, runtime archive hash, runtime file inventory, native binding hash, expected embedded runtimes and SQLite source identity from the locked binding source. Preserve the directory and original ZIP. Native run preparation creates a fresh attempt instead of mutating a shared bundle. No installer, distribution signature or automatic update is produced by this command.

## Provision an independent native profile

Before any qualification executable, an operator provisions and inspects an independent OS account or native VM with separate native configuration, research and scratch roots. Merely changing `HOME`, using a container, or selecting another data directory in the ordinary profile is insufficient. Do not copy credentials, research, configuration, tool caches or environment files. Use a clean checkout, empty checkout-local tool/dependency/browser caches and synthetic or explicitly permitted public fixtures. Record physical or virtual hardware, native host/guest CPU, acceleration and absence of emulation.

The required profiles come from the target manifest: Ubuntu has both Wayland and X11 on ext4; Fedora Workstation uses GNOME Wayland, SELinux enforcing and Btrfs; Windows uses the admitted Windows 11 client baseline on NTFS; macOS uses the enumerated admitted families on native Intel or Apple Silicon with APFS and WindowServer. The required scope expands into thirteen OS/CPU/profile/backend records; optional Apple Intel, Windows ARM64 and the admitted macOS 15 candidate remain outside the completion gate. Optional native executions retain the same admission and evidence checks. Changes to admitted vendor-supported families require a reviewed contract update. A different desktop or an unmodified server image does not replace a required profile. Official desktop packages may provision a native provider image when the actual OS/edition, package provenance, filesystem, compositor and enforcing security policy are independently verified and retained; this does not establish an ISO boot or physical GPU result.

For a Fedora ISO installation, authenticate the vendor checksum signature and compare the actual ISO hash with the target manifest. For a provider image provisioned with official Workstation packages, verify the vendor repository/package signatures and actual Workstation identity, Btrfs, GNOME Wayland and enforcing SELinux; retain the original provider-image provenance and state that the ISO was not the boot source. On Ubuntu, provision the reviewed executable-path-specific AppArmor user-namespace allowance through an inspected native installation path. Never use root Electron execution, `--no-sandbox`, a SUID fallback, permissive SELinux or blanket policy changes. Host package-manager, display and filesystem tools are native prerequisites whose identities, versions and dependencies must be recorded; assembly does not provision or certify them.

In the independently inspected stable configuration, store and recovery roots, place only a synthetic `.ohtia-native-probe-sentinel` file and record its SHA-256. Do not hash or copy research files. The operator must identify the actual stable roots, including recovery storage and aliases; empty lookalike directories do not establish protection of the real profile. Keep the resulting admission and evidence under ignored task data. Native execution reads only these explicitly selected sentinel bytes and verifies them before and after the attempt.

Create `tmp/native-admission.json` with the following shape, substituting actual inspected paths, observations, hashes and the inspecting operator's identity. The sample is a schema illustration, not an approved profile. All named directories must already exist, be absolute and unaliased, and the configuration/research/scratch roots must be disjoint from the repository and every stable root. Unix paths must be account-owned; native ACL ownership and case/Unicode/reparse aliases also require the manual host inspection.

`inspected_by` and the case record's `reviewed_by` accept `human:<id>` or `agent:<id>`, where the nonempty identifier contains only ASCII letters, digits and hyphens; for example, `agent:codex`. These declarations identify the inspecting or reviewing operator and never populate or authorize a document's OKF human `verified` declaration.

```json
{
  "schema_version": 1,
  "kind": "independent-native-profile",
  "inspected_by": "human:replace-with-reviewer",
  "native": true,
  "fixtures": "synthetic-or-permitted-public",
  "target": "linux-x64",
  "profile": "ubuntu-24.04",
  "backend": "wayland",
  "home": "/home/native-probe",
  "configuration_root": "/home/native-probe/.config",
  "research_root": "/home/native-probe/research",
  "scratch_root": "/home/native-probe/scratch",
  "stable_roots": {
    "configuration": { "root": "/stable/configuration", "sentinel_sha256": "replace-with-sha256" },
    "store": { "root": "/stable/store", "sentinel_sha256": "replace-with-sha256" },
    "recovery": { "root": "/stable/recovery", "sentinel_sha256": "replace-with-sha256" }
  },
  "manual_checks": {
    "independent_account_or_vm": true,
    "no_emulation": true,
    "local_owned_unsynchronized_volumes": true,
    "no_credentials": true,
    "stable_roots_complete": true,
    "native_security_and_display": true
  },
  "host_evidence": { "file": "host-evidence.json", "sha256": "replace-with-sha256" },
  "hardware": {
    "cpu_model": "record actual model",
    "logical_cpus": 4,
    "ram_gib": 8,
    "free_gib": 20
  },
  "network": { "cache": "empty", "throughput_mbit_s": 100, "latency_ms": 100 }
}
```

`host-evidence.json` contains the actual OS/build, distribution/variant, kernel/libc, native and executable CPU observations, physical/VM identity, filesystem and ownership/ACL/alias checks, display/compositor/backend observations, sandbox policy and dependency inspection. Include native tool versions/digests and the commands/results supporting the manual checks. Record only synthetic or permitted public fixture paths; exclude credentials, private paths and researcher material. Admission checks the file hash and the operator's explicit declarations; it cannot independently authenticate an operator's identity or prove a VM/desktop configuration from a declaration.

## Prepare and run on the admitted host

Log into that independent account. On Windows use the native Python command and approved PowerShell route from the workspace guide. Use the same frozen source inputs on each host.

```bash
python3 scripts/workspace.py run probes:prepare tmp/native-admission.json
python3 scripts/workspace.py run probes:run tmp/native-admission.json /absolute/scratch/attempt-id
```

Preparation prints the fresh attempt directory. It checks manual admission, fixed account home/configuration, real disjoint paths, all three stable sentinels and source inputs before downloading or assembling. Run rechecks admission, the prepared manifest, every packaged file and unchanged source/lock hashes before launching. Linux uses the target manifest's runtime arguments and preserves `XDG_SESSION_TYPE` for automatic native display selection without forcing an Ozone platform. The child environment excludes Node injection hooks, provider credentials and update settings. Results remain in the independent scratch directory.

Native stdout and stderr flow to the launcher output, including failures before the JavaScript entry can write a result. Failure messages may identify the admitted public fixture paths; review retained diagnostics before any separately authorized publication. Redirect the common run command's output to an explicitly selected evidence file when retaining startup diagnostics; the launcher never selects an unknown log root. Use only the admitted synthetic or permitted public fixtures.

The main ESM entry schedules the asynchronous probe and returns from module evaluation before waiting for native application readiness. The selected loader completes main-module import before notifying native startup; awaiting `app.whenReady()` at module top level creates a readiness cycle.[^electron-esm-entry]

The packaged probe creates a sandboxed, context-isolated renderer with no Node integration, an ephemeral session, denied permissions/navigation/window creation and an exact local asset allowlist/CSP. Its narrow private preload reports isolation only from the expected live main frame. The main process checks privileged globals and denied local resources, then supervises an actual Electron utility process. The utility compares embedded Node/Chromium/V8/module ABI, binding digest, SQLite version/source and required compilation options; it exercises file-backed foreign keys, writer exclusion, migration rollback, commit, backup and reopen. The utility schedules its asynchronous journey without blocking module evaluation. After closing its databases, it sends its result and waits for the parent's private acknowledgement before exiting with the recorded success or failure code; the parent retains the message and verifies that exit. It also observes same-directory replacement, file synchronization and parent-directory synchronization. A failed Windows directory sync is recorded as unproven, requiring the native equivalent's separate evidence. The renderer CSP observation retains the actual violation and requires an enforced `connect-src` denial. CSP serializes a blocked non-HTTP(S) URL as its scheme, so the custom-protocol violation must identify `ohtia-probe`; the separate request-boundary observation checks cancellation of the exact forbidden resource.[^csp-report-url]

`observations/progress.jsonl` retains bounded stage checkpoints before native waits, so the last entered stage survives a supervisor timeout even when the final result is absent. The execution receipt retains its digest when present; the outer measurement deadline remains unchanged. `observations/runtime.json` records the actual observations, and `execution.json` records the unique prepared attempt identifier, exit, elapsed time, input integrity and sentinel recheck. Preparation retains the original admission and its host evidence inside the attempt. The native execution receipt binds the actually observed post-run runtime inventory, including its native file modes; reconciliation checks that it matches the original inventory instead of reinterpreting Windows modes or macOS framework links on another OS. Unreadable receipt inputs leave a controlled incomplete execution receipt whenever its destination remains writable. Preserve the original native runtime separately for artifact inspection. All hosts use the same frozen source files and locks; a source-input change requires affected evidence to be repeated on the consumer inputs.

These execution files explicitly remain unqualified. POSIX supervision observes and cleans the original process group and reports full-tree cessation as unverified: a descendant can create a separate session. The mandatory native `tree-cessation` observation must account for such descendants independently. Windows creates a kill-on-close job before resuming the suspended executable and observes active job processes. Neither a requested backend, a JavaScript sandbox flag, successful utility exit nor a root-process memory value establishes the full native sandbox, backend, tree, durability or resource obligations.

On Ubuntu, after preparation, inspect the exact executable path in `prepared.json` and provision only its reviewed path-specific AppArmor allowance through the native fixture's inspected installation procedure. A new attempt path requires a corresponding reviewed profile and load observation; do not substitute a wildcard allowance. Retain profile bytes/digest, ownership, load outcome and the actual sandbox observation with that attempt. Run each clean setup journey from a fresh independent profile or VM snapshot; declare any retained Electron state in repeated negative attempts instead of redirecting its fixed configuration root.

The default `journey` scenario uses one window and a fresh synthetic store. Its private preload bridge reads actual ready/runtime status and appearance, records the initial native and renderer color preference, selects the opposite actual color scheme, and observes the renderer change before the existing SQLite/publication journey and shutdown. A `system` preference that already resolves to dark must therefore change to light. This is disposable qualification behavior, not the product application-port implementation. The bridge accepts only the appearance enum before privileged IPC; main independently validates exact request shape, canonical byte bounds and actual contents/frame/URL identity. The report requires this initial journey in its positive anchor record; an adversarial scenario cannot replace that anchor.

Prepare separate immutable attempts for the additional native scenarios:

```bash
python3 scripts/workspace.py run probes:prepare -- tmp/native-admission.json --scenario ipc
python3 scripts/workspace.py run probes:prepare -- tmp/native-admission.json --scenario utility-crash
```

Run each printed attempt through the same admitted `probes:run` command. `ipc` first verifies the normal private journey, then exercises renderer-side oversized-input rejection, deliberately malformed raw requests from the trusted test preload, a same-origin foreign contents/frame, a denied privileged renderer import and prevented navigation. A temporary hidden second window belongs only to this adversarial scenario; it is outside the default one-window resource journey. Payloads remain synthetic, and rejected oversized bytes are never retained in diagnostics. `utility-crash` deliberately terminates its own newly spawned utility, records the actual PID/termination request and retains the failed runtime/launcher receipts. Its expected nonzero launch outcome is negative evidence, never a passing positive anchor. Separate OS observation must still establish full-tree cessation and resources. Keep all attempt identities and exact inventories with the associated case evidence.

For the separate Playwright control case, prepare `--scenario playwright` and use the same admitted `probes:run` command. The launcher selects the repository's [native controller](../tools/desktop-probes/playwright-control.mjs) and root workspace's pinned Playwright dependency. It uses the exact prepared executable with `chromiumSandbox: true` and removes the default media override with `colorScheme: null`, inspects the native runtime, document and private status bridge, and emits the private `ohtia-probe-control-ready` application event from main-process evaluation. The renderer bridge cannot release that gate. The controller retains its actual debugging arguments, native identity, observations and exit in `playwright-control.json`; `execution.json` binds its hash. The common deadline also covers failed attachment and missing control output. This instrumented run cannot replace the default resource anchor. Retain controller source and detailed native outputs alongside the admission and inventory evidence.

The utility exclusively reserves its synthetic database and backup paths before opening them with SQLite. A preexisting file, symlink or hardlink is refused without opening its target or changing existing bytes, including an unexpected newer-schema fixture. This is a fresh-probe preservation boundary, not the product's future existing-store or migration admission implementation.

## Native Linux quality packages

After frozen setup and a fresh admitted `journey` preparation, construct the distribution's synthetic native package through the same workspace entry. Ubuntu uses `deb`; Fedora uses `rpm`. Select a distinct development version using ADR-0038's vocabulary and retain the printed delivery directory and its `package-receipt.json`.

```bash
python3 scripts/workspace.py run probes:package -- tmp/native-admission.json /absolute/scratch/attempt-id --format deb --version 0.0.0-dev.32.1
```

The [package harness](../scripts/desktop_delivery.py) preserves the original prepared runtime and packages a separate copy under the fixed `/opt/ohtia-native-probe` identity. It uses the pinned builder, the single workspace lock and Linux helper artifacts declared under that builder in the canonical toolchain. Their release, filenames and checksums must match the installed locked builder implementation. Inspect that helper's declared native prerequisites and verify the corresponding vendor packages before building; the harness performs no OS-package installation. Helper downloads and native build time are recorded separately; undeclared builder downloads fail. Extraction and construction retain their complete supervision results; timeout or remaining-process evidence fails construction even when the root exit code is zero. The final admission check remains bound to the original declaration digest. The runtime copy and the builder's separate icon assets receive non-group-writable public package modes, without changing either source's modes; the builder also uses an explicit package-construction umask. Inspect final archive members to verify those modes rather than inferring them from the input copy. The package uses repository-owned maintainer scripts, never the stock SUID or best-effort policy templates. DEB scripts require exact-path AppArmor profile admission and strict load/removal. Removal verifies the exact profile file and kernel state; it unloads a present policy and can remove an exact file left behind by an interrupted load, while read errors still fail. The admitted distribution profile is embedded into generated maintainer scripts rather than inherited from the invoking shell, and its native OS identity is checked before package payload changes. Ubuntu 24.04 and Ubuntu 26.04 use the exact-path AppArmor allowance. Debian 13 on each CPU verifies native AppArmor and namespace support, refuses an unexpected Ubuntu allowance and leaves global policy unchanged. RPM scripts require enforcing SELinux and native label restoration/readback. These checks do not establish runtime sandbox acceptance by themselves.

Construction performs no administrator installation, update, signing or public-feed access. Inspect the resulting package's identity, dependencies, complete file/license inventory, maintainer scripts, profile bytes and native version/revision before explicit installation in the disposable VM. Keep the ordinary application user separate from the fixture administrator. Native install/update, denied dependencies/authorization, signature and target/version/schema refusals, interruption and recovery remain observations required by `installer-updater-feasibility`; a successful package receipt is only construction evidence. Final privileged transitions and official trust remain with STORY-001-013.

## Complete native cases and release records

Keep every failed attempt and its input identities. Repeat corrected attempts in new directories. Never repair a failed qualification by changing a lock, engine, filesystem, backend or target silently. Correct the owning contract and affected consumers through review when the selected mechanism fails.

Each canonical `journey` attempt needs `native-cases.json`, with exactly `reviewed_by`, `cases` and `scenarios`. `reviewed_by` identifies the human or agent operator who explicitly reviewed the current observations. Each case maps to `{ "result": "pass", "evidence": { "file": "relative-evidence-file", "sha256": "actual-sha256" } }` only after its reproducible evidence passes. `scenarios` contains exactly `ipc`, `utility-crash` and `playwright`, each mapping to `{ "file": "scenarios/scenario-name/execution.json", "sha256": "actual-execution-sha256" }`. Copy the complete public record files from those distinct attempts into their named subdirectories: `prepared.json`, `admitted.json`, `admission.json`, `host-evidence.bin`, `execution.json` and `observations/`, including the Playwright control receipt. Preserve the original attempts separately. Missing, failed and unverified cases keep the profile unqualified. The complete case IDs and supporting-scenario mapping are declared once as `MANUAL_CASES` and `SCENARIO_CASES` in [the launcher](../scripts/desktop_probes.py). Each attachment identifies the source inputs, native target/profile, artifact/addon digest, exact commands, expected versus observed outcomes and limitations. An operator declaration without actual observations is insufficient evidence.

Each attached case summary is JSON with exactly `case_id`, `target`, `profile`, `backend`, `source_inputs_sha256`, `runtime_inventory_sha256`, `execution_sha256`, `result`, `procedure`, `expected`, `observed` and `limitations`. The scope matches the admitted cell, `result` is `pass` only after observation, and the four descriptive fields are nonempty strings containing actual procedures, outcomes and limits. The two object digests use sorted-key compact JSON with ASCII Unicode escapes, encoded as UTF-8, of the prepared input map and original runtime inventory, respectively, as implemented by `object_digest`. `execution_sha256` binds the summary to its actual scenario execution receipt's bytes. The cases in `SCENARIO_CASES` use that supporting attempt's input and runtime-inventory digests; the other manual cases bind to the canonical journey and retain their detailed native procedures and supporting observations alongside it. The report independently checks every supporting scenario's input/receipt identities, native scope, expected positive or controlled-negative exit and required runtime observations. Keep detailed synthetic/public command output alongside each summary and reference it in the procedure. A hashed arbitrary file or a summary for another case or execution cannot substitute for that case's observations. The report checks this structure and identity; the recorded content review must still assess the truth and completeness of the observations.

- `native-host-and-dependencies`, `native-display-backend-observed`, `renderer-sandbox-os-observed` and `playwright-electron-control`: inspect actual ELF/Mach-O/PE imports and resolved dependencies, actual compositor/Ozone protocol and OS renderer sandbox, and native Playwright launch/control using the pinned test tool. An environment variable or requested preference is not the observation.
- `wrong-runtime-abi`, `wrong-addon-architecture`, `unavailable-addon`, `native-artifact-replaced`, `engine-source-mismatch` and `sandbox-denied`: use isolated copies with explicitly identified incompatible/missing/altered inputs and verify refusal at the enforcing boundary. The unchanged positive bundle remains intact.
- `denied-io`, `fixed-locator-alias`, `settings-data-overlap`, `atomic-replacement-interrupted`, `filesystem-locking`, `filesystem-durability` and `disk-full`: use only synthetic files on dedicated bounded test volumes; never fill the host's normal filesystem. Test interrupted replacement before and after rename and synchronization, competing writers, denied access, aliases and recovery/readback. Preserve old confirmed bytes or an explicit uncertain outcome. Each filesystem needs its demonstrated native procedure or equivalent.
- `utility-crash`, `tree-cessation` and `resource-budget`: observe the complete owned process tree, including helpers and exited children. Record launch/exit accounting, sampling interval, peak count/aggregate RSS, accumulated user/system CPU, the policy's measurement window and visibility gaps. Incomplete accounting or descendants remaining after failure is a failed result, not a clean exit.
- `altered-lock` and `stable-profile-sentinel`: verify actual unchanged-lock frozen setup and deliberate drift/refusal, stable-context admission refusal and all three sentinels before/after positive and negative native runs. Unit admission fixtures do not replace these native observations.
- `installer-updater-feasibility`: exercise the selected mechanism in an isolated VM/profile with synthetic data and controlled endpoints. Inspect package/script/profile bytes and native tool/helper identities. DEB needs exact-path AppArmor admission and no SUID/default-script fallbacks; RPM needs enforcing SELinux, preserved labels, ephemeral qualification-key signature verification and no signature/dependency bypass. Windows needs native NSIS and locked-file/restart behavior; macOS needs its native DMG/ZIP/helper feasibility. Exercise denied authorization/dependencies, target/version/schema refusal and interruption/recovery. Never read a public feed. Record assumptions reserved for final signing, notarization, official trust roots and authenticated update qualification in story 013; this case cannot certify those guarantees.
- `setup-budget`: start with empty local caches, run `setup`, `doctor`, `check` and `package:local`, retain their exact command exits and both lock hashes before/after, and record effective tool versions, optional native availability, engine/peer constraints, hardware/filesystem/session and network/cache conditions. Separate cold-download wall time, active/operator work and total elapsed time, including failed attempts/interventions and overlapping downloads. Compare with the canonical setup budgets; obtain review of material corrections before newcomer trials.

Run the report with exactly one canonical `journey` directory per cell from the same consumer inputs. Its `native-cases.json` references the supporting scenario records; do not pass those supporting attempts or repeated journeys as additional profile arguments:

```bash
python3 scripts/workspace.py run probes:report /absolute/scratch/attempt-id
```

The report verifies record and attachment identities, the native producer's artifact-inventory receipt, runtime observations and complete case coverage. It does not reinspect foreign runtime bytes or native file modes on the reporting host. It lists qualified target IDs and missing profiles, and exits unsuccessfully until the full matrix passes without invalid records. A target-specific consumer may use only its complete passing target record. The full story requires all required targets and their declared profiles; missing Intel macOS, ARM64 Linux or another profile remains missing even when the available machines pass. Preserve the native evidence outside disposable package retention before publishing any passing D1b record. No command here closes issues or authorizes release publication.

## Security evidence mapping

The [versioned applicability inventory](../config/desktop/security-applicability.json) and [foundation security contract](foundation-security.md) retain baseline ownership. Admission and `AdmissionTests` implement early isolation/refusal controls for FND-NATIVE; assembly header/hash/ZIP checks implement native input admission. They are host-independent evidence only. Packaged positive observations and the native cases above extend FND-NATIVE, FND-RENDER and FND-INSTALL on their actual native targets. Map each native attachment to the applicable inventory IDs, including FND-NATIVE's `v5.0.0-1.4.1`–`1.4.3`, `5.3.2`, `13.2.2` and `15.2.1`. Keep failed admission, negative tests and artifact/OS identity with the same record. No agent/parser capability or final-product security conformance is certified by this harness.

[^electron-esm-entry]: The selected main-entry loader calls the native app-code-loaded notification after its awaited ESM import completes.

[^csp-report-url]: CSP strips non-HTTP(S) violation URLs to their scheme for reporting.
