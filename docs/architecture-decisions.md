---
type: Specification
title: "Architecture decisions"
description: "Criteria, structure, version ownership, numbering, and review of significant Ohtia architecture choices."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: nygard
    resource: "https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions"
    title: "Michael Nygard — Documenting Architecture Decisions"
---

# Architecture decisions

## Purpose and admission

An ADR records one significant technical choice, why it fits Ohtia and what it costs to change. Requirements describe the necessary behavior; an ADR chooses a way to meet them. Product principles and repository formatting rules retain their own canonical locations rather than acquiring an ADR solely because they are important.

Use a short context, decision and consequences structure informed by Michael Nygard's original guidance.[^nygard] Before adding a record, identify a concrete choice, plausible alternatives, the affected boundary or quality guarantee, and the reason the choice matters. A component name, list of aspirations or implementation task does not by itself justify a record.

Keep schemas, full contracts and operating procedures in their canonical specifications. The ADR links them and explains the choice; it does not maintain a second version of their detail. Closely related mechanisms can share a record only when they form one justified choice with common consequences.

## Structure

Each record uses `type: DecisionRecord`, a title naming `ADR-NNNN` and the concrete choice, and a one-sentence description. Follow the repository's generated/verified provenance and index rules in [AGENTS.md](../AGENTS.md#documentation-and-open-knowledge-format). No `status` field or body status inventory is introduced.

- **Context:** the problem, linked requirements, constraints, meaningful alternatives and selection criteria. Distinguish measured facts from assumptions and evidence required later.
- **Decision:** the selected mechanism, authority boundary, scope and explicit limits, in active voice.
- **Consequences:** benefits, maintenance and operational costs, risks, verification expectations and triggers for reconsideration.

A record is reviewable technical content, not proof of implemented behavior or a human approval certificate. Do not copy an old `verified` identity, date or acceptance claim into a rewritten choice. Human confirmation is recorded only when explicitly supplied for the new content.

## Organization and evolution

The [register](adr/index.md) lives inside the single `docs/` bundle. Use four-digit IDs from `ADR-0000`, increment without gaps reserved for nonexistent documents, and use descriptive English slugs. This guide has no ADR number. Arrange the initial register from general technical foundations toward specialized research behavior, beginning with the security verification framework as ADR-0000. Once integrated, identifiers remain stable and new records append to the sequence; do not renumber published decisions to maintain thematic order. The new register does not inherit the old web project's IDs or imply compatibility with its choices.

Review changes together with their affected product/architecture contracts. Security and data-authority boundaries precede enabling mechanisms that depend on them. The owner's review of these local documents happens before a commit; integration follows the repository PR rules. Local drafting does not itself approve an architectural choice.

Editorial corrections and clarifications preserve an ADR's identity. A materially different choice receives a new ID; link it to the previous record and retain the earlier rationale with an explicit replacement link. This records a substantive architectural dependency, not a session chronology or alternate Git history. Chronology, discussion and review evidence remain in Git and the associated issue/PR.

## Technology versions and ownership

The ADR that adopts a language, runtime, tool or library owns its selected version line. Write that line as inline code in the exact form `major.minor.*`. Both the major and minor are explicit; the wildcard permits reviewed patch selection within that line. Independently versioned packages in a framework declare their own lines rather than acquiring an invented common version.

Declare each software version only where its use is selected. Other ADRs and architecture documents name the component without repeating the version and link to its owning ADR. Moving or updating a selection must preserve one canonical owner. Compatibility ranges and observed patch identities belong in concrete source metadata, manifests and verification evidence rather than becoming competing software selections in referring documents.

Exact patches, artifact hashes and transitive resolutions live in manifests, lockfiles and build/CI configuration. A wildcard in an ADR neither updates dependencies automatically nor establishes that every patch is compatible or safe. Patch changes require review and affected checks; changing the selected major/minor line also updates the owning ADR. Publication and declared engine/peer ranges are not evidence of an integrated Ohtia build.

Standards and protocols retain their official editions and identifiers instead of receiving invented patch wildcards. Assets without a major/minor/patch release scheme retain their native upstream identity and file hash. Source URLs, quotations, synthetic examples, measured artifact versions and `generated.by`/`verified.by` provenance preserve their actual identifiers; they are not dependency selections. A named provider, hosted service or unselected candidate does not acquire an invented software version. Existing script compatibility minima remain documented until deliberately changed.

## Desktop foundation boundary

The register covers local runtime and privilege separation, provider/attempt authority, source-library data and migrations, development toolchains, quality and release policy, localization, accessibility, academic editing and manuscript deliveries. These records select foundational responsibilities without claiming a particular provider runtime, OS sandbox, database binding or editor package already satisfies them.

Before Desktop application foundation is published, check that its stories can implement these boundaries without deciding conflicting contracts in code. Before later integration/editor/release work, resolve their explicit platform, access, fidelity and packaging prerequisites. A required guarantee without a demonstrated mechanism remains an enabling condition rather than an implicit feature.

[^nygard]: Nygard's context/decision/consequences approach informs the concise record structure; Ohtia's repository metadata and review rules remain local conventions.
