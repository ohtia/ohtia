---
type: DecisionRecord
title: "ADR-0033 — Temml and native MathML with Plex Math"
description: "Convert restricted mathematical LaTeX to MathML with Temml while retaining source and reporting unsupported constructs."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: temml
    resource: "https://temml.org/docs/en/administration"
    title: "Temml — Administration"
---

# ADR-0033 — Temml and native MathML with Plex Math

## Context

Mathematical source must remain editable text while displayed formulas use the selected math font. A renderer's default macro/HTML support can exceed the academic profile. Native MathML, KaTeX and MathJax have different shaping and font integration paths; Ohtia selects native MathML rather than depending on another engine's private font metrics.

## Decision

Use Temml `0.14.*` to produce MathML for the packaged renderer, with IBM Plex Math and explicit script fallbacks. Validate formula commands/environments against [Draft format](../draft-format.md) before conversion. Disable trust and user macros and enforce size/expansion limits; Temml documents its rendering/options API, whose exact CSP behavior must be verified.[^temml]

Use the DOM construction path compatible with the actual CSP; do not accept an HTML-string path with unsafe attributes merely because it renders. Editing displays literal LaTeX in Plex Mono. Unrecognized, malformed or unsupported formulas retain their exact source, remain visible and produce typed diagnostics; they never silently disappear or become an unexplained image.

Check the actual font used, including Korean text inside formulas and absent glyphs. MathML semantics and a selected font do not by themselves prove natural screen-reader pronunciation. DOCX/PDF use separate output engines and must declare any differences.

## Consequences

One restricted conversion keeps source and display separate but requires engine/font conformance tests, including generic exceptions and excessive expansions. Test representative math, malicious commands, malformed input, mixed scripts and packaged CSP. Revisit if target engines or maintained Temml releases cannot satisfy the profile without broadening trust.

[^temml]: Temml documents LaTeX-to-MathML rendering and bounded/trust options; Ohtia adds a closed syntax policy and actual CSP verification.
