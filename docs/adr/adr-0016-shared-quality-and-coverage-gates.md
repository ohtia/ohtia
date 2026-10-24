---
type: DecisionRecord
title: "ADR-0016 — Shared quality commands and per-package coverage"
description: "Run the same required checks locally and in CI with explicit coverage and behavioral acceptance gates."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0016 — Shared quality commands and per-package coverage

## Context

Duplicated validation logic can pass locally and fail in CI. Repository averages can conceal a product package with no meaningful tests, while a percentage alone cannot prove recovery or authorization. Alternatives are aggregate repository thresholds, changed-lines-only coverage, a universal 100% minimum or behavior checks without coverage. Aggregate/diff-only gates leave neglected existing packages invisible; 100% encourages disproportionate tests for low-value branches without establishing the required behavior. Per-package 80% line/branch and 90% changed-line floors combine a maintained baseline with stronger scrutiny of new work, while explicit behavior cases remain mandatory. These are reviewable policy choices, not measured optimal thresholds.

## Decision

Each implemented package exposes appropriate format-check, lint, types, tests and build commands. A versioned repository entry point coordinates them and document validation; CI invokes the same entries rather than reimplementing the logic. Introduce commands with the components they check. Existing scaffold commands remain valid until an issue delivers their replacements.

Each product package must independently reach at least 80% executable-line coverage, 80% branch coverage and 90% coverage of executable lines added/modified by the PR. Do not average packages or combine line and branch totals. Include own unimported code; exclude tests, fixtures, generated and third-party code, with any additional exclusion explicitly reviewed. No per-file minimum is imposed. Pure tooling/configuration uses its meaningful behavior/policy checks rather than acquiring a product percentage by accident.

Local and CI use the same denominator, configuration and declared diff base. No changed executable lines means the diff metric is inapplicable, not a fabricated 100%. Missing/invalid reports fail the gate. Required behavior cases include scoped authority, provider restrictions, idempotency, concurrent saves, migration/recovery, cancellation and format fidelity as applicable. Skipped, cancelled, expected-failure or failed mandatory cases cannot become a passing delivery.

Affected-scope optimization must include consumers and fall back to complete relevant checks when uncertain. The final aggregate fails if preparation or any required partition did not complete successfully; a log containing a failed phase with exit zero is not valid success.

## Consequences

The contract makes omissions visible and requires report validation, instrumentation and meaningful assertions. Test the gates with independently failing line/branch/diff metrics, unimported code, missing tests and incomplete shards. Do not add tests that merely mirror reversible prose edits or implementation internals to inflate coverage.
