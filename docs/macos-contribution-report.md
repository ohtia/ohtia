---
type: Analysis
title: Native macOS contributor verification
description: Observed Apple Silicon setup, desktop, storage, source-edit and local-package evidence for macOS 26 and 27.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Native macOS contributor verification

## Scope and inputs

This evaluation supplies initial U11 evidence for [STORY-001-011](epics/EPIC-001-desktop-foundation/STORY-001-011-make-macos-contribution-setup-reproducible.md) and the [macOS contribution procedure](macos-contribution.md). It uses the public source base `6dec61c30a87dea3a9dc83999e963b620f1f060d`, the issue's new contributor entry and the existing runtime, storage, quality and native packaging implementations. Both native source manifests were compared byte-for-byte with the local candidate before this analysis was written. Later diagnostic-only changes received repeated native positive/negative admission checks. Documentation changes do not relabel earlier executable observations.

The [locked workspace](developer-workspace.md), [native foundation report](native-foundation-report.md), [isolated runtime](desktop-runtime.md), [storage contract](storage.md), [shared verification](shared-verification.md) and [native quality builder](quality-builds.md) are the integrated W2, D1b, R4, S5, Q7 and B12 inputs. Their presence alone is not success evidence: this evaluation independently runs the applicable macOS operations against the actual consumer inputs. PRIN-004–007, PRIN-011 and PRIN-016 require retaining original failures, separating evidence from inference and qualifying only observed targets.

The frozen JavaScript lock SHA-256 is `a8a379c5dcb35c06e448416bb393284a9d85802218f660ef5b96a57cc03462ff`; the Python lock SHA-256 is `0df31d9d2a882798baa17473a9eb81feaf95408f58030bbca66581fedf2d5ca4`. Both remained unchanged. No signing identity, notarization secret, provider credential, paid inference or private research material was needed.

## Native identities and isolation

- **macOS 26:** 26.7.2 build 25G332, Apple M2, 16 GiB RAM, APFS and a WindowServer account session. Apple Clang reported `clang-2100.1.1.101`; the selected SDK reported 26.5.
- **macOS 27:** 27.2 build 26B123, Apple M1, 8 GiB RAM, APFS and a WindowServer account session. Apple Clang reported `clang-2100.3.34.2`; the selected SDK reported 27.0.
- **Effective tools:** native ARM64 system bootstrap Python 3.9.6; managed Python 3.14.8, Node 26.12.1, pnpm 12.14.0 and uv 0.13.5. Exact pins remain owned by the [toolchain manifest](../config/desktop/toolchain.json).
- **Actual application and utility:** ARM64 Electron 45.0.0 with embedded Node 24.22.0 and ABI 150. Native utility execution loaded the selected binding SHA-256 `98e0e8acd01c632fe5615243e1296af0372826f8783b18fc31c506f73c47459c`, SQLite 3.53.4 and its exact source identity and compilation options. Post-signature package binding identities remain separately bound in each final payload.

Both facilities are native Apple Silicon VMs with a dedicated synthetic-data test account. Checkouts were new and named with spaces and `ñ`, with initially empty checkout-local tool, dependency and browser caches. Existing owned test configuration and store generations were preserved together under scratch before starting fresh suites. No stable configuration was adopted or redirected. Configuration, fixed native-home research storage and scratch were disjoint; all three external synthetic stable sentinels retained their before/after hashes. These fixtures establish synthetic exclusion checks, not protection of an unidentified person's real research store.

No Intel slice, Rosetta execution or universal package is included. Native account/CPU checks reject translation or mismatched interpreter architecture. The selected full Xcode installations were already provisioned; this run did not install Apple tools on a pristine OS or verify every compatible Command Line Tools-only installation.

## Operations and measured timing

Cold checkout setup through Apple's Python completed in 10.819 seconds on macOS 26 and 10.336 seconds on macOS 27. Repeating the same setup took 0.922 and 1.125 seconds respectively. These are complete setup wall times, including downloads and installation, rather than invented pure-download or active-setup measurements. HTTPS endpoint access worked, but sustained throughput and latency were not independently measured; these observations do not establish the foundation's reference-network assumptions.

The final shared test entry completed in 27.462 and 29.669 seconds; build in 6.840 and 7.399 seconds; runtime assembly in 2.853 and 2.981 seconds; native desktop acceptance in 5.278 and 6.176 seconds; storage acceptance in 26.197 and 28.287 seconds; and DMG/ZIP construction in 54.616 and 61.347 seconds. Order is macOS 26 then 27 throughout. Packaging and assembly include any first-use downloads; no overlap is silently reclassified as active work. The canonical [numeric policy](../config/desktop/resource-policy.json) supplied the pre-existing onboarding budgets. These component measurements are useful upper bounds for machine execution, not a timed unfamiliar person's complete onboarding or a complete separation of network and active time.

The shared suites exercised 465 Vitest cases, two Playwright tooling cases and 297 applicable Python cases per macOS target, with complete registry/accounting and required per-package coverage. The desktop receipt contains 20 recorded observations, including status IPC, actual renderer settings/CSP, navigation/resource refusal, second launch, service death/retry and shutdown. The storage receipt contains 19 top-level cases and the complete component/interruption inventories, including actual loaded-addon identities, durable restart, replay/receipt behavior, denied I/O, incompatible binding/engine refusal, migration/checkpoint recovery and interrupted publication/restore.

A representative source edit changed only the desktop heading to `Ohtia contributor`. Type checking, the shared tests, rebuild and new runtime assembly succeeded on both hosts; a real window capture confirmed the changed heading. The original source hash `bb70d4e0e326ee38a886949aa6aa1b2011f7b1de8d63c5d0259b957ac250ae10` was restored on both hosts and canonical assets were rebuilt. The first capture attempt omitted the harness's explicit acceptance authorization and correctly failed with its injected debugger flags; the corrected instrumented capture is retained separately. An instrumented check is not an ordinary uninstrumented launch. Separately, the exact common `dev` entry ran without acceptance/debugger flags on both native hosts; an OS Seatbelt query observed its renderer sandbox, a native quit event completed with exit zero, and no attempt processes remained.

Native negative attempts refused a missing selected Apple toolchain, a missing checkout-local Node, an unverified execution profile and overlap with a stable fixture root. The final diagnostics named controlled repairs and contained no account/home path or arbitrary child exception. Portable tests additionally covered Rosetta/interpreter mismatch, an unqualified OS family, corrupt download authentication, archive traversal/special entries, concurrent setup and package refusal before writes. The Apple Python shim can fail before repository code starts when its developer-tool selection is invalid; that boundary is distinct from the repository's controlled diagnostics.

## Actual package observations

Each target produced ARM64 DMG and ZIP packages with ad-hoc signatures and no publication. Each original ZIP was extracted and each DMG mounted read-only, copied without altering its application bytes and detached. The existing native smoke harness ran the complete runtime, storage and diagnostic inventories against these actual payloads. It independently sampled native Seatbelt decisions and checked final absence of package processes.

- **macOS 26 ZIP:** SHA-256 `a92fb30b4559c20de5cac5119c62d01a08f53bf011c76b74c952d8f3a5b23e6d`; 125,652,454 bytes. Smoke took 32.959 seconds and retained 93 sandboxed-renderer samples.
- **macOS 26 DMG:** SHA-256 `90fc0da5dc67961cb4d2f71bc7f06a5e504c86baebbf50ba0be8ade75cb4bea5`; 128,884,986 bytes. Smoke took 36.335 seconds and retained 90 sandboxed-renderer samples.
- **macOS 27 ZIP:** SHA-256 `a9cac9ab6157ee7dca5fe085a0262d63c2b242579ab782e6f5bcb68be385ac5c`; 125,581,016 bytes. Smoke took 35.904 seconds and retained 86 sandboxed-renderer samples.
- **macOS 27 DMG:** SHA-256 `4d47a8134abe1b5858f42fb12478241c80cbec905917818cbe94a039d36ebea4`; 128,800,991 bytes. Smoke took 45.336 seconds and retained 84 sandboxed-renderer samples.

All four smoke records report no remaining package processes. The source runtime prepared-record digest is `f7c9ab75b615ff4c2ae552e0c42e6fef57a154badbb825638e49db505ecbcda6` on both systems. Different final package hashes are retained rather than assuming reproducible archive bytes across hosts. Ad-hoc signing and these local packages do not establish Developer ID, notarization, authenticated updates, release reservation or public distribution trust.

## Contributor-control regression verification

Follow-up review corrections strengthened tool-process containment, immutable-runtime/output separation, relocated archive-link validation, safe failure classification and canonical invocation refusal. These do not change shipped application/runtime/addon source inputs. Fresh checkout-local cold setups through Apple's actual Python 3.9.6 passed again on both native hosts, in 8.754 seconds on macOS 26 and 8.737 seconds on macOS 27. The complete shared checks passed with 18 contributor regression cases and 302 applicable Python cases per native host. Both hosts also successfully built another native DMG/ZIP pair through the corrected contained packager.

A real SIGTERM interruption stopped a supervisor and its grandchild on each native host; independent PID readback found no remaining grandchild before the controlled error was accepted. A symlinked checkout invocation was refused before setup. The regression suite additionally exercises a real timeout, source/output overlap without writes, both reported relocated-link exploits, retained digest-mismatch diagnosis without private child text and Python 3.9 grammar. Native process-group observations apply to these trusted tool subtrees; they do not establish containment of arbitrary programs that deliberately escape their process group.

The final terminal-signal correction uses cooperative cancellation in the existing POSIX supervisor: SIGINT, SIGTERM, SIGHUP and SIGQUIT request graceful group termination and bounded verified cleanup without raising through process creation or descriptor restoration. Final native shared checks passed with 20 contributor cases and 304 applicable Python cases per macOS target, including real SIGHUP/SIGQUIT supervisor/grandchild cessation. A crafted linked-parent archive is rejected without adding any entry outside extraction. Apple's Python 3.9.6 also extracted and executed the exact authenticated pinned Python archive successfully with these final link checks. Existing supervisor callers retain their default behavior and receipt fields; the complete local Python suite passed 319 cases.

## Evidence and limits

Compact native archives retain source manifests, command outputs/exits, original failed attempts, suite receipts, native sandbox samples, screenshots, package hashes and sentinel checks. The macOS 26 diagnostic/source/package archive SHA-256 is `286cb46fd268c61d821562e027bda8d13ccf6600d0f846bde94f8a5a7b3e808e`; macOS 27 is `c27559e95552f4432c27d4ae3663541245408f9a6f530f3a4bc75bad154899b9`. Actual packages and preserved synthetic generations remain on the native facilities. These archive identities describe the observed content; they are not a later commit, hosted CI result or human approval.

Initial failures exposed two noncanonical temporary-directory test fixtures and an undeclared Linux-only procfs test. The fixtures now resolve their temporary roots and retain strict artifact-alias rejection; the existing platform-only case is explicitly inapplicable on Darwin/Windows. Neither a skipped mandatory case nor a weakened runtime guard was used to obtain passing native results. Failed test inventories and the initial capture failure remain in the evidence.

These runs used already provisioned VMs and an experienced operator. They do not claim pristine-machine Apple-tool installation, an unfamiliar person's unaided walkthrough, native assistive-technology review, a complete network/active-time decomposition, physical power-loss durability or lifetime process-resource accounting. The independent human newcomer assessment remains with [STORY-001-017](epics/EPIC-001-desktop-foundation/STORY-001-017-verify-the-integrated-foundation-and-contributor-journeys.md).
