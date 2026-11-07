---
type: DecisionRecord
title: ADR-0047 — Linux desktop portal reduced-motion observation
description: Read the desktop portal's reduced-motion setting in main over a bounded session-bus client and combine it with Chromium's media query in the renderer.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: portal-settings
    resource: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html
    title: XDG Desktop Portal — Settings interface
  - id: dbus-specification
    resource: https://dbus.freedesktop.org/doc/dbus-specification.html
    title: D-Bus Specification
  - id: chromium-animation-linux
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/gfx/animation/animation_linux.cc
    title: Chromium Linux reduced-motion input
  - id: chromium-gtk-ui
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/gtk/gtk_ui.cc
    title: Chromium GTK animation setting observation
  - id: chromium-portal-settings
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/linux/portal_settings_linux.cc
    title: Chromium desktop portal settings reader
  - id: chromium-animation
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/gfx/animation/animation.cc
    title: Chromium reduced-motion command-line overrides
  - id: electron-main-parts
    resource: https://github.com/electron/electron/blob/v45.0.0/shell/browser/electron_browser_main_parts.cc
    title: Electron browser initialization of the portal settings reader
---

# ADR-0047 — Linux desktop portal reduced-motion observation

## Context

[Issue #180](https://github.com/ohtia/ohtia/issues/180) reproduces an installed Ubuntu GNOME candidate in which the session's reduced-motion setting is `reduce` and the desktop portal reports `org.freedesktop.appearance` `reduced-motion` as `1`, while Chromium's `prefers-reduced-motion: reduce` media query remains false. Settings therefore omits its explanation and the character keeps the confirmed Animated mode. Disabling GNOME's separate legacy animation setting does produce the expected media-query result. The [character identity contract](../agents/agent-identity.md#character-presentation-preference) requires system reduced motion to override Animated to Static without overriding Hidden or the saved choice, under PRIN-002 and PRIN-013.

The portal defines the key as an unsigned integer: `1` requests reduced motion, `0` has no preference, and unknown values mean no preference.[^portal-settings] The [pinned Electron runtime](adr-0003-electron-desktop-boundaries.md) builds Chromium 156.0.8078.48. On Linux, that Chromium derives reduced motion only from the toolkit's global animation switch, which GTK exposes as `gtk-enable-animations`.[^chromium-animation-linux][^chromium-gtk-ui] Its portal reader consumes `color-scheme` and `accent-color` from the same namespace and ignores other keys; Electron initializes that reader without adding reduced motion.[^chromium-portal-settings][^electron-main-parts] The failure is therefore a compatibility boundary of the selected runtime, not a renderer defect.

The alternatives are an Electron update, Chromium's `force-prefers-reduced-motion` switch, DevTools-protocol media emulation, a D-Bus library from npm, a child process such as `gdbus`, reading GNOME settings directly, or a bounded client in main. No reviewed Electron line that reads this key was identified, and a version change belongs to ADR-0003. The command-line switch is read before the cached toolkit value for the whole process, so it would freeze the request at startup and hide later system changes.[^chromium-animation] Emulation requires attaching the debugger to product renderers. A library adds a runtime dependency for one read; a child process adds process authority and a tool prerequisite; GNOME settings bypass the portal and other desktops that provide the key.

## Decision

On Linux, main observes exactly one setting: `org.freedesktop.appearance` `reduced-motion` from `org.freedesktop.portal.Desktop` at `/org/freedesktop/portal/desktop`. A product-owned TypeScript client uses the first `unix:path` or `unix:abstract` entry of `DBUS_SESSION_BUS_ADDRESS`, authenticates with `EXTERNAL` and the process's own user ID, calls `Hello`, installs one match for this key's `SettingChanged` signal and one for the portal name's `NameOwnerChanged` signal, then calls `ReadOne`.[^dbus-specification] It sends no other calls, writes no setting and starts no process. Main's [boundary policy](../../config/workspace-boundaries.json) admits `node:net` for this client; no package dependency is added.

Value `1` yields `reduce` and any other unsigned value yields `no_preference`. Every other outcome yields `unknown`: no Unix bus address or user ID, connection or authentication failure, connection and authentication exceeding 2000 ms together, a refused bus call, a portal error or missing key, a value of another type, a malformed message, a message larger than 64 KiB, nesting beyond the declared bound and disconnection. A read that stays unanswered leaves the observation `unknown` until its reply or a later signal arrives. The client does not reconnect. Replies are matched by serial. A signal is accepted only from the unique name that answered the current read; signals that precede that reply are ignored because the bus orders one sender's messages. A portal owner change publishes `unknown` and issues one fresh read to the new owner. Windows and macOS do not start the client; Chromium's native input remains their only system source.

Main publishes `{ sequence, value }` on the private `ohtia:system-motion` channel. A trusted main-frame document admitted by the existing window checks may read the current notice synchronously; changes are sent to every application window. Preload accepts only well-formed notices with a larger sequence and exposes `system.readMotion()` and `system.subscribeMotion(listener)`, bounded by the per-window subscription limit and released at unload. The renderer has no access to the bus, the channel or any other setting.

In the renderer, system reduced motion is effective when Chromium's media query matches or the native value is `reduce`. `no_preference` and `unknown` never cancel the media query, so the legacy GTK path and the other platforms keep their behavior. `SystemMotionProvider` holds the window's single bridge subscription from the application root, distributes each change to the mounted consumers and mirrors `reduce` as `data-system-motion="reduce"` on the root element, where the generated motion tokens are zero as under the media query. The character, Settings explanation and token rules consume this one combined input. Surfaces without the bridge, such as the isolated catalog, use the media query alone. The confirmed character preference remains owned by its [named operations](../application-port.md); this observation never writes, replaces or reinterprets it.

## Consequences

The demonstrated GNOME request reaches presentation at startup and when it changes, without a dependency, an Electron change or a second preference owner. Desktops that implement the same portal key receive the same treatment; each still requires its own native evidence. The repository maintains a small subset of the D-Bus wire protocol and must keep its limits, sender binding and failure mapping under test.

A native request arrives asynchronously, so the first frames may use Chromium's value until the read completes; no research-event animation is enabled in this increment, and the character controller cancels motion synchronously when the request arrives. A bus or portal failure after startup returns the observation to `unknown` for the rest of that application session.

Tests exercise the client against a controlled peer on a real Unix socket, including authentication, ordering, sender binding, owner replacement, malformed and oversized input, timeouts and disposal, and exercise the broker, preload and renderer contracts separately. A read of a developer's session bus does not qualify a desktop. Native qualification of the GNOME request, the legacy GTK control and the other platforms follows the [candidate protocol](../application-composition.md#freeze-a-verification-candidate).

Reconsider this client when the Electron line selected by ADR-0003 reads the portal's reduced-motion key itself. Remove it only after native verification shows that the runtime alone reproduces this decision's startup, live-change and fallback behavior.

[^portal-settings]: The Settings interface defines `ReadOne`, `SettingChanged` and the `reduced-motion` values, including treating unknown values as no preference.

[^dbus-specification]: The specification defines the bus address format, `EXTERNAL` authentication, message marshalling, match rules and the bus methods used here.

[^chromium-animation-linux]: Linux reduced motion is the inverse of the toolkit's global animations-enabled setting.

[^chromium-gtk-ui]: The GTK integration reads and observes `gtk-enable-animations`.

[^chromium-portal-settings]: The portal reader handles only `color-scheme` and `accent-color` changes in `org.freedesktop.appearance`.

[^chromium-animation]: The forced reduced-motion switches are checked from the process command line before the cached toolkit value.

[^electron-main-parts]: Electron creates Chromium's portal settings reader to follow theme changes.
