---
type: Story
title: "STORY-003-011 — Markdown, copy and links"
description: "Render messages as restricted Markdown and let the researcher copy a message and open its links through main."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:app", "comp:desktop", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/213
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop", "comp:docs"]
applicable_blocks: ["SPEC-003-016"]
---

# STORY-003-011 — Markdown, copy and links

## Description

Replace the plain text of the conversation view of STORY-003-010 with restricted Markdown rendering that never inserts HTML, add "Copy message" with a confirmed clipboard readback, and open links in the system browser, through the new main broker operations `openExternalLink(url)` and `copyMessage(messageId)`. The composer is STORY-003-012 and notices are STORY-003-013.

## Applicable specification

- [SPEC-003-016: Markdown, copy and links](./epic.md#spec-003-016-markdown-copy-and-links)

## Tasks

- [ ] Start after STORY-003-010 is merged and its output is on the base branch: Conversation view and text parts.
- [ ] Start from the conversation view of STORY-003-010, `packages/renderer/src/research-presentation.tsx`, `packages/contracts/src/commands.ts` (`CommandBridge`) and `packages/main/src/about.ts` (`copyVersionInformation`), and extend these existing boundaries rather than create parallel ones.
- [ ] Write the new ADR for the Markdown parser and add `mdast-util-from-markdown` 2.1.0, `micromark-extension-gfm-table` 2.1.2 and `mdast-util-gfm-table` 2.0.1, with their license notices in About's third-party notices.
- [ ] Render every message's allowed Markdown node types (paragraphs, emphasis, strong text, inline and block code, block quotes, lists, links, thematic breaks and tables) without inserting HTML, headings as bold text rather than page headings, and disallowed constructs (HTML, formulas, images, footnotes and strikethrough) as written, never fetching images.
- [ ] Scroll code blocks and wide tables inside their own box, so the panel never scrolls horizontally, even at 280 CSS px, and make each box focusable and named "Code block" or "Table".
- [ ] Restrict links to `https`, `http` and `mailto`, showing a link with any other scheme as its label text, and resolve reference-style links to their definitions without showing the definitions; give each link the external-link icon with the accessible name "opens in your browser" and show its full address on hover and keyboard focus.
- [ ] Add the main broker operation `openExternalLink(url)`, which parses the address again with the WHATWG URL parser and opens it in the system browser only when it is at most 4,096 bytes and its scheme is `https`, `http` or `mailto`.
- [ ] Redraw a streaming reply's formatting within the limit of STORY-003-010, at most ten times per second.
- [ ] Add the main broker operation `copyMessage(messageId)`: the window sends only the identifier; main reads the message's text from the data service, in parts with `text.readPart` (STORY-003-010) when it is longer than 4,096 bytes, writes it to the clipboard and returns success only after reading it back, as `copyVersionInformation` does.
- [ ] Add "Copy message" as the first button of each saved message's actions row: an always-visible quiet icon button with the Lucide `copy` icon, vendored from `lucide-static` 1.66.0 into `packages/renderer/icons/` with its hash in the manifest and the generated `design-icons.ts` and icon mappings updated through the existing `scripts/design_assets.py` procedure, whose `--write-icon-module` regenerates `design-icons.ts`, with "Copy message" as accessible name and tooltip, and no button on a reply still streaming.
- [ ] Apply the `docs/design-system.md` amendment of SPEC-003-016: in "Iconography", fixed mappings, add the row "Copy message | `copy`".
- [ ] Build the Markdown boxes and links to the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-016, keep "Copied" in the actions row that STORY-003-010 measured, and compare them with `epic-003-conversation-light.png`, `epic-003-conversation-dark.png`, `epic-003-narrow.png` and the link-focus box of `epic-003-composer.png`; the EPIC text prevails over a capture.
- [ ] Implement "Copy message" with confirmation: a neutral `clipboard-check` status "Copied", in `type.ui.caption` with a 16 px icon, only after `copyMessage` succeeds, and otherwise the inline danger alert with `octagon-alert` "Ohtia couldn't copy this message. Select its text and copy it manually."
- [ ] Apply the documentation amendments of SPEC-003-016: the new ADR for the Markdown parser, which owns its version lines, and in `docs/application-port.md`, "Named presentation commands", `openExternalLink(url)` and `copyMessage(messageId)` after the `openLink()` sentence.

## Acceptance criteria

- [ ] Hostile content (`<script>`, `javascript:` links, images, HTML, broken tables and unclosed text) never inserts HTML or violates the packaged CSP.
- [ ] Code blocks and wide tables scroll inside their own focusable box named "Code block" or "Table", and the panel never scrolls horizontally at 280 CSS px.
- [ ] A failed copy shows "Ohtia couldn't copy this message. Select its text and copy it manually." and a successful one shows "Copied" only after confirmation; a message over 4,096 bytes copies exactly.
- [ ] "Copy message" is an always-visible `copy` icon button with its name and tooltip on every saved message and absent from a streaming reply.
- [ ] `openExternalLink` refuses a `javascript:` or `file:` address sent directly to main.
- [ ] With the researcher's account, a real reply streams into the panel with formatting.
- [ ] The V07 cases of `workspace-layout.md` for lists, quotes, code, addresses, hostile HTML and copy failure pass for the conversation view at 280 CSS px with long translations.
- [ ] These cases of the V17 scenario of `workspace-layout.md` pass for messages: lists, tables, code, inline and display formulas shown as written, external links, hostile and incomplete content, and wide content that scrolls inside its own box; the composer's cases of V17 belong to STORY-003-012.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] The pull request records, under ADR-0000, the applicable OWASP ASVS 5.0.0 L2 requirement IDs for the Markdown rendering and the broker operations `openExternalLink` and `copyMessage`, with their applicability and evidence.
- [ ] The formatted messages, "Copy message" and links meet WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and are checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] The rendered messages match the Markdown measurements in tokens of the "Measurements" list of this story's block, SPEC-003-016, "Copy message" keeps STORY-003-010's actions row, and both are compared with the EPIC's conversation, narrow and composer captures, with each difference fixed or reported as a defect of the reference.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires; the new ADR takes the next free number of `docs/adr/index.md` when this story integrates and is added to that index in the same pull request.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
