---
type: Story
title: "STORY-001-014 — Capture and assemble reviewed user change notes"
description: "Collect PR impact statements and assemble traceable channel-specific editorial release notes."
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/28
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-017", "SPEC-001-026"]
---

# STORY-001-014 — Capture and assemble reviewed user change notes

## Description

Collect PR impact statements and assemble traceable channel-specific editorial release notes. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-017: Safe note capture and editorial assembly](./epic.md#spec-001-017-safe-note-capture-and-editorial-assembly)
- [SPEC-001-026: Delivery security applicability and evidence](./epic.md#spec-001-026-delivery-security-applicability-and-evidence)

## Tasks

- [ ] Use existing standard-library tooling for the independent note fixtures where sufficient; declare any actually chosen new workspace/CI prerequisite before integrating it.
- [ ] Introduce a reviewed versioned PR impact/note-input schema and a documented no-public-effect explanation path.
- [ ] Implement safe data-only note collection and source/PR reconciliation with synthetic first/stable/preview baselines.
- [ ] Provide editorial assembly/approval preview, mandatory disclosure checks and immutable note identity/correction evidence.
- [ ] Document canonical GitHub body/channel-promotion annotations without adding a premature product notes screen.
- [ ] Produce untrusted-note parsing and approval-integrity security evidence under SPEC-001-026.

## Acceptance criteria

- [ ] Note assembly has traceable applicable security evidence and does not select execution or publication authority from PR text.
- [ ] N14 reconciles omitted/duplicate/unfinished changes and retains issue/PR evidence without treating commits as final prose.
- [ ] First stable, preview delta and stable-inclusive-of-preview baselines have explicit correct scope.
- [ ] Notes bind content/channel/baseline/approval separately from package identity; edits invalidate approval and correction evidence survives.

## Quality checklist

- [ ] Inject shell/markup/helper payloads in note inputs and prove they remain inert data.
- [ ] Test first release, omitted critical consequence, unsupported performance claim, preview-to-stable note replacement and prose-only correction fixtures.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
