---
type: DecisionRecord
title: ADR-0043 — Ordinary development and installed startup modes
description: Admit one of three explicit runtime modes, so that daily development and installed use need no qualification profile while qualification keeps every safeguard.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
---

# ADR-0043 — Ordinary development and installed startup modes

## Context

[SPEC-001-023](../epics/EPIC-001-desktop-foundation/epic.md#spec-001-023-isolation-before-the-first-development-executable) required an independent OS account or VM before any development launch, in order to protect the data of a stable installation. The launcher, main and utility enforced this with a qualification profile and stable fixtures, whose declarations such as `independent_account_or_vm` and `no_credentials` are false for an ordinary account. A developer could not open the application during daily work.

The same check ran in packaged bytes. The [release policy](../release-policy.md) requires that the bytes tested in isolation can later be offered to stable users, and those bytes could not start without a fixture. A graphical first install and an installed updater could not work.

The alternatives were to keep the rule and develop in a second account or VM, to add an environment override of the data location to every build, and to build separate development and final bytes. A second account adds friction to every change. A general override contradicts the OS-derived root in the [architecture](../architecture.md#application-preferences-and-bootstrap). Separate bytes contradict the exact-byte promotion in [ADR-0021](adr-0021-versioned-desktop-artifacts.md).

## Decision

Main and utility admit exactly one mode:

- **`qualification`**, when `OHTIA_RUNTIME_PROFILE` is not empty. It keeps the profile contract, stable sentinels and native boundary check, and it refuses on any failure with no fallback.
- **`development`**, otherwise, when `app.isPackaged` is false. It uses `<checkout>/.ohtia-dev/configuration` and `<checkout>/.ohtia-dev/research`. The launcher, main and utility each refuse a root that is not canonical and owned, lacks a valid `instance.json`, or overlaps the native `<home>/ohtia` or native `Ohtia` configuration directory.
- **`installed`**, otherwise. It takes no redirection input. Paths come from Electron and the OS, and the research root is created only on explicit opening.

This replaces the requirement that every development launch uses an independent account or VM. The independent profile remains required for qualification, CI, internal candidates and previews, as a documented procedure for the last two.

All modes keep Electron sandboxing, context isolation, CSP, denied permissions, bounded IPC, the `NODE_OPTIONS` refusal, the single-instance lock and bounded shutdown. `OHTIA_RUNTIME_ACCEPTANCE` works in all modes so that the same bytes can be observed. This adds no capability, because a process in the same account can already write a profile and enable it, and SPEC-001-023 excludes defense from an equivalent-privilege actor.

## Consequences

A defect in the development path guard could reach an installed application's data on the same machine. The guard prevents accidents, not a deliberate actor.

Internal candidates, previews and `ohtia-quality` packages no longer refuse to start in an ordinary account, where they use `~/ohtia`. The application cannot detect them without changing final bytes.

Developers can run any desktop without a qualified route. That is not qualification, and an unqualified desktop is reported only when startup actually fails.
