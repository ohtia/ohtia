---
type: DecisionRecord
title: "ADR-0020 — Declared GitHub policy and restricted CI authority"
description: "Verify CI provenance before merge, require approval for external fork workflows and separate PR execution from publication authority."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: github
    resource: "https://docs.github.com/en/actions/reference/security/secure-use"
    title: "GitHub — Secure use reference"
  - id: check-provenance
    resource: "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules"
    title: "GitHub — Troubleshooting rules"
  - id: fork-approval
    resource: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository"
    title: "GitHub — Managing GitHub Actions settings for a repository"
  - id: permissions-api
    resource: "https://docs.github.com/en/rest/actions/permissions#get-fork-pr-contributor-approval-permissions-for-a-repository"
    title: "GitHub — Fork PR contributor approval permissions API"
  - id: organization-rulesets
    resource: "https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization"
    title: "GitHub — Creating rulesets for repositories in your organization"
---

# ADR-0020 — Declared GitHub policy and restricted CI authority

## Context

A workflow file alone does not prove live branch protection or correct check provenance. Untrusted PR code must not receive credentials that sign/publish artifacts or change the policy that admits it. Repeated manual settings are difficult to compare with reviewed intent.

## Decision

Keep repository/Actions/label/ruleset configuration versioned and use plan/apply/readback verification for authorized administrative changes. [Repository policy](../repository-policy.md) is canonical for exact settings and commands; [AGENTS.md](../../AGENTS.md) owns issue, review, signature and PR conventions. Do not duplicate those operational definitions here.

Use GitHub Actions for common quality entries with a read-only default token, full-SHA action pins, nonpersisted checkout credentials and isolated synthetic checks. GitHub recommends minimizing token authority and treating untrusted checkout carefully.[^github] Identify required results by their actual workflow, event and tested SHA, not a green display name alone.

### CI provenance before merge

Keep the repository-level required check bound to the GitHub Actions app and the strict base policy defined in [Repository policy](../repository-policy.md). Required status checks identify a check name and permitted source; they do not by themselves constrain its workflow path or triggering event.[^check-provenance] The additional provenance verification below is a required maintainer procedure, not a claim that the ruleset enforces those additional conditions. Retain GitHub Free as the repository baseline; organization rulesets are a Team/Enterprise facility and are not a prerequisite for this approach.[^organization-rulesets]

Automate the pre-merge verification as a read-only tool run from an identified, reviewed revision in a trusted checkout, independently of the proposed worktree. The candidate cannot select or replace that verifier or its accepted policy. Changes to the verifier and workflow/test inventory require explicit review; executing their unreviewed candidate versions cannot certify that same change. Published run artifacts and logs are untrusted data to inspect, never executable verification helpers.

For the open PR, verify all of the following against GitHub's actual records:

- Resolve the repository, PR number, current head SHA and base SHA afresh; identify the reviewed candidate and verifier/policy revision.
- Identify the registered workflow by its ID and `.github/workflows/ci.yml` path, the `pull_request` event, its association with this PR and source head, and the expected GitHub Actions app. Another job named `ci`, an unrelated run or a successful `push` run on an older `main` does not satisfy the procedure.
- Establish the SHA/tree actually checked out and tested, including the synthetic PR merge commit when that is the checkout target. Record its relationship to the current head/base. A run's `head_sha` alone is not evidence of its checkout target. Cross-check checkout evidence and reviewed workflow configuration; do not accept a candidate-authored success message or receipt as sufficient proof.
- Require completion and success of the intended run attempt and every mandatory job/step/partition from the reviewed workflow and check inventory. Skipped, cancelled, failed, missing, incomplete or unreadable mandatory evidence prevents a passing verdict, even if a display name is green. Conditional nonmandatory steps must be distinguished by that reviewed inventory.
- Record the run ID/attempt, tested SHA, head/base, workflow/app identity, required results and limitations in the task's ignored review evidence. Recheck head/base immediately before the human merge; any change invalidates the earlier verdict and requires verification of the updated candidate.

The verifier reports a bounded failure or unavailable result when evidence cannot be established; it neither merges, approves workflows nor grants publication authority. The maintainer reviews workflow, policy and verification-tool changes together with the candidate before merging. Automated provenance checks supplement that review and cannot make an altered PR workflow trustworthy solely because GitHub executed it.

### Approval of external fork workflows

Require `approval_policy: all_external_contributors` for workflows submitted to this repository from public forks. Prior accepted contributions do not remove that approval requirement for an external contributor. GitHub defines this category through repository/organization membership and checks the relevant PR author and triggering actor.[^fork-approval]

This approval governs running workflows on Ohtia's Actions infrastructure. Creating a fork, editing it, running workflows in the contributor's own fork and opening a PR remain available without the maintainer's approval. Approving a workflow run grants execution only; it does not approve the contribution, merge it or authorize signing/publication. Before authorizing execution, the maintainer inspects the proposed code and workflow changes.

Declare the approval policy alongside the versioned Actions configuration and include it in the same plan/hash-confirmation/apply/readback cycle. Read and verify `repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval`; the authorized write uses the corresponding endpoint with the declared value.[^permissions-api] A weaker or unreadable live policy fails verification rather than being treated as conformity. Updating only the ADR is not evidence that the setting is enforced.

Fork approval is an execution-admission control. It does not replace the read-only PR token, separation of secrets, isolated test infrastructure or review of code that will run. Trusted-context workflows cannot use approval as permission to execute PR-controlled code with publication or administrative credentials.

### Publication and policy maintenance

Keep artifact signing, notarization, publication and administrative tokens outside untrusted PR execution. Release authorization uses reviewed trusted configuration and approved artifacts. Proposed code, issue text or an agent result cannot rewrite its own admission evidence or enable publication. No retired cloud-agent controller is introduced.

Maintain Dependabot and other pinned tools through reviewed changes and the actual configured allowlist. Adding setup/build actions or release permissions requires a declared policy change with readback, not a silent workflow exception.

## Consequences

Policy drift and workflow authority become reviewable, with maintenance and live-verification obligations. Test synthetic planning/failure/readback, external-contributor approval drift and the pre-merge verifier, plus separately authorized live policy and real workflow provenance. Verification cases include a same-name check from a different workflow, wrong event/app, stale head/base, a mismatched checkout SHA, incomplete required jobs, unreadable evidence and attempted replacement of the trusted verifier. External workflow approvals add a manual execution checkpoint for maintainers. Formatter tests are not administrative verification; a signed artifact is not permission to publish it. Keep diagnostic/review scratch private to the task and publication bodies self-contained.

[^github]: GitHub documents least-privilege tokens, untrusted checkout and action pinning; exact Ohtia settings remain in repository policy.

[^check-provenance]: GitHub documents that required status checks do not identify the workflow or event; Ohtia's pre-merge procedure checks those separately.

[^fork-approval]: GitHub defines approval for all external contributors and explains why a previously accepted contribution bypasses first-time-only policies.

[^permissions-api]: GitHub exposes repository fork-contributor approval through a dedicated read/write Actions permissions endpoint.

[^organization-rulesets]: GitHub documents organization rulesets as a Team/Enterprise feature; Ohtia's selected verification procedure uses the GitHub Free repository baseline.
