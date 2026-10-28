---
type: Playbook
title: Immutable Linux E2E environment
description: Run the pinned Linux x86-64 image with private sessions, active sandboxes and complete packaged Electron result accounting.
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
---

# Immutable Linux E2E environment

## Scope and prerequisites

[ADR-0019](adr/adr-0019-immutable-linux-e2e-environment.md) owns the reproducible Linux environment. The [image manifest](../config/desktop/linux-e2e.json) selects one Linux x86-64 manifest digest, its OCI configuration identity, paired Playwright package/browser revisions, reviewed policy hashes, resource limits and exact mandatory shards. The [image recipe](../tools/linux-e2e/Dockerfile) extends the pinned official Playwright image with a source-built WebKit sandbox and its runtime dependencies. OS libraries, display tools and browser artifacts belong in the image; the test entry performs no APT installation or fallback browser download.[^playwright-image]

Use a native Linux x86-64 host with Git, Python supporting the [workspace bootstrap](developer-workspace.md#scope-and-prerequisites), Docker, enforcing AppArmor with feature ABI 4.0, `apparmor_parser`, Bash, sudo, administrator permission to load the dedicated profile and permitted access to the pinned image/tool/package endpoints. Engine installation and host policy remain administrator responsibilities. The launcher admits the Docker/AppArmor route and rejects unavailable user namespaces, policy failures and architecture mismatches.

The image is additional contributor infrastructure. The [independent native route](desktop-runtime.md) remains available without a container engine. Its result covers this Linux x86-64 container environment. The [shared verification contract](shared-verification.md#native-and-browser-evidence) retains separate Linux ARM64, other OS/profile, native Wayland, installer, final-candidate, assistive and hostile-content confinement obligations. PRIN-004, PRIN-006, PRIN-007 and PRIN-016 require preserving those evidence boundaries and failed or omitted results.

## Run locally and in CI

Run from the issue worktree, using a fresh evidence directory for each attempt. Keep one profile lifecycle on the host and stop new E2E launches before removing its profile. Load the named profile for the test and remove it only after successful engine readback proves no remaining container uses it:[^docker-apparmor]

```bash
bash tools/linux-e2e/run.sh --output tmp/linux-e2e-attempt
```

The [shared host entry](../tools/linux-e2e/run.sh) verifies policy hashes before loading. Loading uses `--add` so an existing profile is preserved. If cleanup retains a container, retain the enforcing profile, resolve that container and repeat the `policy-unused` check before removal. An unavailable engine, incomplete readback or remaining profile user refuses removal. The wrapper preserves the primary test exit and fails a successful test when cleanup fails. The profile has no daemon-wide configuration or boot-time installation.

After frozen workspace setup, `python3 scripts/workspace.py run linux:e2e -- --output tmp/linux-e2e-attempt` invokes the same host entry and profile lifecycle. CI's mandatory `Run immutable sandboxed Linux E2E` step invokes that entry directly. The [trusted CI inventory](../config/github/ci-verification.json) includes the step; workflow review, policy authority and actual hosted execution remain distinct evidence.

The launcher resolves only the pinned configuration/manifest identity in the local image cache or pulls the immutable version-and-digest reference. It records cache state, verifies platform identity and inspects the created container's effective policy. It requires a dedicated non-root account, zero outer capabilities, no-new-privileges, private IPC/network/PID/UTS context and bounded CPU, memory, shared memory and process count. Host mounts, device access and unexpected security overrides fail admission.

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

A local source-recipe qualification passed both shards and all nine cases on an Ubuntu 24.04 x86-64 ScaleWay STANDARD3-X8C-32G VM with eight logical CPUs, reported MemTotal of 32,859,224 KiB, kernel 6.8.0-147-generic and Docker 29.1.3. The image was cached; tool/dependency caches inside the fresh test container were empty. No image compilation or large artifact transfer ran concurrently with this measurement. Downloads used the VM's ordinary public egress without an independent bandwidth measurement. The run identifier was `ad8913d4-fc70-40c6-b72b-79a331cb096c`; its exact source snapshot hash was `1f4dc1277a7bd8af1e0a59f445bb4d4edbdab643ebede21dabd8d7f9a6271a62`.

| Stage                         | Seconds |
| ----------------------------- | ------: |
| Cached image preparation      |   0.023 |
| Cold frozen workspace setup   |   6.776 |
| Repeated warm workspace setup |   0.464 |
| Product build and assembly    |   7.779 |
| Browser and Electron tests    |   3.771 |
| Host-observed setup and tests |  23.005 |

These observations describe that host, cached image and measured network conditions. They establish neither a cold image download duration nor a comparative speedup. Preserve image-cache state, host hardware, engine/security policy, network conditions and concurrent load when comparing runs. Qualify the actual CI policy and its tested workflow/source identity independently before asserting hosted compatibility.

## Maintain the image

The [image producer workflow](../.github/workflows/linux-e2e-image.yml) builds the image on a GitHub-hosted runner when its versioned recipe inputs change. It uses a commit-specific tag, records the source commit and workflow run as OCI labels, qualifies all nine cases against proposed pins, and publishes only after qualification succeeds. Registry write permission exists only in that producer job; the consumer CI job has package-read permission. Registry credentials remain on the runner and never enter the test container.

The producer prints `OHTIA_LINUX_E2E_IMAGE_PUBLICATION` and the complete proposed manifest in its job summary. Copy those exact published pins into the versioned image manifest in a signed follow-up commit. A pin-only change does not rebuild the image. The consumer PR run then verifies the committed pins under its real head/base/checkout identity. Local builds are reproduction experiments and are not publication inputs.

The [build manifest](../config/desktop/linux-e2e-build.json) pins the upstream image digest, Ubuntu snapshot, WebKit commit, exact Playwright patch hash and CMake configuration. Build the image in its disposable builder:

```bash
docker build --file tools/linux-e2e/Dockerfile --tag ohtia/linux-e2e:candidate .
```

The [maintainer recipe](../scripts/linux_e2e_image.py) verifies the source revision, exact patched Git tree and patch before compilation, hashes source files and link text before and after the build, checks actual CMake options and records installed artifact hashes. It prevents Python bytecode writes into the source and explicitly generates the GTK directory-stream header before parallel compilation. Finalization requires matching canonical preparation and compilation receipts instead of accepting a manually supplied prefix. It isolates libbacktrace headers from compiler intrinsics, derives exact runtime package versions from the built ELF dependency closure and retains license notices. The pinned base remains an explicit input for dynamically loaded components beyond that linked-library closure. The Docker build context admits only the recipe inputs. Root execution belongs to that disposable image build; the final image uses the dedicated test account.

An image update requires new image/configuration/build-receipt pins, paired SDK/browser validation, native positive and deliberate-negative tests, reviewed policy compatibility and the repository's independent review gate. Source-build provenance and immutable distribution identity are separate records. Publish only the authorized, qualified artifact and verify its registry digest before using it from a clean runner.

Preserve failed reports. A parity failure calls for a reviewed paired image/package update; a missing OS dependency belongs in the immutable image. A missing additional sandbox filter or required namespace is an environment failure. Keep the sandbox and mandatory inventory intact while correcting the image or policy.

[^playwright-image]: The upstream image supplies browser artifacts and OS dependencies; the separately installed npm package must match its version.

[^playwright-seccomp]: The upstream syscall profile permits namespace creation; Ohtia versions its runtime adaptations and independently observes content-process sandboxes.

[^docker-apparmor]: Docker supports loading a named AppArmor policy and selecting it for individual containers; policy loading and removal require administrator authority.
