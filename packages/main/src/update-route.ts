import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { projectLinks, type CommandPlatform, type UpdateRoute } from "@ohtia/contracts";

/**
 * SPEC-001-040: the system software centre for each supported Linux desktop, opened on its
 * updates view. Fixed absolute paths and arguments; the renderer never names a program.
 */
const softwareCentres = [
  { desktop: "GNOME", program: "/usr/bin/gnome-software", args: ["--mode=updates"] },
  { desktop: "KDE", program: "/usr/bin/plasma-discover", args: ["--mode", "Update"] },
] as const;
type SoftwareCentre = (typeof softwareCentres)[number];

export interface UpdateRouteHost {
  readonly platform: CommandPlatform;
  /** `XDG_CURRENT_DESKTOP`, a colon-separated list such as `ubuntu:GNOME`. */
  readonly desktop: string | undefined;
  readonly executable: (path: string) => boolean;
  readonly launch: (program: string, args: readonly string[]) => Promise<boolean>;
  readonly openBrowser: (url: string) => Promise<void>;
}

/** Only called for Linux; the desktop list decides which centre may open. */
function softwareCentre(host: UpdateRouteHost): SoftwareCentre | undefined {
  const desktops = (host.desktop ?? "").split(":").map((name) => name.trim().toUpperCase());
  return softwareCentres.find(
    (centre) => desktops.includes(centre.desktop) && host.executable(centre.program),
  );
}

/** How this system updates Ohtia; Linux without a known software centre only explains it. */
export function updateRoute(host: UpdateRouteHost): UpdateRoute {
  if (host.platform !== "linux") return "download_page";
  return softwareCentre(host) ? "software_centre" : "system";
}

/** Opens the route's destination; it never downloads or installs anything itself. */
export async function openUpdateRoute(host: UpdateRouteHost): Promise<boolean> {
  if (host.platform !== "linux") {
    await host.openBrowser(projectLinks.download);
    return true;
  }
  const centre = softwareCentre(host);
  return centre ? await host.launch(centre.program, centre.args) : false;
}

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Starts a detached program and reports whether the operating system started it. */
export function launchDetached(program: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(program, [...args], { detached: true, stdio: "ignore", shell: false });
      child.once("error", () => {
        resolve(false);
      });
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
