---
type: DecisionRecord
title: "ADR-0022 — React renderer built with Vite"
description: "Build local renderer assets with React and Vite while keeping Electron privileges outside the web component tree."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: vite
    resource: "https://vite.dev/guide/"
    title: "Vite — Getting started"
  - id: vite-security
    resource: https://github.com/vitejs/vite/blob/v8.1.6/packages/vite/CHANGELOG.md
    title: "Vite — HTML, filesystem and bundled editor-launch security fixes"
  - id: react
    resource: "https://registry.npmjs.org/react-dom/19.3.1"
    title: "React DOM — Package metadata"
---

# ADR-0022 — React renderer built with Vite

## Context

The academic editor and workspace need DOM editing, semantic structure and shared frontend tooling. A hosted SPA deployment, authentication resources and native/mobile wrappers are separate concerns. Raw bundler success does not establish Electron runtime isolation. Vue and Svelte are viable component alternatives; Webpack or a custom build pipeline are bundling alternatives. React with Vite keeps the selected TypeScript/DOM editing stack under one familiar component/build boundary, while preserving explicit ports for domain state and privileged services. This is an integration choice, not a measured claim of superior performance.

## Decision

Use matching React and React DOM `19.3.*` packages for the renderer, with Vite `8.1.*` builds.[^react] Require the upstream fixes for development HTML transforms, filesystem access and the bundled editor launcher in the locked patch.[^vite-security] Use the strict TypeScript compiler selected in [ADR-0002](adr-0002-typescript-product-and-local-ipc.md). React's component structure presents controlled state; domain commands and process authority remain outside components. Vite supports development and production asset builds, while type checking is a separate gate.[^vite]

Package the built renderer assets locally with the actual CSP and narrow preload. Do not ship a dev server, development catalog, test fixture entry points or a hosted-login flow. Treat main, preload and utility processes as separate runtime/build targets with their own permitted imports. Vite is not the installer/signing/update mechanism.

Use geometry from `lucide-static` `1.66.*` for local interface icons. Exact patches, archive integrity, selected exports and file hashes live in the renderer icon manifest. The controlled `LucideGlyph` renderer applies the canonical stroke and current text color to those paths without injecting SVG markup or loading the React distribution of the icon library.

Use PostCSS `8.5.*` as a development-only raw CSS parser for the design-usage gate. Inspect original declarations, including priorities and duplicates, before browser normalization. Admit an explicit property vocabulary and controlled media/import forms; adding a CSS feature requires extending its validation contract and regression tests.

Keep styles/assets compatible with the packaged CSP. Load application styles and fonts from packaged resources under the declared policy. The editor lives behind its own module boundary rather than exposing ProseMirror internals across React features. Mobile delivery is outside this desktop decision.

## Consequences

The web editing ecosystem can be used without a hosted backend, but OS/native lifecycle verification still applies. Test actual asset URLs, CSP, source maps and accidental privileged imports in release-equivalent output. Verify Vite/React/TypeScript/Electron compatibility with exact locked patches when creating packages; packaged compatibility requires its own evidence.

[^vite]: Vite separates its development server and production build; Ohtia packages only production renderer assets.

[^vite-security]: The upstream changelog identifies the HTML-transform and filesystem fixes and the bundled editor-launcher update; the exact corrected patch and artifact identity belong in the toolchain manifest and lockfile.

[^react]: React DOM declares its React peer requirement; select matching locked patches within the adopted line.
