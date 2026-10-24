---
type: DecisionRecord
title: "ADR-0019 — Pinned Linux environment for frontend verification"
description: "Pin the Linux E2E image and browser dependencies while preserving actual desktop sandbox and coverage requirements."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: docker
    resource: "https://playwright.dev/docs/docker"
    title: "Playwright — Docker"
---

# ADR-0019 — Pinned Linux environment for frontend verification

## Context

Installing arbitrary browser dependencies in every CI shard is variable and difficult to reproduce. The official Playwright image contains browsers/system dependencies but does not by itself install Ohtia's npm package or establish a secure desktop app run.[^docker]

## Decision

Use an immutable, version-and-digest-pinned Linux x86-64 E2E image when introducing the frontend CI environment. Match the [selected Playwright](adr-0018-vitest-and-playwright-desktop-tests.md) package and browser/image versions with an automated parity check. Layer only verified requirements for the actual Electron run; a browser-only image is not proof that native app dependencies exist.

Pin [Node](adr-0004-javascript-development-toolchain.md) and other tooling from repository configuration and install dependencies from frozen lockfiles. Prepare required OS packages in the reviewed image rather than running unconstrained APT resolution in each test shard. Local reproduction uses the same image as an additional path, not a fictional existing command.

Run actual desktop applications without root and without disabling Chromium/WebKit sandboxes. Use a private display/session and bounded shared memory/resources; no host desktop, DBus or credentials are test inputs. Test that the sandbox can start under the chosen CI container policy; inability is an environment failure requiring correction, not permission to add no-sandbox flags.

GitHub Actions job containers/runners can have host-level authority, including the runner's Docker socket. Treat them as trusted ephemeral build infrastructure, not a sandbox for hostile research. Do not infer isolation merely from omission of declared mounts. Keep PR checks separate from signing/publication authority and apply [repository policy](../repository-policy.md).

Shards preserve the complete declared inventory and fail the aggregate when preparation, version parity, startup or a required partition fails. Updates change the paired image/package pins with test evidence; no fallback tag or browser download hides a mismatch.

## Consequences

The environment is reproducible at the cost of image updates and downloads. Measure preparation and total test duration before claiming a performance gain. Linux containers do not establish Windows/macOS or native assistive behavior. A benchmark environment cannot substitute for the reviewed CI image or evidence that its required gates passed.

[^docker]: The documentation describes packaged browser dependencies, version matching and container security considerations; Ohtia separately requires working desktop isolation.
