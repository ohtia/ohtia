---
type: Story
title: "STORY-003-017 — Virgilio: clarify and next step"
description: "Let Virgilio guide the researcher in every confirmed project in the document language, within bounded input and output."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:llm", "comp:docs", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/219
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:llm", "comp:docs", "comp:app"]
applicable_blocks: ["SPEC-003-022"]
---

# STORY-003-017 — Virgilio: clarify and next step

## Description

Add the `direct_guidance` operation with its instructions, newest-first bounded input with the omission note, its policy and the pending-limit behavior, and enable the composer in confirmed projects.

## Applicable specification

- [SPEC-003-022: Virgilio: clarify and next step](./epic.md#spec-003-022-virgilio-clarify-and-next-step)

## Tasks

- [ ] Start after STORY-003-015 is merged and its output is on the base branch: Confirmed projects and the composer.
- [ ] Start from the setup operation of STORY-003-014, and extend these existing boundaries rather than create parallel ones.
- [ ] Add `direct_guidance` policy version 1 and instruction version 1. Fill the instructions' placeholders: `{project_type_name}` and `{project_type_description}` with the type's English name and description (STORY-003-014), `{title}` with the confirmed title, `{document_language}` with the project's tag, and `{document_language_name}` with its English name from `new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" }).of(tag)`, such as "Spanish (Argentina)" for `es-AR`.
- [ ] Request the first model of the connection's list, under STORY-003-005's model rule, until STORY-003-035.
- [ ] Route messages in confirmed projects to `direct_guidance` and enable the composer.
- [ ] Assemble input newest first up to 256 KiB of message text and 500 items with whole messages, the omission note and cut-message notes, recording message identifiers in the attempt.
- [ ] Keep a message in the composer with STORY-003-012's attention notice "Too many replies are waiting. Your message wasn't sent and is still in the box; send it again when some finish." when `message.append` is rejected with `pending_limit_reached`.
- [ ] Apply the documentation amendment of SPEC-003-022 to `docs/agents/agent-virgilio.md`: in "Operations", "Each operation has a versioned policy, instruction and output contract under ADR-0029. Evaluate and enable operations separately; the headings identify research operations, not provider API methods." becomes "Each operation has a versioned policy, instruction and output contract under ADR-0029, and is enabled once its adapter conformance and operational checks pass. The headings identify research capabilities, not provider API methods. Clarifying a research question and proposing a next research action run in one operation, `direct_guidance`, the standard way Virgilio answers in a confirmed project; Virgilio chooses from the researcher's message which of them to do.", keeping the ADR-0029 link; and "Clarify a research question" and "Propose a next research action" each start with "**Operation:** `direct_guidance`." before their "Input" line.

## Acceptance criteria

- [ ] A project in setup uses `project_setup` and a confirmed one uses `direct_guidance`.
- [ ] Instructions carry type, title and language, with `es-AR` written as "Spanish (Argentina) (es-AR)".
- [ ] A conversation over the input limit sends only recent messages with the note, and the attempt records them.
- [ ] The composer works after confirmation, and the pending limit keeps the message in the composer with its notice.
- [ ] With the researcher's account, Virgilio clarifies a question, proposes a next action and answers in Spanish to an English message in a Spanish thesis.
- [ ] `docs/agents/agent-virgilio.md` maps both the clarification and the next-action headings to `direct_guidance` and no longer asks to evaluate and enable them separately.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
