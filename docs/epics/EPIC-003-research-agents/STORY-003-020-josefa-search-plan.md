---
type: Story
title: "STORY-003-020 — Josefa: search plan"
description: "Let Josefa propose an unverified, eight-part search strategy as a written plan in the document language."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:llm", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/222
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:llm", "comp:docs"]
applicable_blocks: ["SPEC-003-025"]
---

# STORY-003-020 — Josefa: search plan

## Description

Add the `search_strategy_planning` operation with its instructions, the fixed "Search locations Ohtia can query" input section and its policy, reachable through the development command until the agent selector exists.

## Applicable specification

- [SPEC-003-025: Josefa: search plan](./epic.md#spec-003-025-josefa-search-plan)

## Tasks

- [ ] Start after STORY-003-017 is merged and its output is on the base branch: Input assembly for agent replies.
- [ ] Start from the `direct_guidance` input assembly of STORY-003-017, and extend these existing boundaries rather than create parallel ones.
- [ ] Add `search_strategy_planning` policy version 1 and instruction version 1, including the open-versus-subscription, full-text and institutional-access rules.
- [ ] Assemble Josefa's input like `direct_guidance`, with the fixed section "Search locations Ohtia can query: none in this version."
- [ ] Save replies as Josefa's messages, and add the development command's `send-to-josefa` action, with `--ohtia-dev-conversation=<id>` and `--ohtia-dev-text=<text>`, which appends a researcher message to that conversation of a confirmed ordinary project and creates a `search_strategy_planning` task instead of a `direct_guidance` one, through the development-only command `development.sendToJosefa`, recorded in `command_receipts` and accepted only in the `development` mode.
- [ ] Apply the documentation amendment of SPEC-003-025 to `docs/thesis-workflow.md`, "Search strategy": "**Search locations:** pertinent and accessible databases, catalogs, repositories and reference/citation routes through enabled adapters." becomes "**Search locations:** pertinent and accessible databases, catalogs, repositories and reference/citation routes; a strategy marks those that enabled adapters can query as such and every other proposed location as unverified."; `docs/agents/agent-josefa.md` "Evaluation and enablement" is already amended by STORY-003-014.

## Acceptance criteria

- [ ] Josefa's reply is saved as her message with the project data and fixed section in its input.
- [ ] A conversation over the input limit sends only recent messages with the note.
- [ ] The policy limits of `search_strategy_planning` version 1 apply: its pending, input, output, work-unit, duration and inactivity limits and its two attempts behave as their values state.
- [ ] `docs/thesis-workflow.md` marks the locations that enabled adapters can query and marks every other proposed location as unverified.
- [ ] With the researcher's account, a plan request in a Spanish thesis returns the eight parts, unverified marks, the open-versus-subscription separation and the institutional-access question, with no invented author or title.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
