---
type: DecisionRecord
title: "ADR-0025 — Bundled IBM Plex typography with Noto fallback"
description: "Distribute identified local fonts for interface, manuscript, code and mathematics without remote font requests."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: plex
    resource: "https://github.com/IBM/plex"
    title: "IBM — Plex"
  - id: plex-sans
    resource: "https://registry.npmjs.org/%40ibm%2Fplex-sans/1.1.0"
    title: "IBM Plex Sans — Distribution metadata"
  - id: plex-serif
    resource: "https://registry.npmjs.org/%40ibm%2Fplex-serif/2.0.0"
    title: "IBM Plex Serif — Distribution metadata"
  - id: plex-mono
    resource: "https://registry.npmjs.org/%40ibm%2Fplex-mono/2.5.0"
    title: "IBM Plex Mono — Distribution metadata"
  - id: plex-sans-kr
    resource: "https://registry.npmjs.org/%40ibm%2Fplex-sans-kr/1.1.0"
    title: "IBM Plex Sans KR — Distribution metadata"
  - id: plex-math
    resource: "https://registry.npmjs.org/%40ibm%2Fplex-math/1.1.0"
    title: "IBM Plex Math — Distribution metadata"
---

# ADR-0025 — Bundled IBM Plex typography with Noto fallback

## Context

System-installed fonts vary and external font downloads introduce dependencies unrelated to reading private research. Code typography does not imply mathematical shaping or all-script coverage. Academic templates can impose different document fonts. System-only fonts reduce distribution size but leave availability and metrics dependent on the host; a Noto-only family set offers broad script coverage but a different visual identity and still needs mathematical-role evaluation. Bundled Plex with checked Noto supplements keeps the chosen reading/interface identity and an explicit coverage boundary at the cost of package size and font maintenance.

## Decision

Bundle controlled, licensed font files: IBM Plex Sans for UI, Plex Serif for Ohtia documents, Plex Mono for literal code/LaTeX and Plex Math for rendered mathematics, with explicit Noto fallbacks by script. IBM distributes distinct families; select actual files and inspect their capabilities rather than deriving them from the brand name.[^plex]

Select the font files from these independently versioned upstream distribution packages:

- `@ibm/plex-sans`: `1.1.*`.[^plex-sans]
- `@ibm/plex-serif`: `2.0.*`.[^plex-serif]
- `@ibm/plex-mono`: `2.5.*`.[^plex-mono]
- `@ibm/plex-math`: `1.1.*`.[^plex-math]
- `@ibm/plex-sans-kr`: `1.1.*`.[^plex-sans-kr]

These lines identify the distribution packages, not a fabricated common Plex family version or the files' internal OpenType version strings. Extract and bundle font/license assets; package JavaScript, telemetry dependencies and lifecycle scripts are not part of the shipped typography. Noto is a collection of independently released script fonts: identify each selected fallback asset by its own upstream version and hash rather than inventing one collection-wide version.

Record exact distribution patches, font-file native versions, hashes and licenses, and embed assets locally. Preserve required characters, weights and shaping when subsetting. Evaluate Plex Sans KR and Noto Korean files explicitly; fallback follows content script, not merely UI locale. Include mixed-script text inside mathematics and identify the actual font used.

Exporter font selections retain their versions and distribution/embedding requirements. Academic delivery templates can override document typography without altering content. Editor formulas use a mathematical font with suitable OpenType MATH data; Plex Mono remains literal code text.

## Consequences

Bundling improves control at the cost of package bytes and font maintenance. Verify glyph coverage, Korean/mixed-script wrapping, missing glyphs, weights, math shaping, offline loading and DOCX/PDF substitution. Each font inspection and export result must identify the actual tested files, artifact and environment.

[^plex]: IBM publishes separate font families; the selected file, license and shaping tests determine the delivered behavior.

[^plex-sans]: The upstream package metadata identifies the selected Sans distribution line.

[^plex-serif]: The upstream package metadata identifies the selected Serif distribution line.

[^plex-mono]: The upstream package metadata identifies the selected Mono distribution line.

[^plex-math]: The upstream package metadata identifies the selected Math distribution line.

[^plex-sans-kr]: The upstream package metadata identifies the selected Korean Sans distribution line.
