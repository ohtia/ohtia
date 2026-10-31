---
type: Playbook
title: Scaleway qualification access preflight
description: Check protected GitHub Actions read access and ARM image compatibility without creating cloud resources or claiming native qualification.
sources:
  - id: instance-api
    resource: https://www.scaleway.com/en/developers/api/instance/v1/instances
    title: Scaleway Instance API filtered reads
  - id: block-api
    resource: https://www.scaleway.com/en/developers/api/block/volume
    title: Scaleway Block Storage API filtered reads
  - id: instance-types-api
    resource: https://www.scaleway.com/en/developers/api/instance/v1/instance-types
    title: Scaleway paginated Instance type catalog
  - id: marketplace-api
    resource: https://www.scaleway.com/en/developers/api/marketplace/
    title: Scaleway Marketplace local image identities
  - id: storage-units
    resource: https://www.scaleway.com/en/docs/block-storage/how-to/mount-a-volume/
    title: Scaleway decimal storage capacity
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Scaleway qualification access preflight

## Purpose and authority

The [access preflight workflow](../.github/workflows/scaleway-access.yml) checks authenticated project-filtered reads and configured ARM64 image/SKU combinations for the [installation qualification owner](epics/EPIC-001-desktop-foundation/STORY-001-013-qualify-signed-installation-and-update-mechanisms.md). It runs on a GitHub-hosted Linux x64 machine and reads provider metadata. The separate [hosted facility observations](installation-facilities.md) and [ephemeral qualification contract](scaleway-qualification.md) describe different evidence.

The checker contains only GET requests to the fixed Scaleway TLS origin. It does not create, start, resize, contact or delete a VM, and success does not authorize a paid execution. Use a protected main-only deployment with maintainer approval; inspect the actual guards and provider permission scope separately. This checker does not inspect IAM policy or prove denied access to other projects.

## Configuration contract

The workflow consumes deployment configuration through Actions variables and its credential through an environment secret. Neither source files nor reports contain credential values. The HTTP adapter injects only the secret required by its authenticated reads; it does not expose that value to a subprocess or accept a caller-supplied endpoint.

- `SCW_PROJECT_ID`: canonical UUID of the dedicated project.
- `SCW_ARM_ZONE`: selected provider availability zone.
- `SCW_ARM_INSTANCE_TYPE`: selected ARM64 SKU.
- `SCW_ARM_DISK_GB`: planned total decimal GB, recorded together with its exact byte count. This setting does not allocate or validate storage.[^storage-units]
- `SCW_ARM_FEDORA44_IMAGE_ID` and `SCW_ARM_DEBIAN13_IMAGE_ID`: zone-specific ARM64 bootable SBS local-image UUIDs with the expected OS labels.

Use Marketplace local-image identities rather than global-image or snapshot identities. A replacement image requires review and a fresh observation; the checker does not resolve a moving label silently.[^marketplace-api] The version-2 report consumes decimal GB and never reinterprets the legacy GiB variable. Deploy its matching configuration before running the new reader.

## Execute and interpret

Dispatch the workflow from reviewed `main` and approve its protected deployment. PR events do not receive the credential. The checker binds its actual checkout, workflow/source SHAs, run and attempt to the expected hosted execution context. Independently compare these observations with the actual GitHub run; strings inside a report do not prove external enforcement.

Authenticated Instance and Block Storage requests are project-filtered and bounded to one item. An empty response establishes only that the list request was accepted, not existing-resource authority, project membership or write permission. A returned foreign-project item fails. Resource names, addresses, IDs and counts are excluded from the report.[^instance-api][^block-api]

Separate public catalog requests verify the configured SKU's native architecture, support state and Block Storage capability, and each local image's exact identity, OS label, CPU, zone, storage type and SKU compatibility. SKU lookup uses bounded pagination rather than assuming the first page is complete. These reads do not establish authentication, reserve stock, quote prices or prove boot/disk feasibility.[^instance-types-api]

Requests have finite socket/body deadlines and response-size bounds, with no redirects or retries. Non-success status, premature message termination, malformed or duplicate-key JSON and incompatible profiles fail. Only static diagnostic codes reach logs; provider bodies, arbitrary exception text and credentials are excluded. The workflow retains a report only after complete success.

Retrieve the run/attempt-specific artifact from the completed workflow. Its report records filtered-read outcomes and configured profile metadata. Resource creation, write-authority testing, policy-isolation testing, disk-capacity testing, stock reservation and distribution qualification remain explicitly false. Failed, missing or expired evidence does not establish working access.

[^instance-api]: Instance listing supports project filtering and bounded pagination.

[^block-api]: Block Storage listing uses project filtering and explicitly excludes deleted volumes.

[^marketplace-api]: Local images distinguish zone, architecture, storage type and compatible Instance types.

[^instance-types-api]: The Instance type catalog is paginated; one default page is not the complete inventory.

[^storage-units]: Scaleway uses decimal GB; a mounted volume displayed with binary units can appear smaller.
