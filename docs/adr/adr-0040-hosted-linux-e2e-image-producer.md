---
type: DecisionRecord
title: ADR-0040 — Input-addressed hosted producer for the Linux E2E image
description: Identify the Linux E2E image by its declared recipe inputs, build it only on GitHub-hosted runners when no publication exists, and re-run waiting checks automatically.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: larger-runners
    resource: https://docs.github.com/en/actions/reference/runners/larger-runners
    title: GitHub larger runners reference
  - id: runner-pricing
    resource: https://docs.github.com/en/billing/reference/actions-runner-pricing
    title: GitHub Actions runner pricing
  - id: path-filters
    resource: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore
    title: GitHub Actions push path filters
  - id: github-token
    resource: https://docs.github.com/en/actions/concepts/security/github_token
    title: GITHUB_TOKEN workflow-trigger behavior
---

# ADR-0040 — Input-addressed hosted producer for the Linux E2E image

## Context

[ADR-0019](adr-0019-immutable-linux-e2e-environment.md) requires a reproducible Linux x86-64 image with real sandboxes and originally selected a distribution-digest pin committed in Git. The image compiles a sandboxed WebKit from pinned source. On the standard hosted runner a construction ran more than two hours without finishing; its full duration is unmeasured.

A digest pin exists only after construction, so every recipe change needs a second commit carrying it. Events created with the workflow token start no new workflow runs, so a workflow-authored pin commit would leave the pull request without the `pull_request` check that the [trusted CI verifier](../../scripts/github_pr.py) requires.[^github-token] Committing pins by hand is a recurring manual step. A contributor-hosted producer would give image provenance to individual machines and require virtualization tools and package-write permission from contributors. Larger runners shorten construction but require a paid plan and per-minute billing, including for public repositories.[^larger-runners][^runner-pricing]

Selection criteria are GitHub-attributable provenance, no contributor publication authority or manual pin handling, construction only when required, failure before construction when an outcome cannot succeed, and unchanged qualification of the complete mandatory inventory.

## Decision

The image identity is the fingerprint of its declared inputs. The canonical `image_inputs` declaration in the [build manifest](../../config/desktop/linux-e2e-build.json) lists exactly the bytes that define the image identity: the Dockerfile, its build context exclusions, the recipe, the build manifest and the module that computes the fingerprint. The fingerprint hashes those paths, file modes and contents. Each publication uses the tag `inputs-<fingerprint>` and carries the fingerprint as an image label. This replaces ADR-0019's committed distribution-digest pin; Git fixes the recipe, and each E2E run records the registry digest it used.

The E2E launcher computes the checkout's fingerprint and uses only the matching local or published image whose label, account and platform match. A missing publication is an environment failure that names the fingerprint; no other image is substituted. Inside the container, the WebKit receipt must name this checkout's recipe and build-manifest hashes, patched source tree and installed artifacts.

The [image workflow](../../.github/workflows/linux-e2e-image.yml) is the only producer. It starts only for pushes to this repository that change a declared input, using a path filter identical to the declaration, and for explicit dispatch.[^path-filters] A planning job on the standard runner requests construction only when the registry reports the publication as absent; any other registry response stops without building. A newer run for the same branch cancels an unfinished one, and constructions for the same fingerprint run one at a time so a waiting successor reuses its predecessor's publication; GitHub keeps one waiting job per queue and cancels an earlier waiting one. Before construction, the build job verifies the event identity, Docker/AppArmor prerequisites, the continued absence of a publication and package-write permission. Qualification of every declared case precedes publication, receives no registry credential, and an existing input-addressed tag is never replaced.

After a publication, or when planning finds one, a recovery job serialized per fingerprint re-runs the failed jobs of each pull-request check of this repository from the last 30 days whose latest run failed with the missing-image message for that fingerprint, whichever branch produced the image. Construction uses the standard hosted runner; the optional repository variable `LINUX_E2E_IMAGE_RUNNER` can select a larger runner without changing the workflow. The recipe derives compiler parallelism from available CPUs and a per-job memory budget and records it in the WebKit receipts.

## Consequences

A recipe change needs only the ordinary commit, push and pull request. Its check fails at the E2E step until construction publishes the image, then re-runs automatically. A pull-request check tests the merge with `main`; if `main` changed the declared inputs meanwhile, merging `main` into the branch starts the construction that check needs. A fork cannot start construction, so a fork change to the declared inputs needs a maintainer to push the same inputs to a branch of this repository. Application changes reuse the existing publication. Contributors never build or publish the image, and its provenance is the GitHub-hosted run and commit.

Git no longer records the distribution digest, so no review binds a commit to the image its checks use. Anyone who can push a branch to this repository can run a modified producer with package-write permission and replace the image published for any fingerprint, including the one `main` uses. The fingerprint label and WebKit receipt are produced by whoever builds the image and do not detect such a replacement; each run's evidence records the digest actually used. This risk is accepted while every account with write access is a repository administrator, which can already change the repository's protections. Granting write access to any other account requires reconsidering a committed, reviewed digest. Package-write, re-run and package-visibility permissions are administrative policy settings. The workflow token's ability to re-run a pull-request check must be confirmed by the first hosted publication.

A standard-runner construction takes hours, and its complete duration must be measured against the job limit. Reconsider a registry layer cache if failed constructions with unchanged inputs become frequent: every declared-input change already produces a new identity, and the recipe enters the first build layer.

The [Linux E2E procedure](../linux-e2e.md#maintain-the-image) owns the operating steps and evidence.

[^larger-runners]: Larger runners are available to organizations on GitHub Team or GitHub Enterprise Cloud and list their CPU, memory and storage sizes.

[^runner-pricing]: Larger-runner minutes are billed per minute by size and are not free for public repositories.

[^path-filters]: Push path filters start a workflow only when the push changes a matching path.

[^github-token]: Events triggered by the workflow token do not create new workflow runs, except dispatch events and pull-request events awaiting approval.
