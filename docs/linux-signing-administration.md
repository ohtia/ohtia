---
type: Playbook
title: Linux signing administration
description: Prepare independently reviewed Scaleway access and activation previews without exposing credentials or enabling signing.
sources:
  - id: iam-policy-api
    resource: https://www.scaleway.com/en/developers/api/iam/policies
    title: Scaleway IAM policy creation fields and project scopes
  - id: permission-sets
    resource: https://www.scaleway.com/en/docs/iam/policies-permissions/permission-sets/
    title: Scaleway permission sets
  - id: resource-conditions
    resource: https://www.scaleway.com/en/docs/iam/policies-permissions/understanding-resource-level-conditions/
    title: CEL resource-ID conditions
  - id: resource-products
    resource: https://www.scaleway.com/en/docs/iam/policies-permissions/supported-products-resource-level/
    title: Supported resource-condition products and secret granularity
  - id: combined-access
    resource: https://www.scaleway.com/en/docs/object-storage/api-cli/combining-iam-and-object-storage/
    title: Combining IAM and bucket policies
  - id: bucket-policy
    resource: https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-policy/
    title: Bucket policy principals, resources, actions and conditions
  - id: conditional-writes
    resource: https://www.scaleway.com/en/docs/object-storage/api-cli/using-conditional-writes/
    title: Enforcing conditional object creation
  - id: operation-permissions
    resource: https://www.scaleway.com/en/docs/object-storage/reference-content/s3-iam-permissions-equivalence/
    title: S3 operations and IAM permission-set equivalence
  - id: secret-versions
    resource: https://www.scaleway.com/en/developers/api/secret-manager/secret-versions
    title: Explicit Secret Manager version access
---

# Linux signing administration

## Roles and operating locations

The maintainer administers Scaleway from their laptop through an independently controlled administrative identity. The service runs and performs cryptographic operations in Scaleway; GitHub Actions requests operations with a narrowly scoped invocation credential. The administrator is a role of the maintainer, not an additional person required for each package. Its authority covers IAM, deployment, activation, revocation and recovery. Runtime and invocation applications are distinct identities with different permissions.

Use the same [configuration placement rule as ARM](scaleway-configuration.md): deployment selections come from GitHub repository Variables, workflow credentials from the appropriate environment Secrets, and private signing/backend/administrative material stays outside GitHub. A Project identifier identifies infrastructure; it is neither an API credential nor a field supplied with a package-signing request. A local generated JSON file is a proposal/snapshot for review, not another editable configuration store.

[ADR-0041](adr/adr-0041-independent-linux-signing-service.md) owns the signing authority and runtime contract. [ADR-0045](adr/adr-0045-personally-signed-source-history.md) owns personal-source signatures and initial baseline approval. The procedures below prepare proposals and describe their separately authorized handoffs; generation performs no deployment or activation.

## Prepare access from repository Variables

Create or identify the dedicated signing Project, its two buckets, distinct invocation/runtime applications and four Secret Manager versions through the separately authorized Scaleway setup. Keep that Project exclusive to the approved signer resources. Verify actual ownership and region through provider metadata; UUID syntax and bucket names do not establish membership. The [signing access map](scaleway-configuration.md#signing-access-metadata) names the fifteen repository Variables and the [caller map](scaleway-configuration.md#signing-caller-metadata-and-credential) names the service origin and invocation Secret. Populate actual metadata there once; never place private keys, passphrases or API credentials in those Variables.

From the reviewed task checkout on the maintainer's laptop, fetch all pages with the authenticated GitHub CLI and pass them directly to the offline generator:

```bash
set -o pipefail
gh api --hostname github.com --paginate --slurp \
  'repos/{owner}/{repo}/actions/variables?per_page=30' | \
  .venv/bin/python -I scripts/installation_signing_policies.py \
    --github-variables \
    --output tmp/signing-access-preview
```

The GitHub CLI performs read-only GitHub metadata requests; the renderer makes no provider/network request, reads no ambient credential and accepts no credential field. It rejects incomplete paginated metadata, duplicates, aliases and invalid bindings before output. It writes a fresh private proposal directory and refuses an existing directory. Inspect a partial failed output and select a fresh destination rather than overwriting evidence.

The output contains IAM proposals for invocation/runtime, restrictive proposals for the two buckets, a runtime metadata fragment and a manifest. Review the destinations, proposed grants, operation order and payload hashes in `plan.json`. The manifest describes data; it does not execute requests, supply an authorization token or approve mutations. Install and read back both bucket restrictions before granting runtime data access; invocation is granted last. After an ambiguous IAM POST response, reconcile the actual policy before retrying creation.

For a completely offline synthetic preview, use the supplied example instead of GitHub metadata:

```bash
.venv/bin/python -I scripts/installation_signing_policies.py \
  --bindings config/installation/signing-access.example.json \
  --output tmp/signing-access-example
```

These UUIDs, versions and identities are synthetic and grant nothing. Real generated records stay outside Git and public logs. On POSIX the generator creates directories with mode `0700` and files with mode `0600`; these protect local working files and do not encrypt them.

## Review permissions before application

The invocation application receives only Project-scoped `ContainersPrivateAccess`. The runtime application receives `ContainersReadOnly` for independent deployment readback, `SecretManagerSecretAccess` conditioned on the exact four secret IDs, and the selected Project's `ObjectStorageObjectsRead`/`ObjectStorageObjectsWrite`. The policy's Organization identifies its owner; per-rule Project IDs restrict its scope. No Organization-wide grant, FullAccess substitute, IAM administration or registry publication is selected.[^iam-policy-api][^permission-sets]

Before attaching even disposable runtime credentials, review actual expanded and inherited grants. Container read permission may expose configuration, tokens or secrets; the permission-set name is not evidence of secret-free responses. If its actual scope exceeds the approved boundary, revise the proposal and leave signing disabled. Verify the administrative identity already has its separately held authority; the renderer does not grant it.

The secret condition selects resources, not versions. Runtime configuration independently pins each positive numeric version of `rpm`, `rpm_passphrase`, `catalog` and `catalog_passphrase`; `latest` aliases and reused secret IDs are refused. Do not add a missing-resource-ID exception merely to permit listing. Provider resource conditions cover Secret Manager but do not establish container-ID or bucket-ID scoping.[^resource-conditions][^resource-products][^secret-versions]

Object Storage requires both IAM rights and the restrictive bucket policy; a bucket statement does not independently grant IAM-unprivileged access. With no bucket restriction, Project grants reach other resources in that Project. Review its complete resource inventory and all existing statements before applying a replacement policy. Never overwrite an unrelated shared bucket policy.[^combined-access][^bucket-policy]

The emitted `2023-04-17` statements select explicit application/user principals and require TLS. Runtime GET/HEAD covers its exact data prefixes; PUT requires `If-None-Match: *`. Runtime has read-only access to `control/active.json`, while only the named administrator receives its explicit GET/PUT permission. Neither application receives bucket administration, creation, list/delete or control-write authority. [ADR-0041](adr/adr-0041-independent-linux-signing-service.md#independent-activation-and-deployment-admission) owns the exact activation object and runtime checks.[^operation-permissions]

Qualify the combined non-null and literal-value conditional policy at the provider: missing/wrong headers must be denied and overwrites refused without changing prior bytes. The conditional-write guide demonstrates the header condition, while the general bucket overview omits some of its operators. Do not substitute a local payload evaluator for enforcement, add multipart exemptions or switch to copy operations.[^conditional-writes][^bucket-policy]

## Generate the complete runtime configuration

Select the separately approved public policy: container/image identity, source baseline, personal source public keys, immutable workflow revisions and public signing identities. The real policy is not selected or approved by a repository Variable, package request or ordinary merge. The supplied [disabled policy example](../config/installation/signing-policy.example.json) contains synthetic deployment, key and workflow identities together with the fixed public Ohtia repository and owner IDs and is usable for the offline exercise below.

Combine the generated fragment with the selected policy using the [offline configuration producer](../tooling/installation-signing-configuration.mjs):

```bash
.tooling/node/bin/node tooling/installation-signing-configuration.mjs \
  --fragment tmp/signing-access-example/runtime-fragment.json \
  --policy config/installation/signing-policy.example.json \
  --output tmp/signing-runtime-example \
  --caller config/installation/signing-caller.example.json
```

The producer validates all bounded, duplicate-free JSON inputs before output and writes `runtime.json`, `client-template.json` and `plan.json` in a new private directory. It serializes the complete runtime with the [canonical encoding](adr/adr-0041-independent-linux-signing-service.md#independent-activation-and-deployment-admission); do not manually reformat those bytes. The caller template is always disabled and contains null resource placeholders; its metadata will come from the repository Variables. Review its public trust policy as an authorization proposal, not automatically approved configuration.

For real preparation, use the actual access-preview fragment and separately approved public policy file with a fresh destination. Review each manifest's exact file hashes and the complete configuration identity before any administrative handoff. No key value, credential or alias belongs in the policy or fragment. On POSIX the output directory/files use `0700`/`0600`; interrupted output can remain partial for inspection.

## Bind the caller destination

The runtime can be prepared and deployed disabled before a service endpoint exists. In that bootstrap case, omit `--caller`; the generated client template has a null `resource_bindings_sha256` and cannot invoke even if its enable flag is changed. Do not infer or approve a service endpoint merely from its provider hostname suffix.

After the disabled deployment exists, independently read back its exact endpoint and container identity from Scaleway. Check them against the approved deployment, set `SCW_SIGNING_SERVICE_ORIGIN` to that endpoint, and inspect repository, environment and applicable organization Variables for duplicate names as required by [the shared scope rule](scaleway-configuration.md#shared-placement-rule). Fetch the repository metadata again from the laptop:

```bash
set -o pipefail
gh api --hostname github.com --paginate --slurp \
  'repos/{owner}/{repo}/actions/variables?per_page=30' | \
  .venv/bin/python -I scripts/installation_signing_policies.py \
    --caller-variables \
    --output tmp/signing-caller-preview
```

This independent mode requires only the three caller Variables, so IAM preparation does not depend on an endpoint that has not been created. It produces `caller-fragment.json` and a manifest without IAM operations or authority. Repeat runtime assembly with the actual access fragment and public policy, supplying `--caller tmp/signing-caller-preview/caller-fragment.json` and a fresh output destination. Bucket values must match the runtime fragment exactly. The producer generates the commitment and disabled template together; never copy a hash into a GitHub Variable or manually synchronize it with another editable locator file.

Review the generated caller snapshot against provider readback, the manifest and the public policy before proposing the template as `config/installation/signing-client.json`. Its literal locators stay null; the commitment constrains values injected from Variables before any invocation/OIDC credential is sent. A reviewed, qualified, separately authorized source change must admit the enabled template and update the calling workflow's reusable-worker pin to the complete immutable recipe SHA. Match that recipe to the independently approved signing policy and repeat the affected qualification. The current caller pin and disabled client are not activated by the generator or by this procedure. A bucket or endpoint change requires a replacement reviewed commitment and recipe, as a change of credential destination would for ARM.

## Prepare activation or revocation

The synthetic policy remains disabled. Generate its disabled control preview without provider access:

```bash
.tooling/node/bin/node tooling/installation-signing-activation.mjs \
  --configuration tmp/signing-runtime-example/runtime.json \
  --output tmp/signing-activation-example \
  --enabled false
```

The activation producer writes `active.json`, `container-requirements.json` and `plan.json`, without a network request. Existing destinations and symlink/nonordinary inputs are refused. Review the retained-bucket/control destination, exact payload hashes and complete runtime identity before approving an application. Generating enabled control requires an independently approved policy with `enabled: true`; neither policy enablement nor generated control activates a service by itself.

For actual activation, deploy the approved image/configuration, inspect the container and namespace and replace/read back the exact approved control through administrative authority only after the disposable qualification below succeeds. Keep [the repository client](../config/installation/signing-client.json) disabled until its public policy and deployed enforcing-boundary evidence are approved. A generated caller template needs that separate review before an authorized source update; leave resource placeholders null so the worker uses Variables. Configuration and policy hashes are produced by tools rather than copied into an approval Variable manually.

For revocation, generate a fresh control proposal from the same approved runtime with `--enabled false`, review it, then replace/read back that exact control as administrator. Warm workers reread control at checkpoints. This is not atomic cancellation of an in-progress effect and it does not revoke runtime credentials. Preserve uncertainty records; do not restore operation by clearing journals, guessing absent outcomes or silently advancing the source baseline.

## Deploy and qualify the disabled service

Use independently controlled Scaleway administration to deploy the selected digest-addressed image and generated runtime under the fixed requirements. Put the exact canonical runtime JSON in the container's public `OHTIA_SIGNING_CONFIGURATION` entry. Put the runtime application's access-key ID in secret entry `OHTIA_SIGNING_BACKEND_ACCESS_KEY` and its API secret in `OHTIA_SIGNING_BACKEND_SECRET_KEY`. The namespace supplies no inherited environment. Do not embed these values in the image, source, generated public policy or Actions; `SCW_` metadata names imply no native credential federation.

Import only disposable encrypted signing material and its passphrases into the four selected Secret Manager versions for the rehearsal. Private keys and backend credentials never enter the GitHub invocation job. The production certification primary key, revocation certificate and full recovery backups remain in independently protected custody outside the service. Verify the actual imported public identities and enabled numbered versions without printing secret payloads.

Complete local consumer checks and administrative permission review before applying disposable infrastructure proposals. Then qualify actual private invocation, deployment/readback, OIDC/source/build composition, conditional writes, foreign Project/secret/principal refusals, no list/delete/ACL/policy/control-write authority, repeated/concurrent requests and ambiguous effect recovery. Confirm missing-object/journal semantics without list permission: a required absent lookup returning 403 rather than 404 blocks activation. Do not add listing rights or reinterpret denial as absence to force a pass.

Record the selected image digest, pinned native package manifest, observed runtime/capacity/helper lifecycle and dependency notices. A base-image name alone does not identify what ran. The [image manifest](../config/installation/signing-image.json) and separately retained probe results are different evidence; a previous image test does not qualify changed inputs, actual provider storage limits or real key custody. Keep the retained journal and control separate from disposable Actions artifact retention.

Keep actual provider dump/swap exposure, cold start/termination, storage races, effective grants, credential expiry/rotation and recovery in the qualification evidence with their real coverage limits. Real signing keys and enabled invocation require separately approved real-custody deployment after those gates. Rendering a JSON proposal or passing fixtures completes neither gate.

## Request package operations

After the service and immutable caller policy are qualified, the approved Actions worker receives the service origin/bucket Variables and `OHTIA_SIGNING_INVOKE_TOKEN` from its protected environment. The provider credential admits private invocation; a separate OIDC proof authenticates the current admitted job. A request cannot provide a Project, choose a key, replace policy or administer Scaleway.

RPM operations produce and verify the approved native signature. DEB binding preserves authenticated build bytes and creates no native DEB signature; the signed catalog authenticates those package bytes, and service receipts have their own signatures. The operation does not install a package, execute its scripts, publish a release or establish the graphical first-install/update route.

## Rotate credentials and recover

From the independent administrative environment, inspect the actual credential owner, expiry and expanded/inherited grants against the intended role. A configured expiry assertion or successful invocation is not proof of the full permission boundary. Prepare rotation with disposable credentials first, inspect the new effective scope, replace the relevant protected credential and verify allowed/denied operations and actual readback before retiring the old credential. Do not request or print credential values in chat or logs.

The maintainer changes the invoker credential in the GitHub `installation-signing` environment Secret; backend rotation changes only the Scaleway container's protected entries and follows its deployment-admission requirements. Updating selected secret versions, approved policy, image or runtime metadata requires a new independently approved generated runtime/control identity. Credential rotation never discards uncertain journals or grants permission to re-sign an unknown outcome.

Preserve the retained journal, approved source baseline, control/configuration identities, public verification material and independently protected recovery backups. Test restoration, lost/revoked credentials and maintainer absence with disposable resources before real custody. During an authority or storage outage, refuse affected work and retain the obligation to reconcile; expired caller tokens and cancelled Actions runs do not establish absence or authorize another signature. Follow the [shared configuration rule](scaleway-configuration.md#shared-placement-rule) when changing workflow credentials or deployment metadata. The ARM facility's [recovery and observed-package evidence](scaleway-qualification.md#evidence-and-limits) remains separate from the signer's retained state and independently qualified recovery.

[^iam-policy-api]: Scaleway's creation API separates policy ownership/principal from project-scoped rules.

[^permission-sets]: The provider catalog defines the invocation, container-read, secret-data-read and object read/write sets.

[^resource-conditions]: Resource-ID conditions use CEL; missing-resource exceptions also affect listing behavior.

[^resource-products]: The supported-product list describes per-secret access, not per-version access.

[^combined-access]: IAM permits Project access first; configured bucket policies further restrict the permitted actions and principals.

[^bucket-policy]: The provider defines its policy version, principal/resource syntax, supported conditions, owner exceptions and replacement behavior.

[^conditional-writes]: The provider documents conditional headers, non-null policy enforcement and copy restrictions.

[^operation-permissions]: HEAD/Get operations require the corresponding object-read permission; mutation families have separate action mappings.

[^secret-versions]: Secret revisions are numbered, with aliases available in the API but excluded from the pinned runtime contract.
