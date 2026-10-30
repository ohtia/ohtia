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
---

# Scaleway qualification access preflight

## Purpose and authority

The [Scaleway access preflight workflow](../.github/workflows/scaleway-access.yml) checks authenticated, project-filtered reads and the configured ARM64 image/SKU combinations for the [installation qualification owner](epics/EPIC-001-desktop-foundation/STORY-001-013-qualify-signed-installation-and-update-mechanisms.md). It runs on a GitHub-hosted Linux x64 machine and reads Scaleway metadata; it does not execute on a Scaleway VM. The separate [hosted facility observations](installation-facilities.md) establish different, explicitly limited evidence.

This workflow contains only GET requests to `https://api.scaleway.com`. It has no resource creation, start, resize, SSH, package execution or deletion operation. A successful run does not authorize a paid execution. Any later provisioning workflow needs an approved execution and cost plan, resource identity tracking and cleanup for failure and interruption before creating resources. Existing manually provisioned machines are not inputs to this preflight.

## Protected configuration

Use the `scaleway-qualification` GitHub environment. Restrict deployment branches to the exact `main` branch, require approval by `AdrianMastronardi` and disable administrator bypass. Self-review remains permitted for the sole maintainer. Inspect the actual environment protections and deployment branch rules when setting up access; the workflow name or environment reference does not prove those settings are enforced.

The Scaleway API key belongs to the dedicated `ohtia-github-actions` IAM application. Its policy grants `InstancesFullAccess` under CPU & GPU Instances and `BlockStorageFullAccess` under Block Storage, scoped to the dedicated `ohtia-ci` project. These permission sets permit paid writes; they do not impose a resource shape or spending cap. The preflight exercises only reads and does not inspect that IAM policy or prove denied access to other projects. Review the policy separately in Scaleway.

Keep `SCW_SECRET_KEY` and `SCW_ACCESS_KEY` in environment secrets, with their recovery copies in the maintainer's password manager. The HTTP API authenticates with `SCW_SECRET_KEY` in `X-Auth-Token`; this workflow does not inject the unused access-key identifier into its process. Never put either value in repository files, workflow inputs, command-line arguments, reports or comments. The maintainer must track the API key's actual expiration and rotate it before expiry; this workflow neither reads its expiration nor renews it.

Configure these environment variables; none contains a credential:

- `SCW_PROJECT_ID`: the dedicated project's canonical UUID.
- `SCW_ARM_ZONE`: the approved availability zone, currently `nl-ams-1` (AMS1).
- `SCW_ARM_INSTANCE_TYPE`: the approved ARM SKU, currently `BASIC2-A8C-32G`.
- `SCW_ARM_DISK_GIB`: the planned disk size in GiB, currently `32`. Recording this value does not allocate or validate disk capacity.
- `SCW_ARM_FEDORA44_IMAGE_ID`: the zone-specific, ARM64, `instance_sbs` local image UUID with label `fedora_44`.
- `SCW_ARM_DEBIAN13_IMAGE_ID`: the zone-specific, ARM64, `instance_sbs` local image UUID with label `debian_trixie`.

Use Marketplace local image IDs for the selected zone, CPU and storage type, not global image IDs or `instance_sbs_snapshot` IDs. These IDs are configuration, not workflow source constants. A replacement image requires review and a fresh preflight; the checker does not silently resolve a moving label.[^marketplace-api]

## Execute and inspect

After the workflow is integrated into `main`, open Actions, choose **Scaleway access preflight**, select **Run workflow** on `main` and approve its protected environment deployment. There are no caller-supplied inputs. PR events do not run this workflow or receive its secrets. The job has a five-minute timeout, uses pinned checkout/setup/artifact actions with read-only repository contents access and does not persist checkout credentials.

The checker requires a matching main-only dispatch identity, GitHub-hosted Linux x64 context and matching workflow, source and actual checkout SHAs. These checks bind its report to the execution context; independently compare them with the actual GitHub run and reviewed workflow rather than trusting report strings alone.

The checker sends two authenticated, project-filtered, one-item-page requests: Instance listing with `project`, and Block Storage volume listing with `project_id` and `include_deleted=false`. An empty list records only that the authenticated, project-filtered list request was accepted; it does not prove authority over an existing resource, project membership or denial on another project. A returned resource from another project fails the observation. Resource names, addresses, IDs, counts and response bodies are not retained.[^instance-api][^block-api]

The public catalog requests check that the configured SKU is ARM64, not at end of service and supports Block Storage, and that both exact local images match their OS labels, ARM64, zone, bootable SBS type and compatible SKU. SKU lookup searches at most five pages of one hundred entries each, stopping when the configured SKU is found or a shorter terminal page establishes absence. The two exact local image reads are separate requests. Public catalog success alone does not test authentication. The checker does not reserve stock, estimate prices or test disk requirements.[^instance-types-api]

Requests use a fixed TLS origin without ambient HTTP proxy settings, redirect following or retries. Each connection has a twenty-second socket timeout, with a twenty-second deadline checked between body reads and a two-MiB response limit. Non-success responses, premature HTTP message termination, malformed or duplicate-key JSON and incompatible profiles fail closed. Diagnostics expose only a closed allowlist of fixed failure codes, distinguishing authorization, rate limiting and configuration failures while omitting provider bodies, arbitrary exception text and credentials. The workflow retains a report only after complete success.

Download `scaleway-access-<run-id>-<attempt>` from the completed run's artifacts. Its `report.json`, retained for fourteen days, records schema version, source/workflow/run/attempt, filtered-read outcomes and the configured ARM profile. `resources_created`, `write_authority_tested`, `project_policy_isolation_tested`, `disk_capacity_tested`, `stock_reserved` and `distribution_qualified` remain false. Failed or missing reports do not establish working access. Copy any evidence needed beyond artifact retention into controlled task records without adding credentials.

[^instance-api]: Instance listing supports project filtering and bounded `page`/`per_page` pagination.

[^block-api]: Block Storage listing uses `project_id`, `include_deleted`, `page` and `page_size`.

[^marketplace-api]: Marketplace local images distinguish zone, architecture, storage type and compatible commercial Instance types.

[^instance-types-api]: The Instance type catalog accepts `page` and `per_page`; a single default page is not the complete catalog.
