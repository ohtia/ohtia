---
type: DecisionRecord
status: deprecated
title: ADR-0045 — Personally signed source history after an approved baseline
description: Deprecated source-history signature decision, replaced by ADR-0049 main source selection without historical signature checks.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0045 — Personally signed source history after an approved baseline

This decision is deprecated and replaced by [ADR-0049 — Main source selection for package preparation](adr-0049-main-source-selection-for-packages.md). Package preparation does not enforce commit-signature or repository-integration policy.

## Context

[ADR-0041](adr-0041-independent-linux-signing-service.md) separates signing authority from GitHub administration. Its reproducible-merge exception permits a merge without a personal signature when admitted parents reproduce its tree. Requiring explicit personal authorization for every new commit instead gives integrations the same source-authority boundary as ordinary changes. GitHub's platform signature and a collaborator's repository role do not establish possession of an independently authorized personal key.

The repository can contain bot-authored commits and platform-signed merges before this boundary is initialized. Rewriting those commits would replace published identities without establishing an independently reviewed initial state. Requiring a new signed descendant alone would leave the unadmitted ancestry unresolved.

## Decision

This decision replaces ADR-0041's reproducible-merge exception. The independently administered policy selects one exact initial source commit and an explicit allowlist of personal SSH public keys. Independently review and approve the selected baseline and the extent and limitations of its supporting evidence before activation. The approved baseline includes that commit and all its ancestors; it does not assert that earlier commits carry authorized personal signatures. No release, request, repository variable or ordinary merge selects or advances this baseline automatically.

For a requested descendant source, require a valid authorized personal SSH signature on every commit outside the approved baseline's ancestor closure, including every merge commit. Admit all parents before admitting their descendant; signing a merge, release commit or follow-up never authorizes an otherwise unadmitted ancestor. Retain the bounded graph, object, byte and time limits and the supported one-parent and two-parent shapes. A personally signed merge authorizes its actual tree, including reviewed conflict resolutions. An unsigned reproducible merge, a GitHub platform signature, a Verified badge or repository membership grants no exception. Tool versions and source acquisition remain owned by ADR-0041.

Verified-prefix cache keys include source-admission version 2 and the complete policy identity. Prefix signatures use the UTF-8 domain `ohtia-source-prefix-v2`, one NUL byte and the canonical record. Only `personal-signature` records are admissible. Earlier cache namespaces and signature domains are incompatible, including records for personally signed descendants whose parents were admitted under the former merge exception. Retain historical evidence, but recompute admission under the new contract; changing the image without isolating those records is insufficient.

Keep the issue-first dependency and personally signed integration procedures in [Repository policy](../repository-policy.md#dependency-updates). No private source key is provisioned to Dependabot, GitHub Actions or the signing service. Initial baseline selection, authorized-key changes and deployment approval remain independent administrative operations.

## Consequences

Every post-baseline integration needs a personal signature on its final merge commit. A platform-created merge does not qualify merely because its parents are signed. Preserve PR review, CI provenance, branch protections and human integration authorization; qualify the personally signed merge route against the actual protected branch before enabling signing. This decision does not authorize a main-branch push or a protection bypass.

Dependency bots remain proposal producers. Adopting their reviewed diff in an issue-backed personally signed commit preserves the trust boundary without admitting their original commit. An accidentally integrated unauthorized post-baseline commit blocks that descendant history until a separately reviewed recovery decision; do not silently advance the baseline or rewrite published history. A required immutable recipe source must also remain compatible with the selected baseline and the bounded verification policy.
