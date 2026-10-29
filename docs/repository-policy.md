---
type: Playbook
title: Repository policy
description: GitHub repository configuration, dependency updates, quality checks, and verification procedures.
sources:
  - id: github-pull-request-api
    resource: https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
    title: GitHub — Pull request mergeability
  - id: github-actions-permissions
    resource: https://docs.github.com/en/rest/actions/permissions
    title: GitHub Actions permissions API
  - id: github-repository-rules
    resource: https://docs.github.com/en/rest/repos/rules
    title: GitHub repository rules API
  - id: dependabot-options
    resource: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference
    title: Dependabot options
  - id: dependabot-runners
    resource: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-on-actions
    title: Dependabot on GitHub Actions runners
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Repository policy

GitHub repository settings are declared in `config/github/`. The policy tool uses Python 3.12 or later and the GitHub CLI (`gh`), and runs from the task worktree. It does not need a Python application workspace or third-party Python packages. Planning, application, and verification require the public `ohtia/ohtia` repository with `main` as its default branch; resolve default-branch drift before proceeding.

## Declared configuration

- `repository.json` permits merge commits, disables squash, rebase, and auto-merge, permits updating a pull request branch, enables Discussions, and disables the wiki. Branch deletion remains part of the post-merge workflow.
- `actions-permissions.json` permits only `actions/checkout`, `actions/setup-python`, `actions/upload-artifact` and `actions/download-artifact`, requires full commit SHAs, and gives workflow tokens read-only access without pull request approval privileges. The action patterns apply to this public repository.[^github-actions-permissions] It also requires `all_external_contributors` approval for fork workflows, including contributors with previously accepted changes. Approval authorizes workflow execution, not fork creation or PR integration.
- `ci-verification.json` declares the expected workflow/event, mandatory jobs/steps and explicitly optional cleanup steps used by the read-only pre-merge verifier. Review this inventory with workflow changes.
- `security.json` enables dependency vulnerability alerts and automated security fixes.
- `labels.json` defines managed label names, colors, and descriptions. Unmanaged labels are preserved.
- `ruleset-main.json` protects the default branch with pull requests, verified signatures, resolved conversations, merge commits only, and the `ci` check against an up-to-date base. No actor bypasses the rules. Zero approving reviews accommodates the single-maintainer workflow; the maintainer performs the human review and merge.[^github-repository-rules]

The required check is bound to the GitHub Actions app. Its declared integration ID is checked against `GET /apps/github-actions` whenever the ruleset is planned or verified. Configuration files describe the intended policy; only successful live verification establishes conformity.

## Authentication

Authenticate `gh` as a repository administrator with a fine-grained token whose resource owner is `ohtia` and whose selected repository is `ohtia/ohtia`. For the agreed repository workflow, grant read/write access to Administration, Contents, Issues, Pull requests, and Actions, plus write access to Workflows. Metadata remains read-only and is included automatically. No organization administration permission is required. These are the personal token permissions; the CI workflow token remains read-only. Commit signing and Git transport are configured separately.

The policy tool uses `gh api` with literal repository placeholders. It does not obtain, print, or persist tokens. API calls are bounded by a timeout; read failures and missing permission-dependent fields fail verification rather than being treated as conformity.

## Plan, apply, and verify

The `base` stage manages repository settings, Actions permissions (including fork contributor approval), dependency security settings, and labels. The `ruleset` stage manages only the `main` ruleset. Planning and verification never write to GitHub.

```bash
python3 scripts/github_policy.py plan --stage base
python3 scripts/github_policy.py apply --stage base --confirm <plan-sha256>
python3 scripts/github_policy.py verify --stage base
```

Review the printed differences before using their SHA-256 as confirmation. Apply recalculates the complete stage plan before writing and refuses a different hash. Each write is followed by a readback, and the complete stage is verified again at the end. Applying an already conforming plan performs no writes. Changes are not transactional: if a write or readback fails, earlier writes may have succeeded. Read the live state and prepare a new plan before retrying.

Apply the ruleset after the CI workflow has been published and verified. The tool refuses to apply a changed ruleset unless `.github/workflows/ci.yml` is registered and active; that precondition alone does not prove that its jobs passed.

```bash
python3 scripts/github_policy.py plan --stage ruleset
python3 scripts/github_policy.py apply --stage ruleset --confirm <plan-sha256>
python3 scripts/github_policy.py verify
```

Planning refuses to replace an inherited or ambiguous ruleset named `main`, or to proceed when another active ruleset or classic branch protection affects the default branch. Resolve such conflicts explicitly; the tool does not remove other protections.

Exit codes are `0` for conformity, `1` for declared differences, and `2` when a read, validation, write, or verification fails. A plan that proposes changes returns `1` and still prints its confirmation hash. Run `verify` without `--stage` to check both stages. Extra labels are reported by planning and do not count as drift.

## Repository checks

The `ci` workflow runs on pull requests targeting `main` and pushes to `main`, using the configured formatting and lint hooks, a committed-history secret scan, and the policy-tool unit tests. The local branch guard is skipped in CI, where GitHub enforces branch protection, and the staged-file secret scan is replaced by the history scan. The `full-suite (ubuntu-26.04-x64)` job preserves those shared checks, fourteen native jobs build the hosted quality matrix, and the stable `ci` job requires their successful complete aggregate. Every job records the tested revision before repository-controlled tooling runs. [Native quality builds](quality-builds.md) owns the selected matrix, package evidence and retention procedure. Superseded pull request runs may be cancelled; each push to `main` retains its own execution.

The workflow uses a read-only token, does not persist checkout credentials, and has no administrative credentials. It tests the policy tool with synthetic GitHub responses; it does not claim to verify live administrative settings. Maintainers run live verification separately.

```bash
pre-commit run --all-files
pre-commit run --hook-stage manual gitleaks-history --all-files
python3 -m unittest discover -s scripts/tests -v
git diff --check
```

The unit tests exercise planning, reviewed-plan confirmation, permission errors, write failures and readback, label preservation, rule conflicts, check provenance, and stage isolation. The configured Ruff hooks format and lint the Python tooling. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) to install and run the hooks.

## Pre-merge CI provenance

[ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md) defines the trust boundary. The required `ci` check remains bound to GitHub Actions; GitHub's check-name/app requirement does not establish the workflow path or event. The maintainer supplements it with the read-only `scripts/github_pr.py` verifier and human review of CI/policy changes.

Select an explicitly reviewed Git revision containing the verifier, policy tool, CI inventory and workflow. Invoke the verifier from a separate trusted checkout at that revision, with those files unchanged. It checks their exact Git bytes before importing the policy transport and checks them again afterward. This detects local drift; the maintainer must establish that the selected revision was reviewed. A candidate cannot authorize its own verifier version. For a PR introducing or changing the verifier, workflow or inventory, the maintainer may explicitly select that PR's exact signed head after independent review and human review of those bytes; run it from a separate trusted checkout. Its presence in the PR and successful CI alone do not establish that trust. An introduction or update of the verifier follows the independent worktree-review and human-review requirements before choosing its revision for a real merge decision.

Supply the PR number, selected run ID, reviewed head/base SHAs, candidate tree SHA and trusted verifier revision explicitly. For example, from the trusted checkout with the review variables already set:

```bash
python3 -I scripts/github_pr.py 123 \
  --run-id 456 \
  --head "$OHTIA_REVIEWED_HEAD" \
  --base "$OHTIA_REVIEWED_BASE" \
  --tree "$OHTIA_REVIEWED_TREE" \
  --verifier-revision "$OHTIA_VERIFIER_REVISION"
```

The command performs GitHub reads only. Exit `0` emits a JSON evidence report; exit `2` means verification failed or required evidence is unavailable. Save the report in the task's ignored review directory. It never approves workflows, changes repository settings or merges a PR.

The verifier checks the open PR's current head/base, an up-to-date candidate tree, the synthetic merge's parents/tree, exact reviewed workflow bytes, registered workflow ID/path, `pull_request` event, repository identities, latest run/attempt, originating GitHub Actions app and complete mandatory job/step results. It does not rely on the run `pull_requests` array because the trusted workflow's checkout receipt separately binds the actual PR merge ref and its head/base. Candidate-authored arbitrary success messages are not evidence.

CI records `OHTIA_CI_PROVENANCE` before installing/running repository-controlled tooling. The record contains the actual checked-out commit/tree and GitHub-provided run/attempt/event/ref identities. The verifier reads bounded job logs and requires exactly one valid matching receipt per job, together with exact workflow bytes and successful required steps; the receipt alone cannot establish trust. Missing logs, extra jobs, undeclared steps, skipped mandatory work or a missing/mismatched receipt fail verification. Explicit optional cleanup steps may be absent/skipped; their executed failures still fail verification.

GitHub can return `mergeable: null` while computing a synthetic merge; the verifier reports that evidence as pending, and the maintainer retries the complete verification after GitHub finishes.[^github-pull-request-api] It never interprets unknown mergeability as success. Logs that are not valid UTF-8 remain unavailable evidence rather than being decoded by guesswork. The verifier requires a GitHub CLI supporting `api --allow-escape-sequences`: it captures raw log bytes in the bounded pipe for receipt parsing and never prints their escape sequences to a terminal.

The verifier uses POSIX process/pipe controls, an eight-MiB log-read bound and a 60-second download deadline on the development host. GitHub API calls retain the policy transport's timeout. No candidate script, artifact or log content is executed. The report records both the PR head and the synthetic merge SHA actually tested, which are different identities. It rereads candidate/run state before reporting success; the maintainer rechecks immediately before merging, because a previous report cannot authorize a later head/base.

Workflow and inventory changes are reviewed together. The selected trusted verifier revision must contain the exact workflow and inventory approved for the candidate; a mismatch fails rather than silently adopting the PR's version. Provenance reports remain supporting review evidence, not an additional GitHub-enforced merge rule.

## Dependency updates

[Dependabot configuration](../.github/dependabot.yml) checks GitHub Actions and pre-commit every Monday at 06:00 UTC, with a seven-day cooldown for version updates and at most five open update pull requests per ecosystem. Action patch updates are grouped. Automatic rebasing is disabled; review updates against the current base using the repository merge workflow.

GitHub-managed Dependabot update jobs bypass repository and organization Actions policy checks.[^dependabot-runners] Verify the actual update runs after publication; the ordinary `ci` workflow on their pull requests uses the repository's configured actions.

Cooldown does not delay security updates.[^dependabot-options] Routine dependency updates use `dependencies`, `enhancement`, and `comp:tooling`; add `security` only for work specifically addressing security, as defined in [AGENTS.md](../AGENTS.md#issue-labels). Dependabot does not open security updates for pre-commit hooks; their version updates still receive review and CI.

Review the entire update, retain full SHA references for Actions, and run the repository checks. Python and pre-commit versions installed directly in the workflow are explicit pins and are maintained in an issue-backed pull request; the two configured ecosystems do not maintain those pins automatically. When application manifests are introduced, add their ecosystem and keep duplicate tool pins consistent in the same pull request.

## Integration and closure

1. Run the repository checks on the candidate, including new files. Before committing or pushing, respect the owner's review checkpoint and the code review requirements in [AGENTS.md](../AGENTS.md).
2. Apply and verify the reviewed `base` configuration with an authorized administrator token.
3. Publish the reviewed scaffolding through a pull request and verify its `ci` run. Inspect its workflow path, event, originating GitHub Actions app, tested SHA, job results, and correspondence to the current candidate. A check name alone is insufficient.
4. After human integration, verify the run for the actual merge commit on `main`. Plan, apply, and verify the final ruleset after the workflow is registered and active.
5. Inspect the effective rules using `gh api 'repos/{owner}/{repo}/rules/branches/main'` and confirm the required `ci` check, its integration ID, and strict base policy.
6. Check Dependabot update runs for both configured ecosystems and verify that they completed successfully. Dependency update runs can be listed with `gh api 'repos/{owner}/{repo}/actions/runs?event=dynamic'`; inspect the ecosystem in the logs rather than inferring it from a title.
7. In a new clean clone, run `git switch --detach <integrated-sha>` to select the exact integrated commit, install the hooks, and run the repository checks above. Detached HEAD permits verification of the integrated content without triggering the local guard against commits on `main`. Record the commit, tool versions, results, and clean `git status --short` in the issue or pull request.
8. Close the scaffolding issue only after integration and all acceptance criteria are verified. Keep failed or unavailable checks explicit and leave the issue open while obligations remain.

[^github-actions-permissions]: GitHub Actions permissions API.

[^github-pull-request-api]: GitHub documents unknown mergeability while a background computation runs and recommends requesting the result again afterward.

[^github-repository-rules]: GitHub repository rules API.

[^dependabot-options]: Dependabot options.

[^dependabot-runners]: Dependabot on GitHub Actions runners.
