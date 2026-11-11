---
type: Story
title: "STORY-003-031 — Attention signals"
description: "Mark new replies and problems on the chat, history and project buttons without opening anything."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:app", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/233
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:app", "comp:docs"]
applicable_blocks: ["SPEC-003-036"]
---

# STORY-003-031 — Attention signals

## Description

Add the "new" and "needs your attention" marks on the Chat panel button, the history button and the project selector, their accessible names and announcements, and the `ActivityBadge` component.

## Applicable specification

- [SPEC-003-036: Attention signals](./epic.md#spec-003-036-attention-signals)

## Tasks

- [ ] Start after STORY-003-028 is merged and its output is on the base branch: Plan states that need attention.
- [ ] Start from `WorkspaceChrome` in `packages/renderer/src/workspace-chrome.tsx` (context bar and panel buttons) and `packages/renderer/src/design-tokens.css`, and extend these existing boundaries rather than create parallel ones.
- [ ] Add `ActivityBadge` with its "new" and "attention" variants to the design system and the renderer as a corner mark that overlaps its control by 6 px, so the control keeps its size: "new" a pill at the top-end corner, 18 px high and at least 18 px wide, with 5 px inline padding and `radius.pill`, in `action.primary.surface` with the count in `action.primary.content`, 12/18 px at weight 600 with tabular numerals; "attention" an 18 px circle at the bottom-end corner with a 1 px `attention.border` border on `attention.surface` and a 12 px `triangle-alert` in `attention.content`; both with a 2 px halo in the surface they sit on and, in forced colors, a 1 px `CanvasText` border; and a project row of the selector showing `triangle-alert` and "Needs your attention" in its second line instead of a badge.
- [ ] Compare the badges with `epic-003-attention.png`, `epic-003-attention-a.png` and `epic-003-attention-states.png`, where option A is the chosen look and options B and C, in `epic-003-attention-b.png` and `epic-003-attention-c.png`, are not built; the EPIC text prevails over a capture.
- [ ] Count new replies per window: a reply is seen only when it finishes while its conversation is shown with the chat visible in a focused, unminimized window; otherwise it counts as new until that window, focused and unminimized, shows the conversation with the chat visible; each window counts only the replies of the project it has open, never those of other projects. Derive attention from stored states: the latest reply failed or is uncertain with nothing newer, or a plan is in "Needs your attention"; a blocked task, whatever its reason, carries no attention mark. Add that attention state to the rows of `project.list` and `conversation.list`, updating the open project's conversations through their `research.subscribe` events and every other project through the attention event.
- [ ] Add the read `projectAttention.list`, exposed on the application port, which returns the identifiers of the projects that need attention, ordered by `id`, in pages under STORY-003-010's page rule with the last `id` received as its cursor, each page carrying the attention revision; in every transaction that changes whether any project needs attention, advance that revision and send the attention event carrying it on the `research.subscribe` stream of every window, whatever project it has open, or none, the revision starting at 1 each time the data service starts; in the window, read `projectAttention.list` to its end when subscribing, again when an event carries a revision it doesn't have and after a `sequence_gap`, reading again from the first page when two pages of one reading carry different revisions, and draw the selector button's mark and the selector's project-row marks from that set.
- [ ] Show the marks on the Chat button or narrow segment, the history button and the project selector, with the accessible names of SPEC-003-036 and their plural forms: "Open chat, {new} new replies", "Open chat, needs your attention" and "Open chat, {new} new replies, needs your attention" (for the narrow segment, the same names with "Chat" in place of "Open chat"), "Show conversation history, {attention} needs your attention, {conversations_with_news} with new replies" without the parts whose count is zero, where `{conversations_with_news}`, also the count of the history button's `new` mark, is the number of other conversations of the project with new replies, never a count of replies, the selector's value followed by "Another project needs your attention." and "Needs your attention" on each project row that needs it.
- [ ] Announce new replies politely, grouped within 2 seconds as "{new} new replies" with plural forms, and attention as an alert once per change, "A conversation needs your attention." or "A plan needs your attention.", without motion.
- [ ] Apply the documentation amendments of SPEC-003-036: in `docs/design-system.md`, "Domain components", before the "Saving" subsection, add the level-four subsection "Activity" with the item "- **`ActivityBadge`.** Marks a control whose content changed while the researcher was not looking at it: the Open chat panel control or the Chat segment of the narrow layout, the Conversation history control and the project selector with its rows. The `new` variant is a number in a neutral tone that counts agent replies that finished unseen; the `attention` variant is `triangle-alert` in the `attention` tone for work that needs the researcher. The mark extends the accessible name of the control it sits on, opens nothing by itself, never blinks or pulses, and in forced colors is told apart by its shape and text, not by color. It sits on the control's corner and overlaps it by 6 px, so the control keeps its size: `new` is a pill at the top-end corner, 18 px high and at least 18 px wide, with 5 px inline padding and `radius.pill`, in `action.primary.surface` with the count in `action.primary.content`, 12/18 px at weight 600 with tabular numerals; `attention` is an 18 px circle at the bottom-end corner with a 1 px `attention.border` border on `attention.surface` and a 12 px `triangle-alert` in `attention.content`. Both carry a 2 px halo in the surface they sit on and, in forced colors, a 1 px `CanvasText` border. These measurements are the component's own, outside the spacing and icon scales. A project row shows `triangle-alert` and “Needs your attention” in its second line instead of a badge."; in its "Shape" section, "`radius.pill`, 9999 px, only for voice labels." becomes "`radius.pill`, 9999 px, only for voice labels and the `ActivityBadge` count."; and in `docs/workspace-layout.md`, "Visibility, focus mode and narrow layout", after the panel-control list that ends with "`ArrowLeft`: Return to conversation, in history. These are separate actions with separate destinations.", add the paragraph "While chat is not visible, the Open chat control, or the Chat segment in the narrow layout, carries an `ActivityBadge` for the whole project: the number of agent replies that finished unseen, and `triangle-alert` when a conversation or a plan of the project needs the researcher's attention. The Conversation history control carries the same marks for the project's other conversations. The project selector marks each project that needs attention on its row and carries the mark itself when another project needs attention. Each mark extends its control's accessible name and never reveals a region by itself."

## Acceptance criteria

- [ ] Text arriving with the chat hidden shows the mark and never opens the chat (V18).
- [ ] The narrow layout shows the mark (V10).
- [ ] Another conversation finishing updates the history button's count and name, which count conversations with new replies, not replies.
- [ ] "New" clears on viewing and "attention" only on resolution, and attention survives a restart while "new" does not.
- [ ] A reply failing in another confirmed project, whose project revision stays 2, sends the attention event to a window with a different project open and to one with no project open, which then reads `projectAttention.list` and marks the selector; resolving it clears the mark the same way; a `sequence_gap` rereads `projectAttention.list` to its end, and pages read across a change of the attention revision are read again from the first page.
- [ ] Two windows count separately, a reply finishing while the window is unfocused or minimized counts as new until the focused, unminimized window shows it, and replies in other projects never count as new.
- [ ] A task blocked without a connection, by a plan limit or by a crash pause shows no attention mark, while the reply that failed or became uncertain does.
- [ ] `docs/design-system.md` and `docs/workspace-layout.md` carry the exact `ActivityBadge` texts of SPEC-003-036, including its corner look and measurements and the `radius.pill` rule.
- [ ] Both badges sit at their corners with the stated measurements and leave the control's size unchanged, and forced colors add the 1 px `CanvasText` border.
- [ ] With the researcher's account, hiding the chat during a reply and switching conversations show the expected marks.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded in the pull request and nothing else: this story runs beside the `direct_guidance` version chain, so any limit that a reply using more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, requires raising lands in `direct_guidance` version 6 of STORY-003-032, which closes only after these measurements exist.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] Marks remain distinguishable in forced colors and at 400% zoom.
- [ ] The badges are compared with the EPIC's option A attention captures, with each difference fixed or reported as a defect of the reference.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Its texts with plural forms are ICU plural messages, each count with its own plural selector; if the typed plural rendering contract that `docs/localization.md` requires of plural message producers is not on the base branch yet, this story adds it before its first plural message, and otherwise reuses it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Any migration this story adds runs through the existing ADR-0010 checkpoint and recovery path; because this story runs at the same time as STORY-003-029 to STORY-003-032, if one of them merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
