---
type: Story
title: "STORY-001-015 — Prepare immutable candidates through trusted authority"
description: "Reserve versions and assemble retained, fully verified final candidates through an explicitly invoked trusted workflow."
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/29
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-015", "SPEC-001-016", "SPEC-001-017", "SPEC-001-018", "SPEC-001-026"]
---

# STORY-001-015 — Prepare immutable candidates through trusted authority

## Description

Reserve versions and assemble retained, fully verified final candidates through an explicitly invoked trusted workflow. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-015: Quality builds and native packaged smoke tests](./epic.md#spec-001-015-quality-builds-and-native-packaged-smoke-tests)
- [SPEC-001-016: Final signatures, installation and authenticated updates](./epic.md#spec-001-016-final-signatures-installation-and-authenticated-updates)
- [SPEC-001-017: Safe note capture and editorial assembly](./epic.md#spec-001-017-safe-note-capture-and-editorial-assembly)
- [SPEC-001-018: Trusted candidate preparation and permanent version identity](./epic.md#spec-001-018-trusted-candidate-preparation-and-permanent-version-identity)
- [SPEC-001-026: Delivery security applicability and evidence](./epic.md#spec-001-026-delivery-security-applicability-and-evidence)

## Tasks

- [ ] Integrate gate: verify STORY-001-012 output B12 and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] Integrate gate: verify STORY-001-013 output I13 and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] Integrate gate: verify STORY-001-014 output N14 and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] Prepare the reviewed external-control/credential-binding design and verify immutable protected-main workflow-ref/policy admission with the maintainer.
- [ ] Implement separate manual candidate selection, integrated-source provenance checks and atomic permanent version reservation.
- [ ] Assemble all targets with frozen inputs and qualified final signing; retain manifests/final digests and approved note annotations.
- [ ] Require complete native evidence and immutable target/package identities for all six baseline cells before admitting a candidate as ready.
- [ ] Gate public readiness on complete final native, mandatory assistive and catalog/provenance evidence; test denial with missing required evidence and same-candidate continuation without replacing identified packages. Model-generated translations without human linguistic review do not fail this gate.
- [ ] Qualify controlled internal candidates without claiming public readiness before 017 supplies its manual evidence; avoid a returning dependency on integrated acceptance.
- [ ] Produce independent workflow/source/policy/signing/reservation security evidence under SPEC-001-026 and verify current external signing facilities.

## Acceptance criteria

- [ ] Completion gate: verify Native facilities output NF and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] Completion gate: verify Release authority output RA and its full release condition in the Dependencies output registry and SPEC-001-018.
- [ ] The candidate owner supplies applicable security and actual external-authority evidence before readiness, with all required native/signing facilities available.
- [ ] A five-cell matrix, emulated ARM64 execution or a universal artifact verified on one CPU fails candidate readiness.
- [ ] C15 ties exact source/workflow/policy/run/attempt/targets/final bytes/compatibility/notes to one permanently reserved version.
- [ ] Wrong ref/source, candidate-controlled verifier, reused version, altered bytes/notes or missing target fails readiness.
- [ ] A rejected/cancelled candidate consumes its version; same-input continuation cannot replace final artifacts or infer publication authority.
- [ ] Release authority RA is externally enforced and observed through real deny/allow/readback evidence; a self-authored workflow guard is insufficient.

## Quality checklist

- [ ] Test simultaneous reservations, rejected reuse, interrupted continuation and moving-main source stability.
- [ ] Read back actual external workflow/policy/credential controls and qualify final native candidate manifests against the exact retained bytes.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
