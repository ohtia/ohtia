---
type: Story
title: "STORY-003-021 — Agent selector and direct use"
description: "Let the researcher choose Virgilio or Josefa for a new conversation, with unavailable roles shown disabled."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:app", "comp:storage", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/223
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage", "comp:docs"]
applicable_blocks: ["SPEC-003-026"]
---

# STORY-003-021 — Agent selector and direct use

## Description

Add `conversations.agent_id`, the agent band below the chat header with the selector of an empty conversation, disabled unavailable roles, routing by agent and the panel texts that follow the chosen agent.

## Applicable specification

- [SPEC-003-026: Agent selector and direct use](./epic.md#spec-003-026-agent-selector-and-direct-use)

## Tasks

- [ ] Start after STORY-003-020 is merged and its output is on the base branch: Josefa's operation.
- [ ] Start after STORY-003-018 is merged and its output is on the base branch: Lazy conversation creation.
- [ ] Start from the chat header of STORY-003-010 and `VoiceLabel` in `packages/renderer/src/contributor-identity.tsx`, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for `conversations.agent_id`, defaulting existing conversations to `virgilio`, and pass the agent to `conversation.start` with the first message; reject an agent without an enabled operation with the new error `agent_unavailable`, next action `check_request`, saving nothing, and add it to the port's closed `errorActions` and to `conversation.start`'s `operationErrorCodes`.
- [ ] Return each conversation's `agent_id` from `conversation.read` and `conversation.list` in place of the fixed `virgilio`, and, in an empty conversation, read the destination line with `destination.read` given the project and the agent chosen in the selector, again each time the choice changes.
- [ ] Add the agent band right below the chat header in every conversation, the setup conversation included: the agent's static symbol and "{agent} · {role} · AI"; in a new, empty conversation the label "Talk to:" followed by the selector, whose value is the chosen agent; after the first message the fixed agent without label or selector; STORY-003-029 adds to this band the "Continue with Virgilio" button of a conversation whose agent is not Virgilio.
- [ ] Build the selector as an APG select-only combobox, like the project selector of STORY-003-016, labelled by "Talk to:" with the chosen agent (Virgilio by default) as its value, its options showing the agent's 20 px symbol, the name and, on a second line, the role, and for a disabled option the reason on a third line in `type.ui.caption`, the chosen option marked with `check`, without portraits; list "Writing review" as one entry, a group of its listbox holding its two modes, Boris for academic editing and María for proofreading; disable Jorge Luis, Erasmus and both writing-review modes with "Not available in this version.", keeping them reachable with the keyboard so they read their reason; and show no selector in setup.
- [ ] Route each message to the operation of the conversation's agent.
- [ ] Replace Virgilio's name with the conversation's agent in the composer placeholder "Message {agent}", the reply announcement "{agent} replied" and the notices "Waiting for {running_agent} to finish the current reply.", with `{running_agent}` the agent whose task runs now in the conversation, and "{service} isn't connected. {agent} will reply when you connect.", show "Ask Josefa about your search." in an empty Josefa conversation, and show on each history row's first line, before the conversation's name, the compact `VoiceLabel` of STORY-003-018 for the agent its `agent_id` names.
- [ ] Apply the documentation amendments of SPEC-003-026 to `docs/agents/agent-collaboration.md` and `docs/agents/agent-collaboration-evaluation.md`; in the `docs/design-system.md` fixed icon table, as left by STORY-003-016, the row "Open project in the project selector | `check`" becomes "Open project or chosen agent in a selector | `check`"; and in `docs/workspace-layout.md`, "Regions and surfaces", `chat`, "It contains the conversation heading, history/new-conversation controls, scrollable messages/activity and a composer in its own bottom row." becomes "It contains the conversation heading, history/new-conversation controls, a band below the heading that shows the conversation's agent and, while the conversation is empty, the agent selector, scrollable messages/activity and a composer in its own bottom row."
- [ ] Build the agent band and selector to the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-026, and compare them with `epic-003-agent-selector.png` and `epic-003-agent-selector-states.png`; the EPIC text prevails over a capture.

## Acceptance criteria

- [ ] Existing conversations get Virgilio after migration.
- [ ] Choosing Josefa sends nothing until the first message, and the first message fixes the agent.
- [ ] Each agent uses its own operation, and unavailable agents cannot be chosen and read their reason; "Writing review" is one entry holding its two disabled modes.
- [ ] The selector follows the APG select-only combobox pattern with the keyboard and a screen reader.
- [ ] The setup conversation shows no selector, and Virgilio answers there.
- [ ] `conversation.start` with an unavailable agent is rejected with `agent_unavailable` and saves nothing.
- [ ] The destination line of an empty conversation follows the chosen agent, read with `destination.read`, and history rows show each conversation's agent, read through `conversation.list` and `conversation.read`.
- [ ] The agent band shows "Talk to:" with the selector in an empty conversation and the fixed agent afterwards and in setup; the chosen option carries `check`.
- [ ] Scenario 1 of `agent-collaboration-evaluation.md` passes: a directly selected Josefa answers without a Virgilio turn, and the stored reply keeps its role, input versions and coverage.
- [ ] Scenario 17 passes for explicit selection: an explicit choice is kept, and an unavailable role explains its unavailability.
- [ ] With the researcher's account, a conversation with Josefa returns a search plan and another with Virgilio returns guidance.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] The band and selector match the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-026, and are compared with the EPIC's agent-selector captures, with each difference fixed or reported as a defect of the reference.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
