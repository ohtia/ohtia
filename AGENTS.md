# AGENTS.md

Working instructions for coding agents contributing to Ohtia. Keep shared instructions here; `CLAUDE.md` imports this file for Claude Code. Read [README.md](README.md) for the product direction and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements.

## Accuracy and scope

- Deliver the full agreed scope, verify your claims, and correct identified defects. Disclose uncertainty, blockers, and verification limits instead of presenting them as resolved.
- Inspect the repository and the actual configuration before attributing behavior to code, tools, or GitHub settings. Documentation describes intent; it does not prove implementation or enforcement.
- Resolve conflicts between the user's request, the issue, and the product or architecture requirements before implementing a decision. Keep open questions explicit.
- Build product code from scratch. Use earlier work as learning material; bring over code, files, or configuration only when the user explicitly authorizes it.
- Preserve researcher authorship, the distinction between evidence and inference, provenance, coverage, and human confirmation when implementing product behavior.

## Product and architecture

Before implementing product behavior, read the [product definition](docs/product-definition.md) and the applicable [thesis workflow](docs/thesis-workflow.md), [system architecture](docs/architecture.md), [frontend architecture](docs/frontend-architecture.md), [design system](docs/design-system.md), [workspace layout](docs/workspace-layout.md), [Exploration–Action Framework](docs/exploration-action-framework.md), [data model](docs/data-model.md) and [draft format](docs/draft-format.md). Cite product principles by `PRIN-NNN`. Significant choices follow [Architecture decisions](docs/architecture-decisions.md) and the [ADR register](docs/adr/index.md). Follow the guide's [technology-version ownership rules](docs/architecture-decisions.md#technology-versions-and-ownership): the adopting ADR owns the version line; referring documents link to it. Resolve contradictions and component-enabling conditions before implementing them; documented requirements do not establish implemented desktop capabilities.

## Language and documentation

- Write documentation, technical comments, docstrings, developer diagnostics, commit messages, and GitHub issues, pull requests, and comments in English.
- Keep identifiers in English. Preserve quotations and translated interface text in their original or target language, with English explanations.
- Documents describe their subject directly. Do not add status sections, status metadata, inventories of missing features, session transcripts, or alternative histories. Git preserves their evolution.
- Add documentation when there is useful content or an actual procedure to describe. Keep each decision in one canonical location and link to it rather than duplicating it.
- Keep substantial product and architecture documentation under `docs/`. Root-level repository guidance such as README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, AGENTS, and CLAUDE remains at the root.
- Use relative links between repository files and verify their targets. Refer only to files, commands, and tools that exist.
- Keep repository content and published issue/PR descriptions self-contained. Reference this repository and primary external sources; do not link or refer to other Ohtia repositories.
- Do not invent sources, quotations, authors, dates, approvals, or verification results. Check current authoritative sources when external facts can change.
- Write one source line per Markdown paragraph and let the editor wrap it visually. Prettier uses `proseWrap: "preserve"`, which keeps existing paragraph line breaks rather than creating or removing them. Write each paragraph on one source line before formatting. This setting permits aligned source tables; it does not enforce paragraph line count, which remains an authoring and review requirement.
- Use real Markdown headings, dash bullets, fenced code blocks with a language, and blank lines around headings and lists. Bold text is emphasis, not a substitute for a heading.
- Keep Markdown tables readable, with vertically aligned columns enforced by Markdownlint MD060 (`style: "aligned"`), and at most 140 characters wide per complete formatted row. If a table does not fit, use clearly separated items and fields without losing information.

## Documentation and Open Knowledge Format

Repository documentation under `docs/` forms one Open Knowledge Format (OKF) v0.2 bundle, following the [specification pinned to commit 62432a0](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/62432a095456147ee71e70ac6e4dc0d2dea3ac30/okf/SPEC.md). These repository conventions define its profile.

- Use [docs/index.md](docs/index.md) as the bundle entry point. Its frontmatter contains only `okf_version: "0.2"`. Other `index.md` files have no frontmatter.
- Every Markdown concept under `docs/` has YAML frontmatter with nonempty `type`, `title`, and `description`. OKF requires `type`; this repository also requires the title and a one-sentence description. The body has one level-one heading matching `title`.
- Use `Specification` for product and architecture definitions, `Playbook` for workflows and operating procedures, `Reference` for reference material, and `Analysis` for evidence-based evaluations. Define additional document types here before using them. Use `DecisionRecord` for a significant architecture choice with context, alternatives, decision and consequences, following [Architecture decisions](docs/architecture-decisions.md). Keep the ADR register under `docs/adr/` within the same bundle; numbering starts at `ADR-0000`, and ADRs follow this repository's provenance and no-status-metadata conventions.
- Use `EPIC` for a coordinated delivery specification and `Story` for an implementable unit linked as a native GitHub sub-issue of its EPIC. Keep each full specification once in its EPIC concept; story concepts declare and link their applicable blocks.
- EPIC and Story concepts carry `status: stable` as a document lifecycle marker. Execution state and progress remain in GitHub; omit `epic_status`, `started_on`, and `completed_on` from concepts and do not group indexes by execution state. The existing single-verifier and no-timestamp provenance rules apply.
- Each directory containing concepts has an `index.md`. Its entries list that directory's concepts and subdirectory indexes exactly once, using the concept titles and descriptions. Keep deeper entries in their own directory's index.
- Use relative links within the repository and verify their targets and heading fragments. Keep the bundle self-contained and preserve existing paths when extending it.
- Optional `sources` entries identify concrete supporting resources, each with a `resource` URL or path. Give cited sources unique, stable `id` values and use matching Markdown footnote labels for individual claims. Keep source details in frontmatter rather than a duplicate body references list, and omit `sources` when there are none to declare. Review declarations describe the review actually performed; keep Git and pull requests as the evidence of repository review and history.
- Apply the documentation rules above: paragraphs stay on one source line, and document status metadata, parallel histories, and `log.md` files are excluded from this repository profile.
- Root-level README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, AGENTS, and CLAUDE files remain repository guidance outside the bundle. Ignored `tmp/` holds disposable work and review evidence; neither belongs in the documentation index or receives concept frontmatter.

When adding or changing a document, update its directory index, review its frontmatter and links, and run the configured repository hooks. Product storage and export formats are defined in the product and architecture documents.

### Generation and human verification

Use OKF's native `generated` and `verified` fields to distinguish the producer of the current content from the person who has confirmed it. These declarations describe provenance and content review; the signed Git commit provides the cryptographic signature.

- Record `generated.by` as `<agent>/<effective-model-id>` for model-assisted content, or `human:<github-login>` for human-authored content. Use the runtime's confirmed model identifier, including its version when exposed; a configured default, alias such as `latest`, or another reviewer's model is not evidence of the producer. If the identity cannot be established, omit the unsupported declaration and report the gap.
- Keep one current `generated.by` declaration; Git preserves earlier producers and revisions.
- Record human sign-off as one `verified` mapping with `by: human:<github-login>`. Use the single-verifier form rather than a list. Add the declaration only after that person explicitly confirms the document's current content against its supporting material. Approval must identify the document or reviewed change; never infer it from ownership, copyright, assignment, a commit signature, or merge alone.
- Keep automated checks and model reviews in the task's ignored review evidence with their actual actor identities. They do not populate or authorize the human `verified` declaration.
- A meaningful content change requires fresh verification: remove the current `verified` declaration unless the human review was repeated. Formatting that preserves meaning does not by itself change the producer or invalidate content verification.
- This repository profile records producer and verifier identities without `generated.at` or `verified.at`. OKF describes dated verification events; this local convention keeps chronology in Git and review evidence in pull requests. Root guidance and indexes keep their existing frontmatter exemptions.

## Issues and GitHub operations

Follow the issue-first requirements in [CONTRIBUTING.md](CONTRIBUTING.md). Every code change, including tests, dependencies, scripts, and execution, build, CI, or tooling configuration, requires a GitHub issue before implementation. Every change proposed for integration must be associated with an issue.

- Read the complete issue, comments, acceptance criteria, dependencies, and applicable specifications before implementation.
- Search open and closed issues before creating a new one. Reuse existing work when resuming a partially completed task.
- Describe the problem, scope, exclusions, expected outcome, acceptance criteria, dependencies, and validation in an issue. Bug reports include reproduction and expected versus observed behavior.
- Confirm that publishing issues, comments, pull requests, or remote state changes is within the user's authorization. Prepare a complete, reviewable draft before requesting any missing permission. Do not ask again for authorization already granted within the same scope.
- Use `gh api` from the correct worktree for GitHub REST operations, with literal `{owner}` and `{repo}` placeholders in repository endpoints. Pass Markdown bodies from files with `-F body=@<path>` and structured payloads with `--input <file.json>`.
- After a remote write, reread the resource and verify its content, labels, and relationships. Use existing labels appropriate to the change; verify the live catalog before applying them.
- Use absolute repository URLs in GitHub issue and pull request bodies. Published content must not depend on local scratch files.
- Link every pull request to its issue. Use `Closes #123` only when that pull request fully resolves the issue.

### Issue labels

The canonical catalog is [config/github/labels.json](config/github/labels.json). It defines label names, colors, and English descriptions. Change the catalog when changing the managed label definitions.

- **Type:** `epic`, `story`, `bug`, `enhancement`, and `documentation`.
- **Management:** `dependencies`, `security`, and `translation`.
- **Component:** `comp:docs`, `comp:tooling`, `comp:desktop`, `comp:app`, `comp:storage`, `comp:llm`, and `comp:search`. The catalog description defines each component's boundary.
- **Community and triage:** `duplicate`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`, and `accessibility`.

Each issue must carry exactly one type label and at least one component label. Management, community, and triage labels complement that classification.

Apply `security` only when the issue specifically concerns security, such as a vulnerability, an upgrade required to remediate a vulnerability, a change to security controls, or a refactor whose purpose is to improve security. Routine upgrades, general refactoring, and ordinary CI or tooling work do not qualify solely because they could affect security.

Before applying labels, read the live repository catalog and compare it with the versioned definitions. Within the user's authorized scope, create missing managed labels or update their colors and descriptions through `gh api`, then reread and verify them. Preserve labels outside the catalog and do not remove unrelated issue labels. Do not create ad hoc labels or assume the remote configuration matches the file.

## Branches and worktrees

Each unit of work has its own issue, branch, worktree, and pull request. Group multiple issues only when they resolve the same decision.

1. Inspect `git status --short`, `git worktree list`, and existing branches before writing. Resume the existing task worktree when one exists.
2. Preserve unrelated changes. Do not stash, reset, clean, overwrite, or switch branches over someone else's work.
3. For a new task, fetch `origin/main` and create a worktree from it without switching the main checkout. Place task worktrees in a persistent sibling `ohtia-worktrees` directory, outside the repository. Reserve operating-system temporary directories and repository `tmp/` directories for disposable scratch data rather than pending work.
4. Use `chore/issue-<number>` and `issue-<number>` for an independent issue. Use `chore/prepare-<slug>` and `prepare-<slug>` for local investigation or documentation proposals before an issue exists; associate the work with an issue and rename the branch and worktree before committing or publishing.
5. Run edits, dependency installation, checks, and GitHub operations from the task worktree. Keep task environments and secrets isolated. Worktrees share Git references and are not protection against destructive branch operations.
6. Keep a worktree while work or review is pending. Follow the [post-merge workflow](#post-merge-workflow) for authorized closure and cleanup.

## Change and verify

Use the simplest implementation that satisfies the complete scope. Agree on externally visible interfaces, adapter contracts, formats, authorization, retries, concurrency, and error behavior before implementing their producers and consumers.

The repository quality tools are configured in [.pre-commit-config.yaml](.pre-commit-config.yaml):

```bash
pre-commit install
pre-commit run --all-files
pre-commit run --hook-stage manual gitleaks-history --all-files
python3 -m unittest discover -s scripts/tests -v
git diff --check
```

- Use `pre-commit run --files <paths>` to include new, untracked files in a focused check. `--all-files` selects files known to Git.
- Review formatter changes and repeat the affected checks until they pass. Check new files as well as the tracked diff.
- Preserve normative examples in custom Markdown dialects against embedded formatting with `<!-- prettier-ignore -->`. After hooks run, compare every example with its source contract, including line boundaries inside fenced code blocks.
- Run tests appropriate to the changed behavior. Add tests that verify a meaningful contract or prevent a regression; prose-only edits do not need artificial tests.
- Report skipped, failed, or unexecuted checks accurately. Local checks, hosted CI, and integration into the default branch are separate evidence.
- Keep [.editorconfig](.editorconfig), [.gitattributes](.gitattributes), [.prettierrc.json](.prettierrc.json), and the editor configuration consistent. Preserve LF text conventions and the explicit CRLF exception for Windows batch files.
- The stable required check is `ci`, produced by `.github/workflows/ci.yml`. Follow [Repository policy](docs/repository-policy.md) for declared GitHub settings, authorized application, live verification, dependency updates, and clean-clone validation. The workflow uses synthetic policy tests; it does not verify live administrative settings.
- Keep tool versions pinned and GitHub Actions pinned by full commit SHA. Validate workflow changes with the configured Zizmor hook and a workflow syntax validator.
- The local Gitleaks hook scans staged changes; the manual history hook scans committed history, including merge changes. Use the appropriate mode for the evidence being checked.
- Keep secrets, credentials, `.env` files, and private research materials out of Git and operational logs. Use synthetic or permitted public data for tests and external evaluations.

## Code review before committing

The order is validation, independent read-only review of the task worktree, correction and verification, signed commit, content identity check, push, and pull request. Do not create commits as review checkpoints or one commit per correction round.

Every code change must complete this review before its task commit and before publication, including updates to an existing pull request. This includes production code, tests, scripts, migrations, and configuration affecting execution, builds, CI, or security. Changes consisting entirely of prose keep their documentation checks and do not require this code-review gate.

The implementing agent acts as the orchestrator and invokes two independent reviewers:

- One Claude Code session using Claude Opus 5.5 (`claude-opus-5-5`) with `effort: medium`.
- One Codex session using `gpt-6.1-sol` with `model_reasoning_effort: medium`.

Set the exact model and effort explicitly and verify each session's effective configuration. Run sessions in parallel where supported or in batches to respect concurrency limits. If a required tool, model, or complete review is unavailable, report the blocker and do not commit or push the affected code; changing the reviewer count or substituting a model requires the user's authorization.

### Prepare the review

After validation, fetch the current base, account for any advance, and integrate it when necessary without discarding pending work. Repeat affected checks before freezing the candidate. Review the task branch and its actual worktree, including staged changes, unstaged changes, new files, and deletions. The worktree need not be clean and the candidate need not be committed.

Record the immutable base SHA, existing branch HEAD SHA, and candidate Git tree SHA. Use a temporary Git index to identify the complete proposed tree without modifying the real index or creating a commit. Record the full diff against the base and a manifest of the reviewed files and their content hashes. Exclude ignored credentials, private materials, and scratch data from the candidate.

Both reviewers inspect the same complete candidate against that base, read-only in the task worktree. Keep the worktree content fixed during each round and verify its hashes afterward. A frozen patch and manifest identify the candidate; they do not replace access to the worktree and repository context.

Give each reviewer the issue scope, acceptance criteria, applicable contracts and decisions, candidate identifiers, and validation results with their limitations. Start each reviewer in a fresh session without the implementation conversation or the other reviewer's initial findings. Reviewers do not edit files, create commits, push, or delegate further reviews. Tool permissions must restrict writes; do not disable permission controls.

Both reviewers independently inspect correctness, regressions, contracts, behavior and edge cases, security, concurrency, error paths, and test coverage. Findings identify severity, file and lines, triggering conditions, impact, and verifiable evidence. Distinguish defects, questions, and suggestions.

### Resolve findings

The orchestrator deduplicates and verifies findings against the code and requirements, using reproductions or tests when appropriate. It has final responsibility for accepting or rejecting findings and resolving disagreements with a concrete justification; decisions are not made by majority vote or model identity. This authority remains within the agreed product and architecture scope.

Optional improvements and preferences do not block closure. A possible defect needs a concrete trigger, impact, and evidence. Resolve questions about possible defects with evidence; repetition does not turn a suggestion into a defect.

The first round covers the complete diff. If no corrections are required and all closure conditions hold, a second round is unnecessary. Apply corrections in the worktree without committing them, rerun affected checks, and give both reviewers the same updated candidate tree and manifest. Follow-up rounds focus on the corrections and possible regressions; repeat the complete review when the design or scope changes.

Before a third review-and-correction round, diagnose the remaining defects, the reason earlier rounds did not converge, and the justified next action. Keep that analysis in local review evidence. This is not a round limit and does not permit publishing unresolved defects.

Close the review when all accepted defects have been corrected and verified and no questions about possible defects remain unresolved. Explain rejected findings. Report that no identified defects remain pending, with the review's coverage and limits; do not claim the absence of defects.

Keep reports and finding resolutions under the task worktree's ignored `tmp/code-review/<candidate-tree-sha>/` directory, using the full Git tree SHA. Store independent reports as `codex.md` and `claude.md`, and finding resolutions as `resolution.md`. Retain earlier candidate evidence. Record the base, existing branch HEAD and candidate tree SHAs, file manifest, reviewer sessions, effective models and efforts, coverage, limitations, decisions, and verification. The pull request summarizes the result without tool attribution or links to local scratch files.

### Commit and verify content identity

Once review is closed and committing is authorized, stage only the reviewed changes, run the commit hooks, and create the signed commit or commits for the logical change. Compare the resulting `HEAD^{tree}` with the reviewed candidate tree and confirm that no task changes remain outside the commit. Record the resulting commit SHAs and signature verification in the existing review evidence.

Creating a commit with identical content does not trigger another model review merely because HEAD changed. If hooks or later edits change the content, review the affected changes before committing them. Never publish an unreviewed content change. Keep corrections to an unpublished logical change together rather than generating review-checkpoint commits; do not rewrite published history or force-push.

Before pushing, confirm a clean worktree, the reviewed tree's equality to the committed tree, and the current base. Tests, hosted CI, and human pull request review remain separate requirements.

### Integrate an updated base

Before the first round, review the complete candidate against the updated base. After a round, do not rereview base commits already reviewed in their own pull requests. Compare the task's paths from the recorded review base to its candidate tree with the incoming base paths. Include uncommitted task changes when identifying shared files.

- If integration has conflicts or shared changed files, resolve them in the worktree and have both reviewers inspect the resolutions and combined changes before creating the task or merge commit. Provide the old and new base SHAs, candidate trees, shared files, and relevant diffs; include `git show --remerge-diff` when an existing merge commit is relevant.
- If integration has neither conflicts nor shared changed files and introduces no new task edits, no new model round is required. Verify the integration, record the new base and resulting tree, and carry forward the evidence for unchanged task content.

Repeat affected checks, commit only after the applicable review is closed, and verify content identity afterward. This exception covers incoming base changes only; additional task changes still require their applicable pre-commit review.

## Commits, pull requests, and integration

- Respect the user's review checkpoints. Local preparation does not authorize commits, pushes, or publication. Continue within authorization already granted.
- Never commit directly to `main`. Follow [Commit messages](CONTRIBUTING.md#commit-messages) for Conventional Commits types, optional scopes, English summaries, issue references, and breaking changes.
- Sign every commit. Before a pull request is ready for integration, verify that GitHub shows its commits as verified.
- Do not add agent or copilot attribution to commits, issues, pull requests, or comments. This includes coauthor trailers, generated-by footers, and tool signatures.
- Integrate through pull requests and merge commits. Do not rebase a published branch or force-push it. Leave pull requests open for human review; do not merge or enable auto-merge.
- Before an authorized push, inspect the complete diff, integrate any updated base through merge, complete the applicable review and checks, and push the explicitly named task branch with its upstream.
- Before human integration, verify the live branch protections, required checks, their workflow and commit provenance, resolved conversations, verified signatures, and synchronization with the current base. Do not infer remote enforcement from this document or from workflow names.
- A green check name alone is insufficient evidence. Verify the originating workflow, run, and SHAs for the current pull request.

## Post-merge workflow

Perform closure and cleanup only within the user's authorization. Recheck GitHub even when the merge happened in an earlier session; a closed issue or a missing branch does not prove that the pull request was merged.

1. Read the pull request and verify its actual merge, the merged candidate, and the recorded checks. Confirm that the delivered changes correspond to the reviewed work.
2. Review the full bodies and comments of the associated issues, including acceptance criteria, dependencies, quality requirements, and obligations without checkboxes. Check all operational checkboxes, including nested or previously checked items, against evidence. Mark only requirements actually satisfied. A closed producer issue or an existing checkmark is not proof of delivery.
3. Close an issue only when all its requirements are met. Explain unresolved requirements and keep the issue open; reopen a prematurely closed issue when authorized. For stories, verify the native parent relationship and the epic's remaining obligations. Close an epic only after verifying all its stories and its own acceptance criteria.
4. Inspect the task worktree for uncommitted changes, untracked or ignored local files that must be retained, and work added after the reviewed candidate. Preserve anything still needed and report it. Do not force cleanup to obtain a clean worktree.
5. From outside the task worktree, remove it with `git worktree remove <path>` only after the retention checks pass. Delete the merged local task branch with `git branch -d <branch>`. If deletion is refused, investigate remaining commits and merge history rather than automatically using `-D`. Remove the remote task branch only when authorized, it still exists, and no other work uses it.
6. Refresh references with `git fetch --prune origin`. Update the main checkout with `git pull --ff-only` only when it is already on `main` and clean. Do not switch branches, discard changes, or reset the checkout to make synchronization succeed.
7. Report the issue and pull request, completed verification, any retained worktree and branch, and any remaining follow-up. Distinguish confirmed GitHub integration from local validation.
