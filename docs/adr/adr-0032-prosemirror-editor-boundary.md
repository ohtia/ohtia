---
type: DecisionRecord
title: "ADR-0032 — ProseMirror behind an Ohtia editor boundary"
description: "Use ProseMirror directly with an academic schema and keep its internal types and persistence model private."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: model
    resource: "https://github.com/ProseMirror/prosemirror-model"
    title: "ProseMirror — Document model"
  - id: tables
    resource: "https://github.com/ProseMirror/prosemirror-tables"
    title: "ProseMirror — Tables"
---

# ADR-0032 — ProseMirror behind an Ohtia editor boundary

## Context

The editor must preserve manuscript structure, block/note identity, citations, tables, formulas and native composition. Direct ProseMirror, Tiptap and Lexical are plausible alternatives; a wrapper does not remove the need to implement Ohtia's format, authoring and review rules.

## Decision

Use ProseMirror directly through these independently versioned packages:

- `prosemirror-model`: `1.25.*`.
- `prosemirror-state`: `1.4.*`.
- `prosemirror-view`: `1.42.*`.
- `prosemirror-transform`: `1.12.*`.
- `prosemirror-tables`: `1.8.*`.
- `prosemirror-history`: `1.5.*`.
- `prosemirror-commands`: `1.7.*`.
- `prosemirror-keymap`: `1.2.*`.

These packages supply document/state/view/transform, table editing, history and keyboard commands. Its schema expresses allowed document structures and its table module supports structured table editing.[^model][^tables] Select compatible locked releases together; verify the selected locked packages and academic schema in Ohtia.

Expose only Ohtia ASTs, commands, selection/block anchors, composition state and diagnostics across the editor port. Enforce the private-library boundary through imports/lint. Implement stable-ID rules centrally, including copy/split/merge/undo and retired IDs. Preserve footnote call/content pairing and disallow unsupported structures such as nested notes.

Sanitize paste before constructing allowed document structure. During IME composition do not steal Enter, Tab, Escape or deletion/commit keys. Check inline atom layout and actual target-engine IME behavior. Make numbering, identities and decorations incremental; do not scan a long document on every keystroke by default.

Measure long manuscripts against editing, memory, input and accessibility budgets. Section editing or virtualization can be evaluated without changing stored identity or losing selection, comments and navigation. The [format](../draft-format.md), not the library's JSON, owns durable Markdown.

## Consequences

Ohtia maintains schemas, node views, clipboard and React integration while keeping replacement cost bounded. Test full format round trips, structural transformations, long manuscripts, real IME and packaged CSP. Reconsider for unresolved security/input defects, changed licensing or a sustained maintenance gap; evaluate a maintained fork versus replacing the engine. Report measurements for the implemented editor and exact tested artifact.

[^model]: The document model provides schema-based structures; Ohtia supplies its academic schema and identity semantics.

[^tables]: The table module provides editing primitives; profile fidelity and merged-cell behavior still require Ohtia tests.
