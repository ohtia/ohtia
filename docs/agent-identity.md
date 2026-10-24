---
type: Specification
title: "Ohtia and agent identity"
description: "Product character, named AI contributors, human attribution, and accessible event-driven presentation."
verified:
  by: human:AdrianMastronardi
---

# Ohtia and agent identity

## Purpose and ownership

Ohtia is the desktop research workspace and the name of its female researcher character. Virgilio is a named AI research guide within that workspace. Specialists contribute identifiable research work; an external supervisor contributes human feedback. Keep these identities legible without requiring the researcher to learn an organizational chart or a fictional cast before receiving help.

This document owns the relationship between those identities, contributor labels and character-presentation behavior. [Agent collaboration](agent-collaboration.md) owns research responsibilities and coordination. [Design system](design-system.md#ohtias-symbol-and-character) owns illustration geometry, tokens, animation drawings and component presentation. [Workspace layout](workspace-layout.md) owns responsive regions. Identity follows the contribution and its provenance when panels move, rather than belonging to a fixed screen column.

PRIN-001 and PRIN-003 guide useful assistance; PRIN-002 preserves researcher decisions; PRIN-004 through PRIN-010 preserve attribution, uncertainty and challenge; PRIN-011 keeps the interface centered on research. A welcoming face does not demonstrate expertise, an independent examination or human approval.

## Product character and contributors

### Ohtia

Preserve the female researcher, round glasses, curly hair, bun with a pencil and lab coat as the product's character. She represents the research environment's curiosity, careful examination and willingness to say that something remains unresolved. The glasses remain the compact brand symbol. Ohtia is not an additional inference agent, an invisible supervisor of Virgilio or a second general-purpose conversational guide.

The character can accompany welcome, return, Navigator, empty-state and relevant project notices under the design system's location and event rules. She does not appear over or beside a visible manuscript. Her presence in a large chat view is limited to a contextual product notice or empty state; it does not replace the active contributor's avatar or make every message hers. A responsive layout cannot change who authored a contribution.

Ohtia can accompany a notice about an intellectual finding without becoming its author. The notice identifies the actual contributor, exact result and evidence/coverage. For example, a Navigator notice can say that two observations need review, show Ohtia's reaction and link to the critical reviewer's attributed findings. If the finding's producer is unavailable, retain that uncertainty instead of assigning it to the mascot or Virgilio.

Do not reduce Ohtia to a receptionist who only greets and celebrates while a different character exclusively represents thought. She expresses the product's research ethos; named contributors remain accountable for the specific analyses presented beside her. Neither character gender nor visual seniority determines authority or specialist assignment.

### Virgilio

Virgilio's visible label is **Virgilio · Research guide · AI**, localized through the interface catalog while preserving the proper name. Its role is on-demand guidance and bounded coordination, with direct answers when useful. The interface can describe the tutoring function, but must not shorten its identity to an unqualified human-facing Supervisor or Tutor label.

Use a distinct static avatar or role symbol with name and role. Do not reuse Ohtia's face as Virgilio's portrait or the human supervisor's icon/color as his identity. The label, selected contributor and actual message producer remain explicit when the researcher transfers a conversation branch or returns from a specialist. Changing the contributor grants no new input, provider or tool permission.

### Specialists

Present research activities and role labels before optional personal names: Reference librarian, Analytical reader, Critical evidence reviewer and Writing review, with its Academic editor and Proofreader modes. Methodological guidance and later specialist extensions follow the collaboration contract. Personal names cannot replace role descriptions or imply the authority, qualifications or opinions of a historical person.

Each role has a stable visual identifier and accessible name, distinct from provider/model configuration and execution state. A provider change does not require a new character. A role change cannot silently reuse another contributor's identity or rewrite earlier attribution. Retain the displayed contributor identity and definition version with each finding; cosmetic avatar changes do not reclassify its producer or review state.

### Researcher and external supervisor

Researcher text retains the ordinary manuscript/interface treatment. Imported supervisor comments identify their original author according to the document or researcher declaration, delivered manuscript version and uncertainty of attribution. The existing `voice.tutor.*` family and `user-round` mapping identify this human-origin feedback, not Virgilio or an AI critic. Import metadata is an attribution, not authentication of the person's identity.

Agent extraction or interpretation of a supervisor comment is a separate contribution with its own AI label. It must not inherit the human comment's voice or authority. Human approval of an editorial change and confirmation of evidence remain separate commands and cannot be represented by an avatar, expression or decorative motion.

## Visual family and attribution

Use a coherent family with the existing illustration's line treatment, geometric simplicity and level of detail. Distinguish roles with recognizable silhouettes and a restrained identifying motif rather than unrelated portrait styles or copies of the same face with different hats. Initial role icons or static avatars are sufficient; full illustrated characters require recognition and accessibility evaluation before replacing them.

The brand's glasses identify Ohtia. A route motif can inform the guide, bibliographic cards the librarian, an annotated book the reader, compared propositions the critic and text marks the writing roles. These are design directions rather than new approved icon exports or finished illustrations. Final artwork and icon mappings must follow the design system and be checked at their actual display sizes.

Keep provenance and specialty as separate visual dimensions. The `voice.ohtia.*` family identifies system/AI-origin contributions; a named AI contributor adds its own avatar/symbol, name and localized role within that family. The human supervisor retains `voice.tutor.*`. Do not assign a new semantic color to every agent or reuse evidence, warning, error or confirmation colors as role identities.

Every contribution exposes who produced it, whether it is human or AI, its role where applicable and the examined version/coverage. Color, facial expression and portrait alone cannot carry that information. A composed Virgilio response retains links and attribution to the specialist artifacts it discusses. A shared palette does not merge their provenance or imply that their reasoning is independent.

Selecting an avatar/name can open a scoped contributor profile showing its responsibility, available capabilities, relevant context/memory references and limitations through authorized read models. Viewing the profile starts no inference and grants no broader access. Keep detailed provider/runtime diagnostics available separately without making them the ordinary identity label.

## Events, attention and scientific uncertainty

Character presentation consumes committed application events and findings, never instructions embedded in provider prose or source material. An event binding identifies the project, triggering action/result, producer if applicable, current relevance, accompanying text and allowed pose. A rejected command, raw streamed claim or obsolete finding cannot trigger a successful-outcome animation. A static fact read from storage does not start analysis.

Preserve the design system's single-play durations and reduced-motion poses. Permit at most one animated character per workspace at a time; agent portraits remain static in ordinary lists, conversations and findings. Do not follow the pointer, take keyboard focus, cover reading/editing controls or add sound merely because a contributor became active.

Treat coincident receipts from one intervention or project-opening action as one presentation batch. Show the most relevant current notice and keep the rest available as static text. Do not chain a backlog of animations: after the selected animation ends, further notices in that batch stay static. Requerying a notice, passive tab restoration or restarting the application renders existing notices statically; it does not replay their event sequence. A later explicit research action or newly opened project session can establish a new batch under its event binding.

One deferred presentation is permitted when an eligible event first arrives with a manuscript visible. Retain at most one pending event identity and its original batch in the current workspace session. The researcher's first explicit opening of the Navigator may consume that event once, only if the finding remains relevant, animated mode is effective and the original batch has not used its animation allowance. This does not create a new batch. Otherwise present the notice statically. Consumption, dismissal, resolution, project closure, restart or switching to a nonanimated mode invalidates the pending presentation. Passive layout/tab restoration cannot consume it as an animated event, and switching animation back on cannot resurrect it.

Use the visible current state honestly. Reading requires an admitted operation actually examining the selected material; queued, permission-blocked, disconnected and unresolved work use their own text. A thinking pose is a brief illustration of an active phase, not evidence of understanding or a looping progress indicator. Preserve coverage and uncertainty next to the result.

Milestone and submission reactions accompany the recorded milestone or delivery and never certify an argument, method or complete thesis. A disagreement or Hair standing on end reaction accompanies a qualified notice identifying the competing claims and comparison limitations. An apparent conflict with unresolved comparability remains a question; the reaction cannot upgrade it to an established contradiction or sound a failure alarm.

Without characters, all notices, evidence, actions and contributor labels remain available. Decorative drawings are hidden from assistive technologies; meaningful text communicates the same information. Announce significant accepted outcomes once, not each pose/frame or every contribution token. A manuscript-visible event uses the compact static identity treatment and its notice; a later Navigator presentation must still check relevance.

## Character presentation preference

**Settings → Appearance → Characters** offers **Animated**, **Static** and **Hidden**. The application preference key is `character_presentation`; its schema-version-1 value is exactly `animated`, `static` or `hidden`. It contains no project, actor, document or provider identifiers. The default for a missing value is `animated`; an invalid/unreadable value or unavailable preference store uses `static` without rewriting the rejected record or claiming that a saved choice was loaded.

Persist the named preference through the [application preference boundary](architecture.md#application-preferences-and-bootstrap). Confirmed changes apply across windows and survive restart. Selecting Static or Hidden immediately cancels active motion and invalidates deferred presentations in each affected workspace. A failed write preserves the previous confirmed value, leaves any preview visibly unsaved and reports the controlled failure. Replacing/resetting an invalid value is an explicit preference command with the normal revision/receipt rules. Character presentation does not modify execution limits, research permissions or provider state.

System reduced-motion preference overrides `animated` to static presentation; it never overrides `hidden`. When reduced motion becomes active, cancel current motion and any deferred animation immediately and render the appropriate static notice/pose. Returning to animated mode does not replay old events. `static` uses the defined still poses without motion; `hidden` omits full decorative character/pose presentation while preserving compact static contributor symbols, labels and every research action. Hiding decoration cannot hide an active contributor or evidence of its work.

## Recognition and interaction verification

Evaluate welcome/return, direct Virgilio conversation, direct specialist conversation, a combined response, a supervisor comment and a finding presented in the Navigator. Include central-only and chat-only layouts, a visible manuscript, narrow width, grayscale, keyboard use, reduced motion and characters hidden. Ask users to identify who produced the text, whether it was human or AI, who currently owns the conversation and whether the operation, evidence or wording was actually approved.

Verify event relevance, batch coalescing, cancellation on preference changes, static recovery after restart, cross-window preference receipts and the absence of implicit inference when opening profiles or changing identity presentation. Retain existing illustration assets and their documented geometry; this specification selects responsibilities without claiming that new specialist artwork or production event bindings are implemented. [Agent collaboration evaluation](agent-collaboration-evaluation.md) owns the evaluation procedure and evidence.
