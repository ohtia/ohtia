---
type: Playbook
title: Renderer design foundations
description: Generate canonical design tokens and verify bundled typography, icons and static branding before building the renderer.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Renderer design foundations

## Canonical inputs and checks

[Ohtia design system](design-system.md) owns visual values, typography roles and the closed contrast-pair inventory; [Workspace layout](workspace-layout.md#workspace-component-measurements) owns workspace measurements and aliases. `tooling/design-tokens.mjs` reads those definitions and produces `packages/renderer/src/design-tokens.css` and `design-tokens.ts`. It rejects duplicate definitions, unresolved aliases, unparsed token names and insufficient contrast. CSS retains aliases as custom-property references; `designMetrics` exports the resolved numerical measurements in CSS pixels or milliseconds, and `iconMappings` preserves the canonical icon names.

Run these commands from the isolated task worktree after the [workspace setup](developer-workspace.md). Generation is deliberate; verification never rewrites a stale output.

```bash
.tooling/node/bin/node tooling/design-tokens.mjs --write
.venv/bin/python scripts/design_assets.py --write-font-css
.venv/bin/python scripts/design_assets.py --write-icon-module
python3 scripts/workspace.py run design:check
```

On Windows use `.tooling/node/node.exe` and `.venv/Scripts/python.exe` for the generation commands. `design:check` uses the shared platform-aware wrapper. Build, type checking and tests also run the token and asset checks before compilation. Change a canonical definition and regenerate its projection in the same logical change. Generated outputs are excluded from formatting because their exact deterministic serialization is the drift contract.

The closed contrast inventory is checked independently with WCAG relative luminance in both modes. `assertPair` rejects a foreground/background pair absent from that inventory or a requested minimum stronger than the declared pair. The renderer records semantic usage contexts in `packages/renderer/color-usage.json`, without copying physical palette values. Each colored selector has exactly one flat rule; new consumers declare their foreground and permitted backgrounds before use. PostCSS reads authored renderer CSS without browser normalization, preserving duplicate declarations and priorities. An explicit property vocabulary rejects unhandled features; priorities, duplicate properties and unknown at-rules also fail. Within that vocabulary, all custom-property references must resolve, color declarations use semantic tokens, and actual foreground/background/border/outline combinations are checked against the inventory. Direct token expressions and the admitted border/outline forms are checked against those contexts. Mixed colors, unregistered colored selectors, split color rules, unsupported paint properties, transforms, nesting and uninspected imports fail instead of receiving an inferred contrast result. Forced colors admits the controlled system-color declarations separately. Mutating a consumer to use an unlisted background fails `design:check`. A new pairing needs a canonical entry before a consumer uses it. Color continues to identify provenance and operational state without certifying research quality, following PRIN-004, PRIN-005 and PRIN-006.

## Typography and themes

The renderer's `foundation.css` composes the generated tokens and font declarations with `design-roles.css`. Explicit light or dark overrides the system appearance; System follows the operating system. Reduced motion sets every declared duration to zero. Forced colors retains system text, borders, focus and the glasses' outlines for either explicit theme as well as System.

Use `data-type` with a canonical scale name, such as `type.ui.body-small` or `type.doc.h2`, for the complete family, size, weight and numeric line height. `data-font-role="document"` selects the document body and bounded reading measure; `code`, `pre` and `data-font-role="code"` select literal code. `data-font-role="math"` supplies typography for already controlled mathematical content; it supplies no formula parser. A passage's role and declared language remain independent of the containing interface surface and locale. Korean passages retain keep-all wrapping, anywhere overflow and upright emphasis dots. Font synthesis is disabled.

The font manifest binds every selected file to its upstream distribution or commit, native version, weight/style, embedding flags, actual character repertoire, MATH-table presence, SHA-256 and license. The bundle contains the required Sans, Serif, Mono and Math faces; Plex Sans KR; Noto Sans KR and Serif KR fallbacks; and Noto Sans Regular restricted by CSS to U+207F. Upstream Plex files remain unmodified. The superscript fallback uses lossless WOFF2 conversion with the pinned font inspector. Licenses retain their text with repository LF and trailing-space conventions.

`design:check` inspects the actual OpenType files, checks all 11,172 Hangul syllables, modern and ancient jamo, tone marks, Hanja, the declared Latin signs and the current runtime's date/currency output for every supported locale. It compares `design-fonts.css` with the manifest, so broadening the U+207F range or changing a font byte fails. This is repertoire and metadata evidence; it does not prove IME, mathematical shaping, fluent Korean review or export fidelity.

## Local assets and identity

`packages/renderer/icons/manifest.json` identifies the pinned Lucide distribution and the actual SVG exports selected by the design and workspace mappings. Retain its combined ISC/MIT license. `LucideGlyph` renders the checked paths as controlled React SVG elements with `currentColor`, the canonical 1.75 stroke and the 16/20/24 size choices. It is decorative; controls supply their own accessible names and text through the consuming primitive. No SVG markup is injected. The unmodified upstream files remain its geometry source, and `design-icons.ts` is a checked deterministic projection.

`OhtiaGlasses` provides the specified unfilled compact geometry at sizes up to 24 pixels, and the original filled geometry from 25 to 95 pixels. Sizes are finite, positive CSS pixels below the character threshold of 96. Its drawing is decorative. `OhtiaBrand` pairs the compact glasses with the Ohtia name in `type.ui.subheading`; it does not identify an agent contribution or human confirmation. The renderer package exports these components, `designMetrics`, `iconMappings` and `LucideGlyph` through its existing root.

`packages/renderer/branding/` retains the unchanged canonical PNG, character SVG and filled-glasses SVG with source paths and hashes. The desktop builder packages these resources and the icon SVGs locally, lists their MIME types and integrity hashes, and retains their manifests and licenses. The original PNG is 512 by 512 RGBA with its approved digest. About's density selection and character-presentation controls belong to their consuming stories; this foundation does not enable a density switch or event animation.

## Verification boundaries

Focused token tests exercise changed canonical values, missing aliases, duplicate definitions, unlisted or insufficient contrast, generated drift and both glasses geometries. Asset tests inspect the real files and reject changed bytes, forged repertoires, missing faces, broadened CSS ranges, missing icons and altered branding. They are part of the common test inventories.

The existing packaged runtime suite includes `packaged-design-foundations`. It temporarily inserts controlled typography specimens into the real renderer, loads all declared font faces in both themes, observes the actual custom fonts through Chromium, checks combined role/scale declarations, explicit/system theme changes, Korean emphasis and wrapping, reduced motion, forced colors (including System dark) and local-only resource requests, then removes the specimens. These fixtures are in the acceptance tooling rather than the shipped application. Execute the suite only through the [admitted native runtime](desktop-runtime.md#native-verification); a portable unit-test pass does not substitute for its artifact-bound results. The later interface qualification owns full-page and manual assistive evidence under [ADR-0023](adr/adr-0023-desktop-accessibility-verification.md).
