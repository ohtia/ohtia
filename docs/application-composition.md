---
type: Playbook
title: Application composition and interface candidates
description: Compose the installed workspace and bind native packages and the separate development catalog to one immutable verification candidate.
sources:
  - id: electron-overlay
    resource: https://www.electronjs.org/docs/latest/api/base-window
    title: Electron BaseWindow options
---

# Application composition and interface candidates

## Installed application

[The desktop entry](../packages/renderer/src/desktop.tsx) mounts [ApplicationRoot](../packages/renderer/src/application-root.tsx) against the admitted `DesktopBridge`. Bootstrap and recovery use the existing foundation operations. After storage opens, the same root presents the real first-run workspace, with unavailable research capabilities stated explicitly under PRIN-016. Research specimens remain in the separate development catalog; opening Settings, Help, About or Navigator starts no research operation or external transfer.

[SettingsSurfaces](../packages/renderer/src/settings-surfaces.tsx) keeps one language controller and one presentation-preference controller for the window. Its `composeWorkspace` option lets the installed root supply the actual [WorkspaceChrome](workspace-chrome.md) through the children callback. That callback receives the shared preference session, effective character mode, confirmed effective zoom, layout failure controls and `onWorkspaceChange`. Chrome publishes its exact layout controller and current state through that callback and revokes the binding on disposal. Settings uses that controller for visibility and reset; it never constructs another layout authority in this composition. Standalone foundation surfaces retain their own layout owner.

The command registry connects workspace, footer, rail and narrow Settings entries to the same dialog. It also owns Help/About, New window, the application menu, command palette and keyboard-shortcuts handlers. Appearance and zoom commands invoke the named preference operations. The zoom indicator uses the presentation controller's successfully applied percentage; a rendering failure retains the previous effective value and the existing retry action. Welcome and About receive the effective character mode, including reduced-motion precedence. PRIN-002, PRIN-004, PRIN-006 and PRIN-013 require preserving input, causal identity, uncertainty and the window's live arrangement across these changes.

The title row consumes the native Window Controls Overlay CSS environment rectangle directly; zero additional insets add no guessed native-control width. Electron exposes that rectangle when the window producer enables `titleBarOverlay`.[^electron-overlay] [ADR-0039](adr/adr-0039-integrated-window-title-bar.md) and the [native window producer](epics/EPIC-002-basic-interface/STORY-002-013-native-window-chrome.md) own platform options and qualification. The packaged integration case requires an observable native safe area and checks the actual row against it. A missing native rectangle is a failed check requiring investigation, not permission to guess an inset or change the window-frame decision.

The workspace stays mounted during service recovery, while the bootstrap surface explains recovery. Its private presentation state, document focus mode and originating layout controller survive; a hidden zero-sized box is not a new usable viewport. New layout and presentation mutations remain unavailable until storage and the workspace are usable again. An open Settings dialog keeps its DOM, focus and reading position when initial bootstrap hands layout ownership to the workspace. Disposing the root cancels its status wait and timer, revokes command listeners and disposes feature subscriptions. Closing Settings leaves accepted preference operations with their existing identity so their original receipt can still be reconciled.

## Packaged integration checks

The [storage acceptance entry](../tooling/storage-acceptance.mjs) runs `integrated-application-root` against the same installed payload, file-backed preference boundary and active CSP as its other cases. [The workspace journey](../tooling/command-workspace.mjs) checks the real first-run workspace, title-row safe area, Settings from footer/rail/narrow chrome, shared layout actions, separator resizing and pair reset, palette execution, shortcuts, application menu, New window, Help/About and copied build information. Its record keeps tested subcases and limitations explicit. The existing Settings journey exercises confirmed character/zoom propagation, native factors and input preservation; storage covers receipt, restart and recovery boundaries. The [ordinary startup journey](../tooling/startup-acceptance.mjs) records `installed-window-bounds-survive-restart`, checking the close-time durable bounds through the actual restoration request after applying the connected displays’ work-area placement rules in a fresh process. It records requested and accepted size/state separately on native Wayland, where the compositor may restrict resizing, and checks exact restored bounds and state on positional backends. This follows the backend-specific qualification in [SPEC-002-022](epics/EPIC-002-basic-interface/epic.md#spec-002-022-integrated-title-bar-and-native-window-state), which qualifies the story’s general restoration requirement. Synthetic DOM and controlled-port schedules complement these checks without qualifying physical keyboard layouts, native IME or assistive operation.

Run the [shared checks](shared-verification.md) and the [native quality pipeline](quality-builds.md) for the actual candidate. Hosted quality packages require genuine event and runner context; a local library archive, fabricated hosted environment or passing fixture report cannot replace them. Required native cells and included optional extensions come from the versioned quality plan.

## Freeze a verification candidate

Use a clean checkout of the exact tested Git tree. Retrieve the complete native artifact directories and plan from the identified passing pipeline attempt before their retention expires. Preserve their existing names and attachments under the chosen ignored evidence directory. Build the development catalog separately from that same source and retain its receipt:

```bash
python3 scripts/interface_candidate.py catalog tmp/interface-catalog.json
python3 scripts/interface_candidate.py freeze tmp/quality-plan.json tmp/quality-inputs artifacts/semantic-catalog tmp/interface-catalog.json tmp/interface-candidate.json --owner human:AdrianMastronardi
```

The catalog command runs the locked catalog build and seals every output file. Freeze reruns the native pipeline's complete accounting against the actual package bytes, smoke reports and current configuration. It refuses dirty source, another source tree, missing partitions, failed cases, changed package/catalog bytes, aliased input directories and an existing output path. Its manifest carries the native source/run identity and configuration/lock hashes, package-to-target/profile mappings, native and smoke attachments, catalog build seal, locale/font/branding/icon hashes, integrating owner and both verifier story identities. The candidate ID hashes this complete content; different operating systems retain their own artifact digests.

Give [STORY-002-010](epics/EPIC-002-basic-interface/STORY-002-010-native-interface-qualification.md) and [STORY-002-011](epics/EPIC-002-basic-interface/STORY-002-011-linguistic-identity-review.md) the same manifest and retained artifacts. Keep the candidate fixed while either stream runs. The named integrating owner serializes an accepted correction under its authorized issue, repeats affected checks and repository review, rebuilds affected artifacts and creates a new manifest. Preserve the earlier candidate and reports; mark affected results from both streams inapplicable to the new candidate and rerun their affected checks. Each stream records the candidate ID it actually examined. Neither stream's report substitutes for the other's evidence.

[^electron-overlay]: Electron's BaseWindow constructor reference describes how `titleBarOverlay` enables Window Controls Overlay JavaScript APIs and CSS environment variables.
