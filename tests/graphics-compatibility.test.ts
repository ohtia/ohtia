import { describe, expect, it, vi } from "vitest";
import { configureGraphicsCompatibility } from "../packages/main/src/graphics-compatibility.js";

const kdeWayland = {
  XDG_SESSION_TYPE: "wayland",
  XDG_CURRENT_DESKTOP: "KDE",
  WAYLAND_DISPLAY: "wayland-1",
};
function commandLine(disabled = "") {
  const switches = new Map([["disable-features", disabled]]);
  return {
    switches,
    getSwitchValue: vi.fn((name: string) => switches.get(name) ?? ""),
    appendSwitch: vi.fn((name: string, value: string) => {
      switches.set(name, value);
    }),
  };
}

describe("KDE Wayland graphics compatibility", () => {
  it("keeps other platforms and desktop sessions on their existing graphics defaults", () => {
    for (const [platform, environment] of [
      ["win32", kdeWayland],
      ["darwin", kdeWayland],
      ["linux", {}],
      ["linux", { ...kdeWayland, XDG_SESSION_TYPE: "x11" }],
      ["linux", { ...kdeWayland, XDG_SESSION_TYPE: "" }],
      ["linux", { ...kdeWayland, WAYLAND_DISPLAY: "" }],
      ["linux", { ...kdeWayland, XDG_CURRENT_DESKTOP: "GNOME" }],
      ["linux", { ...kdeWayland, XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }],
      ["linux", { ...kdeWayland, XDG_CURRENT_DESKTOP: "not-KDE" }],
      ["linux", { ...kdeWayland, XDG_CURRENT_DESKTOP: "" }],
    ] as const) {
      const line = commandLine("ExistingFeature");
      configureGraphicsCompatibility(line, platform, environment);
      expect(line.appendSwitch, JSON.stringify({ platform, environment })).not.toHaveBeenCalled();
      expect(line.getSwitchValue).not.toHaveBeenCalled();
    }
  });

  it("avoids only unsupported color negotiation for a KDE desktop token", () => {
    for (const desktop of ["KDE", "Fedora:KDE", "KDE:Other"]) {
      const line = commandLine();
      configureGraphicsCompatibility(line, "linux", {
        ...kdeWayland,
        XDG_CURRENT_DESKTOP: desktop,
      });
      expect(line.appendSwitch.mock.calls).toEqual([
        ["disable-features", "WaylandWpColorManagerV1"],
      ]);
    }
  });

  it("preserves other disabled features and does not duplicate the color fallback", () => {
    for (const disabled of ["ExistingFeature", "ExistingFeature,WaylandWpColorManagerV1"]) {
      const line = commandLine(disabled);
      configureGraphicsCompatibility(line, "linux", kdeWayland);
      configureGraphicsCompatibility(line, "linux", kdeWayland);
      expect(line.switches.get("disable-features")).toBe("ExistingFeature,WaylandWpColorManagerV1");
    }
  });

  it("preserves WebGPU adapter selection while applying the color fallback", () => {
    for (const adapter of ["", "default", "vulkan", "opengles"]) {
      const line = commandLine();
      line.switches.set("use-webgpu-adapter", adapter);
      configureGraphicsCompatibility(line, "linux", kdeWayland);
      expect(line.switches.get("use-webgpu-adapter")).toBe(adapter);
      expect(line.appendSwitch.mock.calls).toEqual([
        ["disable-features", "WaylandWpColorManagerV1"],
      ]);
    }
  });
});
