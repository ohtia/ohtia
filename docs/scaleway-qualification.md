---
type: Reference
title: Ephemeral ARM installation qualification
description: Build unsigned native probe packages in GitHub Actions and test them on bounded, independently recovered Scaleway ARM leases.
sources:
  - id: devices
    resource: https://www.scaleway.com/en/docs/instances/reference-content/identify-devices/
    title: Scaleway device identity
  - id: schedules
    resource: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
    title: GitHub scheduled execution limitations
generated:
  by: codex/gpt-6.1-sol
---

# Ephemeral ARM installation qualification

## Scope and execution

The [qualification workflow](../.github/workflows/installation-qualification.yml) builds one unsigned native ARM64 RPM or DEB through the [common package constructor](../scripts/quality_native.py), then tests it on a disposable native guest. The [recovery workflow](../.github/workflows/installation-cleanup.yml) independently reconciles completed or expired leases. Both use reviewed `main`. The [policy](../config/installation/scaleway.json) owns exact resource shapes, decimal byte sizes, deadlines, bounds and the checksum-pinned metadata client. [ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md#ephemeral-native-qualification) owns the facility choice and authority boundary.

Build execution receives no provider or publisher credentials. Creator and recovery authority are separate. Resource UUIDs and the current IPv4 come from authenticated provider responses; callers cannot supply an address, endpoint, source revision or arbitrary remote command. Ephemeral SSH identities remain on the controller. Host-key admission compares Ed25519 fingerprints through the authenticated provider API before strict SSH is enabled.

The normal fourteen-cell hosted CI does not allocate paid guests. Native package/runtime/storage/diagnostics results establish their observed unsigned quality scope. They do not establish publisher signing, authenticated first installation, installed updates, cryptographic artifact attestations, assistive acceptance or permission to distribute.

## Admission and lifecycle

The controller binds actual workflow/source/run/attempt, native target, package format and final byte identities. It requires the reviewed policy, configured guards, sufficient credential-validity assertions, recent recovery health and no unresolved prior allocation. Configuration and actual external permissions must be independently reviewed before enabling paid execution. Source configuration alone does not establish provider enforcement or authorization.

A nonsecret immutable intent precedes every provider write. Allocation requests are journalled before transmission and returned UUIDs recorded before another operation. A lost create response is never blindly retried. Uncertain or unavailable evidence blocks another allocation while known owned resources can still be reconciled.

The guest shutdown timer is armed before application work. An ordinary locked account has an isolated home and no administrative authority. Only the verified newly allocated data volume may be formatted; its provider UUID must match the guest's vendor serial, with root, existing filesystems and partitions refused.[^devices] Fedora requires its Workstation identity/vendor kernel, Btrfs and enforcing SELinux. Debian requires its vendor kernel, ext4 and enabled AppArmor. The native graphical session preserves Chromium sandboxing.

Normal cleanup and independent recovery verify owned server, volume, address and network-policy removal through exact-ID and project-filtered reads. Successful stop or DELETE responses alone do not establish absence. Foreign ownership, duplicate resources, unexpected attachments and incomplete reads fail closed. Disabling new allocations leaves recovery available. Active unexpired producers are deferred; completed or expired leases may be reclaimed.

## Evidence and limits

Retained artifacts identify the exact build, allocation intent, controller journal, bounded synthetic native results and recovery ledger. Successful recovery carries complete intents and verified absence receipts forward across the original artifacts' retention period. Missing evidence, exhausted history bounds or unresolved writes suspend allocation rather than silently discarding obligations. A missing controller journal cannot establish a successful native test. Verified workflow attempts that never reached provider execution are carried separately from allocated leases.

After retention loss, an exceptional manual execution may restore a privately retained complete checkpoint. Creation must remain suspended, the protected creator environment requires human approval of the checkpoint digest, and read-only provider checks must establish an empty project and inactive recorded resources. The restore client permits only GET routes; this source restriction does not narrow its credential’s provider permissions. Restoration cannot discard uncovered history or establish fresh cleanup-key health. A subsequent independent recovery observation is required before new allocation.

The deliberate controller-loss mode runs after native smoke on the same allocation and bypasses normal finally cleanup. The producer remains failed; a separate recovery result must establish actual deletion. Synthetic provider fixtures test control logic and do not qualify real provider operations.

Headless GNOME/Wayland and software rendering establish their observed native session scope, not physical graphics or human assistive behavior. Scheduled recovery can be delayed, dropped or disabled by the hosting service.[^schedules] A shutdown timer can stop compute but cannot release storage or addresses. These mitigations do not establish a hard billing ceiling or independent recovery during a shared hosting outage.

[^devices]: Scaleway identifies SBS devices through vendor/model and a serial containing the allocated volume UUID; device letters are not stable identities.

[^schedules]: GitHub documents scheduled-workflow delays, dropped jobs and inactivity disabling.
