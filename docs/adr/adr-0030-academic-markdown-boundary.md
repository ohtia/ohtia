---
type: DecisionRecord
title: "ADR-0030 — Academic Markdown behind an editor-independent boundary"
description: "Keep canonical manuscript text and a versioned document model independent of the chosen editor library."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0030 — Academic Markdown behind an editor-independent boundary

## Context

The manuscript needs academic citations, notes, formulae, figures, spanning tables, cross-references and stable comment anchors. Editor-specific JSON ties long-lived research to one library; generic Markdown does not supply all required semantics. Using DOCX as the live editing authority would require a different identity and fidelity strategy.

## Decision

Use the explicit [academic Markdown profile](../draft-format.md) for retained manuscript revisions, stored as `TEXT` in SQLite under the [data model](../data-model.md#manuscripts-and-revisions). A canonical parser and serializer define the typed document model and diagnostics. Keep an editor module behind a boundary exchanging that model, stable anchors and editing commands; other features do not import the editor library's internal types.

Support only structures that the profile can represent and preserve. Source syntax, block identity and resource versions survive editing and saving. Exporters consume the canonical model and return a fidelity report; generating an openable file is not enough. No library plugin silently broadens the format or inserts agent-written replacement prose.

## Consequences

The manuscript remains readable and migratable beyond one editor implementation, at the cost of a maintained grammar, model, identity transformations and conversion tests. The [draft format](../draft-format.md) owns extension rules and the conformance corpus. [ADR-0032](adr-0032-prosemirror-editor-boundary.md) selects ProseMirror, [ADR-0033](adr-0033-temml-mathml-rendering.md) selects mathematical rendering and [ADR-0034](adr-0034-pandoc-typst-manuscript-delivery.md) selects delivery converters behind their respective boundaries.

Verify parse/serialize equivalence, IME input, copy/split/merge/undo identity, save/reopen, comments and DOCX/PDF fidelity using the format corpus on packaged desktop targets. Verify the selected editor, mathematical rendering and converters for actual compatibility, isolation, size and license obligations.
