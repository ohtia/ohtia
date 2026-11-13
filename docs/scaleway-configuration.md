---
type: Reference
title: Scaleway configuration
description: Place deployment metadata and workflow credentials consistently for ARM qualification.
generated:
  by: claude-code/claude-fable-5-2
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

ARM qualification uses GitHub repository Variables as the source for deployment selections such as Project identifiers and image selections. Identifiers contain no private key or API credential. Workflow `env` mappings inject selected values; they do not establish another configuration store. The [ARM variable map](scaleway-qualification.md#configuration-placement) defines the actual consumers. GitHub Variables store non-sensitive configuration and their values are not automatically masked in logs.[^variables]

Keep workflow credentials in the protected environment Secrets selected for their role. ARM creator and recovery credentials remain separate. A uniform placement rule does not give these identities the same permissions.[^secrets]

Reviewed source owns code, tool versions, limits and authorization contracts. A repository variable edit or ordinary merge cannot approve its own deployment.

Deployment Variables named by the map belong to the repository scope. Do not define the same names in an environment or organization scope: duplicate definitions make ownership and later consumption ambiguous. GitHub documents that environment-level Variables become available only after the job starts and do not overwrite the `env` and `vars` contexts; do not assume a duplicate silently overrides this workflow's job-level `env` mapping.[^variable-precedence] Before a change, inspect repository, environment and applicable organization Variables with administrative read access and remove conflicting definitions through the separately authorized configuration procedure. An effective value must also satisfy the consumer's approved constraints; metadata placement alone is not authorization.

## ARM metadata and credentials

The [ARM configuration map](scaleway-qualification.md#configuration-placement) owns its variable names and creator/recovery environments. Preserve its one-dispatch procedure and independent recovery. The resource policy remains versioned; no manually synchronized policy-approval hash is required. Repository Variables do not replace per-run paid-creation approval or verified recovery evidence.

## Changes and readback

Prepare a replacement metadata snapshot, validate it, compare its exact differences and independently review the affected policy/control before applying a change. Record actual provider and GitHub readback without raw credentials or private provider responses.

Full-SHA action and reusable-workflow pins and the existing action restrictions remain the workflow dependency controls; this configuration adds no workflow dependency lockfile. The ARM [admission and lifecycle](scaleway-qualification.md#admission-and-lifecycle) and [evidence contract](scaleway-qualification.md#evidence-and-limits) define lost-allocation recovery and observed guest package inventories.

[^variables]: GitHub configuration variables are intended for non-sensitive reusable settings.

[^secrets]: GitHub environment Secrets supply credentials to the jobs authorized to receive them.

[^variable-precedence]: Configuration Variable precedence also depends on when environment-level values become available.
