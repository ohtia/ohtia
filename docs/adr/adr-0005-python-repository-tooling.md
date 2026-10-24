---
type: DecisionRecord
title: "ADR-0005 — Isolated Python tooling for repository maintenance"
description: "Use CPython, uv, Ruff and Pyrefly for developer tooling without making Python an installed-product dependency."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: uv
    resource: "https://docs.astral.sh/uv/concepts/projects/workspaces/"
    title: "uv — Workspaces"
  - id: types
    resource: "https://pyrefly.org/en/docs/configuration/"
    title: "Pyrefly — Configuration"
---

# ADR-0005 — Isolated Python tooling for repository maintenance

## Context

Repository policy scripts and validation tools already use Python. Their developer runtime is distinct from the TypeScript application and should not become a reason to package an interpreter for researchers. Mixed tool installations can still make local checks diverge from CI. Poetry is a valid environment alternative, and mypy, Pyright and ty are valid type-checking alternatives; retain one common tooling selection rather than combining checkers or claiming an unmeasured performance advantage.

## Decision

Use conventional CPython `3.14.*` with GIL for development/CI, keeping the exact patch in execution configuration. Preserve the documented supported minimum of an existing standalone script unless an explicit compatibility change is made. This decision does not silently raise that script's minimum or change an existing workflow pin.

Use uv `0.13.*` for managed developer environments/dependencies, Ruff `0.17.*` for lint/format and Pyrefly `1.4.*` as the Python type checker when the tooling environment is introduced. Keep one lockfile for managed third-party tooling, frozen CI installs and environments isolated per checkout. Do not create empty product Python packages or require third-party packages for scripts that deliberately use only the standard library.[^uv][^types]

Type own tooling explicitly, isolate untyped boundaries and keep suppressions local and justified. Align duplicate Ruff/formatter pins in hooks and package commands. Introduce actual commands and their required checks together in the tooling delivery, preserving local/CI parity.

## Consequences

Python remains useful for maintenance without another product runtime. Maintain tool compatibility and test effective interpreters rather than inferring them from a configured default. Static types do not replace tests or external-data validation. A future Python product processor requires its own runtime and packaging decision.

[^uv]: uv supports shared resolutions; Ohtia uses a workspace only when actual packages justify one.

[^types]: Pyrefly provides explicit project configuration; the strict diagnostic policy is an Ohtia requirement.
