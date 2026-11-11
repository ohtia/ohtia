---
type: Reference
title: Scaleway configuration
description: Place deployment metadata, workflow credentials and independently approved policy consistently across ARM qualification and Linux signing.
sources:
  - id: variables
    resource: https://docs.github.com/en/actions/concepts/workflows-and-actions/variables
    title: GitHub configuration variables
  - id: variable-precedence
    resource: https://docs.github.com/en/actions/reference/workflows-and-actions/variables#configuration-variable-precedence
    title: GitHub configuration variable precedence and availability
  - id: secrets
    resource: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
    title: GitHub workflow secrets
---

# Scaleway configuration

## Shared placement rule

ARM qualification and Linux signing use GitHub repository Variables as the source for deployment selections such as Project identifiers, bucket names, image selections and service addresses. Identifiers and secret-version references contain no private key or API credential. Workflow `env` mappings inject selected values; they do not establish another configuration store. The [ARM variable map](scaleway-qualification.md#configuration-placement) and signing map below define the actual consumers. GitHub Variables store non-sensitive configuration and their values are not automatically masked in logs.[^variables]

Keep workflow credentials in the protected environment Secrets selected for their role. ARM creator and recovery credentials remain separate. The signing worker receives only its invocation credential in `installation-signing`; the signer backend and administrative credentials remain outside GitHub. A uniform placement rule does not give these identities the same permissions.[^secrets]

Reviewed source owns code, tool versions, limits and authorization contracts. An approved public signing policy fixes source/key/workflow/deployment identities; its external activation record approves an exact generated runtime snapshot. Those are authorization records, rather than a second editable deployment-variable map. A repository variable edit, successful rendering or ordinary merge cannot approve its own deployment. [ADR-0041](adr/adr-0041-independent-linux-signing-service.md#independent-activation-and-deployment-admission) owns this signing boundary.

Use the maintainer's laptop to prepare and administer the signer through independently controlled Scaleway authority. The cryptographic operation runs in Scaleway. Generated local JSON is a reviewable snapshot derived from the selected variables and public policy, not a manually maintained source of infrastructure identifiers. Keep it outside Git and public logs; never place private keys, passphrases or administrative API credentials in these records.

Deployment Variables named by either map belong to the repository scope. Do not define the same names in an environment or organization scope: administrative preparation reads repository Variables, and duplicate definitions make ownership and later consumption ambiguous. GitHub documents that environment-level Variables become available only after the job starts and do not overwrite the `env` and `vars` contexts; do not assume a duplicate silently overrides this workflow's job-level `env` mapping.[^variable-precedence] Before a change, inspect repository, environment and applicable organization Variables with administrative read access and remove conflicting definitions through the separately authorized configuration procedure. An effective value must also satisfy the consumer's approved constraints; metadata placement alone is not authorization.

## ARM metadata and credentials

The [ARM configuration map](scaleway-qualification.md#configuration-placement) owns its variable names and creator/recovery environments. Preserve its one-dispatch procedure and independent recovery. The resource policy remains versioned; no manually synchronized policy-approval hash is required. Repository Variables do not replace per-run paid-creation approval or verified recovery evidence.

## Signing access metadata

Set these repository Variables from the corresponding Scaleway resources. Project selection identifies the existing dedicated signing Project; it is not a choice made for each package. Obtain actual identifiers from provider metadata and verify their ownership before using the generated proposal.

- `SCW_SIGNING_ORGANIZATION_ID`: Organization owning the IAM policies.
- `SCW_SIGNING_PROJECT_ID`: dedicated Project used for IAM scope and namespace comparison.
- `SCW_SIGNING_ADMINISTRATOR_USER_ID`: independently controlled administrative user allowed to replace activation control.
- `SCW_SIGNING_INVOKER_APPLICATION_ID`: application limited to private-container invocation.
- `SCW_SIGNING_RUNTIME_APPLICATION_ID`: service application with the selected read/storage/secret grants.
- `SCW_SIGNING_INGRESS_BUCKET`: existing ingress bucket name.
- `SCW_SIGNING_RETAINED_BUCKET`: existing retained bucket name.
- `SCW_SIGNING_RPM_SECRET_ID` and `SCW_SIGNING_RPM_REVISION`: encrypted signing-subkey secret and explicit positive version number.
- `SCW_SIGNING_RPM_PASSPHRASE_SECRET_ID` and `SCW_SIGNING_RPM_PASSPHRASE_REVISION`: its passphrase secret and version number.
- `SCW_SIGNING_CATALOG_SECRET_ID` and `SCW_SIGNING_CATALOG_REVISION`: encrypted catalog-key secret and version number.
- `SCW_SIGNING_CATALOG_PASSPHRASE_SECRET_ID` and `SCW_SIGNING_CATALOG_PASSPHRASE_REVISION`: its passphrase secret and version number.

[The access renderer](../scripts/installation_signing_policies.py) consumes the complete paginated Variables response through `--github-variables`. It maps exactly these fifteen values into the validated access record and ignores unrelated variables. It refuses incomplete or duplicate pages/names, malformed identifiers, reused roles, aliased versions and excessive input before writing output. The generator performs no network request; the preceding authenticated GitHub CLI command reads repository metadata. Neither operation uses Scaleway administrative credentials.

## Signing caller metadata and credential

The [signing workflow](../.github/workflows/signing-worker.yml) injects these repository Variables into its fixed worker:

- `SCW_SIGNING_SERVICE_ORIGIN`: exact approved HTTPS service origin ending in `.fnc.fr-par.scw.cloud`, without a path, credentials, query or port.
- `SCW_SIGNING_INGRESS_BUCKET` and `SCW_SIGNING_RETAINED_BUCKET`: the same bucket variables used by administrative preparation.

The worker does not need a Project UUID to request a package operation. Its immutable recipe retains the public trust policy and disabled/enabled admission in [the client template](../config/installation/signing-client.json); its `service_origin` and `buckets` fields remain null placeholders. Enabled execution requires the three injected variables and refuses an embedded resource fallback. Public keys, the source anchor and allowed workflow identities are not overridden by environment metadata.

Before credential release, both bootstrap and caller validate the effective three locator values against `resource_bindings_sha256` in the immutable template. The offline producer generates this authorization commitment from the reviewed caller snapshot; it is not a manually maintained GitHub approval-hash Variable or a second editable address store. This preserves the same destination rule as ARM's fixed provider API origins: a metadata editor cannot redirect credential-bearing traffic. A different valid Scaleway tenant address is refused as well. A null commitment remains ineligible even if someone changes only the enabled flag. [The caller preparation procedure](linux-signing-administration.md#bind-the-caller-destination) defines endpoint readback and the reviewed recipe handoff.

Store `OHTIA_SIGNING_INVOKE_TOKEN` only in the `installation-signing` environment Secret. Backend access-key/secret-key values belong in the Scaleway container's protected entries described by [signing administration](linux-signing-administration.md#deploy-and-qualify-the-disabled-service). Private signing material belongs in separately approved Secret Manager versions and independent recovery custody. No key value belongs in a repository Variable, a source template, an image or a public artifact.

## Changes and readback

Prepare a replacement metadata snapshot, validate it, compare its exact differences and independently review the affected policy/control before applying a change. Record actual provider and GitHub readback without raw credentials or private provider responses. The signing access, runtime-assembly and activation manifests bind generated bytes; they do not authorize execution or change remote settings.

Keep variable placement consistent in ARM and signing. Review shared consumer changes against both facilities while preserving their separate authority and recovery contracts. Full-SHA action and reusable-workflow pins and the existing action restrictions remain the workflow dependency controls; this configuration adds no workflow dependency lockfile. The ARM [admission and lifecycle](scaleway-qualification.md#admission-and-lifecycle) and [evidence contract](scaleway-qualification.md#evidence-and-limits) define lost-allocation recovery and observed guest package inventories. Those guest records do not qualify signer custody, deployment or recovery.

[^variables]: GitHub configuration variables are intended for non-sensitive reusable settings.

[^secrets]: GitHub environment Secrets supply credentials to the jobs authorized to receive them.

[^variable-precedence]: Configuration Variable precedence also depends on when environment-level values become available.
