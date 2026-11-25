import { describe, expect, it, vi } from "vitest";
import { projectLinks, type CommandPlatform } from "../packages/contracts/src/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isExecutable,
  launchDetached,
  openUpdateRoute,
  updateRoute,
  type UpdateRouteHost,
} from "../packages/main/src/update-route.js";

function host(
  platform: CommandPlatform,
  desktop: string | undefined,
  installed: readonly string[] = [],
  launched = true,
): UpdateRouteHost & {
  launch: ReturnType<typeof vi.fn>;
  openBrowser: ReturnType<typeof vi.fn>;
} {
  return {
    platform,
    desktop,
    executable: (path) => installed.includes(path),
    launch: vi.fn(async () => launched),
    openBrowser: vi.fn(async () => {}),
  };
}

describe("update route", () => {
  it.each(["win32", "darwin"] as const)(
    "opens the official download page on %s and never launches a program",
    async (platform) => {
      const system = host(platform, "GNOME", ["/usr/bin/gnome-software"]);
      expect(updateRoute(system)).toBe("download_page");
      expect(await openUpdateRoute(system)).toBe(true);
      expect(system.openBrowser).toHaveBeenCalledWith("https://www.ohtia.com/#download");
      expect(projectLinks.download).toBe("https://www.ohtia.com/#download");
      expect(system.launch).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["GNOME", "/usr/bin/gnome-software", ["--mode=updates"]],
    ["ubuntu:GNOME", "/usr/bin/gnome-software", ["--mode=updates"]],
    ["KDE", "/usr/bin/plasma-discover", ["--mode", "Update"]],
  ] as const)(
    "opens the %s software centre on its updates view",
    async (desktop, program, args) => {
      const system = host("linux", desktop, [
        "/usr/bin/gnome-software",
        "/usr/bin/plasma-discover",
      ]);
      expect(updateRoute(system)).toBe("software_centre");
      expect(await openUpdateRoute(system)).toBe(true);
      expect(system.launch).toHaveBeenCalledExactlyOnceWith(program, args);
      expect(system.openBrowser).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["GNOME without its software centre", "GNOME", []],
    ["an unknown desktop", "XFCE", ["/usr/bin/gnome-software", "/usr/bin/plasma-discover"]],
    ["no desktop", undefined, ["/usr/bin/gnome-software"]],
  ] as const)("only explains the system update with %s", async (_name, desktop, installed) => {
    const system = host("linux", desktop, installed);
    expect(updateRoute(system)).toBe("system");
    expect(await openUpdateRoute(system)).toBe(false);
    expect(system.launch).not.toHaveBeenCalled();
    expect(system.openBrowser).not.toHaveBeenCalled();
  });
  it("reports a software centre that the system could not start", async () => {
    const system = host("linux", "KDE", ["/usr/bin/plasma-discover"], false);
    expect(await openUpdateRoute(system)).toBe(false);
  });
  it("finds only executable programs and reports whether the system started one", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-route-"));
    try {
      const plain = path.join(directory, "plain");
      fs.writeFileSync(plain, "");
      fs.chmodSync(plain, 0o600);
      expect(isExecutable(process.execPath)).toBe(true);
      expect(isExecutable(plain)).toBe(false);
      expect(isExecutable(path.join(directory, "missing"))).toBe(false);
      expect(await launchDetached(process.execPath, ["-e", ""])).toBe(true);
      expect(await launchDetached(path.join(directory, "missing"), [])).toBe(false);
      expect(await launchDetached("\0invalid", [])).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
