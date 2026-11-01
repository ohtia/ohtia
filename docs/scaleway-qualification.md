---
type: Reference
title: Ephemeral ARM installation qualification
description: Define protected authority, bounded diagnostics and recovery for unsigned native ARM qualification on ephemeral Scaleway leases.
sources:
  - id: cloud-init-errors
    resource: https://github.com/canonical/cloud-init/blob/25.1.4/cloudinit/cmd/main.py
    title: Cloud-init stage and result error serialization
  - id: devices
    resource: https://www.scaleway.com/en/docs/instances/reference-content/identify-devices/
    title: Scaleway device identity
  - id: schedules
    resource: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
    title: GitHub scheduled execution limitations
  - id: cloud-init-units
    resource: https://docs.cloud-init.io/en/latest/reference/breaking_changes.html#single-process-optimization
    title: Cloud-init service naming changes
  - id: systemd-unit-state
    resource: https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.systemd1.html
    title: Systemd unit load and active states
---

# Ephemeral ARM installation qualification

## Scope and execution

The [qualification workflow](../.github/workflows/installation-qualification.yml) builds one unsigned native ARM64 RPM or DEB through the [common package constructor](../scripts/quality_native.py), then tests it on a disposable native guest. The [recovery workflow](../.github/workflows/installation-cleanup.yml) independently reconciles completed or expired leases. Both use reviewed `main`. The [policy](../config/installation/scaleway.json) owns exact resource shapes, decimal byte sizes, deadlines, bounds and the checksum-pinned metadata client. [ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md#ephemeral-native-qualification) owns the facility choice and authority boundary.

Build execution receives no provider or publisher credentials. Creator and recovery authority are separate. Resource UUIDs and the current IPv4 come from authenticated provider responses; callers cannot supply an address, endpoint, source revision or arbitrary remote command. Ephemeral SSH identities remain on the controller. Host-key admission compares Ed25519 fingerprints through the authenticated provider API before strict SSH is enabled.

The normal fourteen-cell hosted CI does not allocate paid guests. Native package/runtime/storage/diagnostics results establish their observed unsigned quality scope. They do not establish publisher signing, authenticated first installation, installed updates, cryptographic artifact attestations, assistive acceptance or permission to distribute.

## Configuration placement

Store all nonsecret Scaleway configuration in GitHub repository variables. Project, zone, machine type, disk capacity and images form one resource configuration and use the same scope. The workflow controls and key-expiration assertions use that scope as well. Keep no duplicate `SCW_*` configuration variables in either GitHub environment; workflow `env` mappings pass selected repository values to processes without creating another configuration store.

The complete repository-variable map is:

- `SCW_PROJECT_ID`: dedicated project.
- `SCW_ARM_ZONE`: availability zone.
- `SCW_ARM_INSTANCE_TYPE`: ARM machine type.
- `SCW_ARM_DISK_GB`: total decimal disk capacity.
- `SCW_ARM_FEDORA44_IMAGE_ID`: Fedora local image.
- `SCW_ARM_DEBIAN13_IMAGE_ID`: Debian local image.
- `SCW_CYCLE_ENABLED`: creation control.
- `SCW_RECOVERY_ENABLED`: independent recovery control.
- `SCW_APPROVED_POLICY_SHA256`: approved resource-policy digest.
- `SCW_CREATOR_KEY_EXPIRES_AT`: asserted creator-key expiration.
- `SCW_CLEANUP_KEY_EXPIRES_AT`: asserted cleanup-key expiration.

The [preflight configuration contract](scaleway-access.md#configuration-contract) defines the resource-field formats and image requirements. The expiration assertions must match the provider's actual UTC expiration dates; they neither contain keys nor discover or renew them. Keep both enable flags `false` during initial preparation. Enable recovery only after its credential, provider permissions and deployment guards are configured and checked; paid creation requires its separate approval.

Store credentials as environment secrets. `scaleway-qualification` holds the creator application's `SCW_SECRET_KEY` behind maintainer approval. `scaleway-cleanup` holds a different application's `SCW_SECRET_KEY` and requires no manual approval, so recovery can proceed independently. Keep any retained access-key identifier with its corresponding environment credentials. [ADR-0020](adr/adr-0020-github-policy-and-trusted-ci.md#ephemeral-native-qualification) owns the authority boundary; the environments separate credential release and approval, not nonsecret machine settings.

When migrating an existing environment variable, copy its unchanged value to repository scope, verify the copy, then remove the environment override. Read back the complete map before execution. GitHub configuration changes are performed manually when the maintainer selects that mode; read-only verification does not require variable-write permission.

## Admission and lifecycle

The controller binds actual workflow/source/run/attempt, native target, package format and final byte identities. It requires the reviewed policy, configured guards, sufficient credential-validity assertions, recent recovery health and no unresolved prior allocation. Configuration and actual external permissions must be independently reviewed before enabling paid execution. Source configuration alone does not establish provider enforcement or authorization.

A nonsecret immutable intent precedes every provider write. Allocation requests are journalled before transmission and returned UUIDs recorded before another operation. A lost create response is never blindly retried. Uncertain or unavailable evidence blocks another allocation while known owned resources can still be reconciled.

The guest shutdown timer is armed before application work. An ordinary locked account has an isolated home and no administrative authority. Only the verified newly allocated data volume may be formatted; its provider UUID must match the guest's vendor serial, with root, existing filesystems and partitions refused.[^devices] Fedora requires its Workstation identity/vendor kernel, Btrfs and enforcing SELinux. Debian requires its vendor kernel, ext4 and enabled AppArmor. The native graphical session preserves Chromium sandboxing.

Normal cleanup and independent recovery verify owned server, volume, address and network-policy removal through exact-ID and project-filtered reads. Successful stop or DELETE responses alone do not establish absence. Foreign ownership, duplicate resources, unexpected attachments and incomplete reads fail closed. Disabling new allocations leaves recovery available. Active unexpired producers are deferred; completed or expired leases may be reclaimed.

## Progress and failure diagnostics

The qualification run title identifies the selected profile and fault mode. Keep the workflow name, controller job name and provider-step name stable: the recovery trigger and historical allocation-attempt reader use those identities. A display title does not establish native profile, source or authority.

The controller publishes `OHTIA_ARM_PROGRESS` JSON records on phase and observation changes and every thirty seconds during silent work. Heartbeats establish controller liveness only. Guest state changes require validated observations; a provider resource response or matching SSH host key does not establish successful account authentication, guest readiness or native smoke. Records identify source/run/attempt, profile/fault, phase, monotonic elapsed/remaining budget, attempt counts and normalized failures, without resource IDs, addresses, project identifiers, paths, credentials or raw guest text.

Host-key admission records selected server state and boot type, exact IP association, provider fingerprint availability and actual keyscan/keygen outcomes before authenticated SSH. `host-key-diagnostics.json` retains the latest source/run/attempt/profile/intent-bound snapshot, capped by the existing 2 KiB progress-record bound, without raw provider objects, host keys, addresses or subprocess output. Missing fingerprints leave keyscan unattempted. Normalized wait observations and separate unauthenticated keyscan/keygen counters appear in live progress; repeated waits refresh timestamps without repeating change events. Matching the authenticated provider fingerprint remains mandatory before trusting the scanned key. At an exhausted host-key deadline, a transport/deadline error is reported as `host_key_deadline` with its original normalized API failure retained separately; an earlier API failure or an ownership, malformed-metadata or key-mismatch rejection keeps its actual code. These observations do not establish guest boot progress or successful authentication.

After host-key admission, a fixed shell probe checks authenticated remote execution and interpreter/helper presence without depending on Python or the helper it diagnoses. Status polling retains process exit/timeout distinctions and normalized reported SSH markers. Marker categories are hints, not proof of a cause or authority to change trust. Strict SSH key checks remain enabled. Raw stderr is bounded transient data, classified privately and discarded; neither it nor raw cloud-init/journal output enters public diagnostic artifacts.

`controller-progress.json` retains the latest snapshot; `controller-events.json` retains bounded event history; `bootstrap-transport.json` preserves attempt counts and the last bootstrap transport failure independently of later collection failures. `guest-bootstrap-diagnostics.json` records a validated summary of readiness, helper failure and selected cloud-init unit states, or an explicit unavailable or invalid result. Failed and timed-out diagnostic commands identify their fixed collection stage without attributing the cause to SSH transport or to the helper. The fixed unit set includes the legacy `cloud-init.service` and its upstream replacement `cloud-init-network.service`; distribution packaging may differ.[^cloud-init-units] A unit without `LoadState=loaded` is unavailable, independently of its reported active state.[^systemd-unit-state] Invalid or missing diagnostics cannot authorize allocation or qualify a native result. Diagnostic collection preserves the primary failure and uses the existing evidence/cleanup windows; it does not extend the test, cleanup, shutdown or lease deadline.

The guest diagnostic summary also includes `cloud_init`, containing fixed `status` and `result` source states, at most eight error observations and a truncation flag. Each fixed source is read as a regular file with a 64 KiB bound, following symlinks when present; missing or unreadable data is `unavailable`, malformed data is `invalid` and excessive data is `oversized`. Observations retain the stage, recognized built-in module and exception, a normalized error category, and available recognized program and exit code. Module names with hyphens normalize to underscores. Unknown identifiers are null and unrecognized errors remain `unclassified`; exception representations longer than 8 KiB also set truncation. No exception text, command arguments, paths, user-data or logs are exported. These observations describe reported errors rather than proving their underlying cause. Polling preserves refusal on source I/O or decoder recursion failure. Diagnostic collection marks such a read failure as failed, preserves any existing helper failure, and continues collecting the other source and unit states; the aggregate counter includes only readable sources.

Cloud-init copies stage errors into its result file.[^cloud-init-errors] Identical records copied between these sources appear once in the bounded observation list; identical errors in separate stage lists retain those list names. The `stage` field identifies the list containing the error, not its proven origin or a separate occurrence: cloud-init can copy an early error into stage lists that have not run.[^cloud-init-errors] Result-only errors have a null stage. The existing `cloud_init_error_count` remains an aggregate of both files and may count one failure twice; it is not a count of distinct failures. Source availability and truncation remain explicit, and neither diagnostic normalization nor an already-created readiness marker waives a reported cloud-init failure.

The [policy](../config/installation/scaleway.json) limits each progress record to 2 KiB, retains at most 256 events, caps the guest diagnostic summary at 16 KiB and retains at most an 8 KiB transient diagnostic stderr prefix while draining and discarding further stderr. Console output reserves space for lease-duration heartbeats and the final record; repeated observations refresh counters and timestamps without emitting duplicate events. The heartbeat thread performs no provider or guest action. Failure to persist a diagnostic cannot bypass or prevent normal cleanup. `controller-completion.json` and the nonfatal always-step summary distinguish an observed final controller record from unavailable final evidence, including abrupt process loss or a failed final write; the earlier progress snapshot remains historical. Completion persistence/summary I/O errors preserve the producer outcome, with bounded safe console metadata attempted independently. If the runner itself is lost, the always-step and artifact upload may not execute: missing completion metadata means unknown completion, and no historical heartbeat proves current liveness. Independent recovery remains responsible for owned-resource reconciliation.

Changes to these policy limits alter the approved policy digest. Prepare the exact configuration plan and authorized readback before using the changed authority; a merged implementation or a passing synthetic test does not update `SCW_APPROVED_POLICY_SHA256` or authorize another paid trial.

## Evidence and limits

Retained artifacts identify the exact build, allocation intent, controller journal, bounded synthetic native results and recovery ledger. Successful recovery carries complete intents and verified absence receipts forward across the original artifacts' retention period. Missing evidence, exhausted history bounds or unresolved writes suspend allocation rather than silently discarding obligations. A missing controller journal cannot establish a successful native test. Verified workflow attempts that never reached provider execution are carried separately from allocated leases.

After retention loss, an exceptional manual execution may restore a privately retained complete checkpoint. Creation must remain suspended, the protected creator environment requires human approval of the checkpoint digest, and read-only provider checks must establish an empty project and inactive recorded resources. The restore client permits only GET routes; this source restriction does not narrow its credential’s provider permissions. Restoration cannot discard uncovered history or establish fresh cleanup-key health. A subsequent independent recovery observation is required before new allocation.

The deliberate controller-loss mode runs after native smoke on the same allocation and bypasses normal finally cleanup. The producer remains failed; a separate recovery result must establish actual deletion. Synthetic provider fixtures test control logic and do not qualify real provider operations.

Headless GNOME/Wayland and software rendering establish their observed native session scope, not physical graphics or human assistive behavior. Scheduled recovery can be delayed, dropped or disabled by the hosting service.[^schedules] A shutdown timer can stop compute but cannot release storage or addresses. These mitigations do not establish a hard billing ceiling or independent recovery during a shared hosting outage.

[^devices]: Scaleway identifies SBS devices through vendor/model and a serial containing the allocated volume UUID; device letters are not stable identities.

[^schedules]: GitHub documents scheduled-workflow delays, dropped jobs and inactivity disabling.

[^cloud-init-units]: Cloud-init documents the upstream network-stage unit rename and warns that distributions may patch breaking changes.

[^systemd-unit-state]: Systemd documents load state separately from active state; an active-state value alone does not establish loaded configuration.

[^cloud-init-errors]: Cloud-init serializes stage errors into `status.json` and aggregates them again into `result.json` at the final stage.
