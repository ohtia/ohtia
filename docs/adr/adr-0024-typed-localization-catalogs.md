---
type: DecisionRecord
title: "ADR-0024 — Typed catalogs and operating-system locale selection"
description: "Resolve interface language from user choice, ordered OS preferences and explicit regional fallbacks through one typed catalog service."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: electron-languages
    resource: "https://www.electronjs.org/docs/latest/api/app#appgetpreferredsystemlanguages"
    title: "Electron — Preferred system languages"
  - id: locale-identifiers
    resource: "https://tc39.es/ecma402/#sec-intl.getcanonicallocales"
    title: "ECMA-402 — Canonical locale identifiers"
---

# ADR-0024 — Typed catalogs and operating-system locale selection

## Context

Messages embedded in components or generated at runtime complicate consistency and linguistic review. Browser-only locale resolution does not describe an installed desktop's preferences, and UI language must not rewrite manuscripts or source metadata.

## Decision

### Catalog and language boundaries

Use versioned per-locale catalogs with stable keys, typed interpolation, plural/select forms and one shared locale service. The [product definition](../product-definition.md#languages-and-accessibility) owns the supported locale inventory. Source/manuscript language and project analysis language remain separate inputs; changing UI locale does not translate existing research.

### Interface locale resolution

The trusted main broker obtains the ordered preferences through Electron's `app.getPreferredSystemLanguages()` and resolves one application-wide interface locale.[^electron-languages] Renderers and Ohtia-owned menu/notification producers use that same resolved selection. Browser language preferences are not the authoritative source for desktop selection.

Resolve the interface language in this order:

1. **Explicit user choice:** a supported locale selected in **Settings → Language** takes precedence over every OS preference. Persist the choice as an application preference, independently of any research project. Accept only a normalized identifier from the supported inventory, never a caller-supplied catalog path.
2. **System preferences:** when the user selects **Use system language**, or has no saved explicit choice, inspect the OS language list in its declared preference order. An unavailable/empty list proceeds to the global fallback.
3. **Regional/language matching:** for each OS preference, apply the matching procedure below before advancing to the next preference. A mapped first preference takes precedence over an exact match for a later one.
4. **Global fallback:** after exhausting the list without a match, use `en-US`.

For each preference, normalize its BCP 47 spelling with `Intl.getCanonicalLocales`; skip invalid tags and remove extensions for catalog matching.[^locale-identifiers] First try the complete base locale against the supported inventory. If absent, try its language plus region without script/variants. If still absent, use the explicit language mapping below. Advance to the next OS preference only when none of those steps resolves a supported locale. Preserve a supported regional variant instead of replacing it with its language default.

| Language | Fallback locale |
| -------- | --------------- |
| `en`     | `en-US`         |
| `es`     | `es-ES`         |
| `pt`     | `pt-PT`         |
| `fr`     | `fr-FR`         |
| `de`     | `de-DE`         |
| `it`     | `it-IT`         |
| `nl`     | `nl-NL`         |
| `sv`     | `sv-SE`         |
| `da`     | `da-DK`         |
| `nb`     | `nb-NO`         |
| `no`     | `nb-NO`         |
| `fi`     | `fi-FI`         |
| `ca`     | `ca-AD`         |
| `ko`     | `ko-KR`         |

The `no` mapping is deliberate; it does not map Nynorsk `nn` to Bokmål. Every mapping target and the global fallback must exist in the product inventory and have a complete catalog.

Examples of the required behavior:

- An explicit `es-AR` choice wins over OS preferences `[en-GB, fr-CA]`.
- In system mode, `[es-CL, en-GB]` resolves to `es-ES`; `[zz-ZZ, fr-CA]` resolves to `fr-CA`.
- `ca-ES` remains `ca-ES`; `ca-ES-valencia` resolves to `ca-ES`; `de-Latn-CH` and `de-CH-1996` resolve to `de-CH`.
- `pt-AO` resolves to `pt-PT`; `en-IN` to `en-US`; `no` and `no-NO` to `nb-NO`.
- `[nn-NO, en-GB]` resolves to `en-GB`; an empty or wholly unmatched list resolves to `en-US`.

### Preference changes and presentation

Settings offers the supported locales and **Use system language**. A new unsupported explicit value is rejected without replacing the saved preference. If a saved value is invalid or unavailable after an upgrade, report a controlled preference error and use system resolution so the application remains usable.

Resolve again at application startup and when returning to system mode. Applying an explicit language choice updates Ohtia's own interface messages, formats, menus and future notifications across its windows, including each document's `html.lang`, without losing unsaved editor/form state. Do not promise immediate detection of arbitrary OS-setting changes through a browser `languagechange` event. Text owned by the OS remains subject to that native surface's language behavior; Ohtia's language selection does not change OS settings.

Locale fallback selects a complete interface catalog; it does not silently fill missing translation keys from another locale or establish linguistic quality. Developer diagnostics and machine protocol values retain their repository-defined language/representation. The interface locale never supplies an implicit manuscript or analysis language.

Cover forms, navigation, errors, progress, notifications and accessible labels. Return controlled error codes/parameters across IPC, not diagnostic prose to parse. Use the same locale service for dates/numbers, with storage/protocol values independent of visual formats.

Validate every required catalog for missing keys, parameter/type/plural mismatches and invalid syntax. A fallback does not make a required translation complete. The catalog set must cover the product inventory, and every catalog must satisfy the complete message/parameter contract; locale fallback cannot conceal missing translations.

Disclose machine-assisted translations and record the human linguistic review actually performed. Structural checks, model review and successful rendering are not evidence of fluency or naturalness.

## Consequences

Catalogs can evolve independently of component code but require complete concurrent key updates and review. Test every supported exact locale, every mapping row, ordered-preference precedence, malformed tags, extension stripping, regional/script variants, empty/unavailable preferences, stale saved choices, manual/system transitions, cross-window updates and state preservation. Include long text, pseudolocalization, mixed scripts and Korean composition. Do not duplicate research content merely to localize the interface.

[^electron-languages]: Electron returns system language preferences in preference order and distinguishes them from the application locale and regional formatting settings.

[^locale-identifiers]: ECMA-402 defines canonicalization of locale identifiers; Ohtia owns the catalog matching order and explicit fallback mapping.
