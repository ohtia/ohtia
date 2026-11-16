---
type: DecisionRecord
title: "ADR-0054 — Restricted message Markdown from a syntax tree"
description: "Parse conversation Markdown with table extensions and render a closed React mapping without inserting HTML."
generated:
  by: codex/gpt-6.1-sol
sources:
  - id: from-markdown
    resource: https://github.com/syntax-tree/mdast-util-from-markdown
    title: mdast-util-from-markdown
  - id: gfm-table
    resource: https://github.com/micromark/micromark-extension-gfm-table
    title: micromark-extension-gfm-table
  - id: footnote-syntax
    resource: https://github.com/micromark/micromark-extension-gfm-footnote#syntax
    title: GFM footnote syntax
  - id: footnote-tokenizer
    resource: https://github.com/micromark/micromark-extension-gfm-footnote/blob/main/dev/lib/syntax.js
    title: micromark footnote container tokenizer
  - id: mdast-table
    resource: https://github.com/syntax-tree/mdast-util-gfm-table
    title: mdast-util-gfm-table
---

# ADR-0054 — Restricted message Markdown from a syntax tree

## Context

[STORY-003-011](../epics/EPIC-003-research-agents/STORY-003-011-markdown-copy-and-links.md) adds formatted conversation messages to the existing timeline. Provider output and researcher messages are untrusted text. [ADR-0014](adr-0014-restricted-rendering-and-csp.md) prohibits inserting their HTML even after sanitization. The conversation profile allows reference links and literal unsupported notation; it is separate from the canonical manuscript grammar selected in [ADR-0031](adr-0031-canonical-typescript-draft-ast.md).

A Markdown-to-HTML pipeline would introduce a forbidden intermediate representation. A general React Markdown wrapper would add transforms and features beyond this restricted profile. The parser parts expose the syntax tree directly so Ohtia can decide which elements to draw.[^from-markdown]

## Decision

Use `mdast-util-from-markdown` on the `2.1.*` line, `micromark-extension-gfm-table` on the `2.1.*` line and `mdast-util-gfm-table` on the `2.0.*` line. The renderer manifest and lockfile own exact patches. Enable only the table syntax and tree extensions alongside CommonMark.[^gfm-table][^mdast-table]

Render allowed nodes through a closed React element mapping: paragraphs, emphasis, strong text, inline and block code, quotations, lists, links, thematic breaks and tables. Headings become bold paragraphs rather than page headings. HTML and images become literal source text; images acquire no resource resolver. Protect formula, footnote and strikethrough notation as literal text before the rendering parse so Markdown inside those constructs does not reinterpret their content. Temporary tokens retain punctuation flanking, internal whitespace and quotation marks, and cannot repair malformed HTML or destination syntax; active inline nodes must match their original source provenance. Retain original sibling block boundaries so a protected definition cannot turn a thematic break into a setext heading. Inline dollar formulas require a non-space character after the opening delimiter and before the closing delimiter, with no digit immediately after the closing delimiter, so ordinary currency amounts do not absorb surrounding Markdown. Strikethrough and prose display notation are protected within one phrasing block; standalone opening and closing display delimiters may enclose literal blocks. Formula and strikethrough openers respect backslash escape parity; ordinary escaped text retains CommonMark rendering, and no rejected bracketed-formula candidate can hide a following footnote label. Footnote labels themselves remain literal. Discard escaped dollar runs before trying a full formula match, preventing repeated failed scans of the same escaped suffix. Link destinations and reference identifiers remain parser input, so Markdown escape decoding and reference normalization retain their ordinary meaning; only collapsed or shortcut references whose visible labels are protected receive collision-free internal ASCII bindings to their original parser-decoded destinations, without duplicating arbitrary label syntax. These bindings exist only in parser input. Literal ranges may contain whole syntax nodes or stay within their visible phrasing, but never cut across code, link destinations or link boundaries. Multiline literal bodies keep enclosing quotation and list prefixes outside their per-line protection. Footnote definitions start after block-container prefixes, with four-column continuation indentation relative to the container and blank or lazy paragraph continuations; inspect the dedented body to require an already open paragraph rather than extending code, headings, tables or HTML. Ordinary prose references and table cells remain ordinary Markdown.[^footnote-syntax][^footnote-tokenizer] Unknown node types fall back to their source text. No path produces or inserts HTML.

Normalize CRLF and CR to LF only in presentation input so source indexing follows the parser’s line boundaries. Preflight the original and final trees iteratively before recursive processing. If any node is more than 12 edges below the root, display the complete original message as literal text; this bounds stack depth and prevents extreme nesting from replacing the surrounding interface with an error. Maintain generated-to-original source spans through literal tokens and internal reference bindings. Only actual original definitions and private generated bindings may be hidden or resolve references, and only original table blocks become tables; protecting notation must not synthesize invisible definitions or new table structure. Render unknown block content as separate literal blocks and retain enclosing quotation/list structure outside their source text. Auxiliary footnote parses share a cumulative input allowance of four times the presentation source’s UTF-16 length; when another parse would exceed it, stop preprocessing and display the complete message as literal text. This prevents repeated growing-prefix lookahead from producing quadratic parsing work within a bounded reply. These transformations are presentation-only: stored and copied text stays original.

Reference-style links resolve against the first definition for their identifier, and definitions are omitted from the visible output. Only `https`, `http` and `mailto` addresses within 4,096 UTF-8 bytes become interactive. Activation calls the named main broker operation; main independently reparses the address with the WHATWG URL parser before opening it in the system browser. Link tooltips show the full WHATWG-normalized address that main will open, so Unicode direction controls appear percent-encoded rather than changing the displayed destination’s visual order. Rendered links never navigate the privileged document. Copying sends only the saved message identifier; the [application port](../application-port.md#named-presentation-commands) owns main’s scoped read, integrity and clipboard confirmation behavior.

Code and table overflow remains in named focusable boxes. Rendering uses the conversation controller’s existing ten-per-second streaming schedule, without announcing streamed text. Presentation retains the message’s author, recorded language and original text (PRIN-002 and PRIN-004); formatting and copying do not confirm its evidence or apply it to a manuscript (PRIN-005).

## Consequences

The parser tree is inspectable without an HTML sanitizer, and features outside the profile remain visibly literal. Every supported node and literal-notation rule needs hostile, incomplete and nested-content tests. Parser upgrades must preserve the mapping, reference resolution, exact copy text, packaged CSP and narrow-panel behavior. These tests do not replace native browser, clipboard, keyboard, screen-reader or real-provider qualification.

Bundle the parser dependencies’ license notices with the existing About notices. Reconsider this choice if the conversation profile needs a materially different grammar; extending the message renderer does not change the manuscript parser or serialization contract.

[^from-markdown]: The parser exposes an mdast syntax tree from Markdown.

[^gfm-table]: The micromark extension recognizes GFM table syntax.

[^mdast-table]: The mdast extension constructs table nodes from the recognized syntax.

[^footnote-syntax]: The micromark footnote grammar describes definition containers, four-space continuation and blank or lazy lines; no footnote-rendering extension is enabled.

[^footnote-tokenizer]: The primary tokenizer consumes horizontal whitespace after the definition marker and requires four columns for explicit continuation; lazy lines depend on the open paragraph in the contained Markdown.
