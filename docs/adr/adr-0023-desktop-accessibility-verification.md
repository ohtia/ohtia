---
type: DecisionRecord
title: "ADR-0023 — WCAG 2.2 AA and scoped desktop accessibility evidence"
description: "Target WCAG 2.2 AA and selected AAA criteria while reporting actual packaged-interface and assistive-technology coverage."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: wcag
    resource: "https://www.w3.org/TR/WCAG22/"
    title: "W3C — WCAG 2.2"
  - id: atag
    resource: "https://www.w3.org/TR/ATAG20/"
    title: "W3C — ATAG 2.0"
---

# ADR-0023 — WCAG 2.2 AA and scoped desktop accessibility evidence

## Context

Accessible web semantics are useful inside Electron but cannot certify native dialogs, input methods or assistive behavior by themselves. The previous web project's testing exclusions arose from its delivery scope and do not establish desktop OS evidence. Alternatives are an automation-only web checklist, full AAA conformance or a scoped AA target with selected additional criteria and native verification. Automation-only evidence misses assistive/input and native-dialog behavior; a blanket AAA requirement would exceed what every research-content surface can support. The scoped target supplies concrete complete-process obligations while retaining explicit evidence for the actual packaged platform and selected higher-level criteria.

## Decision

Target WCAG `2.2` AA on complete interface surfaces/processes and retain the eleven selected AAA criteria: 1.4.6, 1.4.8, 2.1.3, 2.2.4, 2.2.5, 2.2.6, 2.4.8, 2.4.10, 2.4.12, 2.4.13 and 3.3.6. This is not general AAA conformance.[^wcag] Use ATAG `2.0` Part B as authoring support guidance, preserving researcher authorship.[^atag]

Verify keyboard-only journeys, focus/restoration, names/roles/states, accessibility tree, contrast, zoom/reflow/text spacing, forced colors, reduced motion, themes, pseudolocalization and Korean. Automated checks and tree inspection do not establish screen-reader usability. Delivery evidence identifies the actual OS, artifact, tools and checked criteria; unknown or untested combinations do not become a green result.

The packaged release matrix governs native/assistive verification, separately from a Linux developer environment or portable browser tests. Specify the necessary manual journeys for the capability before claiming tested support; record actual Orca/NVDA/VoiceOver runs only when executed. No new platform or reader result is inherited from the web project.

DOCX structure and PDF/UA have their own output checks. Do not claim complete WCAG, ATAG or PDF/UA conformance from a library choice, an axe pass or a tagged PDF header. Third-party material limitations remain attributed to the actual content/control boundary.

## Consequences

The target remains demanding and the evidence precise. Known barriers or unverified applicable criteria block a conformance claim. Changes to required criteria or verification scope need explicit review rather than silent suite reduction. Native editor Tab exit, IME and preservation of meaningful language remain functional requirements even when a particular reader was not run.

[^wcag]: WCAG defines criteria and conformance; the selected AAA set and desktop verification contract are Ohtia choices.

[^atag]: Part B concerns support for accessible authored content; adopting guidance is not a conformance finding.
