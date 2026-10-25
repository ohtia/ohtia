---
type: DecisionRecord
title: "ADR-0039 — Integrated window title bar"
description: "Combine the window title bar, application-menu entry and workspace context bar in one 48 px row drawn with platform window controls."
generated:
  by: claude-code/claude-opus-5-5
sources:
  - id: electron-titlebar
    resource: "https://www.electronjs.org/docs/latest/tutorial/custom-title-bar"
    title: "Electron — Custom title bar"
  - id: electron-window
    resource: "https://www.electronjs.org/docs/latest/api/browser-window"
    title: "Electron — BrowserWindow"
---

# ADR-0039 — Integrated window title bar

## Context

Each workspace window needs the operating system's window controls, access to the application menu and the workspace context bar defined in [Workspace layout](../workspace-layout.md#regions-and-surfaces). Stacking a native title bar, the Windows and Linux menu bar and a separate 48 px context bar uses about 108 px of vertical chrome. That space is scarce at 400 px window height and at 200% or 400% interface zoom, which [ADR-0023](adr-0023-desktop-accessibility-verification.md) requires the interface to support.

Electron can hide the native title bar. With `titleBarStyle: "hidden"`, Windows and Linux need `titleBarOverlay` to show the system window controls, and page content cannot use the area beneath those controls; on macOS the traffic-light controls remain in the window.[^electron-titlebar]

The alternatives were the three-row arrangement above, which keeps native chrome but spends the vertical space, and a fully custom-drawn set of window controls, which would imitate platform behavior and accessibility that the operating system already provides.

## Decision

Every workspace window uses one top row of `component.workspace.context-bar.minimum` height that is at the same time the title bar, the entry to the application menu and the workspace context bar.

- On Windows and Linux, use `titleBarStyle: "hidden"` with `titleBarOverlay`. The operating system draws minimize, maximize and close at the end of the row. The row starts with an application-menu button that opens the same application menu through the registry; F10, and the left Alt key pressed and released alone, open it too.
- On macOS, use `titleBarStyle: "hiddenInset"`. The traffic lights stay at the start of the row, and the application menu stays in the system menu bar with no in-window menu button.

The overlay color follows the effective theme's `surface.panel` and, on Windows, its symbol color follows `content.primary`; the trusted main process updates both when the confirmed theme changes.[^electron-window] Only empty bar space is a drag region, and no Ohtia control renders beneath the system controls. The [EPIC-002 integrated title bar specification](../epics/EPIC-002-basic-interface/epic.md#spec-002-022-integrated-title-bar-and-native-window-state) owns the implementation contract, ownership and verification.

## Consequences

The workspace gains about 60 px of vertical space without drawing its own window controls. Every supported Linux target and desktop environment must qualify the overlay; if the locked Electron version or a qualified environment cannot draw it, implementation reports a blocker, and any fallback to a native frame requires an amendment to this decision. Keyboard access to the application menu and the dispatch of every registered accelerator with the hidden title bar must be verified on each Windows and Linux target. Drag regions, safe areas and theme-synchronized overlay colors become part of the workspace chrome's acceptance. Selecting this design does not establish a working implementation.

[^electron-titlebar]: Electron's custom title bar guide documents the hidden title bar styles, the Windows and Linux window-controls overlay and the area that page content cannot use.

[^electron-window]: Electron's BrowserWindow API documents `setTitleBarOverlay` on Windows and Linux, the background color and the `ready-to-show` event.
