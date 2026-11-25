---
type: Story
title: "STORY-004-012 — Validate canonical title and paragraphs"
description: "Produce a bounded, deterministic canonical manuscript codec for the agreed first grammar subset."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/414
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-019"]
---

# STORY-004-012 — Validate canonical title and paragraphs

## Description

Produce a bounded, deterministic canonical manuscript codec for the agreed first grammar subset.

## Applicable specification

- [SPEC-004-019: Validate the canonical title and paragraph subset](./epic.md#spec-004-019-validate-the-canonical-title-and-paragraph-subset)

## Tasks

- [ ] Implement the specified header-only, title and text paragraph subset, explicit breaks and size/count bounds. Record examples and the exact contract in the canonical manuscript format specification.
- [ ] Implement the trusted codec, validators, stable identity handling and typed rejection diagnostics.

## Acceptance criteria

- [ ] Valid supported text is structurally identical after a canonical round trip and serialization is deterministic.
- [ ] Corrupt metadata, foreign or reused IDs and unsupported constructs yield bounded diagnostics without loss.

## Quality checklist

- [ ] Run independent grammar, property/fuzz and resource-bounds checks with no storage or editor requirement.
