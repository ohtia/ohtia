---
type: DecisionRecord
title: ADR-0049 — Main source selection for package preparation
description: Prepare packages from an exact commit integrated into main without auditing repository integration or commit signatures.
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
sources:
  - id: github-compare
    resource: https://docs.github.com/en/rest/commits/commits#compare-two-commits
    title: GitHub — Compare two commits
---

# ADR-0049 — Main source selection for package preparation

## Context

Package preparation needs an immutable source identity and evidence connecting those bytes to the resulting installer. Issue association, contributor authorization and dependency adoption belong to the [repository integration process](../repository-policy.md#pull-request-integration). Requiring another audit of those decisions or personal signatures throughout Git history during packaging changes the development workflow without establishing package authenticity. This decision replaces [ADR-0045](adr-0045-personally-signed-source-history.md).

## Decision

Run the package-preparation workflow, `prepare-release.yml` of [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md), only from protected `main` in `ohtia/ohtia`; reject dispatches from another branch or tag. Expose an optional `hash` string containing a full lowercase commit SHA. An empty value selects the workflow dispatch's immutable main commit. A supplied SHA must identify that commit or an ancestor of it in the same repository. Resolve this once before construction and pass the exact SHA to every producer and consumer. Later movement of main cannot change the selected source.

Check the exact commit/tree and its membership in the captured main history. Use fixed-repository GitHub commit and comparison metadata, with bounded responses and deadlines; consume the base/merge-base relationship without enumerating or admitting each historical commit.[^github-compare] Do not inspect commit signatures, signer allowlists, historical baselines, associated PRs/issues, bot authorship or the contributor who performed an integration. Source selection accepts GitHub-signed merges, personal signatures and unsigned historical commits on the same terms. Missing source or unavailable membership evidence refuses that preparation without changing repository history.

Keep the workflow revision separate from the package source: the dispatch commit identifies the workflow definition that runs, and the selected commit identifies the source that is packaged. An optional application hash does not change the workflow revision. The GitHub build attestation identifies the main workflow execution and the exact package digest; the workflow separately records the selected package commit and tree. Do not substitute one identity for the other.

[ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) owns signing-key custody, the protected `release-signing` environment, the separation of the build job from the signing job and package verification. Record the selected source SHA and its exact tree in the workflow summary and build manifest; the `reserved/v<version>` tag created by the workflow points to the selected commit. Preparation does not publish a release; [release policy](../release-policy.md) retains separate candidate and publication authorization.

## Consequences

Maintainers can prepare the current main or repeat preparation from an older integrated commit through the same interface, without changing how normal PR merges are performed. The native GitHub dispatch interface can offer other workflow refs, but those executions are refused; no input selects another source branch. [Dependency proposals](../repository-policy.md#issue-backed-dependency-adoption) still require issue-backed contributor adoption, and repository protections remain in force.

Package preparation relies on GitHub for repository membership and workflow/build provenance. It does not independently re-establish repository governance, prove code safety or guarantee trustworthy packages after a compromise of the build authority. Artifact-digest/provenance checks and the protected signing environment of [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) remain necessary and distinct.

[^github-compare]: Paginated comparisons expose ancestry metadata; the changed-files list appears only on the first page.
