---
type: Playbook
title: Immutable Linux E2E environment
description: Produce the pinned Linux x86-64 image only when its inputs change and run it with private sessions, active sandboxes and complete packaged Electron result accounting.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: playwright-image
    resource: https://playwright.dev/docs/docker
    title: Playwright Docker environment
  - id: playwright-seccomp
    resource: https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json
    title: Playwright container syscall profile
  - id: docker-apparmor
    resource: https://docs.docker.com/engine/security/apparmor/
    title: Docker AppArmor profiles
  - id: larger-runners
    resource: https://docs.github.com/en/actions/reference/runners/larger-runners
    title: GitHub larger runners reference
  - id: repository-variables
    resource: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables
    title: GitHub Actions configuration variables
  - id: github-package-access
    resource: https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
    title: GitHub package access control and visibility
---

# Immutable Linux E2E environment

## Scope and prerequisites

[ADR-0019](adr/adr-0019-immutable-linux-e2e-environment.md) owns the reproducible Linux environment. The [image manifest](../config/desktop/linux-e2e.json) selects the paired Playwright package/browser revisions, reviewed policy hashes, resource limits and exact mandatory shards. The image identity derives from the declared recipe inputs, as defined by [ADR-0040](adr/adr-0040-hosted-linux-e2e-image-producer.md). The [image recipe](../tools/linux-e2e/Dockerfile) extends the pinned official Playwright image with a source-built WebKit sandbox and its runtime dependencies. OS libraries, display tools and browser artifacts belong in the image; the test entry performs no APT installation or fallback browser download.[^playwright-image]

Use a native Linux x86-64 host with Git, Python supporting the [workspace bootstrap](developer-workspace.md#scope-and-prerequisites), Docker, enforcing AppArmor with feature ABI 4.0, `apparmor_parser`, Bash, sudo, administrator permission to load the dedicated profile and permitted access to the pinned image/tool/package endpoints. Engine installation and host policy remain administrator responsibilities. The launcher admits the Docker/AppArmor route and rejects unavailable user namespaces, policy failures and architecture mismatches.

The image is additional contributor infrastructure. The [independent native route](desktop-runtime.md) remains available without a container engine. Its result covers this Linux x86-64 container environment. The [shared verification contract](shared-verification.md#native-and-browser-evidence) retains separate Linux ARM64, other OS/profile, native Wayland, installer, final-candidate, assistive and hostile-content confinement obligations. PRIN-004, PRIN-006, PRIN-007 and PRIN-016 require preserving those evidence boundaries and failed or omitted results.

## Run locally and in CI

Run from the issue worktree, using a fresh evidence directory for each attempt. Keep one profile lifecycle on the host and stop new E2E launches before removing its profile. Load the named profile for the test and remove it only after successful engine readback proves no remaining container uses it:[^docker-apparmor]

```bash
bash tools/linux-e2e/run.sh --output tmp/linux-e2e-attempt
```

The [shared host entry](../tools/linux-e2e/run.sh) verifies policy hashes before loading. Loading uses `--add` so an existing profile is preserved. If cleanup retains a container, retain the enforcing profile, resolve that container and repeat the `policy-unused` check before removal. An unavailable engine, incomplete readback or remaining profile user refuses removal. The wrapper preserves the primary test exit and fails a successful test when cleanup fails. The profile has no daemon-wide configuration or boot-time installation.

After frozen workspace setup, `python3 scripts/workspace.py run linux:e2e -- --output tmp/linux-e2e-attempt` invokes the same host entry and profile lifecycle. CI's mandatory `Run immutable sandboxed Linux E2E` step invokes that entry directly. The [trusted CI inventory](../config/github/ci-verification.json) includes the step; workflow review, policy authority and actual hosted execution remain distinct evidence.

The launcher computes the input fingerprint of the checkout's recipe and uses the image tagged `inputs-<fingerprint>` from the local cache, or pulls that publication. The image must carry the same fingerprint label, the dedicated account and the Linux amd64 platform; a missing publication fails with the fingerprint and no other image is substituted. Each run records the tag, the registry digest it used, the image identity and the cache state, and inspects the created container's effective policy. It requires a dedicated non-root account, zero outer capabilities, no-new-privileges, private IPC/network/PID/UTS context and bounded CPU, memory, shared memory and process count. Host mounts, device access and unexpected security overrides fail admission.

Only regular Git-known and nonignored source files enter a temporary archive. It excludes runtime environments, ignored scratch data, Git transport configuration and named credential inputs. It reaches the container through standard input. Keep private research and credentials outside Git and within the repository's ignored locations. Container-engine infrastructure remains trusted ephemeral build machinery; its administrator and implicit engine authority remain part of that trust boundary.

## Session and sandbox admission

The image's dedicated non-root account receives fresh configuration, native-home research and scratch roots. Preparation checks OS account identity, empty inherited display/session/credential context, zero effective/permitted/bounding/ambient capabilities, active outer seccomp, the enforcing AppArmor label and real sensitive-path access denials. It constructs synthetic stable sentinels outside that account's home and admits the packaged executable through the existing [runtime launch contract](desktop-runtime.md#build-assemble-and-launch). Those sentinels exercise the contract within the private container; the launcher separately verifies absence of host configuration/data mounts.

Frozen setup runs from empty checkout-local tool and dependency caches, then repeats against the same locks. Parity compares the package and actual browser inventory with image metadata, installation markers and executable paths. WebKit additionally requires canonical prepare/compile receipts, the exact patched source tree, pinned recipe/configuration hashes, full installed artifact inventory and launcher hash. Developer Node and Electron's embedded runtime are recorded separately. The ordinary product build and verified runtime assembler supply the release-equivalent resources, CSP, preload, broker and native binding.

A private DBus session and Xvfb display supply graphical infrastructure. The [versioned seccomp profile](../config/desktop/linux-e2e-seccomp.json) starts from Playwright's published profile and admits the modern file/descriptor calls used by the pinned runtime.[^playwright-seccomp] `clone3` returns ENOSYS for the existing `clone` fallback. Child user namespaces require chroot and mount primitives for the browser sandboxes; kernel authority checks and zero outer capabilities still apply.

The [dedicated AppArmor profile](../config/desktop/linux-e2e.apparmor) allows those nested mounts while explicitly denying sensitive proc/sys access and kernel-setting writes. The container uses `systempaths=unconfined` to replace Docker's locked masked/read-only path mounts with those AppArmor denials, allowing WebKit to mount a private proc filesystem. Admission requires the exact enforcing profile, empty engine path-mask lists and read-denial probes for `/proc/interrupts` and `/proc/keys`; ordinary file permissions allow those opens in the qualified host context. An arbitrary unconfined profile fails. Every selected browser content process must have an additional active seccomp filter. Chromium, WebKit and the packaged Electron renderer also require nested PID namespace evidence.

The Electron harness attaches CSP observation before releasing the first application document through a bounded acceptance-only startup barrier. It exercises real packaged startup, renderer sandboxing, status IPC through preload/main/utility, distinct rejected IPC envelopes, deliberate CSP violations and shutdown within the existing total deadline with an observed zero exit code and no termination signal. Negative envelope/frame fixtures enter the actual packaged broker through synthetic main-process events; the receipt identifies that scope, since the renderer has no raw IPC authority. The initial inert document and test barrier apply only under explicit runtime acceptance instrumentation.

## Results and measurements

`result.json` begins as failed. Successful admission requires exactly the declared browser and Electron shards, every case passing once and matching source/run identities. Missing, duplicate, skipped, cancelled, failed, retried or foreign results fail admission. A failed browser shard still runs the Electron shard. The attached container run has a ten-minute deadline; timeout recovery first attempts a bounded stop and copies available reports before removal. Partial or invalid reports retain the primary execution failure and their own diagnostics.

`container-policy.json` records effective engine configuration. The copied `container/` reports retain the transferred input manifest, package/browser parity, process observations, bounded browser stderr on failure, shard results and timings. Source identity includes event head/base, actual checkout/tree, candidate tree, file hashes, workflow bytes and hosted run/attempt identifiers when present. Local reports preserve the full file manifest; CI also emits a compact `OHTIA_LINUX_E2E_RESULT` receipt with source hashes and per-case observations into its run log.

A source-recipe qualification passed both shards and all nine cases on a Linux x86-64 host with eight logical CPUs and 32 GiB of memory. The image was already cached, and tool and dependency caches inside the fresh test container were empty.

| Stage                         | Seconds |
| ----------------------------- | ------: |
| Cached image preparation      |   0.023 |
| Cold frozen workspace setup   |   6.776 |
| Repeated warm workspace setup |   0.464 |
| Product build and assembly    |   7.779 |
| Browser and Electron tests    |   3.771 |
| Host-observed setup and tests |  23.005 |

These observations describe that host and its cached image. They establish neither a cold image download duration nor a comparative speedup. Preserve image-cache state, host hardware, engine/security policy, network conditions and concurrent load when comparing runs. Qualify the actual CI policy and its tested workflow/source identity independently before asserting hosted compatibility.

## Maintain the image

[ADR-0040](adr/adr-0040-hosted-linux-e2e-image-producer.md) selects the producer. The [image workflow](../.github/workflows/linux-e2e-image.yml) is the only route that builds and publishes the image. The `image_inputs` declaration in the [build manifest](../config/desktop/linux-e2e-build.json) lists the Dockerfile, `.dockerignore`, the recipe, the build manifest and the [fingerprint module](../scripts/linux_e2e_image_inputs.py); the workflow's push path filter repeats that list and a repository test keeps them identical. The input fingerprint hashes those paths, file modes and bytes. Each publication uses the tag `inputs-<fingerprint>`. Git fixes the recipe; no generated image reference is committed. Anyone who can push a branch can therefore replace the published image for a fingerprint without review; ADR-0040 accepts that risk while every account with write access is a repository administrator.

### When construction runs

The workflow starts for a push to this repository that changes a declared input, or for an explicit `workflow_dispatch`. Pull requests, forks and changes outside the declared inputs do not start it. Its planning job runs on the standard runner:

- An existing publication for the fingerprint ends the run without construction.
- Construction is requested only when GHCR reports that publication as absent. Any other registry response stops the run without building.

A newer run for the same branch cancels an unfinished one. Construction jobs for the same fingerprint run one at a time; a waiting successor finds the publication and ends without building. GitHub keeps one waiting job per queue, so a newer waiting job cancels an earlier one; the re-run below still recovers that branch's check. The construction job checks the event identity, Docker/AppArmor prerequisites, the absence of a publication and package-write permission before it starts the Docker build.

While construction runs, the branch's pull-request check fails at its E2E step and names the missing fingerprint. After publication, or when planning finds the publication already present, the workflow reads each branch's latest pull-request check in this repository from the last 30 days, the period in which GitHub permits re-runs, and up to the 1,000 runs GitHub lists. It re-runs all jobs of a check when a failed job log contains the missing-image message for that fingerprint. Native artifacts and provenance receipts must all belong to that new run attempt; re-running only failed jobs leaves successful native jobs in the earlier attempt and cannot satisfy the strict CI aggregate. A passing, running, superseded or otherwise failed check is left unchanged. An expired job log is reported and skipped; any other failure while inspecting or re-running a check is reported after the remaining checks are processed and fails the job. A separate recovery job on the standard runner performs these re-runs; recovery for one fingerprint runs one at a time, so two runs never re-run the same check. The pull-request check tests the merge with `main`: if `main` changed the declared inputs while the branch was open, merge `main` into the branch and push so construction runs for the merged inputs. Forks cannot start construction; a maintainer pushes a fork's changed inputs to a branch of this repository and, after publication, re-runs the fork's pull-request check.

### Runner and limits

Construction uses the standard hosted runner, which is free for this public repository, with a 330-minute limit after removing preinstalled toolchains to free disk space. The optional repository variable `LINUX_E2E_IMAGE_RUNNER` can instead name a larger runner, with a 60-minute limit. Larger runners require the GitHub Team or Enterprise Cloud plan and are billed per minute, including for public repositories.[^larger-runners] To use one, create the runner, make it available to this repository, then set the variable to its exact name:[^repository-variables]

```bash
gh variable set LINUX_E2E_IMAGE_RUNNER --repo ohtia/ohtia --body <runner-name>
```

A variable naming an unavailable runner leaves the job queued without construction. The recipe derives compiler parallelism inside the build from CPU affinity, any cgroup CPU quota, available memory and the manifest's `memory_per_job_bytes`; the compilation and WebKit receipts record the value used. Record the actual duration and runner of the first construction before claiming a duration.

### Qualification and publication

Construction requires Docker Engine 25 or later, whose image export is an OCI image layout. It tags the candidate `inputs-<fingerprint>` locally and qualifies it through the shared [host entry](../tools/linux-e2e/run.sh), which resolves that local tag and requires every declared shard and case. Qualification receives no registry credential. Publication logs in through a temporary Docker configuration, refuses to replace an existing input-addressed tag, pushes, and reads the registry back to confirm the configuration digest and input label. The run prints `OHTIA_LINUX_E2E_IMAGE_PUBLICATION` with the published reference, configuration digest and WebKit receipt hash.

Inside the container, the harness requires the WebKit receipt to name this checkout's recipe and build-manifest hashes, the pinned patched source tree, the compilation receipt, the installed artifact inventory and the launcher hash. The receipt hash is recorded as run evidence.

The package is created by its first publication and is private. This repository's workflows pull it with their workflow token; anonymous downloads are refused, and a local run that pulls it needs a registry login with read access to the package. Its private visibility, repository Actions access, package-write and re-run permissions and the optional runner variable are administrative settings governed by [repository policy](repository-policy.md).[^github-package-access]

### Recipe

The [build manifest](../config/desktop/linux-e2e-build.json) pins the upstream image digest, Ubuntu snapshot, WebKit commit, exact Playwright patch hash and CMake configuration. A local build is a reproduction experiment, never a publication input:

```bash
docker build --file tools/linux-e2e/Dockerfile --tag ohtia/linux-e2e:candidate .
```

The [maintainer recipe](../scripts/linux_e2e_image.py) verifies the source revision, exact patched Git tree and patch before compilation, hashes source files and link text before and after the build, checks actual CMake options and records installed artifact hashes. It prevents Python bytecode writes into the source and explicitly generates the GTK directory-stream header before parallel compilation. Finalization requires matching canonical preparation and compilation receipts instead of accepting a manually supplied prefix. It isolates libbacktrace headers from compiler intrinsics, derives exact runtime package versions from the built ELF dependency closure and retains license notices. The pinned base remains an explicit input for dynamically loaded components beyond that linked-library closure. The Docker build context admits only the recipe inputs. Root execution belongs to that disposable image build; the final image uses the dedicated test account.

An image update requires paired SDK/browser validation, native positive and deliberate-negative tests, reviewed policy compatibility and the repository's independent review gate. Source-build provenance and immutable distribution identity are separate records.

Preserve failed reports. A parity failure calls for a reviewed paired image/package update; a missing OS dependency belongs in the immutable image. A missing additional sandbox filter or required namespace is an environment failure. Keep the sandbox and mandatory inventory intact while correcting the image or policy.

[^playwright-image]: The upstream image supplies browser artifacts and OS dependencies; the separately installed npm package must match its version.

[^playwright-seccomp]: The upstream syscall profile permits namespace creation; Ohtia versions its runtime adaptations and independently observes content-process sandboxes.

[^docker-apparmor]: Docker supports loading a named AppArmor policy and selecting it for individual containers; policy loading and removal require administrator authority.

[^larger-runners]: Larger runners require the GitHub Team or Enterprise Cloud plan and are billed per minute by size.

[^repository-variables]: Repository configuration variables are available to workflows through the `vars` context.

[^github-package-access]: A package's visibility and repository Actions access are separate package settings.
