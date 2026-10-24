---
type: DecisionRecord
title: "ADR-0014 — Allowed document structures and restrictive CSP"
description: "Render untrusted content through the academic schema and enforce the packaged application content security policy."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0014 — Allowed document structures and restrictive CSP

## Context

Source text, bibliography, model responses and diagnostics can carry hostile markup. Accepting arbitrary HTML creates a privileged desktop risk; stripping unsupported material silently destroys fidelity. CSP supplements validated rendering rather than repairing unsafe interpolation.

## Decision

Render only validated document structures admitted by [Draft format](../draft-format.md), with context-specific text/attribute escaping and resource resolution. Apply the same rules to paste, errors, previews and comments. Do not insert user/model HTML through bypasses. Formula syntax cannot enable HTML, file inclusion or macros; literal code never executes.

Resolve resources to authorized local bytes, with no implicit external downloads when opening a document. Restrict active SVG or render a safe derivative while retaining the original. Block dangerous URL schemes and external navigation/window creation unless a named trusted action permits them.

Ship a restrictive CSP with scripts, styles, fonts, images, connections and frames limited to actual needs. Avoid arbitrary inline code and evaluation. Main/preload privileges remain governed by [ADR-0003](adr-0003-electron-desktop-boundaries.md); no Clerk/authentication resource exception is inherited. Renderer requests do not bypass the broker's source/connection controls.

## Consequences

The schema, renderer and exporters must evolve together. Test XSS and resource attacks in every context, invalid links, SVG, paste, formula failures and the CSP actually applied to packaged pages. Unexpected CSP violations fail relevant tests; deliberate negative tests identify their expected violation exactly. Preserve input and report unsupported content rather than claiming a lossy sanitized result faithful.
