---
type: DecisionRecord
title: ADR-0044 — Linux graphics defaults and scoped KDE color fallback
description: Preserve native GPU and WebGPU defaults across supported GNOME Wayland profiles and avoid unsupported color negotiation only on KDE Wayland.
sources:
  - id: chromium-color
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/ozone/platform/wayland/host/wayland_wp_color_manager.cc
    title: Chromium color-protocol binding and transfer-function negotiation
  - id: kwin-color
    resource: https://github.com/KDE/kwin/blob/v6.8.2/src/wayland/colormanagement_v1.cpp
    title: KWin color-protocol capabilities and transfer-function admission
  - id: mutter-debian
    resource: https://github.com/GNOME/mutter/blob/48.7/src/wayland/meta-wayland-color-management.c
    title: Mutter legacy sRGB advertisement and admission
  - id: mutter-ubuntu-fedora
    resource: https://github.com/GNOME/mutter/blob/50.1/src/wayland/meta-wayland-color-management.c
    title: Mutter backward-compatible color-protocol negotiation
  - id: chromium-vulkan
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/ozone/platform/wayland/gpu/wayland_surface_factory.cc
    title: Chromium Wayland Vulkan implementation factory
  - id: chromium-gpu
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/gpu/ipc/service/gpu_init.cc
    title: Chromium Vulkan initialization for rendering and WebGPU interoperation
  - id: chromium-webgpu
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/gpu/config/gpu_util.cc
    title: Chromium WebGPU adapter and Vulkan interoperation selection
---

# ADR-0044 — Linux graphics defaults and scoped KDE color fallback

## Context

[Issue #126](https://github.com/ohtia/ohtia/issues/126) reproduces two independent graphics diagnostics during native Fedora KDE Wayland startup with the [pinned Electron runtime](adr-0003-electron-desktop-boundaries.md). The color manager binds the first protocol version and requests the legacy named sRGB transfer function, while KWin does not advertise or accept that function.[^chromium-color][^kwin-color] Separately, the Wayland Vulkan factory reports incompatibility for native implementation creation even when the request serves WebGPU and OpenGL interoperation rather than Vulkan window presentation.[^chromium-vulkan][^chromium-gpu]

The native comparison before and after the workspace-chrome change reproduces both diagnostics. The window opens, saves both appearance values and exits. The researcher reported a normal appearance, but native Electron captures show a repeatable difference near black: a dark background with CSS RGB (21, 20, 17) is captured as (28, 27, 24). Disabling the failing color protocol restores (21, 20, 17) in that capture path. This measures renderer readback, not calibrated physical-display fidelity. PRIN-005, PRIN-006, PRIN-007 and PRIN-016 require preserving that distinction.

### Supported Linux profiles

[ADR-0042](adr-0042-wayland-only-linux-support.md) and the [target manifest](../../config/desktop/targets.json) require Ubuntu, Debian and Fedora Workstation on both x86-64 and ARM64, all using native GNOME Wayland. The compatibility policy has no distribution or CPU exception. Every one of these six GNOME profiles retains Electron's native graphics, WebGPU and color-management defaults.

Mutter source corresponding to Debian's compositor advertises the legacy sRGB transfer function. The newer Mutter source corresponding to Ubuntu and Fedora also advertises it when the client binds protocol version 1, preserving compatibility with Chromium's negotiation.[^mutter-debian][^mutter-ubuntu-fedora] This source comparison supports preserving GNOME's color path rather than generalizing a KWin workaround. It does not substitute for native verification of vendor patches, GPUs, physical displays or either CPU. Earlier [foundation qualification](../native-foundation-report.md) used other source bytes and virtual software displays; it does not qualify this change.

The alternatives are to retain the failed KWin color negotiation, disable the color protocol on every Linux desktop, force the OpenGLES WebGPU adapter, disable hardware acceleration, force X11, or adopt a scoped color fallback. Global color disabling removes useful compositor capabilities from supported GNOME profiles. Forcing OpenGLES eliminates the Vulkan diagnostic on the inspected Intel/Mesa host but makes the default WebGPU Core adapter request return null; only an explicitly requested compatibility adapter remains available. The baseline returns a Core adapter. Disabling hardware acceleration or forcing X11 changes the supported rendering route. Suppressing diagnostics does not correct negotiation. An Electron update requires an identified upstream correction and native verification under the owning runtime decision.

## Decision

Before Electron native readiness, main adds `WaylandWpColorManagerV1` to `disable-features`, preserving other disabled features, only when the host platform is Linux, `XDG_SESSION_TYPE` is `wayland`, `WAYLAND_DISPLAY` is nonempty and the colon-separated `XDG_CURRENT_DESKTOP` contains the exact token `KDE`. This avoids requesting a color description KWin does not support. Other session identities and operating systems retain Electron's existing color policy.

Keep the default WebGPU adapter and Vulkan initialization policy in every session. The observed Vulkan diagnostic is an upstream diagnostic limitation in the interoperation path: this host has accelerated OpenGL composition, hardware WebGL and an available WebGPU Core adapter despite the message. That evidence explains the message without proving that every Vulkan operation or GPU is correct. Do not change the adapter or suppress the diagnostic solely to obtain quiet stderr. A real crash, failed adapter or rendering defect requires investigation of that specific runtime, GPU and compositor combination. Chromium's OpenGLES selection excludes the interoperation path, but its observed capability loss is not an acceptable general Linux workaround.[^chromium-webgpu]

The same policy applies to development, installed and qualification modes. Main retains command-line admission, sandboxing, context isolation, CSP and bounded IPC. There is no arbitrary graphics override, persistent preference, forced Ozone backend, GPU disabling or stderr filter. Session environment identity scopes this compatibility choice; it does not verify the compositor or qualify a desktop. KDE remains outside the qualified GNOME profiles defined by ADR-0042.

## Consequences

KDE Wayland does not use Chromium's `wp_color_manager_v1` path under this policy, so protocol-based HDR and extended color management are unavailable through that path. The fallback is confined to the observed compositor family. Supported GNOME sessions preserve their color-management capabilities. This policy makes no physical color-fidelity guarantee for either compositor.

Verification covers session selection, preservation of existing feature exclusions and WebGPU selection, and configuration before native readiness in all runtime modes. Native verification retains runtime and source identities, startup diagnostics, actual backend/GPU and renderer-sandbox observations, WebGPU adapter availability, appearance save/restart, screenshots and complete shutdown. A KDE result does not qualify GNOME, another GPU, physical color fidelity, HDR, wide gamut, ICC profiles or another CPU. Supported GNOME profiles require their own native regression evidence where available.

Remove the color fallback only after a reviewed upstream runtime negotiates KWin's capabilities correctly and reproductions verify the replacement on KDE and supported GNOME Wayland. Revisit the Vulkan diagnostic when upstream distinguishes presentation from interoperation or changes the native implementation; verify adapter capabilities and rendering before changing its policy. Keep software version selection in ADR-0003 and exact artifacts in the toolchain manifest.

[^chromium-color]: The bound protocol version, named transfer mapping and unsupported-transfer failure are defined in Chromium's color manager.

[^kwin-color]: KWin advertises its supported transfer functions and deliberately rejects the deprecated legacy sRGB function.

[^mutter-debian]: Mutter advertises and accepts the legacy sRGB transfer function in its color-management protocol implementation.

[^mutter-ubuntu-fedora]: Mutter retains the legacy sRGB transfer function for clients binding the first protocol version.

[^chromium-vulkan]: The Wayland factory emits the diagnostic for native Vulkan implementation creation.

[^chromium-gpu]: GPU initialization can request Vulkan for WebGPU and OpenGL interoperation independently of Vulkan composition.

[^chromium-webgpu]: OpenGLES adapter selection disables the Vulkan and OpenGL interoperation path.
