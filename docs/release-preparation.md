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

## Before dispatching

1. Integrate the pull request that raises the version in the root `package.json`. The workflow has no version input; it reads the version of the selected commit.
2. Check the GitHub configuration from an up-to-date `main` checkout, with `gh` authenticated as described in [Repository policy](repository-policy.md#authentication). These commands only read:

   ```bash
   git pull --ff-only
   python3 scripts/github_policy.py verify
   ```

   The `verify` command compares GitHub with the settings declared in `config/github/`. It checks them in three groups, called stages, and prints one line per stage, such as `tags: verified` or `tags: differs`:
   - `base`: repository settings, GitHub Actions permissions, dependency security settings and issue labels.
   - `ruleset`: the protection rules of the `main` branch.
   - `tags`: the protection rules that keep the `reserved/v*` and `v*` tags from being moved or deleted.

3. If all three stages print `verified` and the command exits with `0`, continue with the dispatch. Exit code `2` means the configuration could not be read or validated; correct the reported cause and run `verify` again.
4. If a stage prints `differs`, GitHub no longer matches its declared settings. Plan that stage, review the printed differences, apply the plan with its SHA-256 and verify again, replacing `<stage>` with the name of the stage that printed `differs`. [Repository policy](repository-policy.md#plan-apply-and-verify) describes the plan and its review. Do not dispatch until `verify` exits with `0`.

   ```bash
   python3 scripts/github_policy.py plan --stage <stage>
   python3 scripts/github_policy.py apply --stage <stage> --confirm <plan-sha256>
   python3 scripts/github_policy.py verify
   ```

## Dispatch

Dispatch the workflow from `main`. An empty `hash` selects the dispatch commit; otherwise give the full lowercase SHA of a commit in its history:

```bash
gh workflow run prepare-release.yml --ref main
gh workflow run prepare-release.yml --ref main -f hash=<commit-sha>
```

The `reserve` job refuses a dispatch from another branch or tag, a malformed hash, a commit outside the history of the dispatch commit, a commit without the release build entry point, a commit whose platform declaration differs from that of the dispatch commit, an invalid root version, a version whose `v<version>` tag exists and a version whose `reserved/v<version>` tag exists. An older commit can therefore be selected only while it declares the same platforms as `main`. A refusal happens before any build. Otherwise the job creates the annotated tag `reserved/v<version>` on the selected commit; its message names the reserving run. Creating the reference is atomic, so of two runs for one version exactly one reserves it.

The `main`-only check runs inside the dispatched workflow, so a modified copy dispatched from another branch could skip it. Such a run holds no secret and only the repository write access its dispatcher already has, and its attestations name the other branch, so verifying them with `--source-ref refs/heads/main` refuses its packages. Signing and publication authority are bound by the protected `release-signing` environment of [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md), which the dispatched definition cannot change.

## Platform jobs and the unpublished release

[The platform declaration](../config/release/platforms.json) lists each platform, its builds and whether its packages are signed. The `linux`, `windows` and `macos` jobs check out the selected commit, build the workspace and run [the release build entry point](../scripts/release_build.py), which reuses the package construction of the CI quality builds with the exact root version. They hold a read-only token and no secret. Linux builds the Ubuntu, Debian and Fedora packages of each CPU on a hosted Ubuntu runner.

The `release` job runs only when every platform job succeeded. [The release tooling](../scripts/release_prepare.py) checks each package against its build record and the declaration, then the job attests every package and creates the unpublished release `v<version>`, titled with the version. It uploads every package and then `release-digests.json`, which records the source commit and tree, the workflow revision, run and attempt, and each asset's SHA-256, length and signing state. An unsigned package carries `unsigned` in its name and is listed under the release body heading `Unsigned testing packages`, which states that these packages are for testing only and are not distributed installers.

## Failures and reruns

A run that fails after reserving consumes the version. To retry the same run, use **Re-run all jobs**, never only the failed jobs: the release job accepts only packages of the current attempt. A rerun continues while the reserved tag points to the same commit and names the same run, and the unpublished release holds no asset yet. Otherwise it refuses; correct the cause, raise the version in source and dispatch again.

## Check the result

The unpublished release is visible only to people with write access. Download its assets and digest file, compare each asset with `release-digests.json`, and verify each package's attestation against the repository, the workflow and the dispatch commit:

```bash
gh release download v<version> --repo ohtia/ohtia --dir <directory>
gh attestation verify <directory>/<asset> --repo ohtia/ohtia \
  --signer-workflow ohtia/ohtia/.github/workflows/prepare-release.yml \
  --source-ref refs/heads/main --source-digest <dispatch-commit-sha>
```

The attestation identifies the workflow run and its dispatch commit; the digest file and the reserved tag identify the packaged source commit. When `hash` selected an older commit, these are different commits.
