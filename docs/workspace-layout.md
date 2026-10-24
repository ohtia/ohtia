---
type: Specification
title: Workspace layout
description: Deterministic workspace geometry, accessible panel controls, desktop layout preferences and interaction acceptance scenarios.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: workspace-reference
    resource: https://github.com/ohtia-edu/ohtia/blob/5b3264e23500b4457806f7436a58cc7e3832c8e5/docs/epics/EPIC-003-identidad-proyectos-e-interfaz-de-producto/epic.md
    title: Ohtia web — Workspace interaction reference at commit 5b3264e
---

# Workspace layout

## Scope and ownership

This document owns workspace geometry, panel interaction, the non-sensitive layout preference record and their acceptance scenarios. [System architecture](architecture.md#application-preferences-and-bootstrap) owns shared preference storage and bootstrap. It adopts the reference workspace's visual and interaction rules within Ohtia's desktop boundaries.[^workspace-reference] All required behavior is defined here or in the linked local specifications; the reference is supporting provenance.

[Design system](design-system.md) owns visual tokens, typography, icons and component appearance. [Frontend architecture](frontend-architecture.md) owns the application port, renderer state, manuscript editing and connection/task presentation. [Product definition](product-definition.md) owns research meaning and authorship. Layout actions preserve research state under PRIN-002, PRIN-004 and PRIN-013; they do not authorize domain mutations or provider work. [ADR-0011](adr/adr-0011-bounded-durable-local-tasks.md) owns execution and cessation, independently of whether a panel is visible.

One controller owns layout calculation and the window's live layout state; it submits the layout record through the shared application preference boundary. It composes presentation models and domain callbacks through the frontend application port; integrations use that controller rather than constructing a second shell or persistence implementation. These requirements describe observable behavior, not an existing implementation or a private component API.

## Workspace component measurements

These layout-specific tokens are canonical here because they express panel roles and workspace padding absent from the shared semantic layer. They supplement the [design system's component measurements](design-system.md#component-measurements); consumers resolve aliases by name rather than copying values into components.

- `component.workspace.explorer.initial`: 256 px; `component.workspace.explorer.minimum`: 200 px. They set the explorer's starting and usable widths.
- `component.workspace.documents.minimum`: 320 px. It bounds the document surface independently of the preferred reading width.
- `component.workspace.chat.initial`: 360 px; `component.workspace.chat.minimum`: 280 px. They allow a composer and long translated controls.
- `component.workspace.context-bar.minimum`: alias of `component.panel.header-minimum`; `component.workspace.context-bar.padding`: alias of `space.4`; `component.workspace.context-bar.gap`: alias of `space.2`. They preserve context controls when panels are hidden.
- `component.workspace.document.padding`: alias of `space.3`; `component.workspace.content.padding`: alias of `space.2`. They distinguish the outer document region from its reading content without adding a second spacing scale.

Rail, separator/guard and target measurements use the existing `component.rail.*`, `component.separator.*` and `component.target.*` tokens. Numerical examples below are derived acceptance values, not alternative token definitions. Token changes require updating affected calculations and examples together.

## Regions and surfaces

The workspace fills the available window. The context bar occupies its own row above three ordered panels: `explorer`, `documents` and `chat`. Panel widths include border and padding. Scrollable children can shrink in both dimensions; wide code, tables and formulas scroll within their own blocks, without horizontal page scrolling. Headers, footers and the chat composer remain outside their panel's scrolling content.

The context bar uses the named workspace context-bar minimum, padding and gap tokens. It contains the Ohtia symbol/name, active-project selector, adjacent `Plus` control for creating a project, optional selected-document context, the three panel controls and `RotateCcw` for Reset layout. It remains outside hideable panels. At narrow widths its controls wrap into additional rows; essential controls never disappear into overflow. Truncated names retain their complete accessible text and tooltip.

- `explorer`: uses its workspace initial/minimum width tokens. Its heading is Project contents; it contains the active project's materials, the Navigator entry and Settings. When hidden in wide layout, it leaves the `component.rail.width` control rail, or `component.rail.coarse` with a coarse pointer. The rail is not a visible panel and contains no project collection.
- `documents`: uses its workspace minimum width token and initial width given by the calculation below. It contains the Documents heading, tabs, active document and focus-mode control. Navigator is the fixed first tab, cannot be closed and is activated when a project opens. Hiding documents leaves zero width and no rail.
- `chat`: uses its workspace initial/minimum width tokens. It contains the conversation heading, history/new-conversation controls, scrollable messages/activity and a composer in its own bottom row. Hiding chat leaves zero width and no rail. History replaces the right panel's content; it is neither a fourth column nor a modal.
- Separators occupy `component.separator.line` between each pair of adjacent visible panels: two for three panels, one for two and none for one. There is no separator against the explorer rail. When documents are hidden, one separator directly joins explorer and chat.

Use the design system's `type.doc.body` and `type.doc.title`, with the named workspace document/content padding tokens on each side and text capped at `measure.reading`. Interface chrome uses the corresponding Sans roles. The reading-width target is `L = measure.reading + 2 × (component.workspace.document.padding + component.workspace.content.padding)`, with `measure.reading` resolved against the document body font size. The current derived value is `34 × 18 + 2 × (12 + 8) = 652` CSS px. Changing those tokens requires updating the derived target and affected geometry expectations together.

## Deterministic wide geometry

Use wide layout when the available workspace width is at least 1024 CSS px. Let `W` be the usable width rounded down to a whole CSS pixel; any remaining fraction stays outside the allocated panels. Let `n` be the number of visible panels, `R` the explorer rail width when explorer is hidden (otherwise zero), and `A = W − R − 4 × (n − 1)` the width available to panels.

Without saved preferences, all panels are visible with preferred widths explorer 256, chat 360 and documents `max(L, W − 624)`. The 624 includes both side panels and both separators. Default preferences created while narrow use reference width 1280.

Resolve effective widths from preferences as follows:

1. Take only visible panels and raise each preferred width to its minimum. Hidden panels retain their preferred widths.
2. If their sum is below `A`, give all surplus to documents when visible, otherwise chat, otherwise explorer.
3. If their sum exceeds `A`, subtract the excess from documents down to `L`, then chat to its minimum, then explorer to its minimum, and finally documents to its minimum. A panel already below a threshold yields zero at that stage; this calculation never enlarges it merely to reach that threshold. Skip absent panels and stop as soon as the excess is exhausted.
4. Round each result down to whole pixels, then assign the remaining integer pixels to the last visible panel. The results sum to `A` and preserve all minima. A single visible panel receives all of `A`. The maximum of a panel is `A` minus the other visible panels' minima; chat has no fixed two-thirds maximum.

All nonempty combinations fit their minima at supported wide widths. Resolving a viewport change changes only effective geometry; it does not overwrite saved preferences. Reopening a side panel uses the same calculation except that, after documents has yielded down to `L`, the other side panel yields before the reopened side panel. Documents yields below `L` only after both side panels have reached their minima. Thus reopening restores the requested width when it fits without unnecessarily shortening the reading column; a constrained reopen retains the hidden panel's preference for later.

Initial examples, excluding the context bar's vertical space:

- At `W=1440`: explorer 256, separator 4, documents 816, separator 4, chat 360.
- At `W=1280`: explorer 256, separator 4, documents 656, separator 4, chat 360.
- At `W=1024`: explorer 200, separator 4, documents 536, separator 4, chat 280.
- At `W=1440` with documents hidden and initial preferences: explorer 256, separator 4, chat 1180. Reopening documents restores 256/4/816/4/360.
- At `W=1440` with only documents or only chat: rail 40 and panel 1400, or rail 48 and panel 1392 with a coarse pointer. With only explorer visible, explorer receives 1440.

## Resizing and cancellation

Resizing starts from the effective widths and transfers space only between the two neighboring panels, preserving their combined width and minima. A third panel does not change. User resizing may deliberately reduce documents below `L`; only its workspace minimum token is mandatory. Reaching a minimum never hides a panel.

Each separator has `role=separator`, vertical orientation, a localized name Width between {leftPanel} and {rightPanel}, `aria-controls` for both panels and min/current/max values describing the left panel's width. Its line uses `component.separator.line`, with a centered `component.target.minimum` target and `component.separator.guard` of clear space inside each neighbor; with a coarse pointer use `component.target.coarse` and `component.separator.guard-coarse`. This space is included within panel widths and keeps the target from covering text or other controls. Focus remains visible without clipping.

Dragging right increases the left panel and reduces the right; dragging left does the inverse. ArrowLeft/ArrowRight subtract/add 16 px to the left panel, or 64 px with Shift. Home/End select its minimum/maximum while preserving the neighbor's minimum. Each panel also offers `Minus`/`Plus` buttons named Reduce width of {panel}/Increase width of {panel}; they transfer 16 px against the visible right neighbor, or the left neighbor if there is no right neighbor. Hide these sizing buttons when only one panel is visible.

Capture only the initiating pointer. Pointerup confirms the gesture; Esc, `pointercancel`, focus loss, unmount or viewport/visibility change cancel it and restore the starting widths before any new geometry is resolved. Every exit releases capture, cursor and selection locks. Width transitions are disabled while dragging. Keyboard/button actions commit once per completed action; a pointer gesture commits only on successful release. At confirmation, retain the effective widths of all visible panels as their preferences and preserve hidden panels' preferences.

## Visibility, focus mode and narrow layout

Panel controls are always available in the context bar. They have stable `aria-controls`, `aria-expanded` matching visibility, localized tooltips and these names/icons:

- `PanelLeft`: Fold project contents when open; Open project contents when hidden or on its rail.
- `AppWindow`: Hide documents/Open documents.
- `PanelRight`: Hide chat/Open chat.
- `Maximize2`/`Minimize2`: Expand document/Return to previous layout.
- `RotateCcw`: Reset layout.
- `Settings`: Settings, available in the explorer footer, rail and narrow context bar. Any provider sign-out action identifies its corresponding connection/account; it is not an Ohtia-account sign-out requirement.
- `Plus`: Create project, beside the project selector. `MessageSquarePlus`: Create conversation in {projectName}, in chat. `List`: Conversation history. `ArrowLeft`: Return to conversation, in history. These are separate actions with separate destinations.

Targets use the design system's `component.target.minimum`, or `component.target.coarse` with a coarse pointer. The last visible panel's hide control remains focusable with `aria-disabled=true`; activation does nothing and explains that at least one panel must remain visible. An empty panel still counts; the rail does not. Before hiding a focused panel, move focus to its context-bar control. Reopening focuses the panel heading and restores its reading position. Hidden content leaves Tab order and the accessibility tree without destroying its state.

In wide layout, Expand document captures an in-memory snapshot of visibility and preferences, shows only documents plus the rail and retains focus on the control, now Return to previous layout. Returning resolves the snapshot against the current viewport. A manual panel visibility/width change exits focus mode and keeps the resulting choice; it leaves no stale restoration that can later override that choice. Focus-mode entry/exit does not overwrite persistent layout preferences. Reset layout always exits focus mode, shows the three wide panels with current-width defaults and preserves content and theme. When invoked while narrow, reset saves defaults calculated at 1280 and selects documents without displaying three narrow panels.

Below 1024 px there is exactly one full-width region, with no rail, separators, sizing controls or focus-mode controls. Context-bar selectors switch among Project contents/Documents/Chat without losing private in-session state. On entering narrow layout, retain the focused region when visible; otherwise choose documents if visible, then chat, then explorer. On first narrow opening select documents. Narrow selection and focus-mode snapshots stay in memory; entering narrow layout discards an active focus-mode snapshot and preserves the underlying wide preference, so returning wide restores that preference. A region cannot be hidden leaving none selected. Returning wide resolves the saved wide preference and moves focus to the appropriate context-bar control if its current region becomes hidden. Selecting a material reveals documents; conversation selection does not change the document. No layout change sends, cancels or restarts work.

The reading order is skip link, context bar, explorer, documents and chat; DOM and visual order agree. Only one modal dialog is open at a time. Dialogs make the background inert, contain focus, close through their button/Esc and restore focus to the trigger. Settings uses `component.dialog.max-width`, at least `space.4` window margins and internal scrolling when needed; its language, diagnostics and concurrency behavior follows the frontend/ADR contracts. Theme selection offers System/Light/Dark with `Monitor`/`Sun`/`Moon`, applies immediately and preserves project, conversation, language and editor state. System follows the OS appearance; selecting a theme never changes OS settings. Save this choice as the separate [application appearance preference](architecture.md#application-preferences-and-bootstrap), not inside the layout record.

## Desktop preference boundary

Persist only the exact layout record `{version: 1, visible: {explorer, documents, chat}, preferredWidths: {explorer, documents, chat}}` as `workspace_layout` through the [application preference boundary](architecture.md#application-preferences-and-bootstrap). It is application-wide across research projects. The trusted broker owns the persisted record; do not use browser `localStorage` or copy the web reference's browser/origin key. No content tables, selected project IDs or provider credentials belong in this record.

Before use, validate exact keys, version 1, three booleans with at least one true, and finite widths between each panel's minimum and 100000 CSS px. Reject extra fields, malformed data, unknown versions and invalid types. Missing or unusable preferences select defaults without blocking the workspace. An unavailable or failed write preserves the current in-memory layout and announces once per application session that the layout could not be remembered; it does not report success. Failure to load the layout preference alone does not make research storage unavailable.

Save on completed resize actions, visibility changes and Reset layout. A visibility-only change updates the visibility flags while retaining every panel's preferred width; it never saves expanded/clipped effective widths as preferences. Reset explicitly replaces both flags and widths with defaults. Do not write on pointer movement, cancelled gestures, passive viewport/zoom adjustments, narrow selection or focus-mode entry/exit. Serialize updates through the broker. Each window loads the latest saved record when it creates its controller and retains its own live layout; another window's write does not rearrange it. A user-confirmed layout action writes that window's complete record in broker order, without retrying a stale record automatically. Last accepted write supplies the preference for subsequently opened windows.

The record contains no user/project/document/conversation IDs, titles, paths, open tabs, source versions, manuscript text, unsent messages or other private buffers. Focus, gestures, narrow selection and temporary geometry stay in memory. Hiding, resizing and changing panels preserve the current project's selections, input, composition, scroll anchors and active task destinations. Project switching isolates those buffers by project and validates resource identities before showing restored content. This layout record neither promises cross-restart restoration of private buffers nor weakens the manuscript editor's separate recoverable-save and shutdown contracts.

## Presentation integration

Presentation models declare scope/resource identities, expected versions, selection revision, collection state, ordered rows, pagination and supported actions. Scope and operation IDs are captured when invoking domain callbacks; late results update only their still-valid origin and never steal current selection. Loading, empty, failed, unavailable and populated remain distinct. Unsupported actions explain their missing capability; catalog fixtures never become production data. The application port owns domain receipts and restrictions; the layout controller owns geometry and panel selection only.

The explorer uses semantic lists and native buttons, not a partial tree role. Groups expose expansion state and independent loading/error/retry behavior. Selecting material opens or activates one tab for its stable identity, reveals documents and preserves conversation selection. Tabs use manual keyboard activation: arrows and Home/End move focus, Enter/Space activate, and Delete requests closing a closable tab. Close buttons are siblings of tab controls, not nested buttons. Overflow scrolls the tab row only. Closing an active tab selects its right neighbor, otherwise left; closing the last closable tab selects the fixed Navigator. Closing never deletes material or cancels work. Pending edits offer Save and close/Keep open/Discard and close with initial focus on Keep open; failed or unavailable save/discard blocks closing and preserves the buffer.

Project and conversation forms preserve input, operation identity and expected versions through controlled failures and uncertainty. Creating a conversation reveals chat only when the captured project selection is still current. History and conversation selection preserve document tabs/versions, unsent input, reading anchors and active work. Rename conflicts retain the draft title; a late generated title cannot overwrite a newer manual title. Archive/delete actions require declared domain capabilities and their explicit confirmation/retention contract; the presentation layer cannot invent deletion or silently stop active work.

Chat presentation separates message submission/confirmation from response progress and durable task state. Before dispatch, enforce the [frontend disclosure and authorization boundary](frontend-architecture.md#connections-tasks-and-consumption); changing the button's presentation grants no provider authority. Send becomes a Stop control immediately when submitting starts, bound to that operation even before a provider reference exists; repeated activation cannot create duplicate sends or stop requests. Stop-pending disables that control while showing the actual task outcome, including uncertainty. Clear only the exact submitted input after a confirmed receipt; retain newer edits. A saved message is not resent merely because its response failed. Partial/stopped/failed/complete output remains distinguishable, and a terminal task is not revived by a late fragment. Reconciliation, retry permission and fresh attempts follow ADR-0011 rather than a separate UI execution state machine.

Timeline items have stable identities, monotonic revisions and supplied ordering/correlation. Repeated IDs/snapshots do not duplicate messages, tools or counters; stale revisions are ignored. Group adjacent equivalent successful operations with a count, but failures and intervening messages remain distinct. Researcher edits, Ohtia proposals, title updates and confirmed saves retain their actual actors and versions. Activity cannot certify human confirmation or overwrite a pending manuscript edit. New streamed content does not move a reader already above the end; returning to chat restores its anchor and composer. Copy reports success only after clipboard confirmation; reusing text never overwrites existing input without a decision. Rich preview uses the same untrusted-rendering boundary and never inserts provider prose into the manuscript.

## Acceptance scenarios

Verify the delivered controls with synthetic data under the packaged CSP, in both themes, pseudolocalization and `ko-KR`, using screenshots plus geometry, state, focus and content assertions. Use the product locale inventory and desktop accessibility matrix for their full applicable coverage. A screenshot generated by the implementation is not its own acceptance oracle. These scenarios specify expectations; none is a claim of executed desktop verification.

- **V01 — Distribution:** verify the 1440, 1280 and 1024 examples above within 1 CSS px; keep context bar, headers, footers and composer from overlapping content.
- **V02 — Hide/restore:** exercise all seven nonempty panel combinations and both rail sizes, the hidden-center example, last-panel protection, focus mode/restore and manual exit from focus mode without losing tabs, buffers or active work.
- **V03 — Sizes/preferences:** exercise both separators, keyboard/Shift/Home/End and all width buttons. From the initial 1024 layout, the left separator permits explorer 200–416 and documents 536–320; the right permits documents 320–536 and chat 496–280. Cover every cancellation route, hidden-center resizing, viewport-only clipping, restart restoration, corruption, all-hidden tampering, unavailable writes, cross-window isolation and Reset layout in wide/narrow modes.
- **V04 — Active project:** use three synthetic projects with the second selected, 120-character names, Hangul and bidirectional text; preserve full accessible names, stable collection order, pagination selection and independent explorer group states.
- **V05 — Project forms:** distinguish Create project from Create conversation; verify initial/return focus, repeated clicks, Enter/Esc/IME, preserved input, duplicate-submission prevention, controlled failures, uncertain receipts, expected-version conflicts and late results that do not change the active scope.
- **V06 — Surface states:** distinguish loading/empty/error/unavailable/populated in each collection, document and chat; provider absence does not create fixture content or prevent local reading/editing.
- **V07 — Chat fit:** verify empty/long messages, attributed voices, lists/quotes/code/URLs, hostile HTML, multiline preview, copy failure and reuse with prior input, at 280 px and with long translations.
- **V08 — Independence:** switch conversations while reading a document, hide/reopen every panel during streaming and traverse project A→B→A during delayed reads. Preserve origin-scoped buffers, anchors and execution; inspect the persisted layout record for absence of IDs/private content.
- **V09 — Tabs:** open two documents without duplicate tabs, test manual keyboard activation, active/inactive closures, fixed Navigator, overflow and long titles. New revisions announce availability without replacing pending edits; rejected saves keep the tab open, and restored resource IDs are revalidated.
- **V10 — Narrow/reflow:** test widths 1023/600/320, 200%/400% zoom, height 400 and a virtual keyboard. Keep selectors/Settings available, one full-width region, no page overflow, preserved state and valid focus when returning wide, including from focus mode.
- **V11 — Accessibility/locales:** verify keyboard journeys, names/states, menus/tabs/dialogs, forced colors, reduced motion, text spacing and contrast. Validate every required locale structurally and report actual human linguistic/assistive coverage separately.
- **V12 — Controls/Settings:** check the specified icon/action/name mapping, rail-only explorer, hidden content outside Tab/accessibility trees, single-modal rule, theme application and dialog focus return without losing editor state.
- **V13 — History scope:** project-scoped history replaces chat content and returns without changing documents, drafts or active work. Verify delayed A→B→A results, late conversation creation, pagination/error/unavailability and panel reopening in both history/chat views.
- **V14 — Conversation actions:** test declared create/rename/archive/delete capabilities, IME, conflicts and a generated title arriving after a manual edit. Failed actions preserve rows/buffers; deletion cannot proceed without its domain contract, confirmed user intent and the required active-work handling.
- **V15 — Timeline:** supply a message, two equivalent successful reads, one failed read, a response, researcher edit and title update. Expect successful reads grouped ×2, failure separate and intervening response to break grouping; replay IDs/final snapshots without duplication or invented save confirmation.
- **V16 — Submission/cessation:** test immediate Send-to-Stop transition, delayed message confirmation, both completion/cancellation orders, stopping before provider identity exists, partial output, pre-save failure, post-save response failure, unknown outcomes and status-read failure. Duplicate actions/results remain idempotent; no blind resending or terminal-state revival occurs. Test the ADR-0011 states and required explicit recovery actions.
- **V17 — Rich input:** exercise supported lists, tables, code, inline/display formulas, Hangul, external links and hostile/incomplete content through message/preview. Use a synthetic 20000-code-point input limit to test emoji and over-limit rejection without truncation; production limits come from the enabled operation. IME Enter does not send, and wide content scrolls locally.
- **V18 — Synchronization/reading:** receive partial output while reading above the end and artifact/title events while chat is hidden and a manuscript has pending edits. No event reveals chat, replaces the edit, applies a stale title or mixes project scope. Returning restores input/anchor; live and confirmed views preserve semantic content and provenance.

Record results by scenario, artifact, viewport, theme and locale, including failed and unexecuted checks. Pure layout tests do not establish real provider cessation, native IME, persistent research correctness or complete accessibility conformance.

[^workspace-reference]: The pinned reference defines web workspace geometry, controls and scenarios. The complete desktop requirements above use the local application preference boundary, fixed Navigator and canonical task/research contracts; browser authentication and storage mechanisms are not adopted.
