---
type: Playbook
title: Release preparation
description: Reserve a version, build its packages for every declared platform and store them with attestations in an unpublished GitHub Release.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
---

# Release preparation

The [release policy](release-policy.md#candidate-preparation) owns candidate readiness and authorization; [ADR-0049](adr/adr-0049-main-source-selection-for-packages.md) owns source selection and [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md) owns signing and distribution. This procedure runs the manual [prepare-release workflow](../.github/workflows/prepare-release.yml). Preparation never publishes a release.

## Before running the workflow

1. Integrate into `main` the pull request that sets the new version in the root `package.json`.
2. Check the GitHub configuration from an up-to-date `main` checkout, with `gh` authenticated as described in [Repository policy](repository-policy.md#authentication). These commands do not change GitHub:

   ```bash
   git pull --ff-only
   python3 scripts/github_policy.py verify
   ```

   The `verify` command compares GitHub with the settings declared in `config/github/` of this checkout. Its first line names the commit it compares, as `Configuration: config/github/ at <commit> (main)`. It then checks the settings in three groups, called stages, and prints one line per stage, such as `tags: verified` or `tags: differs`:
   - `base`: repository settings, GitHub Actions permissions, dependency security settings and issue labels.
   - `ruleset`: the protection rules of the `main` branch.
   - `tags`: the protection rules that keep the `reserved/v*` and `v*` tags from being moved or deleted.

3. If a `Warning: main on GitHub is at <commit>, not at this commit.` line follows the first line, this checkout is not at the current `main`: run `git pull --ff-only` and `verify` again. If the first line ends with `with uncommitted changes`, the comparison used local edits instead of the integrated configuration: do not run the workflow; discard or integrate those edits and run `verify` again. Otherwise, if all three stages print `verified` and the command exits with `0`, continue with [Run the workflow](#run-the-workflow). Exit code `2` means the configuration could not be read or validated; correct the reported cause and run `verify` again.
4. If a stage prints `differs`, GitHub no longer matches its declared settings. Plan that stage, review the printed differences, apply the plan with its SHA-256 and verify again, replacing `<stage>` with the name of the stage that printed `differs`. [Repository policy](repository-policy.md#plan-apply-and-verify) describes the plan and its review. Do not run the workflow until `verify` exits with `0`.

   ```bash
   python3 scripts/github_policy.py plan --stage <stage>
   python3 scripts/github_policy.py apply --stage <stage> --confirm <plan-sha256>
   python3 scripts/github_policy.py verify
   ```

## Run the workflow

Run the workflow from `main`. The run commit is the commit of `main` when the run starts. The selected commit is the commit the run packages: the run commit when `hash` is empty, otherwise the commit that `hash` names, given as its full 40-character lowercase SHA; `git rev-parse <commit>` prints it from a shortened SHA. The workflow has no version input; it reads the version from the root `package.json` of the selected commit:

```bash
gh workflow run prepare-release.yml --ref main
gh workflow run prepare-release.yml --ref main -f hash=<commit-sha>
```

The `Reserve the version` job refuses a run from another branch or tag, a malformed hash, a commit outside the history of the run commit, a commit without the release build entry point, a commit whose platform declaration differs from that of the run commit, an invalid root version, a version whose `v<version>` tag exists and a version whose `reserved/v<version>` tag exists. An older commit can therefore be selected only while it declares the same platforms as the run commit. A refusal happens before any build. Otherwise the job creates the annotated tag `reserved/v<version>` on the selected commit; its message names the reserving run. Creating the reference is atomic, so of two runs for one version exactly one reserves it.

The `main`-only check runs inside the workflow definition of the run, so a modified copy of the workflow, run from another branch, could skip it. Such a run holds no secret, its token has no more repository access than the person who started it already has, and its attestations name the other branch, so verifying them with `--source-ref refs/heads/main` refuses its packages. [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md) binds signing and publication to the protected `release-signing` environment, which the workflow definition of a run cannot change.

## Follow the run

After starting the run, list the latest run to read its ID; a new run can take a few seconds to appear. Then wait until it finishes; with `--exit-status` the wait fails when the run fails:

```bash
gh run list --workflow prepare-release.yml --limit 1
gh run watch <run-id> --exit-status
```

Show the jobs and their results, and print the log of the failed steps when a job failed:

```bash
gh run view <run-id>
gh run view <run-id> --log-failed
```

A refused run fails the `Reserve the version` job; its log contains `Release preparation refused:` followed by the reason, and the platform jobs, the `Write the first release notes` job and the `Create the unpublished release` job are skipped. A refusal creates no tag and no release. After a reservation, show the reserved tag; its message names the reserving run and the selected commit, followed by that commit:

```bash
git fetch origin tag reserved/v<version>
git show --no-patch reserved/v<version>
```

## Platform jobs and the unpublished release

[The platform declaration](../config/release/platforms.json) lists each platform, its builds and whether its packages are signed. The platform jobs, shown as `linux (<target>)`, `windows (<target>)` and `macos (<target>)`, check out the selected commit, build the workspace and run [the release build entry point](../scripts/release_build.py), which reuses the package construction of the CI quality builds with the exact root version. They hold a read-only token and no secret. Each Linux job builds the Ubuntu 26.04, Debian 13 and Fedora 44 packages of its CPU on a hosted Ubuntu runner.

The `Create the unpublished release` job runs only when the notes job and every platform job succeeded. [The release tooling](../scripts/release_prepare.py) checks each package against its build record and the declaration, then the job attests every package and creates the unpublished release of the tag `v<version>`, titled `<version>`, whose body opens with the [first notes text](#release-notes). It uploads every package and then `release-digests.json`, which records the selected commit and its tree, the workflow revision, run and attempt, and each asset's SHA-256, length and signing state. An unsigned package carries `unsigned` in its name and is listed under the release body heading `Unsigned testing packages`, which states that these packages are for testing only and are not distributed installers.

## Release notes

The `Write the first release notes` job reads the merged pull requests with a read-only token and writes the first notes text with [the release notes tooling](../scripts/release_notes.py). It covers the pull requests merged since the highest published `v<version>` tag in the history of the selected commit, or the whole history when there is none; a `reserved/v<version>` tag never counts. A merge commit belongs to the merged pull request whose head is its second parent, whatever its subject. Each pull request contributes its `ohtia-note` block, collected with the [change-note tooling](change-notes.md#pr-capture). A user-impact note becomes one line, `- <task>: <result> (#<pull request>)`, under the section of its kind, in this order: `Breaking Changes and Notices` for deprecations and removals, `Security`, `Features` for capabilities and improvements, and `Bug Fixes` for corrections. Its migration, reinstall, removed-support, format-adapter, privacy-transfer and security-urgency disclosures open `Breaking Changes and Notices`, one line each, `- <task>: <disclosure>`. Notes with the same `change_id` form one line with the latest text, the pull request numbers and the disclosures of the range and of its unfinished notes since its last announcement; a change announced by an earlier release is not repeated. Notes marked `unfinished`, notes with `impact: none` and known limitations are left out. GitHub refuses a release body longer than 125,000 characters, so the job refuses notes longer than 120,000 characters, leaving room for the unsigned-packages section. Note text appears literally: Markdown characters are escaped, and mentions, issue and commit references, URLs, email addresses, math and emoji codes appear as code.

The summary on the run page, `https://github.com/ohtia/ohtia/actions/runs/<run-id>`, lists the pull requests without a valid `ohtia-note`, the merge commits without a matching merged pull request and the unfinished changes; none of them stops the run. Before publication, open the unpublished release, select **Edit**, replace the summary comment at the top of the body with one or two sentences about the release and revise the text. That edit is the editorial review of the [release policy](release-policy.md#change-note-capture-and-editorial-review).

## Failures and reruns

To stop a run, cancel it:

```bash
gh run cancel <run-id>
```

A run that fails or is cancelled after `reserved/v<version>` exists consumes the version: the tag ruleset keeps that tag, so the version cannot be prepared again. To use another version, integrate into `main` a pull request that sets the new version in the root `package.json` and run the workflow again. A run cancelled or refused before the reservation consumes nothing.

To retry the same run, re-run all its jobs, never only the failed jobs, because the `Create the unpublished release` job accepts only packages of the current attempt. Use **Re-run all jobs** on the run page or:

```bash
gh run rerun <run-id>
```

A rerun continues while the reserved tag points to the same commit and names the same run, and the unpublished release holds no asset yet. Otherwise it refuses.

## Check the result

The unpublished release is visible only to people with write access. Show its body and assets; every unsigned asset carries `unsigned` in its name and is listed under `Unsigned testing packages`:

```bash
gh release view v<version> --repo ohtia/ohtia
```

Download its assets and digest file into a new directory. In that directory, compare each asset with `release-digests.json`, where `sha256sum` prints `OK` for each matching asset, and print the signing state the digest file records for each asset:

```bash
gh release download v<version> --repo ohtia/ohtia --dir <directory>
cd <directory>
python3 -c 'import json; [print(a["sha256"] + "  " + a["name"]) for a in json.load(open("release-digests.json"))["assets"]]' | sha256sum -c
python3 -c 'import json; [print(a["name"], "signed" if a["signed"] else "unsigned") for a in json.load(open("release-digests.json"))["assets"]]'
```

Verify each package's attestation against the repository, the workflow and the run commit. The first command prints the run commit; use it as `<run-commit-sha>`:

```bash
gh run view <run-id> --repo ohtia/ohtia --json headSha --jq .headSha
for asset in ohtia-*; do
  gh attestation verify "$asset" --repo ohtia/ohtia \
    --signer-workflow ohtia/ohtia/.github/workflows/prepare-release.yml \
    --source-ref refs/heads/main --source-digest <run-commit-sha>
done
```

The attestation identifies the workflow run and its run commit; the digest file and the reserved tag identify the selected commit. When `hash` selected an older commit, these are different commits.
