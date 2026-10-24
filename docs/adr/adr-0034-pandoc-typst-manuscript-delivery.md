---
type: DecisionRecord
title: "ADR-0034 — Pandoc DOCX and Typst PDF from the validated AST"
description: "Generate academic deliveries from exact manuscript snapshots with isolated writers and explicit fidelity reports."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: pandoc
    resource: "https://pandoc.org/MANUAL.html"
    title: "Pandoc — User guide"
  - id: typst
    resource: "https://typst.app/docs/guides/accessibility/"
    title: "Typst — Accessibility guide"
  - id: license
    resource: "https://github.com/jgm/pandoc/blob/main/COPYING.md"
    title: "Pandoc — License"
  - id: pandoc-release
    resource: "https://github.com/jgm/pandoc/releases/tag/3.12.1"
    title: "Pandoc — Release metadata"
  - id: typst-release
    resource: "https://github.com/typst/typst/releases/tag/v0.15.1"
    title: "Typst — Release metadata"
---

# ADR-0034 — Pandoc DOCX and Typst PDF from the validated AST

## Context

DOCX/PDF deliveries need citations, notes, mathematics, tables, references and accessibility without rewriting researcher prose. A local app still needs outputs for supervisors and publication; they are distinct from internal migration recovery or complete knowledge export. Generic Markdown conversion can lose Ohtia identities and hide degradation.

## Decision

Generate deliveries from the exact validated manuscript AST, bibliography/resource snapshots, style, language and tool versions. Convert it to Pandoc writer input without re-reading Markdown. Resolve numbering and citation mapping once; use citeproc/CSL for bibliography. Missing citations and unsupported formulas remain visible and reported.[^pandoc]

Use Pandoc `3.12.*` for its DOCX and Typst writers and Typst `0.15.*` as the PDF compiler.[^pandoc-release][^typst-release] Use the DOCX writer with a controlled reference document and verified postprocessing for language, math fonts, numbering and cross-reference fields. Use its Typst writer plus a controlled template and Typst compiler for PDF, targeting PDF/UA-1 with appropriate structure/language/alternative text and validation. Typst documents tagged/PDF accessibility capabilities; selecting it does not prove this app's output conformant.[^typst]

Run converter processes under [restricted processing](adr-0015-isolated-content-processing.md), without network or general filesystem access, with checked resources and bounded time/memory/output. Pandoc sandbox flags complement OS containment, not replace it. Use local templates and identified fonts, not arbitrary user code, remote packages or system-font assumptions.

Every output has a fidelity report naming unsupported/degraded content, literal formulas, unresolved references, layout and font requirements. Check native DOCX notes/OMML, merged cells, alt text, language and fields in actual target readers. Validate PDF structure and PDF/UA beyond a metadata flag; LaTeX formula alternatives are not natural-language speech. Recheck Korean wrapping, long equations, SVG raster fallbacks and font substitution rather than copying prototype claims.

Package verified converter binaries with their licenses, notices and applicable source obligations. Pandoc retains its GPL license; the repository MIT license does not relicense it.[^license] Exact patches, installers and compatibility are fixed with the delivery, with no requirement that researchers install a LaTeX distribution.

## Consequences

The outputs share one research snapshot while requiring templates, conversion fixes, postprocessing and platform packaging. Previous web prototype reader checks, timings or PDF/UA passes are not reproduced evidence. No lossless supervisor-edit round trip is promised; returned originals and attributed comments remain external feedback. Revisit a writer if it cannot satisfy required output semantics or redistribution constraints.

[^pandoc]: Pandoc documents AST/writer, citeproc and sandbox facilities; Ohtia defines the conversion and fidelity contract.

[^typst]: Typst documents accessible PDF facilities; actual delivery conformance requires validation.

[^license]: Pandoc publishes GPL license terms; a bundled third-party component retains its own obligations.

[^pandoc-release]: The official release identifies a published patch in the selected Pandoc line.

[^typst-release]: The official release identifies a published patch in the selected Typst line.
