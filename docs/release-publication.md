---
type: Playbook
title: Release publication
description: Verify a prepared unpublished release against its digest file, approve it, remove its unsigned packages and make it public with its version tag and notes digest.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
---

# Release publication

The [release policy](release-policy.md#public-publication-and-promotion) owns publication authorization, and [SPEC-001-039](epics/EPIC-001-desktop-foundation/epic.md#spec-001-039-publish-release-workflow) the workflow. This procedure runs the manual [publish-release workflow](../.github/workflows/publish-release.yml) on a release prepared by [Release preparation](release-preparation.md). The workflow never builds or signs a package. It copies the Ubuntu and Debian packages to the `stable` apt repositories, from which installed systems receive updates; the Fedora packages are installed from the release page.

## Before running the workflow

1. Prepare the version and check the result, as described in [Release preparation](release-preparation.md#check-the-result).
2. Edit the body of the unpublished release, as described in [Release preparation](release-preparation.md#release-notes). Keep the `Unsigned testing packages` section at the end exactly as preparation wrote it; the workflow removes it and refuses a changed one. The rest of the body must not hold a heading containing the word "unsigned", in any heading form, the section's statement or the name of an unsigned package, because the workflow refuses any remnant of the section.
3. Check the GitHub configuration from an up-to-date `main` checkout, as described in [Release preparation](release-preparation.md#before-running-the-workflow), and run the workflow only when `python3 scripts/github_policy.py verify` exits with `0`.

## Run the workflow

Run the workflow from `main` with the version of the prepared release:

```bash
gh workflow run publish-release.yml --ref main -f version=<version>
```

Only one publication runs at a time. A run started while another runs waits for it; GitHub keeps only the newest waiting run and cancels an older waiting one.

## Check the prepared release

The `Check the prepared release` job reads the unpublished release and changes nothing. It refuses a run from another branch or tag, a version that is not a final `major.minor.patch`, a version without its annotated `reserved/v<version>` tag, a missing unpublished release and an already public one. It also refuses a release whose tag, title or target commit differs from the reservation, an existing `v<version>` tag, an asset that differs from `release-digests.json` or is not listed in it, a missing signed package and a changed or misplaced `Unsigned testing packages` section. It refuses a reserved commit whose files under `.github/workflows/` differ from `main`, apart from workflow files that only `main` holds: GitHub refuses the workflow token to publish a release whose target commit adds or modifies a workflow file relative to the default branch. Such a version cannot be published by this workflow; prepare a new version from the current `main`. The job downloads every asset and compares its length and SHA-256 with the digest file.

The summary on the run page, `https://github.com/ohtia/ohtia/actions/runs/<run-id>`, then shows the version, the reserved commit, the release, the SHA-256 of the current body and of the body that will be published, and the length and SHA-256 of every asset and of `release-digests.json`, marking the unsigned packages that publication removes.

## Copy the Debian packages to the stable repositories

The `Copy the Debian packages to the stable repositories` job is the first that waits for your approval in the protected `release-signing` environment of [Release signing key](release-signing.md). Compare the summary with the prepared release and the release you intend to publish, then select **Review deployments** on the run page, select `release-signing` and then **Approve and deploy**. **Reject** fails the run before any change.

It runs [the apt repository action](../.github/actions/apt-repository/action.yml) as the preparation's test-repository job does, for the `stable` zone: it downloads `release-digests.json` and refuses one whose SHA-256 differs from the checked digest file, downloads and checks every Debian package that file lists, without comparing them with the platform declaration of the current `main`, builds and signs both indexes, uploads them to `https://packages.ohtia.com/stable/ubuntu/` and `https://packages.ohtia.com/stable/debian/` and reads them back. From then on, systems with an Ohtia package installed are offered the version through apt. A failure is reported as [Recover from an incomplete repository upload](release-signing.md#recover-from-an-incomplete-repository-upload) describes; the release stays unpublished.

## Approve the publication

The `Publish the release` job starts after the stable repositories are written and waits for your approval in the protected `release-signing` environment of [Release signing key](release-signing.md). Approve it as before. **Reject** fails the run before any change to the release; the stable repositories already offer the version.

After the approval the job checks the same state again and refuses a body or a digest file that changed since the check; to publish a newer body, run the workflow again and approve it. It then:

1. Updates the release without changing it, which shows that GitHub lets the workflow token update it before anything is removed.
2. Removes every asset recorded as `unsigned` in the digest file.
3. Removes the `Unsigned testing packages` section and the blank lines before it, keeping every other byte of the body.
4. Uploads `release-notes.sha256`, one line with the SHA-256 of the exact body that is published, replacing an incomplete one or one that records an earlier body.
5. Makes the release public and latest. GitHub creates the tag `v<version>` on the release's target commit, which the workflow checked against `reserved/v<version>`.
6. Verifies that the public release holds exactly the signed packages, `release-digests.json` unchanged and `release-notes.sha256`, that its body is the approved one and that `v<version>` names the reserved commit.

## Failures and reruns

A failure before step 5 leaves the release unpublished. When a step fails after the release became public, the error names the public surfaces, such as `Public now: the release <version> and the tag v<version>.`

To retry the same run, re-run all its jobs; both jobs wait for your approval again, and the repository job writes the same packages and index again. Use **Re-run all jobs** on the run page or:

```bash
gh run rerun <run-id>
```

A retry continues from the state it finds: it removes only the unsigned assets that remain, updates the body only while it still holds the section, uploads `release-notes.sha256` only when the release does not already hold the one of its body, and never replaces an asset of a public release. A retry of a run whose release is already public only verifies it, and its summary says so; a new run for a public release is refused.

## Check the result

The public release holds the signed packages, `release-digests.json` and `release-notes.sha256`:

```bash
gh release view v<version> --repo ohtia/ohtia
```

Compare the SHA-256 of the public body with `release-notes.sha256`; both commands print the same digest:

```bash
gh api repos/ohtia/ohtia/releases/tags/v<version> | python3 -c 'import hashlib, json, sys; print(hashlib.sha256(json.load(sys.stdin)["body"].encode()).hexdigest())'
gh release download v<version> --repo ohtia/ohtia --pattern release-notes.sha256 --output -
```

Check the packages against the digest file, their signatures and their attestations as described in [Release preparation](release-preparation.md#check-the-result); the unsigned packages are no longer assets, so add `--ignore-missing` to `sha256sum -c`. Show the commit that the version tag names, which is the reserved commit:

```bash
git fetch origin tag v<version>
git rev-parse v<version>^{commit}
```
