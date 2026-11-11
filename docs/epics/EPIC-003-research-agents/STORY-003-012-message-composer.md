---
type: Story
title: "STORY-003-012 — Message composer"
description: "Let the researcher write, send and stop from a growing composer with a 20,000-character limit and a destination line."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:app", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/214
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:app", "comp:docs"]
applicable_blocks: ["SPEC-003-017"]
---

# STORY-003-012 — Message composer

## Description

Build the composer with its box geometry, the 20,000-code-point limit, Enter and input-method rules, the destination line with its read `destination.read`, the combined Send/Stop button, safe clearing after a confirmed save with a distinct notice for each other result, "Reuse message" and in-memory unsent text.

## Applicable specification

- [SPEC-003-017: Message composer](./epic.md#spec-003-017-message-composer)

## Tasks

- [ ] Start after STORY-003-010 is merged and its output is on the base branch: Conversation view and port operations.
- [ ] Start after STORY-003-007 is merged and its output is on the base branch: Stop.
- [ ] Start from the conversation view of STORY-003-010 and `packages/renderer/src/design-tokens.css`, and extend these existing boundaries rather than create parallel ones.
- [ ] Build the box: 16/24 px text, one line at the bottom, growth upward to 8 lines and at most 40% of the panel, inner scrolling with a visible caret, plain-text paste and no horizontal scroll; its placeholder and accessible name is "Message {agent}", with the conversation's agent (Virgilio until STORY-003-021).
- [ ] Implement the 20,000-code-point limit, never truncating, with the counter from 18,000, "{used} / {max}" with locale-formatted numbers, read as "{used} of {max} characters" with plural forms, and the over-limit attention notice "Remove {excess} characters to send this message." with plural forms, read with the box; make the data service reject empty, whitespace-only or longer researcher messages with `message_invalid`.
- [ ] Implement Enter, Shift+Enter and input-method composition rules, and reject empty or whitespace-only messages.
- [ ] Show the destination line with the answering connection's kind: "To {service} ({email}) · This conversation · Stops after {limit}" for a `subscription` connection and "To {service} · API key · This conversation · Stops after {limit}" for an `api_key` connection, with `{limit}` the answering operation's `max_attempt_duration_ms` in whole minutes, `{service}` and the kind from the connection's declaration and `{email}` from `connection.read`. Add the read `destination.read`, which takes the project and either a conversation or, for a conversation not created yet, the agent that will answer it (`virgilio` until STORY-003-021), and returns what the next message there would create: the operation that the routing of `message.append` and `conversation.start` assigns, its current `max_attempt_duration_ms` and the connection its task would use, whatever that connection's state, or none, in which case the line is hidden; read it when the window shows a conversation or a new one and again when `research.subscribe` names the open project or the shown conversation.
- [ ] Send with `message.append`, first sending a message over 4,096 bytes in parts under the same operation identifier (STORY-003-010), so no message is cut.
- [ ] Vendor Lucide `arrow-up` and `square` from the `lucide-static` 1.66.0 package pinned in `packages/renderer/icons/manifest.json`, with their hashes in the manifest and the generated `design-icons.ts` and icon mappings updated through the existing `scripts/design_assets.py` procedure, whose `--write-icon-module` regenerates `design-icons.ts`.
- [ ] Implement Send/Stop as one icon button with a tooltip: Send with `arrow-up` and the name "Send message", Stop with `square` and the name "Stop replies"; Stop, whatever the box holds, while the save of a message this box sent awaits its result, and after any result the button follows the box; a Stop pressed then disables the button as after Stop and sends `conversation.stop` once the save returns any result, confirmed, failed or unconfirmed, so a reply already running always stops; a box that holds only whitespace counts as empty; with an empty box and nothing to stop, Send stays focusable, marked `aria-disabled`, with the tooltip and description "Write a message to send it."; with immediate switching, announced as "Sending your message. The button now stops the replies."; the new conversation-level command `conversation.stop` (one operation identifier, every unfinished task of the conversation in one transaction, recorded in `command_receipts`); the disabled state until the result is confirmed, with the tooltip and description "Wait until the replies stop.", which also shows below the box in secondary text while the button is disabled; and operation identifiers against double clicks.
- [ ] Carry `conversation.stop`, `destination.read` and STORY-003-007's `task.stop` through the application port, as STORY-003-010 carries the other research operations: main admits each one and forwards it to the data service, which validates it and rechecks its preconditions; list each one's error codes in `operationErrorCodes`.
- [ ] Clear only after a confirmed save and keep text typed meanwhile. For every other result keep the text and show below the box, read with it: for `pending_limit_reached`, the attention notice with `triangle-alert`, announced as a status, "Too many replies are waiting. Your message wasn't sent and is still in the box; send it again when some finish."; for `input_too_large`, the attention notice with `triangle-alert`, announced as a status, "This message is too long for {agent} to read. Your message wasn't sent and is still in the box; shorten it and send it again.", with `{agent}` the agent that answers the conversation; for an unconfirmed result (`uncertain`, `timeout`, `cancelled`, `disposed` or `invalid_service_result`), the attention notice with `triangle-alert`, announced as a status, "Ohtia couldn't confirm that your message was saved. Send it again to check; it won't be saved twice.", where Send resends the same text with the same identifier until the text changes; for `parts_incomplete`, one automatic resend of every part and the command with the same identifier; and for any other error, including `message_invalid`, the alert "Ohtia couldn't save your message. Your text is still in the box; send it again to retry.", a danger notice with `octagon-alert`, with a retry under the same identifier.
- [ ] Keep unsent text in memory only while the window is open, never on disk.
- [ ] Keep below the box, in this order, the counter, a notice, the reason of a disabled button and the destination line, with the counter, the disabled reason and the destination line in `type.ui.caption` and `content.secondary` and the counter aligned to the inline end with tabular numerals.
- [ ] Add "Reuse message" as the second button of each researcher message's actions row: an always-visible quiet icon button with the Lucide `text-cursor-input` icon, vendored like `arrow-up`, with "Reuse message" as accessible name and tooltip.
- [ ] Draw "Close dialog" in every confirmation dialog of this story as a secondary footer button with the Lucide `x` icon, before the primary button and with the initial focus, and give the dialog no close button in its header.
- [ ] Apply the `docs/design-system.md` amendment of SPEC-003-017: in "Iconography", fixed mappings, add the row "Reuse message | `text-cursor-input`".
- [ ] Build the composer and its states to the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-017, and compare them with `epic-003-composer.png` and the composers of the conversation captures; the EPIC text prevails over a capture.
- [ ] Implement "Reuse message" on researcher messages; with text in the box, ask first in the dialog "Replace the text in the box?", with the body "Reusing this message replaces the text you're writing.", "Replace text" and "Close dialog", with initial focus on "Close dialog".
- [ ] Apply the documentation amendments of SPEC-003-017: in `docs/workspace-layout.md` V17, "Use a synthetic 20000-code-point input limit to test emoji and over-limit rejection without truncation; production limits come from the enabled operation." becomes "Use the composer's 20000-code-point input limit to test emoji and over-limit rejection without truncation; that limit is fixed and is not taken from the enabled operation."; in `docs/design-system.md`, "Base components", after the Text field's "Optional fields are marked, not required ones." add "The conversation composer is an exception to the visible label above: its placeholder, “Message {agent}”, is also its accessible name, as in ChatGPT and Claude.", and after the Button's "Prefer allowing the action and explaining the error over disabling it; if disabled, the reason is visible." add "The conversation composer's send button is the one exception: while the box is empty it is disabled without a separate visible reason, because the empty box shows it, and its tooltip and accessible description state it."

## Acceptance criteria

- [ ] Enter sends, Shift+Enter breaks a line, and Enter during composition does not send.
- [ ] Text of 20,000 code points with emoji is accepted, sent in parts and stored exactly, and an over-limit paste is kept whole with Send disabled.
- [ ] The destination line shows the `subscription` variant with ChatGPT and the `api_key` variant with a fake API-key connection, from `destination.read` for an existing conversation and for one not created yet.
- [ ] Double clicks never send or stop twice.
- [ ] A slow confirmation and a failed save keep the text; text typed after sending is not erased.
- [ ] A pending-limit rejection, an `input_too_large` rejection and an unconfirmed result each keep the text with their own notice, and a resend after an unconfirmed result saves the message once.
- [ ] Stop before the provider answers, and Stop racing completion in both orders, leave one consistent result; a Stop pressed while a 20,000-code-point message is still being saved stops that message's reply once the save is confirmed, and still stops the running reply when the save fails or is unconfirmed; after an unconfirmed result with the text in the box, the button is Send.
- [ ] The reason of a disabled Stop shows below the box.
- [ ] The V07 cases of `workspace-layout.md` for multiline preview and reuse with prior input pass at 280 CSS px: a multiline message shows its lines in the growing box before it is sent, and reusing a message with text in the box asks first.
- [ ] "Reuse message" is an always-visible `text-cursor-input` icon button with its name and tooltip, asks before replacing existing text, and the dialog opens with focus on its footer "Close dialog" with `x`, which keeps the text.
- [ ] Below the box, the counter, a notice, a disabled reason and the destination line keep that order.
- [ ] The counter, the over-limit notice in its plural forms, the save-failure alert and the names, icons and disabled reasons of Send and Stop show as specified, and a box holding only whitespace behaves as an empty one.
- [ ] The data service rejects a researcher message over 20,000 code points, or holding only whitespace, sent without the composer, with `message_invalid`.
- [ ] `conversation.stop`, `destination.read` and `task.stop` reach the data service through the application port.
- [ ] These cases of the V16 scenario of `workspace-layout.md` pass for the composer, Send and Stop: Send turning into Stop, a delayed save confirmation, completion and cancellation in both orders, Stop before the provider answers, a failure before the message is saved, and double clicks that never send or stop twice; V16's partial output, failure after the save and unknown outcomes belong to STORY-003-013, and its status-read failure is STORY-003-010's failed conversation load.
- [ ] These cases of the V17 scenario of `workspace-layout.md` pass for the composer: Enter during IME composition, Hangul input, and 20,000 code points with emoji sent and stored without truncation; V17's tables, formulas and external links belong to STORY-003-011.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real keyboards are checked on the x86-64 virtual machines (IBus Hangul on GNOME and KDE in Ubuntu 26.04, Fedora 44 and Debian 13, and the Microsoft Korean keyboard on Windows); macOS uses simulated events in CI.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] The composer matches the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-017, including the look of a disabled Send or Stop, and is compared with the EPIC's composer capture, with each difference fixed or reported as a defect of the reference.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Its texts with plural forms are ICU plural messages, each count with its own plural selector; if the typed plural rendering contract that `docs/localization.md` requires of plural message producers is not on the base branch yet, this story adds it before its first plural message, and otherwise reuses it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
