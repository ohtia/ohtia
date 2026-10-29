---
type: Playbook
title: Native quality builds
description: Build unsigned development packages on standard hosted native VMs and verify complete artifact and checkout provenance.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Native quality builds

## Inventory and authority

[ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix) owns the recurring hosted matrix and its distinction from distribution qualification. [The matrix](../config/quality/build-targets.json) enumerates fourteen required native cells and sixteen package results. The [CI workflow](../.github/workflows/ci.yml) uses the matching explicit standard labels without an additional matrix concurrency cap. No owned runners or larger-runner subscription is part of this procedure. The [release policy](release-policy.md) separates quality artifacts from signed candidates and public publication.

PRs to `main` and actual pushes to `main` run the full matrix, including documentation changes. The `repository-checks` job preserves frozen shared checks, repository hooks and committed-history secret scanning. Each native job constructs the selected development packages and runs the actual packaged runtime, storage and diagnostic suites. The stable `ci` job requires every upstream job and accounts for every cell, format, native observation and smoke case. Skipped, cancelled, failed, missing, altered or stale evidence fails the result.

The read-only token, nonpersisted checkout credentials, explicit action pins and [reviewed action catalog](../config/github/actions-permissions.json) restrict CI authority. [Repository policy](repository-policy.md) owns separate maintainer authorization and plan/apply/readback before using an expanded action catalog. The workflow does not receive signing, notarization, publication or administrative credentials. The canonical Linux E2E job from [STORY-001-008](epics/EPIC-001-desktop-foundation/STORY-001-008-provide-the-reproducible-sandboxed-linux-e2e-environment.md) remains a separate mandatory parallel check when its producer is integrated; native package jobs do not replace its immutable image or parity checks. Canonical frontend E2E dependencies belong inside that image. Native distribution jobs separately record the actual hosted/guest OS and package dependencies they test.

The package subprocess environment excludes credential and runtime-injection variables; development packages contain no updater configuration and read no public feed.

## Fresh hosted fixture

Automatic profile preparation is limited to a fresh GitHub-hosted VM. It rejects an existing Ohtia configuration or research root. The VM supplies isolation from a researcher's ordinary machine; generated sentinels represent explicitly synthetic stable contexts. The launcher still uses the fixed account-native configuration and research roots and the existing runtime admission contract. Never enable this automatic provisioning in an ordinary local account by changing environment variables.

Ubuntu runs in separate private X11/DBus and GNOME/Wayland jobs as the ordinary runner user. Fedora 44 and Debian 13 run in distinct native x64 KVM guests on hosted Ubuntu 26.04, with vendor kernels and GNOME/Wayland. Fedora uses a dedicated Btrfs home and enforcing SELinux; Debian uses ext4 and its native AppArmor/user-namespace admission. [TD-001](technical-debt.md#td-001--fedora-and-debian-arm64-guests-in-recurring-ci) retains the deferred ARM64 guest extension. Installation alone uses the VM's package-manager authority. Ohtia-owned DEB hooks check Ubuntu identity, the fixed root-owned executable path, payload modes and exact AppArmor profile load/removal; they do not install a setuid fallback or disable AppArmor globally. The actual renderer's OS sandbox must be observed. Windows uses the supplied native hosted Windows family and per-user offline NSIS payload. macOS uses actual mounted DMG or extracted ZIP bytes with ad-hoc signing solely for quality execution, without Developer ID or notarization claims. Native-addon admission records the final post-signature bytes and retains their relation to the pinned upstream addon; the containing bundle is resealed before constructing DMG/ZIP artifacts.

Every package runs the runtime, storage and diagnostics acceptance entries against its installed/extracted payload. The runtime cases include actual IPC, CSP/resource refusal, second launch, utility failure/retry and bounded shutdown. Storage covers file-backed persistence/restart, migrations, receipts, failure and checkpoint recovery. Diagnostics covers private markers, automatic capture, rotation and I/O failure. Each suite has an exact source-owned case inventory; a shorter report cannot pass by declaring its own list.

Retain each synthetic state generation inside the owned scratch root before starting another package format. Never adopt an existing account store or erase private material to make a fixture fresh. Native process observations identify sampled renderer sandbox state and absence of package executables after shutdown. Sampling is not lifetime resource accounting, physical power-loss evidence, native assistive acceptance or proof of an untested distribution/display profile.

## Common commands and records

Frozen setup and the common build entry precede native construction. These CI commands require their genuine GitHub event context and hosted VM; they do not grant local execution admission:

```bash
python3 scripts/workspace.py setup
python3 scripts/workspace.py run quality:plan artifacts/quality-plan.json
python3 scripts/workspace.py run quality:build ubuntu-24-04-x64-x11 artifacts/quality-result
python3 scripts/workspace.py run quality:aggregate artifacts/quality-plan.json artifacts/quality-inputs artifacts/quality-summary.json
```

Linux uses the workflow's private display/session wrapper. Other platforms select their own declared cell and use `python` where appropriate. The coordinated aggregator reads the complete set of downloaded native artifact directories rather than one local cell. Shared checks and deterministic accounting tests remain usable locally without launching an unqualified Electron process.

A development version has the form `0.0.0-dev.<run>.<attempt>`, never a reserved final version. Each plan binds repository, event, PR head/base where applicable, actual checkout commit/tree, workflow and policy digests, locks, target/tool manifests and smoke inventories. Native receipts bind the plan, host/image identity, package format, exact bytes and SHA-256, executable/addon architecture, prepared payload and packaged suite reports. The PR and actual integrated-main identities remain distinct.

Each job records its checkout before repository tooling. The trusted pre-merge verifier checks the exact reviewed workflow/inventory and requires the corresponding receipt in every job's bounded log. It still accepts only `pull_request` evidence. A successful main push never substitutes for PR admission, and a synthetic merge never substitutes for the actual integrated revision. Rerun all jobs for a new attempt: previous-attempt packages do not qualify the new coordinated result.

## Retention and retrieval

Native packages and coordinated summaries use the numeric policy's fourteen-day disposable retention. Artifact names include cell, run and attempt; overwrite is disabled and missing uploads fail. The downloader enforces its service digest, and the aggregator independently verifies each actual package and attached report hash/length. No artifact is executed by the pre-merge verifier.

Download the native package artifacts and the separate `summary-<run>-<attempt>` artifact from the identified Actions run before expiry. Logs or packages that have expired are unavailable evidence, not a passing result. Retain evidence needed for human review outside that disposable window before expiry. Supported release packages and recovery baselines use separate controlled release storage and cannot depend on these temporary copies.

## Delivery security evidence

The [delivery applicability record](../config/quality/delivery-security.json) maps the existing versioned ASVS identifiers to this owner's enforcing controls, deterministic negative tests and native evidence. It distinguishes candidate-independent review, local synthetic checks, live policy readback and actual hosted runs. Signing identity, authenticated updates, release reservation and publication are separate owners; unsigned quality artifacts establish none of those guarantees. Local preparation cannot fill in unperformed live or native evidence.
