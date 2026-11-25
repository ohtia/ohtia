---
type: Story
title: "STORY-004-025 — Protect pending project work before detach"
description: "Expose scoped opt-in guards that preserve pending work before detaching a scoped project."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/427
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-003", "SPEC-004-033"]
---

# STORY-004-025 — Protect pending project work before detach

## Description

Expose scoped opt-in guards that preserve pending work before detaching a scoped project.

## Applicable specification

- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-033: Protect pending work before project detach](./epic.md#spec-004-033-protect-pending-work-before-project-detach)

## Tasks

- [ ] Publish the read-only selection lease from ProjectController and the guard/disposer API keyed by window and selection epoch.
- [ ] Connect the existing conversation buffer as the real consumer.

## Acceptance criteria

- [ ] Outstanding or rejected guards keep the work open and cannot detach a newer selection.

## Quality checklist

- [ ] Test existing composer plus controlled consumers across overlapping decisions, dispose, failed save and A→B→A.
