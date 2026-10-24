---
type: DecisionRecord
title: "ADR-0021 — Versioned immutable desktop artifacts"
description: "Trace each desktop release to its source, locked components and final signed package without rebuilding during promotion."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: semver
    resource: "https://semver.org/"
    title: "Semantic Versioning 2.0.0"
---

# ADR-0021 — Versioned immutable desktop artifacts

## Context

Rebuilding after testing can change dependencies or bytes. Independent package versions are useful only for components with a real independent publication contract; internal folders do not justify separate releases. Desktop signing and packaging add transformations that must be included in artifact identity. Rebuilding independently for each channel is simpler to automate but allows an untested dependency or packaging difference during promotion; promoting the final verified bytes keeps the tested identity intact. Giving every internal package an independent release would add compatibility and publication work without a separate consumer contract, so the app uses one coordinated release unless a component is actually distributed independently.

## Decision

Use SemVer `2.0.0` for independently published units with defined public compatibility contracts. The installed app has a coordinated release containing identified compatible component versions. Internal modules bundled only with that app do not require independent public versioning; independently distributed adapters/libraries can have it when their contracts justify it.[^semver]

Record app/component version, source commit, lockfiles, build tools, target OS/CPU, schema compatibility and final artifact digest. Complete required signing/notarization/package transformations before identifying the final release bytes; verify the signed artifact as delivered. Promote those exact bytes between release channels without rebuilding or resolving dependencies. Never reuse a published version for different bytes.

Keep machine-specific paths, connections and secrets outside release artifacts. Update admission validates authenticity, integrity, target and compatible schemas/queued work. Rollback chooses a compatible prior artifact; it does not automatically downgrade or restore the database. [ADR-0010](adr-0010-pre-migration-recovery.md) owns only the internal pre-migration recovery path.

Select platform installers, signing and update mechanisms with their delivery evidence, including Linux. Record bundled-component licenses and required notices/source obligations; an MIT source repository does not relicense dependencies.

## Consequences

Release identity supports incident diagnosis and reproducibility but requires artifact retention and compatibility checks. Exercise installation, update interruption and rollback on the supported matrix. A signed package establishes origin/integrity, not semantic correctness, accessibility or data recovery.

[^semver]: SemVer describes compatibility versions; Ohtia defines each unit's public surface and coordinated desktop publication.
