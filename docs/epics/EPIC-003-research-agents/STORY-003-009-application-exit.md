---
type: Story
title: "STORY-003-009 — Application exit"
description: "Ask before quitting with running work and let the researcher keep working, wait or cancel."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:desktop", "comp:app", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/211
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:app", "comp:docs"]
applicable_blocks: ["SPEC-003-014"]
---

# STORY-003-009 — Application exit

## Description

Show the three-choice exit dialog only when tasks are running, wait or cancel accordingly, never show it for uncertain tasks or operating-system shutdown, and never use `shutdown_paused`.

## Applicable specification

- [SPEC-003-014: Application exit](./epic.md#spec-003-014-application-exit)

## Tasks

- [ ] Start after STORY-003-007 is merged and its output is on the base branch: Stop for running tasks.
- [ ] Start after STORY-003-008 is merged and its output is on the base branch: `service_runs` and the orderly-stop note.
- [ ] Start from `packages/main/src/entry.ts` (`before-quit`), `packages/main/src/shutdown.ts` (`stopBrokerServices`) and `packages/contracts/src/commands.ts`, and extend these existing boundaries rather than create parallel ones.
- [ ] Intercept closing the last window, Quit and the macOS Cmd+Q and Dock Quit, leaving other windows untouched; show the dialog in the window whose close was intercepted or, for a menu, Cmd+Q or Dock quit, in the most recently focused window, which main tracks through `browser-window-focus`.
- [ ] Exit without asking when no task is running.
- [ ] Implement the dialog titled "Quit Ohtia while replies are running?" with the body "{running} replies are still running. Replies that haven't started are kept for the next time you open Ohtia, unless you cancel the work." (with plural forms, `{running}` being the running tasks in every project) and initial focus on "Close dialog", with "Close dialog" (Esc), "Wait for replies, then quit", whose body becomes "Ohtia will quit when the running replies finish. {running} still running." with plural forms and a polite announcement as the count changes, and "Cancel work and quit", for which main sends the data service the command `task.cancelAll`, with an operation identifier main generates and recorded in `command_receipts`, which cancels queued and blocked tasks and stops running ones as Stop does.
- [ ] Change the existing `dialog.close` catalog text from "Close" to "Close dialog" in every supported locale catalog, so the header button and the safe option of every confirmation dialog read the same; "Close dialog" is already the close icon's name in `design-system.md`. That text names the header close button of every dialog and the footer close buttons of the About and Help dialogs in `packages/renderer/src/command-surfaces.tsx`, which all close their dialog. Move the one other use, the button that closes the "layout could not be remembered" notice in `packages/renderer/src/settings-surfaces.tsx`, which closes only that notice, to the new catalog key `settings.closeLayoutNotice`, "Close notice", in every supported locale catalog. The `dialogs.close` shortcut entry in `packages/contracts/src/commands.ts` keeps `dialog.close`, so the shortcut list reads "Close dialog".
- [ ] Hold queued tasks in memory while waiting to exit, never using `shutdown_paused`, and run the wait before `stopBrokerServices` starts.
- [ ] Exit without a dialog and without writing `clean_stop_at` on operating-system shutdown or logout: main still runs `stopBrokerServices`, as for any quit, but sends the data service the shutdown message with `orderly` set to `false` (STORY-003-008), so the data service drains and closes the store without writing `clean_stop_at`. Detect the shutdown or logout on Windows through the window events `query-session-end` and `session-end` (shutdown, restart and log-off), on macOS through `powerMonitor` `shutdown` (Electron emits it on `NSWorkspaceWillPowerOffNotification`, which macOS posts for a logout or a power-off), and on Linux through `powerMonitor` `shutdown` (reboot and shutdown) and main's own `process.on("SIGTERM")` listener, which treats that signal as a shutdown or logout because Electron reports no logout there and would turn the signal into an ordinary quit.
- [ ] Apply the documentation amendment of SPEC-003-014 to `docs/frontend-architecture.md`: "Quit with unresolved remote work requires its distinct acknowledgement after local cessation is proved." becomes "Uncertain tasks do not open the exit dialog, and an operating-system shutdown or logout exits without it, so the next start applies the crash rules."; ADR-0011's exit choices are already replaced by the ADR written in STORY-003-005.

## Acceptance criteria

- [ ] Each of the three choices behaves as specified with the fake provider, and the dialog shows its texts with the live count.
- [ ] Quitting with no running task exits at once, and closing one of two windows leaves tasks untouched.
- [ ] A crash during the wait applies the crash rules on the next start.
- [ ] A menu quit with no focused window shows the dialog in the most recently focused one.
- [ ] With simulated events, `session-end` on Windows, `powerMonitor` `shutdown` on macOS and Linux, and a `SIGTERM` to main on Linux each exit without a dialog or `clean_stop_at`, after a shutdown message with `orderly` `false`.
- [ ] With the researcher's account, quitting with each choice mid-reply, logging out and powering off during a reply behave as specified.
- [ ] Uncertain tasks alone do not open the dialog.
- [ ] The header close button of every existing dialog and the footer close buttons of About and Help are named "Close dialog", the Settings layout notice's button is named "Close notice", and the `dialogs.close` entry of the shortcut list reads "Close dialog".

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] The dialog meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance; Esc runs "Close dialog"; and it is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] The dialog's texts with plural forms are ICU plural messages with their own plural selector; if the typed plural rendering contract that `docs/localization.md` requires of plural message producers is not on the base branch yet, this story adds it before its first plural message, and otherwise reuses it.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
