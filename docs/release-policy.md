---
type: Specification
title: "Desktop builds, releases and change notes"
description: "Quality-build triggers, artifact-bound candidate readiness, immutable promotion, public versioning and user-facing change communication."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: keep-a-changelog
    resource: "https://keepachangelog.com/en/1.1.0/"
    title: "Keep a Changelog — Human-readable release histories"
---

# Desktop builds, releases and change notes

## Purpose and ownership

An issue defines a bounded unit of work; a public release delivers a coherent, usable set of changes. Completing an issue, merging a feature, updating a dependency or finishing an epic does not by itself authorize publication. Several atomic issues may contribute to one user-visible capability, and one urgent correction may justify its own release.

This policy owns build and publication triggers, release readiness, channels, application version semantics and change communication. [ADR-0021](adr/adr-0021-versioned-desktop-artifacts.md) owns coordinated versioning and final artifact identity. [ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md) and [Repository policy](repository-policy.md) own CI trust and repository administration; [ADR-0010](adr/adr-0010-pre-migration-recovery.md) owns pre-migration recovery. [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md) owns Linux signing, the Linux package repositories and the application's update notice. Preserve those contracts rather than treating release automation as an alternative implementation.

Describe changes through research activities and understandable consequences, following [PRIN-011](product-definition.md#prin-011-keep-technology-behind-the-task). Protect retained research and explain consequential compatibility changes, following [PRIN-013](product-definition.md#prin-013-preserve-the-process). Report actual validation scope and uncertainty under [PRIN-006](product-definition.md#prin-006-expose-uncertainty) and [PRIN-007](product-definition.md#prin-007-declare-coverage).

## Quality builds and distribution

A quality build is evidence about identified source and artifacts. It is not a public release, an announcement or permission to change a package repository. Successful compilation and packaging do not establish successful installation, native behavior, update compatibility or research-data recovery.

Distinguish temporary quality artifacts from the public distribution channel:

- **CI artifacts:** temporary packages and reports attached to an identified PR or integrated commit, for contributor review and internal quality work. They do not enter a package repository or create a public release entry.
- **Stable:** the one public distribution channel, for supported, usable capabilities. Only an approved final candidate enters this channel.

[ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md) distributes Linux through signed apt and dnf repositories with two zones: `stable` is the public one, and `test` serves qualification only and is not a distribution channel. A preview channel is deferred.

A release candidate is a validation state of a particular artifact set, not a public channel. It is a GitHub Release that stays unpublished, visible only to people with write access, whose Linux packages are copied to the `test` zone for qualification. A candidate carries its intended stable version before final packaging and verification.

Every CI executable and internal final candidate runs with isolated application data, and daily development uses the checkout-scoped instance selected by [ADR-0043](adr/adr-0043-ordinary-startup-modes.md). The application does not detect a candidate installed outside that isolation, because final bytes must not change, so this remains a documented procedure. Automated and maintainer-run tests use only synthetic or permitted public material, following [ADR-0017](adr/adr-0017-real-boundary-integration-tests.md). Private research and developer credential copies never enter CI or external evaluations. CI/development packages never enter the `stable` repositories, and development and qualification builds do not check for updates.

For exact-byte final candidates, use a separate OS user profile or VM whose native configuration and research store are independent of the stable installation. Preserve [ADR-0036](adr/adr-0036-application-preferences-and-bootstrap.md) and the architecture's fixed bootstrap-locator contract rather than silently redirecting it. Installing two executables side by side does not establish isolation, and a compiled channel name is not the isolation mechanism. Publication copies the candidate's exact bytes from the unpublished release to the `stable` zone, so the same final bytes are tested in the isolated environment and later offered to stable users. Never silently open or migrate a stable research store from a non-stable test installation. Returning to stable does not imply that an older executable can read a newer schema or that data will be downgraded automatically.

## Triggers

### Pull requests

Creating or updating a PR targeting `main` triggers the shared checks applicable to its changes and consumers. Changes affecting application code, assets, native dependencies, lockfiles, runtime configuration, packaging or build tooling require quality builds and the applicable packaged smoke tests across the recurring hosted Windows, macOS and Linux OS/CPU matrix selected by [ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix). Distribution qualification retains its separate target/profile inventory. Verify actual native execution on the targets it claims to cover; cross-compilation alone is not that evidence.

Apply [ADR-0016](adr/adr-0016-shared-quality-and-coverage-gates.md) and [ADR-0018](adr/adr-0018-vitest-and-playwright-desktop-tests.md) to affected-scope selection, complete result accounting and runtime coverage. Documentation-only changes may omit desktop builds when they cannot affect the delivered application or its build inputs, while retaining documentation and repository checks. An uncertain impact requires the complete relevant checks. Keep the stable aggregate `ci` result and reviewed check inventory consistent with the selected partitions.

PR execution produces review artifacts without signing, notarization or publication credentials. It cannot authorize a release or promote its own output into trusted execution. A trusted candidate build uses reviewed configuration and source admitted through the repository's review and integration rules.

### Integration into main

A push to `main` triggers the applicable shared checks and desktop quality builds for the actual integrated source. Preserve their commit, tested tree, target and run identity. PR evidence about a synthetic merge does not replace validation of a different integrated revision. Main-branch builds remain quality artifacts unless separately admitted for candidate preparation.

Nightly jobs may later run longer regression suites when justified by measured coverage or cost. They supplement the required integration gates, do not publish automatically and do not replace a mandatory per-change check.

### Credential-free workflow verification

Exercise build/sign/verify and candidate/publication workflow logic before integration with ephemeral test identities, permitted synthetic data and controlled nonpublic fixtures. These jobs receive no production signing/notarization/publication authority. Protected-main admission remains mandatory for real privileged operations; a PR-safe test mode cannot bypass candidate or public-readiness gates. Candidate preparation reuses the CI build entry points rather than a separately implemented builder.

### Candidate preparation

Candidate preparation uses the manually invoked `prepare-release.yml` GitHub Actions `workflow_dispatch` workflow of [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md). Both preparation and publication execute their workflow definitions from protected `main`; reject a dispatch that selects another branch or tag as the workflow ref. Record and verify the immutable workflow-definition revision separately from the application source. Enforce workflow-ref admission and the binding of signing/publication authority through controls that the dispatched definition cannot modify: the protected `release-signing` environment, which admits only `main` and requires the maintainer's approval for every run, and the repository protection of `reserved/v*` and `v*` tags. Qualify those controls before enabling privileged execution; a guard or credential restriction declared only inside that same definition is insufficient. A maintainer selects an exact reviewed application commit already integrated into protected `main` through the repository's PR and required-check rules, using the optional `hash` input of [ADR-0049](adr/adr-0049-main-source-selection-for-packages.md); an empty value selects the dispatch commit. The workflow has no version input: it reads the application version from the root `package.json` of the selected commit. Resolve mutable names before building; subsequent branch movement cannot change the selected source or execution evidence. A passed quality build is a prerequisite, not publication authorization. A clock, issue closure, merge or commit type cannot select and publish a candidate by itself.

Before building, the workflow stops when the version's `v<version>` tag exists or another run created its protected tag `reserved/v<version>`. It then builds the packages of all three platforms with the exact version, one independent job per platform, by reusing the CI build entry points; signs the Linux packages in the `release-signing` environment; creates `reserved/v<version>` on the selected commit once every package is built and signed, so a failed build or signing consumes no version; produces a GitHub build attestation for every final package; creates a GitHub Release that stays unpublished, with the packages, a digest file and a first notes text; and copies the Linux packages to the `test` zone. Build jobs run without secrets, and the signing job runs no project code.

Build the full declared platform set from frozen dependencies and identified toolchains, and enumerate build/provenance, native-runtime and signed-distribution capability evidence separately. The [phased foundation contract](epics/EPIC-001-desktop-foundation/epic.md#spec-001-028-linux-first-delivery-and-platform-capability-admission) qualifies all Linux profiles and common delivery infrastructure first, while keeping native macOS/Windows builds and verified GitHub attestations immediate. Only actually qualified target capabilities may enter the signed distribution set; unavailable macOS/Windows publisher facilities remain explicit ineligible capabilities until stories 019/020 pass. They do not block internal Linux infrastructure qualification, and no platform may disappear silently from the manifest. A macOS or Windows package that is not yet signed carries `unsigned` in its asset name, is recorded as unsigned in the digest file and is listed in the release body under a fixed heading stating that it is for testing only and is not a distributed installer. Publication removes every unsigned asset and that heading before the release becomes public, so a public release holds only signed packages. Complete all installer, signing, notarization and package transformations before recording final digests and running final artifact verification. Include the source and component identities, lockfiles, tool versions, target OS/CPU and package format, schema compatibility, required license material, workflow-definition revision, build run/attempt, final digests, validation evidence and release notes in the candidate record.

Candidate readiness applies [ADR-0021](adr/adr-0021-versioned-desktop-artifacts.md) to the package-to-environment assignments in the [shared artifact-to-cell contract](epics/EPIC-001-desktop-foundation/epic.md#spec-001-028-linux-first-delivery-and-platform-capability-admission). Multiple native environments assigned to one package must test its same final digest. Linux qualification runs the complete scenario on the six GNOME cells and a short scenario on the six KDE cells with the same package bytes. Recurring quality jobs may build separate development packages per cell, but their combined results do not qualify the bytes of a final candidate or select a package for promotion.

Record the candidate independently of a moving `main` head. Superseding it requires a new explicit selection; do not replace its files in place. Failed, cancelled, incomplete or unreadable required target evidence prevents readiness. A candidate's existence or a signature on one installer is not evidence that the coordinated target set passed. Linux infrastructure readiness and public product readiness are distinct. An attempt to distribute an unqualified platform fails closed; full-platform public readiness requires both actual macOS and Windows signing/user-route outputs in addition to Linux evidence. An unsigned or ad-hoc package cannot become a distributed installer by changing a label.

### Public publication and promotion

Publication uses the separate manually invoked `publish-release.yml` GitHub Actions `workflow_dispatch` workflow of [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md), whose input is a prepared version. A maintainer explicitly authorizes an identified, ready candidate for the stable channel. Authorization identifies the version, source, candidate and targets; generic approval of a PR, issue or CI execution does not imply it. An environment approval may serve as that authorization when it presents and records those exact identities for maintainer review; a generic permission to run a workflow cannot. Keep preparation and publication as separate operations. Release tooling may assemble notes, but cannot infer authorization from Conventional Commits.

The workflow verifies every asset of the unpublished release against its digest file. Before publication, recheck the artifact digests, readiness evidence, target set and release-note content. Publish the already verified final packages without rebuilding, modifying their embedded version, resolving dependencies or signing again. After the maintainer's approval the workflow copies the signed Linux packages to the `stable` zone, publishes the signed repository indexes, records the digest of the exact release body, makes the release public and creates the tag `v<version>` on the reserved commit. Git tags and release records identify the selected source and artifact set; they do not trigger an independent rebuild whose output silently replaces that set.

Serialize publication application-wide across all publication surfaces, including repository tags, GitHub release records, downloads and the package repositories. Atomically reserve each application version when admitting preparation, through the `reserved/v<version>` tag, and bind it permanently to one candidate and its source/inputs; a failed, cancelled or rejected candidate consumes that version even if it stayed internal, and its correction raises the version in source. Reject reassignment to another candidate. An idempotent continuation may finish the same preparation using its retained files and fixed inputs, but cannot replace an already identified final package. Otherwise select a new version and candidate.

Upload and verify the complete required asset set before exposing a public release or publishing its repository indexes; a signed index is written after the packages it names. Preserve the previous supported stable selection until the replacement is ready. A partial upload, failed index publication or uncertain activation is an incomplete operation, not a successful release.

Retries reconcile the actual publication state and use the same candidate, version and digests. They may finish missing uploads or metadata operations, but cannot substitute different bytes. Record which publication surfaces became visible if activation only partially succeeded, halt the remaining promotion steps and require a maintainer to reconcile them. Never report complete publication while any required surface is unresolved.

### Retained artifacts and provenance

Retained qualification and candidate artifacts on every platform carry verified GitHub build provenance bound to the exact source, admitted workflow, run/attempt, target and final bytes, with an authenticated transformation record when native signing changes the build output. This is independent of Developer ID, Authenticode and RPM signing; an attestation is not publisher trust or permission to release. Candidate packages are stored in the unpublished GitHub Release rather than as Actions artifacts, which are public in this repository and expire. Review publicly visible provenance/log metadata separately; the `test` zone is publicly reachable and is not a privacy boundary.

## Version and compatibility semantics

Use the coordinated application release and SemVer contract selected by [ADR-0021](adr/adr-0021-versioned-desktop-artifacts.md). Internal packages bundled only with the application do not acquire independent public releases merely because they occupy different workspace directories. Schema and stored-format versions remain separate from the application version.

The application version lives only in the root `package.json`; the workspace packages under `packages/` stay at `0.0.0`. A pull request raises the version immediately before a release is prepared, and between releases `main` keeps the last prepared version.

The application's public compatibility surface includes supported user workflows, retained research and manuscript formats, installation/update requirements and explicitly published extension or adapter contracts. Declare supported platforms and compatibility limits with each release. An application version number does not establish that every older schema can be opened or restored.

For stable application versions at or above `1.0.0`, increase the patch for compatible corrections, the minor for compatible capabilities or deprecations and the major for incompatible changes to that declared public surface. During `0.x` development, use a minor increase for new capabilities, deprecations or incompatible changes and a patch increase for compatible corrections and refinements. Disclose incompatibilities and required actions in either phase; a major-zero version is not permission to conceal data or upgrade consequences. A supported automatic migration is not by itself a breaking change, but unsupported downgrade or changed interoperability must be explained.

Identify CI artifacts by source/tested tree, workflow run and attempt, target and digest. Executable CI packages use the development prerelease version `<version>-dev.<run>.<attempt>`, derived from the root version and unique to the run and attempt, such as the illustrative `0.4.0-dev.123.1`, and expose their source/build identity. They cannot impersonate a reserved final candidate or enter the `stable` repositories. Build metadata is not an ordering input.

Changing an embedded development version to a final version creates a different artifact. A CI package labelled `0.4.0-dev.123.1` therefore cannot become the final `0.4.0` package by renaming its download or release entry. A release package is always built again from the same commit with the exact version, and publication copies that candidate's exact bytes.

The permanent reservation applies from candidate admission, and each identified final package keeps its bytes for its target/package identity. Any correction, replacement rebuild or re-signing requires a new version and candidate. Rejected candidates leave acceptable version gaps even when no package reached testers; do not recycle their versions. Different supported targets naturally have different packages and digests within the same coordinated version.

## Readiness, cadence and maintenance

Before the first stable release, require a coherent, useful and supported user journey. Internal scaffolding deliveries and incomplete capabilities can be tested without being advertised as a usable research release. Do not tie the first public version to an arbitrary issue count or epic boundary.

Once a stable channel is in use, assess release readiness every two weeks. This is a review cadence, not a mandatory publication schedule or permission to bypass readiness. Publish when the accumulated change is useful and validated; defer when it is not. Urgent security, data-integrity or severe usability corrections may ship between reviews through the same candidate, verification and authorization requirements.

Every stable candidate satisfies the mandatory engineering, integrity and data-protection gates below. Incomplete capabilities remain in internal quality testing or behind reviewed, tested boundaries rather than becoming publicly advertised features. Disclosed non-blocking limitations may remain; a failed mandatory requirement cannot be waived by a label.

A ready candidate satisfies all of the following:

- Its declared user capabilities are usable, and unfinished work is excluded from the public path through reviewed, tested boundaries.
- The coordinated supported OS/CPU/package matrix has complete successful evidence for required builds, final packaged smoke tests and applicable native journeys.
- Installation, upgrades from supported baselines, interrupted update behavior, schema admission/recovery and any claimed compatible rollback path have the applicable evidence required by ADR-0021 and ADR-0010.
- Required signatures, notarization, authenticity/integrity checks and bundled licenses/notices are verified on the delivered packages.
- Accepted defects affecting the candidate are corrected and verified; unresolved limitations are assessed for supported use and disclosed. A note about a failed mandatory requirement does not make it pass.
- Release notes match the actual included behavior and explain required actions, compatibility changes and consequential limitations.
- The maintainer has reviewed the evidence and explicitly authorized the intended distribution.

Urgent fixes use the same protected-main source-admission model as ordinary releases. Keep `main` releasable by excluding unfinished behavior through reviewed, tested boundaries, and verify the correction against the existing stable release. If the selected integrated source cannot meet readiness without exposing unrelated unfinished behavior, restore readiness through reviewed PRs before publication; urgency does not authorize an unprotected maintenance branch or a direct patch outside the integration rules. Supporting a separate maintenance line requires its own reviewed protection, validation and source-admission policy. Each later product change extends the same pipeline's meaningful tests and change notes; a scaffold test does not prove a research journey added afterward.

## Change-note capture and editorial review

Every PR states whether it changes behavior relevant to installed users. For a relevant change, its description includes a proposed change note identifying the affected task, observable result, applicable platforms, availability and any compatibility or action requirement. Retain its issue/PR references as technical evidence. For changes without a public effect, explicitly state that no public note is needed and give the reason. Internal refactoring, routine CI maintenance and dependency updates without a user consequence need not become public bullets.

Classify relevant notes as a new capability, improvement, correction, deprecation/removal or security change. These classifications support collection; they do not require a separate public section for every category. A meaningful security update remains relevant even when its underlying dependency change is otherwise technical.

Collect the inputs with implementation while the context is available. `prepare-release.yml` writes the first notes text into the unpublished release body, assembled from the `ohtia-note` blocks of the included pull requests. For a stable candidate, reconcile the selected source difference and included PRs since the preceding stable release against the change-note inputs. For the first stable release, review the complete delivered user scope instead of assuming a previous release exists. Combine several implementation issues into a single capability description and remove duplicates. An unfinished capability's internal note does not become an announcement until that capability is actually available; retain its references for the eventual release.

Treat PR descriptions and proposed note text as untrusted data. Trusted assembly may parse and format them with reviewed tooling, but must not interpolate them into executable shell code, load PR-provided helpers or let them select publication authority. Preserve the CI trust boundary in ADR-0020.

Review both omissions and overclaims. A generated inventory is an editorial input, not publishable copy by default. Include important user consequences even if a PR omitted its note. Exclude a proposed benefit that has not been demonstrated, a feature absent from the candidate or a performance claim without applicable evidence. Clearly distinguish a tested correction from a remaining limitation.

Use a concise opening summary followed by task-oriented improvements and relevant corrections. Put required upgrade actions and compatibility warnings prominently before optional detail. Provide a separate technical-detail area or links for issue/PR references, developer contracts and component information. Preserve significant changes without making users read merge messages, identifiers or dependency inventories to discover their impact. This follows Keep a Changelog's distinction between a curated release history and a commit log.[^keep-a-changelog] The repository keeps no `CHANGELOG.md`; GitHub Releases is the only public change history.

The following is illustrative wording, not a claim that these capabilities exist:

> ### Resume your reading
>
> Reopening a source returns you to the page you were reading.
>
> ### Corrections
>
> Fixed a problem that could close the application when importing certain PDF files.

Always disclose required migration or reinstall actions, removed support, incompatible format or extension changes, consequential privacy/provider-transfer changes, relevant security urgency and important known limitations. Explain the user's action and consequence in plain language. Technical detail can expand the explanation without obscuring it. Repository change notes and public GitHub release bodies use English; translated interface presentations preserve the same meaning and important disclosures.

The maintainer edits the release notes directly in the unpublished release on GitHub; that edit is the editorial review of the public text. Publication records the digest of the exact release body. The sealed assemble, propose and approve chain of the [change-note tooling](change-notes.md) remains available as editorial evidence and does not gate the published release body. The published GitHub release body is the canonical public note for that version; an application or website presents that content rather than maintaining a separately authored history. Correcting public prose after publication without changing packages preserves artifact identity: it is a maintainer edit of the release body whose new digest is recorded. Never use a prose edit to disguise changed release bytes.

## Retention, withdrawal and recovery

CI artifacts have an explicit, bounded retention policy selected with the build environment; they are disposable review evidence rather than permanent release storage. Retain published packages, their candidate manifests, release notes and verification evidence for supported versions and the compatible baselines promised for update/recovery. Define the retention and retirement procedure before distribution, including what remains available after support ends. Removing a temporary CI artifact must not remove the only copy of a supported release.

A maintainer may withdraw a defective release from recommendations and update availability. The manual `withdraw-release.yml` workflow of [ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md) republishes the signed `stable` repository indexes without that version and marks its GitHub Release as a prerelease, so new installations and the update notice no longer offer it; installed systems are not downgraded and receive the correction as a higher version. Preserve its identity and explain the affected versions, consequences and safe next action. Withdrawn versions are not reused or silently replaced. Corrected packages receive a new version, and promoting a prior package requires fresh compatibility assessment and authorization.

Rollback of an executable does not downgrade or restore research data. A schema migration may prevent reopening with an older release; use the compatible recovery procedure owned by ADR-0010 and preserve research evidence. Do not promise that withdrawing a release or selecting an old installer undoes a migration.

## Scaffolding implementation handoff

The Desktop application foundation described in [System architecture](architecture.md#verification-and-subsequent-choices) and [Architecture decisions](architecture-decisions.md#desktop-foundation-boundary) is the future scaffolding epic, planned as EPIC-001; it owns constructing this delivery infrastructure. Its specification and stories must consume this policy and ADR-0021, with explicit acceptance criteria for the following outputs:

- Shared local/CI verification commands, trusted pinned environments, declared supported OS/CPU/package targets, native build dependencies and cross-platform quality builds with meaningful packaged smoke tests.
- Complete aggregate results and distinct evidence for PR, integrated source and final delivered artifacts, with conservative check selection if affected-scope optimization is introduced.
- Selection of all required platform installers and update mechanisms, full Linux signed qualification and common native build/provenance interfaces in the initial delivery, with actual macOS/Windows publisher-signed qualification assigned to their independently closable follow-up stories. Preserve exact dependency pins and reviewed policy changes; neither deferred platform becomes distribution eligible before its actual evidence passes.
- Trusted, explicitly invoked candidate preparation and publication operations, Linux signing in the protected `release-signing` environment, version reservation, complete manifests/digests, retained final artifacts and promotion without rebuilding.
- Isolation for every non-stable test executable, signed Linux package repositories with their `test` and `stable` zones, the application's update notice, installation and update refusal/recovery checks, application-wide publication serialization, permanent version reservations, partial-publication reconciliation, idempotent retries and withdrawal.
- Change-note capture and assembly, maintainer editing of the unpublished release body with its recorded digest and consistent public presentation, together with retention and retirement rules.

Implement and verify the infrastructure through that epic rather than postponing the pipeline to a separate launch epic. The common and Linux release stories may complete their scope before the two independent macOS/Windows distribution stories; full EPIC/platform distribution obligations remain explicit. This staging does not require later interface work to wait for signing accounts, permit a public scaffold release or itself authorize a Linux-only public product. Product epics add the native journeys, compatibility fixtures and notes for their delivered behavior. Availability of credentials, providers or platform facilities is an enabling condition to demonstrate before claiming the affected guarantee; synthetic admission/failure tests do not establish an actual signed, installable public release. Keep public publication disabled until its applicable readiness evidence exists.

[^keep-a-changelog]: Keep a Changelog recommends human-readable, curated entries for notable changes, grouped by type, and explains why commit-log dumps do not communicate release impact adequately.
