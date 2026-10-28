---
type: Playbook
title: Shared verification and coverage gates
description: Run the same local and CI checks with independent product coverage, complete test inventories and separate native evidence.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Shared verification and coverage gates

## Commands and ownership

The [shared verification story](epics/EPIC-001-desktop-foundation/STORY-001-007-enforce-shared-verification-and-coverage-gates.md) implements the [quality decision](adr/adr-0016-shared-quality-and-coverage-gates.md) and [runtime test decision](adr/adr-0018-vitest-and-playwright-desktop-tests.md). Provenance and honest coverage follow PRIN-004–007 and PRIN-016 in the [product definition](product-definition.md#product-principles). A synthetic gate fixture proves rejection behavior; it does not certify a native platform, linguistic quality or assistive usability.

Start in an isolated task worktree with the [frozen developer workspace](developer-workspace.md#bootstrap-and-frozen-setup). No global JavaScript tools or user credentials are required. The [CI workflow](../.github/workflows/ci.yml) uses the same managed setup and commands as local execution, without affected-path optimization or documentation-only build omissions.

```bash
python3 scripts/workspace.py setup
python3 scripts/workspace.py run check
python3 scripts/workspace.py run hooks
python3 scripts/workspace.py run hooks:history
git diff --check
```

`check` runs type checking, semantic product lint and tooling lint, formatting, the complete test aggregate and the build in that order. `test` compiles inputs, discovers the exact declared Vitest cases, instruments all product sources, runs the Playwright tooling contract inventory, checks catalog structure and coverage, and retains the Python repository/policy behavior suite. Any failed command stops the entry with a nonzero exit. Missing or invalid inventory, preparation, report or mandatory result cannot yield success even if its producing process exits zero. Run entries that regenerate package outputs sequentially.

Each product package exposes its compiler build/type entries and forwards `lint`, `format:check` and `test` to the same repository coordinator. Those entries conservatively check the complete relevant graph, including consumers and shared inputs; selecting a package does not remove another package from the required aggregate.

The existing repository hooks and committed-history secret scan remain required. CI skips only the local branch guard and staged-file scanner, then runs the history scanner. Its stable required result remains `ci`; no new action, token permission or repository administrative authority is needed. The [workflow verification inventory](../config/github/ci-verification.json) is reviewed with the workflow. [Repository policy](repository-policy.md#pre-merge-ci-provenance) defines independent live policy and CI admission; local results do not establish hosted CI or human integration.

Update the case registry only for an intentional test-inventory change, after declaring any added/removed files in the quality inventory:

```bash
python3 scripts/workspace.py run quality:cases
```

Review the resulting registry diff with the test change. The normal checks never rewrite this registry.

## Coverage denominator and diff base

Every real package under `packages/` is a product package. Coverage includes its authored JavaScript/TypeScript modules under `src/`, including entrypoints, migration code and unimported code. Vitest instruments source modules through a test-only public-package source projection, lowering optional chaining and logical assignment into observable conditional branches with composed source maps; the normal compiler, public dependency graph and assembled build remain separately checked. Test code, fixtures, repository tooling, third-party dependencies and compiler outputs are outside the product denominator. Declaration files and the exact generated resource-policy projection are excluded explicitly; no entire product directory is exempted. Own source-level coverage-ignore directives fail validation.

The canonical executable-line denominator is the union of statement-start source lines in the pinned Istanbul report, with the maximum statement hit on a shared line. Branches count every reported alternative independently, including implicit else alternatives. Source-mapped end columns serialized as `null` and the instrumenter's empty implicit-else location are admitted without dropping their counters. An independent no-test instrumentation pass generates the complete zero-hit statement/function/branch maps before the required test run; the aggregate requires those maps to match exactly, so a nonempty but partial file report cannot reduce a denominator. This instrumentation pass is not a test partition and contributes no passing cases or execution hits. Pure type/reexport modules may have no executable counters; an omitted own executable module, malformed counter, map/counter disagreement or unexpected source fails. Each package independently requires at least 80% executable lines and 80% branch alternatives; another package or another dimension cannot compensate. There is no per-file floor and no product percentage for pure tooling.

Changed executable source lines independently require 90% coverage in each package. Added/modified lines are taken from the declared base to the actual working files, including staged edits, unstaged edits and new files. Deleted lines are not in the candidate denominator. Changed executable tokens come from the parsed syntax tree and retain intersecting raw statement, function and branch execution regions, so changing the middle of an array or literal cannot silently make the metric inapplicable. Type-only lines, comments and standalone closing delimiters have no executable diff denominator. An enclosing initializer hit cannot cover an uncalled function, unentered loop/catch body or unexecuted ternary/short-circuit alternative. A changed line must cover all intersecting execution regions, including statements sharing a source line. Regular expressions and template literals use parsed tokens rather than an independent slash scanner. A changed line containing several alternatives requires their intersecting branch evidence; this conservative rule does not lower the independent package branch denominator. Git colour is disabled and textual source hunks are forced explicitly so colour or binary attributes cannot hide changes; unexplained non-hunk content differences fail closed. A zero denominator reports `inapplicable` with `percent: null`; an uncovered executable change reports a failed applicable metric.

Local execution defaults to the immutable merge base of `HEAD` and `origin/main`. Fetch the current base before validation. Supply a full ancestor commit SHA to reproduce another reviewed base:

```bash
python3 scripts/workspace.py run test <full-base-commit-sha>
```

CI pull requests use the event's base SHA against the tested merge checkout. Pushes use the event's `before` SHA. A missing, unavailable, malformed, zero or nonancestor base fails instead of falling back to a smaller diff. Keep history available, as the workflow does with its full-depth checkout. A base advance, source change or dependency change requires fresh affected evidence.

## Inventories and reports

[The committed case registry](../config/quality/cases.json) lists the exact Vitest, Playwright and Python case identifiers independently of runtime discovery. Deleted or conditionally unregistered cases fail even when every remaining case passes. [The quality inventory](../config/quality/inventory.json) declares the exact Vitest, Playwright and Python files, all 25 product locales, the separate portable browser engines and other evidence classes. Adding/removing a suite requires updating this file. Runtime discovery expands parameterized Vitest cases before execution. Case identities retain file, complete suite name and occurrence index; equal displayed parameter names do not collapse distinct cases. The committed registry, read-only discovery and run must agree exactly. Explicit case/OS applicability declarations remain separate from registration; mandatory cases cannot disappear through conditional registration. Playwright discovery and execution similarly match file, project and case identity. The tooling project runs assertion/adapter contracts once; it supplies no DOM-engine or Electron execution claim.

The shard API sorts case identifiers and assigns them by index modulo shard count. Required partitions have a disjoint union equal to the complete case inventory. Each result binds to the same run identity and must have successful preparation and execution, each required case exactly once and one passing attempt. Missing/duplicate/extra shards or cases, skipped/cancelled/pending/failed cases, expected failures, retries and stale identities fail. The Python reporter discovers its complete case set and permits only the case/OS applicability exclusions explicitly listed in the quality inventory. A skip introduced inside a mandatory case, expected failure, subtest failure, preparation error or missing case fails the aggregate. Platform exclusions identify POSIX/Linux tooling behavior and cannot stand in for native acceptance on another OS. The common local runner uses one shard per runtime; consumers can extend the deterministic accounting without making expensive required partitions optional.

Reports are recreated under ignored `.reports/quality/`. `identity.json` records the run identifier, immutable base, current HEAD, tested source-content digest, workflow digest and hosted run/attempt when present. `result.json` starts as failed/pending and becomes successful only after the required producer reports and coverage validate. `vitest-inventory.json`, `vitest-accounting.json`, `playwright-inventory.json`, `playwright.json`, the Istanbul `coverage/coverage-final.json` and `coverage-result.json` retain the inputs and independent decisions. `denominator/coverage-final.json` and `denominator-run.json` retain the independent zero-execution maps; source hashes must remain identical through the run. Missing/invalid JSON and duplicate JSON keys fail. Do not reuse a partial directory as evidence of a new successful run.

The workflow also preserves its checkout provenance receipt with repository, event, workflow run/attempt, PR head/base, GitHub SHA, checkout commit and tested Git tree. A green name alone proves neither that provenance nor administrative enforcement. The trusted pre-merge verifier matches the exact reviewed workflow and inventory bytes, required steps and current candidate provenance under [Repository policy](repository-policy.md#pre-merge-ci-provenance).

## Catalog failure gates

The delivered catalog service has a stable message-key inventory and currently declares no interpolation parameters. Every required locale must contain its full catalog and match its own version/locale identity. Runtime locale resolution cannot fill missing keys. The gate compares the product locale inventory with the independently versioned quality inventory, then validates every message against its parameter/form contract.

The reusable validator parses ICU syntax and checks named parameter types (`string`, `number` and `date`), required plural/select forms, select options, locale-valid plural categories and an `other` branch. It rejects missing/extra keys and parameters, conflicting types, invalid syntax, unsupported markup and undeclared forms. Synthetic English/Korean fixtures exercise parameter, plural and select failures without adding a second product message runtime. Locale-specific plural alternatives need not imitate English. Other-only forms are permitted for invariant wording; syntax checks do not judge singular/plural word choice. Structural acceptance does not certify the translation's meaning, naturalness or human review.

## Native and browser evidence

Inspect the complete required native partition inventory with the managed entry:

```bash
python3 scripts/workspace.py run quality:inventory
python3 scripts/workspace.py run quality:native <identity.json> <reports.json>
```

The [target manifest](../config/desktop/targets.json) retains all six OS/CPU candidates. Required native targets are Linux x64/ARM64, Windows x64 and macOS ARM64; Windows ARM64 and macOS Intel remain explicit optional extensions. `included_optional_targets` selects any optional extension actually delivered, which then needs its complete native evidence. Every Linux distribution/display/filesystem profile and required macOS major remains a distinct cell. Package grouping or a universal macOS artifact cannot remove either selected CPU slice.

Windows/macOS filesystem and package-format partitions come from the target manifest; unsupported Windows baseline changes fail until their release profiles are modelled. Each selected cell has separate smoke, storage, runtime and manual assistive partitions. The harness declares their minimum behavior identifiers; consuming delivery owners supply and extend real case inventories and observations. Native result records must match the exact partition, target, OS, CPU, profile and package format; retain the shared source/run identity, artifact SHA-256, successful preparation, exact required cases and passing results. Host and process architectures must match, execution must be native and emulation must be false. The native command rechecks the current HEAD, declared base, source digest and workflow digest; a self-consistent report set from another checkout is rejected. Manual assistive results additionally identify the actual operator and tool. These declarations are checked accounting inputs, not authentication of an operator or independent observation of a machine.

Browser DOM engine results, Linux-image runs, packaged Electron runs, native targets and manual assistive results remain separate evidence classes. Browser, emulated, cross-built or one-slice-universal evidence cannot satisfy a missing required native partition. A required-only native aggregate does not claim execution of the two optional extensions. The seeded corpus includes all six selected targets and rejects a five-target result, missing ARM64, wrong classifications, emulated execution and a universal artifact observed on only one CPU.

The harness's deterministic corpus can validate accounting without native hosts. Real IPC, file-backed SQLite, utility-process and packaged CSP tests remain mandatory at their consuming deliveries under [ADR-0017](adr/adr-0017-real-boundary-integration-tests.md). Existing native acceptance entries are described in [Isolated desktop runtime](desktop-runtime.md) and [Durable foundation storage](storage.md); native host qualification and observations follow [Native foundation qualification](native-qualification.md). Synthetic Electron adapters and jsdom tests complement those boundaries and never replace their native evidence.
