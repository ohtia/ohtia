---
type: DecisionRecord
title: "ADR-0055 — Anthropic Messages through the official TypeScript SDK"
description: "Run the Anthropic SDK in the desktop broker with a fixed transport and explicit API version."
sources:
  - id: sdk-release
    resource: https://registry.npmjs.org/@anthropic-ai/sdk
    title: Anthropic SDK package versions and publication dates
  - id: sdk-source
    resource: https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-1.8.0.tgz
    title: Anthropic TypeScript SDK 1.8.0 source and license
  - id: api-version
    resource: https://platform.claude.com/docs/en/api/versioning
    title: Claude Platform API versions
---

# ADR-0055 — Anthropic Messages through the official TypeScript SDK

## Context

[STORY-003-036](../epics/EPIC-003-research-agents/STORY-003-036-anthropic-api-key.md) adds Anthropic Console keys and streamed Messages to the existing provider contract. [ADR-0057](adr-0057-provider-access-routes-and-credential-store.md) gives the desktop broker custody of credentials. [ADR-0052](adr-0052-current-provider-dispatch-authorization.md) gives the data service authority over each request and requires main to check its permit at the transport boundary. This preserves researcher control of transfers, provenance and uncertainty under PRIN-004, PRIN-006 and PRIN-016.

## Decision

Adopt the Apache-2.0 `@anthropic-ai/sdk` 1.8.x line. The workspace locks the initial release to 1.8.0, published on November 10, 2026. It was the newest stable release past the seven-day cooldown at adoption.[^sdk-release] Main sends Anthropic API version `2026-10-21` for both Models and Messages. Adoption of a different API version requires updating this decision.[^api-version]

The SDK runs in Electron main. Main uses it to build requests and read server-sent events. A listing client authenticates key checks and catalog reads. A Messages client releases the research body once, after the permit check. Both clients use the application's fixed HTTPS transport, construct the request headers from explicit values, and disable redirects, SDK retries, SDK logging and telemetry propagation and tracing. The SDK's raw SSE iterator preserves activity from `ping` events.[^sdk-source]

The operating-system credential store holds the key and an independently random account instance. Main keeps connection dates in a companion native entry indexed by instance, preserving the current date if a replacement write fails. The account fingerprint comes from the instance. The data service receives connection and attempt metadata through the existing contracts.

## Alternatives and consequences

A direct HTTP client would avoid the dependency and require Ohtia to maintain the Messages request schema and SSE parser. The SDK supplies the typed request vocabulary and SSE iterator. Main owns the transfer mechanism, lifecycle mapping and policy checks so SDK updates cannot silently change those contracts. The release bundles the applicable license notices. A version change requires checking the SDK constructor, header construction, credential resolution, error fields, SSE behavior and the adapter conformance suite.

[^sdk-release]: Publication metadata for the selected version and subsequent releases.

[^sdk-source]: Constructor configuration, raw SSE iteration, exported version and Apache-2.0 license.

[^api-version]: Anthropic API-version history and the version header contract.
