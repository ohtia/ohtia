# Contributing to Ohtia

Thank you for helping improve Ohtia. Bug reports, documentation improvements, and code contributions are welcome. We especially welcome help creating interface translations and reviewing their linguistic quality.

## Work from an issue

Every code change must be associated with a GitHub issue before implementation begins. This includes bug fixes, enhancements, refactoring, tests, dependency updates, and changes to build, CI, or tooling configuration.

Search existing issues first. If no suitable issue exists, create one describing the purpose, scope, and expected outcome of the change.

## Translation and linguistic review

Help make Ohtia clear and natural across languages. Translation feedback and linguistic reviews are welcome without writing code.

- Open or join an issue to agree on the target locale and scope.
- Preserve meaning and research terminology, message identifiers, placeholders, and formatting syntax. Provide plural forms appropriate to the target locale.
- Review text in context, including labels, error messages, help text, and accessibility text. Consider clarity, regional usage, and available screen space.
- Disclose any use of machine-assisted translation and describe any human review. Automated checks should be complemented by someone fluent in the target language reviewing meaning, terminology, and naturalness.

When reporting a wording problem, include the locale, where the text appears, the current wording, your proposed correction, and the reason. Write explanations in English; quotations and translations retain the language being discussed.

## Prepare repository changes

- Create a branch and task worktree for the associated issue before changing files, following [Branches and worktrees](AGENTS.md#branches-and-worktrees).
- Use English for documentation, code comments, issues, pull requests, and commit messages.
- Keep each pull request focused on one change.
- Write each Markdown paragraph on a single source line; let your editor wrap it visually.
- Follow the [documentation and OKF conventions](AGENTS.md#documentation-and-open-knowledge-format) for files under `docs/`.
- Install [pre-commit](https://pre-commit.com/#install) and run the repository hooks before submitting:

```bash
pre-commit install
pre-commit run --all-files
```

New files must be added to Git before `--all-files` includes them.

EditorConfig defines shared text conventions across editors. VS Code's recommended extensions include EditorConfig support.

To scan the committed history for secrets, including changes introduced by merges, run:

```bash
pre-commit run --hook-stage manual gitleaks-history --all-files
```

GitHub Actions runs the repository formatting and lint hooks, this history scan, and the repository policy tests in the `ci` check for pull requests to `main` and pushes to `main`. The branch guard runs locally; CI replaces the staged-file secret scan with the committed-history scan. To run the policy tests locally with Python 3.12 or later:

```bash
python3 -m unittest discover -s scripts/tests -v
```

Repository administration, dependency updates, live verification, and the clean-clone procedure are documented in [Repository policy](docs/repository-policy.md).

## Commit messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for change commits you author:

```text
<type>[optional scope][!]: <summary> (#<issue>)
```

Ohtia uses these lowercase types:

| Type       | Purpose                                      |
| ---------- | -------------------------------------------- |
| `feat`     | Add a capability.                            |
| `fix`      | Correct a bug.                               |
| `docs`     | Change documentation only.                   |
| `refactor` | Restructure code without changing behavior.  |
| `perf`     | Improve runtime performance or efficiency.   |
| `test`     | Add or update tests.                         |
| `build`    | Change the build or packaging system.        |
| `ci`       | Change continuous integration workflows.     |
| `style`    | Change formatting without changing behavior. |
| `chore`    | Maintain repository tools or dependencies.   |
| `revert`   | Undo an earlier change.                      |

The scope is optional and names the affected component, such as `tooling`, `desktop`, or `search`. Write the summary in concise imperative English, omit a final period, and include the associated issue in the subject. Add a body when it helps explain the motivation or consequences.

Choose the type from the main purpose of the change. Keep required tests and documentation with their implementation; split unrelated work into separate commits.

For an incompatible contract change, add `!` before the colon and a `BREAKING CHANGE:` footer explaining the impact and any required migration. For a revert, identify the reverted commit SHA in the body or footer.

The initial repository scaffolding is maintenance work:

```text
chore(tooling): bootstrap repository conventions and quality checks (#1)
```

Complete the applicable [read-only worktree review](AGENTS.md#code-review-before-committing) before creating task commits. Resolve findings in the worktree, then create the signed commit and verify that its tree matches the reviewed content; a new commit SHA alone does not require repeating the review. Follow the [Git workflow](AGENTS.md#commits-pull-requests-and-integration) for signing and publication. GitHub-created merge commits keep their platform-generated messages.

## Open a pull request

Every pull request must reference its associated issue and explain the problem, your changes, and how you verified them. Use a closing reference such as `Closes #123` only when the pull request fully resolves that issue.

## Builds, releases and change notes

Atomic issues and pull requests receive the quality checks defined in [Desktop builds, releases and change notes](docs/release-policy.md). Integration does not publish a public release; a maintainer separately selects a candidate and authorizes publication of its verified packages.

Every pull request states whether it affects installed users. Include a short proposed change note for a relevant change, following the fields in [Change-note capture and editorial review](docs/release-policy.md#change-note-capture-and-editorial-review). When no public note is needed, explain why. The release policy owns collection, editorial review and public presentation; Conventional Commit subjects remain technical history rather than final release copy.

## License

Contributions are made under the project's [MIT license](LICENSE).
