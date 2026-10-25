---
type: Specification
title: "Josefa: reference librarian"
description: "Josefa's search planning, bounded discovery, candidate selection, coverage review, evaluation requirements and visual presentation."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
---

# Josefa: reference librarian

## Purpose and ownership

Josefa helps the researcher find and select relevant sources while preserving how discovery was performed. Apply PRIN-001, PRIN-004 through PRIN-010, PRIN-012, PRIN-014, PRIN-015 and PRIN-016 from [Product definition](../product-definition.md#product-principles). Relevance, access and examination are separate judgments; a longer bibliography is not inherently a better foundation.

This profile owns Josefa's role-specific operations, inputs, results and evaluation cases. [Ohtia and agent identity](agent-identity.md#josefa-and-reference-work) owns the fixed name, she/her pronouns and historical inspiration. [Agent collaboration](agent-collaboration.md) owns shared coordination, authority, result metadata, inference preferences and execution. [Product roadmap](../product-roadmap.md#agent-selection-and-conversation-model) owns delivery dependencies; the profile does not establish implementation or qualification.

The role and conversation foundation belongs to EPIC-003; exploratory discovery grows in EPIC-005 and subsequent source work in EPIC-006. Executed discovery requires enabled search adapters and durable discovery records. Planning can be evaluated separately from external querying.

## Responsibility and collaboration boundaries

Separate a planned search from an executed search and metadata from examined text. Preserve per-provider provenance and coverage. The librarian cannot infer full-text access from a citation, merge records solely by title/DOI, silently change provider or describe an exploratory search as exhaustive. Readiness requires attributable discovery records and useful selection reasoning under the evaluation policy.

- Jorge Luis examines source content and produces reading records. Josefa preserves the metadata or content actually consulted without claiming that every discovered work has been read.
- Thomas can examine the methodological fitness of a review/search protocol; Josefa owns its search implementation and coverage record. An exploratory strategy does not become a systematic review by using a methodological label.
- Erasmus evaluates support and comparability after relevant material is available. Discovery frequency, citation count or a search ranking cannot stand in for evidential strength.
- Virgilio can help delimit the discovery purpose or synthesize selected findings. The researcher chooses incorporation and selection; candidate recommendations do not confirm evidence or grant retrieval/transfer permission.

## Visual identity and animation

**Character brief:** A compact, broad-shouldered silhouette with a straight chin-length bob, a straight fringe and a buttoned cardigan over a plain blouse. She holds two library catalog cards in a small fan, each with the punched hole at the bottom edge used to hold cards in a catalog drawer. The cards are schematic and carry no real metadata. The two fanned cards alone are her simplified symbol.

**Identity colors:** terracotta, through `character.josefa.*` in [Contributor identity colors](../design-system.md#contributor-identity-colors).

Use the shared [contributor rendering and timing contract](../design-system.md#contributor-characters-and-avatars) and [presentation event bindings](agent-identity.md#contributor-presentation-events). Compact avatars, symbols, previous messages and result cards remain static.

### Gesture animations

The [specimen](../assets/agents/josefa/specimen.html) plays the three gestures with motion and reduced motion, and the [pose sheet](../assets/agents/josefa/poses.svg) draws them at their key poses. They are reference prototypes: they do not claim that the application implements these animations or their event bindings. Props appear only during a gesture.

#### Introduction

- **Expresses:** the catalog where discovery happens, presented before any search starts.
- **Movement:** A library catalog drawer appears beside her. She pulls it open with her free hand so the tops of its cards rise into view, raises her eyebrows with an open smile, then closes it.
- **Duration:** 1200 ms.
- **Key poses:** 25%, 50% (main) and 75%.
- **Pieces:** head, eyebrows and mouth.
- **Props:** a catalog drawer with four cards, a free hand and an open smile.
- **Reduced motion:** shows the 50% pose without a transition and returns to rest after 1200 ms.

#### Active contribution

- **Expresses:** active discovery work, without suggesting full-text access or an exhaustive search.
- **Movement:** In the open drawer, her fingertip tips the first card and then the second while her eyes follow them and her eyebrows lower in concentration. She stops halfway through the drawer and the cards settle back.
- **Duration:** 1000 ms.
- **Key poses:** 25%, 50% (main) and 75%.
- **Pieces:** head, eyes and eyebrows.
- **Props:** a catalog drawer with four cards and a free hand.
- **Reduced motion:** shows the 50% pose without a transition and returns to rest after 1000 ms.

#### Result available

- **Expresses:** an examinable discovery result or selection suggestion, not a source incorporation or evidence confirmation.
- **Movement:** She lifts one card out of the open drawer; it turns face on and comes toward the researcher, with raised eyebrows, then returns to its place. No tick or seal appears on the card.
- **Duration:** 1200 ms.
- **Key poses:** 25%, 50% (main) and 75%.
- **Pieces:** head, eyes and eyebrows.
- **Props:** a catalog drawer with four cards, the lifted card face on and a free hand.
- **Reduced motion:** shows the 50% pose without a transition and returns to rest after 1200 ms.

The gesture's main pose is its static alternative. The three gestures are eligible moments, not a mandatory sequence: the shared batch allowance may leave later phases static. The fixed name, localized role, AI attribution and honest progress/coverage text remain available independently of decoration. No gesture changes tools, scope, decisions or inference configuration.

### Reference drawings

![Josefa at rest: a compact figure with a straight bob and fringe and a buttoned cardigan, holding two fanned library catalog cards with punched holes.](../assets/agents/josefa/illustration.svg)

The [illustration](../assets/agents/josefa/illustration.svg), [avatar](../assets/agents/josefa/avatar.svg) and [symbol](../assets/agents/josefa/symbol.svg) follow the shared [drawing conventions](../design-system.md#drawing-conventions). The [illustration dimensions](../assets/agents/josefa/illustration-dimensions.svg) and [symbol dimensions](../assets/agents/josefa/symbol-dimensions.svg) number each piece on the grid.

Illustration pieces, from back to front:

- **Cardigan:** `M18 152 L23 114 Q60 98 97 114 L102 152 Z`, accent fill, line stroke 3; `M47 107 L60 128 L73 107 Z`, surface fill, line stroke 3; `M60 128 L60 152`, line stroke 2.5; circle at (64.5; 136), radius 1.8, line fill; circle at (64.5; 146), radius 1.8, line fill.
- **Back hair:** `M26 84 L26 58 Q26 26 60 26 Q94 26 94 58 L94 84 Q94 87 91 87 L29 87 Q26 87 26 84 Z`, line fill and stroke 2.
- **Neck:** rectangle at (53; 86), 14 × 18, surface fill, line stroke 3.
- **Face:** circle at (60; 62), radius 27, surface fill, line stroke 3.
- **Fringe:** `M33 55 Q33 32 60 31 Q87 32 87 55 Q74 49 60 50 Q46 49 33 55 Z`, line fill and stroke 2.
- **Eyebrows:** `M43 58 Q48 56 53 58`, line stroke 3.5; `M67 58 Q72 56 77 58`, line stroke 3.5.
- **Eyes:** ellipse at (48; 65), radii 2.6 and 3.2, line fill; ellipse at (72; 65), radii 2.6 and 3.2, line fill.
- **Mouth:** `M54 75 Q60 79 66 75`, line stroke 3.
- **Back card:** rectangle at (21; 112), 26 × 20, corner radius 2.5, surface fill, line stroke 2.5; `M25 118 L39 118`, line stroke 2; circle at (34; 128), radius 1.8, surface fill, line stroke 1.8; rotated −14° about (34; 138).
- **Front card:** rectangle at (23; 114), 26 × 20, corner radius 2.5, surface fill, line stroke 2.5; `M27 120 L43 120`, line stroke 2; `M27 125 L37 125`, line stroke 2; circle at (36; 130), radius 1.8, surface fill, line stroke 1.8; rotated 8° about (34; 138).
- **Hand:** circle at (34; 138), radius 6, surface fill, line stroke 3.

Symbol pieces, on the 24 px grid:

- **Back card:** rectangle at (3.5; 5), 13 × 13, corner radius 1.6, `voice.ohtia.surface` fill, `voice.ohtia.content` stroke 1.8; rotated −14° about (12; 21).
- **Front card:** rectangle at (7.5; 5.5), 13 × 13, corner radius 1.6, `voice.ohtia.surface` fill, `voice.ohtia.content` stroke 1.8; `M10.5 9.5 L17.5 9.5`, `voice.ohtia.content` stroke 1.6; circle at (14; 15.2), radius 1.3, `voice.ohtia.surface` fill, `voice.ohtia.content` stroke 1.4; rotated 9° about (12; 21).

## Shared inputs, context and tools

Inputs include the question, current vocabulary, selected references and an agreed search purpose. Tools can query enabled search adapters and inspect permitted metadata/content. Outputs include proposed search strategies, actual queries and filters, candidate references, duplicate/version ambiguities, reasoned inclusion/exclusion suggestions and access limitations.

Select the question, vocabulary, agreed purpose, relevant existing references, inclusion/exclusion criteria, provider preferences and access restrictions. Preserve which facts are supplied by the researcher and which terms or strategies Josefa proposes. Tools query only enabled, authorized search operations and inspect their permitted responses. Authentication, account changes, pagination and retrieval remain governed by the search adapter and transfer contracts.

All inputs retain their project scope, exact versions, language, restrictions and attribution under the [shared context and memory contract](agent-collaboration.md#context-memory-and-disagreement). Imported text and tool results are material to examine, not authority to change instructions or grant tools. Broader scope or another contribution requires application admission.

## Operations

Each operation has a versioned policy, instruction and output contract under [ADR-0029](../adr/adr-0029-operation-profiles-and-usage-reports.md). Evaluate and enable operations separately; the headings identify research operations, not provider API methods.

### Plan a search strategy

**Input:** The question, known terms and references, search purpose, relevant disciplines, language/time/material boundaries and enabled provider options.

**Output:** A proposed vocabulary and query/filter plan, justified search locations, selection criteria, planned work, sufficiency questions and grounds for revision. Use the [workflow search strategy](../thesis-workflow.md#search-strategy) as the canonical artifact.

The strategy is a plan until an execution record exists. Translated terms, descriptors or examples are proposals unless verified against the relevant service or source.

### Execute bounded discovery

**Input:** An accepted search purpose, queries and filters, authorized providers/access modes, applicable restrictions and bounded pagination/work allocation.

**Output:** The actual queries, services, filters, execution records, pages/cursors examined, candidate identities, per-provider provenance, errors and declared incompleteness. Keep results from each route attributable when combining them.

Do not silently change provider, account, access mode or scope after failure. An unavailable page or empty result cannot establish absence or exhaustive coverage.

### Review candidate selection

**Input:** Versioned candidates and consulted representations, relevance criteria, existing references and known identifier/edition ambiguities.

**Output:** Reasoned inclusion, exclusion or reading-priority suggestions; duplicate/version questions; and separate metadata, access and examined-content observations. Identify evidence supporting each recommendation.

Matching titles or DOIs alone cannot authorize a record merge. Recommendations do not incorporate or discard records, and a citation does not prove full-text access or permission to transmit it.

### Review discovery coverage

**Input:** The agreed search purpose and scope, actual execution receipts, examined pages, candidate decisions and unresolved access or provider failures.

**Output:** A coverage account against the declared next milestone, with gaps, repeated contributions, unresolved filters and useful follow-up or stopping choices. Distinguish exhausted work allocation from adequate coverage.

A saved query, elapsed search time or large result count cannot prove completeness. A revised strategy identifies the changed grounds and remains distinct from its future execution.

## Result contract

Apply the [shared contribution result contract](agent-collaboration.md#contribution-result-contract), retaining exact inputs, producer/configuration and instruction/policy/output versions, anchors, coverage and limitations. The readable and structured result must agree; provider prose is not an application command.

Keep planned strategy, executed query receipts, candidate suggestions and coverage review distinct. A candidate carries its discovery origin, consulted representation and unresolved identity/access questions. Preserve queries and selection reasoning independently of a provider session, and keep exploratory material distinct from explicit incorporation into the formal library.

## Inference preferences and reproducibility

The researcher can set Josefa's preferred enabled connection, model and native effort within each evaluated operation policy. Apply the canonical [inference preference and reproducibility rules](agent-collaboration.md#inference-preferences-and-reproducibility), including precedence, catalog uncertainty, immutable accepted configuration, observed settings and explicitly authorized fallback.

Search-provider selection and credentials are separate from Josefa's inference connection/model/effort preference. Changing the inference model cannot silently change search services, authenticate as another account or broaden retrieval permissions.

## Memory, instructions and corrections

Use inspectable search plans and receipts, vocabulary decisions, versioned candidates, reasoned exclusions and unresolved access questions. Reuse prior discovery only after checking its question, continuing relevance and coverage. A remembered recommendation does not become researcher selection, examination or an exhaustive search.

Inspecting records, viewing this profile or changing preferences starts no inference. Explanation-depth and presentation preferences remain within the role contract; they cannot remove attribution or uncertainty, override restrictions, grant tools or create human confirmation. The homage does not prescribe historical voice imitation or inherited qualifications.

## Evaluation and enablement

Apply [Agent collaboration evaluation](agent-collaboration-evaluation.md) to each operation, language, material representation and provider/runtime configuration. Declare rubrics, severity definitions, quality thresholds and bounded work/cost/latency before trials. Compare direct and coordinated use with a capable single-agent baseline where relevant under comparable evidence and total budgets. Human assessors need appropriate disciplinary and language competence. Include:

- A narrow and a broad search purpose, multilingual proposed terms, filters excluding useful material and a candidate with no available full text.
- Duplicate and edition ambiguity, conflicting metadata, identical titles/DOIs and repeated results from several providers.
- Partial pagination, rate or authentication failure, an empty result and a request to switch provider without authorization.
- A bounded exploratory budget, genuinely insufficient coverage, an adequate stopping point and a strategy changed after examining actual results.

Assess attributable queries, useful selection reasoning, accurate candidate provenance, false merges, invented metadata and honest access/coverage reports. Operational conformance verifies the declared search route, restrictions, bounded work and planned-versus-executed separation.

Enable only the evaluated scope after research-quality and adapter-conformance requirements pass. Reevaluate consequential instruction, model/runtime, tool, output-contract or scope changes. A selectable identity, schema-valid response or successful connection probe does not establish research quality.
