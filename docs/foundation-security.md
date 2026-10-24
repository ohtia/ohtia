---
type: Specification
title: Foundation security applicability
description: Versioned security applicability, enforcing boundaries and reproducible evidence obligations for the desktop foundation.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: asvs
    resource: https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/docs_en
    title: OWASP ASVS versioned English baseline
  - id: electron
    resource: https://www.electronjs.org/docs/latest/tutorial/security
    title: Electron security guidance
  - id: web
    resource: https://top10.owasp.org/2025/
    title: OWASP Top 10 2025
  - id: api
    resource: https://api-security.owasp.org/editions/2023/en/0x11-t10/
    title: OWASP API Security Top 10 2023
  - id: llm
    resource: https://genai.owasp.org/llm-top-10/
    title: OWASP LLM Top 10 2025
---

# Foundation security applicability

## Baseline and applicability

[ADR-0000](adr/adr-0000-security-verification-frameworks.md) owns the security framework. The [machine-readable inventory](../config/desktop/security-applicability.json) assigns every L1/L2 identifier from its versioned ASVS baseline to an applicable group or justified scope exclusion. The source digest identifies the exact upstream inventory inspected; identifiers retain their version prefix. OWASP ASVS contributors license that baseline under CC BY-SA 4.0; the inventory reproduces identifiers, not requirement prose.[^asvs]

Applicability is a requirement, not a passing result. D1a establishes documentation/metadata checks and numeric control inputs. Each implementing owner appends actual enforcing implementation and positive/negative evidence under the same baseline before accepting its capability. Do not interpret an empty implementation/evidence record, an issue checkbox, a scanner result or the existence of this document as implemented protection. Reconcile changes in enabled capabilities, filesystems, updater behavior and authority before claiming readiness. PRIN-004–007, PRIN-011 and PRIN-013 require honest provenance/coverage and failures that preserve private work.

No Ohtia account/login, web session, password database, OAuth/OIDC service, HTTP API, GraphQL, WebSocket, WebRTC, LDAP, JNDI, memcache or mail integration is introduced by the foundation. The corresponding inventory exclusions describe those absent surfaces. They do not exclude sender authorization, operation/field scope, local process capabilities or update signing. Local research is not application-encrypted; do not claim encrypted-at-rest protection from transport/signature primitives. The diagnostic collector exclusion deliberately preserves local-only privacy rather than claiming that local logs resist account-equivalent malware.

Packaged rendering still needs CSP, MIME/origin controls, text-safe presentation and navigation restrictions even without HTTP. Adapt ASVS HTTP wording to the actual local asset protocol where appropriate; do not exclude a renderer control because an HTTP header is replaced by a packaged equivalent. Imported manuscript/markup processors are outside this foundation, but bounded JSON metadata, locators and installer/update archives remain file/deserialization inputs. Later processing owners must reassess before enabling their surface.

## Enforcing controls and evidence ownership

Every result identifies baseline requirement ID, local control ID, owner, source/tree/workflow/run identity, target OS/CPU/filesystem, final artifact/addon digest where relevant, implementation file/function, reproducible test or native procedure, positive case, denial/failure case, observed result and limits. Evidence must come from the enforcing boundary. Test identifiers below name required scenarios, not existing executable tests. Implementing owners bind them to actual test names and artifact receipts; 017 verifies the combined inventory rather than supplying another owner's missing evidence.

- **FND-INPUT — 001/003:** apply ASVS `v5.0.0-2.1.1`–`2.1.3`, `2.2.1`–`2.2.3`, `15.1.3`, `15.2.2`, `15.3.5` and `15.3.6` to the canonical numeric policy, runtime schemas and trusted decoders. D1a's `scripts/desktop_contract.py` and its negative-fixture tests check metadata admission only. 003 supplies `ipc-invalid`, `ipc-utf8-boundary`, `ipc-depth-width`, `ipc-unknown-prototype`, `ipc-invalid-result` and `ipc-saturation` at both actual message directions. 004 supplies real IPC evidence; portable peers alone cannot prove a sender frame.
- **FND-AUTHORITY — 003/004/005:** apply the inventory's authorization group and `v5.0.0-3.5.5`, `13.2.1`, `13.2.2` to named operations, live frame/origin identity, service generations and data-service preconditions. Require `ipc-spoofed-frame`, `ipc-old-generation`, `ipc-wrong-scope`, `preference-stale-revision`, `idempotency-conflicting-payload`, `lost-ack-reconcile` and concurrent duplicate claims. A user-controlled correlation value is not sender identity. Single broker/data-service admission must hold across two launches and concurrent windows.
- **FND-RENDER — 004:** apply `v5.0.0-1.2.1`–`1.2.3`, `1.3.2`, `3.2.1`, `3.2.2`, `3.4.3`–`3.4.6`, `3.7.1` and `3.7.2` with the Electron supplement. Require `packaged-csp`, `navigation-denied`, `resource-origin-denied`, `privileged-import-denied`, `no-development-assets` and `renderer-sandbox-active` on the delivered local assets, with context isolation, no Node integration and no generic IPC bridge. Deliberate CSP violations must be identified exactly; unexpected violations fail.[^electron]
- **FND-NATIVE — 018, extended by 004/005/013:** apply `v5.0.0-1.4.1`–`1.4.3`, `5.3.2`, `13.2.2`, `15.2.1` and local process/filesystem controls. Require `wrong-addon-architecture`, `native-artifact-replaced`, `engine-source-mismatch`, `utility-crash`, `sandbox-denied`, `native-display-backend-observed`, `tree-cessation`, `resource-budget`, `fixed-locator-alias`, `settings-data-overlap`, `denied-io`, `atomic-replacement-interrupted` and `stable-profile-sentinel`. 018 owns the initial native backend/protocol observation; 004 verifies the product runtime using that procedure, with 012 preserving the same launch arguments. Record each phase's actual native host/executable/addon and artifact identities. Renderer sandboxing does not confine an arbitrary parser. A signal without a wait/containment receipt proves no cessation.
- **FND-STORAGE — 005:** apply `v5.0.0-1.2.4`, `2.3.1`–`2.3.4`, `8.3.1`, `14.2.4` and the canonical storage/recovery ADRs. Require `foreign-keys-readback`, `file-backed-roundtrip-restart`, `schema-too-new`, `migration-artifact-changed`, `migration-result-error`, `checkpoint-interrupted`, `disk-full`, `uncertain-publication` and `recovery-before-admission`. No success receipt before durable commit; failed migration preserves prior research and checkpoint identities. No database path/addon/SQL object crosses into renderer contracts.
- **FND-DIAGNOSTICS — 006:** apply the inventory's diagnostics/privacy groups, particularly `v5.0.0-14.2.3`, `16.2.3`, `16.2.5`, `16.4.1`, `16.4.2` and `16.5.1`–`16.5.3`. Require `private-marker-success-failure`, `stderr-trace-rejected`, `multibyte-rotation`, `queue-saturated`, `write-delete-race`, `logging-denied-io` and `no-fallback-log-root`. Local ACLs, rotation and controlled errors need actual native evidence; injected secrets must stay out of files, stdout/stderr and presented messages. Account-equivalent tampering is outside the local-log guarantee, not a reason to omit ACL verification.
- **FND-DELIVERY — 012–016:** apply inventory crypto/transport/configuration groups, `v5.0.0-5.2.1`–`5.2.3`, `11.1.1`, `11.1.2`, `11.6.1`, `12.2.1`, `12.3.2`, `13.3.1`, `13.3.2`, `15.1.1`, `15.1.2` and `15.2.3`. Each owner supplies its own SPEC-001-026 inventory/evidence. Require `wrong-workflow-ref`, `untrusted-pr-secret-denied`, `verifier-replacement-denied`, `note-text-inert`, `version-reservation-race`, `wrong-key-signature-target`, `catalog-replay-expiry`, `schema-update-denied`, `partial-activation`, `same-digest-retry` and `withdrawal-retained-identity`. Live independent authority and real native signing cannot be proved by synthetic policy tests or by a green workflow name.

- **FND-INSTALL — 012/013/018:** extend `v5.0.0-1.2.5`, `5.3.2`, `8.3.1`, `13.2.2`, `15.2.3` and the native controls to privileged DEB/RPM package scripts, the authenticated installer adapter and AppArmor state. Require `linux-deb-script-allowlist`, `linux-no-setuid-helper`, `apparmor-exact-owned-path`, `apparmor-load-fails-closed`, `apparmor-uninstall-reconcile`, `linux-package-no-unsafe-fallbacks`, `linux-install-auth-denied`, `linux-install-dependency-missing` and `linux-root-path-tamper`. Inspect the final DEB/RPM maintainer-script/profile bytes and installed modes; reject stock SUID/silent-profile defaults and the DebUpdater/RpmUpdater signature/downgrade/dependency-bypass/global-repair paths. Verify that denied authorization or preflight dependency failure preserves the current installation, and that interrupted privileged changes retain explicit recovery rather than false success. Require `rpm-expected-signer`, `rpm-no-verification-bypass`, `fedora-selinux-enforcing`, `fedora-btrfs-publication`, `linux-format-architecture-denied` and `linux-native-profiles-complete` on the declared Fedora/Ubuntu profiles and both CPUs. Inspect root-owned path labels, no setuid fallback, wrong-signer/unsigned refusal, package dependency failures and native prerelease/final ordering. Native 018 feasibility and final 013 qualification remain separate evidence.

The complete applicable groups remain obligations even when the examples above cite only representative requirement IDs. 001 defines numeric bounds and manifests; 002 expands the complete locked inventory; 003/004/005 enforce port/runtime/storage; 006 produces diagnostic evidence; 007 checks required inventories; 018 measures early native feasibility; 012–016 qualify actual delivery authority; 017 reconciles final-artifact and integrated coverage. An unmet mandatory control blocks the affected readiness claim.

## Complementary risk and recovery review

Use OWASP Top 10 2025 as risk context for broken access control, supply chain, insecure design, injection and exceptional conditions; ASVS remains the acceptance catalog.[^web] API Security Top 10 2023 informs object/property/function authorization and resource consumption at named IPC commands, without inventing an HTTP server.[^api] LLM Top 10 2025 becomes applicable only when an actual agent/parser capability is introduced. This foundation does not certify prompt-injection protection, model-output handling or agent agency by naming that catalog.[^llm]

Use WSTG 4.2 on applicable local-renderer injection, origin and content surfaces, with native Electron tests supplementing web techniques. NIST CSF 2.0 organizes operational responsibility: maintainer/key custodians govern signing and incidents; component owners identify risks and protect boundaries; controlled logs/tests detect failures; delivery owners respond with withdrawal and authenticated correction; storage owners recover through verified checkpoints. The release retirement/withdrawal procedure in [ADR-0038](adr/adr-0038-desktop-delivery-mechanisms.md) must preserve artifact and data-recovery identities. These roles do not imply an external service or an already provisioned key custodian.

Use synthetic/public fixtures and isolated native profiles/VMs. Never collect private research, real credentials or raw user paths as test evidence. A finding retains cause, concrete trigger, impact and verifiable references; classify a CWE only when supported. Human confirmation, native observations, local checks and hosted CI remain distinct evidence.

[^asvs]: The versioned primary baseline provides all requirement identifiers and levels; local applicability is an Ohtia assessment.

[^electron]: Electron guidance supplements ASVS at the packaged renderer, IPC and native process boundary.

[^web]: The risk catalog supports threat review rather than declaring control conformance.

[^api]: API risk concepts apply to scoped local command authority without changing the selected transport.

[^llm]: LLM risk review must examine an implemented model capability and its real inputs/tools.
