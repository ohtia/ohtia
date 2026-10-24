---
type: Specification
title: "Product definition"
description: "Purpose, academic workflows, trust, and scope of the local Ohtia desktop workspace."
verified:
  by: human:AdrianMastronardi
---

# Product definition

## Purpose

Ohtia helps undergraduate students, graduate students, and researchers turn a corpus of sources into structured, traceable and challengeable knowledge for theses, dissertations, scientific papers and other academic work. The researcher develops and writes the argument. Ohtia helps discover, understand, question and connect its foundations.

The central problem is fragmented intellectual work: a researcher can collect hundreds of references while losing track of what they support, where authors disagree, which conclusions depend on shared data, and what to investigate next. Producing more fluent text does not solve that problem.

The first useful experience can start with a tentative question, one source or a passage of an existing draft. Building a large graph, choosing a model or completing a long questionnaire is not a prerequisite for receiving help.

## Audience and ownership

The primary user owns and operates a local project. Undergraduate students need help delimiting a feasible question and recognizing adequate support. Graduate students need continuity between literature, methods, evidence and argument. Researchers need an examinable record of reasoning, revisions and limitations. These needs share a product, with depth and vocabulary adapted to the task rather than separate disciplinary editions.

Supervisors, librarians and institutions may influence requirements or review exported work. That role grants no access to a project. The researcher chooses what to share through files and checks its restrictions first.

Ohtia is open source under the repository's MIT license. Opening, reading, organizing and editing local research, and generating manuscript or bibliography outputs, do not require an Ohtia account or subscription. Connected services retain their own authentication, terms, charges and account limits. An Ohtia installation does not confer provider access.

## Desktop experience

Ohtia is delivered as a graphical Electron application for Windows, macOS and Linux. The researcher creates or opens a project, connects optional providers and works through the interface without using a terminal. Phone and tablet applications are outside this desktop scope.

The application guides provider setup, reports missing dependencies and offers supported installation or selection paths. Installing Ohtia and enabling a particular external integration are distinguishable operations. A missing integration does not prevent access to existing local work.

Local ownership describes where project authority resides. Inference, discovery, downloads and authentication can involve external services. A connection explains what leaves the computer, for what purpose and under which provider account. Content restrictions apply to queries, excerpts, attachments, tool results and derived material as well as originals.

## Product principles

### PRIN-001. Help find the way

The researcher chooses the destination and the next action. Ohtia explains possible routes and the evidence behind its suggestions.

### PRIN-002. Preserve researcher authorship

The researcher directs and takes responsibility for the thesis or paper. Ohtia offers questions, source summaries, criticism, structural alternatives and proposed wording changes, with their origins identified. An agent proposal remains separate from the manuscript until the researcher explicitly reviews and approves the exact changes. Preserve agent contribution and researcher approval as distinct provenance; accepting wording does not itself confirm its evidence or citations. [Agent collaboration](agent-collaboration.md#editorial-proposals-and-approval) defines the review and application contract.

### PRIN-003. Guide intellectual work

Prefer an examinable question, comparison or next step over a finished answer that conceals the work required to justify it. Automation can prepare material; it cannot perform the researcher's confirmation.

### PRIN-004. Preserve provenance

Transforming a source into an extraction, summary, claim or relation retains the original identity, version, location and transformation history needed to examine it.

### PRIN-005. Separate evidence and inference

Distinguish what a source says, what an observation records, what an author interprets, what the researcher concludes and what an agent proposes. A generated explanation does not acquire source authority through fluency.

### PRIN-006. Expose uncertainty

Ambiguity, inaccessible evidence and insufficient support are legitimate results. A confident presentation cannot repair missing foundations.

### PRIN-007. Declare coverage

Search and analysis report what was actually examined and what was omitted, unavailable, unreadable or outside scope. An imported file is not a fully read source. A result based on an abstract is not a full-text finding.

### PRIN-008. Preserve disagreement

Keep incompatible interpretations visible with their evidence and comparison conditions. A summary does not erase disagreement to produce an artificial consensus.

### PRIN-009. Explain consequential findings

Important suggestions expose their inputs, reasoning and limits. A support path locates evidence; it does not itself prove the conclusion follows.

### PRIN-010. Allow challenge and correction

The researcher can inspect, reject, correct or revisit a proposal. A correction preserves the earlier record and identifies dependent work requiring review.

### PRIN-011. Keep technology behind the task

The interface uses research activities and plain explanations. Provider configuration and technical diagnostics are available where useful without becoming the normal research workflow.

### PRIN-012. Treat sources as first-class material

Sources include published and private research material, with different representations, provenance and restrictions. Publication, accessibility, fidelity and methodological adequacy remain separate dimensions.

### PRIN-013. Preserve the process

Research questions, methodological decisions, objections and revisions matter alongside final prose. Durable history belongs to the project and remains useful when a provider account is disconnected.

### PRIN-014. Support exploratory and directed search

A broad exploration and a targeted verification have different purposes and declared scopes. Searches preserve their queries, enabled providers, filters, timing and limitations.

### PRIN-015. Prefer depth to volume

More sources, relations, tokens or daily activity do not establish better research. Ohtia favors relevant, examined material and bounded processing over automatic corpus-wide generation.

### PRIN-016. Permit an honest stopping point

When content, access, capabilities or evidence are insufficient, show what cannot be done and a useful next step. Never manufacture completion, authorization or certainty.

When principles conflict, preserve authorship, restrictions and epistemic honesty before convenience or throughput. Explain the resulting limitation instead of silently weakening the principle.

## Research model

A `project` is one research undertaking, such as a thesis or scientific paper, within the local Ohtia installation. Ohtia manages multiple research projects and a personal source library. Sources and their retained representations can be reused through explicit project associations; notes, arguments, drafts and human review retain their research scope. Conceptual meaning lives here; persistent identities, relationships and ownership live in the [data model](data-model.md).

- `source`: material used by the research, with identity, bibliographic information, versions, representations and use restrictions.
- `claim`: a proposition attributed to a source, linked to a precise representation and evidence anchor.
- `evidence`: the passage, observation, datum or result used to support an attribution or argument.
- `relation`: a typed and justified connection between claims or between sources.
- `note`: researcher-authored text associated with project material.
- `question`: an open research or examination question.
- `hypothesis`: a researcher position retained as unresolved.
- `argument`: the researcher's proposition, support, inferential step, assumptions, objections and limits. Its support can include documented original results and reasoning.
- `decision`: a methodological or scope choice with its grounds and consequences.
- `draft`: the manuscript written by the researcher, with versions and anchored citations and comments.
- `feedback`: an observation on a particular draft or source version, with the original contribution separated from extraction or agent interpretation.

A source's `kind` determines its evidence locator: `document` uses textual locations, `dataset` a dataset version and query, `media` a region or time interval, `software` a repository/version and code location, and `object` a catalogue identifier and custodian. An `object` denotes the physical item; photographs of it are separate digital material. Recording a locator does not claim Ohtia executed or examined it.

The independent `publication` values are `published` and `unpublished`. For unpublished material, `origin` distinguishes `generated` by the researcher from `accessed` under restricted access. Preserve acquisition procedure, dates, custodian, relevant method, applicable ethical conditions and restrictions. A complete origin record documents assertions; it does not certify that an event occurred or a method is adequate.

Published material records the available publication identity, edition/version, corrections or retractions, location and access conditions. Private material can support an examinable attribution; publication does not automatically make evidence accessible or valid. Restrictions propagate through excerpts, summaries and dependent arguments, with explicit review when their applicability changes.

Relations between claims can express support, contradiction, extension, replication, criticism, definition or context. Relations between sources describe citation, derivation and shared material. Citation or shared subject matter does not prove support. Several papers using one dataset are not automatically independent confirmations.

## Source discovery and processing

The researcher enables and disables search adapters independently. Each offers only the public, API-key or sign-in modes it actually supports. Public access is a provider capability, not a promise of anonymous or unlimited querying. A failed authenticated mode never silently switches access method or identity.

A search preserves its purpose, query, providers, filters, pages or cursors examined, duplicates, failures and accessible-content scope. Combining results preserves per-provider provenance and declared incompleteness. Credentials and institutional sessions are not included in queries or exported projects.

Discovery identifies material; incorporation records the version and representation retained or referenced. Access to a landing page, abstract or institutionally readable article does not establish permission for automated retrieval or external processing. Ohtia respects the researcher's recorded restrictions and the integration's supported access conditions without claiming to adjudicate rights.

The initial semantic comparison scope is accessible, permitted text from `document` sources, including private transcripts treated as text. Dataset/code reexecution, interpretation of original audio/video, and examination of physical objects require separate capabilities. A textual transcript check does not validate the recording, event or methodology. Unsupported tables, images, mathematics, languages and unreadable regions remain visible in coverage.

## Proposals and human review

Model output enters the project as an attributed proposal or analysis result, never as human-confirmed knowledge. Review identifies actor, exact content version, evidence examined, scope and limitations. Confirmation uses a separate human interface action and is rejected when the expected version no longer matches. An agent cannot generate that action through a tool.

Changing content does not transfer an earlier confirmation to its replacement. Correcting a claim or withdrawing evidence identifies dependent relations, arguments and draft comments requiring review; it does not automatically declare the conclusion false. Retain the exact representations examined rather than silently reanchoring them to newer extractions.

Before proposing a contradiction, identify both propositions and their anchors, the incompatible point, comparison conditions and assumptions. Different populations, definitions, contexts or methods may explain the tension. When comparability is unresolved, present a question.

## Manuscript and feedback

The researcher edits the manuscript only through Ohtia's visual academic editor. Markdown remains its canonical format and is retained as `TEXT` in immutable SQLite revisions; a standalone `draft.md` is generated on request, not maintained as a second editable authority. The [draft format](draft-format.md) defines manuscript structure independently of editor internals. Citations, notes, formulae, figures, tables and cross-references survive editing, saving and supported exports with explicit fidelity reports.

A citation comparison distinguishes supported, partly supported, ambiguous, not located in examined content, contradicted by examined content, and not verified because sufficient examination was impossible. It records the citation's function: specific attribution, a work's overall contribution, contextual reference or declared secondary citation. Missing access is not a contradiction or evidence of absence.

The researcher can export a versioned DOCX or PDF for a supervisor and incorporate returned comments as external material. Preserve the original file, attributed commenter and delivered version where identifiable. Uncertain correspondence remains unresolved. Ohtia does not promise lossless round-trip editing or automatically apply a supervisor's changes.

Writing and review are explicit modes. While the researcher writes, new observations, notices and suggestions do not interrupt; findings remain available for the review pass. The researcher can defer notices except those warning of data-loss risk. Requesting new model analysis remains an explicit research action under the connection and execution rules below.

Criticism distinguishes three levels: a verifiable error, a defensible weakness and a question a reviewer is likely to ask. Each finding explains its grounds, examined scope and limits; the level is not a truth certificate or a grade for the manuscript. The [design system](design-system.md#criticism-and-review) defines their labels, marks and presentation.

Criticism adapts to the research question and its disciplinary reasoning. Quantitative guidance distinguishes institutional requirements, comparable examples and the project's corpus. Without an adequate basis, it does not invent universal quotas for chapters, sources or claims.

## Navigator and workflow

The Navigator explains where the researcher left off, what needs attention and why a next action is useful. It works from the first project opening, including an empty corpus. Its stage, current focus and pending reviews are distinct; research can advance on several fronts and revisit a completed milestone. [Virgilio and the research specialists](agent-collaboration.md) provide on-demand guidance and bounded contributions through that workspace, while stored Navigator information remains available without inference. [Ohtia and agent identity](agent-identity.md) separates the female product character from named AI contributors and human supervisors; a character reaction does not confer authorship, confirmation or scientific validity.

The seven-stage thesis route, outputs, reentry paths and paper adaptation live in [Thesis workflow](thesis-workflow.md). A schedule indicator is available only with an agreed plan, dates and availability. It describes pace against that plan, never intellectual quality. No green badge certifies an argument or replaces examination of its support.

## Connections and economical inference

The initial integration targets are OpenAI and Anthropic products through supported, provider-permitted access methods. Availability, account entitlement, subscription eligibility and tool controls belong to each adapter's declared capabilities. Ohtia keeps research data and review authority independent of provider threads and account identifiers.

Inference starts from an explicit research action. Editing, opening a project, viewing the Navigator and browsing stored findings do not silently start paid analysis. A user can authorize a bounded batch with visible scope, maximum work and stop conditions. Automatic resumption after a crash, account change or quota failure cannot enlarge that authorization.

Reuse valid results by input version, analysis policy and effective adapter/model configuration. Retain uncertainty about cost and token usage when a provider does not report them; do not display unknown consumption as zero. Budgets distinguish enforceable limits from estimates. Cancelling local work does not promise that the provider stopped billing or that transmitted content was recalled.

Disconnecting or disabling a provider prevents new work through that connection and makes ongoing work's state explicit. Local reading, editing, review and manuscript export remain available. Switching providers does not silently migrate conversation history or send a project to a different service.

## Languages and accessibility

The repository's English documentation is independent of interface and manuscript language. The interface baseline covers `en-US`, `en-GB`, `en-AU`, `en-CA`, `es-ES`, `es-MX`, `es-AR`, `pt-BR`, `pt-PT`, `fr-FR`, `fr-CA`, `fr-BE`, `de-DE`, `de-AT`, `de-CH`, `it-IT`, `nl-NL`, `nl-BE`, `sv-SE`, `da-DK`, `nb-NO`, `fi-FI`, `ca-AD`, `ca-ES` and `ko-KR`. Locale selection has an explicit user override; [ADR-0024](adr/adr-0024-typed-localization-catalogs.md#interface-locale-resolution) defines system preference matching and the fallback policy.

Interface translation, analysis language, source language and manuscript language are separate settings. Changing a setting does not translate existing research or relabel its original language. A catalog's structural completeness does not establish linguistic quality. Human review and machine assistance are disclosed honestly.

The interface targets WCAG 2.2 AA with keyboard-operable research workflows, readable focus, scalable text and meaningful announcements; the [frontend architecture](frontend-architecture.md) defines verification. Model output quality must be evaluated for each enabled operation and language; translated labels do not establish model competence.

## Evaluation

The principal diagnostic is draft traceability coverage: eligible substantive propositions with a complete, locatable, researcher-reviewed support path divided by all eligible propositions in the examined draft version. Partial support and dependencies needing review do not count as complete. Inaccessible evidence stays in the denominator. Pending classification is reported separately; a zero denominator is not applicable. This measures traceability, not truth or understanding.

Evaluate fidelity, context, useful disagreement, coverage, review effort, preparation effort, omissions and later corrections using synthetic or permitted public cases and explicit criteria. User acceptance is feedback, not a precision estimate. Never send private projects to external evaluation or telemetry by default.

Success is a useful examined result and an informed next step, including rejection of a suggestion. Source counts, graph size, daily engagement and token consumption are not quality targets. Pauses and completed research are normal.

## Boundaries and decisions requiring further evidence

Ohtia does not ghostwrite manuscripts, operate a shared literature corpus, bypass provider access controls or guarantee exhaustive systematic-review search. Collaborative cloud editing and mobile delivery are separate future scope decisions. The first desktop product must preserve independent local use rather than require hosted Ohtia infrastructure.

Validate the minimal source-to-draft-comparison-to-human-decision route with users. Define manuscript import fidelity, bibliography-manager integration, operation/language quality thresholds, launch OS/CPU/version matrix and achievable adapter access methods before the corresponding delivery commitments. The [architecture](architecture.md) identifies the technical boundaries; concrete component choices require evidence before implementation.
