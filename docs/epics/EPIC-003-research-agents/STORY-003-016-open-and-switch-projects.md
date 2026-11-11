---
type: Story
title: "STORY-003-016 — Open and switch projects"
description: "Let the researcher list, open and switch projects and reopen the last one at start."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:app", "comp:storage", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/218
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage", "comp:docs"]
applicable_blocks: ["SPEC-003-021"]
---

# STORY-003-016 — Open and switch projects

## Description

Add the project selector with type icon and text, `projects.last_opened_at` ordering, per-project conversation restoration, opening the last project at start and new windows on the welcome, whose texts then point to the selector.

## Applicable specification

- [SPEC-003-021: Open and switch projects](./epic.md#spec-003-021-open-and-switch-projects)

## Tasks

- [ ] Start after STORY-003-015 is merged and its output is on the base branch: Project creation and setup flow.
- [ ] Start from the context bar in `WorkspaceChrome` (`packages/renderer/src/workspace-chrome.tsx`) and the project records of STORY-003-004, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for the required column `projects.last_opened_at`, set to `created_at` for every existing project; set it to the creation time in `project.create` and update it with the new command `project.open`, recorded in `command_receipts`, whenever a window opens a project, without touching `updated_at`.
- [ ] Carry `project.open`, with its operation identifier and the project, through the application port; add it to the commands that `command_receipts.command` accepts; and list in its `operationErrorCodes` entry `record_not_found`, next action `refresh_record`, for an identifier that names no project. When it fails, the window keeps the project it opened, and the order is written the next time it opens.
- [ ] Give STORY-003-004's read `project.list` a cursor: it takes the cursor `(last_opened_at, id)` of the last row received, empty for the first page, and a count of at most 40, and returns the next projects in the selector's order, packed as STORY-003-010's pages are, as many whole rows as fit the port's bounds, with where to continue and whether more projects exist; the window repeats the read until it has the count or reaches the end.
- [ ] Vendor Lucide `graduation-cap` from `lucide-static` 1.66.0 into `packages/renderer/icons/` with its hash in `manifest.json`, and regenerate `design-icons.ts` and the icon mappings through the existing `scripts/design_assets.py` procedure, whose `--write-icon-module` regenerates `design-icons.ts`.
- [ ] Build the selector as an APG select-only combobox: a combobox button named "Current project", whose value is the open project's title, "New thesis · Setting up" or, in a window without an open project, "No project open", opening a listbox of the projects from `project.list`, 40 at a time, ordered by `last_opened_at` and then `id`, both descending, or the status text "No projects yet." while none exists; read `project.list` afresh each time the listbox opens, because opening a project in another window changes the order without changing any record that `research.subscribe` names. While more projects exist, make the listbox's last row the button "Show more projects": an option, because a select-only combobox moves only among options, that does not choose a project; choosing it with Enter or a click keeps the listbox open, appends the next 40 projects after the last row, moves the highlight to the first of them, and is disabled while they load, with the status "Loading more projects…" announced politely; once no more projects exist, the button disappears. Scrolling the listbox loads nothing, as `design-system.md` requires ("Long lists are paginated or loaded in batches through an explicit action; scrolling does not load content without notice."). If a later page fails, keep the rows already shown and show above the button a danger notice with `octagon-alert`, announced as an alert, "Ohtia couldn't load more projects. They're still saved."; "Show more projects" then reads that page again. Build the rows with type icon, title or "New thesis" for a project in setup, and a second line "Thesis", or "Thesis · Setting up · {created}" for a project in setup, with `{created}` its creation date and time as a medium date and a short time in the interface locale; mark the open project's row with the `check` icon and `aria-current="true"`, with `aria-selected` following the highlighted option; add keyboard support and full accessible names for truncated titles. While the first page of `project.list` loads, show "Loading…" in the listbox marked `aria-busy`; when it fails, show a danger notice with `octagon-alert`, announced as an alert, "Ohtia couldn't load the projects. They're still saved.", with "Reload projects" below it, which reads the first page again.
- [ ] Restore each project's open conversation, unsent text and reading position when switching, or open its latest conversation.
- [ ] Open the last project in the first window at start and the welcome in new windows.
- [ ] In a window without an open project while projects exist, show the welcome paragraph "Choose a project in the project selector, or start a new one and set it up with Virgilio. You can also adjust language, appearance, zoom and layout in Settings." with the welcome's buttons, the chat text "Choose a project in the project selector to talk with Virgilio." without a composer and Project contents "No project is open."; keep STORY-003-015's texts while no project exists.
- [ ] Keep the selector in the bar's first row below 1,024 px, as `workspace-layout.md` defines, with `Plus` right after it.
- [ ] Build the selector button and its listbox to the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-021, and compare them with `epic-003-project-selector.png`, `epic-003-project-selector-states.png` and `epic-003-new-project-none-open.png`; the EPIC text prevails over a capture.
- [ ] Apply the documentation amendments of SPEC-003-021: in the `docs/design-system.md` fixed icon table, add "Thesis | `graduation-cap`" and "Open project in the project selector | `check`"; in `docs/frontend-architecture.md`, "The installed app opens to create/open/recent-project actions." becomes "The installed app opens the last opened project, or the welcome with its New project action when none exists."; in SPEC-002-023 of `docs/epics/EPIC-002-basic-interface/epic.md`, after "The chat region shows Create a project to talk with Virgilio. and renders no composer." add "When projects exist but the window has none open, the paragraph reads Choose a project in the project selector, or start a new one and set it up with Virgilio. You can also adjust language, appearance, zoom and layout in Settings. and the chat region shows Choose a project in the project selector to talk with Virgilio.", and after "they appear only with the capability that makes them work, in the positions workspace-layout.md defines." add "Once the project selector exists, a window without an open project shows it with the value No project open, and while no project exists its listbox shows No projects yet."; and in the `docs/workspace-layout.md` first-run welcome, after "The explorer says that no project is open, and chat invites the researcher to create a project to talk with Virgilio, without a composer." add "When projects exist but the window has none open, the paragraph and the chat sentence point to the project selector instead."

## Acceptance criteria

- [ ] Switching A to B and back with delayed reads keeps unsent text and reading position.
- [ ] Switching during a reply does not interrupt it.
- [ ] Starting Ohtia opens the last opened project, the selector order follows `last_opened_at` and then `id`, and the migration gives existing projects their `created_at`.
- [ ] A new window with projects shows "No project open" in the selector and the welcome and chat texts that point to it; with no project, the listbox shows "No projects yet."
- [ ] Below 1,024 px the selector stays in the bar's first row.
- [ ] Two projects in setup are distinguishable by their date and time and read "New thesis".
- [ ] A slow `project.list` shows "Loading…", and a failed one shows its notice with "Reload projects" below it.
- [ ] With 95 projects the listbox shows 40, "Show more projects" appends 40 and then 15 and then disappears, scrolling loads nothing, a failed later page keeps the rows with its notice, and pages that end between projects with the same `last_opened_at` lose and repeat none.
- [ ] Reopening the listbox after another window opened a project shows the new order.
- [ ] `project.open` with an unknown project identifier returns `record_not_found`, and a repeat with the same operation identifier returns its first result.
- [ ] The selector follows the select-only combobox pattern with the keyboard and a screen reader, and the open project carries the `check` icon and `aria-current`.
- [ ] With the researcher's account, two projects switch during a reply and the last one reopens after restart.
- [ ] The V08 scenario of `workspace-layout.md` passes for project switching.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] The selector matches the measurements in tokens of the "Measurements" list of this story's block, SPEC-003-021, and is compared with the EPIC's project-selector captures, with each difference fixed or reported as a defect of the reference.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, as STORY-003-019 can, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
