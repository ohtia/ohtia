---
type: Story
title: "STORY-004-021 — Save a reviewed diagnostic bundle"
description: "Preview and save one exact validated local diagnostic artifact through an explicit action."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/423
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop"]
applicable_blocks: ["SPEC-004-005", "SPEC-004-028"]
---

# STORY-004-021 — Save a reviewed diagnostic bundle

## Description

Preview and save one exact validated local diagnostic artifact through an explicit action.

## Applicable specification

- [SPEC-004-005: Settings operation boundaries](./epic.md#spec-004-005-settings-operation-boundaries)
- [SPEC-004-028: Save a reviewed diagnostic bundle](./epic.md#spec-004-028-save-a-reviewed-diagnostic-bundle)

## Tasks

- [ ] Prepare the specified broker-owned JSON v1 snapshot and enforce its 1 MiB cap and single active preview.
- [ ] Bind user approval to that snapshot and use the broker's native destination picker for the exact bytes.
- [ ] Document the versioned local package, field allowlist, cap and preview invalidation in `docs/diagnostics.md`.

## Acceptance criteria

- [ ] Saved bundle bytes match the approved preview despite rotation or new events. Cancelled, stale or refused actions produce no shareable output or external transmission.

## Quality checklist

- [ ] Rotate logs after preview and compare the exact saved bytes to the approved snapshot. Exercise replacement while the native picker is open, other-window approval, cancellation, bounds and scenario 15 sensitive-marker exclusion.
