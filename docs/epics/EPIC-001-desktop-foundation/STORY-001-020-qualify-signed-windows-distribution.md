---
type: Story
title: "STORY-001-020 — Qualify signed Windows distribution"
description: "Qualify an eligible Authenticode publisher facility and signed native Windows 11 x86-64 installation."
tags: ["story", "comp:desktop", "comp:tooling", "security"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/82
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:tooling"]
applicable_blocks: ["SPEC-001-016", "SPEC-001-028", "SPEC-001-030", "SPEC-001-032", "SPEC-001-042"]
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
---

# STORY-001-020 — Qualify signed Windows distribution

## Description

Qualify an eligible Authenticode publisher facility and signed native Windows 11 x86-64 installation. The application only notifies about a newer version and the user downloads the signed installer from the official page; there is no in-application update and no update catalog. Consume the completed common/Linux foundation without becoming its return dependency. Enrollment/design and ephemeral callback fixtures may proceed earlier; actual integration uses V17 and the qualified common contracts. This story enables only its platform's real signed distribution capability; it does not authorize public publication or certify another platform.

## Applicable specification

- [SPEC-001-016: Final signatures and installation](./epic.md#spec-001-016-final-signatures-and-installation)
- [SPEC-001-028: Linux-first delivery and platform capability admission](./epic.md#spec-001-028-linux-first-delivery-and-platform-capability-admission)
- [SPEC-001-030: Windows publisher signing and distribution qualification](./epic.md#spec-001-030-windows-publisher-signing-and-distribution-qualification)
- [SPEC-001-032: Release redesign and replaced scope](./epic.md#spec-001-032-release-redesign-and-replaced-scope)
- [SPEC-001-042: Release security inventory and output R37](./epic.md#spec-001-042-release-security-inventory-and-output-r37)

## Tasks

- [ ] Integrate gate: verify STORY-001-017 output V17 and its full registry/SPEC-001-030 release condition on the consumer base; enrollment/design/ephemeral fixtures may proceed before that gate.
- [ ] Integrate gate: verify Policy authority output PA for the exact selected provider/workflow/token/administrative plan with actual permitted apply/readback or reviewed no-change compatibility evidence.
- [ ] Compare actual individual/jurisdiction eligibility, legal publisher name, trusted certificate chain, cloud/hardware key custody, API/callback restrictions, per-release human work and annual costs; select and authorize an eligible facility without assuming a Microsoft or foundation certificate is available.
- [ ] Inspect the pinned NSIS signing path and implement constrained application/generated-uninstaller/final-installer Authenticode signing with trusted timestamps; verify native chain/publisher/final bytes and upstream signing/license constraints.
- [ ] Qualify the ordinary-user graphical Windows 11 x86-64/NTFS first-install route and installation of the next version's signed installer over a supported baseline after the application's update notice, on a licensed native facility; retain independent optional ARM64 evidence only if actually included.
- [ ] Run wrong-target/publisher/schema, expired/revoked trust, denied authorization, locked-file/restart, interruption/network/disk and compatible recovery cases, plus genuine affected keyboard/screen-reader/publisher/error journeys without global protection changes.
- [ ] Add this platform's signing to its own job in `prepare-release.yml` and `publish-release.yml` and extend the security/license/source inventories with real W20 evidence; verify that its packages stay recorded as unsigned under the testing-only heading of the unpublished release and are removed at publication without that evidence and that newly signed final bytes enter only under a new version, without changing earlier prepared releases.
- [ ] Rehearse private exact-byte preparation/publication/retry/withdrawal and retention using the real signed artifacts; keep public product readiness and publication authorization separate.

## Acceptance criteria

- [ ] Completion gate: verify Native facilities output NF for this platform's real permitted credentials and actual final signed-package native verification under SPEC-001-030; mocks, enrollment claims and ad-hoc certificates do not pass.
- [ ] Completion gate: verify Native hosts output NH for every required native profile in this platform's scope, with actual OS/CPU/filesystem/display/security/isolation and successful final-artifact runs.
- [ ] Completion gate: verify Release authority output RA for the real platform credential/capability extension and permitted controlled surfaces, with actual external allow/deny/readback.
- [ ] Completion gate: verify UI review facilities output UR for the actual affected signed-user-route criteria, tools/operators/artifacts, with compatible evidence reuse explicitly justified.
- [ ] W20 binds source/workflow/run/attempt, exact final signed bytes, publisher trust and every required native/user-route result; missing or conflicting evidence keeps the capability ineligible.
- [ ] Without W20 the release workflows keep this platform's packages recorded as unsigned, remove them from the release at publication and distribute no installer for it; its evidenced capability is accepted only under a new version with all other gates intact; no self-signed fallback or silent target omission.
- [ ] Tampering, wrong target/publisher/schema, expired/revoked trust and interrupted operations refuse or recover with stable research state preserved; no database downgrade, unsafe mutation replay or global protection weakening.
- [ ] Final security applicability/control IDs, native/external positive-negative evidence, bundled license/notices/source obligations and genuinely performed human observations are complete and retained.
- [ ] The common/Linux delivery stories and the other platform follow-up do not depend on this story; public scaffold publication, unrelated feature implementation and a permanent personal VM fleet remain outside its scope.

## Quality checklist

- [ ] Run actual native first-install, next-version installer over a supported baseline, update-notice, refusal/interruption/recovery and stable-sentinel checks with synthetic file-backed stores and permitted fixtures.
- [ ] Verify final transformed bytes, native publisher trust, digest-file and attestation verification, license/source obligations and affected human observations; distinguish local fixtures from external/native evidence.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, affected policy tests and git diff --check; include new files explicitly.
- [ ] Preserve issue-first isolation and complete the prescribed independent read-only code reviews before code commits, then verify signed commit/tree identity and current-base hosted CI separately.
- [ ] Report actual results, failures, omissions and installed-user/change-note impact with no local scratch dependencies or invented human verification.
