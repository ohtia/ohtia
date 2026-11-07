---
type: DecisionRecord
title: ADR-0041 — Independently administered Linux signing service
description: Separate Linux signing requests from key custody and policy administration using a bounded Debian-based Scaleway container service.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: scaleway-private
    resource: https://www.scaleway.com/en/docs/serverless-containers/how-to/secure-a-container/
    title: Private container invocation and IAM
  - id: scaleway-limits
    resource: https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/
    title: Container architecture, capacity and execution limits
  - id: container-readback
    resource: https://www.scaleway.com/en/developers/api/serverless-containers/containers
    title: Container v1 configuration and readiness readback
  - id: container-schema
    resource: https://www.scaleway.com/en/developers/api/serverless-containers/~schemas
    title: Container v1 scaling alternatives and configuration types
  - id: namespace-readback
    resource: https://www.scaleway.com/en/developers/api/serverless-containers/namespaces
    title: Namespace v1 project and inherited environment readback
  - id: github-oidc
    resource: https://docs.github.com/en/actions/reference/security/oidc
    title: Authenticated Actions execution claims
  - id: gh-attestation
    resource: https://cli.github.com/manual/gh_attestation_verify
    title: Artifact verification and authenticated certificate fields
  - id: sigstore
    resource: https://docs.github.com/en/actions/concepts/security/artifact-attestations
    title: Public repository attestation trust
  - id: checksums
    resource: https://www.scaleway.com/en/docs/object-storage/reference-content/supported-checksums/
    title: Supported object checksums
  - id: jose
    resource: https://github.com/panva/jose/releases/tag/v6.2.12
    title: JOSE implementation release
  - id: secret-manager
    resource: https://www.scaleway.com/en/developers/api/secret-manager/secret-versions
    title: Explicit secret-version access
  - id: scaleway-s3-concepts
    resource: https://www.scaleway.com/en/docs/object-storage/concepts/
    title: Object Storage concepts — Amazon S3 compatibility and Scaleway authentication
  - id: scaleway-s3-faq
    resource: https://www.scaleway.com/en/docs/object-storage/faq/
    title: Object Storage FAQ — What is Object Storage?
  - id: aws-sdk
    resource: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
    title: S3 commands and presigning
  - id: tini
    resource: https://github.com/krallin/tini
    title: Container PID 1 signal forwarding and child reaping
  - id: debian-lifecycle
    resource: https://www.debian.org/releases/trixie/
    title: Debian 13 support lifecycle
  - id: debian-tini
    resource: https://packages.debian.org/trixie/tini
    title: Debian native init helper package
  - id: rpm-header
    resource: https://rpm.org/docs/4.20.x/manual/format_header.html
    title: RPM immutable header structure
  - id: gpg-status
    resource: https://github.com/gpg/gnupg/blob/STABLE-BRANCH-2-4/doc/DETAILS
    title: GnuPG machine-readable signature status
  - id: conditional-storage
    resource: https://www.scaleway.com/en/docs/object-storage/api-cli/using-conditional-writes/
    title: Conditional object creation and replacement
---

# ADR-0041 — Independently administered Linux signing service

## Context

[ADR-0038](adr-0038-desktop-delivery-mechanisms.md) requires authentic Linux packages and exact-byte catalogs; [ADR-0020](adr-0020-github-policy-and-trusted-ci.md) requires actual authority outside untrusted workflow execution. A workflow holding both private keys and permission to replace its verifier would control its own signing policy. [Shared delivery admission](../delivery-admission.md) consumes verified evidence and does not supply that missing authority.

Consider a dedicated VM, a container invoked on demand and a dedicated key-management service. A VM permits the existing GnuPG/RPM toolchain but adds operating-system maintenance. A managed key service requires a qualified adapter between its signing primitives and the selected OpenPGP/catalog formats. A container permits those tools while separating invocation from administrative credentials, with provider and software-custody risks that must remain explicit.

## Decision

Use a private Scaleway Serverless Container in a dedicated signing Project, with a separate policy/deployment administrator and an invocation application limited to private-container access. Build the image for linux/amd64; signing an ARM64 RPM does not execute or qualify that package. Start with minimum scale zero, maximum scale one, one request per instance and separately reviewed capacity. Scaling settings do not establish global exclusion during deployment overlap.[^scaleway-private][^scaleway-limits]

Keep the RPM certification primary key, revocation certificate and full recovery backups outside the service. Provision only the authorized signing subkey and the catalog key through separately approved protected custody. The service must verify their independently selected public identities before use. Neither the invocation credential nor the Actions execution receives private keys, passphrases, backend storage access or administrative permission. Software key custody does not provide HSM isolation from the service, cloud administrator or provider.

The deployed image and external policy own repository identities, source trust, immutable reusable workflow revisions, allowed input/proof formats, public keys, storage origins, revocation and the kill switch. A request cannot select another verifier, policy, executable, destination or key. Changes to these controls require separate administrative authorization and actual readback; an ordinary source merge does not require copying a policy hash into a repository variable.

### Container image

Use the Debian 13 runtime base, GnuPG `2.4.*`, RPM `4.20.*`, OpenSSH `10.0p*` and Tini `0.19.*` for the Linux signing image. Tini runs as PID 1 to forward signals and reap terminated descendants; the signing supervisor and GnuPG cleanup retain their separate responsibilities.[^tini][^debian-tini] [The image manifest](../../config/installation/signing-image.json) owns the exact base digest and native package artifacts. Node and pnpm follow [ADR-0004](adr-0004-javascript-development-toolchain.md); the GitHub CLI uses the existing [qualification tool artifact](../../config/installation/scaleway.json). Preserve the runtime dependency notices alongside the service bundle.

Debian's longer maintenance window reduces major-base transitions compared with Fedora's shorter release cycle. Debian publishes full support through August 2028 and LTS through June 2030; later architecture and package coverage must be checked explicitly.[^debian-lifecycle] Digest pinning preserves reviewed inputs, not security freshness: the signing administrator must review and rebuild OS packages, Node, CLI and locked dependencies for security updates, retain rollback evidence and qualify the resulting image before deployment. The signer base does not change the Fedora desktop qualification targets.

[The context assembler](../../scripts/installation_signing_image.py) takes a new destination directory, checks the pinned artifacts, and includes only the native packages, selected Node/CLI files, bundled signer, supervisor and required policy/target records. It creates a fresh isolated frozen-lockfile installation from the existing verified package cache, using checksum-verified Node and pnpm artifacts with lifecycle scripts and configuration hooks disabled. It checks store integrity, excludes developer node_modules and does not inherit ambient credential environment variables, and refuses a changed lock. It never copies the whole checkout, credentials, fixture keys or developer dependency tree. Missing upstream license files require explicit version-specific, digest-bound notice mappings in the image manifest; an undeclared missing notice fails assembly. [The container recipe](../../tools/installation-signer/Containerfile) installs the verified native packages without network access, creates an ordinary Unix account and group, normalizes public code/tool readability independently of the invoking umask, runs the service under that UID and sets soft and hard `RLIMIT_CORE` to zero before executing Tini through its fixed entrypoint. This process limit does not establish how the provider handles host-level crash collection; qualify dump, swap and host-access assumptions separately before enabling real custody. Temporary key material remains confined to the private sandbox-v2 temporary homes already required by the custody contract.

[The container transport](../../tooling/installation-signing-container.mjs) composes the provider adapters with the existing authority and worker implementations, returning exact-object provider transfer capabilities through the same three request endpoints. Metadata reception uses the existing suboperation time bound and does not own the single signing slot before bounded body collection completes. The trusted canonical configuration selects the public policy, ingress/retained buckets and four numbered secret references; separate container-only backend credentials are never supplied by a request. An enabled local policy also requires the independent activation and deployment admission defined below; a disabled policy refuses admission without provider access. Listening on the provider port is not evidence that signing authority is enabled. Removing backend variables from Node's `process.env` reduces accidental inheritance; it does not erase exec-time environment data or prevent a compromised same-UID helper from reading process memory, `/proc` or private working files. The pinned native helpers and service share the software-custody trust boundary; the scrub is not a sandbox or credential broker.

### Independent activation and deployment admission

The administrator alone may replace retained-bucket `control/active.json`; the runtime has exact-object read permission and no control-write permission. This canonical version-1 object has exactly six fields: `schema_version`, `enabled`, `policy_sha256`, `configuration_sha256`, `container_id` and `image_digest`. Enabled admission requires `enabled: true` and equality with the independently selected configuration. Missing, malformed, noncanonical, disabled or mismatched control data refuses admission. A disabled record retains the approved configuration identity while revoking its use.

The [offline activation producer](../../tooling/installation-signing-admission.mjs) computes both hashes. `policy_sha256` covers the canonical public policy. `configuration_sha256` covers canonical `{configuration, container_requirements}`: the complete closed runtime record (`schema_version`, `policy`, `buckets`, `secret_versions`) and the fixed requirements exported by that module. Buckets derive from one nonzero Project UUID; four distinct nonzero secret UUIDs select positive numeric revisions. Credentials, key payloads and aliases such as `latest` are excluded. The image remains identified by SHA-256, and the policy identifies the exact container. Changing policy, buckets, selected secret revisions or deployment requirements requires independently approving new generated control bytes; no repository SHA variable is maintained manually.

Admit only a private, ready, error-free Paris container using a digest-addressed image in `rg.fr-par.scw.cloud` matching the approved image digest. Require minimum scale zero, maximum scale one, concurrent-request scaling threshold one, HTTP/1, port 8080, HTTPS-only connections, sandbox v2, no command/argument override, no private network and an enabled default public endpoint protected by private IAM. [The resource policy](../../config/desktop/resource-policy.json) owns the selected capacity: 4 GiB memory, 1000 millicpu and 1 GB local storage; the timeout equals the 1200-second signing execution budget. CPU/memory scaling thresholds must be absent, null or zero; the v1 schema declares nullable alternatives.[^container-schema] Scaling remains separate from the application slot and retained exclusion journal; it does not prevent overlapping deployments by itself.

At each existing authority, private-effect, seal and retrieval checkpoint, read the exact control object afresh, perform bounded authenticated GETs against the fixed `containers/v1/regions/fr-par/containers/{container_id}` and `namespaces/{namespace_id}` APIs, and read the control again. Require the same approved control bytes on both sides, actual container identity/readiness/configuration, and a ready, error-free namespace in the bucket-bound Project. The container's only public environment entry is its exact canonical `OHTIA_SIGNING_CONFIGURATION`; its secret environment names are exactly `OHTIA_SIGNING_BACKEND_ACCESS_KEY` and `OHTIA_SIGNING_BACKEND_SECRET_KEY`. The namespace must supply no inherited public or secret environment. The API's selected fields establish the observation, rather than the receipt's self-reported deployment identity.[^container-readback][^namespace-readback]

Do not cache successful admission, retry a refusal, follow a redirect or fall back to stale observations. Request identity-encoded JSON and refuse encoded responses, so declared response lengths refer to the bytes being checked. Bound each deployment response by `signing_deployment_readback_bytes` (262144 bytes), separately from the 65536-byte public configuration/control limit, and by the current operation deadline. The larger response bound accommodates the JSON-escaped configuration and provider metadata without widening the admitted configuration. Retain only selected configuration fields and secret names from deployment readback; never expose raw responses or provider error text. A failure before a private signing effect refuses work; a revocation detected after signing leaves the existing uncertainty fence in force and releases no sealed result. These checkpoints observe revocation during an already running worker; separate HTTP reads and signing/storage effects are not an atomic provider transaction and do not promise instantaneous cancellation between checkpoints. Revocation gates signature production and result release; it does not revoke the runtime credential or prevent encrypted key/passphrase retrieval before the final signing checkpoint. Retiring runtime access requires independent IAM revocation as well. The administrator must approve the actual expanded container-read permissions and qualify their exposure with disposable credentials before real custody.

### Caller, source and artifact authority

Verify current GitHub Actions OIDC claims with jose `6.2.*`, using the fixed GitHub issuer and bounded public JWKS retrieval. Pin immutable owner/repository IDs, audience, main ref, dispatch event, environment, hosted runner and immutable reusable workflow identity. Resolve the actual job/check-run/run/attempt/source relationship independently. The provider IAM check and application OIDC check are distinct controls.[^github-oidc][^jose]

Use Git `2.47.*` for source verification. [ADR-0045](adr-0045-personally-signed-source-history.md) replaces the reproducible-merge exception with an independently approved initial baseline and mandatory authorized personal signatures on every subsequent commit, including merges. It owns baseline coverage, parent admission and versioned prefix-cache compatibility. Isolate Git configuration, hooks, attributes and replacement/graft mechanisms from the repository being examined; requests cannot insert cache records.

OIDC authenticates the requester, not the build output. Use the pinned GitHub CLI under [the qualification tool policy](../../config/installation/scaleway.json) to cryptographically verify GitHub artifact attestations and then check their authenticated certificate identity, builder revision, source and run/attempt. Require the declared input manifest in the authenticated pinned builder's predicate and verify its actual successful build job. Predicate data is workflow-controlled; a reusable builder whose caller can redefine privileged behavior is inadmissible. Check the actual package digest and length independently. Public repository provenance uses the Sigstore Public Good Instance; do not exclude that trust path while retaining exact repository, builder and source restrictions.[^gh-attestation][^sigstore]

Use GnuPG `2.4.*` and RPM `4.20.*` for the selected RPM operation, with exact binaries and native helper inputs bound by the signer image manifest. OpenSSH retains its native upstream release identity in that manifest. [The developer Node decision](adr-0004-javascript-development-toolchain.md) owns the Node runtime line. The [toolchain manifest](../../config/desktop/toolchain.json) owns the exact JOSE patch and artifact integrity; the [numeric policy](../../config/desktop/resource-policy.json) owns signing, metadata, artifact and execution bounds.

The immutable reusable builder is the build authority; another admitted-source top-level caller does not grant different builder code or permit caller-selected privileged helpers. Qualify that exact builder contract before accepting genuine attestations.

### Operations and receipts

[The authority module](../../tooling/installation-authority.mjs) defines strict canonical input and authority validation. [The signer](../../tooling/installation-signer.mjs) exposes three typed operations: `rpm-sign`, `deb-bind` and `catalog-sign`. All subjects in this qualification interface have kind `qualification`, internal development versions, immutable source commit/tree and separate build/signing executions. Public promotion and permanent version reservation remain with their respective owners.

The canonical request has exactly `schema_version`, `operation`, `subject`, `execution`, `artifact_id`, `input`, `build_proof` and `catalog_bindings`. Schema version is 1. Subject and execution use the shared admission field sets; installer/proof references contain only SHA-256 and length. RPM and DEB operations require an artifact ID and no catalog bindings; catalog signing requires a null artifact ID and complete unique sealed package bindings. Unknown fields, duplicate keys, unsafe integers, noncanonical bytes, excess sizes and caller-selected trust are refused. Request identity hashes the complete canonical request; immutable subject/artifact/operation identity separately prevents a new request ID from replacing settled bytes.

RPM signing verifies the expected native metadata and authorized subkey, signs an admitted copy, verifies the expected signature and seals the resulting bytes. Use Debian's fixed `/usr/lib/gnupg/gpg-preset-passphrase` helper and RPM 4.20 `_gpg_name` selection with the complete authorized subkey fingerprint and the exact-subkey suffix. Bind RPM `_tmppath` to that operation's private directory; do not depend on writable `/var/tmp` or the process environment to select native temporary paths. Before the private effect, export the immutable header through the native RPM library, bound it by `signing_rpm_header_bytes`, validate its immutable-region extent/trailer and require equality with the package's on-disk header. After signing, require the identical header, preserve the complete header/payload body identity, and export the RSA header signature bounded by `signing_rpm_signature_bytes`. Verify that detached signature with GnuPG over the exact header bytes, requiring one successful `VALIDSIG` with the full approved signing-subkey and primary fingerprints, RSA, SHA-256 and binary-document class; reject expired, revoked, failed or distrusted signatures even when a `VALIDSIG` is present. RPM's complete digest/signature check remains an additional check; its short printed key ID never grants identity.[^rpm-header][^gpg-status] DEB binding retains the exact authenticated build bytes and creates no native DEB signature. Catalog signing accepts the existing exact-byte catalog format and only previously sealed RPM/DEB results from the same qualification subject. Preserve the existing `candidate` as SHA-256 of canonical `{inputs, contracts}`; each authenticated build manifest binds that exact closure through `inputs_sha256`, and every catalog package must share it. Require unique native `(target, profile, format)` identities as well as unique filenames. Package profiles remain the native profiles in the target manifest; their distribution capability groups remain separate under shared admission. No operation installs a package, executes its scripts or exposes arbitrary-message signing.

The independently approved pinned qualification caller owns the bounded internal campaign control metadata: schema declaration, sequence, notes and freshness times. Package provenance and catalog package bindings do not independently attest those control fields. Qualify the actual fixed caller recipe against its captured contracts and reject runtime overrides before enabling this internal route; it grants no public-feed metadata authority. The metadata workflow owns admission of refreshed revision identities over unchanged package bindings before an operational feed is enabled. A qualification event remains immutable.

Every sealed receipt binds request, operation, subject, caller execution, actual service invocation/deployment, image/policy identities, source/build/verification proof hashes, input/output references, signer and seal time. Receipt bytes have their own schema and receive an Ed25519 signature over the UTF-8 prefix `ohtia-signing-receipt-v1`, one NUL byte and canonical receipt bytes. The prefix prevents interpreting a receipt signature as a catalog signature. Receipt authenticity never substitutes verification of final package/catalog signatures, source, build or deployment evidence.

The Ed25519 key ID is SHA-256 of SPKI DER. The RPM signer ID hashes canonical JSON with `mechanism: openpgp-rpm`, `primary_fingerprint` and `signing_subkey_fingerprint`, both lowercase full fingerprints. DEB binding reports `mechanism: none` and null native signer ID while retaining authenticated receipt/catalog coverage. The authority identity is the independently admitted canonical policy hash.

### Durable state, transport and recovery

Persist a conditional journal before an irreversible signing step. States are `admitted`, `signing`, `sealed`, `failed` and `uncertain`. Return an identical retained sealed result for an identical retry. Refuse changed input under an existing immutable identity. A signing marker without a settled durable output is uncertain; lease expiry, redeployment or a cancelled caller does not authorize another signature. Conditional storage and fencing must survive multiple workers and ambiguous writes. Prepare keys and native metadata before entering the signing state, then fence immediately before the first private signature. A known pre-effect authority outage remains admitted and retryable; a deterministic preflight refusal can become failed. After possible signing, absence of a durable authenticated result remains uncertain.[^conditional-storage]

Authenticate the current caller and actual job immediately before the first irreversible signing step. Settling those already-authorized bytes rechecks the independent policy and revocation gate, without requiring the original short-lived caller token to remain valid throughout storage and signing. Result retrieval still requires a fresh token for that same admitted execution. A new job/attempt or a changed policy cannot silently replace an old identity or release receipts under stale authority; independently authorized archival/recovery and policy migration must resolve those cases before operational enablement.

Propagate one monotonic operation deadline through authority checks, storage requests and streams, binding reconciliation and subprocesses. [The Linux subprocess supervisor](../../tooling/installation-signing-runner.mjs) holds its own isolated session/group until completion or cancellation and signals only that still-live group, including ordinary descendants. A dedicated abort pipe also closes when its controller dies. RPM work reserves one subprocess-sized cleanup window inside the total operation deadline, rather than starting a new allowance after expiry. The intentionally detached GnuPG agent is separately stopped through its exact private home; deployable-image qualification must verify that complete helper/daemon lifecycle. Never signal a positive PID or PGID after its former leader may have been reaped.

Scaleway documents an Amazon S3-compatible Object Storage API and explicitly limits its support to a subset of Amazon S3. This compatibility supports using S3 client libraries; it does not establish support for every AWS feature or replace verification of the required provider operations. Authenticate with Scaleway credentials and use the fixed Paris endpoint `https://s3.fr-par.scw.cloud`; the SDK dependency does not select Amazon as the storage provider.[^scaleway-s3-concepts][^scaleway-s3-faq]

Use @aws-sdk/client-s3 `3.1161.*` and @aws-sdk/s3-request-presigner `3.1161.*` for that Scaleway endpoint, with all automatic SDK retries disabled (`maxAttempts: 1`), including reads and mutations. [The provider adapters](../../tooling/installation-signing-scaleway.mjs) isolate ingress from retained objects, append journal revisions with conditional creation, bind upload SHA-256, length and create-only headers in exact-object presigned URLs, and retrieve four explicitly selected opaque Secret Manager versions. Provider responses and object streams are bounded and the provider receives a signed checksum precondition and actual downloaded bytes are rehashed; metadata alone grants no content identity. These components do not provision resources, enable admission or establish deployed provider semantics.[^aws-sdk][^secret-manager][^checksums]

The local Linux backend uses private directories, content-addressed immutable objects published by atomic nonempty-directory rename, and exclusive append-only journal revisions. Stored data always has one link; journal/token metadata uses bounded nonblocking descriptor reads with ordinary-file, ownership and link checks. It is a fixture backend, not evidence of provider conditional-write semantics. An operational backend requires independently qualified S3 operations, private bucket policies, exact-object transfer capabilities, retained evidence and actual allow/deny/readback. Do not delete an uncertain record or sole retained baseline as temporary-upload cleanup.

[The local HTTP transport and client](../../tooling/installation-signing-http.mjs) exercise `POST /v1/requests`, `POST /v1/requests/{id}/execute` and `GET /v1/requests/{id}` on loopback only. Execution remains synchronous within its bounded provider request; 202 never creates an untracked background signer. Transfer capabilities authorize one exact object for a bounded lifetime and are not logged. A production endpoint additionally requires private IAM invocation, approved origins, credential custody and observed deployed policy/image identity.

Errors expose only bounded machine codes. Authentication/policy refusal returns 403, identity conflict/uncertainty 409, size refusal 413, invalid contract 422 and unavailable authority 503; completed retained work returns 200 and admitted/pending work 202. Recheck authority before sealing and retrieval. Retry bounded transient reads/transfers under the same identity; never retry a denial or automatically re-sign an uncertain result. The one-request-per-instance capacity applies to all three routes, including status reads: an occupied instance returns retryable 503 before consulting retained state. A later admitted status read returns 202 for pending work; a busy reply does not claim that state was observed.

## Consequences

The same owner can remain the human custodian, but the GitHub account cannot administer the signing service. Compromise of its independent administrative credentials, source-signing key, trusted signer dependencies or provider remains consequential. Owner absence and recovery therefore need an executable separate procedure rather than a second key held under the same exposed account.

Local test keys, fixture issuers and mocked provider responses establish contracts only. Actual private-container IAM, credential release, source/workflow admission, storage races, revocation, recovery and signed native installation require evidence at the deployed enforcing boundaries before the corresponding capability is enabled. Real publisher-signed internal artifacts remain private; this mechanism grants no publication authority or macOS/Windows publisher capability.

[^scaleway-private]: Scaleway documents private invocation and separate IAM permissions; Ohtia must verify their actual effective scope.

[^scaleway-limits]: Scaleway specifies the container architecture and bounded resource/timeout configuration.

[^github-oidc]: GitHub documents signed run, job, repository and reusable-workflow claims.

[^gh-attestation]: The CLI verifies cryptographic provenance and distinguishes certificate identity from workflow-controlled predicate data.

[^jose]: The pinned JOSE implementation verifies JWT signatures and claims; application authorization remains Ohtia's responsibility.

[^conditional-storage]: Conditional object writes provide storage preconditions; complete signing uncertainty and fencing semantics require their own qualification.

[^secret-manager]: Secret Manager exposes immutable numbered versions through an authenticated access endpoint; aliases are not accepted by this adapter.

[^aws-sdk]: The established SDK supplies S3 commands and Signature Version 4 presigning; request content and endpoint policy remain the service responsibility.

[^sigstore]: GitHub documents different public and private repository attestation instances.

[^checksums]: Scaleway documents SHA-256 checksum support; the selected single-PUT behavior still requires actual allow/deny/readback before deployment.

[^scaleway-s3-concepts]: The Amazon S3 section declares subset compatibility; Signature V2, Signature V4 describes authentication with Scaleway access keys.

[^scaleway-s3-faq]: What is Object Storage? explicitly declares an Amazon S3-compatible API for compatible software.

[^tini]: Tini forwards signals and reaps zombies; it does not replace signing deadlines, durable fencing or detached-agent cleanup.

[^debian-tini]: The selected init helper is distributed as a Debian native package; its exact artifact is bound by the image manifest.

[^debian-lifecycle]: Debian publishes the ordinary and LTS support periods and notes reduced architecture coverage during LTS.

[^rpm-header]: Immutable regions preserve their original index/data representation; export through the RPM library and reject a different on-disk header.

[^gpg-status]: VALIDSIG supplies the signing fingerprint, primary fingerprint, public-key algorithm, digest algorithm and signature class; failure and expiry statuses require separate checks.

[^container-readback]: The v1 container API exposes image, readiness, capacity, transport and environment configuration.

[^namespace-readback]: The v1 namespace API exposes its Project, readiness and inherited environment configuration.

[^container-schema]: The v1 schema declares nullable scaling alternatives and array-valued command/argument overrides.
