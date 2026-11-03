import type { CommandLine } from "electron";

type DesktopSession = Readonly<{
  XDG_SESSION_TYPE?: string;
  XDG_CURRENT_DESKTOP?: string;
  WAYLAND_DISPLAY?: string;
}>;

/** Apply ADR-0044 before Electron initializes graphics; session identity is not qualification. */
export function configureGraphicsCompatibility(
  commandLine: Pick<CommandLine, "appendSwitch" | "getSwitchValue">,
  platform: string,
  environment: DesktopSession,
): void {
  if (
    platform !== "linux" ||
    environment.XDG_SESSION_TYPE !== "wayland" ||
    !environment.WAYLAND_DISPLAY ||
    !environment.XDG_CURRENT_DESKTOP?.split(":").includes("KDE")
  )
    return;

  // KWin does not advertise the legacy sRGB transfer function Chromium requests.
  const disabled = new Set(
    commandLine.getSwitchValue("disable-features").split(",").filter(Boolean),
  );
  disabled.add("WaylandWpColorManagerV1");
  commandLine.appendSwitch("disable-features", [...disabled].join(","));
}
