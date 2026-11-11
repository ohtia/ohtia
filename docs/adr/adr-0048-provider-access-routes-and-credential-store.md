---
type: DecisionRecord
title: ADR-0048 — Provider access routes and credential store
description: Connect language-model services through Sign in with ChatGPT and Anthropic and OpenAI API keys, with every credential held by main in the operating-system credential store.
generated:
  by: codex/gpt-6.1-sol
sources:
  - id: keyring
    resource: https://github.com/Brooooooklyn/keyring-node/tree/52184fbebffeef8a061234f60f313c479b954f9f
    title: Reviewed keyring implementation
  - id: windows-credential
    resource: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw
    title: Microsoft CREDENTIALW structure
---

# ADR-0048 — Provider access routes and credential store

## Context

Ohtia needs subscription and API-key access without a local agent runtime. The [architecture](../architecture.md#process-and-trust-boundaries) gives main the brokered credentials. [SPEC-003-006](../epics/EPIC-003-research-agents/epic.md#spec-003-006-provider-adapter-contract-and-credential-store) records the researcher's rejection of a session-only fallback. Reusing a signed-in CLI, storing credentials in SQLite, relying on Electron's platform-dependent secret fallback and silently keeping an ephemeral login would break that boundary or its persistence guarantee. PRIN-004, PRIN-006 and PRIN-016 require accurate provenance, explicit failures and an honest unavailable state.

## Decision

Use three independent provider routes: Sign in with ChatGPT over the Responses API, an Anthropic API key and an OpenAI API key. Main alone holds every credential and sends provider requests over HTTPS; the data service admits request data without credentials under a single-use dispatch permit. [ADR-0026](adr-0026-capability-declared-adapters.md) continues to own capability admission. Selecting these routes does not establish provider eligibility or enable their later stories.

Use @napi-rs/keyring `2.1.*` with `linux: { store: 'secret-service' }`, so Linux never falls back to a nonpersistent store.[^keyring] The lockfile and [desktop toolchain](../../config/desktop/toolchain.json) pin the reviewed patch and the six native artifacts. macOS Keychain and Linux Secret Service store the whole session. A missing or unusable store, including a cancelled unlock, leaves the connection unavailable; there is no weaker or session-only fallback.

On Windows, Credential Manager holds a random 32-byte key, created only when missing and otherwise reused. Its credential-size limit motivates storing the encrypted session in `provider-sessions.enc` directly inside Electron's `userData` directory, outside research data and migration checkpoints.[^windows-credential] Each write uses AES-256-GCM with a fresh random 12-byte IV and publishes a temporary file in that same directory through replacement. The bytes are format version `1`, IV, ciphertext, then the 16-byte authentication tag. Main verifies authentication before using decrypted content. A missing file means no session; a present file with a missing key, unsupported version, insufficient length or failed authentication means an unusable session and an expired connection.

Entry service names are `Ohtia` in installed and qualification modes. Development uses `Ohtia Development`, a space, then the first 16 lowercase hexadecimal characters of SHA-256 of the UTF-8 canonical absolute development-root path. Main admits `OHTIA_DEVELOPMENT_ROOT` under [ADR-0043](adr-0043-ordinary-startup-modes.md) before redirecting `userData` and acquiring the single-instance lock. Entry accounts are `chatgpt-session` for the whole macOS/Linux session, `chatgpt-session-key` for the Windows file key, `chatgpt-registration`, `anthropic-api-key` and `openai-api-key`. The kept session includes its classified reason; transient reasons remain in main until the next connect/disconnect or exit. Every store read rediscovers unavailability.

## Consequences

A computer without a usable operating-system credential store cannot connect a service. Native store behavior, cancelled unlocks and restart persistence require testing on the declared Windows and Linux virtual machines, including GNOME Keyring, `ksecretd` and `kwalletd6`; synthetic tests do not qualify those hosts.

The installed and qualification modes share the native single-instance lock, while every development checkout has its own redirected lock and credential service. No two admitted processes share a session or registration, so renewal needs no interprocess lock. Each new or moved checkout signs in once and receives API keys again. Entries belonging to a removed or moved checkout remain in the store and are never read by its replacement.

The native addon must remain pinned, inspected and licensed in every package. The fake adapter is a separate development/test module excluded from installed and qualification artifacts. No credentials, provider error text or arbitrary provider metadata enter diagnostics, the renderer, the service channel or project records.

[^keyring]: The reviewed API provides asynchronous entries and an explicit Secret Service selection that fails rather than using the kernel-keyring fallback.

[^windows-credential]: Windows limits the CredentialBlob for a generic credential to 2,560 bytes.
