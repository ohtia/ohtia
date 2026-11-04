---
type: Playbook
title: Linux signing administration
description: Prepare independently reviewed Scaleway IAM and bucket-policy previews without exposing credentials or enabling signing.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
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

## Independent administration

Apply [ADR-0041](adr/adr-0041-independent-linux-signing-service.md) from a trusted administrative environment whose credentials and recovery do not depend on GitHub. Keep the signing Project exclusive to the approved signer containers, four selected secrets and its ingress/retained buckets. The administrator controls deployment, IAM, policy changes and recovery; invocation and runtime applications receive only their selected roles. [ADR-0045](adr/adr-0045-personally-signed-source-history.md) governs source-baseline and personal-key approval separately.

Use the [offline renderer](../scripts/installation_signing_policies.py) to prepare reviewable API payloads. It makes no provider request, creates no cloud resource, reads no ambient credential and accepts no credential field. Its output is a proposal requiring separate administrative approval. Select the reviewed renderer independently; a repository merge or a generated file does not authorize cloud changes.

## Bind identities without secret values

The [example bindings](../config/installation/signing-access.example.json) contain synthetic UUIDs and revisions for offline inspection. Replace them only in an ignored local binding file after the corresponding identities and secret metadata have been obtained through the separately authorized provisioning sequence. Record the exact Organization, exclusive Project, administrator user, invocation application, runtime application and four secret-version references. Verify application/secret ownership and Project membership independently; UUID syntax does not establish them. The invocation application, runtime application and administrative user are distinct identities.

`secret_versions` has exactly `rpm`, `rpm_passphrase`, `catalog` and `catalog_passphrase`, each containing a distinct `secret_id` and positive numeric `revision`. Do not include keys, passphrases, tokens, recovery material, environment dumps or secret payloads. The runtime adapter requires those exact roles and numeric versions; aliases such as `latest` are refused. IAM conditions limit access per secret, while the independently selected runtime configuration pins each version.[^resource-products][^secret-versions]

From the reviewed task checkout and its locked Python environment, prepare a new local directory:

```bash
.venv/bin/python -I scripts/installation_signing_policies.py \
  --bindings config/installation/signing-access.example.json \
  --output tmp/signing-access-preview
```

Use the example only for a synthetic preview. Real bindings and generated payloads stay outside Git under an independently controlled ignored/private location. The renderer refuses malformed, duplicate-key or oversized input and existing output directories. On POSIX, it creates the output directory with mode `0700` and files with mode `0600`. An interrupted write can leave a partial directory; retain it for inspection and choose a fresh destination rather than overwriting it. Check every payload against its SHA-256 entry in `plan.json` before any separately approved application.

The bundle contains `iam-invoker.json`, `iam-runtime.json`, `bucket-ingress.json`, `bucket-retained.json`, `runtime-fragment.json` and `plan.json`. The manifest identifies the fixed IAM POST and bucket-policy PUT destinations and the exact payload hashes. Its `bindings_sha256` hashes the validated bindings re-encoded as sorted, two-space-indented, ASCII-escaped JSON with a trailing newline using the renderer's `encode` function; payload hashes cover each payload file listed in `plan.json` as exact bytes. Its order places both bucket restrictions before runtime grants and invocation last; independent approval and provider readback are still required between operations. Do not automatically retry IAM creation after an ambiguous response: reconcile the actual created policy and its scopes first. These are data, not executable instructions or an authorization token. The runtime fragment supplies only `buckets` and `secret_versions`; it is not a complete deployable configuration and supplies no enabled policy.

## IAM scopes

The invoker policy grants only `ContainersPrivateAccess` in the selected Project. The runtime policy grants `ContainersReadOnly` there for independent deployment readback, `SecretManagerSecretAccess` conditioned on membership in the exact four-secret ID set, and `ObjectStorageObjectsRead`/`ObjectStorageObjectsWrite` for the selected Project. No rule uses Organization-wide scope. The policy payload's top-level `organization_id` identifies its owner; each rule's `project_ids` limits its scope.[^iam-policy-api][^permission-sets]

Reserve the `ContainersReadOnly` rule for the proposed deployment-readback consumer. Before attaching this runtime policy for a disposable rehearsal, implement and locally verify that consumer and have the administrator inspect and approve the permission set's actual expanded permissions, including any container configuration, token or secret exposure. The public catalog describes container list/read access but does not establish a secret-free response contract. If its expansion exceeds the approved boundary, revise the proposal and keep signing disabled.[^permission-sets]

Do not substitute FullAccess sets, policy editing, IAM administration, deletion or registry publication. Do not add a missing-resource-ID exception to the secret condition: a listing request without a matching secret must not acquire secret data access. Scaleway documents resource conditions for Secret Manager but not container-ID or bucket-ID scoping; Project isolation and bucket policies therefore remain part of the boundary.[^resource-conditions][^resource-products]

Object Storage IAM rights are necessary even when a bucket policy exists. The current bucket-policy version restricts those Project rights to its explicit principal/actions/resources; it does not independently grant storage access to an IAM-unprivileged application. With no bucket policy, Project IAM access applies to all storage resources in that Project. Keep only the approved buckets there, install/read back both restrictive policies before attaching the runtime data grants, and inspect inherited/group grants as well as the new policies. Do not treat these two layers as additive grants or omit IAM on the assumption that the bucket policy grants everything.[^combined-access][^bucket-policy]

## Bucket permissions

Bucket names are derived from the selected Project UUID: `ohtia-signing-ingress-<project-uuid>` and `ohtia-signing-retained-<project-uuid>`. Verify availability and the actual Project/region binding before provisioning. Both use the provider's `2023-04-17` policy format with explicit `Principal.SCW` application/user identities, provider bucket/object resource paths and TLS-only conditions. No anonymous principal, wildcard action or Deny statement is generated.[^bucket-policy]

The runtime may GET/HEAD ingress `objects/*` and retained `objects/*`, `journal/*` and `tokens/*`. It may PUT those same data paths only with `If-None-Match: *`. HEAD uses the provider's `s3:GetObject` permission. No list, delete, ACL, tagging, historical-version or bucket-policy operation is granted by the bucket statements.[^operation-permissions]

Create-only PUT statements combine the documented non-null conditional-header requirement with a `StringEquals` restriction to the literal `*`, plus TLS. Do not add multipart exemptions or a copy path. The adapters use single-object PUTs with that exact header and do not make copy/multipart calls. The provider documents conditional-copy rejection under enforced conditional-write policies. The provider's conditional-write guide explicitly demonstrates `Null` with `s3:if-none-match`; its general bucket-policy overview omits both from its supported-condition lists. Resolve this documentation gap through enforcing-boundary tests: a PUT without the header to a fresh key and a PUT with a wrong header value must be denied, while an overwrite with `If-None-Match: *` must be refused and preserve the original bytes. Qualify the exact combined condition before enabling signing; a local payload evaluator is not evidence of provider enforcement.[^conditional-writes][^bucket-policy]

The retained policy reserves the proposed activation object `control/active.json`. This is a draft access boundary for the planned independent-admission implementation. Finalize its canonical architecture contract and implement and locally verify that consumer before applying this template for a disposable rehearsal. The runtime may GET only that control object and cannot write it. Only the named administrator has explicit GET/PUT permission for that control object. Policy readback and policy management use the administrator's separately held IAM authority; no bucket-policy management action is inserted into the data policy. A named administrator must already hold the necessary independent IAM permissions. Neither application receives those administrative permission sets, and the renderer does not grant administrative IAM authority.[^bucket-policy]

## Approval and enforcing-boundary checks

Local consumer verification, the finalized admission contract and administrative approval of the expanded permissions precede any disposable test-key application. A separately authorized rehearsal may then apply the exact approved, hash-checked payloads in its exclusive test Project to perform the live qualification; the live tests do not precede their own test infrastructure. Keep production signing disabled and real signing keys out of this rehearsal. Successful live qualification is required before separately approved real-custody deployment and activation.

Review the generated bytes, input binding hash, operation destinations, effective/inherited IAM scopes, exact bucket statements and the complete dedicated-Project resource inventory before authorizing any mutation. Applying a bucket policy replaces its entire existing policy; do not apply this template over a shared bucket or silently discard other principals. Keep runtime invocation/admission disabled while creating and reading back the test-key infrastructure. Neither application may create another bucket or change its policy.[^bucket-policy]

Rehearse with disposable secrets before real custody: allowed requests and foreign-project/secret/principal refusals, absence of list/delete/ACL/policy-write rights, TLS and create-only conditions, same-key contention, ambiguous PUT/readback, and runtime refusal to write the control object. Confirm that absent-object and journal lookups have the semantics required by the adapters without listing rights; never reinterpret an access denial as a missing object. A missing key returning 403 instead of the required 404 blocks activation: leave signing disabled and resolve the adapter/policy contract through a separately reviewed change. Do not silently add listing rights or suppress the refusal. Test the four version pins separately from the coarser IAM secret restriction. Successful rendering, schema checks and local fixtures do not complete these live checks or authorize deployment.

Keep the backend API credential in the container's protected `OHTIA_SIGNING_BACKEND_SECRET_KEY` variable and its access-key ID in `OHTIA_SIGNING_BACKEND_ACCESS_KEY`. Neither variable is an input to this renderer or a GitHub signing-worker credential. Do not use `SCW_` environment names to assume native runtime federation, and do not expose administrative, storage or Secret Manager credentials to the invocation job. Key import, activation, credential rotation and recovery each retain their separately reviewed operation and readback requirements.

[^iam-policy-api]: Scaleway's creation API separates policy ownership/principal from project-scoped rules.

[^permission-sets]: The provider catalog defines the invocation, container-read, secret-data-read and object read/write sets.

[^resource-conditions]: Resource-ID conditions use CEL; missing-resource exceptions also affect listing behavior.

[^resource-products]: The supported-product list describes per-secret access, not per-version access.

[^combined-access]: IAM permits Project access first; configured bucket policies further restrict the permitted actions and principals.

[^bucket-policy]: The provider defines its policy version, principal/resource syntax, supported conditions, owner exceptions and replacement behavior.

[^conditional-writes]: The provider documents conditional headers, non-null policy enforcement and copy restrictions.

[^operation-permissions]: HEAD/Get operations require the corresponding object-read permission; mutation families have separate action mappings.

[^secret-versions]: Secret revisions are numbered, with aliases available in the API but excluded from the pinned runtime contract.
