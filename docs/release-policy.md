---
type: Specification
title: "Desktop builds, releases and change notes"
description: "Quality-build triggers, immutable release promotion, public versioning and user-facing change communication."
generated:
  by: codex/gpt-6.1-sol
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

This policy owns build and publication triggers, release readiness, channels, application version semantics and change communication. [ADR-0021](adr/adr-0021-versioned-desktop-artifacts.md) owns coordinated versioning and final artifact identity. [ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md) and [Repository policy](repository-policy.md) own CI trust and repository administration; [ADR-0010](adr/adr-0010-pre-migration-recovery.md) owns pre-migration recovery. Preserve those contracts rather than treating release automation as an alternative implementation.

Describe changes through research activities and understandable consequences, following [PRIN-011](product-definition.md#prin-011-keep-technology-behind-the-task). Protect retained research and explain consequential compatibility changes, following [PRIN-013](product-definition.md#prin-013-preserve-the-process). Report actual validation scope and uncertainty under [PRIN-006](product-definition.md#prin-006-expose-uncertainty) and [PRIN-007](product-definition.md#prin-007-declare-coverage).

## Quality builds and distribution

A quality build is evidence about identified source and artifacts. It is not a public release, an announcement or permission to change an update feed. Successful compilation and packaging do not establish successful installation, native behavior, update compatibility or research-data recovery.

Distinguish temporary quality artifacts from the two distribution channels:

- **CI artifacts:** temporary packages and reports attached to an identified PR or integrated commit, for contributor review and internal quality work. They do not enter the public updater or create a public release entry.
- **Preview:** an optional, explicitly selected distribution channel for people testing changes before stable availability. Every distributed preview is identified and its limitations are disclosed. Preview access does not require an Ohtia account. A public preview is a publication requiring maintainer authorization, not an automatic consequence of a successful CI job.
- **Stable:** the default public distribution channel for supported, usable capabilities. Only an approved final candidate enters this channel.

A release candidate is a validation state of a particular artifact set, not an additional required public channel. Final candidates can remain internal or be offered to explicitly participating preview testers. Development previews may contain prerelease versions; final candidates carry their intended stable version before final packaging and verification.

Every CI/development executable, internal final candidate and preview installation runs with isolated application data. Automated and maintainer-run tests use only synthetic or permitted public material, following [ADR-0017](adr/adr-0017-real-boundary-integration-tests.md). A preview user may explicitly choose an independently isolated copy of their own research for personal testing; that permission does not admit private research or developer credential copies into CI or external evaluations. CI/development packages neither publish to nor consume public update feeds.

For exact-byte final candidates, use a separate OS user profile or VM whose native configuration and research store are independent of the stable installation. Preserve [ADR-0036](adr/adr-0036-application-preferences-and-bootstrap.md) and the architecture's fixed bootstrap-locator contract rather than silently redirecting it. Installing two executables side by side does not establish isolation, and a compiled channel name is not the isolation mechanism. Channel eligibility belongs to maintainer-controlled distribution metadata outside the package, so the same final bytes can be tested in the isolated environment and later offered to stable users. Never silently open or migrate a stable research store from a non-stable test installation. Returning to stable does not imply that an older executable can read a newer schema or that data will be downgraded automatically.

## Triggers

### Pull requests

Creating or updating a PR targeting `main` triggers the shared checks applicable to its changes and consumers. Changes affecting application code, assets, native dependencies, lockfiles, runtime configuration, packaging or build tooling require quality builds and the applicable packaged smoke tests across the declared Windows, macOS and Linux OS/CPU matrix. Verify actual native execution on the targets it claims to cover; cross-compilation alone is not that evidence.

Apply [ADR-0016](adr/adr-0016-shared-quality-and-coverage-gates.md) and [ADR-0018](adr/adr-0018-vitest-and-playwright-desktop-tests.md) to affected-scope selection, complete result accounting and runtime coverage. Documentation-only changes may omit desktop builds when they cannot affect the delivered application or its build inputs, while retaining documentation and repository checks. An uncertain impact requires the complete relevant checks. Keep the stable aggregate `ci` result and reviewed check inventory consistent with the selected partitions.

PR execution produces review artifacts without signing, notarization or publication credentials. It cannot authorize a release or promote its own output into trusted execution. A trusted candidate build uses reviewed configuration and source admitted through the repository's review and integration rules.

### Integration into main

A push to `main` triggers the applicable shared checks and desktop quality builds for the actual integrated source. Preserve their commit, tested tree, target and run identity. PR evidence about a synthetic merge does not replace validation of a different integrated revision. Main-branch builds remain quality artifacts unless separately admitted for candidate preparation.

Nightly jobs may later run longer regression suites when justified by measured coverage or cost. They supplement the required integration gates, do not publish automatically and do not replace a mandatory per-change check.

### Candidate preparation

Candidate preparation uses a manually invoked GitHub Actions `workflow_dispatch` entry point. Both preparation and publication execute their workflow definitions from protected `main`; reject a dispatch that selects another branch or tag as the workflow ref. Record and verify the immutable workflow-definition revision separately from the application source. Enforce workflow-ref admission, verification-policy selection and the binding of signing/publication authority through controls that the dispatched definition cannot modify, and qualify those controls before enabling privileged execution; a guard or credential restriction declared only inside that same definition is insufficient. A maintainer selects an exact reviewed application commit already integrated into protected `main` through the repository's PR and required-check rules, together with a reserved application version. Resolve mutable names before building; subsequent branch movement cannot change the selected source or execution evidence. A passed quality build is a prerequisite, not publication authorization. A clock, issue closure, merge or commit type cannot select and publish a candidate by itself.

Assemble the full declared target set from frozen dependencies and identified toolchains. Complete all installer, signing, notarization and package transformations before recording final digests and running final artifact verification. Include the source and component identities, lockfiles, tool versions, target OS/CPU and package format, schema compatibility, required license material, workflow-definition revision, build run/attempt, final digests, validation evidence and reviewed release notes in the candidate record.

Record the candidate independently of a moving `main` head. Superseding it requires a new explicit selection; do not replace its files in place. Failed, cancelled, incomplete or unreadable required target evidence prevents readiness. A candidate's existence or a signature on one installer is not evidence that the coordinated target set passed.

### Public publication and promotion

Publication uses a separate manually invoked GitHub Actions `workflow_dispatch` entry point. A maintainer explicitly authorizes an identified, ready candidate and its reviewed notes for the preview or stable channel. Authorization identifies the version, source, candidate, targets, note identity and channel; generic approval of a PR, issue or CI execution does not imply it. An environment approval may serve as that authorization when it presents and records those exact identities for maintainer review; a generic permission to run a workflow cannot. Keep preparation and publication as separate operations. Release tooling may propose a version or assemble notes, but cannot infer authorization from Conventional Commits.

Before publication, recheck the artifact digests, readiness evidence, target set, release-note content and selected channel. Publish the already verified final packages without rebuilding, modifying their embedded version, resolving dependencies or signing again. Git tags and release records identify the selected source and artifact set; they do not trigger an independent rebuild whose output silently replaces that set.

Serialize publication application-wide across both channels and all publication surfaces, including repository tags, GitHub release records, downloads and update feeds. Preview and stable operations must not race over shared version, tag or latest-release state. Preview publication does not advance the stable latest-release selection. Atomically reserve each application version when admitting preparation and bind it permanently to one candidate and its source/inputs; a failed, cancelled or rejected candidate consumes that version even if it stayed internal. Reject reassignment to another candidate. An idempotent continuation may finish the same preparation using its retained files and fixed inputs, but cannot replace an already identified final package. Otherwise select a new version and candidate.

Upload and verify the complete required asset set before exposing a public release or activating its update metadata. Preserve the previous supported stable selection until the replacement is ready. A partial upload, failed feed update or uncertain activation is an incomplete operation, not a successful release.

Retries reconcile the actual publication state and use the same candidate, version and digests. They may finish missing uploads or metadata operations, but cannot substitute different bytes. Record which publication surfaces became visible if activation only partially succeeded, halt the remaining promotion steps and require a maintainer to reconcile them. Never report complete publication while any required surface is unresolved.

## Version and compatibility semantics

Use the coordinated application release and SemVer contract selected by [ADR-0021](adr/adr-0021-versioned-desktop-artifacts.md). Internal packages bundled only with the application do not acquire independent public releases merely because they occupy different workspace directories. Schema and stored-format versions remain separate from the application version.

The application's public compatibility surface includes supported user workflows, retained research and manuscript formats, installation/update requirements and explicitly published extension or adapter contracts. Declare supported platforms and compatibility limits with each release. An application version number does not establish that every older schema can be opened or restored.

For stable application versions at or above `1.0.0`, increase the patch for compatible corrections, the minor for compatible capabilities or deprecations and the major for incompatible changes to that declared public surface. During `0.x` development, use a minor increase for new capabilities, deprecations or incompatible changes and a patch increase for compatible corrections and refinements. Disclose incompatibilities and required actions in either phase; a major-zero version is not permission to conceal data or upgrade consequences. A supported automatic migration is not by itself a breaking change, but unsupported downgrade or changed interoperability must be explained.

Identify CI artifacts by source/tested tree, workflow run and attempt, target and digest. Executable CI packages use a development prerelease version unique to the run and attempt, such as the illustrative `0.4.0-dev.123.1`, and expose their source/build identity. They cannot impersonate a reserved final candidate or enter preview/stable update feeds. Distributed development previews use their own unique prerelease versions, such as the illustrative `0.4.0-beta.1`. Build metadata alone does not define an ordered preview update sequence; the selected updater must demonstrate correct version and channel ordering before it is enabled.

Changing an embedded prerelease version to a stable version creates a different artifact. A preview package labelled `0.4.0-beta.1` therefore cannot become the final `0.4.0` package by renaming its download or release entry. Prepare and verify a new final candidate carrying `0.4.0`, then promote that candidate's exact bytes. If a candidate already carries its final version, changing only its external channel eligibility may promote the same bytes.

The permanent reservation applies from candidate admission, and each identified final package keeps its bytes for its target/package identity. Any correction, replacement rebuild or re-signing requires a new version and candidate. Rejected candidates leave acceptable version gaps even when no package reached testers; do not recycle their versions. Different supported targets naturally have different packages and digests within the same coordinated version.

## Readiness, cadence and maintenance

Before the first stable release, require a coherent, useful and supported user journey. Internal scaffolding deliveries and incomplete capabilities can be tested without being advertised as a usable research release. Do not tie the first public version to an arbitrary issue count or epic boundary.

Once a stable channel is in use, assess release readiness every two weeks. This is a review cadence, not a mandatory publication schedule or permission to bypass readiness. Publish when the accumulated change is useful and validated; defer when it is not. Urgent security, data-integrity or severe usability corrections may ship between reviews through the same candidate, verification and authorization requirements.

Every public preview and stable candidate satisfies the same mandatory engineering, integrity and data-protection gates below. Preview adds explicit opt-in and limited real-use exposure before stable availability; it does not waive signing, isolation or required behavior checks. Incomplete capabilities remain in internal quality testing or behind reviewed, tested boundaries rather than becoming publicly advertised preview features. Disclosed non-blocking limitations may remain in either channel; a failed mandatory requirement cannot be waived by a preview label.

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

Collect the inputs with implementation while the context is available. For a stable candidate, reconcile the selected source difference and included PRs since the preceding stable release against the change-note inputs. For the first stable release, review the complete delivered user scope instead of assuming a previous release exists. Stable notes include changes previously offered only in preview. Preview notes describe the difference from the preceding published preview for the same intended stable release, or the full preview scope when that baseline does not exist; identify that baseline explicitly. Combine several implementation issues into a single capability description and remove duplicates. An unfinished capability's internal note does not become an announcement until that capability is actually available; retain its references for the eventual release.

Treat PR descriptions and proposed note text as untrusted data. Trusted assembly may parse and format them with reviewed tooling, but must not interpolate them into executable shell code, load PR-provided helpers or let them select publication authority. Preserve the CI trust boundary in ADR-0020.

Review both omissions and overclaims. A generated inventory is an editorial input, not publishable copy by default. Include important user consequences even if a PR omitted its note. Exclude a proposed benefit that has not been demonstrated, a feature absent from the candidate or a performance claim without applicable evidence. Clearly distinguish a tested correction from a remaining limitation.

Use a concise opening summary followed by task-oriented improvements and relevant corrections. Put required upgrade actions and compatibility warnings prominently before optional detail. Provide a separate technical-detail area or links for issue/PR references, developer contracts and component information. Preserve significant changes without making users read merge messages, identifiers or dependency inventories to discover their impact. This follows Keep a Changelog's distinction between a curated release history and a commit log.[^keep-a-changelog]

The following is illustrative wording, not a claim that these capabilities exist:

> ### Resume your reading
>
> Reopening a source returns you to the page you were reading.
>
> ### Corrections
>
> Fixed a problem that could close the application when importing certain PDF files.

Always disclose required migration or reinstall actions, removed support, incompatible format or extension changes, consequential privacy/provider-transfer changes, relevant security urgency and important known limitations. Explain the user's action and consequence in plain language. Technical detail can expand the explanation without obscuring it. Repository change notes and public GitHub release bodies use English; translated interface presentations preserve the same meaning and important disclosures.

The candidate record retains the reviewed note content as immutable annotations bound to their channel, baseline and approval, separate from the fixed package/build-input identity. The published GitHub release body is the canonical public note for that version; an application or website presents that content rather than maintaining a separately authored history. Exact-byte preview-to-stable promotion attaches a newly reviewed stable note identity and explicitly authorizes replacing the canonical body with it under the same application version, while retaining the approved preview note in the release evidence. This is a recorded channel-promotion operation, not an unreviewed prose correction or a new artifact candidate. Required edits before publication invalidate the previous note approval. Correcting public prose without changing packages preserves artifact identity but requires a maintainer-reviewed correction whose before/after content, digests, reason and approval remain with the release evidence; GitHub body edit history is not the audit record. Never use a prose edit to disguise changed release bytes.

## Retention, withdrawal and recovery

CI artifacts have an explicit, bounded retention policy selected with the build environment; they are disposable review evidence rather than permanent release storage. Retain published packages, their candidate manifests, approved notes and verification evidence for supported versions and the compatible baselines promised for update/recovery. Define the retention and retirement procedure before distribution, including what remains available after support ends. Removing a temporary CI artifact must not remove the only copy of a supported release.

A maintainer may withdraw a defective release from recommendations and update admission. Preserve its identity and explain the affected versions, consequences and safe next action. Withdrawn versions are not reused or silently replaced. Corrected packages receive a new version, and promoting a prior package requires fresh compatibility assessment and authorization.

Rollback of an executable does not downgrade or restore research data. A schema migration may prevent reopening with an older release; use the compatible recovery procedure owned by ADR-0010 and preserve research evidence. Do not promise that changing channels, withdrawing a release or selecting an old installer undoes a migration.

## Scaffolding implementation handoff

The Desktop application foundation described in [System architecture](architecture.md#verification-and-subsequent-choices) and [Architecture decisions](architecture-decisions.md#desktop-foundation-boundary) is the future scaffolding epic, planned as EPIC-001; it owns constructing this delivery infrastructure. Its specification and stories must consume this policy and ADR-0021, with explicit acceptance criteria for the following outputs:

- Shared local/CI verification commands, trusted pinned environments, declared supported OS/CPU/package targets, native build dependencies and cross-platform quality builds with meaningful packaged smoke tests.
- Complete aggregate results and distinct evidence for PR, integrated source and final delivered artifacts, with conservative check selection if affected-scope optimization is introduced.
- Selection and qualification of installers, signing/notarization and update mechanisms for every supported platform, including Linux, with exact dependency pins and reviewed repository permission/allowlist changes.
- Trusted, explicitly invoked candidate preparation and publication operations, isolated signing authority, version reservation, complete manifests/digests, retained final artifacts and promotion without rebuilding.
- Isolation for every non-stable test executable, optional preview admission, ordered update/channel behavior, installation and update failure/recovery checks, application-wide publication serialization, permanent version reservations, partial-publication reconciliation, idempotent retries and withdrawal.
- Change-note capture and assembly, editorial review, candidate-bound approved notes and consistent public presentation, together with retention and retirement rules.

Implement and verify the infrastructure through that epic rather than postponing the pipeline to a separate launch epic. Product epics add the native journeys, compatibility fixtures and notes for their delivered behavior. Availability of credentials, providers or platform facilities is an enabling condition to demonstrate before claiming the affected guarantee; synthetic admission/failure tests do not establish an actual signed, installable public release. Keep public publication disabled until its applicable readiness evidence exists.

[^keep-a-changelog]: Keep a Changelog recommends human-readable, curated entries for notable changes, grouped by type, and explains why commit-log dumps do not communicate release impact adequately.
