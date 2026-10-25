---
type: Specification
title: "Ohtia and agent identity"
description: "Product character, fixed contributor names and historical inspirations, human attribution, and accessible event-driven presentation."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: virgil-guide
    resource: "https://dante.princeton.edu/cgi-bin/dante/DispToynbeeByTitOrId.pl?INP_TITLE=Virgilio"
    title: "Princeton Dante Project — Virgilio, summarized entry"
  - id: sabor-reference
    resource: "https://www.bn.gov.ar/biblioteca/salas/lectura-parlante"
    title: "Biblioteca Nacional Mariano Moreno — Sala Parlante Josefa Emilia Sabor"
  - id: borges-reader
    resource: "https://www.bn.gov.ar/agenda-cultural/borges-libros-y-lecturas"
    title: "Biblioteca Nacional Mariano Moreno — Borges, libros y lecturas"
  - id: erasmus-humanist
    resource: "https://www.erasmushouse.museum/en/discover/erasmus/"
    title: "Erasmus House — Erasmus"
  - id: erasmus-programme
    resource: "https://erasmus-plus.ec.europa.eu/about-erasmus"
    title: "European Commission — What is Erasmus+?"
  - id: spivacow-editor
    resource: "https://eudeba.com.ar/cm/quienes-somos/"
    title: "EUDEBA — Quiénes somos"
  - id: moliner-lexicography
    resource: "https://cvc.cervantes.es/lengua/mmoliner/"
    title: "Instituto Cervantes — María Moliner, en el centenario de su nacimiento"
  - id: kuhn-methodology
    resource: "https://news.mit.edu/1996/kuhn-0724"
    title: "MIT News — Fall memorial planned for Professor T.S. Kuhn"
---

# Ohtia and agent identity

## Purpose and ownership

Ohtia is the desktop research workspace and the name of its female researcher character. Virgilio is a named AI research guide within that workspace. Specialists contribute identifiable research work; an external supervisor contributes human feedback. Keep these identities legible without requiring the researcher to learn an organizational chart or a fictional cast before receiving help.

This document owns the relationship between those identities, contributor labels and character-presentation behavior. [Agent collaboration](agent-collaboration.md) owns research responsibilities and coordination. [Design system](../design-system.md#ohtias-symbol-and-character) owns illustration geometry, tokens, animation drawings and component presentation. [Workspace layout](../workspace-layout.md) owns responsive regions. Identity follows the contribution and its provenance when panels move, rather than belonging to a fixed screen column.

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

Present research activities and role labels before the fixed contributor names defined under [Contributor names and historical inspirations](#contributor-names-and-historical-inspirations): Reference librarian, Analytical reader, Critical evidence reviewer and Writing review, with its Academic editor and Proofreader modes. Methodological guidance and later specialist extensions follow the collaboration contract. Personal names cannot replace role descriptions or imply the authority, qualifications or opinions of a historical person.

Each role has a stable visual identifier and accessible name, distinct from provider/model configuration and execution state. A provider change does not require a new character. A role change cannot silently reuse another contributor's identity or rewrite earlier attribution. Retain the displayed contributor identity and definition version with each finding; cosmetic avatar changes do not reclassify its producer or review state.

### Researcher and external supervisor

Researcher text retains the ordinary manuscript/interface treatment. Imported supervisor comments identify their original author according to the document or researcher declaration, delivered manuscript version and uncertainty of attribution. The existing `voice.tutor.*` family and `user-round` mapping identify this human-origin feedback, not Virgilio or an AI critic. Import metadata is an attribution, not authentication of the person's identity.

Agent extraction or interpretation of a supervisor comment is a separate contribution with its own AI label. It must not inherit the human comment's voice or authority. Human approval of an editorial change and confirmation of evidence remain separate commands and cannot be represented by an avatar, expression or decorative motion.

## Contributor names and historical inspirations

The canonical contributor names are **Virgilio**, **Josefa**, **Jorge Luis**, **Erasmus**, **Boris**, **María** and **Thomas**. Preserve these exact display spellings in every interface language, including the space in Jorge Luis and the accent in María. Names are not translated, transliterated or replaced with language-specific variants; Virgilio and Erasmus remain the same in every locale. Localize role labels, descriptions, pronoun presentation and surrounding text while preserving each character's identity.

These names are homages for distinct AI characters. Contributor profiles identify the historical inspiration and explain the choice without presenting the agent as that person, reproducing their opinions or inheriting their qualifications. The pronouns below describe the Ohtia characters. Naming does not determine the provider, model, operation capability or authority; role contracts and evaluation remain governed by [Agent collaboration](agent-collaboration.md).

### Virgilio and research guidance

Virgilio is the research guide, with he/him pronouns. The name refers to the Roman poet Publius Vergilius Maro and his role as Dante's guide through Hell and Purgatory in the Divine Comedy.[^virgil-guide]

The choice expresses accompaniment through a difficult intellectual journey: helping the researcher find a route, ask useful questions and recognize the guide's limits while retaining responsibility for the investigation. Virgilio is the fixed international character name, including in languages that use another name for the historical poet.

[Virgilio's operational profile](agent-virgilio.md) defines the role's bounded operations, context, results and evaluation requirements.

### Josefa and reference work

Josefa is the reference librarian, with she/her pronouns. The name honors Josefa Emilia Sabor, the Argentine librarian and teacher whose work included bibliography, reference and the education of librarians.[^sabor-reference]

The choice connects the role to professional bibliographic practice: identifying useful sources, explaining search and selection decisions, and keeping discovery distinct from examination of the material. It also recognizes an Argentine contribution to librarianship.

[Josefa's operational profile](agent-josefa.md) defines the role's bounded operations, context, results and evaluation requirements.

### Jorge Luis and analytical reading

Jorge Luis is the analytical reader, with he/him pronouns. The name honors Jorge Luis Borges, whose annotated books and reading practices are examined in the Biblioteca Nacional's Borges, libros y lecturas project.[^borges-reader]

The choice emphasizes attentive reading, interpretation and connections between texts. The character's academic contribution remains grounded in the exact material examined, with the author's statements separated from interpretation. The literary homage does not prescribe an imitation of Borges's prose.

[Jorge Luis's operational profile](agent-jorge-luis.md) defines the role's bounded operations, context, results and evaluation requirements.

### Erasmus and critical examination

Erasmus is the critical evidence reviewer, with he/him pronouns. The name honors Erasmus of Rotterdam, the Renaissance humanist whose scholarly work included a philological approach to the study of sacred texts.[^erasmus-humanist]

The choice evokes returning to sources and examining the grounds of an interpretation. The spelling Erasmus is retained as a single international identity; the choice also recalls the name of the European educational programme.[^erasmus-programme] The character examines support, limitations and disagreement through the evidence-review contract; the homage does not confer the historical scholar's authority.

[Erasmus's operational profile](agent-erasmus.md) defines the role's bounded operations, context, results and evaluation requirements.

### Boris and academic editing

Boris is the academic editor, with he/him pronouns. The name honors Boris Spivacow, whose editorial work was central to the founding of EUDEBA, the publishing house of the Universidad de Buenos Aires.[^spivacow-editor]

The choice connects academic editing with clear organization and making knowledge accessible. Boris offers structural and wording proposals while preserving the researcher's authorship, meaning and control over the manuscript. Within Writing review, this identity remains distinct from María's proofreading mode.

[Boris's operational profile](agent-boris.md) defines the role's bounded operations, context, results and evaluation requirements.

### María and linguistic care

María is the proofreader, with she/her pronouns. The name honors María Moliner, the Spanish lexicographer and librarian who authored the Diccionario de uso del español.[^moliner-lexicography]

The choice emphasizes precision, attention to usage and helping the researcher express an intended meaning. María distinguishes errors from valid language variants and stylistic preferences, preserving quotations and disciplinary terminology. The homage does not restrict the role to Spanish; supported languages require their own evaluation under the collaboration contract.

[María's operational profile](agent-maria.md) defines the role's bounded operations, context, results and evaluation requirements.

### Thomas and methodological reflection

Thomas is the methodologist, with he/him pronouns. The name honors Thomas Kuhn, the historian and philosopher of science whose work examined scientific paradigms and changes in the frameworks of inquiry.[^kuhn-methodology]

The choice emphasizes making assumptions explicit and examining the fit between the research question, objectives, material, design and analysis. Thomas helps the researcher compare and justify methodological choices, understand their limitations and revise a design when the grounds for doing so change. The homage does not require adherence to Kuhn's philosophy or privilege one methodological school; guidance accommodates quantitative, qualitative, documentary and theoretical research within evaluated capabilities.

[Thomas's specialist profile](agent-thomas.md) defines the dedicated methodological specialization described under [Methodological guidance and analysis extension](agent-collaboration.md#methodological-guidance-and-analysis-extension). Enabling this contributor requires its operation contract and quality evidence. The name alone does not add an enabled specialist to the initial selector, certify institutional or ethics approval, or authorize statistical/data execution.

## Visual family and attribution

Use a coherent family with the existing illustration's line treatment, geometric simplicity and level of detail. Distinguish roles with recognizable silhouettes and a restrained identifying motif rather than unrelated portrait styles or copies of the same face with different hats. Initial role icons or static avatars are sufficient; full illustrated characters require recognition and accessibility evaluation before replacing them.

The brand's glasses identify Ohtia. Each contributor's operational profile defines its own silhouette/motif brief and introduction, active-contribution and result-available gestures. [Contributor characters and avatars](../design-system.md#contributor-characters-and-avatars) owns the common full/avatar/symbol variants, palette, timing and static fallback. These briefs require final artwork and recognition checks at actual display sizes before adoption.

Keep provenance and specialty as separate visual dimensions. The `voice.ohtia.*` family identifies system/AI-origin contributions in voice labels, contributor symbols and AI-origin surfaces; a named AI contributor adds its own symbol, name and localized role within that family. Its full illustration and avatar use its own [identity colors](../design-system.md#contributor-identity-colors), which distinguish the character without indicating provenance, state, quality or authority. The human supervisor retains `voice.tutor.*`. Do not reuse evidence, warning, error or confirmation colors as role identities.

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

## Contributor presentation events

The initial repertoire consists of introduction, active contribution and result available. Their gestures and main poses are specified in the contributor profiles; [Contributor characters and avatars](../design-system.md#contributor-characters-and-avatars) owns the rendering and duration tokens. All eligibility checks, including current project, visible surface, relevant contributor, effective preference, absence of a visible manuscript and unused presentation allowance, apply before playback. The three moments do not authorize a sequence or additional animation budget.

### Introduction

An explicit first introduction of a contributor through its profile or dedicated onboarding surface can accompany that contributor's name, role and AI label. Allow at most one introduction gesture per contributor in the current project workspace session, using an accepted interface presentation action and its event identity. Opening an ordinary conversation, restoring history or receiving the contributor's first token is not an introduction trigger. Introducing a character does not admit an inference task or transmit project material.

An introduction derived from a project-opening/onboarding action shares that action's batch with Ohtia and other notices. Do not automatically introduce the entire roster. Repeated delivery, passive restoration or reopening an already introduced profile renders it statically. Hidden/nonanimated/suppressed introductions are not retained for replay.

### Active contribution

Use the gesture only when the application has observed the current contributor's admitted attempt actually entering its active operation. An accepted or queued task alone is insufficient. Queued, awaiting-permission, paused, disconnected, cancelled and uncertain states remain static with truthful phase text. A role motif indicates attention to that bounded contribution, not proof that a source was read or an analysis validated; an explicit reading label requires the actual examination scope.

A retry, resumed session, delegated child or handoff cannot create a fresh animation allowance for the intervention. After the brief gesture, keep the avatar and character still and use textual progress. An unavailable or hidden presentation is not replayed when the work becomes visible later.

### Result available

Use the gesture only for the current contributor's committed, accepted result with a known terminal receipt and relevant examined scope. A streamed draft, raw model verdict, failed output validation, unresolved execution or another contributor's result is insufficient. Partial results may qualify only when their accompanying text explicitly preserves the omissions and partial coverage. Failed, cancelled and uncertain work uses its own static notice rather than this gesture.

The gesture means that an examinable artifact is available. It cannot mean that the researcher confirmed evidence, approved wording, accepted a design, achieved a milestone or completed a thesis. Result availability and scientific adequacy remain distinct. Do not use celebration, checkmarks or approval gestures as the result cue. If the intervention batch already animated, including at its active phase, show the result statically. Background arrivals never navigate to a contributor or steal focus to play an animation.

## Character presentation preference

**Settings → Appearance → Characters** offers **Animated**, **Static** and **Hidden**. The application preference key is `character_presentation`; its schema-version-1 value is exactly `animated`, `static` or `hidden`. It contains no project, actor, document or provider identifiers. The default for a missing value is `animated`; an invalid/unreadable value or unavailable preference store uses `static` without rewriting the rejected record or claiming that a saved choice was loaded.

Persist the named preference through the [application preference boundary](../architecture.md#application-preferences-and-bootstrap). Confirmed changes apply across windows and survive restart. Selecting Static or Hidden immediately cancels active motion and invalidates deferred presentations in each affected workspace. A failed write preserves the previous confirmed value, leaves any preview visibly unsaved and reports the controlled failure. Replacing/resetting an invalid value is an explicit preference command with the normal revision/receipt rules. Character presentation does not modify execution limits, research permissions or provider state.

System reduced-motion preference overrides `animated` to static presentation; it never overrides `hidden`. When reduced motion becomes active, cancel current motion and any deferred animation immediately and render the appropriate static notice/pose. Returning to animated mode does not replay old events. `static` uses the defined still poses without motion; `hidden` omits full decorative character/pose presentation while preserving compact static contributor symbols, labels and every research action. Hiding decoration cannot hide an active contributor or evidence of its work.

## Recognition and interaction verification

Evaluate welcome/return, direct Virgilio conversation, direct specialist conversation, a combined response, a supervisor comment and a finding presented in the Navigator. Include central-only and chat-only layouts, a visible manuscript, narrow width, grayscale, keyboard use, reduced motion and characters hidden. Ask users to identify who produced the text, whether it was human or AI, who currently owns the conversation and whether the operation, evidence or wording was actually approved.

Verify event relevance, batch coalescing, cancellation on preference changes, static recovery after restart, cross-window preference receipts and the absence of implicit inference when opening profiles or changing identity presentation. Retain existing illustration assets and their documented geometry; this specification selects responsibilities without claiming that new specialist artwork or production event bindings are implemented. [Agent collaboration evaluation](agent-collaboration-evaluation.md) owns the evaluation procedure and evidence.

[^virgil-guide]: The Princeton Dante Project identifies the poet and his role as Dante's guide; the research-guidance rationale is Ohtia's naming choice.

[^sabor-reference]: Argentina's national library describes Sabor's bibliographic, reference and teaching work.

[^borges-reader]: The Biblioteca Nacional describes the examination of Borges's marginal notes and reading practices.

[^erasmus-humanist]: Erasmus House describes the humanist and his philological approach to interpreting texts.

[^erasmus-programme]: The European Commission identifies Erasmus+ as its programme supporting education, training, youth and sport in Europe.

[^spivacow-editor]: EUDEBA's institutional history identifies Spivacow's central role in its origins.

[^moliner-lexicography]: The Instituto Cervantes identifies Moliner's lexicographic work, dictionary and librarianship.

[^kuhn-methodology]: MIT describes Kuhn's work on paradigms and frameworks of scientific inquiry; the methodological role and naming rationale are Ohtia's design choice.
