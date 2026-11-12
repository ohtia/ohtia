---
type: DecisionRecord
title: ADR-0049 — Main source selection for package preparation
description: Prepare packages from an exact commit integrated into main without auditing repository integration or commit signatures.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: github-compare
    resource: https://docs.github.com/en/rest/commits/commits#compare-two-commits
    title: GitHub — Compare two commits
  - id: github-reuse
    resource: https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
    title: GitHub — Reuse workflows
---

# ADR-0049 — Main source selection for package preparation

## Context

Package preparation needs an immutable source identity and evidence connecting those bytes to the resulting installer. Issue association, contributor authorization and dependency adoption belong to the [repository integration process](../repository-policy.md#pull-request-integration). Requiring another audit of those decisions or personal signatures throughout Git history during packaging changes the development workflow without establishing package authenticity. This decision replaces [ADR-0045](adr-0045-personally-signed-source-history.md).

## Decision

Run the package-preparation workflow only from protected `main` in `ohtia/ohtia`; reject dispatches from another branch or tag. Expose an optional `hash` string containing a full lowercase commit SHA. An empty value selects the workflow dispatch's immutable main commit. A supplied SHA must identify that commit or an ancestor of it in the same repository. Resolve this once before construction and pass the exact SHA to every producer and consumer. Later movement of main cannot change the selected source.

Check the exact commit/tree and its membership in the captured main history. Use fixed-repository GitHub commit and comparison metadata, with bounded responses and deadlines; consume the base/merge-base relationship without enumerating or admitting each historical commit.[^github-compare] Do not inspect commit signatures, signer allowlists, historical baselines, associated PRs/issues, bot authorship or the contributor who performed an integration. Source selection accepts GitHub-signed merges, personal signatures and unsigned historical commits on the same terms. Missing source or unavailable membership evidence refuses that preparation without changing repository history.

Keep the workflow revision separate from the package source. Pin reusable builder and worker workflows by full commit SHA; their recipe code is checked out separately from candidate source.[^github-reuse] The independently administered signing policy still selects exact accepted builder/worker digests. Ordinary main advances and optional application hashes do not change those recipe selections. Publish a recipe revision before selecting its exact immutable SHA in the caller. A main merge does not automatically approve a different recipe or deployment. OIDC claims, job identities and attestation certificate source metadata identify the main workflow execution; the authenticated artifact predicate binds the separately selected package commit/tree and exact package digest. Do not substitute one identity for the other.

[ADR-0041](adr-0041-independent-linux-signing-service.md) continues to own private key custody, caller authentication, immutable build authority, package verification, deployment admission and durable signing receipts. Remove the obsolete source-baseline/key fields, Git history acquisition and signed-prefix cache; refuse old policy records rather than silently ignoring those fields. Record the selected source SHA in the workflow summary, build manifest, catalog and signing receipt evidence. Retain its exact tree in the workflow summary, build manifest, receipt subject and source proof. Preparation does not publish a release; [release policy](../release-policy.md) retains separate candidate and publication authorization.

## Consequences

Maintainers can prepare the current main or repeat preparation from an older integrated commit through the same interface, without changing how normal PR merges are performed. The native GitHub dispatch interface can offer other workflow refs, but those executions are refused; no input selects another source branch. [Dependency proposals](../repository-policy.md#issue-backed-dependency-adoption) still require issue-backed contributor adoption, and repository protections remain in force.

Package preparation relies on GitHub for repository membership and workflow/build provenance. It does not independently re-establish repository governance, prove code safety or guarantee trustworthy packages after a compromise of the build authority. Artifact-digest/provenance checks and the external signing boundary remain necessary and distinct. Existing source-history cache records grant no authority and are not consumed; retain operational evidence under its existing retention requirements. A changed workflow contract and signer image need their own qualification and separately approved deployment before real-key use.

[^github-compare]: Paginated comparisons expose ancestry metadata; the changed-files list appears only on the first page.

[^github-reuse]: Full commit SHA references select immutable reusable-workflow revisions independently of the caller source.
