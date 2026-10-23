---
type: Playbook
title: Repository policy
description: GitHub repository configuration, dependency updates, quality checks, and verification procedures.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
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
---

# Repository policy

GitHub repository settings are declared in `config/github/`. The policy tool uses Python 3.12 or later and the GitHub CLI (`gh`), and runs from the task worktree. It does not need a Python application workspace or third-party Python packages. Planning, application, and verification require the public `ohtia/ohtia` repository with `main` as its default branch; resolve default-branch drift before proceeding.

## Declared configuration

- `repository.json` permits merge commits, disables squash, rebase, and auto-merge, and permits updating a pull request branch. Branch deletion remains part of the post-merge workflow.
- `actions-permissions.json` permits only `actions/checkout` and `actions/setup-python`, requires full commit SHAs, and gives workflow tokens read-only access without pull request approval privileges. The action patterns apply to this public repository.[^github-actions-permissions]
- `security.json` enables dependency vulnerability alerts and automated security fixes.
- `labels.json` defines managed label names, colors, and descriptions. Unmanaged labels are preserved.
- `ruleset-main.json` protects the default branch with pull requests, verified signatures, resolved conversations, merge commits only, and the `ci` check against an up-to-date base. No actor bypasses the rules. Zero approving reviews accommodates the single-maintainer workflow; the maintainer performs the human review and merge.[^github-repository-rules]

The required check is bound to the GitHub Actions app. Its declared integration ID is checked against `GET /apps/github-actions` whenever the ruleset is planned or verified. Configuration files describe the intended policy; only successful live verification establishes conformity.

## Authentication

Authenticate `gh` as a repository administrator with a fine-grained token whose resource owner is `ohtia` and whose selected repository is `ohtia/ohtia`. For the agreed repository workflow, grant read/write access to Administration, Contents, Issues, Pull requests, and Actions, plus write access to Workflows. Metadata remains read-only and is included automatically. No organization administration permission is required. These are the personal token permissions; the CI workflow token remains read-only. Commit signing and Git transport are configured separately.

The policy tool uses `gh api` with literal repository placeholders. It does not obtain, print, or persist tokens. API calls are bounded by a timeout; read failures and missing permission-dependent fields fail verification rather than being treated as conformity.

## Plan, apply, and verify

The `base` stage manages repository settings, Actions permissions, dependency security settings, and labels. The `ruleset` stage manages only the `main` ruleset. Planning and verification never write to GitHub.

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

The `ci` workflow runs on pull requests targeting `main` and pushes to `main`, using the configured formatting and lint hooks, a committed-history secret scan, and the policy-tool unit tests. The local branch guard is skipped in CI, where GitHub enforces branch protection, and the staged-file secret scan is replaced by the history scan. Its only job is named `ci`, matching the required check. Superseded pull request runs may be cancelled; each push to `main` retains its own execution.

The workflow uses a read-only token, does not persist checkout credentials, and has no administrative credentials. It tests the policy tool with synthetic GitHub responses; it does not claim to verify live administrative settings. Maintainers run live verification separately.

```bash
pre-commit run --all-files
pre-commit run --hook-stage manual gitleaks-history --all-files
python3 -m unittest discover -s scripts/tests -v
git diff --check
```

The unit tests exercise planning, reviewed-plan confirmation, permission errors, write failures and readback, label preservation, rule conflicts, check provenance, and stage isolation. The configured Ruff hooks format and lint the Python tooling. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) to install and run the hooks.

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

[^github-repository-rules]: GitHub repository rules API.

[^dependabot-options]: Dependabot options.

[^dependabot-runners]: Dependabot on GitHub Actions runners.
