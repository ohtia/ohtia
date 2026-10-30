---
type: Playbook
title: Installation facility observations
description: Observe hosted Linux VM and non-elevated-account capabilities without granting native installation or distribution qualification.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: kvm-api
    resource: https://docs.kernel.org/virt/kvm/api.html
    title: Linux KVM API and descriptor lifecycle
  - id: runner-variables
    resource: https://docs.github.com/en/actions/reference/workflows-and-actions/variables
    title: GitHub runner and run identity variables
---

# Installation facility observations

## Purpose

The [installation and update owner](epics/EPIC-001-desktop-foundation/STORY-001-013-qualify-signed-installation-and-update-mechanisms.md) needs measured native execution facilities. The [Installation facilities workflow](../.github/workflows/installation-facilities.yml) observes Ubuntu hosted x64 and ARM64 runners without release credentials, application execution or research data. Its reports distinguish the runner's default account from a separately created non-elevated account. Successful observation is not qualification of Fedora, Debian, a graphical session or a signed installer.

## Execute and retain

A PR changing the workflow, probe or its tests starts both architecture observations. After integration, the workflow can also be dispatched from Actions. The workflow uses pinned checkout/setup/artifact actions with read-only repository contents access and no signing/notarization/publication secrets. Its ten-minute job limit bounds execution; the hosted machine is disposable.

When `/dev/kvm` exists, runner preparation installs the distribution’s `acl` package with administrator authorization and grants the workflow runner account read/write access to that device through a user-specific ACL, matching the existing native quality workflow. The host step then records the machine architecture and current process privileges, opens `/dev/kvm`, checks API version 12 and attempts to create and close an empty VM descriptor. Availability therefore describes access after this explicit preparation; default device permissions and the separate probe account’s KVM access are not observed. A missing, inaccessible or unsupported device is recorded as unavailable with a controlled reason. Descriptors are closed on every path. No guest CPU, memory, firmware, disk or operating system is started; a successful empty VM cannot establish guest boot, native compositor, sandbox, filesystem or application behavior.[^kvm-api]

The account step creates only `ohtia27-probe`, with a locked default password, a distinct home and no added administrative groups. It runs the standalone probe with an isolated Python invocation and an explicitly selected environment, excluding workflow credentials. Its observation succeeds only for a non-root process with no effective Linux capabilities and denied unattended execution of the fixed sudo no-op. A failed or unknown privilege observation fails the step. The unconditional cleanup removes the account only when this job successfully created it. Root account provisioning is ephemeral runner preparation, not application execution as administrator.

Download `installation-facilities-<architecture>-<run-id>-<attempt>` from the run's artifacts. It contains `host.json` and, if that step completed, `account.json`, retained for fourteen days. Missing, partial or unreadable reports are incomplete evidence. These are public facility metadata, not release packages or key material. Keep any needed evidence beyond that window in the task's controlled records.

## Report admission

Each schema-1 report identifies repository, checked-out commit/tree, actual run/attempt, observed distribution/version/kernel, reported runner and observed machine architecture and Python version. Compare those identities with the actual reviewed workflow and GitHub run; a report's own strings are not independent provenance or authorization. Report generation requires a matching Linux GitHub-hosted context and non-root process. The environment metadata is checked against the observed process architecture, rather than accepting the matrix label alone.[^runner-variables]

Both roles always state `distribution_qualified: false` and `display_session_probed: false`. Host reports additionally state `guest_booted: false`, even when KVM accepts empty-VM creation. The host invocation succeeds when the observation itself is complete; `kvm.status: unavailable` remains a facility gap, not a passing guest test. A consumer that specifically requires KVM must use the host command's `--require-kvm` option, which returns failure when that capability is unavailable. Account success does not establish an interactive graphical login or stable-store exclusion; qualify those separately before launching Ohtia.

The probe's command contract is `python scripts/installation_facilities.py <host|account> --expected-architecture <x64|arm64> --checkout-sha <40-hex> --tree-sha <40-hex>`, with optional `--require-kvm` only for the host role. It writes one bounded JSON report to standard output, uses controlled diagnostics on standard error and refuses ordinary local invocation. Neither role imports release keys, modifies public feeds, grants signing authority or substitutes for the [required native target contract](desktop-foundation-contract.md).

[^kvm-api]: The kernel defines the stable API version and empty VM descriptor lifetime; closing descriptors releases those resources without establishing a booted guest.

[^runner-variables]: GitHub identifies run attempts and runner architectures separately; retaining those fields does not replace verification of the actual run and source.
